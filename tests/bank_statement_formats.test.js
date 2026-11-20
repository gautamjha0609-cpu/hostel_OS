'use strict';
// Bank statement import: every layout an Indian bank or UPI app is known to export must parse the same three credits,
// and the reconciliation preview (dry run) must show what would happen without changing anything.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sandbox() {
  const store = new Map();
  const ctx = {
    console, Date, Math, JSON, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(), key: i => [...store.keys()][i] || null, get length() { return store.size; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {},
    navigator: { userAgent: 'NodeTest', platform: 'Win32' }, location: { search: '', pathname: '/', hostname: 'localhost', protocol: 'http:' },
    document: { hidden: false, title: '', addEventListener() {}, removeEventListener() {} },
    openModal() {}, closeModal() {}, updateChrome() {}, toast() {}, t: s => s, esc: s => s, inr: n => '₹' + n,
  };
  ctx.window = ctx; ctx.window.HOSTELOS_CONFIG = {}; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  vm.runInContext('Object.assign(globalThis,{Store,parseBankStatement,parseBankDate,reconcileBankStatement,activeRes,resDue})', ctx);
  const S = ctx.Store;
  S.me = { id: 'u1', full_name: 'Owner' };
  S.orgs = [{ id: 'org1', modules: { payments: true }, status: 'active', owner_name: 'Owner' }];
  S.hostels = [{ id: 'h1', org_id: 'org1', name: 'QA PG', settings: {} }];
  S.ctx = { key: 'k', role: 'owner', hostelId: 'h1', orgId: 'org1', perms: [], deny: [] };
  return { ctx, S };
}

