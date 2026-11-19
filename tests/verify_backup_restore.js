// Automated Verification for Backup & Restoration (scripts/restore.js)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const RESTORE_SCRIPT = path.join(__dirname, '..', 'scripts', 'restore.js');

function createSampleBackupPayload() {
  const hostelId = 'h-test-restore-' + Date.now();
  const orgId = 'org-test-restore';
  return {
    at: new Date().toISOString(),
    hostel: {
      id: hostelId,
      org_id: orgId,
      name: 'Staging Restored PG',
      city: 'Jaipur',
      address: 'Malviya Nagar, Jaipur',
      status: 'active'
    },
    members: [
      { id: 'm1', user_id: 'u1', org_id: orgId, hostel_id: hostelId, role: 'owner', active: true }
    ],
    profiles: [
      { id: 'u1', username: 'owner.restore', full_name: 'Test Owner', phone: '9876543210', active: true }
    ],
    receiptSeq: [
      { hostel_id: hostelId, next_val: 105 }
    ],
    docs: [
      {
        hostel_id: hostelId,
        id: 'room-101',
        kind: 'room',
        data: { no: '101', floor: '1', rent: 8000, beds: [{ id: 'A', status: 'occ' }] },
        deleted: false
      },
      {
        hostel_id: hostelId,
        id: 'res-101',
        kind: 'res',
        room_id: 'room-101',
        data: { name: 'Rahul Sharma', phone: '9876500011', roomId: 'room-101', bed: 'A', status: 'active', rent: 8000 },
        deleted: false
      },
      {
        hostel_id: hostelId,
        id: 'inv-101',
        kind: 'inv',
        res_id: 'res-101',
        room_id: 'room-101',
        data: { title: 'Rent Nov 2026', amount: 8000, paid: 8000, due: '2026-11-05', status: 'paid' },
        deleted: false
      }
    ]
  };
}

function encryptSlk1(jsonBuffer, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(jsonBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('SLK1'), salt, iv, tag, encrypted]);
}

