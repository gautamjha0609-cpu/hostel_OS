// Comprehensive Test Suite for Configurable Business Rules Engine
// Verifies:
// 1. Business templates application & 4-tier configuration hierarchy
// 2. Calendar monthly vs joining-date anniversary cycle calculations (including 28/29/30/31 days & leap years)
// 3. Mid-month check-in rent calculations (pro-rata actual days, fixed 30 divisor, full, next cycle, custom)
// 4. Checkout settlement calculation (notice period shortfall fee, deposit deduction caps, dues, refund)
// 5. Electricity slab rates & fixed pricing calculations, split electricity with slabs, manual reading audit
// 6. Security deposit modes (fixed, rent multiple, per-bed) & late fee calculations (fixed, daily, percentage, caps, grace days)
// 7. Mess cutoff enforcement & leave rebate calculations
// 8. Digital agreement templates with variable interpolation & IT Act compliance
// 9. Staff action permission matrix across roles (owner, manager, warden, accountant, cook, guard)
// 10. Monthly billing automation batch idempotency & WhatsApp billing summary generation

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function boot() {
  const mem = {};
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, URL, URLSearchParams, Date, Math, JSON, TextEncoder, crypto,
    localStorage: {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; },
      key: () => null,
      length: 0
    },
    navigator: { onLine: true, vibrate() {} },
    location: { href: 'https://app.test/index.html', hash: '', origin: 'https://app.test', pathname: '/index.html' },
    document: {
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { dataset: {} },
      body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} },
      createElement: () => ({ setAttribute() {}, appendChild() {}, querySelector: () => null })
    },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
  };
  ctx.window = ctx;
  ctx.window.HOSTELOS_CONFIG = {};
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js', 'xlsx.js', 'report.js', 'pwa.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`
    toast = () => {};
    globalThis.T = {
      Store, Demo, S, can, canAction, checkIn, recordPayment, resDue, openInv, resInvoices, invBal,
      splitElectricity, freeMonths, addReading, addInvoice, today, addDays, ymOf, daysIn, rentDue,
      activeRes, resById, roomById, checkout, correctReading, deleteReading, registerMeter,
      createAgreement, getActiveAgreement, renewAgreement, agreementDueRenewal, reversePayment,
      alog, payments, resPays, Report,
      DEFAULT_SETTINGS, DEFAULT_AGREEMENT_TEMPLATES, BUSINESS_TEMPLATES, ACTION_PERMS,
      effectiveSettings, applyBusinessTemplate, calcCheckInRent, residentCycleFor,
      calcDepositAmount, calcLateFee, calcSettlement, calcElectricityCost,
      canSkipMeal, calcMessRebate, PaymentGateway, composeMonthlyBillingMessage, runMonthlyBillingBatch, upiPayUrl
    };
  `, ctx);
  return ctx.T;
}

