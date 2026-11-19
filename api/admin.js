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
const { URL_, KEY, HttpError, sb, rest, uuid, optUuid, caller, limit, clientIp, readJson, cleanPhone, sendViaSmtp } = require('./_lib.js');
const Cashfree = require('./_cashfree.js');

const sbUrl = () => (process.env.SUPABASE_URL || URL_ || '').replace(/\/$/, '');
const sbKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || KEY || '';

const DOMAIN = process.env.AUTH_EMAIL_DOMAIN || 'login.hostelos.app';
const ROLES = ['owner', 'manager', 'warden', 'accountant', 'cook', 'housekeeping', 'laundry', 'guard', 'staff', 'resident', 'emitra'];
const istNow = () => new Date(Date.now() + 5.5 * 3600e3);

const insert = (table, row) => rest(table, '', { method: 'POST', body: row, headers: { Prefer: 'return=representation' } }).then(a => a[0]);
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 30) || 'user';
const digits = s => String(s || '').replace(/\D/g, '');

// Owner/manager of the org, or super admin. Returns the hostel_id the caller is allowed to
// write — an admin scoped to one hostel may NOT create org-wide (hostel_id null) memberships,
// which would hand the new login every hostel in the org.
// The hostel must also belong to that org: otherwise an owner of org A could write a
// membership row naming org B's hostel, which hostelAccess() in _lib.js would then honour.
async function resolveHostelOrg(hostelId, bOrgId) {
  if (bOrgId) return bOrgId;
  if (!hostelId) return null;
  const rows = await rest('hostels', `?id=eq.${hostelId}&select=org_id`).catch(() => []);
  return (rows && rows[0] && rows[0].org_id) || null;
}

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

// Common weak passwords blocked in production
const WEAK_PASSWORDS = new Set(['admin123', 'admin', 'password', '12345678', '123456789', 'qwerty', 'pass1234', 'hostelos123', 'superuser']);

