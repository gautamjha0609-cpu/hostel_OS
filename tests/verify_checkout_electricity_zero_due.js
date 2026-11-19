'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createSandbox(extraSettings = {}) {
  const store = new Map();
  const sessionStore = new Map();

  const ctx = {
    console,
    Date,
    Math,
    JSON,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      clear: () => store.clear(),
      key: i => Array.from(store.keys())[i] || null,
      get length() { return store.size; }
    },
    sessionStorage: {
      getItem: k => (sessionStore.has(k) ? sessionStore.get(k) : null),
      setItem: (k, v) => sessionStore.set(k, String(v)),
      removeItem: k => sessionStore.delete(k),
      clear: () => sessionStore.clear()
    },
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    removeEventListener: () => {},
    navigator: { userAgent: 'NodeTest', platform: 'Win32' },
    location: { search: '', pathname: '/', hostname: 'localhost', protocol: 'http:' },
    document: { hidden: false, title: '', addEventListener: () => {}, removeEventListener: () => {} },
    openModal: () => {},
    closeModal: () => {},
    updateChrome: () => {},
    toast: () => {},
    t: s => s,
    esc: s => s,
    inr: n => '₹' + Number(n).toLocaleString('en-IN'),
  };
  ctx.window = ctx;
  ctx.window.HOSTELOS_CONFIG = {};
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }

  vm.runInContext(`
    globalThis.Store = Store;
    globalThis.calcSettlement = calcSettlement;
    globalThis.checkout = checkout;
    globalThis.moveReading = moveReading;
    globalThis.setOpeningReading = setOpeningReading;
    globalThis.resDue = resDue;
    globalThis.invBal = invBal;
    globalThis.today = today;
  `, ctx);

  const S = ctx.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'org1', modules: { electricity: true }, status: 'active', owner_name: 'Owner' }];
  S.hostels = [{
    id: 'h1',
    org_id: 'org1',
    name: 'Sunrise PG',
    settings: {
      elec: { rate: 10, freeUnits: 0, freeMode: 'resident', ...extraSettings.elec },
      ...extraSettings
    }
  }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };

  return { ctx, S };
}

test('1. calcSettlement preview calculates electricity bill and includes it in total liabilities', () => {
  const { ctx, S } = createSandbox();
  const room = S.put('room', { id: 'rm-101', no: '101', floor: 'F1', rent: 6000, beds: [{ id: 'A', status: 'occ' }] });
  const res = S.put('res', {
    id: 'res-1',
    name: 'Rahul Kumar',
    roomId: 'rm-101',
    bed: 'A',
    rent: 6000,
    status: 'active',
    checkIn: '2026-11-01',
    deposit: 8000,
    credit: 0
  });

  // Deposit paid invoice
  S.put('inv', { id: `inv-dep-${res.id}`, resId: res.id, roomId: 'rm-101', type: 'deposit', amount: 8000, paid: 8000, status: 'paid', date: '2026-11-01' });
  // Unpaid Rent invoice
  S.put('inv', { id: `inv-rent-${res.id}`, resId: res.id, roomId: 'rm-101', type: 'rent', amount: 6000, paid: 0, date: '2026-11-01' });

  // Baseline meter reading at 100 units
  ctx.setOpeningReading('rm-101', 100, '2026-11-01');

  // Preview settlement with final checkout reading = 150 (50 units consumed @ ₹10 = ₹500)
  const stmt = ctx.calcSettlement({
    resId: res.id,
    checkoutDate: '2026-11-15',
    reading: 150
  });

  // Electricity must be calculated: 50 units @ ₹10 = ₹500
  assert.ok(stmt.elecShare, 'elecShare should be computed');
  assert.equal(stmt.elecShare.roomUnits, 50);
  assert.equal(stmt.elecShare.billable, 50);
  assert.equal(stmt.elecShare.amount, 500);

  // Unpaid dues must include Rent (6000) + Electricity (500) = 6500
  assert.equal(stmt.unpaidDues, 6500);
  assert.equal(stmt.totalLiabilities, 6500);
  assert.equal(stmt.depositPaid, 8000);

  // Refund must be Deposit (8000) - Total Liabilities (6500) = 1500
  assert.equal(stmt.refund, 1500);
  assert.equal(stmt.balancePayable, 0);

  // Unpaid invoices preview must have simulated electricity invoice
  assert.ok(stmt.unpaidInvoices.some(i => i.type === 'electricity' && i.amount === 500));
});

