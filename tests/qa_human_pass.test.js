'use strict';
// Regression tests for defects found while entering data by hand, panel by panel.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function sandbox() {
  const store = new Map();
  const ctx = { console, Date, Math, JSON, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(), key: i => [...store.keys()][i] || null, get length() { return store.size; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} }, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
    navigator: { userAgent: 'NodeTest', platform: 'Win32' }, location: { search: '', pathname: '/', hostname: 'localhost', protocol: 'http:' },
    document: { hidden: false, title: '', addEventListener() {}, removeEventListener() {} }, openModal() {}, closeModal() {}, updateChrome() {}, toast() {}, t: (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (m, k) => p[k]) : s), esc: s => s, inr: n => '₹' + n };
  ctx.window = ctx; ctx.window.HOSTELOS_CONFIG = {}; ctx.self = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  vm.runInContext('Object.assign(globalThis,{Store,checkIn,moveReading,addReading,leaveProblem,pendingMeter,today,addDays});', ctx);
  const S = ctx.Store; S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'org1', modules: { electricity: true }, status: 'active', owner_name: 'Owner' }];
  S.hostels = [{ id: 'h1', org_id: 'org1', name: 'QA', settings: { elec: { rate: 10, freeUnits: 0, freeMode: 'resident' } } }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };
  S.put('room', { id: 'r1', no: '101', floor: '1', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  return { ctx, S };
}

test('leave: max 60 days, no overlap, end not before start', () => {
  const { ctx, S } = sandbox();
  const d = ctx.today();
  assert.match(ctx.leaveProblem('x', ctx.addDays(d, 3), ctx.addDays(d, 1)), /before start/);
  assert.match(ctx.leaveProblem('x', ctx.addDays(d, 1), ctx.addDays(d, 400)), /at most 60 days/);
  assert.equal(ctx.leaveProblem('x', ctx.addDays(d, 1), ctx.addDays(d, 30)), '');
  S.put('leave', { resId: 'x', from: ctx.addDays(d, 5), to: ctx.addDays(d, 9), date: ctx.addDays(d, 5) });
  assert.match(ctx.leaveProblem('x', ctx.addDays(d, 8), ctx.addDays(d, 12)), /already a leave/);
  assert.equal(ctx.leaveProblem('y', ctx.addDays(d, 8), ctx.addDays(d, 12)), '', 'another resident is unaffected');
});

test('meter: a second reading cannot be added while one is waiting for approval (would bill the same units twice)', () => {
  const { ctx } = sandbox();
  const r = (ctx.moveReading('r1', 100, '2026-11-01'), ctx.checkIn({ name: 'Mtr One', phone: '9000000061', roomId: 'r1', bed: 'A', rent: 6000, deposit: 0, checkIn: '2026-11-01' }));
  assert.ok(r);
  ctx.addReading({ roomId: 'r1', curr: 100 + 1900, date: '2026-11-10' });   // absurdly high -> goes to review
  assert.ok(ctx.pendingMeter('r1'), 'first one waits for approval');
  assert.throws(() => ctx.addReading({ roomId: 'r1', curr: 100 + 1950, date: '2026-11-11' }), /already waiting for your approval/);
});

test('purchase receive: negative / absurd quantity or rate refused, nothing booked', () => {
  const { ctx, S } = sandbox();
  vm.runInContext('Object.assign(globalThis,{createPR,receivePR,stockOf,itemById});', ctx);
  const it = S.put('item', { id: 'it-x', name: 'Atta', unit: 'kg', stock: 0, min: 0, rate: 0, active: true });
  const pr = ctx.createPR({ items: [{ itemId: it.id, qty: 25 }] });
  for (const bad of [{ qty: -50, rate: 40 }, { qty: 10, rate: -5 }, { qty: 9999999, rate: 40 }, { qty: 0, rate: 40 }]) assert.throws(() => ctx.receivePR(pr.id, { [it.id]: bad }), /negative|too large|at least one/);
  assert.equal(S.get(pr.id).status, 'approved', 'still open');
  assert.equal(S.all('exp').filter(e => e.ref === pr.id).length, 0);
  ctx.receivePR(pr.id, { [it.id]: { qty: 25, rate: 40 } });
  assert.equal(ctx.stockOf(ctx.itemById(it.id)), 25);
});

test('stock count: a negative counted quantity is refused', () => {
  const { ctx, S } = sandbox();
  vm.runInContext('Object.assign(globalThis,{countTo,stockOf,itemById,createPR});', ctx);
  const it = S.put('item', { id: 'it-y', name: 'Dal', unit: 'kg', stock: 10, min: 0, rate: 0, active: true });
  let threw = false; try { ctx.countTo(it.id, -4, 'count'); } catch (e) { threw = true; }
  assert.equal(threw, true, 'counted stock below zero must not be accepted');
  assert.ok(ctx.stockOf(ctx.itemById(it.id)) >= 0);
});

test('bill breakdown: rent, late fee and electricity are separated by month and add up', () => {
  const { ctx, S } = sandbox();
  vm.runInContext('Object.assign(globalThis,{billBreakdown,addInvoice,resInvoices});', ctx);
  const r = ctx.checkIn({ name: 'Bill Res', phone: '9000000071', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-11-01' });
  ctx.addInvoice({ resId: r.id, roomId: 'r1', type: 'late', period: '2026-11', title: 'Late fee', amount: 200, date: '2026-11-10' });
  ctx.addInvoice({ resId: r.id, roomId: 'r1', type: 'electricity', period: '2026-11', title: 'Electricity', amount: 450, date: '2026-11-30' });
  const b = ctx.billBreakdown(r.id, 3).find(x => x.ym === '2026-11');
  assert.equal(b.late, 200); assert.equal(b.electricity, 450); assert.equal(b.rent, 6000);
  assert.equal(b.total, 6650, 'deposit is not part of the monthly bill');
});

test('insights: quarter / half-year / year give 3 / 6 / 12 months, oldest first', () => {
  const { ctx } = sandbox();
  vm.runInContext('Object.assign(globalThis,{bizInsights});', ctx);
  for (const n of [3, 6, 12]) { const I = ctx.bizInsights(n); assert.equal(I.months.length, n); assert.ok(I.months[0].ym < I.months[n - 1].ym); }
});
