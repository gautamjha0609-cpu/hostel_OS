// "<hostel-name>.your-domain.com" addresses: the Vercel rewrite, the reserved names, the slug check.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
const { buildRule, cleanDomain, validDomain, RESERVED } = require('../scripts/set-domain.js');
const { SITE_RESERVED } = require('../api/_lib.js');
const { slug } = require('../api/public.js')._internals;

test('the rewrite sends a hostel host to its page, and nothing else', () => {
  const rule = buildRule('sarvlekh.in'), re = new RegExp(rule.has[0].value);
  assert.equal(rule.source, '/'); assert.equal(rule.destination, '/site.html?s=:slug');
  assert.equal(re.exec('shreedham.sarvlekh.in').groups.slug, 'shreedham');
  assert.equal(re.exec('shreedham-luxury-boys-pg.sarvlekh.in').groups.slug, 'shreedham-luxury-boys-pg');
  for (const host of ['sarvlekh.in', 'www.sarvlekh.in', 'app.sarvlekh.in', 'admin.sarvlekh.in', 'api.sarvlekh.in',
    'a.b.sarvlekh.in', 'shreedham.sarvlekh.in.evil.com', 'shreedham.sarvlekhXin', 'xsarvlekh.in', 'my-app.vercel.app', 'sarvlekh-os.vercel.app']) {
    assert.equal(re.test(host), false, host + ' must not be treated as a hostel');
  }
  assert.equal(new RegExp(buildRule('my-brand.co.in').has[0].value).exec('pg1.my-brand.co.in').groups.slug, 'pg1');
});

test('the domain is cleaned and checked before it goes into a file', () => {
  assert.equal(cleanDomain(' https://WWW.Sarvlekh.in/ '), 'www.sarvlekh.in'); assert.equal(cleanDomain('*.sarvlekh.in'), 'sarvlekh.in');
  assert.ok(validDomain('sarvlekh.in') && validDomain('my-brand.co.in'));
  for (const bad of ['sarvlekh', 'sarvlekh.', '-x.in', 'a b.in', 'sarvlekh.in/path', '']) assert.equal(validDomain(bad), false, bad);
});

test('one reserved list everywhere: the script, the API and the app', () => {
  const dom = fs.readFileSync(path.join(root, 'js/domain.js'), 'utf8');
  const m = dom.match(/const SITE_RESERVED = (\[[^\]]*\]);/); assert.ok(m, 'js/domain.js has the list');
  const inApp = JSON.parse(m[1].replace(/'/g, '"'));
  assert.deepEqual(inApp, RESERVED); assert.deepEqual(SITE_RESERVED, RESERVED);
  for (const must of ['www', 'app', 'admin', 'api']) assert.ok(RESERVED.includes(must), must);
});

test('vercel.json stays valid with the rule in and out (checked on a copy)', () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const withRule = { ...v, rewrites: [buildRule('sarvlekh.in'), ...v.rewrites.filter(r => !r.has)] };
  const back = JSON.parse(JSON.stringify(withRule));
  assert.equal(back.rewrites[0].has[0].type, 'host'); assert.ok(back.rewrites.some(r => r.source === '/h/:slug'));
  assert.deepEqual(Object.keys(back.rewrites[0]).sort(), ['destination', 'has', 'source']);   // no stray keys: Vercel refuses them
});

test('site.js reads the hostel name from the host, only on the configured domain', () => {
  const src = fs.readFileSync(path.join(root, 'js/site.js'), 'utf8');
  const body = src.match(/var hostSlug = \(function \(\) \{([\s\S]*?)\}\)\(\);/)[1];
  const run = (host, dom) => new Function('CFG', 'location', body)({ PUBLIC_SITE_DOMAIN: dom }, { hostname: host });
  assert.equal(run('shreedham.sarvlekh.in', 'sarvlekh.in'), 'shreedham');
  assert.equal(run('sarvlekh.in', 'sarvlekh.in'), '');
  assert.equal(run('a.b.sarvlekh.in', 'sarvlekh.in'), '');
  assert.equal(run('shreedham.sarvlekh.in', ''), '');
  assert.equal(run('shreedham.other.com', 'sarvlekh.in'), '');
});

function fakeRows(rows) {
  global.fetch = async url => { const u = new URL(url); return { ok: true, status: 200, text: async () => JSON.stringify(u.pathname === '/rest/v1/hostels' ? rows : []) }; };
}
const call = async q => { let out; await slug({ url: '/api/public/slug?' + q, method: 'GET', headers: { 'x-forwarded-for': '9.9.9.' + Math.floor(Math.random() * 250) } }, { status: () => ({ json: b => { out = b; } }) }); return out; };
const ME = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

test('web address check: free, taken, mine, reserved, malformed', async () => {
  fakeRows([]);
  assert.deepEqual(await call('s=shreedham&h=' + ME), { free: true, why: 'taken' });
  fakeRows([{ id: OTHER }]);
  assert.equal((await call('s=shreedham&h=' + ME)).free, false);
  fakeRows([{ id: ME }]);
  assert.equal((await call('s=shreedham&h=' + ME)).free, true, 'the hostel may keep its own address');
  fakeRows([]);
  assert.deepEqual(await call('s=www&h=' + ME), { free: false, why: 'reserved' });
  assert.deepEqual(await call('s=Admin&h=' + ME), { free: false, why: 'reserved' });
  assert.deepEqual(await call('s=-bad-&h=' + ME), { free: false, why: 'format' });
  assert.deepEqual(await call('s=has space&h=' + ME), { free: false, why: 'format' });
});
