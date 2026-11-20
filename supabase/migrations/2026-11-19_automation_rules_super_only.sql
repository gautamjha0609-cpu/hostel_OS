-- Automation rules (settings.auto) and the Meta bill template (settings.wa.monthly) decide what
-- gets billed and what costs money per message. Only the platform admin may change them; an
-- owner or manager saving other settings is unaffected.
-- Apply by hand in the Supabase SQL editor. Rollback: re-run the previous definition of
-- save_hostel_settings from supabase/schema.sql.
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
  if not is_super() and (patch ? 'auto' or (patch -> 'wa') ? 'monthly') then
    raise exception 'Automation settings are managed by the platform admin' using errcode = '42501';
  end if;
  update hostels
     set settings = jsonb_deep_merge(settings, patch)
   where id = h
  returning settings into out_;
  foreach k in array coalesce(replace_keys, '{}') loop
    if patch ? k then
      update hostels set settings = jsonb_set(settings, array[k], patch -> k, true)
       where id = h returning settings into out_;
    end if;
  end loop;
  return out_;
end $$;
grant execute on function public.save_hostel_settings(uuid, jsonb, text[]) to authenticated;
