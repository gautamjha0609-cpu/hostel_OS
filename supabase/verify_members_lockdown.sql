-- Verify the 2026-11-02 members lock-down. Paste into Supabase -> SQL Editor and run each part.
-- Run it on STAGING first; it is also safe on production: parts 1-3 only read, and part 4
-- makes its own throw-away client, hostels and logins inside a transaction that ALWAYS rolls
-- back (it ends by raising an error that carries the results). Nothing is left behind.

-- ---------------------------------------------------------------- 1. the policy, in full
-- Expect: cmd = UPDATE, roles = {authenticated}, and BOTH qual and with_check mention
-- org_admin_orgs() and full_hostels().
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'members' and policyname = 'members_admin_update';

-- ---------------------------------------------------------------- 2. which columns a browser may update
-- Expect exactly: active, block, deny, perms, role (all for authenticated) and NO rows for anon.
select grantee, string_agg(column_name, ', ' order by column_name) as updatable_columns
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'members' and privilege_type = 'UPDATE'
  and grantee in ('authenticated', 'anon')
group by grantee;

-- ---------------------------------------------------------------- 3. every SECURITY DEFINER function
-- Expect: verdict = 'ok' on every row. A definer function must pin search_path, and anon must
-- not be able to run it. (authenticated may: each of these checks the caller itself - read
-- the body in Database -> Functions if a new one appears here.)
select p.proname as function,
       coalesce(array_to_string(p.proconfig, ', '), '') as settings,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as signed_in_can_run,
       case when coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=%' then 'FIX: no search_path'
            when has_function_privilege('anon', p.oid, 'execute') then 'FIX: anon can run it'
            else 'ok' end as verdict
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by verdict desc, function;

-- ---------------------------------------------------------------- 4. runtime test (always rolled back)
-- Expect an ERROR whose text starts "RESULT (rolled back):" followed by PASS lines only.
-- Any FAIL means the lock-down is not doing its job.
do $test$
declare
  org uuid; org2 uuid; ha uuid; hb uuid; hx uuid;
  own uuid := gen_random_uuid(); mgr uuid := gen_random_uuid(); cookb uuid := gen_random_uuid();
  cooka uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  row_cookb uuid; row_cooka uuid; row_mgr uuid;
  n int; r text := ''; ok boolean;
begin
  insert into auth.users (id, email, aud, role)
    select u, u || '@verify.invalid', 'authenticated', 'authenticated' from unnest(array[own, mgr, cookb, cooka, outsider]) u;
  insert into profiles (id, username, full_name)
    select u, 'verify.' || left(replace(u::text, '-', ''), 12), 'Verify' from unnest(array[own, mgr, cookb, cooka, outsider]) u;
  insert into orgs (name, status) values ('VERIFY client', 'active') returning id into org;
  insert into orgs (name, status) values ('VERIFY other client', 'active') returning id into org2;
  insert into hostels (org_id, name) values (org, 'VERIFY hostel A') returning id into ha;
  insert into hostels (org_id, name) values (org, 'VERIFY hostel B') returning id into hb;
  insert into hostels (org_id, name) values (org2, 'VERIFY other hostel') returning id into hx;
  insert into members (user_id, org_id, hostel_id, role) values (own, org, null, 'owner');
  insert into members (user_id, org_id, hostel_id, role) values (mgr, org, ha, 'manager') returning id into row_mgr;
  insert into members (user_id, org_id, hostel_id, role) values (cookb, org, hb, 'cook') returning id into row_cookb;
  insert into members (user_id, org_id, hostel_id, role) values (cooka, org, ha, 'cook') returning id into row_cooka;
  insert into members (user_id, org_id, hostel_id, role) values (outsider, org2, hx, 'manager');

  -- a. owner can update staff permissions
  perform set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update members set perms = '{payments}' where id = row_cookb; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' a. owner updates staff permissions (rows=' || n || ')';
  reset role;

  -- b-e. hostel A manager
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update members set perms = '{payments}' where id = row_cooka; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' b. manager updates staff of own hostel (rows=' || n || ')';
  update members set perms = '{payments}', role = 'manager' where id = row_cookb; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' c. manager cannot touch another hostel''s staff (rows=' || n || ')';
  update members set role = 'owner' where id = row_mgr; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' d. manager cannot edit own membership (rows=' || n || ')';
  ok := false; begin update members set user_id = mgr where id = row_cooka; exception when insufficient_privilege then ok := true; end;
  r := r || E'\n' || case when ok then 'PASS' else 'FAIL' end || ' e1. user_id cannot be changed';
  ok := false; begin update members set org_id = org2 where id = row_cooka; exception when insufficient_privilege then ok := true; end;
  r := r || E'\n' || case when ok then 'PASS' else 'FAIL' end || ' e2. org_id (client) cannot be changed';
  ok := false; begin update members set hostel_id = null where id = row_cooka; exception when insufficient_privilege then ok := true; end;
  r := r || E'\n' || case when ok then 'PASS' else 'FAIL' end || ' e3. hostel_id cannot be changed';
  reset role;

  -- f. a cook is not an admin
  perform set_config('request.jwt.claims', json_build_object('sub', cooka, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update members set perms = '{payments}' where id = row_cookb; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' f. cook cannot update anyone (rows=' || n || ')';
  reset role;

  -- g. a manager of ANOTHER client
  perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update members set perms = '{payments}' where org_id = org; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' g. other client''s manager cannot update (rows=' || n || ')';
  reset role;

  -- h. not logged in
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  ok := false; begin update members set perms = '{payments}' where id = row_cookb; exception when insufficient_privilege then ok := true; end;
  r := r || E'\n' || case when ok then 'PASS' else 'FAIL' end || ' h. anonymous caller is refused';
  reset role;

  raise exception 'RESULT (rolled back):%', r;
end $test$;