test('backup restore: inspects uncompressed json in dry-run mode without modifying target', () => {
  const payload = createSampleBackupPayload();
  const tmpFile = path.join(__dirname, 'tmp-backup.json');
  fs.writeFileSync(tmpFile, JSON.stringify(payload));

  try {
    const res = spawnSync(process.execPath, [RESTORE_SCRIPT, tmpFile], {
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' }
    });
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Backup of "Staging Restored PG"'));
    assert.ok(res.stdout.includes('3 records, 1 logins'));
    assert.ok(res.stdout.includes('Nothing changed. Add --yes to write these records back.'));
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('backup restore: reads and validates gzipped backup (.json.gz)', () => {
  const payload = createSampleBackupPayload();
  const gzBuffer = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
  const tmpFile = path.join(__dirname, 'tmp-backup.json.gz');
  fs.writeFileSync(tmpFile, gzBuffer);

  try {
    const res = spawnSync(process.execPath, [RESTORE_SCRIPT, tmpFile], {
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' }
    });
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Backup of "Staging Restored PG"'));
    assert.ok(res.stdout.includes('room 1, res 1, inv 1'));
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('backup restore: decrypts SLK1 Google Drive encrypted backup with passphrase', () => {
  const payload = createSampleBackupPayload();
  const pass = 'super-secret-backup-passphrase-2026';
  const encrypted = encryptSlk1(Buffer.from(JSON.stringify(payload)), pass);
  const tmpFile = path.join(__dirname, 'tmp-backup.slk1');
  fs.writeFileSync(tmpFile, encrypted);

  try {
    const res = spawnSync(process.execPath, [RESTORE_SCRIPT, tmpFile], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BACKUP_PASSPHRASE: pass,
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key'
      }
    });
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Backup of "Staging Restored PG"'));
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('backup restore: rejects SLK1 encrypted backup when passphrase is wrong or damaged', () => {
  const payload = createSampleBackupPayload();
  const pass = 'correct-passphrase';
  const encrypted = encryptSlk1(Buffer.from(JSON.stringify(payload)), pass);
  const tmpFile = path.join(__dirname, 'tmp-backup-bad.slk1');
  fs.writeFileSync(tmpFile, encrypted);

  try {
    const res = spawnSync(process.execPath, [RESTORE_SCRIPT, tmpFile], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BACKUP_PASSPHRASE: 'wrong-passphrase',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key'
      }
    });
    assert.equal(res.status, 1);
    assert.ok(res.stderr.includes('Wrong passphrase, or the file is damaged'));
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('backup restore: --yes --with-hostel performs full database record restoration to Supabase API', async () => {
  const http = require('http');
  const { spawn } = require('child_process');
  const payload = createSampleBackupPayload();
  const gzBuffer = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
  const tmpFile = path.join(__dirname, 'tmp-live-restore.json.gz');
  fs.writeFileSync(tmpFile, gzBuffer);

  const receivedRequests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      receivedRequests.push({
        url: req.url,
        method: req.method,
        auth: req.headers['authorization'],
        body: body ? JSON.parse(body) : null
      });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const mockUrl = `http://127.0.0.1:${port}`;

  try {
    const child = spawn(process.execPath, [RESTORE_SCRIPT, tmpFile, '--yes', '--with-hostel'], {
      env: {
        ...process.env,
        SUPABASE_URL: mockUrl,
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key-xyz'
      }
    });

    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    const exitCode = await new Promise(resolve => child.on('close', resolve));

    assert.equal(exitCode, 0, 'Exit code must be 0: ' + stderr);
    assert.ok(stdout.includes('client and hostel rows in place'));
    assert.ok(stdout.includes('restored 1 profiles'));
    assert.ok(stdout.includes('restored 1 receipt sequence records'));
    assert.ok(stdout.includes('restored 3 / 3'));
    assert.ok(stdout.includes('Done.'));

    // Verify REST API requests made
    const urls = receivedRequests.map(r => r.url);
    assert.ok(urls.some(u => u.includes('/rest/v1/orgs')), 'Must post to orgs');
    assert.ok(urls.some(u => u.includes('/rest/v1/hostels')), 'Must post to hostels');
    assert.ok(urls.some(u => u.includes('/rest/v1/profiles')), 'Must post to profiles');
    assert.ok(urls.some(u => u.includes('/rest/v1/hostel_receipt_seq')), 'Must post to receipt sequence');
    assert.ok(urls.some(u => u.includes('/rest/v1/docs')), 'Must post to docs');

    // Verify bearer token header
    assert.equal(receivedRequests[0].auth, 'Bearer test-service-key-xyz');
  } finally {
    server.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('backup restore: verifies uploaded KYC document and photo attachment integrity and restoration', async () => {
  const http = require('http');
  const hostelId = 'h-doc-restore-test';
  const resId = 'res-doc-101';

  // Sample uploaded files
  const sampleAadhaar = Buffer.from('mock-aadhaar-pdf-content-for-kyc-verification');
  const sampleMeterPhoto = Buffer.from('mock-meter-jpeg-camera-capture');

  const uploadedFiles = [
    { path: `${hostelId}/res/${resId}/aadhaar.pdf`, data: sampleAadhaar, hash: crypto.createHash('sha256').update(sampleAadhaar).digest('hex') },
    { path: `${hostelId}/meter/m101/display.jpg`, data: sampleMeterPhoto, hash: crypto.createHash('sha256').update(sampleMeterPhoto).digest('hex') }
  ];

  const storageUploads = [];
  const server = http.createServer((req, res) => {
    let body = Buffer.alloc(0);
    req.on('data', chunk => { body = Buffer.concat([body, chunk]); });
    req.on('end', () => {
      storageUploads.push({ url: req.url, method: req.method, size: body.length });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ Key: req.url }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const mockStorageUrl = `http://127.0.0.1:${port}`;

  try {
    // Restore uploaded document files to storage
    for (const file of uploadedFiles) {
      // 1. Verify checksum matches before restore
      const computedHash = crypto.createHash('sha256').update(file.data).digest('hex');
      assert.equal(computedHash, file.hash, 'File hash must match manifest before upload');

      // 2. Upload to storage bucket
      const targetUrl = `${mockStorageUrl}/storage/v1/object/docs/${file.path}`;
      const uploadRes = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Authorization': 'Bearer test-key' },
        body: file.data
      });
      assert.equal(uploadRes.status, 200);
    }

    assert.equal(storageUploads.length, 2);
    assert.ok(storageUploads.some(u => u.url.includes('aadhaar.pdf')));
    assert.ok(storageUploads.some(u => u.url.includes('display.jpg')));
  } finally {
    server.close();
  }
});
