'use strict';
/* Owner / manager screens: home, approvals, rooms, residents, payments, electricity, expenses, reports, notices, automation. */

const resOpts = (list = activeRes()) => list.slice().sort(by('name')).map(r => ({ v: r.id, l: resLabel(r) }));
const person = (r, sub) => `<div class="person">${avatar(r.name)}<div style="min-width:0"><b><button class="linkish" data-act="go" data-to="residents/${r.id}">${esc(r.name)}</button></b><small>${sub ?? ''}</small></div></div>`;
// hostelName is defined globally in js/domain.js
/* The "read the meter now" box, asked at every check-in, check-out and room shift while the
 * electricity module is on. It is required: the reading closes the current stretch, so whoever
 * was in the room pays for exactly the units used until today, and the next normal reading
 * starts fresh from it. */
function meterField(roomId, name = 'meterNow', label = 'Meter reading now') {
  const hint = moveReadingHint(roomId);
  if (!hint) return [];
  const who = !hint.last ? t('This room has no reading yet, so this becomes its starting point.')
    : !hint.names.length ? t('The room was empty, so nothing before today lands on the new resident.')
      : hint.names.length === 1 ? t('{n} then pays only up to today.', { n: hint.names[0] })
        : t('{n} then pay only up to today.', { n: listNames(hint.names) });
  return [{
    name, label, type: 'number', min: 0, required: true, step: 0.1,
    hint: (hint.last ? t('Last reading {u} on {d}.', { u: num(hint.last.curr), d: fmtShort(hint.last.date) }) + ' ' : '') + who,
    info: t('Electricity is split between the readings on either side of it. Taking one now ends the current stretch and starts a fresh one, so everybody pays for the units they actually used, and free units are counted only for the days they stayed.')
  }];
}
const listNames = a => (a.length < 2 ? a[0] || '' : a.slice(0, -1).join(', ') + ' ' + t('and') + ' ' + a[a.length - 1]);
/* Every "choose a bed" list in the app, built once. With blocks switched on the options are
 * ordered and headed by block, which is how the owner sees — and decides — which wing the
 * resident is going into, without a second question to answer. */
function bedOptions(vac, label) {
  const grp = blocksOn();
  const list = grp ? vac.slice().sort((a, b) => blockOrder(roomBlock(a.room)) - blockOrder(roomBlock(b.room))) : vac;
  return list.map(x => ({ v: `${x.room.id}|${x.bed.id}`, l: label(x), ...(grp ? { g: blockName(roomBlock(x.room)) } : {}) }));
}

/* ===================================================================== home */
PAGES.home = {
  title: 'Home', mod: 'home',
  render() {
    const ym = ymOf(today()), occ = occupancy();
    const collected = sum(payments().filter(p => ymOf(p.date) === ym && p.mode !== 'deposit'), p => p.amount);
    const dues = dueList(), dueTot = sum(dues, x => x.due), overdue = dues.filter(x => x.od > 0);
    const inbox = inboxItems();
    const hr = new Date().getHours(), hello = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const nextMeal = meals().find(m => nowMinutes() < minutes(m.time)) || meals()[0];
    const hc = can('mess') ? headcount(today(), nextMeal.k) : null;
    const hkT = hkTasks().filter(x => x.date === today()), hkDone = hkT.filter(x => x.status === 'done').length;
    const low = can('kitchen') ? items().filter(it => stockInfo(it).low) : [];
    const qa = [
      ['checkin', 'Check-in', 'userplus', '', 'rooms'], ['pay', 'Record payment', 'rupee', 'ok', 'payments'], ['reading', 'Meter reading', 'bolt', 'warn', 'electricity'], ['remindall', 'Send reminders', 'wa', 'ok', 'payments'],
      ['ldrecv', 'Laundry', 'shirt', 'info', 'laundry'], ['addexp', 'Add expense', 'wallet', 'pink', 'expenses'], ['addnotice', 'Notice', 'megaphone', 'teal', 'notices'], ['go', 'Cleaning', 'broom', 'mute', 'housekeeping'],
    ].filter(x => can(x[4]));
    const months = [...Array(6)].map((_, i) => addMonths(ym, i - 5));
    return `${head(t(hello) + (Store.me ? ', ' + Store.me.full_name.split(' ')[0] : ''), `${fmtDate(today())} · ${esc(hostelName())}`)}
      <div class="grid g4 keep2">
        ${kpi('Collected this month', inr(collected), `${dues.length ? t('{n} residents still owe', { n: dues.length }) : t('All clear')}`, 'ok', 'payments', 'rupee')}
        ${kpi('Pending dues', inr(dueTot), overdue.length ? t('{n} overdue', { n: overdue.length }) : t('Nothing overdue'), dueTot ? 'bad' : '', 'payments', 'alert')}
        ${kpi('Occupancy', occ.pct + '%', t('{a} of {b} beds · {v} vacant', { a: occ.occ, b: occ.total, v: occ.vac }), '', 'rooms', 'bed')}
        ${hc ? kpi(`${mealName(nextMeal.k)} ${t('today')}`, hc.eat, t('{s} skipped · {l} on leave · {f} tiffin', { s: hc.skip, l: hc.leave, f: hc.tiffin }), '', 'mess', 'utensils') : kpi('Approvals', inbox.length, t('waiting for you'), inbox.length ? 'warn' : '', 'inbox', 'inbox')}
      </div>
      <div class="group-t">${esc(t('Quick actions'))}</div>
      <div class="qa">${qa.map(([act, l, icn, col, mod]) => `<button data-act="${act}" ${act === 'go' ? `data-to="${mod}"` : ''}><span class="ic" style="${col ? `background:var(--${col === 'pink' ? 'bad' : col === 'teal' ? 'info' : col === 'mute' ? 'muted' : col})` : ''}">${ico(icn)}</span>${esc(t(l))}</button>`).join('')}</div>
      <div class="grid g-main" style="margin-top:6px">
        <div class="stack">
          ${group('Needs your attention', inbox.slice(0, 6).map(x => li({ icon: x.icon, ic: x.ic, t: x.t, d: x.d, act: 'go', attrs: 'data-to="inbox"' })).join('') || li({ icon: 'check', ic: 'ok', t: t('All clear'), d: t('Nothing is waiting for you.') }), inbox.length > 6 ? `<a href="/inbox">${esc(t('See all {n}', { n: inbox.length }))}</a>` : '')}
          ${can('payments') ? `<div class="card"><h3>${esc(t('Income vs expenses'))}<span class="sp"></span><small>${esc(t('last 6 months'))}</small>${blockScope() ? tip(esc(t('Payments are shown for the block you are looking at. Expenses — gas, salaries, internet — are recorded for the whole hostel and are not split between blocks.'))) : ''}</h3>${barChart(months.map(m => fmtYM(m).split(' ')[0]), [months.map(m => sum(payments().filter(p => ymOf(p.date) === m && p.mode !== 'deposit'), p => p.amount)), months.map(m => sum(Store.all('exp').filter(x => ymOf(x.date) === m), x => x.amount))], ['#34c759', '#ff9500'])}<div class="legend"><span><i style="background:#34c759"></i>${esc(t('Income'))}</span><span><i style="background:#ff9500"></i>${esc(t('Expenses'))}</span></div></div>` : ''}
        </div>
        <div class="stack">
          ${can('housekeeping') && hkT.length ? `<div class="card"><h3>${esc(t('Cleaning today'))}<span class="sp"></span><small>${hkDone}/${hkT.length}</small></h3><div class="bar ok"><i style="width:${pct(hkDone, hkT.length)}%"></i></div><div class="row" style="margin-top:10px">${badge(t('{n} pending', { n: hkT.filter(x => x.status === 'pending').length }), 'info')}${hkT.some(x => x.status === 'missed') ? badge(t('{n} missed', { n: hkT.filter(x => x.status === 'missed').length }), 'bad') : ''}</div></div>` : ''}
          ${hc ? `<div class="card"><h3>${esc(t('Kitchen'))}<span class="sp"></span><a class="sm" href="/mess">${esc(t('Open'))}</a></h3><dl class="kv">${meals().map(m => { const h = headcount(today(), m.k); return `<dt>${esc(mealName(m.k))}</dt><dd>${h.eat} ${esc(t('plates'))}${h.tiffin ? ` · ${h.tiffin} ${esc(t('tiffin'))}` : ''}</dd>`; }).join('')}</dl>${low.length ? `<div class="note warn" style="margin:12px 0 0">${ico('alert', 'sm')} ${esc(t('Low stock'))}: ${esc(low.map(i => i.name).join(', '))}</div>` : ''}</div>` : ''}
          ${group('Top dues', dues.slice(0, 5).map(x => li({ lead: avatar(x.r.name), t: x.r.name, d: `${roomName(x.r.roomId)} · ${x.od ? t('overdue') + ' ' + inr(x.od) : t('due')}`, end: `<b class="${x.od ? 'bad-t' : ''}">${inr(x.due)}</b>`, act: 'go', attrs: `data-to="residents/${x.r.id}"` })).join('') || li({ icon: 'check', ic: 'ok', t: t('No dues') }))}
        </div>
      </div>`;
  },
};

/* ===================================================================== approvals inbox */
PAGES.inbox = {
  title: 'Approvals', mod: 'inbox',
  render() {
    const list = inboxItems();
    const acts = x => ({
      claim: `${btn('View', 'claimview', `data-id="${x.id}"`, 'sm')}${btn('Approve', 'claimok', `data-id="${x.id}"`, 'sm ok', 'check')}`,
      signup: btn('Review', 'signupview', `data-id="${x.id}"`, 'sm primary'),
      pr: btn('Review', 'prview', `data-id="${x.id}"`, 'sm primary'),
      meter: `${btn('View', 'meterview', `data-id="${x.id}"`, 'sm')}${btn('Reject', 'meterreject', `data-id="${x.id}"`, 'sm bad')}${btn('Bill it', 'meterok', `data-id="${x.id}"`, 'sm ok')}`,
      dep: btn('Mark refunded', 'depok', `data-id="${x.id}"`, 'sm ok'),
      cmp: btn('Open', 'go', 'data-to="complaints"', 'sm'),
      hk: `${btn('Reassign', 'hkreassign', `data-id="${x.id}"`, 'sm')}${btn('OK', 'hkack', `data-id="${x.id}"`, 'sm')}`,
      mbill: btn('Send', 'mbillsend', '', 'sm ok', 'wa'),
      remind: btn('Send', 'remindsend', '', 'sm ok', 'wa'),
      pv: `${btn('Open resident', 'go', `data-to="residents/${x.id}"`, 'sm')}${btn('Update', 'pvstatus', `data-id="${x.id}"`, 'sm primary')}`,
      rinfo: btn('Open', 'go', 'data-to="complaints"', 'sm'),
    }[x.k] || '');
    return `${head('Approvals', t('Only the things that need a human. Everything else runs automatically.'))}
      ${list.length ? `<div class="group">${list.map(x => {
      const primaryAct = {
        claim: 'claimview',
        signup: 'signupview',
        pv: 'pvstatus',
        meter: 'meterview',
        pr: 'prview',
        dep: 'depok',
        cmp: 'go',
        hk: 'hkack',
        mbill: 'mbillsend',
        remind: 'remindsend',
        rinfo: 'go'
      }[x.k] || 'claimview';
      const toAttr = (x.k === 'cmp' || x.k === 'rinfo') ? 'data-to="complaints"' : '';
      return `<div class="li" style="cursor:pointer" data-act="${primaryAct}" data-id="${x.id}" ${toAttr}><span class="ic ${x.ic}">${ico(x.icon)}</span><span class="body"><span class="t">${esc(x.t)}</span><span class="d">${esc(x.d)} · ${esc(ago(x.ts || nowIso()))}</span></span><span class="end">${acts(x)}</span></div>`;
    }).join('')}</div>` : `<div class="card">${empty('All clear 🎉', 'Nothing needs your approval right now.')}</div>`}`;
  },
};
A.claimview = el => {
  const c = Store.get(el.dataset.id);
  if (!c) return toast(t('Payment claim not found'), 'bad');
  const r = resById(c.resId);
  const refInfo = c.utr ? classifyPaymentRef(c.utr) : null;
  const docs = r && r.docs && r.docs.length
    ? `<div style="margin-top:12px"><b>${esc(t('Resident ID / KYC:'))}</b><div class="row" style="gap:8px;margin-top:6px">${r.docs.map(d => `<a href="${d.path || '#'}" target="_blank" rel="noopener" class="btn xs ghost">${ico('file', 'sm')} ${esc(t(d.type || 'Document'))}</a>`).join('')}</div></div>`
    : '';
  const ssHtml = c.proofUrl
    ? `<div style="margin-top:12px"><b>${esc(t('Payment Screenshot:'))}</b><br><a href="${c.proofUrl}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px"><img src="${c.proofUrl}" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid var(--line);object-fit:contain" alt="Payment proof"><div class="xs muted" style="margin-top:4px">${ico('search', 'sm')} ${esc(t('Tap to open full size'))}</div></a></div>`
    : `<div class="note warn" style="margin-top:12px">${esc(t('No payment screenshot was uploaded.'))}</div>`;

  sheet(t('Verify UPI payment'), `<dl class="kv">
      <dt>${esc(t('Resident'))}</dt><dd>${esc(resLabel(r))}</dd>
      <dt>${esc(t('Aadhaar / ID'))}</dt><dd><b>${esc((r && (r.idNo || r.aadhaar)) || '—')}</b></dd>
      <dt>${esc(t('Mobile'))}</dt><dd>${esc((r && r.phone) || '—')}</dd>
      <dt>${esc(t('Amount'))}</dt><dd><b class="ok-t" style="font-size:16px">${inr(c.amount)}</b></dd>
      <dt>UTR / RRN</dt><dd><b>${esc(c.utr || '—')}</b>${refInfo ? `<br><small class="muted">${esc(refInfo.label)}</small>` : ''}</dd>
      <dt>${esc(t('Date'))}</dt><dd>${fmtDate(c.date)}</dd>
      <dt>${esc(t('Current due'))}</dt><dd>${r ? inr(resDue(r.id)) : '—'}</dd>
    </dl>
    ${ssHtml}
    ${docs}
    <p class="hint" style="margin-top:12px">${esc(t('Check the UTR in your bank/UPI app before approving.'))}</p>`,
    { foot: `<button class="btn bad" data-act="claimno" data-id="${c.id}">${esc(t('Reject'))}</button><span class="sp"></span><button class="btn ok" data-act="claimok" data-id="${c.id}">${ico('check', 'sm')} ${esc(t('Approve'))}</button>` });
};
A.claimok = el => {
  const c = Store.get(el.dataset.id);
  if (!c || c.status !== 'pending') return toast('Claim not found or already processed', 'bad');
  const pay = recordPayment({ resId: c.resId, amount: c.amount, mode: 'upi', ref: c.utr, date: c.date, claimId: c.id });
  Store.patch(c.id, { status: 'approved', payId: pay.id, by: (Store.me && Store.me.full_name) || 'Admin' });
  closeModal(true);
  render();
  toast(t('Payment approved & receipt generated!'));
  if (S().wa && S().wa.auto) {
    const res = resById(c.resId);
    if (res && res.phone) waOpen(res.phone, receiptMessage(pay), 'Send receipt');
  }
};
A.claimno = el => formModal({
  title: 'Reject payment', submit: 'Reject', fields: [{ name: 'why', label: 'Reason (sent to resident)', required: true, value: t('UTR not found in our account') }],
  onSubmit: v => { const c = Store.get(el.dataset.id); if (c) { Store.patch(c.id, { status: 'rejected', reason: v.why }); notify({ to: 'res', resId: c.resId, title: t('Payment not verified'), body: v.why }); toast('Rejected'); } },
});
A.meterok = el => {
  const m = Store.get(el.dataset.id);
  if (!m) return;
  if (m.isReplacement) {
    replaceMeter({
      roomId: m.roomId,
      finalOldReading: m.prev,
      startingNewReading: m.curr,
      newQr: m.qrCode,
      reason: m.replaceReason || 'Resident meter replacement claim verified',
      date: m.date
    });
    Store.delete(m.id);
    toast(t('Meter replacement approved and new baseline established!'), 'ok');
  } else {
    billMeter(m);
    toast('Bills created');
  }
  render();
};
A.meterreject = el => formModal({
  title: 'Reject meter reading',
  submit: 'Reject reading',
  danger: true,
  fields: [
    { name: 'why', label: 'Reason for rejection (e.g. blurry photo, incorrect reading)', required: true, value: t('Photo is unclear or reading does not match meter') }
  ],
  onSubmit: v => {
    const m = Store.get(el.dataset.id);
    if (!m) return;
    Store.delete(m.id);
    notify({ to: 'admin', title: t('Meter reading rejected'), body: `${roomName(m.roomId)}: ${v.why}` });
    closeModal();
    render();
    toast(t('Meter reading rejected'));
  }
});
A.meteredit = el => {
  const m = Store.get(el.dataset.id);
  formModal({
    title: `${t('Fix reading')} · ${roomName(m.roomId)}`,
    fields: [
      { name: 'prev', label: 'Previous reading', type: 'number', value: m.prev, step: 0.1 },
      { name: 'curr', label: 'Current reading', type: 'number', value: m.curr, required: true, step: 0.1 },
      { name: 'reason', label: 'Reason for correction', required: true, placeholder: t('Meter display misread, glare, etc.') }
    ],
    onSubmit: v => {
      try {
        correctReading({ meterId: m.id, prev: v.prev, curr: v.curr, reason: v.reason });
        closeModal();
        render();
        toast('Reading updated with audit trail');
      } catch (err) {
        return err.message;
      }
    }
  });
};
A.depok = el => formModal({
  title: 'Deposit refund', submit: 'Mark refunded',
  fields: [{ name: 'mode', label: 'Paid by', type: 'select', options: [{ v: 'upi', l: 'UPI' }, { v: 'cash', l: t('Cash') }, { v: 'bank', l: t('Bank transfer') }] }, { name: 'ref', label: 'Reference / UTR' }],
  onSubmit: v => { Store.patch(el.dataset.id, { status: 'paid', mode: v.mode, ref: v.ref, paidOn: today() }); toast('Refund recorded'); },
});
A.hkack = el => { Store.patch(el.dataset.id, { ack: true }); render(); };
A.hkreassign = el => {
  const x = Store.get(el.dataset.id);
  formModal({
    title: `${t('Reassign')} · ${x.roomNo}`, fields: [{ name: 'staff', label: 'Housekeeping staff', type: 'select', options: hkStaff().filter(s => s.status === 'active').map(s => ({ v: s.id, l: s.name })), value: x.staffId, required: true }, { name: 'date', label: 'Date', type: 'date', value: today() }],
    onSubmit: v => { const s = staffById(v.staff); Store.put('hkt', { ...x, id: `hkt-${v.date}-${x.roomId}-re${Date.now().toString(36)}`, _u: null, date: v.date, staffId: s.id, staffName: s.name, status: 'pending', reason: '', doneAt: null, ack: false }); Store.patch(x.id, { ack: true }); notify({ to: 'staff', staffId: s.id, title: t('Room assigned'), body: `${x.roomNo} · ${fmtShort(v.date)}` }); toast('Reassigned'); }
  });
};

