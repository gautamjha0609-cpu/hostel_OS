'use strict';
// The pay page: "I have paid" saves the UTR (and an optional screenshot) on the resident the link belongs to, exactly once.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const H1 = '11111111-2222-4333-8444-555555555555';
const JPEG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');
let ip = 100;

function world({ resident = { name: 'Asha Rao', roomId: 'room-7', status: 'active' }, claims = [] } = {}) {
  const inserted = [];
  global.fetch = async (url, opt = {}) => {
    const u = new URL(url), q = decodeURIComponent(u.search);
    const json = (s, b) => ({ ok: s < 400, status: s, text: async () => JSON.stringify(b), json: async () => b });
    if (u.pathname.includes('/rest/v1/hostels')) return json(200, [{ id: H1, name: 'Sunrise PG', status: 'active' }]);
    if (u.pathname.includes('/rest/v1/docs')) {
      if ((opt.method || 'GET') === 'POST') { inserted.push(...JSON.parse(opt.body)); return json(201, {}); }
      if (q.includes('kind=eq.res')) return json(200, resident ? [{ data: resident }] : []);
      if (q.includes('kind=eq.claim')) return json(200, claims.filter(c => q.includes(`utr=eq.${c.utr}`) && !(q.includes('status=neq.rejected') && c.status === 'rejected')).map(c => ({ id: c.id })));
      return json(200, []);
    }
    return json(404, {});
  };
  return inserted;
}
async function call(body) {
  const { submit_claim } = require('../api/public.js')._internals;
  const req = { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.' + (ip++ % 250) }, body, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(this.body)); } };
  let code = 200, data = null;
  try { await submit_claim(req, { status(c) { code = c; return this; }, json(d) { data = d; return this; }, setHeader() {} }); }
  catch (e) { code = e.status || 500; data = { error: e.message }; }
  return { code, data };
}
const ok = { hostel_id: H1, res_id: 'res-1', amount: 8830, utr: '412345678901' };

test('the claim is saved on the resident of the link, with their room, and the owner is told', async () => {
  const rows = world();
  const r = await call(ok);
  assert.equal(r.code, 200); assert.equal(r.data.ok, true);
  const claim = rows.find(x => x.kind === 'claim');
  assert.equal(claim.res_id, 'res-1'); assert.equal(claim.data.resId, 'res-1'); assert.equal(claim.data.roomId, 'room-7');
  assert.equal(claim.data.amount, 8830); assert.equal(claim.data.status, 'pending'); assert.equal(claim.data.source, 'pay_portal');
  assert.ok(rows.some(x => x.kind === 'ntf' && /Asha Rao/.test(x.data.body)));
});

test('the screenshot travels with the claim, in the same field the resident app uses', async () => {
  const rows = world();
  const r = await call({ ...ok, proof: JPEG });
  assert.equal(r.data.ok, true);
  assert.equal(rows.find(x => x.kind === 'claim').data.proofUrl, JPEG);
  assert.ok(rows.some(x => x.kind === 'ntf' && /screenshot attached/.test(x.data.body)));
});

test('only a small JPEG is accepted as the screenshot; nothing else is stored', async () => {
  for (const bad of ['data:text/html;base64,PGgxPg==', 'http://evil.test/x.jpg', 'data:image/jpeg;base64,' + 'A'.repeat(360000), 'not an image']) {
    const rows = world();
    const r = await call({ ...ok, proof: bad });
    assert.equal(r.code, 400, String(bad).slice(0, 30));
    assert.equal(rows.length, 0);
  }
});

test('a link without a resident, or for a resident who is not here, saves nothing', async () => {
  let rows = world();
  assert.equal((await call({ ...ok, res_id: '' })).code, 400); assert.equal(rows.length, 0);
  rows = world({ resident: null });
  assert.equal((await call(ok)).code, 404); assert.equal(rows.length, 0);
  rows = world({ resident: { name: 'Old Res', status: 'left' } });
  assert.equal((await call(ok)).code, 404); assert.equal(rows.length, 0);
});

test('the same UTR is taken once; a rejected one may be sent again', async () => {
  let rows = world({ claims: [{ id: 'claim-1', utr: '412345678901', status: 'pending' }] });
  const r = await call(ok);
  assert.equal(r.data.duplicate, true); assert.equal(rows.length, 0, 'nothing written the second time');
  rows = world({ claims: [{ id: 'claim-1', utr: '412345678901', status: 'rejected' }] });
  assert.equal((await call(ok)).data.duplicate, undefined); assert.ok(rows.some(x => x.kind === 'claim'));
});

test('UTR is normalised to upper case, and wrong amounts are refused', async () => {
  const rows = world();
  await call({ ...ok, utr: ' ab12 cd34 ef56 ' });
  assert.equal(rows.find(x => x.kind === 'claim').data.utr, 'AB12CD34EF56');
  assert.equal((await call({ ...ok, amount: 0 })).code, 400);
  assert.equal((await call({ ...ok, amount: 99999999 })).code, 400);
  assert.equal((await call({ ...ok, utr: 'ab' })).code, 400);
});

test('the page: pay step (PG name, QR, Payment, amount, Pay Now, copy UPI ID), then proof step (UTR + screenshot with a full-screen eye); no Hindi', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'pay.js'), 'utf8');
  assert.ok(!/[\u0900-\u097f]/.test(js), 'no Hindi text left in the page');
  const i = k => js.indexOf(k);
  assert.ok(i('class="pq-host"') < i('pq-qr') && i('pq-qr') < i('pq-h">Payment</h1>') && i('pq-h">Payment</h1>') < i('>Pay Now<') && i('>Pay Now<') < i('btn-cp-upi'));
  const proof = js.slice(js.indexOf('box.innerHTML = proofStep'), js.indexOf('pq-qr'));
  assert.ok(proof.includes('proofHtml') && !proof.includes('Pay Now'), 'the proof step has no QR and no Pay Now');
  const pay = js.slice(js.indexOf('pq-qr'), js.indexOf('var toStep'));
  assert.ok(!pay.includes('form-utr') && !pay.includes('proofHtml'), 'the pay step has no UTR form');
  assert.ok(js.includes('id="ss-eye"') && js.includes('pq-view') && js.includes("proof: state.shot || undefined"));
  assert.ok(js.includes("localStorage.setItem(flagKey") && js.includes("state.step = 'proof'"), 'coming back from the UPI app opens the proof step');
  assert.ok(js.includes('if (sending) return;'), 'no double submit from the page');
});
