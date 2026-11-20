// Tests for conditional visibility and protection of 'Dishes & recipes' based on Stock & Purchase (kitchen) module
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');

function boot() {
  const mem = {};
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, URL, URLSearchParams, Date, Math, JSON, TextEncoder, Uint8Array,
    localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, key: () => null, length: 0 },
    navigator: { onLine: true, vibrate() {} },
    location: { href: 'https://app.test/index.html', hash: '', origin: 'https://app.test', pathname: '/index.html' },
    document: {
      addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
      documentElement: { dataset: {} }, body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} },
      createElement: () => ({ setAttribute() {}, appendChild() {}, querySelector: () => null })
    },
    matchMedia: () => ({ matches: false }), addEventListener() {},
  };
  ctx.window = ctx;
  ctx.window.HOSTELOS_CONFIG = {};
  vm.createContext(ctx);
  vm.runInContext(`
    var PAGES = {}, A = {}, ui = { tab: {}, q: {}, flt: {}, lim: {} };
    var lastToast = null, lastToastType = null;
    toast = (msg, type) => { lastToast = msg; lastToastType = type; };
    var lastNav = null;
    go = (to) => { lastNav = to; };
    var formModalCalls = [];
    formModal = (opts) => { formModalCalls.push(opts); };
    closeModal = () => {};
    render = () => {};
  `, ctx);

  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js', 'ui-ops.js', 'ui-settings.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }

  vm.runInContext(`
    var lastToast = null, lastToastType = null;
    toast = (msg, type) => { lastToast = msg; lastToastType = type; };
    var lastNav = null;
    go = (to) => { lastNav = to; };
    var formModalCalls = [];
    formModal = (opts) => { formModalCalls.push(opts); };
    var openModalCalls = [];
    openModal = (opts) => { openModalCalls.push(opts); };
    closeModal = () => {};
    render = () => {};

    globalThis.T = {
      Store, PAGES, A, ui, can, orgEnabled, applyModSwitch,
      getLastToast: () => lastToast,
      getLastNav: () => lastNav,
      getFormModalCalls: () => formModalCalls,
      getOpenModalCalls: () => openModalCalls,
      clearModalCalls: () => { formModalCalls = []; openModalCalls = []; }
    };
  `, ctx);
  return ctx.T;
}

let T;
function setup(role = 'owner', modules = {}) {
  T = boot();
  const S = T.Store;
  S.me = { id: 'u1', full_name: 'Test Owner' };
  S.orgs = [{ id: 'o1', modules, status: 'active', name: 'Test Org' }];
  S.hostels = [{ id: 'h1', org_id: 'o1', name: 'Test PG', modules: {}, settings: {} }];
  S.ctx = { key: 'k1', role, hostelId: 'h1', orgId: 'o1', perms: [], deny: [] };
  return S;
}

test('Stock & Purchase ON: Mess & Menu includes Dishes & recipes tab and panels', () => {
  setup('owner');
  assert.equal(T.can('kitchen'), true);

  // Render Mess & Menu page
  const html = T.PAGES.mess.render();
  assert.ok(html.includes('data-tab="dishes"'), 'Tabs must contain dishes tab');
  assert.ok(html.includes('Dishes &amp; recipes'), 'Tab label Dishes & recipes must be present');

  // When switching to dishes tab
  T.ui.tab.mess = 'dishes';
  const dishesHtml = T.PAGES.mess.render();
  assert.ok(dishesHtml.includes('Search dish'), 'Dishes search box must be rendered');
  assert.ok(dishesHtml.includes('Replace ingredient'), 'Replace ingredient button must be present');
  assert.ok(dishesHtml.includes('Add dish'), 'Add dish button must be present');
});

test('Stock & Purchase OFF (hostel level): Dishes & recipes tab is removed and tab falls back to today', () => {
  setup('owner');
  T.Store.hostels[0].modules = { kitchen: false };
  assert.equal(T.can('kitchen'), false);

  // Render Mess & Menu page
  const html = T.PAGES.mess.render();
  assert.ok(!html.includes('data-tab="dishes"'), 'Tabs must NOT contain dishes tab');
  assert.ok(!html.includes('Dishes &amp; recipes'), 'Tab label Dishes & recipes must NOT be present');
  assert.ok(html.includes('Cooking plan'), 'Cooking plan must be present');
  assert.ok(html.includes('Weekly menu'), 'Weekly menu must be present');
  assert.ok(html.includes('Skips &amp; tiffins'), 'Skips & tiffins must be present');

  // If user state had tab set to dishes, it safely falls back to today
  T.ui.tab.mess = 'dishes';
  const fallbackHtml = T.PAGES.mess.render();
  assert.equal(T.ui.tab.mess, 'today', 'Tab state should automatically reset to today');
  assert.ok(!fallbackHtml.includes('Search dish'), 'Dishes search box must NOT be rendered');
  assert.ok(fallbackHtml.includes('Cook for'), 'Should render cooking plan cards');
});