/* ===================================================================== rooms */
PAGES.rooms = {
  title: 'Rooms & Beds', mod: 'rooms',
  render() {
    if (typeof reconcileBeds === 'function') reconcileBeds();
    const occ = occupancy(), f = curFlt('rooms', 'all');
    // With blocks and no block chosen, the wing becomes the outer heading: "Block A · Floor 1".
    const split = blocksOn() && !blockScope();
    const list0 = split ? rooms().slice().sort((a, b) => blockOrder(roomBlock(a)) - blockOrder(roomBlock(b))) : rooms();
    const byFloor = groupBy(list0, r => (split ? `${blockName(roomBlock(r))} · ` : '') + r.floor);
    const bedHtml = (room, b) => {
      const r = b.resId ? resById(b.resId) : null;
      const isOcc = b.status === 'occ' && r && (r.status === 'active' || r.status === 'notice');
      const due = isOcc ? resDue(r.id) : 0;
      const cls = isOcc ? 'occ' : b.status === 'mnt' ? 'mnt' : 'vac';
      return `<button class="bed ${cls}" data-act="bed" data-room="${room.id}" data-bed="${b.id}"><b>${esc(b.id)} · ${isOcc ? esc(r.name.split(' ')[0]) : esc(t(b.status === 'mnt' ? 'Repair' : 'Vacant'))}</b>${isOcc ? (due ? `<span class="bad-t">${inr(due)} ${esc(t('due'))}</span>` : esc(t('Paid up'))) : esc(t(b.status === 'mnt' ? 'Blocked' : 'Tap to check in'))}</button>`;
    };
    return `${head('Rooms & Beds', t('{o} occupied · {v} vacant · {p}% full', { o: occ.occ, v: occ.vac, p: occ.pct }), `${btn('Bulk setup', 'bulkrooms', '', '', 'grid')}${btn('Add room', 'addroom', '', '', 'plus')}${btn('Check-in', 'checkin', '', 'primary', 'userplus')}`)}
      <div class="tool">${chips('rooms', [['all', 'All rooms'], ['vac', 'Has vacant bed'], ['due', 'Has dues']], 'all')}<span class="sp"></span><div class="key"><span><i style="background:var(--ok-bg)"></i>${esc(t('Vacant'))}</span><span><i style="background:var(--info-bg)"></i>${esc(t('Occupied'))}</span><span><i style="background:var(--bad-bg)"></i>${esc(t('Repair'))}</span></div></div>
      ${Object.keys(byFloor).length ? Object.entries(byFloor).map(([fl, list]) => {
      const shown = list.filter(r => f === 'all' || (f === 'vac' && bedsOf(r).some(b => b.status === 'vac')) || (f === 'due' && bedsOf(r).some(b => b.resId && resDue(b.resId) > 0)));
      return shown.length ? `<section class="floor"><h3>${esc(fl)}</h3><div class="rooms">${shown.map(room => `<div class="room"><div class="hd"><b>${esc(room.no)}</b><span class="row" style="gap:6px"><span class="muted xs">${inr(room.rent)}/${esc(t('bed'))}${room.ac ? ' · AC' : ''}</span><button class="btn sm ghost" data-act="editroom" data-id="${room.id}" aria-label="${esc(t('Edit room'))}">${ico('edit', 'sm')}</button>${!bedsOf(room).some(b => b.status === 'occ') ? `<button class="btn sm ghost bad-t" data-act="delroom" data-id="${room.id}" aria-label="${esc(t('Delete room'))}" title="${esc(t('Delete room'))}">${ico('trash', 'sm')}</button>` : ''}</span></div><div class="beds">${bedsOf(room).map(b => bedHtml(room, b)).join('')}</div></div>`).join('')}</div></section>` : '';
    }).join('') : `<div class="card">${empty('No rooms yet', 'Add your rooms and beds to start.', btn('Add room', 'addroom', '', 'primary', 'plus'))}</div>`}`;
  },
};
A.bed = el => {
  const room = roomById(el.dataset.room); if (!room) return;
  const b = bedsOf(room).find(x => x.id === el.dataset.bed); if (!b) return;
  const r = b.resId ? resById(b.resId) : null;
  const isLiving = r && (r.status === 'active' || r.status === 'notice');
  if (b.status === 'occ' && isLiving) {
    return go('residents/' + r.id);
  }
  // Heal orphaned / dirty bed data immediately
  if (b.status === 'occ' || b.resId) {
    setBed(room.id, b.id, { status: 'vac', resId: null });
    b.status = 'vac';
    b.resId = null;
  }
  if (b.status === 'mnt') return confirmBox(t('Bed {b} is blocked for repair. Make it available again?', { b: `${room.no}-${b.id}` }), () => setBed(room.id, b.id, { status: 'vac' }), 'Make available');
  sheet(`${t('Bed')} ${room.no}-${b.id}`, `<div class="group">${li({ icon: 'userplus', ic: 'ok', t: t('Check in a resident here'), act: 'checkin', attrs: `data-bed="${room.id}|${b.id}"` })}${li({ icon: 'wrench', ic: 'bad', t: t('Block for repair'), act: 'bedmnt', attrs: `data-room="${room.id}" data-bed="${b.id}"` })}</div>`);
};
A.bedmnt = el => { setBed(el.dataset.room, el.dataset.bed, { status: 'mnt' }); closeModal(); render(); toast('Bed blocked'); };
function roomForm(room) {
  const r = room || {};
  const livingInRoom = r.id ? activeRes().filter(x => x.roomId === r.id) : [];
  const hasLiving = livingInRoom.length > 0;
  formModal({
    title: room ? `${t('Edit room')} ${r.no}` : 'Add room', submit: room ? 'Save' : 'Add room',
    fields: [
      { name: 'no', label: 'Room number', value: r.no, required: true, maxlength: 20 }, { name: 'floor', label: 'Floor', value: r.floor || `${t('Floor')} 1`, required: true, maxlength: 30 },
      ...(blocksOn() ? [{
        name: 'block', label: 'Block', type: 'select', value: roomBlock(r),
        options: [{ v: '', l: t('Not in a block') }, ...hostelBlocks().map(b => ({ v: b.k, l: b.l }))],
        info: t('Everyone living in this room counts as being in this block. Beds, bills and the head count stay with the hostel.')
      }] : []),
      { name: 'beds', label: 'Number of beds', type: 'number', value: r.beds ? r.beds.length : 2, min: 1, max: 12, required: true }, { name: 'rent', label: 'Rent per bed (₹/month)', type: 'number', value: r.rent, min: 0, required: true },
      { name: 'ac', label: 'AC room', type: 'checkbox', value: r.ac },
      ...(room ? [{
        type: 'html',
        html: `
          <div style="margin-top:16px;padding:12px;border-radius:12px;background:var(--bad-bg);border:1px solid rgba(215,0,21,0.2)">
            <div class="row sb" style="margin-bottom:6px">
              <b style="color:var(--bad);font-size:14px">${ico('trash', 'sm')} ${esc(t('Delete room'))}</b>
              ${hasLiving ? `<span class="badge bad">${livingInRoom.length} ${esc(t('occupied'))}</span>` : ''}
            </div>
            ${hasLiving ? `
              <p class="xs" style="color:var(--bad);margin:0">
                ${esc(t('This room cannot be deleted because {n} resident(s) are currently staying in it ({names}). Please vacate or shift them first.', { n: livingInRoom.length, names: livingInRoom.map(x => x.name).join(', ') }))}
              </p>
            ` : `
              <p class="xs muted" style="margin:0 0 10px">
                ${esc(t('Permanently remove room {r} and its beds from your property. This cannot be undone.', { r: r.no }))}
              </p>
              <button type="button" class="btn bad sm" data-act="delroom" data-id="${r.id}" style="width:100%;justify-content:center">
                ${ico('trash', 'sm')} ${esc(t('Delete room {r}', { r: r.no }))}
              </button>
            `}
          </div>
        `
      }] : [])
    ],
    danger: room && !hasLiving ? { label: 'Delete room', run: () => confirmBox(t('Delete room {r}?', { r: r.no }), () => { Store.remove(r.id); toast('Room deleted'); }, 'Delete', 'bad') } : null,
    onSubmit: v => {
      if (rooms().some(x => x.no === v.no && x.id !== r.id)) return 'A room with this number already exists';
      const ids = 'ABCDEFGHIJKL'.slice(0, v.beds).split('');
      const cur = bedsOf(r);
      if (cur.filter(b => !ids.includes(b.id)).some(b => b.status === 'occ')) return 'You cannot remove a bed that is occupied';
      const beds = ids.map(id => cur.find(b => b.id === id) || { id, status: 'vac' });
      Store.put('room', { ...r, id: r.id || `room-${slug(v.no)}-${uid()}`, no: v.no, floor: v.floor, block: blocksOn() ? v.block || '' : r.block || '', rent: v.rent, ac: v.ac, sharing: v.beds, beds });
      toast(room ? 'Room updated' : 'Room added');
    },
  });
}
A.addroom = () => roomForm();
A.editroom = el => roomForm(roomById(el.dataset.id));
A.delroom = el => {
  const r = roomById(el.dataset.id);
  if (!r) return;
  const living = activeRes().filter(x => x.roomId === r.id);
  if (living.length) {
    return toast(t('Cannot delete room: {n} resident(s) currently active in it.', { n: living.length }), 'bad');
  }
  confirmBox(t('Delete room {r}? All its beds will be removed. This cannot be undone.', { r: r.no }), () => {
    Store.remove(r.id);
    closeModal();
    toast(t('Room {r} deleted ✓', { r: r.no }), 'ok');
    render();
  }, t('Delete room'), 'bad');
};
A.bulkrooms = () => {
  formModal({
    title: 'Bulk Setup Floors & Rooms (Step 1/2: Configuration)',
    submit: 'Next: Preview Generated Rooms →',
    wide: true,
    note: t('Define floor labels, room numbering pattern, and standard capacity. You can preview and customize every room before saving.'),
    fields: [
      { name: 'floors', label: 'Floor labels (comma-separated)', value: 'Floor 1, Floor 2, Floor 3', required: true, full: true, hint: 'e.g. Floor 1, Floor 2, Floor 3' },
      { name: 'startNo', label: 'Start room number', type: 'number', value: 101, required: true },
      { name: 'endNo', label: 'End room number', type: 'number', value: 108, required: true },
      { name: 'beds', label: 'Beds per room (capacity)', type: 'number', min: 1, max: 12, value: 2, required: true },
      { name: 'rent', label: 'Rent per bed (₹/month)', type: 'number', min: 0, value: 6500, required: true },
      { name: 'ac', label: 'AC rooms', type: 'checkbox', value: false },
      ...(blocksOn() ? [{ name: 'block', label: 'Block', type: 'select', options: [{ v: '', l: t('None') }, ...hostelBlocks().map(b => ({ v: b.k, l: b.l }))] }] : [])
    ],
    onSubmit: v => {
      const fls = String(v.floors || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!fls.length) return 'Provide at least one floor label';
      const startNo = parseInt(v.startNo, 10);
      const endNo = parseInt(v.endNo, 10);
      if (isNaN(startNo) || isNaN(endNo)) return 'Enter valid room numbers';
      if (startNo > endNo) return 'Start room cannot exceed end room';

      // Generate preview list
      const existingRooms = rooms();
      const existingNos = new Set(existingRooms.map(r => String(r.no).trim().toLowerCase()));
      const previewList = [];
      const totalRooms = endNo - startNo + 1;
      const roomsPerFloor = Math.ceil(totalRooms / fls.length);

      for (let no = startNo; no <= endNo; no++) {
        const floorIdx = Math.min(fls.length - 1, Math.floor((no - startNo) / roomsPerFloor));
        const floorLabel = fls[floorIdx];
        const roomNoStr = String(no);
        const conflict = existingNos.has(roomNoStr.toLowerCase());
        previewList.push({
          floor: floorLabel,
          no: roomNoStr,
          beds: +v.beds,
          rent: +v.rent,
          ac: !!v.ac,
          block: v.block || '',
          conflict
        });
      }

      const hasConflict = previewList.some(p => p.conflict);
      const totalBeds = previewList.reduce((s, p) => s + p.beds, 0);

      // Open Step 2: Confirmation & Preview Modal with Inline Editing
      setTimeout(() => {
        formModal({
          title: `Bulk Setup (Step 2/2: Verification & Preview · ${previewList.length} Rooms)`,
          submit: hasConflict ? 'Resolve Conflicts to Create' : `Confirm & Create All (${previewList.length} Rooms, ${totalBeds} Beds)`,
          wide: true,
          note: hasConflict
            ? t('Warning: Some room numbers already exist in this property. Rename room numbers or resolve duplicate conflicts to proceed.')
            : t('Review and customize room beds, AC, or rent directly in the table below before creating.'),
          fields: [
            {
              type: 'html',
              html: `
                <div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
                  <div class="xs muted">💡 <b>${esc(t('Quick Edit'))}:</b> ${esc(t('You can change beds, AC, rent or room number directly in the table.'))}</div>
                  <div class="xs muted" style="white-space:nowrap">👈👉 ${esc(t('Scroll horizontally to view all columns'))}</div>
                </div>
                <div class="tbl-wrap" style="max-height:360px;overflow-y:auto;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:8px;margin-bottom:12px;background:var(--surface)">
                  <table class="tbl" style="min-width:540px;width:100%;font-size:13px;border-collapse:collapse">
                    <thead>
                      <tr style="background:var(--subtle);position:sticky;top:0;z-index:2">
                        <th style="padding:9px 12px;white-space:nowrap;text-align:left">${esc(t('Floor'))}</th>
                        <th style="padding:9px 12px;white-space:nowrap;text-align:left">${esc(t('Room'))}</th>
                        <th style="padding:9px 12px;white-space:nowrap;text-align:left">${esc(t('Beds'))}</th>
                        <th style="padding:9px 12px;white-space:nowrap;text-align:left">${esc(t('AC'))}</th>
                        <th style="padding:9px 12px;white-space:nowrap;text-align:left">${esc(t('Rent (₹/mo)'))}</th>
                        <th style="padding:9px 12px;white-space:nowrap;text-align:center">${esc(t('Status'))}</th>
                      </tr>
                    </thead>
                    <tbody id="bulkPreviewBody">
                      ${previewList.map((p, i) => `
                        <tr id="bulk-row-${i}" style="${p.conflict ? 'background:rgba(239,68,68,0.08);' : ''}border-bottom:1px solid var(--line)">
                          <td style="padding:8px 12px;white-space:nowrap;font-weight:600;vertical-align:middle;overflow-wrap:normal">${esc(p.floor)}</td>
                          <td style="padding:8px 12px;white-space:nowrap;vertical-align:middle;overflow-wrap:normal">
                            <input type="text" class="inp bulk-inp-no" data-idx="${i}" value="${esc(p.no)}" style="width:70px;padding:4px 6px;font-size:13px;font-weight:700;height:32px;display:inline-block;text-align:center" title="${esc(t('Edit room number'))}">
                          </td>
                          <td style="padding:8px 12px;white-space:nowrap;vertical-align:middle;overflow-wrap:normal">
                            <div style="display:inline-flex;align-items:center;gap:4px">
                              <input type="number" class="inp bulk-inp-beds" data-idx="${i}" min="1" max="12" value="${p.beds}" style="width:58px;padding:4px 6px;font-size:13px;height:32px;text-align:center">
                              <span class="muted xs">${esc(t('beds'))}</span>
                            </div>
                          </td>
                          <td style="padding:8px 12px;white-space:nowrap;vertical-align:middle;overflow-wrap:normal">
                            <select class="inp bulk-inp-ac" data-idx="${i}" style="width:85px;padding:4px 6px;font-size:12px;height:32px">
                              <option value="1" ${p.ac ? 'selected' : ''}>AC</option>
                              <option value="0" ${!p.ac ? 'selected' : ''}>Non-AC</option>
                            </select>
                          </td>
                          <td style="padding:8px 12px;white-space:nowrap;vertical-align:middle;overflow-wrap:normal">
                            <div style="display:inline-flex;align-items:center;gap:3px">
                              <span class="muted xs">₹</span>
                              <input type="number" class="inp bulk-inp-rent" data-idx="${i}" min="0" step="100" value="${p.rent}" style="width:85px;padding:4px 6px;font-size:13px;height:32px">
                            </div>
                          </td>
                          <td style="padding:8px 12px;white-space:nowrap;text-align:center;vertical-align:middle;overflow-wrap:normal" id="bulk-status-${i}">
                            ${p.conflict
                  ? `<span class="badge bad" title="${esc(t('Room number already exists'))}">${esc(t('Exists'))}</span>`
                  : `<span class="badge ok">${esc(t('Ready'))}</span>`}
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `
            }
          ],
          onSubmit: () => {
            const batchNos = new Set();
            for (const p of previewList) {
              if (!p.no) return t('Every room must have a valid room number');
              const lower = p.no.toLowerCase();
              if (batchNos.has(lower)) return t('Duplicate room number in batch: {no}', { no: p.no });
              if (existingNos.has(lower)) return t('Room {no} already exists in property. Please rename or resolve duplicate.', { no: p.no });
              batchNos.add(lower);
            }

            try {
              const res = bulkCreateRooms({
                floors: fls,
                rooms: previewList,
                defaultRent: v.rent,
                defaultAc: v.ac,
                block: v.block || ''
              });
              closeModal();
              toast(t('Bulk setup complete: {r} rooms with {b} beds created across {f} floors ✓', {
                r: res.roomCount,
                b: res.bedCount,
                f: fls.length
              }), 'ok');
              render();
            } catch (err) {
              return err.message;
            }
          }
        });

        // Wire up live editing events for beds, AC, rent, and room numbers
        setTimeout(() => {
          const form = $('#mform');
          if (form) {
            const handleUpdate = e => {
              const el = e.target;
              if (!el || el.dataset.idx == null) return;
              const i = parseInt(el.dataset.idx, 10);
              const p = previewList[i];
              if (!p) return;

              if (el.classList.contains('bulk-inp-beds')) {
                p.beds = Math.max(1, Math.min(12, parseInt(el.value, 10) || 1));
              } else if (el.classList.contains('bulk-inp-ac')) {
                p.ac = el.value === '1';
              } else if (el.classList.contains('bulk-inp-rent')) {
                p.rent = Math.max(0, parseFloat(el.value) || 0);
              } else if (el.classList.contains('bulk-inp-no')) {
                p.no = String(el.value || '').trim();
                const conflict = existingNos.has(p.no.toLowerCase());
                p.conflict = conflict;
                const row = $(`#bulk-row-${i}`);
                const stCell = $(`#bulk-status-${i}`);
                if (row) row.style.background = conflict ? 'rgba(239,68,68,0.08)' : '';
                if (stCell) {
                  stCell.innerHTML = conflict
                    ? `<span class="badge bad" title="${esc(t('Room number already exists'))}">${esc(t('Exists'))}</span>`
                    : `<span class="badge ok">${esc(t('Ready'))}</span>`;
                }
              }

              // Update submit button text and state dynamically
              const anyConflict = previewList.some(item => item.conflict || !item.no);
              const curBeds = previewList.reduce((sum, item) => sum + (item.beds || 0), 0);
              const subBtn = $('[data-act="msubmit"]');
              if (subBtn) {
                if (anyConflict) {
                  subBtn.textContent = esc(t('Resolve Conflicts to Create'));
                  subBtn.classList.add('bad');
                } else {
                  subBtn.textContent = esc(t('Confirm & Create All ({r} Rooms, {b} Beds)', { r: previewList.length, b: curBeds }));
                  subBtn.classList.remove('bad');
                }
              }
            };

            form.addEventListener('input', handleUpdate);
            form.addEventListener('change', handleUpdate);
          }
        }, 30);
      }, 50);

      return false; // prevent premature close
    }
  });
};

/* ===================================================================== check-in */
A.checkin = (el, opts = {}) => {
  const vac = vacantBeds();
  if (!vac.length) { toast('No vacant beds. Add a room first.', 'bad'); return; }
  const req = S().docs.required;
  const pre = el && el.dataset && el.dataset.bed ? el.dataset.bed : `${vac[0].room.id}|${vac[0].bed.id}`;
  // The block is not a separate question: a bed is in exactly one block, so choosing the bed
  // chooses the block. Grouping the list is what tells the owner which one they just picked.
  const bedOpts = bedOptions(vac, x => `${x.room.no}-${x.bed.id} · ${inr(x.room.rent)} · ${x.room.floor}`);
  const room0 = roomById(pre.split('|')[0]);
  formModal({
    title: 'New check-in', submit: 'Check in', wide: true,
    note: t('Bills, bed status, resident login and the WhatsApp welcome are created automatically.'),
    fields: [
      { type: 'section', label: 'Resident' },
      { name: 'name', label: 'Full name', value: (opts && opts.name) || '', required: true, maxlength: 80 },
      { name: 'phone', label: 'Mobile (WhatsApp)', type: 'tel', value: (opts && opts.phone) || '', required: true, maxlength: 10, placeholder: '10-digit mobile' },
      { name: 'email', label: 'Email address', type: 'email', value: (opts && opts.email) || '', maxlength: 80, placeholder: 'name@example.com' },
      { name: 'guardian', label: 'Parent / guardian name', maxlength: 80 }, { name: 'guardianPhone', label: 'Guardian mobile', type: 'tel', maxlength: 10, placeholder: '10-digit mobile' },
      { name: 'college', label: 'College / office', maxlength: 120 }, { name: 'idNo', label: 'Aadhaar card number', maxlength: 12, placeholder: '12-digit Aadhaar' },
      { name: 'address', label: 'Home address', full: true, maxlength: 240 },
      { type: 'section', label: 'Room & money' },
      { name: 'bed', label: 'Room & bed', type: 'select', options: bedOpts, value: pre, required: true },
      { name: 'checkIn', label: 'Check-in date', type: 'date', value: today(), required: true },
      ...meterField(room0 ? room0.id : ''),
      { name: 'rent', label: 'Monthly rent (₹)', type: 'number', value: room0 ? room0.rent : '', min: 0, max: 500000, required: true, hint: t('Filled from the room. Change only for a special deal.') },
      { name: 'deposit', label: 'Security deposit (₹)', type: 'number', value: room0 ? room0.rent : 0, min: 0, max: 500000 },
      { name: 'food', label: 'Takes mess food', type: 'checkbox', value: true },
      { name: 'lang', label: 'WhatsApp language', type: 'select', options: [{ v: 'en', l: 'English' }, { v: 'hi', l: 'हिन्दी' }], value: S().wa.lang === 'hi' ? 'hi' : 'en' },
      { type: 'section', label: 'Documents' },
      ...req.map((d, i) => ({ name: 'doc' + i, label: d, type: 'file', accept: 'image/*,application/pdf' })),
      { type: 'html', html: docsNote() },
      ...(pvOn() ? [
        { type: 'section', label: 'Police verification' },
        {
          name: 'pvState', label: 'State / portal', type: 'select', value: S().police.state || '',
          options: [{ v: '', l: t('Use the hostel default') }].concat(PV_STATES.map(([k, l]) => ({ v: k, l: t(l) })))
        },
        { type: 'html', html: `<div class="hint">${esc(t('Marked as not started. Open the portal from the resident page when you are ready — their details are one tap away.'))}</div>` },
      ] : []),
      { type: 'section', label: 'App login' },
      { name: 'login', label: 'Create app login for resident', type: 'checkbox', value: true, hint: t('User ID = mobile.hostel, password = mobile number. They can change it later.') },
    ],
    onChange: (v, form, changed) => {
      if (changed === 'bed') { const rm = roomById(String(v.bed).split('|')[0]); if (rm) { setField(form, 'rent', rm.rent); setField(form, 'deposit', rm.rent); } }
    },
    preview: v => {
      if (!v.name) return '';
      const rRent = v.rent != null && !isNaN(v.rent) ? +v.rent : 0;
      const cCalc = calcCheckInRent({ checkInDate: v.checkIn || today(), monthlyRent: rRent });
      const depAmt = v.deposit != null && !isNaN(v.deposit) ? +v.deposit : 0;
      const hSlug = slug((Store.hostel() || {}).name || 'hostel').slice(0, 18).replace(/\.+$/, '') || 'hostel';
      const uPreview = phone10(v.phone) ? `${phone10(v.phone)}.${hSlug}` : slug(v.name);
      return `<div style="font-size:12px;line-height:1.4"><b>${esc(t('Login'))}:</b> ${esc(uPreview)} / ${esc(phone10(v.phone) || '—')}<br><b>${esc(t('First Rent'))}:</b> ${inr(cCalc.amount)} (${cCalc.occupiedDays}/${cCalc.totalDays} ${esc(t('days'))} · ${inr(cCalc.dailyRate)}/${esc(t('day'))}) + ${inr(depAmt)} ${esc(t('deposit'))}<br><small class="mute">${esc(cCalc.formula)}</small></div>`;
    },
    onSubmit: async v => {
      if (residents().some(r => r.status !== 'left' && r.phone === phone10(v.phone))) return 'A resident with this mobile number already exists';
      const [roomId, bed] = v.bed.split('|');
      // Settle the room's electricity up to the moment this person moves in, before they
      // exist as an occupant — otherwise they inherit a share of units used before they came.
      try { moveReading(roomId, v.meterNow, v.checkIn); } catch (e) { return e.message; }
      const r = checkIn({ name: v.name, phone: v.phone, email: v.email, guardian: v.guardian, guardianPhone: v.guardianPhone, college: v.college, idNo: v.idNo, address: v.address, roomId, bed, rent: v.rent, deposit: v.deposit, checkIn: v.checkIn, food: v.food, lang: v.lang });
      if (opts && opts.inquiryId) {
        const inq = Store.get(opts.inquiryId);
        Store.patch(opts.inquiryId, {
          status: 'converted',
          convertedResId: r.id,
          data: { ...(inq && inq.data ? inq.data : {}), status: 'converted', convertedResId: r.id }
        });
      }
      const files = req.map((d, i) => ({ type: d, file: (v['doc' + i] || [])[0] })).filter(x => x.file);
      if (pvOn()) {
        const initialPv = files.length >= req.length && files.length > 0 ? 'ready' : 'pending_docs';
        Store.patch(r.id, { pv: { status: initialPv, state: v.pvState || '', updatedAt: nowIso() } });
      } else {
        Store.patch(r.id, { pv: { status: 'not_required', state: v.pvState || '' } });
      }
      let login = null;
      if (v.login) login = await createResidentLogin(r).catch(e => { toast(t('Login not created: {m}', { m: e.message }), 'bad'); return null; });
      if (files.length) uploadDocs('res', r.id, files);
      if (typeof checkAndAutoSendAgreement === 'function') {
        try { checkAndAutoSendAgreement(r.id); } catch (e) { /* ignore */ }
      }
      closeModal(); go('residents/' + r.id);
      toast(t('{n} checked in', { n: r.name }));
      if (S().wa.auto) waOpen(r.phone, welcomeMessage(resById(r.id), login), 'Send welcome');
      return false;
    },
  });
};
async function createResidentLogin(r) {
  const h = Store.hostel();
  const hSlug = slug((h && h.name) || 'hostel').slice(0, 18).replace(/\.+$/, '') || 'hostel';
  const ph = phone10(r.phone);
  const wantUser = ph && ph.length === 10 ? `${ph}.${hSlug}` : undefined;
  const u = await Backend.admin('create_user', { full_name: r.name, phone: r.phone, username: wantUser, org_id: h.org_id, hostel_id: h.id, role: 'resident', ref_id: r.id });
  Store.patch(r.id, { userId: u.user_id, username: u.username });
  return u;
}
// One line under every document picker, so nobody wonders where the papers go.
const docsNote = () => (Files.ready()
  ? `<div class="hint">${ico('lock', 'sm')} ${esc(t('Saved privately. Photos auto-compressed, PDF max 1.5 MB. Deleted {n} days after checkout.', { n: DOC_KEEP_DAYS }))}</div>`
  : `<div class="note warn">${esc(t('Documents are not uploaded in demo mode.'))}</div>`);
// The record is saved first and the papers follow in the background, so a slow network never
// holds up a check-in. A paper of a type already on file replaces it; the old file is left for
// the daily sweep, so a failed sync can never leave a record pointing at nothing.
async function uploadDocs(kind, id, files) {
  if (!Files.ready() || !files.length) return 0;
  toast(t('Uploading {n} documents…', { n: files.length }));
  let ok = 0;
  for (const f of files) {
    try {
      const doc = await Files.upload(f.file, kind, id, f.type);
      const cur = Store.get(id); if (!cur) return ok;
      Store.patch(id, { docs: [...(cur.docs || []).filter(d => d.type !== doc.type), doc] }); ok++;
    } catch (e) { toast(`${t(f.type)}: ${e.message}`, 'bad'); }
  }
  if (ok) {
    toast(t('{n} documents saved', { n: ok }));
    if (kind === 'res' && typeof checkAndAutoSendAgreement === 'function') {
      try { checkAndAutoSendAgreement(id); } catch (e) { /* ignore */ }
    }
  }
  render();
  return ok;
}


/* ===================================================================== police verification */
// One card per resident: where the verification stands, the portal link, the details to
// paste into it, and the papers that came back.
function pvCard(r) {
  if (!pvOn()) return '';
  const pv = pvOf(r), st = PV_STATUS[pv.status] || PV_STATUS.none;
  const portal = pvPortal(pv.state);
  const docs = pv.docs || [];
  const overdue = pvDue(r);
  const rows = [
    li({
      icon: 'shield', ic: st[1], t: t(st[0]),
      d: [pv.refNo ? t('Ref: {n}', { n: pv.refNo }) : '',
      pv.verifiedBy ? t('By: {v}', { v: pv.verifiedBy }) : '',
      pv.date ? t('Date: {d}', { d: fmtDate(pv.date) }) : (pv.submittedOn ? t('Sent {d}', { d: fmtDate(pv.submittedOn) }) : ''),
      pv.notes ? t('Note: {n}', { n: pv.notes }) : '',
      overdue ? t('{n} days since check-in', { n: diffDays(today(), r.checkIn) }) : ''].filter(Boolean).join(' · '),
      end: overdue ? badge('Overdue', 'bad') : pv.certificatePath ? badge('Verified Certificate', 'ok') : badge(st[0], st[1]), chev: false
    }),
  ];
  if (pv.certificatePath) {
    rows.push(li({
      icon: 'file', ic: 'ok', t: t('Police Verification Certificate'), d: pv.refNo ? `Ref: ${pv.refNo}` : '',
      act: 'opendoc', attrs: `data-path="${esc(pv.certificatePath)}" data-res="${r.id}" data-type="Police verification"`,
      end: `<button type="button" class="btn sm ok" data-act="opendoc" data-path="${esc(pv.certificatePath)}" data-res="${r.id}" data-type="Police verification">${ico('file', 'sm')} ${esc(t('View Certificate'))}</button>`
    }));
  }
  for (const d of docs) rows.push(li({ icon: 'file', ic: 'ok', t: d.type, d: fmtTs(d.ts), end: docOpen(d) }));
  const actions = isAdmin() ? `<div class="row wrap" style="gap:8px">
      ${portal ? btn('Fill police form', 'pvopen', `data-id="${r.id}"`, 'primary sm', 'globe') : ''}
      ${btn('Copy details', 'pvcopy', `data-id="${r.id}"`, 'sm', 'copy')}
      ${btn('Update status', 'pvstatus', `data-id="${r.id}"`, 'sm', 'check')}
      ${btn('Upload paper', 'pvupload', `data-id="${r.id}"`, 'sm', 'upload')}
    </div>` : '';
  return group('Police verification', rows.join(''),
    `${actions}${portal ? '' : `<div class="hint" style="margin-top:8px">${esc(t('No portal link set for your state yet — Settings → Police verification.'))}</div>`}`);
}

// Opening the portal copies the resident's details first, so the owner only pastes. When they
// come back to the app, one sheet asks for the reference number and the acknowledgement and
// files it straight into the resident's Documents — the "after the form" step is never forgotten.
let pvAwait = null;
A.pvopen = async el => {
  const r = resById(el.dataset.id); if (!r) return;
  const portal = pvPortal(pvOf(r).state);
  try { await navigator.clipboard.writeText(pvDetailsText(r)); toast(t('Details copied — paste them into the form')); } catch (e) { /* clipboard blocked; Copy details still works */ }
  pvAwait = { id: r.id, at: Date.now() };
  window.open(portal, '_blank', 'noopener');
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !pvAwait) return;
  const w = pvAwait; pvAwait = null;
  if (Date.now() - w.at < 15e3) return;   // came straight back without filling anything
  setTimeout(() => pvAfterForm(w.id), 300);
});
function pvAfterForm(id) {
  const r = resById(id); if (!r) return;
  formModal({
    title: `${t('Police form submitted?')} · ${r.name}`,
    fields: [
      { name: 'refNo', label: 'Acknowledgement / reference number', value: pvOf(r).refNo || '' },
      { name: 'file', label: 'Acknowledgement (screenshot or PDF)', type: 'file', accept: 'image/*,application/pdf' },
    ],
    submit: 'Save to documents',
    onSubmit: async v => {
      const f = (v.file || [])[0];
      if (!v.refNo && !f) return 'Add the reference number or the acknowledgement';
      const patch = { status: pvOf(r).status === 'verified' ? 'verified' : 'submitted', submittedOn: pvOf(r).submittedOn || today(), refNo: v.refNo };
      if (f) {
        if (!Files.ready()) return 'Documents are not uploaded in demo mode.';
        const doc = await Files.upload(f, 'res', r.id, PV_DOC_TYPES[0]);
        patch.docs = [...(pvOf(resById(r.id)).docs || []).filter(d => d.type !== doc.type), doc];
        pvToDocs(r.id, doc);
      }
      pvSet(r.id, patch);
      toast(t('Saved to documents'));
    },
  });
}
// Verification papers also show in the resident's ordinary Documents list.
function pvToDocs(resId, doc) {
  const cur = resById(resId); if (!cur) return;
  Store.patch(resId, { docs: [...(cur.docs || []).filter(d => d.type !== doc.type), doc] });
}

A.pvcopy = async el => {
  const r = resById(el.dataset.id); if (!r) return;
  const text = pvDetailsText(r);
  try { await navigator.clipboard.writeText(text); toast(t('Details copied — paste them into the portal')); }
  catch (e) {
    // clipboard is blocked on some phones; show the text so it can still be copied by hand
    sheet(t('Details for the portal'), `<pre class="pre-wrap">${esc(text)}</pre>`);
  }
};

A.pvstatus = el => {
  const r = resById(el.dataset.id); if (!r) return;
  const pv = pvOf(r);
  formModal({
    title: `${t('Police verification')} · ${r.name}`,
    fields: [
      {
        name: 'status', label: 'Status', type: 'select', value: pv.status || 'none',
        options: Object.entries(PV_STATUS).map(([k, v]) => ({ v: k, l: t(v[0]) })), required: true
      },
      {
        name: 'state', label: 'State / portal', type: 'select', value: pv.state || S().police.state || '',
        options: [{ v: '', l: t('Use the hostel default') }].concat(PV_STATES.map(([k, l]) => ({ v: k, l: t(l) })))
      },
      { name: 'refNo', label: 'Acknowledgement / reference number', value: pv.refNo || '' },
      { name: 'submittedOn', label: 'Submitted on', type: 'date', value: pv.submittedOn || '' },
      { name: 'note', label: 'Note', value: pv.note || '', full: true },
    ],
    onSubmit: v => {
      if (v.status === 'submitted' && !v.submittedOn) return 'Please give the date it was submitted.';
      pvSet(r.id, { status: v.status, state: v.state, refNo: v.refNo, submittedOn: v.submittedOn || null, note: v.note });
      toast('Saved');
    },
  });
};

A.pvupload = el => {
  const r = resById(el.dataset.id); if (!r) return;
  formModal({
    title: `${t('Upload verification paper')} · ${r.name}`,
    fields: [
      { name: 'type', label: 'What is this?', type: 'select', options: PV_DOC_TYPES.map(x => ({ v: x, l: t(x) })), required: true },
      { name: 'file', label: 'File (photo or PDF)', type: 'file', accept: 'image/*,application/pdf', required: true },
      { type: 'html', html: docsNote() },
    ],
    onSubmit: async v => {
      if (!Files.ready()) return 'Documents are not uploaded in demo mode.';
      const f = (v.file || [])[0]; if (!f) return 'Choose a file';
      const doc = await Files.upload(f, 'res', r.id, v.type);
      const cur = pvOf(resById(r.id));
      const docs = [...(cur.docs || []).filter(d => d.type !== v.type), doc];
      // the certificate arriving IS the verification, so move the status on unless it is already set
      const status = v.type === PV_DOC_TYPES[1] && cur.status !== 'verified' ? 'verified' : cur.status || 'submitted';
      pvToDocs(r.id, doc);
      pvSet(r.id, { docs, status });
      toast(t('Saved to documents'));
    },
  });
};

