// ==============================================================================
// Comprehensive Cashfree UPI Payment Gateway & Easy Split Integration Test Suite
// Verifies all 24 mandatory test scenarios outlined in Section 18 of the specification:
// 1. Payment order creation
// 2. Successful UPI payment
// 3. Failed payment
// 4. Pending payment
// 5. Cancelled payment
// 6. Duplicate payment submission
// 7. Duplicate webhook delivery
// 8. Invalid webhook signature
// 9. Webhook replay attack prevention
// 10. Incorrect amount rejection
// 11. Incorrect order ID rejection
// 12. Customer authorization
// 13. Owner authorization
// 14. Cross-owner payment access isolation
// 15. Payment status refresh
// 16. Delayed webhook handling
// 17. Browser closed after payment recovery
// 18. Database failure recovery
// 19. Refund initiation & validation
// 20. Refund verification
// 21. Settlement status updates (Easy Split)
// 22. Reconciliation
// 23. Multiple simultaneous payment requests
// 24. Multiple owners receiving payments independently
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
const H_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const RES_A1 = 'res_tenant_a1';
const RES_B1 = 'res_tenant_b1';
const INV_A1 = 'inv_rent_a1_nov';
const INV_B1 = 'inv_rent_b1_nov';
const U_OWNERA = 'cccccccc-1111-4111-8111-cccccccccccc';
const U_OWNERB = 'dddddddd-2222-4222-8222-dddddddddddd';
const U_SUPER = 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee';

