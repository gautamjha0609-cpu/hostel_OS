// ==============================================================================
// Cashfree UPI Integration: Zero Unnecessary Infrastructure, Load & Cost Optimization Tests
// Verifies:
// 1. Zero external dependencies & 0 new server / edge function footprint
// 2. Gateway API call minimization (local DB check before Cashfree API)
// 3. In-flight request deduplication (prevents redundant concurrent Cashfree API requests)
// 4. Exponential backoff retry logic for retryable failures
// 5. Webhook log retention & pruning policy (preserves authoritative audit records)
// 6. Reconciliation scoping (skips active in-flight checkouts < 2 min old)
// ==============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service';
process.env.CASHFREE_CLIENT_ID = 'cf_test_mock_id_123';
process.env.CASHFREE_CLIENT_SECRET = 'cf_test_mock_secret_456';
process.env.PAYMENT_WEBHOOK_SECRET = 'whsec_cashfree_test_secret_789';
process.env.CASHFREE_ENVIRONMENT = 'sandbox';

const Cashfree = require('../api/_cashfree.js');
const publicHandler = require('../api/public.js');
const adminHandler = require('../api/admin.js');

const H_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ORG_A = '11111111-1111-4111-8111-111111111111';
const RES_A1 = 'res_tenant_a1';
const INV_A1 = 'inv_rent_a1_nov';
const U_OWNERA = 'cccccccc-1111-4111-8111-cccccccccccc';
const U_SUPER = 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee';

