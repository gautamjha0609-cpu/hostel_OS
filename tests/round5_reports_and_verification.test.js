'use strict';
// Exit report PDF, branded e-mail, 60-day data removal gate, police-verification roles and the small UI fixes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(root, f), 'utf8');
const Pdf = require('../api/_pdf.js');
const Mail = require('../api/_email.js');

const sample = () => ({
  hostel: { name: 'Sunrise Boys PG' }, generatedOn: '20 Nov 2026', keepDays: 60,
  resident: { name: 'Vikas <b>Agarwal</b>', phone: '9876500011', room: '101', bed: 'A', checkIn: '3 Jan 2026', left: '19 Nov 2026', rent: 6500 },
  settlement: { rows: [['Deposit paid', 13000], ['Non-refundable fee', 1000, 'bad']], refund: 12000, balancePayable: 0, status: 'paid' },
  invoices: Array.from({ length: 80 }, (_, i) => ({ date: '01 Nov', title: 'Rent ' + i, amount: 6000, paid: 6000, balance: 0 })),
  payments: [{ date: '02 Nov', no: 'R-1', mode: 'upi', ref: 'UTR1', amount: 6000 }],
  totals: { billed: 480000, paid: 480000, waived: 0, due: 0 }, docs: ['Aadhaar card'], pv: { status: 'verified', refNo: 'RJ/1' },
});

test('exit report is a real, multi-page PDF with a valid cross-reference table', () => {
  const b = Pdf.checkoutReport(sample());
  assert.ok(Buffer.isBuffer(b));
  const s = b.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  const pages = (s.match(/\/Type \/Page /g) || []).length;
  assert.ok(pages >= 2, 'long bill lists flow onto more pages');
  const off = +s.match(/startxref\n(\d+)/)[1];
  assert.strictEqual(s.slice(off, off + 4), 'xref');
  assert.ok(s.includes(`/Count ${pages}`));
});

test('the PDF writes the rupee sign as Rs. and survives characters the font cannot draw', () => {
  const d = sample(); d.resident.name = 'राहुल ₹ test';
  const s = Pdf.checkoutReport(d).toString('latin1');
  assert.ok(s.includes('Rs.'));
  assert.ok(!/[ऀ-ॿ]/.test(s));
});

test('mail layout escapes names and shows the outcome of the settlement', () => {
  const html = Mail.checkoutMail(sample());
  assert.ok(!html.includes('<b>Agarwal</b>'), 'a name cannot inject markup');
  assert.ok(html.includes('Deposit refund') && html.includes('Rs. 12,000'));
  assert.ok(html.includes('SARVLEKH') && html.includes('Sunrise Boys PG'));
  const owes = sample(); owes.settlement = { refund: 0, balancePayable: 750 };
  assert.ok(Mail.checkoutMail(owes).includes('Balance still to collect'));
});

test('notice mail carries the amount, the lines and the pay button', () => {
  const html = Mail.brandMail({ hostelName: 'Sunrise', title: 'Rent notice', recipientName: 'Vikas', amountDue: 6500, bodyLines: 'Rent: Rs. 6500', payLink: 'https://x.test/pay' });
  assert.ok(html.includes('Rs. 6,500') && html.includes('Hello Vikas') && html.includes('https://x.test/pay'));
});

