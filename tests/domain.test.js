// Business-rule tests. Run: npm test  (Node 18+, no dependencies)
// Loads the real browser scripts into a sandbox with tiny DOM/storage stubs and the demo backend.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');

function boot() {
  const mem = {};
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, URL, URLSearchParams, Date, Math, JSON, TextEncoder,
    localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, key: () => null, length: 0 },
    navigator: { onLine: true, vibrate() {} },
    location: { href: 'https://app.test/index.html', hash: '', origin: 'https://app.test', pathname: '/index.html' },
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {} }, body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} }, createElement: () => ({ setAttribute() {}, appendChild() {}, querySelector: () => null }) },
    matchMedia: () => ({ matches: false }), addEventListener() {},
  };
  ctx.window = ctx; ctx.window.HOSTELOS_CONFIG = {};
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js', 'xlsx.js', 'report.js', 'pwa.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  // expose top-level lets/consts we need
  vm.runInContext(`toast = () => {}; globalThis.T = { Store, Demo, S, can, checkIn, recordPayment, resDue, openInv, resInvoices, invBal, splitElectricity, freeMonths, addReading, laundryQuote, laundryReceive,
    headcount, toggleSkip, beforeCutoff, cutoffAt, learnFactor, expectedUse, genHkTasks, hkTasks, setHkStatus, markMissed, hkFeedback, checkout, runAutomation, addInvoice,
    today, addDays, ymOf, rentDue, createPR, receivePR, itemById, items, activeRes, LS, skipId, resById,
    pvOn, pvOf, pvSet, pvDue, pvPending, pvPortal, pvDetails, pvDetailsText, docOpen, docsGoneOn, Files, DOC_KEEP_DAYS, PV_STATES, PV_STATUS, inboxItems,
    advPlan, recordAdvance, advPaidAhead, addPenalty, waivePenalty, penaltyDue, resPenalties, penaltyList,
    attOn, attPeriods, attSet, attRoll, attMonth, attDoc, sendRinfo, rinfoReply, rinfos, rinfoUnread, rinfoCovering, CFG,
    applyModSwitch, modNeeds, modNeededBy, orgEnabled, MOD_DEPS, fmtYM, addMonths, invoices, myNotifs,
    meterOccupants, setOpeningReading, lastMeter, moveReading, moveReadingHint, canMarkHk, punchIn, punchedToday, selfPunchOn, attFence, Geo,
    remindersDue, markReminded, monthlyBillsDue, monthlyBillMsgs, meals, byTime, checkout, payrollFor,
    rooms, residents, allRooms, allResidents, occupancy, dueList, shiftBed, vacantBeds, Xlsx, Report, repPresets, repRange, repIn, seedDemo, isDemoHostel, WaGw, Pwa, CFG, siteUrl, siteDomain, siteSlugProblem, SITE_RESERVED, stockOf, stockM, toM, fromM, postMove, countTo, postConsumption, catchUpConsumption, auditStock, ledger, itemMoves, lineTotal, prTotal, usageBooked, billMessage, receiptMessage, welcomeMessage, laundryMessage, tpl, WA_TPL, rs,
    hostelBlocks, blocksOn, blockScope, setBlockScope, withAllBlocks, roomBlock, resBlock, blockName, blockOrder,
    payments, resPays, siteCfg, siteLive, siteGaps, sitePhotos, sitePhotoUrl, SITE_PHOTOS, imgUrl, siteSlug, siteUrl,
    ui: { tab: {}, q: {}, flt: {}, lim: {} } };`, ctx);
  return ctx.T;
}

