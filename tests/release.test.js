// The service-worker VERSION is stamped by the Vercel build, so a deploy can never ship stale caches.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const root = path.join(__dirname, '..');

test('vercel.json stamps a version at build time and serves the folder', () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(v.buildCommand, 'node scripts/release.js'); assert.equal(v.outputDirectory, '.');
  assert.ok(fs.existsSync(path.join(root, v.buildCommand.split(' ')[1])));
});

test('the build script is uploaded to Vercel, the other scripts are not', () => {
  const ign = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  assert.ok(!ign.includes('scripts') && !ign.includes('scripts/') && !ign.includes('scripts/release.js'), 'release.js must be uploaded');
  for (const f of fs.readdirSync(path.join(root, 'scripts'))) if (f !== 'release.js') assert.ok(ign.includes('scripts/' + f), `scripts/${f} must be in .vercelignore`);
});

test('release.js stamps the commit id on Vercel and a timestamp elsewhere, and refuses a file with no VERSION', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rel-')), 'sw.js');
  fs.copyFileSync(path.join(root, 'sw.js'), tmp);
  const run = env => cp.spawnSync(process.execPath, [path.join(root, 'scripts/release.js')], { env: { ...process.env, SW_FILE: tmp, VERCEL_GIT_COMMIT_SHA: '', ...env }, encoding: 'utf8' });
  assert.equal(run({ VERCEL_GIT_COMMIT_SHA: 'ABCDEF0123456789deadbeef' }).status, 0);
  assert.match(fs.readFileSync(tmp, 'utf8'), /const VERSION = 'hostelos-abcdef012345';/);
  run({}); assert.match(fs.readFileSync(tmp, 'utf8'), /const VERSION = 'hostelos-\d{12}';/);
  fs.writeFileSync(tmp, '// no version here\n');
  assert.equal(run({}).status, 1);
});