function createMockDb() {
  const store = {
    hostels: [{ id: H_A, org_id: ORG_A, name: 'Sunrise PG', modules: { cashfree: true }, settings: { pay: { payee: 'Owner A', upiId: 'ownera@okhdfc' } } }],
    owner_payment_accounts: [{ id: 'acc-a', org_id: ORG_A, vendor_id: 'vnd_ownera_123', account_holder_name: 'Owner A', bank_account_number: '123', bank_ifsc: 'HDFC0001234', upi_vpa: 'ownera@okhdfc', kyc_status: 'ACTIVE', is_settlement_active: true }],
    docs: [
      { hostel_id: H_A, id: RES_A1, kind: 'res', data: { name: 'Aman Sharma', roomId: '101' }, deleted: false },
      { hostel_id: H_A, id: INV_A1, kind: 'inv', res_id: RES_A1, data: { title: 'Rent Nov 2026', amount: 8000, paid: 0, waived: 0 }, deleted: false }
    ],
    payment_orders: [],
    payment_transactions: [],
    payment_settlements: [],
    payment_refunds: [],
    payment_webhook_logs: [],
    payment_reconciliation_logs: []
  };

  const origFetch = global.fetch;
  global.fetch = async (url, opt = {}) => {
    const u = new URL(url);
    const method = opt.method || 'GET';
    const json = (status, data) => ({
      ok: status < 400,
      status,
      text: async () => JSON.stringify(data),
      json: async () => data
    });

    if (u.pathname.includes('/hostels')) return json(200, store.hostels);
    if (u.pathname.includes('/owner_payment_accounts')) return json(200, store.owner_payment_accounts);
    if (u.pathname.includes('/docs')) {
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      if (method === 'PATCH') {
        const body = JSON.parse(opt.body);
        for (const d of store.docs) { if (d.id === id) Object.assign(d, body); }
        return json(200, [{ id }]);
      }
      return json(200, store.docs.filter(d => !id || d.id === id));
    }
    if (u.pathname.includes('/payment_orders')) {
      if (method === 'POST') {
        const body = JSON.parse(opt.body);
        store.payment_orders.push(...body);
        return json(201, body);
      }
      if (method === 'PATCH') {
        const id = (u.searchParams.get('id') || '').replace('eq.', '');
        const body = JSON.parse(opt.body);
        for (const o of store.payment_orders) { if (o.id === id) Object.assign(o, body); }
        return json(200, [{ id }]);
      }
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      let hits = store.payment_orders.filter(o => !id || o.id === id);
      if (u.search.includes('created_at=lte.')) {
        const match = u.search.match(/created_at=lte\.([^&]+)/);
        if (match) {
          const cutoff = new Date(decodeURIComponent(match[1])).getTime();
          hits = hits.filter(o => o.created_at && new Date(o.created_at).getTime() <= cutoff);
        }
      }
      return json(200, hits);
    }
    if (u.pathname.includes('/payment_transactions')) {
      if (method === 'POST') {
        const body = JSON.parse(opt.body);
        store.payment_transactions.push(...body);
        return json(201, body);
      }
      const orderId = (u.searchParams.get('order_id') || '').replace('eq.', '');
      return json(200, store.payment_transactions.filter(t => !orderId || t.order_id === orderId));
    }
    if (u.pathname.includes('/payment_webhook_logs')) {
      if (method === 'POST') {
        const body = JSON.parse(opt.body);
        store.payment_webhook_logs.push(...body);
        return json(201, body);
      }
      if (method === 'DELETE') {
        const beforeCount = store.payment_webhook_logs.length;
        store.payment_webhook_logs = store.payment_webhook_logs.filter(w => !w.processed);
        return json(200, Array.from({ length: beforeCount - store.payment_webhook_logs.length }));
      }
      return json(200, store.payment_webhook_logs);
    }
    if (u.pathname.includes('/payment_reconciliation_logs')) {
      if (method === 'POST') {
        const body = JSON.parse(opt.body);
        store.payment_reconciliation_logs.push(...body);
        return json(201, body);
      }
      return json(200, store.payment_reconciliation_logs);
    }
    if (u.pathname.includes('/rpc/prune_payment_webhook_logs')) {
      const initialCount = store.payment_webhook_logs.length;
      store.payment_webhook_logs = store.payment_webhook_logs.filter(w => !w.processed);
      const pruned = initialCount - store.payment_webhook_logs.length;
      store.payment_reconciliation_logs = [];
      return json(200, pruned);
    }
    if (u.pathname.includes('/rpc/record_payment_atomic')) {
      const b = JSON.parse(opt.body);
      const existing = store.docs.find(d => d.kind === 'pay' && d.data && d.data.idempotencyKey === b.p_idempotency_key);
      if (existing) {
        return json(200, { ok: true, idempotent_replay: true, receipt_no: existing.data.no, amount: existing.data.amount });
      }
      const payDoc = {
        hostel_id: b.p_hostel_id,
        id: `pay-${b.p_idempotency_key}`,
        kind: 'pay',
        data: { idempotencyKey: b.p_idempotency_key, amount: b.p_amount, no: 'R-00001' },
        deleted: false
      };
      store.docs.push(payDoc);
      return json(200, { ok: true, pay_id: payDoc.id, receipt_no: 'R-00001', amount: b.p_amount });
    }
    // 10. auth & profiles
    if (u.pathname.includes('/auth/v1/user')) {
      const token = (opt.headers?.Authorization || opt.headers?.authorization || '').replace('Bearer ', '');
      if (token === 'ownera') return json(200, { id: U_OWNERA });
      if (token === 'super') return json(200, { id: U_SUPER });
      return json(401, { error: 'invalid token' });
    }
    if (u.pathname.includes('/profiles')) {
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      return json(200, [{ id, active: true, is_super: id === U_SUPER, full_name: id }]);
    }
    if (u.pathname.includes('/members')) {
      const uid = (u.searchParams.get('user_id') || '').replace('eq.', '');
      if (uid === U_OWNERA) return json(200, [{ user_id: uid, org_id: ORG_A, hostel_id: null, role: 'owner', active: true }]);
      return json(200, []);
    }
    return json(200, []);
  };

  return {
    store,
    cleanup() { global.fetch = origFetch; }
  };
}

let ipSeq = 0;
async function callPublic(sub, body = {}, method = 'POST', extraHeaders = {}) {
  ipSeq++;
  let status = 200, out = null, headers = {};
  const req = {
    method,
    url: `/api/public?sub=${sub}`,
    headers: { 'x-forwarded-for': `192.168.10.${ipSeq % 250}`, ...extraHeaders },
    body
  };
  const res = {
    setHeader(k, v) { headers[k] = v; },
    status(s) { status = s; return this; },
    json(data) { out = data; }
  };
  await publicHandler(req, res);
  return { status, out, headers };
}

