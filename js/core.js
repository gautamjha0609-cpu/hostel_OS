'use strict';
/* Sarvlekh core: utilities, i18n, icons and UI building blocks shared by every screen. */

/* ================= utils ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const parse = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
const ymOf = s => String(s).slice(0, 7);
const addMonths = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n - 1; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return `${y}-${pad(m + 1)}`; };
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const nowIso = () => new Date().toISOString();
const inr = n => (n < 0 ? '-' : '') + '₹' + Math.round(Math.abs(n || 0)).toLocaleString('en-IN');
const num = n => (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN');
const round2 = n => Math.round((n || 0) * 100) / 100;
const uid = (p = '') => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
const sum = (a, f) => a.reduce((t, x) => t + (f ? f(x) : x), 0) || 0;
const by = (k, dir = 1) => (a, b) => (a[k] > b[k] ? dir : a[k] < b[k] ? -dir : 0);
const groupBy = (a, f) => a.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m; }, {});
const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const digits = s => String(s || '').replace(/\D/g, '');
const phone10 = s => digits(s).slice(-10);
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 30) || 'user';
const clone = o => JSON.parse(JSON.stringify(o));
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
function deepMerge(base, over) {
  const out = clone(base);
  for (const k in over || {}) out[k] = isObj(over[k]) && isObj(out[k]) ? deepMerge(out[k], over[k]) : over[k];
  return out;
}
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const minutes = hhmm => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/* ================= i18n ================= */
const LKEY = 'hostelos.lang';
let LANG = (() => { try { return localStorage.getItem(LKEY) || 'en'; } catch (e) { return 'en'; } })();
// t('Text {x}', {x}) — English is the key; Hindi comes from window.I18N_HI, falling back to English.
function t(s, vars) {
  let out = (LANG === 'hi' && window.I18N_HI && window.I18N_HI[s]) || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return out;
}
function setLang(l) { LANG = l === 'hi' ? 'hi' : 'en'; try { localStorage.setItem(LKEY, LANG); } catch (e) { /* private mode */ } document.documentElement.lang = LANG; }
// English is built into the source, so the Hindi dictionary is only ever fetched for Hindi.
function ensureLang() { return LANG === 'hi' && !window.I18N_HI ? loadScript('/js/i18n-hi.js') : Promise.resolve(); }
const MONTHS_EN = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const MONTHS_HI = ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून', 'जुला', 'अग', 'सित', 'अक्टू', 'नवं', 'दिसं'];
const MONTHS = () => (LANG === 'hi' ? MONTHS_HI : MONTHS_EN);
const DAYS = () => (LANG === 'hi' ? ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const fmtDate = s => { if (!s) return '—'; const d = parse(s); return `${d.getDate()} ${MONTHS()[d.getMonth()]} ${d.getFullYear()}`; };
const fmtShort = s => { if (!s) return '—'; const d = parse(s); return `${d.getDate()} ${MONTHS()[d.getMonth()]}`; };
const fmtYM = ym => `${MONTHS()[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const fmtTs = ts => { if (!ts) return '—'; const d = new Date(ts); return `${d.getDate()} ${MONTHS()[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtTime = hhmm => { if (!hhmm) return ''; const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
function ago(ts) {
  const s = (Date.now() - new Date(ts)) / 1000;
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  return fmtShort(iso(new Date(ts)));
}

/* ================= icons ================= */
const IC = {
  home: '<path d="M3 11 12 3l9 8M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  bed: '<path d="M3 18V6"/><path d="M3 14h18v4"/><path d="M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M17 14c2.5 0 4.5 2 4.5 4.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  userplus: '<circle cx="10" cy="8" r="4"/><path d="M2 21c0-4.4 3.6-8 8-8 1.5 0 2.9.4 4 1.1"/><path d="M19 14v6M16 17h6"/>',
  rupee: '<path d="M7 5h10M7 9.5h10"/><path d="M8 5c4.5 0 6 2 6 4.2S12.5 13 8 13H7l8 7"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/><path d="M6 6l9-3v3"/>',
  utensils: '<path d="M6 3v8M4 3v5a2 2 0 0 0 4 0V3M6 11v10"/><path d="M17 3c-2 1.5-3 4-3 7h3v11"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h12L22 7H6.2"/>',
  broom: '<path d="M14 3 9 13"/><path d="M5 13h8l2 8H3z"/><path d="M7 17v4M11 17v4"/>',
  shirt: '<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.5-1.8 2.5-4 2.5S8.5 4.5 8 3z"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  wrench: '<path d="M15 4a5 5 0 0 0-4.5 6.8L3 18.3 5.7 21l7.5-7.5A5 5 0 0 0 20 9l-3 3-3-1-1-3z"/>',
  badge: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="2.5"/><path d="M8 17c.7-2 2.2-3 4-3s3.3 1 4 3"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4"/><circle cx="12" cy="3.5" r="1"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M9.5 16.5h5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  chev2: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 13l5-5 5 5M5 4h14"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  door: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><circle cx="15" cy="12" r="1"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-6h16v6h-3"/><rect x="7" y="14" width="10" height="7"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  wa: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .8a4.5 4.5 0 0 1-2.2-2.2l.8-1-1-2z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h11"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  megaphone: '<path d="M3 11v3l12 5V6L3 11z"/><path d="M15 9a3 3 0 0 1 0 6M6 15l1 5h3l-1-4"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.5L20 16"/><path d="M20 21v-5h-5"/>',
  box2: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 13h6"/>',
  pack: '<path d="M4 8h16v12H4z"/><path d="M8 8V5a4 4 0 0 1 8 0v3"/>',
  skip: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  star: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
};
const ico = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;

/* ================= feedback ================= */
function toast(msg, kind = 'ok', action) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.setAttribute('role', 'status');
  el.innerHTML = `${ico(kind === 'bad' ? 'x' : 'check', 'sm')}<span>${esc(t(msg))}</span>${action ? `<button>${esc(t(action.label))}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.remove(); action.run(); };
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), action ? 6000 : 3200);
}
const haptic = () => { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* unsupported */ } };

