// UPI pay page logic (pay.html). A file, not inline, because the CSP refuses inline script.
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var pa = q.get('pa') || '', pn = q.get('pn') || '', am = parseFloat(q.get('am') || '0'), tn = q.get('tn') || '', h = q.get('h') || pn;
  var hi = (navigator.language || '').toLowerCase().indexOf('hi') === 0;
  var T = hi ? { pay: 'भुगतान करें', open: 'UPI ऐप से भुगतान करें', scan: 'या दूसरे फ़ोन से QR स्कैन करें', after: 'भुगतान के बाद Sarvlekh ऐप में "मैंने भुगतान कर दिया" दबाकर UTR डालें।', bad: 'यह लिंक अधूरा है। कृपया मालिक से नया लिंक माँगें।', copy: 'UPI ID कॉपी करें', copied: 'कॉपी हो गया' }
    : { pay: 'Pay', open: 'Pay with any UPI app', scan: 'Or scan this QR from another phone', after: 'After paying, open the Sarvlekh app, tap "I have paid" and enter the UTR.', bad: 'This payment link is incomplete. Please ask the owner for a new one.', copy: 'Copy UPI ID', copied: 'Copied' };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var box = document.getElementById('box');
  if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(pa) || !(am > 0)) { box.innerHTML = '<div class="card"><div class="empty"><b>⚠️</b>' + esc(T.bad) + '</div></div>'; return; }
  var uri = 'upi://pay?pa=' + encodeURIComponent(pa) + '&pn=' + encodeURIComponent(pn) + '&am=' + am.toFixed(2) + '&cu=INR&tn=' + encodeURIComponent(tn);
  var qr = '';
  try { var c = qrcode(0, 'M'); c.addData(uri); c.make(); qr = c.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) { qr = ''; }
  box.innerHTML =
    '<img class="logo" src="icons/icon.svg" alt="" width="104" height="88">' +
    '<h1>' + esc(h) + '</h1><p class="sub">' + esc(tn) + '</p>' +
    '<div class="hero" style="text-align:center"><div class="muted">' + esc(T.pay) + '</div><div class="big">₹' + am.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + '</div><div class="muted sm">' + esc(pn) + ' · ' + esc(pa) + '</div>' +
    '<a class="btn primary block" style="margin-top:16px" href="' + esc(uri) + '">' + esc(T.open) + '</a></div>' +
    (qr ? '<p class="hint" style="text-align:center;margin:18px 0 10px">' + esc(T.scan) + '</p><div class="qr">' + qr + '</div>' : '') +
    '<div class="row" style="justify-content:center;margin-top:14px"><button class="btn sm" id="cp">' + esc(T.copy) + '</button></div>' +
    '<p class="hint" style="text-align:center;margin-top:16px">' + esc(T.after) + '</p>';
  document.getElementById('cp').onclick = function () {
    var b = this; (navigator.clipboard ? navigator.clipboard.writeText(pa) : Promise.reject()).then(function () { b.textContent = T.copied; }).catch(function () { prompt('UPI ID', pa); });
  };
})();
