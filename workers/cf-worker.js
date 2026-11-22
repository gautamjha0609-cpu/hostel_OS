/**
 * Cloudflare Worker Staging Prototype Entrypoint for HostelOS
 * Adapts Cloudflare Fetch and Scheduled events to HostelOS modular API handlers
 */
const { Buffer } = require('node:buffer');
const crypto = require('node:crypto');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), geolocation=(self)',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cloudflareinsights.com https://api.bigdatacloud.net https://nominatim.openstreetmap.org https://api.cashfree.com https://sandbox.cashfree.com https://graph.facebook.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

// Same origin as vercel.json: browsers on other sites may not call the API. Override with CORS_ORIGIN.
const corsOrigin = () => process.env.CORS_ORIGIN || 'https://sarvlekh.in';

function normalizePath(p) {
  let decoded = p;
  try { decoded = decodeURIComponent(p); } catch (_) { }
  const segments = [];
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return '/' + segments.join('/');
}

const BLOCKED_PATHS = /^\/(\.git|\.env|supabase|tests|scripts|workers|docs|artifacts|scratch|node_modules|package\.json|package-lock\.json|pnpm-lock\.yaml|wrangler\.toml|vercel\.json|ENVIRONMENT_VARIABLES\.md|.*\.md)/i;

function applySecurityHeaders(headers) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
}

function syncEnv(env) {
  if (env && typeof env === 'object') {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') {
        process.env[k] = v;
      }
    }
  }
}

