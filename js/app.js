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
  if (c.role === 'emitra') return 'emitra';
  if (isAdmin() || can('home')) return 'home';
  return myMods()[0] || 'me';
}

/* ===================================================================== shell */
function navGroups() {
  const c = ctx();
  if (c.role === 'super' && !c.hostelId) return [['', [['admin', 'Clients & hostels', 'building'], ['admin-pv', 'Police verification', 'shield'], ['admin-users', 'All users', 'users'], ['admin-usage', 'Usage & health', 'chart']]]];
  if (c.role === 'resident') return [['', [['r-home', 'Home', 'home'], ['r-meals', 'Meals', 'utensils'], ['r-clean', 'Room cleaning', 'broom'], ['r-laundry', 'Laundry', 'shirt'], ['r-help', 'Help & notices', 'chat'], ['me', 'Profile', 'user']].filter(x => x[0] !== 'r-laundry' || orgEnabled('laundry')).filter(x => x[0] !== 'r-clean' || orgEnabled('housekeeping')).filter(x => x[0] !== 'r-meals' || orgEnabled('mess'))]];
  if (c.role === 'emitra') return [['', [['emitra', 'Verification queue', 'shield'], ['me', 'Profile', 'user']]]];
  const sec = (title, keys) => [title, keys.filter(k => can(k)).map(k => [k, MOD[k] ? MOD[k].l : k, MOD[k] ? MOD[k].icon : 'circle'])];
  return [
    sec('', ['home', 'inbox']),
    sec('Stay & money', ['inquiries', 'rooms', 'residents', 'payments', 'electricity', 'expenses']),
    sec('Daily operations', ['mess', 'kitchen', 'housekeeping', 'laundry', 'attendance', 'gate', 'complaints']),
    sec('Team & admin', ['staff', 'notices', 'reports', 'automation', 'emitra', 'settings']),
  ].filter(g => g[1].length);
}
function bottomNav() {
  const c = ctx();
  if (c.role === 'resident') return navGroups()[0][1].filter(x => ['r-home', 'r-meals', 'r-clean', 'r-laundry', 'me'].includes(x[0])).slice(0, 5);
  if (c.role === 'emitra') return [['emitra', 'Verification queue', 'shield'], ['me', 'Profile', 'user']];
  if (c.role === 'super' && !c.hostelId) return [['admin', 'Clients', 'building'], ['admin-users', 'Users', 'users'], ['admin-usage', 'Usage', 'chart'], ['me', 'Profile', 'user']];
  const flat = navGroups().flatMap(g => g[1]);
  const pref = isAdmin() ? ['home', 'residents', 'payments', 'inbox'] : flat.map(x => x[0]);
  const main = pref.map(k => flat.find(x => x[0] === k)).filter(Boolean).slice(0, 4);
  // More people have one hostel than several. Only the ones with several get the switcher here (like the
  // account switcher in Instagram); it shows the hostel they are in right now. The menu stays in the header.
  if (hasManyHostels()) return [...main, ['pgswitch', shortPg(), 'building']];
  return [...main, flat.length > main.length ? ['more', 'More', 'grid'] : ['me', 'Profile', 'user']];
}
const hasManyHostels = () => { const c = ctx(); return !!c.hostelId && c.role !== 'resident' && c.role !== 'emitra' && (contexts().length > 1 || String(c.key || '').startsWith('super:')); };
// "Sunrise Boys PG" -> "Sunrise": short enough for the bottom bar, enough to know where you are.
const shortPg = () => { const p = String((Store.hostel() || {}).name || '').trim().split(/\s+/); let w = p[0] || ''; if (w.length < 4 && p[1]) w += ' ' + p[1]; return w.length > 9 ? w.slice(0, 8) + '…' : w; };
function badgeFor(k) {
  if (k === 'inbox') return inboxItems().length;
  if (k === 'inquiries') return Store.all('inquiry').filter(x => !x.data || (x.data.status || 'new') === 'new').length;
  if (k === 'emitra') return (typeof emitraPendingQueue === 'function' ? emitraPendingQueue().length : 0);
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
  const slot = $('#blkSlot'); if (!slot) return;
  const top = $('#top'), c = ctx();
  // A resident lives in one room; there is no wing for them to choose between.
  if (!c.hostelId || !blocksOn() || isResident()) { slot.hidden = true; slot.innerHTML = ''; slot.dataset.sig = ''; if (top) top.classList.remove('hasblk'); return; }
  slot.hidden = false; if (top) top.classList.add('hasblk');
  if (c.block) {
    const sig = 'L' + c.block;
    if (slot.dataset.sig !== sig) { slot.innerHTML = `<span class="blabel" title="${esc(t('You see this block only'))}">${ico('layers', 'sm')}${esc(blockName(c.block))}</span>`; slot.dataset.sig = sig; }
    return;
  }
  const cur = blockScope();
  const opts = [['', t('All blocks')], ...hostelBlocks().map(b => [b.k, b.l])];
  if (allRooms().some(r => !roomBlock(r))) opts.push(['-', t('Not in a block')]);
  // rebuilt only when it would look different, so an open list is not closed by an unrelated refresh
  const sig = 'S' + cur + '|' + opts.map(o => o.join('=')).join('|');
  if (slot.dataset.sig === sig) return;
  slot.dataset.sig = sig;
  slot.innerHTML = `<select class="hsel" id="blkSel" aria-label="${esc(t('Switch block'))}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  Picker.enhance(slot);
  const sel = $('#blkSel'); if (sel) sel.addEventListener('change', () => A.blk({ dataset: { v: sel.value } }));
}
A.blk = el => {
  const v = el.dataset.v || '';
  if (v === blockScope()) return;
  setBlockScope(v);
  LS.set(blockKey(ctx().hostelId), v);
  render(true);
};
// While the super admin is signed in as someone else, a bar on top says so and takes them back with one tap.
function impBar() {
  let imp = null; try { imp = JSON.parse(sessionStorage.getItem('hostelos.imp') || 'null'); } catch (e) { imp = null; }
  const old = document.getElementById('impBar'); if (old) old.remove();
  if (!imp) return;
  const bar = document.createElement('div'); bar.id = 'impBar'; bar.className = 'impbar';
  bar.innerHTML = `<span>${esc(t('Signed in as'))} <b>@${esc(imp.as || '')}</b></span><button type="button" data-act="impback">${esc(t('Back to admin'))}</button>`;
  document.body.prepend(bar); document.body.classList.add('imp');
}
A.impback = () => {
  let imp = null; try { imp = JSON.parse(sessionStorage.getItem('hostelos.imp') || 'null'); } catch (e) { imp = null; }
  try { sessionStorage.removeItem('hostelos.imp'); } catch (e) { /* ignore */ }
  if (imp && imp.session) { LS.set('hostelos.session', imp.session); try { IDB.set('hostelos.session', imp.session).catch(() => {}); } catch (e) { /* ignore */ } }
  else { LS.del('hostelos.session'); }
  location.assign(imp && imp.back ? imp.back : '/');
};
function buildShell() {
  const c = ctx(), h = Store.hostel(), solo = false;
  const superIn = String(c.key || '').startsWith('super:');
  $('#app').innerHTML = `<div class="app ${solo ? 'solo' : ''}">
    <aside class="side" id="side" aria-label="${esc(t('Main menu'))}">
      <div class="brand"><img src="/icons/icon.svg" alt=""><div style="min-width:0">${esc(CFG.APP_NAME || 'Sarvlekh')}<small>${esc(h ? h.name : t('Platform'))}${h && h.settings && h.settings.demo ? ' <b style="color:var(--warn)">· DEMO</b>' : ''}</small></div></div>
      <nav class="nav" id="nav"></nav>
      <div class="side-foot"><div id="installSlot"></div>${li({ icon: 'user', ic: 'mute', t: Store.me.full_name, d: t(ROLES[c.role] ? ROLES[c.role].l : ''), act: 'go', attrs: 'data-to="me"' })}</div>
    </aside>
    <div class="scrim" data-act="drawer"></div>
    <div class="main">
      <div class="offline" id="offline" ${Store.online ? 'hidden' : ''}>${esc(t('Offline — changes are saved and will sync'))}</div>
      <header class="top" id="top">
        <button class="ibtn menu-btn" data-act="drawer" aria-label="${esc(t('Menu'))}">${ico('menu')}</button>
        <h1 id="ptitle"></h1><span class="sp"></span>
        ${c.hostelId && h ? (superIn ? `<button class="pgname" data-act="pgsheet" aria-label="${esc(t('Switch hostel'))}">${ico('building', 'sm')}<span>${esc(h.name)}</span></button>` : `<span class="pgname" title="${esc(h.name)}">${ico('building', 'sm')}<span>${esc(h.name)}</span></span>`) : ''}
        <div class="blkslot" id="blkSlot" hidden></div>
        ${c.hostelId ? `<button class="ibtn hide-s" data-act="palette" aria-label="${esc(t('Search'))}" title="Ctrl+K">${ico('search', 'sm')}</button>` : ''}
        ${c.hostelId ? `<button class="ibtn" data-act="notifs">${ico('bell', 'sm')}<span class="sr">${esc(t('Notifications'))}</span><span class="dot" id="ndot" hidden></span></button>` : ''}
      </header>
      <main class="page" id="page" tabindex="-1"></main>
    </div>
    <nav class="bnav" id="bnav" aria-label="${esc(t('Quick menu'))}"></nav>
  </div>`;
  Picker.enhance($('#top'));
  updateChrome();
  impBar();
}
function updateChrome() {
  const hh = Store.hostel(); if (hh) $$('.pgname span').forEach(x => { if (x.textContent !== hh.name) x.textContent = hh.name; });
  const nav = $('#nav'); if (!nav) return;
  nav.innerHTML = navGroups().map(([title, list]) => `${title ? `<div class="nav-sec">${esc(t(title))}</div>` : ''}${list.map(([k, l, icn]) => { const n = badgeFor(k); return `<a href="/${k}" class="${ui.page === k ? 'on' : ''}" data-act="nav">${ico(icn, 'sm')}<span>${esc(t(l))}</span>${n ? `<span class="cnt">${n}</span>` : ''}</a>`; }).join('')}`).join('');
  $('#bnav').innerHTML = bottomNav().map(([k, l, icn]) => {
    if (k === 'pgswitch') return `<button class="pgb" data-act="pgsheet" aria-label="${esc(t('Switch hostel'))}"><i class="pgav">${esc((l || '?').slice(0, 1).toUpperCase())}</i><span>${esc(l)}</span></button>`;
    const n = badgeFor(k); return `<button class="${ui.page === k ? 'on' : ''}" data-act="${k === 'more' ? 'drawer' : 'go'}" data-to="${k}">${ico(icn)}<span>${esc(t(l))}</span>${n ? `<span class="dot">${n}</span>` : ''}</button>`; }).join('');
  blockBar();
  const slot = $('#installSlot'); if (slot && typeof Pwa !== 'undefined') slot.innerHTML = Pwa.button();
  const nd = $('#ndot'); if (nd) { const n = myNotifs().filter(x => !x.read).length; nd.hidden = !n; nd.textContent = n > 9 ? '9+' : n; }
  const off = $('#offline'); if (off) off.hidden = Store.online;
}

/* ===================================================================== routing */
// Clean addresses (/home, /settings/site), not /#/home. Vercel serves index.html for any path without a dot (vercel.json).
/* Going back to a screen puts you where you were on it, not at its top. The position is kept per address
 * while you scroll; "back" is the browser's back button or a move to the screen above the current one
 * (Settings > Rent -> Settings). Opening a screen from a list still starts at its top. */
const scrollMem = {}; let navBack = false;
window.addEventListener('scroll', () => { if (ui.curPath) scrollMem[ui.curPath] = window.scrollY; }, { passive: true });
function go(to) {
  const p = '/' + String(to).replace(/^\/+/, '');
  if (location.pathname !== p) { navBack = p !== '/' && location.pathname.indexOf(p + '/') === 0; history.pushState(null, '', p); }
  route();
}
function route() {
  const raw = location.pathname.replace(/^\/+|\/+$/g, '').replace(/^index\.html$/, '');
  if (!Store.me) { if (raw === 'setup' && CLOUD) renderSetup(); else renderLogin(); return; }
  if (!Store.ctx) return;
  const [page, arg = ''] = raw.split('/');
  const p = PAGES[page];
  const allowed = p && (!p.mod || can(p.mod)) && (!p.when || p.when());
  // a platform admin who has not opened a hostel has no hostel screens (Home, Payments...), only the console and Profile
  const noHostelPage = ctx().role === 'super' && !ctx().hostelId && !/^(admin|me$)/.test(page);
  const ok = allowed && !noHostelPage;
  ui.page = ok ? page : homeFor(); ui.arg = ok ? decodeURIComponent(arg) : '';
  if (!ok && page && page !== ui.page) { history.replaceState(null, '', '/' + ui.page); }
  document.body.classList.remove('drawer');
  closeModal(true);   // a pop-up from the screen you left must not hang over the new one
  const back = navBack, want = scrollMem[location.pathname] || 0; navBack = false;
  ui.curPath = null;   // the jump to the top below must not overwrite the place we are about to restore
  render(true);
  { const pg = $('#page'); if (pg) { pg.classList.remove('pg-in', 'pg-back'); void pg.offsetWidth; pg.classList.add(back ? 'pg-back' : 'pg-in'); } }   // a short slide, like moving between screens of an app
  ui.curPath = location.pathname;
  if (back && want > 0) { const put = () => window.scrollTo(0, want); put(); requestAnimationFrame(put); setTimeout(put, 140); }
}
function render(scrollTop) {
  const el = $('#page'); if (!el || !Store.ctx) return;
  const p = PAGES[ui.page]; if (!p) return;
  const active = document.activeElement, qkey = active && active.dataset && active.dataset.q, caret = qkey ? active.selectionStart : 0;
  // sideways-scrolling strips (tabs, filter chips, wide tables) keep their place when the screen is redrawn
  const strips = [...el.querySelectorAll('.seg, .chips, .scroll-x')].map(x => x.scrollLeft);
  try { el.innerHTML = p.render(ui.arg); }
  catch (e) { console.error(e); el.innerHTML = `<div class="card">${empty('Something went wrong on this screen', e.message, btn('Go home', 'go', `data-to="${homeFor()}"`))}</div>`; }
  $('#ptitle').textContent = t(typeof p.title === 'function' ? p.title() : p.title);
  document.title = `${t(typeof p.title === 'function' ? p.title() : p.title)} · ${CFG.APP_NAME || 'Sarvlekh'}`;
  Picker.enhance(el);
  if (typeof hhCountUp === 'function') hhCountUp(el);
  foldLongLists(el);
  infoToButton(el);
  placeInfo(el);
  if (qkey) { const q = $(`[data-q="${qkey}"]`); if (q) { q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) { /* type=search */ } } }
  const now = [...el.querySelectorAll('.seg, .chips, .scroll-x')];
  if (!scrollTop && now.length === strips.length) now.forEach((x, i) => { x.scrollLeft = strips[i]; });
  now.forEach(x => { // keep the selected tab / chip in view without moving the page
    const on = x.matches('.seg, .chips') && x.querySelector('.on'); if (!on) return;
    const l = on.offsetLeft - x.offsetLeft, r = l + on.offsetWidth;
    if (l < x.scrollLeft) x.scrollLeft = Math.max(0, l - 12); else if (r > x.scrollLeft + x.clientWidth) x.scrollLeft = r - x.clientWidth + 12;
  });
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
    body: `<div style="text-align:center">
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
  let lastUser = (typeof LS !== 'undefined' && LS.get('hostelos.last_user')) || '', prePass = '';
  // A login link from the admission message (…/#c=…) arrives with both boxes filled; the address bar is cleaned straight away.
  try {
    const m = /^#c=([\w-]+)$/.exec(location.hash || '');
    if (m) {
      const raw = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))), i = raw.indexOf('\n');
      if (i > 0) { lastUser = raw.slice(0, i); prePass = raw.slice(i + 1); }
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (e) { /* not a login link */ }
  // The brand mark is part of the background picture (phone and desktop each have their own);
  // this is only the sign-in panel: under the mark on a phone, to its right on a desktop.
  const EYE = '<svg class="i eye-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="i eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  $('#app').innerHTML = `<div class="auth login"><div class="box">
    <form id="loginForm" class="lcard" novalidate>
      <h1>${esc(t('Log in'))}</h1><p class="sub">${esc(t('Hostel & PG management, simple and fast'))}</p>
      <label class="lf"><span class="lic">${ico('user')}</span><input name="u" placeholder="${esc(t('User ID'))}" autocomplete="username" autocapitalize="none" value="${esc(lastUser)}" required></label>
      <label class="lf"><span class="lic">${ico('lock')}</span><input name="p" type="password" placeholder="${esc(t('Password'))}" autocomplete="current-password" value="${esc(prePass)}" required>
        <button type="button" class="eye" data-act="pwtoggle" aria-label="${esc(t('Show password'))}">${EYE}</button>
        ${typeof Mascot !== 'undefined' ? `<div class="eleph" id="spy" aria-hidden="true">${Mascot.svg()}</div>` : ''}</label>
      <div class="caps" id="caps" role="status">${esc(t('Caps Lock is on.'))}</div>
      <div class="ferr" id="lerr">${esc(err || '')}</div>
      <button class="lbtn" type="submit">${esc(t('Log in'))}</button>
    </form>
    ${CLOUD ? '' : `<div class="demo">${group('Demo logins — tap to try', [
      ['9876500001', '9876500001', 'Owner (Sunrise Boys PG)', 'building'],
      ['9876543210', '9876543210', 'Owner (Aravali Student Residency)', 'building'],
      ['9876500007.sunrise', '9876500007', 'Manager (Vikram Singh)', 'briefcase'],
      ['9876500008.sunrise', '9876500008', 'Warden (Shanti Warden)', 'shield'],
      ['9811100001.aravali', '9811100001', 'Resident (Aryan Sharma)', 'user'],
      ['9812300001.sunrise', '9812300001', 'Resident (Aman Gupta)', 'user'],
      ['9812345678.sunrise', '9812345678', 'Resident (Test User)', 'user'],
      ['9876500003.sunrise', '9876500003', 'Cook (Raju)', 'utensils'],
      ['9876500004.sunrise', '9876500004', 'Housekeeping (Sunita)', 'broom'],
      ['9876500005.sunrise', '9876500005', 'Laundry (Mohan)', 'shirt'],
      ['9876500006.sunrise', '9876500006', 'Security guard (Bahadur)', 'shield'],
      ['admin', 'admin123', 'Super admin', 'key']
    ].map(([u, p, l, i]) => li({ icon: i, t: t(l), d: `${u} / ${p}`, act: 'demologin', attrs: `data-u="${u}" data-p="${p}"` })).join(''), t('Demo mode: data stays in this browser. Add Supabase keys in js/config.js to go live.'))}</div>`}
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
  try {
    const uid = await Backend.login(u, p);
    if (typeof AuthCache !== 'undefined') AuthCache.save(u, p, uid);
    // ask the browser / Google Password Manager to offer saving the login (where the device supports it)
    try { if (window.PasswordCredential && navigator.credentials && navigator.credentials.store) await navigator.credentials.store(new PasswordCredential({ id: u, password: p, name: u })); } catch (e) { /* not supported */ }
    await afterLogin();
  }
  catch (e) {
    // An app installed on a phone before the Supabase key change keeps its old copy of the settings. Clear that copy and start fresh, once.
    if (/legacy api keys/i.test(String(e.message)) && !sessionStorage.getItem('hostelos.healed')) {
      try { sessionStorage.setItem('hostelos.healed', '1'); } catch (x) { /* private mode */ }
      try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); } catch (x) { /* nothing to clear */ }
      location.replace('/?fresh=' + Date.now()); return;
    }
    renderLogin(t(e.message));
  }
}
async function afterLogin() {
  try { await Store.loadMeta(); }
  catch (e) {
    if (e.status === 401) {
      if (typeof AuthCache !== 'undefined') {
        const creds = await AuthCache.get().catch(() => null);
        if (creds && creds.u && creds.p) {
          try {
            await Backend.login(creds.u, creds.p);
            await Store.loadMeta();
          } catch (reErr) {
            await Backend.logout();
            renderLogin();
            return;
          }
        } else {
          await Backend.logout();
          renderLogin();
          return;
        }
      } else {
        await Backend.logout();
        renderLogin();
        return;
      }
    } else {
      $('#app').innerHTML = `<div class="auth"><div class="box card">${empty('Could not load your account', t(e.message), btn('Try again', 'reload'))}</div></div>`;
      return;
    }
  }
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
      ${(() => { const r = c.role === 'resident' && typeof meRes === 'function' ? meRes() : null; if (!r) return ''; const dep = sum(resInvoices(r.id).filter(i => i.type === 'deposit'), i => i.paid || 0), ph = (S().pay || {}).phone;
        return group('My stay', [
          li({ icon: 'bed', ic: 'tn0', t: `${t('Room')} ${roomName(r.roomId)}${r.bed ? ' - ' + r.bed : ''}`, d: `${t('Staying since')} ${fmtDate(r.checkIn)}`, chev: false }),
          li({ icon: 'rupee', ic: 'tn2', t: `${inr(r.rent)} ${t('per month')}`, d: dep ? `${t('Deposit held')}: ${inr(dep)}` : t('No deposit recorded'), chev: false }),
          ph ? li({ icon: 'phone', ic: 'tn1', t: t('Call the owner'), d: ph, tag: 'a', attrs: `href="tel:${esc(ph)}"`, chev: false }) : ''
        ].join('')); })()}
      ${group('Preferences', [
        li({ icon: dark === 'dark' ? 'moon' : 'sun', ic: 'mute', t: t('Appearance'), end: t(dark === 'dark' ? 'Dark' : dark === 'light' ? 'Light' : 'Automatic'), act: 'theme' }),
        li({ icon: 'download', ic: 'teal', t: t('Install app on this phone'), d: t('Add to home screen for one-tap access'), act: 'install' }),
      ].join(''))}
      ${group('Security', [li({ icon: 'lock', ic: 'warn', t: t('Change password'), act: 'chpw' }), li({ icon: 'sync', ic: 'ok', t: t('Sync now'), d: Store.lastSync ? t('Last synced {t}', { t: ago(Store.lastSync) }) : '', act: 'syncnow' })].join(''))}
      <div style="margin-top:22px">${btn('Log out', 'logout', '', 'bad block', 'logout')}</div>
      <p class="hint" style="text-align:center;margin-top:14px">${esc(CFG.APP_NAME || 'Sarvlekh')} · ${CLOUD ? t('Cloud') : t('Demo mode')}</p></div>`;
  },
};
A.ctx = el => { closeModal(); chooseContext(el.dataset.key); };
// The hostel list in a sheet: the bottom-bar button on a phone, and the hostel name in the header for the platform admin.
A.pgsheet = () => {
  const c = ctx(), cs = contexts();
  const row = x => li({ icon: x.role === 'resident' ? 'user' : x.role === 'super' ? 'key' : 'building', ic: x.key === c.key ? 'ok' : 'mute', t: x.label, end: x.key === c.key ? badge('Current', 'ok') : '', act: x.key === c.key ? '' : 'ctx', attrs: `data-key="${esc(x.key)}"`, chev: x.key !== c.key });
  const cur = cs.some(x => x.key === c.key) ? '' : row(c);
  sheet(t('Switch hostel'), `<div class="group">${cur}${cs.map(row).join('')}</div>`);
};
// Two quick taps on the hostel name = jump to the next hostel (1 > 2 > 3 > 1), without opening the list.
{
  const openSheet = A.pgsheet; let lastTap = 0;
  A.pgsheet = (el, e) => {
    const now = Date.now();
    if (now - lastTap < 450) {
      lastTap = 0; closeModal(true);
      const cs = contexts(); if (cs.length < 2) return;
      const i = cs.findIndex(x => x.key === ctx().key), nx = cs[(i + 1) % cs.length];
      toast(t('Switched to {n}', { n: nx.label }), 'ok');
      return chooseContext(nx.key);
    }
    lastTap = now; return openSheet(el, e);
  };
}
A.chpw = () => formModal({
  title: 'Change password', submit: 'Update password',
  fields: [{ name: 'p1', label: 'New password', type: 'password', required: true, hint: t('At least 6 characters') }, { name: 'p2', label: 'Repeat new password', type: 'password', required: true }],
  onSubmit: async v => { if (v.p1.length < 6) return 'Password must be at least 6 characters'; if (v.p1 !== v.p2) return 'Passwords do not match'; await Backend.changePassword(v.p1); toast('Password changed'); },
});
A.logout = () => {
  if (CLOUD && Store.outbox && Store.outbox.length > 0) {
    openModal({
      title: t('Unsynced Changes Warning'),
      body: `<p>${esc(t('You have {n} offline changes that have not yet synced with the server.', { n: Store.outbox.length }))}</p>
             <p class="muted sm" style="margin-top:8px">${esc(t('To protect your data on a shared device, choose an option:'))}</p>`,
      foot: `<div class="row" style="gap:8px;flex-direction:column;width:100%">
               <button class="btn ok block" data-act="logout_safe">${esc(t('Safe Switch Account (Encrypt & Keep)'))}</button>
               <button class="btn bad block" data-act="logout_force">${esc(t('Discard Pending Changes & Log Out'))}</button>
               <button class="btn block" data-act="closemodal">${esc(t('Cancel (Stay Logged In)'))}</button>
             </div>`
    });
    return;
  }
  confirmBox(t('Log out from this device?'), async () => {
    if (typeof AuthCache !== 'undefined') AuthCache.clear();
    await Store.logout();
    history.replaceState(null, '', '/');
    renderLogin();
  }, 'Log out', 'bad');
};
A.logout_safe = async () => {
  closeModal();
  if (typeof AuthCache !== 'undefined') AuthCache.clear();
  await Store.logout({ safeSwitch: true });
  history.replaceState(null, '', '/');
  renderLogin();
  toast(t('Account switched safely. Pending changes are encrypted on this device.'), 'ok');
};
A.logout_force = async () => {
  closeModal();
  if (typeof AuthCache !== 'undefined') AuthCache.clear();
  await Store.logout({ forceDiscard: true });
  history.replaceState(null, '', '/');
  renderLogin();
};
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
// the pop-up all end up here.
A.install = () => Pwa.open(true);
A.pwainstall = () => Pwa.prompt();
A.pwalater = () => Pwa.snooze(14);
A.pwanever = () => Pwa.snooze(3650);

/* ===================================================================== notifications & palette */
A.notifs = () => {
  const list = myNotifs().slice(0, 60);
  const psupp = typeof Pwa !== 'undefined' && Pwa.isPushSupported && Pwa.isPushSupported();
  const perm = psupp ? Pwa.getPushPermission() : 'unsupported';
  let pushCtrl = '';
  if (psupp) {
    const row = (icon, tone, title, sub, end) => `<div class="ntf-push ${tone}"><span class="ntf-pi">${ico(icon, 'sm')}</span><span class="ntf-pt"><b>${esc(title)}</b><small>${esc(sub)}</small></span>${end}</div>`;
    if (perm === 'granted') pushCtrl = row('bell', 'ok', t('Push notifications'), t('You will get alerts on this phone'), `<span class="badge ok">${ico('check', 'xs')} ${esc(t('Active'))}</span>`);
    else if (perm === 'denied') pushCtrl = row('alert', 'warn', t('Push blocked'), t('Allow notifications in your browser settings'), `<button class="btn xs warn" data-act="enablepush">${esc(t('Unblock instructions'))}</button>`);
    else pushCtrl = row('bell', 'info', t('Push notifications'), t('Get alerts even when the app is closed'), `<button class="btn sm primary" data-act="enablepush">${esc(t('Enable'))}</button>`);
  }

  // what the notice is about decides its icon and colour
  const kind = n => { const x = `${n.title} ${n.body || ''}`.toLowerCase(); return /laundry|clothes/.test(x) ? ['shirt', 'tn5'] : /clean|room/.test(x) ? ['broom', 'tn2'] : /pay|rent|due|bill|₹|receipt|refund/.test(x) ? ['rupee', 'tn3'] : /meal|tiffin|food|dinner|lunch|breakfast/.test(x) ? ['utensils', 'tn4'] : /notice|announce/.test(x) ? ['megaphone', 'tn0'] : /visitor|gate/.test(x) ? ['door', 'tn1'] : ['bell', 'tn0']; };
  const unreadN = list.filter(n => !n.read).length;
  const itemsHtml = list.length
    ? `<div class="ntf-head"><span>${esc(t('Tap to open · swipe to dismiss'))}</span><span class="ntf-un ${unreadN ? '' : 'z'}" id="ntfUnreadCount">${unreadN} ${esc(t('unread'))}</span></div>
       <div class="ntf-list" id="ntfGroup">
         ${list.map(n => { const [icn, tone] = kind(n); return `
           <div class="ntf-wrap" id="ntf-wrap-${n.id}" data-id="${n.id}">
             <div class="ntf-swipe-bg"><span class="sw-r">${ico('check', 'xs')} ${esc(t('Mark as read'))}</span><span class="sw-l">${esc(t('Delete'))} ${ico('trash', 'xs')}</span></div>
             <div class="ntf-item ${n.read ? 'read' : 'unread'}" data-id="${n.id}" data-to="${esc(n.link || '')}">
               <span class="ntf-ic ${tone}">${ico(icn, 'sm')}</span>
               <span class="ntf-body"><span class="ntf-top"><span class="ntf-t">${esc(n.title)}</span><span class="ntf-time">${esc(ago(n.ts))}</span></span>${n.body ? `<span class="ntf-d">${esc(n.body)}</span>` : ''}</span>
               <button class="ntf-del-btn" data-id="${n.id}" title="${esc(t('Dismiss'))}" aria-label="${esc(t('Dismiss'))}">${ico('x', 'xs')}</button>
             </div>
           </div>`; }).join('')}
       </div>`
    : empty('No notifications', 'You are all caught up.');

  sheet('Notifications', `${pushCtrl}<div id="ntfContainer">${itemsHtml}</div>`,
    { foot: list.some(n => !n.read) ? `<button class="btn block" data-act="ntfread">${esc(t('Mark all as read'))}</button>` : '' });

  setTimeout(() => initNotifGestures(), 20);
};

function initNotifGestures() {
  const container = $('#ntfGroup');
  if (!container) return;

  const dismissNotif = (id, targetEl, andNavigate) => {
    const wrap = $(`#ntf-wrap-${id}`) || (targetEl && targetEl.closest('.ntf-wrap'));
    if (wrap) {
      wrap.style.maxHeight = wrap.offsetHeight + 'px';
      wrap.style.overflow = 'hidden';
      wrap.offsetHeight; // reflow
      wrap.style.opacity = '0';
      wrap.style.maxHeight = '0px';
      wrap.style.padding = '0px';
      wrap.style.margin = '0px';
      wrap.style.border = 'none';
      setTimeout(() => {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        const remaining = container.querySelectorAll('.ntf-wrap');
        if (!remaining.length) {
          const parent = $('#ntfContainer');
          if (parent) parent.innerHTML = `<div class="card">${empty('No notifications', 'You are all caught up.')}</div>`;
          const footBtn = $('[data-act="ntfread"]');
          if (footBtn) footBtn.style.display = 'none';
        }
      }, 260);
    }

    Store.patch(id, { read: true, dismissed: true });
    updateChrome();

    const countEl = $('#ntfUnreadCount');
    if (countEl) {
      const unread = myNotifs().filter(n => !n.read).length;
      countEl.textContent = `${unread} ${t('unread')}`;
    }

    if (andNavigate) {
      closeModal();
      go(andNavigate);
    }
  };

  container.querySelectorAll('.ntf-item').forEach(item => {
    let startX = 0, startY = 0, currentX = 0, isDragging = false, isHorizontal = null;
    const id = item.dataset.id;
    const to = item.dataset.to;

    // Direct tap on close button ✕
    const closeBtn = item.querySelector('.ntf-del-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        dismissNotif(id, item, null);
      });
    }

    // Touch events for mobile phones (slide / swipe to dismiss)
    item.addEventListener('touchstart', e => {
      if (e.target.closest('.ntf-del-btn')) return;
      const t0 = e.touches[0];
      startX = t0.clientX;
      startY = t0.clientY;
      currentX = 0;
      isDragging = true;
      isHorizontal = null;
      item.style.transition = 'none';
    }, { passive: true });

    item.addEventListener('touchmove', e => {
      if (!isDragging) return;
      const t0 = e.touches[0];
      const dx = t0.clientX - startX;
      const dy = t0.clientY - startY;

      if (isHorizontal === null) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          isHorizontal = Math.abs(dx) > Math.abs(dy);
        }
      }

      if (isHorizontal) {
        currentX = dx;
        item.style.transform = `translateX(${dx}px)`;
        item.style.opacity = `${Math.max(0.35, 1 - Math.abs(dx) / 400)}`;
        const wr = item.closest('.ntf-wrap'); if (wr) { wr.classList.toggle('sw-right', dx > 0); wr.classList.toggle('sw-left', dx < 0); }
      }
    }, { passive: true });

    item.addEventListener('touchend', e => {
      if (!isDragging) return;
      isDragging = false;
      item.style.transition = 'transform 0.2s ease, opacity 0.2s ease';

      const wr = item.closest('.ntf-wrap'); if (wr) wr.classList.remove('sw-right', 'sw-left');
      if (isHorizontal && currentX > 80) {
        // Swipe right: mark as read, the card stays
        item.style.transform = 'translateX(0px)'; item.style.opacity = '1';
        if (!(Store.get(id) || {}).read) { Store.patch(id, { read: true }); item.classList.remove('unread'); item.classList.add('read'); updateChrome(); const c = $('#ntfUnreadCount'); if (c) { const un = myNotifs().filter(n => !n.read).length; c.textContent = `${un} ${t('unread')}`; c.classList.toggle('z', !un); } toast(t('Marked as read')); }
      } else if (isHorizontal && currentX < -80) {
        // Swipe left: delete, the card slides out
        item.style.transform = 'translateX(-120%)';
        item.style.opacity = '0';
        setTimeout(() => dismissNotif(id, item, null), 150);
      } else if (isHorizontal) {
        // Released before threshold -> snap back
        item.style.transform = 'translateX(0px)';
        item.style.opacity = '1';
      }
    });

    // Pointer/Click event
    item.addEventListener('click', e => {
      if (e.target.closest('.ntf-del-btn')) return;
      // If was dragging horizontally, ignore click
      if (isHorizontal && Math.abs(currentX) > 10) return;

      if (to) {
        // Has a destination page -> mark read and navigate
        dismissNotif(id, item, to);
      } else {
        // No destination page -> dismiss notice on tap ("click kra toh notification htt jaye")
        item.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        item.style.transform = 'translateX(100%)';
        item.style.opacity = '0';
        setTimeout(() => dismissNotif(id, item, null), 150);
      }
    });
  });
}

