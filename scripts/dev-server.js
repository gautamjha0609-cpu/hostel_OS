// Local server for Sarvlekh: `npm run dev`  →  http://localhost:5176
//
// It serves this folder the way Vercel does (the app at "/", /h/<name> → the public page) and runs
// the REAL api/*.js handlers, so password resets, new logins and the WhatsApp connection work
// locally exactly as they will in production.
//
// Secrets are read from `.env.local` next to package.json (git ignores .env*, and this server
// refuses to serve any dot-file or folder). Without SUPABASE_SERVICE_ROLE_KEY the app still runs;
// only the screens that need /api say so.
//
// The security headers from vercel.json — including the Content-Security-Policy — are sent here
// too, so anything the policy would break in production (inline onclick, a <base> tag ...)
// breaks on your machine first, where it is cheap to fix.
const http = require('http'), fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..');
/* Options come from the command line as well as the environment, so a launcher can say
 * `dev-server.js --demo --port 5177` instead of wrapping the whole thing in `node -e`. The
 * environment still wins where a tool sets it (the editor assigns PORT when it starts us). */
const ARGV = process.argv.slice(2);
const argOf = name => { const i = ARGV.indexOf('--' + name); return i >= 0 ? ARGV[i + 1] : null; };
if (ARGV.includes('--demo')) process.env.DEMO = '1';
// 5176, not the customary 5173: that one is taken on this machine by another project, and
// Google's OAuth redirect URI must match the port character for character, so it is pinned in
// one place that `npm run dev` and the editor's launch config both read.
const PORT = +process.env.PORT || +argOf('port') || 5176;

// ---- .env.local (KEY=value per line; # comments; no quoting rules to learn)
for (const f of ['.env.local', '.env']) {
  let text; try { text = fs.readFileSync(path.join(APP, f), 'utf8'); } catch (e) { continue; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i); if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
// Staging: SUPABASE_URL + SUPABASE_ANON_KEY in .env.local point the WHOLE local app at another
// project — js/config.js is rewritten on the way out, so the browser and the functions can never
// disagree, and the production values in config.js stay untouched for deploys.
// DEMO=1 blanks both instead: the app then runs on made-up data inside the browser and talks to no
// database at all - the same source, so a demo never drifts from the real app.
const DEMO = process.env.DEMO === '1';
const STAGING = DEMO ? { url: '', key: '' }
  : process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? { url: process.env.SUPABASE_URL.replace(/\/$/, ''), key: process.env.SUPABASE_ANON_KEY } : null;
// The project's own default, so the app and the functions agree on where Supabase is.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://bbimfrhnsikpiztowlye.supabase.co';
process.env.AUTH_EMAIL_DOMAIN = process.env.AUTH_EMAIL_DOMAIN || 'login.hostelos.app';
const apiReady = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.sql': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
// vercel.json headers that apply to every path
let SECURITY = {};
try {
  for (const h of JSON.parse(fs.readFileSync(path.join(APP, 'vercel.json'), 'utf8')).headers || []) if (h.source === '/(.*)') for (const x of h.headers) SECURITY[x.key] = x.value;
} catch (e) { console.warn('vercel.json headers not applied:', e.message); }
delete SECURITY['Strict-Transport-Security'];   // meaningless (and sticky) on http://localhost

/* Vercel hands its functions a request with `query` already parsed and a response with
 * .status() / .json() helpers. Plain Node has neither, so they are added here rather than in
 * the handlers — the handlers must stay exactly what gets deployed. */
function vercelify(req, res, query) {
  req.query = query;
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
  return res;
}
const send = (res, code, headers, body) => { res.writeHead(code, { ...SECURITY, 'Cache-Control': 'no-store', ...headers }); res.end(body); };

function serveApi(req, res, p, search) {
  if (!apiReady) {
    return send(res, 503, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'The local server has no SUPABASE_SERVICE_ROLE_KEY. Put it in .env.local (next to package.json) and restart `npm run dev`.' }));
  }
  const [name, sub] = p.slice('/api/'.length).split('/');   // /api/public/site is a rewrite to /api/public?sub=site
  const file = path.join(APP, 'api', name + '.js');
  if (!/^[a-z]+$/.test(name) || !fs.existsSync(file)) return send(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'No such endpoint: ' + name }));
  const query = Object.fromEntries(new URLSearchParams(search || ''));
  if (sub) query.sub = sub;
  let handler;
  try { delete require.cache[require.resolve(file)]; handler = require(file); }   // fresh each time: edits need no restart
  catch (e) { console.error('api load', e); return send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Could not load ' + name + ': ' + e.message })); }
  vercelify(req, res, query);
  Promise.resolve(handler(req, res)).catch(e => {
    console.error('api', name, e);
    if (!res.headersSent) send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Server error' }));
  });
}

http.createServer((req, res) => {
  const qi = req.url.indexOf('?');
  const search = qi < 0 ? '' : req.url.slice(qi + 1);
  let p; try { p = decodeURIComponent(qi < 0 ? req.url : req.url.slice(0, qi)); } catch (e) { return send(res, 400, {}, 'bad request'); }

  if (p.startsWith('/api/')) { console.log('api  ' + req.method + ' ' + p); return serveApi(req, res, p, search); }
  // The public hostel page, as Vercel rewrites it.
  if (p.startsWith('/h/')) return fs.readFile(path.join(APP, 'site.html'), (err, data) => send(res, err ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8' }, err ? 'not found' : data));

  if (p.endsWith('/')) p += 'index.html';
  else if (!path.extname(p)) p = '/index.html';   // /home, /settings/site ...: the app, as vercel.json does
  const f = path.normalize(path.join(APP, p));
  // Never serve secrets or tooling: .env.local, .git, node_modules, tests, scripts.
  const rel = path.relative(APP, f).split(path.sep);
  if (!f.startsWith(APP) || rel.some(s => s.startsWith('.') || s === 'node_modules') || ['tests', 'scripts'].includes(rel[0])) return send(res, 404, { 'Content-Type': 'text/plain' }, 'not found');
  fs.readFile(f, (err, data) => {
    console.log((err ? '404 ' : '200 ') + req.method + ' ' + req.url);
    if (err) return send(res, 404, { 'Content-Type': 'text/plain' }, 'not found');
    if (STAGING && rel.join('/') === 'js/config.js') data = String(data)
      .replace(/SUPABASE_URL:\s*'[^']*'/, `SUPABASE_URL: '${STAGING.url}'`)
      .replace(/SUPABASE_ANON_KEY:\s*'[^']*'/, `SUPABASE_ANON_KEY: '${STAGING.key}'`);
    send(res, 200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }, data);
  });
}).on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use — another server is running there. Stop that one, or start this with --port <free port>.` : e);
  process.exit(1);
}).listen(PORT, () => {
  console.log(`Sarvlekh serving on http://localhost:${PORT}`);
  console.log(DEMO ? '  database: none - DEMO mode, made-up data in the browser only'
    : STAGING ? `  database: ${STAGING.url}  (STAGING, from .env.local)` : `  database: ${process.env.SUPABASE_URL}  (the one in js/config.js — production)`);
  console.log(apiReady ? '  /api is live (running the real api/*.js handlers)' : '  /api is OFF — add SUPABASE_SERVICE_ROLE_KEY to .env.local (see env.local.example), then restart');
});
