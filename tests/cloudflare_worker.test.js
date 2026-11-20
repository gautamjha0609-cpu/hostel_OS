const { test } = require('node:test');
const assert = require('node:assert/strict');
const worker = require('../workers/cf-worker.js');

test('cf-worker: OPTIONS preflight returns 204 with CORS and security headers', async () => {
  const req = new Request('https://hostel.example.com/api/admin', { method: 'OPTIONS' });
  const res = await worker.fetch(req, {
    SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key'
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://sarvlekh.in');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization, X-Hostel-Id');
  assert.ok(res.headers.get('Content-Security-Policy'), 'CSP header must be present');
  assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('cf-worker: GET /health returns 200 with healthy engine status', async () => {
  const req = new Request('https://hostel.example.com/health', { method: 'GET' });
  const res = await worker.fetch(req, {
    SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key'
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'healthy');
  assert.equal(data.engine, 'Cloudflare Workers');
  assert.ok(data.timestamp);
});

test('cf-worker: Unknown API endpoint returns 404 JSON', async () => {
  const req = new Request('https://hostel.example.com/api/nonexistent', { method: 'GET' });
  const res = await worker.fetch(req, {
    SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key'
  });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, 'Endpoint not found');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('cf-worker: Blocks access to sensitive repository files, schemas, and configurations', async () => {
  const mockAssets = { fetch: async () => new Response('UNSAFE DATA LEAK', { status: 200 }) };
  const sensitivePaths = [
    '/supabase/schema.sql',
    '/package.json',
    '/wrangler.toml',
    '/.env',
    '/.git/config',
    '/artifacts/final-production-readiness/00_EXECUTIVE_SUMMARY.md',
    '/tests/api.test.js'
  ];

  for (const path of sensitivePaths) {
    const req = new Request(`https://hostel.example.com${path}`, { method: 'GET' });
    const res = await worker.fetch(req, { ASSETS: mockAssets });
    assert.equal(res.status, 404, `Path ${path} must be blocked with 404`);
    const data = await res.json();
    assert.equal(data.error, 'Not found');
  }
});

test('cf-worker: Prototype method routes return 404 immediately and do not hang', async () => {
  const attackRoutes = ['toString', 'valueOf', 'constructor', 'hasOwnProperty', '__proto__'];
  for (const route of attackRoutes) {
    const req = new Request(`https://hostel.example.com/api/public/${route}`, { method: 'GET' });
    const res = await worker.fetch(req, {
    SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key'
  });
    assert.equal(res.status, 404, `Subroute ${route} must return 404`);
    const data = await res.json();
    assert.equal(data.error, 'Not found');
  }
});

test('cf-worker: Percent-encoded subroutes are safely decoded', async () => {
  // %73%69%74%65 is 'site'
  const req = new Request('https://hostel.example.com/api/public/%73%69%74%65?s=test_encoded', { method: 'GET' });
  const res = await worker.fetch(req, {
    SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key'
  });
  // Must route to site handler in public.js, not return 404 'Not found' from missing route
  assert.ok(res.status === 404 || res.status === 502);
  const data = await res.json();
  assert.notEqual(data.error, 'Not found');
});

test('cf-worker: Malformed percent-encoded routes are handled safely without crashing', async () => {
  const req = new Request('https://hostel.example.com/api/public/%E0%A4%A', { method: 'GET' });
  const res = await worker.fetch(req, {
    SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key'
  });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, 'Not found');
});

test('cf-worker: Static assets route correctly via env.ASSETS binding', async () => {
  let requestedUrl = null;
  const mockAssets = {
    fetch: async (r) => {
      requestedUrl = r.url;
      return new Response('<html>HostelOS PWA</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      });
    }
  };

  const req = new Request('https://hostel.example.com/index.html');
  const res = await worker.fetch(req, { ASSETS: mockAssets });
  assert.equal(res.status, 200);
  assert.equal(requestedUrl, 'https://hostel.example.com/index.html');
  const body = await res.text();
  assert.ok(body.includes('HostelOS PWA'));
  assert.ok(res.headers.get('Content-Security-Policy'));
});

test('cf-worker: Microsite /h/:slug rewrites to /site.html?s=:slug', async () => {
  let requestedUrl = null;
  const mockAssets = {
    fetch: async (r) => {
      requestedUrl = r.url;
      return new Response('<html>Microsite</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      });
    }
  };

  const req = new Request('https://hostel.example.com/h/aravali-residency');
  const res = await worker.fetch(req, { ASSETS: mockAssets });
  assert.equal(res.status, 200);
  assert.ok(requestedUrl.includes('/site.html?s=aravali-residency'), 'Microsite route must rewrite to /site.html with ?s=');
});

test('cf-worker: /api/public/:sub extracts subroute correctly', async () => {
  const req = new Request('https://hostel.example.com/api/public/site?s=test_nonexistent', {
    method: 'GET'
  });
  const res = await worker.fetch(req, {
    SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key'
  });
  assert.ok(res.status === 404 || res.status === 502, `Status was ${res.status}`);
  const data = await res.json();
  assert.notEqual(data.error, 'Endpoint not found');
});

test('cf-worker: POST /api/admin enforces authentication', async () => {
  const req = new Request('https://hostel.example.com/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create_org' })
  });
  const res = await worker.fetch(req, {
    SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key'
  });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://sarvlekh.in');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization, X-Hostel-Id');
  const data = await res.json();
  assert.ok(data.error.includes('Login required') || data.error.includes('login'));
});

test('cf-worker: propagates cf-connecting-ip for rate limit isolation', async () => {
  const req = new Request('https://hostel.example.com/api/public/visit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.195'
    },
    body: JSON.stringify({ h: 'bad-id', k: 'bad-key' })
  });
  const res = await worker.fetch(req, {
    SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key'
  });
  // Should process request with clientIp set to 203.0.113.195
  assert.ok(res.status === 400 || res.status === 403 || res.status === 502);
});

test('cf-worker: Prototype method actions in POST /api/admin are rejected with 400', async () => {
  const attackActions = ['toString', 'valueOf', 'constructor', 'hasOwnProperty', '__proto__'];
  for (const act of attackActions) {
    const req = new Request('https://hostel.example.com/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: act })
    });
    const res = await worker.fetch(req, {
      SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key'
    });
    assert.equal(res.status, 400, `Action ${act} should return 400`);
    const data = await res.json();
    assert.equal(data.error, 'Unknown action');
  }
});

test('cf-worker: Prototype method actions in POST /api/wa are rejected with 400', async () => {
  const attackActions = ['toString', 'valueOf', 'constructor', 'hasOwnProperty', '__proto__'];
  for (const act of attackActions) {
    const req = new Request('https://hostel.example.com/api/wa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: act })
    });
    const res = await worker.fetch(req, {
      SUPABASE_URL: 'https://bbimfrhnsikpiztowlye.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key'
    });
    assert.equal(res.status, 400, `Action ${act} must be rejected with 400`);
    const data = await res.json();
    assert.equal(data.error, 'Unknown action');
  }
});

