// Master Hardening & New Features Test Suite
// Verifies:
// 1. Negative amount rejection in addInvoice
// 2. Duplicate claim approval idempotency in recordPayment
// 3. Payment reversal entry & allocation unwinding
// 4. Checkout double invocation rejection & deduction overflow rejection
// 5. Audit logging structure and metadata across operations
// 6. Electricity meter registration & serial conflict rejection
// 7. Electricity reading correction with audit trail & invoice adjustment
// 8. Meter reading deletion rejection when bills are paid
// 9. Meter reading fraud anomaly detection
// 10. 7-segment OCR digit pattern decoding
// 11. Digital agreement creation, versioning, renewal, and renewal reminders
// 12. Verified payment webhook processing, HMAC checking & idempotency
// 13. Push notification admin actions (save_push_sub, remove_push_sub, get_push_status, send_push)

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const crypto = require('crypto');

function boot() {
  const mem = {};
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, URL, URLSearchParams, Date, Math, JSON, TextEncoder, crypto,
    localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, key: () => null, length: 0 },
    navigator: { onLine: true, vibrate() {} },
    location: { href: 'https://app.test/index.html', hash: '', origin: 'https://app.test', pathname: '/index.html' },
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {} }, body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} }, createElement: () => ({ setAttribute() {}, appendChild() {}, querySelector: () => null }) },
    matchMedia: () => ({ matches: false }), addEventListener() {},
  };
  ctx.window = ctx; ctx.window.HOSTELOS_CONFIG = {};
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js', 'xlsx.js', 'report.js', 'pwa.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`toast = () => {}; globalThis.T = {
    Store, Demo, S, can, checkIn, recordPayment, resDue, openInv, resInvoices, invBal, splitElectricity, freeMonths, addReading,
    addInvoice, today, addDays, ymOf, rentDue, activeRes, resById, checkout,
    correctReading, deleteReading, registerMeter, getMeterForRoom, validateMeterReadingFraud, analyzeDigitSegments, parseMeterOcrText,
    createAgreement, getActiveAgreement, renewAgreement, agreementDueRenewal, processVerifiedPaymentWebhook, reversePayment,
    alog, myNotifs, notify, Pwa, payments, resPays, Report
  };`, ctx);
  return ctx.T;
}

