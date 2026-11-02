// Tests for api/public.js (gate QR, join QR) and the document sweep in api/admin.js, with a
// fake Supabase (no network, no credentials).
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.CRON_SECRET = 'cron-secret-123';

const { visit, join } = require('../api/public.js')._internals;
const admin = require('../api/admin.js');

const H1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ORG1 = '11111111-1111-4111-8111-111111111111';
const APP = '0123456789abcdef0123';
const HOSTEL = { id: H1, org_id: ORG1, name: 'Sunrise Boys PG', settings: { gate: { visitKey: 'gate-key-123456' }, join: { key: 'join-key-123456' } } };

function fakeNet({ garbage = [] } = {}) {
  const calls = [], state = { docs: [], garbage: garbage.slice(), deleted: [] };
  global.fetch = async (url, opt = {}) => {
    const u = new URL(url), method = opt.method || 'GET';
    calls.push({ url, method, auth: (opt.headers || {}).Authorization });
    const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
    if (u.pathname === '/rest/v1/hostels') {
      const want = (u.searchParams.get('id') || '').replace('eq.', '');
      return json(200, [HOSTEL].filter(h => !want || h.id === want));
    }
    if (u.pathname === '/rest/v1/docs' && method === 'POST') { state.docs.push(...JSON.parse(opt.body)); return json(201, null); }
    if (u.pathname.startsWith('/storage/v1/object/upload/sign/docs/')) {
      return json(200, { url: u.pathname.replace('/storage/v1', '') + '?token=tok' });
    }
    if (u.pathname === '/rest/v1/rpc/doc_files_garbage') return json(200, state.garbage.splice(0, 1000));
    if (u.pathname === '/storage/v1/object/docs' && method === 'DELETE') { state.deleted.push(...JSON.parse(opt.body).prefixes); return json(200, []); }
    if (u.pathname === '/auth/v1/user') return json(opt.headers.Authorization === 'Bearer super' ? 200 : 401, { id: 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee' });
    if (u.pathname === '/rest/v1/profiles') return json(200, [{ id: 'x', active: true, is_super: true }]);
    if (u.pathname === '/rest/v1/members') return json(200, []);
    return json(404, { message: 'not mocked ' + u.pathname });
  };
  return { calls, state };
}

let ipN = 0;
async function call(fn, body, req = {}) {
  let status = 200, out = null;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(o) { out = o; } };
  try { await fn({ method: 'POST', headers: { 'x-forwarded-for': 'ip-' + ipN++ }, body, ...req }, res); }
  catch (e) { status = e.status || 500; out = { error: e.message }; }
  return { status, out };
}

/* ------------------------------------------------------------------ gate QR */
test('visitor QR: a wrong or missing key is refused', async () => {
  fakeNet();
  assert.equal((await call(visit, { action: 'info', h: H1, k: 'wrong-key-000000' })).status, 403);
  assert.equal((await call(visit, { action: 'info', h: H1, k: '' })).status, 403);
  const ok = await call(visit, { action: 'info', h: H1, k: 'gate-key-123456' });
  assert.equal(ok.status, 200); assert.equal(ok.out.name, 'Sunrise Boys PG');
});

test('visitor QR: an entry lands in the gate register with a notification, phone checked, no photo', async () => {
  const { state } = fakeNet();
  assert.equal((await call(visit, { action: 'submit', h: H1, k: 'gate-key-123456', entry: { name: 'Ramesh', phone: '12' } })).status, 400);
  const r = await call(visit, { action: 'submit', h: H1, k: 'gate-key-123456', entry: { name: 'Ramesh (father)', phone: '+91 98765 43210', meet: 'Aman', roomNo: '102', photoId: 'x'.repeat(20) } });
  assert.equal(r.status, 200);
  const [g, n] = state.docs;
  assert.equal(g.kind, 'gate'); assert.equal(g.data.self, true); assert.equal(g.data.phone, '9876543210');
  assert.equal('photo' in g.data, false, 'visitor photos are not kept any more');
  assert.equal(n.kind, 'ntf'); assert.equal(n.data.to, 'admin'); assert.equal(n.id, 'ntf-' + g.id);
  assert.equal((await call(visit, { action: 'photo', h: H1, k: 'gate-key-123456' })).status, 400);
});

/* ------------------------------------------------------------------ join QR */
test('join QR: a paper gets a one-time upload URL inside this application\'s own folder', async () => {
  const { calls } = fakeNet();
  const r = await call(join, { action: 'doc', h: H1, k: 'join-key-123456', app: APP, label: 'Aadhaar card', mime: 'image/webp', size: 120000 });
  assert.equal(r.status, 200);
  assert.match(r.out.path, new RegExp(`^${H1}/signup/${APP}/aadhaar-card-[0-9a-f]{8}\\.webp$`));
  assert.ok(r.out.url.startsWith('https://sb.test/storage/v1/object/upload/sign/docs/' + r.out.path));
  assert.ok(!JSON.stringify(r.out).includes('service'), 'the service key never reaches the phone');
  assert.equal(calls.find(c => c.url.includes('/upload/sign/')).auth, 'Bearer service');
});

test('join QR: wrong key, bad application id, wrong type or too big is refused', async () => {
  fakeNet();
  const base = { action: 'doc', h: H1, k: 'join-key-123456', app: APP, label: 'Aadhaar card', mime: 'image/jpeg', size: 1000 };
  assert.equal((await call(join, { ...base, k: 'nope-nope-nope-0' })).status, 403);
  assert.equal((await call(join, { ...base, app: '../../etc' })).status, 400);
  assert.equal((await call(join, { ...base, mime: 'text/html' })).status, 400);
  assert.equal((await call(join, { ...base, size: 4 * 1024 * 1024 })).status, 400);
  assert.equal((await call(join, { ...base, size: 0 })).status, 400);
});

test('join QR: the application may only point at papers in its own folder', async () => {
  const { state } = fakeNet();
  const mine = `${H1}/signup/${APP}/aadhaar-card-0a1b2c3d.jpg`;
  const r = await call(join, { action: 'submit', h: H1, k: 'join-key-123456', app: APP, entry: {
    name: 'Aman Gupta', phone: '9812300001',
    docs: [
      { type: 'Aadhaar card', path: mine },
      { type: 'Stolen', path: `${H1}/res/res-1/aadhaar-card-ffffffff.jpg` },
      { type: 'Other hostel', path: `bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb/signup/${APP}/x.jpg` },
      { type: 'Escape', path: `${H1}/signup/${APP}/../../res/x.jpg` },
    ],
  } });
  assert.equal(r.status, 200);
  const [s] = state.docs;
  assert.equal(s.kind, 'signup'); assert.equal(s.id, 'signup-' + APP);
  assert.deepEqual(s.data.docs.map(d => d.path), [mine]);
  assert.equal(s.data.status, 'pending');
});

test('join QR: info falls back to the app\'s default papers', async () => {
  fakeNet();
  const r = await call(join, { action: 'info', h: H1, k: 'join-key-123456' });
  assert.deepEqual(r.out.docs, ['Aadhaar card', 'Passport photo']);
  assert.equal(r.out.upload, true);
});

/* ------------------------------------------------------------------ document sweep */
async function callAdmin(req) {
  let status = 0, out = null;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(o) { out = o; } };
  await admin({ headers: {}, ...req }, res);
  return { status, out };
}

