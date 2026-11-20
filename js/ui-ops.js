'use strict';
let geoPick = null;   // coordinates captured for the visitor form that is currently open
/* Daily operations: mess & menu, stock & purchase, housekeeping, laundry, gate, complaints, staff. */

/* ===================================================================== mess */
PAGES.mess = {
  title: 'Mess & Menu', mod: 'mess',
  render() {
    const showDishes = can('kitchen') && (S().mess || {}).trackStock !== false;
    let tab = curTab('mess', 'today');
    if (!showDishes && tab === 'dishes') {
      tab = 'today';
      ui.tab.mess = 'today';
    }
    const date = ui.flt.messd || today();
    let body = '';
    if (tab === 'today') {
      const strip = [...Array(7)].map((_, i) => addDays(today(), i - 1)), platesOn = !!(S().mess || {}).plates;
      body = `<div class="days7" style="margin-bottom:12px">${strip.map(d => `<button class="${d === date ? 'on' : ''}" data-act="setflt" data-k="messd" data-v="${d}"><span>${DAYS()[parse(d).getDay()]}</span><b>${parse(d).getDate()}</b></button>`).join('')}</div>
        <div class="cook-grid">${meals().map(m => {
          const p = cookPlan(date, m.k), hc = p.hc, open = beforeCutoff(date, m.k, 'skip');
          const chip = (label, n, warn) => `<span class="cook-chip ${n && warn ? 'warn' : ''}"><b>${n}</b> ${esc(t(label))}</span>`;
          const dishes_ = p.dishes.length ? esc(p.dishes.map(d => d.name).join(' · ')) : `<span class="muted">${esc(t('No menu set for this meal'))}</span>`;
          const ing = showDishes && p.list.length ? `<details class="cook-ing"><summary>${esc(t('Ingredients to take out'))} <span class="muted xs">(${p.list.length})</span></summary><div class="cook-ing-list">${p.list.map(x => `<div><span>${esc(x.item.name)}${x.factor !== 1 ? ` <i class="muted">×${x.factor}</i>` : ''}</span><b>${num(x.qty)} ${esc(x.item.unit)}</b></div>`).join('')}</div></details>` : '';
          const acts = `${hc.tiffin ? btn(t('Tiffin list') + ` (${hc.tiffin})`, 'tiflist', `data-date="${date}" data-meal="${m.k}"`, 'sm', 'pack') : ''}${platesOn ? `${btn(hc.served != null ? t('Served: {n}', { n: hc.served }) : 'Mark plates served', 'served', `data-date="${date}" data-meal="${m.k}"`, 'sm')}${btn('Guests', 'guests', `data-date="${date}" data-meal="${m.k}"`, 'sm')}` : ''}`;
          return `<div class="card cook"><div class="cook-h"><div><b class="cook-m">${esc(mealName(m.k))}</b> <span class="muted xs">${fmtTime(m.time)}</span></div>${badge(open ? t('Skips open till {t}', { t: fmtTime(m.cutoff) }) : 'Count final', open ? 'info' : 'ok')}</div>
            <div class="cook-n"><span>${esc(t('Cook for'))}</span><b>${hc.eat}</b><span>${esc(t('plates'))}</span></div>
            <div class="cook-st">${chip('skipped', hc.skip, true)}${chip('on leave', hc.leave)}${chip('tiffin', hc.tiffin, true)}${hc.guests ? chip('guests', hc.guests) : ''}</div>
            <div class="cook-menu">${dishes_}</div>${ing}${acts ? `<div class="cook-a">${acts}</div>` : ''}</div>`;
        }).join('')}</div>`;
    } else if (tab === 'menu') {
      const w = menuDoc().week;
      const order = [1, 2, 3, 4, 5, 6, 0], todayD = new Date().getDay(), msAll = meals();
      const nowT = new Date().toTimeString().slice(0, 5);
      const defMeal = (msAll.find(m => m.time >= nowT) || msAll[msAll.length - 1] || {}).k;
      const selM = ui.flt.menum === 'all' ? 'all' : (msAll.some(m => m.k === ui.flt.menum) ? ui.flt.menum : defMeal);
      const dishesOf = (d, mk) => ((w[d] || {})[mk] || []).map(id => Store.get(id)).filter(Boolean);
      const chipsOf = ds => ds.map(x => `<span class="mn-dt ${x.unavailable ? 'bad' : ''}">${esc(x.name)}</span>`).join('');
      const picker = `<div class="chips mn-meals-pick">${msAll.map(m => `<button class="chip ${selM === m.k ? 'on' : ''}" data-act="setflt" data-k="menum" data-v="${m.k}">${esc(mealName(m.k))} <small>${fmtTime(m.time)}</small></button>`).join('')}<button class="chip ${selM === 'all' ? 'on' : ''}" data-act="setflt" data-k="menum" data-v="all">${esc(t('All meals'))}</button></div>`;
      let view;
      if (selM === 'all') {
        const cell = (d, mk) => { const ds = dishesOf(d, mk); return `<button class="c ${d === todayD ? 'today' : ''} ${ds.length ? '' : 'empty'}" data-act="menucell" data-day="${d}" data-meal="${mk}" aria-label="${esc(DAYS()[d])} ${esc(mealName(mk))}">${ds.length ? chipsOf(ds) : `<span class="mn-add">+ ${esc(t('Add'))}</span>`}</button>`; };
        view = `<div class="scroll-x"><div class="mgrid" style="--cols:${msAll.length};min-width:${88 + msAll.length * 150}px"><div class="corner"></div>${msAll.map(m => `<div class="h">${esc(mealName(m.k))}<span>${fmtTime(m.time)}</span></div>`).join('')}
          ${order.map(d => `<div class="d ${d === todayD ? 'today' : ''}"><b>${esc(DAYS()[d].slice(0, 3))}</b>${d === todayD ? `<small>${esc(t('Today'))}</small>` : ''}</div>${msAll.map(m => cell(d, m.k)).join('')}`).join('')}</div></div>`;
      } else {
        const planned = order.filter(d => dishesOf(d, selM).length).length, monday = addDays(today(), -((todayD + 6) % 7)), dateNo = d => +addDays(monday, (d + 6) % 7).slice(8);
        view = `<div class="mw-head"><div class="mw-title"><span class="mw-ic">${ico('utensils', 'sm')}</span><div><b>${esc(mealName(selM))}</b><span class="muted">${fmtTime(mealByKey(selM).time)}</span></div></div><span class="badge ${planned === 7 ? 'ok' : 'warn'}">${esc(t('{n} of 7 days planned', { n: planned }))}</span></div>
          <div class="mw-list">${order.map(d => { const ds = dishesOf(d, selM); return `<div class="mw-row ${d === todayD ? 'today' : ''}">
            <button type="button" class="mw-main" data-act="menucell" data-day="${d}" data-meal="${selM}" aria-label="${esc(DAYS()[d])} ${esc(mealName(selM))}"><span class="mw-day"><b>${esc(DAYS()[d].slice(0, 3))}</b><i>${dateNo(d)}</i></span><span class="mw-dishes">${ds.length ? chipsOf(ds) : `<span class="mn-add">+ ${esc(t('Add dishes'))}</span>`}</span><span class="mw-edit">${ico(ds.length ? 'edit' : 'plus', 'sm')}</span></button>
</div>`; }).join('')}</div>`;
      }
      body = `${about('Pick a meal time to see that meal for the whole week, or "All meals" for the full grid. Tap a day to choose its dishes. Residents see this menu in their app.')}${picker}${view}`;
    } else if (tab === 'dishes' && showDishes) {
      body = `<div class="tool">${searchBox('dish', 'Search dish')}<span class="sp"></span><div class="tool-actions">${btn('Replace ingredient', 'replaceing', '', '', 'repeat')}${btn('Add dish', 'adddish', '', 'primary', 'plus')}</div></div>
        ${(() => { const seen = {}; dishes().forEach(x => { const k = x.name.trim().toLowerCase(); seen[k] = (seen[k] || 0) + 1; }); window.__dupDish = seen; return ''; })()}${group('', dishes().filter(d => needle('dish', d.name)).map(d => li({ icon: 'utensils', ic: d.unavailable ? 'bad' : 'warn', t: d.name + (d.unavailable ? ` · ${t('Unavailable')}` : ''), d: `${t(d.meal === 'any' ? 'Any meal' : mealName(d.meal))} · ${(d.ings || []).map(g => `${(itemById(g.itemId) || {}).name || '?'} ${num(g.qty)}${(itemById(g.itemId) || {}).unit || ''}`).join(', ')} · ${t('for {n} people', { n: d.serves })}${d.unavailable ? ` · <span class="bad-t">${t('Needs ingredient')} ${esc(d.missingItem || '')}</span>` : ''}`, act: 'editdish', attrs: `data-id="${d.id}"`, end: d.unavailable ? btn('Substitute', 'replaceing', `data-id="${(d.ings && d.ings[0] && d.ings[0].itemId) || ''}"`, 'sm warn') : ((window.__dupDish || {})[d.name.trim().toLowerCase()] > 1 ? badge('Duplicate name', 'warn') : '') })).join(''), t('Ingredient quantities are for the number of people you cook for. The system works out per-person needs and learns your real usage.'))}`;
    } else {
      const d = ui.flt.messd2 || addDays(today(), 1);
      const sk = skipsOnDate(d), tf = tiffinsOnDate(d), lv = Store.all('leave').filter(l => l.from <= d && l.to >= d);
      body = `<div class="tool"><input type="date" value="${d}" data-flt="messd2" style="max-width:200px"><span class="sp"></span><div class="tool-actions">${btn('Add leave', 'messleave', '', '', 'plus')}</div></div>
        <div class="grid g3">${group(t('Skipped meals'), sk.map(s => li({ lead: avatar((resById(s.resId) || {}).name || '?'), t: (resById(s.resId) || {}).name || '—', d: `${mealName(s.meal)} · ${roomName((resById(s.resId) || {}).roomId)}` })).join(''))}${group(t('Tiffin requests'), tf.map(s => li({ icon: 'pack', ic: 'warn', t: (resById(s.resId) || {}).name || '—', d: `${mealName(s.meal)} · ${roomName(s.roomId)}${s.note ? ' · ' + s.note : ''}` })).join(''))}${group(t('On leave'), lv.map(l => li({ icon: 'cal', ic: 'info', t: (resById(l.resId) || {}).name || '—', d: `${fmtShort(l.from)} – ${fmtShort(l.to)}`, end: isAdmin() ? btn('', 'leavedel', `data-id="${l.id}"`, 'sm', 'trash') : '' })).join(''))}</div>`;
    }
    const tabs = [
      ['today', 'Cooking plan'],
      ['menu', 'Weekly menu'],
      ...(showDishes ? [['dishes', 'Dishes & recipes']] : []),
      ['requests', 'Skips & tiffins']
    ];
    return `${head('Mess & Menu', t('Headcount updates live from leaves, skips and tiffins.'), isAdmin() ? btn('Meal timings', 'go', 'data-to="settings/meals"', '', 'clock') : '')}${seg('mess', tabs, 'today')}${body}`;
  },
};
A.served = el => formModal({ title: `${t('Plates served')} · ${mealName(el.dataset.meal)}`, note: t('Optional. Real counts make the stock learning more accurate.'), fields: [{ name: 'n', label: 'Plates served', type: 'number', min: 0, value: headcount(el.dataset.date, el.dataset.meal).eat, required: true }], onSubmit: v => { Store.put('served', { id: `served-${el.dataset.date}-${el.dataset.meal}`, date: el.dataset.date, meal: el.dataset.meal, count: v.n }); toast('Saved'); } });
A.guests = el => { const id = `guest-${el.dataset.date}-${el.dataset.meal}`, cur = Store.get(id); formModal({ title: 'Guest meals', fields: [{ name: 'n', label: 'Number of guests', type: 'number', min: 0, value: cur ? cur.count : 0 }, { name: 'note', label: 'Note', value: cur ? cur.note : '' }], onSubmit: v => { Store.put('guestmeal', { id, date: el.dataset.date, meal: el.dataset.meal, count: v.n || 0, note: v.note }); toast('Saved'); } }); };
A.tiflist = el => { const hc = headcount(el.dataset.date, el.dataset.meal); sheet(`${t('Tiffin')} · ${mealName(el.dataset.meal)} · ${hc.tiffins.length}`, `<div class="group">${hc.tiffins.map(x => li({ icon: 'pack', ic: 'warn', t: (resById(x.resId) || {}).name || '—', d: `${t('Room')} ${roomName(x.roomId)}${(x.note || tifNoteOf(x.resId)) ? ' · ' + (x.note || tifNoteOf(x.resId)) : ''}`, end: x.status === 'packed' ? badge('Packed', 'ok') : btn('Packed', 'tifpacked', `data-id="${x.id}"`, 'sm ok') })).join('')}</div>`); };
A.tifpacked = el => { const [, resId, date, meal] = /^tif-(.+)-(\d{4}-\d{2}-\d{2})-(.+)$/.exec(el.dataset.id) || []; ensureTifRec(resId, date, meal); Store.patch(el.dataset.id, { status: 'packed' }); const x = Store.get(el.dataset.id); notify({ to: 'res', resId: x.resId, title: t('Your tiffin is packed'), body: mealName(x.meal) }); A.tiflist({ dataset: { date: x.date, meal: x.meal } }); };
/* Choosing the dishes of one meal: selected dishes on top (tap one to remove it), a search box, every dish as a tappable
 * pill, and "apply to" day chips (this day, every day, weekdays, weekend, or any mix) - saved in one go. */