// In-memory mock database state
function createMockDb() {
  const store = {
    hostels: [
      { id: H_A, org_id: ORG_A, name: 'Sunrise PG (Owner A)', settings: { pay: { payee: 'Owner A', upiId: 'ownera@okhdfc' } } },
      { id: H_B, org_id: ORG_B, name: 'Moonlight PG (Owner B)', settings: { pay: { payee: 'Owner B', upiId: 'ownerb@okaxis' } } }
    ],
    owner_payment_accounts: [
      {
        id: 'acc-a', org_id: ORG_A, vendor_id: 'vnd_ownera_123', account_holder_name: 'Owner A Ventures',
        bank_account_number: '50100123456789', bank_ifsc: 'HDFC0001234', upi_vpa: 'ownera@okhdfc',
        kyc_status: 'ACTIVE', is_settlement_active: true
      },
      {
        id: 'acc-b', org_id: ORG_B, vendor_id: 'vnd_ownerb_456', account_holder_name: 'Owner B Hostels',
        bank_account_number: '91200987654321', bank_ifsc: 'UTIB0000567', upi_vpa: 'ownerb@okaxis',
        kyc_status: 'ACTIVE', is_settlement_active: true
      }
    ],
    docs: [
      { hostel_id: H_A, id: RES_A1, kind: 'res', data: { name: 'Aman Sharma', roomId: '101', phone: '9876500001' }, deleted: false },
      { hostel_id: H_A, id: INV_A1, kind: 'inv', res_id: RES_A1, data: { title: 'Rent Nov 2026', amount: 8000, paid: 0, waived: 0 }, deleted: false },
      { hostel_id: H_B, id: RES_B1, kind: 'res', data: { name: 'Rohan Verma', roomId: '201', phone: '9876500002' }, deleted: false },
      { hostel_id: H_B, id: INV_B1, kind: 'inv', res_id: RES_B1, data: { title: 'Rent Nov 2026', amount: 9500, paid: 0, waived: 0 }, deleted: false }
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

    // 1. hostels
    if (u.pathname.includes('/hostels')) {
      const matchId = (u.searchParams.get('id') || '').replace('eq.', '');
      return json(200, store.hostels.filter(h => !matchId || h.id === matchId));
    }
    // 2. docs
    if (u.pathname.includes('/docs')) {
      const hId = (u.searchParams.get('hostel_id') || '').replace('eq.', '');
      const k = (u.searchParams.get('kind') || '').replace('eq.', '');
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      if (method === 'PATCH') {
        const body = JSON.parse(opt.body);
        for (const d of store.docs) {
          if (d.id === id) Object.assign(d, body);
        }
        return json(200, [{ id }]);
      }
      let hits = store.docs.filter(d => (!hId || d.hostel_id === hId) && (!k || d.kind === k) && (!id || d.id === id));
      return json(200, hits);
    }
    // 3. owner_payment_accounts
    if (u.pathname.includes('/owner_payment_accounts')) {
      const orgId = (u.searchParams.get('org_id') || '').replace('eq.', '');
      const hits = store.owner_payment_accounts.filter(a => !orgId || a.org_id === orgId);
      if (method === 'POST') {
        const body = JSON.parse(opt.body);
        store.owner_payment_accounts.push(...body);
        return json(201, body);
      }
      return json(200, hits);
    }
    // 4. payment_orders
    if (u.pathname.includes('/payment_orders')) {
      if (method === 'POST') {
        const body = JSON.parse(opt.body);
        store.payment_orders.push(...body);
        return json(201, body);
      }
      if (method === 'PATCH') {
        const id = (u.searchParams.get('id') || '').replace('eq.', '');
        const body = JSON.parse(opt.body);
        for (const o of store.payment_orders) {
          if (o.id === id) Object.assign(o, body);
        }
        return json(200, [{ id }]);
      }
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      return json(200, store.payment_orders.filter(o => !id || o.id === id));
    }
    // 5. payment_transactions
    if (u.pathname.includes('/payment_transactions')) {
      if (method === 'POST') {
        const body = JSON.parse(opt.body);
        store.payment_transactions.push(...body);
        return json(201, body);
      }
      return json(200, store.payment_transactions);
    }
    // 6. payment_settlements
    if (u.pathname.includes('/payment_settlements')) {
      if (method === 'POST') {
        const body = JSON.parse(opt.body);
        store.payment_settlements.push(...body);
        return json(201, body);
      }
      if (method === 'PATCH') {
        const id = (u.searchParams.get('id') || '').replace('eq.', '');
        const body = JSON.parse(opt.body);
        for (const s of store.payment_settlements) {
          if (s.id === id) Object.assign(s, body);
        }
        return json(200, [{ id }]);
      }
      return json(200, store.payment_settlements);
    }
    // 7. payment_refunds
    if (u.pathname.includes('/payment_refunds')) {
      if (method === 'POST') {
        const body = JSON.parse(opt.body);
        store.payment_refunds.push(...body);
        return json(201, body);
      }
      if (method === 'PATCH') {
        const id = (u.searchParams.get('id') || '').replace('eq.', '');
        const body = JSON.parse(opt.body);
        for (const r of store.payment_refunds) {
          if (r.id === id) Object.assign(r, body);
        }
        return json(200, [{ id }]);
      }
      const ordId = (u.searchParams.get('order_id') || '').replace('eq.', '');
      return json(200, store.payment_refunds.filter(r => !ordId || r.order_id === ordId));
    }
    // 8. payment_webhook_logs
    if (u.pathname.includes('/payment_webhook_logs')) {
      if (method === 'POST') {
        const body = JSON.parse(opt.body);
        store.payment_webhook_logs.push(...body);
        return json(201, body);
      }
      return json(200, store.payment_webhook_logs);
    }
    // 9. rpc/record_payment_atomic
    if (u.pathname.includes('/rpc/record_payment_atomic')) {
      const b = JSON.parse(opt.body);
      const exists = store.docs.find(d => d.data && d.data.idempotencyKey === b.p_idempotency_key);
      if (exists) {
        return json(200, { ok: true, idempotent_replay: true, pay_id: exists.id, receipt_no: exists.data.no, amount: b.p_amount });
      }
      const payDoc = {
        hostel_id: b.p_hostel_id,
        id: 'pay-' + b.p_idempotency_key,
        kind: 'pay',
        res_id: b.p_res_id,
        data: {
          amount: b.p_amount,
          ref: b.p_ref,
          idempotencyKey: b.p_idempotency_key,
          no: 'R-00001'
        }
      };
      store.docs.push(payDoc);
      // Settle invoice
      if (b.p_target_inv_ids && b.p_target_inv_ids[0]) {
        const inv = store.docs.find(d => d.id === b.p_target_inv_ids[0]);
        if (inv) inv.data.paid = (inv.data.paid || 0) + b.p_amount;
      }
      return json(200, { ok: true, idempotent_replay: false, receipt_no: 'R-00001', amount: b.p_amount });
    }
    // 10. auth & profiles
    if (u.pathname.includes('/auth/v1/user')) {
      const token = (opt.headers?.Authorization || '').replace('Bearer ', '');
      if (token === 'ownera') return json(200, { id: U_OWNERA });
      if (token === 'ownerb') return json(200, { id: U_OWNERB });
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
      if (uid === U_OWNERB) return json(200, [{ user_id: uid, org_id: ORG_B, hostel_id: null, role: 'owner', active: true }]);
      return json(200, []);
    }

    return json(404, { error: 'unmocked: ' + u.pathname });
  };

  return {
    store,
    cleanup() { global.fetch = origFetch; }
  };
}

let ipSeq = 100;
async function callPublic(sub, body, headers = {}) {
  let status = 200, out = null;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(o) { out = o; } };
  await publicHandler({
    method: 'POST',
    url: `/api/public?sub=${sub}`,
    headers: { 'x-forwarded-for': '127.0.0.' + (ipSeq++), ...headers },
    body
  }, res);
  return { status, out };
}

