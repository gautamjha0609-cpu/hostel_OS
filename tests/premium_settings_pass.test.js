// Premium pass: info icons, simpler labels, extra gallery photos, and the monthly-bill switches that now work.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');

function boot() {
  const mem = {};
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, URL, URLSearchParams, Date, Math, JSON, TextEncoder, Uint8Array,
    localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, key: () => null, length: 0 },
    navigator: { onLine: true, vibrate() {} },
    location: { href: 'https://app.test/index.html', hash: '', origin: 'https://app.test', pathname: '/index.html' },
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {} }, body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} }, createElement: () => ({ setAttribute() {}, appendChild() {}, querySelector: () => null }) },
    matchMedia: () => ({ matches: false }), addEventListener() {},
  };
  ctx.window = ctx; ctx.window.HOSTELOS_CONFIG = {};
  vm.createContext(ctx);
  vm.runInContext(`var PAGES = {}, A = {}, ui = { tab: {}, q: {}, flt: {}, lim: {} }; toast = () => {}; go = () => {}; formModal = () => {}; closeModal = () => {}; render = () => {};`, ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js', 'ui-ops.js', 'ui-owner.js', 'ui-settings.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  vm.runInContext(`globalThis.T = { Store, SETTINGS_PAGES, SET_FORMS, sfVisible, sfInitial, depositFor, S, group, tip, siteGalleryKeys, siteNextPhotoKey, sitePhotos, runMonthlyBillingBatch, Suggest, withTip, meterReadingProblem, setOpening: typeof setOpeningReading !== 'undefined' ? setOpeningReading : null, replaceMeter, lastMeter, moveReading, chargeApplies, billChargeNow, chargesSummary, rentDueDays, activeRes, resInvoices, addInvoice, ymOf, today, checkIn, openInv, Picker: typeof Picker !== 'undefined' ? Picker : null, PAGES };`, ctx);
  return ctx.T;
}

function setup(settings = {}) {
  const T = boot(), St = T.Store;
  St.me = { id: 'u1', full_name: 'X' };
  St.orgs = [{ id: 'o1', modules: {}, status: 'active', name: 'Org' }];
  St.hostels = [{ id: 'h1', org_id: 'o1', name: 'PG', modules: {}, settings }];
  St.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'o1', perms: [], deny: [] };
  St.put('room', { id: 'r1', no: '101', floor: 'F1', rent: 8000, beds: [{ id: 'A', status: 'vac' }] });
  return T;
}

test('a group note sits behind an "i" next to its title instead of under the list', () => {
  const T = setup();
  const h = T.group('Key numbers', '<div class="li">x</div>', 'The dark bar under the photos.');
  assert.ok(/group-t[^>]*>Key <span class="nwj">numbers<span class="ib-w">/.test(h), 'icon glued to the last word of the title');
  assert.ok(!/class="group-f"/.test(h), 'no paragraph under the list');
  assert.ok(h.includes('The dark bar under the photos.'));
  // with no title there is nowhere to hang an icon, so the note stays visible
  assert.ok(/class="group-f"/.test(T.group('', '<div class="li">x</div>', 'Note')));
});

