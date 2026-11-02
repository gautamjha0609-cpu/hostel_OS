'use strict';
/* Resident app: dues & UPI pay, meals (skip / tiffin), room cleaning, laundry, complaints & notices. */

const meRes = () => resById(ctx().refId);
const resOnly = { when: () => isResident() && orgEnabled('residentApp') };
// `mod:` goes through can(), and ROLES.resident.mods is empty by design, so each resident
// screen checks the module itself. Otherwise a bookmarked link reaches a page whose module
// the hostel does not have — the menu hides it, but the URL still worked.
const resMod = m => ({ when: () => isResident() && orgEnabled('residentApp') && orgEnabled(m) });
const noRecord = () => `<div class="card">${empty('Your resident record is not linked yet', 'Please ask the PG owner.')}</div>`;

PAGES['r-home'] = {
  title: 'Home', ...resOnly,
  render() {
    if (!orgEnabled('residentApp')) return `<div class="card">${empty('Resident app is not enabled', 'Please contact the PG owner.')}</div>`;
    const r = meRes(); if (!r) return noRecord();
    const due = resDue(r.id), open = openInv(r.id), p = S().pay;
    const pending = Store.all('claim').filter(c => c.resId === r.id && c.status === 'pending');
    const next = meals().find(m => nowMinutes() < minutes(m.time));
    const notices = Store.all('notice').slice().sort(by('date', -1)).slice(0, 2);
    const task = hkTasks().filter(x => x.roomId === r.roomId && x.date >= today()).sort(by('date'))[0];
    return `<div class="narrow stack">
      <div style="margin-top:6px"><h2 style="font-size:28px">${esc(t('Hi {n}', { n: r.name.split(' ')[0] }))} 👋</h2><p class="muted">${esc(hostelName())} · ${t('Room')} ${esc(roomName(r.roomId))}-${esc(r.bed)}</p></div>
      <div class="hero ${due ? '' : 'ok'}"><div class="muted sm">${esc(t(due ? 'Amount due' : 'All paid'))}</div><div class="big">${inr(due)}</div>
        ${pending.length ? `<div class="sm" style="margin-top:6px">⏳ ${esc(t('{a} payment waiting for owner to verify', { a: inr(sum(pending, c => c.amount)) }))}</div>` : ''}
        ${due ? `<div class="row" style="margin-top:14px">${p.upiId ? `<a class="btn primary" href="${esc(upiUri(due, `${r.name} ${roomName(r.roomId)}`))}">${ico('rupee', 'sm')} ${esc(t('Pay by UPI'))}</a><button class="btn" data-act="rqr">${ico('qr', 'sm')} QR</button>` : ''}<button class="btn" data-act="rclaim">${ico('check', 'sm')} ${esc(t('I have paid'))}</button></div>` : ''}</div>
      ${open.length ? group('Bill details', open.map(i => li({ icon: i.type === 'electricity' ? 'bolt' : i.type === 'laundry' ? 'shirt' : 'rupee', ic: invStat(i) === 'overdue' ? 'bad' : 'info', t: i.title, d: `${t('due')} ${fmtShort(i.due)}`, end: `<b>${inr(invBal(i))}</b>` })).join('')) : ''}
      ${orgEnabled('mess') && next ? `<div class="card"><h3>${ico('utensils', 'sm')} ${esc(mealName(next.k))} · ${fmtTime(next.time)}<span class="sp"></span><a class="sm" href="/r-meals">${esc(t('All meals'))}</a></h3>${mealRow(r, today(), next)}</div>` : ''}
      ${orgEnabled('housekeeping') && task ? group('Room cleaning', li({ icon: 'broom', ic: task.status === 'done' ? 'ok' : 'info', t: task.date === today() ? t('Today') : fmtDate(task.date), d: `${task.schedName || ''}${task.time ? ' · ' + fmtTime(task.time) : ''} · ${t(HK_STAT[task.status][0])}`, act: 'go', attrs: 'data-to="r-clean"' })) : ''}
      ${attOn() ? (() => { const m = attMonth(r.id, ymOf(today())); return group('My attendance', li({ icon: 'check', ic: m.absent ? 'warn' : 'ok', t: t('{n} days present', { n: m.present }), d: m.absent ? t('{n} days marked absent in {m}: {d}', { n: m.absent, m: fmtYM(ymOf(today())), d: m.absentDays.join(', ') }) : t('Nothing marked absent in {m}', { m: fmtYM(ymOf(today())) }), chev: false })); })() : ''}
      ${notices.length ? group('Notices', notices.map(n => li({ icon: 'megaphone', ic: 'teal', t: n.title, d: n.body })).join('')) : ''}
      ${group('Recent payments', Store.all('pay').filter(x => x.resId === r.id).sort(by('date', -1)).slice(0, 4).map(x => li({ icon: 'check', ic: 'ok', t: inr(x.amount), d: `${fmtDate(x.date)} · ${x.mode.toUpperCase()}`, act: 'receipt', attrs: `data-id="${x.id}"` })).join(''))}
    </div>`;
  },
};
A.rqr = () => {
  const r = meRes(), due = resDue(r.id), uri = upiUri(due, `${r.name} ${roomName(r.roomId)}`);
  sheet('Scan & pay', `<div class="qr">${qrSvg(uri, 6)}</div><p style="text-align:center;margin-top:12px"><b style="font-size:22px">${inr(due)}</b><br><span class="muted">${esc(S().pay.payee || hostelName())} · ${esc(S().pay.upiId)}</span></p><p class="hint" style="text-align:center;margin-top:8px">${esc(t('Scan with any UPI app, then tap "I have paid" and enter the UTR.'))}</p>`, { foot: `<button class="btn primary block" data-act="rclaim">${esc(t('I have paid'))}</button>` });
};
// Resident reports a UPI payment; owner verifies with one tap in Approvals.
A.rclaim = () => {
  const r = meRes();
  formModal({
    title: 'I have paid', submit: 'Send to owner',
    note: t('Enter the 12-digit UTR / transaction ID from your UPI app. The owner verifies it and you get a receipt.'),
    fields: [{ name: 'amount', label: 'Amount paid (₹)', type: 'number', min: 1, value: resDue(r.id) || '', required: true }, { name: 'utr', label: 'UTR / transaction ID', inputmode: 'numeric', required: true, pattern: /^[A-Za-z0-9]{6,22}$/ }, { name: 'date', label: 'Paid on', type: 'date', value: today() }],
    onSubmit: v => {
      if (Store.all('claim').some(c => c.utr === v.utr && c.status !== 'rejected')) return 'This UTR was already submitted';
      Store.put('claim', { resId: r.id, roomId: r.roomId, amount: v.amount, utr: v.utr, date: v.date, status: 'pending', ts: nowIso() });
      notify({ to: 'admin', title: t('UPI payment to verify'), body: `${r.name} · ${inr(v.amount)}`, link: 'inbox' });
      toast('Sent. You will get a receipt once verified.');
    },
  });
};

