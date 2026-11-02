/* A small .xlsx writer — no library, no build step.
 *
 * An .xlsx file is a ZIP of XML parts. Everything the analysis workbook needs fits in a few
 * hundred lines: styled cells, formulas with their cached values, merged cells, column widths,
 * frozen headers, data bars, filters, and a print header and footer with page numbers. Nothing is
 * compressed (ZIP "stored"), which keeps the writer tiny; the files are a few tens of KB.
 *
 *   Xlsx.build({ title, author, sheets: [ { name, tab, cols:[w..], rows:[[cell..]..], merges:[..], ... } ] })
 *     → Uint8Array of the .xlsx
 *
 * A cell is a number, a string, null, or { v, f, s, t } — value, formula (without "="), style name
 * or inline style object, and 'd' for an ISO date string. Styles are named (see STYLES) so the
 * report code reads as intent, not as formatting.
 */
const Xlsx = (() => {
  const enc = new TextEncoder();
  const esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const colName = n => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const ref = (r, c) => colName(c) + (r + 1);
  // Excel's date serial: days since 1899-12-30.
  const serial = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5); };

  /* ---------- ZIP (stored) ---------- */
  const CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const now = new Date(), dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(), tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const chunks = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    }
    const csize = central.reduce((n, c) => n + c.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
    const all = [...chunks, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(off + csize + 22); let p = 0;
    for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }

  /* ---------- styles ---------- */
  const FMT = { general: 0, int: '#,##0', dec1: '#,##0.0', dec2: '#,##0.00', inr: '"₹"#,##0;[Red]-"₹"#,##0', inr2: '"₹"#,##0.00;[Red]-"₹"#,##0.00', pct: '0.0%;[Red]-0.0%', date: 'dd-mmm-yy', month: 'mmm yyyy' };
  const GREEN = '15803D', GREEN_D = '0F5132', GREEN_L = 'DCFCE7', GREEN_XL = 'F0FDF4', INK = '1F2937', MUTED = '6B7280', LINE = 'D1D5DB', RED = 'B91C1C', AMBER_L = 'FEF3C7';
  // Named styles. Everything on the page reads from this table, so the look is changed in one place.
  const STYLES = {
    title: { b: 1, sz: 20, color: 'FFFFFF', bg: GREEN_D, v: 'center', indent: 1 },
    titleSub: { sz: 11, color: 'D1FAE5', bg: GREEN_D, v: 'center', indent: 1 },
    band: { bg: GREEN_D },
    h1: { b: 1, sz: 13, color: 'FFFFFF', bg: GREEN, v: 'center', indent: 1 },
    h2: { b: 1, sz: 11, color: GREEN_D, bg: GREEN_L, v: 'center', indent: 1, border: 'b', bc: GREEN },
    th: { b: 1, color: 'FFFFFF', bg: GREEN, h: 'center', v: 'center', wrap: 1, border: 'box', bc: GREEN_D },
    thL: { b: 1, color: 'FFFFFF', bg: GREEN, h: 'left', v: 'center', wrap: 1, border: 'box', bc: GREEN_D, indent: 1 },
    td: { border: 'box', bc: LINE, v: 'center', indent: 1 },
    tdW: { border: 'box', bc: LINE, v: 'center', wrap: 1, indent: 1 },
    tdC: { border: 'box', bc: LINE, v: 'center', h: 'center' },
    tdB: { b: 1, border: 'box', bc: LINE, v: 'center', indent: 1 },
    tdN: { border: 'box', bc: LINE, v: 'center', fmt: 'int' },
    tdD1: { border: 'box', bc: LINE, v: 'center', fmt: 'dec1' },
    tdM: { border: 'box', bc: LINE, v: 'center', fmt: 'inr' },
    tdP: { border: 'box', bc: LINE, v: 'center', fmt: 'pct' },
    tdDate: { border: 'box', bc: LINE, v: 'center', h: 'center', fmt: 'date' },
    tdAlt: { border: 'box', bc: LINE, v: 'center', bg: GREEN_XL, indent: 1 },
    tdMAlt: { border: 'box', bc: LINE, v: 'center', bg: GREEN_XL, fmt: 'inr' },
    totL: { b: 1, bg: GREEN_L, border: 'tb', bc: GREEN, v: 'center', indent: 1 },
    totM: { b: 1, bg: GREEN_L, border: 'tb', bc: GREEN, v: 'center', fmt: 'inr' },
    totN: { b: 1, bg: GREEN_L, border: 'tb', bc: GREEN, v: 'center', fmt: 'int' },
    totP: { b: 1, bg: GREEN_L, border: 'tb', bc: GREEN, v: 'center', fmt: 'pct' },
    totD1: { b: 1, bg: GREEN_L, border: 'tb', bc: GREEN, v: 'center', fmt: 'dec1' },
    kpiL: { sz: 9, color: MUTED, bg: GREEN_XL, h: 'center', v: 'bottom', border: 'box', bc: GREEN_L, wrap: 1 },
    kpiM: { b: 1, sz: 16, color: GREEN_D, bg: GREEN_XL, h: 'center', v: 'center', fmt: 'inr', border: 'box', bc: GREEN_L },
    kpiP: { b: 1, sz: 16, color: GREEN_D, bg: GREEN_XL, h: 'center', v: 'center', fmt: 'pct', border: 'box', bc: GREEN_L },
    kpiN: { b: 1, sz: 16, color: GREEN_D, bg: GREEN_XL, h: 'center', v: 'center', fmt: 'int', border: 'box', bc: GREEN_L },
    note: { i: 1, sz: 9, color: MUTED, wrap: 1, v: 'top', indent: 1 },
    warn: { sz: 10, color: '92400E', bg: AMBER_L, wrap: 1, v: 'center', indent: 1 },
    foot: { sz: 9, color: MUTED, h: 'center', v: 'center', border: 't', bc: LINE },
    bad: { color: RED, border: 'box', bc: LINE, v: 'center', indent: 1, b: 1 },
  };

  function styleBook() {
    const fonts = [], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'], borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'], fmts = [], xfs = [], memo = new Map();
    const pushU = (list, x) => { let i = list.indexOf(x); if (i < 0) { i = list.length; list.push(x); } return i; };
    const side = (n, st, c) => st ? `<${n} style="thin"><color rgb="FF${c}"/></${n}>` : `<${n}/>`;
    function font(s) { return `<font>${s.b ? '<b/>' : ''}${s.i ? '<i/>' : ''}<sz val="${s.sz || 10}"/><color rgb="FF${s.color || INK}"/><name val="Calibri"/><family val="2"/></font>`; }
    function border(s) {
      const k = s.border; if (!k) return 0;
      const all = k === 'box', c = s.bc || LINE;
      return pushU(borders, `<border>${side('left', all, c)}${side('right', all, c)}${side('top', all || k.includes('t'), c)}${side('bottom', all || k.includes('b'), c)}<diagonal/></border>`);
    }
    function fmtId(f) {
      if (f == null || f === 'general') return 0;
      const code = FMT[f] ?? f; if (typeof code === 'number') return code;
      const i = fmts.indexOf(code); return 164 + (i < 0 ? fmts.push(code) - 1 : i);
    }
    const fontOf = s => pushU(fonts, font(s));
    fontOf({});                                  // font 0 = default
    xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    function xf(spec) {
      const s = typeof spec === 'string' ? STYLES[spec] : spec; if (!s) return 0;
      const key = JSON.stringify(s); if (memo.has(key)) return memo.get(key);
      const fi = fontOf(s), fl = s.bg ? pushU(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.bg}"/><bgColor indexed="64"/></patternFill></fill>`) : 0, bi = border(s), ni = fmtId(s.fmt);
      const al = (s.h || s.v || s.wrap || s.indent) ? `<alignment${s.h ? ` horizontal="${s.h}"` : ''}${s.v ? ` vertical="${s.v}"` : ''}${s.wrap ? ' wrapText="1"' : ''}${s.indent ? ` indent="${s.indent}"` : ''}/>` : '';
      xfs.push(`<xf numFmtId="${ni}" fontId="${fi}" fillId="${fl}" borderId="${bi}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`);
      memo.set(key, xfs.length - 1); return xfs.length - 1;
    }
    const xml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      (fmts.length ? `<numFmts count="${fmts.length}">${fmts.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(c)}"/>`).join('')}</numFmts>` : '') +
      `<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    return { xf, xml };
  }

  /* ---------- a worksheet ---------- */
  function sheetXml(sh, book, selected) {
    const rows = sh.rows || [], maxC = Math.max(1, ...rows.map(r => r.length), (sh.cols || []).length);
    const ht = sh.heights || {};
    let data = '';
    rows.forEach((row, r) => {
      let cells = '';
      row.forEach((cell, c) => {
        if (cell == null || cell === '') { if (row.styles && row.styles[c]) cells += `<c r="${ref(r, c)}" s="${book.xf(row.styles[c])}"/>`; return; }
        const o = typeof cell === 'object' ? cell : { v: cell }, s = o.s ? book.xf(o.s) : 0, a = ref(r, c);
        if (o.blank) { cells += `<c r="${a}" s="${s}"/>`; return; }
        if (o.f != null) {
          const isStr = typeof o.v === 'string';
          cells += `<c r="${a}" s="${s}"${isStr ? ' t="str"' : ''}><f>${esc(o.f)}</f>${o.v != null ? `<v>${isStr ? esc(o.v) : (Number.isFinite(o.v) ? o.v : 0)}</v>` : ''}</c>`;
        } else if (o.t === 'd') cells += `<c r="${a}" s="${s}"><v>${serial(o.v)}</v></c>`;
        else if (typeof o.v === 'number') cells += `<c r="${a}" s="${s}"><v>${Number.isFinite(o.v) ? o.v : 0}</v></c>`;
        else cells += `<c r="${a}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
      });
      data += `<row r="${r + 1}"${ht[r + 1] ? ` ht="${ht[r + 1]}" customHeight="1"` : ''}>${cells}</row>`;
    });
    const fr = sh.freeze, pane = fr ? `<pane${fr.col ? ` xSplit="${fr.col}"` : ''}${fr.row ? ` ySplit="${fr.row}"` : ''} topLeftCell="${ref(fr.row || 0, fr.col || 0)}" activePane="${fr.row && fr.col ? 'bottomRight' : fr.row ? 'bottomLeft' : 'topRight'}" state="frozen"/>` : '';
    const cols = (sh.cols || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const merges = (sh.merges || []).length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    const cf = (sh.bars || []).map((b, i) => `<conditionalFormatting sqref="${b.ref}"><cfRule type="dataBar" priority="${i + 1}"><dataBar><cfvo type="num" val="0"/><cfvo type="num" val="${b.max ?? 1}"/><color rgb="FF${b.color || '4ADE80'}"/></dataBar></cfRule></conditionalFormatting>`).join('');
    const hf = sh.header || sh.footer ? `<headerFooter><oddHeader>${esc(sh.header || '')}</oddHeader><oddFooter>${esc(sh.footer || '')}</oddFooter></headerFooter>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheetPr>${sh.tab ? `<tabColor rgb="FF${sh.tab}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${ref(Math.max(0, rows.length - 1), maxC - 1)}"/>` +
      `<sheetViews><sheetView showGridLines="0"${selected ? ' tabSelected="1"' : ''} workbookViewId="0" zoomScale="${sh.zoom || 100}">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="16"/>` +
      `${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData>${sh.filter ? `<autoFilter ref="${sh.filter}"/>` : ''}${merges}${cf}` +
      `<printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.85" bottom="0.8" header="0.35" footer="0.35"/>` +
      `<pageSetup paperSize="9" orientation="${sh.portrait ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>${hf}</worksheet>`;
  }

  function build({ title = 'Workbook', author = 'Sarvlekh', sheets }) {
    const book = styleBook(), names = new Set();
    const uniq = n => { let base = String(n).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet', x = base, i = 2; while (names.has(x.toLowerCase())) x = base.slice(0, 28) + ' ' + i++; names.add(x.toLowerCase()); return x; };
    const sx = sheets.map((s, i) => ({ s, name: uniq(s.name), xml: sheetXml(s, book, i === 0) }));
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const titles = sx.map((x, i) => x.s.titleRows ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(`'${x.name.replace(/'/g, "''")}'!$${x.s.titleRows[0]}:$${x.s.titleRows[1]}`)}</definedName>` : '').join('');
    const files = [
      { name: '[Content_Types].xml', data: `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sx.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
      { name: '_rels/.rels', data: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
      { name: 'docProps/core.xml', data: `${X}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>` },
      { name: 'docProps/app.xml', data: `${X}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Sarvlekh</Application></Properties>` },
      { name: 'xl/workbook.xml', data: `${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sx.map((x, i) => `<sheet name="${esc(x.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${titles ? `<definedNames>${titles}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sx.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sx.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      ...sx.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x.xml })),
    ];
    files.push({ name: 'xl/styles.xml', data: book.xml() });   // last: styles are registered while the sheets are written
    return zip(files);
  }

  return { build, serial, colName, ref, esc, STYLES, FMT };
})();
