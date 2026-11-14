// Multi-tenant isolation and cross-tenant boundary verification tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.SETUP_KEY = 'setup-secret';
const adminHandler = require('../api/admin.js');
const publicHandler = require('../api/public.js');

// Test UUIDs
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const H_A1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const H_A2 = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
const H_B1 = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';

const U_OWNER_A = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa';
const U_MGR_A1 = 'aaaaaaaa-0001-4001-8001-aaaaaaaaaaaa';
const U_STAFF_A1 = 'aaaaaaaa-0002-4002-8002-aaaaaaaaaaaa';
const U_RES_A1 = 'aaaaaaaa-0003-4003-8003-aaaaaaaaaaaa';

const U_OWNER_B = 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb';
const U_MGR_B1 = 'bbbbbbbb-0001-4001-8001-bbbbbbbbbbbb';

const U_SUPER = 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee';
const NEW_USER_ID = '99999999-9999-4999-8999-999999999999';

function createMockDb() {
  return {
    tokens: {
      owner_a: { id: U_OWNER_A },
      mgr_a1: { id: U_MGR_A1 },
      staff_a1: { id: U_STAFF_A1 },
      res_a1: { id: U_RES_A1 },
      owner_b: { id: U_OWNER_B },
      mgr_b1: { id: U_MGR_B1 },
      super: { id: U_SUPER },
    },
    profiles: [
      { id: U_OWNER_A, username: 'owner_a', active: true, is_super: false },
      { id: U_MGR_A1, username: 'mgr_a1', active: true, is_super: false },
      { id: U_STAFF_A1, username: 'staff_a1', active: true, is_super: false },
      { id: U_RES_A1, username: 'res_a1', active: true, is_super: false },
      { id: U_OWNER_B, username: 'owner_b', active: true, is_super: false },
      { id: U_MGR_B1, username: 'mgr_b1', active: true, is_super: false },
      { id: U_SUPER, username: 'admin', active: true, is_super: true },
    ],
    hostels: [
      { id: H_A1, org_id: ORG_A, name: 'Hostel A1', blocks: [] },
      { id: H_A2, org_id: ORG_A, name: 'Hostel A2', blocks: [] },
      { id: H_B1, org_id: ORG_B, name: 'Hostel B1', blocks: [] },
    ],
    members: [
      { user_id: U_OWNER_A, org_id: ORG_A, hostel_id: null, role: 'owner', active: true },
      { user_id: U_MGR_A1, org_id: ORG_A, hostel_id: H_A1, role: 'manager', active: true },
      { user_id: U_STAFF_A1, org_id: ORG_A, hostel_id: H_A1, role: 'cook', active: true },
      { user_id: U_RES_A1, org_id: ORG_A, hostel_id: H_A1, role: 'resident', ref_id: 'res_001', active: true },
      { user_id: U_OWNER_B, org_id: ORG_B, hostel_id: null, role: 'owner', active: true },
      { user_id: U_MGR_B1, org_id: ORG_B, hostel_id: H_B1, role: 'manager', active: true },
    ],
  };
}

function mockSupabase(db) {
  const calls = [];
  global.fetch = async (url, opt = {}) => {
    calls.push({ url, method: opt.method || 'GET', body: opt.body });
    const u = new URL(url);
    const auth = (opt.headers && opt.headers.Authorization) || '';
    const token = auth.replace('Bearer ', '');
    const json = (status, body) => ({
      ok: status < 400,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    });

    if (u.pathname === '/auth/v1/user') {
      const user = db.tokens[token];
      return user ? json(200, user) : json(401, { msg: 'bad jwt' });
    }
    if (u.pathname === '/rest/v1/profiles' && (opt.method || 'GET') === 'GET') {
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      const un = (u.searchParams.get('username') || '').replace('eq.', '');
      return json(200, db.profiles.filter(p => (id && p.id === id) || (un && p.username === decodeURIComponent(un))));
    }
    if (u.pathname === '/rest/v1/members' && (opt.method || 'GET') === 'GET') {
      const uid = (u.searchParams.get('user_id') || '').replace('eq.', '');
      return json(200, db.members.filter(m => m.user_id === uid));
    }
    if (u.pathname === '/rest/v1/hostels' && (opt.method || 'GET') === 'GET') {
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      return json(200, db.hostels.filter(h => h.id === id));
    }
    if (u.pathname === '/auth/v1/admin/users' && opt.method === 'POST') {
      return json(200, { id: NEW_USER_ID });
    }
    if (u.pathname.startsWith('/rest/v1/members') && opt.method === 'POST') {
      return json(201, [{ id: 'm-new', ...JSON.parse(opt.body) }]);
    }
    if (u.pathname.startsWith('/auth/v1/admin/users/') || opt.method === 'PATCH' || opt.method === 'DELETE') {
      return json(200, {});
    }
    return json(404, { message: 'not mocked ' + u.pathname });
  };
  return calls;
}

