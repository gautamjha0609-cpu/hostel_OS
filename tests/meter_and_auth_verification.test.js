'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function bootApp() {
  const mockStorage = {
    'hostelos.demo.v2': JSON.stringify({
      v: 2,
      orgs: [{ id: 'org1', name: 'Sharma PG Group', owner_name: 'Ramesh Sharma', phone: '9876500001' }],
      hostels: [{ id: 'h1', org_id: 'org1', name: 'Sunrise Boys PG', settings: { elec: { rate: 9, scanRole: 'both' } } }],
      profiles: [
        { id: 'u0', username: 'admin', password: 'admin123', is_super: true, active: true },
        { id: 'u1', username: 'ramesh.sharma', password: '9876500001', active: true }
      ],
      members: [{ user_id: 'u1', org_id: 'org1', hostel_id: null, role: 'owner', active: true }],
      docs: { h1: {} }
    })
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    navigator: { onLine: true },
    window: {},
    document: { querySelector: () => null, addEventListener: () => {} },
    localStorage: {
      getItem(k) { return mockStorage[k] || null; },
      setItem(k, v) { mockStorage[k] = String(v); },
      removeItem(k) { delete mockStorage[k]; }
    },
    fetch: () => Promise.resolve({ ok: true, json: () => ({}) })
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};

  const ctx = vm.createContext(sandbox);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }

  return { ctx, mockStorage };
}

test('demo login: all accounts including Manager (vikram.manager) and Warden (shanti.warden) authenticate seamlessly', async () => {
  const { ctx } = bootApp();

  const accounts = [
    ['vikram.manager', '9876500007', 'manager'],
    ['shanti.warden', '9876500008', 'warden'],
    ['ramesh.sharma', '9876500001', 'owner'],
    ['aman.gupta', '9812300001', 'resident'],
    ['raju.cook', '9876500003', 'cook'],
    ['sunita.hk', '9876500004', 'housekeeping'],
    ['mohan.laundry', '9876500005', 'laundry'],
    ['gate.guard', '9876500006', 'guard'],
    ['admin', 'admin123', 'super']
  ];

  for (const [u, p, expectedRole] of accounts) {
    const uid = await vm.runInContext(`Backend.login(${JSON.stringify(u)}, ${JSON.stringify(p)})`, ctx);
    assert.ok(uid, `Login failed for ${u}`);
    const meta = await vm.runInContext(`Backend.loadMeta()`, ctx);
    if (expectedRole !== 'super') {
      const mem = meta.members.find(m => m.user_id === uid);
      assert.ok(mem, `No membership found for ${u}`);
      assert.equal(mem.role, expectedRole, `Role mismatch for ${u}`);
    } else {
      assert.equal(meta.me.is_super, true);
    }
  }

  // Also test phone number login
  const phoneUid = await vm.runInContext("Backend.login('9876500007', '9876500007')", ctx);
  assert.equal(phoneUid, 'u8');
});

test('electricity meter duplicate prevention: roommates cannot submit duplicate readings for the same room in the same billing cycle', async () => {
  const { ctx } = bootApp();

  vm.runInContext(`
    Store.hostels = [{ id: 'h1', org_id: 'org1', name: 'Sunrise PG', settings: { elec: { rate: 10, freeUnits: 0, scanRole: 'both' } } }];
    Store.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1' };
    Store.put('room', { id: 'room-101', no: '101', floor: 'F1', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
    const r1 = checkIn({ name: 'Aman Gupta', phone: '9812300001', roomId: 'room-101', bed: 'A', rent: 6000, checkIn: '2026-11-01' });
    const r2 = checkIn({ name: 'Rahul Sharma', phone: '9812300002', roomId: 'room-101', bed: 'B', rent: 6000, checkIn: '2026-11-01' });
    setOpeningReading('room-101', 500, '2026-11-01');
  `, ctx);

  // 1. Aman submits meter reading from resident app
  const reading1 = vm.runInContext(`
    addReading({
      roomId: 'room-101',
      curr: 620,
      date: '2026-11-15',
      status: 'review',
      submittedBy: 'Aman Gupta',
      photo: 'meter_photo_101.jpg'
    })
  `, ctx);

  assert.equal(reading1.status, 'review');
  assert.equal(reading1.units, 120);

  // 2. Verify pendingMeter identifies the reading and lastMeter retains opening reading
  const pending = vm.runInContext("pendingMeter('room-101')", ctx);
  assert.ok(pending);
  assert.equal(pending.curr, 620);
  assert.equal(pending.submittedBy, 'Aman Gupta');

  const last = vm.runInContext("lastMeter('room-101')", ctx);
  assert.equal(last.curr, 500, 'lastMeter should return opening/billed reading, ignoring review');

  // 3. Rahul (roommate in Room 101) tries to submit duplicate reading while one is under review
  assert.throws(() => {
    vm.runInContext(`
      addReading({
        roomId: 'room-101',
        curr: 625,
        date: '2026-11-15',
        status: 'review',
        submittedBy: 'Rahul Sharma',
        photo: 'meter_photo_rahul.jpg'
      })
    `, ctx);
  }, /already under review/, 'Prevent duplicate review reading from roommate');

  // 4. Owner approves the reading
  vm.runInContext(`
    const m = Store.get('${reading1.id}');
    billMeter(m);
  `, ctx);

  const updatedLast = vm.runInContext("lastMeter('room-101')", ctx);
  assert.equal(updatedLast.status, 'billed');
  assert.equal(updatedLast.curr, 620);

  // 5. Check owner configurable scanRole setting: staff_only vs resident_only vs both
  const settingsBoth = vm.runInContext("S().elec.scanRole", ctx);
  assert.equal(settingsBoth, 'both');

  await vm.runInContext("Store.saveSettings({ elec: { scanRole: 'staff_only' } })", ctx);
  const settingsStaffOnly = vm.runInContext("S().elec.scanRole", ctx);
  assert.equal(settingsStaffOnly, 'staff_only');
});

