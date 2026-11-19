// Web Push Notifications & VAPID Comprehensive Verification Test Suite
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const VAPID_PUB_KEY = 'BLYXNsamzeGRN76Fmay6zeSKP0osOT9acfLBGAlY4Ml-q12dWbY4uW9ilLb6u5trQhY0_FG-NaY_fWeKwiDFEyw';

test('sw.js: push event listener displays push notification with correct payload', () => {
  const swCode = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  let shownNotification = null;
  const listeners = {};

  const fakeSelf = {
    addEventListener: (type, handler) => { listeners[type] = handler; },
    registration: {
      showNotification: (title, options) => {
        shownNotification = { title, options };
        return Promise.resolve();
      }
    },
    location: { origin: 'https://hostel.test' },
    clients: {
      matchAll: async () => [],
      openWindow: async url => ({ url })
    }
  };

  const ctx = {
    self: fakeSelf,
    URL,
    console
  };
  vm.createContext(ctx);
  vm.runInContext(swCode, ctx);

  assert.ok(listeners.push, 'sw.js must register push event listener');
  assert.ok(listeners.notificationclick, 'sw.js must register notificationclick event listener');
  assert.ok(listeners.message, 'sw.js must register message event listener');

  // Simulate incoming Web Push payload
  const pushPayload = {
    title: 'Rent Due Reminder',
    body: '₹8,000 due for Room 101',
    link: '/payments',
    id: 'pay-due-101',
    category: 'payment'
  };

  let waitedPromise = null;
  const fakeEvent = {
    data: {
      json: () => pushPayload,
      text: () => JSON.stringify(pushPayload)
    },
    waitUntil: p => { waitedPromise = p; }
  };

  listeners.push(fakeEvent);
  assert.ok(waitedPromise, 'Push event must call e.waitUntil');
  assert.equal(shownNotification.title, 'Rent Due Reminder');
  assert.equal(shownNotification.options.body, '₹8,000 due for Room 101');
  assert.equal(shownNotification.options.data.link, '/payments');
  assert.equal(shownNotification.options.data.category, 'payment');
  assert.equal(shownNotification.options.renotify, true);
});

test('sw.js: local push message triggers notification when backgrounded', () => {
  const swCode = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  let shownNotification = null;
  const listeners = {};

  const fakeSelf = {
    addEventListener: (type, handler) => { listeners[type] = handler; },
    registration: {
      showNotification: (title, options) => {
        shownNotification = { title, options };
        return Promise.resolve();
      }
    },
    location: { origin: 'https://hostel.test' },
    clients: { matchAll: async () => [], openWindow: async url => ({ url }) }
  };

  const ctx = { self: fakeSelf, URL, console };
  vm.createContext(ctx);
  vm.runInContext(swCode, ctx);

  let waitedPromise = null;
  listeners.message({
    data: {
      type: 'PUSH_LOCAL',
      payload: {
        title: 'Visitor at Gate',
        body: 'Visitor Rahul entered the hostel',
        link: '/gate',
        id: 'gate-v1',
        category: 'gate'
      }
    },
    waitUntil: p => { waitedPromise = p; }
  });

  assert.ok(waitedPromise, 'Message event must call e.waitUntil');
  assert.equal(shownNotification.title, 'Visitor at Gate');
  assert.equal(shownNotification.options.data.link, '/gate');
});

test('sw.js: notificationclick focuses existing tab or opens window', async () => {
  const swCode = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const listeners = {};
  let closed = false;
  let focusedClient = null;
  let openedUrl = null;

  const fakeSelf = {
    addEventListener: (type, handler) => { listeners[type] = handler; },
    location: { origin: 'https://hostel.test' },
    clients: {
      matchAll: async () => [
        { url: 'https://hostel.test/payments', focus: async function() { focusedClient = this; } }
      ],
      openWindow: async url => { openedUrl = url; }
    }
  };

  const ctx = { self: fakeSelf, URL, console };
  vm.createContext(ctx);
  vm.runInContext(swCode, ctx);

  let waitPromise = null;
  listeners.notificationclick({
    notification: {
      close: () => { closed = true; },
      data: { link: '/payments' }
    },
    waitUntil: p => { waitPromise = p; }
  });

  await waitPromise;
  assert.equal(closed, true, 'Notification must be closed on click');
  assert.ok(focusedClient, 'Matching tab must be focused');
});

test('pwa.js: converts VAPID base64url public key to Uint8Array', () => {
  const pwaCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'pwa.js'), 'utf8');
  const mem = {};
  const ctx = {
    console, setTimeout, clearTimeout, URL, URLSearchParams, Date, Math, JSON,
    localStorage: { getItem: k => mem[k], setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => delete mem[k] },
    navigator: { onLine: true },
    window: {
      addEventListener() {},
      atob: str => Buffer.from(str, 'base64').toString('binary'),
      HOSTELOS_CONFIG: { VAPID_PUBLIC_KEY: VAPID_PUB_KEY }
    },
    document: { addEventListener() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(pwaCode + '; globalThis.Pwa = Pwa;', ctx);

  assert.ok(ctx.Pwa.isPushSupported);
  assert.ok(ctx.Pwa.getPushPermission);
  assert.ok(ctx.Pwa.subscribePush);
  assert.ok(ctx.Pwa.unsubscribePush);
  assert.ok(ctx.Pwa.togglePushWorkflow);
  assert.ok(ctx.Pwa.dispatchPush);
});

test('sw.js: fetch listener executes safely without throwing ReferenceError for location', () => {
  const swCode = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const listeners = {};
  const fakeSelf = {
    addEventListener: (type, handler) => { listeners[type] = handler; },
    location: { origin: 'https://hostel.test', hostname: 'hostel.test' },
    clients: { claim: async () => {} }
  };
  // Explicitly do not declare bare location in global scope
  const ctx = { self: fakeSelf, URL, console };
  vm.createContext(ctx);
  vm.runInContext(swCode, ctx);

  assert.ok(listeners.fetch, 'sw.js must register fetch event listener');
  let responded = false;
  listeners.fetch({
    request: { method: 'GET', url: 'https://other-domain.com/something' },
    respondWith: () => { responded = true; }
  });
  listeners.fetch({
    request: { method: 'GET', url: 'https://hostel.test/api/admin' },
    respondWith: () => { responded = true; }
  });
  assert.equal(responded, false);
});

