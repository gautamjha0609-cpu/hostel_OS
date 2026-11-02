// Permission tests for api/admin.js with a fake Supabase (no network).
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.SETUP_KEY = 'setup-secret';
const handler = require('../api/admin.js');

// Real uuids — orgs, hostels and users are all uuid columns in Postgres.
const ORG1 = '11111111-1111-4111-8111-111111111111';
const ORG2 = '22222222-2222-4222-8222-222222222222';
const H1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const H2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const U_OWNER = 'cccccccc-1111-4111-8111-cccccccccccc';
const U_COOK = 'dddddddd-2222-4222-8222-dddddddddddd';
const U_SUPER = 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee';
const U_MGR = 'ffffffff-4444-4444-8444-ffffffffffff';
const NEW_USER = '99999999-9999-4999-8999-999999999999';

// Fake Supabase: users by token, profiles, members.
function fakeSupabase(db) {
  const calls = [];
  global.fetch = async (url, opt = {}) => {
    calls.push({ url, method: opt.method || 'GET', body: opt.body });
    const u = new URL(url), auth = (opt.headers && opt.headers.Authorization) || '';
    const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
    if (u.pathname === '/auth/v1/user') { const user = db.tokens[auth.replace('Bearer ', '')]; return user ? json(200, user) : json(401, { msg: 'bad jwt' }); }
    if (u.pathname === '/rest/v1/profiles' && (opt.method || 'GET') === 'GET') {
      const id = (u.searchParams.get('id') || '').replace('eq.', ''), un = (u.searchParams.get('username') || '').replace('eq.', '');
      return json(200, db.profiles.filter(p => (id && p.id === id) || (un && p.username === decodeURIComponent(un)) || (u.searchParams.get('is_super') && p.is_super)));
    }
    if (u.pathname === '/rest/v1/members' && (opt.method || 'GET') === 'GET') { const uid = (u.searchParams.get('user_id') || '').replace('eq.', ''); return json(200, db.members.filter(m => m.user_id === uid)); }
    if (u.pathname === '/rest/v1/hostels' && (opt.method || 'GET') === 'GET') { const id = (u.searchParams.get('id') || '').replace('eq.', ''); return json(200, (db.hostels || []).filter(h => h.id === id)); }
    if (u.pathname === '/auth/v1/admin/users' && opt.method === 'POST') return json(200, { id: NEW_USER });
    if (u.pathname.startsWith('/rest/v1/') && opt.method === 'POST') return json(201, [{ id: 'row', ...JSON.parse(opt.body) }]);
    if (u.pathname.startsWith('/auth/v1/admin/users/') || opt.method === 'PATCH' || opt.method === 'DELETE') return json(200, {});
    return json(404, { message: 'not mocked ' + u.pathname });
  };
  return calls;
}
const db = {
  tokens: { owner: { id: U_OWNER }, cook: { id: U_COOK }, super: { id: U_SUPER }, mgr: { id: U_MGR } },
  profiles: [{ id: U_OWNER, username: 'owner', active: true, is_super: false }, { id: U_COOK, username: 'cook', active: true, is_super: false }, { id: U_SUPER, username: 'admin', active: true, is_super: true }, { id: U_MGR, username: 'mgr', active: true, is_super: false }],
  hostels: [{ id: H1, org_id: ORG1, blocks: [] }, { id: H2, org_id: ORG1, blocks: [] }],
  members: [{ user_id: U_OWNER, org_id: ORG1, hostel_id: null, role: 'owner', active: true }, { user_id: U_COOK, org_id: ORG1, hostel_id: H1, role: 'cook', active: true }, { user_id: U_MGR, org_id: ORG1, hostel_id: H1, role: 'manager', active: true }],
};
let ipN = 0;
async function call(token, body, ip = 'ip-' + ipN++) {
  let status = 0, out = null;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(o) { out = o; } };
  await handler({ method: 'POST', headers: { 'x-forwarded-for': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body }, res);
  return { status, out };
}

