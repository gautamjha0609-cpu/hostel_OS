// Sarvlekh — privileged user management (Vercel Serverless Function, Node 18+, no dependencies).
// Only this endpoint holds the Supabase service-role key. Everything else talks to Supabase
// directly from the browser under row-level security.
//
// POST /api/admin  { action, ...payload }   Authorization: Bearer <user access token>
//   setup        { key, full_name, username, password }        first super admin (needs SETUP_KEY)
//   create_org   { org:{...}, hostel:{...}, owner:{full_name, phone, username?, password?} }   super
//   create_user  { full_name, phone, username?, password?, org_id, hostel_id?, role, ref_id?, perms?, block? }
//   add_member   { username, org_id, hostel_id?, role, ref_id?, perms?, block? }   existing login, new role
//   set_username { user_id, username }                          super admin only
//   set_password { user_id, password }
//   set_active   { user_id, active }
//   delete_user  { user_id }                                    super
//   sweep_files  {}                                             super — run the document clean-up now
//
// GET /api/admin?cron=sweep   Authorization: Bearer <CRON_SECRET>   the same clean-up, daily (vercel.json)

const crypto = require('crypto');
const { URL_, KEY, HttpError, sb, rest, uuid, optUuid, caller, limit, clientIp, readJson } = require('./_lib.js');

const DOMAIN = process.env.AUTH_EMAIL_DOMAIN || 'login.hostelos.app';
const ROLES = ['owner', 'manager', 'accountant', 'cook', 'housekeeping', 'laundry', 'guard', 'staff', 'resident'];

const insert = (table, row) => rest(table, '', { method: 'POST', body: row, headers: { Prefer: 'return=representation' } }).then(a => a[0]);
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 30) || 'user';
const digits = s => String(s || '').replace(/\D/g, '');

// Owner/manager of the org, or super admin. Returns the hostel_id the caller is allowed to
// write — an admin scoped to one hostel may NOT create org-wide (hostel_id null) memberships,
// which would hand the new login every hostel in the org.
// The hostel must also belong to that org: otherwise an owner of org A could write a
// membership row naming org B's hostel, which hostelAccess() in _lib.js would then honour.
async function assertAdmin(me, orgId, hostelId) {
  const want = optUuid(hostelId, 'hostel');
  if (want) {
    const [h] = await rest('hostels', `?id=eq.${want}&select=org_id`);
    if (!h || h.org_id !== uuid(orgId, 'client')) throw new HttpError(403, 'Not allowed for this hostel');
  }
  if (me.isSuper) return want;
  uuid(orgId, 'client');
  const mine = me.members.filter(m => m.org_id === orgId && ['owner', 'manager'].includes(m.role));
  if (!mine.length) throw new HttpError(403, 'Not allowed for this hostel');
  if (mine.some(m => !m.hostel_id)) return want;   // org-wide admin
  if (!want) throw new HttpError(403, 'Choose a hostel — you manage only specific hostels');
  if (!mine.some(m => m.hostel_id === want)) throw new HttpError(403, 'Not allowed for this hostel');
  return want;
}

async function uniqueUsername(base) {
  let name = slug(base);
  for (let i = 0; i < 50; i++) {
    const tryName = i === 0 ? name : `${name}${i + 1}`;
    const hit = await rest('profiles', `?username=eq.${encodeURIComponent(tryName)}&select=id`);
    if (!hit.length) return tryName;
  }
  throw new HttpError(400, 'Could not find a free username');
}

