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
        <div class="cook-grid">${mealsOn(date).map(m => {
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
      const cyc = menuCycle(), curWk = menuWeekNo(today()), selW = Math.min(cyc, +ui.flt.menuw || curWk), viewingNow = selW === curWk;
      const w = menuWeekData(menuDoc(), selW);
      const order = [1, 2, 3, 4, 5, 6, 0], todayD = viewingNow ? new Date().getDay() : -1, msAll = meals();
      const nowT = new Date().toTimeString().slice(0, 5);
      const defMeal = (msAll.find(m => m.time >= nowT) || msAll[msAll.length - 1] || {}).k;
      const selM = ui.flt.menum === 'all' ? 'all' : (msAll.some(m => m.k === ui.flt.menum) ? ui.flt.menum : defMeal);
      const dishesOf = (d, mk) => (!mealServedDay(d, mk) ? [] : ((w[d] || {})[mk] || []).map(id => Store.get(id)).filter(Boolean));
      const dayBtn = d => `<button type="button" class="mn-dayset" data-act="mealday" data-day="${d}" aria-label="${esc(t('Meals and timings for {d}', { d: DAYS()[d] }))}" title="${esc(t('Meals and timings for {d}', { d: DAYS()[d] }))}">${ico('clock', 'xs')}</button>`;
      const chipsOf = ds => ds.map(x => `<span class="mn-dt ${x.unavailable ? 'bad' : ''}">${esc(x.name)}</span>`).join('');
      const picker = `<div class="chips mn-meals-pick">${msAll.map(m => `<button class="chip ${selM === m.k ? 'on' : ''}" data-act="setflt" data-k="menum" data-v="${m.k}">${esc(mealName(m.k))} <small>${fmtTime(m.time)}</small></button>`).join('')}<button class="chip ${selM === 'all' ? 'on' : ''}" data-act="setflt" data-k="menum" data-v="all">${esc(t('All meals'))}</button></div>`;
      let view;
      if (selM === 'all') {
        const cell = (d, mk) => { if (!mealServedDay(d, mk)) return `<div class="c off"><span class="mn-add muted">${esc(t('Not served'))}</span></div>`; const ds = dishesOf(d, mk), tm = mealDayCfg(d, mk).time; return `<button class="c ${d === todayD ? 'today' : ''} ${ds.length ? '' : 'empty'}" data-act="menucell" data-week="${selW}" data-day="${d}" data-meal="${mk}" aria-label="${esc(DAYS()[d])} ${esc(mealName(mk))}">${tm ? `<small class="mn-time">${esc(fmtTime(tm))}</small>` : ''}${ds.length ? chipsOf(ds) : `<span class="mn-add">+ ${esc(t('Add'))}</span>`}</button>`; };
        view = `<div class="scroll-x"><div class="mgrid" style="--cols:${msAll.length};min-width:${88 + msAll.length * 150}px"><div class="corner"></div>${msAll.map(m => `<div class="h">${esc(mealName(m.k))}<span>${fmtTime(m.time)}</span></div>`).join('')}
          ${order.map(d => `<div class="d ${d === todayD ? 'today' : ''}"><b>${esc(DAYS()[d].slice(0, 3))}</b>${d === todayD ? `<small>${esc(t('Today'))}</small>` : ''}${dayBtn(d)}</div>${msAll.map(m => cell(d, m.k)).join('')}`).join('')}</div></div>`;
      } else {
        const planned = order.filter(d => dishesOf(d, selM).length).length, monday = addDays(today(), -((todayD + 6) % 7)), dateNo = d => +addDays(monday, (d + 6) % 7).slice(8);
        view = `<div class="mw-head"><div class="mw-title"><span class="mw-ic">${ico('utensils', 'sm')}</span><div><b>${esc(mealName(selM))}</b><span class="muted">${fmtTime(mealByKey(selM).time)}</span></div></div><span class="badge ${planned === 7 ? 'ok' : 'warn'}">${esc(t('{n} of 7 days planned', { n: planned }))}</span></div>
          <div class="mw-list">${order.map(d => { if (!mealServedDay(d, selM)) return `<div class="mw-row off"><span class="mw-main" style="opacity:.55"><span class="mw-day"><b>${esc(DAYS()[d].slice(0, 3))}</b></span><span class="mw-dishes muted">${esc(t('Not served'))}</span></span>${dayBtn(d)}</div>`; const ds = dishesOf(d, selM); return `<div class="mw-row ${d === todayD ? 'today' : ''}">
            <button type="button" class="mw-main" data-act="menucell" data-week="${selW}" data-day="${d}" data-meal="${selM}" aria-label="${esc(DAYS()[d])} ${esc(mealName(selM))}"><span class="mw-day"><b>${esc(DAYS()[d].slice(0, 3))}</b>${viewingNow ? `<i>${dateNo(d)}</i>` : ''}</span><span class="mw-dishes">${ds.length ? chipsOf(ds) : `<span class="mn-add">+ ${esc(t('Add dishes'))}</span>`}</span><span class="mw-edit">${ico(ds.length ? 'edit' : 'plus', 'sm')}</span></button>${dayBtn(d)}
</div>`; }).join('')}</div>`;
      }
      const weekEmpty = !order.some(d => msAll.some(m => dishesOf(d, m.k).length));
      const rot = `<div class="mn-rot"><div class="mn-rot-l"><b>${esc(t('Menu repeats every'))}</b><span class="muted xs">${esc(cyc === 1 ? t('Same menu every week') : t('Week {a} of {b} is running now', { a: curWk, b: cyc }))}</span></div>
        ${isAdmin() ? `<select class="hsel" data-menucycle aria-label="${esc(t('Weeks in the menu cycle'))}">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${n === cyc ? 'selected' : ''}>${n === 1 ? esc(t('1 week')) : esc(t('{n} weeks', { n }))}</option>`).join('')}</select>` : ''}</div>`;
      const wkTabs = cyc > 1 ? `<div class="chips mn-weeks">${[...Array(cyc)].map((_, i) => `<button class="chip ${selW === i + 1 ? 'on' : ''}" data-act="setflt" data-k="menuw" data-v="${i + 1}">${esc(t('Week {n}', { n: i + 1 }))}${curWk === i + 1 ? ` <small>${esc(t('this week'))}</small>` : ''}</button>`).join('')}</div>` : '';
      const copyNote = cyc > 1 && selW > 1 && weekEmpty && isAdmin() ? `<div class="note" style="margin-bottom:10px">${esc(t('Week {n} has no dishes yet.', { n: selW }))} <button class="btn sm" data-act="menucopy" data-week="${selW}">${esc(t('Copy Week 1 here'))}</button></div>` : '';
      body = `${about('Choose how many weeks the menu repeats over. Pick a week, then tap a day to choose its dishes: any dish can be used in any meal. Residents see the running week in their app.')}${rot}${wkTabs}${copyNote}${picker}${view}`;
    } else if (tab === 'dishes' && showDishes) {
      body = `<div class="tool">${searchBox('dish', 'Search dish')}<span class="sp"></span><div class="tool-actions">${btn('Replace ingredient', 'replaceing', '', '', 'repeat')}${btn('Dish library', 'dishlib', '', '', 'search')}${btn('Add dish', 'adddish', '', 'primary', 'plus')}</div></div>
        ${(() => { const seen = {}; dishes().forEach(x => { const k = x.name.trim().toLowerCase(); seen[k] = (seen[k] || 0) + 1; }); window.__dupDish = seen; return ''; })()}${group('', dishes().filter(d => needle('dish', d.name)).map(d => li({ icon: 'utensils', ic: d.unavailable ? 'bad' : 'warn', t: d.name + (d.unavailable ? ` · ${t('Unavailable')}` : ''), d: `${(d.ings || []).map(g => `${(itemById(g.itemId) || {}).name || '?'} ${num(g.qty)}${(itemById(g.itemId) || {}).unit || ''}`).join(', ')} · ${t('for {n} people', { n: d.serves })}${d.unavailable ? ` · <span class="bad-t">${t('Needs ingredient')} ${esc(d.missingItem || '')}</span>` : ''}`, act: 'editdish', attrs: `data-id="${d.id}"`, end: d.unavailable ? btn('Substitute', 'replaceing', `data-id="${(d.ings && d.ings[0] && d.ings[0].itemId) || ''}"`, 'sm warn') : ((window.__dupDish || {})[d.name.trim().toLowerCase()] > 1 ? badge('Duplicate name', 'warn') : '') })).join(''), t('Ingredient quantities are for the number of people you cook for. The system works out per-person needs and learns your real usage.'))}`;
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
    if (q && !x.name.toLowerCase().includes(q)) return false;
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
    meals: meals().filter(m => mealServedDay(e.day, m.k) || e.meals.includes(m.k)).map(m => `<button type="button" class="md-day wide ${e.meals.includes(m.k) ? 'on' : ''}" data-act="mdmeal" data-m="${m.k}">${esc(mealName(m.k))}</button>`).join(''),
  };
}
function mdUpdate() {
  const p = mdParts(), set = (id, h) => { const el = document.getElementById(id); if (el) el.innerHTML = h; };
  set('mdSel', p.sel); set('mdList', p.list); set('mdDays', p.days); set('mdMeals', p.meals);
  const n = document.getElementById('mdCount'); if (n) n.textContent = ui.menuEd.sel.length;
}
A.menucell = el => {
  const d = +el.dataset.day, m = el.dataset.meal, wk = +el.dataset.week || 1, cur = ((menuWeekData(menuDoc(), wk)[d] || {})[m]) || [];
  ui.menuEd = { day: d, meal: m, meals: [m], week: wk, sel: [...cur], days: [d], q: '' };
  const p = mdParts();
  openModal({
    title: `${menuCycle() > 1 ? t('Week {n}', { n: wk }) + ' · ' : ''}${DAYS()[d]} · ${mealName(m)}`, cls: 'md',
    body: `<div class="md-meal">${esc(mealName(m))} <span>${fmtTime(mealByKey(m).time)}</span></div>
      <div class="md-h">${esc(t('Chosen'))} · <b id="mdCount">${cur.length}</b></div><div class="md-sel" id="mdSel">${p.sel}</div>
      <div class="md-search">${ico('search', 'sm')}<input id="mdq" type="search" placeholder="${esc(t('Search dishes'))}" autocomplete="off"></div>
      <div class="md-list" id="mdList">${p.list}</div>
      ${can('kitchen') ? `<div class="md-new"><a href="#" data-act="adddish">+ ${esc(t('Add a new dish'))}</a></div>` : ''}
      <div class="md-h">${esc(t('Use in meals'))}</div><div class="md-days" id="mdMeals">${p.meals}</div>
      <div class="md-h">${esc(t('Apply to'))}</div><div class="md-days" id="mdDays">${p.days}</div>
      <div class="md-presets"><button type="button" data-act="mdpreset" data-p="one">${esc(t('Only this day'))}</button><button type="button" data-act="mdpreset" data-p="week">${esc(t('Weekdays'))}</button><button type="button" data-act="mdpreset" data-p="end">${esc(t('Weekend'))}</button><button type="button" data-act="mdpreset" data-p="all">${esc(t('Every day'))}</button></div>`,
    foot: `<button class="btn" data-act="close">${esc(t('Cancel'))}</button><button class="btn primary" style="flex:1" data-act="mdsave">${ico('check', 'sm')} ${esc(t('Save menu'))}</button>`,
  });
};
A.mdtoggle = el => { const e = ui.menuEd; if (!e) return; const id = el.dataset.id, i = e.sel.indexOf(id); if (i >= 0) e.sel.splice(i, 1); else e.sel.push(id); haptic(); mdUpdate(); };
A.mdday = el => { const e = ui.menuEd; if (!e) return; const d = +el.dataset.d, i = e.days.indexOf(d); if (i >= 0) { if (e.days.length > 1) e.days.splice(i, 1); } else e.days.push(d); mdUpdate(); };
// One weekday: which meals are served and at what time. Other days keep their own settings.
A.mealday = el => {
  if (!isAdmin()) return toast(t('Only the owner or manager can change meal timings'), 'warn');
  const day = +el.dataset.day, ms = meals();
  const apply = async cfg => { await Store.saveSettings({ mealDays: { [day]: cfg } }); toast(t('{d}: meals saved', { d: DAYS()[day] })); render(); };
  formModal({
    title: `${DAYS()[day]} · ${t('Meals and timings')}`, submit: 'Save',
    note: t('Change only this day. Other days keep their own timings. Switch a meal off if it is not served on this day.'),
    fields: ms.flatMap(m => [
      { name: 'on_' + m.k, label: `${mealName(m.k)} is served`, type: 'checkbox', value: mealServedDay(day, m.k), full: true },
      { name: 'tm_' + m.k, label: `${mealName(m.k)} time`, type: 'time', value: mealTimeDay(day, m.k), hint: t('Usual time: {t}', { t: fmtTime(m.time) }) },
    ]),
    danger: { label: 'Reset day', run: () => confirmBox(t('Use the usual meals and timings for {d}?', { d: DAYS()[day] }), () => apply(Object.fromEntries(ms.map(m => [m.k, { off: false, time: '' }]))), 'Reset') },
    onSubmit: async v => { await apply(Object.fromEntries(ms.map(m => { const tm = v['tm_' + m.k]; return [m.k, { off: !v['on_' + m.k], time: tm && tm !== m.time ? tm : '' }]; }))); },
  });
};
A.mdmeal = el => { const e = ui.menuEd; if (!e) return; const m = el.dataset.m, i = e.meals.indexOf(m); if (i >= 0) { if (e.meals.length > 1) e.meals.splice(i, 1); } else e.meals.push(m); mdUpdate(); };
A.mdpreset = el => { const e = ui.menuEd; if (!e) return; e.days = { one: [e.day], week: [1, 2, 3, 4, 5], end: [6, 0], all: [...MD_DAYS] }[el.dataset.p] || [e.day]; mdUpdate(); };
A.mdsave = () => {
  const e = ui.menuEd; if (!e) return;
  const doc = clone(menuDoc()), data = clone(menuWeekData(doc, e.week));
  for (const d of e.days) for (const m of e.meals) { data[d] = data[d] || {}; data[d][m] = [...e.sel]; }
  if (e.week === 1) doc.week = data; else doc.weeks = { ...(doc.weeks || {}), [e.week]: data };
  Store.put('menu', { ...doc, id: 'menu' });
  closeModal(); toast(t('Menu saved for {n} day(s)', { n: e.days.length * e.meals.length })); render();
};
// How many weeks the menu repeats over. The first time it goes above 1, this week becomes Week 1.
document.addEventListener('change', ev => {
  const el = ev.target; if (!el || !el.hasAttribute || !el.hasAttribute('data-menucycle')) return;
  const n = Math.min(5, Math.max(1, +el.value || 1)), doc = clone(menuDoc());
  doc.cycle = n; if (n > 1 && !doc.anchor) doc.anchor = mondayOf(today());
  Store.put('menu', { ...doc, id: 'menu' });
  if ((+ui.flt.menuw || 1) > n) ui.flt.menuw = String(n);
  toast(n === 1 ? t('Same menu every week') : t('Menu now repeats every {n} weeks', { n })); render();
});
A.menucopy = el => {
  const wk = +el.dataset.week, doc = clone(menuDoc());
  doc.weeks = { ...(doc.weeks || {}), [wk]: clone(doc.week || {}) };
  Store.put('menu', { ...doc, id: 'menu' }); toast(t('Week 1 copied to Week {n}', { n: wk })); render();
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
function dishForm(x, preset) {
  const d = x || { ings: [], serves: 10, meal: 'any' };
  const rows = d.ings.length ? d.ings : [{}, {}, {}];
  Suggest.sources.stock = () => items().filter(i => i.active !== false && i.status !== 'inactive').map(i => ({ v: i.name, sub: i.unit || '' })).sort((a, b) => a.v.localeCompare(b.v));
  const rowHtml = (g, i) => `<div class="ingrow"><span class="sg"><input data-suggest="stock" name="ing_${i}" class="ing-n" aria-label="${esc(t('Ingredient'))} ${i + 1}" placeholder="${esc(t('Ingredient name, e.g. Paneer'))}" value="${esc(g.itemId ? (itemById(g.itemId) || {}).name || '' : (g.name || ''))}" autocomplete="off" autocorrect="off" spellcheck="false" aria-autocomplete="list"><button type="button" class="sg-btn" tabindex="-1" aria-label="${esc(t('Show list'))}">${ico('chev2', 'sm')}</button></span>
    <div class="ing-q"><input name="qty_${i}" aria-label="${esc(t('Qty'))} ${i + 1}" type="number" step="0.01" min="0" inputmode="decimal" placeholder="${esc(t('Qty'))}" value="${g.qty ?? ''}"><select name="unit_${i}" aria-label="${esc(t('Unit'))} ${i + 1}">${S().units.map(u => `<option ${((itemById(g.itemId) || {}).unit || g.unit || 'kg') === u ? 'selected' : ''}>${u}</option>`).join('')}</select><button type="button" class="ing-x" data-act="ingdel" aria-label="${esc(t('Remove this ingredient'))}" title="${esc(t('Remove'))}">${ico('x', 'sm')}</button></div></div>`;
  const dishF = formModal({
    title: x ? 'Edit dish' : 'Add dish', wide: true,
    fields: [
      { name: 'name', label: 'Dish name', value: d.name, required: true, maxlength: 60 },
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
        let it = items().find(z => z.name.toLowerCase() === name.toLowerCase()) || (ING_HI[name.replace(/ \(.*\)$/, '')] ? stockByName(name.replace(/ \(.*\)$/, '')) : null);
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
      Store.put('dish', { ...d, id: d.id || `dish-${slug(v.name)}-${uid()}`, name: String(v.name || '').replace(/\s+/g, ' ').trim(), meal: d.meal || 'any', serves: v.serves, ings });
      toast('Dish saved');
    },
  });
  // New dish: type or pick a name from the library and the ingredients for that many people appear (still editable).
  if (!x) {
    const nameEl = dishF.elements.name, servesEl = dishF.elements.serves, box = $('#ings');
    Suggest.sources.dishlib = dishLibSuggest;
    nameEl.dataset.suggest = 'dishlib'; nameEl.dataset.suggestMax = '40'; nameEl.dataset.suggestNoNew = '1'; nameEl.setAttribute('autocomplete', 'off');
    const note = document.createElement('div'); note.className = 'hint'; note.style.margin = '0 0 8px'; box.parentElement.insertBefore(note, box.parentElement.firstChild);
    const blank = () => ![...$$('.ingrow', box)].some(r => r.querySelector('input[name^="qty_"]').value || r.querySelector('input[name^="ing_"]').value);
    const autoFill = () => {
      const e = dishLibFind(nameEl.value); if (!e) { if (box.dataset.auto === '1' && !nameEl.value.trim()) note.textContent = ''; return; }
      if (!(blank() || box.dataset.auto === '1')) return;
      box.innerHTML = dishLibRows(e, +servesEl.value || 1).map(rowHtml).join(''); box.dataset.auto = '1';
      $$('.ing-n', box).forEach(inp => inp.dispatchEvent(new Event('input', { bubbles: true })));
      note.textContent = t('Ingredients filled in for {n} people. Change anything you like.', { n: +servesEl.value || 1 });
    };
    nameEl.addEventListener('input', autoFill); nameEl.addEventListener('change', autoFill);
    if (preset) { nameEl.value = preset; autoFill(); }
    servesEl.addEventListener('input', () => { if (box.dataset.auto === '1') autoFill(); });
    box.addEventListener('input', ev => { if (ev.isTrusted && ev.target.name && /^(qty|ing)_/.test(ev.target.name)) { box.dataset.auto = ''; } });
  }
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
// Browse the whole dish library by type, search it, tap a dish to add it (its ingredients are filled in for you).
const DL_CATS = () => ['All', ...[...new Set(DISH_LIB.map(d => d.cat))].sort()];
function dlList() {
  const e = ui.dlib || (ui.dlib = { q: '', cat: 'All', n: 40 }), q = e.q.trim().toLowerCase(), have = new Set(dishes().map(x => String(x.name).trim().toLowerCase()));
  const all = DISH_LIB.filter(d => (e.cat === 'All' || d.cat === e.cat) && (!q || d.name.toLowerCase().includes(q)));
  const show = all.slice(0, e.n);
  return `<div class="xs muted" style="margin:0 2px 6px">${esc(t('{n} dishes', { n: all.length }))}</div><div class="group">${show.map(d => li({ icon: 'utensils', ic: have.has(d.name.toLowerCase()) ? 'ok' : 'warn', t: d.name, d: `${d.cat} · ${d.ings.slice(0, 4).map(g => g[0]).join(', ')}${d.ings.length > 4 ? '…' : ''}`, end: have.has(d.name.toLowerCase()) ? badge('Added', 'ok') : '', act: have.has(d.name.toLowerCase()) ? '' : 'dlpick', attrs: `data-name="${esc(d.name)}"`, chev: false })).join('') || `<div class="li noic"><span class="body muted">${esc(t('No dish found'))}</span></div>`}</div>${all.length > e.n ? `<button class="btn sm ghost block" data-act="dlmore">${esc(t('Show more'))}</button>` : ''}`;
}
function dlRefresh() { const el = document.getElementById('dlList'); if (el) el.innerHTML = dlList(); }
A.dishlib = () => {
  if (!can('kitchen')) return toast(t('Stock & purchase module is disabled'), 'warn');
  ui.dlib = { q: '', cat: 'All', n: 40 };
  openModal({ title: t('Dish library'), cls: 'md', body: `<div class="md-search">${ico('search', 'sm')}<input id="dlq" type="search" placeholder="${esc(t('Search dishes'))}" autocomplete="off"></div>
    <div class="chips" id="dlCats" style="margin:8px 0;overflow-x:auto;flex-wrap:nowrap">${DL_CATS().map(c => `<button class="chip ${c === 'All' ? 'on' : ''}" data-act="dlcat" data-c="${esc(c)}" style="flex:none">${esc(c)}</button>`).join('')}</div><div id="dlList">${dlList()}</div>`,
    foot: `<button class="btn block" data-act="close">${esc(t('Close'))}</button>` });
};
A.dlcat = el => { ui.dlib.cat = el.dataset.c; ui.dlib.n = 40; $$('#dlCats .chip').forEach(b => b.classList.toggle('on', b.dataset.c === el.dataset.c)); dlRefresh(); };
A.dlmore = () => { ui.dlib.n += 40; dlRefresh(); };
A.dlpick = el => { closeModal(true); dishForm(null, el.dataset.name); };
let _dlT = null;
document.addEventListener('input', ev => { if (ev.target && ev.target.id === 'dlq' && ui.dlib) { const val = ev.target.value; clearTimeout(_dlT); _dlT = setTimeout(() => { ui.dlib.q = val; ui.dlib.n = 40; dlRefresh(); }, 150); } });
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
  // A select changed by code does not fire 'change' by itself, so the picker button keeps showing the old name.
  // setStaff() sets the value AND repaints the picker, so what you see is always what will be saved.
  const setStaff = (sel, val) => { if (!sel) return; sel.value = val || ''; const w = sel.closest('.pk'); if (w) Picker.paint(w); };
  // The whole-floor box shows the staff member when every ticked room of that floor has the same one.
  const syncFloors = () => $$('select[data-floorstaff]', form).forEach(fsel => {
    const ticked = $$(`input[name="room"][data-fl="${CSS.escape(fsel.dataset.floorstaff)}"]:checked`, form);
    const vals = [...new Set(ticked.map(x => form.elements['as_' + x.value].value))];
    setStaff(fsel, vals.length === 1 ? vals[0] : '');
  });
  form.addEventListener('change', e => {
    const fl = e.target.dataset.floor, fst = e.target.dataset.floorstaff;
    if (fl != null) $$(`input[data-fl="${CSS.escape(fl)}"]`, form).forEach(x => { x.checked = e.target.checked; });
    if (fst != null && e.target.value) $$(`input[data-fl="${CSS.escape(fst)}"]`, form).forEach(x => { x.checked = true; setStaff(form.elements['as_' + x.value], e.target.value); });
    if (fl != null || fst != null || (e.target.name || '').startsWith('as_') || e.target.name === 'room') syncFloors();
  });
  syncFloors();
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
      if (!/^[0-9]{10}$/.test(ph)) return t('Mobile must be a 10-digit mobile number.');
      if (staffList().some(z => z.id !== s.id && phone10(z.phone) === ph)) return t('A staff member with this mobile number already exists');
      const aad = String(v.idNo || '').replace(/[^0-9]/g, '');
      if (aad.length !== 12) return t('Aadhaar number must be exactly 12 digits');
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


/* ===================================================================== dish library
 * Everyday hostel dishes with the raw quantity PER PERSON of every ingredient, spices listed one by one (turmeric, chilli powder,
 * coriander, cumin ...). Moderate oil and masala, plain hostel cooking. One standard entry per dish; no near-duplicates.
 * Picking a name in "Add dish" fills the ingredients for the number of people typed; everything stays editable.
 * Quantities are sensible starting points (kg / L / pcs per person), not a promise: the real usage is learned from purchases. */
const ING_UNIT = (() => {
  const u = {};
  const put = (unit, names) => names.split('|').forEach(n => { u[n.trim()] = unit; });
  put('kg', 'Rice|Atta|Maida|Besan|Suji|Poha|Sabudana|Vermicelli|Macaroni|Spaghetti|Noodles|Oats|Daliya|Bajra flour|Jowar flour|Makki flour|Ragi flour|Sattu|Rice flour|Murmura|Cornflour|Corn flakes|Toor dal|Moong dal|Chana dal|Urad dal|Masoor dal|Rajma|Chole|Kala chana|Moong (whole)|Lobia|Soya chunks|Matar dry|Ghee|Butter|Curd|Paneer|Cheese|Cream|Sugar|Jaggery|Tea leaves|Coffee|Chicken|Mutton|Fish|Prawns|Onion|Tomato|Potato|Green chilli|Ginger|Garlic|Coriander leaves|Mint leaves|Curry leaves|Cauliflower|Cabbage|Peas|Brinjal|Lady finger|Bottle gourd|Ridge gourd|Pumpkin|Spinach|Methi|Carrot|Beans|Capsicum|Mushroom|Bitter gourd|Colocasia|Raw banana|Sweet potato|Radish|Beetroot|Cucumber|Corn|Mixed vegetables|Sarson leaves|Drumstick|Tinda|Cluster beans|Kundru|Parwal|Jackfruit|Snake gourd|Yam|Lotus stem|Baby corn|Broccoli|Turnip|Raw papaya|Bathua|Raw mango|Spring onion|Cumin seeds|Mustard seeds|Fennel seeds|Ajwain|Kalonji|Sesame seeds|Poppy seeds|Fenugreek seeds|Turmeric|Red chilli powder|Dry red chilli|Coriander powder|Garam masala|Black pepper|Hing|Cardamom|Cloves|Cinnamon|Bay leaf|Kasuri methi|Chaat masala|Amchur|Sambar powder|Rasam powder|Pav bhaji masala|Chole masala|Biryani masala|Tandoori masala|Kitchen king masala|Salt|Black salt|Tamarind|Coconut|Peanuts|Cashew|Almonds|Raisins|Dry fruits|Pickle|Ketchup|Soy sauce|Vinegar|Chilli sauce|Khoya|Sev|Namkeen|Baking soda|Yeast|Gram flour batter|Custard powder|Cocoa|Khus khus|Tomato puree|Mayonnaise|Pizza base flour|Gelatin|Jelly crystals|Vanilla essence|Rose syrup|Saffron|Edible gum|Dalia|Makhana|Dates|Fig|Honey|Chocolate|Rabri|Cottage cheese filling|Kewra water');
  put('L', 'Oil|Milk|Water (extra)|Coconut milk|Buttermilk');
  put('pcs', 'Eggs|Lemon|Banana|Papad|Bread|Pav|Bun|Roti (ready)|Pizza base|Tortilla|Apple|Orange|Mango|Papaya (fruit)|Watermelon slice|Kulfi stick');
  return u;
})();
const SPICES = {
  dry: [['Cumin seeds', .0007], ['Turmeric', .0005], ['Red chilli powder', .0007], ['Coriander powder', .0012], ['Amchur', .0004], ['Salt', .003]],
  gravy: [['Cumin seeds', .0007], ['Turmeric', .0006], ['Red chilli powder', .0009], ['Coriander powder', .0015], ['Garam masala', .0005], ['Ginger', .003], ['Garlic', .003], ['Green chilli', .002], ['Salt', .003]],
  rich: [['Cumin seeds', .0006], ['Turmeric', .0005], ['Red chilli powder', .0008], ['Coriander powder', .0012], ['Garam masala', .0006], ['Kasuri methi', .0004], ['Cardamom', .0001], ['Ginger', .003], ['Garlic', .003], ['Salt', .003]],
  dal: [['Cumin seeds', .0007], ['Turmeric', .0005], ['Red chilli powder', .0006], ['Hing', .00005], ['Garlic', .003], ['Green chilli', .002], ['Dry red chilli', .0005], ['Coriander leaves', .003], ['Salt', .003]],
  nonveg: [['Cumin seeds', .0006], ['Turmeric', .0007], ['Red chilli powder', .0012], ['Coriander powder', .002], ['Garam masala', .001], ['Black pepper', .0003], ['Cardamom', .0002], ['Cloves', .0002], ['Cinnamon', .0003], ['Bay leaf', .0001], ['Ginger', .005], ['Garlic', .005], ['Green chilli', .003], ['Salt', .004]],
  south: [['Mustard seeds', .0006], ['Curry leaves', .002], ['Hing', .00005], ['Turmeric', .0005], ['Red chilli powder', .0007], ['Dry red chilli', .0005], ['Salt', .003]],
  sambar: [['Mustard seeds', .0006], ['Curry leaves', .002], ['Hing', .00005], ['Turmeric', .0005], ['Sambar powder', .003], ['Dry red chilli', .0005], ['Tamarind', .005], ['Salt', .003]],
  rice: [['Cumin seeds', .0005], ['Bay leaf', .0001], ['Cloves', .0001], ['Cardamom', .0001], ['Cinnamon', .0002], ['Salt', .003]],
  biryani: [['Biryani masala', .002], ['Turmeric', .0004], ['Red chilli powder', .0008], ['Garam masala', .0006], ['Cardamom', .0002], ['Cloves', .0002], ['Cinnamon', .0003], ['Bay leaf', .0001], ['Mint leaves', .004], ['Ginger', .003], ['Garlic', .003], ['Salt', .004]],
  snack: [['Red chilli powder', .0006], ['Turmeric', .0003], ['Ajwain', .0004], ['Chaat masala', .0006], ['Salt', .002]],
  chaat: [['Chaat masala', .001], ['Black salt', .0005], ['Red chilli powder', .0003], ['Cumin seeds', .0003], ['Salt', .001]],
  chinese: [['Soy sauce', .005], ['Chilli sauce', .004], ['Vinegar', .002], ['Black pepper', .0003], ['Garlic', .004], ['Ginger', .003], ['Spring onion', .01], ['Salt', .002]],
  paratha: [['Ajwain', .0004], ['Red chilli powder', .0004], ['Coriander powder', .0006], ['Amchur', .0003], ['Salt', .002]],
  sweet: [['Cardamom', .0002]],
  breakfast: [['Mustard seeds', .0004], ['Turmeric', .0003], ['Curry leaves', .001], ['Green chilli', .002], ['Salt', .002]],
};
const spc = (k, m = 1) => SPICES[k].map(([n, q]) => [n, q * m]);
// profile used to break a lumped "Masala & spices" quantity (hand-written entries below) into the real spices
const SPLIT = { Dal: 'dal', Sabzi: 'gravy', Paneer: 'rich', Egg: 'gravy', 'Non-veg': 'nonveg', Rice: 'rice', Punjabi: 'rich' };
const DISH_LIB = (() => {
  const L = [], seen = new Set();
  const add = (name, cat, ings) => { name = name.replace(/\s+/g, ' ').trim(); const k = name.toLowerCase(); if (seen.has(k)) return; seen.add(k); const m = new Map(); ings.forEach(([n, q]) => { if (q > 0) m.set(n, (m.get(n) || 0) + q); }); L.push({ name, cat, ings: [...m].map(([n, q]) => [n, Math.round(q * 1e5) / 1e5]) }); };
  const mk = (name, cat, main, spice, o = {}) => add(name, cat, [...main, ...(o.onion === 0 ? [] : [['Onion', o.onion ?? .02]]), ...(o.tomato === 0 ? [] : [['Tomato', o.tomato ?? .02]]), ['Oil', o.oil ?? .01], ...spc(spice, o.sp ?? 1), ...(o.extra || [])]);
  const HN = { Potato: 'Aloo', Cauliflower: 'Gobhi', Cabbage: 'Patta Gobhi', Brinjal: 'Baingan', 'Lady finger': 'Bhindi', 'Bottle gourd': 'Lauki', 'Ridge gourd': 'Tori', Pumpkin: 'Kaddu', Spinach: 'Palak', Methi: 'Methi', Carrot: 'Gajar', Beans: 'Beans', Capsicum: 'Shimla Mirch', Mushroom: 'Mushroom', 'Bitter gourd': 'Karela', Colocasia: 'Arbi', 'Raw banana': 'Kachha Kela', 'Sweet potato': 'Shakarkandi', Radish: 'Mooli', Beetroot: 'Chukandar', Peas: 'Matar', Corn: 'Makka', Tinda: 'Tinda', 'Cluster beans': 'Gawar Phali', Kundru: 'Kundru', Parwal: 'Parwal', Jackfruit: 'Kathal', 'Snake gourd': 'Chichinda', Yam: 'Suran', 'Lotus stem': 'Kamal Kakdi', 'Baby corn': 'Baby Corn', Broccoli: 'Broccoli', Turnip: 'Shalgam', 'Raw papaya': 'Kachha Papita', Drumstick: 'Sahjan', Tomato: 'Tamatar', Onion: 'Pyaaz', Cucumber: 'Kheera', 'Soya chunks': 'Soya', 'Sarson leaves': 'Sarson', Bathua: 'Bathua', 'Mixed vegetables': 'Mix Veg' };
  const VQ = { Potato: .15, Cauliflower: .12, Cabbage: .12, Brinjal: .12, 'Lady finger': .12, 'Bottle gourd': .15, 'Ridge gourd': .12, Pumpkin: .15, Spinach: .15, Methi: .1, Carrot: .1, Beans: .1, Capsicum: .1, Mushroom: .1, 'Bitter gourd': .1, Colocasia: .12, 'Raw banana': .12, 'Sweet potato': .12, Radish: .12, Beetroot: .1, Peas: .08, Corn: .08, Tinda: .12, 'Cluster beans': .1, Kundru: .1, Parwal: .1, Jackfruit: .12, 'Snake gourd': .12, Yam: .12, 'Lotus stem': .1, 'Baby corn': .08, Broccoli: .1, Turnip: .12, 'Raw papaya': .12, Drumstick: .08, Tomato: .15, Cucumber: .1, 'Soya chunks': .03, 'Sarson leaves': .15, Bathua: .12 };
  const VEGS = Object.keys(VQ);
  // ---------------------------------------------------------------- sabzi: one vegetable
  VEGS.forEach(v => { if (v === 'Cucumber') return; const n = HN[v]; mk(`${n} Sabzi`, 'Sabzi', [[v, VQ[v]]], 'dry', { onion: v === 'Tomato' ? 0 : .02, tomato: v === 'Tomato' ? 0 : .015 }); });
  ['Potato', 'Cauliflower', 'Cabbage', 'Lady finger', 'Brinjal', 'Capsicum', 'Mushroom', 'Corn', 'Baby corn', 'Beans', 'Tinda', 'Parwal', 'Kundru', 'Soya chunks', 'Broccoli', 'Peas', 'Carrot', 'Lotus stem', 'Colocasia'].forEach(v => { if (v !== 'Potato') mk(`${HN[v]} Masala`, 'Sabzi', [[v, VQ[v]]], 'gravy', { onion: .035, tomato: .04, oil: .012 }); });
  ['Potato', 'Cauliflower', 'Cabbage', 'Lady finger', 'Brinjal', 'Capsicum', 'Colocasia', 'Bitter gourd', 'Raw banana', 'Sweet potato', 'Parwal', 'Kundru', 'Tinda', 'Baby corn', 'Mushroom', 'Lotus stem'].forEach(v => mk(`${HN[v]} Fry`, 'Sabzi', [[v, VQ[v]]], 'dry', { onion: .01, tomato: 0, oil: .018 }));
  ['Potato', 'Cauliflower', 'Lady finger', 'Brinjal', 'Capsicum', 'Tinda', 'Karela', 'Parwal', 'Bottle gourd'].forEach(n => { const v = Object.keys(HN).find(k => HN[k] === n || k === n); if (v && VQ[v]) mk(`Bharwa ${HN[v]}`, 'Sabzi', [[v, VQ[v]], ['Besan', .006]], 'gravy', { onion: .025, tomato: .02, oil: .015 }); });
  ['Potato', 'Cauliflower', 'Brinjal', 'Mushroom', 'Lady finger', 'Baby corn'].forEach(v => mk(`${HN[v]} Dum`, 'Sabzi', [[v, VQ[v]], ['Curd', .03]], 'rich', { onion: .03, tomato: .035, oil: .012 }));
  ['Potato', 'Cauliflower', 'Spinach', 'Lauki', 'Methi', 'Mushroom', 'Peas'].forEach(n => { const v = Object.keys(HN).find(k => HN[k] === n || k === n) || n; if (VQ[v] && n !== 'Potato') mk(`${HN[v]} Kofta`, 'Sabzi', [[v, .07], ['Besan', .025]], 'rich', { onion: .03, tomato: .04, oil: .02 }); });
  mk('Aloo Jeera', 'Sabzi', [['Potato', .15]], 'dry', { onion: 0, tomato: 0 }); mk('Dahi Aloo', 'Sabzi', [['Potato', .12], ['Curd', .05]], 'gravy', { onion: .02, tomato: .02 });
  mk('Mix Veg', 'Sabzi', [['Mixed vegetables', .14]], 'gravy', { onion: .025, tomato: .03 }); mk('Navratan Korma', 'Sabzi', [['Mixed vegetables', .12], ['Paneer', .015], ['Cream', .02], ['Dry fruits', .006]], 'rich', { onion: .03, tomato: .03 });
  mk('Veg Kolhapuri', 'Maharashtrian', [['Mixed vegetables', .13]], 'gravy', { onion: .04, tomato: .04, extra: [['Coconut', .01], ['Dry red chilli', .001]] });
  mk('Veg Jalfrezi', 'Sabzi', [['Mixed vegetables', .12], ['Capsicum', .03]], 'gravy', { onion: .03, tomato: .04 }); mk('Veg Handi', 'Sabzi', [['Mixed vegetables', .13], ['Curd', .03]], 'rich', { onion: .03, tomato: .04 });
  mk('Sabzi Do Pyaza', 'Sabzi', [['Mixed vegetables', .12], ['Onion', .05]], 'gravy', { onion: 0, tomato: .03 });
  // ---------------------------------------------------------------- sabzi: two vegetables (the pairs people really cook)
  const PAIRS = [['Potato', ['Cauliflower', 'Peas', 'Brinjal', 'Spinach', 'Methi', 'Capsicum', 'Lady finger', 'Cabbage', 'Beans', 'Carrot', 'Bottle gourd', 'Pumpkin', 'Radish', 'Tomato', 'Mushroom', 'Corn', 'Raw banana', 'Tinda', 'Ridge gourd', 'Colocasia', 'Turnip', 'Parwal', 'Kundru', 'Cluster beans', 'Bathua', 'Sarson leaves', 'Drumstick', 'Bitter gourd', 'Soya chunks', 'Baby corn', 'Broccoli', 'Sweet potato', 'Lotus stem', 'Beetroot', 'Jackfruit', 'Yam', 'Snake gourd']], ['Peas', ['Cauliflower', 'Carrot', 'Mushroom', 'Corn', 'Capsicum', 'Beans', 'Tomato', 'Baby corn', 'Paneer']], ['Cauliflower', ['Carrot', 'Capsicum', 'Beans', 'Tomato', 'Brinjal', 'Mushroom']], ['Brinjal', ['Tomato', 'Capsicum', 'Peas', 'Bottle gourd', 'Lady finger']], ['Carrot', ['Beans', 'Capsicum', 'Cabbage', 'Corn']], ['Cabbage', ['Peas', 'Capsicum', 'Carrot', 'Tomato']], ['Beans', ['Corn', 'Capsicum']], ['Mushroom', ['Capsicum', 'Corn', 'Baby corn']]];
  PAIRS.forEach(([a, bs]) => bs.forEach(b => { if (b === 'Paneer') return mk('Matar Paneer', 'Paneer', [['Paneer', .05], ['Peas', .05]], 'rich', { onion: .03, tomato: .04 }); mk(`${HN[a]} ${HN[b]}`, 'Sabzi', [[a, VQ[a] * .6], [b, VQ[b] * .6]], 'dry', { onion: .02, tomato: .02 }); }));
  // ---------------------------------------------------------------- paneer
  const PANEER = [['Paneer Butter Masala', 'rich', { tomato: .07, extra: [['Butter', .01], ['Cream', .015]] }], ['Kadai Paneer', 'rich', { extra: [['Capsicum', .04]] }], ['Paneer Tikka Masala', 'rich', { extra: [['Capsicum', .03], ['Tandoori masala', .002]] }], ['Paneer Lababdar', 'rich', { tomato: .06, extra: [['Butter', .008], ['Cream', .015]] }], ['Paneer Handi', 'rich', { extra: [['Curd', .03]] }], ['Paneer Do Pyaza', 'rich', { onion: .06 }], ['Paneer Makhani', 'rich', { tomato: .07, extra: [['Butter', .01], ['Cream', .015]] }], ['Paneer Korma', 'rich', { extra: [['Cashew', .008], ['Cream', .01]] }], ['Paneer Pasanda', 'rich', { extra: [['Cashew', .008], ['Cream', .012]] }], ['Paneer Angara', 'rich', { extra: [['Dry red chilli', .001]] }], ['Paneer Bhurji', 'gravy', { onion: .035, tomato: .03 }], ['Paneer Jalfrezi', 'gravy', { extra: [['Capsicum', .04]] }], ['Paneer Methi Malai', 'rich', { extra: [['Methi', .04], ['Cream', .02]] }], ['Palak Paneer', 'rich', { extra: [['Spinach', .1], ['Cream', .008]], tomato: .015 }], ['Mushroom Paneer', 'rich', { extra: [['Mushroom', .05]] }], ['Paneer Masala', 'gravy', {}], ['Paneer Curry', 'gravy', {}], ['Achari Paneer', 'gravy', { extra: [['Fennel seeds', .0005], ['Mustard seeds', .0005], ['Pickle', .005]] }], ['Hariyali Paneer', 'gravy', { extra: [['Spinach', .05], ['Coriander leaves', .015], ['Mint leaves', .005]] }], ['Shahi Paneer', 'rich', { extra: [['Cashew', .01], ['Cream', .02], ['Milk', .02]] }], ['Paneer Bhuna', 'gravy', { onion: .04, tomato: .04 }], ['Kashmiri Paneer', 'rich', { extra: [['Curd', .03], ['Dry fruits', .005]] }], ['Paneer Kofta', 'rich', { extra: [['Besan', .015], ['Oil', .02]], oil: .015 }], ['Chilli Paneer', 'chinese', { onion: .03, tomato: 0, extra: [['Capsicum', .04], ['Cornflour', .01], ['Oil', .02]] }], ['Paneer Fry', 'dry', { onion: .01, tomato: 0, oil: .018 }], ['Paneer Pakora', 'snack', { onion: 0, tomato: 0, extra: [['Besan', .04], ['Oil', .03]] }], ['Paneer Tikka', 'snack', { onion: .02, tomato: 0, extra: [['Curd', .03], ['Capsicum', .03], ['Tandoori masala', .003]] }]];
  PANEER.forEach(([n, sp, o]) => { const cat = sp === 'chinese' ? 'Chinese' : sp === 'snack' ? 'Snack' : 'Paneer'; const ex = o.extra || []; const o2 = { ...o, extra: ex }; mk(n, cat, [['Paneer', .06]], sp, o2); });
  ['Capsicum', 'Corn', 'Baby corn', 'Broccoli', 'Cauliflower', 'Beans', 'Mushroom', 'Cabbage', 'Carrot', 'Brinjal', 'Lady finger'].forEach(v => mk(`Paneer ${HN[v]}`, 'Paneer', [['Paneer', .05], [v, .06]], 'gravy', { onion: .03, tomato: .035 }));
  // ---------------------------------------------------------------- dal, rajma, chole
  const DALS = [['Toor dal', 'Toor'], ['Moong dal', 'Moong'], ['Chana dal', 'Chana'], ['Masoor dal', 'Masoor'], ['Urad dal', 'Urad']];
  const STYLES = [['Tadka', {}], ['Fry', { onion: .025 }], ['Palak', { extra: [['Spinach', .05]] }], ['Lauki', { extra: [['Bottle gourd', .06]] }], ['Tamatar', { tomato: .05 }], ['Pyaaz', { onion: .045 }], ['Methi', { extra: [['Methi', .03]] }], ['Dhaba', { onion: .03, extra: [['Butter', .004]] }], ['Mix', { extra: [['Mixed vegetables', .05]] }], ['Lasooni', { extra: [['Garlic', .008]] }], ['Gujarati', { extra: [['Jaggery', .006], ['Tamarind', .003]] }], ['Punjabi', { extra: [['Butter', .006], ['Cream', .005]] }]];
  DALS.forEach(([d, n]) => STYLES.forEach(([s, o]) => mk(`${n} Dal ${s}`, 'Dal', [[d, .035]], 'dal', { onion: .015, tomato: .02, oil: .008, ...o, extra: o.extra || [] })));
  mk('Dal Makhani', 'Dal', [['Urad dal', .03], ['Rajma', .008], ['Butter', .008], ['Cream', .008]], 'rich', { tomato: .03, oil: .006 }); mk('Dal Bukhara', 'Dal', [['Urad dal', .035], ['Butter', .01], ['Cream', .01]], 'rich', { tomato: .03, oil: .005 });
  mk('Panchmel Dal', 'Rajasthani', [['Toor dal', .01], ['Moong dal', .01], ['Chana dal', .01], ['Urad dal', .01], ['Masoor dal', .01], ['Ghee', .008]], 'dal', { oil: .004 });
  mk('Dal Tadka Mix Veg', 'Dal', [['Toor dal', .03], ['Mixed vegetables', .05]], 'dal', { oil: .008 });
  [['Rajma', 'Rajma', .04], ['Chole', 'Chole', .045], ['Lobia', 'Lobia', .035], ['Kala Chana', 'Kala chana', .04], ['Moong Whole', 'Moong (whole)', .035]].forEach(([n, d, q]) => { mk(`${n} Masala`, 'Punjabi', [[d, q]], 'rich', { onion: .03, tomato: .04, oil: .012, extra: n === 'Chole' ? [['Chole masala', .002]] : [] }); mk(`${n} Dry`, 'Dal', [[d, q]], 'dry', { onion: .025, tomato: .025 }); mk(`${n} Curry`, 'Dal', [[d, q]], 'gravy', { onion: .03, tomato: .035 }); });
  mk('Chole Bhature', 'Punjabi', [['Chole', .045], ['Maida', .08]], 'rich', { onion: .03, tomato: .04, oil: .05, extra: [['Chole masala', .002], ['Curd', .01]] });
  mk('Amritsari Chole', 'Punjabi', [['Chole', .045], ['Tea leaves', .001]], 'rich', { onion: .035, tomato: .04, oil: .012, extra: [['Chole masala', .002], ['Amchur', .0005]] });
  mk('Sprouts Usal', 'Maharashtrian', [['Moong (whole)', .04], ['Coconut', .005]], 'dry', { onion: .02, tomato: .02 }); mk('Sprouts Salad', 'Salad', [['Moong (whole)', .04], ['Onion', .02], ['Tomato', .02], ['Lemon', .2], ['Chaat masala', .001]], 'chaat', { onion: 0, tomato: 0, oil: 0, sp: .3 });
  mk('Rajasthani Kadhi', 'Rajasthani', [['Curd', .08], ['Besan', .02]], 'dal', { onion: 0, tomato: 0, oil: .008 }); mk('Kadhi Pakoda', 'Kadhi', [['Curd', .08], ['Besan', .03]], 'dal', { onion: .02, tomato: 0, oil: .022 }); mk('Gujarati Kadhi', 'Gujarati', [['Curd', .08], ['Besan', .015], ['Sugar', .005]], 'south', { onion: 0, tomato: 0, oil: .006 }); mk('Punjabi Kadhi', 'Punjabi', [['Curd', .08], ['Besan', .02]], 'dal', { onion: .02, tomato: 0, oil: .015 });
  // ---------------------------------------------------------------- rice
  add('Steamed Rice', 'Rice', [['Rice', .09], ['Salt', .001]]);
  VEGS.filter(v => !['Cucumber', 'Tomato', 'Sarson leaves', 'Bathua', 'Soya chunks', 'Jackfruit', 'Snake gourd', 'Yam', 'Raw papaya', 'Kundru', 'Drumstick'].includes(v)).forEach(v => mk(`${HN[v]} Pulao`, 'Rice', [['Rice', .09], [v, VQ[v] * .5]], 'rice', { onion: .02, tomato: 0, oil: .012, extra: [['Ghee', .004]] }));
  mk('Veg Pulao', 'Rice', [['Rice', .09], ['Mixed vegetables', .06]], 'rice', { onion: .02, tomato: 0, oil: .012, extra: [['Ghee', .004]] }); mk('Jeera Rice', 'Rice', [['Rice', .09]], 'rice', { onion: 0, tomato: 0, oil: .006, sp: .6 });
  [['Veg Biryani', [['Mixed vegetables', .1]]], ['Paneer Biryani', [['Paneer', .05], ['Mixed vegetables', .05]]], ['Egg Biryani', [['Eggs', 2]]], ['Soya Biryani', [['Soya chunks', .03]]], ['Mushroom Biryani', [['Mushroom', .08]]], ['Chicken Biryani', [['Chicken', .13]]], ['Mutton Biryani', [['Mutton', .13]]], ['Hyderabadi Veg Biryani', [['Mixed vegetables', .1]]], ['Lucknowi Biryani', [['Mixed vegetables', .1]]], ['Chicken Dum Biryani', [['Chicken', .13]]], ['Egg Dum Biryani', [['Eggs', 2]]]].forEach(([n, m]) => mk(n, 'Rice', [['Rice', .09], ['Curd', .03], ['Ghee', .008], ...m], 'biryani', { onion: .05, tomato: .02, oil: .015 }));
  [['Lemon Rice', [['Lemon', .5], ['Peanuts', .008]]], ['Curd Rice', [['Curd', .08]]], ['Tomato Rice', [['Tomato', .06]]], ['Tamarind Rice', [['Tamarind', .01], ['Peanuts', .01]]], ['Coconut Rice', [['Coconut', .02]]], ['Peas Rice', [['Peas', .04]]], ['Ghee Rice', [['Ghee', .012]]], ['Mint Rice', [['Mint leaves', .015]]], ['Vangi Bath', [['Brinjal', .08], ['Peanuts', .008]]], ['Bisi Bele Bath', [['Toor dal', .025], ['Mixed vegetables', .06], ['Tamarind', .004]]], ['Pongal', [['Moong dal', .03], ['Ghee', .01]]], ['Sambar Rice', [['Toor dal', .03], ['Mixed vegetables', .05]]], ['Rasam Rice', [['Toor dal', .01], ['Tomato', .04]]], ['Pudina Pulao', [['Mint leaves', .015], ['Peas', .03]]]].forEach(([n, m]) => mk(n, 'South Indian', [['Rice', .09], ...m], 'south', { onion: .015, tomato: 0, oil: .012 }));
  [['Veg Fried Rice', [['Mixed vegetables', .06]]], ['Egg Fried Rice', [['Eggs', 1], ['Mixed vegetables', .04]]], ['Schezwan Fried Rice', [['Mixed vegetables', .06], ['Chilli sauce', .01]]], ['Paneer Fried Rice', [['Paneer', .03], ['Mixed vegetables', .04]]], ['Mushroom Fried Rice', [['Mushroom', .06]]], ['Corn Fried Rice', [['Corn', .05]]], ['Chicken Fried Rice', [['Chicken', .07], ['Mixed vegetables', .03]]], ['Burnt Garlic Rice', [['Garlic', .01], ['Mixed vegetables', .03]]], ['Manchurian Rice', [['Cabbage', .05], ['Cornflour', .01]]]].forEach(([n, m]) => mk(n, 'Chinese', [['Rice', .09], ...m], 'chinese', { onion: .02, tomato: 0, oil: .015 }));
  [['Khichdi', [['Moong dal', .03]]], ['Dal Khichdi', [['Moong dal', .015], ['Toor dal', .015]]], ['Masala Khichdi', [['Moong dal', .03], ['Mixed vegetables', .05]]], ['Palak Khichdi', [['Moong dal', .03], ['Spinach', .05]]], ['Bajra Khichdi', [['Bajra flour', .05], ['Moong dal', .02]]], ['Sabudana Khichdi', []]].forEach(([n, m]) => { if (n === 'Sabudana Khichdi') return mk(n, 'Fasting', [['Sabudana', .06], ['Potato', .04], ['Peanuts', .015]], 'breakfast', { onion: 0, tomato: 0, oil: .012 }); mk(n, 'Rice', [['Rice', .05], ...m, ['Ghee', .006]], 'rice', { onion: 0, tomato: .015, oil: 0, sp: .8, extra: [['Turmeric', .0005]] }); });
  add('Rajma Chawal', 'Punjabi', [['Rice', .09], ['Rajma', .04], ['Onion', .03], ['Tomato', .04], ['Oil', .012], ...spc('rich')]); add('Chole Chawal', 'Punjabi', [['Rice', .09], ['Chole', .045], ['Onion', .03], ['Tomato', .04], ['Oil', .012], ['Chole masala', .002], ...spc('rich')]); add('Kadhi Chawal', 'Rice', [['Rice', .09], ['Curd', .08], ['Besan', .02], ['Oil', .01], ...spc('dal')]); add('Dal Chawal', 'Rice', [['Rice', .09], ['Toor dal', .035], ['Onion', .015], ['Tomato', .02], ['Oil', .008], ...spc('dal')]); add('Dal Rice Tadka', 'Rice', [['Rice', .09], ['Moong dal', .035], ['Ghee', .006], ...spc('dal')]);
  // ---------------------------------------------------------------- roti, paratha, puri
  [['Roti', [['Atta', .055], ['Oil', .003]]], ['Phulka', [['Atta', .055]]], ['Missi Roti', [['Atta', .04], ['Besan', .02], ['Oil', .006], ['Ajwain', .0004], ['Salt', .002]]], ['Bajra Roti', [['Bajra flour', .06], ['Ghee', .004]]], ['Makki Ki Roti', [['Makki flour', .06], ['Ghee', .006]]], ['Jowar Roti', [['Jowar flour', .06]]], ['Ragi Roti', [['Ragi flour', .06], ['Oil', .004]]], ['Rumali Roti', [['Maida', .05], ['Atta', .015]]], ['Naan', [['Maida', .08], ['Curd', .01], ['Butter', .005], ['Baking soda', .0004], ['Sugar', .003]]], ['Butter Naan', [['Maida', .08], ['Curd', .01], ['Butter', .012], ['Baking soda', .0004]]], ['Garlic Naan', [['Maida', .08], ['Curd', .01], ['Butter', .008], ['Garlic', .006]]], ['Kulcha', [['Maida', .08], ['Curd', .01], ['Baking soda', .0004]]], ['Amritsari Kulcha', [['Maida', .08], ['Potato', .05], ['Butter', .008], ['Ajwain', .0004]]], ['Puri', [['Atta', .07], ['Oil', .04]]], ['Bhature', [['Maida', .08], ['Curd', .01], ['Oil', .04]]], ['Luchi', [['Maida', .07], ['Oil', .04]]], ['Thepla', [['Atta', .06], ['Besan', .01], ['Methi', .02], ['Oil', .012], ['Turmeric', .0004], ['Red chilli powder', .0004], ['Salt', .002]]], ['Khakhra', [['Atta', .04], ['Oil', .008], ['Salt', .002]]], ['Dhebra', [['Bajra flour', .05], ['Methi', .02], ['Oil', .012], ['Salt', .002]]], ['Rice Roti', [['Rice flour', .06]]], ['Akki Roti', [['Rice flour', .06], ['Onion', .02], ['Oil', .008]]], ['Pooran Poli', [['Atta', .05], ['Chana dal', .03], ['Jaggery', .035], ['Ghee', .012]]], ['Chapati Roll', [['Atta', .05], ['Mixed vegetables', .05], ['Oil', .01]]], ['Plain Paratha', [['Atta', .07], ['Oil', .015]]], ['Lachha Paratha', [['Atta', .07], ['Ghee', .015]]], ['Palak Puri', [['Atta', .07], ['Spinach', .03], ['Oil', .04]]], ['Masala Puri', [['Atta', .07], ['Oil', .04], ['Red chilli powder', .0005], ['Ajwain', .0004], ['Salt', .002]]], ['Methi Puri', [['Atta', .07], ['Methi', .02], ['Oil', .04]]], ['Beetroot Puri', [['Atta', .07], ['Beetroot', .03], ['Oil', .04]]]].forEach(([n, i]) => add(n, 'Bread', i));
  [['Aloo', 'Potato', .06], ['Gobhi', 'Cauliflower', .05], ['Mooli', 'Radish', .05], ['Methi', 'Methi', .03], ['Palak', 'Spinach', .04], ['Pyaaz', 'Onion', .04], ['Matar', 'Peas', .04], ['Gajar', 'Carrot', .04], ['Lauki', 'Bottle gourd', .05], ['Paneer', 'Paneer', .035], ['Sattu', 'Sattu', .03], ['Dal', 'Moong dal', .03], ['Mix Veg', 'Mixed vegetables', .05], ['Egg', 'Eggs', 1], ['Soya', 'Soya chunks', .02], ['Mushroom', 'Mushroom', .04], ['Cheese', 'Cheese', .03], ['Corn', 'Corn', .04], ['Cabbage', 'Cabbage', .05], ['Beetroot', 'Beetroot', .04], ['Besan', 'Besan', .025], ['Paneer Pyaaz', 'Paneer', .03], ['Aloo Pyaaz', 'Potato', .05], ['Aloo Matar', 'Potato', .05], ['Aloo Gobhi', 'Cauliflower', .04], ['Kheema', 'Soya chunks', .025], ['Chicken', 'Chicken', .05], ['Ajwain', 'Ajwain', .001], ['Methi Aloo', 'Methi', .02], ['Pudina', 'Mint leaves', .01], ['Hari Mirch', 'Green chilli', .008], ['Podina Aloo', 'Potato', .05], ['Matar Paneer', 'Paneer', .03], ['Sarson', 'Sarson leaves', .04], ['Bathua', 'Bathua', .04], ['Kaddu', 'Pumpkin', .05], ['Tinda', 'Tinda', .05], ['Chana Dal', 'Chana dal', .03], ['Urad Dal', 'Urad dal', .03]].forEach(([n, i, q]) => add(`${n} Paratha`, 'Paratha', [['Atta', .08], [i, q], ['Oil', .02], ...spc('paratha')]));
  // ---------------------------------------------------------------- breakfast & snacks
  [['Poha', [['Poha', .07], ['Peanuts', .008], ['Potato', .02], ['Lemon', .25]]], ['Kanda Poha', [['Poha', .07], ['Onion', .05], ['Peanuts', .008], ['Lemon', .25]]], ['Indori Poha', [['Poha', .07], ['Sev', .01], ['Peanuts', .008], ['Lemon', .25], ['Fennel seeds', .0005]]], ['Matar Poha', [['Poha', .07], ['Peas', .03], ['Lemon', .25]]], ['Upma', [['Suji', .06], ['Mixed vegetables', .03]]], ['Rava Upma', [['Suji', .06], ['Carrot', .015], ['Peas', .015]]], ['Vermicelli Upma', [['Vermicelli', .06], ['Mixed vegetables', .03]]], ['Oats Upma', [['Oats', .05], ['Mixed vegetables', .03]]], ['Daliya Upma', [['Daliya', .05], ['Mixed vegetables', .04]]], ['Bread Upma', [['Bread', 4], ['Onion', .03]]], ['Semiya', [['Vermicelli', .05], ['Milk', .06], ['Sugar', .02]]], ['Sabudana Vada', [['Sabudana', .05], ['Potato', .05], ['Peanuts', .01], ['Oil', .035]]], ['Medu Vada', [['Urad dal', .04], ['Oil', .03]]], ['Dahi Vada', [['Urad dal', .04], ['Curd', .08], ['Oil', .03], ['Sugar', .005]]], ['Moong Dal Vada', [['Moong dal', .04], ['Oil', .03]]]].forEach(([n, i]) => mk(n, 'Breakfast', i, 'breakfast', { onion: i.some(x => x[0] === 'Onion') ? 0 : .02, tomato: 0, oil: /Vada/.test(n) ? .0 : .01, extra: /Vada/.test(n) ? [['Oil', .03]] : [] }));
  [['Idli', [['Rice', .05], ['Urad dal', .02]]], ['Rava Idli', [['Suji', .06], ['Curd', .04]]], ['Oats Idli', [['Oats', .04], ['Curd', .04]]], ['Plain Dosa', [['Rice', .05], ['Urad dal', .02]]], ['Masala Dosa', [['Rice', .05], ['Urad dal', .02], ['Potato', .08], ['Onion', .02]]], ['Rava Dosa', [['Suji', .05], ['Rice flour', .02], ['Curd', .02]]], ['Onion Dosa', [['Rice', .05], ['Urad dal', .02], ['Onion', .04]]], ['Paneer Dosa', [['Rice', .05], ['Urad dal', .02], ['Paneer', .04]]], ['Mysore Masala Dosa', [['Rice', .05], ['Urad dal', .02], ['Potato', .08], ['Garlic', .005], ['Dry red chilli', .002]]], ['Set Dosa', [['Rice', .05], ['Urad dal', .02], ['Curd', .01]]], ['Pesarattu', [['Moong (whole)', .05], ['Rice', .01], ['Ginger', .003]]], ['Uttapam', [['Rice', .05], ['Urad dal', .02], ['Onion', .03], ['Tomato', .02]]], ['Onion Uttapam', [['Rice', .05], ['Urad dal', .02], ['Onion', .05]]], ['Mix Veg Uttapam', [['Rice', .05], ['Urad dal', .02], ['Mixed vegetables', .05]]], ['Appam', [['Rice', .05], ['Coconut', .01]]], ['Sambar Vada', [['Urad dal', .04], ['Toor dal', .02], ['Oil', .03]]]].forEach(([n, i]) => mk(n, 'South Indian', i, 'south', { onion: 0, tomato: 0, oil: /Dosa|Uttapam|Pesarattu|Appam/.test(n) ? .012 : .0, sp: .4, extra: /Vada/.test(n) ? [['Oil', .03]] : [] }));
  [['Sambar', 'Toor dal', .03], ['Rasam', 'Toor dal', .012], ['Lemon Rasam', 'Toor dal', .012], ['Pepper Rasam', 'Toor dal', .012], ['Tomato Rasam', 'Toor dal', .012], ['Drumstick Sambar', 'Toor dal', .03], ['Onion Sambar', 'Toor dal', .03], ['Brinjal Sambar', 'Toor dal', .03], ['Pumpkin Sambar', 'Toor dal', .03], ['Kootu', 'Moong dal', .025], ['Poriyal', 'Coconut', .01], ['Avial', 'Coconut', .015], ['Thoran', 'Coconut', .012]].forEach(([n, d, q]) => mk(n, 'South Indian', [[d, q], ['Mixed vegetables', /Rasam/.test(n) ? 0.0001 : .06], ...(n === 'Tomato Rasam' || /Rasam/.test(n) ? [['Tomato', .04]] : [])], /Sambar/.test(n) ? 'sambar' : 'south', { onion: /Sambar|Kootu/.test(n) ? .02 : 0, tomato: /Sambar/.test(n) ? .02 : 0, oil: .008 }));
  [['Coconut Chutney', [['Coconut', .02], ['Green chilli', .002], ['Chana dal', .003]]], ['Tomato Chutney', [['Tomato', .04], ['Dry red chilli', .001], ['Garlic', .003]]], ['Onion Chutney', [['Onion', .04], ['Dry red chilli', .001]]], ['Mint Chutney', [['Mint leaves', .015], ['Green chilli', .002], ['Lemon', .1]]], ['Green Chutney', [['Coriander leaves', .02], ['Green chilli', .002], ['Lemon', .1]]], ['Peanut Chutney', [['Peanuts', .015], ['Garlic', .003], ['Dry red chilli', .001]]], ['Imli Chutney', [['Tamarind', .01], ['Jaggery', .01], ['Cumin seeds', .0005]]], ['Garlic Chutney', [['Garlic', .01], ['Red chilli powder', .002]]], ['Dal Chutney', [['Chana dal', .01], ['Coconut', .008], ['Dry red chilli', .001]]], ['Til Chutney', [['Sesame seeds', .01], ['Green chilli', .002]]]].forEach(([n, i]) => add(n, 'Chutney', [...i, ['Salt', .001]]));
  [['Bread Butter', [['Bread', 4], ['Butter', .01]]], ['Bread Jam', [['Bread', 4], ['Sugar', .02]]], ['Bread Omelette', [['Bread', 3], ['Eggs', 2], ['Onion', .015], ['Oil', .01], ['Salt', .002]]], ['Bread Pakora', [['Bread', 2], ['Besan', .04], ['Potato', .04], ['Oil', .035], ...spc('snack')]], ['French Toast', [['Bread', 4], ['Eggs', 1], ['Milk', .03], ['Sugar', .01], ['Oil', .01]]], ['Masala Toast', [['Bread', 4], ['Onion', .02], ['Tomato', .02], ['Butter', .01], ['Chaat masala', .001]]], ['Bread Upma', [['Bread', 4], ['Onion', .03], ['Oil', .01], ['Mustard seeds', .0004], ['Salt', .002]]], ['Veg Sandwich', [['Bread', 4], ['Cucumber', .03], ['Tomato', .03], ['Onion', .015], ['Butter', .01], ['Green chilli', .001]]], ['Aloo Sandwich', [['Bread', 4], ['Potato', .06], ['Butter', .01], ...spc('dry', .5)]], ['Grilled Sandwich', [['Bread', 4], ['Mixed vegetables', .05], ['Cheese', .015], ['Butter', .01]]], ['Cheese Sandwich', [['Bread', 4], ['Cheese', .03], ['Butter', .01]]], ['Paneer Sandwich', [['Bread', 4], ['Paneer', .04], ['Butter', .01], ...spc('dry', .4)]], ['Corn Sandwich', [['Bread', 4], ['Corn', .04], ['Butter', .01]]], ['Egg Sandwich', [['Bread', 4], ['Eggs', 2], ['Butter', .01], ['Black pepper', .0003]]], ['Chutney Sandwich', [['Bread', 4], ['Coriander leaves', .015], ['Butter', .01]]], ['Club Sandwich', [['Bread', 6], ['Cucumber', .03], ['Tomato', .03], ['Cheese', .02], ['Butter', .015]]]].forEach(([n, i]) => add(n, 'Snack', i));
  [['Pyaaz Pakora', 'Onion', .08], ['Aloo Pakora', 'Potato', .08], ['Gobhi Pakora', 'Cauliflower', .08], ['Palak Pakora', 'Spinach', .06], ['Mirchi Pakora', 'Green chilli', .04], ['Paneer Pakora', 'Paneer', .05], ['Baingan Pakora', 'Brinjal', .08], ['Gobi Manchurian', 'Cauliflower', .1], ['Veg Pakora', 'Mixed vegetables', .08], ['Moong Dal Pakora', 'Moong dal', .04], ['Bread Roll', 'Potato', .06], ['Mix Pakora', 'Mixed vegetables', .08]].forEach(([n, v, q]) => { if (n === 'Gobi Manchurian') return mk(n, 'Chinese', [[v, q], ['Cornflour', .015], ['Maida', .01]], 'chinese', { onion: .03, tomato: 0, oil: .035, extra: [['Ketchup', .01]] }); add(n, 'Snack', [[v, q], ['Besan', .04], ['Oil', .035], ...spc('snack')]); });
  [['Aloo Tikki', 'Potato', .12], ['Hara Bhara Kabab', 'Spinach', .06], ['Veg Cutlet', 'Mixed vegetables', .1], ['Paneer Cutlet', 'Paneer', .05], ['Corn Cutlet', 'Corn', .08], ['Beetroot Cutlet', 'Beetroot', .1], ['Soya Kabab', 'Soya chunks', .03], ['Veg Seekh Kabab', 'Mixed vegetables', .1], ['Dahi Kabab', 'Curd', .08], ['Rajma Tikki', 'Rajma', .05], ['Chana Tikki', 'Chana dal', .04]].forEach(([n, v, q]) => add(n, 'Snack', [[v, q], ['Potato', n === 'Aloo Tikki' ? 0 : .04], ['Besan', .015], ['Oil', .03], ...spc('snack')].filter(x => x[1] > 0)));
  [['Samosa', [['Maida', .05], ['Potato', .08], ['Peas', .01]]], ['Mini Samosa', [['Maida', .04], ['Potato', .06]]], ['Kachori', [['Maida', .05], ['Moong dal', .02]]], ['Pyaaz Kachori', [['Maida', .05], ['Onion', .05]]], ['Mirchi Vada', [['Green chilli', .05], ['Potato', .05], ['Besan', .03]]], ['Aloo Bonda', [['Potato', .1], ['Besan', .03]]], ['Vada Pav', [['Pav', 1], ['Potato', .1], ['Besan', .03]]], ['Dabeli', [['Pav', 1], ['Potato', .08], ['Peanuts', .01], ['Sev', .01]]], ['Pav Bhaji', [['Mixed vegetables', .12], ['Potato', .06], ['Tomato', .04], ['Onion', .03], ['Butter', .012], ['Pav', 2], ['Pav bhaji masala', .003]]], ['Misal Pav', [['Moong (whole)', .04], ['Onion', .03], ['Tomato', .02], ['Sev', .015], ['Pav', 1]]], ['Poha Cutlet', [['Poha', .05], ['Potato', .05]]], ['Dhokla', [['Besan', .06], ['Curd', .02], ['Sugar', .005], ['Mustard seeds', .0004]]], ['Khaman', [['Besan', .06], ['Sugar', .008], ['Lemon', .2]]], ['Handvo', [['Rice', .03], ['Toor dal', .015], ['Bottle gourd', .04]]], ['Fafda', [['Besan', .05], ['Ajwain', .0004]]], ['Khandvi', [['Besan', .04], ['Curd', .05]]], ['Patra', [['Besan', .03], ['Colocasia', .04], ['Tamarind', .005]]], ['Sabudana Tikki', [['Sabudana', .04], ['Potato', .05], ['Peanuts', .01]]], ['Corn Chaat', [['Corn', .08], ['Onion', .02], ['Lemon', .2]]], ['Murmura Chivda', [['Murmura', .04], ['Peanuts', .01]]], ['Roasted Chana', [['Chana dal', .04]]], ['Masala Peanuts', [['Peanuts', .04], ['Besan', .01]]], ['Spring Roll', [['Maida', .04], ['Cabbage', .05], ['Carrot', .02]]], ['Momos', [['Maida', .06], ['Cabbage', .05], ['Carrot', .02], ['Ginger', .003]]], ['French Fries', [['Potato', .15]]], ['Cheese Balls', [['Potato', .05], ['Cheese', .03]]]].forEach(([n, i]) => add(n, 'Snack', [...i, ['Oil', /Chivda|Chana|Momos|Fries|Peanuts/.test(n) ? .01 : .03], ...spc('snack', .8)]));
  [['Bhel Puri', [['Murmura', .04], ['Sev', .015], ['Onion', .02], ['Tomato', .02], ['Tamarind', .005]]], ['Sev Puri', [['Maida', .03], ['Sev', .015], ['Potato', .04], ['Onion', .015], ['Tamarind', .005]]], ['Pani Puri', [['Suji', .04], ['Potato', .05], ['Chole', .01], ['Tamarind', .006], ['Mint leaves', .006]]], ['Dahi Puri', [['Maida', .03], ['Curd', .05], ['Potato', .04], ['Tamarind', .005]]], ['Papdi Chaat', [['Maida', .03], ['Curd', .05], ['Chole', .015], ['Tamarind', .005]]], ['Aloo Chaat', [['Potato', .12], ['Onion', .02], ['Lemon', .2], ['Tamarind', .005]]], ['Chana Chaat', [['Chole', .05], ['Onion', .02], ['Tomato', .02], ['Lemon', .2]]], ['Fruit Chaat', [['Banana', 1], ['Apple', 1], ['Chaat masala', .001]]], ['Dahi Bhalla', [['Urad dal', .04], ['Curd', .08], ['Tamarind', .005]]], ['Raj Kachori', [['Maida', .05], ['Moong (whole)', .02], ['Curd', .05], ['Potato', .03]]], ['Ragda Pattice', [['Matar dry', .04], ['Potato', .08], ['Tamarind', .006]]], ['Jhal Muri', [['Murmura', .05], ['Onion', .02], ['Mustard seeds', .0005]]], ['Samosa Chaat', [['Maida', .05], ['Potato', .08], ['Chole', .02], ['Curd', .04]]], ['Kachori Chaat', [['Maida', .05], ['Moong dal', .02], ['Curd', .04]]]].forEach(([n, i]) => add(n, 'Chaat', [...i, ...spc('chaat')]));
  [['Maggi', [['Noodles', .07], ['Mixed vegetables', .03]]], ['Veg Noodles', [['Noodles', .08], ['Mixed vegetables', .08]]], ['Hakka Noodles', [['Noodles', .08], ['Cabbage', .04], ['Carrot', .02], ['Capsicum', .02]]], ['Schezwan Noodles', [['Noodles', .08], ['Mixed vegetables', .06], ['Chilli sauce', .01]]], ['Chilli Garlic Noodles', [['Noodles', .08], ['Garlic', .01], ['Chilli sauce', .006]]], ['Egg Noodles', [['Noodles', .08], ['Eggs', 1], ['Mixed vegetables', .04]]], ['Paneer Noodles', [['Noodles', .08], ['Paneer', .03], ['Mixed vegetables', .04]]], ['Chowmein', [['Noodles', .08], ['Cabbage', .05], ['Carrot', .02]]], ['Veg Manchurian', [['Cabbage', .08], ['Carrot', .02], ['Cornflour', .02]]], ['Manchurian Gravy', [['Cabbage', .08], ['Cornflour', .02], ['Garlic', .008]]], ['Veg Spring Roll', [['Maida', .04], ['Cabbage', .05], ['Carrot', .02]]], ['Pasta Red Sauce', [['Macaroni', .08], ['Tomato', .06], ['Onion', .02], ['Mixed vegetables', .04]]], ['Pasta White Sauce', [['Macaroni', .08], ['Milk', .08], ['Maida', .008], ['Butter', .01], ['Cheese', .015]]], ['Macaroni', [['Macaroni', .08], ['Mixed vegetables', .05], ['Tomato', .03]]], ['Veg Burger', [['Bun', 1], ['Potato', .08], ['Onion', .015], ['Tomato', .015], ['Ketchup', .01]]], ['Veg Roll', [['Maida', .05], ['Mixed vegetables', .06], ['Ketchup', .01]]], ['Paneer Roll', [['Maida', .05], ['Paneer', .05], ['Onion', .02], ['Capsicum', .02]]], ['Egg Roll', [['Maida', .05], ['Eggs', 1], ['Onion', .02]]], ['Veg Pizza', [['Pizza base', 1], ['Cheese', .04], ['Capsicum', .03], ['Tomato', .03], ['Onion', .02], ['Ketchup', .02]]], ['Veg Wrap', [['Tortilla', 1], ['Mixed vegetables', .06], ['Cheese', .015]]]].forEach(([n, i]) => add(n, /Burger|Roll|Pizza|Wrap/.test(n) ? 'Fast food' : /Pasta|Macaroni/.test(n) ? 'Fast food' : 'Chinese', [...i, ['Oil', .012], ...spc('chinese', .6)]));
  // ---------------------------------------------------------------- egg & non-veg
  [['Egg Curry', 'gravy'], ['Egg Masala', 'gravy'], ['Egg Bhurji', 'dry'], ['Egg Kadai', 'rich'], ['Egg Korma', 'rich'], ['Egg Do Pyaza', 'gravy'], ['Egg Tadka', 'gravy'], ['Anda Fry', 'dry'], ['Boiled Egg', 'dry'], ['Omelette', 'dry'], ['Masala Omelette', 'dry'], ['Egg Roast', 'gravy'], ['Egg Kheema', 'gravy'], ['Egg Pulao', 'rice'], ['Egg Keema Pav', 'gravy']].forEach(([n, sp]) => mk(n, 'Egg', [['Eggs', 2]], sp, { onion: /Boiled/.test(n) ? 0 : .035, tomato: /Boiled|Omelette|Fry|Bhurji/.test(n) ? .01 : .04, oil: /Boiled/.test(n) ? 0 : .012, sp: /Boiled/.test(n) ? .2 : 1 }));
  [['Chicken Curry', 'nonveg'], ['Chicken Masala', 'nonveg'], ['Chicken Kadai', 'nonveg'], ['Chicken Do Pyaza', 'nonveg'], ['Butter Chicken', 'nonveg'], ['Chicken Korma', 'nonveg'], ['Chicken Handi', 'nonveg'], ['Chicken Tikka Masala', 'nonveg'], ['Chicken Tikka', 'snack'], ['Tandoori Chicken', 'snack'], ['Chicken Fry', 'nonveg'], ['Chicken Roast', 'nonveg'], ['Chicken Keema', 'nonveg'], ['Chicken Saag', 'nonveg'], ['Chicken Bhuna', 'nonveg'], ['Chicken Jalfrezi', 'nonveg'], ['Chicken Lollipop', 'chinese'], ['Chilli Chicken', 'chinese'], ['Chicken Manchurian', 'chinese'], ['Kadhai Chicken Dry', 'nonveg'], ['Chicken Stew', 'nonveg'], ['Chicken Soup', 'nonveg'], ['Chicken Sandwich', 'snack'], ['Chicken Roll', 'snack'], ['Chicken Pakora', 'snack'], ['Chicken Fried Curry', 'nonveg'], ['Dhaba Chicken', 'nonveg'], ['Chicken Dahi Wala', 'nonveg'], ['Lemon Chicken', 'nonveg'], ['Pepper Chicken', 'nonveg'], ['Chicken Chettinad', 'nonveg']].forEach(([n, sp]) => mk(n, sp === 'chinese' ? 'Chinese' : 'Non-veg', [['Chicken', .15]], sp, { onion: .05, tomato: /Tikka$|Tandoori|Lollipop|Chilli|Manchurian|Soup|Pakora|Sandwich|Roll/.test(n) ? .01 : .04, oil: .02, extra: /Butter|Korma|Tikka Masala/.test(n) ? [['Butter', .01], ['Cream', .015]] : /Dahi|Tikka$|Tandoori/.test(n) ? [['Curd', .04]] : [] }));
  [['Fish Curry', 'nonveg'], ['Fish Fry', 'snack'], ['Fish Masala', 'nonveg'], ['Bengali Fish Curry', 'nonveg'], ['Fish Tikka', 'snack'], ['Fish Korma', 'nonveg'], ['Goan Fish Curry', 'nonveg'], ['Macher Jhol', 'nonveg'], ['Sarson Fish', 'nonveg'], ['Fish Amritsari', 'snack'], ['Prawn Masala', 'nonveg'], ['Prawn Curry', 'nonveg'], ['Fish Biryani', 'biryani']].forEach(([n, sp]) => mk(n, 'Non-veg', [[/Prawn/.test(n) ? 'Prawns' : 'Fish', .14]], sp, { onion: .04, tomato: .035, oil: .02, extra: sp === 'biryani' ? [['Rice', .09]] : [] }));
  [['Mutton Curry', 'nonveg'], ['Mutton Masala', 'nonveg'], ['Mutton Rogan Josh', 'nonveg'], ['Mutton Keema', 'nonveg'], ['Mutton Korma', 'nonveg'], ['Mutton Handi', 'nonveg'], ['Mutton Do Pyaza', 'nonveg'], ['Laal Maas', 'nonveg'], ['Mutton Kosha', 'nonveg'], ['Mutton Saag', 'nonveg'], ['Mutton Stew', 'nonveg'], ['Keema Matar', 'nonveg'], ['Keema Pav', 'nonveg']].forEach(([n, sp]) => mk(n, 'Non-veg', [['Mutton', .15]], sp, { onion: .06, tomato: .04, oil: .025, extra: /Keema/.test(n) ? [['Peas', .03]] : [] }));
  // ---------------------------------------------------------------- regional specials (name: main ingredients per person)
  const REG = (cat, spice, rows, o = {}) => rows.forEach(([n, ...m]) => mk(n, cat, m.map(([a, b]) => [a, b]), spice, o));
  REG('Rajasthani', 'rich', [['Gatte Ki Sabzi', ['Besan', .04], ['Curd', .05]], ['Ker Sangri', ['Mixed vegetables', .08], ['Curd', .03]], ['Dal Baati Churma', ['Atta', .1], ['Toor dal', .03], ['Ghee', .03], ['Jaggery', .02]], ['Bajre Ka Sogra', ['Bajra flour', .05], ['Curd', .05]], ['Pyaaz Ki Sabzi', ['Onion', .12]], ['Mangodi Sabzi', ['Moong dal', .03]], ['Papad Ki Sabzi', ['Papad', 2], ['Curd', .05]], ['Aloo Pyaaz Sabzi', ['Potato', .1], ['Onion', .06]], ['Lehsun Ki Chutney', ['Garlic', .015], ['Red chilli powder', .003]], ['Gulab Jamun Sabzi', ['Khoya', .03], ['Curd', .05]], ['Besan Gatte Pulao', ['Rice', .08], ['Besan', .03]], ['Kair Sangri Achar', ['Pickle', .01]], ['Methi Gatta', ['Besan', .04], ['Methi', .03]], ['Bajra Khichdi', ['Bajra flour', .05], ['Moong dal', .02]], ['Rabdi', ['Milk', .25], ['Sugar', .03]], ['Malpua', ['Maida', .04], ['Milk', .05], ['Sugar', .04], ['Oil', .04]], ['Ghevar', ['Maida', .05], ['Ghee', .03], ['Sugar', .04]], ['Mawa Kachori', ['Maida', .04], ['Khoya', .03], ['Sugar', .04]], ['Lahsun Chutney', ['Garlic', .015], ['Red chilli powder', .003]], ['Boondi Raita', ['Curd', .08], ['Namkeen', .01]], ['Churma Ladoo', ['Atta', .05], ['Ghee', .03], ['Jaggery', .03]]]);
  REG('Gujarati', 'south', [['Undhiyu', ['Mixed vegetables', .15], ['Besan', .01]], ['Sev Usal', ['Matar dry', .04], ['Sev', .02]], ['Gujarati Dal', ['Toor dal', .03], ['Jaggery', .008]], ['Khichu', ['Rice flour', .05]], ['Muthia', ['Besan', .04], ['Bottle gourd', .05]], ['Sev Tameta', ['Sev', .03], ['Tomato', .07]], ['Ringan Bharta', ['Brinjal', .15]], ['Bhakri', ['Atta', .06], ['Ghee', .008]], ['Dhokla', ['Besan', .06], ['Curd', .02]], ['Khandvi', ['Besan', .04], ['Curd', .05]], ['Fafda Jalebi', ['Besan', .05], ['Maida', .04], ['Sugar', .05]], ['Basundi', ['Milk', .25], ['Sugar', .025]], ['Shrikhand', ['Curd', .12], ['Sugar', .03]], ['Mohanthal', ['Besan', .04], ['Sugar', .04], ['Ghee', .03]], ['Sukhdi', ['Atta', .04], ['Jaggery', .03], ['Ghee', .03]], ['Gujarati Kadhi', ['Curd', .08], ['Besan', .015]], ['Methi Na Gota', ['Besan', .04], ['Methi', .03]], ['Lilva Kachori', ['Maida', .05], ['Peas', .03]], ['Thepla With Chunda', ['Atta', .06], ['Methi', .02]], ['Dal Dhokli', ['Toor dal', .03], ['Atta', .04]], ['Surti Undhiyu', ['Mixed vegetables', .15], ['Coconut', .01]], ['Handvo', ['Rice', .03], ['Toor dal', .015]], ['Patra', ['Besan', .03], ['Colocasia', .04]]]);
  REG('Bengali', 'south', [['Aloo Posto', ['Potato', .15], ['Khus khus', .01]], ['Shukto', ['Mixed vegetables', .15]], ['Chorchori', ['Mixed vegetables', .15]], ['Begun Bhaja', ['Brinjal', .12]], ['Alu Dum Bengali', ['Potato', .15]], ['Luchi Aloo Dum', ['Maida', .07], ['Potato', .12]], ['Cholar Dal', ['Chana dal', .04], ['Coconut', .01]], ['Mishti Doi', ['Milk', .2], ['Sugar', .03]], ['Sandesh', ['Milk', .25], ['Sugar', .03]], ['Rasgulla', ['Milk', .2], ['Sugar', .04]], ['Rosogolla', ['Milk', .2], ['Sugar', .04]], ['Pantua', ['Khoya', .04], ['Sugar', .04]], ['Kosha Mangsho', ['Mutton', .15]], ['Ilish Paturi', ['Fish', .14], ['Mustard seeds', .005]], ['Dhokar Dalna', ['Chana dal', .04], ['Potato', .05]], ['Kolkata Egg Roll', ['Eggs', 1], ['Maida', .05]], ['Jhuri Aloo Bhaja', ['Potato', .12]], ['Moong Dal Bengali', ['Moong dal', .035], ['Coconut', .01]], ['Bhapa Ilish', ['Fish', .14]], ['Potoler Dalna', ['Parwal', .12], ['Potato', .05]], ['Kumro Chechki', ['Pumpkin', .15]], ['Lau Ghonto', ['Bottle gourd', .12]]]);
  REG('Maharashtrian', 'gravy', [['Pithla Bhakri', ['Besan', .04], ['Jowar flour', .05]], ['Zunka', ['Besan', .04]], ['Misal Pav', ['Moong (whole)', .04], ['Pav', 1]], ['Vada Pav', ['Pav', 1], ['Potato', .1]], ['Sabudana Khichdi', ['Sabudana', .06], ['Peanuts', .015]], ['Thalipeeth', ['Bajra flour', .03], ['Jowar flour', .03], ['Besan', .02]], ['Puran Poli', ['Atta', .05], ['Chana dal', .03], ['Jaggery', .035]], ['Varan Bhaat', ['Toor dal', .03], ['Rice', .09]], ['Amti', ['Toor dal', .03], ['Tamarind', .004]], ['Bharli Vangi', ['Brinjal', .12], ['Peanuts', .01]], ['Kanda Bhaji', ['Onion', .08], ['Besan', .04]], ['Batata Bhaji', ['Potato', .15]], ['Shrikhand', ['Curd', .12], ['Sugar', .03]], ['Modak', ['Rice flour', .04], ['Coconut', .02], ['Jaggery', .02]], ['Kothimbir Vadi', ['Besan', .04], ['Coriander leaves', .04]], ['Usal Pav', ['Moong (whole)', .04], ['Pav', 1]], ['Sol Kadhi', ['Coconut milk', .08]], ['Aamras', ['Mango', .5], ['Sugar', .02]], ['Shevga Sabzi', ['Drumstick', .08]]]);
  REG('Punjabi', 'rich', [['Sarson Ka Saag', ['Sarson leaves', .15]], ['Makki Di Roti', ['Makki flour', .06], ['Ghee', .006]], ['Chole Bhature', ['Chole', .045], ['Maida', .08]], ['Rajma Masala', ['Rajma', .04]], ['Kadhi Pakora', ['Curd', .08], ['Besan', .03]], ['Dal Makhani', ['Urad dal', .03], ['Butter', .008]], ['Amritsari Kulcha', ['Maida', .08], ['Potato', .05]], ['Paneer Tikka', ['Paneer', .06]], ['Lassi', ['Curd', .12], ['Sugar', .015]], ['Pinni', ['Atta', .04], ['Ghee', .03], ['Sugar', .03]], ['Gajar Halwa', ['Carrot', .12], ['Milk', .06], ['Sugar', .03]], ['Chana Masala', ['Chole', .045]], ['Aloo Wadi', ['Urad dal', .02], ['Potato', .1]], ['Palak Kadhi', ['Curd', .08], ['Spinach', .04], ['Besan', .02]], ['Meethe Chawal', ['Rice', .08], ['Sugar', .03], ['Ghee', .01]], ['Patiala Peg Lassi', ['Curd', .1], ['Milk', .05]], ['Chole Kulche', ['Chole', .045], ['Maida', .08]]]);
  REG('UP', 'gravy', [['Aloo Puri', ['Potato', .12], ['Atta', .07]], ['Kachori Sabzi', ['Maida', .05], ['Potato', .1]], ['Tehri', ['Rice', .09], ['Potato', .05], ['Peas', .03]], ['Baati Chokha', ['Atta', .08], ['Brinjal', .08], ['Sattu', .02]], ['Banarasi Dum Aloo', ['Potato', .15], ['Curd', .03]], ['Tamatar Chaat', ['Tomato', .1], ['Potato', .05]], ['Lauki Ke Kofte', ['Bottle gourd', .1], ['Besan', .02]], ['Aloo Tamatar Rasedaar', ['Potato', .15], ['Tomato', .06]], ['Bedmi Puri', ['Atta', .06], ['Urad dal', .015]], ['Petha', ['Pumpkin', .1], ['Sugar', .05]], ['Malaiyo', ['Milk', .2], ['Sugar', .02]], ['Kakori Kabab', ['Mutton', .1]], ['Lucknowi Korma', ['Mutton', .13], ['Curd', .03]], ['Awadhi Biryani', ['Rice', .09], ['Mutton', .13]], ['Matar Ka Nimona', ['Peas', .1]], ['Kadhi Chawal UP', ['Curd', .08], ['Besan', .02], ['Rice', .09]], ['Poori Sabzi', ['Atta', .07], ['Potato', .12]]]);
  REG('Bihari', 'gravy', [['Litti Chokha', ['Atta', .07], ['Sattu', .035], ['Brinjal', .08], ['Potato', .05]], ['Aloo Chokha', ['Potato', .15]], ['Baingan Chokha', ['Brinjal', .15]], ['Sattu Paratha', ['Atta', .06], ['Sattu', .03]], ['Sattu Sharbat', ['Sattu', .03], ['Sugar', .015], ['Lemon', .3]], ['Dal Pitha', ['Rice flour', .05], ['Chana dal', .03]], ['Thekua', ['Atta', .05], ['Jaggery', .03], ['Ghee', .02]], ['Khaja', ['Maida', .05], ['Sugar', .03], ['Ghee', .02]], ['Chana Ghugni', ['Kala chana', .045]], ['Kadhi Bari', ['Curd', .08], ['Besan', .03]], ['Tilkut', ['Sesame seeds', .03], ['Jaggery', .03]], ['Maal Pua', ['Maida', .04], ['Milk', .05], ['Sugar', .03]], ['Bihari Kabab', ['Mutton', .12]], ['Champaran Mutton', ['Mutton', .15]], ['Dhuska', ['Rice', .05], ['Chana dal', .02]], ['Kheer Bihari', ['Milk', .15], ['Rice', .015], ['Sugar', .02]], ['Chura Dahi', ['Poha', .06], ['Curd', .1], ['Jaggery', .015]]]);
  REG('MP', 'gravy', [['Bhutte Ka Kees', ['Corn', .1], ['Milk', .04]], ['Poha Jalebi', ['Poha', .07], ['Maida', .03], ['Sugar', .04]], ['Dal Bafla', ['Atta', .08], ['Toor dal', .03], ['Ghee', .02]], ['Mawa Bati', ['Khoya', .04], ['Maida', .02], ['Sugar', .03]], ['Chakki Ki Shaak', ['Atta', .05], ['Curd', .03]], ['Garadu Fry', ['Yam', .1]], ['Khopra Pak', ['Coconut', .02], ['Sugar', .03]], ['Sabudana Khichdi MP', ['Sabudana', .06], ['Peanuts', .015]], ['Palak Puri MP', ['Atta', .07], ['Spinach', .03]], ['Seekh Paratha', ['Atta', .08], ['Potato', .05]], ['Indori Namkeen Mix', ['Namkeen', .03]], ['Bhopali Gosht Korma', ['Mutton', .13]]]);
  REG('Himachal Kashmiri', 'rich', [['Madra', ['Chole', .04], ['Curd', .05]], ['Chha Gosht', ['Mutton', .13], ['Curd', .05]], ['Siddu', ['Maida', .08], ['Peanuts', .01]], ['Rajma Madra', ['Rajma', .04], ['Curd', .05]], ['Kashmiri Dum Aloo', ['Potato', .15], ['Curd', .03]], ['Rogan Josh', ['Mutton', .15], ['Curd', .03]], ['Haak Saag', ['Spinach', .15]], ['Nadru Yakhni', ['Lotus stem', .1], ['Curd', .05]], ['Kahwa', ['Tea leaves', .002], ['Almonds', .004], ['Sugar', .01]], ['Gushtaba', ['Mutton', .13], ['Curd', .06]], ['Tudkiya Bhath', ['Rice', .09], ['Mixed vegetables', .05]]]);
  REG('Odia Assamese', 'south', [['Dalma', ['Toor dal', .03], ['Mixed vegetables', .08]], ['Pakhala', ['Rice', .1], ['Curd', .05]], ['Santula', ['Mixed vegetables', .12]], ['Chhena Poda', ['Paneer', .06], ['Sugar', .03]], ['Rasabali', ['Paneer', .05], ['Milk', .05], ['Sugar', .03]], ['Khar', ['Raw papaya', .1]], ['Masor Tenga', ['Fish', .14], ['Tomato', .05]], ['Assamese Khichdi', ['Rice', .05], ['Moong dal', .03]], ['Aloo Pitika', ['Potato', .15]], ['Pitha', ['Rice flour', .05], ['Coconut', .02], ['Jaggery', .025]]]);
  REG('Hyderabadi', 'biryani', [['Hyderabadi Dum Biryani', ['Rice', .09], ['Mutton', .12]], ['Mirchi Ka Salan', ['Green chilli', .06], ['Peanuts', .015], ['Sesame seeds', .01]], ['Bagara Baingan', ['Brinjal', .12], ['Peanuts', .01]], ['Dalcha', ['Chana dal', .03], ['Mutton', .06]], ['Khatti Dal', ['Toor dal', .03], ['Tamarind', .005]], ['Double Ka Meetha', ['Bread', 3], ['Milk', .1], ['Sugar', .03]], ['Qubani Ka Meetha', ['Dry fruits', .05], ['Sugar', .03]], ['Haleem', ['Mutton', .08], ['Rice', .02], ['Chana dal', .02]]], { onion: .05, tomato: .03 });
  // ---------------------------------------------------------------- sweets, drinks, sides
  [['Suji Halwa', 'Suji', .04], ['Gajar Halwa', 'Carrot', .12], ['Moong Dal Halwa', 'Moong dal', .04], ['Atta Halwa', 'Atta', .04], ['Besan Halwa', 'Besan', .04], ['Lauki Halwa', 'Bottle gourd', .12], ['Kaddu Halwa', 'Pumpkin', .12], ['Beetroot Halwa', 'Beetroot', .12], ['Badam Halwa', 'Almonds', .04], ['Chana Dal Halwa', 'Chana dal', .04], ['Sweet Potato Halwa', 'Sweet potato', .12], ['Dudhi Halwa', 'Bottle gourd', .12], ['Poha Halwa', 'Poha', .04], ['Bread Halwa', 'Bread', 3], ['Singhare Halwa', 'Atta', .04]].forEach(([n, i, q]) => add(n, 'Sweet', [[i, q], ['Sugar', .03], ['Ghee', .02], ...(['Carrot', 'Bottle gourd', 'Pumpkin', 'Beetroot', 'Sweet potato'].includes(i) ? [['Milk', .06]] : []), ['Raisins', .004], ['Cardamom', .0002]]));
  [['Besan Ladoo', 'Besan', .04], ['Motichoor Ladoo', 'Besan', .04], ['Boondi Ladoo', 'Besan', .04], ['Suji Ladoo', 'Suji', .04], ['Atta Ladoo', 'Atta', .04], ['Coconut Ladoo', 'Coconut', .04], ['Til Ladoo', 'Sesame seeds', .03], ['Peanut Ladoo', 'Peanuts', .035], ['Dry Fruit Ladoo', 'Dry fruits', .04], ['Rava Ladoo', 'Suji', .04], ['Moong Dal Ladoo', 'Moong dal', .04], ['Churma Ladoo', 'Atta', .05], ['Makhana Ladoo', 'Makhana', .03], ['Dates Ladoo', 'Dates', .04], ['Ragi Ladoo', 'Ragi flour', .04]].forEach(([n, i, q]) => add(n, 'Sweet', [[i, q], [/Til|Peanut|Dry Fruit|Makhana|Dates/.test(n) ? 'Jaggery' : 'Sugar', .03], ['Ghee', .02], ['Cardamom', .0002]]));
  [['Kheer', 'Rice', .015], ['Sewai Kheer', 'Vermicelli', .03], ['Sabudana Kheer', 'Sabudana', .02], ['Lauki Kheer', 'Bottle gourd', .08], ['Carrot Kheer', 'Carrot', .08], ['Makhana Kheer', 'Makhana', .02], ['Phirni', 'Rice flour', .02], ['Suji Kheer', 'Suji', .025], ['Dalia Kheer', 'Daliya', .03], ['Chana Dal Payasam', 'Chana dal', .03], ['Semiya Payasam', 'Vermicelli', .03], ['Rice Payasam', 'Rice', .02], ['Paal Payasam', 'Rice', .02], ['Moong Dal Payasam', 'Moong dal', .03], ['Gud Ki Kheer', 'Rice', .02]].forEach(([n, i, q]) => add(n, 'Sweet', [[i, q], ['Milk', .15], [/Gud|Payasam/.test(n) ? 'Jaggery' : 'Sugar', .02], ['Dry fruits', .004], ['Cardamom', .0002]]));
  [['Gulab Jamun', [['Khoya', .03], ['Maida', .01], ['Sugar', .04], ['Oil', .02]]], ['Rasgulla', [['Milk', .2], ['Sugar', .04], ['Lemon', .1]]], ['Rasmalai', [['Milk', .25], ['Sugar', .04], ['Dry fruits', .004]]], ['Jalebi', [['Maida', .05], ['Sugar', .05], ['Oil', .03], ['Curd', .01]]], ['Imarti', [['Urad dal', .04], ['Sugar', .05], ['Oil', .03]]], ['Kalakand', [['Milk', .3], ['Sugar', .03]]], ['Peda', [['Khoya', .05], ['Sugar', .03]]], ['Barfi', [['Khoya', .05], ['Sugar', .035]]], ['Kaju Barfi', [['Cashew', .04], ['Sugar', .03]]], ['Besan Barfi', [['Besan', .04], ['Sugar', .035], ['Ghee', .025]]], ['Coconut Barfi', [['Coconut', .04], ['Sugar', .03], ['Milk', .03]]], ['Milk Cake', [['Milk', .3], ['Sugar', .03]]], ['Soan Papdi', [['Besan', .02], ['Maida', .02], ['Sugar', .04], ['Ghee', .02]]], ['Mysore Pak', [['Besan', .04], ['Ghee', .05], ['Sugar', .05]]], ['Rabri', [['Milk', .3], ['Sugar', .03]]], ['Basundi', [['Milk', .25], ['Sugar', .025], ['Dry fruits', .004]]], ['Shrikhand', [['Curd', .12], ['Sugar', .03], ['Dry fruits', .004]]], ['Custard', [['Milk', .15], ['Custard powder', .01], ['Sugar', .02]]], ['Fruit Custard', [['Milk', .15], ['Custard powder', .01], ['Banana', 1], ['Apple', .5], ['Sugar', .02]]], ['Ice Cream Scoop', [['Milk', .1], ['Sugar', .02]]], ['Kulfi', [['Milk', .25], ['Sugar', .03], ['Cardamom', .0003]]], ['Jelly', [['Jelly crystals', .01]]], ['Cake Slice', [['Maida', .04], ['Sugar', .03], ['Butter', .02], ['Eggs', .5]]], ['Biscuit Pudding', [['Milk', .15], ['Sugar', .02]]], ['Chocolate Pudding', [['Milk', .15], ['Cocoa', .01], ['Sugar', .025]]], ['Bread Pudding', [['Bread', 3], ['Milk', .15], ['Sugar', .03]]], ['Malai Kofta Sweet', [['Khoya', .03], ['Paneer', .03]]], ['Anjeer Barfi', [['Fig', .03], ['Dry fruits', .02]]], ['Gajak', [['Sesame seeds', .03], ['Jaggery', .03]]], ['Chikki', [['Peanuts', .03], ['Jaggery', .03]]], ['Rewri', [['Sesame seeds', .02], ['Sugar', .03]]]].forEach(([n, i]) => add(n, 'Sweet', i));
  [['Tea', [['Milk', .08], ['Sugar', .012], ['Tea leaves', .003]]], ['Masala Chai', [['Milk', .08], ['Sugar', .012], ['Tea leaves', .003], ['Ginger', .003], ['Cardamom', .0002]]], ['Black Tea', [['Sugar', .01], ['Tea leaves', .003]]], ['Green Tea', [['Tea leaves', .002]]], ['Lemon Tea', [['Sugar', .012], ['Tea leaves', .003], ['Lemon', .25]]], ['Coffee', [['Milk', .12], ['Sugar', .012], ['Coffee', .003]]], ['Cold Coffee', [['Milk', .2], ['Sugar', .02], ['Coffee', .004]]], ['Hot Milk', [['Milk', .2], ['Sugar', .01]]], ['Haldi Milk', [['Milk', .2], ['Turmeric', .001], ['Sugar', .01]]], ['Badam Milk', [['Milk', .2], ['Almonds', .01], ['Sugar', .015]]], ['Bournvita Milk', [['Milk', .2], ['Cocoa', .01], ['Sugar', .01]]], ['Lassi', [['Curd', .12], ['Sugar', .015], ['Milk', .05]]], ['Salted Lassi', [['Curd', .12], ['Salt', .002], ['Cumin seeds', .0005]]], ['Mango Lassi', [['Curd', .1], ['Mango', .3], ['Sugar', .01]]], ['Chaas', [['Curd', .06], ['Cumin seeds', .0005], ['Black salt', .0005], ['Coriander leaves', .003]]], ['Nimbu Pani', [['Lemon', .5], ['Sugar', .02], ['Salt', .001]]], ['Jaljeera', [['Lemon', .3], ['Cumin seeds', .001], ['Black salt', .001], ['Mint leaves', .005], ['Sugar', .005]]], ['Aam Panna', [['Raw mango', .1], ['Sugar', .03], ['Cumin seeds', .0005]]], ['Sattu Sharbat', [['Sattu', .03], ['Sugar', .015], ['Lemon', .3]]], ['Rose Sharbat', [['Rose syrup', .03]]], ['Thandai', [['Milk', .2], ['Almonds', .01], ['Sugar', .02], ['Fennel seeds', .001]]], ['Banana Shake', [['Milk', .2], ['Banana', 1], ['Sugar', .015]]], ['Mango Shake', [['Milk', .2], ['Mango', .3], ['Sugar', .015]]], ['Chikoo Shake', [['Milk', .2], ['Sugar', .015]]], ['Oreo Shake', [['Milk', .2], ['Sugar', .02]]], ['Chocolate Shake', [['Milk', .2], ['Cocoa', .01], ['Sugar', .02]]], ['Buttermilk Masala', [['Buttermilk', .2], ['Cumin seeds', .0005], ['Salt', .002]]]].forEach(([n, i]) => add(n, 'Drink', i));
  [['Salad', [['Onion', .03], ['Cucumber', .04], ['Tomato', .03], ['Lemon', .2], ['Carrot', .02], ['Salt', .001]]], ['Green Salad', [['Cucumber', .05], ['Tomato', .04], ['Cabbage', .02], ['Lemon', .2], ['Salt', .001]]], ['Kachumber Salad', [['Onion', .04], ['Cucumber', .04], ['Tomato', .04], ['Coriander leaves', .005], ['Lemon', .2], ['Chaat masala', .001]]], ['Onion Salad', [['Onion', .05], ['Lemon', .2], ['Green chilli', .003]]], ['Carrot Salad', [['Carrot', .06], ['Lemon', .2], ['Peanuts', .005]]], ['Beetroot Salad', [['Beetroot', .06], ['Lemon', .2]]], ['Cabbage Salad', [['Cabbage', .06], ['Carrot', .02], ['Lemon', .2]]], ['Sprouts Chaat', [['Moong (whole)', .04], ['Onion', .02], ['Tomato', .02], ['Lemon', .2]]], ['Corn Salad', [['Corn', .06], ['Onion', .02], ['Lemon', .2]]], ['Fruit Salad', [['Banana', 1], ['Apple', .5], ['Orange', .5], ['Chaat masala', .001]]], ['Boondi Raita', [['Curd', .08], ['Namkeen', .01], ['Cumin seeds', .0004], ['Salt', .002]]], ['Mix Raita', [['Curd', .08], ['Cucumber', .02], ['Onion', .01], ['Tomato', .01], ['Cumin seeds', .0004], ['Salt', .002]]], ['Cucumber Raita', [['Curd', .08], ['Cucumber', .04], ['Cumin seeds', .0004], ['Salt', .002]]], ['Pineapple Raita', [['Curd', .08], ['Sugar', .008]]], ['Aloo Raita', [['Curd', .08], ['Potato', .05], ['Cumin seeds', .0004], ['Salt', .002]]], ['Pudina Raita', [['Curd', .08], ['Mint leaves', .008], ['Salt', .002]]], ['Lauki Raita', [['Curd', .08], ['Bottle gourd', .05], ['Salt', .002]]], ['Beetroot Raita', [['Curd', .08], ['Beetroot', .04], ['Salt', .002]]], ['Plain Curd', [['Curd', .1]]], ['Papad', [['Papad', 1], ['Oil', .004]]], ['Roasted Papad', [['Papad', 1]]], ['Masala Papad', [['Papad', 1], ['Onion', .02], ['Tomato', .02], ['Chaat masala', .001]]], ['Mango Pickle', [['Pickle', .01]]], ['Lemon Pickle', [['Pickle', .01]]], ['Mixed Pickle', [['Pickle', .01]]], ['Green Chilli Pickle', [['Pickle', .008]]], ['Boiled Egg Salad', [['Eggs', 1], ['Onion', .02], ['Black pepper', .0003]]], ['Banana', [['Banana', 1]]], ['Apple', [['Apple', 1]]], ['Orange', [['Orange', 1]]], ['Papaya Slice', [['Papaya (fruit)', 1]]], ['Watermelon Slice', [['Watermelon slice', 1]]], ['Roasted Peanuts', [['Peanuts', .03]]], ['Boiled Corn', [['Corn', .1], ['Salt', .001]]], ['Boiled Sweet Potato', [['Sweet potato', .12]]], ['Boiled Chana', [['Kala chana', .04], ['Salt', .002]]], ['Sprouts', [['Moong (whole)', .04]]]].forEach(([n, i]) => add(n, /Raita|Curd/.test(n) ? 'Raita' : /Pickle|Papad/.test(n) ? 'Side' : /Salad|Chaat/.test(n) ? 'Salad' : 'Side', i));
  return L;
})();

// Hindi names of the library ingredients. A new stock item is named "English (हिन्दी)" so the cook can read it, and an item
// already in stock under either name is reused (never a second copy).
const ING_HI = {"Rice":"चावल","Atta":"आटा","Maida":"मैदा","Besan":"बेसन","Suji":"सूजी","Poha":"पोहा","Sabudana":"साबूदाना","Vermicelli":"सेवइयाँ","Macaroni":"मैकरोनी","Spaghetti":"स्पेगेटी","Noodles":"नूडल्स","Oats":"ओट्स","Daliya":"दलिया","Bajra flour":"बाजरे का आटा","Jowar flour":"ज्वार का आटा","Makki flour":"मक्के का आटा","Ragi flour":"रागी का आटा","Sattu":"सत्तू","Rice flour":"चावल का आटा","Murmura":"मुरमुरा","Cornflour":"कॉर्नफ्लोर","Corn flakes":"कॉर्न फ्लेक्स","Toor dal":"अरहर दाल","Moong dal":"मूंग दाल","Chana dal":"चना दाल","Urad dal":"उड़द दाल","Masoor dal":"मसूर दाल","Rajma":"राजमा","Chole":"छोले","Kala chana":"काला चना","Moong (whole)":"साबुत मूंग","Lobia":"लोबिया","Soya chunks":"सोया चंक्स","Matar dry":"सूखा मटर","Ghee":"घी","Butter":"मक्खन","Curd":"दही","Paneer":"पनीर","Cheese":"चीज़","Cream":"मलाई","Sugar":"चीनी","Jaggery":"गुड़","Tea leaves":"चायपत्ती","Coffee":"कॉफ़ी","Chicken":"चिकन","Mutton":"मटन","Fish":"मछली","Prawns":"झींगा","Onion":"प्याज़","Tomato":"टमाटर","Potato":"आलू","Green chilli":"हरी मिर्च","Ginger":"अदरक","Garlic":"लहसुन","Coriander leaves":"हरा धनिया","Mint leaves":"पुदीना","Curry leaves":"कढ़ी पत्ता","Cauliflower":"फूलगोभी","Cabbage":"पत्तागोभी","Peas":"मटर","Brinjal":"बैंगन","Lady finger":"भिंडी","Bottle gourd":"लौकी","Ridge gourd":"तोरी","Pumpkin":"कद्दू","Spinach":"पालक","Methi":"मेथी","Carrot":"गाजर","Beans":"फलियाँ","Capsicum":"शिमला मिर्च","Mushroom":"मशरूम","Bitter gourd":"करेला","Colocasia":"अरबी","Raw banana":"कच्चा केला","Sweet potato":"शकरकंद","Radish":"मूली","Beetroot":"चुकंदर","Cucumber":"खीरा","Corn":"भुट्टा","Mixed vegetables":"मिक्स सब्ज़ी","Sarson leaves":"सरसों का साग","Drumstick":"सहजन","Tinda":"टिंडा","Cluster beans":"ग्वार फली","Kundru":"कुंदरू","Parwal":"परवल","Jackfruit":"कटहल","Snake gourd":"चिचिंडा","Yam":"सूरन","Lotus stem":"कमल ककड़ी","Baby corn":"बेबी कॉर्न","Broccoli":"ब्रोकली","Turnip":"शलजम","Raw papaya":"कच्चा पपीता","Bathua":"बथुआ","Raw mango":"कच्चा आम","Spring onion":"हरी प्याज़","Cumin seeds":"जीरा","Mustard seeds":"सरसों के दाने","Fennel seeds":"सौंफ","Ajwain":"अजवाइन","Kalonji":"कलौंजी","Sesame seeds":"तिल","Poppy seeds":"खसखस","Fenugreek seeds":"मेथी दाना","Turmeric":"हल्दी","Red chilli powder":"लाल मिर्च पाउडर","Dry red chilli":"सूखी लाल मिर्च","Coriander powder":"धनिया पाउडर","Garam masala":"गरम मसाला","Black pepper":"काली मिर्च","Hing":"हींग","Cardamom":"इलायची","Cloves":"लौंग","Cinnamon":"दालचीनी","Bay leaf":"तेज पत्ता","Kasuri methi":"कसूरी मेथी","Chaat masala":"चाट मसाला","Amchur":"अमचूर","Sambar powder":"सांभर मसाला","Rasam powder":"रसम पाउडर","Pav bhaji masala":"पावभाजी मसाला","Chole masala":"छोले मसाला","Biryani masala":"बिरयानी मसाला","Tandoori masala":"तंदूरी मसाला","Kitchen king masala":"किचन किंग मसाला","Salt":"नमक","Black salt":"काला नमक","Tamarind":"इमली","Coconut":"नारियल","Peanuts":"मूंगफली","Cashew":"काजू","Almonds":"बादाम","Raisins":"किशमिश","Dry fruits":"मेवा","Pickle":"अचार","Ketchup":"केचप","Soy sauce":"सोया सॉस","Vinegar":"सिरका","Chilli sauce":"चिली सॉस","Khoya":"खोया","Sev":"सेव","Namkeen":"नमकीन","Baking soda":"खाने का सोडा","Custard powder":"कस्टर्ड पाउडर","Cocoa":"कोको","Khus khus":"खसखस","Mayonnaise":"मेयोनेज़","Jelly crystals":"जेली","Rose syrup":"गुलाब शरबत","Makhana":"मखाना","Dates":"खजूर","Fig":"अंजीर","Honey":"शहद","Chocolate":"चॉकलेट","Rabri":"रबड़ी","Oil":"तेल","Milk":"दूध","Coconut milk":"नारियल दूध","Buttermilk":"छाछ","Eggs":"अंडे","Lemon":"नींबू","Banana":"केला","Papad":"पापड़","Bread":"ब्रेड","Pav":"पाव","Bun":"बन","Pizza base":"पिज़्ज़ा बेस","Tortilla":"टॉर्टिला","Apple":"सेब","Orange":"संतरा","Mango":"आम","Papaya (fruit)":"पपीता","Watermelon slice":"तरबूज़"};
const ingBoth = n => (ING_HI[n] ? `${n} (${ING_HI[n]})` : n);
const stockByName = n => { const k = String(n).toLowerCase(), hi = (ING_HI[n] || '').toLowerCase(), b = ingBoth(n).toLowerCase(); return items().find(z => { const zn = String(z.name).toLowerCase(); return zn === k || zn === b || (hi && (zn === hi || zn.startsWith(k + ' (') || zn.includes('(' + hi + ')'))); }); };
// "Masala & spices" in a hand-written entry is turned into the real spices (turmeric, chilli, coriander ...), not left as one lump
(function explode() {
  DISH_LIB.forEach(d => { d.ings = d.ings.flatMap(([n, q]) => { if (n !== 'Masala & spices') return [[n, q]]; const prof = SPICES[SPLIT[d.cat] || 'gravy']; const tot = prof.reduce((a, b) => a + b[1], 0) || 1; return prof.map(([sn, sq]) => [sn, Math.round(q * sq / tot * 1e5) / 1e5]); }); });
})();
// Everything here runs in the phone; typing in the dish name never calls a server. The list is built once and looked up by Map.
let _dishIdx = null, _dishSg = null;
const dishLibFind = name => { if (!_dishIdx) _dishIdx = new Map(DISH_LIB.map(x => [x.name.toLowerCase(), x])); const k = String(name || '').trim().toLowerCase(); return k ? _dishIdx.get(k) || null : null; };
const dishLibSuggest = () => _dishSg || (_dishSg = DISH_LIB.map(z => ({ v: z.name, sub: z.cat, lc: z.name.toLowerCase() })));
// Ingredient rows for a library dish, scaled to `people`; quantities converted to the unit the stock item is kept in.
function dishLibRows(entry, people) {
  const n = Math.max(1, +people || 1);
  return entry.ings.map(([name, per]) => {
    const it = stockByName(name);
    let unit = ING_UNIT[name] || 'kg', qty = per * n;
    if (it && it.unit && it.unit !== unit) { const f = UNIT_CONV[unit + '>' + it.unit]; if (f != null) { qty *= f; unit = it.unit; } }
    if (it && it.unit && it.unit === unit) unit = it.unit;
    // tiny spice amounts are shown in grams so "0.02 kg" never reads as 0
    if (unit === 'kg' && qty < 0.1 && !(it && it.unit === 'kg')) { qty *= 1000; unit = 'g'; }
    else if (unit === 'L' && qty < 0.05 && !(it && it.unit === 'L')) { qty *= 1000; unit = 'ml'; }
    const dec = unit === 'pcs' ? 1 : unit === 'g' || unit === 'ml' ? 1 : 3;
    return { name: it ? it.name : ingBoth(name), qty: Math.max(Math.round(qty * Math.pow(10, dec)) / Math.pow(10, dec), Math.pow(10, -dec)), unit };
  });
}

