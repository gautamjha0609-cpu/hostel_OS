// Shared helpers for the Sarvlekh serverless functions. Files starting with "_" are not
// routed by Vercel, so this is a plain module, not an endpoint. No dependencies.

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// Every call to Supabase is bounded. A Vercel function that waits on a hung upstream is killed at
// 10 s with a blank 504 the browser cannot read; giving up at 8 s lets us answer in JSON instead.
async function sb(path, { method = 'GET', body, headers = {}, timeout = 8000 } = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  let r, text;
  try {
    r = await fetch(URL_ + path, {
      method, signal: ctl.signal,
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    text = await r.text();
  } catch (e) {
    throw new HttpError(504, e.name === 'AbortError' ? 'The database took too long to answer. Please try again.' : 'Could not reach the database. Please try again.');
  } finally { clearTimeout(timer); }
  let data = null, unreadable = false;
  try { data = text ? JSON.parse(text) : null; } catch (e) { unreadable = true; /* an HTML error page from the edge, not our JSON */ }
  if (!r.ok) {
    throw new HttpError(r.status >= 500 ? 502 : 400,
      (data && (data.msg || data.message || data.error_description || data.error)) || 'Supabase error ' + r.status);
  }
  if (unreadable) throw new HttpError(502, 'Unexpected reply from the database');
  return data;
}
// rest(table, '?filter', opt) or rest('table?on_conflict=x', opt). The second form used to be
// read as a query string, turning every upsert into a GET of ".../table[object Object]".
const rest = (table, q = '', opt) => (q && typeof q === 'object' ? sb(`/rest/v1/${table}`, q) : sb(`/rest/v1/${table}${q}`, opt));

// Anything interpolated into a PostgREST filter or an auth admin path must be a real uuid.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v, what) => { if (!UUID.test(String(v || ''))) throw new HttpError(400, `Invalid ${what}`); return String(v); };
const optUuid = (v, what) => (v == null || v === '' ? null : uuid(v, what));

// Who is calling: verifies the Supabase access token and loads profile + memberships.
// One screen fires several calls within a second, and each used to cost three database round
// trips just to learn the same thing, so the answer is kept for 15 s per warm instance. A
// disabled account is locked out by row-level security at once and here within that window.
const WHO = new Map(), WHO_MS = 15000;
async function caller(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Login required');
  const now = Date.now(), hit = WHO.get(token);
  if (hit && hit.at > now - WHO_MS) return hit.who;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  let user;
  try {
    const r = await fetch(URL_ + '/auth/v1/user', { headers: { apikey: KEY, Authorization: 'Bearer ' + token }, signal: ctl.signal });
    if (r.status === 401 || r.status === 403) throw new HttpError(401, 'Session expired, please log in again');
    if (!r.ok) throw new HttpError(502, 'Could not check your login. Please try again.');
    user = await r.json();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, 'Could not check your login. Please try again.');
  } finally { clearTimeout(timer); }
  const uid = uuid(user && user.id, 'user');
  const [[profile], members] = await Promise.all([
    rest('profiles', `?id=eq.${uid}&select=*`),
    rest('members', `?user_id=eq.${uid}&active=eq.true&select=*`),
  ]);
  if (!profile || !profile.active) throw new HttpError(403, 'Account disabled');
  const who = { id: uid, isSuper: profile.is_super, members };
  if (WHO.size > 500) for (const [k, v] of WHO) if (v.at < now - WHO_MS) WHO.delete(k);
  WHO.set(token, { at: now, who });
  return who;
}

/* Which hostels may this caller touch?
 * A membership with hostel_id = null covers every hostel of that org, so org-wide rows are
 * resolved against the hostels table rather than assumed. */
async function hostelAccess(me, hostelId) {
  const h = uuid(hostelId, 'hostel');
  if (me.isSuper) return { role: 'super', orgId: null };
  const direct = me.members.find(m => m.hostel_id === h);
  if (direct) return { role: direct.role, orgId: direct.org_id };
  const orgWide = me.members.filter(m => !m.hostel_id);
  if (orgWide.length) {
    const rows = await rest('hostels', `?id=eq.${h}&select=id,org_id`);
    const hit = rows[0] && orgWide.find(m => m.org_id === rows[0].org_id);
    if (hit) return { role: hit.role, orgId: hit.org_id };
  }
  throw new HttpError(403, 'Not allowed for this hostel');
}
const isAdminRole = r => ['owner', 'manager', 'super'].includes(r);

/* Per warm instance, in memory — no database round trip, no cost. It will not stop a
 * distributed attack, but it stops what matters here: a stolen session spraying expensive
 * calls, and guessing a setup key. */
const buckets = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  if (++b.n > max) throw new HttpError(429, 'Too many requests — wait a minute and try again');
}
const clientIp = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

// Reads the JSON body whether the platform parsed it for us or handed us a stream. A body that is
// not JSON is the caller's mistake (400), not ours (500).
async function readJson(req) {
  try {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (e) { throw new HttpError(400, 'The request was not valid JSON'); }
}

// Names that are never a hostel's address (the app, mail, the API...). Same list as scripts/set-domain.js and js/domain.js.
const SITE_RESERVED = ['www', 'app', 'admin', 'api', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'dashboard', 'login', 'support', 'help', 'blog', 'docs', 'status', 'staging', 'test', 'dev', 'h', 'join', 'visit', 'pay', 'site', 'public', 'ns1', 'ns2', 'hostel'];

module.exports = { SITE_RESERVED, URL_, KEY, HttpError, sb, rest, uuid, optUuid, caller, hostelAccess, isAdminRole, limit, clientIp, readJson };
