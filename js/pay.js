// Cashfree Production UPI Pay Portal (pay.html)
// Pure vanilla JavaScript, adheres to CSP (no inline script).
(function () {
  'use strict';

  var q = new URLSearchParams(location.search);
  var orderIdParam = q.get('order_id') || '';
  var invIdParam = q.get('inv_id') || '';
  var hostelIdParam = q.get('hostel_id') || '';
  var resIdParam = q.get('res_id') || '';
  var rawPa = q.get('pa') || '', rawPn = q.get('pn') || '', rawAm = parseFloat(q.get('am') || '0'), rawTn = q.get('tn') || '', rawH = q.get('h') || rawPn;

  var hi = (navigator.language || '').toLowerCase().indexOf('hi') === 0;
  var T = hi ? {
    pay: 'भुगतान करें',
    payWithCf: 'Cashfree UPI से सुरक्षित भुगतान करें',
    openApp: 'UPI ऐप चुनें',
    scanQr: 'या किसी भी UPI ऐप से यह QR कोड स्कैन करें',
    verified: 'भुगतान सफलतापूर्वक सत्यापित हो गया!',
    verifying: 'गेटवे से भुगतान की पुष्टि हो रही है...',
    wait: 'कृपया प्रतीक्षा करें, यह स्क्रीन बंद न करें',
    failed: 'भुगतान असफल रहा या रद्द कर दिया गया',
    retry: 'पुनः प्रयास करें',
    downloadReceipt: 'रसीद डाउनलोड करें (PDF/Print)',
    txnRef: 'लेनदेन संदर्भ (Cashfree ID)',
    utrRef: 'बैंक UTR / RRN',
    amtPaid: 'भुगतान की गई राशि',
    date: 'दिनांक',
    copyUpi: 'UPI ID कॉपी करें',
    copied: 'कॉपी हो गया',
    manualHint: 'यदि ऐप न खुले तो नीचे दी गई UPI ID पर भेजें और UTR दर्ज करें।',
    loading: 'भुगतान विवरण लोड हो रहा है...',
    alreadyPaid: 'यह बिल पहले ही पूरा चुकाया जा चुका है!'
  } : {
    pay: 'Pay',
    payWithCf: 'Pay Securely via Cashfree UPI',
    openApp: 'Select UPI Application',
    scanQr: 'Or scan this QR with any UPI app',
    verified: 'Payment Verified Successfully!',
    verifying: 'Verifying payment with Cashfree...',
    wait: 'Please wait, do not close or refresh this page',
    failed: 'Payment was not completed or was cancelled',
    retry: 'Try Again',
    downloadReceipt: 'Download / Print Receipt',
    txnRef: 'Transaction ID (Cashfree)',
    utrRef: 'Bank Reference (UTR)',
    amtPaid: 'Amount Paid',
    date: 'Date',
    copyUpi: 'Copy UPI ID',
    copied: 'Copied',
    manualHint: 'If UPI app does not open, pay to UPI ID below and enter UTR.',
    loading: 'Loading payment details...',
    alreadyPaid: 'This invoice has already been paid in full!'
  };

  var esc = function (s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var inr = function (n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  var box = document.getElementById('box');
  if (!box) return;

  var state = {
    info: null,
    orderId: orderIdParam,
    sessionId: null,
    amount: rawAm,
    status: 'INITIAL', // 'INITIAL', 'LOADING', 'CHECKOUT', 'POLLING', 'SUCCESS', 'FAILED'
    pollTimer: null,
    pollCount: 0,
    paymentResult: null
  };

  function renderQrSvg(text) {
    if (typeof qrcode === 'undefined') return '';
    try {
      var c = qrcode(0, 'M');
      c.addData(text);
      c.make();
      return c.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch (_) {
      return '';
    }
  }

  // Fetch authoritative info if inv_id or order_id given
  async function fetchPayInfo() {
    if (!orderIdParam && !invIdParam && !hostelIdParam) {
      // Fallback to URL query params
      state.info = {
        hostel: { name: rawH || 'Hostel / PG' },
        resident: { name: rawPn || 'Resident' },
        invoice: { title: rawTn || 'Rent Payment', balance: rawAm, total: rawAm },
        settlement: { payee_name: rawPn, upi_id: rawPa }
      };
      state.amount = rawAm;
      render();
      return;
    }

    box.innerHTML = '<div class="card" style="text-align:center;padding:32px 16px"><div class="spin"></div><p style="margin-top:12px" class="muted">' + esc(T.loading) + '</p></div>';

    try {
      var url = '/api/public?sub=pay_info&' + new URLSearchParams({
        order_id: orderIdParam,
        inv_id: invIdParam,
        hostel_id: hostelIdParam,
        res_id: resIdParam
      }).toString();

      var r = await fetch(url);
      var j = await r.json();
      if (j && j.ok) {
        state.info = j;
        state.amount = j.order ? j.order.amount : (j.invoice?.balance || rawAm);
        if (j.order && j.order.status === 'SUCCESS') {
          state.status = 'SUCCESS';
          state.paymentResult = j.transaction || {
            payment_id: j.order.payment_id || j.order.id,
            amount: j.order.amount,
            utr: j.order.utr,
            receipt_no: j.transaction?.receipt_no
          };
          render();
          return;
        } else if (orderIdParam) {
          // Returning from Cashfree checkout or tracking an existing order: verify authoritatively
          state.status = 'LOADING';
          render();
          verifyPaymentNow();
          return;
        }
      }
    } catch (err) {
      console.warn('Could not load pay info:', err);
    }
    render();
  }

  // Authoritatively verifies payment with Cashfree upon customer return
  async function verifyPaymentNow() {
    try {
      var r = await fetch('/api/public?sub=verify_payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: state.orderId || orderIdParam })
      });
      var j = await r.json().catch(function () { return {}; });
      if (j && j.verified && j.status === 'SUCCESS') {
        state.status = 'SUCCESS';
        state.paymentResult = j;
        render();
        return;
      }
    } catch (_) {}
    state.status = 'CHECKOUT';
    render();
    startPollingVerification();
  }

  // Initiates Cashfree order
  async function initiateCashfreeOrder() {
    state.status = 'LOADING';
    render();

    var payload = {
      hostel_id: state.info?.hostel?.id || hostelIdParam,
      res_id: state.info?.resident?.id || resIdParam || 'resident',
      inv_id: state.info?.invoice?.id || invIdParam || undefined,
      amount: state.amount,
      return_url: location.href
    };

    try {
      var r = await fetch('/api/public?sub=create_payment_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var j = await r.json();
      if (j && j.ok && j.order_id) {
        state.orderId = j.order_id;
        state.sessionId = j.payment_session_id;

        // Request official UPI session intent & QR payload
        var sRes = await fetch('/api/public?sub=pay_session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_session_id: state.sessionId, channel: 'intent' })
        }).catch(function () { return null; });

        var sData = sRes ? await sRes.json().catch(function () { return null; }) : null;
        state.sessionData = sData?.data?.data?.payload || null;
        state.status = 'CHECKOUT';
        startPollingVerification();
      } else {
        alert(j.error || 'Failed to initialize Cashfree order');
        state.status = 'INITIAL';
      }
    } catch (err) {
      alert('Network error while connecting to payment gateway');
      state.status = 'INITIAL';
    }
    render();
  }

  // Authoritative server-side verification polling with exponential backoff & hard limits
  var BACKOFF_DELAYS = [3000, 4000, 6000, 9000, 14000, 20000, 30000]; // 7 attempts over ~86s
  var lastCheckTime = 0;

  function stopPollingVerification() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function startPollingVerification() {
    stopPollingVerification();
    state.pollCount = 0;
    state.pollingStopped = false;
    scheduleNextPoll();
  }

  function scheduleNextPoll() {
    if (state.status !== 'CHECKOUT' && state.status !== 'LOADING') return;
    if (state.pollCount >= BACKOFF_DELAYS.length) {
      // Reached hard polling limit - stop automatic requests to prevent continuous server load
      state.pollingStopped = true;
      render();
      return;
    }
    var delay = BACKOFF_DELAYS[state.pollCount];
    state.pollTimer = setTimeout(async function () {
      if (document.visibilityState === 'hidden') {
        // Tab is hidden (e.g. resident inside UPI app). Pause poll to avoid wasting API calls.
        // Will check immediately on visibilitychange when user returns to browser.
        scheduleNextPoll();
        return;
      }
      state.pollCount++;
      await checkStatusOnce();
      scheduleNextPoll();
    }, delay);
  }

  async function checkStatusOnce(force) {
    var now = Date.now();
    if (!force && now - lastCheckTime < 2500) return false; // Enforce minimum 2.5s cooldown to prevent API hammering
    if (force && now - lastCheckTime < 2500) {
      await new Promise(function (r) { setTimeout(r, 2500 - (now - lastCheckTime)); });
    }
    lastCheckTime = Date.now();

    if (!state.orderId || (state.status !== 'CHECKOUT' && state.status !== 'LOADING')) return false;
    try {
      var r = await fetch('/api/public?sub=verify_payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: state.orderId })
      });
      var j = await r.json().catch(function () { return {}; });
      if (j && j.verified && j.status === 'SUCCESS') {
        stopPollingVerification();
        state.status = 'SUCCESS';
        state.paymentResult = j;
        render();
        return true;
      }
    } catch (_) { /* network transient */ }
    return false;
  }

  // Reactive verification: when resident completes UPI payment in GPay/PhonePe and returns to browser
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && (state.status === 'CHECKOUT' || state.status === 'LOADING')) {
      checkStatusOnce();
    }
  });

  function downloadReceipt() {
    window.print();
  }

  function render() {
    var info = state.info;
    var hostelName = info?.hostel?.name || rawH || 'Sarvlekh PG';
    var residentName = info?.resident?.name || rawPn || 'Resident';
    var invTitle = info?.invoice?.title || rawTn || 'Hostel Rent';
    var amt = state.amount || rawAm;

    // 1. Success state
    if (state.status === 'SUCCESS') {
      var res = state.paymentResult || {};
      box.innerHTML =
        '<div class="card" style="text-align:center;padding:28px 16px">' +
        '<div style="font-size:48px;line-height:1;margin-bottom:12px">✅</div>' +
        '<h2 style="color:#28a745;margin-bottom:4px">' + esc(T.verified) + '</h2>' +
        '<p class="muted" style="margin-top:0">' + esc(hostelName) + '</p>' +
        '<div class="hero" style="margin:20px 0;background:#f0fff4;border:1px solid #b7eb8f;border-radius:12px;padding:16px">' +
        '<div class="muted sm">' + esc(T.amtPaid) + '</div>' +
        '<div class="big" style="color:#28a745;font-weight:700">' + inr(res.amount || amt) + '</div>' +
        '<div class="sm muted" style="margin-top:4px">' + esc(residentName) + ' · ' + esc(invTitle) + '</div>' +
        '</div>' +
        '<dl class="kv" style="text-align:left;margin:16px 0;font-size:13px">' +
        '<dt>' + esc(T.txnRef) + '</dt><dd><code>' + esc(res.payment_id || state.orderId) + '</code></dd>' +
        (res.utr ? '<dt>' + esc(T.utrRef) + '</dt><dd><b>' + esc(res.utr) + '</b></dd>' : '') +
        (res.receipt_no ? '<dt>Receipt No</dt><dd><b>' + esc(res.receipt_no) + '</b></dd>' : '') +
        '<dt>' + esc(T.date) + '</dt><dd>' + new Date().toLocaleDateString('en-IN') + '</dd>' +
        '</dl>' +
        '<div class="row" style="margin-top:20px;gap:8px">' +
        '<button class="btn primary block" id="btn-rcpt">' + esc(T.downloadReceipt) + '</button>' +
        '</div>' +
        '</div>';
      var btnRcpt = document.getElementById('btn-rcpt');
      if (btnRcpt) btnRcpt.onclick = downloadReceipt;
      return;
    }

    // 2. Loading state
    if (state.status === 'LOADING') {
      box.innerHTML =
        '<div class="card" style="text-align:center;padding:36px 16px">' +
        '<div class="spin"></div>' +
        '<h3 style="margin-top:16px">' + esc(T.payWithCf) + '</h3>' +
        '<p class="muted sm">' + esc(T.wait) + '</p>' +
        '</div>';
      return;
    }

    // 3. Checkout state (Intent / QR Code active)
    if (state.status === 'CHECKOUT') {
      var p = state.sessionData || {};
      var gpayUri = p.gpay || p.default || '';
      var phonepeUri = p.phonepe || p.default || '';
      var paytmUri = p.paytm || p.default || '';
      var bhimUri = p.bhim || p.default || '';
      var genericUri = p.default || gpayUri || `upi://pay?pa=cf@cashfree&am=${amt}&cu=INR`;
      var qrSvg = renderQrSvg(genericUri);

      box.innerHTML =
        '<div class="card">' +
        '<div style="text-align:center">' +
        '<img class="logo" src="icons/icon.svg" alt="" width="72" height="72">' +
        '<h2 style="margin:8px 0 2px">' + esc(hostelName) + '</h2>' +
        '<div class="muted sm">' + esc(residentName) + ' · ' + esc(invTitle) + '</div>' +
        '<div class="big" style="margin:16px 0 4px;font-weight:700">' + inr(amt) + '</div>' +
        '<div class="badge ok" style="margin-bottom:16px">🔒 Cashfree Official UPI Gateway</div>' +
        '</div>' +

        '<div class="upi-apps" style="display:flex;flex-direction:column;gap:10px;margin-top:14px">' +
        (phonepeUri ? '<a class="btn block" style="background:#5f259f;color:#fff" href="' + esc(phonepeUri) + '">💜 PhonePe से Pay करें</a>' : '') +
        (gpayUri ? '<a class="btn block" style="background:#1a73e8;color:#fff" href="' + esc(gpayUri) + '">🔵 Google Pay से Pay करें</a>' : '') +
        (paytmUri ? '<a class="btn block" style="background:#00b9f5;color:#fff" href="' + esc(paytmUri) + '">🔷 Paytm UPI से Pay करें</a>' : '') +
        (bhimUri ? '<a class="btn block" style="background:#005a9c;color:#fff" href="' + esc(bhimUri) + '">🇮🇳 BHIM UPI से Pay करें</a>' : '') +
        '<a class="btn primary block" href="' + esc(genericUri) + '">📱 किसी भी UPI ऐप से Pay करें</a>' +
        '</div>' +

        (qrSvg ?
          '<div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #e5e5ea">' +
          '<p class="hint" style="margin-bottom:8px"><b>' + esc(T.scanQr) + '</b></p>' +
          '<div class="qr" style="display:inline-block;padding:8px;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">' + qrSvg + '</div>' +
          '</div>' : '') +

        (state.pollingStopped ?
          '<div style="text-align:center;margin-top:20px;padding:12px;background:#f9f9fb;border-radius:8px">' +
          '<div class="sm muted">Automatic status checks paused to preserve network & battery. If you completed payment in your UPI app:</div>' +
          '</div>' :
          '<div style="text-align:center;margin-top:20px;padding:12px;background:#f9f9fb;border-radius:8px">' +
          '<div class="sm" style="color:#007aff;display:flex;align-items:center;justify-content:center;gap:6px">' +
          '<span class="spin sm"></span> ' + esc(T.verifying) + '</div>' +
          '<p class="hint sm" style="margin:4px 0 0">' + esc(T.wait) + '</p>' +
          '</div>') +

        '<div class="row" style="justify-content:center;margin-top:14px">' +
        '<button class="btn sm' + (state.pollingStopped ? ' primary' : '') + '" id="btn-manual-refresh">🔄 Check Status Now</button>' +
        '</div>' +
        '</div>';

      var btnRefresh = document.getElementById('btn-manual-refresh');
      if (btnRefresh) {
        btnRefresh.onclick = async function () {
          btnRefresh.disabled = true;
          btnRefresh.textContent = 'Checking...';
          var ok = await checkStatusOnce(true);
          if (!ok && state.status !== 'SUCCESS') {
            btnRefresh.textContent = 'Not Confirmed Yet';
            setTimeout(function () {
              if (btnRefresh) {
                btnRefresh.disabled = false;
                btnRefresh.textContent = '🔄 Check Status Now';
              }
            }, 3000);
          }
        };
      }
      return;
    }

    // 4. Settled / Already Paid Invoice State (Prevents duplicate payment attempts)
    if (amt <= 0 || (info?.invoice && Number(info.invoice.total) > 0 && Number(info.invoice.balance || 0) <= 0)) {
      box.innerHTML =
        '<div class="card" style="text-align:center;padding:28px 16px">' +
        '<div style="font-size:48px;line-height:1;margin-bottom:12px">✅</div>' +
        '<h2 style="color:#28a745;margin-bottom:4px">' + esc(T.alreadyPaid) + '</h2>' +
        '<p class="muted" style="margin-top:0">' + esc(hostelName) + '</p>' +
        '<div class="hero" style="margin:20px 0;background:#f0fff4;border:1px solid #b7eb8f;border-radius:12px;padding:16px">' +
        '<div class="muted sm">' + esc(invTitle) + '</div>' +
        '<div class="big" style="color:#28a745;font-weight:700">' + inr(info?.invoice?.paid || info?.invoice?.total || 0) + '</div>' +
        '<div class="sm muted" style="margin-top:4px">' + esc(residentName) + ' · Zero dues pending</div>' +
        '</div>' +
        '</div>';
      return;
    }

    // 5. Initial state (Pre-checkout review & "Pay Now")
    var upiId = info?.settlement?.upi_id || rawPa || '';
    var payeeName = info?.settlement?.payee_name || rawPn || hostelName;
    var genericUri = upiId ? ('upi://pay?pa=' + encodeURIComponent(upiId) + '&pn=' + encodeURIComponent(payeeName) + '&am=' + encodeURIComponent(amt.toFixed(2)) + '&cu=INR&tn=' + encodeURIComponent((invTitle || 'PG Rent').slice(0, 50))) : '';
    var qrSvg = genericUri ? renderQrSvg(genericUri) : '';

    box.innerHTML =
      '<img class="logo" src="icons/icon.svg" alt="" width="96" height="96">' +
      '<h1>' + esc(hostelName) + '</h1>' +
      '<p class="sub">' + esc(residentName) + (info?.resident?.room ? ' · Room ' + esc(info.resident.room) : '') + '</p>' +

      '<div class="hero" style="text-align:center;margin:16px 0">' +
      '<div class="muted sm">' + esc(invTitle) + '</div>' +
      '<div class="big" style="margin:8px 0;font-weight:700">' + inr(amt) + '</div>' +
      (info?.invoice?.total && info.invoice.total > amt ?
        '<div class="muted sm">Total ' + inr(info.invoice.total) + ' · Paid ' + inr(info.invoice.paid) + '</div>' : '') +
      (upiId ?
        '<div class="upi-apps" style="display:flex;flex-direction:column;gap:8px;margin-top:14px">' +
        '<a class="btn primary block" style="padding:12px;font-size:15px;background:#5f259f;color:#fff" href="' + esc(genericUri) + '">📱 किसी भी UPI ऐप से Pay करें (PhonePe / GPay / Paytm)</a>' +
        '</div>' : '') +
      '</div>' +

      (qrSvg ?
        '<div style="text-align:center;margin-top:16px;border-top:1px solid #e5e5ea;padding-top:16px">' +
        '<p class="hint" style="margin-bottom:8px"><b>' + esc(T.scanQr) + '</b></p>' +
        '<div class="qr" style="display:inline-block;padding:8px;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">' + qrSvg + '</div>' +
        '<div class="sm muted" style="margin-top:8px"><b>' + esc(payeeName) + '</b> · ' + esc(upiId) + '</div>' +
        '<button class="btn sm" id="btn-cp-upi" style="margin-top:6px">' + esc(T.copyUpi) + '</button>' +
        '</div>' : '') +

      (hostelIdParam ?
        '<div class="card" style="margin-top:16px;text-align:left;padding:16px;background:#f9f9fb;border-radius:12px;border:1px solid #e5e5ea">' +
        '<div style="font-weight:600;font-size:14px;margin-bottom:4px">भुगतान के बाद UTR नंबर डालें (Submit UTR)</div>' +
        '<div class="sm muted" style="margin-bottom:12px">UPI से पेमेंट करने के बाद 12-digit UTR नंबर यहाँ डालें। ओनर इसे चेक करके रसीद जारी करेंगे।</div>' +
        '<form id="form-utr" style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<input type="text" id="inp-utr" placeholder="12-digit UTR (उदा: 432109876543)" maxlength="30" style="flex:1;min-width:180px;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:14px" required>' +
        '<button type="submit" class="btn primary" id="btn-sub-utr" style="padding:10px 16px;white-space:nowrap">Submit UTR</button>' +
        '</form>' +
        '<div id="utr-msg" style="margin-top:8px;font-size:13px"></div>' +
        '</div>' : '');

    var btnCp = document.getElementById('btn-cp-upi');
    if (btnCp) {
      btnCp.onclick = function () {
        var b = this;
        (navigator.clipboard ? navigator.clipboard.writeText(upiId) : Promise.reject())
          .then(function () { b.textContent = T.copied; })
          .catch(function () { prompt('UPI ID', upiId); });
      };
    }

    var formUtr = document.getElementById('form-utr');
    if (formUtr) {
      formUtr.onsubmit = async function (e) {
        e.preventDefault();
        var inp = document.getElementById('inp-utr'), msg = document.getElementById('utr-msg'), btn = document.getElementById('btn-sub-utr');
        if (!inp || !btn) return;
        var utrVal = inp.value.trim().replace(/[^a-zA-Z0-9]/g, '');
        if (utrVal.length < 6) { msg.innerHTML = '<span style="color:#d93025">Please enter a valid 12-digit UTR number</span>'; return; }
        btn.disabled = true; btn.textContent = 'Submitting...';
        try {
          var r = await fetch('/api/public?sub=submit_claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hostel_id: state.info?.hostel?.id || hostelIdParam,
              res_id: state.info?.resident?.id || resIdParam,
              amount: amt,
              utr: utrVal
            })
          });
          var j = await r.json();
          if (j && j.ok) {
            formUtr.parentElement.innerHTML = '<div style="text-align:center;padding:12px;background:#f0fff4;border:1px solid #b7eb8f;border-radius:8px"><div style="font-size:24px;margin-bottom:4px">✅</div><b style="color:#28a745">UTR Submitted Successfully!</b><div class="sm muted" style="margin-top:4px">UTR: <code>' + esc(utrVal) + '</code> for ' + inr(amt) + '<br>The hostel owner will verify and approve your receipt.</div></div>';
          } else {
            msg.innerHTML = '<span style="color:#d93025">' + esc(j.error || 'Could not submit UTR') + '</span>';
            btn.disabled = false; btn.textContent = 'Submit UTR';
          }
        } catch (err) {
          msg.innerHTML = '<span style="color:#d93025">Network error. Try again.</span>';
          btn.disabled = false; btn.textContent = 'Submit UTR';
        }
      };
    }
  }

  fetchPayInfo();
})();