A.enablepush = async () => {
  if (typeof Pwa !== 'undefined' && Pwa.togglePushWorkflow) {
    await Pwa.togglePushWorkflow();
    A.notifs();
  }
};
A.ntfread = () => {
  myNotifs().forEach(n => Store.patch(n.id, { read: true, dismissed: true }));
  closeModal();
  updateChrome();
  toast(t('All notifications cleared'), 'ok');
};
A.ntfgo = el => {
  Store.patch(el.dataset.id, { read: true, dismissed: true });
  closeModal();
  if (el.dataset.to) go(el.dataset.to);
};
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
A.sendbulkemailnotice = async () => {
  const q = ui.waq;
  if (!q || !q.list || !q.list.length) return;
  const list = q.list;
  closeModal();
  toast(t('Publishing notices & sending emails to {n} residents…', { n: list.length }));

  const h = Store.hostel() || {};
  const hostelTitle = h.name || 'Hostel';
  let emailCount = 0;
  let noticeCount = 0;
  const emailJobs = [];

  for (const item of list) {
    const r = item.r || (item.x && item.x.r) || resById(item.resId) || residents().find(x => phone10(x.phone) === phone10(item.phone));
    if (!r) continue;

    // 1. Post to resident panel notice section (ntf)
    notify({
      to: 'res',
      resId: r.id,
      title: q.title || t('Fee Reminder & Notice'),
      body: item.text,
      category: 'fee',
      link: 'r-home'
    });
    noticeCount++;

    // 2. Send branded email if resident has email address
    if (r.email && isValidEmail(r.email)) {
      const due = resDue(r.id);
      const emailHtml = renderBrandedEmailHtml({
        hostelName: hostelTitle,
        title: q.title || t('Fee Reminder & Notice'),
        headline: t('Payment Reminder & Statement'),
        recipientName: r.name,
        bodyLines: item.text,
        amountDue: due,
        payLink: payLink(due, `${r.name} ${roomName(r.roomId)}`, { resId: r.id }),
        date: fmtDate(today())
      });
      emailJobs.push(sendBrandedEmail({
        to: r.email,
        subject: `${hostelTitle} · ${q.title || t('Fee Reminder')}`,
        html: emailHtml,
        text: item.text,
        resId: r.id,
        hostelId: h.id
      }));
    }
  }

  // Count only emails the mail service really accepted, and say plainly what did not go out.
  const results = await Promise.all(emailJobs);
  emailCount = results.filter(x => x.delivered).length;
  const noEmail = list.length - emailJobs.length;
  const notConfigured = results.some(x => x.reason === 'not_configured');
  const failed = results.filter(x => !x.delivered && x.reason !== 'demo' && x.reason !== 'not_configured').length;
  toast(t('Published to {n} resident app notices{e} ✓', {
    n: noticeCount,
    e: emailCount ? ` · ${emailCount} emails sent` : ''
  }), 'ok');
  if (results.some(x => x.reason === 'demo')) toast(t('Demo hostel: notices posted, emails are never sent from the demo'), 'warn');
  else if (notConfigured) toast(t('Notices posted, but emails were NOT sent: email service is not set up (add RESEND_API_KEY on the server)'), 'bad');
  else if (failed) toast(t('{n} emails failed to send', { n: failed }), 'bad');
  if (noEmail > 0 && !notConfigured) toast(t('{n} residents have no email saved - they got the app notice only', { n: noEmail }), 'warn');

  // Mark pending reminders/bills in admin inbox as completed
  const inbox = Store.all('ntf').filter(x => x.to === 'admin' && (x.title.toLowerCase().includes('reminder') || x.title.toLowerCase().includes('bill')));
  for (const n of inbox) Store.patch(n.id, { read: true, dismissed: true });
  render();
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
  if (el.dataset.busy) return;
  const fn = A[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'A' && el.dataset.act !== 'nav' && el.getAttribute('href') && !el.getAttribute('href').startsWith('#')) { fn(el, e); return; }
  if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
  try {
    const r = fn(el, e);
    if (r && typeof r.then === 'function') {
      el.dataset.busy = '1';
      el.setAttribute('aria-busy', 'true');
      r.catch(err => { console.error(err); toast(err.message || 'Something went wrong', 'bad'); })
       .finally(() => { delete el.dataset.busy; el.removeAttribute('aria-busy'); });
    }
  }
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
  tipEl.innerHTML = `<div class="tp-body">${tx.innerHTML}</div>`;
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
  // enters from the side the "i" is on, so it reads as coming out of the icon rather than appearing
  tipEl.style.setProperty('--tip-dx', (r.left + r.width / 2 > window.innerWidth / 2 ? 18 : -18) + 'px');
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
window.addEventListener('popstate', () => { navBack = true; route(); });
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
  // Settings and modules (the platform admin's changes) normally arrive live; without the live channel, fetch them here
  if (CLOUD && (!Live.up || Date.now() - Store.metaAt > 600e3)) { try { await Store.refreshMeta(); } catch (e) { console.warn(e); } }
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { Store.wake(); if (typeof Live !== 'undefined') Live.watch(); softRefresh(); if (Store.ctx && Store.ctx.hostelId) { try { runAutomation(); } catch (e) { console.error(e); } } }
  else Store.flush().catch(() => {});
});
// Self-rescheduling instead of setInterval, so the gap can grow while nothing is happening.
(function pollLoop() {
  setTimeout(() => { softRefresh().finally(pollLoop); }, Store.pollDelay());
})();
Store.onChange = (what, changed) => {
  if (what === 'online') { updateChrome(); return; }
  if (what === 'meta') {
    const c = Store.ctx; if (c && c.hostelId && !Store.hostel()) { toast('Access to this hostel was removed', 'bad'); chooseContext(); return; }
    // modules, settings or access changed somewhere else: show it now, but never redraw under an open form
    if (changed) { if ($('#mform') || ($('#modalRoot') && $('#modalRoot').innerHTML)) updateChrome(); else { updateChrome(); render(); } }
    return;
  }
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
    /* Updates apply themselves. A web app that is installed on a phone has no refresh button, so:
     *  1. it asks for a newer version every 10 minutes and whenever it comes back to the screen;
     *  2. when the new version has taken over, the app reloads itself at a safe moment - straight away if
     *     nothing is being typed or saved, otherwise as soon as the form is closed, or the moment the app goes
     *     to the background (then nobody sees it). It never reloads in the middle of typing, and at most once a minute. */
    const had = !!navigator.serviceWorker.controller; let waiting = false, reg = null;
    const safeNow = () => {
      const mr = $('#modalRoot'); if (mr && mr.innerHTML) return false;                      // a form or sheet is open
      const a = document.activeElement; if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && !/^(checkbox|radio|button|submit|range)$/.test(a.type) && String(a.value || '').length) return false;
      if (Store.flushing || Store.syncing) return false;                                      // saving right now
      return true;
    };
    const reloadNow = () => {
      let last = 0; try { last = +sessionStorage.getItem('hostelos.reloadAt') || 0; } catch (e) { /* private mode */ }
      if (Date.now() - last < 60000) return;
      try { sessionStorage.setItem('hostelos.reloadAt', String(Date.now())); } catch (e) { /* private mode */ }
      try { Store.persist && Store.persist(); } catch (e) { /* the outbox is kept on this device anyway */ }
      if (!document.hidden) toast(t('Updating to the latest version…'), 'ok');
      setTimeout(() => location.reload(), document.hidden ? 50 : 900);
    };
    const tryApply = () => { if (waiting && (document.hidden || safeNow())) { waiting = false; reloadNow(); } };
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) { waiting = true; tryApply(); } });
    setInterval(tryApply, 3000);
    const check = () => { if (reg && navigator.onLine) reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) tryApply(); else { check(); tryApply(); } });
    setInterval(() => { if (!document.hidden) check(); }, 10 * 60 * 1000);
    navigator.serviceWorker.register('/sw.js').then(r => { reg = r; }).catch(() => {});
  }
  // Restore session from IDB if missing in localStorage
  if (!Backend.uid()) {
    try {
      const s = await IDB.get(CLOUD ? 'hostelos.session' : 'hostelos.demo.session');
      if (s && s.uid) {
        if (CLOUD) Cloud.session = s; else Demo.session = s;
        LS.set(CLOUD ? 'hostelos.session' : 'hostelos.demo.session', s);
      }
    } catch (e) { /* ignore */ }
  }

  // If still no session, check cached login credentials to automatically authenticate
  if (!Backend.uid() && typeof AuthCache !== 'undefined') {
    try {
      const creds = await AuthCache.get();
      if (creds && creds.u && creds.p) {
        await Backend.login(creds.u, creds.p);
      }
    } catch (e) {
      console.warn('Auto-login with cached credentials failed:', e);
    }
  }

  if (Backend.uid()) {
    try { await afterLogin(); }
    catch (e) {
      console.error(e);
      if (typeof AuthCache !== 'undefined') {
        try {
          const creds = await AuthCache.get();
          if (creds && creds.u && creds.p) {
            await Backend.login(creds.u, creds.p);
            await afterLogin();
            if (typeof Pwa !== 'undefined') Pwa.start();
            return;
          }
        } catch (reErr) { console.error('Re-login failed:', reErr); }
      }
      renderLogin();
    }
  } else route();
  if (typeof Pwa !== 'undefined') Pwa.start();
}