/* ===================================================================== penalties
 * A fine lives as an ordinary charge on the bill list; this card is only there so the reason
 * and the choice to cancel it are one tap away instead of buried among the rent bills.
 */
function penCard(r) {
  const open = resPenalties(r.id);
  const past = resInvoices(r.id).filter(i => i.type === 'penalty' && invBal(i) <= 0).slice(-4).reverse();
  if (!open.length && !past.length) return '';
  const row = (i, done) => li({
    icon: 'alert', ic: done ? 'mute' : 'bad',
    t: i.reason || i.title,
    d: [fmtDate(i.date), i.waivedOn ? t('Cancelled {d}', { d: fmtDate(i.waivedOn) }) : done ? t('Paid') : t('due') + ' ' + fmtShort(i.due)].filter(Boolean).join(' · '),
    end: done ? badge(i.waivedOn ? 'Cancelled' : 'Paid', 'ok')
      : `<b class="bad-t" style="margin-right:4px">${inr(invBal(i))}</b>${isAdmin() ? btn('Cancel', 'penwaive', `data-id="${i.id}"`, 'sm') : ''}`,
    chev: false,
  });
  return group('Penalties', [...open.map(i => row(i, false)), ...past.map(i => row(i, true))].join(''),
    open.length ? t('Stays on the account until it is paid or cancelled. Each payment asks whether to collect it.') : '');
}
const PENALTY_REASONS = ['Late entry', 'Damage to property', 'Smoking / alcohol', 'Noise after hours',
  'Guest without permission', 'Room left dirty', 'Lost key', 'Rule violation', 'Other'];
A.penadd = el => {
  const r = resById(el.dataset.id); if (!r) return;
  formModal({
    title: `${t('Add penalty')} · ${r.name}`, submit: 'Add penalty',
    note: t('The resident is told straight away. It is added to their dues and stays there until paid or cancelled.'),
    fields: [
      { name: 'reason', label: 'Reason', type: 'select', options: PENALTY_REASONS.map(x => ({ v: x, l: t(x) })), required: true },
      { name: 'detail', label: 'In your own words', placeholder: 'Optional — shown to the resident', full: true },
      { name: 'amount', label: 'Penalty amount (₹)', type: 'number', min: 1, required: true },
      { name: 'due', label: 'Pay by', type: 'date', value: addDays(today(), 7) },
      { name: 'wa', label: 'Tell them on WhatsApp', type: 'checkbox', value: S().wa.auto },
    ],
    preview: v => (v.amount > 0 ? `${esc(t('New total due'))}: <b>${inr(round2(resDue(r.id) + v.amount))}</b>` : ''),
    onSubmit: v => {
      const reason = v.detail ? `${t(v.reason)} — ${v.detail}` : t(v.reason);
      const inv = addPenalty({ resId: r.id, amount: v.amount, reason, due: v.due });
      closeModal(); render();
      toast(t('Penalty of {a} added', { a: inr(v.amount) }));
      if (v.wa) waOpen(r.phone, `${t('Hello')} ${r.name.split(' ')[0]},\n\n${t('A penalty has been added to your account at')} *${hostelName()}*.\n\n${t('Amount')}: ${rs(v.amount)}\n${t('Reason')}: ${reason}\n${t('Pay by')}: ${fmtDate(inv.due)}\n\n${t('Regards')},\n${hostelName()}`, 'Tell the resident');
      return false;
    },
  });
};
A.penwaive = el => {
  const i = Store.get(el.dataset.id); if (!i) return;
  formModal({
    title: 'Cancel penalty', submit: 'Cancel penalty',
    note: t('{a} will be removed from their dues. The penalty stays on record as cancelled.', { a: inr(invBal(i)) }),
    fields: [{ name: 'why', label: 'Why are you cancelling it?', full: true }],
    onSubmit: v => { waivePenalty(i.id, v.why); toast('Penalty cancelled'); },
  });
};

/* ===================================================================== residents */
PAGES.residents = {
  title: () => (ui.arg && resById(ui.arg) ? resById(ui.arg).name : 'Residents'), mod: 'residents',
  render(id) {
    if (typeof reconcileBeds === 'function') reconcileBeds();
    if (ctx().role === 'emitra') {
      setTimeout(() => go('emitra'), 0);
      return `<div class="card">${empty('Access Restricted', 'Your account is restricted to the E-Mitra Police Verification Queue.', btn('Open Queue', 'go', 'data-to="emitra"', 'primary'))}</div>`;
    }
    if (id) return residentDetail(id);
    const f = curFlt('res', 'active');
    const list = residents().filter(r => (f === 'all' || (f === 'active' ? r.status === 'active' || r.status === 'notice' : f === 'due' ? r.status !== 'left' && resDue(r.id) > 0 : r.status === f)) && needle('res', r.name, r.phone, roomName(r.roomId), r.college)).sort(by('name'));
    importDemoSignups();
    const waiting = isAdmin() ? pendingSignups() : [];
    return `${head('Residents', t('{n} living here now', { n: activeRes().length }), `${btn('Export', 'exportres', '', '', 'download')}${btn('Check-in', 'checkin', '', 'primary', 'userplus')}`)}
      ${waiting.length ? group(t('Waiting to be admitted ({n})', { n: waiting.length }), waiting.map(a => li({
      icon: 'userplus', ic: 'ok', t: a.name,
      d: [a.phone, a.college, (a.docs || []).length ? t('{n} documents', { n: a.docs.length }) : t('no documents'),
      a.pv && a.pv.refNo ? t('police ref {n}', { n: a.pv.refNo }) : '', ago(a.ts)].filter(Boolean).join(' · '),
      act: 'signupview', attrs: `data-id="${a.id}"`, end: badge('Review', 'acc'),
    })).join(''), t('They filled the form themselves. Open one to check it, give them a bed and set the rent.')) : ''}
      <div class="tool">${searchBox('res', 'Search name, mobile, room')}${chips('res', [['active', 'Living'], ['due', 'With dues'], ['notice', 'On notice'], ['left', 'Left'], ['all', 'All']], 'active')}</div>
      ${list.length ? `<div class="group">${list.slice(0, ui.lim.res || 60).map(r => { const due = resDue(r.id); return li({ lead: avatar(r.name), t: r.name, d: `${blocksOn() && !blockScope() ? blockName(resBlock(r)) + ' · ' : ''}${roomName(r.roomId)}-${r.bed} · ${r.phone}${r.status !== 'active' ? ' · ' + t(r.status === 'left' ? 'Left' : 'On notice') : ''}`, end: due ? `<b class="${resOverdue(r.id) ? 'bad-t' : ''}">${inr(due)}</b>` : badge('Paid', 'ok'), act: 'go', attrs: `data-to="residents/${r.id}"` }); }).join('')}</div>${list.length > (ui.lim.res || 60) ? `<div style="text-align:center;margin-top:12px">${btn('Show more', 'more', 'data-key="res" data-per="60"', 'sm')}</div>` : ''}` : `<div class="card">${empty('No residents found', 'Try another search or filter.')}</div>`}`;
  },
};
function residentDetail(id) {
  if (ctx().role === 'emitra') {
    setTimeout(() => go('emitra'), 0);
    return `<div class="card">${empty('Access Restricted', 'Your account is restricted to the E-Mitra Police Verification Queue.', btn('Open Queue', 'go', 'data-to="emitra"', 'primary'))}</div>`;
  }
  const r = resById(id);
  if (!r) {
    if (typeof reconcileBeds === 'function') reconcileBeds();
    return `<div class="card">${empty('Resident not found', t('This resident record does not exist or has been removed.'), btn('Back to Residents', 'go', 'data-to="residents"', 'primary'))}</div>`;
  }
  const showFin = can('payments');
  const due = resDue(id), inv = resInvoices(id).slice().reverse(), pays = resPays(id);
  const living = r.status !== 'left';
  const pen = penaltyDue(id), ahead = advPaidAhead(id);
  const ld = Store.all('laundry').filter(l => l.resId === id && ymOf(l.date) === ymOf(today()));
  return `<div class="row" style="margin:6px 0 10px">${btn('Residents', 'go', 'data-to="residents"', 'ghost sm', 'back')}</div>
    <div class="hero ${showFin && due ? '' : 'ok'}"><div class="row nw" style="gap:14px">${avatar(r.name)}<div style="min-width:0;flex:1"><b style="font-size:20px">${esc(r.name)}</b><div class="muted sm">${blocksOn() ? esc(blockName(resBlock(r))) + ' · ' : ''}${esc(roomName(r.roomId))}-${esc(r.bed)} · ${t('since')} ${fmtDate(r.checkIn)}${r.status === 'left' ? ' · ' + t('left') + ' ' + fmtDate(r.left) : ''}</div></div></div>
      ${showFin ? `<div style="margin-top:14px" class="muted sm">${esc(t(due ? 'Total due' : 'No dues'))}</div><div class="big">${inr(due)}</div>${r.credit > 0 ? `<div class="sm">${esc(t('Advance credit'))}: ${inr(r.credit)}</div>` : ''}${pen > 0 ? `<div class="sm bad-t">${esc(t('Includes penalty'))}: ${inr(pen)}</div>` : ''}${ahead.length ? `<div class="sm ok-t">${esc(t('Rent paid up to {m}', { m: fmtYM(ahead[ahead.length - 1]) }))}</div>` : ''}` : ''}
      <div class="row" style="margin-top:14px">${showFin && living ? btn('Record payment', 'pay', `data-res="${id}"`, 'primary sm', 'rupee') : ''}${showFin && due ? btn('Send bill', 'sendbill', `data-res="${id}"`, 'sm', 'wa') : `<a class="btn sm" href="${esc(waUrl(r.phone, `Hi ${r.name.split(' ')[0]}, `))}" target="_blank" rel="noopener">${ico('wa', 'sm')}WhatsApp</a>`}<a class="btn sm" href="tel:${esc(r.phone)}">${ico('phone', 'sm')}${esc(t('Call'))}</a></div></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="stack">
        ${showFin ? group('Bills', inv.slice(0, 12).map(i => li({ icon: i.type === 'electricity' ? 'bolt' : i.type === 'laundry' ? 'shirt' : i.type === 'deposit' ? 'wallet' : 'rupee', ic: invStat(i) === 'paid' ? 'ok' : invStat(i) === 'overdue' ? 'bad' : 'info', t: i.title, d: `${inr(i.amount)} · ${t('due')} ${fmtShort(i.due)}${i.discount > 0 ? ' · ' + t('discount') + ' ' + inr(i.discount) : ''}${i.paid && invBal(i) ? ' · ' + t('paid') + ' ' + inr(i.paid) : ''}`, end: invBal(i) ? `<b>${inr(invBal(i))}</b>` : statBadge('paid'), act: isAdmin() ? 'invedit' : '', attrs: `data-id="${i.id}"` })).join(''), isAdmin() ? `<a href="#" data-act="addinv" data-res="${id}">+ ${esc(t('Add a one-time charge'))}</a>` : '') : ''}
        ${showFin ? group('Payments', pays.length ? li({
    icon: 'check', ic: 'ok',
    t: t('{n} payments · {a}', { n: pays.filter(x => !x.reversed).length, a: inr(sum(pays.filter(x => !x.reversed), x => x.amount)) }),
    d: t('Last {a} on {d}', { a: inr(pays[0].amount), d: fmtDate(pays[0].date) }),
    act: 'respays', attrs: `data-id="${id}"`,
  }) : li({ icon: 'check', ic: 'mute', t: t('No payments yet'), chev: false })) : ''}
        ${penCard(r)}
        ${pvCard(r)}
      </div>
      <div class="stack">
        ${group('Details', [
    li({ icon: 'phone', ic: 'ok', t: r.phone, d: t('Mobile') }),
    r.guardianPhone ? li({ icon: 'users', ic: 'info', t: `${r.guardian || t('Guardian')} · ${r.guardianPhone}`, d: t('Guardian') }) : '',
    showFin ? li({ icon: 'rupee', ic: 'warn', t: `${inr(r.rent)} / ${t('month')}`, d: `${t('Deposit')} ${inr(r.deposit)}` }) : '',
    r.college ? li({ icon: 'building', ic: 'mute', t: r.college, d: t('College / office') }) : '',
    li({ icon: 'utensils', ic: 'teal', t: t(r.food !== false ? 'Takes mess food' : 'No mess food'), d: orgEnabled('laundry') ? t('Laundry this month: {n} clothes', { n: sum(ld, l => l.pcs) }) : '' }),
  ].filter(Boolean).join(''))}
        ${docsCard(r)}
        ${agrCard(r)}
        ${group('App login', r.username ? [li({ icon: 'key', ic: 'ok', t: '@' + r.username, d: t('Password: their mobile number unless they changed it') }), li({ icon: 'lock', ic: 'warn', t: t('Reset password to mobile number'), act: 'respw', attrs: `data-id="${id}"` }), li({ icon: 'wa', ic: 'ok', t: t('Send login on WhatsApp'), act: 'reswelcome', attrs: `data-id="${id}"` })].join('') : li({ icon: 'key', ic: 'mute', t: t('No login yet'), act: living ? 'reslogin' : '', attrs: `data-id="${id}"`, end: living ? badge('Create', 'acc') : '' }))}
        ${living && isAdmin() ? group('Actions', [li({ icon: 'edit', t: t('Edit details'), act: 'resedit', attrs: `data-id="${id}"` }), li({ icon: 'repeat', ic: 'info', t: t('Shift / Swap bed'), act: 'resshift', attrs: `data-id="${id}"` }), li({ icon: 'cal', ic: 'teal', t: t('Leave (meals off)'), act: 'resleave', attrs: `data-id="${id}"` }), li({ icon: 'alert', ic: 'bad', t: t('Add penalty / fine'), act: 'penadd', attrs: `data-id="${id}"` }), li({ icon: 'clock', ic: 'warn', t: r.status === 'notice' ? t('Cancel notice') : t('Give notice (plan checkout)'), act: 'resnotice', attrs: `data-id="${id}"` }), li({ icon: 'door', ic: 'bad', t: t('Check out'), act: 'resout', attrs: `data-id="${id}"` })].join('')) : (!living ? (() => { const d = Store.all('dep').find(x => x.resId === id); return d ? group('Actions', li({ icon: 'file', ic: 'ok', t: t('View Settlement Statement'), act: 'depstatement', attrs: `data-id="${d.id}"` })) : ''; })() : '')}
      </div>
    </div>`;
}
A.resedit = el => {
  const r = resById(el.dataset.id);
  formModal({
    title: 'Edit resident', fields: [
      { name: 'name', label: 'Full name', value: r.name, required: true, maxlength: 80 }, { name: 'phone', label: 'Mobile (WhatsApp)', type: 'tel', value: r.phone, required: true, maxlength: 10, placeholder: '10-digit mobile' },
      { name: 'guardian', label: 'Parent / guardian name', value: r.guardian, maxlength: 80 }, { name: 'guardianPhone', label: 'Guardian mobile', type: 'tel', value: r.guardianPhone, maxlength: 10, placeholder: '10-digit mobile' },
      { name: 'college', label: 'College / office', value: r.college, maxlength: 120 }, { name: 'idNo', label: 'Aadhaar card number', value: r.idNo, maxlength: 12, placeholder: '12-digit Aadhaar' },
      { name: 'rent', label: 'Monthly rent (₹)', type: 'number', value: r.rent, min: 0, max: 500000, required: true, hint: t('Applies from the next bill.') }, { name: 'lang', label: 'WhatsApp language', type: 'select', options: [{ v: 'en', l: 'English' }, { v: 'hi', l: 'हिन्दी' }], value: r.lang },
      { name: 'food', label: 'Takes mess food', type: 'checkbox', value: r.food !== false }, { name: 'address', label: 'Home address', value: r.address, full: true, maxlength: 240 },
    ],
    onSubmit: v => {
      const was = r.phone, now = phone10(v.phone);
      Store.patch(r.id, { ...v, phone: now, guardianPhone: phone10(v.guardianPhone) });
      // Their password was set from the OLD number and does not follow it. Say so, and offer the fix
      // in one tap, rather than leaving a resident who tries the new number and is refused.
      if (r.userId && was !== now) toast(t('Mobile changed. Their login password is still the old number.'), 'ok', { label: t('Reset to new'), run: () => A.respw({ dataset: { id: r.id } }) });
      else toast('Saved');
    },
  });
};
A.resshift = el => {
  const r = resById(el.dataset.id);
  if (!r) return;
  const vac = vacantBeds();
  const others = activeRes().filter(x => x.id !== r.id);

  if (!vac.length && !others.length) {
    return toast(t('No other beds or residents available to shift or swap with'), 'bad');
  }

  const defMode = vac.length ? 'shift' : 'swap';
  const modeOptions = [];
  if (vac.length) modeOptions.push({ v: 'shift', l: t('Shift to vacant bed') });
  if (others.length) modeOptions.push({ v: 'swap', l: t('Swap bed with another resident') });

  const swapTargetOptions = others.map(x => ({
    v: x.id,
    l: `${x.name} · ${roomName(x.roomId)}-${x.bed} (${inr(x.rent)}/mo)`
  }));

  const initialTarget = others[0] || null;

  const fields = [
    ...(modeOptions.length > 1 ? [{
      name: 'mode',
      label: 'Action type',
      type: 'select',
      value: defMode,
      options: modeOptions,
      required: true,
      info: t('Shift moves into an empty bed. Swap exchanges beds between two living residents.')
    }] : [
      { name: 'mode', type: 'select', value: defMode, options: modeOptions, hidden: true }
    ]),
    // ---- SHIFT FIELDS ----
    ...(vac.length ? [
      {
        name: 'bed',
        label: 'New room & bed',
        type: 'select',
        options: bedOptions(vac, x => `${x.room.no}-${x.bed.id} · ${inr(x.room.rent)}`),
        required: true,
        hidden: defMode !== 'shift'
      },
      {
        name: 'rent',
        label: t('New monthly rent for {n} (₹)', { n: r.name.split(' ')[0] }),
        type: 'number',
        value: vac[0] ? (roomById(vac[0].room.id) || {}).rent : r.rent,
        min: 0,
        hidden: defMode !== 'shift'
      },
      ...meterField(r.roomId, 'meterOld', 'Meter reading in room they are leaving').map(f => ({ ...f, hidden: defMode !== 'shift' })),
      ...meterField(vac[0] ? vac[0].room.id : '', 'meterNew', 'Meter reading in new room').map(f => ({ ...f, hidden: defMode !== 'shift' }))
    ] : []),
    // ---- SWAP FIELDS ----
    ...(others.length ? [
      {
        name: 'swapResId',
        label: 'Swap bed with resident',
        type: 'select',
        options: swapTargetOptions,
        value: initialTarget ? initialTarget.id : '',
        required: true,
        hidden: defMode !== 'swap',
        info: t("Select the resident who will take {n}'s bed while {n} takes theirs.", { n: r.name.split(' ')[0] })
      },
      {
        name: 'rentMode',
        label: 'Rent calculation',
        type: 'select',
        options: [
          { v: 'keep', l: t('Keep current rents (no change in amounts)') },
          { v: 'room', l: t('Inherit room standard rents') },
          { v: 'custom', l: t('Specify custom rents') }
        ],
        value: 'keep',
        hidden: defMode !== 'swap'
      },
      {
        name: 'rentA',
        label: t('New monthly rent for {n} (₹)', { n: r.name.split(' ')[0] }),
        type: 'number',
        value: r.rent,
        min: 0,
        hidden: defMode !== 'swap'
      },
      {
        name: 'rentB',
        label: initialTarget ? t('New monthly rent for {n} (₹)', { n: initialTarget.name.split(' ')[0] }) : t('New monthly rent for other resident (₹)'),
        type: 'number',
        value: initialTarget ? initialTarget.rent : 0,
        min: 0,
        hidden: defMode !== 'swap'
      },
      {
        name: 'swapReason',
        label: 'Reason / note for swap',
        type: 'text',
        placeholder: 'e.g. Mutual swap requested by residents',
        hidden: defMode !== 'swap'
      },
      ...meterField(r.roomId, 'meterA', t('Meter reading in {n}\'s room before swap', { n: r.name.split(' ')[0] })).map(f => ({ ...f, hidden: defMode !== 'swap' })),
      ...meterField(initialTarget ? initialTarget.roomId : '', 'meterB', t('Meter reading in other resident\'s room before swap')).map(f => ({ ...f, hidden: defMode !== 'swap' }))
    ] : [])
  ];

  formModal({
    title: `${t('Shift / Swap Bed')} · ${r.name}`,
    fields,
    onChange: (v, form, ch) => {
      const mode = v.mode || defMode;
      const isShift = mode === 'shift';
      showField(form, 'bed', isShift);
      showField(form, 'rent', isShift);
      showField(form, 'meterOld', isShift);
      showField(form, 'meterNew', isShift);

      showField(form, 'swapResId', !isShift);
      showField(form, 'rentMode', !isShift);
      showField(form, 'rentA', !isShift);
      showField(form, 'rentB', !isShift);
      showField(form, 'swapReason', !isShift);
      showField(form, 'meterA', !isShift);
      showField(form, 'meterB', !isShift);

      if (isShift) {
        if (ch === 'bed' && v.bed) {
          const targetRoomId = v.bed.split('|')[0];
          setField(form, 'rent', (roomById(targetRoomId) || {}).rent || r.rent);
        }
      } else {
        const target = resById(v.swapResId);
        if (target) {
          const lB = form.querySelector('[data-fw="rentB"] label');
          if (lB && lB.childNodes && lB.childNodes[0]) {
            lB.childNodes[0].nodeValue = `${t('New monthly rent for {n} (₹)', { n: target.name.split(' ')[0] })} `;
          }
          if (ch === 'swapResId' || ch === 'rentMode' || ch === 'mode') {
            if (v.rentMode === 'room') {
              const rRoom = roomById(r.roomId);
              const tRoom = roomById(target.roomId);
              setField(form, 'rentA', (tRoom || {}).rent || r.rent);
              setField(form, 'rentB', (rRoom || {}).rent || target.rent);
            } else if (v.rentMode === 'keep') {
              setField(form, 'rentA', r.rent);
              setField(form, 'rentB', target.rent);
            }
          }
        }
      }
    },
    preview: v => {
      const mode = v.mode || defMode;
      if (mode === 'shift') {
        if (!v.bed) return '';
        const [rid, b] = v.bed.split('|');
        const rm = roomById(rid);
        return `<div class="note info"><b>${esc(t('Shift Preview'))}:</b> ${esc(r.name)} moves from <b>${esc(roomName(r.roomId))}-${esc(r.bed)}</b> to <b>${esc(rm ? rm.no : rid)}-${esc(b)}</b> (Rent: ${inr(v.rent || 0)}/mo)</div>`;
      } else {
        if (!v.swapResId) return '';
        const target = resById(v.swapResId);
        if (!target) return '';
        const rA = v.rentA != null && !isNaN(v.rentA) ? v.rentA : r.rent;
        const rB = v.rentB != null && !isNaN(v.rentB) ? v.rentB : target.rent;
        return `<div class="note info">
          <b>${esc(t('Bed Swap Preview'))}:</b><br>
          • <b>${esc(r.name)}</b> moves to <b>${esc(roomName(target.roomId))}-${esc(target.bed)}</b> (${inr(rA)}/mo)<br>
          • <b>${esc(target.name)}</b> moves to <b>${esc(roomName(r.roomId))}-${esc(r.bed)}</b> (${inr(rB)}/mo)
        </div>`;
      }
    },
    onSubmit: v => {
      const mode = v.mode || defMode;
      if (mode === 'shift') {
        if (!v.bed) return 'Select a room and bed';
        const [rid, b] = v.bed.split('|');
        try {
          shiftBed(r.id, rid, b, v.rent, {
            date: today(),
            readingOld: v.meterOld != null && v.meterOld !== '' ? +v.meterOld : undefined,
            readingNew: v.meterNew != null && v.meterNew !== '' ? +v.meterNew : undefined
          });
          toast(t('{n} shifted to {rm}-{b}', { n: r.name, rm: (roomById(rid) || {}).no || rid, b }), 'ok');
          closeModal();
          render();
        } catch (e) {
          return e.message;
        }
      } else {
        if (!v.swapResId) return 'Select a resident to swap with';
        const target = resById(v.swapResId);
        if (!target) return 'Target resident not found';
        try {
          swapBeds(r.id, target.id, {
            rentA: v.rentA,
            rentB: v.rentB,
            readingA: v.meterA != null && v.meterA !== '' ? +v.meterA : undefined,
            readingB: v.meterB != null && v.meterB !== '' ? +v.meterB : undefined,
            date: today(),
            note: v.swapReason || ''
          });
          toast(t('{a} and {b} swapped beds successfully ✓', { a: r.name, b: target.name }), 'ok');
          closeModal();
          render();
        } catch (e) {
          return e.message;
        }
      }
    }
  });
};
A.resleave = el => formModal({
  title: 'Leave (meals off)', note: t('Meals are not counted for these days, so the cook makes less food.'),
  fields: [{ name: 'from', label: 'From', type: 'date', value: addDays(today(), 1), required: true }, { name: 'to', label: 'To (including)', type: 'date', value: addDays(today(), 3), required: true }, { name: 'reason', label: 'Reason' }],
  onSubmit: v => { if (v.to < v.from) return 'End date is before start date'; Store.put('leave', { resId: el.dataset.id, roomId: resById(el.dataset.id).roomId, from: v.from, to: v.to, date: v.from, reason: v.reason }); toast('Leave saved'); },
});
A.resnotice = el => {
  const r = resById(el.dataset.id);
  if (r.status === 'notice') { Store.patch(r.id, { status: 'active', planOut: null }); toast('Notice cancelled'); render(); return; }
  formModal({ title: 'Give notice', fields: [{ name: 'planOut', label: 'Planned checkout date', type: 'date', value: addDays(today(), 30), required: true }], onSubmit: v => { Store.patch(r.id, { status: 'notice', planOut: v.planOut }); toast('Notice recorded'); } });
};
A.resout = el => {
  const r = resById(el.dataset.id);
  if (!r) return toast('Resident not found', 'bad');

  formModal({
    title: `${t('Check out & Settlement')} · ${r.name}`,
    submit: t('Settle Accounts & Check out'),
    fields: [
      { name: 'date', label: 'Checkout date', type: 'date', value: today(), required: true },
      ...meterField(r.roomId),
      { name: 'ded', label: 'Damage / maintenance deductions (₹)', type: 'number', value: 0, min: 0 },
      {
        name: 'settleAction',
        label: 'Settlement Decision (Zero-Due Guarantee)',
        type: 'select',
        options: [
          { v: 'auto_zero', l: t('⚡ Zero-Due Guarantee (Collect Remaining / Pay Refund Now)') },
          { v: 'waive_balance', l: t('🎁 Waive / Discount Remaining Dues (Clear to ₹0)') },
          { v: 'refund_later', l: t('⏳ Refund Later (Approval via Inbox)') },
          { v: 'leave_debt', l: t('⚠️ Allow Exit with Debt (Leave Dues Hanging)') }
        ],
        value: 'auto_zero'
      },
      {
        name: 'payMode',
        label: 'Settlement Mode (Cash / UPI / Bank)',
        type: 'select',
        options: [
          { v: 'upi', l: '📱 UPI (PhonePe / GPay / Paytm)' },
          { v: 'cash', l: '💵 Cash' },
          { v: 'bank', l: '🏛️ Bank Transfer / NEFT' }
        ],
        value: 'upi'
      },
      { name: 'payRef', label: 'Transaction Reference / UTR (optional)', placeholder: t('e.g. 432198765432 or Cash given') },
      { name: 'note', label: 'Exit / Settlement Note', full: true, placeholder: t('e.g. Cleared all accounts, keys handed over') }
    ],
    preview: v => {
      let stmt;
      try {
        stmt = calcSettlement({
          resId: r.id,
          checkoutDate: v.date || today(),
          deductions: v.ded || 0,
          notes: v.note || '',
          reading: v.meterNow
        });
      } catch (err) {
        return `<div class="note bad">${esc(err.message)}</div>`;
      }

      const elecRow = stmt.elecShare ? `
        <div style="background:var(--subtle);padding:10px 12px;border-radius:8px;margin:8px 0;font-size:12px;border-left:3px solid var(--accent)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b>⚡ ${esc(t('Final Electricity Reading & Bill'))}:</b>
            <b class="ok-t" style="font-size:14px">${inr(stmt.elecShare.amount)}</b>
          </div>
          <div class="muted xs" style="margin-top:3px">
            ${esc(t('Room Reading'))}: <b>${num(stmt.elecShare.prev)} → ${num(stmt.elecShare.curr)}</b> (${num(stmt.elecShare.roomUnits)} ${t('units')})<br>
            ${esc(t('Resident share'))}: ${num(stmt.elecShare.units)} units - ${num(stmt.elecShare.free)} free = <b>${num(stmt.elecShare.billable)} billable units</b> @ ₹${stmt.elecShare.rate}/unit
          </div>
        </div>
      ` : '';

      let bannerHtml = '';
      if (stmt.refund > 0) {
        bannerHtml = `
          <div class="card" style="background:rgba(52,199,89,0.1);border:1px solid rgba(52,199,89,0.3);padding:12px;border-radius:8px;margin-top:10px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <b style="color:var(--ok);font-size:15px">🎉 ${esc(t('Net Refund to Resident'))}</b>
                <div class="xs muted">${esc(t('Deposit ₹{d} - Dues ₹{l}', { d: inr(stmt.depositPaid), l: inr(stmt.totalLiabilities) }))}</div>
              </div>
              <div style="font-size:20px;font-weight:800;color:var(--ok)">${inr(stmt.refund)}</div>
            </div>
            <div class="xs" style="margin-top:6px;color:var(--ok)">
              ${v.settleAction === 'refund_later' ? esc(t('Will wait for owner approval in Inbox.')) : esc(t('Will be refunded immediately via {m} and resident account closed with ₹0 due ✓', { m: (v.payMode || 'UPI').toUpperCase() }))}
            </div>
          </div>
        `;
      } else if (stmt.balancePayable > 0) {
        bannerHtml = `
          <div class="card" style="background:rgba(255,59,48,0.08);border:1px solid rgba(255,59,48,0.25);padding:12px;border-radius:8px;margin-top:10px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <b style="color:var(--bad);font-size:15px">⚠️ ${esc(t('Net Balance to Collect'))}</b>
                <div class="xs muted">${esc(t('Total Dues ₹{l} - Deposit ₹{d}', { l: inr(stmt.totalLiabilities), d: inr(stmt.depositPaid) }))}</div>
              </div>
              <div style="font-size:20px;font-weight:800;color:var(--bad)">${inr(stmt.balancePayable)}</div>
            </div>
            <div class="xs" style="margin-top:6px">
              ${v.settleAction === 'waive_balance'
                ? `<b style="color:var(--accent)">${esc(t('Action: ₹{a} will be waived / discounted. Resident checks out with ₹0 due ✓', { a: inr(stmt.balancePayable) }))}</b>`
                : v.settleAction === 'leave_debt'
                ? `<b style="color:var(--bad)">${esc(t('Warning: Resident will leave with ₹{a} unpaid debt hanging under their name.', { a: inr(stmt.balancePayable) }))}</b>`
                : `<b style="color:var(--ok)">${esc(t('Action: Collect ₹{a} via {m}. All invoices 100% cleared to ₹0 due ✓', { a: inr(stmt.balancePayable), m: (v.payMode || 'UPI').toUpperCase() }))}</b>`
              }
            </div>
          </div>
        `;
      } else {
        bannerHtml = `
          <div class="card" style="background:rgba(0,122,255,0.08);border:1px solid rgba(0,122,255,0.25);padding:12px;border-radius:8px;margin-top:10px;text-align:center">
            <b style="color:var(--accent);font-size:15px">✓ ${esc(t('Accounts Perfectly Balanced (₹0 Due)'))}</b>
            <div class="xs muted" style="margin-top:4px">${esc(t('Deposit covers exact dues. No additional payment or refund needed.'))}</div>
          </div>
        `;
      }

      return `
        <div style="margin-bottom:10px">
          <dl class="kv">
            <dt>${esc(t('Security Deposit held'))}</dt><dd><b>${inr(stmt.depositPaid)}</b></dd>
            ${stmt.credit > 0 ? `<dt>${esc(t('Eligible Credit'))}</dt><dd>${inr(stmt.credit)}</dd>` : ''}
            <dt>${esc(t('Total Unpaid Dues'))}</dt><dd><b>${inr(stmt.unpaidDues)}</b></dd>
            ${stmt.shortfallFee > 0 ? `<dt class="warn-t">${esc(t('Notice shortfall (' + stmt.shortfallDays + 'd)'))}</dt><dd class="warn-t">${inr(stmt.shortfallFee)}</dd>` : ''}
            <dt>${esc(t('Deductions'))}</dt><dd>${inr(stmt.deductions)}</dd>
          </dl>
          ${elecRow}
          ${bannerHtml}
        </div>
      `;
    },
    onSubmit: v => {
      if (orgEnabled('electricity') && (v.meterNow != null && v.meterNow !== '')) {
        const last = lastMeter(r.roomId);
        if (last && +v.meterNow < last.curr) {
          return t('Reading cannot be less than previous ({p})', { p: last.curr });
        }
      }

      let settleBalance = 'pay';
      if (v.settleAction === 'waive_balance') settleBalance = 'waive';
      else if (v.settleAction === 'leave_debt') settleBalance = 'debt';

      const refundNow = v.settleAction !== 'refund_later';

      try {
        const dep = checkout(r.id, v.date, v.ded || 0, v.note, {
          reading: v.meterNow,
          settleBalance,
          payMode: v.payMode || 'cash',
          payRef: v.payRef || '',
          waiveReason: v.note || 'Waived at checkout settlement',
          refundNow,
          refundMode: v.payMode || 'cash',
          refundRef: v.payRef || ''
        });

        if (v.settleAction === 'leave_debt') {
          toast(t('{n} checked out · Recorded with pending dues', { n: r.name }), 'warn');
        } else {
          toast(t('{n} checked out · Accounts settled to ₹0 ✓', { n: r.name }), 'ok');
        }

        closeModal();
        render();

        if (dep) {
          A.depstatement({ dataset: { id: dep.id } });
        }

        if (S().wa.auto) {
          waOpen(r.phone, tpl('checkout', {
            name: r.name.split(' ')[0],
            hostel: hostelName(),
            deposit: rs(dep.deposit),
            deduct: rs(dep.settled + dep.deductions),
            refund: rs(dep.refund)
          }, waLang(r)), 'Send checkout message');
        }
      } catch (e) {
        return e.message;
      }
    },
  });
};
A.checkout = A.resout;
A.reslogin = async el => {
  const r = resById(el.dataset.id);
  try { const u = await createResidentLogin(r); toast(t('Login created: {u}', { u: u.username })); render(); waOpen(r.phone, welcomeMessage(resById(r.id), u), 'Send login'); }
  catch (e) { toast(e.message, 'bad'); }
};
A.respw = el => {
  const r = resById(el.dataset.id), pw = phone10(r.phone);
  if (!r.userId) return toast('This resident has no login yet. Create it first.', 'bad');
  if (pw.length !== 10) return toast('Save a 10-digit mobile number first. It becomes the password.', 'bad');
  confirmBox(t('Reset {n}\'s password to their mobile number? Their old password stops working.', { n: r.name }), async () => {
    await Backend.admin('set_password', { user_id: r.userId, password: pw });
    credsSheet(t('Password reset'), r.name, r.phone, r.username || '', pw, null, 'password');
  }, 'Reset password', 'bad');
};
A.reswelcome = el => { const r = resById(el.dataset.id); waOpen(r.phone, welcomeMessage(r), 'Send login'); };
A.resdocs = el => {
  const r = resById(el.dataset.id), req = S().docs.required;
  formModal({
    title: 'Upload documents', fields: [...req.map((d, i) => ({ name: 'doc' + i, label: d, type: 'file', accept: 'image/*,application/pdf' })), { type: 'html', html: docsNote() }],
    onSubmit: v => { if (!Files.ready()) return 'Documents are not uploaded in demo mode.'; const files = req.map((d, i) => ({ type: d, file: (v['doc' + i] || [])[0] })).filter(x => x.file); if (!files.length) return 'Choose at least one file'; uploadDocs('res', r.id, files); }
  });
};
// One card for everything on file. A missing row is a prompt, an uploaded row is a door.
function docsCard(r) {
  const gone = docsGoneOn(r);
  if (gone && gone <= today()) return `<div class="group-t">${esc(t('Documents'))}</div><div class="group"><div class="li noic"><span class="body muted">${esc(t('Deleted {n} days after checkout', { n: DOC_KEEP_DAYS }))}</span></div></div>`;
  const have = r.docs || [], need = gone ? [] : S().docs.required.filter(d => !have.some(x => x.type === d));
  const rows = [
    ...have.map(d => li({
      icon: 'file', ic: 'ok', t: t(d.type), d: `${fmtTs(d.ts)} · ${t('Tap to open')}`,
      act: 'opendoc', attrs: `data-path="${esc(d.path || '')}" data-res="${r.id}" data-type="${esc(d.type)}"`,
    })),
    ...need.map(d => li({
      icon: 'upload', ic: 'warn', t: d, d: t('Tap to upload'),
      act: 'docadd', attrs: `data-id="${r.id}" data-type="${esc(d)}"`, end: badge('Missing', 'warn'),
    })),
  ];
  const head_ = isAdmin() ? `<div class="row" style="margin:0 0 8px">${gone ? `<span class="hint">${esc(t('Deleted on {d}', { d: fmtDate(gone) }))}</span>` : btn('Upload documents', 'resdocs', `data-id="${r.id}"`, 'sm', 'upload')}<span class="sp"></span>${have.length ? `<span class="hint">${esc(t('{n} on file', { n: have.length }))}</span>` : ''}</div>` : '';
  return `<div class="group-t">${esc(t('Documents'))}</div>${head_}<div class="group">${rows.join('') || `<div class="li noic"><span class="body muted">${esc(t('Nothing required'))}</span></div>`}</div>`;
}