function mealRow(r, date, m) {
  const sk = !!Store.get(skipId(r.id, date, m.k)), tf = !!Store.get(tiffinId(r.id, date, m.k));
  const open = beforeCutoff(date, m.k, 'skip'), topen = beforeCutoff(date, m.k, 'tiffin'), leave = onLeave(r.id, date);
  const ds = dishesFor(date, m.k).map(d => d.name).join(', ');
  const mess = S().mess;
  return `<div class="meal"><div class="body"><b>${esc(mealName(m.k))}</b> <span class="hint">${fmtTime(m.time)}</span><div class="sm muted">${esc(ds || t('Menu not set'))}</div>
    <div class="xs muted">${leave ? esc(t('You are on leave')) : sk ? esc(t('Skipped')) : tf ? esc(t('Tiffin will be packed')) : esc(t('You are eating'))}${!open && !leave ? ' · ' + esc(t('locked')) : ` · ${esc(t('change till {t}', { t: `${fmtTime(m.cutoff)}${m.prev ? ' ' + t('previous day') : ''}` }))}`}</div></div>
    ${leave || r.food === false ? '' : `<div class="row nw" style="gap:6px">${mess.tiffin ? `<button class="btn sm ${tf ? 'primary' : ''}" data-act="rtif" data-date="${date}" data-meal="${m.k}" ${topen ? '' : 'disabled'}>${ico('pack', 'sm')}${esc(t('Tiffin'))}</button>` : ''}${mess.skip ? `<button class="btn sm ${sk ? 'bad' : ''}" data-act="rskip" data-date="${date}" data-meal="${m.k}" ${open ? '' : 'disabled'}>${ico('skip', 'sm')}${esc(t(sk ? 'Skipped' : 'Skip'))}</button>` : ''}</div>`}</div>`;
}
PAGES['r-meals'] = {
  title: 'Meals', ...resMod('mess'),
  render() {
    const r = meRes(); if (!r) return noRecord();
    const date = ui.flt.rmd || today();
    const leaves = Store.all('leave').filter(l => l.resId === r.id && l.to >= today());
    return `<div class="narrow">${head('Meals', t('Skip a meal or order a tiffin before the cut-off time.'))}
      <div class="days7" style="margin-bottom:14px">${[...Array(7)].map((_, i) => addDays(today(), i)).map(d => `<button class="${d === date ? 'on' : ''}" data-act="setflt" data-k="rmd" data-v="${d}"><span>${DAYS()[parse(d).getDay()]}</span><b>${parse(d).getDate()}</b></button>`).join('')}</div>
      ${r.food === false ? `<div class="note">${esc(t('You are not on the mess plan.'))}</div>` : ''}
      <div class="group">${meals().map(m => mealRow(r, date, m)).join('')}</div>
      ${group('Going home? (leave)', [...leaves.map(l => li({ icon: 'cal', ic: 'info', t: `${fmtDate(l.from)} – ${fmtDate(l.to)}`, d: l.reason || '', end: l.from > today() ? btn('', 'rleavedel', `data-id="${l.id}" aria-label="${esc(t('Delete'))}"`, 'sm', 'trash') : '' })), li({ icon: 'plus', ic: 'ok', t: t('Add leave — all meals off'), act: 'rleave' })].join(''))}</div>`;
  },
};
A.rskip = el => { try { const on = toggleSkip(ctx().refId, el.dataset.date, el.dataset.meal); haptic(); toast(on ? 'Meal skipped' : 'Meal back on'); } catch (e) { toast(e.message, 'bad'); } render(); };
A.rtif = el => { try { const on = toggleTiffin(ctx().refId, el.dataset.date, el.dataset.meal); haptic(); toast(on ? 'Tiffin ordered' : 'Tiffin cancelled'); } catch (e) { toast(e.message, 'bad'); } render(); };
A.rleave = () => formModal({
  title: 'Add leave', note: t('Your meals are not counted on these days.'),
  fields: [{ name: 'from', label: 'From', type: 'date', value: addDays(today(), 1), required: true }, { name: 'to', label: 'To (including)', type: 'date', value: addDays(today(), 2), required: true }, { name: 'reason', label: 'Reason' }],
  onSubmit: v => {
    if (v.to < v.from) return 'End date is before start date';
    if (v.from < today() || (v.from === today() && !beforeCutoff(today(), meals()[meals().length - 1].k, 'skip'))) return 'Leave must start from tomorrow';
    const r = meRes(); Store.put('leave', { resId: r.id, roomId: r.roomId, from: v.from, to: v.to, date: v.from, reason: v.reason }); notify({ to: 'admin', title: t('Resident on leave'), body: `${r.name}: ${fmtShort(v.from)} – ${fmtShort(v.to)}` }); toast('Leave saved');
  },
});
A.rleavedel = el => { Store.remove(el.dataset.id); render(); };

