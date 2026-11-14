-- =====================================================================
-- HOSTELOS / SARVLEKH — MASTER PRODUCTION HARDENING MIGRATION
-- Run this in Supabase SQL Editor (as postgres/service_role).
-- Safe and idempotent: wraps checks, triggers, unique indexes, and atomic RPCs.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. DIRECT-WRITE TRIGGER: Prevent Direct Table Write Bypass
-- Ensures ordinary members cannot bypass critical business RPCs
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_critical_doc_writes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IN ('res', 'pay', 'mv') THEN
    IF current_setting('app.allow_critical_doc_write', true) IS DISTINCT FROM 'true'
       AND NOT (SELECT is_super()) THEN
      RAISE EXCEPTION 'Direct writes for kind "%" are forbidden. Use the designated atomic RPC.', NEW.kind
        USING errcode = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS docs_guard_critical ON public.docs;
CREATE TRIGGER docs_guard_critical
  BEFORE INSERT OR UPDATE ON public.docs
  FOR EACH ROW EXECUTE FUNCTION public.guard_critical_doc_writes();


-- ---------------------------------------------------------------------
-- 2. BED ALLOCATION: Backing Unique Invariant & Atomic RPC
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS docs_active_bed_uniq
  ON public.docs (hostel_id, room_id, (data->>'bed'))
  WHERE kind = 'res' AND NOT deleted
    AND (data->>'status') IN ('active', 'notice')
    AND room_id IS NOT NULL
    AND (data->>'bed') IS NOT NULL
    AND (data->>'bed') <> '';

