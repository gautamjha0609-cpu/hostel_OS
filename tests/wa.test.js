// Tests for api/wa.js (optional self-hosted WhatsApp gateway) with a fake Supabase + gateway.
const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
const { actions } = require('../api/wa.js')._internals;

const H1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', ORG1 = '11111111-1111-4111-8111-111111111111';
const owner = { id: 'o', isSuper: false, members: [{ org_id: ORG1, hostel_id: H1, role: 'owner' }] };
const cook = { id: 'c', isSuper: false, members: [{ org_id: ORG1, hostel_id: H1, role: 'cook' }] };
const resident = { id: 'r', isSuper: false, members: [{ org_id: ORG1, hostel_id: H1, role: 'resident', ref_id: 'res-1' }] };

function fake(row) {
  const st = { row, sent: [] };
  global.fetch = async (url, opt = {}) => {
    const u = new URL(url), json = (s, b) => ({ ok: s < 400, status: s, text: async () => JSON.stringify(b), json: async () => b });
    if (u.hostname === 'sb.test' && u.pathname === '/rest/v1/hostels') return json(200, [{ settings: global.__demo ? { demo: true } : {} }]);
    if (u.hostname === 'sb.test' && u.pathname === '/rest/v1/wa_gateways') {
      if ((opt.method || 'GET') === 'GET') return json(200, st.row ? [st.row] : []);
      if (opt.method === 'POST') { st.row = JSON.parse(opt.body)[0]; return json(201, {}); }
      if (opt.method === 'DELETE') { st.row = null; return json(200, {}); }
    }
    if (u.hostname === 'gw.example.com') { st.sent.push({ path: u.pathname, body: JSON.parse(opt.body), key: opt.headers['X-Api-Key'] || opt.headers.apikey }); return json(201, {}); }
    return json(404, {});
  };
  return st;
}
const ROW = { hostel_id: H1, kind: 'waha', url: 'https://gw.example.com', api_key: 'k-1', session: 'default' };

test('only the owner/manager sets up the gateway, and it must be https', async () => {
  fake(null);
  await assert.rejects(actions.save({ hostel_id: H1, url: 'https://gw.example.com', api_key: 'x' }, cook), /Only the owner/);
  await assert.rejects(actions.save({ hostel_id: H1, url: 'http://192.168.1.5:3000', api_key: 'x' }, owner), /https/);
  const st = fake(null);
  await actions.save({ hostel_id: H1, url: 'https://gw.example.com', api_key: 'k-1', test_phone: '9876543210' }, owner);
  assert.equal(st.row.api_key, 'k-1');
  assert.equal(st.sent[0].body.chatId, '919876543210@c.us', 'test message went to the number given');
});

test('status never reveals the key; residents cannot send', async () => {
  fake({ ...ROW });
  const s = await actions.status({ hostel_id: H1 }, cook);
  assert.equal(s.on, true); assert.equal(JSON.stringify(s).includes('k-1'), false); assert.equal(s.host, null);
  await assert.rejects(actions.send({ hostel_id: H1, messages: [{ phone: '9876543210', text: 'x' }] }, resident), /Not allowed/);
});

test('send goes through the gateway, 5 at a time, bad numbers reported', async () => {
  const st = fake({ ...ROW, kind: 'evolution', session: 'pg1' });
  const r = await actions.send({ hostel_id: H1, messages: [{ phone: '9876543210', text: 'Rent due' }, { phone: '12', text: 'x' }] }, owner);
  assert.equal(r.results[0].ok, true); assert.equal(r.results[1].ok, false);
  assert.equal(st.sent[0].path, '/message/sendText/pg1'); assert.equal(st.sent[0].body.number, '919876543210');
});

/* ---- shared Evolution server: the owner scans a QR, messages leave from the owner's own number ---- */
function fakeEvo(row, state = 'close') {
  const st = { row, state, calls: [], sent: [] };
  global.fetch = async (url, opt = {}) => {
    const u = new URL(url), m = opt.method || 'GET', json = (s, b) => ({ ok: s < 400, status: s, text: async () => JSON.stringify(b), json: async () => b });
    if (u.hostname === 'sb.test' && u.pathname === '/rest/v1/hostels') return json(200, [{ settings: global.__demo ? { demo: true } : {} }]);
    if (u.hostname === 'sb.test' && u.pathname === '/rest/v1/wa_gateways') {
      if (m === 'GET') return json(200, st.row ? [st.row] : []);
      if (m === 'POST') { st.row = JSON.parse(opt.body)[0]; return json(201, {}); }
      if (m === 'DELETE') { st.row = null; return json(200, {}); }
    }
    if (u.hostname === 'evo.example.com') {
      st.calls.push(`${m} ${u.pathname} ${opt.headers.apikey}`);
      if (m === 'POST' && u.pathname === '/instance/create') return json(201, { hash: 'tok-1', qrcode: { base64: 'data:image/png;base64,AAA' } });
      if (u.pathname.startsWith('/instance/connectionState/')) return json(200, { instance: { state: st.state } });
      if (u.pathname.startsWith('/instance/connect/')) return json(200, { base64: 'BBB' });
      if (m === 'DELETE') return json(200, {});
      if (u.pathname.startsWith('/message/sendText/')) { st.sent.push({ path: u.pathname, key: opt.headers.apikey, body: JSON.parse(opt.body) }); return json(201, {}); }
    }
    return json(404, {});
  };
  return st;
}
const EVO = { hostel_id: H1, kind: 'evolution', url: 'https://evo.example.com', api_key: 'tok-1', session: 'h-' + H1 };

