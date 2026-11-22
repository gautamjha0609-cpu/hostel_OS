'use strict';
/* Owner / manager screens: home, approvals, rooms, residents, payments, electricity, expenses, reports, notices, automation. */

const resOpts = (list = activeRes()) => list.slice().sort(by('name')).map(r => ({ v: r.id, l: resLabel(r) }));
const person = (r, sub) => `<div class="person">${avatar(r.name)}<div style="min-width:0"><b><button class="linkish" data-act="go" data-to="residents/${r.id}">${esc(r.name)}</button></b><small>${sub ?? ''}</small></div></div>`;
// hostelName is defined globally in js/domain.js
/* The "read the meter now" box, asked at every check-in, check-out and room shift while the
 * electricity module is on. It is required: the reading closes the current stretch, so whoever
 * was in the room pays for exactly the units used until today, and the next normal reading
 * starts fresh from it. */
// "Last reading 4,764 on 17 Nov" - always visible under the field, and refreshed when another room is picked
const meterHintText = roomId => { const h = roomId ? moveReadingHint(roomId) : null; return !h ? '' : h.last ? t('Last reading {u} on {d}.', { u: num(h.last.curr), d: fmtShort(h.last.date) }) : t('No reading yet for this room: this becomes its starting point.'); };
function setMeterHint(form, name, roomId) {
  const box = form.querySelector(`[data-fw="${name}"] .hint`); if (!box) return;
  const txt = meterHintText(roomId); box.textContent = txt; box.hidden = !txt;
  const inp = form.elements[name]; if (inp && roomId) inp.placeholder = (moveReadingHint(roomId) || {}).last ? `> ${num(moveReadingHint(roomId).last.curr)}` : '';
}
/* Keeps the box honest while typing: a number below the room's last reading turns the hint red, and (where
 * the form can handle a replaced meter) offers the "meter was replaced or reset" tick-box. */
function meterGuard(form, v, name, roomId, canReset) {
  const box = form.querySelector(`[data-fw="${name}"] .hint`), last = roomId ? lastMeter(roomId) : null;
  const low = !!last && v[name] !== '' && v[name] != null && !isNaN(v[name]) && +v[name] < last.curr;
  if (box) {
    box.classList.toggle('bad-t', low);
    if (low) { box.textContent = t('Lower than the last reading ({p}). Readings only go up.', { p: num(last.curr) }); box.hidden = false; }
    else setMeterHint(form, name, roomId);
  }
  if (canReset) { showField(form, name + 'Reset', low); showField(form, name + 'OldFinal', low && !!v[name + 'Reset']); }
}
// A replaced meter is recorded BEFORE the check-in / checkout it was found at, so the old meter's last units are billed
// to the people who used them and the new meter starts from the number typed.
function meterResetNow(roomId, v, name, date) {
  if (!v[name + 'Reset'] || meterReadingProblem(roomId, v[name], { canReset: false }) === null) return false;
  replaceMeter({ roomId, finalOldReading: v[name + 'OldFinal'], startingNewReading: v[name], reason: 'Meter replaced / reset (found at ' + (name === 'meterNow' ? 'check-in or checkout' : 'a move') + ')', date });
  return true;
}
function meterField(roomId, name = 'meterNow', label = 'Meter reading now', canReset = false) {
  const hint = moveReadingHint(roomId);
  if (!hint) return [];
  const who = !hint.last ? t('This room has no reading yet, so this becomes its starting point.')
    : !hint.names.length ? t('The room was empty, so nothing before today lands on the new resident.')
      : hint.names.length === 1 ? t('{n} then pays only up to today.', { n: hint.names[0] })
        : t('{n} then pay only up to today.', { n: listNames(hint.names) });
  return [...[{
    name, label, type: 'number', min: 0, required: true, step: 0.1,
    hint: meterHintText(roomId), hintShow: true,
    info: who + ' ' + t('Electricity is split between the readings on either side of it. Taking one now ends the current stretch and starts a fresh one, so everybody pays for the units they actually used, and free units are counted only for the days they stayed.')
  }], ...(canReset ? [
    { name: name + 'Reset', label: 'Meter was replaced or reset', type: 'checkbox', full: true, hidden: true },
    { name: name + 'OldFinal', label: 'Old meter\'s final reading', type: 'number', min: 0, step: 0.1, full: true, hidden: true, info: t('What the old meter showed when it was taken out. Its last units are billed to the people in the room. The number above then becomes the new meter\'s first reading.') },
  ] : [])];
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
// each quick action keeps its own calm tone, so the grid reads as a set and not as random colours
const QA_TONE = { checkin: 'tn0', pay: 'tn2', reading: 'tn3', remindall: 'tn1', ldrecv: 'tn5', addexp: 'tn4', addnotice: 'tn0', go: 'tn2' };
PAGES.home = {
  title: 'Home', mod: 'home', when: () => !!ctx().hostelId,
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
    const pym = ymOf(addDays(ym + '-01', -1)), prevCol = sum(payments().filter(p => ymOf(p.date) === pym && p.mode !== 'deposit'), p => p.amount);
    const chgPct = prevCol > 0 ? Math.round((collected - prevCol) / prevCol * 100) : null;
    const series = months.map(m => sum(payments().filter(p => ymOf(p.date) === m && p.mode !== 'deposit'), p => p.amount)), odTot = sum(overdue, x => x.od);
    return `${homeHero({
      name: Store.me ? Store.me.full_name.split(' ')[0] : '', sub: `${esc(fmtDate(today()))}<br>${esc(hostelName())}`,
      cards: [
        { l: 'Collected this month', icon: 'wallet', v: inr(collected), count: collected, to: 'payments', tone: 'ok', area: series, areaLabels: [fmtYM(months[0]).split(' ')[0], t('This month')],
          pill: chgPct == null ? esc(t('This month')) : `${chgPct >= 0 ? '&#9650;' : '&#9660;'} ${Math.abs(chgPct) > 150 ? esc(hhShort(Math.abs(collected - prevCol))) : Math.abs(chgPct) + '%'}`, stone: chgPct != null && chgPct < 0 ? 'bad' : 'ok',
          s: esc(prevCol > 0 ? t('vs {a} last month', { a: inr(prevCol) }) : t('Last 6 months')) },
        { l: 'Pending dues', icon: 'clock', v: inr(dueTot), count: dueTot, to: 'payments', tone: dueTot ? 'bad' : 'ok',
          pill: esc(overdue.length ? t('{n} overdue', { n: overdue.length }) : t('All on time')), stone: overdue.length ? 'bad' : 'ok', s: esc(t('{n} residents', { n: dues.length })),
          seg: dueTot ? { a: odTot, b: Math.max(0, dueTot - odTot), la: 'Overdue', lb: 'Not yet due' } : null }
      ],
      strip: [
        { icon: 'users', v: dues.length, l: 'Residents owing' },
        { icon: 'bed', v: occ.pct + '%', l: 'Occupancy', bar: occ.pct },
        hc ? { icon: 'utensils', v: hc.eat, l: `${mealName(nextMeal.k)} ${t('today')}` } : { icon: 'inbox', v: inbox.length, l: 'Approvals' },
      ],
    })}
      <div class="group-t">${esc(t('Quick actions'))}</div>
      <div class="qa">${qa.map(([act, l, icn, col, mod], qi) => `<button data-act="${act}" ${act === 'go' ? `data-to="${mod}"` : ''}><span class="ic ${QA_TONE[act] || 'tn0'}">${ico(icn)}</span><span class="qa-l">${esc(t(l))}</span></button>`).join('')}</div>
      <div class="grid g-main" style="margin-top:6px">
        <div class="stack">
          ${group('Needs your attention', inbox.slice(0, 6).map(x => li({ icon: x.icon, ic: x.ic, t: x.t, d: x.d, act: 'go', attrs: 'data-to="inbox"' })).join('') || li({ icon: 'check', ic: 'ok', t: t('All clear'), d: t('Nothing is waiting for you.') }), inbox.length > 6 ? `<a href="/inbox">${esc(t('See all {n}', { n: inbox.length }))}</a>` : '')}
          ${can('payments') ? `<div class="card"><h3>${esc(t('Income vs expenses'))}<span class="sp"></span><small>${esc(t('last 6 months'))}</small>${blockScope() ? tip(esc(t('Payments are shown for the block you are looking at. Expenses — gas, salaries, internet — are recorded for the whole hostel and are not split between blocks.'))) : ''}</h3>${barChart(months.map(m => fmtYM(m).split(' ')[0]), [months.map(m => sum(payments().filter(p => ymOf(p.date) === m && p.mode !== 'deposit'), p => p.amount)), months.map(m => sum(Store.all('exp').filter(x => ymOf(x.date) === m), x => x.amount))], ['#34c759', '#ff9500'])}<div class="legend"><span><i style="background:#34c759"></i>${esc(t('Income'))}</span><span><i style="background:#ff9500"></i>${esc(t('Expenses'))}</span></div></div>` : ''}
        </div>
        <div class="stack">
          ${can('housekeeping') && hkT.length ? `<div class="card"><h3>${esc(t('Cleaning today'))}<span class="sp"></span><small>${hkDone}/${hkT.length}</small></h3><div class="bar ok"><i class="pgi" style="width:${pct(hkDone, hkT.length)}%;--p:${pct(hkDone, hkT.length)}"></i></div><div class="row" style="margin-top:10px">${badge(t('{n} pending', { n: hkT.filter(x => x.status === 'pending').length }), 'info')}${hkT.some(x => x.status === 'missed') ? badge(t('{n} missed', { n: hkT.filter(x => x.status === 'missed').length }), 'bad') : ''}</div></div>` : ''}
          ${hc ? `<div class="card"><h3>${esc(t('Kitchen'))}<span class="sp"></span><a class="sm" href="/mess">${esc(t('Open'))}</a></h3><dl class="kv">${meals().map(m => { const h = headcount(today(), m.k); return `<dt>${esc(mealName(m.k))}</dt><dd>${h.eat} ${esc(t('plates'))}${h.tiffin ? ` · ${h.tiffin} ${esc(t('tiffin'))}` : ''}</dd>`; }).join('')}</dl>${low.length ? `<div class="note warn" style="margin:12px 0 0">${ico('alert', 'sm')} ${esc(t('Low stock'))}: ${esc(low.map(i => i.name).join(', '))}</div>` : ''}</div>` : ''}
          ${group('Top dues', dues.slice(0, 5).map(x => li({ lead: avatar(x.r.name), t: x.r.name, d: `${roomName(x.r.roomId)} · ${x.od ? t('overdue') + ' ' + inr(x.od) : t('due')}`, end: `<b class="${x.od ? 'bad-t' : ''}">${inr(x.due)}</b>`, act: 'go', attrs: `data-to="residents/${x.r.id}"` })).join('') || li({ icon: 'check', ic: 'ok', t: t('No dues') }))}
        </div>
      </div>`;
  },
};

/* ===================================================================== approvals inbox */
/* Approvals: one card per thing waiting, grouped by kind. The filter row on top narrows it to one kind (money,
 * new residents, meters, stock, housekeeping & complaints). Each card: what it is, who, how long ago - and its buttons. */