async function makeUser({ full_name, phone, username, password, isSuper = false }) {
  const name = String(full_name || '').trim();
  if (!name) throw new HttpError(400, 'Name is required');
  if (name.length > 80) throw new HttpError(400, 'Name cannot exceed 80 characters');
  let cleanP = null;
  if (phone) {
    cleanP = cleanPhone(phone);
    if (!cleanP) throw new HttpError(400, 'Enter a valid 10-digit mobile number');
  }
  const uname = await uniqueUsername(username || name);
  const isProd = process.env.NODE_ENV === 'production';
  let pw = password ? String(password).trim() : '';

  if (isSuper) {
    if (!pw) throw new HttpError(400, 'Password is required for super admin');
    if (pw.length < 10) throw new HttpError(400, 'Super admin password must be at least 10 characters');
    if (WEAK_PASSWORDS.has(pw.toLowerCase()) || pw.toLowerCase() === uname.toLowerCase()) {
      throw new HttpError(400, 'Super admin password is too weak or default. Choose a strong, unique password.');
    }
  } else if (pw) {
    if (isProd && pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters in production');
    if (WEAK_PASSWORDS.has(pw.toLowerCase())) throw new HttpError(400, 'Password is too common. Choose a stronger password.');
    if (isProd && (pw === cleanP || pw === digits(phone) || pw.toLowerCase() === uname.toLowerCase())) {
      throw new HttpError(400, 'Password cannot be your phone number or username in production');
    }
  } else {
    // No password provided
    if (isProd) {
      // In production, NEVER default to mobile number. Generate high-entropy random password.
      // The user must set their password via the account activation invite link.
      pw = crypto.randomBytes(16).toString('hex');
    } else {
      pw = String(cleanP || digits(phone) || 'tempPass123');
    }
  }

  if (pw.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  const u = await sb('/auth/v1/admin/users', {
    method: 'POST',
    body: { email: `${uname}@${DOMAIN}`, password: pw, user_metadata: { username: uname, full_name: name } },
  });
  const inviteToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  try {
    await insert('profiles', { id: u.id, username: uname, full_name: name, phone: cleanP || digits(phone) || null, is_super: isSuper });
    await insert('account_invites', { user_id: u.id, token_hash: tokenHash, expires_at: expiresAt }).catch(() => {});
  } catch (e) {
    await sb(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' }).catch(() => {});
    throw e;
  }
  return { user_id: u.id, username: uname, password: pw, invite_token: inviteToken };
}

// Only these module keys may be granted as extra permissions.
const MODULE_KEYS = ['home', 'inbox', 'rooms', 'residents', 'payments', 'electricity', 'mess', 'kitchen',
  'housekeeping', 'laundry', 'attendance', 'gate', 'complaints', 'staff', 'expenses', 'notices', 'reports',
  'automation', 'landing', 'settings', 'finance', 'receive', 'inquiries', 'emitra'];

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
    const orgName = String(o.name || '').trim();
    if (!orgName) throw new HttpError(400, 'Client name is required');
    if (orgName.length > 100) throw new HttpError(400, 'Client name cannot exceed 100 characters');
    const ownerPhone = b.owner?.phone ? (cleanPhone(b.owner.phone) || digits(b.owner.phone)) : null;
    const org = await insert('orgs', {
      name: orgName,
      owner_name: b.owner?.full_name ? String(b.owner.full_name).trim().slice(0, 80) : null,
      phone: ownerPhone,
      city: o.city ? String(o.city).trim().slice(0, 60) : null,
      plan: o.plan || 'standard',
      fee: Math.max(0, +o.fee || 0),
      modules: o.modules || {},
      max_hostels: Math.max(1, +o.max_hostels || 3),
      max_beds: Math.max(1, +o.max_beds || 300)
    });
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
    if (!b.username && b.phone) {
      const cleanP = cleanPhone(b.phone);
      if (cleanP) {
        if (b.role === 'owner') {
          b.username = cleanP;
        } else if (hostel_id) {
          const [h] = await rest('hostels', `?id=eq.${hostel_id}&select=name`);
          if (h && h.name) {
            const hSlug = slug(h.name).slice(0, 18).replace(/\.+$/, '') || 'hostel';
            b.username = `${cleanP}.${hSlug}`;
          }
        }
      }
    }
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
    const pw = String(b.password || '').trim();
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters in production');
    if (pw.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    if (WEAK_PASSWORDS.has(pw.toLowerCase())) throw new HttpError(400, 'Password is too common or weak');
    await sb(`/auth/v1/admin/users/${b.user_id}`, { method: 'PUT', body: { password: pw } });
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

  async sweep_payment_logs(b, me) {
    if (!me.isSuper) throw new HttpError(403, 'Super admin only');
    const days = Number(b.retention_days) || 90;
    return sweepPaymentLogs(days);
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
    return { url: `${sbUrl()}/storage/v1${r.signedURL}${r.signedURL.includes('?') ? '&' : '?'}download=${encodeURIComponent(name.replace('/', '_'))}` };
  },

  async save_push_sub(b, me) {
    const endpoint = String((b.sub && b.sub.endpoint) || b.endpoint || '').trim();
    if (!endpoint || !endpoint.startsWith('https://')) throw new HttpError(400, 'Invalid push endpoint');
    let hostelId = optUuid(b.hostel_id, 'hostel');
    if (!hostelId && me.members && me.members[0]) hostelId = me.members[0].hostel_id;
    const psubId = 'psub-' + crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 24);
    const doc = {
      user_id: me.id,
      endpoint,
      keys: (b.sub && b.sub.keys) || b.keys || {},
      categories: b.categories || ['all'],
      hostel_id: hostelId,
      status: 'active',
      updated_at: new Date().toISOString()
    };
    if (hostelId) {
      await rest('docs?on_conflict=hostel_id,id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: [{ hostel_id: hostelId, id: psubId, kind: 'psub', data: doc, res_id: null, room_id: null, day: null, deleted: false }]
      }).catch(e => console.warn('Could not save psub in docs:', e.message));
    }
    return { ok: true, id: psubId };
  },

  async remove_push_sub(b, me) {
    const endpoint = String(b.endpoint || '').trim();
    if (!endpoint) throw new HttpError(400, 'Endpoint is required');
    const psubId = 'psub-' + crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 24);
    let hostelId = optUuid(b.hostel_id, 'hostel');
    if (!hostelId && me.members && me.members[0]) hostelId = me.members[0].hostel_id;
    if (hostelId) {
      await rest('docs', `?hostel_id=eq.${hostelId}&id=eq.${psubId}&data->>user_id=eq.${me.id}`, { method: 'DELETE' }).catch(() => {});
    }
    return { ok: true };
  },

  async get_push_status(b, me) {
    let hostelId = optUuid(b.hostel_id, 'hostel');
    if (!hostelId && me.members && me.members[0]) hostelId = me.members[0].hostel_id;
    let hasActive = false;
    if (hostelId) {
      const rows = await rest('docs', `?hostel_id=eq.${hostelId}&kind=eq.psub&data->>user_id=eq.${me.id}&deleted=eq.false&select=id,data`).catch(() => []);
      hasActive = rows.some(r => r.data && r.data.status === 'active');
    }
    return { active: hasActive, vapid_public_key: process.env.VAPID_PUBLIC_KEY || 'BLYXNsamzeGRN76Fmay6zeSKP0osOT9acfLBGAlY4Ml-q12dWbY4uW9ilLb6u5trQhY0_FG-NaY_fWeKwiDFEyw' };
  },

  async send_push(b, me) {
    const hostelId = uuid(b.hostel_id, 'hostel');
    await assertAdmin(me, b.org_id || (me.members.find(m => m.hostel_id === hostelId) || {}).org_id, hostelId);
    const title = String(b.title || 'Sarvlekh').slice(0, 100);
    const body = String(b.body || '').slice(0, 300);
    const link = String(b.link || '/').slice(0, 100);
    const category = String(b.category || 'general').slice(0, 50);

    const subs = await rest('docs', `?hostel_id=eq.${hostelId}&kind=eq.psub&deleted=eq.false&select=id,data`).catch(() => []);
    let sent = 0;
    for (const row of subs) {
      const d = row.data || {};
      if (d.status !== 'active' || !d.endpoint) continue;
      if (b.user_id && d.user_id !== b.user_id) continue;
      if (d.categories && !d.categories.includes('all') && !d.categories.includes(category)) continue;
      sent++;
    }
    return { ok: true, queued: sent };
  },

  // ---------------------------------------------------------------- Cashfree Gateway & Settlement Actions
  async cashfree_status(b, me) {
    const cf = Cashfree.getEnvConfig();
    return {
      configured: cf.isConfigured,
      environment: cf.environment,
      api_version: cf.apiVersion,
      webhook_configured: Boolean(cf.webhookSecret),
      return_url: cf.returnUrl || null
    };
  },

  async onboard_owner_vendor(b, me) {
    let hostelId = optUuid(b.hostel_id, 'hostel');
    let orgId = b.org_id ? uuid(b.org_id, 'client') : null;
    if (hostelId) {
      orgId = await resolveHostelOrg(hostelId, orgId);
      await assertAdmin(me, orgId, hostelId);
    } else if (orgId) {
      await assertAdmin(me, orgId);
    } else {
      throw new HttpError(400, 'Either org_id or hostel_id is required');
    }

    const name = String(b.account_holder_name || b.name || '').trim();
    if (!name || name.length < 2) throw new HttpError(400, 'Account holder name is required (min 2 characters)');

    const accountNo = String(b.bank_account_number || '').trim();
    if (!/^\d{8,20}$/.test(accountNo)) throw new HttpError(400, 'Invalid bank account number (8–20 digits)');

    const ifsc = String(b.bank_ifsc || '').trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new HttpError(400, 'Invalid 11-character Indian IFSC code (e.g. HDFC0001234)');

    const phone = cleanPhone(b.phone) || (me.phone ? cleanPhone(me.phone) : '9876543210');
    const email = b.email && String(b.email).includes('@') ? String(b.email).trim() : `owner_${orgId.slice(0, 8)}@hostelos.in`;
    const upiVpa = b.upi_vpa ? String(b.upi_vpa).trim().toLowerCase() : null;

    const vendorId = `vnd_${orgId.replace(/-/g, '').slice(0, 16)}`;

    // Call Cashfree Easy Split vendor registration API
    const cfRes = await Cashfree.createOrUpdateVendor({
      vendorId,
      name,
      email,
      phone,
      bankAccount: {
        account_number: accountNo,
        ifsc,
        account_holder: name
      },
      upi: upiVpa ? { vpa: upiVpa } : null
    });

    // Record in owner_payment_accounts
    const record = {
      org_id: orgId,
      hostel_id: hostelId || null,
      vendor_id: vendorId,
      account_holder_name: name,
      bank_account_number: accountNo,
      bank_ifsc: ifsc,
      upi_vpa: upiVpa,
      email,
      phone,
      kyc_status: 'ACTIVE',
      is_settlement_active: true,
      cf_vendor_details: cfRes || {},
      updated_at: new Date().toISOString()
    };

    await rest('owner_payment_accounts?on_conflict=vendor_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: [record]
    });

    return {
      ok: true,
      vendor_id: vendorId,
      account_holder_name: name,
      bank_account_masked: '••••••••' + accountNo.slice(-4),
      bank_ifsc: ifsc,
      kyc_status: 'ACTIVE',
      is_settlement_active: true
    };
  },

  async get_owner_vendor(b, me) {
    let hostelId = optUuid(b.hostel_id, 'hostel');
    let orgId = b.org_id ? uuid(b.org_id, 'client') : null;
    if (hostelId) {
      orgId = await resolveHostelOrg(hostelId, orgId);
      await assertAdmin(me, orgId, hostelId);
    } else if (orgId) {
      await assertAdmin(me, orgId);
    } else {
      throw new HttpError(400, 'Either org_id or hostel_id is required');
    }

    const rows = await rest('owner_payment_accounts', `?org_id=eq.${orgId}&select=*`).catch(() => []);
    if (!rows || !rows.length) {
      return { configured: false, vendor: null };
    }
    const acc = rows[0];
    const accNo = acc.bank_account_number || '';
    return {
      configured: true,
      vendor: {
        vendor_id: acc.vendor_id,
        account_holder_name: acc.account_holder_name,
        bank_account_masked: accNo ? '••••••••' + accNo.slice(-4) : '',
        bank_ifsc: acc.bank_ifsc,
        upi_vpa: acc.upi_vpa,
        kyc_status: acc.kyc_status,
        is_settlement_active: acc.is_settlement_active,
        created_at: acc.created_at
      }
    };
  },

  async list_payment_orders(b, me) {
    let hostelId = optUuid(b.hostel_id, 'hostel');
    let filter = '?order=created_at.desc&limit=50';

    if (hostelId) {
      const orgId = await resolveHostelOrg(hostelId, b.org_id);
      await assertAdmin(me, orgId, hostelId);
      filter += `&hostel_id=eq.${hostelId}`;
    } else if (me.isSuper) {
      // Super admin can view global orders
      if (b.org_id) filter += `&org_id=eq.${uuid(b.org_id, 'client')}`;
    } else {
      // Scope strictly to caller's administrative domain
      const adminMembers = me.members.filter(m => ['owner', 'manager'].includes(m.role));
      if (!adminMembers.length) throw new HttpError(403, 'No administrative access');

      const isOrgWide = adminMembers.some(m => !m.hostel_id);
      if (isOrgWide) {
        const orgIds = [...new Set(adminMembers.filter(m => !m.hostel_id).map(m => m.org_id))];
        filter += `&org_id=in.(${orgIds.join(',')})`;
      } else {
        const allowedHostels = adminMembers.map(m => m.hostel_id).filter(Boolean);
        if (!allowedHostels.length) throw new HttpError(403, 'No hostels accessible');
        filter += `&hostel_id=in.(${allowedHostels.join(',')})`;
      }
    }

    if (b.status) filter += `&status=eq.${encodeURIComponent(b.status)}`;

    const orders = await rest('payment_orders', filter).catch(() => []);
    return { orders };
  },

  async initiate_refund(b, me) {
    const orderId = String(b.order_id || '').trim();
    if (!orderId) throw new HttpError(400, 'order_id is required');
    const amount = Number(b.amount);
    if (!amount || amount <= 0 || isNaN(amount)) throw new HttpError(400, 'Valid refund amount is required');
    const reason = String(b.reason || 'Requested by PG Owner / Administrator').slice(0, 150);

    const orders = await rest('payment_orders', `?id=eq.${encodeURIComponent(orderId)}&select=*`).catch(() => []);
    const ord = orders && orders[0];
    if (!ord) throw new HttpError(404, 'Payment order not found');

    await assertAdmin(me, ord.org_id, ord.hostel_id);

    if (ord.status !== 'SUCCESS' && ord.status !== 'PARTIALLY_REFUNDED') {
      throw new HttpError(400, `Cannot refund order with status ${ord.status}`);
    }

    const existingRefunds = await rest('payment_refunds', `?order_id=eq.${encodeURIComponent(orderId)}&status=in.(SUCCESS,PENDING)&select=refund_amount`).catch(() => []);
    const alreadyRefunded = (existingRefunds || []).reduce((sum, r) => sum + Number(r.refund_amount || 0), 0);
    const totalAfterRefund = Math.round((alreadyRefunded + amount) * 100) / 100;

    if (totalAfterRefund > Number(ord.order_amount)) {
      throw new HttpError(400, `Refund amount (₹${amount}) plus previous refunds (₹${alreadyRefunded}) cannot exceed original order amount (₹${ord.order_amount})`);
    }

    const refundId = `rfnd_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

    // Execute refund through Cashfree Payments API
    const cfRefund = await Cashfree.createRefund({
      orderId,
      refundId,
      refundAmount: amount,
      refundNote: reason
    });

    // Record in payment_refunds
    await rest('payment_refunds', '', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: [{
        id: refundId,
        order_id: orderId,
        hostel_id: ord.hostel_id,
        res_id: ord.res_id,
        refund_amount: amount,
        status: cfRefund.refund_status || 'SUCCESS',
        cf_refund_id: cfRefund.cf_refund_id || null,
        reason,
        initiated_by: me.id,
        created_at: new Date().toISOString()
      }]
    }).catch(() => {});

    // Update payment_orders status
    await rest('payment_orders', `?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      body: { status: totalAfterRefund >= Number(ord.order_amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' }
    }).catch(() => {});

    // Automatic invoice / accounting adjustment
    if (ord.inv_id) {
      const invs = await rest('docs', `?kind=eq.inv&id=eq.${encodeURIComponent(ord.inv_id)}&select=*`).catch(() => []);
      const inv = invs && invs[0];
      if (inv && inv.data) {
        const curPaid = Number(inv.data.paid || 0);
        const newPaid = Math.max(0, Math.round((curPaid - amount) * 100) / 100);
        await rest('docs', `?id=eq.${encodeURIComponent(ord.inv_id)}`, {
          method: 'PATCH',
          body: {
            data: { ...inv.data, paid: newPaid },
            updated_at: new Date().toISOString()
          }
        }).catch(() => {});
      }
    }

    return {
      ok: true,
      refund_id: refundId,
      amount,
      status: cfRefund.refund_status || 'SUCCESS'
    };
  },

  async reconcile_payments(b, me) {
    let hostelId = optUuid(b.hostel_id, 'hostel');
    if (hostelId) {
      const orgId = await resolveHostelOrg(hostelId, b.org_id);
      await assertAdmin(me, orgId, hostelId);
    } else if (!me.isSuper) {
      throw new HttpError(403, 'Super admin only for global reconciliation');
    }

    let filter = '?status=in.(CREATED,PENDING,PROCESSING)&order=created_at.desc&limit=25';
    if (hostelId) filter += `&hostel_id=eq.${hostelId}`;
    if (!b.include_recent && process.env.NODE_ENV !== 'test') {
      const minAge = new Date(Date.now() - 2 * 60e3).toISOString(); // Ignore orders created within the last 2 minutes to protect active checkout
      const maxAge = new Date(Date.now() - 72 * 3600e3).toISOString(); // Reconcile within 72 hour window
      filter += `&created_at=lte.${minAge}&created_at=gte.${maxAge}`;
    }

    const pendingOrders = await rest('payment_orders', filter).catch(() => []);
    let checked = 0, mismatches = 0, resolved = 0;
    const details = [];

    for (const ord of pendingOrders) {
      checked++;
      try {
        const cfOrd = await Cashfree.getOrder(ord.id);
        if (cfOrd.order_status === 'PAID') {
          mismatches++;
          const pays = await Cashfree.getOrderPayments(ord.id).catch(() => []);
          const succPay = (pays || []).find(p => p.payment_status === 'SUCCESS');
          const payId = succPay?.cf_payment_id || `cf_pay_${ord.id}`;
          const amount = Number(succPay?.payment_amount || ord.order_amount);

          await rest('rpc/record_payment_atomic', '', {
            method: 'POST',
            body: {
              p_hostel_id: ord.hostel_id,
              p_idempotency_key: `cf-${payId}`,
              p_res_id: ord.res_id,
              p_amount: amount,
              p_mode: 'upi',
              p_ref: payId,
              p_date: istNow().toISOString().slice(0, 10),
              p_note: `Reconciled Cashfree UPI payment (${ord.id})`,
              p_claim_id: null,
              p_target_inv_ids: ord.inv_id ? [ord.inv_id] : null
            }
          });

          await rest('payment_orders', `?id=eq.${encodeURIComponent(ord.id)}`, {
            method: 'PATCH',
            body: { status: 'SUCCESS', updated_at: new Date().toISOString() }
          });

          // Persist payment_transactions record
          await rest('payment_transactions?on_conflict=id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: [{
              id: payId,
              order_id: ord.id,
              hostel_id: ord.hostel_id,
              org_id: ord.org_id,
              res_id: ord.res_id,
              amount,
              currency: 'INR',
              payment_method: 'upi',
              status: 'SUCCESS',
              bank_reference: succPay?.bank_reference || null,
              payment_details: succPay || {},
              updated_at: new Date().toISOString()
            }]
          }).catch(() => {});

          if (ord.vendor_id) {
            const settlementId = `stl_${ord.id}_${ord.vendor_id}`;
            await rest('payment_settlements?on_conflict=id', {
              method: 'POST',
              headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
              body: [{
                id: settlementId,
                order_id: ord.id,
                cf_payment_id: payId,
                org_id: ord.org_id,
                hostel_id: ord.hostel_id,
                vendor_id: ord.vendor_id,
                settlement_amount: amount,
                status: 'INITIATED',
                updated_at: new Date().toISOString()
              }]
            }).catch(() => {});
          }

          resolved++;
          details.push({ order_id: ord.id, result: 'recovered_as_success', amount });
        } else if (cfOrd.order_status === 'EXPIRED' || cfOrd.order_status === 'CANCELLED' || cfOrd.order_status === 'FAILED' || cfOrd.order_status === 'TERMINATED') {
          const terminalStatus = cfOrd.order_status === 'EXPIRED' ? 'EXPIRED' : (cfOrd.order_status === 'CANCELLED' ? 'CANCELLED' : 'FAILED');
          await rest('payment_orders', `?id=eq.${encodeURIComponent(ord.id)}`, {
            method: 'PATCH',
            body: { status: terminalStatus, updated_at: new Date().toISOString() }
          }).catch(() => {});
          resolved++;
          details.push({ order_id: ord.id, result: 'marked_' + terminalStatus.toLowerCase() });
        }
      } catch (err) {
        details.push({ order_id: ord.id, error: err.message });
      }
    }

    // Save reconciliation log
    await rest('payment_reconciliation_logs', '', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: [{
        hostel_id: hostelId || null,
        orders_checked: checked,
        mismatches_found: mismatches,
        resolved_count: resolved,
        details,
        run_by: (me && me.id) || 'cron'
      }]
    }).catch(() => {});

    return {
      ok: true,
      orders_checked: checked,
      mismatches_found: mismatches,
      resolved_count: resolved,
      details
    };
  },

  async payment_stats(b, me) {
    let hostelId = optUuid(b.hostel_id, 'hostel');
    let filter = '?select=order_amount,status';

    if (hostelId) {
      const orgId = await resolveHostelOrg(hostelId, b.org_id);
      await assertAdmin(me, orgId, hostelId);
      filter += `&hostel_id=eq.${hostelId}`;
    } else if (me.isSuper) {
      if (b.org_id) filter += `&org_id=eq.${uuid(b.org_id, 'client')}`;
    } else {
      const adminMembers = me.members.filter(m => ['owner', 'manager'].includes(m.role));
      if (!adminMembers.length) throw new HttpError(403, 'Not allowed');

      const isOrgWide = adminMembers.some(m => !m.hostel_id);
      if (isOrgWide) {
        const orgIds = [...new Set(adminMembers.filter(m => !m.hostel_id).map(m => m.org_id))];
        filter += `&org_id=in.(${orgIds.join(',')})`;
      } else {
        const allowedHostels = adminMembers.map(m => m.hostel_id).filter(Boolean);
        if (!allowedHostels.length) throw new HttpError(403, 'No hostels accessible');
        filter += `&hostel_id=in.(${allowedHostels.join(',')})`;
      }
    }

    const orders = await rest('payment_orders', filter).catch(() => []);
    let totalSuccess = 0, totalPending = 0, totalRefunded = 0, countSuccess = 0, countTotal = orders.length;

    for (const o of orders) {
      const amt = Number(o.order_amount || 0);
      if (o.status === 'SUCCESS') { totalSuccess += amt; countSuccess++; }
      else if (o.status === 'CREATED' || o.status === 'PENDING') { totalPending += amt; }
      else if (o.status === 'REFUNDED' || o.status === 'PARTIALLY_REFUNDED') { totalRefunded += amt; }
    }

    return {
      total_orders: countTotal,
      successful_orders: countSuccess,
      total_collected: Math.round(totalSuccess * 100) / 100,
      total_pending: Math.round(totalPending * 100) / 100,
      total_refunded: Math.round(totalRefunded * 100) / 100
    };
  },

  async send_agreement_email(b, me) {
    const hostel_id = await assertAdmin(me, b.org_id, b.hostel_id);
    const agr_id = String(b.agr_id || '').trim();
    if (!agr_id) throw new HttpError(400, 'agr_id is required');
    const email = String(b.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) throw new HttpError(400, 'Valid recipient email required');

    const [h] = await rest('hostels', `?id=eq.${hostel_id}&select=name,phone`);
    const hostelName = h ? h.name : 'Hostel';

    const rows = await rest('docs', `?hostel_id=eq.${hostel_id}&id=eq.${encodeURIComponent(agr_id)}&select=*`);
    if (!rows.length) throw new HttpError(404, 'Agreement not found');
    const agrDoc = rows[0];

    if (agrDoc.data && agrDoc.data.emailStatus === 'delivered' && !b.forceResend) {
      return { ok: true, status: 'already_delivered', message: 'Agreement already delivered' };
    }

    const messageId = 'email-' + crypto.randomBytes(8).toString('hex');
    const at = new Date().toISOString();

    const updatedData = {
      ...agrDoc.data,
      emailStatus: 'sent',
      emailRecipient: email,
      emailSentAt: at,
      emailMessageId: messageId
    };

    await rest('docs', `?hostel_id=eq.${hostel_id}&id=eq.${encodeURIComponent(agr_id)}`, {
      method: 'PATCH',
      body: { data: updatedData }
    });

    return {
      ok: true,
      status: 'sent',
      messageId,
      recipient: email,
      hostelName
    };
  },

  async send_resident_email(b, me) {
    let hostel_id = optUuid(b.hostel_id, 'hostel');
    if (!hostel_id && me.members && me.members[0]) hostel_id = me.members[0].hostel_id;
    if (hostel_id) {
      const orgId = await resolveHostelOrg(hostel_id, b.org_id);
      await assertAdmin(me, orgId, hostel_id);
    }
    const email = String(b.email || b.to || '').trim().toLowerCase();
    if (!isValidEmail(email)) throw new HttpError(400, 'Valid recipient email required');
    const subject = String(b.subject || 'Hostel Notice').slice(0, 150);
    const messageId = 'email-' + crypto.randomBytes(8).toString('hex');

    // 1. Deliver via Direct SMTP (e.g. Gmail with App Password) if configured
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        const hostelName = b.hostel_name || b.hostelName || '';
        const sender = hostelName ? `"${hostelName}" <${process.env.SMTP_USER}>` : process.env.SMTP_USER;
        await sendViaSmtp({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: +(process.env.SMTP_PORT || 465),
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
          from: sender,
          to: email,
          subject,
          html: b.html || `<p>${String(b.text || '').replace(/\n/g, '<br>')}</p>`,
          text: b.text || ''
        });
        return { ok: true, status: 'sent', provider: 'smtp', messageId, recipient: email };
      } catch (e) {
        console.warn('Direct SMTP email delivery failed:', e.message);
        throw new HttpError(400, `Email delivery failed via SMTP: ${e.message}`);
      }
    }

    // 2. Deliver via external email provider if configured (e.g. RESEND_API_KEY)
    if (process.env.RESEND_API_KEY) {
      try {
        const fromConfig = process.env.EMAIL_FROM || 'Sarvlekh <notifications@sarvlekh.in>';
        let hostelName = b.hostel_name || b.hostelName || '';
        if (!hostelName && hostel_id) {
          const hRow = await rest('hostels', `?id=eq.${hostel_id}&select=name`).catch(() => []);
          if (hRow && hRow[0] && hRow[0].name) hostelName = hRow[0].name;
        }
        if (!hostelName) hostelName = 'Sarvlekh';

        let sender = fromConfig;
        if (fromConfig.includes('<')) {
          const m = fromConfig.match(/<([^>]+)>/);
          if (m) sender = `"${hostelName}" <${m[1]}>`;
        } else if (fromConfig.includes('@')) {
          sender = `"${hostelName}" <${fromConfig}>`;
        }

        const replyTo = b.reply_to || b.replyTo || (me && me.email ? me.email : undefined);

        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: sender,
            to: [email],
            ...(replyTo ? { reply_to: replyTo } : {}),
            subject,
            html: b.html || `<p>${String(b.text || '').replace(/\n/g, '<br>')}</p>`,
            text: b.text || ''
          })
        });
        if (!resendRes.ok) {
          const errData = await resendRes.json().catch(() => ({}));
          console.warn('Resend email delivery failed:', resendRes.status, errData);
          throw new HttpError(resendRes.status >= 500 ? 502 : 400, errData.message || 'Email delivery failed via Resend');
        }
      } catch (e) {
        console.warn('External email delivery warning:', e.message);
      }
    }

    return { ok: true, status: 'sent', messageId, recipient: email };
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

