'use strict';
// Standing weekly tiffin plan: set once, packed every week, one day can be changed until the cut-off.
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
  vm.runInContext('Object.assign(globalThis,{Store,checkIn,today,addDays,setTifPlan,tifPlanOf,tiffinOn,toggleTiffin,toggleSkip,headcount,tifPlanText,tifDaysText,tiffinsOnDate,ensureTifRec,tifRecOf,beforeCutoff,setTifNote,tiffinId,S,parse,skippedOn,skipsOnDate,skipId,monthMealStats,residents})', ctx);
  const S = ctx.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'org1', modules: { mess: true }, status: 'active' }];
  S.hostels = [{ id: 'h1', org_id: 'org1', name: 'PG', settings: {} }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };
  S.put('room', { id: 'r1', no: '101', floor: '1', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  const r = ctx.checkIn({ name: 'Plan Res', phone: '9000000041', roomId: 'r1', bed: 'A', rent: 6000, deposit: 0, checkIn: ctx.addDays(ctx.today(), -30) });
  return { ctx, S, r };
}
// the next date (at least 3 days ahead, so every cut-off is still open) that falls on the given weekday
const nextDay = (ctx, wd) => { let d = ctx.addDays(ctx.today(), 3); while (ctx.parse(d).getDay() !== wd) d = ctx.addDays(d, 1); return d; };

test('no plan, no tiffin: nothing is packed by default', () => {
  const { ctx, r } = sandbox();
  assert.equal(ctx.tiffinOn(r.id, nextDay(ctx, 2), 'lunch'), false);
  assert.equal(ctx.headcount(nextDay(ctx, 2), 'lunch').tiffin, 0);
});

test('a plan of Mon-Fri lunch packs lunch every weekday and not on the weekend, with no daily orders', () => {
  const { ctx, S, r } = sandbox();
  ctx.setTifPlan(r.id, { 1: ['lunch'], 2: ['lunch'], 3: ['lunch'], 4: ['lunch'], 5: ['lunch'] });
  for (const wd of [1, 2, 3, 4, 5]) assert.equal(ctx.tiffinOn(r.id, nextDay(ctx, wd), 'lunch'), true, 'weekday ' + wd);
  for (const wd of [6, 0]) assert.equal(ctx.tiffinOn(r.id, nextDay(ctx, wd), 'lunch'), false, 'weekend ' + wd);
  assert.equal(ctx.tiffinOn(r.id, nextDay(ctx, 3), 'dinner'), false, 'only the meals ticked');
  assert.equal(ctx.headcount(nextDay(ctx, 3), 'lunch').tiffin, 1, 'the cook sees it');
  assert.equal(S.all('tiffin').filter(x => x.date > ctx.addDays(ctx.today(), 2)).length, 0, 'no dated rows were written for the plan');
  assert.equal(ctx.tifPlanText(r.id), 'Lunch: Mon-Fri');
});

test('one day can be cancelled, and cancelling again brings it back; extra days can be added', () => {
  const { ctx, S, r } = sandbox();
  ctx.setTifPlan(r.id, { 3: ['lunch'] });
  const wed = nextDay(ctx, 3), thu = nextDay(ctx, 4);
  assert.equal(ctx.toggleTiffin(r.id, wed, 'lunch'), false);
  assert.equal(ctx.tiffinOn(r.id, wed, 'lunch'), false);
  assert.equal(S.get(ctx.tiffinId(r.id, wed, 'lunch')).status, 'off');
  assert.equal(ctx.toggleTiffin(r.id, wed, 'lunch'), true);
  assert.equal(ctx.tiffinOn(r.id, wed, 'lunch'), true);
  assert.ok(!S.get(ctx.tiffinId(r.id, wed, 'lunch')), 'back on the plan: no extra row left');
  assert.equal(ctx.toggleTiffin(r.id, thu, 'lunch'), true, 'an extra day outside the plan');
  assert.equal(ctx.tiffinOn(r.id, thu, 'lunch'), true);
  assert.equal(ctx.toggleTiffin(r.id, thu, 'lunch'), false);
  assert.ok(!S.get(ctx.tiffinId(r.id, thu, 'lunch')));
});

test('a skipped meal or a leave day gets no tiffin, and the plan resumes afterwards', () => {
  const { ctx, S, r } = sandbox();
  ctx.setTifPlan(r.id, { 3: ['dinner'] });
  const wed = nextDay(ctx, 3);
  ctx.toggleSkip(r.id, wed, 'dinner');
  assert.equal(ctx.tiffinOn(r.id, wed, 'dinner'), false);
  ctx.toggleSkip(r.id, wed, 'dinner');           // meal back on
  assert.equal(ctx.tiffinOn(r.id, wed, 'dinner'), true);
  S.put('leave', { resId: r.id, from: wed, to: wed, reason: 'home' });
  assert.equal(ctx.tiffinOn(r.id, wed, 'dinner'), false);
});

test('after the cut-off the day is frozen: toggling is refused for a resident, and a new plan cannot reach back into it', () => {
  const { ctx, S, r } = sandbox();
  S.ctx.role = 'resident'; S.ctx.refId = r.id;
  const today = ctx.today();
  // find a meal whose tiffin cut-off for today has passed, if any (depends on the clock); otherwise the rule is covered by the dated check below
  const closed = ctx.S().meals.map(m => m.k).find(k => !ctx.beforeCutoff(today, k, 'tiffin'));
  if (closed) {
    assert.throws(() => ctx.toggleTiffin(r.id, today, closed), /Cut-off/);
    const wd = ctx.parse(today).getDay();
    ctx.setTifPlan(r.id, { [wd]: [closed] });
    assert.equal(ctx.tiffinOn(r.id, today, closed), false, 'a plan saved after the cut-off does not add today');
  }
  // far in the past nothing can be toggled by a resident either
  assert.throws(() => ctx.toggleTiffin(r.id, ctx.addDays(today, -2), 'lunch'), /Cut-off/);
});

test('changing the plan: a day that was packed and is already locked stays packed', () => {
  const { ctx, S, r } = sandbox();
  const today = ctx.today(), wd = ctx.parse(today).getDay();
  const closed = ctx.S().meals.map(m => m.k).find(k => !ctx.beforeCutoff(today, k, 'tiffin'));
  if (!closed) return;
  // pretend the old plan already covered today's closed meal
  S.put('tiffin', { id: ctx.tiffinId(r.id, ctx.addDays(today, -1), 'x'), resId: r.id, date: ctx.addDays(today, -1), meal: 'x', status: 'requested' });
  S.put('tiffin', { id: 'tifplan-' + r.id, resId: r.id, date: '', meal: 'plan', status: 'template', plan: { [wd]: [closed] }, from: ctx.addDays(today, -7) });
  assert.equal(ctx.tiffinOn(r.id, today, closed), true);
  ctx.setTifPlan(r.id, {});
  assert.equal(ctx.tiffinOn(r.id, today, closed), true, 'already locked, so it is still packed today');
  assert.equal(ctx.tiffinOn(r.id, ctx.addDays(today, 7), closed), false, 'but not from next week');
});

test('the cook can mark a plan-made tiffin as packed: it is saved at that moment', () => {
  const { ctx, S, r } = sandbox();
  ctx.setTifPlan(r.id, { 3: ['lunch'] });
  const wed = nextDay(ctx, 3);
  const list = ctx.headcount(wed, 'lunch').tiffins;
  assert.equal(list.length, 1); assert.equal(list[0].fromPlan, true);
  ctx.ensureTifRec(r.id, wed, 'lunch'); S.patch(list[0].id, { status: 'packed' });
  assert.equal(ctx.headcount(wed, 'lunch').tiffins[0].status, 'packed');
  assert.equal(ctx.headcount(wed, 'lunch').tiffin, 1);
  assert.equal(ctx.tiffinsOnDate(wed).length, 1, 'the owner request list sees it too');
});

test('day text collapses ranges', () => {
  const { ctx } = sandbox();
  assert.equal(ctx.tifDaysText([1, 2, 3, 4, 5]), 'Mon-Fri');
  assert.equal(ctx.tifDaysText([1, 3, 6]), 'Mon, Wed, Sat');
  assert.equal(ctx.tifDaysText([1, 2, 3, 4, 5, 6, 0]), 'Every day');
});

test('screens: resident plan grid and shortcuts, cook list saves a plan tiffin, no database change needed', () => {
  const rs = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-resident.js'), 'utf8'), ops = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-ops.js'), 'utf8');
  assert.ok(rs.includes('A.rtifplan') && rs.includes('A.tpset') && rs.includes('From your weekly plan'));
  assert.ok(!rs.includes('tp-what') && !rs.includes('tp-sum') && !rs.includes('tp-hint'), 'the editor carries no explanation boxes or footer');
  assert.equal((rs.match(/data-act="rtifplan"/g) || []).length >= 1 && !rs.includes("'Weekly skip plan'"), true, 'one plan row on the Meals page, not one per kind');
  assert.ok(ops.includes('ensureTifRec(resId, date, meal)') && ops.includes('tiffinsOnDate(d)'));
  const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  assert.ok(/kind in \('skip','tiffin'/.test(schema), 'residents may already write the tiffin kind, so the plan row needs no migration');
});


