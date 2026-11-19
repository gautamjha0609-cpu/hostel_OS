'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createUiSandbox() {
  const store = new Map();
  const sessionStore = new Map();

  let modalState = null;
  let sheetState = null;
  let toastMsg = null;

  const ctx = {
    console,
    Date,
    Math,
    JSON,
    setTimeout: fn => 1,
    clearTimeout: () => {},
    TextEncoder,
    TextDecoder,
    Uint8Array,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      clear: () => store.clear(),
      key: i => Array.from(store.keys())[i] || null,
      get length() { return store.size; }
    },
    sessionStorage: {
      getItem: k => (sessionStore.has(k) ? sessionStore.get(k) : null),
      setItem: (k, v) => sessionStore.set(k, String(v)),
      removeItem: k => sessionStore.delete(k),
      clear: () => sessionStore.clear()
    },
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    removeEventListener: () => {},
    navigator: { userAgent: 'NodeTest', platform: 'Win32' },
    location: { search: '', pathname: '/', hostname: 'localhost', protocol: 'http:', origin: 'http://localhost:5176' },
    document: {
      hidden: false,
      title: '',
      body: { classList: { toggle: () => {} } },
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => []
    },
    openModal: () => {},
    closeModal: () => { modalState = null; },
    updateChrome: () => {},
    render: () => {},
    toast: (msg, type) => { toastMsg = { msg, type }; },
    t: (s, vars) => {
      if (!vars) return s;
      return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`));
    },
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    inr: n => '₹' + Number(n).toLocaleString('en-IN'),
    num: n => Number(n).toLocaleString('en-IN'),
    fmtDate: d => String(d || ''),
    fmtShort: d => String(d || '').slice(5),
    fmtYM: ym => String(ym || ''),
    badge: (txt, cls) => `<span class="badge ${cls || ''}">${txt}</span>`,
    ico: name => `[ico:${name}]`,
    btn: (label, act, attrs = '', cls = '', icon = '') => `<button data-act="${act}" class="${cls}" ${attrs}>${label}</button>`,
    sheet: (title, html, opts = {}) => { sheetState = { title, html, opts }; },
    formModal: opts => { modalState = opts; },
    confirmBox: (msg, fn) => fn(),
    PAGES: {},
    A: {},
    ui: { flt: {}, tab: {}, lim: {} },
    curTab: (k, def) => def,
    curFlt: (k, def) => def,
    avatar: n => `[avatar:${n}]`,
    needle: () => true,
    searchBox: () => '',
    seg: () => '',
    table: () => '',
    kpi: () => '',
    empty: (t, d) => `[empty:${t}]`,
    head: (t, d) => `[head:${t}]`,
    person: r => r.name,
    statBadge: s => `[badge:${s}]`,
    tpl: (k, v) => JSON.stringify(v),
    waLang: () => 'en',
    waOpen: () => {},
    waUrl: () => 'https://wa.me',
    rs: n => '₹' + n
  };

  ctx.window = ctx;
  ctx.window.HOSTELOS_CONFIG = {};
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js', 'ui-owner.js', 'ui-resident.js']) {
    const filePath = path.join(__dirname, '..', 'js', f);
    if (fs.existsSync(filePath)) {
      vm.runInContext(fs.readFileSync(filePath, 'utf8'), ctx, { filename: f });
    }
  }

  vm.runInContext(`
    globalThis.Store = Store;
    globalThis.calcSettlement = calcSettlement;
    globalThis.checkout = checkout;
    globalThis.setOpeningReading = setOpeningReading;
    globalThis.resDue = resDue;
    globalThis.invBal = invBal;
    globalThis.A = A;
    globalThis.formModal = opts => { globalThis._modalState = opts; };
    globalThis.sheet = (title, html, opts = {}) => { globalThis._sheetState = { title, html, opts }; };
    globalThis.toast = (msg, type) => { globalThis._toastMsg = { msg, type }; };
  `, ctx);

  const S = ctx.Store;
  S.me = { id: 'u1', full_name: 'Test Owner' };
  S.orgs = [{ id: 'org1', modules: { electricity: true, mess: true }, status: 'active', owner_name: 'Test Owner' }];
  S.hostels = [{
    id: 'h1',
    org_id: 'org1',
    name: 'Sunrise PG',
    settings: {
      elec: { rate: 10, freeUnits: 0, freeMode: 'resident' }
    }
  }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };

  return {
    ctx,
    S,
    getModal: () => ctx._modalState,
    getSheet: () => ctx._sheetState,
    getToast: () => ctx._toastMsg
  };
}

test('UI 1: A.resout checkout modal generates live electricity preview and completes Zero-Due settlement', () => {
  const { ctx, S, getModal, getSheet, getToast } = createUiSandbox();

  const room = S.put('room', { id: 'rm-201', no: '201', floor: 'F2', rent: 7000, beds: [{ id: 'A', status: 'occ' }] });
  const res = S.put('res', {
    id: 'res-ui-1',
    name: 'Aditya Roy',
    phone: '9876543210',
    roomId: 'rm-201',
    bed: 'A',
    rent: 7000,
    checkIn: '2026-11-01',
    deposit: 5000,
    status: 'active'
  });

  S.put('inv', { id: `inv-dep-${res.id}`, resId: res.id, roomId: 'rm-201', type: 'deposit', amount: 5000, paid: 5000, status: 'paid', date: '2026-11-01' });
  S.put('inv', { id: `inv-rent-${res.id}`, resId: res.id, roomId: 'rm-201', type: 'rent', amount: 7000, paid: 0, date: '2026-11-01' });

  // Baseline meter reading at 200
  ctx.setOpeningReading('rm-201', 200, '2026-11-01');

  // Open checkout modal
  ctx.A.resout({ dataset: { id: res.id } });
  const modal = getModal();
  assert.ok(modal, 'formModal should be opened');

  // Verify preview function with meter reading = 250 (50 units @ ₹10 = ₹500)
  const previewHtml = modal.preview({
    date: '2026-11-15',
    meterNow: '250',
    ded: 0,
    settleAction: 'auto_zero',
    payMode: 'upi'
  });

  assert.ok(previewHtml.includes('Final Electricity Reading') || previewHtml.includes('Final Electricity Reading &amp; Bill'), 'Preview must show electricity bill');
  assert.ok(previewHtml.includes('200') && previewHtml.includes('250'), 'Preview must show previous and current meter readings');
  assert.ok(previewHtml.includes('2,500'), 'Net Balance to collect must be ₹2,500 (Dues 7,500 - Deposit 5,000)');

  // Submit checkout with Zero-Due Guarantee
  modal.onSubmit({
    date: '2026-11-15',
    meterNow: '250',
    ded: 0,
    settleAction: 'auto_zero',
    payMode: 'upi',
    payRef: 'UPI-TXN-12345',
    note: 'Clean checkout'
  });

  // Verify toast
  const toast = getToast();
  assert.ok(toast, 'toast must be called');
  assert.ok(toast.msg.includes('checked out') || toast.msg.includes('Aditya'), `toast was: ${JSON.stringify(toast)}`);

  // Resident must have 0 dues remaining
  assert.equal(ctx.resDue(res.id), 0);
  assert.equal(S.get(res.id).status, 'left');

  // Electricity invoice must exist and be settled
  const elInv = S.all('inv').find(i => i.resId === res.id && i.type === 'electricity');
  assert.ok(elInv);
  assert.equal(elInv.amount, 500);
  assert.equal(ctx.invBal(elInv), 0);

  // Settlement statement receipt must have been opened automatically
  const receipt = getSheet();
  assert.ok(receipt, 'Statement sheet must open on submit');
  assert.ok(receipt.html.includes('Final Settlement Statement'));
  assert.ok(receipt.html.includes('Final Electricity Reading') || receipt.html.includes('Final Electricity Reading &amp; Share'));
  assert.ok(receipt.html.includes('200') && receipt.html.includes('250'));
  assert.ok(receipt.html.includes('Zero-Due Guarantee: Accounts 100% Cleared (₹0 Due)'));
});

test('UI 2: A.rviewinv handles monthly fee notice IDs (fee-notice-YYYY-MM) and displays itemized monthly statement', () => {
  const { ctx, S, getSheet } = createUiSandbox();

  const room = S.put('room', { id: 'rm-202', no: '202', floor: 'F2', rent: 6000, beds: [{ id: 'A', status: 'occ' }] });
  const res = S.put('res', {
    id: 'res-ui-2',
    name: 'Priyanka',
    roomId: 'rm-202',
    bed: 'A',
    rent: 6000,
    checkIn: '2026-11-01',
    deposit: 6000,
    status: 'active'
  });

  // Simulate resident login
  S.me = { id: 'u2', full_name: 'Priyanka' };
  S.ctx = { key: 'res-ctx', role: 'resident', hostelId: 'h1', orgId: 'org1', refId: res.id };

  // Rent invoice
  S.put('inv', { id: `inv-rent-${res.id}`, resId: res.id, roomId: 'rm-202', type: 'rent', amount: 6000, paid: 0, date: '2026-11-01', period: '2026-11' });
  // Electricity meter & invoice
  const meter = S.put('meter', {
    id: 'mtr-202',
    roomId: 'rm-202',
    date: '2026-11-15',
    prev: 100,
    curr: 140,
    units: 40,
    rate: 10,
    status: 'billed',
    shares: [{ resId: res.id, units: 40, free: 0, billable: 40, amount: 400 }]
  });
  S.put('inv', { id: `inv-el-${meter.id}-${res.id}`, meterId: meter.id, resId: res.id, roomId: 'rm-202', type: 'electricity', amount: 400, paid: 0, date: '2026-11-15', period: '2026-11', title: 'Electricity (40 units)' });

  // Resident clicks fee notice on dashboard
  ctx.A.rviewinv({ dataset: { id: 'fee-notice-2026-11' } });

  const sheet = getSheet();
  assert.ok(sheet, 'Billing Statement sheet must open for fee-notice-2026-11');
  assert.ok(sheet.html.includes('Fee Notice &amp; Bills') || sheet.html.includes('Fee Notice & Bills'));
  assert.ok(sheet.html.includes('Total Outstanding Due'));
  assert.ok(sheet.html.includes('6,400'));
  assert.ok(sheet.html.includes('Electricity Meter Split'));
  assert.ok(sheet.html.includes('100') && sheet.html.includes('140'));
  assert.ok(sheet.opts && sheet.opts.foot && sheet.opts.foot.includes('Pay Dues Online'));
});

test('UI 3: A.invedit shows rich electricity breakdown banner and room split button', () => {
  const { ctx, S, getModal } = createUiSandbox();

  const room = S.put('room', { id: 'rm-203', no: '203', floor: 'F2', rent: 5000, beds: [{ id: 'A', status: 'occ' }] });
  const res = S.put('res', { id: 'res-ui-3', name: 'Manish', roomId: 'rm-203', bed: 'A', status: 'active' });

  const meter = S.put('meter', {
    id: 'mtr-203',
    roomId: 'rm-203',
    date: '2026-11-10',
    prev: 300,
    curr: 350,
    units: 50,
    rate: 10,
    status: 'billed',
    shares: [{ resId: res.id, units: 50, free: 5, billable: 45, amount: 450 }]
  });
  const elInv = S.put('inv', {
    id: `inv-el-${meter.id}-${res.id}`,
    meterId: meter.id,
    resId: res.id,
    roomId: 'rm-203',
    type: 'electricity',
    amount: 450,
    paid: 0,
    date: '2026-11-10',
    title: 'Electricity 10 Nov (45 units)'
  });

  // Owner clicks electricity invoice to edit/view
  ctx.A.invedit({ dataset: { id: elInv.id } });

  const modal = getModal();
  assert.ok(modal, 'formModal should open for electricity invoice');
  assert.ok(modal.note.includes('300') && modal.note.includes('350'), 'Note must contain readings');
  assert.ok(modal.note.includes('5 free units deducted') || modal.note.includes('free units deducted'));

  const htmlField = modal.fields.find(f => f.type === 'html');
  assert.ok(htmlField, 'HTML field for electricity breakdown should be present');
  assert.ok(htmlField.html.includes('View Room Split'));
  assert.ok(htmlField.html.includes('data-act="meterview"'));
});