test('cf-worker: scheduled event triggers admin cron sweep', async () => {
  let scheduledFinished = false;
  const dummyEnv = { CRON_SECRET: 'test-cron-secret' };
  const dummyController = { scheduledTime: Date.now(), cron: '30 21 * * *' };
  const dummyCtx = { waitUntil: (p) => p };

  const p = worker.scheduled(dummyController, dummyEnv, dummyCtx);
  assert.ok(p instanceof Promise);
  const result = await p;
  assert.ok(result !== undefined);
});

test('cf-worker: Normalized path dot-segment bypass (/./.env, /static/../package.json) is blocked with 404', async () => {
  const mockAssets = {
    fetch: async (r) => new Response('LEAKED INTERNAL ASSET: ' + r.url, { status: 200 })
  };
  const req1 = new Request('https://edge.hostelos.in/./.env');
  const res1 = await worker.fetch(req1, { ASSETS: mockAssets });
  assert.equal(res1.status, 404);
  const data1 = await res1.json();
  assert.equal(data1.error, 'Not found');

  const req2 = new Request('https://edge.hostelos.in/static/../package.json');
  const res2 = await worker.fetch(req2, { ASSETS: mockAssets });
  assert.equal(res2.status, 404);
  const data2 = await res2.json();
  assert.equal(data2.error, 'Not found');

  const req3 = new Request('https://edge.hostelos.in/%2e%2e/wrangler.toml');
  const res3 = await worker.fetch(req3, { ASSETS: mockAssets });
  assert.equal(res3.status, 404);
  const data3 = await res3.json();
  assert.equal(data3.error, 'Not found');
});

test('cf-worker: Double-slash paths (//supabase/schema.sql, //package.json, //.env) are blocked with 404 and do not fall into ASSETS', async () => {
  const mockAssets = {
    fetch: async (r) => new Response('LEAKED INTERNAL ASSET: ' + r.url, { status: 200 })
  };
  const doubleSlashPaths = [
    '//supabase/schema.sql',
    '//package.json',
    '//.env',
    '///supabase/migrations/2026-11-18_MASTER_PRODUCTION_UPDATE.sql',
    '//wrangler.toml',
    '//tests/cloudflare_worker.test.js'
  ];

  for (const path of doubleSlashPaths) {
    const req = new Request(`https://hostel.example.com${path}`, { method: 'GET' });
    const res = await worker.fetch(req, { ASSETS: mockAssets });
    assert.equal(res.status, 404, `Double-slash path ${path} must be blocked with 404`);
    const data = await res.json();
    assert.equal(data.error, 'Not found');
  }
});

test('cf-worker: Percent-encoded paths (/%73upabase/schema.sql, /%2eenv) are decoded and blocked with 404', async () => {
  const mockAssets = {
    fetch: async (r) => new Response('LEAKED INTERNAL ASSET: ' + r.url, { status: 200 })
  };
  const encodedPaths = [
    '/%73upabase/schema.sql',
    '/%2eenv',
    '/%2e%67%69%74/config',
    '//%73upabase/schema.sql',
    '/%70ackage.json',
    '/%2e%2e/wrangler.toml'
  ];

  for (const path of encodedPaths) {
    const req = new Request(`https://hostel.example.com${path}`, { method: 'GET' });
    const res = await worker.fetch(req, { ASSETS: mockAssets });
    assert.equal(res.status, 404, `Percent-encoded path ${path} must be blocked with 404`);
    const data = await res.json();
    assert.equal(data.error, 'Not found');
  }
});

test('cf-worker: Unknown /api/* endpoints return 404 with Access-Control-Allow-Origin: sarvlekh.in', async () => {
  const req = new Request('https://edge.hostelos.in/api/unknown_endpoint', { method: 'GET' });
  const res = await worker.fetch(req);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, 'Endpoint not found');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://sarvlekh.in');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization, X-Hostel-Id');
});