/* ---- weekly SKIP plan, and every tiffin x skip x leave combination ---- */
test('skip plan: a skipped meal is not counted, not packed, and shows in the owner list', () => {
  const { ctx, r } = sandbox();
  ctx.setTifPlan(r.id, undefined, { 6: ['dinner'], 0: ['dinner'] });
  const sat = nextDay(ctx, 6), mon = nextDay(ctx, 1);
  assert.equal(ctx.skippedOn(r.id, sat, 'dinner'), true);
  assert.equal(ctx.skippedOn(r.id, mon, 'dinner'), false);
  const hc = ctx.headcount(sat, 'dinner');
  assert.equal(hc.skip, 1); assert.equal(hc.eat, hc.eligible - 1);
  assert.equal(ctx.skipsOnDate(sat).length, 1);
  assert.equal(ctx.tifPlanText(r.id, 'skipPlan'), 'Dinner: Sat, Sun');
});

test('tiffin and skip on the same meal and day: skip wins (no food, no tiffin)', () => {
  const { ctx, r } = sandbox();
  ctx.setTifPlan(r.id, { 6: ['dinner', 'lunch'] }, { 6: ['dinner'] });
  const sat = nextDay(ctx, 6);
  assert.equal(ctx.skippedOn(r.id, sat, 'dinner'), true);
  assert.equal(ctx.tiffinOn(r.id, sat, 'dinner'), false, 'skipped means no tiffin');
  assert.equal(ctx.tiffinOn(r.id, sat, 'lunch'), true, 'the other meal keeps its tiffin');
  assert.equal(ctx.headcount(sat, 'dinner').tiffin, 0);
});