async function callAdmin(action, body, token = 'super') {
  let status = 200, out = null;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(o) { out = o; } };
  await adminHandler({
    method: 'POST',
    url: '/api/admin',
    headers: { 'x-forwarded-for': '127.0.0.' + (ipSeq++), authorization: 'Bearer ' + token },
    body: { action, ...body }
  }, res);
  return { status, out };
}

// ------------------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------------------

test('1. Payment order creation: generates valid Cashfree order and payment session with INR', async () => {
  const db = createMockDb();
  try {
    const res = await callPublic('create_payment_order', {
      hostel_id: H_A,
      res_id: RES_A1,
      inv_id: INV_A1,
      amount: 8000
    });
    assert.equal(res.status, 200);
    assert.equal(res.out.ok, true);
    assert.ok(res.out.order_id.startsWith('cf_'));
    assert.ok(res.out.payment_session_id.startsWith('session_'));
    assert.equal(res.out.amount, 8000);
    assert.equal(res.out.currency, 'INR');
    assert.equal(res.out.splits.length, 1);
    assert.equal(res.out.splits[0].vendor_id, 'vnd_ownera_123', 'Must route to Owner A vendor account');
  } finally {
    db.cleanup();
  }
});

test('2. Successful UPI payment: pay_session produces official UPI intent and dynamic QR payloads', async () => {
  const db = createMockDb();
  try {
    const ord = await callPublic('create_payment_order', {
      hostel_id: H_A,
      res_id: RES_A1,
      amount: 8000
    });
    const sessionRes = await callPublic('pay_session', {
      payment_session_id: ord.out.payment_session_id,
      channel: 'intent'
    });
    assert.equal(sessionRes.status, 200);
    assert.equal(sessionRes.out.ok, true);
    const p = sessionRes.out.data.data.payload;
    assert.ok(p.gpay.startsWith('upi://pay'));
    assert.ok(p.phonepe.startsWith('upi://pay'));
    assert.ok(p.paytm.startsWith('upi://pay'));
    assert.ok(p.bhim.startsWith('upi://pay'));
  } finally {
    db.cleanup();
  }
});

test('3. Failed payment: non-success webhook or status does not credit the ledger', async () => {
  const db = createMockDb();
  try {
    const payload = {
      event: 'PAYMENT_FAILED_WEBHOOK',
      data: {
        order: { order_id: 'cf_ord_fail_999' },
        payment: { cf_payment_id: 'pay_fail_999', payment_status: 'FAILED', payment_amount: 5000 }
      }
    };
    const sig = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(JSON.stringify(payload)).digest('hex');
    const res = await callPublic('webhook', payload, {
      'x-webhook-signature': sig,
      'x-webhook-timestamp': '1700000000'
    });
    assert.equal(res.status, 200);
    assert.equal(res.out.ok, false);
    assert.equal(res.out.status, 'failed');
    assert.equal(db.store.docs.some(d => d.kind === 'pay' && d.data.ref === 'pay_fail_999'), false);
  } finally {
    db.cleanup();
  }
});

test('4. Pending payment: order in PENDING status remains uncredited until confirmed', async () => {
  const db = createMockDb();
  try {
    const cfOrd = await Cashfree.createOrder({
      orderId: 'cf_ord_pending_101',
      orderAmount: 3000,
      customerDetails: { customer_id: RES_A1 }
    });
    // In mock store, order starts ACTIVE/PENDING before payment
    const vRes = await callPublic('verify_payment', { order_id: 'cf_ord_pending_101' });
    assert.equal(vRes.status, 200);
    assert.equal(vRes.out.verified, false);
    assert.equal(vRes.out.status, 'ACTIVE');
  } finally {
    db.cleanup();
  }
});

test('5. Cancelled payment: user drops checkout without mutation', async () => {
  const db = createMockDb();
  try {
    const payload = {
      event: 'PAYMENT_USER_DROPPED_WEBHOOK',
      data: {
        order: { order_id: 'cf_ord_drop_102' },
        payment: { cf_payment_id: 'pay_drop_102', payment_status: 'USER_DROPPED', payment_amount: 4000 }
      }
    };
    const sig = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(JSON.stringify(payload)).digest('hex');
    const res = await callPublic('webhook', payload, { 'x-webhook-signature': sig });
    assert.equal(res.status, 200);
    assert.equal(res.out.ok, false);
  } finally {
    db.cleanup();
  }
});

