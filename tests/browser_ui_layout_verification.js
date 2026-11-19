// Responsive Layout, Input Validation & UI Navigation Verification via CDP
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 5179;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9225;

let serverProcess = null;
let chromeProcess = null;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startServer() {
  const serverScript = path.resolve(__dirname, '..', 'scripts', 'dev-server.js');
  serverProcess = spawn(process.execPath, [serverScript, '--demo', '--port', String(PORT)], { stdio: 'ignore' });
  const start = Date.now();
  while (Date.now() - start < 5000) {
    await sleep(150);
    const ok = await new Promise(res => {
      const req = http.get(`${BASE_URL}/`, () => res(true));
      req.on('error', () => res(false));
      req.setTimeout(500, () => { req.destroy(); res(false); });
    });
    if (ok) return true;
  }
  throw new Error('Failed to start server');
}

async function startChrome() {
  chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1280,800'
  ]);
  const start = Date.now();
  while (Date.now() - start < 6000) {
    await sleep(200);
    const ok = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true).catch(() => false);
    if (ok) return true;
  }
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.msgId = 0;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };

    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }

  async setViewport(width, height, isMobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: isMobile
    });
  }

  close() { if (this.ws) this.ws.close(); }
}

async function run() {
  console.log('=== REAL BROWSER UI, NAVIGATION & RESPONSIVE LAYOUT VERIFICATION ===\n');
  try {
    await startServer();
    await startChrome();

    const tabRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(BASE_URL)}`, { method: 'PUT' });
    const tab = await tabRes.json();
    const cdp = new CDPClient(tab.webSocketDebuggerUrl);
    await cdp.connect();

    await sleep(2000);

    // Login as Ramesh Sharma (Owner)
    await cdp.eval(`(async () => { await Backend.login('ramesh.sharma', '9876500001'); await boot(); })()`);
    console.log('✓ Logged in as Owner');

    // 1. Mobile Viewport Layout Verification (375px width - iPhone / Android)
    console.log('\n[1. Responsive Mobile Viewport Check (375px width)]');
    await cdp.setViewport(375, 667, true);

    const pages = ['home', 'rooms', 'residents', 'payments', 'electricity', 'mess', 'housekeeping', 'laundry', 'attendance', 'expenses', 'reports', 'settings'];
    const overflowReport = [];

    for (const page of pages) {
      const res = await cdp.eval(`
        (() => {
          go('/' + '${page}');
          const innerW = window.innerWidth;
          const scrollW = document.documentElement.scrollWidth;
          const bodyW = document.body.scrollWidth;
          const overflows = scrollW > 376 || bodyW > 376;
          let culprit = null;
          if (overflows) {
            const all = document.querySelectorAll('*');
            for (const el of all) {
              const r = el.getBoundingClientRect();
              if (r.right > innerW + 1) {
                culprit = (el.tagName + (el.className ? '.' + String(el.className).replace(/\\s+/g, '.') : ''));
                break;
              }
            }
          }
          return { page: '${page}', innerW, scrollW, bodyW, overflows, culprit };
        })()
      `);
      if (res.overflows) {
        console.log(`  FAIL: /${page} overflows horizontally (scrollWidth=${res.scrollW}px, innerWidth=${res.innerW}px, culprit: <${res.culprit}>)`);
        overflowReport.push(res);
      } else {
        console.log(`  PASS: /${page} fits perfectly within 375px mobile screen (scrollWidth=${res.scrollW}px)`);
      }
    }

    // 2. Extra Narrow Viewport Check (320px width - iPhone SE gen 1)
    console.log('\n[2. Extra Narrow Mobile Viewport Check (320px width)]');
    await cdp.setViewport(320, 568, true);
    for (const page of ['home', 'payments', 'electricity']) {
      const res = await cdp.eval(`
        (() => {
          go('/' + '${page}');
          return { page: '${page}', fits: document.documentElement.scrollWidth <= window.innerWidth };
        })()
      `);
      console.log(`  /${page} (320px): ${res.fits ? 'PASS' : 'WARN - Horizontal Scroll'}`);
    }

    // 3. Input Validation Verification in Browser Context
    console.log('\n[3. Input Validation Invariants in Browser]');
    const validationRes = await cdp.eval(`
      (() => {
        const tests = [];
        // Test 1: Negative invoice amount rejection
        try {
          addInvoice({ resId: activeRes()[0].id, amount: -500, title: 'Negative' });
          tests.push({ name: 'negative invoice', passed: false });
        } catch(e) {
          tests.push({ name: 'negative invoice', passed: true, msg: e.message });
        }

        // Test 2: Zero invoice amount rejection
        try {
          addInvoice({ resId: activeRes()[0].id, amount: 0, title: 'Zero' });
          tests.push({ name: 'zero invoice', passed: false });
        } catch(e) {
          tests.push({ name: 'zero invoice', passed: true, msg: e.message });
        }

        // Test 3: Negative payment amount rejection
        try {
          recordPayment({ resId: activeRes()[0].id, amount: -1000 });
          tests.push({ name: 'negative payment', passed: false });
        } catch(e) {
          tests.push({ name: 'negative payment', passed: true, msg: e.message });
        }

        // Test 4: Meter reading lower than previous
        try {
          const rm = rooms()[0];
          const last = lastMeter(rm.id);
          const p = last ? last.curr : 100;
          addReading({ roomId: rm.id, curr: p - 10, prev: p });
          tests.push({ name: 'lower meter reading', passed: false });
        } catch(e) {
          tests.push({ name: 'lower meter reading', passed: true, msg: e.message });
        }

        // Test 5: Optional number field validation in formModal (leaving empty must be allowed)
        try {
          let formSubmittedWithEmptyOptional = false;
          formModal({
            title: 'Test Optional Field Modal',
            fields: [
              { name: 'reqField', label: 'Required Number', type: 'number', required: true },
              { name: 'optField', label: 'Optional Number', type: 'number', required: false }
            ],
            onSubmit: (vals) => {
              formSubmittedWithEmptyOptional = isNaN(vals.optField) || vals.optField === null;
              return false; // keep modal or close
            }
          });
          const form = document.querySelector('#mform');
          form.elements['reqField'].value = '100';
          form.elements['optField'].value = ''; // left empty
          modalSubmit();
          const errEl = document.querySelector('#mferr');
          const hasErr = errEl && errEl.textContent.trim().length > 0;
          closeModal();
          tests.push({ name: 'optional number empty allowed in form', passed: !hasErr && formSubmittedWithEmptyOptional, msg: hasErr ? errEl.textContent : 'Allowed optional empty' });
        } catch(e) {
          closeModal();
          tests.push({ name: 'optional number empty allowed in form', passed: false, msg: e.message });
        }

        return tests;
      })()
    `);

    validationRes.forEach(t => {
      console.log(`  ${t.passed ? 'PASS' : 'FAIL'}: ${t.name} -> ${t.msg || 'Allowed invalid value'}`);
    });

    cdp.close();
    console.log('\n✓ UI, Navigation & Responsive Layout Verification Complete!');
  } catch(err) {
    console.error('Error during browser verification:', err);
  } finally {
    if (chromeProcess) chromeProcess.kill();
    if (serverProcess) serverProcess.kill();
  }
}

run();
