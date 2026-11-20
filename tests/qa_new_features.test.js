'use strict';
// QA: features added during the Nov-19 QA pass (accessories, salary reminder, roll call, tiffin note, gate switch, honest email).
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
  vm.runInContext('Object.assign(globalThis,{Store,checkIn,checkout,salaryReminders,payrollFor,rcallMark,rcallUndo,attRollCall,setTifNote,tifNoteOf,toggleTiffin,accOn,accItems,sendBrandedEmail,sendAgreementEmail,createAgreement,inboxItems,today,ymOf,addDays,staffSalarySummary});', ctx);
  const S = ctx.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'org1', modules: { electricity: true, attendance: true, staff: true, gate: true, mess: true }, status: 'active', owner_name: 'Owner' }];
  S.hostels = [{ id: 'h1', org_id: 'org1', name: 'QA PG', settings: { elec: { rate: 10 }, ...settings } }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };
  S.put('room', { id: 'r1', no: '101', floor: '1', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  return { ctx, S };
}

test('accessories: ticked at check-in, returned subset recorded at checkout, missing listed', () => {
  const { ctx, S } = sandbox();
  assert.equal(ctx.accOn(), true);
  const r = ctx.checkIn({ name: 'Acc One', phone: '9000000011', roomId: 'r1', bed: 'A', rent: 6000, deposit: 0, checkIn: ctx.today(), accessories: ['Mattress', 'Pillow', 'Room key'] });
  assert.equal(JSON.stringify(S.get(r.id).accessories.given), JSON.stringify(['Mattress', 'Pillow', 'Room key']));
  ctx.checkout(r.id, ctx.today(), 0, '', { settleBalance: 'waive', accReturned: ['Mattress', 'Pillow'] });
  const after = S.get(r.id);
  assert.equal(JSON.stringify(after.accessories.missing), JSON.stringify(['Room key']));
  assert.equal(after.status, 'left');
});
test('accessories: switched off per hostel -> accOn() false', () => {
  const { ctx } = sandbox({ accessories: { on: false, items: ['Mattress'] } });
  assert.equal(ctx.accOn(), false);
});
test('salary: never auto-booked; reminder appears from the 25th and vanishes once paid', () => {
  const { ctx, S } = sandbox();
  S.put('staff', { id: 'st1', name: 'Cook Ram', salary: 12000, status: 'active', joinDate: '2026-01-01', dept: 'Kitchen', role: 'cook' });
  const day = ym => `${ym}-26`;
  const ym = ctx.ymOf(ctx.today());
  assert.equal(S.all('exp').filter(e => e.cat === 'Salary').length, 0, 'nothing booked automatically');
  const rem = ctx.salaryReminders(day(ym));
  assert.ok(rem.some(x => x.staffId === 'st1' && x.ym === ym), 'reminder due');
  assert.equal(ctx.salaryReminders(`${ym}-10`).filter(x => x.ym === ym).length, 0, 'not before the 25th for the running month');
  S.put('sal', { id: 'sal1', staffId: 'st1', ym, amount: 12000, advDeducted: 0, type: 'salary', date: day(ym) });
  assert.equal(ctx.salaryReminders(day(ym)).filter(x => x.ym === ym).length, 0, 'reminder gone after booking');
});
test('roll call: residents move from waiting to called; absent stored; undo moves back', () => {
  const { ctx } = sandbox();
  const a = ctx.checkIn({ name: 'Roll A', phone: '9000000021', roomId: 'r1', bed: 'A', rent: 6000, deposit: 0, checkIn: ctx.addDays(ctx.today(), -5) });
  const b = ctx.checkIn({ name: 'Roll B', phone: '9000000022', roomId: 'r1', bed: 'B', rent: 6000, deposit: 0, checkIn: ctx.addDays(ctx.today(), -5) });
  const d = ctx.today(), pk = 'night';
  let roll = ctx.attRollCall(d, pk);
  assert.equal(roll.waiting.length, 2); assert.equal(roll.called.length, 0);
  ctx.rcallMark(a.id, d, pk, false);
  ctx.rcallMark(b.id, d, pk, true);
  roll = ctx.attRollCall(d, pk);
  assert.equal(roll.waiting.length, 0); assert.equal(roll.called.length, 2); assert.equal(roll.absent, 1);
  ctx.rcallUndo(b.id, d, pk);
  roll = ctx.attRollCall(d, pk);
  assert.equal(JSON.stringify(roll.waiting.map(x => x.id)), JSON.stringify([b.id])); assert.equal(roll.absent, 0);
  // yesterday was taken the old way (no call record): everyone counts as already called
  assert.equal(ctx.attRollCall(ctx.addDays(d, -1), pk).waiting.length, 0);
});
test('tiffin: resident sets one short note once; every tiffin order carries it; capped at 60 chars', () => {
  const { ctx, S } = sandbox();
  const r = ctx.checkIn({ name: 'Tif Res', phone: '9000000031', roomId: 'r1', bed: 'A', rent: 6000, deposit: 0, checkIn: ctx.addDays(ctx.today(), -3) });
  ctx.setTifNote(r.id, '3 roti, dry sabzi, no curd ' + 'x'.repeat(100));
  assert.ok(ctx.tifNoteOf(r.id).length <= 60);
  ctx.toggleTiffin(r.id, ctx.addDays(ctx.today(), 1), 'dinner');
  const tif = S.all('tiffin').find(x => x.date === ctx.addDays(ctx.today(), 1));
  assert.ok(tif.note.startsWith('3 roti'));
  assert.equal(S.all('tiffin').filter(x => x.date === '' ).length, 1, 'template row is not a dated order');
});
test('email: demo / unconfigured sending never reports delivered', async () => {
  const { ctx } = sandbox();
  const res = await ctx.sendBrandedEmail({ to: 'a@b.com', subject: 's', html: '<p>x</p>', text: 'x' });
  assert.equal(res.delivered, false);
  const bad = await ctx.sendBrandedEmail({ to: 'not-an-email', subject: 's', html: '', text: '' });
  assert.equal(bad.ok, false);
});
test('agreement email: auto flow never marks "delivered" without provider confirmation', () => {
  const { ctx, S } = sandbox();
  const r = ctx.checkIn({ name: 'Agr Res', phone: '9000000041', email: 'agr@example.com', roomId: 'r1', bed: 'A', rent: 6000, deposit: 0, checkIn: ctx.today() });
  const agr = ctx.createAgreement({ resId: r.id });
  const out = ctx.sendAgreementEmail(agr.id);
  assert.equal(out.status, 'sent');
  assert.notEqual(S.get(agr.id).emailStatus, 'delivered');
});

test('insights: trend, cost rows, bounded forecast, scenario maths and commentary', () => {
  const { ctx, S } = sandbox();
  vm.runInContext('Object.assign(globalThis,{bizInsights,scenarioCalc});', ctx);
  const r = ctx.checkIn({ name: 'Ins One', phone: '9000000051', roomId: 'r1', bed: 'A', rent: 6000, deposit: 0, checkIn: '2026-01-01' });
  const cur = ctx.ymOf(ctx.today());
  const mk = n => { const [y, m] = cur.split('-').map(Number); const d = new Date(y, m - 1 - n, 10); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10`; };
  for (let n = 1; n <= 4; n++) {
    S.put('pay', { id: 'p' + n, resId: r.id, amount: 100000 + n * 1000, mode: 'upi', date: mk(n), no: 'R' + n });
    S.put('exp', { id: 'e' + n, cat: 'Salary', amount: 40000, mode: 'cash', paid: true, date: mk(n) });
  }
  const I = ctx.bizInsights(6);
  assert.equal(I.haveData, true);
  assert.equal(I.forecast.length, 3);
  for (const f of I.forecast) { assert.ok(f.income >= I.avgIncome * 0.7 - 1 && f.income <= I.avgIncome * 1.3 + 1, 'forecast stays within 30% of the recent average'); }
  assert.equal(I.costRows[0].cat, 'Salary');
  const base = ctx.scenarioCalc(I, {});
  assert.ok(Math.abs(base.profit - I.avgProfit) <= 2, 'zero-change scenario equals today');
  assert.ok(ctx.scenarioCalc(I, { rent: 10 }).profit > base.profit, 'higher rent -> more profit');
  assert.ok(ctx.scenarioCalc(I, { cost: 10 }).profit < base.profit, 'higher cost -> less profit');
  assert.ok(I.notes.length >= 2 && I.notes.every(n => n.text.length > 10));
});

test('tiffin note keeps its letters exactly (regression: an escape bug turned every "s" into a space)', () => {
  const { ctx } = sandbox();
  const r = ctx.checkIn({ name: 'Tif Two', phone: '9000000032', roomId: 'r1', bed: 'A', rent: 6000, deposit: 0, checkIn: ctx.addDays(ctx.today(), -3) });
  ctx.setTifNote(r.id, '3 roti,   dry sabzi,  no curd');
  assert.equal(ctx.tifNoteOf(r.id), '3 roti, dry sabzi, no curd');
});

test('police verification sheet: only the identity / family / stay / property fields and ID papers, never money or other papers', () => {
  const { ctx, S } = sandbox();
  vm.runInContext('Object.assign(globalThis,{pvSheet,roomById})', ctx);
  S.hostels[0].address = 'Sector 4, Kota';
  const r = S.put('res', { id: 'x1', name: 'Asha Rao', phone: '9876500001', guardian: 'Mohan Rao', guardianPhone: '9876500002', idNo: '123412341234', address: 'Jaipur', college: 'Allen', email: 'a@b.in', roomId: 'r1', bed: 'A',
    checkIn: '2026-10-08', rent: 7350, deposit: 7350, credit: 913, notes: 'owes lab fee', docs: [{ type: 'Aadhaar card', path: 'p1' }, { type: 'Passport photo', path: 'p2' }, { type: 'Rental agreement', path: 'p3' }, { type: 'Medical report', path: 'p4' }] });
  const v = ctx.pvSheet(r);
  const flat = JSON.stringify(v);
  for (const secret of ['7350', '913', 'lab fee', 'a@b.in', 'Rental agreement', 'Medical report']) assert.ok(!flat.includes(secret), 'must not expose ' + secret);
  assert.equal(v.docs.length, 2, 'only ID proof and photo');
  const labels = [...v.tenant, ...v.stay, ...v.property].map(x => x[0]);
  assert.equal(labels.join('|'), 'Full name|Father / guardian name|Guardian mobile|Tenant mobile|Aadhaar number|Permanent address|College / workplace|Room and bed|Staying since|Hostel / PG name|Hostel address');
  assert.equal(v.missing.length, 0);
  assert.deepEqual(Array.from(ctx.pvSheet({ ...r, guardian: '', idNo: '' }).missing), ['Father / guardian name', 'Aadhaar number']);
});

test('online payments (Cashfree) is opt-in per hostel: off unless modules.cashfree is true, and the switch writes true / removes the key', () => {
  const { ctx, S } = sandbox();
  vm.runInContext('Object.assign(globalThis,{orgEnabled,applyModSwitch,OPT_IN_MODULES})', ctx);
  assert.equal(ctx.orgEnabled('cashfree'), false, 'default off');
  S.hostels[0].modules = { cashfree: true };
  assert.equal(ctx.orgEnabled('cashfree'), true);
  S.hostels[0].modules = { cashfree: false };
  assert.equal(ctx.orgEnabled('cashfree'), false);
  S.hostels[0].modules = { cashfree: true }; S.orgs[0].modules = { ...S.orgs[0].modules, cashfree: false };
  assert.equal(ctx.orgEnabled('cashfree'), false, 'a client-wide "not in plan" still wins');
  assert.equal(JSON.stringify(ctx.applyModSwitch({}, 'cashfree', true).modules), JSON.stringify({ cashfree: true }));
  assert.equal(JSON.stringify(ctx.applyModSwitch({ cashfree: true, laundry: false }, 'cashfree', false).modules), JSON.stringify({ laundry: false }));
  assert.equal(ctx.orgEnabled('laundry'), true, 'ordinary modules keep their on-by-default rule');
});
