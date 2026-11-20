'use strict';
// Every message that asks a resident to pay carries a pay link that works: UPI id, exact amount, the invoice,
// no double slashes. And the pay page turns that link into a real upi:// intent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sandbox(pay = { upiId: 'sunrisepg@okicici', payee: 'Sunrise PG' }) {
  const store = new Map();
  const ctx = {
    console, Date, Math, JSON, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, URL, URLSearchParams,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(), key: i => [...store.keys()][i] || null, get length() { return store.size; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
    navigator: { userAgent: 'NodeTest', platform: 'Win32' }, location: { search: '', pathname: '/', hostname: 'app.example.com', protocol: 'https:', origin: 'https://app.example.com' },
    document: { hidden: false, title: '', addEventListener() {}, removeEventListener() {} },
    openModal() {}, closeModal() {}, updateChrome() {}, toast() {}, t: s => s, esc: s => s, inr: n => '₹' + n,
  };
  ctx.window = ctx; ctx.window.HOSTELOS_CONFIG = {}; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  vm.runInContext('Object.assign(globalThis,{Store,checkIn,today,addDays,ymOf,addInvoice,billMessage,payLink,upiUri,PaymentGateway,sendMonthlyBillingWhatsApp,resDue,openInv,waUrl,S,baseUrl,payLinkFor,resById})', ctx);
  const S = ctx.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'org1', modules: {}, status: 'active' }];
  S.hostels = [{ id: 'h1', org_id: 'org1', name: 'Sunrise PG', settings: { pay } }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };
  S.put('room', { id: 'r1', no: '101', floor: '1', rent: 6000, beds: [{ id: 'A', status: 'vac' }, { id: 'B', status: 'vac' }] });
  const r = ctx.checkIn({ name: 'Rohit Yadav', phone: '9876500011', roomId: 'r1', bed: 'A', rent: 6000, deposit: 0, checkIn: ctx.addDays(ctx.today(), -10) });
  return { ctx, S, r };
}
const linkIn = text => (text.match(/https?:\/\/\S+/) || [])[0];

test('the pay link carries the UPI id, the exact amount, the resident and the invoice', () => {
  const { ctx, r } = sandbox();
  const inv = ctx.openInv(r.id)[0];
  const url = ctx.payLinkFor(r, 6000, inv);
  assert.ok(url.startsWith('https://app.example.com/pay.html?'), url);
  const q = new URL(url).searchParams;
  assert.equal(q.get('pa'), 'sunrisepg@okicici'); assert.equal(q.get('am'), '6000.00');
  assert.equal(q.get('res_id'), r.id); assert.equal(q.get('hostel_id'), 'h1'); assert.equal(q.get('inv_id'), inv.id);
  assert.ok(q.get('tn').includes('Rohit'), 'the bank note names the resident');
});

test('the UPI intent is well formed: pa, pn, am with two decimals, cu=INR, a note', () => {
  const { ctx } = sandbox();
  const u = ctx.upiUri(6000, 'Rohit Rm 101 Nov 2026');
  assert.ok(u.startsWith('upi://pay?'));
  const q = new URL(u.replace('upi://', 'http://x/')).searchParams;
  assert.equal(q.get('pa'), 'sunrisepg@okicici'); assert.equal(q.get('am'), '6000.00'); assert.equal(q.get('cu'), 'INR');
  assert.equal(q.get('tn'), 'Rohit Rm 101 Nov 2026'); assert.equal(q.get('pn'), 'Sunrise PG');
});

test('bill and reminder messages both end with the working pay link, and it survives WhatsApp encoding', () => {
  const { ctx, r } = sandbox();
  for (const kind of ['bill', 'reminder']) {
    const m = ctx.billMessage(r, kind), link = linkIn(m.text);
    assert.ok(link && link.includes('/pay.html?'), kind);
    assert.equal(new URL(link).searchParams.get('am'), ctx.resDue(r.id).toFixed(2), kind + ' amount matches the total due');
    const wa = new URL(ctx.waUrl(r.phone, m.text));
    assert.equal(linkIn(wa.searchParams.get('text')), link, 'link unchanged after wa.me encoding');
  }
});

test('no pay link has a double slash (the cashfree-style link had "//pay.html")', () => {
  const { ctx, r } = sandbox();
  const inv = ctx.openInv(r.id)[0];
  for (const provider of ['cashfree', 'direct_upi', 'setu']) {
    const url = ctx.PaymentGateway.createPaymentLink({ invoiceId: inv.id, amount: 6000, resId: r.id, hostelId: 'h1', provider });
    assert.ok(!/https:\/\/app\.example\.com\/\//.test(url), provider + ': ' + url);
  }
  const cf = new URL(ctx.PaymentGateway.createPaymentLink({ invoiceId: inv.id, amount: 6000, resId: r.id, hostelId: 'h1', provider: 'cashfree' }));
  assert.equal(cf.searchParams.get('pa'), 'sunrisepg@okicici', 'even the gateway link keeps the UPI id as a fallback');
});

test('the automatic monthly bill message (WhatsApp Cloud) links to a page that knows the amount and the UPI id', () => {
  const { ctx, r } = sandbox();
  const ym = ctx.ymOf(ctx.today());
  const out = ctx.sendMonthlyBillingWhatsApp(r.id, ym, { force: true });
  const link = linkIn(out.message);
  assert.ok(link, 'there is a link');
  const q = new URL(link).searchParams;
  assert.ok(q.get('pa') && +q.get('am') > 0, 'the old link was pay.html?inv=... with no amount and no UPI id: ' + link);
  assert.ok(q.get('inv_id'));
});

test('no UPI id set: the message says to ask the owner instead of a dead link', () => {
  const { ctx, r } = sandbox({ upiId: '' });
  assert.equal(ctx.payLinkFor(r, 6000, null), '');
  assert.ok(ctx.billMessage(r, 'bill').text.includes('ask owner for UPI'));
});

test('pay page: uses the note from the link and builds the upi:// button from the UPI id and amount', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'pay.js'), 'utf8');
  assert.ok(src.includes("(rawTn || invTitle || 'PG Rent')"), 'the bank note names the resident, not "Rent Invoice"');
  assert.ok(src.includes("'upi://pay?pa=' + encodeURIComponent(upiId)") && src.includes("'&cu=INR"));
  assert.ok(src.includes('form-utr') && src.includes('submit_claim'), 'UTR proof form is there');
});
