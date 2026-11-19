// Browser End-to-End Workflow Verification via Native CDP
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 5178;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9224;

let serverProcess = null;
let chromeProcess = null;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function startServer() {
  const serverScript = path.resolve(__dirname, '..', 'scripts', 'dev-server.js');
  serverProcess = spawn(process.execPath, [serverScript, '--demo', '--port', String(PORT)], {
    stdio: 'ignore',
    detached: false
  });

  const start = Date.now();
  while (Date.now() - start < 6000) {
    await sleep(150);
    const ok = await new Promise(res => {
      const req = http.get(`${BASE_URL}/`, () => res(true));
      req.on('error', () => res(false));
      req.setTimeout(500, () => { req.destroy(); res(false); });
    });
    if (ok) return true;
  }
  throw new Error('Dev server failed to start on port ' + PORT);
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
  await sleep(1500);
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.msgId = 0;
    this.callbacks = new Map();
    this.consoleLogs = [];
    this.jsErrors = [];
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
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
        this.consoleLogs.push({ type: msg.params.type, text });
        if (msg.params.type === 'error') this.jsErrors.push(text);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const desc = msg.params.exceptionDetails.exception ? (msg.params.exceptionDetails.exception.description || msg.params.exceptionDetails.text) : msg.params.exceptionDetails.text;
        this.jsErrors.push(desc);
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
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails) {
      throw new Error('Eval error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await sleep(1000);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log('--- Starting Real Browser End-to-End Verification ---');
  try {
    await startServer();
    console.log(`✓ Dev server listening on ${BASE_URL}`);

    await startChrome();
    console.log(`✓ Chrome headless instance listening on port ${CDP_PORT}`);

    const versionRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const versionData = await versionRes.json();
    console.log(`✓ Connected to browser: ${versionData.Browser}`);

    // Create a new tab
    const tabRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(BASE_URL)}`, { method: 'PUT' });
    const tab = await tabRes.json();
    const cdp = new CDPClient(tab.webSocketDebuggerUrl);
    await cdp.connect();
    console.log(`✓ CDP session initialized on tab ${tab.id}`);

    await sleep(2000); // Allow initial scripts to load

    // 1. OWNER WORKFLOW TEST
    console.log('\n[1. OWNER WORKFLOW]');
    // Login as Ramesh Sharma
    const loginRes = await cdp.eval(`
      (async () => {
        try {
          await Backend.login('ramesh.sharma', '9876500001');
          await boot();
          return { ok: true, me: Store.me.full_name, role: Store.ctx.role, hostel: Store.hostel().name };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Owner Login:', loginRes);
    if (!loginRes.ok) throw new Error('Owner login failed: ' + loginRes.err);

    // Test Owner pages rendering
    const ownerPages = ['home', 'rooms', 'residents', 'payments', 'electricity', 'mess', 'housekeeping', 'laundry', 'attendance', 'expenses', 'reports', 'settings'];
    for (const page of ownerPages) {
      const pageRes = await cdp.eval(`
        (() => {
          try {
            go('/' + '${page}');
            const content = document.body.innerHTML;
            return { ok: true, hasApp: content.includes('app'), textLen: content.length };
          } catch(e) {
            return { ok: false, err: e.message };
          }
        })()
      `);
      console.log(`  Page /${page}: ${pageRes.ok ? 'OK' : 'FAIL: ' + pageRes.err}`);
    }

    // Test Digital Agreement Creation in Browser
    const agrRes = await cdp.eval(`
      (() => {
        try {
          const res = activeRes()[0];
          const agr = createAgreement({
            resId: res.id,
            startDate: today(),
            endDate: addDays(today(), 330),
            rent: 7500,
            deposit: 10000,
            noticeDays: 30
          });
          return { ok: true, id: agr.id, version: agr.version, residentName: agr.resident.name };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Create Agreement:', agrRes);

    // Test Agreement View Sheet & Print
    const agrViewRes = await cdp.eval(`
      (() => {
        try {
          const agr = Store.all('agr')[0];
          A.agrview({ dataset: { id: agr.id } });
          const modalText = document.querySelector('#agrdoc')?.innerText || '';
          const hasPrintBtn = !!document.querySelector('button[data-act="print"]');
          closeModal();
          return { ok: true, hasDoc: /agreement/i.test(modalText), hasPrintBtn };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Agreement Sheet & Print Button:', agrViewRes);

    // Test Agreement Renewal in Browser
    const agrRenewRes = await cdp.eval(`
      (() => {
        try {
          const agr = Store.all('agr').find(a => a.status === 'active');
          const renewed = renewAgreement(agr.id, {
            newEndDate: addDays(agr.endDate, 365),
            rent: 8000,
            deposit: agr.deposit,
            noticeDays: 30
          });
          return { ok: true, id: renewed.id, version: renewed.version, rent: renewed.rent, newEndDate: renewed.endDate };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Renew Agreement:', agrRenewRes);

    // Test Push Notifications Sheet & Toggle
    const pushSheetRes = await cdp.eval(`
      (() => {
        try {
          A.notifs();
          const sheetText = document.querySelector('.sheet, .modal')?.innerText || '';
          const hasPushCtrl = sheetText.includes('Push notifications') || sheetText.includes('Push');
          closeModal();
          return { ok: true, hasPushCtrl };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Notifications Sheet & Push Control:', pushSheetRes);

    // Test Payment Reversal UI
    const payRevRes = await cdp.eval(`
      (() => {
        try {
          const p = Store.all('pay')[0];
          reversePayment(p.id, 'Browser E2E test reversal');
          const revP = Store.get(p.id);
          return { ok: true, reversed: revP.reversed, reason: revP.reversalReason };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Payment Reversal UI Action:', payRevRes);

    // 2. MANAGER & WARDEN WORKFLOW TESTS
    console.log('\n[2. MANAGER & WARDEN WORKFLOWS]');

    // Vikram Manager
    const mgrRes = await cdp.eval(`
      (async () => {
        try {
          await Backend.logout();
          await Backend.login('vikram.manager', '9876500007');
          await boot();
          go('/residents');
          const hasResPage = document.body.innerHTML.includes('Residents');
          return { ok: true, me: Store.me.full_name, role: Store.ctx.role, canRooms: can('rooms'), canPays: can('payments'), hasResPage };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Manager Login & Operations:', mgrRes);

    // Shanti Warden
    const wardenRes = await cdp.eval(`
      (async () => {
        try {
          await Backend.logout();
          await Backend.login('shanti.warden', '9876500008');
          await boot();
          const mods = myMods();
          return { ok: true, me: Store.me.full_name, role: Store.ctx.role, mods, perms: Store.ctx.perms };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Warden Login & Permissions:', wardenRes);

    // 3. STAFF WORKFLOWS
    console.log('\n[3. STAFF WORKFLOWS]');

    // Raju Cook
    const cookRes = await cdp.eval(`
      (async () => {
        try {
          await Backend.logout();
          await Backend.login('raju.cook', '9876500003');
          await boot();
          const mods = myMods();
          return { ok: true, me: Store.me.full_name, role: Store.ctx.role, mods };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Cook Login & Modules:', cookRes);

    // Sunita Housekeeping
    const hkRes = await cdp.eval(`
      (async () => {
        try {
          await Backend.logout();
          await Backend.login('sunita.hk', '9876500004');
          await boot();
          const mods = myMods();
          return { ok: true, me: Store.me.full_name, role: Store.ctx.role, mods };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Housekeeping Login & Modules:', hkRes);

    // Security Guard
    const guardRes = await cdp.eval(`
      (async () => {
        try {
          await Backend.logout();
          await Backend.login('gate.guard', '9876500006');
          await boot();
          const mods = myMods();
          return { ok: true, me: Store.me.full_name, role: Store.ctx.role, mods };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Guard Login & Modules:', guardRes);

    // 4. RESIDENT WORKFLOW TEST
    console.log('\n[4. RESIDENT WORKFLOW]');
    const resRes = await cdp.eval(`
      (async () => {
        try {
          await Backend.logout();
          await Backend.login('aman.gupta', '9812300001');
          await boot();
          go('/home');
          const html = document.body.innerHTML;
          const hasGreeting = html.includes('Aman') || html.includes('Hi Aman');
          const hasAgreementCard = html.includes('Rental agreement');

          // Resident views own agreement
          const agr = getActiveAgreement(meRes().id);
          A.agrview({ dataset: { id: agr.id } });
          const docText = document.querySelector('#agrdoc')?.innerText || '';
          const hasPrintBtn = !!document.querySelector('button[data-act="print"]');
          closeModal();

          return { ok: true, me: Store.me.full_name, role: Store.ctx.role, hasGreeting, hasAgreementCard, residentDocValid: /agreement/i.test(docText), hasPrintBtn };
        } catch(e) {
          return { ok: false, err: e.message };
        }
      })()
    `);
    console.log('  Resident Login, Portal UI & Agreement View:', resRes);

    // Check JS Errors encountered across all workflows
    console.log('\n[4. BROWSER HEALTH & ERRORS]');
    console.log(`  Total JS Exceptions caught: ${cdp.jsErrors.length}`);
    if (cdp.jsErrors.length > 0) {
      console.log('  Exceptions:', cdp.jsErrors);
    }

    cdp.close();
    console.log('\n✓ Real Browser Verification Complete!');
  } catch (err) {
    console.error('Fatal Browser Test Error:', err);
  } finally {
    if (chromeProcess) {
      chromeProcess.kill();
      console.log('Chrome process stopped.');
    }
    if (serverProcess) {
      serverProcess.kill();
      console.log('Dev server process stopped.');
    }
  }
}

run();
