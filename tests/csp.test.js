// The Content-Security-Policy in vercel.json is enforced in production. These checks fail the build
// if code ships that the policy would silently break (nothing would error in local development,
// which does not send the header).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const files = [...fs.readdirSync(root).filter(f => f.endsWith('.html')), ...fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)];
const csp = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value;

test('no inline event handlers: script-src \'self\' refuses onclick="…" and friends', () => {
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'the policy forbids inline scripts');
  const bad = [];
  for (const f of files) fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => { if (/\s on(click|change|input|submit|load|error|keyup|keydown|focus|blur)\s*=/.test(line)) bad.push(`${f}:${i + 1}`); });
  assert.deepEqual(bad, [], 'use data-act / data-flt instead: ' + bad.join(', '));
});

test('no <base> tag: base-uri \'none\' makes browsers ignore it, so relative addresses break', () => {
  assert.match(csp, /base-uri 'none'/);
  const bad = files.filter(f => /<base\s/i.test(fs.readFileSync(path.join(root, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '')));
  assert.deepEqual(bad, []);
});

test('the public page loads everything by absolute address (it is also served from /h/<name>)', () => {
  const html = fs.readFileSync(path.join(root, 'site.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(/^(\/|https?:)/.test(m[1]), 'relative address: ' + m[1]);
  assert.ok(/fetch\('\/api\/public\/site\?/.test(fs.readFileSync(path.join(root, 'js/site.js'), 'utf8')));
});

test('icons and pictures are not cached as immutable (they keep their file names when the brand changes)', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers;
  const hit = rules.find(r => r.source.includes('icons'));
  assert.ok(hit && !/immutable/.test(hit.headers[0].value));
});

test('the install code is in the app only, never on the public pages', () => {
  const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(idx, /js\/pwa\.js/);
  for (const f of ['site.html', 'join.html', 'visit.html', 'pay.html']) assert.ok(!/pwa\.js/.test(fs.readFileSync(path.join(root, f), 'utf8')), f);
  const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.ok(man.id && man.start_url && man.scope && man.display === 'standalone' && man.orientation === 'any');
  assert.ok(man.icons.some(i => i.sizes === '192x192') && man.icons.some(i => i.sizes === '512x512') && man.icons.some(i => i.purpose === 'maskable'));
  for (const i of man.icons) assert.ok(fs.existsSync(path.join(root, i.src)), i.src);
});