test('replaceMeter: cleanly settles old meter units, sets new baseline, and allows readings starting from 0', () => {
  const { ctx } = bootApp();

  vm.runInContext(`
    Store.hostels = [{ id: 'h1', org_id: 'org1', name: 'Sunrise PG', settings: { elec: { rate: 10, freeUnits: 0 } } }];
    Store.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1' };
    Store.put('room', { id: 'room-102', no: '102', floor: 'F1', rent: 6000, beds: [{ id: 'A', status: 'vac' }] });
    const r = checkIn({ name: 'Vikash Jain', phone: '9812300009', roomId: 'room-102', bed: 'A', rent: 0, checkIn: '2026-11-01' });
    setOpeningReading('room-102', 4800, '2026-11-01');
  `, ctx);

  // 1. Initial reading at 4800. Meter gets burnt out on 10 Nov at reading 4850.
  // Owner runs replaceMeter with final old reading 4850, and new digital submeter starting at 0.
  const rep = vm.runInContext(`
    replaceMeter({
      roomId: 'room-102',
      finalOldReading: 4850,
      startingNewReading: 0,
      newSerial: 'MTR-DIGI-102',
      newQr: 'MTR-102',
      reason: 'Old meter burnt out, installed new digital submeter',
      date: '2026-11-10'
    })
  `, ctx);

  assert.ok(rep.oldBill);
  assert.equal(rep.oldBill.units, 50, 'Old meter billed exactly 50 units (4850 - 4800)');
  assert.equal(rep.oldBill.total, 500, '50 units @ ₹10 = ₹500 billed for old meter');

  // Verify new baseline
  assert.ok(rep.newBaseline);
  assert.equal(rep.newBaseline.curr, 0);
  assert.equal(rep.newBaseline.meterReplaced, true);

  const baseline = vm.runInContext("lastMeter('room-102')", ctx);
  assert.equal(baseline.curr, 0);

  // 2. Next reading on 30 Nov is taken on the NEW meter (e.g. 35 units).
  // It must calculate 35 units from 0 without throwing "lower than previous"!
  const nextReading = vm.runInContext(`
    addReading({
      roomId: 'room-102',
      curr: 35,
      date: '2026-11-30',
      status: 'billed'
    })
  `, ctx);

  assert.equal(nextReading.units, 35);
  assert.equal(nextReading.total, 350);
});