let callN = 0;
async function callAdmin(token, body) {
  let status = 0;
  let out = null;
  const res = {
    setHeader() {},
    status(s) { status = s; return this; },
    json(o) { out = o; },
  };
  await adminHandler(
    {
      method: 'POST',
      headers: {
        'x-forwarded-for': '127.0.0.' + (++callN % 250),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body,
    },
    res
  );
  return { status, out };
}

test('multi-tenant: Owner of Org A cannot create users in Org B', async () => {
  const db = createMockDb();
  mockSupabase(db);
  const res = await callAdmin('owner_a', {
    action: 'create_user',
    org_id: ORG_B,
    hostel_id: H_B1,
    role: 'cook',
    full_name: 'Attacker Cook',
    phone: '9876543210',
  });
  assert.equal(res.status, 403, 'cross-org user creation must be forbidden');
});

test('multi-tenant: Manager of Hostel A1 cannot create users in Hostel A2', async () => {
  const db = createMockDb();
  mockSupabase(db);
  const res = await callAdmin('mgr_a1', {
    action: 'create_user',
    org_id: ORG_A,
    hostel_id: H_A2,
    role: 'cook',
    full_name: 'Cross Hostel Cook',
    phone: '9876543210',
  });
  assert.equal(res.status, 403, 'cross-hostel user creation by scoped manager must be forbidden');
});

test('multi-tenant: Manager of Hostel A1 cannot attach user to Hostel B1', async () => {
  const db = createMockDb();
  mockSupabase(db);
  const res = await callAdmin('mgr_a1', {
    action: 'create_user',
    org_id: ORG_A,
    hostel_id: H_B1,
    role: 'cook',
    full_name: 'Foreign Hostel Cook',
    phone: '9876543210',
  });
  assert.equal(res.status, 403, 'manager attaching hostel from another org must be rejected');
});

test('multi-tenant: Cook or Resident cannot perform administrative actions', async () => {
  const db = createMockDb();
  mockSupabase(db);
  for (const roleToken of ['staff_a1', 'res_a1']) {
    const res = await callAdmin(roleToken, {
      action: 'create_user',
      org_id: ORG_A,
      hostel_id: H_A1,
      role: 'cook',
      full_name: 'Unauthorized User',
      phone: '9876543210',
    });
    assert.equal(res.status, 403, `${roleToken} must not be allowed to create users`);
  }
});

test('multi-tenant: Owner of Org A cannot reset password for user in Org B', async () => {
  const db = createMockDb();
  mockSupabase(db);
  const res = await callAdmin('owner_a', {
    action: 'set_password',
    user_id: U_MGR_B1,
    password: 'newpassword123',
  });
  assert.equal(res.status, 403, 'owner must not be able to reset passwords of users in other orgs');
});

test('multi-tenant: Owner of Org A cannot disable user in Org B', async () => {
  const db = createMockDb();
  mockSupabase(db);
  const res = await callAdmin('owner_a', {
    action: 'set_active',
    user_id: U_OWNER_B,
    active: false,
  });
  assert.equal(res.status, 403, 'owner must not be able to disable users in other orgs');
});

test('multi-tenant: Platform super admin can operate across orgs', async () => {
  const db = createMockDb();
  mockSupabase(db);
  const res = await callAdmin('super', {
    action: 'set_password',
    user_id: U_MGR_B1,
    password: 'newsuperpassword123',
  });
  assert.equal(res.status, 200, 'super admin must be permitted to manage users across orgs');
});
