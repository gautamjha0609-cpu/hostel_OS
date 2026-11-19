// Payment Webhook Comprehensive Verification Test Suite
// Verifies HMAC signature, amount matching, duplicate prevention, delayed callbacks, and reversals.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const vm = require('vm');
const fs = require('fs');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service';
const TEST_SECRET = 'whsec_sandbox_test_secret_key_998877665544332211';

function sign(payload, secret = TEST_SECRET) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

function bootDomain(role = 'owner') {
  const mem = {};
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, URL, URLSearchParams, Date, Math, JSON, TextEncoder, crypto, addEventListener() {}, removeEventListener() {},
    localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, key: () => null, length: 0 },
    navigator: { onLine: true, vibrate() {} },
    location: { href: 'https://app.test/index.html', hash: '', origin: 'https://app.test', pathname: '/index.html' },
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {} }, body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} }, createElement: () => ({ setAttribute() {}, appendChild() {}, querySelector: () => null }) },
    matchMedia: () => ({ matches: false }),
  };
  ctx.window = ctx;
  ctx.window.HOSTELOS_CONFIG = {};
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js', 'xlsx.js', 'report.js', 'pwa.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`toast = () => {}; globalThis.T = {
    Store, can, activeRes, resById, openInv, invBal, addInvoice, recordPayment, reversePayment, payments,
    processVerifiedPaymentWebhook, S, Report, today
  };`, ctx);

  const T = ctx.T;
  const S = T.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'o1', modules: {}, status: 'active', owner_name: 'Owner Person', phone: '9876500001' }];
  S.hostels = [{ id: 'h1', org_id: 'o1', name: 'Sunrise PG', modules: {}, settings: {} }];
  S.ctx = { key: 'k', role, hostelId: 'h1', orgId: 'o1', perms: [], deny: [] };
  S.put('room', { id: 'rm-101', no: '101', beds: [{ id: 'A', status: 'occ' }], rent: 8000 });
  S.put('res', { id: 'res-1', name: 'Aman', roomId: 'rm-101', bed: 'A', rent: 8000, status: 'active', checkIn: T.today(), credit: 0, deposit: 10000, depositPaid: 10000 });

  return T;
}

test('webhook: rejects missing or invalid HMAC signature', () => {
  const T = bootDomain();
  const payload = {
    entity: { id: 'pay_rzp_test_101', amount: 800000, currency: 'INR', status: 'captured' },
    notes: { resId: 'res-1' }
  };

  // Missing signature
  assert.throws(() => {
    T.processVerifiedPaymentWebhook({ provider: 'razorpay', event: 'payment.captured', payload, signature: '', secret: TEST_SECRET });
  }, /Missing webhook signature/);

  // Forged signature
  assert.throws(() => {
    T.processVerifiedPaymentWebhook({ provider: 'razorpay', event: 'payment.captured', payload, signature: 'invalid_forged_signature', secret: TEST_SECRET });
  }, /Invalid webhook signature/);
});

test('webhook: successfully processes valid Razorpay payment and allocates to invoice', () => {
  const T = bootDomain();
  const res = T.activeRes()[0];
  const inv = T.addInvoice({ resId: res.id, amount: 8000, title: 'Rent Nov 2026', type: 'rent' });

  const payload = {
    entity: { id: 'pay_rzp_test_201', amount: 800000, currency: 'INR', status: 'captured' },
    notes: { resId: res.id, invId: inv.id }
  };
  const signature = sign(payload);

  const res1 = T.processVerifiedPaymentWebhook({
    provider: 'razorpay',
    event: 'payment.captured',
    payload,
    signature,
    secret: TEST_SECRET
  });

  assert.equal(res1.ok, true);
  assert.equal(res1.replay, false);
  assert.equal(res1.pay.amount, 8000);
  assert.equal(res1.pay.ref, 'pay_rzp_test_201');

  // Verify invoice balance is now 0
  assert.equal(T.invBal(T.Store.get(inv.id)), 0);
});

test('webhook: duplicate callback is safely replayed without duplicate ledger entry', () => {
  const T = bootDomain();
  const res = T.activeRes()[0];
  const inv = T.addInvoice({ resId: res.id, amount: 5000, title: 'Electricity Nov 2026', type: 'electricity' });

  const payload = {
    entity: { id: 'pay_rzp_test_301', amount: 500000, currency: 'INR', status: 'captured' },
    notes: { resId: res.id, invId: inv.id }
  };
  const signature = sign(payload);

  // First callback
  const first = T.processVerifiedPaymentWebhook({ provider: 'razorpay', event: 'payment.captured', payload, signature, secret: TEST_SECRET });
  assert.equal(first.ok, true);
  assert.equal(first.replay, false);

  const countBefore = T.Store.all('pay').length;

  // Delayed duplicate retry callback from gateway
  const second = T.processVerifiedPaymentWebhook({ provider: 'razorpay', event: 'payment.captured', payload, signature, secret: TEST_SECRET });
  assert.equal(second.ok, true);
  assert.equal(second.replay, true);

  const countAfter = T.Store.all('pay').length;
  assert.equal(countAfter, countBefore, 'Duplicate webhook must not create another payment row');
});

