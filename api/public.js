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
const { URL_, HttpError, sb, rest, uuid, limit, clientIp, readJson, readBodyWithRaw, SITE_RESERVED, cleanPhone, isValidEmail, docSlots } = require('./_lib.js');

const istNow = () => new Date(Date.now() + 5.5 * 3600e3);
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const NAME_OK = /^[\p{L}\p{M}\s.\-'()]{2,80}$/u;   // letters, spaces and . - ' ( ) only: no digits, markup or symbols
const phone10 = v => cleanPhone(v) || str(v, 20).replace(/\D/g, '').slice(-10);
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
    if (!NAME_OK.test(name)) throw new HttpError(400, 'Name can contain letters and spaces only');
    const phone = cleanPhone(e.phone);
    if (!phone) throw new HttpError(400, 'Enter a 10-digit mobile number');
    // every detail of a visitor is compulsory (a legal register)
    if (!str(e.meet, 80)) throw new HttpError(400, 'Who you are meeting is required');
    if (!str(e.roomNo, 20)) throw new HttpError(400, 'Room number is required');
    if (!str(e.purpose, 80)) throw new HttpError(400, 'Purpose is required');
    if (!str(e.place, 160)) throw new HttpError(400, 'Where you are coming from is required');
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
const JOIN_MIME = /^image\/(jpeg|png|webp)$/;
const JOIN_DOC_MAX = 1.5 * 1024 * 1024;              // 1.5 MB limit to protect storage and bandwidth
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
      docs: docSlots(h.settings && h.settings.docs),
      upload: true,
      police: st.on !== false,
      state: st.state || '',
    });
  }

  if (b.action === 'doc') {
    const size = Number(b.size) || 0;
    if (size <= 0 || size > JOIN_DOC_MAX) throw new HttpError(400, 'File is too large (max 1.5 MB). Please upload a normal camera photo.');
    if (!JOIN_MIME.test(String(b.mime || ''))) throw new HttpError(400, 'Upload a photo (JPG, PNG or WebP); PDFs are not accepted');
    const ext = { 'image/png': 'png', 'image/webp': 'webp' }[b.mime] || 'jpg';
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
    if (!NAME_OK.test(name)) throw new HttpError(400, 'Name can contain letters and spaces only');
    if (e.guardian && !NAME_OK.test(str(e.guardian, 80))) throw new HttpError(400, 'Guardian name can contain letters and spaces only');
    // Aadhaar: exactly 12 digits, never starting with 0 or 1 (the form checks this too; this stops a hand-made request)
    if (str(e.idNo, 40)) { const d = str(e.idNo, 40).replace(/\D/g, ''); if (d.length !== 12) throw new HttpError(400, 'Aadhaar number must be exactly 12 digits'); }
    const phone = cleanPhone(e.phone);
    if (!phone) throw new HttpError(400, 'Enter a 10-digit mobile number');
    // every detail is compulsory
    if (!e.email || !isValidEmail(e.email)) throw new HttpError(400, 'A valid email address is required');
    if (!str(e.college, 120)) throw new HttpError(400, 'College / office is required');
    if (!str(e.idNo, 40)) throw new HttpError(400, 'Aadhaar number is required');
    if (!str(e.address, 240)) throw new HttpError(400, 'Address is required');
    if (!str(e.guardian, 80)) throw new HttpError(400, 'Parent / guardian name is required');
    let guardianPhone = cleanPhone(e.guardianPhone);
    if (!guardianPhone) throw new HttpError(400, 'Enter a 10-digit mobile number for guardian');
    const app = appId(b.app);
    const at = new Date().toISOString(), date = istNow().toISOString().slice(0, 10);
    const id = 'signup-' + app;
    const dir = signupDir(h.id, app);
    const docs = (Array.isArray(e.docs) ? e.docs : [])
      .filter(d => d && typeof d.path === 'string' && d.path.startsWith(dir) && /^[\w./-]{1,200}$/.test(d.path) && !d.path.includes('..'))
      .slice(0, 8).map(d => ({ type: str(d.type, 60) || 'Document', path: d.path, ts: at }));
    const needDocs = docSlots(h.settings && h.settings.docs);
    if (docs.length < needDocs.length) throw new HttpError(400, 'Please upload every document: ' + needDocs.join(', '));
    const data = {
      status: 'pending', name, phone,
      guardian: str(e.guardian, 80), guardianPhone: guardianPhone || '',
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
/* Is this web address free? The owner's settings screen asks before saving: two hostels with the same
 * address would both stop opening (the page refuses an address two hostels claim). The answer is only
 * free or not free: the pages are public, so nothing private is revealed. */
async function slug(req, res) {
  limit('slug:' + clientIp(req), 40, 10 * 60e3);
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const sl = String(q.s || '').toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(sl)) return res.status(200).json({ free: false, why: 'format' });
  if (SITE_RESERVED.includes(sl)) return res.status(200).json({ free: false, why: 'reserved' });
  const mine = q.h ? uuid(q.h, 'hostel') : null;
  const rows = await rest('hostels', `?settings->site->>slug=eq.${encodeURIComponent(sl)}&select=id&limit=3`);
  return res.status(200).json({ free: rows.every(r => r.id === mine), why: 'taken' });
}
/* ------------------------------------------------------------------ account activation */
async function activate(req, res) {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  limit('activate:' + clientIp(req), 10, 15 * 60e3);
  const b = await readJson(req);
  const token = String(b.token || '').trim();
  if (!token || !/^[a-f0-9]{32,128}$/i.test(token)) {
    throw new HttpError(400, 'Invalid activation token');
  }
  const password = String(b.password || '');
  if (password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters');
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // 1. Claim invite token atomically
  let claims;
  try {
    claims = await rest('rpc/claim_account_invite', '', {
      method: 'POST',
      body: { p_token_hash: tokenHash }
    });
  } catch (err) {
    throw new HttpError(400, err.message || 'Invalid or expired activation link');
  }
  const claim = claims && claims[0];
  if (!claim || !claim.invite_id) {
    throw new HttpError(400, 'Invalid or expired activation link');
  }

  // 2. Update Supabase Auth user password
  try {
    await sb(`/auth/v1/admin/users/${claim.user_id}`, {
      method: 'PUT',
      body: { password }
    });
  } catch (authErr) {
    await rest('rpc/release_account_invite', '', {
      method: 'POST',
      body: { p_invite_id: claim.invite_id }
    }).catch(() => {});
    throw new HttpError(502, 'Could not set password: ' + authErr.message);
  }

  // 3. Mark invite completed
  try {
    await rest('rpc/complete_account_invite', '', {
      method: 'POST',
      body: { p_invite_id: claim.invite_id }
    });
  } catch (compErr) {
    console.error('Failed to complete invite record:', compErr);
  }

  return res.status(200).json({ ok: true, username: claim.username });
}

/* ------------------------------------------------------------------ Cashfree payment & invoice info
 * Public endpoint for residents/tenants to view invoice and payment details before paying.
 */
const Cashfree = require('./_cashfree.js');

async function pay_info(req, res) {
  limit('pay_info:' + clientIp(req), 60, 60e3);
  const q = req.method === 'GET' ? (new URL(req.url, 'http://x')).searchParams : await readJson(req);
  const invId = q.get ? q.get('inv_id') : q.inv_id;
  const orderId = q.get ? q.get('order_id') : q.order_id;
  const hostelId = q.get ? q.get('hostel_id') : q.hostel_id;

  let invoice = null, hostel = null, resident = null, order = null;

  if (orderId) {
    const orders = await rest('payment_orders', `?id=eq.${encodeURIComponent(orderId)}&select=*`).catch(() => []);
    if (orders && orders[0]) order = orders[0];
  }

  const targetInvId = invId || (order && order.inv_id);
  if (targetInvId) {
    const invDocs = await rest('docs', `?kind=eq.inv&id=eq.${encodeURIComponent(targetInvId)}&deleted=eq.false&select=*`).catch(() => []);
    if (invDocs && invDocs[0]) {
      invoice = invDocs[0];
    }
  }

  const targetHostelId = hostelId || (invoice && invoice.hostel_id) || (order && order.hostel_id);
  if (targetHostelId) {
    const hostels = await rest('hostels', `?id=eq.${encodeURIComponent(targetHostelId)}&select=id,org_id,name,phone,settings`).catch(() => []);
    if (hostels && hostels[0]) hostel = hostels[0];
  }

  const targetResId = (invoice && invoice.res_id) || (order && order.res_id);
  if (targetResId && targetHostelId) {
    const resDocs = await rest('docs', `?hostel_id=eq.${encodeURIComponent(targetHostelId)}&kind=eq.res&id=eq.${encodeURIComponent(targetResId)}&deleted=eq.false&select=*`).catch(() => []);
    if (resDocs && resDocs[0]) resident = resDocs[0];
  }

  // Look up PG owner's verified settlement account
  let ownerAccount = null;
  if (hostel && hostel.org_id) {
    const accs = await rest('owner_payment_accounts', `?org_id=eq.${encodeURIComponent(hostel.org_id)}&select=*`).catch(() => []);
    if (accs && accs[0]) ownerAccount = accs[0];
  }

  const totalAmount = invoice ? Number(invoice.data?.amount || 0) : Number(order?.order_amount || 0);
  const paidAmount = invoice ? Number(invoice.data?.paid || 0) : 0;
  const waivedAmount = invoice ? Number(invoice.data?.waived || 0) : 0;
  const remainingDue = Math.max(0, Math.round((totalAmount - paidAmount - waivedAmount) * 100) / 100);

  let transaction = null;
  if (order) {
    const txs = await rest('payment_transactions', `?order_id=eq.${encodeURIComponent(order.id)}&select=*`).catch(() => []);
    if (txs && txs[0]) {
      transaction = {
        payment_id: txs[0].id,
        order_id: txs[0].order_id,
        amount: txs[0].amount,
        status: txs[0].status,
        utr: txs[0].bank_reference,
        created_at: txs[0].created_at
      };
    }
  }

  const cfConfig = Cashfree.getEnvConfig();

  return res.status(200).json({
    ok: true,
    hostel: {
      id: hostel?.id || null,
      name: hostel?.name || 'Hostel / PG Property',
      phone: hostel?.phone || null
    },
    resident: {
      id: resident?.id || targetResId || null,
      name: resident?.data?.name || resident?.name || 'Resident',
      room: resident?.data?.roomId || null
    },
    invoice: {
      id: targetInvId || null,
      title: invoice?.data?.title || (order ? `Order ${order.id}` : 'Rent Invoice'),
      total: totalAmount,
      paid: paidAmount,
      balance: remainingDue,
      day: invoice?.day || null
    },
    order: order ? {
      id: order.id,
      status: order.status,
      amount: order.order_amount,
      session_id: order.payment_session_id,
      utr: transaction?.utr || null,
      payment_id: transaction?.payment_id || null
    } : null,
    transaction,
    settlement: {
      payee_name: ownerAccount?.account_holder_name || hostel?.settings?.pay?.payee || hostel?.name,
      upi_id: ownerAccount?.upi_vpa || hostel?.settings?.pay?.upiId || '',
      is_vendor_verified: Boolean(ownerAccount && (ownerAccount.kyc_status === 'ACTIVE' || ownerAccount.kyc_status === 'VERIFIED'))
    },
    gateway: {
      provider: 'cashfree',
      environment: cfConfig.environment,
      is_live: cfConfig.isConfigured
    }
  });
}

/* ------------------------------------------------------------------ create Cashfree payment order
 * Server-side order creation. Validates amount, checks owner settlement account, creates
 * official Cashfree order with Easy Split vendor allocations, stores in payment_orders.
 */
async function create_payment_order(req, res) {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  limit('cf_order:' + clientIp(req), 60, 60e3);
  const b = await readJson(req);

  const hostelId = uuid(b.hostel_id, 'hostel');
  const resId = String(b.res_id || '').trim();
  const invId = b.inv_id ? String(b.inv_id).trim() : null;
  const inputAmount = Number(b.amount);

  if (!resId) throw new HttpError(400, 'Resident identifier (res_id) is required');

  // Verify hostel exists and get org_id
  const [hostel] = await rest('hostels', `?id=eq.${hostelId}&select=id,org_id,name,settings,modules`);
  if (!hostel) throw new HttpError(404, 'Hostel not found');
  // online payments are switched on per hostel by the platform admin; without it no gateway order is ever created
  if (!(hostel.modules && hostel.modules.cashfree === true)) throw new HttpError(403, 'Online payments are not enabled for this hostel');

  // Verify resident exists in this hostel
  const resDocs = await rest('docs', `?hostel_id=eq.${hostelId}&kind=eq.res&id=eq.${encodeURIComponent(resId)}&deleted=eq.false&select=*`).catch(() => []);
  const resident = resDocs && resDocs[0];
  if (!resident) throw new HttpError(404, 'Resident not found in this hostel');

  // If invoice specified, verify invoice and balance
  let orderAmount = inputAmount;
  let invDoc = null;
  if (invId) {
    const invDocs = await rest('docs', `?hostel_id=eq.${hostelId}&kind=eq.inv&id=eq.${encodeURIComponent(invId)}&deleted=eq.false&select=*`).catch(() => []);
    invDoc = invDocs && invDocs[0];
    if (!invDoc) throw new HttpError(404, 'Invoice not found in this hostel');
    if (invDoc.res_id && invDoc.res_id !== resId) {
      throw new HttpError(400, 'Invoice does not belong to this resident');
    }
    const tot = Number(invDoc.data?.amount || 0);
    const paid = Number(invDoc.data?.paid || 0);
    const waived = Number(invDoc.data?.waived || 0);
    const bal = Math.max(0, Math.round((tot - paid - waived) * 100) / 100);

    if (bal <= 0) {
      throw new HttpError(400, 'Invoice has already been paid in full');
    }

    if (!orderAmount || orderAmount <= 0) {
      orderAmount = bal;
    }
  }

  if (!orderAmount || orderAmount <= 0 || isNaN(orderAmount) || Math.round(orderAmount * 100) / 100 !== orderAmount) {
    throw new HttpError(400, 'Amount must be positive with at most 2 decimal places');
  }

  const cfConfig = Cashfree.getEnvConfig();

  // Optimization: Check for existing active unexpired order for this invoice/resident to reuse session
  // Eliminates duplicate Cashfree API requests and redundant database rows
  if (invId && !b.force_new) {
    const existingOrders = await rest('payment_orders', `?hostel_id=eq.${hostelId}&res_id=eq.${encodeURIComponent(resId)}&inv_id=eq.${encodeURIComponent(invId)}&status=in.(CREATED,PENDING)&order=created_at.desc&limit=1`).catch(() => []);
    if (existingOrders && existingOrders[0]) {
      const activeOrd = existingOrders[0];
      const ageMs = Date.now() - new Date(activeOrd.created_at).getTime();
      // Cashfree payment sessions are valid for 30 minutes; reuse if within 15 minutes and amounts match
      if (ageMs < 15 * 60e3 && Number(activeOrd.order_amount) === orderAmount && activeOrd.payment_session_id) {
        return res.status(200).json({
          ok: true,
          reused: true,
          order_id: activeOrd.id,
          payment_session_id: activeOrd.payment_session_id,
          cf_order_id: activeOrd.cf_order_id,
          amount: Number(activeOrd.order_amount),
          currency: 'INR',
          environment: cfConfig.environment,
          splits: activeOrd.splits || [],
          checkout_url: cfConfig.environment === 'production'
            ? `https://payments.cashfree.com/order/#${activeOrd.payment_session_id}`
            : `https://payments-test.cashfree.com/order/#${activeOrd.payment_session_id}`
        });
      }
    }
  }

  // Multi-Owner Easy Split Routing: Find owner's verified Cashfree vendor ID
  const ownerAccounts = await rest('owner_payment_accounts', `?org_id=eq.${encodeURIComponent(hostel.org_id)}&select=*`).catch(() => []);
  const ownerAcc = ownerAccounts && ownerAccounts[0];

  const orderSplits = [];
  if (ownerAcc && ownerAcc.vendor_id && ownerAcc.is_settlement_active) {
    orderSplits.push({
      vendor_id: ownerAcc.vendor_id,
      amount: orderAmount
    });
  }

  // Unique Cashfree order ID (max 45 chars, alphanumeric and underscore/dash)
  const orderId = `cf_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`.slice(0, 45);

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'app.hostelos.in';
  const baseUrl = `${protocol}://${host}`;

  const returnUrl = b.return_url || cfConfig.returnUrl || `${baseUrl}/pay.html?order_id=${orderId}`;
  const notifyUrl = `${baseUrl}/api/public?sub=webhook&provider=cashfree`;

  const customerName = resident.data?.name || resident.name || 'Resident';
  const customerPhone = cleanPhone(resident.data?.phone || resident.phone) || '9876543210';
  const customerEmail = resident.data?.email || `${customerPhone}@resident.hostelos.in`;

  // Create authoritative order with Cashfree
  const cfOrder = await Cashfree.createOrder({
    orderId,
    orderAmount,
    orderCurrency: 'INR',
    customerDetails: {
      customer_id: resId,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone
    },
    orderMeta: {
      return_url: returnUrl,
      notify_url: notifyUrl
    },
    orderTags: {
      hostel_id: hostelId,
      org_id: hostel.org_id,
      res_id: resId,
      inv_id: invId || ''
    },
    orderSplits,
    orderNote: `Payment for ${hostel.name} - ${invDoc ? (invDoc.data?.title || 'Rent') : 'Hostel Dues'}`
  });

  // Store in database
  const orderRecord = {
    id: orderId,
    hostel_id: hostelId,
    org_id: hostel.org_id,
    res_id: resId,
    inv_id: invId,
    order_amount: orderAmount,
    currency: 'INR',
    status: 'CREATED',
    cf_order_id: cfOrder.cf_order_id || null,
    payment_session_id: cfOrder.payment_session_id || null,
    vendor_id: ownerAcc ? ownerAcc.vendor_id : null,
    vendor_allocation_amount: orderSplits.length ? orderAmount : 0,
    splits: orderSplits,
    customer_details: { name: customerName, phone: customerPhone, email: customerEmail },
    order_meta: { return_url: returnUrl, notify_url: notifyUrl },
    created_at: new Date().toISOString()
  };

  await rest('payment_orders', '', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: [orderRecord]
  }).catch(e => console.warn('Could not record payment_order in database:', e.message));

  return res.status(200).json({
    ok: true,
    order_id: orderId,
    payment_session_id: cfOrder.payment_session_id,
    cf_order_id: cfOrder.cf_order_id,
    amount: orderAmount,
    currency: 'INR',
    environment: cfConfig.environment,
    splits: orderSplits,
    checkout_url: cfConfig.environment === 'production'
      ? `https://payments.cashfree.com/order/#${cfOrder.payment_session_id}`
      : `https://payments-test.cashfree.com/order/#${cfOrder.payment_session_id}`
  });
}

/* ------------------------------------------------------------------ Cashfree UPI pay session
 * Requests UPI intent or dynamic QR code from Cashfree official session.
 */
async function pay_session(req, res) {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  limit('cf_session:' + clientIp(req), 60, 60e3);
  const b = await readJson(req);

  const sessionId = String(b.payment_session_id || '').trim();
  const channel = String(b.channel || 'intent').trim(); // 'intent', 'qrcode', or 'collect'
  const upiId = b.upi_id ? String(b.upi_id).trim() : '';

  if (!sessionId) throw new HttpError(400, 'payment_session_id is required');

  const result = await Cashfree.payOrderSession({
    paymentSessionId: sessionId,
    channel,
    upiId
  });

  return res.status(200).json({ ok: true, data: result });
}

const activeVerifications = new Map();

/* ------------------------------------------------------------------ authoritative payment verification
 * Server-side authoritative verification against Cashfree Payments API.
 * Never trusts client callbacks or query parameters alone.
 * Optimized to check local authoritative records first, preventing redundant Cashfree API consumption.
 */
async function verify_payment(req, res) {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  limit('cf_verify:' + clientIp(req), 60, 60e3);
  const b = await readJson(req);

  const orderId = String(b.order_id || '').trim();
  if (!orderId) throw new HttpError(400, 'order_id is required');

  // 1. Check local authoritative database first to prevent redundant Cashfree API requests
  const orders = await rest('payment_orders', `?id=eq.${encodeURIComponent(orderId)}&select=*`).catch(() => []);
  const existingOrder = orders && orders[0];

  if (existingOrder && (existingOrder.status === 'SUCCESS' || existingOrder.status === 'PAID')) {
    const txs = await rest('payment_transactions', `?order_id=eq.${encodeURIComponent(orderId)}&select=*`).catch(() => []);
    const tx = txs && txs[0];
    return res.status(200).json({
      ok: true,
      verified: true,
      status: 'SUCCESS',
      order_id: orderId,
      payment_id: tx?.id || existingOrder.cf_order_id || `cf_pay_${orderId}`,
      amount: tx?.amount != null ? Number(tx.amount) : Number(existingOrder.order_amount),
      utr: tx?.bank_reference || null,
      cached: true
    });
  }

  // Terminal non-success orders cannot transition to success — return cached status to save gateway API calls
  if (existingOrder && (existingOrder.status === 'EXPIRED' || existingOrder.status === 'CANCELLED' || existingOrder.status === 'FAILED')) {
    return res.status(200).json({
      ok: false,
      verified: false,
      status: existingOrder.status,
      order_id: orderId,
      message: `Order is ${existingOrder.status.toLowerCase()}`,
      cached: true
    });
  }

  // 2. In-flight request deduplication: if this order is currently being verified, reuse the in-flight check
  if (activeVerifications.has(orderId)) {
    const dedupedResult = await activeVerifications.get(orderId);
    return res.status(200).json(dedupedResult);
  }

  const verifyPromise = (async () => {
    // Fetch authoritative state directly from Cashfree
    const cfOrder = await Cashfree.getOrder(orderId);
    const payments = await Cashfree.getOrderPayments(orderId).catch(() => []);

    const successfulPayment = Array.isArray(payments)
      ? payments.find(p => p.payment_status === 'SUCCESS')
      : null;

    const isSuccess = cfOrder.order_status === 'PAID' || Boolean(successfulPayment);
    if (!isSuccess) {
      // If Cashfree marks order EXPIRED or CANCELLED, persist terminal status to avoid future repeated API queries
      if (cfOrder.order_status === 'EXPIRED' || cfOrder.order_status === 'CANCELLED' || cfOrder.order_status === 'TERMINATED') {
        const termStatus = cfOrder.order_status === 'EXPIRED' ? 'EXPIRED' : 'CANCELLED';
        await rest('payment_orders', `?id=eq.${encodeURIComponent(orderId)}`, {
          method: 'PATCH',
          body: { status: termStatus, updated_at: new Date().toISOString() }
        }).catch(() => {});
      }
      return {
        ok: false,
        verified: false,
        status: cfOrder.order_status || 'PENDING',
        message: 'Payment is not confirmed successful by Cashfree'
      };
    }

    const paymentId = successfulPayment?.cf_payment_id || `cf_pay_${orderId}`;
    const amount = Number(successfulPayment?.payment_amount || cfOrder.order_amount);
    const bankRef = successfulPayment?.bank_reference || '';

    // Retrieve stored order record
    let orderDoc = existingOrder;
    if (!orderDoc) {
      const freshOrders = await rest('payment_orders', `?id=eq.${encodeURIComponent(orderId)}&select=*`).catch(() => []);
      orderDoc = freshOrders && freshOrders[0];
    }

    let hostelId = orderDoc?.hostel_id;
    let resId = orderDoc?.res_id;
    let invId = orderDoc?.inv_id;

    if (!hostelId || !resId) {
      if (invId) {
        const invs = await rest('docs', `?kind=eq.inv&id=eq.${encodeURIComponent(invId)}&select=hostel_id,res_id`).catch(() => []);
        if (invs && invs[0]) {
          hostelId = invs[0].hostel_id;
          resId = invs[0].res_id;
        }
      }
    }

    if (!hostelId || !resId) {
      throw new HttpError(400, 'Could not associate payment order with resident and hostel');
    }

    // Atomically record payment and settle invoice
    let ledgerResult = null;
    try {
      ledgerResult = await rest('rpc/record_payment_atomic', '', {
        method: 'POST',
        body: {
          p_hostel_id: hostelId,
          p_idempotency_key: `cf-${paymentId}`,
          p_res_id: resId,
          p_amount: amount,
          p_mode: 'upi',
          p_ref: paymentId,
          p_date: istNow().toISOString().slice(0, 10),
          p_note: `Verified Cashfree UPI payment (${orderId}${bankRef ? ' UTR:' + bankRef : ''})`,
          p_claim_id: null,
          p_target_inv_ids: invId ? [invId] : null
        }
      });
    } catch (err) {
      if (err.message && err.message.includes('Idempotency conflict')) {
        // Clean duplicate handling
      } else {
        console.error('Ledger atomic write error during payment verification:', err);
        throw err;
      }
    }

    // Update payment_orders status
    await rest('payment_orders', `?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      body: { status: 'SUCCESS', updated_at: new Date().toISOString() }
    }).catch(() => {});

    // Upsert authoritative payment_transactions record
    await rest('payment_transactions?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: [{
        id: paymentId,
        order_id: orderId,
        hostel_id: hostelId,
        org_id: orderDoc?.org_id || hostelId,
        res_id: resId,
        amount,
        currency: 'INR',
        payment_method: 'upi',
        status: 'SUCCESS',
        bank_reference: bankRef || null,
        payment_details: successfulPayment || { cf_payment_id: paymentId },
        updated_at: new Date().toISOString()
      }]
    }).catch(() => {});

    // Track Multi-Owner Settlement Status (distinguishing gateway success from bank settlement)
    if (orderDoc?.vendor_id) {
      const settlementId = `stl_${orderId}_${orderDoc.vendor_id}`;
      await rest('payment_settlements?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: [{
          id: settlementId,
          order_id: orderId,
          cf_payment_id: paymentId,
          org_id: orderDoc.org_id,
          hostel_id: hostelId,
          vendor_id: orderDoc.vendor_id,
          settlement_amount: amount,
          status: 'INITIATED',
          updated_at: new Date().toISOString()
        }]
      }).catch(() => {});
    }

    return {
      ok: true,
      verified: true,
      status: 'SUCCESS',
      order_id: orderId,
      payment_id: paymentId,
      amount,
      utr: bankRef,
      receipt_no: ledgerResult?.receipt_no || null,
      allocated: ledgerResult?.allocated || [],
      credit_added: ledgerResult?.credit_added || 0
    };
  })();

  activeVerifications.set(orderId, verifyPromise);
  try {
    const finalResult = await verifyPromise;
    return res.status(200).json(finalResult);
  } finally {
    activeVerifications.delete(orderId);
  }
}

/* ------------------------------------------------------------------ verified payment webhook
 * Receives bank/gateway payment webhooks (Cashfree official / standard).
 * Validates HMAC signature, checks idempotency, atomically settles invoice, updates ledger.
 */
async function webhook(req, res) {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  limit('webhook:' + clientIp(req), 60, 60e3);
  const { raw: rawBodyString, json: rawBody } = await readBodyWithRaw(req);
  const urlObj = new URL(req.url || '/', 'http://x');
  const provider = (req.query && req.query.provider) || urlObj.searchParams.get('provider') || (req.headers['x-razorpay-signature'] ? 'razorpay' : 'cashfree');
  const sig = req.headers['x-webhook-signature'] || req.headers['x-signature'] || req.headers['x-cashfree-signature'] || req.headers['x-razorpay-signature'] || '';
  const timestamp = req.headers['x-webhook-timestamp'] || '';

  const secret = process.env.PAYMENT_WEBHOOK_SECRET || process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_SECRET_KEY;
  if (!secret) {
    throw new HttpError(503, 'Payment webhook is not configured');
  }
  if (!sig) throw new HttpError(401, 'Missing webhook signature');

  let signatureValid = false;
  if (provider === 'cashfree') {
    signatureValid = Cashfree.verifyWebhookSignature({
      rawBody: rawBodyString,
      timestamp,
      signature: sig,
      secret
    });
  } else {
    const expected = crypto.createHmac('sha256', secret).update(rawBodyString).digest('hex');
    const safeSig = Buffer.from(sig);
    const safeExp = Buffer.from(expected);
    signatureValid = (safeSig.length === safeExp.length && crypto.timingSafeEqual(safeSig, safeExp));
  }

  let orderId = '', paymentId = '', amount = 0, status = 'failed', resId = null, hostelId = null, bankRef = '';
  if (provider === 'razorpay') {
    const p = rawBody.payload && rawBody.payload.payment && rawBody.payload.payment.entity;
    if (p) {
      orderId = p.order_id || (p.notes && p.notes.invId) || '';
      paymentId = p.id;
      amount = Math.round((p.amount || 0)) / 100;
      status = (rawBody.event === 'payment.captured' || p.status === 'captured') ? 'success' : p.status;
      resId = p.notes && p.notes.resId;
      hostelId = p.notes && p.notes.hostelId;
      bankRef = p.acquirer_data?.bank_transaction_id || '';
    }
  } else if (provider === 'cashfree') {
    const d = rawBody.data || rawBody;
    orderId = (d.order && d.order.order_id) || rawBody.orderId || '';
    paymentId = (d.payment && (d.payment.cf_payment_id || d.payment.payment_id)) || rawBody.paymentId || '';
    amount = Math.round(((d.payment && (d.payment.payment_amount || d.payment.amount)) || rawBody.amount || 0) * 100) / 100;
    const cfPayStatus = (d.payment && d.payment.payment_status) || rawBody.status;
    status = (rawBody.event === 'PAYMENT_SUCCESS_WEBHOOK' || rawBody.type === 'PAYMENT_SUCCESS_WEBHOOK' || cfPayStatus === 'SUCCESS') ? 'success' : 'failed';
    resId = (d.customer_details && d.customer_details.customer_id) || rawBody.resId || (rawBody.notes && rawBody.notes.resId);
    hostelId = rawBody.hostelId || (rawBody.notes && rawBody.notes.hostelId);
    bankRef = (d.payment && (d.payment.bank_reference || d.payment.bank_ref)) || '';
  } else {
    orderId = rawBody.orderId || rawBody.order_id || '';
    paymentId = rawBody.paymentId || rawBody.transactionId || rawBody.id;
    amount = Math.round((rawBody.amount || 0) * 100) / 100;
    status = (rawBody.status === 'SUCCESS' || rawBody.status === 'captured') ? 'success' : 'failed';
    resId = rawBody.resId || (rawBody.notes && rawBody.notes.resId);
    hostelId = rawBody.hostelId || (rawBody.notes && rawBody.notes.hostelId);
    bankRef = rawBody.bank_reference || '';
  }

  // Audit log helper: records webhook event with strict processed state
  const logWebhook = async (proc, errMsg = null) => {
    return rest('payment_webhook_logs', '', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: [{
        event_type: rawBody.type || rawBody.event || 'PAYMENT_WEBHOOK',
        order_id: orderId || null,
        cf_payment_id: paymentId || null,
        signature: sig,
        signature_valid: signatureValid,
        processed: Boolean(proc),
        error_message: errMsg ? String(errMsg).slice(0, 500) : null,
        payload: rawBody
      }]
    }).catch(() => {});
  };

  if (!signatureValid) {
    await logWebhook(false, 'Invalid webhook signature');
    throw new HttpError(401, 'Invalid webhook signature');
  }

  // Handle Refund Webhooks
  if (rawBody.type === 'REFUND_STATUS_WEBHOOK' || rawBody.event === 'REFUND_STATUS_WEBHOOK') {
    const rfData = (rawBody.data && rawBody.data.refund) || rawBody.data || {};
    const refOrderId = rfData.order_id || orderId;
    const refId = rfData.refund_id;
    const cfRefundId = rfData.cf_refund_id ? String(rfData.cf_refund_id) : null;
    const refStatus = rfData.refund_status || 'SUCCESS';
    const refAmount = Number(rfData.refund_amount || 0);

    if (refId) {
      await rest('payment_refunds', `?id=eq.${encodeURIComponent(refId)}`, {
        method: 'PATCH',
        body: {
          status: refStatus === 'SUCCESS' ? 'SUCCESS' : refStatus === 'FAILED' ? 'FAILED' : 'PENDING',
          cf_refund_id: cfRefundId,
          updated_at: new Date().toISOString()
        }
      }).catch(() => {});
    }

    if (refStatus === 'SUCCESS' && refOrderId) {
      const orders = await rest('payment_orders', `?id=eq.${encodeURIComponent(refOrderId)}&select=*`).catch(() => []);
      const ord = orders && orders[0];
      if (ord) {
        const newStatus = refAmount >= Number(ord.order_amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        await rest('payment_orders', `?id=eq.${encodeURIComponent(refOrderId)}`, {
          method: 'PATCH',
          body: { status: newStatus, updated_at: new Date().toISOString() }
        }).catch(() => {});

        if (ord.inv_id) {
          const invs = await rest('docs', `?kind=eq.inv&id=eq.${encodeURIComponent(ord.inv_id)}&select=*`).catch(() => []);
          const inv = invs && invs[0];
          if (inv && inv.data) {
            const curPaid = Number(inv.data.paid || 0);
            const newPaid = Math.max(0, Math.round((curPaid - refAmount) * 100) / 100);
            await rest('docs', `?id=eq.${encodeURIComponent(ord.inv_id)}`, {
              method: 'PATCH',
              body: { data: { ...inv.data, paid: newPaid }, updated_at: new Date().toISOString() }
            }).catch(() => {});
          }
        }
      }
    }
    await logWebhook(true);
    return res.status(200).json({ ok: true, message: 'Refund status updated' });
  }

  // Handle Multi-Vendor Easy Split Settlement Webhooks
  if (rawBody.type === 'TRANSFER_SUCCESS' || rawBody.type === 'TRANSFER_FAILED') {
    const stlData = rawBody.data || {};
    const stlId = stlData.settlement_id || stlData.transfer_id;
    if (stlId) {
      await rest('payment_settlements', `?id=eq.${encodeURIComponent(stlId)}`, {
        method: 'PATCH',
        body: {
          status: rawBody.type === 'TRANSFER_SUCCESS' ? 'SETTLED' : 'FAILED',
          utr: stlData.utr || null,
          settlement_time: new Date().toISOString()
        }
      }).catch(() => {});
    }
    await logWebhook(true);
    return res.status(200).json({ ok: true, message: 'Settlement status updated' });
  }

  if (status !== 'success') {
    if (orderId) {
      const orders = await rest('payment_orders', `?id=eq.${encodeURIComponent(orderId)}&select=status`).catch(() => []);
      const ord = orders && orders[0];
      if (ord && (ord.status === 'CREATED' || ord.status === 'PENDING')) {
        await rest('payment_orders', `?id=eq.${encodeURIComponent(orderId)}`, {
          method: 'PATCH',
          body: { status: 'FAILED', updated_at: new Date().toISOString() }
        }).catch(() => {});
      }
    }
    await logWebhook(true);
    return res.status(200).json({ ok: false, status, message: 'Ignored non-success event' });
  }

  // Lookup order in payment_orders if missing hostelId or resId
  let invId = null;
  let orderDoc = null;
  if (orderId) {
    const orders = await rest('payment_orders', `?id=eq.${encodeURIComponent(orderId)}&select=*`).catch(() => []);
    if (orders && orders[0]) {
      orderDoc = orders[0];
      if (!hostelId) hostelId = orderDoc.hostel_id;
      if (!resId) resId = orderDoc.res_id;
      invId = orderDoc.inv_id;
    }
  }

  if (!invId && orderId) {
    const invs = await rest('docs', `?kind=eq.inv&id=eq.${encodeURIComponent(orderId)}&select=id,hostel_id,res_id`).catch(() => []);
    if (invs && invs[0]) {
      if (!hostelId) hostelId = invs[0].hostel_id;
      if (!resId) resId = invs[0].res_id;
      invId = invs[0].id;
    }
  }

  if (!hostelId || !resId) {
    await logWebhook(false, 'Missing hostel or resident association');
    return res.status(200).json({ ok: false, message: 'Missing hostel or resident association' });
  }

  const idempotencyKey = `${provider === 'cashfree' ? 'cf' : 'gw'}-${paymentId}`;

  try {
    const result = await rest('rpc/record_payment_atomic', '', {
      method: 'POST',
      body: {
        p_hostel_id: hostelId,
        p_idempotency_key: idempotencyKey,
        p_res_id: resId,
        p_amount: amount,
        p_mode: 'upi',
        p_ref: paymentId,
        p_date: istNow().toISOString().slice(0, 10),
        p_note: `Automated verified payment via ${provider} (${orderId}${bankRef ? ' UTR:' + bankRef : ''})`,
        p_claim_id: null,
        p_target_inv_ids: invId ? [invId] : null
      }
    });

    if (orderId) {
      await rest('payment_orders', `?id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        body: { status: 'SUCCESS', updated_at: new Date().toISOString() }
      }).catch(() => {});
    }

    // Persist authoritative payment_transactions record with clean essential fields (reduces permanent DB storage)
    await rest('payment_transactions?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: [{
        id: paymentId,
        order_id: orderId || `ord_${paymentId}`,
        hostel_id: hostelId,
        org_id: orderDoc?.org_id || hostelId,
        res_id: resId,
        amount,
        currency: 'INR',
        payment_method: 'upi',
        status: 'SUCCESS',
        bank_reference: bankRef || null,
        payment_details: {
          cf_payment_id: paymentId,
          order_id: orderId,
          payment_method: 'upi',
          bank_reference: bankRef || null,
          gateway: provider
        },
        updated_at: new Date().toISOString()
      }]
    }).catch(() => {});

    // Track Multi-Owner Settlement Status
    if (orderDoc?.vendor_id) {
      const settlementId = `stl_${orderId}_${orderDoc.vendor_id}`;
      await rest('payment_settlements?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: [{
          id: settlementId,
          order_id: orderId,
          cf_payment_id: paymentId,
          org_id: orderDoc.org_id,
          hostel_id: hostelId,
          vendor_id: orderDoc.vendor_id,
          settlement_amount: amount,
          status: 'INITIATED',
          updated_at: new Date().toISOString()
        }]
      }).catch(() => {});
    }

    await logWebhook(true);

    if (result && result.idempotent_replay) {
      return res.status(200).json({ ok: true, replay: true, result });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    if (err.message && err.message.includes('Idempotency conflict')) {
      await logWebhook(true);
      return res.status(200).json({ ok: true, replay: true });
    }
    await logWebhook(false, err.message);
    throw err;
  }
}