test('6. Duplicate payment submission: duplicate order with same idempotency is replayed cleanly', async () => {
  const db = createMockDb();
  try {
    const ord1 = await callPublic('create_payment_order', { hostel_id: H_A, res_id: RES_A1, inv_id: INV_A1, amount: 8000 });
    assert.equal(ord1.status, 200);

    // Pay order
    await Cashfree.payOrderSession({ paymentSessionId: ord1.out.payment_session_id });

    // Verify first time
    const v1 = await callPublic('verify_payment', { order_id: ord1.out.order_id });
    assert.equal(v1.status, 200);
    assert.equal(v1.out.verified, true);

    const payCountBefore = db.store.docs.filter(d => d.kind === 'pay').length;

    // Verify second time (duplicate callback / refresh)
    const v2 = await callPublic('verify_payment', { order_id: ord1.out.order_id });
    assert.equal(v2.status, 200);
    assert.equal(v2.out.verified, true);

    const payCountAfter = db.store.docs.filter(d => d.kind === 'pay').length;
    assert.equal(payCountAfter, payCountBefore, 'Duplicate verification must not create duplicate ledger entry');
  } finally {
    db.cleanup();
  }
});

test('7. Duplicate webhook delivery: identical webhook delivered twice does not duplicate financial credit', async () => {
  const db = createMockDb();
  try {
    const payload = {
      event: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: INV_A1 },
        payment: { cf_payment_id: 'cf_pay_dup_999', payment_status: 'SUCCESS', payment_amount: 8000, bank_reference: 'UTR112233' },
        customer_details: { customer_id: RES_A1 }
      },
      hostelId: H_A
    };
    const ts = '1700000100';
    const sig = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(ts + JSON.stringify(payload)).digest('hex');

    // First delivery
    const r1 = await callPublic('webhook', payload, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts });
    assert.equal(r1.status, 200);
    assert.equal(r1.out.ok, true);

    const countBefore = db.store.docs.filter(d => d.kind === 'pay').length;

    // Second duplicate retry delivery from gateway
    const r2 = await callPublic('webhook', payload, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts });
    assert.equal(r2.status, 200);
    assert.equal(r2.out.ok, true);
    assert.equal(r2.out.replay, true);

    const countAfter = db.store.docs.filter(d => d.kind === 'pay').length;
    assert.equal(countAfter, countBefore, 'Duplicate webhook retry must not increment payments count');
  } finally {
    db.cleanup();
  }
});

test('8. Invalid webhook signature: forged or missing signatures are rejected with 401', async () => {
  const db = createMockDb();
  try {
    const payload = { event: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: 'test' } } };

    // Missing signature
    const r1 = await callPublic('webhook', payload, {});
    assert.equal(r1.status, 401);

    // Tampered / forged signature
    const r2 = await callPublic('webhook', payload, { 'x-webhook-signature': '0000000000000000000000000000000000000000000000000000000000000000' });
    assert.equal(r2.status, 401);
  } finally {
    db.cleanup();
  }
});

test('9. Webhook replay attack: tampered payload with old signature fails signature check', async () => {
  const db = createMockDb();
  try {
    const legitPayload = { event: 'PAYMENT_SUCCESS_WEBHOOK', data: { payment: { payment_amount: 100 } } };
    const sig = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(JSON.stringify(legitPayload)).digest('hex');

    // Attacker modifies amount to ₹10,000 using old signature
    const tamperedPayload = { event: 'PAYMENT_SUCCESS_WEBHOOK', data: { payment: { payment_amount: 10000 } } };
    const r = await callPublic('webhook', tamperedPayload, { 'x-webhook-signature': sig });
    assert.equal(r.status, 401);
  } finally {
    db.cleanup();
  }
});

test('10. Incorrect amount rejection: order creation rejects negative, zero, and fractional paise amounts', async () => {
  const db = createMockDb();
  try {
    assert.equal((await callPublic('create_payment_order', { hostel_id: H_A, res_id: RES_A1, amount: -500 })).status, 400);
    assert.equal((await callPublic('create_payment_order', { hostel_id: H_A, res_id: RES_A1, amount: 0 })).status, 400);
    assert.equal((await callPublic('create_payment_order', { hostel_id: H_A, res_id: RES_A1, amount: 100.555 })).status, 400);
  } finally {
    db.cleanup();
  }
});

test('11. Incorrect order ID rejection: non-existent order verification fails gracefully', async () => {
  const db = createMockDb();
  try {
    const r = await callPublic('verify_payment', { order_id: 'cf_ord_non_existent_999' });
    assert.ok(r.status === 404 || r.status === 502);
  } finally {
    db.cleanup();
  }
});

test('12. Customer authorization: customer gets their own payment info', async () => {
  const db = createMockDb();
  try {
    const info = await callPublic('pay_info', { hostel_id: H_A, inv_id: INV_A1 });
    assert.equal(info.status, 200);
    assert.equal(info.out.resident.name, 'Aman Sharma');
    assert.equal(info.out.invoice.total, 8000);
    assert.equal(info.out.settlement.payee_name, 'Owner A Ventures');
  } finally {
    db.cleanup();
  }
});

