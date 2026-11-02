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
  { k: 'settings', l: 'Settings', icon: 'settings', core: true },
];
const MOD = Object.fromEntries(MODULES.map(m => [m.k, m]));
// Modules the super admin can switch off per client. Core modules are always on.
const OPTIONAL_MODULES = MODULES.filter(m => !m.core).map(m => m.k).concat(['residentApp']);
// Some modules cannot stand alone: the kitchen works out what to cook from the mess menu, and
// cleaning tasks are assigned to housekeeping staff. Switching one of those off on its own
// used to leave a screen that silently showed zeros, so a switch here moves its partners with
// it — on brings the things it needs, off takes the things that need it.
const MOD_DEPS = { kitchen: ['mess'], housekeeping: ['staff'] };
const modNeeds = k => MOD_DEPS[k] || [];
const modNeededBy = k => Object.keys(MOD_DEPS).filter(x => MOD_DEPS[x].includes(k));
const modLabel = k => t(k === 'residentApp' ? 'Resident app' : (MOD[k] || {}).l || k);
// Pure: takes a modules map ({laundry:false} = off, missing = on) and returns the corrected
// map plus the other switches it had to move, so the console can say what else changed.
function applyModSwitch(modules, key, on) {
  const out = { ...(modules || {}) }, changed = [];
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
  accountant: { l: 'Accountant', mods: ['home', 'inbox', 'residents', 'payments', 'electricity', 'expenses', 'reports'] },
  cook: { l: 'Cook', mods: ['mess', 'kitchen'] },
  housekeeping: { l: 'Housekeeping', mods: ['housekeeping'] },
  laundry: { l: 'Laundry', mods: ['laundry'] },
  guard: { l: 'Security guard', mods: ['gate', 'attendance'] },
  staff: { l: 'Staff', mods: ['complaints'] },
  resident: { l: 'Resident', mods: [] },
  super: { l: 'Super admin', mods: MODULES.map(m => m.k) },
};
const ctx = () => Store.ctx || {};
const isSuper = () => !!(Store.me && Store.me.is_super);
const isAdmin = () => ['owner', 'manager', 'super'].includes(ctx().role);
const isResident = () => ctx().role === 'resident';
// Two switches, both held by the super admin: the client's plan is the ceiling (a module they
// do not pay for is off in all their hostels), and the per-hostel switch turns it off in one
// PG only. Missing key = on, so an untouched hostel inherits everything.
function orgEnabled(mod) {
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

/* ===================================================================== settings */
const DEFAULT_SETTINGS = {
  pay: { upiId: '', payee: '', phone: '', bank: '', note: '' },
  rent: { day: 1, graceDays: 5, lateFee: 200, lateOn: true, prorate: true },
  elec: { rate: 9, freeUnits: 30, freeMode: 'resident', readingDay: 1 },
  laundry: { freePcs: 30, rate: 10 },
  meals: [
    { k: 'breakfast', l: 'Breakfast', time: '08:00', cutoff: '22:00', prev: true, tCutoff: '21:00', tPrev: true },
    { k: 'lunch', l: 'Lunch', time: '13:00', cutoff: '10:00', prev: false, tCutoff: '09:30', tPrev: false },
    { k: 'dinner', l: 'Dinner', time: '20:30', cutoff: '17:00', prev: false, tCutoff: '16:00', tPrev: false },
  ],
  mess: { skip: true, tiffin: true, learn: true },
  kitchen: { cookCanReceive: true },
  docs: { required: ['Aadhaar card', 'Passport photo'] },
  staffDocs: { required: ['Aadhaar card', 'Passport photo'] },
  // remind: automatic payment reminders, N days after the oldest unpaid bill was due.
  // gw: on/off marker for the owner's self-hosted gateway (the secrets live server-side).
  // `monthly` is the only message the gateway sends by itself: one bill a month per resident with
  // rent and electricity together. It waits for the room's meter reading, or goes anyway from
  // `fallbackDay` so a missed reading never holds up the rent.
  wa: { auto: true, lang: 'en', tpl: {}, remind: { on: true, days: [1, 5, 10] }, monthly: { on: true, fallbackDay: 10 }, gw: { on: false, kind: '' } },
  expenseCats: ['Groceries', 'Vegetables & milk', 'Gas', 'Electricity bill', 'Water', 'Internet', 'Salary', 'Maintenance', 'Cleaning supplies', 'Rent', 'Other'],
  departments: ['Kitchen', 'Housekeeping', 'Laundry', 'Security', 'Maintenance', 'Office'],
  units: ['kg', 'g', 'L', 'ml', 'pcs', 'pkt', 'dozen'],
  auto: { rent: true, late: true, hk: true, missed: true, stock: true, lowstock: true, meter: true, checkout: true },
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
let _setCache = { src: null, val: null };
function S() {
  const src = (Store.hostel() || {}).settings || {};
  if (_setCache.src !== src) _setCache = { src, val: deepMerge(DEFAULT_SETTINGS, src) };
  return _setCache.val;
}
// Meals are always shown in serving-time order, whatever order they were added in.
const byTime = ms => ms.slice().sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
let _mealsCache = { src: null, val: [] };
const meals = () => { const src = S().meals; if (_mealsCache.src !== src) _mealsCache = { src, val: byTime(src) }; return _mealsCache.val; };
const mealByKey = k => meals().find(m => m.k === k) || { k, l: k };
const mealName = k => t(mealByKey(k).l);

/* ===================================================================== documents
 * ID papers stay private (see Files in data.js); each Open mints a ten-minute link. */
function docOpen(d) {
  return d && d.path ? `<button class="btn sm" data-act="opendoc" data-path="${esc(d.path)}">${esc(t('Open'))}</button>` : badge('Missing', 'warn');
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
  none:      ['Not started', 'bad'],
  submitted: ['Submitted',   'warn'],
  verified:  ['Verified',    'ok'],
  rejected:  ['Rejected',    'bad'],
  exempt:    ['Not required', 'mute'],
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
function admitSignup(signupId, { roomId, bed, rent, deposit, checkIn: from = today(), food = true }) {
  const a = Store.get(signupId); if (!a) throw new AppError('Application not found');
  if (a.status === 'admitted') throw new AppError('This application is already admitted');
  const r = checkIn({
    name: a.name, phone: a.phone, guardian: a.guardian, guardianPhone: a.guardianPhone,
    email: a.email, idNo: a.idNo, address: a.address, college: a.college, lang: a.lang,
    roomId, bed, rent, deposit, checkIn: from, food,
  });
  // the papers they uploaded move with them, so nobody re-asks for an Aadhaar already on file
  if ((a.docs || []).length) Store.patch(r.id, { docs: a.docs.map(d => ({ ...d })) });
  // credit a verification the resident did themselves; the owner can still change it
  if (a.pv && (a.pv.self || a.pv.refNo)) {
    pvSet(r.id, { status: a.pv.refNo ? 'submitted' : 'none', refNo: a.pv.refNo || '', state: a.pv.state || '',
      submittedOn: a.pv.refNo ? (a.date || today()) : null, note: t('Filed by the resident at registration') });
  }
  Store.patch(signupId, { status: 'admitted', resId: r.id, admittedOn: today(), admittedBy: Store.me && Store.me.full_name });
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
const payments = () => { const b = blockScope(); const a = Store.all('pay'); return b ? a.filter(payInScope) : a; };

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
const sitePhotos = () => SITE_PHOTOS.map(([k]) => sitePhotoUrl(k)).filter(Boolean);

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
const SITE_RESERVED = ['www', 'app', 'admin', 'api', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'dashboard', 'login', 'support', 'help', 'blog', 'docs', 'status', 'staging', 'test', 'dev', 'h', 'join', 'visit', 'pay', 'site', 'public', 'ns1', 'ns2'];
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
  const inv = Store.put('inv', { paid: 0, waived: 0, date: today(), ...o, amount: round2(o.amount) });
  const r = resById(inv.resId);
  if (r && r.credit > 0 && inv.amount > 0 && can('payments')) {
    const use = Math.min(r.credit, inv.amount);
    inv.paid = round2(use); inv.creditUsed = round2(use);
    Store.put('inv', inv); Store.patch(r.id, { credit: round2(r.credit - use) });
  }
  return inv;
}

// FIFO allocation: oldest dues first, extra money becomes advance credit.
// `invIds` puts those bills at the front of the queue; `exclude` keeps a bill out of this
// payment altogether, which is how a penalty the owner is not collecting today stays pending.
function recordPayment({ resId, amount, mode = 'cash', ref = '', date = today(), note = '', claimId = null, invIds = null, exclude = null }) {
  const r = resById(resId); if (!r) throw new Error('Resident not found');
  amount = round2(amount); if (!(amount > 0)) throw new Error('Enter an amount');
  let left = amount; const alloc = [];
  const skip = new Set(exclude || []);
  const open = openInv(resId).filter(i => !skip.has(i.id));
  const target = invIds ? open.filter(i => invIds.includes(i.id)) : open;
  const rest = invIds ? open.filter(i => !invIds.includes(i.id)) : [];
  for (const inv of [...target, ...rest]) {
    if (left <= 0) break;
    const take = Math.min(left, invBal(inv));
    inv.paid = round2((inv.paid || 0) + take); Store.put('inv', inv);
    alloc.push({ inv: inv.id, amt: round2(take), title: inv.title }); left = round2(left - take);
  }
  if (left > 0) Store.patch(resId, { credit: round2((r.credit || 0) + left) });
  const no = (S().receiptNo || 0) + Store.all('pay').length + 1;
  const pay = Store.put('pay', { resId, roomId: r.roomId, amount, mode, ref, date, note, alloc, credit: left, claimId, no: `R-${no}`, by: Store.me && Store.me.full_name, ts: nowIso() });
  notify({ to: 'res', resId, title: t('Payment received'), body: `${inr(amount)} · ${t(mode.toUpperCase())}` });
  return pay;
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
  amount = round2(amount); if (!(amount > 0)) throw new AppError('Enter an amount');
  reason = String(reason || '').trim(); if (!reason) throw new AppError('Please write the reason');
  const inv = addInvoice({ resId, roomId: r.roomId, type: 'penalty', reason, amount, date,
    title: `${t('Penalty')} - ${reason}`, period: ymOf(date), due: due || addDays(date, 7) });
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
  const graceDays = S().rent.graceDays;
  for (const row of plan.rows) {
    if (row.exists) continue;
    const d = rentDue(row.ym);
    addInvoice({ id: row.id, resId, roomId: r.roomId, type: 'rent', period: row.ym,
      title: `${t('Rent')} ${fmtYM(row.ym)}`, amount: round2(r.rent || 0), date: d, due: addDays(d, graceDays) });
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
function upiUri(amount, note) {
  const p = S().pay;
  return `upi://pay?pa=${encodeURIComponent(p.upiId)}&pn=${encodeURIComponent(p.payee || (Store.hostel() || {}).name || '')}&am=${round2(amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(String(note).slice(0, 60))}`;
}
// WhatsApp only links http(s), so we send a link to our static pay page that opens any UPI app + shows QR.
function payLink(amount, note) {
  const p = S().pay; if (!p.upiId) return '';
  const q = new URLSearchParams({ pa: p.upiId, pn: p.payee || (Store.hostel() || {}).name || '', am: round2(amount).toFixed(2), tn: String(note).slice(0, 60), h: (Store.hostel() || {}).name || '' });
  return `${baseUrl()}pay.html?${q}`;
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
    bill: 'Hello {name},\n\nHere is your bill at *{hostel}*.\n\n{lines}\n\n*Total due: {total}*\n\nPay with any UPI app:\n{paylink}\n\nAfter paying, please enter the UTR number or upload the screenshot in the app:\n{link}\n\nThank you,\n{hostel}',
    reminder: 'Hello {name},\n\nThis is a gentle reminder from *{hostel}*. The following is still pending:\n\n{lines}\n\n*Total due: {total}*\n\nYou can pay here:\n{paylink}\n\nIf you have already paid, please ignore this message.\n\nRegards,\n{hostel}',
    receipt: 'Hello {name},\n\nWe have received your payment. Thank you.\n\nAmount: *{amount}* ({mode})\nDate: {date}\nReceipt no: {no}\nBalance due: {balance}\n\nRegards,\n{hostel}',
    laundryIn: 'Hello {name},\n\nWe have received *{pcs} clothes* for laundry on {date}.\nFree pieces left this month: {free}{charge}\n\nRegards,\n{hostel}',
    laundryDone: 'Hello {name},\n\nYour laundry ({pcs} clothes) is ready. Please collect it from the laundry desk.\n\nRegards,\n{hostel}',
    checkout: 'Hello {name},\n\nYour checkout from *{hostel}* is complete. Thank you for staying with us.\n\nSecurity deposit: {deposit}\nDeductions: {deduct}\n*Refund: {refund}*\n\nWe wish you all the best.\n\nRegards,\n{hostel}',
    staffWelcome: 'Hello {name},\n\nYour login for {hostel} is ready.\n\nApp: {link}\nUser ID: *{username}*\nPassword: *{password}*\n\nPlease change your password after you log in for the first time.',
    password: 'Hello {name},\n\nYour password has been changed.\n\nApp: {link}\nUser ID: *{username}*\nNew password: *{password}*\n\nPlease change it after you log in.',
  },
  hi: {
    welcome: 'नमस्ते {name},\n\n*{hostel}* में आपका स्वागत है।\n\n*आपका कमरा*\nकमरा: {room}, बेड {bed}\nमासिक किराया: {rent}\nसिक्योरिटी डिपॉज़िट: {deposit}\n\n*आपका ऐप लॉगिन*\nऐप: {link}\nयूज़र ID: *{username}*\nपासवर्ड: *{password}*\n\nपहली बार लॉगिन करने के बाद कृपया अपना पासवर्ड बदल लें।\n\nधन्यवाद,\n{hostel}',
    bill: 'नमस्ते {name},\n\n*{hostel}* में आपका बिल यह है।\n\n{lines}\n\n*कुल बकाया: {total}*\n\nकिसी भी UPI ऐप से भुगतान करें:\n{paylink}\n\nभुगतान के बाद ऐप में UTR नंबर डालें या स्क्रीनशॉट अपलोड करें:\n{link}\n\nधन्यवाद,\n{hostel}',
    reminder: 'नमस्ते {name},\n\n*{hostel}* की ओर से यह एक विनम्र याद दिलाना है। नीचे दिया गया भुगतान अभी बाकी है:\n\n{lines}\n\n*कुल बकाया: {total}*\n\nयहाँ से भुगतान करें:\n{paylink}\n\nअगर आप भुगतान कर चुके हैं तो कृपया इस संदेश को अनदेखा करें।\n\nधन्यवाद,\n{hostel}',
    receipt: 'नमस्ते {name},\n\nआपका भुगतान मिल गया है। धन्यवाद।\n\nराशि: *{amount}* ({mode})\nतारीख: {date}\nरसीद नंबर: {no}\nबाकी: {balance}\n\nधन्यवाद,\n{hostel}',
    laundryIn: 'नमस्ते {name},\n\n{date} को लॉन्ड्री के लिए *{pcs} कपड़े* मिले हैं।\nइस महीने फ्री बचे: {free}{charge}\n\nधन्यवाद,\n{hostel}',
    laundryDone: 'नमस्ते {name},\n\nआपकी लॉन्ड्री ({pcs} कपड़े) तैयार है। कृपया लॉन्ड्री डेस्क से ले जाएँ।\n\nधन्यवाद,\n{hostel}',
    checkout: 'नमस्ते {name},\n\n*{hostel}* से आपका चेकआउट पूरा हो गया है। हमारे साथ रहने के लिए धन्यवाद।\n\nसिक्योरिटी डिपॉज़िट: {deposit}\nकटौती: {deduct}\n*वापसी: {refund}*\n\nआपके उज्ज्वल भविष्य की शुभकामनाएँ।\n\nधन्यवाद,\n{hostel}',
    staffWelcome: 'नमस्ते {name},\n\n{hostel} के लिए आपका लॉगिन तैयार है।\n\nऐप: {link}\nयूज़र ID: *{username}*\nपासवर्ड: *{password}*\n\nपहली बार लॉगिन करने के बाद कृपया अपना पासवर्ड बदल लें।',
    password: 'नमस्ते {name},\n\nआपका पासवर्ड बदल दिया गया है।\n\nऐप: {link}\nयूज़र ID: *{username}*\nनया पासवर्ड: *{password}*\n\nलॉगिन के बाद कृपया इसे बदल लें।',
  },
};
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
  on: () => typeof CLOUD !== 'undefined' && CLOUD && !isDemoHostel() && !!(S().wa.gw && S().wa.gw.on),
  async send(list, onProgress) {
    const out = [];
    for (let i = 0; i < list.length; i += 5) {
      const chunk = list.slice(i, i + 5);
      try {
        const r = await Cloud.waApi('send', { hostel_id: Store.ctx.hostelId, messages: chunk.map(m => ({ phone: phone10(m.phone), text: m.text })) });
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
  const body = done
    ? `<div class="empty"><b>${esc(t('All sent'))} 🎉</b>${esc(t('{n} messages', { n: q.list.length }))}</div>`
    : `${q.list.length > 1 ? `<div class="row sb" style="margin-bottom:8px"><b>${esc(m.label || '')}</b><span class="badge acc">${q.i + 1} / ${q.list.length}</span></div>` : ''}
       <div class="card" style="white-space:pre-wrap;font-size:14.5px;max-height:44dvh;overflow:auto">${esc(m.text)}</div>
       <div class="hint" style="margin-top:8px">${esc(t('WhatsApp opens with this message typed. Just press Send.'))}</div>`;
  openModal({ title: q.title, body, foot: done ? `<button class="btn primary block" data-act="close">${esc(t('Done'))}</button>`
    : `${q.list.length > 1 ? `<button class="btn" data-act="waskip">${esc(t('Skip'))}</button>` : `<button class="btn" data-act="close">${esc(t('Close'))}</button>`}<a class="btn wa" style="flex:1" href="${esc(waUrl(m.phone, m.text))}" target="_blank" rel="noopener" data-act="wanext">${ico('wa', 'sm')} ${esc(t('Open WhatsApp'))}</a>` });
}

// Bill text for a resident: every open invoice + total + UPI pay link.
function billMessage(r, kind = 'bill', invs) {
  const open = invs || openInv(r.id), total = sum(open, invBal), lang = waLang(r);
  const lines = open.map(i => `${i.title}: ${rs(invBal(i))}`).join('\n');
  const note = `${r.name.split(' ')[0]} ${roomName(r.roomId)} ${(Store.hostel() || {}).name || ''}`.trim();
  return { total, text: tpl(kind, { name: r.name.split(' ')[0], hostel: (Store.hostel() || {}).name, lines, total: rs(total), paylink: payLink(total, note) || t('(ask owner for UPI)'), link: appUrl() }, lang) };
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
  const x = Store.put('rinfo', { resId, roomId: r.roomId, type, from: from || null, to: to || from || null,
    text: String(text || '').trim(), status: 'new', date: today(), ts: nowIso() });
  notify({ to: 'admin', title: rinfoLabel(type), link: 'complaints',
    body: `${r.name} - ${roomName(r.roomId)}${x.text ? ': ' + x.text : ''}` });
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
function notify({ to, resId, staffId, title, body = '', link = '', id }) {
  if (SEEDING) return null;
  // a resident's own row-level access needs res_id on everything they create
  if (!resId && isResident()) resId = ctx().refId;
  return Store.put('ntf', { id: id || undefined, to, resId: resId || null, staffId: staffId || null, title, body, link, date: today(), ts: nowIso(), read: false });
}
function myNotifs() {
  const c = ctx(), all = Store.all('ntf');
  let list;
  if (isAdmin()) list = all.filter(n => n.to === 'admin');
  else if (isResident()) list = all.filter(n => n.to === 'res' && n.resId === c.refId);
  else list = all.filter(n => (n.to === 'staff' && n.staffId === c.refId) || n.to === 'role:' + c.role);
  return list.sort(by('ts', -1));
}
function alog(rule, msg) { Store.put('log', { date: today(), ts: nowIso(), rule, msg }); }

/* ===================================================================== rooms & residents */
function bedsOf(room) { return room.beds || []; }
function vacantBeds() {
  const out = [];
  for (const r of rooms()) for (const b of bedsOf(r)) if (b.status === 'vac') out.push({ room: r, bed: b });
  return out;
}
function occupancy() {
  let total = 0, occ = 0;
  for (const r of rooms()) for (const b of bedsOf(r)) { if (b.status !== 'mnt') total++; if (b.status === 'occ') occ++; }
  return { total, occ, vac: total - occ, pct: pct(occ, total) };
}
function setBed(roomId, bedId, patch) {
  const room = roomById(roomId); if (!room) return;
  room.beds = bedsOf(room).map(b => (b.id === bedId ? { ...b, ...patch } : b));
  Store.put('room', room);
}

function rentDue(ym) { const d = Math.min(S().rent.day, daysIn(ym)); return `${ym}-${pad(d)}`; }
// Check-in: resident record, bed, first rent (pro-rated) and deposit invoices. Returns the resident.
function checkIn(o) {
  const room = roomById(o.roomId); if (!room) throw new Error('Choose a room');
  const bed = bedsOf(room).find(b => b.id === o.bed);
  if (!bed || bed.status !== 'vac') throw new Error('That bed is not vacant any more');
  const id = o.id || uid('res-');
  const r = Store.put('res', { id, resId: id, name: o.name.trim(), phone: phone10(o.phone), guardian: o.guardian || '', guardianPhone: phone10(o.guardianPhone), email: o.email || '', idNo: o.idNo || '', address: o.address || '', college: o.college || '', roomId: room.id, bed: bed.id, rent: o.rent === '' || o.rent == null || isNaN(o.rent) ? +room.rent || 0 : +o.rent, deposit: +o.deposit || 0, checkIn: o.checkIn || today(), status: 'active', credit: 0, food: o.food !== false, docs: [], lang: o.lang || 'en', notes: o.notes || '' });
  setBed(room.id, bed.id, { status: 'occ', resId: r.id });
  const ym = ymOf(r.checkIn), dim = daysIn(ym), day = +r.checkIn.slice(8, 10);
  const first = S().rent.prorate && day > 1 ? round2((r.rent * (dim - day + 1)) / dim) : r.rent;
  if (r.rent > 0) addInvoice({ id: `inv-rent-${r.id}-${ym}`, resId: r.id, roomId: room.id, type: 'rent', period: ym, title: `${t('Rent')} ${fmtYM(ym)}${first !== r.rent ? ' (' + t('pro-rata') + ')' : ''}`, amount: first, date: r.checkIn, due: addDays(r.checkIn, 2) });
  if (r.deposit > 0) addInvoice({ id: `inv-dep-${r.id}`, resId: r.id, roomId: room.id, type: 'deposit', title: t('Security deposit'), amount: r.deposit, date: r.checkIn, due: addDays(r.checkIn, 2) });
  notify({ to: 'admin', title: t('New check-in'), body: `${r.name} · ${room.no}-${bed.id}` });
  return r;
}
function welcomeMessage(r, login) {
  return tpl('welcome', { name: r.name.split(' ')[0], hostel: (Store.hostel() || {}).name, room: roomName(r.roomId), bed: r.bed, rent: rs(r.rent), deposit: rs(r.deposit), link: appUrl(), username: login ? login.username : r.username || '-', password: login ? login.password : t('(your mobile number)') }, waLang(r));
}
function shiftBed(resId, roomId, bedId, newRent) {
  const r = resById(resId), room = roomById(roomId);
  const bed = room && bedsOf(room).find(b => b.id === bedId);
  if (!bed || bed.status !== 'vac') throw new Error('That bed is not vacant');
  setBed(r.roomId, r.bed, { status: 'vac', resId: null });
  setBed(roomId, bedId, { status: 'occ', resId });
  Store.patch(resId, { roomId, bed: bedId, rent: newRent > 0 ? newRent : r.rent });
  notify({ to: 'res', resId, title: t('Room changed'), body: `${room.no}-${bedId}` });
}
// Checkout: dues come out of the deposit; the refund waits for approval in the inbox.
function checkout(resId, date = today(), deductions = 0, note = '') {
  const r = resById(resId); if (!r) return null;
  const depPaid = round2(sum(resInvoices(resId).filter(i => i.type === 'deposit'), i => i.paid || 0));
  // dues other than the deposit invoice itself
  const dues = round2(sum(openInv(resId).filter(i => i.type !== 'deposit'), invBal));
  let held = depPaid, settle = Math.min(held, dues);
  if (settle > 0) {
    recordPayment({ resId, amount: settle, mode: 'deposit', ref: 'Adjusted from deposit', date, invIds: openInv(resId).filter(i => i.type !== 'deposit').map(i => i.id) });
    held = round2(held - settle);
  }
  openInv(resId).filter(i => i.type === 'deposit').forEach(i => Store.patch(i.id, { waived: invBal(i) + (i.waived || 0), note: 'Closed at checkout' }));
  const refund = Math.max(0, round2(held - deductions + (resById(resId).credit || 0)));
  setBed(r.roomId, r.bed, { status: 'vac', resId: null });
  Store.patch(resId, { status: 'left', left: date, credit: 0, exitNote: note });
  const dep = Store.put('dep', { resId, roomId: r.roomId, date, deposit: depPaid, settled: settle, deductions, refund, status: refund > 0 ? 'pending' : 'closed', note });
  if (r.userId) Backend.admin('set_active', { user_id: r.userId, active: false }).catch(e => toast(t('{n} is checked out, but their login could not be switched off: {m}. Disable it under Settings > Users.', { n: r.name, m: e.message }), 'bad'));
  alog('checkout', `${r.name}: ${t('refund')} ${inr(refund)}`);
  return dep;
}

/* ===================================================================== electricity */
const meters = () => Store.all('meter').slice().sort(by('date', -1));
const lastMeter = roomId => meters().find(m => m.roomId === roomId) || null;
// Split a room's units between the residents living there, honouring free units.
// `weights` (0..1 per resident, default 1) is the part of the reading period each one actually
// lived in the room, so someone who left or arrived mid-period pays only for their days and
// gets free units only for their days.
// `scale` is how many months of free allowance the stretch between the two readings earns
// (see freeMonths): 1 for a normal month, about 0.5 for a fortnight.
function splitElectricity(roomId, units, rate, resIds, weights, scale = 1) {
  const e = S().elec, n = resIds.length; if (!n) return [];
  const w = resIds.map((_, i) => (weights && weights[i] != null ? Math.max(0, Math.min(1, weights[i])) : 1));
  const tw = w.reduce((a, b) => a + b, 0) || n;
  const freePool = e.freeUnits * scale;
  if (e.freeMode === 'room') {
    const billable = Math.max(0, units - freePool);
    return resIds.map((id, i) => { const f = w[i] / tw, b = billable * f; return { resId: id, units: round2(units * f), free: round2(Math.min(units, freePool) * f), billable: round2(b), amount: Math.round(b * rate), days: weights ? round2(w[i]) : undefined }; });
  }
  return resIds.map((id, i) => {
    const share = units * w[i] / tw, free = freePool * w[i], billable = Math.max(0, share - free);
    return { resId: id, units: round2(share), free: round2(Math.min(share, free)), billable: round2(billable), amount: Math.round(billable * rate), days: weights ? round2(w[i]) : undefined };
  });
}
// Free units are "per month", so a stretch between two readings earns them day by day:
// each day counts 1 / (days in that calendar month). Nov 1 → Dec 1 is exactly 1, a fortnight is
// about half, so a mid-month check-in or check-out never collects a whole month's free units
// twice. Without a start date (the room's first reading) it is a full month.
function freeMonths(from, to) {
  if (!from) return 1;
  let cur = String(from).slice(0, 10), total = 0;
  for (let i = 0; i < 240 && diffDays(to, cur) > 0; i++) {
    const y = +cur.slice(0, 4), m = +cur.slice(5, 7);
    const next = iso(new Date(y, m, 1)), dim = diffDays(next, cur.slice(0, 7) + '-01');
    const end = diffDays(to, next) < 0 ? String(to).slice(0, 10) : next;
    total += diffDays(end, cur) / dim; cur = end;
  }
  return total;
}
// Who shared the room between two readings, and for what part of that time. Includes people
// who checked out during the period, so their units are not left on the roommates' bills.
function meterOccupants(roomId, from, to) {
  const span = from ? Math.max(1, diffDays(to, from)) : 0;
  const out = [];
  for (const r of Store.all('res')) {
    if (r.roomId !== roomId || r.checkIn > to) continue;
    if (r.status !== 'active' && !(r.left && from && r.left > from)) continue;
    if (!span) { if (r.status === 'active') out.push([r.id, 1]); continue; }
    const a = r.checkIn > from ? r.checkIn : from, b = r.status === 'active' || !r.left || r.left > to ? to : r.left;
    const d = Math.max(0, diffDays(b, a));
    if (d > 0) out.push([r.id, d / span]);
  }
  return out;
}
function addReading({ roomId, curr, date = today(), prev }) {
  const room = roomById(roomId); if (!room) throw new Error('Choose a room');
  const last = lastMeter(roomId);
  const p = prev != null && !isNaN(prev) ? +prev : last ? last.curr : 0;
  if (+curr < p) throw new Error(t('Reading cannot be less than previous ({p})', { p }));
  const units = round2(curr - p), rate = S().elec.rate;
  const occ = meterOccupants(roomId, last ? last.date : null, date);
  const partial = occ.some(o => o[1] < 1);
  const shares = splitElectricity(roomId, units, rate, occ.map(o => o[0]), partial ? occ.map(o => o[1]) : null, freeMonths(last ? last.date : null, date));
  const avg = last ? last.units : null, span = last ? Math.max(1, diffDays(date, last.date)) : null;
  // A reading taken mid-month covers only a few days, so compare units per day, not per reading —
  // otherwise the full month that follows a check-in reading always looks "unusual" and sits unbilled.
  let odd = false;
  if (avg > 0) odd = last.span && span ? span >= 7 && last.span >= 7 && units / span > (avg / last.span) * 2.2 : units > avg * 2.2;
  const m = Store.put('meter', { roomId, date, prev: p, curr: +curr, units, span, rate, freeUnits: S().elec.freeUnits, freeMode: S().elec.freeMode, shares, total: sum(shares, s => s.amount), period: ymOf(date), status: odd ? 'review' : 'billed' });
  if (odd) notify({ to: 'admin', title: t('Unusual electricity reading'), body: `${room.no}: ${units} ${t('units')} (${t('last')} ${avg})` });
  else billMeter(m);
  return m;
}
// One opening row per room (deterministic id), so re-saving the migration screen corrects it.
function setOpeningReading(roomId, curr, date = today()) {
  return Store.put('meter', { id: `meter-open-${roomId}`, roomId, date, prev: +curr, curr: +curr, units: 0, rate: S().elec.rate, shares: [], total: 0, period: ymOf(date), status: 'billed', opening: true });
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
function moveReading(roomId, curr, date = today()) {
  if (!orgEnabled('electricity')) return null;
  if (curr === '' || curr == null || isNaN(curr)) throw new Error(t('Enter the meter reading'));
  const last = lastMeter(roomId);
  if (!last) return setOpeningReading(roomId, curr, date);   // nothing to bill yet, this is where it starts
  if (sameDay(last.date, date) && !last.opening) {           // already read today
    if (+curr < last.curr) throw new Error(t('Reading cannot be less than previous ({p})', { p: last.curr }));
    return null;
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
  for (const s of m.shares) if (s.amount > 0) addInvoice({ id: `inv-el-${m.id}-${s.resId}`, resId: s.resId, roomId: m.roomId, type: 'electricity', period: m.period, title: `${t('Electricity')} ${fmtShort(m.date)} (${num(s.billable)} ${t('units')})`, amount: s.amount, date: m.date, due: addDays(m.date, 7) });
  Store.patch(m.id, { status: 'billed' });
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
  pcs = Math.round(+pcs); if (!(pcs > 0)) throw new Error('Enter number of clothes');
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
const dishesFor = (date, mealK) => ((menuDoc().week[parse(date).getDay()] || {})[mealK] || []).map(id => Store.get(id)).filter(Boolean);
// Cut-off: e.g. breakfast skip allowed until 22:00 the previous day.
function cutoffAt(date, mealK, kind = 'skip') {
  const m = mealByKey(mealK), tm = kind === 'tiffin' ? m.tCutoff : m.cutoff, prev = kind === 'tiffin' ? m.tPrev : m.prev;
  const d = parse(prev ? addDays(date, -1) : date); const [h, mi] = String(tm || '00:00').split(':').map(Number); d.setHours(h, mi || 0, 0, 0); return d;
}
const beforeCutoff = (date, mealK, kind) => new Date() < cutoffAt(date, mealK, kind);
const skipId = (resId, date, mealK) => `skip-${resId}-${date}-${mealK}`;
const tiffinId = (resId, date, mealK) => `tif-${resId}-${date}-${mealK}`;
function onLeave(resId, date) { return Store.all('leave').some(l => l.resId === resId && l.from <= date && l.to >= date); }
function toggleSkip(resId, date, mealK, force) {
  const id = skipId(resId, date, mealK), cur = Store.get(id);
  if (!isAdmin() && !beforeCutoff(date, mealK, 'skip')) throw new Error(t('Cut-off time passed for {m}', { m: mealName(mealK) }));
  if (cur && force !== true) { Store.remove(id); return false; }
  if (!cur) { Store.put('skip', { id, resId, date, meal: mealK, ts: nowIso() }); const tf = Store.get(tiffinId(resId, date, mealK)); if (tf) Store.remove(tf.id); }
  return true;
}
function toggleTiffin(resId, date, mealK, note = '') {
  const id = tiffinId(resId, date, mealK), cur = Store.get(id);
  if (!isAdmin() && !beforeCutoff(date, mealK, 'tiffin')) throw new Error(t('Cut-off time passed for {m}', { m: mealName(mealK) }));
  if (cur) { Store.remove(id); return false; }
  Store.put('tiffin', { id, resId, roomId: (resById(resId) || {}).roomId, date, meal: mealK, note, status: 'requested', ts: nowIso() });
  const sk = Store.get(skipId(resId, date, mealK)); if (sk) Store.remove(sk.id);
  return true;
}
function headcount(date, mealK) {
  const eligible = residents().filter(r => r.food !== false && activeOn(r, date));
  let leave = 0, skip = 0;
  const skips = new Set(Store.all('skip').filter(s => s.date === date && s.meal === mealK).map(s => s.resId));
  for (const r of eligible) { if (onLeave(r.id, date)) leave++; else if (skips.has(r.id)) skip++; }
  const tiffins = Store.all('tiffin').filter(x => x.date === date && x.meal === mealK && !skips.has(x.resId));
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
function markMissed() {
  const cut = S().hk.missedAfter, now = nowMinutes(); let n = 0;
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
const STAFF_LOGIN_ROLES = ['cook', 'housekeeping', 'laundry', 'guard', 'staff', 'accountant'];
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
  const paid = sum(Store.all('sal').filter(x => x.staffId === s.id && x.ym === ym), x => x.amount);
  return { P, A, H, unmarked: Math.max(0, lastDay - P - A - H), payable, paid, due: Math.max(0, payable - paid) };
}

/* ===================================================================== automation */
const RULES = [
  { k: 'rent', l: 'Monthly rent bills', d: 'Creates every resident\'s rent bill on the rent day. Credit is adjusted automatically.' },
  { k: 'late', l: 'Late fee', d: 'Adds the late fee once when rent stays unpaid after the grace days.' },
  { k: 'meter', l: 'Meter reading reminder', d: 'Reminds you on the reading day which rooms still need a meter reading.' },
  { k: 'hk', l: 'Cleaning tasks', d: 'Creates today\'s and tomorrow\'s cleaning tasks from schedules and tells each staff member.' },
  { k: 'missed', l: 'Missed cleaning alert', d: 'Marks tasks missed after the cut-off time and alerts you.' },
  { k: 'stock', l: 'Daily stock usage', d: 'Deducts yesterday\'s estimated kitchen usage from stock using the menu and real headcount.' },
  { k: 'lowstock', l: 'Low stock alert', d: 'Tells the cook and you when an item will run out within 2 days.' },
  { k: 'checkout', l: 'Checkout reminder', d: 'Reminds you a day before a resident\'s planned checkout.' },
];
// Bills, late fees and reminders are the hostel's business, never one block's: a wing filter
// in the header must not decide who gets charged this month.
function runAutomation(force) { return withAllBlocks(() => runAutomationAll(force)); }
function runAutomationAll(force) {
  if (!Store.ctx || !Store.ctx.hostelId) return 0;
  const key = `hostelos.auto.${Store.ctx.hostelId}.${today()}.${ctx().role}`;
  if (!force && LS.get(key)) return 0;
  const A = S().auto, d0 = today(), ym = ymOf(d0); let acts = 0;
  const admin = isAdmin();
  if (admin && A.rent && d0 >= rentDue(ym)) {
    for (const r of activeRes()) {
      if (r.checkIn > rentDue(ym) || !(r.rent > 0)) continue;
      const id = `inv-rent-${r.id}-${ym}`; if (Store.get(id)) continue;
      addInvoice({ id, resId: r.id, roomId: r.roomId, type: 'rent', period: ym, title: `${t('Rent')} ${fmtYM(ym)}`, amount: r.rent, date: rentDue(ym), due: addDays(rentDue(ym), S().rent.graceDays) }); acts++;
    }
    if (acts) alog('rent', t('{n} rent bills created', { n: acts }));
  }
  if (admin && A.late && S().rent.lateOn && S().rent.lateFee > 0) {
    let n = 0;
    for (const i of invoices()) if (i.type === 'rent' && invBal(i) > 0 && i.due < d0 && !Store.get(`inv-late-${i.id}`)) {
      const r = resById(i.resId); if (!r || r.status === 'left') continue;
      addInvoice({ id: `inv-late-${i.id}`, resId: i.resId, roomId: i.roomId, type: 'late', period: i.period, title: `${t('Late fee')} · ${i.title}`, amount: S().rent.lateFee, date: d0, due: addDays(d0, 3) }); n++;
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
      }).catch(() => {});
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
    const logId = `log-rem-${old.id}-${st}`; if (Store.get(logId)) continue;
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
    const logId = `log-mbill-${r.id}-${ym}`; if (Store.get(logId)) continue;
    const invs = resInvoices(r.id).filter(i => i.period === ym && (i.type === 'rent' || i.type === 'electricity') && invBal(i) > 0);
    if (!invs.length) continue;
    const read = !orgEnabled('electricity') || meters().some(x => x.roomId === r.roomId && !x.opening && ymOf(x.date) === ym);
    if (!read && +d0.slice(8) < fb) continue;
    out.push({ r, due: sum(invs, invBal), invs, logId, rule: 'mbill' });
  }
  return out;
}
const monthlyBillMsgs = list => list.map(x => ({ phone: x.r.phone, text: billMessage(x.r, 'bill', x.invs).text, label: `${x.r.name} · ${inr(x.due)}`, x }));
function markReminded(list) { for (const x of list) Store.put('log', { id: x.logId, rule: x.rule || 'remind', msg: `${x.r.name} · ${inr(x.due)}`, resId: x.r.id, date: today(), ts: nowIso() }); }
const reminderMsgs = list => list.map(x => ({ phone: x.r.phone, text: billMessage(x.r, 'reminder').text, label: `${x.r.name} · ${inr(x.due)}`, x }));

// Residents who owe money now — used by "Send reminders" (one tap each on WhatsApp).
function dueList(overdueOnly) { return activeRes().map(r => ({ r, due: resDue(r.id), od: resOverdue(r.id) })).filter(x => (overdueOnly ? x.od : x.due) > 0).sort((a, b) => b.due - a.due); }

/* ===================================================================== approvals inbox */
function inboxItems() {
  const out = [];
  if (can('payments')) for (const c of Store.all('claim').filter(c => c.status === 'pending')) { const r = resById(c.resId); out.push({ k: 'claim', id: c.id, icon: 'rupee', ic: 'ok', t: `${t('UPI payment')} · ${inr(c.amount)}`, d: `${r ? r.name : ''} · UTR ${c.utr || '—'}`, ts: c.ts }); }
  if (can('kitchen')) for (const p of Store.all('pr').filter(p => p.status === 'requested')) out.push({ k: 'pr', id: p.id, icon: 'cart', ic: 'warn', t: `${t('Purchase request')} ${p.no}`, d: `${p.by || ''} · ${p.items.length} ${t('items')}`, ts: p.ts });
  if (can('electricity')) for (const m of meters().filter(m => m.status === 'review')) out.push({ k: 'meter', id: m.id, icon: 'bolt', ic: 'warn', t: `${t('Check meter reading')} · ${roomName(m.roomId)}`, d: `${m.units} ${t('units')}`, ts: m._u });
  if (can('payments')) for (const d of Store.all('dep').filter(d => d.status === 'pending')) { const r = resById(d.resId); out.push({ k: 'dep', id: d.id, icon: 'wallet', ic: 'info', t: `${t('Deposit refund')} · ${inr(d.refund)}`, d: r ? r.name : '', ts: d._u }); }
  if (can('complaints')) for (const c of Store.all('cmp').filter(c => c.status === 'open')) { const r = resById(c.resId); out.push({ k: 'cmp', id: c.id, icon: 'wrench', ic: 'bad', t: `${t(c.cat)} · ${roomName(c.roomId)}`, d: `${r ? r.name + ': ' : ''}${c.text}`, ts: c.ts }); }
  if (can('housekeeping') && isAdmin()) for (const x of hkTasks().filter(x => (x.status === 'missed' || x.status === 'not_cleaned') && !x.ack)) out.push({ k: 'hk', id: x.id, icon: 'broom', ic: 'warn', t: `${t(x.status === 'missed' ? 'Cleaning missed' : 'Room not cleaned')} · ${x.roomNo}`, d: `${fmtShort(x.date)} · ${x.staffName || t('Unassigned')}${x.reason ? ' · ' + x.reason : ''}`, ts: x._u });
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
  const big = opts.big != null ? !!opts.big : hostelId === 'h1', offlineDemo = hostelId === 'h1';
  const fakePhone = () => '5' + String(Math.floor(1e8 + R() * 9e8));
  SEEDING = true;
  const h = Store.hostel();
  if (h && !Object.keys(h.settings || {}).length) Store.saveSettings({ pay: { upiId: 'sunrisepg@okicici', payee: h.name, phone: '9876500001' } });
  // rooms
  const fl = big ? 3 : 2, per = big ? 4 : 3, roomIds = [];
  for (let f = 1; f <= fl; f++) for (let n = 1; n <= per; n++) {
    const no = `${f}0${n}`, cap = n % 3 === 0 ? 3 : 2, rent = cap === 3 ? 6500 : 8000;
    const r = Store.put('room', { id: `room-${no}`, no, floor: `${t('Floor')} ${f}`, rent, sharing: cap, ac: n === 1, beds: 'ABC'.slice(0, cap).split('').map(id => ({ id, status: 'vac' })) });
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
      if (R() < (big ? 0.12 : 0.2) && k > 0) continue;
      const months = 1 + Math.floor(R() * 7), ci = addDays(today(), -months * 30 - Math.floor(R() * 20));
      const name = k === 0 && big ? 'Aman Gupta' : `${names[k % names.length]} ${pick(last)}`;
      const r = checkIn({ id: `res-${k + 1}`, name, phone: k === 0 && big && offlineDemo ? '9812300001' : fakePhone(), guardianPhone: fakePhone(), roomId: rid, bed: b.id, rent: room.rent, deposit: room.rent, checkIn: ci, college: pick(['Allen Kota', 'Resonance', 'Motion IIT', 'Vibrant Academy', 'Office']) });
      if (k === 0 && big && offlineDemo) Store.patch(r.id, { username: 'aman.gupta' });
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
  for (const rid of roomIds) {
    const base = 1000 + Math.floor(R() * 4000), lm = addDays(today(), -32);
    Store.put('meter', { roomId: rid, date: addDays(lm, -30), prev: base - 140, curr: base, units: 140, rate: 9, shares: [], total: 0, period: ymOf(addDays(lm, -30)), status: 'billed' });
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
  if (act[4]) Store.put('cmp', { resId: act[4].id, roomId: act[4].roomId, cat: 'Electrical', text: t('Fan making noise'), status: 'progress', date: addDays(today(), -2), ts: nowIso(), src: 'resident' });
  const owing = act.find(r => resDue(r.id) > 0);
  if (owing) Store.put('claim', { resId: owing.id, amount: resDue(owing.id), utr: '4' + String(Math.floor(1e10 + R() * 9e10)), date: today(), ts: nowIso(), status: 'pending' });
  for (let i = 0; i < 6; i++) { const r = act[(i * 3) % act.length]; Store.put('gate', { type: i % 2 ? 'visitor' : 'out', name: i % 2 ? pick(['Ramesh (father)', 'Courier', 'Electrician']) : r.name, resId: r.id, purpose: i % 2 ? t('Meeting') : t('Market'), date: today(), inAt: i % 2 ? nowIso() : null, outAt: i % 2 ? null : nowIso() }); }
  Store.put('notice', { title: t('Water tank cleaning on Sunday'), body: t('Water supply will be off from 10 AM to 1 PM.'), date: today(), pinned: true });
  act.slice(3, 7).forEach(r => Store.put('skip', { id: skipId(r.id, addDays(today(), 1), 'lunch'), resId: r.id, date: addDays(today(), 1), meal: 'lunch', ts: nowIso() }));
  SEEDING = false;
  if (act[5]) Store.put('tiffin', { id: tiffinId(act[5].id, addDays(today(), 1), 'lunch'), resId: act[5].id, roomId: act[5].roomId, date: addDays(today(), 1), meal: 'lunch', note: '', status: 'requested', ts: nowIso() });
}
Store.onEmptyHostel = () => { if (!CLOUD) seedDemo(Store.ctx.hostelId); };