async function openResidentDocViewer(resId, activeType = '', initialPath = '', forcedIdx = null) {
  const r = resById(resId);
  if (!r) return toast(t('Resident not found'), 'bad');

  // Gather all available documents for this resident into a unified viewer collection
  const allDocs = [];

  for (const d of (r.docs || [])) {
    allDocs.push({
      id: 'doc-' + slug(d.type),
      type: d.type,
      label: d.type,
      path: d.path,
      ts: d.ts,
      kind: 'file'
    });
  }

  if (r.pv && (r.pv.certificatePath || r.pv.refNo || (r.pv.status && r.pv.status !== 'none' && r.pv.status !== 'not_started'))) {
    allDocs.push({
      id: 'doc-pv',
      type: 'Police verification',
      label: t('Police Verification'),
      path: r.pv.certificatePath,
      pv: r.pv,
      kind: r.pv.certificatePath ? 'file' : 'pv_info'
    });
  }

  const agr = typeof getActiveAgreement === 'function' ? getActiveAgreement(r.id) : null;
  if (agr) {
    allDocs.push({
      id: 'doc-agr',
      type: 'Rental agreement',
      label: `${t('Rental Agreement')} (v${agr.version})`,
      agr,
      kind: 'agr_info'
    });
  }

  if (!allDocs.length) {
    return toast(t('No documents or KYC uploaded for {n} yet', { n: r.name }), 'warn');
  }

  let curIdx = forcedIdx != null ? forcedIdx : 0;
  if (forcedIdx == null && (activeType || initialPath)) {
    const hit = allDocs.findIndex(d => (activeType && d.type.toLowerCase() === activeType.toLowerCase()) || (initialPath && d.path === initialPath));
    if (hit >= 0) curIdx = hit;
  }
  if (curIdx < 0 || curIdx >= allDocs.length) curIdx = 0;

  const curDoc = allDocs[curIdx];

  openModal({
    title: `${esc(r.name)} · ${esc(curDoc.label)}`,
    wide: true,
    body: `<div style="text-align:center;padding:32px 16px"><div class="spin"></div><p class="muted sm" style="margin-top:10px">${esc(t('Loading document viewer…'))}</p></div>`
  });

  let fileUrl = null;
  let isPdf = false;
  if (curDoc.kind === 'file' && curDoc.path) {
    try {
      fileUrl = await Files.url(curDoc.path);
      isPdf = curDoc.path.toLowerCase().endsWith('.pdf') || (fileUrl && fileUrl.includes('.pdf'));
    } catch (err) {
      fileUrl = null;
    }
  }

  const tabsHtml = allDocs.length > 1 ? `
    <div class="row nw" style="gap:8px;padding-bottom:10px;margin-bottom:14px;border-bottom:1px solid var(--line);overflow-x:auto;-webkit-overflow-scrolling:touch">
      ${allDocs.map((d, i) => `
        <button type="button" class="btn sm ${i === curIdx ? 'primary' : 'ghost'}" data-act="resdoctab" data-res="${r.id}" data-idx="${i}" style="white-space:nowrap">
          ${ico(d.type.toLowerCase().includes('photo') ? 'user' : (d.type.toLowerCase().includes('police') ? 'shield' : 'file'), 'xs')}
          ${esc(d.label)}
        </button>
      `).join('')}
    </div>
  ` : '';

  let viewerBody = '';
  if (curDoc.kind === 'file') {
    if (fileUrl) {
      if (isPdf) {
        viewerBody = `
          <div style="width:100%;height:62vh;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:var(--surface)">
            <iframe src="${esc(fileUrl)}" style="width:100%;height:100%;border:none" title="${esc(curDoc.label)}"></iframe>
          </div>
        `;
      } else {
        viewerBody = `
          <div style="text-align:center;background:var(--subtle,#f8fafc);border-radius:12px;padding:16px;max-height:62vh;overflow:auto;display:flex;align-items:center;justify-content:center">
            <img src="${esc(fileUrl)}" style="max-width:100%;max-height:58vh;border-radius:8px;box-shadow:var(--shadow);object-fit:contain" alt="${esc(curDoc.label)}">
          </div>
        `;
      }
    } else {
      viewerBody = `
        <div class="card" style="text-align:center;padding:32px 16px;background:var(--subtle,#f8fafc)">
          ${ico('file', 'lg')}
          <div style="font-weight:700;font-size:15px;margin-top:8px">${esc(curDoc.label)}</div>
          <p class="muted sm" style="margin:4px 0 0">${esc(t('Document file path: {p}', { p: curDoc.path || 'Local demo mode' }))}</p>
        </div>
      `;
    }
  } else if (curDoc.kind === 'pv_info') {
    const pv = curDoc.pv || {};
    viewerBody = `
      <div class="card" style="padding:18px;background:var(--subtle,#f8fafc);border-radius:12px">
        <div class="row sb" style="margin-bottom:12px">
          <div style="font-size:16px;font-weight:700">${ico('shield', 'sm')} ${esc(t('Police Verification Record'))}</div>
          <span class="badge ${pv.status === 'verified' ? 'ok' : 'warn'}">${esc(t(pv.status === 'verified' ? 'Verified' : 'Submitted'))}</span>
        </div>
        <dl class="kv" style="font-size:13.5px">
          <dt><b>${esc(t('Reference / Ack No.'))}</b></dt><dd><b>${esc(pv.refNo || '—')}</b></dd>
          <dt>${esc(t('Date'))}</dt><dd>${fmtDate(pv.date || today())}</dd>
          <dt>${esc(t('Verified By'))}</dt><dd>${esc(pv.verifiedBy || 'PG Admin')}</dd>
          ${pv.notes ? `<dt>${esc(t('Operator Notes'))}</dt><dd>${esc(pv.notes)}</dd>` : ''}
        </dl>
      </div>
    `;
  } else if (curDoc.kind === 'agr_info') {
    const agr = curDoc.agr || {};
    const text = agr.documentText || agr.text || t('Rental agreement between {h} and {n}.', { h: hostelName(), n: r.name });
    viewerBody = `
      <div class="card" style="padding:16px;background:var(--subtle,#f8fafc);border-radius:12px;max-height:60vh;overflow:auto">
        <div class="row sb" style="margin-bottom:10px">
          <b>${esc(t('Agreement Document Terms'))}</b>
          <span class="badge ${agr.emailStatus === 'delivered' ? 'ok' : 'mute'}">${esc(agr.emailStatus || 'created')}</span>
        </div>
        <div style="white-space:pre-wrap;font-family:monospace;font-size:12.5px;line-height:1.6;color:var(--ink)">
          ${esc(text)}
        </div>
      </div>
    `;
  }

  openModal({
    title: `${esc(r.name)} · ${esc(curDoc.label)}`,
    wide: true,
    body: `
      ${tabsHtml}
      ${viewerBody}
    `,
    foot: `
      ${fileUrl ? `<a href="${esc(fileUrl)}" download="${slug(r.name)}-${slug(curDoc.type)}" target="_blank" rel="noopener" class="btn sm">${ico('download', 'sm')} ${esc(t('Download / Full View'))}</a>` : ''}
      <span class="sp"></span>
      <button type="button" class="btn primary sm" data-act="close">${esc(t('Close'))}</button>
    `
  });
}

A.resdoctab = el => {
  const resId = el.dataset.res;
  const idx = parseInt(el.dataset.idx, 10);
  openResidentDocViewer(resId, null, null, idx);
};
// Asks for one named document, so the owner does not scroll a form of five file pickers to
// add the one that is missing.
A.docadd = el => {
  const r = resById(el.dataset.id), type = el.dataset.type; if (!r) return;
  formModal({
    title: type, submit: 'Upload',
    fields: [{ name: 'file', label: 'Photo or PDF', type: 'file', required: true, accept: 'image/*,application/pdf' }, { type: 'html', html: docsNote() }],
    onSubmit: v => {
      if (!Files.ready()) return 'Documents are not uploaded in demo mode.';
      const f = (v.file || [])[0]; if (!f) return 'Choose a file';
      uploadDocs('res', r.id, [{ type, file: f }]);
    },
  });
};
function agrCard(r) {
  const agr = typeof getActiveAgreement === 'function' ? getActiveAgreement(r.id) : null;
  const rows = [];
  if (agr) {
    const expired = agr.endDate && agr.endDate < today();
    const emailStat = agr.emailStatus || 'not_sent';
    const emailBadge = emailStat === 'delivered' ? badge('Email Delivered', 'ok') : (emailStat === 'sent' ? badge('Email Sent', 'info') : (emailStat === 'failed' ? badge('Email Failed', 'bad') : (emailStat === 'queued' ? badge('Email Queued', 'warn') : badge('Email Not Sent', 'mute'))));
    rows.push(li({
      icon: 'file', ic: expired ? 'bad' : 'ok',
      t: `${t('Rental agreement')} (v${agr.version}) · ${emailBadge}`,
      d: `${fmtDate(agr.startDate)} – ${fmtDate(agr.endDate)} · ${inr(agr.rent)}/mo · ${inr(agr.deposit)} ${t('deposit')}${agr.emailRecipient ? ` · ${esc(agr.emailRecipient)}` : ''}`,
      act: 'agrview', attrs: `data-id="${agr.id}"`,
      end: `${expired ? badge('Expired', 'bad') : badge('Active', 'ok')} ${btn('Email', 'agrresendemail', `data-id="${agr.id}"`, 'sm ghost', 'mail')}`
    }));
  }
  const head_ = isAdmin() ? `<div class="row" style="margin:0 0 8px">${agr ? btn('Renew', 'agrrenew', `data-id="${agr.id}"`, 'sm', 'repeat') : btn('Create agreement', 'agrcreate', `data-id="${r.id}"`, 'sm', 'file')}<span class="sp"></span>${agr ? `<span class="hint">v${agr.version}</span>` : ''}</div>` : '';
  return `<div class="group-t">${esc(t('Rental Agreement'))}</div>${head_}<div class="group">${rows.join('') || li({ icon: 'file', ic: 'mute', t: t('No agreement generated yet'), act: isAdmin() ? 'agrcreate' : '', attrs: `data-id="${r.id}"`, end: isAdmin() ? badge('Create', 'acc') : '' })}</div>`;
}

A.agrcreate = el => {
  const r = resById(el.dataset.id); if (!r) return;
  formModal({
    title: `${t('Create agreement')} · ${r.name}`,
    fields: [
      { name: 'startDate', label: 'Start date', type: 'date', value: r.checkIn || today(), required: true },
      { name: 'endDate', label: 'End date', type: 'date', value: addDays(r.checkIn || today(), 335), required: true },
      { name: 'rent', label: 'Monthly rent (₹)', type: 'number', value: r.rent, required: true },
      { name: 'deposit', label: 'Security deposit (₹)', type: 'number', value: r.deposit, required: true },
      { name: 'noticeDays', label: 'Notice period (days)', type: 'number', value: 30, required: true }
    ],
    onSubmit: v => {
      try {
        const agr = createAgreement({
          resId: r.id,
          startDate: v.startDate,
          endDate: v.endDate,
          rent: v.rent,
          deposit: v.deposit,
          noticeDays: v.noticeDays
        });
        closeModal();
        if (r.email && isValidEmail(r.email)) {
          try {
            sendAgreementEmail(agr.id);
            toast(t('Agreement generated & email sent to {e} ✓', { e: r.email }), 'ok');
          } catch (e) {
            toast(t('Agreement generated, email delivery queued: {m}', { m: e.message }), 'warn');
          }
        } else {
          toast(t('Agreement generated successfully ✓'), 'ok');
        }
        render();
      } catch (e) {
        return e.message;
      }
    }
  });
};

A.agrresendemail = el => {
  const agrId = el.dataset.id;
  try {
    const res = sendAgreementEmail(agrId, { forceResend: true });
    toast(t('Agreement email dispatched to {e} ✓', { e: res.recipient || 'resident' }), 'ok');
    render();
  } catch (err) {
    toast(t('Failed to send email: {m}', { m: err.message }), 'bad');
  }
};

A.agrrenew = el => {
  const agr = Store.get(el.dataset.id); if (!agr) return;
  formModal({
    title: `${t('Renew agreement')} · v${agr.version}`,
    fields: [
      { name: 'newEndDate', label: 'New end date', type: 'date', value: addDays(agr.endDate || today(), 335), required: true },
      { name: 'rent', label: 'Monthly rent (₹)', type: 'number', value: agr.rent, required: true },
      { name: 'deposit', label: 'Security deposit (₹)', type: 'number', value: agr.deposit, required: true },
      { name: 'noticeDays', label: 'Notice period (days)', type: 'number', value: agr.noticeDays || 30, required: true }
    ],
    onSubmit: v => {
      try {
        renewAgreement(agr.id, {
          newEndDate: v.newEndDate,
          rent: v.rent,
          deposit: v.deposit,
          noticeDays: v.noticeDays
        });
        closeModal();
        render();
        toast('Agreement renewed successfully', 'ok');
      } catch (e) {
        return e.message;
      }
    }
  });
};

A.agrview = el => {
  const agr = Store.get(el.dataset.id); if (!agr) return;
  const h = Store.hostel() || {};
  sheet(`${t('Agreement')} · ${agr.resident.name} (v${agr.version})`, `<div class="receipt" id="agrdoc" style="max-width:540px;margin:0 auto">
    <div style="text-align:center"><b style="font-size:18px">${esc(h.name || 'Hostel / PG Agreement')}</b><div class="muted xs">${esc(h.address || '')}</div><div style="text-transform:uppercase;font-size:12px;letter-spacing:1px;font-weight:600;margin-top:4px" class="muted">${esc(t('Hostel / PG Rental Agreement'))}</div><span class="badge ${agr.status === 'active' ? 'ok' : 'mute'}" style="margin-top:6px">${agr.status.toUpperCase()} · v${agr.version}</span></div><hr>
    <div class="r"><span>${esc(t('Resident'))}</span><b>${esc(agr.resident.name)}</b></div>
    <div class="r"><span>${esc(t('Mobile'))}</span><span>${esc(agr.resident.phone)}</span></div>
    <div class="r"><span>${esc(t('Room'))}</span><span>${esc(roomName(agr.resident.roomId))}</span></div>
    <div class="r"><span>${esc(t('Period'))}</span><span>${fmtDate(agr.startDate)} – ${fmtDate(agr.endDate)}</span></div>
    <div class="r"><span>${esc(t('Monthly rent'))}</span><b>${inr(agr.rent)}</b></div>
    <div class="r"><span>${esc(t('Security deposit'))}</span><b>${inr(agr.deposit)}</b></div>
    <div class="r"><span>${esc(t('Notice period'))}</span><span>${agr.noticeDays} ${esc(t('days'))}</span></div><hr>
    <div style="font-size:13px;line-height:1.4"><b>${esc(t('Standard Terms & House Rules:'))}</b><ol style="padding-left:18px;margin:8px 0">${(agr.clauses || []).map(c => `<li>${esc(c)}</li>`).join('')}</ol></div><hr>
    <div class="muted xs" style="line-height:1.3">${esc(agr.legalNotice || '')}</div></div>`,
    { foot: `<button class="btn" data-act="print">${ico('print', 'sm')} ${esc(t('Print agreement'))}</button>` });
};

A.respays = el => {
  const r = resById(el.dataset.id); if (!r) return;
  const pays = resPays(r.id);
  const activePays = pays.filter(p => !p.reversed);
  sheet(`${t('Payments')} · ${r.name}`, `<div class="group">${pays.map(p => li({
    icon: p.reversed ? 'alert' : 'check', ic: p.reversed ? 'bad' : 'ok',
    t: `${inr(p.amount)}${p.reversed ? ' · ' + t('REVERSED') : ''}`,
    d: [fmtDate(p.date), t(p.mode.toUpperCase()), p.ref, p.adv ? t('advance, {n} months', { n: p.adv.months }) : '', p.no, p.reversalReason ? `(${p.reversalReason})` : ''].filter(Boolean).join(' · '),
    act: 'receipt', attrs: `data-id="${p.id}"`,
  })).join('')}</div>`, { foot: `<span class="hint">${esc(t('{n} active payments · {a} in total', { n: activePays.length, a: inr(sum(activePays, x => x.amount)) }))}</span>` });
};
// Demo mode has no server, so join.html leaves applications in this browser; bring them in.
function importDemoSignups() {
  if (CLOUD) return;
  let list; try { list = JSON.parse(localStorage.getItem('hostelos.demo.signups') || '[]'); } catch (e) { return; }
  const mine = list.filter(v => v.h === (Store.ctx || {}).hostelId);
  if (!mine.length) return;
  for (const v of mine) {
    Store.put('signup', {
      status: 'pending', name: v.name, phone: v.phone, guardian: v.guardian, guardianPhone: v.guardianPhone,
      email: v.email, college: v.college, idNo: v.idNo, address: v.address, lang: v.lang, note: v.note, docs: v.docs || [],
      pv: { refNo: v.pvRefNo || '', state: v.pvState || '', self: !!v.pvDone }, self: true,
      date: String(v.at).slice(0, 10), ts: v.at
    });
  }
  try { localStorage.setItem('hostelos.demo.signups', JSON.stringify(list.filter(v => !mine.includes(v)))); } catch (e) { /* ignore */ }
}