test('13. Owner authorization: owner can view orders and configure bank account for their own org', async () => {
  const db = createMockDb();
  try {
    const r = await callAdmin('onboard_owner_vendor', {
      org_id: ORG_A,
      account_holder_name: 'Owner A Enterprises',
      bank_account_number: '123456789012',
      bank_ifsc: 'HDFC0001234'
    }, 'ownera');
    assert.equal(r.status, 200);
    assert.equal(r.out.ok, true);
    assert.equal(r.out.kyc_status, 'ACTIVE');
  } finally {
    db.cleanup();
  }
});

test('14. Cross-owner payment access isolation: Owner A cannot modify or onboard Owner B account', async () => {
  const db = createMockDb();
  try {
    // Owner A tries to onboard vendor for ORG_B
    const r = await callAdmin('onboard_owner_vendor', {
      org_id: ORG_B,
      account_holder_name: 'Attacker Account',
      bank_account_number: '999999999999',
      bank_ifsc: 'SBIN0001234'
    }, 'ownera');
    assert.equal(r.status, 403, 'Cross-owner onboarding must be refused with 403');
  } finally {
    db.cleanup();
  }
});

test('15. Payment status refresh: refreshes and idempotently returns existing confirmation', async () => {
  const db = createMockDb();
  try {
    const ord = await callPublic('create_payment_order', { hostel_id: H_A, res_id: RES_A1, amount: 8000 });
    await Cashfree.payOrderSession({ paymentSessionId: ord.out.payment_session_id });

    const ref1 = await callPublic('verify_payment', { order_id: ord.out.order_id });
    assert.equal(ref1.out.verified, true);
    assert.equal(ref1.out.status, 'SUCCESS');

    const ref2 = await callPublic('verify_payment', { order_id: ord.out.order_id });
    assert.equal(ref2.out.verified, true);
    assert.equal(ref2.out.status, 'SUCCESS');
  } finally {
    db.cleanup();
  }
});

test('16. Delayed webhook handling: webhook arriving after user navigation settles invoice', async () => {
  const db = createMockDb();
  try {
    const payload = {
      event: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: INV_A1 },
        payment: { cf_payment_id: 'cf_pay_delayed_777', payment_status: 'SUCCESS', payment_amount: 8000 },
        customer_details: { customer_id: RES_A1 }
      },
      hostelId: H_A
    };
    const sig = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(JSON.stringify(payload)).digest('hex');
    const res = await callPublic('webhook', payload, { 'x-webhook-signature': sig });
    assert.equal(res.status, 200);
    assert.equal(res.out.ok, true);

    const inv = db.store.docs.find(d => d.id === INV_A1);
    assert.equal(inv.data.paid, 8000, 'Invoice balance must be fully paid');
  } finally {
    db.cleanup();
  }
});

test('17. Browser closed after payment: server-side verify_payment recovers payment without user interaction', async () => {
  const db = createMockDb();
  try {
    const ord = await callPublic('create_payment_order', { hostel_id: H_B, res_id: RES_B1, inv_id: INV_B1, amount: 9500 });
    // User pays at UPI app and closes browser window
    await Cashfree.payOrderSession({ paymentSessionId: ord.out.payment_session_id });

    // Background process or returning user verifies order
    const rec = await callPublic('verify_payment', { order_id: ord.out.order_id });
    assert.equal(rec.out.verified, true);
    assert.equal(rec.out.amount, 9500);

    const inv = db.store.docs.find(d => d.id === INV_B1);
    assert.equal(inv.data.paid, 9500);
  } finally {
    db.cleanup();
  }
});

test('18. Database failure recovery: server responds gracefully on database network timeout', async () => {
  const origFetch = global.fetch;
  global.fetch = async () => { throw new Error('DB Connection Timeout'); };
  try {
    const r = await callPublic('pay_info', { hostel_id: H_A, inv_id: INV_A1 });
    // pay_info handles database failure gracefully and returns safe fallback
    assert.equal(r.status, 200);
  } finally {
    global.fetch = origFetch;
  }
});

test('19. Refund initiation: admin initiates authorized refund via Cashfree API', async () => {
  const db = createMockDb();
  try {
    const ord = await callPublic('create_payment_order', { hostel_id: H_A, res_id: RES_A1, amount: 8000 });
    await Cashfree.payOrderSession({ paymentSessionId: ord.out.payment_session_id });
    await callPublic('verify_payment', { order_id: ord.out.order_id });

    const ref = await callAdmin('initiate_refund', {
      order_id: ord.out.order_id,
      amount: 4000,
      reason: 'Partial deposit return upon room change'
    }, 'ownera');

    assert.equal(ref.status, 200);
    assert.equal(ref.out.ok, true);
    assert.equal(ref.out.amount, 4000);
    assert.equal(ref.out.status, 'SUCCESS');
  } finally {
    db.cleanup();
  }
});

