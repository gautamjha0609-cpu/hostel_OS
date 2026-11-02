'use strict';
/* Sarvlekh shell: login, profile switching, navigation, routing and global events. */

const ui = { page: 'home', arg: '', tab: {}, q: {}, flt: {}, lim: {}, waq: null };
const PAGES = {};   // k → { title, render(arg), mods? }
const A = {};       // data-act handlers: A[name](el, event)

/* ===================================================================== contexts */
function contexts() {
  const list = [];
  if (!Store.me) return list;
  if (Store.me.is_super) list.push({ key: 'super', role: 'super', hostelId: null, label: t('Super admin') });
  for (const m of Store.members) {
    const hs = Store.hostels.filter(h => h.org_id === m.org_id && (!m.hostel_id || m.hostel_id === h.id) && h.status !== 'inactive');
    for (const h of hs) list.push({ key: `${m.id}:${h.id}`, role: m.role, hostelId: h.id, orgId: m.org_id, perms: m.perms || [], deny: m.deny || [], refId: m.ref_id, block: m.block || '', label: `${h.name} · ${t(ROLES[m.role] ? ROLES[m.role].l : m.role)}` });
  }
  return list;
}
const ctxKey = () => `hostelos.ctx.${Backend.uid()}`;
async function chooseContext(key) {
  const all = contexts();
  let c = all.find(x => x.key === key) || all.find(x => x.key === LS.get(ctxKey())) || all[0];
  if (key && key.startsWith('super:')) { const hid = key.slice(6); c = { key, role: 'super', hostelId: hid, orgId: (Store.hostels.find(h => h.id === hid) || {}).org_id, perms: [], deny: [], label: `${(Store.hostels.find(h => h.id === hid) || {}).name} · ${t('Super admin')}` }; }
  if (!c) { renderNoAccess(); return; }
  LS.set(ctxKey(), c.key);
  setBlockScope(c.hostelId ? LS.get(blockKey(c.hostelId), '') : '');
  $('#app').innerHTML = `<div class="loader"><div class="spin"></div></div>`;
  try { await Store.open(c); }
  catch (e) { toast(e.message, 'bad'); }
  if (c.hostelId) { try { const n = runAutomation(); if (n) toast(t('Automation: {n} tasks done', { n })); } catch (e) { console.error(e); } }
  buildShell();
  // Opening a link to a page (/settings/site, or after logging in from it) shows that page; no page in the link,
  // or choosing another profile, starts at the home page.
  const wanted = location.pathname.replace(/^\/+|\/+$/g, '').replace(/^index\.html$/, '');
  if (!key && wanted) route(); else go(homeFor());
}
function homeFor() {
  const c = ctx();
  if (c.role === 'super' && !c.hostelId) return 'admin';
  if (c.role === 'resident') return 'r-home';
  if (isAdmin() || can('home')) return 'home';
  return myMods()[0] || 'me';
}

/* ===================================================================== shell */
function navGroups() {
  const c = ctx();
  if (c.role === 'super' && !c.hostelId) return [['', [['admin', 'Clients & hostels', 'building'], ['admin-users', 'All users', 'users'], ['admin-usage', 'Usage & health', 'chart']]]];
  if (c.role === 'resident') return [['', [['r-home', 'Home', 'home'], ['r-meals', 'Meals', 'utensils'], ['r-clean', 'Room cleaning', 'broom'], ['r-laundry', 'Laundry', 'shirt'], ['r-help', 'Help & notices', 'chat'], ['me', 'Profile', 'user']].filter(x => x[0] !== 'r-laundry' || orgEnabled('laundry')).filter(x => x[0] !== 'r-clean' || orgEnabled('housekeeping')).filter(x => x[0] !== 'r-meals' || orgEnabled('mess'))]];
  const sec = (title, keys) => [title, keys.filter(k => can(k)).map(k => [k, MOD[k].l, MOD[k].icon])];
  return [
    sec('', ['home', 'inbox']),
    sec('Stay & money', ['rooms', 'residents', 'payments', 'electricity', 'expenses']),
    sec('Daily operations', ['mess', 'kitchen', 'housekeeping', 'laundry', 'attendance', 'gate', 'complaints']),
    sec('Team & admin', ['staff', 'notices', 'reports', 'automation', 'settings']),
  ].filter(g => g[1].length);
}
function bottomNav() {
  const c = ctx();
  if (c.role === 'resident') return navGroups()[0][1].filter(x => ['r-home', 'r-meals', 'r-clean', 'r-laundry', 'me'].includes(x[0])).slice(0, 5);
  if (c.role === 'super' && !c.hostelId) return [['admin', 'Clients', 'building'], ['admin-users', 'Users', 'users'], ['admin-usage', 'Usage', 'chart'], ['me', 'Profile', 'user']];
  const flat = navGroups().flatMap(g => g[1]);
  const pref = isAdmin() ? ['home', 'residents', 'payments', 'inbox'] : flat.map(x => x[0]);
  const main = pref.map(k => flat.find(x => x[0] === k)).filter(Boolean).slice(0, 4);
  return [...main, flat.length > main.length ? ['more', 'More', 'grid'] : ['me', 'Profile', 'user']];
}
function badgeFor(k) {
  if (k === 'inbox') return inboxItems().length;
  if (k === 'complaints') return Store.all('cmp').filter(c => c.status === 'open').length;
  if (k === 'housekeeping' && !isAdmin()) return hkTasks().filter(x => x.date === today() && x.staffId === ctx().refId && x.status === 'pending').length;
  return 0;
}
/* One scope control for the whole app.
 * The alternative — a block filter on Rooms, another on Residents, another on Payments — is
 * what makes software feel like paperwork. Here the owner says "Block B" once and every screen
 * underneath is Block B until they say otherwise. It only appears when the hostel actually has
 * blocks, so a single-building PG never sees it at all.
 *
 * It is a bar of its own under the header rather than a second dropdown beside the hostel
 * switcher, for two reasons. On a phone the header has no room left — a second pill squeezed
 * the hostel name down to nothing. And because this scope silently changes every number on
 * the screen, it should be read at a glance, not found inside a closed menu.
 *
 * A login tied to one block gets a label instead of a switch: there is nothing to choose. */