test('webhook: partial payment amount matching correctly updates invoice balance', () => {
  const T = bootDomain();
  const res = T.activeRes()[0];
  const inv = T.addInvoice({ resId: res.id, amount: 8000, title: 'Rent Dec 2026', type: 'rent' });

  // Webhook for partial payment of ₹5,000 against ₹8,000 invoice
  const payload = {
    entity: { id: 'pay_rzp_partial_501', amount: 500000, currency: 'INR', status: 'captured' },
    notes: { resId: res.id, invId: inv.id }
  };
  const signature = sign(payload);

  const res1 = T.processVerifiedPaymentWebhook({
    provider: 'razorpay',
    event: 'payment.captured',
    payload,
    signature,
    secret: TEST_SECRET
  });

  assert.equal(res1.ok, true);
  assert.equal(res1.pay.amount, 5000);
  assert.equal(T.invBal(T.Store.get(inv.id)), 3000, 'Remaining balance must be ₹3,000');
});

test('webhook: overpayment amount matching settles invoice and allocates credit', () => {
  const T = bootDomain();
  const res = T.activeRes()[0];
  const inv = T.addInvoice({ resId: res.id, amount: 3000, title: 'Electricity Dec 2026', type: 'electricity' });

  // Webhook for ₹5,000 against ₹3,000 invoice (overpayment of ₹2,000)
  const payload = {
    entity: { id: 'pay_rzp_over_601', amount: 500000, currency: 'INR', status: 'captured' },
    notes: { resId: res.id, invId: inv.id }
  };
  const signature = sign(payload);

  const res1 = T.processVerifiedPaymentWebhook({
    provider: 'razorpay',
    event: 'payment.captured',
    payload,
    signature,
    secret: TEST_SECRET
  });

  assert.equal(res1.ok, true);
  assert.equal(res1.pay.amount, 5000);
  assert.equal(T.invBal(T.Store.get(inv.id)), 0, 'Invoice must be fully settled');
  assert.equal(T.Store.get(res.id).credit, 2000, 'Overpaid ₹2,000 must be added to resident credit');
});

test('webhook: processes Cashfree sandbox webhook format', () => {
  const T = bootDomain();
  const res = T.activeRes()[0];
  const inv = T.addInvoice({ resId: res.id, amount: 4500, title: 'Maintenance Dec 2026', type: 'rent' });

  const cfPayload = {
    data: {
      order: { order_id: inv.id },
      payment: {
        cf_payment_id: 'cf_pay_sandbox_701',
        payment_amount: 4500,
        payment_status: 'SUCCESS'
      }
    },
    notes: { resId: res.id }
  };
  const signature = sign(cfPayload);

  const res1 = T.processVerifiedPaymentWebhook({
    provider: 'cashfree',
    event: 'PAYMENT_SUCCESS_WEBHOOK',
    payload: cfPayload,
    signature,
    secret: TEST_SECRET
  });

  assert.equal(res1.ok, true);
  assert.equal(res1.pay.amount, 4500);
  assert.equal(res1.pay.ref, 'cf_pay_sandbox_701');
  assert.equal(T.invBal(T.Store.get(inv.id)), 0);
});

test('webhook: ignores non-success webhook event without mutating ledger', () => {
  const T = bootDomain();
  const res = T.activeRes()[0];
  const payload = {
    entity: { id: 'pay_rzp_failed_401', amount: 800000, currency: 'INR', status: 'failed' },
    notes: { resId: res.id }
  };
  const signature = sign(payload);

  const res1 = T.processVerifiedPaymentWebhook({ provider: 'razorpay', event: 'payment.failed', payload, signature, secret: TEST_SECRET });
  assert.equal(res1.ok, false);
  assert.equal(res1.status, 'failed');
});

test('webhook & reversal: reversed payment is unwound and excluded from cash flow reports', () => {
  const T = bootDomain();
  const res = T.activeRes()[0];
  const inv = T.addInvoice({ resId: res.id, amount: 6000, title: 'Rent Dec 2026', type: 'rent' });

  const payload = {
    entity: { id: 'pay_rzp_test_501', amount: 600000, currency: 'INR', status: 'captured' },
    notes: { resId: res.id, invId: inv.id }
  };
  const res1 = T.processVerifiedPaymentWebhook({
    provider: 'razorpay',
    event: 'payment.captured',
    payload,
    signature: sign(payload),
    secret: TEST_SECRET
  });

  const payId = res1.pay.id;
  assert.equal(T.invBal(T.Store.get(inv.id)), 0);

  // Now bank webhook sends a dispute / reversal
  T.reversePayment(payId, 'Bank chargeback / reversal dispute');

  // Verify invoice balance is restored to 6000
  assert.equal(T.invBal(T.Store.get(inv.id)), 6000);

  // Verify excluded from payments()
  const activePayments = T.payments();
  assert.equal(activePayments.some(p => p.id === payId), false);

  // Verify excluded from financial reports
  const rep = T.Report.compute(T.today(), T.today());
  assert.equal(rep.pays.some(p => p.id === payId), false);
});
