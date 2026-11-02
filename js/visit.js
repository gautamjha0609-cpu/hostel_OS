// Public visitor self-entry (visit.html). Opened from the QR at the gate; no login, no app.
// The form posts to /api/public/visit, which checks the QR key and writes the entry into the
// hostel's gate register.
// In demo mode (no Supabase configured) the entry is kept in this browser and the demo app
// picks it up on its Gate screen, so the flow can be tried on one machine.
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var H = q.get('h') || '', K = q.get('k') || '', NAME = q.get('n') || '';
  var CFG = window.HOSTELOS_CONFIG || {}, CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  var hi = (navigator.language || '').toLowerCase().indexOf('hi') === 0;
  var T = hi ? {
    title: 'विज़िटर एंट्री', name: 'आपका नाम', phone: 'मोबाइल नंबर', meet: 'किससे मिलना है', room: 'रूम नंबर (अगर पता हो)',
    purpose: 'मिलने का कारण', from: 'कहाँ से आए हैं', loc: 'मेरी लोकेशन लें', finding: 'लोकेशन ढूँढ रहे हैं…', submit: 'एंट्री करें', sending: 'भेज रहे हैं…',
    done: 'धन्यवाद! आपकी एंट्री हो गई है।', doneSub: 'कृपया गेट पर गार्ड को यह स्क्रीन दिखाएँ।', bad: 'यह QR अब मान्य नहीं है। कृपया गेट पर एंट्री करें।',
    need: 'कृपया नाम और 10 अंकों का मोबाइल नंबर भरें।', fail: 'एंट्री नहीं हो सकी। कृपया फिर से कोशिश करें या गेट पर एंट्री करें।', meeting: 'मिलना', again: 'एक और एंट्री',
  } : {
    title: 'Visitor entry', name: 'Your name', phone: 'Mobile number', meet: 'Whom are you meeting?', room: 'Room number (if known)',
    purpose: 'Purpose of visit', from: 'Coming from', loc: 'Use my current location', finding: 'Finding your location…', submit: 'Submit entry', sending: 'Sending…',
    done: 'Thank you! Your entry is recorded.', doneSub: 'Please show this screen to the guard at the gate.', bad: 'This QR code is not valid any more. Please register at the gate.',
    need: 'Please enter your name and a 10-digit mobile number.', fail: 'Could not record the entry. Please try again or register at the gate.', meeting: 'Meeting', again: 'Another entry',
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var box = document.getElementById('box'), geo = null;
  var api = function (body) {
    return fetch('api/public/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ h: H, k: K }, body)) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d.error || T.fail); e.status = r.status; throw e; } return d; }); });
  };
  var shell = function (inner) { box.innerHTML = '<img class="logo" src="icons/icon.svg" alt="" width="104" height="88"><h1>' + esc(NAME || T.title) + '</h1><p class="sub">' + esc(T.title) + '</p>' + inner; };
  var fail = function (msg) { shell('<div class="card"><div class="empty"><b>⚠️</b>' + esc(msg) + '</div></div>'); };

  function form() {
    var f = function (id, label, attrs) { return '<div class="full"><label class="f" for="' + id + '">' + esc(label) + '</label><input id="' + id + '" ' + (attrs || '') + ' autocomplete="one-off"></div>'; };
    shell('<form id="vf" class="card" novalidate autocomplete="off"><div class="fgrid">' +
      f('v_name', T.name + ' *', 'type="text" maxlength="80" required') +
      f('v_phone', T.phone + ' *', 'type="tel" inputmode="tel" maxlength="14" required') +
      f('v_meet', T.meet, 'type="text" maxlength="80"') +
      f('v_room', T.room, 'type="text" maxlength="20"') +
      f('v_purpose', T.purpose, 'type="text" maxlength="80" value="' + esc(T.meeting) + '"') +
      f('v_place', T.from, 'type="text" maxlength="160"') +
      '<div class="full"><button class="btn sm" type="button" id="v_loc">' + esc(T.loc) + '</button> <span class="hint" id="v_locmsg"></span></div>' +
      '</div><div class="ferr" id="v_err" role="alert"></div><button class="btn primary block" type="submit" id="v_go" style="margin-top:14px">' + esc(T.submit) + '</button></form>');
    document.getElementById('v_loc').onclick = function () {
      var m = document.getElementById('v_locmsg'); m.textContent = T.finding;
      Geo.locate().then(function (p) { geo = { lat: p.lat, lng: p.lng }; document.getElementById('v_place').value = p.text; m.textContent = ''; })
        .catch(function (e) { m.textContent = e.message; });
    };
    document.getElementById('vf').onsubmit = function (ev) {
      ev.preventDefault();
      var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
      var entry = { name: v('v_name'), phone: v('v_phone').replace(/\D/g, '').slice(-10), meet: v('v_meet'), roomNo: v('v_room'), purpose: v('v_purpose'), place: v('v_place'), geo: geo };
      var err = document.getElementById('v_err'), go = document.getElementById('v_go');
      if (!entry.name || entry.phone.length !== 10) { err.textContent = T.need; return; }
      err.textContent = ''; go.disabled = true; go.textContent = T.sending;
      var send = CLOUD ? api({ action: 'submit', entry: entry }) : demoSend(entry);
      send.then(function () { done(entry); }).catch(function (e) { err.textContent = e.message || T.fail; go.disabled = false; go.textContent = T.submit; });
    };
  }


  function demoSend(entry) {
    try {
      var k = 'hostelos.demo.visits', list = JSON.parse(localStorage.getItem(k) || '[]');
      list.push(Object.assign({ h: H, at: new Date().toISOString() }, entry));
      localStorage.setItem(k, JSON.stringify(list.slice(-50)));
      return Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }
  function done(entry) {
    var time = new Date().toLocaleTimeString(hi ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' });
    shell('<div class="card" style="text-align:center"><div style="font-size:44px">✅</div><h2 style="margin:6px 0">' + esc(T.done) + '</h2>' +
      '<p><b style="font-size:20px">' + esc(entry.name) + '</b><br><span class="muted">' + esc(time) + (entry.meet ? ' · ' + esc(entry.meet) : '') + '</span></p>' +
      '<p class="hint" style="margin-top:10px">' + esc(T.doneSub) + '</p><button class="btn sm" id="v_again" style="margin-top:14px">' + esc(T.again) + '</button></div>');
    document.getElementById('v_again').onclick = function () { location.reload(); };
  }

  if (!/^[0-9a-f-]{36}$/i.test(H) && !/^[\w-]{2,40}$/.test(H)) return fail(T.bad);
  if (!/^[\w-]{12,64}$/.test(K)) return fail(T.bad);
  if (!CLOUD) return form();
  api({ action: 'info' }).then(function (d) { if (d.name) NAME = d.name; form(); })
    .catch(function (e) { fail(e.status === 403 ? T.bad : (e.message || T.fail)); });
})();
