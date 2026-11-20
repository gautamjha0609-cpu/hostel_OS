'use strict';
// The three worked examples from the owner's note (period-by-period, occupants-in-that-period split).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function sandbox() {
  const store = new Map();
  const ctx = { console, Date, Math, JSON, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(), key: i => [...store.keys()][i] || null, get length() { return store.size; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} }, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
    navigator: { userAgent: 'NodeTest', platform: 'Win32' }, location: { search: '', pathname: '/', hostname: 'localhost', protocol: 'http:' },
    document: { hidden: false, title: '', addEventListener() {}, removeEventListener() {} }, openModal() {}, closeModal() {}, updateChrome() {}, toast() {}, t: s => s, esc: s => s, inr: n => '₹' + n };
  ctx.window = ctx; ctx.window.HOSTELOS_CONFIG = {}; ctx.self = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  vm.runInContext('Object.assign(globalThis,{Store,checkIn,checkout,moveReading,addReading});', ctx);
  const S = ctx.Store; S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'org1', modules: { electricity: true }, status: 'active', owner_name: 'Owner' }];
  S.hostels = [{ id: 'h1', org_id: 'org1', name: 'QA', settings: { elec: { rate: 100, freeUnits: 0, freeMode: 'resident' } } }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };
  S.put('room', { id: 'r1', no: '1', floor: '1', rent: 6000, beds: ['A', 'B', 'C'].map(id => ({ id, status: 'vac' })) });
  return { ctx, S };
}
const units = (S, id) => S.all('inv').filter(i => i.type === 'electricity' && i.resId === id).reduce((a, i) => a + i.amount / 100, 0);
const join = (ctx, n, bed, d, reading, ph) => { if (reading != null) ctx.moveReading('r1', reading, d); return ctx.checkIn({ name: n, phone: ph, roomId: 'r1', bed, rent: 6000, deposit: 0, checkIn: d }); };

test('Example 1: A from 1st, B joins 15th; readings 100 / 175 / 200 -> A 87.5, B 12.5', () => {
  const { ctx, S } = sandbox();
  const A = join(ctx, 'A', 'A', '2026-11-01', 100, '9000000001');
  const B = join(ctx, 'B', 'B', '2026-11-15', 175, '9000000002');
  ctx.addReading({ roomId: 'r1', curr: 200, date: '2026-11-30' });
  assert.equal(units(S, A.id), 87.5); assert.equal(units(S, B.id), 12.5);
});
test('Example 2: A 1st, B 10th, C 20th; readings 100/145/205/265 -> A 95, B 50, C 20', () => {
  const { ctx, S } = sandbox();
  const A = join(ctx, 'A', 'A', '2026-11-01', 100, '9000000001');
  const B = join(ctx, 'B', 'B', '2026-11-10', 145, '9000000002');
  const C = join(ctx, 'C', 'C', '2026-11-20', 205, '9000000003');
  ctx.addReading({ roomId: 'r1', curr: 265, date: '2026-11-30' });
  assert.equal(units(S, A.id), 95); assert.equal(units(S, B.id), 50); assert.equal(units(S, C.id), 20);
});
test('Example 3: A,B from 1st, C joins 26th; readings 100/200/240 -> A 63.33, B 63.33, C 13.34 (rounded to 1 paisa unit)', () => {
  const { ctx, S } = sandbox();
  const A = join(ctx, 'A', 'A', '2026-11-01', 100, '9000000001');
  const B = join(ctx, 'B', 'B', '2026-11-01', 100, '9000000002');
  const C = join(ctx, 'C', 'C', '2026-11-26', 200, '9000000003');
  ctx.addReading({ roomId: 'r1', curr: 240, date: '2026-11-30' });
  const a = units(S, A.id), b = units(S, B.id), c = units(S, C.id);
  console.log('ex3 A,B,C =', a, b, c, 'sum', a + b + c);
  assert.ok(Math.abs(a - 63.33) <= 0.02 && Math.abs(b - 63.33) <= 0.02 && Math.abs(c - 13.33) <= 0.02);
  assert.ok(Math.abs(a + b + c - 140) <= 0.05, 'whole bill is shared');
});
test('Leaving mid-period: A,B from 1st; B leaves 16th (reading 130 taken at exit); month-end 200', () => {
  const { ctx, S } = sandbox();
  const A = join(ctx, 'A', 'A', '2026-11-01', 100, '9000000001');
  const B = join(ctx, 'B', 'B', '2026-11-01', 100, '9000000002');
  ctx.checkout(B.id, '2026-11-16', 0, '', { reading: 130, settleBalance: 'waive' });
  ctx.addReading({ roomId: 'r1', curr: 190, date: '2026-11-30' });
  assert.equal(units(S, B.id), 15, 'B: half of the first 30 units');
  assert.equal(units(S, A.id), 15 + 60, 'A: other half of 30 + all 60 later');
});
test('No reading taken when C joined: units of the whole stretch are split by days stayed (documented estimate)', () => {
  const { ctx, S } = sandbox();
  const A = join(ctx, 'A', 'A', '2026-11-01', 100, '9000000001');
  const B = join(ctx, 'B', 'B', '2026-11-01', 100, '9000000002');
  const C = join(ctx, 'C', 'C', '2026-11-26', null, '9000000003');   // owner forgot the reading
  ctx.addReading({ roomId: 'r1', curr: 240, date: '2026-11-30' });
  const a = units(S, A.id), b = units(S, B.id), c = units(S, C.id);
  console.log('no-reading A,B,C =', a, b, c);
  assert.ok(Math.abs(a + b + c - 140) <= 1);
});