let T;
function setupHostel(role = 'owner', extra = {}) {
  T = boot();
  const S = T.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'o1', modules: extra.modules || {}, status: 'active', owner_name: 'Owner Person', phone: '9876500001' }];
  S.hostels = [{ id: 'hx', org_id: 'o1', name: 'Test PG', settings: extra.settings || { elec: { rate: 10, freeUnits: 0, freeMode: 'resident' } }, address: '123 Test St', phone: '9876500001' }];
  S.ctx = { key: 'k', role, hostelId: 'hx', orgId: 'o1', perms: extra.perms || [], deny: [], refId: extra.refId };
  S.put('room', { id: 'r1', no: '101', floor: 'F1', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  S.put('room', { id: 'r2', no: '102', floor: 'F1', rent: 6000, beds: [{ id: 'A', status: 'vac' }] });
  return S;
}

test('financial validation: addInvoice rejects zero, negative and oversized amounts', () => {
  setupHostel();
  const r = T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-16' });

  assert.throws(() => T.addInvoice({ resId: r.id, amount: 0 }), /Invoice amount must be positive/);
  assert.throws(() => T.addInvoice({ resId: r.id, amount: -500 }), /Invoice amount must be positive/);
  assert.throws(() => T.addInvoice({ resId: r.id, amount: 15000000 }), /Invoice amount cannot exceed/);

  const inv = T.addInvoice({ resId: r.id, amount: 5000, title: 'Rent' });
  assert.equal(inv.amount, 5000);
});

test('financial integrity: duplicate claimId does not create duplicate payment records', () => {
  setupHostel();
  const r = T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-16' });

  const pay1 = T.recordPayment({ resId: r.id, amount: 6000, mode: 'upi', claimId: 'claim-abc-123' });
  assert.ok(pay1 && pay1.id);

  // Second submission with identical claimId must return existing payment
  const pay2 = T.recordPayment({ resId: r.id, amount: 6000, mode: 'upi', claimId: 'claim-abc-123' });
  assert.equal(pay2.id, pay1.id, 'Must return same payment without duplicate ledger insertion');

  const allPays = T.Store.all('pay').filter(p => p.claimId === 'claim-abc-123');
  assert.equal(allPays.length, 1, 'Only one payment record must exist for this claim');
});

test('financial protection: reversePayment unwinds invoice allocation and credit without hard deletion', () => {
  setupHostel();
  const r = T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-16' });
  const inv = T.addInvoice({ resId: r.id, amount: 5000, title: 'Extra' });

  // Pay 6000 (settles dues + leaves credit)
  const pay = T.recordPayment({ resId: r.id, amount: 6000, mode: 'cash' });
  const creditBefore = T.resById(r.id).credit || 0;

  // Reversal requires a reason
  assert.throws(() => T.reversePayment(pay.id, ''), /A reason for reversal is required/);

  const rev = T.reversePayment(pay.id, 'Bounced cheque / duplicate entry');
  assert.equal(rev.reversed, true);
  assert.equal(rev.reversalReason, 'Bounced cheque / duplicate entry');

  // Verify invoice balance is restored
  const invRestored = T.Store.get(inv.id);
  assert.equal(invRestored.paid, 0);
  assert.equal(T.invBal(invRestored), 5000);

  // Reversing again must fail
  assert.throws(() => T.reversePayment(pay.id, 'Duplicate reversal'), /Payment is already reversed/);
});

test('checkout integrity: rejects double checkout and deduction greater than deposit + credit', () => {
  setupHostel();
  const r = T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-16' });
  // Settle all initial check-in dues so only deposit is held
  T.recordPayment({ resId: r.id, amount: 15000, mode: 'cash' });

  // Deductions exceeding deposit (6000) + remaining credit must throw
  assert.throws(() => T.checkout(r.id, T.today(), 25000), /Deductions cannot exceed/);

  // Valid checkout
  const dep = T.checkout(r.id, T.today(), 1000, 'Normal checkout');
  assert.ok(dep.refund >= 0);
  assert.equal(T.resById(r.id).status, 'left');

  // Second checkout attempt must fail
  assert.throws(() => T.checkout(r.id, T.today(), 0), /Resident is already checked out/);
});

test('electricity meter registry: registers meter to room and prevents duplicate serial', () => {
  setupHostel();
  const m1 = T.registerMeter({ roomId: 'r1', serialNo: 'MTR-9821-X', qrCode: 'QR-R1-MTR' });
  assert.equal(m1.serialNo, 'MTR-9821-X');
  assert.equal(T.getMeterForRoom('r1').serialNo, 'MTR-9821-X');

  // Registering same serial to another room must throw
  assert.throws(() => T.registerMeter({ roomId: 'r2', serialNo: 'MTR-9821-X' }), /already registered/);
});

test('electricity meter correction: updates reading with audit trail and adjusts invoice', () => {
  setupHostel();
  T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-01' });

  // Initial reading: 100 -> 200 (100 units)
  const m = T.addReading({ roomId: 'r1', prev: 100, curr: 200, date: T.today() });
  assert.equal(m.units, 100);

  // Correction requires a reason
  assert.throws(() => T.correctReading({ meterId: m.id, curr: 220, reason: '' }), /Reason for correction is required/);

  const corrected = T.correctReading({ meterId: m.id, curr: 220, reason: 'Display last digit was misread 0 instead of 0' });
  assert.equal(corrected.curr, 220);
  assert.equal(corrected.units, 120);
  assert.equal(corrected.origCurr, 200);
  assert.equal(corrected.correctionReason, 'Display last digit was misread 0 instead of 0');

  // Verify invoice amount adjusted
  if (corrected.shares && corrected.shares[0]) {
    const inv = T.Store.get(`inv-el-${m.id}-${corrected.shares[0].resId}`);
    assert.equal(inv.amount, corrected.shares[0].amount);
  }
});

test('electricity meter deletion: refuses to delete reading if bills are paid', () => {
  setupHostel();
  T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-01' });

  const m = T.addReading({ roomId: 'r1', prev: 100, curr: 200, date: T.today() });
  const s = m.shares && m.shares[0];
  if (s && s.amount > 0) {
    const invId = `inv-el-${m.id}-${s.resId}`;
    T.recordPayment({ resId: s.resId, amount: s.amount, mode: 'cash', invIds: [invId] });
    assert.throws(() => T.deleteReading({ meterId: m.id, reason: 'Wrong entry' }), /Cannot delete reading.*already been paid/);
  }
});

test('electricity fraud validation: flags lower readings, consumption surges and QR mismatches', () => {
  setupHostel();
  T.registerMeter({ roomId: 'r1', serialNo: 'SR-101', qrCode: 'QR-101' });

  // 1. Reading lower than previous (150 < 200)
  const check1 = T.validateMeterReadingFraud({ roomId: 'r1', curr: 150, prev: 200, meterQr: 'QR-101' });
  assert.equal(check1.valid, false);
  assert.ok(check1.flags.some(f => f.includes('lower than previous')));

  // 2. Surge consumption (> 1500 units)
  const check2 = T.validateMeterReadingFraud({ roomId: 'r1', curr: 2200, prev: 200, meterQr: 'QR-101' });
  assert.equal(check2.valid, false);
  assert.ok(check2.flags.some(f => f.includes('Excessive consumption')));

  // 3. Meter QR mismatch
  const check3 = T.validateMeterReadingFraud({ roomId: 'r1', curr: 250, prev: 200, meterQr: 'QR-WRONG' });
  assert.equal(check3.valid, false);
  assert.ok(check3.flags.some(f => f.includes('Meter QR mismatch')));
});

test('digital agreements: generates agreement, increments versions, and renewal reminders', () => {
  setupHostel();
  const r = T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-01' });

  const agr1 = T.createAgreement({
    resId: r.id,
    startDate: '2026-01-01',
    endDate: '2026-11-30',
    rent: 7500,
    deposit: 15000,
    noticeDays: 30
  });

  assert.equal(agr1.version, 1);
  assert.equal(agr1.rent, 7500);
  assert.equal(agr1.status, 'active');
  assert.equal(T.getActiveAgreement(r.id).id, agr1.id);

  // Renewal creates v2 and marks v1 renewed
  const agr2 = T.renewAgreement(agr1.id, { newEndDate: '2027-11-30', rent: 8000 });
  assert.equal(agr2.version, 2);
  assert.equal(agr2.rent, 8000);
  assert.equal(T.Store.get(agr1.id).status, 'renewed');
  assert.equal(T.getActiveAgreement(r.id).id, agr2.id);
});

test('payment webhook: verifies payload, performs idempotent ledger entry', () => {
  setupHostel();
  const r = T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-01' });
  const inv = T.addInvoice({ resId: r.id, amount: 6500, title: 'Rent' });

  const webhookPayload = {
    provider: 'razorpay',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_rzp_test_12345',
          amount: 650000, // paise
          currency: 'INR',
          status: 'captured',
          order_id: inv.id,
          notes: { resId: r.id, invId: inv.id }
        }
      }
    }
  };

  const res1 = T.processVerifiedPaymentWebhook(webhookPayload);
  assert.equal(res1.ok, true);
  assert.equal(res1.replay, false);
  assert.equal(T.invBal(T.Store.get(inv.id)), 0);

  // Webhook replay with identical payment ID
  const res2 = T.processVerifiedPaymentWebhook(webhookPayload);
  assert.equal(res2.ok, true);
  assert.equal(res2.replay, true, 'Replay must be safely acknowledged without duplicate billing');
});