CREATE OR REPLACE FUNCTION public.allocate_bed(
  p_hostel_id uuid,
  p_res_id text,
  p_res_data jsonb,
  p_room_id text,
  p_bed_id text,
  p_invoices jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid;
  v_authorized boolean := false;
  v_room_doc record;
  v_beds jsonb;
  v_bed_found boolean := false;
  v_bed_status text;
  v_idx int;
  v_clean_res_data jsonb;
  v_inv jsonb;
BEGIN
  -- 1. Server-Side Authentication
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;

  -- 2. Strict Role & Tenant Authorization (Never trust client hostel_id)
  IF is_super() THEN
    v_authorized := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.my_access()
      WHERE hostel_id = p_hostel_id
        AND (role IN ('owner', 'manager') OR 'residents' = ANY(perms))
    ) INTO v_authorized;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to allocate beds in hostel %', p_hostel_id USING errcode = '42501';
  END IF;

  -- 3. Strict Input Validation
  IF p_res_id IS NULL OR trim(p_res_id) = '' OR p_room_id IS NULL OR trim(p_room_id) = '' OR p_bed_id IS NULL OR trim(p_bed_id) = '' THEN
    RAISE EXCEPTION 'Resident ID, Room ID, and Bed ID are required' USING errcode = '22023';
  END IF;

  -- Verify resident ID does not already exist
  IF EXISTS (SELECT 1 FROM public.docs WHERE hostel_id = p_hostel_id AND id = p_res_id AND NOT deleted) THEN
    RAISE EXCEPTION 'Resident record % already exists', p_res_id USING errcode = '23505';
  END IF;

  -- 4. Lock Room Document FOR UPDATE (Serializes concurrent allocations)
  SELECT * INTO v_room_doc
  FROM public.docs
  WHERE hostel_id = p_hostel_id AND id = p_room_id AND kind = 'room' AND NOT deleted
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room % not found in hostel %', p_room_id, p_hostel_id USING errcode = 'P0002';
  END IF;

  -- 5. Validate Bed Existence & Enforce Explicit Vacancy
  v_beds := v_room_doc.data->'beds';
  IF v_beds IS NULL OR jsonb_typeof(v_beds) <> 'array' THEN
    RAISE EXCEPTION 'Room % has an invalid beds structure', p_room_id USING errcode = '22023';
  END IF;

  FOR v_idx IN 0 .. jsonb_array_length(v_beds) - 1 LOOP
    IF (v_beds->v_idx->>'id') = p_bed_id THEN
      v_bed_found := true;
      v_bed_status := coalesce(v_beds->v_idx->>'status', '');
      IF v_bed_status <> 'vac' THEN
        RAISE EXCEPTION 'Bed % is not vacant (status: %)', p_bed_id, v_bed_status USING errcode = '23505';
      END IF;
      v_beds := jsonb_set(v_beds, array[v_idx::text, 'status'], '"occ"');
      v_beds := jsonb_set(v_beds, array[v_idx::text, 'resId'], to_jsonb(p_res_id));
    END IF;
  END LOOP;

  IF NOT v_bed_found THEN
    RAISE EXCEPTION 'Bed % does not exist in room %', p_bed_id, p_room_id USING errcode = 'P0003';
  END IF;

  -- 6. Validate Initial Pro-Rata Invoices (Server-Side Enforcement)
  IF jsonb_typeof(p_invoices) = 'array' AND jsonb_array_length(p_invoices) > 0 THEN
    FOR v_idx IN 0 .. jsonb_array_length(p_invoices) - 1 LOOP
      v_inv := p_invoices->v_idx;
      IF (v_inv->>'id') IS NULL OR trim(v_inv->>'id') = '' THEN
        RAISE EXCEPTION 'Invoice ID is required at index %', v_idx USING errcode = '22023';
      END IF;
      IF (v_inv->'data'->>'resId') IS DISTINCT FROM p_res_id THEN
        RAISE EXCEPTION 'Invoice resId must match resident %', p_res_id USING errcode = '22023';
      END IF;
      IF (v_inv->'data'->>'roomId') IS DISTINCT FROM p_room_id THEN
        RAISE EXCEPTION 'Invoice roomId must match room %', p_room_id USING errcode = '22023';
      END IF;
      IF (v_inv->'data'->>'type') NOT IN ('rent', 'deposit') THEN
        RAISE EXCEPTION 'Initial check-in invoice type must be rent or deposit', v_idx USING errcode = '22023';
      END IF;
      IF (v_inv->'data'->>'amount')::numeric <= 0 OR (v_inv->'data'->>'amount')::numeric <> round((v_inv->'data'->>'amount')::numeric, 2) THEN
        RAISE EXCEPTION 'Invoice amount must be positive with at most 2 decimal places' USING errcode = '22023';
      END IF;
      IF (v_inv->>'day') IS NULL OR NOT ((v_inv->>'day') ~ '^\d{4}-\d{2}-\d{2}$') THEN
        RAISE EXCEPTION 'Invoice day must be YYYY-MM-DD' USING errcode = '22023';
      END IF;
    END LOOP;
  END IF;

  -- 7. Sanitize & Enforce Resident Payload (Zero Client Trust)
  v_clean_res_data := coalesce(p_res_data, '{}'::jsonb);
  v_clean_res_data := jsonb_set(v_clean_res_data, '{roomId}', to_jsonb(p_room_id));
  v_clean_res_data := jsonb_set(v_clean_res_data, '{bed}', to_jsonb(p_bed_id));
  v_clean_res_data := jsonb_set(v_clean_res_data, '{status}', '"active"');

  -- 8. Enable Trigger Bypass for this Atomic Transaction
  PERFORM set_config('app.allow_critical_doc_write', 'true', true);

  -- 9. Insert Resident Record
  INSERT INTO public.docs (
    hostel_id, id, kind, data, res_id, room_id, day, deleted, updated_at, updated_by
  ) VALUES (
    p_hostel_id, p_res_id, 'res', v_clean_res_data, p_res_id, p_room_id, null, false, clock_timestamp(), v_caller
  );

  -- 10. Update Room Document
  UPDATE public.docs
  SET data = jsonb_set(data, '{beds}', v_beds),
      updated_at = clock_timestamp(),
      updated_by = v_caller
  WHERE hostel_id = p_hostel_id AND id = p_room_id;

  -- 11. Insert Initial Invoices
  IF jsonb_typeof(p_invoices) = 'array' AND jsonb_array_length(p_invoices) > 0 THEN
    FOR v_idx IN 0 .. jsonb_array_length(p_invoices) - 1 LOOP
      v_inv := p_invoices->v_idx;
      INSERT INTO public.docs (
        hostel_id, id, kind, data, res_id, room_id, day, deleted, updated_at, updated_by
      ) VALUES (
        p_hostel_id, v_inv->>'id', 'inv', v_inv->'data', p_res_id, p_room_id, (v_inv->>'day')::date, false, clock_timestamp(), v_caller
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'res_id', p_res_id, 'room_id', p_room_id, 'bed_id', p_bed_id);
END $$;