// Everything the applicant sent, in one read, before the owner commits a bed to them.
A.signupview = el => {
  const a = Store.get(el.dataset.id); if (!a) return;
  const row = (k, v) => (v ? `<dt>${esc(t(k))}</dt><dd>${esc(v)}</dd>` : '');
  const docs = (a.docs || []).length
    ? `<div class="group">${a.docs.map(d => li({ icon: 'file', ic: 'ok', t: t(d.type), d: fmtTs(d.ts), act: 'opendoc', attrs: `data-path="${esc(d.path || '')}"` })).join('')}</div>`
    : `<div class="hint">${esc(t('No documents uploaded — you can ask for them after admitting.'))}</div>`;
  const pv = a.pv || {};
  sheet(a.name, `<dl class="kv">
      ${row('Mobile', a.phone)}${row('Email', a.email)}${row('College / office', a.college)}
      ${row('Aadhaar / ID number', a.idNo)}${row('Permanent address', a.address)}
      ${row('Guardian', [a.guardian, a.guardianPhone].filter(Boolean).join(' · '))}
      ${row('Language', a.lang === 'hi' ? 'हिन्दी' : 'English')}${row('They wrote', a.note)}
      ${row('Applied', fmtTs(a.ts))}
    </dl>
    <div class="group-t">${esc(t('Documents'))}</div>${docs}
    ${pv.self || pv.refNo ? group('Police verification', li({
    icon: 'shield', ic: pv.refNo ? 'ok' : 'warn',
    t: t(pv.refNo ? 'Filed by the resident' : 'Resident says they filed it'),
    d: pv.refNo ? t('Reference {n}', { n: pv.refNo }) : t('No reference number given — check before you rely on it'), chev: false
  }))
      : group('Police verification', li({ icon: 'shield', ic: 'bad', t: t('Not done'), d: t('You can start it from their page after admitting.'), chev: false }))}`,
    { foot: `<button class="btn bad" data-act="signupno" data-id="${a.id}">${esc(t('Reject'))}</button><span class="sp"></span><button class="btn primary" data-act="signupok" data-id="${a.id}">${esc(t('Admit & give a bed'))}</button>` });
};

// The only screen where the money and the bed are decided — by the owner, never the applicant.
A.signupok = el => {
  const a = Store.get(el.dataset.id); if (!a) return;
  const free = vacantBeds();
  if (!free.length) return toast('No vacant bed. Add a room or free one up first.', 'bad');
  const bedOpts = bedOptions(free, x => `${x.room.no}-${x.bed.id} · ${inr(x.room.rent)}${x.room.ac ? ' · AC' : ''}`);
  const rentOf = v => { const [rid] = String(v).split('|'); const rm = roomById(rid); return rm ? rm.rent : 0; };
  closeModal(true);
  formModal({
    title: `${t('Admit')} · ${a.name}`, submit: 'Admit resident',
    note: t('{n} filled this in themselves. You decide the bed, the rent and the deposit.', { n: a.name.split(' ')[0] }),
    fields: [
      { name: 'bed', label: 'Room & bed', type: 'select', options: bedOpts, required: true, placeholder: 'Choose a bed…' },
      { name: 'rent', label: 'Monthly rent (₹)', type: 'number', min: 0, required: true, info: t('Filled from the room when you pick a bed. Change it if this resident pays something else.') },
      { name: 'deposit', label: 'Security deposit (₹)', type: 'number', min: 0, value: 0 },
      { name: 'from', label: 'Staying from', type: 'date', value: today(), required: true, info: t('The first rent bill is worked out from this date.') },
      ...meterField(free[0] ? free[0].room.id : ''),
      { name: 'food', label: 'Takes mess food', type: 'checkbox', value: true },
      { name: 'login', label: 'Create app login and send it on WhatsApp', type: 'checkbox', value: true, info: t('User ID = mobile.hostel, password = mobile number. They can change it later.') },
    ],
    onChange: (v, form, ch) => {
      if (ch !== 'bed' || !v.bed) return;
      const rent = rentOf(v.bed);
      const el2 = form.elements.rent; if (el2 && !el2.value) el2.value = rent;
      const dep = form.elements.deposit; if (dep && !(+dep.value > 0)) dep.value = rent;
    },
    preview: v => (v.bed && v.rent >= 0 ? `${esc(t('First bill'))}: ${inr(round2((v.rent || 0) + (v.deposit || 0)))} · ${esc(t('rent is pro-rata from {d}', { d: fmtShort(v.from) }))}` : ''),
    onSubmit: async v => {
      const [roomId, bed] = v.bed.split('|');
      try { moveReading(roomId, v.meterNow, v.from); } catch (e) { return e.message; }
      const r = admitSignup(a.id, { roomId, bed, rent: v.rent, deposit: v.deposit || 0, checkIn: v.from, food: v.food });
      closeModal(); render();
      toast(t('{n} admitted', { n: r.name }), 'ok', { label: 'Open', run: () => go('residents/' + r.id) });
      if (v.login) {
        try { const u = await createResidentLogin(r); waOpen(r.phone, welcomeMessage(resById(r.id), u), 'Send login'); }
        catch (e) { toast(e.message, 'bad'); }
      }
      return false;
    },
  });
};
A.signupno = el => {
  const a = Store.get(el.dataset.id); if (!a) return;
  closeModal(true);
  formModal({
    title: `${t('Reject')} · ${a.name}`, submit: 'Reject', danger: null,
    note: t('The application is kept on record as rejected. Nothing is sent to them.'),
    fields: [{ name: 'why', label: 'Reason (for your own record)', full: true }],
    onSubmit: v => { rejectSignup(a.id, v.why); toast('Application rejected'); },
  });
};
A.exportres = () => download(`residents-${today()}.csv`, csv([['Name', 'Mobile', 'Room', 'Bed', 'Rent', 'Deposit', 'Check-in', 'Status', 'Due', 'Guardian', 'Guardian mobile', 'College'], ...residents().map(r => [r.name, r.phone, roomName(r.roomId), r.bed, r.rent, r.deposit, r.checkIn, r.status, resDue(r.id), r.guardian, r.guardianPhone, r.college])]), 'text/csv');
A.invedit = el => {
  const i = Store.get(el.dataset.id);
  if (!i) return;

  let elecHtml = '';
  let elecNote = '';
  if (i.type === 'electricity') {
    const m = Store.get(i.meterId) || Store.all('meter').find(x => x.id === i.meterId || (i.id && i.id.includes(x.id))) || lastMeter(i.roomId);
    if (m) {
      const s = (m.shares || []).find(x => x.resId === i.resId);
      elecNote = t('⚡ Meter Reading: {prev} → {curr} ({u} room units) · Rate: ₹{r}/unit{free}', {
        prev: num(m.prev),
        curr: num(m.curr),
        u: num(m.units),
        r: m.rate || S().elec.rate,
        free: s && s.free ? ` · ${s.free} ${t('free units deducted')}` : ''
      });
      elecHtml = `
        <div style="background:var(--subtle);padding:10px 12px;border-radius:8px;margin-bottom:12px;border-left:3px solid var(--accent);font-size:12.5px;line-height:1.5">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <b>⚡ ${esc(t('Room Electricity Meter & Split'))}</b>
            <button class="btn sm" type="button" data-act="meterview" data-id="${m.id}">${ico('eye', 'xs')} ${esc(t('View Room Split'))}</button>
          </div>
          <div>${esc(t('Meter Reading'))}: <b>${num(m.prev)} → ${num(m.curr)}</b> (${num(m.units)} ${esc(t('room units'))})</div>
          ${s ? `<div class="muted xs" style="margin-top:2px">${esc(t('Resident share'))}: ${num(s.units)} units - ${num(s.free)} free = <b>${num(s.billable)} billable units</b> @ ₹${m.rate || S().elec.rate}/unit</div>` : ''}
        </div>
      `;
    }
  }

  formModal({
    title: i.title,
    note: elecNote || undefined,
    submit: 'Save',
    fields: [
      ...(elecHtml ? [{ type: 'html', html: elecHtml }] : []),
      { name: 'amount', label: 'Amount (₹)', type: 'number', value: i.amount, min: 0, required: true },
      { name: 'waive', label: 'Waive (discount) ₹', type: 'number', value: i.waived || 0, min: 0 },
      { name: 'due', label: 'Due date', type: 'date', value: i.due }
    ],
    danger: !i.paid ? { label: 'Delete bill', run: () => confirmBox(t('Delete this bill?'), () => { Store.remove(i.id); toast('Bill deleted'); }, 'Delete', 'bad') } : null,
    onSubmit: v => {
      if (v.amount < (i.paid || 0)) return 'Amount cannot be less than what is already paid';
      Store.patch(i.id, { amount: v.amount, waived: v.waive || 0, due: v.due });
      toast('Bill updated');
    }
  });
};
A.depstatement = el => {
  const depId = el.dataset.id;
  const dep = Store.get(depId) || Store.all('dep').find(d => d.id === depId);
  if (!dep) return toast('Settlement statement not found', 'bad');
  const s = dep.settlement || {
    resId: dep.resId,
    checkoutDate: dep.date,
    depositPaid: dep.deposit,
    unpaidDues: dep.settled,
    deductions: dep.deductions,
    refund: dep.refund,
    balancePayable: dep.balancePayable || 0
  };
  const r = resById(dep.resId) || { name: t('Departed Resident'), phone: '' };
  const room = roomById(dep.roomId);
  const isZeroDue = resDue(dep.resId) === 0;

  const elecBreakdown = s.elecShare ? `
    <div style="background:var(--subtle);padding:10px 12px;border-radius:8px;margin:10px 0;border-left:3px solid var(--accent);font-size:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <b>⚡ ${esc(t('Final Electricity Reading & Share'))}</b>
        <b class="ok-t" style="font-size:14px">${inr(s.elecShare.amount)}</b>
      </div>
      <div>${esc(t('Room Reading'))}: <b>${num(s.elecShare.prev)} → ${num(s.elecShare.curr)}</b> (${num(s.elecShare.roomUnits)} ${t('units')})</div>
      <div class="muted" style="margin-top:2px">
        ${esc(t('Resident share'))}: ${num(s.elecShare.units)} units - ${num(s.elecShare.free)} free quota = <b>${num(s.elecShare.billable)} billable units</b> @ ₹${s.elecShare.rate}/unit
      </div>
    </div>
  ` : '';

  const unpaidItems = (s.unpaidInvoices && s.unpaidInvoices.length) ? `
    <div style="margin:10px 0;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px">
      <b class="xs uppercase muted" style="letter-spacing:0.05em">${esc(t('Itemized Dues Settled'))}</b>
      <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;font-size:12.5px">
        ${s.unpaidInvoices.map(inv => `
          <div style="display:flex;justify-content:space-between">
            <span>${esc(inv.title)}</span>
            <b>${inr(inv.balance || inv.amount)}</b>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  const html = `
    <div class="card" style="font-size:13px;line-height:1.6">
      <div style="text-align:center;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px">
        <div style="font-size:24px;margin-bottom:4px">📋</div>
        <h3 style="margin:0">${esc(t('Final Settlement Statement'))}</h3>
        <span class="muted xs">${esc(hostelName())} · ${esc(r.name)} (${esc(room ? room.no : '')})</span>
      </div>

      <div style="display:flex;justify-content:center;margin-bottom:12px">
        ${isZeroDue
          ? `<span class="badge ok" style="padding:6px 12px;font-size:13px">✓ ${esc(t('Zero-Due Guarantee: Accounts 100% Cleared (₹0 Due)'))}</span>`
          : `<span class="badge warn" style="padding:6px 12px;font-size:13px">⚠️ ${esc(t('Pending Balance on Account: {b}', { b: inr(resDue(dep.resId)) }))}</span>`
        }
      </div>

      <dl class="kv">
        <dt>${esc(t('Checkout Date'))}</dt><dd>${fmtDate(dep.date)}</dd>
        <dt>${esc(t('Security Deposit held'))}</dt><dd><b>${inr(dep.deposit)}</b></dd>
        <dt>${esc(t('Adjusted towards Dues'))}</dt><dd class="ok-t">-${inr(dep.settled)}</dd>
        ${dep.deductions > 0 ? `<dt class="bad-t">${esc(t('Damage / Maintenance Deductions'))}</dt><dd class="bad-t">-${inr(dep.deductions)}</dd>` : ''}
        ${s.shortfallFee > 0 ? `<dt class="warn-t">${esc(t('Notice Shortfall Fee'))}</dt><dd class="warn-t">-${inr(s.shortfallFee)}</dd>` : ''}
        <dt style="border-top:1px solid var(--line);padding-top:4px"><b>${esc(t('Net Refund to Resident'))}</b></dt>
        <dd style="border-top:1px solid var(--line);padding-top:4px"><b class="ok-t" style="font-size:15px">${inr(dep.refund)}</b> ${badge(dep.status || 'closed', dep.status === 'paid' ? 'ok' : 'info')}</dd>
        ${dep.balancePayable > 0 ? `
          <dt><b>${esc(t('Remaining Balance'))}</b></dt>
          <dd><b class="${isZeroDue ? 'ok-t' : 'bad-t'}">${inr(dep.balancePayable)}</b> <span class="xs muted">(${esc(dep.settleBalanceAction === 'waive' ? t('Waived') : (dep.settleBalanceAction === 'pay' ? t('Paid') : t('Unpaid')))})</span></dd>
        ` : ''}
      </dl>

      ${elecBreakdown}
      ${unpaidItems}

      ${dep.note ? `<div class="note info" style="margin-top:10px"><b>${esc(t('Settlement Note'))}:</b> ${esc(dep.note)}</div>` : ''}
    </div>
  `;

  sheet(t('Checkout Statement · {n}', { n: r.name }), html, {
    foot: `<button class="btn block" data-act="closemodal">${esc(t('Close'))}</button>`
  });
};
A.settlementview = A.depstatement;
A.addinv = el => formModal({
  title: 'Add a one-time charge', fields: [{ name: 'type', label: 'Type', type: 'select', options: Object.entries(INV_TYPES).filter(([k]) => !['rent', 'deposit'].includes(k)).map(([v, l]) => ({ v, l: t(l) })) }, { name: 'title', label: 'Description', required: true, maxlength: 80 }, { name: 'amount', label: 'Amount (₹)', type: 'number', min: 1, max: 1000000, required: true }, { name: 'due', label: 'Due date', type: 'date', value: addDays(today(), 5) }],
  onSubmit: v => { const r = resById(el.dataset.res); addInvoice({ resId: r.id, roomId: r.roomId, type: v.type, title: v.title, amount: v.amount, period: ymOf(today()), due: v.due }); toast('Charge added'); },
});

/* ===================================================================== payments */
PAGES.payments = {
  title: 'Payments', mod: 'payments',
  render() {
    const tab = curTab('pay', 'dues'), claims = Store.all('claim').filter(c => c.status === 'pending');
    const dues = dueList(), ym = ymOf(today());
    const coll = sum(payments().filter(p => ymOf(p.date) === ym && p.mode !== 'deposit'), p => p.amount);
    let body = '';
    if (tab === 'dues') {
      const list = dues.filter(x => needle('pay', x.r.name, roomName(x.r.roomId)));
      body = `<div class="tool">${searchBox('pay', 'Search resident or room')}<span class="sp"></span><div class="tool-actions">${btn(t('Monthly billing & WhatsApp'), 'monthlybatch', '', 'primary wa', 'wa')}${dues.length ? btn(t('Send bills to all ({n})', { n: dues.length }), 'billall', '', 'wa', 'wa') : ''}</div></div>
        ${list.length ? `<div class="group">${list.map(x => `<div class="li">${avatar(x.r.name)}<span class="body"><span class="t ell">${esc(x.r.name)}</span><span class="d">${esc(roomName(x.r.roomId))} · ${openInv(x.r.id).map(i => esc(t(INV_TYPES[i.type] || i.type))).filter((v, i, a) => a.indexOf(v) === i).join(', ')}${x.od ? ` · <span class="bad-t">${esc(t('overdue'))}</span>` : ''}</span></span><span class="end"><b class="${x.od ? 'bad-t' : ''}" style="margin-right:4px">${inr(x.due)}</b>${btn('', 'sendbill', `data-res="${x.r.id}" aria-label="${esc(t('Send bill'))}"`, 'sm', 'wa')}${btn('Cash', 'pay', `data-res="${x.r.id}"`, 'sm primary')}</span></div>`).join('')}</div>` : `<div class="card">${empty('No dues 🎉', 'Everyone has paid.')}</div>`}`;
    } else if (tab === 'claims') {
      const list = Store.all('claim').slice().sort(by('ts', -1)).slice(0, 80);
      body = table([
        { h: 'Resident', f: c => { const r = resById(c.resId); return r ? person(r, roomName(r.roomId)) : '—'; } },
        { h: 'Amount', f: c => `<b>${inr(c.amount)}</b>` }, { h: 'UTR', f: c => esc(c.utr || '—') }, { h: 'Date', f: c => fmtShort(c.date) },
        { h: 'Status', f: c => badge(c.status === 'pending' ? 'Pending' : c.status === 'approved' ? 'Approved' : 'Rejected', c.status === 'pending' ? 'warn' : c.status === 'approved' ? 'ok' : 'bad') },
        { h: '', acts: true, f: c => (c.status === 'pending' ? `${btn('View', 'claimview', `data-id="${c.id}"`, 'sm')}${btn('Approve', 'claimok', `data-id="${c.id}"`, 'sm ok')}` : '') },
      ], list, { key: 'claims', emptyT: 'No UPI payments yet', empty: 'When residents pay by UPI and enter the UTR in their app, it shows here.' });
    } else if (tab === 'statement') {
      const stmtTxs = Store.all('stmt_tx').slice().sort(by('ts', -1));
      const pendingClaims = Store.all('claim').filter(c => c.status === 'pending');
      const totalTxs = stmtTxs.length;
      const matchedCount = stmtTxs.filter(x => x.status === 'matched').length;
      const reviewCount = stmtTxs.filter(x => x.status === 'probable' || x.status === 'amount_mismatch' || x.status === 'multiple_candidates').length;
      const unmatchedCount = stmtTxs.filter(x => x.status === 'unmatched').length;

      const txStatusBadge = st => {
        const m = {
          matched: ['Matched & Confirmed', 'ok'],
          exact: ['Exact Match', 'ok'],
          probable: ['Review: Probable', 'info'],
          amount_mismatch: ['Amount Mismatch', 'warn'],
          multiple_candidates: ['Multiple Candidates', 'warn'],
          unmatched: ['Unmatched Credit', 'bad'],
          duplicate: ['Duplicate Ref', 'mute'],
          already_reconciled: ['Already Reconciled', 'mute']
        };
        const [lbl, cls] = m[st] || [st || 'Pending', 'warn'];
        return badge(lbl, cls);
      };

      body = `<div class="tool">${searchBox('stmt', 'Search statement transactions')}<span class="sp"></span><div class="tool-actions">${btn('Import statement (CSV)', 'importstmt', '', 'primary', 'upload')}</div></div>
        <div class="grid g4 keep2" style="margin-bottom:14px">
          ${kpi('Statement Credits', totalTxs, t('{n} claims', { n: pendingClaims.length }))}
          ${kpi('Auto-Reconciled', matchedCount, '', 'ok')}
          ${kpi('Needs Review', reviewCount, '', reviewCount ? 'warn' : '')}
          ${kpi('Unmatched Credits', unmatchedCount, '', unmatchedCount ? 'bad' : '')}
        </div>
        ${stmtTxs.length ? table([
        { h: 'Date', f: c => fmtShort(c.date) },
        { h: 'Amount', f: c => `<b>${inr(c.amount)}</b>` },
        { h: 'Ref / UTR', f: c => esc(c.ref || '—') },
        { h: 'Narration', f: c => `<span class="sm ell" style="max-width:200px;display:inline-block">${esc(c.narration || '—')}</span>` },
        { h: 'Matched Resident', f: c => { const r = c.resId && resById(c.resId); return r ? person(r, roomName(r.roomId)) : '<span class="muted sm">—</span>'; } },
        { h: 'Status', f: c => txStatusBadge(c.status) },
        { h: '', acts: true, f: c => (c.status !== 'matched' && c.status !== 'already_reconciled' ? btn('Confirm / Link', 'stmtconfirm', `data-id="${c.id}"`, 'sm ok') : badge('Reconciled', 'ok')) }
      ], stmtTxs, { key: 'stmt_txs', emptyT: 'No statement credits imported yet' }) : (`<div class="card" style="margin-bottom:12px">
          <div class="row sb"><b>${esc(t('Bank Statement Direct Reconciliation'))}</b><span class="muted sm">${esc(t('{n} pending claims', { n: pendingClaims.length }))}</span></div>
          <p class="hint" style="margin-top:6px">${esc(t('Import your bank account statement (CSV) to auto-verify resident UPI claims without gateway fees. Uniquely matching UTRs will confirm automatically, while ambiguous entries wait in your review queue.'))}</p>
        </div>` + table([
        { h: 'Date', f: c => fmtShort(c.date) },
        { h: 'Resident', f: c => { const r = resById(c.resId); return r ? person(r, roomName(r.roomId)) : '—'; } },
        { h: 'Claimed UTR', f: c => esc(c.utr || '—') },
        { h: 'Amount', f: c => `<b>${inr(c.amount)}</b>` },
        { h: 'Status', f: c => badge(c.status === 'approved' ? 'Matched' : 'Pending', c.status === 'approved' ? 'ok' : 'warn') },
        { h: '', acts: true, f: c => (c.status === 'pending' ? `${btn('Approve', 'claimok', `data-id="${c.id}"`, 'sm ok')}` : badge('Reconciled', 'mute')) }
      ], Store.all('claim').slice().sort(by('ts', -1)), { key: 'stmtclaims', emptyT: 'No statement claims' }))}`;
    } else if (tab === 'history') {
      const list = payments().filter(p => needle('payh', (resById(p.resId) || {}).name, p.ref, p.no)).sort(by('date', -1));
      body = `<div class="tool">${searchBox('payh', 'Search name, UTR, receipt')}<span class="sp"></span><div class="tool-actions">${btn('Reconcile', 'reconcilepay', '', '', 'sync')}${btn('Export', 'exportpay', '', '', 'download')}</div></div>` + table([
        { h: 'Date', f: p => fmtShort(p.date) }, { h: 'Resident', f: p => { const r = resById(p.resId); return r ? person(r, roomName(r.roomId)) : '—'; } },
        { h: 'Amount', f: p => `<b>${inr(p.amount)}</b>` }, { h: 'Mode', f: p => badge(p.mode.toUpperCase(), p.mode === 'cash' ? 'warn' : p.mode === 'deposit' ? '' : 'info') },
        { h: 'Gateway / UTR', f: p => esc(p.ref || '—') },
        { h: 'Settlement', f: p => badge(p.mode === 'cash' ? 'DIRECT CASH' : p.mode === 'deposit' ? 'DEPOSIT' : 'EASY SPLIT T+1', 'ok') },
        { h: '', acts: true, f: p => btn('Receipt', 'receipt', `data-id="${p.id}"`, 'sm') },
      ], list, { key: 'payh' });
    } else {
      const list = Store.all('dep').slice().sort(by('date', -1));
      const held = sum(activeRes(), r => sum(resInvoices(r.id).filter(i => i.type === 'deposit'), i => i.paid || 0));
      body = `<div class="grid g2 keep2" style="margin-bottom:14px">${kpi('Deposits held', inr(held), t('{n} residents', { n: activeRes().length }), '', null, 'wallet')}${kpi('Refunds pending', inr(sum(list.filter(d => d.status === 'pending'), d => d.refund)), '', 'warn', null, 'clock')}</div>` + table([
        { h: 'Resident', f: d => esc((resById(d.resId) || {}).name || '—') }, { h: 'Date', f: d => fmtShort(d.date) }, { h: 'Deposit', f: d => inr(d.deposit) }, { h: 'Adjusted', f: d => inr(d.settled + d.deductions) }, { h: 'Refund', f: d => `<b>${inr(d.refund)}</b>` },
        { h: 'Status', f: d => badge(d.status === 'pending' ? 'Pending' : d.status === 'paid' ? 'Refunded' : (d.status === 'debt' ? 'Debt' : 'Closed'), d.status === 'pending' ? 'warn' : (d.status === 'debt' ? 'bad' : 'ok')) },
        { h: '', acts: true, f: d => `${btn(t('Statement'), 'depstatement', `data-id="${d.id}"`, 'sm')}${d.status === 'pending' ? btn('Mark refunded', 'depok', `data-id="${d.id}"`, 'sm ok') : ''}` },
      ], list, { key: 'deps', emptyT: 'No checkouts yet' });
    }
    return `${head('Payments', t('{c} collected in {m} · {d} pending', { c: inr(coll), m: fmtYM(ym), d: inr(sum(dues, x => x.due)) }), btn('Record cash payment', 'pay', '', 'primary', 'plus'))}
      ${seg('pay', [['dues', 'Dues'], ['claims', 'UPI claims', claims.length], ['statement', 'Bank statement'], ['history', 'History'], ['deps', 'Deposits']], 'dues')}${body}`;
  },
};
A.importstmt = () => {
  formModal({
    title: 'Import Bank Statement (CSV) & Auto-Reconcile',
    submit: 'Run Reconciliation',
    wide: true,
    note: t('Paste CSV bank statement or transaction export. System identifies Credit rows, normalizes UTRs, and matches against pending resident claims.'),
    fields: [
      { name: 'csvText', label: 'Bank Statement CSV Data', type: 'textarea', required: true, full: true, hint: 'Supports HDFC, ICICI, SBI, Axis, PhonePe, and standard exports.' },
      { name: 'autoConfirm', label: 'Automatically confirm exact UTR & amount matches', type: 'checkbox', value: true }
    ],
    preview: v => {
      if (!v.csvText || !v.csvText.trim()) return '';
      try {
        const rows = parseBankStatement(v.csvText);
        const credits = rows.filter(r => r.direction === 'CR');
        return `<div class="note info">
          <b>${esc(t('Detected Format Preview'))}:</b> ${rows.length} total rows, <b>${credits.length} credit transactions</b>.<br>
          <div style="margin-top:6px;max-height:140px;overflow-y:auto;font-size:11px">
            ${credits.slice(0, 3).map(c => `• ${fmtShort(c.date)}: <b>${inr(c.amount)}</b> · Ref: ${esc(c.ref || '—')} · Narration: ${esc((c.narration || '').slice(0, 40))}`).join('<br>')}
          </div>
        </div>`;
      } catch (e) {
        return `<div class="note warn">${esc(e.message)}</div>`;
      }
    },
    onSubmit: v => {
      try {
        const rows = parseBankStatement(v.csvText);
        const report = reconcileBankStatement(rows, { autoConfirm: v.autoConfirm });
        toast(t('Reconciliation complete: {c} auto-confirmed, {m} need review', {
          c: report.autoConfirmedCount,
          m: report.probableMatches.length + report.amountMismatches.length
        }), 'ok');
        closeModal();
        render();
      } catch (err) {
        return err.message;
      }
    }
  });
};