test('Stock & Purchase OFF (org level): Dishes & recipes tab is removed', () => {
  setup('owner', { kitchen: false });
  assert.equal(T.can('kitchen'), false);

  const html = T.PAGES.mess.render();
  assert.ok(!html.includes('data-tab="dishes"'));
  assert.ok(!html.includes('Dishes &amp; recipes'));
});

test('Stock & Purchase OFF: Direct dish mutation actions are guarded', () => {
  setup('owner');
  T.Store.hostels[0].modules = { kitchen: false };

  // Attempt to add dish
  T.A.adddish();
  assert.equal(T.getLastToast(), 'Stock & purchase module is disabled');

  // Attempt to edit dish
  T.A.editdish({ dataset: { id: 'd1' } });
  assert.equal(T.getLastToast(), 'Stock & purchase module is disabled');

  // Attempt to replace ingredient
  T.A.replaceing({ dataset: { id: 'i1' } });
  assert.equal(T.getLastToast(), 'Stock & purchase module is disabled');
});

test('Settings integration: Weekly menu and Dishes & recipes adjust when kitchen is OFF', () => {
  setup('owner');
  // When kitchen is on
  // Test A.messtab with kitchen on
  T.A.messtab({ dataset: { tab: 'dishes' } });
  assert.equal(T.ui.tab.mess, 'dishes');
  assert.equal(T.getLastNav(), 'mess');

  // Turn kitchen off
  T.Store.hostels[0].modules = { kitchen: false };
  T.A.messtab({ dataset: { tab: 'dishes' } });
  assert.equal(T.ui.tab.mess, 'today', 'A.messtab should redirect dishes tab to today when kitchen is off');
});

test('Re-enabling Stock & Purchase restores Dishes & recipes seamlessly', () => {
  setup('owner');
  T.Store.hostels[0].modules = { kitchen: false };
  assert.equal(T.can('kitchen'), false);
  let html = T.PAGES.mess.render();
  assert.ok(!html.includes('Dishes &amp; recipes'));

  // Re-enable kitchen
  delete T.Store.hostels[0].modules.kitchen;
  assert.equal(T.can('kitchen'), true);
  html = T.PAGES.mess.render();
  assert.ok(html.includes('Dishes &amp; recipes'));
});

test('Cook role: sees Dishes & recipes when kitchen on, hidden when kitchen off', () => {
  setup('cook');
  assert.equal(T.can('kitchen'), true);
  let html = T.PAGES.mess.render();
  assert.ok(html.includes('Dishes &amp; recipes'));

  // Turn off kitchen for this hostel
  T.Store.hostels[0].modules = { kitchen: false };
  assert.equal(T.can('kitchen'), false);
  html = T.PAGES.mess.render();
  assert.ok(!html.includes('Dishes &amp; recipes'));
});

test('User with kitchen denied: Dishes & recipes tab is hidden', () => {
  setup('cook');
  T.Store.ctx.deny = ['kitchen'];
  assert.equal(T.can('kitchen'), false);

  const html = T.PAGES.mess.render();
  assert.ok(!html.includes('Dishes &amp; recipes'));
});

test('Weekly menu cell: "Dish missing? Add a new dish" prompt only present when kitchen is enabled', () => {
  setup('owner');
  T.clearModalCalls();

  // With kitchen ON
  T.A.menucell({ dataset: { day: '1', meal: 'breakfast' } });
  let modal = T.getOpenModalCalls().pop();
  assert.ok(modal.body.includes('Add a new dish'));
  assert.ok(modal.body.includes('data-act="adddish"'));

  // With kitchen OFF
  T.Store.hostels[0].modules = { kitchen: false };
  T.A.menucell({ dataset: { day: '1', meal: 'breakfast' } });
  modal = T.getOpenModalCalls().pop();
  assert.ok(!modal.body.includes('data-act="adddish"'), 'the add-a-new-dish link must be absent when kitchen is off');
});

