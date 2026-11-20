// Comprehensive Integration & Unit Tests for HostelOS Product Enhancements
// Run: npm test (Node 18+, no external dependencies)
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service';
process.env.SETUP_KEY = process.env.SETUP_KEY || 'setup-secret';

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
  ctx.window = ctx; ctx.window.HOSTELOS_CONFIG = {};
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js', 'xlsx.js', 'report.js', 'pwa.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`toast = () => {}; globalThis.T = {
    Store, Demo, S, can, checkIn, recordPayment, resDue, openInv, resInvoices, invBal, splitElectricity,
    today, addDays, ymOf, rentDue, resById, activeRes, allResidents, rooms, allRooms, occupancy,
    pvOn, pvOf, pvDue, pvPending, pvPortal,
    shiftBed, swapBeds, bulkCreateRooms,
    getItemDependencies, deactivateItem, reactivateItem, replaceIngredientInDishes,
    parseBankStatement, reconcileBankStatement,
    isBillingComplete, sendMonthlyBillingWhatsApp,
    sendAgreementEmail,
    maskAadhaar, emitraPendingQueue, submitPoliceVerification,
    Report, Xlsx, ROLES, MODULES, canAction, STAFF_ROLE_BY_DEPT, ROLE_CHOICES, isRoleAllowed, isModOnHostel
  };`, ctx);
  return ctx.T;
}