const APV_CAT = { claim: 'money', dep: 'money', salary: 'money', mbill: 'money', remind: 'money', signup: 'people', pv: 'people', rinfo: 'people', meter: 'meters', pr: 'stock', hk: 'house', cmp: 'house' };
const APV_CATS = [['all', 'All'], ['money', 'Money'], ['people', 'Residents'], ['meters', 'Meters'], ['stock', 'Stock'], ['house', 'Housekeeping & complaints']];
const APV_PRIMARY = { claim: 'claimview', signup: 'signupview', pv: 'pvstatus', meter: 'meterview', pr: 'prview', dep: 'depok', cmp: 'go', hk: 'hkack', mbill: 'mbillsend', remind: 'remindsend', rinfo: 'go', salary: 'paysal' };
PAGES.inbox = {
  title: 'Approvals', mod: 'inbox',
  render() {
    const list = inboxItems();
    // Every card has the same three slots, always in the same order: quiet (left), reject (middle, red), main (right, blue).
    // A card with one or two actions leaves the other slots empty, so a button never jumps to a different place.
    const ACT = {
      claim: { sec: ['View', 'claimview'], bad: ['Reject', 'claimno'], pri: ['Approve', 'claimok', 'check'] },
      signup: { bad: ['Reject', 'signupno'], pri: ['Review', 'signupview'] },
      pr: { pri: ['Review', 'prview'] },
      meter: { sec: ['View', 'meterview'], bad: ['Reject', 'meterreject'], pri: ['Bill it', 'meterok', 'check'] },
      dep: { pri: ['Mark refunded', 'depok'] },
      cmp: { pri: ['Open', 'go', null, 'data-to="complaints"'] },
      hk: { sec: ['Reassign', 'hkreassign'], pri: ['OK', 'hkack'] },
      mbill: { pri: ['E-mail all', 'mbillsend', 'mail', ''] },
      remind: { pri: ['E-mail all', 'remindsend', 'mail', ''] },
      pv: { sec: ['Open resident', 'go', null, x => `data-to="residents/${x.id}"`], pri: ['Update', 'pvstatus'] },
      rinfo: { pri: ['Open', 'go', null, 'data-to="complaints"'] },
      salary: { pri: ['Book salary', 'paysal', 'wallet'] },
    };
    const acts = x => {
      const cfg = ACT[x.k]; if (!cfg) return '';
      const slot = (key, cls) => {
        const d = cfg[key]; if (!d) return `<span class="apv-slot ${key}" aria-hidden="true"></span>`;
        const extra = d[3] === undefined ? `data-id="${x.id}" ${x.k === 'salary' ? (x.attrs || '') : ''}` : (typeof d[3] === 'function' ? d[3](x) : d[3]);
        return `<span class="apv-slot ${key}">${btn(d[0], d[1], extra, cls, d[2] || undefined)}</span>`;
      };
      return slot('sec', 'sm') + slot('bad', 'sm bad') + slot('pri', 'sm primary');
    };
    const row = x => {
      const toAttr = (x.k === 'cmp' || x.k === 'rinfo') ? 'data-to="complaints"' : '';
      return `<div class="apv" data-act="${APV_PRIMARY[x.k] || 'claimview'}" data-id="${x.id}" ${x.attrs || ''} ${toAttr}>
        <span class="ic ${x.ic}">${ico(x.icon)}</span>
        <div class="apv-main"><div class="apv-t">${esc(x.t)}</div><div class="apv-d">${esc(x.d)}</div><div class="apv-ago">${esc(ago(x.ts || nowIso()))}</div></div>
        <div class="apv-acts">${acts(x)}</div></div>`;
    };
    const catOf = x => APV_CAT[x.k] || 'money';
    const counts = Object.fromEntries(APV_CATS.map(([k]) => [k, k === 'all' ? list.length : list.filter(x => catOf(x) === k).length]));
    const fl = (counts[curFlt('apc', 'all')] ? curFlt('apc', 'all') : 'all');
    const chipRow = `<div class="chips apv-chips">${APV_CATS.filter(([k]) => k === 'all' || counts[k]).map(([k, l]) => `<button class="chip ${fl === k ? 'on' : ''}" data-act="flt" data-key="apc" data-v="${k}">${esc(t(l))} <span class="chip-n">${counts[k]}</span></button>`).join('')}</div>`;
    let body;
    if (!list.length) body = `<div class="card">${empty('All clear ', 'Nothing needs your approval right now.')}</div>`;
    else if (fl !== 'all') body = `<div class="apv-list fold-list">${list.filter(x => catOf(x) === fl).map(row).join('')}</div>`;
    else body = APV_CATS.filter(([k]) => k !== 'all' && counts[k]).map(([k, l]) => `<div class="group-t">${esc(t(l))} · ${counts[k]}</div><div class="apv-list fold-list">${list.filter(x => catOf(x) === k).map(row).join('')}</div>`).join('');
    return `${head('Approvals', t('Only the things that need a human. Everything else runs automatically.'))}${chipRow}${body}`;
  },
};
A.claimview = el => {
  const c = Store.get(el.dataset.id);
  if (!c) return toast(t('Payment claim not found'), 'bad');
  const r = resById(c.resId);
  const refInfo = c.utr ? classifyPaymentRef(c.utr) : null;
  const docs = r && r.docs && r.docs.length
    ? `<div style="margin-top:12px"><b>${esc(t('Resident ID / KYC:'))}</b><div class="row" style="gap:8px;margin-top:6px">${r.docs.map(d => `<button type="button" class="btn xs ghost" data-act="opendoc" data-path="${esc(d.path || '')}" data-res="${r.id}" data-type="${esc(d.type || 'Document')}">${ico('file', 'sm')} ${esc(t(d.type || 'Document'))}</button>`).join('')}</div></div>`
    : '';
  const ssHtml = c.proofUrl
    ? `<div style="margin-top:12px"><b>${esc(t('Payment Screenshot:'))}</b><br><a href="${c.proofUrl}" data-docview data-name="${esc(t('Payment Screenshot:'))}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px"><img src="${c.proofUrl}" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid var(--line);object-fit:contain" alt="Payment proof"><div class="xs muted" style="margin-top:4px">${ico('search', 'sm')} ${esc(t('Tap to open full size'))}</div></a></div>`
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
  // A claim for one UPI account (Rent or Electricity) clears only its own bills; anything extra stays as credit.
  const other = c.payKind === 'elec' || c.payKind === 'rent' ? openInv(c.resId).filter(i => (i.type === 'electricity') !== (c.payKind === 'elec')).map(i => i.id) : null;
  const pay = recordPayment({ resId: c.resId, amount: c.amount, mode: 'upi', ref: c.utr, date: c.date, claimId: c.id, exclude: other });
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
    return `${head('Rooms & Beds', t('{o} occupied · {v} vacant · {p}% full', { o: occ.occ, v: occ.vac, p: occ.pct }), `<span class="btn-pair">${btn('Bulk setup', 'bulkrooms', '', '', 'grid')}${btn('Add room', 'addroom', '', '', 'plus')}</span>${btn('Check-in', 'checkin', '', 'primary', 'userplus')}`)}
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
      { name: 'no', label: 'Room number', value: r.no, required: true, maxlength: 20, pattern: /^[A-Za-z0-9][A-Za-z0-9 \-\/.]{0,19}$/ }, { name: 'floor', label: 'Floor', value: r.floor || `${t('Floor')} 1`, required: true, maxlength: 30 },
      ...(blocksOn() ? [{
        name: 'block', label: 'Block', type: 'select', value: roomBlock(r),
        options: [{ v: '', l: t('Not in a block') }, ...hostelBlocks().map(b => ({ v: b.k, l: b.l }))],
        info: t('Everyone living in this room counts as being in this block. Beds, bills and the head count stay with the hostel.')
      }] : []),
      { name: 'beds', label: 'Number of beds', type: 'number', int: true, value: r.beds ? r.beds.length : '', placeholder: 'e.g. 2', min: 1, max: 12, required: true }, { name: 'rent', label: 'Rent per bed (₹/month)', type: 'number', value: r.rent, min: 0, required: true },
      { name: 'bedRents', label: 'Different rent for each bed (optional)', value: bedsOf(r).some(b => +b.rent > 0 && +b.rent !== +r.rent) ? bedsOf(r).map(b => bedRent(r, b.id)).join(', ') : '', plain: true, full: true, maxlength: 80, placeholder: 'e.g. 11000, 11500', hint: t('One amount per bed in order (Bed A, Bed B...), separated by commas. Leave empty to charge every bed the rent above. Residents already living here keep their own rent.') },
      ...(depositOn() && S().deposit.mode === 'per_bed' ? [{ name: 'deposit', label: 'Security deposit per bed (₹)', type: 'number', value: r.deposit || '', min: 0, max: 500000, placeholder: t('e.g. 10000') }] : []),
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
      v.no = String(v.no || '').replace(/\s+/g, ' ').trim();
      if (rooms().some(x => String(x.no).trim().toLowerCase() === v.no.toLowerCase() && x.id !== r.id)) return 'A room with this number already exists';
      const ids = 'ABCDEFGHIJKL'.slice(0, v.beds).split('');
      const cur = bedsOf(r);
      if (cur.filter(b => !ids.includes(b.id)).some(b => b.status === 'occ')) return 'You cannot remove a bed that is occupied';
      const bedRents = String(v.bedRents || '').split(/[,\s]+/).filter(Boolean).map(Number);
      if (bedRents.some(n => isNaN(n) || n < 0 || n > 500000)) return 'Bed rents must be amounts, e.g. 11000, 11500';
      if (bedRents.length > ids.length) return 'More bed rents than beds';
      const beds = ids.map((id, i) => { const b = { ...(cur.find(x => x.id === id) || { id, status: 'vac' }) }; const br = bedRents[i]; if (br > 0 && br !== +v.rent) b.rent = br; else delete b.rent; return b; });
      Store.put('room', { ...r, id: r.id || `room-${slug(v.no)}-${uid()}`, no: v.no, floor: v.floor, block: blocksOn() ? v.block || '' : r.block || '', rent: v.rent, ...(S().deposit.mode === 'per_bed' ? { deposit: +v.deposit > 0 ? +v.deposit : 0 } : {}), ac: v.ac, sharing: v.beds, beds });
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
    fields: [
      { type: 'html', html: `<div class="row sb" style="align-items:center"><b>${esc(t('Floors & rooms'))}</b>${tip(esc(t('Define floor labels, room numbering pattern, and standard capacity. You can preview and customize every room before saving.')))}</div>` },
      { name: 'floors', label: 'Floor labels (comma-separated)', value: `${t('Floor')} 1`, required: true, full: true, hint: 'e.g. Floor 1, Floor 2, Floor 3' },
      { name: 'startNo', label: 'Start room number', type: 'number', placeholder: 'e.g. 101', required: true },
      { name: 'endNo', label: 'End room number', type: 'number', placeholder: 'e.g. 108', required: true },
      { name: 'beds', label: 'Beds per room (capacity)', type: 'number', int: true, min: 1, max: 12, placeholder: 'e.g. 2', required: true },
      { name: 'rent', label: 'Rent per bed (₹/month)', type: 'number', min: 0, placeholder: 'e.g. 6500', required: true },
      ...(depositOn() && S().deposit.mode === 'per_bed' ? [{ name: 'deposit', label: 'Security deposit per bed (₹)', type: 'number', min: 0, max: 500000, placeholder: 'e.g. 10000' }] : []),
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
          deposit: S().deposit.mode === 'per_bed' && +v.deposit > 0 ? +v.deposit : 0,
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
          fields: [
            {
              type: 'html',
              html: `
                <div class="row sb" style="margin-bottom:8px;align-items:center">
                  <b>${esc(t('Rooms to create'))}</b>
                  ${tip(esc(t('Review and customize room beds, AC, or rent directly in the table below before creating.')) + '<br>' + esc(t('You can change beds, AC, rent or room number directly in the table.')) + '<br>' + esc(t('Scroll horizontally to view all columns')) + (hasConflict ? '<br><b>' + esc(t('Warning: Some room numbers already exist in this property. Rename room numbers or resolve duplicate conflicts to proceed.')) + '</b>' : ''))}
                  ${hasConflict ? `<span class="badge bad">${esc(t('Some room numbers already exist'))}</span>` : ''}
                </div>
                <div class="tbl-wrap bulk-wrap" style="overflow:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:8px;background:var(--surface)">
                  <table class="tbl" style="min-width:540px;width:100%;font-size:13px;border-collapse:separate;border-spacing:0">
                    <thead>
                      <tr style="position:sticky;top:0;z-index:2">
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
                            <label class="sw" title="${esc(t('AC room'))}"><input type="checkbox" class="bulk-inp-ac" data-idx="${i}" ${p.ac ? 'checked' : ''} aria-label="${esc(t('AC room'))} ${esc(p.no)}"><span></span></label>
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
          onSubmit: async () => {
            const batchNos = new Set();
            for (const p of previewList) {
              if (!p.no) return t('Every room must have a valid room number');
              const lower = p.no.toLowerCase();
              if (batchNos.has(lower)) return t('Duplicate room number in batch: {no}', { no: p.no });
              if (existingNos.has(lower)) return t('Room {no} already exists in property. Please rename or resolve duplicate.', { no: p.no });
              batchNos.add(lower);
            }

            try {
              const plan = bulkCreateRooms({
                floors: fls,
                rooms: previewList,
                defaultRent: v.rent,
                defaultAc: v.ac,
                block: v.block || '',
                dryRun: true
              });
              // Cancel / close while rooms are being saved stops the run and takes back what was saved.
              let stopped = false;
              modalOnClose = () => { stopped = true; };
              const sb = $('[data-act="msubmit"]');
              const res = await commitRoomsCancellable(plan.createdRooms, fls.length, () => stopped, (n, tot) => { if (sb) sb.textContent = t('Creating {n} of {t}…', { n, t: tot }); });
              if (res.cancelled) { modalOnClose = null; render(); toast(t('Bulk setup cancelled. No rooms were created.'), 'warn'); return false; }
              modalOnClose = null;
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
                p.ac = !!el.checked;
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
// The "Previous entry" fields, the same in the check-in form and in the Waiting-to-be-admitted form.
function prevEntryFields() {
  return [
    { name: 'prevOn', label: 'Previous entry (already staying before today)', type: 'checkbox', value: false, full: true, info: t('Tick this to add the old rent, electricity and payments of a resident who joined in the past. It switches on by itself when the date is in the past; you can still turn it on or off.') },
    { name: 'prevType', label: 'How did they pay?', type: 'select', value: 'monthly', hidden: true, full: true, options: [{ v: 'monthly', l: t('Monthly') }, { v: 'yearly', l: t('Yearly') }, { v: 'custom', l: t('Custom (paid up to a date)') }] },
    { name: 'paidTill', label: 'Paid till (date)', type: 'date', hidden: true },
    { name: 'paidTotal', label: 'Total amount paid (₹)', type: 'number', min: 0, max: 100000000, hidden: true },
    ...(depositOn() ? [{ name: 'prevDep', label: 'Security deposit already received', type: 'checkbox', value: true, hidden: true, full: true }] : []),
    { type: 'html', key: 'prevTable', hidden: true, html: '<div id="prevTbl"></div>' },
  ];
}
// Shared onChange for both forms. dateName = the field that holds the date they moved in.
function prevEntryOnChange(v, form, changed, dateName) {
  const d = v[dateName];
  if (changed === dateName && form.elements.prevOn) form.elements.prevOn.checked = !!d && d < today();
  if (form.elements.prevOn && (changed === undefined || [dateName, 'prevOn', 'prevType', 'paidTill', 'paidTotal', 'rent', 'bed'].includes(changed))) prevEntryRefresh(form, { ...v, checkIn: d }, changed);
}
/* ---- Previous entry: the old-bills cards inside the check-in form ----
 * One card per month. Rent, Electricity and Other each have their own amount and their own Paid / Due switch. */
const PT_LBL = { rent: 'Rent', elec: 'Electricity', other: 'Other' };
function ptCell(k, val, paid, disabled, why) {
  // Electricity / Other: no amount typed = no Paid / Due choice (greyed out). It switches on, as Paid, when a number is entered.
  const na = k !== 'rent' && !disabled && !(+val > 0);
  if (na) paid = false;
  return `<div class="pt-c ${disabled ? 'off' : ''}"><label>${esc(t(PT_LBL[k]))}</label>
    <input type="number" class="inp pt-${k}" min="0" step="1" inputmode="numeric" ${val !== '' ? `value="${val}"` : ''} placeholder="${k === 'elec' ? '—' : '0'}" ${disabled ? 'disabled' : ''}>
    <button type="button" class="pt-tg ${paid ? 'on' : ''} ${na ? 'na' : ''}" data-k="${k}" aria-pressed="${paid ? 'true' : 'false'}" ${disabled || na ? 'disabled' : ''} ${why ? `title="${esc(why)}"` : ''}><i></i><span>${na ? '—' : esc(t(paid ? 'Paid' : 'Due'))}</span></button></div>`;
}
function prevEntryRefresh(form, v, changed) {
  const on = !!(form.elements.prevOn && form.elements.prevOn.checked), lump = on && v.prevType && v.prevType !== 'monthly';
  showField(form, 'prevType', on); showField(form, 'paidTill', lump); showField(form, 'paidTotal', lump); showField(form, 'prevDep', on); showField(form, 'prevTable', on);
  const box = $('#prevTbl', form); if (!box) return;
  if (!on) { box.innerHTML = ''; return; }
  if (changed === 'prevOn' && lump && !v.paidTill && form.elements.paidTill) form.elements.paidTill.value = today();
  const paidTill = (form.elements.paidTill && form.elements.paidTill.value) || '';
  const skipRes = form.dataset.prevRes;   // on a resident's page: months that already have a rent bill are left alone
  const rows = prevEntryRows({ checkIn: v.checkIn, rent: v.rent, type: v.prevType || 'monthly', paidTill, paidTotal: v.paidTotal, skipYm: skipRes ? ym => !!Store.get(`inv-rent-${skipRes}-${ym}`) : null });
  if (!rows.length) { box.innerHTML = `<div class="note warn">${esc(skipRes ? t('Every month from the start date already has a rent bill. Nothing to add.') : t('Pick a check-in date in the past to see the old months.'))}</div>`; return; }
  // keep what was typed in the cards when only the amount / date above changes
  const keep = {}; if (box.dataset.type === (v.prevType || 'monthly')) $$('.pt-card', box).forEach(c => { keep[c.dataset.ym] = { elec: $('.pt-elec', c).value, other: $('.pt-other', c).value, se: $('.pt-tg[data-k=elec]', c).classList.contains('on'), so: $('.pt-tg[data-k=other]', c).classList.contains('on'), sr: $('.pt-tg[data-k=rent]', c).classList.contains('on') }; });
  box.dataset.type = v.prevType || 'monthly';
  const cov = rows.filter(x => x.locked), tot = sum(cov, x => x.rent);
  const info = lump
    ? (cov.length ? t('{a} booked as rent for {n} months ({f} to {l}), about {m} a month. Rent after {d} is left for you to enter.', { a: inr(tot), n: cov.length, f: fmtYM(cov[0].ym), l: fmtYM(cov[cov.length - 1].ym), m: inr(Math.round(tot / cov.length)), d: fmtDate(paidTill) })
      : t('Enter "Paid till" and the total amount paid. That amount is spread over the months up to that date.'))
    : t('Edit any amount. Leave electricity empty if there is nothing to add.');
  box.innerHTML = `<div class="pt-info ${lump && cov.length ? 'ok' : ''}">${esc(info)}</div>
    ${rows.map(x => {
      const k = keep[x.ym] || {}, lockE = x.future, why = x.future ? t('Not added for a month that has not come yet') : '';
      const sr = x.locked ? true : k.sr != null ? k.sr : x.rentPaid, se = k.se != null && +k.elec > 0 ? k.se : true, so = k.so != null && +k.other > 0 ? k.so : true;
      const rentCell = ptCell('rent', x.rent, sr, x.locked, x.locked ? t('Covered by the amount paid till {d}', { d: fmtDate(paidTill) }) : '').replace('class="pt-c off"', 'class="pt-c off locked"');
      return `<div class="pt-card ${x.locked ? 'is-paid' : ''} ${x.future ? 'is-future' : ''}" data-ym="${x.ym}">
        <div class="pt-h"><b>${esc(fmtYM(x.ym))}</b>${x.locked ? `<span class="badge ok">${esc(t(x.future ? 'Advance paid' : 'Paid'))}</span>` : x.future ? `<span class="badge">${esc(t('Upcoming'))}</span>` : ''}</div>
        <div class="pt-g">${rentCell}${ptCell('elec', k.elec || '', lockE ? false : se, lockE, why)}${ptCell('other', lockE ? 0 : (k.other != null && k.other !== '' ? k.other : 0), lockE ? false : so, lockE, why)}</div></div>`;
    }).join('')}`;
}
document.addEventListener('input', e => {
  const inp = e.target; if (!inp || !inp.classList || !(inp.classList.contains('pt-elec') || inp.classList.contains('pt-other'))) return;
  const tg = $('.pt-tg', inp.closest('.pt-c')); if (!tg || inp.disabled) return;
  const has = +inp.value > 0, was = tg.classList.contains('na');
  if (has && was) { tg.classList.remove('na'); tg.disabled = false; tg.classList.add('on'); tg.setAttribute('aria-pressed', 'true'); tg.querySelector('span').textContent = t('Paid'); }
  else if (!has && !was) { tg.classList.add('na'); tg.classList.remove('on'); tg.disabled = true; tg.setAttribute('aria-pressed', 'false'); tg.querySelector('span').textContent = '—'; }
});
document.addEventListener('click', e => {
  const b = e.target && e.target.closest && e.target.closest('.pt-tg'); if (!b || b.disabled) return;
  e.preventDefault(); const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('on', on); b.querySelector('span').textContent = t(on ? 'Paid' : 'Due');
});
// From a resident's page: add the old months (rent, electricity, other) and what was paid, for someone already living here.
A.resprev = el => {
  const r = resById(el.dataset.id); if (!r) return;
  const form = formModal({
    title: `${t('Previous entry')} · ${r.name}`, submit: 'Save old bills', wide: true,
    note: t('Add the months before today: rent, electricity and other charges, and what was already paid. Months that already have a rent bill are skipped.'),
    fields: [
      { name: 'checkIn', label: 'Count from', type: 'date', value: r.checkIn, required: true, max: today(), info: t('Starts at the check-in date. Move it later to add only recent months.') },
      { name: 'rent', label: 'Monthly rent (₹)', type: 'number', value: r.rent, min: 0, max: 500000, required: true },
      { name: 'prevOn', label: 'Previous entry', type: 'checkbox', value: true, hidden: true },
      ...prevEntryFields().filter(x => x.name !== 'prevOn').map(x => (x.name === 'prevDep' ? { ...x, value: false } : x)),
    ],
    onChange: (v, f, changed) => { f.dataset.prevRes = r.id; prevEntryOnChange(v, f, changed === 'checkIn' ? undefined : changed, 'checkIn'); },
    onSubmit: async (v, f) => {
      const rows = prevEntryRead(f, v); if (!rows) return t('Pick a date in the past.'); if (rows.error) return rows.error;
      if (!rows.length) return t('Nothing to add.');
      const pr = applyPreviousEntry(r.id, rows, { type: v.prevType, paidTill: v.prevType !== 'monthly' ? v.paidTill : '', depositPaid: depositOn() && !!v.prevDep });
      toast(t('Added {n} old bills, {a} marked paid', { n: pr.invoices, a: inr(pr.paid) }), 'ok');
    }
  });
  form.dataset.prevRes = r.id;
  prevEntryRefresh(form, { checkIn: r.checkIn, rent: r.rent, prevType: 'monthly' }, undefined);
};
// Reads the cards back. null = not a previous entry; { error } = something to fix; else the rows.
function prevEntryRead(form, v0, dateName = 'checkIn') {
  const v = { ...v0, checkIn: v0[dateName] };
  if (!(form.elements.prevOn && form.elements.prevOn.checked)) return null;
  const cards = $$('#prevTbl .pt-card', form); if (!cards.length) return { error: t('Pick a check-in date in the past for a previous entry.') };
  const lump = v.prevType !== 'monthly';
  if (lump && !v.paidTill) return { error: t('Enter the "Paid till" date.') };
  if (lump && v.paidTill < v.checkIn) return { error: t('"Paid till" cannot be before the check-in date.') };
  if (lump && !(+v.paidTotal > 0)) return { error: t('Enter the total amount paid.') };
  const num0 = el => (el && !el.disabled && el.value !== '' ? +el.value : 0), rows = [];
  for (const c of cards) {
    const rentEl = $('.pt-rent', c), row = { ym: c.dataset.ym, rent: rentEl.value === '' ? 0 : +rentEl.value, elec: num0($('.pt-elec', c)), other: num0($('.pt-other', c)), locked: rentEl.disabled, future: c.classList.contains('is-future') };
    if ([row.rent, row.elec, row.other].some(n => isNaN(n) || n < 0)) return { error: t('Amounts in the old-bills list must be zero or more.') };
    const on = k => $(`.pt-tg[data-k=${k}]`, c).getAttribute('aria-pressed') === 'true';
    row.rentPaid = row.locked || on('rent'); row.elecPaid = on('elec'); row.otherPaid = on('other');   // no amount = nothing to be paid or due
    rows.push(row);
  }
  return rows;
}
A.checkin = (el, opts = {}) => {
  const vac = vacantBeds();
  if (!vac.length) { toast('No vacant beds. Add a room first.', 'bad'); return; }
  const req = docSlots(S().docs);
  const pre = el && el.dataset && el.dataset.bed ? el.dataset.bed : `${vac[0].room.id}|${vac[0].bed.id}`;
  // The block is not a separate question: a bed is in exactly one block, so choosing the bed
  // chooses the block. Grouping the list is what tells the owner which one they just picked.
  const bedOpts = bedOptions(vac, x => `${x.room.no}-${x.bed.id} · ${inr(bedRent(x.room, x.bed.id))} · ${x.room.floor}`);
  const room0 = roomById(pre.split('|')[0]), bed0 = pre.split('|')[1];
  formModal({
    title: 'New check-in', submit: 'Check in', wide: true,
    note: t('Bills, bed status, resident login and the WhatsApp welcome are created automatically.'),
    fields: [
      { type: 'section', label: 'Resident' },
      { name: 'name', label: 'Full name', value: (opts && opts.name) || '', required: true, maxlength: 80 },
      { name: 'phone', label: 'Mobile (WhatsApp)', type: 'tel', value: (opts && opts.phone) || '', required: true, maxlength: 10, placeholder: '10-digit mobile' },
      { name: 'email', label: 'Email address', type: 'email', value: (opts && opts.email) || '', maxlength: 80, placeholder: 'name@example.com', required: true },
      { name: 'guardian', label: 'Parent / guardian name', maxlength: 80, required: true }, { name: 'guardianPhone', label: 'Guardian mobile', type: 'tel', maxlength: 10, placeholder: '10-digit mobile', required: true },
      { name: 'college', label: 'College / office', maxlength: 120, required: true }, { name: 'idNo', label: 'Aadhaar card number', maxlength: 12, placeholder: '12-digit Aadhaar', required: true },
      { name: 'address', label: 'Home address', full: true, maxlength: 240, required: true },
      { type: 'section', label: 'Room & money' },
      { name: 'bed', label: 'Room & bed', type: 'select', options: bedOpts, value: pre, required: true },
      { name: 'checkIn', label: 'Check-in date', type: 'date', value: today(), required: true },
      ...prevEntryFields(),
      ...meterField(room0 ? room0.id : '', 'meterNow', 'Meter reading now', true),
      { name: 'rent', label: 'Monthly rent (₹)', type: 'number', value: room0 ? bedRent(room0, bed0) : '', min: 0, max: 500000, required: true, hint: t('Filled from the room. Change only for a special deal.') },
      ...(depositOn() ? [{ name: 'deposit', label: 'Security deposit (₹)', type: 'number', value: room0 ? depositFor(bedRent(room0, bed0), room0) : 0, min: 0, max: 500000 }] : []),
      { name: 'food', label: 'Takes mess food', type: 'checkbox', value: true },
      ...(accOn() ? [{ name: 'acc', label: 'Accessories given with the bed', type: 'multi', options: accItems().map(x => ({ v: x, l: x })), value: accItems(), full: true, info: t('Tick what you are handing over. The same list comes up at checkout so nothing goes missing. Edit the list in Settings > Room accessories.') }] : []),
      { name: 'lang', label: 'WhatsApp language', type: 'select', options: [{ v: 'en', l: 'English' }, { v: 'hi', l: 'हिन्दी' }], value: S().wa.lang === 'hi' ? 'hi' : 'en' },
      { type: 'section', label: 'Documents' },
      ...req.map((d, i) => ({ name: 'doc' + i, label: d, type: 'file', accept: 'image/jpeg,image/png,image/webp', required: true })),
      { type: 'html', html: docsNote() },
      { type: 'section', label: 'App login' },
      { name: 'login', label: 'Create app login for resident', type: 'checkbox', value: true, hint: t('User ID = mobile.hostel, password = mobile number. They can change it later.') },
    ],
    onChange: (v, form, changed) => {
      // Previous entry: switches on for a past check-in date (the owner can still change it), then draws the old-bills table
      prevEntryOnChange(v, form, changed, 'checkIn');
      if (changed === 'meterNow' || changed === 'meterNowReset' || changed === 'bed') meterGuard(form, v, 'meterNow', String(v.bed || '').split('|')[0], true);
      if (changed === 'bed') { const rm = roomById(String(v.bed).split('|')[0]); if (rm) { const br = bedRent(rm, String(v.bed).split('|')[1]); setField(form, 'rent', br); setField(form, 'deposit', depositFor(br, rm)); setMeterHint(form, 'meterNow', rm.id); } }
    },
    preview: v => {
      if (!v.name) return '';
      const rRent = v.rent != null && !isNaN(v.rent) ? +v.rent : 0;
      const cCalc = calcCheckInRent({ checkInDate: v.checkIn || today(), monthlyRent: rRent });
      const depAmt = v.deposit != null && !isNaN(v.deposit) ? +v.deposit : 0;
      const hSlug = slug((Store.hostel() || {}).name || 'hostel').slice(0, 6).replace(/\.+$/, '') || 'hostel';
      const depFee = depAmt > 0 ? Math.min(depAmt, Math.max(0, +S().deposit.nonRefundable || 0)) : 0;
      const uPreview = phone10(v.phone) ? `${phone10(v.phone)}.${hSlug}` : slug(v.name);
      return `<div style="font-size:12px;line-height:1.4"><b>${esc(t('Login'))}:</b> ${esc(uPreview)} / ${esc(phone10(v.phone) || '—')}<br><b>${esc(t('First Rent'))}:</b> ${inr(cCalc.amount)} (${cCalc.occupiedDays}/${cCalc.totalDays} ${esc(t('days'))} · ${inr(cCalc.dailyRate)}/${esc(t('day'))}) + ${inr(depAmt)} ${esc(t('deposit'))}${depFee > 0 ? `<br><b>${esc(t('Non-refundable fee'))}:</b> ${inr(depFee)} <span class="mute">(${esc(t('part of the deposit, kept at checkout'))})</span>` : ''}<br><small class="mute">${esc(cCalc.formula)}</small></div>`;
    },
    onSubmit: async (v, form) => {
      if (residents().some(r => r.status !== 'left' && r.phone === phone10(v.phone))) return 'A resident with this mobile number already exists';
      // Everything about the resident is compulsory: a check-in with a missing paper or contact cannot be saved.
      if (!isValidEmail(v.email)) return t('Enter a valid email address');
      if (!/^[0-9]{10}$/.test(phone10(v.guardianPhone))) return t('Enter a valid 10-digit guardian mobile number');
      const aad = String(v.idNo || '').replace(/[^0-9]/g, '');
      if (aad.length !== 12) return t('Aadhaar number must be exactly 12 digits');
      const [roomId, bed] = v.bed.split('|');
      // Settle the room's electricity up to the moment this person moves in, before they
      // exist as an occupant — otherwise they inherit a share of units used before they came.
      // Checked first of all, before anything is saved: a lower reading stops the check-in right here.
      const mp = meterReadingProblem(roomId, v.meterNow, { reset: v.meterNowReset, oldFinal: v.meterNowOldFinal });
      if (mp) return mp;
      const prevRows = prevEntryRead(form, v); if (prevRows && prevRows.error) return prevRows.error;
      try { if (!prevRows && !meterResetNow(roomId, v, 'meterNow', v.checkIn)) moveReading(roomId, v.meterNow, v.checkIn); } catch (e) { return e.message; }
      const r = checkIn({ name: v.name, phone: v.phone, email: v.email, guardian: v.guardian, guardianPhone: v.guardianPhone, college: v.college, idNo: v.idNo, address: v.address, roomId, bed, rent: v.rent, deposit: v.deposit, checkIn: v.checkIn, ...(prevRows && prevRows[0] ? { firstRent: prevRows[0].rent } : {}), food: v.food, lang: v.lang, accessories: accOn() ? (v.acc || []) : null });
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
        Store.patch(r.id, { pv: { status: initialPv, state: S().police.state || '', updatedAt: nowIso() } });
      } else {
        Store.patch(r.id, { pv: { status: 'not_required', state: S().police.state || '' } });
      }
      if (prevRows) {
        try {
          const pr = applyPreviousEntry(r.id, prevRows, { type: v.prevType, paidTill: v.prevType !== 'monthly' ? v.paidTill : '', depositPaid: depositOn() && !!v.prevDep });
          toast(t('Previous entry saved: {n} old bills, {a} marked paid', { n: pr.invoices + 1, a: inr(pr.paid) }), 'ok');
        } catch (e) { toast(t('Resident saved, but the old bills could not be added: {m}', { m: e.message }), 'bad'); }
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
  const hSlug = slug((h && h.name) || 'hostel').slice(0, 6).replace(/\.+$/, '') || 'hostel';
  const ph = phone10(r.phone);
  const wantUser = ph && ph.length === 10 ? `${ph}.${hSlug}` : undefined;
  const u = await Backend.admin('create_user', { full_name: r.name, phone: r.phone, username: wantUser, org_id: h.org_id, hostel_id: h.id, role: 'resident', ref_id: r.id });
  Store.patch(r.id, { userId: u.user_id, username: u.username });
  return u;
}
// One line under every document picker, so nobody wonders where the papers go.
const docsNote = () => (Files.ready()
  ? `<div class="hint">${ico('lock', 'sm')} ${esc(t('Saved privately. Photos only; they are compressed automatically to save space. Deleted {n} days after checkout.', { n: DOC_KEEP_DAYS }))}</div>`
  : `<div class="note warn">${esc(t('Documents are not uploaded in demo mode.'))}</div>`);
// The record is saved first and the papers follow in the background, so a slow network never
// holds up a check-in. A paper of a type already on file replaces it; the old file is left for
// the daily sweep, so a failed sync can never leave a record pointing at nothing.
async function uploadDocs(kind, id, files) {
  if (!files.length) return 0;
  if (!Files.ready()) { toast(t('Demo mode: the documents you picked are NOT stored. Use the cloud version to keep them.'), 'warn'); return 0; }
  toast(t('Uploading {n} documents…', { n: files.length }));
  let ok = 0;
  for (const f of files) {
    try {
      const doc = await Files.upload(f.file, kind, id, f.type);
      const cur = Store.get(id); if (!cur) return ok;
      // A new Front / Back / Photo replaces the one on file: the old record is dropped and the old file is deleted for good.
      // (An old plain "Aadhaar card" counts as the Front.)
      const same = d => d.type === doc.type || (/ \(Front\)$/.test(doc.type) && d.type === doc.type.replace(/ \(Front\)$/, ''));
      const old = (cur.docs || []).filter(same);
      Store.patch(id, { docs: [...(cur.docs || []).filter(d => !same(d)), doc] }); ok++;
      for (const o of old) if (o.path && o.path !== doc.path) Files.remove(o.path);
    } catch (e) { toast(`${t(f.type)}: ${e.message}`, 'bad'); }
  }
  if (ok < files.length) toast(t('{m} of {n} documents are still missing - open the resident and upload them again.', { m: files.length - ok, n: files.length }), 'bad');
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
      { name: 'file', label: 'Acknowledgement (screenshot or photo)', type: 'file', accept: 'image/*' },
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
      { name: 'file', label: 'Photo', type: 'file', accept: 'image/*', required: true },
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
function billBreakdownCard(id) {
  const rows = billBreakdown(id, 4); if (!rows.length) return '';
  const cols = [['rent', 'Rent'], ['electricity', 'Electricity'], ['late', 'Late fee'], ['laundry', 'Laundry'], ['penalty', 'Penalty'], ['other', 'Other']].filter(([k]) => rows.some(r => r[k] > 0));
  return `<div class="group-t">${esc(t('Bill breakdown'))}</div><div class="card" style="padding:0;overflow:auto"><table class="tbl nw-tbl" style="width:100%;font-size:13px"><thead><tr><th>${esc(t('Month'))}</th>${cols.map(([, l]) => `<th style="text-align:right">${esc(t(l))}</th>`).join('')}<th style="text-align:right">${esc(t('Total'))}</th><th style="text-align:right">${esc(t('Due'))}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(fmtYM(r.ym))}</td>${cols.map(([k]) => `<td style="text-align:right">${r[k] ? inr(r[k]) : '—'}</td>`).join('')}<td style="text-align:right"><b>${inr(r.total)}</b></td><td style="text-align:right">${r.due > 0 ? `<b class="bad-t">${inr(r.due)}</b>` : badge('Paid', 'ok')}</td></tr>`).join('')}</tbody></table></div>`;
}
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
        ${showFin ? billBreakdownCard(id) : ''}
        ${showFin ? group('Bills due', inv.filter(i => invBal(i) > 0).slice(0, 12).map(i => li({ icon: i.type === 'electricity' ? 'bolt' : i.type === 'laundry' ? 'shirt' : i.type === 'deposit' ? 'wallet' : 'rupee', ic: invStat(i) === 'paid' ? 'ok' : invStat(i) === 'overdue' ? 'bad' : 'info', t: i.title, d: `${inr(i.amount)} · ${t('due')} ${fmtShort(i.due)}${i.discount > 0 ? ' · ' + t('discount') + ' ' + inr(i.discount) : ''}${i.paid && invBal(i) ? ' · ' + t('paid') + ' ' + inr(i.paid) : ''}`, end: invBal(i) ? `<b>${inr(invBal(i))}</b>` : statBadge('paid'), act: isAdmin() ? 'invedit' : '', attrs: `data-id="${i.id}"` })).join(''), isAdmin() ? `<a href="#" data-act="addinv" data-res="${id}">+ ${esc(t('Add a one-time charge'))}</a>` : '') : ''}
        ${showFin ? group('Transaction history', pays.length ? li({
    icon: 'check', ic: 'ok',
    t: t('{n} payments · {a}', { n: pays.filter(x => !x.reversed).length, a: inr(sum(pays.filter(x => !x.reversed), x => x.amount)) }),
    d: t('Last {a} on {d}', { a: inr(pays[0].amount), d: fmtDate(pays[0].date) }),
    act: 'respays', attrs: `data-id="${id}"`,
  }) : li({ icon: 'check', ic: 'mute', t: t('No payments yet'), chev: false })) : ''}
        ${penCard(r)}
      </div>
      <div class="stack">
        ${group('Details', [
    li({ icon: 'phone', ic: 'ok', t: r.phone, d: t('Mobile') }),
    r.guardianPhone ? li({ icon: 'users', ic: 'info', t: `${r.guardian || t('Guardian')} · ${r.guardianPhone}`, d: t('Guardian') }) : '',
    showFin ? li({ icon: 'rupee', ic: 'warn', t: `${inr(r.rent)} / ${t('month')}`, d: `${t('Deposit')} ${inr(r.deposit)}` }) : '',
    showFin && isAdmin() ? li({ icon: 'cal', ic: 'info', t: t('Previous entry'), d: t('Add old rent, electricity and payments for earlier months'), act: 'resprev', attrs: `data-id="${r.id}"` }) : '',
    showFin && r.paidTill ? li({ icon: 'check', ic: r.paidTill >= today() ? 'ok' : 'info', t: `${t('Rent paid till')} ${fmtDate(r.paidTill)}`, d: `${inr(r.paidTillAmount || 0)} ${t('paid in advance. No bill goes out for this period.')}`, chev: false }) : '',
    r.college ? li({ icon: 'building', ic: 'mute', t: r.college, d: t('College / office') }) : '',
    r.accessories && (r.accessories.given || []).length ? li({ icon: 'box', ic: (r.accessories.missing || []).length ? 'bad' : 'info', t: t('Accessories: {n} given', { n: r.accessories.given.length }), d: (r.accessories.returned ? ((r.accessories.missing || []).length ? t('NOT returned: {l}', { l: r.accessories.missing.join(', ') }) : t('All returned ✓')) : r.accessories.given.join(', ')) }) : '',
    r.food !== false && typeof tifPlanText === 'function' && (tifPlanText(r.id) || tifPlanText(r.id, 'skipPlan')) ? li({ icon: 'cal', ic: 'warn', t: t('Weekly meal plan'), d: [tifPlanText(r.id) ? `${t('Tiffin')} - ${tifPlanText(r.id)}` : '', tifPlanText(r.id, 'skipPlan') ? `${t('Skip')} - ${tifPlanText(r.id, 'skipPlan')}` : ''].filter(Boolean).join(' | '), chev: false }) : '',
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
      { name: 'email', label: 'Email address', type: 'email', value: r.email || '', maxlength: 80, placeholder: 'name@example.com', required: true, full: true },
      { name: 'guardian', label: 'Parent / guardian name', value: r.guardian, maxlength: 80, required: true }, { name: 'guardianPhone', label: 'Guardian mobile', type: 'tel', value: r.guardianPhone, maxlength: 10, placeholder: '10-digit mobile', required: true },
      { name: 'college', label: 'College / office', value: r.college, maxlength: 120, required: true }, { name: 'idNo', label: 'Aadhaar card number', value: r.idNo, maxlength: 12, placeholder: '12-digit Aadhaar', required: true },
      { name: 'rent', label: 'Monthly rent (₹)', type: 'number', value: r.rent, min: 0, max: 500000, required: true, hint: t('Applies from the next bill.') }, { name: 'lang', label: 'WhatsApp language', type: 'select', options: [{ v: 'en', l: 'English' }, { v: 'hi', l: 'हिन्दी' }], value: r.lang },
      { name: 'food', label: 'Takes mess food', type: 'checkbox', value: r.food !== false }, { name: 'address', label: 'Home address', value: r.address, full: true, maxlength: 240, required: true },
    ],
    onSubmit: v => {
      const was = r.phone, now = phone10(v.phone);
      // the same rules as check-in: nothing half-filled gets saved
      if (!/^[0-9]{10}$/.test(now)) return t('Mobile (WhatsApp) must be a 10-digit mobile number.');
      if (residents().some(x => x.id !== r.id && x.status !== 'left' && x.status !== 'cancelled' && phone10(x.phone) === now)) return t('A resident with this mobile number already exists');
      if (!isValidEmail(v.email)) return t('Enter a valid email address');
      if (!/^[0-9]{10}$/.test(phone10(v.guardianPhone))) return t('Enter a valid 10-digit guardian mobile number');
      const aad = String(v.idNo || '').replace(/[^0-9]/g, '');
      if (aad.length !== 12) return t('Aadhaar number must be exactly 12 digits');
      Store.patch(r.id, { ...v, name: String(v.name || '').replace(/\s+/g, ' ').trim(), phone: now, guardianPhone: phone10(v.guardianPhone), idNo: aad });
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
        options: bedOptions(vac, x => `${x.room.no}-${x.bed.id} · ${inr(bedRent(x.room, x.bed.id))}`),
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
        const mp = meterReadingProblem(r.roomId, v.meterOld, { canReset: false }) || meterReadingProblem(rid, v.meterNew, { canReset: false });
        if (mp) return mp;
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
        const mp = meterReadingProblem(r.roomId, v.meterA, { canReset: false }) || meterReadingProblem(target.roomId, v.meterB, { canReset: false });
        if (mp) return mp;
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
  onSubmit: v => { const lp = leaveProblem(el.dataset.id, v.from, v.to); if (lp) return lp; Store.put('leave', { resId: el.dataset.id, roomId: resById(el.dataset.id).roomId, from: v.from, to: v.to, date: v.from, reason: v.reason }); toast('Leave saved'); },
});
A.resnotice = el => {
  const r = resById(el.dataset.id);
  if (r.status === 'notice') { Store.patch(r.id, { status: 'active', planOut: null }); toast('Notice cancelled'); render(); return; }
  formModal({ title: 'Give notice', fields: [{ name: 'planOut', label: 'Planned checkout date', type: 'date', value: addDays(today(), 30), required: true }], onSubmit: v => { if (v.planOut < today()) return t('The planned checkout date cannot be in the past'); Store.patch(r.id, { status: 'notice', planOut: v.planOut }); toast('Notice recorded'); } });
};
A.resout = el => {
  const r = resById(el.dataset.id);
  if (!r) return toast('Resident not found', 'bad');

  formModal({
    title: `${t('Check out & Settlement')} · ${r.name}`,
    submit: t('Settle Accounts & Check out'),
    fields: [
      { name: 'date', label: 'Checkout date', type: 'date', value: today(), required: true },
      ...meterField(r.roomId, 'meterNow', 'Meter reading now', true),
      { name: 'ded', label: 'Damage / maintenance deductions (₹)', type: 'number', value: 0, min: 0, info: t('Charge for damage or missing items. It is taken from the deposit first. It cannot be more than the deposit held.') },
      ...(r.accessories && (r.accessories.given || []).length ? [{ name: 'accBack', label: 'Accessories handed back (untick anything missing)', type: 'multi', options: r.accessories.given.map(x => ({ v: x, l: x })), value: r.accessories.given, full: true, info: t('These were given at check-in. Anything you untick is recorded as not returned - add a deduction above if it should be charged.') }] : []),
      {
        name: 'settleAction',
        label: 'Settlement',
        info: t('Collect dues: any balance is collected now (or the refund is paid now) so the account ends at zero. Waive clears the balance without collecting. Refund later keeps the refund pending in Approvals. Leave with dues keeps the dues open.'),
        type: 'select',
        options: [
          { v: 'auto_zero', l: t('Settle now') },
          { v: 'waive_balance', l: t('Waive the balance') },
          { v: 'refund_later', l: t('Refund later') },
          { v: 'leave_debt', l: t('Leave with dues') }
        ],
        value: 'auto_zero'
      },
      {
        name: 'payMode',
        label: 'Paid by',
        info: t('How the balance is received, or how the refund is handed back. It is written on the settlement statement.'),
        type: 'select',
        options: [
          { v: 'upi', l: t('UPI') },
          { v: 'cash', l: t('Cash') },
          { v: 'bank', l: t('Bank transfer') }
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
            <b>${esc(t('Final Electricity Reading & Bill'))}:</b>
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
                <b style="color:var(--ok);font-size:15px">${esc(t('Net Refund to Resident'))}</b>
                <div class="xs muted">${esc(t('Refundable deposit {d} - Dues & deductions {l}', { d: inr(stmt.availableDepositAndCredit), l: inr(stmt.totalLiabilities) }))}</div>
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
                <b style="color:var(--bad);font-size:15px">${esc(t('Net Balance to Collect'))}</b>
                <div class="xs muted">${esc(t('Dues & deductions {l} - Refundable deposit {d}', { l: inr(stmt.totalLiabilities), d: inr(stmt.availableDepositAndCredit) }))}</div>
              </div>
              <div style="font-size:20px;font-weight:800;color:var(--bad)">${inr(stmt.balancePayable)}</div>
            </div>
            <div class="xs" style="margin-top:6px">
              ${v.settleAction === 'waive_balance'
                ? `<b style="color:var(--accent)">${esc(t('Action: {a} will be waived / discounted. Resident checks out with ₹0 due ✓', { a: inr(stmt.balancePayable) }))}</b>`
                : v.settleAction === 'leave_debt'
                ? `<b style="color:var(--bad)">${esc(t('Warning: Resident will leave with {a} unpaid debt hanging under their name.', { a: inr(stmt.balancePayable) }))}</b>`
                : `<b style="color:var(--ok)">${esc(t('Action: Collect {a} via {m}. All invoices 100% cleared to ₹0 due ✓', { a: inr(stmt.balancePayable), m: (v.payMode || 'UPI').toUpperCase() }))}</b>`
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
            ${settleRows(stmt, stmt.unpaidDues)}
          </dl>
          ${elecRow}
          ${bannerHtml}
        </div>
      `;
    },
    onChange: (v, form, ch) => { if (ch === 'meterNow' || ch === 'meterNowReset') meterGuard(form, v, 'meterNow', r.roomId, true); },
    onSubmit: v => {
      // No checkout without the room's meter reading - it decides this resident's electricity share.
      if (orgEnabled('electricity') && (v.meterNow == null || v.meterNow === '' || isNaN(v.meterNow))) return t('Enter the meter reading - a resident cannot be checked out without it');
      const mp = meterReadingProblem(r.roomId, v.meterNow, { reset: v.meterNowReset, oldFinal: v.meterNowOldFinal });
      if (mp) return mp;
      try { meterResetNow(r.roomId, v, 'meterNow', v.date); } catch (e) { return e.message; }

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
          refundRef: v.payRef || '',
          accReturned: r.accessories && (r.accessories.given || []).length ? (v.accBack || []) : undefined
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
          sendCheckoutReport(dep.id).then(x => {
            if (x.delivered) toast(t('Exit report PDF e-mailed to {e}', { e: x.to }), 'ok');
            else if (x.reason === 'no_owner_email') toast(t('Exit report not e-mailed: add your e-mail in Settings > Property'), 'warn');
            else if (x.reason !== 'demo') toast(t('Exit report could not be e-mailed: {m}', { m: x.reason }), 'warn');
          });
        }

        if (S().wa.auto) {
          waOpen(r.phone, checkoutMessage(dep, r), 'Send checkout message');
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
  const r = resById(el.dataset.id), req = docSlots(S().docs);
  formModal({
    title: 'Upload documents', fields: [...req.map((d, i) => ({ name: 'doc' + i, label: d, type: 'file', accept: 'image/jpeg,image/png,image/webp' })), { type: 'html', html: docsNote() }],
    onSubmit: v => { if (!Files.ready()) return 'Documents are not uploaded in demo mode.'; const files = req.map((d, i) => ({ type: d, file: (v['doc' + i] || [])[0] })).filter(x => x.file); if (!files.length) return 'Choose at least one file'; uploadDocs('res', r.id, files); }
  });
};
// One card for everything on file. A missing row is a prompt, an uploaded row is a door.
// The Aadhaar number typed on the form, big and spaced 4-4-4, so it can be matched with the card photo without leaving the viewer.
const aadhaarBanner = no => { const d = String(no || '').replace(/D/g, ''); return d ? `<div class="row sb" style="align-items:center;gap:10px;padding:10px 14px;margin-bottom:12px;border-radius:12px;background:var(--accent-soft);border:1px solid var(--line)"><div><div class="xs muted">${esc(t('Aadhaar number entered'))}</div><b style="font-size:20px;letter-spacing:.06em;font-variant-numeric:tabular-nums">${esc(d.replace(/(d{4})(?=d)/g, '$1 '))}</b></div></div>` : ''; };
function docsCard(r) {
  const gone = docsGoneOn(r);
  if (gone && gone <= today()) return `<div class="group-t">${esc(t('Documents'))}</div><div class="group"><div class="li noic"><span class="body muted">${esc(t('Deleted {n} days after checkout', { n: DOC_KEEP_DAYS }))}</span></div></div>`;
  // Aadhaar is kept as a Front and a Back photo; one plain "Aadhaar card" file from before still counts as both.
  const have = r.docs || [];
  const need = gone ? [] : docSlots(S().docs)
    .filter(d => !have.some(x => x.type === d || x.type === d.replace(/ \([^)]*\)$/, '')));
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

  for (const d of (r.docs || []).filter(x => ctx().role !== 'emitra' || PV_DOC_ALLOWED.test(String(x.type || '')))) {
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
      ${aadhaarBanner(r.idNo)}
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
    fields: [{ name: 'file', label: 'Photo', type: 'file', required: true, accept: 'image/*' }, { type: 'html', html: docsNote() }],
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
      ...(depositOn() ? [{ name: 'deposit', label: 'Security deposit (₹)', type: 'number', value: r.deposit, required: true }] : []),
      { name: 'noticeDays', label: 'Notice period (days)', type: 'number', value: 30, required: true }
    ],
    onSubmit: v => {
      try {
        const agr = createAgreement({
          resId: r.id,
          startDate: v.startDate,
          endDate: v.endDate,
          rent: v.rent,
          deposit: v.deposit != null ? v.deposit : (depositOn() ? r.deposit : 0),
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
      ...(depositOn() ? [{ name: 'deposit', label: 'Security deposit (₹)', type: 'number', value: agr.deposit, required: true }] : []),
      { name: 'noticeDays', label: 'Notice period (days)', type: 'number', value: agr.noticeDays || 30, required: true }
    ],
    onSubmit: v => {
      try {
        renewAgreement(agr.id, {
          newEndDate: v.newEndDate,
          rent: v.rent,
          deposit: v.deposit != null ? v.deposit : (depositOn() ? agr.deposit : 0),
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
  sheet(`${t('Transaction history')} · ${r.name}`, `<div class="group">${pays.map(p => li({
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
  sheet(a.name, `<div class="row" style="margin-bottom:10px"><button class="btn sm" data-act="signupedit" data-id="${a.id}">${ico('edit', 'sm')} ${esc(t('Edit details'))}</button></div>${aadhaarBanner(a.idNo)}<dl class="kv">
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

// Edit everything the applicant sent, then go straight on to giving a bed. Saving does not send anything for approval again.
A.signupedit = el => {
  const a = Store.get(el.dataset.id); if (!a) return;
  formModal({
    title: `${t('Edit details')} · ${a.name}`, submit: 'Save & Continue', wide: true,
    note: t('Change anything the applicant filled in. Nothing is sent again; after saving you go on to give a bed.'),
    fields: [
      { name: 'name', label: 'Full name', value: a.name, required: true, maxlength: 80 },
      { name: 'phone', label: 'Mobile (WhatsApp)', type: 'tel', value: a.phone, required: true, maxlength: 10 },
      { name: 'email', label: 'Email address', type: 'email', value: a.email || '', maxlength: 80 },
      { name: 'guardian', label: 'Parent / guardian name', value: a.guardian || '', maxlength: 80 },
      { name: 'guardianPhone', label: 'Guardian mobile', type: 'tel', value: a.guardianPhone || '', maxlength: 10 },
      { name: 'college', label: 'College / office', value: a.college || '', maxlength: 120 },
      { name: 'idNo', label: 'Aadhaar card number', value: a.idNo || '', maxlength: 12 },
      { name: 'address', label: 'Permanent address', value: a.address || '', full: true, maxlength: 240 },
      { name: 'lang', label: 'Language', type: 'select', value: a.lang === 'hi' ? 'hi' : 'en', options: [{ v: 'en', l: 'English' }, { v: 'hi', l: 'हिन्दी' }] },
      { name: 'note', label: 'They wrote', value: a.note || '', full: true, maxlength: 300, plain: true },
    ],
    onSubmit: v => {
      if (v.email && !isValidEmail(v.email)) return t('Enter a valid email address');
      if (v.guardianPhone && !/^[0-9]{10}$/.test(phone10(v.guardianPhone))) return t('Enter a valid 10-digit guardian mobile number');
      if (v.idNo && String(v.idNo).replace(/\D/g, '').length !== 12) return t('Aadhaar number must be exactly 12 digits');
      Store.patch(a.id, { name: v.name, phone: phone10(v.phone), email: v.email, guardian: v.guardian, guardianPhone: phone10(v.guardianPhone), college: v.college, idNo: String(v.idNo || '').replace(/\D/g, ''), address: v.address, lang: v.lang, note: v.note });
      toast(t('Details saved'), 'ok');
      setTimeout(() => A.signupok({ dataset: { id: a.id } }), 0);
      return false;
    }
  });
};

// The only screen where the money and the bed are decided — by the owner, never the applicant.
A.signupok = el => {
  const a = Store.get(el.dataset.id); if (!a) return;
  const free = vacantBeds();
  if (!free.length) return toast('No vacant bed. Add a room or free one up first.', 'bad');
  const bedOpts = bedOptions(free, x => `${x.room.no}-${x.bed.id} · ${inr(bedRent(x.room, x.bed.id))}${x.room.ac ? ' · AC' : ''}`);
  const rentOf = v => { const [rid, bid] = String(v).split('|'); const rm = roomById(rid); return rm ? bedRent(rm, bid) : 0; };
  closeModal(true);
  formModal({
    title: `${t('Admit')} · ${a.name}`, submit: 'Admit resident',
    note: t('{n} filled this in themselves. You decide the bed, the rent and the deposit.', { n: a.name.split(' ')[0] }),
    fields: [
      { name: 'bed', label: 'Room & bed', type: 'select', options: bedOpts, required: true, placeholder: 'Choose a bed…' },
      { name: 'rent', label: 'Monthly rent (₹)', type: 'number', min: 0, required: true, info: t('Filled from the room when you pick a bed. Change it if this resident pays something else.') },
      ...(depositOn() ? [{ name: 'deposit', label: 'Security deposit (₹)', type: 'number', min: 0, value: 0 }] : []),
      { name: 'from', label: 'Staying from', type: 'date', value: today(), required: true, info: t('The first rent bill is worked out from this date.') },
      ...prevEntryFields(),
      ...meterField(free[0] ? free[0].room.id : '', 'meterNow', 'Meter reading now', true),
      { name: 'food', label: 'Takes mess food', type: 'checkbox', value: true },
      ...(accOn() ? [{ name: 'acc', label: 'Accessories given with the bed', type: 'multi', options: accItems().map(x => ({ v: x, l: x })), value: accItems(), full: true }] : []),
      { name: 'login', label: 'Create app login and send it on WhatsApp', type: 'checkbox', value: true, info: t('User ID = mobile.hostel, password = mobile number. They can change it later.') },
    ],
    onChange: (v, form, ch) => {
      prevEntryOnChange(v, form, ch, 'from');
      if (ch === 'meterNow' || ch === 'meterNowReset' || ch === 'bed') meterGuard(form, v, 'meterNow', String(v.bed || '').split('|')[0], true);
      if (ch !== 'bed' || !v.bed) return;
      setMeterHint(form, 'meterNow', String(v.bed).split('|')[0]);
      const rent = rentOf(v.bed);
      const el2 = form.elements.rent; if (el2 && !el2.value) el2.value = rent;
      const dep = form.elements.deposit; if (dep && !(+dep.value > 0)) dep.value = depositFor(rent, roomById(String(v.bed).split('|')[0]));
    },
    preview: v => (v.bed && v.rent >= 0 ? `${esc(t('First bill'))}: ${inr(round2((v.rent || 0) + (v.deposit || 0)))} · ${esc(t('rent is pro-rata from {d}', { d: fmtShort(v.from) }))}` : ''),
    onSubmit: async (v, form) => {
      const [roomId, bed] = v.bed.split('|');
      const mp = meterReadingProblem(roomId, v.meterNow, { reset: v.meterNowReset, oldFinal: v.meterNowOldFinal });
      if (mp) return mp;
      const prevRows = prevEntryRead(form, v, 'from'); if (prevRows && prevRows.error) return prevRows.error;
      try { if (!prevRows && !meterResetNow(roomId, v, 'meterNow', v.from)) moveReading(roomId, v.meterNow, v.from); } catch (e) { return e.message; }
      const r = admitSignup(a.id, { roomId, bed, rent: v.rent, deposit: v.deposit || 0, checkIn: v.from, ...(prevRows && prevRows[0] ? { firstRent: prevRows[0].rent } : {}), food: v.food, accessories: accOn() ? (v.acc || []) : null });
      if (prevRows) {
        try {
          const pr = applyPreviousEntry(r.id, prevRows, { type: v.prevType, paidTill: v.prevType !== 'monthly' ? v.paidTill : '', depositPaid: depositOn() && !!v.prevDep });
          toast(t('Previous entry saved: {n} old bills, {a} marked paid', { n: pr.invoices + 1, a: inr(pr.paid) }), 'ok');
        } catch (e) { toast(t('Resident saved, but the old bills could not be added: {m}', { m: e.message }), 'bad'); }
      }
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
      elecNote = t('Meter Reading: {prev} → {curr} ({u} room units) · Rate: ₹{r}/unit{free}', {
        prev: num(m.prev),
        curr: num(m.curr),
        u: num(m.units),
        r: m.rate || S().elec.rate,
        free: s && s.free ? ` · ${s.free} ${t('free units deducted')}` : ''
      });
      elecHtml = `
        <div style="background:var(--subtle);padding:10px 12px;border-radius:8px;margin-bottom:12px;border-left:3px solid var(--accent);font-size:12.5px;line-height:1.5">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <b>${esc(t('Room Electricity Meter & Split'))}</b>
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
/* The same breakdown everywhere a settlement is shown, in the order the money moves:
 * deposit paid, non-refundable fee kept, refundable deposit, credit, dues, notice shortfall, damages. */
function settleRows(s, dues) {
  const row = (l, v, cls = '') => `<dt class="${cls}">${esc(t(l))}</dt><dd class="${cls}">${v}</dd>`;
  const rule = s.depositRule && DEPOSIT_RULE_LABEL[s.depositRule] ? ` <span class="xs muted">(${esc(t(DEPOSIT_RULE_LABEL[s.depositRule]))})</span>` : '';
  return [
    row('Security deposit paid', `<b>${inr(s.depositPaid)}</b>${rule}`),
    s.nonRefundable > 0 ? row('Non-refundable fee (kept)', `-${inr(s.nonRefundable)}`, 'bad-t') : '',
    s.nonRefundable > 0 ? row('Refundable deposit', `<b>${inr(s.refundableDeposit)}</b>`) : '',
    s.credit > 0 ? row('Advance credit', `+${inr(s.credit)}`, 'ok-t') : '',
    row('Unpaid dues', `-${inr(dues)}`),
    s.rentAdjust && s.rentAdjust.bills && s.rentAdjust.bills.length ? row(`of which rent for days stayed (${s.rentAdjust.usedDays}/${s.rentAdjust.totalDays})`, inr(sum(s.rentAdjust.bills, b => b.amount)), 'muted') : '',
    s.rentAdjust && s.rentAdjust.cut ? row('Unused rent taken off (left early)', `+${inr(s.rentAdjust.cut.excess)}`, 'ok-t') : '',
    s.shortfallFee > 0 ? row(`Notice shortfall (${s.shortfallDays} days)`, `-${inr(s.shortfallFee)}`, 'warn-t') : '',
    s.deductions > 0 ? row('Damage / other deductions', `-${inr(s.deductions)}`, 'bad-t') : '',
  ].join('');
}
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
        <b>${esc(t('Final Electricity Reading & Share'))}</b>
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
        
        <h3 style="margin:0">${esc(t('Final Settlement Statement'))}</h3>
        <span class="muted xs">${esc(hostelName())} · ${esc(r.name)} (${esc(room ? room.no : '')})</span>
      </div>

      <div style="display:flex;justify-content:center;margin-bottom:12px">
        ${isZeroDue
          ? `<span class="badge ok" style="padding:6px 12px;font-size:13px">✓ ${esc(t('Zero-Due Guarantee: Accounts 100% Cleared (₹0 Due)'))}</span>`
          : `<span class="badge warn" style="padding:6px 12px;font-size:13px">${esc(t('Pending Balance on Account: {b}', { b: inr(resDue(dep.resId)) }))}</span>`
        }
      </div>

      <dl class="kv">
        <dt>${esc(t('Checkout Date'))}</dt><dd>${fmtDate(dep.date)}</dd>
        ${settleRows({ ...s, depositPaid: dep.deposit, nonRefundable: dep.nonRefundable || s.nonRefundable || 0, refundableDeposit: round2((+dep.deposit || 0) - (dep.nonRefundable || s.nonRefundable || 0)), depositRule: dep.depositRule || s.depositRule, deductions: dep.deductions, credit: s.credit || 0 }, dep.settled)}
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
// One money row for every Payments tab: the name wraps (never "Shi…"), amount on the right, actions underneath on a phone.
const pillb = (label, act, attrs = '', cls = '', icon = '') => `<button type="button" class="pillbtn ${cls}" data-act="${act}" ${attrs}>${icon ? ico(icon, 'xs') : ''}<span>${esc(t(label))}</span></button>`;
const prow = o => `<div class="prow ${o.act ? 'tap' : ''}" ${o.act ? `role="button" tabindex="0" data-act="${o.act}" ${o.attrs || ''}` : ''}>${o.lead || ''}<div class="prow-b"><b class="prow-t">${o.t}</b><span class="prow-s">${o.s || ''}</span>${o.note ? `<span class="prow-n">${o.note}</span>` : ''}${o.tags ? `<span class="prow-g">${o.tags}</span>` : ''}</div>${o.amt != null ? `<div class="prow-m"><b class="${o.mc || ''}">${o.amt}</b>${o.ms ? `<small>${esc(o.ms)}</small>` : ''}</div>` : ''}${o.acts ? `<div class="prow-a">${o.acts}</div>` : ''}</div>`;
PAGES.payments = {
  title: 'Payments', mod: 'payments',
  render() {
    const tab = (curTab('pay', 'dues') === 'deps' && !depositOn()) ? 'dues' : curTab('pay', 'dues'), claims = Store.all('claim').filter(c => c.status === 'pending');
    const dues = dueList(), ym = ymOf(today());
    const coll = sum(payments().filter(p => ymOf(p.date) === ym && p.mode !== 'deposit'), p => p.amount);
    let body = '';
    const pstat = (l, v, sub, kind) => kpi(l, v, sub, kind);
    const pair = (...x) => `<span class="btn-pair">${x.join('')}</span>`;
    if (tab === 'dues') {
      const list = dues.filter(x => needle('pay', x.r.name, roomName(x.r.roomId)));
      const nOd = dues.filter(x => x.od).length;
      body = `<div class="pstats">${pstat('Pending', inr(sum(dues, x => x.due)), t('{n} residents', { n: dues.length }), dues.length ? 'warn' : '')}${pstat('Overdue', nOd, t('residents'), nOd ? 'bad' : '')}${pstat('Collected', inr(coll), fmtYM(ym), 'ok')}</div>
        <div class="tool">${searchBox('pay', 'Search resident or room')}<span class="sp"></span>${pair(btn('Monthly billing', 'monthlybatch', '', 'primary', 'cal'), dues.length ? (() => { const bp = bulkMailPlan('bill'), left = bp.todo.length + bp.noEmail.length; return left ? btn(t('E-mail all ({n})', { n: left }), 'billall', '', '', 'mail') : bp.blocked.length ? btn(t('Pending ({n})', { n: bp.blocked.length }), 'monthlybatch', '', 'warn-soft', 'alert') : btn('Sent today', 'billall', '', 'ok-soft', 'check'); })() : '')}</div>
        ${list.length ? `<div class="group">${list.map(x => prow({
          lead: avatar(x.r.name), t: `<button class="linkish" data-act="go" data-to="residents/${x.r.id}">${esc(x.r.name)}</button>`,
          s: `${esc(roomName(x.r.roomId))} · ${openInv(x.r.id).map(i => esc(t(INV_TYPES[i.type] || i.type))).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`,
          tags: x.od ? badge('Overdue', 'bad') : '', amt: inr(x.due), mc: x.od ? 'bad-t' : '',
          acts: `${btn('Send bill', 'sendbill', `data-res="${x.r.id}"`, 'sm', 'wa')}${btn('Cash', 'pay', `data-res="${x.r.id}"`, 'sm primary', 'rupee')}`
        })).join('')}</div>` : `<div class="card">${empty('No dues ', 'Everyone has paid.')}</div>`}`;
    } else if (tab === 'claims') {
      const list = Store.all('claim').slice().sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || (b.ts > a.ts ? 1 : -1)).slice(0, 80);
      const stc = { pending: ['Pending', 'warn'], approved: ['Approved', 'ok'] };
      body = list.length ? `<div class="group">${list.map(c => { const r = resById(c.resId), [lbl, cls] = stc[c.status] || ['Rejected', 'bad']; return prow({
        lead: avatar(r ? r.name : '?'), t: esc(r ? r.name : '—'), s: `${r ? esc(roomName(r.roomId)) + ' · ' : ''}${fmtShort(c.date)}${c.utr ? ' · UTR ' + esc(c.utr) : ''}`,
        tags: badge(lbl, cls), amt: inr(c.amount),
        acts: c.status === 'pending' ? `${btn('View', 'claimview', `data-id="${c.id}"`, 'sm')}${btn('Approve', 'claimok', `data-id="${c.id}"`, 'sm ok', 'check')}` : ''
      }); }).join('')}</div>` : `<div class="card">${empty('No UPI payments yet', 'When residents pay by UPI and enter the UTR in their app, it shows here.')}</div>`;
    } else if (tab === 'statement') {
      const all = Store.all('stmt_tx').slice().sort(by('ts', -1));
      const REVIEW = ['probable', 'amount_mismatch', 'multiple_candidates'], DONE = ['matched', 'already_reconciled'];
      const nRev = all.filter(x => REVIEW.includes(x.status)).length, nUn = all.filter(x => x.status === 'unmatched').length, nOk = all.filter(x => DONE.includes(x.status)).length;
      const sf = curFlt('stmtf', 'all');
      const st = { matched: ['Matched', 'ok'], exact: ['Exact match', 'ok'], probable: ['Probable match', 'info'], amount_mismatch: ['Amount mismatch', 'warn'], multiple_candidates: ['Multiple candidates', 'warn'], unmatched: ['Unmatched', 'bad'], duplicate: ['Duplicate ref', 'mute'], already_reconciled: ['Reconciled', 'ok'] };
      const list = all.filter(c => (sf === 'all' || (sf === 'review' && REVIEW.includes(c.status)) || (sf === 'unmatched' && c.status === 'unmatched') || (sf === 'done' && DONE.includes(c.status))) && needle('stmt', c.narration, c.ref, c.amount, (resById(c.resId) || {}).name));
      body = `<div class="pstats">${pstat('Needs review', nRev, '', nRev ? 'warn' : '')}${pstat('Unmatched', nUn, '', nUn ? 'bad' : '')}${pstat('Matched', nOk, t('of {n} credits', { n: all.length }), 'ok')}</div>
        <div class="tool">${searchBox('stmt', 'Search statement transactions')}<span class="sp"></span>${btn('Import statement (CSV)', 'importstmt', '', 'primary', 'upload')}</div>
        ${all.length ? `<div class="tool">${chips('stmtf', [['all', 'All'], ['review', 'Needs review'], ['unmatched', 'Unmatched'], ['done', 'Matched']], 'all')}</div>` : ''}
        ${list.length ? `<div class="group">${list.map(c => { const r = c.resId && resById(c.resId), [lbl, cls] = st[c.status] || [c.status || 'Pending', 'warn']; return prow({
          lead: r ? avatar(r.name) : `<span class="prow-ic">${ico('rupee', 'sm')}</span>`, t: esc(r ? r.name : (c.narration || t('Unknown sender'))),
          s: `${fmtShort(c.date)}${c.ref ? ' · ' + esc(c.ref) : ''}`, note: r && c.narration ? esc(c.narration) : '', tags: badge(lbl, cls), amt: inr(c.amount), mc: 'ok-t',
          acts: DONE.includes(c.status) ? '' : btn('Confirm / Link', 'stmtconfirm', `data-id="${c.id}"`, 'sm ok', 'check')
        }); }).join('')}</div>` : `<div class="card">${all.length ? empty('Nothing here', 'No transactions match this filter.') : empty('No statement credits imported yet', 'Import your bank statement (CSV) to verify resident UPI claims without gateway fees. Clear UTR matches confirm automatically; unclear ones wait for your review.')}</div>`}`;
    } else if (tab === 'history') {
      const mf = curFlt('payhm', 'all'), modeOf = x => x.mode === 'cash' ? 'cash' : x.mode === 'deposit' ? 'deposit' : 'upi';
      const list = payments().filter(x => (mf === 'all' || modeOf(x) === mf) && needle('payh', (resById(x.resId) || {}).name, x.ref, x.no)).sort(by('date', -1));
      const months = {}; list.forEach(x => (months[ymOf(x.date)] = months[ymOf(x.date)] || []).push(x));
      body = `<div class="tool">${searchBox('payh', 'Search name, UTR, receipt')}<span class="sp"></span>${pair(orgEnabled('cashfree') ? btn('Reconcile', 'reconcilepay', '', '', 'sync') : '', btn('Export', 'exportpay', '', '', 'download'))}</div>
        <div class="tool">${chips('payhm', [['all', 'All'], ['upi', 'UPI'], ['cash', 'Cash'], ['deposit', 'Deposit']], 'all')}</div>
        ${list.length ? Object.keys(months).sort().reverse().map(m => { const act = months[m].filter(x => !x.reversed); return `<div class="pgh"><b>${esc(fmtYM(m))}</b><span>${inr(sum(act, x => x.amount))} · ${t('{n} payments', { n: act.length })}</span></div>
          <div class="group">${months[m].map(x => { const r = resById(x.resId); return prow({
            act: 'receipt', attrs: `data-id="${x.id}"`, lead: avatar(r ? r.name : '?'), t: esc(r ? r.name : '—'),
            s: `${fmtShort(x.date)} · ${esc(x.mode.toUpperCase())}${x.ref ? ' · ' + esc(x.ref) : x.no ? ' · ' + esc(x.no) : ''}`, tags: x.reversed ? badge('REVERSED', 'bad') : '', amt: inr(x.amount), mc: x.reversed ? 'bad-t' : ''
          }); }).join('')}</div>`; }).join('') : `<div class="card">${empty('No payments found', 'Payments you record or confirm appear here.')}</div>`}`;
    } else {
      const list = Store.all('dep').slice().sort(by('date', -1));
      const held = sum(activeRes(), r => sum(resInvoices(r.id).filter(i => i.type === 'deposit'), i => i.paid || 0));
      const sd = { pending: ['Pending', 'warn'], paid: ['Refunded', 'ok'], debt: ['Debt', 'bad'] };
      body = `<div class="pstats">${pstat('Deposits held', inr(held), t('{n} residents', { n: activeRes().length }))}${pstat('Refunds pending', inr(sum(list.filter(d => d.status === 'pending'), d => d.refund)), '', 'warn')}</div>
        ${list.length ? `<div class="group">${list.map(d => { const [lbl, cls] = sd[d.status] || ['Closed', 'ok']; return prow({
          lead: avatar((resById(d.resId) || {}).name || '?'), t: esc((resById(d.resId) || {}).name || '—'),
          s: `${fmtShort(d.date)} · ${t('Deposit')} ${inr(d.deposit)} · ${t('adjusted')} ${inr(d.settled + d.deductions)}`, tags: badge(lbl, cls), amt: inr(d.refund), ms: t('refund'),
          acts: `${btn('Statement', 'depstatement', `data-id="${d.id}"`, 'sm')}${d.status === 'pending' ? btn('Mark refunded', 'depok', `data-id="${d.id}"`, 'sm ok') : ''}`
        }); }).join('')}</div>` : `<div class="card">${empty('No checkouts yet')}</div>`}`;
    }
    return `${head('Payments', t('{c} collected in {m} · {d} pending', { c: inr(coll), m: fmtYM(ym), d: inr(sum(dues, x => x.due)) }), btn('Record cash payment', 'pay', '', 'primary', 'plus'))}
      ${seg('pay', [['dues', 'Dues'], ['claims', 'UPI claims', claims.length], ['statement', 'Bank statement'], ['history', 'History'], ...(depositOn() ? [['deps', 'Deposits']] : [])], 'dues')}${body}`;
  },
};
A.importstmt = () => {
  formModal({
    title: 'Import Bank Statement (CSV) & Auto-Reconcile',
    submit: 'Apply these results',
    wide: true,
    note: t('Pick the CSV file you downloaded from your bank (or paste it). You will see exactly what will happen below before anything is saved.'),
    fields: [
      { type: 'html', html: `<label class="f">${esc(t('CSV file'))}</label><input type="file" id="stmtFile" accept=".csv,.txt,text/csv,text/plain">` },
      { name: 'csvText', label: 'Or paste the statement here', type: 'textarea', required: true, full: true, hint: 'Works with HDFC, ICICI, SBI, Axis, Kotak, PNB, Bank of Baroda, Canara, Union, Yes, IDFC, IndusInd, Federal, PhonePe, Paytm and similar exports.' },
      { name: 'autoConfirm', label: 'Automatically confirm exact UTR & amount matches', type: 'checkbox', value: true }
    ],
    preview: v => {
      if (!v.csvText || !v.csvText.trim()) return '';
      try {
        const rows = parseBankStatement(v.csvText), credits = rows.filter(r => r.direction === 'CR'), m = rows.meta || {};
        if (!credits.length) return `<div class="note warn">${esc(t('No credit (money received) rows found in this statement.'))}</div>`;
        const d = reconcileBankStatement(rows, { autoConfirm: v.autoConfirm !== false, dryRun: true }), sm = d.summary;
        const line = (x, tag) => `<div class="stm-l">${tag}<span class="stm-n">${esc(((x.res || (x.claim && resById(x.claim.resId)) || {}).name) || (x.row.narration || '').slice(0, 34) || '—')}</span><b>${inr(x.row.amount)}</b></div>`;
        const part = (n, lbl, cls) => `<div class="stm-c ${cls}"><b>${n}</b><span>${esc(t(lbl))}</span></div>`;
        return `<div class="stm-p"><div class="stm-h">${esc(t('{n} credits found in {r} rows', { n: credits.length, r: rows.length }))} <span class="muted xs">· ${esc(t('header on line {l}', { l: m.headerRow || 1 }))}</span></div>
          <div class="stm-g">${part(sm.autoMatched, 'Will be confirmed', 'ok')}${part(sm.probableMatch + sm.amountMismatch, 'Need your review', 'warn')}${part(sm.unmatched, 'Unmatched', 'bad')}${part(sm.duplicate, 'Duplicate', 'mute')}</div>
          ${d.exactMatches.length ? `<div class="stm-t">${esc(t('Will be confirmed'))}</div>${d.exactMatches.slice(0, 6).map(x => line(x, ico('check', 'xs'))).join('')}${d.exactMatches.length > 6 ? `<div class="muted xs">+${d.exactMatches.length - 6} ${esc(t('more'))}</div>` : ''}` : ''}
          ${d.probableMatches.length + d.amountMismatches.length ? `<div class="stm-t">${esc(t('Need your review'))}</div>${[...d.probableMatches, ...d.amountMismatches].slice(0, 4).map(x => line(x, ico('alert', 'xs'))).join('')}` : ''}</div>`;
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

// a CSV picked from the phone / computer fills the box, and the preview above the buttons refreshes
document.addEventListener('change', async e => {
  const f = e.target; if (!f || f.id !== 'stmtFile' || !f.files || !f.files[0]) return;
  const file = f.files[0], form = f.closest('form'), box = form && form.elements.csvText; if (!box) return;
  if (file.size > 3 * 1024 * 1024) { toast(t('This file is too large for a statement (max 3 MB). Export a shorter date range.'), 'bad'); f.value = ''; return; }
  try { box.value = await file.text(); box.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) { toast(t('Could not read this file'), 'bad'); }
});
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
      if (v.date > today()) return t('The date cannot be in the future');
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
/* The bill goes to ONE resident on WhatsApp together with a clean payment card: the QR first, then the amount and the details.
 * A wa.me link can only carry text, so the card is copied and the resident's own chat opens with the message typed in. */
async function payCardBlob(r, amount, note) {
  if (typeof qrcode !== 'function') await loadScript('/vendor/qrcode.js');
  const q = qrcode(0, 'M'); const upi = (payBuckets(r)[0] || {}).upi || (S().pay || {}).upiId; q.addData(upiUri(amount, note, upi)); q.make();
  const n = q.getModuleCount(), W = 1080, H = 1660, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), rr = (X, Y, w, h, R) => { x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + w, Y, X + w, Y + h, R); x.arcTo(X + w, Y + h, X, Y + h, R); x.arcTo(X, Y + h, X, Y, R); x.arcTo(X, Y, X + w, Y, R); x.closePath(); };
  const F = "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif", h0 = Store.hostel() || {}, p = S().pay || {};
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1d1b6b'); g.addColorStop(1, '#4b4ff0'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.save(); x.shadowColor = 'rgba(10,10,60,.4)'; x.shadowBlur = 60; x.shadowOffsetY = 24; x.fillStyle = '#fff'; rr(60, 60, W - 120, H - 120, 64); x.fill(); x.restore();
  const qs = 620, qx = (W - qs) / 2, qy = 130; x.fillStyle = '#f4f5fd'; rr(qx - 36, qy - 36, qs + 72, qs + 72, 44); x.fill();
  const cell = qs / n; x.fillStyle = '#16163a'; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (q.isDark(i, j)) x.fillRect(Math.round(qx + j * cell), Math.round(qy + i * cell), Math.ceil(cell), Math.ceil(cell));
  const T = (txt, y, size, w, col) => { x.fillStyle = col; x.font = `${w} ${size}px ${F}`; x.textAlign = 'center'; x.fillText(txt, W / 2, y); };
  T('Scan with any UPI app', qy + qs + 104, 34, '600', '#6b6f8d');
  T('₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }), qy + qs + 262, 150, '800', '#3b3fe0');
  x.fillStyle = '#e7e8f3'; x.fillRect(150, qy + qs + 326, W - 300, 3);
  const rows = [[t('Pay to'), p.payee || h0.name || ''], ['UPI ID', upi || ''], [t('For'), `${r.name} · ${t('Room')} ${roomName(r.roomId)}`]];
  rows.forEach((row, i) => { const y = qy + qs + 420 + i * 84; x.textAlign = 'left'; x.fillStyle = '#8a8eab'; x.font = `600 32px ${F}`; x.fillText(row[0], 150, y); x.textAlign = 'right'; x.fillStyle = '#1b1c3a'; x.font = `700 34px ${F}`; let v = String(row[1]); while (x.measureText(v).width > 620 && v.length > 4) v = v.slice(0, -2); x.fillText(v === row[1] ? v : v + '…', W - 150, y); });
  x.fillStyle = '#e8f7ee'; rr(150, H - 270, W - 300, 96, 48); x.fill(); T(h0.name || 'Sarvlekh', H - 208, 36, '700', '#128a4a');
  return new Promise(res => c.toBlob(res, 'image/png'));
}
async function sendBillWithQr(r, m) {
  const p = S().pay || {}; if (!(payBuckets(r)[0] || {}).upi && !p.upiId || !(m.total > 0)) return false;
  if (payBuckets(r).length > 1) return false;   // rent and electricity go to different UPI IDs: the message carries two separate pay links
  let blob; try { blob = await payCardBlob(r, m.total, `${r.name.split(' ')[0]} ${roomName(r.roomId)} ${(Store.hostel() || {}).name || ''}`.trim()); } catch (e) { return false; }
  if (!blob) return false;
  // Never the system share sheet: it lists every contact and the bill can land in the wrong chat. The card is
  // copied instead and the resident's own chat is opened with the message already typed (see A.sendbill).
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast(t('Payment card copied - paste it in the chat that opens'), 'ok'); } catch (e) { /* no image clipboard: the text with the pay link goes alone */ }
  return false;
}
A.sendbill = async el => {
  const r = resById(el.dataset.res); if (!r) return;
  if (!S().pay.upiId) toast('Add your UPI ID in Settings → Payments to include a pay link', 'bad');
  const m = billMessage(r);
  if (!m.total) return toast('No dues for this resident');
  if (await sendBillWithQr(r, m)) return;
  // only a message goes out here, so the panel it was sent from (Record payment, a profile) stays open behind WhatsApp
  waOpen(r.phone, m.text, 'Send bill');
};
function bulkMailHtml(plan, kind) {
  const total = plan.total, left = plan.todo.length + plan.noEmail.length, doneN = plan.done.length, wait = (plan.blocked || []).length;
  const when = plan.at ? fmtTime(new Date(plan.at).toTimeString().slice(0, 5)) : '';
  const owed = sum([...plan.todo, ...plan.noEmail, ...plan.done], x => x.due);
  if (!total) return `<div class="bm"><div class="bm-ic ok">${ico('check')}</div><b class="bm-h">${esc(t('Nobody to send to'))}</b></div>`;
  if (!left && !doneN && wait) return `<div class="bm"><div class="bm-ic bad">${ico('alert')}</div><b class="bm-h">${esc(t('{n} bills are not complete', { n: wait }))}</b><p class="bm-p">${esc(t('Add the missing readings first. Their e-mails wait until the bill is complete.'))}</p></div>`;
  if (!left) return `<div class="bm"><div class="bm-ic ok">${ico('mail')}</div><b class="bm-h">${esc(t('Sent today'))}</b><p class="bm-p">${esc(t('{a} e-mailed at {w}', { a: plan.emailed, w: when }))}${plan.appOnly ? ' · ' + esc(t('{n} app notice only', { n: plan.appOnly })) : ''}</p></div>`;
  return `<div class="bm">
    ${doneN ? `<div class="bm-note">${ico('check', 'sm')} ${esc(t('{n} already sent today', { n: doneN }))}</div>` : ''}
    <div class="bm-ic">${ico('mail')}</div><b class="bm-h">${esc(t('{n} residents', { n: left }))}</b><span class="bm-amt">${inr(owed)}</span>
    <div class="bm-st"><span class="ok">${ico('mail', 'xs')} ${esc(t('{n} will be e-mailed', { n: plan.todo.length }))}</span>${plan.noEmail.length ? `<span class="warn">${ico('alert', 'xs')} ${esc(t('{n} have no e-mail (app notice only)', { n: plan.noEmail.length }))}</span>` : ''}${wait ? `<span class="warn">${esc(t('{n} bills not complete', { n: wait }))}</span>` : ''}</div></div>`;
}
function bulkMailResult(r, kind) {
  const msg = r.demo ? t('Demo hostel: nothing was really e-mailed.') : r.reason === 'not_configured' ? t('E-mail is not set up on the server yet (RESEND_API_KEY). Nothing was sent.') : r.reason ? t('Why: {r}', { r: String(r.reason) }) : '';
  return `<div class="bm"><div class="bm-ic ${r.failed && !r.sent ? 'bad' : 'ok'}">${ico(r.failed && !r.sent ? 'alert' : 'check')}</div><b class="bm-h">${esc(r.sent ? t('Sent to {n} residents', { n: r.sent }) : t('Nothing was sent'))}</b>
    ${r.failed && !r.demo ? `<div style="text-align:center;margin:8px 0"><button class="btn sm" data-act="mailcheck">${ico('search', 'sm')} ${esc(t('Check e-mail setup'))}</button></div>` : ''}
    <div class="bm-st">${r.noEmail ? `<span class="warn">${esc(t('{n} app notice only (no e-mail)', { n: r.noEmail }))}</span>` : ''}${r.failed ? `<span class="bad">${esc(t('{n} failed - tap again to retry only those', { n: r.failed }))}</span>` : ''}</div>${msg ? `<p class="bm-p">${esc(msg)}</p>` : ''}</div>`;
}
A.mailcheck = async el => {
  if (el) el.disabled = true;
  try {
    const c = await Backend.admin('mail_check');
    const row = (ok, label, why) => li({ icon: ok ? 'check' : 'alert', ic: ok ? 'ok' : 'bad', t: label, d: why || '', chev: false });
    const dom = c.domain_status === 'verified';
    sheet(t('E-mail setup check'), group('', [
      row(c.database_key_ok, t('Server can reach the database'), c.database_key_ok ? '' : t('The server key was refused: {e}. Put the new sb_secret key in Cloudflare (SUPABASE_SERVICE_ROLE_KEY).', { e: c.database_error || '' })),
      row(c.resend_key || c.smtp, t('Mail provider key is set'), c.resend_key || c.smtp ? '' : t('RESEND_API_KEY is missing on the server.')),
      row(!c.resend_error, t('Resend accepts the key'), c.resend_error ? (c.resend_restricted ? t('This key can only send mail, so it cannot list domains. That is fine; check the domain in the Resend dashboard.') : c.resend_error) : ''),
      c.resend_key && !c.resend_restricted && !c.resend_error ? row(!!c.domain_found && dom, t('Sender domain {d} is verified in Resend', { d: c.domain }), c.domain_found ? t('Status: {s}', { s: c.domain_status }) + (c.records ? ' · ' + c.records.filter(x => x.status !== 'verified').map(x => x.record + ' ' + x.type + ' ' + x.status).join(', ') : '') : t('This domain is not added in Resend. Add it and the DNS records.')) : '',
      li({ icon: 'mail', ic: 'info', t: t('Sender'), d: c.from, chev: false }),
    ].join('')), { foot: '<button class="btn primary block" data-act="close">' + esc(t('Close')) + '</button>' });
  } catch (e) { toast(e.message === 'Session expired' ? t('The server rejected the login check (401). The Supabase secret key on the server is probably the old, disabled one.') : e.message, 'bad'); }
  finally { if (el) el.disabled = false; }
};
function openBulkMail(kind = 'bill', opts = {}) {
  const plan = bulkMailPlan(kind, opts), left = plan.todo.length + plan.noEmail.length;
  sheet(t(kind === 'reminder' ? 'E-mail payment reminders' : 'E-mail bills to everyone'), `<div id="bmBody">${bulkMailHtml(plan, kind)}</div>`,
    { foot: left ? `<button class="btn primary block bm-go" data-act="bulkmailgo" data-kind="${kind}" ${opts.only ? `data-only="${[...opts.only].join(',')}"` : ''}>${ico('mail', 'sm')} ${esc(t('Send to all ({n})', { n: left }))}</button>` : `<button class="btn block" data-act="close">${esc(t('Close'))}</button>` });
}
A.bulkmail = el => openBulkMail((el && el.dataset && el.dataset.kind) || 'bill');
A.bulkmailgo = async el => {
  const kind = el.dataset.kind || 'bill', only = el.dataset.only ? new Set(el.dataset.only.split(',')) : null, body = $('#bmBody');
  el.disabled = true; el.innerHTML = `<span class="spin sm"></span> ${esc(t('Sending...'))}`;
  if (body) body.innerHTML = `<div class="bm"><div class="spin"></div><b class="bm-h">${esc(t('Sending e-mails...'))}</b></div>`;
  let r; try { r = await sendBulkMail(kind, only ? { only } : {}); } catch (e) { r = { status: 'sent', sent: 0, failed: 1, reason: e.message, noEmail: 0 }; }
  if (body) body.innerHTML = bulkMailResult(r, kind);
  const foot = $('.modal footer'); if (foot) foot.innerHTML = `<button class="btn primary block" data-act="close">${esc(t('Done'))}</button>`;
  render();
};
A.billall = () => { if (!S().pay.upiId) toast('Add your UPI ID in Settings → Payments to include a pay link', 'bad'); openBulkMail('bill'); };
A.mbillsend = () => { if (!S().pay.upiId) toast('Add your UPI ID in Settings → Payments to include a pay link', 'bad'); openBulkMail('bill'); };
A.remindsend = () => openBulkMail('reminder');
A.remindall = () => openBulkMail('reminder');
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
A.sendrcpt = el => { const p = Store.get(el.dataset.id); waOpen(resById(p.resId).phone, receiptMessage(p), 'Send receipt'); };
A.exportpay = () => download(`payments-${today()}.csv`, csv([['Date', 'Receipt', 'Resident', 'Room', 'Amount', 'Mode', 'Reference', 'Status', 'Reversal Reason'], ...Store.all('pay').sort(by('date')).map(p => [p.date, p.no, (resById(p.resId) || {}).name, roomName(p.roomId), p.amount, p.mode, p.ref, p.reversed ? 'Reversed' : 'Active', p.reversalReason || ''])]), 'text/csv');

/* ===================================================================== electricity */
// What a reading was billed for (older readings may only hold their shares, or nothing yet)
function meterBilled(m) {
  let tot = (m.total != null && !isNaN(m.total)) ? m.total : (Array.isArray(m.shares) && m.shares.length ? sum(m.shares, s => s.amount) : null);
  if ((tot == null || tot === 0) && (!m.shares || !m.shares.length) && m.units > 0 && m.status === 'billed') {
    const fromDate = m.prevDate || (m.span ? addDays(m.date, -m.span) : null);
    const occ = meterOccupants(m.roomId, fromDate, m.date);
    const occupants = occ.length ? occ.map(o => o[0]) : activeRes().filter(r => r.roomId === m.roomId).map(r => r.id);
    if (occupants.length) tot = sum(splitElectricity(m.roomId, m.units, m.rate || S().elec.rate, occupants, occ.length ? occ.map(o => o[1]) : null, freeMonths(fromDate, m.date)), s => s.amount);
  }
  return tot || 0;
}
PAGES.electricity = {
  title: 'Electricity', mod: 'electricity',
  render() {
    const e = S().elec, cur = ymOf(today()), ym = ui.flt.elm || cur;
    const occRooms = rooms().filter(r => bedsOf(r).some(b => b.status === 'occ'));
    const all = meters().filter(m => ymOf(m.date) === ym), real = all.filter(m => !m.opening);
    const doneRooms = new Set(real.map(m => m.roomId)), pending = ym === cur ? occRooms.filter(r => !doneRooms.has(r.id)) : [];
    const review = meters().filter(m => m.status === 'review');
    const billed = sum(real.filter(m => m.status !== 'review'), meterBilled), units = sum(real, m => +m.units || 0);
    const total = occRooms.length || 1, read = occRooms.filter(r => doneRooms.has(r.id)).length;
    const rowOf = m => {
      const abnormal = m.units > 10000 || m.curr > 999999 || !roomById(m.roomId), rv = m.status === 'review';
      const tag = m.opening ? badge(m.meterReplaced ? 'Replaced' : 'Opening', 'mute') : rv ? badge(m.isReplacement ? 'New meter claim' : 'Check reading', 'warn') : abnormal ? badge('Abnormal', 'bad') : badge('Billed', 'ok');
      return prow({
        act: 'meterview', attrs: `data-id="${m.id}"`, lead: `<span class="prow-ic tn3 prow-no">${esc(roomName(m.roomId))}</span>`, t: `${esc(t('Room'))} ${esc(roomName(m.roomId))}${!roomById(m.roomId) ? ` · ${esc(t('Orphaned'))}` : ''}`,
        s: esc(`${num(m.prev)} → ${num(m.curr)} · ${num(m.units)} ${t('units')} · ${fmtShort(m.date)}`),
        tags: `${tag}${rv ? pillb(m.isReplacement ? 'Approve' : 'Bill it', 'meterok', `data-id="${m.id}"`, 'ok') : ''}`,
        amt: m.opening || rv ? '' : inr(meterBilled(m)), mc: abnormal ? 'bad-t' : ''
      });
    };
    return `${head('Electricity', '', `<span class="btn-pair">${btn('Rates', 'go', 'data-to="settings/elec"', '', 'settings')}${btn('Replace meter', 'meterreset', '', '', 'repeat')}</span>${btn('Enter readings', 'readings', '', 'primary', 'bolt')}`)}
      ${monthBar(ym, 'elmon')}
      <div class="elhero"><div class="el-t"><span>${esc(t('Billed in {m}', { m: fmtYM(ym) }))}</span><b>${inr(billed)}</b><small>${esc(t('{u} units · ₹{r}/unit · {f} free per {m}', { u: num(units), r: e.rate, f: e.freeUnits, m: t(e.freeMode === 'room' ? 'room' : 'resident') }))}</small></div>
        ${ym === cur && occRooms.length ? `<div class="el-p"><div class="el-pb"><i class="pgi" style="width:${pct(read, total)}%;--p:${pct(read, total)}"></i></div><span>${esc(t('{a} of {b} rooms read', { a: read, b: occRooms.length }))}</span></div>` : ''}</div>
      ${pending.length ? (() => {
        // every room is a button that opens its own reading form; a long list folds to 12 with a "show all"
        const all = ui.flt.elmore === '1', cap = 12, shown = all ? pending : pending.slice(0, cap);
        return `<div class="el-pend"><div class="el-ph"><b>${esc(t('Still to read'))}</b><span class="el-cnt">${pending.length}</span>${pending.length > cap ? `<button type="button" class="el-more" data-act="setflt" data-k="elmore" data-v="${all ? '' : '1'}">${esc(all ? t('Show less') : t('Show all'))}</button>` : ''}</div>
          <div class="el-chips">${shown.map(r => `<button type="button" class="el-chip" data-act="readroom" data-id="${esc(r.id)}" aria-label="${esc(`${t('Room')} ${roomName(r.id)}`)}">${esc(roomName(r.id))}</button>`).join('')}${!all && pending.length > cap ? `<button type="button" class="el-chip more" data-act="setflt" data-k="elmore" data-v="1">+${pending.length - cap}</button>` : ''}</div></div>`;
      })() : ''}
      ${review.length ? `<div class="group-t">${esc(t('Waiting for your approval'))} · ${review.length}</div><div class="group">${review.map(rowOf).join('')}</div>` : ''}
      <div class="group-t">${esc(t('Readings'))} · ${esc(fmtYM(ym))}</div>
      ${real.filter(m => m.status !== 'review').length || all.some(m => m.opening) ? `<div class="group">${all.filter(m => m.status !== 'review').sort((a, b) => (b.date > a.date ? 1 : -1)).map(rowOf).join('')}</div>` : `<div class="card">${empty('No readings yet', 'Enter meter readings once a month — bills are created automatically.', btn('Enter readings', 'readings', '', 'primary', 'bolt'))}</div>`}
      ${about(t('Free units are deducted before charging per unit, and the bill is split by the days each person stayed. Tap a reading to see the split.'))}`;
  },
};
A.elmon = el => { ui.flt.elm = el.dataset.m; render(); };
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
      { name: 'reason', label: 'Reason for replacement / reset', required: true, placeholder: t('Old meter burnt out, installed new digital submeter') }
    ],
    onChange: (vals, form, changedField) => {
      if (changedField === 'roomId') {
        const l = lastMeter(vals.roomId);
        setField(form, 'finalOld', l ? l.curr : 0);
      }
    },
    onSubmit: v => {
      try {
        replaceMeter({
          roomId: v.roomId,
          finalOldReading: v.finalOld,
          startingNewReading: v.startingNew,
          newSerial: v.newSerial,
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
// One room: opened by tapping its number under "Still to read". Same rules as the all-rooms screen, and the
// same replaced / reset meter option; afterwards it offers the next room that is still waiting.
function roomBillPreview(roomId, curr, date) {
  const l = lastMeter(roomId); if (isNaN(curr) || curr === '' || curr == null) return null;
  const units = +curr - (l ? l.curr : 0); if (units < 0) return null;
  const on = date || today(), prevDate = l ? l.date : null, occ = on > (prevDate || '') ? meterOccupants(roomId, prevDate, on) : [];
  const ids = occ.length ? occ.map(o => o[0]) : activeRes().filter(x => x.roomId === roomId).map(x => x.id);
  const shares = splitElectricity(roomId, units, S().elec.rate, ids, occ.length && occ.some(o => o[1] < 1) ? occ.map(o => o[1]) : null, freeMonths(prevDate, on));
  return { units: round2(units), total: sum(shares, s => s.amount) };
}
A.readroom = el => {
  const room = roomById(el.dataset.id); if (!room) return toast('Room not found', 'bad');
  const last = lastMeter(room.id);
  formModal({
    title: `${t('Room')} ${room.no} · ${t('Meter reading')}`, submit: 'Save reading',
    fields: [
      { name: 'date', label: 'Reading date', type: 'date', value: today(), required: true },
      { name: 'curr', label: 'Meter reading now', type: 'number', min: 0, max: 999999, step: 0.1, required: true, placeholder: last ? `> ${num(last.curr)}` : t('Current reading'), hint: meterHintText(room.id), hintShow: true },
      { name: 'currReset', label: 'Meter was replaced or reset', type: 'checkbox', full: true, hidden: true },
      { name: 'currOldFinal', label: 'Old meter\'s final reading', type: 'number', min: 0, step: 0.1, full: true, hidden: true },
      { name: 'send', label: 'Send bills on WhatsApp after saving', type: 'checkbox', value: true, full: true },
    ],
    onChange: (v, form, ch) => { if (ch === 'curr' || ch === 'currReset') meterGuard(form, v, 'curr', room.id, true); },
    preview: v => { const p = roomBillPreview(room.id, v.curr, v.date); return p && !v.currReset ? t('{u} units · bills {t}', { u: num(p.units), t: inr(p.total) }) : ''; },
    onSubmit: v => {
      if (v.curr === '' || v.curr == null || isNaN(v.curr)) return t('Enter the meter reading');
      if (pendingMeter(room.id)) return t('Room {r}: a reading is already waiting for your approval (Approvals). Approve or reject it first.', { r: room.no });
      const mp = meterReadingProblem(room.id, v.curr, { reset: v.currReset, oldFinal: v.currOldFinal });
      if (mp) return mp;
      if (v.date > today()) return t('The date cannot be in the future');
      if (last && v.date < last.date) return t('Room {r}: the date cannot be earlier than the last reading ({d})', { r: room.no, d: fmtShort(last.date) });
      let m = null;
      try { if (!meterResetNow(room.id, v, 'curr', v.date)) m = addReading({ roomId: room.id, curr: +v.curr, date: v.date }); } catch (e) { return e.message; }
      const touched = new Set(m && m.status === 'billed' ? m.shares.map(s => s.resId) : []);
      closeModal(); render();
      const next = rooms().find(r => r.id !== room.id && bedsOf(r).some(b => b.status === 'occ') && !meters().some(x => x.roomId === r.id && !x.opening && ymOf(x.date) === ymOf(today())));
      const q = v.send ? [...touched].map(id => resById(id)).filter(r => r && resDue(r.id) > 0).map(r => ({ phone: r.phone, text: billMessage(r).text, label: `${r.name} · ${inr(resDue(r.id))}` })) : [];
      toast(t('Room {r} saved', { r: room.no }), 'ok', next && !q.length ? { label: t('Next: {r}', { r: next.no }), run: () => A.readroom({ dataset: { id: next.id } }) } : undefined);
      if (q.length === 1) waOpen(q[0].phone, q[0].text, 'Send bill'); else if (q.length > 1) openBulkMail('bill', { only: touched });
      return false;
    },
  });
};
// One screen for all rooms: type the meter numbers, bills + WhatsApp queue are created in one go.
A.readings = () => {
  const list = rooms().filter(r => bedsOf(r).some(b => b.status === 'occ'));
  if (!list.length) return toast('No occupied rooms', 'bad');
  const fields = list.map(r => { const l = lastMeter(r.id); return { name: 'm_' + r.id, errLabel: t('Room') + ' ' + r.no, label: `${r.no} · ${t('last')} ${l ? num(l.curr) : '—'}`, type: 'number', step: 0.1, min: l ? l.curr : 0, max: 999999, placeholder: t('Current reading') }; });
  formModal({
    title: 'Meter readings', submit: 'Create bills', wide: true,
    note: t('Leave a room empty to skip it. Free units ({f}) are deducted before charging ₹{r}/unit.', { f: S().elec.freeUnits, r: S().elec.rate }),
    fields: [{ name: 'date', label: 'Reading date', type: 'date', value: today(), required: true }, ...fields],
    preview: v => {
      let tot = 0, n = 0, highWarn = [];
      for (const r of list) {
        const c = v['m_' + r.id];
        if (!isNaN(c)) {
          const l = lastMeter(r.id), units = c - (l ? l.curr : 0), on = v.date || today();
          if (units > 2000) highWarn.push(`${r.no} (${num(units)}u)`);
          if (units >= 0) {
            n++;
            // the same sharing the saved bill will use: who lived there between the two readings, and the free units for those days
            const prevDate = l ? l.date : null, occ = on > (prevDate || '') ? meterOccupants(r.id, prevDate, on) : [], ids = occ.length ? occ.map(o => o[0]) : activeRes().filter(x => x.roomId === r.id).map(x => x.id);
            tot += sum(splitElectricity(r.id, units, S().elec.rate, ids, occ.length && occ.some(o => o[1] < 1) ? occ.map(o => o[1]) : null, freeMonths(prevDate, on)), s => s.amount);
          }
        }
      }
      let txt = n ? t('{n} rooms · total bill {t}', { n, t: inr(tot) }) : '';
      if (highWarn.length) txt += ` · High: ${highWarn.join(', ')}`;
      return txt;
    },
    onSubmit: v => {
      const touched = new Set(); let n = 0;
      // check every room first, so one bad number never leaves the others half-saved
      for (const r of list) {
        const c = v['m_' + r.id]; if (isNaN(c)) continue;
        const l = lastMeter(r.id);
        if (pendingMeter(r.id)) return t('Room {r}: a reading is already waiting for your approval (Approvals). Approve or reject it first.', { r: r.no });
        if (l && c < l.curr) return t('Room {r}: reading cannot be less than previous ({p})', { r: r.no, p: num(l.curr) });
        if (l && v.date < l.date) return t('Room {r}: the date cannot be earlier than the last reading ({d})', { r: r.no, d: fmtShort(l.date) });
        if (v.date > today()) return t('The date cannot be in the future');
      }
      for (const r of list) { const c = v['m_' + r.id]; if (isNaN(c)) continue; const m = addReading({ roomId: r.id, curr: c, date: v.date }); n++; if (m.status === 'billed') m.shares.forEach(s => touched.add(s.resId)); }
      if (!n) return 'Enter at least one reading';
      closeModal(); render(); toast(t('{n} readings saved', { n }));
      return false;
    },
  });
};
// One person's electricity working for one reading: days stayed, share, free units, billable units, rate and amount.
// Used on the owner's split sheet and on the resident's own electricity sheet.
function elecShareCard(m, s, o = {}) {
  const r = resById(s.resId), rate = m.rate || S().elec.rate || 0;
  const fromDate = m.prevDate || (m.span ? addDays(m.date, -m.span) : null);
  const spanDays = m.span || (fromDate ? Math.max(1, diffDays(m.date, fromDate)) : 30);
  const co = r && r.checkIn ? r.checkIn : null, out = r && r.status === 'left' && r.left ? r.left : null;
  let stay = spanDays;
  if (co || out) { const cs = fromDate || addDays(m.date, -spanDays), a0 = co && co > cs ? co : cs, b0 = out && out < m.date ? out : m.date; stay = Math.max(1, Math.min(spanDays, diffDays(b0, a0))); }
  else if (s.weight != null) stay = Math.max(1, Math.round(s.weight * spanDays));
  const p = Math.min(100, Math.round(stay / spanDays * 100));
  const head = o.title ? `<span class="prow-ic tn3">${ico('bolt', 'sm')}</span><div><b>${esc(o.title)}</b><span>${esc(o.sub || '')}</span></div>` : `${avatar(r ? r.name : '?')}<div><b>${esc(r ? r.name : t('Resident'))}</b><span>${esc(r && r.bed ? t('Bed') + ' ' + r.bed + ' · ' : '')}${stay}/${spanDays} ${esc(t('days'))}</span></div>`;
  return `<div class="elsh"><div class="elsh-h">${head}<em>${inr(s.amount)}</em></div>
      <div class="elsh-b"><i style="width:${p}%"></i></div>
      <div class="elsh-m"><div><small>${esc(t('Share'))}</small><b>${num(s.units)}</b></div><div><small>${esc(t('Free'))}</small><b class="m-ok">${s.free ? '- ' : ''}${num(s.free)}</b></div><div><small>${esc(t('You pay for'))}</small><b>${num(s.billable)}</b></div><div><small>${esc(t('Rate'))}</small><b>x ${inr(rate)}</b></div></div>
      <div class="elsh-w">${esc(t('{u} units in the room, shared by days stayed ({s} of {t} days), minus {f} free units, charged at {r} a unit.', { u: num(m.units), s: stay, t: spanDays, f: num(s.free), r: inr(rate) }))}</div></div>`;
}
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
      if (!m.shares || !m.shares.length) {
        Store.patch(m.id, { shares, total: sum(shares, s => s.amount) });
      }
    }
  }
  shares = shares || [];

  const isAbnormal = m.units > 10000 || m.curr > 999999 || !room;
  const spanDays = m.span || (fromDate ? Math.max(1, diffDays(m.date, fromDate)) : 30);
  const freePolicyUnits = m.freeUnits ?? S().elec.freeUnits ?? 0;
  const rate = m.rate || S().elec.rate || 0;

  const total = (m.total != null && !isNaN(m.total)) ? m.total : sum(shares, s => s.amount);
  const orphanedBanner = isAbnormal
    ? `<div class="note bad" style="margin-bottom:12px"><b>${esc(t('Erroneous or Orphaned Reading'))}:</b><br>${!room ? esc(t('This reading is orphaned (room record does not exist).')) : ''}${m.units > 10000 ? esc(t('Abnormally large units: {u} units ({amt}).', { u: num(m.units), amt: inr(m.total) })) : ''}<div style="margin-top:8px"><button class="btn sm bad" data-act="meterdel" data-id="${m.id}">${ico('trash', 'sm')} ${esc(t('Delete this Invalid Reading Now'))}</button></div></div>`
    : '';
  const shareRow = s => elecShareCard(m, s);
  const sub = (a, b) => `<div><small>${esc(t(a))}</small><b>${b}</b></div>`;
  sheet(`${t('Room')} ${roomName(m.roomId)} · ${fmtDate(m.date)}`, `
    ${orphanedBanner}
    <div class="elsum">${sub('Units', num(m.units))}${sub('Rate', '₹' + rate)}${sub('Billed', inr(total))}</div>
    <div class="elrd"><span>${num(m.prev)}</span><i>→</i><span>${num(m.curr)}</span><small>${spanDays} ${esc(t('days'))} · ${esc(t('free'))} ${freePolicyUnits}/${esc(t((m.freeMode || S().elec.freeMode) === 'room' ? 'room' : 'resident'))}</small></div>
    ${shares.length ? `<div class="group-t" style="display:flex;align-items:center;gap:6px;margin-top:14px">${esc(t('Who pays what'))} · ${shares.length}<button type="button" class="ib" data-act="elecsplitinfo" aria-label="${esc(t('Split Formula'))}">i</button></div><div class="elsl">${shares.map(shareRow).join('')}</div>`
      : `<div class="note warn" style="margin-top:12px">${esc(t('No active residents in this room during this reading period. 0 units billed.'))}</div>`}
    ${m.isReplacement ? `<div class="note" style="margin-top:12px">${esc(t('Meter replaced note'))}: ${esc(m.replaceReason || 'Meter replaced/reset')}</div>` : ''}
    ${m.submittedBy || m.photo ? `<div class="muted xs" style="margin-top:12px">${m.submittedBy ? esc(t('Submitted by')) + ': ' + esc(m.submittedBy) : ''}${m.photo && !m.photoUrl ? ' · ' + esc(t('Photo audit')) + ': ' + esc(m.photo) : ''}${m.photoUrl ? `<div style="margin-top:8px"><a class="btn sm" data-docview data-name="${esc(t('Meter photo'))}" href="${esc(m.photoUrl)}" target="_blank" rel="noopener">${ico('eye', 'sm')} ${esc(t('View meter photo'))}</a></div>` : ''}</div>` : ''}
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
    note: isAbnormal ? t('This reading has abnormal or orphaned data ({amt}). Deleting it will remove all related uncollected dues.', { amt: inr(m.total) }) : '',
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
const EXP_IC = { Groceries: 'cart', 'Vegetables & milk': 'utensils', Gas: 'power', 'Electricity bill': 'bolt', Water: 'layers', Internet: 'globe', Salary: 'users', Maintenance: 'wrench', 'Cleaning supplies': 'broom', Rent: 'building' };
const expIc = c => `<span class="prow-ic ${tone(c)}">${ico(EXP_IC[c] || 'tag', 'sm')}</span>`;
PAGES.expenses = {
  title: 'Expenses', mod: 'expenses',
  render() {
    const ym = ui.flt.expm || ymOf(today()), cat = curFlt('expc', 'all');
    const all = Store.all('exp'), monthList = all.filter(x => ymOf(x.date) === ym);
    const list = monthList.filter(x => (cat === 'all' || (cat === 'credit' ? x.mode === 'credit' && !x.paid : x.cat === cat)) && needle('exp', x.cat, x.vendor, x.note)).sort(by('date', -1));
    const credit = all.filter(x => x.mode === 'credit' && !x.paid);
    const byCat = groupBy(monthList, x => x.cat), months = [...new Set([ymOf(today()), ...all.map(x => ymOf(x.date))])].sort().reverse().slice(0, 12);
    const total = sum(monthList, x => x.amount), prevYm = ymOf(addDays(ym + '-01', -1)), prev = sum(all.filter(x => ymOf(x.date) === prevYm), x => x.amount);
    const days = ym === ymOf(today()) ? +today().slice(8) : new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
    const cats = Object.entries(byCat).map(([c, xs]) => [c, sum(xs, x => x.amount)]).sort((a, b) => b[1] - a[1]);
    const chg = prev > 0 ? Math.round((total - prev) / prev * 100) : null;
    const shade = i => Math.max(.22, 1 - i * .17);
    const hero = total ? `<div class="xhero"><div class="xh-l">${esc(t('Spent in {m}', { m: fmtYM(ym) }))}</div><div class="xh-v">${inr(total)}</div>
        <div class="xh-s">${chg == null ? esc(t('{n} entries', { n: monthList.length })) : `<span class="${chg > 0 ? 'warn-t' : 'ok-t'}">${chg > 0 ? '▲' : chg < 0 ? '▼' : '='} ${Math.abs(chg)}%</span> ${esc(t('vs {m}', { m: fmtYM(prevYm).split(' ')[0] }))}`}</div>
        <div class="xbar">${cats.map(([c, v]) => `<i class="${tone(c)}" style="flex:${v}" title="${esc(t(c))}"></i>`).join('')}</div></div>` : '';
    const stats = `<div class="pstats">${kpi('Paid', inr(sum(monthList.filter(x => x.mode === 'cash' || x.paid), x => x.amount)), t('{n} entries', { n: monthList.length }), '', null, 'wallet')}${kpi('On credit (unpaid)', inr(sum(credit, x => x.amount)), t('{n} bills', { n: credit.length }), credit.length ? 'warn' : '', null, 'clock')}${kpi('Per day', inr(Math.round(total / Math.max(1, days))), t('average'), '', null, 'chart')}</div>`;
    const breakdown = cats.length > 1 ? `<div class="group-t">${esc(t('Where the money went'))}</div><div class="group">${cats.map(([c, v]) => prow({
      act: 'expcat', attrs: `data-c="${esc(c)}"`, lead: expIc(c), t: esc(t(c)),
      s: `<span class="xbl"><i class="${tone(c)}" style="width:${Math.max(3, Math.round(v / cats[0][1] * 100))}%"></i></span>`, amt: inr(v), ms: pct(v, total) + '%'
    })).join('')}</div>` : '';
    const rows = list.length ? `<div class="group">${list.map(x => prow({
      act: 'editexp', attrs: `data-id="${x.id}"`, lead: expIc(x.cat), t: esc(t(x.cat)),
      s: esc([fmtShort(x.date), x.vendor, x.note].filter(Boolean).join(' · ')),
      tags: x.mode === 'credit' ? (x.paid ? badge('Credit · paid', 'ok') : `${badge('Unpaid credit', 'warn')}${pillb('Mark paid', 'exppaid', `data-id="${x.id}"`, 'ok')}`) : '', amt: inr(x.amount)
    })).join('')}</div>` : '';
    return `${head('Expenses', '', btn('Add expense', 'addexp', '', 'primary', 'plus'))}
      ${hero}${monthList.length || credit.length ? stats : ''}${breakdown}
      <div class="tool"><select class="hsel" data-flt="expm" aria-label="${esc(t('Month'))}">${months.map(m => `<option value="${m}" ${m === ym ? 'selected' : ''}>${fmtYM(m)}</option>`).join('')}</select>${searchBox('exp', 'Search vendor or note')}</div>
      <div class="tool">${chips('expc', [['all', 'All'], ['credit', 'Unpaid credit'], ...S().expenseCats.filter(c => byCat[c]).map(c => [c, c])], 'all')}</div>
      ${rows || `<div class="card">${empty('No expenses', 'Add your first expense for this month.')}</div>`}`;
  },
};
// Tapping a category shows its entries right there, in a sheet, instead of changing a list far below.
A.expcat = el => {
  const c = el.dataset.c, ym = ui.flt.expm || ymOf(today());
  const list = Store.all('exp').filter(x => ymOf(x.date) === ym && x.cat === c).sort(by('date', -1));
  const total = sum(list, x => x.amount);
  sheet(`${t(c)} · ${fmtYM(ym)}`, `<div class="xcs"><div class="xcs-v">${inr(total)}</div><div class="xcs-s">${esc(list.length === 1 ? t('1 entry') : t('{n} entries', { n: list.length }))}</div></div>
    <div class="group">${list.map(x => prow({ act: 'editexp', attrs: `data-id="${x.id}"`, lead: expIc(x.cat), t: esc([x.vendor, x.note].filter(Boolean).join(' · ') || t(x.cat)),
      s: esc(fmtShort(x.date) + (x.mode === 'credit' ? ' · ' + (x.paid ? t('Credit · paid') : t('Unpaid credit')) : '')), amt: inr(x.amount) })).join('')}</div>`,
    { foot: `<button class="btn block" type="button" data-act="flt" data-key="expc" data-v="${esc(c)}">${esc(t('Show only this on the page'))}</button>` });
};
function expenseForm(x) {
  const e = x || {};
  formModal({
    title: x ? 'Edit expense' : 'Add expense',
    fields: [
      { name: 'cat', label: 'Category', type: 'select', options: S().expenseCats.map(c => ({ v: c, l: t(c) })), value: e.cat, required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', min: 1, max: 10000000, value: e.amount, required: true },
      { name: 'date', label: 'Date', type: 'date', value: e.date || today(), required: true }, { name: 'mode', label: 'Payment', type: 'select', info: t('Cash / paid now is counted as spent today. Credit means the bill is pending - it shows under Unpaid credit until you mark it paid.'), options: [{ v: 'cash', l: t('Cash / paid now') }, { v: 'credit', l: t('Credit (pay later)') }], value: e.mode || 'cash' },
      { name: 'vendor', label: 'Vendor / shop', value: e.vendor, maxlength: 80 }, { name: 'note', label: 'Note', value: e.note, maxlength: 200 },
    ],
    danger: x ? { label: 'Delete', run: () => confirmBox(t('Delete this expense?'), () => { Store.remove(e.id); toast('Deleted'); }, 'Delete', 'bad') } : null,
    onSubmit: v => {
      if (v.date > today()) return t('The date cannot be in the future');
      Store.put('exp', { ...e, cat: v.cat, amount: v.amount, date: v.date, mode: v.mode, paid: v.mode === 'cash' ? true : e.paid || false, vendor: v.vendor, note: v.note });
      toast('Expense saved');
    },
  });
}
A.addexp = () => expenseForm();
A.editexp = el => {
  const x = Store.get(el.dataset.id);
  // salary, advance and purchase expenses are written by Staff & Salary / Stock & Purchase; changing them here would put the two books out of step
  if (x && x.ref) return toast(t('This entry was created automatically (salary / purchase). Change or reverse it where it was made, so the books stay in step.'), 'warn');
  expenseForm(x);
};
A.exppaid = el => { Store.patch(el.dataset.id, { paid: true, paidOn: today() }); toast('Marked paid'); render(); };

/* ===================================================================== reports */
// One period for the whole page and for every download below it.
const repNow = () => repRange(ui.flt.repk || 'this_month', ui.flt.repf, ui.flt.rept);

/* ===================================================================== insights (inside Reports) */
const svgEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const insShort = v => (Math.abs(v) >= 10000000 ? (v / 10000000).toFixed(1) + 'Cr' : Math.abs(v) >= 100000 ? (v / 100000).toFixed(1) + 'L' : Math.abs(v) >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(Math.round(v)));
const INS_COL = { inc: '#30b567', exp: '#ff9f0a', pro: '#0a84ff', neg: '#ff453a', now: '#9aa3b2' };
let insGid = 0;
// Monthly trend: income + expense bars with gradient, profit line with soft area. Works for 3, 6 or 12 months.
function insightChart(months) {
  const g = 'ig' + (++insGid), W = (window.innerWidth < 600 ? 380 : 680), H = 270, pl = 50, pr = 14, pt = 22, pb = 34, n = months.length || 1;
  const mx = Math.max(1, ...months.map(m => Math.max(m.income, m.expense, m.profit)));
  const mn = Math.min(0, ...months.map(m => m.profit));
  const span = (mx - mn) || 1, y = v => pt + (H - pt - pb) * (1 - (v - mn) / span), bw = (W - pl - pr) / n, barw = Math.max(5, Math.min(30, bw * .32));
  const grid = [0, .25, .5, .75, 1].map(f => { const v = mn + span * f; return `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1" ${f === 0 || f === 1 ? '' : 'stroke-dasharray="3 4"'}/><text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--mute,#8a8a8e)">${insShort(v)}</text>`; }).join('');
  const zero = mn < 0 ? `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" stroke="var(--mute,#8a8a8e)" stroke-width="1.2"/>` : '';
  const bars = months.map((m, i) => {
    const cx = pl + i * bw + bw / 2, x1 = cx - barw - 1.5, x2 = cx + 1.5, op = m.partial ? .5 : 1;
    const lab = n <= 6 ? `<text x="${x1 + barw / 2}" y="${y(m.income) - 5}" text-anchor="middle" font-size="10" fill="var(--mute,#8a8a8e)">${insShort(m.income)}</text>` : '';
    const mname = fmtYM(m.ym).split(' ')[0], showYear = n > 6 && (i === 0 || m.ym.slice(5) === '01');
    return `<rect x="${x1}" y="${y(m.income)}" width="${barw}" height="${Math.max(0, y(0) - y(m.income))}" rx="${Math.min(6, barw / 2)}" fill="url(#${g}i)" opacity="${op}"><title>${svgEsc(fmtYM(m.ym))} · ${svgEsc(t('Income'))} ${svgEsc(inr(m.income))}</title></rect>
      <rect x="${x2}" y="${y(m.expense)}" width="${barw}" height="${Math.max(0, y(0) - y(m.expense))}" rx="${Math.min(6, barw / 2)}" fill="url(#${g}e)" opacity="${op}"><title>${svgEsc(fmtYM(m.ym))} · ${svgEsc(t('Expenses'))} ${svgEsc(inr(m.expense))}</title></rect>${lab}
      <text x="${cx}" y="${H - 14}" text-anchor="middle" font-size="${n > 6 ? 10 : 11.5}" fill="var(--mute,#8a8a8e)">${svgEsc(mname)}${m.partial ? '*' : ''}</text>${showYear ? `<text x="${cx}" y="${H - 2}" text-anchor="middle" font-size="9" fill="var(--mute,#8a8a8e)">${svgEsc(fmtYM(m.ym).split(' ')[1] || '')}</text>` : ''}`;
  }).join('');
  const pts = months.map((m, i) => [pl + i * bw + bw / 2, y(m.profit)]);
  const area = pts.length > 1 ? `<polygon points="${pts.map(p => p.join(',')).join(' ')} ${pts[pts.length - 1][0]},${y(0)} ${pts[0][0]},${y(0)}" fill="url(#${g}p)"/>` : '';
  const line = `<polyline fill="none" stroke="${INS_COL.pro}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p => p.join(',')).join(' ')}"/>` + pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${n > 6 ? 3.2 : 4}" fill="var(--surface,#fff)" stroke="${months[i].profit < 0 ? INS_COL.neg : INS_COL.pro}" stroke-width="2.2"><title>${svgEsc(fmtYM(months[i].ym))} · ${svgEsc(t('Profit'))} ${svgEsc(inr(months[i].profit))}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('Income, expenses and profit by month'))}" style="width:100%;height:auto;display:block">
    <defs><linearGradient id="${g}i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4cd987"/><stop offset="1" stop-color="#22a35a"/></linearGradient>
    <linearGradient id="${g}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc15a"/><stop offset="1" stop-color="#f08a00"/></linearGradient>
    <linearGradient id="${g}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${INS_COL.pro}" stop-opacity=".22"/><stop offset="1" stop-color="${INS_COL.pro}" stop-opacity="0"/></linearGradient></defs>${grid}${zero}${area}${bars}${line}</svg>
    <div class="row wrap xs muted" style="gap:14px;margin-top:6px"><span><i class="lg" style="background:${INS_COL.inc}"></i> ${esc(t('Income'))}</span><span><i class="lg" style="background:${INS_COL.exp}"></i> ${esc(t('Expenses'))}</span><span><i class="lg ln" style="background:${INS_COL.pro}"></i> ${esc(t('Profit'))}</span><span>* ${esc(t('month still running'))}</span></div>`;
}
// What-if charts: (1) this month, now vs scenario; (2) profit added up over the next 12 months, now vs scenario.
function scnCharts(I, s) {
  const W = (window.innerWidth < 600 ? 380 : 680), H1 = 210, pl = 52, pr = 12, pt = 22, pb = 30;
  const groups = [[t('Income'), I.avgIncome, s.income, INS_COL.inc], [t('Costs'), I.avgExpense, s.expense, INS_COL.exp], [t('Profit'), I.avgProfit, s.profit, s.profit >= 0 ? INS_COL.pro : INS_COL.neg]];
  const mx = Math.max(1, ...groups.flatMap(x => [x[1], x[2]])), mn = Math.min(0, ...groups.flatMap(x => [x[1], x[2]]));
  const span = (mx - mn) || 1, y = v => pt + (H1 - pt - pb) * (1 - (v - mn) / span), gw = (W - pl - pr) / groups.length, bw = Math.min(54, gw * .3);
  const grid = [0, .5, 1].map(f => { const v = mn + span * f; return `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" ${f === 0 || f === 1 ? '' : 'stroke-dasharray="3 4"'}/><text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--mute,#8a8a8e)">${insShort(v)}</text>`; }).join('');
  const bars = groups.map(([l, a, b, col], i) => { const cx = pl + i * gw + gw / 2, xa = cx - bw - 3, xb = cx + 3;
    const bar = (x, v, fill, op) => `<rect x="${x}" y="${Math.min(y(v), y(0))}" width="${bw}" height="${Math.abs(y(v) - y(0))}" rx="7" fill="${fill}" opacity="${op}"/><text x="${x + bw / 2}" y="${(v >= 0 ? y(v) - 6 : y(v) + 15)}" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--ink,#111)">${insShort(v)}</text>`;
    return `${bar(xa, a, INS_COL.now, .55)}${bar(xb, b, col, 1)}<text x="${cx}" y="${H1 - 9}" text-anchor="middle" font-size="12" fill="var(--mute,#8a8a8e)">${svgEsc(l)}</text>`; }).join('');
  const c1 = `<svg viewBox="0 0 ${W} ${H1}" role="img" aria-label="${esc(t('Monthly figures now and in the scenario'))}" style="width:100%;height:auto;display:block">${grid}${bars}</svg>
    <div class="row wrap xs muted" style="gap:14px;margin-top:4px"><span><i class="lg" style="background:${INS_COL.now}"></i> ${esc(t('Now'))}</span><span><i class="lg" style="background:${INS_COL.pro}"></i> ${esc(t('With your changes'))}</span></div>`;
  // 12-month running profit
  const H2 = 190, pts0 = [], pts1 = []; for (let m = 0; m <= 12; m++) { pts0.push(I.avgProfit * m); pts1.push(s.profit * m); }
  const lo = Math.min(0, ...pts0, ...pts1), hi = Math.max(1, ...pts0, ...pts1), sp2 = (hi - lo) || 1, x = m => pl + (W - pl - pr) * m / 12, y2 = v => pt + (H2 - pt - pb) * (1 - (v - lo) / sp2);
  const g2 = [0, .5, 1].map(f => { const v = lo + sp2 * f; return `<line x1="${pl}" x2="${W - pr}" y1="${y2(v)}" y2="${y2(v)}" stroke="var(--line)" ${f === 0 || f === 1 ? '' : 'stroke-dasharray="3 4"'}/><text x="${pl - 8}" y="${y2(v) + 4}" text-anchor="end" font-size="11" fill="var(--mute,#8a8a8e)">${insShort(v)}</text>`; }).join('');
  const poly = (arr, col, w, dash) => `<polyline fill="none" stroke="${col}" stroke-width="${w}" ${dash ? 'stroke-dasharray="6 5"' : ''} stroke-linecap="round" points="${arr.map((v, m) => x(m) + ',' + y2(v)).join(' ')}"/>`;
  const gain = pts1[12] - pts0[12];
  const area = `<polygon points="${pts1.map((v, m) => x(m) + ',' + y2(v)).join(' ')} ${[...pts0].reverse().map((v, k) => x(12 - k) + ',' + y2(v)).join(' ')}" fill="${gain >= 0 ? INS_COL.inc : INS_COL.neg}" opacity=".13"/>`;
  const labs = [0, 3, 6, 9, 12].map(m => `<text x="${x(m)}" y="${H2 - 9}" text-anchor="${m === 12 ? 'end' : m === 0 ? 'start' : 'middle'}" font-size="11" fill="var(--mute,#8a8a8e)">${m === 0 ? t('Now') : t('{n} mo', { n: m })}</text>`).join('');
  const c2 = `<svg viewBox="0 0 ${W} ${H2}" role="img" aria-label="${esc(t('Profit added up over 12 months'))}" style="width:100%;height:auto;display:block">${g2}${area}${poly(pts0, INS_COL.now, 2.4, true)}${poly(pts1, gain >= 0 ? INS_COL.inc : INS_COL.neg, 3)}<circle cx="${x(12)}" cy="${y2(pts1[12])}" r="4.5" fill="${gain >= 0 ? INS_COL.inc : INS_COL.neg}"/><text x="${x(12) - 6}" y="${y2(pts1[12]) - 10}" text-anchor="end" font-size="12" font-weight="700" fill="var(--ink,#111)">${insShort(pts1[12])}</text>${labs}</svg>
    <div class="row wrap xs muted" style="gap:14px;margin-top:4px"><span><i class="lg ln" style="background:${INS_COL.now}"></i> ${esc(t('If nothing changes'))}</span><span><i class="lg ln" style="background:${gain >= 0 ? INS_COL.inc : INS_COL.neg}"></i> ${esc(t('With your changes'))}</span><span><b class="${gain >= 0 ? 'ok-t' : 'bad-t'}">${gain >= 0 ? '+' : '-'}${inr(Math.abs(gain))}</b> ${esc(t('over 12 months'))}</span></div>`;
  return `<div class="grid g2" style="gap:14px;margin-top:14px"><div><div class="xs muted" style="font-weight:600;margin-bottom:4px">${esc(t('One month: now vs your changes'))}</div>${c1}</div><div><div class="xs muted" style="font-weight:600;margin-bottom:4px">${esc(t('Profit added up over the next 12 months'))}</div>${c2}</div></div>`;
}
const insCostRow = (c, maxCost) => `<div style="margin:9px 0"><div class="row sb" style="gap:8px"><span class="ell">${esc(t(c.cat))}</span><span><b>${inr(c.last)}</b> <span class="muted xs">${c.share}%</span>${c.change != null && Math.abs(c.change) >= 10 ? ` <span class="${c.change > 0 ? 'bad-t' : 'ok-t'} xs">${c.change > 0 ? '▲' : '▼'} ${Math.abs(c.change)}%</span>` : ''}</span></div><div style="height:6px;border-radius:4px;background:var(--subtle,#eee);margin-top:4px"><div style="height:100%;width:${Math.round(100 * c.last / maxCost)}%;border-radius:4px;background:var(--accent-solid)"></div></div></div>`;
// Sliders are always symmetric, so zero sits in the middle. "Percent" or an absolute amount (beds / rupees).
const scnMode = () => (window.__scnMode === 'abs' ? 'abs' : 'pct');
function scnSpec(I) {
  if (scnMode() === 'pct') return [['occ', 'Occupancy change', -30, 30, 1, 'pct'], ['rent', 'Rent change', -30, 30, 1, 'pct'], ['cost', 'Cost change', -30, 30, 1, 'pct']];
  const nb = Math.max(2, Math.round((I.occ.total || 10) * .3)), rr = Math.max(500, Math.round((I.rentPerBed || 5000) * .3 / 100) * 100), cr = Math.max(2000, Math.round((I.avgExpense || 20000) * .3 / 1000) * 1000);
  return [['occ', 'Beds filled (more / fewer)', -nb, nb, 1, 'beds'], ['rent', 'Rent per bed (₹)', -rr, rr, 100, 'rs'], ['cost', 'Monthly costs (₹)', -cr, cr, 500, 'rs']];
}
const scnFmt = (v, u) => (v > 0 ? '+' : v < 0 ? '-' : '') + (u === 'pct' ? Math.abs(v) + '%' : u === 'beds' ? Math.abs(v) + ' ' + t('beds') : inr(Math.abs(v)));
function insightsView() {
  const nMonths = +curFlt('insp', '6') || 6;
  const I = bizInsights(nMonths);
  window.__insights = I;
  const tone = { ok: 'ok-t', warn: 'warn-t', bad: 'bad-t', info: 'muted' };
  const icon = { ok: 'check', warn: 'alert', bad: 'alert', info: 'info' };
  const fc = I.forecast, maxCost = Math.max(1, ...I.costRows.map(c => c.last)), scn = scenarioCalc(I, {});
  const watch = I.notes.filter(n => n.tone === 'warn' || n.tone === 'bad').length, good = I.notes.filter(n => n.tone === 'ok').length;
  const h3 = (title, hint) => `<h3 class="row nw" style="align-items:center;gap:4px;margin-bottom:8px">${esc(t(title))}${hint ? tip(esc(t(hint))) : ''}</h3>`;
  return `<div class="grid g4 keep2">${kpi('Avg monthly income', inr(I.avgIncome), t('last 3 full months'), 'ok', null, 'rupee')}${kpi('Avg monthly costs', inr(I.avgExpense), t('last 3 full months'), 'warn', null, 'wallet')}${kpi('Avg monthly profit', inr(I.avgProfit), t('{m}% margin', { m: I.margin }), I.avgProfit < 0 ? 'bad' : 'ok', null, 'chart')}${kpi('Occupancy', I.occ.pct + '%', t('{o} of {n} beds', { o: I.occ.occ, n: I.occ.total }), I.occ.pct < 70 ? 'warn' : 'ok', null, 'bed')}</div>
    <div class="card ins-notes" style="margin-top:14px"><button type="button" class="ins-head" data-act="insnotes" aria-expanded="false"><span class="ins-title">${esc(t('What this means for you'))}</span><span class="ins-sum">${watch ? `<span class="badge warn">${watch} ${esc(t('to look at'))}</span>` : ''}${good ? `<span class="badge ok">${good} ${esc(t('good'))}</span>` : ''}</span><span class="ins-chev">${ico('chev', 'sm')}</span></button>
      <div class="ins-body" hidden>${I.notes.map(n => `<div class="row nw" style="gap:10px;align-items:flex-start;margin:10px 0"><span class="${tone[n.tone]}" style="flex:none;margin-top:2px">${ico(icon[n.tone] || 'info', 'sm')}</span><span style="line-height:1.45">${esc(n.text)}</span></div>`).join('')}</div></div>
    <div class="card" style="margin-top:14px"><div class="row sb wrap" style="gap:8px;align-items:center;margin-bottom:8px">${h3('Monthly trend', 'Income and expenses are the bars, profit is the line. The month still running is shown lighter. Pick how far back to look.')}${chips('insp', [['3', 'Quarter'], ['6', 'Half year'], ['12', 'Year']], '6')}</div>${insightChart(I.months)}</div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card">${h3('Where the money goes', 'Last full month, compared with the usual level.')}
        ${I.costRows.length ? `${I.costRows.slice(0, 6).map(c => insCostRow(c, maxCost)).join('')}${I.costRows.length > 6 ? `<div class="fold-more" hidden>${I.costRows.slice(6).map(c => insCostRow(c, maxCost)).join('')}</div><button type="button" class="btn sm ghost block" data-act="foldmore" data-all="${esc(t('View all ({n})', { n: I.costRows.length }))}" data-less="${esc(t('Show less'))}">${esc(t('View all ({n})', { n: I.costRows.length }))}</button>` : ''}` : `<div class="muted">${esc(t('No expenses in the last full month.'))}</div>`}</div>
      <div class="card">${h3('Next 3 months (forecast)', 'A straight-line projection of your recent months. It is a guide, not a promise.')}
        <table class="tbl nw-tbl" style="width:100%;font-size:13px"><thead><tr><th style="text-align:left">${esc(t('Month'))}</th><th style="text-align:right">${esc(t('Income'))}</th><th style="text-align:right">${esc(t('Costs'))}</th><th style="text-align:right">${esc(t('Profit'))}</th></tr></thead><tbody>${fc.map(f => `<tr><td>${esc(fmtYM(f.ym))}</td><td style="text-align:right">${inr(f.income)}</td><td style="text-align:right">${inr(f.expense)}</td><td style="text-align:right" class="${f.profit < 0 ? 'bad-t' : 'ok-t'}"><b>${inr(f.profit)}</b></td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="card" style="margin-top:14px"><div class="row sb nw" style="align-items:center">${h3('What if...? (scenario planner)', t('Move the sliders to see monthly profit change. Costs are treated as {f}% fixed and the rest moves with occupied beds.', { f: Math.round(I.fixedShare * 100) }))}<button type="button" class="btn sm ghost" data-act="scnreset">${ico('repeat', 'sm')} ${esc(t('Reset'))}</button></div>
      <div class="seg scn-mode" role="tablist">${[['pct', 'Percent'], ['abs', 'Amount']].map(([m, l]) => `<button type="button" role="tab" class="${scnMode() === m ? 'on' : ''}" aria-selected="${scnMode() === m}" data-act="scnmode" data-m="${m}">${esc(t(l))}</button>`).join('')}</div>
      <div class="grid g3" style="gap:6px 22px">
        ${scnSpec(I).map(([k, l, a, b, st, u]) => `<div class="scn"><div class="row sb nw"><span class="scn-l">${esc(t(l))}</span><b class="scn-v" id="scn_${k}_v">0</b></div><input class="scn-range" type="range" min="${a}" max="${b}" step="${st}" value="0" data-scn="${k}" data-u="${u}" aria-label="${esc(t(l))}" style="--l:50%;--r:50%"><div class="scn-ends"><span>${scnFmt(a, u)}</span><span>0</span><span>${scnFmt(b, u)}</span></div></div>`).join('')}
      </div>
      <div class="grid g3 keep2" style="margin-top:12px">
        <div class="kpi"><div class="l">${esc(t('Monthly income'))}</div><div class="v" id="scn_inc">${inr(scn.income)}</div><div class="s" id="scn_beds">${scn.beds} ${esc(t('beds'))}</div></div>
        <div class="kpi"><div class="l">${esc(t('Monthly costs'))}</div><div class="v" id="scn_exp">${inr(scn.expense)}</div><div class="s">&nbsp;</div></div>
        <div class="kpi"><div class="l">${esc(t('Monthly profit'))}</div><div class="v" id="scn_pro">${inr(scn.profit)}</div><div class="s" id="scn_diff">${esc(t('same as now'))}</div></div>
      </div>
      <p class="scn-say" id="scn_say"></p>
      <div id="scn_charts">${scnCharts(I, scn)}</div></div>
    ${about('Based on payments, expenses and occupancy already recorded. Nothing here changes your data.')}`;
}
function scnApply() {
  const I = window.__insights; if (!I) return;
  const v = { occ: 0, rent: 0, cost: 0 };
  document.querySelectorAll('[data-scn]').forEach(x => {
    const val = +x.value || 0, a = +x.min, b = +x.max, u = x.dataset.u;
    v[x.dataset.scn] = u === 'pct' ? val : x.dataset.scn === 'occ' ? (I.occ.occ ? 100 * val / I.occ.occ : 0) : x.dataset.scn === 'rent' ? (I.rentPerBed ? 100 * val / I.rentPerBed : 0) : (I.avgExpense ? 100 * val / I.avgExpense : 0);
    const pct = 100 * (val - a) / (b - a), z = 100 * (0 - a) / (b - a);
    x.style.setProperty('--l', Math.min(pct, z) + '%'); x.style.setProperty('--r', Math.max(pct, z) + '%');
    x.classList.toggle('neg', x.dataset.scn === 'cost' ? val > 0 : val < 0);
    const lbl = document.getElementById('scn_' + x.dataset.scn + '_v'); if (lbl) lbl.textContent = val === 0 ? '0' : scnFmt(val, u);
  });
  const s = scenarioCalc(I, v), set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const diff = s.profit - I.avgProfit;
  set('scn_inc', inr(s.income)); set('scn_exp', inr(s.expense)); set('scn_pro', inr(s.profit)); set('scn_beds', s.beds + ' ' + t('beds'));
  set('scn_diff', diff === 0 ? t('same as now') : (diff > 0 ? '+' : '-') + inr(Math.abs(diff)) + ' ' + t('vs now'));
  set('scn_say', diff === 0 ? '' : diff > 0 ? t('This change would add about {a} to your yearly profit.', { a: inr(diff * 12) }) : t('This change would cost about {a} a year.', { a: inr(-diff * 12) }));
  const ch = document.getElementById('scn_charts'); if (ch) ch.innerHTML = scnCharts(I, s);
}
document.addEventListener('input', e => { if (e.target && e.target.dataset && e.target.dataset.scn) scnApply(); });
A.scnmode = el => { window.__scnMode = el.dataset.m; render(); };
A.scnreset = () => { document.querySelectorAll('[data-scn]').forEach(x => { x.value = 0; }); scnApply(); };
A.insnotes = el => { const open = el.getAttribute('aria-expanded') !== 'true'; el.setAttribute('aria-expanded', open); const b = el.parentNode.querySelector('.ins-body'); if (b) b.hidden = !open; el.closest('.ins-notes').classList.toggle('open', open); };
A.foldmore = el => { const box = el.previousElementSibling; if (!box) return; box.hidden = !box.hidden; el.textContent = box.hidden ? el.dataset.all : el.dataset.less; };
PAGES.reports = {
  title: 'Reports', mod: 'reports',
  render() {
    if (curTab('rep', 'report') === 'insights') return `${head('Reports', t('Insights, forecast and what-if'))}${seg('rep', [['report', 'Totals'], ['insights', 'Insights']], 'report')}${insightsView()}`;
    const R = repNow(), bl = blockScope();
    const pays = payments().filter(p => repIn(p.date, R) && p.mode !== 'deposit'), exps = Store.all('exp').filter(x => repIn(x.date, R));
    const bills = invoices().filter(i => i.type !== 'deposit' && repIn(i.date, R));
    const billed = sum(bills, i => i.amount), collectedOfBilled = sum(bills, i => i.paid || 0);
    const income = sum(pays, p => p.amount), spend = sum(exps, x => x.amount);
    const byType = groupBy(bills, i => i.type), byCat = groupBy(exps, x => x.cat), byMode = groupBy(pays, p => p.mode);
    const rows = (obj, f) => Object.entries(obj).sort((a, b) => f(b[1]) - f(a[1])).map(([k, v]) => `<dt>${esc(t(INV_TYPES[k] || k))}</dt><dd>${inr(f(v))}</dd>`).join('') || `<dt class="muted">${esc(t('Nothing yet'))}</dt><dd></dd>`;
    return `${head('Reports', `${esc(R.label)}${bl ? ' · ' + esc(blockName(bl)) : ''}`)}${seg('rep', [['report', 'Totals'], ['insights', 'Insights']], 'report')}
      <div class="repbar"><b>${esc(t('Period'))}</b>
        <select class="hsel" data-flt="repk" aria-label="${esc(t('Period'))}">${repPresets().map(p => `<option value="${p.k}" ${p.k === R.key ? 'selected' : ''}>${esc(t(p.l))}</option>`).join('')}</select>
        ${R.key === 'custom' ? `<input type="date" value="${R.from}" data-flt="repf" aria-label="${esc(t('From'))}"><span>${esc(t('to'))}</span><input type="date" value="${R.to}" data-flt="rept" aria-label="${esc(t('To'))}">` : ''}${tip(esc(t('Every report and download on this page uses this period.')))}
      </div>
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
      { name: 'ym', label: 'Select Reporting Month', type: 'select', options: monthOpts(ym), value: ym, required: true }
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
/* Notices: phone-notification style cards. Swipe a card sideways and it flies off and collapses (delete, with a few
 * seconds to undo). The buttons are still there for anyone who prefers tapping. */
const relDay = d => { const n = Math.round((parse(today()) - parse(d)) / 864e5); return n <= 0 ? t('Today') : n === 1 ? t('Yesterday') : n < 7 ? t('{n} days ago', { n }) : fmtShort(d); };
// Kinds of notice: the words in it decide the colour and icon, so a glance tells water-off from rent-due.
const NT_KINDS = [
  ['Important', /rule|warning|important|strict|curfew|gate|police|urgent|fine|penalty|last date|deadline/i, 'bad', 'alert'],
  ['Payment', /rent|fee|pay|due|bill|₹|deposit|receipt|refund/i, 'ok', 'rupee'],
  ['Maintenance', /water|tank|power|light|electric|lift|wifi|wi-fi|repair|maintenance|clean|pest|plumb|off from|shut/i, 'warn', 'wrench'],
  ['Mess', /mess|food|meal|menu|dinner|lunch|breakfast|tiffin|kitchen|party|festival/i, 'info', 'utensils'],
];
const ntKind = n => { const x = `${n.title} ${n.body || ''}`; const k = NT_KINDS.find(z => z[1].test(x)); return k ? { l: k[0], c: k[2], i: k[3] } : { l: 'General', c: 'acc', i: 'megaphone' }; };
// Ready-made notices: one tap fills the form, the owner only adjusts the details.
const NT_TPL = [
  ['Water supply off', 'Water supply will be off tomorrow from 10 AM to 1 PM for tank cleaning. Please store water in advance.', 'droplet'],
  ['Power cut', 'There will be a power cut today from 2 PM to 4 PM for maintenance work. Please charge your phones early.', 'bolt'],
  ['Rent reminder', 'This month\'s rent is due by the 5th. Please pay on time to avoid a late fee.', 'rupee'],
  ['Mess timing', 'Mess timings are changing from tomorrow. Please check the new timings in the Meals section.', 'utensils'],
  ['Special dinner', 'A special dinner is planned this Sunday. Please skip or confirm your meal in the app.', 'star'],
  ['Cleaning day', 'Deep cleaning of all rooms will be done on Saturday. Please keep your valuables safe.', 'broom'],
  ['Rules reminder', 'Please follow the hostel rules: gate closes at 10 PM, no loud music after 10 PM, keep common areas clean.', 'shield'],
  ['Holiday', 'The hostel office will be closed on the public holiday. For emergencies call the warden.', 'cal'],
];
PAGES.notices = {
  title: 'Notices', mod: 'notices',
  render() {
    const all = Store.all('notice').slice().sort((a, b) => (b.pinned - a.pinned) || (b.date > a.date ? 1 : -1)), wk = addDays(today(), -6);
    const pins = all.filter(n => n.pinned), thisWk = all.filter(n => n.date >= wk), fl = curFlt('ntf', 'all');
    const list = all.filter(n => fl === 'all' || (fl === 'pinned' ? n.pinned : fl === 'week' ? n.date >= wk : n.date < wk));
    const tpl = `<div class="nt-tpl"><b>${esc(t('Quick post'))}</b><div class="nt-tpl-r">${NT_TPL.map((x, i) => `<button type="button" class="nt-chip" data-act="addnotice" data-tpl="${i}">${ico(x[2], 'xs')}<span>${esc(t(x[0]))}</span></button>`).join('')}</div></div>`;
    const hero = `<section class="nt-hero"><div class="nt-hero-ic">${ico('megaphone')}</div><div class="nt-hero-t"><h2>${esc(t('Notice board'))}</h2><p>${all.length ? esc(t(all.length === 1 ? '1 notice · {r} residents see it in their app' : '{n} notices · {r} residents see them in their app', { n: all.length, r: activeRes().length })) : esc(t('Post a notice and every resident sees it in the app'))}</p>
      <div class="nt-hero-st"><span>${ico('bookmark', 'xs')} ${pins.length} ${esc(t('pinned'))}</span><span>${ico('cal', 'xs')} ${thisWk.length} ${esc(t('this week'))}</span></div></div>${btn('New notice', 'addnotice', '', 'nt-new', 'plus')}</section>`;
    const card = n => {
      const k = ntKind(n), long = String(n.body || '').length > 150;
      return `<div class="swp-wrap dual" data-swact="swnotice" data-swright="noticeedit" data-swleft="noticedel" data-id="${esc(n.id)}"><div class="swp-bg"><span>${ico('edit', 'sm')} ${esc(t('Edit'))}</span><span>${esc(t('Delete'))} ${ico('trash', 'sm')}</span></div>
        <article class="swp nt nk-${k.c} ${n.pinned ? 'is-pin' : ''}"><i class="nt-bar"></i>
          <div class="nt-top"><span class="nt-ic">${ico(k.i, 'sm')}</span><div class="nt-meta"><span class="nt-cat">${esc(t(k.l))}</span><span class="nt-date">${esc(relDay(n.date))}</span></div>${n.pinned ? `<span class="nt-pin">${ico('bookmark', 'xs')} ${esc(t('Pinned'))}</span>` : ''}</div>
          <h3 class="nt-t">${esc(n.title)}</h3><p class="nt-b">${esc(n.body || '')}</p>${long ? `<button type="button" class="nt-more" data-act="ntexp">${esc(t('Read more'))}</button>` : ''}
          <div class="nt-acts">
            <button type="button" class="nt-mail" data-act="noticewa" data-id="${esc(n.id)}">${ico('mail', 'sm')}<span>${esc(t('E-mail all'))}</span></button>
            <span class="nt-ic-row">
              <button type="button" class="nt-i ${n.pinned ? 'on' : ''}" data-act="noticepin" data-id="${esc(n.id)}" aria-label="${esc(t(n.pinned ? 'Unpin' : 'Pin'))}" title="${esc(t(n.pinned ? 'Unpin' : 'Pin'))}">${ico('bookmark', 'sm')}</button>
              <button type="button" class="nt-i" data-act="noticeedit" data-id="${esc(n.id)}" aria-label="${esc(t('Edit'))}" title="${esc(t('Edit'))}">${ico('edit', 'sm')}</button>
              <button type="button" class="nt-i del" data-act="noticedel" data-id="${esc(n.id)}" aria-label="${esc(t('Delete'))}" title="${esc(t('Delete'))}">${ico('trash', 'sm')}</button>
            </span>
          </div></article></div>`;
    };
    return `${head('Notices', '')}${hero}${tpl}
      ${all.length ? `<div class="chips nt-flt">${[['all', 'All', all.length], ['pinned', 'Pinned', pins.length], ['week', 'This week', thisWk.length], ['old', 'Older', all.length - thisWk.length]].map(([k, l, n]) => `<button class="chip ${fl === k ? 'on' : ''}" data-act="flt" data-key="ntf" data-v="${k}">${esc(t(l))} <span class="chip-n">${n}</span></button>`).join('')}</div>
        ${about('Swipe a notice right to edit it, or left to delete it (you are asked first).')}
        <div class="swp-list nt-list">${list.map(card).join('') || `<div class="card muted">${esc(t('Nothing in this filter.'))}</div>`}</div>`
      : `<div class="card">${empty('No notices yet', 'Tap a quick post above, or write your own.')}</div>`}`;
  },
};
A.ntexp = el => { const c = el.closest('.nt'); if (!c) return; const on = c.classList.toggle('open'); el.textContent = t(on ? 'Show less' : 'Read more'); };
A.noticepin = el => { const n = Store.get(el.dataset.id); if (!n) return; Store.patch(n.id, { pinned: !n.pinned }); toast(t(n.pinned ? 'Unpinned' : 'Pinned on top')); render(); };
A.noticeedit = el => { const n = Store.get(el.dataset.id); if (!n) return; formModal({
  title: 'Edit notice', submit: 'Save', fields: [{ name: 'title', label: 'Title', required: true, full: true, maxlength: 100, value: n.title }, { name: 'body', label: 'Message', type: 'textarea', required: true, full: true, maxlength: 500, value: n.body }, { name: 'pinned', label: 'Pin on top', type: 'checkbox', value: !!n.pinned }],
  onSubmit: v => { const ti = String(v.title || '').trim(), bo = String(v.body || '').trim(); if (ti.length < 3) return t('Give the notice a short title'); if (bo.length < 5) return t('Write the message (a few words at least)'); Store.patch(n.id, { title: ti, body: bo, pinned: !!v.pinned }); toast('Notice updated'); },
}); };
A.swnotice = el => {
  const n = Store.get(el.dataset.id); if (!n) return;
  const copy = { ...n };
  Store.remove(n.id); render();
  toast(t('Notice deleted'), 'ok', { label: 'Undo', run: () => { Store.put('notice', copy); render(); } });
};
A.addnotice = el => { const tp = el && el.dataset && el.dataset.tpl != null ? NT_TPL[+el.dataset.tpl] : null; return formModal({
  title: 'New notice', submit: 'Post', fields: [{ name: 'title', label: 'Title', required: true, full: true, maxlength: 100, value: tp ? t(tp[0]) : '' }, { name: 'body', label: 'Message', type: 'textarea', required: true, full: true, maxlength: 500, value: tp ? t(tp[1]) : '' }, { name: 'pinned', label: 'Pin on top', type: 'checkbox' }],
  onSubmit: v => { v.title = String(v.title || '').trim(); v.body = String(v.body || '').trim(); if (v.title.length < 3) return t('Give the notice a short title'); if (v.body.length < 5) return t('Write the message (a few words at least)'); Store.put('notice', { ...v, date: today() }); activeRes().forEach(r => notify({ to: 'res', resId: r.id, title: t('New notice'), body: v.title, link: 'r-help' })); toast('Notice posted'); },
}); };
A.noticedel = el => confirmBox(t('Delete this notice?'), () => Store.remove(el.dataset.id), 'Delete', 'bad');
A.noticewa = async el => { const n = Store.get(el.dataset.id); if (!n) return; const r = await sendNoticeMail(n); toast(r.status === 'already' ? t('This notice was already e-mailed to everyone.') : r.demo ? t('Demo hostel: nothing is really e-mailed.') : t('{n} residents e-mailed', { n: r.sent }), r.failed ? 'warn' : 'ok'); render(); };

/* ===================================================================== automation */
PAGES.automation = {
  title: 'Automation', mod: 'automation',
  render() {
    const a = S().auto, logs = Store.all('log').slice().sort(by('ts', -1)).slice(0, 40), od = dueList(true);
    return `${head('Automation', t('These run by themselves once a day when anyone opens the app. Safe to run again — nothing is ever doubled.'), btn('Run now', 'autorun', '', 'primary', 'bot'))}
      <div class="grid g-main">
        ${isSuper() ? `<div>${group('Rules', visibleRules().map(r => `<div class="li"><span class="ic ${a[r.k] ? 'ok' : 'mute'}">${ico('bot')}</span><span class="body"><span class="t">${esc(t(r.l))}</span><span class="d">${esc(t(r.d))}</span></span><label class="sw"><input type="checkbox" data-rule="${r.k}" ${a[r.k] ? 'checked' : ''} aria-label="${esc(t(r.l))}"><span></span></label></div>`).join(''))}</div>` : ''}
        <div class="stack">
          ${group('One-tap jobs', [li({ icon: 'mail', ic: 'ok', t: t('Monthly billing & e-mail'), d: t('Create this month\'s bills and e-mail everyone in one tap'), act: 'monthlybatch' }), li({ icon: 'wa', ic: 'ok', t: t('Send due reminders'), d: t('{n} residents overdue', { n: od.length }), act: 'remindall' }), li({ icon: 'wa', ic: 'info', t: t('Send all bills with pay link'), d: t('{n} residents with dues', { n: dueList().length }), act: 'billall' }), li({ icon: 'bolt', ic: 'warn', t: t('Enter meter readings'), act: 'readings' })].join(''))}
          ${group('Activity log', logs.map(l => li({ icon: 'check', ic: 'mute', t: l.msg, d: `${t((RULES.find(r => r.k === l.rule) || {}).l || l.rule)} · ${ago(l.ts)}` })).join(''))}
        </div>
      </div>`;
  },
};
A.autorun = () => { const n = runAutomation(true); toast(n ? t('Automation: {n} tasks done', { n }) : t('Everything is already up to date')); render(); };
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.rule; if (!k) return;
  if (!isSuper()) { e.target.checked = !e.target.checked; return toast('Only the platform admin can change automation rules', 'bad'); }
  Store.saveSettings({ auto: { [k]: e.target.checked } }).catch(err => toast(err.message, 'bad'));
  toast(e.target.checked ? 'Rule on' : 'Rule off'); setTimeout(render, 50);
});

/* ===================================================================== monthly batch & reminder center */
/* ---- Monthly billing: ONE panel. Where every bill stands, who got the e-mail and when, what is missing, and the one button to send what is ready. */
const MB_ORDER = { ready: 0, failed: 1, wait: 2, none: 3, bad: 4, sent: 5 };
function mbModel() {
  const plan = bulkMailPlan('bill'), day = plan.day, at = day.at || {}, fail = day.fail || {}, rows = [];
  const tm = id => (at[id] ? fmtTime(new Date(at[id]).toTimeString().slice(0, 5)) : '');
  for (const x of plan.done) { const isMail = (day.mailed || []).includes(x.r.id); rows.push({ x, st: isMail ? 'sent' : (emailState(x.r) === 'bad' ? 'bad' : 'none'), time: tm(x.r.id), appNote: !isMail }); }
  for (const x of plan.todo) rows.push({ x, st: fail[x.r.id] ? 'failed' : 'ready', why: fail[x.r.id] || '' });
  for (const x of plan.noEmail) rows.push({ x, st: emailState(x.r) === 'bad' ? 'bad' : 'none' });
  for (const x of plan.blocked) rows.push({ x, st: 'wait', why: x.why, reason: x.reason });
  rows.sort((a, b) => MB_ORDER[a.st] - MB_ORDER[b.st] || b.x.due - a.x.due);
  const c = { all: rows.length, sent: rows.filter(r => r.st === 'sent').length, ready: rows.filter(r => r.st === 'ready' || r.st === 'failed').length, wait: rows.filter(r => r.st === 'wait').length, fix: rows.filter(r => r.st === 'none' || r.st === 'bad' || r.st === 'failed').length };
  c.pending = rows.filter(r => r.st === 'ready' || r.st === 'failed' || r.st === 'wait').length;
  return { plan, rows, c, reading: rows.filter(r => r.st === 'wait' && r.why === 'reading'), create: billsToCreate() };
}
const MB_PILL = { sent: ['ok', 'Sent'], ready: ['info', 'Ready'], failed: ['bad', 'Failed'], wait: ['warn', 'Waiting'], none: ['mute', 'No e-mail'], bad: ['bad', 'Invalid e-mail'] };
function mbRow(r) {
  const x = r.x, room = roomName(x.r.roomId), email = String(x.r.email || '').trim();
  let sub = '', act = '';
  if (r.st === 'sent') sub = `${t('Sent')} ${r.time} · ${email}`;
  else if (r.st === 'ready') sub = email;
  else if (r.st === 'failed') sub = t('Failed: {w}', { w: r.why });
  else if (r.st === 'none') { sub = r.appNote ? t('No e-mail · app notice sent') : t('No e-mail saved'); act = `<button type="button" class="mb-act" data-act="mbfix" data-id="${x.r.id}">${esc(t('Add e-mail'))}</button>`; }
  else if (r.st === 'bad') { sub = t('Invalid: {e}', { e: email }); act = `<button type="button" class="mb-act" data-act="mbfix" data-id="${x.r.id}">${esc(t('Fix'))}</button>`; }
  else if (r.why === 'reading') { sub = t('Meter reading missing'); act = `<button type="button" class="mb-act" data-act="mbread" data-room="${x.r.roomId}">${esc(t('Add reading'))}</button>`; }
  else if (r.why === 'bill') sub = t('Bill not created yet');
  else if (r.why === 'rent') { sub = t('Rent amount not set'); act = `<button type="button" class="mb-act" data-act="mbfix" data-id="${x.r.id}">${esc(t('Open'))}</button>`; }
  else sub = r.reason || t('Incomplete');
  const [tone, lab] = MB_PILL[r.st];
  return `<div class="mb-r"><span class="mb-av">${esc(initials(x.r.name))}</span><div class="mb-b"><b>${esc(x.r.name)}<small> · ${esc(t('Room'))} ${esc(room)}</small></b><span class="mb-s">${esc(sub)}</span></div><div class="mb-e"><span class="mb-p ${tone}">${esc(t(lab))}</span>${x.due > 0 ? `<b>${inr(x.due)}</b>` : ''}${act}</div></div>`;
}
function paintMb() {
  const root = $('#mbRoot'), foot = $('#mbFoot'); if (!root) return;
  const m = mbModel(), f = ui.mbf || 'all', c = m.c;
  const shown = m.rows.filter(r => f === 'all' || (f === 'sent' && r.st === 'sent') || (f === 'pending' && (r.st === 'ready' || r.st === 'failed' || r.st === 'wait')) || (f === 'fix' && (r.st === 'none' || r.st === 'bad' || r.st === 'failed')));
  const chip = (k, lab, n) => `<button type="button" class="mb-chip ${f === k ? 'on' : ''}" data-act="mbf" data-f="${k}">${esc(t(lab))}<i>${n}</i></button>`;
  const pct = c.all ? Math.round(c.sent / c.all * 100) : 0, cr = m.create;
  const confirm = ui.mbConfirm && cr.count ? `<div class="mb-conf"><b>${esc(cr.count === 1 ? t('Create 1 bill?') : t('Create {n} bills?', { n: cr.count }))}</b><span>${esc([cr.rent ? t('Rent {n}', { n: cr.rent }) : '', cr.mess ? t('Mess {n}', { n: cr.mess }) : '', cr.charges ? t('Extra charges {n}', { n: cr.charges }) : ''].filter(Boolean).join(' · '))} · ${esc(cr.people.length === 1 ? t('1 resident') : t('{n} residents', { n: cr.people.length }))}</span>
    <em>${esc(cr.people.slice(0, 6).map(p => p.name.split(' ')[0] + ' ' + p.roomNo).join(', '))}${cr.people.length > 6 ? ' +' + (cr.people.length - 6) : ''}</em>
    <div class="mb-ca"><button type="button" class="btn primary" data-act="mbcreatego">${esc(t('Create'))}</button><button type="button" class="btn" data-act="mbcancel">${esc(t('Cancel'))}</button></div></div>` : '';
  root.innerHTML = `<div class="mb-sum"><div class="mb-t ok"><b>${c.sent}</b><span>${esc(t('Sent'))}</span></div><div class="mb-t info"><b>${c.ready}</b><span>${esc(t('Ready'))}</span></div><div class="mb-t warn"><b>${c.wait}</b><span>${esc(t('Waiting'))}</span></div></div>
    <div class="mb-bar"><i style="width:${pct}%"></i></div>${confirm}
    <div class="mb-chips">${chip('all', 'All', c.all)}${chip('sent', 'Sent', c.sent)}${chip('pending', 'Pending', c.pending)}${chip('fix', 'Needs fixing', c.fix)}</div>
    <div class="mb-list">${shown.map(mbRow).join('') || `<div class="mb-empty">${esc(t('Nothing here'))}</div>`}</div>`;
  const sendN = c.ready;
  foot.innerHTML = `${sendN ? `<button class="btn primary block bm-go" data-act="mbsend">${ico('mail', 'sm')} ${esc(t('Send {n} e-mails', { n: sendN }))}</button>` : ''}
    <div class="mb-fa">${cr.count && !ui.mbConfirm ? `<button class="btn block" data-act="mbcreate">${esc(cr.count === 1 ? t('Create 1 missing bill') : t('Create {n} missing bills', { n: cr.count }))}</button>` : ''}${m.reading.length ? `<button class="btn block" data-act="mbelec">${ico('bolt', 'sm')} ${esc(t('Update readings ({n})', { n: m.reading.length }))}</button>` : ''}</div>
    ${WaGw.on() ? `<button class="btn block ghost" data-act="sendautowa" data-ym="${ymOf(today())}">${ico('wa', 'sm')} ${esc(t('Send on WhatsApp (automatic)'))}</button>` : ''}${!sendN && !cr.count && !m.reading.length ? `<button class="btn block" data-act="close">${esc(t('Close'))}</button>` : ''}`;
}
A.monthlybatch = () => { ui.mbf = 'all'; ui.mbConfirm = false; sheet(`${t('Monthly billing')} · ${fmtYM(ymOf(today()))}`, '<div id="mbRoot"></div>', { foot: '<div id="mbFoot" class="mb-foot"></div>' }); paintMb(); };
A.mbf = el => { ui.mbf = el.dataset.f; paintMb(); };
A.mbcreate = () => { ui.mbConfirm = true; paintMb(); };
A.mbcancel = () => { ui.mbConfirm = false; paintMb(); };
// nothing is created until the owner has seen what will be created
A.mbcreatego = () => {
  ui.mbConfirm = false;
  try { const r = runMonthlyBillingBatch({ ym: ymOf(today()) }); toast(r.invoicesCreated ? t('{n} bills created', { n: r.invoicesCreated }) : t('No new bills were needed')); } catch (e) { toast(e.message, 'bad'); }
  paintMb(); render();
};
A.mbsend = async el => {
  el.disabled = true; el.innerHTML = `<span class="spin sm"></span> ${esc(t('Sending...'))}`;
  let r; try { r = await sendBulkMail('bill'); } catch (e) { r = { sent: 0, failed: 1, reason: e.message }; }
  if (r.sent) toast(r.demo ? t('{n} sent (demo: nothing is really e-mailed)', { n: r.sent }) : t('{n} e-mails sent', { n: r.sent }), 'ok');
  if (r.failed) toast(r.reason === 'not_configured' ? t('E-mail is not set up on the server yet') : t('{n} failed - see Needs fixing', { n: r.failed }), 'bad');
  paintMb(); render();
};
// meter readings that are missing: straight to the room, or to the Electricity page with the list
A.mbread = el => { closeModal(); A.readroom({ dataset: { id: el.dataset.room } }); };
A.mbelec = () => {
  const rows = mbModel().reading, names = rows.slice(0, 4).map(r => `${t('Room')} ${roomName(r.x.r.roomId)}`);
  closeModal(); go('electricity');
  toast(t('Readings needed: {r}', { r: [...new Set(names)].join(', ') + (rows.length > 4 ? ' +' + (rows.length - 4) : '') }), 'warn');
};
A.mbfix = el => { closeModal(); go(`residents/${el.dataset.id}`); };

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
  const ym = (el && el.dataset && el.dataset.ym) || ymOf(today());
  try {
    const res = runMonthlyBillingBatch({ ym });
    toast(res.invoicesCreated ? t('{n} bills created', { n: res.invoicesCreated }) : t('No new bills were needed'));
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
    sheet(t('Sending Complete'), `<div style="text-align:center;padding:20px 0"><b>${esc(t('All reminders processed!'))}</b><p class="mute">${_seqQueue.length} ${esc(t('residents reached.'))}</p></div>`, { foot: btn('Done', 'closemodal', '', 'primary') });
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
      <div class="mute" style="font-size:12px;margin-bottom:6px">${esc(room ? room.no : '')}-${esc(item.r.bed || '')} · +91 ${esc(phone10(item.r.phone))}</div>
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
        ${settleRows(s, s.unpaidDues)}
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
// status -> [label, pill colour, progress step (-1 = off the funnel), short filter label]
const INQ_ST = {
  new: ['New', 'warn', 0], contacted: ['Contacted', 'info', 1], visit_scheduled: ['Visit scheduled', 'info', 2, 'Visit'],
  interested: ['Interested', 'ok', 3], converted: ['Converted', 'ok', 4], not_interested: ['Not interested', 'mute', -1], closed: ['Closed', 'mute', -1]
};
const INQ_FILTER = ['new', 'contacted', 'visit_scheduled', 'interested', 'converted', 'closed'];
const INQ_DONE = ['converted', 'not_interested', 'closed'];
const INQ_NEXT = { new: ['contacted', 'Mark contacted'], contacted: ['visit_scheduled', 'Visit booked'], visit_scheduled: ['interested', 'Mark interested'] };
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

    const inqItem = x => {
      const d = x.data || {};
      const st = d.status || 'new', [stLbl, stCls, stStep] = INQ_ST[st] || INQ_ST.new;
      const phone10 = String(d.phone || '').replace(/\D/g, '').slice(-10);
      const isDup = (phoneCounts[phone10] || 0) > 1, isLiving = livingPhones.has(phone10);
      const assigned = d.staffId ? staffById(d.staffId) : null;
      const moveIn = d.moveInDate || d.moveIn;
      const fu = d.followUpDate, overdue = fu && fu < today() && !INQ_DONE.includes(st), fuToday = fu === today();
      const hName = (Store.hostel() || {}).name || 'our hostel';
      const msg = [`Hello ${d.name || ''}, thank you for your interest in ${hName}!`, d.roomType && d.roomType !== 'Any' ? `Interested in: ${d.roomType}` : '', moveIn ? `Expected move-in: ${fmtDate(moveIn)}` : '', d.occupants ? `Occupants: ${d.occupants}` : '', d.budget ? `Budget: Rs. ${d.budget}` : '', 'When would you like to schedule a visit?'].filter(Boolean).join('\n');
      const next = INQ_NEXT[st];
      const tag = (ic, txt) => `<span class="inq-tag">${ico(ic, 'xs')}${txt}</span>`;
      const lastNote = (d.notes || []).slice(-1)[0];
      return `<div class="card inq ${overdue ? 'late' : ''}">
        <div class="inq-h">${avatar(d.name || '?')}
          <div class="inq-who"><b>${esc(d.name || 'Anonymous')}</b><span class="muted xs">${esc(d.phone || '—')} · ${esc(ago(d.createdAt || (x.day + 'T09:00:00')))}</span></div>
          <span class="inq-st ${stCls}">${esc(t(stLbl))}</span></div>
        <div class="inq-steps" aria-hidden="true">${[0, 1, 2, 3, 4].map(i => `<i class="${stStep < 0 ? '' : i <= stStep ? 'on' : ''}"></i>`).join('')}</div>
        <div class="inq-tags">${tag('bed', esc(d.roomType && d.roomType !== 'Any' ? d.roomType : t('Any room')))}${tag('wallet', d.budget ? inr(d.budget) : esc(t('Flexible budget')))}${moveIn ? tag('cal', esc(t('Move-in')) + ' ' + fmtShort(moveIn)) : ''}${d.occupants > 1 ? tag('users', d.occupants) : ''}${isDup ? `<span class="inq-tag warn">${ico('alert', 'xs')}${esc(t('Duplicate'))} ${phoneCounts[phone10]}×</span>` : ''}${isLiving ? `<span class="inq-tag info">${ico('user', 'xs')}${esc(t('Existing resident'))}</span>` : ''}</div>
        ${d.message ? `<p class="inq-msg">${esc(d.message)}</p>` : ''}
        ${lastNote ? `<p class="inq-note">${ico('edit', 'xs')} ${esc(lastNote.text)}</p>` : ''}
        <div class="inq-meta"><span>${assigned ? `${ico('user', 'xs')} ${esc(assigned.name)}` : `<span class="muted">${esc(t('Unassigned'))}</span>`}</span>${fu ? `<span class="${overdue ? 'bad-t' : fuToday ? 'warn-t' : ''}">${ico('clock', 'xs')} ${esc(overdue ? t('Overdue') : t('Follow-up'))} ${fmtShort(fu)}</span>` : ''}</div>
        <div class="inq-a">
          <a class="btn sm" href="tel:+91${phone10}">${ico('phone', 'sm')}${esc(t('Call'))}</a>
          <a class="btn sm" href="https://wa.me/91${phone10}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ico('chat', 'sm')}WhatsApp</a>
          <button class="btn sm" data-act="inqstatus" data-id="${x.id}">${ico('edit', 'sm')}${esc(t('Update'))}</button>
          ${st === 'converted' ? `<span class="inq-done">${ico('check', 'sm')} ${esc(t('Converted'))}</span>`
            : INQ_DONE.includes(st) ? '' : `${next ? `<button class="btn sm" data-act="inqnext" data-id="${x.id}">${esc(t(next[1]))}</button>` : ''}<button class="btn sm primary" data-act="inqconvert" data-id="${x.id}">${ico('userplus', 'sm')}${esc(t('Check-in'))}</button>`}
        </div>
      </div>`;
    };

    const cnt = k => list.filter(x => ((x.data || {}).status || 'new') === k).length;
    const due = list.filter(x => { const d = x.data || {}; return d.followUpDate && d.followUpDate <= today() && !INQ_DONE.includes(d.status || 'new'); }).length;
    const won = cnt('converted');
    const stats = `<div class="inq-stats">${kpi('New', cnt('new'), t('to call'), cnt('new') ? 'warn' : '', '', 'bell')}${kpi('Follow-ups due', due, t('today or late'), due ? 'bad' : '', '', 'clock')}${kpi('Visits', cnt('visit_scheduled'), t('scheduled'), '', '', 'cal')}${kpi('Converted', won, list.length ? pct(won, list.length) + '% ' + t('of all') : '', 'ok', '', 'check')}</div>`;

    return `${head('PG Inquiries', t('{n} inquiries received', { n: list.length }))}${list.length ? stats : ''}
      <div class="tool">${searchBox('inq', 'Search name, phone, room')}<span class="sp"></span>${chips('inq', [['all', t('All') + ' ' + list.length], ...INQ_FILTER.map(k => [k, t(INQ_ST[k][3] || INQ_ST[k][0]) + (cnt(k) ? ' ' + cnt(k) : '')])], 'all')}</div>
      <div class="tool inq-date">${chips('inqd', [['all', 'All time'], ['today', 'Today'], ['week', 'Past 7 days'], ['month', 'This month']], 'all')}</div>
      ${shown.length ? `<div class="stack">${shown.map(inqItem).join('')}</div>` : `<div class="card">${empty('No inquiries found', 'When visitors submit the form on your public page, they appear here.')}</div>`}`;
  }
};
A.inqnext = el => {
  const inq = Store.get(el.dataset.id), d = inq && inq.data;
  if (!d || !INQ_NEXT[d.status || 'new']) return;
  Store.patch(inq.id, { data: { ...d, status: INQ_NEXT[d.status || 'new'][0] } });
  toast(t('Inquiry updated ✓'), 'ok'); render();
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
        options: Object.keys(INQ_ST).map(k => ({ v: k, l: k === 'converted' ? 'Converted to resident' : INQ_ST[k][0] })),
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
  title: 'Police verification', mod: 'emitra',
  render() {
    const B0 = pvBoard(), doer = canVerifyPV(), tab = curTab('pvt', 'pending');
    const B = { pending: [...B0.todo, ...B0.submitted], verified: B0.verified, all: [...B0.todo, ...B0.submitted, ...B0.verified].sort((a, b) => String(a.name).localeCompare(String(b.name))) };
    const total = B.pending.length + B.verified.length, done = B.verified.length;
    const who = doer ? t('You verify these tenants. Open one, copy the details into the police portal, save the acknowledgement.')
      : pvByPlatform() ? t('The Sarvlekh team does the police verification for your hostel. You only see how far it has gone.')
      : t('Your e-Mitra operator does the police verification. You only see how far it has gone.');
    const list = B[tab] || [];
    const row = r => { const v = pvSheet(r), pv = r.pv || {}, ok = pv.status === 'verified';
      return prow({
        act: doer ? 'emitraverify' : '', attrs: doer ? `data-id="${r.id}"` : '', lead: avatar(r.name), t: esc(r.name),
        s: esc(`${t('Room')} ${roomName(r.roomId)} · ${t('since')} ${fmtShort(r.checkIn)}${ok && pv.refNo ? ' · ' + t('Ref') + ' ' + pv.refNo : ''}`),
        tags: `${badge(ok ? 'Verified' : pv.status === 'submitted' ? 'Sent to police - waiting' : pv.status === 'rejected' ? 'Rejected - to redo' : 'Not started', ok ? 'ok' : pv.status === 'submitted' ? 'info' : pv.status === 'rejected' ? 'bad' : 'warn')}${!ok && doer ? (v.docs.length ? `<span class="gate-t">${ico('file', 'xs')} ${esc(t('{n} papers', { n: v.docs.length }))}</span>` : badge('No papers', 'bad')) : ''}${!ok && doer && v.missing.length ? badge(t('{n} details missing', { n: v.missing.length }), 'bad') : ''}${ok && pv.verifiedBy ? `<span class="gate-t">${esc(t('by {w}', { w: pv.verifiedBy }))} · ${esc(fmtShort(pv.date))}</span>` : ''}`,
        acts: !doer && ok && pv.certificatePath ? `<button type="button" class="btn sm" data-act="opendoc" data-path="${esc(pv.certificatePath)}" data-res="${r.id}" data-type="Police verification">${ico('file', 'sm')} ${esc(t('View Certificate'))}</button>` : ''
      }); };
    return `${head('Police verification', total ? t('{a} of {b} tenants verified', { a: done, b: total }) : '')}
      ${!pvOn() ? `<div class="note warn">${ico('alert', 'sm')} ${esc(t('Police Verification Required is switched OFF by owner. Residents are not blocked, but verification records can still be submitted.'))}</div>` : ''}
      <div class="pvh"><div class="pvh-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="pvg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="#0ea5a5"/></linearGradient></defs><circle cx="50" cy="50" r="42" class="pvh-tr"/><circle cx="50" cy="50" r="42" class="pvh-fg" style="stroke-dasharray:${(pct(done, total) * 2.639).toFixed(1)} 264"/></svg><div class="pvh-c"><b>${done}<i>/${total}</i></b><small>${esc(t('verified'))}</small></div></div>
        <div class="pvh-t"><b>${esc(doer ? t('Verification queue') : t('Verification status'))}</b><span>${esc(who)}</span></div></div>
      <div class="pvh-st"><span class="ok"><b>${done}</b>${esc(t('Verified'))}</span><span class="info"><b>${B0.submitted.length}</b>${esc(t('Waiting'))}</span><span class="warn"><b>${B0.todo.length}</b>${esc(t('To start'))}</span></div>
      ${seg('pvt', [['pending', 'Pending', B.pending.length], ['verified', 'Verified', B.verified.length], ['all', 'All residents', B.all.length]], 'pending')}
      ${list.length ? `<div class="group">${list.map(row).join('')}</div>` : `<div class="card">${empty(tab === 'pending' ? 'Verification queue clear' : 'Nothing here', tab === 'pending' ? 'No residents currently pending verification.' : 'No tenants in this list.')}</div>`}`;
  }
};
// One detail with a copy button, for typing into the police portal
const pvRow = (label, val) => `<div class="pvr"><div><small>${esc(t(label))}</small><b>${val ? esc(val) : `<i>${esc(t('not entered'))}</i>`}</b></div>${val ? `<button type="button" class="pvc" data-act="pvcopy" data-v="${esc(val)}" aria-label="${esc(t('Copy'))}">${ico('copy', 'sm')}</button>` : ''}</div>`;
A.pvcopy = async el => { try { await navigator.clipboard.writeText(el.dataset.v); toast(t('Copied')); } catch (e) { toast(t('Could not copy'), 'bad'); } };

A.emitraverify = el => {
  if (!canVerifyPV()) return toast(t('Police verification is done by the e-Mitra operator or the Sarvlekh team'), 'bad');
  const r = resById(el.dataset.id);
  if (!r) return;
  const pv = r.pv || {};
  const portal = pvPortal(pv.state || S().police.state);
  const portalName = pvStateName(pv.state || S().police.state) || 'State Police';
  const v = pvSheet(r);
  const kycDocsHtml = v.docs.length
    ? `<div class="row wrap" style="gap:8px;margin-top:6px">${v.docs.map(d => `<button type="button" class="btn sm" data-act="opendoc" data-path="${esc(d.path)}" data-res="${r.id}" data-type="${esc(d.type)}">${ico('eye', 'sm')} ${esc(d.type)}</button>`).join('')}</div>`
    : `<div class="muted sm" style="margin-top:4px">${esc(t('No ID papers uploaded yet.'))}</div>`;
  const pvForm = formModal({
    title: `Police Verification · ${r.name}`,
    submit: 'Save Verification',
    wide: true,
    fields: [
      {
        type: 'html',
        html: `
          ${v.missing.length ? `<div class="note warn" style="margin-bottom:10px">${ico('alert', 'sm')} ${esc(t('Missing: {l}. Ask the owner to complete the resident record.', { l: v.missing.map(x => t(x)).join(', ') }))}</div>` : ''}
          <div class="group-t">${esc(t('Tenant'))}</div><div class="pvg">${v.tenant.map(x => pvRow(x[0], x[0] === 'Staying since' ? fmtDate(x[1]) : x[1])).join('')}</div>
          <div class="group-t">${esc(t('Stay'))}</div><div class="pvg">${v.stay.map(x => pvRow(x[0], x[0] === 'Staying since' ? fmtDate(x[1]) : x[1])).join('')}</div>
          <div class="group-t">${esc(t('Property'))}</div><div class="pvg">${v.property.map(x => pvRow(x[0], x[1])).join('')}</div>
          <div class="group-t">${esc(t('Photo & Aadhaar'))}</div><div id="pvImgs" class="row" style="gap:10px;flex-wrap:wrap">${v.docs.map((d, i) => `<figure style="margin:0;width:46%;min-width:140px"><figcaption class="xs muted" style="margin-bottom:4px">${esc(d.type)}</figcaption><img data-pvimg="${i}" alt="${esc(d.type)}" style="width:100%;border-radius:10px;border:1px solid var(--line);background:var(--subtle,#f3f4f6);min-height:90px;object-fit:contain"></figure>`).join('') || `<span class="muted sm">${esc(t('No ID papers uploaded yet.'))}</span>`}</div>
          <div class="group-t">${esc(t('ID papers'))}</div>${kycDocsHtml}
          ${portal ? `<div style="margin-top:12px"><a class="btn sm primary" href="${esc(portal)}" target="_blank" rel="noopener">${ico('globe', 'sm')} ${esc(t('Open {p} portal', { p: portalName }))}</a></div>` : ''}
        `
      },
      { name: 'refNo', label: 'Police Acknowledgement / Reference Number', value: pv.refNo || '', required: true, maxlength: 60, hint: 'Reference number from the state police portal acknowledgement' },
      { name: 'date', label: 'Verification Date', type: 'date', value: pv.date || today(), required: true },
      { name: 'status', label: 'Verification Status', type: 'select', options: [{ v: 'submitted', l: 'Submitted / Acknowledgement Received' }, { v: 'verified', l: 'Completed: verified & certificate issued (e-mails the resident)' }, { v: 'rejected', l: 'Rejected by Police' }], value: pv.status || 'submitted', required: true },
      { name: 'file', label: 'Upload Police Acknowledgement / Certificate', type: 'file', accept: 'image/*' },
      { name: 'notes', label: 'Operator Notes', value: pv.notes || '', maxlength: 200 }
    ],
    onSubmit: async v => {
      if (v.date > today()) return t('The date cannot be in the future');
      if (String(v.refNo || '').trim().length < 4) return t('Enter the acknowledgement / reference number from the police portal');
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
  // the photo and both sides of the Aadhaar, shown right here so they can be checked against the details
  setTimeout(async () => {
    for (const img of $$('img[data-pvimg]', pvForm)) {
      const d = v.docs[+img.dataset.pvimg]; if (!d || !d.path) continue;
      try { img.src = await Files.url(d.path); img.style.cursor = 'zoom-in'; img.onclick = () => window.open(img.src, '_blank', 'noopener'); } catch (e) { img.alt = t('Could not load'); }
    }
  }, 50);
};