async function makeUser({ full_name, phone, username, password, isSuper = false }) {
  if (!full_name) throw new HttpError(400, 'Name is required');
  const uname = await uniqueUsername(username || full_name);
  const pw = String(password || digits(phone));
  if (pw.length < 6) throw new HttpError(400, 'Password must be at least 6 characters (default is the mobile number)');
  const u = await sb('/auth/v1/admin/users', {
    method: 'POST',
    body: { email: `${uname}@${DOMAIN}`, password: pw, email_confirm: true, user_metadata: { username: uname, full_name } },
  });
  try {
    await insert('profiles', { id: u.id, username: uname, full_name, phone: digits(phone) || null, is_super: isSuper });
  } catch (e) {
    await sb(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' }).catch(() => {});
    throw e;
  }
  return { user_id: u.id, username: uname, password: pw };
}

// Only these module keys may be granted as extra permissions.
const MODULE_KEYS = ['home', 'inbox', 'rooms', 'residents', 'payments', 'electricity', 'mess', 'kitchen',
  'housekeeping', 'laundry', 'attendance', 'gate', 'complaints', 'staff', 'expenses', 'notices', 'reports',
  'automation', 'landing', 'settings', 'finance', 'receive'];

// `block` ties this login to one wing of the hostel. It is a plain label, checked against the
// blocks the platform admin created rather than trusted from the browser, so a tampered
// request cannot invent a block and end up seeing nothing — or everything.
async function addMembership({ user_id, org_id, hostel_id, role, ref_id, perms, block }) {
  if (!ROLES.includes(role)) throw new HttpError(400, 'Unknown role');
  const clean = (Array.isArray(perms) ? perms : []).filter(p => MODULE_KEYS.includes(p));
  let blk = null;
  if (block && hostel_id) {
    const [h] = await rest('hostels', `?id=eq.${uuid(hostel_id, 'hostel')}&select=blocks`);
    if ((h && h.blocks || []).some(b => b.k === block)) blk = String(block);
  }
  return insert('members', {
    user_id: uuid(user_id, 'user'), org_id: uuid(org_id, 'client'), hostel_id: hostel_id || null, role,
    ref_id: ref_id ? String(ref_id).slice(0, 64) : null, perms: clean, block: blk,
  });
}

/* The caller must administer EVERY membership the target holds (or be super). Checking only
 * "some" let the owner of org B reset the password of someone who is also a manager in org A,
 * and so log in as them there. A hostel-scoped manager covers only their own hostels, and
 * another manager's login is the owner's to reset, not a peer's. */
async function assertCanManageUser(me, userId) {
  uuid(userId, 'user');
  if (me.isSuper) return;
  if (userId === me.id) return;
  const [[p], ms] = await Promise.all([
    rest('profiles', `?id=eq.${userId}&select=is_super`),
    rest('members', `?user_id=eq.${userId}&select=org_id,hostel_id,role`),
  ]);
  if (p && p.is_super) throw new HttpError(403, 'Not allowed for this user');
  const admin = me.members.filter(m => ['owner', 'manager'].includes(m.role));
  const covers = t => admin.some(a => a.org_id === t.org_id && (!a.hostel_id || a.hostel_id === t.hostel_id)
    && (t.role !== 'manager' || a.role === 'owner'));
  if (!ms.length || ms.some(m => m.role === 'owner') || !ms.every(covers)) throw new HttpError(403, 'Not allowed for this user');
}

const actions = {
  async setup(b) {
    const want = process.env.SETUP_KEY || '', got = String(b.key || '');
    if (!want || want.length !== got.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got))) throw new HttpError(403, 'Wrong setup key');
    const supers = await rest('profiles', '?is_super=eq.true&select=id');
    if (supers.length) throw new HttpError(400, 'Super admin already exists');
    return makeUser({ full_name: b.full_name, username: b.username, password: b.password, isSuper: true });
  },

  async create_org(b, me) {
    if (!me.isSuper) throw new HttpError(403, 'Super admin only');
    const o = b.org || {};
    if (!o.name) throw new HttpError(400, 'Client name is required');
    const org = await insert('orgs', { name: o.name, owner_name: b.owner?.full_name, phone: digits(b.owner?.phone), city: o.city, plan: o.plan || 'standard', fee: +o.fee || 0, modules: o.modules || {}, max_hostels: +o.max_hostels || 3, max_beds: +o.max_beds || 300 });
    let owner = null;
    try {
      const hostel = await insert('hostels', { org_id: org.id, name: b.hostel?.name || o.name, city: b.hostel?.city || o.city, address: b.hostel?.address, settings: b.hostel?.settings || {} });
      owner = await makeUser({ full_name: b.owner?.full_name || o.name, phone: b.owner?.phone, username: b.owner?.username, password: b.owner?.password });
      await addMembership({ user_id: owner.user_id, org_id: org.id, hostel_id: null, role: 'owner' });
      return { org, hostel, owner };
    } catch (e) {
      // undo everything made so far, login included, so a retry starts clean and no orphan
      // account keeps the username
      if (owner) await sb(`/auth/v1/admin/users/${owner.user_id}`, { method: 'DELETE' }).catch(() => {});
      await rest('orgs', `?id=eq.${org.id}`, { method: 'DELETE' }).catch(() => {});
      throw e;
    }
  },

  async create_user(b, me) {
    const hostel_id = await assertAdmin(me, b.org_id, b.hostel_id);
    if (b.role === 'owner' && !me.isSuper) throw new HttpError(403, 'Only super admin can add owners');
    const u = await makeUser(b);
    // explicit fields only — never spread the request body into a membership row
    try { await addMembership({ user_id: u.user_id, org_id: b.org_id, hostel_id, role: b.role, ref_id: b.ref_id, perms: b.perms, block: b.block }); }
    catch (e) { await sb(`/auth/v1/admin/users/${u.user_id}`, { method: 'DELETE' }).catch(() => {}); throw e; }   // no login without a role
    return u;
  },

  async add_member(b, me) {
    const hostel_id = await assertAdmin(me, b.org_id, b.hostel_id);
    if (b.role === 'owner' && !me.isSuper) throw new HttpError(403, 'Only super admin can add owners');
    const [p] = await rest('profiles', `?username=eq.${encodeURIComponent(slug(b.username))}&select=id,username`);
    if (!p) throw new HttpError(404, 'No user with that username');
    await addMembership({ user_id: p.id, org_id: b.org_id, hostel_id, role: b.role, ref_id: b.ref_id, perms: b.perms, block: b.block });
    return { user_id: p.id, username: p.username };
  },

  /* Changing someone's user ID.
   * The ID is half of how a person logs in, and the login itself is an email built from it,
   * so the two have to move together: profiles.username is what the app shows and what
   * add_member looks up, while auth.users.email is what the password check actually matches.
   * Renaming one without the other leaves an account that looks right and cannot log in.
   * Super admin only — an owner renaming their own staff would break logins already handed
   * out, and the owner has no way to see the auth side of it. */
  async set_username(b, me) {
    if (!me.isSuper) throw new HttpError(403, 'Super admin only');
    uuid(b.user_id, 'user');
    // Trimmed and lowercased, then checked as typed. Not slug()-ed: slug would quietly turn
    // "-my id-" into "my.id" and hand back an ID nobody asked for, which for the thing a
    // person types to log in is worse than refusing it.
    const want = String(b.username || '').trim().toLowerCase();
    // Only what slug() leaves alone: the login screen runs whatever is typed through slug() to build the sign-in
    // email, so an ID with a dash or underscore ("ravi-kumar") would be stored as one email and looked up as another.
    if (!/^(?=.{3,30}$)[a-z0-9]+(\.[a-z0-9]+)*$/.test(want) || slug(want) !== want) throw new HttpError(400, 'A user ID is 3–30 characters: lowercase letters and numbers, with a single dot between parts (like ravi.kumar)');
    const [taken] = await rest('profiles', `?username=eq.${encodeURIComponent(want)}&select=id`);
    if (taken && taken.id !== b.user_id) throw new HttpError(409, 'That user ID is already taken');
    if (taken && taken.id === b.user_id) return { username: want };
    // auth first: if it fails nothing has changed, and the old ID still works.
    await sb(`/auth/v1/admin/users/${b.user_id}`, { method: 'PUT', body: { email: `${want}@${DOMAIN}`, email_confirm: true } });
    await rest('profiles', `?id=eq.${b.user_id}`, { method: 'PATCH', body: { username: want } });
    return { username: want };
  },

  async set_password(b, me) {
    await assertCanManageUser(me, b.user_id);
    if (String(b.password || '').length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    await sb(`/auth/v1/admin/users/${b.user_id}`, { method: 'PUT', body: { password: String(b.password) } });
    return { ok: true };
  },

  async set_active(b, me) {
    await assertCanManageUser(me, b.user_id);
    if (b.user_id === me.id) throw new HttpError(400, 'You cannot disable yourself');
    // profiles.active is what every RLS check reads, so flip it first: if the ban call then
    // fails the account is already locked out rather than left half-enabled.
    await rest('profiles', `?id=eq.${b.user_id}`, { method: 'PATCH', body: { active: !!b.active } });
    await sb(`/auth/v1/admin/users/${b.user_id}`, { method: 'PUT', body: { ban_duration: b.active ? 'none' : '876000h' } });
    return { ok: true };
  },

  async delete_user(b, me) {
    if (!me.isSuper) throw new HttpError(403, 'Super admin only');
    uuid(b.user_id, 'user');
    if (b.user_id === me.id) throw new HttpError(400, 'You cannot delete yourself');
    await sb(`/auth/v1/admin/users/${b.user_id}`, { method: 'DELETE' });
    return { ok: true };
  },

  async sweep_files(b, me) {
    if (!me.isSuper) throw new HttpError(403, 'Super admin only');
    return sweepFiles();
  },

  // Backups for the platform admin: what exists, make one now, and a short-lived link to download one.
  async backup_list(b, me) {
    if (!me.isSuper) throw new HttpError(403, 'Super admin only');
    return rest('rpc/backup_files', '', { method: 'POST', body: {} });
  },
  async backup_now(b, me) {
    if (!me.isSuper) throw new HttpError(403, 'Super admin only');
    const r = await backupOne(uuid(b.hostel_id, 'hostel'));
    await pruneBackups().catch(() => {});
    return r;
  },
  async drive_status(b, me) {
    if (!me.isSuper) throw new HttpError(403, 'Super admin only');
    const l = await driveLink();
    return { configured: !!(G_ID && G_SECRET), connected: !!l, email: l && l.email, encrypted: !!process.env.BACKUP_PASSPHRASE };
  },
  async drive_connect(b, me, req) {
    if (!me.isSuper) throw new HttpError(403, 'Super admin only');
    if (!G_ID || !G_SECRET) throw new HttpError(400, 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server first');
    const p = new URLSearchParams({ client_id: G_ID, redirect_uri: gRedirect(req), response_type: 'code', scope: G_SCOPE, access_type: 'offline', prompt: 'consent', state: signState(me.id, Date.now() + 10 * 60e3) });
    return { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + p };
  },
  async drive_disconnect(b, me) {
    if (!me.isSuper) throw new HttpError(403, 'Super admin only');
    const l = await driveLink();
    if (l) await gfetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: l.refresh_token }) }).catch(() => {});
    await rest('drive_link', '?id=eq.1', { method: 'DELETE' });
    G_TOK = null;
    return { ok: true };
  },
  async backup_url(b, me) {
    if (!me.isSuper) throw new HttpError(403, 'Super admin only');
    const name = String(b.name || '');
    if (!BACKUP_NAME.test(name)) throw new HttpError(400, 'Invalid backup');
    const r = await sb(`/storage/v1/object/sign/backups/${name}`, { method: 'POST', body: { expiresIn: 120 } });
    if (!r || !r.signedURL) throw new HttpError(502, 'Could not make a download link');
    return { url: `${URL_}/storage/v1${r.signedURL}${r.signedURL.includes('?') ? '&' : '?'}download=${encodeURIComponent(name.replace('/', '_'))}` };
  },
};