async function callAdmin(action, body = {}, role = 'super') {
  ipSeq++;
  let status = 200, out = null;
  const req = {
    method: 'POST',
    url: '/api/admin',
    headers: {
      'x-forwarded-for': `192.168.20.${ipSeq % 250}`,
      authorization: `Bearer ${role}`
    },
    body: { action, ...body }
  };
  const res = {
    setHeader() {},
    status(s) { status = s; return this; },
    json(data) { out = data; }
  };
  await adminHandler(req, res);
  return { status, out };
}

// ------------------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------------------

test('optimization: package.json has 0 external runtime dependencies', () => {
  const pkg = require('../package.json');
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0, 'Must have zero runtime npm dependencies');
});

test('optimization: verify_payment skips Cashfree API when order is already SUCCESS in local DB', async () => {
  const db = createMockDb();
  try {
    // Seed already successful order in DB
    db.store.payment_orders.push({
      id: 'cf_ord_cached_111',
      hostel_id: H_A,
      org_id: ORG_A,
      res_id: RES_A1,
      inv_id: INV_A1,
      order_amount: 8000,
      status: 'SUCCESS'
    });
    db.store.payment_transactions.push({
      id: 'cf_pay_cached_111',
      order_id: 'cf_ord_cached_111',
      amount: 8000,
      bank_reference: 'UTR999999999',
      status: 'SUCCESS'
    });

    let gatewayCalled = false;
    const origGetOrder = Cashfree.getOrder;
    Cashfree.getOrder = async () => {
      gatewayCalled = true;
      return origGetOrder.apply(Cashfree, arguments);
    };

    const res = await callPublic('verify_payment', { order_id: 'cf_ord_cached_111' });
    Cashfree.getOrder = origGetOrder;

    assert.equal(res.status, 200);
    assert.equal(res.out.verified, true);
    assert.equal(res.out.cached, true, 'Must indicate cached local DB resolution');
    assert.equal(gatewayCalled, false, 'Must NOT make outbound Cashfree API call when order is already SUCCESS');
  } finally {
    db.cleanup();
  }
});

test('optimization: in-flight verify_payment deduplicates simultaneous requests for the same order', async () => {
  const db = createMockDb();
  try {
    // Create new order
    const ord = await callPublic('create_payment_order', {
      hostel_id: H_A,
      res_id: RES_A1,
      inv_id: INV_A1,
      amount: 8000
    });
    await Cashfree.payOrderSession({ paymentSessionId: ord.out.payment_session_id });

    let callCount = 0;
    const origGetOrder = Cashfree.getOrder;
    Cashfree.getOrder = async (id) => {
      callCount++;
      await new Promise(r => setTimeout(r, 20)); // Simulate gateway latency
      return origGetOrder(id);
    };

    // Fire 5 simultaneous verification calls for the same order
    const promises = Array.from({ length: 5 }, () =>
      callPublic('verify_payment', { order_id: ord.out.order_id })
    );
    const results = await Promise.all(promises);
    Cashfree.getOrder = origGetOrder;

    for (const r of results) {
      assert.equal(r.status, 200);
      assert.equal(r.out.verified, true);
    }

    // Only 1 outbound request should have been made to Cashfree
    assert.equal(callCount, 1, `Expected 1 outbound gateway request due to deduplication, got ${callCount}`);
  } finally {
    db.cleanup();
  }
});

test('optimization: webhook pruning policy cleans transient logs while strictly preserving financial records', async () => {
  const db = createMockDb();
  try {
    // Populate old processed webhook logs (transient)
    db.store.payment_webhook_logs.push(
      { id: 'wh-1', event_type: 'PAYMENT_SUCCESS_WEBHOOK', processed: true, payload: { raw: 'heavy json 1' } },
      { id: 'wh-2', event_type: 'PAYMENT_SUCCESS_WEBHOOK', processed: true, payload: { raw: 'heavy json 2' } },
      { id: 'wh-3', event_type: 'PAYMENT_FAILED_WEBHOOK', processed: false, payload: { raw: 'unprocessed' } }
    );

    // Populate legal/financial records (MUST NEVER BE PRUNED)
    db.store.payment_orders.push({ id: 'ord-audit-1', hostel_id: H_A, status: 'SUCCESS', order_amount: 8000 });
    db.store.payment_transactions.push({ id: 'tx-audit-1', order_id: 'ord-audit-1', amount: 8000, status: 'SUCCESS' });
    db.store.docs.push({ id: 'pay-audit-1', kind: 'pay', hostel_id: H_A, data: { amount: 8000, no: 'R-00001' } });

    // Execute sweep_payment_logs action
    const r = await callAdmin('sweep_payment_logs', { retention_days: 90 }, 'super');
    assert.equal(r.status, 200);
    assert.equal(r.out.pruned, 2, 'Must prune 2 processed webhook logs');

    // Authoritative financial audit records MUST be completely intact
    assert.equal(db.store.payment_orders.length, 1, 'payment_orders must be permanently preserved');
    assert.equal(db.store.payment_transactions.length, 1, 'payment_transactions must be permanently preserved');
    assert.equal(db.store.docs.filter(d => d.kind === 'pay').length, 1, 'docs pay audit records must never be deleted');
  } finally {
    db.cleanup();
  }
});