let T;
function setupHostel(role = 'owner', extra = {}) {
  T = boot();
  const S = T.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'o1', modules: extra.modules || {}, status: 'active' }];
  S.hostels = [{ id: 'hx', org_id: 'o1', name: 'Test PG', settings: extra.settings || {} }];
  S.ctx = { key: 'k', role, hostelId: 'hx', orgId: 'o1', perms: extra.perms || [], deny: [], refId: extra.refId };
  S.put('room', { id: 'r1', no: '101', floor: 'F1', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  return S;
}
beforeEach(() => setupHostel());

test('check-in creates pro-rata rent + deposit and occupies the bed', () => {
  const r = T.checkIn({ name: 'Ravi Kumar', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-16' });
  const inv = T.resInvoices(r.id);
  assert.equal(inv.length, 2);
  assert.equal(inv.find(i => i.type === 'rent').amount, Math.round((6000 * 16) / 31 * 100) / 100);
  assert.equal(inv.find(i => i.type === 'deposit').amount, 6000);
  assert.equal(T.Store.get('r1').beds[0].status, 'occ');
  assert.throws(() => T.checkIn({ name: 'X', phone: '9000000000', roomId: 'r1', bed: 'A', rent: 1 }), /not vacant/);
});

test('payments are allocated oldest-first and extra becomes credit used by the next bill', () => {
  const r = T.checkIn({ name: 'A', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 5000, deposit: 2000, checkIn: '2026-01-01' });
  T.recordPayment({ resId: r.id, amount: 8000 });
  assert.equal(T.resDue(r.id), 0);
  assert.equal(T.Store.get(r.id).credit, 1000);
  T.addInvoice({ resId: r.id, type: 'other', title: 'x', amount: 1500, due: '2099-01-01' });
  assert.equal(T.resDue(r.id), 500);
  assert.equal(T.Store.get(r.id).credit, 0);
});

test('electricity: free units per resident are deducted before charging', () => {
  setupHostel('owner', { settings: { elec: { rate: 10, freeUnits: 30, freeMode: 'resident' } } });
  const s = T.splitElectricity('r1', 150, 10, ['a', 'b']);
  assert.deepEqual(s.map(x => x.amount), [450, 450]); // (75-30) × 10
  const low = T.splitElectricity('r1', 40, 10, ['a', 'b']);
  assert.deepEqual(low.map(x => x.amount), [0, 0]);
});

test('electricity: free units per room are shared', () => {
  setupHostel('owner', { settings: { elec: { rate: 10, freeUnits: 30, freeMode: 'room' } } });
  const s = T.splitElectricity('r1', 150, 10, ['a', 'b']);
  assert.deepEqual(s.map(x => x.amount), [600, 600]); // (150-30)/2 × 10
});

test('meter reading bills each resident; lower reading is rejected', () => {
  setupHostel('owner', { settings: { elec: { rate: 10, freeUnits: 0 } } });
  const a = T.checkIn({ name: 'A', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 0, checkIn: '2026-01-01' });
  T.addReading({ roomId: 'r1', curr: 1000, prev: 900, date: '2026-02-01' });
  assert.equal(T.resDue(a.id), 1000);
  assert.throws(() => T.addReading({ roomId: 'r1', curr: 950 }), /less than previous/);
});

test('laundry: free pieces first, then charged per piece and billed', () => {
  setupHostel('owner', { settings: { laundry: { freePcs: 10, rate: 15 } } });
  const r = T.checkIn({ name: 'A', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 0, checkIn: '2026-01-01' });
  assert.equal(T.laundryReceive({ resId: r.id, pcs: 8 }).q.charge, 0);
  const second = T.laundryReceive({ resId: r.id, pcs: 5 });
  assert.equal(second.q.extra, 3);
  assert.equal(second.q.charge, 45);
  assert.equal(T.resDue(r.id), 45);
});

test('meal skip respects cut-off; headcount drops for skip and leave', () => {
  const r1 = T.checkIn({ name: 'A', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 0, checkIn: '2026-01-01' });
  const r2 = T.checkIn({ name: 'B', phone: '9876543211', roomId: 'r1', bed: 'B', rent: 0, checkIn: '2026-01-01' });
  const d = T.addDays(T.today(), 2);
  assert.equal(T.headcount(d, 'lunch').eat, 2);
  T.toggleSkip(r1.id, d, 'lunch');
  T.Store.put('leave', { resId: r2.id, from: d, to: d, date: d });
  const hc = T.headcount(d, 'lunch');
  assert.equal(hc.eat, 0); assert.equal(hc.skip, 1); assert.equal(hc.leave, 1);
  // breakfast cut-off is 22:00 the previous day
  const c = T.cutoffAt('2026-03-10', 'breakfast');
  assert.equal(c.getDate(), 9); assert.equal(c.getHours(), 22);
  // a resident cannot skip a past meal
  T.Store.ctx.role = 'resident';
  assert.throws(() => T.toggleSkip(r1.id, T.addDays(T.today(), -1), 'dinner'), /Cut-off/);
});

test('kitchen learns the real usage factor between two purchases', () => {
  T.Store.put('item', { id: 'rice', name: 'Rice', unit: 'kg', stock: 0 });
  T.Store.put('dish', { id: 'd1', name: 'Rice', meal: 'any', serves: 10, ings: [{ itemId: 'rice', qty: 1 }] });
  const week = {}; for (let i = 0; i < 7; i++) week[i] = { lunch: ['d1'] };
  T.Store.put('menu', { id: 'menu', week });
  T.checkIn({ name: 'A', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 0, checkIn: '2025-01-01' });
  T.checkIn({ name: 'B', phone: '9876543211', roomId: 'r1', bed: 'B', rent: 0, checkIn: '2025-01-01' });
  const from = T.addDays(T.today(), -10), to = T.addDays(T.today(), -1);
  const expected = T.expectedUse(from, to).rice; // 9 days × 2 people × 0.1 kg = 1.8 kg
  assert.ok(Math.abs(expected - 1.8) < 1e-9);
  T.Store.put('pr', { date: T.addDays(from, -1), status: 'received', receivedOn: from, items: [{ itemId: 'rice', leftQty: 0, recvQty: 3 }] });
  T.Store.put('pr', { date: to, status: 'requested', items: [{ itemId: 'rice', leftQty: 0.84, qty: 5 }] });
  const f = T.learnFactor('rice');
  assert.equal(f.cycles, 1);
  assert.equal(f.factor, 1.2); // used 2.16 kg vs 1.8 expected
});

test('purchase request → receive updates stock and creates an expense', () => {
  T.Store.put('item', { id: 'atta', name: 'Atta', unit: 'kg', stock: 1 });
  const pr = T.createPR({ items: [{ itemId: 'atta', qty: 10, leftQty: 2 }] });
  assert.equal(T.stockOf(T.itemById('atta')), 2); // the cook's count corrected stock
  const done = T.receivePR(pr.id, { atta: { qty: 10, rate: 40 } }, { mode: 'credit', vendor: 'Shop' });
  assert.equal(T.stockOf(T.itemById('atta')), 12);
  assert.equal(done.total, 400);
  const exp = T.Store.get(done.expId);
  assert.equal(exp.mode, 'credit'); assert.equal(exp.paid, false);
});

test('housekeeping tasks are generated once, notify residents when done, missed after cut-off', () => {
  const r = T.checkIn({ name: 'A', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 0, checkIn: '2025-01-01' });
  T.Store.put('staff', { id: 's1', name: 'Sunita', dept: 'Housekeeping', status: 'active' });
  T.Store.put('hks', { id: 'h1', name: 'Daily', freq: 'daily', rooms: ['r1'], assign: { r1: 's1' } });
  assert.equal(T.genHkTasks(T.today(), 2), 2);
  assert.equal(T.genHkTasks(T.today(), 2), 0); // idempotent
  const task = T.hkTasks().find(x => x.date === T.today());
  T.setHkStatus(task.id, 'done');
  assert.ok(T.Store.all('ntf').some(n => n.resId === r.id));
  T.hkFeedback(task.id, r.id, false, 'Dusty floor');
  assert.ok(T.Store.all('cmp').some(c => c.taskId === task.id));
  T.Store.put('hkt', { id: 'old', date: T.addDays(T.today(), -1), roomId: 'r1', status: 'pending' });
  T.markMissed();
  assert.equal(T.Store.get('old').status, 'missed');
});

test('checkout settles dues from deposit and queues the refund', () => {
  const r = T.checkIn({ name: 'A', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 5000, deposit: 6000, checkIn: '2026-01-01' });
  T.recordPayment({ resId: r.id, amount: 6000, invIds: [`inv-dep-${r.id}`] }); // only deposit paid
  const dep = T.checkout(r.id, '2026-01-20', 200);
  assert.equal(dep.settled, 5000);
  assert.equal(dep.refund, 800);
  assert.equal(T.resDue(r.id), 0);
  assert.equal(T.Store.get('r1').beds[0].status, 'vac');
});

test('automation is idempotent — running twice never doubles rent bills', () => {
  T.checkIn({ name: 'A', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 5000, checkIn: '2025-01-01' });
  T.runAutomation(true); const n1 = T.Store.all('inv').length;
  T.runAutomation(true); const n2 = T.Store.all('inv').length;
  assert.equal(n1, n2);
  assert.ok(T.Store.get(`inv-rent-${T.activeRes()[0].id}-${T.ymOf(T.today())}`));
});

test('permissions: role defaults, extra grants and client module switches', () => {
  setupHostel('cook');
  assert.equal(T.can('mess'), true); assert.equal(T.can('payments'), false);
  setupHostel('cook', { perms: ['payments'] });
  assert.equal(T.can('payments'), true);
  setupHostel('owner', { modules: { laundry: false } });
  assert.equal(T.can('laundry'), false); assert.equal(T.can('payments'), true);
});

/* ===================================================================== police verification */

test('a new resident starts as not verified, and is only overdue after the reminder window', () => {
  setupHostel();
  const res = T.checkIn({ name: 'Vikas Yadav', phone: '9876512345', roomId: 'r1', bed: 'A', checkIn: T.today(), rent: 6000, deposit: 6000 });
  T.Store.patch(res.id, { pv: { status: 'none' } });

  assert.equal(T.pvOf(T.resById(res.id)).status, 'none');
  assert.equal(T.pvDue(T.resById(res.id)), false, 'not overdue on day one');

  // same resident, checked in 10 days ago, default window is 7
  T.Store.patch(res.id, { checkIn: T.addDays(T.today(), -10) });
  assert.equal(T.pvDue(T.resById(res.id)), true);
  assert.ok(T.pvPending().some(x => x.id === res.id));
});

test('submitting or verifying clears the reminder; so does marking it not required', () => {
  setupHostel();
  const res = T.checkIn({ name: 'Old Resident', phone: '9876512346', roomId: 'r1', bed: 'B', checkIn: T.addDays(T.today(), -30), rent: 6000, deposit: 0 });
  T.Store.patch(res.id, { pv: { status: 'none' } });
  assert.equal(T.pvDue(T.resById(res.id)), true);

  for (const st of ['submitted', 'verified', 'exempt']) {
    T.pvSet(res.id, { status: st });
    assert.equal(T.pvDue(T.resById(res.id)), false, st + ' should not be chased');
  }
  // a rejection must come back onto the list
  T.pvSet(res.id, { status: 'rejected' });
  assert.equal(T.pvDue(T.resById(res.id)), true);
});

test('a status change is recorded in the activity log', () => {
  setupHostel();
  const res = T.checkIn({ name: 'Logged Resident', phone: '9876512347', roomId: 'r1', bed: 'A', checkIn: T.today(), rent: 5000, deposit: 0 });
  const before = T.Store.all('log').length;
  T.pvSet(res.id, { status: 'submitted', refNo: 'ACK/2026/55' });
  assert.equal(T.Store.all('log').length, before + 1);
  assert.equal(T.pvOf(T.resById(res.id)).refNo, 'ACK/2026/55');
  assert.ok(T.pvOf(T.resById(res.id)).changedOn, 'remembers when it changed');
});

test('the owner-set portal link wins over the built-in one, per state', () => {
  setupHostel();
  // built-in default for Delhi
  T.Store.hostels[0].settings = { police: { on: true, state: 'DL', portals: {} } };
  assert.match(T.pvPortal(), /delhipolice/);
  // the owner pastes the exact page their state actually uses
  T.Store.hostels[0].settings = { police: { on: true, state: 'DL', portals: { DL: 'https://my.exact.portal/tenant' } } };
  assert.equal(T.pvPortal(), 'https://my.exact.portal/tenant');
  // a resident may be verified in a different state than the hostel default
  assert.match(T.pvPortal('UP'), /uppolice/);
});

test('the details handed to the portal carry what the form asks for, and nothing empty', () => {
  setupHostel();
  const res = T.checkIn({ name: 'Detail Resident', phone: '9876512348', roomId: 'r1', bed: 'A', checkIn: T.today(),
    rent: 6000, deposit: 0, guardian: 'Suresh Yadav', guardianPhone: '9811111111', idNo: '1234 5678 9012', address: 'Village Rampur, Bihar' });
  const pairs = T.pvDetails(T.resById(res.id));
  const text = T.pvDetailsText(T.resById(res.id));

  assert.ok(text.includes('Detail Resident'));
  assert.ok(text.includes('1234 5678 9012'), 'ID number is there to paste');
  assert.ok(text.includes('Village Rampur, Bihar'), 'permanent address is there');
  assert.ok(/Room/.test(text), 'present address includes the room');
  assert.ok(pairs.every(([, v]) => v !== '' && v != null), 'no blank lines to confuse the form');
});

test('papers of a resident who left are due for deletion DOC_KEEP_DAYS after they left', () => {
  setupHostel();
  const res = T.checkIn({ name: 'Leaving Resident', phone: '9876512349', roomId: 'r1', bed: 'A', checkIn: T.addDays(T.today(), -90), rent: 6000, deposit: 0 });
  assert.equal(T.docsGoneOn(T.resById(res.id)), '', 'nothing is deleted while they live here');
  T.Store.patch(res.id, { status: 'left', left: '2026-01-10' });
  assert.equal(T.DOC_KEEP_DAYS, 30);
  assert.equal(T.docsGoneOn(T.resById(res.id)), '2026-02-09');
});

test('a paper opens by its storage path, and a missing one says so', () => {
  assert.match(T.docOpen({ type: 'Aadhaar card', path: 'h/res/r1/aadhaar-card-0a1b2c3d.webp' }), /data-act="opendoc" data-path="h\/res\/r1\/aadhaar-card-0a1b2c3d\.webp"/);
  assert.match(T.docOpen({ type: 'Aadhaar card' }), /Missing/);
  assert.equal(T.Files.ready(), false, 'demo mode uploads nothing');
});

test('turning the feature off stops all chasing', () => {
  setupHostel();
  const res = T.checkIn({ name: 'Ignored Resident', phone: '9876512350', roomId: 'r1', bed: 'A', checkIn: T.addDays(T.today(), -40), rent: 6000, deposit: 0 });
  T.Store.patch(res.id, { pv: { status: 'none' } });
  assert.equal(T.pvDue(T.resById(res.id)), true);
  T.Store.hostels[0].settings = { police: { on: false } };
  assert.equal(T.pvOn(), false);
  assert.equal(T.pvDue(T.resById(res.id)), false);
  assert.equal(T.pvPending().length, 0);
});

test('a resident who has left is never chased for verification', () => {
  setupHostel();
  const res = T.checkIn({ name: 'Gone Resident', phone: '9876512351', roomId: 'r1', bed: 'A', checkIn: T.addDays(T.today(), -40), rent: 6000, deposit: 0 });
  T.Store.patch(res.id, { pv: { status: 'none' }, status: 'left' });
  assert.equal(T.pvDue(T.resById(res.id)), false);
});

/* ===================================================================== advance rent */
// A resident on 10,000 a month hands over 35,000 and the owner says it is for four months.
// Four months at 10,000 is 40,000, so the 5,000 gap IS the discount — that is the whole rule.
function advResident(rent = 10000) {
  return T.checkIn({ name: 'Adv Kumar', phone: '9876500011', roomId: 'r1', bed: 'A', rent, deposit: 0, checkIn: T.ymOf(T.today()) + '-01' });
}

test('advance: four months paid as 35,000 bills all four months and records the 5,000 discount', () => {
  const r = advResident();
  const plan = T.advPlan(r.id, 4);
  assert.equal(plan.months, 4);
  assert.equal(plan.expected, 40000);
  const pay = T.recordAdvance({ resId: r.id, amount: 35000, months: 4 });

  assert.equal(pay.adv.months, 4);
  assert.equal(pay.adv.discount, 5000);
  assert.equal(pay.adv.from, T.ymOf(T.today()));
  assert.equal(pay.adv.to, T.addMonths(T.ymOf(T.today()), 3));

  // every one of the four months is a real, fully settled rent bill
  const bills = T.resInvoices(r.id).filter(i => i.type === 'rent');
  assert.equal(bills.length, 4);
  for (const b of bills) assert.equal(T.invBal(b), 0, `${b.period} should be settled`);
  // the discount is spread over them, so each month shows what it actually cost
  assert.equal(bills.reduce((a, b) => a + (b.discount || 0), 0), 5000);
  assert.equal(T.resDue(r.id), 0);
  assert.equal(T.Store.get(r.id).credit, 0);
});

test('advance: the months already paid for are not billed again by the automation', () => {
  const r = advResident();
  T.recordAdvance({ resId: r.id, amount: 35000, months: 4 });
  const before = T.resInvoices(r.id).filter(i => i.type === 'rent').map(i => i.id + ':' + i.amount).sort();
  T.runAutomation(true);
  const after = T.resInvoices(r.id).filter(i => i.type === 'rent').map(i => i.id + ':' + i.amount).sort();
  assert.deepEqual(after, before);
  assert.equal(T.resDue(r.id), 0);
});

test('advance: paying the full price records no discount, and paying over it leaves credit', () => {
  const r = advResident();
  const pay = T.recordAdvance({ resId: r.id, amount: 40000, months: 4 });
  assert.equal(pay.adv.discount, 0);
  assert.equal(T.Store.get(r.id).credit, 0);

  const r2 = T.checkIn({ name: 'Over Pay', phone: '9876500012', roomId: 'r1', bed: 'B', rent: 10000, deposit: 0, checkIn: T.ymOf(T.today()) + '-01' });
  const pay2 = T.recordAdvance({ resId: r2.id, amount: 25000, months: 2 });
  assert.equal(pay2.adv.discount, 0);
  assert.equal(T.Store.get(r2.id).credit, 5000);
});

test('advance: credit the resident already had is not mistaken for a discount', () => {
  const r = advResident();
  T.recordPayment({ resId: r.id, amount: 12000 });          // clears this month, 2,000 left over
  assert.equal(T.Store.get(r.id).credit, 2000);

  const plan = T.advPlan(r.id, 3);
  assert.equal(plan.yms[0], T.addMonths(T.ymOf(T.today()), 1));  // this month is settled, so start next
  assert.equal(plan.total, 30000);
  assert.equal(plan.expected, 28000);                        // the 2,000 credit will pay part of it

  const pay = T.recordAdvance({ resId: r.id, amount: 28000, months: 3 });
  assert.equal(pay.adv.discount, 0, 'the old credit must not be waived as a discount');
  assert.equal(T.resDue(r.id), 0);
  assert.equal(T.Store.get(r.id).credit, 0);
  assert.equal(T.advPaidAhead(r.id).length, 3);
});

test('advance: a nonsense request is refused rather than half-applied', () => {
  const r = advResident();
  assert.throws(() => T.recordAdvance({ resId: r.id, amount: 35000, months: 0 }), /how many months/i);
  assert.throws(() => T.recordAdvance({ resId: r.id, amount: 0, months: 3 }), /amount/i);
  assert.equal(T.resInvoices(r.id).filter(i => i.type === 'rent').length, 1, 'nothing should have been billed');
});

/* ===================================================================== penalties */
test('penalty: needs a reason and an amount, then counts in the dues', () => {
  const r = advResident();
  assert.throws(() => T.addPenalty({ resId: r.id, amount: 500, reason: '  ' }), /reason/i);
  assert.throws(() => T.addPenalty({ resId: r.id, amount: 0, reason: 'Late entry' }), /amount/i);

  const before = T.resDue(r.id);
  T.addPenalty({ resId: r.id, amount: 500, reason: 'Late entry after 11pm' });
  assert.equal(T.resDue(r.id), before + 500);
  assert.equal(T.penaltyDue(r.id), 500);
  assert.match(T.resPenalties(r.id)[0].title, /Late entry after 11pm/);
});

test('penalty: left out of a payment it stays pending; the rent is still settled', () => {
  const r = advResident();                                   // 10,000 rent outstanding
  T.addPenalty({ resId: r.id, amount: 500, reason: 'Damage' });
  const pens = T.resPenalties(r.id).map(i => i.id);

  T.recordPayment({ resId: r.id, amount: 10000, exclude: pens });
  assert.equal(T.penaltyDue(r.id), 500, 'the fine must carry forward');
  assert.equal(T.resDue(r.id), 500);
  assert.equal(T.Store.get(r.id).credit, 0, 'excluded money must not become credit');
  const rent = T.resInvoices(r.id).find(i => i.type === 'rent');
  assert.equal(T.invBal(rent), 0, 'the rent should still be paid off');
});

test('penalty: included in a payment it is cleared with everything else', () => {
  const r = advResident();
  T.addPenalty({ resId: r.id, amount: 500, reason: 'Damage' });
  T.recordPayment({ resId: r.id, amount: 10500 });
  assert.equal(T.penaltyDue(r.id), 0);
  assert.equal(T.resDue(r.id), 0);
});

test('penalty: cancelling it clears the balance but keeps the record', () => {
  const r = advResident();
  const inv = T.addPenalty({ resId: r.id, amount: 500, reason: 'Noise' });
  T.waivePenalty(inv.id, 'First time, let off');
  assert.equal(T.penaltyDue(r.id), 0);
  const kept = T.Store.get(inv.id);
  assert.ok(kept, 'the penalty record must not be deleted');
  assert.equal(kept.waivedWhy, 'First time, let off');
  assert.equal(T.invBal(kept), 0);
  assert.equal(T.penaltyList().length, 0);
});

/* ===================================================================== attendance */
test('attendance: everyone is present until marked, and only absences are stored', () => {
  const r = advResident();
  const pk = T.attPeriods()[0].k;
  const d = T.today();
  assert.equal(T.attRoll(d, pk).present, 1);
  assert.equal(T.attRoll(d, pk).absent, 0);
  assert.equal(T.Store.all('ratt').length, 0, 'a present day must cost no storage at all');

  T.attSet(r.id, d, pk, true);
  assert.equal(T.attRoll(d, pk).absent, 1);
  assert.equal(T.attRoll(d, pk).present, 0);
  assert.equal(T.Store.all('ratt').length, 1);

  T.attSet(r.id, d, pk, false);
  assert.equal(T.attRoll(d, pk).absent, 0);
  assert.equal(T.Store.all('ratt').length, 0, 'an empty month should not be left behind as a row');
});

test('attendance: a day counts as absent if any roll call was missed', () => {
  setupHostel('owner', { settings: { attend: { on: true, periods: [{ k: 'am', l: 'Morning', time: '08:00' }, { k: 'pm', l: 'Night', time: '21:00' }] } } });
  const r = advResident();
  const d = T.today(), ym = T.ymOf(d);
  T.attSet(r.id, d, 'pm', true);
  assert.equal(T.attRoll(d, 'am').absent, 0);
  assert.equal(T.attRoll(d, 'pm').absent, 1);
  const m = T.attMonth(r.id, ym);
  assert.equal(m.absent, 1);
  assert.equal(JSON.stringify(m.absentDays), JSON.stringify([+d.slice(8)]));
  assert.equal(m.present, m.days - 1);
});

test('attendance: switched off by the owner setting or by the module', () => {
  setupHostel('owner', { settings: { attend: { on: false } } });
  assert.equal(T.attOn(), false);
  setupHostel('owner', { settings: { attend: { on: true } } });
  assert.equal(T.attOn(), true);
  setupHostel('owner', { modules: { attendance: false }, settings: { attend: { on: true } } });
  assert.equal(T.attOn(), false, 'a module the client does not have beats the hostel setting');
});

/* ===================================================================== resident messages */
test('resident messages: reach the owner inbox and are not counted as complaints', () => {
  const r = advResident();
  T.sendRinfo({ resId: r.id, type: 'illness', text: 'Fever, staying in' });
  assert.equal(T.rinfoUnread().length, 1);
  const inbox = T.inboxItems().filter(x => x.k === 'rinfo');
  assert.equal(inbox.length, 1);
  assert.match(inbox[0].t, /Adv Kumar/);
  assert.equal(T.Store.all('cmp').length, 0, 'a message is not a repair job');
});

test('resident messages: a reply marks it seen and tells the resident', () => {
  const r = advResident();
  const x = T.sendRinfo({ resId: r.id, type: 'out', text: 'Going home' });
  T.rinfoReply(x.id, 'Noted, travel safe');
  assert.equal(T.rinfoUnread().length, 0);
  assert.equal(T.Store.get(x.id).reply, 'Noted, travel safe');
  assert.equal(T.inboxItems().filter(y => y.k === 'rinfo').length, 0);
});

test('resident messages: a date range is found on every day it covers', () => {
  const r = advResident();
  T.sendRinfo({ resId: r.id, type: 'absent', from: '2026-03-04', to: '2026-03-07', text: 'Home' });
  assert.equal(T.rinfoCovering(r.id, '2026-03-03').length, 0);
  assert.equal(T.rinfoCovering(r.id, '2026-03-04').length, 1);
  assert.equal(T.rinfoCovering(r.id, '2026-03-06').length, 1);
  assert.equal(T.rinfoCovering(r.id, '2026-03-07').length, 1);
  assert.equal(T.rinfoCovering(r.id, '2026-03-08').length, 0);
  assert.throws(() => T.sendRinfo({ resId: r.id, type: 'absent', from: '2026-03-07', to: '2026-03-04' }), /before/i);
});

/* ===================================================================== module switches */
// This is the bug the owner hit: switching off one module left another one half-working.
test('modules: switching off something another module needs takes that one with it', () => {
  const a = T.applyModSwitch({}, 'mess', false);
  assert.equal(a.modules.mess, false);
  assert.equal(a.modules.kitchen, false, 'the kitchen cannot plan without the mess menu');
  assert.equal(JSON.stringify(a.changed), JSON.stringify([['kitchen', false]]));

  const b = T.applyModSwitch({}, 'staff', false);
  assert.equal(b.modules.housekeeping, false, 'cleaning tasks are assigned to staff');
});

test('modules: switching one on brings whatever it needs with it', () => {
  const a = T.applyModSwitch({ mess: false, kitchen: false }, 'kitchen', true);
  assert.equal(a.modules.kitchen, undefined, 'on is stored as the absence of a false');
  assert.equal(a.modules.mess, undefined);
  assert.equal(JSON.stringify(a.changed), JSON.stringify([['mess', true]]));

  const b = T.applyModSwitch({ staff: false, housekeeping: false }, 'housekeeping', true);
  assert.equal(b.modules.staff, undefined);
});

test('modules: an unrelated switch moves nothing else', () => {
  const a = T.applyModSwitch({}, 'laundry', false);
  assert.equal(a.changed.length, 0);
  assert.equal(JSON.stringify(Object.keys(a.modules)), JSON.stringify(['laundry']));
});

test('modules: the client plan and the hostel switch both have to allow it', () => {
  setupHostel('owner');
  assert.equal(T.orgEnabled('laundry'), true);
  assert.equal(T.orgEnabled('payments'), true, 'core modules are never switchable');

  setupHostel('owner', { modules: { laundry: false } });
  assert.equal(T.orgEnabled('laundry'), false, 'off for the client');

  setupHostel('owner');
  T.Store.hostels[0].modules = { laundry: false };
  assert.equal(T.orgEnabled('laundry'), false, 'off for this hostel only');
  assert.equal(T.orgEnabled('mess'), true, 'and nothing else is touched');
});


/* ------------------------------------------------------------- added: electricity, meals, rights, punch-in, reminders */

test('electricity: a resident who left mid-period pays for their days, not the roommate', () => {
  setupHostel('owner', { settings: { elec: { rate: 10, freeUnits: 0, freeMode: 'resident' } } });
  const a = T.checkIn({ name: 'Stays', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 5000, checkIn: '2026-01-01' });
  const b = T.checkIn({ name: 'Leaves', phone: '9876543211', roomId: 'r1', bed: 'B', rent: 5000, checkIn: '2026-01-01' });
  T.setOpeningReading('r1', 1000, '2026-01-01');
  T.checkout(b.id, '2026-01-16');          // stayed 15 of 30 days
  const m = T.addReading({ roomId: 'r1', curr: 1300, date: '2026-01-31' });   // 300 units
  const sa = m.shares.find(s => s.resId === a.id), sb = m.shares.find(s => s.resId === b.id);
  assert.ok(sb, 'the leaver is still billed');
  assert.equal(sa.units, 200); assert.equal(sb.units, 100);
  assert.equal(sa.amount + sb.amount, 3000, 'nothing is lost or doubled');
});

test('electricity: the opening reading is where the first bill starts, and bills nothing itself', () => {
  setupHostel('owner', { settings: { elec: { rate: 8, freeUnits: 0 } } });
  const a = T.checkIn({ name: 'A', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 5000, checkIn: '2026-01-01' });
  const o = T.setOpeningReading('r1', 4520, '2026-01-01');
  assert.equal(o.units, 0); assert.equal(o.opening, true);
  assert.equal(T.resInvoices(a.id).filter(i => i.type === 'electricity').length, 0);
  const m = T.addReading({ roomId: 'r1', curr: 4620, date: '2026-01-31' });
  assert.equal(m.prev, 4520); assert.equal(m.units, 100); assert.equal(m.total, 800);
  T.setOpeningReading('r1', 4520, '2026-01-01');
  assert.equal(T.Store.all('meter').filter(x => x.opening).length, 1, 're-saving corrects the same row');
});

test('electricity: equal stays still split equally (old behaviour unchanged)', () => {
  setupHostel('owner', { settings: { elec: { rate: 10, freeUnits: 30, freeMode: 'resident' } } });
  T.checkIn({ name: 'A', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 5000, checkIn: '2026-01-01' });
  T.checkIn({ name: 'B', phone: '9876543211', roomId: 'r1', bed: 'B', rent: 5000, checkIn: '2026-01-01' });
  T.setOpeningReading('r1', 0, '2026-02-01');
  const m = T.addReading({ roomId: 'r1', curr: 150, date: '2026-03-01' });
  assert.equal(JSON.stringify(m.shares.map(s => s.amount)), '[450,450]');
});

test('meals are always in serving-time order', () => {
  setupHostel('owner', { settings: { meals: [{ k: 'd', l: 'Dinner', time: '20:30' }, { k: 'b', l: 'Breakfast', time: '08:00' }, { k: 's', l: 'Snacks', time: '17:00' }] } });
  assert.deepEqual(T.meals().map(m => m.k), ['b', 's', 'd']);
});

test('housekeeping: who may mark a room cleaned follows the setting', () => {
  setupHostel('owner', { settings: { hk: { markBy: ['staff'] } } });
  const task = { id: 'hkt-1', roomId: 'r1', staffId: 'st1', status: 'pending' };
  assert.equal(T.canMarkHk(task), false, 'owner left out → owner cannot');
  setupHostel('housekeeping', { refId: 'st1', settings: { hk: { markBy: ['staff'] } } });
  assert.equal(T.canMarkHk(task), true, 'the assigned housekeeper can');
  assert.equal(T.canMarkHk({ ...task, staffId: 'other' }), false, 'but not someone else\'s room');
  setupHostel('resident', { refId: 'res-9', settings: { hk: { markBy: ['resident'] } } });
  T.Store.put('res', { id: 'res-9', name: 'R', roomId: 'r1', status: 'active' });
  assert.equal(T.canMarkHk(task), true, 'a resident of that room can when allowed');
  assert.equal(T.canMarkHk({ ...task, roomId: 'r2' }), false);
});

test('staff punch-in: inside the radius marks present, outside is refused', () => {
  setupHostel('cook', { refId: 'st1', settings: { staffAtt: { mode: 'self', lat: 25.1442, lng: 75.8468, radius: 150 } } });
  T.Store.put('staff', { id: 'st1', name: 'Raju', status: 'active', salary: 9000 });
  assert.equal(T.punchedToday('st1'), false);
  assert.throws(() => T.punchIn('st1', { lat: 25.1600, lng: 75.8468 }), /m from the hostel/);   // ~1.7 km
  assert.throws(() => T.punchIn('st1', null), /Turn on location/);
  const rec = T.punchIn('st1', { lat: 25.1446, lng: 75.8470 });                                 // ~50 m
  assert.equal(T.punchedToday('st1'), true);
  const d = +T.today().slice(8);
  assert.equal(rec.days[d], 'P'); assert.ok(rec.punch[d].dist < 150);
});

test('staff punch-in is refused when the owner marks attendance manually', () => {
  setupHostel('cook', { refId: 'st1', settings: { staffAtt: { mode: 'manual' } } });
  T.Store.put('staff', { id: 'st1', name: 'Raju', status: 'active' });
  assert.throws(() => T.punchIn('st1', null), /switched off/);
});

test('payment reminders: each stage goes out once per bill', () => {
  setupHostel('owner', { settings: { wa: { remind: { on: true, days: [1, 5] } } } });
  const r = T.checkIn({ name: 'Late Payer', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 5000, checkIn: T.addDays(T.today(), -40) });
  T.addInvoice({ id: 'inv-x', resId: r.id, type: 'rent', title: 'Rent', amount: 5000, date: T.addDays(T.today(), -8), due: T.addDays(T.today(), -6) });
  const due = T.remindersDue();
  assert.equal(due.length, 1); assert.equal(due[0].stage, 5);
  T.markReminded(due);
  assert.equal(T.remindersDue().length, 0, 'not repeated');
});


/* ===================================================================== blocks
 * One hostel split into wings. The rules worth pinning down are the ones that would quietly
 * corrupt money if they broke: a wing filter must never decide who gets billed, and a block
 * must never be stored anywhere except on the room.
 */
function withBlocks() {
  const S = setupHostel();
  S.hostels[0].blocks = [{ k: 'a', l: 'Block A' }, { k: 'b', l: 'Block B' }];
  S.put('room', { id: 'r1', no: '101', floor: 'F1', block: 'a', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  S.put('room', { id: 'r2', no: '201', floor: 'F2', block: 'b', rent: 7000, beds: [{ id: 'A', status: 'vac' }] });
  S.put('room', { id: 'r3', no: '301', floor: 'F3', rent: 5000, beds: [{ id: 'A', status: 'vac' }] });
  return S;
}

test('a hostel with no blocks behaves exactly as before', () => {
  assert.equal(T.blocksOn(), false);
  assert.equal(T.rooms().length, T.allRooms().length);
  T.setBlockScope('a');                               // a stale scope must not hide anything
  assert.equal(T.rooms().length, T.allRooms().length);
  T.setBlockScope('');
});

test('choosing a block narrows rooms and residents, and clearing it restores them', () => {
  withBlocks();
  const a = T.checkIn({ name: 'Amit', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 6000, checkIn: '2026-01-01' });
  const b = T.checkIn({ name: 'Bhavna', phone: '9000000002', roomId: 'r2', bed: 'A', rent: 7000, checkIn: '2026-01-01' });
  T.setBlockScope('a');
  assert.equal(JSON.stringify(T.rooms().map(r => r.no)), '["101"]');
  assert.equal(JSON.stringify(T.residents().map(r => r.name)), '["Amit"]');
  T.setBlockScope('b');
  assert.equal(JSON.stringify(T.residents().map(r => r.name)), '["Bhavna"]');
  T.setBlockScope('-');                               // rooms that belong to no block
  assert.equal(JSON.stringify(T.rooms().map(r => r.no)), '["301"]');
  T.setBlockScope('');
  assert.equal(T.residents().length, 2);
  assert.equal(T.resBlock(T.resById(a.id)), 'a');
  assert.equal(T.resBlock(T.resById(b.id)), 'b');
});

test('a resident moved to another wing takes their whole history with them', () => {
  withBlocks();
  const r = T.checkIn({ name: 'Amit', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 6000, checkIn: '2026-01-01' });
  T.recordPayment({ resId: r.id, amount: 6000, date: '2026-01-02' });
  T.shiftBed(r.id, 'r2', 'A', 7000);
  assert.equal(T.resBlock(T.resById(r.id)), 'b');
  T.setBlockScope('b');
  assert.equal(T.payments().length, 1, 'the payment moved with the person');
  T.setBlockScope('a');
  assert.equal(T.payments().length, 0, 'and is no longer counted against the old wing');
  T.setBlockScope('');
});

test('billing ignores the wing filter - every block is charged', () => {
  withBlocks();
  T.checkIn({ name: 'Amit', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 6000, checkIn: '2026-01-01' });
  T.checkIn({ name: 'Bhavna', phone: '9000000002', roomId: 'r2', bed: 'A', rent: 7000, checkIn: '2026-01-01' });
  T.setBlockScope('a');                               // owner is looking at one wing only
  const ym = T.ymOf(T.today());
  T.runAutomation(true);
  T.setBlockScope('');
  const rent = T.invoices().filter(i => i.type === 'rent' && i.period === ym);
  assert.equal(rent.length, 2, 'both wings were billed');
});

test('withAllBlocks lifts the filter for one calculation only', () => {
  withBlocks();
  T.checkIn({ name: 'Amit', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 6000, checkIn: '2026-01-01' });
  T.checkIn({ name: 'Bhavna', phone: '9000000002', roomId: 'r2', bed: 'A', rent: 7000, checkIn: '2026-01-01' });
  T.setBlockScope('a');
  assert.equal(T.residents().length, 1);
  assert.equal(T.withAllBlocks(() => T.residents().length), 2);
  assert.equal(T.residents().length, 1, 'the filter is back afterwards');
  T.setBlockScope('');
});

test('deleting a block leaves its rooms and residents in place, just unassigned', () => {
  const S = withBlocks();
  T.checkIn({ name: 'Bhavna', phone: '9000000002', roomId: 'r2', bed: 'A', rent: 7000, checkIn: '2026-01-01' });
  S.hostels[0].blocks = [{ k: 'a', l: 'Block A' }];   // Block B removed by the platform admin
  assert.equal(T.roomBlock(T.Store.get('r2')), '', 'the stale key stops counting as a block');
  assert.equal(T.withAllBlocks(() => T.residents().length), 1);
  T.setBlockScope('-');
  assert.equal(JSON.stringify(T.rooms().map(r => r.no).sort()), '["201","301"]');
  T.setBlockScope('');
});

test('a login tied to one block cannot see another', () => {
  const S = withBlocks();
  T.checkIn({ name: 'Amit', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 6000, checkIn: '2026-01-01' });
  T.checkIn({ name: 'Bhavna', phone: '9000000002', roomId: 'r2', bed: 'A', rent: 7000, checkIn: '2026-01-01' });
  S.ctx.block = 'b';
  T.setBlockScope('a');                               // even if the stored scope says otherwise
  assert.equal(T.blockScope(), 'b');
  assert.equal(JSON.stringify(T.residents().map(r => r.name)), '["Bhavna"]');
  assert.equal(T.occupancy().total, 1);
  S.ctx.block = ''; T.setBlockScope('');
});

/* ---- the derived indexes ---- */
test('a resident bill index is rebuilt the moment anything changes', () => {
  const r = T.checkIn({ name: 'Amit', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 6000, deposit: 0, checkIn: '2026-01-01' });
  assert.equal(T.resInvoices(r.id).length, 1);
  T.addInvoice({ resId: r.id, type: 'other', title: 'Fan', amount: 500, date: '2026-01-05', due: '2026-01-10' });
  assert.equal(T.resInvoices(r.id).length, 2, 'the new bill is there immediately');
  const got = T.resInvoices(r.id);
  got.length = 0;                                     // callers get their own copy to mangle
  assert.equal(T.resInvoices(r.id).length, 2);
});

/* ---- the public page ---- */
test('the public page refuses to go live until it would be worth reading', () => {
  const S = setupHostel();
  assert.equal(T.siteLive(), false);
  assert.ok(T.siteGaps().length >= 3);
  S.hostels[0].settings = { site: { on: false, about: 'A clean PG for students.', wa: '9876543210',
    roomTypes: [{ l: 'Double', price: 7000 }], photos: { cover: 'https://img.test/front.jpg' } } };
  assert.equal(T.siteGaps().length, 0);
  assert.equal(T.sitePhotos().length, 1);
  assert.equal(T.siteLive(), false, 'still off until the owner switches it on');
  S.hostels[0].settings = { site: { ...S.hostels[0].settings.site, on: true } };
  assert.equal(T.siteLive(), true);
});

/* Photos are links, so the only thing that can go wrong is a link that does not point at an
 * image. A Google Drive "share" link is the one every owner will paste first. */
test('a Google Drive share link becomes something an <img> can load', () => {
  const direct = 'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQrStUvWxYz01234&sz=w1600';
  for (const paste of [
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz01234/view?usp=sharing',
    'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz01234',
    'https://drive.google.com/uc?export=view&id=1AbCdEfGhIjKlMnOpQrStUvWxYz01234',
    'https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz01234',
    '  https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz01234/view  ',
  ]) assert.equal(T.imgUrl(paste), direct, paste);
  // a plain image address is left exactly alone
  assert.equal(T.imgUrl('https://cdn.example.com/a/front.jpg'), 'https://cdn.example.com/a/front.jpg');
  // and anything that is not a link at all is refused rather than put on the page
  for (const bad of ['', '   ', 'front.jpg', 'drive.google.com/file/d/short/view', 'javascript:alert(1)'])
    assert.equal(T.imgUrl(bad), '', JSON.stringify(bad));
});

test('photo slots are fixed and read back by name', () => {
  const S = setupHostel();
  assert.equal(JSON.stringify(T.SITE_PHOTOS.map(x => x[0])), '["logo","hero","about","g1","g2","g3","g4","g5","g6"]');
  S.hostels[0].settings = { site: { photos: { g1: 'https://img.test/room.png', g3: '' } } };
  assert.equal(T.sitePhotoUrl('g1'), 'https://img.test/room.png');
  assert.equal(T.sitePhotoUrl('g3'), '');
  assert.equal(T.sitePhotoUrl('hero'), '');
  assert.equal(T.sitePhotos().length, 1, 'empty slots are skipped, not shown as gaps on the page');
});

test('a page saved with the old photo names still shows its pictures until the owner replaces them', () => {
  const S = setupHostel();
  S.hostels[0].settings = { site: { photos: { cover: 'https://img.test/front.jpg', outside: 'https://img.test/out.jpg', room: 'https://img.test/room.jpg' } } };
  assert.equal(T.sitePhotoUrl('hero'), 'https://img.test/front.jpg');
  assert.equal(T.sitePhotoUrl('about'), 'https://img.test/out.jpg');
  assert.equal(T.sitePhotoUrl('g1'), 'https://img.test/room.jpg');
  // a new slot wins over the old one
  S.hostels[0].settings = { site: { photos: { cover: 'https://img.test/front.jpg', hero: 'https://img.test/new.jpg' } } };
  assert.equal(T.sitePhotoUrl('hero'), 'https://img.test/new.jpg');
});

test('the public address is the hostel name on our own domain', () => {
  const S = setupHostel();
  S.hostels[0].name = 'Sunrise Boys PG';
  assert.equal(T.siteSlug(), 'sunrise-boys-pg', 'a sensible default without the owner typing one');
  assert.match(T.siteUrl(), /site\.html\?h=hx$/, 'by id until a domain is configured');
  T.CFG.PUBLIC_SITE_BASE = 'https://sarvlekh.in/';
  assert.equal(T.siteUrl(), 'https://sarvlekh.in/h/sunrise-boys-pg');
  S.hostels[0].settings = { site: { slug: 'sunrise-kota' } };
  assert.equal(T.siteUrl(), 'https://sarvlekh.in/h/sunrise-kota', 'the owner can shorten it');
  T.CFG.PUBLIC_SITE_BASE = '';
});

test('the public page is off wherever the platform admin has not given the module', () => {
  const S = setupHostel('owner', { modules: { landing: false } });
  S.hostels[0].settings = { site: { on: true, about: 'x', wa: '9876543210', roomTypes: [{ l: 'D', price: 1 }] } };
  assert.equal(T.siteLive(), false);
});


/* ===================================================================== electricity mid-month
 * The case that used to quietly overcharge somebody: a second resident moves into a two-bed
 * room halfway through the month. Splitting the month's units by days gives the first
 * resident 2/3 of them. What they actually used is the whole of the first fortnight plus half
 * of the second — which only a reading taken on the day the roommate arrives can show.
 */
function elecRoom() {
  const S = setupHostel('owner', { settings: { elec: { rate: 10, freeUnits: 0, freeMode: 'resident', readingDay: 1 } } });
  return S;
}
const unitsOf = id => T.Store.all('meter').filter(m => !m.opening)
  .reduce((n, m) => n + (((m.shares || []).find(s => s.resId === id) || {}).units || 0), 0);

test('a reading taken when somebody moves in charges each resident for what they used', () => {
  elecRoom();
  const a = T.checkIn({ name: 'Asha', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 5000, deposit: 0, checkIn: '2026-01-01' });
  T.setOpeningReading('r1', 100, '2026-01-01');

  // the 15th: read the meter first, then move the new resident in
  T.moveReading('r1', 150, '2026-01-15');
  const b = T.checkIn({ name: 'Beena', phone: '9000000002', roomId: 'r1', bed: 'B', rent: 5000, deposit: 0, checkIn: '2026-01-15' });

  // month end
  T.addReading({ roomId: 'r1', curr: 200, date: '2026-01-31' });

  assert.equal(unitsOf(a.id), 75, 'all of the first fortnight plus half of the second');
  assert.equal(unitsOf(b.id), 25, 'half of the second fortnight only');
  assert.equal(unitsOf(a.id) + unitsOf(b.id), 100, 'every unit on the meter is billed once');

  // and the money follows, at 10 a unit
  const bill = id => T.resInvoices(id).filter(i => i.type === 'electricity').reduce((n, i) => n + i.amount, 0);
  assert.equal(bill(a.id), 750);
  assert.equal(bill(b.id), 250);
});

test('without that reading the same month is split by days, which is the old, blunter answer', () => {
  elecRoom();
  const a = T.checkIn({ name: 'Asha', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 5000, deposit: 0, checkIn: '2026-01-01' });
  T.setOpeningReading('r1', 100, '2026-01-01');
  const b = T.checkIn({ name: 'Beena', phone: '9000000002', roomId: 'r1', bed: 'B', rent: 5000, deposit: 0, checkIn: '2026-01-15' });
  T.addReading({ roomId: 'r1', curr: 200, date: '2026-01-31' });
  // 30 days vs 16 days → roughly two thirds / one third, not 75/25
  assert.ok(unitsOf(a.id) > 60 && unitsOf(a.id) < 70, 'first resident carries about two thirds: ' + unitsOf(a.id));
  assert.equal(Math.round(unitsOf(a.id) + unitsOf(b.id)), 100);
});

test('the meter reading is required at every move, and a new room takes it as its start', () => {
  elecRoom();
  // no reading has ever been taken for this room: the box still shows, and the first one opens the room
  assert.deepEqual(JSON.parse(JSON.stringify(T.moveReadingHint('r1'))), { last: null, names: [] });
  const o = T.moveReading('r1', 150, '2026-01-15');
  assert.equal(o.opening, true); assert.equal(o.curr, 150);
  assert.throws(() => T.moveReading('r1', '', '2026-01-20'), /Enter the meter reading/);
  assert.throws(() => T.moveReading('r1', undefined, '2026-01-20'), /Enter the meter reading/);
});

test('free units: a stay of part of a month earns free units only for its days', () => {
  setupHostel('owner', { settings: { elec: { rate: 10, freeUnits: 30, freeMode: 'resident', readingDay: 1 } } });
  assert.equal(T.freeMonths('2026-11-01', '2026-12-01'), 1);
  assert.equal(T.freeMonths('2026-02-01', '2026-03-01'), 1);
  assert.equal(T.freeMonths('2026-01-01', '2026-02-01'), 1);
  assert.equal(T.freeMonths('2026-11-01', '2026-11-16'), 0.5);
  assert.equal(T.freeMonths(null, '2026-11-16'), 1);
  // Asha stays the whole of November, Beena leaves on the 16th, the room used 60 units in the half
  const a = T.checkIn({ name: 'Asha', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 5000, deposit: 0, checkIn: '2026-11-01' });
  const b = T.checkIn({ name: 'Beena', phone: '9000000002', roomId: 'r1', bed: 'B', rent: 5000, deposit: 0, checkIn: '2026-11-01' });
  T.setOpeningReading('r1', 0, '2026-11-01');
  const m1 = T.moveReading('r1', 60, '2026-11-16');       // 15 days, 2 people, 30 units each; free 15 each
  assert.equal(JSON.stringify(m1.shares.map(s => s.free)), '[15,15]');
  assert.equal(JSON.stringify(m1.shares.map(s => s.amount)), '[150,150]');
  T.checkout(b.id, '2026-11-16');
  const m2 = T.addReading({ roomId: 'r1', curr: 90, date: '2026-12-01' });   // 30 units, Asha alone, free 15
  assert.equal(m2.shares.length, 1);
  assert.equal(m2.shares[0].resId, a.id); assert.equal(m2.shares[0].free, 15); assert.equal(m2.shares[0].amount, 150);
});

test('free units per room: the pool is shared and shrinks with the days', () => {
  setupHostel('owner', { settings: { elec: { rate: 10, freeUnits: 30, freeMode: 'room', readingDay: 1 } } });
  T.checkIn({ name: 'Asha', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 5000, deposit: 0, checkIn: '2026-11-01' });
  T.checkIn({ name: 'Beena', phone: '9000000002', roomId: 'r1', bed: 'B', rent: 5000, deposit: 0, checkIn: '2026-11-01' });
  T.setOpeningReading('r1', 0, '2026-11-01');
  const m = T.moveReading('r1', 60, '2026-11-16');        // pool of 15 for the fortnight: (60-15)/2 each
  assert.equal(JSON.stringify(m.shares.map(s => s.amount)), '[225,225]');
});

test('a short mid-month stretch does not push the next full month into review', () => {
  elecRoom();
  T.checkIn({ name: 'Asha', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 5000, deposit: 0, checkIn: '2026-01-01' });
  T.setOpeningReading('r1', 100, '2026-01-01');
  const short = T.moveReading('r1', 110, '2026-01-04');   // 3 days, 10 units
  assert.equal(short.status, 'billed');
  const full = T.addReading({ roomId: 'r1', curr: 200, date: '2026-02-01' });   // 28 days, 90 units: same daily rate
  assert.equal(full.status, 'billed');
});

test('a reading below the last one is refused rather than billing a negative', () => {
  elecRoom();
  T.checkIn({ name: 'Asha', phone: '9000000001', roomId: 'r1', bed: 'A', rent: 5000, deposit: 0, checkIn: '2026-01-01' });
  T.setOpeningReading('r1', 100, '2026-01-01');
  assert.throws(() => T.moveReading('r1', 80, '2026-01-15'), /cannot be less/);
});

/* ---- the monthly bill: the one message the gateway sends by itself ---- */
test('monthly bill: rent + electricity in one message, once, and only when the meter is read', () => {
  setupHostel('owner', { settings: { elec: { rate: 10, freeUnits: 0, freeMode: 'resident' }, wa: { monthly: { on: true, fallbackDay: 28 } } } });
  const ym = T.today().slice(0, 7), first = ym + '-01';
  const r = T.checkIn({ name: 'Asha', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 5000, deposit: 0, checkIn: T.addDays(first, -60) });
  assert.equal(T.monthlyBillsDue().length, 0, 'no rent bill yet');
  T.addInvoice({ id: `inv-rent-${r.id}-${ym}`, resId: r.id, roomId: 'r1', type: 'rent', period: ym, title: 'Rent', amount: 5000, date: first, due: first });
  const day = +T.today().slice(8);
  if (day < 28) assert.equal(T.monthlyBillsDue().length, 0, 'waits for the meter reading, so electricity is not left out');
  T.setOpeningReading('r1', 100, T.addDays(first, -30));
  T.addReading({ roomId: 'r1', curr: 150, date: T.today() });             // 50 units × 10 = 500
  const due = T.monthlyBillsDue();
  assert.equal(due.length, 1); assert.equal(due[0].due, 5500);
  const msg = T.monthlyBillMsgs(due)[0].text;
  assert.ok(msg.includes('Rent') && msg.includes('Electricity'), 'both bills in the one message');
  T.markReminded(due);
  assert.equal(T.monthlyBillsDue().length, 0, 'never a second one this month');
});

test('monthly bill: from the fallback day it goes with rent only; switched off, nothing is due', () => {
  setupHostel('owner', { settings: { elec: { rate: 10, freeUnits: 0 }, wa: { monthly: { on: true, fallbackDay: 1 } } } });
  const ym = T.today().slice(0, 7), first = ym + '-01';
  const r = T.checkIn({ name: 'Beena', phone: '9876543211', roomId: 'r1', bed: 'A', rent: 5000, deposit: 0, checkIn: T.addDays(first, -60) });
  T.addInvoice({ id: `inv-rent-${r.id}-${ym}`, resId: r.id, roomId: 'r1', type: 'rent', period: ym, title: 'Rent', amount: 5000, date: first, due: first });
  assert.equal(T.monthlyBillsDue().length, 1, 'fallback day reached, rent is not held up');
  setupHostel('owner', { settings: { wa: { monthly: { on: false, fallbackDay: 1 } } } });
  assert.equal(T.monthlyBillsDue().length, 0);
});

/* ---- the Excel analysis workbook ---- */
test('periods: presets, financial year and a custom range given back to front', () => {
  const p = k => T.repPresets('2026-11-02').find(x => x.k === k);
  assert.deepEqual([p('this_month').from, p('this_month').to], ['2026-11-01', '2026-11-02']);
  assert.deepEqual([p('last_month').from, p('last_month').to], ['2026-10-01', '2026-10-31']);
  assert.deepEqual([p('this_fy').from, p('this_fy').to], ['2026-04-01', '2026-11-02']);
  assert.deepEqual([p('last_fy').from, p('last_fy').to], ['2025-04-01', '2026-03-31']);
  assert.deepEqual([T.repPresets('2026-02-10').find(x => x.k === 'this_fy').from], ['2025-04-01'], 'Jan–Mar belongs to the year that began the April before');
  const r = T.repRange('custom', '2026-05-20', '2026-05-01');
  assert.deepEqual([r.from, r.to], ['2026-05-01', '2026-05-20']);
  assert.equal(T.repIn('2026-05-20', r), true); assert.equal(T.repIn('2026-05-21', r), false);
});

test('xlsx writer: a real zip with unique, legal sheet names and styled cells', () => {
  const bytes = T.Xlsx.build({ title: 't', sheets: [
    { name: 'A very long hostel name that overflows Excel limit', rows: [[{ v: 'x', s: 'title' }, 5, { f: 'SUM(B1:B1)', v: 5, s: 'totM' }]], cols: [20, 10, 10] },
    { name: 'A very long hostel name that overflows Excel limit', rows: [['dup']] },
  ] });
  const text = Buffer.from(bytes).toString('latin1');
  assert.equal(text.slice(0, 2), 'PK');
  for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) assert.ok(text.includes(part), part);
  const names = [...text.matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
  assert.equal(names.length, 2); assert.notEqual(names[0], names[1]);
  assert.ok(names.every(n => n.length <= 31), names.join(' | '));
  assert.ok(text.includes('<f>SUM(B1:B1)</f>') && text.includes('fullCalcOnLoad'));
});

test('analysis workbook: the numbers on the page are the numbers in the books', () => {
  setupHostel('owner', { settings: { elec: { rate: 10, freeUnits: 0 } } });
  const ym = T.today().slice(0, 7), d1 = ym + '-01';
  const r = T.checkIn({ name: 'Asha', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 3000, checkIn: T.addDays(d1, -40) });
  T.addInvoice({ id: `inv-rent-${r.id}-${ym}`, resId: r.id, roomId: 'r1', type: 'rent', period: ym, title: 'Rent', amount: 6000, date: d1, due: d1 });
  T.recordPayment({ resId: r.id, amount: 5000, mode: 'upi', date: d1 });
  T.Store.put('exp', { date: d1, cat: 'Groceries', amount: 1200, mode: 'cash', paid: true, vendor: 'Gupta' });
  T.Store.put('exp', { date: d1, cat: 'Gas', amount: 800, mode: 'credit', paid: false });
  T.Store.put('laundry', { resId: r.id, roomId: 'r1', pcs: 12, extra: 2, charge: 40, date: d1, status: 'received' });
  const w = T.Report.workbook(d1, T.today(), 'This month');
  assert.ok(w.name.startsWith('Test PG - Complete Analysis') && w.name.endsWith('.xlsx'));
  assert.equal(w.D.exp.all, 2000); assert.equal(w.D.exp.total.Groceries, 1200);
  assert.equal(w.D.exp.unpaid.length, 1, 'the unpaid gas bill is a payable, not a cash outflow');
  assert.equal(w.D.cash.outAll, 1200, 'only what was actually paid leaves the cash flow');
  assert.equal(w.D.rev.total.rent, 6000);
  const sumOf = o => Math.round(Object.values(o).reduce((a, b) => a + b, 0) * 100) / 100;
  assert.equal(Math.round((sumOf(w.D.cash.dep) + w.D.collected + sumOf(w.D.cash.adv)) * 100) / 100, 5000, 'every rupee received lands in exactly one line: deposits, bills or advance');
  assert.equal(w.D.cash.byMode.upi, 5000);
  assert.equal(w.D.ld.length, 1);
  assert.ok(w.bytes.length > 4000);
  const text = Buffer.from(w.bytes).toString('latin1');
  assert.ok(text.includes('Test PG') && text.includes('Cost Analysis') && text.includes('Inventory'));
});

/* ---- the demo hostel ---- */
test('demo hostel: the full data set loads, and every number in it is made up', () => {
  const S = setupHostel('owner');
  S.hostels[0].settings = { demo: true };
  T.Store.remove('r1');
  T.seedDemo('775a9f61-043d-4d99-a651-91d087148640', { big: true });
  const res = T.allResidents(), staff = T.Store.all('staff');
  assert.ok(res.length >= 15, 'a full hostel: ' + res.length);
  assert.ok(T.allRooms().length >= 12 && staff.length === 5 && T.items().length >= 10);
  const phones = [...res.map(r => r.phone), ...res.map(r => r.guardianPhone), ...staff.map(s => s.phone)];
  assert.ok(phones.every(p => /^5\d{9}$/.test(p)), 'no real-looking mobile numbers: ' + phones.filter(p => !/^5\d{9}$/.test(p)).slice(0, 3));
  assert.equal(T.isDemoHostel(), true);
  assert.equal(T.WaGw.on(), false, 'nothing is sent from a demo hostel');
  assert.ok(T.allResidents().filter(r => r.status === 'active').some(r => T.resDue(r.id) > 0), 'some residents owe money, so there is something to show');
});

/* ---- WhatsApp messages: plain, readable on every phone ---- */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}\u{20B9}\u2022\u2013\u2014]/u;
test('messages carry no emoji, symbols or rupee sign (they arrive as empty boxes on some phones)', () => {
  for (const lang of ['en', 'hi']) {
    for (const [key, text] of Object.entries(T.WA_TPL[lang])) assert.ok(!EMOJI.test(text), lang + '.' + key + ' has a symbol: ' + (text.match(EMOJI) || [])[0]);
  }
  setupHostel('owner', { settings: { pay: { upiId: 'pg@upi' }, wa: { lang: 'en' } } });
  const r = T.checkIn({ name: 'Asha Verma', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 6000, deposit: 6000, checkIn: '2026-01-01' });
  const bill = T.billMessage(r).text, rcpt = (T.recordPayment({ resId: r.id, amount: 2500, mode: 'upi' }), T.receiptMessage(T.Store.all('pay')[0])), hi = T.welcomeMessage(r, { username: 'asha.verma', password: '9876543210' });
  for (const m of [bill, rcpt, hi]) assert.ok(!EMOJI.test(m), 'symbol in: ' + m.slice(0, 60));
  assert.match(bill, /Rs\. [\d,]+/); assert.ok(bill.includes('Hello Asha,') && bill.includes('Total due:') && bill.includes('Thank you,'));
  assert.equal(T.rs(6000), 'Rs. 6,000'); assert.equal(T.rs(1234567.4), 'Rs. 12,34,567');
  assert.match(rcpt, /Amount: \*Rs\. 2,500\*/);
});

/* ---- installing as an app ---- */
const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  whatsappWebview: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0',
};
test('install: every common browser gets the instruction it can actually follow', () => {
  const d = (ua, o = {}) => T.Pwa.detect({ ua, platform: 'Win32', touch: 0, ...o }).mode;
  assert.equal(d(UA.chromeAndroid, { hasEvt: true }), 'prompt');
  assert.equal(d(UA.edgeWin, { hasEvt: true }), 'prompt');
  assert.equal(d(UA.chromeAndroid), 'chromium');       // Chrome that has not offered the dialog yet
  assert.equal(d(UA.chromeWin), 'chromium');
  assert.equal(d(UA.samsung), 'chromium');
  assert.equal(d(UA.iphoneSafari, { platform: 'iPhone', touch: 5 }), 'ios');
  assert.equal(d(UA.iphoneChrome, { platform: 'iPhone', touch: 5 }), 'ios');    // iOS Chrome installs through the same Share menu
  assert.equal(d(UA.ipadDesktopMode, { platform: 'MacIntel', touch: 5 }), 'ios');
  assert.equal(d(UA.safariMac, { platform: 'MacIntel', touch: 0 }), 'safari-mac');
  assert.equal(d(UA.firefoxAndroid), 'firefox-android');
  assert.equal(d(UA.firefoxWin), 'none');              // Firefox on a computer cannot install web apps
  assert.equal(d(UA.whatsappWebview, { hasEvt: true }), 'none');   // an in-app browser cannot, even if it fires the event
  assert.equal(d(UA.instagram, { platform: 'iPhone', touch: 5 }), 'none');
  assert.equal(T.Pwa.detect({ ua: UA.iphoneChrome, platform: 'iPhone', touch: 5 }).browser, 'chrome');
  assert.equal(T.Pwa.detect({ ua: UA.edgeWin }).browser, 'edge');
});
test('install: the pop-up waits two minutes, steps exist for every manual mode, and a "not now" is remembered', () => {
  assert.equal(T.Pwa.AFTER_MS, 120000);
  for (const m of ['ios', 'safari-mac', 'firefox-android', 'chromium']) assert.ok(T.Pwa.steps(m, { os: 'desktop', browser: 'safari' }).length >= 3, m);
  assert.equal(T.Pwa.installed(), false); assert.equal(T.Pwa.snoozed(), false);
  T.Pwa.snooze(7);
  assert.equal(T.Pwa.snoozed(), true);
  assert.ok(+T.LS.get('x') !== 1);   // (LS is unaffected: Pwa keeps its own keys)
});

/* ---- stock ledger: exact, idempotent, reconcilable ---- */
function kitchen(perPerson = 0.1) {
  T.Store.put('item', { id: 'rice', name: 'Rice', unit: 'kg', stock: 10 });
  T.Store.put('dish', { id: 'd1', name: 'Rice', meal: 'any', serves: 10, ings: [{ itemId: 'rice', qty: perPerson * 10 }] });
  const week = {}; for (let i = 0; i < 7; i++) week[i] = { lunch: ['d1'] };
  T.Store.put('menu', { id: 'menu', week });
  T.checkIn({ name: 'A', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 0, checkIn: '2025-01-01' });
  T.checkIn({ name: 'B', phone: '9876543211', roomId: 'r1', bed: 'B', rent: 0, checkIn: '2025-01-01' });
}
const book = id => T.ledger().get(id);
test('ledger: the balance is the opening balance plus every movement, and it adds up exactly', () => {
  setupHostel('owner'); kitchen();
  const it = T.itemById('rice');
  T.postMove('rice', T.toM(0.1), 'receive', { id: 'a' }); T.postMove('rice', T.toM(0.2), 'receive', { id: 'b' });
  assert.equal(T.stockOf(it), 10.3);                 // 10 + 0.1 + 0.2, no 10.300000000000001
  for (let i = 0; i < 1000; i++) T.postMove('rice', 1, 'receive', { id: 'g' + i });   // 1000 x 0.001 kg
  assert.equal(T.stockOf(it), 11.3);
  const e = book('rice');
  assert.equal(e.qm, e.anchor.qm + e.rows.reduce((s, x) => s + x.qm, 0), 'balance = opening + movements');
  assert.equal(e.anchor.qm, 10000);
});
test('ledger: the same event can never be booked twice', () => {
  setupHostel('owner'); kitchen();
  const it = T.itemById('rice');
  T.postMove('rice', T.toM(5), 'receive', { id: 'once' }); T.postMove('rice', T.toM(5), 'receive', { id: 'once' });
  assert.equal(T.stockOf(it), 15);
  const pr = T.createPR({ items: [{ itemId: 'rice', qty: 5, leftQty: null }] });
  T.receivePR(pr.id, { rice: { qty: 5, rate: 40 } }); T.receivePR(pr.id, { rice: { qty: 5, rate: 40 } });   // pressed twice
  assert.equal(T.stockOf(it), 20);
  assert.equal(T.Store.all('exp').filter(x => x.ref === pr.id).length, 1);
});
test('ledger: a day of consumption is booked once, completely, with the figures it came from', () => {
  setupHostel('owner'); kitchen();
  const it = T.itemById('rice'), day = T.addDays(T.today(), -1);
  assert.equal(T.postConsumption(day), true);
  assert.equal(T.postConsumption(day), false);       // second device / second run: nothing
  assert.equal(T.stockOf(it), 9.8);                  // 2 people x 0.1 kg
  const row = T.Store.get('mv-useday-' + day);
  assert.equal(row.items.rice, -200); assert.equal(row.basis.eaters.lunch, 2); assert.equal(row.basis.factor.rice, 1);
  assert.equal(T.Store.all('mv').filter(r => r.type === 'use' && r.date === day).length, 1);
});
test('ledger: a gap in opening the app is caught up day by day, without doubling anything', () => {
  setupHostel('owner'); kitchen();
  const it = T.itemById('rice'), t0 = T.today();
  T.postConsumption(T.addDays(t0, -6));
  assert.equal(T.catchUpConsumption(t0), 5);          // days -5 .. -1
  assert.equal(T.catchUpConsumption(t0), 0);
  assert.equal(T.stockOf(it), 10 - 6 * 0.2);
});
test('ledger: nothing is clamped - a shortfall shows as a negative balance and still reconciles', () => {
  setupHostel('owner'); kitchen();
  const it = T.itemById('rice');
  T.postMove('rice', T.toM(-12.5), 'waste', { id: 'w' });
  assert.equal(T.stockOf(it), -2.5);
  assert.deepEqual(JSON.parse(JSON.stringify(T.auditStock().map(x => x.problem))), ['below zero']);
  T.countTo('rice', 4, 'count', '', 'c1');
  assert.equal(T.stockOf(it), 4);
  assert.equal(T.itemMoves('rice').filter(x => x.type === 'count')[0].qm, 6500);
});
test('ledger: stock from before the ledger carries over, and old per-item usage rows count as booked', () => {
  setupHostel('owner'); kitchen();
  const day = T.addDays(T.today(), -1);
  T.Store.put('mv', { id: 'mv-use-rice-' + day, itemId: 'rice', qty: -0.2, type: 'use', date: day, ref: 'auto' });   // written by the old version
  assert.equal(T.usageBooked(day), true); assert.equal(T.postConsumption(day), false);
  assert.equal(T.stockOf(T.itemById('rice')), 10);   // the cached figure until the first movement
  T.postMove('rice', T.toM(1), 'receive', { id: 'r' });
  assert.equal(T.stockOf(T.itemById('rice')), 11);
  assert.equal(book('rice').anchor.qm, 10000);
});
test('ledger: money is worked in whole paise', () => {
  assert.equal(T.lineTotal(7, 0.07), 49); assert.equal(T.lineTotal(3, 19.99), 5997); assert.equal(T.lineTotal(0.333, 33), 1099);   // paise
  assert.equal(T.prTotal({ items: [{ recvQty: 3, rate: 19.99 }, { recvQty: 0.1, rate: 0.3 }] }), 59.97 + 0.03);
});
test('ledger: the demo kitchen runs on the ledger without surprises', () => {
  const S = setupHostel('owner'); S.hostels[0].settings = { demo: true };
  T.Store.remove('r1');
  T.seedDemo('775a9f61-043d-4d99-a651-91d087148640', { big: true });
  const its = T.items(); assert.ok(its.length >= 10);
  const before = its.map(i => T.stockOf(i));
  T.catchUpConsumption(T.today());                  // the seed already booked its own days: only new gaps are filled
  T.catchUpConsumption(T.today());
  for (const i of T.items()) { const e = T.ledger().get(i.id); if (e) assert.equal(T.stockM(i), e.qm); }
  assert.ok(T.auditStock().every(x => x.problem === 'not in ledger yet' || x.problem === 'below zero'));
  assert.equal(before.length, its.length);
});

test('hostel address: <name>.<domain> when a domain is set, /h/<name> otherwise, never a reserved name', () => {
  setupHostel('owner'); T.Store.hostels[0].name = 'Shreedham - Luxury boys PG';
  assert.ok(T.siteUrl().includes('site.html?h='));                         // nothing connected yet
  T.CFG.PUBLIC_SITE_BASE = 'https://sarvlekh.in';
  assert.equal(T.siteUrl(), 'https://sarvlekh.in/h/shreedham-luxury-boys-pg');
  T.CFG.PUBLIC_SITE_DOMAIN = 'sarvlekh.in';
  assert.equal(T.siteUrl(), 'https://shreedham-luxury-boys-pg.sarvlekh.in');
  T.Store.hostels[0].name = 'WWW'; assert.equal(T.siteUrl(), 'https://sarvlekh.in/h/www');   // reserved: falls back to the path address
  assert.ok(T.siteSlugProblem('app') && T.siteSlugProblem('-x') && !T.siteSlugProblem('shreedham'));
});