test('20. Refund verification: over-refund attempt exceeding original order amount is rejected', async () => {
  const db = createMockDb();
  try {
    const ord = await callPublic('create_payment_order', { hostel_id: H_A, res_id: RES_A1, amount: 8000 });
    await Cashfree.payOrderSession({ paymentSessionId: ord.out.payment_session_id });
    await callPublic('verify_payment', { order_id: ord.out.order_id });

    const badRef = await callAdmin('initiate_refund', {
      order_id: ord.out.order_id,
      amount: 15000,
      reason: 'Exceeding refund'
    }, 'ownera');

    assert.equal(badRef.status, 400);
    assert.match(badRef.out.error, /cannot exceed original order amount/);
  } finally {
    db.cleanup();
  }
});

test('21. Settlement status updates: TRANSFER_SUCCESS webhook marks Easy Split settlement as SETTLED', async () => {
  const db = createMockDb();
  try {
    // Seed initial settlement record
    db.store.payment_settlements.push({
      id: 'stl_cf_ord_901_vnd_ownera_123',
      vendor_id: 'vnd_ownera_123',
      settlement_amount: 8000,
      status: 'INITIATED'
    });

    const transferPayload = {
      type: 'TRANSFER_SUCCESS',
      data: {
        settlement_id: 'stl_cf_ord_901_vnd_ownera_123',
        utr: 'BANKUTR987654321',
        amount: 8000
      }
    };
    const sig = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(JSON.stringify(transferPayload)).digest('hex');
    const res = await callPublic('webhook', transferPayload, { 'x-webhook-signature': sig });

    assert.equal(res.status, 200);
    const updated = db.store.payment_settlements.find(s => s.id === 'stl_cf_ord_901_vnd_ownera_123');
    assert.equal(updated.status, 'SETTLED');
    assert.equal(updated.utr, 'BANKUTR987654321');
  } finally {
    db.cleanup();
  }
});

test('22. Reconciliation: reconcile_payments checks pending orders and settles missed webhooks', async () => {
  const db = createMockDb();
  try {
    // Seed pending order that was paid at Cashfree but missed by webhook
    const cfOrd = await Cashfree.createOrder({
      orderId: 'cf_ord_reconcile_888',
      orderAmount: 8000,
      customerDetails: { customer_id: RES_A1 }
    });
    await Cashfree.payOrderSession({ paymentSessionId: cfOrd.payment_session_id });

    db.store.payment_orders.push({
      id: 'cf_ord_reconcile_888',
      hostel_id: H_A,
      org_id: ORG_A,
      res_id: RES_A1,
      inv_id: INV_A1,
      order_amount: 8000,
      status: 'PENDING'
    });

    const r = await callAdmin('reconcile_payments', { hostel_id: H_A }, 'ownera');
    assert.equal(r.status, 200);
    assert.equal(r.out.ok, true);
    assert.equal(r.out.resolved_count, 1);

    const ordDoc = db.store.payment_orders.find(o => o.id === 'cf_ord_reconcile_888');
    assert.equal(ordDoc.status, 'SUCCESS');
  } finally {
    db.cleanup();
  }
});

test('23. Concurrency: multiple simultaneous payment verification calls succeed idempotently', async () => {
  const db = createMockDb();
  try {
    const ord = await callPublic('create_payment_order', { hostel_id: H_A, res_id: RES_A1, amount: 8000 });
    await Cashfree.payOrderSession({ paymentSessionId: ord.out.payment_session_id });

    // 5 simultaneous verification calls
    const promises = Array.from({ length: 5 }, () => callPublic('verify_payment', { order_id: ord.out.order_id }));
    const results = await Promise.all(promises);

    for (const r of results) {
      assert.equal(r.status, 200);
      assert.equal(r.out.verified, true);
    }
  } finally {
    db.cleanup();
  }
});

test('24. Multi-owner independent settlement: Owner A payment routes to Owner A vendor, Owner B to Owner B vendor', async () => {
  const db = createMockDb();
  try {
    // 1. Order for Owner A
    const ordA = await callPublic('create_payment_order', {
      hostel_id: H_A,
      res_id: RES_A1,
      inv_id: INV_A1,
      amount: 8000
    });
    assert.equal(ordA.out.splits[0].vendor_id, 'vnd_ownera_123', 'Owner A payment MUST allocate to Owner A vendor');

    // 2. Order for Owner B
    const ordB = await callPublic('create_payment_order', {
      hostel_id: H_B,
      res_id: RES_B1,
      inv_id: INV_B1,
      amount: 9500
    });
    assert.equal(ordB.out.splits[0].vendor_id, 'vnd_ownerb_456', 'Owner B payment MUST allocate to Owner B vendor');

    // Assert absolute non-mingling
    assert.notEqual(ordA.out.splits[0].vendor_id, ordB.out.splits[0].vendor_id, 'Owner A and Owner B must have independent vendor accounts');
  } finally {
    db.cleanup();
  }
});