/* ================= modal & forms ================= */
let modalSubmit = null, modalOnClose = null;
function openModal({ title, body, foot, wide, cls }) {
  closeModal(true);
  const root = $('#modalRoot');
  root.innerHTML = `<div class="mback" data-act="mback"><div class="modal ${wide ? 'wide' : ''} ${cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(t(title))}">
    <header><h3>${esc(t(title))}</h3><button class="ibtn" style="width:32px;height:32px" data-act="close" aria-label="${esc(t('Close'))}">${ico('x', 'sm')}</button></header>
    <div class="mbody">${body}</div>${foot ? `<footer>${foot}</footer>` : ''}</div></div>`;
  document.body.style.overflow = 'hidden';
  Picker.enhance(root);
  const f = $('input:not([type=hidden]):not([type=checkbox]):not([type=file]),textarea', root.querySelector('.mbody'));
  if (f && !matchMedia('(pointer:coarse)').matches) f.focus();
}
function closeModal(silent) {
  Picker.close();
  const root = $('#modalRoot'); if (!root || !root.innerHTML) return;
  root.innerHTML = ''; document.body.style.overflow = ''; document.body.classList.remove('printing'); modalSubmit = null;
  if (modalOnClose) { const f = modalOnClose; modalOnClose = null; if (!silent) f(); }
}
const optVal = o => (typeof o === 'object' ? o.v : o);
const optLbl = o => (typeof o === 'object' ? o.l : t(o));
function fieldHtml(f) {
  if (f.type === 'html') return `<div class="${f.half ? '' : 'full'}">${f.html}</div>`;
  if (f.type === 'section') return `<div class="full group-t" style="padding:8px 2px 0">${esc(t(f.label))}</div>`;
  const id = 'f_' + f.name, v = f.value ?? '', lbl = esc(t(f.label || ''));
  // `info` (and `hint`, unless hintShow) goes behind an "i" next to the label; hintShow keeps
  // short live text such as a computed preview on screen.
  const info = f.info || (f.hintShow ? '' : f.hint), shown = f.hintShow ? f.hint : '';
  const wrap = inner => `<div class="${f.full ? 'full' : ''}" data-fw="${f.name}" ${f.hidden ? 'hidden' : ''}>${f.label ? `<label class="f" for="${id}">${lbl}${f.required ? ' *' : ''}${tip(info)}</label>` : ''}${inner}${shown || (!f.label && info) ? `<div class="hint" style="margin-top:4px">${shown || info}</div>` : ''}</div>`;
  if (f.type === 'select') {
    const opt = o => `<option value="${esc(optVal(o))}" ${String(optVal(o)) === String(v) ? 'selected' : ''}>${esc(optLbl(o))}</option>`;
    // An option may carry {g: 'Block A'}; same-g options are kept together under a heading.
    let body = '';
    if (f.options.some(o => o && o.g)) {
      let g0 = null;
      for (const o of f.options) {
        const g = o.g || '';
        if (g !== g0) { if (g0) body += '</optgroup>'; if (g) body += `<optgroup label="${esc(g)}">`; g0 = g; }
        body += opt(o);
      }
      if (g0) body += '</optgroup>';
    } else body = f.options.map(opt).join('');
    return wrap(`<select id="${id}" name="${f.name}">${f.placeholder ? `<option value="">${esc(t(f.placeholder))}</option>` : ''}${body}</select>`);
  }
  if (f.type === 'textarea') return wrap(`<textarea id="${id}" name="${f.name}" placeholder="${esc(t(f.placeholder || ''))}">${esc(v)}</textarea>`);
  if (f.type === 'checkbox') return `<div class="${f.full ? 'full' : ''}" data-fw="${f.name}"><label class="row nw" style="gap:10px;font-weight:600;font-size:15px;min-height:44px"><input type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''}> <span>${lbl}</span>${tip(f.info || f.hint)}</label></div>`;
  if (f.type === 'multi') { const cur = (v || []).map(String); return wrap(`<div class="mchk" id="${id}">${f.options.map(o => `<label><input type="checkbox" name="${f.name}" value="${esc(optVal(o))}" ${cur.includes(String(optVal(o))) ? 'checked' : ''}>${esc(optLbl(o))}</label>`).join('') || `<span class="hint">${esc(t('Nothing to choose yet'))}</span>`}</div>`); }
  if (f.type === 'file') return wrap(`<input id="${id}" name="${f.name}" type="file" accept="${f.accept || 'image/*,application/pdf'}" ${f.multiple ? 'multiple' : ''} ${f.capture ? 'capture="environment"' : ''}>`);
  // Browsers and password managers offer to "helpfully" fill an amount box from saved
  // payment cards, and drop a dark panel over the buttons underneath it. None of these fields
  // is a card number, so every one of them opts out — autocomplete alone is not enough,
  // Chrome, Edge, LastPass and 1Password each need their own hint.
  const noFill = 'autocomplete="off" autocorrect="off" data-form-type="other" data-lpignore="true" data-1p-ignore data-bwignore';
  const extra = [f.min != null && `min="${f.min}"`, f.max != null && `max="${f.max}"`, f.step && `step="${f.step}"`, f.maxlength && `maxlength="${f.maxlength}"`,
    f.type === 'tel' && 'inputmode="tel"', f.type === 'number' && `inputmode="${f.step && f.step < 1 ? 'decimal' : 'numeric'}"`, f.inputmode && `inputmode="${f.inputmode}"`, f.readonly && 'readonly',
    f.type === 'number' && noFill].filter(Boolean).join(' ');
  return wrap(`<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(t(f.placeholder || ''))}" ${extra} autocomplete="${f.autocomplete || 'one-off'}" data-lpignore="true" data-1p-ignore>`);
}
function formValues(form, fields) {
  const o = {};
  for (const f of fields) {
    if (!f.name || f.type === 'html' || f.type === 'section') continue;
    if (f.type === 'multi') { o[f.name] = $$(`input[name="${f.name}"]:checked`, form).map(x => x.value); continue; }
    const el = form.elements[f.name]; if (!el) continue;
    if (f.type === 'checkbox') o[f.name] = el.checked;
    else if (f.type === 'file') o[f.name] = el.files ? [...el.files] : [];
    else if (f.type === 'number') o[f.name] = el.value === '' ? NaN : parseFloat(el.value);
    else o[f.name] = el.value.trim();
  }
  return o;
}
function setField(form, name, value) { const el = form.elements[name]; if (el && document.activeElement !== el) el.value = value ?? ''; }
function showField(form, name, on) { const w = $(`[data-fw="${name}"]`, form); if (w) w.hidden = !on; }
// Generic form sheet. onSubmit may return an error string to keep the sheet open, or a promise.
function formModal({ title, fields, submit = 'Save', onSubmit, note, wide, preview, onChange, extra = '', danger }) {
  const body = `<form id="mform" novalidate autocomplete="off">${note ? `<div class="note">${note}</div>` : ''}<div class="fgrid">${fields.map(fieldHtml).join('')}</div>${extra}<div class="prev" id="mprev"></div><div class="ferr" id="mferr" role="alert"></div></form>`;
  openModal({ title, body, wide, foot: `${danger ? `<button class="btn bad" type="button" data-act="mdanger">${esc(t(danger.label))}</button><span class="sp"></span>` : ''}<button class="btn" type="button" data-act="close">${esc(t('Cancel'))}</button><button class="btn primary" type="button" data-act="msubmit">${esc(t(submit))}</button>` });
  const form = $('#mform');
  const upd = e => {
    const vals = formValues(form, fields);
    if (onChange) try { onChange(vals, form, e && e.target && e.target.name); } catch (err) { console.error(err); }
    if (preview) { try { $('#mprev').innerHTML = preview(formValues(form, fields)) || ''; } catch (err) { $('#mprev').innerHTML = ''; } }
  };
  form.addEventListener('input', upd); form.addEventListener('change', upd); upd();
  Picker.enhance(form);
  if (danger) modalDanger = () => danger.run();
  let busy = false;
  modalSubmit = async () => {
    if (busy) return;
    const vals = formValues(form, fields), err = $('#mferr'); err.textContent = '';
    for (const f of fields) {
      if (!f.name || f.type === 'html' || f.type === 'section') continue;
      const w = $(`[data-fw="${f.name}"]`, form); if (w && w.hidden) continue;
      const v = vals[f.name], L = t(f.label || f.name);
      if (f.required && (v === '' || v == null || (typeof v === 'number' && isNaN(v)) || (Array.isArray(v) && !v.length))) { err.textContent = t('{f} is required.', { f: L }); form.elements[f.name]?.focus?.(); return; }
      if (f.type === 'number' && !isNaN(v) && f.min != null && v < f.min) { err.textContent = t('{f} must be at least {n}.', { f: L, n: f.min }); return; }
      if (f.type === 'number' && !isNaN(v) && f.max != null && v > f.max) { err.textContent = t('{f} must be at most {n}.', { f: L, n: f.max }); return; }
      if (f.type === 'tel' && v && phone10(v).length !== 10) { err.textContent = t('{f} must be a 10-digit mobile number.', { f: L }); return; }
      if (f.pattern && v && !f.pattern.test(v)) { err.textContent = t('{f} looks invalid.', { f: L }); return; }
    }
    busy = true; const sb = $('[data-act="msubmit"]'); if (sb) sb.disabled = true;
    try {
      const res = await onSubmit(vals, form);
      if (typeof res === 'string' && res) { err.textContent = t(res); return; }
      if (res === false) return;
      closeModal(); render();
    } catch (e2) {
      console.error(e2); err.textContent = t(e2.message || 'Something went wrong. Please try again.');
    } finally { busy = false; const b2 = $('[data-act="msubmit"]'); if (b2) b2.disabled = false; }
  };
  form.addEventListener('submit', e => { e.preventDefault(); modalSubmit && modalSubmit(); });
  return form;
}
let modalDanger = null;
function confirmBox(msg, onYes, label = 'Confirm', kind = 'primary') {
  openModal({ title: 'Please confirm', body: `<p style="font-size:16px">${msg}</p>`, foot: `<button class="btn" data-act="close">${esc(t('Cancel'))}</button><button class="btn ${kind}" data-act="msubmit">${esc(t(label))}</button>` });
  modalSubmit = async () => { closeModal(); await onYes(); render(); };
}
function sheet(title, html, opts = {}) { openModal({ title, body: html, wide: opts.wide, foot: opts.foot }); }

