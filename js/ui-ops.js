'use strict';
let geoPick = null;   // coordinates captured for the visitor form that is currently open
/* Daily operations: mess & menu, stock & purchase, housekeeping, laundry, gate, complaints, staff. */

/* ===================================================================== mess */
PAGES.mess = {
  title: 'Mess & Menu', mod: 'mess',
  render() {
    const tab = curTab('mess', 'today');
    const date = ui.flt.messd || today();
    let body = '';
    if (tab === 'today') {
      const strip = [...Array(7)].map((_, i) => addDays(today(), i - 1));
      body = `<div class="days7" style="margin-bottom:14px">${strip.map(d => `<button class="${d === date ? 'on' : ''}" data-act="setflt" data-k="messd" data-v="${d}"><span>${DAYS()[parse(d).getDay()]}</span><b>${parse(d).getDate()}</b></button>`).join('')}</div>
        <div class="stack">${meals().map(m => {
          const p = cookPlan(date, m.k), hc = p.hc, open = beforeCutoff(date, m.k, 'skip');
          return `<div class="card"><h3>${esc(mealName(m.k))} <small>${fmtTime(m.time)}</small><span class="sp"></span>${badge(open ? t('Skips open till {t}', { t: fmtTime(m.cutoff) }) : 'Count final', open ? 'info' : 'ok')}</h3>
            <div class="grid g4 keep2">${kpi('Cook for', `${hc.eat}`, t('plates'), 'ok')}${kpi('Skipped', hc.skip, '', hc.skip ? 'warn' : '')}${kpi('On leave', hc.leave, '')}${kpi('Tiffin pack', hc.tiffin, hc.tiffins.map(x => roomName(x.roomId)).join(', '), hc.tiffin ? 'warn' : '')}</div>
            <div class="row" style="margin:12px 0 6px">${p.dishes.length ? p.dishes.map(d => badge(d.name, 'acc')).join('') : `<span class="hint">${esc(t('No menu set for this meal'))}</span>`}</div>
            ${p.list.length ? `<details style="margin-top:6px"><summary class="sm b" style="cursor:pointer;color:var(--accent)">${esc(t('Ingredients to take out'))}</summary><dl class="kv" style="margin-top:8px">${p.list.map(x => `<dt>${esc(x.item.name)}${x.factor !== 1 ? ` <span class="hint">×${x.factor}</span>` : ''}</dt><dd>${num(x.qty)} ${esc(x.item.unit)}</dd>`).join('')}</dl></details>` : ''}
            <div class="row" style="margin-top:10px">${btn(hc.served != null ? t('Served: {n}', { n: hc.served }) : 'Mark plates served', 'served', `data-date="${date}" data-meal="${m.k}"`, 'sm')}${btn('Guests', 'guests', `data-date="${date}" data-meal="${m.k}"`, 'sm')}${hc.tiffin ? btn('Tiffin list', 'tiflist', `data-date="${date}" data-meal="${m.k}"`, 'sm') : ''}</div></div>`;
        }).join('')}</div>`;
    } else if (tab === 'menu') {
      const w = menuDoc().week, ms = meals();
      body = `${about('Tap any cell to choose dishes. Residents see this menu in their app.')}<div class="scroll-x"><div class="mgrid" style="--cols:${ms.length};min-width:${120 + ms.length * 150}px"><div></div>${ms.map(m => `<div class="h">${esc(mealName(m.k))}</div>`).join('')}
        ${[1, 2, 3, 4, 5, 6, 0].map(d => `<div class="d ${d === new Date().getDay() ? 'today' : ''}">${DAYS()[d]}</div>${ms.map(m => `<button class="c ${d === new Date().getDay() ? 'today' : ''}" data-act="menucell" data-day="${d}" data-meal="${m.k}">${((w[d] || {})[m.k] || []).map(id => esc((Store.get(id) || {}).name || '')).filter(Boolean).join(', ') || `<span class="muted">+ ${esc(t('Add'))}</span>`}</button>`).join('')}`).join('')}</div></div>`;
    } else if (tab === 'dishes') {
      body = `<div class="tool">${searchBox('dish', 'Search dish')}<span class="sp"></span>${btn('Add dish', 'adddish', '', 'primary', 'plus')}</div>
        ${group('', dishes().filter(d => needle('dish', d.name)).map(d => li({ icon: 'utensils', ic: 'warn', t: d.name, d: `${t(d.meal === 'any' ? 'Any meal' : mealName(d.meal))} · ${(d.ings || []).map(g => `${(itemById(g.itemId) || {}).name || '?'} ${num(g.qty)}${(itemById(g.itemId) || {}).unit || ''}`).join(', ')} · ${t('for {n} people', { n: d.serves })}`, act: 'editdish', attrs: `data-id="${d.id}"` })).join(''), t('Ingredient quantities are for the number of people you cook for. The system works out per-person needs and learns your real usage.'))}`;
    } else {
      const d = ui.flt.messd2 || addDays(today(), 1);
      const sk = Store.all('skip').filter(s => s.date === d), tf = Store.all('tiffin').filter(s => s.date === d), lv = Store.all('leave').filter(l => l.from <= d && l.to >= d);
      body = `<div class="tool"><input type="date" value="${d}" data-flt="messd2" style="max-width:200px"><span class="sp"></span>${btn('Add leave', 'messleave', '', '', 'plus')}</div>
        <div class="grid g3">${group(t('Skipped meals'), sk.map(s => li({ lead: avatar((resById(s.resId) || {}).name || '?'), t: (resById(s.resId) || {}).name || '—', d: `${mealName(s.meal)} · ${roomName((resById(s.resId) || {}).roomId)}` })).join(''))}${group(t('Tiffin requests'), tf.map(s => li({ icon: 'pack', ic: 'warn', t: (resById(s.resId) || {}).name || '—', d: `${mealName(s.meal)} · ${roomName(s.roomId)}${s.note ? ' · ' + s.note : ''}` })).join(''))}${group(t('On leave'), lv.map(l => li({ icon: 'cal', ic: 'info', t: (resById(l.resId) || {}).name || '—', d: `${fmtShort(l.from)} – ${fmtShort(l.to)}`, end: isAdmin() ? btn('', 'leavedel', `data-id="${l.id}"`, 'sm', 'trash') : '' })).join(''))}</div>`;
    }
    return `${head('Mess & Menu', t('Headcount updates live from leaves, skips and tiffins.'), isAdmin() ? btn('Meal timings', 'go', 'data-to="settings/meals"', '', 'clock') : '')}${seg('mess', [['today', 'Cooking plan'], ['menu', 'Weekly menu'], ['dishes', 'Dishes & recipes'], ['requests', 'Skips & tiffins']], 'today')}${body}`;
  },
};
A.served = el => formModal({ title: `${t('Plates served')} · ${mealName(el.dataset.meal)}`, note: t('Optional. Real counts make the stock learning more accurate.'), fields: [{ name: 'n', label: 'Plates served', type: 'number', min: 0, value: headcount(el.dataset.date, el.dataset.meal).eat, required: true }], onSubmit: v => { Store.put('served', { id: `served-${el.dataset.date}-${el.dataset.meal}`, date: el.dataset.date, meal: el.dataset.meal, count: v.n }); toast('Saved'); } });
A.guests = el => { const id = `guest-${el.dataset.date}-${el.dataset.meal}`, cur = Store.get(id); formModal({ title: 'Guest meals', fields: [{ name: 'n', label: 'Number of guests', type: 'number', min: 0, value: cur ? cur.count : 0 }, { name: 'note', label: 'Note', value: cur ? cur.note : '' }], onSubmit: v => { Store.put('guestmeal', { id, date: el.dataset.date, meal: el.dataset.meal, count: v.n || 0, note: v.note }); toast('Saved'); } }); };
A.tiflist = el => { const hc = headcount(el.dataset.date, el.dataset.meal); sheet(`${t('Tiffin')} · ${mealName(el.dataset.meal)}`, `<div class="group">${hc.tiffins.map(x => li({ icon: 'pack', ic: 'warn', t: (resById(x.resId) || {}).name || '—', d: `${t('Room')} ${roomName(x.roomId)}${x.note ? ' · ' + x.note : ''}`, end: x.status === 'packed' ? badge('Packed', 'ok') : btn('Packed', 'tifpacked', `data-id="${x.id}"`, 'sm ok') })).join('')}</div>`); };
A.tifpacked = el => { Store.patch(el.dataset.id, { status: 'packed' }); const x = Store.get(el.dataset.id); notify({ to: 'res', resId: x.resId, title: t('Your tiffin is packed'), body: mealName(x.meal) }); A.tiflist({ dataset: { date: x.date, meal: x.meal } }); };
A.menucell = el => {
  const d = +el.dataset.day, m = el.dataset.meal, doc = menuDoc(), cur = ((doc.week[d] || {})[m]) || [];
  const opts = dishes().filter(x => x.meal === 'any' || x.meal === m || cur.includes(x.id)).map(x => ({ v: x.id, l: x.name }));
  formModal({ title: `${DAYS()[d]} · ${mealName(m)}`, fields: [{ name: 'dishes', label: 'Dishes', type: 'multi', options: opts, value: cur }, { name: 'all', label: 'Same for every day of the week', type: 'checkbox' }],
    extra: `<p class="hint" style="margin-top:10px">${esc(t('Dish missing?'))} <a href="#" data-act="adddish">${esc(t('Add a new dish'))}</a></p>`,
    onSubmit: v => { const week = clone(doc.week || {}); for (const day of v.all ? [0, 1, 2, 3, 4, 5, 6] : [d]) { week[day] = week[day] || {}; week[day][m] = v.dishes; } Store.put('menu', { id: 'menu', week }); toast('Menu updated'); } });
};
// Dish with its recipe. Ingredients come from stock items; a new ingredient name creates the item.
function dishForm(x) {
  const d = x || { ings: [], serves: 10, meal: 'any' };
  const rows = d.ings.length ? d.ings : [{}, {}, {}];
  const itemOpts = items().map(i => `<option value="${esc(i.name)}">`).join('');
  const rowHtml = (g, i) => `<div class="row nw ingrow" style="gap:6px;margin-bottom:6px"><input list="itemlist" name="ing_${i}" placeholder="${esc(t('Ingredient'))}" value="${esc(g.itemId ? (itemById(g.itemId) || {}).name || '' : '')}" style="flex:2"><input name="qty_${i}" type="number" step="0.01" min="0" inputmode="decimal" placeholder="${esc(t('Qty'))}" value="${g.qty ?? ''}" style="flex:1"><select name="unit_${i}" style="flex:1">${S().units.map(u => `<option ${((itemById(g.itemId) || {}).unit || 'kg') === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>`;
  formModal({
    title: x ? 'Edit dish' : 'Add dish', wide: true,
    fields: [
      { name: 'name', label: 'Dish name', value: d.name, required: true }, { name: 'meal', label: 'Served at', type: 'select', options: [{ v: 'any', l: t('Any meal') }, ...meals().map(m => ({ v: m.k, l: mealName(m.k) }))], value: d.meal },
      { name: 'serves', label: 'Quantities below are for how many people?', type: 'number', min: 1, value: d.serves, required: true, full: true, hint: t('Example: for 40 people we use 6 kg rice → enter 40 here and 6 kg below.') },
      { type: 'html', html: `<label class="f">${esc(t('Ingredients'))}</label><datalist id="itemlist">${itemOpts}</datalist><div id="ings">${rows.map(rowHtml).join('')}</div><button type="button" class="btn sm" id="addIng">+ ${esc(t('Ingredient'))}</button>` },
    ],
    danger: x ? { label: 'Delete', run: () => confirmBox(t('Delete dish {n}?', { n: d.name }), () => { Store.remove(d.id); toast('Deleted'); }, 'Delete', 'bad') } : null,
    onSubmit: (v, form) => {
      const ings = [];
      $$('.ingrow', form).forEach((row, i) => {
        const name = (form.elements['ing_' + i] || {}).value?.trim(), qty = parseFloat((form.elements['qty_' + i] || {}).value), unit = (form.elements['unit_' + i] || {}).value;
        if (!name || !(qty > 0)) return;
        let it = items().find(z => z.name.toLowerCase() === name.toLowerCase());
        if (!it) it = Store.put('item', { id: `item-${slug(name)}-${uid()}`, name, unit, stock: 0, min: 0, rate: 0, cat: 'Grocery' });
        ings.push({ itemId: it.id, qty });
      });
      if (!ings.length) return 'Add at least one ingredient with quantity';
      Store.put('dish', { ...d, id: d.id || `dish-${slug(v.name)}-${uid()}`, name: v.name, meal: v.meal, serves: v.serves, ings });
      toast('Dish saved');
    },
  });
  $('#addIng').onclick = () => { const box = $('#ings'), i = $$('.ingrow', box).length; box.insertAdjacentHTML('beforeend', rowHtml({}, i)); };
}
A.adddish = () => dishForm();
A.editdish = el => dishForm(Store.get(el.dataset.id));
A.messleave = () => formModal({ title: 'Add leave', fields: [{ name: 'res', label: 'Resident', type: 'select', options: resOpts(), required: true, placeholder: 'Choose resident…' }, { name: 'from', label: 'From', type: 'date', value: addDays(today(), 1), required: true }, { name: 'to', label: 'To (including)', type: 'date', value: addDays(today(), 2), required: true }], onSubmit: v => { if (v.to < v.from) return 'End date is before start date'; Store.put('leave', { resId: v.res, roomId: resById(v.res).roomId, from: v.from, to: v.to, date: v.from }); toast('Leave saved'); } });
A.leavedel = el => { Store.remove(el.dataset.id); render(); };

/* ===================================================================== stock & purchase */
PAGES.kitchen = {
  title: 'Stock & Purchase', mod: 'kitchen',
  render() {
    const tab = curTab('kit', 'stock'), prs = Store.all('pr').slice().sort(by('ts', -1));
    const openPr = prs.filter(p => p.status === 'requested' || p.status === 'approved');
    let body = '';
    if (tab === 'stock') {
      const list = items().filter(i => needle('item', i.name));
      body = `<div class="tool">${searchBox('item', 'Search item')}<span class="sp"></span>${isAdmin() ? btn('Add item', 'additem', '', '', 'plus') : ''}</div>
        ${table([
          { h: 'Item', f: i => `<b>${esc(i.name)}</b>` }, { h: 'In stock (est.)', f: i => `${num(stockOf(i))} ${esc(i.unit)}` },
          { h: 'Daily use', f: i => { const s = stockInfo(i); return s.need ? `${num(s.need)} ${esc(i.unit)}` : '—'; } },
          { h: 'Lasts', f: i => { const s = stockInfo(i); return s.days == null ? '—' : s.low ? badge(t('{n} days', { n: s.days }), 'bad') : badge(t('{n} days', { n: s.days }), s.days < 5 ? 'warn' : 'ok'); } },
          { h: 'Learned buffer', f: i => { const l = learnFactor(i.id); return l.cycles ? `×${l.factor} <span class="hint">(${l.cycles})</span>` : '<span class="hint">—</span>'; } },
          { h: '', acts: true, f: i => `${btn('Count', 'countitem', `data-id="${i.id}"`, 'sm')}${isAdmin() ? btn('', 'edititem', `data-id="${i.id}" aria-label="${esc(t('Edit'))}"`, 'sm', 'edit') : ''}` },
        ], list, { key: 'items', emptyT: 'No items yet', empty: 'Items are created automatically when you add dish ingredients.' })}
        ${about('Stock goes down automatically each day by menu × real headcount × learned buffer. When the cook raises a purchase request and enters what is left, the system learns the real usage.')}`;
    } else {
      const list = prs.filter(p => tab === 'open' ? openPr.includes(p) : !openPr.includes(p));
      body = list.length ? `<div class="stack">${list.map(p => `<div class="card"><div class="row sb"><b>${esc(p.no)} · ${fmtDate(p.date)}</b>${badge(p.status === 'requested' ? 'Waiting approval' : p.status === 'approved' ? 'Approved — to buy' : p.status === 'received' ? 'Received' : 'Rejected', p.status === 'received' ? 'ok' : p.status === 'rejected' ? 'bad' : p.status === 'approved' ? 'info' : 'warn')}</div>
          <div class="muted sm" style="margin:4px 0 8px">${esc(p.by || '')}${p.vendor ? ' · ' + esc(p.vendor) : ''}${p.total ? ' · ' + inr(p.total) + ' · ' + t(p.mode === 'credit' ? 'Credit' : 'Cash') : ''}${p.note ? ' · ' + esc(p.note) : ''}</div>
          <dl class="kv">${p.items.map(x => `<dt>${esc(x.name)}${x.leftQty != null ? ` <span class="hint">(${esc(t('left'))} ${num(x.leftQty)})</span>` : ''}</dt><dd>${p.status === 'received' ? `${num(x.recvQty)} ${esc(x.unit)}${x.rate ? ' · ₹' + x.rate : ''}` : `${num(x.qty)} ${esc(x.unit)}${x.qty !== x.reqQty ? ` <span class="hint">(${esc(t('asked'))} ${num(x.reqQty)})</span>` : ''}`}</dd>`).join('')}</dl>
          <div class="row" style="margin-top:10px">${p.status === 'requested' && isAdmin() ? `${btn('Review & approve', 'prview', `data-id="${p.id}"`, 'sm primary')}` : ''}${p.status === 'approved' && canReceive() ? btn('Receive goods', 'prrecv', `data-id="${p.id}"`, 'sm ok', 'check') : ''}${p.status === 'requested' && !isAdmin() ? `<span class="hint">${esc(t('Waiting for owner'))}</span>` : ''}</div></div>`).join('')}</div>` : `<div class="card">${empty(tab === 'open' ? 'No open requests' : 'No history yet')}</div>`;
    }
    return `${head('Stock & Purchase', t('Cook requests, owner decides quantity, goods are received — stock and expenses update themselves.'), btn('Purchase request', 'newpr', '', 'primary', 'cart'))}${seg('kit', [['stock', 'Stock'], ['open', 'Open requests', openPr.length], ['done', 'History']], 'stock')}${body}`;
  },
};
A.newpr = () => {
  const list = items(); if (!list.length) return toast('Add dishes or items first', 'bad');
  const sorted = list.slice().sort((a, b) => (stockInfo(b).low - stockInfo(a).low) || a.name.localeCompare(b.name));
  formModal({
    title: 'Purchase request', submit: 'Send request', wide: true,
    note: t('Enter what is LEFT in the kitchen and how much to buy. Leave empty to skip an item.'),
    extra: `<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>${esc(t('Item'))}</th><th>${esc(t('Left now'))}</th><th>${esc(t('Buy'))}</th></tr></thead><tbody>${sorted.map(i => { const s = stockInfo(i); const sug = s.need ? Math.max(0, Math.ceil(s.need * 7 - (i.stock || 0))) : ''; return `<tr><td><b>${esc(i.name)}</b><div class="hint">${s.low ? `<span class="bad-t">${esc(t('Low'))}</span> · ` : ''}${esc(t('est.'))} ${num(i.stock)} ${esc(i.unit)}${sug ? ` · ${esc(t('suggest'))} ${sug}` : ''}</div></td><td><input name="left_${i.id}" type="number" step="0.1" min="0" inputmode="decimal" placeholder="${num(i.stock)}" style="min-width:80px"></td><td><input name="buy_${i.id}" type="number" step="0.1" min="0" inputmode="decimal" placeholder="${sug || '0'}" style="min-width:80px"></td></tr>`; }).join('')}</tbody></table></div>`,
    fields: [{ name: 'note', label: 'Note for owner', full: true }],
    onSubmit: (v, form) => {
      const rows = [];
      for (const i of sorted) { const b = parseFloat(form.elements['buy_' + i.id].value), l = parseFloat(form.elements['left_' + i.id].value); if (b > 0) rows.push({ itemId: i.id, qty: b, leftQty: isNaN(l) ? null : l }); else if (!isNaN(l)) moveStock(i.id, l - (i.stock || 0), 'count', today(), '', t('Stock count')); }
      if (!rows.length) return 'Enter quantity to buy for at least one item';
      const pr = createPR({ items: rows, note: v.note }); toast(t('{n} sent', { n: pr.no })); ui.tab.kit = 'open';
    },
  });
};
A.prview = el => {
  const p = Store.get(el.dataset.id);
  formModal({
    title: `${p.no} · ${t('Approve')}`, submit: 'Approve', wide: true, note: t('Change any quantity before approving. Set 0 to drop an item.'),
    fields: p.items.map((x, i) => ({ name: 'q' + i, label: `${x.name} (${x.unit})${x.leftQty != null ? ` · ${t('left')} ${num(x.leftQty)}` : ''}`, type: 'number', min: 0, step: 0.1, value: x.qty })),
    danger: { label: 'Reject', run: () => { Store.patch(p.id, { status: 'rejected' }); notify({ to: 'role:cook', title: t('Purchase request rejected'), body: p.no }); closeModal(); render(); toast('Rejected'); } },
    onSubmit: v => { const its = p.items.map((x, i) => ({ ...x, qty: v['q' + i] || 0 })).filter(x => x.qty > 0); if (!its.length) return 'All quantities are 0 — reject instead'; Store.patch(p.id, { items: its, status: 'approved', approvedBy: Store.me.full_name }); notify({ to: 'role:cook', title: t('Purchase approved'), body: p.no, link: 'kitchen' }); toast('Approved'); },
  });
};
A.prrecv = el => {
  const p = Store.get(el.dataset.id);
  formModal({
    title: `${p.no} · ${t('Receive goods')}`, submit: 'Save received', wide: true,
    extra: `<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>${esc(t('Item'))}</th><th>${esc(t('Received'))}</th><th>${esc(t('Rate ₹'))}</th></tr></thead><tbody>${p.items.map(x => `<tr><td><b>${esc(x.name)}</b><div class="hint">${esc(t('ordered'))} ${num(x.qty)} ${esc(x.unit)}</div></td><td><input name="r_${x.itemId}" type="number" step="0.1" min="0" inputmode="decimal" value="${x.qty}"></td><td><input name="p_${x.itemId}" type="number" step="0.01" min="0" inputmode="decimal" value="${(itemById(x.itemId) || {}).rate || ''}"></td></tr>`).join('')}</tbody></table></div>`,
    fields: [{ name: 'vendor', label: 'Vendor / shop' }, { name: 'mode', label: 'Payment', type: 'select', options: [{ v: 'cash', l: t('Cash / paid now') }, { v: 'credit', l: t('Credit (pay later)') }] }, { name: 'date', label: 'Date', type: 'date', value: today() }],
    preview: v => { const f = $('#mform'); if (!f) return ''; return `${esc(t('Total'))}: <b>${inr(sum(p.items, x => (parseFloat(f.elements['r_' + x.itemId].value) || 0) * (parseFloat(f.elements['p_' + x.itemId].value) || 0)))}</b> · ${esc(t('added to expenses automatically'))}`; },
    onSubmit: (v, form) => { const rows = {}; for (const x of p.items) rows[x.itemId] = { qty: parseFloat(form.elements['r_' + x.itemId].value) || 0, rate: parseFloat(form.elements['p_' + x.itemId].value) || 0 }; const pr = receivePR(p.id, rows, v); toast(t('Stock updated · {a}', { a: inr(pr.total) })); },
  });
};
function itemForm(x) {
  const i = x || {};
  formModal({ title: x ? 'Edit item' : 'Add item', fields: [{ name: 'name', label: 'Item name', value: i.name, required: true }, { name: 'unit', label: 'Unit', type: 'select', options: S().units, value: i.unit || 'kg' }, { name: 'stock', label: 'Current stock', type: 'number', step: 0.1, min: 0, value: x ? stockOf(i) : (i.stock ?? 0) }, { name: 'min', label: 'Alert below', type: 'number', step: 0.1, min: 0, value: i.min ?? 0 }, { name: 'rate', label: 'Last price ₹ / unit', type: 'number', step: 0.01, min: 0, value: i.rate ?? '' }],
    danger: x ? { label: 'Delete', run: () => { if (dishes().some(d => (d.ings || []).some(g => g.itemId === i.id))) { toast('Used in a dish — remove it from dishes first', 'bad'); return; } confirmBox(t('Delete {n}?', { n: i.name }), () => Store.remove(i.id), 'Delete', 'bad'); } } : null,
    onSubmit: v => { if (items().some(z => z.name.toLowerCase() === v.name.toLowerCase() && z.id !== i.id)) return 'An item with this name exists'; const { stock, ...rest } = v; Store.put('item', { ...i, id: i.id || `item-${slug(v.name)}-${uid()}`, ...(x ? rest : v), rate: isNaN(v.rate) ? 0 : v.rate }); if (x) countTo(i.id, +stock || 0, 'adjust', t('Edited in the item form')); toast('Saved'); } });
}
A.additem = () => itemForm();
A.edititem = el => itemForm(itemById(el.dataset.id));
A.countitem = el => { const i = itemById(el.dataset.id); formModal({ title: `${t('Stock count')} · ${i.name}`, fields: [{ name: 'q', label: `${t('Actually in kitchen')} (${i.unit})`, type: 'number', step: 0.1, min: 0, value: stockOf(i), required: true }, { name: 'waste', label: 'Part of it was wasted/spoiled', type: 'checkbox' }], onSubmit: v => { countTo(i.id, v.q, v.waste ? 'waste' : 'count', t('Stock count')); toast('Stock updated'); } }); };

/* ===================================================================== housekeeping */
PAGES.housekeeping = {
  title: 'Housekeeping', mod: 'housekeeping',
  render() { return isAdmin() ? hkAdmin() : hkStaffView(); },
};
const HK_STAT = { pending: ['Pending', 'info'], done: ['Cleaned', 'ok'], not_cleaned: ['Not cleaned', 'bad'], missed: ['Missed', 'bad'] };
function hkAdmin() {
  const tab = curTab('hk', 'today'), date = ui.flt.hkd || today();
  let body = '';
  if (tab === 'today') {
    const list = hkTasks().filter(x => x.date === date && (curFlt('hks', 'all') === 'all' || x.status === curFlt('hks', 'all'))).sort((a, b) => String(a.roomNo).localeCompare(String(b.roomNo), undefined, { numeric: true }));
    const all = hkTasks().filter(x => x.date === date), st = s => all.filter(x => x.status === s).length;
    body = `<div class="tool"><input type="date" value="${date}" data-flt="hkd" style="max-width:190px">${chips('hks', [['all', 'All'], ['pending', 'Pending'], ['done', 'Cleaned'], ['missed', 'Missed'], ['not_cleaned', 'Not cleaned']], 'all')}</div>
      <div class="grid g4 keep2" style="margin-bottom:14px">${kpi('Total', all.length, '')}${kpi('Cleaned', st('done'), pct(st('done'), all.length) + '%', 'ok')}${kpi('Pending', st('pending'), '', 'warn')}${kpi('Missed / not cleaned', st('missed') + st('not_cleaned'), '', st('missed') + st('not_cleaned') ? 'bad' : '')}</div>
      ${table([
        { h: 'Room', f: x => `<b>${esc(x.roomNo)}</b> <span class="hint">${esc(x.floor || '')}</span>` }, { h: 'Staff', f: x => esc(x.staffName || t('Unassigned')) }, { h: 'Schedule', f: x => `${esc(x.schedName || '')}${x.time ? ' · ' + fmtTime(x.time) : ''}` },
        { h: 'Status', f: x => `${badge(HK_STAT[x.status][0], HK_STAT[x.status][1])}${x.reason ? `<div class="hint">${esc(x.reason)}</div>` : ''}` },
        { h: 'Resident', f: x => { const fb = hkFeedbackFor(x.id); return fb.length ? fb.map(f => badge(f.ok ? '👍 OK' : '👎 ' + t('Issue'), f.ok ? 'ok' : 'bad')).join(' ') : '<span class="hint">—</span>'; } },
        { h: '', acts: true, f: x => `${x.status !== 'done' && canMarkHk(x) ? btn('Done', 'hkdone', `data-id="${x.id}"`, 'sm ok') : ''}${x.status === 'pending' || x.status === 'missed' ? btn('Reassign', 'hkreassign', `data-id="${x.id}"`, 'sm') : ''}` },
      ], list, { key: 'hkt', emptyT: 'No cleaning tasks for this day', empty: 'Create a schedule to generate tasks automatically.' })}`;
  } else if (tab === 'sched') {
    const list = Store.all('hks');
    body = `<div class="tool"><span class="sp"></span>${btn('New schedule', 'hksched', '', 'primary', 'plus')}</div>
      ${list.length ? `<div class="stack">${list.map(s => `<div class="card"><div class="row sb"><b style="font-size:17px">${esc(s.name)}</b>${badge(s.active === false ? 'Paused' : 'Active', s.active === false ? '' : 'ok')}</div><div class="muted sm" style="margin:4px 0 10px">${esc(s.freq === 'daily' ? t('Every day') : s.freq === 'once' ? fmtDate(s.date) : (s.days || []).map(d => DAYS()[d]).join(', '))}${s.time ? ' · ' + fmtTime(s.time) : ''} · ${t('{n} rooms', { n: (s.rooms || []).length })}</div>
        <div class="row">${Object.entries(groupBy(s.rooms || [], rid => (s.assign || {})[rid] || '')).map(([sid, rs]) => badge(`${(staffById(sid) || {}).name || t('Unassigned')}: ${rs.map(roomName).join(', ')}`, sid ? 'acc' : 'warn')).join('')}</div>
        <div class="row" style="margin-top:12px">${btn('Edit', 'hksched', `data-id="${s.id}"`, 'sm', 'edit')}${btn(s.active === false ? 'Resume' : 'Pause', 'hkpause', `data-id="${s.id}"`, 'sm')}</div></div>`).join('')}</div>` : `<div class="card">${empty('No schedules yet', 'Create one: pick days, floors/rooms and who cleans them.', btn('New schedule', 'hksched', '', 'primary', 'plus'))}</div>`}`;
  } else if (tab === 'staff') {
    const list = hkStaff();
    body = `${group('Housekeeping team', list.map(s => li({ icon: 'broom', ic: s.status === 'active' ? 'ok' : 'mute', t: s.name, d: `${s.phone || ''} · ${t('Today')}: ${hkTasks().filter(x => x.date === today() && x.staffId === s.id && x.status === 'done').length}/${hkTasks().filter(x => x.date === today() && x.staffId === s.id).length} · ${t(s.status === 'active' ? 'Active' : 'Inactive')}`, act: 'go', attrs: 'data-to="settings/hkstaff"' })).join(''), t('Add, edit or deactivate housekeeping staff in Settings → Housekeeping staff.'))}`;
  } else {
    const list = Store.all('hkf').slice().sort(by('ts', -1)).slice(0, 80);
    body = table([{ h: 'Date', f: f => fmtShort(f.date) }, { h: 'Room', f: f => esc(roomName(f.roomId)) }, { h: 'Resident', f: f => esc((resById(f.resId) || {}).name || '—') }, { h: 'Feedback', f: f => badge(f.ok ? '👍 Satisfied' : '👎 Not satisfied', f.ok ? 'ok' : 'bad') }, { h: 'Note', f: f => esc(f.note || '') }], list, { key: 'hkf', emptyT: 'No feedback yet' });
  }
  return `${head('Housekeeping', t('You assign rooms, staff clean them, residents confirm.'), btn('New schedule', 'hksched', '', 'primary', 'plus'))}${seg('hk', [['today', 'Tasks'], ['sched', 'Schedules'], ['staff', 'Staff'], ['fb', 'Resident feedback']], 'today')}${body}`;
}
// Housekeeping staff panel: only my rooms, big buttons.
function hkStaffView() {
  const me = ctx().refId, date = ui.flt.hkd || today();
  const mine = hkTasks().filter(x => x.date === date && x.staffId === me).sort((a, b) => String(a.roomNo).localeCompare(String(b.roomNo), undefined, { numeric: true }));
  const byFloor = groupBy(mine, x => x.floor || '');
  const done = mine.filter(x => x.status === 'done').length;
  return `${head('My rooms', `${fmtDate(date)} · ${t('{a} of {b} done', { a: done, b: mine.length })}`)}
    <div class="days7" style="margin-bottom:14px">${[-1, 0, 1, 2, 3, 4, 5].map(i => addDays(today(), i)).map(d => `<button class="${d === date ? 'on' : ''}" data-act="setflt" data-k="hkd" data-v="${d}"><span>${DAYS()[parse(d).getDay()]}</span><b>${parse(d).getDate()}</b></button>`).join('')}</div>
    <div class="bar ok" style="margin-bottom:14px"><i style="width:${pct(done, mine.length)}%"></i></div>
    ${mine.length ? Object.entries(byFloor).map(([fl, list]) => group(fl, list.map(x => `<div class="li"><span class="ic ${x.status === 'done' ? 'ok' : x.status === 'pending' ? '' : 'bad'}">${ico(x.status === 'done' ? 'check' : 'broom')}</span><span class="body"><span class="t">${t('Room')} ${esc(x.roomNo)}</span><span class="d">${esc(x.schedName || '')}${x.time ? ' · ' + fmtTime(x.time) : ''} · ${esc(t(HK_STAT[x.status][0]))}${x.reason ? ' · ' + esc(x.reason) : ''}</span></span><span class="end">${x.status === 'pending' || x.status === 'missed' ? `${btn('Not done', 'hkno', `data-id="${x.id}"`, 'sm bad')}${btn('Done', 'hkdone', `data-id="${x.id}"`, 'sm ok', 'check')}` : x.status === 'done' ? btn('Undo', 'hkundo', `data-id="${x.id}"`, 'sm') : ''}</span></div>`).join(''))).join('') : `<div class="card">${empty('No rooms for this day', 'Your assigned rooms appear here automatically.')}</div>`}`;
}
A.hkdone = el => {
  const x = Store.get(el.dataset.id);
  setHkStatus(x.id, 'done'); haptic(); toast(t('Room {r} cleaned', { r: x.roomNo })); render();
};
A.hkno = el => { const x = Store.get(el.dataset.id); formModal({ title: `${t('Room')} ${x.roomNo} · ${t('Not cleaned')}`, submit: 'Save', fields: [{ name: 'why', label: 'Reason', type: 'select', options: ['Room locked', 'Resident asked not to', 'No supplies', 'No time', 'Other'], required: true }, { name: 'note', label: 'Note' }], onSubmit: v => { setHkStatus(x.id, 'not_cleaned', { reason: t(v.why) + (v.note ? ' – ' + v.note : '') }); toast('Saved'); } }); };
A.hkundo = el => { Store.patch(el.dataset.id, { status: 'pending', doneAt: null }); render(); };
A.hkpause = el => { const s = Store.get(el.dataset.id); Store.patch(s.id, { active: s.active === false }); render(); };
// Schedule builder: day-wise or date, floors → rooms (multi), and per-room staff assignment.
A.hksched = el => {
  const s = (el && el.dataset && el.dataset.id && Store.get(el.dataset.id)) || { freq: 'weekly', days: [1, 2, 3, 4, 5, 6], rooms: [], assign: {}, time: '10:00', active: true };
  const team = hkStaff().filter(x => x.status === 'active');
  if (!team.length) { toast('Add housekeeping staff first (Settings → Housekeeping staff)', 'bad'); return go('settings/hkstaff'); }
  const staffOpts = `<option value="">${esc(t('Unassigned'))}</option>` + team.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  const byFloor = groupBy(rooms(), r => r.floor);
  const roomsHtml = Object.entries(byFloor).map(([fl, list]) => `<div class="card flat" style="padding:10px 12px;margin-bottom:8px;background:var(--surface)"><div class="row sb"><label class="row nw" style="gap:8px;font-weight:700"><input type="checkbox" data-floor="${esc(fl)}"> ${esc(fl)}</label><select data-floorstaff="${esc(fl)}" style="max-width:180px;min-height:36px;padding:6px 30px 6px 10px">${`<option value="">${esc(t('Assign whole floor…'))}</option>` + team.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
    ${list.map(r => `<div class="row nw" style="gap:8px;margin-top:8px"><label class="row nw" style="gap:8px;flex:1"><input type="checkbox" name="room" value="${r.id}" data-fl="${esc(fl)}" ${s.rooms.includes(r.id) ? 'checked' : ''}> ${t('Room')} ${esc(r.no)}</label><select name="as_${r.id}" style="max-width:180px;min-height:36px;padding:6px 30px 6px 10px">${staffOpts.replace(`value="${(s.assign || {})[r.id] || '__'}"`, `value="${(s.assign || {})[r.id]}" selected`)}</select></div>`).join('')}</div>`).join('');
  const form = formModal({
    title: s.id ? 'Edit schedule' : 'New cleaning schedule', wide: true, submit: 'Save schedule',
    fields: [
      { name: 'name', label: 'Name', value: s.name || t('Daily room cleaning'), required: true }, { name: 'time', label: 'Time', type: 'time', value: s.time },
      { name: 'freq', label: 'Repeats', type: 'select', options: [{ v: 'weekly', l: t('On selected days') }, { v: 'daily', l: t('Every day') }, { v: 'once', l: t('One date only') }], value: s.freq },
      { name: 'date', label: 'Date', type: 'date', value: s.date || today(), hidden: s.freq !== 'once' },
      { name: 'days', label: 'Days', type: 'multi', options: [1, 2, 3, 4, 5, 6, 0].map(d => ({ v: d, l: DAYS()[d] })), value: s.days, full: true },
      { type: 'html', html: `<label class="f">${esc(t('Floors, rooms & who cleans them'))}</label>${roomsHtml}` },
    ],
    onChange: (v, f) => { showField(f, 'date', v.freq === 'once'); showField(f, 'days', v.freq === 'weekly'); },
    danger: s.id ? { label: 'Delete', run: () => confirmBox(t('Delete schedule? Finished tasks stay in history.'), () => { hkTasks().filter(x => x.schedId === s.id && x.status === 'pending' && x.date >= today()).forEach(x => Store.remove(x.id)); Store.remove(s.id); }, 'Delete', 'bad') } : null,
    onSubmit: (v, f) => {
      const roomIds = $$('input[name="room"]:checked', f).map(x => x.value);
      if (!roomIds.length) return 'Select at least one room';
      if (v.freq === 'weekly' && !v.days.length) return 'Select at least one day';
      const assign = {}; for (const id of roomIds) assign[id] = f.elements['as_' + id].value || null;
      const old = s.id ? clone(s.assign || {}) : {};
      const rec = Store.put('hks', { ...s, id: s.id || uid('hks-'), name: v.name, time: v.time, freq: v.freq, date: v.date, days: v.days.map(Number), rooms: roomIds, assign, active: s.active !== false });
      // drop pending tasks for rooms no longer in the schedule, then create/update today & tomorrow
      hkTasks().filter(x => x.schedId === rec.id && x.status === 'pending' && x.date >= today() && !roomIds.includes(x.roomId)).forEach(x => Store.remove(x.id));
      genHkTasks();
      const changed = [...new Set(roomIds.filter(id => assign[id] && assign[id] !== old[id]).map(id => assign[id]))];
      changed.forEach(sid => notify({ to: 'staff', staffId: sid, title: t('New rooms assigned'), body: `${rec.name}: ${roomIds.filter(id => assign[id] === sid).map(roomName).join(', ')}` }));
      toast('Schedule saved');
    },
  });
  showField(form, 'days', s.freq === 'weekly');
  form.addEventListener('change', e => {
    const fl = e.target.dataset.floor, fs = e.target.dataset.floorstaff;
    if (fl != null) $$(`input[data-fl="${CSS.escape(fl)}"]`, form).forEach(x => { x.checked = e.target.checked; });
    if (fs != null && e.target.value) $$(`input[data-fl="${CSS.escape(fs)}"]`, form).forEach(x => { x.checked = true; form.elements['as_' + x.value].value = e.target.value; });
  });
};

/* ===================================================================== laundry (two panels: receive | complete) */
PAGES.laundry = {
  title: 'Laundry', mod: 'laundry',
  render() {
    const tab = curTab('ld', 'recv'), L = S().laundry;
    const open = Store.all('laundry').filter(l => l.status === 'received').sort(by('ts'));
    let body;
    if (tab === 'recv') {
      const recent = Store.all('laundry').filter(l => l.date === today()).sort(by('ts', -1));
      body = `<div class="card" style="margin-bottom:14px"><h3>${ico('shirt')} ${esc(t('Receive clothes'))}</h3><p class="hint" style="margin-bottom:12px">${esc(t('{f} clothes free per resident per month, then ₹{r} per piece.', { f: L.freePcs, r: L.rate }))}</p>${btn('Receive clothes', 'ldrecv', '', 'primary block', 'plus')}</div>
        ${group('Received today', recent.map(l => { const r = resById(l.resId); return li({ lead: avatar(r ? r.name : '?'), t: r ? r.name : '—', d: `${roomName(l.roomId)} · ${l.pcs} ${t('clothes')}${l.charge ? ' · ' + inr(l.charge) : ' · ' + t('free')}`, end: badge(l.status === 'received' ? 'Washing' : 'Done', l.status === 'received' ? 'warn' : 'ok') }); }).join(''))}`;
    } else {
      body = open.length ? `<div class="group">${open.map(l => { const r = resById(l.resId); return `<div class="li">${avatar(r ? r.name : '?')}<span class="body"><span class="t">${esc(r ? r.name : '—')} · ${t('Room')} ${esc(roomName(l.roomId))}</span><span class="d">${l.pcs} ${esc(t('clothes'))} · ${esc(t('received'))} ${fmtShort(l.date)}${l.note ? ' · ' + esc(l.note) : ''}</span></span><span class="end">${btn('Complete', 'lddone', `data-id="${l.id}"`, 'sm ok', 'check')}</span></div>`; }).join('')}</div>` : `<div class="card">${empty('Nothing pending', 'All laundry is completed.')}</div>`;
    }
    return `${head('Laundry', '')}${seg('ld', [['recv', 'Receive'], ['done', 'Complete', open.length]], 'recv')}${body}`;
  },
};
A.ldrecv = () => {
  if (!orgEnabled('laundry')) return;
  formModal({
    title: 'Receive clothes', submit: 'Save',
    fields: [{ name: 'res', label: 'Resident', type: 'select', options: resOpts(), placeholder: 'Choose resident…', required: true }, { name: 'pcs', label: 'Number of clothes', type: 'number', min: 1, max: 200, required: true }, { name: 'note', label: 'Note (e.g. 1 blanket)' }, { name: 'wa', label: 'Tell resident on WhatsApp', type: 'checkbox', value: S().wa.auto }],
    preview: v => { if (!v.res) return ''; const q = laundryQuote(v.res, v.pcs || 0); return `${esc(t('Used this month'))}: <b>${q.used}</b> · ${esc(t('Free left'))}: <b>${q.freeLeft}</b>${v.pcs > 0 ? ` · ${q.extra ? `<span class="bad-t">${esc(t('Charge'))}: ${inr(q.charge)} (${q.extra} × ${inr(S().laundry.rate)})</span>` : `<span class="ok-t">${esc(t('Free'))}</span>`}` : ''}`; },
    onSubmit: v => { const { l, q } = laundryReceive({ resId: v.res, pcs: v.pcs, note: v.note }); closeModal(); render(); toast(q.charge ? t('Saved · {a} added to bill', { a: inr(q.charge) }) : 'Saved'); if (v.wa) waOpen(resById(v.res).phone, laundryMessage(l, 'laundryIn'), 'Send update'); return false; },
  });
};
A.lddone = el => {
  const l = Store.get(el.dataset.id);
  Store.patch(l.id, { status: 'completed', completedAt: nowIso(), doneBy: Store.me.full_name });
  notify({ to: 'res', resId: l.resId, title: t('Laundry ready'), body: `${l.pcs} ${t('clothes')}` });
  render(); toast('Completed');
  if (S().wa.auto) waOpen(resById(l.resId).phone, laundryMessage(l, 'laundryDone'), 'Tell resident');
};

/* ===================================================================== gate */
PAGES.gate = {
  title: 'Gate & Visitors', mod: 'gate',
  render() {
    importDemoVisits();
    const list = Store.all('gate').filter(g => g.date >= addDays(today(), -7)).sort(by('date', -1));
    const inside = list.filter(g => g.type === 'visitor' && !g.outAt), out = list.filter(g => g.type === 'out' && !g.inAt);
    return `${head('Gate & Visitors', t('{v} visitors inside · {o} residents out', { v: inside.length, o: out.length }), `${isAdmin() ? btn('', 'gateqr', `aria-label="${esc(t('Visitor QR'))}" title="${esc(t('Visitor QR'))}"`, '', 'qr') : ''}${btn('Resident out', 'gateout', '', '', 'door')}${btn('New visitor', 'gatevis', '', 'primary', 'plus')}`)}
      <div class="grid g2">${group('Visitors inside', inside.map(g => li({ icon: 'user', ic: g.self ? 'warn' : 'info', raw: true, t: `${esc(g.name)}${g.self ? ' ' + badge('Self entry', 'warn') : ''}`, d: [g.purpose || '', g.resId && resById(g.resId) ? `${t('meeting')} ${resById(g.resId).name}` : g.meet ? `${t('meeting')} ${g.meet}${g.roomNo ? ' (' + g.roomNo + ')' : ''}` : '', g.place ? `${t('from')} ${g.place}` : '', fmtTs(g.inAt)].filter(Boolean).join(' · '), end: btn('Exit', 'gatevout', `data-id="${g.id}"`, 'sm') })).join(''))}
      ${group('Residents out', out.map(g => li({ icon: 'door', ic: 'warn', t: g.name, d: `${g.purpose || ''} · ${t('since')} ${fmtTs(g.outAt)}`, end: btn('Back in', 'gatein', `data-id="${g.id}"`, 'sm ok') })).join(''))}</div>
      <div class="group-t">${esc(t('Last 7 days'))}</div>${table([{ h: 'Time', f: g => fmtTs(g.inAt || g.outAt) }, { h: 'Type', f: g => badge(g.type === 'visitor' ? 'Visitor' : 'Resident', g.type === 'visitor' ? 'info' : 'warn') }, { h: 'Name', f: g => esc(g.name) }, { h: 'Purpose', f: g => esc(g.purpose || '') }, { h: 'From', f: g => esc(g.place || '—') }, { h: 'Back / exit', f: g => fmtTs(g.type === 'visitor' ? g.outAt : g.inAt) }], list, { key: 'gate' })}`;
  },
};
// A gate register is a legal record, so where the visitor came from is part of the entry.
// The pin button fills in GPS coordinates for a guard who cannot type an address quickly; it
// is optional everywhere and simply does nothing if the phone refuses.
A.gatevis = () => formModal({
  title: 'New visitor',
  fields: [
    { name: 'name', label: 'Visitor name', required: true },
    { name: 'phone', label: 'Mobile', type: 'tel' },
    { name: 'res', label: 'Meeting resident', type: 'select', options: resOpts(), placeholder: 'Choose…' },
    { name: 'purpose', label: 'Purpose', value: t('Meeting') },
    { name: 'place', label: 'Coming from', full: true, placeholder: 'Locality, city, state' },
    { type: 'html', html: `<div class="row" style="margin-top:-4px">${btn('Use my current location', 'geoplace', '', 'sm', 'globe')}<span class="hint" id="geomsg"></span></div>` },
  ],
  onSubmit: v => {
    Store.put('gate', { type: 'visitor', name: v.name, phone: phone10(v.phone), resId: v.res || null,
      purpose: v.purpose, place: v.place, geo: geoPick || null, date: today(), inAt: nowIso() });
    geoPick = null;
    if (v.res) notify({ to: 'res', resId: v.res, title: t('Visitor at gate'), body: `${v.name}${v.place ? ' · ' + v.place : ''}` });
    toast('Visitor entered');
  },
});
A.geoplace = async () => {
  const msg = $('#geomsg'), form = $('#mform');
  if (msg) msg.textContent = t('Finding your location…');
  try {
    const p = await Geo.locate();
    geoPick = { lat: Math.round(p.lat * 1e4) / 1e4, lng: Math.round(p.lng * 1e4) / 1e4, at: nowIso() };
    const el = form && form.elements.place;
    if (el) { el.value = p.text; el.dispatchEvent(new Event('input', { bubbles: true })); }
    if (msg) msg.textContent = p.named ? '' : t('Could not name this place — please type the address.');
  } catch (e) { if (msg) msg.textContent = t(e.message); }
};
// Demo mode has no server, so visit.html leaves entries in this browser; bring them in here.
function importDemoVisits() {
  if (CLOUD) return;
  let list; try { list = JSON.parse(localStorage.getItem('hostelos.demo.visits') || '[]'); } catch (e) { return; }
  const mine = list.filter(v => v.h === (Store.ctx || {}).hostelId);
  if (!mine.length) return;
  for (const v of mine) Store.put('gate', { type: 'visitor', self: true, name: v.name, phone: v.phone, meet: v.meet, roomNo: v.roomNo, purpose: v.purpose, place: v.place, geo: v.geo || null, date: v.at.slice(0, 10), inAt: v.at });
  try { localStorage.setItem('hostelos.demo.visits', JSON.stringify(list.filter(v => !mine.includes(v)))); } catch (e) { /* ignore */ }
}
// Self-entry QR: printed at the gate, opens visit.html on the visitor's own phone, no login.
// The key in it can be changed any time, which stops every old printout from working.
const visitKey = () => (S().gate || {}).visitKey || '';
const visitUrl = () => { const h = Store.hostel() || {}; return new URL(`visit.html?h=${encodeURIComponent(h.id)}&k=${encodeURIComponent(visitKey())}&n=${encodeURIComponent(h.name || '')}`, location.href).href; };
A.gateqr = async (el, e, fresh) => {
  if (!isAdmin()) return toast('Only the owner or manager can manage the visitor QR', 'bad');
  if (!visitKey() || fresh) { await Store.saveSettings({ gate: { visitKey: newQrKey(), selfEntry: true } }); }
  if (typeof qrcode !== 'function') await loadScript('vendor/qrcode.js').catch(() => {});
  const on = (S().gate || {}).selfEntry !== false, url = visitUrl();
  sheet('Visitor self-entry QR', `<div class="qr">${qrSvg(url, 6)}</div>
    <p style="text-align:center;margin:10px 0 4px"><b>${esc(hostelName())}</b></p>
    <p class="hint" style="text-align:center">${esc(t('Visitors scan this, fill the form on their own phone and appear in the gate register.'))}</p>
    <div class="row wrap" style="justify-content:center;gap:8px;margin-top:14px">
      ${btn('Print', 'print', '', 'sm', 'download')}${btn('Copy link', 'gateqrcopy', '', 'sm', 'copy')}
      ${btn(on ? 'Turn off' : 'Turn on', 'gateqrtoggle', '', 'sm')}${btn('New QR (old stops working)', 'gateqrnew', '', 'sm bad')}
    </div>`);
};
A.gateqrcopy = async () => { try { await navigator.clipboard.writeText(visitUrl()); toast('Link copied'); } catch (e) { sheet('Link', `<pre class="pre-wrap">${esc(visitUrl())}</pre>`); } };
A.gateqrnew = () => confirmBox(esc(t('Make a new QR? Printed copies of the old one will stop working.')), () => A.gateqr(null, null, true));
A.gateqrtoggle = async () => { await Store.saveSettings({ gate: { selfEntry: (S().gate || {}).selfEntry === false } }); closeModal(); A.gateqr(); };
A.gatevout = el => { Store.patch(el.dataset.id, { outAt: nowIso() }); render(); };
A.gateout = () => formModal({ title: 'Resident going out', fields: [{ name: 'res', label: 'Resident', type: 'select', options: resOpts(), placeholder: 'Choose…', required: true }, { name: 'purpose', label: 'Where / why' }], onSubmit: v => { Store.put('gate', { type: 'out', name: resById(v.res).name, resId: v.res, purpose: v.purpose, date: today(), outAt: nowIso() }); toast('Saved'); } });
A.gatein = el => { Store.patch(el.dataset.id, { inAt: nowIso() }); render(); };

/* ===================================================================== complaints */
const CMP_CATS = ['Electrical', 'Plumbing', 'Cleaning', 'Furniture', 'Wi-Fi', 'Food', 'Other'];
// Two tabs on one screen: things to fix, and things residents have told the owner about
// themselves. They are deliberately separate records — a message about being unwell is not a
// repair job and must never sit in the open-complaints count.
PAGES.complaints = {
  title: 'Complaints', mod: 'complaints',
  render() {
    const tab = curTab('cmptab', 'issues');
    const openN = Store.all('cmp').filter(c => c.status === 'open').length, newN = rinfoUnread().length;
    const tabs = seg('cmptab', [['issues', 'Complaints', openN], ['msgs', 'Messages from residents', newN]], 'issues');
    if (tab === 'msgs') return `${head('Complaints', t('{n} new messages', { n: newN }))}${tabs}${rinfoPanel()}`;
    const f = curFlt('cmp', 'open');
    const list = Store.all('cmp').filter(c => f === 'all' || c.status === f).sort(by('ts', -1));
    return `${head('Complaints', t('{n} open', { n: openN }), btn('New complaint', 'addcmp', '', 'primary', 'plus'))}${tabs}
      <div class="tool">${chips('cmp', [['open', 'Open'], ['progress', 'In progress'], ['resolved', 'Resolved'], ['all', 'All']], 'open')}</div>
      ${list.length ? `<div class="group">${list.map(c => { const r = resById(c.resId); return `<div class="li"><span class="ic ${c.status === 'resolved' ? 'ok' : c.status === 'progress' ? 'warn' : 'bad'}">${ico('wrench')}</span><span class="body"><span class="t">${esc(t(c.cat))} · ${t('Room')} ${esc(roomName(c.roomId))}</span><span class="d">${esc(c.text)}<br>${esc(r ? r.name : c.by || '')} · ${ago(c.ts)}${c.assignee ? ' · ' + t('with') + ' ' + esc(c.assignee) : ''}${c.reply ? ' · ' + esc(c.reply) : ''}</span></span><span class="end">${c.status !== 'resolved' ? `${c.status === 'open' ? btn('Start', 'cmpstart', `data-id="${c.id}"`, 'sm') : ''}${btn('Resolve', 'cmpdone', `data-id="${c.id}"`, 'sm ok')}` : badge('Resolved', 'ok')}</span></div>`; }).join('')}</div>` : `<div class="card">${empty('No complaints here')}</div>`}`;
  },
};
function rinfoPanel() {
  const f = curFlt('rinf', 'new');
  const all = rinfos().slice().sort(by('ts', -1));
  const list = all.filter(x => f === 'all' || (f === 'new' ? x.status !== 'seen' : x.status === 'seen'));
  const dates = x => (x.from ? `${fmtShort(x.from)}${x.to && x.to !== x.from ? ' – ' + fmtShort(x.to) : ''}` : '');
  return `<div class="tool">${chips('rinf', [['new', 'New'], ['seen', 'Seen'], ['all', 'All']], 'new')}</div>
    ${list.length ? `<div class="group">${list.map(x => { const r = resById(x.resId); return `<div class="li"><span class="ic ${x.status === 'seen' ? 'mute' : 'info'}">${ico(rinfoIcon(x.type))}</span><span class="body"><span class="t">${esc(rinfoLabel(x.type))} · ${esc(r ? r.name : '')}${x.roomId ? ' · ' + esc(roomName(x.roomId)) : ''}</span><span class="d">${x.text ? esc(x.text) + '<br>' : ''}${dates(x) ? esc(dates(x)) + ' · ' : ''}${esc(ago(x.ts))}${x.reply ? ' · ' + esc(t('You said')) + ': ' + esc(x.reply) : ''}</span></span><span class="end">${x.status === 'seen' ? badge('Seen', 'ok') : `${btn('Noted', 'rinfook', `data-id="${x.id}"`, 'sm ok')}${btn('Reply', 'rinforeply', `data-id="${x.id}"`, 'sm')}`}</span></div>`; }).join('')}</div>`
      : `<div class="card">${empty('Nothing from residents here', 'Residents can tell you they are unwell, going home or will be back late from their app.')}</div>`}`;
}
A.rinfook = el => { rinfoReply(el.dataset.id, ''); toast('Marked as seen'); render(); };
A.rinforeply = el => {
  const x = Store.get(el.dataset.id); if (!x) return;
  const r = resById(x.resId);
  formModal({
    title: `${rinfoLabel(x.type)} · ${r ? r.name : ''}`, submit: 'Send reply',
    note: x.text ? esc(x.text) : '',
    fields: [{ name: 'reply', label: 'Your reply', value: t('Noted, thank you for telling me.'), full: true, required: true }],
    onSubmit: v => { rinfoReply(x.id, v.reply); toast('Reply sent'); },
  });
};
A.addcmp = () => formModal({ title: 'New complaint', fields: [{ name: 'room', label: 'Room', type: 'select', options: rooms().map(r => ({ v: r.id, l: r.no })), required: true }, { name: 'cat', label: 'Category', type: 'select', options: CMP_CATS }, { name: 'text', label: 'Problem', type: 'textarea', required: true, full: true }], onSubmit: v => { Store.put('cmp', { roomId: v.room, cat: v.cat, text: v.text, status: 'open', date: today(), ts: nowIso(), src: 'staff', by: Store.me.full_name }); toast('Complaint added'); } });
A.cmpstart = el => formModal({ title: 'Assign', fields: [{ name: 'who', label: 'Who will fix it?', type: 'select', options: staffList().filter(s => s.status === 'active').map(s => ({ v: s.name, l: `${s.name} · ${t(s.dept)}` })).concat([{ v: t('Outside technician'), l: t('Outside technician') }]) }], onSubmit: v => { const c = Store.get(el.dataset.id); Store.patch(c.id, { status: 'progress', assignee: v.who }); if (c.resId) notify({ to: 'res', resId: c.resId, title: t('Complaint in progress'), body: `${t(c.cat)} · ${v.who}` }); toast('Assigned'); } });
A.cmpdone = el => formModal({ title: 'Resolve complaint', fields: [{ name: 'reply', label: 'What was done?', value: t('Fixed') }], onSubmit: v => { const c = Store.get(el.dataset.id); Store.patch(c.id, { status: 'resolved', reply: v.reply, resolvedAt: nowIso() }); if (c.resId) notify({ to: 'res', resId: c.resId, title: t('Complaint resolved'), body: `${t(c.cat)}: ${v.reply}` }); toast('Resolved'); } });

/* ===================================================================== staff & salary */
PAGES.staff = {
  title: 'Staff & Salary', mod: 'staff',
  render() {
    const tab = curTab('st', 'team'), ym = ui.flt.stm || ymOf(today());
    const list = staffList().filter(s => curFlt('stf', 'active') === 'all' || s.status === curFlt('stf', 'active'));
    let body;
    if (tab === 'team') {
      body = `<div class="tool">${chips('stf', [['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']], 'active')}</div>
        ${group('', list.map(s => li({ lead: avatar(s.name), t: s.name, d: `${t(s.dept)} · ${s.phone || ''} · ${inr(s.salary)}/${t('month')}${s.username ? ' · @' + s.username : ''}`, end: s.status === 'active' ? '' : badge('Inactive'), act: 'staffview', attrs: `data-id="${s.id}"` })).join(''))}`;
    } else if (tab === 'att') {
      const dim = daysIn(ym), lastD = ym === ymOf(today()) ? +today().slice(8) : dim;
      body = `<div class="tool"><input type="month" value="${ym}" data-flt="stm" style="max-width:190px"><span class="hint">${esc(t('Tap a day: P → A → H (half) → blank'))}</span></div>
        <div class="stack">${staffList().filter(s => s.status === 'active').map(s => { const rec = Store.get(`att-${s.id}-${ym}`) || { days: {} }, a = rec.days, pu = rec.punch || {}; return `<div class="card"><div class="row sb" style="margin-bottom:8px"><b>${esc(s.name)}</b><span class="row" style="gap:6px">${btn('All present', 'attall', `data-id="${s.id}" data-ym="${ym}"`, 'sm')}</span></div><div class="att">${[...Array(dim)].map((_, i) => { const d = i + 1, v = a[d] || '', p = pu[d]; return `<button class="${v}${p ? ' punched' : ''}" data-act="attmark" data-id="${s.id}" data-ym="${ym}" data-d="${d}" ${p ? `title="${esc(t('Punched in {t}', { t: fmtTs(p.at) }) + (p.dist != null ? ` · ${p.dist} m` : ''))}"` : ''} ${d > lastD ? 'disabled style="opacity:.35"' : ''}>${d}${v ? '<br>' + v : ''}</button>`; }).join('')}</div></div>`; }).join('') || empty('No active staff')}</div>`;
    } else {
      body = `<div class="tool"><input type="month" value="${ym}" data-flt="stm" style="max-width:190px"></div>` + table([
        { h: 'Staff', f: s => `<b>${esc(s.name)}</b><div class="hint">${esc(t(s.dept))}</div>` }, { h: 'Salary', f: s => inr(s.salary) },
        { h: 'Attendance', f: s => { const p = payrollFor(s, ym); return `P ${p.P} · A ${p.A} · H ${p.H}`; } },
        { h: 'Payable', f: s => `<b>${inr(payrollFor(s, ym).payable)}</b>` }, { h: 'Paid', f: s => inr(payrollFor(s, ym).paid) },
        { h: '', acts: true, f: s => { const p = payrollFor(s, ym); return p.due > 0 ? btn(t('Pay {a}', { a: inr(p.due) }), 'paysal', `data-id="${s.id}" data-ym="${ym}"`, 'sm ok') : badge('Paid', 'ok'); } },
      ], staffList().filter(s => s.status === 'active'), { key: 'sal' }) + `${about('Only marked absences reduce salary (half day = half). Salary payments are added to expenses.')}`;
    }
    return `${head('Staff & Salary', t('{n} active', { n: staffList().filter(s => s.status === 'active').length }), btn('Add staff', 'addstaff', '', 'primary', 'plus'))}${seg('st', [['team', 'Team'], ['att', 'Attendance'], ['pay', 'Salary']], 'team')}${body}`;
  },
};
const STAFF_ROLE_BY_DEPT = { Kitchen: 'cook', Housekeeping: 'housekeeping', Laundry: 'laundry', Security: 'guard', Office: 'manager' };
function staffForm(x) {
  const s = { status: 'active', dept: S().departments[0], ...(x || {}) }, isNew = !s.id;
  const req = S().staffDocs.required;
  formModal({
    title: isNew ? 'Add staff' : 'Edit staff', wide: true,
    fields: [
      { name: 'name', label: 'Full name', value: s.name, required: true }, { name: 'phone', label: 'Mobile', type: 'tel', value: s.phone, required: true },
      { name: 'dept', label: 'Department', type: 'select', options: S().departments.map(d => ({ v: d, l: t(d) })), value: s.dept, hint: `<a href="#/settings/depts">${esc(t('Edit departments'))}</a>` },
      { name: 'salary', label: 'Monthly salary (₹)', type: 'number', min: 0, value: s.salary }, { name: 'joinDate', label: 'Joining date', type: 'date', value: s.joinDate || today() },
      { name: 'idNo', label: 'ID number', value: s.idNo }, { name: 'address', label: 'Address', value: s.address, full: true },
      ...(!isNew ? [] : [{ name: 'login', label: 'Create app login (shows only their work)', type: 'checkbox', value: true, hint: t('User ID = name, password = mobile number.'), full: true }]),
      { type: 'section', label: 'Documents' }, ...req.map((d, i) => ({ name: 'doc' + i, label: d, type: 'file', accept: 'image/*,application/pdf' })),
      { type: 'html', html: docsNote() },
    ],
    onSubmit: async v => {
      const rec = Store.put('staff', { ...s, id: s.id || uid('st-'), name: v.name, phone: phone10(v.phone), dept: v.dept, role: STAFF_ROLE_BY_DEPT[v.dept] || 'staff', salary: v.salary || 0, joinDate: v.joinDate, idNo: v.idNo, address: v.address, docs: s.docs || [] });
      const files = req.map((d, i) => ({ type: d, file: (v['doc' + i] || [])[0] })).filter(f => f.file);
      if (files.length) uploadDocs('staff', rec.id, files);
      if (v.login) {
        const h = Store.hostel();
        try { const u = await Backend.admin('create_user', { full_name: rec.name, phone: rec.phone, org_id: h.org_id, hostel_id: h.id, role: rec.role, ref_id: rec.id }); Store.patch(rec.id, { userId: u.user_id, username: u.username }); closeModal(); render(); waOpen(rec.phone, tpl('staffWelcome', { name: rec.name.split(' ')[0], role: t(ROLES[rec.role].l), hostel: hostelName(), link: appUrl(), username: u.username, password: u.password }), 'Send login'); return false; }
        catch (e) { toast(t('Login not created: {m}', { m: e.message }), 'bad'); }
      }
      toast('Staff saved');
    },
  });
}
A.addstaff = () => staffForm();
A.staffview = el => {
  const s = staffById(el.dataset.id), p = payrollFor(s, ymOf(today()));
  sheet(s.name, `<dl class="kv"><dt>${esc(t('Department'))}</dt><dd>${esc(t(s.dept))}</dd><dt>${esc(t('Mobile'))}</dt><dd>${esc(s.phone)}</dd><dt>${esc(t('Salary'))}</dt><dd>${inr(s.salary)}</dd><dt>${esc(t('This month'))}</dt><dd>P ${p.P} · A ${p.A} · H ${p.H}</dd><dt>${esc(t('Login'))}</dt><dd>${s.username ? '@' + esc(s.username) : esc(t('None'))}</dd></dl>
    ${group('Documents', (s.docs || []).map(d => li({ icon: 'file', ic: 'info', t: t(d.type), end: docOpen(d) })).join(''))}`,
  { foot: `<button class="btn" data-act="staffedit" data-id="${s.id}">${ico('edit', 'sm')} ${esc(t('Edit'))}</button><button class="btn ${s.status === 'active' ? 'bad' : 'ok'}" data-act="staffstatus" data-id="${s.id}">${esc(t(s.status === 'active' ? 'Deactivate' : 'Activate'))}</button>${s.status !== 'active' ? `<button class="btn bad" data-act="staffremove" data-id="${s.id}">${esc(t('Remove'))}</button>` : ''}` });
};
A.staffedit = el => staffForm(staffById(el.dataset.id));
A.staffstatus = el => {
  const s = staffById(el.dataset.id), on = s.status !== 'active';
  Store.patch(s.id, { status: on ? 'active' : 'inactive' });
  if (s.userId) Backend.admin('set_active', { user_id: s.userId, active: on }).catch(e => toast(e.message, 'bad'));
  if (!on) hkTasks().filter(x => x.staffId === s.id && x.status === 'pending' && x.date >= today()).forEach(x => Store.patch(x.id, { staffId: null, staffName: '' }));
  closeModal(); render(); toast(on ? 'Activated' : 'Deactivated — their pending rooms are now unassigned');
};
// Soft remove: hidden everywhere, but past tasks, salary and attendance keep their name.
A.staffremove = el => confirmBox(t('Remove this staff member? Their history (tasks, salary) is kept.'), () => {
  const s = staffById(el.dataset.id); Store.patch(s.id, { status: 'removed', removedOn: today() });
  for (const sc of Store.all('hks')) if (Object.values(sc.assign || {}).includes(s.id)) { const a = { ...sc.assign }; for (const k in a) if (a[k] === s.id) a[k] = null; Store.patch(sc.id, { assign: a }); }
  // A failure here must be seen: the record says "removed" but their login would still work.
  if (s.userId) Backend.admin('set_active', { user_id: s.userId, active: false }).catch(e => toast(`${t('Their login is still active')}: ${e.message}`, 'bad'));
}, 'Remove', 'bad');
A.attmark = el => {
  const id = `att-${el.dataset.id}-${el.dataset.ym}`, cur = Store.get(id) || { id, staffId: el.dataset.id, ym: el.dataset.ym, days: {} };
  const nx = { '': 'P', P: 'A', A: 'H', H: '' }[cur.days[el.dataset.d] || ''];
  const days = { ...cur.days }; if (nx) days[el.dataset.d] = nx; else delete days[el.dataset.d];
  Store.put('att', { ...cur, days }); render();
};
A.attall = el => { const id = `att-${el.dataset.id}-${el.dataset.ym}`, cur = Store.get(id) || { id, staffId: el.dataset.id, ym: el.dataset.ym, days: {} }; const last = el.dataset.ym === ymOf(today()) ? +today().slice(8) : daysIn(el.dataset.ym); const days = { ...cur.days }; for (let d = 1; d <= last; d++) if (!days[d]) days[d] = 'P'; Store.put('att', { ...cur, days }); render(); };
A.paysal = el => { const s = staffById(el.dataset.id), p = payrollFor(s, el.dataset.ym); formModal({ title: `${t('Pay salary')} · ${s.name}`, fields: [{ name: 'amount', label: 'Amount (₹)', type: 'number', min: 1, value: p.due, required: true }, { name: 'mode', label: 'Paid by', type: 'select', options: [{ v: 'cash', l: t('Cash') }, { v: 'upi', l: 'UPI' }, { v: 'bank', l: t('Bank transfer') }] }], onSubmit: v => { const sal = Store.put('sal', { staffId: s.id, staffName: s.name, ym: el.dataset.ym, amount: v.amount, mode: v.mode, date: today() }); Store.put('exp', { id: `exp-${sal.id}`, date: today(), cat: S().expenseCats.includes('Salary') ? 'Salary' : 'Other', amount: v.amount, mode: 'cash', paid: true, vendor: s.name, note: `${t('Salary')} ${fmtYM(el.dataset.ym)}`, ref: sal.id }); toast('Salary paid'); } }); };

/* ===================================================================== attendance (residents)
 * A roll call, not a time sheet. Everyone is present by default and the owner only flips the
 * people who are not there, so a normal evening is zero taps and a busy one is two or three.
 * How many roll calls there are in a day, and when, is the owner's to set, because some PGs
 * take one at the gate at 9 pm and others take none at all.
 */
const attDate = () => ui.attd || today();
const attMonthSel = () => ui.attm || ymOf(today());
const attCurPeriod = () => { const ps = attPeriods(); const k = curFlt('attp', (ps[0] || {}).k); return ps.some(p => p.k === k) ? k : (ps[0] || {}).k; };

PAGES.attendance = {
  title: 'Attendance', mod: 'attendance', when: () => attOn(),
  render() {
    const ps = attPeriods();
    if (!ps.length) return `${head('Attendance')}<div class="card">${empty('No roll call set up yet', 'Add at least one roll call time in Settings.', can('settings') ? btn('Open settings', 'go', 'data-to="settings/attend"', 'primary') : '')}</div>`;
    return curTab('att', 'roll') === 'month' ? attMonthView() : attRollView();
  },
};

function attRollView() {
  const d = attDate(), pk = attCurPeriod(), ps = attPeriods(), per = attPeriod(pk);
  const roll = attRoll(d, pk);
  const future = d > today();
  const q = (ui.q.att || '').toLowerCase().trim();
  const list = roll.list.filter(r => !q || `${r.name} ${roomName(r.roomId)}`.toLowerCase().includes(q));
  const row = r => {
    const absent = attAbsentOn(r.id, d, pk);
    // if they told the owner they would be away, say so instead of making him remember
    const told = rinfoCovering(r.id, d)[0];
    const note = [roomName(r.roomId) + (r.bed ? '-' + r.bed : ''), told ? `${rinfoLabel(told.type)}${told.text ? ': ' + told.text : ''}` : ''].filter(Boolean).join(' · ');
    return `<div class="li"><span class="ic ${absent ? 'bad' : 'ok'}">${ico(absent ? 'x' : 'check')}</span>
      <span class="body"><span class="t ell">${esc(r.name)}</span><span class="d">${esc(note)}</span></span>
      <span class="end"><span class="muted xs hide-s" style="margin-right:6px">${esc(t(absent ? 'Absent' : 'Present'))}</span>
      <label class="sw"><input type="checkbox" data-att="${r.id}" data-d="${d}" data-p="${pk}" ${absent ? '' : 'checked'} ${future ? 'disabled' : ''}
        aria-label="${esc(t('{n} is present', { n: r.name }))}"><span></span></label></span></div>`;
  };
  return `${head('Attendance', `${esc(t(per.l))}${per.time ? ' · ' + fmtTime(per.time) : ''}`)}
    ${seg('att', [['roll', 'Roll call'], ['month', 'This month']], 'roll')}
    <div class="tool nw" style="gap:6px">
      ${btn('', 'attday', `data-d="${addDays(d, -1)}" aria-label="${esc(t('Previous day'))}"`, 'sm', 'back')}
      <b style="flex:1;text-align:center;min-width:0">${esc(fmtDate(d))}${d === today() ? ' · ' + esc(t('Today')) : ''}</b>
      ${btn('', 'attday', `data-d="${addDays(d, 1)}" aria-label="${esc(t('Next day'))}"`, 'sm', 'chev')}
      ${d !== today() ? btn('Today', 'attday', `data-d="${today()}"`, 'sm') : ''}
    </div>
    ${ps.length > 1 ? `<div class="tool">${chips('attp', ps.map(p => [p.k, p.l]), ps[0].k)}</div>` : ''}
    <div class="grid g2 keep2" style="margin:0 0 14px">
      ${kpi('Present', roll.present, t('of {n} living here', { n: roll.total }), 'ok', null, 'check')}
      ${kpi('Absent', roll.absent, roll.absent ? roll.absent === 1 ? t('1 person') : t('{n} people', { n: roll.absent }) : t('everyone is in'), roll.absent ? 'bad' : '', null, 'x')}
    </div>
    ${future ? `<div class="note">${esc(t('This day has not happened yet.'))}</div>` : ''}
    <div class="tool">${searchBox('att', 'Search name or room')}</div>
    <div class="tool">${roll.absent && !future ? btn('All present', 'attclear', `data-d="${d}" data-p="${pk}"`, 'sm ok', 'check') : ''}<span class="sp"></span>${btn('Export', 'attexport', '', 'sm', 'download')}</div>
    ${list.length ? `<div class="group">${list.map(row).join('')}</div>` : `<div class="card">${empty('Nobody found', 'Try another search.')}</div>`}
    ${about('Everyone counts as present. Switch off only the people who are not here.')}`;
}

function attMonthView() {
  const ym = attMonthSel(), ps = attPeriods();
  const list = activeRes().filter(r => r.checkIn <= `${ym}-31`).sort(by('name'));
  const rows = list.map(r => ({ r, m: attMonth(r.id, ym) }));
  const absentTotal = sum(rows, x => x.m.absent);
  const next = addMonths(ym, 1), cur = ymOf(today());
  return `${head('Attendance', t('{n} absences in {m}', { n: absentTotal, m: fmtYM(ym) }))}
    ${seg('att', [['roll', 'Roll call'], ['month', 'This month']], 'roll')}
    <div class="tool nw" style="gap:6px">
      ${btn('', 'attmon', `data-m="${addMonths(ym, -1)}" aria-label="${esc(t('Previous month'))}"`, 'sm', 'back')}
      <b style="flex:1;text-align:center">${esc(fmtYM(ym))}</b>
      ${next <= cur ? btn('', 'attmon', `data-m="${next}" aria-label="${esc(t('Next month'))}"`, 'sm', 'chev') : ''}
      <span class="sp"></span>${btn('Export', 'attexport', '', 'sm', 'download')}
    </div>
    ${table([
      { h: 'Resident', f: x => (can('residents') ? person(x.r, roomName(x.r.roomId)) : `<b>${esc(x.r.name)}</b><div class="hint">${esc(roomName(x.r.roomId))}</div>`) },
      { h: 'Present', f: x => `<b class="ok-t">${x.m.present}</b>` },
      { h: 'Absent', f: x => (x.m.absent ? `<b class="bad-t">${x.m.absent}</b>` : '0') },
      { h: 'Days absent', f: x => (x.m.absentDays.length ? esc(x.m.absentDays.join(', ')) : '—') },
    ], rows, { key: 'attm', emptyT: 'Nobody was living here in this month' })}
    ${ps.length > 1 ? `${about('A day counts as absent if the resident missed any roll call that day.')}` : ''}`;
}

A.attday = el => { ui.attd = el.dataset.d; render(); };
A.attmon = el => { ui.attm = el.dataset.m; render(); };
A.attclear = el => {
  const d = el.dataset.d, pk = el.dataset.p;
  const gone = attRoll(d, pk).absentList;
  if (!gone.length) return;
  confirmBox(t('Mark all {n} back as present for this roll call?', { n: gone.length }), () => {
    gone.forEach(r => attSet(r.id, d, pk, false));
    toast('Everyone marked present');
  }, 'Mark present', 'ok');
};
A.attexport = () => {
  const ym = curTab('att', 'roll') === 'month' ? attMonthSel() : ymOf(attDate());
  const last = daysIn(ym);
  const head_ = ['Resident', 'Room', 'Present', 'Absent', ...Array.from({ length: last }, (_, i) => String(i + 1))];
  const rows = activeRes().filter(r => r.checkIn <= `${ym}-31`).sort(by('name')).map(r => {
    const m = attMonth(r.id, ym);
    return [r.name, roomName(r.roomId), m.present, m.absent,
      ...Array.from({ length: last }, (_, i) => (m.raw[i + 1] && m.raw[i + 1].length ? 'A' : i + 1 <= m.days ? 'P' : ''))];
  });
  download(`attendance-${ym}.csv`, csv([head_, ...rows]), 'text/csv');
};
// Toggles live on a real checkbox, so the switch animates natively and the page redraws from
// the store afterwards — the stored absences stay the single source of truth.
document.addEventListener('change', e => {
  const id = e.target.dataset && e.target.dataset.att; if (!id) return;
  attSet(id, e.target.dataset.d, e.target.dataset.p, !e.target.checked);
  haptic();
  render();
});