test('server: checkout report action, branded mail hook and a purge that is off unless PURGE_ENABLED=1', () => {
  const a = src('api/admin.js');
  assert.ok(/async send_checkout_report/.test(a) && /attachments:/.test(a));
  assert.ok(/b\.brand/.test(a));
  assert.ok(/process\.env\.PURGE_ENABLED === '1'/.test(a));
  assert.ok(/reportEmailedAt/.test(a), 'only residents whose report was e-mailed are touched');
  assert.ok(/out\.purge = await purgeLeftResidents/.test(a), 'runs in the daily cron');
  assert.ok(!/RESEND_API_KEY\s*=\s*['"]re_/.test(a + src('js/domain.js')), 'no key in code');
});

test('checkout sends the report and the owner e-mail lives in Settings', () => {
  assert.ok(/sendCheckoutReport\(dep\.id\)/.test(src('js/ui-owner.js')));
  assert.ok(/name: 'email', label: 'Owner e-mail'/.test(src('js/ui-settings.js')));
  assert.ok(/reportEmailedAt: nowIso\(\)/.test(src('js/domain.js')));
});

test('police verification: only the e-Mitra operator or the super admin can verify; the owner sees status', () => {
  const o = src('js/ui-owner.js'), d = src('js/domain.js');
  assert.ok(/const canVerifyPV = \(\) => ctx\(\)\.role === 'emitra' \|\| isSuper\(\)/.test(d));
  assert.ok(/A\.emitraverify = el => \{\s*if \(!canVerifyPV\(\)\)/.test(o));
  assert.ok(/act: doer \? 'emitraverify' : ''/.test(o));
  assert.ok(/pvPlatform/.test(d) && /OPT_IN_MODULES = \['cashfree', 'pvPlatform'\]/.test(d));
  assert.ok(/PAGES\['admin-pv'\]/.test(src('js/ui-admin.js')) && /A\.pvopen/.test(src('js/ui-admin.js')));
});

test('visitor can be for the owner, warden or other work, not only a resident', () => {
  const o = src('js/ui-ops.js');
  assert.ok(/name: 'who', label: 'Here to meet'/.test(o));
  assert.ok(/showField\(f, 'res', v\.who === 'resident'\)/.test(o));
});

test('small fixes: grey-then-green laundry button, premium resolve button, category sheet, app-like navigation', () => {
  const o = src('js/ui-ops.js'), w = src('js/ui-owner.js'), c = src('css/app.css'), a = src('js/app.js');
  assert.ok(/'sm ld', 'check'/.test(o) && /el\.classList\.add\('done'\)/.test(o) && /\.btn\.ld\.done/.test(c));
  assert.ok(/class="rsv"/.test(o) && /\.rsv\.on/.test(c));
  assert.ok(/A\.expcat = el =>/.test(w) && /act: 'expcat'/.test(w));
  assert.ok(/\.sch-r div span/.test(c), 'initials inside the avatar are no longer greyed by the name rule');
  assert.ok(/pg-in/.test(a));
  assert.ok(!/@keyframes pgIn\{[^}]*translate/.test(c),'page change must not push the page wider than the screen');
  assert.ok(!/contextmenu/.test(a) && !/body\.deep/.test(c), 'no back arrow, menu stays top-left');
});

test('top bar has no language or theme button; Profile keeps the appearance switch; no Language row anywhere', () => {
  const a = src('js/app.js');
  assert.ok(!/data-act="lang"/.test(a) && !/A\.lang/.test(a));
  const top = a.slice(a.indexOf('<header class="top'), a.indexOf('</header>'));
  assert.ok(!/data-act="theme"/.test(top));
  assert.ok(/act: 'theme'/.test(a), 'Appearance lives in Profile');
});

test('WhatsApp bulk automation: its own super-admin switch, and the owner Settings hide it when off', () => {
  assert.ok(/\['WhatsApp bulk automation', \['automation'\]\]/.test(src('js/ui-admin.js')));
  assert.ok(/\$\{orgEnabled\('automation'\) \? `\s+<div class="group-t">\$\{esc\(t\('Monthly bill'\)\)\}/.test(src('js/ui-settings.js')));
});

test('round 6: two police tabs, add-category on top, one-line rules header, section divider, premium toast', () => {
  const o = src('js/ui-owner.js'), st = src('js/ui-settings.js'), c = src('css/app.css'), k = src('js/core.js');
  assert.ok(/seg\('pvt', \[\['pending', 'Pending'/.test(o) && !/\['submitted', 'Submitted'/.test(o));
  assert.ok(/class="group"><div class="li noic"><input id="ls_/.test(st), 'the add box is the first row');
  const sum = st.slice(st.indexOf('<summary class="rules-head">'), st.indexOf('</summary>'));
  assert.ok(!/ico\('check'/.test(sum) && !/badge/.test(sum));
  assert.ok(/\.sec-d::after/.test(c) && /sec-d/.test(k));
  assert.ok(/toast-bar/.test(k) && /@keyframes toastIn/.test(c));
  assert.ok(/\.settings-pg\{padding-bottom:4px!important\}/.test(c), 'no double space above the bottom bar');
});

test('round 6: number boxes take digits only, everywhere (one guard in core.js)', () => {
  const k = src('js/core.js');
  assert.ok(k.includes('numbers only') && k.includes("e.key === '.' && dotOk") && k.includes('replace(/\\D/g'));
});

test('round 6: notice shortfall fee can be rent, a fee per missing day, or one flat amount', () => {
  const d = src('js/domain.js'), st = src('js/ui-settings.js');
  assert.ok(/shortfallMode === 'per_day'/.test(d) && /shortfallMode === 'flat'/.test(d));
  assert.ok(/name: 'shortfallMode'/.test(st) && /name: 'shortfallAmount'/.test(st));
  assert.ok(/sph-ring/.test(st), 'hostel page opens with a progress header');
});

test('round 7: own time picker, switch rows, WhatsApp Meta options hidden unless automation is on, premium police header', () => {
  const k = src('js/core.js'), st = src('js/ui-settings.js'), o = src('js/ui-owner.js'), c = src('css/app.css');
  assert.ok(k.includes("f.type === 'time'") && k.includes('class="tpk"') && k.includes('data-tp'), 'no native clock pop-up');
  assert.ok(k.includes('class="row nw fchk"') && /\.dep::before/.test(c));
  assert.ok(st.includes("const wab = orgEnabled('automation')") && st.includes('...(wab ?') && st.includes('wab ? li('));
  assert.ok(!st.includes('rules-tpl'), 'template name tag removed');
  assert.ok(o.includes('pvh-ring') && o.includes('pvh-st'));
});

test('every browser and server script parses (a syntax slip must never reach the app)', () => {
  const vm = require('vm');
  for (const dir of ['js', 'api']) for (const f of fs.readdirSync(path.join(root, dir)).filter(x => x.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(src(`${dir}/${f}`), { filename: `${dir}/${f}` }), `${dir}/${f}`);
  }
});

test('platform admin without a hostel cannot open hostel screens; the offline-changes badge exists only with a server', () => {
  const a = src('js/app.js');
  assert.ok(a.includes("ctx().role === 'super' && !ctx().hostelId && !/^(admin|me$)/.test(page)"));
  assert.ok(!a.includes('outboxBadge') && a.includes("if (CLOUD && Store.outbox && Store.outbox.length > 0)"));
});


test('the installed web app updates itself: checks for a new version, reloads at a safe moment, never in a loop', () => {
  const a = src('js/app.js');
  assert.ok(a.includes('reg.update()') && a.includes('visibilitychange') && a.includes('10 * 60 * 1000'));
  assert.ok(a.includes("addEventListener('controllerchange', () => { if (had) { waiting = true; tryApply(); } })"));
  assert.ok(a.includes("mr && mr.innerHTML") && a.includes('Store.flushing || Store.syncing'), 'never while a form is open or saving');
  assert.ok(a.includes("Date.now() - last < 60000"), 'at most once a minute, so it can never loop');
  assert.ok(!a.includes("label: t('Reload')"), 'no more "tap Reload" prompt');
});


test('a resident whose record is not found sees loading, checked-out or a helpful screen - and staff are sent home', () => {
  const r = src('js/ui-resident.js');
  assert.ok(r.includes('Loading your details...') && r.includes('You have checked out') && r.includes('Your account is not linked to a room yet'));
  assert.ok(r.includes("if (!isResident()) { setTimeout(() => go(homeFor()), 0); return ''; }"));
  assert.ok(!r.includes("empty('Your resident record is not linked yet'"));
});
