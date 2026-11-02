-- 2026-11-02 · Close a privilege escalation on public.members (production readiness audit).
--
-- Before: `authenticated` could UPDATE every column of members, and members_admin_update only
-- checked that the row was in an org the caller administers. A manager tied to ONE hostel could
-- therefore take any membership row in the org (another hostel's cook, say), set user_id to
-- themselves, hostel_id to null and role to 'manager' - and become manager of every hostel in
-- the org. Verified against the live schema in a rolled-back transaction.
--
-- After:
--   * only the columns the app edits (role, perms, deny, block, active) are updatable, so a row
--     can never change owner, org or hostel from a browser;
--   * a hostel-scoped admin may edit only memberships of the hostels they manage; org-wide rows
--     (hostel_id null) need an org-wide owner/manager.
-- Safe to re-run. No data is changed.

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
