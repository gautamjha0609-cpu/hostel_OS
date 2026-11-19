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

test('Day-Based + Occupancy-Based Electricity Distribution (User Scenarios)', async t => {
  const ctx = setupTestContext();

  await t.test('Example 1: Two Tenants with Mid-Period Check-In & Intermediate Reading', () => {
    // Month starts: 100 units on 2026-06-01
    // Day 15: Tenant B arrives. Reading: 175 units (75 units consumed in 1-15)
    // Day 30: Reading: 200 units (25 units consumed in 15-30)
    // Expected:
    // Period 1 (1-15): 75 units 100% to Tenant A
    // Period 2 (15-30): 25 units divided 50-50: A = 12.5, B = 12.5
    // Total: A = 87.5, B = 12.5 (Sum = 100)
    const res = vm.runInContext(`(() => {
      Store.hostels = [{ id: 'h1', org_id: 'org1', name: 'Test PG', settings: { elec: { allocation: 'daily_occupancy', rate: 10, freeUnits: 0, freeMode: 'resident' } } }];
      Store.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1' };
      Store.docs.clear();
      Store.put('room', { id: 'r1', no: '101', floor: '1', rent: 8000, beds: [{id: 'A'}, {id: 'B'}] });
      Store.put('res', { id: 'resA', name: 'Tenant A', roomId: 'r1', bed: 'A', checkIn: '2026-06-01', status: 'active' });
      Store.put('res', { id: 'resB', name: 'Tenant B', roomId: 'r1', bed: 'B', checkIn: '2026-06-15', status: 'active' });

      // Period 1: 1st to 15th (175 - 100 = 75 units)
      const occ1 = meterOccupants('r1', '2026-06-01', '2026-06-15');
      const sh1 = splitElectricity('r1', 75, 10, occ1.map(o => o[0]), occ1.map(o => o[1]), 0);

      // Period 2: 15th to 30th (200 - 175 = 25 units)
      const occ2 = meterOccupants('r1', '2026-06-15', '2026-06-30');
      const sh2 = splitElectricity('r1', 25, 10, occ2.map(o => o[0]), occ2.map(o => o[1]), 0);

      return { sh1, sh2 };
    })()`, ctx);

    assert.equal(res.sh1.length, 1);
    assert.equal(res.sh1[0].resId, 'resA');
    assert.equal(res.sh1[0].units, 75);

    assert.equal(res.sh2.length, 2);
    assert.equal(res.sh2[0].resId, 'resA');
    assert.equal(res.sh2[0].units, 12.5);
    assert.equal(res.sh2[1].resId, 'resB');
    assert.equal(res.sh2[1].units, 12.5);

    const totalA = res.sh1[0].units + res.sh2[0].units;
    const totalB = res.sh2[1].units;
    assert.equal(totalA, 87.5);
    assert.equal(totalB, 12.5);
    assert.equal(totalA + totalB, 100);
  });

  await t.test('Example 2: Three Tenants with Staggered Move-in Dates & Periodic Readings', () => {
    // Room has 3 beds.
    // Tenant A: 1st (2026-06-01)
    // Tenant B: 10th (2026-06-10)
    // Tenant C: 20th (2026-06-20)
    // Readings: 1st = 100, 10th = 145, 20th = 205, 30th = 265
    // Period 1 (1-10): 45 units -> Tenant A = 45
    // Period 2 (10-20): 60 units -> Tenant A = 30, B = 30
    // Period 3 (20-30): 60 units -> Tenant A = 20, B = 20, C = 20
    // Expected Totals: A = 95, B = 50, C = 20 (Sum = 165)
    const res = vm.runInContext(`(() => {
      Store.hostels = [{ id: 'h1', org_id: 'org1', name: 'Test PG', settings: { elec: { allocation: 'daily_occupancy', rate: 10, freeUnits: 0, freeMode: 'resident' } } }];
      Store.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1' };
      Store.docs.clear();
      Store.put('room', { id: 'r1', no: '101', floor: '1', rent: 8000, beds: [{id: 'A'}, {id: 'B'}, {id: 'C'}] });
      Store.put('res', { id: 'resA', name: 'Tenant A', roomId: 'r1', bed: 'A', checkIn: '2026-06-01', status: 'active' });
      Store.put('res', { id: 'resB', name: 'Tenant B', roomId: 'r1', bed: 'B', checkIn: '2026-06-10', status: 'active' });
      Store.put('res', { id: 'resC', name: 'Tenant C', roomId: 'r1', bed: 'C', checkIn: '2026-06-20', status: 'active' });

      const occ1 = meterOccupants('r1', '2026-06-01', '2026-06-10');
      const sh1 = splitElectricity('r1', 45, 10, occ1.map(o => o[0]), occ1.map(o => o[1]), 0);

      const occ2 = meterOccupants('r1', '2026-06-10', '2026-06-20');
      const sh2 = splitElectricity('r1', 60, 10, occ2.map(o => o[0]), occ2.map(o => o[1]), 0);

      const occ3 = meterOccupants('r1', '2026-06-20', '2026-06-30');
      const sh3 = splitElectricity('r1', 60, 10, occ3.map(o => o[0]), occ3.map(o => o[1]), 0);

      return { sh1, sh2, sh3 };
    })()`, ctx);

    assert.equal(res.sh1[0].units, 45);

    assert.equal(res.sh2[0].units, 30);
    assert.equal(res.sh2[1].units, 30);

    assert.equal(res.sh3[0].units, 20);
    assert.equal(res.sh3[1].units, 20);
    assert.equal(res.sh3[2].units, 20);

    const totalA = res.sh1[0].units + res.sh2[0].units + res.sh3[0].units;
    const totalB = res.sh2[1].units + res.sh3[1].units;
    const totalC = res.sh3[2].units;

    assert.equal(totalA, 95);
    assert.equal(totalB, 50);
    assert.equal(totalC, 20);
    assert.equal(totalA + totalB + totalC, 165);
  });

  await t.test('Example 3A: Tenant C Stays only 4 Days (With intermediate reading on 26th)', () => {
    // Tenant A & B: from 1st (2026-06-01)
    // Tenant C: arrives on 26th (2026-06-26)
    // Reading 1 (1st to 26th): 100 units -> divided equally among A & B = 50 each
    // Reading 2 (26th to 30th): 40 units -> divided equally among A, B, C = 13.33 each
    // Total: A = 63.33, B = 63.33, C = 13.34
    const res = vm.runInContext(`(() => {
      Store.hostels = [{ id: 'h1', org_id: 'org1', name: 'Test PG', settings: { elec: { allocation: 'daily_occupancy', rate: 10, freeUnits: 0, freeMode: 'resident' } } }];
      Store.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1' };
      Store.docs.clear();
      Store.put('room', { id: 'r1', no: '101', floor: '1', rent: 8000, beds: [{id: 'A'}, {id: 'B'}, {id: 'C'}] });
      Store.put('res', { id: 'resA', name: 'Tenant A', roomId: 'r1', bed: 'A', checkIn: '2026-06-01', status: 'active' });
      Store.put('res', { id: 'resB', name: 'Tenant B', roomId: 'r1', bed: 'B', checkIn: '2026-06-01', status: 'active' });
      Store.put('res', { id: 'resC', name: 'Tenant C', roomId: 'r1', bed: 'C', checkIn: '2026-06-26', status: 'active' });

      const occ1 = meterOccupants('r1', '2026-06-01', '2026-06-26');
      const sh1 = splitElectricity('r1', 100, 10, occ1.map(o => o[0]), occ1.map(o => o[1]), 0);

      const occ2 = meterOccupants('r1', '2026-06-26', '2026-06-30');
      const sh2 = splitElectricity('r1', 40, 10, occ2.map(o => o[0]), occ2.map(o => o[1]), 0);

      return { sh1, sh2 };
    })()`, ctx);

    assert.equal(res.sh1.length, 2);
    assert.equal(res.sh1[0].units, 50);
    assert.equal(res.sh1[1].units, 50);

    assert.equal(res.sh2.length, 3);
    assert.equal(res.sh2[0].units, 13.33);
    assert.equal(res.sh2[1].units, 13.33);
    assert.equal(res.sh2[2].units, 13.33);

    const totalA = +(res.sh1[0].units + res.sh2[0].units).toFixed(2);
    const totalB = +(res.sh1[1].units + res.sh2[1].units).toFixed(2);
    const totalC = res.sh2[2].units;

    assert.equal(totalA, 63.33);
    assert.equal(totalB, 63.33);
    assert.equal(totalC, 13.33);
  });

  await t.test('Example 3B: Tenant C Stays only 4 Days (NO intermediate reading - Dynamic Day+Occupancy Slices)', () => {
    // Total reading on 30th: 140 units over 30 days
    // Days 1-26 (26 days): only 2 occupants (A, B) -> 26 days * (140/30 / 2) = 60.67 units each
    // Days 27-30 (4 days): 3 occupants (A, B, C) -> 4 days * (140/30 / 3) = 6.22 units each
    // Total: A = 66.89, B = 66.89, C = 6.22
    // C pays only for their 4 days, zero liability for prior 26 days!
    const res = vm.runInContext(`(() => {
      Store.hostels = [{ id: 'h1', org_id: 'org1', name: 'Test PG', settings: { elec: { allocation: 'daily_occupancy', rate: 10, freeUnits: 0, freeMode: 'resident' } } }];
      Store.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1' };
      Store.docs.clear();
      Store.put('room', { id: 'r1', no: '101', floor: '1', rent: 8000, beds: [{id: 'A'}, {id: 'B'}, {id: 'C'}] });
      Store.put('res', { id: 'resA', name: 'Tenant A', roomId: 'r1', bed: 'A', checkIn: '2026-06-01', status: 'active' });
      Store.put('res', { id: 'resB', name: 'Tenant B', roomId: 'r1', bed: 'B', checkIn: '2026-06-01', status: 'active' });
      Store.put('res', { id: 'resC', name: 'Tenant C', roomId: 'r1', bed: 'C', checkIn: '2026-06-27', status: 'active' });

      const occ = meterOccupants('r1', '2026-06-01', '2026-07-01');
      const sh = splitElectricity('r1', 140, 10, occ.map(o => o[0]), occ.map(o => o[1]), 0);
      return { occ, sh };
    })()`, ctx);

    assert.equal(res.sh.length, 3);
    assert.equal(res.sh[0].units, 66.89);
    assert.equal(res.sh[1].units, 66.89);
    assert.equal(res.sh[2].units, 6.22);
    assert.equal(+(res.sh[0].units + res.sh[1].units + res.sh[2].units).toFixed(2), 140.00);
  });
});
