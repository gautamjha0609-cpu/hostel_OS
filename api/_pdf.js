'use strict';
// A small PDF writer (no dependencies) and the resident checkout report built on it.
// It draws with the built-in Helvetica fonts, so text is limited to Latin letters; the rupee sign
// is written "Rs." and any other character becomes "?". Files starting with "_" are not routed by Vercel.

const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const clean = s => String(s == null ? '' : s).replace(/₹/g, 'Rs. ').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, '...').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const hex = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => (v / 255).toFixed(3)).join(' '); };
const esc = s => s.replace(/[\\()]/g, '\\$&').replace(/[\x80-\xff]/g, c => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0'));

class Pdf {
  constructor(title = '') { this.title = clean(title); this.W = 595.28; this.H = 841.89; this.pages = []; this.cur = null; this.onPage = null; this.addPage(); }
  addPage() { this.cur = { ops: [] }; this.pages.push(this.cur); this.y = 0; if (this.onPage) this.onPage(this); return this.cur; }
  op(s) { this.cur.ops.push(s); }
  width(str, size, bold) { let w = 0; for (const ch of clean(str)) { const c = ch.charCodeAt(0); w += (c >= 32 && c <= 126 ? HW[c - 32] : 556); } return w * size / 1000 * (bold ? 1.06 : 1); }
  fit(str, maxW, size, bold) { str = clean(str); if (this.width(str, size, bold) <= maxW) return str; while (str.length > 1 && this.width(str + '...', size, bold) > maxW) str = str.slice(0, -1); return str + '...'; }
  wrap(str, maxW, size, bold) {
    const out = []; let line = '';
    for (const word of clean(str).split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (this.width(t, size, bold) <= maxW || !line) line = t; else { out.push(line); line = word; }
    }
    if (line) out.push(line); return out.length ? out : [''];
  }
  rect(x, y, w, h, fill, r = 0, stroke) {
    const Y = this.H - y - h; let d;
    if (r > 0) { r = Math.min(r, w / 2, h / 2); const k = r * .5523; d = `${x + r} ${Y} m ${x + w - r} ${Y} l ${x + w - r + k} ${Y} ${x + w} ${Y + r - k} ${x + w} ${Y + r} c ${x + w} ${Y + h - r} l ${x + w} ${Y + h - r + k} ${x + w - r + k} ${Y + h} ${x + w - r} ${Y + h} c ${x + r} ${Y + h} l ${x + r - k} ${Y + h} ${x} ${Y + h - r + k} ${x} ${Y + h - r} c ${x} ${Y + r} l ${x} ${Y + r - k} ${x + r - k} ${Y} ${x + r} ${Y} c`; }
    else d = `${x} ${Y} ${w} ${h} re`;
    this.op(`q ${fill ? hex(fill) + ' rg ' : ''}${stroke ? hex(stroke) + ' RG 0.6 w ' : ''}${d} ${fill && stroke ? 'B' : fill ? 'f' : 'S'} Q`);
  }
  line(x1, y1, x2, y2, color = '#e5e7f0', w = .6) { this.op(`q ${hex(color)} RG ${w} w ${x1} ${this.H - y1} m ${x2} ${this.H - y2} l S Q`); }
  text(str, x, y, { size = 10, bold = false, color = '#0f172a', align = 'left', w = 0 } = {}) {
    str = clean(str); const tw = this.width(str, size, bold);
    const X = align === 'right' ? x + w - tw : align === 'center' ? x + (w - tw) / 2 : x;
    this.op(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${hex(color)} rg ${X.toFixed(2)} ${(this.H - y - size * .8).toFixed(2)} Td (${esc(str)}) Tj ET`);
    return tw;
  }
  build() {
    const total = this.pages.length, objs = [];
    const add = s => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>'); add(''); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    this.pages.forEach((pg, i) => {
      if (this.footer) { this.cur = pg; this.footer(this, i + 1, total); }
      const body = pg.ops.join('\n'), cid = add(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`));
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${total} >>`;
    const info = add(`<< /Title (${esc(this.title)}) /Producer (Sarvlekh) /Creator (Sarvlekh) >>`);
    let out = '%PDF-1.4\n', offs = [];
    objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, 'latin1');
  }
}

const money = n => 'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Math.round((+n || 0) * 100) / 100);

// d = { hostel:{name,address,phone}, generatedOn, resident:{...}, settlement:{rows:[[label,amount,tone]], refund, balancePayable, status}, invoices:[], payments:[], docs:[], pv:{}, totals:{} }
function checkoutReport(d) {
  const r = d.resident || {}, s = d.settlement || {}, h = d.hostel || {}, M = 40, CW = 595.28 - M * 2;
  const doc = new Pdf(`Checkout report - ${r.name || ''}`);
  const NAVY = '#1e1b4b', BRAND = '#4338ca', INK = '#0f172a', MUTED = '#64748b', LINE = '#e5e7f0', SOFT = '#f5f6fd';
  doc.onPage = p => { p.rect(0, 0, p.W, 64, NAVY); p.rect(0, 64, p.W, 3, BRAND); p.text('SARVLEKH', M, 22, { size: 9, bold: true, color: '#a5b4fc' }); p.text(h.name || 'Hostel', M, 36, { size: 16, bold: true, color: '#ffffff' }); p.text('Resident exit report', M, 22, { size: 9, color: '#c7d2fe', align: 'right', w: CW }); p.text(d.generatedOn || '', M, 36, { size: 9.5, color: '#c7d2fe', align: 'right', w: CW }); p.y = 86; };
  doc.footer = (p, n, total) => { p.line(M, 806, 595.28 - M, 806); p.text('Confidential. Contains personal details of the resident - keep it safe.', M, 814, { size: 7.5, color: MUTED }); p.text(`Page ${n} of ${total}`, M, 814, { size: 7.5, color: MUTED, align: 'right', w: CW }); };
  doc.onPage(doc);
  const need = h2 => { if (doc.y + h2 > 790) doc.addPage(); };
  const section = title => { need(60); doc.text(title.toUpperCase(), M, doc.y, { size: 8.5, bold: true, color: BRAND }); doc.line(M, doc.y + 15, M + CW, doc.y + 15, LINE); doc.y += 24; };

  // hero
  doc.rect(M, doc.y, CW, 78, SOFT, 12, LINE);
  doc.text(r.name || 'Resident', M + 18, doc.y + 14, { size: 20, bold: true });
  doc.text([r.room ? `Room ${r.room}` : '', r.bed ? `Bed ${r.bed}` : '', r.phone].filter(Boolean).join('   |   '), M + 18, doc.y + 42, { size: 10, color: MUTED });
  doc.text(`${r.checkIn || '-'}  to  ${r.left || '-'}`, M + 18, doc.y + 57, { size: 10, bold: true, color: BRAND });
  doc.rect(M + CW - 112, doc.y + 16, 94, 22, '#dcfce7', 11); doc.text('CHECKED OUT', M + CW - 112, doc.y + 23, { size: 8.5, bold: true, color: '#15803d', align: 'center', w: 94 });
  doc.y += 98;

  // two columns of facts
  section('Resident details');
  const facts = [['Full name', r.name], ['Mobile', r.phone], ['E-mail', r.email], ['Guardian', [r.guardian, r.guardianPhone].filter(Boolean).join(' - ')], ['College / workplace', r.college], ['ID', r.idMasked], ['Permanent address', r.address], ['Monthly rent', r.rent != null ? money(r.rent) : ''], ['Police verification', d.pv && d.pv.status ? [d.pv.status, d.pv.refNo ? 'Ref ' + d.pv.refNo : ''].filter(Boolean).join(' - ') : 'Not recorded']].filter(x => x[1]);
  const colW = CW / 2 - 8;
  for (let i = 0; i < facts.length; i += 2) {
    const pair = facts.slice(i, i + 2), lines = pair.map(f => doc.wrap(f[1], colW, 10, true)), hh = 14 + Math.max(...lines.map(l => l.length)) * 13 + 6;
    need(hh);
    pair.forEach((f, j) => { const x = M + j * (colW + 16); doc.text(f[0], x, doc.y, { size: 8, color: MUTED }); lines[j].forEach((ln, k) => doc.text(ln, x, doc.y + 12 + k * 13, { size: 10, bold: true })); });
    doc.y += hh;
  }
  doc.y += 6;

  // settlement
  section('Final settlement');
  const sr = s.rows || []; need(sr.length * 22 + 70);
  const top = doc.y; doc.rect(M, top, CW, sr.length * 22 + 8, '#ffffff', 10, LINE);
  sr.forEach((row, i) => { const y = top + 8 + i * 22; doc.text(row[0], M + 16, y, { size: 10, color: MUTED }); doc.text(money(row[1]), M + 16, y, { size: 10, bold: true, color: row[2] === 'bad' ? '#b91c1c' : row[2] === 'ok' ? '#15803d' : INK, align: 'right', w: CW - 32 }); if (i < sr.length - 1) doc.line(M + 16, y + 17, M + CW - 16, y + 17); });
  doc.y = top + sr.length * 22 + 18;
  const owes = +s.balancePayable > 0, ref = +s.refund > 0;
  doc.rect(M, doc.y, CW, 44, owes ? '#fef2f2' : '#f0fdf4', 10, owes ? '#fecaca' : '#bbf7d0');
  doc.text(owes ? 'Balance still to collect' : ref ? (s.status === 'paid' ? 'Deposit refunded' : 'Deposit refund due') : 'Fully settled', M + 16, doc.y + 15, { size: 11, bold: true, color: owes ? '#b91c1c' : '#15803d' });
  doc.text(money(owes ? s.balancePayable : s.refund || 0), M + 16, doc.y + 12, { size: 17, bold: true, color: owes ? '#b91c1c' : '#15803d', align: 'right', w: CW - 32 });
  doc.y += 62;

  // tables
  const table = (title, cols, data, emptyText) => {
    section(title);
    if (!data.length) { doc.text(emptyText, M, doc.y, { size: 9.5, color: MUTED }); doc.y += 22; return; }
    const widths = cols.map(c => c.w * CW), head = () => { doc.rect(M, doc.y - 3, CW, 20, SOFT, 6); let x = M + 8; cols.forEach((c, i) => { doc.text(c.l, x, doc.y + 2, { size: 8, bold: true, color: MUTED, align: c.right ? 'right' : 'left', w: widths[i] - 16 }); x += widths[i]; }); doc.y += 22; };
    head();
    data.forEach(row => {
      if (doc.y > 780) { doc.addPage(); head(); }
      let x = M + 8; cols.forEach((c, i) => { const v = c.f ? c.f(row) : row[c.k]; doc.text(doc.fit(v == null ? '' : v, widths[i] - 16, 9, c.bold), x, doc.y, { size: 9, bold: !!c.bold, color: c.color ? c.color(row) : INK, align: c.right ? 'right' : 'left', w: widths[i] - 16 }); x += widths[i]; });
      doc.line(M, doc.y + 14, M + CW, doc.y + 14); doc.y += 20;
    });
    doc.y += 10;
  };
  const t = d.totals || {};
  table('Bills & charges', [{ l: 'Date', k: 'date', w: .14 }, { l: 'Description', k: 'title', w: .4 }, { l: 'Amount', f: x => money(x.amount), right: true, w: .16 }, { l: 'Paid', f: x => money(x.paid), right: true, w: .15 }, { l: 'Balance', f: x => money(x.balance), right: true, bold: true, w: .15, color: x => x.balance > 0 ? '#b91c1c' : INK }], d.invoices || [], 'No bills on record.');
  table('Payments received', [{ l: 'Date', k: 'date', w: .14 }, { l: 'Receipt', k: 'no', w: .17 }, { l: 'Mode', f: x => String(x.mode || '').toUpperCase(), w: .13 }, { l: 'Reference', k: 'ref', w: .34 }, { l: 'Amount', f: x => money(x.amount), right: true, bold: true, w: .22 }], d.payments || [], 'No payments on record.');
  need(60); section('Totals');
  [['Billed in total', t.billed], ['Paid in total', t.paid], ['Waived', t.waived], ['Left unpaid', t.due]].forEach(([k, v]) => { doc.text(k, M, doc.y, { size: 10, color: MUTED }); doc.text(money(v), M, doc.y, { size: 10, bold: true, align: 'right', w: CW }); doc.y += 18; });
  doc.y += 8;
  section('Papers on file');
  const docs = d.docs || [];
  if (docs.length) docs.forEach(x => { need(18); doc.text('-  ' + x, M, doc.y, { size: 10 }); doc.y += 16; }); else doc.text('No papers were uploaded.', M, doc.y, { size: 9.5, color: MUTED });
  doc.y += 14;
  if (d.keepDays) { need(40); doc.rect(M, doc.y, CW, 36, '#fffbeb', 8, '#fde68a'); doc.text(`Privacy: the resident's personal details and uploaded papers are removed from Sarvlekh ${d.keepDays} days after checkout. Keep this report.`, M + 12, doc.y + 12, { size: 8.5, color: '#92400e' }); doc.y += 44; }
  return doc.build();
}

module.exports = { Pdf, checkoutReport, money };
