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
    const { feeNotices, generalNotices } = typeof residentNoticeBoard === 'function' ? residentNoticeBoard(r.id) : { feeNotices: [], generalNotices: [] };
    const task = hkTasks().filter(x => x.roomId === r.roomId && x.date >= today()).sort(by('date'))[0];
    const agr = typeof getActiveAgreement === 'function' ? getActiveAgreement(r.id) : null;
    return `<div class="narrow stack">
      <div style="margin-top:6px"><h2 style="font-size:28px">${esc(t('Hi {n}', { n: r.name.split(' ')[0] }))} 👋</h2><p class="muted">${esc(hostelName())} · ${t('Room')} ${esc(roomName(r.roomId))}-${esc(r.bed)}</p></div>
      <div class="hero ${due ? '' : 'ok'}"><div class="muted sm">${esc(t(due ? 'Amount due' : 'All paid'))}</div><div class="big">${inr(due)}</div>
        ${pending.length ? `<div class="sm" style="margin-top:6px">⏳ ${esc(t('{a} payment waiting for owner to verify', { a: inr(sum(pending, c => c.amount)) }))}</div>` : ''}
        ${due ? `<div class="row" style="margin-top:14px"><button class="btn primary" data-act="rcfpay">${ico('rupee', 'sm')} ${esc(t('Pay with UPI'))}</button><button class="btn" data-act="rqr">${ico('qr', 'sm')} QR</button><button class="btn" data-act="rclaim">${ico('check', 'sm')} ${esc(t('I have paid'))}</button></div>` : ''}</div>
      ${feeNotices.length ? group('Fees & Billing Notices', feeNotices.map(fn => li({ icon: fn.status === 'paid' ? 'check' : (fn.status === 'overdue' ? 'alert' : 'rupee'), ic: fn.status === 'paid' ? 'ok' : (fn.status === 'overdue' ? 'bad' : 'warn'), t: `${fn.isCurrent ? '⭐ ' : ''}${fn.title}`, d: `${fn.body} · ${fmtDate(fn.date)}`, end: fn.balance > 0 ? `<b class="${fn.status === 'overdue' ? 'bad-t' : ''}">${inr(fn.balance)}</b>` : badge('Paid', 'ok'), act: 'rviewinv', attrs: `data-id="${fn.invId || fn.id || ''}"` })).join('')) : (open.length ? group('Bill details', open.map(i => li({ icon: i.type === 'electricity' ? 'bolt' : i.type === 'laundry' ? 'shirt' : 'rupee', ic: invStat(i) === 'overdue' ? 'bad' : 'info', t: i.title, d: `${t('due')} ${fmtShort(i.due)}`, end: `<b>${inr(invBal(i))}</b>`, act: 'rviewinv', attrs: `data-id="${i.id}"` })).join('')) : '')}
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
            act: elecInv ? 'rviewinv' : '',
            attrs: elecInv ? `data-id="${elecInv.id}"` : '',
            chev: !!elecInv,
            end: badge('Billed & View Split', 'ok')
          }));
        }

        return group('Room electricity meter', li({
          icon: 'bolt',
          ic: 'warn',
          t: t('Submit room meter reading'),
          d: last ? t('Snap photo of Room {r}\'s meter (last reading: {u} on {d})', { r: roomName(r.roomId), u: num(last.curr), d: fmtShort(last.date) }) : t('Snap photo of Room {r}\'s meter to record reading', { r: roomName(r.roomId) }),
          act: 'rmeterscan',
          end: badge('Action needed', 'warn')
        }));
      })() : ''}
      ${agr ? group('Rental agreement', li({ icon: 'file', ic: 'ok', t: `${t('Rental agreement')} (v${agr.version})`, d: `${fmtDate(agr.startDate)} – ${fmtDate(agr.endDate)} · ${inr(agr.rent)}/mo`, act: 'agrview', attrs: `data-id="${agr.id}"` })) : ''}
      ${orgEnabled('mess') && next ? `<div class="card"><h3>${ico('utensils', 'sm')} ${esc(mealName(next.k))} · ${fmtTime(next.time)}<span class="sp"></span><a class="sm" href="/r-meals">${esc(t('All meals'))}</a></h3>${mealRow(r, today(), next)}</div>` : ''}
      ${orgEnabled('housekeeping') && task ? group('Room cleaning', li({ icon: 'broom', ic: task.status === 'done' ? 'ok' : 'info', t: task.date === today() ? t('Today') : fmtDate(task.date), d: `${task.schedName || ''}${task.time ? ' · ' + fmtTime(task.time) : ''} · ${t(HK_STAT[task.status][0])}`, act: 'go', attrs: 'data-to="r-clean"' })) : ''}
      ${attOn() ? (() => { const m = attMonth(r.id, ymOf(today())); return group('My attendance', li({ icon: 'check', ic: m.absent ? 'warn' : 'ok', t: t('{n} days present', { n: m.present }), d: m.absent ? t('{n} days marked absent in {m}: {d}', { n: m.absent, m: fmtYM(ymOf(today())), d: m.absentDays.join(', ') }) : t('Nothing marked absent in {m}', { m: fmtYM(ymOf(today())) }), chev: false })); })() : ''}
      ${generalNotices.length ? group('General Notices', generalNotices.slice(0, 3).map(n => li({ icon: 'megaphone', ic: 'teal', t: n.title, d: n.body })).join('')) : ''}
      ${group('Recent payments', Store.all('pay').filter(x => x.resId === r.id).sort(by('date', -1)).slice(0, 4).map(x => li({ icon: 'check', ic: 'ok', t: inr(x.amount), d: `${fmtDate(x.date)} · ${x.mode.toUpperCase()}`, act: 'receipt', attrs: `data-id="${x.id}"` })).join(''))}
    </div>`;
  },
};
A.rqr = () => {
  const r = meRes(), due = resDue(r.id), uri = upiUri(due, `${r.name} ${roomName(r.roomId)}`);
  const hId = Store.hostelId || (Store.hostel() || {}).id;
  const payUrl = `${location.origin}/pay.html?hostel_id=${hId}&res_id=${r.id}&am=${due}`;
  sheet('Scan & pay', `<div class="qr">${qrSvg(uri, 6)}</div><p style="text-align:center;margin-top:12px"><b style="font-size:22px">${inr(due)}</b><br><span class="muted">${esc(S().pay.payee || hostelName())} · ${esc(S().pay.upiId)}</span></p><div class="row" style="margin-top:14px;justify-content:center"><a class="btn primary sm" href="${esc(payUrl)}" target="_blank" rel="noopener">${ico('rupee', 'sm')} Open Online Pay Portal</a></div><p class="hint" style="text-align:center;margin-top:8px">${esc(t('Scan with any UPI app, or pay online with instant receipt.'))}</p>`, { foot: `<button class="btn primary block" data-act="rclaim">${esc(t('I have paid'))}</button>` });
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
      if (m) {
        elecDetailsHtml = `
          <div class="card" style="background:var(--subtle);padding:10px 12px;border-radius:8px;margin-bottom:12px;border:1px solid var(--line);font-size:12.5px;line-height:1.5">
            <div style="font-weight:700;margin-bottom:4px;display:flex;justify-content:space-between">
              <span>⚡ ${esc(t('Electricity Meter Split'))}</span>
              <b class="ok-t">${inr(elecInv.amount)}</b>
            </div>
            <div>${esc(t('Room Readings'))}: <b>${num(m.prev)} → ${num(m.curr)}</b> (${num(m.units)} ${t('units')})</div>
            ${s ? `<div class="muted xs" style="margin-top:2px">${esc(t('Resident share'))}: ${num(s.units)} units - ${num(s.free)} free quota = <b>${num(s.billable)} billable units</b> @ ₹${m.rate || S().elec.rate}/unit</div>` : ''}
          </div>
        `;
      }
    }

    const html = `
      <div class="card" style="font-size:13px;line-height:1.6">
        <div style="text-align:center;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px">
          <div style="font-size:24px;margin-bottom:4px">📑</div>
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
          <div style="font-size:24px;margin-bottom:4px">⚡</div>
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
            <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--accent);color:#fff;font-weight:700;font-size:10px">i</span>
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
      return toast(j?.error || 'Could not create payment order', 'bad');
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
    toast('Failed to reach payment gateway: ' + err.message, 'bad');
  }
};
// Resident reports a UPI payment; owner verifies with one tap in Approvals.
A.rclaim = () => {
  const r = meRes();
  formModal({
    title: 'I have paid', submit: 'Send to owner',
    note: t('Enter the 12-digit UPI reference (RRN) or bank UTR / transaction ID. The owner verifies it and you get a receipt.'),
    fields: [{ name: 'amount', label: 'Amount paid (₹)', type: 'number', min: 1, value: resDue(r.id) || '', required: true }, { name: 'utr', label: 'UTR / transaction ID', inputmode: 'text', autocapitalize: 'characters', required: true, pattern: /^[A-Za-z0-9_-]{6,35}$/ }, { name: 'date', label: 'Paid on', type: 'date', value: today() }, { name: 'proof', label: 'Payment screenshot (optional)', type: 'file', accept: 'image/*' }],
    onSubmit: v => {
      const utrStr = String(v.utr || '').trim();
      const refInfo = classifyPaymentRef(utrStr);
      if (!refInfo.valid) return refInfo.reason;
      if (Store.all('claim').some(c => c.utr === utrStr && c.status !== 'rejected')) return 'This UTR was already submitted';
      const saveIt = proofUrl => {
        Store.put('claim', { resId: r.id, roomId: r.roomId, amount: v.amount, utr: utrStr, refType: refInfo.type, date: v.date, status: 'pending', proofUrl: proofUrl || null, ts: nowIso() });
        notify({ to: 'admin', title: t('UPI payment to verify'), body: `${r.name} · ${inr(v.amount)} (${refInfo.label})`, link: 'inbox' });
        toast('Sent. You will get a receipt once verified.');
        closeModal();
      };
      if (v.proof && v.proof[0]) {
        const reader = new FileReader();
        reader.onload = ev => saveIt(ev.target.result);
        reader.readAsDataURL(v.proof[0]);
        return false;
      }
      saveIt(null);
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
    const { feeNotices, generalNotices } = typeof residentNoticeBoard === 'function' ? residentNoticeBoard(r.id) : { feeNotices: [], generalNotices: [] };
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
      ${feeNotices.length ? group('Fees & Billing Notices (Last 3 Months)', feeNotices.map(fn => li({ icon: fn.status === 'paid' ? 'check' : (fn.status === 'overdue' ? 'alert' : 'rupee'), ic: fn.status === 'paid' ? 'ok' : (fn.status === 'overdue' ? 'bad' : 'warn'), t: `${fn.isCurrent ? '⭐ ' : ''}${fn.title}`, d: `${fn.body} · ${fmtDate(fn.date)}`, end: fn.balance > 0 ? `<b class="${fn.status === 'overdue' ? 'bad-t' : ''}">${inr(fn.balance)}</b>` : badge('Paid', 'ok') })).join('')) : ''}
      ${group('General Notices (Active 30 Days)', generalNotices.length ? generalNotices.map(n => li({ icon: 'megaphone', ic: 'teal', t: `${n.pinned ? '📌 ' : ''}${n.title}`, d: `${n.body} · ${fmtShort(n.date)}` })).join('') : `<div class="li noic"><span class="body muted">${esc(t('No general notices in the last 30 days.'))}</span></div>`)}
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
A.rmeterscan = () => {
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
  const expectedCode = (reg && reg.qrCode) || (room ? `MTR-${room.no}` : `MTR-${r.roomId}`);

  formModal({
    title: `${t('Scan room meter')} · ${roomName(r.roomId)}`,
    note: `<div style="background:var(--card-subtle,#f8fafc);border:1px solid var(--line);border-radius:var(--r);padding:10px 14px;margin:4px 0 10px">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <span class="muted sm">${esc(t('Previous reading'))}:</span>
        <b style="font-size:15px;color:var(--text,#1e293b)">${num(prev)} ${esc(t('units'))}${last ? ` <span class="xs muted">(${fmtShort(last.date)})</span>` : ''}</b>
      </div>
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <span class="muted sm">${esc(t('Room meter sticker code'))}:</span>
        <span class="badge sm info">🏷️ ${esc(expectedCode)}</span>
      </div>
      <div id="mlivecalc" style="font-size:12px;color:var(--text-mute,#64748b);border-top:1px dashed var(--line);padding-top:6px;margin-top:6px">
        ${esc(t('Enter current reading to calculate units consumed & bill'))}
      </div>
    </div>`,
    fields: [
      { name: 'photo', label: 'Camera photo of meter display', type: 'file', accept: 'image/*', capture: true, required: true },
      { name: 'qrCode', label: 'Meter sticker / QR code on meter', value: expectedCode, required: true, hint: t('Check sticker on Room {r}\'s meter: {c}', { r: roomName(r.roomId), c: expectedCode }) },
      { name: 'curr', label: 'Current meter reading', type: 'number', step: 0.1, min: 0, required: true },
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
            calcEl.innerHTML = `<span style="color:var(--bad,#ef4444);font-weight:600">⚠️ ${esc(t('Current reading ({c}) is lower than previous ({p})! Reading cannot decrease. If meter was replaced, check the box below.', { c: num(c), p: num(prev) }))}</span>`;
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

      const fraud = validateMeterReadingFraud({ roomId: r.roomId, curr, prev, meterQr: v.qrCode, isReplaced: !!v.isReplaced });
      if (!fraud.valid) return fraud.flags.join('. ');

      const photoName = (v.photo && v.photo[0]) ? (v.photo[0].name || 'meter-photo.jpg') : null;
      try {
        const m = addReading({
          roomId: r.roomId,
          curr,
          prev: v.isReplaced ? 0 : prev,
          date: today(),
          qrCode: v.qrCode,
          photo: photoName,
          status: 'review',
          isReplacement: !!v.isReplaced,
          replaceReason: v.isReplaced ? (v.replaceNote || t('Resident reported meter replaced/reset')) : null,
          submittedBy: r.name,
          isManual: false
        });
        notify({ to: 'admin', title: v.isReplaced ? t('Meter replacement claim submitted') : t('Meter reading submitted'), body: `${r.name} · ${roomName(r.roomId)}: ${v.isReplaced ? 'New reading ' + curr : round2(curr - prev) + ' units'}`, link: 'inbox' });
        closeModal();
        render();
        toast(v.isReplaced ? t('Meter replacement reading submitted for owner verification!') : t('Meter reading submitted for verification! ({u} units)', { u: num(curr - prev) }), 'ok');
      } catch (err) {
        return err.message;
      }
    }
  });
};
