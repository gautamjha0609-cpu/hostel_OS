#!/usr/bin/env node
// Load test: fake hostels with fake residents, all using the app the way real people do.
//
//   node scripts/loadtest.js --hostels 3 --residents 100 --minutes 3 --yes
//
// It makes a throw-away client ("ZZ-LOADTEST ..."), N hostels, R resident logins and 1 owner login per
// hostel, with about 17 records per resident (the size of the demo hostel). Every login then signs in
// and does what the app does: loads its records, then asks for changes on a timer (60 s, like the app).
// Owners also write a payment now and then. At the end it prints requests, errors and response times,
// and deletes everything it made (also on Ctrl+C). Nothing else in the project is touched.
//
// Needs SUPABASE_SERVICE_ROLE_KEY in .env.local. Run it against a TEST project, not the live one:
// it creates hundreds of logins, and many sign-ins from one IP can trip Supabase's sign-in rate limit.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const HOSTELS = +arg('hostels', 2), RESIDENTS = +arg('residents', 100), MINUTES = +arg('minutes', 3), POLL = +arg('poll', 60), RAMP = +arg('ramp', 30);
const OPEN_ALL = !!arg('burst', false);   // everyone signs in at the same moment (the 1st of the month)

for (const l of (fs.existsSync(path.join(root, '.env.local')) ? fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/) : [])) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const cfg = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const URL_ = (cfg.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1], ANON = (cfg.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1], DOMAIN = (cfg.match(/AUTH_EMAIL_DOMAIN:\s*'([^']+)'/) || [])[1] || 'login.hostelos.app';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !KEY) { console.error('Need SUPABASE_URL and the anon key in js/config.js, and SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1); }
if (!arg('yes', false)) {
  console.log(`This will create ${HOSTELS} hostels, ${HOSTELS * (RESIDENTS + 1)} logins and about ${HOSTELS * RESIDENTS * 18} records in ${URL_}, run ${MINUTES} min, then delete them.\nUse a test project. Add --yes to go.`);
  process.exit(0);
}