/* ================= pickers =================
 * Progressive enhancement over <select>. The native element stays in the DOM and keeps the
 * value, so formValues(), form.elements[name] and every existing change handler carry on
 * working untouched — we only take over how it looks and how the list is presented.
 */
const Picker = {
  open: null,

  // Wraps every select inside `root` that has not been wrapped yet. Safe to call on each render.
  enhance(root = document) {
    for (const sel of $$('select:not([data-pk])', root)) {
      if (sel.closest('.pk')) { sel.dataset.pk = '1'; continue; }
      sel.dataset.pk = '1';
      const wrap = document.createElement('div');
      wrap.className = 'pk' + (sel.classList.contains('hsel') ? ' pk-pill' : '');
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pk-btn';
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      if (sel.id) btn.setAttribute('aria-labelledby', 'label-for-' + sel.id);
      wrap.appendChild(btn);
      this.paint(wrap);
      btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); this.show(wrap); });
      btn.addEventListener('keydown', e => {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); this.show(wrap); }
      });
      // keep the button in step when code changes the select (setField, onChange handlers…)
      sel.addEventListener('change', () => this.paint(wrap));
    }
  },

  paint(wrap) {
    const sel = $('select', wrap), btn = $('.pk-btn', wrap);
    if (!sel || !btn) return;
    const opt = sel.options[sel.selectedIndex];
    const empty = !opt || opt.value === '';
    btn.innerHTML = `<span class="v ${empty ? 'ph' : ''}">${esc(opt ? opt.textContent : '')}</span>${ico('chev2', 'sm')}`;
    wrap.classList.toggle('disabled', sel.disabled);
    btn.disabled = sel.disabled;
  },

  close() {
    if (!this.open) return;
    const { pop, scrim, wrap } = this.open;
    pop.remove(); scrim.remove();
    const btn = $('.pk-btn', wrap);
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
    this.open = null;
    document.removeEventListener('keydown', this.onKey);
  },

  // How many options before the list gets its own search box. Picking one resident out of
  // sixty by scrolling is the thing people actually complain about.
  SEARCH_FROM: 8,

  show(wrap) {
    if (this.open && this.open.wrap === wrap) return this.close();
    this.close();
    const sel = $('select', wrap), btn = $('.pk-btn', wrap);
    if (!sel || sel.disabled) return;
    const phone = matchMedia('(max-width:640px)').matches;

    const scrim = document.createElement('div');
    scrim.className = 'pk-scrim';
    const pop = document.createElement('div');
    pop.className = 'pk-pop';

    const label = (sel.id && ($(`label[for="${sel.id}"]`) || {}).textContent) || '';
    const searchable = sel.options.length > this.SEARCH_FROM;
    // The head never scrolls, so the title and the search box stay put while the list moves.
    let html = `<div class="pk-head">${label ? `<div class="pk-title">${esc(label)}</div>` : ''}`;
    if (searchable) html += `<input class="pk-q" type="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${esc(t('Search…'))}" aria-label="${esc(t('Search…'))}">`;
    html += `</div><div class="pk-list" role="listbox" tabindex="-1">`;
    let g0 = '';
    for (const o of sel.options) {
      // <optgroup> children carry their group label, so show it as a heading once
      const g = o.parentNode.tagName === 'OPTGROUP' ? o.parentNode.label : '';
      if (g && g !== g0) { html += `<div class="pk-group">${esc(g)}</div>`; g0 = g; }
      html += `<button type="button" class="pk-opt" role="option" data-v="${esc(o.value)}"
        aria-selected="${o.selected}" ${o.disabled ? 'disabled' : ''}>
        <span class="tick">${ico('check', 'sm')}</span><span class="lbl">${esc(o.textContent)}</span></button>`;
    }
    html += `<div class="pk-none" hidden>${esc(t('No results'))}</div></div>`;
    pop.innerHTML = html;
    document.body.appendChild(scrim);
    document.body.appendChild(pop);
    this.place(pop, btn);
    btn.setAttribute('aria-expanded', 'true');
    this.open = { wrap, pop, scrim };

    const list = $('.pk-list', pop), q = $('.pk-q', pop);
    const pick = v => {
      if (String(sel.value) === String(v)) return this.close();
      sel.value = v;
      this.paint(wrap);
      this.close();
      // the rest of the app listens for a normal change event, so fire a real one
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const b of $$('.pk-opt', pop)) b.addEventListener('click', () => pick(b.dataset.v));
    scrim.addEventListener('click', () => this.close());

    const shown = () => $$('.pk-opt:not([hidden]):not([disabled])', pop);
    const focus = el => {
      if (!el) return;
      $$('.pk-opt.cur', pop).forEach(o => o.classList.remove('cur'));
      el.classList.add('cur');
      el.scrollIntoView({ block: 'nearest' });
    };
    const step = n => { const all = shown(); if (!all.length) return; const i = all.findIndex(o => o.classList.contains('cur')); focus(all[(i + n + all.length) % all.length]); };
    focus(shown().find(o => o.getAttribute('aria-selected') === 'true') || shown()[0]);

    if (q) {
      const filter = () => {
        const needle = q.value.trim().toLowerCase();
        for (const o of $$('.pk-opt', pop)) o.hidden = !!needle && !$('.lbl', o).textContent.toLowerCase().includes(needle);
        // a group heading with nothing left under it is just noise
        for (const g of $$('.pk-group', pop)) {
          let n = g.nextElementSibling, any = false;
          while (n && !n.classList.contains('pk-group')) { if (n.classList.contains('pk-opt') && !n.hidden) { any = true; break; } n = n.nextElementSibling; }
          g.hidden = !any;
        }
        $('.pk-none', pop).hidden = shown().length > 0;
        focus(shown()[0]);
      };
      q.addEventListener('input', filter);
      // On a phone, focusing this would throw the keyboard over the sheet the moment it
      // opens, so the list comes first and the field waits to be tapped.
      if (!phone) setTimeout(() => q.focus(), 20);
    }
    if (phone || !q) setTimeout(() => list.focus(), 20);

    this.onKey = e => {
      const typing = q && e.target === q;
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); const c = $('.pk-opt.cur', pop); if (c) pick(c.dataset.v); }
      else if (e.key === ' ' && !typing) { e.preventDefault(); const c = $('.pk-opt.cur', pop); if (c) pick(c.dataset.v); }
      else if (e.key === 'Tab') this.close();
      else if (!typing && /^\w$/.test(e.key)) {   // type a letter to jump, like a real select
        const all = shown(), i = all.findIndex(o => o.classList.contains('cur'));
        const hit = k => all.findIndex((o, j) => j > i && $('.lbl', o).textContent.trim().toLowerCase().startsWith(k));
        const k = e.key.toLowerCase();
        const n = hit(k) >= 0 ? hit(k) : all.findIndex(o => $('.lbl', o).textContent.trim().toLowerCase().startsWith(k));
        if (n >= 0) focus(all[n]);
      }
    };
    document.addEventListener('keydown', this.onKey);
  },

  // Always opens BELOW the field, on every screen size. When there is not enough room under
  // it, the sheet/page scrolls the field up first, so the list never flips above or covers it.
  makeRoom(btn, want) {
    const r = btn.getBoundingClientRect(), below = window.innerHeight - r.bottom - 16;
    if (below >= want) return;
    let need = want - below, el = btn.parentNode;
    this.quietUntil = Date.now() + 900;   // our own scroll must not close the list
    while (el && el !== document.body && need > 0) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) {
        const before = el.scrollTop; el.scrollTop += need; need -= el.scrollTop - before;
      }
      el = el.parentNode;
    }
    if (need > 0) window.scrollBy(0, need);
  },
  place(pop, btn) {
    const r = btn.getBoundingClientRect(), gap = 6, edge = 10;
    pop.style.width = Math.max(r.width, 220) + 'px';
    pop.style.maxHeight = Math.max(160, Math.floor(window.innerHeight - r.bottom - gap - edge)) + 'px';
    pop.style.top = (r.bottom + gap) + 'px';
    pop.style.left = Math.min(Math.max(edge, r.left), Math.max(edge, window.innerWidth - pop.offsetWidth - edge)) + 'px';
  },
};
// A dropdown must not hang in mid-air when the page behind it moves — but scrolling a long
// option list is scrolling too, and that must not close the thing you are reading.
window.addEventListener('resize', () => Picker.close());
window.addEventListener('scroll', e => {
  if (!Picker.open) return;
  if (e.target && e.target.nodeType === 1 && e.target.closest && e.target.closest('.pk-pop')) return;
  Picker.close();
}, true);

