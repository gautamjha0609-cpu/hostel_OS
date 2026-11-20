'use strict';
// "Send to all" is e-mail, one tap, once. A second tap the same day sends nothing; WhatsApp stays one-by-one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sandbox() {
  const store = new Map();
  const ctx = {
    console, Date, Math, JSON, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, URL, URLSearchParams,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(), key: i => [...store.keys()][i] || null, get length() { return store.size; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
    navigator: { userAgent: 'NodeTest', platform: 'Win32' }, location: { search: '', pathname: '/', hostname: 'app.example.com', protocol: 'https:', origin: 'https://app.example.com' },
    document: { hidden: false, title: '', addEventListener() {}, removeEventListener() {} },
    openModal() {}, closeModal() {}, updateChrome() {}, toast() {}, t: (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s), esc: s => s, inr: n => '₹' + n,
  };
  ctx.window = ctx; ctx.window.HOSTELOS_CONFIG = {}; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  vm.runInContext('Object.assign(globalThis,{Store,checkIn,today,addDays,addInvoice,resDue,bulkMailPlan,sendBulkMail,sendNoticeMail,bmailDay,bmailDone,Backend,S,mailIsSimulated,WaGw,monthlyBillsDue,remindersDue,orgEnabled})', ctx);
  vm.runInContext('mailIsSimulated = () => globalThis.__simulate === true', ctx);   // a live hostel unless a test says demo
  const S = ctx.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'org1', modules: {}, status: 'active' }];
  S.hostels = [{ id: 'h1', org_id: 'org1', name: 'Sunrise PG', settings: { pay: { upiId: 'pg@okicici', payee: 'Sunrise PG' }, elec: { rate: 0 } } }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };
  S.put('room', { id: 'r1', no: '101', floor: '1', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }, { id: 'C', status: 'vac' }, { id: 'D', status: 'vac' }] });
  const mk = (name, phone, bed, email) => { const r = ctx.checkIn({ name, phone, roomId: 'r1', bed, rent: 6000, deposit: 0, checkIn: ctx.today(), email }); return r; };
  const a = mk('Asha Rao', '9000000001', 'A', 'asha@example.com'), b = mk('Bala Nair', '9000000002', 'B', 'bala@example.com'), c = mk('Chitra Das', '9000000003', 'C', '');
  const sent = [];
  ctx.Backend.admin = async (action, payload) => { sent.push({ action, n: payload.items.length, to: payload.items.map(i => i.to) }); return { ok: true, results: payload.items.map(() => ({ delivered: true })) }; };
  return { ctx, S, a, b, c, sent };
}

test('plan: who gets an e-mail, who only gets the app notice, who already got it today', () => {
  const { ctx, a, b, c } = sandbox();
  const p = ctx.bulkMailPlan('bill');
  assert.equal(p.total, 3); assert.equal(p.todo.length, 2); assert.equal(p.noEmail.length, 1); assert.equal(p.done.length, 0);
  assert.equal(JSON.stringify(p.todo.map(x => x.r.id).sort()), JSON.stringify([a.id, b.id].sort())); assert.equal(p.noEmail[0].r.id, c.id);
});

test('one tap sends one e-mail each in ONE request, and the second tap the same day sends nothing', async () => {
  const { ctx, sent } = sandbox();
  const r1 = await ctx.sendBulkMail('bill');
  assert.equal(r1.status, 'sent'); assert.equal(r1.sent, 2); assert.equal(r1.noEmail, 1); assert.equal(r1.failed, 0);
  assert.equal(sent.length, 1, 'one request for all of them'); assert.equal(sent[0].action, 'send_bulk_emails'); assert.equal(sent[0].n, 2);
  const r2 = await ctx.sendBulkMail('bill');
  assert.equal(r2.status, 'already', 'a second tap does nothing');
  assert.equal(sent.length, 1, 'no second request went out');
  const p = ctx.bulkMailPlan('bill'); assert.equal(p.done.length, 3); assert.equal(p.emailed, 2); assert.equal(p.appOnly, 1);
});

test('a failed e-mail is retried on the next tap, and only that one', async () => {
  const { ctx, a, sent } = sandbox();
  ctx.Backend.admin = async (action, payload) => { sent.push(payload.items.map(i => i.to)); return { ok: true, results: payload.items.map(i => (i.to === 'bala@example.com' ? { delivered: false, reason: 'rejected' } : { delivered: true })) }; };
  const r1 = await ctx.sendBulkMail('bill');
  assert.equal(r1.sent, 1); assert.equal(r1.failed, 1);
  ctx.Backend.admin = async (action, payload) => { sent.push(payload.items.map(i => i.to)); return { ok: true, results: payload.items.map(() => ({ delivered: true })) }; };
  const r2 = await ctx.sendBulkMail('bill');
  assert.equal(r2.sent, 1); assert.equal(JSON.stringify(sent[sent.length - 1]), JSON.stringify(['bala@example.com']), 'only the failed one');
  assert.equal((await ctx.sendBulkMail('bill')).status, 'already');
});

