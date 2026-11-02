-- =====================================================================
-- Sarvlekh — Supabase schema (run once in Supabase → SQL Editor)
--
-- Design (kept deliberately small for the free tier):
--   orgs      one row per client (a PG/hostel business). Super admin controls modules & status.
--   hostels   a client can own 1..n hostels/PGs. Per-hostel settings live in one jsonb column.
--   profiles  one row per login (auth.users). username = what people type to log in.
--   members   who can do what where. A user can hold several memberships
--             (e.g. owner of two PGs, or resident in one and staff in another).
--   docs      every operational record (residents, invoices, payments, mess, tasks…) as
--             jsonb, keyed by (hostel_id, id). Clients sync with ONE delta query:
--               select * from docs where hostel_id = X and updated_at >= cursor
--             and write with ONE batched upsert. Soft deletes (deleted = true) so
--             deletions sync too. A few promoted columns (res_id, room_id, day) power
--             row-level security and archive filtering.
--
-- Security: every table has RLS. Helper functions take no row arguments so Postgres
-- evaluates them once per query (InitPlan) instead of once per row. The explicit ::uuid[] /
-- ::text[] cast on each of those scalar subqueries is required, not decoration: without it
-- Postgres reads "= any ((select f()))" as the subquery form of ANY and fails with
-- "operator does not exist: uuid = uuid[]". The cast makes it the array form and keeps the
-- single-evaluation plan.
-- Safe to re-run: objects are created with "if not exists" / "or replace".
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table if not exists public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_name  text,
  phone       text,
  email       text,
  city        text,
  plan        text not null default 'standard',
  fee         numeric not null default 0,           -- yearly SaaS fee (₹); paid_till is how far that year(s) of fee reaches
  paid_till   date,
  status      text not null default 'active' check (status in ('active','suspended')),
  modules     jsonb not null default '{}'::jsonb,   -- {"laundry": false, ...}; missing key = enabled
  max_hostels int  not null default 3,
  max_beds    int  not null default 300,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.hostels (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null,
  city       text,
  address    text,
  phone      text,
  status     text not null default 'active' check (status in ('active','inactive')),
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hostels_org on public.hostels(org_id);

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null unique,
  full_name  text not null,
  phone      text,
  lang       text not null default 'en',
  is_super   boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  hostel_id  uuid references public.hostels(id) on delete cascade,  -- null = every hostel of the org
  role       text not null check (role in ('owner','manager','accountant','cook','housekeeping','laundry','guard','staff','resident')),
  perms      text[] not null default '{}',   -- extra modules granted on top of the role defaults
  deny       text[] not null default '{}',   -- role-default modules taken away
  ref_id     text,                           -- docs.id of the resident / staff record
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists members_user on public.members(user_id);
create index if not exists members_org on public.members(org_id);
create unique index if not exists members_unique on public.members(user_id, org_id, coalesce(hostel_id::text, '*'), role);

create table if not exists public.docs (
  hostel_id  uuid not null references public.hostels(id) on delete cascade,
  id         text not null,
  kind       text not null,
  data       jsonb not null default '{}'::jsonb,
  res_id     text,
  room_id    text,
  day        date,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (hostel_id, id)
);
create index if not exists docs_sync on public.docs(hostel_id, updated_at);
create index if not exists docs_res  on public.docs(hostel_id, res_id) where res_id is not null;
create index if not exists docs_room on public.docs(hostel_id, room_id) where room_id is not null;

-- ---------------------------------------------------------------- triggers
create or replace function public.touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.touch_doc() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists orgs_touch on public.orgs;
create trigger orgs_touch before update on public.orgs for each row execute function public.touch();
drop trigger if exists hostels_touch on public.hostels;
create trigger hostels_touch before update on public.hostels for each row execute function public.touch();
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs for each row execute function public.touch_doc();

-- ---------------------------------------------------------------- access helpers
-- All return arrays for the *current* user and take no row arguments (evaluated once per query).

create or replace function public.is_super() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_super and active from profiles where id = auth.uid()), false)
$$;

-- (hostel, role, perms, ref) for every active membership of the current user in an active org
create or replace function public.my_access()
returns table(hostel_id uuid, org_id uuid, role text, perms text[], ref_id text)
language sql stable security definer set search_path = public as $$
  select h.id, h.org_id, m.role, m.perms, m.ref_id
  from members m
  join orgs o on o.id = m.org_id and o.status = 'active'
  join hostels h on h.org_id = m.org_id and (m.hostel_id is null or m.hostel_id = h.id)
  join profiles p on p.id = m.user_id and p.active
  where m.user_id = auth.uid() and m.active
