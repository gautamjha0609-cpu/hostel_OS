'use strict';
// QA: kitchen stock, purchase receive, laundry quota, meal skip cut-off, menu/dish impact on consumption.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sandbox() {
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
  vm.runInContext('Object.assign(globalThis,{Store,checkIn,createPR,receivePR,stockOf,laundryReceive,laundryQuote,toggleSkip,toggleTiffin,headcount,postConsumption,today,addDays,resDue,itemById,parse});', ctx);
  const S = ctx.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'org1', modules: { electricity: true, mess: true, kitchen: true, laundry: true }, status: 'active', owner_name: 'Owner' }];
  S.hostels = [{ id: 'h1', org_id: 'org1', name: 'QA PG', settings: { elec: { rate: 10 }, laundry: { freePcs: 10, rate: 5 } } }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };
  S.put('room', { id: 'r1', no: '101', floor: '1', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  return { ctx, S };
}
const res = (ctx, n, bed) => ctx.checkIn({ name: n, phone: '90000' + String(Math.floor(10000 + Math.random() * 89999)), roomId: 'r1', bed, rent: 6000, deposit: 0, checkIn: ctx.addDays(ctx.today(), -10), food: true });

test('K1 purchase receive adds stock, books ONE expense, updates item price; pressing twice changes nothing', () => {
  const { ctx, S } = sandbox();
  const it = S.put('item', { id: 'it-rice', name: 'Rice', unit: 'kg', stock: 0, min: 5, rate: 0, active: true });
  const pr = ctx.createPR({ items: [{ itemId: it.id, qty: 50 }] });
  ctx.receivePR(pr.id, { [it.id]: { qty: 50, rate: 60 } }, { vendor: 'Shop', mode: 'cash' });
  ctx.receivePR(pr.id, { [it.id]: { qty: 50, rate: 60 } }, { vendor: 'Shop', mode: 'cash' });
  assert.equal(ctx.stockOf(ctx.itemById(it.id)), 50);
  assert.equal(S.all('exp').filter(e => e.ref === pr.id).length, 1);
  assert.equal(S.all('exp').find(e => e.ref === pr.id).amount, 3000);
  assert.equal(S.get(it.id).rate, 60, 'last price comes from the purchase');
});
test('K2 daily consumption follows dishes on the menu and the real head-count, and is booked once per day', () => {
  const { ctx, S } = sandbox();
  const it = S.put('item', { id: 'it-dal', name: 'Dal', unit: 'kg', stock: 0, min: 0, rate: 100, active: true });
  const pr = ctx.createPR({ items: [{ itemId: it.id, qty: 20 }] });
  ctx.receivePR(pr.id, { [it.id]: { qty: 20, rate: 100 } });
  S.put('dish', { id: 'dish-dal', name: 'Dal tadka', meal: 'any', serves: 10, ings: [{ itemId: it.id, qty: 1 }] });
  const d = ctx.today(), dow = ctx.parse(d).getDay();
  const meal = vm.runInContext('meals()[0].k', ctx);
  S.put('menu', { id: 'menu', week: { [dow]: { [meal]: ['dish-dal'] } } });
  res(ctx, 'E1', 'A'); res(ctx, 'E2', 'B');
  const before = ctx.stockOf(ctx.itemById(it.id));
  assert.equal(ctx.postConsumption(d), true);
  const after = ctx.stockOf(ctx.itemById(it.id));
  assert.ok(after < before, 'stock went down');
  assert.equal(ctx.postConsumption(d), false, 'second run the same day is a no-op');
  assert.equal(ctx.stockOf(ctx.itemById(it.id)), after);
});
test('K3 skipped meal lowers head-count; tiffin is counted separately', () => {
  const { ctx } = sandbox();
  const a = res(ctx, 'Sk1', 'A'), b = res(ctx, 'Sk2', 'B');
  const d = ctx.addDays(ctx.today(), 1), meal = vm.runInContext('meals()[0].k', ctx);
  const h0 = ctx.headcount(d, meal);
  ctx.toggleSkip(a.id, d, meal);
  const h1 = ctx.headcount(d, meal);
  assert.equal(h1.eat, h0.eat - 1);
  assert.equal(h1.skip, h0.skip + 1);
  ctx.toggleTiffin(b.id, d, meal);
  assert.equal(ctx.headcount(d, meal).tiffin, 1);
});
test('L1 laundry: free pieces per month then charged per extra piece, billed once', () => {
  const { ctx, S } = sandbox();
  const r = res(ctx, 'Lnd', 'A');
  const a = ctx.laundryReceive({ resId: r.id, pcs: 8 });
  assert.equal(a.q.charge, 0);
  const b = ctx.laundryReceive({ resId: r.id, pcs: 6 });
  assert.equal(b.q.extra, 4); assert.equal(b.q.charge, 20);
  assert.equal(S.all('inv').filter(i => i.type === 'laundry').length, 1);
  assert.throws(() => ctx.laundryReceive({ resId: r.id, pcs: 0 }));
  assert.throws(() => ctx.laundryReceive({ resId: r.id, pcs: 101 }));
});
