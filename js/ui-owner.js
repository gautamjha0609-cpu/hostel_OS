'use strict';
/* Owner / manager screens: home, approvals, rooms, residents, payments, electricity, expenses, reports, notices, automation. */

const resOpts = (list = activeRes()) => list.slice().sort(by('name')).map(r => ({ v: r.id, l: resLabel(r) }));
const person = (r, sub) => `<div class="person">${avatar(r.name)}<div style="min-width:0"><b><button class="linkish" data-act="go" data-to="residents/${r.id}">${esc(r.name)}</button></b><small>${sub ?? ''}</small></div></div>`;
const hostelName = () => (Store.hostel() || {}).name || '';
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
  return [{ name, label, type: 'number', min: 0, required: true, step: 0.1,
    hint: (hint.last ? t('Last reading {u} on {d}.', { u: num(hint.last.curr), d: fmtShort(hint.last.date) }) + ' ' : '') + who,
    info: t('Electricity is split between the readings on either side of it. Taking one now ends the current stretch and starts a fresh one, so everybody pays for the units they actually used, and free units are counted only for the days they stayed.') }];
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
      pr: btn('Review', 'prview', `data-id="${x.id}"`, 'sm primary'),
      meter: `${btn('Edit', 'meteredit', `data-id="${x.id}"`, 'sm')}${btn('Bill it', 'meterok', `data-id="${x.id}"`, 'sm ok')}`,
      dep: btn('Mark refunded', 'depok', `data-id="${x.id}"`, 'sm ok'),
      cmp: btn('Open', 'go', 'data-to="complaints"', 'sm'),
      hk: `${btn('Reassign', 'hkreassign', `data-id="${x.id}"`, 'sm')}${btn('OK', 'hkack', `data-id="${x.id}"`, 'sm')}`,
      mbill: btn('Send', 'mbillsend', '', 'sm ok', 'wa'),
      remind: btn('Send', 'remindsend', '', 'sm ok', 'wa'),
      pv: `${btn('Open resident', 'go', `data-to="residents/${x.id}"`, 'sm')}${btn('Update', 'pvstatus', `data-id="${x.id}"`, 'sm primary')}`,
    }[x.k] || '');
    return `${head('Approvals', t('Only the things that need a human. Everything else runs automatically.'))}
      ${list.length ? `<div class="group">${list.map(x => `<div class="li"><span class="ic ${x.ic}">${ico(x.icon)}</span><span class="body"><span class="t">${esc(x.t)}</span><span class="d">${esc(x.d)} · ${esc(ago(x.ts || nowIso()))}</span></span><span class="end">${acts(x)}</span></div>`).join('')}</div>` : `<div class="card">${empty('All clear 🎉', 'Nothing needs your approval right now.')}</div>`}`;
  },
};
A.claimview = el => {
  const c = Store.get(el.dataset.id), r = resById(c.resId);
  sheet('UPI payment', `<dl class="kv"><dt>${esc(t('Resident'))}</dt><dd>${esc(resLabel(r))}</dd><dt>${esc(t('Amount'))}</dt><dd>${inr(c.amount)}</dd><dt>UTR</dt><dd>${esc(c.utr || '—')}</dd><dt>${esc(t('Date'))}</dt><dd>${fmtDate(c.date)}</dd><dt>${esc(t('Current due'))}</dt><dd>${inr(resDue(c.resId))}</dd></dl><p class="hint" style="margin-top:10px">${esc(t('Check the UTR in your bank/UPI app before approving.'))}</p>`,
    { foot: `<button class="btn bad" data-act="claimno" data-id="${c.id}">${esc(t('Reject'))}</button><span class="sp"></span><button class="btn ok" data-act="claimok" data-id="${c.id}">${esc(t('Approve'))}</button>` });
};
A.claimok = el => {
  const c = Store.get(el.dataset.id); if (!c || c.status !== 'pending') return;
  const pay = recordPayment({ resId: c.resId, amount: c.amount, mode: 'upi', ref: c.utr, date: c.date, claimId: c.id });
  Store.patch(c.id, { status: 'approved', payId: pay.id, by: Store.me.full_name });
  closeModal(true); render();
  toast('Payment approved');
  if (S().wa.auto) waOpen(resById(c.resId).phone, receiptMessage(pay), 'Send receipt');
};
A.claimno = el => formModal({
  title: 'Reject payment', submit: 'Reject', fields: [{ name: 'why', label: 'Reason (sent to resident)', required: true, value: t('UTR not found in our account') }],
  onSubmit: v => { const c = Store.get(el.dataset.id); Store.patch(c.id, { status: 'rejected', reason: v.why }); notify({ to: 'res', resId: c.resId, title: t('Payment not verified'), body: v.why }); toast('Rejected'); },
});
A.meterok = el => { const m = Store.get(el.dataset.id); billMeter(m); toast('Bills created'); render(); };
A.meteredit = el => { const m = Store.get(el.dataset.id); formModal({ title: `${t('Fix reading')} · ${roomName(m.roomId)}`, fields: [{ name: 'prev', label: 'Previous reading', type: 'number', value: m.prev, step: 0.1 }, { name: 'curr', label: 'Current reading', type: 'number', value: m.curr, required: true, step: 0.1 }], onSubmit: v => { Store.remove(m.id); addReading({ roomId: m.roomId, prev: v.prev, curr: v.curr, date: m.date }); toast('Reading updated'); } }); };
A.depok = el => formModal({
  title: 'Deposit refund', submit: 'Mark refunded',
  fields: [{ name: 'mode', label: 'Paid by', type: 'select', options: [{ v: 'upi', l: 'UPI' }, { v: 'cash', l: t('Cash') }, { v: 'bank', l: t('Bank transfer') }] }, { name: 'ref', label: 'Reference / UTR' }],
  onSubmit: v => { Store.patch(el.dataset.id, { status: 'paid', mode: v.mode, ref: v.ref, paidOn: today() }); toast('Refund recorded'); },
});
A.hkack = el => { Store.patch(el.dataset.id, { ack: true }); render(); };
A.hkreassign = el => {
  const x = Store.get(el.dataset.id);
  formModal({ title: `${t('Reassign')} · ${x.roomNo}`, fields: [{ name: 'staff', label: 'Housekeeping staff', type: 'select', options: hkStaff().filter(s => s.status === 'active').map(s => ({ v: s.id, l: s.name })), value: x.staffId, required: true }, { name: 'date', label: 'Date', type: 'date', value: today() }],
    onSubmit: v => { const s = staffById(v.staff); Store.put('hkt', { ...x, id: `hkt-${v.date}-${x.roomId}-re${Date.now().toString(36)}`, _u: null, date: v.date, staffId: s.id, staffName: s.name, status: 'pending', reason: '', doneAt: null, ack: false }); Store.patch(x.id, { ack: true }); notify({ to: 'staff', staffId: s.id, title: t('Room assigned'), body: `${x.roomNo} · ${fmtShort(v.date)}` }); toast('Reassigned'); } });
};

