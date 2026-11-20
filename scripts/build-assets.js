// Builds dist/: the ONLY files Cloudflare publishes as static assets. An allowlist, so a stray local
// file (a spreadsheet, a .env, notes) can never be uploaded by accident.
//   node scripts/build-assets.js        (run after scripts/release.js, which stamps the cache version)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');
const FILES = ['index.html', 'pay.html', 'join.html', 'visit.html', 'site.html', 'sw.js', 'manifest.webmanifest', '_headers'];
const DIRS = ['css', 'js', 'icons', 'img', 'vendor'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let n = 0;
for (const f of FILES) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) { console.error('missing required file: ' + f); process.exit(1); }
  fs.copyFileSync(src, path.join(out, f)); n++;
}
for (const d of DIRS) {
  fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true, filter: s => !/\.(map|md|xlsx|env)$/i.test(s) });
}
n += DIRS.reduce((a, d) => a + fs.readdirSync(path.join(out, d), { recursive: true }).length, 0);
console.log('dist/ ready: ' + n + ' entries');
