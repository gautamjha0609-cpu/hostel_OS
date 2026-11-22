'use strict';
/* Resident app: dues & UPI pay, meals (skip / tiffin), room cleaning, laundry, complaints & notices. */

const meRes = () => resById(ctx().refId);
const resOnly = { when: () => isResident() && orgEnabled('residentApp') };
// `mod:` goes through can(), and ROLES.resident.mods is empty by design, so each resident
// screen checks the module itself. Otherwise a bookmarked link reaches a page whose module
// the hostel does not have — the menu hides it, but the URL still worked.
const resMod = m => ({ when: () => isResident() && orgEnabled('residentApp') && orgEnabled(m) });
/* When a resident's own record cannot be found. There are three very different reasons, and each gets its own screen:
 *  1. the app is still loading (first sign-in, slow network): show "loading" and try again by itself - never an error;
 *  2. they have checked out: say so, plainly;
 *  3. the login is really not linked to a resident: say what to do, with the owner's number and a way to retry. */
let noRecTries = 0;
function noRecord() {
  if (!isResident()) { setTimeout(() => go(homeFor()), 0); return ''; }   // a staff or owner login on a resident address: send them home
  const gone = Store.get(ctx().refId), loading = CLOUD && !Store.lastSync && noRecTries < 8;
  if (loading) { noRecTries++; setTimeout(() => { if (!meRes()) render(); }, 1200); return `<div class="narrow"><div class="card nr"><div class="spin"></div><b>${esc(t('Loading your details...'))}</b><p>${esc(t('This takes a moment the first time.'))}</p></div></div>`; }
  noRecTries = 0;
  if (gone && gone.status === 'left') return `<div class="narrow"><div class="card nr"><span class="nr-ic ok">${ico('check')}</span><b>${esc(t('You have checked out'))}</b><p>${esc(t('Thank you for staying with us. Your records are with the owner.'))}</p><div class="nr-a">${btn('Log out', 'logout', '', '', 'logout')}</div></div></div>`;
  const ph = phone10((S().pay || {}).phone || (Store.hostel() || {}).phone || '');
  return `<div class="narrow"><div class="card nr"><span class="nr-ic">${ico('user')}</span><b>${esc(t('Your account is not linked to a room yet'))}</b><p>${esc(t('The owner needs to link your login to your resident record. Tell them your mobile number and they can fix it in a minute.'))}</p>
    <div class="nr-a">${ph ? `<a class="btn primary" href="tel:${esc(ph)}">${ico('phone', 'sm')} ${esc(t('Call the owner'))}</a><a class="btn wa" href="https://wa.me/91${esc(ph)}" target="_blank" rel="noopener">${ico('wa', 'sm')} WhatsApp</a>` : ''}${btn('Try again', 'syncnow', '', '', 'sync')}${btn('Log out', 'logout', '', 'ghost', 'logout')}</div></div></div>`;
}