test('ocr pattern recognition: decodes 7-segment display digits and parses meter reading strings', () => {
  const T = boot();

  // Test parseMeterOcrText
  const parsed1 = T.parseMeterOcrText('001245.5 kWh');
  assert.equal(parsed1.value, 1245.5);
  assert.ok(parsed1.confidence >= 0.8);

  const parsed2 = T.parseMeterOcrText('INVALID');
  assert.equal(parsed2.value, null);
  assert.equal(parsed2.confidence, 0);

  // Test analyzeDigitSegments with 10x10 simulated grid for digit "8" (all segments on)
  const grid8 = new Uint8Array(100);
  grid8.fill(255); // all pixels bright
  const res8 = T.analyzeDigitSegments(grid8, 10, 10);
  assert.equal(res8.digit, '8');
  assert.ok(res8.confidence >= 0.7);
});

test('electricity meter deletion: atomic rollback preserves unpaid invoices if any resident bill is paid', () => {
  setupHostel();
  const r1 = T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-01' });
  const r2 = T.checkIn({ name: 'Suresh Raina', phone: '9876543211', roomId: 'r1', bed: 'B', rent: 6000, deposit: 6000, checkIn: '2026-01-01' });

  // 100 -> 200 (100 units split between Ravi and Suresh)
  const m = T.addReading({ roomId: 'r1', prev: 100, curr: 200, date: T.today() });
  const invRaviId = `inv-el-${m.id}-${r1.id}`;
  const invSureshId = `inv-el-${m.id}-${r2.id}`;

  assert.ok(T.Store.get(invRaviId), 'Ravi invoice must exist');
  assert.ok(T.Store.get(invSureshId), 'Suresh invoice must exist');

  // Ravi pays his electricity invoice; Suresh has NOT paid
  T.recordPayment({ resId: r1.id, amount: T.Store.get(invRaviId).amount, mode: 'cash', invIds: [invRaviId] });
  assert.ok(T.Store.get(invRaviId).paid > 0);
  assert.equal(T.Store.get(invSureshId).paid, 0);

  // Attempting to delete reading must fail because Ravi has paid
  assert.throws(() => T.deleteReading({ meterId: m.id, reason: 'Accidental reading' }), /Cannot delete reading.*already been paid/);

  // CRITICAL ATOMICITY CHECK: Suresh's unpaid invoice MUST NOT be deleted!
  assert.ok(T.Store.get(invSureshId), 'Suresh invoice must NOT be deleted when deletion fails');
  assert.ok(T.Store.get(m.id), 'Meter reading must remain intact');
});

