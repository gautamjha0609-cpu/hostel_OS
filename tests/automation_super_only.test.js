// Automation: rules are Super-Admin-only, late fee starts OFF, kitchen rules follow the kitchen module,
// and the monthly bill goes to Meta as an approved template (plain text stays for 1-tap sending).
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
  vm.runInContext(`globalThis.T = { Store, PAGES, DEFAULTS: typeof DEFAULT_SETTINGS !== 'undefined' ? DEFAULT_SETTINGS : null, visibleRules, monthlyBillMsgs, monthlyBillTemplate, S, MOD };`, ctx);
  return ctx.T;
}
function setup({ isSuper = false, modules = {}, settings = {} } = {}) {
  const T = boot(), St = T.Store;
  St.me = { id: 'u1', full_name: 'X', is_super: isSuper };
  St.orgs = [{ id: 'o1', modules, status: 'active', name: 'Org' }];
  St.hostels = [{ id: 'h1', org_id: 'o1', name: 'Test PG', modules: {}, settings }];
  St.ctx = { key: 'k', role: isSuper ? 'super' : 'owner', hostelId: 'h1', orgId: 'o1', perms: [], deny: [] };
  return T;
}

test('late fee is a Settings policy, not an automation rule; other core rules stay ON', () => {
  const T = setup();
  const a = T.S().auto;
  assert.equal(a.late, undefined, 'no late-fee automation switch any more');
  assert.ok(!T.visibleRules().some(r => r.k === 'late'));
  for (const k of ['rent', 'meter', 'checkout', 'hk']) assert.equal(a[k], true, k);
  assert.ok(T.S().lateFee && 'on' in T.S().lateFee, 'the policy lives in Settings > Deposits & late fee');
});

test('module is called plain "Automation"', () => {
  assert.equal(setup().MOD.automation.l, 'Automation');
});

test('owner sees no rule toggles, only jobs and log; super admin sees them', () => {
  const owner = setup().PAGES.automation.render();
  assert.ok(!owner.includes('data-rule='), 'owner must not get toggles');
  assert.ok(owner.includes('One-tap jobs'));
  const sup = setup({ isSuper: true }).PAGES.automation.render();
  assert.ok(sup.includes('data-rule="rent"'));
});

test('kitchen rules show only when the kitchen module is on', () => {
  const on = setup().visibleRules().map(r => r.k);
  assert.ok(on.includes('stock') && on.includes('lowstock'));
  const off = setup({ modules: { kitchen: false } }).visibleRules().map(r => r.k);
  assert.ok(!off.includes('stock') && !off.includes('lowstock'));
  assert.ok(off.includes('rent'));
});

test('monthly bill: plain text without a template name, Meta template with one', () => {
  const T = setup();
  const r = { id: 'r1', name: 'Aman Sharma', phone: '9876543210', roomId: 'x' };
  const invs = [{ id: 'i1', title: 'Rent Nov', amount: 5000, paid: 0, status: 'open' }];
  const plain = T.monthlyBillMsgs([{ r, due: 5000, invs }])[0];
  assert.ok(plain.text.includes('Aman'));
  assert.equal(plain.template, undefined);
  T.Store.hostels[0].settings = { wa: { monthly: { on: true, template: 'sarvlekh_monthly_bill', language: 'en' } } };
  const m = T.monthlyBillMsgs([{ r, due: 5000, invs }])[0];
  assert.equal(typeof m.text, 'string', 'text stays plain so the 1-tap fallback still works');
  assert.equal(m.template.name, 'sarvlekh_monthly_bill');
  assert.equal(m.template.language.code, 'en');
  const params = m.template.components[0].parameters;
  assert.equal(params.length, 4);
  assert.equal(params[0].text, 'Aman');
  assert.ok(params.every(p => p.type === 'text' && !/\n/.test(p.text)));
});

test('migration blocks owners from changing automation settings', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '2026-11-19_automation_rules_super_only.sql'), 'utf8');
  assert.ok(/not is_super\(\) and \(patch \? 'auto'/.test(sql));
});
