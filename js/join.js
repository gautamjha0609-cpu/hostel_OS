// Public resident self-registration (join.html). Opened from the QR the owner prints or sends;
// no login, no app install. The new resident fills in who they are and uploads their papers,
// and it arrives as an APPLICATION — not a tenancy. Room, bed, rent and deposit are never on
// this form, because a stranger holding the QR must not be able to give themselves a bed or
// set their own rent; the owner picks all of that when they admit the application.
//
// Police verification is offered here too: the resident is the one with the Aadhaar and the
// photo, so letting them file it at registration saves the owner the job. Whatever reference
// number comes back is carried onto the resident record, and the owner can still do it later
// if the resident skipped it.
//
// In demo mode (no Supabase configured) the application is kept in this browser and the demo
// app picks it up, so the whole flow can be tried on one machine.
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var H = q.get('h') || '', K = q.get('k') || '', NAME = q.get('n') || '';
  var CFG = window.HOSTELOS_CONFIG || {}, CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  var hi = (navigator.language || '').toLowerCase().indexOf('hi') === 0;
  var T = hi ? {
    title: 'नया रजिस्ट्रेशन', sub: 'अपनी जानकारी भरें', you: 'आपकी जानकारी',
    name: 'पूरा नाम', phone: 'मोबाइल नंबर (WhatsApp)', email: 'ईमेल', college: 'कॉलेज / ऑफिस',
    idNo: 'आधार / ID नंबर', address: 'स्थायी पता', lang: 'भाषा',
    guardianSec: 'परिवार / अभिभावक', guardian: 'अभिभावक का नाम', guardianPhone: 'अभिभावक का मोबाइल',
    docsSec: 'दस्तावेज़', docsHint: 'फ़ोटो या PDF। सीधे हॉस्टल के सुरक्षित फ़ोल्डर में जाते हैं।',
    docsLater: 'अभी यहाँ अपलोड नहीं हो सकता। ये दस्तावेज़ साथ लेकर आइए — हॉस्टल पहुँचने पर ले लिए जाएँगे:',
    pvSec: 'पुलिस वेरिफिकेशन', pvHint: 'किरायेदार का पुलिस वेरिफिकेशन कानूनन ज़रूरी है। आप इसे अभी खुद कर सकते हैं, या हॉस्टल बाद में कर देगा।',
    pvOpen: 'पुलिस पोर्टल खोलें', pvCopy: 'अपनी जानकारी कॉपी करें', pvCopied: 'कॉपी हो गया — पोर्टल पर पेस्ट करें',
    pvDone: 'मैंने पुलिस वेरिफिकेशन भर दिया है', pvRef: 'रेफरेंस / पावती नंबर',
    note: 'कुछ और बताना चाहें?', submit: 'रजिस्ट्रेशन भेजें', sending: 'भेज रहे हैं…', uploading: 'दस्तावेज़ भेजे जा रहे हैं…',
    done: 'धन्यवाद! आपका फ़ॉर्म भेज दिया गया है।',
    doneSub: 'हॉस्टल मालिक इसे देखकर आपका कमरा तय करेंगे। उसके बाद आपको WhatsApp पर लॉगिन मिल जाएगा।',
    bad: 'यह QR अब मान्य नहीं है। कृपया हॉस्टल से नया QR माँगें।',
    need: 'कृपया नाम और 10 अंकों का मोबाइल नंबर भरें।',
    needG: 'कृपया अभिभावक का 10 अंकों का मोबाइल नंबर भरें।',
    fail: 'फ़ॉर्म नहीं भेजा जा सका। कृपया फिर कोशिश करें।', noRoom: 'कमरा और किराया हॉस्टल मालिक तय करेंगे।',
    noServer: 'यह फ़ॉर्म अभी चालू नहीं है — हॉस्टल का सर्वर अभी लाइव नहीं हुआ है। कृपया हॉस्टल को बताएं।',
  } : {
    title: 'New resident registration', sub: 'Tell us about yourself', you: 'About you',
    name: 'Full name', phone: 'Mobile number (WhatsApp)', email: 'Email', college: 'College / office',
    idNo: 'Aadhaar / ID number', address: 'Permanent address', lang: 'Language',
    guardianSec: 'Parent / guardian', guardian: 'Parent or guardian name', guardianPhone: 'Their mobile number',
    docsSec: 'Documents', docsHint: 'A photo or a PDF. These go straight into the hostel’s private folder.',
    docsLater: 'These cannot be uploaded here yet. Please bring them with you — the hostel will take them when you arrive:',
    pvSec: 'Police verification', pvHint: 'Police verification of tenants is required by law. You can do it yourself now, or leave it and the hostel will do it for you.',
    pvOpen: 'Open the police portal', pvCopy: 'Copy my details', pvCopied: 'Copied — paste it into the portal',
    pvDone: 'I have filled the police verification form', pvRef: 'Reference / acknowledgement number',
    note: 'Anything else we should know?', submit: 'Send registration', sending: 'Sending…', uploading: 'Uploading documents…',
    done: 'Thank you! Your form has been sent.',
    doneSub: 'The hostel will review it and allot your room. You will get your app login on WhatsApp after that.',
    bad: 'This QR code is not valid any more. Please ask the hostel for a new one.',
    need: 'Please enter your name and a 10-digit mobile number.',
    needG: 'Please enter a 10-digit mobile number for your parent or guardian.',
    fail: 'Could not send the form. Please try again.', noRoom: 'Your room and rent are decided by the hostel.',
    noServer: 'This form is not switched on yet — the hostel’s server is not live. Please let the hostel know.',
  };
  // Mirrors PV_STATES in js/domain.js for the handful of states a resident is likely to be in.
  // The owner's own override is not visible from here, so this is only a convenience link.
  var PORTALS = {
    AP: 'https://citizen.appolice.gov.in/', AS: 'https://police.assam.gov.in/', BR: 'https://police.bihar.gov.in/',
    CG: 'https://cgpolice.gov.in/', CH: 'https://chandigarhpolice.gov.in/', DL: 'https://cctns.delhipolice.gov.in/citizenservices/',
    GA: 'https://citizen.goapolice.gov.in/', GJ: 'https://police.gujarat.gov.in/', HR: 'https://haryanapolice.gov.in/',
    HP: 'https://himachal.nic.in/police', JH: 'https://jhpolice.gov.in/', JK: 'https://jkpolice.gov.in/',
    KA: 'https://ksp.karnataka.gov.in/', KL: 'https://thuna.keralapolice.gov.in/', MH: 'https://citizen.mahapolice.gov.in/Citizen/MH/index.aspx',
    ML: 'https://megpolice.gov.in/', MP: 'https://citizen.mppolice.gov.in/', OD: 'https://police.odisha.gov.in/',
    PB: 'https://ppsaanjh.in/', RJ: 'https://police.rajasthan.gov.in/', TN: 'https://eservices.tnpolice.gov.in/CCTNSNICSDC/Index?0',
    TR: 'https://police.tripura.gov.in/', TS: 'https://www.tspolice.gov.in/', UK: 'https://uttarakhandpolice.uk.gov.in/',
    UP: 'https://uppolice.gov.in/', WB: 'https://wbpolice.gov.in/',
  };
  var NATIONAL = 'https://digitalpolice.gov.in/';

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var box = document.getElementById('box');
  var DOCS = [], PV = { on: false, state: '' };

  var api = function (body) {
    return fetch('api/public/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ h: H, k: K }, body)) })
      .then(function (r) {
        return r.text().then(function (txt) {
          var d = null; try { d = JSON.parse(txt); } catch (e) { /* not our endpoint */ }
          if (!r.ok) {
            // our own refusals always arrive as JSON; anything else means the endpoint is not there
            var e2 = new Error(d && d.error ? d.error : (d ? T.fail : T.noServer));
            e2.status = r.status; e2.noServer = !d;
            throw e2;
          }
          return d || {};
        });
      });
  };
  var shell = function (inner) {
    box.innerHTML = '<img class="logo" src="icons/icon.svg" alt="" width="104" height="88"><h1>' + esc(NAME || T.title) + '</h1><p class="sub">' + esc(T.sub) + '</p>' + inner;
  };
  var fail = function (msg) { shell('<div class="card"><div class="empty"><b>⚠️</b>' + esc(msg) + '</div></div>'); };
  var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };

  // Same budget as an upload from the app (compressImage in core.js, which this page does not
  // load): 1280 px reads an Aadhaar number, 600 px is plenty for a face. WebP where the phone
  // can write it, JPEG where it cannot (Safari hands back a PNG instead). PDFs go as they are.
  var DOC_MAX = 3 * 1024 * 1024;
  function compress(file, max) {
    return new Promise(function (res) {
      if (!file) return res(null);
      if (!/^image\//.test(file.type)) return res(file.type === 'application/pdf' && file.size <= DOC_MAX ? file : null);
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) {
          if (b && b.type === 'image/webp') return res(b);
          c.toBlob(function (j) { res(j && j.size <= DOC_MAX ? j : null); }, 'image/jpeg', 0.7);
        }, 'image/webp', 0.7);
      };
      im.onerror = function () { res(null); };
      im.src = url;
    });
  }
  // One id per filled-in form, chosen here so the papers and the form end up in one folder.
  var APP = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(10)), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');

  function sec(label) { return '<div class="full group-t" style="padding:10px 2px 0">' + esc(label) + '</div>'; }
  function fld(id, label, attrs, hint) {
    return '<div class="full"><label class="f" for="' + id + '">' + esc(label) + '</label><input id="' + id + '" ' + (attrs || '') +
      ' autocomplete="one-off" data-form-type="other" data-lpignore="true">' + (hint ? '<div class="hint" style="margin-top:4px">' + esc(hint) + '</div>' : '') + '</div>';
  }

  function form(info) {
    var docRows = (info.upload ? (info.docs || []) : []).map(function (d, i) {
      return '<div class="full"><label class="f" for="j_doc' + i + '">' + esc(d) + '</label>' +
        '<input id="j_doc' + i + '" type="file" accept="image/*,application/pdf" data-label="' + esc(d) + '"></div>';
    }).join('');
    var portal = PORTALS[PV.state] || NATIONAL;

    shell('<form id="jf" class="card" novalidate autocomplete="off"><div class="fgrid">' +
      sec(T.you) +
      fld('j_name', T.name + ' *', 'type="text" maxlength="80" required') +
      fld('j_phone', T.phone + ' *', 'type="tel" inputmode="tel" maxlength="14" required') +
      fld('j_email', T.email, 'type="email" maxlength="120"') +
      fld('j_college', T.college, 'type="text" maxlength="120"') +
      fld('j_idno', T.idNo, 'type="text" maxlength="40"') +
      fld('j_address', T.address, 'type="text" maxlength="240"') +
      '<div class="full"><label class="f" for="j_lang">' + esc(T.lang) + '</label><select id="j_lang"><option value="en">English</option><option value="hi"' + (hi ? ' selected' : '') + '>हिन्दी</option></select></div>' +
      sec(T.guardianSec) +
      fld('j_guardian', T.guardian, 'type="text" maxlength="80"') +
      fld('j_gphone', T.guardianPhone, 'type="tel" inputmode="tel" maxlength="14"') +
      ((info.docs || []).length
        ? sec(T.docsSec) + (info.upload
          ? '<div class="full"><div class="hint">' + esc(T.docsHint) + '</div></div>' + docRows
          : '<div class="full"><div class="hint">' + esc(T.docsLater) + '</div><ul class="doclist">' +
            (info.docs || []).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div>')
        : '') +
      (PV.on ? sec(T.pvSec) +
        '<div class="full"><div class="hint">' + esc(T.pvHint) + '</div>' +
        '<div class="row wrap" style="gap:8px;margin-top:10px">' +
        '<a class="btn sm primary" href="' + esc(portal) + '" target="_blank" rel="noopener noreferrer">' + esc(T.pvOpen) + '</a>' +
        '<button class="btn sm" type="button" id="j_pvcopy">' + esc(T.pvCopy) + '</button>' +
        '<span class="hint" id="j_pvmsg"></span></div>' +
        '<label class="row nw" style="gap:10px;font-weight:600;font-size:15px;min-height:44px;margin-top:8px">' +
        '<input type="checkbox" id="j_pvdone"> <span>' + esc(T.pvDone) + '</span></label>' +
        '<div id="j_pvref" hidden style="margin-top:6px"><label class="f" for="j_pvrefno">' + esc(T.pvRef) + '</label>' +
        '<input id="j_pvrefno" type="text" maxlength="60" autocomplete="one-off"></div></div>' : '') +
      sec('') + fld('j_note', T.note, 'type="text" maxlength="240"') +
      '</div><div class="note" style="margin-top:12px">' + esc(T.noRoom) + '</div>' +
      '<div class="ferr" id="j_err" role="alert"></div>' +
      '<button class="btn primary block" type="submit" id="j_go" style="margin-top:14px">' + esc(T.submit) + '</button></form>');

    var done = document.getElementById('j_pvdone');
    if (done) done.onchange = function () { document.getElementById('j_pvref').hidden = !done.checked; };
    var copy = document.getElementById('j_pvcopy');
    if (copy) copy.onclick = function () {
      var lines = [T.name + ': ' + val('j_name'), T.phone + ': ' + val('j_phone'), T.idNo + ': ' + val('j_idno'),
        T.address + ': ' + val('j_address'), T.guardian + ': ' + val('j_guardian'), T.guardianPhone + ': ' + val('j_gphone'),
        (NAME ? 'Hostel / PG: ' + NAME : '')].filter(function (x) { return x.slice(-2) !== ': '; }).join('\n');
      var msg = document.getElementById('j_pvmsg');
      if (navigator.clipboard) navigator.clipboard.writeText(lines).then(function () { msg.textContent = T.pvCopied; }).catch(function () { msg.textContent = lines; });
      else msg.textContent = lines;
    };

    document.getElementById('jf').onsubmit = function (ev) {
      ev.preventDefault();
      var err = document.getElementById('j_err'), go = document.getElementById('j_go');
      var entry = {
        name: val('j_name'), phone: val('j_phone').replace(/\D/g, '').slice(-10),
        email: val('j_email'), college: val('j_college'), idNo: val('j_idno'), address: val('j_address'),
        lang: val('j_lang') || 'en', guardian: val('j_guardian'),
        guardianPhone: val('j_gphone').replace(/\D/g, '').slice(-10),
        note: val('j_note'),
        pvDone: !!(done && done.checked), pvRefNo: val('j_pvrefno'), pvState: PV.state,
      };
      if (!entry.name || entry.phone.length !== 10) { err.textContent = T.need; return; }
      if (val('j_gphone') && entry.guardianPhone.length !== 10) { err.textContent = T.needG; return; }
      err.textContent = ''; go.disabled = true; go.textContent = T.sending;
      var send = CLOUD ? cloudSend(entry, go) : demoSend(entry);
      send.then(function () { finish(entry); })
        .catch(function (e) { err.textContent = e.message || T.fail; go.disabled = false; go.textContent = T.submit; });
    };
  }

  // Documents go up first so the application can point at them. One that fails to upload
  // never blocks the registration — the owner can always ask for it again.
  function cloudSend(entry, go) {
    var picks = [];
    [].forEach.call(document.querySelectorAll('#jf input[type=file]'), function (el) {
      if (el.files && el.files[0]) picks.push({ label: el.dataset.label || 'Document', file: el.files[0] });
    });
    if (picks.length) go.textContent = T.uploading;
    var chain = Promise.resolve([]);
    picks.forEach(function (p) {
      chain = chain.then(function (acc) {
        return compress(p.file, /photo/i.test(p.label) ? 600 : 1280).then(function (blob) {
          if (!blob) return acc;
          var mime = blob.type || 'image/jpeg';
          return api({ action: 'doc', app: APP, label: p.label, mime: mime, size: blob.size })
            .then(function (s) {
              return fetch(s.url, { method: 'PUT', headers: { 'Content-Type': mime, 'x-upsert': 'false', apikey: CFG.SUPABASE_ANON_KEY }, body: blob })
                .then(function (r) { if (r.ok) acc.push({ type: p.label, path: s.path }); return acc; });
            })
            .catch(function () { return acc; });
        });
      });
    });
    return chain.then(function (docs) {
      entry.docs = docs;
      go.textContent = T.sending;
      return api({ action: 'submit', app: APP, entry: entry });
    });
  }
  function demoSend(entry) {
    try {
      var k = 'hostelos.demo.signups', list = JSON.parse(localStorage.getItem(k) || '[]');
      list.push(Object.assign({ h: H, at: new Date().toISOString() }, entry));
      localStorage.setItem(k, JSON.stringify(list.slice(-50)));
      return Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }
  function finish(entry) {
    shell('<div class="card" style="text-align:center"><div style="font-size:44px">✅</div>' +
      '<h2 style="margin:6px 0">' + esc(T.done) + '</h2>' +
      '<p><b style="font-size:20px">' + esc(entry.name) + '</b><br><span class="muted">' + esc(entry.phone) + '</span></p>' +
      '<p class="hint" style="margin-top:10px">' + esc(T.doneSub) + '</p></div>');
  }

  if (!/^[0-9a-f-]{36}$/i.test(H) && !/^[\w-]{2,40}$/.test(H)) return fail(T.bad);
  if (!/^[\w-]{12,64}$/.test(K)) return fail(T.bad);
  if (!CLOUD) {
    // No server here, so nothing can be uploaded — but the hostel's own list of required
    // papers is in the demo database, and knowing what to bring is most of the value.
    var demo = null;
    try { demo = JSON.parse(localStorage.getItem('hostelos.demo.v2') || 'null'); } catch (e) { /* ignore */ }
    var dh = demo && (demo.hostels || []).filter(function (x) { return x.id === H; })[0];
    var dset = (dh && dh.settings) || {};
    if (dh) NAME = dh.name;
    PV = { on: ((dset.police || {}).on !== false), state: q.get('s') || (dset.police || {}).state || '' };
    return form({ docs: ((dset.docs || {}).required) || ['Aadhaar card', 'Passport photo'], upload: false });
  }
  api({ action: 'info' }).then(function (d) {
    if (d.name) NAME = d.name;
    PV = { on: !!d.police, state: d.state || '' };
    form(d);
  }).catch(function (e) { fail(e.noServer ? T.noServer : (e.status === 403 ? T.bad : (e.message || T.fail))); });
})();