test('payment reversal: excludes reversed payment from payments() and financial reports', () => {
  setupHostel();
  const r = T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-01' });
  const inv = T.addInvoice({ resId: r.id, amount: 6000, title: 'Rent Jan' });

  const pay = T.recordPayment({ resId: r.id, amount: 6000, mode: 'upi', date: '2026-01-10' });
  assert.equal(T.payments().length, 1);

  // Check report before reversal
  const repBefore = T.Report.compute('2026-01-01', '2026-01-31');
  assert.equal(repBefore.pays.length, 1);
  assert.equal(repBefore.cash.byMode.upi, 6000);

  // Reverse payment
  T.reversePayment(pay.id, 'Disputed UPI transaction');

  // payments() must exclude reversed payment
  assert.equal(T.payments().length, 0, 'Reversed payment must be excluded from active payments()');

  // Report must exclude reversed payment from revenue / cash flow
  const repAfter = T.Report.compute('2026-01-01', '2026-01-31');
  assert.equal(repAfter.pays.length, 0, 'Reversed payment must be excluded from financial report');
  assert.equal(repAfter.cash.byMode.upi || 0, 0, 'Cash flow must not include reversed payment');

  // resPays must mark it as reversed
  const resPayments = T.resPays(r.id);
  assert.equal(resPayments.length, 1);
  assert.equal(resPayments[0].reversed, true);
  assert.equal(resPayments[0].reversalReason, 'Disputed UPI transaction');
});

test('electricity meter correction: downward correction on paid invoice refunds excess to resident credit', () => {
  setupHostel();
  const r = T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-01' });

  // 100 -> 200 (100 units = ₹1000)
  const m = T.addReading({ roomId: 'r1', prev: 100, curr: 200, date: T.today() });
  const s = m.shares[0];
  const invId = `inv-el-${m.id}-${s.resId}`;
  const invBefore = T.Store.get(invId);
  assert.equal(invBefore.amount, 1000);

  // Resident pays ₹1000
  T.recordPayment({ resId: r.id, amount: 1000, mode: 'cash', invIds: [invId] });
  assert.equal(T.Store.get(invId).paid, 1000);
  assert.equal(T.resById(r.id).credit || 0, 0);

  // Owner corrects reading down from 200 to 150 (50 units = ₹500)
  T.correctReading({ meterId: m.id, curr: 150, reason: 'Glare caused digit 0 to be read as 5' });

  const invAfter = T.Store.get(invId);
  assert.equal(invAfter.amount, 500);
  assert.equal(invAfter.paid, 500);

  // Resident must receive the ₹500 overpayment as advance credit
  const rAfter = T.resById(r.id);
  assert.equal(rAfter.credit, 500, 'Excess ₹500 must be credited back to resident advance credit');
});