/* ---------------------------------------------------------------- document clean-up
 * ID papers are deleted 30 days after a resident checks out or a staff member is removed, and
 * so is anything no record points at any more (a replaced paper, an abandoned upload). Which
 * files those are is decided in the database by doc_files_garbage(); the files themselves can
 * only be removed through the Storage API, 1000 at a time. Capped per run so a big backlog
 * spreads over a few days instead of timing the function out.
 */
async function sweepFiles(batches = 5) {
  let removed = 0;
  for (let i = 0; i < batches; i++) {
    const names = await rest('rpc/doc_files_garbage', '', { method: 'POST', body: { lim: 1000 } });
    if (!names || !names.length) break;
    await sb('/storage/v1/object/docs', { method: 'DELETE', body: { prefixes: names } });
    removed += names.length;
    if (names.length < 1000) break;
  }
  return { removed };
}

/* ---------------------------------------------------------------- weekly backup
 * Supabase's free plan keeps no backups, so the daily cron writes one gzip file per hostel (its row,
 * its logins' roles and every record) to the private "backups" bucket, once a week per hostel. A
 * function may run only ~10 s, so each run does the hostels that are due until its time budget is
 * used and leaves the rest for the next day; four files per hostel are kept. A file is written only
 * when complete. Restore: scripts/restore.js.
 */
