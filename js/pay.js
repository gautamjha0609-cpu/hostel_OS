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

  var T = {
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
    alreadyPaid: 'This invoice has already been paid in full!',
    badLink: 'This payment link is not valid or has expired. Please ask the hostel for a new link.',
    amountToPay: 'Amount to pay', payUpi: 'Pay with UPI app', opensApps: 'Opens GPay, PhonePe, Paytm and more',
    onComputer: 'Open this page on your phone to pay, or scan the QR with your phone\'s UPI app.', noApp: 'No UPI app opened? Scan the QR or copy the UPI ID.',
    copyAmount: 'Copy amount', utrTitle: 'Your UTR and screenshot', utrSub: 'Enter the UTR from your UPI app and add the screenshot. The owner checks it and sends your receipt.',
    utrPh: 'UTR / transaction ID', submitUtr: 'Send', addShot: 'Add payment screenshot', changeShot: 'Change screenshot', shotAdded: 'Screenshot added', viewShot: 'View screenshot', removeShot: 'Remove screenshot', backPay: 'Back to payment', alreadyPaidLink: 'Already paid? Enter UTR', badShot: 'Please choose a photo (up to 15 MB)', badUtr: 'Please enter the UTR from your UPI app', badLink: 'This link is not linked to a resident. Ask the owner for a new link.', sending: 'Sending...', sent: 'Sent to the owner', already: 'Already sent', failedSend: 'Could not send. Please try again.', network: 'Network problem. Please try again.', secure: 'Secure payment', noUpi: 'The owner has not added a UPI ID yet.', forWho: 'for'
  };
  var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || ((navigator.maxTouchPoints || 0) > 1 && /Macintosh/i.test(navigator.userAgent || ''));
  var placeholder = function (v) { return !v || v === 'Resident' || v === 'Hostel / PG Property'; };

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
    step: 'pay', shot: null, utr: '',
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
    var hostelName = (!placeholder(info?.hostel?.name) && info.hostel.name) || rawH || 'Sarvlekh PG';
    var residentName = (!placeholder(info?.resident?.name) && info.resident.name) || '';
    var invTitle = (info?.invoice?.title && info.invoice.title !== 'Rent Invoice' && info.invoice.title) || rawTn || info?.invoice?.title || 'Hostel Rent';
    var amt = state.amount || rawAm;

    // 1. Success state
    if (state.status === 'SUCCESS') {
      var res = state.paymentResult || {};
      box.innerHTML =
        '<div class="card" style="text-align:center;padding:28px 16px">' +
        '<div style="margin-bottom:12px"><svg viewBox="0 0 24 24" style="width:52px;height:52px;color:#1a8f3c;display:block;margin:0 auto" aria-hidden="true"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
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
        '<div class="badge ok" style="margin-bottom:16px">Cashfree Official UPI Gateway</div>' +
        '</div>' +

        '<div class="upi-apps" style="display:flex;flex-direction:column;gap:10px;margin-top:14px">' +
        (phonepeUri ? '<a class="btn block" style="background:#5f259f;color:#fff" href="' + esc(phonepeUri) + '">Pay with PhonePe</a>' : '') +
        (gpayUri ? '<a class="btn block" style="background:#1a73e8;color:#fff" href="' + esc(gpayUri) + '">Pay with Google Pay</a>' : '') +
        (paytmUri ? '<a class="btn block" style="background:#00b9f5;color:#fff" href="' + esc(paytmUri) + '">Pay with Paytm</a>' : '') +
        (bhimUri ? '<a class="btn block" style="background:#005a9c;color:#fff" href="' + esc(bhimUri) + '">Pay with BHIM UPI</a>' : '') +
        '<a class="btn primary block" href="' + esc(genericUri) + '">Pay with any UPI app</a>' +
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
        '<button class="btn sm' + (state.pollingStopped ? ' primary' : '') + '" id="btn-manual-refresh">Check Status Now</button>' +
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
                btnRefresh.textContent = 'Check Status Now';
              }
            }, 3000);
          }
        };
      }
      return;
    }

    // 3b. No invoice found and nothing to pay: a wrong or expired link must never claim "paid in full".
    if (!(Number(amt) > 0) && !(info && info.invoice)) {
      box.innerHTML = '<div class="card" style="text-align:center;padding:28px 16px"><h2 style="margin-bottom:8px">' + esc(T.badLink) + '</h2></div>';
      return;
    }

    // 4. Settled / Already Paid Invoice State (Prevents duplicate payment attempts)
    if (amt <= 0 ||(info?.invoice && Number(info.invoice.total) > 0 && Number(info.invoice.balance || 0) <= 0)) {
      box.innerHTML =
        '<div class="card" style="text-align:center;padding:28px 16px">' +
        '<div style="margin-bottom:12px"><svg viewBox="0 0 24 24" style="width:52px;height:52px;color:#1a8f3c;display:block;margin:0 auto" aria-hidden="true"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
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
    var genericUri = upiId ? ('upi://pay?pa=' + encodeURIComponent(upiId) + '&pn=' + encodeURIComponent(payeeName) + '&am=' + encodeURIComponent(amt.toFixed(2)) + '&cu=INR&tn=' + encodeURIComponent((rawTn || invTitle || 'PG Rent').slice(0, 50))) : '';
    var qrSvg = genericUri ? renderQrSvg(genericUri) : '';

    var who = [residentName, info?.resident?.room ? 'Room ' + info.resident.room : ''].filter(Boolean).join(' · ');
    var upiOk = !!upiId;
    // Where the person is: paying (QR + Pay Now), or has paid and is sending the proof (UTR + screenshot).
    // After Pay Now takes them to their UPI app, coming back to this page lands them on the proof step.
    var flagKey = 'pay-went-' + (resIdParam || '') + '-' + amt;
    var wentAt = 0; try { wentAt = +localStorage.getItem(flagKey) || 0; } catch (e) { /* private mode */ }
    if (state.step === 'pay' && wentAt && Date.now() - wentAt < 45 * 60 * 1000 && hostelIdParam) state.step = 'proof';
    var proofStep = state.step === 'proof' && !!hostelIdParam;

    var proofHtml = hostelIdParam ?
      '<section class="pq-utr"><b>' + esc(T.utrTitle) + '</b><span>' + esc(T.utrSub) + '</span>' +
      '<form id="form-utr"><input type="text" id="inp-utr" inputmode="text" autocomplete="off" placeholder="' + esc(T.utrPh) + '" maxlength="30" value="' + esc(state.utr) + '" required>' +
      (state.shot
        ? '<div class="pq-shot"><img src="' + state.shot + '" alt=""><span>' + esc(T.shotAdded) + '</span>' +
          '<button type="button" class="pq-ib" id="ss-eye" aria-label="' + esc(T.viewShot) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.9"/></svg></button>' +
          '<button type="button" class="pq-ib" id="ss-del" aria-label="' + esc(T.removeShot) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>'
        : '<label class="pq-file" id="ss-lab"><input type="file" id="inp-ss" accept="image/*"><span id="ss-txt">' + esc(T.addShot) + '</span></label>') +
      '<button type="submit" class="pp-send pq-send" id="btn-sub-utr">' + esc(T.submitUtr) + '</button></form>' +
      '<div id="utr-msg" class="pp-msg"></div></section>' : '';

    box.innerHTML = proofStep
      ? '<div class="pq"><p class="pq-host">' + esc(hostelName) + '</p><h1 class="pq-h">Payment proof</h1><div class="pq-amt">' + inr(amt) + '</div>' + (who ? '<p class="pq-to">' + esc(who) + '</p>' : '') + proofHtml +
        '<button type="button" class="pq-link" id="pp-back">' + esc(T.backPay) + '</button></div>'
      : '<div class="pq">' +
        '<p class="pq-host">' + esc(hostelName) + '</p>' +
        (upiOk && qrSvg ? '<div class="pq-qr"><div class="pq-frame">' + qrSvg + '</div></div>' : '<div class="pp-warn">' + esc(T.noUpi) + '</div>') +
        '<h1 class="pq-h">Payment</h1>' +
        '<div class="pq-amt">' + inr(amt) + '</div>' +
        (who ? '<p class="pq-to">' + esc(who) + '</p>' : '') +
        (upiOk ? (isMobile ? '<a class="pq-btn" id="pp-open" href="' + esc(genericUri) + '">Pay Now</a>' : '<button type="button" class="pq-btn" id="pp-open">Pay Now</button>') + '<p class="pp-fb" id="pp-fb" hidden></p>' : '') +
        (upiOk ? '<button type="button" class="pq-copy" id="btn-cp-upi">' + esc(upiId) + ' <b>' + esc(T.copyUpi) + '</b></button>' : '') +
        (hostelIdParam ? '<button type="button" class="pq-link" id="pp-paid">' + esc(T.alreadyPaidLink) + '</button>' : '') +
        '</div>';

    var toStep = function (st) { state.step = st; render(); window.scrollTo(0, 0); };
    var openBtn = document.getElementById('pp-open');
    if (openBtn) openBtn.onclick = function () {
      var fb = document.getElementById('pp-fb'); if (!fb) return;
      if (!isMobile) { fb.textContent = T.onComputer; fb.hidden = false; return; }
      // remember that this person went to pay: when they come back, the page asks for the UTR and the screenshot
      try { localStorage.setItem(flagKey, String(Date.now())); } catch (e) { /* private mode */ }
      // if no UPI app took the link, the page is still in front a moment later: say what to do instead
      setTimeout(function () { if (document.visibilityState === 'visible') { fb.textContent = T.noApp; fb.hidden = false; } }, 1800);
    };
    var btnPaid = document.getElementById('pp-paid'); if (btnPaid) btnPaid.onclick = function () { toStep('proof'); };
    var btnBack = document.getElementById('pp-back'); if (btnBack) btnBack.onclick = function () { try { localStorage.removeItem(flagKey); } catch (e) { /* private mode */ } toStep('pay'); };
    var btnCp = document.getElementById('btn-cp-upi');
    if (btnCp) {
      btnCp.onclick = function () {
        var b = this;
        (navigator.clipboard ? navigator.clipboard.writeText(upiId) : Promise.reject())
          .then(function () { b.textContent = T.copied; })
          .catch(function () { prompt('UPI ID', upiId); });
      };
    }

    // the screenshot is shrunk here before it is sent, so it stays small for everybody
    function shrink(file) {
      return new Promise(function (resolve, reject) {
        if (!/^image\//.test(file.type) || file.size > 15 * 1024 * 1024) { reject(new Error(T.badShot)); return; }
        var img = new Image(), url = URL.createObjectURL(file);
        img.onload = function () {
          var s = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error(T.badShot)); };
        img.src = url;
      });
    }
    var inpUtr = document.getElementById('inp-utr'); if (inpUtr) inpUtr.oninput = function () { state.utr = inpUtr.value; };
    var inpSs = document.getElementById('inp-ss');
    if (inpSs) inpSs.onchange = function () {
      var f = inpSs.files && inpSs.files[0], msg = document.getElementById('utr-msg');
      if (!f) return;
      shrink(f).then(function (d) { state.shot = d; render(); })
        .catch(function (e) { if (msg) msg.innerHTML = '<span style="color:#d93025">' + esc(e.message) + '</span>'; inpSs.value = ''; });
    };
    var eye = document.getElementById('ss-eye');
    if (eye) eye.onclick = function () {
      // the picture, full screen; a tap anywhere (or Esc) closes it
      var ov = document.createElement('div'); ov.className = 'pq-view'; ov.setAttribute('role', 'dialog');
      ov.innerHTML = '<img src="' + state.shot + '" alt=""><button type="button" aria-label="Close">&times;</button>';
      var off = function () { ov.remove(); document.removeEventListener('keydown', onKey); };
      var onKey = function (e) { if (e.key === 'Escape') off(); };
      ov.onclick = off; document.addEventListener('keydown', onKey); document.body.appendChild(ov);
    };
    var del = document.getElementById('ss-del'); if (del) del.onclick = function () { state.shot = null; render(); };

    var formUtr = document.getElementById('form-utr');
    if (formUtr) {
      var sending = false;
      formUtr.onsubmit = async function (e) {
        e.preventDefault();
        if (sending) return;
        var inp = document.getElementById('inp-utr'), msg = document.getElementById('utr-msg'), btn = document.getElementById('btn-sub-utr');
        if (!inp || !btn) return;
        var utrVal = inp.value.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (utrVal.length < 6) { msg.innerHTML = '<span style="color:#d93025">' + esc(T.badUtr) + '</span>'; return; }
        var resId = state.info?.resident?.id || resIdParam, hostelId = state.info?.hostel?.id || hostelIdParam;
        if (!resId || !hostelId) { msg.innerHTML = '<span style="color:#d93025">' + esc(T.badLink) + '</span>'; return; }
        sending = true; btn.disabled = true; btn.textContent = T.sending;
        try {
          var r = await fetch('/api/public?sub=submit_claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostel_id: hostelId, res_id: resId, amount: amt, utr: utrVal, proof: state.shot || undefined })
          });
          var j = await r.json().catch(function () { return {}; });
          if (j && j.ok) {
            try { localStorage.removeItem(flagKey); } catch (e2) { /* private mode */ }
            var done = j.duplicate ? T.already : T.sent;
            formUtr.parentElement.innerHTML = '<div class="pq-done"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><b>' + esc(done) + '</b><span>UTR ' + esc(utrVal) + ' · ' + inr(amt) + '</span></div>';
            var back2 = document.getElementById('pp-back'); if (back2) back2.remove();
          } else {
            msg.innerHTML = '<span style="color:#d93025">' + esc((j && j.error) || T.failedSend) + '</span>';
            sending = false; btn.disabled = false; btn.textContent = T.submitUtr;
          }
        } catch (err) {
          msg.innerHTML = '<span style="color:#d93025">' + esc(T.network) + '</span>';
          sending = false; btn.disabled = false; btn.textContent = T.submitUtr;
        }
      };
    }
  }

  // back from the UPI app: show the proof step (UTR + screenshot) instead of the QR and Pay Now
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || state.step !== 'pay' || !hostelIdParam) return;
    var at = 0; try { at = +localStorage.getItem('pay-went-' + (resIdParam || '') + '-' + (state.amount || rawAm)) || 0; } catch (e) { /* private mode */ }
    if (at && Date.now() - at > 2500 && Date.now() - at < 45 * 60 * 1000 && state.status === 'INITIAL') { state.step = 'proof'; render(); window.scrollTo(0, 0); }
  });

  fetchPayInfo();
})();