test('a new due later the same day is picked up by the next tap, nobody is mailed twice', async () => {
  const { ctx, sent } = sandbox();
  await ctx.sendBulkMail('bill');
  ctx.checkIn({ name: 'Dev Jain', phone: '9000000004', roomId: 'r1', bed: 'D', rent: 6000, deposit: 0, checkIn: ctx.today(), email: 'dev@example.com' });
  const r = await ctx.sendBulkMail('bill');
  assert.equal(r.sent, 1);
  assert.equal(JSON.stringify(sent[sent.length - 1].to), JSON.stringify(['dev@example.com']), 'only the new one, nobody twice');
});

test('reminders are their own memory: mailing bills does not block reminders', async () => {
  const { ctx } = sandbox();
  await ctx.sendBulkMail('bill');
  const p = ctx.bulkMailPlan('reminder');
  assert.equal(p.done.length, 0);
});

test('demo hostel: nothing is really sent, but the flow and the memory behave the same', async () => {
  const { ctx, S, sent } = sandbox();
  ctx.__simulate = true;
  const r = await ctx.sendBulkMail('bill');
  assert.equal(r.status, 'sent'); assert.equal(r.sent, 2); assert.equal(sent.length, 0, 'no request in demo');
  assert.equal((await ctx.sendBulkMail('bill')).status, 'already');
});

test('a notice is e-mailed once to everyone with an e-mail', async () => {
  const { ctx, sent } = sandbox();
  const n = { id: 'n1', title: 'Water cut tomorrow', body: 'No water 10am-2pm' };
  const r1 = await ctx.sendNoticeMail(n); assert.equal(r1.sent, 2);
  assert.equal((await ctx.sendNoticeMail(n)).status, 'already');
  assert.equal(sent.length, 1);
});