const stat = { n: 0, bytes: 0, by: {}, ms: {}, err: {} };
async function call(tag, url, opt = {}) {
  const t0 = Date.now(); let res, body = '';
  try { res = await fetch(url, opt); body = await res.text(); } catch (e) { stat.err[tag + ' ' + e.message] = (stat.err[tag + ' ' + e.message] || 0) + 1; return { ok: false, status: 0, body: '' }; }
  const ms = Date.now() - t0; stat.n++; stat.bytes += body.length;
  (stat.ms[tag] = stat.ms[tag] || []).push(ms);
  stat.by[tag + ' ' + res.status] = (stat.by[tag + ' ' + res.status] || 0) + 1;
  return { ok: res.ok, status: res.status, body };
}
const admin = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const rest = async (p, method = 'GET', body, extra = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${p}`, { method, headers: { ...admin, Prefer: 'return=representation', ...extra }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p.split('?')[0]} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } })); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const tag = 'lt' + Date.now().toString(36);
const made = { org: null, users: [] };
async function cleanup() {
  if (cleanup.done) return; cleanup.done = true;
  console.log('\nCleaning up ...');
  await pool(made.users, 8, u => fetch(`${URL_}/auth/v1/admin/users/${u}`, { method: 'DELETE', headers: admin }).catch(() => {}));
  if (made.org) await rest(`orgs?id=eq.${made.org}`, 'DELETE').catch(e => console.error('org delete failed:', e.message));
  console.log('Deleted the test client, its hostels, records and ' + made.users.length + ' logins.');
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

const PW = 'LoadTest#' + tag;
async function mkUser(name, username) {
  const r = await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: admin, body: JSON.stringify({ email: `${username}@${DOMAIN}`, password: PW, email_confirm: true, user_metadata: { username } }) });
  const u = await r.json(); if (!r.ok) throw new Error('create user: ' + JSON.stringify(u).slice(0, 200));
  made.users.push(u.id);
  await rest('profiles', 'POST', { id: u.id, username, full_name: name, phone: '5' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0') });
  return u.id;
}

async function setup() {
  console.log(`Setting up ${HOSTELS} hostels x ${RESIDENTS} residents ...`);
  const [org] = await rest('orgs', 'POST', { name: 'ZZ-LOADTEST ' + tag, max_hostels: HOSTELS + 1, max_beds: RESIDENTS * 2 });
  made.org = org.id;
  const clients = [];
  for (let h = 0; h < HOSTELS; h++) {
    const [hostel] = await rest('hostels', 'POST', { org_id: org.id, name: `LT hostel ${h + 1}`, settings: { demo: true } });
    const docs = [], resIds = [];
    for (let r = 0; r < RESIDENTS; r++) {
      const id = `res_${r}`; resIds.push(id);
      docs.push({ hostel_id: hostel.id, id, kind: 'res', res_id: null, day: null, data: { name: 'Resident ' + r, phone: '5' + String(r).padStart(9, '0'), rent: 6000, status: 'active', roomId: 'room_' + (r >> 2), checkIn: '2026-05-01', note: 'x'.repeat(40) } });
      for (let m = 0; m < 7; m++) docs.push({ hostel_id: hostel.id, id: `inv_${r}_${m}`, kind: 'inv', res_id: id, day: `2026-0${m + 1}-01`, data: { resId: id, kind: 'rent', amount: 6000, paid: m < 6 ? 6000 : 0, title: 'Rent', month: `2026-0${m + 1}`, due: `2026-0${m + 1}-05` } });
      for (let m = 0; m < 6; m++) docs.push({ hostel_id: hostel.id, id: `pay_${r}_${m}`, kind: 'pay', res_id: id, day: `2026-0${m + 1}-04`, data: { resId: id, amount: 6000, mode: 'upi', ref: 'T' + m + r, note: '', at: `2026-0${m + 1}-04T10:00:00Z` } });
    }
    for (let i = 0; i < docs.length; i += 500) await rest('docs?on_conflict=hostel_id,id', 'POST', docs.slice(i, i + 500), { Prefer: 'resolution=merge-duplicates,return=minimal' });
    const who = [{ role: 'owner', name: 'Owner', ref: null }, ...resIds.map(id => ({ role: 'resident', name: id, ref: id }))];
    await pool(who.map((w, i) => ({ ...w, i })), 10, async w => {
      const username = `${tag}h${h}u${w.i}`;
      const uid = await mkUser(w.name, username);
      await rest('members', 'POST', { user_id: uid, org_id: org.id, hostel_id: w.role === 'owner' ? null : hostel.id, role: w.role, ref_id: w.ref }, { Prefer: 'return=minimal' });
      clients.push({ username, role: w.role, hostelId: hostel.id, ref: w.ref });
    });
    console.log(`  hostel ${h + 1}: ${docs.length} records, ${who.length} logins`);
  }
  return clients;
}

async function client(c, stopAt) {
  if (!OPEN_ALL) await sleep(Math.random() * RAMP * 1000);
  const r = await call('sign-in', `${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${c.username}@${DOMAIN}`, password: PW }) });
  if (!r.ok) return;
  const tok = JSON.parse(r.body).access_token, uid = JSON.parse(r.body).user.id;
  const h = { apikey: ANON, Authorization: 'Bearer ' + tok };
  const get = (t, p) => call(t, `${URL_}/rest/v1/${p}`, { headers: h });
  // what loadMeta() asks for, then the first sync
  await Promise.all([get('profile', `profiles?id=eq.${uid}&select=*`), get('members', `members?user_id=eq.${uid}&active=eq.true&select=*`), get('orgs', 'orgs?select=id,name,status,modules,max_hostels,max_beds&order=name'), get('hostels', 'hostels?select=id,org_id,name,city,address,phone,status,settings,modules,blocks&order=name')]);
  let since = '';
  const sync = async () => {
    const q = `docs?hostel_id=eq.${c.hostelId}${since ? `&updated_at=gte.${encodeURIComponent(since)}` : ''}&order=updated_at.asc,id.asc&limit=1000`;
    const x = await get(c.role === 'owner' ? 'sync owner' : 'sync resident', q);
    if (x.ok) { try { const rows = JSON.parse(x.body); if (rows.length) since = rows[rows.length - 1].updated_at; } catch (e) { /* ignore */ } }
  };
  await sync();
  while (Date.now() < stopAt) {
    await sleep(POLL * 1000 * (0.8 + Math.random() * 0.4));
    if (Date.now() >= stopAt) break;
    if (c.role === 'owner' && Math.random() < 0.5) {   // the owner records a payment now and then
      const id = 'pay_lt_' + Math.random().toString(36).slice(2, 9);
      await call('write', `${URL_}/rest/v1/docs?on_conflict=hostel_id,id`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ hostel_id: c.hostelId, id, kind: 'pay', res_id: 'res_0', data: { resId: 'res_0', amount: 100, mode: 'cash' } }]) });
    }
    await sync();
  }
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
function report(secs) {
  console.log('\n===== RESULT =====');
  console.log(`Ran ${secs} s. ${stat.n} requests (${(stat.n / secs).toFixed(1)}/s), ${(stat.bytes / 1048576).toFixed(2)} MB received.`);
  console.log('request'.padEnd(16) + 'count'.padStart(7) + 'p50 ms'.padStart(9) + 'p95 ms'.padStart(9) + 'max ms'.padStart(9));
  for (const [k, a] of Object.entries(stat.ms)) console.log(k.padEnd(16) + String(a.length).padStart(7) + String(pct(a, 0.5)).padStart(9) + String(pct(a, 0.95)).padStart(9) + String(Math.max(...a)).padStart(9));
  const bad = Object.entries(stat.by).filter(([k]) => !/ 2\d\d$/.test(k));
  console.log(bad.length ? 'Failures: ' + bad.map(([k, v]) => `${k} x${v}`).join(', ') : 'Failures: none');
  if (Object.keys(stat.err).length) console.log('Network errors: ' + JSON.stringify(stat.err));
  const perDay = stat.n / secs * 86400;
  console.log(`\nAt this pace one day would be about ${Math.round(perDay).toLocaleString()} requests for ${HOSTELS} hostels (the test polls every ${POLL} s the whole time; real people are online far less).`);
}

(async () => {
  const t0 = Date.now();
  try {
    const clients = await setup();
    console.log(`Running ${clients.length} users for ${MINUTES} min (${OPEN_ALL ? 'all sign in at once' : 'sign-ins spread over ' + RAMP + ' s'}, poll every ${POLL} s) ...`);
    const start = Date.now(), stopAt = start + MINUTES * 60e3;
    await Promise.all(clients.map(c => client(c, stopAt)));
    report(Math.round((Date.now() - start) / 1000));
  } catch (e) { console.error('Failed:', e.message); process.exitCode = 1; }
  finally { await cleanup(); }
})();