test('2. Checkout with electricity reading bills electricity immediately and settles from deposit', () => {
  const { ctx, S } = createSandbox();
  S.put('room', { id: 'rm-102', no: '102', floor: 'F1', rent: 5000, beds: [{ id: 'A', status: 'occ' }] });
  const res = S.put('res', {
    id: 'res-2',
    name: 'Aman Sharma',
    roomId: 'rm-102',
    bed: 'A',
    rent: 5000,
    status: 'active',
    checkIn: '2026-11-01',
    deposit: 10000
  });

  S.put('inv', { id: `inv-dep-${res.id}`, resId: res.id, roomId: 'rm-102', type: 'deposit', amount: 10000, paid: 10000, status: 'paid', date: '2026-11-01' });
  S.put('inv', { id: `inv-rent-${res.id}`, resId: res.id, roomId: 'rm-102', type: 'rent', amount: 5000, paid: 0, date: '2026-11-01' });
  ctx.setOpeningReading('rm-102', 200, '2026-11-01');

  // Checkout with reading = 260 (60 units @ ₹10 = ₹600) and instant refund
  const dep = ctx.checkout(res.id, '2026-11-15', 0, 'Clean exit', {
    reading: 260,
    refundNow: true,
    refundMode: 'upi',
    refundRef: 'UPI-REF-9988'
  });

  // Electricity invoice should have been generated and settled
  const elInvs = S.all('inv').filter(i => i.resId === res.id && i.type === 'electricity');
  assert.equal(elInvs.length, 1);
  assert.equal(elInvs[0].amount, 600);
  assert.equal(elInvs[0].paid, 600); // 100% settled from deposit

  // Settle: Rent (5000) + Electricity (600) = 5600
  assert.equal(dep.settled, 5600);
  // Refund: 10000 - 5600 = 4400
  assert.equal(dep.refund, 4400);
  assert.equal(dep.status, 'paid');
  assert.equal(dep.mode, 'upi');
  assert.equal(dep.ref, 'UPI-REF-9988');

  // Verify settlement statement preserves electricity breakdown
  assert.ok(dep.settlement, 'dep.settlement must exist');
  assert.ok(dep.settlement.elecShare, 'dep.settlement.elecShare must be populated');
  assert.equal(dep.settlement.elecShare.curr, 260);
  assert.equal(dep.settlement.elecShare.roomUnits, 60);
  assert.equal(dep.settlement.elecShare.amount, 600);

  // Strict Zero-Due Guarantee
  assert.equal(ctx.resDue(res.id), 0);
  assert.equal(S.get('res-2').status, 'left');
  assert.equal(S.get('rm-102').beds[0].status, 'vac');
});

test('3. Same-day moveReading at checkout successfully records and bills new consumption', () => {
  const { ctx, S } = createSandbox();
  S.put('room', { id: 'rm-103', no: '103', floor: 'F1', rent: 5000, beds: [{ id: 'A', status: 'occ' }] });
  const res = S.put('res', {
    id: 'res-3',
    name: 'Suresh',
    roomId: 'rm-103',
    bed: 'A',
    rent: 5000,
    status: 'active',
    checkIn: ctx.today(),
    deposit: 5000
  });

  // Opening reading taken TODAY at 500
  ctx.setOpeningReading('rm-103', 500, ctx.today());

  // Resident checks out TODAY with meter reading 530 (30 units consumed today)
  const m = ctx.moveReading('rm-103', 530, ctx.today());
  assert.ok(m, 'moveReading should not return null when units are consumed on same day');
  assert.equal(m.curr, 530);
  assert.equal(m.units, 30);

  // Calling moveReading with same value (530) returns null as nothing new
  const mSame = ctx.moveReading('rm-103', 530, ctx.today());
  assert.equal(mSame, null);
});

