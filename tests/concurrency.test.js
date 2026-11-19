// Local Concurrency & Performance Benchmark Test
// Validates response latency, throughput, and error rates under concurrent load.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const BASE_URL = 'http://localhost:5177';
let serverProcess = null;

before(async () => {
  // Check if server is already running on port 5177
  const isUp = await new Promise((resolve) => {
    const req = http.get(BASE_URL + '/', (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });

  if (!isUp) {
    const serverScript = path.resolve(__dirname, '..', 'scripts', 'dev-server.js');
    serverProcess = spawn(process.execPath, [serverScript, '--demo', '--port', '5177'], {
      stdio: 'ignore',
      detached: false
    });

    // Wait until server is accepting connections (up to 5 seconds)
    const start = Date.now();
    while (Date.now() - start < 5000) {
      await new Promise(r => setTimeout(r, 100));
      const ok = await new Promise((resolve) => {
        const req = http.get(BASE_URL + '/', (res) => resolve(true));
        req.on('error', () => resolve(false));
      });
      if (ok) break;
    }
  }
});

after(() => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

function fetchUrl(urlPath) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = http.get(BASE_URL + urlPath, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          duration: Date.now() - t0,
          size: Buffer.byteLength(body, 'utf8'),
          headers: res.headers,
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('Request timed out'));
    });
  });
}

async function runConcurrentBatch(concurrency, count, path) {
  const latencies = [];
  let errors = 0;
  let completed = 0;

  async function worker() {
    while (completed < count) {
      completed++;
      try {
        const res = await fetchUrl(path);
        if (res.status === 200) {
          latencies.push(res.duration);
        } else {
          errors++;
        }
      } catch (e) {
        errors++;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  return { total: latencies.length, errors, p50, p95, p99 };
}

test('performance: 5 concurrent virtual users fetching application shell', async () => {
  const result = await runConcurrentBatch(5, 50, '/');
  assert.equal(result.errors, 0, 'No errors under 5 concurrent users');
  assert.ok(result.p50 < 200, `P50 latency should be <200ms (got ${result.p50}ms)`);
  assert.ok(result.p95 < 350, `P95 latency should be <350ms (got ${result.p95}ms)`);
});

test('performance: 10 concurrent virtual users fetching core script bundles', async () => {
  const result = await runConcurrentBatch(10, 80, '/js/core.js');
  assert.equal(result.errors, 0, 'No errors under 10 concurrent users');
  assert.ok(result.p50 < 200, `P50 latency should be <200ms (got ${result.p50}ms)`);
  assert.ok(result.p95 < 350, `P95 latency should be <350ms (got ${result.p95}ms)`);
});

test('performance: 25 concurrent virtual users fetching public portal routes', async () => {
  const result = await runConcurrentBatch(25, 100, '/visit.html');
  assert.equal(result.errors, 0, 'No errors under 25 concurrent users');
  assert.ok(result.p50 < 250, `P50 latency should be <250ms (got ${result.p50}ms)`);
  assert.ok(result.p95 < 400, `P95 latency should be <400ms (got ${result.p95}ms)`);
});