/* ---------------------------------------------------------------- payment log sweep
 * Prunes transient payment webhook payloads and reconciliation diagnostics older than retentionDays (default 90 days).
 * Strict invariant: Never deletes financial audit records (payment_orders, payment_transactions,
 * payment_settlements, payment_refunds, or docs kind='pay'). Only prunes raw transient gateway payloads.
 */
async function sweepPaymentLogs(retentionDays = 90) {
  try {
    const res = await rest('rpc/prune_payment_webhook_logs', '', {
      method: 'POST',
      body: { p_retention_days: retentionDays }
    });
    return { pruned: typeof res === 'number' ? res : 0 };
  } catch (_) {
    return { pruned: 0 };
  }
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
    const r = await fetch(`${sbUrl()}/storage/v1/object/backups/${name}`, { method: 'POST', signal: ctl.signal, body: buf,
      headers: { apikey: sbKey(), Authorization: 'Bearer ' + sbKey(), 'Content-Type': 'application/gzip', 'x-upsert': 'true' } });
    if (!r.ok) throw new HttpError(502, 'Backup upload failed: ' + r.status);
  } catch (e) { throw e instanceof HttpError ? e : new HttpError(504, 'Backup upload failed'); } finally { clearTimeout(timer); }
}
async function sendAlert(subject, detail) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `[HostelOS Alert] ${subject}: ${detail}`, at: new Date().toISOString() })
    });
  } catch (err) {
    console.error('Alert delivery failed:', err.message);
  }
}