test('optimization: reconcile_payments skips freshly created in-flight checkouts (< 2 minutes old)', async () => {
  const db = createMockDb();
  try {
    const now = Date.now();
    // Fresh order created 30 seconds ago (user actively typing UPI PIN)
    db.store.payment_orders.push({
      id: 'cf_ord_fresh_in_flight',
      hostel_id: H_A,
      org_id: ORG_A,
      res_id: RES_A1,
      status: 'PENDING',
      created_at: new Date(now - 30e3).toISOString()
    });

    let queriedFreshOrder = false;
    const origGetOrder = Cashfree.getOrder;
    Cashfree.getOrder = async (id) => {
      if (id === 'cf_ord_fresh_in_flight') queriedFreshOrder = true;
      return origGetOrder(id);
    };

    // Run reconciliation in simulated production mode
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const r = await callAdmin('reconcile_payments', { hostel_id: H_A }, 'ownera');
    process.env.NODE_ENV = oldNodeEnv;
    Cashfree.getOrder = origGetOrder;

    assert.equal(r.status, 200);
    assert.equal(queriedFreshOrder, false, 'Must not query Cashfree for orders created < 2 minutes ago to protect active checkout');
  } finally {
    db.cleanup();
  }
});

test('optimization: cfRequest retries transient 503 errors with exponential backoff and succeeds on recovery', async () => {
  const origFetch = global.fetch;
  let attempts = 0;
  const oldMockMode = process.env.CASHFREE_MOCK_MODE;
  process.env.CASHFREE_MOCK_MODE = 'false';

  global.fetch = async (url, opt = {}) => {
    attempts++;
    if (attempts === 1) {
      return {
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ message: 'Service Temporarily Unavailable' })
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ order_id: 'cf_ord_retry_success', order_status: 'ACTIVE' })
    };
  };

  try {
    const config = {
      isConfigured: true,
      baseUrl: 'https://sandbox.cashfree.com/pg',
      clientId: 'real_client_id_test',
      clientSecret: 'real_client_secret_test',
      apiVersion: '2023-08-01'
    };
    const res = await Cashfree.cfRequest('/orders/cf_ord_retry_success', {
      method: 'GET',
      config,
      backoffBaseMs: 5 // fast in unit tests
    });

    assert.equal(attempts, 2, 'Must have retried once and succeeded on second attempt');
    assert.equal(res.order_id, 'cf_ord_retry_success');
  } finally {
    global.fetch = origFetch;
    process.env.CASHFREE_MOCK_MODE = oldMockMode;
  }
});

test('optimization: cfRequest aborts immediately on non-retryable 400 Bad Request without retrying', async () => {
  const origFetch = global.fetch;
  let attempts = 0;
  const oldMockMode = process.env.CASHFREE_MOCK_MODE;
  process.env.CASHFREE_MOCK_MODE = 'false';

  global.fetch = async (url, opt = {}) => {
    attempts++;
    return {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: 'Invalid order amount' })
    };
  };

  try {
    const config = {
      isConfigured: true,
      baseUrl: 'https://sandbox.cashfree.com/pg',
      clientId: 'real_client_id_test',
      clientSecret: 'real_client_secret_test',
      apiVersion: '2023-08-01'
    };
    await assert.rejects(
      async () => Cashfree.cfRequest('/orders/bad_order', { method: 'GET', config, backoffBaseMs: 5 }),
      (err) => err.status === 400
    );
    assert.equal(attempts, 1, 'Must NOT retry non-retryable 400 client error');
  } finally {
    global.fetch = origFetch;
    process.env.CASHFREE_MOCK_MODE = oldMockMode;
  }
});