PAGES['r-home'] = {
  title: 'Home', ...resOnly,
  render() {
    if (!orgEnabled('residentApp')) return `<div class="card">${empty('Resident app is not enabled', 'Please contact the PG owner.')}</div>`;
    const r = meRes(); if (!r) return noRecord();
    setTimeout(resumeUpiAwait, 600);
    const due = resDue(r.id), open = openInv(r.id), p = S().pay;
    const pending = Store.all('claim').filter(c => c.resId === r.id && c.status === 'pending');
    const next = meals().find(m => nowMinutes() < minutes(m.time));
    const { feeNotices, generalNotices } = typeof residentNoticeBoard === 'function' ? residentNoticeBoard(r.id) : { feeNotices: [], generalNotices: [] };
    const task = hkTasks().filter(x => x.roomId === r.roomId && x.date >= today()).sort(by('date'))[0];
    const agr = typeof getActiveAgreement === 'function' ? getActiveAgreement(r.id) : null;
    const tab = curTab('rht', 'bills');
    const paidTill = r.paidTill && r.paidTill >= today() ? `<div class="note ok">${ico('check', 'sm')} ${esc(t('Your rent is paid till {d}', { d: fmtDate(r.paidTill) }))}</div>` : '';
    const payRow = `${pending.length ? `<div class="note">${ico('clock', 'sm')} ${esc(t('{a} payment waiting for owner to verify', { a: inr(sum(pending, c => c.amount)) }))}</div>` : ''}${due ? `<div class="rh-pay"><button class="btn primary" data-act="rcfpay">${ico('rupee', 'sm')} <span>${esc(t('Pay with UPI'))}</span></button><button class="btn" data-act="rqr">${ico('qr', 'sm')} <span>QR</span></button><button class="btn" data-act="rclaim">${ico('check', 'sm')} <span>${esc(t('I have paid'))}</span></button></div>` : ''}`;
    const openCmp = Store.all('cmp').filter(c => c.resId === r.id && c.status !== 'resolved').length;
    const quick = `<button type="button" class="rh-help" data-act="go" data-to="r-help"><span class="ic ok">${ico('chat')}</span><span class="rh-hb"><b>${esc(t('Help & notices'))}</b><small>${esc(openCmp ? t('{n} open complaints', { n: openCmp }) : t('Complaints, messages to the owner, notices'))}</small></span>${ico('chev', 'chev')}</button>`;
    const todayParts = orgEnabled('mess') && next ? `<div class="card"><h3>${ico('utensils', 'sm')} ${esc(mealName(next.k))} · ${fmtTime(next.time)}<span class="sp"></span><a class="sm" href="/r-meals">${esc(t('All meals'))}</a></h3>${mealRow(r, today(), next)}</div>` : '' + orgEnabled('housekeeping') && task ? group('Room cleaning', li({ icon: 'broom', ic: task.status === 'done' ? 'ok' : 'info', t: task.date === today() ? t('Today') : fmtDate(task.date), d: `${task.schedName || ''}${task.time ? ' · ' + fmtTime(task.time) : ''} · ${t(HK_STAT[task.status][0])}`, act: 'go', attrs: 'data-to="r-clean"' })) : '';
    const todayBlock = todayParts.trim() ? `<div class="group-t">${esc(t('Today'))}</div>${todayParts}` : '';
    return `<div class="narrow stack rh">
      ${homeHero({
        name: r.name.split(' ')[0], sub: `${esc(hostelName())}<br>${esc(t('Room'))} ${esc(roomName(r.roomId))}-${esc(r.bed)}`,
        cards: [
          { l: due ? 'Amount due' : 'All paid', icon: 'wallet', v: inr(due), tone: due ? 'bad' : 'ok', act: 'rdue', s: esc(due ? t('{n} open bills', { n: open.length }) : t('Nothing to pay')) + ` · ${esc(t('Tap for details'))}` },
          { l: 'Next meal', icon: 'utensils', v: next ? esc(mealName(next.k)) : '-', tone: '', s: esc(next ? fmtTime(next.time) : t('No more meals today')), to: 'r-meals' },
        ],
        strip: [
          { icon: 'bed', v: `${esc(roomName(r.roomId))}-${esc(r.bed)}`, l: 'Your room' },
          { icon: 'file', v: open.length, l: 'Open bills' },
          { icon: 'broom', v: task ? esc(task.date === today() ? t('Today') : fmtShort(task.date)) : '-', l: 'Next cleaning' },
        ],
      })}
      ${paidTill}
      ${payRow}
      ${quick}
      ${todayBlock}
      ${seg('rht', [['bills', 'Bills', open.length], ['room', 'My room'], ['notices', 'Notices', generalNotices.length]], 'bills')}
      ${tab === 'bills' ? `
      ${(() => { const cl = Store.all('claim').filter(c => c.resId === r.id && (c.status !== 'approved' || (c.ts || '') > addDays(today(), -7))).sort(by('ts', -1)).slice(0, 4); return cl.length ? group('My payment confirmations', cl.map(c => li({ icon: c.status === 'approved' ? 'check' : c.status === 'rejected' ? 'alert' : 'clock', ic: c.status === 'approved' ? 'ok' : c.status === 'rejected' ? 'bad' : 'warn', t: `${inr(c.amount)} · UTR ${c.utr}`, d: c.status === 'rejected' ? `${t('Not verified')}: ${c.reason || ''}` : c.status === 'approved' ? t('Confirmed by the owner · receipt in Transaction history') : t('Waiting for the owner to check the UTR and screenshot'), end: badge(c.status === 'approved' ? 'Confirmed' : c.status === 'rejected' ? 'Rejected' : 'Waiting', c.status === 'approved' ? 'ok' : c.status === 'rejected' ? 'bad' : 'warn'), chev: false })).join('')) : ''; })()}
      ${feeNotices.some(fn => fn.balance > 0) ? group('Fees & Billing Notices', feeNotices.filter(fn => fn.balance > 0).map(fn => li({ icon: fn.status === 'paid' ? 'check' : (fn.status === 'overdue' ? 'alert' : 'rupee'), ic: fn.status === 'paid' ? 'ok' : (fn.status === 'overdue' ? 'bad' : 'warn'), t: `${fn.isCurrent ? '⭐ ' : ''}${fn.title}`, d: `${fn.body} · ${fmtDate(fn.date)}`, end: fn.balance > 0 ? `<b class="${fn.status === 'overdue' ? 'bad-t' : ''}">${inr(fn.balance)}</b>` : badge('Paid', 'ok'), act: 'rviewinv', attrs: `data-id="${fn.invId || fn.id || ''}"` })).join('')) : (open.length ? group('Bill details', open.map(i => li({ icon: i.type === 'electricity' ? 'bolt' : i.type === 'laundry' ? 'shirt' : 'rupee', ic: invStat(i) === 'overdue' ? 'bad' : 'info', t: i.title, d: `${t('due')} ${fmtShort(i.due)}`, end: `<b>${inr(invBal(i))}</b>`, act: 'rviewinv', attrs: `data-id="${i.id}"` })).join('')) : '')}
      ${group('Transaction history', Store.all('pay').filter(x => x.resId === r.id).sort(by('date', -1)).slice(0, 4).map(x => li({ icon: 'check', ic: 'ok', t: inr(x.amount), d: `${fmtDate(x.date)} · ${x.mode.toUpperCase()}`, act: 'receipt', attrs: `data-id="${x.id}"` })).join(''))}` : tab === 'room' ? `
      ${orgEnabled('electricity') ? (() => {
        const elecCfg = S().elec || {};
        const scanRole = elecCfg.scanRole || 'both';
        const last = lastMeter(r.roomId);
        const curYM = ymOf(today());
        const pending = pendingMeter(r.roomId);
        const isBilledThisMonth = last && ymOf(last.date) === curYM;

        if (scanRole === 'staff_only') {
          const elecInv = typeof resInvoices === 'function' ? resInvoices(r.id).find(i => i.type === 'electricity' && (i.period === curYM || (i.date && ymOf(i.date) === curYM))) : null;
          return group('Room electricity meter', li({
            icon: 'bolt',
            ic: 'mute',
            t: t('Room electricity meter'),
            d: last ? t('Managed by hostel staff · Last reading: {u} units on {d}', { u: num(last.curr), d: fmtShort(last.date) }) : t('Managed by hostel staff / warden'),
            act: elecInv ? 'rviewinv' : '',
            attrs: elecInv ? `data-id="${elecInv.id}"` : '',
            chev: !!elecInv,
            end: badge('Staff managed', 'mute')
          }));
        }

        if (pending) {
          const submitter = pending.submittedBy || t('Roommate');
          return group('Room electricity meter', li({
            icon: 'bolt',
            ic: 'info',
            t: t('Reading under review'),
            d: t('Reading of {u} units submitted by {name} on {d} is waiting for owner approval.', { u: num(pending.curr), name: submitter, d: fmtShort(pending.date) }),
            chev: false,
            end: badge('Pending review', 'info')
          }));
        }

        if (isBilledThisMonth) {
          const elecInv = typeof resInvoices === 'function' ? resInvoices(r.id).find(i => i.type === 'electricity' && (i.period === curYM || (i.date && ymOf(i.date) === curYM))) : null;
          return group('Room electricity meter', li({
            icon: 'bolt',
            ic: 'ok',
            t: t('Room meter reading recorded'),
            d: t('Reading of {u} units recorded on {d} · Billed for {m}', { u: num(last.curr), d: fmtShort(last.date), m: fmtYM(curYM) }),
            act: 'relec',
            end: badge('Billed', 'ok')
          }));
        }

        return group('Room electricity meter', li({
          icon: 'bolt',
          ic: 'warn',
          t: t('Enter room meter reading'),
          d: last ? t('Type Room {r}\'s meter reading (last: {u} on {d})', { r: roomName(r.roomId), u: num(last.curr), d: fmtShort(last.date) }) : t('Type Room {r}\'s meter reading', { r: roomName(r.roomId) }),
          act: 'rmeterread',
          end: badge('Action needed', 'warn')
        }));
      })() : ''}
      ${orgEnabled('electricity') ? (() => { const mine = resElecReadings(r.id); if (!mine.length) return ''; const m = mine[0], sh = m.shares.find(x => x.resId === r.id);
        return group('', li({ icon: 'bolt', ic: 'tn3', t: t('My electricity'), d: t('Last bill {a} · reading of {d}', { a: inr(sh.amount), d: fmtShort(m.date) }), act: 'relec', end: `<b>${inr(sh.amount)}</b>` })); })() : ''}
      ${agr ? group('Rental agreement', li({ icon: 'file', ic: 'ok', t: `${t('Rental agreement')} (v${agr.version})`, d: `${fmtDate(agr.startDate)} – ${fmtDate(agr.endDate)} · ${inr(agr.rent)}/mo`, act: 'agrview', attrs: `data-id="${agr.id}"` })) : ''}
      ${attOn() ? (() => { const m = attMonth(r.id, ymOf(today())); return group('My attendance', li({ icon: 'check', ic: m.absent ? 'warn' : 'ok', t: t('{n} days present', { n: m.present }), d: m.absent ? t('{n} days marked absent in {m}: {d}', { n: m.absent, m: fmtYM(ymOf(today())), d: m.absentDays.join(', ') }) : t('Nothing marked absent in {m}', { m: fmtYM(ymOf(today())) }), chev: false })); })() : ''}` : `
      ${generalNotices.length ? noticeCards(generalNotices, r) : `<div class="card muted">${esc(t('No general notices in the last 30 days.'))}</div>`}`}
    </div>`;
  },
};
A.rqr = el => {
  const r = meRes(), due0 = resDue(r.id);
  if (!(due0 > 0)) return toast(t('No dues to pay'), 'ok');
  const buckets = payBuckets(r);
  if (!buckets.length || !buckets.every(b => b.upi)) return toast(t('The owner has not added a UPI ID yet. Please pay the owner directly.'), 'bad');
  const kind = el && el.dataset && el.dataset.kind;
  // Rent and electricity go to different UPI IDs: pick which one to pay first, each has its own QR and its own proof.
  if (buckets.length > 1 && !kind) {
    return sheet(t('What do you want to pay?'), `<div class="group">${buckets.map(b => li({ icon: b.kind === 'elec' ? 'bolt' : 'rupee', ic: b.kind === 'elec' ? 'warn' : 'info', t: t(b.label), d: b.invs.map(i => i.title).join(', '), end: `<b>${inr(b.total)}</b>`, act: 'rqr', attrs: `data-kind="${b.kind}"` })).join('')}</div>
      <p class="hint" style="margin-top:10px">${esc(t('Rent and electricity are paid to different UPI IDs. Each one is confirmed separately.'))}</p>`);
  }
  const bk = buckets.find(b => b.kind === kind) || buckets[0], due = bk.total, upiId = bk.upi;
  const note = `${r.name.split(' ')[0]} Rm ${roomName(r.roomId)} ${fmtYM(ymOf(today()))}`, uri = upiUri(due, note, upiId);
  const hId = Store.hostelId || (Store.hostel() || {}).id;
  const payUrl = `${location.origin}/pay.html?hostel_id=${hId}&res_id=${r.id}&am=${due}`;
  const open = openInv(r.id);
  sheet(t('Pay {a}', { a: inr(due) }), `<div class="qr">${qrSvg(uri, 6)}</div>
    <p style="text-align:center;margin:10px 0 2px"><b style="font-size:24px">${inr(due)}</b><br><span class="muted">${esc(S().pay.payee || hostelName())} · ${esc(upiId)}</span></p>
    ${bk.invs.length ? `<div class="group" style="margin-top:10px">${bk.invs.map(i => li({ icon: i.type === 'electricity' ? 'bolt' : 'rupee', ic: 'tn0', t: i.title, end: `<b>${inr(invBal(i))}</b>`, chev: false })).join('')}</div>` : ''}
    <div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap;justify-content:center">${/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') ? `<a class="btn primary" data-act="rupiopen" href="${esc(uri)}">${ico('rupee', 'sm')} ${esc(t('Open my UPI app'))}</a>` : `<p class="hint" style="width:100%;text-align:center;margin:0">${esc(t('On a computer, scan the QR with your phone\'s UPI app.'))}</p>`}${orgEnabled('cashfree') ? `<a class="btn" href="${esc(payUrl)}" target="_blank" rel="noopener">${esc(t('Online pay page'))}</a>` : ''}</div>
    <p class="hint" style="text-align:center;margin-top:10px">${esc(t('The amount and the UPI ID of the owner are already filled in. After paying, come back here and add the UTR and a screenshot - both are needed so the owner can confirm.'))}</p>`,
    { foot: `<button class="btn primary block" data-act="rclaim" data-kind="${bk.kind}">${esc(t('I have paid'))}</button>` });
};
// Came back from the UPI app: bring up the proof form (UTR + screenshot) straight away
let upiAwait = null;
A.rupiopen = el => { const k = el && el.closest && el.closest('.modal') && el.closest('.modal').querySelector('[data-act="rclaim"]'); upiAwait = { at: Date.now(), amount: resDue((meRes() || {}).id), kind: k && k.dataset.kind }; try { LS.set('hostelos.upiwait', JSON.stringify(upiAwait)); } catch (e) { /* ignore */ } };
// the page was unloaded while the UPI app was open: ask once on return
function resumeUpiAwait() {
  let w; try { w = JSON.parse(LS.get('hostelos.upiwait') || 'null'); } catch (e) { w = null; }
  if (!w) return; LS.set('hostelos.upiwait', '');
  if (Date.now() - w.at > 30 * 60e3 || Date.now() - w.at < 4000 || upiAwait) return;
  if (!(resDue((meRes() || {}).id) > 0)) return;
  setTimeout(() => A.rclaim(null, null, w.amount, w.kind), 500);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !upiAwait) return;
  const w = upiAwait; upiAwait = null; try { LS.set('hostelos.upiwait', ''); } catch (e) { /* ignore */ }
  if (Date.now() - w.at < 4000) return;           // bounced straight back: nothing was paid
  setTimeout(() => A.rclaim(null, null, w.amount, w.kind), 300);
});