const MD_DAYS = [1, 2, 3, 4, 5, 6, 0];
function mdDishes() {
  const e = ui.menuEd, q = (e.q || '').toLowerCase().trim();
  const seen = new Set();
  return dishes().slice().sort((a, b) => (e.sel.includes(b.id) - e.sel.includes(a.id))).filter(x => {
    if (!((x.meal === 'any' || x.meal === e.meal || e.sel.includes(x.id)) && (!q || x.name.toLowerCase().includes(q)))) return false;
    const k = x.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
}
function mdParts() {
  const e = ui.menuEd;
  const sel = e.sel.map(id => Store.get(id)).filter(Boolean);
  return {
    sel: sel.length ? sel.map(x => `<button type="button" class="md-chip" data-act="mdtoggle" data-id="${x.id}" aria-label="${esc(t('Remove'))} ${esc(x.name)}">${esc(x.name)} <span>×</span></button>`).join('') : `<span class="muted">${esc(t('No dishes chosen yet - tap dishes below'))}</span>`,
    list: mdDishes().map(x => { const on = e.sel.includes(x.id); return `<button type="button" class="md-dish ${on ? 'on' : ''} ${x.unavailable ? 'off' : ''}" data-act="mdtoggle" data-id="${x.id}" ${x.unavailable && !on ? 'disabled' : ''}>${on ? ico('check', 'sm') : ''}<span>${esc(x.name)}</span>${x.unavailable ? `<small>${esc(t('Needs ingredient'))}</small>` : ''}</button>`; }).join('') || `<div class="muted" style="padding:8px 2px">${esc(t('No dish found'))}</div>`,
    days: MD_DAYS.map(d => `<button type="button" class="md-day ${e.days.includes(d) ? 'on' : ''}" data-act="mdday" data-d="${d}">${esc(DAYS()[d].slice(0, 3))}</button>`).join(''),
  };
}
function mdUpdate() {
  const p = mdParts(), set = (id, h) => { const el = document.getElementById(id); if (el) el.innerHTML = h; };
  set('mdSel', p.sel); set('mdList', p.list); set('mdDays', p.days);
  const n = document.getElementById('mdCount'); if (n) n.textContent = ui.menuEd.sel.length;
}
A.menucell = el => {
  const d = +el.dataset.day, m = el.dataset.meal, cur = ((menuDoc().week[d] || {})[m]) || [];
  ui.menuEd = { day: d, meal: m, sel: [...cur], days: [d], q: '' };
  const p = mdParts();
  openModal({
    title: `${DAYS()[d]} · ${mealName(m)}`, cls: 'md',
    body: `<div class="md-meal">${esc(mealName(m))} <span>${fmtTime(mealByKey(m).time)}</span></div>
      <div class="md-h">${esc(t('Chosen'))} · <b id="mdCount">${cur.length}</b></div><div class="md-sel" id="mdSel">${p.sel}</div>
      <div class="md-search">${ico('search', 'sm')}<input id="mdq" type="search" placeholder="${esc(t('Search dishes'))}" autocomplete="off"></div>
      <div class="md-list" id="mdList">${p.list}</div>
      ${can('kitchen') ? `<div class="md-new"><a href="#" data-act="adddish">+ ${esc(t('Add a new dish'))}</a></div>` : ''}
      <div class="md-h">${esc(t('Apply to'))}</div><div class="md-days" id="mdDays">${p.days}</div>
      <div class="md-presets"><button type="button" data-act="mdpreset" data-p="one">${esc(t('Only this day'))}</button><button type="button" data-act="mdpreset" data-p="week">${esc(t('Weekdays'))}</button><button type="button" data-act="mdpreset" data-p="end">${esc(t('Weekend'))}</button><button type="button" data-act="mdpreset" data-p="all">${esc(t('Every day'))}</button></div>`,
    foot: `<button class="btn" data-act="close">${esc(t('Cancel'))}</button><button class="btn primary" style="flex:1" data-act="mdsave">${ico('check', 'sm')} ${esc(t('Save menu'))}</button>`,
  });
};
A.mdtoggle = el => { const e = ui.menuEd; if (!e) return; const id = el.dataset.id, i = e.sel.indexOf(id); if (i >= 0) e.sel.splice(i, 1); else e.sel.push(id); haptic(); mdUpdate(); };
A.mdday = el => { const e = ui.menuEd; if (!e) return; const d = +el.dataset.d, i = e.days.indexOf(d); if (i >= 0) { if (e.days.length > 1) e.days.splice(i, 1); } else e.days.push(d); mdUpdate(); };
A.mdpreset = el => { const e = ui.menuEd; if (!e) return; e.days = { one: [e.day], week: [1, 2, 3, 4, 5], end: [6, 0], all: [...MD_DAYS] }[el.dataset.p] || [e.day]; mdUpdate(); };
A.mdsave = () => {
  const e = ui.menuEd; if (!e) return;
  const doc = menuDoc(), week = clone(doc.week || {});
  for (const d of e.days) { week[d] = week[d] || {}; week[d][e.meal] = [...e.sel]; }
  Store.put('menu', { id: 'menu', week });
  closeModal(); toast(t('Menu saved for {n} day(s)', { n: e.days.length })); render();
};
document.addEventListener('input', ev => { if (ev.target && ev.target.id === 'mdq' && ui.menuEd) { ui.menuEd.q = ev.target.value; mdUpdate(); } });
const UNIT_CONV = { 'g>kg': 0.001, 'kg>g': 1000, 'ml>L': 0.001, 'L>ml': 1000 };
// A brand-new ingredient has no price yet; borrow the last price this name was bought at (any past purchase line).
function lastKnownRate(name) {
  const n = String(name || '').toLowerCase();
  const old = items().find(i => i.name.toLowerCase() === n && +i.rate > 0);
  if (old) return +old.rate;
  for (const pr of Store.all('pr').slice().sort(by('ts', -1))) for (const x of pr.items || []) { const it = itemById(x.itemId); if (it && it.name.toLowerCase() === n && +x.rate > 0) return +x.rate; }
  return 0;
}
// Dish with its recipe. Ingredients come from stock items; a new ingredient name creates the item.
function dishForm(x) {
  const d = x || { ings: [], serves: 10, meal: 'any' };
  const rows = d.ings.length ? d.ings : [{}, {}, {}];
  Suggest.sources.stock = () => items().filter(i => i.active !== false && i.status !== 'inactive').map(i => ({ v: i.name, sub: i.unit || '' })).sort((a, b) => a.v.localeCompare(b.v));
  const rowHtml = (g, i) => `<div class="ingrow"><span class="sg"><input data-suggest="stock" name="ing_${i}" class="ing-n" aria-label="${esc(t('Ingredient'))} ${i + 1}" placeholder="${esc(t('Ingredient name, e.g. Paneer'))}" value="${esc(g.itemId ? (itemById(g.itemId) || {}).name || '' : '')}" autocomplete="off" autocorrect="off" spellcheck="false" aria-autocomplete="list"><button type="button" class="sg-btn" tabindex="-1" aria-label="${esc(t('Show list'))}">${ico('chev2', 'sm')}</button></span>
    <div class="ing-q"><input name="qty_${i}" aria-label="${esc(t('Qty'))} ${i + 1}" type="number" step="0.01" min="0" inputmode="decimal" placeholder="${esc(t('Qty'))}" value="${g.qty ?? ''}"><select name="unit_${i}" aria-label="${esc(t('Unit'))} ${i + 1}">${S().units.map(u => `<option ${((itemById(g.itemId) || {}).unit || 'kg') === u ? 'selected' : ''}>${u}</option>`).join('')}</select><button type="button" class="ing-x" data-act="ingdel" aria-label="${esc(t('Remove this ingredient'))}" title="${esc(t('Remove'))}">${ico('x', 'sm')}</button></div></div>`;
  formModal({
    title: x ? 'Edit dish' : 'Add dish', wide: true,
    fields: [
      { name: 'name', label: 'Dish name', value: d.name, required: true, maxlength: 60 }, { name: 'meal', label: 'Served at', type: 'select', options: [{ v: 'any', l: t('Any meal') }, ...meals().map(m => ({ v: m.k, l: mealName(m.k) }))], value: d.meal },
      { name: 'serves', label: 'Quantities below are for how many people?', type: 'number', min: 1, value: d.serves, required: true, full: true, hint: t('Example: for 40 people we use 6 kg rice → enter 40 here and 6 kg below.') },
      { type: 'html', html: `<div class="row sb" style="align-items:center;margin-bottom:6px"><label class="f" style="margin:0">${esc(t('Ingredients'))}</label>${tip(esc(t('Type a name. If it is already in stock the unit is picked for you; a new name creates a new stock item. Quantities are for the number of people above.')))}</div><div id="ings">${rows.map(rowHtml).join('')}</div><button type="button" class="btn sm block" id="addIng">+ ${esc(t('Add another ingredient'))}</button>` },
    ],
    danger: x ? { label: 'Delete', run: () => confirmBox(t('Delete dish {n}?', { n: d.name }), () => { Store.remove(d.id); toast('Deleted'); }, 'Delete', 'bad') } : null,
    onSubmit: (v, form) => {
      const ings = [];
      for (const row of $$('.ingrow', form)) {
        const i = row.querySelector('input[name^="ing_"]').name.replace('ing_', '');
        const name = (form.elements['ing_' + i] || {}).value?.trim(), qty = parseFloat((form.elements['qty_' + i] || {}).value), unit = (form.elements['unit_' + i] || {}).value;
        if (!name || !(qty > 0)) continue;
        let it = items().find(z => z.name.toLowerCase() === name.toLowerCase());
        if (it && (it.active === false || it.status === 'inactive')) {
          return t('Ingredient "{n}" is currently deactivated. Reactivate it or use another ingredient.', { n: it.name });
        }
        let q = qty;
        if (!it) it = Store.put('item', { id: `item-${slug(name)}-${uid()}`, name, unit, stock: 0, min: 0, rate: lastKnownRate(name), cat: 'Grocery', active: true, status: 'active' });
        else if (unit && it.unit && unit !== it.unit) {
          // the recipe is read in the item's own unit - convert so 500 g of kg-stocked rice is 0.5, not 500
          const f = UNIT_CONV[unit + '>' + it.unit];
          if (f == null) return t('"{n}" is stocked in {u}. Choose {u} (or g/kg, ml/L) for this ingredient.', { n: it.name, u: it.unit });
          q = Math.round(qty * f * 10000) / 10000;
        }
        ings.push({ itemId: it.id, qty: q });
      }
      const nm = String(v.name || '').replace(/\s+/g, ' ').trim();
      if (dishes().some(z => z.id !== d.id && String(z.name).replace(/\s+/g, ' ').trim().toLowerCase() === nm.toLowerCase())) return t('A dish called "{n}" already exists. Edit that one instead.', { n: nm });
      if (!ings.length) return 'Add at least one ingredient with a name and a quantity';
      Store.put('dish', { ...d, id: d.id || `dish-${slug(v.name)}-${uid()}`, name: String(v.name || '').replace(/\s+/g, ' ').trim(), meal: v.meal, serves: v.serves, ings });
      toast('Dish saved');
    },
  });
  $('#addIng').onclick = () => {
    const box = $('#ings'), i = Math.max(-1, ...$$('.ingrow input[name^="ing_"]', box).map(x => +x.name.replace('ing_', ''))) + 1;
    box.insertAdjacentHTML('beforeend', rowHtml({}, i));
    const last = box.lastElementChild.querySelector('.ing-n'); if (last) last.focus();
  };
  // picking an existing ingredient locks the unit to that item's own measurement scale
  const ingBox = $('#ings');
  if (ingBox) ingBox.addEventListener('click', e => {
    const x = e.target.closest('.ing-x'); if (!x) return;
    const row = x.closest('.ingrow');
    if ($$('.ingrow', ingBox).length > 1) row.remove(); else row.querySelectorAll('input').forEach(i => { i.value = ''; });
  });
  if (ingBox) ingBox.addEventListener('input', e => {
    const inp = e.target; if (!inp.name || !inp.name.startsWith('ing_')) return;
    const it = items().find(z => z.name.toLowerCase() === inp.value.trim().toLowerCase());
    const row = inp.closest('.ingrow'), sel = row.querySelector('select');
    if (sel) { sel.disabled = !!(it && it.unit); if (it && it.unit) { sel.value = it.unit; sel.dispatchEvent(new Event('change', { bubbles: true })); } sel.title = it && it.unit ? t('Already in stock in {u} - change it under Stock & Purchase', { u: it.unit }) : ''; }
    let h = row.querySelector('.ing-hint'); if (!h) { h = document.createElement('div'); h.className = 'ing-hint'; row.appendChild(h); }
    h.textContent = it && it.unit ? t('In stock as {u}', { u: it.unit }) : (inp.value.trim() ? t('New item - it will be added to stock') : '');
  });
}
A.adddish = () => {
  if (!can('kitchen')) return toast(t('Stock & purchase module is disabled'), 'warn');
  dishForm();
};
A.replaceing = el => {
  if (!can('kitchen')) return toast(t('Stock & purchase module is disabled'), 'warn');
  const itemId = el && el.dataset && el.dataset.id;
  const activeItems = items().filter(i => i.id !== itemId && i.active !== false && i.status !== 'inactive');
  if (!activeItems.length) return toast(t('No other active items available to substitute with'), 'bad');

  formModal({
    title: t('Replace Ingredient in Dishes'),
    submit: t('Replace in All Recipes'),
    note: t('Substitute an ingredient across all recipes that currently use it, keeping meal plans valid.'),
    fields: [
      { name: 'old', label: t('Ingredient to replace'), type: 'select', options: items().map(i => ({ v: i.id, l: i.name + (i.active === false ? ' (Inactive)' : '') })), value: itemId || (items()[0] || {}).id, required: true },
      { name: 'new', label: t('Substitute with active item'), type: 'select', options: activeItems.map(i => ({ v: i.id, l: i.name })), required: true }
    ],
    onSubmit: v => {
      if (v.old === v.new) return t('Choose a different replacement ingredient');
      try {
        const res = replaceIngredientInDishes(v.old, v.new);
        toast(t('Updated {n} dishes successfully ✓', { n: res.updatedCount }), 'ok');
        closeModal();
        render();
      } catch (err) {
        return err.message;
      }
    }
  });
};
A.editdish = el => {
  if (!can('kitchen')) return toast(t('Stock & purchase module is disabled'), 'warn');
  dishForm(Store.get(el.dataset.id));
};
A.messleave = () => formModal({ title: 'Add leave', fields: [{ name: 'res', label: 'Resident', type: 'select', options: resOpts(), required: true, placeholder: 'Choose resident…' }, { name: 'from', label: 'From', type: 'date', value: addDays(today(), 1), required: true }, { name: 'to', label: 'To (including)', type: 'date', value: addDays(today(), 2), required: true }], onSubmit: v => { const lp = leaveProblem(v.res, v.from, v.to); if (lp) return lp; if (v.from > addDays(today(), 180)) return t('Leave can be added at most 6 months ahead'); Store.put('leave', { resId: v.res, roomId: resById(v.res).roomId, from: v.from, to: v.to, date: v.from }); toast('Leave saved'); } });
A.leavedel = el => { Store.remove(el.dataset.id); render(); };

/* ===================================================================== stock & purchase */
/* Stock & Purchase: cards instead of wide tables, so it reads well on a phone. Stock = one card per item with a level bar;
 * requests and history = one compact card per purchase request with the item list folded away. */
const PR_BADGE = p => badge(p.status === 'requested' ? 'Waiting approval' : p.status === 'approved' ? 'Approved — to buy' : p.status === 'received' ? 'Received' : 'Rejected', p.status === 'received' ? 'ok' : p.status === 'rejected' ? 'bad' : p.status === 'approved' ? 'info' : 'warn');
function prCard(p) {
  const total = p.total ? ` · ${inr(p.total)} · ${t(p.mode === 'credit' ? 'Credit' : 'Cash')}` : '';
  const rows = p.items.map(x => `<dt>${esc(x.name)}${x.leftQty != null ? ` <span class="hint">(${esc(t('left'))} ${num(x.leftQty)})</span>` : ''}</dt><dd>${p.status === 'received' ? `${num(x.recvQty)} ${esc(x.unit)}${x.rate ? ' · ₹' + x.rate : ''}` : `${num(x.qty)} ${esc(x.unit)}${x.qty !== x.reqQty ? ` <span class="hint">(${esc(t('asked'))} ${num(x.reqQty)})</span>` : ''}`}</dd>`).join('');
  const acts = `${p.status === 'requested' && isAdmin() ? btn('Review & approve', 'prview', `data-id="${p.id}"`, 'sm primary') : ''}${p.status === 'approved' && canReceive() ? btn('Receive goods', 'prrecv', `data-id="${p.id}"`, 'sm ok', 'check') : ''}${p.status === 'requested' && !isAdmin() ? `<span class="hint">${esc(t('Waiting for owner'))}</span>` : ''}`;
  return `<div class="prc"><div class="prc-h"><b>${esc(p.no)}</b><span class="muted xs">${fmtShort(p.date)}</span><span class="sp"></span>${PR_BADGE(p)}</div>
    <div class="prc-s">${t('{n} items', { n: p.items.length })}${p.by ? ' · ' + esc(p.by) : ''}${p.vendor ? ' · ' + esc(p.vendor) : ''}${total}${p.note ? ' · ' + esc(p.note) : ''}</div>
    <details class="prc-d"><summary>${esc(t('View items'))}</summary><dl class="kv">${rows}</dl></details>
    ${acts ? `<div class="prc-a">${acts}</div>` : ''}</div>`;
}
function stockCard(i) {
  const s = stockInfo(i), st = stockOf(i), l = learnFactor(i.id);
  const cap = Math.max((+i.min || 0) * 3, (s.need || 0) * 7, st, 1), pct = Math.max(0, Math.min(100, Math.round(100 * st / cap)));
  const tone = s.low ? 'bad' : (s.days != null && s.days < 5 ? 'warn' : 'ok');
  return `<div class="stk ${tone}"><div class="stk-top"><b class="stk-n">${esc(i.name)}</b>${s.low ? badge('Low', 'bad') : s.days != null ? `<span class="stk-d">${esc(t('{n} days', { n: s.days }))}</span>` : ''}</div>
    <div class="stk-q"><b>${num(st)}</b> <span>${esc(i.unit)}</span></div><div class="stk-bar"><i style="width:${pct}%"></i></div>
    <div class="stk-m">${s.need ? `${esc(t('Uses'))} ${num(s.need)} ${esc(i.unit)}/${esc(t('day'))}` : esc(t('No daily use yet'))}${l.cycles ? ` · ×${l.factor}` : ''}</div>
    <div class="stk-a">${btn('Count', 'countitem', `data-id="${i.id}"`, 'sm')}${isAdmin() ? btn('', 'edititem', `data-id="${i.id}" aria-label="${esc(t('Edit'))}"`, 'sm ghost', 'edit') : ''}</div></div>`;
}
PAGES.kitchen = {
  title: 'Stock & Purchase', mod: 'kitchen',
  render() {
    const tab = curTab('kit', 'stock'), prs = Store.all('pr').slice().sort(by('ts', -1));
    const openPr = prs.filter(p => p.status === 'requested' || p.status === 'approved');
    let body = '';
    if (tab === 'stock') {
      const all = items(), lowN = all.filter(i => stockInfo(i).low).length, fl = curFlt('stk', 'all');
      const list = all.filter(i => needle('item', i.name)).filter(i => fl === 'all' || (fl === 'low' && stockInfo(i).low));
      body = `<div class="mini-kpis"><div><b>${all.length}</b><span>${esc(t('Items'))}</span></div><div class="${lowN ? 'bad' : ''}"><b>${lowN}</b><span>${esc(t('Running low'))}</span></div><div><b>${openPr.length}</b><span>${esc(t('Open requests'))}</span></div></div>
        <div class="tool">${searchBox('item', 'Search item')}${chips('stk', [['all', 'All'], ['low', 'Low']], 'all')}<span class="sp"></span><div class="tool-actions">${isAdmin() ? btn('Add item', 'additem', '', '', 'plus') : ''}</div></div>
        ${list.length ? `<div class="stk-grid fold-list">${list.map(stockCard).join('')}</div>` : `<div class="card">${empty('No items yet', 'Items are created automatically when you add dish ingredients.')}</div>`}
        ${about('Stock goes down automatically each day by menu × real headcount × learned buffer. When the cook raises a purchase request and enters what is left, the system learns the real usage.')}`;
    } else {
      const list = prs.filter(p => tab === 'open' ? openPr.includes(p) : !openPr.includes(p));
      if (!list.length) body = `<div class="card">${empty(tab === 'open' ? 'No open requests' : 'No history yet', tab === 'open' ? 'Raise a purchase request when something runs low.' : 'Received and rejected requests appear here.', btn('Purchase request', 'newpr', '', 'primary', 'cart'))}</div>`;
      else if (tab === 'open') body = `<div class="prc-list fold-list">${list.map(prCard).join('')}</div>`;
      else {
        const by_ = groupBy(list, p => ymOf(p.date || today()));
        body = Object.keys(by_).sort().reverse().map(ym => `<div class="group-t">${esc(fmtYM(ym))} · ${by_[ym].length}${sum(by_[ym], p => p.total || 0) ? ' · ' + inr(sum(by_[ym], p => p.total || 0)) : ''}</div><div class="prc-list fold-list">${by_[ym].map(prCard).join('')}</div>`).join('');
      }
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
    extra: `<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>${esc(t('Item'))}</th><th>${esc(t('Left now'))}</th><th>${esc(t('Buy'))}</th></tr></thead><tbody>${sorted.map(i => { const s = stockInfo(i); const sug = s.need ? Math.max(0, Math.ceil(s.need * 7 - (i.stock || 0))) : ''; return `<tr><td><b>${esc(i.name)}</b><div class="hint">${s.low ? `<span class="bad-t">${esc(t('Low'))}</span> · ` : ''}${esc(t('est.'))} ${num(i.stock)} ${esc(i.unit)}${sug ? ` · ${esc(t('suggest'))} ${sug}` : ''}</div></td><td><input name="left_${i.id}" aria-label="${esc(i.name)} - ${esc(t('Left now'))}" type="number" step="0.1" min="0" inputmode="decimal" placeholder="${num(i.stock)}" style="min-width:80px"></td><td><input name="buy_${i.id}" aria-label="${esc(i.name)} - ${esc(t('Buy'))}" type="number" step="0.1" min="0" inputmode="decimal" placeholder="${sug || '0'}" style="min-width:80px"></td></tr>`; }).join('')}</tbody></table></div>`,
    fields: [{ name: 'note', label: 'Note for owner', full: true }],
    onSubmit: (v, form) => {
      const rows = [];
      for (const i of sorted) { const b = parseFloat(form.elements['buy_' + i.id].value), l = parseFloat(form.elements['left_' + i.id].value); if (b > 0) rows.push({ itemId: i.id, qty: b, leftQty: isNaN(l) ? null : l }); else if (!isNaN(l)) moveStock(i.id, l - (i.stock || 0), 'count', today(), '', t('Stock count')); }
      if (!rows.length) return 'Enter quantity to buy for at least one item';
      if (rows.some(x => x.qty > 100000 || (x.leftQty != null && (x.leftQty < 0 || x.leftQty > 100000)))) return t('A quantity looks too large or negative. Please check the numbers.');
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
  const isInactive = i.status === 'inactive';
  formModal({
    title: x ? `${t('Edit item')} · ${i.name}${isInactive ? ' (' + t('Inactive') + ')' : ''}` : 'Add item',
    fields: [
      { name: 'name', label: 'Item name', value: i.name, required: true, maxlength: 60 },
      { name: 'unit', label: 'Unit', type: 'select', options: S().units, value: i.unit || 'kg' },
      { name: 'stock', label: 'Current stock', type: 'number', step: 0.1, min: 0, value: x ? stockOf(i) : (i.stock ?? 0) },
      { name: 'min', label: 'Alert below', type: 'number', step: 0.1, min: 0, value: i.min ?? 0 },
      { name: 'rate', label: 'Last price ₹ / unit', type: 'number', step: 0.01, min: 0, value: i.rate ?? '' }
    ],
    danger: x ? (isInactive ? {
      label: 'Reactivate item',
      run: () => {
        reactivateItem(i.id);
        toast(t('{n} reactivated ✓', { n: i.name }), 'ok');
        closeModal();
        render();
      }
    } : {
      label: 'Deactivate item',
      run: () => {
        const deps = getItemDependencies(i.id);
        const warnMsg = deps.inUseCount > 0
          ? t('{n} is currently used by {d} dish(es) and {m} menu schedule(s). Deactivating it will mark those dishes unavailable for future meal planning.', { n: i.name, d: deps.dishes.length, m: deps.menus.length })
          : t('Deactivate {n}?', { n: i.name });
        confirmBox(warnMsg, () => {
          deactivateItem(i.id);
          toast(t('{n} deactivated', { n: i.name }), 'info');
        }, 'Deactivate', 'bad');
      }
    }) : null,
    onSubmit: v => {
      if (items().some(z => z.name.toLowerCase() === v.name.toLowerCase() && z.id !== i.id)) return 'An item with this name exists';
      const { stock, ...rest } = v;
      Store.put('item', { ...i, id: i.id || `item-${slug(v.name)}-${uid()}`, ...(x ? rest : v), rate: isNaN(v.rate) ? 0 : v.rate, status: i.status || 'active' });
      if (x) countTo(i.id, +stock || 0, 'adjust', t('Edited in the item form'));
      toast('Saved');
    }
  });
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
      <div class="hkhero"><div class="hkh-n"><b>${st('done')}</b><span>/ ${all.length}</span></div><div class="hkh-l">${esc(t('rooms cleaned'))} · ${pct(st('done'), all.length)}%</div><div class="hkh-bar"><i class="pgi" style="width:${pct(st('done'), all.length)}%;--p:${pct(st('done'), all.length)}"></i></div>
        <div class="hkh-c"><span><i class="d1"></i>${st('pending')} ${esc(t('Pending'))}</span><span><i class="d2"></i>${st('missed') + st('not_cleaned')} ${esc(t('Missed / not cleaned'))}</span></div></div>
      ${list.length ? `<div class="about">${tip(esc(t('Tap the circle when a room is cleaned. Tap it again to undo. Use the arrows to give the room to someone else.')))}</div>` : ''}${list.length ? Object.entries(groupBy(list, x => x.floor || '')).map(([fl, xs]) => `${fl ? `<div class="pgh"><b>${esc(fl)}</b><span>${t('{a} of {b} done', { a: xs.filter(x => x.status === 'done').length, b: xs.length })}</span></div>` : ''}<div class="group">${xs.map(x => { const fb = hkFeedbackFor(x.id), mk = canMarkHk(x), done = x.status === 'done', bad = x.status === 'missed' || x.status === 'not_cleaned';
        const ck = mk ? `<button type="button" class="hkck ${done ? 'on' : bad ? 'bad' : ''}" data-act="${done ? 'hkundo' : 'hkdone'}" data-id="${x.id}" aria-label="${esc(done ? t('Undo') : t('Done'))}">${ico(bad ? 'alert' : 'check', 'sm')}</button>` : `<span class="hkck ${done ? 'on' : bad ? 'bad' : ''}">${ico(bad ? 'alert' : 'check', 'sm')}</span>`;
        return prow({
          lead: ck, t: `${esc(t('Room'))} ${esc(x.roomNo)}`,
          s: esc([x.staffName || t('Unassigned'), x.time ? fmtTime(x.time) : ''].filter(Boolean).join(' · ')) + (x.reason ? `<br>${esc(x.reason)}` : ''),
          tags: `${done ? badge('Cleaned', 'ok') : bad ? badge(HK_STAT[x.status][0], 'bad') : ''}${fb.map(f => badge(f.ok ? 'Satisfied' : 'Issue', f.ok ? 'ok' : 'bad')).join('')}`,
          amt: !done && (x.status === 'pending' || x.status === 'missed') ? `<button type="button" class="hkmv" data-act="hkreassign" data-id="${x.id}" aria-label="${esc(t('Reassign'))}">${ico('repeat', 'sm')}</button>` : ''
        }); }).join('')}</div>`).join('') : `<div class="card">${empty('No cleaning tasks for this day', 'Create a schedule to generate tasks automatically.')}</div>`}`;
  } else if (tab === 'sched') {
    const list = Store.all('hks');
    const dayOrder = [1, 2, 3, 4, 5, 6, 0];
    body = list.length ? `<div class="stack">${list.map(s => { const on = s.freq === 'daily' ? dayOrder : s.freq === 'once' ? [] : (s.days || []); const groups = Object.entries(groupBy(s.rooms || [], rid => (s.assign || {})[rid] || '')); return `<div class="card sch ${s.active === false ? 'off' : ''}">
        <div class="sch-h"><span class="prow-ic ${tone(s.name)}">${ico('broom', 'sm')}</span><div><b>${esc(s.name)}</b><span>${s.freq === 'once' ? esc(fmtDate(s.date)) : esc(s.freq === 'daily' ? t('Every day') : t('Weekly'))}${s.time ? ' · ' + fmtTime(s.time) : ''} · ${esc(t('{n} rooms', { n: (s.rooms || []).length }))}</span></div>${badge(s.active === false ? 'Paused' : 'Active', s.active === false ? 'mute' : 'ok')}</div>
        ${s.freq === 'once' ? '' : `<div class="sch-d">${dayOrder.map(d => `<i class="${on.includes(d) ? 'on' : ''}" title="${esc(DAYS()[d])}">${esc(DAYS()[d].slice(0, 1))}</i>`).join('')}</div>`}
        <div class="sch-t">${groups.map(([sid, rs]) => { const nm = (staffById(sid) || {}).name || t('Unassigned'); return `<div class="sch-r">${avatar(nm)}<div><b>${esc(nm)}</b><span>${esc(rs.map(roomName).join(', '))}</span></div></div>`; }).join('')}</div>
        <div class="sch-a">${pillb('Edit', 'hksched', `data-id="${s.id}"`)}${pillb(s.active === false ? 'Resume' : 'Pause', 'hkpause', `data-id="${s.id}"`)}</div></div>`; }).join('')}</div>` : `<div class="card">${empty('No schedules yet', 'Create one: pick days, floors and who cleans which room. Tasks appear automatically.', btn('New schedule', 'hksched', '', 'primary', 'plus'))}</div>`;
  } else if (tab === 'staff') {
    const list = hkStaff();
    body = `<div class="tool"><span class="muted sm">${esc(t('{n} active', { n: list.filter(x => x.status === 'active').length }))}</span><span class="sp"></span>${btn('Add', 'addhk', '', 'primary', 'plus')}</div>
      ${list.length ? `<div class="group">${list.map(s => { const mine = hkTasks().filter(x => x.date === today() && x.staffId === s.id), dn = mine.filter(x => x.status === 'done').length; return prow({
        act: 'staffedit', attrs: `data-id="${s.id}"`, lead: avatar(s.name), t: esc(s.name), s: esc([s.phone, `${t('Today')} ${dn}/${mine.length}`].filter(Boolean).join(' · ')),
        tags: s.status === 'active' ? '' : badge('Inactive', 'mute'), amt: staffSw(s)
      }); }).join('')}</div>` : `<div class="card">${empty('No housekeeping staff yet', 'Add the people who clean the rooms.', btn('Add', 'addhk', '', 'primary', 'plus'))}</div>`}`;
  } else {
    const all = Store.all('hkf').slice().sort(by('ts', -1)), ff = curFlt('hkfc', 'all');
    const nOk = all.filter(f => f.ok).length, nBad = all.length - nOk, score = pct(nOk, all.length);
    const list = all.filter(f => ff === 'all' || (ff === 'ok' ? f.ok : !f.ok)).slice(0, 80);
    const worst = Object.entries(groupBy(all.filter(f => !f.ok), f => f.roomId)).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
    body = all.length ? `<div class="fbhero"><div class="fbring" style="--p:${score}"><b>${score}<small>%</small></b></div><div class="fbh-t"><b>${esc(t('Residents are happy with'))} ${score}% ${esc(t('of cleanings'))}</b><span>${esc(t('{n} responses', { n: all.length }))} · ${nOk} ${esc(t('Satisfied'))} · ${nBad} ${esc(t('Issues'))}</span>
        ${worst.length ? `<div class="fbh-w">${worst.map(([rid, xs]) => `<i>${esc(t('Room'))} ${esc(roomName(rid))} · ${xs.length}</i>`).join('')}</div>` : ''}</div></div>
      <div class="tool">${chips('hkfc', [['all', 'All'], ['bad', 'Issues'], ['ok', 'Satisfied']], 'all')}</div>
      ${list.length ? `<div class="stack">${list.map(f => { const r = resById(f.resId), tk = Store.get(f.taskId) || {}; return `<div class="fbc ${f.ok ? 'ok' : 'bad'}"><div class="fbc-h">${avatar((r || {}).name || '?')}<div><b>${esc((r || {}).name || '—')}</b><span>${esc(t('Room'))} ${esc(roomName(f.roomId))} · ${esc(fmtShort(f.date))}</span></div><span class="fbc-i">${ico(f.ok ? 'check' : 'alert', 'sm')}</span></div>
        ${f.note ? `<p class="fbc-q">“${esc(f.note)}”</p>` : ''}
        <div class="fbc-f"><span>${ico('broom', 'xs')} ${esc(tk.staffName || t('Unassigned'))}${tk.time ? ' · ' + esc(fmtTime(tk.time)) : ''}</span>${badge(f.ok ? 'Satisfied' : 'Not satisfied', f.ok ? 'ok' : 'bad')}</div></div>`; }).join('')}</div>` : `<div class="card">${empty('Nothing here', 'No feedback matches this filter.')}</div>`}`
      : `<div class="card">${empty('No feedback yet', 'Residents confirm each cleaning from their app. Their answers show up here.')}</div>`;
  }
  return `${head('Housekeeping', t('You assign rooms, staff clean them, residents confirm.'), tab === 'sched' ? btn('New schedule', 'hksched', '', 'primary', 'plus') : '')}${seg('hk', [['today', 'Tasks'], ['sched', 'Schedules'], ['staff', 'Staff'], ['fb', 'Resident feedback']], 'today')}${body}`;
}
// Housekeeping staff panel: only my rooms, big buttons.
function hkStaffView() {
  const me = ctx().refId, date = ui.flt.hkd || today();
  const mine = hkTasks().filter(x => x.date === date && x.staffId === me).sort((a, b) => String(a.roomNo).localeCompare(String(b.roomNo), undefined, { numeric: true }));
  const byFloor = groupBy(mine, x => x.floor || '');
  const done = mine.filter(x => x.status === 'done').length;
  return `${head('My rooms', `${fmtDate(date)} · ${t('{a} of {b} done', { a: done, b: mine.length })}`)}
    <div class="days7" style="margin-bottom:14px">${[-1, 0, 1, 2, 3, 4, 5].map(i => addDays(today(), i)).map(d => `<button class="${d === date ? 'on' : ''}" data-act="setflt" data-k="hkd" data-v="${d}"><span>${DAYS()[parse(d).getDay()]}</span><b>${parse(d).getDate()}</b></button>`).join('')}</div>
    <div class="bar ok" style="margin-bottom:14px"><i class="pgi" style="width:${pct(done, mine.length)}%;--p:${pct(done, mine.length)}"></i></div>
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
  const roomsHtml = Object.entries(byFloor).map(([fl, list]) => `<div class="hkf"><div class="hkf-h"><label class="hkf-all"><input type="checkbox" data-floor="${esc(fl)}"><b>${esc(fl)}</b><small>${esc(t('{n} rooms', { n: list.length }))}</small></label><select data-floorstaff="${esc(fl)}" aria-label="${esc(t('Assign whole floor…'))}"><option value="">${esc(t('Assign whole floor…'))}</option>${team.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
    ${list.map(r => `<div class="hkr"><label><input type="checkbox" name="room" value="${r.id}" data-fl="${esc(fl)}" ${s.rooms.includes(r.id) ? 'checked' : ''}><span>${esc(t('Room'))} ${esc(r.no)}</span></label><select name="as_${r.id}" aria-label="${esc(t('Staff'))}">${staffOpts.replace(`value="${(s.assign || {})[r.id] || '__'}"`, `value="${(s.assign || {})[r.id]}" selected`)}</select></div>`).join('')}</div>`).join('');
  const form = formModal({
    title: s.id ? 'Edit schedule' : 'New cleaning schedule', wide: true, submit: 'Save schedule',
    fields: [
      { name: 'name', label: 'Name', value: s.name || t('Daily room cleaning'), required: true }, { name: 'time', label: 'Time', type: 'time', value: s.time },
      { name: 'freq', label: 'Repeats', type: 'select', options: [{ v: 'weekly', l: t('On selected days') }, { v: 'daily', l: t('Every day') }, { v: 'once', l: t('One date only') }], value: s.freq },
      { name: 'date', label: 'Date', type: 'date', value: s.date || today(), hidden: s.freq !== 'once' },
      { name: 'days', label: 'Days', type: 'multi', options: [1, 2, 3, 4, 5, 6, 0].map(d => ({ v: d, l: DAYS()[d] })), value: s.days, full: true },
      { type: 'html', html: `<div class="group-t" style="padding-left:2px">${esc(t('Floors, rooms & who cleans them'))}</div>${roomsHtml}` },
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
      body = open.length ? `<div class="group">${open.map(l => { const r = resById(l.resId); return `<div class="li ldrow">${avatar(r ? r.name : '?')}<span class="body"><span class="t">${esc(r ? r.name : '—')} · ${t('Room')} ${esc(roomName(l.roomId))}</span><span class="d">${l.pcs} ${esc(t('clothes'))} · ${esc(t('received'))} ${fmtShort(l.date)}${l.note ? ' · ' + esc(l.note) : ''}</span></span><span class="end">${btn('Complete', 'lddone', `data-id="${l.id}"`, 'sm ld', 'check')}</span></div>`; }).join('')}</div>` : `<div class="card">${empty('Nothing pending', 'All laundry is completed.')}</div>`;
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
// The button is grey until you tap it, then it turns green ("done") and the row leaves the list a moment later.
A.lddone = el => {
  const l = Store.get(el.dataset.id); if (!l || l.status === 'completed' || el.dataset.busy) return;
  el.dataset.busy = '1'; el.classList.add('done'); el.disabled = true; el.innerHTML = `${ico('check', 'sm')}<span>${esc(t('Completed'))}</span>`;
  haptic();
  setTimeout(() => {
    Store.patch(l.id, { status: 'completed', completedAt: nowIso(), doneBy: Store.me.full_name });
    notify({ to: 'res', resId: l.resId, title: t('Laundry ready'), body: `${l.pcs} ${t('clothes')}` });
    render(); toast('Completed');
    if (S().wa.auto) waOpen(resById(l.resId).phone, laundryMessage(l, 'laundryDone'), 'Tell resident');
  }, 850);
};

/* ===================================================================== gate */
PAGES.gate = {
  title: 'Gate & Visitors', mod: 'gate',
  render() {
    importDemoVisits();
    const list = Store.all('gate').filter(g => g.type === 'visitor' && g.date >= addDays(today(), -30)).sort((a, b) => ((b.inAt || '') > (a.inAt || '') ? 1 : -1));
    const wk = addDays(today(), -6), todayN = list.filter(g => g.date === today()).length, weekN = list.filter(g => g.date >= wk).length, selfN = list.filter(g => g.date >= wk && g.self).length;
    const shown = list.filter(g => needle('gate', g.name, g.phone, g.purpose, g.place, g.meet));
    const days = {}; shown.forEach(g => (days[g.date] = days[g.date] || []).push(g));
    const meetOf = g => g.resId && resById(g.resId) ? resById(g.resId).name : g.meet ? g.meet + (g.roomNo ? ' (' + g.roomNo + ')' : '') : '';
    return `${head('Gate & Visitors', '', `${isAdmin() ? btn('', 'gateqr', `aria-label="${esc(t('Visitor QR'))}"`, '', 'qr') : ''}${btn('New visitor', 'gatevis', '', 'primary', 'plus')}`)}
      <div class="pstats">${kpi('Visitors today', todayN, '', todayN ? 'ok' : '')}${kpi('Last 7 days', weekN, '')}${kpi('Self entry', selfN, t('last 7 days'))}</div>
      <div class="tool">${searchBox('gate', 'Search name, phone, purpose')}</div>
      ${shown.length ? Object.keys(days).sort().reverse().map(d => `<div class="pgh"><b>${esc(d === today() ? t('Today') : fmtDate(d))}</b><span>${t('{n} entries', { n: days[d].length })}</span></div><div class="group">${days[d].map(g => prow({
        lead: avatar(g.name), t: esc(g.name), s: esc([g.purpose, meetOf(g) ? t('meeting') + ' ' + meetOf(g) : '', g.place ? t('from') + ' ' + g.place : ''].filter(Boolean).join(' · ')),
        tags: g.self ? badge('Self entry', 'warn') : '', amt: fmtTime(new Date(g.inAt).toTimeString().slice(0, 5)), ms: g.phone || ''
      })).join('')}</div>`).join('') : `<div class="card">${empty('No visitors yet', 'Visitors who come to the gate are listed here, newest first.')}</div>`}`;
  },
};
// A gate register is a legal record, so where the visitor came from is part of the entry.
A.gatevis = () => formModal({
  title: 'New visitor',
  fields: [
    { name: 'name', label: 'Visitor name', required: true, maxlength: 80 },
    { name: 'phone', label: 'Mobile', type: 'tel', maxlength: 10, placeholder: '10-digit mobile', required: true },
    { name: 'who', label: 'Here to meet', type: 'select', value: 'resident', required: true, options: [{ v: 'resident', l: t('A resident') }, { v: 'Owner', l: t('Owner') }, { v: 'Manager', l: t('Manager') }, { v: 'Warden', l: t('Warden') }, { v: 'Other', l: t('Someone else / other work') }] },
    { name: 'res', label: 'Which resident', type: 'select', options: resOpts(), placeholder: 'Choose…' },
    { name: 'meet', label: 'Who / what for', placeholder: 'e.g. Delivery, plumber, office staff', maxlength: 80, hidden: true },
    { name: 'purpose', label: 'Purpose', value: t('Meeting'), maxlength: 80, required: true },
    { name: 'place', label: 'Coming from', full: true, placeholder: 'Locality, city, state', maxlength: 160, required: true },
  ],
  onChange: (v, f) => { showField(f, 'res', v.who === 'resident'); showField(f, 'meet', v.who === 'Other'); },
  onSubmit: v => {
    const toRes = v.who === 'resident';
    if (toRes && !v.res) return t('Choose which resident they are meeting');
    if (v.who === 'Other' && !String(v.meet || '').trim()) return t('Write who or what the visit is for');
    Store.put('gate', { type: 'visitor', name: v.name, phone: phone10(v.phone), resId: toRes ? v.res : null,
      meet: toRes ? undefined : (v.who === 'Other' ? String(v.meet).trim() : v.who),
      purpose: v.purpose, place: v.place, date: today(), inAt: nowIso() });
    if (toRes) notify({ to: 'res', resId: v.res, title: t('Visitor at gate'), body: `${v.name}${v.place ? ' · ' + v.place : ''}` });
    toast('Visitor entered');
  },
});
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
const visitUrl = () => { const h = Store.hostel() || {}; return new URL(`/visit.html?h=${encodeURIComponent(h.id)}&k=${encodeURIComponent(visitKey())}&n=${encodeURIComponent(h.name || '')}`, location.href).href; };
A.gateqr = async () => {
  if (!isAdmin()) return toast('Only the owner or manager can manage the visitor QR', 'bad');
  if (!visitKey()) { await Store.saveSettings({ gate: { visitKey: newQrKey(), selfEntry: true } }); }
  if (typeof qrcode !== 'function') await loadScript('/vendor/qrcode.js').catch(() => {});
  const on = (S().gate || {}).selfEntry !== false;
  qrSheet('Gate QR', visitUrl(), on ? 'Scan to sign in at the gate' : 'Self-entry is off', { copy: 'gateqrcopy', html: `${btn('Print', 'print', '', '', 'download')}${btn(on ? 'Turn off' : 'Turn on', 'gateqrtoggle', '', on ? '' : 'primary')}` });
};
A.gateqrcopy = async () => { try { await navigator.clipboard.writeText(visitUrl()); toast('Link copied'); } catch (e) { sheet('Link', `<pre class="pre-wrap">${esc(visitUrl())}</pre>`); } };
A.gateqrtoggle = async () => { await Store.saveSettings({ gate: { selfEntry: (S().gate || {}).selfEntry === false } }); closeModal(); A.gateqr(); };

/* ===================================================================== complaints */
const CMP_CATS = ['Electrical', 'Plumbing', 'Cleaning', 'Furniture', 'Wi-Fi', 'Food', 'Other'];
// Two tabs on one screen: things to fix, and things residents have told the owner about
// themselves. They are deliberately separate records — a message about being unwell is not a
// repair job and must never sit in the open-complaints count.
PAGES.complaints = {
  title: 'Complaints', mod: 'complaints',
  render() {
    const tab = curTab('cmptab', 'issues');
    const openN = Store.all('cmp').filter(c => c.status !== 'resolved').length, newN = rinfoUnread().length;
    const tabs = seg('cmptab', [['issues', 'Complaints', openN], ['msgs', 'Messages from residents', newN]], 'issues');
    if (tab === 'msgs') return `${head('Complaints', t('{n} new messages', { n: newN }))}${tabs}${rinfoPanel()}`;
    const f = curFlt('cmp', 'open'), all = Store.all('cmp'), isOpen = c => c.status !== 'resolved';
    const list = all.filter(c => f === 'all' || (f === 'open' ? isOpen(c) : !isOpen(c))).sort(by('ts', -1));
    return `${head('Complaints', t('{n} open', { n: openN }), btn('New complaint', 'addcmp', '', 'primary', 'plus'))}${tabs}
      <div class="tool">${chips('cmp', [['open', t('Open') + ' ' + openN], ['resolved', 'Resolved'], ['all', 'All']], 'open')}</div>
      ${list.length ? `<div class="group">${list.map(c => { const r = resById(c.resId), done = !isOpen(c); return prow({
        lead: `<span class="prow-ic ${tone(c.cat)}">${ico('wrench', 'sm')}</span>`, t: `${esc(t(c.cat))} · ${esc(t('Room'))} ${esc(roomName(c.roomId))}`, s: esc(c.text),
        tags: `${badge(done ? 'Resolved' : 'Open', done ? 'ok' : 'warn')}<span class="gate-t">${esc([r ? r.name : c.by || '', ago(c.ts)].filter(Boolean).join(' · '))}${done && c.resolvedBy ? ' · ' + esc(t('resolved by {w}', { w: t(c.resolvedBy) })) : ''}</span>`,
        acts: done ? '' : `<button type="button" class="rsv" data-act="cmpdone" data-id="${c.id}"><span class="rsv-ic">${ico('check', 'sm')}</span><span class="rsv-t">${esc(t('Mark resolved'))}</span><span class="rsv-go">${ico('chev', 'sm')}</span></button>`
      }); }).join('')}</div>` : `<div class="card">${empty('No complaints here')}</div>`}`;
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
A.addcmp = () => formModal({ title: 'New complaint', fields: [{ name: 'room', label: 'Room', type: 'select', options: rooms().map(r => ({ v: r.id, l: r.no })), required: true }, { name: 'cat', label: 'Category', type: 'select', options: CMP_CATS }, { name: 'text', label: 'Problem', type: 'textarea', required: true, full: true }], onSubmit: v => { const tx = String(v.text || '').trim(); if (tx.length < 5) return t('Describe the problem in a few words'); Store.put('cmp', { roomId: v.room, cat: v.cat, text: tx.slice(0, 500), status: 'open', date: today(), ts: nowIso(), src: 'staff', by: Store.me.full_name }); toast('Complaint added'); } });
// A complaint is either open or resolved; whoever sorts it out (owner, staff or the resident) taps Resolved and it is done.
const cmpResolve = (id, by) => { const c = Store.get(id); if (!c || c.status === 'resolved') return; Store.patch(c.id, { status: 'resolved', resolvedAt: nowIso(), resolvedBy: by });
  if (by === 'resident') notify({ to: 'admin', title: t('Complaint resolved'), body: `${roomName(c.roomId)} · ${t(c.cat)}`, link: 'complaints' });
  else if (c.resId) notify({ to: 'res', resId: c.resId, title: t('Complaint resolved'), body: t(c.cat) });
  toast(t('Marked resolved'), 'ok', { label: 'Undo', run: () => { Store.patch(c.id, { status: 'open', resolvedAt: null, resolvedBy: null }); render(); } }); render(); };
A.cmpdone = el => {
  if (el.dataset.busy) return; el.dataset.busy = '1'; el.classList.add('on');
  el.querySelector('.rsv-t').textContent = t('Resolved'); haptic();
  setTimeout(() => cmpResolve(el.dataset.id, 'owner'), 520);
};
A.rcmpdone = el => cmpResolve(el.dataset.id, 'resident');

/* ===================================================================== staff & salary */
PAGES.staff = {
  title: () => (ui.arg && staffById(ui.arg) ? staffById(ui.arg).name : 'Staff & Salary'), mod: 'staff',
  render() {
    if (ui.arg) return staffProfile(ui.arg);
    const tab = curTab('st', 'team'), ym = ui.flt.stm || ymOf(today());
    const list = staffList().filter(s => curFlt('stf', 'active') === 'all' || s.status === curFlt('stf', 'active'));
    let body;
    if (tab === 'team') {
      body = `<div class="tool">${chips('stf', [['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']], 'active')}</div>
        ${group('', list.map(s => {
          const sum = staffSalarySummary(s, ym);
          let dLine = `${t(s.dept)} · ${s.phone || ''} · ${inr(s.salary)}/${t('month')}`;
          if (sum.activeAdvance > 0) dLine += ` · <span style="color:var(--warn);font-weight:600">${t('Adv')}: ${inr(sum.activeAdvance)}</span>`;
          if (sum.currentMonthDue > 0) dLine += ` · <span style="color:var(--bad);font-weight:600">${t('Due')}: ${inr(sum.currentMonthDue)}</span>`;
          return li({
            lead: avatar(s.name),
            t: s.name,
            d: dLine,
            end: s.status === 'active' ? '' : badge(t('Inactive'), 'warn'),
            act: 'staffview',
            attrs: `data-id="${s.id}"`
          });
        }).join(''))}`;
    } else if (tab === 'att') {
      const sd = ui.flt.sdate || today(), sym = sd.slice(0, 7), dn = +sd.slice(8), team = staffList().filter(s => s.status === 'active');
      const rec = s => Store.get(`att-${s.id}-${sym}`) || { days: {} };
      const st = s => { const v = (rec(s).days || {})[dn] || ''; return v === 'A' || v === 'H' ? v : 'P'; };
      const nA = team.filter(s => st(s) === 'A').length, nH = team.filter(s => st(s) === 'H').length;
      // (no month summary here: everyone is present unless marked absent)
      body = `<div class="attnav">${btn('', 'sdate', `data-d="${addDays(sd, -1)}" aria-label="${esc(t('Previous day'))}"`, '', 'back')}<div><b>${esc(fmtDate(sd))}</b><span>${sd === today() ? esc(t('Today')) : `<button type="button" class="pillbtn" data-act="sdate" data-d="${today()}">${esc(t('Today'))}</button>`}</span></div>${btn('', 'sdate', `data-d="${addDays(sd, 1)}" ${sd >= today() ? 'disabled' : ''} aria-label="${esc(t('Next day'))}"`, '', 'chev')}</div>
        <div class="pstats">${kpi('Present', team.length - nA - nH, t('of {n} staff', { n: team.length }), 'ok')}${kpi('Absent', nA, nA ? t('{n} people', { n: nA }) : t('everyone is in'), nA ? 'bad' : '')}${kpi('Half day', nH, '', nH ? 'warn' : '')}</div>
        ${about('Everyone counts as present. Switch off only the staff who did not come, then pick Absent or Half day. Only absences reduce salary.')}
        ${team.length ? `<div class="group">${team.map(s => { const v = st(s), pu = (rec(s).punch || {})[dn]; return prow({
          lead: avatar(s.name), t: `<button class="linkish" data-act="staffview" data-id="${s.id}">${esc(s.name)}</button>`, s: esc([t(s.dept), pu ? t('Punched in {t}', { t: fmtTs(pu.at) }) : ''].filter(Boolean).join(' · ')),
          tags: v === 'P' ? '' : `${pillb('Absent', 'staffday', `data-id="${s.id}" data-d="${sd}" data-v="A"`, v === 'A' ? 'on bad' : '')}${pillb('Half day', 'staffday', `data-id="${s.id}" data-d="${sd}" data-v="H"`, v === 'H' ? 'on warn' : '')}`,
          amt: `<label class="sw"><input type="checkbox" data-satt="${s.id}" data-d="${sd}" ${v === 'P' ? 'checked' : ''} aria-label="${esc(t('Present'))}"><span></span></label>`, ms: t(v === 'P' ? 'Present' : v === 'A' ? 'Absent' : 'Half day')
        }); }).join('')}</div>` : `<div class="card">${empty('No active staff')}</div>`}`;
    } else {
      const team = staffList().filter(s => s.status === 'active'), sums = team.map(s => ({ s, p: payrollFor(s, ym), m: staffSalarySummary(s, ym) }));
      const tot = k => sum_(sums, x => k(x));
      body = `${monthBar(ym)}
        <div class="pstats">${kpi('Payable', inr(tot(x => x.p.payable)), fmtYM(ym), '')}${kpi('Paid', inr(tot(x => x.p.paid)), '', 'ok')}${kpi('To pay', inr(tot(x => Math.max(0, x.m.netPayable || 0))), t('after advances'), tot(x => x.m.netPayable || 0) > 0 ? 'warn' : 'ok')}</div>
        ${sums.length ? `<div class="stack">${sums.map(({ s, p, m }) => { const net = Math.max(0, m.netPayable || 0), adv = m.activeAdvance; return `<div class="card sal">
          <div class="sal-h" role="button" tabindex="0" data-act="staffview" data-id="${s.id}">${avatar(s.name)}<div><b>${esc(s.name)}</b><span>${esc(t(s.dept))} · ${inr(s.salary)}/${esc(t('month'))}</span></div>${net > 0 ? `<em class="bad-t">${inr(net)}</em>` : badge('Clear', 'ok')}</div>
          <div class="sal-g"><div><small>${esc(t('Payable'))}</small><b>${inr(p.payable)}</b></div><div><small>${esc(t('Paid'))}</small><b>${inr(p.paid)}</b></div><div><small>${esc(t('Advance'))}</small><b class="${adv > 0 ? 'warn-t' : ''}">${adv > 0 ? inr(adv) : '—'}</b></div></div>
          <div class="sal-a"><span class="muted xs">${esc(t('Absent {a} · Half day {h}', { a: p.A, h: p.H }))}</span><span class="sp"></span>${btn('Advance', 'giveadv', `data-id="${s.id}"`, 'sm', 'plus')}${m.currentMonthDue > 0 ? btn(t('Pay {a}', { a: inr(m.netPayable || m.currentMonthDue) }), 'paysal', `data-id="${s.id}" data-ym="${ym}"`, 'sm primary') : ''}</div></div>`; }).join('')}</div>` : `<div class="card">${empty('No active staff')}</div>`}
        ${about(t('Only marked absences reduce salary (half day = half). Salary payments and advances are added to expenses.'))}`;
    }
    return `${head('Staff & Salary', t('{n} active', { n: staffList().filter(s => s.status === 'active').length }), btn('Add staff', 'addstaff', '', 'primary', 'plus'))}${seg('st', [['team', 'Team'], ['att', 'Attendance'], ['pay', 'Salary']], 'team')}${body}`;
  },
};
// ‹ November 2026 › : steps through months without the phone's own month picker.
const monthBar = (ym, act = 'stmon') => { const cur = ymOf(today()); return `<div class="attnav">${btn('', act, `data-m="${addMonths(ym, -1)}" aria-label="${esc(t('Previous month'))}"`, '', 'back')}<div><b>${esc(fmtYM(ym))}</b><span>${ym === cur ? esc(t('This month')) : `<button type="button" class="pillbtn" data-act="${act}" data-m="${cur}">${esc(t('This month'))}</button>`}</span></div>${btn('', act, `data-m="${addMonths(ym, 1)}" ${ym >= cur ? 'disabled' : ''} aria-label="${esc(t('Next month'))}"`, '', 'chev')}</div>`; };
function staffForm(x) {
  const deptAllowed = d => {
    if (d === 'Kitchen') return can('kitchen') || can('mess');
    if (d === 'Laundry') return can('laundry');
    if (d === 'Housekeeping') return can('housekeeping');
    if (d === 'Security') return can('gate');
    if (d === 'Accounts' || d === 'Accounting') return can('payments');
    if (d === 'E-Mitra' || d === 'Verification') return can('emitra');
    return true;
  };
  const availableDepts = S().departments.filter(deptAllowed);
  const initialDept = (x && x.dept && deptAllowed(x.dept)) ? x.dept : (availableDepts[0] || 'Office');
  const s = { status: 'active', dept: initialDept, ...(x || {}) }, isNew = !s.id;
  const req = S().staffDocs.required;
  formModal({
    title: isNew ? 'Add staff' : 'Edit staff', wide: true,
    fields: [
      { name: 'name', label: 'Full name', value: s.name, required: true, maxlength: 80, placeholder: 'e.g. Ramesh Kumar' },
      { name: 'phone', label: 'Mobile', type: 'tel', value: s.phone, required: true, maxlength: 10, placeholder: '10-digit mobile' },
      { name: 'dept', label: 'Department', type: 'select', options: availableDepts.map(d => ({ v: d, l: t(d) })), value: s.dept, hint: `<a href="/settings/depts">${esc(t('Edit departments'))}</a>` },
      { name: 'salary', label: 'Monthly salary (₹)', type: 'number', min: 0, max: 10000000, value: s.salary || '', required: true, placeholder: 'e.g. 15000', hint: t('Base monthly salary for this staff') },
      { name: 'joinDate', label: 'Joining date', type: 'date', value: s.joinDate || today(), required: true },
      ...(isNew ? [{ name: 'openingAdv', label: 'Opening advance (₹)', type: 'number', min: 0, placeholder: '0 if none', hint: t('Any advance already paid to this staff') }] : []),
      { name: 'idNo', label: 'ID number (Aadhaar)', value: s.idNo, maxlength: 12, placeholder: '12-digit Aadhaar', required: true },
      { name: 'address', label: 'Address', value: s.address, full: true, maxlength: 240, placeholder: 'Home address', required: true },
      ...(!isNew ? [] : [{ name: 'login', label: 'Create app login (shows only their work)', type: 'checkbox', value: true, hint: t('User ID = mobile.hostel, password = mobile number.'), full: true }]),
      { type: 'section', label: 'Documents' },
      ...req.map((d, i) => ({ name: 'doc' + i, label: d, type: 'file', accept: 'image/*', required: isNew || !(s.docs || []).some(z => z.type === d) })),
      { type: 'html', html: docsNote() },
    ],
    onSubmit: async v => {
      const salVal = Number(v.salary) || 0;
      // same care as a resident: valid unique mobile, real Aadhaar, joining date not in the future
      const ph = phone10(v.phone);
      if (!/^[5-9][0-9]{9}$/.test(ph)) return t('Mobile must be a 10-digit mobile number.');
      if (staffList().some(z => z.id !== s.id && phone10(z.phone) === ph)) return t('A staff member with this mobile number already exists');
      const aad = String(v.idNo || '').replace(/[^0-9]/g, '');
      if (aad.length !== 12 || /^[01]/.test(aad)) return t('Aadhaar number must be exactly 12 digits');
      if (v.joinDate > today()) return t('The joining date cannot be in the future');
      if (!(salVal > 0)) return t('Enter the monthly salary');
      const rec = Store.put('staff', {
        ...s,
        id: s.id || uid('st-'),
        name: v.name,
        phone: phone10(v.phone),
        dept: v.dept,
        role: STAFF_ROLE_BY_DEPT[v.dept] || 'staff',
        salary: salVal,
        joinDate: v.joinDate,
        idNo: v.idNo,
        address: v.address,
        docs: s.docs || []
      });
      if (isNew && Number(v.openingAdv) > 0) {
        const advVal = Number(v.openingAdv);
        const adv = Store.put('sal', {
          staffId: rec.id,
          staffName: rec.name,
          ym: ymOf(today()),
          amount: advVal,
          isAdv: true,
          type: 'advance',
          mode: 'cash',
          date: today(),
          note: t('Opening advance')
        });
        Store.put('exp', {
          id: `exp-${adv.id}`,
          date: today(),
          cat: S().expenseCats.includes('Salary') ? 'Salary' : 'Other',
          amount: advVal,
          mode: 'cash',
          paid: true,
          vendor: rec.name,
          note: `${t('Opening advance')} · ${rec.name}`,
          ref: adv.id
        });
      }
      const files = req.map((d, i) => ({ type: d, file: (v['doc' + i] || [])[0] })).filter(f => f.file);
      if (files.length) uploadDocs('staff', rec.id, files);
      if (v.login) {
        const h = Store.hostel();
        const hSlug = slug((h && h.name) || 'hostel').slice(0, 18).replace(/\.+$/, '') || 'hostel';
        const ph = phone10(rec.phone);
        const wantUser = ph && ph.length === 10 ? `${ph}.${hSlug}` : undefined;
        try {
          const u = await Backend.admin('create_user', { full_name: rec.name, phone: rec.phone, username: wantUser, org_id: h.org_id, hostel_id: h.id, role: rec.role, ref_id: rec.id });
          Store.patch(rec.id, { userId: u.user_id, username: u.username });
          closeModal();
          render();
          waOpen(rec.phone, tpl('staffWelcome', { name: rec.name.split(' ')[0], role: t(ROLES[rec.role].l), hostel: hostelName(), link: appUrl(), username: u.username, password: u.password }), 'Send login');
          return false;
        } catch (e) {
          toast(t('Login not created: {m}', { m: e.message }), 'bad');
        }
      }
      toast(t('Staff saved'));
      closeModal();
      render();
    },
  });
}
A.addstaff = () => staffForm();
/* ===================================================================== staff profile (a full page, like a resident's)
 * Everything about one staff member in one place: who they are, their papers (viewable), attendance for any month
 * (tap a day to mark it), what they earned / were paid / still need month by month, every payment and advance, and how
 * advances are being recovered from salary. Opening a staff row goes here instead of a small pop-up. */
const staffMonthsList = s => {
  const out = []; let ym = ymOf(s.joinDate || today()); const cur = ymOf(today());
  for (let i = 0; i < 60 && ym <= cur; i++) { out.push(ym); ym = addMonths(ym + '-01', 1).slice(0, 7); }
  return out.reverse();
};
// Advance ledger: every advance given (+) and every recovery from a salary payment (-), oldest first, with the running balance.
function staffAdvanceLedger(s) {
  const rows = [];
  for (const x of Store.all('sal').filter(z => z.staffId === s.id)) {
    if (x.isAdv || x.type === 'advance') rows.push({ date: x.date || '', kind: 'given', amt: +x.amount || 0, note: x.note || '', ym: x.ym });
    else if (+x.advDeducted > 0) rows.push({ date: x.date || '', kind: 'recovered', amt: -(+x.advDeducted), note: `${t('Salary')} ${fmtYM(x.ym)}`, ym: x.ym });
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let bal = 0; for (const r of rows) { bal = round2(bal + r.amt); r.bal = bal; }
  return rows;
}
function staffProfile(id) {
  const s = staffById(id);
  if (!s) return `<div class="card">${empty('Staff member not found', t('This staff record does not exist or has been removed.'), btn('Back to Staff', 'go', 'data-to="staff"', 'primary'))}</div>`;
  const cur = ymOf(today()), ym = ui.flt.stm || cur;
  const sum = staffSalarySummary(s, ym), p = sum.attendance, adv = staffAdvanceLedger(s);
  const months = staffMonthsList(s).map(m => ({ ym: m, ...payrollFor(s, m) }));
  const pending = months.filter(m => m.due > 0);
  const pendingTotal = sum_(pending, m => m.due);
  const att = (Store.get(`att-${s.id}-${ym}`) || { days: {} }).days, dim = daysIn(ym), firstDow = parse(`${ym}-01`).getDay();
  const lastShown = ym === cur ? +today().slice(8) : dim;
  const cell = d => { const v = att[d] === 'A' || att[d] === 'H' ? att[d] : ''; const cls = d > lastShown ? 'mute' : v === 'A' ? 'bad' : v === 'H' ? 'warn' : 'ok';
    return `<button type="button" class="stcell ${cls}" data-act="attmark" data-id="${s.id}" data-ym="${ym}" data-d="${d}" ${d > lastShown ? 'disabled' : ''} aria-label="${esc(fmtShort(`${ym}-${pad(d)}`))} ${esc(v === 'A' ? t('Absent') : v === 'H' ? t('Half day') : t('Present'))}"><span>${d}</span><b>${v || '✓'}</b></button>`; };
  const blanks = Array.from({ length: firstDow }, () => '<span></span>').join('');
  const docTypes = [...new Set([...(S().staffDocs.required || []), ...(s.docs || []).map(d => d.type)])];
  const docRows = docTypes.map(tp => { const d = (s.docs || []).find(z => z.type === tp);
    return li({ icon: d ? 'file' : 'upload', ic: d ? 'ok' : 'warn', t: t(tp), d: d ? `${t('Uploaded')} ${fmtTs(d.ts)}` : t('Missing'),
      end: `${d ? docOpen(d, null) : ''}${isAdmin() ? btn(d ? 'Replace' : 'Upload', 'staffdocadd', `data-id="${s.id}" data-type="${esc(tp)}"`, 'sm ghost', 'upload') : ''}` }); }).join('');
  const tx = sum.history;
  const advTotal = sum.totalAdvanceGiven, advBack = sum.totalAdvanceDeducted;
  const bigAdv = sum.activeAdvance > (+s.salary || 0) && (+s.salary || 0) > 0;
  return `<div class="row" style="margin:6px 0 10px">${btn('Staff', 'go', 'data-to="staff"', 'ghost sm', 'back')}</div>
    <div class="hero ${sum.netPayable > 0 ? '' : 'ok'}"><div class="row nw" style="gap:14px">${avatar(s.name)}<div style="min-width:0;flex:1"><b style="font-size:20px">${esc(s.name)}</b>
      <div class="muted sm">${esc(t(s.dept))} · ${t('since')} ${fmtDate(s.joinDate)} · ${s.status === 'active' ? esc(t('Active')) : esc(t('Inactive'))}</div></div></div>
      <div style="margin-top:14px" class="muted sm">${esc(t(sum.netPayable > 0 ? 'Net payable now' : 'Nothing to pay now'))}</div><div class="big">${inr(sum.netPayable)}</div>
      ${sum.activeAdvance > 0 ? `<div class="sm">${esc(t('Advance to recover'))}: ${inr(sum.activeAdvance)}</div>` : ''}
      <div class="row" style="margin-top:14px">${isAdmin() ? btn('Pay salary', 'paysal', `data-id="${s.id}" data-ym="${ym}"`, 'primary sm', 'check') : ''}${isAdmin() ? btn('Give advance', 'giveadv', `data-id="${s.id}"`, 'sm', 'plus') : ''}${s.phone ? `<a class="btn sm" href="tel:${esc(phone10(s.phone))}">${ico('phone', 'sm')} ${esc(t('Call'))}</a>` : ''}${s.phone ? btn('WhatsApp', 'staffwa', `data-id="${s.id}"`, 'sm', 'wa') : ''}</div></div>
    ${bigAdv ? `<div class="note warn" style="margin-top:12px">${ico('alert', 'sm')} ${esc(t('The advance ({a}) is more than one month\'s salary ({s}). It will take more than one salary to recover.', { a: inr(sum.activeAdvance), s: inr(+s.salary) }))}</div>` : ''}
    ${pendingTotal > 0 ? `<div class="note bad" style="margin-top:12px">${ico('alert', 'sm')} ${esc(t('Salary pending for {n} month(s): {a}', { n: pending.length, a: inr(pendingTotal) }))} · ${pending.slice(0, 4).map(m => fmtYM(m.ym)).join(', ')}${pending.length > 4 ? ` +${pending.length - 4} ${t('more')}` : ''}</div>` : ''}
    <div class="pstats" style="margin-top:14px">${kpi('Monthly salary', inr(+s.salary || 0), t('base'), '', null, 'rupee')}${kpi('Total paid so far', inr(sum.totalPaid), `${inr(sum.totalSalaryPaid)} ${t('salary')} + ${inr(advTotal)} ${t('advance')}`, 'ok', null, 'wallet')}${kpi('Advance balance', inr(sum.activeAdvance), `${inr(advTotal)} ${t('given')} · ${inr(advBack)} ${t('recovered')}`, sum.activeAdvance > 0 ? 'warn' : '', null, 'alert')}${kpi('Pending salary', inr(pendingTotal), pending.length ? t('{n} month(s)', { n: pending.length }) : t('all paid'), pendingTotal > 0 ? 'bad' : 'ok', null, 'clock')}</div>
    <div class="grid g2" style="margin-top:14px">
      <div class="stack">
        <div class="group-t">${esc(t('Attendance'))} · ${esc(fmtYM(ym))}</div>
        <div class="card"><div class="row sb nw" style="margin-bottom:8px">${btn('', 'stmon', `data-m="${addMonths(ym + '-01', -1).slice(0, 7)}" aria-label="${esc(t('Previous month'))}"`, 'sm', 'back')}<b>${esc(fmtYM(ym))}</b>${ym < cur ? btn('', 'stmon', `data-m="${addMonths(ym + '-01', 1).slice(0, 7)}" aria-label="${esc(t('Next month'))}"`, 'sm', 'chev') : '<span style="width:36px"></span>'}</div>
          <div class="stgrid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<i>${x}</i>`).join('')}${blanks}${Array.from({ length: dim }, (_, i) => cell(i + 1)).join('')}</div>
          <div class="row wrap xs muted" style="gap:12px;margin-top:8px"><span><b class="bad-t">${p.A}</b> ${esc(t('Absent'))}</span><span><b class="warn-t">${p.H}</b> ${esc(t('Half day'))}</span></div>
          <div class="hint" style="margin-top:6px">${esc(t('Everyone counts as present. Tap a day to mark Absent, tap again for Half day, again to clear.'))}</div></div>
        <div class="group-t">${esc(t('Month by month'))}</div>
        ${months.length ? `<div class="group">${months.slice(0, 18).map(m => prow({ lead: `<span class="prow-ic tn2">${ico('cal', 'sm')}</span>`, t: esc(fmtYM(m.ym)), s: esc(t('Earned {a} · Paid {p}', { a: inr(m.payable), p: inr(m.paid) })), tags: m.due > 0 ? '' : badge('Paid', 'ok'), amt: m.due > 0 ? inr(m.due) : '', mc: 'bad-t', acts: m.due > 0 && isAdmin() ? btn('Pay', 'paysal', `data-id="${s.id}" data-ym="${m.ym}"`, 'sm primary') : '' })).join('')}</div>` : `<div class="card">${empty('No months yet')}</div>`}
      </div>
      </div>
      <div class="stack">
        <div class="group-t">${esc(t('Details'))}</div>
        <div class="group">${[
          li({ icon: 'phone', ic: 'ok', t: s.phone || '—', d: t('Mobile') }),
          li({ icon: 'file', ic: 'info', t: s.idNo || '—', d: t('ID number (Aadhaar)') }),
          li({ icon: 'home', ic: 'mute', t: s.address || '—', d: t('Address') }),
          li({ icon: 'cal', ic: 'mute', t: fmtDate(s.joinDate), d: t('Joining date') }),
          li({ icon: 'key', ic: s.username ? 'ok' : 'mute', t: s.username ? '@' + s.username : t('No app login'), d: t('App login') }),
        ].join('')}</div>
        <div class="group-t">${esc(t('Documents'))}</div>
        <div class="group">${docRows || li({ icon: 'file', ic: 'mute', t: t('No documents required'), chev: false })}</div>
        <div class="group-t">${esc(t('Advance account'))}</div>
        ${adv.length ? `<div class="group">${adv.map(r => prow({ lead: `<span class="prow-ic ${r.kind === 'given' ? 'tn3' : 'tn2'}">${ico(r.kind === 'given' ? 'plus' : 'check', 'sm')}</span>`, t: esc(r.kind === 'given' ? t('Advance given') : t('Recovered from salary')), s: esc([fmtShort(r.date || today()), r.note].filter(Boolean).join(' · ')), amt: `${r.amt > 0 ? '+' : '-'}${inr(Math.abs(r.amt))}`, mc: r.amt > 0 ? 'warn-t' : 'ok-t', ms: `${t('Balance')} ${inr(r.bal)}` })).join('')}</div><div class="about">${tip(esc(t('When you pay a salary, the advance is adjusted automatically: the amount shown there is the most that can be recovered this month.')))}</div>` : `<div class="card"><span class="muted">${esc(t('No advance given yet.'))}</span></div>`}
      </div>
      </div>
    </div>
    <div class="group-t" style="margin-top:14px">${esc(t('All payments'))} (${tx.length})</div>
    ${tx.length ? `<div class="group">${tx.map(x => { const isA = x.isAdv || x.type === 'advance'; return prow({ lead: `<span class="prow-ic ${isA ? 'tn3' : 'tn2'}">${ico(isA ? 'wallet' : 'rupee', 'sm')}</span>`, t: isA ? esc(t('Advance')) : `${esc(t('Salary'))} · ${esc(fmtYM(x.ym))}`, s: esc([repDmy(x.date || today()), t(x.mode || 'cash'), x.advDeducted ? t('advance adjusted {a}', { a: inr(x.advDeducted) }) : '', x.note].filter(Boolean).join(' · ')), amt: inr(x.amount), acts: isAdmin() ? btn('Delete', 'delsal', `data-id="${x.id}"`, 'sm bad', 'trash') : '' }); }).join('')}</div>` : `<div class="card">${empty('No payments yet')}</div>`}
    ${isAdmin() ? `<div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">${btn('Edit', 'staffedit', `data-id="${s.id}"`, '', 'edit')}<span class="row" style="gap:8px;align-items:center">${staffSw(s)}<b>${esc(t('Active'))}</b></span>${s.status !== 'active' ? btn('Remove', 'staffremove', `data-id="${s.id}"`, 'bad') : ''}</div>` : ''}`;
}
const sum_ = (a, f) => a.reduce((n, x) => n + f(x), 0);
A.staffview = el => go('staff/' + el.dataset.id);
A.stmon = el => { ui.flt.stm = el.dataset.m; render(); };
A.staffwa = el => { const s = staffById(el.dataset.id); if (s) waOpen(s.phone, `${t('Hello')} ${s.name.split(' ')[0]},\n\n${hostelName()}`, 'Send on WhatsApp'); };
A.staffdocadd = el => {
  const s = staffById(el.dataset.id), type = el.dataset.type; if (!s) return;
  formModal({
    title: type, submit: 'Upload',
    fields: [{ name: 'file', label: 'Photo', type: 'file', required: true, accept: 'image/*' }, { type: 'html', html: docsNote() }],
    onSubmit: v => {
      if (!Files.ready()) return 'Documents are not uploaded in demo mode.';
      const f = (v.file || [])[0]; if (!f) return 'Choose a file';
      uploadDocs('staff', s.id, [{ type, file: f }]);
    },
  });
};
A.staffedit = el => staffForm(staffById(el.dataset.id));
// Active / inactive as a switch (the same one in Housekeeping, Settings and the staff profile)
const staffSw = s => `<label class="sw"><input type="checkbox" data-staffsw="${s.id}" ${s.status === 'active' ? 'checked' : ''} aria-label="${esc(t('Active'))}"><span></span></label>`;
document.addEventListener('change', e => { const el = e.target; if (el && el.hasAttribute && el.hasAttribute('data-staffsw')) A.staffstatus({ dataset: { id: el.dataset.staffsw } }); });
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
  if (s.userId) Backend.admin('set_active', { user_id: s.userId, active: false }).catch(e => toast(`${t('Their login is still active')}: ${e.message}`, 'bad'));
}, 'Remove', 'bad');
// Calendar tap on the staff profile: present (default) -> absent -> half day -> present.
A.attmark = el => {
  const id = `att-${el.dataset.id}-${el.dataset.ym}`, cur = Store.get(id) || { id, staffId: el.dataset.id, ym: el.dataset.ym, days: {} };
  const nx = { '': 'A', P: 'A', A: 'H', H: '' }[cur.days[el.dataset.d] || ''];
  const days = { ...cur.days }; if (nx) days[el.dataset.d] = nx; else delete days[el.dataset.d];
  Store.put('att', { ...cur, days }); render();
};
// Attendance tab: day navigation, the Absent / Half day pills and the Present switch.
A.sdate = el => { if (el.dataset.d > today()) return; ui.flt.sdate = el.dataset.d; render(); };
A.staffday = el => {
  const id = el.dataset.id, d = el.dataset.d, ym = d.slice(0, 7), dn = +d.slice(8), key = `att-${id}-${ym}`;
  const cur = Store.get(key) || { id: key, staffId: id, ym, days: {} }, days = { ...cur.days };
  if (el.dataset.v) days[dn] = el.dataset.v; else delete days[dn];
  Store.put('att', { ...cur, days }); render();
};
document.addEventListener('change', e => { const el = e.target; if (el && el.hasAttribute && el.hasAttribute('data-satt')) A.staffday({ dataset: { id: el.dataset.satt, d: el.dataset.d, v: el.checked ? '' : 'A' } }); });
A.paysal = el => {
  const s = staffById(el.dataset.id);
  if (!s) return;
  const ym = el.dataset.ym || ymOf(today());
  const summary = staffSalarySummary(s, ym);
  const p = summary.attendance;
  const activeAdv = summary.activeAdvance;
  const maxAdvDeduct = Math.min(activeAdv, p.due);

  const fields = [
    { name: 'ym', label: 'Month', type: 'select', options: monthOpts(ym), value: ym, required: true },
    ...(maxAdvDeduct > 0 ? [
      { name: 'advDeducted', label: `Deduct from advance (₹) [Max: ${inr(maxAdvDeduct)}]`, type: 'number', min: 0, max: maxAdvDeduct, value: maxAdvDeduct, hint: t('Deducts this amount from their active advance balance'), info: t('An advance already given is adjusted here, so the same money is not paid twice. The cash you hand over is the amount below.') }
    ] : []),
    { name: 'amount', label: maxAdvDeduct > 0 ? 'Cash/Bank amount to pay (₹)' : 'Amount (₹)', type: 'number', min: 0, value: Math.max(0, p.due - maxAdvDeduct), required: true, hint: maxAdvDeduct > 0 ? t('Net cash or bank payment handed over to staff') : '' },
    { name: 'mode', label: 'Paid by', type: 'select', options: [{ v: 'cash', l: t('Cash') }, { v: 'upi', l: 'UPI' }, { v: 'bank', l: t('Bank transfer') }] },
    { name: 'date', label: 'Date', type: 'date', value: today(), required: true },
    { name: 'note', label: 'Note', placeholder: 'e.g. Month salary / वेतन' }
  ];

  formModal({
    title: `${t('Pay salary')} · ${s.name}`,
    note: `${esc(t('Salary due for {m}:', { m: fmtYM(ym) }))} <b>${inr(p.due)}</b>${activeAdv > 0 ? ` · ${esc(t('Active advance:'))} <b style="color:var(--warn)">${inr(activeAdv)}</b>` : ''}`,
    fields,
    preview: v => {
      const mm = v.ym || ym, pp = payrollFor(s, mm), ded = Math.max(0, +v.advDeducted || 0), cash = Math.max(0, +v.amount || 0);
      const left = Math.max(0, round2(activeAdv - ded)), stillDue = Math.max(0, round2(pp.due - ded - cash));
      const row = (l, val, cls = '') => `<dt>${esc(l)}</dt><dd class="${cls}"><b>${val}</b></dd>`;
      return `<dl class="kv" style="margin:6px 0">${row(t('Salary due for {m}', { m: fmtYM(mm) }), inr(pp.due))}${activeAdv > 0 ? row(t('Advance taken so far'), inr(activeAdv)) : ''}${ded > 0 ? row(t('Advance recovered now'), '- ' + inr(ded), 'warn-t') : ''}${row(t('Cash / bank to hand over'), inr(cash), 'ok-t')}${row(t('Salary still pending after this'), inr(stillDue), stillDue > 0 ? 'bad-t' : 'ok-t')}${activeAdv > 0 ? row(t('Advance still to recover'), inr(left), left > 0 ? 'warn-t' : 'ok-t') : ''}</dl>${activeAdv > pp.due ? `<div class="hint">${esc(t('The advance is more than this month\'s salary, so the rest ({a}) is recovered from the next salaries.', { a: inr(left) }))}</div>` : ''}`;
    },
    onChange(vals, form, changed) {
      if (changed === 'advDeducted' && maxAdvDeduct > 0) {
        const ded = Math.min(maxAdvDeduct, Math.max(0, Number(vals.advDeducted) || 0));
        setField(form, 'amount', Math.max(0, p.due - ded));
      }
    },
    onSubmit: v => {
      const netAmount = Number(v.amount) || 0;
      const advDed = Number(v.advDeducted) || 0;
      if (netAmount <= 0 && advDed <= 0) return t('Enter amount or advance to deduct');
      // never book more than what is owed for that month (stops double-paying the same salary)
      const dueNow = payrollFor(s, v.ym || ym).due;
      if (netAmount + advDed > dueNow + 0.5) return dueNow > 0 ? t('Only {d} is due for this month. Reduce the amount.', { d: inr(dueNow) }) : t('Salary for this month is already fully paid.');
      const sal = Store.put('sal', {
        staffId: s.id,
        staffName: s.name,
        ym: v.ym || ym,
        amount: netAmount,
        advDeducted: advDed,
        mode: v.mode || 'cash',
        date: v.date || today(),
        note: v.note || '',
        type: 'salary'
      });
      if (netAmount > 0) {
        Store.put('exp', {
          id: `exp-${sal.id}`,
          date: v.date || today(),
          cat: S().expenseCats.includes('Salary') ? 'Salary' : 'Other',
          amount: netAmount,
          mode: v.mode || 'cash',
          paid: true,
          vendor: s.name,
          note: `${t('Salary')} ${fmtYM(v.ym || ym)}${advDed > 0 ? ` (${t('Adv deducted')}: ${inr(advDed)})` : ''}`,
          ref: sal.id
        });
      }
      toast(t('Salary paid'));
      closeModal();
      render();
      A.staffview({ dataset: { id: s.id } });
    }
  });
};
A.giveadv = el => {
  const s = staffById(el.dataset.id);
  if (!s) return;
  const summary = staffSalarySummary(s);
  formModal({
    title: `${t('Give advance')} · ${s.name}`,
    note: summary.activeAdvance > 0 ? `${t('Current active advance')}: <b style="color:var(--warn)">${inr(summary.activeAdvance)}</b>` : '',
    fields: [
      { name: 'amount', label: 'Advance amount (₹)', type: 'number', min: 1, required: true, placeholder: 'e.g. 5000' },
      { name: 'mode', label: 'Paid by', type: 'select', options: [{ v: 'cash', l: t('Cash') }, { v: 'upi', l: 'UPI' }, { v: 'bank', l: t('Bank transfer') }] },
      { name: 'date', label: 'Date', type: 'date', value: today(), required: true },
      { name: 'note', label: 'Reason / Note', placeholder: 'e.g. Medical emergency / त्यौहार का ख़र्च' }
    ],
    onSubmit: v => {
      const amt = Number(v.amount);
      if (!amt || amt <= 0) return t('Enter valid advance amount');
      const sal = Store.put('sal', {
        staffId: s.id,
        staffName: s.name,
        ym: ymOf(v.date || today()),
        amount: amt,
        isAdv: true,
        type: 'advance',
        mode: v.mode || 'cash',
        date: v.date || today(),
        note: v.note || t('Staff advance')
      });
      Store.put('exp', {
        id: `exp-${sal.id}`,
        date: v.date || today(),
        cat: S().expenseCats.includes('Salary') ? 'Salary' : 'Other',
        amount: amt,
        mode: v.mode || 'cash',
        paid: true,
        vendor: s.name,
        note: `${t('Staff advance')} · ${s.name}${v.note ? ' (' + v.note + ')' : ''}`,
        ref: sal.id
      });
      toast(t('Advance recorded'));
      closeModal();
      render();
      A.staffview({ dataset: { id: s.id } });
    }
  });
};
A.delsal = el => {
  const id = el.dataset.id;
  const sal = Store.get(id);
  if (!sal) return;
  const staffId = sal.staffId;
  confirmBox(t('Delete this payment/advance record?'), () => {
    Store.remove(id);
    Store.remove('exp-' + id);
    toast(t('Record removed'));
    render();
    if (staffId) A.staffview({ dataset: { id: staffId } });
  }, 'Delete', 'bad');
};

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

// One Present / Absent toggle for a resident: neither side lit = not called yet; tap a side to mark, tap the other to change.
function paToggle(id, d, pk, state, off) {
  const at = `data-id="${id}" data-d="${d}" data-p="${pk}" ${off ? 'disabled' : ''}`;
  return `<span class="pa" role="group" aria-label="${esc(t('Present or absent'))}"><button type="button" class="pa-p ${state === 'p' ? 'on' : ''}" data-act="rcallp" ${at} aria-pressed="${state === 'p'}">${ico('check', 'sm')}<span>${esc(t('Present'))}</span></button><button type="button" class="pa-a ${state === 'a' ? 'on' : ''}" data-act="rcalla" ${at} aria-pressed="${state === 'a'}">${ico('x', 'sm')}<span>${esc(t('Absent'))}</span></button></span>`;
}
function attRollView() {
  const d = attDate(), pk = attCurPeriod(), ps = attPeriods(), per = attPeriod(pk);
  const roll = attRollCall(d, pk);
  const future = d > today();
  const q = (ui.q.att || '').toLowerCase().trim();
  const match = r => !q || `${r.name} ${roomName(r.roomId)}`.toLowerCase().includes(q);
  const list = roll.called.filter(match), waiting = roll.waiting.filter(match);
  const waitRow = r => {
    const told = rinfoCovering(r.id, d)[0];
    const note = [roomName(r.roomId) + (r.bed ? '-' + r.bed : ''), told ? `${rinfoLabel(told.type)}${told.text ? ': ' + told.text : ''}` : ''].filter(Boolean).join(' · ');
    return `<div class="li"><span class="ic info">${ico('user')}</span><span class="body"><span class="t ell">${esc(r.name)}</span><span class="d">${esc(note)}</span></span>
      <span class="end">${paToggle(r.id, d, pk, null, future)}</span></div>`;
  };
  const row = r => {
    const absent = attAbsentOn(r.id, d, pk);
    // if they told the owner they would be away, say so instead of making him remember
    const told = rinfoCovering(r.id, d)[0];
    const note = [roomName(r.roomId) + (r.bed ? '-' + r.bed : ''), told ? `${rinfoLabel(told.type)}${told.text ? ': ' + told.text : ''}` : ''].filter(Boolean).join(' · ');
    return `<div class="li ${ui.justCalled === r.id + d + pk ? 'just' : ''}"><span class="ic ${absent ? 'bad' : 'ok'}">${ico(absent ? 'x' : 'check')}</span>
      <span class="body"><span class="t ell">${esc(r.name)}</span><span class="d">${esc(note)}</span></span>
      <span class="end">${paToggle(r.id, d, pk, absent ? 'a' : 'p', future)}${roll.legacy ? '' : btn('', 'rcallundo', `data-id="${r.id}" data-d="${d}" data-p="${pk}" aria-label="${esc(t('Call again'))}" title="${esc(t('Move back to waiting'))}"`, 'sm ghost', 'back')}</span></div>`;
  };
  const exportBtn = btn('Export', 'attexport', '', 'sm', 'download');
  return `${head('Attendance', '')}
    ${seg('att', [['roll', 'Roll call'], ['month', 'This month']], 'roll')}
    <div class="attnav">
      ${btn('', 'attday', `data-d="${addDays(d, -1)}" aria-label="${esc(t('Previous day'))}"`, '', 'back')}
      <div><b>${esc(fmtDate(d))}</b><span>${d === today() ? esc(t('Today')) : `<button type="button" class="pillbtn" data-act="attday" data-d="${today()}">${esc(t('Today'))}</button>`}</span></div>
      ${btn('', 'attday', `data-d="${addDays(d, 1)}" aria-label="${esc(t('Next day'))}"`, '', 'chev')}
    </div>
    <div class="group-t" style="margin-top:2px">${esc(t('Roll call'))}</div>
    <div class="attsel" role="tablist">${ps.map(p => `<button type="button" role="tab" class="${p.k === pk ? 'on' : ''}" aria-selected="${p.k === pk}" data-act="flt" data-key="attp" data-v="${p.k}"><b>${esc(t(p.l))}</b>${p.time ? `<small>${fmtTime(p.time)}</small>` : ''}</button>`).join('')}</div>
    <div class="pstats">
      ${kpi('Waiting', roll.waiting.length, t('not called yet'), roll.waiting.length ? 'warn' : 'ok')}
      ${kpi('Present', roll.called.length - roll.absent, t('of {n} living here', { n: roll.total }), 'ok')}
      ${kpi('Absent', roll.absent, roll.absent ? t('{n} people', { n: roll.absent }) : t('everyone is in'), roll.absent ? 'bad' : '')}
    </div>
    ${future ? `<div class="note">${esc(t('This day has not happened yet.'))}</div>` : ''}
    <div class="tool">${searchBox('att', 'Search name or room')}<span class="sp"></span>${exportBtn}</div>
    ${waiting.length && !future ? `<div class="tool">${btn(t('Mark all {n} waiting as present', { n: waiting.length }), 'rcallrest', `data-d="${d}" data-p="${pk}"`, 'ok block', 'check')}</div>` : ''}${roll.absent && !future ? `<div class="tool">${btn('All present', 'attclear', `data-d="${d}" data-p="${pk}"`, 'ok block', 'check')}</div>` : ''}
    ${waiting.length && !future ? `<div class="group-t">${esc(t('Waiting to be called'))} · ${waiting.length}</div><div class="group">${waiting.map(waitRow).join('')}</div>` : ''}
    <div class="group-t">${esc(t('Already called'))} · ${list.length}</div>
    ${list.length ? `<div class="group">${list.map(row).join('')}</div>` : `<div class="card">${empty(waiting.length ? 'Nobody called yet' : 'Nobody found', waiting.length ? 'Residents move here as soon as you mark them present or absent.' : 'Try another search.')}</div>`}
    ${about('Everyone counts as present. Switch off only the people who are not here.')}`;
}

function attMonthView() {
  const ym = attMonthSel(), ps = attPeriods();
  const list = activeRes().filter(r => r.checkIn <= `${ym}-31`).sort(by('name'));
  const rows = list.map(r => ({ r, m: attMonth(r.id, ym) }));
  const absentTotal = sum(rows, x => x.m.absent);
  const next = addMonths(ym, 1), cur = ymOf(today());
  const perfect = rows.filter(x => !x.m.absent).length;
  return `${head('Attendance', '')}
    ${seg('att', [['roll', 'Roll call'], ['month', 'This month']], 'roll')}
    ${monthBar(ym, 'attmon')}
    <div class="pstats">${kpi('Absences', absentTotal, fmtYM(ym), absentTotal ? 'warn' : 'ok')}${kpi('Full attendance', perfect, t('of {n} residents', { n: rows.length }), 'ok')}</div>
    <div class="tool"><span class="muted sm">${esc(t('{n} residents', { n: rows.length }))}</span><span class="sp"></span>${btn('Export', 'attexport', '', 'sm', 'download')}</div>
    ${rows.length ? `<div class="group">${rows.map(x => prow({
      lead: avatar(x.r.name), t: can('residents') ? `<button class="linkish" data-act="go" data-to="residents/${x.r.id}">${esc(x.r.name)}</button>` : esc(x.r.name), s: esc(`${t('Room')} ${roomName(x.r.roomId)} · ${t('Present')} ${x.m.present}`),
      tags: x.m.absentDays.length ? `<span class="gate-t">${esc(t('Absent on'))}</span>${x.m.absentDays.map(d => `<span class="daychip">${esc(d)}</span>`).join('')}` : '',
      amt: x.m.absent ? String(x.m.absent) : '✓', mc: x.m.absent ? 'bad-t' : 'ok-t', ms: x.m.absent ? t('absent') : t('all present')
    })).join('')}</div>` : `<div class="card">${empty('Nobody was living here in this month')}</div>`}
    ${ps.length > 1 ? `${about('A day counts as absent if the resident missed any roll call that day.')}` : ''}`;
}

A.attday = el => { ui.attd = el.dataset.d; render(); };
// Marking a resident: the row turns green (red for absent) with a tick, holds for a moment, then slides into "Already called".
function rcallConfirm(el, absent) {
  const id = el.dataset.id, d = el.dataset.d, pk = el.dataset.p, row = el.closest('.li');
  const go_ = () => { rcallMark(id, d, pk, absent); ui.justCalled = id + d + pk; haptic(); render(); setTimeout(() => { ui.justCalled = null; }, 2200); };
  if (!row || row.classList.contains('conf-ok') || row.classList.contains('conf-bad')) return go_();
  row.classList.add(absent ? 'conf-bad' : 'conf-ok');
  row.querySelectorAll('button').forEach(x => { x.disabled = true; });
  setTimeout(go_, 650);
}
A.rcallp = el => rcallConfirm(el, false);
A.rcalla = el => rcallConfirm(el, true);
A.rcallundo = el => { rcallUndo(el.dataset.id, el.dataset.d, el.dataset.p); render(); };
A.rcallrest = el => {
  const d = el.dataset.d, pk = el.dataset.p, w = attRollCall(d, pk).waiting;
  confirmBox(t('Mark all {n} waiting residents as present?', { n: w.length }), () => { w.forEach(r => rcallMark(r.id, d, pk, false)); toast('Done'); }, 'Mark present', 'ok');
};
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
  rcallMark(id, e.target.dataset.d, e.target.dataset.p, !e.target.checked);
  haptic();
  render();
});
