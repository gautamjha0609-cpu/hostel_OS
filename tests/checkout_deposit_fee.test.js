// Comprehensive Test Suite for Configurable Business Rules Engine
// Verifies:
// 1. Business templates application & 4-tier configuration hierarchy
// 2. Calendar monthly vs joining-date anniversary cycle calculations (including 28/29/30/31 days & leap years)
// 3. Mid-month check-in rent calculations (pro-rata actual days, fixed 30 divisor, full, next cycle, custom)
// 4. Checkout settlement calculation (notice period shortfall fee, deposit deduction caps, dues, refund)
// 5. Electricity slab rates & fixed pricing calculations, split electricity with slabs, manual reading audit
// 6. Security deposit modes (fixed, rent multiple, per-bed) & late fee calculations (fixed, daily, percentage, caps, grace days)
// 7. Mess cutoff enforcement & leave rebate calculations
// 8. Digital agreement templates with variable interpolation & IT Act compliance
// 9. Staff action permission matrix across roles (owner, manager, warden, accountant, cook, guard)
// 10. Monthly billing automation batch idempotency & WhatsApp billing summary generation

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function boot() {
  const mem = {};
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, URL, URLSearchParams, Date, Math, JSON, TextEncoder, crypto,
    localStorage: {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; },
      key: () => null,
      length: 0
    },
    navigator: { onLine: true, vibrate() {} },
    location: { href: 'https://app.test/index.html', hash: '', origin: 'https://app.test', pathname: '/index.html' },
    document: {
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { dataset: {} },
      body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} },
      createElement: () => ({ setAttribute() {}, appendChild() {}, querySelector: () => null })
    },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
  };
  ctx.window = ctx;
  ctx.window.HOSTELOS_CONFIG = {};
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js', 'xlsx.js', 'report.js', 'pwa.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`
    toast = () => {};
    globalThis.T = {
      Store, Demo, S, can, canAction, checkIn, recordPayment, resDue, openInv, resInvoices, invBal,
      splitElectricity, freeMonths, addReading, addInvoice, today, addDays, ymOf, daysIn, rentDue,
      activeRes, resById, roomById, checkout, correctReading, deleteReading, registerMeter,
      createAgreement, getActiveAgreement, renewAgreement, agreementDueRenewal, reversePayment,
      alog, payments, resPays, Report,
      DEFAULT_SETTINGS, DEFAULT_AGREEMENT_TEMPLATES, BUSINESS_TEMPLATES, ACTION_PERMS,
      effectiveSettings, applyBusinessTemplate, calcCheckInRent, residentCycleFor,
      calcDepositAmount, depositFor, checkoutMessage, bulkCreateRooms, rooms, calcLateFee, calcSettlement, calcElectricityCost,
      canSkipMeal, calcMessRebate, PaymentGateway, composeMonthlyBillingMessage, runMonthlyBillingBatch, upiPayUrl
    };
  `, ctx);
  return ctx.T;
}