// Tap on the red Amount due card: every bill with what is still pending, then every payment made so far.
A.rdue = () => {
  const r = meRes(); if (!r) return;
  const invs = (typeof resInvoices === 'function' ? resInvoices(r.id) : Store.all('inv').filter(i => i.resId === r.id)).slice().sort(by('due', -1));
  const openI = invs.filter(i => invBal(i) > 0), due = sum(openI, invBal);
  const pays = Store.all('pay').filter(x => x.resId === r.id).sort(by('date', -1));
  const claims = Store.all('claim').filter(c => c.resId === r.id && c.status !== 'approved').sort(by('ts', -1));
  const none = msg => `<div class="li noic"><span class="body muted">${esc(t(msg))}</span></div>`;
  const billRow = i => li({
    icon: i.type === 'electricity' ? 'bolt' : i.type === 'laundry' ? 'shirt' : 'rupee', ic: invStat(i) === 'overdue' ? 'bad' : 'info', t: i.title,
    d: `${t('Bill')} ${inr(i.amount != null ? i.amount : (invBal(i) + (i.paid || 0)))}${(i.paid || 0) > 0 ? ` · ${t('Paid')} ${inr(i.paid)}` : ''} · ${t('due')} ${fmtShort(i.due)}`,
    end: `<b class="${invStat(i) === 'overdue' ? 'bad-t' : ''}">${inr(invBal(i))}</b>`, act: 'rviewinv', attrs: `data-id="${i.id}"`
  });
  const claimRow = c => li({
    icon: c.status === 'rejected' ? 'alert' : 'clock', ic: c.status === 'rejected' ? 'bad' : 'warn', t: `${inr(c.amount)} · UTR ${c.utr || ''}`,
    d: c.status === 'rejected' ? `${t('Not verified')}: ${c.reason || ''}` : t('Waiting for the owner to check the UTR'), chev: false
  });
  const payRow = x => li({ icon: 'check', ic: 'ok', t: inr(x.amount), d: `${fmtDate(x.date)} · ${String(x.mode || '').toUpperCase()}${x.ref ? ' · ' + x.ref : ''}`, act: 'receipt', attrs: `data-id="${x.id}"` });
  sheet(t('Amount due'), `
    <div class="hero" style="margin-bottom:12px"><div class="muted sm">${esc(t('Total pending'))}</div><div class="big">${inr(due)}</div></div>
    ${group('Pending bills', openI.map(billRow).join('') || none('Nothing to pay'))}
    ${claims.length ? group('Payments waiting for the owner', claims.map(claimRow).join('')) : ''}
    ${group('Transaction history', pays.map(payRow).join('') || none('No payments yet'))}`,
    { foot: due ? `<button class="btn primary" data-act="rcfpay">${ico('rupee', 'sm')} ${esc(t('Pay with UPI'))}</button>` : `<button class="btn" data-act="close">${esc(t('Close'))}</button>` });
};
A.rviewinv = el => {
  const invId = el.dataset.id;
  const r = meRes();
  if (!r) return;

  // 1. Handle clicking on a monthly fee notice (fee-notice-YYYY-MM)
  if (invId && invId.startsWith('fee-notice-')) {
    const ym = invId.replace('fee-notice-', '');
    const allInvs = typeof resInvoices === 'function' ? resInvoices(r.id) : Store.all('inv').filter(i => i.resId === r.id);
    const invsInYM = allInvs.filter(i => (i.due && i.due.slice(0, 7) === ym) || (i.day && i.day.slice(0, 7) === ym) || (i.date && ymOf(i.date) === ym) || (i.period === ym));
    const totalDue = sum(invsInYM, invBal);
    const elecInv = invsInYM.find(i => i.type === 'electricity');

    let elecDetailsHtml = '';
    if (elecInv) {
      const m = Store.get(elecInv.meterId) || Store.all('meter').find(x => x.id === elecInv.meterId || (elecInv.id && elecInv.id.includes(x.id))) || lastMeter(elecInv.roomId || r.roomId);
      const s = m && (m.shares || []).find(x => x.resId === elecInv.resId || x.resId === r.id);
      if (m && s) elecDetailsHtml = `<div style="margin-bottom:12px">${elecShareCard(m, s, { title: t('Electricity Meter Split'), sub: `${t('Room Readings')}: ${num(m.prev)} → ${num(m.curr)} (${num(m.units)} ${t('units')})` })}</div>`;
    }

    const html = `
      <div class="card" style="font-size:13px;line-height:1.6">
        <div style="text-align:center;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px">
          
          <h3 style="margin:0">${esc(t('Fee Notice & Bills · {m}', { m: fmtYM(ym) }))}</h3>
          <span class="muted xs">${esc(hostelName())} · ${esc(roomName(r.roomId))}-${esc(r.bed)}</span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:8px 12px;border-radius:8px;background:${totalDue > 0 ? 'rgba(255,59,48,0.08)' : 'rgba(52,199,89,0.1)'}">
          <span><b>${esc(t('Total Outstanding Due'))}</b></span>
          <b style="font-size:18px;color:${totalDue > 0 ? 'var(--bad)' : 'var(--ok)'}">${inr(totalDue)}</b>
        </div>

        <div class="group-t" style="margin-bottom:6px">${esc(t('Itemized Monthly Charges'))} (${invsInYM.length})</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
          ${invsInYM.map(i => `
            <div class="card" style="padding:10px 12px;margin:0;border:1px solid var(--line)">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <b>${esc(i.title)}</b>
                <b class="${invBal(i) > 0 ? 'bad-t' : 'ok-t'}">${inr(i.amount)}</b>
              </div>
              <div class="xs muted" style="margin-top:2px;display:flex;justify-content:space-between">
                <span>${t('Paid')}: ${inr(i.paid || 0)}${i.waived ? ` · ${t('Waived')}: ${inr(i.waived)}` : ''}</span>
                <span>${invBal(i) > 0 ? `<b class="bad-t">${t('Due')}: ${inr(invBal(i))}</b>` : `<b class="ok-t">${t('Paid ✓')}</b>`}</span>
              </div>
            </div>
          `).join('')}
        </div>

        ${elecDetailsHtml}
      </div>
    `;

    const foot = totalDue > 0
      ? `<button class="btn primary block" data-act="rcfpay">${ico('rupee', 'sm')} ${esc(t('Pay Dues Online'))} (${inr(totalDue)})</button>`
      : `<button class="btn block" data-act="closemodal">${esc(t('Close'))}</button>`;

    sheet(t('Billing Statement · {m}', { m: fmtYM(ym) }), html, { foot });
    return;
  }

  const inv = Store.get(invId) || Store.all('inv').find(x => x.id === invId);
  if (!inv) return;

  const isElec = inv.type === 'electricity' || (inv.title && inv.title.toLowerCase().includes('electricity'));
  if (isElec) {
    const m = Store.get(inv.meterId) || Store.all('meter').find(x => x.id === inv.meterId || (inv.id && inv.id.includes(x.id))) || lastMeter(inv.roomId || (r && r.roomId));
    const s = m && (m.shares || []).find(x => x.resId === inv.resId || (r && x.resId === r.id));
    const rate = (m && m.rate) || S().elec.rate || 10;
    const roomUnits = m ? m.units : (inv.amount / rate);
    const prevReading = m ? m.prev : '—';
    const currReading = m ? m.curr : '—';
    const fromDate = m ? (m.prevDate || '') : '';
    const toDate = m ? m.date : inv.date;

    const html = `
      <div class="card" style="font-size:13px;line-height:1.6">
        <div style="text-align:center;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px">
          
          <h3 style="margin:0">${esc(t('Electricity Bill Statement'))}</h3>
          <span class="muted xs">${esc(t('Room'))} ${esc(roomName(inv.roomId || (r && r.roomId)))} · ${fmtDate(toDate)}</span>
        </div>

        <div class="card" style="background:var(--subtle);padding:10px;border-radius:8px;margin-bottom:12px;border:1px solid var(--line)">
          <div style="font-weight:700;margin-bottom:6px;font-size:13.5px">${esc(t('1. Room Meter Reading'))}</div>
          <dl class="kv sm" style="margin:0">
            <dt>${esc(t('Reading Period'))}</dt><dd>${fromDate ? fmtDate(fromDate) + ' → ' : ''}${fmtDate(toDate)}</dd>
            <dt>${esc(t('Meter Readings'))}</dt><dd><b>${num(prevReading)} → ${num(currReading)}</b></dd>
            <dt>${esc(t('Room Consumption'))}</dt><dd><b>${num(roomUnits)} ${t('units')}</b></dd>
            <dt>${esc(t('Tariff Rate'))}</dt><dd>₹${rate} / ${t('unit')}</dd>
          </dl>
        </div>

        <div class="card" style="background:var(--subtle);padding:10px;border-radius:8px;margin-bottom:12px;border:1px solid var(--line)">
          <div style="font-weight:700;margin-bottom:6px;font-size:13.5px">${esc(t('2. Your Pro-Rata Share'))}</div>
          <dl class="kv sm" style="margin:0">
            <dt>${esc(t('Room units share'))}</dt><dd><b>${num(s ? s.units : (inv.amount / rate))} ${t('units')}</b></dd>
            <dt class="ok-t">${esc(t('Free quota deducted'))}</dt><dd class="ok-t"><b>-${num(s ? s.free : 0)} ${t('units')}</b></dd>
            <dt>${esc(t('Net billable units'))}</dt><dd><b>${num(s ? s.billable : (inv.amount / rate))} ${t('units')}</b></dd>
            <dt style="border-top:1px solid var(--line);padding-top:4px"><b>${esc(t('Total Bill Amount'))}</b></dt>
            <dd style="border-top:1px solid var(--line);padding-top:4px"><b class="ok-t" style="font-size:15px">${inr(inv.amount)}</b></dd>
            <dt>${esc(t('Paid so far'))}</dt><dd>${inr(inv.paid || 0)}</dd>
            <dt><b>${esc(t('Balance Due'))}</b></dt><dd><b class="${invBal(inv) > 0 ? 'bad-t' : 'ok-t'}">${inr(invBal(inv))}</b></dd>
          </dl>
        </div>

        <div style="text-align:center;margin-top:10px">
          <button type="button" class="btn xs ghost" data-act="elecsplitinfo" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);padding:4px 10px;border-radius:16px;border:1px solid var(--line);background:var(--subtle)">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--accent-solid);color:#fff;font-weight:700;font-size:10px">i</span>
            <span>${esc(t('How is this bill calculated?'))}</span>
          </button>
        </div>
      </div>
    `;

    const foot = invBal(inv) > 0
      ? `<button class="btn primary block" data-act="rcfpay">${ico('rupee', 'sm')} ${esc(t('Pay Bill Now'))} (${inr(invBal(inv))})</button>`
      : `<button class="btn block" data-act="closemodal">${esc(t('Close'))}</button>`;

    sheet(inv.title, html, { foot });
    return;
  }

  // Standard invoice view (rent / other)
  const html = `
    <div class="card" style="font-size:13px;line-height:1.6">
      <div style="text-align:center;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px">
        <h3 style="margin:0">${esc(inv.title)}</h3>
        <span class="muted xs">${esc(hostelName())} · ${fmtDate(inv.date || today())}</span>
      </div>
      <dl class="kv">
        <dt>${esc(t('Category'))}</dt><dd>${badge(inv.type || 'fee', 'info')}</dd>
        <dt>${esc(t('Total Amount'))}</dt><dd><b>${inr(inv.amount)}</b></dd>
        <dt>${esc(t('Paid'))}</dt><dd>${inr(inv.paid || 0)}</dd>
        ${inv.waived ? `<dt>${esc(t('Discount / Waived'))}</dt><dd class="ok-t">${inr(inv.waived)}</dd>` : ''}
        <dt style="border-top:1px solid var(--line);padding-top:4px"><b>${esc(t('Balance Due'))}</b></dt>
        <dd style="border-top:1px solid var(--line);padding-top:4px"><b class="${invBal(inv) > 0 ? 'bad-t' : 'ok-t'}" style="font-size:16px">${inr(invBal(inv))}</b></dd>
        ${inv.due ? `<dt>${esc(t('Due Date'))}</dt><dd>${fmtDate(inv.due)}</dd>` : ''}
      </dl>
    </div>
  `;
  const foot = invBal(inv) > 0
    ? `<button class="btn primary block" data-act="rcfpay">${ico('rupee', 'sm')} ${esc(t('Pay Now'))} (${inr(invBal(inv))})</button>`
    : `<button class="btn block" data-act="closemodal">${esc(t('Close'))}</button>`;
  sheet(inv.title, html, { foot });
};

