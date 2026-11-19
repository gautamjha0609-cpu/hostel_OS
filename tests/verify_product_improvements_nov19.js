'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Load domain and core dependencies in sandbox environment
global.window = { HOSTELOS_CONFIG: { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }, addEventListener() {}, removeEventListener() {} };
global.location = { origin: 'http://localhost:5176', href: '' };
global.document = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {} }, body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} }, createElement: () => ({ setAttribute() {}, appendChild() {}, querySelector: () => null }) };
global.addEventListener = () => {};
global.PAGES = {};
global.A = {};
global.ui = { flt: {}, tab: {}, lim: {} };

const Store = {
  ctx: { hostelId: 'h1', orgId: 'org1', role: 'owner' },
  hostelId: 'h1',
  data: {},
  hostel() { return { id: 'h1', name: 'Sunrise Boys PG', org_id: 'org1' }; },
  org() { return { id: 'org1', name: 'Sunrise Org', owner_name: 'Owner' }; },
  all(kind) { return (this.data[kind] || []).filter(x => !x._del); },
  get(id) {
    for (const k in this.data) {
      const f = (this.data[k] || []).find(x => x.id === id);
      if (f) return f;
    }
    return null;
  },
  put(kind, item) {
    if (!this.data[kind]) this.data[kind] = [];
    const idx = this.data[kind].findIndex(x => x.id === item.id);
    const saved = { ...item, id: item.id || `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    if (idx >= 0) this.data[kind][idx] = saved;
    else this.data[kind].push(saved);
    return saved;
  },
  patch(id, patch) {
    for (const k in this.data) {
      const idx = (this.data[k] || []).findIndex(x => x.id === id);
      if (idx >= 0) {
        this.data[k][idx] = { ...this.data[k][idx], ...patch };
        return this.data[k][idx];
      }
    }
    return null;
  },
  remove(id) {
    for (const k in this.data) {
      const idx = (this.data[k] || []).findIndex(x => x.id === id);
      if (idx >= 0) {
        this.data[k].splice(idx, 1);
        return true;
      }
    }
    return false;
  }
};
global.Store = Store;

const fs = require('fs');
const path = require('path');
const vm = require('vm');

for (const f of ['core.js', 'domain.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInThisContext(code, { filename: f });
}

test('1. Bed reconciliation & styling: vacated resident never turns bed purple (occ)', () => {
  Store.data = {};
  // Create room 105 with bed A
  const room = Store.put('room', {
    id: 'room-105',
    no: '105',
    beds: [
      { id: 'A', status: 'occ', resId: 'res-old-vacated' },
      { id: 'B', status: 'vac', resId: null }
    ]
  });

  // Old resident has left/vacated
  Store.put('res', {
    id: 'res-old-vacated',
    name: 'Old Resident',
    roomId: 'room-105',
    bed: 'A',
    status: 'left' // vacated!
  });

  // Run reconciliation
  reconcileBeds();

  const refreshedRoom = Store.get('room-105');
  const bedA = refreshedRoom.beds.find(b => b.id === 'A');

  // Bed A must have been healed to vacant and resId reset to null
  assert.equal(bedA.status, 'vac');
  assert.equal(bedA.resId, null);
});

test('2. Notice section in resident panel: last 3 months fee notices with current month on top, 30 days general notices limit', () => {
  Store.data = {};
  const curDate = today();
  const curYM = ymOf(curDate);
  const prev1YM = addMonths(curYM + '-01', -1).slice(0, 7);
  const prev2YM = addMonths(curYM + '-01', -2).slice(0, 7);
  const old4YM = addMonths(curYM + '-01', -4).slice(0, 7);

  const res = Store.put('res', { id: 'res-1', name: 'Gautam Jha', roomId: 'r1', bed: 'A', status: 'active' });

  // Invoices across various months
  Store.put('inv', { id: 'inv-cur', resId: res.id, title: 'Rent Current', amount: 5000, paid: 0, due: `${curYM}-05`, type: 'rent' });
  Store.put('inv', { id: 'inv-prev1', resId: res.id, title: 'Rent Last Month', amount: 5000, paid: 5000, due: `${prev1YM}-05`, type: 'rent' });
  Store.put('inv', { id: 'inv-prev2', resId: res.id, title: 'Rent 2 Months Ago', amount: 5000, paid: 5000, due: `${prev2YM}-05`, type: 'rent' });
  Store.put('inv', { id: 'inv-old4', resId: res.id, title: 'Rent 4 Months Ago', amount: 5000, paid: 5000, due: `${old4YM}-05`, type: 'rent' });

  // General notices: one recent (5 days ago), one old (40 days ago)
  Store.put('notice', { id: 'n-recent', title: 'Water Tank Cleaning', body: 'Cleaned tomorrow', date: addDays(curDate, -5), pinned: false });
  Store.put('notice', { id: 'n-old', title: 'Old Holiday Notice', body: 'Expired notice', date: addDays(curDate, -40), pinned: false });

  const board = residentNoticeBoard(res.id);

  // Fee notices: exactly 3 months, current month on top (index 0), old 4 months ago excluded
  assert.equal(board.feeNotices.length, 3);
  assert.equal(board.feeNotices[0].isCurrent, true);
  assert.equal(board.feeNotices[0].ym, curYM);
  assert.equal(board.feeNotices[1].ym, prev1YM);
  assert.equal(board.feeNotices[2].ym, prev2YM);
  assert.equal(board.feeNotices.some(fn => fn.ym === old4YM), false);

  // General notices: 40-day-old notice automatically excluded; 5-day-old notice included
  assert.equal(board.generalNotices.some(n => n.id === 'n-recent'), true);
  assert.equal(board.generalNotices.some(n => n.id === 'n-old'), false);
});

test('3. Branded Email template and auto agreement trigger on onboarding completion', () => {
  Store.data = {};
  const curDate = today();

  // Test email template rendering
  const emailHtml = renderBrandedEmailHtml({
    hostelName: 'Sunrise Boys PG',
    title: 'Monthly Bill',
    headline: 'Fee Notice',
    recipientName: 'Gautam Jha',
    bodyLines: 'Rent Nov 2026: Rs. 4,533\nDeposit: Rs. 8,000',
    amountDue: 12533,
    payLink: 'http://localhost:5176/pay.html?order=123',
    date: curDate
  });

  assert.ok(emailHtml.includes('Sunrise Boys PG'));
  assert.ok(emailHtml.includes('Gautam Jha'));
  assert.ok(emailHtml.includes('12,533'));
  assert.ok(emailHtml.includes('Pay Online / UPI Now'));

  // Test auto agreement trigger
  const res = Store.put('res', {
    id: 'res-onboard',
    name: 'Aman Sharma',
    phone: '9876543210',
    email: 'aman@example.com',
    roomId: 'room-101',
    bed: 'A',
    rent: 8000,
    deposit: 8000,
    checkIn: curDate,
    status: 'active',
    docs: [{ type: 'Aadhaar card', path: 'h1/res/res-onboard/aadhaar.jpg' }],
    pv: null
  });

  // Not complete yet (pv is null) -> should return null
  assert.equal(checkAndAutoSendAgreement(res.id), null);

  // Complete police verification
  submitPoliceVerification(res.id, {
    refNo: 'PV-RAJ-99881',
    date: curDate,
    status: 'submitted'
  });

  // Now all conditions met: checkAndAutoSendAgreement generates agreement!
  const agr = getActiveAgreement(res.id);
  assert.ok(agr, 'Active agreement should be auto-created');
  assert.equal(agr.resId, res.id);
  assert.equal(agr.rent, 8000);
});

test('4. Bed orphaned click heals and does not crash or navigate to resident not found', () => {
  Store.data = {};
  const room = Store.put('room', {
    id: 'room-105',
    no: '105',
    beds: [
      { id: 'A', status: 'occ', resId: 'deleted-resident-id' },
      { id: 'B', status: 'vac', resId: null }
    ]
  });

  // Resident does not exist in Store.all('res')
  assert.equal(Store.get('deleted-resident-id'), null);

  // Load ui-owner code in sandbox
  for (const f of ['ui-owner.js']) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
    vm.runInThisContext(code, { filename: f });
  }

  // Simulate tapping Bed A
  let sheetOpened = false;
  let navTarget = null;
  global.sheet = () => { sheetOpened = true; };
  global.go = to => { navTarget = to; };

  A.bed({ dataset: { room: 'room-105', bed: 'A' } });

  // Bed A must NOT navigate to 'residents/deleted-resident-id'
  assert.equal(navTarget, null);
  // Bed A must open check-in sheet
  assert.equal(sheetOpened, true);

  // Bed in store must be healed to vac
  const refreshedRoom = Store.get('room-105');
  const bedA = refreshedRoom.beds.find(b => b.id === 'A');
  assert.equal(bedA.status, 'vac');
  assert.equal(bedA.resId, null);
});

test('5. Room delete: room with no active residents can be deleted, room with active residents is blocked', () => {
  Store.data = {};
  const roomEmpty = Store.put('room', { id: 'room-empty', no: '101', beds: [{ id: 'A', status: 'vac' }] });
  const roomOccupied = Store.put('room', { id: 'room-occ', no: '102', beds: [{ id: 'A', status: 'occ', resId: 'res-occ' }] });
  Store.put('res', { id: 'res-occ', name: 'Rohan', roomId: 'room-occ', bed: 'A', status: 'active' });

  let toastMsg = null;
  let toastType = null;
  global.toast = (msg, type) => { toastMsg = msg; toastType = type; };
  global.confirmBox = (msg, run) => { run(); };
  global.closeModal = () => {};
  global.render = () => {};

  // Try deleting occupied room -> must be blocked
  A.delroom({ dataset: { id: 'room-occ' } });
  assert.ok(toastMsg.includes('Cannot delete room'));
  assert.equal(toastType, 'bad');
  assert.ok(Store.get('room-occ'));

  // Try deleting empty room -> succeeds
  A.delroom({ dataset: { id: 'room-empty' } });
  assert.equal(Store.get('room-empty'), null);
});
