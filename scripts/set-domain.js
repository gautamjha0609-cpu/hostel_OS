#!/usr/bin/env node
// Turn on "<hostel-name>.your-domain.com" addresses.
//
//   node scripts/set-domain.js sarvlekh.in           (or: npm run domain -- sarvlekh.in)
//   node scripts/set-domain.js --off                 (back to /h/<name> addresses only)
//
// It does two things, both in files you commit:
//   js/config.js   PUBLIC_SITE_DOMAIN   so the app builds links like https://shreedham.sarvlekh.in
//   vercel.json    one rewrite          so a visit to that address (path "/") shows that hostel's page
// The app itself should live on a reserved name (app.sarvlekh.in) or on the bare domain; reserved names
// below are never treated as a hostel. In Vercel the domain needs the wildcard added too:
//   Project -> Settings -> Domains -> add  *.sarvlekh.in   (and point DNS as Vercel tells you).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

// Keep in step with SITE_RESERVED in js/domain.js and api/_lib.js (a test checks they are the same).
const RESERVED = ['www', 'app', 'admin', 'api', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'dashboard', 'login', 'support', 'help', 'blog', 'docs', 'status', 'staging', 'test', 'dev', 'h', 'join', 'visit', 'pay', 'site', 'public', 'ns1', 'ns2'];

const cleanDomain = d => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '').replace(/^\.+|\.+$/g, '');
const validDomain = d => /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
// A host such as shreedham.sarvlekh.in, but not www./app./... and not the bare domain.
function buildRule(domain) {
  const esc = domain.replace(/\./g, '\\.');
  return { source: '/', has: [{ type: 'host', value: `^(?!(?:${RESERVED.join('|')})\\.)(?<slug>[a-z0-9][a-z0-9-]*)\\.${esc}$` }], destination: '/site.html?s=:slug' };
}
module.exports = { buildRule, cleanDomain, validDomain, RESERVED };

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) { console.error('Usage: node scripts/set-domain.js <domain.com>   |   --off'); process.exit(1); }
  const off = arg === '--off', domain = off ? '' : cleanDomain(arg);
  if (!off && !validDomain(domain)) { console.error('That does not look like a domain: ' + arg); process.exit(1); }

  const cfgFile = path.join(root, 'js/config.js');
  let cfg = fs.readFileSync(cfgFile, 'utf8');
  if (/PUBLIC_SITE_DOMAIN:\s*'[^']*'/.test(cfg)) cfg = cfg.replace(/PUBLIC_SITE_DOMAIN:\s*'[^']*'/, `PUBLIC_SITE_DOMAIN: '${domain}'`);
  else cfg = cfg.replace(/(PUBLIC_SITE_BASE:\s*'[^']*',?)/, `$1\n  PUBLIC_SITE_DOMAIN: '${domain}',`);
  fs.writeFileSync(cfgFile, cfg);

  const vf = path.join(root, 'vercel.json'), v = JSON.parse(fs.readFileSync(vf, 'utf8'));
  // our rule is the one that sends a host to the hostel page; /h/:slug has no "has"
  v.rewrites = (v.rewrites || []).filter(r => !(r.has && r.destination === '/site.html?s=:slug'));
  if (!off) v.rewrites.unshift(buildRule(domain));
  fs.writeFileSync(vf, JSON.stringify(v, null, 2) + '\n');
  console.log(off ? 'Subdomain addresses are off.' : `On: hostels are reached at https://<name>.${domain}\nNext: Vercel -> Settings -> Domains -> add ${domain}, www/app as you like, and *.${domain}. Then commit and deploy.`);
}