test('tiffin OFF for a day means the person eats at the hostel: counted in the plates, not in the tiffin list', () => {
  const { ctx, r } = sandbox();
  ctx.setTifPlan(r.id, { 3: ['lunch'] });
  const wed = nextDay(ctx, 3);
  const before = ctx.headcount(wed, 'lunch');
  assert.equal(before.tiffin, 1); assert.equal(before.eat, before.eligible);
  ctx.toggleTiffin(r.id, wed, 'lunch');                       // cancel just that day
  const after = ctx.headcount(wed, 'lunch');
  assert.equal(after.tiffin, 0); assert.equal(after.skip, 0);
  assert.equal(after.eat, after.eligible, 'still eats - only the packing is gone');
});

test('skip a plan-tiffin day: no food and no tiffin; un-skip brings the plan tiffin back', () => {
  const { ctx, r } = sandbox();
  ctx.setTifPlan(r.id, { 3: ['lunch'] });
  const wed = nextDay(ctx, 3);
  assert.equal(ctx.toggleSkip(r.id, wed, 'lunch'), true);
  assert.equal(ctx.tiffinOn(r.id, wed, 'lunch'), false);
  const hc = ctx.headcount(wed, 'lunch'); assert.equal(hc.skip, 1); assert.equal(hc.tiffin, 0); assert.equal(hc.eat, hc.eligible - 1);
  assert.equal(ctx.toggleSkip(r.id, wed, 'lunch'), false);
  assert.equal(ctx.tiffinOn(r.id, wed, 'lunch'), true, 'the weekly tiffin plan resumes');
});

test('cancel one plan-skip day, then it is an eating day again; skipping again restores it without leaving rows behind', () => {
  const { ctx, S, r } = sandbox();
  ctx.setTifPlan(r.id, undefined, { 6: ['lunch'] });
  const sat = nextDay(ctx, 6);
  assert.equal(ctx.toggleSkip(r.id, sat, 'lunch'), false);
  assert.equal(ctx.skippedOn(r.id, sat, 'lunch'), false);
  assert.equal(S.get(ctx.skipId(r.id, sat, 'lunch')).status, 'off');
  assert.equal(ctx.toggleSkip(r.id, sat, 'lunch'), true);
  assert.ok(!S.get(ctx.skipId(r.id, sat, 'lunch')), 'back on the plan: no extra row');
});

