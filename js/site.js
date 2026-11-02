// Sarvlekh public hostel page (site.html).
//
// This is the link an owner puts in an advert or sends to a parent: photos, what a bed costs,
// what is included, where it is, the questions everyone asks, and a way to get in touch. No
// login, no install, nothing to sign up for.
//
// The layout is fixed; only the owner's words, prices and photo links change it. Photos are
// plain links the owner pasted (Drive thumbnails are resized to what a phone needs), loaded
// lazily, so the server only ever sends this script, one stylesheet and a small JSON document.
//
// Enquiries are not stored anywhere. The form builds a tidy WhatsApp message and hands it to
// the owner's own WhatsApp, which is where they already answer people — so there is no public
// write path into the database to spam, no inbox to maintain, and no lead to lose.
//
// Written in the same plain style as join.js: this page has to open on a five-year-old phone
// on a bad connection, so no framework and no build step.
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  // Two ways in: the hostel's own address (sarvlekh.in/h/sunrise-boys-pg, rewritten to ?s=)
  // and the raw id, which is what local and demo use before a domain is connected.
  // A rewrite is server-side: the browser's address bar still says /h/sunrise-boys-pg, so the
  // slug has to be read from the path. The ?s= form stays for direct testing.
  var PREVIEW = q.get('preview') === '1', NO_SERVER = false;
  var H = q.get('h') || '';
  var SLUG = q.get('s') || (location.pathname.match(/\/h\/([a-z0-9][a-z0-9-]*)/i) || [])[1] || '';
  var CFG = window.HOSTELOS_CONFIG || {}, CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  var hi = (navigator.language || '').toLowerCase().indexOf('hi') === 0;
  var T = hi ? {
    call: 'कॉल करें', wa: 'WhatsApp पर बात करें', waShort: 'WhatsApp',
    from: 'शुरुआती कीमत', onward: 'से शुरू / महीना', per: 'प्रति बेड / महीना',
    aboutTag: 'हमारे बारे में', welcome: 'स्वागत है', facTag: 'सुविधाएँ', facH: ['हर ज़रूरी चीज़,', 'शामिल'],
    roomsTag: 'कमरे', roomsH: ['कमरे और', 'किराया'], photosTag: 'तस्वीरें', photosH: ['एक झलक', 'अंदर की'],
    whereTag: 'जगह', map: 'रास्ता देखें', faqTag: 'FAQ', faqH: ['आम', 'सवाल'],
    askH: 'पूछताछ भेजें', askHint: 'अपनी जानकारी भरें, हम जल्दी जवाब देंगे।',
    yname: 'आपका नाम', yphone: 'आपका मोबाइल नंबर', ymsg: 'आप क्या जानना चाहते हैं?',
    send: 'WhatsApp पर भेजें',
    need: 'कृपया अपना नाम और 10 अंकों का मोबाइल नंबर भरें।',
    sPrice: 'शुरुआती किराया', sRooms: 'कमरे के प्रकार', sFac: 'सुविधाएँ',
    goneT: 'यह पेज उपलब्ध नहीं है',
    goneD: 'लिंक गलत है या हॉस्टल ने यह पेज बंद कर दिया है। कृपया हॉस्टल से नया लिंक माँगें।',
    noServerT: 'अभी लाइव नहीं है', noServer: 'यह पेज बन चुका है, पर इसे पब्लिश करने वाला सर्वर अभी चालू नहीं है।',
    previewGoneT: 'प्रीव्यू खत्म हो गया', previewGone: 'ऐप में वापस जाकर फिर से “Preview the page” दबाएँ।',
    demoD: 'डेमो मोड — अभी कुछ भी इंटरनेट पर नहीं है। डेमो डेटा सिर्फ़ उसी ब्राउज़र में सेव रहता है जिसमें ऐप चलाया गया था, इसलिए यह लिंक किसी दूसरे ब्राउज़र या फ़ोन पर नहीं खुलेगा। ऐप को Supabase और अपने डोमेन पर डालते ही यही लिंक सबके लिए काम करने लगेगा।',
    previewTag: 'प्रीव्यू — यह सिर्फ़ आपको दिख रहा है',
    hello: 'नमस्ते! मैंने आपका पेज देखा।', iam: 'मैं', ph: 'मोबाइल', by: 'Sarvlekh से बना',
  } : {
    call: 'Call Now', wa: 'Chat on WhatsApp', waShort: 'WhatsApp',
    from: 'Starting from', onward: 'onwards / month', per: 'per bed / month',
    aboutTag: 'About Us', welcome: 'Welcome to', facTag: 'Facilities', facH: ['Everything You Need,', 'Included'],
    roomsTag: 'Rooms', roomsH: ['Rooms &', 'Pricing'], photosTag: 'Gallery', photosH: ['A Look', 'Inside'],
    whereTag: 'Our Location', map: 'Get Directions', faqTag: 'FAQs', faqH: ['Common', 'Questions'],
    askH: 'Send an Enquiry', askHint: 'Fill in your details and we’ll get back to you shortly.',
    yname: 'Your Name', yphone: 'Your Mobile Number', ymsg: 'What would you like to know?',
    send: 'Send on WhatsApp',
    need: 'Please enter your name and a 10-digit mobile number.',
    sPrice: 'Starting price', sRooms: 'Room types', sFac: 'Facilities',
    goneT: 'This page is not available',
    goneD: 'The link may be wrong, or the hostel has taken the page down. Please ask them for a new link.',
    noServerT: 'Not live yet', noServer: 'This hostel page is set up, but the server that publishes it is not running yet.',
    previewGoneT: 'This preview has expired', previewGone: 'Go back to the app and press “Preview the page” again.',
    demoD: 'Demo mode — nothing is on the internet yet. Demo data is saved inside the one browser the app was set up in, so this link will not open in another browser or on a phone. Put the app on Supabase and your own domain and the same link starts working for everyone.',
    previewTag: 'Preview — only you can see this',
    hello: 'Hello! I saw your hostel page.', iam: 'I am', ph: 'Mobile', by: 'Made with Sarvlekh',
  };

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ten = function (s) { return String(s || '').replace(/\D/g, '').slice(-10); };
  var inr = function (n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); };
  var root = document.getElementById('site');
  var waLink = function (num, text) { return 'https://wa.me/91' + ten(num) + (text ? '?text=' + encodeURIComponent(text) : ''); };
  var safeHref = function (u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; };

  var SLOTS = ['cover', 'room', 'bath', 'mess', 'common', 'outside'];
  // A Google Drive share link points at Drive's viewer page, not at the picture. The file id
  // inside it is what matters, and Drive's thumbnail endpoint serves that id as a real image.
  // Kept identical to imgUrl() in js/domain.js, so what the owner previewed is what ships.
  var DRIVE_ID = /(?:drive\.google\.com\/(?:file\/d\/|(?:uc|open|thumbnail)\?(?:[^\s]*&)?id=)|lh3\.googleusercontent\.com\/d\/)([\w-]{16,})/;
  function imgUrl(raw, width) {
    var u = String(raw == null ? '' : raw).trim();
    if (!u) return '';
    var m = u.match(DRIVE_ID);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w' + (width || 1600);
    return /^https?:\/\//i.test(u) ? u : '';
  }
  var slugify = function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, ''); };
  var slugOf = function (h) { return (((h.settings || {}).site || {}).slug || '').trim() || slugify(h.name); };

  /* ---------- icons: small drawn paths, written inline where used ---------- */
  var ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
    snow: '<path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5L4.9 17.5M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"/>',
    food: '<path d="M7 2v7a2 2 0 0 0 2 2v11M11 2v7a2 2 0 0 1-2 2M17 22V2c-2 1.2-3.5 4-3.5 8 0 2 1.5 3 3.5 3"/>',
    bed: '<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11" r="2"/>',
    wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0"/><circle cx="12" cy="19.5" r=".8"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    cam: '<path d="M3 8l12-4 1.5 4.5L4.5 12.5zM9 11l1.5 6M7 20h7M16 6.5l5 1.5"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    wash: '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><path d="M8 6h.01M11.5 6h.01"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    book: '<path d="M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4z"/><path d="M12 5v15"/>',
    park: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9.5 17V8H13a2.5 2.5 0 0 1 0 5H9.5"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
    gym: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    chat: '<path d="M20 11.5A8.5 8.5 0 0 1 7.6 19L3 20.5 4.5 16A8.5 8.5 0 1 1 20 11.5z"/><path d="M9.3 8.6c.3 2.6 2.7 5 5.4 5.4l1.1-1.2-2-1-.9.7a4 4 0 0 1-1.8-1.8l.7-.9-1-2z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    plane: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><path d="M16 5a3 3 0 0 1 0 6M18 14c2 .7 3 2.6 3 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevl: '<path d="M15 5l-7 7 7 7"/>',
    chevr: '<path d="M9 5l7 7-7 7"/>',
    ext: '<path d="M7 17L17 7M9 7h8v8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    msg: '<path d="M4 5h16v11H9l-5 4z"/>',
    gpin: '<path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="#ea4335" stroke="none"/><circle cx="12" cy="9" r="2.7" fill="#fff" stroke="none"/>',
  };
  // Icons are written inline, not through <use href="#id">: a bare #fragment reference is fragile on a page that is also served from /h/<name>.
  var ico = function (k, cls) { return '<svg class="ico' + (k === 'gpin' ? ' gpin' : '') + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[k] || ICONS.check) + '</svg>'; };
  // Which picture suits a facility the owner typed in their own words.
  var FAC_ICON = [
    [/\bac\b|a\/c|air.?cond|cooler|cooling/, 'snow'], [/meal|food|mess|breakfast|lunch|dinner|tiffin|kitchen/, 'food'],
    [/wi-?fi|internet|broadband/, 'wifi'], [/cctv|camera|surveil/, 'cam'], [/secur|guard|safe|gate/, 'shield'],
    [/power|backup|inverter|generator|electric/, 'bolt'], [/laundry|washing|clothes/, 'wash'],
    [/housekeep|clean|hygien|sanit/, 'spark'], [/washroom|bath|toilet|geyser|water|\bro\b|hot/, 'drop'],
    [/study|library|desk|reading/, 'book'], [/park/, 'park'], [/\btv\b|television/, 'tv'], [/gym|fitness/, 'gym'],
    [/bed|mattress|cot|furnish|room|cupboard|wardrobe/, 'bed'],
  ];
  function facIcon(label) {
    var s = String(label || '').toLowerCase();
    for (var i = 0; i < FAC_ICON.length; i++) if (FAC_ICON[i][0].test(s)) return FAC_ICON[i][1];
    return 'check';
  }

  function gone() {
    var title = PREVIEW ? T.previewGoneT : NO_SERVER ? T.noServerT : T.goneT;
    var why = PREVIEW ? T.previewGone : NO_SERVER ? T.noServer : (CLOUD ? T.goneD : T.demoD);
    root.innerHTML = '<div class="s-gone"><b>' + esc(title) + '</b><p>' + esc(why) + '</p></div>';
  }

  // Demo mode has no server, so the page reads the same local database the demo app writes to.
  // It lets the whole thing — edit, publish, open the link — be tried on one machine.
  function demoLoad() {
    var db; try { db = JSON.parse(localStorage.getItem('hostelos.demo.v2') || 'null'); } catch (e) { return null; }
    if (!db) return null;
    var h = (db.hostels || []).filter(function (x) { return H ? x.id === H : slugOf(x) === SLUG; })[0];
    if (!h || h.status !== 'active') return null;
    // the same four gates the server checks, so demo mode behaves like the real thing
    var o = (db.orgs || []).filter(function (x) { return x.id === h.org_id; })[0];
    if (!o || o.status !== 'active') return null;
    if ((o.modules || {}).landing === false || (h.modules || {}).landing === false) return null;
    var cfg = (h.settings || {}).site || {};
    if (cfg.on !== true) return null;
    return { name: h.name, city: h.city || '', address: h.address || '', phone: h.phone || '', site: cfg };
  }

  function load() {
    // Handed over by the owner's own screen, so unsaved-but-entered content is visible and no
    // server is involved. Read once, then dropped so a stale copy cannot resurface later.
    if (PREVIEW) {
      var raw = null;
      try { raw = JSON.parse(localStorage.getItem('hostelos.sitepreview') || 'null'); localStorage.removeItem('hostelos.sitepreview'); } catch (e) { /* ignore */ }
      if (raw && raw.name && Date.now() - (raw.at || 0) < 5 * 60e3) return Promise.resolve(raw);
      return Promise.resolve(null);
    }
    if (!H && !SLUG) return Promise.resolve(null);
    if (!CLOUD) return Promise.resolve(demoLoad());
    // GET, so the CDN can answer repeat readers without running the function
    return fetch('/api/public/site?' + (H ? 'h=' + encodeURIComponent(H) : 's=' + encodeURIComponent(SLUG)))
      .then(function (r) {
        return r.text().then(function (txt) {
          var d = null; try { d = JSON.parse(txt); } catch (e) { /* not our endpoint */ }
          if (r.ok) return d;
          // a closed gate answers in JSON; a missing endpoint does not, and the two deserve
          // different words — one is "no such page", the other is "nothing is serving it"
          if (!d) NO_SERVER = true;
          return null;
        });
      })
      .catch(function () { NO_SERVER = true; return null; });
  }

  // A section heading: a small label pill, then a title whose second half is gold.
  function head(tag, h, icon) {
    var a = Array.isArray(h) ? h[0] : '', b = Array.isArray(h) ? h[1] : h;
    return '<span class="tag">' + (icon ? ico(icon) : '') + esc(tag) + '</span><h2 class="h2">' + (a ? esc(a) + ' ' : '') + '<em>' + esc(b) + '</em></h2>';
  }
  // "Luxury AC Boys PG in Tonk Phatak, Jaipur": everything after "in" is the place, in gold.
  function heroTitle(d, c) {
    var h = String(c.headline || '').trim();
    if (!h) return esc(d.name);
    var m = h.match(/^(.*?\sin\s)(.+)$/i);
    return m ? esc(m[1]) + '<br><em>' + esc(m[2]) + '</em>' : esc(h);
  }
  var firstSentence = function (s) { s = String(s || '').replace(/\s+/g, ' ').trim(); var m = s.match(/^.{20,150}?[.!?।](\s|$)/); return m ? m[0].trim() : s.slice(0, 150); };
  // "All Meals (Breakfast, Lunch & Dinner)" → a bold line and a small one under it.
  function facParts(x) { var m = String(x).match(/^(.*?)\s*\((.*)\)\s*$/); return m && m[1] ? [m[1], m[2]] : [String(x), '']; }

  // Photo slots. Pages saved before the slots were renamed keep working through OLD.
  var OLD = { hero: 'cover', about: 'outside', g1: 'room', g2: 'mess', g3: 'bath', g4: 'common' };
  function pic(pics, k, w) { return imgUrl(pics[k] || pics[OLD[k]], w); }

  // Where "Get Directions" goes. Exact coordinates (typed, or found inside a long Google Maps
  // link) open Google Maps already navigating; failing that the owner's own link; failing that
  // the address, which Maps looks up itself.
  function coordsOf(c) {
    var s = String(c.mapLatLng || '').replace(/\s+/g, ''), m = s.match(/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) return m[1] + ',' + m[2];
    var u = String(c.mapUrl || '');
    m = u.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) || u.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/) || u.match(/[?&](?:q|query|destination|ll)=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
    return m ? m[1] + ',' + m[2] : '';
  }
  function navUrl(d, c, address) {
    var ll = coordsOf(c), dir = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=';
    if (ll) return dir + encodeURIComponent(ll);
    if (safeHref(c.mapUrl)) return safeHref(c.mapUrl);
    var where = [d.name, address, d.city].filter(Boolean).join(', ');
    return address ? dir + encodeURIComponent(where) : '';
  }

  // A drawn street map: nothing to download and no map service to call. The Directions button
  // beside it is the real thing; a picture in the "map" slot replaces this drawing.
  var MAP_SVG = '<svg viewBox="0 0 190 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="190" height="100" fill="#e9eef0"/>' +
    '<path d="M0 78l60-14 40 6 50-18 40 4v44H0z" fill="#dfe8dc"/><rect x="118" y="6" width="38" height="22" rx="3" fill="#dfe8dc"/>' +
    '<g fill="none" stroke="#fff" stroke-linecap="round"><path d="M-5 30L200 22M-5 58l205-6M20 -5l10 110M70 -5l-6 110M118 -5l8 110M165 -5l-4 110" stroke-width="4"/>' +
    '<path d="M-5 14L200 8M-5 44l205-6M-5 74l205-7M45 -5l4 110M95 -5l-2 110M142 -5l2 110" stroke-width="2"/></g>' +
    '<path d="M-5 66C50 60 90 52 200 36" fill="none" stroke="#f7e3a8" stroke-width="3.5" stroke-linecap="round"/></svg>';

  function render(d) {
    var c = d.site || {};
    var pics = c.photos || {};
    var rt = c.roomTypes || [], fac = c.facilities || [], faq = c.faq || [];
    var num = ten(c.wa) || ten(d.phone), callNo = ten(c.callNo) || num;
    // "Talwandi, Kota" and a city of "Kota" is one place, not two.
    var city = d.city && (c.area || '').toLowerCase().indexOf(String(d.city).toLowerCase()) < 0 ? d.city : '';
    var place = [c.area, city].filter(Boolean).join(', ');
    var address = String(c.address || d.address || '').trim();
    var go = navUrl(d, c, address);
    document.title = d.name + (place ? ' · ' + place : '');
    var md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute('content', (d.name + (place ? ' in ' + place : '') + ': rooms, rent, facilities, photos and location. Enquire on WhatsApp.').slice(0, 160));

    var prices = rt.map(function (x) { return +x.price || 0; }).filter(function (n) { return n > 0; });
    var cheapest = prices.length ? Math.min.apply(null, prices) : 0;

    var logo = imgUrl(pics.logo, 160);
    var hero = pic(pics, 'hero', 1000) || pic(pics, 'g1', 1000);
    var aboutPic = pic(pics, 'about', 800);
    var gal = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map(function (k) { return pic(pics, k, 700); }).filter(Boolean);
    var mapPic = imgUrl(pics.map, 700);
    var tagline = c.tagline || place;
    var hasLoc = !!(place || address || go);
    var rating = c.ratingScore ? { score: c.ratingScore, text: c.ratingText } : (c.rating && c.rating.score ? c.rating : null);

    var html = '';
    // Nothing on this page links to anywhere else on the site (a bare "#top" link on a page served from /h/<name> would land on the app). Only phone, WhatsApp and Maps open.
    html += '<div class="hero-box"><header class="top"><div class="wrap">' +
      '<div class="brand">' + (logo ? '<img class="logo" src="' + esc(logo) + '" alt="" decoding="async">' : ico('home')) +
      '<div style="min-width:0"><b>' + esc(d.name) + '</b>' + (tagline ? '<small>' + esc(tagline) + '</small>' : '') + '</div></div>' +
      (callNo ? '<a class="tel" href="tel:+91' + esc(callNo) + '" aria-label="' + esc(T.call) + '">' + ico('phone') + '</a>' : '') +
      '</div></header>';

    // hero
    html += '<section class="hero' + (hero ? '' : ' nopic') + '">' +
      (hero ? '<img class="bg" src="' + esc(hero) + '" alt="" fetchpriority="high" decoding="async">' : '') +
      '<div class="wrap"><div class="copy">' +
      (c.badge || place ? '<span class="badge">' + ico('crown') + esc(c.badge || place) + '</span>' : '') +
      '<h1>' + heroTitle(d, c) + '</h1>' +
      (c.sub || (c.headline && c.about) ? '<p class="sub">' + esc(c.sub || firstSentence(c.about)) + '</p>' : '') +
      (fac.length ? '<div class="pills">' + fac.slice(0, 3).map(function (x) { return '<span>' + ico(facIcon(x)) + esc(facParts(x)[0]) + '</span>'; }).join('') + '</div>' : '') +
      (cheapest ? '<div class="from">' + esc(T.from) + '<div class="p"><b>' + esc(inr(cheapest)) + '</b><span>' + esc(T.onward) + '</span></div></div>' : '') +
      (num ? '<div class="cta"><a class="b gold" href="' + esc(waLink(num, T.hello)) + '" target="_blank" rel="noopener noreferrer">' + ico('chat') + '<span>' + esc(T.wa) + '</span></a></div>' : '') +
      '</div></div></section></div><main class="wrap">';

    // about
    if (c.about || aboutPic) {
      html += '<section class="sec"><div class="ab' + (aboutPic ? '' : ' solo') + '">' +
        (aboutPic ? '<img class="ab-pic" src="' + esc(aboutPic) + '" alt="" loading="lazy" decoding="async">' : '') +
        '<div class="ab-txt"><div><span class="tag">' + esc(T.aboutTag) + '</span><h2 class="h2">' + esc(c.aboutTitle || (T.welcome + ' ' + d.name)) + '</h2>' +
        (c.about ? '<p class="body">' + esc(c.about) + '</p>' : '') + '</div>' +
        (rating ? '<div class="rate"><span class="g">G</span><div><b>' + esc(rating.score) + '/5</b><span class="st">★★★★★</span>' +
          (rating.text ? '<small>' + esc(rating.text) + '</small>' : '') + '</div></div>' : '') +
        '</div></div></section>';
    }
    if (fac.length) {
      html += '<section><div class="fac-card"><div>' + head(T.facTag, T.facH) + '</div><div class="fac">' + fac.map(function (x) {
        var p = facParts(x), k = facIcon(x);
        return '<div><span class="ic">' + ico(k, k === 'snow' || k === 'bolt' ? 'hi' : '') + '</span><span>' + esc(p[0]) + (p[1] ? '<small>(' + esc(p[1]) + ')</small>' : '') + '</span></div>';
      }).join('') + '</div></div></section>';
    }
    if (rt.length) {
      html += '<section class="sec">' + head(T.roomsTag, T.roomsH) + '<div class="rooms">' + rt.map(function (x) {
        return '<div class="room"><div class="row"><b>' + esc(x.l) + '</b>' +
          '<div><span class="price">' + esc(inr(x.price)) + '</span><span class="per">' + esc(T.per) + '</span></div></div>' +
          (x.note ? '<div class="note">' + esc(x.note) + '</div>' : '') + '</div>';
      }).join('') + '</div></section>';
    }
    if (gal.length) {
      html += '<section class="sec gal-s"><span class="tag">' + esc(T.photosTag) + '</span><div class="car">' +
        '<button class="go l" type="button" aria-label="Previous">' + ico('chevl') + '</button>' +
        '<div class="rail">' + gal.map(function (u) { return '<img src="' + esc(u) + '" alt="" loading="lazy" decoding="async">'; }).join('') + '</div>' +
        '<button class="go r" type="button" aria-label="Next">' + ico('chevr') + '</button></div><div class="dots"></div></section>';
    }

    // Numbers that are true by construction (the owner's own data, counted) unless the owner gave their own.
    var SI = ['users', 'shield', 'food', 'bed'];
    var st = (c.stats && c.stats.length ? c.stats.slice(0, 4).map(function (x, i) { return [x.v, x.l, x.i || SI[i]]; }) : [
      cheapest ? [inr(cheapest), T.sPrice, 'bed'] : null, rt.length ? [String(rt.length), T.sRooms, 'home'] : null, fac.length ? [String(fac.length), T.sFac, 'shield'] : null,
    ].filter(Boolean));
    if (st.length > 1) {
      html += '<div class="stats n' + st.length + '" style="--n:' + st.length + '">' + st.map(function (x) { return '<div>' + ico(ICONS[x[2]] ? x[2] : 'check') + '<span><b>' + esc(x[0]) + '</b><small>' + esc(x[1]) + '</small></span></div>'; }).join('') + '</div>';
    }

    var left = '', right = '';
    if (hasLoc) {
      var mapInner = mapPic ? '<img src="' + esc(mapPic) + '" alt="" loading="lazy" decoding="async">' : MAP_SVG + '<span class="lbl">' + ico('pin') + '<span>' + esc(d.name) + '</span></span>';
      left += '<section class="sec"><div class="loc' + (go ? '' : ' solo') + '"><div class="loc-t">' + head(T.whereTag, place || d.name, 'pin').replace('<em>', '<span>').replace('</em>', '</span>') +
        (address ? '<p>' + esc(address) + '</p>' : '') +
        (go ? '<a class="b white" href="' + esc(go) + '" target="_blank" rel="noopener noreferrer">' + ico('gpin') + '<span>' + esc(T.map) + '</span>' + ico('ext') + '</a>' : '') + '</div>' +
        (go ? '<a class="map" href="' + esc(go) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc((mapPic ? '' : d.name + ' - ') + T.map) + '">' + mapInner + '</a>' : '') + '</div></section>';
    }
    if (faq.length) {
      left += '<section class="sec faq-s"><span class="tag">' + esc(T.faqTag) + '</span><h2 class="h2">' + esc(T.faqH.join(' ')) + '</h2><div class="faq">' + faq.map(function (x) {
        return '<details><summary>' + esc(x.q) + '</summary><div class="a">' + esc(x.a) + '</div></details>';
      }).join('') + '</div></section>';
    }
    if (num) {
      right = '<section class="enq"><h2>' + ico('plane') + esc(T.askH) + '</h2><p class="sb">' + esc(T.askHint) + '</p>' +
        '<form id="ef" novalidate>' +
        '<div class="in"><label for="e_name">' + esc(T.yname) + '</label>' + ico('user') + '<input id="e_name" type="text" maxlength="60" autocomplete="name" placeholder="' + esc(T.yname) + '"></div>' +
        '<div class="in"><label for="e_phone">' + esc(T.yphone) + '</label>' + ico('phone') + '<input id="e_phone" type="tel" inputmode="tel" maxlength="14" autocomplete="tel" placeholder="' + esc(T.yphone) + '"></div>' +
        '<div class="in"><label for="e_msg">' + esc(T.ymsg) + '</label>' + ico('msg') + '<textarea id="e_msg" maxlength="400" placeholder="' + esc(T.ymsg) + '"></textarea></div>' +
        '<div class="err" id="e_err"></div>' +
        '<button class="b gold" type="submit">' + ico('chat') + esc(T.send) + '</button></form></section>';
    }
    html += '<div class="bot"><div class="bl">' + left + '</div><div class="br">' + right + '</div></div>';
    html += '</main><div class="s-foot">' + esc(T.by) + '</div>';
    if (num) {
      html += '<a class="fl" href="' + esc(waLink(num, T.hello)) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(T.waShort) + '">' + ico('chat') + '</a>';
    }
    root.innerHTML = PREVIEW ? '<div class="s-prev">' + esc(T.previewTag) + '</div>' + html : html;
    wire(num);
  }

  // The gallery: two pictures at a time, sliding by itself every few seconds and by hand
  // (swipe, or the arrows). Any touch pauses the sliding for a while so it never fights a thumb.
  function slider(car) {
    var rail = car.querySelector('.rail'), dots = root.querySelector('.dots'), imgs = rail.querySelectorAll('img');
    var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var hold = 0, seen = true;
    var step = function () { return imgs.length > 1 ? imgs[1].offsetLeft - imgs[0].offsetLeft : (imgs[0] ? imgs[0].offsetWidth : 1) || 1; };
    var count = function () { var max = rail.scrollWidth - rail.clientWidth; return max < 4 ? 1 : Math.round(max / step()) + 1; };
    var at = function () { return Math.min(count() - 1, Math.max(0, Math.round(rail.scrollLeft / step()))); };
    var to = function (i) { rail.scrollTo({ left: i * step(), behavior: calm ? 'auto' : 'smooth' }); };
    var paint = function () {
      var n = count();
      car.classList.toggle('static', n < 2);
      if (dots.children.length !== n) dots.innerHTML = new Array(n + 1).join('<i></i>');
      var on = at();
      for (var i = 0; i < dots.children.length; i++) dots.children[i].className = i === on ? 'on' : '';
    };
    var pause = function () { hold = Date.now() + 7000; };
    car.querySelector('.go.l').addEventListener('click', function () { pause(); to(at() === 0 ? count() - 1 : at() - 1); });
    car.querySelector('.go.r').addEventListener('click', function () { pause(); to(at() >= count() - 1 ? 0 : at() + 1); });
    ['pointerdown', 'touchstart', 'wheel', 'mouseenter', 'focusin'].forEach(function (ev) { car.addEventListener(ev, pause, { passive: true }); });
    rail.addEventListener('scroll', paint, { passive: true });
    window.addEventListener('resize', paint);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { seen = e[0].isIntersecting; }).observe(car);
    if (!calm) setInterval(function () { if (!seen || document.hidden || Date.now() < hold || count() < 2) return; to(at() >= count() - 1 ? 0 : at() + 1); }, 3500);
    paint(); setTimeout(paint, 500);
  }

  function wire(num) {
    var car = root.querySelector('.car');
    if (car) slider(car);
    var f = document.getElementById('ef');
    if (!f) return;
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = document.getElementById('e_name').value.trim();
      var phone = ten(document.getElementById('e_phone').value);
      var msg = document.getElementById('e_msg').value.trim();
      var err = document.getElementById('e_err');
      if (!name || phone.length !== 10) { err.textContent = T.need; return; }
      err.textContent = '';
      var text = T.hello + '\n' + T.iam + ' ' + name + '.\n' + T.ph + ': ' + phone + (msg ? '\n\n' + msg : '');
      window.open(waLink(num, text), '_blank', 'noopener');
    });
  }

  load().then(function (d) { if (d && d.name) render(d); else gone(); }).catch(gone);
})();