test('rejects calls without a login', async () => {
  fakeSupabase(db);
  const r = await call(null, { action: 'create_user', org_id: ORG1, role: 'cook', full_name: 'X', phone: '9876543210' });
  assert.equal(r.status, 401);
});

test('owner can create a cook login in their own org', async () => {
  fakeSupabase(db);
  const r = await call('owner', { action: 'create_user', org_id: ORG1, hostel_id: H1, role: 'cook', full_name: 'Raju Cook', phone: '9876543210' });
  assert.equal(r.status, 200);
  assert.equal(r.out.username, 'raju.cook');
  assert.equal(r.out.password, '9876543210');
});

test('owner cannot create users in another org, or create owners', async () => {
  fakeSupabase(db);
  assert.equal((await call('owner', { action: 'create_user', org_id: ORG2, role: 'cook', full_name: 'X', phone: '9876543210' })).status, 403);
  assert.equal((await call('owner', { action: 'create_user', org_id: ORG1, role: 'owner', full_name: 'X', phone: '9876543210' })).status, 403);
});

test('cook cannot manage users', async () => {
  fakeSupabase(db);
  assert.equal((await call('cook', { action: 'create_user', org_id: ORG1, role: 'cook', full_name: 'X', phone: '9876543210' })).status, 403);
});

test('only super admin can create clients and delete users', async () => {
  fakeSupabase(db);
  assert.equal((await call('owner', { action: 'create_org', org: { name: 'X' } })).status, 403);
  assert.equal((await call('owner', { action: 'delete_user', user_id: U_COOK })).status, 403);
  assert.equal((await call('super', { action: 'delete_user', user_id: U_COOK })).status, 200);
});

test('setup needs the setup key and only works once', async () => {
  fakeSupabase(db);
  assert.equal((await call(null, { action: 'setup', key: 'wrong' })).status, 403);
  assert.equal((await call(null, { action: 'setup', key: 'setup-secret', full_name: 'A', password: 'longpassword' })).status, 400); // super exists
});

/* --- regressions: privilege escalation and input validation ------------------- */

test('a hostel-scoped manager cannot create an org-wide login', async () => {
  fakeSupabase(db);
  // mgr administers H1 only. Omitting hostel_id used to create a membership with
  // hostel_id = null, which grants every hostel in the org.
  const r = await call('mgr', { action: 'create_user', org_id: ORG1, role: 'cook', full_name: 'X', phone: '9876543210' });
  assert.equal(r.status, 403);
});

test('a hostel-scoped manager cannot create a login in a hostel they do not manage', async () => {
  fakeSupabase(db);
  assert.equal((await call('mgr', { action: 'create_user', org_id: ORG1, hostel_id: H2, role: 'cook', full_name: 'X', phone: '9876543210' })).status, 403);
  assert.equal((await call('mgr', { action: 'create_user', org_id: ORG1, hostel_id: H1, role: 'cook', full_name: 'X', phone: '9876543210' })).status, 200);
});

test('membership rows take only whitelisted fields', async () => {
  const calls = fakeSupabase(db);
  const r = await call('owner', {
    action: 'create_user', org_id: ORG1, hostel_id: H1, role: 'cook', full_name: 'X', phone: '9876543210',
    perms: ['payments', 'not_a_module'], is_super: true, active: false, id: 'forged',
  });
  assert.equal(r.status, 200);
  const memberPost = calls.find(c => c.url.includes('/rest/v1/members') && c.method === 'POST');
  const row = JSON.parse(memberPost.body);
  assert.deepEqual(Object.keys(row).sort(), ['block', 'hostel_id', 'org_id', 'perms', 'ref_id', 'role', 'user_id']);
  assert.deepEqual(row.perms, ['payments']);          // unknown module dropped
  assert.equal(row.is_super, undefined);              // forged columns dropped
});