test('optimization: create_payment_order reuses active unexpired session within 15 minutes, saving Cashfree API calls & DB rows', async () => {
  const db = createMockDb();
  try {
    let cfCreateCount = 0;
    const origCreateOrder = Cashfree.createOrder;
    Cashfree.createOrder = async (p) => {
      cfCreateCount++;
      return origCreateOrder.apply(Cashfree, [p]);
    };

    // First checkout click
    const res1 = await callPublic('create_payment_order', {
      hostel_id: H_A,
      res_id: RES_A1,
      inv_id: INV_A1,
      amount: 8000
    });
    assert.equal(res1.status, 200);
    assert.equal(cfCreateCount, 1);
    const ordId1 = res1.out.order_id;
    const sessId1 = res1.out.payment_session_id;

    // Second checkout click within 10 seconds (e.g. resident refreshed or multi-tabbed)
    const res2 = await callPublic('create_payment_order', {
      hostel_id: H_A,
      res_id: RES_A1,
      inv_id: INV_A1,
      amount: 8000
    });
    Cashfree.createOrder = origCreateOrder;

    assert.equal(res2.status, 200);
    assert.equal(res2.out.reused, true, 'Must indicate session was reused');
    assert.equal(res2.out.order_id, ordId1, 'Must reuse the exact same order ID');
    assert.equal(res2.out.payment_session_id, sessId1, 'Must reuse the existing payment session');
    assert.equal(cfCreateCount, 1, 'Must NOT make second outbound Cashfree API call');
    assert.equal(db.store.payment_orders.length, 1, 'Must NOT write duplicate row to payment_orders table');
  } finally {
    db.cleanup();
  }
});

test('optimization: create_payment_order rejects already paid invoice with clean error', async () => {
  const db = createMockDb();
  try {
    // Settle invoice in DB
    const inv = db.store.docs.find(d => d.id === INV_A1);
    inv.data.paid = 8000;

    const res = await callPublic('create_payment_order', {
      hostel_id: H_A,
      res_id: RES_A1,
      inv_id: INV_A1
    });

    assert.equal(res.status, 400);
    assert.match(res.out.error, /already been paid in full/i);
  } finally {
    db.cleanup();
  }
});

test('optimization: verify_payment caches terminal EXPIRED status, preventing outbound API calls', async () => {
  const db = createMockDb();
  try {
    db.store.payment_orders.push({
      id: 'cf_ord_expired_999',
      hostel_id: H_A,
      org_id: ORG_A,
      res_id: RES_A1,
      order_amount: 8000,
      status: 'EXPIRED'
    });

    let gatewayCalled = false;
    const origGetOrder = Cashfree.getOrder;
    Cashfree.getOrder = async () => {
      gatewayCalled = true;
      return origGetOrder.apply(Cashfree, arguments);
    };

    const res = await callPublic('verify_payment', { order_id: 'cf_ord_expired_999' });
    Cashfree.getOrder = origGetOrder;

    assert.equal(res.status, 200);
    assert.equal(res.out.verified, false);
    assert.equal(res.out.status, 'EXPIRED');
    assert.equal(res.out.cached, true, 'Must resolve terminal EXPIRED status from local cache');
    assert.equal(gatewayCalled, false, 'Must NOT make outbound Cashfree API request for expired order');
  } finally {
    db.cleanup();
  }
});