/* Any list of more than 6 rows shows the first 6 and a "View all (n)" button, so a screen never turns into one very
 * long scroll. Lists inside pop-ups and the roll call (where every row has to be in reach) are left alone. */
const FOLD_AT = 6, FOLD_SKIP_PAGES = ['attendance'];
// A long list with nothing under it folds ("View all"). With more content under it the list scrolls inside itself instead,
// so the rest of the page stays reachable; it keeps a gutter on both sides to start the page scroll from.
function hasContentBelow(el) {
  for (let n = el; n && n.id !== 'page'; n = n.parentElement) {
    if (n.parentElement && n.parentElement.classList.contains('grid')) continue;
    // only real content counts: an "i" button, a hint line or a View all button under a list is not a reason to scroll inside it
    for (let s = n.nextElementSibling; s; s = s.nextElementSibling) if (s.offsetHeight > 24 && !s.matches('.fold-btn, .about, .ib-w, .hint, .spin, [hidden]') && (s.textContent || '').trim().length) return true;
  }
  return false;
}
function foldLongLists(root) {
  if (!root || FOLD_SKIP_PAGES.includes(ui.page)) return;
  root.querySelectorAll('.tbl-wrap').forEach(w => { if (!w.closest('#modalRoot') && w.querySelectorAll('tbody tr').length > 8 && hasContentBelow(w)) w.classList.add('inscroll'); });
  root.querySelectorAll('.group, .fold-list').forEach(g => {
    if (g.closest('#modalRoot') || g.dataset.nofold != null || g.classList.contains('nofold') || g.nextElementSibling && g.nextElementSibling.classList.contains('fold-btn')) return;
    const rows = [...g.children].filter(x => x.classList.contains('li') || x.classList.contains('apv') || x.classList.contains('stk') || x.classList.contains('prc') || x.classList.contains('prow') || x.classList.contains('swp-wrap') || (g.classList.contains('stack') && x.classList.contains('card')));
    if (rows.length <= FOLD_AT) return;
    // One rule everywhere: a long list shows its first rows and a View all button. No scrolling inside a panel.
    rows.slice(FOLD_AT).forEach(x => x.classList.add('fold-hide'));
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn sm ghost block fold-btn'; b.dataset.act = 'foldgrp'; b.dataset.n = rows.length;
    b.textContent = t('View all ({n})', { n: rows.length });
    g.after(b);
  });
}
A.foldgrp = el => {
  const g = el.previousElementSibling; if (!g) return;
  const open = g.classList.toggle('unfolded');
  el.textContent = open ? t('Show less') : t('View all ({n})', { n: el.dataset.n });
};

