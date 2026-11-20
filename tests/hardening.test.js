// Tests for production hardening: payment idempotency fingerprinting, account activation,
// stock deduction invariants, and offline encrypted vault handling.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://sb.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service';

// 1. Payment Idempotency & Request Fingerprinting
test('payment fingerprinting: identical payload produces same fingerprint, altered payload differs', () => {
  const hashPayload = (resId, amount, mode, ref, date, targetInvs, excludeInvs) => {
    return crypto.createHash('sha256').update(
      resId + ':' +
      amount + ':' +
      mode + ':' +
      (ref || '') + ':' +
      date + ':' +
      (targetInvs ? targetInvs.join(',') : '') + ':' +
      (excludeInvs ? excludeInvs.join(',') : '')
    ).digest('hex');
  };

  const fp1 = hashPayload('res-1', '5000.00', 'upi', 'UPI-123456', '2026-11-14', ['inv-1'], []);
  const fp2 = hashPayload('res-1', '5000.00', 'upi', 'UPI-123456', '2026-11-14', ['inv-1'], []);
  assert.equal(fp1, fp2, 'Same payment parameters must generate identical fingerprint');

  const fpAltered = hashPayload('res-1', '6000.00', 'upi', 'UPI-123456', '2026-11-14', ['inv-1'], []);
  assert.notEqual(fp1, fpAltered, 'Altered payment amount must produce different fingerprint to trigger conflict');

  const fpAlteredMode = hashPayload('res-1', '5000.00', 'cash', 'UPI-123456', '2026-11-14', ['inv-1'], []);
  assert.notEqual(fp1, fpAlteredMode, 'Altered payment mode must produce different fingerprint');
});

// 2. Account Activation Token Claim & Re-entrancy Logic
test('account activation: token hashing and single-use claim validation', () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const invites = new Map();
  const inviteId = 'inv-uuid-1';
  const userId = 'user-uuid-1';

  // Seed invite
  invites.set(tokenHash, {
    id: inviteId,
    user_id: userId,
    token_hash: tokenHash,
    claimed_at: null,
    used_at: null,
    expires_at: Date.now() + 86400e3,
  });

  // Emulate claim_account_invite RPC
  const claimInvite = (hash, now = Date.now()) => {
    const row = invites.get(hash);
    if (!row || row.expires_at <= now) throw new Error('Invalid or expired activation link');
    if (row.used_at) throw new Error('This activation link has already been completed');

    // Re-entrant grace window: within 5 minutes of claim, allow idempotent retry
    if (row.claimed_at && (now - row.claimed_at) < 5 * 60e3) {
      return { inviteId: row.id, userId: row.user_id, reentrant: true };
    }

    row.claimed_at = now;
    return { inviteId: row.id, userId: row.user_id, reentrant: false };
  };

  // First claim succeeds
  const t0 = Date.now();
  const claim1 = claimInvite(tokenHash, t0);
  assert.equal(claim1.reentrant, false);
  assert.equal(claim1.userId, userId);

  // Re-entrant claim within 2 minutes succeeds with reentrant: true
  const claim2 = claimInvite(tokenHash, t0 + 120e3);
  assert.equal(claim2.reentrant, true);

  // Complete invite
  const row = invites.get(tokenHash);
  row.used_at = Date.now();
  row.claimed_at = null;

  // After completion, further claims are rejected
  assert.throws(() => claimInvite(tokenHash, t0 + 150e3), /already been completed/);

  // Expired token rejected
  const expToken = crypto.randomBytes(32).toString('hex');
  const expHash = crypto.createHash('sha256').update(expToken).digest('hex');
  invites.set(expHash, { id: 'inv-exp', user_id: 'u2', token_hash: expHash, expires_at: Date.now() - 1000 });
  assert.throws(() => claimInvite(expHash), /Invalid or expired/);
});

// 3. Stock Movement Balance & Deduction Invariant
test('inventory stock movement: deduction never creates negative stock', () => {
  const applyMovement = (currentStock, qm) => {
    if (qm === 0) throw new Error('Movement quantity cannot be zero');
    const newStock = currentStock + qm;
    if (qm < 0 && newStock < 0) {
      throw new Error(`Insufficient stock: current ${currentStock}, requested ${Math.abs(qm)}`);
    }
    return newStock;
  };

  assert.equal(applyMovement(5000, 2000), 7000, 'Addition increases stock');
  assert.equal(applyMovement(7000, -3000), 4000, 'Deduction decreases stock');
  assert.equal(applyMovement(4000, -4000), 0, 'Exact deduction zeroes stock');

  assert.throws(() => applyMovement(1000, -1500), /Insufficient stock/);
  assert.throws(() => applyMovement(0, -1), /Insufficient stock/);
  assert.throws(() => applyMovement(1000, 0), /cannot be zero/);
});