/* ================= images & files ================= */
function fileToDataURL(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onerror = () => rej(new Error('Could not read file')); fr.onload = () => res(fr.result); fr.readAsDataURL(file); });
}
// Downscale photos before upload: saves the owner's mobile data and our storage. WebP where
// the browser can write it (about a third smaller than JPEG at the same quality); Safari
// cannot, and quietly hands back a PNG, so anything that is not WebP is redone as JPEG.
async function compressImage(file, max = 1280, q = 0.7) {
  if (!file || !/^image\//.test(file.type) || /gif|svg/.test(file.type)) return file;
  try {
    const url = await fileToDataURL(file);
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(im.width, im.height));
    if (k === 1 && file.size < 200 * 1024 && /jpeg|webp/.test(file.type)) return file;
    const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    const enc = type => new Promise(r => c.toBlob(r, type, q));
    let blob = await enc('image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await enc('image/jpeg');
    if (!blob || (k === 1 && blob.size >= file.size)) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.jpg'), { type: blob.type });
  } catch (e) { return file; }
}
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
const csv = rows => rows.map(r => r.map(c => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');

/* ================= view builders ================= */
const badge = (s, k = '') => `<span class="badge ${k}">${esc(t(s))}</span>`;
const avatar = n => `<span class="av" style="background:hsl(${hue(n)} 55% 30%)">${esc(initials(n))}</span>`;
function kpi(l, v, s, kind, to, icon) {
  const inner = `<div class="l">${icon ? ico(icon, 'sm') : ''}${esc(t(l))}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div>`;
  return to ? `<button class="kpi ${kind || ''}" data-act="go" data-to="${to}">${inner}</button>` : `<div class="kpi ${kind || ''}">${inner}</div>`;
}
// Explanations live behind a small "i" button instead of sitting on the screen as paragraphs.
// `html` is trusted markup built by the app (it may hold a link), never user input.
const tip = html => html ? `<span class="ib-w"><button type="button" class="ib" data-act="tip" aria-label="${esc(t('More info'))}">i</button><span class="ib-tx" hidden>${html}</span></span>` : '';
const about = text => `<div class="about">${tip(esc(t(text)))}</div>`;
const plainLen = h => String(h || '').replace(/<[^>]*>/g, '').length;
// A short subtitle is a status ("3 visitors inside"); a long one is an explanation → behind "i".
function head(title, sub, actions = '') {
  const long = sub && plainLen(sub) > 60;
  return `<div class="sec-head"><div><h2>${esc(t(title))}${long ? tip(sub) : ''}</h2>${sub && !long ? `<p>${sub}</p>` : ''}</div><div class="row">${actions}</div></div>`;
}
const btn = (label, act, attrs = '', cls = '', icon = '') => `<button class="btn ${cls}" data-act="${act}" ${attrs}>${icon ? ico(icon, 'sm') : ''}${label ? `<span>${esc(t(label))}</span>` : ''}</button>`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const empty = (title, sub = '', action = '') => `<div class="empty"><b>${esc(t(title))}</b>${esc(t(sub))}${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;
// iOS list row. o: {icon, ic (color class), t, d, end, act, attrs, chev}
function li(o) {
  const tag = o.act ? 'button' : 'div';
  return `<${tag} class="li ${o.icon ? '' : 'noic'} ${o.cls || ''}" ${o.act ? `data-act="${o.act}"` : ''} ${o.attrs || ''}>
    ${o.icon ? `<span class="ic ${o.ic || ''}">${ico(o.icon)}</span>` : o.lead || ''}
    <span class="body"><span class="t ell">${o.raw ? o.t : esc(o.t)}</span>${o.d ? `<span class="d">${o.rawd ? o.d : esc(o.d)}</span>` : ''}</span>
    ${o.end != null || o.act ? `<span class="end">${o.end ?? ''}${o.act && o.chev !== false ? ico('chev', 'chev') : ''}</span>` : ''}</${tag}>`;
}
const group = (title, rows, foot) => `${title ? `<div class="group-t">${esc(t(title))}</div>` : ''}<div class="group">${rows || `<div class="li noic"><span class="body muted">${esc(t('Nothing here yet'))}</span></div>`}</div>${foot ? `<div class="group-f">${foot}</div>` : ''}`;
function seg(key, list, def) {
  const cur = ui.tab[key] || def;
  return `<div class="seg" role="tablist">${list.map(([k, l, n]) => `<button role="tab" class="${cur === k ? 'on' : ''}" aria-selected="${cur === k}" data-act="tab" data-key="${key}" data-tab="${k}">${esc(t(l))}${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>`;
}
const curTab = (key, def) => ui.tab[key] || def;
function searchBox(key, ph) { return `<div class="search">${ico('search', 'sm')}<input type="search" data-q="${key}" value="${esc(ui.q[key] || '')}" placeholder="${esc(t(ph))}" aria-label="${esc(t(ph))}"></div>`; }
function chips(key, list, def) {
  const cur = ui.flt[key] || def;
  return `<div class="chips">${list.map(([k, l]) => `<button class="chip ${cur === k ? 'on' : ''}" data-act="flt" data-key="${key}" data-v="${k}">${esc(t(l))}</button>`).join('')}</div>`;
}
const curFlt = (key, def) => ui.flt[key] || def;
const needle = (key, ...vals) => { const q = (ui.q[key] || '').toLowerCase().trim(); return !q || vals.join(' ').toLowerCase().includes(q); };
function table(cols, rows, o = {}) {
  if (!rows.length) return `<div class="tbl-wrap">${empty(o.emptyT || 'Nothing here yet', o.empty || '')}</div>`;
  const per = o.per || 50, key = o.key || 'x', lim = ui.lim[key] || per, shown = rows.slice(0, lim);
  return `<div class="tbl-wrap"><table class="tbl stack-m"><thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${esc(t(c.h))}</th>`).join('')}</tr></thead><tbody>${shown.map(r => `<tr>${cols.map(c => `<td data-l="${esc(t(c.h))}" class="${c.cls || ''} ${c.acts ? 'acts-td' : ''}">${c.acts ? `<div class="acts">${c.f(r)}</div>` : c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>${rows.length > lim ? `<div style="padding:12px;text-align:center"><button class="btn sm" data-act="more" data-key="${key}" data-per="${per}">${esc(t('Show more ({n} left)', { n: rows.length - lim }))}</button></div>` : ''}</div>`;
}
function barChart(labels, series, colors) {
  const W = 560, H = 210, L = 44, B = 26, P = 8, max = Math.max(1, ...series.flat()) * 1.12;
  const gw = (W - L - P) / labels.length, bw = Math.min(30, gw / (series.length + 1));
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = P + (H - B - P) * (1 - i / 4); g += `<line x1="${L}" x2="${W - P}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${(max * i) / 4 >= 1000 ? Math.round((max * i) / 4000) + 'k' : Math.round((max * i) / 4)}</text>`; }
  labels.forEach((lb, i) => {
    const cx = L + gw * i + gw / 2;
    series.forEach((s, j) => { const h = ((H - B - P) * s[i]) / max, x = cx - (series.length * bw) / 2 + j * bw; g += `<rect x="${x + 1}" y="${H - B - h}" width="${bw - 3}" height="${Math.max(0, h)}" rx="4" fill="${colors[j]}"><title>${esc(lb)}: ${inr(s[i])}</title></rect>`; });
    g += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(lb)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('Bar chart'))}">${g}</svg>`;
}
/* Scripts that most people never need are fetched the first time they are actually used:
 * the Hindi dictionary (89 KB) only for Hindi, the QR library (55 KB) only on a payment
 * screen, the super-admin console only for a super admin. Each is fetched once. */
const _loaded = {};
function loadScript(src) {
  if (_loaded[src]) return _loaded[src];
  _loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => { delete _loaded[src]; rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
  return _loaded[src];
}

// QR code as inline SVG. The library is fetched on first use; the screen redraws once it lands.
function qrSvg(text, cell = 5) {
  if (typeof qrcode !== 'function') {
    loadScript('/vendor/qrcode.js').then(() => render()).catch(() => {});
    return `<div class="qr-loading" style="min-height:160px;display:grid;place-items:center"><span class="spin"></span></div>`;
  }
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}
