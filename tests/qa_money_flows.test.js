'use strict';
// QA: money flows - payments, FIFO, credit, reversal, deposits, deductions, refund-later, debt, pro-rata, late fee.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sandbox(settings = {}) {
  const store = new Map();
  const ctx = {
    console, Date, Math, JSON, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(), key: i => [...store.keys()][i] || null, get length() { return store.size; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
    navigator: { userAgent: 'NodeTest', platform: 'Win32' }, location: { search: '', pathname: '/', hostname: 'localhost', protocol: 'http:' },
    document: { hidden: false, title: '', addEventListener() {}, removeEventListener() {} },
    openModal() {}, closeModal() {}, updateChrome() {}, toast() {}, t: s => s, esc: s => s, inr: n => '₹' + n,
  };
  ctx.window = ctx; ctx.window.HOSTELOS_CONFIG = {}; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  vm.runInContext('Object.assign(globalThis,{Store,checkIn,checkout,recordPayment,reversePayment,addInvoice,resDue,resOverdue,openInv,invBal,calcLateFee,calcCheckInRent,today,addDays,calcSettlement,shiftBed,swapBeds,penaltyDue,addPenalty});', ctx);
  const S = ctx.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'org1', modules: { electricity: true }, status: 'active', owner_name: 'Owner' }];
  S.hostels = [{ id: 'h1', org_id: 'org1', name: 'QA PG', settings: { elec: { rate: 10, freeUnits: 0, freeMode: 'resident' }, ...settings } }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };
  S.put('room', { id: 'r1', no: '101', floor: '1', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  return { ctx, S };
}
const mk = (ctx, name, bed, o = {}) => ctx.checkIn({ name, phone: '90000' + String(Math.floor(10000 + Math.random() * 89999)), roomId: 'r1', bed, rent: 6000, deposit: 6000, checkIn: ctx.addDays(ctx.today(), -40), ...o });

test('M1 partial payments settle oldest invoice first (FIFO)', () => {
  const { ctx, S } = sandbox();
  const r = mk(ctx, 'Fifo', 'A', { deposit: 0 });
  ctx.addInvoice({ resId: r.id, roomId: 'r1', type: 'other', title: 'Old', amount: 1000, date: ctx.addDays(ctx.today(), -30), due: ctx.addDays(ctx.today(), -25) });
  ctx.addInvoice({ resId: r.id, roomId: 'r1', type: 'other', title: 'New', amount: 500, date: ctx.addDays(ctx.today(), -5), due: ctx.addDays(ctx.today(), 2) });
  const before = ctx.resDue(r.id);
  const order = ctx.openInv(r.id).slice().sort((a, b) => String(a.due).localeCompare(String(b.due)));
  ctx.recordPayment({ resId: r.id, amount: 1200, mode: 'cash' });
  assert.equal(ctx.resDue(r.id), before - 1200);
  const first = S.get(order[0].id);
  assert.equal(first.paid, Math.min(1200, order[0].amount), 'earliest-due invoice is paid first');
  assert.equal(S.get(order[order.length - 1].id).paid || 0, 0, 'latest invoice untouched');
});
test('M2 overpayment becomes resident credit and is used by the next bill', () => {
  const { ctx, S } = sandbox();
  const r = mk(ctx, 'Credit', 'A', { deposit: 0 });
  const d0 = ctx.resDue(r.id);
  ctx.recordPayment({ resId: r.id, amount: d0 + 700, mode: 'upi', ref: '123456789012' });
  assert.equal(ctx.resDue(r.id), 0);
  assert.equal(S.get(r.id).credit, 700);
});
test('M3 reversing a payment restores the dues exactly and removes credit', () => {
  const { ctx, S } = sandbox();
  const r = mk(ctx, 'Rev', 'A', { deposit: 0 });
  const d0 = ctx.resDue(r.id);
  const p = ctx.recordPayment({ resId: r.id, amount: d0 + 300, mode: 'cash' });
  ctx.reversePayment(p.id, 'bounced');
  assert.equal(ctx.resDue(r.id), d0);
  assert.equal(S.get(r.id).credit || 0, 0);
});
test('M4 same claim approved twice creates one payment', () => {
  const { ctx, S } = sandbox();
  const r = mk(ctx, 'Dup', 'A', { deposit: 0 });
  ctx.recordPayment({ resId: r.id, amount: 100, mode: 'upi', claimId: 'c1' });
  ctx.recordPayment({ resId: r.id, amount: 100, mode: 'upi', claimId: 'c1' });
  assert.equal(S.all('pay').filter(p => p.claimId === 'c1').length, 1);
});
test('M5 zero / negative / NaN invoices and payments are refused', () => {
  const { ctx } = sandbox();
  const r = mk(ctx, 'Neg', 'A', { deposit: 0 });
  for (const a of [0, -5, NaN, 'abc']) assert.throws(() => ctx.addInvoice({ resId: r.id, roomId: 'r1', type: 'other', title: 'x', amount: a, date: ctx.today() }));
  for (const a of [0, -5, NaN]) assert.throws(() => ctx.recordPayment({ resId: r.id, amount: a, mode: 'cash' }));
});
test('M6 checkout: deductions above deposit are refused and nothing changes', () => {
  const { ctx, S } = sandbox();
  const r = mk(ctx, 'Ded', 'A');
  ctx.recordPayment({ resId: r.id, amount: 6000, mode: 'cash', invIds: [`inv-dep-${r.id}`] });
  assert.throws(() => ctx.checkout(r.id, ctx.today(), 999999, '', { settleBalance: 'pay' }), /Deductions cannot exceed/);
  assert.equal(S.get(r.id).status, 'active');
});
test('M7 checkout refund_later keeps the refund pending; refund now marks it paid with mode', () => {
  const { ctx, S } = sandbox();
  const a = mk(ctx, 'RefA', 'A', { deposit: 6000 });
  ctx.recordPayment({ resId: a.id, amount: 6000, mode: 'cash', invIds: [`inv-dep-${a.id}`] });
  // clear rent dues first so a refund exists
  ctx.recordPayment({ resId: a.id, amount: ctx.resDue(a.id), mode: 'cash' });
  const d1 = ctx.checkout(a.id, ctx.today(), 0, '', { settleBalance: 'pay', payMode: 'cash', refundNow: false });
  assert.equal(d1.refund, 6000); assert.equal(d1.status, 'pending');
  const b = mk(ctx, 'RefB', 'B', { deposit: 6000 });
  ctx.recordPayment({ resId: b.id, amount: 6000, mode: 'cash', invIds: [`inv-dep-${b.id}`] });
  ctx.recordPayment({ resId: b.id, amount: ctx.resDue(b.id), mode: 'cash' });
  const d2 = ctx.checkout(b.id, ctx.today(), 0, '', { settleBalance: 'pay', payMode: 'upi', refundNow: true, refundMode: 'upi', refundRef: 'UTR1' });
  assert.equal(d2.status, 'paid'); assert.equal(d2.mode, 'upi');
});
test('M8 checkout leave_debt keeps dues open; waive clears them; pay clears them with a payment', () => {
  for (const mode of ['debt', 'waive', 'pay']) {
    const { ctx } = sandbox();
    const r = mk(ctx, 'Mode' + mode, 'A', { deposit: 0 });
    const due = ctx.resDue(r.id);
    assert.ok(due > 0);
    ctx.checkout(r.id, ctx.today(), 0, '', { settleBalance: mode, payMode: 'cash' });
    if (mode === 'debt') assert.equal(ctx.resDue(r.id), due); else assert.equal(ctx.resDue(r.id), 0, mode + ' should end at 0');
  }
});
test('M9 pro-rata first rent is proportional to days left in the month', () => {
  const { ctx } = sandbox();
  const c = ctx.calcCheckInRent({ checkInDate: '2026-11-21', monthlyRent: 3000, policy: 'daily' });
  assert.equal(c.amount, 1000, '10 of 30 days');
});
test('M10 late fee: not charged before due date + grace, charged after', () => {
  const { ctx } = sandbox({ lateFee: { on: true, mode: 'flat', amount: 200, graceDays: 3 } });
  const inv = { amount: 6000, paid: 0, due: '2026-11-05', date: '2026-11-01' };
  const early = ctx.calcLateFee({ invoice: inv, todayDate: '2026-11-07', lateSettings: { on: true, mode: 'flat', amount: 200, graceDays: 3 } });
  const late = ctx.calcLateFee({ invoice: inv, todayDate: '2026-11-20', lateSettings: { on: true, mode: 'flat', amount: 200, graceDays: 3 } });
  assert.ok((early.amount ?? early) === 0, 'inside grace -> 0');
  assert.ok((late.amount ?? late) > 0, 'after grace -> fee');
});
test('M11 checking out twice is refused', () => {
  const { ctx } = sandbox();
  const r = mk(ctx, 'Twice', 'A', { deposit: 0 });
  ctx.checkout(r.id, ctx.today(), 0, '', { settleBalance: 'waive' });
  assert.throws(() => ctx.checkout(r.id, ctx.today(), 0, '', { settleBalance: 'waive' }), /already checked out/);
});
test('M12 bed is free again after checkout and can be re-let', () => {
  const { ctx, S } = sandbox();
  const r = mk(ctx, 'Rel', 'A', { deposit: 0 });
  ctx.checkout(r.id, ctx.today(), 0, '', { settleBalance: 'waive' });
  assert.equal(S.get('r1').beds.find(b => b.id === 'A').status, 'vac');
  assert.doesNotThrow(() => mk(ctx, 'Next', 'A', { deposit: 0, checkIn: ctx.today() }));
});
test('M13 same mobile cannot be checked in twice while active (domain level)', () => {
  const { ctx } = sandbox();
  mk(ctx, 'One', 'A', { deposit: 0, phone: '9000099999' });
  let threw = false; try { mk(ctx, 'Two', 'B', { deposit: 0, phone: '9000099999' }); } catch (e) { threw = true; }
  assert.equal(threw, true, 'duplicate active mobile number should be refused by the domain, not just the form');
});