$$;

create or replace function public.full_hostels() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct hostel_id), '{}') from my_access() where role in ('owner','manager')
$$;

create or replace function public.staff_hostels() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct hostel_id), '{}') from my_access() where role <> 'resident'
$$;

create or replace function public.fin_hostels() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct hostel_id), '{}') from my_access()
  where role in ('owner','manager','accountant') or perms && array['payments','finance']
$$;

create or replace function public.res_hostels() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct hostel_id), '{}') from my_access() where role = 'resident'
$$;

create or replace function public.member_hostels() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct hostel_id), '{}') from my_access()
$$;

create or replace function public.admin_orgs() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct org_id), '{}') from my_access() where role in ('owner','manager')
$$;

-- 'hostel_id:resident_doc_id' keys of the resident records linked to this login
create or replace function public.my_res_keys() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct hostel_id::text || ':' || ref_id), '{}')
  from my_access() where role = 'resident' and ref_id is not null
$$;

-- 'hostel_id:room_id' keys of the rooms those residents live in
create or replace function public.my_room_keys() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct d.hostel_id::text || ':' || (d.data->>'roomId')), '{}')
  from docs d
  where d.kind = 'res' and not d.deleted and d.data->>'roomId' is not null
    and (d.hostel_id::text || ':' || d.id) = any(my_res_keys())
$$;

-- ---------------------------------------------------------------- RLS
alter table public.orgs     enable row level security;
alter table public.hostels  enable row level security;
alter table public.profiles enable row level security;
alter table public.members  enable row level security;
alter table public.docs     enable row level security;

-- orgs: members read their own org; only super admin writes
drop policy if exists orgs_read on public.orgs;
create policy orgs_read on public.orgs for select to authenticated using (
  (select is_super()) or id in (select org_id from my_access())
);
-- One permissive policy per action: an "ALL" policy next to orgs_read made every SELECT run both.
drop policy if exists orgs_write on public.orgs;
drop policy if exists orgs_insert on public.orgs;
drop policy if exists orgs_update on public.orgs;
drop policy if exists orgs_delete on public.orgs;
create policy orgs_insert on public.orgs for insert to authenticated with check ((select is_super()));
create policy orgs_update on public.orgs for update to authenticated using ((select is_super())) with check ((select is_super()));
create policy orgs_delete on public.orgs for delete to authenticated using ((select is_super()));

-- hostels: every member reads (residents need UPI id / meal cut-offs); owner & manager edit settings
drop policy if exists hostels_read on public.hostels;
create policy hostels_read on public.hostels for select to authenticated using (
  (select is_super()) or id = any((select member_hostels())::uuid[])
);
drop policy if exists hostels_update on public.hostels;
create policy hostels_update on public.hostels for update to authenticated
  using ((select is_super()) or id = any((select full_hostels())::uuid[]))
  with check ((select is_super()) or id = any((select full_hostels())::uuid[]));
drop policy if exists hostels_insert on public.hostels;
create policy hostels_insert on public.hostels for insert to authenticated with check ((select is_super()));
drop policy if exists hostels_delete on public.hostels;
create policy hostels_delete on public.hostels for delete to authenticated using ((select is_super()));

-- profiles: self, super, and admins of an org the user belongs to
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or (select is_super())
  or exists (select 1 from members m where m.user_id = profiles.id and m.org_id = any((select admin_orgs())::uuid[]))
);
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid() or (select is_super())) with check (id = auth.uid() or (select is_super()));
-- users may only change harmless columns of their own profile; is_super/username are server-managed
revoke update on public.profiles from authenticated;
grant update (full_name, phone, lang) on public.profiles to authenticated;

-- members: self, super, org admins (admins cannot touch owner rows)
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (
  user_id = auth.uid() or (select is_super()) or org_id = any((select admin_orgs())::uuid[])
);
drop policy if exists members_admin_update on public.members;
create policy members_admin_update on public.members for update to authenticated
  using ((select is_super()) or (org_id = any((select admin_orgs())::uuid[]) and role <> 'owner' and user_id <> auth.uid()))
  with check ((select is_super()) or (org_id = any((select admin_orgs())::uuid[]) and role <> 'owner'));
drop policy if exists members_super_write on public.members;
create policy members_super_write on public.members for insert to authenticated with check ((select is_super()));
drop policy if exists members_super_delete on public.members;
create policy members_super_delete on public.members for delete to authenticated using ((select is_super()));