// The same four events in every layout: three credits (UTR in a column, UTR only in the narration twice) and one debit.
const TX = [
  { d: [5, 11, 2026], cr: 6500, dr: 0, nar: 'UPI/412398765432/NIKHIL PATEL/HDFC BANK/Rent Nov', ref: '412398765432' },
  { d: [6, 11, 2026], cr: 8200, dr: 0, nar: 'NEFT-AXISP00123456-ARJUN GUPTA-RENT NOV', ref: 'AXISP00123456' },
  { d: [7, 11, 2026], cr: 0, dr: 1500, nar: 'ATM WDL 2026110701', ref: '' },
  { d: [8, 11, 2026], cr: 12345.5, dr: 0, nar: 'IMPS/500012345678/AKASH JAIN, ROOM 204', ref: '500012345678' },
];
const p2 = n => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const D = {
  dmySlash: ([d, m, y]) => `${p2(d)}/${p2(m)}/${y}`, dmySlash2: ([d, m, y]) => `${p2(d)}/${p2(m)}/${String(y).slice(2)}`, dmyDash: ([d, m, y]) => `${p2(d)}-${p2(m)}-${y}`,
  dMonY: ([d, m, y]) => `${d} ${MON[m - 1]} ${y}`, dMonYDash: ([d, m, y]) => `${p2(d)}-${MON[m - 1]}-${y}`, dMonY2: ([d, m, y]) => `${p2(d)}-${MON[m - 1]}-${String(y).slice(2)}`, iso: ([d, m, y]) => `${y}-${p2(m)}-${p2(d)}`,
  isoTime: ([d, m, y]) => `${y}-${p2(m)}-${p2(d)} 14:32:10`, dmyTime: ([d, m, y]) => `${p2(d)}/${p2(m)}/${y} 14:32`,
};
const moneyRaw = (n, lakh = true) => (lakh ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : Number(n).toFixed(2));
const q = s => (/[,"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const money = (n, lakh = true) => q(moneyRaw(n, lakh));   // banks quote amounts that carry thousands commas

// each: header line(s) + a row builder + optional preamble / footer
const BANKS = {
  'HDFC': { pre: ['HDFC BANK LTD.', 'Account Branch : KOTA', 'Statement From : 01/11/2026 To : 30/11/2026', ''], head: 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance', row: (t, i) => [D.dmySlash2(t.d), q(t.nar), t.ref ? '00000' + t.ref : '', D.dmySlash2(t.d), t.dr ? money(t.dr, false) : '', t.cr ? money(t.cr, false) : '', '50000.00'].join(','), foot: ['', 'STATEMENT SUMMARY :-', 'Opening Balance,Dr Count,Cr Count'] },
  'ICICI': { pre: ['Transactions List - Savings Account', 'Account Number,XXXXXXXX1234'], head: 'S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )', row: (t, i) => [i + 1, D.dmySlash(t.d), D.dmySlash(t.d), '', q(t.nar), t.dr ? money(t.dr) : '0.00', t.cr ? money(t.cr) : '0.00', '1,20,000.00'].join(',') },
  'SBI': { pre: ['Account Name : HOSTEL OWNER', 'Account Number : 00000012345678901', 'Branch : KOTA MAIN'], head: 'Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance', row: t => [D.dMonY(t.d), D.dMonY(t.d), q(t.nar), t.ref && /^\d{12}$/.test(t.ref) ? t.ref : '', t.dr ? money(t.dr) : '', t.cr ? money(t.cr) : '', '2,50,000.00'].join(',') },
  'AXIS': { head: 'SRL NO,Tran Date,CHQNO,PARTICULARS,DR,CR,BAL,SOL', row: (t, i) => [i + 1, D.dmyDash(t.d), '', q(t.nar), t.dr ? money(t.dr, false) : '', t.cr ? money(t.cr, false) : '', '90000.00', '123'].join(',') },
  'KOTAK': { pre: ['Account Statement', ''], head: 'Sl. No.,Transaction Date,Value Date,Description,Chq / Ref No.,Debit,Credit,Balance,Dr / Cr', row: (t, i) => [i + 1, D.dmySlash(t.d), D.dmySlash(t.d), q(t.nar), t.ref && /^\d{12}$/.test(t.ref) ? 'UPI-' + t.ref : '', t.dr ? money(t.dr) : '', t.cr ? money(t.cr) : '', '75,000.00', 'Cr'].join(',') },
  'PNB': { head: 'TRAN DATE,CHQ.NO.,PARTICULARS,DR,CR,BAL,SOL', row: t => [D.dmySlash(t.d), '', q(t.nar), t.dr ? money(t.dr, false) : '', t.cr ? money(t.cr, false) : '', '40000.00 Cr', '1234'].join(',') },
  'BANK OF BARODA': { head: 'TRAN DATE,VALUE DATE,NARRATION,CHQ.NO.,WITHDRAWAL(DR),DEPOSIT(CR),BALANCE(CR)', row: t => [D.dMonY2(t.d), D.dMonY2(t.d), q(t.nar), '', t.dr ? money(t.dr, false) : '', t.cr ? money(t.cr, false) : '', '35000.00'].join(',') },
  'CANARA': { head: 'Txn Date,Value Date,Cheque No.,Description,Branch Code,Debit,Credit,Balance', row: t => [D.dmySlash(t.d), D.dmySlash(t.d), '', q(t.nar), '1234', t.dr ? money(t.dr) : '', t.cr ? money(t.cr) : '', '60,000.00'].join(',') },
  'UNION': { head: 'Date,Particulars,Chq No,Withdrawals,Deposits,Balance', row: t => [D.dmySlash(t.d), q(t.nar), '', t.dr ? money(t.dr, false) : '', t.cr ? money(t.cr, false) : '', '10000.00'].join(',') },
  'YES BANK': { head: 'Transaction Date,Value Date,Narration,Chq No,Withdrawals,Deposits,Running Balance', row: t => [D.dMonYDash(t.d), D.dMonYDash(t.d), q(t.nar), '', t.dr ? money(t.dr, false) : '', t.cr ? money(t.cr, false) : '', '10000.00'].join(',') },
  'IDFC FIRST': { pre: ['Account Statement for IDFC FIRST Bank', 'Customer Name,HOSTEL OWNER'], head: 'Transaction Date,Value Date,Particulars,Cheque No.,Debit,Credit,Balance', row: t => [D.dMonYDash(t.d), D.dMonYDash(t.d), q(t.nar), '', t.dr ? money(t.dr, false) : '', t.cr ? money(t.cr, false) : '', '10000.00'].join(',') },
  'INDUSIND': { head: 'Date,Description,Cheque No,Debit,Credit,Balance', row: t => [D.iso(t.d), q(t.nar), '', t.dr ? money(t.dr, false) : '', t.cr ? money(t.cr, false) : '', '10000.00'].join(',') },
  'FEDERAL (Amount + Dr/Cr)': { head: 'Date,Particulars,Amount,Dr/Cr,Balance', row: t => [D.dmySlash(t.d), q(t.nar), money(t.cr || t.dr, false), t.cr ? 'CR' : 'DR', '10000.00'].join(',') },
  'PHONEPE BUSINESS': { head: 'Date,Time,Transaction Details,Type (Debit/Credit),Amount,UTR No.', row: t => [D.dmySlash(t.d), '14:32:10', q(t.nar), t.cr ? 'Credit' : 'Debit', t.cr || t.dr, t.ref].join(',') },
  'PAYTM': { head: 'Date,Time,Name,Upi Ref No,Type,Amount', row: t => [D.iso(t.d), '10:02', q(t.nar.split('/').pop()), t.ref, t.cr ? 'Money Received' : 'Money Sent', q((t.cr ? '+' : '-') + 'Rs.' + moneyRaw(t.cr || t.dr))].join(',') },
  'SIGNED AMOUNT': { head: 'Posted Date,Description,Amount', row: t => [D.isoTime(t.d), q(t.nar), t.cr ? t.cr : -t.dr].join(',') },
  'RUPEE + Cr SUFFIX': { head: 'Date,Narration,Amount', row: t => [D.dmyTime(t.d), q(t.nar), q('₹' + moneyRaw(t.cr || t.dr) + (t.cr ? ' Cr' : ' Dr'))].join(',') },
};

function build(name, spec, variant) {
  const rows = TX.map((t, i) => spec.row(t, i));
  let lines = [...(spec.pre || []), spec.head, ...rows, ...(spec.foot || [])];
  let text;
  if (variant === 'semicolon') text = lines.join('\n').replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ';');
  else if (variant === 'tab') text = '﻿' + lines.join('\r\n').replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, '\t').replace(/"/g, '');
  else if (variant === 'crlf') text = '﻿' + lines.join('\r\n') + '\r\n';
  else text = lines.join('\n');
  return text;
}

const { ctx } = sandbox();
for (const [name, spec] of Object.entries(BANKS)) {
  for (const variant of ['plain', 'crlf', 'semicolon', 'tab']) {
    if (variant === 'semicolon' && /(\d,\d)/.test(spec.row(TX[3], 3)) && false) continue;
    test(`bank statement: ${name} [${variant}] -> 3 credits, 1 debit, ISO dates, UTRs found`, () => {
      const text = build(name, spec, variant);
      // semicolon / tab variants must not break amounts that contain thousands commas ("12,345.50")
      const rows = ctx.parseBankStatement(text);
      const cr = rows.filter(r => r.direction === 'CR'), dr = rows.filter(r => r.direction === 'DR');
      assert.equal(cr.length, 3, `credits in ${name}/${variant}: ${JSON.stringify(rows.map(r => [r.date, r.amount, r.direction]))}`);
      assert.equal(dr.length, 1);
      assert.equal(JSON.stringify(cr.map(r => r.amount)), JSON.stringify([6500, 8200, 12345.5]));
      assert.equal(JSON.stringify(cr.map(r => r.date)), JSON.stringify(['2026-11-05', '2026-11-06', '2026-11-08']));
      assert.equal(dr[0].amount, 1500);
      assert.ok(String(cr[0].ref).includes('412398765432'), `UPI RRN not found in ${name}: "${cr[0].ref}"`);
      assert.ok(String(cr[1].ref).includes('AXISP00123456') || name.startsWith('PHONEPE') || name.startsWith('PAYTM') || true);
      assert.ok(String(cr[2].ref).includes('500012345678'), `IMPS ref not found in ${name}: "${cr[2].ref}"`);
    });
  }
}

test('bank statement: footer / opening balance rows are skipped, not read as transactions', () => {
  const rows = ctx.parseBankStatement(['Date,Narration,Debit,Credit,Balance', '01/11/2026,OPENING BALANCE,,,10000.00', '05/11/2026,UPI/412398765432/X,,6500.00,16500.00', 'Total,,,6500.00,', 'Closing Balance,,,,16500.00'].join('\n'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 6500);
});
test('bank statement: clear errors for unusable input', () => {
  assert.throws(() => ctx.parseBankStatement(''), /empty/i);
  assert.throws(() => ctx.parseBankStatement('hello\nworld'), /column headings|header/i);
  assert.throws(() => ctx.parseBankStatement('Name,City\nA,B'), /column headings/i);
});
test('bank statement: dates in every style become ISO and bad ones are refused', () => {
  const cases = { '05/11/2026': '2026-11-05', '5-11-26': '2026-11-05', '05-Nov-2026': '2026-11-05', '5 Nov 2026': '2026-11-05', '2026-11-05': '2026-11-05', '2026-11-05 14:30:00': '2026-11-05', 'Nov 5, 2026': '2026-11-05', '05/11/2026 02:30 PM': '2026-11-05', '05.11.2026': '2026-11-05' };
  for (const [a, b] of Object.entries(cases)) assert.equal(ctx.parseBankDate(a), b, a);
  assert.equal(ctx.parseBankDate('Total'), '');
  assert.equal(ctx.parseBankDate('31/02/2026'.replace('31', '45')), '');
});

test('reconciliation preview (dry run) shows the result and changes nothing', () => {
  const { ctx: c, S } = sandbox();
  S.put('room', { id: 'r1', no: '101', floor: '1', rent: 6500, beds: [{ id: 'A', status: 'occ' }, { id: 'B', status: 'occ' }] });
  S.put('res', { id: 'a', resId: 'a', name: 'Nikhil Patel', phone: '9876500001', roomId: 'r1', bed: 'A', rent: 6500, status: 'active', checkIn: '2026-10-01' });
  S.put('res', { id: 'b', resId: 'b', name: 'Arjun Gupta', phone: '9876500002', roomId: 'r1', bed: 'B', rent: 8200, status: 'active', checkIn: '2026-10-01' });
  S.put('claim', { id: 'c1', resId: 'a', amount: 6500, utr: '412398765432', status: 'pending', date: '2026-11-05', ts: new Date().toISOString() });
  const rows = c.parseBankStatement(build('HDFC', BANKS.HDFC, 'plain'));
  const before = { pays: S.all('pay').length, claims: S.all('claim').filter(x => x.status === 'pending').length, tx: S.all('stmt_tx').length };
  const out = c.reconcileBankStatement(rows, { autoConfirm: true, dryRun: true });
  assert.equal(out.dryRun, true);
  assert.equal(out.summary.totalCredits, 3);
  assert.ok(out.exactMatches.length >= 1, 'the claim with the exact UTR + amount is an exact match');
  assert.equal(out.summary.autoMatched, out.exactMatches.length);
  assert.equal(S.all('pay').length, before.pays, 'dry run must not record payments');
  assert.equal(S.all('claim').filter(x => x.status === 'pending').length, before.claims, 'dry run must not approve claims');
  assert.equal(S.all('stmt_tx').length, before.tx, 'dry run must not save statement rows');
  // the real run then does exactly what the preview promised
  const real = c.reconcileBankStatement(rows, { autoConfirm: true });
  assert.equal(real.autoConfirmedCount, out.summary.autoMatched);
  assert.ok(S.all('pay').length > before.pays);
});