async function inquiry(req, res) {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  limit('inquiry:' + clientIp(req), 15, 10 * 60e3);
  const b = await readJson(req);

  // Honeypot spam protection
  if (b.website || b.honeypot || b.company_url || b.hp) {
    return res.status(200).json({ ok: true, id: 'inq-filtered', spam: true });
  }

  const gone = () => new HttpError(404, 'Hostel not found or inactive');
  const slug = (b.s || b.slug || '').trim();
  let h;
  if (slug) {
    const sl = slug.toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(sl)) throw gone();
    const rows = await rest('hostels', `?settings->site->>slug=eq.${encodeURIComponent(sl)}&status=eq.active&select=id,org_id,name,settings,status,modules&limit=2`);
    if (rows.length !== 1) throw gone();
    h = rows[0];
  } else if (b.h || b.hostelId) {
    const id = uuid(b.h || b.hostelId, 'hostel');
    [h] = await rest('hostels', `?id=eq.${id}&select=id,org_id,name,settings,status,modules`);
  } else {
    throw new HttpError(400, 'Hostel identifier (slug or hostelId) is required');
  }
  if (!h || h.status !== 'active') throw gone();
  if (h.modules && (h.modules.landing === false || h.modules.inquiries === false)) {
    throw new HttpError(403, 'Inquiries are disabled for this property');
  }

  const name = str(b.name, 80);
  if (!name) throw new HttpError(400, 'Name is required');
  const phone = cleanPhone(b.phone);
  if (!phone) throw new HttpError(400, 'Enter a valid 10-digit Indian mobile number');
  if (b.email && !isValidEmail(b.email)) throw new HttpError(400, 'Invalid email address');

  const at = new Date().toISOString(), date = istNow().toISOString().slice(0, 10);
  const id = 'inq-' + crypto.randomBytes(6).toString('hex');
  const roomType = str(b.roomType, 40) || 'Any';
  const data = {
    name,
    phone,
    email: b.email ? str(b.email, 80) : null,
    roomType,
    moveInDate: b.moveInDate ? str(b.moveInDate, 10) : null,
    occupants: Math.max(1, Math.min(10, parseInt(b.occupants || 1, 10))),
    budget: b.budget != null && !isNaN(+b.budget) && +b.budget > 0 ? +b.budget : null,
    message: str(b.message, 500),
    consent: b.consent !== false,
    status: 'new',
    notes: [],
    followUpDate: null,
    createdAt: at
  };

  await insertWithNotice(h.id, { id, kind: 'inquiry', data, day: date }, {
    title: 'New PG Inquiry',
    body: `${name} (${phone}) — Interested in ${roomType}`,
    link: 'inquiries',
    date,
    ts: at
  });

  return res.status(200).json({ ok: true, id });
}