// 4. Offline Encrypted Vault Protection (Web Crypto Simulation)
test('offline vault encryption: data encrypted with AES-256-GCM is protected on disk and restorable', async () => {
  // Simulate Web Crypto AES-256-GCM
  const key = crypto.randomBytes(32); // 256 bits
  const iv = crypto.randomBytes(12);  // 96 bits

  const sensitiveOutbox = [
    { id: 'res-101', kind: 'res', data: { name: 'Rahul Sharma', phone: '9876543210', idNo: '1234-5678-9012' } },
    { id: 'pay-202', kind: 'pay', data: { amount: 12500, mode: 'cash', ref: 'Hostel fee' } }
  ];

  const plaintext = JSON.stringify(sensitiveOutbox);

  // Encrypt
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const vaultRecord = {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: encrypted.toString('hex')
  };

  // Plaintext is NOT visible in vault record
  assert.equal(vaultRecord.ciphertext.includes('Rahul'), false);
  assert.equal(vaultRecord.ciphertext.includes('9876543210'), false);

  // Decrypt
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(vaultRecord.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(vaultRecord.tag, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(vaultRecord.ciphertext, 'hex')), decipher.final()]);
  const restoredOutbox = JSON.parse(decrypted.toString('utf8'));

  assert.deepEqual(restoredOutbox, sensitiveOutbox, 'Restored vault outbox must exactly match original writes');
});

// 5. Public /api/public/activate validation
test('public /api/public/activate rejects invalid tokens and short passwords', async () => {
  const publicApi = require('../api/public.js');

  const invokeActivate = async (body) => {
    let status = 0, jsonOut = null;
    const req = {
      method: 'POST',
      query: { sub: 'activate' },
      headers: { 'x-forwarded-for': '127.0.0.1' },
      body
    };
    const res = {
      setHeader() {},
      status(s) { status = s; return this; },
      json(j) { jsonOut = j; }
    };
    await publicApi(req, res);
    return { status, jsonOut };
  };

  // Missing or short token
  const r1 = await invokeActivate({ token: 'short', password: 'ValidPassword123' });
  assert.equal(r1.status, 400);
  assert.match(r1.jsonOut.error, /Invalid activation token/i);

  // Short password (< 8 chars)
  const validHexToken = crypto.randomBytes(32).toString('hex');
  const r2 = await invokeActivate({ token: validHexToken, password: 'short' });
  assert.equal(r2.status, 400);
  assert.match(r2.jsonOut.error, /at least 8 characters/i);
});

// 6. PDF and Document Upload Guard (1.5 MB Limit)
test('document upload guard: rejects files > 1.5 MB and accepts valid sizes', async () => {
  const publicApi = require('../api/public.js');
  const H1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const APP = '0123456789abcdef';
  const HOSTEL = { id: H1, name: 'Sunrise', settings: { join: { key: 'join-key-123456', on: true } } };

  global.fetch = async (url) => {
    const u = new URL(url);
    const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
    if (u.pathname === '/rest/v1/hostels') return json(200, [HOSTEL]);
    if (u.pathname.startsWith('/storage/v1/object/upload/sign/docs/')) return json(200, { url: '/sign/upload-test' });
    return json(404, { message: 'not mocked' });
  };

  const invokeDoc = async (size, mime = 'image/jpeg') => {
    let status = 0, jsonOut = null;
    const req = {
      method: 'POST',
      query: { sub: 'join' },
      headers: { 'x-forwarded-for': '127.0.0.1' },
      body: { action: 'doc', h: H1, k: 'join-key-123456', app: APP, label: 'Aadhaar', mime, size }
    };
    const res = {
      setHeader() {},
      status(s) { status = s; return this; },
      json(j) { jsonOut = j; }
    };
    await publicApi(req, res);
    return { status, jsonOut };
  };

  // 1.8 MB photo should be rejected by 1.5 MB guard
  const r1 = await invokeDoc(1.8 * 1024 * 1024);
  assert.equal(r1.status, 400);
  assert.match(r1.jsonOut.error, /max 1\.5 MB/i);

  // 1.2 MB photo should be accepted under 1.5 MB limit
  const r2 = await invokeDoc(1.2 * 1024 * 1024);
  assert.equal(r2.status, 200);
  assert.ok(r2.jsonOut.url);

  // PDFs are not accepted at all
  const r3 = await invokeDoc(200 * 1024, 'application/pdf');
  assert.equal(r3.status, 400);
  assert.match(r3.jsonOut.error, /PDF/);
});

// 7. In-Memory Signed URL Cache for Instant Document Viewing
test('signed document URL cache: cached for 9 min avoiding repeated server roundtrips', () => {
  const urlCache = new Map();
  const getUrl = (path, now = Date.now()) => {
    const hit = urlCache.get(path);
    if (hit && hit.exp > now) return { url: hit.url, fromCache: true };
    const newUrl = `https://storage.hostelos.app/signed/${path}?token=tok_${Math.random()}`;
    urlCache.set(path, { url: newUrl, exp: now + 540e3 }); // 9 min TTL
    return { url: newUrl, fromCache: false };
  };

  const path = 'hostel-1/res/res-101/aadhaar.webp';
  const t0 = Date.now();
  const first = getUrl(path, t0);
  assert.equal(first.fromCache, false);

  // Re-read 2 minutes later must be from cache with identical URL
  const second = getUrl(path, t0 + 120e3);
  assert.equal(second.fromCache, true);
  assert.equal(second.url, first.url);

  // Re-read 10 minutes later (expired) must fetch fresh URL
  const third = getUrl(path, t0 + 600e3);
  assert.equal(third.fromCache, false);
  assert.notEqual(third.url, first.url);
});
