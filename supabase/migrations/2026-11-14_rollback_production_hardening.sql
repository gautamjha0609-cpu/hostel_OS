-- =====================================================================
-- HOSTELOS / SARVLEKH — ROLLBACK PRODUCTION HARDENING MIGRATION
-- Run this in Supabase SQL Editor (as postgres/service_role) ONLY IF you
-- need to revert all changes made by 2026-11-14_production_hardening.sql.
-- =====================================================================

BEGIN;

-- 1. Drop Account Activation RPCs and Table
DROP FUNCTION IF EXISTS public.release_account_invite(uuid);
DROP FUNCTION IF EXISTS public.complete_account_invite(uuid);
DROP FUNCTION IF EXISTS public.claim_account_invite(text);
DROP TABLE IF EXISTS public.account_invites CASCADE;

-- 2. Drop Payment RPC, Indexes, and Sequence Table
DROP FUNCTION IF EXISTS public.record_payment_atomic(uuid, text, text, numeric, text, text, date, text, text, text[], text[]);
DROP INDEX IF EXISTS public.docs_pay_idempotency_uniq;
DROP INDEX IF EXISTS public.docs_pay_receipt_uniq;
DROP TABLE IF EXISTS public.hostel_receipt_seq CASCADE;

-- 3. Drop Inventory Movement RPC
DROP FUNCTION IF EXISTS public.record_stock_movement(uuid, text, bigint, jsonb);

-- 4. Drop Bed Allocation RPC and Unique Invariant Index
DROP FUNCTION IF EXISTS public.allocate_bed(uuid, text, jsonb, text, text, jsonb);
DROP INDEX IF EXISTS public.docs_active_bed_uniq;

-- 5. Drop Direct-Write Trigger Guard
DROP TRIGGER IF EXISTS docs_guard_critical ON public.docs;
DROP FUNCTION IF EXISTS public.guard_critical_doc_writes();

COMMIT;
