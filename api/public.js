/* Sarvlekh — the pages a stranger opens without logging in (Vercel Serverless Function,
 * Node 18+, no dependencies).
 *
 *   POST /api/public/visit   gate QR      → an entry in the hostel's gate register
 *   POST /api/public/join    join QR      → a resident APPLICATION (plus their ID papers)
 *   POST /api/public/site    public page  → the hostel's one-pager for an advert
 *
 * Each QR carries the hostel id and a per-hostel key the owner can regenerate at any time
 * (which kills every printed copy). Everything is rate-limited per IP and written by the
 * service role.
 */
const crypto = require('crypto');
const { URL_, HttpError, sb, rest, uuid, limit, clientIp, readJson } = require('./_lib.js');

const istNow = () => new Date(Date.now() + 5.5 * 3600e3);
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const phone10 = v => str(v, 20).replace(/\D/g, '').slice(-10);
const sameKey = (want, got) => !!want && want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));

// The entry row plus the bell the owner sees, in one insert.
async function insertWithNotice(hostelId, row, ntf) {
  await rest('docs', '', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: [
      { hostel_id: hostelId, res_id: null, room_id: null, deleted: false, ...row },
      { hostel_id: hostelId, id: 'ntf-' + row.id, kind: 'ntf', data: { to: 'admin', resId: null, staffId: null, read: false, ...ntf }, res_id: null, room_id: null, day: row.day, deleted: false },
    ],
  });
}

/* ------------------------------------------------------------------ visitor self-entry */
async function visitHostel(b) {
  const id = uuid(b.h, 'hostel');
  const key = String(b.k || '');
  const bad = () => new HttpError(403, 'This QR code is not valid any more — please register at the gate');
  if (!/^[\w-]{12,64}$/.test(key)) throw bad();
  const [h] = await rest('hostels', `?id=eq.${id}&select=id,name,settings`);
  const gate = (h && h.settings && h.settings.gate) || {};
  if (!sameKey(String(gate.visitKey || ''), key)) throw bad();
  if (gate.selfEntry === false) throw new HttpError(403, 'Self entry is switched off — please register at the gate');
  return h;
}
async function visit(req, res) {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  limit('visit:' + clientIp(req), 30, 10 * 60e3);
  const b = await readJson(req);
  const h = await visitHostel(b);

  if (b.action === 'info') return res.status(200).json({ name: h.name });

  if (b.action === 'submit') {
    const e = b.entry || {};
    const name = str(e.name, 80);
    if (!name) throw new HttpError(400, 'Name is required');
    const phone = phone10(e.phone);
    if (phone.length !== 10) throw new HttpError(400, 'Enter a 10-digit mobile number');
    const at = new Date().toISOString(), date = istNow().toISOString().slice(0, 10);
    const id = 'gate-' + crypto.randomBytes(6).toString('hex');
    const g = e.geo && isFinite(e.geo.lat) && isFinite(e.geo.lng) ? { lat: Math.round(e.geo.lat * 1e4) / 1e4, lng: Math.round(e.geo.lng * 1e4) / 1e4 } : null;
    const data = {
      type: 'visitor', name, phone, meet: str(e.meet, 80), roomNo: str(e.roomNo, 20), purpose: str(e.purpose, 80) || 'Meeting',
      place: str(e.place, 160), date, inAt: at, outAt: null, self: true, geo: g,
    };
    await insertWithNotice(h.id, { id, kind: 'gate', data, day: date },
      { title: 'Visitor registered at the gate', body: `${name}${data.meet ? ' → ' + data.meet : ''}${data.roomNo ? ' (' + data.roomNo + ')' : ''}`, link: 'gate', date, ts: at });
    return res.status(200).json({ ok: true, id });
  }
  throw new HttpError(400, 'Unknown action');
}