test('meter fraud prevention: prevents wrong room QR and handles resident meter replacement claim', () => {
  const { ctx } = bootApp();

  vm.runInContext(`
    Store.hostels = [{ id: 'h1', org_id: 'org1', name: 'Sunrise PG', settings: { elec: { rate: 10, freeUnits: 0 } } }];
    Store.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1' };
    Store.put('room', { id: 'room-103', no: '103', floor: 'F1', rent: 6000, beds: [{ id: 'A', status: 'vac' }] });
    registerMeter({ roomId: 'room-103', serialNo: 'SN-103', qrCode: 'MTR-103' });
    setOpeningReading('room-103', 1000, '2026-11-01');
  `, ctx);

  // 1. Resident enters wrong room QR sticker (e.g. neighbor's MTR-104)
  const fraudCheck = vm.runInContext(`
    validateMeterReadingFraud({
      roomId: 'room-103',
      curr: 1120,
      prev: 1000,
      meterQr: 'MTR-104'
    })
  `, ctx);

  assert.equal(fraudCheck.valid, false);
  assert.ok(fraudCheck.flags.some(f => f.includes('Meter QR mismatch')));

  // 2. Resident enters correct meter sticker (MTR-103)
  const validCheck = vm.runInContext(`
    validateMeterReadingFraud({
      roomId: 'room-103',
      curr: 1120,
      prev: 1000,
      meterQr: 'MTR-103'
    })
  `, ctx);

  assert.equal(validCheck.valid, true);

  // 3. Meter replacement claim: resident submits new meter reading 15 with isReplacement: true
  const repReading = vm.runInContext(`
    addReading({
      roomId: 'room-103',
      curr: 15,
      prev: 0,
      isReplacement: true,
      replaceReason: 'Electrician installed new meter',
      status: 'review',
      submittedBy: 'Resident'
    })
  `, ctx);

  assert.equal(repReading.status, 'review');
  assert.equal(repReading.isReplacement, true);
  assert.equal(repReading.curr, 15);

  const inbox = vm.runInContext("inboxItems().filter(x => x.k === 'meter')", ctx);
  assert.equal(inbox.length, 1);
  assert.match(inbox[0].t, /Meter replaced\/reset/);
});

test('electricity sanity limits & warden deletion: prevents phone number inputs and allows warden to delete erroneous readings', () => {
  const { ctx } = bootApp();

  vm.runInContext(`
    Store.hostels = [{ id: 'h1', org_id: 'org1', name: 'Sunrise PG', settings: { elec: { rate: 12, freeUnits: 30, freeMode: 'resident' } } }];
    Store.ctx = { key: 'k', role: 'warden', hostelId: 'h1', orgId: 'org1' };
    Store.put('room', { id: 'room-105', no: '105', floor: 'F1', rent: 6500, beds: [{ id: 'A', status: 'occ' }, { id: 'B', status: 'occ' }] });
    setOpeningReading('room-105', 50, '2026-11-01');
    Store.put('res', { id: 'res-a', name: 'Gautam Jha', roomId: 'room-105', bed: 'A', status: 'active', checkIn: '2026-11-01' });
    Store.put('res', { id: 'res-b', name: 'Geuhdu', roomId: 'room-105', bed: 'B', status: 'active', checkIn: '2026-11-15' });
  `, ctx);

  // 1. Accidental phone number / serial number entry (> 999,999) must be rejected
  assert.throws(() => {
    vm.runInContext(`
      addReading({ roomId: 'room-105', curr: 9358939, date: '2026-11-19' });
    `, ctx);
  }, /exceeds the 6-digit meter limit/);

  // 2. Units consumed > 10,000 must be rejected
  assert.throws(() => {
    vm.runInContext(`
      addReading({ roomId: 'room-105', curr: 20000, prev: 50, date: '2026-11-19' });
    `, ctx);
  }, /abnormally large/);

  // 3. Normal valid reading creates day-wise pro-rata free units
  const m = vm.runInContext(`
    addReading({ roomId: 'room-105', curr: 140, date: '2026-11-19' });
  `, ctx);

  assert.equal(m.units, 90);
  assert.equal(m.shares.length, 2);

  // Res A checked in Nov 1 (full stay, 18 days). Res B checked in Nov 15 (4 days out of 18).
  // Gautam gets more units and free quota than Geuhdu who joined on Nov 15.
  assert.ok(m.shares[0].units > m.shares[1].units, 'Full resident gets proportional share');
  assert.ok(m.shares[0].free > m.shares[1].free, 'Full resident gets more pro-rata free units');

  // 4. Warden can delete this erroneous reading with a reason
  const deleted = vm.runInContext(`
    deleteReading({ meterId: '${m.id}', reason: 'Erroneous test reading' });
  `, ctx);

  assert.equal(deleted, true);
  const remaining = vm.runInContext(`Store.get('${m.id}')`, ctx);
  assert.equal(remaining, null);
  const invoices = vm.runInContext(`Store.all('inv').filter(i => i.id.startsWith('inv-el-${m.id}'))`, ctx);
  assert.equal(invoices.length, 0);
});