test('25. Signature verification: validates official Cashfree Base64 HMAC-SHA256 signature format & rejects expired timestamps', async () => {
  const secret = 'whsec_prod_live_mock_secret_key_12345';
  const payload = JSON.stringify({
    event: 'PAYMENT_SUCCESS_WEBHOOK',
    data: { order: { order_id: 'cf_ord_sec_001' }, payment: { cf_payment_id: 'pay_sec_001', payment_status: 'SUCCESS' } }
  });
  const nowTs = String(Math.floor(Date.now() / 1000));

  // Official Cashfree format: Base64(HMAC-SHA256(timestamp + payload, secret))
  const validBase64Sig = crypto.createHmac('sha256', secret).update(nowTs + payload).digest('base64');

  // 1. Valid Base64 signature verification
  const isValid = Cashfree.verifyWebhookSignature({
    rawBody: payload,
    timestamp: nowTs,
    signature: validBase64Sig,
    secret,
    checkTimestampDrift: true
  });
  assert.equal(isValid, true, 'Official Cashfree Base64 signature must be valid');

  // 2. Tampered payload rejection
  const tamperedPayload = JSON.stringify({ event: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: 'cf_ord_sec_002' } } });
  const isTamperedValid = Cashfree.verifyWebhookSignature({
    rawBody: tamperedPayload,
    timestamp: nowTs,
    signature: validBase64Sig,
    secret,
    checkTimestampDrift: true
  });
  assert.equal(isTamperedValid, false, 'Tampered payload must fail signature check');

  // 3. Expired timestamp drift rejection (10 minutes old > 5 minute window)
  const expiredTs = String(Math.floor((Date.now() - 600000) / 1000));
  const expiredSig = crypto.createHmac('sha256', secret).update(expiredTs + payload).digest('base64');
  const isExpiredValid = Cashfree.verifyWebhookSignature({
    rawBody: payload,
    timestamp: expiredTs,
    signature: expiredSig,
    secret,
    checkTimestampDrift: true
  });
  assert.equal(isExpiredValid, false, 'Expired timestamp (>5 min) must fail verification to prevent replay');
});

test('26. Unified idempotency: simultaneous verify_payment and webhook sharing cf-${paymentId} prevent double ledger crediting', async () => {
  const db = createMockDb();
  try {
    const ord = await callPublic('create_payment_order', {
      hostel_id: H_A,
      res_id: RES_A1,
      inv_id: INV_A1,
      amount: 8000
    });
    assert.equal(ord.status, 200);

    // Resident completes checkout on Cashfree
    await Cashfree.payOrderSession({ paymentSessionId: ord.out.payment_session_id });
    const cfPay = (await Cashfree.getOrderPayments(ord.out.order_id))[0];
    const paymentId = cfPay.cf_payment_id;

    // Both user return browser request and Cashfree webhook callback arrive simultaneously
    const webhookPayload = {
      event: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: ord.out.order_id },
        payment: { cf_payment_id: paymentId, payment_status: 'SUCCESS', payment_amount: 8000, bank_reference: 'UTR_RACE_CONCURRENT' },
        customer_details: { customer_id: RES_A1 }
      },
      hostelId: H_A
    };
    const ts = String(Math.floor(Date.now() / 1000));
    const rawWhBody = JSON.stringify(webhookPayload);
    const sig = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(ts + rawWhBody).digest('base64');

    const [verifyRes, webhookRes] = await Promise.all([
      callPublic('verify_payment', { order_id: ord.out.order_id }),
      callPublic('webhook', webhookPayload, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts })
    ]);

    assert.equal(verifyRes.status, 200);
    assert.equal(webhookRes.status, 200);

    // Ledger documents check: exactly ONE pay document created with unified cf-${paymentId}
    const payDocs = db.store.docs.filter(d => d.kind === 'pay' && d.data && d.data.ref === paymentId);
    assert.equal(payDocs.length, 1, 'Only one payment doc should exist in ledger despite concurrent arrival');
    assert.equal(payDocs[0].data.idempotencyKey, `cf-${paymentId}`);

    // Invoice paid balance must equal 8000, NOT double-credited to 16000
    const inv = db.store.docs.find(d => d.id === INV_A1);
    assert.equal(inv.data.paid, 8000, 'Invoice balance must be credited exactly once');
  } finally {
    db.cleanup();
  }
});

