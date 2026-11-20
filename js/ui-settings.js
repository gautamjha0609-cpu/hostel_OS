'use strict';
/* Owner settings — one clear screen per topic, iOS Settings style. Everything here drives the rest of the app. */

// Grouped the way an owner thinks about the hostel; each row is one plain-named page.
const SETTINGS_SECTIONS = [
  ['Your hostel', [
    ['property', 'Hostel details & UPI', 'home', 'tn0'],
    ['site', 'Public landing page', 'globe', 'tn1', 'landing'],
    ['expcats', 'Expense categories', 'tag', 'tn3', 'expenses']
  ]],
  ['Money', [
    ['rent', 'Rent & billing', 'cal', 'tn2'],
    ['deposits_late', 'Deposit & late fee', 'wallet', 'tn3'],
    ['elec_utils', 'Electricity', 'bolt', 'tn3', 'electricity'],
    ['charges_services', 'Extra charges (Wi-Fi, parking…)', 'layers', 'tn4'],
    ['laundry', 'Laundry', 'shirt', 'tn1', 'laundry']
  ]],
  ['Residents', [
    ['checkin_out', 'Check-in & checkout rules', 'userplus', 'tn0'],
    ['qr', 'Resident self-registration (QR)', 'qr', 'tn1'],
    ['accessories', 'Room accessories checklist', 'box', 'tn3'],
    ['docs', 'Documents to collect', 'file', 'tn5'],
    ['police', 'Police verification', 'shield', 'tn4', 'residents']
  ]],
  ['Daily running', [
    ['gate', 'Gate & visitors', 'door', 'tn0', 'gate'],
    ['attend', 'Attendance & roll call', 'check', 'tn2', 'attendance'],
    ['mess_food', 'Meals & mess billing', 'clock', 'tn3', 'mess'],
    ['dishes', 'Dishes & menu', 'utensils', 'tn4', 'mess'],
    ['items', 'Stock items', 'box', 'tn5', 'kitchen'],
    ['hk', 'Housekeeping rules', 'broom', 'tn1', 'housekeeping']
  ]],
  ['Team', [
    ['staff_perms', 'Staff roles & punch-in', 'key', 'tn5'],
    ['users', 'Logins & accounts', 'users', 'tn0'],
    ['depts', 'Departments', 'badge', 'tn2', 'staff']
  ]],
  ['Messages & data', [
    ['agreements_comm', 'Agreements & WhatsApp', 'file', 'tn2'],
    ['data', 'Backup & export', 'download', 'tn5']
  ]]
];

function activeRulesSummaryCard() {
  const s = S(), h = Store.hostel();
  const eff = effectiveSettings(h ? h.id : null);
  const tplName = (s.businessTemplate && (BUSINESS_TEMPLATES[s.businessTemplate] || {}).label) || 'Custom / Standard PG';
  const rentDesc = s.rent.model === 'joining_date' ? t('Joining-date cycle') : t('Calendar Monthly (Day {d})', { d: s.rent.day });
  const elecDesc = s.elec.pricing === 'slab' ? t('Slab-based tiered pricing') : t('Fixed ₹{r}/unit', { r: s.elec.rate });
  const messDesc = { included: t('Included in rent'), compulsory: t('Compulsory (₹{f}/mo)', { f: s.mess.monthlyFee }), optional: t('Optional (₹{f}/mo)', { f: s.mess.monthlyFee }), per_meal: t('Per-meal billing') }[s.mess.billing || 'included'];
  const depDesc = s.deposit.mode === 'rent_multiple' ? t('{m}x Monthly rent', { m: s.deposit.rentMultiplier || 1 }) : s.deposit.mode === 'fixed' ? inr(s.deposit.fixedAmount || 0) : s.deposit.mode === 'per_bed' ? t('Set per room / bed') : t('Typed at check-in');
  const lateDesc = s.lateFee.on ? (s.lateFee.mode === 'daily' ? t('₹{a}/day (cap ₹{c})', { a: s.lateFee.dailyAmount || 50, c: s.lateFee.maxCap || 1000 }) : inr(s.lateFee.amount || 200)) : t('Disabled');

  const cell = (l, v) => `<div><small>${esc(t(l))}</small><b>${esc(v)}</b></div>`;
  const wide = typeof matchMedia === 'function' && matchMedia('(min-width:720px)').matches;
  return `<details class="rules-card" ${wide ? 'open' : ''}>
    <summary class="rules-head">
      <h3>${esc(t('Active Business Rules'))}</h3>
      <span class="chev-d">${ico('chev2', 'sm')}</span>
    </summary>
    <div class="rules-grid">
      ${cell('Rent Cycle', rentDesc)}${cell('Electricity', elecDesc)}${cell('Mess Model', messDesc)}
      ${cell('Deposit Policy', depDesc)}${cell('Late Fee', lateDesc)}${cell('Notice Period', `${s.checkout.noticeDaysRequired ?? 30} ${t('days')}`)}
    </div>
  </details>`;
}

