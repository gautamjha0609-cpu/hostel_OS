#!/usr/bin/env node
// Put a hostel's records back from a weekly backup file.
//
//   node scripts/restore.js path/to/2026-11-08.json.gz            (shows what is inside, changes nothing)
//   node scripts/restore.js path/to/2026-11-08.json.gz --yes      (writes the records back)
//   node scripts/restore.js file.json.gz --yes --with-hostel       (restore test into an EMPTY staging project)
//
// Which project: SUPABASE_URL in .env.local if set (staging), otherwise the one in js/config.js. The
// target is printed before anything is written. --with-hostel first creates the client and hostel rows
// the records hang off (a fresh staging project has neither). Logins are not restored: they live in
// Supabase Auth, which a backup does not contain, so create test logins on staging instead.
//
// NOT in a backup: uploaded ID papers (Storage bucket "docs"). Only the records pointing at them are.
//
// Get the file from Supabase: Storage -> backups -> <hostel id> -> download. Records in the file overwrite
// the live ones with the same id, so anything edited after the backup is replaced by its older version;
// records created after the backup are left alone. It never deletes. Needs SUPABASE_SERVICE_ROLE_KEY in
// .env.local and the hostel must still exist (restore the hostel row yourself from "hostel" in the file if not).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = path.join(__dirname, '..');
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('Usage: node scripts/restore.js <backup.json.gz> [--yes]'); process.exit(1); }

for (const l of (fs.existsSync(path.join(root, '.env.local')) ? fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/) : [])) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const cfg = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const URL_ = (process.env.SUPABASE_URL || (cfg.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1] || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('Need SUPABASE_URL in js/config.js and SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1); }

let raw = fs.readFileSync(file);
if (raw.slice(0, 4).toString() === 'SLK1') {   // a file from Google Drive: encrypted with BACKUP_PASSPHRASE (the same text set on the server)
  const crypto = require('crypto'), pass = process.env.BACKUP_PASSPHRASE;
  if (!pass) { console.error('This file is encrypted. Put BACKUP_PASSPHRASE=... in .env.local (the same text the server uses).'); process.exit(1); }
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(pass, raw.slice(4, 20), 32), raw.slice(20, 32));
    d.setAuthTag(raw.slice(32, 48)); raw = Buffer.concat([d.update(raw.slice(48)), d.final()]);
  } catch (e) { console.error('Wrong passphrase, or the file is damaged.'); process.exit(1); }
}
const b = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString('utf8'));
const kinds = {}; for (const d of b.docs) kinds[d.kind] = (kinds[d.kind] || 0) + 1;
console.log(`Backup of "${b.hostel && b.hostel.name}" taken ${b.at}: ${b.docs.length} records, ${b.members.length} logins.`);
console.log(Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', '));
console.log('Target project: ' + URL_);
if (!process.argv.includes('--yes')) { console.log('\nNothing changed. Add --yes to write these records back.'); process.exit(0); }

const post = (table, rows, conflict) => fetch(`${URL_}/rest/v1/${table}?on_conflict=${conflict}`, { method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(rows) });
(async () => {
  if (process.argv.includes('--with-hostel')) {
    const h = b.hostel;
    if (!h || !h.id || !h.org_id) { console.error('This backup has no hostel row.'); process.exit(1); }
    for (const [table, row] of [['orgs', { id: h.org_id, name: (h.name || 'Restored') + ' (restored)' }], ['hostels', h]]) {
      const r = await post(table, [row], 'id');
      if (!r.ok) { console.error(`Could not create the ${table} row: ${r.status} ${(await r.text()).slice(0, 200)}`); process.exit(1); }
    }
    console.log('  client and hostel rows in place');
  }
  for (let i = 0; i < b.docs.length; i += 500) {
    const r = await post('docs', b.docs.slice(i, i + 500), 'hostel_id,id');
    if (!r.ok) { console.error('Failed at record ' + i + ': ' + r.status + ' ' + (await r.text()).slice(0, 200)); process.exit(1); }
    console.log(`  restored ${Math.min(i + 500, b.docs.length)} / ${b.docs.length}`);
  }
  console.log('Done.');
})();
