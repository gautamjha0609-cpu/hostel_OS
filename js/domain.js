'use strict';
/* Sarvlekh business logic. Pure rules on top of Store — no DOM here except WhatsApp/URL helpers. */

/* ===================================================================== modules & roles */
const MODULES = [
  { k: 'home', l: 'Home', icon: 'home', core: true },
  { k: 'inbox', l: 'Approvals', icon: 'inbox', core: true },
  { k: 'rooms', l: 'Rooms & Beds', icon: 'bed', core: true },
  { k: 'residents', l: 'Residents', icon: 'users', core: true },
  { k: 'payments', l: 'Payments', icon: 'rupee', core: true },
  { k: 'electricity', l: 'Electricity', icon: 'bolt' },
  { k: 'mess', l: 'Mess & Menu', icon: 'utensils' },
  { k: 'kitchen', l: 'Stock & Purchase', icon: 'cart' },
  { k: 'housekeeping', l: 'Housekeeping', icon: 'broom' },
  { k: 'laundry', l: 'Laundry', icon: 'shirt' },
  { k: 'attendance', l: 'Attendance', icon: 'check' },
  { k: 'gate', l: 'Gate & Visitors', icon: 'shield' },
  { k: 'complaints', l: 'Complaints', icon: 'wrench' },
  { k: 'staff', l: 'Staff & Salary', icon: 'badge' },
  { k: 'expenses', l: 'Expenses', icon: 'wallet' },
  { k: 'notices', l: 'Notices', icon: 'megaphone' },
  { k: 'landing', l: 'Public page', icon: 'globe' },
  { k: 'reports', l: 'Reports', icon: 'chart' },
  { k: 'automation', l: 'Automation', icon: 'bot' },
  { k: 'inquiries', l: 'Inquiries', icon: 'chat' },
  { k: 'emitra', l: 'Police verification', icon: 'shield' },
  { k: 'settings', l: 'Settings', icon: 'settings', core: true },
];
const MOD = Object.fromEntries(MODULES.map(m => [m.k, m]));
// Opt-in modules are the other way round: OFF unless the platform admin switches them ON for that one hostel (modules.key === true).
// Online payments (the Cashfree gateway) is one: a hostel that has not been set up for it sees none of it.
const OPT_IN_MODULES = ['cashfree', 'pvPlatform'];
// Modules the super admin can switch off per client. Core modules are always on.
const OPTIONAL_MODULES = MODULES.filter(m => !m.core).map(m => m.k).concat(['residentApp']);
// Some modules cannot stand alone: the kitchen works out what to cook from the mess menu, and
// inquiries come from the public landing page. Switching one of those off on its own
// would leave a broken workflow, so a switch here moves its partners with it —
// on brings the things it needs, off takes the things that need it.
const MOD_DEPS = { kitchen: ['mess'], inquiries: ['landing'] };
const modNeeds = k => MOD_DEPS[k] || [];
const modNeededBy = k => Object.keys(MOD_DEPS).filter(x => MOD_DEPS[x].includes(k));
const modLabel = k => t(k === 'residentApp' ? 'Resident app' : k === 'cashfree' ? 'Online payments (Cashfree)' : k === 'pvPlatform' ? 'Police verification done by Sarvlekh team' : k === 'automation' ? 'WhatsApp bulk automation' : (MOD[k] || {}).l || k);
// Pure: takes a modules map ({laundry:false} = off, missing = on) and returns the corrected
// map plus the other switches it had to move, so the console can say what else changed.
function applyModSwitch(modules, key, on) {
  const out = { ...(modules || {}) }, changed = [];
  if (OPT_IN_MODULES.includes(key)) { if (on) out[key] = true; else delete out[key]; return { modules: out, changed }; }
  const isOn = k => out[k] !== false;
  const set = (k, v) => {
    if (isOn(k) === v) return false;
    if (v) delete out[k]; else out[k] = false;
    if (k !== key) changed.push([k, v]);
    return true;
  };
  set(key, on);
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (const k of Object.keys(MOD_DEPS)) {
      if (!isOn(k)) continue;
      for (const d of MOD_DEPS[k]) if (!isOn(d)) moved = set(on ? d : k, on) || moved;
    }
    if (!moved) break;
  }
  return { modules: out, changed };
}
const ROLES = {
  owner: { l: 'Owner', mods: MODULES.map(m => m.k) },
  manager: { l: 'Manager', mods: MODULES.map(m => m.k) },
  warden: { l: 'Warden', mods: ['home', 'inbox', 'rooms', 'residents', 'electricity', 'attendance', 'gate', 'complaints', 'notices'] },
  accountant: { l: 'Accountant', mods: ['home', 'inbox', 'residents', 'payments', 'electricity', 'expenses', 'reports'] },
  cook: { l: 'Cook', mods: ['mess', 'kitchen'] },
  housekeeping: { l: 'Housekeeping', mods: ['housekeeping'] },
  laundry: { l: 'Laundry', mods: ['laundry'] },
  guard: { l: 'Security guard', mods: ['gate', 'attendance'] },
  emitra: { l: 'E-Mitra Operator', mods: ['emitra'] },
  staff: { l: 'Staff', mods: ['complaints'] },
  resident: { l: 'Resident', mods: [] },
  super: { l: 'Super admin', mods: MODULES.map(m => m.k) },
};
const ROLE_CHOICES = ['manager', 'warden', 'accountant', 'cook', 'housekeeping', 'laundry', 'guard', 'staff', 'emitra', 'resident'];
const STAFF_ROLE_BY_DEPT = {
  Kitchen: 'cook', Housekeeping: 'housekeeping', Laundry: 'laundry', Security: 'guard',
  Office: 'manager', Warden: 'warden', Hostel: 'warden', Accounts: 'accountant', Accounting: 'accountant',
  'E-Mitra': 'emitra', Verification: 'emitra', emitra: 'emitra'
};

function isModOnHostel(mod, h = Store.hostel(), o = Store.org()) {
  if (MOD[mod] && MOD[mod].core) return true;
  if (o && o.modules && o.modules[mod] === false) return false;
  if (h && h.modules && h.modules[mod] === false) return false;
  return true;
}

function isRoleAllowed(role, h = Store.hostel(), o = Store.org()) {
  if (role === 'cook') return isModOnHostel('mess', h, o) || isModOnHostel('kitchen', h, o);
  if (role === 'housekeeping') return isModOnHostel('housekeeping', h, o);
  if (role === 'laundry') return isModOnHostel('laundry', h, o);
  if (role === 'guard') return isModOnHostel('gate', h, o) || isModOnHostel('attendance', h, o);
  if (role === 'emitra') return isModOnHostel('emitra', h, o);
  if (role === 'accountant') return isModOnHostel('expenses', h, o) || isModOnHostel('payments', h, o);
  return true;
}
const ctx = () => Store.ctx || {};
const isSuper = () => !!(Store.me && Store.me.is_super);
const isAdmin = () => ['owner', 'manager', 'super'].includes(ctx().role);
const isResident = () => ctx().role === 'resident';
// Two switches, both held by the super admin: the client's plan is the ceiling (a module they
// do not pay for is off in all their hostels), and the per-hostel switch turns it off in one
// PG only. Missing key = on, so an untouched hostel inherits everything.
function orgEnabled(mod) {
  if (OPT_IN_MODULES.includes(mod)) { const h0 = Store.hostel(); const o0 = Store.org(); return !!(h0 && h0.modules && h0.modules[mod] === true) && !(o0 && o0.modules && o0.modules[mod] === false); }
  if (MOD[mod] && MOD[mod].core) return true;
  const o = Store.org(); if (o && o.modules && o.modules[mod] === false) return false;
  const h = Store.hostel(); if (h && h.modules && h.modules[mod] === false) return false;
  return true;
}
// Final answer to "can this login see module X here?"
function can(mod) {
  const c = ctx(); if (!c.role || !orgEnabled(mod)) return false;
  if (['owner', 'manager', 'super'].includes(c.role)) return true;
  if ((c.deny || []).includes(mod)) return false;
  return (ROLES[c.role] || ROLES.staff).mods.includes(mod) || (c.perms || []).includes(mod);
}
const myMods = () => MODULES.filter(m => can(m.k)).map(m => m.k);

/* Action-level permission matrix for sensitive operations */
const ACTION_PERMS = {
  view: ['owner', 'manager', 'warden', 'accountant', 'cook', 'housekeeping', 'laundry', 'guard', 'staff', 'emitra', 'super'],
  create: ['owner', 'manager', 'warden', 'super'],
  edit: ['owner', 'manager', 'warden', 'super'],
  correct: ['owner', 'manager', 'super'],
  approve: ['owner', 'manager', 'super'],
  refund: ['owner', 'manager', 'super'],
  delete: ['owner', 'super'],
  settings: ['owner', 'super']
};
function canAction(action, mod) {
  const c = ctx();
  if (!c.role) return false;
  if (c.role === 'super' || c.role === 'owner') return true;
  if (action === 'delete' || action === 'settings') return false;
  if (['correct', 'approve', 'refund'].includes(action)) {
    return ['owner', 'manager', 'super'].includes(c.role);
  }
  const allowed = ACTION_PERMS[action] || [];
  return allowed.includes(c.role);
}

/* ===================================================================== settings & configurable business rules */

const DEFAULT_AGREEMENT_TEMPLATES = [
  {
    id: 'tpl-std',
    name: 'Standard PG / Hostel Agreement',
    type: 'pg',
    clauses: [
      'The resident agrees to pay monthly rent in advance on or before the due date.',
      'A refundable security deposit shall be held against damages, unpaid dues, or notice period shortfalls.',
      'Electricity consumption shall be calculated according to hostel meter policy and billed alongside rent.',
      'Residents shall strictly adhere to quiet hours, security protocols, and visitor policies.',
      'Notice period of the configured days is mandatory before vacating the premises.',
    ],
    houseRules: [
      'Quiet hours from 10:30 PM to 6:30 AM.',
      'Visitors permitted in common lobby only between 9:00 AM and 8:00 PM.',
      'Smoking, narcotics, and prohibited substances are strictly banned.',
      'Keep your room, washroom, and common amenities clean.',
    ],
  },
  {
    id: 'tpl-student',
    name: 'Student Hostel Agreement',
    type: 'student',
    clauses: [
      'Student hostel rules and daily evening roll call are strictly mandatory.',
      'Mess subscription is compulsory and charges are payable monthly.',
      'Parent or local guardian contact must remain active at all times.',
      'Damages to hostel property or furniture will be deducted from security deposit.',
    ],
    houseRules: [
      'Daily attendance / roll call at 9:00 PM is mandatory.',
      'Study hours to be respected during examination periods.',
      'No loud music or unauthorized electrical appliances in rooms.',
    ],
  },
  {
    id: 'tpl-coliving',
    name: 'Co-living Property Agreement',
    type: 'coliving',
    clauses: [
      'Co-living space agreement for working professionals and adult residents.',
      'High-speed Wi-Fi, housekeeping, and common area amenities included as per plan.',
      'Subletting or accommodating unauthorized overnight guests without management consent is strictly prohibited.',
    ],
    houseRules: [
      'Respect co-living community members and shared co-working spaces.',
      'Clean up kitchen/common dining utensils immediately after personal use.',
    ],
  }
];

const BUSINESS_TEMPLATES = {
  standard_pg: {
    key: 'standard_pg',
    label: 'Standard PG',
    description: 'Fixed 1st of month billing, pro-rata check-in, shared electricity meter, compulsory mess.',
    rent: { model: 'calendar_monthly', day: 1, dueDays: 5, graceDays: 5, lateFee: 200, lateOn: true, prorate: true, prorateDivisor: 'actual_days', includeElec: true, includeMess: true, includeCharges: true },
    deposit: { mode: 'rent_multiple', fixedAmount: 5000, rentMultiplier: 1, nonRefundable: 0, allowInstallments: false },
    lateFee: { on: true, mode: 'fixed', amount: 200, dailyAmount: 50, percentage: 2, maxCap: 1000, graceDays: 5 },
    elec: { sharing: 'shared_room', allocation: 'occupancy_days', rate: 9, pricing: 'fixed', fixedCharge: 0, freeUnits: 30, freeMode: 'resident', readingDay: 1 },
    mess: { billing: 'compulsory', monthlyFee: 2500, skip: true, tiffin: true, learn: true, rebatePerDay: 80 },
    checkin: { requireApproval: 'none', requireDocs: true, minDepositRequired: true, requireAgreement: true },
    checkout: { noticeDaysRequired: 30, shortfallPenalty: true, requireApproval: true, roomInspection: true },
  },
  student_hostel: {
    key: 'student_hostel',
    label: 'Student Hostel',
    description: 'Calendar monthly billing, 2 months deposit, shared room meter with room free units, compulsory mess, strict attendance.',
    rent: { model: 'calendar_monthly', day: 1, dueDays: 7, graceDays: 3, lateFee: 300, lateOn: true, prorate: true, prorateDivisor: 'actual_days', includeElec: true, includeMess: true, includeCharges: true },
    deposit: { mode: 'rent_multiple', fixedAmount: 10000, rentMultiplier: 2, nonRefundable: 500, allowInstallments: true },
    lateFee: { on: true, mode: 'daily', amount: 300, dailyAmount: 50, percentage: 3, maxCap: 1500, graceDays: 3 },
    elec: { sharing: 'shared_room', allocation: 'occupancy_days', rate: 8.5, pricing: 'fixed', fixedCharge: 50, freeUnits: 60, freeMode: 'room', readingDay: 1 },
    mess: { billing: 'compulsory', monthlyFee: 3000, skip: true, tiffin: true, learn: true, rebatePerDay: 100 },
    checkin: { requireApproval: 'manager', requireDocs: true, minDepositRequired: true, requireAgreement: true },
    checkout: { noticeDaysRequired: 30, shortfallPenalty: true, requireApproval: true, roomInspection: true },
  },
  working_pg: {
    key: 'working_pg',
    label: 'Working Professionals PG',
    description: 'Joining-date anniversary billing, 1 month deposit, optional mess, individual/shared meters, 15 days notice.',
    rent: { model: 'joining_date', day: 1, dueDays: 5, graceDays: 5, lateFee: 250, lateOn: true, prorate: true, prorateDivisor: 'actual_days', includeElec: true, includeMess: true, includeCharges: true },
    deposit: { mode: 'rent_multiple', fixedAmount: 8000, rentMultiplier: 1, nonRefundable: 0, allowInstallments: false },
    lateFee: { on: true, mode: 'percentage', amount: 250, dailyAmount: 50, percentage: 2, maxCap: 1000, graceDays: 5 },
    elec: { sharing: 'shared_room', allocation: 'occupancy_days', rate: 9.5, pricing: 'fixed', fixedCharge: 0, freeUnits: 25, freeMode: 'resident', readingDay: 1 },
    mess: { billing: 'optional', monthlyFee: 2800, skip: true, tiffin: true, learn: true, rebatePerDay: 90 },
    checkin: { requireApproval: 'none', requireDocs: true, minDepositRequired: false, requireAgreement: true },
    checkout: { noticeDaysRequired: 15, shortfallPenalty: true, requireApproval: false, roomInspection: true },
  },
  coliving: {
    key: 'coliving',
    label: 'Co-living Property',
    description: 'Calendar monthly, slab-based electricity pricing, per-meal/optional mess, amenities fees, digital check-in.',
    rent: { model: 'calendar_monthly', day: 1, dueDays: 5, graceDays: 5, lateFee: 500, lateOn: true, prorate: true, prorateDivisor: 'actual_days', includeElec: true, includeMess: true, includeCharges: true },
    deposit: { mode: 'fixed', fixedAmount: 15000, rentMultiplier: 1, nonRefundable: 1000, allowInstallments: false },
    lateFee: { on: true, mode: 'percentage', amount: 500, dailyAmount: 100, percentage: 5, maxCap: 2500, graceDays: 5 },
    elec: { sharing: 'shared_room', allocation: 'occupancy_days', rate: 10, pricing: 'slab', slabs: [{ upTo: 100, rate: 8 }, { upTo: 250, rate: 10 }, { upTo: 999999, rate: 12 }], fixedCharge: 100, freeUnits: 0, freeMode: 'resident', readingDay: 1 },
    mess: { billing: 'per_meal', monthlyFee: 3500, mealRates: { breakfast: 50, lunch: 90, snacks: 40, dinner: 90 }, skip: true, tiffin: true, learn: true, rebatePerDay: 120 },
    checkin: { requireApproval: 'manager', requireDocs: true, minDepositRequired: true, requireAgreement: true },
    checkout: { noticeDaysRequired: 30, shortfallPenalty: true, requireApproval: true, roomInspection: true },
  },
  custom: {
    key: 'custom',
    label: 'Custom Setup',
    description: 'Custom hostel business configuration tailored to specific property rules.',
  }
};

const DEFAULT_SETTINGS = {
  pay: { upiId: '', payee: '', phone: '', bank: '', note: '', provider: 'direct_upi', email: '' },
  rent: {
    model: 'calendar_monthly', // 'calendar_monthly' | 'joining_date' | 'custom'
    day: 1,
    dueDays: 5,
    graceDays: 5,
    lateFee: 200,
    lateOn: true,
    prorate: true,
    prorateDivisor: 'actual_days', // 'actual_days' | 'fixed_30'
    includeElec: true,
    includeMess: true,
    includeCharges: true,
  },
  deposit: {
    mode: 'custom', // 'fixed' | 'rent_multiple' | 'per_bed' | 'custom'
    fixedAmount: 0,
    rentMultiplier: 1,
    nonRefundable: 0,
    allowInstallments: false,
    minCheckInDeposit: 0,
  },
  lateFee: {
    on: true,
    mode: 'fixed', // 'fixed' | 'daily' | 'percentage'
    amount: 200,
    dailyAmount: 50,
    percentage: 2,
    maxCap: 1000,
    graceDays: 5,
  },
  elec: {
    sharing: 'shared_room', // 'shared_room' | 'individual' | 'property_level'
    allocation: 'occupancy_days', // 'occupancy_days' | 'equal' | 'room_alloc'
    rate: 9,
    pricing: 'fixed', // 'fixed' | 'slab'
    slabs: [{ upTo: 100, rate: 8 }, { upTo: 250, rate: 10 }, { upTo: 999999, rate: 12 }],
    fixedCharge: 0,
    freeUnits: 30,
    freeMode: 'resident', // 'resident' | 'room'
    readingDay: 1,
    requireApproval: false,
    scanRole: 'both', // 'both' | 'staff_only' | 'resident_only'
  },
  laundry: { freePcs: 30, rate: 10 },
  meals: [
    { k: 'breakfast', l: 'Breakfast', time: '08:00', cutoff: '22:00', prev: true, tCutoff: '21:00', tPrev: true },
    { k: 'lunch', l: 'Lunch', time: '13:00', cutoff: '10:00', prev: false, tCutoff: '09:30', tPrev: false },
    { k: 'dinner', l: 'Dinner', time: '20:30', cutoff: '17:00', prev: false, tCutoff: '16:00', tPrev: false },
  ],
  mess: {
    plates: false,   // show "Mark plates served" and "Guests" on the cooking plan (off unless the hostel counts plates)
    billing: 'included', // 'included' | 'compulsory' | 'optional' | 'per_meal'
    monthlyFee: 2500,
    mealRates: { breakfast: 40, lunch: 70, snacks: 30, dinner: 70 },
    rebatePerDay: 80,
    minLeaveDays: 2,
    skip: true,
    tiffin: true,
    learn: true,
  },
  charges: [],
  checkin: {
    requireApproval: 'none', // 'none' | 'owner' | 'manager'
    requireDocs: false,
    minDepositRequired: false,
    requireAgreement: false,
  },
  checkout: {
    noticeDaysRequired: 30,
    shortfallPenalty: true,
    shortfallMode: 'rent',   // 'rent' = rent of the missing days | 'per_day' = shortfallAmount per missing day | 'flat' = shortfallAmount once
    shortfallAmount: 0,
    requireApproval: false,
    scanRole: 'both', // 'both' | 'staff_only' | 'resident_only'
    roomInspection: true,
  },
  agreements: {
    templates: DEFAULT_AGREEMENT_TEMPLATES,
    defaultTemplateId: 'tpl-std',
  },
  kitchen: { cookCanReceive: true },
  docs: { required: ['Aadhaar card', 'Passport photo'] },
  staffDocs: { required: ['Aadhaar card', 'Passport photo'] },
  // remind: automatic payment reminders, N days after the oldest unpaid bill was due.
  // gw: on/off marker for the owner's self-hosted gateway (the secrets live server-side).
  wa: {
    auto: true,
    lang: 'en',
    tpl: {},
    remind: { on: true, days: [1, 5, 10] },
    // channel: how the monthly bill goes out in bulk - 'whatsapp' | 'email' | 'both' | 'off' (set by the platform admin).
    // A single message (a reminder, an admission) is always sent one at a time by the owner, whatever this says.
    monthly: { on: true, fallbackDay: 10, template: '', language: 'en', channel: 'whatsapp' },
    gw: { on: false, kind: '' },
    mode: 'click_to_chat', // 'click_to_chat' | 'official_api'
  },
  expenseCats: ['Groceries', 'Vegetables & milk', 'Gas', 'Electricity bill', 'Water', 'Internet', 'Salary', 'Maintenance', 'Cleaning supplies', 'Rent', 'Other'],
  departments: ['Kitchen', 'Housekeeping', 'Laundry', 'Security', 'Maintenance', 'Office', 'Warden', 'Accounts', 'E-Mitra'],
  units: ['kg', 'g', 'L', 'ml', 'pcs', 'pkt', 'dozen'],
  // Things handed to a resident with the bed (mattress, keys...). Each hostel can switch the checklist off
  // and edit the list; what was given is ticked at check-in and checked again at checkout.
  accessories: { on: true, items: ['Mattress', 'Pillow', 'Bed sheet', 'Room key', 'Almirah key', 'Study table', 'Chair', 'Fan / light working'] },
  auto: { rent: true, hk: true, missed: true, stock: true, lowstock: true, meter: true, checkout: true },
  // markBy: who may mark a room cleaned — 'staff' (the assigned housekeeper), 'admin'
  // (owner/manager), 'guard' (supervisor on duty), 'resident' (someone living in that room).
  hk: { missedAfter: '19:00', markBy: ['staff', 'admin'] },
  // Staff attendance: 'manual' (owner marks), 'self' (staff punch in from their phone) or 'both'.
  // With lat/lng set, a punch-in counts only within radius metres of that point.
  staffAtt: { mode: 'manual', lat: '', lng: '', radius: 150 },
  // The registration QR a new resident scans. `key` is minted on first use and can be
  // regenerated, which kills every copy already handed out.
  join: { on: true, key: '' },
  // Resident roll call. Hostels that do not take one switch it off and the module disappears.
  // `periods` is the list of roll calls in a day — one by default, as many as the owner wants.
  attend: { on: true, periods: [{ k: 'night', l: 'Night roll call', time: '21:00' }] },
  /* The hostel's public one-pager — the link an owner sends to a parent who asks "what is
   * your PG like?". Off until the owner fills it in and switches it on, and the module itself
   * is the platform admin's to give, so this is not something every client gets by default.
   * `wa` is the number an enquiry opens a WhatsApp chat with; blank means the hostel phone. */
  site: { on: false, slug: '', headline: '', sub: '', badge: '', tagline: '', about: '', aboutTitle: '', facilities: [], roomTypes: [], area: '', address: '', mapUrl: '', mapLatLng: '', wa: '', callNo: '', ratingScore: '', ratingText: '', stats: [], faq: [], photos: {} },
  // Tenant police verification. `state` picks the default portal; `portals` may be edited by
  // the owner because each state runs its own site and the deep links change without notice.
  police: { on: true, state: '', portals: {}, dueDays: 7, blockWithoutId: false },
};

let _setCache = { srcH: null, srcO: null, val: null };
function S(hostelId, resId) {
  const h = hostelId ? ((Store.hostels || []).find(x => x.id === hostelId) || null) : Store.hostel();
  const o = h ? ((Store.orgs || []).find(x => x.id === h.org_id) || null) : Store.org();
  const srcH = (h || {}).settings || {};
  const srcO = (o || {}).settings || {};
  if (!hostelId && !resId && _setCache.srcH === srcH && _setCache.srcO === srcO) {
    return _setCache.val;
  }
  const merged = deepMerge(DEFAULT_SETTINGS, deepMerge(srcO, srcH));
  if (resId) {
    const r = resById(resId);
    if (r && r.billingPolicy) {
      return deepMerge(merged, r.billingPolicy);
    }
  }
  if (!hostelId && !resId) {
    _setCache = { srcH, srcO, val: merged };
  }
  return merged;
}

function effectiveSettings(hostelId, resId) {
  const h = hostelId ? ((Store.hostels || []).find(x => x.id === hostelId) || null) : Store.hostel();
  const o = h ? ((Store.orgs || []).find(x => x.id === h.org_id) || null) : Store.org();
  const r = resId ? resById(resId) : null;
  const cfg = S(hostelId, resId);
  return {
    settings: cfg,
    version: (h && h.settings && h.settings.policyVersion) || 1,
    effectiveDate: (h && h.settings && h.settings.effectiveDate) || (h && h.created_at) || today(),
    hierarchy: {
      platform: 'DEFAULT_SETTINGS',
      organization: o ? o.name : null,
      hostel: h ? h.name : null,
      resident: r ? r.name : null,
      hasOrgOverrides: !!(o && o.settings && Object.keys(o.settings).length),
      hasHostelOverrides: !!(h && h.settings && Object.keys(h.settings).length),
      hasResidentExceptions: !!(r && r.billingPolicy && Object.keys(r.billingPolicy).length)
    }
  };
}

function applyBusinessTemplate(templateKey) {
  const tpl = BUSINESS_TEMPLATES[templateKey];
  if (!tpl) throw new AppError('Unknown business template: ' + templateKey);
  const curVer = ((Store.hostel() || {}).settings && Store.hostel().settings.policyVersion) || 1;
  return {
    businessTemplate: templateKey,
    policyVersion: curVer + 1,
    effectiveDate: today(),
    rent: clone(tpl.rent || {}),
    deposit: clone(tpl.deposit || {}),
    lateFee: clone(tpl.lateFee || {}),
    elec: clone(tpl.elec || {}),
    mess: clone(tpl.mess || {}),
    checkin: clone(tpl.checkin || {}),
    checkout: clone(tpl.checkout || {})
  };
}
// Meals are always shown in serving-time order, whatever order they were added in.
const byTime = ms => ms.slice().sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
let _mealsCache = { src: null, val: [] };
const meals = () => { const src = S().meals; if (_mealsCache.src !== src) _mealsCache = { src, val: byTime(src) }; return _mealsCache.val; };
const mealByKey = k => meals().find(m => m.k === k) || { k, l: k };
const mealName = k => t(mealByKey(k).l);
/* Day-wise meals (Weekly menu > the clock on a day): each weekday can switch a meal off (Sunday: no breakfast) or serve it at
 * its own time (Sunday breakfast at 10:00) without touching the other days. Kept in settings.mealDays[weekday][meal] and shared
 * by every week of the rotating menu. */
const mealDayCfg = (day, k) => (((S().mealDays || {})[day] || {})[k]) || {};
const mealServedDay = (day, k) => !mealDayCfg(day, k).off;
const mealTimeDay = (day, k) => mealDayCfg(day, k).time || mealByKey(k).time;
const mealServed = (date, k) => mealServedDay(parse(date).getDay(), k);
const mealsOn = date => meals().filter(m => mealServed(date, m.k)).map(m => ({ ...m, time: mealTimeDay(parse(date).getDay(), m.k) }));

/* ===================================================================== documents
 * ID papers stay private (see Files in data.js); each Open mints a ten-minute link. */
function docOpen(d, resId = null) {
  const resAttr = resId ? ` data-res="${esc(resId)}"` : '';
  const typeAttr = d && d.type ? ` data-type="${esc(d.type)}"` : '';
  return d && d.path ? `<button class="btn sm" data-act="opendoc" data-path="${esc(d.path)}"${resAttr}${typeAttr}>${esc(t('Open'))}</button>` : badge('Missing', 'warn');
}
// Papers of someone who left are deleted DOC_KEEP_DAYS after the day they left.
const docsGoneOn = r => (r && r.status === 'left' && r.left ? addDays(r.left, DOC_KEEP_DAYS) : '');

/* ===================================================================== police verification
 * Indian law makes the landlord responsible for getting a tenant verified by the local
 * police. There is no public API for this anywhere in India — every state runs its own web
 * portal, the deep links move, and some still want a signed paper form. So this module does
 * the three things software honestly can:
 *   1. open the right portal for the hostel's state, with the resident's details ready to paste,
 *   2. track where each resident stands (not started → submitted → verified),
 *   3. keep the acknowledgement and the certificate with that resident's documents.
 * Nothing here pretends to submit the form for the owner.
 */
// [code, name, link, kind]. kind 'form' = the tenant-verification page itself; 'portal' = the
// state's citizen-services portal (log in, then Tenant verification); 'national' = no state
// portal known, so the national CCTNS citizen portal. Owners can override any link in Settings.
//
// Every link here was fetched and answered 200 on 2026-11-01. Deep links into these sites are
// deliberately NOT used unless the page itself was confirmed: states move them without notice
// and a 404 is worse than one extra click. Rajasthan, for one, is a single-page app that
// quietly redirects every unknown path back to its dashboard, so a saved deep link looks fine
// in a test and sends the owner nowhere. Two sites are reachable but serve a certificate for
// the wrong host (hppolice.gov.in presents *.hp.gov.in) or an expired one (tnpolice.gov.in);
// where a clean alternative existed it is used here, and where it did not the official address
// is kept, because sending the owner to the right place beats sending them somewhere tidy.
// If a link breaks, the owner pastes the right one in Settings -> Police verification and it
// wins over this list for their hostel.
const PV_NATIONAL = 'https://digitalpolice.gov.in/';
const PV_STATES = [
  ['AN', 'Andaman & Nicobar', PV_NATIONAL, 'national'],
  ['AP', 'Andhra Pradesh', 'https://citizen.appolice.gov.in/', 'portal'],
  ['AR', 'Arunachal Pradesh', PV_NATIONAL, 'national'],
  ['AS', 'Assam', 'https://police.assam.gov.in/', 'portal'],
  ['BR', 'Bihar', 'https://police.bihar.gov.in/', 'portal'],
  ['CH', 'Chandigarh', 'https://chandigarhpolice.gov.in/', 'portal'],
  ['CG', 'Chhattisgarh', 'https://cgpolice.gov.in/', 'portal'],
  ['DD', 'Dadra & Nagar Haveli and Daman & Diu', PV_NATIONAL, 'national'],
  ['DL', 'Delhi', 'https://cctns.delhipolice.gov.in/citizenservices/', 'form'],
  ['GA', 'Goa', 'https://citizen.goapolice.gov.in/', 'portal'],
  ['GJ', 'Gujarat', 'https://police.gujarat.gov.in/', 'portal'],
  ['HR', 'Haryana', 'https://haryanapolice.gov.in/', 'portal'],
  ['HP', 'Himachal Pradesh', 'https://himachal.nic.in/police', 'portal'],
  ['JK', 'Jammu & Kashmir', 'https://jkpolice.gov.in/', 'portal'],
  ['JH', 'Jharkhand', 'https://jhpolice.gov.in/', 'portal'],
  ['KA', 'Karnataka', 'https://ksp.karnataka.gov.in/', 'portal'],
  ['KL', 'Kerala', 'https://thuna.keralapolice.gov.in/', 'portal'],
  ['LA', 'Ladakh', PV_NATIONAL, 'national'],
  ['LD', 'Lakshadweep', PV_NATIONAL, 'national'],
  ['MP', 'Madhya Pradesh', 'https://citizen.mppolice.gov.in/', 'portal'],
  ['MH', 'Maharashtra', 'https://citizen.mahapolice.gov.in/Citizen/MH/index.aspx', 'portal'],
  ['MN', 'Manipur', PV_NATIONAL, 'national'],
  ['ML', 'Meghalaya', 'https://megpolice.gov.in/', 'portal'],
  ['MZ', 'Mizoram', PV_NATIONAL, 'national'],
  ['NL', 'Nagaland', PV_NATIONAL, 'national'],
  ['OD', 'Odisha', 'https://police.odisha.gov.in/', 'portal'],
  ['PY', 'Puducherry', PV_NATIONAL, 'national'],
  ['PB', 'Punjab', 'https://ppsaanjh.in/', 'portal'],
  ['RJ', 'Rajasthan', 'https://police.rajasthan.gov.in/', 'portal'],
  ['SK', 'Sikkim', PV_NATIONAL, 'national'],
  ['TN', 'Tamil Nadu', 'https://eservices.tnpolice.gov.in/CCTNSNICSDC/Index?0', 'form'],
  ['TS', 'Telangana', 'https://www.tspolice.gov.in/', 'portal'],
  ['TR', 'Tripura', 'https://police.tripura.gov.in/', 'portal'],
  ['UP', 'Uttar Pradesh', 'https://uppolice.gov.in/', 'portal'],
  ['UK', 'Uttarakhand', 'https://uttarakhandpolice.uk.gov.in/', 'portal'],
  ['WB', 'West Bengal', 'https://wbpolice.gov.in/', 'portal'],
  ['OTHER', 'Other / set my own link', '', 'portal'],
];
const PV_STATUS = {
  none: ['Not started', 'bad'],
  submitted: ['Submitted', 'warn'],
  verified: ['Verified', 'ok'],
  rejected: ['Rejected', 'bad'],
  exempt: ['Not required', 'mute'],
};
const PV_DOC_TYPES = ['Police verification acknowledgement', 'Police verification certificate'];

const pvOn = () => S().police.on !== false;
const pvOf = r => (r && r.pv) || { status: 'none' };
// The owner's own link wins over the built-in one, so a changed state portal is a settings edit.
function pvPortal(state) {
  const st = state || S().police.state || '';
  const custom = (S().police.portals || {})[st];
  if (custom) return custom;
  const row = PV_STATES.find(x => x[0] === st);
  return (row && row[2]) || '';
}
const pvStateName = st => { const r = PV_STATES.find(x => x[0] === (st || S().police.state)); return r ? r[1] : ''; };
const hostelName = () => (Store.hostel() || {}).name || '';
if (typeof window !== 'undefined') window.hostelName = hostelName;

// Everything the portal form asks for, in one block the owner can paste field by field.
function pvDetails(r) {
  const h = Store.hostel() || {};
  return [
    [t('Name'), r.name],
    [t('Mobile'), r.phone || ''],
    [t('Parent / guardian'), r.guardian || ''],
    [t('Guardian mobile'), r.guardianPhone || ''],
    [t('ID number (Aadhaar etc.)'), r.idNo || ''],
    [t('Permanent address'), r.address || ''],
    [t('College / office'), r.college || ''],
    [t('Present address'), [h.name, roomName(r.roomId) ? t('Room') + ' ' + roomName(r.roomId) : '', h.address, h.city].filter(Boolean).join(', ')],
    [t('Stay from'), fmtDate(r.checkIn)],
    [t('Landlord'), (h.settings && h.settings.pay && h.settings.pay.payee) || h.name || ''],
  ].filter(x => x[1]);
}
const pvDetailsText = r => pvDetails(r).map(([k, v]) => k + ': ' + v).join(String.fromCharCode(10));

// Overdue = still not submitted N days after check-in. Drives the reminder in Approvals.
function pvDue(r) {
  if (!pvOn() || !r || r.status === 'left') return false;
  const st = pvOf(r).status;
  if (st === 'verified' || st === 'exempt' || st === 'submitted') return false;
  return diffDays(today(), r.checkIn) >= (S().police.dueDays || 7);
}
const pvPending = () => activeRes().filter(pvDue).sort((a, b) => a.checkIn.localeCompare(b.checkIn));

function pvSet(resId, patch) {
  const r = resById(resId); if (!r) return null;
  const pv = { ...pvOf(r), ...patch };
  if (patch.status && patch.status !== pvOf(r).status) pv.changedOn = today();
  Store.patch(resId, { pv });
  if (patch.status) alog('pv', t('Police verification for {n}: {s}', { n: r.name, s: t(PV_STATUS[patch.status] ? PV_STATUS[patch.status][0] : patch.status) }));
  try {
    if (typeof checkAndAutoSendAgreement === 'function') {
      checkAndAutoSendAgreement(resId);
    }
  } catch (err) {
    console.warn('Auto agreement trigger in pvSet warning:', err.message);
  }
  return pv;
}

/* ===================================================================== self check-in
 * The owner prints (or WhatsApps) one QR. A new resident scans it, fills in who they are on
 * their own phone and uploads their papers. What arrives is an APPLICATION, not a tenancy:
 * a `signup` row with no room, no rent and no deposit, because whoever holds the QR must not
 * be able to give themselves a bed or decide what they pay. The owner reads it, picks the
 * bed and the rent, and admits it — only then does a resident exist.
 */
const joinOn = () => (S().join || {}).on !== false;
const accOn = () => (S().accessories || {}).on !== false && accItems().length > 0;
const accItems = () => ((S().accessories || {}).items || []).filter(Boolean);
const joinKey = () => (S().join || {}).key || '';
// 24 url-safe random characters: the secret in a printed QR (self check-in and visitor entry).
const newQrKey = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
function joinUrl() {
  const h = Store.hostel() || {};
  const q = new URLSearchParams({ h: h.id || '', k: joinKey(), n: h.name || '' });
  if (S().police.state) q.set('s', S().police.state);
  return new URL(`/join.html?${q}`, location.origin).href;
}
const signups = () => Store.all('signup');
const pendingSignups = () => signups().filter(x => x.status !== 'admitted' && x.status !== 'rejected').sort(by('ts', -1));

// Turning an application into a resident. Everything the applicant typed is carried over;
// everything about money and the bed comes from the owner, here and nowhere else.
function admitSignup(signupId, { roomId, bed, rent, deposit, checkIn: from = today(), firstRent, food = true, accessories = null }) {
  const a = Store.get(signupId); if (!a) throw new AppError('Application not found');
  if (a.status === 'admitted') throw new AppError('This application is already admitted');
  const r = checkIn({
    name: a.name, phone: a.phone, guardian: a.guardian, guardianPhone: a.guardianPhone,
    email: a.email, idNo: a.idNo, address: a.address, college: a.college, lang: a.lang,
    roomId, bed, rent, deposit, checkIn: from, food, accessories, ...(firstRent != null ? { firstRent } : {}),
  });
  // the papers they uploaded move with them, so nobody re-asks for an Aadhaar already on file
  if ((a.docs || []).length) Store.patch(r.id, { docs: a.docs.map(d => ({ ...d })) });
  // credit a verification the resident did themselves; the owner can still change it
  if (a.pv && (a.pv.self || a.pv.refNo)) {
    pvSet(r.id, {
      status: a.pv.refNo ? 'submitted' : 'none', refNo: a.pv.refNo || '', state: a.pv.state || '',
      submittedOn: a.pv.refNo ? (a.date || today()) : null, note: t('Filed by the resident at registration')
    });
  }
  Store.patch(signupId, { status: 'admitted', resId: r.id, admittedOn: today(), admittedBy: Store.me && Store.me.full_name });
  try { checkAndAutoSendAgreement(r.id); } catch (e) { /* the owner can still send it by hand from the resident page */ }
  alog('signup', t('{n} admitted from a self check-in', { n: a.name }));
  return r;
}
function rejectSignup(signupId, why = '') {
  const a = Store.get(signupId); if (!a) return null;
  Store.patch(signupId, { status: 'rejected', why, rejectedOn: today() });
  return Store.get(signupId);
}

/* ===================================================================== blocks
 * One hostel, several wings: Block A, Block B, Annexe. The platform admin creates them (they
 * sit on the hostel row next to `modules`), and the only place a block is ever stored is on a
 * ROOM. A resident's block is read back from the room they sleep in, a payment's block from
 * the resident, and so on down the chain — nothing is copied, so nothing can fall out of step
 * when somebody shifts bed 101-A to 204-C.
 *
 * Filtering works the same way. Rather than a block picker on every screen, there is one
 * scope at the top of the app; `rooms()` and `residents()` honour it, and because every other
 * list in this file is built from those two, the whole app narrows at once. Head counts,
 * bills and the platform's own billing are unaffected: those run inside withAllBlocks().
 */
const hostelBlocks = () => (Store.hostel() || {}).blocks || [];
const blocksOn = () => hostelBlocks().length > 0;
const blockName = k => (hostelBlocks().find(b => b.k === k) || {}).l || t('No block');
// A room whose block was deleted counts as unassigned rather than vanishing from every list.
const roomBlock = r => (r && r.block && hostelBlocks().some(b => b.k === r.block) ? r.block : '');
const resBlock = r => roomBlock(Store.get(r && r.roomId));
// Blocks list in the order the platform admin arranged them; anything unassigned sits last.
const blockOrder = k => { const i = hostelBlocks().findIndex(b => b.k === k); return i < 0 ? 999 : i; };

let _scope = '';        // '' = everything, '-' = rooms with no block, otherwise a block key
let _scopeOff = 0;      // >0 while a whole-hostel calculation is running
/* A scope that no longer exists — the hostel has no blocks, or the platform admin deleted
 * the one that was chosen — means "show everything", never "show nothing". An app that opens
 * empty because of a stale setting looks to the owner exactly like lost data. */
function blockScope() {
  if (_scopeOff || !blocksOn()) return '';
  const k = ctx().block || _scope;
  return k === '-' || hostelBlocks().some(b => b.k === k) ? k : '';
}
function setBlockScope(k) { _scope = k || ''; }
// Billing, automation and backups must always see the whole hostel, whatever the owner is
// looking at. Anything that charges money or exports data runs inside this.
function withAllBlocks(fn) { _scopeOff++; try { return fn(); } finally { _scopeOff--; } }
const inScope = room => { const b = blockScope(); return !b || (b === '-' ? !roomBlock(room) : roomBlock(room) === b); };
const resInScope = r => inScope(Store.get(r && r.roomId));
// Money follows the person, not the room they happened to be in when they paid: a resident
// who moved from Block A to Block B takes their whole payment history with them.
const payInScope = p => resInScope(Store.get(p && p.resId));
// Payments narrowed to the chosen block. Expenses have no resident and stay hostel-wide —
// gas, salaries and the internet bill are not a wing's to carry.
const payments = () => { const b = blockScope(); const a = Store.all('pay').filter(p => !p.reversed); return b ? a.filter(payInScope) : a; };

/* ===================================================================== derived indexes
 * "What does this resident owe?" used to walk every invoice in the hostel. Asked once per row
 * of a 100-person list that is 100 full scans per render, and it was the single heaviest
 * thing the app did. These indexes are built once and thrown away the moment Store.ver moves,
 * so they can never go stale and cost nothing on a screen that does not use them.
 */
let _ix = { v: -1, m: new Map() };
function index(key, build) {
  if (_ix.v !== Store.ver) _ix = { v: Store.ver, m: new Map() };
  if (!_ix.m.has(key)) _ix.m.set(key, build());
  return _ix.m.get(key);
}
function groupIndex(key, kind, field, sortBy) {
  return index(key, () => {
    const m = new Map();
    for (const d of Store.all(kind)) { const k = d[field]; let a = m.get(k); if (!a) m.set(k, a = []); a.push(d); }
    if (sortBy) for (const a of m.values()) a.sort(sortBy);
    return m;
  });
}

/* ===================================================================== public page
 * One page, no login, nothing to install: photos, facilities, what a bed costs, where it is,
 * the questions every parent asks, and an enquiry form that lands in the owner's WhatsApp.
 *
 * Enquiries are deliberately NOT stored. A public form that writes to the database is a
 * public form that can be filled ten thousand times by a script; handing the message straight
 * to WhatsApp costs nothing to run, cannot be spammed into our storage, and puts the lead
 * where the owner already answers people.
 *
 * Nor are photos. The hostel keeps its pictures where it already keeps them — a shared Google
 * Drive folder, or anywhere else that hands out a public image link — and we store the link,
 * about eighty characters. Holding the pictures themselves would mean carrying a megabyte per
 * hostel in a 500 MB database, syncing it to every phone that opens the app, and paying to
 * serve it; a link costs none of that and the owner can swap a photo without touching us.
 *
 * The slots are FIXED and the same for every hostel: a logo, the header picture, the
 * "about us" picture and six gallery pictures. That is the whole point — the owner never
 * designs a page, they fill labelled boxes, and every hostel's page comes out looking like the
 * same product.
 */
const SITE_PHOTOS = [
  ['logo', 'Logo', 'A square picture, shown at the top left. Optional.'],
  ['hero', 'Header photo', 'The big picture behind the top of the page. Use a wide, bright photo of a room or the building.'],
  ['about', 'About us photo', 'Shown beside your description. The front of the building works well.'],
  ['g1', 'Gallery photo 1', 'A room: beds made, curtains open.'],
  ['g2', 'Gallery photo 2', 'Mess / dining. A served plate works better than an empty hall.'],
  ['g3', 'Gallery photo 3', 'Bathroom. Clean and dry; parents look for this one.'],
  ['g4', 'Gallery photo 4', 'Common or study area.'],
  ['g5', 'Gallery photo 5', ''],
  ['g6', 'Gallery photo 6', ''],
];
// Pages saved before these slots existed used six other names. They keep showing until the
// owner puts a picture in the new slot, which then replaces the old one.
const SITE_PHOTO_OLD = { hero: 'cover', about: 'outside', g1: 'room', g2: 'mess', g3: 'bath', g4: 'common' };

/* Turning whatever the owner pasted into something an <img> can actually load.
 * A Google Drive "share" link points at Drive's own viewer page, not at the picture, so
 * pasting it straight in shows nothing. The file id inside it is what matters; Drive's
 * thumbnail endpoint serves that id as a real image at a size we ask for, and unlike the old
 * `uc?export=view` address it does not bounce large files through a confirmation page.
 * Anything that is already a plain image URL is left exactly as it was. */
const DRIVE_ID = /(?:drive\.google\.com\/(?:file\/d\/|(?:uc|open|thumbnail)\?(?:[^\s]*&)?id=)|lh3\.googleusercontent\.com\/d\/)([\w-]{16,})/;
function imgUrl(raw, width = 1600) {
  const u = String(raw || '').trim();
  if (!u) return '';
  const m = u.match(DRIVE_ID);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${width}`;
  return /^https?:\/\//i.test(u) ? u : '';
}
// What the owner typed is kept as typed, so they can see and re-copy their own link later.
const sitePhotoRaw = k => { const p = siteCfg().photos || {}; return String(p[k] || p[SITE_PHOTO_OLD[k]] || '').trim(); };
const sitePhotoUrl = (k, w) => imgUrl(sitePhotoRaw(k), w);
// Extra gallery pictures are further slots g7, g8 ... (links, like the others). One more can always be added, up to the limit.
const SITE_GALLERY_MAX = 24;
const siteGalleryKeys = () => { const p = siteCfg().photos || {}, extra = Object.keys(p).filter(k => /^g(\d+)$/.test(k) && +k.slice(1) > 6 && String(p[k] || '').trim()).sort((a, b) => +a.slice(1) - +b.slice(1)); return ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', ...extra]; };
const siteNextPhotoKey = () => { const p = siteCfg().photos || {}; for (let n = 7; n <= SITE_GALLERY_MAX; n++) if (!String(p['g' + n] || '').trim()) return 'g' + n; return null; };
const sitePhotos = () => [...SITE_PHOTOS.map(([k]) => k).filter(k => !/^g\d+$/.test(k)), ...siteGalleryKeys()].map(k => sitePhotoUrl(k)).filter(Boolean);

const siteCfg = () => S().site;
const siteLive = () => orgEnabled('landing') && siteCfg().on === true;
const siteWa = () => phone10(siteCfg().wa) || phone10(S().pay.phone) || '';

/* The address people are given. In production that is the hostel's own name on our domain —
 * sarvlekh.in/h/sunrise-boys-pg — which is why PUBLIC_SITE_BASE lives in config rather than
 * being guessed from wherever the app happens to be open. Without it (local, demo) the page
 * is still reachable by hostel id, so nothing depends on the domain being set up first. */
// The app's own slug() joins words with dots, which reads badly in a web address; a hostel's
// public link should look like sunrise-boys-pg, the way every other site on the internet does.
const siteSlugify = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '');
const siteSlug = () => (siteCfg().slug || '').trim() || siteSlugify((Store.hostel() || {}).name);
const siteBase = () => String(CFG.PUBLIC_SITE_BASE || '').replace(/\/+$/, '');
// With PUBLIC_SITE_DOMAIN set, a hostel's page is <its name>.<domain> (npm run domain -- sarvlekh.in).
const siteDomain = () => String(CFG.PUBLIC_SITE_DOMAIN || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
// Names that are the app, mail, the API...: never a hostel's address. Same list as api/_lib.js and scripts/set-domain.js.
const SITE_RESERVED = ['www', 'app', 'admin', 'api', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'dashboard', 'login', 'support', 'help', 'blog', 'docs', 'status', 'staging', 'test', 'dev', 'h', 'join', 'visit', 'pay', 'site', 'public', 'ns1', 'ns2', 'hostel'];
const siteSlugProblem = sl => !/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(sl) ? 'The web address can only use lowercase letters, numbers and dashes' : SITE_RESERVED.includes(sl) ? 'This name is kept for Sarvlekh itself. Choose another.' : '';
function siteUrl() {
  const base = siteBase(), sl = siteSlug(), dom = siteDomain();
  if (dom && sl && !siteSlugProblem(sl)) return `https://${sl}.${dom}`;
  if (base && sl) return `${base}/h/${sl}`;
  return new URL(`/site.html?h=${encodeURIComponent((Store.hostel() || {}).id || '')}`, location.origin).href;
}
// What is still missing before this is worth showing anyone.
function siteGaps() {
  const c = siteCfg();
  return [!c.about ? t('a few lines about the hostel') : '', !(c.roomTypes || []).length ? t('at least one room type with its price') : '',
  !sitePhotoUrl('hero') ? t('a header photo') : '', !siteWa() ? t('a WhatsApp number for enquiries') : ''].filter(Boolean);
}

/* ===================================================================== lookups */
const allRooms = () => Store.all('room').slice().sort((a, b) => String(a.floor).localeCompare(String(b.floor), undefined, { numeric: true }) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
const rooms = () => { const b = blockScope(); return b ? allRooms().filter(inScope) : allRooms(); };
const roomById = id => Store.get(id);
const roomName = id => { const r = roomById(id); return r ? r.no : '—'; };
const allResidents = () => Store.all('res');
const residents = () => { const b = blockScope(); return b ? allResidents().filter(resInScope) : allResidents(); };
const activeRes = () => residents().filter(r => r.status === 'active' || r.status === 'notice');
const resById = id => Store.get(id);
const resLabel = r => (r ? `${r.name} · ${roomName(r.roomId)}${r.bed ? '-' + r.bed : ''}` : '—');
const staffList = () => Store.all('staff').filter(s => s.status !== 'removed');
const staffById = id => Store.get(id);
const items = () => Store.all('item').slice().sort(by('name'));
const itemById = id => Store.get(id);
const dishes = () => Store.all('dish').slice().sort(by('name'));
function activeOn(r, date) { return r.checkIn <= date && (!r.left || r.left > date) && r.status !== 'cancelled'; }
const floors = () => [...new Set(rooms().map(r => String(r.floor)))];

/* ===================================================================== money */
const invBal = i => Math.max(0, round2((i.amount || 0) - (i.paid || 0) - (i.waived || 0)));
function invStat(i) {
  if (invBal(i) <= 0) return 'paid';
  if (i.due < today()) return 'overdue';
  return i.paid > 0 ? 'partial' : 'due';
}
const STAT = { paid: ['Paid', 'ok'], due: ['Due', 'info'], partial: ['Partial', 'warn'], overdue: ['Overdue', 'bad'] };
const statBadge = s => badge(STAT[s][0], STAT[s][1]);
const invoices = () => Store.all('inv');
// Copy out of the index: callers are free to sort or reverse what they get back.
const resInvoices = id => (groupIndex('invByRes', 'inv', 'resId', by('date')).get(id) || []).slice();
const resPays = id => (groupIndex('payByRes', 'pay', 'resId', by('date', -1)).get(id) || []).slice();
const openInv = id => resInvoices(id).filter(i => invBal(i) > 0);
const resDue = id => round2(sum(openInv(id), invBal));
const resOverdue = id => round2(sum(openInv(id).filter(i => invStat(i) === 'overdue'), invBal));
/* The period every report and download works on: a preset (this month, last month, a financial
 * year ...) or any two dates. Chosen once on the Reports page and used by every download. */
const repDmy = iso => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${+d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} ${y}`; };
function repPresets(t0 = today()) {
  const ym = ymOf(t0), y = +ym.slice(0, 4), mo = +ym.slice(5), fy = mo >= 4 ? y : y - 1, endFy = `${fy + 1}-03-31`;
  const end = m => `${m}-${String(daysIn(m)).padStart(2, '0')}`;
  return [
    { k: 'this_month', l: 'This month', from: `${ym}-01`, to: t0 },
    { k: 'last_month', l: 'Last month', from: `${addMonths(ym, -1)}-01`, to: end(addMonths(ym, -1)) },
    { k: 'last_3', l: 'Last 3 months', from: `${addMonths(ym, -2)}-01`, to: t0 },
    { k: 'last_6', l: 'Last 6 months', from: `${addMonths(ym, -5)}-01`, to: t0 },
    { k: 'this_fy', l: `This financial year (Apr ${fy} – Mar ${fy + 1})`, from: `${fy}-04-01`, to: t0 < endFy ? t0 : endFy },
    { k: 'last_fy', l: `Last financial year (Apr ${fy - 1} – Mar ${fy})`, from: `${fy - 1}-04-01`, to: `${fy}-03-31` },
    { k: 'custom', l: 'Custom dates', from: `${ym}-01`, to: t0 },
  ];
}
function repRange(key, from, to) {
  const p = repPresets().find(x => x.k === key) || repPresets()[0];
  let a = key === 'custom' ? from || p.from : p.from, b = key === 'custom' ? to || p.to : p.to;
  if (a > b) [a, b] = [b, a];
  return { from: a, to: b, key: p.k, label: p.k === 'custom' ? `${repDmy(a)} – ${repDmy(b)}` : p.l };
}
const repIn = (d, r) => !!d && String(d).slice(0, 10) >= r.from && String(d).slice(0, 10) <= r.to;
const INV_TYPES = { rent: 'Rent', deposit: 'Security deposit', electricity: 'Electricity', laundry: 'Laundry', late: 'Late fee', penalty: 'Penalty', mess: 'Mess', other: 'Other' };

// Create (or keep) an invoice. Existing credit is applied automatically.
function addInvoice(o) {
  if (o.id && Store.get(o.id)) return Store.get(o.id);
  const amt = round2(o.amount);
  if (!isFinite(amt) || isNaN(amt) || amt <= 0) throw new AppError('Invoice amount must be positive');
  if (amt > 10000000) throw new AppError('Invoice amount cannot exceed ₹10,000,000');
  const inv = Store.put('inv', { paid: 0, waived: 0, date: today(), ...o, amount: amt });
  const r = resById(inv.resId);
  if (r && r.credit > 0 && inv.amount > 0 && can('payments')) {
    const use = Math.min(r.credit, inv.amount);
    inv.paid = round2(use); inv.creditUsed = round2(use);
    Store.put('inv', inv); Store.patch(r.id, { credit: round2(r.credit - use) });
  }
  alog('invoice_created', `${r ? r.name : inv.resId}: ${inr(amt)} (${inv.type || 'invoice'})`, { invId: inv.id, type: inv.type, amount: amt });
  return inv;
}

// Provider-specific payment reference classifier: distinguishes UPI RRN, Bank UTR, Gateway IDs and Test references
function classifyPaymentRef(ref) {
  if (!ref || typeof ref !== 'string') return { valid: false, type: 'unknown', reason: t('Reference is empty') };
  const s = ref.trim();
  if (s.length < 6 || s.length > 35) return { valid: false, type: 'unknown', reason: t('Reference must be 6 to 35 characters') };
  if (/^\d{12}$/.test(s)) return { valid: true, type: 'upi_rrn', label: t('UPI Reference (RRN)'), ref: s };
  if (/^(UPI|TEST|SIM|DEMO)[A-Za-z0-9_-]{6,26}$/i.test(s)) return { valid: true, type: 'internal_test', label: t('Test Payment Reference'), ref: s };
  if (/^pay_[A-Za-z0-9]{14,}$/.test(s) || /^cf_[A-Za-z0-9_-]{8,}$/.test(s) || /^setu_[A-Za-z0-9_-]{8,}$/.test(s)) return { valid: true, type: 'gateway_id', label: t('Payment Gateway ID'), ref: s };
  if (/^[A-Za-z0-9]{8,26}$/.test(s)) return { valid: true, type: 'bank_utr', label: t('Bank UTR / Transaction Reference'), ref: s };
  return { valid: false, type: 'invalid', reason: t('Reference contains invalid characters') };
}

// FIFO allocation: oldest dues first, extra money becomes advance credit.
// `invIds` puts those bills at the front of the queue; `exclude` keeps a bill out of this
// payment altogether, which is how a penalty the owner is not collecting today stays pending.
function recordPayment({ resId, amount, mode = 'cash', ref = '', date = today(), note = '', claimId = null, invIds = null, exclude = null, idempotencyKey = null, only = null, silent = false }) {
  const r = resById(resId); if (!r) throw new Error('Resident not found');
  amount = round2(amount);
  if (!isFinite(amount) || isNaN(amount) || !(amount > 0)) throw new Error('Enter an amount');
  if (amount > 10000000) throw new Error('Amount cannot exceed ₹10,000,000');
  const idmpKey = idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : uid('idmp-'));

  // Idempotency guards
  if (claimId) {
    const existingClaimPay = Store.all('pay').find(p => p.claimId === claimId && !p._del && !p.reversed);
    if (existingClaimPay) return existingClaimPay;
  }
  if (idmpKey) {
    const existingIdmpPay = Store.all('pay').find(p => p.idempotencyKey === idmpKey && !p._del && !p.reversed);
    if (existingIdmpPay) return existingIdmpPay;
  }

  let left = amount; const alloc = [];
  const skip = new Set(exclude || []);
  const open = openInv(resId).filter(i => !skip.has(i.id));
  // `only`: settle just these bills; whatever is left over goes to the resident's credit, never to other bills
  const target = only ? open.filter(i => only.includes(i.id)) : invIds ? open.filter(i => invIds.includes(i.id)) : open;
  const rest = only ? [] : invIds ? open.filter(i => !invIds.includes(i.id)) : [];
  for (const inv of [...target, ...rest]) {
    if (left <= 0) break;
    const take = Math.min(left, invBal(inv));
    inv.paid = round2((inv.paid || 0) + take); Store.put('inv', inv);
    alloc.push({ inv: inv.id, amt: round2(take), title: inv.title }); left = round2(left - take);
  }
  if (left > 0) Store.patch(resId, { credit: round2((r.credit || 0) + left) });
  const no = (S().receiptNo || 0) + Store.all('pay').length + 1;
  const refType = ref ? classifyPaymentRef(ref).type : null;
  // The id must be 'pay-' + idempotency key: that is the id record_payment_atomic gives the record in the database, so the local copy, the saved copy and any later reversal are one and the same document.
  const pay = Store.put('pay', { id: 'pay-' + idmpKey, resId, roomId: r.roomId, amount, mode, ref, refType, date, note, alloc, credit: left, claimId, no: `R-${no}`, idempotencyKey: idmpKey, by: Store.me && Store.me.full_name, ts: nowIso() });
  alog('payment_recorded', `${r.name}: ${inr(amount)} (${mode})`, { payId: pay.id, resId, amount, mode, ref, claimId });
  if (!silent) notify({ to: 'res', resId, title: t('Payment received'), body: `${inr(amount)} · ${t(mode.toUpperCase())}`, category: 'payment' });
  return pay;
}

// Reversal entry: never silently hard-delete verified financial transactions
function reversePayment(payId, reason = '') {
  if (!canAction('refund')) throw new AppError('Unauthorized: only owner, manager or super admin can reverse payments');
  const p = Store.get(payId);
  if (!p || p.kind !== 'pay') throw new AppError('Payment not found');
  if (p.reversed) throw new AppError('Payment is already reversed');
  if (!reason || !String(reason).trim()) throw new AppError('A reason for reversal is required');
  const r = resById(p.resId);
  // 1. Revert allocations from invoices
  for (const a of (p.alloc || [])) {
    const inv = Store.get(a.inv);
    if (inv) {
      inv.paid = Math.max(0, round2((inv.paid || 0) - a.amt));
      Store.put('inv', inv);
    }
  }
  // 2. Revert any credit that was granted
  if (p.credit > 0 && r) {
    const newCredit = Math.max(0, round2((r.credit || 0) - p.credit));
    Store.patch(r.id, { credit: newCredit });
  }
  // 3. Mark payment as reversed
  Store.patch(payId, {
    reversed: true,
    reversedAt: nowIso(),
    reversedBy: Store.me && Store.me.full_name,
    reversalReason: String(reason).trim()
  });
  alog('payment_reversal', `${inr(p.amount)} for ${r ? r.name : p.resId}: ${reason}`, {
    payId,
    amount: p.amount,
    resId: p.resId,
    reason: String(reason).trim()
  });
  if (p.resId) {
    notify({
      to: 'res',
      resId: p.resId,
      title: t('Payment reversed'),
      body: `${inr(p.amount)} · ${reason}`,
      category: 'payment'
    });
  }
  return Store.get(payId);
}

/* ===================================================================== penalties
 * A fine for a broken rule (late entry, damage, smoking...). It is an ordinary charge, so it
 * shows on the resident's bill list and counts in their dues and in reports with no special
 * case anywhere. What makes it different is only that the owner decides, at each payment,
 * whether to collect it now - if not it simply stays open until it is paid or cancelled.
 */
const resPenalties = id => openInv(id).filter(i => i.type === 'penalty');
const penaltyDue = id => round2(sum(resPenalties(id), invBal));
const penaltyList = () => activeRes().map(r => ({ r, amount: penaltyDue(r.id) })).filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount);
function addPenalty({ resId, amount, reason, date = today(), due = '' }) {
  const r = resById(resId); if (!r) throw new AppError('Resident not found');
  amount = round2(amount);
  if (!isFinite(amount) || isNaN(amount) || !(amount > 0)) throw new AppError('Enter an amount');
  if (amount > 1000000) throw new AppError('Penalty cannot exceed ₹1,000,000');
  reason = String(reason || '').trim(); if (!reason) throw new AppError('Please write the reason');
  if (reason.length > 120) throw new AppError('Reason cannot exceed 120 characters');
  const inv = addInvoice({
    resId, roomId: r.roomId, type: 'penalty', reason, amount, date,
    title: `${t('Penalty')} - ${reason}`, period: ymOf(date), due: due || addDays(date, 7)
  });
  notify({ to: 'res', resId, title: t('Penalty added'), body: `${inr(amount)} - ${reason}` });
  alog('penalty', `${r.name}: ${inr(amount)} - ${reason}`);
  return inv;
}
// Cancelling a fine never deletes it: the fine and the decision to drop it are both worth
// keeping, so the balance goes to zero as a waiver instead.
function waivePenalty(invId, why = '') {
  const i = Store.get(invId); if (!i || i.type !== 'penalty') return null;
  const bal = invBal(i);
  Store.patch(invId, { waived: round2((i.waived || 0) + bal), waivedWhy: why, waivedOn: today() });
  if (i.resId) notify({ to: 'res', resId: i.resId, title: t('Penalty cancelled'), body: inr(bal) });
  alog('penalty', `${t('Penalty cancelled')} ${inr(bal)}${why ? ' - ' + why : ''}`);
  return Store.get(invId);
}

/* ===================================================================== advance rent
 * A resident may hand over several months at once, usually for a discount. The months paid
 * for are not a special kind of record: the ordinary rent bill for each month is created now,
 * the discount sits on those bills as a waiver, and the normal allocation settles them. So
 * the monthly view, the receipt, the dues list and the reports keep working unchanged, and
 * the automation rule that writes rent bills skips a month that is already billed.
 */
const advRentId = (resId, ym) => `inv-rent-${resId}-${ym}`;
// Which months the next advance would cover, and what it should cost.
function advPlan(resId, months) {
  const r = resById(resId); if (!r || !(months > 0)) return null;
  let ym = ymOf(today() < r.checkIn ? r.checkIn : today());
  const cur = Store.get(advRentId(resId, ym));
  if (cur && invBal(cur) <= 0) ym = addMonths(ym, 1);   // this month is already settled
  const rows = [];
  for (let i = 0; i < months; i++) {
    const m = addMonths(ym, i), inv = Store.get(advRentId(resId, m));
    rows.push({ ym: m, id: advRentId(resId, m), exists: !!inv, amount: inv ? invBal(inv) : round2(r.rent || 0) });
  }
  const total = round2(sum(rows, x => x.amount));
  const credit = Math.min(round2(r.credit || 0), total);   // addInvoice spends existing credit first
  return { rows, months, yms: rows.map(x => x.ym), total, credit, expected: round2(total - credit) };
}
function recordAdvance({ resId, amount, months, mode = 'cash', ref = '', date = today(), note = '' }) {
  const r = resById(resId); if (!r) throw new AppError('Resident not found');
  months = Math.round(months); amount = round2(amount);
  if (!(months >= 1)) throw new AppError('How many months is this payment for?');
  if (!(amount > 0)) throw new AppError('Enter an amount');
  const plan = advPlan(resId, months);
  const graceDays = rentDueDays();
  for (const row of plan.rows) {
    if (row.exists) continue;
    const d = rentBillDate(row.ym);
    addInvoice({
      id: row.id, resId, roomId: r.roomId, type: 'rent', period: row.ym,
      title: `${t('Rent')} ${fmtYM(row.ym)}`, amount: round2(r.rent || 0), date: d, due: addDays(d, graceDays)
    });
  }
  // Read the real balances back: addInvoice may have spent advance credit the resident
  // already had, which would make a discount worked out beforehand too large.
  const ids = plan.rows.map(x => x.id);
  const expected = round2(sum(ids, id => invBal(Store.get(id) || {})));
  const discount = Math.max(0, round2(expected - amount));
  if (discount > 0) {
    // spread over the months, so each one shows what it actually cost
    const per = round2(discount / ids.length);
    let left = discount;
    ids.forEach((id, i) => {
      const inv = Store.get(id); if (!inv || left <= 0) return;
      const give = i === ids.length - 1 ? round2(Math.min(left, invBal(inv))) : round2(Math.min(per, left, invBal(inv)));
      if (give > 0) { Store.patch(id, { waived: round2((inv.waived || 0) + give), discount: round2((inv.discount || 0) + give) }); left = round2(left - give); }
    });
  }
  const pay = recordPayment({ resId, amount, mode, ref, date, note, invIds: ids });
  Store.patch(pay.id, { adv: { months, from: plan.yms[0], to: plan.yms[plan.yms.length - 1], discount, expected } });
  alog('advance', t('{a} advance from {n} for {m} months', { a: inr(amount), n: r.name, m: months }));
  return Store.get(pay.id);
}
// Future months already fully paid for - shown on the resident's page.
function advPaidAhead(resId) {
  const cur = ymOf(today());
  return invoices().filter(i => i.resId === resId && i.type === 'rent' && i.period > cur && invBal(i) <= 0)
    .map(i => i.period).sort();
}

/* ===================================================================== UPI & WhatsApp */
// The app is at the root of its address (https://app.example.com/), whichever page is open.
const appUrl = () => location.origin + '/';
const baseUrl = () => location.origin + '/';
// Several UPI accounts (Settings > Hostel details & UPI > "Use different UPI IDs"): rent follows the resident's floor,
// electricity has its own ID. With the switch off, the one UPI ID is used for everything, as before.
function upiFor(r, kind = 'rent') {
  const p = S().pay || {};
  if (!p.multi) return p.upiId || '';
  if (kind === 'elec') return p.elecUpi || p.upiId || '';
  const room = r && roomById(r.roomId), fl = room && room.floor;
  return (p.floorUpi && fl && p.floorUpi[fl]) || p.upiId || '';
}
// What one resident has to pay, grouped by the UPI ID it goes to. One group normally; two (Rent / Electricity)
// when electricity is paid to a different account than the rent.
function payBuckets(r) {
  const open = openInv(r.id), p = S().pay || {};
  const rentUpi = upiFor(r, 'rent'), elecUpi = upiFor(r, 'elec');
  const mk = (kind, label, invs, upi) => ({ kind, label, invs, ids: invs.map(i => i.id), total: round2(sum(invs, invBal)), upi });
  if (p.multi && elecUpi && rentUpi && elecUpi !== rentUpi) {
    const el = open.filter(i => i.type === 'electricity'), rest = open.filter(i => i.type !== 'electricity');
    return [rest.length && mk('rent', 'Pay Rent', rest, rentUpi), el.length && mk('elec', 'Pay Electricity Bill', el, elecUpi)].filter(Boolean);
  }
  return open.length ? [mk('all', 'Pay now', open, rentUpi)] : [];
}
function upiUri(amount, note, upi) {
  const p = S().pay;
  return `upi://pay?pa=${encodeURIComponent(upi || p.upiId)}&pn=${encodeURIComponent(p.payee || (Store.hostel() || {}).name || '')}&am=${round2(amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(String(note).slice(0, 60))}`;
}
// WhatsApp only links http(s), so we send a link to our static pay page that opens any UPI app + shows QR.
function payLink(amount, note, extra = {}) {
  const p = S().pay, pa = (extra && extra.upi) || p.upiId; if (!pa) return '';
  const hid = (Store.hostel() || {}).id || (Store.ctx || {}).hostelId || '';
  const q = new URLSearchParams({
    pa,
    pn: p.payee || (Store.hostel() || {}).name || '',
    am: round2(amount).toFixed(2),
    tn: String(note).slice(0, 60),
    h: (Store.hostel() || {}).name || '',
    ...(hid ? { hostel_id: hid } : {}),
    ...(extra && extra.resId ? { res_id: extra.resId } : {}),
    ...(extra && extra.invId ? { inv_id: extra.invId } : {})
  });
  return `${baseUrl()}pay.html?${q}`;
}
// One pay link per UPI account the resident has to pay: [{ kind, label, amount, url }]
function payLinksFor(r) {
  const note = `${r.name.split(' ')[0]} ${roomName(r.roomId)} ${(Store.hostel() || {}).name || ''}`.trim();
  return payBuckets(r).map(b => ({ kind: b.kind, label: b.label, amount: b.total, url: payLink(b.total, note, { resId: r.id, invId: b.ids.length === 1 ? b.ids[0] : undefined, upi: b.upi }) })).filter(x => x.url);
}
// The pay link for one resident and one invoice, with the note the owner will see in the bank statement.
function payLinkFor(r, amount, inv) {
  return payLink(amount, `${r.name.split(' ')[0]} ${roomName(r.roomId)} ${(Store.hostel() || {}).name || ''}`.trim(), { resId: r.id, invId: inv ? inv.id : undefined });
}
function upiPayUrl(resId, amount) {
  const r = resId ? resById(resId) : null;
  const note = r ? `Rent - ${r.name}` : 'PG dues';
  return payLink(amount, note, { resId }) || '';
}
/* WhatsApp messages. Plain text on purpose: no emoji and no rupee sign. Emoji arrive as empty boxes
 * on older phones and on WhatsApp Web / desktop, and the rupee sign is missing from some fonts, so a
 * message that looked fine here could reach a resident as "Welcome ▯▯" and "▯ 6,000". Amounts are
 * written "Rs. 6,000", headings use *bold* (which WhatsApp renders everywhere), and every message
 * is the same shape: greeting, what it is about, the details one per line, what to do next, sign-off. */
const rs = n => 'Rs. ' + Math.round(+n || 0).toLocaleString('en-IN');
const WA_TPL = {
  en: {
    welcome: 'Hello {name},\n\nWelcome to *{hostel}*.\n\n*Your stay*\nRoom: {room}, Bed {bed}\nMonthly rent: {rent}\nSecurity deposit: {deposit}\n\n*Your app login*\nApp: {link}\nUser ID: *{username}*\nPassword: *{password}*\n\nPlease change your password after you log in for the first time.\n\nRegards,\n{hostel}',
    bill: 'Hello {name},\n\nHere is your monthly bill at *{hostel}*.\n\n{lines}\n\n*Total due: {total}*\n\nPay with any UPI app (GPay / PhonePe / Paytm):\n{paylink}\n\nAfter paying, please enter the UTR number in the pay link to confirm.\n\nThank you,\n{hostel}',
    reminder: 'Hello {name},\n\nThis is a gentle reminder from *{hostel}*. The following is still pending:\n\n{lines}\n\n*Total due: {total}*\n\nYou can pay here:\n{paylink}\n\nIf you have already paid, please ignore this message.\n\nRegards,\n{hostel}',
    receipt: 'Hello {name},\n\nWe have received your payment. Thank you.\n\nAmount: *{amount}* ({mode})\nDate: {date}\nReceipt no: {no}\nBalance due: {balance}\n\nRegards,\n{hostel}',
    laundryIn: 'Hello {name},\n\nWe have received *{pcs} clothes* for laundry on {date}.\nFree pieces left this month: {free}{charge}\n\nRegards,\n{hostel}',
    laundryDone: 'Hello {name},\n\nYour laundry ({pcs} clothes) is ready. Please collect it from the laundry desk.\n\nRegards,\n{hostel}',
    checkout: 'Hello {name},\n\nYour checkout from *{hostel}* is complete. Thank you for staying with us.\n\nSecurity deposit: {deposit}\n{feeLine}Deductions (dues, damages, notice): {deduct}\n*Refund: {refund}*\n\nWe wish you all the best.\n\nRegards,\n{hostel}',
    staffWelcome: 'Hello {name},\n\nYour login for {hostel} is ready.\n\nApp: {link}\nUser ID: *{username}*\nPassword: *{password}*\n\nPlease change your password after you log in for the first time.',
    password: 'Hello {name},\n\nYour password has been changed.\n\nApp: {link}\nUser ID: *{username}*\nNew password: *{password}*\n\nPlease change it after you log in.',
  },
  hi: {
    welcome: 'नमस्ते {name},\n\n*{hostel}* में आपका स्वागत है।\n\n*आपका कमरा*\nकमरा: {room}, बेड {bed}\nमासिक किराया: {rent}\nसिक्योरिटी डिपॉज़िट: {deposit}\n\n*आपका ऐप लॉगिन*\nऐप: {link}\nयूज़र ID: *{username}*\nपासवर्ड: *{password}*\n\nपहली बार लॉगिन करने के बाद कृपया अपना पासवर्ड बदल लें।\n\nधन्यवाद,\n{hostel}',
    bill: 'नमस्ते {name},\n\n*{hostel}* में आपका इस महीने का बिल यह है।\n\n{lines}\n\n*कुल बकाया: {total}*\n\nकिसी भी UPI ऐप (GPay / PhonePe / Paytm) से भुगतान करें:\n{paylink}\n\nभुगतान के बाद लिंक में UTR नंबर दर्ज करें:\n\nधन्यवाद,\n{hostel}',
    reminder: 'नमस्ते {name},\n\n*{hostel}* की ओर से यह एक विनम्र याद दिलाना है। नीचे दिया गया भुगतान अभी बाकी है:\n\n{lines}\n\n*कुल बकाया: {total}*\n\nयहाँ से भुगतान करें:\n{paylink}\n\nअगर आप भुगतान कर चुके हैं तो कृपया इस संदेश को अनदेखा करें।\n\nधन्यवाद,\n{hostel}',
    receipt: 'नमस्ते {name},\n\nआपका भुगतान मिल गया है। धन्यवाद।\n\nराशि: *{amount}* ({mode})\nतारीख: {date}\nरसीद नंबर: {no}\nबाकी: {balance}\n\nधन्यवाद,\n{hostel}',
    laundryIn: 'नमस्ते {name},\n\n{date} को लॉन्ड्री के लिए *{pcs} कपड़े* मिले हैं।\nइस महीने फ्री बचे: {free}{charge}\n\nधन्यवाद,\n{hostel}',
    laundryDone: 'नमस्ते {name},\n\nआपकी लॉन्ड्री ({pcs} कपड़े) तैयार है। कृपया लॉन्ड्री डेस्क से ले जाएँ।\n\nधन्यवाद,\n{hostel}',
    checkout: 'नमस्ते {name},\n\n*{hostel}* से आपका चेकआउट पूरा हो गया है। हमारे साथ रहने के लिए धन्यवाद।\n\nसिक्योरिटी डिपॉज़िट: {deposit}\n{feeLine}कटौती (बकाया, नुकसान, नोटिस): {deduct}\n*वापसी: {refund}*\n\nआपके उज्ज्वल भविष्य की शुभकामनाएँ।\n\nधन्यवाद,\n{hostel}',
    staffWelcome: 'नमस्ते {name},\n\n{hostel} के लिए आपका लॉगिन तैयार है।\n\nऐप: {link}\nयूज़र ID: *{username}*\nपासवर्ड: *{password}*\n\nपहली बार लॉगिन करने के बाद कृपया अपना पासवर्ड बदल लें।',
    password: 'नमस्ते {name},\n\nआपका पासवर्ड बदल दिया गया है।\n\nऐप: {link}\nयूज़र ID: *{username}*\nनया पासवर्ड: *{password}*\n\nलॉगिन के बाद कृपया इसे बदल लें।',
  },
};
/* Checkout message. {feeLine} is the non-refundable fee line (empty when there is none). A hostel that
 * customised this template before the fee existed has no {feeLine}, so the fee then goes into Deductions
 * and the three numbers still add up: deposit - deductions = refund. */
/* ===================================================================== exit report (PDF to the owner)
 * Everything about a resident who has left, in one document, e-mailed to the owner the moment the
 * checkout is saved. It is also the copy that outlives the resident's data, which the server
 * removes 60 days after checkout (see purgeLeftResidents in api/admin.js). */
const ownerEmail = () => { const e = String((S().pay || {}).email || '').trim(); return isValidEmail(e) ? e : ''; };
function checkoutReportData(dep) {
  const r = resById(dep.resId) || {}, h = Store.hostel() || {}, room = r.roomId ? roomById(r.roomId) : null;
  const invs = resInvoices(r.id), pays = resPays(r.id).slice().reverse();
  const rows = [[t('Deposit paid'), dep.deposit || 0]];
  if (dep.nonRefundable > 0) rows.push([t('Non-refundable fee'), dep.nonRefundable, 'bad']);
  if (dep.deductions > 0) rows.push([t('Deductions (damages etc.)'), dep.deductions, 'bad']);
  if (dep.settled > 0) rows.push([t('Dues cleared from deposit'), dep.settled]);
  return {
    hostel: { name: h.name || '', address: h.address || '' }, generatedOn: fmtDate(today()),
    resident: { name: r.name, phone: r.phone, email: r.email, guardian: r.guardian, guardianPhone: r.guardianPhone, college: r.college, address: r.address,
      idMasked: r.idNo ? maskAadhaar(r.idNo) : '', room: room ? room.no : '', bed: r.bed || '', checkIn: r.checkIn ? fmtDate(r.checkIn) : '', left: dep.date ? fmtDate(dep.date) : '', rent: r.rent },
    settlement: { rows, refund: dep.refund || 0, balancePayable: dep.balancePayable || 0, status: dep.status },
    invoices: invs.slice(0, 500).map(i => ({ date: i.date ? fmtShort(i.date) : '', title: i.title || i.type || t('Bill'), amount: i.amount || 0, paid: i.paid || 0, balance: invBal(i) })),
    payments: pays.slice(0, 500).map(p => ({ date: p.date ? fmtShort(p.date) : '', no: p.no || '', mode: p.mode || '', ref: p.ref || '', amount: p.amount || 0 })),
    totals: { billed: sum(invs, i => i.amount || 0), paid: sum(invs, i => i.paid || 0), waived: sum(invs, i => i.waived || 0), due: sum(invs, invBal) },
    docs: (r.docs || []).map(d => d.type + (d.name ? ' - ' + d.name : '')).slice(0, 40),
    pv: r.pv && r.pv.status && r.pv.status !== 'none' ? { status: r.pv.status, refNo: r.pv.refNo || '' } : null,
  };
}
// Sends it, and remembers that it went (the 60-day data removal only touches residents whose report was sent).
async function sendCheckoutReport(depId) {
  const dep = Store.get(depId);
  if (!dep) return { ok: false, reason: 'missing' };
  if (isDemoHostel() || typeof Backend === 'undefined' || !Backend.admin) return { ok: false, reason: 'demo' };
  const to = ownerEmail();
  if (!to) return { ok: false, reason: 'no_owner_email' };
  try {
    const r = await Backend.admin('send_checkout_report', { to, hostel_id: (Store.ctx && Store.ctx.hostelId) || null, report: checkoutReportData(dep) });
    if (r && r.delivered) { Store.patch(depId, { reportEmailedAt: nowIso(), reportTo: to }); return { ok: true, delivered: true, to }; }
    return { ok: false, reason: (r && r.status) || 'not_sent' };
  } catch (e) { return { ok: false, reason: e.message || 'failed' }; }
}

function checkoutMessage(dep, r) {
  const lang = waLang(r), custom = (S().wa.tpl || {})[S().wa.lang || 'en'] || {};
  const fee = round2(+dep.nonRefundable || 0), hasLine = !custom.checkout || custom.checkout.includes('{feeLine}');
  const stmt = dep.settlement || {}, credit = round2(+stmt.credit || 0), deposit = round2((+dep.deposit || 0) + credit);
  const deduct = Math.max(0, round2(deposit - (+dep.refund || 0) - (hasLine ? fee : 0)));
  return tpl('checkout', { name: r.name.split(' ')[0], hostel: (Store.hostel() || {}).name, deposit: rs(deposit), feeLine: fee > 0 && hasLine ? `${t('Non-refundable fee')}: ${rs(fee)}\n` : '', deduct: rs(deduct), refund: rs(+dep.refund || 0) }, lang);
}
const WA_KEYS = { welcome: 'Welcome + login (check-in)', bill: 'Bill with UPI pay link', reminder: 'Due reminder', receipt: 'Payment receipt', laundryIn: 'Laundry received', laundryDone: 'Laundry ready', checkout: 'Checkout & refund', staffWelcome: 'Staff login', password: 'New password' };
function waLang(r) { const l = S().wa.lang; return l === 'auto' ? (r && r.lang) || LANG : l; }
function tpl(key, vars, lang) {
  const L = lang || S().wa.lang || 'en', custom = (S().wa.tpl || {})[L] || {};
  const base = custom[key] || (WA_TPL[L] || WA_TPL.en)[key] || WA_TPL.en[key];
  return base.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? ''));
}
const waUrl = (phone, text) => `https://wa.me/${phone10(phone).length === 10 ? '91' + phone10(phone) : digits(phone)}?text=${encodeURIComponent(text)}`;
// Opens WhatsApp with the message typed in — the owner only presses Send. If the browser blocks
// the pop-up, a one-tap sheet appears instead.
/* Optional self-hosted gateway (Settings → WhatsApp → Send automatically). With it, messages go
 * out without opening WhatsApp; without it, nothing changes. Sent in batches of 5 per call. */
// The demo hostel is for showing and testing: nothing is ever sent from it, whatever is connected.
const isDemoHostel = () => !!((Store.hostel() || {}).settings || {}).demo;
const WaGw = {
  // Automatic WhatsApp needs three things at once: a live hostel, the platform admin's switch, AND a connected gateway (Meta keys).
  // Without the gateway there is nothing to send with, so no screen may offer it.
  on: () => typeof CLOUD !== 'undefined' && CLOUD && !isDemoHostel() && orgEnabled('automation') && !!((S().wa || {}).gw && S().wa.gw.on),
  async send(list, onProgress) {
    const out = [];
    for (let i = 0; i < list.length; i += 5) {
      const chunk = list.slice(i, i + 5);
      try {
        const r = await Cloud.waApi('send', { hostel_id: Store.ctx.hostelId, messages: chunk.map(m => (m.template ? { phone: phone10(m.phone), template: m.template } : { phone: phone10(m.phone), text: m.text })) });
        out.push(...r.results);
      } catch (e) { out.push(...chunk.map(() => ({ ok: false, error: e.message }))); }
      if (onProgress) onProgress(out.length, list.length);
    }
    return out;
  },
};
// Every message opens WhatsApp typed and ready; the owner presses Send. The gateway is used for
// ONE thing only — the monthly bill (see monthlyBillsDue) — so a welcome, receipt, notice or
// reminder never leaves by itself.
function waOpen(phone, text, title = 'Send on WhatsApp') {
  if (!phone10(phone)) { toast('No mobile number saved', 'bad'); return; }
  const url = waUrl(phone, text);
  // Installed app on an iPhone: a new window there becomes an empty in-app browser that stays open (a blank "Search or enter website name"
  // page) when the owner comes back from WhatsApp. The whatsapp:// address opens the WhatsApp app directly and leaves nothing behind.
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && typeof Pwa !== 'undefined' && Pwa.standalone && Pwa.standalone()) {
    const p10 = phone10(phone), to = p10.length === 10 ? '91' + p10 : digits(phone);
    location.href = `whatsapp://send?${to ? 'phone=' + to + '&' : ''}text=${encodeURIComponent(text)}`;
    // WhatsApp not installed: nothing happens and this page stays in front, so offer the one-tap sheet instead
    setTimeout(() => { if (!document.hidden) waSheet([{ phone, text, label: '' }], title); }, 1800);
    return;
  }
  let w = null;
  try { w = window.open(url, '_blank'); if (w) w.opener = null; } catch (e) { w = null; }
  if (!w) waSheet([{ phone, text, label: '' }], title);
}
// A queue of messages: tap → WhatsApp opens → come back → next one is ready.
function waSheet(list, title = 'Send on WhatsApp') {
  ui.waq = { list, i: 0, title };
  renderWaQueue();
}
function renderWaQueue() {
  const q = ui.waq; if (!q) return;
  const done = q.i >= q.list.length, m = q.list[Math.min(q.i, q.list.length - 1)];
  const isBulk = q.list.length > 1;
  const body = done
    ? `<div class="empty"><b>${esc(t('All sent'))} </b>${esc(t('{n} messages', { n: q.list.length }))}</div>`
    : `
      ${isBulk ? `
        <div class="card" style="margin-bottom:12px;background:linear-gradient(135deg, rgba(37,99,235,0.08), rgba(59,130,246,0.04));border:1px solid rgba(37,99,235,0.22);padding:14px;border-radius:12px">
          <div class="row sb" style="margin-bottom:6px">
            <b style="color:var(--accent);font-size:14px">${ico('mail', 'sm')} ${esc(t('Bulk Action: Email + App Notice'))}</b>
            <span class="badge ok">${q.list.length} ${esc(t('recipients'))}</span>
          </div>
          <p class="xs muted" style="margin:0 0 8px;line-height:1.3">
            ${esc(t('Send invoice email & app notice to all residents in 1 click.'))}
          </p>
          <button type="button" class="btn primary sm" data-act="sendbulkemailnotice" style="width:100%;justify-content:center">
            ${ico('send', 'sm')} ${esc(t('Send All ({n}) via Email + App Notice', { n: q.list.length }))}
          </button>
        </div>
        <div class="row nw" style="align-items:center;gap:10px;margin:12px 0 10px">
          <div style="flex:1;height:1px;background:var(--line)"></div>
          <span class="muted xs uppercase" style="letter-spacing:0.05em">${esc(t('OR SEND INDIVIDUALLY ON WHATSAPP'))}</span>
          <div style="flex:1;height:1px;background:var(--line)"></div>
        </div>
      ` : ''}
      ${isBulk ? `<div class="row sb" style="margin-bottom:8px"><b>${esc(m.label || '')}</b><span class="badge acc">${q.i + 1} / ${q.list.length}</span></div>` : ''}
      <div class="card" style="white-space:pre-wrap;font-size:14.5px;max-height:36dvh;overflow:auto">${esc(m.text)}</div>
      <div class="hint" style="margin-top:8px">${esc(t('Tap "Open WhatsApp" below to message this resident individually.'))}</div>
    `;
  openModal({
    title: q.title, body, foot: done ? `<button class="btn primary block" data-act="close">${esc(t('Done'))}</button>`
      : `${isBulk ? `<button class="btn" data-act="waskip">${esc(t('Skip'))}</button>` : `<button class="btn" data-act="close">${esc(t('Close'))}</button>`}<a class="btn wa" style="flex:1" href="${esc(waUrl(m.phone, m.text))}" target="_blank" rel="noopener" data-act="wanext">${ico('wa', 'sm')} ${esc(t('Open WhatsApp'))}</a>`
  });
}

// The server draws the premium mail from these fields (api/_email.js). The HTML below is the plain
// fallback, and the key that lets sendBrandedEmail find the fields again.
const BRAND_ARGS = new Map();
function renderBrandedEmailHtml(args) {
  const html = renderBrandedEmailPlain(args || {});
  if (BRAND_ARGS.size > 40) BRAND_ARGS.delete(BRAND_ARGS.keys().next().value);
  BRAND_ARGS.set(html, args || {});
  return html;
}
function renderBrandedEmailPlain({ hostelName = 'Hostel', title = 'Notice & Bill', headline = 'Payment Notice', recipientName = 'Resident', bodyLines = '', amountDue = 0, payLink = '', date = '', intro = '', summaryLabel = 'Notice & Statement Summary' }) {
  const safeLines = esc(bodyLines).replace(/\n/g, '<br>');
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:20px 10px;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;-webkit-font-smoothing:antialiased">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.06)">
    <!-- Header Banner -->
    <div style="background:linear-gradient(135deg, #1e3a8a 0%, #2563eb 60%, #3b82f6 100%);padding:28px 24px 24px;text-align:center;color:#ffffff">
      <div style="display:inline-block;background:rgba(255,255,255,0.22);backdrop-filter:blur(4px);padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#ffffff;margin-bottom:10px">
        ${esc(title.toUpperCase())}
      </div>
      <h1 style="margin:0;font-size:24px;font-weight:800;letter-spacing:-0.02em;color:#ffffff;text-shadow:0 1px 2px rgba(0,0,0,0.1)">${esc(hostelName)}</h1>
      <div style="margin-top:6px;font-size:13.5px;color:#dbeafe">${date ? esc(date) : ''} · Official Communication</div>
    </div>

    <!-- Content Area -->
    <div style="padding:28px 24px 20px">
      <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:12px">
        Hello ${esc(recipientName)},
      </div>
      <div style="font-size:14.5px;line-height:1.6;color:#334155;margin-bottom:20px">
        ${intro ? esc(intro) : `Please find your latest notice and stay billing details below for <b>${esc(hostelName)}</b>:`}
      </div>

      ${amountDue > 0 ? `
      <!-- Total Due Card -->
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:14px;padding:20px;margin-bottom:22px;text-align:center">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#991b1b">Total Amount Pending</div>
        <div style="font-size:32px;font-weight:800;color:#dc2626;margin:6px 0 4px">₹${amountDue.toLocaleString('en-IN')}</div>
        <div style="font-size:12.5px;color:#7f1d1d">Kindly clear dues before the due date to avoid late fee penalties.</div>
      </div>
      ` : ''}

      <!-- Detailed Breakdown -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:22px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;margin-bottom:8px">${esc(summaryLabel)}</div>
        <div style="font-size:13.5px;line-height:1.65;color:#1e293b;font-family:monospace">
          ${safeLines}
        </div>
      </div>

      ${payLink ? `
      <!-- Pay Button -->
      <div style="text-align:center;margin:24px 0 20px">
        <a href="${payLink}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:10px;box-shadow:0 4px 14px rgba(37,99,235,0.35);letter-spacing:0.02em">
          Pay Online / UPI Now →
        </a>
        <div style="font-size:12px;color:#64748b;margin-top:8px">Zero hassle instant payment verification & receipt</div>
      </div>
      ` : ''}

      <div style="font-size:13px;line-height:1.5;color:#64748b;border-top:1px solid #f1f5f9;padding-top:16px;margin-top:20px">
        Have questions or already paid? You can submit your payment transaction UTR directly in your Sarvlekh resident app, or contact the PG administration.
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f1f5f9;padding:18px 24px;text-align:center;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0">
      <div><b>${esc(hostelName)}</b> · Powered by Sarvlekh Hostel Management</div>
      <div style="margin-top:4px;color:#94a3b8">© ${year} All rights reserved.</div>
    </div>
  </div>
</body>
</html>`;
}

// Returns { ok, delivered, reason }. `delivered` is true ONLY when the mail provider accepted the message —
// never a made-up success (the old version reported "sent" even when nothing left the server).
async function sendBrandedEmail({ to, subject, html, text, resId, hostelId, replyTo }) {
  if (!to || !isValidEmail(to)) return { ok: false, delivered: false, reason: 'invalid_email' };
  if (isDemoHostel()) return { ok: true, delivered: false, reason: 'demo' };
  if (typeof Backend === 'undefined' || !Backend.admin) return { ok: false, delivered: false, reason: 'offline' };
  try {
    const r = await Backend.admin('send_resident_email', { to, subject, html, brand: BRAND_ARGS.get(html) || undefined, text, res_id: resId || null, hostel_id: hostelId || (Store.ctx && Store.ctx.hostelId) || null, hostel_name: hostelName(), reply_to: replyTo || undefined });
    return { ok: !!(r && r.ok), delivered: !!(r && r.delivered), reason: (r && r.status) || '' };
  } catch (err) {
    return { ok: false, delivered: false, reason: err.message || 'failed' };
  }
}

/* ===================================================================== bulk e-mail (the only bulk channel)
 * "Send to all" is one e-mail per resident, sent in one go, and it is remembered: a resident who already got this
 * kind of mail today is skipped, so a second tap can never send twice. WhatsApp stays one resident at a time.
 * A row of kind 'bmail' per resident per kind per day is the memory (ok = the mail service took it; noEmail = the
 * resident has no e-mail, so only the in-app notice went). */
// The demo hostel and the offline demo mode have no mail server: the flow runs, nothing is really sent.
function mailIsSimulated() { return isDemoHostel() || (typeof CLOUD !== 'undefined' && !CLOUD); }
// The memory is ONE row per kind per day holding the list of residents already handled (not a row per resident):
// a 100-resident hostel writes 1 row a day instead of 100, and a check is one lookup.
const bmailDocId = (kind, key = today()) => `bmd-${kind}-${key}`;
const bmailDay = (kind, key = today()) => Store.get(bmailDocId(kind, key)) || { mailed: [], appOnly: [] };
const bmailDone = (kind, resId, key = today()) => { const d = bmailDay(kind, key); return (d.mailed || []).includes(resId) || (d.appOnly || []).includes(resId); };
function bmailSave(kind, key, mailed, appOnly, failed = {}) {
  if (!mailed.length && !appOnly.length && !Object.keys(failed).length) return;
  const d = bmailDay(kind, key), at = { ...(d.at || {}) }, fail = { ...(d.fail || {}) }, now = nowIso();
  for (const id of mailed) { at[id] = now; delete fail[id]; }
  for (const id of appOnly) { at[id] = at[id] || now; }
  for (const id of Object.keys(failed)) fail[id] = failed[id];
  Store.put('bmail', { id: bmailDocId(kind, key), kind, date: today(), mailed: [...new Set([...(d.mailed || []), ...mailed])], appOnly: [...new Set([...(d.appOnly || []), ...appOnly])], at, fail, ts: now });
}
// ok / none (nothing saved) / bad (saved, but not an address)
const emailState = r => { const e = String((r && r.email) || '').trim(); return !e ? 'none' : isValidEmail(e) ? 'ok' : 'bad'; };
const BMAIL = {
  bill: { title: 'Your bill', head: 'Your bill is ready', intro: 'Here is what is due at {h}. You can pay with any UPI app using the button below.' },
  reminder: { title: 'Payment reminder', head: 'A gentle reminder', intro: 'This is a gentle reminder from {h}. The following is still pending.' },
};
function bulkMailPlan(kind = 'bill', opts = {}) {
  const ym = ymOf(today());
  let list = kind === 'reminder' ? dueList(true).filter(x => x.due > 0)
    // a bill mail is about this month's bill: everyone who owes something, plus anyone whose bill is not complete yet (so it can be shown as pending)
    : activeRes().map(r => ({ r, due: resDue(r.id), od: resOverdue(r.id) })).filter(x => x.due > 0 || !isBillingComplete(x.r.id, ym).complete);
  if (opts.only) list = list.filter(x => opts.only.has(x.r.id));
  const day = bmailDay(kind), out = { kind, total: list.length, todo: [], done: [], noEmail: [], blocked: [], emailed: 0, appOnly: 0, at: day.ts || '', day };
  for (const x of list) {
    if ((day.mailed || []).includes(x.r.id)) { out.done.push(x); out.emailed++; continue; }
    if ((day.appOnly || []).includes(x.r.id)) { out.done.push(x); out.appOnly++; continue; }
    if (kind === 'bill') {
      const c = isBillingComplete(x.r.id, ym);
      if (!c.complete) { out.blocked.push({ ...x, reason: c.reason || '', why: /electricity/i.test(c.reason || '') ? 'reading' : /invoice/i.test(c.reason || '') ? 'bill' : /rent/i.test(c.reason || '') ? 'rent' : 'other' }); continue; }
      if (!(x.due > 0)) continue;   // complete and nothing to pay: nothing to send
    }
    if (emailState(x.r) === 'ok') out.todo.push(x); else out.noEmail.push(x);
  }
  return out;
}
const bmailLines = r => openInv(r.id).map(i => `${i.title}: ${rs(invBal(i))}`).join('\n');
async function sendBulkMail(kind = 'bill', opts = {}) {
  const plan = bulkMailPlan(kind, opts), cfg = BMAIL[kind] || BMAIL.bill, h = Store.hostel() || {}, demo = mailIsSimulated();
  const everyone = [...plan.todo, ...plan.noEmail];
  if (!everyone.length) return { status: plan.done.length ? 'already' : 'nobody', plan, sent: 0, failed: 0, noEmail: 0 };
  let sent = 0, failed = 0, reason = '';
  const mailedIds = [], appIds = [], failedMap = {};
  const items = plan.todo.map(x => ({ x, item: { to: x.r.email, subject: `${h.name || 'Hostel'} · ${t(cfg.title)}`, text: billMessage(x.r, kind === 'reminder' ? 'reminder' : 'bill').text, res_id: x.r.id,
    brand: { hostelName: h.name || 'Hostel', title: t(cfg.title), headline: t(cfg.head), recipientName: x.r.name, intro: t(cfg.intro, { h: h.name || 'your hostel' }), bodyLines: bmailLines(x.r), amountDue: x.due, payLink: payLinkFor(x.r, x.due, undefined), payLinks: payLinksFor(x.r).length > 1 ? payLinksFor(x.r) : undefined, date: fmtDate(today()) } } }));
  const replyTo = (S().pay || {}).email || undefined;
  try {
    // 25 to a request: one login check and one rate-limit hit for 25 mails, and the mail service takes them as one batch
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      let res = [];
      if (demo || typeof Backend === 'undefined' || !Backend.admin) res = chunk.map(() => ({ delivered: true, demo: true }));
      else {
        try { const r = await Backend.admin('send_bulk_emails', { hostel_id: (Store.ctx && Store.ctx.hostelId) || h.id, hostel_name: h.name, reply_to: replyTo, items: chunk.map(c => c.item) }); res = (r && r.results) || []; }
        catch (e) { res = chunk.map(() => ({ delivered: false, reason: e.message || 'failed' })); }
      }
      chunk.forEach((c, k) => { const o = res[k] || {}; if (o.delivered) { sent++; mailedIds.push(c.x.r.id); } else { failed++; const why = o.status === 'not_configured' ? 'not_configured' : o.reason || 'failed'; failedMap[c.x.r.id] = String(why).slice(0, 80); reason = reason || why; } });
    }
  } finally {
    // the in-app notice goes to everyone who was mailed, and to those with no e-mail (they get only this); remembered in ONE row
    for (const x of plan.noEmail) appIds.push(x.r.id);
    for (const c of items) if (mailedIds.includes(c.x.r.id)) notify({ to: 'res', resId: c.x.r.id, title: t(cfg.title), body: c.item.text, category: 'fee', link: 'r-home' });
    for (const x of plan.noEmail) notify({ to: 'res', resId: x.r.id, title: t(cfg.title), body: billMessage(x.r, kind === 'reminder' ? 'reminder' : 'bill').text, category: 'fee', link: 'r-home' });
    bmailSave(kind, today(), mailedIds, appIds, failedMap);
  }
  return { status: 'sent', plan, sent, failed, reason, noEmail: plan.noEmail.length, demo };
}
// A notice to everyone, by e-mail, once per notice (the notice is already in every resident's app).
async function sendNoticeMail(n) {
  const kind = 'notice', h = Store.hostel() || {}, demo = mailIsSimulated(), day = bmailDay(kind, n.id);
  const list = activeRes().filter(r => r.email && isValidEmail(r.email) && !(day.mailed || []).includes(r.id));
  if (!list.length) return { status: 'already', sent: 0, failed: 0 };
  let sent = 0, failed = 0; const ids = [];
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25), items = chunk.map(r => ({ to: r.email, subject: `${h.name || 'Hostel'} · ${n.title}`, text: n.body || '', res_id: r.id, brand: { hostelName: h.name || 'Hostel', title: t('Notice'), headline: n.title, recipientName: r.name, intro: n.body || '', bodyLines: '', date: fmtDate(today()) } }));
    let res; if (demo || typeof Backend === 'undefined' || !Backend.admin) res = chunk.map(() => ({ delivered: true }));
    else { try { res = ((await Backend.admin('send_bulk_emails', { hostel_id: (Store.ctx && Store.ctx.hostelId) || h.id, hostel_name: h.name, reply_to: (S().pay || {}).email || undefined, items })) || {}).results || []; } catch (e) { res = []; } }
    chunk.forEach((r, k) => { if ((res[k] || {}).delivered) { sent++; ids.push(r.id); } else failed++; });
  }
  bmailSave(kind, n.id, ids, []);
  return { status: 'sent', sent, failed, demo };
}
// What "Create missing bills" would make for this month (rent, mess, extra charges), without making anything.
function billsToCreate(ym = ymOf(today())) {
  const prev = runMonthlyBillingBatch({ ym, options: { previewOnly: true } }), out = { people: [], rent: 0, mess: 0, charges: 0, count: 0 };
  for (const x of prev.residents) {
    if (!x.invoices.length) continue;
    const kinds = x.invoices.map(id => (String(id).startsWith('inv-mess-') ? 'mess' : String(id).startsWith('inv-chg-') ? 'charges' : 'rent'));
    kinds.forEach(k => { out[k]++; out.count++; });
    out.people.push({ resId: x.resId, name: x.name, roomNo: x.roomNo, kinds });
  }
  return out;
}
// Bill text for a resident: every open invoice + total + UPI pay link.
function billMessage(r, kind = 'bill', invs) {
  const open = invs || openInv(r.id), total = sum(open, invBal), lang = waLang(r);
  const lines = open.map(i => `${i.title}: ${rs(invBal(i))}`).join('\n');
  const note = `${r.name.split(' ')[0]} ${roomName(r.roomId)} ${(Store.hostel() || {}).name || ''}`.trim();
  const invId = open.length === 1 ? open[0].id : undefined;
  return { total, text: tpl(kind, { name: r.name.split(' ')[0], hostel: (Store.hostel() || {}).name, lines, total: rs(total), paylink: (() => { const L = invs ? [] : payLinksFor(r); return L.length > 1 ? L.map(x => `${t(x.label)} (${rs(x.amount)}):\n${x.url}`).join('\n\n') : (L.length === 1 ? L[0].url : payLink(total, note, { resId: r.id, invId })) || t('(ask owner for UPI)'); })(), link: appUrl() }, lang) };
}
function receiptMessage(pay) {
  const r = resById(pay.resId);
  return tpl('receipt', { name: r.name.split(' ')[0], amount: rs(pay.amount), mode: pay.mode.toUpperCase(), date: fmtDate(pay.date), no: pay.no, balance: rs(resDue(r.id)), hostel: (Store.hostel() || {}).name }, waLang(r));
}

/* ===================================================================== resident attendance
 * Everyone is present unless the owner says otherwise, so only the absences are stored: one
 * record per resident per month holding the day numbers and which roll calls were missed. A
 * 50-bed hostel for a whole year is then 600 small rows instead of 18,000 - which is what
 * keeps this feature inside the free database tier.
 *
 * How many roll calls there are in a day, and when, is up to the owner (Settings ->
 * Attendance), because a girls' PG with a 9 pm gate and a working-men's hostel with none at
 * all are both normal.
 */
const attOn = () => orgEnabled('attendance') && S().attend.on !== false;
const attPeriods = () => (S().attend.periods || []).filter(p => p && p.k);
const attPeriod = k => attPeriods().find(p => p.k === k) || { k, l: k, time: '' };
const attId = (resId, ym) => `ratt-${resId}-${ym}`;
const attDoc = (resId, ym) => Store.get(attId(resId, ym)) || { id: attId(resId, ym), resId, ym, days: {} };
const attAbsentOn = (resId, date, pk) => ((attDoc(resId, ymOf(date)).days || {})[+String(date).slice(8)] || []).includes(pk);
// Marks (or unmarks) one resident absent for one roll call. An empty month is removed rather
// than left behind as a row full of nothing.
function attSet(resId, date, pk, absent) {
  const r = resById(resId); if (!r) return null;
  const ym = ymOf(date), key = String(+String(date).slice(8));
  const doc = clone(attDoc(resId, ym));
  const days = doc.days || (doc.days = {});
  const cur = new Set(days[key] || []);
  if (absent) cur.add(pk); else cur.delete(pk);
  if (cur.size) days[key] = [...cur]; else delete days[key];
  if (!Object.keys(days).length) { if (Store.get(doc.id)) Store.remove(doc.id); return null; }
  return Store.put('ratt', { ...doc, resId, roomId: r.roomId, ym, days });
}
// Who is here and who is not, for one roll call on one day. `absent` is a count because that
// is what every screen shows; `absentList` is the people behind it.
function attRoll(date, pk) {
  const list = activeRes().filter(r => activeOn(r, date)).sort(by('name'));
  const absentList = list.filter(r => attAbsentOn(r.id, date, pk));
  return { list, absentList, total: list.length, absent: absentList.length, present: list.length - absentList.length };
}
/* Taking a roll call: one small record per day + roll call (ids of residents already called), so the
 * list can be split into "waiting to be called" and "already called". Days before today that have no
 * record (taken the old way, absences only) show everybody as already called. */
const rcallId = (d, pk) => `rcall-${d}-${pk}`;
const rcallDone = (d, pk) => new Set((Store.get(rcallId(d, pk)) || {}).ids || []);
function rcallMark(resId, date, pk, absent) {
  attSet(resId, date, pk, absent);
  const doc = Store.get(rcallId(date, pk)) || { id: rcallId(date, pk), date, pk, ids: [] };
  if (!doc.ids.includes(resId)) Store.put('rcall', { ...doc, ids: [...doc.ids, resId], at: nowIso(), by: (Store.me && Store.me.full_name) || '' });
}
function rcallUndo(resId, date, pk) {
  attSet(resId, date, pk, false);
  const doc = Store.get(rcallId(date, pk)); if (!doc) return;
  Store.put('rcall', { ...doc, ids: doc.ids.filter(x => x !== resId) });
}
function attRollCall(date, pk) {
  const base = attRoll(date, pk), done = rcallDone(date, pk);
  const legacy = date < today() && !Store.get(rcallId(date, pk));
  const called = base.list.filter(r => legacy || done.has(r.id));
  const waiting = base.list.filter(r => !called.includes(r));
  return { ...base, called, waiting, legacy };
}
// One resident's month. Days after today do not count as present yet.
function attMonth(resId, ym) {
  const days = attDoc(resId, ym).days || {};
  const last = ym === ymOf(today()) ? +today().slice(8) : ym > ymOf(today()) ? 0 : daysIn(ym);
  let absent = 0, absentDays = [];
  for (let d = 1; d <= last; d++) if ((days[d] || []).length) { absent++; absentDays.push(d); }
  return { days: last, absent, present: Math.max(0, last - absent), absentDays, raw: days };
}

/* ===================================================================== resident messages
 * Residents could already raise a complaint about the hostel. This is the other half: telling
 * the owner something about themselves - unwell, going home for the weekend, back late. It
 * lives on the same screen as complaints because that is where an owner looks for "what have
 * my residents said", but it is a separate record kind so the repair workflow, the open
 * complaint count and the notification badge all stay exactly as they were.
 */
const RINFO_TYPES = [
  ['illness', 'Not well / illness', 'alert'],
  ['out', 'Going out / going home', 'door'],
  ['absent', 'Will be absent', 'cal'],
  ['late', 'Will return late', 'clock'],
  ['other', 'Something else', 'chat'],
];
const rinfoRow = k => RINFO_TYPES.find(x => x[0] === k) || [k, k, 'chat'];
const rinfoLabel = k => t(rinfoRow(k)[1]);
const rinfoIcon = k => rinfoRow(k)[2];
const rinfos = () => Store.all('rinfo');
const rinfoUnread = () => rinfos().filter(x => x.status !== 'seen');
// Messages that cover a given day - used to explain an absence on the attendance sheet.
const rinfoCovering = (resId, date) => rinfos().filter(x => x.resId === resId
  && (x.from ? x.from <= date && (x.to || x.from) >= date : x.date === date));
function sendRinfo({ resId, type, from = '', to = '', text = '' }) {
  const r = resById(resId); if (!r) throw new AppError('Resident not found');
  if (from && to && to < from) throw new AppError('End date is before start date');
  const x = Store.put('rinfo', {
    resId, roomId: r.roomId, type, from: from || null, to: to || from || null,
    text: String(text || '').trim(), status: 'new', date: today(), ts: nowIso()
  });
  notify({
    to: 'admin', title: rinfoLabel(type), link: 'complaints',
    body: `${r.name} - ${roomName(r.roomId)}${x.text ? ': ' + x.text : ''}`
  });
  return x;
}
function rinfoReply(id, reply = '') {
  const x = Store.get(id); if (!x) return null;
  Store.patch(id, { status: 'seen', reply: String(reply || '').trim(), seenAt: nowIso(), seenBy: Store.me && Store.me.full_name });
  if (x.resId) notify({ to: 'res', resId: x.resId, title: t('Owner saw your message'), body: reply || t('Noted') });
  return Store.get(id);
}

/* ===================================================================== notifications & log */
// to: 'admin' | 'res' (needs resId) | 'staff' (needs staffId) | 'cook' | 'role:<role>'
let SEEDING = false;
function notify({ to, resId, staffId, title, body = '', link = '', id, category = 'general' }) {
  if (SEEDING) return null;
  // a resident's own row-level access needs res_id on everything they create
  if (!resId && isResident()) resId = ctx().refId;
  const n = Store.put('ntf', { id: id || undefined, to, resId: resId || null, staffId: staffId || null, title, body, link, category, date: today(), ts: nowIso(), read: false });
  // Browser push notification dispatch if registered
  if (typeof Pwa !== 'undefined' && Pwa.dispatchPush) {
    Pwa.dispatchPush({ to, resId, staffId, title, body, link, category, id: n.id });
  }
  return n;
}
function myNotifs() {
  const c = ctx(), all = Store.all('ntf').filter(n => !n.dismissed);
  let list;
  if (isAdmin()) list = all.filter(n => n.to === 'admin');
  else if (isResident()) list = all.filter(n => n.to === 'res' && n.resId === c.refId);
  else list = all.filter(n => (n.to === 'staff' && n.staffId === c.refId) || n.to === 'role:' + c.role);
  return list.sort(by('ts', -1));
}
function alog(rule, msg, meta = {}) {
  const actor = (typeof Store !== 'undefined' && Store.me)
    ? { id: Store.me.id, name: Store.me.full_name, role: (Store.ctx || {}).role || 'user' }
    : { id: 'system', name: 'System', role: 'system' };
  return Store.put('log', { date: today(), ts: nowIso(), rule, msg, actor, meta: meta || {} });
}

/* ===================================================================== rooms & residents */
function bedsOf(room) { return room && room.beds ? room.beds : []; }
function vacantBeds() {
  const out = [];
  for (const r of rooms()) {
    for (const b of bedsOf(r)) {
      const res = b.resId ? resById(b.resId) : null;
      const isOcc = b.status === 'occ' && res && (res.status === 'active' || res.status === 'notice');
      if (b.status === 'vac' || (!isOcc && b.status !== 'mnt')) out.push({ room: r, bed: b });
    }
  }
  return out;
}
function occupancy() {
  let total = 0, occ = 0;
  for (const r of rooms()) {
    for (const b of bedsOf(r)) {
      if (b.status !== 'mnt') total++;
      const res = b.resId ? resById(b.resId) : null;
      if (b.status === 'occ' && res && (res.status === 'active' || res.status === 'notice')) occ++;
    }
  }
  return { total, occ, vac: Math.max(0, total - occ), pct: pct(occ, total) };
}
function setBed(roomId, bedId, patch) {
  const room = roomById(roomId); if (!room) return;
  room.beds = bedsOf(room).map(b => (b.id === bedId ? { ...b, ...patch } : b));
  Store.put('room', room);
}

function reconcileBeds() {
  if (typeof Store === 'undefined' || typeof Store.all !== 'function') return false;
  const allRes = Store.all('res');
  const activeMap = new Map();
  for (const r of allRes) {
    if (r.status === 'active' || r.status === 'notice') {
      activeMap.set(r.id, r);
    }
  }

  let changed = false;
  for (const room of Store.all('room')) {
    let roomDirty = false;
    const curBeds = bedsOf(room);
    const newBeds = curBeds.map(b => {
      if (b.status === 'occ') {
        const r = b.resId ? activeMap.get(b.resId) : null;
        if (!r || r.roomId !== room.id || r.bed !== b.id) {
          roomDirty = true;
          return { ...b, status: 'vac', resId: null };
        }
      } else if (b.status === 'vac' && b.resId) {
        roomDirty = true;
        return { ...b, resId: null };
      }
      return b;
    });

    if (roomDirty) {
      room.beds = newBeds;
      Store.put('room', room);
      changed = true;
    }
  }

  for (const r of activeMap.values()) {
    if (r.roomId && r.bed) {
      const room = roomById(r.roomId);
      if (room) {
        const bed = bedsOf(room).find(b => b.id === r.bed);
        if (bed && (bed.status !== 'occ' || bed.resId !== r.id)) {
          room.beds = bedsOf(room).map(b => b.id === r.bed ? { ...b, status: 'occ', resId: r.id } : b);
          Store.put('room', room);
          changed = true;
        }
      }
    }
  }

  return changed;
}

function rentDue(ym) { const d = Math.min(S().rent.day, daysIn(ym)); return `${ym}-${pad(d)}`; }
/* Rent billing cycle (Settings > Rent & billing):
 *   advance  the month's rent is billed at the start of the month (the bill day), before the month is lived.
 *   arrears  the rent is billed once the month is over (its last day), for the days actually stayed.
 * Nothing is raised before its billing date, so a full month never shows as due early. */
const rentCycleMode = () => ((S().rent || {}).cycle === 'arrears' ? 'arrears' : 'advance');
const isArrears = () => rentCycleMode() === 'arrears';
const rentBillDate = ym => (isArrears() ? `${ym}-${pad(daysIn(ym))}` : rentDue(ym));
const rentBillable = ym => today() >= rentBillDate(ym);
// The rent bills that are due to be raised for one resident today (none are raised before their date, none twice).
function rentBillsToRaise(r, d0 = today()) {
  const pol = r.billingPolicy || S().rent, joining = pol.model === 'joining_date', arrears = isArrears(), out = [];
  const build = c => {
    const id = joining ? `inv-rent-${r.id}-${c.cycleStart}` : `inv-rent-${r.id}-${c.periodKey}`;
    let amount = r.rent;
    if (!joining && c.periodKey === ymOf(r.checkIn) && r.checkIn > c.cycleStart) amount = calcCheckInRent({ checkInDate: r.checkIn, monthlyRent: r.rent }).amount;
    const date = arrears ? c.cycleEnd : c.cycleStart;
    return { id, model: pol.model, amount, date, due: addDays(date, rentDueDays()), period: joining ? c.periodLabel : c.periodKey, title: joining ? `${t('Rent')} (${c.periodLabel})` : `${t('Rent')} ${fmtYM(c.periodKey)}` };
  };
  if (!arrears) {
    const c = residentCycleFor(r, d0);
    if (d0 >= c.cycleStart && (joining || !(r.checkIn > c.cycleStart))) { const b = build(c); if (b.amount > 0 && !Store.get(b.id)) out.push(b); }
    return out;
  }
  // arrears: every finished cycle that has no bill yet (this one and up to two before it, in case the app was not opened)
  let c = residentCycleFor(r, joining ? d0 : ymOf(d0));
  for (let k = 0; k < 3 && c; k++) {
    if (c.cycleEnd <= d0 && c.cycleEnd >= r.checkIn) { const b = build(c); if (b.amount > 0 && !Store.get(b.id)) out.push(b); }
    c = joining ? residentCycleFor(r, addDays(c.cycleStart, -1)) : residentCycleFor(r, addMonths(c.periodKey, -1));
  }
  return out.reverse();
}
/* Leaving early (or on any day that is not the end of the cycle). Works on the CURRENT books, so running it twice
 * never charges twice:
 *   - a bill for the cycle exists (advance): rent for the days not stayed is taken off it. Unpaid part: the bill gets smaller.
 *     Already paid part: it goes back to the resident as credit, so it comes out in the refund.
 *   - no bill yet (arrears, or not raised yet): rent for the days stayed is billed now, and so is any finished earlier
 *     month that was never billed (arrears only). */
function rentCheckoutAdjust(r, checkoutDate) {
  const out = { bills: [], cut: null, usedDays: 0, totalDays: 0, label: '' };
  // Only for hostels whose owner has chosen a billing cycle in Settings > Rent & billing (an untouched hostel keeps its old checkout maths).
  if (!(S().rent || {}).cycleChosen) return out;
  if (!r || !(r.rent > 0) || !r.checkIn) return out;
  const pol = r.billingPolicy || S().rent, joining = pol.model === 'joining_date';
  const idOf = c => (joining ? `inv-rent-${r.id}-${c.cycleStart}` : `inv-rent-${r.id}-${c.periodKey}`);
  const cyc = residentCycleFor(r, joining ? checkoutDate : ymOf(checkoutDate));
  const cycDays = diffDays(cyc.cycleEnd, cyc.cycleStart) + 1, totalDays = (S().rent.prorateDivisor === 'fixed_30' && !joining) ? 30 : cycDays;
  const from = r.checkIn > cyc.cycleStart ? r.checkIn : cyc.cycleStart;
  if (checkoutDate >= from) {
    const stayEnd = checkoutDate < cyc.cycleEnd ? checkoutDate : cyc.cycleEnd;
    const used = diffDays(stayEnd, from) + 1, share = round2(r.rent * Math.min(used, totalDays) / totalDays);
    out.usedDays = used; out.totalDays = totalDays; out.label = `${t('Rent')} ${cyc.periodLabel}`;
    const inv = Store.get(idOf(cyc));
    if (!inv) { if (share > 0 && !(r.left && r.left < cyc.cycleStart)) out.bills.push({ id: idOf(cyc), title: `${out.label} (${used} ${t('days')})`, period: joining ? cyc.periodLabel : cyc.periodKey, amount: share }); }
    else {
      const shouldPay = Math.min(inv.amount, share), excess = round2(inv.amount - shouldPay);
      if (excess >= 0.5 && checkoutDate < cyc.cycleEnd) { const bal = invBal(inv), unpaidCut = Math.min(bal, excess); out.cut = { invId: inv.id, excess, unpaidCut: round2(unpaidCut), creditBack: round2(excess - unpaidCut) }; }
    }
  }
  if (isArrears()) {
    let c = joining ? residentCycleFor(r, addDays(cyc.cycleStart, -1)) : residentCycleFor(r, addMonths(cyc.periodKey, -1));
    for (let k = 0; k < 3 && c; k++) {
      if (c.cycleEnd >= r.checkIn && !Store.get(idOf(c))) {
        let amt = r.rent;
        if (!joining && c.periodKey === ymOf(r.checkIn) && r.checkIn > c.cycleStart) amt = calcCheckInRent({ checkInDate: r.checkIn, monthlyRent: r.rent }).amount;
        if (amt > 0) out.bills.unshift({ id: idOf(c), title: joining ? `${t('Rent')} (${c.periodLabel})` : `${t('Rent')} ${fmtYM(c.periodKey)}`, period: joining ? c.periodLabel : c.periodKey, amount: round2(amt) });
      }
      c = joining ? residentCycleFor(r, addDays(c.cycleStart, -1)) : residentCycleFor(r, addMonths(c.periodKey, -1));
    }
  }
  return out;
}
// Writes the adjustment into the books (used by checkout only; previews just read rentCheckoutAdjust).
function applyRentCheckoutAdjust(r, date) {
  const adj = rentCheckoutAdjust(r, date);
  for (const b of adj.bills) addInvoice({ id: b.id, resId: r.id, roomId: r.roomId, type: 'rent', period: b.period, title: b.title, amount: b.amount, date, due: date, noLate: true });
  if (adj.cut) {
    const inv = Store.get(adj.cut.invId), newAmt = round2(inv.amount - adj.cut.excess), newPaid = Math.max(0, Math.min(inv.paid || 0, round2(newAmt - (inv.waived || 0))));
    const oldPaid = inv.paid || 0, oldAmt = inv.amount;   // Store.patch edits the record in place, so read these first
    Store.patch(inv.id, { amount: newAmt, paid: newPaid, amountBefore: oldAmt, adjustedAtCheckout: date });
    const back = round2(oldPaid - newPaid);
    if (back > 0) Store.patch(r.id, { credit: round2(((resById(r.id) || {}).credit || 0) + back) });
  }
  return adj;
}

/* ===================================================================== multi-cycle billing & settlement */

function residentCycleFor(r, target = today()) {
  const settings = S(r ? r.hostelId : null, r ? r.id : null);
  const rPolicy = (r && r.billingPolicy) || settings.rent;
  const model = rPolicy.model || 'calendar_monthly';
  const targetDate = target.length === 7 ? `${target}-01` : target;
  const targetYM = ymOf(targetDate);

  if (model === 'calendar_monthly') {
    const rentDay = Math.min(rPolicy.day || 1, daysIn(targetYM));
    const cycleStart = `${targetYM}-${pad(rentDay)}`;
    const nextYM = addMonths(targetYM, 1);
    const nextStartDay = Math.min(rPolicy.day || 1, daysIn(nextYM));
    const cycleEnd = addDays(`${nextYM}-${pad(nextStartDay)}`, -1);
    const cycleId = `cycle-cal-${r ? r.id : 'x'}-${targetYM}`;
    return {
      model: 'calendar_monthly',
      cycleId,
      cycleStart,
      cycleEnd,
      periodLabel: fmtYM(targetYM),
      periodKey: targetYM,
      rentDay,
      dueDate: addDays(cycleStart, rPolicy.dueDays || rPolicy.graceDays || 5)
    };
  }

  // Joining-date based billing anniversary
  const checkIn = (r && r.checkIn) || targetDate;
  const annivDay = +checkIn.slice(8, 10);
  const clampedStartDay = Math.min(annivDay, daysIn(targetYM));
  let cycleStart = `${targetYM}-${pad(clampedStartDay)}`;

  if (targetDate < cycleStart && target.length > 7) {
    const prevYM = addMonths(targetYM, -1);
    const prevStartDay = Math.min(annivDay, daysIn(prevYM));
    cycleStart = `${prevYM}-${pad(prevStartDay)}`;
  }

  const cycleStartYM = ymOf(cycleStart);
  const nextYM = addMonths(cycleStartYM, 1);
  const nextClampedStartDay = Math.min(annivDay, daysIn(nextYM));
  const nextCycleStart = `${nextYM}-${pad(nextClampedStartDay)}`;
  const cycleEnd = addDays(nextCycleStart, -1);
  const cycleId = `cycle-anniv-${r ? r.id : 'x'}-${cycleStart}`;

  return {
    model: 'joining_date',
    cycleId,
    cycleStart,
    cycleEnd,
    anniversaryDay: annivDay,
    periodLabel: `${fmtShort(cycleStart)} – ${fmtShort(cycleEnd)}`,
    periodKey: `${cycleStart}_${cycleEnd}`,
    dueDate: addDays(cycleStart, rPolicy.dueDays || rPolicy.graceDays || 5)
  };
}

function calcCheckInRent({ checkInDate = today(), monthlyRent = 0, policy, divisor, customAmount } = {}) {
  const rent = Math.max(0, +monthlyRent || 0);
  const ym = ymOf(checkInDate);
  const dim = daysIn(ym);
  const day = +checkInDate.slice(8, 10);
  const effPolicy = policy !== undefined ? policy : S().rent.prorate;
  const effDivisor = divisor || S().rent.prorateDivisor || 'actual_days';
  const totalDays = effDivisor === 'fixed_30' ? 30 : dim;
  const occupiedDays = dim - day + 1;
  const dailyRate = totalDays > 0 ? round2(rent / totalDays) : 0;

  let amount = rent;
  let formula = 'Full monthly rent';

  if (customAmount != null && !isNaN(customAmount)) {
    amount = Math.max(0, round2(+customAmount));
    formula = 'Custom adjustment';
  } else if (effPolicy === 'next_cycle') {
    amount = 0;
    formula = 'Start billing from next cycle (₹0 first period)';
  } else if (effPolicy === false || effPolicy === 'full') {
    amount = rent;
    formula = `Full month charge (₹${rent})`;
  } else if (day > 1 && effPolicy) {
    amount = round2((rent * occupiedDays) / totalDays);
    formula = `Pro-rata: (₹${rent} × ${occupiedDays} days) / ${totalDays} days divisor`;
  }

  return {
    amount,
    monthlyRent: rent,
    period: ym,
    checkInDate,
    day,
    totalDays,
    occupiedDays,
    dailyRate,
    formula,
    divisor: effDivisor,
    policy: effPolicy
  };
}

function calcDepositAmount({ monthlyRent = 0, bedDeposit = 0, depositSettings } = {}) {
  const cfg = depositSettings || S().deposit || {};
  if (cfg.enabled === false) return { total: 0, refundable: 0, nonRefundable: 0, mode: cfg.mode || 'custom' };
  const rent = Math.max(0, +monthlyRent || 0);
  let total = 0;
  const nonRefundable = cfg.nonRefundable || 0;

  switch (cfg.mode) {
    case 'fixed':
      total = cfg.fixedAmount || 0;
      break;
    case 'rent_multiple':
      total = round2(rent * (cfg.rentMultiplier || 1));
      break;
    case 'per_bed':
      total = bedDeposit || cfg.fixedAmount || rent || 0;
      break;
    case 'custom':
    default:
      total = bedDeposit || cfg.fixedAmount || rent || 0;
      break;
  }

  const refundable = Math.max(0, round2(total - nonRefundable));
  return {
    total: round2(total),
    refundable,
    nonRefundable: round2(nonRefundable),
    mode: cfg.mode || 'custom'
  };
}

// What the check-in form starts the deposit box with, from the hostel's deposit rule (the owner can still change it).
// room.deposit (per bed) is read only when the rule is "room / bed specific".
// A rent bill is due this many days after its bill date. One setting (Rent & billing); graceDays only
// stands in for hostels saved before that.
const rentDueDays = () => { const r = S().rent || {}; return +r.dueDays || +r.graceDays || 5; };
// Rent of one bed: its own price when the owner set one (e.g. 11,000 and 11,500 in the same room), else the room's.
const bedRent = (room, bedId) => { const b = room && (room.beds || []).find(x => x.id === bedId); return b && +b.rent > 0 ? +b.rent : (room ? +room.rent || 0 : 0); };
const depositOn = () => (S().deposit || {}).enabled !== false;
const depositFor = (rent, room) => calcDepositAmount({ monthlyRent: rent, bedDeposit: (S().deposit || {}).mode === 'per_bed' && room ? +room.deposit || 0 : 0 }).total;
const DEPOSIT_RULE_LABEL = { rent_multiple: 'Multiple of monthly rent', fixed: 'Fixed amount', custom: 'Entered at check-in', per_bed: 'Room / bed specific' };
function calcLateFee({ invoice, todayDate = today(), lateSettings } = {}) {
  const cfg = lateSettings || S().lateFee || (S().rent && {
    on: S().rent.lateOn,
    mode: 'fixed',
    amount: S().rent.lateFee,
    dailyAmount: 50,
    percentage: 2,
    maxCap: 1000,
    graceDays: S().rent.graceDays || 5
  }) || {};

  if (!cfg.on && cfg.on !== undefined) return { amount: 0, daysOverdue: 0, mode: 'off', capped: false };
  if (!invoice || !invoice.due || invoice.due >= todayDate || invoice.noLate) return { amount: 0, daysOverdue: 0, mode: cfg.mode, capped: false };

  const daysOverdue = diffDays(todayDate, invoice.due);
  const graceDays = cfg.graceDays != null ? cfg.graceDays : 5;
  if (daysOverdue <= graceDays) return { amount: 0, daysOverdue, mode: cfg.mode, capped: false, withinGrace: true };

  const balance = invBal(invoice);
  if (balance <= 0) return { amount: 0, daysOverdue, mode: cfg.mode, capped: false };

  const chargeableDays = daysOverdue - graceDays;
  let rawAmount = 0;

  switch (cfg.mode) {
    case 'daily':
      rawAmount = (cfg.dailyAmount || 50) * chargeableDays;
      break;
    case 'percentage':
      rawAmount = round2((balance * (cfg.percentage || 2)) / 100);
      break;
    case 'fixed':
    default:
      rawAmount = cfg.amount || 200;
      break;
  }

  const maxCap = cfg.maxCap != null ? cfg.maxCap : 1000;
  const amount = Math.min(rawAmount, maxCap);
  const capped = rawAmount > maxCap;

  return {
    amount: round2(amount),
    rawAmount: round2(rawAmount),
    daysOverdue,
    chargeableDays,
    mode: cfg.mode || 'fixed',
    capped,
    maxCap
  };
}

function calcSettlement({ resId, checkoutDate = today(), deductions = 0, noticeDate = null, notes = '', ...opts } = {}) {
  const r = resById(resId);
  if (!r) throw new AppError('Resident not found');
  const room = roomById(r.roomId);
  const s = S(r.hostelId, r.id);
  const checkoutCfg = s.checkout || {};
  deductions = round2(Math.max(0, +deductions || 0));

  const depPaid = round2(sum(resInvoices(resId).filter(i => i.type === 'deposit'), i => i.paid || 0));
  // The non-refundable fee was fixed for this resident at check-in (r.depositFee), so a later change of the
  // hostel setting never alters an old resident. It is part of the deposit and is kept first.
  // Deposit marked not refundable at check-in (Settings > Deposit): all of it is kept, nothing is returned.
  const nonRefundable = r.depositRefundable === false ? depPaid : Math.min(depPaid, round2(Math.max(0, +r.depositFee || 0)));
  const refundableDeposit = round2(depPaid - nonRefundable);
  const unpaidInvs = openInv(resId).filter(i => i.type !== 'deposit');
  let dues = round2(sum(unpaidInvs, invBal));
  // Rent for the part month: billed (arrears / not raised yet) or taken off (advance, left early). Already applied = checkout ran it.
  const rentAdj = opts.rentAdjustApplied || rentCheckoutAdjust(r, checkoutDate);
  if (!opts.rentAdjustApplied) dues = round2(dues + sum(rentAdj.bills, b => b.amount) - (rentAdj.cut ? rentAdj.cut.unpaidCut : 0));
  const rentCredit = !opts.rentAdjustApplied && rentAdj.cut ? rentAdj.cut.creditBack : 0;

  // Notice period shortfall check
  const requiredNoticeDays = checkoutCfg.noticeDaysRequired != null && !isNaN(+checkoutCfg.noticeDaysRequired) ? +checkoutCfg.noticeDaysRequired : 30;
  let noticeDaysGiven = 0;
  let shortfallDays = 0;
  let shortfallFee = 0;

  if (checkoutCfg.shortfallPenalty && (noticeDate || r.noticeDate || (opts && opts.applyShortfall))) {
    if (noticeDate) {
      noticeDaysGiven = Math.max(0, diffDays(checkoutDate, noticeDate));
      if (noticeDaysGiven < requiredNoticeDays) {
        shortfallDays = requiredNoticeDays - noticeDaysGiven;
      }
    } else if (r.noticeDate) {
      noticeDaysGiven = Math.max(0, diffDays(checkoutDate, r.noticeDate));
      if (noticeDaysGiven < requiredNoticeDays) {
        shortfallDays = requiredNoticeDays - noticeDaysGiven;
      }
    } else if (opts && opts.applyShortfall) {
      shortfallDays = requiredNoticeDays;
    }
    const ym = ymOf(checkoutDate);
    const dailyRate = round2((r.rent || 0) / daysIn(ym));
    shortfallFee = round2(dailyRate * shortfallDays);
    // the owner can set the fee instead of "rent for the missing days": a fixed amount per missing day, or one flat amount
    const amt = Math.max(0, +checkoutCfg.shortfallAmount || 0);
    if (checkoutCfg.shortfallMode === 'per_day') shortfallFee = round2(amt * shortfallDays);
    else if (checkoutCfg.shortfallMode === 'flat') shortfallFee = shortfallDays > 0 ? round2(amt) : 0;
  }

  // Calculate final electricity consumption if reading is provided
  let elecShare = opts.elecShare || null;
  const reading = opts.reading != null ? opts.reading : opts.meterNow;
  if (!elecShare && reading !== undefined && reading !== null && reading !== '' && !isNaN(reading) && orgEnabled('electricity') && r.roomId) {
    const last = lastMeter(r.roomId);
    const p = last ? last.curr : 0;
    const curr = +reading;
    if (curr > p) {
      const units = round2(curr - p);
      const prevDate = last ? last.date : null;
      const occ = meterOccupants(r.roomId, prevDate, checkoutDate);
      const partial = occ.some(o => o[1] < 1);
      const rate = S().elec.rate;
      const exitDim = daysIn(ymOf(checkoutDate)), exitExtra = +checkoutDate.slice(8, 10) === exitDim ? {} : { [resId]: 1 / exitDim };
      const shares = splitElectricity(r.roomId, units, rate, occ.map(o => o[0]), partial ? occ.map(o => o[1]) : null, freeMonths(prevDate, checkoutDate), exitExtra);
      const sShare = shares.find(x => x.resId === resId);
      if (sShare) {
        elecShare = {
          ...sShare,
          prev: p,
          curr,
          roomUnits: units,
          prevDate,
          rate
        };
        if (sShare.amount > 0) {
          // Add to dues only if not already billed into an open invoice on checkoutDate
          const alreadyBilled = unpaidInvs.some(i => i.type === 'electricity' && (i.date === checkoutDate || (i.period && i.period === ymOf(checkoutDate))));
          if (!alreadyBilled) {
            dues = round2(dues + elecShare.amount);
          }
        }
      }
    }
  }

  const availableDepositAndCredit = round2(refundableDeposit + (r.credit || 0) + rentCredit);
  const totalLiabilities = round2(dues + deductions + shortfallFee);

  if (deductions > availableDepositAndCredit) {
    throw new AppError('Deductions cannot exceed the remaining deposit and credit');
  }

  const settleFromDeposit = Math.min(availableDepositAndCredit, dues);
  const refund = Math.max(0, round2(availableDepositAndCredit - totalLiabilities));
  const balancePayable = Math.max(0, round2(totalLiabilities - availableDepositAndCredit));

  return {
    resId,
    name: r.name,
    phone: r.phone,
    roomNo: room ? room.no : '',
    bed: r.bed || '',
    checkIn: r.checkIn,
    checkoutDate,
    noticeDate: noticeDate || r.noticeDate || null,
    requiredNoticeDays,
    noticeDaysGiven,
    shortfallDays,
    shortfallFee,
    depositPaid: depPaid,
    depositRule: r.depositRule || null,
    nonRefundable,
    refundableDeposit,
    credit: r.credit || 0,
    availableDepositAndCredit,
    unpaidDues: dues,
    rentAdjust: rentAdj,
    rentCycle: rentCycleMode(),
    elecShare,
    deductions,
    totalLiabilities,
    settleFromDeposit,
    refund,
    balancePayable,
    notes,
    unpaidInvoices: [
      ...unpaidInvs.map(i => ({ id: i.id, title: i.title, type: i.type, amount: i.amount, balance: !opts.rentAdjustApplied && rentAdj.cut && rentAdj.cut.invId === i.id ? Math.max(0, round2(invBal(i) - rentAdj.cut.unpaidCut)) : invBal(i) })),
      ...(opts.rentAdjustApplied ? [] : rentAdj.bills.map(b => ({ id: b.id, title: b.title, type: 'rent', amount: b.amount, balance: b.amount }))),
      ...(elecShare && elecShare.amount > 0 && !unpaidInvs.some(i => i.type === 'electricity' && (i.date === checkoutDate || (elecShare.invId && i.id === elecShare.invId))) ? [{
        id: elecShare.invId || 'inv-el-checkout-simulated',
        title: `${t('Electricity')} (${num(elecShare.billable)} ${t('units')} · final reading)`,
        type: 'electricity',
        amount: elecShare.amount,
        balance: elecShare.amount
      }] : [])
    ]
  };
}

// Check-in: resident record, bed, first rent (pro-rated) and deposit invoices. Returns the resident.
function checkIn(o) {
  if (!canAction('create')) throw new AppError('Unauthorized: insufficient permissions to check in resident');
  const room = roomById(o.roomId); if (!room) throw new Error('Choose a room');
  const bed = bedsOf(room).find(b => b.id === o.bed);
  if (!bed || bed.status !== 'vac') throw new Error('That bed is not vacant any more');
  const name = String(o.name || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Resident name is required');
  const phone = phone10(o.phone);
  if (!phone || phone.length !== 10) throw new Error('Enter a valid 10-digit mobile number');
  // the form checked this, but admitting a QR applicant, importing, or any other caller did not
  if (allResidents().some(x => x.status !== 'left' && x.status !== 'cancelled' && phone10(x.phone) === phone)) throw new Error('A resident with this mobile number already exists');
  const id = o.id || uid('res-');
  const rent = o.rent === '' || o.rent == null || isNaN(o.rent) ? +room.rent || 0 : Math.max(0, +o.rent || 0);
  const deposit = Math.max(0, +o.deposit || 0);
  const r = Store.put('res', { id, resId: id, name, phone, guardian: o.guardian || '', guardianPhone: phone10(o.guardianPhone), email: o.email || '', idNo: o.idNo || '', address: o.address || '', college: o.college || '', roomId: room.id, bed: bed.id, rent, deposit, depositRefundable: (S().deposit || {}).refundable !== false, depositFee: deposit > 0 ? Math.min(deposit, round2(Math.max(0, +(S().deposit || {}).nonRefundable || 0))) : 0, depositRule: (S().deposit || {}).mode || 'custom', checkIn: o.checkIn || today(), status: 'active', credit: 0, food: o.food !== false, docs: [], lang: o.lang || 'en', notes: o.notes || '', billingPolicy: o.billingPolicy || null, accessories: Array.isArray(o.accessories) && o.accessories.length ? { given: o.accessories.slice(), at: o.checkIn || today(), returned: null, missing: [] } : null });
  setBed(room.id, bed.id, { status: 'occ', resId: r.id });
  const ym = ymOf(r.checkIn);
  const rPolicy = (o.billingPolicy) || S(null, r.id).rent || {};
  const isJoiningDate = rPolicy.model === 'joining_date';
  let first = 0, firstTitle = '', firstPeriod = ym;
  let formula = '';

  if (isJoiningDate) {
    const cycle = residentCycleFor(r, r.checkIn);
    first = o.firstRent != null && !isNaN(o.firstRent) ? Math.max(0, +o.firstRent) : r.rent;
    firstTitle = `${t('Rent')} ${cycle.periodLabel}`;
    firstPeriod = cycle.periodLabel;
    formula = `Anniversary cycle (${cycle.periodLabel}): ₹${first}`;
  } else {
    const checkCalc = calcCheckInRent({
      checkInDate: r.checkIn,
      monthlyRent: r.rent,
      policy: (o.billingPolicy && o.billingPolicy.prorate) !== undefined ? o.billingPolicy.prorate : S().rent.prorate,
      divisor: (o.billingPolicy && o.billingPolicy.prorateDivisor) || S().rent.prorateDivisor,
      customAmount: o.firstRent
    });
    first = checkCalc.amount;
    firstTitle = `${t('Rent')} ${fmtYM(ym)}${first !== r.rent ? ' (' + t('pro-rata') + ')' : ''}`;
    formula = checkCalc.formula;
  }

  if (r.rent > 0 && first > 0 && !isArrears()) {
    addInvoice({
      id: `inv-rent-${r.id}-${ym}`,
      resId: r.id,
      roomId: room.id,
      type: 'rent',
      period: firstPeriod,
      title: firstTitle,
      amount: first,
      date: r.checkIn,
      due: addDays(r.checkIn, 2),
      policySnapshot: { model: rPolicy.model || S().rent.model, formula }
    });
  }
  if (r.deposit > 0) addInvoice({ id: `inv-dep-${r.id}`, resId: r.id, roomId: room.id, type: 'deposit', title: t('Security deposit'), amount: r.deposit, date: r.checkIn, due: addDays(r.checkIn, 2) });
  notify({ to: 'admin', title: t('New check-in'), body: `${r.name} · ${room.no}-${bed.id}` });
  return r;
}
/* ===================================================================== previous entry (resident who was already staying)
 * The rows of the old-bills table: one per month from the check-in month to this month. 'monthly' = the resident paid
 * month by month; 'yearly' / 'custom' = one lump sum paid up to a date (months up to then are locked as paid). */
function prevEntryRows({ checkIn, rent, type = 'monthly', paidTill = '', paidTotal = null, skipYm = null } = {}) {
  if (!checkIn || !(checkIn <= today())) return [];
  const cur = ymOf(today()), first = ymOf(checkIn), lump = type !== 'monthly';
  const lastCov = lump && paidTill ? ymOf(paidTill) : '';
  const last = lastCov && lastCov > cur ? lastCov : cur;     // an advance can run into the future
  const monthly = Math.max(0, +rent || 0), rows = [];
  for (let ym = first, n = 0; ym <= last && n < 120; ym = addMonths(ym, 1), n++) {
    if (skipYm && skipYm(ym)) continue;
    const locked = !!lastCov && ym <= lastCov, future = ym > cur;
    let amt = monthly;
    if (lump && ym === first) amt = calcCheckInRent({ checkInDate: checkIn, monthlyRent: monthly, policy: S().rent.prorate, divisor: S().rent.prorateDivisor }).amount;
    rows.push({ ym, rent: amt, elec: '', other: 0, locked, future, rentPaid: !lump || locked, elecPaid: !lump, otherPaid: !lump });
  }
  // The lump sum is spread over the paid months in proportion to their rent (a part-month stays smaller);
  // the monthly amount that comes out is what each month is booked at.
  const cov = rows.filter(r => r.locked), tot = +paidTotal;
  if (lump && tot > 0 && cov.length) {
    const w = sum(cov, r => r.rent); let used = 0;
    cov.forEach((r, i) => { r.rent = i === cov.length - 1 ? round2(tot - used) : round2(w > 0 ? tot * r.rent / w : tot / cov.length); used = round2(used + r.rent); });
  }
  return rows;
}
// Creates the old bills of a resident who has just been checked in and records what they already paid.
// Yearly / custom: the lump sum is booked as rent for every month up to the paid-till date and the resident
// is marked "paid till" that date, so no bill goes out for that period.
function applyPreviousEntry(resId, rows, { type = 'monthly', paidTill = '', depositPaid = false } = {}) {
  const r = resById(resId); if (!r) throw new Error('Resident not found');
  const out = { invoices: 0, payments: 0, paid: 0 }, payPlan = [];
  const dateOf = ym => (ym === ymOf(r.checkIn) ? r.checkIn : ym + '-01');
  for (const row of rows) {
    const ym = row.ym, date = dateOf(ym), due = addDays(date, 4), ids = [], noExtras = ym > ymOf(today());
    const mk = (id, kind, title, amount) => {
      if (!(+amount > 0)) return null;
      let inv = Store.get(id);
      if (!inv) { inv = addInvoice({ id, resId, roomId: r.roomId, type: kind, period: ym, title, amount: +amount, date, due }); out.invoices++; }
      if (!inv.noLate) Store.patch(inv.id, { noLate: true, prev: true });
      return inv;
    };
    const rentInv = mk(`inv-rent-${r.id}-${ym}`, 'rent', `${t('Rent')} ${fmtYM(ym)}`, row.rent);
    const elInv = noExtras ? null : mk(`inv-el-prev-${r.id}-${ym}`, 'electricity', `${t('Electricity')} ${fmtYM(ym)}`, row.elec);
    const otInv = noExtras ? null : mk(`inv-other-prev-${r.id}-${ym}`, 'other', `${t('Other charges')} ${fmtYM(ym)}`, row.other);
    if (rentInv && row.rentPaid) ids.push(rentInv.id);
    if (elInv && row.elecPaid) ids.push(elInv.id);
    if (otInv && row.otherPaid) ids.push(otInv.id);
    if (ids.length) payPlan.push({ date, ids });
  }
  const lump = type !== 'monthly' && paidTill && rows.some(x => x.locked);
  for (const p of payPlan) {
    const amount = round2(sum(p.ids, id => invBal(Store.get(id) || {})));
    if (!(amount > 0)) continue;
    recordPayment({ resId, amount, mode: 'cash', date: p.date > today() ? today() : p.date, note: lump ? `${t('Previous entry')} · ${t('rent paid till {d}', { d: fmtDate(paidTill) })}` : t('Previous entry'), only: p.ids, silent: true });
    out.payments++; out.paid = round2(out.paid + amount);
  }
  if (lump) Store.patch(resId, { paidTill, paidTillAmount: round2(sum(rows.filter(x => x.locked), x => x.rent)) });
  if (depositPaid) {
    const dep = Store.get(`inv-dep-${r.id}`);
    if (dep && invBal(dep) > 0) { recordPayment({ resId, amount: invBal(dep), mode: 'cash', date: r.checkIn, note: t('Previous entry'), only: [dep.id], silent: true }); out.payments++; }
  }
  alog('previous_entry', `${r.name}: ${out.invoices} old bills added, ${inr(out.paid)} marked paid`, { resId, ...out });
  return out;
}
// The login link in the admission message carries the User ID and password after a "#": that part never goes to any server,
// the login page reads it, fills the two boxes and removes it from the address bar at once. Same details as the message text.
function loginLink(login) {
  try { if (login && login.username && login.password && typeof btoa === 'function') return `${appUrl()}#c=${btoa(unescape(encodeURIComponent(login.username + '\n' + login.password))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`; } catch (e) { /* plain link */ }
  return appUrl();
}
function welcomeMessage(r, login) {
  return tpl('welcome', { name: r.name.split(' ')[0], hostel: (Store.hostel() || {}).name, room: roomName(r.roomId), bed: r.bed, rent: rs(r.rent), deposit: rs(r.deposit), link: loginLink(login), username: login ? login.username : r.username || '-', password: login ? login.password : t('(your mobile number)') }, waLang(r));
}
function shiftBed(resId, roomId, bedId, newRent, opts = {}) {
  const r = resById(resId), room = roomById(roomId);
  if (!r) throw new Error('Resident not found');
  if (!room) throw new Error('Target room not found');
  const bed = bedsOf(room).find(b => b.id === bedId);
  if (!bed || bed.status !== 'vac') throw new Error('That bed is not vacant');

  const oldRoomId = r.roomId;
  const isDiffRoom = oldRoomId && oldRoomId !== roomId;
  const moveDate = opts.date || today();

  let oldSettlement = null;
  let invShift = null;
  // Electricity billing boundary settlement on room shift
  if (isDiffRoom && S().elec && S().elec.rate > 0) {
    const lastOld = lastMeter(oldRoomId);
    const rOld = opts.readingOld !== undefined ? opts.readingOld : opts.oldRoomReading;
    if (rOld !== undefined && rOld !== null) {
      const prevVal = lastOld ? lastOld.curr : 0;
      const currVal = +rOld;
      if (isNaN(currVal) || currVal < 0) throw new Error('Enter a valid non-negative reading for old room');
      if (currVal < prevVal && !opts.isReplacement) throw new Error(`Reading cannot be less than previous (${prevVal})`);
      const units = round2(currVal - prevVal);
      const occ = meterOccupants(oldRoomId, lastOld ? lastOld.date : null, moveDate);
      const partial = occ.some(o => o[1] < 1);
      const shares = splitElectricity(oldRoomId, units, S().elec.rate, occ.map(o => o[0]), partial ? occ.map(o => o[1]) : null, freeMonths(lastOld ? lastOld.date : null, moveDate));
      const resShare = shares.find(s => s.resId === resId) || { units: 0, amount: 0 };
      oldSettlement = { unitsConsumed: units, charge: resShare.amount, resShare };

      if (resShare.amount > 0) {
        invShift = addInvoice({
          id: `inv-el-shift-${resId}-${moveDate}-${uid()}`,
          resId,
          roomId: oldRoomId,
          type: 'electricity',
          title: `${t('Electricity')} (${resShare.units} ${t('units')} · ${room ? room.no : oldRoomId} shift)`,
          amount: resShare.amount,
          date: moveDate,
          due: addDays(moveDate, 7)
        });
        oldSettlement.invoiceId = invShift.id;
      }

      Store.put('mtr_period', {
        id: `mtr-p-${oldRoomId}-${resId}-${moveDate}-${uid()}`,
        hostelId: Store.hostel() ? Store.hostel().id : null,
        roomId: oldRoomId,
        resId,
        bedId: r.bed,
        startDate: lastOld ? lastOld.date : r.checkIn,
        endDate: moveDate,
        startReading: prevVal,
        endReading: currVal,
        roomUnits: units,
        allocationMethod: opts.allocationMethod || S().elec.sharing || 'occupancy_day_weighted',
        allocatedUnits: resShare.units,
        rate: S().elec.rate,
        amount: resShare.amount,
        isSettled: true,
        action: 'shift',
        ts: nowIso()
      });

      Store.put('meter', {
        id: `mtr-${oldRoomId}-${moveDate}-${uid()}`,
        roomId: oldRoomId,
        curr: currVal,
        prev: prevVal,
        units,
        date: moveDate,
        ts: nowIso(),
        note: `Shift transition reading (${r.name})`
      });
    }

    // New room baseline reading
    const rNew = opts.readingNew !== undefined ? opts.readingNew : opts.newRoomReading;
    if (rNew !== undefined && rNew !== null) {
      const newCurr = +rNew;
      if (isNaN(newCurr) || newCurr < 0) throw new Error('Enter a valid non-negative reading for new room');
      Store.put('meter', {
        id: `mtr-${roomId}-${moveDate}-${uid()}`,
        roomId,
        curr: newCurr,
        prev: newCurr,
        units: 0,
        date: moveDate,
        opening: true,
        ts: nowIso(),
        note: `Shift baseline reading (${r.name})`
      });
    }
  }

  setBed(r.roomId, r.bed, { status: 'vac', resId: null });
  setBed(roomId, bedId, { status: 'occ', resId });
  Store.patch(resId, { roomId, bed: bedId, rent: newRent > 0 ? newRent : r.rent });
  notify({ to: 'res', resId, title: t('Room changed'), body: `${room.no}-${bedId}` });
  alog('shift_bed', `${r.name}: shifted from ${oldRoomId} to ${room.no}-${bedId}`, {
    resId, fromRoom: oldRoomId, fromBed: r.bed, toRoom: roomId, toBed: bedId, rent: newRent > 0 ? newRent : r.rent
  });

  return {
    res: resById(resId),
    fromRoom: oldRoomId,
    fromBed: r.bed,
    toRoom: roomId,
    toBed: bedId,
    oldRoomSettlement: oldSettlement || { unitsConsumed: 0, charge: 0 },
    electricityInvoice: invShift || ((oldSettlement && oldSettlement.invoiceId) ? Store.get(oldSettlement.invoiceId) : null)
  };
}
function swapBeds(resIdA, resIdB, opts = {}) {
  const rA = resById(resIdA), rB = resById(resIdB);
  if (!rA || !rB) throw new Error('Both residents must exist');
  if (rA.id === rB.id) throw new Error('Cannot swap a resident with themselves');
  if (rA.status !== 'active' && rA.status !== 'notice') throw new Error('Resident A is not active');
  if (rB.status !== 'active' && rB.status !== 'notice') throw new Error('Resident B is not active');

  const roomA = roomById(rA.roomId), roomB = roomById(rB.roomId);
  if (!roomA || !roomB) throw new Error('Rooms not found');

  const bedA = bedsOf(roomA).find(b => b.id === rA.bed);
  const bedB = bedsOf(roomB).find(b => b.id === rB.bed);
  if (!bedA || !bedB) throw new Error('Beds not found');

  const oldRoomAId = rA.roomId, oldBedAId = rA.bed;
  const oldRoomBId = rB.roomId, oldBedBId = rB.bed;
  const isDiffRoom = oldRoomAId !== oldRoomBId;
  const moveDate = opts.date || today();

  let unitsA = 0, unitsB = 0, shareA = { units: 0, amount: 0 }, shareB = { units: 0, amount: 0 }, invoiceA = null, invoiceB = null;
  // Validate electricity readings upfront before ANY mutation
  if (isDiffRoom && S().elec && S().elec.rate > 0) {
    const lastA = lastMeter(oldRoomAId);
    const lastB = lastMeter(oldRoomBId);

    if (opts.readingA !== undefined && opts.readingA !== null) {
      const prevA = lastA ? lastA.curr : 0;
      const currA = +opts.readingA;
      if (isNaN(currA) || currA < 0) throw new Error('Enter a valid reading for Room A');
      if (currA < prevA && !opts.isReplacementA) throw new Error(`Reading for Room A cannot be less than previous (${prevA})`);
    }
    if (opts.readingB !== undefined && opts.readingB !== null) {
      const prevB = lastB ? lastB.curr : 0;
      const currB = +opts.readingB;
      if (isNaN(currB) || currB < 0) throw new Error('Enter a valid reading for Room B');
      if (currB < prevB && !opts.isReplacementB) throw new Error(`Reading for Room B cannot be less than previous (${prevB})`);
    }

    // Record Room A transition and settlement
    if (opts.readingA !== undefined && opts.readingA !== null) {
      const prevA = lastA ? lastA.curr : 0;
      const currA = +opts.readingA;
      unitsA = round2(currA - prevA);
      const occA = meterOccupants(oldRoomAId, lastA ? lastA.date : null, moveDate);
      const partialA = occA.some(o => o[1] < 1);
      const sharesA = splitElectricity(oldRoomAId, unitsA, S().elec.rate, occA.map(o => o[0]), partialA ? occA.map(o => o[1]) : null, freeMonths(lastA ? lastA.date : null, moveDate));
      shareA = sharesA.find(s => s.resId === rA.id) || { units: 0, amount: 0 };

      if (shareA.amount > 0) {
        invoiceA = addInvoice({
          id: `inv-el-swap-${rA.id}-${moveDate}-${uid()}`,
          resId: rA.id,
          roomId: oldRoomAId,
          type: 'electricity',
          title: `${t('Electricity')} (${shareA.units} ${t('units')} · ${roomA ? roomA.no : oldRoomAId} swap)`,
          amount: shareA.amount,
          date: moveDate,
          due: addDays(moveDate, 7)
        });
      }

      Store.put('mtr_period', {
        id: `mtr-p-${oldRoomAId}-${rA.id}-${moveDate}-${uid()}`,
        hostelId: Store.hostel() ? Store.hostel().id : null,
        roomId: oldRoomAId,
        resId: rA.id,
        bedId: oldBedAId,
        startDate: lastA ? lastA.date : rA.checkIn,
        endDate: moveDate,
        startReading: prevA,
        endReading: currA,
        roomUnits: unitsA,
        allocationMethod: opts.allocationMethod || S().elec.sharing || 'occupancy_day_weighted',
        allocatedUnits: shareA.units,
        rate: S().elec.rate,
        amount: shareA.amount,
        isSettled: true,
        action: 'swap',
        ts: nowIso()
      });

      Store.put('meter', {
        id: `mtr-${oldRoomAId}-${moveDate}-${uid()}`,
        roomId: oldRoomAId,
        curr: currA,
        prev: prevA,
        units: unitsA,
        date: moveDate,
        ts: nowIso(),
        note: `Swap transition reading (${rA.name})`
      });
    }

    // Record Room B transition and settlement
    if (opts.readingB !== undefined && opts.readingB !== null) {
      const prevB = lastB ? lastB.curr : 0;
      const currB = +opts.readingB;
      unitsB = round2(currB - prevB);
      const occB = meterOccupants(oldRoomBId, lastB ? lastB.date : null, moveDate);
      const partialB = occB.some(o => o[1] < 1);
      const sharesB = splitElectricity(oldRoomBId, unitsB, S().elec.rate, occB.map(o => o[0]), partialB ? occB.map(o => o[1]) : null, freeMonths(lastB ? lastB.date : null, moveDate));
      shareB = sharesB.find(s => s.resId === rB.id) || { units: 0, amount: 0 };

      if (shareB.amount > 0) {
        invoiceB = addInvoice({
          id: `inv-el-swap-${rB.id}-${moveDate}-${uid()}`,
          resId: rB.id,
          roomId: oldRoomBId,
          type: 'electricity',
          title: `${t('Electricity')} (${shareB.units} ${t('units')} · ${roomB ? roomB.no : oldRoomBId} swap)`,
          amount: shareB.amount,
          date: moveDate,
          due: addDays(moveDate, 7)
        });
      }

      Store.put('mtr_period', {
        id: `mtr-p-${oldRoomBId}-${rB.id}-${moveDate}-${uid()}`,
        hostelId: Store.hostel() ? Store.hostel().id : null,
        roomId: oldRoomBId,
        resId: rB.id,
        bedId: oldBedBId,
        startDate: lastB ? lastB.date : rB.checkIn,
        endDate: moveDate,
        startReading: prevB,
        endReading: currB,
        roomUnits: unitsB,
        allocationMethod: opts.allocationMethod || S().elec.sharing || 'occupancy_day_weighted',
        allocatedUnits: shareB.units,
        rate: S().elec.rate,
        amount: shareB.amount,
        isSettled: true,
        action: 'swap',
        ts: nowIso()
      });

      Store.put('meter', {
        id: `mtr-${oldRoomBId}-${moveDate}-${uid()}`,
        roomId: oldRoomBId,
        curr: currB,
        prev: prevB,
        units: unitsB,
        date: moveDate,
        ts: nowIso(),
        note: `Swap transition reading (${rB.name})`
      });
    }
  }

  // Determine new rents
  let newRentA = rA.rent;
  let newRentB = rB.rent;
  if (opts.rentA !== undefined && opts.rentA !== null && !isNaN(+opts.rentA) && +opts.rentA >= 0) {
    newRentA = round2(+opts.rentA);
  } else if (opts.rentMode === 'room') {
    newRentA = roomB.rent != null ? roomB.rent : rA.rent;
  }
  if (opts.rentB !== undefined && opts.rentB !== null && !isNaN(+opts.rentB) && +opts.rentB >= 0) {
    newRentB = round2(+opts.rentB);
  } else if (opts.rentMode === 'room') {
    newRentB = roomA.rent != null ? roomA.rent : rB.rent;
  }

  // Update beds in rooms atomically
  if (oldRoomAId === oldRoomBId) {
    // Both residents are in the same room (swapping beds e.g. Bed A <-> Bed B)
    roomA.beds = bedsOf(roomA).map(b => {
      if (b.id === oldBedAId) return { ...b, status: 'occ', resId: rB.id };
      if (b.id === oldBedBId) return { ...b, status: 'occ', resId: rA.id };
      return b;
    });
    Store.put('room', roomA);
  } else {
    // Different rooms
    setBed(oldRoomAId, oldBedAId, { status: 'occ', resId: rB.id });
    setBed(oldRoomBId, oldBedBId, { status: 'occ', resId: rA.id });
  }

  // Update residents
  Store.patch(rA.id, { roomId: oldRoomBId, bed: oldBedBId, rent: newRentA });
  Store.patch(rB.id, { roomId: oldRoomAId, bed: oldBedAId, rent: newRentB });

  // Notifications
  notify({ to: 'res', resId: rA.id, title: t('Room swapped'), body: `${roomB.no}-${oldBedBId}` });
  notify({ to: 'res', resId: rB.id, title: t('Room swapped'), body: `${roomA.no}-${oldBedAId}` });
  notify({ to: 'admin', title: t('Beds swapped'), body: `${rA.name} ⇄ ${rB.name}` });

  // Audit log
  alog('swap_bed', `${rA.name} (${roomA.no}-${oldBedAId}) ⇄ ${rB.name} (${roomB.no}-${oldBedBId})`, {
    resA: rA.id, resB: rB.id,
    fromA: { roomId: oldRoomAId, bed: oldBedAId, rent: rA.rent },
    fromB: { roomId: oldRoomBId, bed: oldBedBId, rent: rB.rent },
    toA: { roomId: oldRoomBId, bed: oldBedBId, rent: newRentA },
    toB: { roomId: oldRoomAId, bed: oldBedAId, rent: newRentB },
    note: opts.note || ''
  });

  return {
    resA: resById(rA.id),
    resB: resById(rB.id),
    residentA: resById(rA.id),
    residentB: resById(rB.id),
    roomA: roomById(oldRoomAId),
    roomB: roomById(oldRoomBId),
    settlementA: { unitsConsumed: unitsA, charge: shareA.amount, share: shareA },
    settlementB: { unitsConsumed: unitsB, charge: shareB.amount, share: shareB },
    invoiceA,
    invoiceB
  };
}
// Checkout: dues come out of the deposit; the refund waits for approval in the inbox.
function checkout(resId, date = today(), deductions = 0, note = '', opts = {}) {
  const r = resById(resId); if (!r) return null;
  if (r.status === 'left') throw new AppError('Resident is already checked out');
  deductions = round2(Math.max(0, +deductions || 0));

  // 1. Process meter reading if provided in opts
  let elecShare = null;
  const reading = opts.reading != null ? opts.reading : opts.meterNow;

  if (reading !== undefined && reading !== null && reading !== '' && !isNaN(reading) && orgEnabled('electricity') && r.roomId) {
    const last = lastMeter(r.roomId);
    const p = last ? last.curr : 0;
    const curr = +reading;
    // a lower reading used to be skipped silently and the resident left without their electricity bill
    if (curr < p) throw new AppError(`Reading cannot be less than previous (${p})`);
    if (curr > p) {
      try {
        const m = addReading({
          roomId: r.roomId,
          curr,
          date,
          status: 'billed',
          isManual: true,
          exitResId: resId,
          note: `Checkout reading (${r.name})`
        });
        const s = (m.shares || []).find(x => x.resId === resId);
        if (s) {
          elecShare = {
            ...s,
            prev: p,
            curr,
            roomUnits: m.units,
            prevDate: m.prevDate,
            rate: m.rate || S().elec.rate,
            meterId: m.id,
            invId: `inv-el-${m.id}-${resId}`
          };
        }
      } catch (err) {
        console.warn('Checkout meter reading error:', err.message);
      }
    }
  }

  // 1b. Rent for the part month goes into the books first (arrears: billed; advance + left early: unused rent taken off / credited)
  const rentAdjustApplied = applyRentCheckoutAdjust(r, date);
  const depPaid = round2(sum(resInvoices(resId).filter(i => i.type === 'deposit'), i => i.paid || 0));
  // dues other than the deposit invoice itself (includes any newly generated electricity invoice)
  const dues = round2(sum(openInv(resId).filter(i => i.type !== 'deposit'), invBal));

  // Compute official settlement statement prior to ledger mutation (validates deductions <= availableDepositAndCredit)
  const stmt = calcSettlement({
    resId,
    checkoutDate: date,
    deductions,
    noticeDate: opts.noticeDate,
    notes: note,
    elecShare,
    reading,
    rentAdjustApplied,
    applyShortfall: opts.applyShortfall
  });

  // Deductions and notice shortfall are prioritized from deposit; remaining deposit settles open invoices
  const availForDues = Math.max(0, round2(stmt.availableDepositAndCredit - deductions - (stmt.shortfallFee || 0)));
  const settle = Math.min(availForDues, dues);
  let held = depPaid;
  if (settle > 0) {
    recordPayment({ resId, amount: settle, mode: 'deposit', ref: 'Adjusted from deposit', date, invIds: openInv(resId).filter(i => i.type !== 'deposit').map(i => i.id) });
    held = round2(held - settle);
  }
  openInv(resId).filter(i => i.type === 'deposit').forEach(i => Store.patch(i.id, { waived: invBal(i) + (i.waived || 0), note: 'Closed at checkout' }));

  // Zero-Due guarantee: settle remaining balance if specified
  let balancePayment = null;
  if (stmt.balancePayable > 0) {
    if (opts.settleBalance === 'waive') {
      // Owner explicitly waives / discounts the remaining balance
      for (const inv of openInv(resId).filter(i => i.type !== 'deposit')) {
        const bal = invBal(inv);
        if (bal > 0) {
          Store.patch(inv.id, { waived: round2((inv.waived || 0) + bal), discountNote: opts.waiveReason || 'Waived at checkout settlement' });
        }
      }
    } else if (opts.settleBalance === 'pay' || (!opts.settleBalance && opts.payMode && opts.settleBalance !== 'debt')) {
      // Record payment for remaining balance to clear all dues to 0
      const payMode = opts.payMode || 'cash';
      const payRef = opts.payRef || 'Checkout settlement balance';
      balancePayment = recordPayment({
        resId,
        amount: stmt.balancePayable,
        mode: payMode,
        ref: payRef,
        date,
        note: 'Remaining balance settled at checkout (Zero-Due Guarantee)'
      });
    }
  }

  // Handle refund settlement
  const refund = stmt.refund;
  let depStatus = refund > 0 ? 'pending' : (stmt.balancePayable > 0 && opts.settleBalance === 'debt' ? 'debt' : 'closed');
  let refundData = {};
  if (refund > 0 && (opts.refundNow || opts.refundMode)) {
    depStatus = 'paid';
    refundData = {
      mode: opts.refundMode || 'cash',
      ref: opts.refundRef || '',
      paidOn: date
    };
  }

  // Accessories: what was handed over vs. what came back (opts.accReturned = array of returned item names)
  let accPatch = {};
  if (r.accessories && Array.isArray(r.accessories.given) && Array.isArray(opts.accReturned)) {
    const missing = r.accessories.given.filter(x => !opts.accReturned.includes(x));
    accPatch = { accessories: { ...r.accessories, returned: opts.accReturned.slice(), missing, returnedOn: date } };
  }
  Store.patch(resId, { status: 'left', left: date, credit: 0, exitNote: note, ...accPatch });
  setBed(r.roomId, r.bed, { status: 'vac', resId: null });
  if (typeof reconcileBeds === 'function') reconcileBeds();
  const dep = Store.put('dep', {
    resId,
    roomId: r.roomId,
    date,
    deposit: depPaid,
    nonRefundable: stmt.nonRefundable,
    depositRule: r.depositRule || null,
    settled: settle,
    deductions,
    refund,
    balancePayable: stmt.balancePayable,
    status: depStatus,
    ...refundData,
    balancePaymentId: balancePayment ? balancePayment.id : null,
    settleBalanceAction: opts.settleBalance || (opts.payMode ? 'pay' : null),
    note,
    settlement: stmt
  });
  if (r.userId) Backend.admin('set_active', { user_id: r.userId, active: false }).catch(e => toast(t('{n} is checked out, but their login could not be switched off: {m}. Disable it under Settings > Users.', { n: r.name, m: e.message }), 'bad'));
  alog('checkout', `${r.name}: ${t('refund')} ${inr(refund)}`, { resId, deposit: depPaid, settled: settle, deductions, refund, balancePayable: stmt.balancePayable });
  return dep;
}

/* ===================================================================== electricity */
const meters = () => Store.all('meter').slice().sort((a, b) => {
  if (a.date !== b.date) return b.date > a.date ? 1 : -1;
  if (b.meterReplaced && !a.meterReplaced) return 1;
  if (a.meterReplaced && !b.meterReplaced) return -1;
  if (b.opening && !a.opening) return -1;
  if (a.opening && !b.opening) return 1;
  const tb = b.ts || b._u || '';
  const ta = a.ts || a._u || '';
  if (tb && ta && tb !== ta) return tb > ta ? 1 : -1;
  return (b.id || '').localeCompare(a.id || '');
});
const lastMeter = roomId => meters().find(m => m.roomId === roomId && m.status !== 'review') || null;
const pendingMeter = roomId => meters().find(m => m.roomId === roomId && m.status === 'review') || null;
function calcElectricityCost(units, elecSettings) {
  units = Math.max(0, +units || 0);
  const cfg = elecSettings || S().elec || {};
  const fixedCharge = +(cfg.fixedCharge || 0);
  if (units <= 0) return round2(fixedCharge);
  let cost = 0;
  if (cfg.pricing === 'slab' && Array.isArray(cfg.slabs) && cfg.slabs.length) {
    let remaining = units;
    let prevLimit = 0;
    let lastRate = cfg.rate || 0;
    for (const slab of cfg.slabs) {
      const slabCap = slab.upTo - prevLimit;
      const billedUnits = Math.min(remaining, slabCap);
      if (billedUnits > 0) {
        cost += billedUnits * slab.rate;
        remaining -= billedUnits;
      }
      lastRate = slab.rate;
      prevLimit = slab.upTo;
      if (remaining <= 0) break;
    }
    if (remaining > 0) {
      cost += remaining * lastRate;
    }
  } else {
    cost = units * (cfg.rate || 0);
  }
  cost += fixedCharge;
  return round2(cost);
}

// Split a room's units between the residents living there, honouring free units.
// The monthly meter charge (Settings > Electricity) was only used with slab pricing; with a flat rate it was saved and never billed.
// Now it is added in both: shared by days stayed, and only for the days the stretch covers (scale is the part of a month).
function splitElectricity(roomId, units, rate, resIds, weights, scale = 1, extra = null) {
  const parts = splitElectricityCore(roomId, units, rate, resIds, weights, scale, extra), e = S().elec;
  const fixed = e.pricing === 'slab' ? 0 : round2((+e.fixedCharge || 0) * scale);
  if (!parts.length || !(fixed > 0)) return parts;
  const w = resIds.map((_, i) => (weights && weights[i] != null ? Math.max(0, Math.min(1, weights[i])) : 1)), tw = w.reduce((a, b) => a + b, 0) || resIds.length;
  return parts.map((p, i) => ({ ...p, amount: p.amount + Math.round(fixed * w[i] / tw) }));
}
function splitElectricityCore(roomId, units, rate, resIds, weights, scale = 1, extra = null) {
  const e = S().elec, n = resIds.length; if (!n) return [];
  const w = resIds.map((_, i) => (weights && weights[i] != null ? Math.max(0, Math.min(1, weights[i])) : 1));
  const tw = w.reduce((a, b) => a + b, 0) || n;
  const freePool = e.freeUnits * scale;
  const costForUnits = u => (e.pricing === 'slab' ? round2(calcElectricityCost(u, e)) : Math.round(u * rate));
  if (e.freeMode === 'room') {
    const billable = Math.max(0, units - freePool);
    return resIds.map((id, i) => { const f = w[i] / tw, b = billable * f; return { resId: id, units: round2(units * f), free: round2(Math.min(units, freePool) * f), billable: round2(b), amount: costForUnits(b), days: weights ? round2(w[i]) : undefined }; });
  }
  return resIds.map((id, i) => {
    const share = units * w[i] / tw, free = freePool * w[i] + ((extra && extra[id]) || 0) * e.freeUnits, billable = Math.max(0, share - free);
    return { resId: id, units: round2(share), free: round2(Math.min(share, free)), billable: round2(billable), amount: costForUnits(billable), days: weights ? round2(w[i]) : undefined };
  });
}
// Free units are "per month", so a stretch between two readings earns them day by day:
// each day counts 1 / (days in that calendar month). Nov 1 → Dec 1 is exactly 1, a fortnight is
// about half, so a mid-month check-in or check-out never collects a whole month's free units
// twice. Without a start date (the room's first reading) it is a full month.
function freeMonths(from, to) {
  if (!from) return 1;
  // Each month counts as its real length (28, 29, 30 or 31 days): a day is 1 / that many of the month's free units.
  // A reading dated on the LAST day of a month covers that whole day: the stretch that ends there includes it, and the next
  // stretch starts the day after. Otherwise a resident who stayed the full month would be credited one day short.
  const lastDay = d => { const x = String(d).slice(0, 10); return x === iso(new Date(+x.slice(0, 4), +x.slice(5, 7), 0)); };
  if (lastDay(from)) from = addDays(String(from).slice(0, 10), 1);
  if (lastDay(to)) to = addDays(String(to).slice(0, 10), 1);
  let cur = String(from).slice(0, 10), total = 0;
  for (let i = 0; i < 240 && diffDays(to, cur) > 0; i++) {
    const y = +cur.slice(0, 4), m = +cur.slice(5, 7);
    const next = iso(new Date(y, m, 1)), dim = diffDays(next, cur.slice(0, 7) + '-01');
    const end = diffDays(to, next) < 0 ? String(to).slice(0, 10) : next;
    total += diffDays(end, cur) / dim; cur = end;
  }
  return total;
}
// The day someone leaves still counts as a day they stayed (the day they arrive does too), so on the stretch that ends with their
// exit they also earn that one day of free units - unless the reading is on the last day of a month, which freeMonths already counts.
function exitDayFree(date, resIds, leavingNow = false) {
  const d = String(date).slice(0, 10), y = +d.slice(0, 4), m = +d.slice(5, 7), dim = new Date(y, m, 0).getDate();
  if (+d.slice(8, 10) === dim) return {};
  const out = {}; for (const id of resIds) { const r = resById(id); if (leavingNow || (r && r.status === 'left' && String(r.left || '').slice(0, 10) === d)) out[id] = 1 / dim; }
  return out;
}
// Who shared the room between two readings, and for what part of that time. Includes people
// who checked out during the period, so their units are not left on the roommates' bills.
// Supports both 'occupancy_days' (pro-rata stay days) and 'daily_occupancy' (Day + Occupancy concurrency slices).
function meterOccupants(roomId, from, to) {
  const span = from ? Math.max(0, diffDays(to, from)) : 0;
  const cfg = (typeof S === 'function' && S().elec) || {};
  const isDailyOcc = cfg.allocation === 'daily_occupancy';

  const roomRes = [];
  for (const r of Store.all('res')) {
    if (r.roomId !== roomId || r.checkIn > to) continue;
    if (r.status !== 'active' && !(r.left && from && r.left > from)) continue;
    if (!span) { if (r.status === 'active') roomRes.push({ r, d: 1 }); continue; }
    const a = r.checkIn > from ? r.checkIn : from, b = r.status === 'active' || !r.left || r.left > to ? to : r.left;
    const d = Math.max(0, diffDays(b, a));
    if (d > 0) roomRes.push({ r, d });
  }

  if (!span) return roomRes.map(x => [x.r.id, 1]);
  if (!roomRes.length) return [];

  if (isDailyOcc && span > 1) {
    // Dynamic Day + Occupancy Based Distribution:
    // Daily concurrency slices: each day's units divided by concurrent occupants on that day
    const weights = new Map(roomRes.map(x => [x.r.id, 0]));
    let coveredDays = 0;
    for (let d = 0; d < span; d++) {
      const curDate = addDays(from, d);
      const present = roomRes.filter(x => x.r.checkIn <= curDate && (x.r.status !== 'left' || (x.r.left && x.r.left > curDate)));
      if (present.length > 0) {
        coveredDays++;
        const frac = 1 / (span * present.length);
        for (const p of present) {
          weights.set(p.r.id, weights.get(p.r.id) + frac);
        }
      }
    }
    const totW = Array.from(weights.values()).reduce((a, b) => a + b, 0);
    if (totW > 0 && totW < 1 && coveredDays > 0) {
      const scale = 1 / totW;
      for (const [id, w] of weights.entries()) weights.set(id, w * scale);
    }
    return roomRes.map(x => [x.r.id, weights.get(x.r.id) || 0]);
  }

  return roomRes.map(x => [x.r.id, x.d / span]);
}
function addReading({ roomId, curr, date = today(), prev, qrCode = null, photo = null, exitResId = null, ...rest }) {
  const room = roomById(roomId); if (!room) throw new Error('Choose a room');
  if (rest.status === 'review') {
    const pending = pendingMeter(roomId);
    if (pending) throw new Error(t('A reading for this room is already under review'));
  }
  // one unusual reading may be waiting for the owner at a time; a second one would be computed from the same
  // starting point and bill the same units twice once both are approved
  if (!rest.isReplacement && pendingMeter(roomId)) throw new Error(t('A reading for room {r} is already waiting for your approval. Approve or reject it first.', { r: room.no }));
  const last = lastMeter(roomId);
  if (last && date < last.date && !rest.isReplacement) {
    throw new Error(t('Reading date ({date}) cannot be earlier than previous reading date ({prevDate})', { date, prevDate: last.date }));
  }
  const p = prev != null && !isNaN(prev) ? +prev : last ? last.curr : 0;
  curr = +curr;
  if (!isFinite(curr) || isNaN(curr) || curr < 0) throw new Error(t('Enter a valid non-negative reading'));
  if (curr > 999999) throw new Error(t('Reading ({curr}) exceeds the 6-digit meter limit (999,999). Please ensure you entered the meter display number, not a phone or serial number.', { curr: num(curr) }));
  if (!rest.isReplacement && curr < p) throw new Error(t('Reading cannot be less than previous ({p})', { p }));
  const units = round2(curr - p), rate = S().elec.rate;
  if (units > 10000) throw new Error(t('Units consumed ({units}) is abnormally large (over 10,000 units). Please check if a phone number, serial number, or date was entered by mistake.', { units: num(units) }));
  const prevDate = last ? last.date : null;
  const occ = meterOccupants(roomId, prevDate, date);
  const partial = occ.some(o => o[1] < 1);
  const shares = splitElectricity(roomId, units, rate, occ.map(o => o[0]), partial ? occ.map(o => o[1]) : null, freeMonths(prevDate, date), { ...exitDayFree(date, occ.map(o => o[0])), ...(exitResId ? exitDayFree(date, [exitResId], true) : {}) });
  const avg = last ? last.units : null, span = last ? Math.max(1, diffDays(date, last.date)) : null;
  // A reading taken mid-month covers only a few days, so compare units per day, not per reading —
  // otherwise the full month that follows a check-in reading always looks "unusual" and sits unbilled.
  let odd = false;
  if (units > 1500) odd = true;
  else if (avg > 0) odd = last.span && span ? span >= 7 && last.span >= 7 && units / span > (avg / last.span) * 2.2 : units > avg * 2.2;
  const isManual = rest.isManual !== undefined ? rest.isManual : (!qrCode && !photo);
  const capturedBy = rest.capturedBy || (Store.me && Store.me.full_name) || ctx().role || 'staff';
  const status = rest.status || (odd ? 'review' : 'billed');
  const m = Store.put('meter', { roomId, date, prevDate, prev: p, curr, units, span, rate, freeUnits: S().elec.freeUnits, freeMode: S().elec.freeMode, shares, total: sum(shares, s => s.amount), period: ymOf(date), qrCode, photo, photoUrl: rest.photoUrl || null, isManual, capturedBy, ts: nowIso(), ...rest, status });
  if (status === 'review') {
    if (odd) notify({ to: 'admin', title: t('Unusual electricity reading'), body: `${room.no}: ${units} ${t('units')} (${t('last')} ${avg})` });
  } else {
    billMeter(m);
  }
  return m;
}
// One opening row per room (deterministic id), so re-saving the migration screen corrects it.
function setOpeningReading(roomId, curr, date = today()) {
  curr = +curr;
  if (!isFinite(curr) || isNaN(curr) || curr < 0) throw new Error(t('Enter a valid non-negative reading'));
  return Store.put('meter', { id: `meter-open-${roomId}`, roomId, date, prev: curr, curr, units: 0, rate: S().elec.rate, shares: [], total: 0, period: ymOf(date), status: 'billed', opening: true, ts: nowIso() });
}

function replaceMeter({ roomId, finalOldReading, startingNewReading = 0, newSerial = null, newQr = null, reason = 'Meter replaced / reset', date = today() }) {
  const room = roomById(roomId); if (!room) throw new AppError(t('Choose a room'));
  const last = lastMeter(roomId);
  const p = last ? last.curr : 0;
  finalOldReading = finalOldReading != null && finalOldReading !== '' ? +finalOldReading : p;
  startingNewReading = +startingNewReading || 0;
  if (isNaN(finalOldReading) || finalOldReading < 0) throw new AppError(t('Enter valid final reading for old meter'));
  if (isNaN(startingNewReading) || startingNewReading < 0) throw new AppError(t('Enter valid starting reading for new meter'));
  if (finalOldReading < p) throw new AppError(t('Final reading of old meter ({f}) cannot be less than last recorded reading ({p})', { f: finalOldReading, p }));

  let oldBill = null;
  if (finalOldReading > p) {
    oldBill = addReading({
      roomId,
      curr: finalOldReading,
      prev: p,
      date,
      isManual: true,
      status: 'billed',
      note: `Final reading before meter replacement: ${reason}`
    });
  }

  const newBaseline = Store.put('meter', {
    id: `meter-reset-${roomId}-${uid()}`,
    roomId,
    date,
    ts: nowIso(),
    prev: startingNewReading,
    curr: startingNewReading,
    units: 0,
    rate: S().elec.rate,
    shares: [],
    total: 0,
    period: ymOf(date),
    status: 'billed',
    opening: true,
    meterReplaced: true,
    oldFinalReading: finalOldReading,
    replacementReason: reason
  });

  if (newSerial || newQr) {
    registerMeter({
      roomId,
      serialNo: newSerial || `SN-${room.no}-${Date.now().toString().slice(-4)}`,
      qrCode: newQr || `MTR-${room.no}`,
      meterType: 'digital'
    });
  }

  alog('meter_replaced', `Meter replaced for Room ${room.no}. Old final: ${finalOldReading}, New start: ${startingNewReading}. Reason: ${reason}`, { roomId, finalOldReading, startingNewReading, reason });
  return { oldBill, newBaseline };
}
/* A reading taken at the moment the room's occupancy changes.
 *
 * Electricity is the one bill where "split it by how many days each person was here" quietly
 * cheats somebody. Take a two-bed room: the meter reads 100 on the 1st, a second resident
 * moves in on the 15th, and the month ends at 200. By days, the first resident carries 2/3 of
 * the 100 units. But the first fortnight was theirs alone and the second was shared, so what
 * they actually used is 50 + 25 = 75.
 *
 * The only way to know that is to read the meter on the 15th. Once that reading exists the
 * existing split is already right — each pair of consecutive readings is billed against
 * whoever lived in the room between them — so this does not change the arithmetic, it
 * captures the missing boundary. The previous segment is billed there and then, which is what
 * "the people already in the room pay up to this date" means in practice.
 *
 * Every check-in, check-out and room shift has to bring this reading, so a resident who stays
 * part of a month pays for exactly the units used while they were there; the next normal
 * reading then carries on from it. Returns null only when the electricity module is off, or the
 * room was already read today. A room with no reading yet takes this one as its starting point.
 */
/* The rule for every "meter reading now" box: it can never be lower than the room's last reading.
 * The only way past it is a meter that was replaced or reset: then the OLD meter's final reading is
 * needed too (never lower than the last reading), and the number typed is the NEW meter's reading.
 * Returns the message to show, or null when the reading is fine. Nothing is saved here. */
function meterReadingProblem(roomId, reading, { reset = false, oldFinal = null, canReset = true } = {}) {
  if (!orgEnabled('electricity') || !roomId) return null;
  if (reading === '' || reading == null || isNaN(reading)) return null;      // "required" is checked by the form
  const last = lastMeter(roomId);
  if (!last || +reading >= last.curr) return null;
  if (!canReset) return t('Reading ({r}) is lower than the last reading ({p}). Readings only go up. If the meter was replaced, record it first in Electricity > Replace or reset meter.', { r: num(+reading), p: num(last.curr) });
  if (!reset) return t('Reading ({r}) is lower than the last reading ({p}). Readings only go up. If the meter was replaced or reset, tick "Meter was replaced or reset".', { r: num(+reading), p: num(last.curr) });
  if (oldFinal === '' || oldFinal == null || isNaN(oldFinal)) return t('Enter the old meter\'s final reading');
  if (+oldFinal < last.curr) return t('The old meter\'s final reading ({f}) cannot be lower than the last reading ({p})', { f: num(+oldFinal), p: num(last.curr) });
  return null;
}
function moveReading(roomId, curr, date = today()) {
  if (!orgEnabled('electricity')) return null;
  if (curr === '' || curr == null || isNaN(curr)) throw new Error(t('Enter the meter reading'));
  const last = lastMeter(roomId);
  if (!last) return setOpeningReading(roomId, curr, date);   // nothing to bill yet, this is where it starts
  if (sameDay(last.date, date) && !last.opening) {           // already read today
    if (+curr < last.curr) throw new Error(t('Reading cannot be less than previous ({p})', { p: last.curr }));
    if (+curr === last.curr) return null;                    // same reading today, nothing new to bill
  }
  return addReading({ roomId, curr: +curr, date });
}
const sameDay = (a, b) => String(a).slice(0, 10) === String(b).slice(0, 10);

// What to show beside the "meter reading now" box: the last reading, and who it would settle.
function moveReadingHint(roomId, date = today()) {
  if (!orgEnabled('electricity')) return null;
  const last = lastMeter(roomId);
  if (!last) return { last: null, names: [] };
  const sharing = meterOccupants(roomId, last.date, date).filter(o => o[1] > 0);
  return { last, names: sharing.map(o => (resById(o[0]) || {}).name).filter(Boolean) };
}

function billMeter(m) {
  for (const s of m.shares) if (s.amount > 0) addInvoice({ id: `inv-el-${m.id}-${s.resId}`, meterId: m.id, resId: s.resId, roomId: m.roomId, type: 'electricity', period: m.period, title: `${t('Electricity')} ${fmtShort(m.date)} (${num(s.billable)} ${t('units')})`, amount: s.amount, date: m.date, due: addDays(m.date, 7) });
  Store.patch(m.id, { status: 'billed' });
}

function correctReading({ meterId, curr, prev, reason }) {
  if (!canAction('correct')) throw new AppError('Unauthorized: only owner, manager or super admin can correct meter readings');
  const m = Store.get(meterId);
  if (!m || m.kind !== 'meter') throw new AppError('Meter reading not found');
  if (!reason || !String(reason).trim()) throw new AppError('Reason for correction is required');
  curr = +curr;
  if (!isFinite(curr) || isNaN(curr) || curr < 0) throw new AppError('Enter a valid reading');
  if (curr > 999999) throw new AppError(t('Reading ({curr}) exceeds 6-digit meter limit (999,999)', { curr: num(curr) }));
  const p = prev != null && !isNaN(prev) ? +prev : m.prev;
  if (curr < p) throw new AppError(t('Reading cannot be less than previous ({p})', { p }));
  const origCurr = m.curr, origPrev = m.prev, origUnits = m.units;
  const newUnits = round2(curr - p);
  if (newUnits > 10000) throw new AppError(t('Units consumed ({units}) is abnormally large (over 10,000 units)', { units: num(newUnits) }));
  const rate = m.rate || S().elec.rate;
  const fromDate = m.prevDate || (m.span ? addDays(m.date, -m.span) : null);
  const occ = meterOccupants(m.roomId, fromDate, m.date);
  const partial = occ.some(o => o[1] < 1);
  const shares = splitElectricity(m.roomId, newUnits, rate, occ.map(o => o[0]), partial ? occ.map(o => o[1]) : null, freeMonths(fromDate, m.date));

  Store.patch(meterId, {
    prev: p,
    curr,
    units: newUnits,
    shares,
    total: sum(shares, s => s.amount),
    origCurr,
    origPrev,
    origUnits,
    correctedAt: nowIso(),
    correctedBy: Store.me && Store.me.full_name,
    correctionReason: String(reason).trim()
  });

  for (const s of shares) {
    const invId = `inv-el-${m.id}-${s.resId}`;
    const inv = Store.get(invId);
    if (inv) {
      if (!inv.paid || inv.paid === 0) {
        Store.patch(invId, {
          amount: s.amount,
          title: `${t('Electricity')} ${fmtShort(m.date)} (${num(s.billable)} ${t('units')}) [Corrected]`
        });
      } else {
        const diff = round2(s.amount - inv.amount);
        if (diff !== 0) {
          if (s.amount < inv.paid) {
            const excess = round2(inv.paid - s.amount);
            const r = resById(s.resId);
            if (r) Store.patch(r.id, { credit: round2((r.credit || 0) + excess) });
            Store.patch(invId, {
              amount: s.amount,
              paid: s.amount,
              note: `Corrected from ₹${inv.amount}: ${reason} (₹${excess} refunded to advance credit)`
            });
          } else {
            Store.patch(invId, {
              amount: s.amount,
              note: `Corrected from ₹${inv.amount}: ${reason}`
            });
          }
          alog('meter_invoice_adjustment', `Invoice ${invId} adjusted by ₹${diff}`, { invId, diff, reason });
        }
      }
    } else if (s.amount > 0) {
      addInvoice({
        id: invId,
        resId: s.resId,
        roomId: m.roomId,
        type: 'electricity',
        period: m.period,
        title: `${t('Electricity')} ${fmtShort(m.date)} (${num(s.billable)} ${t('units')})`,
        amount: s.amount,
        date: m.date,
        due: addDays(m.date, 7)
      });
    }
  }

  alog('meter_correction', `Room ${roomName(m.roomId)} reading corrected from ${origCurr} to ${curr}: ${reason}`, {
    meterId,
    origCurr,
    newCurr: curr,
    reason: String(reason).trim()
  });

  return Store.get(meterId);
}

function deleteReading({ meterId, reason = '' }) {
  const role = ctx().role;
  const isElevated = canAction('delete') || ['owner', 'super', 'manager', 'warden'].includes(role);
  if (!isElevated) throw new AppError('Unauthorized: insufficient permissions to delete meter readings');
  const m = Store.get(meterId);
  if (!m || m.kind !== 'meter') throw new AppError('Meter reading not found');
  const cleanReason = String(reason || (m.units > 10000 || !roomById(m.roomId) ? 'Erroneous / Abnormal reading deleted' : '')).trim();
  if (!cleanReason) throw new AppError('Reason for deletion is required');
  const paidBills = [];
  const invsToDelete = [];
  for (const s of (m.shares || [])) {
    const invId = `inv-el-${m.id}-${s.resId}`;
    const inv = Store.get(invId);
    if (inv) {
      if (inv.paid > 0) paidBills.push(inv);
      else invsToDelete.push(inv.id);
    }
  }
  for (const inv of Store.all('inv')) {
    if (inv.id && inv.id.startsWith(`inv-el-${m.id}`) && !invsToDelete.includes(inv.id)) {
      if (inv.paid > 0) paidBills.push(inv);
      else invsToDelete.push(inv.id);
    }
  }
  if (paidBills.length > 0) {
    throw new AppError(`Cannot delete reading: ${paidBills.length} resident bill(s) have already been paid. Reverse the payments first.`);
  }
  for (const id of invsToDelete) {
    Store.remove(id);
  }
  Store.remove(m.id);
  alog('meter_deletion', `Room ${roomName(m.roomId)} reading deleted: ${cleanReason}`, {
    meterId,
    curr: m.curr,
    prev: m.prev,
    units: m.units,
    reason: cleanReason
  });
  return true;
}

/* ===================================================================== electricity meters & ocr */
function registerMeter({ roomId, serialNo, qrCode, meterType = 'digital' }) {
  if (!canAction('edit')) throw new AppError('Unauthorized: insufficient permissions to register meter');
  const room = roomById(roomId);
  if (!room) throw new AppError('Room not found');
  serialNo = String(serialNo || '').trim();
  qrCode = String(qrCode || '').trim();
  if (!serialNo) throw new AppError('Meter serial number is required');
  const existing = Store.all('emeter').find(m => (m.serialNo === serialNo || (qrCode && m.qrCode === qrCode)) && m.id !== `emeter-${roomId}`);
  if (existing) throw new AppError(`Meter serial ${serialNo} is already registered to room ${roomName(existing.roomId)}`);

  const m = Store.put('emeter', {
    id: `emeter-${roomId}`,
    roomId,
    serialNo,
    qrCode: qrCode || `MTR-${roomId}-${serialNo}`,
    meterType,
    registeredAt: nowIso(),
    registeredBy: Store.me && Store.me.full_name
  });
  alog('meter_registered', `Meter ${serialNo} registered to room ${room.no}`, { roomId, serialNo });
  return m;
}

function getMeterForRoom(roomId) {
  return Store.get(`emeter-${roomId}`) || null;
}

function analyzeDigitSegments(pixelGrid, width, height) {
  const sample = (xRatio, yRatio, r = 1) => {
    const cx = Math.floor(xRatio * width), cy = Math.floor(yRatio * height);
    let count = 0, total = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = cx + dx, py = cy + dy;
        if (px >= 0 && px < width && py >= 0 && py < height) {
          total++;
          if (pixelGrid[py * width + px] > 128) count++;
        }
      }
    }
    return total ? count / total > 0.45 : false;
  };

  const a = sample(0.5, 0.12);
  const b = sample(0.85, 0.28);
  const c = sample(0.85, 0.72);
  const d = sample(0.5, 0.88);
  const e = sample(0.15, 0.72);
  const f = sample(0.15, 0.28);
  const g = sample(0.5, 0.50);

  const sig = `${+a}${+b}${+c}${+d}${+e}${+f}${+g}`;
  const patterns = {
    '1111110': '0', '0110000': '1', '1101101': '2', '1111001': '3', '0110011': '4',
    '1011011': '5', '1011111': '6', '1110000': '7', '1111111': '8', '1111011': '9'
  };

  if (patterns[sig] !== undefined) return { digit: patterns[sig], confidence: 0.95 };

  let bestDigit = null, minDiff = 8;
  for (const [p, digit] of Object.entries(patterns)) {
    let diff = 0;
    for (let i = 0; i < 7; i++) if (p[i] !== sig[i]) diff++;
    if (diff < minDiff) { minDiff = diff; bestDigit = digit; }
  }
  const confidence = minDiff === 1 ? 0.78 : minDiff === 2 ? 0.55 : 0.3;
  return { digit: bestDigit, confidence };
}

function parseMeterOcrText(rawText) {
  if (!rawText) return { value: null, confidence: 0 };
  const str = String(rawText).trim();
  if (!str) return { value: null, confidence: 0 };
  // 1. Check for number directly associated with kWh, units, or reading
  const kwhMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:kwh|units)/i) ||
    str.match(/(?:kwh|reading|units|read|curr|k\.w\.h)[:\s]+(\d+(?:\.\d+)?)/i);
  if (kwhMatch) {
    const val = parseFloat(kwhMatch[1]);
    if (!isNaN(val) && isFinite(val)) return { value: val, confidence: 0.92 };
  }
  // 2. Standalone decimal numbers (typical of digital meters, e.g. 1428.5)
  const decMatches = str.match(/\b\d+\.\d+\b/g);
  if (decMatches && decMatches.length === 1) {
    const val = parseFloat(decMatches[0]);
    if (!isNaN(val) && isFinite(val)) return { value: val, confidence: 0.88 };
  }
  // 3. Fallback: integer or decimal token sequence
  const numMatches = str.match(/\b\d+(?:\.\d+)?\b/g);
  if (numMatches && numMatches.length > 0) {
    // Pick the token most resembling a meter reading (3 to 7 digits)
    const candidates = numMatches.filter(n => n.length >= 3 && n.length <= 8);
    const chosen = candidates.length > 0 ? candidates[candidates.length - 1] : numMatches[numMatches.length - 1];
    const val = parseFloat(chosen);
    if (!isNaN(val) && isFinite(val)) return { value: val, confidence: 0.75 };
  }
  const cleaned = str.replace(/[^0-9.]/g, '');
  const val = parseFloat(cleaned);
  if (isNaN(val) || !isFinite(val)) return { value: null, confidence: 0 };
  return { value: val, confidence: 0.6 };
}

function validateMeterReadingFraud({ roomId, curr, prev, photoHash, meterQr, isReplaced = false }) {
  const last = lastMeter(roomId);
  const p = prev != null ? +prev : (last ? last.curr : 0);
  const c = +curr;
  const flags = [];

  if (!isReplaced && c < p) flags.push(`Reading (${c}) is lower than previous reading (${p})`);
  const units = isReplaced ? c : (c - p);
  if (units > 1500) flags.push(`Excessive consumption: ${units} units (exceeds 1500 unit threshold)`);

  if (!isReplaced && last && last.span && last.span >= 7 && last.units > 0) {
    const dailyAvg = last.units / last.span;
    const currentDays = Math.max(1, diffDays(today(), last.date));
    if (units / currentDays > dailyAvg * 3.5 && units > 100) {
      flags.push(`Abnormal consumption surge: ${round2(units / currentDays)} units/day vs average ${round2(dailyAvg)} units/day`);
    }
  }

  if (photoHash) {
    const duplicate = Store.all('meter').find(m => m.photoHash === photoHash && m.roomId !== roomId);
    if (duplicate) flags.push(`Duplicate meter display photo detected from room ${roomName(duplicate.roomId)}`);
  }

  const room = roomById(roomId);
  const reg = getMeterForRoom(roomId);
  const expectedQr = (reg && reg.qrCode) || (room ? `MTR-${room.no}` : null);
  if (expectedQr && meterQr) {
    const cleanScanned = String(meterQr).trim().toUpperCase();
    const cleanExpected = expectedQr.toUpperCase();
    if (cleanScanned !== cleanExpected) {
      flags.push(`Meter QR mismatch: scanned ${meterQr}, expected ${expectedQr}`);
    }
  }

  return {
    valid: flags.length === 0,
    flags,
    units,
    prev: p,
    curr: c
  };
}

/* ===================================================================== digital rental agreements */
function createAgreement({ resId, templateId = null, startDate = today(), endDate, rent, deposit, noticeDays = 30, rules = [], clauses = [] }) {
  const r = resById(resId);
  if (!r) throw new AppError('Resident not found');
  const h = Store.hostel() || {};
  const o = (Store.org && Store.org()) || {};
  const s = S(h.id, resId);
  const room = roomById(r.roomId);
  const end = endDate || addDays(startDate, 335);
  const existing = Store.all('agr').filter(a => a.resId === resId);
  const ver = existing.length + 1;
  const id = `agr-${resId}-v${ver}`;

  const templates = (s.agreements && s.agreements.templates) || DEFAULT_AGREEMENT_TEMPLATES;
  const tpl = (templateId && templates.find(t => t.id === templateId)) || templates[0] || {};

  const vars = {
    resident_name: r.name,
    room_no: room ? room.no : '',
    bed_id: r.bed || '',
    rent: round2(rent != null ? rent : r.rent || 0),
    deposit: round2(deposit != null ? deposit : r.deposit || 0),
    notice_days: +noticeDays || 30,
    hostel_name: h.name || '',
    owner_name: (h.settings && h.settings.ownerName) || o.owner_name || (Store.me && Store.me.full_name) || '',
    start_date: startDate,
    end_date: end
  };

  const interpolate = text => String(text || '').replace(/\{\{([a-z_]+)\}\}/g, (_, k) => (vars[k] != null ? vars[k] : `{{${k}}}`));

  const standardClauses = [
    'The tenant agrees to pay monthly rent in advance on or before the rent due date.',
    'Security deposit is refundable upon checkout subject to deductions for unpaid dues or physical damage beyond normal wear and tear.',
    'A mandatory notice period of ' + noticeDays + ' days must be served prior to vacating.',
    'Subletting or accommodating unauthorized guests without management consent is strictly prohibited.',
    'Hostel and house rules including silent hours and visitor policies shall be strictly adhered to.'
  ];

  const tplClauses = (tpl.clauses || []).map(interpolate);
  const tplRules = (tpl.houseRules || []).map(interpolate);

  const finalClauses = clauses.length ? clauses.map(interpolate) : (tplClauses.length ? tplClauses : standardClauses);
  const finalRules = rules.length ? rules.map(interpolate) : (tplRules.length ? tplRules : (h.settings && h.settings.houseRules) || []);

  const agr = {
    id,
    resId,
    templateId: tpl.id || 'tpl-std',
    templateName: tpl.name || 'Standard Agreement',
    hostelId: h.id,
    version: ver,
    status: 'active',
    startDate,
    endDate: end,
    noticeDays: +noticeDays || 30,
    rent: round2(rent != null ? rent : r.rent || 0),
    deposit: round2(deposit != null ? deposit : r.deposit || 0),
    owner: {
      name: vars.owner_name,
      phone: h.phone || o.phone || '',
      hostelName: h.name || '',
      address: h.address || ''
    },
    resident: {
      name: r.name,
      phone: r.phone,
      guardian: r.guardian || '',
      guardianPhone: r.guardianPhone || '',
      address: r.address || '',
      roomId: r.roomId,
      roomNo: room ? room.no : '',
      bed: r.bed || ''
    },
    clauses: finalClauses,
    rules: finalRules,
    rawClauses: clauses.length ? clauses : (tpl.clauses || standardClauses),
    rawRules: rules.length ? rules : (tpl.houseRules || []),
    signedAt: nowIso(),
    signedBy: Store.me && Store.me.full_name,
    legalDisclaimer: 'This electronic document is a binding rental contract under the Information Technology Act, 2000. It does not replace state-specific mandatory stamp duty or registration requirements where applicable.'
  };

  Store.put('agr', agr);
  alog('agreement_created', `Agreement v${ver} generated for ${r.name}`, { agrId: id, resId, version: ver, templateId: tpl.id });
  notify({ to: 'res', resId, title: t('Rental agreement ready'), body: `${h.name} · ${fmtDate(startDate)} – ${fmtDate(end)}`, category: 'agreement' });
  return agr;
}

function getActiveAgreement(resId) {
  const all = Store.all('agr').filter(a => a.resId === resId && a.status === 'active');
  return all.sort(by('version', -1))[0] || null;
}

function renewAgreement(agrId, { newEndDate, rent, deposit, noticeDays }) {
  const old = Store.get(agrId);
  if (!old || old.kind !== 'agr') throw new AppError('Agreement not found');
  Store.patch(agrId, { status: 'renewed', renewedAt: nowIso() });
  return createAgreement({
    resId: old.resId,
    templateId: old.templateId,
    startDate: old.endDate || today(),
    endDate: newEndDate,
    rent: rent != null ? rent : old.rent,
    deposit: deposit != null ? deposit : old.deposit,
    noticeDays: noticeDays != null ? noticeDays : old.noticeDays,
    clauses: old.rawClauses || old.clauses,
    rules: old.rawRules || old.rules
  });
}

function agreementDueRenewal(daysAhead = 30) {
  const target = addDays(today(), daysAhead);
  const due = [];
  for (const r of activeRes()) {
    const agr = getActiveAgreement(r.id);
    if (agr && agr.endDate && agr.endDate <= target && agr.endDate >= today()) {
      due.push({ resident: r, agreement: agr, daysRemaining: diffDays(agr.endDate, today()) });
    }
  }
  return due;
}

/* ===================================================================== verified payment webhooks */
function processVerifiedPaymentWebhook({ provider, event, payload, signature, secret, timestamp }) {
  if (!payload) throw new AppError('Invalid webhook payload', { status: 400 });
  if (secret) {
    if (!signature) throw new AppError('Missing webhook signature', { status: 401 });
    if (typeof crypto !== 'undefined' && crypto.createHmac) {
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
      let valid = false;
      if (timestamp) {
        const expectedWithTs = crypto.createHmac('sha256', secret).update(String(timestamp) + payloadStr).digest('hex');
        if (expectedWithTs === signature) valid = true;
      }
      const expectedWithoutTs = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
      if (expectedWithoutTs === signature) valid = true;
      if (!valid) throw new AppError('Invalid webhook signature', { status: 401 });
    }
  }

  let orderId = '', paymentId = '', amount = 0, currency = 'INR', status = 'failed';
  if (provider === 'razorpay') {
    const p = (payload.payload && payload.payload.payment && payload.payload.payment.entity) || (payload.payment && payload.payment.entity) || payload.entity || payload;
    if (!p || !p.id) throw new AppError('Malformed Razorpay payload', { status: 400 });
    orderId = p.order_id || (p.notes && p.notes.invId) || '';
    paymentId = p.id;
    amount = round2((p.amount || 0) / 100);
    currency = p.currency || 'INR';
    status = (event === 'payment.captured' || p.status === 'captured') ? 'success' : p.status;
  } else if (provider === 'cashfree') {
    const d = payload.data || payload;
    orderId = (d.order && d.order.order_id) || payload.orderId || '';
    paymentId = (d.payment && d.payment.cf_payment_id) || payload.paymentId || '';
    amount = round2((d.payment && d.payment.payment_amount) || payload.amount || 0);
    const cfPayStatus = (d.payment && d.payment.payment_status) || payload.status;
    status = (event === 'PAYMENT_SUCCESS_WEBHOOK' || cfPayStatus === 'SUCCESS') ? 'success' : 'failed';
  } else {
    orderId = payload.orderId || payload.order_id || '';
    paymentId = payload.paymentId || payload.transactionId || payload.id;
    amount = round2(payload.amount);
    status = (payload.status === 'SUCCESS' || payload.status === 'captured') ? 'success' : 'failed';
  }

  if (status !== 'success') {
    return { ok: false, status, message: 'Payment status not successful: ' + status };
  }

  if (!orderId && !paymentId) {
    throw new AppError('Payment missing order ID and transaction ID', { status: 400 });
  }

  let targetInv = null;
  if (orderId && Store.get(orderId)) targetInv = Store.get(orderId);
  else if (payload.notes && payload.notes.invId && Store.get(payload.notes.invId)) targetInv = Store.get(payload.notes.invId);
  else if (payload.notes && payload.notes.resId) {
    targetInv = openInv(payload.notes.resId)[0] || null;
  }

  const resId = targetInv ? targetInv.resId : (payload.notes && payload.notes.resId);
  if (!resId) throw new AppError('Could not associate payment with any resident', { status: 404 });

  const existingPay = Store.all('pay').find(p => p.ref === paymentId || p.idempotencyKey === `gw-${paymentId}` || p.idempotencyKey === `cf-${paymentId}`);
  if (existingPay) {
    return { ok: true, replay: true, pay: existingPay, message: 'Payment already processed' };
  }

  const pay = recordPayment({
    resId,
    amount,
    mode: 'upi',
    ref: paymentId,
    date: today(),
    note: `Automated verified payment via ${provider} (${orderId})`,
    invIds: targetInv ? [targetInv.id] : null,
    idempotencyKey: `cf-${paymentId}`
  });

  alog('payment_webhook_confirmed', `₹${amount} verified via ${provider} for ${(resById(resId) || {}).name}`, {
    provider, paymentId, orderId, amount, resId
  });

  return { ok: true, replay: false, pay };
}

/* ===================================================================== payment adapter & monthly billing batch */
const PaymentGateway = {
  PROVIDERS: ['direct_upi', 'cashfree', 'setu'],
  createPaymentLink({ invoiceId, amount, resId, hostelId, provider = 'cashfree' }) {
    const h = (Store.hostels || []).find(x => x.id === hostelId) || Store.hostel() || {};
    const p = (h.settings && h.settings.pay) || S().pay || {};
    if (provider === 'direct_upi') {
      return upiPayUrl(resId, amount);
    }
    if (provider === 'cashfree') {
      return `${baseUrl()}pay.html?inv_id=${encodeURIComponent(invoiceId)}&hostel_id=${encodeURIComponent(hostelId || h.id || '')}&res_id=${encodeURIComponent(resId || '')}&am=${encodeURIComponent(amount)}${p.upiId ? `&pa=${encodeURIComponent(p.upiId)}&pn=${encodeURIComponent(p.payee || h.name || '')}` : ''}`;
    }
    return `${baseUrl()}pay/${invoiceId}?provider=${provider}&amt=${amount}`;
  },
  verifyWebhookSignature({ payload, signature, secret, timestamp = '', provider = 'cashfree' }) {
    if (!secret || !signature) return false;
    if (typeof crypto !== 'undefined' && crypto.createHmac) {
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
      if (timestamp) {
        const expectedWithTs = crypto.createHmac('sha256', secret).update(String(timestamp) + payloadStr).digest('hex');
        if (expectedWithTs === signature) return true;
      }
      const expected = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
      return expected === signature;
    }
    return false;
  }
};

function composeMonthlyBillingMessage({ resident, name = '', hostelName = '', period = '', rent = 0, electricity = 0, mess = 0, charges = 0, previousDues = 0, totalDue = 0, payLink = '' } = {}) {
  const firstName = (resident && resident.name ? resident.name.split(' ')[0] : (name || '').split(' ')[0]) || 'Resident';
  const parts = [];
  if (rent > 0) parts.push(`Rent: ₹${rent.toLocaleString('en-IN')}`);
  if (electricity > 0) parts.push(`Electricity: ₹${electricity.toLocaleString('en-IN')}`);
  if (mess > 0) parts.push(`Mess: ₹${mess.toLocaleString('en-IN')}`);
  if (charges > 0) parts.push(`Other: ₹${charges.toLocaleString('en-IN')}`);
  if (previousDues > 0) parts.push(`Previous Dues: ₹${previousDues.toLocaleString('en-IN')}`);
  const breakdown = parts.length ? parts.join('. ') + '.' : '';

  let msg = `Hello ${firstName}, your ${period} dues for ${hostelName} are ₹${totalDue.toLocaleString('en-IN')}. ${breakdown}`;
  if (payLink) {
    msg += ` Please complete payment using your Sarvlekh link: ${payLink}`;
  }
  return msg;
}

/* Extra charges (Wi-Fi, AC, parking...). scope: 'all', 'rooms' (chosen rooms) or 'residents' (chosen
 * residents). Charges saved earlier with scope 'room' + roomId keep working as they did. */
function chargeApplies(chg, r) {
  if (chg.scope === 'rooms') return (chg.roomIds || []).includes(r.roomId);
  if (chg.scope === 'residents') return (chg.resIds || []).includes(r.id);
  if (chg.scope === 'room' && chg.roomId) return chg.roomId === r.roomId;
  return true;
}
// A one-time charge is billed by the owner pressing "Bill now": once per resident, never twice.
function billChargeNow(chg, date = today()) {
  if (!chg || chg.frequency !== 'onetime') throw new AppError('Only a one-time charge is billed this way');
  let created = 0, skipped = 0;
  for (const r of activeRes()) {
    if (!chargeApplies(chg, r)) continue;
    const id = `inv-chg-${chg.id}-${r.id}`;
    if (Store.get(id)) { skipped++; continue; }
    addInvoice({ id, resId: r.id, roomId: r.roomId, type: 'charge', period: ymOf(date), title: chg.name, amount: round2(chg.amount), date, due: addDays(date, rentDueDays()) });
    created++;
  }
  return { created, skipped };
}
// What the active monthly charges add to every resident's bill, and how many are for chosen people only.
function chargesSummary(list = S().charges || []) {
  const on = list.filter(c => c.active), monthly = on.filter(c => c.frequency === 'monthly');
  return { active: on.length, monthly: monthly.length, onetime: on.length - monthly.length, everyone: round2(sum(monthly.filter(c => !c.scope || c.scope === 'all'), c => +c.amount || 0)), chosen: monthly.filter(c => c.scope && c.scope !== 'all').length };
}
function runMonthlyBillingBatch({ ym = ymOf(today()), options = {} } = {}) {
  const h = Store.hostel();
  if (!h) throw new AppError('No active hostel selected');
  const settings = S();
  // The three "Add ... to the monthly bill" switches in Settings > Rent & billing (missing = on).
  const inc = settings.rent || {};
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${pad(daysIn(ym))}`;
  const excludeSet = new Set(options.excludeResIds || []);

  // Filter residents who were actively living during billing month ym
  const resList = activeRes().filter(r => {
    if (excludeSet.has(r.id)) return false;
    if (r.checkIn > monthEnd) return false;
    if (r.left && r.left < monthStart) return false;
    return true;
  });

  const results = {
    batchId: `batch-${h.id}-${ym}-${Date.now()}`,
    hostelId: h.id,
    period: ym,
    timestamp: nowIso(),
    totalResidents: resList.length,
    invoicesCreated: 0,
    invoicesSkipped: 0,
    totalBilledAmount: 0,
    residents: [],
    messages: []
  };

  for (const r of resList) {
    const resSummary = {
      resId: r.id,
      name: r.name,
      phone: r.phone,
      roomNo: (roomById(r.roomId) || {}).no || '',
      bed: r.bed || '',
      rentAmount: 0,
      elecAmount: 0,
      messAmount: 0,
      chargesAmount: 0,
      previousDues: 0,
      totalDue: 0,
      invoices: [],
      messageText: '',
      waLink: ''
    };

    // 1. Rent invoice
    const rPolicy = r.billingPolicy || settings.rent;
    const isJoiningDate = rPolicy.model === 'joining_date';
    let rentCycleId, rentPeriod, invDate, dueDate;
    if (isJoiningDate) {
      const annivDay = +r.checkIn.slice(8, 10);
      const clampedDay = Math.min(annivDay, daysIn(ym));
      const targetDate = `${ym}-${pad(clampedDay)}`;
      const cycle = residentCycleFor(r, targetDate);
      if (r.checkIn > cycle.cycleStart) {
        rentCycleId = null;
      } else {
        rentCycleId = `inv-rent-${r.id}-${cycle.cycleStart}`;
        rentPeriod = cycle.periodLabel;
        invDate = isArrears() ? cycle.cycleEnd : cycle.cycleStart;
        dueDate = isArrears() ? addDays(cycle.cycleEnd, rentDueDays()) : cycle.dueDate;
        if (isArrears() && today() < cycle.cycleEnd) rentCycleId = null;
      }
    } else {
      rentCycleId = `inv-rent-${r.id}-${ym}`;
      rentPeriod = ym;
      invDate = rentBillDate(ym);
      dueDate = addDays(invDate, rentDueDays());
      if (isArrears() && !rentBillable(ym)) rentCycleId = null;   // rent is billed after the month is over
    }

    const rentAmt = (!isJoiningDate && ym === ymOf(r.checkIn) && r.checkIn > monthStart) ? calcCheckInRent({ checkInDate: r.checkIn, monthlyRent: r.rent }).amount : r.rent;
    if (rentCycleId && r.rent > 0) {
      if (!Store.get(rentCycleId)) {
        if (!options.previewOnly) {
          const inv = addInvoice({
            id: rentCycleId,
            resId: r.id,
            roomId: r.roomId,
            type: 'rent',
            period: rentPeriod,
            title: `${t('Rent')} ${fmtYM(ym)}`,
            amount: rentAmt,
            date: invDate,
            due: dueDate,
            policySnapshot: { model: rPolicy.model, rate: r.rent }
          });
          resSummary.invoices.push(inv.id);
        } else {
          resSummary.invoices.push(rentCycleId);
        }
        results.invoicesCreated++;
        results.totalBilledAmount += rentAmt;
        resSummary.rentAmount = rentAmt;
      } else {
        results.invoicesSkipped++;
        const existing = Store.get(rentCycleId);
        resSummary.rentAmount = existing.amount || r.rent;
      }
    }

    // 2. Electricity bill
    const elecInvs = resInvoices(r.id).filter(i => i.type === 'electricity' && i.period === ym);
    resSummary.elecAmount = inc.includeElec === false ? 0 : sum(elecInvs, i => i.amount || 0);

    // 3. Mess bill
    if (!(isArrears() && !rentBillable(ym)) && inc.includeMess !== false && settings.mess && (settings.mess.billing === 'compulsory' || (settings.mess.billing === 'optional' && r.food !== false))) {
      const messFee = settings.mess.monthlyFee || 2500;
      const messInvId = `inv-mess-${r.id}-${ym}`;
      if (!Store.get(messInvId)) {
        if (!options.previewOnly) {
          const inv = addInvoice({
            id: messInvId,
            resId: r.id,
            roomId: r.roomId,
            type: 'mess',
            period: ym,
            title: `${t('Mess fee')} ${fmtYM(ym)}`,
            amount: messFee,
            date: rentBillDate(ym),
            due: addDays(rentBillDate(ym), 5)
          });
          resSummary.invoices.push(inv.id);
        } else {
          resSummary.invoices.push(messInvId);
        }
        results.invoicesCreated++;
        results.totalBilledAmount += messFee;
        resSummary.messAmount = messFee;
      } else {
        const existing = Store.get(messInvId);
        resSummary.messAmount = existing.amount || messFee;
      }
    }

    // 4. Recurring additional charges
    if (inc.includeCharges !== false && Array.isArray(settings.charges) && settings.charges.length) {
      for (const chg of settings.charges) {
        if (!chg.active || chg.frequency !== 'monthly') continue;
        if (chg.effectiveDate && chg.effectiveDate > monthEnd) continue;
        if (isArrears() && !rentBillable(ym)) continue;
        if (!chargeApplies(chg, r)) continue;
        const chgInvId = `inv-chg-${chg.id}-${r.id}-${ym}`;
        if (!Store.get(chgInvId)) {
          if (!options.previewOnly) {
            const inv = addInvoice({
              id: chgInvId,
              resId: r.id,
              roomId: r.roomId,
              type: 'charge',
              period: ym,
              title: `${chg.name} ${fmtYM(ym)}`,
              amount: chg.amount,
              date: rentBillDate(ym),
              due: addDays(rentBillDate(ym), 5)
            });
            resSummary.invoices.push(inv.id);
          } else {
            resSummary.invoices.push(chgInvId);
          }
          results.invoicesCreated++;
          results.totalBilledAmount += chg.amount;
          resSummary.chargesAmount += chg.amount;
        } else {
          const existing = Store.get(chgInvId);
          resSummary.chargesAmount += existing.amount || chg.amount;
        }
      }
    }

    // 5. Total outstanding dues
    const currentDue = resDue(r.id);
    const billedInCycle = resSummary.rentAmount + resSummary.elecAmount + resSummary.messAmount + resSummary.chargesAmount;
    if (options.previewOnly) {
      resSummary.previousDues = currentDue;
      resSummary.totalDue = round2(currentDue + billedInCycle);
    } else {
      resSummary.totalDue = currentDue;
      resSummary.previousDues = Math.max(0, round2(currentDue - billedInCycle));
    }

    // 6. WhatsApp message text & link
    const msg = composeMonthlyBillingMessage({
      resident: r,
      hostelName: h.name,
      period: fmtYM(ym),
      rent: resSummary.rentAmount,
      electricity: resSummary.elecAmount,
      mess: resSummary.messAmount,
      charges: resSummary.chargesAmount,
      previousDues: resSummary.previousDues,
      totalDue: resSummary.totalDue,
      payLink: upiPayUrl(r.id, resSummary.totalDue)
    });
    resSummary.messageText = msg;
    resSummary.waLink = `https://wa.me/91${phone10(r.phone)}?text=${encodeURIComponent(msg)}`;

    results.residents.push(resSummary);
    if (resSummary.totalDue > 0 && phone10(r.phone)) {
      results.messages.push({
        resId: r.id,
        name: r.name,
        phone: r.phone,
        totalDue: resSummary.totalDue,
        text: msg,
        waLink: resSummary.waLink
      });
    }
  }

  if (!options.previewOnly) alog('monthly_billing_batch', `Monthly billing run: ${results.invoicesCreated} created, ${results.invoicesSkipped} skipped, ${results.messages.length} reminders ready`, {
    batchId: results.batchId,
    ym,
    invoicesCreated: results.invoicesCreated,
    totalBilledAmount: results.totalBilledAmount
  });

  return results;
}

function canSkipMeal(mealK, date = today(), time = null) {
  const m = mealByKey(mealK);
  if (!m) return { allowed: false, reason: 'Invalid meal' };
  const s = S().mess;
  if (s && s.skip === false) return { allowed: false, reason: 'Meal skipping is disabled by policy' };
  if (time) {
    const prev = m.prev;
    const cutDay = prev ? addDays(date, -1) : date;
    const [ch, cm] = String(m.cutoff || '22:00').split(':').map(Number);
    const dCut = parse(cutDay); dCut.setHours(ch, cm || 0, 0, 0);
    const [th, tm] = String(time).split(':').map(Number);
    const dNow = parse(today()); dNow.setHours(th, tm || 0, 0, 0);
    if (dNow >= dCut) return { allowed: false, reason: `Cutoff passed (${m.cutoff})` };
    return { allowed: true };
  }
  return { allowed: beforeCutoff(date, mealK, 'skip'), reason: beforeCutoff(date, mealK, 'skip') ? null : 'Cutoff time passed' };
}

function calcMessRebate(resId, fromDate, toDate) {
  const messCfg = S().mess || {};
  if (messCfg.billing === 'included') return { rebate: 0, days: 0, eligible: false };
  const leaveDays = Math.max(0, diffDays(toDate, fromDate) + 1);
  const minLeaveDays = messCfg.minLeaveDays != null ? messCfg.minLeaveDays : 2;
  if (leaveDays < minLeaveDays) return { rebate: 0, days: leaveDays, eligible: false };
  const rebatePerDay = messCfg.rebatePerDay || 80;
  const rebate = round2(leaveDays * rebatePerDay);
  return { rebate, days: leaveDays, eligible: true, ratePerDay: rebatePerDay };
}

/* ===================================================================== laundry */
const laundryUsed = (resId, ym) => sum(Store.all('laundry').filter(l => l.resId === resId && ymOf(l.date) === ym), l => l.pcs);
function laundryQuote(resId, pcs, date = today()) {
  const L = S().laundry, used = laundryUsed(resId, ymOf(date));
  const freeLeft = Math.max(0, L.freePcs - used), extra = Math.max(0, pcs - freeLeft);
  return { used, freeLeft, extra, charge: extra * L.rate, freeAfter: Math.max(0, freeLeft - pcs) };
}
function laundryReceive({ resId, pcs, note = '', date = today() }) {
  const r = resById(resId); if (!r) throw new Error('Choose a resident');
  pcs = Math.round(+pcs);
  if (!isFinite(pcs) || isNaN(pcs) || !(pcs > 0)) throw new Error('Enter number of clothes');
  if (pcs > 100) throw new Error('Cannot receive more than 100 clothes at once');
  const q = laundryQuote(resId, pcs, date);
  const l = Store.put('laundry', { resId, roomId: r.roomId, pcs, note, date, ts: nowIso(), status: 'received', extra: q.extra, charge: q.charge, freeAfter: q.freeAfter, by: Store.me && Store.me.full_name });
  if (q.charge > 0) { const inv = addInvoice({ id: `inv-ld-${l.id}`, resId, roomId: r.roomId, type: 'laundry', period: ymOf(date), title: `${t('Laundry')} ${fmtShort(date)} (${q.extra} ${t('extra pcs')})`, amount: q.charge, date, due: addDays(date, 7) }); Store.patch(l.id, { invId: inv.id }); }
  notify({ to: 'res', resId, title: t('Laundry received'), body: `${pcs} ${t('clothes')}` });
  return { l, q };
}
function laundryMessage(l, kind) {
  const r = resById(l.resId);
  return tpl(kind, { name: r.name.split(' ')[0], pcs: l.pcs, date: fmtShort(l.date), free: l.freeAfter, charge: l.charge > 0 ? `\n${t('Extra charge')}: ${rs(l.charge)} (${l.extra} x ${rs(S().laundry.rate)})` : '', hostel: (Store.hostel() || {}).name }, waLang(r));
}

/* ===================================================================== mess */
const menuDoc = () => Store.get('menu') || { id: 'menu', week: {} };
/* Rotating menu: the owner picks how many weeks the menu repeats over (1 to 5). Week 1 is stored as doc.week (as it always
 * was), weeks 2 to 5 as doc.weeks[n]. doc.anchor is the Monday on which Week 1 started; every later Monday moves one week on,
 * and after the last week it starts again at Week 1 (2-week cycle: 1, 2, 1, 2 ...). */
const menuCycle = () => Math.min(5, Math.max(1, Math.round(+menuDoc().cycle) || 1));
const mondayOf = d => addDays(d, -((parse(d).getDay() + 6) % 7));
function menuWeekNo(date) {
  const n = menuCycle(); if (n === 1) return 1;
  const wk = Math.floor(diffDays(mondayOf(date), menuDoc().anchor || mondayOf(today())) / 7);
  return ((wk % n) + n) % n + 1;
}
const menuWeekData = (doc, n) => ((n === 1 ? doc.week : (doc.weeks || {})[n]) || {});
const dishesFor = (date, mealK) => (!mealServed(date, mealK) ? [] : (menuWeekData(menuDoc(), menuWeekNo(date))[parse(date).getDay()] || {})[mealK] || []).map(id => Store.get(id)).filter(Boolean);
// Cut-off: e.g. breakfast skip allowed until 22:00 the previous day.
function cutoffAt(date, mealK, kind = 'skip') {
  const m = mealByKey(mealK), tm = kind === 'tiffin' ? m.tCutoff : m.cutoff, prev = kind === 'tiffin' ? m.tPrev : m.prev;
  const d = parse(prev ? addDays(date, -1) : date); const [h, mi] = String(tm || '00:00').split(':').map(Number); d.setHours(h, mi || 0, 0, 0); return d;
}
const beforeCutoff = (date, mealK, kind) => new Date() < cutoffAt(date, mealK, kind);
const skipId = (resId, date, mealK) => `skip-${resId}-${date}-${mealK}`;
const tiffinId = (resId, date, mealK) => `tif-${resId}-${date}-${mealK}`;
// Meals-off leave: at most 60 days at a time and never two overlapping leaves (a 400-day leave or a doubled one
// silently switched the cook's head-count off). Returns the problem as text, or '' when it is fine.
const MAX_LEAVE_DAYS = 60;
function leaveProblem(resId, from, to, exceptId = '') {
  if (!from || !to) return 'Choose both dates';
  if (to < from) return 'End date is before start date';
  if (diffDays(to, from) + 1 > MAX_LEAVE_DAYS) return t('Leave can be at most {n} days at a time. For longer, check out or ask the owner.', { n: MAX_LEAVE_DAYS });
  if (Store.all('leave').some(l => l.resId === resId && l.id !== exceptId && l.from <= to && l.to >= from)) return t('There is already a leave on some of these days');
  return '';
}
function onLeave(resId, date) { return Store.all('leave').some(l => l.resId === resId && l.from <= date && l.to >= date); }
function toggleSkip(resId, date, mealK, force) {
  const id = skipId(resId, date, mealK), cur = Store.get(id);
  if (!isAdmin() && !beforeCutoff(date, mealK, 'skip')) throw new Error(t('Cut-off time passed for {m}', { m: mealName(mealK) }));
  const want = force === true ? true : !skippedOn(resId, date, mealK), dflt = skipPlanWants(resId, date, mealK);
  // a dated row exists only where the day differs from the weekly plan: a skip the plan does not have, or an "off" for a plan skip
  if (want === dflt) { if (cur) Store.remove(id); }
  else Store.put('skip', want ? { id, resId, date, meal: mealK, ts: nowIso() } : { id, resId, date, meal: mealK, status: 'off', ts: nowIso() });
  // skipping means no food at all, so a tiffin for that meal goes with it (a plan tiffin is ignored while the skip stands)
  if (want) { const tf = Store.get(tiffinId(resId, date, mealK)); if (tf) Store.remove(tf.id); }
  return want;
}
// The resident writes ONE short line about how they want their tiffin packed ("3 roti, dry sabzi, no curd");
// every tiffin they order afterwards carries it, so the cook never has to ask. Stored as a template row of
// the 'tiffin' kind (residents may write that kind) with no date, so it never counts as an order.
const TIF_NOTE_MAX = 60;
const tifNoteId = resId => `tifnote-${resId}`;
const tifNoteOf = resId => (Store.get(tifNoteId(resId)) || {}).note || '';
function setTifNote(resId, note) {
  const r = resById(resId); if (!r) throw new AppError('Resident not found');
  const n = String(note || '').replace(/\s+/g, ' ').trim().slice(0, TIF_NOTE_MAX);
  return Store.put('tiffin', { id: tifNoteId(resId), resId, roomId: r.roomId, date: '', meal: 'note', status: 'template', note: n });
}
/* Weekly meal plan: the resident ticks, once, which meals they want packed as a TIFFIN and which they will
 * SKIP, on which weekdays (e.g. tiffin Mon-Fri lunch, skip Sat-Sun dinner). From then on those days happen by
 * themselves every week until the plan is changed. One template row of the 'tiffin' kind (no date, so it is never
 * an order) holds both: plan = tiffin, skipPlan = skip.
 *   tiffin -> eats, but packed: counted in the plates AND listed for the cook to pack.
 *   skip   -> eats nothing at the hostel: not counted, and no tiffin either.
 *   both   -> cannot be on the same meal and day: skip wins (the editor never lets both be ticked).
 * A single day can still be changed until that meal's cut-off: that writes a dated row which differs from the plan
 * (an extra tiffin / skip, or an "off" that cancels the plan for that day) and exists only where it differs.
 * After the cut-off nothing changes, so what the plan says is what the kitchen cooks. */
const TIF_PLAN_DAYS = [1, 2, 3, 4, 5, 6, 0];
const tifPlanId = resId => `tifplan-${resId}`;
const tifPlanOf = resId => { const p = Store.get(tifPlanId(resId)); return p && (p.plan || p.skipPlan) ? p : null; };
const planHas = (plan, date, mealK) => (((plan || {})[parse(date).getDay()]) || []).includes(mealK);
const tifPlanWants = (resId, date, mealK) => { const p = tifPlanOf(resId); return !!p && date >= (p.from || '') && planHas(p.plan, date, mealK); };
const skipPlanWants = (resId, date, mealK) => { const p = tifPlanOf(resId); return !!p && S().mess.skip !== false && date >= (p.from || '') && planHas(p.skipPlan, date, mealK); };
// Is this meal skipped for this resident on this date? (one answer for the resident, the cook, the owner and the manager)
function skippedOn(resId, date, mealK) {
  const rec = Store.get(skipId(resId, date, mealK));
  if (rec) return rec.status !== 'off';
  return skipPlanWants(resId, date, mealK);
}
// Does this resident get a tiffin for this meal on this date?
function tiffinOn(resId, date, mealK) {
  if (S().mess.tiffin === false) return false;
  const r = resById(resId); if (!r || r.food === false || !activeOn(r, date)) return false;
  if (onLeave(resId, date) || skippedOn(resId, date, mealK)) return false;
  const rec = Store.get(tiffinId(resId, date, mealK));
  if (rec) return rec.status !== 'off';
  return tifPlanWants(resId, date, mealK);
}
// The tiffin row for a day: the saved one, or one made up from the plan (saved the moment the cook marks it packed).
const tifRecOf = (resId, date, mealK) => Store.get(tiffinId(resId, date, mealK)) || { id: tiffinId(resId, date, mealK), resId, roomId: (resById(resId) || {}).roomId, date, meal: mealK, note: tifNoteOf(resId), status: 'requested', fromPlan: true };
const tiffinsOnDate = date => meals().flatMap(m => headcount(date, m.k).tiffins);
// Everyone skipping something on a date, plan or one-off: [{resId, roomId, meal}]
const skipsOnDate = date => meals().flatMap(m => residents().filter(r => r.food !== false && activeOn(r, date) && !onLeave(r.id, date) && skippedOn(r.id, date, m.k)).map(r => ({ resId: r.id, roomId: r.roomId, meal: m.k, date })));
function ensureTifRec(resId, date, mealK) { const x = tifRecOf(resId, date, mealK); return x.fromPlan ? Store.put('tiffin', { id: x.id, resId, roomId: x.roomId, date, meal: mealK, note: x.note, status: 'requested', ts: nowIso() }) : x; }
// Saves the weekly plan. plan / skipPlan: {weekday: [mealKeys]}. Pass undefined to keep what is saved.
function setTifPlan(resId, plan, skipPlan) {
  const r = resById(resId); if (!r) throw new AppError('Resident not found');
  const old = tifPlanOf(resId);
  const clean = src => { const o = {}; for (const d of TIF_PLAN_DAYS) { const ms = [...new Set(((src || {})[d] || []).filter(k => meals().some(m => m.k === k)))]; if (ms.length) o[d] = ms; } return o; };
  const newTif = clean(plan === undefined ? (old || {}).plan : plan), newSkip = clean(skipPlan === undefined ? (old || {}).skipPlan : skipPlan);
  for (const d of Object.keys(newSkip)) if (newTif[d]) { newTif[d] = newTif[d].filter(k => !newSkip[d].includes(k)); if (!newTif[d].length) delete newTif[d]; }   // skip wins
  // a meal whose cut-off has already passed keeps what it was; a new plan cannot reach back into it
  for (const d of [today(), addDays(today(), 1), addDays(today(), 2)]) for (const m of meals()) {
    if (!beforeCutoff(d, m.k, 'tiffin')) {
      const id = tiffinId(resId, d, m.k);
      if (!Store.get(id)) { const was = !!old && tifPlanWants(resId, d, m.k), will = planHas(newTif, d, m.k); if (was !== will) Store.put('tiffin', { id, resId, roomId: r.roomId, date: d, meal: m.k, note: tifNoteOf(resId), status: was ? 'requested' : 'off', ts: nowIso() }); }
    }
    if (!beforeCutoff(d, m.k, 'skip')) {
      const id = skipId(resId, d, m.k);
      if (!Store.get(id)) { const was = !!old && skipPlanWants(resId, d, m.k), will = planHas(newSkip, d, m.k); if (was !== will) Store.put('skip', was ? { id, resId, date: d, meal: m.k, ts: nowIso() } : { id, resId, date: d, meal: m.k, status: 'off', ts: nowIso() }); }
    }
  }
  return Store.put('tiffin', { id: tifPlanId(resId), resId, roomId: r.roomId, date: '', meal: 'plan', status: 'template', plan: newTif, skipPlan: newSkip, from: today(), ts: nowIso() });
}
// "Mon-Fri" / "Mon, Wed, Sat" from a list of weekday numbers (Monday first)
function tifDaysText(days) {
  const idx = TIF_PLAN_DAYS.map((d, i) => (days.includes(d) ? i : -1)).filter(i => i >= 0), out = [];
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++; const nm = k => DAYS()[TIF_PLAN_DAYS[idx[k]]]; out.push(j - i >= 2 ? `${nm(i)}-${nm(j)}` : idx.slice(i, j + 1).map((_, k) => nm(i + k)).join(', ')); i = j + 1; }
  return days.length === 7 ? t('Every day') : out.join(', ');
}
// "Lunch: Mon-Fri · Dinner: Sat" for one kind of plan ('plan' = tiffin, 'skipPlan' = skip)
function tifPlanText(resId, kind = 'plan') {
  const p = tifPlanOf(resId); if (!p || !p[kind]) return '';
  return meals().map(m => { const ds = TIF_PLAN_DAYS.filter(d => (p[kind][d] || []).includes(m.k)); return ds.length ? `${mealName(m.k)}: ${tifDaysText(ds)}` : ''; }).filter(Boolean).join(' · ');
}
// The one place that undoes a skip for a single day (so a tiffin can go on, or the resident changes their mind)
function clearSkipDay(resId, date, mealK) {
  const id = skipId(resId, date, mealK), cur = Store.get(id);
  if (skipPlanWants(resId, date, mealK)) Store.put('skip', { id, resId, date, meal: mealK, status: 'off', ts: nowIso() });
  else if (cur) Store.remove(id);
}
function toggleTiffin(resId, date, mealK, note = '') {
  const id = tiffinId(resId, date, mealK), cur = Store.get(id), r = resById(resId);
  note = note || tifNoteOf(resId);
  if (!isAdmin() && !beforeCutoff(date, mealK, 'tiffin')) throw new Error(t('Cut-off time passed for {m}', { m: mealName(mealK) }));
  const want = !tiffinOn(resId, date, mealK), dflt = tifPlanWants(resId, date, mealK);
  // a tiffin on a skipped meal means "I am eating after all": that is only allowed while the skip could still be changed
  if (want && skippedOn(resId, date, mealK) && !isAdmin() && !beforeCutoff(date, mealK, 'skip')) throw new Error(t('Cut-off time passed for {m}', { m: mealName(mealK) }));
  // keep a dated row only where the day differs from the plan; otherwise the plan (or nothing) already says it
  if (want === dflt) { if (cur) Store.remove(id); }
  else Store.put('tiffin', { id, resId, roomId: (r || {}).roomId, date, meal: mealK, note, status: want ? 'requested' : 'off', ts: nowIso() });
  if (want && skippedOn(resId, date, mealK)) clearSkipDay(resId, date, mealK);
  return want;
}
// Tiffins packed and meals skipped in one month (plans included), for the monthly report
function monthMealStats(ym) {
  let tiffins = 0, skips = 0; const end = ym === ymOf(today()) ? today() : `${ym}-31`;
  for (let d = `${ym}-01`; d <= end && ymOf(d) === ym; d = addDays(d, 1)) for (const m of meals()) { const hc = headcount(d, m.k); tiffins += hc.tiffin; skips += hc.skip; }
  return { tiffins, skips };
}
function headcount(date, mealK) {
  const eligible = residents().filter(r => r.food !== false && activeOn(r, date));
  let leave = 0, skip = 0;
  for (const r of eligible) { if (onLeave(r.id, date)) leave++; else if (skippedOn(r.id, date, mealK)) skip++; }
  const tiffins = eligible.filter(r => tiffinOn(r.id, date, mealK)).map(r => tifRecOf(r.id, date, mealK));
  const guests = sum(Store.all('guestmeal').filter(g => g.date === date && g.meal === mealK), g => g.count);
  const eat = eligible.length - leave - skip + guests;
  const served = Store.get(`served-${date}-${mealK}`);
  return { eligible: eligible.length, leave, skip, tiffin: tiffins.length, tiffins, guests, eat, served: served ? served.count : null };
}
// What the menu says one person needs of each item for a meal on a date: {itemId: qty}
function perPersonNeed(date, mealK) {
  const out = {};
  for (const d of dishesFor(date, mealK)) for (const g of d.ings || []) { const per = (+g.qty || 0) / Math.max(1, +d.serves || 1); out[g.itemId] = (out[g.itemId] || 0) + per; }
  return out;
}
// Expected usage per item between two dates (exclusive end), using actual headcount per day/meal.
function expectedUse(from, to) {
  const use = {};
  for (let d = from; d < to; d = addDays(d, 1)) for (const m of meals()) {
    const hc = headcount(d, m.k), n = hc.served != null ? hc.served : hc.eat, need = perPersonNeed(d, m.k);
    for (const k in need) use[k] = (use[k] || 0) + need[k] * n;
  }
  return use;
}
// Learning: compare what the recipe predicted with what was really used between two purchases
// (stock after receiving − stock the cook reported left at the next request). The ratio becomes a
// per-item factor (the kitchen's "buffer") applied to all future forecasts.
function learnFactor(itemId) {
  const prs = Store.all('pr').filter(p => p.status !== 'rejected' && (p.items || []).some(x => x.itemId === itemId)).sort(by('date'));
  const ratios = [];
  for (let i = 0; i < prs.length - 1; i++) {
    const a = prs[i], b = prs[i + 1], ai = a.items.find(x => x.itemId === itemId), bi = b.items.find(x => x.itemId === itemId);
    if (a.status !== 'received' || !a.receivedOn || !(ai.recvQty > 0) || bi.leftQty == null || b.date <= a.receivedOn) continue;
    const used = (+ai.leftQty || 0) + (+ai.recvQty) - (+bi.leftQty || 0);
    const exp = expectedUse(a.receivedOn, b.date)[itemId] || 0;
    if (used > 0 && exp > 0) ratios.push(used / exp);
  }
  const last = ratios.slice(-3);
  if (!last.length) return { factor: 1, cycles: 0 };
  return { factor: Math.min(3, Math.max(0.3, round2(sum(last) / last.length))), cycles: ratios.length };
}
let _factorCache = { at: 0, map: {} };
function factor(itemId) {
  if (!S().mess.learn) return 1;
  if (Date.now() - _factorCache.at > 30000) _factorCache = { at: Date.now(), map: {} };
  if (!(itemId in _factorCache.map)) _factorCache.map[itemId] = learnFactor(itemId).factor;
  return _factorCache.map[itemId];
}
// Cook's plan for a meal: headcount and how much of each ingredient to take out.
function cookPlan(date, mealK) {
  const hc = headcount(date, mealK), need = perPersonNeed(date, mealK);
  const list = Object.keys(need).map(id => { const it = itemById(id); const f = factor(id); return it ? { item: it, qty: round2(need[id] * hc.eat * f), factor: f } : null; }).filter(Boolean);
  return { hc, dishes: dishesFor(date, mealK), list };
}
// Average daily need for the next 7 days of menu → days of stock left.
function dailyNeed(itemId) {
  let tot = 0; const n = activeRes().filter(r => r.food !== false).length;
  for (let i = 0; i < 7; i++) { const d = addDays(today(), i); for (const m of meals()) tot += (perPersonNeed(d, m.k)[itemId] || 0) * n; }
  return round2((tot / 7) * factor(itemId));
}
/* ===================================================================== stock ledger
 * Stock is not a number somebody overwrites: it is the opening balance plus every movement, added up.
 * - Quantities are whole thousandths (grams for kg, ml for litre) and are only ever added as integers, so a
 *   sum can never drift the way 0.1 + 0.2 does. Money is whole paise.
 * - Each movement is one row in 'mv' with an id that says what it is (the day's usage, the receipt of a
 *   purchase, a count). Posting the same event again finds its row and does nothing: stock cannot be
 *   taken off twice, whether the app was closed half way, two phones ran the same day, or a button was
 *   pressed twice.
 * - A day's usage is a single row for all items, so it is booked completely or not at all.
 * - Nothing is clamped: a balance below zero is shown as it is (the books say more left the kitchen than
 *   came in), instead of the shortfall silently vanishing.
 * - Every row keeps what it was worked out from (headcount, recipe amount, learned buffer), so a figure
 *   can be explained and worked out again. Rows are never edited, only added.
 * - The first movement of an item writes its opening balance (the stock figure the item had before the
 *   ledger), after that item.stock is no longer read. Rows from before the ledger have no v:2 and stay as
 *   history. 'mv' is not archived, so the ledger is whole on every device.
 */
const MILLI = 1000;
const toM = x => Math.round((+x || 0) * MILLI);
const fromM = m => m / MILLI;
const paise = x => Math.round((+x || 0) * 100);
let _lx = { ver: -1, m: null };
function ledger() {
  if (_lx.m && _lx.ver === Store.ver) return _lx.m;
  const m = new Map(), ent = id => { let e = m.get(id); if (!e) m.set(id, e = { anchor: null, rows: [], qm: 0 }); return e; };
  for (const r of Store.all('mv')) {
    if (r.v !== 2) continue;
    if (r.items) { for (const id in r.items) ent(id).rows.push({ id: r.id, date: r.date, type: r.type, qm: r.items[id], ref: r.ref || '' }); }
    else if (r.itemId) {
      const e = ent(r.itemId);
      if (r.type === 'open') { if (!e.anchor || String(r.ts) > String(e.anchor.ts)) e.anchor = r; }
      else e.rows.push({ id: r.id, date: r.date, type: r.type, qm: r.qm, ref: r.ref || '', note: r.note || '' });
    }
  }
  for (const e of m.values()) e.qm = (e.anchor ? e.anchor.qm : 0) + e.rows.reduce((s, x) => s + x.qm, 0);
  _lx = { ver: Store.ver, m };
  return m;
}
const stockM = it => { const e = ledger().get(it.id); return e && e.anchor ? e.qm : toM(it.stock); };
const stockOf = it => fromM(stockM(it));
function ensureAnchor(it) {
  const e = ledger().get(it.id);
  if (e && e.anchor) return;
  Store.put('mv', { id: `mv-open-${it.id}`, v: 2, type: 'open', itemId: it.id, qm: toM(it.stock) - (e ? e.rows.reduce((s, x) => s + x.qm, 0) : 0), qty: it.stock || 0, date: today(), ts: nowIso(), note: 'Opening balance' });
}
// One movement. `id` makes it idempotent; leave it out only for something that really happens once per click.
function postMove(itemId, qm, type, { id, date = today(), ref = '', note = '', basis } = {}) {
  const it = itemById(itemId); if (!it || !Number.isInteger(qm) || qm === 0) return null;
  if (id && Store.get(id)) return Store.get(id);
  ensureAnchor(it);
  return Store.put('mv', { id, v: 2, type, itemId, qm, qty: fromM(qm), date, ref, note, ...(basis ? { basis } : {}), ts: nowIso() });
}
const moveStock = (itemId, qty, type, date = today(), ref = '', note = '', id) => postMove(itemId, toM(qty), type, { id, date, ref, note });
// A physical count: books the difference between what the ledger says and what is on the shelf.
function countTo(itemId, counted, type = 'count', note = '', id) {
  const it = itemById(itemId); if (!it) return null;
  if (!isFinite(+counted) || +counted < 0) throw new Error(t('The counted quantity cannot be negative'));
  return postMove(itemId, toM(counted) - stockM(it), type, { id, ref: 'count', note });
}
// Movements of one item inside a period, for the reports.
const itemMoves = (itemId, from, to) => ((ledger().get(itemId) || { rows: [] }).rows).filter(x => (!from || x.date >= from) && (!to || x.date <= to));
// What does not add up? Items that never entered the ledger, movements of items that no longer exist, negative balances.
function auditStock() {
  const lg = ledger(), out = [];
  for (const it of items()) {
    const e = lg.get(it.id);
    if (!e || !e.anchor) out.push({ item: it, problem: 'not in ledger yet', ledger: it.stock || 0 });
    else if (e.qm < 0) out.push({ item: it, problem: 'below zero', ledger: fromM(e.qm) });
  }
  for (const id of lg.keys()) if (!itemById(id)) out.push({ item: { id, name: id }, problem: 'movements for a deleted item', ledger: fromM(lg.get(id).qm) });
  return out;
}
function stockInfo(it) {
  const need = dailyNeed(it.id), st = stockOf(it), days = need > 0 ? Math.floor(st / need) : null;
  const low = (it.min > 0 && st <= it.min) || (days != null && days < 2);
  return { need, days, low };
}
// Days that already have their usage booked, by the ledger or by the older per-item rows.
const usageBooked = date => Store.get(`mv-useday-${date}`) || Store.all('mv').some(r => r.v !== 2 && r.type === 'use' && r.date === date);
// Daily consumption (automation): headcount x recipe, in whole thousandths, all items in ONE row.
function postConsumption(date) {
  if (usageBooked(date)) return false;
  const base = {}, meals_ = {};
  for (const m of meals()) {
    const hc = headcount(date, m.k), n = hc.served != null ? hc.served : hc.eat, need = perPersonNeed(date, m.k);
    meals_[m.k] = n;
    for (const k in need) base[k] = (base[k] || 0) + Math.round(need[k] * n * MILLI);
  }
  const items_ = {}, factors = {}, bases = {};
  for (const id of Object.keys(base).sort()) {
    const it = itemById(id); if (!it) continue;
    const f = factor(id), qm = Math.round(base[id] * f);
    if (qm <= 0) continue;
    ensureAnchor(it);
    items_[id] = -qm; factors[id] = f; bases[id] = base[id];
  }
  Store.put('mv', { id: `mv-useday-${date}`, v: 2, type: 'use', date, items: items_, ref: 'auto', basis: { eaters: meals_, base: bases, factor: factors }, ts: nowIso() });
  return true;
}
// After a gap (nobody opened the app) every missed day is booked, oldest first, up to a month back.
function catchUpConsumption(d0 = today()) {
  const days = Store.all('mv').filter(r => r.type === 'use' && (r.items || r.v !== 2)).map(r => r.date).sort();
  let from = days.length ? addDays(days[days.length - 1], 1) : addDays(d0, -3);
  if (from < addDays(d0, -31)) from = addDays(d0, -31);
  let n = 0;
  for (let day = from; day < d0; day = addDays(day, 1)) if (postConsumption(day)) n++;
  return n;
}
// Money in whole paise: quantity (thousandths) x rate (paise), rounded once per line.
const lineTotal = (qty, rate) => Math.round(toM(qty) * paise(rate) / MILLI);
function prTotal(p) { return sum(p.items || [], x => lineTotal(x.recvQty, x.rate)) / 100; }
const canReceive = () => isAdmin() || (ctx().role === 'cook' && S().kitchen.cookCanReceive) || (ctx().perms || []).includes('receive');
// Cook asks; the leftover reported here is also a physical stock count.
function createPR({ items: list, note = '' }) {
  if (!list.length) throw new Error('Add at least one item');
  const no = Store.all('pr').length + 1;
  const pr = Store.put('pr', { no: `PR-${no}`, date: today(), ts: nowIso(), by: Store.me && Store.me.full_name, byRole: ctx().role, status: isAdmin() ? 'approved' : 'requested', items: list.map(x => ({ itemId: x.itemId, name: (itemById(x.itemId) || {}).name, unit: (itemById(x.itemId) || {}).unit, reqQty: +x.qty, qty: +x.qty, leftQty: x.leftQty != null && !isNaN(x.leftQty) ? +x.leftQty : null })), note });
  for (const x of list) if (x.leftQty != null && !isNaN(x.leftQty)) countTo(x.itemId, +x.leftQty, 'count', t('Stock count by cook'), `mv-cnt-${pr.id}-${x.itemId}`);
  if (!isAdmin()) notify({ to: 'admin', title: t('Purchase request'), body: `${pr.no} · ${pr.items.length} ${t('items')}`, link: 'kitchen' });
  return pr;
}
function receivePR(prId, rows, { vendor = '', mode = 'cash', date = today() } = {}) {
  const pr = Store.get(prId); if (!pr) throw new Error('Not found');
  if (pr.status === 'received') return pr;     // pressed twice, or sent again after a bad connection: it is already in the books
  // a negative quantity or price used to be accepted: stock went below zero and the expense disappeared
  for (const x of pr.items) {
    const r = rows[x.itemId] || {};
    const q = r.qty === undefined || r.qty === '' ? 0 : +r.qty, p = r.rate === undefined || r.rate === '' ? 0 : +r.rate;
    if (!isFinite(q) || !isFinite(p) || q < 0 || p < 0) throw new Error(t('Received quantity and rate cannot be negative'));
    if (q > 100000 || p > 1000000) throw new Error(t('Check the received quantity and rate - the number is too large'));
  }
  if (!pr.items.some(x => +((rows[x.itemId] || {}).qty) > 0)) throw new Error(t('Enter the quantity received for at least one item'));
  pr.items = pr.items.map(x => { const r = rows[x.itemId] || {}; return { ...x, recvQty: +r.qty || 0, rate: +r.rate || 0 }; });
  for (const x of pr.items) if (x.recvQty > 0) { postMove(x.itemId, toM(x.recvQty), 'receive', { id: `mv-rcv-${pr.id}-${x.itemId}`, date, ref: pr.id }); Store.patch(x.itemId, { rate: x.rate || (itemById(x.itemId) || {}).rate }); }
  pr.status = 'received'; pr.receivedOn = date; pr.vendor = vendor; pr.mode = mode; pr.total = prTotal(pr); pr.receivedBy = Store.me && Store.me.full_name;
  if (pr.total > 0) { const e = Store.put('exp', { id: `exp-${pr.id}`, date, cat: 'Groceries', amount: pr.total, mode, paid: mode === 'cash', vendor, note: pr.no, ref: pr.id }); pr.expId = e.id; }
  Store.put('pr', pr);
  return pr;
}

/* ===================================================================== housekeeping */
const hkStaff = () => staffList().filter(s => s.dept === 'Housekeeping' || s.role === 'housekeeping');
const hkTasks = () => Store.all('hkt');
const schedOn = (s, date) => s.active !== false && (!s.from || s.from <= date) && (!s.to || s.to >= date) && (s.freq === 'daily' || (s.freq === 'weekly' && (s.days || []).includes(parse(date).getDay())) || (s.freq === 'once' && s.date === date));
// Make today's & tomorrow's tasks from schedules. Never touches finished tasks.
function genHkTasks(from = today(), days = 2) {
  let n = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    for (const s of Store.all('hks')) {
      if (!schedOn(s, date)) continue;
      for (const roomId of s.rooms || []) {
        const room = roomById(roomId); if (!room) continue;
        if (!roomOccupied(room)) continue;    // nobody lives there: nothing to clean, nothing to miss
        const id = `hkt-${date}-${roomId}-${s.id}`, cur = Store.get(id);
        const staffId = (s.assign || {})[roomId] || s.staffId || null, st = staffById(staffId);
        if (cur) {
          if (cur.status === 'pending' && cur.staffId !== staffId) { Store.patch(id, { staffId, staffName: st ? st.name : '' }); if (staffId) notify({ to: 'staff', staffId, title: t('Room assigned'), body: `${room.no} · ${fmtShort(date)}` }); }
          continue;
        }
        Store.put('hkt', { id, date, roomId, roomNo: room.no, floor: room.floor, schedId: s.id, schedName: s.name, time: s.time || '', staffId, staffName: st ? st.name : '', status: 'pending' });
        n++;
      }
    }
  }
  if (n) { for (const s of hkStaff()) { const c = hkTasks().filter(x => x.date === from && x.staffId === s.id && x.status === 'pending').length; if (c) notify({ id: `ntf-hk-${s.id}-${from}`, to: 'staff', staffId: s.id, title: t('Today\'s cleaning'), body: t('{n} rooms assigned', { n: c }) }); } }
  return n;
}
const roomOccupied = room => !!room && bedsOf(room).some(b => b.status === 'occ');
function markMissed() {
  const cut = S().hk.missedAfter, now = nowMinutes(); let n = 0;
  // A room with nobody in it has no cleaning to miss: drop its unfinished tasks (and the "missed" alerts already raised for it).
  for (const x of hkTasks()) if ((x.status === 'pending' || x.status === 'missed' || x.status === 'not_cleaned') && !x.ack && !roomOccupied(roomById(x.roomId))) Store.remove(x.id);
  for (const x of hkTasks()) if (x.status === 'pending' && (x.date < today() || (x.date === today() && now > minutes(cut)))) {
    Store.patch(x.id, { status: 'missed' }); n++;
  }
  if (n) notify({ id: `ntf-hkmiss-${today()}`, to: 'admin', title: t('Cleaning missed'), body: t('{n} rooms were not cleaned on time', { n }), link: 'housekeeping' });
  return n;
}
function canMarkHk(x) {
  if (!x) return false;
  const by = S().hk.markBy || ['staff', 'admin'], c = ctx();
  if (c.role === 'super') return true;
  if (isAdmin()) return by.includes('admin');
  if (c.role === 'resident') { const r = resById(c.refId); return by.includes('resident') && !!r && r.roomId === x.roomId; }
  if (c.role === 'guard') return by.includes('guard');
  return by.includes('staff') && x.staffId === c.refId;
}
function setHkStatus(taskId, status, { reason = '' } = {}) {
  const x = Store.get(taskId); if (!x) throw new Error('Task not found');
  if (!canMarkHk(x)) throw new Error('You are not allowed to update this cleaning task');
  Store.patch(taskId, { status, reason, doneAt: nowIso(), doneBy: Store.me && Store.me.full_name });
  if (status === 'done') for (const r of activeRes().filter(r => r.roomId === x.roomId)) notify({ to: 'res', resId: r.id, title: t('Your room was cleaned'), body: t('Please confirm if you are satisfied'), link: 'r-clean' });
  if (status === 'not_cleaned') notify({ to: 'admin', title: t('Room not cleaned'), body: `${x.roomNo}: ${reason}`, link: 'housekeeping' });
}
function hkFeedback(taskId, resId, ok, note = '') {
  const x = Store.get(taskId); if (!x) throw new Error('Task not found');
  Store.put('hkf', { id: `hkf-${taskId}-${resId}`, taskId, resId, roomId: x.roomId, date: x.date, ok, note, ts: nowIso() });
  if (!ok) { Store.put('cmp', { resId, roomId: x.roomId, cat: 'Cleaning', text: note || t('Room cleaning not satisfactory'), status: 'open', date: today(), ts: nowIso(), src: 'resident', taskId }); notify({ to: 'admin', title: t('Cleaning complaint'), body: `${x.roomNo}: ${note}`, link: 'complaints' }); }
}
const hkFeedbackFor = taskId => Store.all('hkf').filter(f => f.taskId === taskId);

/* ===================================================================== staff self punch-in
 * A staff member with a login marks today present from their own phone. If the owner set the
 * hostel's location, the phone must be within the radius — checked here with the phone's GPS,
 * and the distance is kept on the record so the owner can see it. The owner's manual grid is
 * the same att-{staff}-{month} row, so salary maths does not change at all.
 */
const STAFF_LOGIN_ROLES = ['cook', 'housekeeping', 'laundry', 'guard', 'staff', 'accountant', 'warden'];
const selfPunchOn = () => ['self', 'both'].includes(S().staffAtt.mode);
const myStaffId = () => (STAFF_LOGIN_ROLES.includes(ctx().role) && ctx().refId && staffById(ctx().refId) ? ctx().refId : null);
function punchedToday(staffId) {
  const a = Store.get(`att-${staffId}-${ymOf(today())}`);
  return !!(a && a.days && a.days[+today().slice(8)]);
}
const attFence = () => { const c = S().staffAtt; return c.lat !== '' && c.lat != null && c.lng !== '' && c.lng != null && isFinite(c.lat) && isFinite(c.lng) ? { lat: +c.lat, lng: +c.lng, radius: +c.radius || 150 } : null; };
function punchIn(staffId, pos) {
  if (!selfPunchOn()) throw new Error('Self attendance is switched off. Ask the owner to mark it.');
  const fence = attFence();
  let dist = null;
  if (fence) {
    if (!pos) throw new Error('Turn on location to mark attendance.');
    dist = Math.round(Geo.dist(pos, fence));
    if (dist > fence.radius) throw new Error(t('You are {d} m from the hostel. Attendance can be marked only within {r} m.', { d: dist, r: fence.radius }));
  }
  const ym = ymOf(today()), d = +today().slice(8), id = `att-${staffId}-${ym}`;
  const cur = Store.get(id) || { id, staffId, ym, days: {} };
  const punch = { at: nowIso(), dist, lat: pos ? Math.round(pos.lat * 1e4) / 1e4 : null, lng: pos ? Math.round(pos.lng * 1e4) / 1e4 : null };
  return Store.put('att', { ...cur, days: { ...cur.days, [d]: 'P' }, punch: { ...(cur.punch || {}), [d]: punch } });
}

/* ===================================================================== staff */
function payrollFor(s, ym) {
  const att = Store.get(`att-${s.id}-${ym}`), days = att ? att.days || {} : {};
  const dim = daysIn(ym), lastDay = ym === ymOf(today()) ? +today().slice(8) : dim;
  const A = Object.values(days).filter(v => v === 'A').length, H = Object.values(days).filter(v => v === 'H').length, P = Object.values(days).filter(v => v === 'P').length;
  const payable = Math.round(((+s.salary || 0) * (dim - A - H * 0.5)) / dim);
  const paid = sum(Store.all('sal').filter(x => x.staffId === s.id && x.ym === ym && !x.isAdv && x.type !== 'advance'), x => (+x.amount || 0) + (+x.advDeducted || 0));
  return { P, A, H, unmarked: Math.max(0, lastDay - P - A - H), payable, paid, due: Math.max(0, payable - paid) };
}

function staffSalarySummary(s, currentYM = ymOf(today())) {
  if (!s) return { baseSalary: 0, totalPaid: 0, totalSalaryPaid: 0, totalAdvanceGiven: 0, totalAdvanceDeducted: 0, activeAdvance: 0, currentMonthPayable: 0, currentMonthPaid: 0, currentMonthDue: 0, netPayable: 0, attendance: { P: 0, A: 0, H: 0, due: 0 }, history: [] };
  const allTx = Store.all('sal').filter(x => x.staffId === s.id).sort(by('date', -1));
  const salaryTxs = allTx.filter(x => !x.isAdv && x.type !== 'advance');
  const totalSalaryPaid = round2(sum(salaryTxs, x => +x.amount || 0));
  const advanceTxs = allTx.filter(x => x.isAdv || x.type === 'advance');
  const totalAdvanceGiven = round2(sum(advanceTxs, x => +x.amount || 0));
  const totalAdvanceDeducted = round2(sum(salaryTxs, x => +x.advDeducted || 0));
  const activeAdvance = Math.max(0, round2(totalAdvanceGiven - totalAdvanceDeducted));
  const totalPaid = round2(totalSalaryPaid + totalAdvanceGiven);
  const p = payrollFor(s, currentYM);
  const currentMonthPayable = p.payable;
  const currentMonthPaid = p.paid;
  const currentMonthDue = p.due;
  const netPayable = Math.max(0, round2(currentMonthDue - activeAdvance));
  return {
    baseSalary: +s.salary || 0,
    totalPaid,
    totalSalaryPaid,
    totalAdvanceGiven,
    totalAdvanceDeducted,
    activeAdvance,
    currentMonthPayable,
    currentMonthPaid,
    currentMonthDue,
    netPayable,
    attendance: p,
    history: allTx
  };
}

/* ===================================================================== automation */
const RULES = [
  { k: 'rent', l: 'Monthly rent bills', d: 'Creates every resident\'s rent bill on the rent day. Credit is adjusted automatically.' },
  { k: 'meter', l: 'Meter reading reminder', d: 'Reminds you on the reading day which rooms still need a meter reading.' },
  { k: 'hk', l: 'Cleaning tasks', d: 'Creates today\'s and tomorrow\'s cleaning tasks from schedules and tells each staff member.' },
  { k: 'missed', l: 'Missed cleaning alert', d: 'Marks tasks missed after the cut-off time and alerts you.' },
  { k: 'stock', kitchen: true, l: 'Daily stock usage', d: 'Deducts yesterday\'s estimated kitchen usage from stock using the menu and real headcount.' },
  { k: 'lowstock', kitchen: true, l: 'Low stock alert', d: 'Tells the cook and you when an item will run out within 2 days.' },
  { k: 'checkout', l: 'Checkout reminder', d: 'Reminds you a day before a resident\'s planned checkout.' },
];
// Bills, late fees and reminders are the hostel's business, never one block's: a wing filter
// in the header must not decide who gets charged this month.
// Rules a hostel can actually use: the kitchen ones only exist where the kitchen module is on.
const visibleRules = () => RULES.filter(r => !r.kitchen || orgEnabled('kitchen'));
function runAutomation(force) { return withAllBlocks(() => runAutomationAll(force)); }
function runAutomationAll(force) {
  if (!Store.ctx || !Store.ctx.hostelId) return 0;
  const key = `hostelos.auto.${Store.ctx.hostelId}.${today()}.${ctx().role}`;
  if (!force && LS.get(key)) return 0;
  const A = S().auto, d0 = today(), ym = ymOf(d0); let acts = 0;
  const admin = isAdmin();
  if (admin && A.rent) {
    for (const r of activeRes()) {
      if (!(r.rent > 0)) continue;
      for (const b of rentBillsToRaise(r, d0)) {
        addInvoice({ id: b.id, resId: r.id, roomId: r.roomId, type: 'rent', period: b.period, title: b.title, amount: b.amount, date: b.date, due: b.due, policySnapshot: { model: b.model, rate: r.rent, cycle: rentCycleMode() } });
        acts++;
      }
    }
    if (acts) alog('rent', t('{n} rent bills created', { n: acts }));
  }
  // The late fee follows the hostel's own policy (Settings > Deposits & late fee): switched on there, it is added
  // to the bill by itself and shows in the resident's bill breakdown. It is not an automation rule any more.
  if (admin && S().rent.lateOn && (S().lateFee || {}).on !== false) {
    let n = 0;
    for (const i of invoices()) if (i.type === 'rent' && invBal(i) > 0 && i.due < d0 && !Store.get(`inv-late-${i.id}`)) {
      const r = resById(i.resId); if (!r || r.status === 'left') continue;
      const late = calcLateFee({ invoice: i, todayDate: d0, lateSettings: S().lateFee });
      if (late.amount > 0) {
        addInvoice({
          id: `inv-late-${i.id}`,
          resId: i.resId,
          roomId: i.roomId,
          type: 'late',
          period: i.period,
          title: `${t('Late fee')} · ${i.title}`,
          amount: late.amount,
          date: d0,
          due: addDays(d0, 3),
          sourceInvId: i.id
        });
        n++;
      }
    }
    if (n) { alog('late', t('{n} late fees added', { n })); acts += n; }
  }
  if (admin && A.meter && +d0.slice(8) >= S().elec.readingDay) {
    const pending = rooms().filter(r => bedsOf(r).some(b => b.status === 'occ') && !meters().some(m => m.roomId === r.id && ymOf(m.date) === ym));
    if (pending.length) notify({ id: `ntf-meter-${ym}`, to: 'admin', title: t('Meter readings pending'), body: t('{n} rooms', { n: pending.length }), link: 'electricity' });
  }
  if ((admin || ctx().role === 'housekeeping') && A.hk) { const n = genHkTasks(); if (n) { alog('hk', t('{n} cleaning tasks created', { n })); acts += n; } }
  if (admin && A.missed) acts += markMissed();
  if ((admin || ctx().role === 'cook') && A.stock && orgEnabled('kitchen')) {
    catchUpConsumption(d0);
  }
  if ((admin || ctx().role === 'cook') && A.lowstock && orgEnabled('kitchen')) {
    const low = items().filter(it => stockInfo(it).low);
    if (low.length) { notify({ id: `ntf-low-${d0}`, to: 'role:cook', title: t('Low stock'), body: low.slice(0, 6).map(i => i.name).join(', '), link: 'kitchen' }); if (admin) notify({ id: `ntf-lowa-${d0}`, to: 'admin', title: t('Low stock'), body: low.slice(0, 6).map(i => i.name).join(', '), link: 'kitchen' }); }
  }
  // The one thing the gateway sends on its own: this month's bill, once per resident.
  if (admin && can('payments') && WaGw.on()) {
    const due = monthlyBillsDue();
    if (due.length) {
      WaGw.send(monthlyBillMsgs(due)).then(res => {
        const sent = due.filter((x, i) => res[i] && res[i].ok); markReminded(sent);
        if (sent.length) alog('mbill', t('{n} monthly bills sent on WhatsApp', { n: sent.length }));
        if (sent.length < due.length) notify({ id: `ntf-mbillfail-${ym}`, to: 'admin', title: t('Some monthly bills were not sent'), body: t('{n} could not be sent — open Approvals to send them yourself', { n: due.length - sent.length }), link: 'inbox' });
      }).catch(() => { });
    }
  }
  if (admin && A.checkout) for (const r of activeRes()) if (r.planOut === addDays(d0, 1)) notify({ id: `ntf-out-${r.id}`, to: 'admin', title: t('Checkout tomorrow'), body: r.name, link: 'residents' });
  LS.set(key, 1);
  return acts;
}
/* Automatic payment reminders. Stages are days after the oldest unpaid bill's due date
 * (default 1, 5 and 10). Each stage is sent once per bill — the log row id is deterministic,
 * so any device, any number of runs, never repeats one. With the gateway they go out by
 * themselves; without it the owner gets one "N reminders ready" item and sends them in one
 * pass through the WhatsApp queue. */
function remindersDue() {
  const r = S().wa.remind; if (!r || r.on === false) return [];
  const stages = (r.days || [1, 5, 10]).map(Number).filter(n => n >= 0).sort((a, b) => a - b), d0 = today(), out = [];
  for (const x of dueList(true)) {
    const old = openInv(x.r.id).filter(i => i.due && i.due < d0).sort(by('due'))[0]; if (!old) continue;
    const late = diffDays(d0, old.due), st = stages.filter(s => late >= s).pop(); if (st == null) continue;
    const logId = `log-rem-${old.id}-${st}`; if (Store.get(logId) || bmailDone('reminder', x.r.id)) continue;
    out.push({ r: x.r, due: x.due, logId, stage: st });
  }
  return out;
}
/* The monthly bill: rent + electricity for this month in ONE message per resident, once.
 * Ready when the rent bill exists and the room's meter has been read this month (or the
 * fallback day has come, or electricity is not used here). The log row id is deterministic, so
 * any device, any number of runs, never sends a second one. Other bills (laundry, late fee) and
 * old dues are deliberately left out — they are not part of "this month's bill". */
function monthlyBillsDue() {
  const m = S().wa.monthly || {}; if (m.on === false) return [];
  const d0 = today(), ym = ymOf(d0), fb = +m.fallbackDay || 10, out = [];
  for (const r of activeRes()) {
    if (!phone10(r.phone) || !Store.get(`inv-rent-${r.id}-${ym}`)) continue;
    const logId = `log-mbill-${r.id}-${ym}`; if (Store.get(logId) || bmailDone('bill', r.id)) continue;
    const invs = resInvoices(r.id).filter(i => i.period === ym && (i.type === 'rent' || i.type === 'electricity') && invBal(i) > 0);
    if (!invs.length) continue;
    const read = !orgEnabled('electricity') || meters().some(x => x.roomId === r.roomId && !x.opening && ymOf(x.date) === ym);
    if (!read && +d0.slice(8) < fb) continue;
    out.push({ r, due: sum(invs, invBal), invs, logId, rule: 'mbill' });
  }
  return out;
}
/* Meta only lets a business start a chat with a PRE-APPROVED template, so on the Cloud API the
 * monthly bill goes out as one (wa.monthly.template, created in Meta Business Manager). Body
 * variables, in order: {{1}} first name, {{2}} hostel, {{3}} total due, {{4}} pay link. Template
 * variables cannot hold line breaks, so the bill lines stay in the app and the pay link carries
 * the detail. Without a template name the plain text is sent (works only inside Meta's 24-hour
 * window) and anything that fails is handed back to the owner for one-tap sending. */
function monthlyBillTemplate(r, invs) {
  const m = S().wa.monthly || {}, name = String(m.template || '').trim(); if (!name) return null;
  const b = billMessage(r, 'bill', invs), p = v => ({ type: 'text', text: String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 500) || '-' });
  const hostel = (Store.hostel() || {}).name || '';
  const link = (b.text.match(/https?:\/\/\S+/) || [''])[0];
  return { name, language: { code: m.language || 'en' }, components: [{ type: 'body', parameters: [p(r.name.split(' ')[0]), p(hostel), p(rs(b.total)), p(link)] }] };
}
// Month-by-month bill breakdown for one resident: rent, electricity, late fee, laundry, penalty and the rest.
function billBreakdown(resId, months = 4) {
  const invs = resInvoices(resId).filter(i => i.type !== 'deposit' && i.status !== 'void');
  const yms = [...new Set(invs.map(i => String(i.period && /^\d{4}-\d{2}$/.test(i.period) ? i.period : ymOf(i.date || today()))))].sort().reverse().slice(0, months);
  return yms.map(ym => {
    const rows = invs.filter(i => String(i.period && /^\d{4}-\d{2}$/.test(i.period) ? i.period : ymOf(i.date || today())) === ym);
    const pick = ty => sum(rows.filter(i => i.type === ty), i => i.amount);
    const known = ['rent', 'electricity', 'late', 'laundry', 'penalty'];
    const other = sum(rows.filter(i => !known.includes(i.type)), i => i.amount);
    return { ym, rent: pick('rent'), electricity: pick('electricity'), late: pick('late'), laundry: pick('laundry'), penalty: pick('penalty'), other, total: sum(rows, i => i.amount), paid: sum(rows, i => i.paid || 0), due: sum(rows, i => invBal(i)) };
  });
}
const monthlyBillMsgs = list => list.map(x => { const tp = monthlyBillTemplate(x.r, x.invs); return { phone: x.r.phone, text: billMessage(x.r, 'bill', x.invs).text, template: tp || undefined, label: `${x.r.name} · ${inr(x.due)}`, x }; });
function markReminded(list) { for (const x of list) Store.put('log', { id: x.logId, rule: x.rule || 'remind', msg: `${x.r.name} · ${inr(x.due)}`, resId: x.r.id, date: today(), ts: nowIso() }); }
const reminderMsgs = list => list.map(x => ({ phone: x.r.phone, text: billMessage(x.r, 'reminder').text, label: `${x.r.name} · ${inr(x.due)}`, x }));

// Residents who owe money now — used by "Send reminders" (one tap each on WhatsApp).
function dueList(overdueOnly) { return activeRes().map(r => ({ r, due: resDue(r.id), od: resOverdue(r.id) })).filter(x => (overdueOnly ? x.od : x.due) > 0).sort((a, b) => b.due - a.due); }

/* Salary is never booked by the system - the owner books it. What the system does is REMIND: from the
 * 25th of the month (or any time for last month) a staff member whose salary is not fully paid shows up
 * in Approvals. Booking the salary makes the reminder vanish by itself, because due drops to 0. */
function salaryReminders(d0 = today()) {
  const out = [], ym = ymOf(d0), prev = addMonths(ym + '-01', -1).slice(0, 7), day = +String(d0).slice(8);
  for (const s of staffList()) {
    if (s.status !== 'active' || !(+s.salary > 0)) continue;
    const joined = String(s.joinDate || '0000-00').slice(0, 7);
    for (const m of [prev, ym]) {
      if (m < joined) continue;
      if (m === ym && day < 25) continue;
      const p = payrollFor(s, m);
      if (p.due > 0) out.push({ staffId: s.id, name: s.name, ym: m, due: p.due });
    }
  }
  return out;
}

/* ===================================================================== income, payables and the money ledger
 * Four kinds of money are kept apart and never mixed:
 *   income   ('inc')  money coming in that is not a resident's bill: an old cot sold, newspaper scrap, a leftover belonging, anything else
 *   expenses ('exp')  what the hostel spent (salaries and advances are written there by Staff & Salary)
 *   payables ('cred') what the hostel still owes a vendor, a staff member or anyone else (an unpaid salary of the past, a loan from a shop)
 *   advance           money paid or received ahead of the bill: it is shown as "advance", not as income or expense
 * An income or a payable has a TOTAL and any number of instalments (date, amount, mode, note); pending = total - paid.
 * Only money that really moved counts: income is what was received, not what was promised. */
const INC_CATS = ['Old furniture / asset sale', 'Newspaper / scrap', 'Unclaimed belongings', 'Other income'];
const incomeCats = () => ((S().incomeCats || []).length ? S().incomeCats : INC_CATS);
const CRED_TYPES = [['vendor', 'Vendor / shop'], ['staff', 'Staff'], ['person', 'Person'], ['business', 'Business'], ['other', 'Other']];
const instPaid = r => round2(sum((r && r.payments) || [], x => +x.amount || 0));
function instState(r) {
  const total = +(r && r.total) || 0, paid = instPaid(r), left = round2(total - paid);
  return { total, paid, pending: Math.max(0, left), advance: Math.max(0, -left), status: paid <= 0 ? 'open' : left > 0.005 ? 'part' : left < -0.005 ? 'advance' : 'settled' };
}
const INST_BADGE = { open: ['Pending', 'warn'], part: ['Part paid', 'info'], settled: ['Settled', 'ok'], advance: ['Advance', 'info'] };
// One more instalment on an income or a payable. More than what is pending is refused unless the caller says the extra is an advance.
function addInstallment(kind, id, { amount, date = today(), mode = 'cash', note = '', allowAdvance = false } = {}) {
  const r = Store.get(id); if (!r || r.kind !== kind) throw new Error(t('Record not found'));
  const a = round2(+amount);
  if (!(a > 0) || a > 100000000) throw new Error(t('Enter a valid amount'));
  if (date > today()) throw new Error(t('The date cannot be in the future'));
  const st = instState(r);
  if (a > st.pending + 0.005 && !allowAdvance) throw new Error(st.pending > 0 ? t('Only {a} is pending. Reduce the amount, or tick that the extra is an advance.', { a: inr(st.pending) }) : t('This is already fully paid. Tick that it is an advance to record more.'));
  const pay = { id: uid('ip-'), date, amount: a, mode, note: String(note || '').slice(0, 200), ts: nowIso() };
  Store.put(kind, { ...r, payments: [...(r.payments || []), pay] });
  return pay;
}
function removeInstallment(kind, id, payId) {
  const r = Store.get(id); if (!r || r.kind !== kind) return false;
  Store.put(kind, { ...r, payments: (r.payments || []).filter(x => x.id !== payId) });
  return true;
}
function saveIncome({ id, cat, title, party, total, date, received, mode, note }) {
  const tot = round2(+total);
  if (!cat) throw new Error(t('Choose what kind of income this is'));
  if (!(tot > 0) || tot > 100000000) throw new Error(t('Enter the total amount'));
  if (date > today()) throw new Error(t('The date cannot be in the future'));
  const got = received === '' || received == null ? 0 : round2(+received);
  if (!(got >= 0)) throw new Error(t('Enter a valid amount'));
  const cur = id ? Store.get(id) : null;
  const rec = Store.put('inc', { ...(cur || {}), cat, title: String(title || '').trim(), party: String(party || '').trim(), total: tot, date, note: String(note || '').trim(), payments: cur ? cur.payments || [] : [] });
  if (!cur && got > 0) addInstallment('inc', rec.id, { amount: got, date, mode, note: t('Received'), allowAdvance: true });
  return Store.get(rec.id);
}
function savePayable({ id, party, ptype, title, total, date, due, paid, mode, note, staffId }) {
  const tot = round2(+total);
  if (!String(party || '').trim()) throw new Error(t('Enter who the money is payable to'));
  if (!(tot > 0) || tot > 100000000) throw new Error(t('Enter the total amount'));
  if (date > today()) throw new Error(t('The date cannot be in the future'));
  const got = paid === '' || paid == null ? 0 : round2(+paid);
  if (!(got >= 0)) throw new Error(t('Enter a valid amount'));
  if (got > tot + 0.005) throw new Error(t('Paid so far cannot be more than the total'));
  const cur = id ? Store.get(id) : null;
  const rec = Store.put('cred', { ...(cur || {}), party: String(party).trim(), ptype: ptype || 'other', title: String(title || '').trim(), total: tot, date, due: due || '', note: String(note || '').trim(), ...(staffId ? { staffId } : {}), payments: cur ? cur.payments || [] : [] });
  if (!cur && got > 0) addInstallment('cred', rec.id, { amount: got, date, mode, note: t('Paid so far') });
  return Store.get(rec.id);
}
// Every movement of money between two dates, oldest first, each tagged with what it is, with a running balance.
function finLedger(from, to) {
  const rows = [], inR = d => d >= from && d <= to;
  for (const p of payments()) if (!p.reversed && p.mode !== 'deposit' && inR(p.date)) rows.push({ k: 'resident', sign: 1, date: p.date, ts: p.ts || p.date, amount: +p.amount || 0, title: (resById(p.resId) || {}).name || t('Resident'), sub: t('Resident payment'), mode: p.mode, id: p.id });
  for (const r of Store.all('inc')) for (const x of r.payments || []) if (inR(x.date)) rows.push({ k: 'income', sign: 1, date: x.date, ts: x.ts || x.date, amount: +x.amount || 0, title: r.title || t(r.cat), sub: [t(r.cat), r.party].filter(Boolean).join(' · '), mode: x.mode, id: r.id, note: x.note });
  for (const e of Store.all('exp')) {
    if (e.mode === 'credit' && !e.paid) continue;
    const d = e.mode === 'credit' ? (e.paidOn || e.date) : e.date; if (!inR(d)) continue;
    const s = e.ref ? Store.get(e.ref) : null, k = s && s.kind === 'sal' ? (s.isAdv || s.type === 'advance' ? 'advance' : 'salary') : 'expense';
    rows.push({ k, sign: -1, date: d, ts: e.ts || d, amount: +e.amount || 0, title: e.vendor || t(e.cat), sub: k === 'expense' ? [t(e.cat), e.note].filter(Boolean).join(' · ') : (e.note || t(e.cat)), mode: e.mode, id: e.id });
  }
  for (const c of Store.all('cred')) for (const x of c.payments || []) if (inR(x.date)) rows.push({ k: 'payable', sign: -1, date: x.date, ts: x.ts || x.date, amount: +x.amount || 0, title: c.party, sub: [c.title, x.note].filter(Boolean).join(' · ') || t('Payable'), mode: x.mode, id: c.id });
  rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.ts).localeCompare(String(b.ts)));
  let bal = 0; for (const r of rows) { bal = round2(bal + r.sign * r.amount); r.bal = bal; }
  return rows;
}
function finTotals(rows) {
  const by = k => round2(sum(rows.filter(r => r.k === k), r => r.amount));
  const inn = round2(sum(rows.filter(r => r.sign > 0), r => r.amount)), out = round2(sum(rows.filter(r => r.sign < 0), r => r.amount));
  return { in: inn, out, net: round2(inn - out), resident: by('resident'), income: by('income'), expense: by('expense'), salary: by('salary'), advance: by('advance'), payable: by('payable') };
}
// other income actually received between two dates (the resident payments are counted separately)
const otherIncomeReceived = (from, to) => round2(sum(Store.all('inc'), r => sum((r.payments || []).filter(x => x.date >= from && x.date <= to), x => +x.amount || 0)));
const payableOutstanding = () => round2(sum(Store.all('cred'), r => instState(r).pending));
const incomePending = () => round2(sum(Store.all('inc'), r => instState(r).pending));

/* ===================================================================== business insights
 * Everything the Insights tab shows is worked out here from records already on the device, so it is
 * testable without a screen: monthly trend, cost analysis, a 3-month forecast, a what-if scenario and
 * plain-language commentary. Nothing here writes data. */
const FIXED_COST_SHARE = 0.6;   // rent, salaries, internet... do not move when a bed fills or empties
function insightMonths(n = 6, upto = ymOf(today())) {
  const out = []; for (let i = n - 1; i >= 0; i--) out.push(addMonths(upto + '-01', -i).slice(0, 7)); return out;
}
function bizInsights(n = 6) {
  const cur = ymOf(today()), yms = insightMonths(n, cur);
  const pays = payments().filter(p => p.mode !== 'deposit' && !p.reversed);
  const exps = Store.all('exp');
  const invs = invoices().filter(i => i.type !== 'deposit' && i.status !== 'void');
  const occNow = occupancy(), totalBeds = occNow.total || 0;
  const months = yms.map(ym => {
    const income = sum(pays.filter(p => ymOf(p.date) === ym), p => p.amount) + otherIncomeReceived(`${ym}-01`, `${ym}-31`);
    const expense = sum(exps.filter(x => ymOf(x.date) === ym), x => x.amount);
    const billed = sum(invs.filter(i => ymOf(i.date) === ym), i => i.amount);
    const collected = sum(invs.filter(i => ymOf(i.date) === ym), i => i.paid || 0);
    const end = ym === cur ? today() : `${ym}-${String(daysIn(ym)).padStart(2, '0')}`;
    const occ = totalBeds ? Math.round(100 * residents().filter(r => activeOn(r, end)).length / totalBeds) : 0;
    return { ym, income, expense, profit: income - expense, margin: income > 0 ? Math.round(100 * (income - expense) / income) : 0, billed, collected, occ, partial: ym === cur };
  });
  const full = months.filter(m => !m.partial && (m.income > 0 || m.expense > 0));
  const base = full.slice(-3);
  const avg = f => (base.length ? sum(base, f) / base.length : 0);
  const avgIncome = Math.round(avg(m => m.income)), avgExpense = Math.round(avg(m => m.expense));
  // cost analysis by category: last full month vs the average of the full months before it
  const catOf = ym => groupBy(exps.filter(x => ymOf(x.date) === ym), x => x.cat);
  const lastFull = full.length ? full[full.length - 1].ym : null;
  const prevYms = full.slice(Math.max(0, full.length - 4), full.length - 1).map(m => m.ym);
  const cats = {};
  if (lastFull) {
    const last = catOf(lastFull);
    for (const [c, l] of Object.entries(last)) cats[c] = { cat: c, last: sum(l, x => x.amount), avgPrev: 0 };
    for (const ym of prevYms) for (const [c, l] of Object.entries(catOf(ym))) { cats[c] = cats[c] || { cat: c, last: 0, avgPrev: 0 }; cats[c].avgPrev += sum(l, x => x.amount) / (prevYms.length || 1); }
  }
  const lastTotal = sum(Object.values(cats), c => c.last) || 1;
  const costRows = Object.values(cats).map(c => ({ ...c, share: Math.round(100 * c.last / lastTotal), change: c.avgPrev > 0 ? Math.round(100 * (c.last - c.avgPrev) / c.avgPrev) : null, avgPrev: Math.round(c.avgPrev) })).sort((a, b) => b.last - a.last);
  // forecast: straight-line trend over the full months, never below zero; with <2 months it is just the average
  const trend = (vals, k) => {
    if (vals.length < 2) return vals.length ? vals[0] : 0;
    const m = vals.length, xs = vals.map((_, i) => i), mx = (m - 1) / 2, my = vals.reduce((a, b) => a + b, 0) / m;
    const sl = xs.reduce((a, x, i) => a + (x - mx) * (vals[i] - my), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1);
    return Math.max(0, my + sl * (m - 1 + k - mx));
  };
  // months before the first recorded expense are just "not started tracking" - they would fake a steep climb
  const start = Math.max(0, full.findIndex(m => m.expense > 0 && m.income > 0));
  const fit = full.slice(start);
  const fullI = fit.map(m => m.income), fullE = fit.map(m => m.expense);
  const bound = (v, a) => (a > 0 ? Math.min(a * 1.3, Math.max(a * 0.7, v)) : v);   // a forecast never swings more than 30% from the recent average
  const forecast = [1, 2, 3].map(k => {
    const income = Math.round(bound(trend(fullI, k), avgIncome)), expense = Math.round(bound(trend(fullE, k), avgExpense));
    return { ym: addMonths(cur + '-01', k).slice(0, 7), income, expense, profit: income - expense };
  });
  // per-bed economics + vacancy cost
  const occBeds = occNow.occ || 0, rentPerBed = occBeds ? Math.round(avgIncome / occBeds) : 0;
  const vacancyCost = Math.round(occNow.vac * (sum(activeRes(), r => r.rent || 0) / (activeRes().length || 1)));
  const fixed = avgExpense * FIXED_COST_SHARE, varPerBed = occBeds ? (avgExpense * (1 - FIXED_COST_SHARE)) / occBeds : 0;
  const beBeds = rentPerBed > varPerBed ? Math.ceil(fixed / (rentPerBed - varPerBed)) : null;
  const dues = sum(activeRes(), r => resDue(r.id)), overdue = sum(activeRes(), r => resOverdue(r.id));
  const ins = { months, avgIncome, avgExpense, avgProfit: avgIncome - avgExpense, margin: avgIncome > 0 ? Math.round(100 * (avgIncome - avgExpense) / avgIncome) : 0,
    costRows, forecast, occ: occNow, rentPerBed, vacancyCost, breakEven: { beds: beBeds, pct: beBeds != null && totalBeds ? Math.round(100 * beBeds / totalBeds) : null },
    dues, overdue, fixedShare: FIXED_COST_SHARE, varPerBed, haveData: full.length > 0 };
  ins.notes = insightNotes(ins);
  return ins;
}
// What if occupancy / rent / costs move? occ and rent are +/- percent of today's, cost is +/- percent on top.
function scenarioCalc(ins, { occ = 0, rent = 0, cost = 0 } = {}) {
  const occBeds = ins.occ.occ || 0, total = ins.occ.total || 0;
  const newBeds = Math.max(0, Math.min(total, Math.round(occBeds * (1 + occ / 100))));
  const income = ins.rentPerBed * newBeds * (1 + rent / 100);
  const expense = (ins.avgExpense * ins.fixedShare + ins.varPerBed * newBeds) * (1 + cost / 100);
  return { beds: newBeds, income: Math.round(income), expense: Math.round(expense), profit: Math.round(income - expense), baseProfit: ins.avgProfit };
}
function insightNotes(i) {
  const out = [], K = n => inr(Math.round(n));
  if (!i.haveData) return [{ tone: 'info', text: t('Insights need at least one full month of payments and expenses. They will fill in by themselves as you use the app.') }];
  const m = i.margin;
  out.push({ tone: m < 0 ? 'bad' : m < 10 ? 'warn' : 'ok', text: m < 0 ? t('Costs are higher than income: on average you lose {a} a month. Fix this first.', { a: K(-i.avgProfit) })
    : m < 10 ? t('Profit margin is thin at {m}%: only {a} a month is left after costs. A small cost rise can wipe it out.', { m, a: K(i.avgProfit) })
      : t('Healthy: about {m}% of income ({a} a month) is left after costs.', { m, a: K(i.avgProfit) }) });
  if (i.occ.vac > 0) out.push({ tone: 'warn', text: t('{n} beds are empty - about {a} a month of rent not earned. Filling even half of them adds {h} a month.', { n: i.occ.vac, a: K(i.vacancyCost), h: K(i.vacancyCost / 2) }) });
  else out.push({ tone: 'ok', text: t('Every bed is occupied. Think about a small rent rise at the next renewal - see the scenario below.') });
  if (i.breakEven.pct != null) out.push({ tone: i.occ.pct >= i.breakEven.pct ? 'ok' : 'bad', text: t('Break-even is about {b}% occupancy ({n} beds). You are at {p}%.', { b: i.breakEven.pct, n: i.breakEven.beds, p: i.occ.pct }) });
  const top = i.costRows[0];
  if (top) out.push({ tone: 'info', text: t('Biggest cost: {c} - {s}% of last month\'s spending ({a}).', { c: t(top.cat), s: top.share, a: K(top.last) }) });
  const rise = i.costRows.filter(c => c.change != null && c.change >= 25 && c.last - c.avgPrev > 500).sort((a, b) => (b.last - b.avgPrev) - (a.last - a.avgPrev))[0];
  if (rise) out.push({ tone: 'warn', text: t('{c} jumped {p}% above its usual level ({a} vs {b}). Worth checking the bills.', { c: t(rise.cat), p: rise.change, a: K(rise.last), b: K(rise.avgPrev) }) });
  const f = i.forecast[2];
  if (f) out.push({ tone: f.profit < i.avgProfit * 0.9 ? 'warn' : 'info', text: t('If the recent trend continues, {m} profit will be about {a} (income {i}, costs {c}).', { m: fmtYM(f.ym), a: K(f.profit), i: K(f.income), c: K(f.expense) }) });
  if (i.overdue > 0) out.push({ tone: 'warn', text: t('{a} is overdue from residents. Collecting it is the fastest way to improve cash in hand.', { a: K(i.overdue) }) });
  return out;
}

/* ===================================================================== approvals inbox */
function inboxItems() {
  const out = [];
  if (can('staff') && isAdmin()) for (const x of salaryReminders()) out.push({ k: 'salary', id: x.staffId, attrs: `data-ym="${x.ym}"`, icon: 'wallet', ic: 'warn', t: `${t('Book salary')} · ${x.name}`, d: `${fmtYM(x.ym)} · ${t('due')} ${inr(x.due)}`, ts: `${x.ym}-28T00:00:00` });
  if (can('payments')) for (const c of Store.all('claim').filter(c => c.status === 'pending')) { const r = resById(c.resId); out.push({ k: 'claim', id: c.id, icon: 'rupee', ic: 'ok', t: `${t('UPI payment')} · ${inr(c.amount)}`, d: `${r ? r.name : ''} · UTR ${c.utr || '—'}`, ts: c.ts }); }
  if (can('kitchen')) for (const p of Store.all('pr').filter(p => p.status === 'requested')) out.push({ k: 'pr', id: p.id, icon: 'cart', ic: 'warn', t: `${t('Purchase request')} ${p.no}`, d: `${p.by || ''} · ${p.items.length} ${t('items')}`, ts: p.ts });
  if (can('electricity')) for (const m of meters().filter(m => m.status === 'review')) {
    const isRep = !!m.isReplacement;
    out.push({
      k: 'meter',
      id: m.id,
      icon: 'bolt',
      ic: isRep ? 'teal' : 'warn',
      t: isRep ? `${t('Meter replaced/reset claim')} · ${roomName(m.roomId)}` : `${t('Check meter reading')} · ${roomName(m.roomId)}`,
      d: `${m.submittedBy ? t('By {n}', { n: m.submittedBy }) + ' · ' : ''}${isRep ? t('New meter reading {u}', { u: num(m.curr) }) + (m.replaceReason ? ' (' + m.replaceReason + ')' : '') : m.units + ' ' + t('units')}`,
      ts: m._u
    });
  }
  if (can('payments')) for (const d of Store.all('dep').filter(d => d.status === 'pending')) { const r = resById(d.resId); out.push({ k: 'dep', id: d.id, icon: 'wallet', ic: 'info', t: `${t('Deposit refund')} · ${inr(d.refund)}`, d: r ? r.name : '', ts: d._u }); }
  if (can('complaints')) for (const c of Store.all('cmp').filter(c => c.status === 'open')) { const r = resById(c.resId); out.push({ k: 'cmp', id: c.id, icon: 'wrench', ic: 'bad', t: `${t(c.cat)} · ${roomName(c.roomId)}`, d: `${r ? r.name + ': ' : ''}${c.text}`, ts: c.ts }); }
  if (can('housekeeping') && isAdmin()) for (const x of hkTasks().filter(x => (x.status === 'missed' || x.status === 'not_cleaned') && !x.ack && roomOccupied(roomById(x.roomId)))) out.push({ k: 'hk', id: x.id, icon: 'broom', ic: 'warn', t: `${t(x.status === 'missed' ? 'Cleaning missed' : 'Room not cleaned')} · ${x.roomNo}`, d: `${fmtShort(x.date)} · ${x.staffName || t('Unassigned')}${x.reason ? ' · ' + x.reason : ''}`, ts: x._u });
  if (can('payments')) { const due = monthlyBillsDue(); if (due.length) out.push({ k: 'mbill', id: 'mbill', icon: 'wa', ic: 'info', t: t('{n} monthly bills ready', { n: due.length }), d: t('Rent + electricity, once a month') + ' · ' + due.slice(0, 2).map(x => x.r.name).join(', ') + (due.length > 2 ? '…' : ''), ts: nowIso() }); }
  if (can('payments')) { const due = remindersDue(); if (due.length) out.push({ k: 'remind', id: 'remind', icon: 'wa', ic: 'ok', t: t('{n} payment reminders ready', { n: due.length }), d: due.slice(0, 3).map(x => x.r.name).join(', ') + (due.length > 3 ? '…' : ''), ts: nowIso() }); }
  if (can('residents') && isAdmin()) for (const a of pendingSignups()) out.push({ k: 'signup', id: a.id, icon: 'userplus', ic: 'ok', t: `${t('New resident application')} · ${a.name}`, d: [a.phone, a.college, (a.docs || []).length ? t('{n} documents', { n: a.docs.length }) : ''].filter(Boolean).join(' · '), ts: a.ts });
  if (can('complaints')) for (const x of rinfoUnread()) { const r = resById(x.resId); out.push({ k: 'rinfo', id: x.id, icon: rinfoIcon(x.type), ic: 'info', t: `${rinfoLabel(x.type)} - ${r ? r.name : ''}`, d: [x.text, x.from ? `${fmtShort(x.from)}${x.to && x.to !== x.from ? ' - ' + fmtShort(x.to) : ''}` : ''].filter(Boolean).join(' - '), ts: x.ts }); }
  // Police verification is the landlord's legal duty, so an overdue one belongs in the same
  // place as everything else waiting on the owner.
  if (can('residents') && isAdmin()) for (const r of pvPending()) out.push({ k: 'pv', id: r.id, icon: 'shield', ic: 'bad', t: `${t('Police verification pending')} · ${r.name}`, d: t('Checked in {d} · {n} days ago', { d: fmtShort(r.checkIn), n: diffDays(today(), r.checkIn) }), ts: r.checkIn });
  return out.sort(by('ts', -1));
}

/* ===================================================================== demo data */
// `opts.big` picks the fuller data set (3 floors, 25 residents, all staff); the offline demo uses it for h1 only.
// Every number made up here starts with 5, which no Indian mobile does, so nothing seeded can ever
// reach a real person on WhatsApp or by call. (The one exception is the offline demo's own login.)
function seedDemo(hostelId, opts = {}) {
  const R = (s => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; })(hostelId.length * 7919 + hostelId.charCodeAt(hostelId.length - 1));
  const pick = a => a[Math.floor(R() * a.length)];
  const isAravali = hostelId === 'h_aravali';
  const big = isAravali ? true : (opts.big != null ? !!opts.big : hostelId === 'h1'), offlineDemo = hostelId === 'h1' || isAravali;
  const fakePhone = () => '5' + String(Math.floor(1e8 + R() * 9e8));
  SEEDING = true;
  const h = Store.hostel();
  if (h && !Object.keys(h.settings || {}).length) {
    if (isAravali) {
      Store.saveSettings({
        rent: { model: 'calendar_monthly', day: 5, dueDays: 5, graceDays: 5, lateFee: 200, lateOn: true, prorate: true, prorateDivisor: 'actual_days', includeElec: true, includeMess: true, includeCharges: true },
        pay: { upiId: 'aravali@upi', payee: 'Aravali Student Residency', phone: '9876543210' },
        elec: { rate: 10, freeUnits: 0, freeMode: 'resident' }
      });
    } else {
      Store.saveSettings({ pay: { upiId: 'sunrisepg@okicici', payee: h.name, phone: '9876500001' } });
    }
  }
  // rooms
  const fl = isAravali ? 2 : (big ? 3 : 2), per = isAravali ? 3 : (big ? 4 : 3), roomIds = [];
  for (let f = 1; f <= fl; f++) for (let n = 1; n <= per; n++) {
    const no = `${f}0${n}`, cap = isAravali ? 2 : (n % 3 === 0 ? 3 : 2), rent = isAravali ? 8000 : (cap === 3 ? 6500 : 8000);
    const beds = 'ABC'.slice(0, cap).split('').map(id => ({ id, status: isAravali && no === '203' && id === 'A' ? 'mnt' : 'vac' }));
    const r = Store.put('room', { id: `room-${no}`, no, floor: `${t('Floor')} ${f}`, rent, sharing: cap, ac: n === 1, beds });
    roomIds.push(r.id);
  }
  // staff (ids match the demo logins)
  const staff = [['st-cook', 'Raju Cook', 'Kitchen', 'cook', 14000], ['st-hk1', 'Sunita Devi', 'Housekeeping', 'housekeeping', 10000], ['st-hk2', 'Kamla Bai', 'Housekeeping', 'housekeeping', 9500], ['st-ld', 'Mohan Lal', 'Laundry', 'laundry', 9000], ['st-gd', 'Bahadur Singh', 'Security', 'guard', 11000]];
  for (const [id, name, dept, role, salary] of big ? staff : staff.slice(0, 3)) Store.put('staff', { id, name, phone: fakePhone(), dept, role, salary, joinDate: addDays(today(), -400), status: 'active', docs: [] });
  // items & dishes & menu
  const IT = [['Rice', 'kg', 25, 52], ['Atta', 'kg', 30, 38], ['Toor dal', 'kg', 8, 140], ['Moong dal', 'kg', 5, 120], ['Potato', 'kg', 15, 30], ['Onion', 'kg', 12, 35], ['Tomato', 'kg', 8, 40], ['Paneer', 'kg', 2, 340], ['Milk', 'L', 10, 56], ['Oil', 'L', 10, 150], ['Poha', 'kg', 4, 60], ['Sugar', 'kg', 6, 44], ['Tea leaves', 'kg', 1, 420], ['Bread', 'pkt', 6, 40], ['Eggs', 'pcs', 60, 7]];
  const iid = {};
  for (const [name, unit, min, rate] of IT) iid[name] = Store.put('item', { id: `item-${slug(name)}`, name, unit, min: Math.round(min / 3), stock: min, rate, cat: 'Grocery' }).id;
  const D = (name, meal, serves, ings) => Store.put('dish', { id: `dish-${slug(name)}`, name, meal, serves, ings: ings.map(([n, q]) => ({ itemId: iid[n], qty: q })) }).id;
  const dish = {
    poha: D('Poha', 'breakfast', 10, [['Poha', 0.8], ['Onion', 0.3], ['Oil', 0.1]]), aloo: D('Aloo paratha', 'breakfast', 10, [['Atta', 1], ['Potato', 1], ['Oil', 0.2]]),
    bread: D('Bread omelette', 'breakfast', 10, [['Bread', 2.5], ['Eggs', 20], ['Oil', 0.1]]), tea: D('Tea', 'breakfast', 10, [['Milk', 1.2], ['Sugar', 0.15], ['Tea leaves', 0.05]]),
    dal: D('Dal tadka', 'any', 10, [['Toor dal', 0.8], ['Tomato', 0.3], ['Oil', 0.1]]), rice: D('Steamed rice', 'any', 10, [['Rice', 1.2]]),
    roti: D('Roti', 'any', 10, [['Atta', 1.3], ['Oil', 0.05]]), sabzi: D('Aloo sabzi', 'any', 10, [['Potato', 1.5], ['Onion', 0.3], ['Tomato', 0.3], ['Oil', 0.12]]),
    paneer: D('Paneer masala', 'dinner', 10, [['Paneer', 1], ['Onion', 0.4], ['Tomato', 0.5], ['Oil', 0.15]]), moong: D('Moong dal', 'any', 10, [['Moong dal', 0.7], ['Oil', 0.08]]),
  };
  const week = {};
  for (let d = 0; d < 7; d++) week[d] = { breakfast: [[dish.poha, dish.aloo, dish.bread][d % 3], dish.tea], lunch: [dish.dal, dish.rice, dish.roti, dish.sabzi], dinner: d % 3 === 0 ? [dish.paneer, dish.roti, dish.rice] : [dish.moong, dish.roti, dish.sabzi] };
  Store.put('menu', { id: 'menu', week });
  // residents
  const first = ['Aman', 'Rohit', 'Vikas', 'Saurabh', 'Ankit', 'Deepak', 'Rahul', 'Nikhil', 'Pankaj', 'Arjun', 'Harsh', 'Manish', 'Yash', 'Kunal', 'Gaurav', 'Akash', 'Varun', 'Tushar', 'Shivam', 'Mohit', 'Abhishek', 'Ritesh'];
  const firstG = ['Priya', 'Neha', 'Pooja', 'Riya', 'Sneha', 'Kavya', 'Ananya', 'Isha', 'Shruti', 'Nidhi', 'Tanya', 'Megha', 'Divya', 'Simran'];
  const last = ['Gupta', 'Sharma', 'Verma', 'Yadav', 'Jain', 'Singh', 'Mishra', 'Patel', 'Agarwal', 'Chauhan'];
  const names = hostelId === 'h2' ? firstG : first;
  let k = 0;
  for (const rid of roomIds) {
    const room = roomById(rid);
    for (const b of room.beds) {
      if ((isAravali || R() < (big ? 0.12 : 0.2)) && k > 0) continue;
      const months = 1 + Math.floor(R() * 7), ci = addDays(today(), -months * 30 - Math.floor(R() * 20));
      const isAryan = k === 0 && isAravali;
      const name = isAryan ? 'Aryan Sharma' : (k === 0 && big ? 'Aman Gupta' : `${names[k % names.length]} ${pick(last)}`);
      const phone = isAryan ? '9811100001' : (k === 0 && big && offlineDemo ? '9812300001' : fakePhone());
      const r = checkIn({ id: isAryan ? 'res-aravali-1' : `res-${k + 1}`, name, phone, guardianPhone: fakePhone(), roomId: rid, bed: b.id, rent: room.rent, deposit: room.rent, checkIn: ci, college: isAravali ? 'Jaipur Engineering College' : pick(['Allen Kota', 'Resonance', 'Motion IIT', 'Vibrant Academy', 'Office']) });
      if (isAryan) Store.patch(r.id, { username: 'aryan.sharma' });
      else if (k === 0 && big && offlineDemo) Store.patch(r.id, { username: 'aman.gupta' });
      // deposit + first month paid
      recordPayment({ resId: r.id, amount: resDue(r.id), mode: pick(['cash', 'upi', 'upi']), ref: '', date: ci });
      // later months
      for (let ym = addMonths(ymOf(ci), 1); ym <= ymOf(today()); ym = addMonths(ym, 1)) {
        if (ym === ymOf(today()) && today() < rentDue(ym)) break;
        addInvoice({ id: `inv-rent-${r.id}-${ym}`, resId: r.id, roomId: rid, type: 'rent', period: ym, title: `${t('Rent')} ${fmtYM(ym)}`, amount: r.rent, date: rentDue(ym), due: addDays(rentDue(ym), 5) });
        const cur = ym === ymOf(today());
        if (R() < (cur ? 0.62 : 0.97)) recordPayment({ resId: r.id, amount: resDue(r.id), mode: pick(['upi', 'upi', 'cash', 'bank']), ref: R() < 0.6 ? String(Math.floor(1e11 + R() * 9e11)) : '', date: addDays(rentDue(ym), Math.floor(R() * 6)) });
      }
      k++;
    }
  }
  // last month's meter readings (billed & paid) + this month for half the rooms
  for (const rid of (isAravali ? [] : roomIds)) {
    const base = 1000 + Math.floor(R() * 4000), lm = addDays(today(), -32);
    const roomRes = Store.all('res').filter(r => r.roomId === rid && r.status === 'active');
    const occShares = roomRes.length ? splitElectricity(rid, 140, 9, roomRes.map(r => r.id)) : [];
    Store.put('meter', { roomId: rid, date: addDays(lm, -30), prev: base - 140, curr: base, units: 140, rate: 9, shares: occShares, total: sum(occShares, s => s.amount), period: ymOf(addDays(lm, -30)), status: 'billed' });
    if (R() < 0.5) addReading({ roomId: rid, curr: base + 80 + Math.floor(R() * 120), date: addDays(today(), -2) });
  }
  // purchase history so the learning has two cycles to work with
  // received quantities ≈ real usage × a 10–20% kitchen buffer, so the learned factor looks realistic
  const prItems = ['Rice', 'Atta', 'Toor dal', 'Potato', 'Onion', 'Oil', 'Milk'].map(n => iid[n]);
  const use = expectedUse(addDays(today(), -15), addDays(today(), -1)), left2 = {};
  prItems.forEach(id => { left2[id] = Math.round((1 + R() * 3) * 10) / 10; });
  const pr1 = Store.put('pr', { no: 'PR-1', date: addDays(today(), -16), ts: nowIso(), by: 'Raju Cook', status: 'received', receivedOn: addDays(today(), -15), mode: 'cash', vendor: 'Gupta Kirana', items: prItems.map(id => { const q = Math.ceil((use[id] || 5) * (1.1 + R() * 0.1) + left2[id] - 2); return { itemId: id, name: itemById(id).name, unit: itemById(id).unit, reqQty: q, qty: q, recvQty: q, leftQty: 2, rate: itemById(id).rate }; }) });
  Store.put('exp', { id: `exp-${pr1.id}`, date: pr1.receivedOn, cat: 'Groceries', amount: prTotal(pr1), mode: 'cash', paid: true, vendor: 'Gupta Kirana', note: 'PR-1', ref: pr1.id });
  Store.put('pr', { no: 'PR-2', date: addDays(today(), -1), ts: nowIso(), by: 'Raju Cook', status: 'requested', items: prItems.slice(0, 4).map(id => ({ itemId: id, name: itemById(id).name, unit: itemById(id).unit, reqQty: 25, qty: 25, leftQty: left2[id] })), note: t('Running low') });
  // the cook counted stock yesterday, so earlier days are already accounted for
  prItems.forEach(id => { Store.patch(id, { stock: left2[id] + 4 }); for (let i = 2; i <= 4; i++) Store.put('mv', { id: `mv-use-${id}-${addDays(today(), -i)}`, itemId: id, qty: 0, type: 'use', date: addDays(today(), -i), ref: 'seed' }); });
  // expenses
  const cats = S().expenseCats;
  for (let m = 0; m < 4; m++) for (const [cat, amt] of [['Electricity bill', 14000], ['Gas', 4200], ['Internet', 1800], ['Vegetables & milk', 9000], ['Salary', 50000], ['Maintenance', 2500]]) {
    const date = addDays(today(), -m * 30 - Math.floor(R() * 8));
    if (date > today() || !cats.includes(cat)) continue;
    Store.put('exp', { date, cat, amount: Math.round(amt * (0.85 + R() * 0.3)), mode: cat === 'Vegetables & milk' && m === 0 ? 'credit' : 'cash', paid: !(cat === 'Vegetables & milk' && m === 0), vendor: cat === 'Vegetables & milk' ? 'Sharma Dairy' : '', note: '' });
  }
  // housekeeping schedule split between two staff
  if (big) {
    const assign = {}; roomIds.forEach((id, i) => { assign[id] = i < roomIds.length / 2 ? 'st-hk1' : 'st-hk2'; });
    Store.put('hks', { id: 'hks-daily', name: t('Daily room cleaning'), freq: 'weekly', days: [1, 2, 3, 4, 5, 6], rooms: roomIds, assign, time: '10:00', active: true });
    Store.put('hks', { id: 'hks-deep', name: t('Deep cleaning'), freq: 'weekly', days: [0], rooms: roomIds, assign, time: '11:00', active: true });
    for (let i = 1; i <= 3; i++) genHkTasks(addDays(today(), -i), 1);
    hkTasks().filter(x => x.date < today()).forEach((x, i) => Store.patch(x.id, { status: i % 9 === 4 ? 'missed' : 'done', doneAt: nowIso() }));
  }
  // laundry, complaints, gate, notices, skips
  const act = activeRes();
  act.slice(0, 6).forEach((r, i) => { const { l } = laundryReceive({ resId: r.id, pcs: 8 + i * 4, date: addDays(today(), -(i % 3)) }); if (i % 2) Store.patch(l.id, { status: 'completed', completedAt: nowIso() }); });
  if (act[2]) Store.put('cmp', { resId: act[2].id, roomId: act[2].roomId, cat: 'Plumbing', text: t('Bathroom tap leaking'), status: 'open', date: today(), ts: nowIso(), src: 'resident' });
  if (act[4]) Store.put('cmp', { resId: act[4].id, roomId: act[4].roomId, cat: 'Electrical', text: t('Fan making noise'), status: 'open', date: addDays(today(), -2), ts: nowIso(), src: 'resident' });
  const owing = act.find(r => resDue(r.id) > 0);
  if (owing) Store.put('claim', { resId: owing.id, amount: resDue(owing.id), utr: '4' + String(Math.floor(1e10 + R() * 9e10)), date: today(), ts: nowIso(), status: 'pending' });
  for (let i = 0; i < 6; i++) { const r = act[(i * 3) % act.length]; Store.put('gate', { type: i % 2 ? 'visitor' : 'out', name: i % 2 ? pick(['Ramesh (father)', 'Courier', 'Electrician']) : r.name, resId: r.id, purpose: i % 2 ? t('Meeting') : t('Market'), date: today(), inAt: i % 2 ? nowIso() : null, outAt: i % 2 ? null : nowIso() }); }
  Store.put('notice', { title: t('Water tank cleaning on Sunday'), body: t('Water supply will be off from 10 AM to 1 PM.'), date: today(), pinned: true });
  act.slice(3, 7).forEach(r => Store.put('skip', { id: skipId(r.id, addDays(today(), 1), 'lunch'), resId: r.id, date: addDays(today(), 1), meal: 'lunch', ts: nowIso() }));
  SEEDING = false;
  if (act[5]) Store.put('tiffin', { id: tiffinId(act[5].id, addDays(today(), 1), 'lunch'), resId: act[5].id, roomId: act[5].roomId, date: addDays(today(), 1), meal: 'lunch', note: '', status: 'requested', ts: nowIso() });
}
Store.onEmptyHostel = () => { if (!CLOUD) seedDemo(Store.ctx.hostelId); };

/* ===================================================================== bulk room & bed setup */
function bulkCreateRooms({ floors = [], roomPatterns = [], rooms: customRooms = null, defaultRent = 6000, defaultAc = false, block = '', dryRun = false } = {}) {
  if (!Array.isArray(floors) || !floors.length) throw new Error('Define at least one floor');
  const hasCustom = Array.isArray(customRooms) && customRooms.length > 0;
  if (!hasCustom && (!Array.isArray(roomPatterns) || !roomPatterns.length)) throw new Error('Define at least one room pattern');

  const existingRooms = rooms();
  const existingNos = new Set(existingRooms.map(r => String(r.no).trim().toLowerCase()));
  const batchNos = new Set();
  const generatedRooms = [];

  if (hasCustom) {
    for (const cr of customRooms) {
      const roomNo = String(cr.no || '').trim();
      if (!roomNo) throw new Error('Room number is required');
      const lower = roomNo.toLowerCase();
      if (batchNos.has(lower)) throw new Error(`Duplicate room number in batch: ${roomNo}`);
      if (existingNos.has(lower)) throw new Error(`Room number already exists: ${roomNo}`);
      batchNos.add(lower);

      const capacity = Math.max(1, Math.min(12, parseInt(cr.beds || cr.capacity || 2, 10)));
      const rent = cr.rent != null && !isNaN(cr.rent) ? round2(+cr.rent) : round2(+defaultRent);
      const ac = cr.ac !== undefined ? !!cr.ac : !!defaultAc;
      const roomBlock = cr.block || block || '';
      const floorLabel = cr.floor || floors[0];

      const bedIds = 'ABCDEFGHIJKL'.slice(0, capacity).split('');
      const beds = bedIds.map(id => ({ id, status: 'vac' }));
      const roomId = `room-${slug(roomNo)}-${uid()}`;

      generatedRooms.push({
        id: roomId,
        no: roomNo,
        floor: floorLabel,
        block: roomBlock,
        rent,
        ...(+cr.deposit > 0 ? { deposit: round2(+cr.deposit) } : {}),
        ac,
        sharing: capacity,
        beds
      });
    }
  } else {
    for (const pattern of roomPatterns) {
      const floorIndex = pattern.floorIndex != null ? +pattern.floorIndex : 0;
      const floorLabel = floors[floorIndex] || floors[0];
      const startNo = parseInt(pattern.startNo, 10);
      const endNo = parseInt(pattern.endNo, 10);
      if (isNaN(startNo) || isNaN(endNo)) throw new Error('Start and end room numbers must be integers');
      if (startNo > endNo) throw new Error(`Start room (${startNo}) cannot be greater than end room (${endNo})`);
      if (endNo - startNo > 100) throw new Error('Cannot create more than 100 rooms in a single pattern');

      const capacity = Math.max(1, Math.min(12, parseInt(pattern.beds || pattern.capacity || 2, 10)));
      const rent = pattern.rent != null && !isNaN(pattern.rent) ? round2(+pattern.rent) : round2(+defaultRent);
      const ac = pattern.ac !== undefined ? !!pattern.ac : !!defaultAc;
      const roomBlock = pattern.block || block || '';
      const prefix = pattern.prefix || '';
      const suffix = pattern.suffix || '';

      for (let no = startNo; no <= endNo; no++) {
        const roomNo = `${prefix}${no}${suffix}`.trim();
        const lower = roomNo.toLowerCase();
        if (batchNos.has(lower)) throw new Error(`Duplicate room number in batch: ${roomNo}`);
        if (existingNos.has(lower)) throw new Error(`Room number already exists: ${roomNo}`);
        batchNos.add(lower);

        const bedIds = 'ABCDEFGHIJKL'.slice(0, capacity).split('');
        const beds = bedIds.map(id => ({ id, status: 'vac' }));
        const roomId = `room-${slug(roomNo)}-${uid()}`;

        generatedRooms.push({
          id: roomId,
          no: roomNo,
          floor: floorLabel,
          block: roomBlock,
          rent,
          ac,
          sharing: capacity,
          beds
        });
      }
    }
  }

  if (dryRun) return { createdRooms: generatedRooms, roomCount: generatedRooms.length, bedCount: generatedRooms.reduce((s, r) => s + r.beds.length, 0) };
  // Atomically commit all generated rooms to store
  for (const r of generatedRooms) {
    Store.put('room', r);
  }

  alog('bulk_rooms', `Created ${generatedRooms.length} rooms (${generatedRooms.reduce((s, r) => s + r.beds.length, 0)} beds)`, {
    roomsCount: generatedRooms.length,
    floors: floors.length
  });

  return {
    createdRooms: generatedRooms,
    roomCount: generatedRooms.length,
    bedCount: generatedRooms.reduce((s, r) => s + r.beds.length, 0)
  };
}

/* Saves the rooms from bulkCreateRooms({ dryRun: true }) a few at a time so the owner can cancel part-way.
 * Cancelling stops at once and takes back every room already saved by this run (nothing is left half-built). */
async function commitRoomsCancellable(created, floorsCount, isCancelled, onProgress) {
  const done = [];
  for (let i = 0; i < created.length; i++) {
    if (isCancelled()) {
      for (const r of done) { try { Store.delete(r.id); } catch (e) { /* already gone */ } }
      return { cancelled: true, roomCount: 0, bedCount: 0 };
    }
    Store.put('room', created[i]); done.push(created[i]);
    if (onProgress) onProgress(i + 1, created.length);
    if (i % 3 === 2) await new Promise(res => setTimeout(res, 0));
  }
  alog('bulk_rooms', `Created ${done.length} rooms (${done.reduce((s, r) => s + r.beds.length, 0)} beds)`, { roomsCount: done.length, floors: floorsCount });
  return { cancelled: false, roomCount: done.length, bedCount: done.reduce((s, r) => s + r.beds.length, 0) };
}

/* ===================================================================== cook inventory dependencies */
function getItemDependencies(itemId) {
  const item = itemById(itemId);
  if (!item) return { dishes: [], menus: [], tiffins: [] };
  const dList = dishes().filter(d => {
    const list = d.ings || d.ingredients || [];
    return list.some(g => (g.itemId || g.id) === itemId);
  });
  const dishIds = new Set(dList.map(d => d.id));
  const mList = Store.all('menu').filter(m => (m.dishIds || []).some(id => dishIds.has(id)));
  const tList = Store.all('tiffin').filter(tf => tf.dishId && dishIds.has(tf.dishId));

  return {
    item,
    dishes: dList,
    menus: mList,
    tiffins: tList,
    inUseCount: dList.length + mList.length + tList.length
  };
}

function deactivateItem(itemId, reason = '') {
  const item = itemById(itemId);
  if (!item) throw new Error('Item not found');
  const deps = getItemDependencies(itemId);

  Store.patch(itemId, { active: false, status: 'inactive', deactivatedAt: nowIso(), deactivateReason: reason });

  // Mark all dependent dishes as unavailable
  for (const d of deps.dishes) {
    Store.patch(d.id, { available: false, unavailable: true, missingItem: item.name });
  }

  alog('inventory_deactivate', `Deactivated item ${item.name} (${deps.dishes.length} dishes affected)`, {
    itemId,
    dishesAffected: deps.dishes.map(d => d.name)
  });

  return {
    item: itemById(itemId),
    dishesAffected: deps.dishes,
    disabledDishes: deps.dishes,
    message: `${item.name} is deactivated. ${deps.dishes.length} dependent dish(es) marked unavailable.`
  };
}

function reactivateItem(itemId) {
  const item = itemById(itemId);
  if (!item) throw new Error('Item not found');
  Store.patch(itemId, { active: true, status: 'active', deactivatedAt: null, deactivateReason: null });

  // Check all dishes that use this item; if all ingredients are now active, mark available
  const affectedDishes = dishes().filter(d => {
    const list = d.ings || d.ingredients || [];
    return list.some(g => (g.itemId || g.id) === itemId);
  });
  for (const d of affectedDishes) {
    const list = d.ings || d.ingredients || [];
    const allActive = list.every(g => {
      const ingItem = itemById(g.itemId || g.id);
      return !ingItem || (ingItem.status !== 'inactive' && ingItem.active !== false);
    });
    if (allActive) {
      Store.patch(d.id, { available: true, unavailable: false, missingItem: null });
    }
  }

  alog('inventory_reactivate', `Reactivated item ${item.name}`, { itemId });
  const fresh = itemById(itemId);
  return { item: fresh, active: true, ...fresh };
}

function replaceIngredientInDishes(oldItemId, newItemId) {
  const oldItem = itemById(oldItemId);
  const newItem = itemById(newItemId);
  if (!oldItem || !newItem) throw new Error('Both old and new items must exist');

  const affected = dishes().filter(d => {
    const list = d.ings || d.ingredients || [];
    return list.some(g => (g.itemId || g.id) === oldItemId);
  });
  for (const d of affected) {
    const curIngs = d.ings || d.ingredients || [];
    const updatedIngs = curIngs.map(g => ((g.itemId || g.id) === oldItemId ? { ...g, itemId: newItemId, id: newItemId } : g));
    const allActive = updatedIngs.every(g => {
      const it = itemById(g.itemId || g.id);
      return !it || (it.status !== 'inactive' && it.active !== false);
    });
    const patch = { unavailable: !allActive, available: allActive, missingItem: allActive ? null : d.missingItem };
    if (d.ings) patch.ings = updatedIngs;
    if (d.ingredients) patch.ingredients = updatedIngs;
    Store.patch(d.id, patch);
  }

  alog('inventory_replace', `Replaced ${oldItem.name} with ${newItem.name} across ${affected.length} dishes`, {
    oldItemId, newItemId, count: affected.length
  });

  return { updatedDishes: affected.length, updatedCount: affected.length };
}

/* ===================================================================== bank statement reconciliation */
/* ---- Bank statement import -------------------------------------------------------------------------
 * Every Indian bank (and the UPI app exports) lays its CSV out differently: some put account details above the
 * table, some have separate Credit / Debit columns, some one Amount + Cr/Dr column, dates come as 12/11/2026,
 * 12-Nov-26 or 2026-11-12, amounts as 1,23,456.00 or "Rs. 500 Cr", and the UTR often only sits inside the
 * narration. This reads all of them; rows that are not transactions (opening balance, totals, footers) are skipped. */
function bankCsvRecords(text, delim) {
  const out = []; let row = [], cur = '', q = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === delim) { row.push(cur.trim()); cur = ''; continue; }
    if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cur.trim()); if (row.some(x => x !== '')) out.push(row); row = []; cur = ''; continue; }
    cur += c;
  }
  row.push(cur.trim()); if (row.some(x => x !== '')) out.push(row);
  return out;
}
const BANK_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function parseBankDate(v) {
  let s = String(v || '').trim().replace(/[,]/g, ' ').replace(/\s+/g, ' ');
  if (!s) return '';
  const iso = (y, m, d) => { y = +y; if (y < 100) y += 2000; m = +m; d = +d; if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return ''; return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return iso(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ]?(\d{2,4})/))) { const mo = BANK_MON[m[2].slice(0, 4).toLowerCase()] || BANK_MON[m[2].slice(0, 3).toLowerCase()]; return mo ? iso(m[3], mo, m[1]) : ''; }
  if ((m = s.match(/^([A-Za-z]{3,9})[-/. ](\d{1,2})[-/. ]?(\d{2,4})/))) { const mo = BANK_MON[m[1].slice(0, 4).toLowerCase()] || BANK_MON[m[1].slice(0, 3).toLowerCase()]; return mo ? iso(m[3], mo, m[2]) : ''; }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) return iso(m[3], m[2], m[1]);   // India writes day first
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 80000) { const d = new Date(Math.round((+s - 25569) * 864e5)); return d.toISOString().slice(0, 10); }   // Excel serial
  return '';
}
// -> { v: number, dir: 'CR' | 'DR' | null } ; dir only when the cell itself says so (Cr / Dr suffix, minus sign, brackets)
function parseBankAmount(v) {
  let s = String(v == null ? '' : v).trim(); if (!s) return { v: 0, dir: null };
  let dir = null;
  if (/\b(cr|credit)\.?$/i.test(s)) dir = 'CR'; else if (/\b(dr|debit)\.?$/i.test(s)) dir = 'DR';
  if (/^\(.*\)$/.test(s) || /^-/.test(s) || /^-\s*(₹|rs|inr)/i.test(s)) dir = dir || 'DR';
  if (/^\+/.test(s)) dir = dir || 'CR';
  s = s.replace(/(rs\.?|inr|₹|\bcr\b|\bdr\b|credit|debit)/gi, '').replace(/[,\s()+\-]/g, '');
  const n = parseFloat(s);
  return { v: isFinite(n) ? Math.abs(n) : 0, dir };
}
// The UTR is the column named so, or else it is hiding in the narration: UPI/412398765432/..., NEFT-AXISP00123456-NAME, IMPS-412345678901-..., UTR: ...
function extractBankRef(refCell, narration) {
  const clean = x => String(x || '').trim().replace(/^['"=]+|['"]+$/g, '');
  const rc = clean(refCell);
  if (rc && !/^0+$/.test(rc) && !/^[-–.]+$/.test(rc) && rc.length >= 6) { const m = rc.match(/\b\d{12}\b/); return (m ? m[0] : rc.replace(/\s+/g, '')).toUpperCase(); }
  const n = String(narration || '');
  let m;
  if ((m = n.match(/(?:UTR|RRN|REF(?:ERENCE)?(?:\s*NO)?)[\s.:#-]*([A-Z0-9]{8,22})\b/i))) return m[1].toUpperCase();
  if ((m = n.match(/(?:^|[^0-9])(\d{12})(?:[^0-9]|$)/))) return m[1];
  if ((m = n.match(/\b([A-Z]{4}[A-Z0-9]\d{7,18}|[A-Z]{4}\d{9,20}|[A-Z]{3,6}R?\d{10,20})\b/))) return m[1];
  if ((m = n.match(/\b(\d{9,11}|\d{13,22})\b/))) return m[1];
  return '';
}
function parseBankStatement(text, format = 'csv') {
  if (!text || typeof text !== 'string' || !text.trim()) throw new Error('Statement content cannot be empty');
  const sample = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 40);
  const count = ch => sample.reduce((n, l) => n + (l.split(ch).length - 1), 0);
  const delim = [['\t', count('\t')], [';', count(';')], ['|', count('|')], [',', count(',')]].sort((a, b) => b[1] - a[1])[0][0];
  const recs = bankCsvRecords(text, delim);
  if (recs.length < 2) throw new Error('Statement must contain at least a header and one transaction row');
  const norm = h => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // the header is the first row (anywhere in the first 60) that has a date column and some amount column
  let hi = -1, H = [];
  for (let i = 0; i < Math.min(recs.length, 60); i++) {
    const h = recs[i].map(norm);
    if (h.some(x => /\bdate\b|\bdt\b|\btime\b/.test(x)) && h.some(x => /\b(amount|amt|credits?|deposits?|debits?|withdrawals?|cr|dr)\b/.test(x))) { hi = i; H = h; break; }
  }
  if (hi < 0) throw new Error('Could not find the column headings. The statement needs a Date column and Credit / Deposit or Amount columns.');
  const idx = f => H.findIndex(f);
  const isType = h => /\b(dr cr|cr dr|credit debit|debit credit|txn type|transaction type|type|dr or cr)\b/.test(h) && !/\b(amount|amt)\b/.test(h);
  const colType = idx(isType);
  const colBal = idx(h => /balance|bal\b/.test(h));
  const colCr = idx((h, i) => i !== colType && i !== colBal && /\b(credit|deposit|deposits|credits|cr|received|credited)\b/.test(h) && !/\b(dr|debit|withdrawal)\b/.test(h));
  const colDr = idx((h, i) => i !== colType && i !== colBal && i !== colCr && /\b(debit|withdrawal|withdrawals|dr|paid|debited)\b/.test(h) && !/\b(cr|credit|deposit)\b/.test(h));
  const colAmt = idx((h, i) => i !== colType && i !== colBal && i !== colCr && i !== colDr && /\b(amount|amt|value)\b/.test(h) && !/\bdate\b/.test(h));
  let colDate = idx(h => /\b(txn|tran|transaction|posting|post)\s+date\b|^date$|^date time$|^date and time$/.test(h));
  if (colDate < 0) colDate = idx(h => /\bdate\b|\bdt\b/.test(h) && !/\bvalue\b/.test(h));
  if (colDate < 0) colDate = idx(h => /\bdate\b|\bdt\b/.test(h));
  const colNar = (() => { for (const re of [/narration/, /particulars/, /transaction remarks|remarks/, /description|desc\b/, /transaction details|details|name|merchant|payee/]) { const k = idx((h, i) => i !== colDate && re.test(h)); if (k >= 0) return k; } return -1; })();
  const colRef = idx((h, i) => i !== colNar && i !== colDate && i !== colBal && /\b(utr|rrn|ref|reference|chq|cheque|instrument|txn id|transaction id|upi ref|trans id)\b/.test(h));
  if (colCr < 0 && colAmt < 0) throw new Error('Could not find a Credit / Deposit or Amount column in this statement.');

  const rows = []; let skipped = 0;
  for (let i = hi + 1; i < recs.length; i++) {
    const c = recs[i];
    const date = parseBankDate(colDate >= 0 ? c[colDate] : '');
    if (!date) { skipped++; continue; }                       // opening balance, totals, page footers
    let amount = 0, direction = null;
    if (colCr >= 0 || colDr >= 0) {
      const cr = colCr >= 0 ? parseBankAmount(c[colCr]).v : 0, dr = colDr >= 0 ? parseBankAmount(c[colDr]).v : 0;
      if (cr > 0 && !(dr > 0)) { amount = cr; direction = 'CR'; } else if (dr > 0 && !(cr > 0)) { amount = dr; direction = 'DR'; } else if (cr > 0 && dr > 0) { amount = Math.abs(cr - dr); direction = cr >= dr ? 'CR' : 'DR'; }
    }
    if (!direction && colAmt >= 0) {
      const a = parseBankAmount(c[colAmt]); amount = a.v;
      const tp = colType >= 0 ? String(c[colType] || '') : '';
      if (tp) direction = /\b(cr|credit|deposit|received|in|inward|\+)\b/i.test(tp) ? 'CR' : /\b(dr|debit|withdraw|paid|sent|out|outward)\b/i.test(tp) ? 'DR' : null;
      if (!direction) direction = a.dir || 'CR';
    }
    if (!direction || !(amount > 0)) { skipped++; continue; }
    const narration = colNar >= 0 ? String(c[colNar] || '').replace(/\s+/g, ' ').trim() : '';
    const ref = extractBankRef(colRef >= 0 ? c[colRef] : '', narration);
    rows.push({ lineNo: i + 1, date, amount: round2(amount), direction, ref, utr: ref, refType: ref && /^\d{12}$/.test(ref) ? 'upi_rrn' : (ref ? 'bank_utr' : 'unknown'), narration, raw: c.join(delim) });
  }
  rows.meta = { headerRow: hi + 1, delimiter: delim === '\t' ? 'tab' : delim, skipped, columns: { date: H[colDate], narration: H[colNar], ref: H[colRef], credit: H[colCr], debit: H[colDr], amount: H[colAmt], type: H[colType] } };
  return rows;
}

function reconcileBankStatement(statementRows, opts = {}) {
  const credits = statementRows.filter(r => r.direction === 'CR' && r.amount > 0);
  const pendingClaims = Store.all('claim').filter(c => c.status === 'pending');
  const existingPays = Store.all('pay').filter(p => !p._del && !p.reversed);
  const matchedClaimIds = new Set();
  const seenRefs = new Set();

  const exactMatches = [];
  const probableMatches = [];
  const amountMismatches = [];
  const multipleCandidates = [];
  const unmatchedCredits = [];
  const duplicateTransactions = [];
  const alreadyReconciled = [];

  for (const row of credits) {
    const normRef = row.ref ? String(row.ref).trim() : '';

    if (normRef && seenRefs.has(normRef)) {
      duplicateTransactions.push({ row, reason: 'Duplicate transaction in statement' });
      continue;
    }
    if (normRef) seenRefs.add(normRef);

    if (normRef && existingPays.some(p => p.ref === normRef || p.idempotencyKey === `bank-tx-${normRef}`)) {
      alreadyReconciled.push({ row, reason: 'Already reconciled in ledger' });
      continue;
    }

    const matchingClaims = pendingClaims.filter(c => {
      if (matchedClaimIds.has(c.id)) return false;
      const cRef = (c.utr || '').trim();
      return normRef && cRef && (cRef === normRef || normRef.includes(cRef) || cRef.includes(normRef));
    });

    if (matchingClaims.length === 1) {
      const claim = matchingClaims[0];
      if (Math.abs(claim.amount - row.amount) < 0.01) {
        exactMatches.push({ row, claim, resId: claim.resId, status: 'matched', matchType: 'claim_exact' });
        matchedClaimIds.add(claim.id);
      } else {
        amountMismatches.push({ row, claim, resId: claim.resId, status: 'amount_mismatch', diff: round2(row.amount - claim.amount) });
      }
    } else if (matchingClaims.length > 1) {
      multipleCandidates.push({ row, candidates: matchingClaims, status: 'multiple_candidates' });
    } else {
      // Narration check: phone and name signals
      const phoneMatch = activeRes().find(r => {
        const ph = cleanPhone(r.phone);
        return ph && row.narration.includes(ph.slice(-10));
      });
      const nameMatch = activeRes().find(r => {
        const namePart = r.name.toLowerCase().split(' ')[0];
        return namePart.length >= 3 && row.narration.toLowerCase().includes(namePart);
      });

      const matchedRes = phoneMatch || nameMatch;
      if (matchedRes) {
        const hasDue = Math.abs(resDue(matchedRes.id) - row.amount) < 0.01 || invoices().some(i => i.resId === matchedRes.id && Math.abs(invBal(i) - row.amount) < 0.01);
        if (hasDue && phoneMatch) {
          // Strong match: phone + exact due
          exactMatches.push({ row, res: matchedRes, resId: matchedRes.id, status: 'matched', matchType: 'phone_due' });
        } else {
          probableMatches.push({ row, res: matchedRes, resId: matchedRes.id, status: 'probable', matchType: 'narration', hasDue });
        }
      } else {
        unmatchedCredits.push({ row, status: 'unmatched' });
      }
    }
  }

  if (opts.dryRun) {   // show what would happen; nothing is saved or confirmed
    return { dryRun: true, totalCredits: credits.length, exactMatches, probableMatches, amountMismatches, multipleCandidates, unmatchedCredits, duplicateTransactions, alreadyReconciled,
      summary: { totalCredits: credits.length, autoMatched: opts.autoConfirm !== false ? exactMatches.length : 0, exactMatch: exactMatches.length, probableMatch: probableMatches.length, probable: probableMatches.length, unmatched: unmatchedCredits.length, duplicate: duplicateTransactions.length + alreadyReconciled.length, amountMismatch: amountMismatches.length } };
  }
  const confirmed = [];
  const toConfirm = opts.autoConfirm !== false ? [...exactMatches] : [];
  if (opts.confirmProbable) toConfirm.push(...probableMatches);

  for (const match of toConfirm) {
    const { row, claim, resId, res } = match;
    const targetResId = resId || (claim && claim.resId) || (res && res.id);
    if (!targetResId) continue;
    const pay = recordPayment({
      resId: targetResId,
      amount: row.amount,
      mode: 'upi',
      ref: row.ref || (claim && claim.utr),
      date: row.date,
      claimId: claim ? claim.id : null,
      idempotencyKey: `bank-tx-${row.ref || (claim && claim.id) || uid()}`,
      note: `Auto-reconciled via Bank Statement (${row.narration.slice(0, 60)})`
    });
    if (claim) {
      Store.patch(claim.id, {
        status: 'approved',
        reconciledAt: nowIso(),
        bankTxDate: row.date,
        reconciledBy: (Store.me && Store.me.full_name) || 'Automatic Reconciliation'
      });
    }
    confirmed.push({ claimId: claim ? claim.id : null, resId: targetResId, payId: pay.id, amount: row.amount, ref: row.ref });
  }

  // Persist Statement and Transactions to Store for Owner Review Queue
  const stmtId = `stmt-${today()}-${uid()}`;
  Store.put('stmt', {
    id: stmtId,
    date: today(),
    totalRows: statementRows.length,
    creditsCount: credits.length,
    autoConfirmedCount: confirmed.length,
    probableCount: probableMatches.length,
    unmatchedCount: unmatchedCredits.length,
    duplicateCount: duplicateTransactions.length + alreadyReconciled.length,
    ts: nowIso()
  });

  for (const row of credits) {
    const isExact = exactMatches.some(m => m.row === row);
    const prob = probableMatches.find(m => m.row === row);
    const isDup = duplicateTransactions.some(d => d.row === row);
    const isReconciled = alreadyReconciled.some(d => d.row === row);
    const isMismatch = amountMismatches.find(m => m.row === row);
    const isMulti = multipleCandidates.find(m => m.row === row);
    const txStatus = isExact ? (confirmed.some(c => c.ref === row.ref) ? 'matched' : 'exact') : (prob ? 'probable' : (isMismatch ? 'amount_mismatch' : (isMulti ? 'multiple_candidates' : (isDup ? 'duplicate' : (isReconciled ? 'already_reconciled' : 'unmatched')))));

    Store.put('stmt_tx', {
      id: `stx-${row.ref || uid()}`,
      stmtId,
      date: row.date,
      amount: row.amount,
      direction: row.direction,
      ref: row.ref,
      narration: row.narration,
      status: txStatus,
      resId: (prob && prob.resId) || (isExact && exactMatches.find(m => m.row === row)?.resId) || null,
      claimId: (prob && prob.claim?.id) || (isExact && exactMatches.find(m => m.row === row)?.claim?.id) || null,
      ts: nowIso()
    });
  }

  alog('bank_reconcile', `Bank statement reconciled: ${confirmed.length} auto-confirmed, ${probableMatches.length} review, ${unmatchedCredits.length} unmatched`, {
    totalCredits: credits.length,
    autoConfirmed: confirmed.length,
    review: probableMatches.length,
    mismatches: amountMismatches.length
  });

  const allMatched = exactMatches.concat(probableMatches);
  return {
    totalCredits: credits.length,
    exactMatches,
    autoConfirmedCount: confirmed.length,
    confirmed,
    probableMatches,
    amountMismatches,
    multipleCandidates,
    unmatchedCredits,
    duplicateTransactions,
    alreadyReconciled,
    matched: allMatched,
    summary: {
      totalCredits: credits.length,
      autoMatched: confirmed.length,
      exactMatch: exactMatches.length,
      probableMatch: probableMatches.length,
      probable: probableMatches.length,
      unmatched: unmatchedCredits.length,
      duplicate: duplicateTransactions.length + alreadyReconciled.length,
      amountMismatch: amountMismatches.length
    }
  };
}

/* ===================================================================== automated monthly WhatsApp billing */
function isBillingComplete(resId, ym) {
  const r = resById(resId);
  if (!r || r.status !== 'active') return { complete: false, reason: 'Resident is not active' };
  if (!(r.rent > 0)) return { complete: false, reason: 'Rent not configured' };

  if (S().elec && S().elec.rate > 0 && orgEnabled('electricity')) {
    const mtrs = meters().filter(m => m.roomId === r.roomId && ymOf(m.date) === ym && m.status !== 'review');
    const periods = Store.all('mtr_period').filter(p => p.resId === resId && ymOf(p.endDate) === ym);
    if (!mtrs.length && !periods.length) {
      return { complete: false, reason: 'Electricity reading for cycle is not finalized' };
    }
  }

  const inv = invoices().find(i => i.resId === resId && ymOf(i.date) === ym && i.status !== 'void');
  if (!inv) return { complete: false, reason: 'Monthly invoice has not been generated' };

  return { complete: true, invoice: inv };
}

function sendMonthlyBillingWhatsApp(resId, ym, opts = {}) {
  const r = resById(resId);
  if (!r) throw new Error('Resident not found');
  const h = Store.hostel() || {};
  const statusCheck = isBillingComplete(resId, ym);
  if (!statusCheck.complete && !opts.force) {
    throw new Error(statusCheck.reason || 'Billing is incomplete for this cycle');
  }

  const inv = statusCheck.invoice || invoices().find(i => i.resId === resId && ymOf(i.date) === ym);
  const idmpKey = `wa-bill-${h.id || 'h'}-${resId}-${ym}-${inv ? inv.id : 'inv'}`;

  const existingCamp = Store.all('wa_campaign').find(c => c.idempotencyKey === idmpKey);
  if (existingCamp && !opts.force && !opts.forceResend) {
    throw new Error('Billing WhatsApp already sent for this cycle');
  }

  const cleanP = cleanPhone(r.phone);
  if (!cleanP) throw new Error('Invalid resident mobile number');
  const waPhone = cleanP.startsWith('91') && cleanP.length === 12 ? cleanP : ('91' + cleanP);

  const totalDue = inv ? invBal(inv) : r.rent;
  // the same working pay link every other message uses: amount, UPI id and the invoice are all in it
  const payLink = (S().pay || {}).provider === 'cashfree' ? PaymentGateway.createPaymentLink({ invoiceId: inv ? inv.id : '', amount: totalDue, resId, hostelId: h.id, provider: 'cashfree' }) : payLinkFor(r, totalDue, inv);
  const rentAmt = inv ? (inv.type === 'rent' ? inv.amount : (inv.breakdown && inv.breakdown.rent) || r.rent) : r.rent;
  const elecAmt = inv && inv.breakdown ? (inv.breakdown.electricity || 0) : (inv && inv.type === 'electricity' ? inv.amount : 0);
  const messAmt = inv && inv.breakdown ? (inv.breakdown.mess || 0) : (inv && inv.type === 'mess' ? inv.amount : 0);
  const otherAmt = inv && inv.breakdown ? (inv.breakdown.other || 0) : 0;
  const discAmt = inv ? (inv.discount || 0) : 0;

  const msgText = `Hello ${r.name},\n` +
    `HostelOS Monthly Bill for ${ym} at ${h.name || 'Hostel'}.\n\n` +
    `*Billing Breakdown:*\n` +
    `• Rent: ₹${rentAmt}\n` +
    (elecAmt > 0 ? `• Electricity: ₹${elecAmt}\n` : '') +
    (messAmt > 0 ? `• Mess: ₹${messAmt}\n` : '') +
    (otherAmt > 0 ? `• Other charges: ₹${otherAmt}\n` : '') +
    (discAmt > 0 ? `• Discount: -₹${discAmt}\n` : '') +
    `--------------------------\n` +
    `*Total Payable:* ₹${totalDue}\n` +
    `*Due Date:* ${inv && inv.dueDate ? fmtDate(inv.dueDate) : 'Immediately'}\n` +
    `*Invoice ID:* ${inv ? inv.id : 'N/A'}\n\n` +
    `View details & pay online:\n${payLink}`;

  const camp = Store.put('wa_campaign', {
    id: `wac-${uid()}`,
    hostelId: h.id,
    resId,
    ym,
    invoiceId: inv ? inv.id : null,
    idempotencyKey: idmpKey,
    phone: waPhone,
    amount: totalDue,
    status: 'queued',
    sentAt: nowIso(),
    ts: nowIso()
  });

  return {
    success: true,
    status: 'queued',
    campaignId: camp.id,
    campaign: camp,
    recipient: waPhone,
    phone: waPhone,
    message: msgText,
    text: msgText,
    payload: { messaging_product: 'whatsapp', to: waPhone, text: { body: msgText } }
  };
}

/* ===================================================================== automatic agreement email delivery */
const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

function sendAgreementEmail(agrId, opts = {}) {
  const agr = Store.get(agrId);
  if (!agr) throw new Error('Agreement not found');
  const r = resById(agr.resId);
  const email = (r && r.email) || agr.tenantEmail || agr.email;
  if (!email || !isValidEmail(email)) {
    Store.patch(agrId, { emailStatus: 'failed', emailError: 'Invalid or missing resident email', delivery: { status: 'failed', error: 'Invalid recipient email' } });
    throw new Error('Resident does not have a valid recipient email address');
  }

  if ((agr.emailStatus === 'delivered' || agr.emailStatus === 'sent') && !opts.forceResend) {
    return { ok: true, delivered: true, sent: true, alreadyDelivered: true, status: 'already_delivered', agreement: Store.get(agrId) };
  }

  // 'sent' = handed to the mail service. It only becomes 'delivered' when the provider confirms, and
  // 'failed' (with the reason) when it does not - the old code marked it delivered without sending anything.
  const initialStatus = opts.confirmed ? 'delivered' : 'sent';
  Store.patch(agrId, {
    emailStatus: initialStatus,
    emailRecipient: email,
    lastEmailAttempt: nowIso(),
    delivery: { channel: 'email', status: initialStatus, to: email, sentAt: nowIso(), deliveredAt: opts.confirmed ? nowIso() : null }
  });
  if (!opts.noDispatch) {
    const h = Store.hostel() || {};
    const lines = [
      `Agreement v${agr.version || 1} · ${agr.templateName || 'Rental Agreement'}`,
      `Room ${(agr.resident || {}).roomNo || ''}${(agr.resident || {}).bed ? '-' + agr.resident.bed : ''}  |  Rent ${inr(agr.rent)}/month  |  Deposit ${inr(agr.deposit)}`,
      `Period: ${agr.startDate ? fmtDate(agr.startDate) : '-'} to ${agr.endDate ? fmtDate(agr.endDate) : '-'}  |  Notice: ${agr.noticeDays || 30} days`,
      '', 'TERMS & CONDITIONS',
      ...(agr.clauses || (agr.terms ? [agr.terms] : [])).map((x, i) => `${i + 1}. ${x}`),
      ...((agr.rules || []).length ? ['', 'HOUSE RULES', ...agr.rules.map((x, i) => `${i + 1}. ${x}`)] : []),
      '', agr.legalDisclaimer || ''
    ];
    const text = lines.join('\n');
    const html = renderBrandedEmailHtml({ hostelName: h.name || 'Hostel', title: 'Rental Agreement', headline: 'Your Rental Agreement', recipientName: (r && r.name) || 'Resident', bodyLines: text, intro: 'Your registration is complete. Your rental agreement is below - please keep it for your records.', summaryLabel: 'Rental Agreement', date: fmtDate(today()) });
    Promise.resolve(sendBrandedEmail({ to: email, subject: `${h.name || 'Hostel'} · Your rental agreement`, html, text, resId: agr.resId, hostelId: h.id, replyTo: opts.replyTo || ((h.settings || {}).email) || (typeof S === 'function' && S().pay && S().pay.email) || (Store.me && Store.me.email) || undefined })).then(res => {
      if (res.delivered) Store.patch(agrId, { emailStatus: 'delivered', emailError: '', delivery: { channel: 'email', status: 'delivered', to: email, sentAt: nowIso(), deliveredAt: nowIso() } });
      else if (res.reason === 'demo') { /* demo hostel never sends */ }
      else Store.patch(agrId, { emailStatus: 'failed', emailError: res.reason || 'Email service not configured', delivery: { channel: 'email', status: 'failed', to: email, error: res.reason || 'not_configured' } });
    }).catch(() => {});
  }

  return { ok: true, delivered: true, sent: true, status: initialStatus, recipient: email, agreement: Store.get(agrId) };
}

/* ===================================================================== e-mitra & police verification */
function maskAadhaar(str) {
  const s = String(str || '').replace(/\D/g, '');
  if (s.length !== 12) return 'XXXX-XXXX-XXXX';
  return `XXXX-XXXX-${s.slice(8)}`;
}

/* What a police tenant-verification form actually asks for, and nothing else: who the tenant is, who to reach in the family, how to identify
 * them, where they will stay, and since when. No rent, deposit, dues, payments, electricity, attendance, e-mail, notes or other papers.
 * Every E-Mitra screen reads the resident only through this, so a field that is not listed here cannot show up there. */
const PV_DOC_ALLOWED = /aadhaar|aadhar|id proof|identity|passport photo|photo|pan|voter|driving|passport/i;
function pvSheet(r, hostelArg, roomArg) {
  const h = hostelArg || (typeof Store !== 'undefined' && Store.hostel && Store.hostel()) || {};
  const room = roomArg !== undefined ? roomArg : (r && r.roomId ? roomById(r.roomId) : null);
  const docs = ((r && r.docs) || []).filter(d => PV_DOC_ALLOWED.test(String(d.type || ''))).map(d => ({ type: d.type, path: d.path || '' }));
  return {
    id: r.id,
    tenant: [
      ['Full name', r.name || ''], ['Father / guardian name', r.guardian || ''], ['Guardian mobile', r.guardianPhone || ''],
      ['Tenant mobile', r.phone || ''], ['Aadhaar number', r.idNo || ''], ['Permanent address', r.address || ''], ['College / workplace', r.college || '']
    ],
    stay: [['Room and bed', room ? `${room.no}${r.bed ? ' - ' + r.bed : ''}` : ''], ['Staying since', r.checkIn || '']],
    property: [['Hostel / PG name', h.name || ''], ['Hostel address', h.address || '']],
    docs,
    missing: [['Full name', r.name], ['Father / guardian name', r.guardian], ['Aadhaar number', r.idNo], ['Permanent address', r.address]].filter(x => !x[1]).map(x => x[0]),
  };
}
// Who does the police verification is the super admin's decision, per hostel: the hostel's own
// e-Mitra operator login (default), or the Sarvlekh team from the super admin console (pvPlatform).
// The owner never does it; the owner only watches the status, so this is the one place that says who may.
const pvByPlatform = () => { const h = Store.hostel(); return !!(h && h.modules && h.modules.pvPlatform === true); };
const canVerifyPV = () => ctx().role === 'emitra' || isSuper();
// Every resident who needs verification, sorted into the four states the screens show.
function pvBoard() {
  const rs = (typeof activeRes === 'function' ? activeRes() : Store.all('res')).filter(r => r.status === 'active' || r.status === 'notice');
  const out = { todo: [], submitted: [], verified: [] };
  for (const r of rs) {
    const st = (r.pv || {}).status || 'none';
    if (st === 'not_required' || st === 'exempt') continue;
    (st === 'verified' ? out.verified : st === 'submitted' ? out.submitted : out.todo).push(r);
  }
  return out;
}
function emitraPendingQueue() {
  const allRes = typeof activeRes === 'function' ? activeRes() : Store.all('res');
  return allRes.filter(r => {
    if (r.status !== 'active' && r.status !== 'notice') return false;
    const pv = r.pv || {};
    if (pv.status === 'not_required' || pv.status === 'exempt' || pv.status === 'verified') return false;
    return !pv.status || pv.status === 'none' || pv.status === 'pending_docs' || pv.status === 'ready' || pv.status === 'submitted';
  });
}

function submitPoliceVerification(resId, { refNo, date = today(), certificatePath = null, notes = '', status = 'submitted' }) {
  const r = resById(resId);
  if (!r) throw new Error('Resident not found');
  if (!refNo || !String(refNo).trim()) throw new Error('Verification reference / acknowledgement number is required');

  const pvRecord = {
    refNo: String(refNo).trim(),
    date,
    certificatePath,
    notes: String(notes || '').trim(),
    status: status === 'verified' ? 'verified' : (status === 'rejected' ? 'rejected' : 'submitted'),
    submittedAt: nowIso(),
    verifiedBy: (Store.me && Store.me.full_name) || ctx().role || 'emitra'
  };

  const wasVerified = !!(r.pv && r.pv.status === 'verified');
  Store.patch(resId, { pv: pvRecord });
  if (pvRecord.status === 'verified' && !wasVerified) sendPvConfirmation(resId).catch(e => console.warn('PV confirmation mail:', e.message));
  alog('police_verification', `Police verification for ${r.name}: ${pvRecord.status} (Ref: ${pvRecord.refNo})`, {
    resId, refNo: pvRecord.refNo, status: pvRecord.status
  });

  // Check if all onboarding requirements are met to auto-generate and email agreement
  try {
    checkAndAutoSendAgreement(resId);
  } catch (err) {
    console.warn('Auto agreement trigger warning:', err.message);
  }

  return { ...pvRecord, pv: pvRecord };
}

// Once the police verification is completed the resident gets one e-mail: the confirmation, the reference number,
// their stay details and their rental agreement. The status shows in the hostel's own Police Verification panel too.
async function sendPvConfirmation(resId) {
  const r = resById(resId); if (!r || !r.email || !isValidEmail(r.email)) return { ok: false, reason: 'no_email' };
  const h = Store.hostel() || {}, pv = r.pv || {};
  let agr = typeof getActiveAgreement === 'function' ? getActiveAgreement(r.id) : null;
  if (!agr && r.roomId && typeof createAgreement === 'function') { try { agr = createAgreement({ resId: r.id, rent: r.rent, deposit: r.deposit, startDate: r.checkIn || today(), noticeDays: 30 }); } catch (e) { agr = null; } }
  const lines = [
    `${t('Police verification')}: ${t('Completed')}`, `${t('Reference / Ack No.')}: ${pv.refNo || '-'}`, `${t('Date')}: ${fmtDate(pv.date || today())}`,
    `${t('Hostel / PG')}: ${h.name || ''}`, `${t('Room')}: ${roomName(r.roomId)}${r.bed ? '-' + r.bed : ''}`, `${t('Staying since')}: ${fmtDate(r.checkIn)}`, `${t('Monthly rent')}: ${rs(r.rent)}`,
    agr ? `\n${t('Your rental agreement')}\n${agr.documentText || agr.text || ''}` : ''
  ].filter(Boolean).join('\n');
  const html = renderBrandedEmailHtml({ hostelName: h.name || 'Hostel', title: t('Police verification completed'), headline: t('Your police verification is complete'), recipientName: r.name, intro: t('Your police verification for {h} has been completed. Details and your rental agreement are below.', { h: h.name || 'your hostel' }), bodyLines: lines, amountDue: 0, date: fmtDate(today()) });
  const res = await sendBrandedEmail({ to: r.email, subject: `${h.name || 'Hostel'} · ${t('Police verification completed')}`, html, text: lines, resId: r.id, hostelId: h.id });
  notify({ to: 'res', resId: r.id, title: t('Police verification completed ✓'), body: t('Reference {n}', { n: pv.refNo || '-' }), category: 'agreement' });
  return res;
}
/* ===================================================================== automatic agreement check & email */
function checkAndAutoSendAgreement(resId) {
  const r = resById(resId);
  if (!r) return null;
  const hasRoom = !!(r.roomId && r.bed);
  const hasDocs = (r.docs && r.docs.length > 0) || !!r.idNo;
  const hasPv = !pvOn() || (r.pv && r.pv.status && r.pv.status !== 'none' && r.pv.status !== 'not_started' && r.pv.status !== 'rejected');

  if (!hasRoom || !hasDocs || !hasPv) return null;

  let agr = typeof getActiveAgreement === 'function' ? getActiveAgreement(r.id) : null;
  if (!agr) {
    agr = createAgreement({
      resId: r.id,
      rent: r.rent,
      deposit: r.deposit,
      startDate: r.checkIn || today(),
      noticeDays: 30
    });
  }

  if (agr && r.email && isValidEmail(r.email) && agr.emailStatus !== 'delivered' && agr.emailStatus !== 'sent') {
    try {
      sendAgreementEmail(agr.id);
      notify({
        to: 'res',
        resId: r.id,
        title: t('Rental agreement ready & emailed ✓'),
        body: t('Your rental agreement for Room {r}-{b} has been generated and emailed to {e}.', { r: roomName(r.roomId), b: r.bed, e: r.email }),
        category: 'agreement'
      });
      alog('agreement_auto_sent', `Rental agreement automatically generated and emailed to ${r.name} (${r.email})`, { resId: r.id, agrId: agr.id });
    } catch (err) {
      console.warn('Auto agreement email delivery:', err.message);
    }
  }

  return agr;
}

/* ===================================================================== resident panel notice board */
function residentNoticeBoard(resId) {
  const r = resById(resId);
  const now = today();
  const curYM = ymOf(now);

  const prev1YM = addMonths(curYM + '-01', -1).slice(0, 7);
  const prev2YM = addMonths(curYM + '-01', -2).slice(0, 7);
  const allowedYMs = [curYM, prev1YM, prev2YM];

  const allInvs = typeof resInvoices === 'function' ? resInvoices(resId) : [];
  const feeNotices = [];

  for (const ym of allowedYMs) {
    const invsInYM = allInvs.filter(i => (i.due && i.due.slice(0, 7) === ym) || (i.day && i.day.slice(0, 7) === ym) || (i.date && ymOf(i.date) === ym));
    if (!invsInYM.length) continue;
    const totalDue = sum(invsInYM, invBal);
    const totalAmount = sum(invsInYM, i => i.amount || 0);
    const isCurrent = ym === curYM;
    const isOverdue = invsInYM.some(i => invStat(i) === 'overdue');
    const isPaid = totalDue <= 0;

    feeNotices.push({
      id: `fee-notice-${ym}`,
      ym,
      isCurrent,
      title: isCurrent ? t('Current Month Fees · {m}', { m: fmtYM(ym) }) : t('Previous Fee Notice · {m}', { m: fmtYM(ym) }),
      amount: totalAmount,
      balance: totalDue,
      status: isPaid ? 'paid' : (isOverdue ? 'overdue' : 'due'),
      date: invsInYM[0].due || `${ym}-05`,
      invoices: invsInYM,
      body: invsInYM.map(i => `${i.title}: ${inr(i.amount)}${invBal(i) ? ` (${t('Due')}: ${inr(invBal(i))})` : ` (${t('Paid')})`}`).join(' · ')
    });
  }

  // Include any fee reminder notifications from the last 90 days if not duplicate
  const feeNotifs = Store.all('ntf').filter(n => n.to === 'res' && n.resId === resId && (n.category === 'fee' || n.category === 'bills'));
  for (const n of feeNotifs) {
    const nYm = ymOf(n.date || now);
    if (allowedYMs.includes(nYm) && !feeNotices.some(fn => fn.id === n.id)) {
      feeNotices.push({
        id: n.id,
        ym: nYm,
        isCurrent: nYm === curYM,
        title: n.title,
        amount: 0,
        balance: 0,
        status: 'info',
        date: n.date,
        body: n.body
      });
    }
  }

  // Current month strictly on top, then previous months in descending order
  feeNotices.sort((a, b) => {
    if (a.isCurrent && !b.isCurrent) return -1;
    if (!a.isCurrent && b.isCurrent) return 1;
    return b.ym.localeCompare(a.ym);
  });

  // General notices: automatically disappear after 30 days
  const daysBetween = (a, b) => (!a || !b ? 0 : Math.round(Math.abs((parse(b) - parse(a)) / 86400000)));
  const generalNotices = Store.all('notice').filter(n => {
    if (!n.date) return false;
    return daysBetween(n.date, now) <= 30;
  }).sort((a, b) => (b.pinned - a.pinned) || (b.date > a.date ? 1 : -1));

  return { feeNotices, generalNotices };
}