test('connect: owner gets a QR from the shared server; the instance token is what is stored', async () => {
  process.env.EVOLUTION_URL = 'https://evo.example.com'; process.env.EVOLUTION_API_KEY = 'global-key';
  const st = fakeEvo(null);
  await assert.rejects(actions.connect({ hostel_id: H1 }, cook), /Only the owner/);
  const r = await actions.connect({ hostel_id: H1 }, owner);
  assert.equal(r.state, 'close'); assert.equal(r.qr, 'data:image/png;base64,AAA');
  assert.equal(st.row.api_key, 'tok-1', 'the hostel only ever holds its own instance token');
  assert.equal(st.row.session, 'h-' + H1); assert.equal(st.row.kind, 'evolution');
  assert.equal(st.calls[0], 'POST /instance/create global-key', 'only creating the instance uses the platform key');
  // second time: no new instance, a fresh QR instead
  st.calls.length = 0;
  const again = await actions.connect({ hostel_id: H1 }, owner);
  assert.equal(again.qr, 'data:image/png;base64,BBB');
  assert.equal(st.calls.some(c => c.includes('/instance/create')), false);
});

test('connect: once the phone has scanned, state is open and no QR is sent', async () => {
  process.env.EVOLUTION_URL = 'https://evo.example.com'; process.env.EVOLUTION_API_KEY = 'global-key';
  fakeEvo({ ...EVO }, 'open');
  assert.deepEqual(await actions.connect({ hostel_id: H1 }, owner), { state: 'open' });
  assert.deepEqual(await actions.state({ hostel_id: H1 }, owner), { state: 'open' });
});

test('connect: says so plainly when the shared server is not configured', async () => {
  delete process.env.EVOLUTION_URL; delete process.env.EVOLUTION_API_KEY;
  fakeEvo(null);
  await assert.rejects(actions.connect({ hostel_id: H1 }, owner), /not set up yet/);
  assert.deepEqual(await actions.state({ hostel_id: H1 }, owner), { state: 'none' });
});

test('turning it off logs the phone out, deletes the instance and forgets the key', async () => {
  process.env.EVOLUTION_URL = 'https://evo.example.com'; process.env.EVOLUTION_API_KEY = 'global-key';
  const st = fakeEvo({ ...EVO }, 'open');
  await actions.remove({ hostel_id: H1 }, owner);
  assert.equal(st.row, null);
  assert.ok(st.calls.includes(`DELETE /instance/logout/h-${H1} tok-1`));
  assert.ok(st.calls.includes(`DELETE /instance/delete/h-${H1} global-key`));
});

test('send on a connected hostel uses that hostel\'s own instance', async () => {
  process.env.EVOLUTION_URL = 'https://evo.example.com'; process.env.EVOLUTION_API_KEY = 'global-key';
  const st = fakeEvo({ ...EVO }, 'open');
  const r = await actions.send({ hostel_id: H1, messages: [{ phone: '9876543210', text: 'Rent due' }] }, owner);
  assert.equal(r.results[0].ok, true);
  assert.equal(st.sent[0].path, `/message/sendText/h-${H1}`); assert.equal(st.sent[0].key, 'tok-1');
});

test('the demo hostel never sends: no gateway can be connected or used, whoever asks', async () => {
  process.env.EVOLUTION_URL = 'https://evo.example.com'; process.env.EVOLUTION_API_KEY = 'global-key';
  global.__demo = true;
  try {
    const st = fakeEvo(null);
    await assert.rejects(actions.connect({ hostel_id: H1 }, owner), /demo hostel/);
    await assert.rejects(actions.save({ hostel_id: H1, url: 'https://gw.example.com', api_key: 'k' }, owner), /demo hostel/);
    fakeEvo({ ...EVO }, 'open');
    await assert.rejects(actions.send({ hostel_id: H1, messages: [{ phone: '9876543210', text: 'x' }] }, owner), /demo hostel/);
    assert.equal(st.sent.length, 0);
  } finally { global.__demo = false; }
});
