/* Install as an app.
 *
 * Only the main app loads this file (index.html) — not the public hostel page, the pay page, or the
 * join and visit pages, which are for strangers who are not going to install anything.
 *
 * There is no single "install" call across browsers, so this works out what the visitor's browser
 * can do and says exactly that:
 *   prompt     Chrome, Edge, Brave, Opera, Samsung Internet (Android and desktop) offered the install
 *              dialog (`beforeinstallprompt`). One button installs it.
 *   ios        iPhone / iPad: Share, then "Add to Home Screen". Apple gives pages no button for this.
 *   safari-mac Safari on a Mac: File, then "Add to Dock".
 *   firefox-android  Firefox on Android: menu, then "Install".
 *   chromium   A Chromium browser that has not offered the dialog (yet): browser menu, then "Install".
 *   none       Firefox on a computer, or an in-app browser (WhatsApp, Instagram ...) that cannot
 *              install anything: we say so, and never nag.
 *
 * A pop-up appears once per visit, two minutes after the app opens, only if the app is not already
 * installed, was not dismissed recently, and nothing else (a form, a sheet) is in the way.
 */
const Pwa = (() => {
  const KEY = { installed: 'hostelos.pwa.installed', snooze: 'hostelos.pwa.snooze', shown: 'hostelos.pwa.shown' };
  const DAY = 864e5, AFTER_MS = 120000;
  const store = {
    get(k, area = 'localStorage') { try { return window[area].getItem(k); } catch (e) { return null; } },
    set(k, v, area = 'localStorage') { try { window[area].setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const tr = s => (typeof t === 'function' ? t(s) : s);
  let evt = null, timer = null, retries = 0;

  // Pure: what is this browser, and what can it do? (Everything it needs is passed in, so it can be tested.)
  function detect({ ua = '', platform = '', touch = 0, hasEvt = false } = {}) {
    const ios = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touch > 1);
    const android = /Android/i.test(ua);
    const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|MicroMessenger|WhatsApp|Twitter|LinkedInApp|GSA\/|; wv\)|Telegram/i.test(ua);
    const firefox = /Firefox|FxiOS/i.test(ua);
    const edge = /Edg(e|A|iOS)?\//.test(ua), opera = /OPR\/|OPiOS/.test(ua), samsung = /SamsungBrowser/.test(ua);
    const chromium = !firefox && (/Chrome|CriOS|Chromium/.test(ua) || edge || opera || samsung);
    const safari = /Safari/.test(ua) && !chromium && !firefox;
    const browser = firefox ? 'firefox' : edge ? 'edge' : opera ? 'opera' : samsung ? 'samsung' : chromium ? 'chrome' : safari ? 'safari' : 'other';
    const os = ios ? 'ios' : android ? 'android' : 'desktop';
    let mode;
    if (inApp) mode = 'none';
    else if (hasEvt) mode = 'prompt';
    else if (ios) mode = 'ios';
    else if (browser === 'safari') mode = 'safari-mac';
    else if (browser === 'firefox') mode = android ? 'firefox-android' : 'none';
    else if (chromium) mode = 'chromium';
    else mode = 'none';
    return { os, browser, inApp, mode };
  }
  const env = () => detect({ ua: navigator.userAgent || '', platform: navigator.platform || '', touch: navigator.maxTouchPoints || 0, hasEvt: !!evt });
  const standalone = () => {
    try { if (navigator.standalone === true) return true; return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some(m => matchMedia(`(display-mode: ${m})`).matches); } catch (e) { return false; }
  };
  const installed = () => standalone() || store.get(KEY.installed) === '1';
  const snoozed = () => +store.get(KEY.snooze) > Date.now();
  const snooze = days => { store.set(KEY.snooze, String(Date.now() + days * DAY)); try { if (typeof closeModal === 'function') closeModal(); } catch (e) { /* nothing open */ } };
  const changed = () => { try { if (typeof updateChrome === 'function') updateChrome(); } catch (e) { /* shell not drawn yet */ } };

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); evt = e;
    store.del(KEY.installed);          // the browser offers it only when it is NOT installed: a stale "installed" note is wrong
    changed();
  });
  window.addEventListener('appinstalled', () => {
    evt = null; store.set(KEY.installed, '1');
    if (typeof closeModal === 'function') closeModal();
    if (typeof toast === 'function') toast(tr('Installed. Open Sarvlekh from your home screen or desktop.'));
    changed();
  });

  async function prompt() {
    if (!evt) return false;
    const e = evt; evt = null;          // a browser lets each offer be used once
    try {
      e.prompt();
      const r = await e.userChoice;
      if (r && r.outcome === 'accepted') store.set(KEY.installed, '1'); else store.set(KEY.snooze, String(Date.now() + 3 * DAY));
    } catch (err) { console.warn(err); }
    if (typeof closeModal === 'function') closeModal();
    changed();
    return true;
  }

  const I = {
    share: '<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>',
    dots: '<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>',
    plus: '<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>',
    install: '<svg class="pi" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 7v6M9 10l3 3 3-3M8 20h8"/></svg>',
  };
  // The steps for the browsers that have no button to press. Short, in the order the screen shows them.
  function steps(m, e) {
    const list = {
      ios: [`${tr('Tap the Share button')} ${I.share} ${e.browser === 'safari' ? tr('at the bottom of Safari') : tr('in your browser')}.`, `${tr('Scroll down and tap')} <b>${tr('Add to Home Screen')}</b> ${I.plus}.`, `${tr('Tap')} <b>${tr('Add')}</b>. ${tr('Sarvlekh now sits on your home screen.')}`],
      'safari-mac': [`${tr('In the menu bar choose')} <b>${tr('File')}</b>.`, `${tr('Click')} <b>${tr('Add to Dock')}</b>.`, `${tr('Click')} <b>${tr('Add')}</b>.`],
      'firefox-android': [`${tr('Tap the menu')} ${I.dots}.`, `${tr('Tap')} <b>${tr('Install')}</b>.`, `${tr('Tap')} <b>${tr('Add')}</b>.`],
      chromium: e.os === 'desktop'
        ? [`${tr('Look for the install icon')} ${I.install} ${tr('at the right end of the address bar and click it.')}`, `${tr('Or open the menu')} ${I.dots} ${tr('and choose')} <b>${tr('Install Sarvlekh')}</b> / <b>${tr('Save and share')} &gt; ${tr('Install page as app')}</b>.`, `${tr('Click')} <b>${tr('Install')}</b>.`]
        : [`${tr('Tap the menu')} ${I.dots}.`, `${tr('Tap')} <b>${tr('Install app')}</b> ${tr('or')} <b>${tr('Add to Home screen')}</b>.`, `${tr('Tap')} <b>${tr('Install')}</b>.`],
    };
    return list[m] || [];
  }

  // The pop-up, and the sheet the menu button opens. One look on a phone (a sheet from the bottom) and
  // on a computer (a centred card): that is openModal's job.
  function open(manual) {
    if (typeof openModal !== 'function') return;
    const e = env(), m = e.mode;
    if (installed()) { if (manual && typeof toast === 'function') toast(tr('Sarvlekh is already installed on this device.')); return; }
    if (manual && m === 'prompt') { prompt(); return; }          // the menu button: go straight to the browser's own dialog
    const lead = `<div class="pwa"><img src="icons/icon-192.png" alt="" width="64" height="64"><div><b>${esc(tr('Use Sarvlekh like an app'))}</b><p>${esc(tr('Opens full screen from your home screen or desktop, loads faster and keeps you signed in.'))}</p></div></div>`;
    let body, foot;
    if (m === 'prompt') {
      body = lead;
      foot = `<button class="btn" data-act="pwalater">${esc(tr('Not now'))}</button><button class="btn primary" data-act="pwainstall">${esc(tr('Install app'))}</button>`;
    } else if (m === 'none') {
      body = `${lead}<div class="note">${esc(e.inApp ? tr('This page is open inside another app, which cannot install it. Tap the menu and choose "Open in browser" (Chrome or Safari), then try again.') : tr('This browser cannot install apps. Open Sarvlekh in Chrome or Edge to install it.'))}</div>`;
      foot = `<button class="btn primary" data-act="close">${esc(tr('Got it'))}</button>`;
    } else {
      body = `${lead}<ol class="pwa-steps">${steps(m, e).map(x => `<li>${x}</li>`).join('')}</ol>`;
      foot = `<button class="btn" data-act="pwanever">${esc(tr('Don\'t ask again'))}</button><button class="btn primary" data-act="pwalater">${esc(tr('Got it'))}</button>`;
    }
    openModal({ title: tr('Install Sarvlekh'), body, foot });
  }

  // Two minutes after the app opens. Never over a form, never twice in one visit, never after a no.
  function tick() {
    timer = null;
    if (installed() || snoozed() || store.get(KEY.shown, 'sessionStorage') === '1') return;
    if (env().mode === 'none') return;
    if (document.hidden) { document.addEventListener('visibilitychange', function again() { if (!document.hidden) { document.removeEventListener('visibilitychange', again); timer = setTimeout(tick, 5000); } }); return; }
    const busy = (document.getElementById('modalRoot') && document.getElementById('modalRoot').innerHTML.trim()) || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
    if (busy) { if (++retries <= 8) timer = setTimeout(tick, 30000); return; }
    store.set(KEY.shown, '1', 'sessionStorage');
    open(false);
  }
  function start() { if (!timer && !installed()) timer = setTimeout(tick, AFTER_MS); }

  // The button in the menu: shown until the app is installed (or can never be).
  const button = () => (installed() ? '' : `<button class="install-btn" data-act="install">${I.install}<span>${esc(tr('Install app'))}</span></button>`);

  return { detect, env, standalone, installed, snoozed, snooze, prompt, open, start, button, steps, tick, KEY, AFTER_MS, _set: e => { evt = e; } };
})();