PAGES['r-clean'] = {
  title: 'Room cleaning', ...resMod('housekeeping'),
  render() {
    const r = meRes(); if (!r) return noRecord();
    const tasks = hkTasks().filter(x => x.roomId === r.roomId).sort(by('date', -1));
    const upcoming = [];
    for (let i = 0; i < 14 && upcoming.length < 3; i++) { const d = addDays(today(), i); const s = Store.all('hks').find(x => (x.rooms || []).includes(r.roomId) && schedOn(x, d)); if (s) upcoming.push({ d, s }); }
    const recent = tasks.filter(x => x.date <= today()).slice(0, 10);
    return `<div class="narrow">${head('Room cleaning', `${t('Room')} ${esc(roomName(r.roomId))}`)}
      ${group('Next cleaning', upcoming.map(u => li({ icon: 'cal', ic: 'info', t: u.d === today() ? t('Today') : fmtDate(u.d), d: `${u.s.name}${u.s.time ? ' · ' + fmtTime(u.s.time) : ''}` })).join('') || li({ icon: 'cal', ic: 'mute', t: t('No cleaning scheduled') }))}
      ${group('Recent cleaning', recent.map(x => { const fb = Store.get(`hkf-${x.id}-${r.id}`); return `<div class="li"><span class="ic ${x.status === 'done' ? 'ok' : x.status === 'pending' ? '' : 'bad'}">${ico(x.status === 'done' ? 'check' : 'broom')}</span><span class="body"><span class="t">${x.date === today() ? esc(t('Today')) : fmtDate(x.date)} · ${esc(t(HK_STAT[x.status][0]))}</span><span class="d">${esc(x.staffName || '')}${x.reason ? ' · ' + esc(x.reason) : ''}${fb ? ' · ' + (fb.ok ? '👍 ' + esc(t('You confirmed')) : '👎 ' + esc(t('You reported an issue'))) : ''}</span></span><span class="end">${x.status === 'done' && !fb ? `${btn('👎', 'rfb', `data-id="${x.id}" data-ok="0" aria-label="${esc(t('Not satisfied'))}"`, 'sm bad')}${btn('👍 ' + t('OK'), 'rfb', `data-id="${x.id}" data-ok="1"`, 'sm ok')}` : ''}${x.status === 'pending' && canMarkHk(x) ? btn('Mark cleaned', 'rhkdone', `data-id="${x.id}"`, 'sm ok') : ''}${(x.status === 'missed' || x.status === 'not_cleaned') && !fb ? btn('Report', 'rfb', `data-id="${x.id}" data-ok="0"`, 'sm bad') : ''}</span></div>`; }).join(''), t('Your feedback goes straight to the owner.'))}</div>`;
  },
};
A.rhkdone = el => { setHkStatus(el.dataset.id, 'done'); toast('Thanks — marked as cleaned'); render(); };
A.rfb = el => {
  const ok = el.dataset.ok === '1', r = meRes();
  if (ok) { hkFeedback(el.dataset.id, r.id, true); toast('Thanks for confirming!'); render(); return; }
  formModal({ title: 'What was wrong?', fields: [{ name: 'note', label: 'Tell the owner', type: 'textarea', required: true, full: true }], onSubmit: v => { hkFeedback(el.dataset.id, r.id, false, v.note); toast('Sent to owner'); } });
};

