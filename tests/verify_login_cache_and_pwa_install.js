'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createSandbox(extra = {}) {
  const store = new Map();
  const sessionStore = new Map();

  const ctx = {
    console,
    Date,
    Math,
    JSON,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      clear: () => store.clear(),
      key: i => Array.from(store.keys())[i] || null,
      get length() { return store.size; }
    },
    sessionStorage: {
      getItem: k => (sessionStore.has(k) ? sessionStore.get(k) : null),
      setItem: (k, v) => sessionStore.set(k, String(v)),
      removeItem: k => sessionStore.delete(k),
      clear: () => sessionStore.clear()
    },
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    removeEventListener: () => {},
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
      standalone: false
    },
    location: { search: '', pathname: '/', hostname: 'localhost', protocol: 'http:' },
    document: {
      hidden: false,
      title: '',
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: () => null,
      activeElement: null
    },
    openModal: () => {},
    closeModal: () => {},
    updateChrome: () => {},
    toast: () => {},
    t: s => s,
    esc: s => s,
    ...extra
  };
  ctx.window = ctx;
  ctx.window.HOSTELOS_CONFIG = {};
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  for (const f of ['core.js', 'data.js', 'pwa.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`globalThis.Pwa = Pwa; globalThis.AuthCache = AuthCache; globalThis.LS = LS;`, ctx);
  return { ctx, store, sessionStore };
}

test('AuthCache: saves credentials, retrieves them, and clears on logout', () => {
  const { ctx, store } = createSandbox();

  assert.ok(ctx.AuthCache, 'AuthCache should be defined');
  ctx.AuthCache.save('owner_ramesh', 'securePass123', 'uuid-1234');

  const cached = ctx.LS.get('hostelos.auth.cached');
  assert.ok(cached);
  assert.equal(cached.u, 'owner_ramesh');
  assert.equal(cached.p, 'securePass123');
  assert.equal(cached.uid, 'uuid-1234');
  assert.equal(ctx.LS.get('hostelos.last_user'), 'owner_ramesh');

  ctx.AuthCache.clear();
  assert.equal(ctx.LS.get('hostelos.auth.cached'), null);
});

test('PWA install: when standalone / installed, pop-up does NOT show, button is empty', () => {
  const { ctx, store } = createSandbox({
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36',
      standalone: true
    }
  });

  assert.equal(ctx.Pwa.standalone(), true, 'navigator.standalone should indicate standalone');
  assert.equal(ctx.Pwa.installed(), true, 'Pwa.installed() must be true when standalone');

  let modalOpened = false;
  ctx.openModal = () => { modalOpened = true; };

  ctx.Pwa.open(false);
  assert.equal(modalOpened, false, 'Automatic Pwa.open(false) must not open modal when already installed');

  assert.equal(ctx.Pwa.button(), '', 'Install button in header/menu must be empty when installed');
});

test('PWA install: source=pwa in URL marks app as installed and suppresses install prompt', () => {
  const { ctx, store } = createSandbox({
    location: { search: '?source=pwa', pathname: '/' }
  });

  assert.equal(ctx.Pwa.installed(), true, 'source=pwa should mark app as installed');

  let modalOpened = false;
  ctx.openModal = () => { modalOpened = true; };
  ctx.Pwa.open(false);
  assert.equal(modalOpened, false, 'Modal should not open when launched via source=pwa');
});

test('PWA install: when NOT installed, pop-up opens cleanly and button is visible', () => {
  const { ctx, store } = createSandbox();

  assert.equal(ctx.Pwa.installed(), false, 'Pwa.installed() should be false initially in normal browser');

  let modalOpened = false;
  ctx.openModal = () => { modalOpened = true; };

  ctx.Pwa.open(false);
  assert.equal(modalOpened, true, 'Pwa.open(false) must open modal when not installed');
  assert.ok(ctx.Pwa.button().includes('Install app'), 'Install button should be present when not installed');
});

test('PWA install: beforeinstallprompt does not wipe KEY.installed when confirmed installed', () => {
  const { ctx, store } = createSandbox();

  store.set('hostelos.pwa.installed', '1');
  assert.equal(ctx.Pwa.installed(), true);

  // Trigger beforeinstallprompt simulation
  ctx.Pwa._set({ prompt: () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  // Ensure KEY.installed was not deleted
  assert.equal(ctx.Pwa.installed(), true);
});