test('the nightly sweep needs the cron secret', async () => {
  const { state } = fakeNet({ garbage: ['a/b/c.jpg'] });
  assert.equal((await callAdmin({ method: 'GET', url: '/api/admin?cron=sweep' })).status, 401);
  assert.equal((await callAdmin({ method: 'GET', url: '/api/admin?cron=sweep', headers: { authorization: 'Bearer wrong-secret-12' } })).status, 401);
  assert.deepEqual(state.deleted, [], 'nothing deleted without the secret');
  const r = await callAdmin({ method: 'GET', url: '/api/admin?cron=sweep', headers: { authorization: 'Bearer cron-secret-123' } });
  assert.equal(r.status, 200); assert.equal(r.out.removed, 1);
  assert.deepEqual(state.deleted, ['a/b/c.jpg']);
});

test('the sweep deletes in batches of 1000 and stops when nothing is left', async () => {
  const names = Array.from({ length: 2300 }, (_, i) => `${H1}/res/r${i}/x.jpg`);
  const { state, calls } = fakeNet({ garbage: names });
  const r = await callAdmin({ method: 'GET', url: '/api/admin?cron=sweep', headers: { authorization: 'Bearer cron-secret-123' } });
  assert.equal(r.out.removed, 2300);
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 3);
});

test('a super admin can run the sweep by hand; nobody else can', async () => {
  fakeNet({ garbage: [] });
  assert.equal((await callAdmin({ method: 'POST', headers: { authorization: 'Bearer someone' }, body: { action: 'sweep_files' } })).status, 401);
  const r = await callAdmin({ method: 'POST', headers: { authorization: 'Bearer super' }, body: { action: 'sweep_files' } });
  assert.equal(r.status, 200); assert.equal(r.out.removed, 0);
});

// ---- public hostel page (production readiness audit, 2026-11-02)
test('public page: a GET is answered with a CDN-cacheable reply; every closed gate looks like a wrong address', async () => {
  const { site } = require('../api/public.js')._internals;
  const page = (over = {}) => ({ id: H1, org_id: ORG1, name: 'Sunrise', status: 'active', modules: {}, settings: { site: { on: true, slug: 'sunrise' } }, ...over });
  const run = async (h, o, url) => {
    global.fetch = async u => {
      const p = new URL(u).pathname, j = b => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
      return p === '/rest/v1/hostels' ? j(h ? [h] : []) : p === '/rest/v1/orgs' ? j([o]) : j([]);
    };
    const hdr = {}; let status = 200, out = null;
    const res = { setHeader(k, v) { hdr[k] = v; }, status(s) { status = s; return this; }, json(x) { out = x; } };
    try { await site({ method: 'GET', url, headers: { 'x-forwarded-for': 'ip-' + ipN++ } }, res); } catch (e) { status = e.status; }
    return { status, out, hdr };
  };
  const ok = await run(page(), { status: 'active', modules: {} }, '/api/public/site?s=sunrise');
  assert.equal(ok.status, 200);
  assert.equal(ok.out.name, 'Sunrise');
  assert.match(ok.hdr['Cache-Control'], /s-maxage=300/);
  assert.equal((await run(page(), { status: 'active', modules: {} }, '/api/public/site?h=' + H1)).status, 200);
  for (const [h, o] of [
    [page({ status: 'paused' }), { status: 'active', modules: {} }],
    [page(), { status: 'suspended', modules: {} }],
    [page(), { status: 'active', modules: { landing: false } }],
    [page({ modules: { landing: false } }), { status: 'active', modules: {} }],
    [page({ settings: { site: { on: false, slug: 'sunrise' } } }), { status: 'active', modules: {} }],
    [null, { status: 'active', modules: {} }],
  ]) assert.equal((await run(h, o, '/api/public/site?s=sunrise')).status, 404);
  assert.equal((await run(page(), { status: 'active', modules: {} }, '/api/public/site?s=' + encodeURIComponent("x'),or=(id"))).status, 404);
});