-- docs ---------------------------------------------------------------
-- finance kinds are hidden from plain staff (cook, guard, …)
--   inv = invoice, pay = payment, claim = UPI claim, sal = salary, exp = expense, dep = deposit refund
-- residents read: their own records, records about their room, and hostel-wide public kinds
drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated using (
  (select is_super())
  or hostel_id = any((select full_hostels())::uuid[])
  or hostel_id = any((select fin_hostels())::uuid[])
  or (hostel_id = any((select staff_hostels())::uuid[]) and kind <> all (array['inv','pay','claim','sal','exp','dep']))
  or (res_id is not null and (hostel_id::text || ':' || res_id) = any((select my_res_keys())::text[]))
  -- A resident's own 'res' row carries no res_id (it has no resident *reference* — it IS the
  -- resident), so every res_id branch above misses it and the resident app would load with
  -- no name, room, rent or dues. Match the row's own id for that one kind.
  or (kind = 'res' and (hostel_id::text || ':' || id) = any((select my_res_keys())::text[]))
  or (room_id is not null and kind in ('hkt','room') and (hostel_id::text || ':' || room_id) = any((select my_room_keys())::text[]))
  or (hostel_id = any((select res_hostels())::uuid[]) and kind in ('menu','dish','notice','hks'))
);

-- owner/manager: everything. staff: everything except payments & salaries (laundry/kitchen
-- staff create charge invoices and purchase expenses). residents: a short whitelist, own rows only.
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated with check (
  (select is_super())
  or hostel_id = any((select full_hostels())::uuid[])
  or (hostel_id = any((select fin_hostels())::uuid[]) and kind in ('inv','pay','claim','exp','dep','ntf','log'))
  or (hostel_id = any((select staff_hostels())::uuid[]) and kind <> all (array['pay','sal','dep','res','room']))
  or (kind in ('skip','tiffin','cmp','claim','hkf','leave','ntf','rinfo')
      and res_id is not null and (hostel_id::text || ':' || res_id) = any((select my_res_keys())::text[]))
);
drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated
  using (
    (select is_super())
    or hostel_id = any((select full_hostels())::uuid[])
    or hostel_id = any((select fin_hostels())::uuid[])
    or (hostel_id = any((select staff_hostels())::uuid[]) and kind <> all (array['inv','pay','claim','sal','exp','dep']))
    or (kind in ('skip','tiffin','cmp','claim','hkf','leave','ntf','rinfo')
        and res_id is not null and (hostel_id::text || ':' || res_id) = any((select my_res_keys())::text[]))
    -- "Resident of that room" may mark a cleaning task done (Settings → Housekeeping rules)
    or (kind = 'hkt' and room_id is not null and (hostel_id::text || ':' || room_id) = any((select my_room_keys())::text[]))
  )
  with check (
    (select is_super())
    or hostel_id = any((select full_hostels())::uuid[])
    or (hostel_id = any((select fin_hostels())::uuid[]) and kind in ('inv','pay','claim','exp','dep','ntf','log'))
    or (hostel_id = any((select staff_hostels())::uuid[]) and kind <> all (array['pay','sal','dep','res','room']))
    or (kind in ('skip','tiffin','cmp','claim','hkf','leave','ntf','rinfo')
        and res_id is not null and (hostel_id::text || ':' || res_id) = any((select my_res_keys())::text[]))
    or (kind = 'hkt' and room_id is not null and (hostel_id::text || ':' || room_id) = any((select my_room_keys())::text[]))
  );
-- rows are soft-deleted (deleted = true) so other devices learn about it; hard delete = super admin
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated using ((select is_super()));