REVOKE ALL ON FUNCTION public.allocate_bed(uuid, text, jsonb, text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.allocate_bed(uuid, text, jsonb, text, text, jsonb) TO authenticated;


-- ---------------------------------------------------------------------
-- 3. INVENTORY: Per-Item Row Locking & Unified Stock Movement RPC
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_hostel_id uuid,
  p_item_id text,
  p_qm bigint,
  p_move_doc jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid;
  v_item_row record;
  v_existing_mv record;
  v_current_stock bigint;
  v_new_stock bigint;
  v_doc_id text;
  v_clean_move jsonb;
BEGIN
  -- 1. Server-Side Authentication
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;

  -- 2. Authorization
  IF NOT (is_super() OR EXISTS (
    SELECT 1 FROM public.my_access()
    WHERE hostel_id = p_hostel_id
      AND (role IN ('owner', 'manager', 'cook') OR 'kitchen' = ANY(perms))
  )) THEN
    RAISE EXCEPTION 'Not authorized to record stock movements' USING errcode = '42501';
  END IF;

  -- 3. Null-Safe Payload Checks
  v_doc_id := p_move_doc->>'id';
  IF v_doc_id IS NULL OR trim(v_doc_id) = '' THEN
    RAISE EXCEPTION 'Movement document ID is required' USING errcode = '22023';
  END IF;
  IF (p_move_doc->>'itemId') IS DISTINCT FROM p_item_id THEN
    RAISE EXCEPTION 'Payload itemId (%) does not match parameter (%)', p_move_doc->>'itemId', p_item_id USING errcode = '22023';
  END IF;
  IF (p_move_doc->>'qm')::bigint IS DISTINCT FROM p_qm THEN
    RAISE EXCEPTION 'Payload qm does not match parameter' USING errcode = '22023';
  END IF;
  IF p_qm = 0 THEN
    RAISE EXCEPTION 'Movement quantity cannot be zero' USING errcode = '22023';
  END IF;

  -- 4. Per-Item Row Lock FIRST (Serializes concurrent additions, deductions, counts)
  SELECT * INTO v_item_row
  FROM public.docs
  WHERE hostel_id = p_hostel_id AND id = p_item_id AND kind = 'item' AND NOT deleted
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item % does not exist in hostel %', p_item_id, p_hostel_id USING errcode = 'P0002';
  END IF;

  -- 5. Recheck Idempotency UNDER THE LOCK
  SELECT * INTO v_existing_mv
  FROM public.docs
  WHERE hostel_id = p_hostel_id AND id = v_doc_id AND kind = 'mv' AND NOT deleted;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'movement_id', v_existing_mv.id,
      'item_id', p_item_id,
      'qm', (v_existing_mv.data->>'qm')::bigint
    );
  END IF;

  -- 6. Calculate Balance Under Lock
  SELECT coalesce(sum((data->>'qm')::bigint), 0) INTO v_current_stock
  FROM public.docs
  WHERE hostel_id = p_hostel_id AND kind = 'mv' AND (data->>'itemId') = p_item_id AND NOT deleted;

  v_new_stock := v_current_stock + p_qm;

  -- 7. Prevent Negative Stock on Deductions
  IF p_qm < 0 AND v_new_stock < 0 THEN
    RAISE EXCEPTION 'Insufficient stock for %: current % qm, requested deduction % qm',
      v_item_row.data->>'name', v_current_stock, abs(p_qm) USING errcode = '55P03';
  END IF;

  -- 8. Sanitize & Insert Movement
  v_clean_move := jsonb_set(p_move_doc, '{itemId}', to_jsonb(p_item_id));
  v_clean_move := jsonb_set(v_clean_move, '{qm}', to_jsonb(p_qm));

  PERFORM set_config('app.allow_critical_doc_write', 'true', true);

  INSERT INTO public.docs (
    hostel_id, id, kind, data, res_id, room_id, day, deleted, updated_at, updated_by
  ) VALUES (
    p_hostel_id, v_doc_id, 'mv', v_clean_move, null, null, (v_clean_move->>'date')::date, false, clock_timestamp(), v_caller
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'movement_id', v_doc_id,
    'item_id', p_item_id,
    'previous_qm', v_current_stock,
    'delta_qm', p_qm,
    'remaining_qm', v_new_stock
  );
END $$;

