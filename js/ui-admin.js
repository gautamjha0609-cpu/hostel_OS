'use strict';
/* Super admin: clients (orgs) → hostels, module switches, plans, logins, usage & health. */

// Quick contact buttons. The anchors carry data-act="noop" so a tap on them never opens the row they sit in.
A.noop = () => {};
const telDigits = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? d : d.slice(-10); };
function contactBtns(phone, email, small = true) {
  const d = telDigits(phone), c = small ? 'btn sm' : 'btn';
  return `<span class="row" style="gap:6px;flex-wrap:nowrap">${d.length === 10 ? `<a class="${c}" data-act="noop" href="tel:+91${d}" aria-label="${esc(t('Call'))}" title="${esc(t('Call'))}">${ico('phone', 'sm')}</a><a class="${c}" data-act="noop" href="https://wa.me/91${d}" target="_blank" rel="noopener" aria-label="WhatsApp" title="WhatsApp">${ico('wa', 'sm')}</a>` : ''}${email ? `<a class="${c}" data-act="noop" href="mailto:${esc(email)}" aria-label="${esc(t('Email'))}" title="${esc(t('Email'))}">${ico('mail', 'sm')}</a>` : ''}</span>`;
}
// Google Maps with directions to the hostel: exact coordinates when known, else the address.
const mapsUrl = h => { const dest = h.lat != null && h.lng != null && h.lat !== '' && h.lng !== '' ? `${h.lat},${h.lng}` : [h.name, h.address, h.city].filter(Boolean).join(', '); return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`; };
const coordNum = n => (n === '' || n == null || isNaN(n) ? null : +n);
const geoFields = (lat, lng) => [
  { name: 'lat', label: 'Latitude', type: 'number', step: 0.000001, min: -90, max: 90, value: lat ?? '', placeholder: 'e.g. 26.912434' },
  { name: 'lng', label: 'Longitude', type: 'number', step: 0.000001, min: -180, max: 180, value: lng ?? '', placeholder: 'e.g. 75.787270' },
  { type: 'html', html: `<button type="button" class="btn sm" data-act="geoloc">${ico('globe', 'sm')} ${esc(t('Use my current location'))}</button> <span class="hint">${esc(t('Or copy the numbers from Google Maps (long-press the spot).'))}</span>` },
];
A.geoloc = el => {
  const form = el.closest('form'); if (!form) return;
  if (!navigator.geolocation) return toast(t('This device cannot give its location'), 'bad');
  navigator.geolocation.getCurrentPosition(p => { form.elements.lat.value = p.coords.latitude.toFixed(6); form.elements.lng.value = p.coords.longitude.toFixed(6); toast(t('Location filled in'), 'ok'); }, () => toast(t('Could not get the location. Allow location access and try again.'), 'bad'), { enableHighAccuracy: true, timeout: 10000 });
};
const superOnly = { when: () => isSuper() && !ctx().hostelId };
const adm = { data: null, loading: false };
/* PostgREST answers at most 1000 rows per request and silently stops there, and every row costs
 * egress on the free plan. So nothing that grows with the business is read in one go: owners and
 * staff (a handful per client) are loaded up front in pages, the profiles of exactly those people
 * by id, and resident logins (hundreds per hostel) only when the All users screen asks for them. */
async function admAll(table, q = '', per = 500, max = 40) {
  const out = [];
  for (let i = 0; i < max; i++) { const b = await Backend.list(table, `${q}&limit=${per}&offset=${i * per}`); out.push(...b); if (b.length < per) break; }
  return out;
}
async function admProfilesFor(ids, have = []) {
  const known = new Set(have.map(p => p.id)), want = [...new Set(ids)].filter(x => x && !known.has(x)), out = [];
  for (let i = 0; i < want.length; i += 80) out.push(...await Backend.list('profiles', `&id=in.(${want.slice(i, i + 80).join(',')})`));
  return out;
}
// The size split comes from db_usage(); a project that has not run that migration still answers db_size_mb.
async function admUsage() {
  try { const r = await Backend.rpc('db_usage'), x = Array.isArray(r) ? r[0] : r; if (x && x.total_mb != null) return { total: +x.total_mb, data: +x.data_mb }; } catch (e) { /* older database */ }
  const s = await Backend.rpc('db_size_mb').catch(() => null);
  return s == null ? null : { total: +s, data: null };
}
async function admLoad(force) {
  if (adm.loading || (adm.data && !force)) return;
  adm.loading = true; adm.res = { started: false, loading: false, done: false, offset: 0 };
  try {
    /* Backups and Drive go through /api/admin, which has to verify the caller's token with
     * Supabase before it does anything — about a second each, against ~110 ms for a direct
     * REST read. Waiting for them inside this Promise.all held the whole console back by that
     * second, every single time it opened, to fill in two side panels. They are started here
     * but awaited separately, and the screen is drawn as soon as the rest is in. */
    const slow = {
      backups: CLOUD ? Backend.admin('backup_list').catch(() => null) : Promise.resolve(null),
      drive: CLOUD ? Backend.admin('drive_status').catch(() => null) : Promise.resolve(null),
    };
    // The super admins do not depend on anything else here, so they are fetched alongside
    // rather than after. Only admProfilesFor has to wait — it needs the member list first.
    const supersP = Backend.list('profiles', '&is_super=eq.true');
    const [orgs, hostels, members, stats, usage, files] = await Promise.all([Backend.rpc('my_orgs_billing'), Backend.list('hostels', '&order=name'), admAll('members', '&role=neq.resident&order=id'), Backend.rpc('admin_stats').catch(() => []), admUsage(), CLOUD ? Backend.rpc('doc_files_usage').catch(() => null) : null]);
    const supers = await supersP;
    const profiles = [...supers, ...await admProfilesFor(members.map(m => m.user_id), supers)];
    adm.data = { orgs, hostels, profiles, members, stats: stats || [], size: usage ? usage.total : null, usage, files, backups: undefined, drive: undefined, at: Date.now() };
    Store.orgs = orgs; Store.hostels = hostels;
    // `undefined` above means "still coming"; the cards show a skeleton until these land.
    Promise.all([slow.backups, slow.drive]).then(([backups, drive]) => {
      if (!adm.data || adm.data.error) return;
      adm.data.backups = backups; adm.data.drive = drive;
      if (ui.page && ui.page.startsWith('admin')) render();
    });
  } catch (e) { adm.data = { error: e.message }; }
  adm.loading = false; render();
}
// Resident logins, 200 at a time, added to the same lists the rest of the screen already searches.
async function admResidents() {
  const r = adm.res; if (!adm.data || r.loading || r.done) return;
  r.started = r.loading = true;
  try {
    const per = 200, ms = await Backend.list('members', `&role=eq.resident&order=id&limit=${per}&offset=${r.offset}`);
    const seen = new Set(adm.data.members.map(m => m.id)); for (const m of ms) if (!seen.has(m.id)) adm.data.members.push(m);
    adm.data.profiles.push(...await admProfilesFor(ms.map(m => m.user_id), adm.data.profiles));
    r.offset += ms.length; if (ms.length < per) r.done = true;
  } catch (e) { toast(e.message, 'bad'); r.done = true; }
  r.loading = false; render();
}
const admWait = title => { admLoad(); return `${head(title)}<div class="stack"><div class="skel"></div><div class="skel"></div></div>`; };
const admErr = () => `<div class="card">${empty('Could not load', adm.data.error, btn('Try again', 'admreload'))}</div>`;
const statOf = id => (adm.data.stats || []).find(s => s.hostel_id === id) || { residents: 0, rows: 0 };
A.admreload = () => { adm.data = null; render(); };

PAGES.admin = {
  title: 'Clients & hostels', ...superOnly,
  render(id) {
    if (!adm.data) return admWait('Clients & hostels');
    if (adm.data.error) return admErr();
    if (id) return orgDetail(id);
    const { orgs, hostels } = adm.data;
    const f = curFlt('org', 'all');
    const list = orgs.filter(o => (f === 'all' || o.status === f) && needle('org', o.name, o.owner_name, o.phone, o.city));
    const mrr = sum(orgs.filter(o => o.status === 'active'), o => +o.fee || 0), dueSoon = orgs.filter(o => o.paid_till && o.paid_till < addDays(today(), 5));
    return `${head('Clients & hostels', t('{c} clients · {h} hostels · {r} residents', { c: orgs.length, h: hostels.length, r: sum(hostels, h => +statOf(h.id).residents || 0) }), `${btn('', 'admreload', `aria-label="${esc(t('Refresh'))}"`, '', 'sync')}${btn('New client', 'addorg', '', 'primary', 'plus')}`)}
      ${healthBanner()}
      ${homeHero({
        name: Store.me ? Store.me.full_name.split(' ')[0] : '', sub: esc(t('{c} clients · {h} hostels · {r} residents', { c: orgs.length, h: hostels.length, r: sum(hostels, h => +statOf(h.id).residents || 0) })),
        cards: [
          { l: 'Active clients', icon: 'building', v: orgs.filter(o => o.status === 'active').length, tone: 'ok', s: esc(t('{n} suspended', { n: orgs.filter(o => o.status === 'suspended').length })) },
          { l: 'Yearly revenue', icon: 'rupee', v: inr(mrr), s: esc(t('from active clients')) },
        ],
        strip: [
          { icon: 'building', v: hostels.length, l: 'Hostels' },
          { icon: 'cal', v: dueSoon.length, l: 'Renewal due' },
          { icon: 'chart', v: adm.data.size != null ? adm.data.size + ' MB' : '-', l: 'Database', bar: adm.data.size != null ? adm.data.size / 5 : null },
        ],
      })}
      <div class="tool">${searchBox('org', 'Search client, owner, city')}${chips('org', [['all', 'All'], ['active', 'Active'], ['suspended', 'Suspended']], 'all')}</div>
      ${list.length ? `<div class="group">${list.map(o => { const hs = hostels.filter(h => h.org_id === o.id); return li({ lead: avatar(o.name), t: o.name, d: `${o.owner_name || ''} · ${o.phone || ''} · ${t('{n} hostels', { n: hs.length })} · ${t('{n} residents', { n: sum(hs, h => +statOf(h.id).residents || 0) })}`, end: `${contactBtns(o.phone, o.email)}${o.status === 'suspended' ? badge('Suspended', 'bad') : o.paid_till && o.paid_till < today() ? badge('Fee overdue', 'warn') : badge(inr(o.fee) + '/yr', 'ok')}`, act: 'go', attrs: `data-to="admin/${o.id}"` }); }).join('')}</div>` : `<div class="card">${empty('No clients yet', 'Add your first PG owner.')}</div>`}`;
  },
};
/* What the client-level switch shows. The client's switch is the ceiling, and each hostel can be switched off
 * below it. Showing only the ceiling made the client page say "Police verification: on" for a client whose only
 * hostel had it off. So the switch reads ON only while the client has it AND at least one hostel really uses it. */
function orgModState(orgMods, hs, k) {
  const ceiling = (orgMods || {})[k] !== false, offIn = ceiling ? hs.filter(h => (h.modules || {})[k] === false).length : 0;
  return { on: ceiling && !(hs.length && offIn === hs.length), offIn };
}
function orgDetail(id) {
  const o = adm.data.orgs.find(x => x.id === id); if (!o) return `<div class="card">${empty('Client not found')}</div>`;
  const hs = adm.data.hostels.filter(h => h.org_id === id);
  const ms = adm.data.members.filter(m => m.org_id === id), prof = uid_ => adm.data.profiles.find(p => p.id === uid_) || {};
  const mods = o.modules || {};
  return `<div class="row" style="margin:6px 0 10px">${btn('Clients', 'go', 'data-to="admin"', 'ghost sm', 'back')}</div>
    ${head(o.name, `${esc(o.owner_name || '')} · ${esc(o.phone || '')} · ${esc(o.city || '')}${o.address ? '<br>' + esc(o.address) : ''}`, `${btn('Edit', 'editorg', `data-id="${id}"`, '', 'edit')}${btn(o.status === 'active' ? 'Suspend' : 'Activate', 'orgstatus', `data-id="${id}"`, o.status === 'active' ? 'bad' : 'ok', 'power')}`)}
    <div class="row" style="gap:8px;margin:-2px 0 12px;align-items:center">${contactBtns(o.phone, o.email, false)}<span class="hint">${esc(o.email || t('No client e-mail saved. Add it with Edit.'))}</span></div>
    <div class="grid g2">
      <div class="stack">
        ${group('Hostels / PGs', hs.map(h => { const s = statOf(h.id); return li({
          icon: 'building', ic: h.status === 'active' ? 'info' : 'mute',
          t: h.name, raw: false,
          d: [h.city, h.warden_phone ? t('Warden {p}', { p: h.warden_phone }) : '', t('{n} residents', { n: s.residents || 0 }), t('{n} records', { n: s.rows || 0 }),
              s.last_activity ? t('active {t}', { t: ago(s.last_activity) }) : ''].filter(Boolean).join(' · '),
          act: 'go', attrs: `data-to="admin-hostel/${h.id}"`,
          end: h.status === 'active' ? '' : badge('Inactive'),
        }); }).join('') + (hs.length < o.max_hostels ? `<div class="li noic"><span class="body"><a href="#" data-act="addhostel" data-org="${id}">+ ${esc(t('Add hostel'))}</a><span class="d">${esc(t('{a} of {b} allowed', { a: hs.length, b: o.max_hostels }))}</span></span></div>` : `<div class="li noic"><span class="body"><span class="d">${esc(t('Hostel limit reached ({n}). Edit the client to raise it.', { n: o.max_hostels }))}</span></span></div>`), t('Open a hostel to edit it, set its blocks and modules, and manage the people who log into it.'))}
        ${group('Plan & billing', [li({ icon: 'rupee', ic: 'ok', t: `${inr(o.fee)} / ${t('year')}`, d: `${t(o.plan || 'standard')} · ${t('paid till')} ${o.paid_till ? fmtDate(o.paid_till) : '—'}`, act: 'orgpaid', attrs: `data-id="${id}"`, end: badge('Mark paid', 'acc') }), li({ icon: 'cal', ic: 'info', t: t('Change fee or paid-till date'), d: t('Edit the client'), act: 'editorg', attrs: `data-id="${id}"` }), li({ icon: 'bed', ic: 'info', t: t('Max {n} beds', { n: o.max_beds }), d: t('Max {n} hostels', { n: o.max_hostels }) })].join(''))}
      </div>
      <div class="stack">
        ${(() => {
          const wide = ms.filter(m => !m.hostel_id && m.role !== 'resident');
          const perHostel = ms.filter(m => m.hostel_id && m.role !== 'resident').length;
          return group('Client-wide logins', wide.map(m => userRow(m, prof(m.user_id), t('Every hostel of this client'))).join('')
            + `<div class="li noic"><span class="body"><a href="#" data-act="addowner" data-org="${id}">+ ${esc(t('Add owner / manager'))}</a></span></div>`,
            t('{n} more logins belong to one hostel each. Residents get theirs automatically at check-in. Open a hostel to manage both.', { n: perHostel }));
        })()}
        <div class="row">${btn('Delete client', 'delorg', `data-id="${id}"`, 'bad sm', 'trash')}</div>
      </div>
    </div>`;
}
A.addorg = () => formModal({
  title: 'New client', submit: 'Create client', wide: true, note: t('Creates the client, their first hostel and the owner login in one step.'),
  fields: [
    { type: 'section', label: 'Client' }, { name: 'name', label: 'Business name', required: true, maxlength: 80, plain: true }, { name: 'city', label: 'City', maxlength: 60 }, { name: 'oaddr', label: 'Office address', full: true, maxlength: 240, plain: true }, { name: 'oemail', label: 'Client e-mail', type: 'email', maxlength: 100, placeholder: 'name@example.com' },
    { name: 'fee', label: 'Yearly fee (₹)', type: 'number', min: 0, max: 10000000, value: 499 }, { name: 'max_hostels', label: 'Max hostels', type: 'number', min: 1, max: 100, value: 3 },
    { type: 'section', label: 'First hostel' }, { name: 'hname', label: 'Hostel / PG name', required: true, maxlength: 80, plain: true }, { name: 'haddr', label: 'Address', maxlength: 240 },
    ...geoFields().map(x => (x.name ? { ...x, name: x.name === 'lat' ? 'hlat' : 'hlng' } : x)), { name: 'hwarden_phone', label: 'Warden contact number', type: 'tel', maxlength: 10, placeholder: '10-digit mobile' },
    { type: 'section', label: 'Owner login' }, { name: 'oname', label: 'Owner name', required: true, maxlength: 80 }, { name: 'ophone', label: 'Owner mobile', type: 'tel', required: true, maxlength: 10, placeholder: '10-digit mobile' },
    { name: 'ouser', label: 'User ID', required: true, pattern: /^[a-z0-9][a-z0-9._\-]{2,29}$/,
      info: t('Default is their 10-digit mobile number. They can manage all their hostels under this login.') },
    { name: 'opass', label: 'Password', required: true },
    { name: 'mods', label: 'Modules', type: 'multi', options: OPTIONAL_MODULES.map(k => ({ v: k, l: t(k === 'residentApp' ? 'Resident app' : MOD[k].l) })), value: OPTIONAL_MODULES, full: true },
  ],
  onChange: loginFollow2('oname', 'ophone', 'ouser', 'opass'),
  onSubmit: async v => {
    if (String(v.opass).length < 6) return 'Password must be at least 6 characters';
    const modules = {};
    const r = await Backend.admin('create_org', { org: { name: v.name, city: v.city, fee: v.fee || 0, max_hostels: v.max_hostels || 1, modules }, hostel: { name: v.hname, city: v.city, address: v.haddr }, owner: { full_name: v.oname, phone: v.ophone, username: v.ouser, password: v.opass } });
    closeModal(); adm.data = null; go('admin/' + r.org.id);
    credsSheet(t('{n} can now log in', { n: v.oname.split(' ')[0] }), v.oname, v.ophone, r.owner.username, r.owner.password,
      r.owner.username !== v.ouser ? t('That user ID was taken, so it was given a number — this is the one that works.') : '');
    return false;
  },
});
A.editorg = el => {
  const o = adm.data.orgs.find(x => x.id === el.dataset.id);
  formModal({ title: 'Edit client', fields: [{ name: 'name', label: 'Business name', value: o.name, required: true, maxlength: 80, plain: true }, { name: 'owner_name', label: 'Owner name', value: o.owner_name, maxlength: 80 }, { name: 'phone', label: 'Owner mobile', type: 'tel', value: o.phone, maxlength: 10, placeholder: '10-digit mobile' }, { name: 'city', label: 'City', value: o.city, maxlength: 60 }, { name: 'address', label: 'Office address', value: o.address || '', full: true, maxlength: 240, plain: true }, { name: 'email', label: 'Client e-mail', type: 'email', value: o.email || '', maxlength: 100 }, { name: 'plan', label: 'Plan', type: 'select', options: ['trial', 'standard', 'premium'], value: o.plan }, { name: 'fee', label: 'Yearly fee (₹)', type: 'number', min: 0, value: o.fee }, { name: 'paid_till', label: 'Paid till', type: 'date', value: o.paid_till, min: '2020-01-01', max: addDays(today(), 366 * 5), info: t('The last day the client has paid for. Clear it if no fee is due.') }, { name: 'max_hostels', label: 'Max hostels', type: 'number', min: 1, value: o.max_hostels }, { name: 'max_beds', label: 'Max beds', type: 'number', min: 1, value: o.max_beds }, { name: 'notes', label: 'Notes', type: 'textarea', value: o.notes, full: true }],
    onSubmit: async v => { if (v.paid_till && (v.paid_till < '2020-01-01' || v.paid_till > addDays(today(), 366 * 5))) return t('Paid till looks wrong ({d}). It can be at most 5 years from today.', { d: fmtDate(v.paid_till) }); if (v.email && !isValidEmail(v.email)) return t('Enter a valid client e-mail'); const patch = { ...v, phone: phone10(v.phone), email: v.email || null, address: v.address || null, paid_till: v.paid_till || null }; await Backend.update('orgs', o.id, patch); Object.assign(o, patch); toast('Saved'); } });
};
A.orgstatus = el => { const o = adm.data.orgs.find(x => x.id === el.dataset.id), next = o.status === 'active' ? 'suspended' : 'active'; confirmBox(next === 'suspended' ? t('Suspend {n}? Their staff and residents cannot log in until you activate again. Data is kept.', { n: o.name }) : t('Activate {n}?', { n: o.name }), async () => { await Backend.update('orgs', o.id, { status: next }); o.status = next; toast(next === 'active' ? 'Activated' : 'Suspended'); }, next === 'active' ? 'Activate' : 'Suspend', next === 'active' ? 'ok' : 'bad'); };
// The date the client has paid till once `years` more are added (counted from today when nothing is paid ahead). Plans are yearly.
const paidTillAfter = (o, years) => { const base = o.paid_till && o.paid_till > today() ? o.paid_till : today(); const d = parse(base); d.setFullYear(d.getFullYear() + (Math.min(5, Math.max(1, Math.round(years))) || 1)); return iso(d); };
A.orgpaid = el => { const o = adm.data.orgs.find(x => x.id === el.dataset.id); formModal({ title: 'Record client payment', fields: [{ name: 'years', label: 'Years paid', type: 'number', min: 1, max: 5, value: 1 }], note: t('Adds to the date the client has already paid till. To correct a wrong date, use Edit.'), preview: v => (v.years >= 1 && v.years <= 5 ? `<div class="note">${esc(t('Paid till {d}', { d: fmtDate(paidTillAfter(o, v.years)) }))}</div>` : `<div class="note">${esc(t('Enter 1 to 5 years.'))}</div>`), onSubmit: async v => { if (!Number.isInteger(v.years)) return t('Enter whole years, 1 to 5.'); const pt = paidTillAfter(o, v.years); await Backend.update('orgs', o.id, { paid_till: pt }); o.paid_till = pt; toast(t('Paid till {d}', { d: fmtDate(pt) })); } }); };
A.delorg = el => { const o = adm.data.orgs.find(x => x.id === el.dataset.id); formModal({ title: 'Delete client', submit: 'Delete forever', note: t('This deletes {n}, all their hostels, ALL data and their logins (the user IDs become free again). It cannot be undone. Download backups first.', { n: o.name }), fields: [{ name: 'confirm', label: 'Type the client name to confirm', required: true }], onSubmit: async v => { if (v.confirm.trim() !== o.name) return 'Name does not match'; await Backend.remove('orgs', o.id); adm.data = null; closeModal(); go('admin'); toast('Client deleted'); return false; } }); };
// One client cannot have two hostels with the same name (case and spacing do not make a new name).
const sameHostelName = (orgId, name, exceptId) => { const k = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); return (adm.data.hostels || []).some(h => h.org_id === orgId && h.id !== exceptId && k(h.name) === k(name)); };
A.addhostel = el => formModal({ title: 'Add hostel', fields: [{ name: 'name', label: 'Hostel / PG name', required: true, plain: true }, { name: 'city', label: 'City' }, { name: 'address', label: 'Address', full: true }, ...geoFields(), { name: 'warden_phone', label: 'Warden contact number', type: 'tel', maxlength: 10, placeholder: '10-digit mobile' }], onSubmit: async v => { if (sameHostelName(el.dataset.org, v.name)) return t('This client already has a hostel called "{n}". Use a different name.', { n: v.name }); await Backend.insert('hostels', { org_id: el.dataset.org, ...v, lat: coordNum(v.lat), lng: coordNum(v.lng), warden_phone: phone10(v.warden_phone) || null, status: 'active', settings: {} }); adm.data = null; toast('Hostel added'); } });
// Only the four columns a browser is allowed to PATCH on a hostel. Status is the platform
// admin's and has its own switch on the console, through set_hostel_admin.
A.edithostel = el => { const h = admHostel(el.dataset.id); if (!h) return; formModal({
  title: 'Edit hostel', submit: 'Save',
  fields: [{ name: 'name', label: 'Hostel / PG name', value: h.name, required: true, full: true, plain: true },
    { name: 'city', label: 'City', value: h.city },
    { name: 'phone', label: 'Phone', type: 'tel', value: h.phone },
    { name: 'address', label: 'Address', value: h.address, full: true },
    ...geoFields(h.lat, h.lng),
    { name: 'warden_phone', label: 'Warden contact number', type: 'tel', value: h.warden_phone || '', maxlength: 10, placeholder: '10-digit mobile' }],
  onSubmit: async v => {
    if (sameHostelName(h.org_id, v.name, h.id)) return t('This client already has a hostel called "{n}". Use a different name.', { n: v.name });
    const patch = { name: v.name, city: v.city, phone: phone10(v.phone), address: v.address, lat: coordNum(v.lat), lng: coordNum(v.lng), warden_phone: phone10(v.warden_phone) || null };
    await Backend.update('hostels', h.id, patch);
    Object.assign(h, patch);
    const live = Store.hostels.find(x => x.id === h.id); if (live) Object.assign(live, patch);
    toast('Saved'); render();
  } }); };
const BILL_CHANNELS = { whatsapp: 'WhatsApp to all', email: 'E-mail to all', both: 'E-mail and WhatsApp to all', off: 'Nothing automatic (owner sends by hand)' };
A.admbillchan = el => { const h = admHostel(el.dataset.id); if (!h) return; const cur = ((h.settings || {}).wa || {}).monthly && h.settings.wa.monthly.channel || 'whatsapp'; formModal({
  title: 'Monthly bill delivery', submit: 'Save',
  note: t('How the monthly bill (rent + electricity + pay link) is sent in bulk once every meter reading is in. WhatsApp to all costs money per message on the official API.'),
  fields: [{ name: 'channel', label: 'Send the monthly bill by', type: 'select', value: cur, options: Object.entries(BILL_CHANNELS).map(([v, l]) => ({ v, l: t(l) })), required: true }],
  onSubmit: async v => {
    const s = await Backend.saveSettings(h.id, { wa: { monthly: { channel: v.channel } } });
    h.settings = s || h.settings; const live = Store.hostels.find(x => x.id === h.id); if (live) live.settings = h.settings;
    toast('Saved'); render();
  } }); };
A.openhostel = el => chooseContext('super:' + el.dataset.id);
A.addowner = el => {
  const hs = adm.data.hostels.filter(h => h.org_id === el.dataset.org);
  formModal({
    title: 'Add owner / manager', wide: true,
    note: t('An owner reaches every hostel of this client. Pick one hostel instead to make them a manager of that PG only.'),
    fields: [
      { name: 'full_name', label: 'Full name', required: true },
      { name: 'phone', label: 'Mobile', type: 'tel', required: true },
      { name: 'role', label: 'Role', type: 'select', options: [{ v: 'owner', l: t('Owner') }, { v: 'manager', l: t('Manager') }] },
      { name: 'hostel', label: 'Access', type: 'select', options: [{ v: '', l: t('All hostels of this client') }, ...hs.map(h => ({ v: h.id, l: h.name }))] },
      { type: 'section', label: 'How they log in' },
      { name: 'username', label: 'User ID', required: true, pattern: /^[a-z0-9][a-z0-9._\-]{2,29}$/,
        info: t('Suggested from the name, with the mobile number as the password. Change either if you would rather set it yourself.') },
      { name: 'password', label: 'Password', required: true },
    ],
    onChange: loginFollow,
    onSubmit: async v => {
      if (String(v.password).length < 6) return 'Password must be at least 6 characters';
      const u = await Backend.admin('create_user', {
        full_name: v.full_name, phone: v.phone, username: v.username, password: v.password,
        org_id: el.dataset.org, hostel_id: v.hostel || null, role: v.role,
      });
      adm.data = null; closeModal(); render();
      credsSheet(t('{n} can now log in', { n: v.full_name.split(' ')[0] }), v.full_name, v.phone, u.username, v.password,
        u.username !== v.username ? t('That user ID was taken, so it was given a number — this is the one that works.') : '');
      return false;
    },
  });
};
document.addEventListener('change', async e => {
  const k = e.target.dataset && e.target.dataset.orgmod; if (!k) return;
  const o = adm.data.orgs.find(x => x.id === e.target.dataset.org); if (!o) return;
  const want = e.target.checked;
  try {
    await saveMods(o, o.modules || {}, k, want, async modules => {
      await Backend.update('orgs', o.id, { modules });
      o.modules = modules;
      const live = Store.orgs.find(x => x.id === o.id); if (live) live.modules = modules;
      // switching it ON for the client switches it on in the hostels that had it off, so the two screens agree
      if (want) for (const h of adm.data.hostels.filter(x => x.org_id === o.id && (x.modules || {})[k] === false)) {
        const hm = applyModSwitch(h.modules || {}, k, true).modules;
        const row = await Backend.setHostelAdmin(h.id, { modules: hm });
        h.modules = (row && row.modules) || hm;
        const lh = Store.hostels.find(x => x.id === h.id); if (lh) lh.modules = h.modules;
      }
    });
  } catch (err) { e.target.checked = !want; toast(err.message, 'bad'); }
});

/* Modules, one hostel at a time.
 * Two levels, in this order: what the client pays for, then what this particular PG uses. An
 * owner with three hostels can run the mess module in the one that serves food and leave it
 * out of the other two, without the super admin having to create separate clients.
 *
 * The dependency rules are enforced here rather than explained in a note, because a switch
 * that leaves another module half-working is exactly what broke before: the kitchen works out
 * what to cook from the mess menu, and inquiries come from the public landing page.
 */
const MOD_GROUPS = [
  ['Stay & money', ['electricity', 'expenses']],
  ['Daily operations', ['mess', 'kitchen', 'housekeeping', 'laundry', 'attendance', 'gate', 'complaints']],
  ['Verification & Inquiries', ['emitra', 'inquiries']],
  ['WhatsApp bulk automation', ['automation']],
  ['Team & admin', ['staff', 'notices', 'reports']],
  ['Getting new residents', ['landing']],
  ['For residents', ['residentApp']],
];
function modNote(k) {
  if (k === 'automation') return t('On: this hostel gets the Automation page and the automatic monthly WhatsApp bill (Meta cost per message). Off: all of it is hidden for the owner and staff; 1-tap WhatsApp still works.');
  const needs = modNeeds(k).map(modLabel), used = modNeededBy(k).map(modLabel);
  return [needs.length ? t('Needs {m}', { m: needs.join(', ') }) : '',
    used.length ? t('{m} needs this', { m: used.join(', ') }) : ''].filter(Boolean).join(' · ');
}
PAGES['admin-hostel'] = {
  title: () => { const h = adm.data && !adm.data.error && (adm.data.hostels || []).find(x => x.id === ui.arg); return h ? h.name : 'Modules'; },
  ...superOnly,
  render(id) {
    if (!adm.data) return admWait('Modules');
    if (adm.data.error) return admErr();
    const h = (adm.data.hostels || []).find(x => x.id === id);
    if (!h) return `<div class="card">${empty('Hostel not found', '', btn('Clients', 'go', 'data-to="admin"'))}</div>`;
    const o = adm.data.orgs.find(x => x.id === h.org_id) || {};
    const orgMods = o.modules || {}, mine = h.modules || {};
    const listed = new Set(MOD_GROUPS.flatMap(g => g[1]));
    const groups = [...MOD_GROUPS, ['Other', OPTIONAL_MODULES.filter(k => !listed.has(k))]].filter(g => g[1].length);
    const on = k => orgMods[k] !== false && mine[k] !== false;
    const row = k => {
      const locked = orgMods[k] === false;
      const note = [locked ? t('Off for the whole client') : '', modNote(k)].filter(Boolean).join(' · ');
      return `<div class="li noic"><span class="body"><span class="t">${esc(modLabel(k))}</span>${note ? `<span class="d">${esc(note)}</span>` : ''}</span>
        <span class="end">${locked ? badge('Not in plan') : ''}<label class="sw"><input type="checkbox" data-hmod="${k}" data-h="${id}"
          ${on(k) ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="${esc(modLabel(k))}"><span></span></label></span></div>`;
    };
    const offN = OPTIONAL_MODULES.filter(k => !on(k)).length;
    const st = statOf(id), mine_ = hostelLogins(h);
    const tab = curTab('admh', 'info');
    return `<div class="row" style="margin:6px 0 10px">${btn(o.name || 'Client', 'go', `data-to="admin/${h.org_id}"`, 'ghost sm', 'back')}</div>
      ${head(h.name, [h.city, t('{n} residents', { n: st.residents || 0 })].filter(Boolean).join(' · '), btn('Open this hostel', 'openhostel', `data-id="${id}"`, 'primary', 'building'))}
      <div class="narrow" style="max-width:760px">
        ${seg('admh', [['info', 'Details'], ['blocks', 'Blocks', (h.blocks || []).length],
          ['res', 'Residents', st.residents || ''], ['mods', 'Modules', offN ? offN + ' off' : ''], ['users', 'Logins', mine_.own.length]], 'info')}
        ${tab === 'info' ? hostelInfoCard(h, o, st) : ''}
        ${tab === 'blocks' ? blocksCard(h) : ''}
        ${tab === 'mods' ? group('Online payments', `<div class="li noic"><span class="body"><span class="t">${esc(modLabel('cashfree'))}</span><span class="d">${esc(t('Off by default. Switch on only for a hostel that has agreed to online UPI collection: its owner then sees the Cashfree settlement setup and residents can pay through the gateway.'))}</span></span><span class="end"><label class="sw"><input type="checkbox" data-hmod="cashfree" data-h="${id}" ${mine.cashfree === true ? 'checked' : ''} aria-label="${esc(modLabel('cashfree'))}"><span></span></label></span></div>`)
          + group('Police verification', `<div class="li noic"><span class="body"><span class="t">${esc(modLabel('pvPlatform'))}</span><span class="d">${esc(t('Off: the hostel has its own e-Mitra operator login. On: your team verifies this hostel from Police verification in this console. The owner only watches the status either way.'))}</span></span><span class="end"><label class="sw"><input type="checkbox" data-hmod="pvPlatform" data-h="${id}" ${mine.pvPlatform === true ? 'checked' : ''} aria-label="${esc(modLabel('pvPlatform'))}"><span></span></label></span></div>`)
          + groups.map(([title, keys]) => group(title, keys.map(row).join(''))).join('')
          + about('Core screens — Home, Approvals, Rooms, Residents, Payments and Settings — are always on. Switching a module off hides it for everyone in this hostel; nothing already recorded is deleted, and switching it back on brings it all back.') : ''}
        ${tab === 'res' ? hostelResidentsCard(h) : ''}
        ${tab === 'users' ? hostelUsersCard(h, o, mine_) : ''}
      </div>`;
  },
};

/* Everything about one hostel in one place.
 * Before this, a hostel's name was edited from a pencil on the client page, its modules from a
 * second screen, and its people from a list that mixed every hostel of every client together.
 * Three places to look for one PG. Now the hostel is the page, and the tabs are the only
 * division — what it is, how it is laid out, what it can do, and who gets in.
 */
function hostelInfoCard(h, o, st) {
  const row = (icon, ic, label, value, act) => li({ icon, ic, t: value || t('Not set'), d: t(label), act, attrs: act ? `data-id="${h.id}"` : '', chev: !!act });
  return `${group('This hostel', [
      row('building', 'info', 'Name', h.name, 'edithostel'),
      row('globe', 'teal', 'City', h.city, 'edithostel'),
      li({ icon: 'door', ic: 'mute', t: h.address || t('Not set'), d: t('Address'), act: 'edithostel', attrs: `data-id="${h.id}"`, end: `<a class="btn sm primary" data-act="noop" href="${esc(mapsUrl(h))}" target="_blank" rel="noopener">${ico('globe', 'sm')} ${esc(t('Directions'))}</a>` }),
      li({ icon: 'globe', ic: 'teal', t: h.lat != null && h.lng != null ? `${h.lat}, ${h.lng}` : t('Not set'), d: t('Map location (latitude, longitude)'), act: 'edithostel', attrs: `data-id="${h.id}"` }),
      row('phone', 'ok', 'Phone', h.phone, 'edithostel'),
      li({ icon: 'user', ic: 'info', t: h.warden_phone || t('Not set'), d: t('Warden contact number'), chev: false, end: h.warden_phone ? contactBtns(h.warden_phone, '') : '' }),
      li({ icon: 'power', ic: h.status === 'active' ? 'ok' : 'bad',
        t: t(h.status === 'active' ? 'Active' : 'Inactive'),
        d: t(h.status === 'active' ? 'Staff and residents can log in' : 'Nobody can log into this hostel'),
        chev: false,
        end: `<label class="sw"><input type="checkbox" data-hstatus="${h.id}" ${h.status === 'active' ? 'checked' : ''} aria-label="${esc(t('Active'))}"><span></span></label>` }),
      li({ icon: 'bot', ic: (h.modules || {}).automation !== false && (o.modules || {}).automation !== false ? 'ok' : 'mute',
        t: (h.modules || {}).automation !== false && (o.modules || {}).automation !== false ? t('WhatsApp Cloud Automation: Active') : t('WhatsApp Cloud Automation: Off (1-Tap Manual)'),
        d: t('Super Admin controls automatic monthly WhatsApp bill dispatch to manage Meta API cost.'),
        chev: false,
        end: `<span class="badge ${(h.modules || {}).automation !== false && (o.modules || {}).automation !== false ? 'ok' : ''}">${(h.modules || {}).automation !== false && (o.modules || {}).automation !== false ? t('Active') : t('Manual')}</span>` }),
      (h.modules || {}).automation !== false && (o.modules || {}).automation !== false ? li({ icon: 'send', ic: 'teal', t: t('Monthly bill goes out by: {c}', { c: t(BILL_CHANNELS[((h.settings || {}).wa || {}).monthly && h.settings.wa.monthly.channel || 'whatsapp']) }),
        d: t('Bulk only. Reminders, admission messages and single bills are always sent one by one from the owner screen.'), act: 'admbillchan', attrs: `data-id="${h.id}"` }) : '',
    ].join(''), `${btn('Edit details', 'edithostel', `data-id="${h.id}"`, 'sm', 'edit')}`)}
    ${group('At a glance', [
      li({ icon: 'users', ic: 'info', t: t('{n} residents', { n: st.residents || 0 }), d: t('Counted for the whole hostel — blocks do not change this'), chev: false }),
      li({ icon: 'layers', ic: 'mute', t: t('{n} records', { n: (+st.rows || 0).toLocaleString('en-IN') }), d: st.last_activity ? t('last activity {t}', { t: ago(st.last_activity) }) : t('No activity yet'), chev: false }),
      li({ icon: 'building', ic: 'ok', t: t('Open this hostel as its owner sees it'), act: 'openhostel', attrs: `data-id="${h.id}"` }),
    ].join(''))}
    ${group('Danger', li({ icon: 'trash', ic: 'bad', t: t('Delete this hostel'), d: t('Removes the hostel and every record in it. Cannot be undone.'), act: 'delhostel', attrs: `data-id="${h.id}"` }))}`;
}

/* Who can log into THIS hostel.
 * Two kinds, kept apart because they behave differently: a client-wide owner or manager
 * reaches every hostel and is edited on the client page, while the rest belong here and are
 * created, changed and removed here.
 */
/* ---- Residents of one hostel (super admin): list, profile, login control, log in as, activity trail ---- */
adm.hres = {};   // hostel id -> { rows, loading, error }
async function admHostelResidents(hid, force) {
  const c = adm.hres[hid] || (adm.hres[hid] = {}); if (c.loading || (c.rows && !force)) return;
  c.loading = true; c.error = '';
  try {
    const out = [];
    for (let i = 0; i < 20; i++) { const b = await Backend.list('docs', `&hostel_id=eq.${hid}&kind=eq.res&deleted=eq.false&order=id&limit=500&offset=${i * 500}`); out.push(...b); if (b.length < 500) break; }
    c.rows = out.map(x => ({ ...(x.data || {}), id: x.id }));
  } catch (e) { c.error = e.message || 'Could not load'; }
  c.loading = false; render();
}
function hostelResidentsCard(h) {
  const c = adm.hres[h.id]; if (!c) { admHostelResidents(h.id); return `<div class="stack"><div class="skel"></div><div class="skel"></div></div>`; }
  if (c.loading && !c.rows) return `<div class="stack"><div class="skel"></div><div class="skel"></div></div>`;
  if (c.error) return `<div class="card">${empty('Could not load', c.error, btn('Try again', 'admresrefresh', `data-h="${h.id}"`))}</div>`;
  const f = curFlt('ahr', 'active'), q = ui.q.ahr || '';
  const rows = (c.rows || []).filter(r => (f === 'all' || (f === 'left' ? r.status === 'left' : r.status !== 'left' && r.status !== 'cancelled')) && needle('ahr', r.name, r.phone, r.username, r.roomNo));
  const room = r => { const m = (Store.rooms || []).find(x => x.id === r.roomId); return r.roomNo || (m ? m.no : '') || ''; };
  return `<div class="tool">${searchBox('ahr', 'Search name, mobile, user ID')}${chips('ahr', [['active', 'Living'], ['left', 'Left'], ['all', 'All']], 'active')}<span class="sp"></span>${btn('', 'admresrefresh', `data-h="${h.id}" aria-label="${esc(t('Refresh'))}"`, 'sm', 'sync')}</div>
    ${group('', rows.slice(0, ui.lim.ahr || 60).map(r => li({ lead: avatar(r.name || '?'), t: r.name || '?', d: [room(r) ? `${t('Room')} ${room(r)}${r.bed ? '-' + r.bed : ''}` : '', r.phone || '', r.username ? '@' + r.username : t('No login yet'), r.status === 'left' ? t('Left') : r.status === 'notice' ? t('On notice') : ''].filter(Boolean).join(' · '), act: 'admres', attrs: `data-h="${h.id}" data-id="${esc(r.id)}"` })).join('') || `<div class="li noic"><span class="body muted">${esc(t('No residents'))}</span></div>`)}
    ${rows.length > (ui.lim.ahr || 60) ? `<div style="text-align:center;margin-top:12px">${btn('Show more', 'more', 'data-key="ahr" data-per="60"', 'sm')}</div>` : ''}`;
}
A.admresrefresh = el => { delete adm.hres[el.dataset.h]; render(); };
const admRes = (hid, id) => ((adm.hres[hid] || {}).rows || []).find(x => x.id === id);
A.admres = async el => {
  const hid = el.dataset.h, r = admRes(hid, el.dataset.id); if (!r) return;
  const kv = (k, v) => v ? `<dt>${esc(t(k))}</dt><dd>${esc(v)}</dd>` : '';
  const prof = r.userId ? admProf(r.userId) : {};
  sheet(r.name, `<dl class="kv">${kv('Mobile', r.phone)}${kv('Email', r.email)}${kv('Room', r.roomNo || r.roomId ? `${r.roomNo || r.roomId}${r.bed ? '-' + r.bed : ''}` : '')}${kv('Staying since', r.checkIn ? fmtDate(r.checkIn) : '')}${kv('Rent', r.rent != null ? inr(r.rent) : '')}${kv('Guardian', [r.guardian, r.guardianPhone].filter(Boolean).join(' · '))}${kv('College / office', r.college)}${kv('Aadhaar / ID number', r.idNo)}${kv('Permanent address', r.address)}${kv('Status', r.status === 'left' ? t('Left') : r.status === 'notice' ? t('On notice') : t('Living'))}</dl>
    ${group('Login', li({ icon: 'key', ic: r.userId ? 'ok' : 'mute', t: r.username ? '@' + r.username : t('No login yet'), d: r.userId ? t('The password cannot be read. Reset it to give a new one.') : t('Created when the resident is checked in.'), chev: false, end: r.userId && (admProf(r.userId).active === false) ? badge('Off', 'bad') : '' }))}
    <div class="group-t">${esc(t('Recent changes by the platform'))}</div><div class="group" id="admResLog"><div class="li noic"><span class="body muted">${esc(t('Loading…'))}</span></div></div>`,
  { foot: `<button class="btn" data-act="admresedit" data-h="${hid}" data-id="${esc(r.id)}">${ico('edit', 'sm')} ${esc(t('Edit details'))}</button>${r.userId ? `<button class="btn" data-act="admrescreds" data-h="${hid}" data-id="${esc(r.id)}">${ico('key', 'sm')} ${esc(t('Login & password'))}</button><button class="btn primary" data-act="admresas" data-h="${hid}" data-id="${esc(r.id)}">${ico('user', 'sm')} ${esc(t('Log in as'))}</button>` : ''}` });
  try {
    const rows = await Backend.list('docs', `&hostel_id=eq.${hid}&kind=eq.log&res_id=eq.${encodeURIComponent(r.id)}&deleted=eq.false&order=updated_at.desc&limit=15`);
    const box = document.getElementById('admResLog'); if (!box) return;
    box.innerHTML = rows.length ? rows.map(x => { const d = x.data || {}; return li({ icon: 'file', ic: 'info', t: d.msg || '', d: `${(d.actor || {}).name || ''} · ${d.ts ? fmtTs(d.ts) : ''}`, chev: false }); }).join('') : `<div class="li noic"><span class="body muted">${esc(t('No changes by the platform yet.'))}</span></div>`;
  } catch (e) { const box = document.getElementById('admResLog'); if (box) box.innerHTML = `<div class="li noic"><span class="body muted">${esc(t('Could not load the activity record'))}</span></div>`; }
};
A.admresedit = el => {
  const hid = el.dataset.h, r = admRes(hid, el.dataset.id); if (!r) return;
  formModal({
    title: `${t('Edit details')} · ${r.name}`, submit: 'Save', wide: true,
    note: t('Saved at once for everyone: the owner, the resident and the reports see the new details straight away.'),
    fields: [
      { name: 'name', label: 'Full name', value: r.name, required: true, maxlength: 80 },
      { name: 'phone', label: 'Mobile', type: 'tel', value: r.phone || '', maxlength: 10 },
      { name: 'email', label: 'Email address', type: 'email', value: r.email || '', maxlength: 120 },
      { name: 'guardian', label: 'Parent / guardian name', value: r.guardian || '', maxlength: 80 },
      { name: 'guardianPhone', label: 'Guardian mobile', type: 'tel', value: r.guardianPhone || '', maxlength: 10 },
      { name: 'college', label: 'College / office', value: r.college || '', maxlength: 120 },
      { name: 'idNo', label: 'Aadhaar card number', value: r.idNo || '', maxlength: 12 },
      { name: 'status', label: 'Stay status', type: 'select', value: r.status === 'notice' ? 'notice' : 'active', options: [{ v: 'active', l: t('Living') }, { v: 'notice', l: t('On notice') }], showIf: true },
      { name: 'address', label: 'Permanent address', value: r.address || '', full: true, maxlength: 240 },
    ],
    onSubmit: async v => {
      const patch = {}; for (const k of ['name', 'phone', 'email', 'guardian', 'guardianPhone', 'college', 'idNo', 'address']) patch[k] = v[k]; if (r.status !== 'left') patch.status = v.status;
      const res = await Backend.admin('resident_update', { hostel_id: hid, res_id: r.id, patch });
      Object.assign(r, patch); toast(res.changed && res.changed.length ? t('Saved: {c}', { c: res.changed.join(', ') }) : t('Nothing changed'), 'ok'); render();
    }
  });
};
// Login ID and password: both can be changed; a new password is shown once to copy or send.
A.admrescreds = el => {
  const hid = el.dataset.h, r = admRes(hid, el.dataset.id); if (!r || !r.userId) return;
  const prof = admProf(r.userId), on = prof.active !== false;
  sheet(t('Login & password'), `<dl class="kv"><dt>${esc(t('User ID'))}</dt><dd>@${esc(r.username || '')}</dd><dt>${esc(t('Login'))}</dt><dd>${esc(t(on ? 'On' : 'Off'))}</dd></dl>
    <p class="hint">${esc(t('Passwords are never stored in a readable form. Make a new one and give it to the resident.'))}</p>`,
  { foot: `<button class="btn" data-act="admresid" data-h="${hid}" data-id="${esc(r.id)}">${esc(t('Change user ID'))}</button><button class="btn" data-act="admrespw" data-h="${hid}" data-id="${esc(r.id)}">${esc(t('New password'))}</button><button class="btn ${on ? 'bad' : 'ok'}" data-act="admresactive" data-h="${hid}" data-id="${esc(r.id)}">${esc(t(on ? 'Switch off' : 'Switch on'))}</button>` });
};
const SHORT_PW = 'abcdefghjkmnpqrstuvwxyz23456789';
const genPw = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => SHORT_PW[b % SHORT_PW.length]).join('');
A.admrespw = el => {
  const hid = el.dataset.h, r = admRes(hid, el.dataset.id); if (!r) return;
  formModal({ title: `${t('New password')} · ${r.name}`, submit: 'Set password', note: t('A short password is suggested. Change it if you like (at least 8 characters).'), fields: [{ name: 'pw', label: 'New password', value: genPw(), required: true, plain: true, maxlength: 40 }],
    onSubmit: async v => {
      if (String(v.pw).length < 8) return 'Password must be at least 8 characters';
      await Backend.admin('set_password', { user_id: r.userId, password: v.pw, hostel_id: hid, res_id: r.id });
      closeModal(); toast('Password changed');
      credsSheet(t('New login for {n}', { n: r.name.split(' ')[0] }), r.name, r.phone, r.username, v.pw, '');
      return false;
    } });
};
A.admresid = el => {
  const hid = el.dataset.h, r = admRes(hid, el.dataset.id); if (!r) return;
  formModal({ title: `${t('Change user ID')} · ${r.name}`, submit: 'Change', note: t('The resident must use the new ID from now on. 3 to 30 characters: lowercase letters and numbers, one dot between parts.'), fields: [{ name: 'u', label: 'New user ID', value: r.username || '', required: true, plain: true, maxlength: 30 }],
    onSubmit: async v => {
      const u = String(v.u).trim().toLowerCase();
      const res = await Backend.admin('set_username', { user_id: r.userId, username: u, hostel_id: hid, res_id: r.id });
      await Backend.admin('resident_update', { hostel_id: hid, res_id: r.id, patch: { username: res.username } }).catch(() => {});
      r.username = res.username; const p = admProf(r.userId); if (p) p.username = res.username; toast(t('User ID is now @{u}', { u: res.username })); render();
    } });
};
A.admresactive = async el => {
  const hid = el.dataset.h, r = admRes(hid, el.dataset.id); if (!r) return;
  const p = admProf(r.userId) || {}, on = p.active === false;
  await Backend.admin('set_active', { user_id: r.userId, active: on, hostel_id: hid, res_id: r.id });
  p.active = on; closeModal(); toast(on ? 'Login switched on' : 'Login switched off'); render();
};
A.admresas = el => {
  const hid = el.dataset.h, r = admRes(hid, el.dataset.id); if (!r || !r.userId) return;
  confirmBox(t('Sign in as {n}? You will see exactly what they see. A bar on top takes you back to the admin.', { n: r.name }), async () => {
    const u = await Backend.impersonate(r.userId, hid, r.id);
    toast(t('Signed in as @{u}', { u }));
    setTimeout(() => location.assign('/'), 300);
  }, 'Log in as', 'primary');
};
function hostelLogins(h) {
  const ms = adm.data.members.filter(m => m.org_id === h.org_id && m.role !== 'resident');
  return {
    own: ms.filter(m => m.hostel_id === h.id),
    wide: ms.filter(m => !m.hostel_id),
    residents: +statOf(h.id).residents || 0,   // counted by the database; resident logins are not all loaded
  };
}
const admProf = uid_ => adm.data.profiles.find(x => x.id === uid_) || {};
function userRow(m, p, extra) {
  const bits = [t(ROLES[m.role] ? ROLES[m.role].l : m.role), extra,
    m.block ? ((adm.data.hostels.find(x => x.id === m.hostel_id) || {}).blocks || []).reduce((a, b) => (b.k === m.block ? b.l : a), m.block) : '',
    (m.perms || []).length ? t('+{n} extra', { n: m.perms.length }) : '',
    p.active === false || m.active === false ? t('Disabled') : ''].filter(Boolean);
  return li({ lead: avatar(p.full_name || '?'), t: `${p.full_name || '?'} · @${p.username || '?'}`,
    d: bits.join(' · '), act: 'admmember', attrs: `data-mid="${m.id}"`,
    end: p.active === false || m.active === false ? badge('Off', 'bad') : '' });
}
function hostelUsersCard(h, o, mine_) {
  return `${group('Logins for this hostel', mine_.own.map(m => userRow(m, admProf(m.user_id))).join('')
      + `<div class="li noic"><span class="body"><a href="#" data-act="admadduser" data-h="${h.id}">+ ${esc(t('Add a login'))}</a></span></div>`,
      t('Each person gets their own user ID and password. Tap anyone to change what they can see, reset their password, switch them off or remove them.'))}
    ${mine_.wide.length ? group('Also reach this hostel', mine_.wide.map(m => userRow(m, admProf(m.user_id), t('client-wide'))).join(''),
      t('These belong to {c} as a whole, so they are added and removed on the client page.', { c: o.name || '' })) : ''}
    ${group('Residents', li({ icon: 'users', ic: 'mute', t: t('{n} resident logins', { n: mine_.residents }),
      d: t('Created automatically at check-in — user ID is their name, password their mobile number.'), chev: false }))}`;
}

// Switching a hostel off is the platform admin's lever, so it travels through set_hostel_admin
// exactly as the module switches do.
document.addEventListener('change', async e => {
  const id = e.target.dataset && e.target.dataset.hstatus; if (!id) return;
  const h = admHostel(id); if (!h) return;
  const want = e.target.checked ? 'active' : 'inactive';
  try {
    const row = await Backend.setHostelAdmin(id, { status: want });
    h.status = (row && row.status) || want;
    const live = Store.hostels.find(x => x.id === id); if (live) live.status = h.status;
    toast(want === 'active' ? 'Hostel is active' : 'Hostel switched off');
    render();
  } catch (err) { e.target.checked = want !== 'active'; toast(err.message, 'bad'); }
});
A.delhostel = el => {
  const h = admHostel(el.dataset.id); if (!h) return;
  formModal({ title: `${t('Delete')} ${h.name}`, submit: 'Delete forever',
    note: t('This deletes the hostel and every record in it — residents, bills, payments, everything — and the logins that belonged only to this hostel. It cannot be undone.'),
    fields: [{ name: 'confirm', label: 'Type the hostel name to confirm', required: true, full: true }],
    onSubmit: async v => {
      if (v.confirm.trim() !== h.name) return 'Name does not match';
      await Backend.remove('hostels', h.id);
      adm.data = null; closeModal(); go('admin/' + h.org_id); toast('Hostel deleted');
      return false;
    } });
};

/* ---- logins: one ID, one password, both visible at the moment they are created ----
 * The old flow invented a user ID silently and used the mobile number as the password, which
 * is fine until two people share a number or somebody wants to type something they can
 * remember. Both are editable here, the suggestion follows the name until it is touched, and
 * the finished credentials are shown once on a card that can be copied or sent on WhatsApp —
 * because after this they cannot be read back, only reset. */
// Suggested user ID and password follow what is typed until the admin types their own.
function loginFields(h, opts = {}) {
  const blocks = h.blocks || [];
  const o = (adm.data && adm.data.orgs ? adm.data.orgs.find(x => x.id === h.org_id) : null) || {};
  const allowedRoles = ROLE_CHOICES.filter(r => r !== 'resident' && isRoleAllowed(r, h, o));
  const activeRole = (opts.role && allowedRoles.includes(opts.role)) ? opts.role : (allowedRoles[0] || 'manager');
  return [
    { name: 'full_name', label: 'Full name', required: true, maxlength: 80 },
    { name: 'phone', label: 'Mobile (WhatsApp)', type: 'tel', required: true, maxlength: 10, placeholder: '10-digit mobile' },
    { name: 'role', label: 'Role', type: 'select', options: allowedRoles.map(r => ({ v: r, l: t(ROLES[r].l) })), value: activeRole },
    ...(blocks.length ? [{ name: 'block', label: 'Block', type: 'select', value: '',
      options: [{ v: '', l: t('All blocks') }, ...blocks.map(b => ({ v: b.k, l: b.l }))],
      info: t('Tied to one block, this person sees only that wing of the hostel.') }] : []),
    { name: 'perms', label: 'Extra modules (optional)', type: 'multi', full: true,
      options: MODULES.filter(m => !['home', 'settings'].includes(m.k) && isModOnHostel(m.k, h, o)).map(m => ({ v: m.k, l: t(m.l) })) },
    { type: 'section', label: 'How they log in' },
    { name: 'username', label: 'User ID', required: true, pattern: /^[a-z0-9][a-z0-9._\-]{2,29}$/,
      info: t('Lowercase letters, numbers, dot, dash. This is what they type to log in, so keep it short.') },
    { name: 'password', label: 'Password', required: true,
      info: t('At least 6 characters. The mobile number is suggested because it is the one thing they always remember; change it to anything you like.') },
  ];
}
/* The same suggestion behaviour for a form whose fields are named differently (the New
 * client screen has oname/ophone/ouser/opass because it also has the client's own name). */
const loginFollow2 = (nameF, phoneF, userF, passF) => (v, form, changed) => {
  const u = form.elements[userF], pw = form.elements[passF];
  if (changed === userF) u.dataset.touched = '1';
  if (changed === passF) pw.dataset.touched = '1';
  if (changed === phoneF) {
    const ph = phone10(v[phoneF]) || '';
    if (!pw.dataset.touched) pw.value = ph;
    if (!u.dataset.touched) u.value = ph || slug(v[nameF] || '');
  } else if (changed === nameF && !u.dataset.touched && !v[phoneF]) {
    u.value = slug(v[nameF] || '');
  }
};
function loginFollow(v, form, changed) {
  const u = form.elements.username, pw = form.elements.password;
  if (changed === 'username') u.dataset.touched = '1';
  if (changed === 'password') pw.dataset.touched = '1';
  if (changed === 'phone' || changed === 'role') {
    const ph = phone10(v.phone) || '';
    if (!pw.dataset.touched) pw.value = ph;
    if (!u.dataset.touched) {
      const hSlug = slug((admHostel(form.dataset?.h || '') || Store.hostel() || {}).name || 'hostel').slice(0, 18).replace(/\.+$/, '') || 'hostel';
      u.value = v.role === 'owner' ? ph : (ph ? `${ph}.${hSlug}` : slug(v.full_name || ''));
    }
  } else if (changed === 'full_name' && !u.dataset.touched && !v.phone) {
    u.value = slug(v.full_name || '');
  }
}
A.admadduser = el => {
  const h = admHostel(el.dataset.h); if (!h) return;
  formModal({
    title: `${t('Add a login')} · ${h.name}`, submit: 'Create login', wide: true,
    note: t('Creates the person a login of their own. You will see the ID and password once, on the next screen.'),
    fields: loginFields(h),
    onChange: loginFollow,
    onSubmit: async v => {
      if (String(v.password).length < 6) return 'Password must be at least 6 characters';
      const u = await Backend.admin('create_user', {
        full_name: v.full_name, phone: v.phone, username: v.username, password: v.password,
        org_id: h.org_id, hostel_id: h.id, role: v.role, perms: v.perms, block: v.block,
      });
      adm.data = null; closeModal(); render();
      credsSheet(t('{n} can now log in', { n: v.full_name.split(' ')[0] }), v.full_name, v.phone, u.username, v.password,
        u.username !== v.username ? t('That user ID was taken, so it was given a number — this is the one that works.') : '');
      return false;
    },
  });
};

// One sheet for everything that can be done to a person's access here.
A.admmember = el => {
  const m = adm.data.members.find(x => x.id === el.dataset.mid); if (!m) return;
  const p = admProf(m.user_id);
  const h = admHostel(m.hostel_id) || {};
  const off = p.active === false || m.active === false;
  sheet(`${p.full_name || '?'} · @${p.username || '?'}`, `<dl class="kv">
      <dt>${esc(t('Role'))}</dt><dd>${esc(t(ROLES[m.role] ? ROLES[m.role].l : m.role))}</dd>
      <dt>${esc(t('Mobile'))}</dt><dd>${esc(p.phone || '—')}</dd>
      <dt>${esc(t('Reaches'))}</dt><dd>${esc(m.hostel_id ? (h.name || '') : t('Every hostel of this client'))}</dd>
      <dt>${esc(t('Status'))}</dt><dd>${esc(t(off ? 'Disabled' : 'Active'))}</dd>
    </dl>
    ${group('', [
      m.hostel_id ? li({ icon: 'key', ic: 'info', t: t('Change role and access'), act: 'admmemedit', attrs: `data-mid="${m.id}"` }) : '',
      isSuper() ? li({ icon: 'key', ic: 'teal', t: t('Change their user ID'), d: `@${p.username || ''}`, act: 'admsetuser', attrs: `data-id="${m.user_id}"` }) : '',
      li({ icon: 'lock', ic: 'warn', t: t('Set a new password'), d: t('Passwords cannot be read back, only replaced.'), act: 'admsetpw', attrs: `data-id="${m.user_id}"` }),
      li({ icon: 'power', ic: off ? 'ok' : 'bad', t: t(off ? 'Enable this login' : 'Disable this login'), d: t('Their records stay either way.'), act: 'admactive', attrs: `data-id="${m.user_id}"` }),
      li({ icon: 'x', ic: 'bad', t: t('Remove from this hostel'), d: t('Takes away access. The login itself is kept.'), act: 'admmemdel', attrs: `data-id="${m.id}"` }),
      p.is_super ? '' : li({ icon: 'trash', ic: 'bad', t: t('Delete the login completely'), act: 'admuserdel', attrs: `data-id="${p.id}"` }),
    ].filter(Boolean).join(''))}`);
};
A.admmemedit = el => {
  const m = adm.data.members.find(x => x.id === el.dataset.mid); if (!m) return;
  const h = admHostel(m.hostel_id) || {}, blocks = h.blocks || [];
  const o = (adm.data && adm.data.orgs ? adm.data.orgs.find(x => x.id === h.org_id) : null) || {};
  const defaults = (ROLES[m.role] || ROLES.staff).mods;
  const allowedRoles = ROLE_CHOICES.filter(r => r === m.role || isRoleAllowed(r, h, o));
  closeModal(true);
  formModal({
    title: t('Role and access'), submit: 'Save',
    note: t('Default for {r}: {m}', { r: t(ROLES[m.role] ? ROLES[m.role].l : m.role), m: defaults.map(k => modLabel(k)).join(', ') || '—' }),
    fields: [
      { name: 'role', label: 'Role', type: 'select', options: allowedRoles.map(r => ({ v: r, l: t(ROLES[r].l) })), value: m.role },
      ...(blocks.length ? [{ name: 'block', label: 'Block', type: 'select', value: m.block || '',
        options: [{ v: '', l: t('All blocks') }, ...blocks.map(b => ({ v: b.k, l: b.l }))] }] : []),
      { name: 'perms', label: 'Also allow', type: 'multi', full: true, value: m.perms || [],
        options: MODULES.filter(x => !['home', 'settings'].includes(x.k) && isModOnHostel(x.k, h, o)).map(x => ({ v: x.k, l: t(x.l) })) },
      { name: 'deny', label: 'Hide these defaults', type: 'multi', full: true, value: m.deny || [],
        options: defaults.map(k => ({ v: k, l: modLabel(k) })) },
    ],
    onSubmit: async v => {
      const patch = { role: v.role, perms: v.perms, deny: v.deny, ...(blocks.length ? { block: v.block || null } : {}) };
      await Backend.update('members', m.id, patch);
      Object.assign(m, patch); toast('Access updated'); render();
    },
  });
};
// Renaming changes what the person types to log in, so anyone already holding the old ID is
// locked out the moment it is saved. The card afterwards is there to be sent on immediately.
A.pwsuggest = el => { const f = $('#mform'); if (f && f.elements.pw) { f.elements.pw.value = el.dataset.v; f.elements.pw.focus(); } };
A.admsetuser = el => {
  const p = adm.data.profiles.find(x => x.id === el.dataset.id); if (!p) return;
  closeModal(true);
  formModal({ title: t('Change user ID'), submit: 'Change it',
    note: t('@{u} stops working the moment this is saved. Send them the new one.', { u: p.username }),
    fields: [{ name: 'username', label: 'New user ID', value: p.username, required: true, full: true,
      pattern: /^(?=.{3,30}$)[a-z0-9]+(\.[a-z0-9]+)*$/, info: t('3 to 30 characters: lowercase letters and numbers, with a single dot between parts (like ravi.kumar). Dashes and underscores are not allowed because the login screen turns them into dots.') }],
    onSubmit: async v => {
      const r = await Backend.admin('set_username', { user_id: p.id, username: v.username });
      p.username = (r && r.username) || v.username;
      closeModal(); adm.data = null; render();
      toast(t('User ID is now @{u}', { u: p.username }));
      return false;
    } });
};
A.admsetpw = el => {
  const p = adm.data.profiles.find(x => x.id === el.dataset.id); if (!p) return;
  closeModal(true);
  /* The box starts EMPTY on purpose. It used to open with the mobile number already in it,
   * which read like "this is their password" — it was not, it was a suggestion, and pressing
   * Save silently changed the real password to the mobile number. A password cannot be read
   * back from Supabase at all, so nothing truthful can be shown here; the only honest thing
   * is a blank box that says so, with the usual default one tap away. */
  formModal({ title: `${t('Set a new password')} · @${p.username}`, submit: 'Replace the password',
    note: t('Their current password cannot be shown — it is stored scrambled and even we cannot read it. Whatever you type here replaces it. Nothing else about the account changes.'),
    fields: [{ name: 'pw', label: 'New password', value: '', required: true, full: true,
      info: t('At least 6 characters.') }],
    extra: p.phone ? `<div class="row" style="margin-top:10px">${btn(t('Use their mobile number ({n})', { n: p.phone }), 'pwsuggest', `data-v="${esc(p.phone)}"`, 'sm')}</div>` : '',
    onSubmit: async v => {
      if (String(v.pw).length < 6) return 'Password must be at least 6 characters';
      await Backend.admin('set_password', { user_id: p.id, password: v.pw });
      closeModal();
      credsSheet(t('Password changed'), p.full_name, p.phone, p.username, v.pw, null, 'password');
      return false;
    } });
};
/* Blocks — one hostel split into wings.
 * This is the platform admin's switch, not the owner's, for the same reason modules are: a
 * block changes what every screen in that hostel shows, and an owner inventing wings on a
 * plan that does not cover them is the problem we are avoiding. The list is tiny and lives on
 * the hostel row, so adding one costs no table, no query and no sync.
 *
 * The key is minted once from the name and never changes, so renaming "Block A" to "A Wing"
 * leaves every room exactly where it was.
 */
const admHostel = id => (adm.data.hostels || []).find(x => x.id === id);
function blocksCard(h) {
  const list = h.blocks || [];
  const rows = list.map((b, i) => `<div class="li"><span class="ic info">${ico('layers')}</span>
      <span class="body"><span class="t">${esc(b.l)}</span><span class="d">${esc(t('key'))}: ${esc(b.k)}</span></span>
      <span class="end">${btn('', 'blkedit', `data-h="${h.id}" data-i="${i}" aria-label="${esc(t('Rename'))}"`, 'sm', 'edit')}${btn('', 'blkdel', `data-h="${h.id}" data-i="${i}" aria-label="${esc(t('Delete'))}"`, 'sm bad', 'trash')}</span></div>`).join('');
  return group('Blocks / wings', rows + `<div class="li noic"><span class="body"><a href="#" data-act="blkadd" data-h="${h.id}">+ ${esc(t('Add a block'))}</a></span></div>`,
    list.length
      ? t('The owner gets one block switch at the top of the app; every screen follows it. Beds, bills and the head count still belong to the whole hostel, so this never changes what the platform charges.')
      : t('Leave this empty for a single-building PG — nothing about blocks appears anywhere. Add two or more to split one hostel into wings that share one inventory and one bill.'));
}
async function saveBlocks(h, blocks) {
  const row = await Backend.setHostelAdmin(h.id, { blocks });
  h.blocks = (row && row.blocks) || blocks;
  const live = Store.hostels.find(x => x.id === h.id); if (live) live.blocks = h.blocks;
  render();
}
A.blkadd = el => {
  const h = admHostel(el.dataset.h); if (!h) return;
  formModal({ title: 'Add a block', submit: 'Add block',
    note: t('Rooms are put into a block one by one, from Rooms & Beds in the hostel itself.'),
    fields: [{ name: 'l', label: 'Block name', required: true, hint: t('What the owner will see — "Block A", "Girls wing", "Annexe".') }],
    onSubmit: async v => {
      const list = (h.blocks || []).slice();
      if (list.some(b => b.l.toLowerCase() === v.l.trim().toLowerCase())) return 'A block with this name already exists';
      let k = slug(v.l).slice(0, 12) || 'b', n = 1;
      while (list.some(b => b.k === k)) k = `${slug(v.l).slice(0, 10) || 'b'}${++n}`;
      list.push({ k, l: v.l.trim() });
      await saveBlocks(h, list);
      toast(t('{n} added', { n: v.l.trim() }));
    } });
};
A.blkedit = el => {
  const h = admHostel(el.dataset.h), i = +el.dataset.i; if (!h || !h.blocks[i]) return;
  const b = h.blocks[i];
  formModal({ title: 'Rename block', fields: [{ name: 'l', label: 'Block name', value: b.l, required: true }],
    note: t('Rooms stay where they are — only the name on screen changes.'),
    onSubmit: async v => {
      const list = h.blocks.slice();
      if (list.some((x, j) => j !== i && x.l.toLowerCase() === v.l.trim().toLowerCase())) return 'A block with this name already exists';
      list[i] = { ...b, l: v.l.trim() };
      await saveBlocks(h, list); toast('Renamed');
    } });
};
// Deleting a block never deletes a room. The rooms simply stop belonging to a block and the
// owner sees them under "Not in a block" until they are put somewhere else.
A.blkdel = el => {
  const h = admHostel(el.dataset.h), i = +el.dataset.i; if (!h || !h.blocks[i]) return;
  const b = h.blocks[i];
  confirmBox(t('Delete {n}? Its rooms, residents and bills are untouched — those rooms just stop belonging to a block.', { n: b.l }),
    async () => { await saveBlocks(h, h.blocks.filter((x, j) => j !== i)); toast('Block deleted'); }, 'Delete', 'bad');
};

// One place decides what a switch means, so the client-level and hostel-level toggles can
// never disagree about the dependency rules.
async function saveMods(target, cur, k, want, save) {
  const { modules, changed } = applyModSwitch(cur, k, want);
  await save(modules);
  const extra = changed.map(([ck, cv]) => `${modLabel(ck)} ${t(cv ? 'on' : 'off')}`).join(', ');
  toast(extra ? t('{m} · also {x}', { m: `${modLabel(k)} ${t(want ? 'on' : 'off')}`, x: extra })
    : `${modLabel(k)} ${t(want ? 'on' : 'off')}`);
  render();
}
document.addEventListener('change', async e => {
  const k = e.target.dataset && e.target.dataset.hmod; if (!k) return;
  const h = adm.data.hostels.find(x => x.id === e.target.dataset.h); if (!h) return;
  const want = e.target.checked;
  try {
    await saveMods(h, h.modules || {}, k, want, async modules => {
      const row = await Backend.setHostelAdmin(h.id, { modules });
      h.modules = (row && row.modules) || modules;
      const live = Store.hostels.find(x => x.id === h.id); if (live) live.modules = h.modules;
    });
  } catch (err) { e.target.checked = !want; toast(err.message, 'bad'); }
});

// Hostels whose police verification is done by us. One tap enters that hostel on the verification queue.
PAGES['admin-pv'] = {
  title: 'Police verification', ...superOnly,
  render() {
    if (!adm.data) return admWait('Police verification');
    if (adm.data.error) return admErr();
    const hs = (adm.data.hostels || []).filter(h => h.modules && h.modules.pvPlatform === true);
    return `${head('Police verification', t('{n} hostels use the Sarvlekh team', { n: hs.length }))}
      ${about('Switch this on for a hostel in its Modules tab. Open its queue here, verify each tenant on the police portal and save the acknowledgement: the owner sees the status and the papers in their own panel.')}
      ${hs.length ? `<div class="group">${hs.map(h => li({ icon: 'shield', ic: 'info', t: h.name, d: [h.city, t('{n} residents', { n: (statOf(h.id) || {}).residents || 0 })].filter(Boolean).join(' · '), act: 'pvopen', attrs: `data-id="${h.id}"` })).join('')}</div>`
        : `<div class="card">${empty('No hostel yet', 'Open a hostel, go to Modules and switch on "Police verification done by Sarvlekh team".')}</div>`}`;
  },
};
A.pvopen = async el => { await chooseContext('super:' + el.dataset.id); go('emitra'); };

PAGES['admin-users'] = {
  title: 'All users', ...superOnly,
  render() {
    if (!adm.data) return admWait('All users');
    if (adm.data.error) return admErr();
    const { profiles, members, orgs, hostels } = adm.data;
    // First choose the client, then (optionally) one of its hostels, then the kind of user: only that group is listed.
    const org = curFlt('auo', ''), hos = curFlt('auh', ''), role = curFlt('aur', 'owner');
    const orgHostels = hostels.filter(h => h.org_id === org);
    const hostel = orgHostels.some(h => h.id === hos) ? hos : '';
    if (org && role === 'res' && !adm.res.started) admResidents();
    const kindOf = m => (m.role === 'resident' ? 'res' : m.role === 'owner' || (m.role === 'manager' && !m.hostel_id) ? 'owner' : 'staff');
    const profOf = id => profiles.find(p => p.id === id);
    let rows = [];
    if (org) {
      const seen = new Set();
      for (const m of members) {
        if (m.org_id !== org || kindOf(m) !== role || (hostel && m.hostel_id && m.hostel_id !== hostel)) continue;
        if (hostel && !m.hostel_id && role !== 'owner') continue;
        const p = profOf(m.user_id); if (!p || seen.has(p.id)) continue; seen.add(p.id);
        if (!needle('au', p.full_name, p.username, p.phone)) continue;
        rows.push({ p, m });
      }
      rows.sort((x, y) => String(x.p.full_name).localeCompare(String(y.p.full_name)));
    }
    const cnt = k => (org ? new Set(members.filter(m => m.org_id === org && kindOf(m) === k && (!hostel || !m.hostel_id || m.hostel_id === hostel)).map(m => m.user_id)).size : 0);
    const orgSel = `<select class="hsel" data-flt="auo" aria-label="${esc(t('Client'))}"><option value="">${esc(t('Choose a client…'))}</option>${orgs.slice().sort((x, y) => String(x.name).localeCompare(String(y.name))).map(o => `<option value="${o.id}" ${o.id === org ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    const hosSel = org ? `<select class="hsel" data-flt="auh" aria-label="${esc(t('Hostel'))}"><option value="">${esc(t('All hostels'))}</option>${orgHostels.map(h => `<option value="${h.id}" ${h.id === hostel ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select>` : '';
    return `${head('All users', org ? t('{n} {r}', { n: rows.length, r: t(role === 'res' ? 'residents' : role === 'owner' ? 'owners' : 'staff') }) : t('Choose a client to see its people'))}
      <div class="tool">${orgSel}${hosSel}</div>
      ${org ? `<div class="tool">${searchBox('au', 'Search name, user ID, mobile')}${chips('aur', [['owner', t('Owners') + ' ' + cnt('owner')], ['staff', t('Staff') + ' ' + cnt('staff')], ['res', t('Residents') + ' ' + cnt('res')]], 'owner')}</div>` : ''}
      ${!org ? `<div class="card">${empty('Pick a client first', 'Then pick Owners, Staff or Residents. Only the people of that client are shown, never everyone in one long list.')}</div>`
        : `${group('', rows.slice(0, ui.lim.au || 80).map(({ p, m }) => li({ lead: avatar(p.full_name), t: `${p.full_name} · @${p.username}`, d: [t(ROLES[m.role] ? ROLES[m.role].l : m.role), m.hostel_id ? (hostels.find(h => h.id === m.hostel_id) || {}).name : t('every hostel'), p.phone || '', p.active === false ? t('Disabled') : ''].filter(Boolean).join(' · '), act: 'admuser', attrs: `data-id="${p.id}"` })).join(''))}
        ${rows.length > (ui.lim.au || 80) ? `<div style="text-align:center;margin-top:12px">${btn('Show more', 'more', 'data-key="au" data-per="80"', 'sm')}</div>` : ''}
        ${role === 'res' && !adm.res.done ? `<div style="text-align:center;margin-top:12px">${adm.res.loading ? '<div class="spin"></div>' : btn('Load more resident logins', 'admresmore', '', 'sm')}</div>` : ''}`}`;
  },
};
A.admresmore = () => admResidents();
A.admuser = el => {
  const p = adm.data.profiles.find(x => x.id === el.dataset.id); if (!p) return;
  const ms = adm.data.members.filter(m => m.user_id === p.id);
  sheet(`${p.full_name} · @${p.username}`, `<dl class="kv"><dt>${esc(t('Mobile'))}</dt><dd>${esc(p.phone || '—')}</dd><dt>${esc(t('Status'))}</dt><dd>${esc(t(p.active === false ? 'Disabled' : 'Active'))}</dd></dl>
    ${group('Access', ms.map(m => li({ icon: 'key', ic: m.active ? 'ok' : 'mute', t: `${t(ROLES[m.role] ? ROLES[m.role].l : m.role)} · ${(adm.data.orgs.find(o => o.id === m.org_id) || {}).name || ''}`, d: m.hostel_id ? (adm.data.hostels.find(h => h.id === m.hostel_id) || {}).name : t('all hostels'), end: btn('', 'admmemdel', `data-id="${m.id}" aria-label="${esc(t('Remove access'))}"`, 'sm bad', 'trash') })).join(''))}`,
  { foot: `${p.is_super ? '' : `<button class="btn bad" data-act="admuserdel" data-id="${p.id}">${esc(t('Delete'))}</button>`}<span class="sp"></span><button class="btn" data-act="admpw" data-id="${p.id}">${esc(t('Set password'))}</button><button class="btn" data-act="admactive" data-id="${p.id}">${esc(t(p.active === false ? 'Enable' : 'Disable'))}</button>` });
};
A.admpw = el => A.admsetpw(el);
A.admactive = async el => { const p = adm.data.profiles.find(x => x.id === el.dataset.id), on = p.active === false; await Backend.admin('set_active', { user_id: p.id, active: on }); p.active = on; closeModal(); render(); toast(on ? 'Enabled' : 'Disabled'); };
A.admuserdel = el => { const p = adm.data.profiles.find(x => x.id === el.dataset.id); confirmBox(t('Delete login @{u}? Their hostel records stay.', { u: p.username }), async () => { await Backend.admin('delete_user', { user_id: p.id }); adm.data = null; }, 'Delete', 'bad'); };
A.admmemdel = el => confirmBox(t('Remove this access?'), async () => { await Backend.remove('members', el.dataset.id); adm.data = null; }, 'Remove', 'bad');


/* ===================================================================== Usage & health (platform health, read live)
 * Supabase: memory, swap, CPU, disk, connections, cache hit rate and uptime come from the project's own metrics (through the server).
 * Cloudflare: requests, errors and CPU time per request, once a read-only API token is set on the server.
 * Every card says what the number means, whether it is fine, and what to do if it is not. Nothing is guessed. */
const HEALTH_PLAN = { dbMb: 500, filesMb: 1024, cfDailyRequests: 100000, cfCpuMs: 10 };   // Supabase Free + Cloudflare Workers Free; change when upgraded
const HEALTH_LINKS = {
  supaPlan: 'https://supabase.com/dashboard/project/_/settings/billing/subscription', supaBill: 'https://supabase.com/dashboard/org/_/billing', supaUsage: 'https://supabase.com/dashboard/org/_/usage',
  supaCompute: 'https://supabase.com/dashboard/project/_/settings/compute-and-disk', supaQueries: 'https://supabase.com/dashboard/project/_/reports/query-performance', supaLogs: 'https://supabase.com/dashboard/project/_/logs/postgres-logs',
  cfPlan: 'https://dash.cloudflare.com/?to=/:account/workers/plans', cfBill: 'https://dash.cloudflare.com/?to=/:account/billing', cfCard: 'https://dash.cloudflare.com/?to=/:account/billing/payment-info',
  cfLogs: 'https://dash.cloudflare.com/?to=/:account/workers/services/view/hostelos/production/observability', cfToken: 'https://dash.cloudflare.com/profile/api-tokens',
};
adm.health = adm.health || { data: null, at: 0, loading: false, error: '', tried: false };
async function admHealthLoad(force) {
  const h = adm.health; if (h.loading) return;
  if (!force && h.data && Date.now() - h.at < 600000) return;
  h.loading = true;
  try { h.data = await Backend.admin('health', { fresh: !!force }); h.at = Date.now(); h.error = ''; }
  catch (e) { h.error = e.message || 'Could not read the platform health'; }
  h.loading = false; render();
}
function healthSnap(db, files) {
  try {
    const k = 'sarv.health.snap', arr = JSON.parse(localStorage.getItem(k) || '[]'), day = today();
    if (db != null && !arr.some(x => x.d === day)) { arr.push({ d: day, db, files: files || 0 }); localStorage.setItem(k, JSON.stringify(arr.slice(-45))); }
    return arr;
  } catch (e) { return []; }
}
// days until a limit is reached at the pace of the saved daily readings (null = not enough readings, or not growing)
function healthDaysLeft(key, used, limit, snaps) {
  const pts = snaps.filter(x => x[key] != null); if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1], days = Math.max(1, diffDays(b.d, a.d)), perDay = (b[key] - a[key]) / days;
  return perDay > 0.001 ? Math.max(0, Math.floor((limit - used) / perDay)) : null;
}
const mb = n => Math.round(n / 1048576 * 10) / 10, gb = n => Math.round(n / 1073741824 * 100) / 100;
const lvl = (p, warn, bad) => (p == null ? 'na' : p >= bad ? 'bad' : p >= warn ? 'warn' : 'ok');
const worse = (a, b) => ({ na: 0, ok: 1, warn: 2, bad: 3 }[b] > { na: 0, ok: 1, warn: 2, bad: 3 }[a] ? b : a);
// One entry per thing worth watching: what it is, how full, plain meaning, and what to do when it is not green.
function healthSignals() {
  const d = adm.data || {}, hd = adm.health.data, sp = hd && hd.supabase && hd.supabase.ok ? hd.supabase : null, cf = hd && hd.cloudflare, out = [];
  const files = d.files ? Math.round(sum(d.files, r => +r.mb || 0) * 10) / 10 : null, size = d.size;
  const snaps = healthSnap(size, files);
  const add = o => out.push(o);
  if (sp) {
    const m = sp.memory, ramP = m.total ? m.used / m.total * 100 : null, swapP = m.swapTotal ? m.swapUsed / m.swapTotal * 100 : 0;
    add({ k: 'ram', group: 'Server', label: 'Memory (RAM)', icon: 'chart', pct: ramP, level: worse(lvl(ramP, 85, 95), lvl(swapP, 25, 50)),
      value: `${mb(m.used)} of ${mb(m.total)} MB used`, sub: `${t('Swap (spill-over memory on disk)')}: ${mb(m.swapUsed)} of ${mb(m.swapTotal)} MB (${Math.round(swapP)}%)`,
      info: t('Memory is where the database keeps what it is working on. When it runs out the server spills onto the disk (swap) and everything slows down. Example: 70% RAM used is normal; swap above 25% means the server is short of memory.'),
      act: swapP >= 25 ? t('The server is already using swap: memory is tight. Move the database to the next compute size before more hostels go live.') : ramP >= 85 ? t('Memory is nearly full. Plan a compute upgrade.') : '', link: HEALTH_LINKS.supaCompute, linkL: t('Change compute size'),
      stat: `${m.total ? Math.round(m.total / 1048576) : '?'} MB ${t('server')}` });
    const c = sp.cpu, cpuP = c.now;
    add({ k: 'cpu', group: 'Server', label: 'Processor (CPU)', icon: 'bolt', pct: cpuP, level: lvl(cpuP, 70, 90),
      value: `${Math.round(cpuP == null ? 0 : cpuP)}% ${t('busy this minute')}`, sub: `${t('Load')} ${c.load1} / ${c.load5} / ${c.load15} (1, 5, 15 min) · ${c.cores} ${t('cores')} · ${t('average since restart')} ${Math.round(c.sinceBoot || 0)}%`,
      info: t('How hard the database processors are working. Short spikes are fine. Example: above 70% for many minutes means reports or many people at once are straining it; above 90% the app times out.'),
      act: cpuP >= 70 ? t('The processor is busy. Open the slow-query report to see which screen is heavy.') : '', link: HEALTH_LINKS.supaQueries, linkL: t('See slow queries') });
    const dk = sp.disk.data, dkP = dk ? dk.used / dk.size * 100 : null;
    if (dk) add({ k: 'disk', group: 'Server', label: 'Server disk', icon: 'folder', pct: dkP, level: lvl(dkP, 70, 85), value: `${gb(dk.used)} of ${gb(dk.size)} GB used`, sub: t('The disk that holds the database files and logs.'),
      info: t('The disk the database lives on, including logs and backups of its own. Example: 16% used leaves plenty of room; above 85% the database can stop writing.'), act: dkP >= 70 ? t('The disk is filling up. Upgrade disk size or archive old logs.') : '', link: HEALTH_LINKS.supaCompute, linkL: t('Change disk size') });
    const pl = sp.pooler, plP = pl && pl.max ? pl.clients / pl.max * 100 : null;
    if (pl && pl.max) add({ k: 'conn', group: 'Database', label: 'Connections', icon: 'users', pct: plP, level: lvl(plP, 70, 90), value: `${pl.clients} of ${pl.max} ${t('in use')}`, sub: t('People and servers connected to the database right now.'),
      info: t('Each open screen can hold a connection. Example: 1 of 200 is nothing; close to the limit means new logins start failing.'), act: plP >= 70 ? t('Many connections are open. Check for a runaway job.') : '', link: HEALTH_LINKS.supaLogs, linkL: t('Open the logs') });
    const ch = sp.database.cacheHit;
    add({ k: 'cache', group: 'Database', label: 'Cache hit rate', icon: 'check', pct: ch, level: ch == null ? 'na' : ch < 90 ? 'bad' : ch < 97 ? 'warn' : 'ok', invert: true, value: ch == null ? '—' : ch.toFixed(2) + '%', sub: t('How often data was found in memory instead of read from disk.'),
      info: t('Reading from memory is fast, from disk is slow. Example: 99% or more is excellent; below 95% means the database does not fit in memory and screens will feel slow.'), act: ch != null && ch < 97 ? t('Data is being read from disk too often. More memory (a larger compute size) fixes this.') : '', link: HEALTH_LINKS.supaCompute, linkL: t('Change compute size') });
    add({ k: 'db', group: 'Database', label: 'Database up', icon: 'power', pct: sp.database.up ? 0 : 100, level: sp.database.up ? 'ok' : 'bad', noBar: true, value: sp.database.up ? t('Running') : t('Down'), sub: `${t('Up for')} ${Math.floor(sp.uptimeDays || 0)} ${t('days')} · ${sp.database.restarts || 0} ${t('restarts')} · ${sp.database.deadlocks || 0} ${t('deadlocks')}`,
      info: t('Whether the database is answering, how long since it last restarted, and whether queries blocked each other (deadlocks). Example: restarts of 0 and deadlocks of 0 is what you want.'), act: sp.database.up ? '' : t('The database is not answering. Check the Supabase status page now.'), link: 'https://status.supabase.com', linkL: t('Supabase status') });
  }
  if (size != null) { const p = size / HEALTH_PLAN.dbMb * 100, dl = healthDaysLeft('db', size, HEALTH_PLAN.dbMb, snaps);
    add({ k: 'dbsize', group: 'Database', label: 'Data stored', icon: 'chart', pct: p, level: lvl(p, 70, 85), value: `${size} of ${HEALTH_PLAN.dbMb} MB`, sub: dl != null ? t('About {n} days until full at the current pace', { n: dl }) : t('Pace shows after two days of readings'),
      info: t('All your clients\' records: residents, bills, payments, readings. Example: 400 of 500 MB leaves 100 MB; the free plan stops saving when it is full.'), act: p >= 70 ? t('Close to the free limit. Upgrade to Pro (8 GB) or archive old logs.') : '', link: HEALTH_LINKS.supaPlan, linkL: t('Upgrade plan'), days: dl }); }
  if (files != null) { const p = files / HEALTH_PLAN.filesMb * 100, dl = healthDaysLeft('files', files, HEALTH_PLAN.filesMb, snaps);
    add({ k: 'files', group: 'Database', label: 'Document storage', icon: 'folder', pct: p, level: lvl(p, 70, 85), value: `${files} of ${HEALTH_PLAN.filesMb} MB`, sub: dl != null ? t('About {n} days until full at the current pace', { n: dl }) : t('Photos of Aadhaar cards and other papers'),
      info: t('Photos of IDs and other papers. Example: 20 new residents a day with 2 photos each adds about 5 MB a day.'), act: p >= 70 ? t('Run "Delete old documents now" or upgrade storage.') : '', link: HEALTH_LINKS.supaPlan, linkL: t('Upgrade plan'), days: dl }); }
  if (cf && cf.configured && !cf.error) {
    const rp = cf.requestsToday / HEALTH_PLAN.cfDailyRequests * 100, ep = cf.requestsToday ? cf.errorsToday / cf.requestsToday * 100 : 0, cpuMs = cf.cpuP99 ? cf.cpuP99 / 1000 : 0;
    add({ k: 'cfreq', group: 'Cloudflare', label: 'Requests today', icon: 'globe', pct: rp, level: lvl(rp, 70, 90), value: `${cf.requestsToday.toLocaleString('en-IN')} of ${HEALTH_PLAN.cfDailyRequests.toLocaleString('en-IN')}`, sub: `${cf.requestsHour.toLocaleString('en-IN')} ${t('in the last hour')} · ${cf.subrequestsToday.toLocaleString('en-IN')} ${t('calls to the database')}`,
      info: t('How many times the app\'s server was called today (logins, saves, e-mails). The free Workers plan allows 100,000 a day. Example: 5,000 is very light.'), act: rp >= 70 ? t('You may hit the daily free limit. Move to the Workers Paid plan.') : '', link: HEALTH_LINKS.cfPlan, linkL: t('Workers plans') });
    add({ k: 'cferr', group: 'Cloudflare', label: 'Errors today', icon: 'alert', pct: ep, level: ep >= 5 ? 'bad' : ep >= 1 ? 'warn' : 'ok', value: `${cf.errorsToday.toLocaleString('en-IN')} (${ep.toFixed(2)}%)`, sub: `${cf.errorsHour.toLocaleString('en-IN')} ${t('in the last hour')}`,
      info: t('Calls that failed on the server. Example: under 1% is normal; a sudden jump after a release means something broke.'), act: ep >= 1 ? t('Errors are above normal. Read the live logs.') : '', link: HEALTH_LINKS.cfLogs, linkL: t('Open live logs') });
    add({ k: 'cfcpu', group: 'Cloudflare', label: 'Server time per call', icon: 'clock', pct: cpuMs / HEALTH_PLAN.cfCpuMs * 100, level: lvl(cpuMs / HEALTH_PLAN.cfCpuMs * 100, 70, 95), value: `${(cf.cpuP50 / 1000).toFixed(1)} ms ${t('typical')} · ${cpuMs.toFixed(1)} ms ${t('slowest 1%')}`, sub: t('The free plan cuts a call off at 10 ms of processing.'),
      info: t('How long the server works on one call (waiting for the database is not counted). Example: 2 ms is great; close to 10 ms, calls start to fail on the free plan.'), act: cpuMs >= 7 ? t('Calls are close to the 10 ms free limit. Workers Paid has no such cut-off.') : '', link: HEALTH_LINKS.cfPlan, linkL: t('Workers plans') });
  }
  return { list: out, snaps };
}
const HL_COL = { ok: 'ok', warn: 'warn', bad: 'bad', na: 'mute' };
// "Everything fine" or the few things to do, worst first.
function healthVerdict(list) {
  const bad = list.filter(m => m.level === 'bad'), warn = list.filter(m => m.level === 'warn');
  if (bad.length) return { level: 'bad', title: t('Act now'), sub: t(bad.length === 1 ? '1 thing is in the red' : '{n} things are in the red', { n: bad.length }), items: [...bad, ...warn] };
  if (warn.length) return { level: 'warn', title: t('Needs attention soon'), sub: t(warn.length === 1 ? '1 thing is getting full' : '{n} things are getting full', { n: warn.length }), items: warn };
  return { level: 'ok', title: t('All systems healthy'), sub: t('Nothing needs doing right now.'), items: [] };
}
// Red banner on the super admin home: only what is in trouble, with what to do. (Loads the numbers in the background.)
function healthBanner() {
  if (!adm.data || adm.data.error) return '';
  if (!adm.health.tried) { adm.health.tried = true; setTimeout(() => admHealthLoad(false), 0); }
  const v = healthVerdict(healthSignals().list); if (!v.items.length) return '';
  return v.items.slice(0, 3).map(m => `<div class="note ${m.level === 'bad' ? 'bad' : 'warn'}" style="margin-bottom:10px"><b>${ico('alert', 'sm')} ${esc(t(m.label))}: ${esc(m.value)}${m.days != null ? ' · ' + esc(t('about {n} days left', { n: m.days })) : ''}</b><br>${esc(m.act || m.sub)}<div style="margin-top:8px">${m.link ? `<a class="btn sm primary" data-act="noop" href="${m.link}" target="_blank" rel="noopener">${esc(m.linkL || t('Open'))}</a> ` : ''}<button class="btn sm" data-act="go" data-to="admin-usage">${esc(t('See details'))}</button></div></div>`).join('');
}
function healthCard(m) {
  const col = HL_COL[m.level], p = m.pct == null ? 0 : Math.max(0, Math.min(100, m.invert ? 100 - (100 - m.pct) * 10 : m.pct));
  return `<div class="hl-card ${m.level}"><div class="row sb" style="align-items:center;gap:8px">${withTip(`<b>${esc(t(m.label))}</b>`, tip(esc(m.info)))}<span class="badge ${col}">${esc(t(m.level === 'ok' ? 'Healthy' : m.level === 'warn' ? 'Watch' : m.level === 'bad' ? 'Act' : 'n/a'))}</span></div>
    <div class="hl-v">${esc(m.value)}</div>${m.noBar ? '' : `<div class="bar ${col}" style="margin:8px 0 6px"><i style="width:${Math.max(2, Math.min(100, Math.round(p)))}%"></i></div>`}
    <div class="xs muted">${esc(m.sub || '')}</div>${m.act ? `<div class="hl-act">${esc(m.act)}${m.link ? ` <a data-act="noop" href="${m.link}" target="_blank" rel="noopener">${esc(m.linkL || t('Open'))} →</a>` : ''}</div>` : ''}</div>`;
}
function healthPanel() {
  const h = adm.health, hd = h.data, { list } = healthSignals(), v = healthVerdict(list);
  if (!h.tried) { h.tried = true; setTimeout(() => admHealthLoad(false), 0); }
  const cf = hd && hd.cloudflare, sb = hd && hd.supabase;
  const when = h.at ? `${t('Checked')} ${ago(new Date(h.at).toISOString())}` : '';
  const verdict = `<div class="hl-verdict ${v.level}"><div class="hl-vic">${ico(v.level === 'ok' ? 'check' : 'alert')}</div><div class="hl-vt"><b>${esc(v.title)}</b><span>${esc(h.loading && !hd ? t('Reading the servers…') : v.sub)}</span></div><button class="btn sm" data-act="admhealth" ${h.loading ? 'disabled' : ''}>${ico('sync', 'sm')} ${esc(h.loading ? t('Checking…') : t('Check now'))}</button></div>
    ${when ? `<p class="xs muted" style="margin:-4px 2px 10px">${esc(when)}</p>` : ''}${h.error ? `<div class="note bad" style="margin-bottom:10px">${esc(h.error)}</div>` : ''}
    ${sb === undefined || (hd && sb && !sb.ok) ? `<div class="note warn" style="margin-bottom:10px">${esc(t('Server numbers could not be read'))}${sb && sb.error ? ': ' + esc(sb.error) : ''}</div>` : ''}`;
  const next = v.items.length ? `<div class="group-t">${esc(t('What to do'))}</div><div class="group">${v.items.map(m => li({ icon: m.level === 'bad' ? 'alert' : 'clock', ic: HL_COL[m.level], t: `${t(m.label)} · ${m.value}`, d: m.act || m.sub, chev: false, end: m.link ? `<a class="btn sm" data-act="noop" href="${m.link}" target="_blank" rel="noopener">${esc(m.linkL || t('Open'))}</a>` : '' })).join('')}</div>` : '';
  const groups = ['Server', 'Database', 'Cloudflare'].map(g => { const xs = list.filter(m => m.group === g); return xs.length ? `<div class="group-t">${esc(t(g === 'Server' ? 'Database server' : g === 'Database' ? 'Database & storage' : 'Cloudflare app server'))}</div><div class="hl-grid">${xs.map(healthCard).join('')}</div>` : ''; }).join('');
  const setup = cf && !cf.configured ? `<div class="card hl-setup"><b>${ico('globe', 'sm')} ${esc(t('Connect Cloudflare (2 minutes, once)'))}</b>
      <p class="sm muted" style="margin:6px 0 10px">${esc(t('Requests, errors and server time come from Cloudflare. It needs a read-only token. Nothing can be changed with it.'))}</p>
      <ol class="hl-steps"><li>${esc(t('Open the token page and press'))} <b>Create Token → Create Custom Token</b>. <a data-act="noop" href="${HEALTH_LINKS.cfToken}" target="_blank" rel="noopener">${esc(t('Open token page'))} →</a></li>
        <li>${esc(t('Give it one permission: Account → Account Analytics → Read. Account resources: your account. Create it and copy the token.'))}</li>
        <li>${esc(t('In PowerShell, in the app folder, run this and paste the token when asked:'))}<code class="hl-code" id="hlCmd">npx wrangler secret put CLOUDFLARE_API_TOKEN --name hostelos</code><button class="btn sm" data-act="copycmd">${ico('copy', 'sm')} ${esc(t('Copy command'))}</button></li>
        <li>${esc(t('Come back here and press Check now.'))}</li></ol></div>`
    : cf && cf.error ? `<div class="note warn" style="margin-bottom:10px"><b>Cloudflare:</b> ${esc(cf.error)}. ${esc(t('Check that the token has Account Analytics: Read.'))}</div>` : '';
  const ups = group('Upgrade & billing', [
    li({ icon: 'rupee', ic: 'ok', t: t('Supabase: upgrade plan'), d: t('Pro: 8 GB database, 100 GB storage, bigger compute.'), act: 'noop', tag: 'a', attrs: `href="${HEALTH_LINKS.supaPlan}" target="_blank" rel="noopener"` }),
    li({ icon: 'chart', ic: 'info', t: t('Supabase: compute size (RAM and CPU)'), d: t('The fix when memory or CPU is tight.'), act: 'noop', tag: 'a', attrs: `href="${HEALTH_LINKS.supaCompute}" target="_blank" rel="noopener"` }),
    li({ icon: 'wallet', ic: 'info', t: t('Supabase: billing & credit card'), d: t('Add or change the card, see invoices.'), act: 'noop', tag: 'a', attrs: `href="${HEALTH_LINKS.supaBill}" target="_blank" rel="noopener"` }),
    li({ icon: 'rupee', ic: 'ok', t: t('Cloudflare: Workers plan'), d: t('Paid plan removes the daily request limit and the 10 ms cut-off.'), act: 'noop', tag: 'a', attrs: `href="${HEALTH_LINKS.cfPlan}" target="_blank" rel="noopener"` }),
    li({ icon: 'wallet', ic: 'info', t: t('Cloudflare: billing & credit card'), d: t('Add or change the card, see invoices.'), act: 'noop', tag: 'a', attrs: `href="${HEALTH_LINKS.cfBill}" target="_blank" rel="noopener"` }),
  ].join(''));
  return `${verdict}${next}${groups}${setup}${ups}`;
}
A.admhealth = () => admHealthLoad(true);
A.copycmd = async el => { const c = document.getElementById('hlCmd'); try { await navigator.clipboard.writeText(c.textContent); toast(t('Copied. Paste it in PowerShell.')); } catch (e) { toast(t('Select the command and copy it'), 'warn'); } };
PAGES['admin-usage'] = {
  title: 'Usage & health', ...superOnly,
  render() {
    if (!adm.data) return admWait('Usage & health');
    if (adm.data.error) return admErr();
    const { hostels, orgs, size } = adm.data, rows = sum(adm.data.stats, s => +s.rows || 0);
    return `${head('Usage & health', t('Live health of the database and the app server, in plain words.'), btn('', 'admreload', `aria-label="${esc(t('Refresh'))}"`, '', 'sync'))}
      ${healthPanel()}
      ${table([{ h: 'Hostel', f: h => `<b>${esc(h.name)}</b><div class="hint">${esc((orgs.find(o => o.id === h.org_id) || {}).name || '')}</div>` }, { h: 'Residents', f: h => statOf(h.id).residents || 0 }, { h: 'Records', f: h => (+statOf(h.id).rows || 0).toLocaleString('en-IN') }, { h: 'Last activity', f: h => (statOf(h.id).last_activity ? ago(statOf(h.id).last_activity) : '—') }, { h: '', acts: true, f: h => btn('Open', 'openhostel', `data-id="${h.id}"`, 'sm') }], hostels.slice().sort((a, b) => (+statOf(b.id).rows || 0) - (+statOf(a.id).rows || 0)), { key: 'usage' })}
      ${filesCard(adm.data.files)}
      ${backupCard(adm.data.backups, adm.data.drive)}
      ${group('Cashfree Gateway & Financial Reconciliation', [
        li({ icon: 'rupee', ic: 'ok', t: t('Payment Gateway Status & Reconciliation'), d: t('Reconciles pending payments across all PG properties against Cashfree authoritative orders.'), act: 'admreconcile' }),
        li({ icon: 'alert', ic: 'warn', t: t('Initiate Authorized Refund'), d: t('Issue a verified UPI refund for a customer payment via Cashfree.'), act: 'admrefund' })
      ])}
      ${group('Maintenance', [
        li({ icon: 'trash', ic: 'warn', t: t('Clean up deleted records'), d: t('Permanently removes records deleted more than 60 days ago.'), act: 'admpurge' }),
        li({ icon: 'box', ic: 'info', t: t('Archive old day logs'), d: t('Gate entries, cleaning tasks and meal skips older than 18 months. Bills, payments and salaries are never touched.'), act: 'admarchive' }),
      ].join(''))}`;
  },
};
/* ID papers live in the private `docs` Storage bucket (1 GB on the free plan). The daily
 * sweep (CRON_SECRET on Vercel) deletes papers 30 days after a checkout; this button runs
 * the same sweep now. */
function filesCard(rows) {
  if (!CLOUD) return group('Document storage', li({ icon: 'folder', ic: 'mute', t: t('Documents'), d: t('Not available in demo mode'), chev: false }));
  const n = sum(rows || [], r => +r.files || 0), mb = Math.round(sum(rows || [], r => +r.mb || 0) * 10) / 10;
  return group('Document storage', [
    li({ icon: 'folder', ic: mb > 800 ? 'bad' : 'ok', t: t('{n} files · {m} MB', { n: n.toLocaleString('en-IN'), m: mb }), d: t('{p}% of the 1 GB free storage', { p: pct(mb, 1024) }), chev: false }),
    li({ icon: 'trash', ic: 'warn', t: t('Delete old documents now'), d: t('Removes papers of people who left more than {n} days ago. Runs by itself every night.', { n: DOC_KEEP_DAYS }), act: 'admsweep' }),
  ].join(''));
}
/* Backups. The nightly cron writes one file per hostel each week; here the platform admin sees the newest
 * file of every hostel, downloads it (to keep a copy in Drive or on a computer) or makes a fresh one. A new
 * backup on the same day replaces that day's file, so pressing the button again never piles up copies. */
function backupCard(rows, drive) {
  if (!CLOUD) return '';
  // undefined = the slow /api/admin call has not come back yet; null = it came back empty or
  // failed. Telling someone the list "could not load" while it is still on its way is worse
  // than showing them that it is on its way.
  if (rows === undefined) return group('Backups', li({ icon: 'sync', ic: 'mute', t: t('Checking backups…'), d: t('This one goes through the server, so it takes a moment.'), chev: false }));
  if (!rows) return group('Backups', li({ icon: 'folder', ic: 'mute', t: t('Backups'), d: t('Could not load the list. Run the latest database update.'), chev: false }));
  const newest = id => rows.filter(r => r.hostel_id === id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  const kb = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const dr = !drive ? '' : !drive.configured
    ? li({ icon: 'folder', ic: 'mute', t: t('Google Drive'), d: t('Not set up on the server yet (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).'), chev: false })
    : drive.connected
      ? li({ icon: 'folder', ic: 'ok', t: t('Google Drive connected'), d: `${drive.email || ''} · ${t('Every backup is copied to the Sarvlekh Backups folder')}${drive.encrypted ? '' : ' · ' + t('not encrypted: set BACKUP_PASSPHRASE')}`, act: 'admdriveoff', end: badge('Disconnect', 'bad') })
      : li({ icon: 'folder', ic: 'warn', t: t('Connect Google Drive'), d: t('Weekly backups of all hostels are also saved in your own Drive.'), act: 'admdriveon' });
  return group('Backups', [
    dr,
    li({ icon: 'sync', ic: 'ok', t: t('Back up all hostels now'), d: t('One file per hostel per day. Done again the same day, it replaces that file.'), act: 'admbackup' }),
    ...adm.data.hostels.map(h => { const f = newest(h.id); return li(f
      ? { icon: 'download', ic: 'info', t: h.name, d: `${fmtDate(String(f.at).slice(0, 10))} · ${kb(+f.size || 0)} · ${t('tap to download')}`, act: 'admbackupget', attrs: `data-name="${esc(f.name)}"` }
      : { icon: 'download', ic: 'mute', t: h.name, d: t('No backup yet'), chev: false }); }),
  ].join(''), t('A copy kept only here is lost with the project. Download now and then and keep it in Google Drive.'));
}
A.admbackup = async el => {
  if (el) el.disabled = true;
  let ok = 0;
  try {
    for (const h of adm.data.hostels) { toast(t('Backing up {n}', { n: h.name })); await Backend.admin('backup_now', { hostel_id: h.id }); ok++; }
    toast(t('{n} hostels backed up', { n: ok }));
  } catch (e) { toast(e.message, 'bad'); }
  finally { if (el) el.disabled = false; adm.data = null; render(); }
};
A.admdriveon = async () => { try { const r = await Backend.admin('drive_connect'); location.assign(r.url); } catch (e) { toast(e.message, 'bad'); } };
A.admdriveoff = () => confirmBox(t('Stop copying backups to Google Drive? Files already in Drive stay there.'), async () => { await Backend.admin('drive_disconnect'); adm.data = null; render(); toast(t('Disconnected')); }, 'Disconnect', 'bad');
// Back from Google: /admin-usage?drive=connected
(() => { try { const q = new URLSearchParams(location.search), d = q.get('drive'); if (!d) return; history.replaceState(null, '', location.pathname); setTimeout(() => toast(d === 'connected' ? t('Google Drive connected') : d === 'cancelled' ? t('Google Drive was not connected') : d, d === 'connected' ? 'ok' : 'bad'), 600); } catch (e) { /* ignore */ } })();
A.admbackupget = async el => {
  try { const r = await Backend.admin('backup_url', { name: el.dataset.name }); location.assign(r.url); }
  catch (e) { toast(e.message, 'bad'); }
};
A.admsweep = async el => {
  if (el) el.disabled = true;
  try { const r = await Backend.admin('sweep_files'); toast(t('{n} old documents deleted', { n: r.removed || 0 })); adm.data = null; render(); }
  catch (e) { toast(e.message, 'bad'); } finally { if (el) el.disabled = false; }
};

A.admarchive = () => confirmBox(
  t('Delete gate entries, cleaning tasks, meal skips and notifications older than 18 months? Bills, payments, salaries, expenses and resident records are not touched. This cannot be undone.'),
  async () => {
    const rows = await Backend.rpc('purge_old_logs', { months: 18 });
    const n = (rows || []).reduce((a, x) => a + (+x.removed || 0), 0);
    toast(t('{n} old records archived', { n }));
    adm.data = null; render();
  }, 'Archive', 'bad');

A.admpurge = async () => { const n = await Backend.rpc('purge_deleted'); toast(t('{n} old records removed', { n: n || 0 })); adm.data = null; render(); };

A.admreconcile = async () => {
  toast(t('Running global payment reconciliation...'));
  try {
    const res = await Backend.admin('reconcile_payments');
    if (res && res.ok) {
      sheet(t('Payment Reconciliation Summary'), `
        <div class="card" style="line-height:1.8">
          <p><b>${esc(t('Orders Checked:'))}</b> ${res.orders_checked}</p>
          <p><b>${esc(t('Discrepancies Found:'))}</b> ${res.mismatches_found}</p>
          <p><b>${esc(t('Automatically Resolved:'))}</b> ${res.resolved_count}</p>
        </div>
      `, { foot: btn('Close', 'closemodal', '', 'primary') });
    }
  } catch (err) {
    toast(err.message, 'bad');
  }
};

A.admrefund = () => {
  formModal({
    title: t('Initiate Cashfree Refund'),
    submit: t('Authorize Refund'),
    note: t('Enter the Cashfree Order ID, refund amount, and reason. The refund is verified and executed directly via Cashfree Payments API.'),
    fields: [
      { name: 'order_id', label: t('Order ID (ord_... or cf_...)'), required: true },
      { name: 'amount', label: t('Refund Amount (₹)'), type: 'number', min: 1, required: true },
      { name: 'reason', label: t('Reason for Refund'), required: true }
    ],
    onSubmit: async v => {
      try {
        const r = await Backend.admin('initiate_refund', {
          order_id: v.order_id,
          amount: Number(v.amount),
          reason: v.reason
        });
        toast(t('Refund {id} successfully processed (₹{a})', { id: r.refund_id, a: r.amount }), 'ok');
      } catch (err) {
        return err.message;
      }
    }
  });
};