PAGES.settings = {
  title: 'Settings', mod: 'settings',
  render(sec) {
    if (sec && SETTINGS_PAGES[sec]) return `<div class="narrow settings-pg" style="max-width:720px"><div class="row" style="margin:6px 0 4px">${btn('Settings', 'go', 'data-to="settings"', 'ghost sm', 'back')}</div>${SETTINGS_PAGES[sec]()}</div>`;
    return `<div class="narrow settings-pg" style="max-width:720px">${head('Settings', esc(hostelName()))}
      ${activeRulesSummaryCard()}
      ${SETTINGS_SECTIONS.map(([title, rows]) => { const vis = rows.filter(r => !r[4] || can(r[4])); return vis.length ? group(title, vis.map(([k, l, icn, col]) => li({ icon: icn, ic: col, t: t(l), d: settingSummary(k), act: 'go', attrs: `data-to="settings/${k}"` })).join('')) : ''; }).join('')}</div>`;
  },
};
function settingSummary(k) {
  const s = S();
  return {
    property: s.pay.upiId ? `UPI: ${s.pay.upiId}` : t('Add your UPI ID to send pay links'),
    pay: s.pay.upiId ? `UPI: ${s.pay.upiId}` : t('Add your UPI ID to send pay links'),
    rent: s.rent.model === 'joining_date' ? t('Joining-date cycle · Due in {d} days', { d: s.rent.dueDays || 5 }) : t('Due on day {d} · late fee {f} after {g} days', { d: s.rent.day, f: s.lateFee.on ? (s.lateFee.mode === 'daily' ? inr(s.lateFee.dailyAmount) + '/d' : inr(s.lateFee.amount)) : t('off'), g: s.lateFee.graceDays ?? 5 }),
    deposits_late: t('Deposit: {m} · Late fee: {l}', { m: t(DEPOSIT_RULE_LABEL[s.deposit.mode] || 'Entered at check-in'), l: s.lateFee.on ? (s.lateFee.mode === 'daily' ? inr(s.lateFee.dailyAmount) + '/d' : inr(s.lateFee.amount)) : t('off') }),
    elec_utils: s.elec.pricing === 'slab' ? t('Tiered slab rates · {s}', { s: t(s.elec.sharing) }) : t('₹{r}/unit · {f} free units per {m}', { r: s.elec.rate, f: s.elec.freeUnits, m: t(s.elec.freeMode === 'room' ? 'room' : 'resident') }),
    elec: t('₹{r}/unit · {f} free units per {m}', { r: s.elec.rate, f: s.elec.freeUnits, m: t(s.elec.freeMode === 'room' ? 'room' : 'resident') }),
    mess_food: { included: t('Included in rent'), compulsory: t('Compulsory (₹{f}/mo)', { f: s.mess.monthlyFee }), optional: t('Optional (₹{f}/mo)', { f: s.mess.monthlyFee }), per_meal: t('Per-meal billing') }[s.mess.billing || 'included'],
    checkin_out: t('Notice: {n} days · {a} admission', { n: s.checkout.noticeDaysRequired ?? 30, a: s.checkin.requireApproval !== 'none' ? s.checkin.requireApproval : t('Direct') }),
    staff_perms: t('Role matrix & staff attendance'),
    agreements_comm: orgEnabled('automation') ? t('Templates & WhatsApp: {m}', { m: s.wa.mode === 'official_api' ? t('Official Cloud API') : t('Click-to-Chat') }) : t('Agreement format and message templates'),
    charges_services: (s.charges || []).length ? t('{n} additional charges active', { n: s.charges.length }) : t('Add Wi-Fi, Parking, AC etc.'),
    laundry: t('{f} free/month · then ₹{r} per piece', { f: s.laundry.freePcs, r: s.laundry.rate }),
    meals: s.meals.map(m => `${t(m.l)} ${fmtTime(m.time)}`).join(' · '),
    dishes: t('{n} dishes', { n: dishes().length }), items: t('{n} items', { n: items().length }),
    kitchen: s.kitchen.cookCanReceive ? t('Cook can receive goods') : t('Only owner receives goods'),
    expcats: t('{n} categories', { n: s.expenseCats.length }), depts: s.departments.map(d => t(d)).join(', '),
    hkstaff: t('{n} active', { n: hkStaff().filter(x => x.status === 'active').length }), hk: t('Missed after {t}', { t: fmtTime(s.hk.missedAfter) }) + ' · ' + t('{n} roles can mark done', { n: (s.hk.markBy || []).length }),
    staffatt: { manual: t('Marked by owner'), self: t('Staff punch in themselves'), both: t('Punch-in + owner can mark') }[s.staffAtt.mode] + (s.staffAtt.lat !== '' && s.staffAtt.lat != null ? ' · ' + t('within {r} m', { r: s.staffAtt.radius }) : ''),
    qr: joinOn() ? t('Residents scan and fill their own form') : t('Resident self check-in is off'),
    gate: (s.gate || {}).selfEntry !== false ? t('Visitors can fill their own entry') : t('Only the guard enters visitors'),
    site: siteCfg().on ? t('Live at {u}', { u: siteUrl().replace(/^https?:\/\//, '') }) : t('Not published yet'),
    users: t('Logins for residents & staff'), wa: (s.wa.gw && s.wa.gw.on ? t('Sends automatically') : s.wa.auto ? t('Opens automatically after each action') : t('Manual')) + (s.wa.remind.on !== false ? ' · ' + t('reminders on') : ''),
    docs: s.docs.required.join(', '), data: t('Download a copy of everything'),
    police: !pvOn() ? t('Off') : (pvStateName() ? t('{s} · remind after {n} days', { s: pvStateName(), n: s.police.dueDays }) : t('Choose your state')),
    attend: s.attend.on === false ? t('Off — no roll call in this hostel')
      : attPeriods().map(x => `${t(x.l)}${x.time ? ' ' + fmtTime(x.time) : ''}`).join(' · ') || t('Add a roll call time'),
  }[k] || '';
}
// Inline settings form: fields + a Save button. toPatch(values) → settings patch (or error string).
const SET_FORMS = {};
// Picking a state fills in that state's police portal; the owner can still overwrite it.
document.addEventListener('change', e => {
  const f = e.target.form;
  if (!f || f.id !== 'sf_police' || e.target.name !== 'state') return;
  const st = e.target.value, custom = (S().police.portals || {})[st];
  f.elements.url.value = custom || (PV_STATES.find(x => x[0] === st) || [])[2] || '';
});
/* A field may carry showIf: v => boolean, where v holds the form's current values. It is shown only
 * while that is true, so a setting never offers boxes for a choice the owner did not make. Hidden
 * fields keep their saved value and are skipped by validation. A section or html row needs a `key`. */
const sfVisible = (fl, v) => !fl.showIf || !!fl.showIf(v);
function sfInitial(fields) { const v = {}; for (const f of fields) if (f.name) v[f.name] = f.type === 'checkbox' ? !!f.value : f.value; return v; }
function sfApply(form) {
  const f = SET_FORMS[form.dataset.sf]; if (!f) return;
  const v = formValues(form, f.fields);
  for (const fl of f.fields) {
    if (!fl.showIf) continue;
    const w = form.querySelector(`[data-fw="${fl.name || fl.key}"]`); if (w) w.hidden = !sfVisible(fl, v);
  }
}
for (const ev of ['input', 'change']) document.addEventListener(ev, e => { const form = e.target && e.target.closest && e.target.closest('form[data-sf]'); if (form) sfApply(form); });
function settingsForm(id, fields, toPatch, foot = '') {
  SET_FORMS[id] = { fields, toPatch };
  const iv = sfInitial(fields);
  return `<form class="card" id="sf_${id}" data-sf="${id}" novalidate><div class="fgrid">${fields.map(fl => fieldHtml(sfVisible(fl, iv) ? fl : { ...fl, hidden: true })).join('')}</div><div class="ferr" id="sfe_${id}"></div><div class="row" style="margin-top:14px">${foot}<span class="sp"></span><button class="btn primary" type="button" data-act="savesettings" data-form="${id}">${esc(t('Save'))}</button></div></form>`;
}
A.savesettings = async el => {
  const id = el.dataset.form, f = SET_FORMS[id], form = $('#sf_' + id), err = $('#sfe_' + id);
  const v = formValues(form, f.fields); err.textContent = '';
  for (const fl of f.fields) if (sfVisible(fl, v) && fl.required && (v[fl.name] === '' || (typeof v[fl.name] === 'number' && isNaN(v[fl.name])))) { err.textContent = t('{f} is required.', { f: t(fl.label) }); return; }
  // the same checks every popup form makes: ranges, mobile numbers and e-mail addresses are never saved wrong
  for (const fl of f.fields) {
    if (!fl.name || !sfVisible(fl, v)) continue;
    const x = v[fl.name], L = t(fl.label || fl.name);
    if (fl.type === 'number' && typeof x === 'number' && !isNaN(x)) {
      if (fl.min != null && x < fl.min) { err.textContent = t('{f} must be at least {n}.', { f: L, n: fl.min }); form.elements[fl.name]?.focus?.(); return; }
      if (fl.max != null && x > fl.max) { err.textContent = t('{f} must be at most {n}.', { f: L, n: fl.max }); form.elements[fl.name]?.focus?.(); return; }
    }
    if (typeof x === 'string' && /[<>]/.test(x)) { err.textContent = t('{f} cannot contain < or > characters.', { f: L }); form.elements[fl.name]?.focus?.(); return; }
    if (fl.pattern instanceof RegExp && x && !fl.pattern.test(String(x))) { err.textContent = t('{f} looks wrong. Please check it.', { f: L }); form.elements[fl.name]?.focus?.(); return; }
    if (fl.maxlength && typeof x === 'string' && x.length > fl.maxlength) { err.textContent = t('{f} is too long (max {n} characters).', { f: L, n: fl.maxlength }); return; }
    if (fl.type === 'tel' && x && !/^[5-9][0-9]{9}$/.test(phone10(x))) { err.textContent = t('{f} must be a 10-digit mobile number.', { f: L }); form.elements[fl.name]?.focus?.(); return; }
    if (fl.type === 'email' && x && !isValidEmail(x)) { err.textContent = t('{f} must be a valid email address.', { f: L }); form.elements[fl.name]?.focus?.(); return; }
  }
  const patch = f.toPatch(v, form);
  if (typeof patch === 'string') { err.textContent = t(patch); return; }
  // a new web address must not be one another hostel already has
  if (id === 'site' && patch.site && patch.site.slug && patch.site.slug !== (siteCfg().slug || '') && CLOUD) {
    try {
      const r = await fetch('/api/public/slug?s=' + encodeURIComponent(patch.site.slug) + '&h=' + encodeURIComponent(Store.ctx.hostelId)).then(x => x.json());
      if (r && r.free === false) { err.textContent = t(r.why === 'reserved' ? 'This name is kept for Sarvlekh itself. Choose another.' : 'Another hostel already uses this web address. Add your area or a number, for example {n}-2.', { n: patch.site.slug }); return; }
    } catch (e) { /* offline: the page itself refuses an address two hostels claim, so saving is still safe to try */ }
  }
  // lists replace rather than merge, or a removed or reordered entry comes back
  try { await Store.saveSettings(patch, Object.keys(patch).filter(k => Array.isArray(patch[k]))); toast('Settings saved'); render(); }
  catch (e) { err.textContent = t(e.message); }
};
// Editable list stored in settings (e.g. expense categories). path like 'docs.required'.
const getPath = path => path.split('.').reduce((o, k) => (o ? o[k] : undefined), S());
function listEditor(path, placeholder, protect = []) {
  const list = getPath(path) || [];
  return `<div class="group"><div class="li noic"><input id="ls_${path.replace('.', '_')}" placeholder="${esc(t(placeholder))}" style="flex:1"><button class="btn sm primary" data-act="lsadd" data-path="${path}">${esc(t('Add'))}</button></div>${list.map((x, i) => `<div class="li noic"><span class="body"><span class="t">${esc(t(x))}</span></span>${protect.includes(x) ? '' : `<button class="btn sm ghost" data-act="lsedit" data-path="${path}" data-i="${i}" aria-label="${esc(t('Rename'))}">${ico('edit', 'sm')}</button><button class="btn sm ghost" data-act="lsdel" data-path="${path}" data-i="${i}" aria-label="${esc(t('Delete'))}">${ico('trash', 'sm')}</button>`}</div>`).join('')}
</div>`;
}
async function saveList(path, list) {
  const keys = path.split('.');
  if (keys.length === 1) await Store.replaceSettingsKey(keys[0], list);
  else { const top = clone(S()[keys[0]]); top[keys[1]] = list; await Store.replaceSettingsKey(keys[0], top); }
}
A.lsadd = async el => {
  const inp = $('#ls_' + el.dataset.path.replace('.', '_')), v = inp.value.trim(); if (!v) return;
  const list = [...(getPath(el.dataset.path) || [])];
  if (list.some(x => x.toLowerCase() === v.toLowerCase())) return toast('Already in the list', 'bad');
  list.push(v); await saveList(el.dataset.path, list); render(); const n = $('#ls_' + el.dataset.path.replace('.', '_')); if (n) n.focus();
};
A.lsedit = el => { const list = [...(getPath(el.dataset.path) || [])], i = +el.dataset.i; formModal({ title: 'Rename', submit: 'Save', fields: [{ name: 'name', label: 'Name', value: list[i], required: true, maxlength: 60 }], onSubmit: async v => { const nm = String(v.name || '').trim(); if (!nm) return 'Enter a name'; if (list.some((x, k) => k !== i && String(x).toLowerCase() === nm.toLowerCase())) return 'That name is already on the list'; list[i] = nm; await saveList(el.dataset.path, list); render(); toast('Saved'); } }); };
A.lsdel = async el => { const list = [...(getPath(el.dataset.path) || [])]; list.splice(+el.dataset.i, 1); await saveList(el.dataset.path, list); render(); };

function saveElecUtilsSettings(v, e) {
  let slabs = e.slabs;
  if (v.pricing === 'slab') {
    const u1 = +v.slab1_upTo || 100, r1 = +v.slab1_rate || 8;
    const u2 = +v.slab2_upTo || 250, r2 = +v.slab2_rate || 10;
    const r3 = +v.slab3_rate || 12;
    slabs = [
      { upTo: Math.max(1, u1), rate: Math.max(0, r1) },
      { upTo: Math.max(u1 + 1, u2), rate: Math.max(0, r2) },
      { upTo: 999999, rate: Math.max(0, r3) }
    ];
  }
  return { elec: { ...S().elec, ...v, slabs, scanRole: v.scanRole || 'both' } };
}

const SETTINGS_PAGES = {
  property: () => {
    const h = Store.hostel(), p = S().pay;
    return `${head('Property & UPI Payments')}${settingsForm('property', [
      { name: 'name', label: 'Hostel / PG name', value: h.name, required: true },
      { name: 'phone', label: 'Owner mobile (shown to residents)', type: 'tel', value: p.phone },
      { name: 'address', label: 'Property address', value: h.address, full: true },
      { name: 'email', label: 'Owner e-mail', type: 'email', value: p.email || '', placeholder: 'you@example.com', info: t('Checkout reports and other notices are e-mailed here.') },
      { name: 'upiId', label: 'UPI ID (VPA)', value: p.upiId, placeholder: 'name@okhdfcbank' },
      { name: 'payee', label: 'Name on UPI account', value: p.payee || h.name, maxlength: 60, pattern: /^(?=.*[A-Za-zऀ-ॿ]).{2,60}$/ },
      { name: 'bank', label: 'Bank details (optional, shown on bill)', value: p.bank, full: true, maxlength: 160 },
    ], v => {
      if (v.upiId && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v.upiId)) return 'UPI ID looks invalid (example: name@okicici)';
      if (v.name !== h.name || v.address !== h.address) {
        h.name = v.name; h.address = v.address;
        Backend.saveHostel(h.id, { name: v.name, address: v.address }).catch(e => toast(e.message, 'bad'));
      }
      return { pay: { upiId: v.upiId, payee: v.payee, phone: phone10(v.phone), bank: v.bank, email: String(v.email || '').trim() } };
    }, p.upiId ? `<a class="btn" href="${esc(payLink(1, 'Test'))}" target="_blank" rel="noopener">${ico('qr', 'sm')} ${esc(t('Test pay link'))}</a>` : '')}
    ${orgEnabled('cashfree') ? `    <div class="card" style="margin-top:16px">
      <h3>${ico('rupee', 'sm')} ${esc(t('Cashfree Multi-Owner Settlement (Easy Split)'))}</h3>
      <p class="muted sm" style="margin:4px 0 12px">${esc(t('Direct bank settlement: Rent collected via Cashfree UPI is automatically split and settled into your verified bank account.'))}</p>
      <div class="row" style="gap:8px">
        <button class="btn primary sm" data-act="onboardcf">${ico('check', 'sm')} ${esc(t('Configure Verified Bank Account'))}</button>
      </div>
    </div>` : ''}`;
  },
  pay: () => SETTINGS_PAGES.property(),
  rent: () => {
    const r = S().rent;
    const prevNov = calcCheckInRent({ checkInDate: '2026-11-15', monthlyRent: 8000, policy: r.prorate, divisor: r.prorateDivisor });
    return `${head('Rent & Billing Configuration', `${esc(t('Choose billing cycles, due dates, and mid-month check-in rules.'))}<br><br><b>${esc(t('Mid-Month Check-in Calculation Preview'))}</b><br>${esc(t('Example'))}: ${esc(t('Monthly rent ₹8,000, Joining 15 November'))} (${prevNov.totalDays} ${esc(t('calendar days'))})<br>           <b>${esc(t('First Bill'))}: ${inr(prevNov.amount)}</b> · ${prevNov.occupiedDays} ${esc(t('days'))} (${inr(prevNov.dailyRate)}/${esc(t('day'))})`)}
      ${settingsForm('rent', [
        { type: 'section', label: 'Billing Model' },
        { name: 'model', label: 'Billing cycle model', type: 'select', full: true, value: r.model || 'calendar_monthly',
          options: [
            { v: 'calendar_monthly', l: t('Fixed date (same day for everyone)') },
            { v: 'joining_date', l: t('Joining date (each tenant\'s own day)') }
          ],
          info: t('Calendar monthly generates bills on a fixed date (e.g. 1st). Anniversary billing generates bills on each tenant\'s joining date (e.g. 15th to 14th).')
        },
        { name: 'day', label: 'Rent bill day of month', type: 'number', min: 1, max: 28, value: r.day, required: true, showIf: v => v.model !== 'joining_date' },
        { name: 'dueDays', label: 'Rent is due after (days from bill date)', type: 'number', min: 1, max: 25, value: rentDueDays() },
        { type: 'section', label: 'Mid-Month Check-In Policy' },
        { name: 'prorate', label: 'First month policy', type: 'select', full: true, value: r.prorate === false ? 'full' : (typeof r.prorate === 'string' ? r.prorate : 'prorate'),
          options: [
            { v: 'prorate', l: t('Pro-rata (rent for days stayed)') },
            { v: 'full', l: t('Full month rent') },
            { v: 'next_cycle', l: t('Free first period (bill from next cycle)') }
          ]
        },
        { name: 'prorateDivisor', label: 'Pro-rata calculation divisor', type: 'select', full: true, value: r.prorateDivisor || 'actual_days', showIf: v => v.prorate === 'prorate',
          options: [
            { v: 'actual_days', l: t('Actual days of the month') },
            { v: 'fixed_30', l: t('Always 30 days') }
          ]
        },
        { type: 'section', label: 'What the monthly bill includes' },
        { name: 'includeElec', label: 'Add electricity to the monthly bill', type: 'checkbox', value: r.includeElec !== false, full: true, info: t('When monthly bills are made, each resident\'s electricity for that month is shown and added in the same bill. Turn it off if you collect electricity separately.') },
        { name: 'includeMess', label: 'Add mess fee to the monthly bill', type: 'checkbox', value: r.includeMess !== false, full: true, info: t('Adds the monthly mess fee for residents who take food. Works only when Mess is Compulsory or Optional (Settings > Mess & food).') },
        { name: 'includeCharges', label: 'Add extra charges to the monthly bill', type: 'checkbox', value: r.includeCharges !== false, full: true, info: t('Extra charges are things you set up yourself, like Wi-Fi, AC or parking (Settings > Extra charges). When this is on, they are added to every monthly bill.') }
      ], v => ({ rent: { ...S().rent, ...v, prorate: v.prorate === 'full' ? false : v.prorate } }))}`;
  },
  deposits_late: () => {
    const s = S(), dep = s.deposit || {}, late = s.lateFee || {};
    return `${head('Security Deposits & Late Fees', `${esc(t('Configure refundable deposits, deduction rules, and automated overdue late fees.'))}<br><br><b>${esc(t('Late Fee Calculation Preview'))}</b><br>${esc(t('Example'))}: ${esc(t('Rent ₹8,000, 10 days overdue with 5 days grace period.'))}<br>           <b>Fixed:</b> ₹200 · <b>Daily (₹50/d):</b> ₹250 · <b>Percentage (2%):</b> ₹160 (Capped at ₹1,000)`)}
      ${settingsForm('deposits_late', [
        { type: 'section', label: 'Security Deposit Rules' },
        { name: 'dep_mode', label: 'Deposit calculation mode', type: 'select', full: true, value: dep.mode || 'rent_multiple',
          options: [
            { v: 'rent_multiple', l: t('Months of rent (1 or 2 months)') },
            { v: 'fixed', l: t('Same amount for everyone') },
            { v: 'custom', l: t('Typed at check-in (each resident)') },
            { v: 'per_bed', l: t('Set per room / bed') }
          ]
        },
        { name: 'rentMultiplier', label: 'Deposit = monthly rent × how many months?', type: 'number', min: 1, max: 12, value: dep.rentMultiplier || 1, showIf: v => v.dep_mode === 'rent_multiple' },
        { name: 'fixedAmount', label: 'Fixed deposit amount (₹)', type: 'number', min: 0, max: 1000000, value: dep.fixedAmount || 0, showIf: v => v.dep_mode === 'fixed' },
        { type: 'html', key: 'dep_note_custom', html: `<div class="hint">${esc(t('The deposit is typed at check-in for each resident. The box starts with one month of rent.'))}</div>`, showIf: v => v.dep_mode === 'custom' },
        { type: 'html', key: 'dep_note_bed', html: `<div class="hint">${esc(t('Set the deposit per bed in each room (Rooms & Beds > edit room). A room with no amount starts at one month of rent.'))}</div>`, showIf: v => v.dep_mode === 'per_bed' },
        { name: 'nr_on', label: 'Charge a non-refundable admission / maintenance fee?', type: 'checkbox', value: (dep.nonRefundable || 0) > 0, full: true },
        { name: 'nonRefundable', label: 'Non-refundable fee amount (₹)', type: 'number', min: 0, max: 1000000, value: dep.nonRefundable || 0, full: true, showIf: v => v.nr_on },
        { type: 'section', label: 'Late Fee & Penalty Rules' },
        { name: 'late_on', label: 'Enable automatic late fees on overdue bills', type: 'checkbox', value: late.on !== false, full: true },
        { name: 'late_mode', label: 'Late fee calculation mode', type: 'select', full: true, value: late.mode || 'fixed', showIf: v => v.late_on,
          options: [
            { v: 'fixed', l: t('One fixed fee per bill') },
            { v: 'daily', l: t('Fee for every late day') },
            { v: 'percentage', l: t('% of the unpaid amount') }
          ]
        },
        { name: 'late_amount', label: 'Late fee per overdue bill, charged once (₹)', type: 'number', min: 0, max: 100000, value: late.amount || 200, showIf: v => v.late_on && v.late_mode === 'fixed' },
        { name: 'dailyAmount', label: 'Late fee for each day past the grace period (₹/day)', type: 'number', min: 0, max: 10000, value: late.dailyAmount || 50, showIf: v => v.late_on && v.late_mode === 'daily' },
        { name: 'percentage', label: 'Late fee as % of the unpaid balance', type: 'number', min: 0, max: 20, step: 0.1, value: late.percentage || 2, showIf: v => v.late_on && v.late_mode === 'percentage' },
        { name: 'graceDays', label: 'Late fee starts this many days after the due date', type: 'number', min: 0, max: 30, value: late.graceDays != null ? late.graceDays : 5, showIf: v => v.late_on },
        { name: 'maxCap', label: 'Maximum penalty cap (₹)', type: 'number', min: 0, max: 1000000, value: late.maxCap || 1000, showIf: v => v.late_on }
      ], v => ({
        deposit: { ...S().deposit, mode: v.dep_mode, rentMultiplier: +v.rentMultiplier || 1, fixedAmount: +v.fixedAmount || 0, nonRefundable: v.nr_on ? (+v.nonRefundable || 0) : 0 },
        lateFee: { ...S().lateFee, on: v.late_on, mode: v.late_mode, amount: +v.late_amount || 0, dailyAmount: +v.dailyAmount || 0, percentage: +v.percentage || 0, graceDays: +v.graceDays || 0, maxCap: +v.maxCap || 1000 },
        rent: { ...S().rent, lateOn: v.late_on, lateFee: +v.late_amount || 200 }
      }))}`;
  },
  elec_utils: () => {
    const e = S().elec;
    return `${head('Electricity & Utility Configuration', `${esc(t('Configure meter sharing arrangements, flat or tiered slab pricing, and free units allowances.'))}<br><br><b>${esc(t('Electricity Split Preview'))}</b><br>${esc(t('Example'))}: ${esc(t('Room uses 150 units between 2 residents, 30 free units/resident.'))}<br>           <b>${esc(t('Calculation'))}:</b> (75 − 30) = 45 billable units @ ₹${e.rate}/unit = <b>${inr(45 * e.rate)} ${esc(t('each'))}</b>`)}
      ${settingsForm('elec_utils', [
        { type: 'section', label: 'Meter Sharing Arrangement' },
        { name: 'sharing', label: 'Meter arrangement', type: 'select', full: true, value: e.sharing || 'shared_room',
          options: [
            { v: 'shared_room', l: t('Room meter (split in the room)') },
            { v: 'individual', l: t('Own meter per resident') },
            { v: 'property_level', l: t('Building meter (split by share)') }
          ]
        },
        { name: 'allocation', label: 'Sharing allocation method', type: 'select', full: true, value: e.allocation || 'daily_occupancy', showIf: v => v.sharing !== 'individual',
          options: [
            { v: 'daily_occupancy', l: t('Day by day (who stayed that day)') },
            { v: 'occupancy_days', l: t('By days stayed') },
            { v: 'equal', l: t('Equal split') }
          ]
        },
        { type: 'section', label: 'Pricing Model' },
        { name: 'pricing', label: 'Pricing model', type: 'select', full: true, value: e.pricing || 'fixed',
          options: [
            { v: 'fixed', l: t('Fixed rate (e.g. ₹9 per unit)') },
            { v: 'slab', l: t('Slabs (rate rises with units)') }
          ]
        },
        { name: 'rate', label: 'Rate per unit (₹)', type: 'number', min: 0, max: 1000, step: 0.01, value: e.rate, required: true, showIf: v => v.pricing !== 'slab' },
        { name: 'fixedCharge', label: 'Fixed monthly meter charge (₹)', type: 'number', min: 0, max: 100000, value: e.fixedCharge || 0 },
        { type: 'section', key: 'sec_slab', label: 'Tiered Slabs', showIf: v => v.pricing === 'slab' },
        { name: 'slab1_upTo', label: 'Slab 1 upper limit (units)', type: 'number', min: 1, max: 100000, value: (e.slabs && e.slabs[0] && e.slabs[0].upTo) || 100, showIf: v => v.pricing === 'slab' },
        { name: 'slab1_rate', label: 'Slab 1 rate (₹/unit)', type: 'number', min: 0, max: 1000, step: 0.01, value: (e.slabs && e.slabs[0] && e.slabs[0].rate) || 8, showIf: v => v.pricing === 'slab' },
        { name: 'slab2_upTo', label: 'Slab 2 upper limit (units)', type: 'number', min: 2, max: 100000, value: (e.slabs && e.slabs[1] && e.slabs[1].upTo) || 250, showIf: v => v.pricing === 'slab' },
        { name: 'slab2_rate', label: 'Slab 2 rate (₹/unit)', type: 'number', min: 0, max: 1000, step: 0.01, value: (e.slabs && e.slabs[1] && e.slabs[1].rate) || 10, showIf: v => v.pricing === 'slab' },
        { name: 'slab3_rate', label: 'Above Slab 2 rate (₹/unit)', type: 'number', min: 0, max: 1000, step: 0.01, value: (e.slabs && e.slabs[2] && e.slabs[2].rate) || 12, showIf: v => v.pricing === 'slab' },
        { type: 'section', label: 'Free Units & Reminders' },
        { name: 'freeUnits', label: 'Free units quota per month', type: 'number', min: 0, max: 5000, value: e.freeUnits },
        { name: 'freeMode', label: 'Free units applied to', type: 'select', full: true, value: e.freeMode, showIf: v => v.freeUnits > 0,
          options: [{ v: 'resident', l: t('Each resident gets them') }, { v: 'room', l: t('Shared by the room') }]
        },
        { name: 'readingDay', label: 'Reading reminder day of month', type: 'number', min: 1, max: 28, value: e.readingDay },
        { type: 'section', label: 'Meter Scanning & Submissions' },
        { name: 'scanRole', label: 'Who can enter meter readings', type: 'select', full: true, value: e.scanRole || 'both',
          options: [
            { v: 'both', l: t('Both residents & staff/warden') },
            { v: 'staff_only', l: t('Staff & warden only') },
            { v: 'resident_only', l: t('Residents only (staff approves)') }
          ]
        }
      ], v => saveElecUtilsSettings(v, e))}
      ${group('', li({ icon: 'bolt', ic: 'warn', t: t('Opening meter readings'), d: t('Enter initial meter numbers for rooms starting on Sarvlekh.'), act: 'go', attrs: 'data-to="settings/elecopen"' }))}`;
  },
  elec: () => SETTINGS_PAGES.elec_utils(),
  mess_food: () => {
    const ms = meals(), me = S().mess || {};
    return `${head('Mess & Food Configuration', `${esc(t('Configure meal subscription models, daily cut-offs, attendance rules, and leave rebates.'))}<br><br><b>${esc(t('Mess Policy Preview'))}</b><br><b>Compulsory:</b> Fixed ₹${me.monthlyFee || 2500}/month billed automatically.<br>           <b>Leave Rebate:</b> Resident on approved leave for 4 days receives ${inr((me.rebatePerDay || 80) * 4)} credit.`)}
      ${settingsForm('mess_food', [
        { type: 'section', label: 'Mess Billing Policy' },
        { name: 'billing', label: 'Billing model', type: 'select', full: true, value: me.billing || 'included',
          options: [
            { v: 'included', l: t('Included in rent') },
            { v: 'compulsory', l: t('Compulsory (billed monthly)') },
            { v: 'optional', l: t('Optional (resident chooses)') },
            { v: 'per_meal', l: t('Per meal (pay for meals eaten)') }
          ]
        },
        { name: 'monthlyFee', label: 'Monthly mess subscription fee (₹)', type: 'number', min: 0, value: me.monthlyFee || 2500, showIf: v => v.billing === 'compulsory' || v.billing === 'optional' },
        { name: 'rebatePerDay', label: 'Rebate per day for approved leave (₹/day)', type: 'number', min: 0, value: me.rebatePerDay || 80, showIf: v => v.billing === 'compulsory' || v.billing === 'optional' },
        { name: 'minLeaveDays', label: 'Minimum leave days required for rebate', type: 'number', min: 1, max: 15, value: me.minLeaveDays != null ? me.minLeaveDays : 2, showIf: v => v.billing === 'compulsory' || v.billing === 'optional' },
        { type: 'section', label: 'Daily Cut-offs & Options' },
        { name: 'skip', label: 'Residents can skip meals', type: 'checkbox', value: me.skip !== false },
        { name: 'tiffin', label: 'Residents can order packed tiffin', type: 'checkbox', value: me.tiffin !== false },
        { name: 'plates', label: 'Count plates served and guest plates', type: 'checkbox', value: me.plates === true, info: t('Switches on the "Mark plates served" and "Guests" buttons on the cooking plan. Real counts make the stock learning more accurate. Leave it off if you do not count plates.'), full: true },
        { name: 'trackStock', label: 'Dishes & recipes inventory tracking', type: 'checkbox', value: me.trackStock !== false, hint: t('Off = hides Dishes & recipes tab and recipe ingredient tracking.') },
        { name: 'learn', label: 'Auto-learn food consumption from purchases', type: 'checkbox', value: me.learn !== false, full: true }
      ], v => ({ mess: { ...S().mess, ...v } }))}
      ${group('Dishes & Daily Timings', [
        li({ icon: 'clock', ic: 'teal', t: t('Meal timings & skip cut-offs'), d: ms.map(m => `${t(m.l)} ${fmtTime(m.time)}`).join(' · '), act: 'go', attrs: 'data-to="settings/meals"' }),
        li({ icon: 'utensils', ic: 'warn', t: (can('kitchen') && me.trackStock !== false) ? t('Dishes & weekly menu') : t('Weekly menu'), d: (can('kitchen') && me.trackStock !== false) ? t('{n} dishes registered', { n: dishes().length }) : t('Set dishes for each day of the week'), act: 'go', attrs: 'data-to="settings/dishes"' }),
        ...((can('kitchen') && me.trackStock !== false) ? [li({ icon: 'box', ic: 'mute', t: t('Stock items & inventory'), d: t('{n} stock items', { n: items().length }), act: 'go', attrs: 'data-to="settings/items"' })] : [])
      ].join(''))}`;
  },
  checkin_out: () => {
    const s = S(), cin = s.checkin || {}, cout = s.checkout || {};
    return `${head('Check-in & Checkout Workflows', `${esc(t('Configure admission authorization, required KYC papers, and checkout notice settlements.'))}<br><br><b>${esc(t('Notice Shortfall Preview'))}</b><br>${esc(t('Required notice: {n} days.', { n: cout.noticeDaysRequired ?? 30 }))} ${esc(t('If resident gives 10 days notice, remaining 20 days rent is charged as shortfall deduction from deposit.'))}`)}
      ${settingsForm('checkin_out', [
        { type: 'section', label: 'Check-in Admission Rules' },
        { name: 'requireApproval', label: 'Admission approval required', type: 'select', full: true, value: cin.requireApproval || 'none',
          options: [
            { v: 'none', l: t('No approval (direct check-in)') },
            { v: 'manager', l: t('Manager approves first') },
            { v: 'owner', l: t('Owner approves first') }
          ]
        },
        { name: 'requireDocs', label: 'Require mandatory documents before admission', type: 'checkbox', value: cin.requireDocs || false },
        { name: 'minDepositRequired', label: 'Require security deposit before activating bed', type: 'checkbox', value: cin.minDepositRequired || false },
        { name: 'requireAgreement', label: 'Require digital agreement completion', type: 'checkbox', value: cin.requireAgreement || false, full: true },
        { type: 'section', label: 'Checkout & Notice Settlement' },
        { name: 'noticeDaysRequired', label: 'Mandatory notice period (days)', type: 'number', min: 0, max: 90, value: cout.noticeDaysRequired ?? 30, required: true },
        { name: 'shortfallPenalty', label: 'Deduct notice shortfall fee from deposit', type: 'checkbox', value: cout.shortfallPenalty !== false, full: true, showIf: v => v.noticeDaysRequired > 0 },
        { name: 'shortfallMode', label: 'The fee is', type: 'select', full: true, value: cout.shortfallMode || 'rent', showIf: v => v.noticeDaysRequired > 0 && v.shortfallPenalty,
          options: [{ v: 'rent', l: t('Rent of the missing days') }, { v: 'per_day', l: t('₹ for each missing day') }, { v: 'flat', l: t('One fixed amount') }] },
        { name: 'shortfallAmount', label: 'Fee amount (₹)', type: 'number', full: true, min: 0, max: 1000000, value: cout.shortfallAmount || '', showIf: v => v.noticeDaysRequired > 0 && v.shortfallPenalty && v.shortfallMode && v.shortfallMode !== 'rent',
          info: t('Per missing day, or the one amount charged when the notice is short.') },
        { name: 'roomInspection', label: 'Require room inspection before refund', type: 'checkbox', value: cout.roomInspection !== false, full: true }
      ], v => {
        if (v.noticeDaysRequired > 0 && v.shortfallPenalty && v.shortfallMode && v.shortfallMode !== 'rent' && !(+v.shortfallAmount > 0)) return 'Enter the fee amount';
        return {
        checkin: { ...S().checkin, requireApproval: v.requireApproval, requireDocs: v.requireDocs, minDepositRequired: v.minDepositRequired, requireAgreement: v.requireAgreement },
        checkout: { ...S().checkout, noticeDaysRequired: isNaN(v.noticeDaysRequired) ? 30 : v.noticeDaysRequired, shortfallPenalty: v.shortfallPenalty, shortfallMode: v.shortfallMode || 'rent', shortfallAmount: +v.shortfallAmount || 0, roomInspection: v.roomInspection }
      }; })}`;
  },
  staff_perms: () => {
    return `${head('Staff & Permissions Matrix')}
      <div class="card" style="margin-bottom:14px">
        <div style="font-weight:700;font-size:14px;margin-bottom:8px">${esc(t('Role Presets & Capabilities'))}</div>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:12px">
          <div><b style="color:var(--primary,#2563eb)">${esc(t('Owner'))}:</b> ${esc(t('Full control over financial settlements, invoice deletions, reversals, staff creation, and business rules.'))}</div>
          <div><b style="color:var(--ok,#16a34a)">${esc(t('Manager'))}:</b> ${esc(t('Tenant admissions, meter reading corrections, deposit refunds, purchases, and day-to-day operations.'))}</div>
          <div><b style="color:var(--warn,#d97706)">${esc(t('Warden'))}:</b> ${esc(t('Bed allocations, meter readings capture, visitor log, night roll call, and complaints handling.'))}</div>
          <div><b style="color:var(--mute,#64748b)">${esc(t('Kitchen / Staff'))}:</b> ${esc(t('Meal headcount, kitchen purchases, housekeeping tasks, gate register, without financial access.'))}</div>
        </div>
      </div>
      ${group('Staff Access & Attendance', [
        li({ icon: 'users', ic: 'pink', t: t('Manage user accounts & logins'), d: t('Create passwords and permissions for team'), act: 'go', attrs: 'data-to="settings/users"' }),
        li({ icon: 'clock', ic: 'teal', t: t('Staff attendance & punch-in geofencing'), d: settingSummary('staffatt'), act: 'go', attrs: 'data-to="settings/staffatt"' }),
        li({ icon: 'badge', ic: 'info', t: t('Departments'), d: S().departments.join(', '), act: 'go', attrs: 'data-to="settings/depts"' })
      ].join(''))}`;
  },
  agreements_comm: () => {
    const s = S(), agr = s.agreements || {};
    const tpls = agr.templates || DEFAULT_AGREEMENT_TEMPLATES;
    const wab = orgEnabled('automation');   // Meta API and bulk sending exist only for hostels the platform admin gave it to
    return `${head('Agreements & Communication')}
      ${wab ? `<div class="card" style="margin-bottom:14px">
        <div style="font-weight:700;font-size:14px;margin-bottom:6px">${esc(t('WhatsApp Messaging Modes'))}</div>
        <div style="font-size:12px;color:var(--text-mute,#64748b);line-height:1.5">
          <b>Mode 1 (Free Click-to-Chat):</b> Uses native <code>wa.me</code> links with prefilled text. Safe, free, zero API fees. Opens WhatsApp for each resident in sequential assistant.<br><br>
          <b>Mode 2 (Official Meta Cloud API):</b> Direct server delivery using Meta Graph API templates. Requires Meta WhatsApp Business account.
        </div>
      </div>` : ''}
      ${settingsForm('agreements_comm', [
        { type: 'section', label: 'Default Agreement Template' },
        { name: 'defaultTemplateId', label: 'Default rental agreement format', type: 'select', full: true, value: agr.defaultTemplateId || 'tpl-std',
          options: tpls.map(t => ({ v: t.id, l: t.name }))
        },
        ...(wab ? [{ type: 'section', label: 'WhatsApp Mode' },
        { name: 'wa_mode', label: 'WhatsApp delivery mode', type: 'select', full: true, value: s.wa.mode || 'click_to_chat',
          options: [
            { v: 'click_to_chat', l: t('Free (tap to send)') },
            { v: 'official_api', l: t('Meta WhatsApp API (automatic)') }
          ]
        }] : [])
      ], v => ({
        agreements: { ...S().agreements, defaultTemplateId: v.defaultTemplateId },
        ...(wab ? { wa: { ...S().wa, mode: v.wa_mode } } : {})
      }))}
      ${group('Communication Channels', [
        wab ? li({ icon: 'wa', ic: 'ok', t: t('WhatsApp gateway details'), d: s.wa.gw && s.wa.gw.on ? t('Gateway connected') : t('Self-hosted or Meta Cloud configuration'), act: 'go', attrs: 'data-to="settings/wa"' }) : '',
        li({ icon: 'shield', ic: 'bad', t: t('Police verification portal'), d: settingSummary('police'), act: 'go', attrs: 'data-to="settings/police"' }),
        li({ icon: 'file', ic: 'warn', t: t('Required KYC document checklist'), d: s.docs.required.join(', '), act: 'go', attrs: 'data-to="settings/docs"' })
      ].join(''))}`;
  },
  charges_services: () => {
    const list = S().charges || [], sm = chargesSummary(list);
    const scopeLbl = c => c.scope === 'rooms' ? (c.roomIds || []).length === 1 ? t('1 room') : t('{n} rooms', { n: (c.roomIds || []).length }) : c.scope === 'residents' ? (c.resIds || []).length === 1 ? t('1 resident') : t('{n} residents', { n: (c.resIds || []).length }) : c.scope === 'room' ? t('1 room') : t('Everyone');
    const row = c => `<div class="chg ${c.active ? '' : 'off'}" data-act="editcharge" data-id="${esc(c.id)}">
      <span class="chg-ic">${ico(c.frequency === 'monthly' ? 'cal' : 'bolt')}</span>
      <span class="chg-bd"><b>${esc(c.name)}</b><span class="chg-pills"><i>${esc(t(c.frequency === 'monthly' ? 'Every month' : 'One time'))}</i><i>${esc(scopeLbl(c))}</i></span></span>
      <span class="chg-amt">${inr(c.amount)}</span>
      <span class="chg-act" data-act="chgnoop">${c.frequency === 'onetime' && c.active ? btn('Bill now', 'chargebill', `data-id="${esc(c.id)}"`, 'sm') : ''}<label class="sw"><input type="checkbox" data-chgsw="${esc(c.id)}" ${c.active ? 'checked' : ''} aria-label="${esc(t('On'))}"><span></span></label></span>
    </div>`;
    const ideas = ['Wi-Fi', 'AC', 'Parking', 'Maintenance'];
    return `${head('Extra charges')}
      <div class="chg-hero">
        <div><small>${esc(t('Added to every monthly bill'))}</small><b>${inr(sm.everyone)}</b></div>
        <div class="chg-chips"><span>${sm.active} ${esc(t('on'))}</span><span>${sm.monthly} ${esc(t('monthly'))}</span>${sm.onetime ? `<span>${sm.onetime} ${esc(t('one-time'))}</span>` : ''}${sm.chosen ? `<span>${sm.chosen} ${esc(t('for some'))}</span>` : ''}</div>
      </div>
      <div class="row" style="margin:6px 2px 10px"><span class="group-t" style="padding:0">${esc(t('Charges'))}</span><span class="sp"></span>${btn('Add charge', 'addcharge', '', 'primary sm', 'plus')}</div>
      ${list.length ? `<div class="chg-list">${list.map(row).join('')}</div>`
        : `<div class="chg-empty"><b>${esc(t('No extra charges yet'))}</b><div class="chg-ideas">${ideas.map(x => `<button type="button" class="chip" data-act="addcharge" data-preset="${esc(x)}">+ ${esc(x)}</button>`).join('')}</div></div>`}
      ${group('Also billed', [
        li({ icon: 'shirt', ic: 'info', t: t('Laundry & free clothes'), d: settingSummary('laundry'), act: 'go', attrs: 'data-to="settings/laundry"' })
      ].join(''))}`;
  },
  staffatt: () => {
    const a = S().staffAtt;
    return `${head('Staff attendance & punch-in')}${settingsForm('staffatt', [
      { name: 'mode', label: 'Who marks attendance', type: 'select', full: true, value: a.mode,
        options: [{ v: 'manual', l: t('Owner / manager marks it') }, { v: 'self', l: t('Staff punch in on their phone') }, { v: 'both', l: t('Both (owner can correct)') }],
        info: t('With punch-in, staff who have a login are asked to mark attendance when they open the app, until they do. They can close the prompt.') },
      { type: 'section', key: 'sec_loc', label: 'Where attendance can be marked', showIf: v => v.mode !== 'manual' },
      { name: 'lat', label: 'Latitude', type: 'number', step: 0.000001, value: a.lat, placeholder: 'e.g. 25.1442', showIf: v => v.mode !== 'manual' },
      { name: 'lng', label: 'Longitude', type: 'number', step: 0.000001, value: a.lng, placeholder: 'e.g. 75.8468', showIf: v => v.mode !== 'manual' },
      { type: 'html', key: 'loc_btn', showIf: v => v.mode !== 'manual', html: `<div class="row">${btn('Use my current location', 'attgeo', '', 'sm', 'globe')}<span class="hint" id="attgeomsg"></span></div>` },
      { name: 'radius', label: 'Allowed distance (metres)', type: 'number', min: 20, max: 5000, value: a.radius || 150, showIf: v => v.mode !== 'manual',
        info: t('Stand at the hostel gate and tap "Use my current location". Leave latitude and longitude empty to allow punch-in from anywhere.') },
    ], v => {
      const lat = isNaN(v.lat) ? '' : v.lat, lng = isNaN(v.lng) ? '' : v.lng;
      if ((lat === '') !== (lng === '')) return 'Enter both latitude and longitude, or neither';
      if (lat !== '' && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) return 'That location looks wrong';
      return { staffAtt: { mode: v.mode, lat, lng, radius: Math.max(20, v.radius || 150) } };
    })}`;
  },
  // Migration: the meter number each room shows on the day the hostel moves to Sarvlekh. It is
  // saved as a zero-unit "opening" reading, so the first real reading bills only from here.
  elecopen: () => {
    const list = rooms();
    if (!list.length) return `${head('Opening meter readings')}${empty('No rooms yet', 'Add rooms first.')}`;
    return `${head('Opening meter readings', t('Type the number each meter shows today. The next reading is billed from this number — nothing is charged now. For a room that already has readings, enter a number only to restart billing from it.'))}
      <form class="card" id="elecopen" novalidate autocomplete="off"><div class="fgrid">
        ${fieldHtml({ name: 'date', label: 'Reading date', type: 'date', value: today(), required: true })}
        ${list.map(r => { const l = lastMeter(r.id); return fieldHtml({ name: 'o_' + r.id, label: `${t('Room')} ${r.no}${r.floor ? ' · ' + r.floor : ''}`, type: 'number', step: 0.1, min: 0, value: l && l.opening ? l.curr : '', placeholder: l ? `${t('last')} ${num(l.curr)}` : t('Meter number') }); }).join('')}
      </div><div class="ferr" id="elecopen_err"></div>
      <div class="row" style="margin-top:14px"><span class="sp"></span>${btn('Save opening readings', 'saveopening', '', 'primary')}</div></form>`;
  },
  laundry: () => { const l = S().laundry; return `${head('Laundry free clothes & rate')}${settingsForm('laundry', [
    { name: 'freePcs', label: 'Free clothes per resident per month', type: 'number', min: 0, max: 500, value: l.freePcs, required: true }, { name: 'rate', label: 'Charge per extra piece (₹)', type: 'number', min: 0, max: 1000, value: l.rate, required: true },
  ], v => ({ laundry: v }))}${about('Extra charges are added to the resident\'s bill automatically when clothes are received.')}`; },
  meals: () => { const ms = meals(), me = S().mess; return `${head('Meal timings & cut-offs')}
    ${settingsForm('meals', [
      ...ms.flatMap((m, i) => [
        { type: 'html', html: `<div class="row" style="padding:8px 2px 0"><span class="group-t" style="padding:0">${esc(t(m.l))}</span><span class="sp"></span>${ms.length > 1 ? btn('', 'delmeal', `data-k="${esc(m.k)}" aria-label="${esc(t('Remove'))}"`, 'sm ghost', 'trash') : ''}</div>` },
        { name: `l${i}`, label: 'Meal name', value: t(m.l), required: true, maxlength: 24, pattern: /^(?=.*[A-Za-zऀ-ॿ])[A-Za-zऀ-ॿ0-9 &'().\/-]{2,24}$/ }, { name: `time${i}`, label: 'Serving time', type: 'time', value: m.time },
        { name: `cut${i}`, label: 'Skip cut-off time', type: 'time', value: m.cutoff }, { name: `prev${i}`, label: 'Cut-off is on the previous day', type: 'checkbox', value: m.prev },
        { name: `tcut${i}`, label: 'Tiffin cut-off time', type: 'time', value: m.tCutoff }, { name: `tprev${i}`, label: 'Tiffin cut-off on the previous day', type: 'checkbox', value: m.tPrev },
      ]),
      { type: 'section', label: 'Options' },
      { name: 'skip', label: 'Residents can skip meals', type: 'checkbox', value: me.skip }, { name: 'tiffin', label: 'Residents can order tiffin (packed meal)', type: 'checkbox', value: me.tiffin },
      { name: 'learn', label: 'Learn real usage from purchases (recommended)', type: 'checkbox', value: me.learn, full: true },
    ], v => ({ meals: byTime(ms.map((m, i) => ({ ...m, l: v[`l${i}`] || m.l, time: v[`time${i}`], cutoff: v[`cut${i}`], prev: v[`prev${i}`], tCutoff: v[`tcut${i}`], tPrev: v[`tprev${i}`] }))), mess: { skip: v.skip, tiffin: v.tiffin, learn: v.learn } }),
    `${btn('Add meal (e.g. Snacks)', 'addmeal', '', 'sm')}`)}`; },
  dishes: () => {
    const rows = [
      ...(can('kitchen') ? [li({ icon: 'utensils', ic: 'warn', t: t('Dishes & recipes'), d: t('{n} dishes', { n: dishes().length }), act: 'messtab', attrs: 'data-tab="dishes"' })] : []),
      li({ icon: 'cal', ic: 'info', t: t('Weekly menu'), act: 'messtab', attrs: 'data-tab="menu"' }),
      ...(can('kitchen') ? [li({ icon: 'plus', ic: 'ok', t: t('Add dish'), act: 'adddish' })] : [])
    ];
    return `${head(can('kitchen') ? 'Dishes, recipes & menu' : 'Weekly menu')}${group('', rows.join(''), can('kitchen') ? t('When you create a dish you also enter its ingredients — they become stock items automatically.') : '')}`;
  },
  items: () => `${head('Stock items & units')}${group('Items', items().map(i => li({ icon: 'box', ic: 'mute', t: i.name, d: `${num(stockOf(i))} ${i.unit} · ${t('alert below')} ${i.min}`, act: 'edititem', attrs: `data-id="${i.id}"` })).join(''), `<a href="#" data-act="additem">+ ${esc(t('Add item'))}</a>`)}<div class="group-t">${esc(t('Units'))}</div>${listEditor('units', 'New unit (e.g. box)', ['kg', 'L', 'pcs'])}`,
  kitchen: () => { const k = S().kitchen; return `${head('Kitchen permissions')}${settingsForm('kitchen', [{ name: 'cookCanReceive', label: 'Cook can enter received goods', type: 'checkbox', value: k.cookCanReceive, full: true }], v => ({ kitchen: v }))}${about('Cooks can always raise purchase requests. Only you approve quantities.')}`; },
  accessories: () => {
    const on = (S().accessories || {}).on !== false;
    return `${head('Room accessories')}
      ${group('Checklist', [li({ icon: 'box', ic: on ? 'ok' : 'mute', t: t(on ? 'Accessories checklist is on' : 'Accessories checklist is off'), d: t('Switch off for a hostel that does not hand anything over.'), chev: false, end: `<label class="sw"><input type="checkbox" data-accsw ${on ? 'checked' : ''} aria-label="${esc(t('Accessories checklist'))}"><span></span></label>` })].join(''))}
      ${on ? `<div class="group-t">${esc(t('Items on the list'))}</div>${listEditor('accessories.items', 'New item e.g. Heater')}` : ''}`;
  },
  expcats: () => `${head('Expense categories')}${listEditor('expenseCats', 'New category', ['Groceries', 'Salary', 'Other'])}`,
  depts: () => `${head('Staff departments', t('Kitchen → cook login, Housekeeping → cleaning panel, Laundry → laundry panel, Security → gate panel.'))}${listEditor('departments', 'New department', ['Kitchen', 'Housekeeping', 'Laundry', 'Security'])}`,
  // Papers sit in a private bucket and are opened through ten-minute links; police papers are
  // asked for on the Police verification card, so they are not part of this list.
  docs: () => `${head('Documents', t('Saved privately, compressed. Only the owner and manager can open them.'))}
    ${group('', li({ icon: 'lock', ic: 'info', t: t('Deleted {n} days after checkout', { n: DOC_KEEP_DAYS }), d: t('Papers of residents who left, and of removed staff, are removed automatically.'), chev: false }))}
    <div class="group-t">${esc(t('Residents (asked at check-in)'))}</div>${listEditor('docs.required', 'e.g. Aadhaar card')}<div class="group-t">${esc(t('Staff'))}</div>${listEditor('staffDocs.required', 'e.g. Aadhaar card')}`,
  hk: () => { const h = S().hk; return `${head('Housekeeping rules')}${settingsForm('hk', [{ name: 'missedAfter', label: 'Mark tasks missed after', type: 'time', value: h.missedAfter },
    { name: 'markBy', label: 'Who can mark a room as cleaned', type: 'multi', full: true, value: h.markBy || ['staff', 'admin'],
      options: [{ v: 'staff', l: t('Assigned housekeeping staff') }, { v: 'admin', l: t('Owner / manager') }, { v: 'guard', l: t('Security guard / supervisor') }, { v: 'resident', l: t('Resident of that room') }] }],
    v => (v.markBy.length ? { hk: { missedAfter: v.missedAfter, markBy: v.markBy } } : 'Choose at least one'))}
    ${about('Residents confirm their own room cleaning, so staff are not asked for photos.')}`; },
  hkstaff: () => {
    const list = staffList().filter(s => s.dept === 'Housekeeping' || s.role === 'housekeeping'), removed = Store.all('staff').filter(s => s.status === 'removed' && s.dept === 'Housekeeping');
    return `${head('Housekeeping staff', t('Deactivate to pause, remove to hide. Past cleaning records are always kept.'), btn('Add', 'addhk', '', 'primary', 'plus'))}
      ${group('Team', list.map(s => { const today_ = hkTasks().filter(x => x.date === today() && x.staffId === s.id); return `<div class="li">${avatar(s.name)}<span class="body"><span class="t">${esc(s.name)} ${s.status === 'active' ? '' : badge('Inactive')}</span><span class="d">${esc(s.phone || '')}${s.username ? ' · @' + esc(s.username) : ` · ${esc(t('no login'))}`} · ${esc(t('Today'))} ${today_.filter(x => x.status === 'done').length}/${today_.length}</span></span><span class="end">${btn('', 'staffedit', `data-id="${s.id}" aria-label="${esc(t('Edit'))}"`, 'sm', 'edit')}${staffSw(s)}${s.status !== 'active' ? btn('', 'staffremove', `data-id="${s.id}" aria-label="${esc(t('Remove'))}"`, 'sm bad', 'trash') : ''}</span></div>`; }).join(''))}
      ${removed.length ? group('Removed (history kept)', removed.map(s => li({ icon: 'user', ic: 'mute', t: s.name, d: t('Removed on {d}', { d: fmtDate(s.removedOn) }), end: btn('Restore', 'staffrestore', `data-id="${s.id}"`, 'sm') })).join('')) : ''}
      ${group('', li({ icon: 'cal', ic: 'info', t: t('Room & floor assignments'), d: t('Set in schedules — each room can have its own staff.'), act: 'go', attrs: 'data-to="housekeeping"' }))}`;
  },
  wa: () => {
    const w = S().wa, L = w.lang === 'hi' ? 'hi' : 'en';
    return `${head('WhatsApp messages')}
      ${settingsForm('wa', [{ name: 'auto', label: 'Open WhatsApp automatically after check-in, payment, laundry', type: 'checkbox', value: w.auto, full: true }, { name: 'lang', label: 'Message language', type: 'select', options: [{ v: 'en', l: 'English' }, { v: 'hi', l: 'हिन्दी' }, { v: 'auto', l: t('Each resident\'s choice') }], value: w.lang }], v => ({ wa: { auto: v.auto, lang: v.lang } }))}
      <div class="group-t">${esc(t('Payment reminders'))}</div>
      ${settingsForm('remind', [
        { name: 'on', label: 'Remind residents who have not paid', type: 'checkbox', value: w.remind.on !== false, full: true },
        { name: 'days', label: 'Days after the due date', value: (w.remind.days || [1, 5, 10]).join(', '), placeholder: '1, 5, 10', showIf: v => v.on,
          info: t('One reminder at each of these days after the oldest unpaid bill was due. Each is sent only once.') },
      ], v => {
        const days = [...new Set(v.days.split(/[\s,]+/).filter(Boolean).map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 60).sort((a, b) => a - b);
        if (v.on && !days.length) return 'Enter at least one day, e.g. 1, 5, 10';
        return { wa: { remind: { on: v.on, days } } };
      })}
      ${orgEnabled('automation') ? `      <div class="group-t">${esc(t('Monthly bill'))}${tip(esc(t('The only message sent automatically once WhatsApp is connected: each resident gets ONE message a month with rent and electricity together. It goes out after the room’s meter is read. Everything else (welcome, receipts, notices, reminders) opens WhatsApp for you to press Send.')))}</div>
      ${settingsForm('monthly', [
        { name: 'on', label: 'Send each resident one monthly bill (rent + electricity)', type: 'checkbox', value: (w.monthly || {}).on !== false, full: true },
        { name: 'fallbackDay', label: 'Send anyway from this day of the month', type: 'number', min: 1, max: 28, value: (w.monthly || {}).fallbackDay || 10, showIf: v => v.on, info: t('If a room’s meter has not been read by this day, the bill goes with rent only so the rent is not held up.') },
      ], v => ({ wa: { monthly: { on: v.on, fallbackDay: Math.min(28, Math.max(1, Math.round(+v.fallbackDay || 10))) } } }))}
      <div class="group-t">${esc(t('WhatsApp Messaging Mode'))}${tip(esc(t('WhatsApp Cloud Automation is controlled by Super Admin to manage Meta message costs. When ON, 1 consolidated monthly bill (Rent + Electricity + Dynamic UPI QR) is dispatched automatically.')))}</div>
      <div class="card">
        <div class="row sb nw">
          <span class="body">
            <b>${esc(orgEnabled('automation') ? t('WhatsApp Cloud Automation: Active') : t('1-Tap Manual WhatsApp Mode'))}</b>
            <span class="d" style="display:block">
              ${esc(orgEnabled('automation')
                ? t('Managed by Platform · 1 consolidated monthly bill (Rent + Electricity + Extras + UPI QR) is sent automatically each billing cycle.')
                : t('Zero platform cost · Tap "Open WhatsApp" to send pre-filled bills and receipts via WhatsApp Web/App.'))}
            </span>
          </span>
          ${badge(orgEnabled('automation') ? 'Cloud Auto' : '1-Tap Free', orgEnabled('automation') ? 'ok' : 'info')}
        </div>
      </div>
` : ''}
      ${group(t('Templates ({l})', { l: L === 'hi' ? 'हिन्दी' : 'English' }), Object.entries(WA_KEYS).map(([k, l]) => li({ icon: 'chat', ic: (w.tpl[L] || {})[k] ? 'warn' : 'ok', t: t(l), d: (w.tpl[L] || {})[k] ? t('Customised') : t('Default'), act: 'edittpl', attrs: `data-k="${k}" data-l="${L}"` })).join(''), t('Placeholders like {name}, {total}, {paylink} are filled in automatically.'))}`;
  },
  police: () => {
    const p = S().police, cur = p.state || '';
    const link = pvPortal(cur);
    const pending = pvPending();
    return `${head('Police verification')}
      ${settingsForm('police', [
        { name: 'on', label: 'Track police verification for every resident', type: 'checkbox', value: p.on !== false, full: true },
        { name: 'state', label: 'State', type: 'select', value: cur, showIf: v => v.on,
          options: [{ v: '', l: t('Choose your state') }].concat(PV_STATES.map(([k, l]) => ({ v: k, l: t(l) }))) },
        { name: 'dueDays', label: 'Remind me if not submitted within (days)', type: 'number', min: 1, max: 90, value: p.dueDays || 7, showIf: v => v.on },
        { name: 'url', label: 'Portal link for this state', value: link, full: true, placeholder: 'https://…', showIf: v => v.on && !!v.state,
          info: t('Filled in automatically when you pick a state. If the government changes its website, paste the new link here — every resident uses it from then on.') },
      ], v => {
        if (v.url && !/^https:\/\//i.test(v.url)) return 'The link must start with https://';
        const portals = { ...(p.portals || {}) };
        const builtIn = (PV_STATES.find(x => x[0] === v.state) || [])[2] || '';
        if (v.state) { if (v.url && v.url !== builtIn) portals[v.state] = v.url; else delete portals[v.state]; }
        return { police: { on: v.on, state: v.state, dueDays: Math.max(1, v.dueDays || 7), portals } };
      })}
      ${link ? `<div class="group-f" style="margin-top:10px"><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(t('Open {s} portal', { s: pvStateName(cur) || t('police') }))}</a></div>` : ''}
      ${group(t('Waiting ({n})', { n: pending.length }), pending.slice(0, 12).map(r => li({
          icon: 'shield', ic: 'bad', t: r.name,
          d: t('Checked in {d} · {n} days ago', { d: fmtShort(r.checkIn), n: diffDays(today(), r.checkIn) }),
          act: 'go', attrs: `data-to="residents/${r.id}"` })).join(''))}
      ${about('No Indian state offers an API for this, so the form is still filled in on the police website. Sarvlekh opens the right site, hands you the details to paste, and files whatever comes back into the resident folder.')}`;
  },
  // Roll calls are a list the owner owns: add, rename, re-time, delete. Everything else about
  // attendance follows from it, which is why there is nothing else on this screen.
  attend: () => {
    const a = S().attend, ps = attPeriods();
    const rows = ps.flatMap((x, i) => [
      { type: 'section', label: `${t('Roll call')} ${i + 1}` },
      { name: `l${i}`, label: 'Name', value: x.l, placeholder: 'e.g. Night roll call' },
      { name: `t${i}`, label: 'Time', type: 'time', value: x.time },
    ]);
    return `${head('Attendance & roll call')}
      ${settingsForm('attend', [
        { name: 'on', label: 'Take attendance in this hostel', type: 'checkbox', value: a.on !== false, full: true,
          hint: t('Off = the Attendance screen disappears for everyone. Nothing already recorded is deleted.') },
        ...rows,
      ], v => {
        const periods = ps.map((x, i) => ({ ...x, l: String(v[`l${i}`] || x.l).trim() || x.l, time: v[`t${i}`] || x.time }));
        if (v.on && !periods.length) return 'Add at least one roll call, or switch attendance off.';
        return { attend: { on: v.on, periods } };
      }, `${btn('Add a roll call', 'attaddp', '', 'sm', 'plus')}${ps.length > 1 ? btn('Remove last', 'attdelp', '', 'sm bad', 'minus') : ''}`)}
      ${ps.length ? group('How it will look', ps.map(x => li({ icon: 'clock', ic: 'teal', t: t(x.l), d: x.time ? fmtTime(x.time) : t('No time set'), chev: false })).join(''), t('A resident who misses any roll call counts as absent for that day in the monthly summary.')) : ''}
      ${about('Only absences are stored, so a year of attendance for a full hostel is a few hundred small records — it costs you nothing in database space.')}`;
  },
  // Two QR codes, one screen. Print them, stick them up, WhatsApp them — the point of both
  // is that the person in front of you types their own details into their own phone.
  qr: () => {
    const on = joinOn(), vOn = (S().gate || {}).selfEntry !== false, n = pendingSignups().length;
    return `${head('QR codes')}
      ${group('Residents', [
        li({ icon: 'userplus', ic: on ? 'ok' : 'mute', t: t(on ? 'Self check-in is on' : 'Self check-in is off'),
            d: t('Name, ID and documents'), chev: false,
            end: `<label class="sw"><input type="checkbox" data-joinsw ${on ? 'checked' : ''} aria-label="${esc(t('Self check-in'))}"><span></span></label>` }),
        li({ icon: 'qr', ic: 'teal', t: t('Registration QR'), d: t('Print or send on WhatsApp'), act: 'joinqr' }),
        li({ icon: 'inbox', ic: n ? 'warn' : 'mute', t: t('Waiting to be admitted'),
            d: n ? t('{n} applications', { n }) : t('Nothing waiting'),
            act: 'go', attrs: 'data-to="residents"', end: n ? badge(String(n), 'warn') : '' }),
      ].join(''))}
      ${group('Visitors', [
        li({ icon: 'door', ic: vOn ? 'ok' : 'mute', t: t('Visitor self-entry'), d: t(vOn ? 'On' : 'Off - only the guard enters'), chev: false,
            end: `<label class="sw"><input type="checkbox" data-gatesw="selfEntry" ${vOn ? 'checked' : ''} aria-label="${esc(t('Visitor self-entry'))}"><span></span></label>` }),
        li({ icon: 'qr', ic: 'teal', t: t('Gate QR'), d: t('Print it for the gate'), act: 'gateqr' }),
      ].join(''))}`;
  },
  gate: () => {
    const vOn = (S().gate || {}).selfEntry !== false;
    return `${head('Gate & visitors', t('The gate register only records visitors coming in. There is no exit or resident in/out entry.'))}
      ${group('Register', [
        li({ icon: 'shield', ic: vOn ? 'tn2' : 'mute', t: t('Visitor self-entry'), d: t(vOn ? 'On: visitors fill their own details on their phone.' : 'Off: only the guard can enter visitors.'), chev: false,
          end: `<label class="sw"><input type="checkbox" data-gatesw="selfEntry" ${vOn ? 'checked' : ''} aria-label="${esc(t('Visitor self-entry'))}"><span></span></label>` }),
      ].join(''))}
      ${group('Visitor QR', [
        li({ icon: 'qr', ic: 'tn1', t: t('Show the visitor QR'), d: t('Print it and put it at the gate'), act: 'gateqr' }),
        li({ icon: 'door', ic: 'tn0', t: t('Open the gate register'), act: 'go', attrs: 'data-to="gate"' }),
      ].join(''))}`;
  },
  /* The owner's own page, edited in pieces rather than as one giant form: a hostel fills this
   * in over a week, between other work, and a half-finished page is never published by
   * accident — the switch at the top refuses until the basics are there. */
  site: () => {
    const c = siteCfg(), gaps = siteGaps(), live = c.on === true;
    const rt = c.roomTypes || [], faq = c.faq || [], fac = c.facilities || [], st = c.stats || [];
    const link = siteUrl(), shortLink = link.replace(/^https?:\/\//, '');
    return `${head('Hostel page for enquiries')}
      ${(() => {
        const steps = [[t('About the hostel'), !!c.about], [t('A room with its price'), rt.length > 0], [t('Header photo'), !!sitePhotoUrl('hero')], [t('WhatsApp number'), !!siteWa()]];
        const dn = steps.filter(x => x[1]).length, pc = Math.round(dn / steps.length * 100);
        return `<div class="sph">
          <div class="sph-top"><div class="sph-ring" style="--p:${pc}"><b>${pc}<small>%</small></b></div>
            <div class="sph-t"><b>${esc(live ? t('Your page is live') : pc === 100 ? t('Ready to publish') : t('Set up your page'))}</b><span>${esc(live ? t('Anyone with the link can see it') : pc === 100 ? t('Switch it on when you are happy') : t('{n} of {m} basics done', { n: dn, m: steps.length }))}</span></div>
            <label class="sw sph-sw"><input type="checkbox" data-sitesw ${live ? 'checked' : ''} aria-label="${esc(t('Publish'))}"><span></span></label></div>
          <div class="sph-steps">${steps.map(x => `<span class="sps ${x[1] ? 'ok' : ''}">${ico(x[1] ? 'check' : 'plus', 'xs')} ${esc(x[0])}</span>`).join('')}</div>
          <button type="button" class="sph-link" data-act="sitecopy">${ico('link', 'sm')}<span>${esc(shortLink)}</span><em>${esc(t('Copy'))}</em></button>
          <div class="sph-acts"><button type="button" class="btn" data-act="sitepreview">${ico('eye', 'sm')} ${esc(t('Preview'))}</button>${live ? `<button type="button" class="btn" data-act="siteqr">${ico('qr', 'sm')} ${esc(t('QR code'))}</button>` : ''}</div>
        </div>`; })()}
      ${settingsForm('site', [
        { type: 'section', label: 'Address of the page' },
        { name: 'slug', label: 'Web address', value: siteSlug(), hint: siteDomain() ? `…${'.'}${siteDomain()}` : siteBase() ? `${siteBase().replace(/^https?:\/\//, '')}/h/…` : t('Used once your domain is connected.'),
          info: t('Lowercase letters, numbers and dashes. This is the part of the link that is your hostel’s name, so keep it short and easy to say on the phone.') },
        { type: 'section', label: 'Top of the page' },
        { name: 'tagline', label: 'Line under the name', value: c.tagline, placeholder: 'e.g. Luxury Boys PG' },
        { name: 'badge', label: 'Small badge', value: c.badge, placeholder: 'e.g. Premium Boys PG in Jaipur' },
        { name: 'headline', label: 'Headline', value: c.headline, full: true, hint: t('e.g. "Luxury AC Boys PG in Tonk Phatak, Jaipur". Everything after the word "in" is shown in gold.') },
        { name: 'sub', label: 'Short line under the headline', type: 'textarea', value: c.sub, full: true, placeholder: 'Optional - the first sentence of the description is used if empty' },
        { type: 'section', label: 'About the hostel' },
        { name: 'aboutTitle', label: 'About heading', value: c.aboutTitle, full: true, placeholder: 'e.g. A Premium Boys PG Designed for Your Comfort' },
        { name: 'about', label: 'Description', type: 'textarea', value: c.about, full: true, placeholder: 'Who it is for and what makes it good' },
        { name: 'ratingScore', label: 'Google rating (out of 5)', type: 'number', min: 0, max: 5, step: 0.1, value: c.ratingScore, placeholder: 'Optional' },
        { name: 'ratingText', label: 'Rating note', value: c.ratingText, placeholder: 'e.g. Rated by 330+ guests on Google' },
        { type: 'section', label: 'Location & contact' },
        { name: 'area', label: 'Area / landmark', value: c.area, placeholder: 'e.g. Tonk Phatak, Jaipur' },
        { name: 'address', label: 'Full address', type: 'textarea', value: c.address, full: true, placeholder: 'Empty = the hostel address' },
        { name: 'mapLatLng', label: 'Map location (latitude, longitude)', value: c.mapLatLng, full: true,
          hint: t('e.g. 26.9124, 75.7873 — in Google Maps press and hold on your hostel, then tap the numbers to copy them. The “Get Directions” button then opens Google Maps and starts navigation straight away.') },
        { name: 'mapUrl', label: 'Google Maps link', value: c.mapUrl, full: true, hint: t('Optional. Used if you leave the location above blank. A full link (not a short maps.app.goo.gl one) also gives one-tap navigation.') },
        { name: 'wa', label: 'WhatsApp number for enquiries', type: 'tel', value: c.wa, placeholder: 'Empty = the hostel number' },
        { name: 'callNo', label: 'Call number', type: 'tel', value: c.callNo, placeholder: 'Empty = the WhatsApp number' },
      ], v => {
        const sl = String(v.slug || '').trim().toLowerCase();
        if (siteSlugProblem(sl)) return siteSlugProblem(sl);
        if (v.mapUrl && !/^https?:\/\//i.test(v.mapUrl)) return 'The map link must start with https://';
        const ll = String(v.mapLatLng || '').trim();
        if (ll && !/^-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(ll)) return 'The map location must look like 26.9124, 75.7873';
        if (v.wa && phone10(v.wa).length !== 10) return 'Enter a 10-digit mobile number';
        if (v.callNo && phone10(v.callNo).length !== 10) return 'Enter a 10-digit mobile number';
        const rs = v.ratingScore === '' || v.ratingScore == null || isNaN(v.ratingScore) ? '' : String(Math.min(5, Math.max(0, +v.ratingScore)));
        return sitePatch({ slug: sl, tagline: (v.tagline || '').trim(), badge: (v.badge || '').trim(), headline: v.headline, sub: (v.sub || '').trim(), aboutTitle: (v.aboutTitle || '').trim(), about: v.about,
          ratingScore: rs, ratingText: (v.ratingText || '').trim(), area: v.area, address: (v.address || '').trim(), mapLatLng: ll.replace(/\s+/g, ''), mapUrl: v.mapUrl, wa: phone10(v.wa), callNo: phone10(v.callNo) });
      })}
      ${group('Photos', [...SITE_PHOTOS, ...siteGalleryKeys().filter(k => +k.slice(1) > 6).map(k => [k, `${t('Gallery photo')} ${k.slice(1)}`, ''])].map(([k, label, hint]) => {
        const url = sitePhotoUrl(k, 160), set = !!url;
        return `<div class="li">
          <span class="ic ${set ? '' : 'mute'}" ${set ? 'style="padding:0;overflow:hidden"' : ''}>${set ? `<img src="${esc(url)}" alt="" class="thumb" loading="lazy">` : ico('camera')}</span>
          <span class="body"><span class="t">${esc(t(label))}${k === 'hero' ? ' ' + badge('Header', 'acc') : ''}</span>
            <span class="d ell">${set ? esc(sitePhotoRaw(k)) : esc(t(hint || 'Not added yet'))}</span></span>
          <span class="end">${btn(set ? 'Change' : 'Add link', 'sitephoto', `data-k="${k}"`, 'sm' + (set ? '' : ' primary'))}${set ? btn('', 'sitephotodel', `data-k="${k}" aria-label="${esc(t('Remove'))}"`, 'sm bad', 'trash') : ''}</span></div>`;
      }).join('') + (siteNextPhotoKey() ? `<div class="li noic"><span class="body"><a href="#" data-act="sitephoto" data-k="${siteNextPhotoKey()}">+ ${esc(t('Add another photo (link)'))}</a></span></div>` : ''), t('Nothing is uploaded. Put your photos in a Google Drive folder shared as \u201cAnyone with the link\u201d, then paste each photo\u2019s share link here \u2014 we only keep the link. You can add as many gallery photos as you like, one link at a time.'))}
      ${group('Rooms & price', rt.map((x, i) => li({ icon: 'bed', ic: 'info', t: `${x.l} · ${inr(x.price)}`, d: x.note || t('per bed, per month'), act: 'siterte', attrs: `data-i="${i}"` })).join('')
        + `<div class="li noic"><span class="body"><a href="#" data-act="siterte">+ ${esc(t('Add a room type'))}</a></span></div>`)}
      ${group('Facilities', fac.map((x, i) => `<div class="li noic"><span class="body"><span class="t">${esc(x)}</span></span>${btn('', 'sitefacd', `data-i="${i}" aria-label="${esc(t('Delete'))}"`, 'sm ghost', 'trash')}</div>`).join('')
        + `<div class="li noic"><input id="site_fac" placeholder="${esc(t('Wi-Fi, hot water, CCTV…'))}" style="flex:1"><button class="btn sm primary" data-act="sitefaca">${esc(t('Add'))}</button></div>`
        + `<div class="li noic"><span class="body"><span class="d">${esc(t('Quick add'))}</span><div class="row wrap" style="gap:6px;margin-top:6px">${SITE_FAC_IDEAS.filter(x => !fac.some(f => f.toLowerCase() === x.toLowerCase())).map(x => `<button class="chip" type="button" data-act="sitefacq" data-v="${esc(x)}">+ ${esc(x)}</button>`).join('')}</div></span></div>`,
        t('The first three also appear as badges at the top. Add a detail in brackets to show it small under the name, e.g. All Meals (Breakfast, Lunch & Dinner).'))}
      ${group('Key numbers', st.map((x, i) => li({ icon: 'bolt', ic: 'teal', t: `${x.v} · ${x.l}`, act: 'sitestat', attrs: `data-i="${i}"` })).join('')
        + (st.length < 4 ? `<div class="li noic"><span class="body"><a href="#" data-act="sitestat">+ ${esc(t('Add a number'))}</a></span></div>` : ''),
        t('The dark bar under the photos, e.g. "330+ · Happy residents". Up to four. Leave empty to show your price, room types and facilities instead.'))}
      ${group('Common questions', faq.map((x, i) => li({ icon: 'chat', ic: 'teal', t: x.q, d: x.a, act: 'sitefaqe', attrs: `data-i="${i}"` })).join('')
        + `<div class="li noic"><span class="body"><a href="#" data-act="sitefaqe">+ ${esc(t('Add a question'))}</a></span></div>`)}`;
  },
  data: () => `${head('Backup & export')}${group('', [li({ icon: 'download', ic: 'ok', t: t('Download full backup (JSON)'), d: t('{n} records', { n: Store.docs.size }), act: 'backup' }), li({ icon: 'download', ic: 'info', t: t('Residents (CSV)'), act: 'exportres' }), li({ icon: 'download', ic: 'warn', t: t('Payments (CSV)'), act: 'exportpay' }), li({ icon: 'download', ic: 'pink', t: t('Expenses (CSV)'), act: 'exportexp' }), li({ icon: 'sync', ic: 'mute', t: t('Sync now'), act: 'syncnow' })].join(''))}${!CLOUD ? group('Demo', li({ icon: 'trash', ic: 'bad', t: t('Reset demo data'), act: 'resetdemo' })) : ''}${CLOUD && isDemoHostel() && isSuper() ? group('Demo hostel', [li({ icon: 'layers', ic: 'ok', t: t('Fill with demo data'), d: t('Rooms, residents, bills, payments, kitchen, laundry, staff and more — all made up. Phone numbers are fake, so nothing can reach a real person.'), act: 'demofill' }), li({ icon: 'trash', ic: 'bad', t: t('Wipe all demo data'), d: t('Deletes every record in this demo hostel so you can fill it again.'), act: 'demowipe' })].join(''), t('Only the platform admin sees this, and only on a hostel marked as the demo.')) : ''}`,
  users: () => usersPage(),
};
A.messtab = el => {
  const tab = el.dataset.tab;
  ui.tab.mess = (tab === 'dishes' && !can('kitchen')) ? 'today' : tab;
  go('mess');
};
// The key is minted the first time the QR is shown, so a hostel that never uses this has no
// public door open at all. Regenerating it makes every copy already handed out stop working.
// One QR per hostel, made the first time it is shown. There is no "new QR": the printed one stays valid.
function qrSheet(title, url, caption, actions) {
  sheet(title, `<div class="qrp">
    <div class="qrp-frame"><div class="qr">${qrSvg(url, 6)}</div></div>
    <div class="qrp-name">${esc(hostelName())}</div>
    <div class="qrp-cap">${esc(t(caption))}</div>
    <button type="button" class="qrp-link" data-act="${actions.copy}">${ico('link', 'sm')}<span>${esc(url.replace(/^https?:\/\//, ''))}</span>${ico('copy', 'sm')}</button>
    <div class="qrp-acts">${actions.html}</div>
  </div>`);
}
A.joinqr = async () => {
  if (!isAdmin()) return toast('Only the owner or manager can manage this QR', 'bad');
  if (!joinKey()) await Store.saveSettings({ join: { on: true, key: newQrKey() } });
  if (typeof qrcode !== 'function') await loadScript('/vendor/qrcode.js').catch(() => {});
  qrSheet('Registration QR', joinUrl(), 'Scan to apply', { copy: 'joinqrcopy', html: `${btn('Print', 'print', '', '', 'download')}${btn('WhatsApp', 'joinqrwa', '', 'wa', 'wa')}` });
};
A.joinqrcopy = async () => { try { await navigator.clipboard.writeText(joinUrl()); toast('Link copied'); } catch (e) { sheet('Link', `<pre class="pre-wrap">${esc(joinUrl())}</pre>`); } };
A.joinqrwa = () => { waOpen('', `${t('Hello')},\n\n${t('Please fill in your details for')} *${hostelName()}* ${t('using this link')}:\n${joinUrl()}\n\n${t('Regards')},\n${hostelName()}`, 'Send the form'); };
document.addEventListener('change', async e => {
  if (!e.target.hasAttribute || !e.target.hasAttribute('data-accsw')) return;
  const want = e.target.checked, cur = clone(S().accessories || {});
  try { await Store.replaceSettingsKey('accessories', { items: accItemsRaw(cur), ...cur, on: want }); toast(want ? 'Switched on' : 'Switched off'); render(); }
  catch (err) { e.target.checked = !want; toast(err.message, 'bad'); }
});
const accItemsRaw = c => (Array.isArray(c.items) ? c.items : []);
document.addEventListener('change', async e => {
  if (!e.target.hasAttribute || !e.target.hasAttribute('data-gatesw')) return;
  const key = e.target.getAttribute('data-gatesw'), want = e.target.checked;
  try { await Store.saveSettings({ gate: { [key]: want } }); toast(want ? 'Switched on' : 'Switched off'); render(); }
  catch (err) { e.target.checked = !want; toast(err.message, 'bad'); }
});
document.addEventListener('change', async e => {
  if (!e.target.hasAttribute || !e.target.hasAttribute('data-joinsw')) return;
  const want = e.target.checked;
  try { await Store.saveSettings({ join: { on: want, key: joinKey() || newQrKey() } }); toast(want ? 'Self check-in on' : 'Self check-in off'); render(); }
  catch (err) { e.target.checked = !want; toast(err.message, 'bad'); }
});
// The key is what stored attendance points at, so it is generated once and never reused:
// renaming "Night" to "Gate check" must not orphan the absences already recorded under it.
A.attaddp = async () => {
  const ps = attPeriods();
  const used = new Set(ps.map(x => x.k));
  let k = 'p' + (ps.length + 1), n = ps.length + 1;
  while (used.has(k)) k = 'p' + (++n);
  await Store.saveSettings({ attend: { on: true, periods: [...ps, { k, l: `Roll call ${ps.length + 1}`, time: '21:00' }] } }, ['attend']);
  toast('Roll call added'); render();
};
A.attdelp = () => {
  const ps = attPeriods(); if (ps.length < 2) return toast('Keep at least one roll call', 'bad');
  const last = ps[ps.length - 1];
  confirmBox(t('Remove "{n}"? Attendance already recorded for it is kept but no longer shown.', { n: t(last.l) }), async () => {
    await Store.saveSettings({ attend: { on: S().attend.on !== false, periods: ps.slice(0, -1) } }, ['attend']);
    toast('Roll call removed');
  }, 'Remove', 'bad');
};
A.addhk = () => { staffForm({ status: 'active', dept: 'Housekeeping' }); };
A.staffrestore = el => { Store.patch(el.dataset.id, { status: 'inactive' }); render(); };
// The gateway's address and key go to /api/wa and are kept server-side; settings only learn on/off.
A.wagwsave = async el => {
  const f = $('#wagw'), err = $('#wagw_err'), v = n => f.elements[n].value.trim();
  err.textContent = ''; el.disabled = true;
  try {
    await Cloud.waApi('save', { hostel_id: Store.ctx.hostelId, kind: v('kind'), url: v('url'), session: v('session'), api_key: v('key'), test_phone: v('test') || undefined });
    await Store.saveSettings({ wa: { gw: { on: true, kind: v('kind') } } });
    toast(v('test') ? 'Test message sent — gateway connected' : 'Gateway saved'); render();
  } catch (e) { err.textContent = t(e.message); } finally { el.disabled = false; }
};
/* "Connect WhatsApp": the server makes this hostel's instance on the shared gateway and returns a
 * QR. We show it, poll until the owner's phone has scanned it, then switch automatic sending on.
 * The QR is refreshed every ~20 s because WhatsApp retires each one after about 45 s. */
A.wagwconnect = async () => {
  openModal({ title: t('Connect WhatsApp'), body: `<div id="waqr" style="text-align:center;min-height:240px;display:grid;place-items:center"><div class="spin"></div></div>
    <p class="hint" style="margin-top:10px">${esc(t('On your phone: WhatsApp → Settings → Linked devices → Link a device, then scan this code.'))}</p>`, foot: `<button class="btn block" data-act="close">${esc(t('Close'))}</button>` });
  const hid = Store.ctx.hostelId, box = () => $('#waqr');
  for (let n = 0; box(); n++) {
    try {
      const r = n % 5 === 0 ? await Cloud.waApi('connect', { hostel_id: hid }) : await Cloud.waApi('state', { hostel_id: hid });
      if (!box()) return;
      if (r.state === 'open') {
        await Store.saveSettings({ wa: { gw: { on: true, kind: 'evolution' } } });
        closeModal(); toast('WhatsApp connected ✓'); render(); return;
      }
      if (r.qr) box().innerHTML = `<img src="${esc(r.qr)}" alt="WhatsApp QR code" style="width:260px;max-width:100%;background:#fff;padding:8px;border-radius:12px">`;
    } catch (e) { if (box()) box().innerHTML = `<span class="bad-t">${esc(t(e.message))}</span>`; return; }
    await new Promise(res => setTimeout(res, 4000));
  }
};
/* The demo hostel (settings.demo, set by the platform admin) is filled and emptied from here. Filling
 * runs the same generator as the offline demo, writing through the normal sync, so what is shown to a
 * prospect is exactly what a real hostel looks like. It refuses a hostel that already has records. */
A.demofill = () => {
  if (!isSuper() || !isDemoHostel()) return toast('Only on the demo hostel', 'bad');
  if (Store.all('res').length || Store.all('room').length) return toast('This hostel already has data. Wipe it first.', 'bad');
  confirmBox(t('Fill this demo hostel with made-up data?'), async () => { seedDemo(Store.ctx.hostelId, { big: true }); await Store.flush().catch(() => {}); toast('Demo data added'); render(); }, 'Fill', 'ok');
};
A.demowipe = () => {
  if (!isSuper() || !isDemoHostel()) return toast('Only on the demo hostel', 'bad');
  confirmBox(t('Delete every record in this demo hostel? Nothing else is touched.'), async () => {
    await Cloud.rest(`docs?hostel_id=eq.${encodeURIComponent(Store.ctx.hostelId)}`, { method: 'DELETE' });
    Store.docs = new Map(); Store.byKind = new Map(); Store.outbox = []; Store.cursor = null; Store.ver++; Store.persist();
    toast('Demo data deleted'); render();
  }, 'Delete', 'bad');
};
A.wagwoff = () => confirmBox(esc(t('Turn off automatic sending? WhatsApp will open with the message typed instead.')), async () => {
  await Cloud.waApi('remove', { hostel_id: Store.ctx.hostelId }).catch(() => {});
  await Store.saveSettings({ wa: { gw: { on: false, kind: '' } } }); toast('Turned off');
});
A.attgeo = async () => {
  const f = $('#sf_staffatt'), msg = $('#attgeomsg'); if (!f) return;
  msg.textContent = t('Finding your location…');
  try {
    const p = await Geo.here();
    f.elements.lat.value = p.lat.toFixed(6); f.elements.lng.value = p.lng.toFixed(6);
    msg.textContent = t('Location set (±{m} m). Press Save.', { m: Math.round(p.acc || 0) });
  } catch (e) { msg.textContent = t(e.message); }
};
A.saveopening = () => {
  const form = $('#elecopen'), err = $('#elecopen_err'); err.textContent = '';
  const date = form.elements.date.value || today();
  let n = 0;
  for (const r of rooms()) {
    const el = form.elements['o_' + r.id]; if (!el || el.value === '') continue;
    const v = parseFloat(el.value);
    if (isNaN(v) || v < 0) { err.textContent = t('Room {r}: enter a valid number', { r: r.no }); return; }
    setOpeningReading(r.id, v, date); n++;
  }
  if (!n) { err.textContent = t('Enter at least one reading'); return; }
  toast(t('{n} readings saved', { n })); go('electricity');
};
A.addmeal = () => formModal({
  title: 'Add meal',
  fields: [
    { name: 'l', label: 'Meal name', placeholder: 'e.g. Evening snacks', required: true },
    { name: 'time', label: 'Serving time', type: 'time', value: '17:30', required: true },
    { name: 'cutoff', label: 'Skip cut-off time', type: 'time', value: '14:00', required: true },
    { name: 'tCutoff', label: 'Tiffin cut-off time', type: 'time', value: '14:00', required: true },
  ],
  onSubmit: async v => {
    if (S().meals.some(m => t(m.l).toLowerCase() === v.l.toLowerCase())) return 'A meal with this name already exists';
    const ms = byTime([...clone(S().meals), { k: 'm' + Date.now().toString(36), l: v.l, time: v.time, cutoff: v.cutoff, prev: false, tCutoff: v.tCutoff, tPrev: false }]);
    await Store.replaceSettingsKey('meals', ms); toast('Saved'); render();
  },
});
// Past skips/tiffins keep the old meal key, so history stays readable; only the setting goes.
A.delmeal = el => confirmBox(esc(t('Remove this meal?')), async () => {
  const ms = S().meals.filter(m => m.k !== el.dataset.k);
  if (ms.length) { await Store.replaceSettingsKey('meals', ms); toast('Removed'); }
});
A.edittpl = el => {
  const k = el.dataset.k, L = el.dataset.l, cur = (S().wa.tpl[L] || {})[k] || WA_TPL[L][k];
  formModal({ title: WA_KEYS[k], wide: true, fields: [{ name: 'text', label: 'Message', type: 'textarea', value: cur, full: true, hint: `${t('Placeholders')}: ${(WA_TPL.en[k].match(/\{\w+\}/g) || []).filter((v, i, a) => a.indexOf(v) === i).join(' ')}` }],
    danger: (S().wa.tpl[L] || {})[k] ? { label: 'Reset to default', run: async () => { const wa = clone(S().wa); delete (wa.tpl[L] || {})[k]; await Store.saveSettings({ wa }, ['wa']); closeModal(); render(); } } : null,
    onSubmit: async v => { const wa = clone(S().wa); wa.tpl = wa.tpl || {}; wa.tpl[L] = { ...(wa.tpl[L] || {}), [k]: v.text }; await Store.saveSettings({ wa }, ['wa']); toast('Template saved'); } });
  const ta = $('#f_text'); if (ta) ta.style.minHeight = '220px';
};
A.opendoc = async el => {
  const resId = el.dataset.res || (el.closest('[data-res]') && el.closest('[data-res]').dataset.res) || (ui.page === 'residents' && ui.arg) || null;
  const type = el.dataset.type || '';
  const path = el.dataset.path || '';
  if (ctx().role === 'emitra' && !PV_DOC_ALLOWED.test(type) && !/police verification/i.test(type)) return toast(t('You can only open ID papers'), 'bad');
  if (resId && typeof openResidentDocViewer === 'function') {
    return openResidentDocViewer(resId, type, path);
  }
  if (!path) { toast('That document is not on file yet', 'bad'); return; }
  toast(t('Loading document…'));
  try {
    const url = await Files.url(path);
    docView(url, type || t('Document'), path.toLowerCase().endsWith('.pdf') || (url && url.includes('.pdf')) ? 'application/pdf' : 'image/*');
  } catch (err) {
    toast(err.message || 'Could not load document', 'bad');
  }
};
A.backup = () => download(`hostelos-${slug(hostelName())}-${today()}.json`, JSON.stringify({ hostel: Store.hostel(), exported: nowIso(), docs: [...Store.docs.values()].filter(d => !d._del) }, null, 1), 'application/json');
/* The one button in the app that can destroy everything at once: in demo mode the browser IS
 * the database, so this erases every client, hostel, resident and bill with no way back. A
 * single "are you sure?" is not enough standing between a mis-tap and all of it, so it asks
 * for the word to be typed — and says plainly, with the numbers, what is about to go. */
A.resetdemo = () => formModal({
  title: 'Erase all demo data', submit: 'Erase everything', danger: null,
  note: t('This wipes {o} clients, {h} hostels and every record in them from this browser. Demo data lives only here — there is no copy anywhere else and this cannot be undone. Download a backup first if you want to keep any of it.',
    { o: (Demo.load().orgs || []).length, h: (Demo.load().hostels || []).length }),
  fields: [{ name: 'confirm', label: 'Type ERASE to confirm', required: true, full: true }],
  onSubmit: v => {
    if (String(v.confirm).trim().toUpperCase() !== 'ERASE') return 'Type ERASE to confirm';
    LS.del(DKEY);
    Object.keys(localStorage).filter(k => k.startsWith('hostelos.')).forEach(k => LS.del(k));
    location.reload();
    return false;
  },
});

/* ===================================================================== users & access (owner) */
// ROLE_CHOICES is defined in js/domain.js
async function loadOrgUsers() {
  const h = Store.hostel();
  const members = (await Backend.list('members', CLOUD ? `&org_id=eq.${h.org_id}` : '')).filter(m => m.org_id === h.org_id && (!m.hostel_id || m.hostel_id === h.id));
  const ids = [...new Set(members.map(m => m.user_id))];
  const profiles = ids.length ? (await Backend.list('profiles', CLOUD ? `&id=in.(${ids.join(',')})` : '')).filter(p => ids.includes(p.id)) : [];
  ui.users = { at: Date.now(), hostel: h.id, members, profiles };
  render();
}
function usersPage() {
  const h = Store.hostel();
  if (!ui.users || ui.users.hostel !== h.id) { loadOrgUsers().catch(e => { ui.users = { error: e.message, hostel: h.id, members: [], profiles: [] }; render(); }); return `${head('Users, logins & access')}<div class="skel"></div>`; }
  if (ui.users.error) return `${head('Users, logins & access')}<div class="card">${empty('Could not load users', ui.users.error, btn('Try again', 'usersreload'))}</div>`;
  const f = curFlt('usr', 'staff');
  const rows = ui.users.members.filter(m => (f === 'staff' ? m.role !== 'resident' : m.role === 'resident')).map(m => ({ m, p: ui.users.profiles.find(p => p.id === m.user_id) || { full_name: '?', username: '?' } }));
  return `${head('Users, logins & access', t('Each person sees only their work. Add extra modules to anyone.'), `${btn('', 'usersreload', `aria-label="${esc(t('Refresh'))}"`, '', 'sync')}${btn('Add user', 'adduser', '', 'primary', 'userplus')}`)}
    <div class="tool">${chips('usr', [['staff', 'Staff & managers'], ['res', 'Residents']], 'staff')}</div>
    ${group('', rows.map(({ m, p }) => li({ lead: avatar(p.full_name), t: `${p.full_name} · @${p.username}`, d: `${t(ROLES[m.role] ? ROLES[m.role].l : m.role)}${m.block ? ' · ' + blockName(m.block) : blocksOn() ? ' · ' + t('all blocks') : ''}${m.perms && m.perms.length ? ' + ' + m.perms.map(k => t((MOD[k] || { l: k }).l)).join(', ') : ''}${p.active === false || !m.active ? ' · ' + t('Disabled') : ''}`, act: m.role === 'owner' ? '' : 'useredit', attrs: `data-id="${m.id}"`, end: m.role === 'owner' ? badge('Owner', 'acc') : '' })).join(''), t('Residents get a login automatically at check-in (user ID = name, password = mobile).'))}`;
}
/* ---- the public page ---------------------------------------------------------- */
/* Every edit writes the whole `site` object back. Lists inside it (facilities, room types,
 * questions) are replaced rather than merged by both the local and the server-side merge, so
 * a deleted facility stays deleted — which is exactly the bug a per-key patch would bring. */
const sitePatch = obj => ({ site: { ...siteCfg(), ...obj } });
async function saveSite(obj, msg) { await Store.saveSettings(sitePatch(obj)); if (msg) toast(msg); render(); }

/* Preview shows the owner their own page from the data already on their screen, not by
 * asking the server for the published copy. Two reasons: unpublished changes are exactly
 * what a preview is for, and the published route needs the serverless function — so a
 * preview that went through it would be dead on localhost and would lag behind edits in
 * production. The handover is a short-lived key the preview tab reads once and deletes. */
A.sitepreview = () => {
  const h = Store.hostel() || {};
  LS.set('hostelos.sitepreview', { at: Date.now(), name: h.name, city: h.city || '', address: h.address || '', phone: h.phone || '', site: siteCfg() });
  window.open(new URL('/site.html?preview=1', location.origin).href, '_blank', 'noopener');
};
A.sitecopy = async () => { try { await navigator.clipboard.writeText(siteUrl()); toast('Link copied'); } catch (e) { sheet('Link', `<pre class="pre-wrap">${esc(siteUrl())}</pre>`); } };
A.siteqr = () => sheet('Your hostel page', `<div class="qr">${qrSvg(siteUrl(), 6)}</div>
  <p style="text-align:center;margin:10px 0 4px"><b>${esc(hostelName())}</b></p>
  <p class="hint" style="text-align:center">${esc(t('Anyone who scans this sees your hostel page and can message you on WhatsApp.'))}</p>
  <div class="row wrap" style="justify-content:center;gap:8px;margin-top:14px">${btn('Print', 'print', '', 'sm', 'download')}${btn('Copy link', 'sitecopy', '', 'sm', 'copy')}${btn('Send on WhatsApp', 'sitewa', '', 'sm wa', 'wa')}</div>`);
A.sitewa = () => { waOpen('', `${t('Hello')},\n\n${t('Here is the page for')} *${hostelName()}*:\n${siteUrl()}\n\n${t('Regards')},\n${hostelName()}`, 'Share the page'); };

// Publishing is refused while the page would embarrass the owner: an empty page sent to a
// parent is worse than no page at all.
document.addEventListener('change', async e => {
  if (!e.target.hasAttribute || !e.target.hasAttribute('data-sitesw')) return;
  const want = e.target.checked;
  if (want) {
    const gaps = siteGaps();
    if (gaps.length) { e.target.checked = false; return toast(t('Add {m} first', { m: gaps.join(', ') }), 'bad'); }
  }
  try { await saveSite({ on: want }, want ? 'Your page is live' : 'Page unpublished'); }
  catch (err) { e.target.checked = !want; toast(err.message, 'bad'); }
});

/* Photos are links, not files. The owner keeps the pictures wherever they already keep them —
 * in practice a shared Google Drive folder — and we store the address. The preview below the
 * box is the whole safety net: if the picture does not appear there it will not appear on the
 * page either, and the owner finds that out now rather than from a parent. */
A.sitephoto = el => {
  const k = el.dataset.k, row = SITE_PHOTOS.find(x => x[0] === k) || (/^g\d+$/.test(k) && +k.slice(1) <= SITE_GALLERY_MAX ? [k, `${t('Gallery photo')} ${k.slice(1)}`, ''] : null); if (!row) return;
  formModal({
    title: t(row[1]), submit: 'Save link',
    note: t('In Google Drive: right-click the photo \u2192 Share \u2192 \u201cAnyone with the link\u201d \u2192 Copy link. Paste it below.'),
    fields: [{ name: 'url', label: 'Public image link', value: sitePhotoRaw(k), full: true,
      hint: t('A Google Drive share link, or any address that ends in .jpg or .png.') }],
    preview: v => {
      const u = imgUrl(v.url, 640);
      if (!String(v.url || '').trim()) return '';
      return u ? `<img src="${esc(u)}" alt="" class="shot-preview">`
        : `<span class="bad-t">${esc(t('That does not look like a link. It should start with https://'))}</span>`;
    },
    onSubmit: async v => {
      const raw = String(v.url || '').trim();
      if (raw && !imgUrl(raw)) return 'That does not look like a link. It should start with https://';
      await saveSite({ photos: sitePhotosWith(k, raw) }, raw ? 'Photo set' : 'Photo removed');
    },
  });
};
A.sitephotodel = el => {
  const k = el.dataset.k;
  confirmBox(t('Remove this photo from your page? The picture itself is not deleted — only the link.'),
    () => saveSite({ photos: sitePhotosWith(k, '') }, 'Removed'), 'Remove', 'bad');
};
// A slot that replaced an older one (see SITE_PHOTO_OLD) also blanks the old key, or removing
// the new picture would make the old one reappear.
const sitePhotosWith = (k, raw) => { const p = { ...(siteCfg().photos || {}), [k]: raw }; if (SITE_PHOTO_OLD[k]) p[SITE_PHOTO_OLD[k]] = ''; return p; };

/* The numbers bar ("330+ · Happy residents"): up to four, each with a small icon. */
const SITE_STAT_ICONS = [['users', 'People'], ['shield', 'Safety'], ['food', 'Meals'], ['bed', 'Beds'], ['home', 'Building'], ['bolt', 'Power'], ['wifi', 'Wi-Fi'], ['spark', 'Clean'], ['check', 'Tick']];
const SITE_FAC_IDEAS = ['AC Rooms', 'All Meals Included', 'Comfortable Beds', 'High-Speed Wi-Fi', '24x7 CCTV Security', 'Power Backup', 'Laundry Service', 'Daily Housekeeping', 'Clean Washrooms', 'Study Friendly', 'Hot Water', 'RO Drinking Water', 'Parking', 'TV Lounge', 'Gym', 'Lift', 'Biometric Entry'];
A.sitefacq = async el => {
  const v = el.dataset.v, list = (siteCfg().facilities || []).slice();
  if (!v || list.some(x => x.toLowerCase() === v.toLowerCase())) return;
  list.push(v); await saveSite({ facilities: list });
};
A.sitestat = el => {
  const i = el && el.dataset.i !== undefined && el.dataset.i !== '' ? +el.dataset.i : -1;
  const list = (siteCfg().stats || []).slice(), cur = i >= 0 ? list[i] : {};
  formModal({ title: i >= 0 ? 'Edit number' : 'Add a number', submit: 'Save',
    fields: [{ name: 'v', label: 'The number', value: cur.v, required: true, hint: t('e.g. 330+ or 100%') },
      { name: 'l', label: 'What it counts', value: cur.l, required: true, hint: t('e.g. Happy residents') },
      { name: 'i', label: 'Icon', type: 'select', value: cur.i || 'users', options: SITE_STAT_ICONS.map(([k, l]) => ({ v: k, l: t(l) })) }],
    danger: i >= 0 ? { label: 'Remove this number', run: () => saveSite({ stats: list.filter((x, j) => j !== i) }, 'Removed') } : null,
    onSubmit: async v => {
      const row = { v: String(v.v).trim().slice(0, 12), l: String(v.l).trim().slice(0, 28), i: v.i };
      if (i >= 0) list[i] = row; else list.push(row);
      await saveSite({ stats: list.slice(0, 4) }, 'Saved');
    } });
};

A.siterte = el => {
  const i = el && el.dataset.i !== undefined && el.dataset.i !== '' ? +el.dataset.i : -1;
  const list = (siteCfg().roomTypes || []).slice(), cur = i >= 0 ? list[i] : {};
  formModal({ title: i >= 0 ? 'Edit room type' : 'Add a room type', submit: 'Save',
    fields: [{ name: 'l', label: 'What to call it', value: cur.l, required: true, hint: t('e.g. "Double sharing, AC"') },
      { name: 'price', label: 'Price per bed (₹/month)', type: 'number', min: 0, value: cur.price, required: true },
      { name: 'note', label: 'What is included', value: cur.note, full: true, hint: t('e.g. "3 meals, laundry, Wi-Fi"') }],
    danger: i >= 0 ? { label: 'Remove this room type', run: () => saveSite({ roomTypes: list.filter((x, j) => j !== i) }, 'Removed') } : null,
    onSubmit: async v => {
      const row = { l: v.l.trim(), price: +v.price || 0, note: (v.note || '').trim() };
      if (i >= 0) list[i] = row; else list.push(row);
      await saveSite({ roomTypes: list }, 'Saved');
    } });
};

A.sitefaca = async () => {
  const el = $('#site_fac'), v = (el.value || '').trim(); if (!v) return;
  const list = (siteCfg().facilities || []).slice();
  if (list.some(x => x.toLowerCase() === v.toLowerCase())) { el.value = ''; return; }
  list.push(v.slice(0, 40)); el.value = '';
  await saveSite({ facilities: list });
};
A.sitefacd = el => { const i = +el.dataset.i; saveSite({ facilities: (siteCfg().facilities || []).filter((x, j) => j !== i) }); };

A.sitefaqe = el => {
  const i = el && el.dataset.i !== undefined && el.dataset.i !== '' ? +el.dataset.i : -1;
  const list = (siteCfg().faq || []).slice(), cur = i >= 0 ? list[i] : {};
  formModal({ title: i >= 0 ? 'Edit question' : 'Add a question', submit: 'Save',
    fields: [{ name: 'q', label: 'Question', value: cur.q, required: true, full: true },
      { name: 'a', label: 'Your answer', type: 'textarea', value: cur.a, required: true, full: true }],
    danger: i >= 0 ? { label: 'Remove this question', run: () => saveSite({ faq: list.filter((x, j) => j !== i) }, 'Removed') } : null,
    onSubmit: async v => {
      const row = { q: v.q.trim(), a: v.a.trim() };
      if (i >= 0) list[i] = row; else list.push(row);
      await saveSite({ faq: list }, 'Saved');
    } });
};

A.usersreload = () => { ui.users = null; render(); };
/* Tying a login to one block. Nothing appears unless the hostel actually has blocks, and
 * "All blocks" stays the default — the warden of Block B is the exception, not the rule. */
const blockField = value => (blocksOn() ? [{ name: 'block', label: 'Block', type: 'select', value,
  options: [{ v: '', l: t('All blocks') }, ...hostelBlocks().map(b => ({ v: b.k, l: b.l }))],
  info: t('Tied to one block, this person sees only that wing — its rooms, residents, bills and daily work. Leave it on all blocks for anyone who runs the whole hostel.') }] : []);
A.adduser = () => formModal({
  title: 'Add user', submit: 'Create login',
  fields: [{ name: 'full_name', label: 'Full name', required: true, maxlength: 80 }, { name: 'phone', label: 'Mobile', type: 'tel', required: true, maxlength: 15 }, { name: 'role', label: 'Role', type: 'select', options: ROLE_CHOICES.filter(r => r !== 'resident' && isRoleAllowed(r)).map(r => ({ v: r, l: t(ROLES[r].l) })) },
    ...blockField(''),
    { name: 'perms', label: 'Extra modules (optional)', type: 'multi', options: MODULES.filter(m => !['home', 'settings'].includes(m.k) && orgEnabled(m.k)).map(m => ({ v: m.k, l: t(m.l) })), full: true },
    { name: 'existing', label: 'This person already has a login (add role only)', type: 'checkbox' }, { name: 'username', label: 'Their user ID', hidden: true }],
  onChange: (v, f) => { showField(f, 'username', v.existing); showField(f, 'phone', !v.existing); showField(f, 'full_name', !v.existing); },
  onSubmit: async v => {
    const h = Store.hostel();
    if (v.existing) { if (!v.username) return 'Enter their user ID'; await Backend.admin('add_member', { username: v.username, org_id: h.org_id, hostel_id: h.id, role: v.role, perms: v.perms, block: v.block }); toast('Access added'); }
    else {
      const hSlug = slug((h && h.name) || 'hostel').slice(0, 18).replace(/\.+$/, '') || 'hostel';
      const ph = phone10(v.phone);
      const wantUser = ph && ph.length === 10 ? (v.role === 'owner' ? ph : `${ph}.${hSlug}`) : undefined;
      const u = await Backend.admin('create_user', { full_name: v.full_name, phone: v.phone, username: wantUser, org_id: h.org_id, hostel_id: h.id, role: v.role, perms: v.perms, block: v.block });
      closeModal(); ui.users = null; render();
      waOpen(v.phone, tpl('staffWelcome', { name: v.full_name.split(' ')[0], role: t(ROLES[v.role].l), hostel: hostelName(), link: appUrl(), username: u.username, password: u.password }), 'Send login');
      return false;
    }
    ui.users = null;
  },
});
A.useredit = el => {
  const m = ui.users.members.find(x => x.id === el.dataset.id), p = ui.users.profiles.find(x => x.id === m.user_id) || {};
  const defaults = (ROLES[m.role] || ROLES.staff).mods;
  formModal({
    title: `${p.full_name} · @${p.username}`, submit: 'Save access',
    note: t('Default for {r}: {m}', { r: t(ROLES[m.role].l), m: defaults.map(k => t((MOD[k] || { l: k }).l)).join(', ') || '—' }),
    fields: [{ name: 'role', label: 'Role', type: 'select', options: ROLE_CHOICES.filter(r => r === m.role || isRoleAllowed(r)).map(r => ({ v: r, l: t(ROLES[r].l) })), value: m.role },
      ...blockField(m.block || ''),
      { name: 'perms', label: 'Also allow', type: 'multi', options: MODULES.filter(x => !defaults.includes(x.k) && !['home', 'settings'].includes(x.k) && orgEnabled(x.k)).map(x => ({ v: x.k, l: t(x.l) })), value: m.perms || [], full: true },
      { name: 'deny', label: 'Hide these defaults', type: 'multi', options: defaults.map(k => ({ v: k, l: t((MOD[k] || { l: k }).l) })), value: m.deny || [], full: true }],
    extra: `<div class="row" style="margin-top:14px">${btn('Reset password to mobile', 'userpw', `data-uid="${m.user_id}" data-ph="${esc(p.phone || '')}"`, 'sm', 'lock')}${btn(p.active === false || !m.active ? 'Enable login' : 'Disable login', 'useractive', `data-uid="${m.user_id}" data-mid="${m.id}" data-on="${p.active === false || !m.active ? 1 : 0}"`, 'sm bad')}</div>`,
    onSubmit: async v => {
      const patch = { role: v.role, perms: v.perms, deny: v.deny, ...(blocksOn() ? { block: v.block || null } : {}) };
      await Backend.update('members', m.id, patch); Object.assign(m, patch);
      // changing your own lock changes what you can see, so reopen the hostel with it applied
      if (m.user_id === Store.me.id) { ui.users = null; await chooseContext(ctx().key); return; }
      toast('Access updated');
    },
  });
};
// Resetting locks the person out of whatever they were using, so it asks first and then
// shows what to send them — the new password cannot be looked up again afterwards.
/* The login card. Shown once, right after a login is created or a password is set, because a password
 * cannot be read back from Supabase afterwards, only replaced. Lives here, not in ui-admin.js, because
 * an owner resetting a resident's password needs it too and ui-admin.js is only loaded for the
 * platform admin. `kind` picks the WhatsApp text: "login ready" for a new login, "password changed" after a reset. */
function credsSheet(title, name, phone, username, password, note, kind = 'staffWelcome') {
  sheet(title, `<dl class="kv creds">
      <dt>${esc(t('User ID'))}</dt><dd><b>${esc(username)}</b></dd>
      <dt>${esc(t('Password'))}</dt><dd><b>${esc(password)}</b></dd>
    </dl>
    <p class="hint">${esc(note || t('Write this down or send it now — a password cannot be read back later, only reset.'))}</p>`,
  { foot: `${btn('Copy', 'admcopycreds', `data-u="${esc(username)}" data-p="${esc(password)}"`, '', 'file')}<span class="sp"></span>${phone ? btn('Send on WhatsApp', 'admsendcreds', `data-ph="${esc(phone)}" data-n="${esc(name)}" data-u="${esc(username)}" data-p="${esc(password)}" data-k="${esc(kind)}"`, 'primary wa', 'wa') : ''}` });
}
A.admcopycreds = async el => {
  const txt = `${t('User ID')}: ${el.dataset.u}\n${t('Password')}: ${el.dataset.p}\n${appUrl()}`;
  try { await navigator.clipboard.writeText(txt); toast('Copied'); } catch (e) { sheet('Login', `<pre class="pre-wrap">${esc(txt)}</pre>`); }
};
A.admsendcreds = el => {
  closeModal(true);
  waOpen(el.dataset.ph, tpl(el.dataset.k === 'password' ? 'password' : 'staffWelcome', { name: String(el.dataset.n || '').split(' ')[0], role: '', hostel: (Store.hostel() || {}).name || CFG.APP_NAME || 'Sarvlekh', link: appUrl(), username: el.dataset.u, password: el.dataset.p }, LANG === 'hi' ? 'hi' : 'en'), 'Send login');
};
A.userpw = el => {
  const ph = phone10(el.dataset.ph);
  if (ph.length !== 10) return toast('Save a 10-digit mobile number for this user first. It becomes the password.', 'bad');
  confirmBox(t('Set their password to {n}? Whatever they use now stops working, so send them the new one.', { n: ph }), async () => {
    await Backend.admin('set_password', { user_id: el.dataset.uid, password: ph });
    const p = (ui.users && ui.users.profiles || []).find(x => x.id === el.dataset.uid) || {};
    credsSheet(t('Password changed'), p.full_name || '', ph, p.username || '', ph, null, 'password');
  }, 'Reset password', 'bad');
};
A.useractive = async el => { const on = el.dataset.on === '1'; await Backend.admin('set_active', { user_id: el.dataset.uid, active: on }); await Backend.update('members', el.dataset.mid, { active: on }); closeModal(); ui.users = null; render(); toast(on ? 'Enabled' : 'Disabled'); };

/* ===================================================================== template & charges actions */
function chargeForm(c, preset) {
  const rm = rooms(), people = activeRes();
  const scopeNow = !c ? 'all' : c.scope === 'rooms' || c.scope === 'room' ? 'rooms' : c.scope === 'residents' ? 'residents' : 'all';
  const roomIds = !c ? [] : c.scope === 'room' && c.roomId ? [c.roomId] : (c.roomIds || []);
  formModal({
    title: c ? 'Edit charge' : 'Add charge', submit: 'Save',
    fields: [
      { name: 'name', label: 'Charge name', value: c ? c.name : preset || '', required: true, maxlength: 40, placeholder: 'e.g. Wi-Fi' },
      { name: 'amount', label: 'Amount (₹)', type: 'number', min: 1, max: 100000, value: c ? c.amount : '', required: true },
      { name: 'frequency', label: 'How often', type: 'select', value: c ? c.frequency : 'monthly', options: [{ v: 'monthly', l: t('Every month') }, { v: 'onetime', l: t('One time (you bill it)') }] },
      { name: 'scope', label: 'Who pays', type: 'select', value: scopeNow, options: [{ v: 'all', l: t('Everyone') }, { v: 'rooms', l: t('Chosen rooms') }, { v: 'residents', l: t('Chosen residents') }] },
      { name: 'roomIds', label: 'Rooms', type: 'multi', full: true, hidden: scopeNow !== 'rooms', value: roomIds, options: rm.map(r => ({ v: r.id, l: `${t('Room')} ${r.no}` })) },
      { name: 'resIds', label: 'Residents', type: 'multi', full: true, hidden: scopeNow !== 'residents', value: c && c.resIds || [], options: people.map(r => ({ v: r.id, l: r.name })) },
    ],
    onChange: (v, form, ch) => { if (ch === 'scope') { showField(form, 'roomIds', v.scope === 'rooms'); showField(form, 'resIds', v.scope === 'residents'); } },
    danger: c ? { label: 'Delete charge', run: () => A.delcharge({ dataset: { id: c.id } }) } : null,
    onSubmit: async v => {
      const name = String(v.name || '').replace(/\s+/g, ' ').trim();
      if (!name) return 'Enter a name';
      if (!(+v.amount > 0)) return 'Enter the amount';
      if (v.scope === 'rooms' && !(v.roomIds || []).length) return 'Choose at least one room';
      if (v.scope === 'residents' && !(v.resIds || []).length) return 'Choose at least one resident';
      const item = { id: c ? c.id : 'chg-' + Date.now(), name, amount: round2(+v.amount), frequency: v.frequency, scope: v.scope, active: c ? c.active !== false : true };
      if (v.scope === 'rooms') item.roomIds = v.roomIds; if (v.scope === 'residents') item.resIds = v.resIds;
      const list = (S().charges || []).filter(x => !c || x.id !== c.id);
      if (c) list.splice((S().charges || []).findIndex(x => x.id === c.id), 0, item); else list.push(item);
      await Store.replaceSettingsKey('charges', list);
      toast(c ? 'Saved' : 'Charge added');
      render();
    }
  });
}
A.addcharge = el => chargeForm(null, el && el.dataset && el.dataset.preset);
A.editcharge = el => { const c = (S().charges || []).find(x => x.id === el.dataset.id); if (c) chargeForm(c); };
A.chgnoop = () => { };
document.addEventListener('change', async e => {
  const id = e.target.dataset && e.target.dataset.chgsw; if (!id) return;
  const want = e.target.checked;
  try { await Store.replaceSettingsKey('charges', (S().charges || []).map(c => (c.id === id ? { ...c, active: want } : c))); toast(want ? 'Switched on' : 'Switched off'); render(); }
  catch (err) { e.target.checked = !want; toast(err.message, 'bad'); }
});
A.chargebill = el => {
  const c = (S().charges || []).find(x => x.id === el.dataset.id); if (!c) return;
  const who = activeRes().filter(r => chargeApplies(c, r)), todo = who.filter(r => !Store.get(`inv-chg-${c.id}-${r.id}`));
  if (!todo.length) return toast(t('Already billed to everyone it applies to'));
  confirmBox(t('Bill {a} for {n} to {c} resident(s) now?', { a: inr(c.amount), n: c.name, c: todo.length }), () => {
    const r = billChargeNow(c); toast(t('{n} bills created', { n: r.created })); render();
  }, 'Bill now', 'primary');
};

A.togglecharge = async el => {
  const id = el.dataset.id;
  const list = (S().charges || []).map(c => (c.id === id ? { ...c, active: !c.active } : c));
  await Store.replaceSettingsKey('charges', list);
  toast('Updated');
  render();
};

A.delcharge = async el => {
  const id = el.dataset.id;
  confirmBox('Remove this charge?', async () => {
    const list = (S().charges || []).filter(c => c.id !== id);
    await Store.replaceSettingsKey('charges', list);
    toast('Charge removed');
    render();
  }, 'Remove', 'bad');
};

A.onboardcf = async () => {
  if (!orgEnabled('cashfree')) return toast(t('Online payments are not switched on for this hostel. Ask the platform admin.'), 'bad');
  const h = Store.hostel();
  if (!h || !h.org_id) return toast('No active hostel selected', 'bad');

  let currentVendor = null;
  try {
    const r = await Backend.admin('get_owner_vendor', { org_id: h.org_id });
    if (r && r.configured && r.vendor) currentVendor = r.vendor;
  } catch (_) {}

  formModal({
    title: t('Cashfree Easy Split Settlement Account'),
    submit: t('Save & Verify with Cashfree'),
    note: t('Enter your verified commercial/business bank account. Rent collected via Cashfree UPI is automatically split and settled into this account.'),
    fields: [
      { name: 'name', label: t('Account Holder / Business Name'), value: currentVendor?.account_holder_name || h.name, required: true },
      { name: 'acc', label: t('Bank Account Number'), value: '', placeholder: currentVendor?.bank_account_masked || 'e.g. 50100123456789', required: !currentVendor },
      { name: 'ifsc', label: t('Bank IFSC Code'), value: currentVendor?.bank_ifsc || '', placeholder: 'e.g. HDFC0001234', required: true },
      { name: 'upi', label: t('UPI ID for Settlements (optional)'), value: currentVendor?.upi_vpa || '' }
    ],
    onSubmit: async v => {
      const ifsc = String(v.ifsc || '').trim().toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return 'Enter valid 11-character Indian IFSC code (e.g. HDFC0001234)';
      const acc = String(v.acc || '').trim();
      if (acc && !/^\d{8,20}$/.test(acc)) return 'Bank account number must be 8 to 20 digits';
      if (!acc && !currentVendor) return 'Bank account number is required';

      try {
        await Backend.admin('onboard_owner_vendor', {
          org_id: h.org_id,
          account_holder_name: v.name,
          bank_account_number: acc,
          bank_ifsc: ifsc,
          upi_vpa: v.upi || null
        });
        toast(t('Bank account verified & saved with Cashfree Easy Split!'), 'ok');
        render();
      } catch (err) {
        return err.message;
      }
    }
  });
};