let T;
function setupHostel(role = 'owner', extra = {}) {
  T = boot();
  const S = T.Store;
  S.me = { id: 'u1', full_name: 'Hostel Owner' };
  S.orgs = [{ id: 'o1', modules: extra.modules || {}, status: 'active', name: 'Elite Living Org' }];
  S.hostels = [{
    id: 'h1', org_id: 'o1', name: 'Sarvlekh Residency',
    settings: {
      elec: { rate: 10, freeUnits: 0, freeMode: 'resident' },
      police: { on: true, state: 'RJ', dueDays: 7 },
      site: { on: true, slug: 'sarvlekh' },
      ...(extra.settings || {})
    }
  }];
  S.ctx = { key: 'k1', role, hostelId: 'h1', orgId: 'o1', perms: extra.perms || [], deny: [] };
  // Base setup: Room 101 with 2 beds
  S.put('room', { id: 'r1', no: '101', floor: '1st', rent: 8000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  return S;
}

beforeEach(() => setupHostel());

// ============================================================================
// FEATURE 1: PUBLIC PG INQUIRY PANEL
// ============================================================================
test('Feature 1: Public PG Inquiry — input validation and rate limiting via api/public.js', async () => {
  const publicApi = require('../api/public.js')._internals;
  assert.ok(publicApi.inquiry, 'inquiry handler should be exported');

  const origFetch = global.fetch;
  const H1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const ORG1 = '11111111-1111-4111-8111-111111111111';
  const HOSTEL = { id: H1, org_id: ORG1, name: 'Sarvlekh Residency', status: 'active', settings: { site: { on: true, slug: 'sarvlekh' } } };

  global.fetch = async (url, opt = {}) => {
    const u = new URL(url);
    const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
    if (u.pathname === '/rest/v1/hostels') {
      return json(200, [HOSTEL]);
    }
    if (u.pathname === '/rest/v1/docs') {
      return json(201, null);
    }
    return json(200, []);
  };

  try {
    async function callInquiry(body = {}, ip = '127.0.0.1') {
      let statusCode = 200, resData = null;
      const req = {
        method: 'POST',
        body,
        headers: { 'x-forwarded-for': ip }
      };
      const res = {
        status(c) { statusCode = c; return this; },
        json(d) { resData = d; return this; },
        setHeader() {}
      };
      try {
        await publicApi.inquiry(req, res);
      } catch (e) {
        statusCode = e.status || 500;
        resData = { error: e.message };
      }
      return { status: statusCode, data: resData };
    }

    // 1. Missing hostel identifier (slug or hostelId)
    const noHostel = await callInquiry({ name: 'Rahul', phone: '9876543210' });
    assert.equal(noHostel.status, 400);

    // 2. Missing required name
    const missingName = await callInquiry({ slug: 'sarvlekh', phone: '9876543210' });
    assert.equal(missingName.status, 400);

    // 3. Invalid Indian phone number (must start with 6-9 and have 10 digits)
    const badPhone = await callInquiry({ slug: 'sarvlekh', name: 'Rahul Sharma', phone: '1234567890' });
    assert.equal(badPhone.status, 400);
    assert.match(badPhone.data.error, /valid 10-digit Indian mobile/);

    // 4. Honeypot bot protection (field 'hp' populated by bot)
    const botSubmission = await callInquiry({ slug: 'sarvlekh', name: 'Bot Name', phone: '9876543210', hp: 'http://spam.ru' });
    assert.equal(botSubmission.status, 200);
    assert.equal(botSubmission.data.id, 'inq-filtered');

    // 5. Rate-limiting check: simulate rapid submissions from single IP exceeding max (15 per 10 min)
    const ip = '198.51.100.42';
    for (let i = 0; i < 15; i++) {
      await callInquiry({ slug: 'sarvlekh', name: 'Rahul Sharma', phone: '9876543210' }, ip);
    }
    const throttled = await callInquiry({ slug: 'sarvlekh', name: 'Rahul Sharma', phone: '9876543210' }, ip);
    assert.equal(throttled.status, 429);
  } finally {
    global.fetch = origFetch;
  }
});

// ============================================================================
// FEATURE 2: PROFESSIONAL MONTHLY EXCEL ANALYTICS
// ============================================================================
test('Feature 2: Monthly Excel Report — generates all 8 required sheets with consistent financial accounting', () => {
  const S = T.Store;
  // Set up resident, room, billing and payment history
  const r1 = T.checkIn({ name: 'Arun Verma', phone: '9876500001', roomId: 'r1', bed: 'A', rent: 8000, deposit: 8000, checkIn: '2026-01-01' });
  T.recordPayment({ resId: r1.id, amount: 8000, mode: 'upi', ref: 'UPI9876543210' });

  // Add electricity meter reading
  S.put('meter', { id: 'm1', roomId: 'r1', date: '2026-01-31', prev: 100, curr: 250, units: 150, rate: 10, total: 1500 });

  // Add expense
  S.put('exp', { id: 'e1', date: '2026-01-15', cat: 'Groceries', desc: 'Vegetables & Milk', amount: 3500, mode: 'cash' });

  // Generate monthly workbook for 2026-01
  const report = T.Report.monthlyWorkbook('2026-01');
  assert.ok(report, 'Report should be returned');
  assert.ok(report.bytes && report.bytes.length > 0, 'Excel file should have binary bytes');
  assert.match(report.name, /Monthly Report 2026-01\.xlsx/);

  // Check computed dataset
  assert.equal(report.D.hostel, 'Sarvlekh Residency');
  assert.equal(report.D.billed, 8000);
  assert.equal(report.D.rev.total.rent, 8000);
  assert.equal(report.D.exp.all, 3500);

  // Verify monthlySheets returns 8 distinct accounting sheets
  const sheets = T.Report.monthlySheets(report.D, '2026-01');
  assert.equal(sheets.length, 8, 'Must contain exactly 8 professional sheets');
  const sheetNames = sheets.map(s => s.name);
  assert.ok(sheetNames.includes('Executive Summary'));
  assert.ok(sheetNames.includes('Resident Ledger'));
  assert.ok(sheetNames.includes('Payments'));
  assert.ok(sheetNames.includes('Electricity'));
  assert.ok(sheetNames.includes('Mess'));
  assert.ok(sheetNames.includes('Expenses'));
  assert.ok(sheetNames.includes('Occupancy'));
  assert.ok(sheetNames.includes('Reconciliation'));
});

// ============================================================================
// FEATURE 3: E-MITRA / POLICE VERIFICATION PORTAL
// ============================================================================
test('Feature 3: E-Mitra Verification — Aadhaar masking, operator queue and state transitions', () => {
  // 1. UIDAI Aadhaar masking (only last 4 digits visible)
  assert.equal(T.maskAadhaar('123456789012'), 'XXXX-XXXX-9012');
  assert.equal(T.maskAadhaar('1234 5678 9012'), 'XXXX-XXXX-9012');
  assert.equal(T.maskAadhaar('9876-5432-1098'), 'XXXX-XXXX-1098');
  assert.equal(T.maskAadhaar('invalid'), 'XXXX-XXXX-XXXX');

  // 2. Resident verification queue
  const r = T.checkIn({ name: 'Vikram Singh', phone: '9876500002', roomId: 'r1', bed: 'B', rent: 8000, checkIn: '2026-01-01' });
  const queue = T.emitraPendingQueue();
  assert.ok(queue.some(x => x.id === r.id), 'Resident should appear in pending verification queue');

  // 3. Submit verification
  const res = T.submitPoliceVerification(r.id, {
    refNo: 'RJ-POL-2026-0099',
    certificatePath: 'https://docs.hostelos.in/pv/cert-99.pdf',
    notes: 'Police acknowledgement uploaded via portal',
    status: 'verified'
  });
  assert.equal(res.pv.status, 'verified');
  assert.equal(res.pv.refNo, 'RJ-POL-2026-0099');
  assert.equal(res.pv.notes, 'Police acknowledgement uploaded via portal');

  // Verify removed from pending queue
  const updatedQueue = T.emitraPendingQueue();
  assert.ok(!updatedQueue.some(x => x.id === r.id), 'Verified resident must not remain in pending queue');

  // 4. Role Isolation: emitra operator permissions strictly limited to verification queue
  setupHostel('emitra');
  assert.equal(T.can('residents'), false, 'Emitra operator CANNOT access resident directory or finances');
  assert.equal(T.can('emitra'), true, 'Emitra operator can access emitra queue');
  assert.equal(T.can('payments'), false, 'Emitra operator CANNOT view payments');
  assert.equal(T.can('expenses'), false, 'Emitra operator CANNOT view expenses');
  assert.equal(T.can('settings'), false, 'Emitra operator CANNOT view settings');

  // 5. Staff Role mapping for E-Mitra
  assert.equal(T.STAFF_ROLE_BY_DEPT['E-Mitra'], 'emitra', 'E-Mitra department must map to emitra role');
  assert.ok(T.S().departments.includes('E-Mitra'), 'E-Mitra must be in staff department options');
  assert.ok(T.ROLE_CHOICES.includes('emitra'), 'emitra must be in ROLE_CHOICES for Super Admin dropdown');

  // 6. Role gating when modules are disabled
  const testHostel = { id: 'h1', org_id: 'o1', modules: { laundry: false, emitra: false, housekeeping: false, kitchen: false, mess: false } };
  const testOrg = { id: 'o1', modules: {} };
  assert.equal(T.isRoleAllowed('laundry', testHostel, testOrg), false, 'laundry role must be disabled when laundry module is off');
  assert.equal(T.isRoleAllowed('emitra', testHostel, testOrg), false, 'emitra role must be disabled when emitra module is off');
  assert.equal(T.isRoleAllowed('housekeeping', testHostel, testOrg), false, 'housekeeping role must be disabled when housekeeping is off');
  assert.equal(T.isRoleAllowed('cook', testHostel, testOrg), false, 'cook role must be disabled when kitchen and mess are off');
  assert.equal(T.isRoleAllowed('manager', testHostel, testOrg), true, 'manager role must always be allowed');
  assert.equal(T.isRoleAllowed('warden', testHostel, testOrg), true, 'warden role must always be allowed');
});

// ============================================================================
// FEATURE 4: BULK FLOOR, ROOM, AND BED CREATION
// ============================================================================
test('Feature 4: Bulk Creation Wizard — multi-floor atomic batch creation and validation', () => {
  const result = T.bulkCreateRooms({
    floors: ['1st', '2nd'],
    roomPatterns: [
      { floorIndex: 0, startNo: 102, endNo: 103, beds: 2, rent: 7500, ac: true },
      { floorIndex: 1, startNo: 201, endNo: 202, beds: 2, rent: 7500, ac: true }
    ],
    defaultRent: 7500,
    defaultAc: true,
    block: 'Tower A'
  });

  assert.equal(result.createdRooms.length, 4, '2 floors x 2 rooms = 4 rooms');
  assert.equal(result.bedCount, 8, '4 rooms x 2 beds (A, B) = 8 beds');

  const r102 = result.createdRooms.find(r => r.no === '102');
  assert.ok(r102);
  assert.equal(r102.floor, '1st');
  assert.equal(r102.rent, 7500);
  assert.equal(r102.ac, true);
  assert.equal(r102.block, 'Tower A');
  assert.equal(r102.beds.length, 2);
  assert.equal(r102.beds[0].status, 'vac');

  // Duplicate rejection: attempting to bulk create room 101 which already exists throws error
  assert.throws(() => {
    T.bulkCreateRooms({
      floors: ['1st'],
      roomPatterns: [{ floorIndex: 0, startNo: 101, endNo: 101, beds: 2 }],
      block: 'Tower A'
    });
  }, /already exists/);

  // Custom per-room inline preview editing verification
  const customResult = T.bulkCreateRooms({
    floors: ['Floor 1', 'Floor 2'],
    rooms: [
      { no: '301', floor: 'Floor 1', beds: 3, rent: 9000, ac: true },
      { no: '302', floor: 'Floor 1', beds: 1, rent: 12000, ac: false },
      { no: '401', floor: 'Floor 2', beds: 4, rent: 6000, ac: true }
    ]
  });

  assert.equal(customResult.createdRooms.length, 3);
  assert.equal(customResult.bedCount, 8, '3 beds + 1 bed + 4 beds = 8 beds');
  const r301 = customResult.createdRooms.find(r => r.no === '301');
  assert.equal(r301.beds.length, 3);
  assert.equal(r301.rent, 9000);
  assert.equal(r301.ac, true);
  const r302 = customResult.createdRooms.find(r => r.no === '302');
  assert.equal(r302.beds.length, 1);
  assert.equal(r302.rent, 12000);
  assert.equal(r302.ac, false);
});

// ============================================================================
// FEATURE 5: AUTOMATIC AGREEMENT EMAIL DELIVERY
// ============================================================================
test('Feature 5: Agreement Email Delivery — email validation, snapshot verification and idempotency', () => {
  const S = T.Store;
  const res = T.checkIn({ name: 'Sneha Patel', phone: '9876500003', roomId: 'r1', bed: 'A', rent: 8000, checkIn: '2026-01-01' });
  
  // Create an agreement document with tenant email
  const agr = {
    id: 'agr1', resId: res.id, terms: '11 months rent agreement', rent: 8000,
    tenantEmail: 'sneha@example.com', signedAt: '2026-01-01T10:00:00Z'
  };
  S.put('agreement', agr);

  // 1. Successful email dispatch: status is 'sent' on dispatch
  const sent = T.sendAgreementEmail('agr1');
  assert.equal(sent.delivered, true);
  assert.equal(sent.sent, true);
  assert.equal(sent.agreement.delivery.status, 'sent');
  assert.equal(sent.agreement.emailStatus, 'sent');
  assert.equal(sent.agreement.delivery.channel, 'email');
  assert.equal(sent.agreement.delivery.to, 'sneha@example.com');

  // Confirmed delivery via provider webhook / receipt sets status to 'delivered'
  const confirmed = T.sendAgreementEmail('agr1', { confirmed: true, forceResend: true });
  assert.equal(confirmed.agreement.delivery.status, 'delivered');
  assert.equal(confirmed.agreement.emailStatus, 'delivered');

  // 2. Idempotency protection: attempting to resend already delivered agreement returns idempotent success
  const duplicate = T.sendAgreementEmail('agr1');
  assert.equal(duplicate.alreadyDelivered, true);

  // 3. Rejects missing agreement
  assert.throws(() => T.sendAgreementEmail('non-existent'), /Agreement not found/);

  // 4. Rejects agreement without valid email
  S.put('agreement', { id: 'agr2', resId: res.id, tenantEmail: 'bad-email' });
  assert.throws(() => T.sendAgreementEmail('agr2'), /valid recipient email/);
});

// ============================================================================
// FEATURE 6: MONTHLY AUTOMATIC WHATSAPP BILLING MESSAGE
// ============================================================================
test('Feature 6: WhatsApp Billing Automation — completion trigger, cycle idempotency and payload formatting', () => {
  const S = T.Store;
  const res = T.checkIn({ name: 'Kunal Joshi', phone: '9876500004', roomId: 'r1', bed: 'A', rent: 8000, checkIn: '2026-01-01' });
  // Electricity meter reading to make billing cycle complete
  S.put('meter', { id: 'm_kunal', roomId: 'r1', date: '2026-01-31', prev: 100, curr: 200, units: 100, rate: 10, total: 1000 });

  // 1. Completeness validation check: invoice + meter exists
  const status = T.isBillingComplete(res.id, '2026-01');
  assert.equal(status.complete, true, 'Rent invoice + finalized meter reading makes billing complete');

  // 2. WhatsApp message dispatch with Meta Cloud API payload
  const wa = T.sendMonthlyBillingWhatsApp(res.id, '2026-01');
  assert.equal(wa.success, true);
  assert.equal(wa.recipient, '919876500004');
  assert.ok(wa.campaignId);
  assert.match(wa.message, /HostelOS Monthly Bill.*2026-01/);
  assert.equal(wa.payload.messaging_product, 'whatsapp');

  // 3. Strict Idempotency: Attempting to send again for same resident & month fails
  assert.throws(() => {
    T.sendMonthlyBillingWhatsApp(res.id, '2026-01');
  }, /Billing WhatsApp already sent/);

  // 4. Force override allows re-dispatch when explicitly requested
  const forced = T.sendMonthlyBillingWhatsApp(res.id, '2026-01', { force: true });
  assert.equal(forced.success, true);
});

// ============================================================================
// FEATURE 7: COOK PANEL INVENTORY DEPENDENCY & CLEANUP
// ============================================================================
test('Feature 7: Cook Panel Inventory — dependency resolution, soft deactivation, and recipe replacement', () => {
  const S = T.Store;
  // Create inventory items
  S.put('item', { id: 'it_paneer', name: 'Fresh Paneer', unit: 'kg', active: true });
  S.put('item', { id: 'it_tofu', name: 'Organic Tofu', unit: 'kg', active: true });

  // Create dishes depending on it_paneer
  S.put('dish', { id: 'd_matar_paneer', name: 'Matar Paneer', ingredients: [{ itemId: 'it_paneer', qty: 0.2 }], available: true });
  S.put('dish', { id: 'd_shahi_paneer', name: 'Shahi Paneer', ingredients: [{ itemId: 'it_paneer', qty: 0.25 }], available: true });

  // 1. Dependency query
  const deps = T.getItemDependencies('it_paneer');
  assert.equal(deps.dishes.length, 2);
  assert.ok(deps.dishes.some(d => d.id === 'd_matar_paneer'));

  // 2. Deactivate item: marks item inactive and automatically marks dependent dishes unavailable
  const deact = T.deactivateItem('it_paneer');
  assert.equal(deact.item.active, false);
  assert.equal(deact.disabledDishes.length, 2);
  assert.equal(S.get('d_matar_paneer').available, false);
  assert.equal(S.get('d_shahi_paneer').available, false);

  // 3. Reactivate item
  const react = T.reactivateItem('it_paneer');
  assert.equal(react.item.active, true);

  // 4. Ingredient replacement in recipes: substitute it_paneer with it_tofu
  const replaced = T.replaceIngredientInDishes('it_paneer', 'it_tofu');
  assert.equal(replaced.updatedCount, 2);
  const updatedDish = S.get('d_matar_paneer');
  assert.ok(updatedDish.ingredients.some(i => i.itemId === 'it_tofu'));
  assert.ok(!updatedDish.ingredients.some(i => i.itemId === 'it_paneer'));

  // 5. When stock & purchase is turned off, can('kitchen') is false
  setupHostel('owner');
  assert.equal(T.can('kitchen'), true);
  T.Store.hostel().modules = { kitchen: false };
  assert.equal(T.can('kitchen'), false, 'When kitchen is off, can(kitchen) must be false');
});

// ============================================================================
// FEATURE 8: BANK STATEMENT IMPORT & DETERMINISTIC RECONCILIATION
// ============================================================================
test('Feature 8: Bank Statement Import & Reconciliation — parsing and deterministic multi-tier matching', () => {
  const S = T.Store;
  // Setup resident and invoice
  const res = T.checkIn({ name: 'Amit Sharma', phone: '9876500005', roomId: 'r1', bed: 'A', rent: 8000, checkIn: '2026-01-01' });
  const invoices = T.resInvoices(res.id);
  const rentInv = invoices.find(i => i.type === 'rent');

  // Sample CSV statement from HDFC / Bank
  const csvStatement = `Date,Narration,Ref/UTR,Withdrawal,Deposit,Balance
2026-01-05,UPI-AMIT SHARMA-9876500005,UTR123456789,,8000,50000
2026-01-06,UPI-UNKNOWN RESIDENT,UTR999999999,,2500,52500
2026-01-07,ELECTRICITY BILL PAYMENT,,1500,,51000`;

  // 1. Parsing
  const parsed = T.parseBankStatement(csvStatement);
  assert.equal(parsed.length, 3, 'All 3 rows should be parsed');
  const credits = parsed.filter(r => r.direction === 'CR');
  assert.equal(credits.length, 2, '2 deposit rows should be identified as credits');
  assert.equal(credits[0].utr, 'UTR123456789');
  assert.equal(credits[0].amount, 8000);
  assert.equal(credits[1].utr, 'UTR999999999');
  assert.equal(credits[1].amount, 2500);

  // 2. Multi-tier deterministic reconciliation
  const recon = T.reconcileBankStatement(credits);
  assert.equal(recon.summary.autoMatched, 1, 'Exact match on resident pending invoice amount + phone in narration');
  assert.equal(recon.summary.unmatched, 1, 'Unknown resident with no matching invoice remains unmatched in review queue');
  assert.equal(recon.matched[0].status, 'matched');
  assert.equal(recon.matched[0].resId, res.id);

  // 3. Ambiguous Narration Test: Name-only narration without phone/claim is NOT auto-confirmed
  const ambiguousStatement = `Date,Narration,Ref/UTR,Withdrawal,Deposit,Balance
2026-01-08,NEFT-AMIT SHARMA-SALARY,UTR555555555,,8000,58000`;
  const parsedAmbiguous = T.parseBankStatement(ambiguousStatement).filter(r => r.direction === 'CR');
  const reconAmbiguous = T.reconcileBankStatement(parsedAmbiguous);
  assert.equal(reconAmbiguous.summary.autoMatched, 0, 'Name-only narration without claim/phone MUST NOT auto-confirm');
  assert.equal(reconAmbiguous.summary.probable, 1, 'Name-only narration must be held in review queue as probable');
  assert.equal(reconAmbiguous.probableMatches[0].status, 'probable');

  // Verify Statement and Transaction persistence in Store
  const stmts = S.all('stmt');
  assert.ok(stmts.length > 0, 'Statement batches must be saved in Store');
  const stmtTxs = S.all('stmt_tx');
  assert.ok(stmtTxs.length > 0, 'Statement transactions must be saved in Store');

  // 4. Duplicate statement detection: reconciling statement after recorded payment marks row as already reconciled
  const secondRecon = T.reconcileBankStatement(credits);
  assert.equal(secondRecon.summary.duplicate, 1, 'Recorded UTR is identified as duplicate / already reconciled');
});

// ============================================================================
// FEATURE 9: ELECTRICITY BOUNDARIES DURING ROOM SHIFT & BED SWAP
// ============================================================================
test('Feature 9: Electricity Calculation — shiftBed settlement boundaries & atomic bed swap', () => {
  const S = T.Store;
  // Create Room 102 with 2 beds
  S.put('room', { id: 'r2', no: '102', floor: '1st', rent: 9000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });

  // Resident 1 in Room 101, Bed A
  const res1 = T.checkIn({ name: 'Deepak Kumar', phone: '9876500006', roomId: 'r1', bed: 'A', rent: 8000, checkIn: '2026-01-01' });
  // Opening reading for Room 101
  S.put('meter', { id: 'm_r1_init', roomId: 'r1', date: '2026-01-01', prev: 100, curr: 100, units: 0, opening: true });

  // 1. Shift Bed: Deepak moves to Room 102 Bed A on 2026-01-15 with old meter reading 200, new meter reading 500
  const shift = T.shiftBed(res1.id, 'r2', 'A', 9000, {
    date: '2026-01-15',
    readingOld: 200,
    readingNew: 500
  });

  assert.equal(shift.res.roomId, 'r2');
  assert.equal(shift.res.bed, 'A');
  assert.equal(shift.res.rent, 9000);
  assert.equal(shift.oldRoomSettlement.unitsConsumed, 100); // 200 - 100 = 100 units
  assert.equal(shift.oldRoomSettlement.charge, 1000); // 100 * 10 = 1000
  assert.ok(shift.electricityInvoice, 'Shift must generate electricity invoice for consumed units');
  assert.equal(shift.electricityInvoice.amount, 1000);
  assert.equal(shift.electricityInvoice.type, 'electricity');

  // Verify meter period doc generated
  const mtrDocs = S.all('mtr_period');
  assert.ok(mtrDocs.some(d => d.resId === res1.id && d.roomId === 'r1'));

  // Verify bed statuses in rooms
  assert.equal(S.get('r1').beds.find(b => b.id === 'A').status, 'vac');
  assert.equal(S.get('r2').beds.find(b => b.id === 'A').status, 'occ');

  // Error handling: shiftBed fails if transition reading is lower than previous reading
  assert.throws(() => {
    T.shiftBed(res1.id, 'r1', 'A', 8000, {
      date: '2026-01-20',
      readingOld: 400 // previous was 500
    });
  }, /Reading cannot be less than previous/);

  // 2. Bed Swap: Deepak in Room 102 Bed A swaps with Suresh in Room 101 Bed B
  const res2 = T.checkIn({ name: 'Suresh Raina', phone: '9876500007', roomId: 'r1', bed: 'B', rent: 8000, checkIn: '2026-01-10' });
  S.put('meter', { id: 'm_r1_base', roomId: 'r1', date: '2026-01-15', prev: 200, curr: 200, units: 0, opening: true });

  const swap = T.swapBeds(res1.id, res2.id, {
    date: '2026-01-25',
    readingA: 600, // Room 102 reading (was 500) -> 100 units
    readingB: 300  // Room 101 reading (was 200) -> 100 units
  });

  assert.equal(swap.residentA.roomId, 'r1');
  assert.equal(swap.residentA.bed, 'B');
  assert.equal(swap.residentB.roomId, 'r2');
  assert.equal(swap.residentB.bed, 'A');
  assert.equal(swap.settlementA.unitsConsumed, 100);
  assert.equal(swap.settlementB.unitsConsumed, 100);
  assert.ok(swap.invoiceA, 'Swap must generate electricity invoice for resident A');
  assert.equal(swap.invoiceA.amount, 1000);
  assert.ok(swap.invoiceB, 'Swap must generate electricity invoice for resident B');
  assert.equal(swap.invoiceB.amount, 1000);
});

// ============================================================================
// FEATURE 10: CLOUDFLARE WORKER ADAPTER PROTOTYPE
// ============================================================================
test('Feature 10: Cloudflare Worker Prototype — verifies request handling and route mapping', async () => {
  const cfWorkerPath = path.join(__dirname, '..', 'workers', 'cf-worker.js');
  assert.ok(fs.existsSync(cfWorkerPath), 'Cloudflare worker script workers/cf-worker.js must exist');

  const wranglerPath = path.join(__dirname, '..', 'wrangler.toml');
  assert.ok(fs.existsSync(wranglerPath), 'Cloudflare configuration wrangler.toml must exist');

  // Mock Cloudflare Worker Fetch Event
  const cfWorker = require('../workers/cf-worker.js');
  assert.ok(typeof cfWorker.fetch === 'function', 'cf-worker.js must export a fetch handler');

  // 1. CORS Preflight OPTIONS
  const preflightReq = {
    method: 'OPTIONS',
    url: 'https://hostelos.cf/api/public?sub=site',
    headers: new Map([['origin', 'https://hostelos.in']])
  };
  const preflightRes = await cfWorker.fetch(preflightReq, {}, {});
  assert.equal(preflightRes.status, 204);

  // 2. Health check route
  const healthReq = {
    method: 'GET',
    url: 'https://hostelos.cf/health',
    headers: new Map()
  };
  const healthRes = await cfWorker.fetch(healthReq, {}, {});
  assert.equal(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.equal(healthData.status, 'healthy');
  assert.equal(healthData.engine, 'Cloudflare Workers');
});

test('public submit_claim endpoint validates UTR, creates claim & admin notification', async () => {
  const { submit_claim } = require('../api/public.js')._internals;
  assert.ok(typeof submit_claim === 'function', 'submit_claim handler must exist in api/public.js');

  const H1 = '11111111-2222-4333-8444-555555555555';
  let inserted = [];
  global.fetch = async (url, opt = {}) => {
    const u = new URL(url);
    const json = (s, b) => ({ ok: s < 400, status: s, text: async () => JSON.stringify(b), json: async () => b });
    if (u.hostname === 'sb.test' && u.pathname.includes('/rest/v1/hostels')) {
      return json(200, [{ id: H1, name: 'Sunrise PG', status: 'active' }]);
    }
    if (u.hostname === 'sb.test' && u.pathname.includes('/rest/v1/docs')) {
      if ((opt.method || 'GET') === 'GET') return json(200, decodeURIComponent(u.search).includes('kind=eq.res') ? [{ data: { name: 'Asha Rao', roomId: 'room-1', status: 'active' } }] : []);
      if (opt.method === 'POST') {
        const body = JSON.parse(opt.body);
        inserted.push(...body);
        return json(201, {});
      }
    }
    return json(404, {});
  };

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
    body: { hostel_id: H1, res_id: 'res-1', amount: 8500, utr: '412345678901' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(this.body));
    }
  };

  let resCode = 200, resData = null;
  const res = {
    status(c) { resCode = c; return this; },
    json(d) { resData = d; return this; },
    setHeader() {}
  };

  await submit_claim(req, res);
  assert.equal(resCode, 200);
  assert.equal(resData.ok, true);
  assert.ok(inserted.some(row => row.kind === 'claim' && row.data.utr === '412345678901' && row.data.amount === 8500));
  assert.ok(inserted.some(row => row.kind === 'ntf' && row.data.title === 'UPI Payment to Verify'));
});