test('optimization: nightly sweep cron executes payment log pruning and pending order reconciliation', async () => {
  const db = createMockDb();
  try {
    // Seed 1 processed webhook log to prune
    db.store.payment_webhook_logs.push({
      id: 'wh-prune-sweep-1',
      processed: true,
      created_at: new Date(Date.now() - 100 * 86400e3).toISOString()
    });

    // Seed 1 pending order needing reconciliation
    db.store.payment_orders.push({
      id: 'cf_ord_reconcile_sweep_1',
      hostel_id: H_A,
      org_id: ORG_A,
      res_id: RES_A1,
      inv_id: INV_A1,
      order_amount: 8000,
      status: 'PENDING',
      created_at: new Date(Date.now() - 3600e3).toISOString()
    });

    // Mock Cashfree to return PAID for this order
    Cashfree._mockStore.orders.set('cf_ord_reconcile_sweep_1', {
      order_id: 'cf_ord_reconcile_sweep_1',
      order_amount: 8000,
      order_status: 'PAID'
    });
    Cashfree._mockStore.payments.set('cf_pay_sweep_1', {
      cf_payment_id: 'cf_pay_sweep_1',
      order_id: 'cf_ord_reconcile_sweep_1',
      payment_status: 'SUCCESS',
      payment_amount: 8000,
      bank_reference: 'UTR_SWEEP_123'
    });

    process.env.CRON_SECRET = 'cron-sec-test';
    let sweepStatus = 200, sweepOut = null;
    const req = {
      method: 'GET',
      url: '/api/admin?cron=sweep',
      headers: { authorization: 'Bearer cron-sec-test' }
    };
    const res = {
      setHeader() {},
      status(s) { sweepStatus = s; return this; },
      json(d) { sweepOut = d; }
    };
    await adminHandler(req, res);

    assert.equal(sweepStatus, 200);
    assert.ok(sweepOut.payment_sweep, 'Must have executed payment_sweep in daily cron');
    assert.ok(sweepOut.payment_reconciliation, 'Must have executed payment_reconciliation in daily cron');
    assert.equal(sweepOut.payment_reconciliation.resolved_count, 1, 'Must have resolved pending order to SUCCESS');

    // Confirm DB order was settled
    const updatedOrd = db.store.payment_orders.find(o => o.id === 'cf_ord_reconcile_sweep_1');
    assert.equal(updatedOrd.status, 'SUCCESS');
  } finally {
    db.cleanup();
  }
});

test('optimization: reconcile_payments marks terminal expired orders in DB so they are never queried again', async () => {
  const db = createMockDb();
  try {
    db.store.payment_orders.push({
      id: 'cf_ord_terminal_expired',
      hostel_id: H_A,
      org_id: ORG_A,
      res_id: RES_A1,
      order_amount: 8000,
      status: 'PENDING',
      created_at: new Date(Date.now() - 3600e3).toISOString()
    });

    Cashfree._mockStore.orders.set('cf_ord_terminal_expired', {
      order_id: 'cf_ord_terminal_expired',
      order_amount: 8000,
      order_status: 'EXPIRED'
    });

    const r = await callAdmin('reconcile_payments', { hostel_id: H_A }, 'ownera');
    assert.equal(r.status, 200);
    assert.equal(r.out.resolved_count, 1);
    assert.equal(r.out.details[0].result, 'marked_expired');

    const ord = db.store.payment_orders.find(o => o.id === 'cf_ord_terminal_expired');
    assert.equal(ord.status, 'EXPIRED', 'Order in DB must be updated to EXPIRED');
  } finally {
    db.cleanup();
  }
});

test('optimization: webhook records processed=false on processing failure, preventing premature pruning', async () => {
  const db = createMockDb();
  try {
    const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    const paymentId = 'cf_pay_fail_test';
    const payload = {
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: 'cf_ord_missing_associations', order_amount: 8000 },
        payment: { cf_payment_id: paymentId, payment_status: 'SUCCESS', payment_amount: 8000 },
        customer_details: { customer_id: 'unknown_resident' }
      }
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', webhookSecret).update(timestamp + rawBody).digest('base64');

    const res = await callPublic('webhook', payload, 'POST', {
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
      'x-test-raw-body': rawBody
    });

    // The webhook returned { ok: false, message: 'Missing hostel or resident association' }
    assert.equal(res.status, 200);
    assert.equal(res.out.ok, false);

    // Look at payment_webhook_logs
    const log = db.store.payment_webhook_logs.find(w => w.cf_payment_id === paymentId);
    assert.ok(log, 'Webhook log must be created');
    assert.equal(log.processed, false, 'Failed webhook MUST have processed=false so it is NOT pruned');
    assert.ok(log.error_message, 'Must contain error message for auditing');
  } finally {
    db.cleanup();
  }
});
