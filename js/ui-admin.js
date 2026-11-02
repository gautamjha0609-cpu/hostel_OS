'use strict';
/* Super admin: clients (orgs) → hostels, module switches, plans, logins, usage & health. */

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
    const [orgs, hostels, members, stats, usage, files, backups, drive] = await Promise.all([Backend.rpc('my_orgs_billing'), Backend.list('hostels', '&order=name'), admAll('members', '&role=neq.resident&order=id'), Backend.rpc('admin_stats').catch(() => []), admUsage(), CLOUD ? Backend.rpc('doc_files_usage').catch(() => null) : null, CLOUD ? Backend.admin('backup_list').catch(() => null) : null, CLOUD ? Backend.admin('drive_status').catch(() => null) : null]);
    const supers = await Backend.list('profiles', '&is_super=eq.true');
    const profiles = [...supers, ...await admProfilesFor(members.map(m => m.user_id), supers)];
    adm.data = { orgs, hostels, profiles, members, stats: stats || [], size: usage ? usage.total : null, usage, files, backups, drive, at: Date.now() };
    Store.orgs = orgs; Store.hostels = hostels;
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
      <div class="grid g4 keep2" style="margin-bottom:14px">${kpi('Active clients', orgs.filter(o => o.status === 'active').length, t('{n} suspended', { n: orgs.filter(o => o.status === 'suspended').length }), 'ok', null, 'building')}${kpi('Monthly revenue', inr(mrr), t('from active clients'), '', null, 'rupee')}${kpi('Renewal due', dueSoon.length, t('in next 5 days'), dueSoon.length ? 'warn' : '', null, 'cal')}${kpi('Database', adm.data.size != null ? adm.data.size + ' MB' : '—', t('of 500 MB free'), adm.data.size > 400 ? 'bad' : '', 'admin-usage', 'chart')}</div>
      <div class="tool">${searchBox('org', 'Search client, owner, city')}${chips('org', [['all', 'All'], ['active', 'Active'], ['suspended', 'Suspended']], 'all')}</div>
      ${list.length ? `<div class="group">${list.map(o => { const hs = hostels.filter(h => h.org_id === o.id); return li({ lead: avatar(o.name), t: o.name, d: `${o.owner_name || ''} · ${o.phone || ''} · ${t('{n} hostels', { n: hs.length })} · ${t('{n} residents', { n: sum(hs, h => +statOf(h.id).residents || 0) })}`, end: `${o.status === 'suspended' ? badge('Suspended', 'bad') : o.paid_till && o.paid_till < today() ? badge('Fee overdue', 'warn') : badge(inr(o.fee) + '/m', 'ok')}`, act: 'go', attrs: `data-to="admin/${o.id}"` }); }).join('')}</div>` : `<div class="card">${empty('No clients yet', 'Add your first PG owner.')}</div>`}`;
  },
};
function orgDetail(id) {
  const o = adm.data.orgs.find(x => x.id === id); if (!o) return `<div class="card">${empty('Client not found')}</div>`;
  const hs = adm.data.hostels.filter(h => h.org_id === id);
  const ms = adm.data.members.filter(m => m.org_id === id), prof = uid_ => adm.data.profiles.find(p => p.id === uid_) || {};
  const mods = o.modules || {};
  return `<div class="row" style="margin:6px 0 10px">${btn('Clients', 'go', 'data-to="admin"', 'ghost sm', 'back')}</div>
    ${head(o.name, `${esc(o.owner_name || '')} · ${esc(o.phone || '')} · ${esc(o.city || '')}`, `${btn('Edit', 'editorg', `data-id="${id}"`, '', 'edit')}${btn(o.status === 'active' ? 'Suspend' : 'Activate', 'orgstatus', `data-id="${id}"`, o.status === 'active' ? 'bad' : 'ok', 'power')}`)}
    <div class="grid g2">
      <div class="stack">
        ${group('Hostels / PGs', hs.map(h => { const s = statOf(h.id); return li({
          icon: 'building', ic: h.status === 'active' ? 'info' : 'mute',
          t: h.name, raw: false,
          d: [h.city, t('{n} residents', { n: s.residents || 0 }), t('{n} records', { n: s.rows || 0 }),
              s.last_activity ? t('active {t}', { t: ago(s.last_activity) }) : ''].filter(Boolean).join(' · '),
          act: 'go', attrs: `data-to="admin-hostel/${h.id}"`,
          end: h.status === 'active' ? '' : badge('Inactive'),
        }); }).join(''), hs.length < o.max_hostels ? `<a href="#" data-act="addhostel" data-org="${id}">+ ${esc(t('Add hostel'))}</a> · ${t('{a} of {b} allowed', { a: hs.length, b: o.max_hostels })}` : t('Hostel limit reached ({n}). Edit the client to raise it.', { n: o.max_hostels }), t('Open a hostel to edit it, set its blocks and modules, and manage the people who log into it.'))}
        ${group('Plan & billing', [li({ icon: 'rupee', ic: 'ok', t: `${inr(o.fee)} / ${t('month')}`, d: `${t(o.plan || 'standard')} · ${t('paid till')} ${o.paid_till ? fmtDate(o.paid_till) : '—'}`, act: 'orgpaid', attrs: `data-id="${id}"`, end: badge('Mark paid', 'acc') }), li({ icon: 'bed', ic: 'info', t: t('Max {n} beds', { n: o.max_beds }), d: t('Max {n} hostels', { n: o.max_hostels }) })].join(''))}
      </div>
      <div class="stack">
        ${group('Modules this client pays for', OPTIONAL_MODULES.map(k => `<div class="li noic"><span class="body"><span class="t">${esc(modLabel(k))}</span>${modNote(k) ? `<span class="d">${esc(modNote(k))}</span>` : ''}</span><label class="sw"><input type="checkbox" data-orgmod="${k}" data-org="${id}" ${mods[k] === false ? '' : 'checked'} aria-label="${esc(modLabel(k))}"><span></span></label></div>`).join(''), t('This is the ceiling for every hostel of this client. To switch a module off in one hostel only, use Modules on that hostel above.'))}
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
    { type: 'section', label: 'Client' }, { name: 'name', label: 'Business name', required: true }, { name: 'city', label: 'City' },
    { name: 'fee', label: 'Monthly fee (₹)', type: 'number', min: 0, value: 499 }, { name: 'max_hostels', label: 'Max hostels', type: 'number', min: 1, value: 3 },
    { type: 'section', label: 'First hostel' }, { name: 'hname', label: 'Hostel / PG name', required: true }, { name: 'haddr', label: 'Address' },
    { type: 'section', label: 'Owner login' }, { name: 'oname', label: 'Owner name', required: true }, { name: 'ophone', label: 'Owner mobile', type: 'tel', required: true },
    { name: 'ouser', label: 'User ID', required: true, pattern: /^[a-z0-9][a-z0-9._-]{2,29}$/,
      info: t('Suggested from the name, and the mobile number is suggested as the password — that is what staff and residents get by default. Change either one here if you would rather set it yourself.') },
    { name: 'opass', label: 'Password', required: true },
    { name: 'mods', label: 'Modules', type: 'multi', options: OPTIONAL_MODULES.map(k => ({ v: k, l: t(k === 'residentApp' ? 'Resident app' : MOD[k].l) })), value: OPTIONAL_MODULES, full: true },
  ],
  onChange: loginFollow2('oname', 'ophone', 'ouser', 'opass'),
  onSubmit: async v => {
    if (String(v.opass).length < 6) return 'Password must be at least 6 characters';
    const modules = Object.fromEntries(OPTIONAL_MODULES.filter(k => !v.mods.includes(k)).map(k => [k, false]));
    const r = await Backend.admin('create_org', { org: { name: v.name, city: v.city, fee: v.fee || 0, max_hostels: v.max_hostels || 1, modules }, hostel: { name: v.hname, city: v.city, address: v.haddr }, owner: { full_name: v.oname, phone: v.ophone, username: v.ouser, password: v.opass } });
    closeModal(); adm.data = null; go('admin/' + r.org.id);
    credsSheet(t('{n} can now log in', { n: v.oname.split(' ')[0] }), v.oname, v.ophone, r.owner.username, r.owner.password,
      r.owner.username !== v.ouser ? t('That user ID was taken, so it was given a number — this is the one that works.') : '');
    return false;
  },
});
A.editorg = el => {
  const o = adm.data.orgs.find(x => x.id === el.dataset.id);
  formModal({ title: 'Edit client', fields: [{ name: 'name', label: 'Business name', value: o.name, required: true }, { name: 'owner_name', label: 'Owner name', value: o.owner_name }, { name: 'phone', label: 'Owner mobile', type: 'tel', value: o.phone }, { name: 'city', label: 'City', value: o.city }, { name: 'plan', label: 'Plan', type: 'select', options: ['trial', 'standard', 'premium'], value: o.plan }, { name: 'fee', label: 'Monthly fee (₹)', type: 'number', min: 0, value: o.fee }, { name: 'paid_till', label: 'Paid till', type: 'date', value: o.paid_till }, { name: 'max_hostels', label: 'Max hostels', type: 'number', min: 1, value: o.max_hostels }, { name: 'max_beds', label: 'Max beds', type: 'number', min: 1, value: o.max_beds }, { name: 'notes', label: 'Notes', type: 'textarea', value: o.notes, full: true }],
    onSubmit: async v => { const patch = { ...v, phone: phone10(v.phone), paid_till: v.paid_till || null }; await Backend.update('orgs', o.id, patch); Object.assign(o, patch); toast('Saved'); } });
};
A.orgstatus = el => { const o = adm.data.orgs.find(x => x.id === el.dataset.id), next = o.status === 'active' ? 'suspended' : 'active'; confirmBox(next === 'suspended' ? t('Suspend {n}? Their staff and residents cannot log in until you activate again. Data is kept.', { n: o.name }) : t('Activate {n}?', { n: o.name }), async () => { await Backend.update('orgs', o.id, { status: next }); o.status = next; toast(next === 'active' ? 'Activated' : 'Suspended'); }, next === 'active' ? 'Activate' : 'Suspend', next === 'active' ? 'ok' : 'bad'); };
A.orgpaid = el => { const o = adm.data.orgs.find(x => x.id === el.dataset.id); formModal({ title: 'Record client payment', fields: [{ name: 'months', label: 'Months paid', type: 'number', min: 1, value: 1 }], onSubmit: async v => { const base = o.paid_till && o.paid_till > today() ? o.paid_till : today(); const d = parse(base); d.setMonth(d.getMonth() + (v.months || 1)); const pt = iso(d); await Backend.update('orgs', o.id, { paid_till: pt }); o.paid_till = pt; toast(t('Paid till {d}', { d: fmtDate(pt) })); } }); };
A.delorg = el => { const o = adm.data.orgs.find(x => x.id === el.dataset.id); formModal({ title: 'Delete client', submit: 'Delete forever', note: t('This deletes {n}, all their hostels and ALL data. It cannot be undone. Download backups first.', { n: o.name }), fields: [{ name: 'confirm', label: 'Type the client name to confirm', required: true }], onSubmit: async v => { if (v.confirm.trim() !== o.name) return 'Name does not match'; await Backend.remove('orgs', o.id); adm.data = null; closeModal(); go('admin'); toast('Client deleted'); return false; } }); };
A.addhostel = el => formModal({ title: 'Add hostel', fields: [{ name: 'name', label: 'Hostel / PG name', required: true }, { name: 'city', label: 'City' }, { name: 'address', label: 'Address', full: true }], onSubmit: async v => { await Backend.insert('hostels', { org_id: el.dataset.org, ...v, status: 'active', settings: {} }); adm.data = null; toast('Hostel added'); } });
// Only the four columns a browser is allowed to PATCH on a hostel. Status is the platform
// admin's and has its own switch on the console, through set_hostel_admin.
A.edithostel = el => { const h = admHostel(el.dataset.id); if (!h) return; formModal({
  title: 'Edit hostel', submit: 'Save',
  fields: [{ name: 'name', label: 'Hostel / PG name', value: h.name, required: true, full: true },
    { name: 'city', label: 'City', value: h.city },
    { name: 'phone', label: 'Phone', type: 'tel', value: h.phone },
    { name: 'address', label: 'Address', value: h.address, full: true }],
  onSubmit: async v => {
    const patch = { name: v.name, city: v.city, phone: phone10(v.phone), address: v.address };
    await Backend.update('hostels', h.id, patch);
    Object.assign(h, patch);
    const live = Store.hostels.find(x => x.id === h.id); if (live) Object.assign(live, patch);
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
      { name: 'username', label: 'User ID', required: true, pattern: /^[a-z0-9][a-z0-9._-]{2,29}$/,
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
 * what to cook from the mess menu, and cleaning tasks are assigned to housekeeping staff.
 */
const MOD_GROUPS = [
  ['Stay & money', ['electricity', 'expenses']],
  ['Daily operations', ['mess', 'kitchen', 'housekeeping', 'laundry', 'attendance', 'gate', 'complaints']],
  ['Team & admin', ['staff', 'notices', 'reports', 'automation']],
  ['Getting new residents', ['landing']],
  ['For residents', ['residentApp']],
];
function modNote(k) {
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
          ['mods', 'Modules', offN ? offN + ' off' : ''], ['users', 'Logins', mine_.own.length]], 'info')}
        ${tab === 'info' ? hostelInfoCard(h, o, st) : ''}
        ${tab === 'blocks' ? blocksCard(h) : ''}
        ${tab === 'mods' ? groups.map(([title, keys]) => group(title, keys.map(row).join(''))).join('')
          + about('Core screens — Home, Approvals, Rooms, Residents, Payments and Settings — are always on. Switching a module off hides it for everyone in this hostel; nothing already recorded is deleted, and switching it back on brings it all back.') : ''}
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
      row('door', 'mute', 'Address', h.address, 'edithostel'),
      row('phone', 'ok', 'Phone', h.phone, 'edithostel'),
      li({ icon: 'power', ic: h.status === 'active' ? 'ok' : 'bad',
        t: t(h.status === 'active' ? 'Active' : 'Inactive'),
        d: t(h.status === 'active' ? 'Staff and residents can log in' : 'Nobody can log into this hostel'),
        chev: false,
        end: `<label class="sw"><input type="checkbox" data-hstatus="${h.id}" ${h.status === 'active' ? 'checked' : ''} aria-label="${esc(t('Active'))}"><span></span></label>` }),
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
    note: t('This deletes the hostel and every record in it — residents, bills, payments, everything. It cannot be undone.'),
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
  return [
    { name: 'full_name', label: 'Full name', required: true },
    { name: 'phone', label: 'Mobile (WhatsApp)', type: 'tel', required: true },
    { name: 'role', label: 'Role', type: 'select', options: ROLE_CHOICES.filter(r => r !== 'resident').map(r => ({ v: r, l: t(ROLES[r].l) })), value: opts.role || 'manager' },
    ...(blocks.length ? [{ name: 'block', label: 'Block', type: 'select', value: '',
      options: [{ v: '', l: t('All blocks') }, ...blocks.map(b => ({ v: b.k, l: b.l }))],
      info: t('Tied to one block, this person sees only that wing of the hostel.') }] : []),
    { name: 'perms', label: 'Extra modules (optional)', type: 'multi', full: true,
      options: MODULES.filter(m => !['home', 'settings'].includes(m.k)).map(m => ({ v: m.k, l: t(m.l) })) },
    { type: 'section', label: 'How they log in' },
    { name: 'username', label: 'User ID', required: true, pattern: /^[a-z0-9][a-z0-9._-]{2,29}$/,
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
  if (changed === nameF && !u.dataset.touched) u.value = slug(v[nameF] || '');
  if (changed === phoneF && !pw.dataset.touched) pw.value = phone10(v[phoneF]) || '';
};
function loginFollow(v, form, changed) {
  const u = form.elements.username, pw = form.elements.password;
  if (changed === 'username') u.dataset.touched = '1';
  if (changed === 'password') pw.dataset.touched = '1';
  if (changed === 'full_name' && !u.dataset.touched) u.value = slug(v.full_name || '');
  if (changed === 'phone' && !pw.dataset.touched) pw.value = phone10(v.phone) || '';
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
  const defaults = (ROLES[m.role] || ROLES.staff).mods;
  closeModal(true);
  formModal({
    title: t('Role and access'), submit: 'Save',
    note: t('Default for {r}: {m}', { r: t(ROLES[m.role] ? ROLES[m.role].l : m.role), m: defaults.map(k => modLabel(k)).join(', ') || '—' }),
    fields: [
      { name: 'role', label: 'Role', type: 'select', options: ROLE_CHOICES.map(r => ({ v: r, l: t(ROLES[r].l) })), value: m.role },
      ...(blocks.length ? [{ name: 'block', label: 'Block', type: 'select', value: m.block || '',
        options: [{ v: '', l: t('All blocks') }, ...blocks.map(b => ({ v: b.k, l: b.l }))] }] : []),
      { name: 'perms', label: 'Also allow', type: 'multi', full: true, value: m.perms || [],
        options: MODULES.filter(x => !['home', 'settings'].includes(x.k)).map(x => ({ v: x.k, l: t(x.l) })) },
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

PAGES['admin-users'] = {
  title: 'All users', ...superOnly,
  render() {
    if (!adm.data) return admWait('All users');
    if (adm.data.error) return admErr();
    const { profiles, members, orgs } = adm.data;
    const f = curFlt('au', 'staff');
    if (f !== 'staff' && !adm.res.started) admResidents();
    const list = profiles.filter(p => { const ms = members.filter(m => m.user_id === p.id); const isRes = ms.length && ms.every(m => m.role === 'resident'); return (f === 'all' || (f === 'res' ? isRes : !isRes)) && needle('au', p.full_name, p.username, p.phone); });
    return `${head('All users', t('{n} logins', { n: profiles.length }))}<div class="tool">${searchBox('au', 'Search name, user ID, mobile')}${chips('au', [['staff', 'Owners & staff'], ['res', 'Residents'], ['all', 'All']], 'staff')}</div>
      ${group('', list.slice(0, ui.lim.au || 80).map(p => { const ms = members.filter(m => m.user_id === p.id); return li({ lead: avatar(p.full_name), t: `${p.full_name} · @${p.username}`, d: `${p.is_super ? t('Super admin') : ms.map(m => `${t(ROLES[m.role] ? ROLES[m.role].l : m.role)} @ ${(orgs.find(o => o.id === m.org_id) || {}).name || '?'}`).join(', ') || t('No access')}${p.active === false ? ' · ' + t('Disabled') : ''}`, act: 'admuser', attrs: `data-id="${p.id}"` }); }).join(''))}
      ${list.length > (ui.lim.au || 80) ? `<div style="text-align:center;margin-top:12px">${btn('Show more', 'more', 'data-key="au" data-per="80"', 'sm')}</div>` : ''}
      ${f !== 'staff' && !adm.res.done ? `<div style="text-align:center;margin-top:12px">${adm.res.loading ? '<div class="spin"></div>' : btn('Load more resident logins', 'admresmore', '', 'sm')}</div>` : ''}`;
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

PAGES['admin-usage'] = {
  title: 'Usage & health', ...superOnly,
  render() {
    if (!adm.data) return admWait('Usage & health');
    if (adm.data.error) return admErr();
    const { hostels, orgs, size } = adm.data, rows = sum(adm.data.stats, s => +s.rows || 0);
    return `${head('Usage & health', t('Free tier: Supabase 500 MB database · Vercel 100 GB bandwidth.'), btn('', 'admreload', `aria-label="${esc(t('Refresh'))}"`, '', 'sync'))}
      <div class="grid g3 keep2" style="margin-bottom:14px">${kpi('Database size', size != null ? size + ' MB' : '—', `${pct(size || 0, 500)}% ${t('of free limit')}`, size > 400 ? 'bad' : 'ok', null, 'chart')}${kpi('Records', rows.toLocaleString('en-IN'), t('across {n} hostels', { n: hostels.length }), '', null, 'layers')}${kpi('Avg per hostel', hostels.length ? Math.round(rows / hostels.length).toLocaleString('en-IN') : 0, t('≈ 1 KB each'), '', null, 'building')}</div>
      <div class="bar ${size > 400 ? 'bad' : 'ok'}" style="margin-bottom:8px"><i style="width:${Math.min(100, pct(size || 0, 500))}%"></i></div>
      ${adm.data.usage && adm.data.usage.data != null ? `<p class="hint" style="margin-bottom:14px">${esc(t('Your clients’ data: {a} MB. The other {b} MB is Supabase’s own tables (logins, storage, migrations) — they are there from day one and do not grow with the business.', { a: adm.data.usage.data, b: Math.max(0, Math.round((adm.data.usage.total - adm.data.usage.data) * 10) / 10) }))}</p>` : '<div style="margin-bottom:14px"></div>'}
      ${table([{ h: 'Hostel', f: h => `<b>${esc(h.name)}</b><div class="hint">${esc((orgs.find(o => o.id === h.org_id) || {}).name || '')}</div>` }, { h: 'Residents', f: h => statOf(h.id).residents || 0 }, { h: 'Records', f: h => (+statOf(h.id).rows || 0).toLocaleString('en-IN') }, { h: 'Last activity', f: h => (statOf(h.id).last_activity ? ago(statOf(h.id).last_activity) : '—') }, { h: '', acts: true, f: h => btn('Open', 'openhostel', `data-id="${h.id}"`, 'sm') }], hostels.slice().sort((a, b) => (+statOf(b.id).rows || 0) - (+statOf(a.id).rows || 0)), { key: 'usage' })}
      ${filesCard(adm.data.files)}
      ${backupCard(adm.data.backups, adm.data.drive)}
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
// Back from Google: /?drive=connected#/admin-usage
(() => { try { const q = new URLSearchParams(location.search), d = q.get('drive'); if (!d) return; history.replaceState(null, '', location.pathname + location.hash); setTimeout(() => toast(d === 'connected' ? t('Google Drive connected') : d === 'cancelled' ? t('Google Drive was not connected') : d, d === 'connected' ? 'ok' : 'bad'), 600); } catch (e) { /* ignore */ } })();
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