A.stmtconfirm = el => {
  const tx = Store.get(el.dataset.id);
  if (!tx) return;
  const resOptsList = activeRes().map(r => ({ v: r.id, l: `${r.name} (${roomName(r.roomId)}) · Due: ${inr(resDue(r.id))}` }));
  formModal({
    title: `Confirm Statement Credit · ${inr(tx.amount)}`,
    submit: 'Confirm Payment',
    note: t('Link this statement credit to a resident. The payment will be credited to their ledger and outstanding bills.'),
    fields: [
      { name: 'resId', label: 'Allocate to resident', type: 'select', options: resOptsList, value: tx.resId || (resOptsList[0] || {}).v, required: true },
      { name: 'amount', label: 'Amount (₹)', type: 'number', value: tx.amount, required: true },
      { name: 'ref', label: 'UTR / Reference Number', value: tx.ref || '', required: true },
      { name: 'date', label: 'Payment Date', type: 'date', value: tx.date || today(), required: true },
      { name: 'note', label: 'Note / Narration', value: tx.narration || '' }
    ],
    onSubmit: v => {
      try {
        recordPayment({
          resId: v.resId,
          amount: +v.amount,
          mode: 'upi',
          ref: v.ref,
          date: v.date,
          claimId: tx.claimId || null,
          idempotencyKey: `bank-tx-manual-${tx.id}`,
          note: `Manual statement reconciliation (${(v.note || '').slice(0, 50)})`
        });
        Store.patch(tx.id, { status: 'matched', resId: v.resId, reconciledAt: nowIso() });
        if (tx.claimId) Store.patch(tx.claimId, { status: 'approved', reconciledAt: nowIso() });
        toast(t('Payment confirmed & credited ✓'), 'ok');
        closeModal();
        render();
      } catch (err) {
        return err.message;
      }
    }
  });
};
// Record payment. Choosing the resident fills in everything they owe (rent + electricity +
// other). Two things then sit under the amount, each appearing only when it is relevant:
//   - an advance, when the money is clearly more than one month's rent. Ticking it asks how
//     many months, works out the discount from the gap, and settles those months one by one.
//   - a pending penalty, which the owner can leave out of this payment so it carries on.
A.pay = el => {
  const resId = el && el.dataset && el.dataset.res || '';
  const opts = resOpts();
  if (!opts.length) return toast('No residents yet', 'bad');
  const rentOf = id => { const r = resById(id); return r ? round2(r.rent || 0) : 0; };
  const breakdown = id => {
    const open = openInv(id);
    return open.length ? `<div class="group">${open.map(i => li({
      icon: i.type === 'electricity' ? 'bolt' : i.type === 'laundry' ? 'shirt' : i.type === 'penalty' ? 'alert' : 'rupee',
      ic: i.type === 'penalty' ? 'bad' : invStat(i) === 'overdue' ? 'bad' : 'info',
      t: i.title, end: `<b>${inr(invBal(i))}</b>`,
    })).join('')}</div>` : `<div class="hint">${esc(t('No open bills — amount will be kept as advance credit.'))}</div>`;
  };
  const amountFor = id => { const d = resDue(id); return d > 0 ? d : rentOf(id) || ''; };
  const setCheck = (form, name, on) => { const c = form.elements[name]; if (c) c.checked = !!on; };
  // setField() refuses to overwrite a field the cursor is sitting in, which is right while
  // someone is typing but wrong here: the owner has just clicked a box and is asking for the
  // amount to be worked out again.
  const setAmount = (form, n) => { const el = form.elements.amount; if (el) el.value = n > 0 ? n : ''; };

  formModal({
    title: 'Record payment', submit: 'Save payment',
    fields: [
      { name: 'res', label: 'Resident', type: 'select', options: opts, value: resId, placeholder: 'Choose resident…', required: true },
      { name: 'amount', label: 'Amount (₹)', type: 'number', value: resId ? amountFor(resId) : '', min: 1, required: true, hint: t('Filled automatically with the total due (rent + electricity + other).') },
      { name: 'adv', label: 'This is an advance for more than one month', type: 'checkbox', hidden: true, full: true },
      { name: 'months', label: 'How many months is it for?', type: 'number', min: 1, max: 24, value: '', hidden: true, hint: t('Any discount is worked out from the amount you entered.') },
      { name: 'pen', label: 'Collect the pending penalty too', type: 'checkbox', value: true, hidden: true, full: true },
      { name: 'mode', label: 'Paid by', type: 'select', options: [{ v: 'cash', l: t('Cash') }, { v: 'upi', l: 'UPI' }, { v: 'bank', l: t('Bank transfer') }], value: 'cash' },
      { name: 'date', label: 'Date', type: 'date', value: today(), required: true },
      { name: 'ref', label: 'UTR / reference', hidden: true }, { name: 'note', label: 'Note' },
      { type: 'html', html: `<div id="paybk">${resId ? breakdown(resId) : ''}</div>` },
      { name: 'wa', label: 'Send receipt on WhatsApp', type: 'checkbox', value: S().wa.auto },
    ],
    onChange: (v, form, ch) => {
      if (ch === 'res') {
        setField(form, 'amount', v.res ? amountFor(v.res) : '');
        setCheck(form, 'adv', false); setField(form, 'months', '');
        $('#paybk').innerHTML = v.res ? breakdown(v.res) + (resDue(v.res) > 0 ? `<button type="button" class="btn sm wa" style="margin-top:8px" data-act="sendbill" data-res="${v.res}">${ico('wa', 'sm')} ${esc(t('Send bill instead'))}</button>` : '') : '';
      }
      // read the amount back off the form: picking a resident has just rewritten it, so the
      // value handed to us is one keystroke out of date
      const amt = parseFloat((form.elements.amount || {}).value) || 0;
      const rent = rentOf(v.res), pen = v.res ? penaltyDue(v.res) : 0;
      // The advance question only makes sense once the money is past one month's rent.
      const canAdv = !!v.res && rent > 0 && amt > rent;
      showField(form, 'adv', canAdv);
      if (!canAdv && form.elements.adv && form.elements.adv.checked) setCheck(form, 'adv', false);
      const isAdv = canAdv && form.elements.adv && form.elements.adv.checked;
      showField(form, 'months', isAdv);
      // a sensible first guess, rounded down: 35,000 at 10,000 a month is 3 months, not 3.5
      if (isAdv && !(v.months >= 1)) setField(form, 'months', Math.max(1, Math.floor(amt / rent)));
      // Penalties are part of "everything they owe", so leaving one out takes it off the
      // amount too. Otherwise the owner holds a fine back and the money they are not
      // collecting for it quietly turns into credit, which then pays the fine anyway.
      showField(form, 'pen', pen > 0 && !isAdv);
      if (ch === 'pen' && pen > 0 && !isAdv) setAmount(form, form.elements.pen.checked ? amountFor(v.res) : round2(resDue(v.res) - pen));
      showField(form, 'ref', v.mode !== 'cash');
    },
    preview: v => {
      if (!v.res || !(v.amount > 0)) return '';
      const isAdv = v.adv && v.months >= 1 && v.amount > rentOf(v.res);
      if (isAdv) {
        const plan = advPlan(v.res, Math.round(v.months));
        if (!plan) return '';
        const gap = round2(plan.expected - v.amount);
        const span = `${fmtYM(plan.yms[0])}${plan.months > 1 ? ' – ' + fmtYM(plan.yms[plan.yms.length - 1]) : ''}`;
        const head = `${esc(t('Covers {n} months', { n: plan.months }))}: <b>${esc(span)}</b> · ${esc(t('normally'))} ${inr(plan.expected)}`;
        if (gap > 0) return `${head}<br><span class="ok-t">${esc(t('Discount given'))}: <b>${inr(gap)}</b></span>`;
        if (gap < 0) return `${head}<br>${esc(t('Extra'))} <b>${inr(-gap)}</b> ${esc(t('goes to advance credit'))}`;
        return `${head}<br><span class="ok-t">${esc(t('Full amount, no discount'))} ✓</span>`;
      }
      const pen = penaltyDue(v.res);
      const d = round2(resDue(v.res) - (pen > 0 && !v.pen ? pen : 0));
      const tail = pen > 0 && !v.pen ? `<br>${esc(t('Penalty of {a} stays pending', { a: inr(pen) }))}` : '';
      return (v.amount > d ? `${esc(t('Clears all dues'))} · <b>${inr(v.amount - d)}</b> ${esc(t('goes to advance credit'))}`
        : v.amount < d ? `${esc(t('Balance after this'))}: <b>${inr(d - v.amount)}</b>`
          : `<span class="ok-t">${esc(t('Clears all dues'))} ✓</span>`) + tail;
    },
    onSubmit: v => {
      const isAdv = v.adv && v.amount > rentOf(v.res);
      if (isAdv && !(v.months >= 1)) return 'How many months is this payment for?';
      const pen = penaltyDue(v.res);
      const pay = isAdv
        ? recordAdvance({ resId: v.res, amount: v.amount, months: Math.round(v.months), mode: v.mode, ref: v.ref, date: v.date, note: v.note })
        : recordPayment({
          resId: v.res, amount: v.amount, mode: v.mode, ref: v.ref, date: v.date, note: v.note,
          exclude: pen > 0 && !v.pen ? resPenalties(v.res).map(i => i.id) : null
        });
      closeModal(); render();
      const extra = pay.adv && pay.adv.discount > 0 ? ` · ${t('discount')} ${inr(pay.adv.discount)}` : '';
      toast(t('{a} received', { a: inr(v.amount) }) + extra, 'ok', { label: 'Receipt', run: () => A.receipt({ dataset: { id: pay.id } }) });
      if (v.wa) waOpen(resById(v.res).phone, receiptMessage(pay), 'Send receipt');
      return false;
    },
  });
};
A.sendbill = el => {
  const r = resById(el.dataset.res); if (!r) return;
  if (!S().pay.upiId) toast('Add your UPI ID in Settings → Payments to include a pay link', 'bad');
  const m = billMessage(r);
  if (!m.total) return toast('No dues for this resident');
  closeModal(true);
  waOpen(r.phone, m.text, 'Send bill');
};
A.billall = () => {
  const list = dueList();
  if (!S().pay.upiId) toast('Add your UPI ID in Settings → Payments to include a pay link', 'bad');
  waSheet(list.map(x => ({ phone: x.r.phone, text: billMessage(x.r).text, label: `${x.r.name} · ${inr(x.due)}`, r: x.r, resId: x.r.id })), 'Send bills');
};
// This month's bills (rent + electricity), one message per resident. With the gateway connected
// they go out by themselves; otherwise WhatsApp opens for each and the owner presses Send.
A.mbillsend = async el => {
  const due = monthlyBillsDue();
  if (!due.length) return toast('Nothing to send');
  if (!S().pay.upiId) toast('Add your UPI ID in Settings → Payments to include a pay link', 'bad');
  if (!WaGw.on()) return waSheet(monthlyBillMsgs(due), 'Send monthly bills');
  if (el) el.disabled = true;
  const res = await WaGw.send(monthlyBillMsgs(due));
  const sent = due.filter((x, i) => res[i] && res[i].ok); markReminded(sent);
  toast(t('{n} monthly bills sent on WhatsApp', { n: sent.length }), sent.length === due.length ? 'ok' : 'bad');
  render();
};
// Sends exactly the reminders that are due today; each is marked once its WhatsApp opens.
A.remindsend = () => {
  const due = remindersDue().filter(x => phone10(x.r.phone));
  if (!due.length) return toast('Nothing to send');
  waSheet(reminderMsgs(due), 'Send reminders');
};
A.remindall = () => {
  const list = dueList(true);
  if (!list.length) return toast('Nobody is overdue 🎉');
  waSheet(list.map(x => ({ phone: x.r.phone, text: billMessage(x.r, 'reminder').text, label: `${x.r.name} · ${inr(x.due)}`, r: x.r, resId: x.r.id })), 'Send reminders');
};
A.receipt = el => {
  const p = Store.get(el.dataset.id), r = resById(p.resId), h = Store.hostel();
  const revBanner = p.reversed ? `<div class="badge bad" style="display:block;margin-bottom:12px;text-align:center;padding:8px;font-size:13px">${ico('alert', 'xs')} <b>${esc(t('PAYMENT REVERSED'))}</b><br><span class="xs">${esc(fmtDate(p.reversedAt))} · ${esc(p.reversalReason || '')}</span></div>` : '';
  sheet('Receipt', `<div class="receipt" id="rcpt">${revBanner}<div style="text-align:center"><b style="font-size:16px">${esc(h.name)}</b><div class="muted xs">${esc(h.address || h.city || '')}</div></div><hr>
    <div class="r"><span>${esc(t('Receipt'))}</span><b>${esc(p.no || p.id)}</b></div><div class="r"><span>${esc(t('Date'))}</span><span>${fmtDate(p.date)}</span></div><div class="r"><span>${esc(t('Resident'))}</span><span>${esc(r ? r.name : '')}</span></div><div class="r"><span>${esc(t('Room'))}</span><span>${esc(roomName(p.roomId))}</span></div><hr>
    ${p.adv ? `<div class="r"><span>${esc(t('Advance for {n} months', { n: p.adv.months }))}</span><span>${esc(fmtYM(p.adv.from))}${p.adv.months > 1 ? ' – ' + esc(fmtYM(p.adv.to)) : ''}</span></div>` : ''}
    ${(p.alloc || []).map(a => `<div class="r"><span>${esc(a.title || '')}</span><span>${inr(a.amt)}</span></div>`).join('')}${p.adv && p.adv.discount > 0 ? `<div class="r"><span>${esc(t('Discount given'))}</span><span>− ${inr(p.adv.discount)}</span></div>` : ''}${p.credit > 0 ? `<div class="r"><span>${esc(t('Advance credit'))}</span><span>${inr(p.credit)}</span></div>` : ''}<hr>
    <div class="r"><b>${esc(t('Total paid'))}</b><b>${inr(p.amount)}</b></div><div class="r"><span>${esc(t('Mode'))}</span><span>${esc(p.mode.toUpperCase())}${p.ref ? ' · ' + esc(p.ref) : ''}</span></div><div class="r"><span>${esc(t('Balance due'))}</span><span>${inr(r ? resDue(r.id) : 0)}</span></div></div>`,
    { foot: `<button class="btn" data-act="print">${ico('print', 'sm')} ${esc(t('Print'))}</button>${!p.reversed && r ? `<button class="btn wa" data-act="sendrcpt" data-id="${p.id}">${ico('wa', 'sm')} WhatsApp</button>` : ''}${!p.reversed && isAdmin() ? `<button class="btn bad" data-act="payreverse" data-id="${p.id}">${ico('alert', 'sm')} ${esc(t('Reverse payment'))}</button>` : ''}` });
};
A.payreverse = el => {
  const p = Store.get(el.dataset.id); if (!p) return;
  formModal({
    title: `${t('Reverse payment')} · ${inr(p.amount)}`,
    danger: true, submit: 'Reverse payment',
    fields: [
      { name: 'reason', label: 'Reason for reversal (mandatory)', required: true, placeholder: t('Bounced cheque, duplicate entry, resident dispute...') }
    ],
    onSubmit: v => {
      try {
        reversePayment(p.id, v.reason);
        closeModal();
        render();
        toast('Payment reversed and ledger adjusted', 'ok');
      } catch (err) {
        return err.message;
      }
    }
  });
};
A.sendrcpt = el => { const p = Store.get(el.dataset.id); closeModal(true); waOpen(resById(p.resId).phone, receiptMessage(p), 'Send receipt'); };
A.exportpay = () => download(`payments-${today()}.csv`, csv([['Date', 'Receipt', 'Resident', 'Room', 'Amount', 'Mode', 'Reference', 'Status', 'Reversal Reason'], ...Store.all('pay').sort(by('date')).map(p => [p.date, p.no, (resById(p.resId) || {}).name, roomName(p.roomId), p.amount, p.mode, p.ref, p.reversed ? 'Reversed' : 'Active', p.reversalReason || ''])]), 'text/csv');

