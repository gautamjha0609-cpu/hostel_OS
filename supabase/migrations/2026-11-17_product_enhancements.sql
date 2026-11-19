-- =====================================================================
-- Migration: 2026-11-17_product_enhancements.sql
-- Purpose:
--   1. Add 'emitra' and 'warden' roles to public.members constraint
--   2. Dedicated tables for Bank Statement Import & Reconciliation
--   3. Indexes on public.docs for 'inquiry', 'mtr_period', and 'claim'
--   4. RLS policies protecting sensitive financial and verification records
-- =====================================================================

-- 1. Expand member roles to support E-Mitra operator and Warden
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (
  role in ('owner','manager','warden','accountant','cook','housekeeping','laundry','guard','staff','resident','emitra')
);

-- 2. Bank Statements table for tracking statement uploads
create table if not exists public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  filename text not null,
  account_no_masked text,
  total_rows int not null default 0,
  matched_count int not null default 0,
  unmatched_count int not null default 0,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 3. Bank Statement Transactions for reconciliation
create table if not exists public.bank_statement_transactions (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  statement_id uuid references public.bank_statements(id) on delete cascade,
  tx_date date not null,
  amount numeric(12,2) not null,
  direction text not null check (direction in ('CR', 'DR')),
  ref_no text, -- normalized UTR / RRN / reference
  narration text,
  status text not null default 'unmatched' check (status in ('unmatched', 'matched', 'probable', 'mismatch', 'duplicate', 'manual_review')),
  matched_claim_id text,
  matched_pay_id text,
  reconciled_at timestamptz,
  reconciled_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Unique index to prevent duplicate credit transactions in the same hostel
create unique index if not exists bank_tx_unique_ref on public.bank_statement_transactions(hostel_id, ref_no, amount, tx_date)
where ref_no is not null and direction = 'CR';

create index if not exists bank_tx_hostel_status on public.bank_statement_transactions(hostel_id, status);
create index if not exists bank_tx_ref on public.bank_statement_transactions(ref_no);

-- 4. Indexes on public.docs for new document kinds
create index if not exists docs_inquiry on public.docs(hostel_id, kind) where kind = 'inquiry';
create index if not exists docs_mtr_period on public.docs(hostel_id, res_id, day) where kind = 'mtr_period';
create index if not exists docs_claim_utr on public.docs(hostel_id, (data->>'utr')) where kind = 'claim';

-- 5. Enable RLS on Bank Reconciliation tables
alter table public.bank_statements enable row level security;
alter table public.bank_statement_transactions enable row level security;

-- Policies for bank_statements: Owner, Manager, Accountant can read and write
drop policy if exists bank_statements_read on public.bank_statements;
create policy bank_statements_read on public.bank_statements for select to authenticated using (
  hostel_id in (
    select hostel_id from public.my_access()
    where role in ('owner', 'manager', 'accountant') or perms && array['payments', 'finance']
  )
);

drop policy if exists bank_statements_write on public.bank_statements;
create policy bank_statements_write on public.bank_statements for insert to authenticated with check (
  hostel_id in (
    select hostel_id from public.my_access()
    where role in ('owner', 'manager', 'accountant') or perms && array['payments', 'finance']
  )
);

-- Policies for bank_statement_transactions: Owner, Manager, Accountant
drop policy if exists bank_tx_read on public.bank_statement_transactions;
create policy bank_tx_read on public.bank_statement_transactions for select to authenticated using (
  hostel_id in (
    select hostel_id from public.my_access()
    where role in ('owner', 'manager', 'accountant') or perms && array['payments', 'finance']
  )
);

drop policy if exists bank_tx_write on public.bank_statement_transactions;
create policy bank_tx_write on public.bank_statement_transactions for all to authenticated using (
  hostel_id in (
    select hostel_id from public.my_access()
    where role in ('owner', 'manager', 'accountant') or perms && array['payments', 'finance']
  )
);
