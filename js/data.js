'use strict';
/* Sarvlekh data layer.
 *
 *  Backend  — talks to Supabase (cloud) or to localStorage (demo). Same interface for both.
 *  Store    — the in-memory, offline-first copy of ONE hostel's records.
 *
 *  Reads are always local (instant). Writes are applied locally first (optimistic), queued in an
 *  outbox that survives reloads, and flushed as ONE batched upsert. Sync pulls only rows changed
 *  since the last cursor, so a normal refresh costs a single small request.
 */
const CFG = window.HOSTELOS_CONFIG || {};
const CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const EMAIL_DOMAIN = CFG.AUTH_EMAIL_DOMAIN || 'login.hostelos.app';
// Old day-wise logs are not downloaded on first load (still kept in the database).
const ARCHIVE_KINDS = ['gate', 'skip', 'tiffin', 'hkt', 'hkf', 'served', 'ntf', 'log', 'laundry', 'leave', 'rinfo'];
const ARCHIVE_DAYS = 120;
// Name the columns instead of select=*: the app never uses the rest, and the SaaS billing
// columns on orgs are not granted to ordinary members at all, so select=* would be refused.
const ORG_COLS = 'id,name,status,modules,max_hostels,max_beds';
const HOSTEL_COLS = 'id,org_id,name,city,address,phone,status,settings,modules,blocks';

const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

class AppError extends Error { constructor(msg, extra = {}) { super(msg); Object.assign(this, extra); } }

/* The cached copy of a hostel's records lives in IndexedDB, not localStorage.
 * localStorage is a few MB (5 MB on iOS Safari) and, when it fills, the old code quietly
 * threw the whole cache away and reset the sync cursor — so every launch re-downloaded the
 * entire hostel. IndexedDB has no practical ceiling and stores structured data without a
 * JSON.stringify round trip. localStorage stays for the small keys (session, settings,
 * cursor-sized things) and is the fallback when IndexedDB is unavailable (private mode). */
