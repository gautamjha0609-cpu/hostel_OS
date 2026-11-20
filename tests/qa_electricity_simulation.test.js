'use strict';
// QA simulation: electricity billing for every join / leave / read permutation the owner described.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sandbox(elec = {}) {
  const store = new Map();
  const ctx = {
    console, Date, Math, JSON, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(), key: i => [...store.keys()][i] || null, get length() { return store.size; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
    navigator: { userAgent: 'NodeTest', platform: 'Win32' },
    location: { search: '', pathname: '/', hostname: 'localhost', protocol: 'http:' },
    document: { hidden: false, title: '', addEventListener() {}, removeEventListener() {} },
    openModal() {}, closeModal() {}, updateChrome() {}, toast() {}, t: s => s, esc: s => s, inr: n => '₹' + n,
  };
  ctx.window = ctx; ctx.window.HOSTELOS_CONFIG = {}; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  vm.runInContext('globalThis.Store=Store;globalThis.checkIn=checkIn;globalThis.checkout=checkout;globalThis.moveReading=moveReading;globalThis.addReading=addReading;globalThis.resDue=resDue;globalThis.invoices=invoices;globalThis.openInv=openInv;globalThis.invBal=invBal;globalThis.calcSettlement=calcSettlement;', ctx);
  const S = ctx.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'org1', modules: { electricity: true }, status: 'active', owner_name: 'Owner' }];
  S.hostels = [{ id: 'h1', org_id: 'org1', name: 'QA PG', settings: { elec: { rate: 10, freeUnits: 0, freeMode: 'resident', ...elec }, rent: { prorate: 'daily' } } }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };
  S.put('room', { id: 'r1', no: '101', floor: '1', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }, { id: 'C', status: 'vac' }] });
  return { ctx, S };
}
const elec = (S, resId) => S.all('inv').filter(i => i.type === 'electricity' && i.resId === resId).reduce((a, i) => a + i.amount, 0);
const join = (ctx, name, bed, date, reading, phone) => { ctx.moveReading('r1', reading, date); return ctx.checkIn({ name, phone, roomId: 'r1', bed, rent: 6000, deposit: 0, checkIn: date }); };

test('S1 owner example: A joins 12th @100, B joins 25th @150, read 30th @250 -> A 100 units, B 50', () => {
  const { ctx, S } = sandbox();
  const A = join(ctx, 'A', 'A', '2026-11-12', 100, '9000000001');
  const B = join(ctx, 'B', 'B', '2026-11-25', 150, '9000000002');
  ctx.addReading({ roomId: 'r1', curr: 250, date: '2026-11-30' });
  assert.equal(elec(S, A.id), 1000, 'A pays 50 units alone + 50 units shared = 100 units x Rs10');
  assert.equal(elec(S, B.id), 500, 'B pays 50 units');
});
test('S2 A checks out on 13th from a 2-person room: A settles his split at checkout, B pays rest at month-end', () => {
  const { ctx, S } = sandbox();
  const A = join(ctx, 'A', 'A', '2026-11-01', 0, '9000000001');
  const B = join(ctx, 'B', 'B', '2026-11-01', 0, '9000000002');
  const co = ctx.checkout(A.id, '2026-11-13', 0, '', { reading: 120, settleBalance: 'pay', payMode: 'cash' });
  assert.equal(elec(S, A.id), 600, 'A: 120 units / 2 people');
  assert.equal(ctx.resDue(A.id), 0, 'A leaves with zero due');
  ctx.addReading({ roomId: 'r1', curr: 200, date: '2026-11-30' });
  assert.equal(elec(S, B.id), 600 + 800, 'B: 60 (shared) + 80 (alone 13->30)');
  assert.ok(co);
});
test('S3 three people, staggered joins, day-weighted split sums to whole bill', () => {
  const { ctx, S } = sandbox();
  const A = join(ctx, 'A', 'A', '2026-11-01', 0, '9000000001');
  const B = join(ctx, 'B', 'B', '2026-11-11', 30, '9000000002');
  const C = join(ctx, 'C', 'C', '2026-11-21', 60, '9000000003');
  ctx.addReading({ roomId: 'r1', curr: 90, date: '2026-12-01' });
  const total = elec(S, A.id) + elec(S, B.id) + elec(S, C.id);
  assert.equal(total, 900, 'every unit billed exactly once');
});
test('S4 empty room stretch is never billed to the next arrival', () => {
  const { ctx, S } = sandbox();
  ctx.moveReading('r1', 100, '2026-11-01');
  const A = join(ctx, 'A', 'A', '2026-11-20', 140, '9000000001');
  assert.equal(elec(S, A.id), 0, 'units used while empty land on nobody');
  ctx.addReading({ roomId: 'r1', curr: 160, date: '2026-11-30' });
  assert.equal(elec(S, A.id), 200);
});
test('S5 free units honoured per day of stay (60 free units/month, resident mode)', () => {
  const { ctx, S } = sandbox({ freeUnits: 60 });
  const A = join(ctx, 'A', 'A', '2026-11-01', 0, '9000000001');
  ctx.addReading({ roomId: 'r1', curr: 100, date: '2026-12-01' });
  assert.equal(elec(S, A.id), 400, '100 units - 60 free = 40 x Rs10');
});
test('S6 same-day join and leave does not create a negative or duplicate bill', () => {
  const { ctx, S } = sandbox();
  const A = join(ctx, 'A', 'A', '2026-11-10', 10, '9000000001');
  ctx.checkout(A.id, '2026-11-10', 0, '', { reading: 10, settleBalance: 'waive' });
  assert.equal(elec(S, A.id), 0);
  assert.equal(S.all('inv').filter(i => i.amount <= 0).length, 0);
});
test('S7 checkout reading lower than last reading is rejected, no partial state', () => {
  const { ctx, S } = sandbox();
  const A = join(ctx, 'A', 'A', '2026-11-01', 100, '9000000001');
  ctx.moveReading('r1', 150, '2026-11-10');
  assert.throws(() => ctx.checkout(A.id, '2026-11-12', 0, '', { reading: 120, settleBalance: 'waive' }), /cannot be less than previous/);
  assert.equal(S.get(A.id).status, 'active', 'resident is still active - nothing half-done');
  assert.ok(S.all('inv').every(i => i.amount >= 0));
});
