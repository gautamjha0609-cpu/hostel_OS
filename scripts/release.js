// Stamps a new service-worker VERSION so installed apps fetch the new files at once instead of waiting
// for the 12-hour background refresh (they compare sw.js byte for byte when they open).
//
// You do not have to run this by hand: vercel.json runs it as the build command, so every deploy gets
// its own VERSION (the commit id). Locally, `npm run release` stamps a timestamp.
const fs = require('fs'), path = require('path');
const f = process.env.SW_FILE || path.join(__dirname, '..', 'sw.js');
const sha = String(process.env.VERCEL_GIT_COMMIT_SHA || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 12);
const v = 'hostelos-' + (sha || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12));
const src = fs.readFileSync(f, 'utf8');
if (!/const VERSION = '[^']*';/.test(src)) { console.error('sw.js has no VERSION line to stamp'); process.exit(1); }
fs.writeFileSync(f, src.replace(/const VERSION = '[^']*';/, `const VERSION = '${v}';`));
console.log('sw.js VERSION =', v);