test('4. Zero-Due Settlement: Dues > Security Deposit -> Collect balance to reach ₹0 due', () => {
  const { ctx, S } = createSandbox();
  S.put('room', { id: 'rm-104', no: '104', floor: 'F1', rent: 8000, beds: [{ id: 'A', status: 'occ' }] });
  const res = S.put('res', {
    id: 'res-4',
    name: 'Vikas Patel',
    roomId: 'rm-104',
    bed: 'A',
    rent: 8000,
    status: 'active',
    checkIn: '2026-10-01',
    deposit: 5000
  });

  // Deposit paid: 5000
  S.put('inv', { id: `inv-dep-${res.id}`, resId: res.id, roomId: 'rm-104', type: 'deposit', amount: 5000, paid: 5000, status: 'paid', date: '2026-10-01' });
  // Unpaid Rent 1 (Oct): 8000
  S.put('inv', { id: `inv-rent1-${res.id}`, resId: res.id, roomId: 'rm-104', type: 'rent', amount: 8000, paid: 0, date: '2026-10-01' });
  // Unpaid Rent 2 (Nov): 8000
  S.put('inv', { id: `inv-rent2-${res.id}`, resId: res.id, roomId: 'rm-104', type: 'rent', amount: 8000, paid: 0, date: '2026-11-01' });

  // Total dues = 16,000. Deposit = 5,000. Balance payable = 11,000.
  // Owner collects remaining 11,000 via UPI at checkout
  const dep = ctx.checkout(res.id, '2026-11-15', 0, 'Full clearance', {
    settleBalance: 'pay',
    payMode: 'upi',
    payRef: 'UPI-CLR-771122'
  });

  assert.equal(dep.deposit, 5000);
  assert.equal(dep.settled, 5000);
  assert.equal(dep.balancePayable, 11000);

  // Payment record must be generated for 11,000
  const payRecords = S.all('pay').filter(p => p.resId === res.id && p.amount === 11000);
  assert.equal(payRecords.length, 1);
  assert.equal(payRecords[0].mode, 'upi');
  assert.equal(payRecords[0].ref, 'UPI-CLR-771122');

  // Both rent invoices must be 100% paid
  assert.equal(ctx.invBal(S.get(`inv-rent1-${res.id}`)), 0);
  assert.equal(ctx.invBal(S.get(`inv-rent2-${res.id}`)), 0);

  // Strict Zero-Due Guarantee: NO lingering debt for resident!
  assert.equal(ctx.resDue(res.id), 0);
});

test('5. Zero-Due Settlement: Dues > Security Deposit -> Waive remaining balance to reach ₹0 due', () => {
  const { ctx, S } = createSandbox();
  S.put('room', { id: 'rm-105', no: '105', floor: 'F1', rent: 7000, beds: [{ id: 'A', status: 'occ' }] });
  const res = S.put('res', {
    id: 'res-5',
    name: 'Kunal Verma',
    roomId: 'rm-105',
    bed: 'A',
    rent: 7000,
    status: 'active',
    checkIn: '2026-11-01',
    deposit: 5000
  });

  S.put('inv', { id: `inv-dep-${res.id}`, resId: res.id, roomId: 'rm-105', type: 'deposit', amount: 5000, paid: 5000, status: 'paid', date: '2026-11-01' });
  S.put('inv', { id: `inv-rent-${res.id}`, resId: res.id, roomId: 'rm-105', type: 'rent', amount: 7000, paid: 0, date: '2026-11-01' });

  // Total dues = 7000. Deposit = 5000. Balance payable = 2000.
  // Owner waives the remaining 2000 balance
  const dep = ctx.checkout(res.id, '2026-11-20', 0, 'Waived by owner agreement', {
    settleBalance: 'waive',
    waiveReason: 'Special owner settlement discount'
  });

  assert.equal(dep.settled, 5000);
  assert.equal(dep.balancePayable, 2000);

  // Rent invoice should have 5000 paid and 2000 waived
  const rentInv = S.get(`inv-rent-${res.id}`);
  assert.equal(rentInv.paid, 5000);
  assert.equal(rentInv.waived, 2000);
  assert.equal(ctx.invBal(rentInv), 0);

  // Strict Zero-Due Guarantee
  assert.equal(ctx.resDue(res.id), 0);
});