// Official Cashfree UPI Checkout flow for resident
A.rcfpay = async () => {
  const r = meRes(), due = resDue(r.id);
  if (!due || due <= 0) return toast(t('No dues to pay'), 'ok');
  const h = Store.hostel();
  if (!h || !h.id) return toast(t('Hostel information missing'), 'bad');
  // No online gateway (demo, or the owner has not set one up): the direct UPI link and QR with the exact amount are the way to pay
  if (!CLOUD || !orgEnabled('cashfree')) return A.rqr();

  sheet(t('Pay dues with UPI'), `<div class="card" style="text-align:center;padding:24px 16px"><div class="spin"></div><p style="margin-top:12px" class="muted">${esc(t('Opening Cashfree UPI checkout...'))}</p></div>`);
  try {
    const res = await fetch('/api/public?sub=create_payment_order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostel_id: h.id,
        res_id: r.id,
        amount: due,
        return_url: `${location.origin}/pay.html`
      })
    });
    const j = await res.json();
    if (!j || !j.ok) {
      closeModal();
      return S().pay.upiId ? A.rqr() : toast(j?.error || 'Could not create payment order', 'bad');
    }
    const payUrl = `/pay.html?order_id=${encodeURIComponent(j.order_id)}`;
    const payWindow = window.open(payUrl, '_blank');
    if (!payWindow) {
      location.assign(payUrl);
    } else {
      closeModal();
      toast(t('Payment window opened. Complete payment in your UPI app.'));
    }
  } catch (err) {
    closeModal();
    if (S().pay.upiId) return A.rqr();
    toast('Failed to reach payment gateway: ' + err.message, 'bad');
  }
};
// Resident reports a UPI payment; owner verifies with one tap in Approvals.
A.rclaim = (el, ev, amount, kind0) => {
  const r = meRes();
  const kind = (el && el.dataset && el.dataset.kind) || kind0 || '';
  const bk = payBuckets(r).find(b => b.kind === kind);
  if (bk && !amount) amount = bk.total;
  formModal({
    title: 'I have paid', submit: 'Send to owner',
    note: t('Both are needed: the 12-digit UPI reference (UTR) from your UPI app, and a screenshot of the successful payment. The owner checks them and you get a receipt.'),
    fields: [{ name: 'amount', label: 'Amount paid (₹)', type: 'number', min: 1, max: 10000000, value: amount || resDue(r.id) || '', required: true }, { name: 'utr', label: 'UTR / transaction ID', inputmode: 'text', autocapitalize: 'characters', required: true, pattern: /^[A-Za-z0-9_-]{6,35}$/ }, { name: 'date', label: 'Paid on', type: 'date', value: today(), required: true }, { name: 'proof', label: 'Payment screenshot', type: 'file', accept: 'image/*', required: true }],
    onSubmit: v => {
      if (!(+v.amount >= 1) || +v.amount > 10000000) return t('Enter the amount you paid (₹1 to ₹1,00,00,000)');
      if (v.date > today()) return t('The date cannot be in the future');
      if (v.date < addDays(today(), -60)) return t('This payment is more than 60 days old. Please ask the owner to record it.');
      const utrStr = String(v.utr || '').trim().replace(/\s+/g, '').toUpperCase();
      const refInfo = classifyPaymentRef(utrStr);
      if (!refInfo.valid) return refInfo.reason;
      if (Store.all('claim').some(c => String(c.utr || '').toUpperCase() === utrStr && c.status !== 'rejected') || Store.all('pay').some(p => String(p.ref || '').toUpperCase() === utrStr && !p.reversed)) return 'This UTR was already submitted';
      const saveIt = proofUrl => {
        Store.put('claim', { resId: r.id, roomId: r.roomId, payKind: bk && bk.kind !== 'all' ? bk.kind : '', upi: bk ? bk.upi : '', amount: v.amount, utr: utrStr, refType: refInfo.type, date: v.date, status: 'pending', proofUrl: proofUrl || null, ts: nowIso() });
        notify({ to: 'admin', title: t('UPI payment to verify'), body: `${r.name} · ${inr(v.amount)} (${refInfo.label})${bk && bk.kind === 'elec' ? ' · ' + t('Electricity') : bk && bk.kind === 'rent' ? ' · ' + t('Rent') : ''}`, link: 'inbox' });
        toast('Sent. You will get a receipt once verified.');
        closeModal(); render();
      };
      if (!(v.proof && v.proof[0])) return t('Add the payment screenshot');
      // the screenshot is shrunk before it is stored, so a month of payments never fills the storage
      compressImage(v.proof[0], 1000, 0.6).then(f => { const reader = new FileReader(); reader.onload = ev => saveIt(ev.target.result); reader.readAsDataURL(f); });
      return false;
    },
  });
};

