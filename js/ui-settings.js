'use strict';
/* Owner settings — one clear screen per topic, iOS Settings style. Everything here drives the rest of the app. */

const SETTINGS_SECTIONS = [
  ['Hostel', [['pay', 'Profile & UPI payments', 'rupee', 'ok'], ['rent', 'Rent, due date & late fee', 'cal', 'warn']]],
  ['Billing', [['elec', 'Electricity rate & free units', 'bolt', 'warn', 'electricity'], ['laundry', 'Laundry free clothes & rate', 'shirt', 'info', 'laundry']]],
  ['Mess & kitchen', [['meals', 'Meal timings & cut-offs', 'clock', 'teal', 'mess'], ['dishes', 'Dishes, recipes & menu', 'utensils', 'warn', 'mess'], ['items', 'Stock items & units', 'box', 'mute', 'kitchen'], ['kitchen', 'Kitchen permissions', 'cart', 'info', 'kitchen']]],
  ['Money', [['expcats', 'Expense categories', 'tag', 'pink', 'expenses']]],
  ['Residents', [['attend', 'Attendance & roll call', 'check', 'teal', 'attendance']]],
  ['Team & access', [['users', 'Users, logins & access', 'key', 'bad'], ['depts', 'Staff departments', 'badge', 'info', 'staff'], ['staffatt', 'Staff attendance & punch-in', 'clock', 'teal', 'staff'], ['hkstaff', 'Housekeeping staff', 'broom', 'ok', 'housekeeping'], ['hk', 'Housekeeping rules', 'settings', 'mute', 'housekeeping']]],
  ['Self check-in', [['qr', 'QR codes for residents & visitors', 'qr', 'teal']]],
  ['Public page', [['site', 'Hostel page for enquiries', 'globe', 'info', 'landing']]],
  ['Communication & documents', [['wa', 'WhatsApp messages', 'wa', 'ok'], ['docs', 'Documents', 'file', 'warn'], ['police', 'Police verification', 'shield', 'bad', 'residents']]],
  ['Data', [['data', 'Backup & export', 'download', 'mute']]],
];
PAGES.settings = {
  title: 'Settings', mod: 'settings',
  render(sec) {
    if (sec && SETTINGS_PAGES[sec]) return `<div class="narrow" style="max-width:720px"><div class="row" style="margin:6px 0 4px">${btn('Settings', 'go', 'data-to="settings"', 'ghost sm', 'back')}</div>${SETTINGS_PAGES[sec]()}</div>`;
    return `<div class="narrow" style="max-width:720px">${head('Settings', esc(hostelName()))}
      ${SETTINGS_SECTIONS.map(([title, rows]) => { const vis = rows.filter(r => !r[4] || can(r[4])); return vis.length ? group(title, vis.map(([k, l, icn, col]) => li({ icon: icn, ic: col, t: t(l), d: settingSummary(k), act: 'go', attrs: `data-to="settings/${k}"` })).join('')) : ''; }).join('')}</div>`;
  },
};
function settingSummary(k) {
  const s = S();
  return {
    pay: s.pay.upiId ? `UPI: ${s.pay.upiId}` : t('Add your UPI ID to send pay links'),
    rent: t('Due on day {d} · late fee {f} after {g} days', { d: s.rent.day, f: s.rent.lateOn ? inr(s.rent.lateFee) : t('off'), g: s.rent.graceDays }),
    elec: t('₹{r}/unit · {f} free units per {m}', { r: s.elec.rate, f: s.elec.freeUnits, m: t(s.elec.freeMode === 'room' ? 'room' : 'resident') }),
    laundry: t('{f} free/month · then ₹{r} per piece', { f: s.laundry.freePcs, r: s.laundry.rate }),
    meals: s.meals.map(m => `${t(m.l)} ${fmtTime(m.time)}`).join(' · '),
    dishes: t('{n} dishes', { n: dishes().length }), items: t('{n} items', { n: items().length }),
    kitchen: s.kitchen.cookCanReceive ? t('Cook can receive goods') : t('Only owner receives goods'),
    expcats: t('{n} categories', { n: s.expenseCats.length }), depts: s.departments.map(d => t(d)).join(', '),
    hkstaff: t('{n} active', { n: hkStaff().filter(x => x.status === 'active').length }), hk: t('Missed after {t}', { t: fmtTime(s.hk.missedAfter) }) + ' · ' + t('{n} roles can mark done', { n: (s.hk.markBy || []).length }),
    staffatt: { manual: t('Marked by owner'), self: t('Staff punch in themselves'), both: t('Punch-in + owner can mark') }[s.staffAtt.mode] + (s.staffAtt.lat !== '' && s.staffAtt.lat != null ? ' · ' + t('within {r} m', { r: s.staffAtt.radius }) : ''),
    qr: joinOn() ? t('Residents scan and fill their own form') : t('Resident self check-in is off'),
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
function settingsForm(id, fields, toPatch, foot = '') {
  SET_FORMS[id] = { fields, toPatch };
  return `<form class="card" id="sf_${id}" novalidate><div class="fgrid">${fields.map(fieldHtml).join('')}</div><div class="ferr" id="sfe_${id}"></div><div class="row" style="margin-top:14px">${foot}<span class="sp"></span><button class="btn primary" type="button" data-act="savesettings" data-form="${id}">${esc(t('Save'))}</button></div></form>`;
}
A.savesettings = async el => {
  const id = el.dataset.form, f = SET_FORMS[id], form = $('#sf_' + id), err = $('#sfe_' + id);
  const v = formValues(form, f.fields); err.textContent = '';
  for (const fl of f.fields) if (fl.required && (v[fl.name] === '' || (typeof v[fl.name] === 'number' && isNaN(v[fl.name])))) { err.textContent = t('{f} is required.', { f: t(fl.label) }); return; }
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
  return `<div class="group">${list.map((x, i) => `<div class="li noic"><span class="body"><span class="t">${esc(t(x))}</span></span>${protect.includes(x) ? '' : `<button class="btn sm ghost" data-act="lsdel" data-path="${path}" data-i="${i}" aria-label="${esc(t('Delete'))}">${ico('trash', 'sm')}</button>`}</div>`).join('')}
    <div class="li noic"><input id="ls_${path.replace('.', '_')}" placeholder="${esc(t(placeholder))}" style="flex:1"><button class="btn sm primary" data-act="lsadd" data-path="${path}">${esc(t('Add'))}</button></div></div>`;
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
A.lsdel = async el => { const list = [...(getPath(el.dataset.path) || [])]; list.splice(+el.dataset.i, 1); await saveList(el.dataset.path, list); render(); };

const SETTINGS_PAGES = {
  pay: () => { const h = Store.hostel(), p = S().pay; return `${head('Profile & UPI payments', t('Used on bills, receipts and the UPI pay link.'))}${settingsForm('pay', [
    { name: 'name', label: 'Hostel / PG name', value: h.name, required: true }, { name: 'phone', label: 'Owner mobile (shown to residents)', type: 'tel', value: p.phone },
    { name: 'address', label: 'Address', value: h.address, full: true },
    { name: 'upiId', label: 'UPI ID (VPA)', value: p.upiId, placeholder: 'name@okhdfcbank', hint: t('Residents pay straight to this UPI ID from any app (PhonePe, GPay, Paytm, BHIM).') }, { name: 'payee', label: 'Name on UPI', value: p.payee || h.name },
    { name: 'bank', label: 'Bank details (optional, shown on bill)', value: p.bank, full: true },
  ], v => { if (v.upiId && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v.upiId)) return 'UPI ID looks invalid (example: name@okicici)'; if (v.name !== h.name || v.address !== h.address) { h.name = v.name; h.address = v.address; Backend.saveHostel(h.id, { name: v.name, address: v.address }).catch(e => toast(e.message, 'bad')); } return { pay: { upiId: v.upiId, payee: v.payee, phone: phone10(v.phone), bank: v.bank } }; },
  p.upiId ? `<a class="btn" href="${esc(payLink(1, 'Test'))}" target="_blank" rel="noopener">${ico('qr', 'sm')} ${esc(t('Test pay link'))}</a>` : '')}`; },
  rent: () => { const r = S().rent; return `${head('Rent, due date & late fee')}${settingsForm('rent', [
    { name: 'day', label: 'Rent bill day of month', type: 'number', min: 1, max: 28, value: r.day, required: true }, { name: 'graceDays', label: 'Grace days before overdue', type: 'number', min: 0, max: 25, value: r.graceDays },
    { name: 'lateOn', label: 'Add late fee automatically', type: 'checkbox', value: r.lateOn }, { name: 'lateFee', label: 'Late fee (₹, once per bill)', type: 'number', min: 0, value: r.lateFee },
    { name: 'prorate', label: 'Charge first month by days stayed (pro-rata)', type: 'checkbox', value: r.prorate, full: true },
  ], v => ({ rent: v }))}`; },
  elec: () => { const e = S().elec; return `${head('Electricity rate & free units', t('Bills are split equally among residents of a room.'))}${settingsForm('elec', [
    { name: 'rate', label: 'Rate per unit (₹)', type: 'number', min: 0, step: 0.01, value: e.rate, required: true }, { name: 'readingDay', label: 'Reading reminder day', type: 'number', min: 1, max: 28, value: e.readingDay },
    { name: 'freeUnits', label: 'Free units (not charged)', type: 'number', min: 0, value: e.freeUnits }, { name: 'freeMode', label: 'Free units are per', type: 'select', options: [{ v: 'resident', l: t('Per bed / resident, per month') }, { v: 'room', l: t('Per room, per month (shared)') }], value: e.freeMode },
  ], v => ({ elec: v }))}${about('Example: room uses 150 units, 2 residents, 30 free per resident → each pays (75 − 30) × rate. At every check-in and check-out the meter is read, so someone who stayed only part of the month pays for the units used in their days, and gets free units only for those days.')}
    ${group('', li({ icon: 'bolt', ic: 'warn', t: t('Opening meter readings'), d: t('Starting on Sarvlekh? Enter today\'s meter number for every room once.'), act: 'go', attrs: 'data-to="settings/elecopen"' }))}`; },
  staffatt: () => {
    const a = S().staffAtt;
    return `${head('Staff attendance & punch-in')}${settingsForm('staffatt', [
      { name: 'mode', label: 'Who marks attendance', type: 'select', full: true, value: a.mode,
        options: [{ v: 'manual', l: t('Owner / manager marks it') }, { v: 'self', l: t('Staff punch in from their own phone') }, { v: 'both', l: t('Both — staff punch in, owner can correct') }],
        info: t('With punch-in, staff who have a login are asked to mark attendance when they open the app, until they do. They can close the prompt.') },
      { type: 'section', label: 'Where attendance can be marked' },
      { name: 'lat', label: 'Latitude', type: 'number', step: 0.000001, value: a.lat, placeholder: 'e.g. 25.1442' },
      { name: 'lng', label: 'Longitude', type: 'number', step: 0.000001, value: a.lng, placeholder: 'e.g. 75.8468' },
      { type: 'html', html: `<div class="row">${btn('Use my current location', 'attgeo', '', 'sm', 'globe')}<span class="hint" id="attgeomsg"></span></div>` },
      { name: 'radius', label: 'Allowed distance (metres)', type: 'number', min: 20, max: 5000, value: a.radius || 150,
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
    { name: 'freePcs', label: 'Free clothes per resident per month', type: 'number', min: 0, value: l.freePcs, required: true }, { name: 'rate', label: 'Charge per extra piece (₹)', type: 'number', min: 0, value: l.rate, required: true },
  ], v => ({ laundry: v }))}${about('Extra charges are added to the resident\'s bill automatically when clothes are received.')}`; },
  meals: () => { const ms = meals(), me = S().mess; return `${head('Meal timings & cut-offs', t('Residents cannot skip a meal or order a tiffin after the cut-off.'))}
    ${settingsForm('meals', [
      ...ms.flatMap((m, i) => [
        { type: 'html', html: `<div class="row" style="padding:8px 2px 0"><span class="group-t" style="padding:0">${esc(t(m.l))}</span><span class="sp"></span>${ms.length > 1 ? btn('', 'delmeal', `data-k="${esc(m.k)}" aria-label="${esc(t('Remove'))}"`, 'sm ghost', 'trash') : ''}</div>` },
        { name: `l${i}`, label: 'Meal name', value: t(m.l), required: true }, { name: `time${i}`, label: 'Serving time', type: 'time', value: m.time },
        { name: `cut${i}`, label: 'Skip cut-off time', type: 'time', value: m.cutoff }, { name: `prev${i}`, label: 'Cut-off is on the previous day', type: 'checkbox', value: m.prev },
        { name: `tcut${i}`, label: 'Tiffin cut-off time', type: 'time', value: m.tCutoff }, { name: `tprev${i}`, label: 'Tiffin cut-off on the previous day', type: 'checkbox', value: m.tPrev },
      ]),
      { type: 'section', label: 'Options' },
      { name: 'skip', label: 'Residents can skip meals', type: 'checkbox', value: me.skip }, { name: 'tiffin', label: 'Residents can order tiffin (packed meal)', type: 'checkbox', value: me.tiffin },
      { name: 'learn', label: 'Learn real usage from purchases (recommended)', type: 'checkbox', value: me.learn, full: true },
    ], v => ({ meals: byTime(ms.map((m, i) => ({ ...m, l: v[`l${i}`] || m.l, time: v[`time${i}`], cutoff: v[`cut${i}`], prev: v[`prev${i}`], tCutoff: v[`tcut${i}`], tPrev: v[`tprev${i}`] }))), mess: { skip: v.skip, tiffin: v.tiffin, learn: v.learn } }),
    `${btn('Add meal (e.g. Snacks)', 'addmeal', '', 'sm')}`)}`; },
  dishes: () => `${head('Dishes, recipes & menu')}${group('', [li({ icon: 'utensils', ic: 'warn', t: t('Dishes & recipes'), d: t('{n} dishes', { n: dishes().length }), act: 'messtab', attrs: 'data-tab="dishes"' }), li({ icon: 'cal', ic: 'info', t: t('Weekly menu'), act: 'messtab', attrs: 'data-tab="menu"' }), li({ icon: 'plus', ic: 'ok', t: t('Add dish'), act: 'adddish' })].join(''), t('When you create a dish you also enter its ingredients — they become stock items automatically.'))}`,
  items: () => `${head('Stock items & units')}${group('Items', items().map(i => li({ icon: 'box', ic: 'mute', t: i.name, d: `${num(stockOf(i))} ${i.unit} · ${t('alert below')} ${i.min}`, act: 'edititem', attrs: `data-id="${i.id}"` })).join(''), `<a href="#" data-act="additem">+ ${esc(t('Add item'))}</a>`)}<div class="group-t">${esc(t('Units'))}</div>${listEditor('units', 'New unit (e.g. box)', ['kg', 'L', 'pcs'])}`,
  kitchen: () => { const k = S().kitchen; return `${head('Kitchen permissions')}${settingsForm('kitchen', [{ name: 'cookCanReceive', label: 'Cook can enter received goods', type: 'checkbox', value: k.cookCanReceive, full: true, hint: t('Off = only you (owner/manager) can receive purchases and enter prices.') }], v => ({ kitchen: v }))}${about('Cooks can always raise purchase requests. Only you approve quantities.')}`; },
  expcats: () => `${head('Expense categories', t('Used when adding expenses.'))}${listEditor('expenseCats', 'New category', ['Groceries', 'Salary', 'Other'])}`,
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
      ${group('Team', list.map(s => { const today_ = hkTasks().filter(x => x.date === today() && x.staffId === s.id); return `<div class="li">${avatar(s.name)}<span class="body"><span class="t">${esc(s.name)} ${s.status === 'active' ? '' : badge('Inactive')}</span><span class="d">${esc(s.phone || '')}${s.username ? ' · @' + esc(s.username) : ` · ${esc(t('no login'))}`} · ${esc(t('Today'))} ${today_.filter(x => x.status === 'done').length}/${today_.length}</span></span><span class="end">${btn('', 'staffedit', `data-id="${s.id}" aria-label="${esc(t('Edit'))}"`, 'sm', 'edit')}${btn(s.status === 'active' ? 'Deactivate' : 'Activate', 'staffstatus', `data-id="${s.id}"`, 'sm')}${s.status !== 'active' ? btn('', 'staffremove', `data-id="${s.id}" aria-label="${esc(t('Remove'))}"`, 'sm bad', 'trash') : ''}</span></div>`; }).join(''))}
      ${removed.length ? group('Removed (history kept)', removed.map(s => li({ icon: 'user', ic: 'mute', t: s.name, d: t('Removed on {d}', { d: fmtDate(s.removedOn) }), end: btn('Restore', 'staffrestore', `data-id="${s.id}"`, 'sm') })).join('')) : ''}
      ${group('', li({ icon: 'cal', ic: 'info', t: t('Room & floor assignments'), d: t('Set in schedules — each room can have its own staff.'), act: 'go', attrs: 'data-to="housekeeping"' }))}`;
  },
  wa: () => {
    const w = S().wa, L = w.lang === 'hi' ? 'hi' : 'en';
    return `${head('WhatsApp messages', t('No paid API: WhatsApp opens with the message typed, you just press Send.'))}
      ${settingsForm('wa', [{ name: 'auto', label: 'Open WhatsApp automatically after check-in, payment, laundry', type: 'checkbox', value: w.auto, full: true }, { name: 'lang', label: 'Message language', type: 'select', options: [{ v: 'en', l: 'English' }, { v: 'hi', l: 'हिन्दी' }, { v: 'auto', l: t('Each resident\'s choice') }], value: w.lang }], v => ({ wa: { auto: v.auto, lang: v.lang } }))}
      <div class="group-t">${esc(t('Payment reminders'))}</div>
      ${settingsForm('remind', [
        { name: 'on', label: 'Remind residents who have not paid', type: 'checkbox', value: w.remind.on !== false, full: true },
        { name: 'days', label: 'Days after the due date', value: (w.remind.days || [1, 5, 10]).join(', '), placeholder: '1, 5, 10',
          info: t('One reminder at each of these days after the oldest unpaid bill was due. Each is sent only once.') },
      ], v => {
        const days = [...new Set(v.days.split(/[\s,]+/).filter(Boolean).map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 60).sort((a, b) => a - b);
        if (v.on && !days.length) return 'Enter at least one day, e.g. 1, 5, 10';
        return { wa: { remind: { on: v.on, days } } };
      })}
      <div class="group-t">${esc(t('Monthly bill'))}${tip(esc(t('The only message sent automatically once WhatsApp is connected: each resident gets ONE message a month with rent and electricity together. It goes out after the room’s meter is read. Everything else (welcome, receipts, notices, reminders) opens WhatsApp for you to press Send.')))}</div>
      ${settingsForm('monthly', [
        { name: 'on', label: 'Send each resident one monthly bill (rent + electricity)', type: 'checkbox', value: (w.monthly || {}).on !== false, full: true },
        { name: 'fallbackDay', label: 'Send anyway from this day of the month', type: 'number', min: 1, max: 28, value: (w.monthly || {}).fallbackDay || 10, info: t('If a room’s meter has not been read by this day, the bill goes with rent only so the rent is not held up.') },
      ], v => ({ wa: { monthly: { on: v.on, fallbackDay: Math.min(28, Math.max(1, Math.round(+v.fallbackDay || 10))) } } }))}
      <div class="group-t">${esc(t('Connect your WhatsApp'))}${tip(esc(t('Scan one QR with your own phone (WhatsApp → Linked devices) and the monthly bill goes out from your own number, by itself. This is not the official WhatsApp API, so WhatsApp may block a number that sends a lot: messages are sent slowly, once a month, and only to your own residents.')))}</div>
      ${!CLOUD ? '' : `<div class="card"><div class="row sb nw"><span class="body"><b>${esc(t(w.gw.on && w.gw.kind === 'evolution' ? 'WhatsApp is connected' : 'Not connected'))}</b><span class="d" style="display:block">${esc(t('Messages go from your own number.'))}</span></span>${btn(w.gw.on && w.gw.kind === 'evolution' ? 'Show QR again' : 'Connect WhatsApp', 'wagwconnect', '', 'primary', 'wa')}</div></div>`}
      <div class="group-t">${esc(t('Send automatically (optional)'))}${tip(esc(t('WhatsApp has no free official API. A free open-source gateway (WAHA or Evolution API) that you run on your own computer, old phone or a free server can send the monthly bill by itself. It is unofficial: WhatsApp may block a number that sends a lot, so use a separate number. Without it, WhatsApp opens with the message typed and you tap Send.')))}</div>
      ${!CLOUD ? `<div class="card">${empty('Not available in demo mode')}</div>` : `<form class="card" id="wagw" novalidate autocomplete="off"><div class="fgrid">
        ${fieldHtml({ name: 'kind', label: 'Gateway', type: 'select', value: w.gw.kind || 'waha', options: [{ v: 'waha', l: 'WAHA (waha.devlike.pro)' }, { v: 'evolution', l: 'Evolution API' }] })}
        ${fieldHtml({ name: 'session', label: 'Session / instance name', value: '', placeholder: w.gw.kind === 'evolution' ? 'hostel' : 'default' })}
        ${fieldHtml({ name: 'url', label: 'Gateway address', full: true, placeholder: 'https://wa.yourname.workers.dev', info: t('Must be a public https address. A free Cloudflare Tunnel in front of the gateway is enough.') })}
        ${fieldHtml({ name: 'key', label: 'API key', type: 'password', placeholder: w.gw.on ? t('Saved — leave empty to keep') : '' })}
        ${fieldHtml({ name: 'test', label: 'Send a test message to', type: 'tel', placeholder: t('Your mobile number') })}
      </div><div class="ferr" id="wagw_err"></div>
      <div class="row" style="margin-top:14px">${w.gw.on ? `${badge('Connected', 'ok')}${btn('Turn off', 'wagwoff', '', 'sm bad')}` : badge('Off')}<span class="sp"></span>${btn('Save & test', 'wagwsave', '', 'primary')}</div></form>`}
      ${group(t('Templates ({l})', { l: L === 'hi' ? 'हिन्दी' : 'English' }), Object.entries(WA_KEYS).map(([k, l]) => li({ icon: 'chat', ic: (w.tpl[L] || {})[k] ? 'warn' : 'ok', t: t(l), d: (w.tpl[L] || {})[k] ? t('Customised') : t('Default'), act: 'edittpl', attrs: `data-k="${k}" data-l="${L}"` })).join(''), t('Placeholders like {name}, {total}, {paylink} are filled in automatically.'))}`;
  },
  police: () => {
    const p = S().police, cur = p.state || '';
    const link = pvPortal(cur);
    const pending = pvPending();
    return `${head('Police verification', t('The landlord is responsible for getting every tenant verified. This keeps track of it.'))}
      ${settingsForm('police', [
        { name: 'on', label: 'Track police verification for every resident', type: 'checkbox', value: p.on !== false, full: true },
        { name: 'state', label: 'State', type: 'select', value: cur,
          options: [{ v: '', l: t('Choose your state') }].concat(PV_STATES.map(([k, l]) => ({ v: k, l: t(l) }))) },
        { name: 'dueDays', label: 'Remind me if not submitted within (days)', type: 'number', min: 1, max: 90, value: p.dueDays || 7 },
        { name: 'url', label: 'Portal link for this state', value: link, full: true, placeholder: 'https://…',
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
    return `${head('Attendance & roll call', t('Everyone counts as present. You only mark the people who are not there.'))}
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
    const on = joinOn(), vOn = (S().gate || {}).selfEntry !== false;
    return `${head('QR codes for residents & visitors', t('People fill their own details on their own phone. Nothing reaches your records until you accept it.'))}
      ${group('New resident registration', [
        li({ icon: 'userplus', ic: on ? 'ok' : 'mute', t: t(on ? 'Self check-in is on' : 'Self check-in is off'),
            d: t('They fill in name, ID, guardian and documents. Room, rent and deposit stay with you.'), chev: false,
            end: `<label class="sw"><input type="checkbox" data-joinsw ${on ? 'checked' : ''} aria-label="${esc(t('Self check-in'))}"><span></span></label>` }),
        li({ icon: 'qr', ic: 'teal', t: t('Show the registration QR'), d: t('Print it, or send the link on WhatsApp'), act: 'joinqr' }),
        li({ icon: 'inbox', ic: pendingSignups().length ? 'warn' : 'mute', t: t('Waiting to be admitted'),
            d: pendingSignups().length ? t('{n} applications', { n: pendingSignups().length }) : t('Nothing waiting'),
            act: 'go', attrs: 'data-to="residents"', end: pendingSignups().length ? badge(String(pendingSignups().length), 'warn') : '' }),
      ].join(''), t('An application never becomes a resident on its own — you open it, pick the bed and set the rent.'))}
      ${can('gate') ? group('Visitors at the gate', [
        li({ icon: 'shield', ic: vOn ? 'ok' : 'mute', t: t(vOn ? 'Visitor self-entry is on' : 'Visitor self-entry is off'),
            d: t('Visitors sign themselves into the gate register.'), chev: false }),
        li({ icon: 'qr', ic: 'teal', t: t('Show the visitor QR'), d: t('Print it and put it at the gate'), act: 'gateqr' }),
      ].join('')) : ''}`;
  },
  /* The owner's own page, edited in pieces rather than as one giant form: a hostel fills this
   * in over a week, between other work, and a half-finished page is never published by
   * accident — the switch at the top refuses until the basics are there. */
  site: () => {
    const c = siteCfg(), gaps = siteGaps(), live = c.on === true;
    const rt = c.roomTypes || [], faq = c.faq || [], fac = c.facilities || [], st = c.stats || [];
    const link = siteUrl(), shortLink = link.replace(/^https?:\/\//, '');
    return `${head('Hostel page for enquiries', t('One public page you can send to anyone. They read about the hostel and message you on WhatsApp.'))}
      ${group('Publish', [
        li({ icon: 'globe', ic: live ? 'ok' : 'mute', t: t(live ? 'The page is live' : 'The page is not published'),
            d: live ? t('Anyone with the link can see it') : t('Only you can see it until you switch this on'), chev: false,
            end: `<label class="sw"><input type="checkbox" data-sitesw ${live ? 'checked' : ''} aria-label="${esc(t('Publish'))}"><span></span></label>` }),
        li({ icon: 'eye', ic: 'info', t: t('Preview the page'), d: t('Opens exactly what a visitor sees'), act: 'sitepreview' }),
        li({ icon: 'link', ic: 'teal', t: shortLink, d: t(live ? 'Tap to copy' : 'This will be the address once you publish'), act: 'sitecopy', raw: false }),
        live ? li({ icon: 'qr', ic: 'teal', t: t('Show the QR code'), d: t('Print it, or put it in an advert'), act: 'siteqr' }) : '',
      ].filter(Boolean).join(''), gaps.length ? t('Still missing: {m}.', { m: gaps.join(', ') }) : t('Everything a parent usually asks is on the page.'))}
      ${settingsForm('site', [
        { type: 'section', label: 'Address of the page' },
        { name: 'slug', label: 'Web address', value: siteSlug(), hint: siteDomain() ? `…${'.'}${siteDomain()}` : siteBase() ? `${siteBase().replace(/^https?:\/\//, '')}/h/…` : t('Used once your domain is connected.'),
          info: t('Lowercase letters, numbers and dashes. This is the part of the link that is your hostel’s name, so keep it short and easy to say on the phone.') },
        { type: 'section', label: 'Top of the page' },
        { name: 'tagline', label: 'Line under the name', value: c.tagline, hint: t('e.g. "Luxury Boys PG". Leave blank to show the area.') },
        { name: 'badge', label: 'Small badge', value: c.badge, hint: t('e.g. "Premium Boys PG in Jaipur". Leave blank to show the area.') },
        { name: 'headline', label: 'Headline', value: c.headline, full: true, hint: t('e.g. "Luxury AC Boys PG in Tonk Phatak, Jaipur". Everything after the word "in" is shown in gold.') },
        { name: 'sub', label: 'Short line under the headline', type: 'textarea', value: c.sub, full: true, hint: t('Optional. Leave blank to use the first sentence of the description.') },
        { type: 'section', label: 'About the hostel' },
        { name: 'aboutTitle', label: 'About heading', value: c.aboutTitle, full: true, hint: t('e.g. "A Premium Boys PG Designed for Your Comfort". Leave blank for "Welcome to {n}".', { n: hostelName() }) },
        { name: 'about', label: 'Description', type: 'textarea', value: c.about, full: true, hint: t('Three or four sentences. Who it is for, what makes it good.') },
        { name: 'ratingScore', label: 'Google rating (out of 5)', type: 'number', min: 0, max: 5, step: 0.1, value: c.ratingScore, hint: t('Optional. Leave blank to hide the rating card.') },
        { name: 'ratingText', label: 'Rating note', value: c.ratingText, hint: t('e.g. "Rated by 330+ guests on Google"') },
        { type: 'section', label: 'Location & contact' },
        { name: 'area', label: 'Area / landmark', value: c.area, hint: t('e.g. "Tonk Phatak, Jaipur". Shown as the location heading.') },
        { name: 'address', label: 'Full address', type: 'textarea', value: c.address, full: true, hint: t('Leave blank to use the address from Profile.') },
        { name: 'mapLatLng', label: 'Map location (latitude, longitude)', value: c.mapLatLng, full: true,
          hint: t('e.g. 26.9124, 75.7873 — in Google Maps press and hold on your hostel, then tap the numbers to copy them. The “Get Directions” button then opens Google Maps and starts navigation straight away.') },
        { name: 'mapUrl', label: 'Google Maps link', value: c.mapUrl, full: true, hint: t('Optional. Used if you leave the location above blank. A full link (not a short maps.app.goo.gl one) also gives one-tap navigation.') },
        { name: 'wa', label: 'WhatsApp number for enquiries', type: 'tel', value: c.wa, hint: t('Leave blank to use the hostel number from Profile & UPI.') },
        { name: 'callNo', label: 'Call number', type: 'tel', value: c.callNo, hint: t('Leave blank to call the WhatsApp number.') },
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
      ${group('Photos', SITE_PHOTOS.map(([k, label, hint]) => {
        const url = sitePhotoUrl(k, 160), set = !!url;
        return `<div class="li">
          <span class="ic ${set ? '' : 'mute'}" ${set ? 'style="padding:0;overflow:hidden"' : ''}>${set ? `<img src="${esc(url)}" alt="" class="thumb" loading="lazy">` : ico('camera')}</span>
          <span class="body"><span class="t">${esc(t(label))}${k === 'hero' ? ' ' + badge('Header', 'acc') : ''}</span>
            <span class="d ell">${set ? esc(sitePhotoRaw(k)) : esc(t(hint || 'Not added yet'))}</span></span>
          <span class="end">${btn(set ? 'Change' : 'Add link', 'sitephoto', `data-k="${k}"`, 'sm' + (set ? '' : ' primary'))}${set ? btn('', 'sitephotodel', `data-k="${k}" aria-label="${esc(t('Remove'))}"`, 'sm bad', 'trash') : ''}</span></div>`;
      }).join(''), t('Nothing is uploaded. Put your photos in a Google Drive folder shared as \u201cAnyone with the link\u201d, then paste each photo\u2019s share link here \u2014 we only keep the link.'))}
      ${group('Rooms & price', rt.map((x, i) => li({ icon: 'bed', ic: 'info', t: `${x.l} · ${inr(x.price)}`, d: x.note || t('per bed, per month'), act: 'siterte', attrs: `data-i="${i}"` })).join('')
        + `<div class="li noic"><span class="body"><a href="#" data-act="siterte">+ ${esc(t('Add a room type'))}</a></span></div>`,
        t('This is what people compare first. Keep it honest — the price on the page is the price you will be asked for.'))}
      ${group('Facilities', fac.map((x, i) => `<div class="li noic"><span class="body"><span class="t">${esc(x)}</span></span>${btn('', 'sitefacd', `data-i="${i}" aria-label="${esc(t('Delete'))}"`, 'sm ghost', 'trash')}</div>`).join('')
        + `<div class="li noic"><input id="site_fac" placeholder="${esc(t('Wi-Fi, hot water, CCTV…'))}" style="flex:1"><button class="btn sm primary" data-act="sitefaca">${esc(t('Add'))}</button></div>`
        + `<div class="li noic"><span class="body"><span class="d">${esc(t('Quick add'))}</span><div class="row wrap" style="gap:6px;margin-top:6px">${SITE_FAC_IDEAS.filter(x => !fac.some(f => f.toLowerCase() === x.toLowerCase())).map(x => `<button class="chip" type="button" data-act="sitefacq" data-v="${esc(x)}">+ ${esc(x)}</button>`).join('')}</div></span></div>`,
        t('The first three also appear as badges at the top. Add a detail in brackets to show it small under the name, e.g. All Meals (Breakfast, Lunch & Dinner).'))}
      ${group('Key numbers', st.map((x, i) => li({ icon: 'bolt', ic: 'teal', t: `${x.v} · ${x.l}`, act: 'sitestat', attrs: `data-i="${i}"` })).join('')
        + (st.length < 4 ? `<div class="li noic"><span class="body"><a href="#" data-act="sitestat">+ ${esc(t('Add a number'))}</a></span></div>` : ''),
        t('The dark bar under the photos, e.g. "330+ · Happy residents". Up to four. Leave empty to show your price, room types and facilities instead.'))}
      ${group('Common questions', faq.map((x, i) => li({ icon: 'chat', ic: 'teal', t: x.q, d: x.a, act: 'sitefaqe', attrs: `data-i="${i}"` })).join('')
        + `<div class="li noic"><span class="body"><a href="#" data-act="sitefaqe">+ ${esc(t('Add a question'))}</a></span></div>`,
        t('Answer here what people ask you on the phone every day — notice period, food, visitors, timings. It saves you the call.'))}`;
  },
  data: () => `${head('Backup & export')}${group('', [li({ icon: 'download', ic: 'ok', t: t('Download full backup (JSON)'), d: t('{n} records', { n: Store.docs.size }), act: 'backup' }), li({ icon: 'download', ic: 'info', t: t('Residents (CSV)'), act: 'exportres' }), li({ icon: 'download', ic: 'warn', t: t('Payments (CSV)'), act: 'exportpay' }), li({ icon: 'download', ic: 'pink', t: t('Expenses (CSV)'), act: 'exportexp' }), li({ icon: 'sync', ic: 'mute', t: t('Sync now'), act: 'syncnow' })].join(''))}${!CLOUD ? group('Demo', li({ icon: 'trash', ic: 'bad', t: t('Reset demo data'), act: 'resetdemo' })) : ''}${CLOUD && isDemoHostel() && isSuper() ? group('Demo hostel', [li({ icon: 'layers', ic: 'ok', t: t('Fill with demo data'), d: t('Rooms, residents, bills, payments, kitchen, laundry, staff and more — all made up. Phone numbers are fake, so nothing can reach a real person.'), act: 'demofill' }), li({ icon: 'trash', ic: 'bad', t: t('Wipe all demo data'), d: t('Deletes every record in this demo hostel so you can fill it again.'), act: 'demowipe' })].join(''), t('Only the platform admin sees this, and only on a hostel marked as the demo.')) : ''}`,
  users: () => usersPage(),
};
A.messtab = el => { ui.tab.mess = el.dataset.tab; go('mess'); };
// The key is minted the first time the QR is shown, so a hostel that never uses this has no
// public door open at all. Regenerating it makes every copy already handed out stop working.
A.joinqr = async (el, e, fresh) => {
  if (!isAdmin()) return toast('Only the owner or manager can manage this QR', 'bad');
  if (!joinKey() || fresh) await Store.saveSettings({ join: { on: true, key: newQrKey() } });
  if (typeof qrcode !== 'function') await loadScript('/vendor/qrcode.js').catch(() => {});
  const url = joinUrl();
  sheet('New resident registration QR', `<div class="qr">${qrSvg(url, 6)}</div>
    <p style="text-align:center;margin:10px 0 4px"><b>${esc(hostelName())}</b></p>
    <p class="hint" style="text-align:center">${esc(t('The resident scans this, fills the form on their own phone, and appears under “Waiting to be admitted” on your Residents screen.'))}</p>
    <div class="row wrap" style="justify-content:center;gap:8px;margin-top:14px">
      ${btn('Print', 'print', '', 'sm', 'download')}${btn('Copy link', 'joinqrcopy', '', 'sm', 'copy')}
      ${btn('Send on WhatsApp', 'joinqrwa', '', 'sm wa', 'wa')}
      ${btn('New QR (old stops working)', 'joinqrnew', '', 'sm bad')}
    </div>`);
};
A.joinqrcopy = async () => { try { await navigator.clipboard.writeText(joinUrl()); toast('Link copied'); } catch (e) { sheet('Link', `<pre class="pre-wrap">${esc(joinUrl())}</pre>`); } };
A.joinqrwa = () => { closeModal(true); waOpen('', `${t('Hello')},\n\n${t('Please fill in your details for')} *${hostelName()}* ${t('using this link')}:\n${joinUrl()}\n\n${t('Regards')},\n${hostelName()}`, 'Send the form'); };
A.joinqrnew = () => confirmBox(t('Make a new QR? Copies of the old one will stop working.'), () => A.joinqr(null, null, true), 'New QR', 'bad');
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
// The tab must be opened synchronously or the pop-up blocker eats it, then pointed at the
// ten-minute signed link once Storage hands one back.
A.opendoc = async el => {
  if (!el.dataset.path) { toast('That document is not on file yet', 'bad'); return; }
  const w = window.open('', '_blank');
  try { const url = await Files.url(el.dataset.path); if (w) w.location = url; else location.href = url; }
  catch (e) { if (w) w.close(); toast(e.message || 'Could not open that document', 'bad'); }
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
const ROLE_CHOICES = ['manager', 'accountant', 'cook', 'housekeeping', 'laundry', 'guard', 'staff', 'resident'];
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
A.sitewa = () => { closeModal(true); waOpen('', `${t('Hello')},\n\n${t('Here is the page for')} *${hostelName()}*:\n${siteUrl()}\n\n${t('Regards')},\n${hostelName()}`, 'Share the page'); };

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
  const k = el.dataset.k, row = SITE_PHOTOS.find(x => x[0] === k); if (!row) return;
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
  fields: [{ name: 'full_name', label: 'Full name', required: true }, { name: 'phone', label: 'Mobile', type: 'tel', required: true }, { name: 'role', label: 'Role', type: 'select', options: ROLE_CHOICES.filter(r => r !== 'resident').map(r => ({ v: r, l: t(ROLES[r].l) })) },
    ...blockField(''),
    { name: 'perms', label: 'Extra modules (optional)', type: 'multi', options: MODULES.filter(m => !['home', 'settings'].includes(m.k) && orgEnabled(m.k)).map(m => ({ v: m.k, l: t(m.l) })), full: true },
    { name: 'existing', label: 'This person already has a login (add role only)', type: 'checkbox' }, { name: 'username', label: 'Their user ID', hidden: true }],
  onChange: (v, f) => { showField(f, 'username', v.existing); showField(f, 'phone', !v.existing); showField(f, 'full_name', !v.existing); },
  onSubmit: async v => {
    const h = Store.hostel();
    if (v.existing) { if (!v.username) return 'Enter their user ID'; await Backend.admin('add_member', { username: v.username, org_id: h.org_id, hostel_id: h.id, role: v.role, perms: v.perms, block: v.block }); toast('Access added'); }
    else { const u = await Backend.admin('create_user', { full_name: v.full_name, phone: v.phone, org_id: h.org_id, hostel_id: h.id, role: v.role, perms: v.perms, block: v.block }); closeModal(); ui.users = null; render(); waOpen(v.phone, tpl('staffWelcome', { name: v.full_name.split(' ')[0], role: t(ROLES[v.role].l), hostel: hostelName(), link: appUrl(), username: u.username, password: u.password }), 'Send login'); return false; }
    ui.users = null;
  },
});
A.useredit = el => {
  const m = ui.users.members.find(x => x.id === el.dataset.id), p = ui.users.profiles.find(x => x.id === m.user_id) || {};
  const defaults = (ROLES[m.role] || ROLES.staff).mods;
  formModal({
    title: `${p.full_name} · @${p.username}`, submit: 'Save access',
    note: t('Default for {r}: {m}', { r: t(ROLES[m.role].l), m: defaults.map(k => t((MOD[k] || { l: k }).l)).join(', ') || '—' }),
    fields: [{ name: 'role', label: 'Role', type: 'select', options: ROLE_CHOICES.map(r => ({ v: r, l: t(ROLES[r].l) })), value: m.role },
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