/* ===================================================================== rooms */
PAGES.rooms = {
  title: 'Rooms & Beds', mod: 'rooms',
  render() {
    const occ = occupancy(), f = curFlt('rooms', 'all');
    // With blocks and no block chosen, the wing becomes the outer heading: "Block A · Floor 1".
    const split = blocksOn() && !blockScope();
    const list0 = split ? rooms().slice().sort((a, b) => blockOrder(roomBlock(a)) - blockOrder(roomBlock(b))) : rooms();
    const byFloor = groupBy(list0, r => (split ? `${blockName(roomBlock(r))} · ` : '') + r.floor);
    const bedHtml = (room, b) => {
      const r = b.resId ? resById(b.resId) : null, due = r ? resDue(r.id) : 0;
      const cls = b.status === 'occ' ? 'occ' : b.status === 'mnt' ? 'mnt' : 'vac';
      return `<button class="bed ${cls}" data-act="bed" data-room="${room.id}" data-bed="${b.id}"><b>${esc(b.id)} · ${r ? esc(r.name.split(' ')[0]) : esc(t(b.status === 'mnt' ? 'Repair' : 'Vacant'))}</b>${r ? (due ? `<span class="bad-t">${inr(due)} ${esc(t('due'))}</span>` : esc(t('Paid up'))) : esc(t(b.status === 'mnt' ? 'Blocked' : 'Tap to check in'))}</button>`;
    };
    return `${head('Rooms & Beds', t('{o} occupied · {v} vacant · {p}% full', { o: occ.occ, v: occ.vac, p: occ.pct }), `${btn('Add room', 'addroom', '', '', 'plus')}${btn('Check-in', 'checkin', '', 'primary', 'userplus')}`)}
      <div class="tool">${chips('rooms', [['all', 'All rooms'], ['vac', 'Has vacant bed'], ['due', 'Has dues']], 'all')}<span class="sp"></span><div class="key"><span><i style="background:var(--ok-bg)"></i>${esc(t('Vacant'))}</span><span><i style="background:var(--info-bg)"></i>${esc(t('Occupied'))}</span><span><i style="background:var(--bad-bg)"></i>${esc(t('Repair'))}</span></div></div>
      ${Object.keys(byFloor).length ? Object.entries(byFloor).map(([fl, list]) => {
        const shown = list.filter(r => f === 'all' || (f === 'vac' && bedsOf(r).some(b => b.status === 'vac')) || (f === 'due' && bedsOf(r).some(b => b.resId && resDue(b.resId) > 0)));
        return shown.length ? `<section class="floor"><h3>${esc(fl)}</h3><div class="rooms">${shown.map(room => `<div class="room"><div class="hd"><b>${esc(room.no)}</b><span class="row" style="gap:6px"><span class="muted xs">${inr(room.rent)}/${esc(t('bed'))}${room.ac ? ' · AC' : ''}</span><button class="btn sm ghost" data-act="editroom" data-id="${room.id}" aria-label="${esc(t('Edit room'))}">${ico('edit', 'sm')}</button></span></div><div class="beds">${bedsOf(room).map(b => bedHtml(room, b)).join('')}</div></div>`).join('')}</div></section>` : '';
      }).join('') : `<div class="card">${empty('No rooms yet', 'Add your rooms and beds to start.', btn('Add room', 'addroom', '', 'primary', 'plus'))}</div>`}`;
  },
};
A.bed = el => {
  const room = roomById(el.dataset.room), b = bedsOf(room).find(x => x.id === el.dataset.bed);
  if (b.status === 'occ' && b.resId) return go('residents/' + b.resId);
  if (b.status === 'mnt') return confirmBox(t('Bed {b} is blocked for repair. Make it available again?', { b: `${room.no}-${b.id}` }), () => setBed(room.id, b.id, { status: 'vac' }), 'Make available');
  sheet(`${t('Bed')} ${room.no}-${b.id}`, `<div class="group">${li({ icon: 'userplus', ic: 'ok', t: t('Check in a resident here'), act: 'checkin', attrs: `data-bed="${room.id}|${b.id}"` })}${li({ icon: 'wrench', ic: 'bad', t: t('Block for repair'), act: 'bedmnt', attrs: `data-room="${room.id}" data-bed="${b.id}"` })}</div>`);
};
A.bedmnt = el => { setBed(el.dataset.room, el.dataset.bed, { status: 'mnt' }); closeModal(); render(); toast('Bed blocked'); };
function roomForm(room) {
  const r = room || {};
  formModal({
    title: room ? `${t('Edit room')} ${r.no}` : 'Add room', submit: room ? 'Save' : 'Add room',
    fields: [
      { name: 'no', label: 'Room number', value: r.no, required: true }, { name: 'floor', label: 'Floor', value: r.floor || `${t('Floor')} 1`, required: true },
      ...(blocksOn() ? [{ name: 'block', label: 'Block', type: 'select', value: roomBlock(r),
        options: [{ v: '', l: t('Not in a block') }, ...hostelBlocks().map(b => ({ v: b.k, l: b.l }))],
        info: t('Everyone living in this room counts as being in this block. Beds, bills and the head count stay with the hostel.') }] : []),
      { name: 'beds', label: 'Number of beds', type: 'number', value: r.beds ? r.beds.length : 2, min: 1, max: 12, required: true }, { name: 'rent', label: 'Rent per bed (₹/month)', type: 'number', value: r.rent, min: 0, required: true },
      { name: 'ac', label: 'AC room', type: 'checkbox', value: r.ac },
    ],
    danger: room && !bedsOf(room).some(b => b.status === 'occ') ? { label: 'Delete room', run: () => confirmBox(t('Delete room {r}?', { r: r.no }), () => { Store.remove(r.id); toast('Room deleted'); }, 'Delete', 'bad') } : null,
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

/* ===================================================================== check-in */
A.checkin = el => {
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
      { name: 'name', label: 'Full name', required: true }, { name: 'phone', label: 'Mobile (WhatsApp)', type: 'tel', required: true },
      { name: 'guardian', label: 'Parent / guardian name' }, { name: 'guardianPhone', label: 'Guardian mobile', type: 'tel' },
      { name: 'college', label: 'College / office' }, { name: 'idNo', label: 'ID number (Aadhaar etc.)' },
      { name: 'address', label: 'Home address', full: true },
      { type: 'section', label: 'Room & money' },
      { name: 'bed', label: 'Room & bed', type: 'select', options: bedOpts, value: pre, required: true },
      { name: 'checkIn', label: 'Check-in date', type: 'date', value: today(), required: true },
      ...meterField(room0 ? room0.id : ''),
      { name: 'rent', label: 'Monthly rent (₹)', type: 'number', value: room0 ? room0.rent : '', min: 0, required: true, hint: t('Filled from the room. Change only for a special deal.') },
      { name: 'deposit', label: 'Security deposit (₹)', type: 'number', value: room0 ? room0.rent : 0, min: 0 },
      { name: 'food', label: 'Takes mess food', type: 'checkbox', value: true },
      { name: 'lang', label: 'WhatsApp language', type: 'select', options: [{ v: 'en', l: 'English' }, { v: 'hi', l: 'हिन्दी' }], value: S().wa.lang === 'hi' ? 'hi' : 'en' },
      { type: 'section', label: 'Documents' },
      ...req.map((d, i) => ({ name: 'doc' + i, label: d, type: 'file', accept: 'image/*,application/pdf' })),
      { type: 'html', html: docsNote() },
      ...(pvOn() ? [
        { type: 'section', label: 'Police verification' },
        { name: 'pvState', label: 'State / portal', type: 'select', value: S().police.state || '',
          options: [{ v: '', l: t('Use the hostel default') }].concat(PV_STATES.map(([k, l]) => ({ v: k, l: t(l) }))) },
        { type: 'html', html: `<div class="hint">${esc(t('Marked as not started. Open the portal from the resident page when you are ready — their details are one tap away.'))}</div>` },
      ] : []),
      { type: 'section', label: 'App login' },
      { name: 'login', label: 'Create app login for resident', type: 'checkbox', value: true, hint: t('User ID = name, password = mobile number. They can change it later.') },
    ],
    onChange: (v, form, changed) => {
      if (changed === 'bed') { const rm = roomById(String(v.bed).split('|')[0]); if (rm) { setField(form, 'rent', rm.rent); setField(form, 'deposit', rm.rent); } }
    },
    preview: v => v.name ? `<b>${esc(t('Login'))}:</b> ${esc(slug(v.name))} / ${esc(phone10(v.phone) || '—')} · <b>${esc(t('First bill'))}:</b> ${inr(v.rent || 0)} + ${inr(v.deposit || 0)} ${esc(t('deposit'))}` : '',
    onSubmit: async v => {
      if (residents().some(r => r.status !== 'left' && r.phone === phone10(v.phone))) return 'A resident with this mobile number already exists';
      const [roomId, bed] = v.bed.split('|');
      // Settle the room's electricity up to the moment this person moves in, before they
      // exist as an occupant — otherwise they inherit a share of units used before they came.
      try { moveReading(roomId, v.meterNow, v.checkIn); } catch (e) { return e.message; }
      const r = checkIn({ name: v.name, phone: v.phone, guardian: v.guardian, guardianPhone: v.guardianPhone, college: v.college, idNo: v.idNo, address: v.address, roomId, bed, rent: v.rent, deposit: v.deposit, checkIn: v.checkIn, food: v.food, lang: v.lang });
      if (pvOn()) Store.patch(r.id, { pv: { status: 'none', state: v.pvState || '' } });
      let login = null;
      if (v.login) login = await createResidentLogin(r).catch(e => { toast(t('Login not created: {m}', { m: e.message }), 'bad'); return null; });
      const files = req.map((d, i) => ({ type: d, file: (v['doc' + i] || [])[0] })).filter(x => x.file);
      if (files.length) uploadDocs('res', r.id, files);
      closeModal(); go('residents/' + r.id);
      toast(t('{n} checked in', { n: r.name }));
      if (S().wa.auto) waOpen(r.phone, welcomeMessage(resById(r.id), login), 'Send welcome');
      return false;
    },
  });
};
async function createResidentLogin(r) {
  const h = Store.hostel();
  const u = await Backend.admin('create_user', { full_name: r.name, phone: r.phone, org_id: h.org_id, hostel_id: h.id, role: 'resident', ref_id: r.id });
  Store.patch(r.id, { userId: u.user_id, username: u.username });
  return u;
}
// One line under every document picker, so nobody wonders where the papers go.
const docsNote = () => (Files.ready()
  ? `<div class="hint">${ico('lock', 'sm')} ${esc(t('Saved privately, compressed. Deleted {n} days after checkout.', { n: DOC_KEEP_DAYS }))}</div>`
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
  if (ok) toast(t('{n} documents saved', { n: ok }));
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
    li({ icon: 'shield', ic: st[1], t: t(st[0]),
         d: [pv.refNo ? t('Reference {n}', { n: pv.refNo }) : '',
             pv.status === 'submitted' && pv.submittedOn ? t('Sent {d}', { d: fmtDate(pv.submittedOn) }) : '',
             overdue ? t('{n} days since check-in', { n: diffDays(today(), r.checkIn) }) : ''].filter(Boolean).join(' · '),
         end: overdue ? badge('Overdue', 'bad') : '', chev: false }),
  ];
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
      { name: 'status', label: 'Status', type: 'select', value: pv.status || 'none',
        options: Object.entries(PV_STATUS).map(([k, v]) => ({ v: k, l: t(v[0]) })), required: true },
      { name: 'state', label: 'State / portal', type: 'select', value: pv.state || S().police.state || '',
        options: [{ v: '', l: t('Use the hostel default') }].concat(PV_STATES.map(([k, l]) => ({ v: k, l: t(l) }))) },
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
  const r = resById(id); if (!r) return `<div class="card">${empty('Resident not found', '', btn('Back', 'go', 'data-to="residents"'))}</div>`;
  const due = resDue(id), inv = resInvoices(id).slice().reverse(), pays = resPays(id);
  const living = r.status !== 'left';
  const pen = penaltyDue(id), ahead = advPaidAhead(id);
  const ld = Store.all('laundry').filter(l => l.resId === id && ymOf(l.date) === ymOf(today()));
  return `<div class="row" style="margin:6px 0 10px">${btn('Residents', 'go', 'data-to="residents"', 'ghost sm', 'back')}</div>
    <div class="hero ${due ? '' : 'ok'}"><div class="row nw" style="gap:14px">${avatar(r.name)}<div style="min-width:0;flex:1"><b style="font-size:20px">${esc(r.name)}</b><div class="muted sm">${blocksOn() ? esc(blockName(resBlock(r))) + ' · ' : ''}${esc(roomName(r.roomId))}-${esc(r.bed)} · ${t('since')} ${fmtDate(r.checkIn)}${r.status === 'left' ? ' · ' + t('left') + ' ' + fmtDate(r.left) : ''}</div></div></div>
      <div style="margin-top:14px" class="muted sm">${esc(t(due ? 'Total due' : 'No dues'))}</div><div class="big">${inr(due)}</div>${r.credit > 0 ? `<div class="sm">${esc(t('Advance credit'))}: ${inr(r.credit)}</div>` : ''}${pen > 0 ? `<div class="sm bad-t">${esc(t('Includes penalty'))}: ${inr(pen)}</div>` : ''}${ahead.length ? `<div class="sm ok-t">${esc(t('Rent paid up to {m}', { m: fmtYM(ahead[ahead.length - 1]) }))}</div>` : ''}
      <div class="row" style="margin-top:14px">${living ? `${btn('Record payment', 'pay', `data-res="${id}"`, 'primary sm', 'rupee')}${due ? btn('Send bill', 'sendbill', `data-res="${id}"`, 'sm', 'wa') : ''}` : ''}<a class="btn sm" href="tel:${esc(r.phone)}">${ico('phone', 'sm')}${esc(t('Call'))}</a><a class="btn sm" href="${esc(waUrl(r.phone, `Hi ${r.name.split(' ')[0]}, `))}" target="_blank" rel="noopener">${ico('wa', 'sm')}WhatsApp</a></div></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="stack">
        ${group('Bills', inv.slice(0, 12).map(i => li({ icon: i.type === 'electricity' ? 'bolt' : i.type === 'laundry' ? 'shirt' : i.type === 'deposit' ? 'wallet' : 'rupee', ic: invStat(i) === 'paid' ? 'ok' : invStat(i) === 'overdue' ? 'bad' : 'info', t: i.title, d: `${inr(i.amount)} · ${t('due')} ${fmtShort(i.due)}${i.discount > 0 ? ' · ' + t('discount') + ' ' + inr(i.discount) : ''}${i.paid && invBal(i) ? ' · ' + t('paid') + ' ' + inr(i.paid) : ''}`, end: invBal(i) ? `<b>${inr(invBal(i))}</b>` : statBadge('paid'), act: isAdmin() ? 'invedit' : '', attrs: `data-id="${i.id}"` })).join(''), isAdmin() ? `<a href="#" data-act="addinv" data-res="${id}">+ ${esc(t('Add a one-time charge'))}</a>` : '')}
        ${group('Payments', pays.length ? li({
          icon: 'check', ic: 'ok',
          t: t('{n} payments · {a}', { n: pays.length, a: inr(sum(pays, x => x.amount)) }),
          d: t('Last {a} on {d}', { a: inr(pays[0].amount), d: fmtDate(pays[0].date) }),
          act: 'respays', attrs: `data-id="${id}"`,
        }) : li({ icon: 'check', ic: 'mute', t: t('No payments yet'), chev: false }))}
      </div>
      <div class="stack">
        ${group('Details', [
          li({ icon: 'phone', ic: 'ok', t: r.phone, d: t('Mobile') }),
          r.guardianPhone ? li({ icon: 'users', ic: 'info', t: `${r.guardian || t('Guardian')} · ${r.guardianPhone}`, d: t('Guardian') }) : '',
          li({ icon: 'rupee', ic: 'warn', t: `${inr(r.rent)} / ${t('month')}`, d: `${t('Deposit')} ${inr(r.deposit)}` }),
          r.college ? li({ icon: 'building', ic: 'mute', t: r.college, d: t('College / office') }) : '',
          li({ icon: 'utensils', ic: 'teal', t: t(r.food !== false ? 'Takes mess food' : 'No mess food'), d: orgEnabled('laundry') ? t('Laundry this month: {n} clothes', { n: sum(ld, l => l.pcs) }) : '' }),
        ].join(''))}
        ${penCard(r)}
        ${pvCard(r)}
        ${docsCard(r)}
        ${group('App login', r.username ? [li({ icon: 'key', ic: 'ok', t: '@' + r.username, d: t('Password: their mobile number unless they changed it') }), li({ icon: 'lock', ic: 'warn', t: t('Reset password to mobile number'), act: 'respw', attrs: `data-id="${id}"` }), li({ icon: 'wa', ic: 'ok', t: t('Send login on WhatsApp'), act: 'reswelcome', attrs: `data-id="${id}"` })].join('') : li({ icon: 'key', ic: 'mute', t: t('No login yet'), act: living ? 'reslogin' : '', attrs: `data-id="${id}"`, end: living ? badge('Create', 'acc') : '' }))}
        ${living && isAdmin() ? group('Actions', [li({ icon: 'edit', t: t('Edit details'), act: 'resedit', attrs: `data-id="${id}"` }), li({ icon: 'repeat', ic: 'info', t: t('Shift room / bed'), act: 'resshift', attrs: `data-id="${id}"` }), li({ icon: 'cal', ic: 'teal', t: t('Leave (meals off)'), act: 'resleave', attrs: `data-id="${id}"` }), li({ icon: 'alert', ic: 'bad', t: t('Add penalty / fine'), act: 'penadd', attrs: `data-id="${id}"` }), li({ icon: 'clock', ic: 'warn', t: r.status === 'notice' ? t('Cancel notice') : t('Give notice (plan checkout)'), act: 'resnotice', attrs: `data-id="${id}"` }), li({ icon: 'door', ic: 'bad', t: t('Check out'), act: 'resout', attrs: `data-id="${id}"` })].join('')) : ''}
      </div>
    </div>`;
}
A.resedit = el => {
  const r = resById(el.dataset.id);
  formModal({
    title: 'Edit resident', fields: [
      { name: 'name', label: 'Full name', value: r.name, required: true }, { name: 'phone', label: 'Mobile (WhatsApp)', type: 'tel', value: r.phone, required: true },
      { name: 'guardian', label: 'Parent / guardian name', value: r.guardian }, { name: 'guardianPhone', label: 'Guardian mobile', type: 'tel', value: r.guardianPhone },
      { name: 'college', label: 'College / office', value: r.college }, { name: 'idNo', label: 'ID number (Aadhaar etc.)', value: r.idNo },
      { name: 'rent', label: 'Monthly rent (₹)', type: 'number', value: r.rent, min: 0, required: true, hint: t('Applies from the next bill.') }, { name: 'lang', label: 'WhatsApp language', type: 'select', options: [{ v: 'en', l: 'English' }, { v: 'hi', l: 'हिन्दी' }], value: r.lang },
      { name: 'food', label: 'Takes mess food', type: 'checkbox', value: r.food !== false }, { name: 'address', label: 'Home address', value: r.address, full: true },
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
  const r = resById(el.dataset.id), vac = vacantBeds();
  if (!vac.length) return toast('No vacant beds', 'bad');
  formModal({ title: `${t('Shift')} ${r.name}`, fields: [{ name: 'bed', label: 'New room & bed', type: 'select', options: bedOptions(vac, x => `${x.room.no}-${x.bed.id} · ${inr(x.room.rent)}`), required: true }, { name: 'rent', label: 'New monthly rent (₹)', type: 'number', value: roomById(vac[0].room.id).rent, min: 0 },
      ...meterField(r.roomId, 'meterOld', 'Meter reading in the room they are leaving'),
      ...meterField(vac[0].room.id, 'meterNew', 'Meter reading in the room they are moving into')],
    onChange: (v, form, ch) => { if (ch === 'bed') setField(form, 'rent', (roomById(v.bed.split('|')[0]) || {}).rent); },
    onSubmit: v => {
      const [rid, b] = v.bed.split('|');
      // Both rooms change hands today: close the old room's stretch so the roommates they are
      // leaving behind do not inherit this person's units, and open the new room's.
      try { moveReading(r.roomId, v.meterOld); moveReading(rid, v.meterNew); } catch (e) { return e.message; }
      shiftBed(r.id, rid, b, v.rent); toast('Room changed');
    } });
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
  const depPaid = sum(resInvoices(r.id).filter(i => i.type === 'deposit'), i => i.paid || 0), dues = sum(openInv(r.id).filter(i => i.type !== 'deposit'), invBal);
  formModal({
    title: `${t('Check out')} ${r.name}`, submit: 'Check out',
    fields: [{ name: 'date', label: 'Checkout date', type: 'date', value: today(), required: true },
      ...meterField(r.roomId),
      { name: 'ded', label: 'Damage / other deductions (₹)', type: 'number', value: 0, min: 0 }, { name: 'note', label: 'Note', full: true }],
    preview: v => { const refund = Math.max(0, depPaid - Math.min(depPaid, dues) - (v.ded || 0) + (r.credit || 0)); return `<dl class="kv"><dt>${esc(t('Deposit held'))}</dt><dd>${inr(depPaid)}</dd><dt>${esc(t('Pending dues'))}</dt><dd>${inr(dues)}</dd><dt>${esc(t('Deductions'))}</dt><dd>${inr(v.ded || 0)}</dd><dt>${esc(t('Refund'))}</dt><dd>${inr(refund)}</dd>${dues > depPaid ? `<dt class="bad-t">${esc(t('Still to collect'))}</dt><dd class="bad-t">${inr(dues - depPaid)}</dd>` : ''}</dl>`; },
    onSubmit: v => {
      // Read the meter before they stop being an occupant, so their last stretch is theirs.
      try { moveReading(r.roomId, v.meterNow, v.date); } catch (e) { return e.message; }
      const dep = checkout(r.id, v.date, v.ded || 0, v.note);
      toast(t('{n} checked out', { n: r.name }));
      if (S().wa.auto) waOpen(r.phone, tpl('checkout', { name: r.name.split(' ')[0], hostel: hostelName(), deposit: rs(dep.deposit), deduct: rs(dep.settled + dep.deductions), refund: rs(dep.refund) }, waLang(r)), 'Send checkout message');
    },
  });
};
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
  formModal({ title: 'Upload documents', fields: [...req.map((d, i) => ({ name: 'doc' + i, label: d, type: 'file', accept: 'image/*,application/pdf' })), { type: 'html', html: docsNote() }],
    onSubmit: v => { if (!Files.ready()) return 'Documents are not uploaded in demo mode.'; const files = req.map((d, i) => ({ type: d, file: (v['doc' + i] || [])[0] })).filter(x => x.file); if (!files.length) return 'Choose at least one file'; uploadDocs('res', r.id, files); } });
};
// One card for everything on file. A missing row is a prompt, an uploaded row is a door.
function docsCard(r) {
  const gone = docsGoneOn(r);
  if (gone && gone <= today()) return `<div class="group-t">${esc(t('Documents'))}</div><div class="group"><div class="li noic"><span class="body muted">${esc(t('Deleted {n} days after checkout', { n: DOC_KEEP_DAYS }))}</span></div></div>`;
  const have = r.docs || [], need = gone ? [] : S().docs.required.filter(d => !have.some(x => x.type === d));
  const rows = [
    ...have.map(d => li({
      icon: 'file', ic: 'ok', t: t(d.type), d: `${fmtTs(d.ts)} · ${t('Tap to open')}`,
      act: 'opendoc', attrs: `data-path="${esc(d.path || '')}"`,
    })),
    ...need.map(d => li({
      icon: 'upload', ic: 'warn', t: d, d: t('Tap to upload'),
      act: 'docadd', attrs: `data-id="${r.id}" data-type="${esc(d)}"`, end: badge('Missing', 'warn'),
    })),
  ];
  const head_ = isAdmin() ? `<div class="row" style="margin:0 0 8px">${gone ? `<span class="hint">${esc(t('Deleted on {d}', { d: fmtDate(gone) }))}</span>` : btn('Upload documents', 'resdocs', `data-id="${r.id}"`, 'sm', 'upload')}<span class="sp"></span>${have.length ? `<span class="hint">${esc(t('{n} on file', { n: have.length }))}</span>` : ''}</div>` : '';
  return `<div class="group-t">${esc(t('Documents'))}</div>${head_}<div class="group">${rows.join('') || `<div class="li noic"><span class="body muted">${esc(t('Nothing required'))}</span></div>`}</div>`;
}
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
A.respays = el => {
  const r = resById(el.dataset.id); if (!r) return;
  const pays = resPays(r.id);
  sheet(`${t('Payments')} · ${r.name}`, `<div class="group">${pays.map(p => li({
    icon: 'check', ic: 'ok', t: inr(p.amount),
    d: [fmtDate(p.date), t(p.mode.toUpperCase()), p.ref, p.adv ? t('advance, {n} months', { n: p.adv.months }) : '', p.no].filter(Boolean).join(' · '),
    act: 'receipt', attrs: `data-id="${p.id}"`,
  })).join('')}</div>`, { foot: `<span class="hint">${esc(t('{n} payments · {a} in total', { n: pays.length, a: inr(sum(pays, x => x.amount)) }))}</span>` });
};
// Demo mode has no server, so join.html leaves applications in this browser; bring them in.
function importDemoSignups() {
  if (CLOUD) return;
  let list; try { list = JSON.parse(localStorage.getItem('hostelos.demo.signups') || '[]'); } catch (e) { return; }
  const mine = list.filter(v => v.h === (Store.ctx || {}).hostelId);
  if (!mine.length) return;
  for (const v of mine) {
    Store.put('signup', { status: 'pending', name: v.name, phone: v.phone, guardian: v.guardian, guardianPhone: v.guardianPhone,
      email: v.email, college: v.college, idNo: v.idNo, address: v.address, lang: v.lang, note: v.note, docs: v.docs || [],
      pv: { refNo: v.pvRefNo || '', state: v.pvState || '', self: !!v.pvDone }, self: true,
      date: String(v.at).slice(0, 10), ts: v.at });
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
    ${pv.self || pv.refNo ? group('Police verification', li({ icon: 'shield', ic: pv.refNo ? 'ok' : 'warn',
        t: t(pv.refNo ? 'Filed by the resident' : 'Resident says they filed it'),
        d: pv.refNo ? t('Reference {n}', { n: pv.refNo }) : t('No reference number given — check before you rely on it'), chev: false }))
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
      { name: 'login', label: 'Create app login and send it on WhatsApp', type: 'checkbox', value: true, info: t('User ID = name, password = mobile number. They can change it later.') },
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
  formModal({ title: i.title, submit: 'Save', fields: [{ name: 'amount', label: 'Amount (₹)', type: 'number', value: i.amount, min: 0, required: true }, { name: 'waive', label: 'Waive (discount) ₹', type: 'number', value: i.waived || 0, min: 0 }, { name: 'due', label: 'Due date', type: 'date', value: i.due }],
    danger: !i.paid ? { label: 'Delete bill', run: () => confirmBox(t('Delete this bill?'), () => { Store.remove(i.id); toast('Bill deleted'); }, 'Delete', 'bad') } : null,
    onSubmit: v => { if (v.amount < (i.paid || 0)) return 'Amount cannot be less than what is already paid'; Store.patch(i.id, { amount: v.amount, waived: v.waive || 0, due: v.due }); toast('Bill updated'); } });
};
A.addinv = el => formModal({
  title: 'Add a one-time charge', fields: [{ name: 'type', label: 'Type', type: 'select', options: Object.entries(INV_TYPES).filter(([k]) => !['rent', 'deposit'].includes(k)).map(([v, l]) => ({ v, l: t(l) })) }, { name: 'title', label: 'Description', required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', min: 1, required: true }, { name: 'due', label: 'Due date', type: 'date', value: addDays(today(), 5) }],
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
      body = `<div class="tool">${searchBox('pay', 'Search resident or room')}<span class="sp"></span>${dues.length ? btn(t('Send bills to all ({n})', { n: dues.length }), 'billall', '', 'wa', 'wa') : ''}</div>
        ${list.length ? `<div class="group">${list.map(x => `<div class="li">${avatar(x.r.name)}<span class="body"><span class="t ell">${esc(x.r.name)}</span><span class="d">${esc(roomName(x.r.roomId))} · ${openInv(x.r.id).map(i => esc(t(INV_TYPES[i.type] || i.type))).filter((v, i, a) => a.indexOf(v) === i).join(', ')}${x.od ? ` · <span class="bad-t">${esc(t('overdue'))}</span>` : ''}</span></span><span class="end"><b class="${x.od ? 'bad-t' : ''}" style="margin-right:4px">${inr(x.due)}</b>${btn('', 'sendbill', `data-res="${x.r.id}" aria-label="${esc(t('Send bill'))}"`, 'sm', 'wa')}${btn('Cash', 'pay', `data-res="${x.r.id}"`, 'sm primary')}</span></div>`).join('')}</div>` : `<div class="card">${empty('No dues 🎉', 'Everyone has paid.')}</div>`}`;
    } else if (tab === 'claims') {
      const list = Store.all('claim').slice().sort(by('ts', -1)).slice(0, 80);
      body = table([
        { h: 'Resident', f: c => { const r = resById(c.resId); return r ? person(r, roomName(r.roomId)) : '—'; } },
        { h: 'Amount', f: c => `<b>${inr(c.amount)}</b>` }, { h: 'UTR', f: c => esc(c.utr || '—') }, { h: 'Date', f: c => fmtShort(c.date) },
        { h: 'Status', f: c => badge(c.status === 'pending' ? 'Pending' : c.status === 'approved' ? 'Approved' : 'Rejected', c.status === 'pending' ? 'warn' : c.status === 'approved' ? 'ok' : 'bad') },
        { h: '', acts: true, f: c => (c.status === 'pending' ? `${btn('View', 'claimview', `data-id="${c.id}"`, 'sm')}${btn('Approve', 'claimok', `data-id="${c.id}"`, 'sm ok')}` : '') },
      ], list, { key: 'claims', emptyT: 'No UPI payments yet', empty: 'When residents pay by UPI and enter the UTR in their app, it shows here.' });
    } else if (tab === 'history') {
      const list = payments().filter(p => needle('payh', (resById(p.resId) || {}).name, p.ref, p.no)).sort(by('date', -1));
      body = `<div class="tool">${searchBox('payh', 'Search name, UTR, receipt')}<span class="sp"></span>${btn('Export', 'exportpay', '', '', 'download')}</div>` + table([
        { h: 'Date', f: p => fmtShort(p.date) }, { h: 'Resident', f: p => { const r = resById(p.resId); return r ? person(r, roomName(r.roomId)) : '—'; } },
        { h: 'Amount', f: p => `<b>${inr(p.amount)}</b>` }, { h: 'Mode', f: p => badge(p.mode.toUpperCase(), p.mode === 'cash' ? 'warn' : p.mode === 'deposit' ? '' : 'info') }, { h: 'Ref', f: p => esc(p.ref || '—') },
        { h: '', acts: true, f: p => btn('Receipt', 'receipt', `data-id="${p.id}"`, 'sm') },
      ], list, { key: 'payh' });
    } else {
      const list = Store.all('dep').slice().sort(by('date', -1));
      const held = sum(activeRes(), r => sum(resInvoices(r.id).filter(i => i.type === 'deposit'), i => i.paid || 0));
      body = `<div class="grid g2 keep2" style="margin-bottom:14px">${kpi('Deposits held', inr(held), t('{n} residents', { n: activeRes().length }), '', null, 'wallet')}${kpi('Refunds pending', inr(sum(list.filter(d => d.status === 'pending'), d => d.refund)), '', 'warn', null, 'clock')}</div>` + table([
        { h: 'Resident', f: d => esc((resById(d.resId) || {}).name || '—') }, { h: 'Date', f: d => fmtShort(d.date) }, { h: 'Deposit', f: d => inr(d.deposit) }, { h: 'Adjusted', f: d => inr(d.settled + d.deductions) }, { h: 'Refund', f: d => `<b>${inr(d.refund)}</b>` },
        { h: 'Status', f: d => badge(d.status === 'pending' ? 'Pending' : d.status === 'paid' ? 'Refunded' : 'Closed', d.status === 'pending' ? 'warn' : 'ok') }, { h: '', acts: true, f: d => (d.status === 'pending' ? btn('Mark refunded', 'depok', `data-id="${d.id}"`, 'sm ok') : '') },
      ], list, { key: 'deps', emptyT: 'No checkouts yet' });
    }
    return `${head('Payments', t('{c} collected in {m} · {d} pending', { c: inr(coll), m: fmtYM(ym), d: inr(sum(dues, x => x.due)) }), btn('Record cash payment', 'pay', '', 'primary', 'plus'))}
      ${seg('pay', [['dues', 'Dues'], ['claims', 'UPI claims', claims.length], ['history', 'History'], ['deps', 'Deposits']], 'dues')}${body}`;
  },
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
        : recordPayment({ resId: v.res, amount: v.amount, mode: v.mode, ref: v.ref, date: v.date, note: v.note,
          exclude: pen > 0 && !v.pen ? resPenalties(v.res).map(i => i.id) : null });
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
  waSheet(list.map(x => ({ phone: x.r.phone, text: billMessage(x.r).text, label: `${x.r.name} · ${inr(x.due)}` })), 'Send bills');
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
  waSheet(list.map(x => ({ phone: x.r.phone, text: billMessage(x.r, 'reminder').text, label: `${x.r.name} · ${inr(x.due)}` })), 'Send reminders');
};
A.receipt = el => {
  const p = Store.get(el.dataset.id), r = resById(p.resId), h = Store.hostel();
  sheet('Receipt', `<div class="receipt" id="rcpt"><div style="text-align:center"><b style="font-size:16px">${esc(h.name)}</b><div class="muted xs">${esc(h.address || h.city || '')}</div></div><hr>
    <div class="r"><span>${esc(t('Receipt'))}</span><b>${esc(p.no || p.id)}</b></div><div class="r"><span>${esc(t('Date'))}</span><span>${fmtDate(p.date)}</span></div><div class="r"><span>${esc(t('Resident'))}</span><span>${esc(r ? r.name : '')}</span></div><div class="r"><span>${esc(t('Room'))}</span><span>${esc(roomName(p.roomId))}</span></div><hr>
    ${p.adv ? `<div class="r"><span>${esc(t('Advance for {n} months', { n: p.adv.months }))}</span><span>${esc(fmtYM(p.adv.from))}${p.adv.months > 1 ? ' – ' + esc(fmtYM(p.adv.to)) : ''}</span></div>` : ''}
    ${(p.alloc || []).map(a => `<div class="r"><span>${esc(a.title || '')}</span><span>${inr(a.amt)}</span></div>`).join('')}${p.adv && p.adv.discount > 0 ? `<div class="r"><span>${esc(t('Discount given'))}</span><span>− ${inr(p.adv.discount)}</span></div>` : ''}${p.credit > 0 ? `<div class="r"><span>${esc(t('Advance credit'))}</span><span>${inr(p.credit)}</span></div>` : ''}<hr>
    <div class="r"><b>${esc(t('Total paid'))}</b><b>${inr(p.amount)}</b></div><div class="r"><span>${esc(t('Mode'))}</span><span>${esc(p.mode.toUpperCase())}${p.ref ? ' · ' + esc(p.ref) : ''}</span></div><div class="r"><span>${esc(t('Balance due'))}</span><span>${inr(r ? resDue(r.id) : 0)}</span></div></div>`,
  { foot: `<button class="btn" data-act="print">${ico('print', 'sm')} ${esc(t('Print'))}</button>${r ? `<button class="btn wa" data-act="sendrcpt" data-id="${p.id}">${ico('wa', 'sm')} WhatsApp</button>` : ''}` });
};
A.sendrcpt = el => { const p = Store.get(el.dataset.id); closeModal(true); waOpen(resById(p.resId).phone, receiptMessage(p), 'Send receipt'); };
A.exportpay = () => download(`payments-${today()}.csv`, csv([['Date', 'Receipt', 'Resident', 'Room', 'Amount', 'Mode', 'Reference'], ...Store.all('pay').sort(by('date')).map(p => [p.date, p.no, (resById(p.resId) || {}).name, roomName(p.roomId), p.amount, p.mode, p.ref])]), 'text/csv');

/* ===================================================================== electricity */
PAGES.electricity = {
  title: 'Electricity', mod: 'electricity',
  render() {
    const e = S().elec, ym = ymOf(today());
    const occRooms = rooms().filter(r => bedsOf(r).some(b => b.status === 'occ'));
    const pending = occRooms.filter(r => !meters().some(m => m.roomId === r.id && ymOf(m.date) === ym));
    const list = meters().slice(0, ui.lim.mt || 60);
    return `${head('Electricity', t('₹{r}/unit · {f} free units per {m} · split by days stayed', { r: e.rate, f: e.freeUnits, m: t(e.freeMode === 'room' ? 'room' : 'resident') }), `${btn('Settings', 'go', 'data-to="settings/elec"', '', 'settings')}${btn('Enter readings', 'readings', '', 'primary', 'bolt')}`)}
      ${pending.length ? `<div class="note warn">${esc(t('{n} rooms still need this month\'s reading', { n: pending.length }))}: ${esc(pending.map(r => r.no).join(', '))}</div>` : ''}
      ${table([
        { h: 'Room', f: m => `<b>${esc(roomName(m.roomId))}</b>` }, { h: 'Date', f: m => fmtShort(m.date) }, { h: 'Reading', f: m => `${num(m.prev)} → ${num(m.curr)}` }, { h: 'Units', f: m => `<b>${num(m.units)}</b>` },
        { h: 'Billed', f: m => (m.opening ? badge('Opening', 'mute') : m.status === 'review' ? badge('Check reading', 'warn') : inr(m.total)) },
        { h: '', acts: true, f: m => m.opening ? '' : `${btn('Split', 'meterview', `data-id="${m.id}"`, 'sm')}${m.status === 'review' ? btn('Bill it', 'meterok', `data-id="${m.id}"`, 'sm ok') : ''}` },
      ], list, { key: 'mt', emptyT: 'No readings yet', empty: 'Enter meter readings once a month — bills are created automatically.' })}`;
  },
};
A.reading = () => A.readings();
// One screen for all rooms: type the meter numbers, bills + WhatsApp queue are created in one go.
A.readings = () => {
  const list = rooms().filter(r => bedsOf(r).some(b => b.status === 'occ'));
  if (!list.length) return toast('No occupied rooms', 'bad');
  const fields = list.map(r => { const l = lastMeter(r.id); return { name: 'm_' + r.id, label: `${r.no} · ${t('last')} ${l ? num(l.curr) : '—'}`, type: 'number', step: 0.1, min: l ? l.curr : 0, placeholder: t('Current reading') }; });
  formModal({
    title: 'Meter readings', submit: 'Create bills', wide: true,
    note: t('Leave a room empty to skip it. Free units ({f}) are deducted before charging ₹{r}/unit.', { f: S().elec.freeUnits, r: S().elec.rate }),
    fields: [{ name: 'date', label: 'Reading date', type: 'date', value: today(), required: true }, { name: 'send', label: 'Send bills on WhatsApp after saving', type: 'checkbox', value: true }, ...fields],
    preview: v => { let tot = 0, n = 0; for (const r of list) { const c = v['m_' + r.id]; if (!isNaN(c)) { const l = lastMeter(r.id), units = c - (l ? l.curr : 0); if (units >= 0) { n++; tot += sum(splitElectricity(r.id, units, S().elec.rate, activeRes().filter(x => x.roomId === r.id).map(x => x.id)), s => s.amount); } } } return n ? t('{n} rooms · total bill {t}', { n, t: inr(tot) }) : ''; },
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
  sheet(`${t('Room')} ${roomName(m.roomId)} · ${fmtDate(m.date)}`, `<dl class="kv"><dt>${esc(t('Units'))}</dt><dd>${num(m.units)}</dd><dt>${esc(t('Rate'))}</dt><dd>₹${m.rate}</dd><dt>${esc(t('Free units'))}</dt><dd>${m.freeUnits ?? '—'} / ${esc(t(m.freeMode === 'room' ? 'room' : 'resident'))}</dd></dl>
    <div class="group" style="margin-top:12px">${(m.shares || []).map(s => li({ lead: avatar((resById(s.resId) || {}).name || '?'), t: (resById(s.resId) || {}).name || '—', d: t('{u} units · {f} free · {b} billable', { u: num(s.units), f: num(s.free), b: num(s.billable) }), end: `<b>${inr(s.amount)}</b>` })).join('') || li({ t: t('Nobody to bill') })}</div>`,
  { foot: `<button class="btn bad" data-act="meterdel" data-id="${m.id}">${esc(t('Delete reading'))}</button>` });
};
A.meterdel = el => confirmBox(t('Delete this reading and its unpaid bills?'), () => { const m = Store.get(el.dataset.id); for (const s of m.shares || []) { const i = Store.get(`inv-el-${m.id}-${s.resId}`); if (i && !i.paid) Store.remove(i.id); } Store.remove(m.id); toast('Reading deleted'); }, 'Delete', 'bad');

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
      { name: 'cat', label: 'Category', type: 'select', options: S().expenseCats.map(c => ({ v: c, l: t(c) })), value: e.cat, required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', min: 1, value: e.amount, required: true },
      { name: 'date', label: 'Date', type: 'date', value: e.date || today(), required: true }, { name: 'mode', label: 'Payment', type: 'select', options: [{ v: 'cash', l: t('Cash / paid now') }, { v: 'credit', l: t('Credit (pay later)') }], value: e.mode || 'cash' },
      { name: 'vendor', label: 'Vendor / shop', value: e.vendor }, { name: 'note', label: 'Note', value: e.note },
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
  title: 'New notice', submit: 'Post', fields: [{ name: 'title', label: 'Title', required: true, full: true }, { name: 'body', label: 'Message', type: 'textarea', required: true, full: true }, { name: 'pinned', label: 'Pin on top', type: 'checkbox' }],
  onSubmit: v => { Store.put('notice', { ...v, date: today() }); activeRes().forEach(r => notify({ to: 'res', resId: r.id, title: t('New notice'), body: v.title, link: 'r-help' })); toast('Notice posted'); },
});
A.noticedel = el => confirmBox(t('Delete this notice?'), () => Store.remove(el.dataset.id), 'Delete', 'bad');
A.noticewa = el => { const n = Store.get(el.dataset.id); waSheet(activeRes().map(r => ({ phone: r.phone, text: `${t('Hello')} ${r.name.split(' ')[0]},\n\n${t('A notice from')} *${hostelName()}*\n\n*${n.title}*\n\n${n.body}\n\n${t('Regards')},\n${hostelName()}`, label: r.name })), 'Send notice'); };

/* ===================================================================== automation */
PAGES.automation = {
  title: 'Automation', mod: 'automation',
  render() {
    const a = S().auto, logs = Store.all('log').slice().sort(by('ts', -1)).slice(0, 40), od = dueList(true);
    return `${head('Automation', t('These run by themselves once a day when anyone opens the app. Safe to run again — nothing is ever doubled.'), btn('Run now', 'autorun', '', 'primary', 'bot'))}
      <div class="grid g-main">
        <div>${group('Rules', RULES.map(r => `<div class="li"><span class="ic ${a[r.k] ? 'ok' : 'mute'}">${ico('bot')}</span><span class="body"><span class="t">${esc(t(r.l))}</span><span class="d">${esc(t(r.d))}</span></span><label class="sw"><input type="checkbox" data-rule="${r.k}" ${a[r.k] ? 'checked' : ''} aria-label="${esc(t(r.l))}"><span></span></label></div>`).join(''))}</div>
        <div class="stack">
          ${group('One-tap jobs', [li({ icon: 'wa', ic: 'ok', t: t('Send due reminders'), d: t('{n} residents overdue', { n: od.length }), act: 'remindall' }), li({ icon: 'wa', ic: 'info', t: t('Send all bills with pay link'), d: t('{n} residents with dues', { n: dueList().length }), act: 'billall' }), li({ icon: 'bolt', ic: 'warn', t: t('Enter meter readings'), act: 'readings' })].join(''))}
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
