/* The hostel's complete analysis, as one Excel workbook.
 *
 * Everything is worked out from the records already in the app for a period the owner chooses
 * (this month, last month, a financial year, any two dates). One workbook, many tabs:
 *
 *   <Hostel> Complete Analysis   the whole picture on one page: KPIs, P&L, cash flow, costs,
 *                                dues, occupancy, electricity, inventory, laundry, payroll
 *   P&L · Cash Flow              month by month, with live totals and net lines
 *   Cost Analysis                every expense category, per bed and per resident, vs last period
 *   Revenue & Dues               billed vs collected, ageing of what is owed, who owes
 *   Occupancy · Electricity · Inventory · Laundry · Payroll
 *   Payments · Expenses          the ledgers behind the numbers
 *
 * Loaded on demand (js/xlsx.js first) so the app itself stays light. Totals are real formulas
 * (with their values stored too), so the owner can edit a cell and the sheet follows.
 */
const Report = (() => {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dmy = iso => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
  const ymLabel = ym => `${MON[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
  const monthsOf = (from, to) => { const out = []; for (let m = ymOf(from); m <= ymOf(to); m = addMonths(m, 1)) out.push(m); return out; };
  const inR = (d, a, b) => !!d && String(d).slice(0, 10) >= a && String(d).slice(0, 10) <= b;
  const ratio = (a, b) => (b ? a / b : 0);
  const lastDay = ym => `${ym}-${String(daysIn(ym)).padStart(2, '0')}`;   // the periods themselves (presets, custom range) live in domain.js
  const L = i => Xlsx.colName(i);
  const bucket = (list, key, val) => { const o = {}; for (const x of list) { const k = key(x); o[k] = round2((o[k] || 0) + val(x)); } return o; };
  const tot = o => round2(sum(Object.values(o || {})));
  const TYPE_NAME = { rent: 'Rent', electricity: 'Electricity', laundry: 'Laundry', late: 'Late fees', penalty: 'Penalties', mess: 'Mess', other: 'Other income', deposit: 'Security deposits', advance: 'Advance / credit' };
  const TYPE_ORDER = ['rent', 'electricity', 'laundry', 'late', 'penalty', 'mess', 'other'];

  /* ---------- the numbers ---------- */
  function compute(from, to) {
    return withAllBlocks(() => {
      const t0 = today(), months = monthsOf(from, to), days = diffDays(to, from) + 1, pTo = addDays(from, -1), pFrom = addDays(from, -days);
      const D = { hostel: (Store.hostel() || {}).name || 'Hostel', from, to, today: t0, days, months, pFrom, pTo };

      // revenue billed (accrual): every bill dated in the period, less anything waived. Deposits are not income.
      const billedIn = (a, b) => invoices().filter(i => i.type !== 'deposit' && inR(i.date, a, b));
      const bills = billedIn(from, to), billsPrev = billedIn(pFrom, pTo), net = i => (i.amount || 0) - (i.waived || 0);
      D.rev = { by: {}, total: {}, prev: {} };
      for (const ty of [...new Set(bills.map(i => i.type))]) { D.rev.by[ty] = bucket(bills.filter(i => i.type === ty), i => ymOf(i.date), net); D.rev.total[ty] = tot(D.rev.by[ty]); }
      for (const i of billsPrev) D.rev.prev[i.type] = round2((D.rev.prev[i.type] || 0) + net(i));
      D.rev.types = [...TYPE_ORDER.filter(ty => ty in D.rev.by || ty in D.rev.prev), ...Object.keys(D.rev.by).filter(ty => !TYPE_ORDER.includes(ty))];
      D.rev.all = tot(D.rev.total); D.rev.prevAll = tot(D.rev.prev);
      D.billed = round2(sum(bills, i => i.amount || 0)); D.waived = round2(sum(bills, i => i.waived || 0));
      D.billedPaid = round2(sum(bills, i => Math.min(i.paid || 0, net(i))));

      // expenses (accrual, by the date on the bill) and what is still unpaid
      const exps = Store.all('exp').filter(e => inR(e.date, from, to)).sort(by('date')), expPrev = Store.all('exp').filter(e => inR(e.date, pFrom, pTo));
      D.exp = { list: exps, by: {}, total: {}, prev: {} };
      for (const c of [...new Set(exps.map(e => e.cat || 'Other'))]) { D.exp.by[c] = bucket(exps.filter(e => (e.cat || 'Other') === c), e => ymOf(e.date), e => +e.amount || 0); D.exp.total[c] = tot(D.exp.by[c]); }
      for (const e of expPrev) D.exp.prev[e.cat || 'Other'] = round2((D.exp.prev[e.cat || 'Other'] || 0) + (+e.amount || 0));
      D.exp.cats = Object.keys(D.exp.total).sort((a, b) => D.exp.total[b] - D.exp.total[a]);
      D.exp.all = tot(D.exp.total); D.exp.prevAll = tot(D.exp.prev);
      D.exp.unpaid = exps.filter(e => !e.paid);
      D.exp.byMode = bucket(exps, e => e.mode || 'cash', e => +e.amount || 0);
      D.exp.vendors = Object.entries(bucket(exps.filter(e => e.vendor), e => e.vendor, e => +e.amount || 0)).sort((a, b) => b[1] - a[1]);

      // payroll: what the staff earned (accrual, from attendance) and what was actually paid
      const staff = staffList(), paidSal = Store.all('sal');
      const payable = (a, b) => { const o = {}; for (const m of monthsOf(a, b)) o[m] = round2(sum(staff.filter(s => s.status === 'active'), s => payrollFor(s, m).payable)); return o; };
      D.payroll = { staff, by: payable(from, to), prev: payable(pFrom, pTo), paid: bucket(paidSal.filter(x => inR(x.date, from, to)), x => ymOf(x.date), x => +x.amount || 0) };
      D.payroll.all = tot(D.payroll.by); D.payroll.prevAll = tot(D.payroll.prev); D.payroll.paidAll = tot(D.payroll.paid);

      D.profit = round2(D.rev.all - D.exp.all - D.payroll.all); D.prevProfit = round2(D.rev.prevAll - D.exp.prevAll - D.payroll.prevAll);

      // cash flow: money that actually moved
      const pays = Store.all('pay').filter(p => inR(p.date, from, to)).sort(by('date'));
      D.pays = pays;
      D.cash = { inBy: {}, dep: {}, adv: {}, byMode: {}, out: {}, sal: D.payroll.paid, refund: {} };
      for (const p of pays) {
        const ym = ymOf(p.date);
        D.cash.byMode[p.mode || 'cash'] = round2((D.cash.byMode[p.mode || 'cash'] || 0) + (+p.amount || 0));
        for (const a of p.alloc || []) {
          const inv = Store.get(a.inv), ty = inv ? inv.type : 'other';
          if (ty === 'deposit') D.cash.dep[ym] = round2((D.cash.dep[ym] || 0) + a.amt);
          else { (D.cash.inBy[ty] = D.cash.inBy[ty] || {})[ym] = round2(((D.cash.inBy[ty] || {})[ym] || 0) + a.amt); }
        }
        if (p.credit > 0) D.cash.adv[ym] = round2((D.cash.adv[ym] || 0) + p.credit);
      }
      D.cash.inTypes = [...TYPE_ORDER.filter(ty => ty in D.cash.inBy), ...Object.keys(D.cash.inBy).filter(ty => !TYPE_ORDER.includes(ty))];
      for (const e of Store.all('exp').filter(e => e.paid && inR(e.paidOn || e.date, from, to))) { const c = e.cat || 'Other'; D.cash.out[c] = D.cash.out[c] || {}; const ym = ymOf(e.paidOn || e.date); D.cash.out[c][ym] = round2((D.cash.out[c][ym] || 0) + (+e.amount || 0)); }
      D.cash.outCats = Object.keys(D.cash.out).sort((a, b) => tot(D.cash.out[b]) - tot(D.cash.out[a]));
      D.cash.refund = bucket(Store.all('dep').filter(d => d.status === 'paid' && inR(d.paidOn, from, to)), d => ymOf(d.paidOn), d => +d.refund || 0);
      D.cash.inAll = round2(sum(D.cash.inTypes, ty => tot(D.cash.inBy[ty])) + tot(D.cash.dep) + tot(D.cash.adv));
      D.cash.outAll = round2(sum(D.cash.outCats, c => tot(D.cash.out[c])) + tot(D.cash.sal) + tot(D.cash.refund));
      D.cash.net = round2(D.cash.inAll - D.cash.outAll);
      D.collected = round2(sum(D.cash.inTypes, ty => tot(D.cash.inBy[ty])));

      // what is owed right now, and for how long
      const open = invoices().filter(i => i.type !== 'deposit' && invBal(i) > 0), age = { 'Not yet due': 0, '1–30 days': 0, '31–60 days': 0, '61–90 days': 0, 'Over 90 days': 0 };
      for (const i of open) { const d = diffDays(t0, i.due || i.date); age[d <= 0 ? 'Not yet due' : d <= 30 ? '1–30 days' : d <= 60 ? '31–60 days' : d <= 90 ? '61–90 days' : 'Over 90 days'] += invBal(i); }
      D.age = age; D.dues = round2(sum(open, invBal));
      D.owing = Object.entries(groupBy(open, i => i.resId)).map(([id, l]) => { const r = resById(id) || {}; const od = l.filter(i => (i.due || i.date) < t0); return { r, room: r.roomId ? roomName(r.roomId) : '', due: round2(sum(l, invBal)), overdue: round2(sum(od, invBal)), oldest: l.map(i => i.due || i.date).sort()[0], days: Math.max(0, diffDays(t0, l.map(i => i.due || i.date).sort()[0])) }; }).sort((a, b) => b.due - a.due);
      const depInv = invoices().filter(i => i.type === 'deposit' && resById(i.resId) && ['active', 'notice'].includes((resById(i.resId) || {}).status));
      D.depositHeld = round2(sum(depInv, i => i.paid || 0)); D.refundPending = round2(sum(Store.all('dep').filter(d => d.status === 'pending'), d => +d.refund || 0));

      // beds, residents, electricity
      const rs = rooms(), occ = occupancy(), act = activeRes();
      D.occ = occ; D.activeN = act.length; D.rentRoll = round2(sum(act, r => +r.rent || 0));
      D.rooms = rs.map(rm => { const beds = bedsOf(rm), used = beds.filter(b => b.status === 'occ').length, total = beds.filter(b => b.status !== 'mnt').length, people = act.filter(r => r.roomId === rm.id); return { rm, total, used, vac: total - used, names: people.map(r => r.name).join(', '), roll: round2(sum(people, r => +r.rent || 0)), loss: round2((total - used) * (+rm.rent || 0)), billed: round2(sum(bills.filter(i => i.type === 'rent' && i.roomId === rm.id), net)) }; });
      D.vacLoss = round2(sum(D.rooms, x => x.loss));
      D.occTrend = months.map(m => { const d = m === ymOf(t0) ? t0 : lastDay(m), n = allResidents().filter(r => activeOn(r, d)).length; return { m, d, n, pct: ratio(n, occ.total) }; });
      D.moveIns = allResidents().filter(r => inR(r.checkIn, from, to)).sort(by('checkIn')); D.moveOuts = allResidents().filter(r => inR(r.left, from, to)).sort(by('left'));
      D.meters = meters().filter(m => !m.opening && inR(m.date, from, to)).sort(by('date'));
      D.elec = { units: round2(sum(D.meters, m => m.units || 0)), amount: round2(sum(D.meters, m => m.total || 0)), byM: bucket(D.meters, m => ymOf(m.date), m => m.units || 0), amtM: bucket(D.meters, m => ymOf(m.date), m => m.total || 0) };

      // inventory
      const its = items(), prs = Store.all('pr').filter(p => p.status === 'received' && inR(p.receivedOn, from, to)).sort(by('receivedOn')), mv = null;
      D.inv = its.map(it => { const si = stockInfo(it), bought = prs.flatMap(p => p.items).filter(x => x.itemId === it.id), q = fromM(sum(bought, x => toM(x.recvQty))), c = sum(bought, x => lineTotal(x.recvQty, x.rate)) / 100, mvs = itemMoves(it.id, from, to), used = fromM(-sum(mvs.filter(x => x.type === 'use'), x => x.qm)), adj = fromM(sum(mvs.filter(x => ['count', 'adjust', 'waste'].includes(x.type)), x => x.qm)); return { it, si, st: stockOf(it), q, c, used, adj, value: Math.round(stockM(it) * paise(it.rate) / MILLI) / 100, usedValue: Math.round(toM(used) * paise(it.rate) / MILLI) / 100 }; }).sort((a, b) => b.value - a.value);
      D.prs = prs;
      D.invTotals = { value: round2(sum(D.inv, x => x.value)), bought: round2(sum(D.inv, x => x.c)), usedValue: round2(sum(D.inv, x => x.usedValue)), low: D.inv.filter(x => x.si.low).length };

      // laundry
      D.ld = Store.all('laundry').filter(l => inR(l.date, from, to)).sort(by('date'));
      D.ldBy = Object.entries(groupBy(D.ld, l => l.resId)).map(([id, l]) => ({ r: resById(id) || {}, n: l.length, pcs: sum(l, x => +x.pcs || 0), extra: sum(l, x => +x.extra || 0), charge: round2(sum(l, x => +x.charge || 0)) })).sort((a, b) => b.pcs - a.pcs);
      D.ldM = { pcs: bucket(D.ld, l => ymOf(l.date), l => +l.pcs || 0), extra: bucket(D.ld, l => ymOf(l.date), l => +l.extra || 0), charge: bucket(D.ld, l => ymOf(l.date), l => +l.charge || 0) };
      return D;
    });
  }

  /* ---------- sheet builder ---------- */
  const c = {
    t: (v, s = 'td') => ({ v: v == null ? '' : v, s }),
    n: (v, s = 'tdN') => ({ v: +v || 0, s }),
    m: v => ({ v: round2(v), s: 'tdM' }),
    p: v => ({ v: Number.isFinite(v) ? v : 0, s: 'tdP' }),
    d: iso => (iso ? { v: iso, t: 'd', s: 'tdDate' } : { v: '', s: 'td' }),
    f: (f, v, s = 'totM') => ({ f, v: Number.isFinite(v) ? v : 0, s }),
  };
  const hf = s => String(s).replace(/&/g, '&&');
  function Sh(D, name, { tab, cols, portrait, title }) {
    const n = cols.length, last = L(n - 1), rows = [], merges = [], heights = {}, bars = [];
    const push = r => { rows.push(r); return rows.length; };
    const span = (text, style, h) => { const r = push([{ v: text, s: style }, ...Array.from({ length: n - 1 }, () => ({ blank: 1, s: style }))]); if (n > 1) merges.push(`A${r}:${last}${r}`); if (h) heights[r] = h; return r; };
    const S = {
      D, rows, n,
      banner(text, sub) { span(text, 'title', 38); span(sub, 'titleSub', 20); push([]); },
      section(text) { span(text, 'h1', 22); },
      sub(text) { span(text, 'h2', 20); },
      note(text, style = 'note', h = 28) { span(text, style, h); },
      gap() { push([]); },
      head(labels, h = 32) { const r = push(labels.map((x, i) => ({ v: x, s: i ? 'th' : 'thL' }))); heights[r] = h; return r; },
      row(cells) { return push(cells); },
      next: () => rows.length + 1,
      bar(col, r1, r2, color, max) { if (r2 >= r1) bars.push({ ref: `${col}${r1}:${col}${r2}`, color, max }); },
      spec() {
        return { name, tab, cols, rows, merges, bars, heights, portrait, freeze: S.freeze, filter: S.filter, titleRows: S.titleRows,
          header: `&L&"Calibri,Bold"${hf(D.hostel)}&"Calibri,Regular"&C${hf(title || name)}&R${hf(D.label)}`,
          footer: `&LGenerated by Sarvlekh on ${hf(dmy(D.today))}&CPage &P of &N&R${hf(D.hostel)} · Confidential` };
      },
    };
    S.banner(`${D.hostel} — ${title || name}`, `${D.label}   ·   Generated ${dmy(D.today)}`);
    return S;
  }
  const growth = (a, b) => (b ? (a - b) / Math.abs(b) : 0);   // same as the sheet formulas: no previous figure → 0

  // A block of monthly lines with a total column, a share column and a total row (live formulas).
  function monthBlock(S, months, lines, totalLabel, { share = true, style = 'tdM' } = {}) {
    const first = S.next(), tr = first + lines.length, nm = months.length, tc = L(nm + 1), sc = L(nm + 2);
    lines.forEach((ln, i) => {
      const r = first + i, vals = months.map(m => ln.vals[m] || 0), t = round2(sum(vals));
      S.row([c.t(ln.label), ...vals.map(v => ({ v, s: style })), c.f(`SUM(B${r}:${L(nm)}${r})`, t, 'tdM'), ...(share ? [c.f(`IF(${tc}${tr}=0,0,${tc}${r}/${tc}${tr})`, ratio(t, round2(sum(lines, x => sum(months, m => x.vals[m] || 0)))), 'tdP')] : [])]);
    });
    const colTot = months.map(m => round2(sum(lines, x => x.vals[m] || 0))), grand = round2(sum(colTot));
    S.row([c.t(totalLabel, 'totL'), ...months.map((m, j) => c.f(`SUM(${L(j + 1)}${first}:${L(j + 1)}${tr - 1})`, colTot[j])), c.f(`SUM(B${tr}:${L(nm)}${tr})`, grand), ...(share ? [c.f(`SUM(${sc}${first}:${sc}${tr - 1})`, lines.length ? 1 : 0, 'totP')] : [])]);
    if (share) S.bar(sc, first, tr - 1);
    return { first, tr, colTot, grand };
  }
  const delta = (a, b) => ({ v: growth(a, b), s: 'tdP' });

  /* ---------- the sheets ---------- */
  function sheetSummary(D) {
    const S = Sh(D, `${D.hostel} Complete Analysis`.length <= 31 ? `${D.hostel} Complete Analysis` : `${D.hostel.slice(0, 22).trim()} Analysis`, { tab: '0F5132', cols: [34, 16, 16, 16, 16, 16, 16, 16], title: 'Complete Analysis' });
    S.freeze = { row: 3 };
    // KPI tiles: four per row, each two columns wide (merged below once the rows are known).
    const kp = [];
    const tiles = list => {
      kp.push(S.row(list.flatMap(x => [{ v: x[0], s: 'kpiL' }, { blank: 1, s: 'kpiL' }])), S.row(list.flatMap(x => [{ v: x[1], s: x[2] }, { blank: 1, s: x[2] }])));
    };
    const margin = ratio(D.profit, D.rev.all), coll = ratio(D.billedPaid, D.billed);
    S.section('Key numbers');
    tiles([['Revenue billed', D.rev.all, 'kpiM'], ['Cash collected', D.collected, 'kpiM'], ['Total costs', round2(D.exp.all + D.payroll.all), 'kpiM'], ['Net profit', D.profit, 'kpiM']]);
    tiles([['Profit margin', margin, 'kpiP'], ['Collection rate', coll, 'kpiP'], ['Occupancy now', ratio(D.occ.occ, D.occ.total), 'kpiP'], ['Dues outstanding', D.dues, 'kpiM']]);
    S.gap();
    const kr = S.rows.length;
    // P&L
    S.section('Profit & Loss');
    S.head(['', 'This period', 'Previous period', 'Change']);
    const pl0 = S.next();
    for (const ty of D.rev.types) { const a = D.rev.total[ty] || 0, b = D.rev.prev[ty] || 0; S.row([c.t(TYPE_NAME[ty] || ty), c.m(a), c.m(b), delta(a, b)]); }
    const plr = S.next() - 1;
    S.row([c.t('Total revenue', 'totL'), c.f(`SUM(B${pl0}:B${plr})`, D.rev.all), c.f(`SUM(C${pl0}:C${plr})`, D.rev.prevAll), c.f(`IF(C${plr + 1}=0,0,(B${plr + 1}-C${plr + 1})/ABS(C${plr + 1}))`, growth(D.rev.all, D.rev.prevAll), 'totP')]);
    const revRow = plr + 1, e0 = S.next();
    for (const cat of D.exp.cats.slice(0, 8)) { const a = D.exp.total[cat], b = D.exp.prev[cat] || 0; S.row([c.t(cat), c.m(a), c.m(b), delta(a, b)]); }
    const restA = round2(sum(D.exp.cats.slice(8), x => D.exp.total[x])), restB = round2(sum(D.exp.cats.slice(8), x => D.exp.prev[x] || 0));
    if (D.exp.cats.length > 8) S.row([c.t('Other expenses'), c.m(restA), c.m(restB), delta(restA, restB)]);
    const e1 = S.next() - 1;
    S.row([c.t('Operating expenses', 'totL'), c.f(`SUM(B${e0}:B${e1})`, D.exp.all), c.f(`SUM(C${e0}:C${e1})`, D.exp.prevAll), c.f(`IF(C${e1 + 1}=0,0,(B${e1 + 1}-C${e1 + 1})/ABS(C${e1 + 1}))`, growth(D.exp.all, D.exp.prevAll), 'totP')]);
    const expRow = e1 + 1;
    S.row([c.t('Payroll (staff module)'), c.m(D.payroll.all), c.m(D.payroll.prevAll), delta(D.payroll.all, D.payroll.prevAll)]);
    const payRow = S.next() - 1;
    S.row([c.t('NET PROFIT', 'totL'), c.f(`B${revRow}-B${expRow}-B${payRow}`, D.profit), c.f(`C${revRow}-C${expRow}-C${payRow}`, D.prevProfit), c.f(`IF(C${payRow + 1}=0,0,(B${payRow + 1}-C${payRow + 1})/ABS(C${payRow + 1}))`, growth(D.profit, D.prevProfit), 'totP')]);
    if (D.exp.total.Salary && D.payroll.all) S.note('Salary appears under Expenses AND in Payroll. If both hold the same salaries, count them once.', 'warn', 26);
    S.gap();
    // cash flow
    S.section('Cash flow');
    S.head(['', 'Amount', 'Share']);
    const cin = [['Rent, electricity & other collections', D.collected], ['Security deposits received', tot(D.cash.dep)], ['Advance / credit received', tot(D.cash.adv)]];
    const c0 = S.next();
    cin.forEach(([l, v], i) => S.row([c.t(l), c.m(v), c.f(`IF(B${c0 + 3}=0,0,B${c0 + i}/B${c0 + 3})`, ratio(v, D.cash.inAll), 'tdP')]));
    S.row([c.t('Total cash in', 'totL'), c.f(`SUM(B${c0}:B${c0 + 2})`, D.cash.inAll), { v: '', s: 'totL' }]);
    const o = [['Expenses paid', round2(sum(D.cash.outCats, x => tot(D.cash.out[x])))], ['Salaries paid', tot(D.cash.sal)], ['Deposit refunds paid', tot(D.cash.refund)]], o0 = S.next();
    o.forEach(([l, v], i) => S.row([c.t(l), c.m(v), c.f(`IF(B${o0 + 3}=0,0,B${o0 + i}/B${o0 + 3})`, ratio(v, D.cash.outAll), 'tdP')]));
    S.row([c.t('Total cash out', 'totL'), c.f(`SUM(B${o0}:B${o0 + 2})`, D.cash.outAll), { v: '', s: 'totL' }]);
    S.row([c.t('NET CASH FLOW', 'totL'), c.f(`B${c0 + 3}-B${o0 + 3}`, D.cash.net), { v: '', s: 'totL' }]);
    S.gap();
    // costs
    S.section('Where the money goes');
    S.head(['Category', 'Amount', 'Share of costs']);
    const k0 = S.next(), allCost = round2(D.exp.all + D.payroll.all), top = D.exp.cats.slice(0, 6);
    top.forEach((cat, i) => S.row([c.t(cat), c.m(D.exp.total[cat]), c.f(`IF(${allCost}=0,0,B${k0 + i}/${allCost})`, ratio(D.exp.total[cat], allCost), 'tdP')]));
    S.row([c.t('Payroll'), c.m(D.payroll.all), c.f(`IF(${allCost}=0,0,B${S.next()}/${allCost})`, ratio(D.payroll.all, allCost), 'tdP')]);
    S.bar('C', k0, S.next() - 1);
    S.gap();
    // collections
    S.section('Collections & dues');
    S.head(['', 'Amount']);
    const q0 = S.next();
    S.row([c.t('Billed this period (excl. deposits)'), c.m(D.billed)]); S.row([c.t('Collected against those bills'), c.m(D.billedPaid)]);
    S.row([c.t('Collection rate', 'totL'), c.f(`IF(B${q0}=0,0,B${q0 + 1}/B${q0})`, ratio(D.billedPaid, D.billed), 'totP')]);
    for (const [k, v] of Object.entries(D.age)) S.row([c.t(`Owed — ${k}`), c.m(v)]);
    S.row([c.t('Total owed today', 'totL'), c.f(`SUM(B${q0 + 3}:B${q0 + 7})`, D.dues)]);
    S.row([c.t('Security deposits held (current residents)'), c.m(D.depositHeld)]); S.row([c.t('Deposit refunds pending'), c.m(D.refundPending)]);
    S.gap();
    // occupancy + electricity
    S.section('Occupancy & electricity');
    S.head(['', 'Value']);
    S.row([c.t('Beds (excl. maintenance)'), c.n(D.occ.total)]); S.row([c.t('Occupied now'), c.n(D.occ.occ)]); S.row([c.t('Vacant now'), c.n(D.occ.vac)]);
    S.row([c.t('Monthly rent roll (current residents)'), c.m(D.rentRoll)]); S.row([c.t('Rent lost to vacant beds, per month'), c.m(D.vacLoss)]);
    S.row([c.t('New residents / left, this period'), c.t(`${D.moveIns.length} in · ${D.moveOuts.length} out`, 'tdC')]);
    S.row([c.t('Electricity units read'), c.n(D.elec.units, 'tdD1')]); S.row([c.t('Electricity billed'), c.m(D.elec.amount)]);
    S.gap();
    // inventory, laundry, payroll
    S.section('Inventory, laundry & payroll');
    S.head(['', 'Value']);
    S.row([c.t('Stock on hand (value)'), c.m(D.invTotals.value)]); S.row([c.t('Items at or below minimum'), c.n(D.invTotals.low)]);
    S.row([c.t('Purchases received this period'), c.m(D.invTotals.bought)]);
    S.row([c.t('Food cost per resident per day (approx.)'), { v: round2(ratio(D.invTotals.bought, Math.max(1, D.activeN) * D.days)), s: 'tdM' }]);
    S.row([c.t('Laundry: pieces received'), c.n(sum(D.ld, l => +l.pcs || 0))]); S.row([c.t('Laundry: charged revenue'), c.m(sum(D.ld, l => +l.charge || 0))]);
    S.row([c.t('Payroll earned this period'), c.m(D.payroll.all)]); S.row([c.t('Payroll paid this period'), c.m(D.payroll.paidAll)]);
    S.gap();
    S.sub('What is in this workbook');
    S.note('P&L · Cash Flow · Cost Analysis · Revenue & Dues · Occupancy · Electricity · Inventory · Laundry · Payroll · Payments · Expenses. Revenue is on a billed basis (rent and other bills dated in the period, less waivers); cash flow is money that actually moved. Dues and stock are as on ' + dmy(D.today) + '.', 'note', 44);
    const sp = S.spec();
    for (const r of kp) for (let i = 0; i < 4; i++) sp.merges.push(`${L(i * 2)}${r}:${L(i * 2 + 1)}${r}`);
    for (let i = 0; i < kp.length; i += 2) { sp.heights[kp[i]] = 20; sp.heights[kp[i + 1]] = 34; }
    return sp;
  }

  function sheetPL(D) {
    const nm = D.months.length, S = Sh(D, 'P&L', { tab: '15803D', cols: [34, ...D.months.map(() => 13), 15, 11], title: 'Profit & Loss' });
    S.freeze = { row: 3, col: 1 };
    S.head(['', ...D.months.map(ymLabel), 'Total', 'Share']);
    S.sub('Revenue (billed, less waivers)');
    const rv = monthBlock(S, D.months, D.rev.types.map(ty => ({ label: TYPE_NAME[ty] || ty, vals: D.rev.by[ty] || {} })), 'Total revenue');
    S.gap();
    S.sub('Operating expenses (as entered under Expenses)');
    const ex = monthBlock(S, D.months, D.exp.cats.map(cat => ({ label: cat, vals: D.exp.by[cat] })), 'Total operating expenses');
    S.gap();
    S.sub('Payroll (staff module, earned from attendance)');
    const py = monthBlock(S, D.months, [{ label: 'Staff salaries', vals: D.payroll.by }], 'Total payroll', { share: false });
    S.gap();
    const r = S.next(), prof = D.months.map((m, j) => round2(rv.colTot[j] - ex.colTot[j] - py.colTot[j]));
    S.row([c.t('NET PROFIT', 'totL'), ...D.months.map((m, j) => c.f(`${L(j + 1)}${rv.tr}-${L(j + 1)}${ex.tr}-${L(j + 1)}${py.tr}`, prof[j])), c.f(`SUM(B${r}:${L(nm)}${r})`, round2(sum(prof))), { v: '', s: 'totL' }]);
    S.row([c.t('Profit margin', 'totL'), ...D.months.map((m, j) => c.f(`IF(${L(j + 1)}${rv.tr}=0,0,${L(j + 1)}${r}/${L(j + 1)}${rv.tr})`, ratio(prof[j], rv.colTot[j]), 'totP')), c.f(`IF(${L(nm + 1)}${rv.tr}=0,0,${L(nm + 1)}${r}/${L(nm + 1)}${rv.tr})`, ratio(round2(sum(prof)), rv.grand), 'totP'), { v: '', s: 'totL' }]);
    S.gap();
    S.note('Revenue counts a bill in the month it is dated, whether or not it has been paid. Expenses count in the month of the bill. If Salary is also entered under Expenses, it is counted there as well as in Payroll — keep to one.', 'note', 40);
    return S.spec();
  }

  function sheetCash(D) {
    const nm = D.months.length, S = Sh(D, 'Cash Flow', { tab: '15803D', cols: [34, ...D.months.map(() => 13), 15, 11], title: 'Cash Flow' });
    S.freeze = { row: 3, col: 1 };
    S.head(['', ...D.months.map(ymLabel), 'Total', 'Share']);
    S.sub('Cash in');
    const inLines = [...D.cash.inTypes.map(ty => ({ label: TYPE_NAME[ty] || ty, vals: D.cash.inBy[ty] })), { label: 'Security deposits received', vals: D.cash.dep }, { label: 'Advance / credit received', vals: D.cash.adv }];
    const ci = monthBlock(S, D.months, inLines, 'Total cash in');
    S.gap();
    S.sub('Cash out');
    const outLines = [...D.cash.outCats.map(cat => ({ label: cat, vals: D.cash.out[cat] })), { label: 'Salaries paid (staff module)', vals: D.cash.sal }, { label: 'Deposit refunds paid', vals: D.cash.refund }];
    const co = monthBlock(S, D.months, outLines, 'Total cash out');
    S.gap();
    const r = S.next(), net = D.months.map((m, j) => round2(ci.colTot[j] - co.colTot[j]));
    S.row([c.t('NET CASH FLOW', 'totL'), ...D.months.map((m, j) => c.f(`${L(j + 1)}${ci.tr}-${L(j + 1)}${co.tr}`, net[j])), c.f(`SUM(B${r}:${L(nm)}${r})`, round2(sum(net))), { v: '', s: 'totL' }]);
    let run = 0;
    S.row([c.t('Cumulative', 'totL'), ...D.months.map((m, j) => { run = round2(run + net[j]); return c.f(j ? `${L(j)}${r + 1}+${L(j + 1)}${r}` : `B${r}`, run); }), { v: '', s: 'totL' }, { v: '', s: 'totL' }]);
    S.gap();
    S.sub('Collections by mode');
    S.head(['Mode', 'Amount', 'Share']);
    const m0 = S.next(), modes = Object.entries(D.cash.byMode).sort((a, b) => b[1] - a[1]), mt = round2(sum(modes, x => x[1]));
    modes.forEach(([k, v], i) => S.row([c.t(k.toUpperCase()), c.m(v), c.f(`IF(B${m0 + modes.length}=0,0,B${m0 + i}/B${m0 + modes.length})`, ratio(v, mt), 'tdP')]));
    S.row([c.t('Total received', 'totL'), c.f(`SUM(B${m0}:B${m0 + modes.length - 1})`, mt), { v: '', s: 'totL' }]);
    S.gap();
    S.note('Cash flow counts money when it moved: payments on the date received, expenses when marked paid, salaries when paid, deposit refunds when refunded. It does not know your bank or cash balance, so "Cumulative" starts from zero at the start of the period.', 'note', 40);
    return S.spec();
  }

  function sheetCost(D) {
    const S = Sh(D, 'Cost Analysis', { tab: 'B45309', cols: [30, 16, 12, 16, 12, 16, 16, 16], title: 'Cost Analysis' });
    S.freeze = { row: 3 };
    const beds = Math.max(1, D.occ.total), res = Math.max(1, D.activeN), mths = Math.max(1, D.days / 30.4);
    S.section('Expenses by category');
    S.head(['Category', 'This period', 'Share', 'Previous period', 'Change', 'Per bed / month', 'Per resident / month', 'Per day']);
    const t0 = S.next(), tr = t0 + D.exp.cats.length;
    D.exp.cats.forEach((cat, i) => { const a = D.exp.total[cat], b = D.exp.prev[cat] || 0, r = t0 + i; S.row([c.t(cat), c.m(a), c.f(`IF(B${tr}=0,0,B${r}/B${tr})`, ratio(a, D.exp.all), 'tdP'), c.m(b), c.f(`IF(D${r}=0,0,(B${r}-D${r})/ABS(D${r}))`, growth(a, b), 'tdP'), c.f(`B${r}/${beds}/${mths.toFixed(4)}`, a / beds / mths, 'tdM'), c.f(`B${r}/${res}/${mths.toFixed(4)}`, a / res / mths, 'tdM'), c.f(`B${r}/${D.days}`, a / D.days, 'tdM')]); });
    S.row([c.t('Total', 'totL'), c.f(`SUM(B${t0}:B${tr - 1})`, D.exp.all), c.f(`SUM(C${t0}:C${tr - 1})`, D.exp.cats.length ? 1 : 0, 'totP'), c.f(`SUM(D${t0}:D${tr - 1})`, D.exp.prevAll), c.f(`IF(D${tr}=0,0,(B${tr}-D${tr})/ABS(D${tr}))`, growth(D.exp.all, D.exp.prevAll), 'totP'), c.f(`B${tr}/${beds}/${mths.toFixed(4)}`, D.exp.all / beds / mths), c.f(`B${tr}/${res}/${mths.toFixed(4)}`, D.exp.all / res / mths), c.f(`B${tr}/${D.days}`, D.exp.all / D.days)]);
    S.bar('C', t0, tr - 1);
    S.note(`"Per bed" uses ${D.occ.total} beds and "per resident" uses ${D.activeN} current residents, over ${D.days} days. Previous period is the ${D.days} days before ${dmy(D.from)}.`, 'note', 28);
    S.gap();
    S.section('Biggest single expenses');
    S.head(['Item', 'Amount', 'Date', 'Category', '', 'Vendor', 'Paid?', 'Mode']);
    for (const e of [...D.exp.list].sort((a, b) => (+b.amount || 0) - (+a.amount || 0)).slice(0, 10)) S.row([c.t(e.note || e.cat || 'Expense'), c.m(e.amount), c.d(e.date), c.t(e.cat || ''), c.t(''), c.t(e.vendor || ''), c.t(e.paid ? 'Paid' : 'Unpaid', e.paid ? 'tdC' : 'bad'), c.t((e.mode || '').toUpperCase(), 'tdC')]);
    S.gap();
    S.section('Vendors');
    S.head(['Vendor', 'Amount', 'Share']);
    const v0 = S.next(), vt = round2(sum(D.exp.vendors, x => x[1]));
    D.exp.vendors.slice(0, 12).forEach(([v, a], i) => S.row([c.t(v), c.m(a), c.f(`IF(${vt}=0,0,B${v0 + i}/${vt})`, ratio(a, vt), 'tdP')]));
    if (!D.exp.vendors.length) S.row([c.t('No vendor names recorded'), c.m(0), c.p(0)]);
    S.bar('C', v0, S.next() - 1);
    S.gap();
    S.section('Payment mode');
    S.head(['Mode', 'Amount', 'Share']);
    const md0 = S.next(), mm = Object.entries(D.exp.byMode).sort((a, b) => b[1] - a[1]);
    mm.forEach(([k, v], i) => S.row([c.t(k.toUpperCase()), c.m(v), c.f(`IF(${D.exp.all}=0,0,B${md0 + i}/${D.exp.all})`, ratio(v, D.exp.all), 'tdP')]));
    S.gap();
    S.section(`Unpaid bills (${D.exp.unpaid.length})`);
    S.head(['Item', 'Amount', 'Date', 'Category', '', 'Vendor']);
    const u0 = S.next();
    for (const e of D.exp.unpaid) S.row([c.t(e.note || e.cat || 'Expense'), c.m(e.amount), c.d(e.date), c.t(e.cat || ''), c.t(''), c.t(e.vendor || '')]);
    S.row([c.t('Total unpaid', 'totL'), c.f(`SUM(B${u0}:B${Math.max(u0, S.next() - 1)})`, round2(sum(D.exp.unpaid, e => +e.amount || 0))), ...Array(4).fill({ v: '', s: 'totL' })]);
    return S.spec();
  }

  function sheetDues(D) {
    const S = Sh(D, 'Revenue & Dues', { tab: 'B91C1C', cols: [30, 16, 16, 16, 14, 16, 16, 16], title: 'Revenue & Dues' });
    S.freeze = { row: 3 };
    S.section('Billed vs collected, by type');
    S.head(['Bill type', 'Billed (gross)', 'Waived', 'Net billed', 'Collected', 'Still owed', 'Collection %']);
    const inv = invoices().filter(i => i.type !== 'deposit' && inR(i.date, D.from, D.to)), g = groupBy(inv, i => i.type), ts = D.rev.types, b0 = S.next(), tr = b0 + ts.length;
    ts.forEach((ty, i) => { const l = g[ty] || [], gr = round2(sum(l, x => x.amount || 0)), w = round2(sum(l, x => x.waived || 0)), pd = round2(sum(l, x => Math.min(x.paid || 0, (x.amount || 0) - (x.waived || 0)))), r = b0 + i;
      S.row([c.t(TYPE_NAME[ty] || ty), c.m(gr), c.m(w), c.f(`B${r}-C${r}`, gr - w, 'tdM'), c.m(pd), c.f(`D${r}-E${r}`, gr - w - pd, 'tdM'), c.f(`IF(D${r}=0,0,E${r}/D${r})`, ratio(pd, gr - w), 'tdP')]); });
    S.row([c.t('Total', 'totL'), ...['B', 'C', 'D', 'E', 'F'].map(col => c.f(`SUM(${col}${b0}:${col}${tr - 1})`, 0)), c.f(`IF(D${tr}=0,0,E${tr}/D${tr})`, ratio(D.billedPaid, D.billed - D.waived), 'totP')]);
    // cached totals for the row just written
    const tot_ = S.rows[S.rows.length - 1]; const vals = [D.billed, D.waived, round2(D.billed - D.waived), D.billedPaid, round2(D.billed - D.waived - D.billedPaid)]; vals.forEach((v, i) => { tot_[i + 1].v = v; });
    S.note('Collected shows what has been paid against these bills so far, including payments made after the period ended.', 'note', 24);
    S.gap();
    S.section('Money owed today, by age');
    S.head(['Age', 'Amount', 'Share']);
    const a0 = S.next(), at = D.dues;
    Object.entries(D.age).forEach(([k, v], i) => S.row([c.t(k), c.m(v), c.f(`IF(B${a0 + 5}=0,0,B${a0 + i}/B${a0 + 5})`, ratio(v, at), 'tdP')]));
    S.row([c.t('Total owed', 'totL'), c.f(`SUM(B${a0}:B${a0 + 4})`, at), c.f(`SUM(C${a0}:C${a0 + 4})`, at ? 1 : 0, 'totP')]);
    S.bar('C', a0, a0 + 4);
    S.row([c.t('Security deposits held (current residents)'), c.m(D.depositHeld)]); S.row([c.t('Deposit refunds pending'), c.m(D.refundPending)]);
    S.gap();
    S.section(`Who owes (${D.owing.length})`);
    S.head(['Resident', 'Room', 'Mobile', 'Total owed', 'Days late', 'Of which overdue', 'Oldest due date', 'Status']);
    const w0 = S.next();
    for (const x of D.owing) S.row([c.t(x.r.name || '—'), c.t(x.room, 'tdC'), c.t(x.r.phone || '', 'tdC'), c.m(x.due), c.n(x.days), c.m(x.overdue), c.d(x.oldest), c.t(x.r.status === 'left' ? 'Left' : 'Staying', x.r.status === 'left' ? 'bad' : 'tdC')]);
    S.row([c.t('Total', 'totL'), { v: '', s: 'totL' }, { v: '', s: 'totL' }, c.f(`SUM(D${w0}:D${Math.max(w0, S.next() - 1)})`, D.owing.reduce((s, x) => s + x.due, 0)), { v: '', s: 'totL' }, c.f(`SUM(F${w0}:F${Math.max(w0, S.next() - 1)})`, D.owing.reduce((s, x) => s + x.overdue, 0)), { v: '', s: 'totL' }, { v: '', s: 'totL' }]);
    return S.spec();
  }

  function sheetOcc(D) {
    const S = Sh(D, 'Occupancy', { tab: '0369A1', cols: [10, 12, 8, 10, 8, 14, 38, 16, 16, 16], title: 'Occupancy' });
    S.freeze = { row: 3 };
    S.section('Right now');
    S.head(['', '', '', '', '', 'Beds', 'Occupied', 'Vacant', 'Occupancy', 'Rent lost / month']);
    S.row([c.t('Hostel', 'tdB'), c.t(''), c.t(''), c.t(''), c.t(''), c.n(D.occ.total), c.n(D.occ.occ), c.n(D.occ.vac), c.p(ratio(D.occ.occ, D.occ.total)), c.m(D.vacLoss)]);
    S.gap();
    S.section('Occupancy at month end');
    S.head(['Month', '', '', '', '', 'Residents', 'Beds', 'Occupancy']);
    const o0 = S.next();
    D.occTrend.forEach((x, i) => S.row([c.t(ymLabel(x.m), 'tdB'), c.t(''), c.t(''), c.t(''), c.t(''), c.n(x.n), c.n(D.occ.total), c.f(`IF(G${o0 + i}=0,0,F${o0 + i}/G${o0 + i})`, x.pct, 'tdP')]));
    S.bar('H', o0, S.next() - 1);
    S.note('Month-end counts use each resident\'s check-in and checkout dates against today\'s bed count.', 'note', 20);
    S.gap();
    S.section('Room by room');
    S.head(['Room', 'Floor', 'Beds', 'Occupied', 'Vacant', 'Rent / bed', 'Residents', 'Monthly rent roll', 'Rent lost / month', 'Rent billed (period)']);
    const r0 = S.next();
    for (const x of D.rooms) S.row([c.t(x.rm.no, 'tdB'), c.t(String(x.rm.floor || ''), 'tdC'), c.n(x.total), c.n(x.used), c.n(x.vac), c.m(x.rm.rent), c.t(x.names || '—', 'tdW'), c.m(x.roll), c.m(x.loss), c.m(x.billed)]);
    const r1 = Math.max(r0, S.next() - 1);
    S.row([c.t('Total', 'totL'), { v: '', s: 'totL' }, ...['C', 'D', 'E'].map(col => c.f(`SUM(${col}${r0}:${col}${r1})`, 0, 'totN')), { v: '', s: 'totL' }, { v: '', s: 'totL' }, ...['H', 'I', 'J'].map(col => c.f(`SUM(${col}${r0}:${col}${r1})`, 0))]);
    const tr = S.rows[S.rows.length - 1]; [D.rooms.reduce((s, x) => s + x.total, 0), D.rooms.reduce((s, x) => s + x.used, 0), D.rooms.reduce((s, x) => s + x.vac, 0)].forEach((v, i) => { tr[2 + i].v = v; });
    tr[7].v = D.rentRoll; tr[8].v = D.vacLoss; tr[9].v = round2(D.rooms.reduce((s, x) => s + x.billed, 0));
    S.gap();
    S.section(`Moved in (${D.moveIns.length}) and moved out (${D.moveOuts.length}) this period`);
    S.head(['Date', 'Room', '', '', '', 'Rent', 'Resident', 'Event']);
    for (const r of D.moveIns) S.row([c.d(r.checkIn), c.t(roomName(r.roomId), 'tdC'), c.t(''), c.t(''), c.t(''), c.m(r.rent), c.t(r.name), c.t('Moved in', 'tdC')]);
    for (const r of D.moveOuts) S.row([c.d(r.left), c.t(roomName(r.roomId), 'tdC'), c.t(''), c.t(''), c.t(''), c.m(r.rent), c.t(r.name), c.t('Moved out', 'bad')]);
    return S.spec();
  }

  function sheetElec(D) {
    const S = Sh(D, 'Electricity', { tab: 'CA8A04', cols: [14, 12, 14, 14, 12, 10, 16, 14], title: 'Electricity' });
    S.freeze = { row: 3 };
    S.section('By month');
    S.head(['Month', '', '', 'Units', '', '', 'Billed', 'Avg ₹ / unit']);
    const m0 = S.next();
    D.months.forEach((m, i) => { const u = D.elec.byM[m] || 0, a = D.elec.amtM[m] || 0, r = m0 + i; S.row([c.t(ymLabel(m), 'tdB'), c.t(''), c.t(''), c.n(u, 'tdD1'), c.t(''), c.t(''), c.m(a), c.f(`IF(D${r}=0,0,G${r}/D${r})`, ratio(a, u), 'tdM')]); });
    const m1 = Math.max(m0, S.next() - 1);
    S.row([c.t('Total', 'totL'), { v: '', s: 'totL' }, { v: '', s: 'totL' }, c.f(`SUM(D${m0}:D${m1})`, D.elec.units, 'totD1'), { v: '', s: 'totL' }, { v: '', s: 'totL' }, c.f(`SUM(G${m0}:G${m1})`, D.elec.amount), c.f(`IF(D${m1 + 1}=0,0,G${m1 + 1}/D${m1 + 1})`, ratio(D.elec.amount, D.elec.units))]);
    S.gap();
    S.section('Meter readings');
    S.head(['Date', 'Room', 'Previous', 'Current', 'Units', 'Rate', 'Amount billed', 'Status']);
    const r0 = S.next();
    for (const x of D.meters) S.row([c.d(x.date), c.t(roomName(x.roomId), 'tdC'), c.n(x.prev, 'tdD1'), c.n(x.curr, 'tdD1'), c.f(`D${S.next()}-C${S.next()}`, x.units, 'tdD1'), c.m(x.rate), c.m(x.total), c.t(x.status === 'review' ? 'To review' : 'Billed', x.status === 'review' ? 'bad' : 'tdC')]);
    const r1 = Math.max(r0, S.next() - 1);
    S.row([c.t('Total', 'totL'), { v: '', s: 'totL' }, { v: '', s: 'totL' }, { v: '', s: 'totL' }, c.f(`SUM(E${r0}:E${r1})`, D.elec.units, 'totD1'), { v: '', s: 'totL' }, c.f(`SUM(G${r0}:G${r1})`, D.elec.amount), { v: '', s: 'totL' }]);
    S.filter = `A${r0 - 1}:H${r1}`;
    return S.spec();
  }

  function sheetInv(D) {
    const S = Sh(D, 'Inventory', { tab: '7C3AED', cols: [26, 14, 8, 10, 10, 10, 14, 10, 12, 12, 14, 12, 14], title: 'Inventory Analysis' });
    S.freeze = { row: 3 };
    S.section('Stock on hand (as on ' + dmy(D.today) + ') and movement in the period');
    S.head(['Item', 'Category', 'Unit', 'In stock', 'Minimum', 'Rate', 'Stock value', 'Days left', 'Status', 'Bought (qty)', 'Bought (₹)', 'Used (qty)', 'Used (₹)']);
    const h = S.rows.length, r0 = S.next();
    for (const x of D.inv) S.row([c.t(x.it.name, 'tdB'), c.t(x.it.cat || ''), c.t(x.it.unit || '', 'tdC'), c.n(x.st, 'tdD1'), c.n(x.it.min || 0, 'tdD1'), c.m(x.it.rate || 0), c.f(`D${S.next()}*F${S.next()}`, x.value, 'tdM'), c.t(x.si.days == null ? '—' : x.si.days, 'tdC'), c.t(x.si.low ? 'Low' : 'OK', x.si.low ? 'bad' : 'tdC'), c.n(x.q, 'tdD1'), c.m(x.c), c.n(x.used, 'tdD1'), c.f(`L${S.next()}*F${S.next()}`, x.usedValue, 'tdM')]);
    const r1 = Math.max(r0, S.next() - 1);
    S.row([c.t('Total', 'totL'), ...Array(5).fill({ v: '', s: 'totL' }), c.f(`SUM(G${r0}:G${r1})`, D.invTotals.value), { v: '', s: 'totL' }, c.f(`COUNTIF(I${r0}:I${r1},"Low")`, D.invTotals.low, 'totN'), { v: '', s: 'totL' }, c.f(`SUM(K${r0}:K${r1})`, D.invTotals.bought), { v: '', s: 'totL' }, c.f(`SUM(M${r0}:M${r1})`, D.invTotals.usedValue)]);
    S.filter = `A${h}:M${r1}`;
    S.note('Used (qty) is the kitchen\'s recorded consumption (estimated from the menu and headcount each day). Stock value = in stock × latest rate.', 'note', 24);
    S.gap();
    S.section('Purchases received in the period');
    S.head(['Order', 'Date', '', 'Vendor', '', '', 'Total', 'Items', 'Paid by']);
    const p0 = S.next();
    for (const p of D.prs) S.row([c.t(p.no, 'tdB'), c.d(p.receivedOn), c.t(''), c.t(p.vendor || ''), c.t(''), c.t(''), c.m(p.total != null ? p.total : prTotal(p)), c.n((p.items || []).length), c.t((p.mode || '').toUpperCase(), 'tdC')]);
    S.row([c.t('Total', 'totL'), ...Array(5).fill({ v: '', s: 'totL' }), c.f(`SUM(G${p0}:G${Math.max(p0, S.next() - 1)})`, round2(sum(D.prs, p => (p.total != null ? p.total : prTotal(p))))), { v: '', s: 'totL' }, { v: '', s: 'totL' }]);
    return S.spec();
  }

  function sheetLaundry(D) {
    const S = Sh(D, 'Laundry', { tab: '0891B2', cols: [28, 12, 12, 12, 14, 14], title: 'Laundry Management' });
    S.freeze = { row: 3 };
    S.section('By month');
    S.head(['Month', 'Pieces', 'Free pieces', 'Charged pieces', 'Charged (₹)', '₹ / charged piece']);
    const m0 = S.next();
    D.months.forEach((m, i) => { const p = D.ldM.pcs[m] || 0, e = D.ldM.extra[m] || 0, ch = D.ldM.charge[m] || 0, r = m0 + i; S.row([c.t(ymLabel(m), 'tdB'), c.n(p), c.f(`B${r}-D${r}`, p - e, 'tdN'), c.n(e), c.m(ch), c.f(`IF(D${r}=0,0,E${r}/D${r})`, ratio(ch, e), 'tdM')]); });
    const m1 = Math.max(m0, S.next() - 1), P = sum(D.ld, l => +l.pcs || 0), E = sum(D.ld, l => +l.extra || 0), C = round2(sum(D.ld, l => +l.charge || 0));
    S.row([c.t('Total', 'totL'), c.f(`SUM(B${m0}:B${m1})`, P, 'totN'), c.f(`SUM(C${m0}:C${m1})`, P - E, 'totN'), c.f(`SUM(D${m0}:D${m1})`, E, 'totN'), c.f(`SUM(E${m0}:E${m1})`, C), c.f(`IF(D${m1 + 1}=0,0,E${m1 + 1}/D${m1 + 1})`, ratio(C, E))]);
    S.note(`Laundry revenue is ${(ratio(C, D.rev.all) * 100).toFixed(1)}% of revenue billed. ${P - E} of ${P} pieces were inside the free allowance.`, 'note', 22);
    S.gap();
    S.section('By resident');
    S.head(['Resident', 'Room', 'Visits', 'Pieces', 'Charged pieces', 'Charged (₹)']);
    const r0 = S.next();
    for (const x of D.ldBy) S.row([c.t(x.r.name || '—', 'tdB'), c.t(x.r.roomId ? roomName(x.r.roomId) : '', 'tdC'), c.n(x.n), c.n(x.pcs), c.n(x.extra), c.m(x.charge)]);
    const r1 = Math.max(r0, S.next() - 1);
    S.row([c.t('Total', 'totL'), { v: '', s: 'totL' }, ...['C', 'D', 'E'].map(col => c.f(`SUM(${col}${r0}:${col}${r1})`, 0, 'totN')), c.f(`SUM(F${r0}:F${r1})`, C)]);
    const tr = S.rows[S.rows.length - 1]; [D.ldBy.reduce((s, x) => s + x.n, 0), P, E].forEach((v, i) => { tr[2 + i].v = v; });
    S.filter = `A${r0 - 1}:F${r1}`;
    S.gap();
    S.section('Every entry');
    S.head(['Resident', 'Date', 'Pieces', 'Charged', 'Charge (₹)', 'Status']);
    for (const l of D.ld) S.row([c.t((resById(l.resId) || {}).name || '—'), c.d(l.date), c.n(l.pcs), c.n(l.extra), c.m(l.charge), c.t(l.status || '', 'tdC')]);
    return S.spec();
  }

  function sheetPayroll(D) {
    const S = Sh(D, 'Payroll', { tab: '9A3412', cols: [26, 14, 12, 10, 10, 8, 14, 14, 14], title: 'Payroll' });
    S.freeze = { row: 3 };
    S.section('Salary by staff member and month');
    S.head(['Staff', 'Department', 'Month', 'Present', 'Absent', 'Half', 'Earned', 'Paid', 'Still due']);
    const h = S.rows.length, r0 = S.next();
    for (const s of D.payroll.staff.filter(x => x.status === 'active' || Store.all('sal').some(p => p.staffId === x.id))) for (const m of D.months) {
      const p = payrollFor(s, m), paid = round2(sum(Store.all('sal').filter(x => x.staffId === s.id && x.ym === m), x => +x.amount || 0)), r = S.next();
      S.row([c.t(s.name, 'tdB'), c.t(s.dept || s.role || ''), c.t(ymLabel(m), 'tdC'), c.n(p.P), c.n(p.A), c.n(p.H), c.m(p.payable), c.m(paid), c.f(`MAX(0,G${r}-H${r})`, Math.max(0, p.payable - paid), 'tdM')]);
    }
    const r1 = Math.max(r0, S.next() - 1), rows = S.rows.slice(r0 - 1);
    S.row([c.t('Total', 'totL'), { v: '', s: 'totL' }, { v: '', s: 'totL' }, ...['D', 'E', 'F'].map((col, i) => c.f(`SUM(${col}${r0}:${col}${r1})`, rows.reduce((s, r) => s + (r[3 + i].v || 0), 0), 'totN')), ...['G', 'H', 'I'].map((col, i) => c.f(`SUM(${col}${r0}:${col}${r1})`, rows.reduce((s, r) => s + ((r[6 + i].f ? r[6 + i].v : r[6 + i].v) || 0), 0)))]);
    S.filter = `A${h}:I${r1}`;
    S.note('"Earned" is the monthly salary less absent days (and half days), from attendance. Months with no attendance marked are treated as fully present. "Paid" is what was recorded as paid for that month.', 'note', 36);
    return S.spec();
  }

  function sheetPayments(D) {
    const S = Sh(D, 'Payments', { tab: '475569', cols: [12, 11, 26, 8, 14, 10, 20, 38, 16], title: 'Payments received' });
    S.freeze = { row: 3 };
    S.head(['Date', 'Receipt', 'Resident', 'Room', 'Amount', 'Mode', 'Reference', 'Paid against', 'Received by']);
    const h = S.rows.length, r0 = S.next();
    for (const p of D.pays) S.row([c.d(p.date), c.t(p.no || '', 'tdC'), c.t((resById(p.resId) || {}).name || '—'), c.t(p.roomId ? roomName(p.roomId) : '', 'tdC'), c.m(p.amount), c.t((p.mode || '').toUpperCase(), 'tdC'), c.t(p.ref || ''), c.t((p.alloc || []).map(a => a.title).join('; ') + (p.credit > 0 ? `${(p.alloc || []).length ? '; ' : ''}advance ${inr(p.credit)}` : ''), 'tdW'), c.t(p.by || '')]);
    const r1 = Math.max(r0, S.next() - 1);
    S.row([c.t('Total', 'totL'), { v: '', s: 'totL' }, { v: '', s: 'totL' }, { v: '', s: 'totL' }, c.f(`SUM(E${r0}:E${r1})`, round2(sum(D.pays, p => +p.amount || 0))), ...Array(4).fill({ v: '', s: 'totL' })]);
    S.filter = `A${h}:I${r1}`;
    return S.spec();
  }

  function sheetExpenses(D) {
    const S = Sh(D, 'Expenses', { tab: '475569', cols: [12, 22, 14, 10, 10, 12, 24, 34], title: 'Expenses' });
    S.freeze = { row: 3 };
    S.head(['Date', 'Category', 'Amount', 'Mode', 'Paid?', 'Paid on', 'Vendor', 'Note']);
    const h = S.rows.length, r0 = S.next();
    for (const e of D.exp.list) S.row([c.d(e.date), c.t(e.cat || ''), c.m(e.amount), c.t((e.mode || '').toUpperCase(), 'tdC'), c.t(e.paid ? 'Paid' : 'Unpaid', e.paid ? 'tdC' : 'bad'), c.d(e.paid ? e.paidOn || e.date : ''), c.t(e.vendor || ''), c.t(e.note || '', 'tdW')]);
    const r1 = Math.max(r0, S.next() - 1);
    S.row([c.t('Total', 'totL'), { v: '', s: 'totL' }, c.f(`SUM(C${r0}:C${r1})`, D.exp.all), ...Array(5).fill({ v: '', s: 'totL' })]);
    S.filter = `A${h}:H${r1}`;
    return S.spec();
  }

  function sheets(D) {
    return [sheetSummary(D), sheetPL(D), sheetCash(D), sheetCost(D), sheetDues(D), sheetOcc(D), sheetElec(D), sheetInv(D), sheetLaundry(D), sheetPayroll(D), sheetPayments(D), sheetExpenses(D)];
  }

  // The file name carries the hostel and the period; the workbook is built from compute().
  function workbook(from, to, label) {
    const D = compute(from, to); D.label = label || `${dmy(from)} – ${dmy(to)}`;
    const bytes = Xlsx.build({ title: `${D.hostel} — Complete Analysis`, author: 'Sarvlekh', sheets: sheets(D) });
    const safe = String(D.hostel).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { D, bytes, name: `${safe} - Complete Analysis ${from} to ${to}.xlsx` };
  }

  return { compute, sheets, workbook, dmy, monthsOf, inR };
})();