let T;
function setupHostel(role = 'owner', extra = {}) {
  T = boot();
  const S = T.Store;
  S.me = { id: 'u1', full_name: 'Owner Person', role };
  S.orgs = [{ id: 'o1', modules: extra.modules || {}, status: 'active', owner_name: 'Owner Person', phone: '9876500001', settings: extra.orgSettings || {} }];
  S.hostels = [{
    id: 'h1',
    org_id: 'o1',
    name: 'Sarvlekh Elite PG',
    address: '100 Tech Park Road, Bengaluru',
    phone: '9876500001',
    settings: extra.settings || {}
  }];
  S.ctx = { key: 'k', role, hostelId: 'h1', orgId: 'o1', perms: extra.perms || [], deny: [] };
  S.put('room', { id: 'r1', no: '101', floor: 'F1', rent: 8000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  S.put('room', { id: 'r2', no: '102', floor: 'F1', rent: 9000, beds: [{ id: 'A', status: 'vac' }] });
  return S;
}

test('1. Business templates application & 4-tier configuration hierarchy', () => {
  const S = setupHostel('owner');

  // Verify business template definitions
  assert.ok(T.BUSINESS_TEMPLATES.standard_pg, 'standard_pg template exists');
  assert.ok(T.BUSINESS_TEMPLATES.student_hostel, 'student_hostel template exists');
  assert.ok(T.BUSINESS_TEMPLATES.working_pg, 'working_pg template exists');
  assert.ok(T.BUSINESS_TEMPLATES.coliving, 'coliving template exists');

  // Apply template
  const applied = T.applyBusinessTemplate('working_pg');
  assert.equal(applied.rent.model, 'joining_date');
  assert.equal(applied.checkout.noticeDaysRequired, 15);
  assert.equal(applied.mess.billing, 'optional');

  // Verify 4-tier inheritance: Platform -> Org -> Hostel -> Resident
  S.orgs[0].settings = { rent: { dueDays: 7 } };
  S.hostels[0].settings = { rent: { dueDays: 4, lateFee: 350 } };

  // Hostel override wins over org
  const effective = T.effectiveSettings('h1');
  assert.equal(effective.settings.rent.dueDays, 4);
  assert.equal(effective.settings.rent.lateFee, 350);

  // Resident exception overrides hostel
  const r = S.put('res', {
    id: 'res-custom-policy',
    name: 'Ananya Sharma',
    phone: '9876543210',
    roomId: 'r1',
    bed: 'A',
    rent: 8500,
    checkIn: '2026-01-01',
    status: 'active',
    billingPolicy: { rent: { dueDays: 10, lateFee: 150 } }
  });

  const resEff = T.effectiveSettings('h1', r.id);
  assert.equal(resEff.settings.rent.dueDays, 10, 'Resident exception for dueDays applies');
  assert.equal(resEff.settings.rent.lateFee, 150, 'Resident exception for lateFee applies');
});

test('2. Calendar monthly vs joining-date anniversary cycle calculations', () => {
  setupHostel('owner');

  // Calendar monthly resident
  const rCal = { id: 'rc', name: 'Cal Resident', checkIn: '2026-01-10', rent: 8000, billingPolicy: { model: 'calendar_monthly' } };
  const cycleCal = T.residentCycleFor(rCal, '2026-03-15');
  assert.equal(cycleCal.cycleStart, '2026-03-01');
  assert.equal(cycleCal.cycleEnd, '2026-03-31');
  assert.equal(cycleCal.model, 'calendar_monthly');

  // Joining-date anniversary resident (joined on 15th)
  const rJoin15 = { id: 'rj15', name: 'Anniversary Resident', checkIn: '2026-01-15', rent: 8000, billingPolicy: { model: 'joining_date' } };
  // Target date within cycle: 2026-03-20 -> cycle is 2026-03-15 to 2026-04-14
  const cycle15 = T.residentCycleFor(rJoin15, '2026-03-20');
  assert.equal(cycle15.cycleStart, '2026-03-15');
  assert.equal(cycle15.cycleEnd, '2026-04-14');
  assert.equal(cycle15.model, 'joining_date');

  // Target date before 15th: 2026-03-05 -> cycle is 2026-02-15 to 2026-03-14
  const cyclePrev15 = T.residentCycleFor(rJoin15, '2026-03-05');
  assert.equal(cyclePrev15.cycleStart, '2026-02-15');
  assert.equal(cyclePrev15.cycleEnd, '2026-03-14');

  // End of month clamping: Resident joined on 31st (Jan 31)
  const rJoin31 = { id: 'rj31', name: 'End Month Resident', checkIn: '2026-01-31', rent: 8000, billingPolicy: { model: 'joining_date' } };
  // Target in February 2026 (non-leap year: 28 days)
  const cycleFeb26 = T.residentCycleFor(rJoin31, '2026-02-10');
  assert.ok(cycleFeb26.cycleStart.startsWith('2026-01-31'));

  // Target in Feb 2026 after Feb start: clamps to 28
  const cycleFebLate = T.residentCycleFor(rJoin31, '2026-03-01');
  assert.equal(cycleFebLate.cycleStart, '2026-02-28', 'Clamped to 28 for non-leap Feb');

  // Target in Feb 2024 (leap year: 29 days)
  const rLeap31 = { id: 'rjl', name: 'Leap Resident', checkIn: '2024-01-31', rent: 8000, billingPolicy: { model: 'joining_date' } };
  const cycleLeap = T.residentCycleFor(rLeap31, '2024-03-01');
  assert.equal(cycleLeap.cycleStart, '2024-02-29', 'Clamped to 29 for leap year Feb');
});

test('3. Mid-month check-in rent calculations across policies', () => {
  setupHostel('owner');

  // A. Actual calendar days pro-rata in a 30-day month (November)
  // Check-in Nov 15: occupied days = 30 - 15 + 1 = 16 days. Rent = (8000 * 16) / 30 = 4266.67
  const calcNov = T.calcCheckInRent({
    checkInDate: '2026-11-15',
    monthlyRent: 8000,
    policy: true,
    divisor: 'actual_days'
  });
  assert.equal(calcNov.totalDays, 30);
  assert.equal(calcNov.occupiedDays, 16);
  assert.equal(calcNov.amount, 4266.67);

  // B. Fixed 30-day divisor in a 31-day month (January)
  // Check-in Jan 15: occupied days = 31 - 15 + 1 = 17 days. Rent = (8000 * 17) / 30 = 4533.33
  const calcJanFixed = T.calcCheckInRent({
    checkInDate: '2026-01-15',
    monthlyRent: 8000,
    policy: true,
    divisor: 'fixed_30'
  });
  assert.equal(calcJanFixed.totalDays, 30);
  assert.equal(calcJanFixed.occupiedDays, 17);
  assert.equal(calcJanFixed.amount, 4533.33);

  // C. Full month policy
  const calcFull = T.calcCheckInRent({
    checkInDate: '2026-11-20',
    monthlyRent: 8000,
    policy: 'full'
  });
  assert.equal(calcFull.amount, 8000);

  // D. Next cycle policy (₹0 first invoice)
  const calcNext = T.calcCheckInRent({
    checkInDate: '2026-11-25',
    monthlyRent: 8000,
    policy: 'next_cycle'
  });
  assert.equal(calcNext.amount, 0);

  // E. Custom adjustment override
  const calcCustom = T.calcCheckInRent({
    checkInDate: '2026-11-15',
    monthlyRent: 8000,
    customAmount: 3500
  });
  assert.equal(calcCustom.amount, 3500);

  // F. 1st of month check-in (always full month)
  const calcFirst = T.calcCheckInRent({
    checkInDate: '2026-11-01',
    monthlyRent: 8000,
    policy: true
  });
  assert.equal(calcFirst.amount, 8000);
});

test('4. Checkout settlement calculation (notice period shortfall fee, deduction caps, refund)', () => {
  const S = setupHostel('owner');

  // Check-in resident (rent 9000, deposit 15000)
  const r = T.checkIn({
    name: 'Kavita Iyer',
    phone: '9876512345',
    roomId: 'r1',
    bed: 'A',
    rent: 9000,
    deposit: 15000,
    checkIn: '2026-01-01'
  });

  // Pay both rent (9000) and deposit (15000) = 24000
  T.recordPayment({ resId: r.id, amount: 24000, date: '2026-01-01', method: 'upi', note: 'Rent and deposit payment' });

  // Verify deposit invoice is fully paid
  const depInv = T.resInvoices(r.id).find(i => i.type === 'deposit');
  assert.ok(depInv);
  assert.equal(depInv.paid, 15000);

  // Add an unpaid utility invoice
  T.addInvoice({
    resId: r.id,
    roomId: 'r1',
    type: 'electricity',
    period: '2026-03',
    title: 'Electricity Mar 2026',
    amount: 1200,
    date: '2026-03-31',
    due: '2026-04-05'
  });

  // Scenario A: Shortfall fee applied when notice is insufficient
  // Required: 30 days. Given notice on 2026-04-01, checkout on 2026-04-11 (10 days given, shortfall = 20 days)
  // Daily rate for April (30 days) = 9000 / 30 = 300. Shortfall fee = 300 * 20 = 6000.
  const settlement = T.calcSettlement({
    resId: r.id,
    checkoutDate: '2026-04-11',
    noticeDate: '2026-04-01',
    deductions: 800, // room cleaning / repairs
    notes: 'Early relocation'
  });

  assert.equal(settlement.depositPaid, 15000);
  assert.equal(settlement.requiredNoticeDays, 30);
  assert.equal(settlement.noticeDaysGiven, 10);
  assert.equal(settlement.shortfallDays, 20);
  assert.equal(settlement.shortfallFee, 6000);
  assert.equal(settlement.unpaidDues, 1200);
  assert.equal(settlement.deductions, 800);
  assert.equal(settlement.totalLiabilities, 1200 + 800 + 6000); // 8000
  assert.equal(settlement.refund, 15000 - 8000); // 7000

  // Scenario B: Deductions exceeding deposit throws error
  assert.throws(() => {
    T.calcSettlement({
      resId: r.id,
      checkoutDate: '2026-04-11',
      deductions: 20000 // exceeds deposit (15000)
    });
  }, /cannot exceed/i);

  // Scenario C: Perform checkout and verify deposit document contains settlement statement
  const depDoc = T.checkout(r.id, '2026-04-11', 800, 'Checkout note', {
    noticeDate: '2026-04-01',
    notes: 'Checkout finalized'
  });
  assert.ok(depDoc.settlement, 'Settlement object stored on deposit record');
  assert.equal(depDoc.settlement.shortfallFee, 6000);
  assert.equal(depDoc.settlement.refund, 7000);
});

test('5. Electricity slab rates & fixed pricing calculations, split electricity with slabs, manual reading audit', () => {
  const S = setupHostel('owner');

  // A. Fixed pricing
  const fixedCost = T.calcElectricityCost(100, { pricing: 'fixed', rate: 10, fixedCharge: 50 });
  assert.equal(fixedCost, 1050); // 100 * 10 + 50

  // B. Slab pricing
  // Slabs: 0-50 @ ₹7, 51-150 (next 100) @ ₹9, 151+ @ ₹12, fixed charge ₹100
  const slabCfg = {
    pricing: 'slab',
    slabs: [
      { upTo: 50, rate: 7 },
      { upTo: 150, rate: 9 },
      { upTo: 999999, rate: 12 }
    ],
    fixedCharge: 100
  };

  // Units = 30 -> 30*7 + 100 = 310
  assert.equal(T.calcElectricityCost(30, slabCfg), 310);

  // Units = 120 -> 50*7 (350) + 70*9 (630) + 100 = 1080
  assert.equal(T.calcElectricityCost(120, slabCfg), 1080);

  // Units = 200 -> 50*7 (350) + 100*9 (900) + 50*12 (600) + 100 = 1950
  assert.equal(T.calcElectricityCost(200, slabCfg), 1950);

  // C. Split electricity with slabs
  S.hostels[0].settings = {
    ...S.hostels[0].settings,
    elec: {
      ...slabCfg,
      freeUnits: 0,
      freeMode: 'resident'
    }
  };

  const shares = T.splitElectricity('r1', 120, 9, ['res1', 'res2'], [1, 1]);
  assert.equal(shares.length, 2);
  assert.equal(shares[0].units, 60);
  assert.equal(shares[1].units, 60);
  // Each resident has 60 units: 50*7 (350) + 10*9 (90) + 100 = 540
  assert.equal(shares[0].amount, 540);
  assert.equal(shares[1].amount, 540);

  // D. Manual reading audit trail
  const meterDoc = T.addReading({
    roomId: 'r1',
    curr: 450,
    prev: 330,
    units: 120,
    date: '2026-04-01',
    isManual: true,
    capturedBy: 'Warden John'
  });
  assert.equal(meterDoc.isManual, true);
  assert.equal(meterDoc.capturedBy, 'Warden John');
});

test('6. Security deposit modes & late fee calculations', () => {
  setupHostel('owner');

  // A. Deposit calculation modes
  const depFixed = T.calcDepositAmount({
    monthlyRent: 8000,
    depositSettings: { mode: 'fixed', fixedAmount: 12000, nonRefundable: 1000 }
  });
  assert.equal(depFixed.total, 12000);
  assert.equal(depFixed.refundable, 11000);
  assert.equal(depFixed.nonRefundable, 1000);

  const depMulti = T.calcDepositAmount({
    monthlyRent: 8500,
    depositSettings: { mode: 'rent_multiple', rentMultiplier: 2, nonRefundable: 0 }
  });
  assert.equal(depMulti.total, 17000);
  assert.equal(depMulti.refundable, 17000);

  // B. Late fee calculations
  const dummyInv = { id: 'inv-1', due: '2026-04-05', amount: 8000, paid: 0 };

  // Within grace period (today is 2026-04-08, 3 days overdue, grace is 5 days)
  const feeGrace = T.calcLateFee({
    invoice: dummyInv,
    todayDate: '2026-04-08',
    lateSettings: { on: true, mode: 'fixed', amount: 250, graceDays: 5 }
  });
  assert.equal(feeGrace.amount, 0);
  assert.equal(feeGrace.withinGrace, true);

  // Overdue beyond grace (today is 2026-04-15, 10 days overdue, grace is 5 days -> 5 chargeable days)
  // Mode: fixed
  const feeFixed = T.calcLateFee({
    invoice: dummyInv,
    todayDate: '2026-04-15',
    lateSettings: { on: true, mode: 'fixed', amount: 250, graceDays: 5, maxCap: 1000 }
  });
  assert.equal(feeFixed.amount, 250);

  // Mode: daily (₹50/day * 5 days = ₹250)
  const feeDaily = T.calcLateFee({
    invoice: dummyInv,
    todayDate: '2026-04-15',
    lateSettings: { on: true, mode: 'daily', dailyAmount: 50, graceDays: 5, maxCap: 1000 }
  });
  assert.equal(feeDaily.amount, 250);

  // Mode: percentage (2% of 8000 = ₹160)
  const feePct = T.calcLateFee({
    invoice: dummyInv,
    todayDate: '2026-04-15',
    lateSettings: { on: true, mode: 'percentage', percentage: 2, graceDays: 5, maxCap: 1000 }
  });
  assert.equal(feePct.amount, 160);

  // Capped at maxCap
  const feeCapped = T.calcLateFee({
    invoice: dummyInv,
    todayDate: '2026-05-15', // 40 days overdue -> 35 chargeable days * 50 = ₹1750, capped at ₹500
    lateSettings: { on: true, mode: 'daily', dailyAmount: 50, graceDays: 5, maxCap: 500 }
  });
  assert.equal(feeCapped.amount, 500);
  assert.equal(feeCapped.capped, true);
});

test('7. Mess cutoff enforcement & leave rebate calculations', () => {
  const S = setupHostel('owner');

  // Cutoff checks for Lunch (cutoff: '10:00', prev: false)
  const cutPass = T.canSkipMeal('lunch', T.today(), '09:00');
  assert.equal(cutPass.allowed, true);

  const cutFail = T.canSkipMeal('lunch', T.today(), '11:00');
  assert.equal(cutFail.allowed, false);

  // Mess leave rebate calculation
  S.hostels[0].settings = {
    ...S.hostels[0].settings,
    mess: {
      billing: 'compulsory',
      rebatePerDay: 100,
      minLeaveDays: 3
    }
  };

  // Leave of 2 days: less than minLeaveDays (3) -> 0 rebate
  const rebate2 = T.calcMessRebate('res-1', '2026-04-10', '2026-04-11');
  assert.equal(rebate2.eligible, false);
  assert.equal(rebate2.rebate, 0);

  // Leave of 5 days: eligible -> 5 * 100 = 500
  const rebate5 = T.calcMessRebate('res-1', '2026-04-10', '2026-04-14');
  assert.equal(rebate5.eligible, true);
  assert.equal(rebate5.days, 5);
  assert.equal(rebate5.rebate, 500);
});

test('8. Digital agreement templates with variable interpolation & IT Act compliance', () => {
  const S = setupHostel('owner');

  const r = S.put('res', {
    id: 'res-agr-1',
    name: 'Rohan Mehta',
    phone: '9876598765',
    roomId: 'r1',
    bed: 'B',
    rent: 9500,
    deposit: 19000,
    checkIn: '2026-01-15',
    status: 'active'
  });

  const agr = T.createAgreement({
    resId: r.id,
    templateId: 'tpl-std',
    startDate: '2026-01-15',
    endDate: '2027-01-14',
    clauses: ['Custom terms for resident {{resident_name}} in room {{room_no}} with rent Rs.{{rent}} and deposit Rs.{{deposit}}.']
  });

  assert.ok(agr);
  assert.ok(agr.clauses[0].includes('Rohan Mehta'), 'Resident name interpolated');
  assert.ok(agr.clauses[0].includes('101'), 'Room no interpolated');
  assert.ok(agr.clauses[0].includes('9500'), 'Rent interpolated');
  assert.ok(agr.clauses[0].includes('19000'), 'Deposit interpolated');
  assert.ok(agr.legalDisclaimer.includes('Information Technology Act, 2000'), 'IT Act 2000 disclaimer present');
});

test('9. Staff action permission matrix across roles', () => {
  setupHostel('owner');

  // Owner can do everything
  assert.equal(T.canAction('view'), true);
  assert.equal(T.canAction('create'), true);
  assert.equal(T.canAction('edit'), true);
  assert.equal(T.canAction('correct'), true);
  assert.equal(T.canAction('approve'), true);
  assert.equal(T.canAction('refund'), true);
  assert.equal(T.canAction('delete'), true);
  assert.equal(T.canAction('settings'), true);

  // Manager: can create, edit, correct, approve, refund, but CANNOT delete or modify client settings
  setupHostel('manager');
  assert.equal(T.canAction('create'), true);
  assert.equal(T.canAction('edit'), true);
  assert.equal(T.canAction('correct'), true);
  assert.equal(T.canAction('approve'), true);
  assert.equal(T.canAction('refund'), true);
  assert.equal(T.canAction('delete'), false);
  assert.equal(T.canAction('settings'), false);

  // Warden: can view, create, edit records (e.g. meter readings, gate logs), but CANNOT correct readings, refund, delete, or change settings
  setupHostel('warden');
  assert.equal(T.canAction('view'), true);
  assert.equal(T.canAction('create'), true);
  assert.equal(T.canAction('edit'), true);
  assert.equal(T.canAction('correct'), false);
  assert.equal(T.canAction('approve'), false);
  assert.equal(T.canAction('refund'), false);
  assert.equal(T.canAction('delete'), false);

  // Cook: can only view
  setupHostel('cook');
  assert.equal(T.canAction('view'), true);
  assert.equal(T.canAction('create'), false);
  assert.equal(T.canAction('delete'), false);

  // Guard: can only view
  setupHostel('guard');
  assert.equal(T.canAction('view'), true);
  assert.equal(T.canAction('approve'), false);
  assert.equal(T.canAction('refund'), false);
});

test('10. Monthly billing automation batch idempotency & WhatsApp billing summary generation', () => {
  const S = setupHostel('owner');

  // Add 2 active residents
  S.put('res', {
    id: 'res-b1',
    name: 'Suresh Kumar',
    phone: '9876540001',
    roomId: 'r1',
    bed: 'A',
    rent: 7500,
    checkIn: '2026-01-01',
    status: 'active'
  });
  S.put('res', {
    id: 'res-b2',
    name: 'Deepak Patel',
    phone: '9876540002',
    roomId: 'r1',
    bed: 'B',
    rent: 8000,
    checkIn: '2026-01-01',
    status: 'active'
  });

  // Run 1: Monthly billing batch for 2026-04
  const batch1 = T.runMonthlyBillingBatch({ ym: '2026-04' });
  assert.equal(batch1.totalResidents, 2);
  assert.equal(batch1.invoicesCreated, 2);
  assert.equal(batch1.invoicesSkipped, 0);
  assert.equal(batch1.totalBilledAmount, 15500);
  assert.equal(batch1.messages.length, 2);
  assert.ok(batch1.messages[0].text.includes('Suresh'));
  assert.ok(batch1.messages[0].text.includes('7,500'));
  assert.ok(batch1.messages[0].waLink.startsWith('https://wa.me/919876540001'));

  // Run 2: Re-running the EXACT same billing batch must produce 0 duplicate invoices (idempotent)
  const batch2 = T.runMonthlyBillingBatch({ ym: '2026-04' });
  assert.equal(batch2.totalResidents, 2);
  assert.equal(batch2.invoicesCreated, 0, 'Zero invoices created on idempotent re-run');
  assert.equal(batch2.invoicesSkipped, 2, 'Both invoices correctly recognized as existing and skipped');
  assert.equal(batch2.totalBilledAmount, 0, 'No extra amount billed');

  // Verify composed WhatsApp message helper
  const msg = T.composeMonthlyBillingMessage({
    name: 'Suresh Kumar',
    hostelName: 'Sarvlekh Elite PG',
    period: '2026-04',
    rentAmount: 7500,
    elecAmount: 450,
    totalDue: 7950,
    payLink: 'https://sarvlekh.in/pay/res-b1'
  });
  assert.ok(msg.includes('Suresh'));
  assert.ok(msg.includes('Sarvlekh Elite PG'));
  assert.ok(msg.includes('₹7,950'));
  assert.ok(msg.includes('https://sarvlekh.in/pay/res-b1'));
});

test('11. Checkout settlement priority & safe ledger state when liabilities exceed deposit', () => {
  const S = setupHostel('owner');
  const r = T.checkIn({
    name: 'Test Resident',
    phone: '9876543210',
    roomId: 'r1',
    bed: 'A',
    rent: 8000,
    deposit: 10000,
    checkIn: '2026-01-01'
  });

  T.recordPayment({ resId: r.id, amount: 18000, date: '2026-01-01' });

  T.addInvoice({
    resId: r.id,
    roomId: 'r1',
    type: 'electricity',
    period: '2026-02',
    title: 'Electricity Feb',
    amount: 8000,
    date: '2026-02-28',
    due: '2026-03-05'
  });

  // Available deposit: 10000. Dues: 8000. Deductions: 5000. Notice: 30 days served.
  const numPaysBefore = T.payments().length;
  const dep = T.checkout(r.id, '2026-03-01', 5000, 'Damage', { noticeDate: '2026-01-30' });
  const numPaysAfter = T.payments().length;
  assert.equal(numPaysAfter, numPaysBefore + 1, 'Exactly one payment recorded for the settled dues');
  assert.equal(dep.settled, 5000, 'Dues settled from remaining deposit');
  assert.equal(dep.deductions, 5000, 'Deductions applied');
  assert.equal(dep.refund, 0, 'Zero refund when liabilities exceed deposit');
  assert.equal(dep.balancePayable, 3000, '3000 balance payable remaining to collect');
  assert.equal(T.resById(r.id).status, 'left', 'Resident is marked left');

  // Verify that an invalid deduction (> deposit + credit) is rejected BEFORE mutating anything
  const r2 = T.checkIn({
    name: 'Resident 2',
    phone: '9876543211',
    roomId: 'r1',
    bed: 'B',
    rent: 8000,
    deposit: 5000,
    checkIn: '2026-01-01'
  });
  T.recordPayment({ resId: r2.id, amount: 13000, date: '2026-01-01' });
  const paysBeforeExceed = T.payments().length;
  assert.throws(() => {
    T.checkout(r2.id, '2026-03-01', 15000);
  }, /cannot exceed/i);
  assert.equal(T.payments().length, paysBeforeExceed, 'No ledger mutations when deduction exceeds deposit');
});

test('12. Joining-date check-in rent and monthly batch cycle continuity', () => {
  setupHostel('owner', { settings: { rent: { model: 'joining_date' } } });

  const r = T.checkIn({
    name: 'Anniv Resident',
    phone: '9876543210',
    roomId: 'r1',
    bed: 'A',
    rent: 8000,
    checkIn: '2026-11-15',
    billingPolicy: { model: 'joining_date' }
  });

  const invs = T.resInvoices(r.id);
  assert.equal(invs[0].amount, 8000, 'Joining-date resident first rent should be full cycle (8000)');
  assert.equal(invs[0].period, '15 Nov – 14 Dec', 'Cycle covers full anniversary month');
});

test('13. Monthly billing batch excludes future check-in residents', () => {
  const S = setupHostel('owner');

  S.put('res', {
    id: 'res-future',
    name: 'Future Person',
    phone: '9876543210',
    roomId: 'r1',
    bed: 'A',
    rent: 8000,
    checkIn: '2026-05-01',
    status: 'active'
  });

  const batch = T.runMonthlyBillingBatch({ ym: '2026-04' });
  const futureBilled = batch.residents.find(x => x.resId === 'res-future');
  assert.equal(futureBilled, undefined, 'Future check-in resident should NOT be included in April billing batch');
});

test('14. Sensitive operations authorization matrix enforcement', () => {
  const S = setupHostel('cook');

  S.put('meter', {
    id: 'm1',
    roomId: 'r1',
    date: '2026-04-01',
    curr: 200,
    prev: 100,
    units: 100,
    shares: [],
    status: 'billed'
  });

  // Cook cannot correct readings
  assert.throws(() => {
    T.correctReading({ meterId: 'm1', curr: 180, prev: 100, reason: 'Cook tampering reading' });
  }, /Unauthorized/i);

  // Cook cannot delete readings
  assert.throws(() => {
    T.deleteReading({ meterId: 'm1', reason: 'Cook deleting reading' });
  }, /Unauthorized/i);

  // Cook cannot reverse payments
  assert.throws(() => {
    T.reversePayment('pay-1', 'Unauthorized reversal');
  }, /Unauthorized/i);
});

test('15. Agreement renewal clause text re-interpolation with updated financial terms', () => {
  const S = setupHostel('owner');
  const r = S.put('res', {
    id: 'res-agr-ren',
    name: 'Tarun Verma',
    phone: '9876599999',
    roomId: 'r1',
    bed: 'A',
    rent: 8000,
    checkIn: '2026-01-01',
    status: 'active'
  });

  const agr1 = T.createAgreement({
    resId: r.id,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    rent: 8000,
    clauses: ['Monthly rent payable is Rs.{{rent}}.']
  });
  assert.ok(agr1.clauses[0].includes('Rs.8000'));

  const agr2 = T.renewAgreement(agr1.id, {
    newEndDate: '2027-12-31',
    rent: 10000
  });

  assert.equal(agr2.rent, 10000);
  assert.ok(agr2.clauses[0].includes('Rs.10000'), 'Renewed clause text should reflect new rent Rs.10000, not stale Rs.8000');
});

test('16. Electricity slab pricing beyond highest tier and fixed charge on 0 units', () => {
  setupHostel('owner');

  const cfg = {
    pricing: 'slab',
    slabs: [
      { upTo: 50, rate: 7 },
      { upTo: 150, rate: 9 }
    ],
    fixedCharge: 100
  };

  const cost200 = T.calcElectricityCost(200, cfg);
  assert.equal(cost200, 1800, 'Units exceeding highest slab should be billed at top tier rate');

  const cost0 = T.calcElectricityCost(0, cfg);
  assert.equal(cost0, 100, 'Zero units should incur fixed monthly charge');
});
