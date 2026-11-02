// Stamps a new service-worker VERSION. Run before every deploy: npm run release
// Installed apps compare sw.js byte-for-byte on open, so a new VERSION makes them fetch the
// new files at once instead of waiting for the 12-hour background refresh.
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '..', 'sw.js');
const v = 'hostelos-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${v}';`));
console.log('sw.js VERSION =', v);
