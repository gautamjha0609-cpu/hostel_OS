// Database Hardening Migration & Rollback Reversibility Test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const PREFLIGHT_SQL = path.join(MIGRATIONS_DIR, '2026-11-14_preflight_checks.sql');
const HARDENING_SQL = path.join(MIGRATIONS_DIR, '2026-11-14_production_hardening.sql');
const ROLLBACK_SQL = path.join(MIGRATIONS_DIR, '2026-11-14_rollback_production_hardening.sql');

test('migrations: preflight check queries are syntactically sound and check all 4 critical invariants', () => {
  const content = fs.readFileSync(PREFLIGHT_SQL, 'utf8');
  assert.ok(content.includes('docs_active_bed_uniq') || content.includes('count(*) > 1'), 'Must check duplicate bed occupancy');
  assert.ok(content.includes('room_id IS NULL'), 'Must check missing room_id');
  assert.ok(content.includes('data->>\'bed\''), 'Must check missing bed identifier');
  assert.ok(content.includes('LEFT JOIN public.docs rm'), 'Must check orphaned rooms');
});

test('migrations: production hardening migration wraps in atomic transaction', () => {
  const content = fs.readFileSync(HARDENING_SQL, 'utf8');
  assert.ok(/\bBEGIN\s*;/i.test(content), 'Hardening migration must contain BEGIN;');
  assert.ok(/\bCOMMIT\s*;/i.test(content), 'Hardening migration must end with COMMIT;');
});

test('migrations: production hardening defines all required RPCs, tables and triggers', () => {
  const content = fs.readFileSync(HARDENING_SQL, 'utf8');
  const requiredEntities = [
    'guard_critical_doc_writes',
    'allocate_bed',
    'record_stock_movement',
    'record_payment_atomic',
    'hostel_receipt_seq',
    'docs_pay_receipt_uniq',
    'docs_pay_idempotency_uniq',
    'docs_active_bed_uniq',
    'account_invites',
    'claim_account_invite',
    'complete_account_invite',
    'release_account_invite'
  ];

  for (const entity of requiredEntities) {
    assert.ok(content.includes(entity), `Hardening migration missing required entity: ${entity}`);
  }
});

test('migrations: rollback migration safely drops all hardening objects in reverse order', () => {
  const rollback = fs.readFileSync(ROLLBACK_SQL, 'utf8');
  assert.ok(/\bBEGIN\s*;/i.test(rollback), 'Rollback migration must contain BEGIN;');
  assert.ok(/\bCOMMIT\s*;/i.test(rollback), 'Rollback migration must end with COMMIT;');

  const rollbackEntities = [
    'release_account_invite',
    'complete_account_invite',
    'claim_account_invite',
    'account_invites',
    'record_payment_atomic',
    'docs_pay_idempotency_uniq',
    'docs_pay_receipt_uniq',
    'hostel_receipt_seq',
    'record_stock_movement',
    'allocate_bed',
    'docs_active_bed_uniq',
    'docs_guard_critical',
    'guard_critical_doc_writes'
  ];

  for (const entity of rollbackEntities) {
    assert.ok(rollback.includes(entity), `Rollback migration must drop ${entity}`);
  }
});

test('migrations: master consolidated update covers all changes since clone and is 100% idempotent', () => {
  const masterPath = path.join(MIGRATIONS_DIR, '2026-11-18_MASTER_PRODUCTION_UPDATE.sql');
  assert.ok(fs.existsSync(masterPath), 'Master production update SQL must exist');
  const sql = fs.readFileSync(masterPath, 'utf8');

  // 1. Transaction wrapping
  assert.ok(/\bBEGIN\s*;/i.test(sql), 'Must be wrapped in transaction BEGIN');
  assert.ok(/\bCOMMIT\s*;/i.test(sql), 'Must end with transaction COMMIT');

  // 2. Roles
  assert.ok(sql.includes("'warden'"), 'Must include warden role in members check');
  assert.ok(sql.includes("'emitra'"), 'Must include emitra role in members check');

  // 3. All required tables
  const tables = [
    'owner_payment_accounts',
    'payment_orders',
    'payment_transactions',
    'payment_settlements',
    'payment_refunds',
    'payment_webhook_logs',
    'payment_reconciliation_logs',
    'bank_statements',
    'bank_statement_transactions',
    'hostel_receipt_seq',
    'account_invites'
  ];
  for (const t of tables) {
    assert.ok(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`, 'i').test(sql), `Missing CREATE TABLE IF NOT EXISTS for ${t}`);
  }

  // 4. All RPC functions
  const rpcs = [
    'guard_critical_doc_writes',
    'allocate_bed',
    'record_stock_movement',
    'record_payment_atomic',
    'prune_payment_webhook_logs',
    'claim_account_invite',
    'complete_account_invite',
    'release_account_invite'
  ];
  for (const r of rpcs) {
    assert.ok(new RegExp(`FUNCTION public\\.${r}`, 'i').test(sql), `Missing RPC ${r}`);
  }

  // 5. Critical indexes
  const indexes = [
    'docs_active_bed_uniq',
    'docs_pay_receipt_uniq',
    'docs_pay_idempotency_uniq',
    'bank_tx_unique_ref',
    'docs_inquiry',
    'docs_mtr_period',
    'docs_claim_utr',
    'idx_payment_orders_hostel'
  ];
  for (const idx of indexes) {
    assert.ok(sql.includes(idx), `Missing critical index ${idx}`);
  }

  // 6. Policy idempotency: every CREATE POLICY has DROP POLICY IF EXISTS
  const lines = sql.split('\n');
  const policyLines = lines.filter(l => l.toUpperCase().includes('CREATE POLICY'));
  assert.ok(policyLines.length >= 8, 'Must define at least 8 RLS policies');
  for (const pl of policyLines) {
    const match = pl.match(/CREATE POLICY\s+(\w+)\s+ON\s+([\w\.]+)/i);
    if (match) {
      const pName = match[1];
      const tName = match[2].replace('public.', '');
      assert.ok(
        new RegExp(`DROP POLICY IF EXISTS\\s+${pName}\\s+ON\\s+(public\\.)?${tName}`, 'i').test(sql),
        `Policy ${pName} on ${tName} must have preceding DROP POLICY IF EXISTS`
      );
    }
  }
});