-- ---------------------------------------------------------------- RPCs
-- Super admin dashboard: one call returns usage per hostel.
create or replace function public.admin_stats()
returns table(hostel_id uuid, residents bigint, rows bigint, last_activity timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'forbidden'; end if;
  return query
    select h.id,
      count(*) filter (where d.kind = 'res' and not d.deleted and d.data->>'status' = 'active'),
      count(d.id),
      max(d.updated_at)
    from hostels h left join docs d on d.hostel_id = h.id
    group by h.id;
end $$;

create or replace function public.db_size_mb() returns numeric
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'forbidden'; end if;
  return round(pg_database_size(current_database()) / 1048576.0, 1);
end $$;

-- Size split: what customers stored (public schema) vs what Supabase itself keeps (auth, storage,
-- migrations: about 11 MB on a new project). The free limit counts the total; only the first grows.
create or replace function public.db_usage() returns table(total_mb numeric, data_mb numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select
    round(pg_database_size(current_database()) / 1048576.0, 1),
    round(coalesce((select sum(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relkind in ('r','m')), 0) / 1048576.0, 1);
end $$;
revoke all on function public.db_usage() from public, anon;
grant execute on function public.db_usage() to authenticated;

-- Housekeeping & archive: purge soft-deleted rows older than 60 days (call monthly from super admin).
create or replace function public.purge_deleted() returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if not is_super() then raise exception 'forbidden'; end if;
  delete from docs where deleted and updated_at < now() - interval '60 days';
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.admin_stats() to authenticated;
grant execute on function public.db_size_mb() to authenticated;
grant execute on function public.purge_deleted() to authenticated;

-- =====================================================================
-- 2026-10 hardening. Safe to re-run; existing data is preserved.
-- =====================================================================

-- ---- 1. A record may never change kind or move between hostels -------------
-- docs_update checks the NEW row against the writer's permissions, so a staff login could
-- take a row of a kind it may write (say 'cmp') and turn it into a kind it may not read
-- back ('inv'), or shift it into another hostel it also belongs to. Neither is ever a real
-- edit, so the database refuses both outright.
create or replace function public.lock_doc_identity() returns trigger
language plpgsql as $$
begin
  if new.kind <> old.kind then
    raise exception 'A record cannot change kind (% -> %)', old.kind, new.kind using errcode = '42501';
  end if;
  if new.hostel_id <> old.hostel_id then
    raise exception 'A record cannot move between hostels' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists docs_lock_identity on public.docs;
create trigger docs_lock_identity before update on public.docs
  for each row execute function public.lock_doc_identity();

-- ---- 2. WhatsApp gateway secrets ----------------------------------------
-- Optional self-hosted WhatsApp gateway per hostel (WAHA / Evolution API). The URL and API key
-- are secrets: RLS on with no policies, so only /api/wa (service role) can read them.
create table if not exists public.wa_gateways (
  hostel_id  uuid primary key references public.hostels(id) on delete cascade,
  kind       text not null default 'waha' check (kind in ('waha','evolution')),
  url        text not null,
  api_key    text not null,
  session    text not null default 'default',
  updated_at timestamptz not null default now()
);
alter table public.wa_gateways enable row level security;
revoke all on public.wa_gateways from anon, authenticated;

-- ---- 3. Concurrency-safe settings writes ----------------------------------
-- The app used to read settings, merge locally and PATCH the whole object back, so two
-- admins saving two different settings screens at the same time silently lost one of the
-- two changes. This merges server-side inside a single statement instead.
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare out_ jsonb; k text;
begin
  if a is null then return b; end if;
  if b is null then return a; end if;
  if jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then return b; end if;
  out_ := a;
  for k in select jsonb_object_keys(b) loop
    out_ := jsonb_set(out_, array[k],
      case when a ? k then public.jsonb_deep_merge(a -> k, b -> k) else b -> k end, true);
  end loop;
  return out_;
end $$;

create or replace function public.save_hostel_settings(h uuid, patch jsonb, replace_keys text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare out_ jsonb; k text;
begin
  if not (is_super() or h = any(full_hostels())) then
    raise exception 'Not allowed to change these settings' using errcode = '42501';
  end if;
  if patch ? 'drive' then
    raise exception 'Drive settings are managed by /api/drive' using errcode = '42501';
  end if;
  update hostels
     set settings = jsonb_deep_merge(settings, patch)
   where id = h
  returning settings into out_;
  -- keys the caller wants replaced wholesale rather than merged (lists: meals, expenseCats…)
  foreach k in array coalesce(replace_keys, '{}') loop
    if patch ? k then
      update hostels set settings = jsonb_set(settings, array[k], patch -> k, true)
       where id = h returning settings into out_;
    end if;
  end loop;
  return out_;
end $$;
grant execute on function public.save_hostel_settings(uuid, jsonb, text[]) to authenticated;

-- Settings writes now go exclusively through that function, so no client can clobber the
-- whole object (or write settings.drive) with a plain PATCH.
revoke update on public.hostels from authenticated;
grant update (name, city, address, phone) on public.hostels to authenticated;

-- ---- 4. SaaS billing figures are not every member's business ---------------
-- orgs_read let a resident read their landlord's plan, monthly fee, paid-till date and the
-- platform's private notes. Column grants keep the operational columns readable (the app
-- needs modules + status on every load) and hide the commercial ones.
revoke select on public.orgs from authenticated;
grant select (id, name, status, modules, max_hostels, max_beds, created_at) on public.orgs to authenticated;

-- Owners and managers still need their own billing state; super admin needs everything.
create or replace function public.my_orgs_billing()
returns table(id uuid, name text, plan text, fee numeric, paid_till date, status text,
              owner_name text, phone text, email text, city text, notes text,
              modules jsonb, max_hostels int, max_beds int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.plan, o.fee, o.paid_till, o.status, o.owner_name, o.phone, o.email,
         o.city, case when is_super() then o.notes else null end, o.modules, o.max_hostels,
         o.max_beds, o.created_at
  from orgs o
  where is_super() or o.id = any(admin_orgs())
$$;
grant execute on function public.my_orgs_billing() to authenticated;

-- ---- 5. Indexes the hot paths actually use --------------------------------
-- docs_sync already covers (hostel_id, updated_at). The first load of a hostel also filters
-- on day for the archive window, and most screens read one kind at a time.
create index if not exists docs_day on public.docs(hostel_id, day) where day is not null;
create index if not exists docs_kind on public.docs(hostel_id, kind) where not deleted;
create index if not exists members_active on public.members(user_id) where active;


-- ---- 6. Keeping a free-tier database free --------------------------------
-- Day-wise operational rows are what actually fills the 500 MB: gate entries, cleaning tasks,
-- meal skips, notifications. A 100-bed hostel makes roughly 64,000 of them a year, so ten
-- hostels would use the free database in a little over two years. They are also the rows with
-- the shortest useful life. Money records and people records are never touched by this.
create or replace function public.purge_old_logs(months int default 18)
returns table(kind text, removed bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'forbidden' using errcode = '42501'; end if;
  if months < 6 then raise exception 'Refusing to delete anything newer than 6 months'; end if;
  return query
  with gone as (
    delete from docs d
     where d.kind in ('gate','hkt','hkf','skip','tiffin','served','ntf','log','leave','mv','rinfo')
       and d.day is not null
       and d.day < (current_date - (months || ' months')::interval)
    returning d.kind
  )
  select g.kind, count(*) from gone g group by g.kind;
end $$;
grant execute on function public.purge_old_logs(int) to authenticated;

create or replace function public.storage_breakdown()
returns table(kind text, rows bigint, approx_mb numeric, oldest date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select d.kind, count(*)::bigint,
           round((sum(pg_column_size(d.*)) / 1048576.0)::numeric, 2),
           min(d.day)
    from docs d group by d.kind order by 3 desc nulls last;
end $$;
grant execute on function public.storage_breakdown() to authenticated;

-- =====================================================================

-- ---- 6. Modules can be switched off for one hostel, not just a whole client ----
-- The client-level orgs.modules stays the ceiling: a module the client does not pay for is
-- off everywhere. hostels.modules is the per-hostel switch inside that ceiling, so an owner
-- with three PGs can run the mess module in one of them only.
--
-- Neither column is writable from a browser: orgs is super-admin-only by RLS, and hostels
-- grants update on exactly four harmless columns, so a hostel owner cannot switch their own
-- modules on. Super admin writes both through set_hostel_admin below.
alter table public.hostels add column if not exists modules jsonb not null default '{}'::jsonb;

create or replace function public.set_hostel_admin(h uuid, patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out_ jsonb;
begin
  if not is_super() then
    raise exception 'Only the platform admin can change this' using errcode = '42501';
  end if;
  -- an unknown key here would be silently ignored, which is worse than refusing it
  if (patch - array['status', 'modules']) <> '{}'::jsonb then
    raise exception 'Only status and modules can be set here' using errcode = '22023';
  end if;
  update hostels
     set status  = coalesce(patch ->> 'status', status),
         modules = coalesce(patch ->  'modules', modules)
   where id = h
  returning jsonb_build_object('id', id, 'status', status, 'modules', modules) into out_;
  if out_ is null then raise exception 'Hostel not found' using errcode = 'P0002'; end if;
  return out_;
end $$;
grant execute on function public.set_hostel_admin(uuid, jsonb) to authenticated;
-- After running this file:
--   1. Authentication → Providers → Email: turn OFF "Confirm email" (logins use username, not email).
--   2. Deploy the app on Vercel with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SETUP_KEY env vars.
--   3. Open https://<your-app>/#/setup once and create the super admin with SETUP_KEY.
-- =====================================================================

-- ---- 7. Blocks inside one hostel, and the per-user block lock ----
-- A hostel can be split into Block A, Block B… without becoming separate hostels: one
-- inventory, one set of bills, one head count. A block is only a label on a room; a
-- resident's block is read from the room they live in, so nothing has to be kept in step.
--
-- Billing is deliberately untouched by this: admin_stats() counts residents per HOSTEL, so
-- however many blocks a client creates, the platform still charges for the whole hostel.
--
-- Blocks sit next to modules, on the hostel row and writable only by the platform admin,
-- because an owner inventing blocks their plan does not cover is the same class of problem
-- as an owner switching on a module they do not pay for.
alter table public.hostels add column if not exists blocks jsonb not null default '[]'::jsonb;

-- A login can be tied to one block (a warden who runs Block B only). null = the whole hostel.
alter table public.members add column if not exists block text;

create or replace function public.set_hostel_admin(h uuid, patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out_ jsonb;
begin
  if not is_super() then
    raise exception 'Only the platform admin can change this' using errcode = '42501';
  end if;
  -- an unknown key here would be silently ignored, which is worse than refusing it
  if (patch - array['status', 'modules', 'blocks']) <> '{}'::jsonb then
    raise exception 'Only status, modules and blocks can be set here' using errcode = '22023';
  end if;
  if patch ? 'blocks' and jsonb_typeof(patch -> 'blocks') <> 'array' then
    raise exception 'blocks must be a list' using errcode = '22023';
  end if;
  update hostels
     set status  = coalesce(patch ->> 'status', status),
         modules = coalesce(patch ->  'modules', modules),
         blocks  = coalesce(patch ->  'blocks', blocks)
   where id = h
  returning jsonb_build_object('id', id, 'status', status, 'modules', modules, 'blocks', blocks) into out_;
  if out_ is null then raise exception 'Hostel not found' using errcode = 'P0002'; end if;
  return out_;
end $$;
grant execute on function public.set_hostel_admin(uuid, jsonb) to authenticated;

-- ---- 8. A hostel's public page is reached by its own name ----
-- sarvlekh.in/h/sunrise-boys-pg → the hostel whose settings.site.slug is that text. The
-- lookup runs for every anonymous visitor, so it gets an index rather than a scan; the table
-- is small today, but a public URL is exactly the thing that gets hit by a crawler.
create index if not exists hostels_site_slug
  on public.hostels ((settings -> 'site' ->> 'slug'))
  where status = 'active';

-- ---- 9. Hardening the database linter asked for ----
-- Nothing here was leaking: every SECURITY DEFINER function already checks the caller, and an
-- anonymous call to admin_stats, db_size_mb, storage_breakdown or set_hostel_admin is refused.
-- These four changes remove the surface anyway, and take two measurable costs off the hot path.

-- 9a. A stranger should not be able to CALL the admin plumbing at all, not even to be told no.
-- EXECUTE arrives by default through PUBLIC, which includes anon, so the grant is replaced
-- rather than narrowed. Signed-in users keep it: the policies themselves call is_super(),
-- my_access() and friends while running as the person doing the query.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- 9b. A function without a fixed search_path can be pointed at a different schema by whoever
-- calls it. The security-definer ones already pin it; these four were missed.
alter function public.touch() set search_path = public;
alter function public.touch_doc() set search_path = public;
alter function public.lock_doc_identity() set search_path = public;
alter function public.jsonb_deep_merge(jsonb, jsonb) set search_path = public;

-- 9c. members.hostel_id is a foreign key with no index, and it is read on every login.
create index if not exists members_hostel on public.members(hostel_id);

-- 9d. auth.uid() written bare inside a policy is re-evaluated once per row. Wrapped in a
-- sub-select Postgres runs it once for the whole statement. Same rule, same result, less work.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  id = (select auth.uid()) or (select is_super())
  or exists (select 1 from members m where m.user_id = profiles.id and m.org_id = any((select admin_orgs())::uuid[]))
);
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select is_super()))
  with check (id = (select auth.uid()) or (select is_super()));

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (
  user_id = (select auth.uid()) or (select is_super()) or org_id = any((select admin_orgs())::uuid[])
);
drop policy if exists members_admin_update on public.members;
create policy members_admin_update on public.members for update to authenticated
  using ((select is_super()) or (org_id = any((select admin_orgs())::uuid[]) and role <> 'owner' and user_id <> (select auth.uid())))
  with check ((select is_super()) or (org_id = any((select admin_orgs())::uuid[]) and role <> 'owner'));

-- ---- 10. If you ever create a login by hand, in SQL ----
-- The normal route is the app's own /#/setup screen, which calls /api/admin and lets Supabase
-- Auth build the row. A hand-written insert into auth.users misses something the Auth service
-- assumes: confirmation_token, recovery_token, email_change_token_new and email_change have no
-- default, so they end up NULL. Auth reads them into plain strings, a NULL is a scan failure
-- rather than an empty string, and every login then fails with "Database error query" — which
-- says nothing about the real cause. Set them to '' and the same row logs in fine.
--
--   update auth.users set confirmation_token = coalesce(confirmation_token, ''),
--                         recovery_token = coalesce(recovery_token, ''),
--                         email_change_token_new = coalesce(email_change_token_new, ''),
--                         email_change = coalesce(email_change, '')
--    where confirmation_token is null;

-- ---- 12. ID papers live in a private Supabase Storage bucket ----
-- Only the papers that matter are kept: Aadhaar, the resident's / staff member's photo and the
-- two police-verification papers. Nothing else (payment screenshots, bills, visitor photos)
-- is uploaded any more.
--
-- One folder per hostel:  docs/<hostel id>/<res|staff|signup>/<record id>/<type>-<random>.<ext>
-- The browser compresses each image (≈100–150 KB) and uploads it itself; the hostel's owner
-- and manager may upload and open files in their own hostel's folder and nowhere else.
-- Nobody deletes from a browser — the daily sweep below does that.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('docs', 'docs', false, 3145728, array['image/jpeg', 'image/webp', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- The hostel a stored file belongs to, read from the first folder of its name. A name that
-- does not start with a uuid belongs to no hostel, so it matches no policy instead of failing
-- the cast.
create or replace function public.doc_hostel(name text) returns uuid
language sql immutable set search_path = public as $$
  select case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(name, '/', 1)::uuid end
$$;

drop policy if exists docs_files_read on storage.objects;
create policy docs_files_read on storage.objects for select to authenticated using (
  bucket_id = 'docs' and ((select is_super()) or public.doc_hostel(name) = any((select full_hostels())::uuid[]))
);
drop policy if exists docs_files_insert on storage.objects;
create policy docs_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'docs' and ((select is_super()) or public.doc_hostel(name) = any((select full_hostels())::uuid[]))
);

-- What the daily sweep deletes. A file is kept only while a live record still points at it:
--   resident  until 30 days after checkout
--   staff     until 30 days after they are removed
--   signup    while pending (60 days at most), then 30 more days after admit / reject — an
--             admitted resident's own record points at the same files and keeps them alive
-- Everything else is garbage: papers of people long gone, a paper replaced by a newer upload,
-- an upload whose form was abandoned. Files younger than a day are never touched, so an
-- upload whose record has not synced yet is safe.
create or replace function public.doc_files_garbage(lim int default 1000)
returns setof text
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_super() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with live as (
    select d.hostel_id, d.data from docs d
     where not d.deleted and d.kind in ('res', 'staff', 'signup')
       and case d.kind
         when 'res' then not (coalesce(d.data->>'status', '') = 'left'
                              and coalesce(nullif(d.data->>'left', ''), to_char(d.updated_at, 'YYYY-MM-DD'))
                                  < to_char(current_date - 30, 'YYYY-MM-DD'))
         when 'staff' then coalesce(d.data->>'status', '') <> 'removed' or d.updated_at > now() - interval '30 days'
         else (coalesce(d.data->>'status', 'pending') not in ('admitted', 'rejected') and d.updated_at > now() - interval '60 days')
              or d.updated_at > now() - interval '30 days'
       end
  ), refs as (
    select l.hostel_id, x->>'path' as p
      from live l, jsonb_array_elements(case when jsonb_typeof(l.data->'docs') = 'array' then l.data->'docs' else '[]'::jsonb end) x
    union
    select l.hostel_id, x->>'path'
      from live l, jsonb_array_elements(case when jsonb_typeof(l.data->'pv'->'docs') = 'array' then l.data->'pv'->'docs' else '[]'::jsonb end) x
  )
  select o.name from storage.objects o
   where o.bucket_id = 'docs' and o.created_at < now() - interval '1 day'
     and not exists (select 1 from refs r where r.p = o.name and public.doc_hostel(o.name) = r.hostel_id)
   order by o.created_at
   limit greatest(1, least(lim, 1000));
end $$;

-- Super admin's storage card: how much the bucket holds, per hostel.
create or replace function public.doc_files_usage()
returns table(hostel_id uuid, files bigint, mb numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select public.doc_hostel(o.name), count(*)::bigint,
           round(coalesce(sum((o.metadata->>'size')::bigint), 0) / 1048576.0, 2)
      from storage.objects o where o.bucket_id = 'docs'
     group by 1;
end $$;

revoke execute on function public.doc_files_garbage(int) from public, anon;
grant execute on function public.doc_files_garbage(int) to service_role;   -- the daily sweep only
revoke execute on function public.doc_files_usage() from public, anon;
grant execute on function public.doc_files_usage() to authenticated;

-- Google Drive is gone. Its tables held only connection tokens and folder ids, never a file.
drop table if exists public.hostel_drive;
drop table if exists public.drive_folders;
drop table if exists public.platform_drive;
update public.hostels set settings = settings - 'drive' where settings ? 'drive';

-- ---- 13. Weekly backups: one gzip file per hostel in a private bucket ----
-- Written by the daily cron (api/admin.js, backupHostels). No storage policy on purpose: only the
-- service role can read or write this bucket. Restore with scripts/restore.js.
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Hostels with no backup file in the last `days` days, oldest first. Service role only.
create or replace function public.backup_due(days int default 7) returns setof uuid
language sql security definer set search_path = public, storage as $$
  select h.id from public.hostels h
  where not exists (select 1 from storage.objects o where o.bucket_id = 'backups' and o.name like h.id::text || '/%' and o.created_at > now() - make_interval(days => days))
  order by (select max(o.created_at) from storage.objects o where o.bucket_id = 'backups' and o.name like h.id::text || '/%') nulls first
$$;

-- Backup files beyond the newest `keep` of each hostel.
create or replace function public.backup_old(keep int default 4) returns setof text
language sql security definer set search_path = public, storage as $$
  select name from (
    select o.name, row_number() over (partition by split_part(o.name, '/', 1) order by o.created_at desc) rn
    from storage.objects o where o.bucket_id = 'backups'
  ) x where rn > keep
$$;

revoke all on function public.backup_due(int) from public, anon, authenticated;
revoke all on function public.backup_old(int) from public, anon, authenticated;
grant execute on function public.backup_due(int) to service_role;
grant execute on function public.backup_old(int) to service_role;

-- Every backup file (platform admin screen). Service role only.
create or replace function public.backup_files() returns table (hostel_id uuid, name text, size bigint, at timestamptz)
language sql security definer set search_path = public, storage as $$
  select split_part(o.name, '/', 1)::uuid, o.name, coalesce((o.metadata->>'size')::bigint, 0), o.created_at
  from storage.objects o where o.bucket_id = 'backups' order by o.created_at desc
$$;
revoke all on function public.backup_files() from public, anon, authenticated;
grant execute on function public.backup_files() to service_role;

-- ---- 14. The platform admin's Google Drive link (weekly backups are copied there) ----
create table if not exists public.drive_link (
  id            int primary key default 1 check (id = 1),
  refresh_token text not null,
  email         text,
  folder_id     text,
  created_at    timestamptz not null default now()
);
-- Secret: RLS on and no policy, so only the service role (the server) can read it.
alter table public.drive_link enable row level security;
revoke all on public.drive_link from anon, authenticated;

-- ---- 2026-11-02 members lock-down (see 2026-11-02_members_lockdown.sql for the why) ----
create or replace function public.org_admin_orgs() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.org_id), '{}')
  from members m
  join orgs o on o.id = m.org_id and o.status = 'active'
  join profiles p on p.id = m.user_id and p.active
  where m.user_id = auth.uid() and m.active and m.hostel_id is null and m.role in ('owner','manager')
$$;
revoke execute on function public.org_admin_orgs() from public, anon;
grant execute on function public.org_admin_orgs() to authenticated;

revoke update on public.members from authenticated, anon;
grant update (role, perms, deny, block, active) on public.members to authenticated;

drop policy if exists members_admin_update on public.members;
create policy members_admin_update on public.members for update to authenticated
  using ((select is_super()) or (
    org_id = any((select admin_orgs())::uuid[]) and role <> 'owner' and user_id <> (select auth.uid())
    and (org_id = any((select org_admin_orgs())::uuid[]) or hostel_id = any((select full_hostels())::uuid[]))))
  with check ((select is_super()) or (
    org_id = any((select admin_orgs())::uuid[]) and role <> 'owner'
    and (org_id = any((select org_admin_orgs())::uuid[]) or hostel_id = any((select full_hostels())::uuid[]))));

-- anon has no policy on any of these tables, so these grants were never usable; remove them
-- so a future policy written "to public" by mistake cannot open a write path.
revoke insert, update, delete on public.orgs, public.hostels, public.profiles, public.members, public.docs from anon;