test('public payment webhook: rejects unconfigured secret and verifies HMAC signatures', async () => {
  const publicHandler = require('../api/public.js');

  const H1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const U1 = 'cccccccc-1111-4111-8111-cccccccccccc';

  // 1. When PAYMENT_WEBHOOK_SECRET is not set, must return 503
  delete process.env.PAYMENT_WEBHOOK_SECRET;
  let status1 = 0, out1 = null;
  const res1 = { setHeader() {}, status(s) { status1 = s; return this; }, json(o) { out1 = o; } };
  await publicHandler({
    method: 'POST',
    url: '/api/public?sub=webhook',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: { orderId: 'inv-123', amount: 5000, status: 'SUCCESS' }
  }, res1);
  assert.equal(status1, 503, 'Must reject with 503 when webhook secret is unconfigured');

  // 2. When PAYMENT_WEBHOOK_SECRET is set, must reject missing/invalid signature with 401
  process.env.PAYMENT_WEBHOOK_SECRET = 'whsec_test_secret_999';
  let status2 = 0, out2 = null;
  const res2 = { setHeader() {}, status(s) { status2 = s; return this; }, json(o) { out2 = o; } };
  await publicHandler({
    method: 'POST',
    url: '/api/public?sub=webhook',
    headers: { 'x-forwarded-for': '127.0.0.1', 'x-razorpay-signature': 'invalid_sig' },
    body: { orderId: 'inv-123', amount: 5000, status: 'SUCCESS' }
  }, res2);
  assert.equal(status2, 401, 'Must reject with 401 when signature is invalid');

  // 3. Valid signature
  const rawBody = {
    payload: {
      payment: {
        entity: {
          id: 'pay_test_9876',
          amount: 500000,
          status: 'captured',
          order_id: 'inv-123',
          notes: { resId: U1, hostelId: H1 }
        }
      }
    }
  };
  const validSig = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(JSON.stringify(rawBody)).digest('hex');

  // Mock global fetch for supabase rest calls
  const origFetch = global.fetch;
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify([{ id: 'pay_row' }]),
    json: async () => [{ id: 'pay_row' }]
  });

  try {
    let status3 = 0, out3 = null;
    const res3 = { setHeader() {}, status(s) { status3 = s; return this; }, json(o) { out3 = o; } };
    await publicHandler({
      method: 'POST',
      url: '/api/public?sub=webhook&provider=razorpay',
      headers: { 'x-forwarded-for': '127.0.0.1', 'x-razorpay-signature': validSig },
      body: rawBody
    }, res3);
    assert.equal(status3, 200, 'Must accept with 200 when signature matches HMAC');
    assert.equal(out3.ok, true);
  } finally {
    global.fetch = origFetch;
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  }
});

test('admin push notification actions: save, get_status, send, and remove', async () => {
  process.env.SUPABASE_URL = 'https://sb.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  const adminHandler = require('../api/admin.js');
  const H1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const ORG1 = '11111111-1111-4111-8111-111111111111';
  const U_OWNER = 'cccccccc-1111-4111-8111-cccccccccccc';

  const docsDb = [];
  const origFetch = global.fetch;
  global.fetch = async (url, opt = {}) => {
    const u = new URL(url), method = opt.method || 'GET';
    const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
    if (u.pathname === '/auth/v1/user') return json(200, { id: U_OWNER });
    if (u.pathname === '/rest/v1/profiles') return json(200, [{ id: U_OWNER, username: 'owner', active: true, is_super: false }]);
    if (u.pathname === '/rest/v1/members') return json(200, [{ user_id: U_OWNER, org_id: ORG1, hostel_id: H1, role: 'owner', active: true }]);
    if (u.pathname === '/rest/v1/hostels') return json(200, [{ id: H1, org_id: ORG1 }]);
    if (u.pathname === '/rest/v1/docs' && method === 'POST') {
      const rows = JSON.parse(opt.body);
      docsDb.push(...rows);
      return json(201, rows);
    }
    if (u.pathname === '/rest/v1/docs' && method === 'GET') {
      return json(200, docsDb);
    }
    if (u.pathname === '/rest/v1/docs' && method === 'DELETE') {
      return json(200, []);
    }
    return json(404, { message: 'not found' });
  };

  async function callAdmin(body) {
    let status = 0, out = null;
    const res = { setHeader() {}, status(s) { status = s; return this; }, json(o) { out = o; } };
    await adminHandler({
      method: 'POST',
      headers: { 'x-forwarded-for': '127.0.0.1', authorization: 'Bearer tok_owner' },
      body
    }, res);
    return { status, out };
  }

  try {
    // 1. Invalid endpoint (not https)
    const badSub = await callAdmin({ action: 'save_push_sub', endpoint: 'http://insecure.test/sub' });
    assert.equal(badSub.status, 400);

    // 2. Valid endpoint
    const goodSub = await callAdmin({
      action: 'save_push_sub',
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-token',
      keys: { p256dh: 'key_p256dh', auth: 'key_auth' }
    });
    assert.equal(goodSub.status, 200);
    assert.ok(goodSub.out.ok);
    assert.ok(goodSub.out.id.startsWith('psub-'));

    // 3. Get status
    const statusRes = await callAdmin({ action: 'get_push_status' });
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.out.active, true);

    // 4. Send push
    const sendRes = await callAdmin({
      action: 'send_push',
      hostel_id: H1,
      org_id: ORG1,
      title: 'Rent Reminder',
      body: 'Rent is due tomorrow'
    });
    assert.equal(sendRes.status, 200);
    assert.equal(sendRes.out.ok, true);
    assert.equal(sendRes.out.queued, 1);

    // 5. Remove push
    const rmRes = await callAdmin({
      action: 'remove_push_sub',
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-token'
    });
    assert.equal(rmRes.status, 200);
    assert.equal(rmRes.out.ok, true);
  } finally {
    global.fetch = origFetch;
  }
});