test('settings pages: no big example cards, the example is inside the title "i"', () => {
  const T = setup();
  for (const k of ['rent', 'deposits_late', 'elec_utils', 'mess_food', 'checkin_out']) {
    const html = T.SETTINGS_PAGES[k]();
    assert.ok(!/background:var\(--card-subtle,#f8fafc\)/.test(html), k + ' still has the inline example card');
    assert.ok(/class="ib-w"/.test(html), k + ' has no info icon');
  }
  assert.ok(T.SETTINGS_PAGES.deposits_late().includes('Rent ₹8,000, 10 days overdue'), 'the example text is kept, behind the icon');
});

test('long dropdown names are short now; none of the settings options is a sentence', () => {
  const T = setup(); let longest = 0, which = '';
  for (const k of ['rent', 'deposits_late', 'elec_utils', 'mess_food', 'checkin_out', 'agreements_comm', 'staffatt']) {
    let html = ''; try { html = T.SETTINGS_PAGES[k](); } catch (e) { continue; }
    for (const m of html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)) { const x = m[1].replace(/&amp;/g, '&'); const main = (x.match(/^(.*?)\s*\(/) || [0, x])[1]; if (main.length > longest) { longest = main.length; which = x; } if (x.length > 48) assert.fail('too long: ' + x); }
  }
  assert.ok(longest <= 36, longest + ' ' + which);
});

test('summary card is the compact grid, and says what the deposit rule really is', () => {
  const T = setup({ deposit: { mode: 'per_bed' } });
  const html = T.PAGES.settings.render();
  assert.ok(html.includes('rules-card') && html.includes('rules-grid'));
  assert.ok(html.includes('Set per room / bed'));
  assert.ok(html.includes('settings-pg'));
});

test('picker: a long "Name (detail)" splits, a short or plain label does not', () => {
  const T = setup(), P = T.Picker;
  assert.deepEqual(Array.from(P.split('Fixed date (same day for everyone)')), ['Fixed date', 'same day for everyone']);
  assert.deepEqual(Array.from(P.split('All residents')), ['All residents', '']);
  assert.deepEqual(Array.from(P.split('UPI (GPay)')), ['UPI (GPay)', '']);
});

test('monthly bill switches really change what the monthly run bills', () => {
  const run = rent => {
    const T = setup({ rent, mess: { billing: 'compulsory', monthlyFee: 2500 }, charges: [{ id: 'c1', name: 'Wi-Fi', amount: 300, frequency: 'monthly', active: true, scope: 'all' }] });
    T.checkIn({ name: 'Aman Sharma', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 8000, deposit: 0, checkIn: '2026-11-01' });
    const r = T.activeRes()[0];
    T.addInvoice({ resId: r.id, roomId: 'r1', type: 'electricity', period: T.ymOf(T.today()), title: 'Electricity', amount: 450, date: T.today(), due: T.today() });
    return T.runMonthlyBillingBatch({ options: { previewOnly: true } }).residents[0];
  };
  const on = run({});
  assert.equal(on.messAmount, 2500); assert.equal(on.chargesAmount, 300); assert.equal(on.elecAmount, 450);
  const off = run({ includeElec: false, includeMess: false, includeCharges: false });
  assert.equal(off.messAmount, 0); assert.equal(off.chargesAmount, 0); assert.equal(off.elecAmount, 0);
  const some = run({ includeMess: false });
  assert.equal(some.messAmount, 0); assert.equal(some.chargesAmount, 300); assert.equal(some.elecAmount, 450);
});

test('extra gallery photos: six fixed slots, then as many as the owner adds', () => {
  const T = setup({ site: { photos: { g1: 'https://x.test/1.jpg', g7: 'https://x.test/7.jpg', g9: 'https://x.test/9.jpg', g8: '' } } });
  assert.deepEqual(Array.from(T.siteGalleryKeys()), ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g9']);
  assert.equal(T.siteNextPhotoKey(), 'g8', 'the first free extra slot');
  assert.deepEqual(Array.from(T.sitePhotos()), ['https://x.test/1.jpg', 'https://x.test/7.jpg', 'https://x.test/9.jpg']);
  const html = T.SETTINGS_PAGES.site();
  assert.ok(html.includes('Gallery photo 7') && html.includes('Gallery photo 9'));
  assert.ok(html.includes('data-k="g8"') && html.includes('Add another photo'));
});

test('public page code shows every extra gallery photo', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'site.js'), 'utf8');
  assert.ok(/galKeys/.test(js) && /\+k\.slice\(1\) > 6/.test(js.replace(/\s+/g, ' ')));
});

// ===== round 3 =====
test('late fee is set in ONE place: the rent page only says when rent is due', () => {
  const T = setup();
  T.SETTINGS_PAGES.rent();
  const rentFields = T.SET_FORMS.rent.fields.map(f => f.name).filter(Boolean);
  assert.ok(rentFields.includes('dueDays') && !rentFields.includes('graceDays'), 'no second grace/late field on the rent page');
  T.SETTINGS_PAGES.deposits_late();
  const late = T.SET_FORMS.deposits_late.fields.map(f => f.name).filter(Boolean);
  assert.ok(['late_on', 'late_mode', 'graceDays', 'maxCap'].every(n => late.includes(n)));
});

test('one "due after" number for every rent bill', () => {
  const T = setup({ rent: { dueDays: 9 } });
  assert.equal(T.rentDueDays(), 9);
  assert.equal(setup({ rent: { dueDays: 0, graceDays: 7 } }).rentDueDays(), 7, 'older hostels fall back to the grace days they had');
  assert.equal(setup().rentDueDays(), 5);
});