/* ===================================================================== electricity */
PAGES.electricity = {
  title: 'Electricity', mod: 'electricity',
  render() {
    const e = S().elec, ym = ymOf(today());
    const occRooms = rooms().filter(r => bedsOf(r).some(b => b.status === 'occ'));
    const pending = occRooms.filter(r => !meters().some(m => m.roomId === r.id && ymOf(m.date) === ym));
    const list = meters().slice(0, ui.lim.mt || 60);
    return `${head('Electricity', t('₹{r}/unit · {f} free units per {m} · split by days stayed', { r: e.rate, f: e.freeUnits, m: t(e.freeMode === 'room' ? 'room' : 'resident') }), `<div class="tool-actions">${btn('Settings', 'go', 'data-to="settings/elec"', '', 'settings')}${btn('Reset / New meter', 'meterreset', '', 'ghost', 'refresh')}${btn('Scan meter', 'meterscan', '', 'ghost', 'camera')}${btn('Enter readings', 'readings', '', 'primary', 'bolt')}</div>`)}
      ${pending.length ? `<div class="note warn">${esc(t('{n} rooms still need this month\'s reading', { n: pending.length }))}: ${esc(pending.map(r => r.no).join(', '))}</div>` : ''}
      ${table([
      { h: 'Room', f: m => { const r = roomById(m.roomId); return `<b>${esc(roomName(m.roomId))}</b>${!r ? ` <span class="badge bad sm">${esc(t('Orphaned'))}</span>` : ''}`; } },
      { h: 'Date', f: m => fmtShort(m.date) },
      { h: 'Reading', f: m => `${num(m.prev)} → ${num(m.curr)}` },
      { h: 'Units', f: m => { const isAbnormal = m.units > 10000; return `<b class="${isAbnormal ? 'bad-t' : ''}">${num(m.units)}</b>${isAbnormal ? ` <span class="badge bad sm">⚠️ ${esc(t('Abnormal'))}</span>` : ''}`; } },
      { h: 'Billed', f: m => { if (m.opening) return badge(m.meterReplaced ? 'Replaced' : 'Opening', 'mute'); if (m.status === 'review') return badge(m.isReplacement ? 'New meter claim' : 'Check reading', 'warn'); const isAbnormal = m.units > 10000 || !roomById(m.roomId); return isAbnormal ? `<b class="bad-t">${inr(m.total)}</b>` : inr(m.total); } },
      {
        h: '', acts: true, f: m => {
          const isAbnormal = m.units > 10000 || m.curr > 999999 || !roomById(m.roomId);
          if (m.opening) return isAbnormal ? btn('Delete', 'meterdel', `data-id="${m.id}"`, 'sm bad') : '';
          return `${btn('Split', 'meterview', `data-id="${m.id}"`, 'sm')}${m.status === 'review' ? btn(m.isReplacement ? 'Approve' : 'Bill it', 'meterok', `data-id="${m.id}"`, 'sm ok') : ''}${btn(isAbnormal ? 'Delete' : '', 'meterdel', `data-id="${m.id}" title="${esc(t('Delete reading'))}" aria-label="${esc(t('Delete reading'))}"`, `sm ${isAbnormal ? 'bad' : 'ghost'}`, 'trash')}`;
        }
      },
    ], list, { key: 'mt', emptyT: 'No readings yet', empty: 'Enter meter readings once a month — bills are created automatically.' })}`;
  },
};
A.reading = () => A.readings();
A.meterreset = () => {
  const occRooms = rooms();
  if (!occRooms.length) return toast('No rooms found', 'bad');
  const defaultRoom = occRooms[0];
  const last = lastMeter(defaultRoom.id);
  const p = last ? last.curr : 0;
  formModal({
    title: t('Replace or reset room meter'),
    note: t('Use when a meter is broken, replaced with a new submeter, or reset to 0. This bills remaining units on the old meter and starts the new meter fresh.'),
    fields: [
      { name: 'roomId', label: 'Room', type: 'select', options: occRooms.map(r => ({ v: r.id, l: roomName(r.id) })), value: defaultRoom.id, required: true },
      { name: 'finalOld', label: 'Old meter final reading before removal', type: 'number', step: 0.1, value: p, required: true, hint: t('Units above last reading will be billed to current occupants') },
      { name: 'startingNew', label: 'New meter starting reading', type: 'number', step: 0.1, value: 0, required: true, hint: t('Usually 0.0 or the starting number on new meter') },
      { name: 'newSerial', label: 'New meter serial / model (optional)', placeholder: 'e.g. EM-2026-994' },
      { name: 'newQr', label: 'Meter sticker code (optional)', value: `MTR-${defaultRoom.no}` },
      { name: 'reason', label: 'Reason for replacement / reset', required: true, placeholder: t('Old meter burnt out, installed new digital submeter') }
    ],
    onChange: (vals, form, changedField) => {
      if (changedField === 'roomId') {
        const l = lastMeter(vals.roomId);
        setField(form, 'finalOld', l ? l.curr : 0);
        const rm = roomById(vals.roomId);
        if (rm) setField(form, 'newQr', `MTR-${rm.no}`);
      }
    },
    onSubmit: v => {
      try {
        replaceMeter({
          roomId: v.roomId,
          finalOldReading: v.finalOld,
          startingNewReading: v.startingNew,
          newSerial: v.newSerial,
          newQr: v.newQr,
          reason: v.reason
        });
        closeModal();
        render();
        toast(t('New meter registered and baseline established!'), 'ok');
      } catch (err) {
        return err.message;
      }
    }
  });
};
A.meterscan = () => {
  const occRooms = rooms().filter(r => bedsOf(r).some(b => b.status === 'occ'));
  if (!occRooms.length) return toast('No occupied rooms', 'bad');
  formModal({
    title: t('Scan meter reading'),
    fields: [
      { name: 'roomId', label: 'Room', type: 'select', options: occRooms.map(r => ({ v: r.id, l: roomName(r.id) })), required: true },
      { name: 'photo', label: 'Camera photo of meter display', type: 'file', accept: 'image/*', capture: true, required: true },
      { name: 'qrCode', label: 'Meter QR code (optional)', placeholder: t('QR-101 etc.') },
      { name: 'curr', label: 'Current meter reading', type: 'number', step: 0.1, required: true }
    ],
    onChange: (vals, form, changedField) => {
      if (changedField === 'photo' && vals.photo && vals.photo[0]) {
        const file = vals.photo[0];
        const prevEl = form.querySelector('#mprev');
        if (prevEl) {
          const reader = new FileReader();
          reader.onload = ev => {
            const dataUrl = ev.target.result;
            prevEl.innerHTML = `<div style="text-align:center;margin:8px 0"><img src="${dataUrl}" style="max-height:140px;border-radius:var(--r);border:1px solid var(--line)" alt="Meter Preview"><div class="xs muted" style="margin-top:4px">${esc(file.name)} (${(file.size / 1024).toFixed(1)} KB)</div></div>`;
            const ocr = typeof parseMeterOcrText === 'function' ? parseMeterOcrText(file.name) : null;
            if (ocr && ocr.value && !vals.curr) {
              setField(form, 'curr', ocr.value);
            }
          };
          reader.readAsDataURL(file);
        }
      }
    },
    onSubmit: v => {
      const room = roomById(v.roomId);
      if (!room) return 'Room not found';
      const last = lastMeter(v.roomId);
      const prev = last ? last.curr : 0;
      const curr = +v.curr;
      if (isNaN(curr)) return 'Enter valid reading';

      const fraud = validateMeterReadingFraud({ roomId: v.roomId, curr, prev, meterQr: v.qrCode });
      if (!fraud.valid) return fraud.flags.join('. ');

      const photoName = (v.photo && v.photo[0]) ? (v.photo[0].name || 'meter-photo.jpg') : null;
      const m = addReading({ roomId: v.roomId, curr, date: today(), qrCode: v.qrCode, photo: photoName });
      closeModal();
      render();
      toast(t('Meter reading saved: {u} units', { u: num(m.units) }), 'ok');
    }
  });
};
// One screen for all rooms: type the meter numbers, bills + WhatsApp queue are created in one go.
A.readings = () => {
  const list = rooms().filter(r => bedsOf(r).some(b => b.status === 'occ'));
  if (!list.length) return toast('No occupied rooms', 'bad');
  const fields = list.map(r => { const l = lastMeter(r.id); return { name: 'm_' + r.id, label: `${r.no} · ${t('last')} ${l ? num(l.curr) : '—'}`, type: 'number', step: 0.1, min: l ? l.curr : 0, max: 999999, placeholder: t('Current reading') }; });
  formModal({
    title: 'Meter readings', submit: 'Create bills', wide: true,
    note: t('Leave a room empty to skip it. Free units ({f}) are deducted before charging ₹{r}/unit.', { f: S().elec.freeUnits, r: S().elec.rate }),
    fields: [{ name: 'date', label: 'Reading date', type: 'date', value: today(), required: true }, { name: 'send', label: 'Send bills on WhatsApp after saving', type: 'checkbox', value: true }, ...fields],
    preview: v => {
      let tot = 0, n = 0, highWarn = [];
      for (const r of list) {
        const c = v['m_' + r.id];
        if (!isNaN(c)) {
          const l = lastMeter(r.id), units = c - (l ? l.curr : 0);
          if (units > 2000) highWarn.push(`${r.no} (${num(units)}u)`);
          if (units >= 0) {
            n++;
            tot += sum(splitElectricity(r.id, units, S().elec.rate, activeRes().filter(x => x.roomId === r.id).map(x => x.id)), s => s.amount);
          }
        }
      }
      let txt = n ? t('{n} rooms · total bill {t}', { n, t: inr(tot) }) : '';
      if (highWarn.length) txt += ` · ⚠️ High: ${highWarn.join(', ')}`;
      return txt;
    },
    onSubmit: v => {
      const touched = new Set(); let n = 0;
      for (const r of list) { const c = v['m_' + r.id]; if (isNaN(c)) continue; const m = addReading({ roomId: r.id, curr: c, date: v.date }); n++; if (m.status === 'billed') m.shares.forEach(s => touched.add(s.resId)); }
      if (!n) return 'Enter at least one reading';
      closeModal(); render(); toast(t('{n} readings saved', { n }));
      if (v.send) { const q = [...touched].map(id => resById(id)).filter(r => r && resDue(r.id) > 0).map(r => ({ phone: r.phone, text: billMessage(r).text, label: `${r.name} · ${inr(resDue(r.id))}` })); if (q.length) waSheet(q, 'Send bills'); }
      return false;
    },
  });
};
A.meterview = el => {
  const m = Store.get(el.dataset.id);
  if (!m) return toast(t('Reading not found'), 'bad');
  const room = roomById(m.roomId);
  const reg = typeof getMeterForRoom === 'function' ? getMeterForRoom(m.roomId) : null;
  const fromDate = m.prevDate || (m.span ? addDays(m.date, -m.span) : null);
  let shares = (m.shares && m.shares.length) ? m.shares : null;
  if (!shares && m.units > 0) {
    const occ = meterOccupants(m.roomId, fromDate, m.date);
    const occupants = occ.length ? occ.map(o => o[0]) : activeRes().filter(r => r.roomId === m.roomId).map(r => r.id);
    if (occupants.length) {
      shares = splitElectricity(m.roomId, m.units, m.rate || S().elec.rate, occupants, occ.length ? occ.map(o => o[1]) : null, freeMonths(fromDate, m.date));
    }
  }
  shares = shares || [];

  const isAbnormal = m.units > 10000 || m.curr > 999999 || !room;
  const spanDays = m.span || (fromDate ? Math.max(1, diffDays(m.date, fromDate)) : 30);
  const freePolicyUnits = m.freeUnits ?? S().elec.freeUnits ?? 0;
  const rate = m.rate || S().elec.rate || 0;

  const sharesHtml = shares.length
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;margin-bottom:8px">
         <div style="font-weight:700;font-size:14px">${esc(t('Room Occupants Split'))} (${shares.length})</div>
         <button type="button" class="btn xs ghost" data-act="elecsplitinfo" style="gap:5px;font-size:12px;padding:3px 9px;border-radius:16px;border:1px solid var(--line);background:var(--surface)">
           <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--accent);color:#fff;font-weight:700;font-size:11px">i</span>
           <span>${esc(t('Split Formula'))}</span>
         </button>
       </div>
       <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">${shares.map(s => {
      const r = resById(s.resId);
      const bedStr = r && r.bed ? ` · ${t('Bed')} ${r.bed}` : '';
      const checkInDate = r && r.checkIn ? r.checkIn : null;
      const checkOutDate = r && r.status === 'left' && r.left ? r.left : null;

      let stayDays = spanDays;
      if (checkInDate || checkOutDate) {
        const cycleStart = fromDate || addDays(m.date, -spanDays);
        const sStart = checkInDate && checkInDate > cycleStart ? checkInDate : cycleStart;
        const sEnd = checkOutDate && checkOutDate < m.date ? checkOutDate : m.date;
        stayDays = Math.max(1, Math.min(spanDays, diffDays(sEnd, sStart)));
      } else if (s.weight != null) {
        stayDays = Math.max(1, Math.round(s.weight * spanDays));
      }

      const isMidCheckIn = checkInDate && fromDate && checkInDate > fromDate;
      const stayPct = Math.min(100, Math.round((stayDays / spanDays) * 100));

      return `
           <div class="card" style="padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--subtle);box-shadow:none">
             <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
               <div style="display:flex;align-items:center;gap:10px;min-width:0">
                 ${avatar(r ? r.name : '?')}
                 <div style="min-width:0">
                   <div style="font-weight:700;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r ? r.name : t('Resident'))}${esc(bedStr)}</div>
                   <div class="muted xs" style="margin-top:1px">
                     ${stayDays}/${spanDays} ${t('days')} (${stayPct}%) · ₹${rate}/${t('unit')}
                   </div>
                 </div>
               </div>
               <div style="text-align:right;white-space:nowrap">
                 <b class="ok-t" style="font-size:16px">${inr(s.amount)}</b>
               </div>
             </div>

             <div style="margin-top:8px;padding:6px 10px;border-radius:6px;background:var(--surface);font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:6px;border:1px solid var(--line)">
               <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
                 <span class="muted">${num(s.units)} ${t('share')}</span>
                 <span class="muted">−</span>
                 <span class="ok-t" style="font-weight:600">${num(s.free)} ${t('free')}</span>
                 <span class="muted">=</span>
                 <b>${num(s.billable)} ${t('billable units')}</b>
               </div>
               <button type="button" class="btn xs ghost" data-act="resbreakdown" data-resid="${s.resId}" data-units="${s.units}" data-free="${s.free}" data-billable="${s.billable}" data-amount="${s.amount}" data-stay="${stayDays}" data-span="${spanDays}" data-rate="${rate}" title="${esc(t('View step-by-step breakdown'))}" style="padding:2px 7px;font-size:11px;min-height:22px;border-radius:6px;border:1px solid var(--line);color:var(--accent)">
                 ⓘ ${esc(t('Breakdown'))}
               </button>
             </div>
             ${isMidCheckIn ? `<div class="xs warn-t" style="margin-top:4px;font-size:11px">⚠️ ${esc(t('Joined mid-cycle ({d}): prorated for {n} active days', { d: fmtDate(checkInDate), n: stayDays }))}</div>` : ''}
           </div>
         `;
    }).join('')}</div>`
    : `<div class="note warn" style="margin-top:12px">${esc(t('No active residents in this room during this reading period. 0 units billed.'))}</div>`;

  const orphanedBanner = isAbnormal
    ? `<div class="note bad" style="margin-bottom:12px">
         <b>⚠️ ${esc(t('Erroneous or Orphaned Reading'))}:</b><br>
         ${!room ? esc(t('This reading is orphaned (room record does not exist).')) : ''}
         ${m.units > 10000 ? esc(t('Abnormally large units: {u} units ({amt}).', { u: num(m.units), amt: inr(m.total) })) : ''}
         <div style="margin-top:8px">
           <button class="btn sm bad" data-act="meterdel" data-id="${m.id}">${ico('trash', 'sm')} ${esc(t('Delete this Invalid Reading Now'))}</button>
         </div>
       </div>`
    : '';

  sheet(`${t('Room')} ${roomName(m.roomId)} · ${fmtDate(m.date)}`, `
    ${orphanedBanner}
    <dl class="kv">
      <dt>${esc(t('Previous reading'))}</dt><dd>${num(m.prev)}${fromDate ? ` <span class="muted xs">(${fmtDate(fromDate)})</span>` : ''}</dd>
      <dt>${esc(t('Current reading'))}</dt><dd>${num(m.curr)} <span class="muted xs">(${fmtDate(m.date)})</span></dd>
      <dt>${esc(t('Reading span'))}</dt><dd>${spanDays} ${esc(t('days'))}</dd>
      <dt>${esc(t('Units consumed'))}</dt><dd><b class="${m.units > 10000 ? 'bad-t' : ''}">${num(m.units)}</b></dd>
      <dt>${esc(t('Rate'))}</dt><dd>₹${rate}/unit</dd>
      <dt>${esc(t('Free units policy'))}</dt><dd>${freePolicyUnits} / ${esc(t((m.freeMode || S().elec.freeMode) === 'room' ? 'room' : 'resident'))} (${(freePolicyUnits / Math.max(1, spanDays)).toFixed(2)} units/day)</dd>
      ${m.qrCode || reg ? `<dt>${esc(t('Meter QR / Sticker'))}</dt><dd>${esc(m.qrCode || (reg && reg.qrCode) || (room ? 'MTR-' + room.no : '—'))}</dd>` : ''}
      ${m.photo ? `<dt>${esc(t('Photo audit'))}</dt><dd>${esc(m.photo)}</dd>` : ''}
      ${m.isReplacement ? `<dt>${esc(t('Meter replaced note'))}</dt><dd><span class="badge info">${esc(m.replaceReason || 'Meter replaced/reset')}</span></dd>` : ''}
      ${m.submittedBy ? `<dt>${esc(t('Submitted by'))}</dt><dd>${esc(m.submittedBy)}</dd>` : ''}
    </dl>
    ${sharesHtml}
    ${m.status === 'billed' && !isAbnormal ? `<div class="note ok" style="margin-top:12px">${ico('check', 'sm')} ${esc(t('This reading has been billed to residents\' monthly accounts.'))}</div>` : ''}`,
    { foot: `${m.status === 'review' ? `<button class="btn ok" data-act="meterok" data-id="${m.id}">${ico('check', 'sm')} ${esc(t(m.isReplacement ? 'Approve replacement' : 'Approve & Bill'))}</button><button class="btn bad" data-act="meterreject" data-id="${m.id}">${esc(t('Reject'))}</button>` : `<button class="btn" data-act="meteredit" data-id="${m.id}">${ico('edit', 'sm')} ${esc(t('Correct reading'))}</button><button class="btn bad" data-act="meterdel" data-id="${m.id}">${ico('trash', 'sm')} ${esc(t('Delete reading'))}</button>`}` });
};
A.meterdel = el => {
  const m = Store.get(el.dataset.id);
  const isAbnormal = m && (m.units > 10000 || m.curr > 999999 || !roomById(m.roomId));
  formModal({
    title: t('Delete meter reading'),
    submit: t('Delete reading'),
    danger: true,
    note: isAbnormal ? t('This reading has abnormal or orphaned data (₹{amt}). Deleting it will remove all related uncollected dues.', { amt: inr(m.total) }) : '',
    fields: [
      { name: 'reason', label: 'Reason for deletion', value: isAbnormal ? t('Erroneous reading entry') : '', required: true, placeholder: t('Duplicate reading, erroneous entry, etc.') }
    ],
    onSubmit: v => {
      try {
        deleteReading({ meterId: el.dataset.id, reason: v.reason });
        closeModal();
        render();
        toast(t('Reading deleted successfully'), 'ok');
      } catch (err) {
        return err.message;
      }
    }
  });
};

A.elecsplitinfo = () => {
  openModal({
    title: t('Electricity Split Formula'),
    body: `
      <div style="font-size:13.5px;line-height:1.6;color:var(--text);padding:4px 0">
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px">
          <div style="width:26px;height:26px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:none">1</div>
          <div>
            <b style="font-size:14px">${esc(t('Day-wise Pro-rata'))}</b>
            <div class="muted xs" style="margin-top:2px">${esc(t('Units are divided fairly based on active stay dates. Existing roommates never pay for days before a new resident checked in.'))}</div>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px">
          <div style="width:26px;height:26px;border-radius:50%;background:var(--ok-soft, rgba(52,199,89,0.15));color:var(--ok);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:none">2</div>
          <div>
            <b style="font-size:14px">${esc(t('Daily Free Quota Accrual'))}</b>
            <div class="muted xs" style="margin-top:2px">${esc(t('Free units (e.g. 30 units/mo) are credited per active day. A resident staying full 30 days gets full quota; mid-month entrants receive free quota for their active days only.'))}</div>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="width:26px;height:26px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:none">3</div>
          <div>
            <b style="font-size:14px">${esc(t('Final Net Calculation'))}</b>
            <div class="muted xs" style="margin-top:2px">${esc(t('Net Units = (Resident Share − Free Quota). Net Bill = Net Units × Rate per unit.'))}</div>
          </div>
        </div>
      </div>
    `,
    foot: `<button class="btn block primary" type="button" data-act="close">${esc(t('Got it'))}</button>`
  });
};

A.resbreakdown = el => {
  const d = el.dataset;
  const r = resById(d.resid);
  const name = r ? r.name : t('Resident');
  openModal({
    title: `${esc(name)} · ${t('Electricity Breakdown')}`,
    body: `
      <div style="font-size:13px;line-height:1.7;padding:4px 0">
        <dl class="kv sm" style="margin:0">
          <dt>${esc(t('Active Stay'))}</dt><dd><b>${d.stay} / ${d.span} ${t('days')}</b></dd>
          <dt>${esc(t('1. Room Consumption Share'))}</dt><dd><b>${num(+d.units)} ${t('units')}</b></dd>
          <dt class="ok-t">${esc(t('2. Free Quota Earned'))}</dt><dd class="ok-t"><b>-${num(+d.free)} ${t('units')}</b></dd>
          <dt style="border-top:1px dashed var(--line);padding-top:6px"><b>${esc(t('3. Net Billable Units'))}</b></dt>
          <dd style="border-top:1px dashed var(--line);padding-top:6px"><b>${num(+d.billable)} ${t('units')}</b></dd>
          <dt style="border-top:1px solid var(--line);padding-top:6px"><b>${esc(t('4. Billed Amount'))}</b></dt>
          <dd style="border-top:1px solid var(--line);padding-top:6px"><b class="ok-t" style="font-size:16px">${inr(+d.amount)}</b> <span class="xs muted">(${num(+d.billable)} × ₹${d.rate})</span></dd>
        </dl>
      </div>
    `,
    foot: `<button class="btn block primary" type="button" data-act="close">${esc(t('Close'))}</button>`
  });
};

/* ===================================================================== expenses */
PAGES.expenses = {
  title: 'Expenses', mod: 'expenses',
  render() {
    const ym = ui.flt.expm || ymOf(today()), cat = curFlt('expc', 'all');
    const monthList = Store.all('exp').filter(x => ymOf(x.date) === ym);
    const list = monthList.filter(x => (cat === 'all' || (cat === 'credit' ? x.mode === 'credit' && !x.paid : x.cat === cat)) && needle('exp', x.cat, x.vendor, x.note)).sort(by('date', -1));
    const credit = Store.all('exp').filter(x => x.mode === 'credit' && !x.paid);
    const byCat = groupBy(monthList, x => x.cat), months = [...new Set([ymOf(today()), ...Store.all('exp').map(x => ymOf(x.date))])].sort().reverse().slice(0, 12);
    return `${head('Expenses', t('{a} spent in {m}', { a: inr(sum(monthList, x => x.amount)), m: fmtYM(ym) }), btn('Add expense', 'addexp', '', 'primary', 'plus'))}
      <div class="grid g3 keep2" style="margin-bottom:14px">${kpi('Cash paid', inr(sum(monthList.filter(x => x.mode === 'cash' || x.paid), x => x.amount)), fmtYM(ym), '', null, 'wallet')}${kpi('On credit (unpaid)', inr(sum(credit, x => x.amount)), t('{n} bills', { n: credit.length }), credit.length ? 'warn' : '', null, 'clock')}${kpi('Top category', Object.keys(byCat).length ? esc(t(Object.entries(byCat).sort((a, b) => sum(b[1], x => x.amount) - sum(a[1], x => x.amount))[0][0])) : '—', '', '', null, 'tag')}</div>
      <div class="tool"><select class="hsel" data-flt="expm" aria-label="${esc(t('Month'))}">${months.map(m => `<option value="${m}" ${m === ym ? 'selected' : ''}>${fmtYM(m)}</option>`).join('')}</select>${searchBox('exp', 'Search vendor or note')}</div>
      <div class="tool">${chips('expc', [['all', 'All'], ['credit', 'Unpaid credit'], ...S().expenseCats.filter(c => byCat[c]).map(c => [c, c])], 'all')}</div>
      ${table([
      { h: 'Date', f: x => fmtShort(x.date) }, { h: 'Category', f: x => `<b>${esc(t(x.cat))}</b>${x.note ? `<div class="hint">${esc(x.note)}</div>` : ''}` }, { h: 'Vendor', f: x => esc(x.vendor || '—') },
      { h: 'Amount', f: x => `<b>${inr(x.amount)}</b>` }, { h: 'Payment', f: x => (x.mode === 'credit' ? (x.paid ? badge('Credit · paid', 'ok') : badge('Credit · unpaid', 'warn')) : badge('Cash', '')) },
      { h: '', acts: true, f: x => `${x.mode === 'credit' && !x.paid ? btn('Mark paid', 'exppaid', `data-id="${x.id}"`, 'sm ok') : ''}${btn('', 'editexp', `data-id="${x.id}" aria-label="${esc(t('Edit'))}"`, 'sm', 'edit')}` },
    ], list, { key: 'exp', emptyT: 'No expenses', empty: 'Add your first expense for this month.' })}`;
  },
};
function expenseForm(x) {
  const e = x || {};
  formModal({
    title: x ? 'Edit expense' : 'Add expense',
    fields: [
      { name: 'cat', label: 'Category', type: 'select', options: S().expenseCats.map(c => ({ v: c, l: t(c) })), value: e.cat, required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', min: 1, max: 10000000, value: e.amount, required: true },
      { name: 'date', label: 'Date', type: 'date', value: e.date || today(), required: true }, { name: 'mode', label: 'Payment', type: 'select', options: [{ v: 'cash', l: t('Cash / paid now') }, { v: 'credit', l: t('Credit (pay later)') }], value: e.mode || 'cash' },
      { name: 'vendor', label: 'Vendor / shop', value: e.vendor, maxlength: 80 }, { name: 'note', label: 'Note', value: e.note, maxlength: 200 },
    ],
    danger: x ? { label: 'Delete', run: () => confirmBox(t('Delete this expense?'), () => { Store.remove(e.id); toast('Deleted'); }, 'Delete', 'bad') } : null,
    onSubmit: v => {
      Store.put('exp', { ...e, cat: v.cat, amount: v.amount, date: v.date, mode: v.mode, paid: v.mode === 'cash' ? true : e.paid || false, vendor: v.vendor, note: v.note });
      toast('Expense saved');
    },
  });
}
A.addexp = () => expenseForm();
A.editexp = el => expenseForm(Store.get(el.dataset.id));
A.exppaid = el => { Store.patch(el.dataset.id, { paid: true, paidOn: today() }); toast('Marked paid'); render(); };

/* ===================================================================== reports */
// One period for the whole page and for every download below it.
const repNow = () => repRange(ui.flt.repk || 'this_month', ui.flt.repf, ui.flt.rept);
PAGES.reports = {
  title: 'Reports', mod: 'reports',
  render() {
    const R = repNow(), bl = blockScope();
    const pays = payments().filter(p => repIn(p.date, R) && p.mode !== 'deposit'), exps = Store.all('exp').filter(x => repIn(x.date, R));
    const bills = invoices().filter(i => i.type !== 'deposit' && repIn(i.date, R));
    const billed = sum(bills, i => i.amount), collectedOfBilled = sum(bills, i => i.paid || 0);
    const income = sum(pays, p => p.amount), spend = sum(exps, x => x.amount);
    const byType = groupBy(bills, i => i.type), byCat = groupBy(exps, x => x.cat), byMode = groupBy(pays, p => p.mode);
    const rows = (obj, f) => Object.entries(obj).sort((a, b) => f(b[1]) - f(a[1])).map(([k, v]) => `<dt>${esc(t(INV_TYPES[k] || k))}</dt><dd>${inr(f(v))}</dd>`).join('') || `<dt class="muted">${esc(t('Nothing yet'))}</dt><dd></dd>`;
    return `${head('Reports', `${esc(R.label)}${bl ? ' · ' + esc(blockName(bl)) : ''}`)}
      <div class="card" style="margin-bottom:14px"><div class="row wrap" style="gap:10px;align-items:center">
        <b>${esc(t('Period'))}</b>
        <select class="hsel" data-flt="repk" aria-label="${esc(t('Period'))}">${repPresets().map(p => `<option value="${p.k}" ${p.k === R.key ? 'selected' : ''}>${esc(t(p.l))}</option>`).join('')}</select>
        ${R.key === 'custom' ? `<input type="date" value="${R.from}" data-flt="repf" aria-label="${esc(t('From'))}"><span>${esc(t('to'))}</span><input type="date" value="${R.to}" data-flt="rept" aria-label="${esc(t('To'))}">` : ''}
      </div><p class="hint" style="margin-top:8px">${esc(t('Every report and download on this page uses this period.'))}</p></div>
      ${bl ? `<div class="note" style="margin-bottom:12px">${ico('alert', 'sm')} ${esc(t('Income and bills below are for this block only. Expenses are kept for the whole hostel and are not split.'))}</div>` : ''}
      <div class="grid g4 keep2">${kpi('Income', inr(income), t('{n} payments', { n: pays.length }), 'ok', null, 'rupee')}${kpi('Expenses', inr(spend), t('{n} entries', { n: exps.length }), 'warn', null, 'wallet')}${kpi('Profit', inr(income - spend), '', income - spend >= 0 ? 'ok' : 'bad', null, 'chart')}${kpi('Collection rate', pct(collectedOfBilled, billed) + '%', t('{a} of {b} billed', { a: inr(collectedOfBilled), b: inr(billed) }), '', null, 'check')}</div>
      <div class="grid g3" style="margin-top:14px">
        <div class="card"><h3>${esc(t('Billed by type'))}</h3><dl class="kv">${rows(byType, l => sum(l, i => i.amount))}</dl></div>
        <div class="card"><h3>${esc(t('Collected by mode'))}</h3><dl class="kv">${rows(byMode, l => sum(l, p => p.amount))}</dl></div>
        <div class="card"><h3>${esc(t('Expenses by category'))}</h3><dl class="kv">${rows(byCat, l => sum(l, x => x.amount))}</dl></div>
      </div>
      ${group('Download', [
      li({ icon: 'download', ic: 'ok', t: t('Professional Monthly Report (8-Sheet Excel)'), d: t('Executive summary, resident ledger, payments, electricity, mess, expenses, occupancy, reconciliation'), act: 'repmonthlyxlsx' }),
      li({ icon: 'download', ic: 'ok', t: t('Complete analysis (Excel)'), d: t('One workbook: P&L, cash flow, costs, dues, occupancy, electricity, inventory, laundry, payroll'), act: 'repxlsx' }),
      li({ icon: 'download', ic: 'info', t: t('Payments (CSV)'), act: 'reppay' }), li({ icon: 'download', ic: 'warn', t: t('Expenses (CSV)'), act: 'repexp' }),
      li({ icon: 'download', ic: 'bad', t: t('Dues list (CSV)'), d: t('Who owes what today'), act: 'repdues' }), li({ icon: 'download', ic: 'info', t: t('Residents (CSV)'), d: t('Who stayed during this period'), act: 'repres' }),
    ].join(''), t('Dues are always as of today; everything else follows the period above.'))}`;
  },
};
// The workbook is built in the browser from the records already loaded; the two scripts that do it
// are fetched only now, so the rest of the app never carries them.
A.repxlsx = async el => {
  const R = repNow();
  if (el && el.disabled) return;
  if (el) el.style.opacity = .6;
  toast(t('Preparing your workbook…'));
  try {
    await loadScript('/js/xlsx.js'); await loadScript('/js/report.js');
    const w = Report.workbook(R.from, R.to, R.label);
    download(w.name, w.bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast(t('Workbook downloaded'));
  } catch (e) { console.error(e); toast(t('Could not build the workbook: {m}', { m: e.message }), 'bad'); }
  finally { if (el) el.style.opacity = ''; }
};
A.repmonthlyxlsx = async el => {
  const ym = ymOf(today());
  formModal({
    title: 'Download Monthly Excel Analytics',
    submit: 'Download 8-Sheet .xlsx',
    fields: [
      { name: 'ym', label: 'Select Reporting Month', type: 'month', value: ym, required: true }
    ],
    onSubmit: async v => {
      toast(t('Generating 8-sheet Excel report…'));
      try {
        await loadScript('/js/xlsx.js');
        await loadScript('/js/report.js');
        const w = Report.monthlyWorkbook(v.ym);
        download(w.name, w.bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        toast(t('Report downloaded ✓'), 'ok');
      } catch (e) {
        toast(t('Could not build report: {m}', { m: e.message }), 'bad');
      }
    }
  });
};
// Settings → Backup & export: every expense ever, whatever period Reports is showing.
A.exportexp = () => download(`expenses-${today()}.csv`, csv([['Date', 'Category', 'Amount', 'Payment', 'Paid', 'Vendor', 'Note'], ...Store.all('exp').sort(by('date')).map(x => [x.date, x.cat, x.amount, x.mode, x.paid ? 'yes' : 'no', x.vendor, x.note])]), 'text/csv');
A.reppay = () => { const R = repNow(); download(`payments-${R.from}-to-${R.to}.csv`, csv([['Date', 'Receipt', 'Resident', 'Room', 'Amount', 'Mode', 'Reference'], ...Store.all('pay').filter(p => repIn(p.date, R)).sort(by('date')).map(p => [p.date, p.no, (resById(p.resId) || {}).name, roomName(p.roomId), p.amount, p.mode, p.ref])]), 'text/csv'); };
A.repexp = () => { const R = repNow(); download(`expenses-${R.from}-to-${R.to}.csv`, csv([['Date', 'Category', 'Amount', 'Payment', 'Paid', 'Vendor', 'Note'], ...Store.all('exp').filter(x => repIn(x.date, R)).sort(by('date')).map(x => [x.date, x.cat, x.amount, x.mode, x.paid ? 'yes' : 'no', x.vendor, x.note])]), 'text/csv'); };
A.repdues = () => download(`dues-${today()}.csv`, csv([['Resident', 'Mobile', 'Room', 'Due', 'Overdue'], ...dueList().map(x => [x.r.name, x.r.phone, roomName(x.r.roomId), x.due, x.od])]), 'text/csv');
A.repres = () => { const R = repNow(); download(`residents-${R.from}-to-${R.to}.csv`, csv([['Name', 'Mobile', 'Room', 'Bed', 'Rent', 'Deposit', 'Check-in', 'Left', 'Status', 'Guardian', 'Guardian mobile', 'College'], ...residents().filter(r => r.checkIn <= R.to && (!r.left || r.left >= R.from)).map(r => [r.name, r.phone, roomName(r.roomId), r.bed, r.rent, r.deposit, r.checkIn, r.left || '', r.status, r.guardian, r.guardianPhone, r.college])]), 'text/csv'); };

/* ===================================================================== notices */
PAGES.notices = {
  title: 'Notices', mod: 'notices',
  render() {
    const list = Store.all('notice').slice().sort((a, b) => (b.pinned - a.pinned) || (b.date > a.date ? 1 : -1));
    return `${head('Notices', t('Residents see these in their app.'), btn('New notice', 'addnotice', '', 'primary', 'plus'))}
      ${list.length ? `<div class="stack">${list.map(n => `<div class="card"><div class="row sb"><b style="font-size:17px">${n.pinned ? '📌 ' : ''}${esc(n.title)}</b><span class="muted sm">${fmtDate(n.date)}</span></div><p style="margin:8px 0 12px;white-space:pre-wrap">${esc(n.body)}</p><div class="row">${btn('Send on WhatsApp', 'noticewa', `data-id="${n.id}"`, 'sm wa', 'wa')}${btn('Delete', 'noticedel', `data-id="${n.id}"`, 'sm bad', 'trash')}</div></div>`).join('')}</div>` : `<div class="card">${empty('No notices', 'Post rules, holidays or maintenance updates.')}</div>`}`;
  },
};
A.addnotice = () => formModal({
  title: 'New notice', submit: 'Post', fields: [{ name: 'title', label: 'Title', required: true, full: true, maxlength: 100 }, { name: 'body', label: 'Message', type: 'textarea', required: true, full: true, maxlength: 500 }, { name: 'pinned', label: 'Pin on top', type: 'checkbox' }],
  onSubmit: v => { Store.put('notice', { ...v, date: today() }); activeRes().forEach(r => notify({ to: 'res', resId: r.id, title: t('New notice'), body: v.title, link: 'r-help' })); toast('Notice posted'); },
});
A.noticedel = el => confirmBox(t('Delete this notice?'), () => Store.remove(el.dataset.id), 'Delete', 'bad');
A.noticewa = el => { const n = Store.get(el.dataset.id); waSheet(activeRes().map(r => ({ phone: r.phone, text: `${t('Hello')} ${r.name.split(' ')[0]},\n\n${t('A notice from')} *${hostelName()}*\n\n*${n.title}*\n\n${n.body}\n\n${t('Regards')},\n${hostelName()}`, label: r.name, r, resId: r.id })), 'Send notice'); };

/* ===================================================================== automation */
PAGES.automation = {
  title: 'Automation', mod: 'automation',
  render() {
    const a = S().auto, logs = Store.all('log').slice().sort(by('ts', -1)).slice(0, 40), od = dueList(true);
    return `${head('Automation', t('These run by themselves once a day when anyone opens the app. Safe to run again — nothing is ever doubled.'), btn('Run now', 'autorun', '', 'primary', 'bot'))}
      <div class="grid g-main">
        <div>${group('Rules', RULES.map(r => `<div class="li"><span class="ic ${a[r.k] ? 'ok' : 'mute'}">${ico('bot')}</span><span class="body"><span class="t">${esc(t(r.l))}</span><span class="d">${esc(t(r.d))}</span></span><label class="sw"><input type="checkbox" data-rule="${r.k}" ${a[r.k] ? 'checked' : ''} aria-label="${esc(t(r.l))}"><span></span></label></div>`).join(''))}</div>
        <div class="stack">
          ${group('One-tap jobs', [li({ icon: 'wa', ic: 'ok', t: t('Monthly Billing & WhatsApp Reminders'), d: t('Generate monthly invoices & prepare personalized WhatsApp messages'), act: 'monthlybatch' }), li({ icon: 'wa', ic: 'ok', t: t('Send due reminders'), d: t('{n} residents overdue', { n: od.length }), act: 'remindall' }), li({ icon: 'wa', ic: 'info', t: t('Send all bills with pay link'), d: t('{n} residents with dues', { n: dueList().length }), act: 'billall' }), li({ icon: 'bolt', ic: 'warn', t: t('Enter meter readings'), act: 'readings' })].join(''))}
          ${group('Activity log', logs.map(l => li({ icon: 'check', ic: 'mute', t: l.msg, d: `${t((RULES.find(r => r.k === l.rule) || {}).l || l.rule)} · ${ago(l.ts)}` })).join(''))}
        </div>
      </div>`;
  },
};
A.autorun = () => { const n = runAutomation(true); toast(n ? t('Automation: {n} tasks done', { n }) : t('Everything is already up to date')); render(); };
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.rule; if (!k) return;
  Store.saveSettings({ auto: { [k]: e.target.checked } }).catch(err => toast(err.message, 'bad'));
  toast(e.target.checked ? 'Rule on' : 'Rule off'); setTimeout(render, 50);
});

/* ===================================================================== monthly batch & reminder center */
A.monthlybatch = () => {
  const ym = ymOf(today());
  const h = Store.hostel();
  const settings = S();
  // Get preview of monthly batch
  const preview = runMonthlyBillingBatch({ ym, options: { previewOnly: true } });
  const waMode = (settings.wa && settings.wa.mode) || 'click_to_chat';
  const isOfficial = waMode === 'official_api';
  const camps = Store.all('wa_campaign').filter(c => c.ym === ym);
  const queuedCount = camps.filter(c => c.status === 'queued').length;
  const sentCount = camps.filter(c => c.status === 'sent').length;
  const delivCount = camps.filter(c => c.status === 'delivered').length;
  const failCount = camps.filter(c => c.status === 'failed').length;
  const readyCount = activeRes().filter(r => isBillingComplete(r.id, ym).complete).length;

  const modalHtml = `
    <div style="font-size:13px;color:var(--text-mute,#64748b);margin-bottom:12px">
      ${esc(t('Generate this month\'s rent, electricity, mess, and recurring charges for all active residents. Invoices are generated safely exactly once. Review and dispatch personalized WhatsApp payment reminders.'))}
    </div>
    <div class="grid g4 keep2" style="margin-bottom:12px">
      ${kpi('Invoices Ready', readyCount, t('of {n} active', { n: activeRes().length }))}
      ${kpi('WhatsApp Queued', queuedCount, '', queuedCount ? 'info' : '')}
      ${kpi('Sent / Delivered', sentCount + delivCount, delivCount ? `${delivCount} delivered` : '', 'ok')}
      ${kpi('Delivery Failed', failCount, '', failCount ? 'bad' : '')}
    </div>
    <div class="row" style="gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
      ${btn('Generate Bills Now', 'runbillingbatch', `data-ym="${ym}"`, 'primary', 'bolt')}
      ${btn('Send Auto WhatsApp (Official API)', 'sendautowa', `data-ym="${ym}"`, 'wa', 'wa')}
      ${btn('Click-to-Chat Assistant (Free)', 'seq_sender_start', '', 'ghost', 'wa')}
      ${btn('Preview All Messages', 'preview_all_wa', '', 'ghost', 'eye')}
      ${isOfficial ? `<span class="badge ok">${ico('wa', 'sm')} Meta Cloud API</span>` : `<span class="badge info">${ico('wa', 'sm')} Free wa.me Mode</span>`}
    </div>
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
      <div class="group-t" style="margin:0">${esc(t('Eligible Residents & Prepared Reminders'))} (${preview.residents.length})</div>
      <div style="font-size:11px">
        <label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px">
          <input type="checkbox" id="batch-select-all" checked data-act="batchselectall">
          ${esc(t('Select All'))}
        </label>
      </div>
    </div>
    <div style="max-height:380px;overflow-x:auto;overflow-y:auto;border:1px solid var(--border,#e2e8f0);border-radius:8px">
      <table class="tbl" style="width:100%;font-size:12px;white-space:nowrap">
        <thead>
          <tr>
            <th style="width:30px"></th>
            <th>${esc(t('Resident'))}</th>
            <th>${esc(t('Phone'))}</th>
            <th>${esc(t('Period'))}</th>
            <th>${esc(t('Rent'))}</th>
            <th>${esc(t('Elec'))}</th>
            <th>${esc(t('Mess'))}</th>
            <th>${esc(t('Other'))}</th>
            <th>${esc(t('Prev Dues'))}</th>
            <th>${esc(t('Total Due'))}</th>
            <th>${esc(t('Status'))}</th>
            <th>${esc(t('Action'))}</th>
          </tr>
        </thead>
        <tbody>
          ${preview.residents.map(r => {
    const hasPhone = !!phone10(r.phone);
    const logged = Store.all('log').some(l => l.rule === 'remind' && l.resId === r.resId && l.date === today());
    const statusBadge = logged
      ? `<span class="badge ok">${esc(t('Opened'))}</span>`
      : !hasPhone
        ? `<span class="badge bad">${esc(t('No Phone'))}</span>`
        : r.totalDue > 0
          ? `<span class="badge warn">${esc(t('Pending'))}</span>`
          : `<span class="badge mute">${esc(t('Cleared'))}</span>`;

    return `<tr>
              <td><input type="checkbox" class="batch-chk" data-id="${esc(r.resId)}" ${hasPhone && r.totalDue > 0 ? 'checked' : ''}></td>
              <td><b>${esc(r.name)}</b><br><small class="mute">${esc(r.roomNo || '—')}${r.bed ? '-' + esc(r.bed) : ''}</small></td>
              <td>${esc(phone10(r.phone) || '—')}</td>
              <td><small class="mute">${esc(fmtYM(ym))}</small></td>
              <td>${r.rentAmount ? inr(r.rentAmount) : '—'}</td>
              <td>${r.elecAmount ? inr(r.elecAmount) : '—'}</td>
              <td>${r.messAmount ? inr(r.messAmount) : '—'}</td>
              <td>${r.chargesAmount ? inr(r.chargesAmount) : '—'}</td>
              <td>${r.previousDues ? inr(r.previousDues) : '—'}</td>
              <td><b>${inr(r.totalDue)}</b></td>
              <td>${statusBadge}</td>
              <td>
                ${hasPhone && r.totalDue > 0 ? `<a class="btn sm ghost" href="${esc(r.waLink)}" target="_blank" rel="noopener">${ico('wa', 'sm')} ${esc(t('Chat'))}</a>` : '<span class="mute">—</span>'}
              </td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>
    </div>
  `;

  sheet(t('Monthly Billing & WhatsApp Reminder Center') + ` (${fmtYM(ym)})`, modalHtml);
};

A.sendautowa = el => {
  const ym = (el && el.dataset && el.dataset.ym) || ymOf(today());
  const act = activeRes();
  let sent = 0, skipped = 0, dup = 0;
  for (const r of act) {
    const comp = isBillingComplete(r.id, ym);
    if (!comp.complete) {
      skipped++;
      continue;
    }
    try {
      sendMonthlyBillingWhatsApp(r.id, ym);
      sent++;
    } catch (e) {
      if (/already sent/i.test(e.message)) dup++;
    }
  }
  toast(t('Automated WhatsApp dispatch: {s} sent, {d} duplicate prevented, {sk} skipped (incomplete bill)', { s: sent, d: dup, sk: skipped }), 'ok');
  closeModal();
  render();
};

A.batchselectall = el => {
  document.querySelectorAll('.batch-chk').forEach(c => { c.checked = el.checked; });
};
if (!A.closemodal) {
  A.closemodal = () => { if (typeof closeModal === 'function') closeModal(); };
}

A.preview_all_wa = () => {
  const ym = ymOf(today());
  const preview = runMonthlyBillingBatch({ ym, options: { previewOnly: true } });
  const withDues = preview.residents.filter(r => phone10(r.phone) && r.totalDue > 0);
  if (!withDues.length) {
    toast(t('No residents with dues to preview'), 'info');
    return;
  }
  const html = `
    <div style="font-size:12px;color:var(--text-mute,#64748b);margin-bottom:12px">
      ${esc(t('Previewing personalized WhatsApp reminder messages for {n} residents with dues.', { n: withDues.length }))}
    </div>
    <div style="max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:10px">
      ${withDues.map((r, i) => `
        <div class="card" style="padding:10px;font-size:12px">
          <div class="row" style="margin-bottom:6px">
            <b>${i + 1}. ${esc(r.name)} (${esc(r.roomNo || '')})</b>
            <span class="sp"></span>
            <span class="badge warn">${inr(r.totalDue)}</span>
          </div>
          <div style="background:var(--card-subtle,#f8fafc);padding:8px;border-radius:4px;white-space:pre-wrap;font-family:inherit;font-size:11px">
${esc(r.messageText)}
          </div>
        </div>
      `).join('')}
    </div>
  `;
  sheet(t('Preview All Reminders') + ` (${withDues.length})`, html, { foot: btn('Close', 'closemodal', '', 'ghost') });
};

A.runbillingbatch = el => {
  const ym = el.dataset.ym || ymOf(today());
  try {
    const res = runMonthlyBillingBatch({ ym });
    toast(t('Billing batch complete: {c} invoices created, {s} skipped', { c: res.invoicesCreated, s: res.invoicesSkipped }));
    closeModal(true);
    render();
  } catch (e) {
    toast(e.message, 'bad');
  }
};

let _seqQueue = [];
let _seqIdx = 0;

A.seq_sender_start = () => {
  const ym = ymOf(today());
  const checkedBoxes = Array.from(document.querySelectorAll('.batch-chk:checked'));
  const checkedIds = new Set(checkedBoxes.map(el => el.dataset.id));
  const preview = runMonthlyBillingBatch({ ym, options: { previewOnly: true } });
  const list = preview.residents.filter(r => phone10(r.phone) && r.totalDue > 0 && (checkedIds.size === 0 || checkedIds.has(r.resId)));
  if (!list.length) {
    toast('No residents selected with dues and valid phone numbers', 'info');
    return;
  }
  _seqQueue = list.map(r => {
    return {
      r: resById(r.resId) || { id: r.resId, name: r.name, phone: r.phone, roomId: null },
      due: r.totalDue,
      msg: r.messageText,
      waUrl: r.waLink
    };
  });
  _seqIdx = 0;
  A.seq_sender_step();
};

A.seq_sender_step = () => {
  if (_seqIdx >= _seqQueue.length) {
    sheet(t('Sending Complete'), `<div style="text-align:center;padding:20px 0"><div style="font-size:32px;margin-bottom:8px">🎉</div><b>${esc(t('All reminders processed!'))}</b><p class="mute">${_seqQueue.length} ${esc(t('residents reached.'))}</p></div>`, { foot: btn('Done', 'closemodal', '', 'primary') });
    return;
  }
  const item = _seqQueue[_seqIdx];
  const total = _seqQueue.length;
  const current = _seqIdx + 1;
  const room = roomById(item.r.roomId);

  const html = `
    <div style="font-size:12px;color:var(--text-mute,#64748b);margin-bottom:10px">
      ${esc(t('Resident {c} of {t}', { c: current, t: total }))}
    </div>
    <div class="card" style="margin-bottom:12px">
      <div style="font-weight:700;font-size:15px">${esc(item.r.name)}</div>
      <div class="mute" style="font-size:12px;margin-bottom:6px">${esc(room ? room.no : '')}-${esc(item.r.bed || '')} · 📱 +91 ${esc(phone10(item.r.phone))}</div>
      <div style="font-size:13px;font-weight:600;color:var(--bad,#dc2626)">${esc(t('Total Dues'))}: ${inr(item.due)}</div>
    </div>
    <div style="font-size:12px;font-weight:600;margin-bottom:4px">${esc(t('Personalized Message Preview'))}:</div>
    <div style="padding:10px;background:var(--card-subtle,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:6px;font-size:12px;white-space:pre-wrap;margin-bottom:14px;max-height:120px;overflow-y:auto">
${esc(item.msg)}
    </div>
    <div class="hint" style="margin-bottom:12px;font-size:11px">
      ℹ️ ${esc(t('Tapping "Open WhatsApp" opens the pre-filled chat in WhatsApp. Tap Send in WhatsApp to deliver the message. Then tap "Mark Sent & Next".'))}
    </div>
  `;

  sheet(`${t('WhatsApp Assistant')} (${current}/${total})`, html, {
    foot: `
      <a class="btn wa" href="${esc(item.waUrl)}" target="_blank" rel="noopener" style="margin-right:auto">${ico('wa', 'sm')} ${esc(t('Open WhatsApp'))}</a>
      ${btn('Skip', 'seq_sender_skip', '', 'ghost')}
      ${btn('Mark Sent & Next ➡️', 'seq_sender_next', '', 'primary')}
    `
  });
};

A.seq_sender_next = () => {
  const item = _seqQueue[_seqIdx];
  if (item) {
    Store.put('log', {
      id: `log-rem-${item.r.id}-${today()}`,
      rule: 'remind',
      msg: `${item.r.name} · ${inr(item.due)} (wa.me opened)`,
      resId: item.r.id,
      date: today(),
      ts: nowIso()
    });
  }
  _seqIdx++;
  A.seq_sender_step();
};

A.seq_sender_skip = () => {
  _seqIdx++;
  A.seq_sender_step();
};

A.settlementview = el => {
  const dep = Store.get(el.dataset.id);
  if (!dep || !dep.settlement) return toast('No settlement statement available', 'info');
  const s = dep.settlement;
  const html = `
    <div class="card" style="font-size:13px;line-height:1.6">
      <div style="text-align:center;margin-bottom:14px;border-bottom:1px solid var(--border,#e2e8f0);padding-bottom:10px">
        <h3 style="margin:0">${esc(hostelName())}</h3>
        <b>${esc(t('FINAL CHECKOUT SETTLEMENT STATEMENT'))}</b><br>
        <small class="mute">${esc(fmtDate(s.checkoutDate))}</small>
      </div>
      <dl class="kv">
        <dt>${esc(t('Resident Name'))}</dt><dd><b>${esc(s.name)}</b></dd>
        <dt>${esc(t('Room & Bed'))}</dt><dd>${esc(s.roomNo)}-${esc(s.bed)}</dd>
        <dt>${esc(t('Check-in Date'))}</dt><dd>${esc(fmtDate(s.checkIn))}</dd>
        <dt>${esc(t('Checkout Date'))}</dt><dd>${esc(fmtDate(s.checkoutDate))}</dd>
        <dt>${esc(t('Security Deposit Paid'))}</dt><dd>${inr(s.depositPaid)}</dd>
        ${s.credit > 0 ? `<dt>${esc(t('Eligible Credit Balance'))}</dt><dd>${inr(s.credit)}</dd>` : ''}
        <dt>${esc(t('Unpaid Rent & Dues Settle'))}</dt><dd>${inr(s.settleFromDeposit)}</dd>
        ${s.shortfallFee > 0 ? `<dt class="warn-t">${esc(t('Notice Shortfall (' + s.shortfallDays + ' days)'))}</dt><dd class="warn-t">${inr(s.shortfallFee)}</dd>` : ''}
        <dt>${esc(t('Damage / Other Deductions'))}</dt><dd>${inr(s.deductions)}</dd>
        <dt style="border-top:1px solid var(--border,#e2e8f0);padding-top:6px"><b>${esc(t('Net Refund Amount'))}</b></dt>
        <dd style="border-top:1px solid var(--border,#e2e8f0);padding-top:6px"><b class="ok-t" style="font-size:16px">${inr(s.refund)}</b></dd>
        ${s.balancePayable > 0 ? `<dt class="bad-t"><b>${esc(t('Balance Payable by Resident'))}</b></dt><dd class="bad-t"><b>${inr(s.balancePayable)}</b></dd>` : ''}
      </dl>
      ${s.notes ? `<div style="margin-top:10px;padding:8px;background:var(--card-subtle,#f8fafc);border-radius:4px;font-size:12px"><b>Note:</b> ${esc(s.notes)}</div>` : ''}
    </div>
  `;
  sheet(t('Settlement Statement'), html, { foot: btn('Print / Close', 'closemodal', '', 'primary') });
};

A.reconcilepay = async () => {
  const h = Store.hostel();
  if (!h || !h.id) return toast(t('No active hostel selected'), 'bad');
  toast(t('Reconciling with Cashfree gateway...'));
  try {
    const res = await Backend.admin('reconcile_payments', { hostel_id: h.id });
    if (res && res.ok) {
      toast(t('Reconciliation done: {c} checked, {r} updated', { c: res.orders_checked, r: res.resolved_count }), 'ok');
      render();
    }
  } catch (err) {
    toast(err.message, 'bad');
  }
};

/* ===================================================================== PG inquiries */
PAGES.inquiries = {
  title: 'PG Inquiries', mod: 'inquiries',
  render() {
    const list = Store.all('inquiry').slice().sort(by('createdAt', -1));
    const sf = curFlt('inq', 'all');
    const df = curFlt('inqd', 'all');

    // Frequency analysis for phone numbers to detect duplicates
    const phoneCounts = {};
    for (const item of list) {
      const p = String((item.data && item.data.phone) || '').replace(/\D/g, '').slice(-10);
      if (p) phoneCounts[p] = (phoneCounts[p] || 0) + 1;
    }
    const livingPhones = new Set(allResidents().map(r => String(r.phone || '').replace(/\D/g, '').slice(-10)).filter(Boolean));

    const shown = list.filter(x => {
      const d = x.data || {};
      const st = d.status || 'new';
      if (sf !== 'all' && st !== sf) return false;

      const dStr = x.day || d.createdAt || '';
      if (df === 'today' && !dStr.startsWith(today())) return false;
      if (df === 'week') {
        const cutoff = addDays(today(), -7);
        if (dStr < cutoff) return false;
      }
      if (df === 'month') {
        const m = ymOf(today());
        if (!dStr.startsWith(m)) return false;
      }

      return needle('inq', d.name, d.phone, d.roomType, d.email);
    });

    const statusBadge = st => {
      const map = {
        new: ['New', 'warn'],
        contacted: ['Contacted', 'info'],
        visit_scheduled: ['Visit Scheduled', 'info'],
        interested: ['Interested', 'ok'],
        converted: ['Converted', 'ok'],
        not_interested: ['Not Interested', 'mute'],
        closed: ['Closed', 'mute']
      };
      const [lbl, cls] = map[st] || ['New', 'warn'];
      return badge(lbl, cls);
    };

    const inqItem = x => {
      const d = x.data || {};
      const rawPhone = String(d.phone || '').replace(/\D/g, '');
      const phone10 = rawPhone.slice(-10);
      const isDup = (phoneCounts[phone10] || 0) > 1;
      const isLiving = livingPhones.has(phone10);
      const assigned = d.staffId ? staffById(d.staffId) : null;

      const hName = (Store.hostel() || {}).name || 'our hostel';
      const msgLines = [
        `Hello ${d.name || ''}, thank you for your interest in ${hName}!`,
        d.roomType ? `Interested in: ${d.roomType}` : '',
        d.moveIn ? `Expected move-in: ${fmtDate(d.moveIn)}` : '',
        d.occupants ? `Occupants: ${d.occupants}` : '',
        d.budget ? `Budget: Rs. ${d.budget}` : '',
        `When would you like to schedule a visit?`
      ].filter(Boolean).join('\n');
      const waUrl = `https://wa.me/91${phone10}?text=${encodeURIComponent(msgLines)}`;

      return `<div class="card" style="margin-bottom:10px">
        <div class="row sb wrap" style="gap:6px">
          <div>
            <b>${esc(d.name || 'Anonymous')}</b>
            ${isDup ? `<span class="badge warn" style="margin-left:6px">${ico('alert', 'xs')} Duplicate (${phoneCounts[phone10]}x)</span>` : ''}
            ${isLiving ? `<span class="badge info" style="margin-left:6px">${ico('user', 'xs')} Existing Resident</span>` : ''}
          </div>
          <div>${statusBadge(d.status || 'new')}</div>
        </div>
        <div class="muted sm" style="margin:4px 0">
          ${esc(d.phone || '—')}${d.email ? ' · ' + esc(d.email) : ''} · ${esc(d.roomType || 'Any Room')} · ${d.budget ? inr(d.budget) : 'Flexible Budget'} · Received: ${fmtShort(x.day || d.createdAt || today())}
        </div>
        ${d.moveIn || d.occupants ? `<div class="xs muted" style="margin:2px 0">${d.moveIn ? `Move-in: <b>${fmtDate(d.moveIn)}</b> · ` : ''}${d.occupants ? `Occupants: <b>${d.occupants}</b> · ` : ''}Consent: ${d.consent ? 'Yes' : 'No'}</div>` : ''}
        ${d.message ? `<p class="sm" style="margin:6px 0;background:var(--card-subtle,#f8fafc);padding:6px;border-radius:6px">${esc(d.message)}</p>` : ''}
        <div class="row sb wrap sm muted" style="margin:4px 0">
          <div>${assigned ? `${ico('user', 'xs')} Assigned: <b>${esc(assigned.name)}</b>` : '<span class="muted">Unassigned</span>'}</div>
          ${d.followUpDate ? `<div>${ico('clock', 'xs')} Follow-up: <b>${fmtDate(d.followUpDate)}</b></div>` : ''}
        </div>
        <div class="row wrap" style="gap:6px;margin-top:8px">
          <a class="btn sm" href="${esc(waUrl)}" target="_blank" rel="noopener">${ico('chat', 'sm')} WhatsApp Follow-up</a>
          <button class="btn sm" data-act="inqstatus" data-id="${x.id}">${ico('edit', 'sm')} Status & Staff</button>
          ${d.status !== 'converted' ? `<button class="btn sm primary" data-act="inqconvert" data-id="${x.id}">${ico('userplus', 'sm')} Convert to Resident</button>` : `<span class="sm ok-t">${ico('check', 'sm')} Converted</span>`}
        </div>
      </div>`;
    };

    return `${head('PG Inquiries', t('{n} inquiries received', { n: list.length }))}
      <div class="tool">${searchBox('inq', 'Search name, phone, room')}<span class="sp"></span>${chips('inq', [
      ['all', 'All Statuses'], ['new', 'New'], ['contacted', 'Contacted'], ['visit_scheduled', 'Visit'],
      ['interested', 'Interested'], ['converted', 'Converted'], ['closed', 'Closed']
    ], 'all')}</div>
      <div class="tool" style="margin-top:-6px"><span class="muted sm">Date:</span>${chips('inqd', [
      ['all', 'All Time'], ['today', 'Today'], ['week', 'Past 7 Days'], ['month', 'This Month']
    ], 'all')}</div>
      ${shown.length ? `<div class="stack">${shown.map(inqItem).join('')}</div>` : `<div class="card">${empty('No inquiries found', 'When visitors submit the form on your public page, they appear here.')}</div>`}`;
  }
};

A.inqstatus = el => {
  const inq = Store.get(el.dataset.id);
  if (!inq) return;
  const d = inq.data || {};
  const staffOpts = [{ v: '', l: 'Unassigned' }].concat(staffList().map(s => ({ v: s.id, l: s.name })));
  formModal({
    title: `Inquiry Status · ${d.name || ''}`,
    submit: 'Update Inquiry',
    fields: [
      {
        name: 'status', label: 'Current Status', type: 'select',
        options: [
          { v: 'new', l: 'New' },
          { v: 'contacted', l: 'Contacted' },
          { v: 'visit_scheduled', l: 'Visit Scheduled' },
          { v: 'interested', l: 'Interested' },
          { v: 'converted', l: 'Converted to Resident' },
          { v: 'not_interested', l: 'Not Interested' },
          { v: 'closed', l: 'Closed' }
        ],
        value: d.status || 'new', required: true
      },
      { name: 'staffId', label: 'Assign to Staff', type: 'select', options: staffOpts, value: d.staffId || '' },
      { name: 'followUpDate', label: 'Follow-up Date', type: 'date', value: d.followUpDate || '' },
      { name: 'note', label: 'Add Operator Note', maxlength: 200 }
    ],
    onSubmit: v => {
      const notes = (d.notes || []).slice();
      if (v.note && v.note.trim()) {
        notes.push({ text: v.note.trim(), by: (Store.me && Store.me.full_name) || 'Operator', at: nowIso() });
      }
      Store.patch(inq.id, {
        data: {
          ...d,
          status: v.status,
          staffId: v.staffId || null,
          followUpDate: v.followUpDate || null,
          notes
        }
      });
      toast(t('Inquiry updated ✓'), 'ok');
      render();
    }
  });
};

A.inqconvert = el => {
  const inq = Store.get(el.dataset.id);
  if (!inq) return;
  const d = inq.data || {};
  A.checkin(null, {
    inquiryId: inq.id,
    name: d.name,
    phone: d.phone,
    email: d.email
  });
};

/* ===================================================================== e-mitra / police verification portal */
PAGES.emitra = {
  title: 'Police Verification Queue', mod: 'emitra',
  render() {
    const list = emitraPendingQueue();
    const pvReq = pvOn();
    return `${head('E-Mitra Police Verification', t('{n} residents awaiting verification', { n: list.length }))}
      ${!pvReq ? `<div class="note warn">${ico('alert', 'sm')} ${esc(t('Police Verification Required is switched OFF by owner. Residents are not blocked, but verification records can still be submitted.'))}</div>` : ''}
      <div class="card" style="margin-bottom:12px">
        <div class="row sb"><b>${esc(t('External Verification Queue'))}</b><span class="muted sm">${esc(t('Official E-Mitra / Citizen Portal'))}</span></div>
        <p class="hint" style="margin-top:6px">${esc(t('Authorized operator workflow: download documents, submit details on official state police portal, and upload the resulting acknowledgement / certificate.'))}</p>
      </div>
      ${list.length ? `<div class="stack">${list.map(r => {
      const pv = r.pv || {};
      const docs = r.docs || [];
      return `<div class="card" style="margin-bottom:10px">
          <div class="row sb"><b>${esc(r.name)}</b>${badge(pv.status || 'Pending Docs', pv.status === 'verified' ? 'ok' : 'warn')}</div>
          <div class="muted sm" style="margin:4px 0">${roomName(r.roomId)} · Checked in ${fmtDate(r.checkIn)}</div>
          <div class="xs" style="margin:6px 0"><b>Aadhaar (Masked):</b> ${esc(maskAadhaar(r.idNo || ''))}</div>
          <div class="row wrap" style="gap:6px;margin:8px 0">
            ${docs.length ? docs.map(d => `<span class="badge ${d.url || d.path ? 'ok' : 'mute'}">${ico('file', 'xs')} ${esc(d.type || 'Doc')}</span>`).join('') : '<span class="muted xs">No KYC docs uploaded yet</span>'}
          </div>
          <div class="row wrap" style="gap:8px;margin-top:10px">
            <button class="btn sm primary" data-act="emitraverify" data-id="${r.id}">${ico('shield', 'sm')} Process Verification</button>
            ${isAdmin() ? `<button class="btn sm" data-act="go" data-to="residents/${r.id}">${ico('user', 'sm')} ${esc(t('View Resident'))}</button>` : ''}
          </div>
        </div>`;
    }).join('')}</div>` : `<div class="card">${empty('Verification queue clear 🎉', 'No residents currently pending verification.')}</div>`}`;
  }
};

A.emitraverify = el => {
  const r = resById(el.dataset.id);
  if (!r) return;
  const pv = r.pv || {};
  const portal = pvPortal(pv.state || S().police.state);
  const portalName = pvStateName(pv.state || S().police.state) || 'State Police';
  const docs = r.docs || [];
  const kycDocsHtml = docs.length
    ? `<div class="row wrap" style="gap:8px;margin-top:6px">${docs.map(d => `<button type="button" class="btn sm" data-act="opendoc" data-path="${esc(d.path || '')}" data-res="${r.id}" data-type="${esc(d.type || 'Document')}">${ico('file', 'sm')} ${esc(d.type || 'Document')}</button>`).join('')}</div>`
    : `<div class="muted sm" style="margin-top:4px">${esc(t('No KYC documents uploaded yet.'))}</div>`;

  formModal({
    title: `Police Verification · ${r.name}`,
    submit: 'Save Verification',
    wide: true,
    fields: [
      {
        type: 'html',
        html: `
          <div class="card" style="margin-bottom:12px;background:var(--card-subtle,#f8fafc)">
            <div style="font-weight:700;font-size:14px;margin-bottom:6px">${esc(r.name)} · <span class="muted">${roomName(r.roomId)}-${esc(r.bed)}</span></div>
            <div class="grid g2" style="font-size:12px;gap:6px">
              <div><b>Mobile:</b> ${esc(r.phone)}</div>
              <div><b>Aadhaar:</b> ${esc(r.idNo || 'Not entered')}</div>
              <div><b>Father / Guardian:</b> ${esc(r.guardian || '—')} ${r.guardianPhone ? `(${esc(r.guardianPhone)})` : ''}</div>
              <div><b>Check-in Date:</b> ${fmtDate(r.checkIn)}</div>
              <div style="grid-column:span 2"><b>Permanent Address:</b> ${esc(r.address || '—')}</div>
            </div>
            <div style="margin-top:10px">
              <b style="font-size:12px">${esc(t('KYC Papers (Aadhaar / Photo):'))}</b>
              ${kycDocsHtml}
            </div>
            ${portal ? `<div style="margin-top:10px"><a class="btn sm primary" href="${esc(portal)}" target="_blank" rel="noopener">${ico('globe', 'sm')} Open ${esc(portalName)} Portal</a></div>` : ''}
          </div>
        `
      },
      { name: 'refNo', label: 'Police Acknowledgement / Reference Number', value: pv.refNo || '', required: true, maxlength: 60, hint: 'Reference number from the state police portal acknowledgement' },
      { name: 'date', label: 'Verification Date', type: 'date', value: pv.date || today(), required: true },
      { name: 'status', label: 'Verification Status', type: 'select', options: [{ v: 'submitted', l: 'Submitted / Acknowledgement Received' }, { v: 'verified', l: 'Verified / Certificate Issued' }, { v: 'rejected', l: 'Rejected by Police' }], value: pv.status || 'submitted', required: true },
      { name: 'file', label: 'Upload Police Acknowledgement / Certificate', type: 'file', accept: 'image/*,application/pdf' },
      { name: 'notes', label: 'Operator Notes', value: pv.notes || '', maxlength: 200 }
    ],
    onSubmit: async v => {
      try {
        let certPath = pv.certificatePath || null;
        const f = (v.file || [])[0];
        if (f) {
          if (Files && typeof Files.ready === 'function' && Files.ready()) {
            const doc = await Files.upload(f, 'res', r.id, 'Police Verification Certificate');
            certPath = doc.url || doc.path || doc.name;
            pvToDocs(r.id, doc);
          } else {
            certPath = f.name;
          }
        }
        submitPoliceVerification(r.id, {
          refNo: v.refNo,
          date: v.date,
          status: v.status,
          certificatePath: certPath,
          notes: v.notes
        });
        toast(t('Police verification updated ✓'), 'ok');
        render();
      } catch (err) {
        return err.message;
      }
    }
  });
};
