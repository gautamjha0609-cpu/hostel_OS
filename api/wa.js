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
  const base = (g.url || '').replace(/\/+$/, '');
  try {
    let r;
    if (g.kind === 'meta') {
      const phoneId = encodeURIComponent(g.session || '');
      const metaUrl = `${base || 'https://graph.facebook.com/v19.0'}/${phoneId}/messages`;
      const isTpl = text && typeof text === 'object' && text.template;
      const body = isTpl ? {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: text.template
      } : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: true, body: String(text || '') },
      };
      r = await fetch(metaUrl, {
        method: 'POST', signal: ctl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${g.api_key}`,
        },
        body: JSON.stringify(body),
      });
    } else if (g.kind === 'evolution') {
      r = await fetch(`${base}/message/sendText/${encodeURIComponent(g.session || 'hostel')}`, {
        method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', apikey: g.api_key },
        body: JSON.stringify({ number: to, text }) });
    } else {
      r = await fetch(`${base}/api/sendText`, {
        method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'X-Api-Key': g.api_key },
        body: JSON.stringify({ session: g.session || 'default', chatId: `${to}@c.us`, text }) });
    }
    if (!r.ok) {
      let msg = `Gateway error ${r.status}`;
      try { const j = await r.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
      return { ok: false, error: msg };
    }
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

  // Meta Embedded Signup OAuth Exchange:
  // Receives { hostel_id, code, waba_id, phone_number_id } from frontend Embedded Signup.
  // Exchanges code with Meta Graph API for a customer-specific Access Token, subscribes WABA, and stores credentials per hostel.
  async embedded_signup(b, me) {
    const id = uuid(b.hostel_id, 'hostel');
    const { role } = await hostelAccess(me, id);
    if (!isAdminRole(role) && !me.isSuper) throw new HttpError(403, 'Only the owner or manager can connect WhatsApp');
    await notDemo(id);

    const code = String(b.code || '').trim();
    const phoneId = String(b.phone_number_id || '').trim();
    const wabaId = String(b.waba_id || '').trim();
    if (!code) throw new HttpError(400, 'Missing Meta authorization code');
    if (!phoneId) throw new HttpError(400, 'Missing Meta Phone Number ID');

    const appId = process.env.META_APP_ID || process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret) {
      throw new HttpError(503, 'Meta WhatsApp App is not configured on the server (META_APP_ID / META_APP_SECRET missing)');
    }

    // 1. Exchange OAuth code for Customer-Specific Access Token
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
    let tokenRes;
    try {
      const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;
      tokenRes = await fetch(tokenUrl, { method: 'GET', signal: ctl.signal });
    } catch (e) {
      clearTimeout(timer);
      throw new HttpError(502, 'Could not reach Meta OAuth endpoint: ' + e.message);
    } finally {
      clearTimeout(timer);
    }

    if (!tokenRes.ok) {
      let errDetail = `Meta OAuth error ${tokenRes.status}`;
      try { const errJson = await tokenRes.json(); if (errJson.error && errJson.error.message) errDetail = errJson.error.message; } catch (_) {}
      throw new HttpError(400, 'Meta authorization failed: ' + errDetail);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new HttpError(400, 'Meta did not return an access token');

    // 2. Subscribe the hostel's WABA to webhooks if waba_id provided
    if (wabaId) {
      const subCtl = new AbortController(), subTimer = setTimeout(() => subCtl.abort(), 8000);
      try {
        await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(wabaId)}/subscribed_apps`, {
          method: 'POST',
          signal: subCtl.signal,
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
      } catch (_) {
      } finally {
        clearTimeout(subTimer);
      }
    }

    // 3. Register phone number if requested
    if (b.pin) {
      const regCtl = new AbortController(), regTimer = setTimeout(() => regCtl.abort(), 8000);
      try {
        await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(phoneId)}/register`, {
          method: 'POST',
          signal: regCtl.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
          body: JSON.stringify({ messaging_product: 'whatsapp', pin: String(b.pin).trim() })
        });
      } catch (_) {
      } finally {
        clearTimeout(regTimer);
      }
    }

    // 4. Store customer-specific token and phone ID into wa_gateways (Strict Per-Hostel Isolation)
    const row = {
      hostel_id: id,
      kind: 'meta',
      url: 'https://graph.facebook.com/v19.0',
      api_key: accessToken,
      session: phoneId
    };

    if (b.test_phone) {
      const ph = String(b.test_phone).replace(/\D/g, '').slice(-10);
      if (ph.length === 10) {
        await deliver(row, ph, 'HostelOS: WhatsApp Cloud API is connected. Your dedicated hostel number is active.');
      }
    }

    await rest('wa_gateways?on_conflict=hostel_id', {
      method: 'POST',
      body: [row],
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
    });

    return { ok: true, connected: true, kind: 'meta', phone_number_id: phoneId, waba_id: wabaId || null };
  },

  async save(b, me) {
    const id = uuid(b.hostel_id, 'hostel');
    const { role } = await hostelAccess(me, id);
    if (!isAdminRole(role)) throw new HttpError(403, 'Only the owner or manager can set up WhatsApp');
    await notDemo(id);
    const kind = b.kind === 'meta' ? 'meta' : (b.kind === 'evolution' ? 'evolution' : 'waha');
    const url = kind === 'meta' ? (String(b.url || '').trim() || 'https://graph.facebook.com/v19.0') : String(b.url || '').trim();
    // Vercel cannot reach a home network, so the gateway needs a public https address
    // (a free Cloudflare Tunnel or ngrok in front of it is enough).
    if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(url)) throw new HttpError(400, 'The gateway address must start with https://');
    try {
      const parsedHost = new URL(url).hostname.toLowerCase();
      if (
        parsedHost === 'localhost' ||
        parsedHost === '127.0.0.1' ||
        parsedHost === '0.0.0.0' ||
        parsedHost.startsWith('192.168.') ||
        parsedHost.startsWith('10.') ||
        parsedHost.startsWith('169.254.') ||
        parsedHost.endsWith('.local') ||
        parsedHost.endsWith('.internal')
      ) {
        throw new HttpError(400, 'Private network and loopback addresses are not permitted');
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, 'Invalid gateway URL');
    }
    const cur = await load(id);
    const key = String(b.api_key || '').trim() || (cur && cur.api_key) || '';
    if (!key) throw new HttpError(400, 'Enter the gateway API key / Access Token');
    const defaultSession = kind === 'meta' ? '' : (kind === 'waha' ? 'default' : 'hostel');
    const session = String(b.session || '').trim().slice(0, 60) || defaultSession;
    if (kind === 'meta' && !session) throw new HttpError(400, 'Enter the Meta Phone Number ID');
    const row = { hostel_id: id, kind, url, api_key: key, session };
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
    const [h] = await rest('hostels', `?id=eq.${id}&select=modules`);
    if (h && h.modules && h.modules.automation === false) {
      throw new HttpError(403, 'WhatsApp Cloud Automation is turned off by platform admin for this hostel');
    }
    const list = (Array.isArray(b.messages) ? b.messages : []).slice(0, BATCH);
    const g = await load(id);
    if (!g) throw new HttpError(409, 'WhatsApp gateway is not set up');
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const rawMsg = list[i] || {};
      const phone = String(rawMsg.phone || '').replace(/\D/g, '').slice(-10);
      const isTplObj = rawMsg.template || (rawMsg.text && typeof rawMsg.text === 'object' && rawMsg.text.template);
      const text = isTplObj ? (rawMsg.template ? { template: rawMsg.template } : rawMsg.text) : String(rawMsg.text || '').slice(0, 4000);
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
    const fn = Object.prototype.hasOwnProperty.call(actions, b.action) ? actions[b.action] : null;
    if (!fn) throw new HttpError(400, 'Unknown action');
    const me = await caller(req);
    limit('wa:' + me.id, 60, 60e3);
    res.status(200).json(await fn(b, me));
  } catch (e) {
    if (!e.status) { if (process.env.NODE_ENV !== 'production') console.error(e); else console.error('[wa] unhandled:', e.message); }
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
};
// Expose internals only for the test runner — never in production.
if (process.env.NODE_ENV !== 'production') {
  module.exports._internals = { actions, deliver };
}
