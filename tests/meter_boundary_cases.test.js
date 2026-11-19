'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setupTestContext() {
  const sandbox = {
    console,
    Math,
    Date,
    String,
    Number,
    Array,
    Object,
    JSON,
    isFinite,
    isNaN,
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { onLine: true },
    window: {},
    document: { querySelector: () => null, addEventListener: () => {} },
    addEventListener: () => {}
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};

  const ctx = vm.createContext(sandbox);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
  }
  return ctx;
}

test('BUG-006 Comprehensive Meter Occupancy & Sharing Boundary Cases', async t => {
  const ctx = setupTestContext();

  vm.runInContext(`
    Store.hostels = [{ id: 'h1', org_id: 'org1', name: 'Test PG', settings: { elec: { rate: 10, freeUnits: 0, freeMode: 'resident' } } }];
    Store.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1' };

    function runScenario(residents, from, to, units = 100) {
      Store.docs.clear();
      Store.put('room', { id: 'r1', no: '101', floor: '1', rent: 8000, beds: [{id: 'A'}, {id: 'B'}] });
      for (const r of residents) {
        Store.put('res', {
          id: r.id,
          name: r.name,
          roomId: 'r1',
          bed: r.bed,
          checkIn: r.checkIn,
          left: r.left || null,
          status: r.status || (r.left ? 'checked_out' : 'active')
        });
      }
    const occ = JSON.parse(JSON.stringify(meterOccupants('r1', from, to)));
    const partial = occ.some(o => o[1] < 1);
    const shares = JSON.parse(JSON.stringify(splitElectricity('r1', units, 10, occ.map(o => o[0]), partial ? occ.map(o => o[1]) : null, freeMonths(from, to))));
    return { occ, shares };
    }
  `, ctx);

  await t.test('1. Same-day occupancy (from == to)', () => {
    const res = vm.runInContext(`
      runScenario([
        { id: 'res1', name: 'Aryan', bed: 'A', checkIn: '2026-11-05' },
        { id: 'res2', name: 'Rohan', bed: 'B', checkIn: '2026-11-05' }
      ], '2026-11-05', '2026-11-05', 100);
    `, ctx);

    assert.equal(res.occ.length, 2);
    assert.deepEqual(res.occ, [['res1', 1], ['res2', 1]]);
    assert.equal(res.shares[0].units, 50);
    assert.equal(res.shares[0].amount, 500);
    assert.equal(res.shares[1].units, 50);
    assert.equal(res.shares[1].amount, 500);
  });

  await t.test('2. One-day occupancy (span = 1 day)', () => {
    const res = vm.runInContext(`
      runScenario([
        { id: 'res1', name: 'Aryan', bed: 'A', checkIn: '2026-11-05' },
        { id: 'res2', name: 'Rohan', bed: 'B', checkIn: '2026-11-05' }
      ], '2026-11-05', '2026-11-06', 100);
    `, ctx);

    assert.equal(res.occ.length, 2);
    assert.equal(res.shares[0].units, 50);
    assert.equal(res.shares[1].units, 50);
  });

  await t.test('3. Two-day occupancy with roommate joining mid-period', () => {
    const res = vm.runInContext(`
      runScenario([
        { id: 'res1', name: 'Aryan', bed: 'A', checkIn: '2026-11-05' },
        { id: 'res2', name: 'Rohan', bed: 'B', checkIn: '2026-11-06' }
      ], '2026-11-05', '2026-11-07', 100);
    `, ctx);

    assert.equal(res.occ.length, 2);
    assert.equal(res.shares[0].units, 66.67);
    assert.equal(res.shares[0].amount, 667);
    assert.equal(res.shares[1].units, 33.33);
    assert.equal(res.shares[1].amount, 333);
  });

  await t.test('4. Move-in date boundary: resident moves in on end date "to"', () => {
    const res = vm.runInContext(`
      runScenario([
        { id: 'res1', name: 'Aryan', bed: 'A', checkIn: '2026-11-01' },
        { id: 'res2', name: 'Rohan', bed: 'B', checkIn: '2026-11-15' }
      ], '2026-11-01', '2026-11-15', 100);
    `, ctx);

    assert.equal(res.occ.length, 1, 'Resident who joined on end date is not charged for prior period');
    assert.equal(res.shares[0].resId, 'res1');
    assert.equal(res.shares[0].units, 100);
  });

  await t.test('5. Move-out date boundary: resident checks out mid-period', () => {
    const res = vm.runInContext(`
      runScenario([
        { id: 'res1', name: 'Aryan', bed: 'A', checkIn: '2026-11-01' },
        { id: 'res2', name: 'Suresh', bed: 'B', checkIn: '2026-11-01', left: '2026-11-08', status: 'checked_out' }
      ], '2026-11-01', '2026-11-15', 100);
    `, ctx);

    assert.equal(res.occ.length, 2);
    assert.equal(res.shares[0].units, 66.67);
    assert.equal(res.shares[1].units, 33.33);
  });

  await t.test('6. Roommate change: Suresh leaves on Nov 8, Rohan enters on Nov 8', () => {
    const res = vm.runInContext(`
      runScenario([
        { id: 'res1', name: 'Aryan', bed: 'A', checkIn: '2026-11-01' },
        { id: 'res2', name: 'Suresh', bed: 'B', checkIn: '2026-11-01', left: '2026-11-08', status: 'checked_out' },
        { id: 'res3', name: 'Rohan', bed: 'B', checkIn: '2026-11-08' }
      ], '2026-11-01', '2026-11-15', 100);
    `, ctx);

    assert.equal(res.occ.length, 3);
    assert.equal(res.shares[0].units, 50, 'Continuous resident pays 50%');
    assert.equal(res.shares[1].units, 25, 'Outgoing resident pays 25%');
    assert.equal(res.shares[2].units, 25, 'Incoming resident pays 25%');
  });

  await t.test('7. Meter reading period boundaries (resident moved in prior to cycle)', () => {
    const res = vm.runInContext(`
      runScenario([
        { id: 'res1', name: 'Aryan', bed: 'A', checkIn: '2026-11-01' }
      ], '2026-11-15', '2026-11-30', 100);
    `, ctx);

    assert.equal(res.occ.length, 1);
    assert.equal(res.shares[0].units, 100);
  });

  await t.test('8. Equal allocation (both active for whole period)', () => {
    const res = vm.runInContext(`
      runScenario([
        { id: 'res1', name: 'Aryan', bed: 'A', checkIn: '2026-11-01' },
        { id: 'res2', name: 'Rohan', bed: 'B', checkIn: '2026-11-01' }
      ], '2026-11-01', '2026-12-01', 100);
    `, ctx);

    assert.equal(res.occ.length, 2);
    assert.equal(res.shares[0].units, 50);
    assert.equal(res.shares[1].units, 50);
  });

  await t.test('9. Occupancy-day-weighted allocation (30 days vs 10 days out of 30, 120 units)', () => {
    const res = vm.runInContext(`
      runScenario([
        { id: 'res1', name: 'Aryan', bed: 'A', checkIn: '2026-11-01' },
        { id: 'res2', name: 'Rohan', bed: 'B', checkIn: '2026-11-21' }
      ], '2026-11-01', '2026-12-01', 120);
    `, ctx);

    assert.equal(res.occ.length, 2);
    assert.equal(res.shares[0].units, 90, 'Res1 gets 30/40 * 120 = 90 units');
    assert.equal(res.shares[1].units, 30, 'Res2 gets 10/40 * 120 = 30 units');
    assert.equal(res.shares[0].amount, 900);
    assert.equal(res.shares[1].amount, 300);
  });

  await t.test('10. Reject reading with date earlier than previous reading date', () => {
    const err = vm.runInContext(`
      let errMsg = '';
      Store.docs.clear();
      Store.put('room', { id: 'r1', no: '101', floor: '1', rent: 8000, beds: [{id: 'A'}] });
      Store.put('res', { id: 'res1', name: 'Aryan', roomId: 'r1', bed: 'A', checkIn: '2026-11-01', status: 'active' });
      addReading({ roomId: 'r1', curr: 100, date: '2026-11-10' });
      try {
        addReading({ roomId: 'r1', curr: 120, date: '2026-11-05' });
      } catch (e) {
        errMsg = e.message;
      }
      errMsg;
    `, ctx);

    assert.match(err, /cannot be earlier than previous reading date/);
  });

  await t.test('11. classifyPaymentRef distinguishes provider-specific reference formats', () => {
    const check = ref => vm.runInContext(`classifyPaymentRef(${JSON.stringify(ref)})`, ctx);

    // 1. UPI RRN (12 numeric digits)
    const upi = check('403123456789');
    assert.equal(upi.valid, true);
    assert.equal(upi.type, 'upi_rrn');

    // 2. Alphanumeric Bank UTR (NEFT / IMPS)
    const neft = check('CMS1234567890123');
    assert.equal(neft.valid, true);
    assert.equal(neft.type, 'bank_utr');

    // 3. Gateway transaction IDs (Razorpay / Cashfree / Setu)
    const rzp = check('pay_NzX9K2k1L8abcdef');
    assert.equal(rzp.valid, true);
    assert.equal(rzp.type, 'gateway_id');

    const cf = check('cf_102837465920');
    assert.equal(cf.valid, true);
    assert.equal(cf.type, 'gateway_id');

    // 4. Internal test reference
    const testRef = check('UPI202611158899');
    assert.equal(testRef.valid, true);
    assert.equal(testRef.type, 'internal_test');

    // 5. Invalid / malformed references
    assert.equal(check('').valid, false);
    assert.equal(check('123').valid, false);
    assert.equal(check('ref with spaces').valid, false);
    assert.equal(check('ref@special!#').valid, false);
  });
});