let T;
function setupHostel(role = 'owner', extra = {}) {
  T = boot();
  const S = T.Store;
  S.me = { id: 'u1', full_name: 'Owner Person', role };
  S.orgs = [{ id: 'o1', modules: extra.modules || {}, status: 'active', owner_name: 'Owner Person', phone: '9876500001', settings: extra.orgSettings || {} }];
  S.hostels = [{
    id: 'h1',
    org_id: 'o1',
    name: 'Sarvlekh Elite PG',
    address: '100 Tech Park Road, Bengaluru',
    phone: '9876500001',
    settings: extra.settings || {}
  }];
  S.ctx = { key: 'k', role, hostelId: 'h1', orgId: 'o1', perms: extra.perms || [], deny: [] };
  S.put('room', { id: 'r1', no: '101', floor: 'F1', rent: 8000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  S.put('room', { id: 'r2', no: '102', floor: 'F1', rent: 9000, beds: [{ id: 'A', status: 'vac' }] });
  return S;
}


// ===== checkout: per-bed deposit, non-refundable fee and a settlement that always adds up =====
function admit(deposit, rent = 8000, over = {}) {
  const r = T.checkIn({ name: 'Aman Sharma', phone: '9876543210', roomId: 'r1', bed: 'A', rent, deposit, checkIn: '2026-04-01', ...over });
  // pay everything raised at check-in (deposit and first rent) so only what a test adds is owed
  for (const inv of T.openInv(r.id)) T.recordPayment({ resId: r.id, amount: T.invBal(inv), mode: 'cash', date: '2026-04-01', invIds: [inv.id] });
  return T.resById(r.id);
}

test('A. check-in remembers the non-refundable fee and the deposit rule for that resident', () => {
  const S = setupHostel('owner', { settings: { deposit: { mode: 'fixed', fixedAmount: 10000, nonRefundable: 1500 } } });
  const r = admit(10000);
  assert.equal(r.depositFee, 1500);
  assert.equal(r.depositRule, 'fixed');
  // changing the hostel setting later does not touch this resident
  S.hostels[0].settings = { deposit: { mode: 'fixed', fixedAmount: 10000, nonRefundable: 3000 } };
  assert.equal(T.resById(r.id).depositFee, 1500);
});

test('B. no fee set -> nothing is kept; the fee can never exceed the deposit', () => {
  setupHostel('owner'); let r = admit(8000);
  assert.equal(r.depositFee, 0);
  let st = T.calcSettlement({ resId: r.id, checkoutDate: '2026-05-01' });
  assert.equal(st.nonRefundable, 0); assert.equal(st.refund, 8000);
  setupHostel('owner', { settings: { deposit: { mode: 'custom', nonRefundable: 5000 } } });
  r = admit(2000);
  assert.equal(r.depositFee, 2000, 'capped to the deposit paid');
});

test('C. settlement: deposit - fee - dues - notice shortfall - damages = refund', () => {
  setupHostel('owner', { settings: { deposit: { mode: 'rent_multiple', rentMultiplier: 1, nonRefundable: 1000 } } });
  const r = admit(8000);
  T.addInvoice({ resId: r.id, roomId: 'r1', type: 'electricity', period: '2026-04', title: 'Electricity Apr', amount: 600, date: '2026-04-30', due: '2026-05-05' });
  const st = T.calcSettlement({ resId: r.id, checkoutDate: '2026-05-10', deductions: 400 });
  assert.equal(st.depositPaid, 8000);
  assert.equal(st.nonRefundable, 1000);
  assert.equal(st.refundableDeposit, 7000);
  assert.equal(st.availableDepositAndCredit, 7000);
  assert.equal(st.unpaidDues, 600);
  assert.equal(st.refund, 8000 - 1000 - 600 - 400);
  assert.equal(st.balancePayable, 0);
});

test('D. dues bigger than the refundable deposit -> refund 0 and the rest is payable', () => {
  setupHostel('owner', { settings: { deposit: { mode: 'fixed', fixedAmount: 5000, nonRefundable: 1000 } } });
  const r = admit(5000);
  T.addInvoice({ resId: r.id, roomId: 'r1', type: 'rent', period: '2026-04', title: 'Rent Apr', amount: 8000, date: '2026-04-01', due: '2026-04-05' });
  const st = T.calcSettlement({ resId: r.id, checkoutDate: '2026-05-10' });
  assert.equal(st.refundableDeposit, 4000);
  assert.equal(st.refund, 0);
  assert.equal(st.balancePayable, 4000);
});

test('E. full checkout records the fee, and the message numbers add up', () => {
  setupHostel('owner', { settings: { deposit: { mode: 'fixed', fixedAmount: 10000, nonRefundable: 1500 } } });
  const r = admit(10000);
  const dep = T.checkout(r.id, '2026-05-01', 500, 'done', { refundNow: true, refundMode: 'upi' });
  assert.equal(dep.deposit, 10000); assert.equal(dep.nonRefundable, 1500); assert.equal(dep.refund, 10000 - 1500 - 500);
  assert.equal(dep.depositRule, 'fixed');
  const msg = T.checkoutMessage(dep, T.resById(r.id));
  assert.ok(/10,000/.test(msg) && /1,500/.test(msg) && /500/.test(msg) && /8,000/.test(msg), msg);
  assert.ok(/Non-refundable fee/.test(msg));
});

test('F. a hostel with an old customised checkout template: fee goes into Deductions, still adds up', () => {
  setupHostel('owner', { settings: { deposit: { mode: 'fixed', fixedAmount: 10000, nonRefundable: 1500 }, wa: { tpl: { en: { checkout: 'Deposit {deposit} Deductions {deduct} Refund {refund}' } } } } });
  const r = admit(10000);
  const dep = T.checkout(r.id, '2026-05-01', 500, '', { refundNow: true, refundMode: 'cash' });
  const msg = T.checkoutMessage(dep, T.resById(r.id));
  assert.equal(msg, 'Deposit Rs. 10,000 Deductions Rs. 2,000 Refund Rs. 8,000');
});

test('G. room / bed specific deposit fills the check-in box; a room left blank uses one month rent', () => {
  setupHostel('owner', { settings: { deposit: { mode: 'per_bed', fixedAmount: 0 } } });
  const S = T.Store;
  S.put('room', { id: 'r3', no: '103', floor: 'F1', rent: 7000, deposit: 15000, beds: [{ id: 'A', status: 'vac' }] });
  assert.equal(T.depositFor(7000, T.roomById('r3')), 15000);
  assert.equal(T.depositFor(8000, T.roomById('r1')), 8000, 'room 101 has no deposit set');
  // in any other mode a stored room deposit is ignored
  S.hostels[0].settings = { deposit: { mode: 'rent_multiple', rentMultiplier: 2 } };
  assert.equal(T.depositFor(7000, T.roomById('r3')), 14000);
});

test('H. bulk setup carries the per-bed deposit into every room', () => {
  setupHostel('owner', { settings: { deposit: { mode: 'per_bed' } } });
  T.bulkCreateRooms({ floors: ['Floor 2'], rooms: [{ no: '201', beds: 2, rent: 6000, deposit: 9000 }, { no: '202', beds: 2, rent: 6000, deposit: 0 }], defaultRent: 6000 });
  assert.equal(T.rooms().find(x => x.no === '201').deposit, 9000);
  assert.equal(T.rooms().find(x => x.no === '202').deposit, undefined);
});

test('I. notice period 0 means no notice is required (not 30)', () => {
  setupHostel('owner', { settings: { checkout: { noticeDaysRequired: 0, shortfallPenalty: true } } });
  const r = admit(8000);
  const st = T.calcSettlement({ resId: r.id, checkoutDate: '2026-05-01', noticeDate: '2026-05-01' });
  assert.equal(st.requiredNoticeDays, 0); assert.equal(st.shortfallFee, 0);
});
