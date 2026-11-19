-- ==============================================================================
-- HostelOS / Sarvlekh — Migration: 2026-11-16 Cashfree UPI Payment Integration
-- ==============================================================================
-- Implements production-level Cashfree UPI Payment Gateway tables, multi-owner
-- Easy Split settlement tracking, webhook audit logs, refund management,
-- and atomic payment processing support for service-role webhooks.
-- ==============================================================================

-- 1. Owner Payment & Settlement Accounts (Cashfree Easy Split Vendors)
CREATE TABLE IF NOT EXISTS public.owner_payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  hostel_id uuid REFERENCES public.hostels(id) ON DELETE SET NULL,
  vendor_id text NOT NULL UNIQUE,
  account_holder_name text NOT NULL,
  bank_account_number text NOT NULL,
  bank_ifsc text NOT NULL,
  upi_vpa text,
  email text NOT NULL,
  phone text NOT NULL,
  kyc_status text NOT NULL DEFAULT 'PENDING' CHECK (kyc_status IN ('PENDING', 'SUBMITTED', 'VERIFIED', 'ACTIVE', 'REJECTED', 'SUSPENDED')),
  cf_vendor_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_settlement_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_owner_payment_accounts_org ON public.owner_payment_accounts (org_id);
CREATE INDEX IF NOT EXISTS idx_owner_payment_accounts_vendor ON public.owner_payment_accounts (vendor_id);

