/* Sarvlekh → WhatsApp through the owner's OWN self-hosted gateway (optional).
 *
 * WhatsApp has no free official API. By default Sarvlekh opens wa.me with the message typed
 * and the owner taps Send — free, zero risk. An owner who wants reminders to go out by
 * themselves can run a free open-source gateway on their own computer, old phone or a free
 * server, linked to their WhatsApp by scanning a QR once:
 *   • WAHA Core   https://waha.devlike.pro      (kind: 'waha')
 *   • Evolution   https://doc.evolution-api.com (kind: 'evolution')
 * These are unofficial WhatsApp Web clients. WhatsApp can block a number that sends a lot,
 * so the app says so plainly, sends slowly, and only to the hostel's own residents.
 *
 * The gateway URL and API key live in wa_gateways — RLS on, no policies, so only this
 * function (service role) can read them. Browsers only ever see an on/off marker.
 *
 *   POST /api/wa { action: save | remove | status | send, hostel_id, ... }
 */
const { HttpError, rest, uuid, caller, hostelAccess, isAdminRole, limit, readJson } = require('./_lib.js');

const BATCH = 5;          // messages per call; the client loops — keeps each call well under 10 s
const GAP_MS = 1200;      // pause between messages: slower looks human and lowers block risk
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The demo hostel is for showing and testing, with made-up residents: nothing is ever sent from it, so
// a gateway cannot be connected to it and a message cannot be pushed through one, whoever asks.
async function notDemo(hostelId) {
  const [h] = await rest('hostels', `?id=eq.${hostelId}&select=settings`);
  if (h && h.settings && h.settings.demo) throw new HttpError(409, 'This is the demo hostel. WhatsApp messages are never sent from it.');
}
const load = async hostelId => (await rest('wa_gateways', `?hostel_id=eq.${hostelId}&select=*`))[0] || null;