/* ------------------------------------------------------------------ public hostel page
 * No key and no login: the whole point is a link an owner can put in an advert. Four gates
 * have to be open — the client is active, the hostel is active, the platform admin gave this
 * client the Public page module, and the owner switched the page on — and a closed gate looks
 * exactly like a wrong address, so this endpoint cannot be used to discover which hostels exist.
 *
 * Nothing is written here and nothing is personal: no resident, no bill, no document. It is
 * cached for five minutes at the edge, so an advert that goes around a college WhatsApp group
 * costs one database read, not one per reader.
 */
// GET is what the page uses: Vercel's CDN caches a GET answer for s-maxage, but never a POST, so
// with POST every reader cost a function call and two database reads. POST stays for pages
// still cached on phones from before the switch.
async function site(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(405, 'GET or POST only');
  limit('site:' + clientIp(req), 60, 10 * 60e3);
  const b = req.method === 'GET' ? Object.fromEntries(new URL(req.url, 'http://x').searchParams) : await readJson(req);
  const gone = () => new HttpError(404, 'This page is not available');
  const cols = 'id,org_id,name,city,address,phone,status,settings,modules';
  // Either the hostel's own address (/h/sunrise-boys-pg) or its id. The slug is matched
  // against the stored value only — never built from the name here — so a hostel is reachable
  // by exactly the address its owner set, and the pattern is checked before it reaches the
  // query string.
  let h;
  if (b.s != null && b.s !== '') {
    const sl = String(b.s).toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(sl)) throw gone();
    const rows = await rest('hostels', `?settings->site->>slug=eq.${encodeURIComponent(sl)}&status=eq.active&select=${cols}&limit=2`);
    if (rows.length !== 1) throw gone();          // nothing, or an address two hostels claim
    h = rows[0];
  } else {
    [h] = await rest('hostels', `?id=eq.${uuid(b.h, 'hostel')}&select=${cols}`);
  }
  if (!h || h.status !== 'active') throw gone();
  const [o] = await rest('orgs', `?id=eq.${h.org_id}&select=status,modules`);
  if (!o || o.status !== 'active') throw gone();
  if ((o.modules || {}).landing === false || (h.modules || {}).landing === false) throw gone();
  const cfg = ((h.settings || {}).site) || {};
  if (cfg.on !== true) throw gone();
  // Photos are links the owner pasted; they travel inside `site` and are loaded by the
  // visitor's browser straight from wherever they are hosted. Nothing image-shaped is stored
  // or served by us, so this response stays a couple of kilobytes.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).json({
    name: h.name, city: h.city || '', address: h.address || '', phone: h.phone || '', site: cfg,
  });
}

/* ------------------------------------------------------------------ resident self check-in
 * The QR the owner prints opens join.html on the new resident's own phone. They fill in who
 * they are and upload their ID papers; they never see a rent, a deposit or a room, because
 * those are the owner's to decide. What lands here is an application, not a resident: it sits
 * in a `signup` row until the owner opens it, picks the bed and the rent, and admits them.
 * Deliberately so — a stranger with the QR must not be able to create a tenancy.
 *
 * Papers go into the private `docs` bucket under <hostel>/signup/<application>/, through a
 * one-time signed upload URL — the browser never holds a key that could write anywhere else.
 * The application id is chosen by the phone up front so the papers and the form can be tied
 * together, and the form may only point at papers inside its own folder. Papers whose form
 * is never sent are removed by the daily sweep.
 */
const JOIN_MIME = /^(image\/(jpeg|png|webp)|application\/pdf)$/;
const JOIN_DOC_MAX = 3 * 1024 * 1024;              // = the bucket's own limit
const APP_ID = /^[a-f0-9]{16,32}$/;
const signupDir = (hostelId, app) => `${hostelId}/signup/${app}/`;

async function joinHostel(b) {
  const id = uuid(b.h, 'hostel');
  const key = String(b.k || '');
  const bad = () => new HttpError(403, 'This QR code is not valid any more — please ask the hostel for a new one');
  if (!/^[\w-]{12,64}$/.test(key)) throw bad();
  const [h] = await rest('hostels', `?id=eq.${id}&select=id,name,settings`);
  const join = (h && h.settings && h.settings.join) || {};
  if (!sameKey(String(join.key || ''), key)) throw bad();
  if (join.on === false) throw new HttpError(403, 'Self check-in is switched off — please ask the hostel to register you');
  return h;
}
const appId = v => { const a = String(v || ''); if (!APP_ID.test(a)) throw new HttpError(400, 'Invalid application'); return a; };