// General notices are phone-notification cards: swipe one away and it stays hidden for this resident (restore link below).
const hiddenNotices = rid => { try { return JSON.parse(LS.get('hostelos.hidn.' + rid) || '[]'); } catch (e) { return []; } };
function noticeCards(list, r) {
  const hid = hiddenNotices(r.id), shown = list.filter(n => !hid.includes(n.id));
  const cards = shown.map(n => swipeCard({ act: 'rnoticehide', id: n.id, icon: 'megaphone', pinned: n.pinned, title: n.title, body: n.body, time: fmtShort(n.date), label: 'Dismiss' })).join('');
  const back = hid.length && list.some(n => hid.includes(n.id)) ? `<button type="button" class="btn sm ghost" data-act="rnoticeshow">${esc(t('Show dismissed notices'))}</button>` : '';
  return cards || back ? `<div class="swp-list fold-list">${cards}</div>${back}` : `<div class="card muted">${esc(t('No general notices in the last 30 days.'))}</div>`;
}
A.rnoticehide = el => { const r = meRes(); if (!r) return; const hid = hiddenNotices(r.id); if (!hid.includes(el.dataset.id)) hid.push(el.dataset.id); LS.set('hostelos.hidn.' + r.id, JSON.stringify(hid.slice(-100))); render(); toast(t('Notice dismissed'), 'ok', { label: 'Undo', run: () => { LS.set('hostelos.hidn.' + r.id, JSON.stringify(hiddenNotices(r.id).filter(x => x !== el.dataset.id))); render(); } }); };
A.rnoticeshow = () => { const r = meRes(); if (!r) return; LS.set('hostelos.hidn.' + r.id, '[]'); render(); };
function mealRow(r, date, m) {
  const sk = skippedOn(r.id, date, m.k), tf = tiffinOn(r.id, date, m.k), byPlan = (tf && !Store.get(tiffinId(r.id, date, m.k))) || (sk && !Store.get(skipId(r.id, date, m.k)));
  const open = beforeCutoff(date, m.k, 'skip'), topen = beforeCutoff(date, m.k, 'tiffin'), leave = onLeave(r.id, date);
  const dishes = dishesFor(date, m.k).map(d => d.name);
  const mess = S().mess, hr = +String(m.time || '12').slice(0, 2);
  const icn = hr < 11 ? 'sun' : hr < 17 ? 'utensils' : 'moon';
  const [cls, label] = leave ? ['info', 'On leave'] : sk ? ['bad', 'Skipped'] : tf ? ['warn', 'Tiffin'] : ['ok', 'Eating'];
  const acts = leave || r.food === false ? '' : `<div class="mealc-acts">${mess.tiffin ? `<button class="btn sm ${tf ? 'primary' : ''}" data-act="rtif" data-date="${date}" data-meal="${m.k}" aria-pressed="${tf}" title="${esc(tf ? t('Tap to cancel the tiffin for this day') : t('Tap to take a tiffin this day'))}" ${topen ? '' : 'disabled'}>${ico('pack', 'sm')}${esc(t('Tiffin'))}${tf ? ' ' + ico('check', 'xs') : ''}</button>` : ''}${mess.skip ? `<button class="btn sm ${sk ? 'bad' : ''}" data-act="rskip" data-date="${date}" data-meal="${m.k}" ${open ? '' : 'disabled'}>${ico('skip', 'sm')}${esc(t(sk ? 'Skipped' : 'Skip'))}</button>` : ''}</div>`;
  const planTag = byPlan ? `<span class="mealc-plan">${ico('cal', 'xs')} ${esc(t('From your weekly plan'))}</span>` : '';
  const when = leave ? '' : open
    ? `<span class="mealc-when">${ico('clock', 'sm')}${esc(t('Change till {t}', { t: `${fmtTime(m.cutoff)}${m.prev ? ' ' + t('previous day') : ''}` }))}</span>`
    : `<span class="mealc-when lock">${ico('lock', 'sm')}${esc(t('Locked'))}</span>`;
  return `<div class="mealc ${sk ? 'is-skip' : ''}">
    <div class="mealc-top"><span class="mealc-ic">${ico(icn)}</span><div class="mealc-t"><b>${esc(mealName(m.k))}</b><span>${fmtTime(m.time)}</span></div><span class="badge ${cls}">${esc(t(label))}</span></div>
    <div class="mealc-dishes">${dishes.length ? dishes.map(x => `<i>${esc(x)}</i>`).join('') : `<em>${esc(t('Menu not set'))}</em>`}</div>
    ${planTag}<div class="mealc-foot">${when}${acts}</div>
  </div>`;
}
PAGES['r-meals'] = {
  title: 'Meals', ...resMod('mess'),
  render() {
    const r = meRes(); if (!r) return noRecord();
    const date = ui.flt.rmd || today();
    const leaves = Store.all('leave').filter(l => l.resId === r.id && l.to >= today());
    return `<div class="narrow">${head('Meals')}
      <div class="days7" style="margin-bottom:14px">${[...Array(7)].map((_, i) => addDays(today(), i)).map(d => `<button class="${d === date ? 'on' : ''}" data-act="setflt" data-k="rmd" data-v="${d}"><span>${DAYS()[parse(d).getDay()]}</span><b>${parse(d).getDate()}</b></button>`).join('')}</div>
      ${r.food === false ? `<div class="note">${esc(t('You are not on the mess plan.'))}</div>` : ''}
      ${r.food !== false && (S().mess.tiffin || S().mess.skip) ? `<div class="group" style="margin-bottom:14px">${(() => { const tt = S().mess.tiffin !== false ? tifPlanText(r.id) : '', ss = S().mess.skip !== false ? tifPlanText(r.id, 'skipPlan') : ''; return `<div class="li tpl" data-act="rtifplan"><span class="ic warn">${ico('cal')}</span><span class="body"><span class="t">${esc(t('Weekly meal plan'))}</span>${tt || ss ? `${tt ? `<span class="tpl-l tif"><i></i>${esc(t('Tiffin'))} · ${esc(tt)}</span>` : ''}${ss ? `<span class="tpl-l skp"><i></i>${esc(t('Skip'))} · ${esc(ss)}</span>` : ''}` : `<span class="d">${esc(t('Set the days once - it happens every week'))}</span>`}</span><span class="end">${btn(tt || ss ? 'Edit' : 'Set', 'rtifplan', '', 'sm primary')}</span></div>`; })()}${S().mess.tiffin ? li({ icon: 'edit', ic: 'warn', t: t('My tiffin note'), d: tifNoteOf(r.id) || t('Tell the kitchen how to pack it - set once, used every time'), act: 'rtifnote', end: btn(tifNoteOf(r.id) ? 'Edit' : 'Add', 'rtifnote', '', 'sm') }) : ''}</div>` : ''}
      <div class="mealc-day">${date === today() ? `<span class="badge ok">${esc(t('Today'))}</span>` : ''}<b>${esc(fmtDate(date))}</b></div>
      <div class="mealc-list">${mealsOn(date).map(m => mealRow(r, date, m)).join('')}</div>
      ${group('Going home? (leave)', [...leaves.map(l => li({ icon: 'cal', ic: 'info', t: `${fmtDate(l.from)} – ${fmtDate(l.to)}`, d: l.reason || '', end: l.from > today() ? btn('', 'rleavedel', `data-id="${l.id}" aria-label="${esc(t('Delete'))}"`, 'sm', 'trash') : '' })), li({ icon: 'plus', ic: 'ok', t: t('Add leave — all meals off'), act: 'rleave' })].join(''))}</div>`;
  },
};
A.rskip = el => { try { const on = toggleSkip(ctx().refId, el.dataset.date, el.dataset.meal); haptic(); toast(on ? 'Meal skipped' : 'Meal back on'); } catch (e) { toast(e.message, 'bad'); } render(); };
A.rtifnote = () => { const r = meRes(); if (!r) return; formModal({ title: 'My tiffin note', note: t('One short line. The cook sees your name with this note on every tiffin you order.'), fields: [{ name: 'note', label: 'How should it be packed?', value: tifNoteOf(r.id), maxlength: TIF_NOTE_MAX, placeholder: t('e.g. 3 roti, dry sabzi, no curd'), full: true }], onSubmit: v => { setTifNote(r.id, v.note); toast('Saved'); } }); };
// The weekly plan editor: two tabs (Tiffin / Skip), meals down the side, weekdays across. A meal on a day can be
// tiffin OR skip, never both: ticking one clears the other.
const tpIcon = m => { const hr = +String(m.time || '12').slice(0, 2); return hr < 11 ? 'sun' : hr < 17 ? 'utensils' : 'moon'; };
function tpPanes(p) {
  const pane = (kind, pre, plan, tone) => `<div class="tp-pane ${kind === 'tp' ? 'on' : ''}" data-p="${kind}">${meals().map(m => `<div class="tpr ${tone}"><div class="tpr-h"><span class="tpr-ic">${ico(tpIcon(m), 'sm')}</span><div class="tpr-t"><b>${esc(mealName(m.k))}</b><small>${esc(fmtTime(m.time))}</small></div><span class="tpq"><button type="button" data-act="tpset" data-p="wk">${esc(t('Mon-Fri'))}</button><button type="button" data-act="tpset" data-p="all">${esc(t('All'))}</button><button type="button" data-act="tpset" data-p="none">${esc(t('Clear'))}</button></span></div><div class="tpc-row">${TIF_PLAN_DAYS.map(d => `<label class="tpc"><input type="checkbox" name="${pre}_${m.k}_${d}" ${((plan || {})[d] || []).includes(m.k) ? 'checked' : ''}><span>${esc(DAYS()[d])}</span></label>`).join('')}</div></div>`).join('')}</div>`;
  const tifOn = S().mess.tiffin !== false, skipOn = S().mess.skip !== false;
  return `<div class="tp" data-on="${tifOn ? 'tp' : 'sp'}">
    <div class="tp-tabs" role="tablist">${tifOn ? `<button type="button" class="tp-tab on" role="tab" data-act="tptab" data-t="tp">${ico('pack', 'sm')}<span>${esc(t('Tiffin'))}</span><i class="tp-n" data-n="tp">0</i></button>` : ''}${skipOn ? `<button type="button" class="tp-tab ${tifOn ? '' : 'on'}" role="tab" data-act="tptab" data-t="sp">${ico('x', 'sm')}<span>${esc(t('Skip'))}</span><i class="tp-n" data-n="sp">0</i></button>` : ''}<span class="tp-ink"></span></div>
    ${tifOn ? pane('tp', 'tp', p && p.plan, 'tif') : ''}${skipOn ? pane('sp', 'sp', p && p.skipPlan, 'skp') : ''}
  </div>`;
}
function tpRefresh(root0) {
  const root = (root0.closest && root0.closest('.tp')) || root0.querySelector('.tp') || root0;
  const q = pre => $$(`input[name^="${pre}_"]:checked`, root).length;
  const nt = q('tp'), ns = q('sp');
  $$('.tp-n[data-n="tp"]', root).forEach(e => { e.textContent = nt; e.classList.toggle('z', !nt); });
  $$('.tp-n[data-n="sp"]', root).forEach(e => { e.textContent = ns; e.classList.toggle('z', !ns); });
}
A.rtifplan = el => {
  const r = meRes(); if (!r) return;
  const p = tifPlanOf(r.id);
  formModal({
    title: 'My weekly meal plan', submit: 'Save plan', wide: true,
    fields: [{ type: 'html', html: tpPanes(p) }],
    onSubmit: (v, f) => {
      const plan = {}, skip = {};
      $$('input[name^="tp_"]:checked', f).forEach(i => { const [, k, d] = i.name.split('_'); (plan[+d] = plan[+d] || []).push(k); });
      $$('input[name^="sp_"]:checked', f).forEach(i => { const [, k, d] = i.name.split('_'); (skip[+d] = skip[+d] || []).push(k); });
      setTifPlan(r.id, S().mess.tiffin !== false ? plan : undefined, S().mess.skip !== false ? skip : undefined);
      toast(Object.keys(plan).length || Object.keys(skip).length ? t('Weekly plan saved') : t('Weekly plan cleared'), 'ok'); render();
    },
  });
  setTimeout(() => { const m = $('.modal') || document; tpRefresh(m); if (el && el.dataset && el.dataset.tab === 'sp') { const b = $('.tp-tab[data-t="sp"]', m); if (b) A.tptab(b); } }, 30);
};
A.tptab = el => {
  const root = el.closest('.tp'); if (!root) return;
  root.dataset.on = el.dataset.t;
  $$('.tp-tab', root).forEach(b => b.classList.toggle('on', b === el));
  $$('.tp-pane', root).forEach(x => x.classList.toggle('on', x.dataset.p === el.dataset.t));
};
A.tpset = el => {
  const row = el.closest('.tpr'), p = el.dataset.p;
  $$('input[type=checkbox]', row).forEach((i, k) => { const d = TIF_PLAN_DAYS[k], on = p === 'all' ? true : p === 'wk' ? d >= 1 && d <= 5 : false; if (i.checked !== on) { i.checked = on; i.dispatchEvent(new Event('change', { bubbles: true })); } });
};
// tiffin and skip exclude each other on the same meal and day; the tab counters follow
document.addEventListener('change', e => {
  const i = e.target; if (!i || !i.matches || !i.matches('.tp .tpc input')) return;
  if (i.checked) { const other = (i.name.startsWith('tp_') ? 'sp_' : 'tp_') + i.name.slice(3), o = i.closest('.tp').querySelector(`input[name="${other}"]`); if (o && o.checked) o.checked = false; }
  tpRefresh(i.closest('.tp'));
});
A.rtif = el => { try { const on = toggleTiffin(ctx().refId, el.dataset.date, el.dataset.meal); haptic(); toast(on ? 'Tiffin ordered' : 'Tiffin cancelled'); } catch (e) { toast(e.message, 'bad'); } render(); };
A.rleave = () => formModal({
  title: 'Add leave', note: t('Your meals are not counted on these days.'),
  fields: [{ name: 'from', label: 'From', type: 'date', value: addDays(today(), 1), required: true }, { name: 'to', label: 'To (including)', type: 'date', value: addDays(today(), 2), required: true }, { name: 'reason', label: 'Reason' }],
  onSubmit: v => {
    const lp = leaveProblem(meRes().id, v.from, v.to); if (lp) return lp;
    if (v.from > addDays(today(), 180)) return t('Leave can be added at most 6 months ahead');
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
    for (let i = 0; i < 14 && upcoming.length < 4; i++) { const d = addDays(today(), i); const s = Store.all('hks').find(x => (x.rooms || []).includes(r.roomId) && schedOn(x, d)); if (s) upcoming.push({ d, s }); }
    const recent = tasks.filter(x => x.date <= today()).slice(0, 10);
    const ym = ymOf(today()), mon = tasks.filter(x => x.date <= today() && ymOf(x.date) === ym);
    const nDone = mon.filter(x => x.status === 'done').length, nMiss = mon.filter(x => x.status === 'missed' || x.status === 'not_cleaned').length, nPend = mon.filter(x => x.status === 'pending').length;
    const todays = tasks.find(x => x.date === today());
    const next = upcoming[0];
    // the big card: what is happening with this room's cleaning right now
    let tone = 'info', ic = 'cal', title = t('No cleaning scheduled'), sub = t('Nothing is planned for your room in the next two weeks.'), act = '';
    if (todays) {
      const st = HK_STAT[todays.status] || HK_STAT.pending;
      tone = st[1]; ic = todays.status === 'done' ? 'check' : todays.status === 'pending' ? 'broom' : 'alert';
      title = todays.status === 'pending' ? t('Cleaning today') : t(st[0]) + ' · ' + t('Today');
      sub = [todays.schedName || t('Room cleaning'), todays.time ? fmtTime(todays.time) : '', todays.staffName].filter(Boolean).join(' · ');
      if (todays.status === 'pending' && canMarkHk(todays)) act = btn('Mark cleaned', 'rhkdone', `data-id="${todays.id}"`, 'ok', 'check');
    } else if (next) {
      ic = 'cal'; title = t('Next cleaning') + ' · ' + (next.d === today() ? t('Today') : fmtDate(next.d));
      sub = [next.s.name || t('Room cleaning'), next.s.time ? fmtTime(next.s.time) : ''].filter(Boolean).join(' · ');
    }
    const stat = (n, l, c) => `<div class="rc-st ${c}"><b>${n}</b><span>${esc(t(l))}</span></div>`;
    const up = upcoming.map(u => { const d = parse(u.d); return `<div class="rc-up"><div class="rc-date"><b>${d.getDate()}</b><span>${esc(MONTHS()[d.getMonth()])}</span></div><div class="rc-upt"><b>${u.d === today() ? esc(t('Today')) : esc(DAYS()[d.getDay()])}</b><span>${esc(u.s.time ? fmtTime(u.s.time) : (u.s.name || ''))}</span></div></div>`; }).join('');
    const row = x => {
      const fb = Store.get(`hkf-${x.id}-${r.id}`), st = HK_STAT[x.status] || HK_STAT.pending;
      const acts = (x.status === 'done' && !fb ? `${btn('Issue', 'rfb', `data-id="${x.id}" data-ok="0"`, 'sm bad', 'alert')}${btn('Satisfied', 'rfb', `data-id="${x.id}" data-ok="1"`, 'sm ok', 'check')}` : '')
        + (x.status === 'pending' && canMarkHk(x) ? btn('Mark cleaned', 'rhkdone', `data-id="${x.id}"`, 'sm ok', 'check') : '')
        + ((x.status === 'missed' || x.status === 'not_cleaned') && !fb ? btn('Report', 'rfb', `data-id="${x.id}" data-ok="0"`, 'sm bad', 'alert') : '');
      const meta = [x.staffName, x.reason, fb ? (fb.ok ? t('You confirmed') : t('You reported an issue')) : ''].filter(Boolean).join(' · ');
      return `<div class="rc-row ${st[1]}"><span class="rc-ic">${ico(x.status === 'done' ? 'check' : x.status === 'pending' ? 'clock' : 'alert', 'sm')}</span><div class="rc-b"><div class="rc-t"><b>${x.date === today() ? esc(t('Today')) : esc(fmtDate(x.date))}</b><span class="badge ${st[1]}">${esc(t(st[0]))}</span></div>${meta ? `<div class="rc-m">${esc(meta)}</div>` : ''}${acts ? `<div class="rc-a">${acts}</div>` : ''}</div></div>`;
    };
    return `<div class="narrow stack rc">${head('Room cleaning', `${t('Room')} ${esc(roomName(r.roomId))}`)}
      <section class="rc-hero t-${tone}"><span class="rc-hi">${ico(ic)}</span><div class="rc-ht"><small>${esc(t('Your room'))} ${esc(roomName(r.roomId))}</small><b>${esc(title)}</b><span>${esc(sub)}</span></div>${act ? `<div class="rc-ha">${act}</div>` : ''}</section>
      <div class="rc-stats">${stat(nDone, 'Cleaned', 'ok')}${stat(nMiss, 'Missed', nMiss ? 'bad' : 'mute')}${stat(nPend, 'Pending', nPend ? 'info' : 'mute')}<small>${esc(t('This month'))}</small></div>
      <div class="group-t">${esc(t('Coming up'))}</div>
      ${up ? `<div class="rc-ups">${up}</div>` : `<div class="card muted">${esc(t('No cleaning scheduled'))}</div>`}
      <div class="group-t">${withTip(esc(t('Recent cleaning')), tip(t('Your feedback goes straight to the owner.')))}</div>
      ${recent.length ? `<div class="rc-list">${recent.map(row).join('')}</div>` : `<div class="card muted">${esc(t('Nothing here yet'))}</div>`}</div>`;
  },
};
A.rhkdone = el => { setHkStatus(el.dataset.id, 'done'); toast('Thanks — marked as cleaned'); render(); };
A.rfb = el => {
  const ok = el.dataset.ok === '1', r = meRes();
  if (ok) { hkFeedback(el.dataset.id, r.id, true); toast('Thanks for confirming!'); render(); return; }
  formModal({ title: 'What was wrong?', fields: [{ name: 'note', label: 'Tell the owner', type: 'textarea', required: true, full: true }], onSubmit: v => { if (String(v.note || '').trim().length < 3) return t('Please say what was wrong (a few words)'); hkFeedback(el.dataset.id, r.id, false, v.note.trim()); toast('Sent to owner'); } });
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
    const { feeNotices, generalNotices } = typeof residentNoticeBoard === 'function' ? residentNoticeBoard(r.id) : { feeNotices: [], generalNotices: [] };
    const ph = S().pay.phone || (Store.hostel() || {}).phone;
    const myMsgs = rinfos().filter(x => x.resId === r.id).sort(by('ts', -1)).slice(0, 10);
    const cmpOn = orgEnabled('complaints'), tab = cmpOn ? curTab('rhp', 'notices') : 'notices';
    const openN = mine.filter(c => c.status !== 'resolved').length;
    const fees = feeNotices.filter(fn => fn.balance > 0);
    const hero = `<section class="hp-hero"><div class="hp-ht"><span class="hp-hi">${ico('chat')}</span><div><b>${esc(t('How can we help?'))}</b><span>${esc(t('Tell the owner or raise a complaint. You will see the reply here.'))}</span></div></div>
      <div class="hp-acts">${btn('Tell the owner', 'rtell', '', '', 'chat')}${btn('New complaint', 'rcmp', '', 'primary', 'plus')}</div>
      ${ph ? `<div class="hp-call"><a class="hp-pill" href="tel:${esc(ph)}">${ico('phone', 'sm')}<span>${esc(t('Call'))}</span></a><a class="hp-pill wa" href="${esc(waUrl(ph, `Hi, ${r.name} (${roomName(r.roomId)}) here. `))}" target="_blank" rel="noopener">${ico('wa', 'sm')}<span>WhatsApp</span></a><span class="hp-num">${esc(ph)}</span></div>` : ''}</section>`;
    const note = n => `<div class="hp-card"><span class="hp-ci ${n.status === 'overdue' ? 'bad' : 'warn'}">${ico(n.status === 'overdue' ? 'alert' : 'rupee', 'sm')}</span><div class="hp-cb"><div class="hp-ct"><b>${esc(n.title)}</b><em class="${n.status === 'overdue' ? 'bad-t' : ''}">${inr(n.balance)}</em></div><p>${esc(n.body || '')}</p><small>${esc(fmtDate(n.date))}</small></div></div>`;
    const cmpCard = c => `<div class="hp-card"><span class="hp-ci ${c.status === 'resolved' ? 'ok' : 'warn'}">${ico('wrench', 'sm')}</span><div class="hp-cb"><div class="hp-ct"><b>${esc(t(c.cat))}</b><span class="badge ${c.status === 'resolved' ? 'ok' : 'warn'}">${esc(t(c.status === 'resolved' ? 'Resolved' : 'Open'))}</span></div><p>${esc(c.text)}</p>${c.reply ? `<div class="hp-reply">${ico('chat', 'xs')}<span><b>${esc(t('Owner'))}</b> ${esc(c.reply)}</span></div>` : ''}<div class="hp-cf"><small>${esc(ago(c.ts))}</small>${c.status === 'resolved' ? '' : btn('Mark resolved', 'rcmpdone', `data-id="${c.id}"`, 'sm ok', 'check')}</div></div></div>`;
    const msgCard = x => `<div class="hp-card"><span class="hp-ci ${x.status === 'seen' ? 'ok' : 'info'}">${ico(rinfoIcon(x.type), 'sm')}</span><div class="hp-cb"><div class="hp-ct"><b>${esc(rinfoLabel(x.type))}</b>${x.status === 'seen' ? badge('Seen', 'ok') : badge('Sent')}</div>${x.text ? `<p>${esc(x.text)}</p>` : ''}${x.from ? `<small>${esc(fmtShort(x.from))}${x.to && x.to !== x.from ? ' – ' + esc(fmtShort(x.to)) : ''}</small>` : ''}${x.reply ? `<div class="hp-reply">${ico('chat', 'xs')}<span><b>${esc(t('Owner'))}</b> ${esc(x.reply)}</span></div>` : ''}<div class="hp-cf"><small>${esc(ago(x.ts))}</small></div></div></div>`;
    const nothing = m => `<div class="card muted">${esc(t(m))}</div>`;
    const body = tab === 'notices'
      ? `${fees.length ? `<div class="group-t">${esc(t('Fees & Billing Notices'))}</div><div class="hp-list">${fees.map(note).join('')}</div>` : ''}<div class="group-t">${esc(t('General Notices (Active 30 Days)'))}</div><div class="hp-notices">${noticeCards(generalNotices, r)}</div>`
      : `<div class="group-t">${esc(t('My complaints'))}</div>${mine.length ? `<div class="hp-list">${mine.map(cmpCard).join('')}</div>` : nothing('No complaints yet')}<div class="group-t">${esc(t('I told the owner'))}</div>${myMsgs.length ? `<div class="hp-list">${myMsgs.map(msgCard).join('')}</div>` : nothing('Unwell, going home, back late — anything the owner should know.')}`;
    return `<div class="narrow stack hp">${head('Help & notices')}${hero}
      ${cmpOn ? seg('rhp', [['notices', 'Notices', generalNotices.length + fees.length], ['mine', 'My requests', openN]], 'notices') : ''}${body}</div>`;
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
A.rcmp = () => { const r = meRes(); formModal({ title: 'New complaint', fields: [{ name: 'cat', label: 'Category', type: 'select', options: CMP_CATS }, { name: 'text', label: 'Problem', type: 'textarea', required: true, full: true, maxlength: 500 }], onSubmit: v => { const tx = String(v.text || '').trim(); if (tx.length < 5) return t('Describe the problem in a few words'); Store.put('cmp', { resId: r.id, roomId: r.roomId, cat: v.cat, text: tx.slice(0, 500), status: 'open', date: today(), ts: nowIso(), src: 'resident' }); notify({ to: 'admin', title: t('New complaint'), body: `${roomName(r.roomId)} · ${t(v.cat)}`, link: 'complaints' }); toast('Complaint sent'); } }); };
A.rmeterread = () => {
  const r = meRes();
  if (!r || !r.roomId) {
    toast(t('No room assigned to your account.'), 'bad');
    return;
  }
  const elecCfg = S().elec || {};
  if (elecCfg.scanRole === 'staff_only') {
    toast(t('Meter readings are recorded by hostel staff/warden only.'), 'bad');
    return;
  }
  const curYM = ymOf(today());
  const pending = pendingMeter(r.roomId);
  if (pending) {
    toast(t('A reading for Room {r} was already submitted by {n} and is under review.', { r: roomName(r.roomId), n: pending.submittedBy || t('your roommate') }), 'bad');
    return;
  }
  const last = lastMeter(r.roomId);
  if (last && ymOf(last.date) === curYM) {
    toast(t('Reading for Room {r} has already been billed for this month ({m}).', { r: roomName(r.roomId), m: fmtYM(curYM) }), 'bad');
    return;
  }
  const prev = last ? last.curr : 0;
  const room = roomById(r.roomId);
  const reg = typeof getMeterForRoom === 'function' ? getMeterForRoom(r.roomId) : null;

  formModal({
    title: `${t('Room meter reading')} · ${roomName(r.roomId)}`,
    note: `<div style="background:var(--card-subtle,#f8fafc);border:1px solid var(--line);border-radius:var(--r);padding:10px 14px;margin:4px 0 10px">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <span class="muted sm">${esc(t('Previous reading'))}:</span>
        <b style="font-size:15px;color:var(--text,#1e293b)">${num(prev)} ${esc(t('units'))}${last ? ` <span class="xs muted">(${fmtShort(last.date)})</span>` : ''}</b>
      </div>
      <div id="mlivecalc" style="font-size:12px;color:var(--text-mute,#64748b);border-top:1px dashed var(--line);padding-top:6px;margin-top:6px">
        ${esc(t('Enter current reading to calculate units consumed & bill'))}
      </div>
    </div>`,
    fields: [
      { name: 'curr', label: 'Current meter reading', type: 'number', step: 0.1, min: 0, required: true },
      { name: 'photo', label: 'Photo of the meter', type: 'file', accept: 'image/*', required: true, hint: t('A clear photo of the meter display, so the owner can check the reading.') },
      { name: 'isReplaced', label: 'Meter was recently replaced or reset to 0 (नया मीटर लगा या रीसेट हुआ)', type: 'checkbox', full: true },
      { name: 'replaceNote', label: 'Reason / Note for owner if meter was replaced', placeholder: 'e.g. Electrician installed new digital submeter yesterday', full: true, hidden: true }
    ],
    onChange: (vals, form, changedField) => {
      if (changedField === 'isReplaced') {
        showField(form, 'replaceNote', vals.isReplaced);
      }
      if (changedField === 'curr' || changedField === 'isReplaced') {
        const c = +vals.curr;
        const calcEl = form.querySelector('#mlivecalc');
        if (calcEl) {
          if (isNaN(c) || vals.curr === '' || vals.curr == null) {
            calcEl.innerHTML = esc(t('Enter current reading to calculate units consumed & bill'));
          } else if (!vals.isReplaced && c < prev) {
            calcEl.innerHTML = `<span style="color:var(--bad,#ef4444);font-weight:600">${esc(t('Current reading ({c}) is lower than previous ({p})! Reading cannot decrease. If meter was replaced, check the box below.', { c: num(c), p: num(prev) }))}</span>`;
          } else {
            const u = round2(vals.isReplaced ? c : (c - prev));
            const rate = S().elec.rate || 0;
            const est = Math.round(u * rate);
            calcEl.innerHTML = `<span style="color:var(--ok,#10b981);font-weight:600">✓ ${esc(t('Units consumed'))}: <b>${num(u)} ${esc(t('units'))}</b> · ${esc(t('Est. bill'))}: <b>${inr(est)}</b> (@ ₹${rate}/${esc(t('unit'))})</span>`;
          }
        }
      }
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
      const racePending = pendingMeter(r.roomId);
      if (racePending) return t('A reading for Room {r} was just submitted by {n} and is under review.', { r: roomName(r.roomId), n: racePending.submittedBy || t('your roommate') });
      const raceLast = lastMeter(r.roomId);
      if (raceLast && ymOf(raceLast.date) === curYM) return t('Reading for Room {r} has already been recorded and billed for this month.', { r: roomName(r.roomId) });

      const curr = +v.curr;
      if (isNaN(curr)) return t('Enter a valid non-negative reading');
      if (!v.isReplaced && curr < prev) return t('Current reading ({c}) cannot be less than previous reading ({p}). Check "Meter replaced/reset" if a new meter was installed.', { c: curr, p: prev });

      const fraud = validateMeterReadingFraud({ roomId: r.roomId, curr, prev, isReplaced: !!v.isReplaced });
      if (!fraud.valid) return fraud.flags.join('. ');

      if (!(v.photo && v.photo[0])) return t('Add a photo of the meter display');
      const photoName = v.photo[0].name || 'meter-photo.jpg';
      // the photo is shrunk and kept with the reading, so the owner sees what the resident saw
      compressImage(v.photo[0], 900, 0.6).then(f => { const reader = new FileReader(); reader.onload = ev => {
        try {
          const m = addReading({
            roomId: r.roomId,
            curr,
            prev: v.isReplaced ? 0 : prev,
            date: today(),
            photo: photoName,
            photoUrl: ev.target.result,
            status: 'review',
            isReplacement: !!v.isReplaced,
            replaceReason: v.isReplaced ? (v.replaceNote || t('Resident reported meter replaced/reset')) : null,
            submittedBy: r.name,
            isManual: false
          });
          notify({ to: 'admin', title: v.isReplaced ? t('Meter replacement claim submitted') : t('Meter reading submitted'), body: `${r.name} · ${roomName(r.roomId)}: ${v.isReplaced ? 'New reading ' + curr : num(m.units) + ' ' + t('units')}`, link: 'inbox' });
          closeModal();
          render();
          toast(v.isReplaced ? t('Meter replacement reading submitted for owner verification!') : t('Meter reading submitted for verification! ({u} units)', { u: num(curr - prev) }), 'ok');
        } catch (err) { const e = document.querySelector('#mform .ferr'); if (e) e.textContent = err.message; else toast(err.message, 'bad'); const b = document.querySelector('[data-act="msubmit"]'); if (b) b.disabled = false; }
      }; reader.readAsDataURL(f); });
      return false;
    }
  });
};

// Readings of this resident's room in which they had a share, newest first.
const resElecReadings = id => meters().filter(m => !m.opening && m.status !== 'review' && (m.shares || []).some(x => x.resId === id)).sort(by('date', -1));
A.relec = () => {
  const r = meRes(); if (!r) return;
  const list = resElecReadings(r.id).slice(0, 8);
  if (!list.length) return toast(t('No electricity bill yet'));
  const ym = ymOf(list[0].date), monthTotal = sum(list.filter(m => ymOf(m.date) === ym), m => (m.shares.find(x => x.resId === r.id) || {}).amount || 0);
  const free = S().elec.freeUnits || 0;
  sheet(t('My electricity'), `<div class="elhero" style="margin-bottom:12px"><div class="el-t"><span>${esc(t('Billed in {m}', { m: fmtYM(ym) }))}</span><b>${inr(monthTotal)}</b><small>${esc(t('Room {r} · {a} per unit · {f} free units a month', { r: roomName(r.roomId), a: inr(S().elec.rate), f: free }))}</small></div></div>
    <div class="elsl">${list.map(m => { const sh = m.shares.find(x => x.resId === r.id), inv = resInvoices(r.id).find(i => i.meterId === m.id || (i.id && i.id.includes(m.id)));
      return elecShareCard(m, sh, { title: `${fmtShort(m.prevDate || addDays(m.date, -(m.span || 30)))} - ${fmtShort(m.date)}`, sub: `${t('Meter')} ${num(m.prev)} to ${num(m.curr)} · ${num(m.units)} ${t('units')}${inv ? ' · ' + (invBal(inv) > 0 ? t('due') : t('paid')) : ''}` }); }).join('')}</div>
    <p class="hint" style="margin-top:12px">${esc(t('Free units are given for the days you stayed, and each bill covers the days between two meter readings.'))}</p>`);
};