const IDB = {
  p: null,
  open() {
    if (this.p) return this.p;
    this.p = new Promise((res, rej) => {
      if (!self.indexedDB) return rej(new Error('no indexeddb'));
      const r = indexedDB.open('hostelos', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('cache')) r.result.createObjectStore('cache'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('blocked'));
    }).catch(e => { this.p = null; throw e; });
    return this.p;
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('cache', mode), st = t.objectStore('cache');
      let out; const rq = fn(st);
      if (rq) rq.onsuccess = () => { out = rq.result; };
      t.oncomplete = () => res(out);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  async get(k, d = null) { try { const v = await this.tx('readonly', st => st.get(k)); return v === undefined ? d : v; } catch (e) { return LS.get(k, d); } },
  async set(k, v) { try { await this.tx('readwrite', st => st.put(v, k)); return true; } catch (e) { return LS.set(k, v); } },
  async del(k) { try { await this.tx('readwrite', st => st.delete(k)); } catch (e) { /* ignore */ } LS.del(k); },
  async keys() { try { return await this.tx('readonly', st => st.getAllKeys()) || []; } catch (e) { return []; } },
};

/* ===================================================================== cloud backend */
const Cloud = {
  session: LS.get('hostelos.session'),
  async http(url, opt = {}, retry = true) {
    let r;
    const headers = { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...(opt.headers || {}) };
    if (opt.auth !== false && this.session) headers.Authorization = 'Bearer ' + (await this.token());
    try { r = await fetch(url, { method: opt.method || 'GET', headers, body: opt.body === undefined ? undefined : JSON.stringify(opt.body) }); }
    catch (e) { throw new AppError('You are offline. Changes are saved on this phone and will sync automatically.', { offline: true }); }
    if (r.status === 401 && retry && this.session && opt.auth !== false) { await this.refresh(true); return this.http(url, opt, false); }
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!r.ok) {
      const msg = (data && (data.error_description || data.msg || data.message || data.error)) || `Request failed (${r.status})`;
      throw new AppError(/Invalid login/i.test(msg) ? 'Wrong username or password' : msg, { status: r.status, code: data && data.code });
    }
    return data;
  },
  rest(path, opt) { return this.http(`${CFG.SUPABASE_URL}/rest/v1/${path}`, opt); },
  saveSession(s) { this.session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), uid: s.user ? s.user.id : this.session && this.session.uid } : null; s ? LS.set('hostelos.session', this.session) : LS.del('hostelos.session'); },
  async login(username, password) {
    const s = await this.http(`${CFG.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', auth: false, body: { email: `${slug(username)}@${EMAIL_DOMAIN}`, password } });
    this.saveSession(s); return s.user.id;
  },
  refreshing: null,
  async refresh(force) {
    if (!this.session) throw new AppError('Please log in', { status: 401 });
    if (!force && this.session.expires_at - 60 > Date.now() / 1000) return;
    this.refreshing = this.refreshing || this.http(`${CFG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', auth: false, body: { refresh_token: this.session.refresh_token } })
      .then(s => this.saveSession(s))
      .catch(e => { if (e.status === 400 || e.status === 401) { this.saveSession(null); history.replaceState(null, '', '/'); location.reload(); } throw e; })
      .finally(() => { this.refreshing = null; });
    return this.refreshing;
  },
  async token() { await this.refresh(false); return this.session.access_token; },
  async logout() { try { await this.http(`${CFG.SUPABASE_URL}/auth/v1/logout`, { method: 'POST' }); } catch (e) { /* offline is fine */ } this.saveSession(null); },
  async changePassword(pw) { await this.http(`${CFG.SUPABASE_URL}/auth/v1/user`, { method: 'PUT', body: { password: pw } }); },
  uid() { return this.session && this.session.uid; },
  async loadMeta() {
    const uid = this.uid();
    const [prof, members, orgs, hostels] = await Promise.all([
      this.rest(`profiles?id=eq.${uid}&select=*`), this.rest(`members?user_id=eq.${uid}&active=eq.true&select=*`),
      this.rest(`orgs?select=${ORG_COLS}&order=name`), this.rest(`hostels?select=${HOSTEL_COLS}&order=name`),
    ]);
    if (!prof[0]) throw new AppError('Your account is not set up yet. Ask your admin.');
    return { me: prof[0], members, orgs, hostels };
  },
  async pull(hostelId, cursor) {
    const rows = [];
    let since = cursor ? new Date(new Date(cursor).getTime() - 2000).toISOString() : null;
    const archive = since ? '' : `&or=(day.is.null,day.gte.${addDays(today(), -ARCHIVE_DAYS)})`;
    for (let page = 0; page < 50; page++) {
      const q = `docs?hostel_id=eq.${hostelId}${since ? `&updated_at=gte.${encodeURIComponent(since)}` : ''}${archive}&order=updated_at.asc,id.asc&limit=1000`;
      const batch = await this.rest(q);
      rows.push(...batch);
      if (batch.length < 1000) break;
      since = batch[batch.length - 1].updated_at;
    }
    return rows;
  },
  async push(rows) {
    if (!rows.length) return;
    await this.rest('docs?on_conflict=hostel_id,id', { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  },
  saveHostel(id, patch) { return this.rest(`hostels?id=eq.${id}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=minimal' } }); },
  // Merged inside one statement in Postgres so simultaneous edits cannot overwrite each other.
  saveSettings(id, patch, replaceKeys = []) { return this.rpc('save_hostel_settings', { h: id, patch, replace_keys: replaceKeys }); },
  // status and modules belong to the platform admin, so the database refuses them on a plain
  // PATCH (hostels grants update on name, city, address and phone only).
  setHostelAdmin(id, patch) { return this.rpc('set_hostel_admin', { h: id, patch }); },
  async fn(path, action, payload = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.session) headers.Authorization = 'Bearer ' + (await this.token());
    let r; try { r = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ action, ...payload }) }); }
    catch (e) { throw new AppError('You are offline. Try again when connected.', { offline: true }); }
    // Our own refusals always come back as JSON. Anything else from a failed call means the
    // serverless function is not there at all — which is a deployment fact, not something the
    // person pressing the button can fix by pressing it again.
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : {}; } catch (e) { /* not ours */ }
    if (!r.ok) throw new AppError(data ? (data.error || 'Server error') : 'This needs the server, which is not running yet. It starts working once the app is deployed.');
    return data || {};
  },
  admin(action, payload) { return this.fn('/api/admin', action, payload); },
  waApi(action, payload) { return this.fn('/api/wa', action, payload); },
  // generic table access for super admin / owner user management
  list: (table, q = '') => Cloud.rest(`${table}?select=*${q}`),
  insert: (table, row) => Cloud.rest(table, { method: 'POST', body: row, headers: { Prefer: 'return=representation' } }).then(a => a[0]),
  update: (table, id, patch) => Cloud.rest(`${table}?id=eq.${id}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=minimal' } }),
  remove: (table, id) => Cloud.rest(`${table}?id=eq.${id}`, { method: 'DELETE' }),
  rpc: (fn, args = {}) => Cloud.rest(`rpc/${fn}`, { method: 'POST', body: args }),
};

/* ===================================================================== demo backend */
// A complete local imitation of the cloud backend so the app is fully usable without Supabase.
const DKEY = 'hostelos.demo.v2';
const Demo = {
  db: null,
  load() {
    if (this.db) return this.db;
    this.db = LS.get(DKEY);
    if (!this.db || this.db.v !== 2) { this.db = { v: 2, orgs: [], hostels: [], profiles: [], members: [], docs: {} }; this.seedMeta(); }
    return this.db;
  },
  save: debounce(function () { if (!LS.set(DKEY, Demo.db)) toast('Browser storage is full — export a backup in Settings.', 'bad'); }, 300),
  session: LS.get('hostelos.demo.session'),
  seedMeta() {
    const d = this.db, now = nowIso();
    const org = (id, name, owner, phone, city, modules = {}) => d.orgs.push({ id, name, owner_name: owner, phone, city, plan: 'standard', fee: 499, paid_till: addDays(today(), 20), status: 'active', modules, max_hostels: 3, max_beds: 300, created_at: now });
    const hostel = (id, org_id, name, city) => d.hostels.push({ id, org_id, name, city, address: city, status: 'active', settings: {}, created_at: now });
    org('org1', 'Sharma PG Group', 'Ramesh Sharma', '9876500001', 'Kota');
    org('org2', 'Green Valley Hostels', 'Anita Verma', '9876500002', 'Indore', { laundry: false });
    hostel('h1', 'org1', 'Sunrise Boys PG', 'Kota'); hostel('h2', 'org1', 'Sunrise Girls PG', 'Kota'); hostel('h3', 'org2', 'Green Valley Hostel', 'Indore');
    const user = (id, username, full_name, phone, password, is_super = false) => d.profiles.push({ id, username, full_name, phone, password, is_super, lang: 'en', active: true, created_at: now });
    const mem = (user_id, org_id, hostel_id, role, ref_id = null) => d.members.push({ id: uid('m'), user_id, org_id, hostel_id, role, perms: [], deny: [], ref_id, active: true, created_at: now });
    user('u0', 'admin', 'Platform Admin', '9000000000', 'admin123', true);
    user('u1', 'ramesh.sharma', 'Ramesh Sharma', '9876500001', '9876500001'); mem('u1', 'org1', null, 'owner');
    user('u2', 'anita.verma', 'Anita Verma', '9876500002', '9876500002'); mem('u2', 'org2', null, 'owner');
    user('u3', 'raju.cook', 'Raju Cook', '9876500003', '9876500003'); mem('u3', 'org1', 'h1', 'cook', 'st-cook');
    user('u4', 'sunita.hk', 'Sunita Devi', '9876500004', '9876500004'); mem('u4', 'org1', 'h1', 'housekeeping', 'st-hk1');
    user('u5', 'mohan.laundry', 'Mohan Lal', '9876500005', '9876500005'); mem('u5', 'org1', 'h1', 'laundry', 'st-ld');
    user('u6', 'gate.guard', 'Bahadur Singh', '9876500006', '9876500006'); mem('u6', 'org1', 'h1', 'guard', 'st-gd');
    user('u7', 'aman.gupta', 'Aman Gupta', '9812300001', '9812300001'); mem('u7', 'org1', 'h1', 'resident', 'res-1');
  },
  uid() { return this.session && this.session.uid; },
  async login(username, password) {
    const d = this.load(), p = d.profiles.find(x => x.username === slug(username));
    if (!p || p.password !== password) throw new AppError('Wrong username or password');
    if (!p.active) throw new AppError('Account disabled. Contact your PG owner.');
    this.session = { uid: p.id }; LS.set('hostelos.demo.session', this.session); return p.id;
  },
  async logout() { this.session = null; LS.del('hostelos.demo.session'); },
  async changePassword(pw) { const p = this.load().profiles.find(x => x.id === this.uid()); p.password = pw; this.save(); },
  async loadMeta() {
    const d = this.load(), me = d.profiles.find(p => p.id === this.uid());
    if (!me) throw new AppError('Please log in', { status: 401 });
    const members = d.members.filter(m => m.user_id === me.id && m.active);
    const orgIds = me.is_super ? d.orgs.map(o => o.id) : members.map(m => m.org_id);
    const orgs = d.orgs.filter(o => orgIds.includes(o.id));
    const hostels = d.hostels.filter(h => me.is_super || members.some(m => m.org_id === h.org_id && (!m.hostel_id || m.hostel_id === h.id)));
    return { me: clone(me), members: clone(members), orgs: clone(orgs), hostels: clone(hostels) };
  },
  async pull(hostelId, cursor) {
    const d = this.load();
    if (!d.docs[hostelId]) { d.docs[hostelId] = {}; if (Store.onEmptyHostel) Store.onEmptyHostel(hostelId); }
    return Object.values(d.docs[hostelId]).filter(r => !cursor || r.updated_at > cursor);
  },
  async push(rows) {
    const d = this.load(), ts = nowIso();
    for (const r of rows) { (d.docs[r.hostel_id] = d.docs[r.hostel_id] || {})[r.id] = { ...r, updated_at: ts }; }
    this.save();
  },
  async saveHostel(id, patch) { Object.assign(this.load().hostels.find(h => h.id === id), patch); this.save(); },
  // Mirrors set_hostel_admin: super admin only, and only these two fields, so demo mode
  // refuses exactly what the database refuses.
  async setHostelAdmin(id, patch) {
    const d = this.load(), me = d.profiles.find(p => p.id === this.uid());
    if (!me || !me.is_super) throw new AppError('Only the platform admin can change this');
    const bad = Object.keys(patch || {}).filter(k => !['status', 'modules', 'blocks'].includes(k));
    if (bad.length) throw new AppError('Only status, modules and blocks can be set here');
    if ('blocks' in patch && !Array.isArray(patch.blocks)) throw new AppError('blocks must be a list');
    const h = d.hostels.find(x => x.id === id); if (!h) throw new AppError('Hostel not found');
    if (patch.status) h.status = patch.status;
    if (patch.modules) h.modules = patch.modules;
    if (patch.blocks) h.blocks = patch.blocks;
    this.save();
    return { id: h.id, status: h.status, modules: clone(h.modules || {}), blocks: clone(h.blocks || []) };
  },
  async saveSettings(id, patch, replaceKeys = []) {
    const h = this.load().hostels.find(x => x.id === id); if (!h) return {};
    h.settings = deepMerge(h.settings || {}, patch);
    for (const k of replaceKeys || []) if (k in patch) h.settings[k] = patch[k];
    this.save();
    return clone(h.settings);
  },
  async admin(action, b) {
    const d = this.load(), me = d.profiles.find(p => p.id === this.uid());
    const mkUser = ({ full_name, phone, username, password, is_super }) => {
      if (!full_name) throw new AppError('Name is required');
      let base = slug(username || full_name), name = base, i = 1;
      while (d.profiles.some(p => p.username === name)) name = `${base}${++i}`;
      const pw = String(password || digits(phone));
      if (pw.length < 6) throw new AppError('Password must be at least 6 characters (default is the mobile number)');
      const p = { id: uid('u'), username: name, full_name, phone: digits(phone), password: pw, is_super: !!is_super, lang: 'en', active: true, created_at: nowIso() };
      d.profiles.push(p); return { user_id: p.id, username: name, password: pw };
    };
    const addMem = m => { const h = d.hostels.find(x => x.id === m.hostel_id); const blk = m.block && (h && h.blocks || []).some(b => b.k === m.block) ? m.block : null; const row = { id: uid('m'), user_id: m.user_id, org_id: m.org_id, hostel_id: m.hostel_id || null, role: m.role, perms: m.perms || [], deny: [], block: blk, ref_id: m.ref_id || null, active: true, created_at: nowIso() }; d.members.push(row); return row; };
    let out;
    if (action === 'create_org') {
      const org = { id: uid('o'), name: b.org.name, owner_name: b.owner.full_name, phone: digits(b.owner.phone), city: b.org.city, plan: b.org.plan || 'standard', fee: +b.org.fee || 0, paid_till: null, status: 'active', modules: b.org.modules || {}, max_hostels: +b.org.max_hostels || 3, max_beds: +b.org.max_beds || 300, created_at: nowIso() };
      d.orgs.push(org);
      const hostel = { id: uid('h'), org_id: org.id, name: b.hostel.name || org.name, city: b.hostel.city || org.city, address: b.hostel.address || '', status: 'active', settings: {}, created_at: nowIso() };
      d.hostels.push(hostel); d.docs[hostel.id] = {};
      const owner = mkUser(b.owner); addMem({ ...owner, org_id: org.id, role: 'owner' });
      out = { org, hostel, owner };
    } else if (action === 'create_user') { const u = mkUser(b); addMem({ ...b, user_id: u.user_id }); out = u; }
    else if (action === 'add_member') { const p = d.profiles.find(x => x.username === slug(b.username)); if (!p) throw new AppError('No user with that username'); addMem({ ...b, user_id: p.id }); out = { user_id: p.id, username: p.username }; }
    else if (action === 'set_username') {
      if (!me.is_super) throw new AppError('Super admin only');
      const want = String(b.username || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(want)) throw new AppError('A user ID is 3-30 characters: lowercase letters, numbers, dot, dash');
      if (d.profiles.some(x => x.username === want && x.id !== b.user_id)) throw new AppError('That user ID is already taken');
      const p = d.profiles.find(x => x.id === b.user_id); if (!p) throw new AppError('User not found');
      p.username = want; out = { username: want };
    }
    else if (action === 'set_password') { const p = d.profiles.find(x => x.id === b.user_id); if (String(b.password).length < 6) throw new AppError('Password must be at least 6 characters'); p.password = String(b.password); out = { ok: true }; }
    else if (action === 'set_active') { if (b.user_id === me.id) throw new AppError('You cannot disable yourself'); d.profiles.find(x => x.id === b.user_id).active = !!b.active; out = { ok: true }; }
    else if (action === 'delete_user') { if (!me.is_super) throw new AppError('Super admin only'); d.profiles = d.profiles.filter(x => x.id !== b.user_id); d.members = d.members.filter(x => x.user_id !== b.user_id); out = { ok: true }; }
    else throw new AppError('Unknown action');
    this.save(); return clone(out);
  },
  async list(table) { const rows = this.load()[table] || []; return clone(table === 'profiles' ? rows.map(({ password, ...p }) => p) : rows); },
  async insert(table, row) { const r = { id: uid(table[0]), created_at: nowIso(), ...row }; this.load()[table].push(r); this.save(); return clone(r); },
  async update(table, id, patch) { Object.assign(this.load()[table].find(x => x.id === id) || {}, patch); this.save(); },
  async remove(table, id) {
    const d = this.load();
    d[table] = d[table].filter(x => x.id !== id);
    if (table === 'orgs') { const hs = d.hostels.filter(h => h.org_id === id).map(h => h.id); d.hostels = d.hostels.filter(h => h.org_id !== id); hs.forEach(h => delete d.docs[h]); d.members = d.members.filter(m => m.org_id !== id); }
    if (table === 'hostels') { delete d.docs[id]; d.members = d.members.filter(m => m.hostel_id !== id); }
    this.save();
  },
  async rpc(fn) {
    const d = this.load();
    if (fn === 'admin_stats') return d.hostels.map(h => { const docs = Object.values(d.docs[h.id] || {}); return { hostel_id: h.id, residents: docs.filter(x => x.kind === 'res' && !x.deleted && x.data.status === 'active').length, rows: docs.length, last_activity: docs.reduce((m, x) => (x.updated_at > m ? x.updated_at : m), null) }; });
    if (fn === 'my_orgs_billing') return clone(d.orgs);
    if (fn === 'purge_old_logs') return [];
    if (fn === 'storage_breakdown') return [];
    if (fn === 'db_size_mb') return Math.round((JSON.stringify(d).length / 1048576) * 10) / 10;
    if (fn === 'db_usage') { const mb = Math.round((JSON.stringify(d).length / 1048576) * 10) / 10; return [{ total_mb: mb, data_mb: mb }]; }
    if (fn === 'purge_deleted') { let n = 0; for (const h in d.docs) for (const id in d.docs[h]) if (d.docs[h][id].deleted) { delete d.docs[h][id]; n++; } this.save(); return n; }
    return null;
  },
};

const Backend = CLOUD ? Cloud : Demo;

/* ===================================================================== store */
const Store = {
  me: null, members: [], orgs: [], hostels: [], ctx: null,
  /* `ver` goes up on every change to the local copy. Screens that would otherwise walk the
   * whole record set for each row — "what does this resident owe?" asked once per resident —
   * build an index once and keep it until this number moves. Without it a 100-resident list
   * is a hundred full scans of every invoice in the hostel on every single render. */
  ver: 0,
  docs: new Map(), byKind: new Map(), cursor: null, outbox: [], syncing: false, lastSync: null, online: navigator.onLine,
  onEmptyHostel: null, onChange: null,

  hostel() { return this.hostels.find(h => h.id === (this.ctx && this.ctx.hostelId)) || null; },
  org() { const h = this.hostel(); return this.orgs.find(o => o.id === (h ? h.org_id : this.ctx && this.ctx.orgId)) || null; },
  cacheKey() { return `hostelos.cache.${Backend.uid()}.${this.ctx.hostelId}`; },

  async loadMeta() {
    const cached = LS.get(`hostelos.meta.${Backend.uid()}`);
    const apply = m => { this.me = m.me; this.members = m.members; this.orgs = m.orgs; this.hostels = m.hostels; };
    if (cached) { apply(cached); this.refreshMeta().catch(() => {}); return; }
    await this.refreshMeta();
  },
  async refreshMeta() {
    const m = await Backend.loadMeta();
    this.me = m.me; this.members = m.members; this.orgs = m.orgs; this.hostels = m.hostels;
    LS.set(`hostelos.meta.${Backend.uid()}`, m);
    if (this.me.lang && this.me.lang !== LANG && !LS.get('hostelos.lang.local')) { setLang(this.me.lang); await ensureLang().catch(() => {}); }
    if (this.onChange) this.onChange('meta');
  },

  // Load a hostel: cached copy first (instant), then a delta sync in the background.
  async open(ctx) {
    await this.flush().catch(() => {});
    this.ctx = ctx; this.docs = new Map(); this.byKind = new Map(); this.cursor = null; this.outbox = []; this.ver++;
    if (!ctx.hostelId) return;
    const key = this.cacheKey();
    let c = await IDB.get(key);
    if (!c) {
      // one-time move of an existing localStorage cache. Copy first and only drop the old
      // copy once the new one is safely written, so a queued outbox can never fall through.
      const old = LS.get(key);
      if (old) { c = old; if (await IDB.set(key, old)) LS.del(key); }
    }
    if (c && c.v === 2) { for (const d of c.docs) this.docs.set(d.id, d); this.cursor = c.cursor; this.outbox = c.outbox || []; this.ver++; }
    if (this.prune()) this.persist();
    if (this.docs.size) { this.sync().catch(() => {}); } else { await this.sync(); }
  },

  /* Day-wise records (gate entries, cleaning tasks, meal skips…) are the volume: a 30-room
   * hostel makes tens of thousands a year. The first sync already refuses to download them
   * past ARCHIVE_DAYS, but delta sync kept adding new ones forever, so the local copy grew
   * without limit. Drop the same window locally — the rows stay in Postgres and come back
   * on demand. Anything still waiting in the outbox is never pruned. */
  prune() {
    const cut = addDays(today(), -ARCHIVE_DAYS);
    const pending = new Set(this.outbox.map(r => r.id));
    let n = 0;
    for (const [id, d] of this.docs) {
      if (pending.has(id)) continue;
      if (ARCHIVE_KINDS.includes(d.kind) && d.date && String(d.date).slice(0, 10) < cut) { this.docs.delete(id); n++; }
      else if (d._del && d._u && d._u < new Date(Date.now() - 7 * 864e5).toISOString()) { this.docs.delete(id); n++; }
    }
    if (n) this.byKind = new Map();
    return n;
  },

  persist: debounce(function () {
    if (!Store.ctx || !Store.ctx.hostelId) return;
    IDB.set(Store.cacheKey(), { v: 2, cursor: Store.cursor, docs: [...Store.docs.values()], outbox: Store.outbox })
      .then(ok => { if (!ok) console.warn('Could not cache this hostel locally; the app still works online.'); });
  }, 400),

  fromRow(r) { return { ...r.data, id: r.id, kind: r.kind, _u: r.updated_at, ...(r.deleted ? { _del: true } : {}) }; },
  toRow(d) {
    const { id, kind, _u, _del, ...data } = d;
    return { hostel_id: this.ctx.hostelId, id, kind, data, res_id: d.resId || null, room_id: d.roomId || (kind === 'room' ? id : null), day: ARCHIVE_KINDS.includes(kind) && d.date ? String(d.date).slice(0, 10) : null, deleted: !!_del };
  },

  async sync() {
    if (this.syncing || !this.ctx || !this.ctx.hostelId) return;
    this.syncing = true;
    const hostelId = this.ctx.hostelId;
    try {
      await this.flush();
      const rows = await Backend.pull(hostelId, this.cursor);
      if (!this.ctx || this.ctx.hostelId !== hostelId) return;
      const pending = new Set(this.outbox.map(r => r.id));
      let changed = 0;
      for (const r of rows) {
        if (pending.has(r.id)) continue; // our newer local edit wins until it is pushed
        const cur = this.docs.get(r.id);
        if (!cur || cur._u !== r.updated_at) { this.docs.set(r.id, this.fromRow(r)); changed++; }
        if (!this.cursor || r.updated_at > this.cursor) this.cursor = r.updated_at;
      }
      if (changed) { this.idleMisses = 0; this.prune(); this.byKind = new Map(); this.ver++; this.persist(); if (this.onChange) this.onChange('docs'); }
      else this.idleMisses++;
      this.lastSync = Date.now(); this.setOnline(true);
    } catch (e) {
      if (e.offline) this.setOnline(false); else throw e;
    } finally { this.syncing = false; }
  },

  async flush() {
    if (!this.outbox.length || this.flushing) return;
    this.flushing = true;
    try {
      while (this.outbox.length) {
        const batch = this.outbox.slice(0, 200);
        try { await Backend.push(batch); }
        catch (e) {
          if (e.offline || !e.status || e.status >= 500) throw e;
          // A row was refused (permission/validation). Push one by one so good rows still save.
          for (const row of batch) {
            try { await Backend.push([row]); }
            catch (e2) { if (e2.offline) throw e2; console.warn('Rejected', row.kind, row.id, e2.message); toast(t('Not allowed: {m}', { m: e2.message }), 'bad'); }
          }
        }
        const sent = new Set(batch);
        this.outbox = this.outbox.filter(r => !sent.has(r));
        this.persist();
      }
      this.setOnline(true);
    } catch (e) { if (e.offline) this.setOnline(false); else throw e; }
    finally { this.flushing = false; }
  },
  scheduleFlush: debounce(() => { Store.flush().catch(e => console.warn(e)); }, 500),

  /* How often to ask the server for changes.
   * A fixed 60 s poll is by far the largest running cost of this app: most polls return zero
   * rows, but every one still costs a request and its headers. Across a few hundred logged-in
   * phones that is gigabytes of egress a month spent learning that nothing happened.
   * So the interval backs off while a hostel is quiet and snaps back the moment anything
   * actually happens — a local edit, the app coming back to the foreground, or a sync that
   * did bring changes. Writes are never delayed by this; the outbox flushes immediately. */
  idleMisses: 0,
  POLL_MIN: 60e3,
  POLL_MAX: 300e3,
  // Residents are most of the logins (100 against a handful of staff) and rarely need news within a minute:
  // they poll three times slower. Coming back to the app still syncs at once (visibilitychange in app.js).
  RES_POLL_MIN: 180e3,
  RES_POLL_MAX: 600e3,
  pollDelay() {
    const res = typeof isResident === 'function' && !!this.ctx && isResident();
    const lo = res ? this.RES_POLL_MIN : this.POLL_MIN, hi = res ? this.RES_POLL_MAX : this.POLL_MAX;
    return Math.min(hi, lo * Math.pow(2, Math.min(this.idleMisses, 3)));
  },
  wake() { this.idleMisses = 0; },

  setOnline(on) { if (this.online !== on) { this.online = on; if (this.onChange) this.onChange('online'); } },

  /* ---- reads (local, synchronous) ---- */
  all(kind) {
    let a = this.byKind.get(kind);
    if (!a) { a = []; for (const d of this.docs.values()) if (d.kind === kind && !d._del) a.push(d); this.byKind.set(kind, a); }
    return a;
  },
  get(id) { const d = this.docs.get(id); return d && !d._del ? d : null; },

  /* ---- writes (optimistic) ---- */
  put(kind, obj) {
    if (!obj.id) obj.id = uid(kind + '-');
    obj.kind = kind;
    obj._u = obj._u || nowIso();
    delete obj._del;
    this.docs.set(obj.id, obj);
    this.byKind.delete(kind); this.ver++;
    const row = this.toRow(obj);
    this.outbox = this.outbox.filter(r => r.id !== row.id); this.outbox.push(row);
    this.wake(); this.persist(); this.scheduleFlush();
    return obj;
  },
  patch(id, partial) { const d = this.get(id); if (!d) return null; Object.assign(d, partial); return this.put(d.kind, d); },
  remove(id) {
    const d = this.docs.get(id); if (!d) return;
    d._del = true; this.byKind.delete(d.kind); this.ver++;
    const row = this.toRow(d);
    this.outbox = this.outbox.filter(r => r.id !== row.id); this.outbox.push(row);
    this.wake(); this.persist(); this.scheduleFlush();
  },

  /* ---- hostel settings ----
   * Merging happens in the database (save_hostel_settings), not here. Reading the whole
   * settings object, merging locally and writing it all back loses the other person's edit
   * whenever two admins save two different settings screens at the same time.
   * The server returns the merged result, which is what we then cache. */
  async saveSettings(patch, replaceKeys = []) {
    const h = this.hostel(); if (!h) return;
    h.settings = await Backend.saveSettings(h.id, patch, replaceKeys);
    _setCache = { src: null, val: null };
    LS.set(`hostelos.meta.${Backend.uid()}`, { me: this.me, members: this.members, orgs: this.orgs, hostels: this.hostels });
  },
  // Lists (meals, expense categories…) must replace rather than merge, or removed entries return.
  replaceSettingsKey(key, value) { return this.saveSettings({ [key]: value }, [key]); },

  async logout() {
    await this.flush().catch(() => {});
    const uidv = Backend.uid();
    await Backend.logout();
    try { Object.keys(localStorage).filter(k => k.startsWith(`hostelos.cache.${uidv}`) || k.startsWith(`hostelos.meta.${uidv}`)).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
    try { for (const k of await IDB.keys()) if (String(k).startsWith(`hostelos.cache.${uidv}`)) await IDB.del(k); } catch (e) { /* ignore */ }
    this.me = null; this.ctx = null; this.docs = new Map(); this.byKind = new Map(); this.outbox = [];
  },
};

window.addEventListener('online', () => { Store.setOnline(true); Store.sync().catch(() => {}); });
window.addEventListener('offline', () => Store.setOnline(false));

/* ===================================================================== documents
 * ID papers — Aadhaar, the person's photo, the two police-verification papers — live in the
 * private `docs` bucket of Supabase Storage, one folder per hostel:
 *   docs/<hostel id>/<res|staff>/<record id>/<type>-<random>.<ext>
 * This device compresses each image (≈100–150 KB) and uploads it itself; storage RLS lets
 * only that hostel's owner and manager write or read there, so nothing passes through our
 * server. A record keeps { type, path, ts }, and opening a paper mints a link that works for
 * ten minutes. Nobody deletes from here: the daily sweep removes papers 30 days after a
 * checkout, and any file no record points at any more (a replaced paper, say).
 */
const DOC_BUCKET = 'docs';
const DOC_MAX = 3 * 1024 * 1024;   // = the bucket's own limit
const DOC_KEEP_DAYS = 30;          // = doc_files_garbage() in schema.sql
const Files = {
  ready: () => CLOUD,

  async upload(file, kind, ownerId, type) {
    if (!CLOUD) throw new AppError('Documents need the cloud version. In demo mode nothing is uploaded.');
    const hostelId = (Store.ctx || {}).hostelId;
    if (!hostelId) throw new AppError('Open a hostel first');
    if (!/^[\w-]{1,64}$/.test(String(ownerId || ''))) throw new AppError('Save the record first');
    const pdf = !!file && file.type === 'application/pdf';
    if (!file || !(pdf || /^image\//.test(file.type))) throw new AppError('Upload a photo or a PDF');
    // a face needs far fewer pixels than the small print on an ID card
    const f = pdf ? file : await compressImage(file, /photo/i.test(type) ? 600 : 1280);
    if (f.size > DOC_MAX) throw new AppError(pdf ? 'PDF is too large (max 3 MB). Upload a photo of it instead.' : 'Photo is too large (max 3 MB)');
    const ext = { 'application/pdf': 'pdf', 'image/webp': 'webp', 'image/png': 'png' }[f.type] || 'jpg';
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('');
    const path = `${hostelId}/${kind}/${ownerId}/${slug(type).replace(/\./g, '-')}-${rand}.${ext}`;
    await this.put(path, f);
    return { type, path, ts: nowIso() };
  },

  async put(path, body, retry = true) {
    let r;
    try {
      r = await fetch(`${CFG.SUPABASE_URL}/storage/v1/object/${DOC_BUCKET}/${path}`, {
        method: 'POST', body,
        headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (await Cloud.token()), 'Content-Type': body.type || 'application/octet-stream', 'x-upsert': 'false' },
      });
    } catch (e) { throw new AppError('Upload failed — check your internet connection.', { offline: true }); }
    if (r.status === 401 && retry) { await Cloud.refresh(true); return this.put(path, body, false); }
    if (r.ok) return;
    const d = await r.json().catch(() => ({}));
    const msg = String(d.message || d.error || '');
    if (r.status === 413 || /too large|size/i.test(msg)) throw new AppError('File is too large (max 3 MB)');
    if (r.status === 403 || /security|unauthori/i.test(msg)) throw new AppError('Only the owner or manager can upload documents');
    if (r.status === 415 || /mime/i.test(msg)) throw new AppError('Upload a photo or a PDF');
    throw new AppError(`Upload failed (${r.status}). Please try again.`);
  },

  async url(path) {
    if (!CLOUD) throw new AppError('Documents need the cloud version.');
    try {
      const d = await Cloud.http(`${CFG.SUPABASE_URL}/storage/v1/object/sign/${DOC_BUCKET}/${path}`, { method: 'POST', body: { expiresIn: 600 } });
      return `${CFG.SUPABASE_URL}/storage/v1${d.signedURL || d.signedUrl}`;
    } catch (e) {
      if (e.offline) throw e;
      throw new AppError(/not.?found/i.test(e.message) || e.status === 404 ? 'This document is no longer on file' : e.message);
    }
  },
};
