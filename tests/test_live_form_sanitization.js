// Automated real browser testing for live form input sanitization and validation
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 5177;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9226;

let chromeProcess = null;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startChrome() {
  chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1280,900'
  ]);
  const start = Date.now();
  while (Date.now() - start < 6000) {
    await sleep(200);
    const ok = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true).catch(() => false);
    if (ok) return true;
  }
  throw new Error('Failed to start Chrome');
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
      const data = JSON.parse(event.data);
      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(`Eval failed: ${res.exceptionDetails.exception.description}`);
    }
    return res.result.value;
  }

  async screenshot(outputPath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(res.data, 'base64'));
    console.log(`Saved screenshot: ${outputPath}`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log('=== Starting Real Browser Form Sanitization Verification ===');
  await startChrome();

  const newTab = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new`, { method: 'PUT' }).then(r => r.json());
  const cdp = new CDPClient(newTab.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');

  try {
    // 1. Navigate to app
    console.log('1. Navigating to', BASE_URL);
    await cdp.send('Page.navigate', { url: BASE_URL });
    await sleep(2000);

    // 2. Log in as Owner (Ramesh Sharma or Rajesh Singhal)
    console.log('2. Logging in as Owner...');
    await cdp.evaluate(`
      (function() {
        // Clear site state to start clean
        const btn = document.querySelector('[data-act="demologin"][data-u="ramesh.sharma"]') || document.querySelector('[data-act="demologin"]');
        if (btn) btn.click();
      })()
    `);
    await sleep(2500);

    // 3. Open Check-in Modal
    console.log('3. Opening Check-in Form Modal...');
    await cdp.evaluate(`
      (function() {
        if (typeof go === 'function') go('residents');
      })()
    `);
    await sleep(1000);

    await cdp.evaluate(`
      (function() {
        if (typeof A !== 'undefined' && A.checkin) A.checkin();
      })()
    `);
    await sleep(1000);

    // 4. Test Mobile Field Sanitization
    console.log('4. Testing Mobile Field (#f_phone)...');
    const mobileTest = await cdp.evaluate(`
      (function() {
        const el = document.querySelector('#f_phone');
        if (!el) return { error: 'Mobile field not found' };

        // Test 1: Typing text & symbols into phone input
        el.value = 'abc!@#';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const afterText = el.value;

        // Test 2: Typing 15 digits into phone input
        el.value = '987654321012345';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const after15Digits = el.value;

        // Test 3: Pasting +91 98765 43210
        el.value = '+91 98765 43210';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const afterPaste = el.value;

        return {
          maxlength: el.getAttribute('maxlength'),
          inputmode: el.getAttribute('inputmode'),
          type: el.getAttribute('type'),
          afterText,
          after15Digits,
          afterPaste
        };
      })()
    `);
    console.log('Mobile field test result:', JSON.stringify(mobileTest, null, 2));

    if (mobileTest.afterText !== '') throw new Error(`Mobile field allowed text! Got: ${mobileTest.afterText}`);
    if (mobileTest.after15Digits !== '9876543210') throw new Error(`Mobile field allowed 15 digits! Got: ${mobileTest.after15Digits}`);
    if (mobileTest.afterPaste !== '9876543210') throw new Error(`Pasted mobile not sanitized to 10 digits! Got: ${mobileTest.afterPaste}`);
    if (mobileTest.maxlength !== '10') throw new Error(`Mobile maxlength is not 10! Got: ${mobileTest.maxlength}`);
    console.log('✔ Mobile field correctly blocks letters and limits strictly to 10 digits!');

    // 5. Test Aadhaar Field Sanitization
    console.log('5. Testing Aadhaar Field (#f_idNo)...');
    const aadhaarTest = await cdp.evaluate(`
      (function() {
        const el = document.querySelector('#f_idNo');
        if (!el) return { error: 'Aadhaar field not found' };

        // Test 1: Typing text & symbols into Aadhaar input
        el.value = 'ABCD!@#xyz';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const afterText = el.value;

        // Test 2: Typing 20 digits into Aadhaar input
        el.value = '12345678901234567890';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const after20Digits = el.value;

        // Test 3: Valid 12 digits
        el.value = '123456789012';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const after12Digits = el.value;

        return {
          maxlength: el.getAttribute('maxlength'),
          inputmode: el.getAttribute('inputmode'),
          afterText,
          after20Digits,
          after12Digits
        };
      })()
    `);
    console.log('Aadhaar field test result:', JSON.stringify(aadhaarTest, null, 2));

    if (aadhaarTest.afterText !== '') throw new Error(`Aadhaar field allowed text! Got: ${aadhaarTest.afterText}`);
    if (aadhaarTest.after20Digits !== '123456789012') throw new Error(`Aadhaar field allowed >12 digits! Got: ${aadhaarTest.after20Digits}`);
    if (aadhaarTest.maxlength !== '12') throw new Error(`Aadhaar maxlength is not 12! Got: ${aadhaarTest.maxlength}`);
    console.log('✔ Aadhaar field correctly blocks letters and limits strictly to 12 digits!');

    // 6. Test Full Name Sanitization
    console.log('6. Testing Full Name Field (#f_name)...');
    const nameTest = await cdp.evaluate(`
      (function() {
        const el = document.querySelector('#f_name');
        if (!el) return { error: 'Name field not found' };

        // Typing numbers and symbols into name field
        el.value = 'Rohan123 Sharma!@#';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const afterInput = el.value;

        return { afterInput };
      })()
    `);
    console.log('Name field test result:', JSON.stringify(nameTest, null, 2));
    if (nameTest.afterInput !== 'Rohan Sharma') throw new Error(`Name field allowed numbers/symbols! Got: ${nameTest.afterInput}`);
    console.log('✔ Full name field correctly blocks numbers and symbols!');

    // 7. Test Guardian Mobile Field
    console.log('7. Testing Guardian Mobile Field (#f_guardianPhone)...');
    const gPhoneTest = await cdp.evaluate(`
      (function() {
        const el = document.querySelector('#f_guardianPhone');
        if (!el) return { error: 'Guardian mobile field not found' };

        el.value = '98765000029999';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          val: el.value,
          maxlength: el.getAttribute('maxlength')
        };
      })()
    `);
    console.log('Guardian phone test result:', JSON.stringify(gPhoneTest, null, 2));
    if (gPhoneTest.val !== '9876500002') throw new Error(`Guardian mobile allowed >10 digits! Got: ${gPhoneTest.val}`);
    console.log('✔ Guardian mobile field correctly clamped to 10 digits!');

    // 8. Test Submit Validation for Invalid Inputs
    console.log('8. Testing Submit Validation...');
    const validationErrors = await cdp.evaluate(`
      (async function() {
        const nameEl = document.querySelector('#f_name');
        const phoneEl = document.querySelector('#f_phone');
        const idNoEl = document.querySelector('#f_idNo');
        const errEl = document.querySelector('#mferr');

        nameEl.value = 'Amit Kumar';
        nameEl.dispatchEvent(new Event('input', { bubbles: true }));

        // Test 8a: 9-digit phone submit rejection
        phoneEl.value = '987654321'; // only 9 digits
        phoneEl.dispatchEvent(new Event('input', { bubbles: true }));

        if (typeof modalSubmit === 'function') await modalSubmit();
        const phoneErrMsg = errEl.textContent;

        // Test 8b: 11-digit Aadhaar submit rejection
        phoneEl.value = '9876543210';
        phoneEl.dispatchEvent(new Event('input', { bubbles: true }));
        idNoEl.value = '12345678901'; // only 11 digits
        idNoEl.dispatchEvent(new Event('input', { bubbles: true }));

        if (typeof modalSubmit === 'function') await modalSubmit();
        const aadhaarErrMsg = errEl.textContent;

        return { phoneErrMsg, aadhaarErrMsg };
      })()
    `);
    console.log('Validation error messages on submit:', JSON.stringify(validationErrors, null, 2));

    if (!validationErrors.phoneErrMsg.includes('10-digit mobile')) {
      throw new Error(`Expected 10-digit phone error, got: ${validationErrors.phoneErrMsg}`);
    }
    if (!validationErrors.aadhaarErrMsg.includes('12 numeric digits')) {
      throw new Error(`Expected 12 numeric digits Aadhaar error, got: ${validationErrors.aadhaarErrMsg}`);
    }
    console.log('✔ Submit validation properly rejected invalid 9-digit mobile and 11-digit Aadhaar!');

    // Capture screenshot of the verified form
    const screenshotPath = path.resolve(__dirname, '..', 'artifacts', 'verified_checkin_form.png');
    await cdp.screenshot(screenshotPath);

    // 9. Test Edit Resident Form
    console.log('9. Testing Edit Resident Form...');
    await cdp.evaluate(`
      (function() {
        if (typeof closeModal === 'function') closeModal();
        const firstRes = (typeof residents === 'function' ? residents()[0] : null);
        if (firstRes && typeof A !== 'undefined' && A.resedit) {
          A.resedit({ dataset: { id: firstRes.id } });
        }
      })()
    `);
    await sleep(800);

    const editFormTest = await cdp.evaluate(`
      (function() {
        const phoneEl = document.querySelector('#f_phone');
        const idNoEl = document.querySelector('#f_idNo');
        if (!phoneEl || !idNoEl) return { error: 'Edit form fields not found' };

        return {
          phoneMax: phoneEl.getAttribute('maxlength'),
          phoneMode: phoneEl.getAttribute('inputmode'),
          idNoMax: idNoEl.getAttribute('maxlength'),
          idNoMode: idNoEl.getAttribute('inputmode')
        };
      })()
    `);
    console.log('Edit resident form test result:', JSON.stringify(editFormTest, null, 2));
    if (editFormTest.phoneMax !== '10') throw new Error(`Edit resident phone maxlength is not 10! Got: ${editFormTest.phoneMax}`);
    if (editFormTest.idNoMax !== '12') throw new Error(`Edit resident idNo maxlength is not 12! Got: ${editFormTest.idNoMax}`);
    console.log('✔ Edit resident form correctly enforces 10-digit phone and 12-digit Aadhaar!');

    // 10. Test Staff Form
    console.log('10. Testing Add Staff Form...');
    await cdp.evaluate(`
      (function() {
        if (typeof closeModal === 'function') closeModal();
        if (typeof A !== 'undefined' && A.addstaff) A.addstaff();
      })()
    `);
    await sleep(800);

    const staffFormTest = await cdp.evaluate(`
      (function() {
        const phoneEl = document.querySelector('#f_phone');
        const idNoEl = document.querySelector('#f_idNo');
        if (!phoneEl || !idNoEl) return { error: 'Staff form fields not found' };

        return {
          phoneMax: phoneEl.getAttribute('maxlength'),
          phoneMode: phoneEl.getAttribute('inputmode'),
          idNoMax: idNoEl.getAttribute('maxlength'),
          idNoMode: idNoEl.getAttribute('inputmode')
        };
      })()
    `);
    console.log('Staff form test result:', JSON.stringify(staffFormTest, null, 2));
    if (staffFormTest.phoneMax !== '10') throw new Error(`Staff form phone maxlength is not 10! Got: ${staffFormTest.phoneMax}`);
    if (staffFormTest.idNoMax !== '12') throw new Error(`Staff form idNo maxlength is not 12! Got: ${staffFormTest.idNoMax}`);
    console.log('✔ Staff form correctly enforces 10-digit phone and 12-digit Aadhaar!');

    const staffScreenshotPath = path.resolve(__dirname, '..', 'artifacts', 'verified_staff_form.png');
    await cdp.screenshot(staffScreenshotPath);

    console.log('\n======================================================');
    console.log('🎉 ALL FORM INPUT SANITIZATION & VALIDATION TESTS PASSED!');
    console.log('======================================================');

  } finally {
    cdp.close();
    if (chromeProcess) chromeProcess.kill();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  if (chromeProcess) chromeProcess.kill();
  process.exit(1);
});
