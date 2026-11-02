-- Per-hostel WhatsApp gateway secrets (run once in the Supabase SQL editor).
-- Already part of schema.sql; this file exists because projects created before that section was
-- added do not have the table. Safe to run twice.
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