/* Explanatory sentences never sit on the screen: a long grey hint under a heading or card becomes the "i" button
 * (tap to read). Short status lines, field hints inside forms and anything that updates live are left as they are. */
// Every "i" button sits beside a heading, never floating on its own: the first one on a screen goes next to the screen title,
// one that follows a section title goes beside that title.
function placeInfo(root) {
  root.querySelectorAll('.about').forEach(a => {
    const w = a.querySelector('.ib-w'); if (!w || a.closest('#modalRoot, .card, .group')) return;
    const prev = a.previousElementSibling, h2 = root.querySelector('.sec-head h2');
    const gt = prev && prev.classList.contains('group') && prev.previousElementSibling && prev.previousElementSibling.classList.contains('group-t') ? prev.previousElementSibling : null;
    const tgt = prev && prev.classList.contains('group-t') ? prev : gt || (h2 && !h2.querySelector('.ib-w') ? h2 : null);
    if (tgt) { tgt.appendChild(w); a.remove(); }
  });
}
function infoToButton(root) {
  if (!root) return;
  root.querySelectorAll('p.hint, div.hint').forEach(h => {
    if (h.id || h.closest('form, .li, .tool, .ib-w, .tip-pop, label, .ferr, .mgrid, table') || h.dataset.keep != null) return;
    const txt = (h.textContent || '').trim();
    if (txt.length < 45 || h.querySelector('a, button, input')) return;
    const w = document.createElement('div'); w.className = 'about'; w.innerHTML = tip(h.innerHTML);
    h.replaceWith(w);
  });
}