/* Renaming a login. The ID is half of how someone signs in and the password check actually
 * matches on an email built from it, so the rename has to touch auth as well as the profile —
 * and must never land on an ID somebody else already types. */
test('only the super admin can change a user ID, and only to a free, well-formed one', async () => {
  fakeSupabase(db);
  assert.equal((await call('owner', { action: 'set_username', user_id: U_COOK, username: 'newcook' })).status, 403);
  assert.equal((await call('mgr',   { action: 'set_username', user_id: U_COOK, username: 'newcook' })).status, 403);
  // a dash or underscore would be stored in the sign-in email but turned into a dot by the login screen, so that login could never work
  for (const bad of ['ab', '-starts-with-dash', 'has space', 'x'.repeat(31), 'ravi-kumar', 'ravi_kumar', 'double..dot', 'trailing.', 'UPPER space']) {
    assert.equal((await call('super', { action: 'set_username', user_id: U_COOK, username: bad })).status, 400, bad);
  }
  // "owner" is already somebody else's ID
  assert.equal((await call('super', { action: 'set_username', user_id: U_COOK, username: 'owner' })).status, 409);
  // its own current ID is a no-op, not a clash
  assert.equal((await call('super', { action: 'set_username', user_id: U_COOK, username: 'cook' })).status, 200);
});

test('a rename moves the auth email and the profile together', async () => {
  const calls = fakeSupabase(db);
  assert.equal((await call('super', { action: 'set_username', user_id: U_COOK, username: 'raju.cook' })).status, 200);
  const authPut = calls.find(c => c.url.includes('/auth/v1/admin/users/') && c.method === 'PUT');
  const profPatch = calls.find(c => c.url.includes('/rest/v1/profiles') && c.method === 'PATCH');
  assert.ok(authPut, 'the sign-in email was updated');
  assert.match(JSON.parse(authPut.body).email, /^raju\.cook@/);
  assert.ok(profPatch, 'the profile was updated');
  assert.equal(JSON.parse(profPatch.body).username, 'raju.cook');
  // auth first: if that fails the old ID keeps working rather than half-renaming the account
  assert.ok(calls.indexOf(authPut) < calls.indexOf(profPatch), 'auth is changed before the profile');
});

test('ids that are not uuids are refused before any Supabase call', async () => {
  fakeSupabase(db);
  assert.equal((await call('super', { action: 'delete_user', user_id: '../../admin' })).status, 400);
  assert.equal((await call('super', { action: 'set_password', user_id: 'x&select=*', password: 'longenough' })).status, 400);
  assert.equal((await call('owner', { action: 'create_user', org_id: 'o1', role: 'cook', full_name: 'X', phone: '9876543210' })).status, 400);
});

test('setup is rate limited per IP', async () => {
  fakeSupabase(db);
  let last = 0;
  for (let i = 0; i < 7; i++) last = (await call(null, { action: 'setup', key: 'wrong' }, 'same-ip')).status;
  assert.equal(last, 429);
});

/* ---- production hardening: bounded calls, odd replies, no orphan logins ---- */
const lib = require('../api/_lib.js');

test('a Supabase call that never answers is cut off with a readable 504', async () => {
  global.fetch = (url, opt) => new Promise((_, rej) => { opt.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); });
  await assert.rejects(lib.sb('/rest/v1/docs', { timeout: 20 }), e => e.status === 504 && /too long/.test(e.message));
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(lib.sb('/rest/v1/docs'), e => e.status === 504 && /Could not reach/.test(e.message));
});