-- 2. Payment Orders
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id text PRIMARY KEY, -- Cashfree order_id, e.g. "ord_..." or "cf_ord_..."
  hostel_id uuid NOT NULL REFERENCES public.hostels(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
  res_id text NOT NULL,
  inv_id text,
  order_amount numeric(12,2) NOT NULL CHECK (order_amount > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'UNDER_REVIEW')),
  cf_order_id text,
  payment_session_id text,
  vendor_id text REFERENCES public.owner_payment_accounts(vendor_id),
  vendor_allocation_amount numeric(12,2) DEFAULT 0.00,
  splits jsonb DEFAULT '[]'::jsonb,
  customer_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_hostel ON public.payment_orders (hostel_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_org ON public.payment_orders (org_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_res ON public.payment_orders (res_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON public.payment_orders (status);

-- 3. Payment Transactions (Authoritative Gateway Records)
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id text PRIMARY KEY, -- Cashfree cf_payment_id or gateway transaction ID
  order_id text NOT NULL REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
  hostel_id uuid NOT NULL REFERENCES public.hostels(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
  res_id text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'INR',
  payment_method text NOT NULL DEFAULT 'upi',
  payment_group text DEFAULT 'upi',
  payment_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'PENDING', 'CANCELLED', 'USER_DROPPED')),
  gateway_time timestamptz,
  bank_reference text, -- UTR / RRN
  error_details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_order ON public.payment_transactions (order_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_hostel ON public.payment_transactions (hostel_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_res ON public.payment_transactions (res_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_status ON public.payment_transactions (status);

-- 4. Multi-Owner Payment Settlements (Easy Split to Owner Bank Account)
CREATE TABLE IF NOT EXISTS public.payment_settlements (
  id text PRIMARY KEY, -- cf_settlement_id or stl_...
  order_id text REFERENCES public.payment_orders(id) ON DELETE SET NULL,
  cf_payment_id text REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
  hostel_id uuid NOT NULL REFERENCES public.hostels(id) ON DELETE RESTRICT,
  vendor_id text NOT NULL REFERENCES public.owner_payment_accounts(vendor_id) ON DELETE RESTRICT,
  settlement_amount numeric(12,2) NOT NULL CHECK (settlement_amount >= 0),
  service_charge numeric(12,2) DEFAULT 0.00,
  service_tax numeric(12,2) DEFAULT 0.00,
  utr text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'INITIATED', 'SETTLED', 'FAILED')),
  settlement_time timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_settlements_vendor ON public.payment_settlements (vendor_id);
CREATE INDEX IF NOT EXISTS idx_settlements_hostel ON public.payment_settlements (hostel_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON public.payment_settlements (status);

-- 5. Payment Refunds
CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id text PRIMARY KEY, -- refund_id
  order_id text NOT NULL REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
  cf_payment_id text REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  hostel_id uuid NOT NULL REFERENCES public.hostels(id) ON DELETE RESTRICT,
  res_id text NOT NULL,
  refund_amount numeric(12,2) NOT NULL CHECK (refund_amount > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED')),
  cf_refund_id text,
  reason text NOT NULL,
  initiated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_refunds_order ON public.payment_refunds (order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_hostel ON public.payment_refunds (hostel_id);

-- 6. Payment Webhook Logs (Authoritative Audit Trail)
CREATE TABLE IF NOT EXISTS public.payment_webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text,
  event_type text NOT NULL,
  order_id text,
  cf_payment_id text,
  signature text NOT NULL,
  signature_valid boolean NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  error_message text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_order ON public.payment_webhook_logs (order_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event ON public.payment_webhook_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_prune ON public.payment_webhook_logs (processed, created_at) WHERE processed = true;

-- Additional high-performance indexes for concurrent payment queries, sweeps, and audit history
CREATE INDEX IF NOT EXISTS idx_payment_orders_created ON public.payment_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_hostel_created ON public.payment_orders (hostel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_org_created ON public.payment_orders (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_pending_sweep ON public.payment_orders (status, created_at DESC) WHERE status IN ('CREATED', 'PENDING', 'PROCESSING');
CREATE INDEX IF NOT EXISTS idx_payment_tx_created ON public.payment_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_tx_hostel_created ON public.payment_transactions (hostel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconcile_logs_created ON public.payment_reconciliation_logs (created_at DESC);

-- 7. Payment Reconciliation Logs
CREATE TABLE IF NOT EXISTS public.payment_reconciliation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id uuid REFERENCES public.hostels(id) ON DELETE SET NULL,
  orders_checked integer NOT NULL DEFAULT 0,
  mismatches_found integer NOT NULL DEFAULT 0,
  resolved_count integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_by text DEFAULT 'cron',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- ------------------------------------------------------------------------------
-- Row-Level Security (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.owner_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reconciliation_logs ENABLE ROW LEVEL SECURITY;

-- Owner Payment Accounts: Super Admin or Org Admins
CREATE POLICY owner_payment_accounts_read ON public.owner_payment_accounts
  FOR SELECT TO authenticated
  USING (
    is_super() OR org_id IN (
      SELECT org_id FROM public.my_access() WHERE role IN ('owner', 'manager')
    )
  );

CREATE POLICY owner_payment_accounts_write ON public.owner_payment_accounts
  FOR ALL TO authenticated
  USING (
    is_super() OR org_id IN (
      SELECT org_id FROM public.my_access() WHERE role = 'owner'
    )
  );

-- Payment Orders: Residents can view their own; Admins can view hostel orders
CREATE POLICY payment_orders_read ON public.payment_orders
  FOR SELECT TO authenticated
  USING (
    is_super() OR hostel_id IN (
      SELECT hostel_id FROM public.my_access()
      WHERE role IN ('owner', 'manager', 'accountant') OR perms && ARRAY['payments', 'finance']
    ) OR (
      res_id IN (SELECT ref_id FROM public.members WHERE user_id = auth.uid() AND active = true)
    )
  );

-- Payment Transactions: Same access model
CREATE POLICY payment_transactions_read ON public.payment_transactions
  FOR SELECT TO authenticated
  USING (
    is_super() OR hostel_id IN (
      SELECT hostel_id FROM public.my_access()
      WHERE role IN ('owner', 'manager', 'accountant') OR perms && ARRAY['payments', 'finance']
    ) OR (
      res_id IN (SELECT ref_id FROM public.members WHERE user_id = auth.uid() AND active = true)
    )
  );

-- Settlements: Owners and Managers only
CREATE POLICY payment_settlements_read ON public.payment_settlements
  FOR SELECT TO authenticated
  USING (
    is_super() OR hostel_id IN (
      SELECT hostel_id FROM public.my_access()
      WHERE role IN ('owner', 'manager', 'accountant') OR perms && ARRAY['payments', 'finance']
    )
  );

-- Refunds: Admins manage; Residents view their own
CREATE POLICY payment_refunds_read ON public.payment_refunds
  FOR SELECT TO authenticated
  USING (
    is_super() OR hostel_id IN (
      SELECT hostel_id FROM public.my_access()
      WHERE role IN ('owner', 'manager', 'accountant') OR perms && ARRAY['payments', 'finance']
    ) OR (
      res_id IN (SELECT ref_id FROM public.members WHERE user_id = auth.uid() AND active = true)
    )
  );

CREATE POLICY payment_refunds_write ON public.payment_refunds
  FOR ALL TO authenticated
  USING (
    is_super() OR hostel_id IN (
      SELECT hostel_id FROM public.my_access()
      WHERE role IN ('owner', 'manager')
    )
  );

-- Webhook logs & Reconciliation logs: Super admin & managers
CREATE POLICY payment_reconcile_read ON public.payment_reconciliation_logs
  FOR SELECT TO authenticated
  USING (
    is_super() OR hostel_id IN (
      SELECT hostel_id FROM public.my_access() WHERE role IN ('owner', 'manager')
    )
  );

-- ------------------------------------------------------------------------------
-- 8. Enhanced record_payment_atomic with Service-Role / Webhook Authorization Support
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment_atomic(
  p_hostel_id uuid,
  p_idempotency_key text,
  p_res_id text,
  p_amount numeric,
  p_mode text,
  p_ref text,
  p_date date,
  p_note text DEFAULT '',
  p_claim_id text DEFAULT null,
  p_target_inv_ids text[] DEFAULT null,
  p_exclude_inv_ids text[] DEFAULT null
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid;
  v_is_service_role boolean := false;
  v_existing_pay record;
  v_res_doc record;
  v_fingerprint text;
  v_receipt_no bigint;
  v_receipt_str text;
  v_left numeric;
  v_inv record;
  v_take numeric;
  v_alloc jsonb := '[]'::jsonb;
  v_pay_doc jsonb;
  v_pay_id text;
  v_caller_name text := 'System / Cashfree Gateway';
BEGIN
  -- 1. Server-Side Authentication & Service-Role Detection
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    -- Check if executing via Supabase service_role or Postgres superuser
    IF current_user IN ('postgres', 'service_role') OR coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
      v_is_service_role := true;
      v_caller := '00000000-0000-0000-0000-000000000000'::uuid;
    ELSE
      RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
    END IF;
  ELSE
    SELECT full_name INTO v_caller_name FROM public.profiles WHERE id = v_caller;
  END IF;

  -- 2. Role Authorization (Bypassed only for verified service_role gateway webhooks)
  IF NOT v_is_service_role THEN
    IF NOT (is_super() OR EXISTS (
      SELECT 1 FROM public.my_access()
      WHERE hostel_id = p_hostel_id
        AND (role IN ('owner', 'manager', 'accountant') OR perms && ARRAY['payments', 'finance'])
    )) THEN
      RAISE EXCEPTION 'Not authorized to record payments' USING errcode = '42501';
    END IF;
  END IF;

  -- 3. Validation: Amount Precision & Mode
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required' USING errcode = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Amount must be positive with at most 2 decimal places' USING errcode = '22023';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('cash', 'upi', 'bank', 'card', 'cheque') THEN
    RAISE EXCEPTION 'Invalid payment mode %', p_mode USING errcode = '22023';
  END IF;

  -- 4. Compute Request Fingerprint
  v_fingerprint := encode(digest(
    p_res_id || ':' ||
    p_amount::text || ':' ||
    p_mode || ':' ||
    coalesce(p_ref, '') || ':' ||
    p_date::text || ':' ||
    coalesce(array_to_string(p_target_inv_ids, ','), '') || ':' ||
    coalesce(array_to_string(p_exclude_inv_ids, ','), ''),
    'sha256'
  ), 'hex');

  -- 5. Advisory Transaction Lock on Idempotency Key Hash
  PERFORM pg_advisory_xact_lock(hashtext(p_hostel_id::text || ':pay:' || p_idempotency_key));

  -- 6. Idempotency Check & Fingerprint Verification
  SELECT * INTO v_existing_pay
  FROM public.docs
  WHERE hostel_id = p_hostel_id AND kind = 'pay' AND NOT deleted
    AND (data->>'idempotencyKey') = p_idempotency_key;

  IF FOUND THEN
    -- Conflict Check: Same key with different details
    IF (v_existing_pay.data->>'fingerprint') IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Idempotency conflict: key % already used for different payment parameters', p_idempotency_key
        USING errcode = '40900';
    END IF;

    -- Clean Idempotent Replay
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'pay_id', v_existing_pay.id,
      'receipt_no', v_existing_pay.data->>'no',
      'amount', (v_existing_pay.data->>'amount')::numeric,
      'allocated', v_existing_pay.data->'alloc',
      'credit_added', (v_existing_pay.data->>'credit')::numeric
    );
  END IF;

  -- 7. Lock Resident Document
  SELECT * INTO v_res_doc
  FROM public.docs
  WHERE hostel_id = p_hostel_id AND id = p_res_id AND kind = 'res' AND NOT deleted
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resident % not found in hostel %', p_res_id, p_hostel_id USING errcode = 'P0002';
  END IF;

  -- 8. Generate Sequential Monotonic Receipt Number
  INSERT INTO public.hostel_receipt_seq (hostel_id, last_no)
  VALUES (p_hostel_id, 1)
  ON CONFLICT (hostel_id) DO UPDATE SET last_no = hostel_receipt_seq.last_no + 1
  RETURNING last_no INTO v_receipt_no;

  v_receipt_str := 'R-' || lpad(v_receipt_no::text, 5, '0');
  v_left := p_amount;

  -- 9. Allocate Open Invoices (FIFO Oldest First)
  FOR v_inv IN
    SELECT id, data,
           ((data->>'amount')::numeric - coalesce((data->>'paid')::numeric, 0) - coalesce((data->>'waived')::numeric, 0)) AS balance
    FROM public.docs
    WHERE hostel_id = p_hostel_id AND res_id = p_res_id AND kind = 'inv' AND NOT deleted
      AND ((data->>'amount')::numeric - coalesce((data->>'paid')::numeric, 0) - coalesce((data->>'waived')::numeric, 0)) > 0
      AND (p_exclude_inv_ids IS NULL OR NOT (id = ANY(p_exclude_inv_ids)))
    ORDER BY
      CASE WHEN p_target_inv_ids IS NOT NULL AND id = ANY(p_target_inv_ids) THEN 0 ELSE 1 END,
      day ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, v_inv.balance);

    UPDATE public.docs
    SET data = jsonb_set(data, '{paid}', to_jsonb(coalesce((data->>'paid')::numeric, 0) + v_take)),
        updated_at = clock_timestamp(),
        updated_by = v_caller
    WHERE hostel_id = p_hostel_id AND id = v_inv.id;

    v_alloc := v_alloc || jsonb_build_object(
      'inv', v_inv.id,
      'amt', v_take,
      'title', v_inv.data->>'title'
    );
    v_left := v_left - v_take;
  END LOOP;

  -- 10. Credit Balance Handling
  IF v_left > 0 THEN
    UPDATE public.docs
    SET data = jsonb_set(data, '{credit}', to_jsonb(coalesce((data->>'credit')::numeric, 0) + v_left)),
        updated_at = clock_timestamp(),
        updated_by = v_caller
    WHERE hostel_id = p_hostel_id AND id = p_res_id;
  END IF;

  -- 11. Insert Payment Document
  v_pay_id := 'pay-' || p_idempotency_key;
  v_pay_doc := jsonb_build_object(
    'resId', p_res_id,
    'roomId', v_res_doc.data->>'roomId',
    'amount', p_amount,
    'mode', p_mode,
    'ref', p_ref,
    'date', p_date,
    'note', p_note,
    'alloc', v_alloc,
    'credit', v_left,
    'claimId', p_claim_id,
    'no', v_receipt_str,
    'idempotencyKey', p_idempotency_key,
    'fingerprint', v_fingerprint,
    'by', v_caller_name,
    'ts', clock_timestamp()
  );

  PERFORM set_config('app.allow_critical_doc_write', 'true', true);

  INSERT INTO public.docs (
    hostel_id, id, kind, data, res_id, room_id, day, deleted, updated_at, updated_by
  ) VALUES (
    p_hostel_id, v_pay_id, 'pay', v_pay_doc, p_res_id, v_res_doc.data->>'roomId', p_date, false, clock_timestamp(), v_caller
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'pay_id', v_pay_id,
    'receipt_no', v_receipt_str,
    'amount', p_amount,
    'allocated', v_alloc,
    'credit_added', v_left
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_payment_atomic(uuid, text, text, numeric, text, text, date, text, text, text[], text[]) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. Automated Webhook Payload & Diagnostics Pruning Function
-- ------------------------------------------------------------------------------
-- Reusable by nightly sweep cron or super admin to prune transient payloads
-- while preserving all legally and operationally required financial audit records.
CREATE OR REPLACE FUNCTION public.prune_payment_webhook_logs(p_retention_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted integer;
BEGIN
  v_cutoff := clock_timestamp() - (p_retention_days || ' days')::interval;
  DELETE FROM public.payment_webhook_logs
  WHERE processed = true AND created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM public.payment_reconciliation_logs
  WHERE created_at < v_cutoff;

  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_payment_webhook_logs(integer) TO service_role;
