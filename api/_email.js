'use strict';
// Premium e-mail layout for everything Sarvlekh sends. One place, so every mail has the same
// branding. Table layout + inline styles because mail apps (Gmail, Outlook, Apple Mail) ignore
// most modern CSS. No dependencies. Files starting with "_" are not routed by Vercel.

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const appUrl = () => String(process.env.APP_URL || 'https://vasvanta.sarvlekh.in').replace(/\/$/, '');
const inr = n => 'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Math.round((+n || 0) * 100) / 100);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = '#0f172a', MUTED = '#64748b', LINE = '#e5e7f0', BRAND = '#4338ca';

const p = (html, o = {}) => `<tr><td style="padding:0 32px 14px;font-family:${FONT};font-size:15px;line-height:1.65;color:${o.color || '#334155'}">${html}</td></tr>`;
const button = (label, url) => `<tr><td align="center" style="padding:10px 32px 22px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${BRAND}" style="border-radius:12px;background:linear-gradient(135deg,#4338ca,#6d28d9)"><a href="${esc(url)}" style="display:inline-block;padding:14px 34px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:.01em">${esc(label)} &rarr;</a></td></tr></table></td></tr>`;
// a big number card: tone = 'warn' | 'ok' | 'info'
const stat = (label, value, note, tone = 'info') => {
  const c = { warn: ['#fff7ed', '#fed7aa', '#c2410c'], ok: ['#f0fdf4', '#bbf7d0', '#15803d'], info: ['#eef2ff', '#c7d2fe', BRAND], bad: ['#fef2f2', '#fecaca', '#b91c1c'] }[tone] || [];
  return `<tr><td style="padding:0 32px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="${c[0]}" style="background:${c[0]};border:1px solid ${c[1]};border-radius:16px;padding:20px 16px;font-family:${FONT}">
    <div style="font-size:11.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${c[2]}">${esc(label)}</div>
    <div style="font-size:34px;font-weight:800;letter-spacing:-.02em;color:${c[2]};margin:6px 0 2px">${esc(value)}</div>
    ${note ? `<div style="font-size:12.5px;color:${MUTED}">${esc(note)}</div>` : ''}</td></tr></table></td></tr>`;
};
// label / value rows in a soft panel
const rows = (title, list) => list.length ? `<tr><td style="padding:0 32px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:14px;background:#fafbff">
    ${title ? `<tr><td colspan="2" style="padding:12px 16px 4px;font-family:${FONT};font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${esc(title)}</td></tr>` : ''}
    ${list.map((r, i) => `<tr><td style="padding:9px 16px;font-family:${FONT};font-size:14px;color:${MUTED};${i < list.length - 1 ? `border-bottom:1px solid ${LINE};` : ''}">${esc(r[0])}</td><td align="right" style="padding:9px 16px;font-family:${FONT};font-size:14px;font-weight:${r[2] ? 800 : 650};color:${r[2] || INK};${i < list.length - 1 ? `border-bottom:1px solid ${LINE};` : ''}">${esc(r[1])}</td></tr>`).join('')}
  </table></td></tr>` : '';
const mono = text => `<tr><td style="padding:0 32px 18px"><div style="border:1px solid ${LINE};border-radius:14px;background:#fafbff;padding:14px 16px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.7;color:${INK}">${esc(text).replace(/\n/g, '<br>')}</div></td></tr>`;

function shell({ preheader = '', kicker = '', title = '', hostel = 'Hostel', date = '', body = '', footnote = '' }) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#eef0f7;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef0f7" style="background:#eef0f7"><tr><td align="center" style="padding:26px 12px">
 <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
  <tr><td style="padding:0 6px 14px;font-family:${FONT}"><table role="presentation" width="100%"><tr>
    <td style="font-size:15px;font-weight:800;letter-spacing:.14em;color:${INK}"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${BRAND};margin-right:8px"></span>SARVLEKH</td>
    <td align="right" style="font-size:12px;color:${MUTED}">${esc(date)}</td></tr></table></td></tr>
  <tr><td style="border-radius:22px;overflow:hidden;background:#ffffff;box-shadow:0 10px 34px rgba(30,27,75,.10)"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:22px;overflow:hidden">
    <tr><td bgcolor="#1e1b4b" style="background:#1e1b4b;background-image:linear-gradient(135deg,#1e1b4b 0%,#3730a3 55%,#6d28d9 100%);padding:34px 32px 30px;font-family:${FONT}">
      ${kicker ? `<div style="display:inline-block;padding:5px 13px;border-radius:99px;background:rgba(255,255,255,.16);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#e0e7ff">${esc(kicker)}</div>` : ''}
      <div style="font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-.02em;color:#ffffff;margin-top:14px">${esc(title)}</div>
      <div style="font-size:14px;color:#c7d2fe;margin-top:8px">${esc(hostel)}</div></td></tr>
    <tr><td style="height:24px;line-height:24px;font-size:0">&nbsp;</td></tr>
    ${body}
    ${footnote ? `<tr><td style="padding:6px 32px 26px;font-family:${FONT};font-size:12.5px;line-height:1.6;color:${MUTED};border-top:1px solid ${LINE}"><div style="padding-top:16px">${esc(footnote)}</div></td></tr>` : '<tr><td style="height:10px;font-size:0">&nbsp;</td></tr>'}
  </table></td></tr>
  <tr><td align="center" style="padding:20px 10px 4px;font-family:${FONT};font-size:12px;line-height:1.7;color:${MUTED}">
    <b style="color:#475569">${esc(hostel)}</b> &middot; sent through Sarvlekh Hostel Management<br>
    <a href="${esc(appUrl())}" style="color:${BRAND};text-decoration:none">${esc(appUrl().replace(/^https?:\/\//, ''))}</a> &middot; &copy; ${year}</td></tr>
 </table></td></tr></table></body></html>`;
}