test('ordering a tiffin on a plan-skip day un-skips that day (and tiffin runs)', () => {
  const { ctx, r } = sandbox();
  ctx.setTifPlan(r.id, undefined, { 6: ['lunch'] });
  const sat = nextDay(ctx, 6);
  assert.equal(ctx.toggleTiffin(r.id, sat, 'lunch'), true);
  assert.equal(ctx.skippedOn(r.id, sat, 'lunch'), false);
  assert.equal(ctx.tiffinOn(r.id, sat, 'lunch'), true);
  assert.equal(ctx.headcount(sat, 'lunch').skip, 0);
});

test('leave beats everything: on leave the person is neither skip nor tiffin, only "on leave"', () => {
  const { ctx, S, r } = sandbox();
  ctx.setTifPlan(r.id, { 3: ['lunch'] }, { 3: ['dinner'] });
  const wed = nextDay(ctx, 3);
  S.put('leave', { resId: r.id, from: wed, to: wed, reason: 'home' });
  const l = ctx.headcount(wed, 'lunch'), d = ctx.headcount(wed, 'dinner');
  assert.equal(l.leave, 1); assert.equal(l.tiffin, 0); assert.equal(d.leave, 1); assert.equal(d.skip, 0);
  assert.equal(ctx.skipsOnDate(wed).length, 0, 'not listed as a skip while on leave');
});

test('every combination of weekly plan and one-day change gives one consistent answer', () => {
  const { ctx, r } = sandbox();
  const wed = nextDay(ctx, 3);
  for (const planTif of [false, true]) for (const planSkip of [false, true]) for (const flipSkip of [false, true]) for (const flipTif of [false, true]) {
    ctx.setTifPlan(r.id, planTif ? { 3: ['lunch'] } : {}, planSkip ? { 3: ['lunch'] } : {});
    // clean any day rows from the previous round
    for (const k of ['skip', 'tiffin']) { const row = ctx.Store.get((k === 'skip' ? ctx.skipId : ctx.tiffinId)(r.id, wed, 'lunch')); if (row) ctx.Store.remove(row.id); }
    if (flipSkip) ctx.toggleSkip(r.id, wed, 'lunch');
    if (flipTif) ctx.toggleTiffin(r.id, wed, 'lunch');
    const sk = ctx.skippedOn(r.id, wed, 'lunch'), tf = ctx.tiffinOn(r.id, wed, 'lunch'), hc = ctx.headcount(wed, 'lunch');
    const label = `planTif=${planTif} planSkip=${planSkip} flipSkip=${flipSkip} flipTif=${flipTif}`;
    assert.ok(!(sk && tf), 'never both skip and tiffin: ' + label);
    assert.equal(hc.skip, sk ? 1 : 0, 'cook skip count: ' + label);
    assert.equal(hc.tiffin, tf ? 1 : 0, 'cook tiffin count: ' + label);
    assert.equal(hc.eat, hc.eligible - (sk ? 1 : 0), 'plates: ' + label);
  }
});

test('monthly report numbers include the plans', () => {
  const { ctx, r } = sandbox();
  ctx.setTifPlan(r.id, { 1: ['lunch'], 2: ['lunch'], 3: ['lunch'], 4: ['lunch'], 5: ['lunch'] }, { 6: ['dinner'], 0: ['dinner'] });
  const st = ctx.monthMealStats(ctx.today().slice(0, 7));
  assert.ok(st.tiffins >= 0 && st.skips >= 0);
  const r2 = ctx.monthMealStats(ctx.addDays(ctx.today(), 40).slice(0, 7));
  assert.ok(r2.tiffins > 0 && r2.skips > 0, 'a future month fills up from the weekly plan');
});

test('plan editor has Tiffin and Skip tabs, keeps them exclusive, and the owner profile shows the plan', () => {
  const rs = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-resident.js'), 'utf8'), ow = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-owner.js'), 'utf8'), rp = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8');
  assert.ok(rs.includes('data-act="tptab"') && rs.includes('A.tptab') && rs.includes('sp_') && rs.includes("i.name.startsWith('tp_') ? 'sp_' : 'tp_'"));
  assert.ok(rs.includes("setTifPlan(r.id, S().mess.tiffin !== false ? plan : undefined, S().mess.skip !== false ? skip : undefined)"));
  assert.ok(ow.includes("t('Weekly meal plan')"));
  assert.ok(rp.includes('monthMealStats(ym)'), 'the monthly report counts plan tiffins and skips');
});