const worker = {
  async fetch(request, env = {}, ctx = {}) {
    syncEnv(env);
    const url = new URL(request.url);

    // CORS Preflight
    if (request.method === 'OPTIONS') {
      const corsHeaders = new Headers({
        'Access-Control-Allow-Origin': corsOrigin(),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Hostel-Id'
      });
      applySecurityHeaders(corsHeaders);
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // Health Check Endpoint
    if (url.pathname === '/health') {
      const hHeaders = new Headers({ 'Content-Type': 'application/json' });
      applySecurityHeaders(hHeaders);
      return new Response(JSON.stringify({
        status: 'healthy',
        engine: 'Cloudflare Workers',
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: hHeaders
      });
    }

    // Security Gate: Block direct access to internal server files, database schemas, test harnesses, and metadata
    const normPath = normalizePath(url.pathname);
    if (BLOCKED_PATHS.test(normPath) || BLOCKED_PATHS.test(url.pathname) || url.pathname.includes('..') || normPath.includes('..')) {
      const blockedHeaders = new Headers({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin()
      });
      applySecurityHeaders(blockedHeaders);
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: blockedHeaders
      });
    }

    // Static Asset Serving via binding
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) {
        // Handle /h/:slug microsite rewrite
        const slugMatch = url.pathname.match(/^\/h\/([a-z0-9-]+)/i);
        if (slugMatch) {
          const siteUrl = new URL('/site.html', request.url);
          siteUrl.searchParams.set('s', slugMatch[1]);
          const assetRes = await env.ASSETS.fetch(new Request(siteUrl.toString(), request));
          const newHeaders = new Headers(assetRes.headers);
          applySecurityHeaders(newHeaders);
          return new Response(assetRes.body, {
            status: assetRes.status,
            statusText: assetRes.statusText,
            headers: newHeaders
          });
        }
        const assetRes = await env.ASSETS.fetch(request);
        const newHeaders = new Headers(assetRes.headers);
        applySecurityHeaders(newHeaders);
        return new Response(assetRes.body, {
          status: assetRes.status,
          statusText: assetRes.statusText,
          headers: newHeaders
        });
      }
      const notFoundHeaders = new Headers({ 'Content-Type': 'text/plain' });
      applySecurityHeaders(notFoundHeaders);
      return new Response('Assets binding unavailable in local stub', { status: 404, headers: notFoundHeaders });
    }

    // Abuse guard: per-IP limit (Cloudflare Rate Limiting binding, when configured) and a body size cap.
    const MAX_BODY = 3 * 1024 * 1024;
    if (env.API_LIMITER && typeof env.API_LIMITER.limit === 'function') {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      let ok = true;
      try { ok = (await env.API_LIMITER.limit({ key: ip })).success; } catch (_) { ok = true; }
      if (!ok) {
        const h = new Headers({ 'Content-Type': 'application/json', 'Retry-After': '30', 'Access-Control-Allow-Origin': corsOrigin() });
        applySecurityHeaders(h);
        return new Response(JSON.stringify({ error: 'Too many requests. Please wait a moment and try again.' }), { status: 429, headers: h });
      }
    }
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) {
      const h = new Headers({ 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin() });
      applySecurityHeaders(h);
      return new Response(JSON.stringify({ error: 'Request too large' }), { status: 413, headers: h });
    }

    // Dynamic API Router for /api/public, /api/admin, /api/wa
    let handler;
    const path = url.pathname.replace(/\/+$/, '');
    if (path.startsWith('/api/public')) {
      handler = require('../api/public.js');
      const subMatch = path.match(/^\/api\/public\/([^/?]+)/i);
      if (subMatch && !url.searchParams.has('sub')) {
        let sub = subMatch[1];
        try { sub = decodeURIComponent(sub); } catch (_) { }
        url.searchParams.set('sub', sub);
      }
    } else if (path.startsWith('/api/admin')) {
      handler = require('../api/admin.js');
    } else if (path.startsWith('/api/wa')) {
      handler = require('../api/wa.js');
    } else {
      const errHeaders = new Headers({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin(),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Hostel-Id'
      });
      applySecurityHeaders(errHeaders);
      return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
        status: 404,
        headers: errHeaders
      });
    }

    // Adapt Web Request to Node-style (req, res) pair
    let bodyBuffer;
    try {
      bodyBuffer = request.method !== 'GET' && request.method !== 'HEAD'
        ? Buffer.from(await request.arrayBuffer())
        : Buffer.alloc(0);
    } catch (_disconnectErr) {
      bodyBuffer = Buffer.alloc(0);
    }

    return new Promise((resolve) => {
      let statusCode = 200;
      const headers = new Headers();
      let responseBody = '';
      let resolved = false;

      const finish = (body = '', code = (res?.statusCode || statusCode)) => {
        if (resolved) return;
        resolved = true;
        res.headersSent = true;
        if (!headers.has('Access-Control-Allow-Origin')) headers.set('Access-Control-Allow-Origin', corsOrigin());
        if (!headers.has('Access-Control-Allow-Methods')) headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (!headers.has('Access-Control-Allow-Headers')) headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hostel-Id');
        applySecurityHeaders(headers);
        resolve(new Response(body, { status: code, headers }));
      };

      const reqHeaders = {};
      if (request.headers && typeof request.headers.entries === 'function') {
        for (const [k, v] of request.headers.entries()) reqHeaders[k] = v;
      }
      const clientIp = request.headers?.get ? (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '') : '';
      if (clientIp) {
        if (!reqHeaders['cf-connecting-ip']) reqHeaders['cf-connecting-ip'] = clientIp;
        if (!reqHeaders['x-forwarded-for']) reqHeaders['x-forwarded-for'] = clientIp;
      }
      if (!reqHeaders['x-forwarded-proto']) {
        reqHeaders['x-forwarded-proto'] = url.protocol.replace(':', '');
      }

      const req = {
        method: request.method,
        url: url.pathname + url.search,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: reqHeaders,
        rawBody: bodyBuffer,
        body: null,
        async *[Symbol.asyncIterator]() {
          if (bodyBuffer.length > 0) yield bodyBuffer;
        }
      };

      try {
        if (bodyBuffer.length > 0) {
          req.body = JSON.parse(bodyBuffer.toString('utf8'));
        } else {
          req.body = {};
        }
      } catch (e) {
        req.body = bodyBuffer.toString('utf8');
      }

      const res = {
        headersSent: false,
        get statusCode() { return statusCode; },
        set statusCode(val) { statusCode = val; },
        setHeader(k, v) { headers.set(k, v); return res; },
        status(code) { statusCode = code; return res; },
        json(data) {
          headers.set('Content-Type', 'application/json');
          finish(JSON.stringify(data));
          return res;
        },
        send(data) {
          finish(typeof data === 'string' ? data : JSON.stringify(data));
          return res;
        },
        end(data) {
          finish(data || responseBody || '');
          return res;
        }
      };

      Promise.resolve(handler(req, res))
        .then(() => {
          if (!resolved) {
            finish(responseBody || null);
          }
        })
        .catch((err) => {
          if (resolved) return;
          const errH = new Headers({ 'Content-Type': 'application/json' });
          if (!errH.has('Access-Control-Allow-Origin')) errH.set('Access-Control-Allow-Origin', corsOrigin());
          if (!errH.has('Access-Control-Allow-Methods')) errH.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          if (!errH.has('Access-Control-Allow-Headers')) errH.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hostel-Id');
          applySecurityHeaders(errH);
          resolved = true;
          res.headersSent = true;
          resolve(new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
            status: err.status || 500,
            headers: errH
          }));
        });
    });
  },

  async scheduled(controller, env = {}, ctx = {}) {
    syncEnv(env);
    // Scheduled Cron invocation (Nightly sweep)
    const cronSecret = env.CRON_SECRET || process.env.CRON_SECRET;
    if (!cronSecret) {
      console.warn('CRON_SECRET not configured: scheduled sweep skipped (fail-closed)');
      return { skipped: true, error: 'CRON_SECRET not configured' };
    }
    if (!process.env.CRON_SECRET) process.env.CRON_SECRET = cronSecret;
    const admin = require('../api/admin.js');
    const req = {
      method: 'GET',
      url: '/api/admin?cron=sweep',
      headers: { authorization: `Bearer ${cronSecret}` }
    };
    return new Promise((resolve) => {
      const res = {
        headersSent: false,
        setHeader() { },
        status() { return res; },
        json(d) { resolve(d); },
        send(d) { resolve(d); },
        end() { resolve(); }
      };
      admin(req, res).catch(resolve);
    });
  }
};

module.exports = worker;