test('free units: a resident who stayed the whole month 1st-30th gets the full monthly free units (not 29/30), readings on the last day of the month count that day', () => {
  const { ctx, S } = sandbox();
  S.hostels[0].settings.elec = { rate: 9, freeUnits: 2, freeMode: 'resident', pricing: 'fixed' };
  const A = join(ctx, 'A', 'A', '2026-11-01', 100, '9000000001');
  const B = join(ctx, 'B', 'B', '2026-11-18', 170, '9000000002');
  const C = join(ctx, 'C', 'C', '2026-11-26', 190, '9000000003');
  ctx.addReading({ roomId: 'r1', curr: 210, date: '2026-11-30' });
  const free = id => S.all('meter').flatMap(m => m.shares || []).filter(s => s.resId === id).reduce((a, s) => a + s.free, 0);
  assert.ok(Math.abs(free(A.id) - 2) < 0.02, 'A stayed all 30 days -> 2 free units, got ' + free(A.id));
  assert.ok(Math.abs(free(B.id) - 2 * 13 / 30) < 0.02, 'B stayed 18th..30th = 13 days, got ' + free(B.id));
  assert.ok(Math.abs(free(C.id) - 2 * 5 / 30) < 0.02, 'C stayed 26th..30th = 5 days, got ' + free(C.id));
});

test('free units follow the real length of the month: a whole stay earns the whole monthly free units, part of a month earns days / days-in-month', () => {
  const freeFor = (from, to, free = 31) => {
    const { ctx, S } = sandbox();
    S.hostels[0].settings.elec = { rate: 9, freeUnits: free, freeMode: 'resident', pricing: 'fixed' };
    const A = join(ctx, 'A', 'A', from, 100, '9000000001');
    const m = ctx.addReading({ roomId: 'r1', curr: 200, date: to });
    return m.shares.find(s => s.resId === A.id).free;
  };
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.02, `${msg}: expected ${b}, got ${a}`);
  near(freeFor('2026-12-01', '2026-12-31'), 31, '31-day month, whole stay');
  near(freeFor('2027-02-01', '2027-02-28', 28), 28, '28-day month, whole stay');
  near(freeFor('2028-02-01', '2028-02-29', 29), 29, '29-day month, whole stay');
  near(freeFor('2026-11-01', '2026-11-30', 30), 30, '30-day month, whole stay');
  near(freeFor('2026-12-17', '2026-12-31', 31), 15, '17th to the end of a 31-day month = 15 of 31 days');
  near(freeFor('2027-02-14', '2027-02-28', 28), 15, '14th to the end of a 28-day February = 15 of 28 days');
});

test('the day a resident leaves counts as a day stayed for free units: leaving on 14 Dec earns 14 days of the month, the others 13 days on that stretch', () => {
  const { ctx, S } = sandbox();
  S.hostels[0].settings.elec = { rate: 9, freeUnits: 2, freeMode: 'resident', pricing: 'fixed' };
  const A = join(ctx, 'A', 'A', '2026-11-01', 100, '9000000001');
  const B = join(ctx, 'B', 'B', '2026-11-01', 100, '9000000002');
  ctx.addReading({ roomId: 'r1', curr: 210, date: '2026-11-30' });
  ctx.checkout(A.id, '2026-12-14', 0, '', { reading: 250, settleBalance: 'waive' });
  const sh = S.all('meter').find(m => m.date === '2026-12-14').shares;
  const a = sh.find(s => s.resId === A.id), b = sh.find(s => s.resId === B.id);
  assert.ok(Math.abs(a.free - 2 * 14 / 31) < 0.01, 'leaver: 14 of 31 days, got ' + a.free);
  assert.ok(Math.abs(b.free - 2 * 13 / 31) < 0.01, 'stays on: 13 of 31 days on this stretch, got ' + b.free);
});

test('flat-rate pricing also bills the fixed monthly meter charge, shared by days stayed and only for the days covered', () => {
  const { ctx, S } = sandbox();
  S.hostels[0].settings.elec = { rate: 10, freeUnits: 0, freeMode: 'resident', pricing: 'fixed', fixedCharge: 60 };
  const A = join(ctx, 'A', 'A', '2026-11-01', 100, '9000000001');
  const B = join(ctx, 'B', 'B', '2026-11-01', 100, '9000000002');
  const m = ctx.addReading({ roomId: 'r1', curr: 140, date: '2026-11-30' });   // 40 units, the whole month
  const amt = id => m.shares.find(s => s.resId === id).amount;
  assert.equal(amt(A.id) + amt(B.id), 40 * 10 + 60, 'units at 10 plus the 60 meter charge');
  assert.equal(amt(A.id), amt(B.id), 'equal stay -> equal share');
  S.hostels[0].settings.elec = { rate: 10, freeUnits: 0, freeMode: 'resident', pricing: 'fixed', fixedCharge: 0 };
  const m2 = ctx.addReading({ roomId: 'r1', curr: 180, date: '2026-12-31' });
  assert.equal(m2.shares.reduce((a, s) => a + s.amount, 0), 400, 'no meter charge -> units only');
});
