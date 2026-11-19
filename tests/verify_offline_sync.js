// Offline Operations, Multi-Device Sync & Concurrency Verification
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function bootClient(clientMem = {}, onLine = true) {
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, URL, URLSearchParams, Date, Math, JSON, TextEncoder, crypto, addEventListener() {}, removeEventListener() {},
    localStorage: {
      getItem: k => (k in clientMem ? clientMem[k] : null),
      setItem: (k, v) => { clientMem[k] = String(v); },
      removeItem: k => { delete clientMem[k]; },
      key: () => null,
      length: 0
    },
    navigator: { onLine, vibrate() {} },
    location: { href: 'https://app.test/index.html', hash: '', origin: 'https://app.test', pathname: '/index.html' },
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {} }, body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} }, createElement: () => ({ setAttribute() {}, appendChild() {}, querySelector: () => null }) },
    matchMedia: () => ({ matches: false }),
  };
  ctx.window = ctx;
  ctx.window.HOSTELOS_CONFIG = {};
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js', 'xlsx.js', 'report.js', 'pwa.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`toast = () => {}; globalThis.T = {
    Store, Backend, can, activeRes, resById, openInv, invBal, addInvoice, recordPayment, reversePayment,
    payments, S, today, addReading, lastMeter, createAgreement
  };`, ctx);

  const T = ctx.T;
  const S = T.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'o1', modules: {}, status: 'active', owner_name: 'Owner Person', phone: '9876500001' }];
  S.hostels = [{ id: 'h1', org_id: 'o1', name: 'Sunrise PG', modules: {}, settings: {} }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'o1', perms: [], deny: [] };
  S.put('room', { id: 'rm-101', no: '101', beds: [{ id: 'A', status: 'occ' }], rent: 8000 });
  S.put('res', { id: 'res-1', name: 'Aman', roomId: 'rm-101', bed: 'A', rent: 8000, status: 'active', checkIn: T.today(), credit: 0, deposit: 10000, depositPaid: 10000 });

  return { T, clientMem, ctx };
}

test('offline: transactions execute and persist to storage when network is offline', () => {
  const { T, clientMem, ctx } = bootClient({}, false); // onLine = false
  assert.equal(ctx.navigator.onLine, false);

  // Add invoice while offline
  const inv = T.addInvoice({ resId: 'res-1', amount: 8000, title: 'Rent Dec 2026', type: 'rent' });
  assert.ok(inv.id);
  assert.equal(T.invBal(inv), 8000);

  // Record payment while offline
  const pay = T.recordPayment({
    resId: 'res-1',
    amount: 8000,
    mode: 'cash',
    ref: 'cash-offline-01',
    note: 'Collected offline at desk'
  });
  assert.ok(pay.id);
  assert.equal(T.invBal(T.Store.get(inv.id)), 0);

  // Verify stored in client local memory
  assert.equal(T.Store.get(inv.id).amount, 8000);
  assert.equal(T.Store.get(pay.id).amount, 8000);
  assert.ok(T.Store.all('inv').some(d => d.id === inv.id));
  assert.ok(T.Store.all('pay').some(d => d.id === pay.id));
});

test('multi-device sync: changes on device A sync to device B via document store', async () => {
  // Shared storage simulator between two browser profiles
  const sharedStorage = {};
  const { T: devA } = bootClient(sharedStorage, true);
  const { T: devB } = bootClient(sharedStorage, true);

  // Device A creates an agreement
  const agr = devA.createAgreement({
    resId: 'res-1',
    startDate: devA.today(),
    endDate: '2027-11-01',
    rent: 8500,
    deposit: 10000,
    noticeDays: 30
  });

  // Device A pushes rows to shared backend
  const row = devA.Store.get(agr.id);
  await devA.Backend.push([{
    hostel_id: 'h1',
    id: agr.id,
    kind: 'agr',
    data: row,
    deleted: false
  }]);

  // Wait for debounced write to persist to shared storage
  await new Promise(r => setTimeout(r, 450));
  devB.Backend.db = null; // force reload from storage

  // Device B pulls updates from shared backend
  const pulled = await devB.Backend.pull('h1');
  assert.ok(pulled.some(r => r.id === agr.id));

  // Device B imports row
  devB.Store.put('agr', pulled.find(r => r.id === agr.id).data);
  const syncedAgr = devB.Store.get(agr.id);
  assert.equal(syncedAgr.rent, 8500);
  assert.equal(syncedAgr.version, 1);
});

test('concurrent actions: duplicate payment submission with identical idempotency key is safely ignored', () => {
  const { T } = bootClient({}, true);
  const idmp = 'concurrent-tx-uuid-12345';

  const pay1 = T.recordPayment({
    resId: 'res-1',
    amount: 5000,
    mode: 'upi',
    ref: 'UPI-CONCURRENT-1',
    idempotencyKey: idmp
  });

  const pay2 = T.recordPayment({
    resId: 'res-1',
    amount: 5000,
    mode: 'upi',
    ref: 'UPI-CONCURRENT-1-RETRY',
    idempotencyKey: idmp
  });

  assert.equal(pay1.id, pay2.id, 'Duplicate idempotency key must return the original payment instance');
  const count = T.Store.all('pay').filter(p => p.idempotencyKey === idmp).length;
  assert.equal(count, 1, 'Only one payment row may exist for the idempotency key');
});
