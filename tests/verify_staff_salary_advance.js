'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createSandbox() {
  const store = new Map();
  const sessionStore = new Map();

  const ctx = {
    console,
    Date,
    Math,
    JSON,
    setTimeout,
    clearTimeout,
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
    location: { search: '', pathname: '/', hostname: 'localhost', protocol: 'http:' },
    document: { hidden: false, title: '', addEventListener: () => {}, removeEventListener: () => {} },
    openModal: () => {},
    closeModal: () => {},
    updateChrome: () => {},
    toast: () => {},
    t: s => s,
    esc: s => s,
    inr: n => '₹' + Number(n).toLocaleString('en-IN'),
  };
  ctx.window = ctx;
  ctx.window.HOSTELOS_CONFIG = {};
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  for (const f of ['core.js', 'data.js', 'domain.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`
    Store.ctx = { hostelId: 'h1', orgId: 'org1', role: 'owner' };
    globalThis.Store = Store;
    globalThis.staffSalarySummary = staffSalarySummary;
    globalThis.payrollFor = payrollFor;
  `, ctx);
  return { ctx, store };
}

test('staffSalarySummary: accurate base salary, dues and zero advance initially', () => {
  const { ctx } = createSandbox();
  const staff = { id: 'st-chirag', name: 'Chirag', dept: 'Kitchen', salary: 20000, status: 'active' };
  ctx.Store.put('staff', staff);

  const ym = '2026-11';
  const summary = ctx.staffSalarySummary(staff, ym);

  assert.equal(summary.baseSalary, 20000);
  assert.equal(summary.totalPaid, 0);
  assert.equal(summary.totalAdvanceGiven, 0);
  assert.equal(summary.activeAdvance, 0);
  assert.equal(summary.currentMonthPayable, 20000); // 30 days present by default
  assert.equal(summary.currentMonthDue, 20000);
  assert.equal(summary.netPayable, 20000);
});

test('staff advance: giving advance tracks active advance and adjusts net payable', () => {
  const { ctx } = createSandbox();
  const staff = { id: 'st-chirag', name: 'Chirag', dept: 'Kitchen', salary: 20000, status: 'active' };
  ctx.Store.put('staff', staff);

  const ym = '2026-11';

  // Owner gives ₹5,000 advance
  ctx.Store.put('sal', {
    staffId: staff.id,
    staffName: staff.name,
    ym,
    amount: 5000,
    isAdv: true,
    type: 'advance',
    mode: 'cash',
    date: '2026-11-10',
    note: 'Festival advance'
  });

  const summary = ctx.staffSalarySummary(staff, ym);
  assert.equal(summary.totalAdvanceGiven, 5000);
  assert.equal(summary.activeAdvance, 5000);
  assert.equal(summary.totalSalaryPaid, 0);
  assert.equal(summary.totalPaid, 5000); // ₹5,000 paid out so far
  assert.equal(summary.currentMonthDue, 20000); // Full month salary due
  assert.equal(summary.netPayable, 15000); // 20000 - 5000 advance = 15000 net payable!
});

test('salary payment with advance deduction: clears salary and resets active advance', () => {
  const { ctx } = createSandbox();
  const staff = { id: 'st-chirag', name: 'Chirag', dept: 'Kitchen', salary: 20000, status: 'active' };
  ctx.Store.put('staff', staff);

  const ym = '2026-11';

  // 1. Advance of ₹5,000 given
  ctx.Store.put('sal', {
    staffId: staff.id,
    staffName: staff.name,
    ym,
    amount: 5000,
    isAdv: true,
    type: 'advance',
    mode: 'upi',
    date: '2026-11-05'
  });

  // 2. Pay salary at end of month: ₹15,000 cash + ₹5,000 advance deducted
  ctx.Store.put('sal', {
    staffId: staff.id,
    staffName: staff.name,
    ym,
    amount: 15000,
    advDeducted: 5000,
    mode: 'bank',
    date: '2026-11-30',
    type: 'salary'
  });

  const summary = ctx.staffSalarySummary(staff, ym);
  assert.equal(summary.totalAdvanceGiven, 5000);
  assert.equal(summary.totalAdvanceDeducted, 5000);
  assert.equal(summary.activeAdvance, 0); // Advance fully adjusted!
  assert.equal(summary.totalSalaryPaid, 15000);
  assert.equal(summary.totalPaid, 20000); // ₹15,000 salary + ₹5,000 advance = ₹20,000 total paid out
  assert.equal(summary.currentMonthDue, 0); // Fully settled!
  assert.equal(summary.netPayable, 0); // Nothing left to pay
});