test('27. Cumulative refund protection: prevents multiple partial refunds from exceeding order amount', async () => {
  const db = createMockDb();
  try {
    const ord = await callPublic('create_payment_order', { hostel_id: H_A, res_id: RES_A1, amount: 10000 });
    await Cashfree.payOrderSession({ paymentSessionId: ord.out.payment_session_id });
    await callPublic('verify_payment', { order_id: ord.out.order_id });

    // Refund 1: 4,000 -> Success (Remaining: 6,000)
    const r1 = await callAdmin('initiate_refund', { order_id: ord.out.order_id, amount: 4000, reason: 'Partial 1' }, 'ownera');
    assert.equal(r1.status, 200);
    assert.equal(r1.out.ok, true);

    // Refund 2: 4,000 -> Success (Remaining: 2,000)
    const r2 = await callAdmin('initiate_refund', { order_id: ord.out.order_id, amount: 4000, reason: 'Partial 2' }, 'ownera');
    assert.equal(r2.status, 200);
    assert.equal(r2.out.ok, true);

    // Refund 3: 3,000 -> Rejection! 4000 + 4000 + 3000 = 11,000 > 10,000
    const r3 = await callAdmin('initiate_refund', { order_id: ord.out.order_id, amount: 3000, reason: 'Over refund attempt' }, 'ownera');
    assert.equal(r3.status, 400);
    assert.match(r3.out.error, /cannot exceed original order amount/);

    // Refund 4: 2,000 -> Success (Remaining: 0, Total refunded: 10,000)
    const r4 = await callAdmin('initiate_refund', { order_id: ord.out.order_id, amount: 2000, reason: 'Final balance refund' }, 'ownera');
    assert.equal(r4.status, 200);
    assert.equal(r4.out.ok, true);

    // Refund 5: 1 -> Rejection! Fully refunded already
    const r5 = await callAdmin('initiate_refund', { order_id: ord.out.order_id, amount: 1, reason: 'Post full refund' }, 'ownera');
    assert.equal(r5.status, 400);
    assert.match(r5.out.error, /cannot exceed original order amount|Cannot refund order with status REFUNDED/);
  } finally {
    db.cleanup();
  }
});

test('28. Refund webhook processing: REFUND_STATUS_WEBHOOK updates refund, marks order PARTIALLY_REFUNDED, and reduces invoice balance', async () => {
  const db = createMockDb();
  try {
    const orderId = 'cf_ord_wh_rfnd_101';
    db.store.payment_orders.push({
      id: orderId,
      hostel_id: H_A,
      org_id: ORG_A,
      res_id: RES_A1,
      inv_id: INV_A1,
      order_amount: 8000,
      status: 'SUCCESS'
    });
    // Invoice currently marked paid: 8000
    const inv = db.store.docs.find(d => d.id === INV_A1);
    inv.data.paid = 8000;

    // Seed pending refund record
    db.store.payment_refunds.push({
      id: 'rfnd_async_001',
      order_id: orderId,
      refund_amount: 3000,
      status: 'PENDING'
    });

    const refundPayload = {
      event: 'REFUND_STATUS_WEBHOOK',
      data: {
        refund: {
          order_id: orderId,
          refund_id: 'rfnd_async_001',
          cf_refund_id: 'cfrfnd_gateway_1122',
          refund_status: 'SUCCESS',
          refund_amount: 3000
        }
      }
    };
    const ts = String(Math.floor(Date.now() / 1000));
    const rawWhBody = JSON.stringify(refundPayload);
    const sig = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(ts + rawWhBody).digest('base64');

    const res = await callPublic('webhook', refundPayload, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts });
    assert.equal(res.status, 200);
    assert.equal(res.out.ok, true);

    // Verify payment_refunds table updated
    const rf = db.store.payment_refunds.find(r => r.id === 'rfnd_async_001');
    assert.equal(rf.status, 'SUCCESS');
    assert.equal(rf.cf_refund_id, 'cfrfnd_gateway_1122');

    // Verify order marked PARTIALLY_REFUNDED
    const ord = db.store.payment_orders.find(o => o.id === orderId);
    assert.equal(ord.status, 'PARTIALLY_REFUNDED');

    // Verify invoice paid balance reduced from 8000 to 5000
    assert.equal(inv.data.paid, 5000);
  } finally {
    db.cleanup();
  }
});

test('29. Return URL verification: pay_info retrieves completed transaction details for returning residents', async () => {
  const db = createMockDb();
  try {
    const ord = await callPublic('create_payment_order', { hostel_id: H_A, res_id: RES_A1, inv_id: INV_A1, amount: 8000 });
    await Cashfree.payOrderSession({ paymentSessionId: ord.out.payment_session_id });
    await callPublic('verify_payment', { order_id: ord.out.order_id });

    // Resident returns to pay.html?order_id=...
    const info = await callPublic('pay_info', { hostel_id: H_A, order_id: ord.out.order_id });
    assert.equal(info.status, 200);
    assert.equal(info.out.ok, true);
    assert.equal(info.out.order.status, 'SUCCESS');
    assert.ok(info.out.transaction, 'Transaction info must be populated for completed order');
    assert.equal(info.out.transaction.amount, 8000);
    assert.equal(info.out.transaction.status, 'SUCCESS');
  } finally {
    db.cleanup();
  }
});