const zlib = require('zlib');
const BACKUP_BUDGET_MS = 6500;
async function putBackup(name, buf) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${URL_}/storage/v1/object/backups/${name}`, { method: 'POST', signal: ctl.signal, body: buf,
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/gzip', 'x-upsert': 'true' } });
    if (!r.ok) throw new HttpError(502, 'Backup upload failed: ' + r.status);
  } catch (e) { throw e instanceof HttpError ? e : new HttpError(504, 'Backup upload failed'); } finally { clearTimeout(timer); }
}
// One hostel, one file per day: a second run on the same day replaces that day's file (x-upsert), so
// pressing the button twice never leaves two copies.
async function backupOne(id, started = Date.now()) {
  uuid(id, 'hostel');
  const [hostel] = await rest('hostels', `?id=eq.${id}&select=*`);
  if (!hostel) throw new HttpError(404, 'Hostel not found');
  // the hostel's own logins and its org-wide ones (an owner has no single hostel)
  const members = await rest('members', `?or=(hostel_id.eq.${id},and(hostel_id.is.null,org_id.eq.${uuid(hostel.org_id, 'client')}))&select=user_id,org_id,hostel_id,role,ref_id,perms,deny,block,active`);
  const docs = [];
  for (let off = 0; ; off += 1000) {
    if (Date.now() - started > BACKUP_BUDGET_MS + 1500) throw new HttpError(504, 'out of time');
    const page = await rest('docs', `?hostel_id=eq.${id}&select=*&order=id.asc&limit=1000&offset=${off}`);
    docs.push(...page);
    if (page.length < 1000) break;
  }
  const name = `${id}/${new Date().toISOString().slice(0, 10)}.json.gz`;
  const gz = zlib.gzipSync(JSON.stringify({ v: 1, at: new Date().toISOString(), hostel, members, docs }));
  await putBackup(name, gz);
  let drive = null;
  try { drive = await driveCopy(hostel, name.slice(37, 47), gz); } catch (e) { drive = e.message; }   // a Drive problem never loses the backup above
  return { name, records: docs.length, drive };
}
async function pruneBackups() {
  const old = await rest('rpc/backup_old', '', { method: 'POST', body: { keep: 4 } });
  if (old && old.length) await sb('/storage/v1/object/backups', { method: 'DELETE', body: { prefixes: old } });
  return old ? old.length : 0;
}
async function backupHostels(started = Date.now()) {
  const due = await rest('rpc/backup_due', '', { method: 'POST', body: { days: 7 } });
  let done = 0, left = 0;
  for (const id of due || []) {
    if (Date.now() - started > BACKUP_BUDGET_MS) { left++; continue; }
    try { await backupOne(id, started); done++; } catch (e) { left++; }
  }
  return { backed_up: done, waiting: left, pruned: done ? await pruneBackups() : 0 };
}
/* ---------------------------------------------------------------- Google Drive copy
 * The platform admin links their own Drive once (Usage -> Backups -> Connect Google Drive). Google asks them to
 * allow it, we keep the refresh token in drive_link (a table nobody but this server can read) and every weekly
 * backup is then also written into a "Sarvlekh Backups" folder there. Scope drive.file: the app sees only the
 * folder and files it made itself, never the rest of the Drive. Files are encrypted with BACKUP_PASSPHRASE
 * when it is set, so a leaked Drive does not leak residents' names and phone numbers.
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET come from the environment, never from the browser or the repo.
 */
const G_ID = process.env.GOOGLE_CLIENT_ID || '', G_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const G_SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
async function gfetch(url, opt = {}, timeout = 8000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  try { return await fetch(url, { ...opt, signal: ctl.signal }); }
  catch (e) { throw new HttpError(504, 'Google took too long to answer'); }
  finally { clearTimeout(timer); }
}
const gRedirect = req => process.env.GOOGLE_REDIRECT_URI || `${String(req.headers['x-forwarded-proto'] || 'https').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}/api/admin?oauth=callback`;
// The "state" Google hands back proves the browser that returns is the super admin who clicked Connect.
const signState = (uid, exp) => `${uid}.${exp}.${crypto.createHmac('sha256', G_SECRET).update(`${uid}.${exp}`).digest('hex')}`;
function checkState(s) {
  const [uid, exp, sig] = String(s || '').split('.');
  const want = crypto.createHmac('sha256', G_SECRET).update(`${uid}.${exp}`).digest('hex');
  if (!uid || !sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) || +exp < Date.now()) throw new HttpError(400, 'This link has expired. Press Connect Google Drive again.');
  return uid;
}
const driveLink = async () => (await rest('drive_link', '?id=eq.1&select=*'))[0] || null;
let G_TOK = null;
async function gAccess(link) {
  if (G_TOK && G_TOK.exp > Date.now() + 30e3) return G_TOK.token;
  const r = await gfetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: G_ID, client_secret: G_SECRET, refresh_token: link.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new HttpError(502, j.error === 'invalid_grant' ? 'Google Drive access was withdrawn. Connect it again.' : 'Could not sign in to Google Drive');
  G_TOK = { token: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 };
  return G_TOK.token;
}
const gjson = async (r, what) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new HttpError(502, `Google Drive: ${what} failed (${(j.error && j.error.message) || r.status})`); return j; };
function seal(buf) {
  const pass = process.env.BACKUP_PASSPHRASE;
  if (!pass) return { buf, enc: false };
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(pass, salt, 32), iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return { buf: Buffer.concat([Buffer.from('SLK1'), salt, iv, c.getAuthTag(), ct]), enc: true };   // restore.js reads this layout
}
// One file per hostel per day, replaced when written again the same day.
async function driveUpload(link, name, data) {
  const tok = await gAccess(link), auth = { Authorization: 'Bearer ' + tok };
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${link.folder_id}' in parents and trashed=false`);
  const found = await gjson(await gfetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: auth }), 'search');
  if (found.files && found.files[0]) {
    return gjson(await gfetch(`https://www.googleapis.com/upload/drive/v3/files/${found.files[0].id}?uploadType=media`, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: data }, 9000), 'update');
  }
  const b = 'slk' + crypto.randomBytes(8).toString('hex');
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [link.folder_id] })}\r\n--${b}\r\nContent-Type: application/octet-stream\r\n\r\n`), data, Buffer.from(`\r\n--${b}--`)]);
  return gjson(await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { ...auth, 'Content-Type': `multipart/related; boundary=${b}` }, body }, 9000), 'upload');
}
async function driveCopy(hostel, day, gz) {
  if (!G_ID || !G_SECRET) return null;
  const link = await driveLink();
  if (!link) return null;
  const s = seal(gz), nm = String(hostel.name || 'hostel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  await driveUpload(link, `${nm}-${hostel.id.slice(0, 8)}-${day}.json.gz${s.enc ? '.enc' : ''}`, s.buf);
  return true;
}
async function driveCallback(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const back = msg => { res.statusCode = 302; res.setHeader('Location', `/admin-usage?drive=${encodeURIComponent(msg)}`); res.end(); };
  if (q.get('error')) return back('cancelled');
  if (!G_ID || !G_SECRET) throw new HttpError(500, 'Google is not configured on the server');
  checkState(q.get('state'));
  const r = await gfetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: String(q.get('code') || ''), client_id: G_ID, client_secret: G_SECRET, redirect_uri: gRedirect(req), grant_type: 'authorization_code' }) });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw new HttpError(400, 'Google did not accept the sign-in. Try again.');
  if (!t.refresh_token) throw new HttpError(400, 'Google sent no long-lived access. Remove Sarvlekh at myaccount.google.com/permissions and connect again.');
  const auth = { Authorization: 'Bearer ' + t.access_token };
  const me = await gfetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: auth }).then(x => x.json()).catch(() => ({}));
  const folder = await gjson(await gfetch('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Sarvlekh Backups', mimeType: 'application/vnd.google-apps.folder' }) }), 'create folder');
  await rest('drive_link?on_conflict=id', { method: 'POST', body: { id: 1, refresh_token: t.refresh_token, email: me.email || null, folder_id: folder.id }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  G_TOK = null;
  back('connected');
}
const BACKUP_NAME =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\d{4}-\d{2}-\d{2}\.json\.gz$/i;
const cronOk = req => {
  const want = process.env.CRON_SECRET || '';
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return !!want && want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!URL_ || !KEY) throw new HttpError(500, 'Server is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    if (req.method === 'GET' && new URL(req.url, 'http://x').searchParams.get('cron') === 'sweep') {
      if (!cronOk(req)) throw new HttpError(401, 'Not allowed');
      const t0 = Date.now(), out = await sweepFiles();
      try { out.backup = await backupHostels(t0); } catch (e) { out.backup = { error: e.message }; }   // a failed backup must not hide the sweep
      return res.status(200).json(out);
    }
    if (req.method === 'GET' && new URL(req.url, 'http://x').searchParams.get('oauth') === 'callback') { try { return await driveCallback(req, res); } catch (e) { res.statusCode = 302; res.setHeader('Location', '/admin-usage?drive=' + encodeURIComponent('error: ' + (e.status ? e.message : 'Server error'))); return res.end(); } }
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const b = await readJson(req);
    const fn = actions[b.action];
    if (!fn) throw new HttpError(400, 'Unknown action');
    if (b.action === 'setup') {
      limit('setup:' + clientIp(req), 5, 60 * 60e3);
      return res.status(200).json(await fn(b, null));
    }
    const me = await caller(req);
    limit('u:' + me.id, 60, 60e3);
    if (['create_user', 'create_org', 'add_member'].includes(b.action)) limit('new:' + me.id, 20, 60e3);
    res.status(200).json(await fn(b, me, req));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
    if (!e.status) console.error(e);
  }
};