test('screens: Payments has Monthly billing + E-mail all; no WhatsApp bulk, previews or one-by-one queue in the owner flow', () => {
  const o = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-owner.js'), 'utf8');
  assert.ok(o.includes("btn('Monthly billing', 'monthlybatch', '', 'primary', 'cal')") && o.includes("'billall', '', '', 'mail'"));
  const panel = o.slice(o.indexOf('function mbModel()'), o.indexOf('A.sendautowa = el => {'));
  assert.ok(!panel.includes('seq_sender_start') && !panel.includes('preview_all_wa') && !panel.includes('Click-to-Chat'), 'the confusing buttons are gone');
  assert.ok(panel.includes('WaGw.on()') && !panel.includes("orgEnabled('automation')"), 'automatic WhatsApp appears only where a gateway is really connected');
  assert.ok(o.includes('A.remindall = () => openBulkMail') && o.includes('A.mbillsend = () =>'));
  assert.ok(/A\.sendbill = async el => \{[\s\S]*?waOpen\(r\.phone/.test(o), 'one resident: WhatsApp opens straight away');
  assert.ok(!/waSheet\(list\.map/.test(o), 'no bulk WhatsApp queue');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8');
  assert.ok(srv.includes('async send_bulk_emails') && srv.includes('slice(0, 30)') && srv.includes('deliverResidentMail') && srv.includes('https://api.resend.com/emails/batch'), 'one batch call, not one call per resident');
});


test('the memory is ONE small row per kind per day, however many residents', async () => {
  const { ctx, S } = sandbox();
  await ctx.sendBulkMail('bill');
  const rows = S.all('bmail');
  assert.equal(rows.length, 1, 'one row for the day, not one per resident');
  assert.equal(rows[0].mailed.length, 2); assert.equal(rows[0].appOnly.length, 1);
  await ctx.sendBulkMail('bill');
  assert.equal(S.all('bmail').length, 1, 'a second tap writes nothing');
});

test('automatic WhatsApp is never offered without a connected gateway, even when the platform switch is on', () => {
  const { ctx, S } = sandbox();
  assert.equal(ctx.orgEnabled('automation'), true, 'the switch is on by default');
  assert.equal(ctx.WaGw.on(), false, 'sandbox is not a live cloud hostel, and no gateway is connected');
  const dom = fs.readFileSync(path.join(__dirname, '..', 'js', 'domain.js'), 'utf8');
  assert.ok(dom.includes("&& !!((S().wa || {}).gw && S().wa.gw.on)"), 'WaGw.on needs the connected gateway');
});

test('once everyone was mailed, the "ready" items in Approvals disappear by themselves', async () => {
  const { ctx } = sandbox();
  const before = ctx.monthlyBillsDue().length + ctx.remindersDue().length;
  await ctx.sendBulkMail('bill'); await ctx.sendBulkMail('reminder');
  assert.ok(ctx.monthlyBillsDue().length === 0 && ctx.remindersDue().length === 0 && before >= 0);
});


test('one resident on WhatsApp: the bill goes with a payment card (QR first, then details), and falls back to plain text', () => {
  const o = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-owner.js'), 'utf8');
  assert.ok(o.includes('async function payCardBlob') && o.includes('upiUri(amount, note)') && o.includes("navigator.share({ files: [file], text: m.text })"));
  assert.ok(o.includes('if (await sendBillWithQr(r, m)) return;'), 'then the plain wa.me text if no share sheet');
  const pay = fs.readFileSync(path.join(__dirname, '..', 'js', 'pay.js'), 'utf8');
  assert.ok(pay.indexOf('pq-qr') < pay.indexOf('pq-h">Payment</h1>') && pay.includes('>Pay Now<'), 'QR first, then Payment, then Pay Now');
});


test('a bill with something missing stays pending: no e-mail goes out, and the reason is kept', async () => {
  const { ctx, S, a, sent } = sandbox();
  S.hostels[0].settings.elec = { rate: 9 };   // electricity is billed, and no meter reading was taken this month
  const p = ctx.bulkMailPlan('bill');
  assert.equal(p.todo.length, 0, 'nothing is ready');
  assert.equal(p.blocked.length, 3);
  assert.ok(p.blocked.every(x => x.why === 'reading' && /electricity/i.test(x.reason)));
  const r = await ctx.sendBulkMail('bill');
  assert.equal(r.status, 'nobody'); assert.equal(sent.length, 0, 'no request, no mail');
  assert.equal(S.all('bmail').length, 0, 'nothing is remembered as sent');
});

test('an invalid e-mail address is kept out of the send list and told apart from a missing one', () => {
  const { ctx, S, a, c } = sandbox();
  ctx.Store.patch(a.id, { email: 'not-an-email' });
  const p = ctx.bulkMailPlan('bill');
  assert.equal(p.todo.length, 1);
  assert.equal(p.noEmail.length, 2);
  const st = r => { const e = String(r.email || '').trim(); return !e ? 'none' : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? 'ok' : 'bad'; };
  assert.equal(st(S.get(a.id)), 'bad'); assert.equal(st(S.get(c.id)), 'none');
});

test('every mail remembers its time, and a failure remembers why; a later success clears it', async () => {
  const { ctx, a, b, sent } = sandbox();
  ctx.Backend.admin = async (action, payload) => ({ ok: true, results: payload.items.map(i => (i.to === 'bala@example.com' ? { delivered: false, reason: 'mailbox full' } : { delivered: true })) });
  await ctx.sendBulkMail('bill');
  let d = ctx.bmailDay('bill');
  assert.ok(d.at[a.id] && !d.at[b.id], 'time only for the one that went');
  assert.equal(d.fail[b.id], 'mailbox full');
  ctx.Backend.admin = async (action, payload) => ({ ok: true, results: payload.items.map(() => ({ delivered: true })) });
  await ctx.sendBulkMail('bill');
  d = ctx.bmailDay('bill');
  assert.ok(d.at[b.id] && !d.fail[b.id], 'cleared after it went');
});

test('opening the monthly billing panel writes nothing to the database (a preview is not logged)', () => {
  const dom = fs.readFileSync(path.join(__dirname, '..', 'js', 'domain.js'), 'utf8');
  assert.ok(dom.includes("if (!options.previewOnly) alog('monthly_billing_batch'"));
});

test('every button that names an action in the screens has that action defined (a deleted handler must never reach the app)', () => {
  const dir = path.join(__dirname, '..', 'js'), files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  const all = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const used = new Set();
  for (const f of ['ui-owner.js', 'ui-ops.js', 'ui-resident.js', 'ui-settings.js', 'ui-admin.js', 'app.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/data-act="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bbtn\((?:t\()?'[^']*'\)?,\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
  }
  const missing = [...used].filter(n => !new RegExp('\\bA\\.' + n + '\\s*=|A\\[\'' + n + '\'\\]\\s*=').test(all) && !['nav', 'go', 'ingdel'].includes(n));   // ingdel is handled by the .ing-x listener
  assert.deepEqual(missing.slice(), [], 'actions with no handler: ' + missing.join(', '));
});

test('the monthly billing panel: one panel with summary, filters (Sent / Pending / Needs fixing), per-resident status and one send button', () => {
  const o = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-owner.js'), 'utf8');
  const panel = o.slice(o.indexOf('function mbModel()'), o.indexOf('A.sendautowa = el => {'));
  assert.ok(panel.includes("chip('sent'") && panel.includes("chip('pending'") && panel.includes("chip('fix'"));
  assert.ok(panel.includes('data-act="mbsend"') && panel.includes('Send {n} e-mails'));
  assert.ok(panel.includes('mbcreatego') && panel.includes('Create {n} bills?'), 'creating bills asks first and shows what will be created');
  assert.ok(panel.includes('mbread') && panel.includes('mbelec'), 'missing readings lead to the room or to Electricity');
  assert.ok(!panel.includes('All done for today') && !panel.includes('Nothing more to do'));
  assert.ok(!/Billing batch complete/.test(o), 'no unexplained "0 created, 22 skipped" message');
});
