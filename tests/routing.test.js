// Clean addresses: /home, /settings/site ... instead of /#/home.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// Vercel anchors a rewrite source to the whole path.
const fallback = () => { const r = JSON.parse(read('vercel.json')).rewrites.find(x => x.destination === '/index.html'); assert.ok(r, 'a rewrite to /index.html'); return new RegExp('^' + r.source + '$'); };

test('every app address opens the app, and files, the API and the public pages are left alone', () => {
  const re = fallback();
  for (const p of ['/', '/home', '/settings/site', '/admin/11bd2148-2f0f-49d0-833b-e3842d6ace7e', '/r-home', '/setup', '/admin-usage']) assert.ok(re.test(p), p + ' is an app page');
  for (const p of ['/api/admin', '/api/public/site', '/h/shreedham-jaipur', '/js/app.js', '/css/app.css', '/sw.js', '/manifest.webmanifest', '/join.html', '/site.html', '/icons/icon-192.png']) assert.equal(re.test(p), false, p + ' must not become the app');
  // the more specific rewrites keep their place ahead of the fallback
  const rw = JSON.parse(read('vercel.json')).rewrites; assert.equal(rw[rw.length - 1].destination, '/index.html');
});

test('the app loads everything by absolute address, so it works from /admin/<id> too', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(/^(\/|https?:|data:|#)/.test(m[1]), 'relative address in index.html: ' + m[1]);
  // the app's own scripts (the public pages join/visit/pay/site live at fixed addresses and may use relative ones)
  for (const f of ['app.js', 'core.js', 'data.js', 'domain.js', 'pwa.js', 'mascot.js', 'ui-owner.js', 'ui-ops.js', 'ui-settings.js', 'ui-resident.js', 'ui-admin.js']) {
    const src = read('js/' + f);
    assert.ok(!/loadScript\('(js|vendor)\//.test(src), f + ' loads a script by a relative address');
    assert.ok(!/fn\('api\//.test(src) && !/fetch\('api\//.test(src), f + ' calls the API by a relative address');
  }
  assert.match(read('js/app.js'), /serviceWorker\.register\('\/sw\.js'\)/);
});

test('no link or redirect still uses the old /#/page form (except the one that converts it)', () => {
  for (const f of ['js/app.js', 'js/core.js', 'js/data.js', 'js/domain.js', 'js/ui-owner.js', 'js/ui-ops.js', 'js/ui-settings.js', 'js/ui-resident.js', 'js/ui-admin.js', 'api/admin.js', 'sw.js']) {
    const bad = read(f).split('\n').filter(l => /href="#\/|location\.hash\s*=|['"`]#\//.test(l) && !/^\s*\/\//.test(l));
    assert.deepEqual(bad, [], f + ' still builds a hash address');
  }
  const man = JSON.parse(read('manifest.webmanifest'));
  assert.equal(man.start_url, '/?source=pwa');
  for (const s of man.shortcuts) assert.match(s.url, /^\/[a-z-]+$/);
});

test('the service worker treats every app page as the cached shell', () => {
  const sw = read('sw.js');
  assert.match(sw, /const appPage = req\.mode === 'navigate'/);
  assert.match(sw, /cache\.match\(appPage \? '\.\/index\.html' : req/);
  const m = sw.match(/const appPage = ([^;]*);/)[1];
  const isApp = pathname => new Function('req', 'url', 'return ' + m)({ mode: 'navigate' }, { pathname });
  assert.ok(isApp('/home') && isApp('/settings/site') && isApp('/'));
  assert.ok(!isApp('/join.html') && !isApp('/h/shreedham') && !isApp('/js/app.js'));
});

test('the Google Drive return trip lands on a clean address', () => {
  assert.match(read('api/admin.js'), /`\/admin-usage\?drive=\$\{encodeURIComponent\(msg\)\}`/);
});