test('6. Exact Match: Security Deposit == Total Dues -> 1-click settle all to ₹0', () => {
  const { ctx, S } = createSandbox();
  S.put('room', { id: 'rm-106', no: '106', floor: 'F1', rent: 6000, beds: [{ id: 'A', status: 'occ' }] });
  const res = S.put('res', {
    id: 'res-6',
    name: 'Deepak',
    roomId: 'rm-106',
    bed: 'A',
    rent: 6000,
    status: 'active',
    checkIn: '2026-11-01',
    deposit: 6000
  });

  S.put('inv', { id: `inv-dep-${res.id}`, resId: res.id, roomId: 'rm-106', type: 'deposit', amount: 6000, paid: 6000, status: 'paid', date: '2026-11-01' });
  S.put('inv', { id: `inv-rent-${res.id}`, resId: res.id, roomId: 'rm-106', type: 'rent', amount: 6000, paid: 0, date: '2026-11-01' });

  const dep = ctx.checkout(res.id, '2026-11-30', 0, 'Exact match');

  assert.equal(dep.settled, 6000);
  assert.equal(dep.refund, 0);
  assert.equal(dep.balancePayable, 0);
  assert.equal(ctx.resDue(res.id), 0);
  assert.equal(S.get('res-6').status, 'left');
});

test('7. Multi-occupant pro-rata split at checkout: departing resident pays only their days', () => {
  const { ctx, S } = createSandbox();
  S.put('room', { id: 'rm-107', no: '107', floor: 'F1', rent: 5000, beds: [{ id: 'A', status: 'occ' }, { id: 'B', status: 'occ' }] });
  const a = S.put('res', { id: 'res-a', name: 'Asha', roomId: 'rm-107', bed: 'A', rent: 5000, checkIn: '2026-11-01', deposit: 5000, status: 'active' });
  const b = S.put('res', { id: 'res-b', name: 'Beena', roomId: 'rm-107', bed: 'B', rent: 5000, checkIn: '2026-11-01', deposit: 5000, status: 'active' });

  S.put('inv', { id: `inv-dep-${a.id}`, resId: a.id, roomId: 'rm-107', type: 'deposit', amount: 5000, paid: 5000, status: 'paid', date: '2026-11-01' });
  S.put('inv', { id: `inv-dep-${b.id}`, resId: b.id, roomId: 'rm-107', type: 'deposit', amount: 5000, paid: 5000, status: 'paid', date: '2026-11-01' });

  // Baseline reading on 1st Nov = 100
  ctx.setOpeningReading('rm-107', 100, '2026-11-01');

  // Asha checks out on 16th Nov with reading = 200 (100 units shared by 2 people = 50 units each)
  const depA = ctx.checkout(a.id, '2026-11-16', 0, 'Asha left mid-month', {
    reading: 200,
    refundNow: true
  });

  // Electricity invoice for Asha must be 50 units @ ₹10 = ₹500
  const elA = S.all('inv').find(i => i.resId === a.id && i.type === 'electricity');
  assert.ok(elA);
  assert.equal(elA.amount, 500);
  assert.equal(elA.paid, 500); // settled from deposit

  // Asha's account must have zero remaining dues
  assert.equal(ctx.resDue(a.id), 0);

  // Beena stays in the room and is not checked out
  assert.equal(S.get('res-b').status, 'active');
  assert.equal(S.get('rm-107').beds[0].status, 'vac'); // bed A is now vacant
  assert.equal(S.get('rm-107').beds[1].status, 'occ'); // bed B is still occupied
});