/* Swipe a notification-style card sideways: it follows the finger, and once it is dragged far enough (or flicked) it
 * flies off, the gap closes, and the card's action (data-swact on the wrapper) runs. Too short a drag springs back. */
(function () {
  let st = null;
  document.addEventListener('pointerdown', e => {
    const card = e.target.closest && e.target.closest('.swp');
    if (!card || e.target.closest('button, a, input, select, textarea, label, summary')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    st = { card, wrap: card.closest('.swp-wrap'), x: e.clientX, y: e.clientY, t: Date.now(), dx: 0, drag: false, id: e.pointerId };
  });
  document.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.drag) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) { st.drag = true; st.card.style.transition = 'none'; try { st.card.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } }
      else if (Math.abs(dy) > 10) { st = null; return; }
      else return;
    }
    st.dx = dx; const w = st.card.offsetWidth || 300;
    const dual = st.wrap.classList.contains('dual');
    st.card.style.transform = 'translateX(' + (dual ? Math.max(-w * 0.6, Math.min(w * 0.6, dx)) : dx) + 'px)' + (dual ? '' : ' rotate(' + (dx / w * 3) + 'deg)');
    st.card.style.opacity = String(dual ? 1 : 1 - Math.min(0.55, Math.abs(dx) / w));
    st.wrap.classList.toggle('left', dx < 0); st.wrap.classList.toggle('right', dx > 0);
  });
  const end = e => {
    if (!st || e.pointerId !== st.id) return;
    const s = st; st = null; if (!s.drag) return;
    const w = s.card.offsetWidth || 300, v = Math.abs(s.dx) / Math.max(1, Date.now() - s.t);
    s.card.style.transition = 'transform .22s ease, opacity .22s ease';
    if (s.wrap.classList.contains('dual')) {
      // two-direction card: do the action of that side, then spring back (nothing is removed by the swipe itself)
      const far = Math.abs(s.dx) > w * 0.3 || (v > 0.6 && Math.abs(s.dx) > 40), act = s.dx > 0 ? s.wrap.dataset.swright : s.wrap.dataset.swleft;
      s.card.style.transform = ''; s.card.style.opacity = ''; s.wrap.classList.remove('left', 'right');
      if (far && act && A[act]) { if (navigator.vibrate) try { navigator.vibrate(8); } catch (x) { /* ok */ } A[act]({ dataset: { ...s.wrap.dataset } }); }
      return;
    }
    if (Math.abs(s.dx) > w * 0.38 || (v > 0.6 && Math.abs(s.dx) > 40)) {
      s.card.style.transform = 'translateX(' + (s.dx > 0 ? '115%' : '-115%') + ')'; s.card.style.opacity = '0';
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (x) { /* ok */ }
      setTimeout(() => {
        s.wrap.style.maxHeight = s.wrap.offsetHeight + 'px'; void s.wrap.offsetHeight; s.wrap.classList.add('gone');
        setTimeout(() => { const act = s.wrap.dataset.swact, ds = { ...s.wrap.dataset }; s.wrap.remove(); if (A[act]) A[act]({ dataset: ds }); }, 240);
      }, 170);
    } else { s.card.style.transform = ''; s.card.style.opacity = ''; s.wrap.classList.remove('left', 'right'); }
  };
  document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
})();