PAGES['r-laundry'] = {
  title: 'Laundry', ...resMod('laundry'),
  render() {
    const r = meRes(); if (!r) return noRecord();
    const L = S().laundry, used = laundryUsed(r.id, ymOf(today()));
    const list = Store.all('laundry').filter(l => l.resId === r.id).sort(by('ts', -1)).slice(0, 20);
    return `<div class="narrow">${head('Laundry')}
      <div class="card"><div class="row sb"><b>${esc(t('This month'))}</b><span class="muted sm">${used} / ${L.freePcs} ${esc(t('free used'))}</span></div><div class="bar ${used > L.freePcs ? 'bad' : 'ok'}" style="margin-top:10px"><i style="width:${Math.min(100, pct(used, L.freePcs))}%"></i></div><p class="hint" style="margin-top:8px">${esc(t('{f} free clothes per month, then ₹{r} per piece.', { f: L.freePcs, r: L.rate }))}</p></div>
      ${group('My laundry', list.map(l => li({ icon: 'shirt', ic: l.status === 'completed' ? 'ok' : 'warn', t: `${l.pcs} ${t('clothes')} · ${fmtShort(l.date)}`, d: `${l.charge ? inr(l.charge) + ' ' + t('extra') : t('free')}${l.note ? ' · ' + l.note : ''}`, end: badge(l.status === 'completed' ? 'Ready' : 'Washing', l.status === 'completed' ? 'ok' : 'warn') })).join(''), t('Give clothes at the laundry counter — it appears here automatically.'))}</div>`;
  },
};