test('extra charges: who they apply to, one-time billing happens once, summary adds up', () => {
  const T = setup({ charges: [
    { id: 'c1', name: 'Wi-Fi', amount: 300, frequency: 'monthly', scope: 'all', active: true },
    { id: 'c2', name: 'AC', amount: 500, frequency: 'monthly', scope: 'rooms', roomIds: ['r1'], active: true },
    { id: 'c3', name: 'Key', amount: 200, frequency: 'onetime', scope: 'all', active: true },
    { id: 'c4', name: 'Old', amount: 99, frequency: 'monthly', scope: 'room', roomId: 'r9', active: false } ] });
  const a = T.checkIn({ name: 'Aman Sharma', phone: '9876543210', roomId: 'r1', bed: 'A', rent: 8000, deposit: 0, checkIn: '2026-11-01' });
  const r = T.activeRes()[0];
  assert.ok(T.chargeApplies({ scope: 'rooms', roomIds: ['r1'] }, r) && !T.chargeApplies({ scope: 'rooms', roomIds: ['r2'] }, r));
  assert.ok(T.chargeApplies({ scope: 'residents', resIds: [r.id] }, r) && !T.chargeApplies({ scope: 'residents', resIds: ['x'] }, r));
  assert.ok(!T.chargeApplies({ scope: 'room', roomId: 'r9' }, r), 'older room-scoped charge still honoured');
  assert.ok(T.chargeApplies({ scope: 'all' }, r) && T.chargeApplies({}, r));
  const sm = T.chargesSummary();
  assert.deepEqual({ ...sm }, { active: 3, monthly: 2, onetime: 1, everyone: 300, chosen: 1 });
  const first = T.billChargeNow(T.S().charges[2]);
  assert.equal(first.created, 1);
  assert.equal(T.billChargeNow(T.S().charges[2]).created, 0, 'a second press bills nobody twice');
  assert.throws(() => T.billChargeNow(T.S().charges[0]), /one-time/);
  const run = T.runMonthlyBillingBatch({ options: { previewOnly: true } }).residents[0];
  assert.equal(run.chargesAmount, 800, 'Wi-Fi for everyone + AC for room 101');
});

test('QR: one QR only, no "new QR" anywhere', () => {
  for (const f of ['ui-settings.js', 'ui-ops.js']) {
    const js = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
    assert.ok(!/New QR \(old stops working\)|joinqrnew|gateqrnew/.test(js), f + ' still offers a new QR');
  }
});

test('page text is not cut with "..." in Settings rows (wraps instead)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');
  assert.ok(/\.settings-pg \.li \.t,\.settings-pg \.li \.d\{white-space:normal/.test(css));
});

test('going back keeps the scroll place (router code)', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.ok(/scrollMem/.test(js) && /navBack/.test(js) && /popstate', \(\) => \{ navBack = true/.test(js));
});

test('picker opens above the field when there is no room below', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
  assert.ok(/pop\.classList\.add\('up'\)/.test(js) && /pop\.style\.bottom/.test(js));
});


// ===== meter readings: never lower than the last one =====
test('"i" is bound to the last word of its title, so it never wraps alone', () => {
  const T = setup();
  assert.equal(T.withTip('Damage / maintenance deductions (₹)', '<i/>'), 'Damage / maintenance deductions <span class="nwj">(₹)<i/></span>');
  assert.equal(T.withTip('Rate', '<i/>'), '<span class="nwj">Rate<i/></span>');
  assert.equal(T.withTip('Any title', ''), 'Any title');
});

test('a reading below the last one is refused; equal or higher is fine', () => {
  const T = setup(); T.setOpening('r1', 1000, '2026-11-01');
  assert.equal(T.meterReadingProblem('r1', 1000), null);
  assert.equal(T.meterReadingProblem('r1', 1250), null);
  assert.equal(T.meterReadingProblem('r1', ''), null, 'empty is the form\'s job');
  const msg = T.meterReadingProblem('r1', 900);
  assert.ok(/lower than the last reading \(1,000\)/.test(msg) && /replaced or reset/.test(msg), msg);
  assert.ok(/Replace or reset meter/.test(T.meterReadingProblem('r1', 900, { canReset: false })));
  assert.equal(T.meterReadingProblem('r9', 5), null, 'a room with no reading yet has nothing to be lower than');
});