// The notice / bill / agreement mail. Same arguments the app has always passed.
function brandMail(a = {}) {
  const hostel = a.hostelName || 'Hostel', amt = +a.amountDue || 0;
  const body = [
    p(`<b style="color:${INK};font-size:17px">Hello ${esc(a.recipientName || 'Resident')},</b>`),
    p(esc(a.intro || `Here are your latest notice and stay details for ${hostel}.`)),
    amt > 0 ? stat('Total pending', inr(amt), 'Please clear it before the due date to avoid a late fee.', 'warn') : '',
    a.bodyLines ? mono(a.bodyLines) : '',
    a.payLink ? button('Pay online / UPI', a.payLink) : '',
    p(`<span style="font-size:13px;color:${MUTED}">Already paid? Add your payment reference in the Sarvlekh resident app, or tell the hostel office.</span>`),
  ].join('');
  return shell({ preheader: a.intro || a.headline || a.title || '', kicker: a.title || 'Notice', title: a.headline || a.title || 'Notice', hostel, date: a.date || '', body });
}

// What the owner receives after a resident leaves. The PDF carries the detail; this is the cover note.
function checkoutMail(d) {
  const r = d.resident || {}, s = d.settlement || {}, t = d.totals || {};
  const owes = +s.balancePayable > 0, refund = +s.refund > 0;
  const body = [
    p(`<b style="color:${INK};font-size:17px">Hello,</b>`),
    p(`<b>${esc(r.name || 'The resident')}</b> has checked out of <b>${esc(d.hostel && d.hostel.name || 'your hostel')}</b>${r.left ? ` on ${esc(r.left)}` : ''}. Their complete record is attached as a PDF: details, every bill and payment, the deposit settlement and the papers on file.`),
    owes ? stat('Balance still to collect', inr(s.balancePayable), 'Left unpaid at checkout', 'bad')
      : refund ? stat('Deposit refund', inr(s.refund), s.status === 'paid' ? 'Paid back to the resident' : 'To be paid back to the resident', 'ok')
      : stat('Fully settled', inr(0), 'Nothing to pay either way', 'ok'),
    rows('Stay at a glance', [
      ['Resident', r.name || ''], ['Room', [r.room, r.bed].filter(Boolean).join(' / ')],
      ['Stayed', [r.checkIn, r.left].filter(Boolean).join('  to  ')],
      ['Billed in total', inr(t.billed)], ['Paid in total', inr(t.paid)],
    ].filter(x => x[1])),
    p(`<span style="font-size:13px;color:${MUTED}"><b>Please keep the attached PDF.</b> To protect the resident's privacy, Sarvlekh removes their personal details and papers from the system ${d.keepDays || 60} days after checkout. Your accounts (bills and payment amounts) stay.</span>`),
  ].join('');
  return shell({ preheader: `${r.name || 'Resident'} checked out - full report attached`, kicker: 'Checkout report', title: `${r.name || 'Resident'} has checked out`, hostel: (d.hostel && d.hostel.name) || 'Hostel', date: d.generatedOn || '', body, footnote: 'This report was generated automatically when the checkout was saved.' });
}

module.exports = { shell, brandMail, checkoutMail, esc, inr, p, stat, rows, mono, button };