/* ------------------------------------------------------------------ resident UPI claim submission
 * Allows a resident paying via UPI (from WhatsApp bill link or pay.html) to submit their 12-digit
 * bank UTR / reference number. The hostel owner sees this claim in their Approvals inbox and
 * verifies / approves it manually.
 */
async function submit_claim(req, res) {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  limit('claim:' + clientIp(req), 20, 60e3);
  const b = await readJson(req);
  const hostelId = uuid(b.hostel_id, 'hostel');
  const resId = String(b.res_id || '').trim().slice(0, 80);
  const utr = String(b.utr || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 30).toUpperCase();
  const amount = Math.round(Number(b.amount) || 0);
  if (!utr || utr.length < 6) throw new HttpError(400, 'Enter a valid bank UTR / Reference number');
  if (amount <= 0 || amount > 10000000) throw new HttpError(400, 'Invalid payment amount');
  if (!resId) throw new HttpError(400, 'This link is not linked to a resident. Please ask the owner for a new link.');
  // The screenshot is optional. It is a small JPEG the page already shrank; anything else is refused.
  let proofUrl = null;
  if (b.proof != null && b.proof !== '') {
    const p = String(b.proof);
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p) || p.length > 350000) throw new HttpError(400, 'The screenshot could not be accepted. Please choose a normal photo.');
    proofUrl = p;
  }

  // Verify hostel exists and is active
  const [h] = await rest('hostels', `?id=eq.${hostelId}&select=id,name,status`);
  if (!h || h.status !== 'active') throw new HttpError(404, 'Hostel not found or inactive');

  // The claim is saved on the resident the link belongs to - that resident must exist in this hostel and still live there.
  const [resDoc] = await rest('docs', `?hostel_id=eq.${hostelId}&kind=eq.res&id=eq.${encodeURIComponent(resId)}&deleted=eq.false&select=data`);
  if (!resDoc || !resDoc.data || resDoc.data.status === 'left' || resDoc.data.status === 'cancelled') throw new HttpError(404, 'This resident could not be found. Please ask the owner for a new link.');
  const roomId = resDoc.data.roomId || null, resName = resDoc.data.name || 'Resident';

  // No duplicates: the same UTR is only taken once in a hostel (a rejected one may be sent again)
  const existing = await rest('docs', `?hostel_id=eq.${hostelId}&kind=eq.claim&deleted=eq.false&data->>utr=eq.${encodeURIComponent(utr)}&data->>status=neq.rejected&select=id`);
  if (existing && existing.length > 0) {
    return res.status(200).json({ ok: true, duplicate: true, message: 'This UTR was already submitted and is waiting for the owner to verify it.' });
  }

  const at = new Date().toISOString(), date = istNow().toISOString().slice(0, 10);
  const id = 'claim-' + crypto.randomBytes(6).toString('hex');
  const refType = utr.length === 12 && /^\d+$/.test(utr) ? 'bank_rrn' : 'upi_txn_id';
  const data = { resId, roomId, amount, utr, refType, date, status: 'pending', ts: at, source: 'pay_portal', ...(proofUrl ? { proofUrl } : {}) };

  await insertWithNotice(h.id, { id, kind: 'claim', data, day: date, res_id: resId, room_id: roomId }, {
    title: 'UPI Payment to Verify',
    body: `${resName} · ₹${amount.toLocaleString('en-IN')} (UTR: ${utr})${proofUrl ? ' · screenshot attached' : ''}`,
    link: 'inbox',
    date,
    ts: at
  });

  return res.status(200).json({ ok: true, id, message: 'Payment claim submitted. The owner will verify and approve your receipt.' });
}

const routes = { visit, join, site, slug, activate, webhook, pay_info, create_payment_order, pay_session, verify_payment, inquiry, submit_claim };
module.exports = async (req, res) => {
  const sub = (req.query && req.query.sub) || new URL(req.url, 'http://x').searchParams.get('sub') || '';
  res.setHeader('Cache-Control', 'no-store');
  try {
    const fn = Object.prototype.hasOwnProperty.call(routes, sub) ? routes[sub] : null;
    if (!fn) throw new HttpError(404, 'Not found');
    return await fn(req, res);
  } catch (e) {
    if (res.headersSent) return;
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
    if (!e.status) { if (process.env.NODE_ENV !== 'production') console.error(e); else console.error('[public] unhandled:', e.message); }
  }
};

// Expose internals only for the test runner — never in production.
if (process.env.NODE_ENV !== 'production') {
  module.exports._internals = { visit, join, site, slug, activate, webhook, pay_info, create_payment_order, pay_session, verify_payment, inquiry, submit_claim };
}