REVOKE ALL ON FUNCTION public.record_stock_movement(uuid, text, bigint, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_movement(uuid, text, bigint, jsonb) TO authenticated;


-- ---------------------------------------------------------------------
-- 4. PAYMENTS: Idempotency Fingerprint Guard & Atomic Allocation RPC
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hostel_receipt_seq (
  hostel_id uuid PRIMARY KEY REFERENCES public.hostels(id) ON DELETE CASCADE,
  last_no bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.hostel_receipt_seq ENABLE ROW LEVEL SECURITY;

-- Seed sequence from historical maximums
INSERT INTO public.hostel_receipt_seq (hostel_id, last_no)
SELECT hostel_id, coalesce(max(
  CASE WHEN (data->>'no') ~ '^R-[0-9]+$'
       THEN substring(data->>'no' FROM 3)::bigint
       ELSE 0 END
), 0)
FROM public.docs
WHERE kind = 'pay' AND NOT deleted
GROUP BY hostel_id
ON CONFLICT (hostel_id) DO UPDATE
  SET last_no = greatest(hostel_receipt_seq.last_no, excluded.last_no);

CREATE UNIQUE INDEX IF NOT EXISTS docs_pay_receipt_uniq
  ON public.docs (hostel_id, (data->>'no'))
  WHERE kind = 'pay' AND NOT deleted AND (data->>'no') IS NOT NULL AND (data->>'no') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS docs_pay_idempotency_uniq
  ON public.docs (hostel_id, (data->>'idempotencyKey'))
  WHERE kind = 'pay' AND NOT deleted AND (data->>'idempotencyKey') IS NOT NULL;

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
BEGIN
  -- 1. Server-Side Authentication
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;

  -- 2. Role Authorization
  IF NOT (is_super() OR EXISTS (
    SELECT 1 FROM public.my_access()
    WHERE hostel_id = p_hostel_id
      AND (role IN ('owner', 'manager', 'accountant') OR perms && ARRAY['payments', 'finance'])
  )) THEN
    RAISE EXCEPTION 'Not authorized to record payments' USING errcode = '42501';
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
    'by', (SELECT full_name FROM public.profiles WHERE id = v_caller),
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
    'allocated', v_alloc,
    'credit_added', v_left
  );
END $$;

REVOKE ALL ON FUNCTION public.record_payment_atomic(uuid, text, text, numeric, text, text, date, text, text, text[], text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_payment_atomic(uuid, text, text, numeric, text, text, date, text, text, text[], text[]) TO authenticated;


-- ---------------------------------------------------------------------
-- 5. ACCOUNT INVITATIONS: Single-Use Re-Entrant Token Claiming
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  claimed_at timestamptz,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.account_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_invites FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_account_invite(p_token_hash text)
RETURNS table(invite_id uuid, user_id uuid, username text, is_reentrant boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
BEGIN
  SELECT i.id, i.user_id, p.username, i.claimed_at, i.used_at INTO v_row
  FROM public.account_invites i
  JOIN public.profiles p ON p.id = i.user_id
  WHERE i.token_hash = p_token_hash AND i.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired activation link' USING errcode = '22023';
  END IF;

  IF v_row.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'This activation link has already been completed' USING errcode = '22023';
  END IF;

  -- Re-entrant grace window: if claimed recently (<5 min), allow idempotent retry
  IF v_row.claimed_at IS NOT NULL AND v_row.claimed_at >= (now() - interval '5 minutes') THEN
    RETURN QUERY SELECT v_row.id, v_row.user_id, v_row.username, true;
    RETURN;
  END IF;

  UPDATE public.account_invites
  SET claimed_at = now()
  WHERE id = v_row.id;

  RETURN QUERY SELECT v_row.id, v_row.user_id, v_row.username, false;
END $$;

CREATE OR REPLACE FUNCTION public.complete_account_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.account_invites
  SET used_at = now(), claimed_at = null
  WHERE id = p_invite_id;

  UPDATE public.profiles
  SET active = true
  WHERE id = (SELECT user_id FROM public.account_invites WHERE id = p_invite_id);
END $$;

CREATE OR REPLACE FUNCTION public.release_account_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.account_invites
  SET claimed_at = null
  WHERE id = p_invite_id AND used_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.claim_account_invite(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_account_invite(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_account_invite(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_invite(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_account_invite(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_account_invite(uuid) TO service_role;

COMMIT;