async function deliver(g, phone, text) {
  const to = '91' + phone;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  const base = g.url.replace(/\/+$/, '');
  try {
    const r = g.kind === 'evolution'
      ? await fetch(`${base}/message/sendText/${encodeURIComponent(g.session || 'hostel')}`, {
        method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', apikey: g.api_key },
        body: JSON.stringify({ number: to, text }) })
      : await fetch(`${base}/api/sendText`, {
        method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'X-Api-Key': g.api_key },
        body: JSON.stringify({ session: g.session || 'default', chatId: `${to}@c.us`, text }) });
    if (!r.ok) return { ok: false, error: `Gateway error ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Gateway did not answer' : 'Gateway unreachable' };
  } finally { clearTimeout(timer); }
}

/* Shared Evolution API server (the platform runs ONE; each hostel gets its own instance on it).
 * The owner scans a QR with their own phone, so messages leave from the owner's own number and
 * the platform never needs a number of its own. EVOLUTION_URL / EVOLUTION_API_KEY are server
 * secrets in the function environment; the per-instance token is what is stored per hostel. */
const evoEnv = () => {
  const url = String(process.env.EVOLUTION_URL || '').trim().replace(/\/+$/, ''), key = String(process.env.EVOLUTION_API_KEY || '').trim();
  return /^https:\/\/[^\s/]+\.[^\s]+$/i.test(url) && key ? { url, key } : null;
};
const instanceOf = id => 'h-' + id;
const isManaged = (g, E) => !!(g && E && g.kind === 'evolution' && g.url === E.url && g.session === instanceOf(g.hostel_id));
async function evo(E, method, path, key, body) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(E.url + path, { method, signal: ctl.signal, headers: { 'Content-Type': 'application/json', apikey: key }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await r.json(); } catch (e) { /* empty body */ }
    return { ok: r.ok, status: r.status, json };
  } catch (e) { return { ok: false, status: 0, json: null }; } finally { clearTimeout(timer); }
}
const tokenOf = j => { const x = Array.isArray(j) ? j[0] : j; if (!x) return ''; const i = x.instance || x; return (typeof x.hash === 'string' ? x.hash : x.hash && x.hash.apikey) || x.token || x.apikey || i.token || i.apikey || ''; };
const qrOf = j => { const q = String((j && (j.base64 || (j.qrcode && j.qrcode.base64))) || ''); return q.startsWith('data:image/') ? q : q ? 'data:image/png;base64,' + q : null; };
const stateOf = j => String((j && ((j.instance && j.instance.state) || j.state)) || '');

const actions = {
  // Owner taps "Connect WhatsApp": make (or reuse) this hostel's instance and hand back the QR.
  async connect(b, me) {
    const id = uuid(b.hostel_id, 'hostel');
    const { role } = await hostelAccess(me, id);
    if (!isAdminRole(role)) throw new HttpError(403, 'Only the owner or manager can connect WhatsApp');
    await notDemo(id);
    const E = evoEnv(); if (!E) throw new HttpError(409, 'The shared WhatsApp server is not set up yet');
    const name = instanceOf(id);
    let g = await load(id), qr = null;
    if (!isManaged(g, E)) {
      let r = await evo(E, 'POST', '/instance/create', E.key, { instanceName: name, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
      let token = r.ok ? tokenOf(r.json) : '';
      if (r.ok) qr = qrOf(r.json);
      else if (r.status === 403 || r.status === 409) {           // already exists: look its token up
        const f = await evo(E, 'GET', '/instance/fetchInstances?instanceName=' + encodeURIComponent(name), E.key);
        token = f.ok ? tokenOf(f.json) : '';
      }
      if (!token) throw new HttpError(502, 'Could not reach the WhatsApp server. Try again in a minute.');
      g = { hostel_id: id, kind: 'evolution', url: E.url, api_key: token, session: name };
      await rest('wa_gateways?on_conflict=hostel_id', { method: 'POST', body: [g], headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    }
    const st = await evo(E, 'GET', '/instance/connectionState/' + encodeURIComponent(name), g.api_key);
    if (stateOf(st.json) === 'open') return { state: 'open' };
    if (!qr) { const c = await evo(E, 'GET', '/instance/connect/' + encodeURIComponent(name), g.api_key); qr = c.ok ? qrOf(c.json) : null; }
    return { state: stateOf(st.json) || 'connecting', qr };
  },

  // Polled while the QR is on screen; also tells the app whether the link is still alive.
  async state(b, me) {
    const id = uuid(b.hostel_id, 'hostel');
    await hostelAccess(me, id);
    const g = await load(id), E = evoEnv();
    if (!isManaged(g, E)) return { state: g ? 'custom' : 'none' };
    const st = await evo(E, 'GET', '/instance/connectionState/' + encodeURIComponent(g.session), g.api_key);
    return { state: stateOf(st.json) || 'unknown' };
  },

  async save(b, me) {
    const id = uuid(b.hostel_id, 'hostel');
    const { role } = await hostelAccess(me, id);
    if (!isAdminRole(role)) throw new HttpError(403, 'Only the owner or manager can set up WhatsApp');
    await notDemo(id);
    const kind = b.kind === 'evolution' ? 'evolution' : 'waha';
    const url = String(b.url || '').trim();
    // Vercel cannot reach a home network, so the gateway needs a public https address
    // (a free Cloudflare Tunnel or ngrok in front of it is enough).
    if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(url)) throw new HttpError(400, 'The gateway address must start with https://');
    const cur = await load(id);
    const key = String(b.api_key || '').trim() || (cur && cur.api_key) || '';
    if (!key) throw new HttpError(400, 'Enter the gateway API key');
    const row = { hostel_id: id, kind, url, api_key: key, session: String(b.session || '').trim().slice(0, 60) || (kind === 'waha' ? 'default' : 'hostel') };
    if (b.test_phone) {
      const ph = String(b.test_phone).replace(/\D/g, '').slice(-10);
      if (ph.length !== 10) throw new HttpError(400, 'Test number must be 10 digits');
      const r = await deliver(row, ph, 'Sarvlekh: WhatsApp is connected. This is a test message.');
      if (!r.ok) throw new HttpError(400, `Test message failed — ${r.error}. Check the address, key and that WhatsApp is linked.`);
    }
    await rest('wa_gateways?on_conflict=hostel_id', { method: 'POST', body: [row], headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    return { ok: true, kind };
  },

  async remove(b, me) {
    const id = uuid(b.hostel_id, 'hostel');
    const { role } = await hostelAccess(me, id);
    if (!isAdminRole(role)) throw new HttpError(403, 'Not allowed');
    // A shared-server instance is logged out and deleted too, so the owner's phone is unlinked.
    const g = await load(id), E = evoEnv();
    if (isManaged(g, E)) {
      await evo(E, 'DELETE', '/instance/logout/' + encodeURIComponent(g.session), g.api_key);
      await evo(E, 'DELETE', '/instance/delete/' + encodeURIComponent(g.session), E.key);
    }
    await rest('wa_gateways', `?hostel_id=eq.${id}`, { method: 'DELETE' });
    return { ok: true };
  },

  async status(b, me) {
    const id = uuid(b.hostel_id, 'hostel');
    const { role } = await hostelAccess(me, id);
    const g = await load(id);
    return { on: !!g, kind: g ? g.kind : null, host: g && isAdminRole(role) ? new URL(g.url).host : null };
  },

  // Staff may send too (laundry "clothes ready", guard), never residents.
  async send(b, me) {
    const id = uuid(b.hostel_id, 'hostel');
    const { role } = await hostelAccess(me, id);
    if (role === 'resident') throw new HttpError(403, 'Not allowed');
    await notDemo(id);
    const list = (Array.isArray(b.messages) ? b.messages : []).slice(0, BATCH);
    const g = await load(id);
    if (!g) throw new HttpError(409, 'WhatsApp gateway is not set up');
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const phone = String(list[i].phone || '').replace(/\D/g, '').slice(-10);
      const text = String(list[i].text || '').slice(0, 4000);
      if (phone.length !== 10 || !text) { out.push({ ok: false, error: 'Bad number' }); continue; }
      if (i) await sleep(GAP_MS);
      out.push(await deliver(g, phone, text));
    }
    return { results: out };
  },
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const b = await readJson(req);
    const fn = actions[b.action];
    if (!fn) throw new HttpError(400, 'Unknown action');
    const me = await caller(req);
    limit('wa:' + me.id, 60, 60e3);
    res.status(200).json(await fn(b, me));
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
};
module.exports._internals = { actions, deliver };