test('8. Leave debt: settleBalance="debt" keeps remaining liabilities open on account', () => {
  const { ctx, S } = createSandbox();
  S.put('room', { id: 'rm-108', no: '108', floor: 'F1', rent: 8000, beds: [{ id: 'A', status: 'occ' }] });
  const res = S.put('res', {
    id: 'res-8',
    name: 'Vikas',
    roomId: 'rm-108',
    bed: 'A',
    rent: 8000,
    status: 'active',
    checkIn: '2026-11-01',
    deposit: 3000
  });

  S.put('inv', { id: `inv-dep-${res.id}`, resId: res.id, roomId: 'rm-108', type: 'deposit', amount: 3000, paid: 3000, status: 'paid', date: '2026-11-01' });
  S.put('inv', { id: `inv-rent-${res.id}`, resId: res.id, roomId: 'rm-108', type: 'rent', amount: 8000, paid: 0, date: '2026-11-01' });

  // Deposit 3000, Rent due 8000 -> 5000 remaining. Owner allows exit with debt (leave_debt)
  const dep = ctx.checkout(res.id, '2026-11-20', 0, 'Left with unpaid dues', {
    settleBalance: 'debt',
    payMode: 'cash' // payMode should NOT trigger payment when settleBalance is debt
  });

  assert.equal(dep.settled, 3000);
  assert.equal(dep.balancePayable, 5000);
  assert.equal(dep.status, 'debt');

  // Rent invoice still has 5000 due
  const rentInv = S.get(`inv-rent-${res.id}`);
  assert.equal(rentInv.paid, 3000);
  assert.equal(ctx.invBal(rentInv), 5000);

  // Resident must have 5000 due remaining in ledger!
  assert.equal(ctx.resDue(res.id), 5000);
  assert.equal(S.get(res.id).status, 'left');
  assert.equal(S.get('rm-108').beds[0].status, 'vac');
});

test('9. Electricity reading covered by free units preserves elecShare with amount 0', () => {
  const { ctx, S } = createSandbox({
    elec: { rate: 10, freeUnits: 50, freeMode: 'resident' }
  });
  S.put('room', { id: 'rm-109', no: '109', floor: 'F1', rent: 6000, beds: [{ id: 'A', status: 'occ' }] });
  const res = S.put('res', {
    id: 'res-9',
    name: 'Pooja',
    roomId: 'rm-109',
    bed: 'A',
    rent: 6000,
    status: 'active',
    checkIn: '2026-11-01',
    deposit: 6000
  });

  S.put('inv', { id: `inv-dep-${res.id}`, resId: res.id, roomId: 'rm-109', type: 'deposit', amount: 6000, paid: 6000, status: 'paid', date: '2026-11-01' });
  ctx.setOpeningReading('rm-109', 100, '2026-11-01');

  // Checkout with reading 120 (20 units consumed, free quota = 50 -> 0 billable)
  const dep = ctx.checkout(res.id, '2026-11-30', 0, 'Clean checkout with free electricity', {
    reading: 120,
    refundNow: true
  });

  assert.ok(dep.settlement);
  assert.ok(dep.settlement.elecShare);
  assert.equal(dep.settlement.elecShare.roomUnits, 20);
  assert.equal(dep.settlement.elecShare.billable, 0);
  assert.equal(dep.settlement.elecShare.amount, 0);
  assert.equal(dep.refund, 6000);
  assert.equal(ctx.resDue(res.id), 0);
});