async function join(req, res) {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  limit('join:' + clientIp(req), 20, 10 * 60e3);
  const b = await readJson(req);
  const h = await joinHostel(b);

  if (b.action === 'info') {
    const st = (h.settings && h.settings.police) || {};
    return res.status(200).json({
      name: h.name,
      // the app's own default (DEFAULT_SETTINGS in js/domain.js) when the owner never changed it
      docs: ((h.settings && h.settings.docs) || {}).required || ['Aadhaar card', 'Passport photo'],
      upload: true,
      police: st.on !== false,
      state: st.state || '',
    });
  }

  if (b.action === 'doc') {
    const size = Number(b.size) || 0;
    if (size <= 0 || size > JOIN_DOC_MAX) throw new HttpError(400, 'File is too large (max 3 MB)');
    if (!JOIN_MIME.test(String(b.mime || ''))) throw new HttpError(400, 'Upload a photo or a PDF');
    const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/webp': 'webp' }[b.mime] || 'jpg';
    const type = str(b.label, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
    const path = `${signupDir(h.id, appId(b.app))}${type}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const out = await sb(`/storage/v1/object/upload/sign/docs/${path}`, { method: 'POST', body: {} });
    if (!out || !out.url) throw new HttpError(502, 'Could not start the upload');
    return res.status(200).json({ url: `${URL_}/storage/v1${out.url}`, path });
  }

  if (b.action === 'submit') {
    const e = b.entry || {};
    const name = str(e.name, 80);
    if (!name) throw new HttpError(400, 'Name is required');
    const phone = phone10(e.phone);
    if (phone.length !== 10) throw new HttpError(400, 'Enter a 10-digit mobile number');
    const app = appId(b.app);
    const at = new Date().toISOString(), date = istNow().toISOString().slice(0, 10);
    const id = 'signup-' + app;
    const dir = signupDir(h.id, app);
    const docs = (Array.isArray(e.docs) ? e.docs : [])
      .filter(d => d && typeof d.path === 'string' && d.path.startsWith(dir) && /^[\w./-]{1,200}$/.test(d.path) && !d.path.includes('..'))
      .slice(0, 8).map(d => ({ type: str(d.type, 60) || 'Document', path: d.path, ts: at }));
    const data = {
      status: 'pending', name, phone,
      guardian: str(e.guardian, 80), guardianPhone: phone10(e.guardianPhone),
      email: str(e.email, 120), college: str(e.college, 120), idNo: str(e.idNo, 40),
      address: str(e.address, 240), lang: e.lang === 'hi' ? 'hi' : 'en',
      note: str(e.note, 240), docs,
      // whatever the resident managed to do themselves on the police portal
      pv: { refNo: str(e.pvRefNo, 60), state: str(e.pvState, 8), self: !!e.pvDone },
      date, ts: at, self: true,
    };
    await insertWithNotice(h.id, { id, kind: 'signup', data, day: date },
      { title: 'New resident application', body: `${name} · ${phone}`, link: 'residents', date, ts: at });
    return res.status(200).json({ ok: true, id });
  }
  throw new HttpError(400, 'Unknown action');
}

/* ------------------------------------------------------------------ entry point */
const routes = { visit, join, site };
module.exports = async (req, res) => {
  const sub = (req.query && req.query.sub) || new URL(req.url, 'http://x').searchParams.get('sub') || '';
  res.setHeader('Cache-Control', 'no-store');
  try {
    const fn = routes[sub];
    if (!fn) throw new HttpError(404, 'Not found');
    return await fn(req, res);
  } catch (e) {
    if (res.headersSent) return;
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
    if (!e.status) console.error(e);
  }
};

module.exports._internals = { visit, join, site };