test('an HTML error page from the edge is a 502, not a crash', async () => {
  global.fetch = async () => ({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' });
  await assert.rejects(lib.sb('/rest/v1/docs'), e => e.status === 502);
  global.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>oops</html>' });
  await assert.rejects(lib.sb('/rest/v1/docs'), e => e.status === 502 && /Unexpected reply/.test(e.message));
});

test('a request body that is not JSON is a 400 from the caller, not a 500', async () => {
  await assert.rejects(lib.readJson({ body: '{not json' }), e => e.status === 400);
  assert.deepEqual(await lib.readJson({ body: { a: 1 } }), { a: 1 });
});

test('who is calling is looked up once per few seconds, not on every request', async () => {
  const calls = fakeSupabase({ ...db, tokens: { 'tok-cache': { id: U_OWNER } } });
  const req = { headers: { authorization: 'Bearer tok-cache' } };
  const a = await lib.caller(req), b = await lib.caller(req);
  assert.equal(a, b);
  assert.equal(calls.filter(c => c.url.includes('/auth/v1/user')).length, 1);
  assert.equal(calls.filter(c => c.url.includes('/rest/v1/members')).length, 1);
  fakeSupabase(db);
  await assert.rejects(lib.caller({ headers: { authorization: 'Bearer nobody' } }), e => e.status === 401);
});

test('if a membership cannot be saved, the login just created is removed again', async () => {
  const calls = fakeSupabase(db);
  const inner = global.fetch;
  global.fetch = async (url, opt = {}) => (new URL(url).pathname === '/rest/v1/members' && opt.method === 'POST')
    ? { ok: false, status: 500, text: async () => JSON.stringify({ message: 'boom' }) } : inner(url, opt);
  const r = await call('super', { action: 'create_user', org_id: ORG1, role: 'cook', full_name: 'Rollback Test', phone: '9876543210' });
  assert.notEqual(r.status, 200);
  assert.ok(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/auth/v1/admin/users/' + NEW_USER)), 'no login is left without a role');
});

// ---- production readiness audit, 2026-11-02
const H_OTHER = 'abababab-3333-4333-8333-abababababab';
test('nobody can attach a login to a hostel of another client', async () => {
  fakeSupabase({ ...db, hostels: [...db.hostels, { id: H_OTHER, org_id: ORG2, blocks: [] }] });
  assert.equal((await call('owner', { action: 'create_user', org_id: ORG1, hostel_id: H_OTHER, role: 'cook', full_name: 'X', phone: '9876543210' })).status, 403);
  assert.equal((await call('super', { action: 'create_user', org_id: ORG1, hostel_id: H_OTHER, role: 'cook', full_name: 'X', phone: '9876543210' })).status, 403);
});
test('a password reset needs authority over every membership the person holds', async () => {
  const U_TWO = '12121212-1212-4212-8212-121212121212', U_OTHERMGR = '34343434-3434-4434-8434-343434343434';
  fakeSupabase({ ...db,
    profiles: [...db.profiles, { id: U_TWO, username: 'two', active: true, is_super: false }, { id: U_OTHERMGR, username: 'm2', active: true, is_super: false }],
    members: [...db.members,
      { user_id: U_TWO, org_id: ORG1, hostel_id: H1, role: 'cook', active: true }, { user_id: U_TWO, org_id: ORG2, hostel_id: null, role: 'manager', active: true },
      { user_id: U_OTHERMGR, org_id: ORG1, hostel_id: H1, role: 'manager', active: true }] });
  // also a manager of another client: the owner of ORG1 must not be able to take that login over
  assert.equal((await call('owner', { action: 'set_password', user_id: U_TWO, password: 'longenough' })).status, 403);
  // a peer manager cannot reset another manager; the owner can
  assert.equal((await call('mgr', { action: 'set_password', user_id: U_OTHERMGR, password: 'longenough' })).status, 403);
  assert.equal((await call('owner', { action: 'set_password', user_id: U_OTHERMGR, password: 'longenough' })).status, 200);
  // the platform admin's login is never an owner's to reset
  assert.equal((await call('owner', { action: 'set_password', user_id: U_SUPER, password: 'longenough' })).status, 403);
  // the ordinary case still works
  assert.equal((await call('mgr', { action: 'set_password', user_id: U_COOK, password: 'longenough' })).status, 200);
});