const blockKey = hid => `hostelos.block.${hid}`;
function blockBar() {
  const bar = $('#bbar'); if (!bar) return;
  const c = ctx();
  // A resident lives in one room; there is no wing for them to choose between.
  if (!c.hostelId || !blocksOn() || isResident()) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  if (c.block) {
    bar.innerHTML = `<span class="blabel">${ico('layers', 'sm')}${esc(blockName(c.block))}</span><span class="bhint">${esc(t('You see this block only'))}</span>`;
    return;
  }
  const cur = blockScope();
  const opts = [['', t('All blocks')], ...hostelBlocks().map(b => [b.k, b.l])];
  if (allRooms().some(r => !roomBlock(r))) opts.push(['-', t('Not in a block')]);
  bar.innerHTML = `<span class="blabel">${ico('layers', 'sm')}</span><div class="chips">${opts.map(([v, l]) =>
    `<button class="chip ${v === cur ? 'on' : ''}" data-act="blk" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
}
A.blk = el => {
  const v = el.dataset.v || '';
  if (v === blockScope()) return;
  setBlockScope(v);
  LS.set(blockKey(ctx().hostelId), v);
  render(true);
};
function buildShell() {
  const c = ctx(), h = Store.hostel(), cs = contexts(), solo = false;
  const opts = cs.map(x => `<option value="${esc(x.key)}" ${x.key === c.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
  $('#app').innerHTML = `<div class="app ${solo ? 'solo' : ''}">
    <aside class="side" id="side" aria-label="${esc(t('Main menu'))}">
      <div class="brand"><img src="/icons/icon.svg" alt=""><div style="min-width:0">${esc(CFG.APP_NAME || 'Sarvlekh')}<small>${esc(h ? h.name : t('Platform'))}${h && h.settings && h.settings.demo ? ' <b style="color:var(--warn)">· DEMO</b>' : ''}</small></div></div>
      <nav class="nav" id="nav"></nav>
      <div class="side-foot"><div id="installSlot"></div>${li({ icon: 'user', ic: 'mute', t: Store.me.full_name, d: t(ROLES[c.role] ? ROLES[c.role].l : ''), act: 'go', attrs: 'data-to="me"' })}</div>
    </aside>
    <div class="scrim" data-act="drawer"></div>
    <div class="main">
      <div class="offline" id="offline" ${Store.online ? 'hidden' : ''}>${esc(t('Offline — changes are saved and will sync'))}</div>
      <header class="top ${cs.length > 1 || (c.key && c.key.startsWith('super:')) ? 'sel' : ''}" id="top">
        <button class="ibtn menu-btn" data-act="drawer" aria-label="${esc(t('Menu'))}">${ico('menu')}</button>
        <h1 id="ptitle"></h1><span class="sp"></span>
        ${cs.length > 1 || c.key && c.key.startsWith('super:') ? `<select class="hsel" id="ctxSel" aria-label="${esc(t('Switch hostel'))}">${opts}${c.key && c.key.startsWith('super:') ? `<option selected>${esc(c.label)}</option>` : ''}</select>` : ''}
        ${c.hostelId ? `<button class="ibtn hide-s" data-act="palette" aria-label="${esc(t('Search'))}" title="Ctrl+K">${ico('search', 'sm')}</button>` : ''}
        <button class="ibtn" data-act="theme" aria-label="${esc(t('Appearance'))}" title="${esc(themeLabel())}">${ico(themeIcon(), 'sm')}</button>
        <button class="ibtn" data-act="lang" aria-label="${esc(t('Language'))}" style="font-weight:700;font-size:13px">${LANG === 'hi' ? 'EN' : 'हि'}</button>
        ${c.hostelId ? `<button class="ibtn" data-act="notifs">${ico('bell', 'sm')}<span class="sr">${esc(t('Notifications'))}</span><span class="dot" id="ndot" hidden></span></button>` : ''}
      </header>
      <div class="bbar" id="bbar" hidden></div>
      <main class="page" id="page" tabindex="-1"></main>
    </div>
    <nav class="bnav" id="bnav" aria-label="${esc(t('Quick menu'))}"></nav>
  </div>`;
  const sel = $('#ctxSel'); if (sel) sel.onchange = () => chooseContext(sel.value);
  Picker.enhance($('#top'));
  updateChrome();
}
function updateChrome() {
  const nav = $('#nav'); if (!nav) return;
  nav.innerHTML = navGroups().map(([title, list]) => `${title ? `<div class="nav-sec">${esc(t(title))}</div>` : ''}${list.map(([k, l, icn]) => { const n = badgeFor(k); return `<a href="/${k}" class="${ui.page === k ? 'on' : ''}" data-act="nav">${ico(icn, 'sm')}<span>${esc(t(l))}</span>${n ? `<span class="cnt">${n}</span>` : ''}</a>`; }).join('')}`).join('');
  $('#bnav').innerHTML = bottomNav().map(([k, l, icn]) => { const n = badgeFor(k); return `<button class="${ui.page === k ? 'on' : ''}" data-act="${k === 'more' ? 'drawer' : 'go'}" data-to="${k}">${ico(icn)}<span>${esc(t(l))}</span>${n ? `<span class="dot">${n}</span>` : ''}</button>`; }).join('');
  blockBar();
  const slot = $('#installSlot'); if (slot && typeof Pwa !== 'undefined') slot.innerHTML = Pwa.button();
  const nd = $('#ndot'); if (nd) { const n = myNotifs().filter(x => !x.read).length; nd.hidden = !n; nd.textContent = n > 9 ? '9+' : n; }
  const off = $('#offline'); if (off) off.hidden = Store.online;
}

/* ===================================================================== routing */
// Clean addresses (/home, /settings/site), not /#/home. Vercel serves index.html for any path without a dot (vercel.json).
function go(to) { const p = '/' + String(to).replace(/^\/+/, ''); if (location.pathname !== p) history.pushState(null, '', p); route(); }
function route() {
  const raw = location.pathname.replace(/^\/+|\/+$/g, '').replace(/^index\.html$/, '');
  if (!Store.me) { if (raw === 'setup' && CLOUD) renderSetup(); else renderLogin(); return; }
  if (!Store.ctx) return;
  const [page, arg = ''] = raw.split('/');
  const p = PAGES[page];
  const allowed = p && (!p.mod || can(p.mod)) && (!p.when || p.when());
  ui.page = allowed ? page : homeFor(); ui.arg = allowed ? decodeURIComponent(arg) : '';
  if (!allowed && page && page !== ui.page) { history.replaceState(null, '', '/' + ui.page); }
  document.body.classList.remove('drawer');
  render(true);
}
function render(scrollTop) {
  const el = $('#page'); if (!el || !Store.ctx) return;
  const p = PAGES[ui.page]; if (!p) return;
  const active = document.activeElement, qkey = active && active.dataset && active.dataset.q, caret = qkey ? active.selectionStart : 0;
  try { el.innerHTML = p.render(ui.arg); }
  catch (e) { console.error(e); el.innerHTML = `<div class="card">${empty('Something went wrong on this screen', e.message, btn('Go home', 'go', `data-to="${homeFor()}"`))}</div>`; }
  $('#ptitle').textContent = t(typeof p.title === 'function' ? p.title() : p.title);
  document.title = `${t(typeof p.title === 'function' ? p.title() : p.title)} · ${CFG.APP_NAME || 'Sarvlekh'}`;
  Picker.enhance(el);
  if (qkey) { const q = $(`[data-q="${qkey}"]`); if (q) { q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) { /* type=search */ } } }
  if (scrollTop) window.scrollTo(0, 0);
  updateChrome();
  setTimeout(attPrompt, 350);
}

/* ===================================================================== self attendance
 * Until today's punch-in is done, a staff member is asked first — when the app opens and when
 * they move to a work screen — at most once every 10 minutes. "Later" always closes it. */
let attAskedAt = 0;
function attPrompt() {
  const sid = myStaffId();
  if (!sid || !selfPunchOn() || punchedToday(sid)) return;
  if ($('#modalRoot') && $('#modalRoot').innerHTML) return;
  if (Date.now() - attAskedAt < 10 * 60e3) return;
  attAskedAt = Date.now();
  const fence = attFence();
  openModal({
    title: 'Mark your attendance',
    body: `<div style="text-align:center"><div style="font-size:44px">🕘</div>
      <p style="font-size:16px;margin:6px 0">${esc(t('Hi {n}, mark today\'s attendance before you start work.', { n: (staffById(sid) || {}).name || '' }))}</p>
      ${fence ? `<p class="hint">${esc(t('Your location is checked — you must be within {r} m of the hostel.', { r: fence.radius }))}</p>` : ''}
      <p class="ferr" id="punchmsg" role="alert"></p></div>`,
    foot: `<button class="btn" data-act="close">${esc(t('Later'))}</button><button class="btn primary" data-act="punchin">${ico('check', 'sm')}<span>${esc(t('Punch in'))}</span></button>`,
  });
}
A.punchin = async el => {
  const sid = myStaffId(), msg = $('#punchmsg'); if (!sid) return;
  el.disabled = true; if (msg) msg.textContent = t('Finding your location…');
  let pos = null;
  try { pos = await Geo.here(); } catch (e) { if (attFence()) { if (msg) msg.textContent = t(e.message); el.disabled = false; return; } }
  try { punchIn(sid, pos); closeModal(); haptic(); toast(t('Attendance marked ✓')); render(); }
  catch (e) { if (msg) msg.textContent = t(e.message); el.disabled = false; }
};

/* ===================================================================== login & setup */
function renderLogin(err) {
  document.title = `${t('Log in')} · ${CFG.APP_NAME || 'Sarvlekh'}`;
  // The brand mark is part of the background picture (phone and desktop each have their own);
  // this is only the sign-in panel: under the mark on a phone, to its right on a desktop.
  const EYE = '<svg class="i eye-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="i eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  $('#app').innerHTML = `<div class="auth login"><div class="box">
    <form id="loginForm" class="lcard" novalidate>
      <h1>${esc(t('Log in'))}</h1><p class="sub">${esc(t('Hostel & PG management, simple and fast'))}</p>
      <label class="lf"><span class="lic">${ico('user')}</span><input name="u" placeholder="${esc(t('User ID'))}" autocomplete="username" autocapitalize="none" required></label>
      <label class="lf"><span class="lic">${ico('lock')}</span><input name="p" type="password" placeholder="${esc(t('Password'))}" autocomplete="current-password" required>
        <button type="button" class="eye" data-act="pwtoggle" aria-label="${esc(t('Show password'))}">${EYE}</button>
        ${typeof Mascot !== 'undefined' ? `<div class="eleph" id="spy" aria-hidden="true">${Mascot.svg()}</div>` : ''}</label>
      <div class="caps" id="caps" role="status">${esc(t('Caps Lock is on.'))}</div>
      <div class="ferr" id="lerr">${esc(err || '')}</div>
      <button class="lbtn" type="submit">${esc(t('Log in'))}</button>
      <div class="llang"><button type="button" class="btn ghost sm" data-act="lang">${LANG === 'hi' ? 'English' : 'हिन्दी'}</button></div>
    </form>
    ${CLOUD ? '' : `<div class="demo">${group('Demo logins — tap to try', [['ramesh.sharma', '9876500001', 'Owner (2 PGs)', 'building'], ['aman.gupta', '9812300001', 'Resident', 'user'], ['raju.cook', '9876500003', 'Cook', 'utensils'], ['sunita.hk', '9876500004', 'Housekeeping', 'broom'], ['mohan.laundry', '9876500005', 'Laundry', 'shirt'], ['gate.guard', '9876500006', 'Security guard', 'shield'], ['admin', 'admin123', 'Super admin', 'key']].map(([u, p, l, i]) => li({ icon: i, t: t(l), d: `${u} / ${p}`, act: 'demologin', attrs: `data-u="${u}" data-p="${p}"` })).join(''), t('Demo mode: data stays in this browser. Add Supabase keys in js/config.js to go live.'))}</div>`}
  </div></div>`;
  if (typeof Mascot !== 'undefined') Mascot.mount($('#loginForm'), !!err);
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, u = f.u.value.trim(), p = f.p.value;
    if (!u || !p) { $('#lerr').textContent = t('Enter user ID and password'); return; }
    await doLogin(u, p);
  };
}
async function doLogin(u, p) {
  const b = $('#loginForm button[type=submit]'); if (b) { b.disabled = true; b.innerHTML = '<span class="spin" style="width:18px;height:18px;border-width:2px"></span>'; }
  try { await Backend.login(u, p); await afterLogin(); }
  catch (e) { renderLogin(t(e.message)); }
}
async function afterLogin() {
  try { await Store.loadMeta(); }
  catch (e) { if (e.status === 401) { await Backend.logout(); renderLogin(); return; } $('#app').innerHTML = `<div class="auth"><div class="box card">${empty('Could not load your account', t(e.message), btn('Try again', 'reload'))}</div></div>`; return; }
  if (Store.me.is_super) await loadScript('/js/ui-admin.js').catch(e => console.error(e));
  if (!contexts().length) { renderNoAccess(); return; }
  if (Store.me.must_change) toast('Please change your password from Profile', 'ok');
  await chooseContext();
}
function renderNoAccess() {
  $('#app').innerHTML = `<div class="auth"><div class="box card">${empty('No hostel linked to this login', 'Ask your PG owner or the platform admin to give you access.', btn('Log out', 'logout'))}</div></div>`;
}
function renderSetup() {
  $('#app').innerHTML = `<div class="auth"><div class="box"><img class="logo" src="/icons/icon.svg" alt=""><h1>${esc(t('First-time setup'))}</h1><p class="sub">${esc(t('Create the super admin account (needs SETUP_KEY from Vercel).'))}</p><div class="card"><form id="setupForm" class="stack" novalidate>
    ${fieldHtml({ name: 'key', label: 'Setup key', type: 'password' })}${fieldHtml({ name: 'full_name', label: 'Your name' })}${fieldHtml({ name: 'username', label: 'User ID', value: 'admin' })}${fieldHtml({ name: 'password', label: 'Password (min 8)', type: 'password' })}
    <div class="ferr" id="serr"></div><button class="btn primary block">${esc(t('Create super admin'))}</button></form></div></div></div>`;
  $('#setupForm').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    if (f.password.value.length < 8) { $('#serr').textContent = t('Password must be at least 8 characters'); return; }
    try { const u = await Backend.admin('setup', { key: f.key.value, full_name: f.full_name.value || 'Admin', username: f.username.value, password: f.password.value }); await Backend.login(u.username, f.password.value); history.replaceState(null, '', '/'); await afterLogin(); }
    catch (err) { $('#serr').textContent = t(err.message); }
  };
}

/* ===================================================================== profile (every role) */
PAGES.me = {
  title: 'Profile',
  render() {
    const c = ctx(), cs = contexts(), dark = document.documentElement.dataset.theme;
    return `<div class="narrow">${head('Profile')}
      <div class="card row nw" style="gap:14px">${avatar(Store.me.full_name)}<div class="body" style="min-width:0"><b style="font-size:18px">${esc(Store.me.full_name)}</b><div class="muted sm">@${esc(Store.me.username)} · ${esc(t(ROLES[c.role] ? ROLES[c.role].l : ''))}</div></div></div>
      ${cs.length > 1 ? group('My profiles', cs.map(x => li({ icon: x.role === 'resident' ? 'user' : x.role === 'super' ? 'key' : 'building', ic: x.key === c.key ? 'ok' : 'mute', t: x.label, end: x.key === c.key ? badge('Current', 'ok') : '', act: x.key === c.key ? '' : 'ctx', attrs: `data-key="${esc(x.key)}"` })).join(''), t('You can use one login for several hostels or roles.')) : ''}
      ${group('Preferences', [
        li({ icon: 'globe', ic: 'info', t: t('Language'), end: LANG === 'hi' ? 'हिन्दी' : 'English', act: 'lang' }),
        li({ icon: dark === 'dark' ? 'moon' : 'sun', ic: 'mute', t: t('Appearance'), end: t(dark === 'dark' ? 'Dark' : dark === 'light' ? 'Light' : 'Automatic'), act: 'theme' }),
        li({ icon: 'download', ic: 'teal', t: t('Install app on this phone'), d: t('Add to home screen for one-tap access'), act: 'install' }),
      ].join(''))}
      ${group('Security', [li({ icon: 'lock', ic: 'warn', t: t('Change password'), act: 'chpw' }), li({ icon: 'sync', ic: 'ok', t: t('Sync now'), d: Store.lastSync ? t('Last synced {t}', { t: ago(Store.lastSync) }) : '', act: 'syncnow' })].join(''))}
      <div style="margin-top:22px">${btn('Log out', 'logout', '', 'bad block', 'logout')}</div>
      <p class="hint" style="text-align:center;margin-top:14px">${esc(CFG.APP_NAME || 'Sarvlekh')} · ${CLOUD ? t('Cloud') : t('Demo mode')}</p></div>`;
  },
};
A.ctx = el => chooseContext(el.dataset.key);
A.chpw = () => formModal({
  title: 'Change password', submit: 'Update password',
  fields: [{ name: 'p1', label: 'New password', type: 'password', required: true, hint: t('At least 6 characters') }, { name: 'p2', label: 'Repeat new password', type: 'password', required: true }],
  onSubmit: async v => { if (v.p1.length < 6) return 'Password must be at least 6 characters'; if (v.p1 !== v.p2) return 'Passwords do not match'; await Backend.changePassword(v.p1); toast('Password changed'); },
});
A.logout = () => confirmBox(t('Log out from this device?'), async () => { await Store.logout(); history.replaceState(null, '', '/'); renderLogin(); }, 'Log out', 'bad');
A.syncnow = async () => { try { await Store.sync(); await Store.refreshMeta(); toast('Synced'); } catch (e) { toast(e.message, 'bad'); } render(); };
A.reload = () => location.reload();
// The page's Content-Security-Policy (vercel.json: script-src 'self') refuses inline handlers
// such as onclick="…", so month pickers, day strips and date boxes are wired with data attributes:
// an input or select with data-flt="key" stores its value in ui.flt[key]; a button with
// data-act="setflt" data-k="key" data-v="value" does the same when tapped. Both then redraw.
A.setflt = el => { ui.flt[el.dataset.k] = el.dataset.v; render(); };
document.addEventListener('change', e => { const el = e.target; if (el && el.dataset && el.dataset.flt) { ui.flt[el.dataset.flt] = el.value; render(); } });
A.pwtoggle = el => {
  const i = el.closest('.lf').querySelector('input'), on = i.type === 'password';
  i.type = on ? 'text' : 'password'; el.classList.toggle('on', on); el.setAttribute('aria-label', t(on ? 'Hide password' : 'Show password'));
  if (typeof Mascot !== 'undefined') Mascot.sync();
};
A.demologin = el => doLogin(el.dataset.u, el.dataset.p);
// Installing as an app: js/pwa.js works out what this browser can do. The menu button, the profile row and
// the two-minute pop-up all end up here.
A.install = () => Pwa.open(true);
A.pwainstall = () => Pwa.prompt();
A.pwalater = () => Pwa.snooze(7);
A.pwanever = () => Pwa.snooze(365);

/* ===================================================================== notifications & palette */
A.notifs = () => {
  const list = myNotifs().slice(0, 60);
  sheet('Notifications', list.length ? `<div class="group">${list.map(n => li({ icon: 'bell', ic: n.read ? 'mute' : '', t: n.title, d: `${n.body ? n.body + ' · ' : ''}${ago(n.ts)}`, act: n.link ? 'ntfgo' : '', attrs: `data-id="${n.id}" data-to="${esc(n.link || '')}"` })).join('')}</div>` : empty('No notifications', 'You are all caught up.'),
    { foot: list.some(n => !n.read) ? `<button class="btn block" data-act="ntfread">${esc(t('Mark all as read'))}</button>` : '' });
};
A.ntfread = () => { myNotifs().filter(n => !n.read).forEach(n => Store.patch(n.id, { read: true })); closeModal(); updateChrome(); };
A.ntfgo = el => { Store.patch(el.dataset.id, { read: true }); closeModal(); go(el.dataset.to); };
A.palette = () => {
  openModal({ title: 'Search', cls: 'pal', body: `<input id="palq" placeholder="${esc(t('Search residents, rooms, pages…'))}" autocomplete="off"><div id="palr" class="group" style="margin-top:8px"></div>` });
  const q = $('#palq'), out = $('#palr');
  const draw = () => {
    const s = q.value.toLowerCase().trim();
    const pages = navGroups().flatMap(g => g[1]).filter(([k, l]) => !s || t(l).toLowerCase().includes(s)).slice(0, 6).map(([k, l, i]) => li({ icon: i, t: t(l), act: 'go', attrs: `data-to="${k}"` }));
    const res = s && can('residents') ? residents().filter(r => `${r.name} ${r.phone} ${roomName(r.roomId)}`.toLowerCase().includes(s)).slice(0, 8).map(r => li({ lead: avatar(r.name), t: r.name, d: `${roomName(r.roomId)} · ${r.phone} · ${t(r.status)}`, act: 'go', attrs: `data-to="residents/${r.id}"` })) : [];
    out.innerHTML = [...res, ...pages].join('') || `<div class="li noic muted">${esc(t('No results'))}</div>`;
  };
  q.oninput = draw; draw(); setTimeout(() => q.focus(), 50);
};

/* ===================================================================== global events */
A.go = el => { closeModal(true); go(el.dataset.to); };
A.nav = (el, e) => { e.preventDefault(); go(el.getAttribute('href').slice(1)); };
A.drawer = () => document.body.classList.toggle('drawer');
A.close = () => { ui.waq = null; closeModal(); };
A.mback = (el, e) => { if (e.target === el) { ui.waq = null; closeModal(); } };
A.msubmit = () => modalSubmit && modalSubmit();
A.mdanger = () => modalDanger && modalDanger();
A.tab = el => { ui.tab[el.dataset.key] = el.dataset.tab; render(); };
A.flt = el => { ui.flt[el.dataset.key] = el.dataset.v; render(); };
A.more = el => { ui.lim[el.dataset.key] = (ui.lim[el.dataset.key] || +el.dataset.per) + +el.dataset.per; render(); };
A.lang = async () => { setLang(LANG === 'hi' ? 'en' : 'hi'); LS.set('hostelos.lang.local', 1); await ensureLang().catch(() => {}); if (Store.me && CLOUD) Cloud.rest(`profiles?id=eq.${Store.me.id}`, { method: 'PATCH', body: { lang: LANG }, headers: { Prefer: 'return=minimal' } }).catch(() => {}); if (Store.ctx) { buildShell(); render(); } else route(); };
// Light (default) → Dark → Automatic → Light. "Automatic" follows the phone's own setting.
const themeNow = () => document.documentElement.dataset.theme || '';
function themeIcon() { const v = themeNow(); return v === 'dark' ? 'moon' : v === 'light' ? 'sun' : 'contrast'; }
function themeLabel() { const v = themeNow(); return t(v === 'dark' ? 'Dark' : v === 'light' ? 'Light' : 'Automatic'); }
A.theme = () => {
  const nx = { light: 'dark', dark: 'auto', '': 'light' }[themeNow()];
  setTheme(nx);
  toast(t('Appearance: {m}', { m: themeLabel() }));
  if (Store.ctx) buildShell();
  render();
};
A.waskip = () => { ui.waq.i++; renderWaQueue(); };
A.wanext = () => {
  const q = ui.waq, m = q && q.list[q.i];
  if (m && m.x) markReminded([m.x]);   // a reminder counts as sent once its WhatsApp opens
  setTimeout(() => { if (ui.waq) { ui.waq.i++; renderWaQueue(); } }, 400);
};
A.print = () => { document.body.classList.add('printing'); window.print(); setTimeout(() => document.body.classList.remove('printing'), 500); };
function setTheme(v) {
  v = v || 'light';
  if (v !== 'auto') document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
  LS.set('hostelos.theme', v);
  const dark = v === 'dark' || (v === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name=theme-color]').setAttribute('content', dark ? '#000000' : '#f2f2f7');
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = A[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'A' && el.dataset.act !== 'nav' && el.getAttribute('href') && !el.getAttribute('href').startsWith('#')) { fn(el, e); return; }
  if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
  try { const r = fn(el, e); if (r && r.catch) r.catch(err => { console.error(err); toast(err.message || 'Something went wrong', 'bad'); }); }
  catch (err) { console.error(err); toast(err.message || 'Something went wrong', 'bad'); }
});
// "i" buttons: one small bubble at a time, always opened below the button, closed by any other tap.
let tipEl = null;
const tipClose = () => {
  if (!tipEl) return;
  if (tipEl._src) tipEl._src.setAttribute('aria-expanded', 'false');
  tipEl.remove(); tipEl = null;
};
A.tip = el => {
  const was = tipEl && tipEl._src === el; tipClose(); if (was) return;
  const tx = el.parentNode.querySelector('.ib-tx'); if (!tx) return;
  tipEl = document.createElement('div');
  tipEl.className = 'tip-pop';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.innerHTML = tx.innerHTML;
  tipEl._src = el;
  document.body.appendChild(tipEl);
  el.setAttribute('aria-expanded', 'true');

  const r = el.getBoundingClientRect(), gap = 9, edge = 12;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  // Prefer above once the button is in the lower part of the screen, not merely when the
  // panel would leave the viewport: a sheet keeps its Cancel / Save row pinned to the bottom,
  // so "it still fits on screen" was exactly how it ended up covering those buttons.
  const roomBelow = window.innerHeight - r.bottom - gap - edge;
  const roomAbove = r.top - gap - edge;
  const low = r.top > window.innerHeight * 0.55;
  const below = !((low || roomBelow < h) && roomAbove >= h);
  tipEl.classList.add(below ? 'below' : 'above');
  // Clamped at both ends: a button that has been scrolled half out of view must not take the
  // panel off the screen with it.
  const top = below ? r.bottom + gap : r.top - h - gap;
  tipEl.style.top = Math.min(Math.max(edge, top), Math.max(edge, window.innerHeight - h - edge)) + 'px';
  // Centred on the "i", then pulled back inside the screen. The caret is positioned against
  // the button rather than the panel, so one clamped to the edge still points at what
  // opened it instead of at nothing.
  const wantLeft = r.left + r.width / 2 - w / 2;
  const left = Math.min(Math.max(edge, wantLeft), Math.max(edge, window.innerWidth - w - edge));
  tipEl.style.left = left + 'px';
  const caret = Math.min(Math.max(14, r.left + r.width / 2 - left), Math.max(14, w - 14));
  tipEl.style.setProperty('--tip-ax', caret + 'px');
  tipEl.style.setProperty('--tip-ox', caret + 'px');
  tipEl.style.setProperty('--tip-oy', below ? '0' : '100%');
  tipEl.style.setProperty('--tip-dy', below ? '-4px' : '4px');
};
document.addEventListener('click', e => { if (tipEl && !e.target.closest('.ib') && !e.target.closest('.tip-pop')) tipClose(); }, true);
window.addEventListener('scroll', tipClose, true);
const qRender = debounce(() => render(), 160);
document.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.q; if (k) { ui.q[k] = e.target.value; ui.lim[k] = 0; qRender(); } });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && Store.ctx && Store.ctx.hostelId) { e.preventDefault(); A.palette(); }
  if (e.key === 'Escape') { ui.waq = null; tipClose(); closeModal(); document.body.classList.remove('drawer'); }
  if (e.key === 'Enter' && e.target.closest && e.target.closest('#mform') && e.target.tagName === 'INPUT' && e.target.type !== 'file') { e.preventDefault(); modalSubmit && modalSubmit(); }
});
window.addEventListener('scroll', () => { const tp = $('#top'); if (tp) tp.classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });
window.addEventListener('popstate', route);
// A link inside the app (<a href="/mess">) changes the page without reloading it.
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href^="/"]');
  if (!a || a.dataset.act || a.target || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = a.getAttribute('href');
  if (/^\/(api|h)\//.test(href) || /\.[a-z0-9]+(\?|#|$)/i.test(href)) return;
  e.preventDefault(); go(href.slice(1));
});
// An uncaught error used to vanish into the console and leave a button that "did nothing".
// Now the person is told once in a while (not on every repeat), and offline blips stay quiet.
let _lastOops = 0;
const oops = err => {
  console.error(err);
  const msg = String((err && err.message) || err || '');
  if (/ResizeObserver|Script error|Load failed|NetworkError|Failed to fetch/i.test(msg) || (err && err.offline)) return;
  if (Date.now() - _lastOops < 10000) return;
  _lastOops = Date.now();
  try { toast(t('Something did not work. If it keeps happening, reload the page.'), 'bad'); } catch (e) { /* the screen may not be drawn yet */ }
};
window.addEventListener('error', e => oops(e.error || e.message));
window.addEventListener('unhandledrejection', e => oops(e.reason));

// Keep data fresh cheaply: sync when the app comes back to the foreground and every 60 s while visible.
const softRefresh = async () => {
  if (!Store.ctx || !Store.ctx.hostelId || document.hidden) return;
  try { await Store.sync(); } catch (e) { console.warn(e); }
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { Store.wake(); softRefresh(); if (Store.ctx && Store.ctx.hostelId) { try { runAutomation(); } catch (e) { console.error(e); } } }
  else Store.flush().catch(() => {});
});
// Self-rescheduling instead of setInterval, so the gap can grow while nothing is happening.
(function pollLoop() {
  setTimeout(() => { softRefresh().finally(pollLoop); }, Store.pollDelay());
})();
Store.onChange = what => {
  if (what === 'online') { updateChrome(); return; }
  if (what === 'meta') { const c = Store.ctx; if (c && c.hostelId && !Store.hostel()) { toast('Access to this hostel was removed', 'bad'); chooseContext(); } return; }
  if ($('#mform') || ($('#modalRoot') && $('#modalRoot').innerHTML)) { updateChrome(); return; } // never redraw under an open form
  render();
};

/* ===================================================================== boot */

async function boot() {
  // Old links (/#/home) still work: turn them into /home
  if (/^#\/./.test(location.hash)) history.replaceState(null, '', '/' + location.hash.slice(2) + location.search);
  setLang(LANG);
  await ensureLang().catch(() => {});
  setTheme(LS.get('hostelos.theme', 'light'));
  // The worker serves files cache-first, which would hide every edit during local development.
  const devHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && devHost) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
  else if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // The new worker takes over at once (skipWaiting), so a page that was already open would keep running old
    // scripts while fetching new ones. Tell the person instead of letting the two versions mix.
    const had = !!navigator.serviceWorker.controller; let told = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !told) { told = true; toast(t('A new version is ready.'), 'ok', { label: t('Reload'), run: () => location.reload() }); } });
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  if (Backend.uid()) {
    try { await afterLogin(); } catch (e) { console.error(e); renderLogin(); }
  } else route();
  if (typeof Pwa !== 'undefined') Pwa.start();
}