test('replaced / reset meter: needs the old meter\'s final reading, which cannot be below the last reading', () => {
  const T = setup(); T.setOpening('r1', 1000, '2026-11-01');
  assert.ok(/final reading/.test(T.meterReadingProblem('r1', 5, { reset: true })));
  assert.ok(/cannot be lower than the last reading \(1,000\)/.test(T.meterReadingProblem('r1', 5, { reset: true, oldFinal: 990 })));
  assert.equal(T.meterReadingProblem('r1', 5, { reset: true, oldFinal: 1040 }), null);
});

test('after a replacement the new meter\'s number becomes the floor', () => {
  const T = setup(); T.setOpening('r1', 1000, '2026-11-01');
  T.replaceMeter({ roomId: 'r1', finalOldReading: 1040, startingNewReading: 5, date: '2026-11-10' });
  assert.equal(T.lastMeter('r1').curr, 5);
  assert.equal(T.meterReadingProblem('r1', 3), T.meterReadingProblem('r1', 3), 'still lower than 5');
  assert.ok(T.meterReadingProblem('r1', 3));
  assert.equal(T.meterReadingProblem('r1', 7), null);
});

test('check-in / checkout / shift / swap all stop on a lower reading before saving', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-owner.js'), 'utf8');
  assert.equal((js.match(/meterReadingProblem\(/g) || []).length >= 8, true);
  assert.ok(/mp = meterReadingProblem\(roomId, v\.meterNow, \{ reset: v\.meterNowReset/.test(js));
  assert.ok(/meterResetNow\(r\.roomId, v, 'meterNow', v\.date\)/.test(js));
});

// ===== electricity: tap a room under "Still to read" =====
test('"Still to read": every room is a button that opens its own reading form; long lists fold', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-owner.js'), 'utf8');
  assert.ok(/data-act="readroom" data-id=/.test(js) && /A\.readroom = el =>/.test(js));
  assert.ok(/const all = ui\.flt\.elmore === '1', cap = 12/.test(js), 'folds past 12 rooms with Show all');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');
  assert.ok(/\.el-chips\{display:flex;flex-wrap:wrap/.test(css), 'chips wrap, never overflow');
});

test('the one-room form uses the same meter rules and offers the next room after saving', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-owner.js'), 'utf8');
  const a = js.indexOf('A.readroom = el =>'), body = js.slice(a, a + 3200);
  assert.ok(/meterReadingProblem\(room\.id, v\.curr, \{ reset: v\.currReset, oldFinal: v\.currOldFinal \}\)/.test(body));
  assert.ok(/meterGuard\(form, v, 'curr', room\.id, true\)/.test(body));
  assert.ok(/Next: \{r\}/.test(body));
});

// ===== ingredient suggestions: our own list, never the browser's datalist =====
test('ingredient boxes use our own suggestion list, not the browser datalist', () => {
  const ops = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-ops.js'), 'utf8');
  assert.ok(!/<datalist|list="itemlist"/.test(ops), 'no native datalist left');
  assert.ok(/data-suggest="stock"/.test(ops) && /class="sg-btn"/.test(ops));
  const core = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
  assert.ok(/const Suggest = \{/.test(core) && /pop\.classList\.add\('up'\)/.test(core.slice(core.indexOf('const Suggest'))), 'flips above when there is no room below');
  assert.ok(/stopImmediatePropagation/.test(core), 'Enter on a suggestion never submits the form');
});

test('Suggest filters by what is typed, best matches first, and offers the full list from the arrow', () => {
  const T = setup(), G = T.Suggest;
  G.sources.t = () => [{ v: 'Atta', sub: 'kg' }, { v: 'Paneer', sub: 'kg' }, { v: 'Poha', sub: 'kg' }, { v: 'Spaghetti', sub: 'pkt' }, { v: 'Rice', sub: 'kg' }];
  const box = v => ({ dataset: { suggest: 't' }, value: v });
  assert.deepEqual(G.matches(box('pa'), false).map(x => x.v), ['Paneer', 'Spaghetti'], 'starts-with first, then contains');
  assert.deepEqual(G.matches(box('PO'), false).map(x => x.v), ['Poha']);
  assert.equal(G.matches(box(''), false).length, 5, 'empty box shows everything');
  assert.equal(G.matches(box('zzz'), false).length, 0);
  assert.equal(G.matches(box('pa'), true).length, 5, 'the arrow always shows the full list');
});