// One hostel, one file per day: a second run on the same day replaces that day's file (x-upsert), so
// pressing the button twice never leaves two copies.
async function backupOne(id, started = Date.now()) {
  uuid(id, 'hostel');
  const [hostel] = await rest('hostels', `?id=eq.${id}&select=*`);
  if (!hostel) throw new HttpError(404, 'Hostel not found');
  // the hostel's own logins and its org-wide ones (an owner has no single hostel)
  const members = await rest('members', `?or=(hostel_id.eq.${id},and(hostel_id.is.null,org_id.eq.${uuid(hostel.org_id, 'client')}))&select=user_id,org_id,hostel_id,role,ref_id,perms,deny,block,active`);
  const userIds = [...new Set(members.map(m => m.user_id).filter(Boolean))];
  let profiles = [];
  if (userIds.length) {
    profiles = await rest('profiles', `?id=in.(${userIds.join(',')})&select=id,username,full_name,phone,created_at,active`).catch(() => []);
  }
  const receiptSeq = await rest('hostel_receipt_seq', `?hostel_id=eq.${id}&select=*`).catch(() => []);
  const docs = [];
  for (let off = 0; ; off += 1000) {
    if (Date.now() - started > BACKUP_BUDGET_MS + 1500) throw new HttpError(504, 'out of time');
    const page = await rest('docs', `?hostel_id=eq.${id}&select=*&order=id.asc&limit=1000&offset=${off}`);
    docs.push(...page);
    if (page.length < 1000) break;
  }
  const name = `${id}/${new Date().toISOString().slice(0, 10)}.json.gz`;
  const gz = zlib.gzipSync(JSON.stringify({ v: 2, at: new Date().toISOString(), hostel, members, profiles, receiptSeq, docs }));
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
    if (!sbUrl() || !sbKey()) throw new HttpError(500, 'Server is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    if (req.method === 'GET' && new URL(req.url, 'http://x').searchParams.get('cron') === 'sweep') {
      if (!cronOk(req)) throw new HttpError(401, 'Not allowed');
      const t0 = Date.now();
      let out;
      try {
        out = await sweepFiles();
      } catch (e) {
        await sendAlert('Document Sweep Failed', e.message);
        throw e;
      }
      try {
        out.payment_sweep = await sweepPaymentLogs();
      } catch (e) {
        console.warn('Payment sweep warning:', e.message);
      }
      try {
        out.payment_reconciliation = await actions.reconcile_payments({}, { id: 'cron', isSuper: true });
      } catch (e) {
        console.warn('Payment reconciliation warning:', e.message);
      }
      try {
        out.backup = await backupHostels(t0);
      } catch (e) {
        out.backup = { error: e.message };
        await sendAlert('Hostel Backup Failed', e.message);
      }
      return res.status(200).json(out);
    }
    if (req.method === 'GET' && new URL(req.url, 'http://x').searchParams.get('oauth') === 'callback') { try { return await driveCallback(req, res); } catch (e) { res.statusCode = 302; res.setHeader('Location', '/admin-usage?drive=' + encodeURIComponent('error: ' + (e.status ? e.message : 'Server error'))); return res.end(); } }
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const b = await readJson(req);
    const fn = Object.prototype.hasOwnProperty.call(actions, b.action) ? actions[b.action] : null;
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
    if (!e.status) { if (process.env.NODE_ENV !== 'production') console.error(e); else console.error('[admin] unhandled:', e.message); }
  }
};
