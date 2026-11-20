// Settings show only the boxes that belong to the choice made (showIf), validation skips hidden boxes,
// and the check-in deposit box starts from the hostel's deposit rule.
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
  vm.runInContext(`globalThis.T = { Store, SETTINGS_PAGES, SET_FORMS, sfVisible, sfInitial, depositFor, S };`, ctx);
  return ctx.T;
}
function setup(settings = {}) {
  const T = boot(), St = T.Store;
  St.me = { id: 'u1', full_name: 'X' };
  St.orgs = [{ id: 'o1', modules: {}, status: 'active', name: 'Org' }];
  St.hostels = [{ id: 'h1', org_id: 'o1', name: 'PG', modules: {}, settings }];
  St.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'o1', perms: [], deny: [] };
  return T;
}
// which named boxes are visible for a form, given values overriding the saved ones
function visible(T, formId, over = {}) {
  const f = T.SET_FORMS[formId], v = { ...T.sfInitial(f.fields), ...over };
  return f.fields.filter(x => (x.name || x.key) && T.sfVisible(x, v)).map(x => x.name || x.key);
}

test('deposit: only the box for the chosen mode shows; non-refundable is asked first', () => {
  const T = setup(); T.SETTINGS_PAGES.deposits_late();
  let v = visible(T, 'deposits_late', { dep_mode: 'rent_multiple', nr_on: false, late_on: true, late_mode: 'fixed' });
  assert.ok(v.includes('rentMultiplier') && !v.includes('fixedAmount'));
  assert.ok(v.includes('nr_on') && !v.includes('nonRefundable'), 'amount hidden until the owner says yes');
  v = visible(T, 'deposits_late', { dep_mode: 'fixed', nr_on: true });
  assert.ok(v.includes('fixedAmount') && !v.includes('rentMultiplier') && v.includes('nonRefundable'));
  v = visible(T, 'deposits_late', { dep_mode: 'custom' });
  assert.ok(!v.includes('fixedAmount') && !v.includes('rentMultiplier') && v.includes('dep_note_custom'));
});

test('late fee: nothing but the switch while off; then only the chosen mode\'s amount', () => {
  const T = setup(); T.SETTINGS_PAGES.deposits_late();
  let v = visible(T, 'deposits_late', { late_on: false });
  for (const k of ['late_mode', 'late_amount', 'dailyAmount', 'percentage', 'graceDays', 'maxCap']) assert.ok(!v.includes(k), k + ' must be hidden');
  assert.ok(v.includes('late_on'));
  v = visible(T, 'deposits_late', { late_on: true, late_mode: 'fixed' });
  assert.ok(v.includes('late_amount') && !v.includes('dailyAmount') && !v.includes('percentage') && v.includes('graceDays') && v.includes('maxCap'));
  v = visible(T, 'deposits_late', { late_on: true, late_mode: 'daily' });
  assert.ok(v.includes('dailyAmount') && !v.includes('late_amount') && !v.includes('percentage'));
  v = visible(T, 'deposits_late', { late_on: true, late_mode: 'percentage' });
  assert.ok(v.includes('percentage') && !v.includes('late_amount') && !v.includes('dailyAmount'));
});

test('rent, electricity, mess, attendance, reminders, police follow their choices', () => {
  const T = setup();
  T.SETTINGS_PAGES.rent(); assert.ok(!visible(T, 'rent', { model: 'joining_date' }).includes('day') && visible(T, 'rent', { model: 'calendar_monthly' }).includes('day'));
  assert.ok(!visible(T, 'rent', { prorate: 'full' }).includes('prorateDivisor') && visible(T, 'rent', { prorate: 'prorate' }).includes('prorateDivisor'));
  T.SETTINGS_PAGES.elec_utils();
  const fx = visible(T, 'elec_utils', { pricing: 'fixed', freeUnits: 0 }), sl = visible(T, 'elec_utils', { pricing: 'slab', freeUnits: 30 });
  assert.ok(fx.includes('rate') && !fx.includes('slab1_rate') && !fx.includes('freeMode'));
  assert.ok(!sl.includes('rate') && sl.includes('slab1_rate') && sl.includes('slab3_rate') && sl.includes('freeMode'));
  assert.ok(!visible(T, 'elec_utils', { sharing: 'individual' }).includes('allocation'));
  T.SETTINGS_PAGES.mess_food();
  assert.ok(!visible(T, 'mess_food', { billing: 'included' }).includes('monthlyFee') && visible(T, 'mess_food', { billing: 'compulsory' }).includes('rebatePerDay'));
  T.SETTINGS_PAGES.staffatt();
  assert.ok(!visible(T, 'staffatt', { mode: 'manual' }).includes('lat') && visible(T, 'staffatt', { mode: 'self' }).includes('radius'));
  T.SETTINGS_PAGES.wa();
  assert.ok(!visible(T, 'remind', { on: false }).includes('days') && visible(T, 'remind', { on: true }).includes('days'));
  assert.ok(!visible(T, 'monthly', { on: false }).includes('fallbackDay'));
  T.SETTINGS_PAGES.police();
  assert.ok(!visible(T, 'police', { on: false }).includes('state') && !visible(T, 'police', { on: true, state: '' }).includes('url') && visible(T, 'police', { on: true, state: 'RJ' }).includes('url'));
});

test('hidden boxes render with the hidden attribute (so the page opens already tidy)', () => {
  const T = setup(); const html = T.SETTINGS_PAGES.deposits_late();
  const box = n => html.match(new RegExp(`<div[^>]*data-fw="${n}"[^>]*>`))[0];
  assert.ok(/hidden/.test(box('nonRefundable')) && /hidden/.test(box('late_amount')) === false, 'fixed late fee visible by default, non-refundable hidden');
  assert.ok(/hidden/.test(box('dailyAmount')) && /hidden/.test(box('percentage')));
});

test('check-in deposit box starts from the deposit rule', () => {
  let T = setup({ deposit: { mode: 'rent_multiple', rentMultiplier: 2 } });
  assert.equal(T.depositFor(6000), 12000);
  T = setup({ deposit: { mode: 'fixed', fixedAmount: 10000 } });
  assert.equal(T.depositFor(6000), 10000);
  T = setup();
  assert.equal(T.depositFor(6000), 6000, 'untouched hostel keeps today\'s behaviour: one month of rent');
});
