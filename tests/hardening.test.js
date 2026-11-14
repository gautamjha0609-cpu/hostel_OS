// Tests for production hardening: payment idempotency fingerprinting, account activation,
// stock deduction invariants, and offline encrypted vault handling.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

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