PAGES['r-help'] = {
  title: 'Help & notices', ...resOnly,
  render() {
    const r = meRes(); if (!r) return noRecord();
    const mine = Store.all('cmp').filter(c => c.resId === r.id).sort(by('ts', -1));
    const notices = Store.all('notice').slice().sort((a, b) => (b.pinned - a.pinned) || (b.date > a.date ? 1 : -1));
    const ph = S().pay.phone || (Store.hostel() || {}).phone;
    const myMsgs = rinfos().filter(x => x.resId === r.id).sort(by('ts', -1)).slice(0, 10);
    return `<div class="narrow">${head('Help & notices', '', `${btn('Tell the owner', 'rtell', '', '', 'chat')}${btn('New complaint', 'rcmp', '', 'primary', 'plus')}`)}
      ${orgEnabled('complaints') ? group('I told the owner', myMsgs.map(x => li({
        icon: rinfoIcon(x.type), ic: x.status === 'seen' ? 'ok' : 'info',
        t: rinfoLabel(x.type),
        d: [x.text, x.from ? `${fmtShort(x.from)}${x.to && x.to !== x.from ? ' – ' + fmtShort(x.to) : ''}` : '', ago(x.ts), x.reply ? `${t('Owner')}: ${x.reply}` : ''].filter(Boolean).join(' · '),
        end: x.status === 'seen' ? badge('Seen', 'ok') : badge('Sent'), chev: false,
      })).join(''), t('Unwell, going home, back late — anything the owner should know.')) : ''}
      ${orgEnabled('complaints') ? group('My complaints', mine.map(c => li({ icon: 'wrench', ic: c.status === 'resolved' ? 'ok' : c.status === 'progress' ? 'warn' : 'bad', t: `${t(c.cat)} · ${t(c.status === 'resolved' ? 'Resolved' : c.status === 'progress' ? 'In progress' : 'Open')}`, d: `${c.text}${c.reply ? ' → ' + c.reply : ''} · ${ago(c.ts)}` })).join('')) : ''}
      ${group('Notices', notices.map(n => li({ icon: 'megaphone', ic: 'teal', t: `${n.pinned ? '📌 ' : ''}${n.title}`, d: `${n.body} · ${fmtShort(n.date)}` })).join(''))}
      ${ph ? group('Contact owner', `${li({ icon: 'phone', ic: 'ok', t: t('Call'), end: `<a class="btn sm" href="tel:${esc(ph)}">${esc(ph)}</a>` })}${li({ icon: 'wa', ic: 'ok', t: 'WhatsApp', end: `<a class="btn sm wa" href="${esc(waUrl(ph, `Hi, ${r.name} (${roomName(r.roomId)}) here. `))}" target="_blank" rel="noopener">${esc(t('Chat'))}</a>` })}`) : ''}</div>`;
  },
};
// Dates are optional: "I am unwell today" needs none, "away from the 4th to the 7th" does.
A.rtell = () => {
  const r = meRes(); if (!r) return;
  formModal({
    title: 'Tell the owner', submit: 'Send',
    note: t('The owner is told straight away. For a problem in the hostel, raise a complaint instead.'),
    fields: [
      { name: 'type', label: 'What is it about?', type: 'select', options: RINFO_TYPES.map(([v, l]) => ({ v, l: t(l) })), required: true },
      { name: 'text', label: 'Anything to add?', type: 'textarea', full: true, placeholder: 'Optional' },
      { name: 'dates', label: 'It is for particular dates', type: 'checkbox', full: true },
      { name: 'from', label: 'From', type: 'date', value: today(), hidden: true },
      { name: 'to', label: 'To (including)', type: 'date', value: today(), hidden: true },
    ],
    onChange: (v, form) => { showField(form, 'from', v.dates); showField(form, 'to', v.dates); },
    onSubmit: v => {
      sendRinfo({ resId: r.id, type: v.type, from: v.dates ? v.from : '', to: v.dates ? v.to : '', text: v.text });
      toast('Sent to the owner');
    },
  });
};
A.rcmp = () => { const r = meRes(); formModal({ title: 'New complaint', fields: [{ name: 'cat', label: 'Category', type: 'select', options: CMP_CATS }, { name: 'text', label: 'Problem', type: 'textarea', required: true, full: true }], onSubmit: v => { Store.put('cmp', { resId: r.id, roomId: r.roomId, cat: v.cat, text: v.text, status: 'open', date: today(), ts: nowIso(), src: 'resident' }); notify({ to: 'admin', title: t('New complaint'), body: `${roomName(r.roomId)} · ${t(v.cat)}`, link: 'complaints' }); toast('Complaint sent'); } }); };
