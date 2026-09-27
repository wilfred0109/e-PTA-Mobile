/* model.js - automatisch overgenomen uit Porteum_e-PTA.html (v3.56) met werk_model_bij.py.
   Niet met de hand bewerken: pas e-PTA aan en draai het script opnieuw. */
/* ===================== VERSIE =====================
   Eén plek waar het versienummer staat. Komt terug in de zijbalk (onder het logo),
   bij Project > Bestand, in de bestandsnaam van een opgeslagen JSON en in de titel
   van het tabblad, zodat je altijd kunt zien welke versie je open hebt.
================================================================== */
const VERSIE = 'v3.56';
const VERSIE_DATUM = '25 september 2026';

/* ===================== KERN: zip / xlsx / docx / csv / tekst =====================
   Geen externe libraries. Zip-inflate/deflate via de ingebouwde
   DecompressionStream / CompressionStream ('deflate-raw', Chrome/Edge 103+).
*/
const Kern = (() => {
  const te = new TextEncoder();
  const td = new TextDecoder('utf-8');

  // ---------- CRC32 ----------
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function streamBytes(bytes, stream) {
    const src = new Blob([bytes]).stream().pipeThrough(stream);
    const buf = await new Response(src).arrayBuffer();
    return new Uint8Array(buf);
  }
  const inflateRaw = (b) => streamBytes(b, new DecompressionStream('deflate-raw'));
  const deflateRaw = (b) => streamBytes(b, new CompressionStream('deflate-raw'));

  // ---------- tekst in-/uitpakken voor localStorage (deflate-raw + base64) ----------
  function bytesNaarB64(u8) { let s = ''; const stap = 0x8000; for (let i = 0; i < u8.length; i += stap) s += String.fromCharCode.apply(null, u8.subarray(i, i + stap)); return btoa(s); }
  function b64NaarBytes(b64) { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
  async function pakIn(tekst) { return bytesNaarB64(await deflateRaw(new TextEncoder().encode(tekst))); }
  async function pakUit(b64) { return new TextDecoder().decode(await inflateRaw(b64NaarBytes(b64))); }

  // ---------- ZIP lezen ----------
  async function unzip(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);
    // End of central directory zoeken
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Geen geldig zip-bestand (EOCD niet gevonden)');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('Zip: centrale directory beschadigd');
      const method = dv.getUint16(off + 10, true);
      const csize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const name = td.decode(u8.subarray(off + 46, off + 46 + nameLen));
      files[name] = { method, csize, localOff };
      off += 46 + nameLen + extraLen + commLen;
    }
    async function read(name) {
      const f = files[name];
      if (!f) return null;
      const lo = f.localOff;
      if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('Zip: local header beschadigd');
      const nameLen = dv.getUint16(lo + 26, true);
      const extraLen = dv.getUint16(lo + 28, true);
      const start = lo + 30 + nameLen + extraLen;
      const data = u8.subarray(start, start + f.csize);
      if (f.method === 0) return data;
      if (f.method === 8) return await inflateRaw(data);
      throw new Error('Zip: compressiemethode ' + f.method + ' niet ondersteund');
    }
    return { names: Object.keys(files), read, readText: async (n) => { const b = await read(n); return b ? td.decode(b) : null; } };
  }

  // ---------- ZIP schrijven ----------
  function dosDateTime(d = new Date()) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }
  // entries: [{name, data: Uint8Array|string, store?: bool}]
  async function zip(entries) {
    const parts = [];
    const central = [];
    let offset = 0;
    const { time, date } = dosDateTime();
    for (const e of entries) {
      const raw = typeof e.data === 'string' ? te.encode(e.data) : e.data;
      const nameB = te.encode(e.name);
      const crc = crc32(raw);
      let method = 8, comp = raw;
      if (e.store || raw.length < 64) { method = 0; }
      else {
        comp = await deflateRaw(raw);
        if (comp.length >= raw.length) { method = 0; comp = raw; }
      }
      const lh = new Uint8Array(30 + nameB.length);
      const ldv = new DataView(lh.buffer);
      ldv.setUint32(0, 0x04034b50, true); ldv.setUint16(4, 20, true); ldv.setUint16(6, 0x0800, true);
      ldv.setUint16(8, method, true); ldv.setUint16(10, time, true); ldv.setUint16(12, date, true);
      ldv.setUint32(14, crc, true); ldv.setUint32(18, comp.length, true); ldv.setUint32(22, raw.length, true);
      ldv.setUint16(26, nameB.length, true); ldv.setUint16(28, 0, true);
      lh.set(nameB, 30);
      parts.push(lh, comp);
      const ch = new Uint8Array(46 + nameB.length);
      const cdv = new DataView(ch.buffer);
      cdv.setUint32(0, 0x02014b50, true); cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true); cdv.setUint16(8, 0x0800, true);
      cdv.setUint16(10, method, true); cdv.setUint16(12, time, true); cdv.setUint16(14, date, true);
      cdv.setUint32(16, crc, true); cdv.setUint32(20, comp.length, true); cdv.setUint32(24, raw.length, true);
      cdv.setUint16(28, nameB.length, true); cdv.setUint32(42, offset, true);
      ch.set(nameB, 46);
      central.push(ch);
      offset += lh.length + comp.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true); edv.setUint16(8, entries.length, true); edv.setUint16(10, entries.length, true);
    edv.setUint32(12, cdSize, true); edv.setUint32(16, offset, true);
    const total = offset + cdSize + 22;
    const out = new Uint8Array(total);
    let p = 0;
    for (const x of [...parts, ...central, eocd]) { out.set(x, p); p += x.length; }
    return out;
  }

  // ---------- XML hulpjes ----------
  const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const xmlUnesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
  // verwijder ongeldige XML-tekens
  const xmlSafe = (s) => String(s ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function colIndex(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }

  // ---------- XLSX lezen ----------
  // Geeft {sheets:[{name, rows:[[...]]}]} — rows als arrays van waarden (string/number/boolean/null)
  // rich text: vet/cursief/onderstreept per run wordt bewaard als {b}…{/b}, {i}…{/i}, {u}…{/u} in de tekst
  // (gaat mee naar de sectie-Excel, het boekje en het rooster; niet naar Magister)
  const OPMAAK_RE = /\{\/?[biu]\}/g;
  const STIJLEN = ['b', 'i', 'u'];
  function runsNaarTekst(inner) {
    const runs = [...inner.matchAll(/<r>([\s\S]*?)<\/r>/g)];
    if (!runs.length) { const ts = []; for (const x of inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) ts.push(xmlUnesc(x[1])); return ts.join(''); }
    let out = ''; let open = [];
    for (const r of runs) {
      const rpr = (r[1].match(/<rPr>([\s\S]*?)<\/rPr>/) || [])[1] || '';
      const ts = []; for (const x of r[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) ts.push(xmlUnesc(x[1]));
      const tekst = ts.join(''); if (!tekst) continue;
      if (tekst.trim()) {
        const wil = STIJLEN.filter(s => new RegExp(`<${s}\\b`).test(rpr));
        const weg = open.filter(s => !wil.includes(s));
        if (weg.length) { for (const s of open.slice().reverse()) out += `{/${s}}`; open = []; }
        for (const s of wil) if (!open.includes(s)) { out += `{${s}}`; open.push(s); }
      }
      out += tekst;
    }
    for (const s of open.slice().reverse()) out += `{/${s}}`;
    return out.replace(/(\s+)((?:\{\/[biu]\})+)$/g, '$2$1').replace(/(\s+)(\{\/[biu]\})/g, '$2$1');
  }
  function zonderOpmaak(s) { return String(s ?? '').replace(OPMAAK_RE, ''); }
  function heeftOpmaak(s) { return /\{[biu]\}/.test(String(s ?? '')); }
  function opmaakHtml(s, escFn) { return escFn(String(s ?? '')).replace(/\{(\/?)([biu])\}/g, '<$1$2>'); }
  function opmaakRuns(s) {
    const out = []; const open = [];
    for (const deel of String(s).split(/(\{\/?[biu]\})/g)) {
      if (!deel) continue;
      const m = deel.match(/^\{(\/?)([biu])\}$/);
      if (m) { if (m[1]) { const i = open.indexOf(m[2]); if (i >= 0) open.splice(i, 1); } else if (!open.includes(m[2])) open.push(m[2]); continue; }
      out.push(`<r>${open.length ? `<rPr>${open.map(x => `<${x}/>`).join('')}</rPr>` : ''}<t xml:space="preserve">${xmlEsc(xmlSafe(deel))}</t></r>`);
    }
    return out.join('');
  }
  async function readXlsx(arrayBuffer) {
    const z = await unzip(arrayBuffer);
    // shared strings
    const shared = [];
    const ssXml = await z.readText('xl/sharedStrings.xml');
    if (ssXml) {
      const re = /<si>([\s\S]*?)<\/si>/g; let m;
      while ((m = re.exec(ssXml))) shared.push(runsNaarTekst(m[1]));
    }
    const wbXml = await z.readText('xl/workbook.xml') || '';
    const relsXml = await z.readText('xl/_rels/workbook.xml.rels') || '';
    const rels = {};
    for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const a = m[1];
      const id = (a.match(/\bId="([^"]+)"/) || [])[1];
      const target = (a.match(/\bTarget="([^"]+)"/) || [])[1];
      if (id && target) rels[id] = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    }
    const sheets = [];
    for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const a = m[1];
      const name = xmlUnesc((a.match(/\bname="([^"]*)"/) || [])[1] || '');
      const rid = (a.match(/\br:id="([^"]+)"/) || a.match(/\bid="(rId[^"]+)"/) || [])[1];
      let path = rels[rid] || '';
      if (path && !path.startsWith('xl/')) path = 'xl/' + path;
      const xml = await z.readText(path);
      if (xml == null) continue;
      sheets.push({ name, rows: parseSheet(xml, shared) });
    }
    return { sheets };
  }
  function parseSheet(xml, shared) {
    const rows = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g; let rm;
    while ((rm = rowRe.exec(xml))) {
      const cells = [];
      const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
      let rowIdx = null;
      while ((cm = cRe.exec(rm[1]))) {
        const attrs = cm[1]; const inner = cm[2] || '';
        const ref = (attrs.match(/\br="([A-Z]+)(\d+)"/) || []);
        const col = ref[1] ? colIndex(ref[1]) : cells.length + 1;
        rowIdx = ref[2] ? +ref[2] : rowIdx;
        const t = (attrs.match(/\bt="([^"]+)"/) || [])[1];
        let val = null;
        if (t === 'inlineStr') val = runsNaarTekst(inner); else {
          const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          if (v != null) {
            if (t === 's') val = shared[+v] ?? '';
            else if (t === 'b') val = v === '1';
            else if (t === 'str' || t === 'e') val = xmlUnesc(v);
            else { const n = Number(v); val = isNaN(n) ? xmlUnesc(v) : n; }
          }
        }
        cells[col - 1] = val;
      }
      const r = rowIdx || rows.length + 1;
      rows[r - 1] = cells;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  // ---------- XLSX schrijven ----------
  // spec: { sheets:[{ name, cols:[{width, hidden}], rows:[[cell,...]], freeze:'A2', merges:['A1:B1'], hidden, tabColor,
  //   gridLines:false, zoom:110, autoFilter:'A4:Q40', printTitleRows:'4:4', landscape:true,
  //   validations:[{sqref, type:'list'|'decimal', formula1, operator, allowBlank, errorTitle, error, promptTitle, prompt}],
  //   condFormats:[{sqref, formula, fill, fontColor, bold, strike}],
  //   protect:{ password?, formatRows, formatColumns, insertRows, insertColumns, deleteRows, deleteColumns, sort, autoFilter } }] }
  // cell: primitive | {v, f, s (legacy stijl-id) | st:{b,i,sz,color,strike,name, fill, border, h, v, wrap, unlocked, numFmt}}
  // row-array mag __height dragen.
  const STYLES = { normal: 0, header: 1, bold: 2, wrap: 3, num: 4, locked: 5, id: 6, headerLight: 7 };
  const LEGACY_STYLES = [
    { border: true, v: 'top' },
    { b: true, fill: 'F3E1D7', border: true, v: 'center', wrap: true },
    { b: true, border: true, v: 'top' },
    { border: true, v: 'top', wrap: true },
    { border: true, v: 'top', h: 'center' },
    { sz: 9, color: '888888', fill: 'F7F3EC', border: true, v: 'top' },
    { sz: 9, color: '888888', fill: 'F7F3EC', border: true, v: 'top', h: 'center' },
    { b: true, fill: 'F7F3EC', border: true, v: 'top' },
  ];
  function maakStijlRegister() {
    const fonts = [], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'], borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'], xfs = [], dxfs = [];
    const fontKey = {}, fillKey = { none: 0 }, borderKey = { none: 0 }, xfKey = {}, dxfKey = {};
    const font = (st) => {
      const k = `${st.b ? 'b' : ''}|${st.i ? 'i' : ''}|${st.strike ? 's' : ''}|${st.sz || 11}|${st.color || ''}|${st.name || 'Calibri'}`;
      if (fontKey[k] === undefined) { fonts.push(`<font>${st.b ? '<b/>' : ''}${st.i ? '<i/>' : ''}${st.strike ? '<strike/>' : ''}<sz val="${st.sz || 11}"/>${st.color ? `<color rgb="FF${st.color}"/>` : ''}<name val="${st.name || 'Calibri'}"/></font>`); fontKey[k] = fonts.length - 1; }
      return fontKey[k];
    };
    const fill = (rgb) => {
      if (!rgb) return 0;
      if (fillKey[rgb] === undefined) { fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`); fillKey[rgb] = fills.length - 1; }
      return fillKey[rgb];
    };
    const border = (b) => {
      if (!b) return 0; const c = b === true ? 'A6A6A6' : b;
      if (borderKey[c] === undefined) { borders.push(`<border><left style="thin"><color rgb="FF${c}"/></left><right style="thin"><color rgb="FF${c}"/></right><top style="thin"><color rgb="FF${c}"/></top><bottom style="thin"><color rgb="FF${c}"/></bottom><diagonal/></border>`); borderKey[c] = borders.length - 1; }
      return borderKey[c];
    };
    const xf = (st) => {
      if (!st) return 0;
      const k = JSON.stringify(st);
      if (xfKey[k] !== undefined) return xfKey[k];
      const fo = font(st), fi = fill(st.fill), bo = border(st.border);
      const numFmt = st.numFmt || 0;
      const al = (st.h || st.v || st.wrap) ? `<alignment${st.h ? ` horizontal="${st.h}"` : ''}${st.v ? ` vertical="${st.v}"` : ''}${st.wrap ? ' wrapText="1"' : ''}/>` : '';
      xfs.push(`<xf numFmtId="${numFmt}" fontId="${fo}" fillId="${fi}" borderId="${bo}" xfId="0" applyFont="1"${fi ? ' applyFill="1"' : ''}${bo ? ' applyBorder="1"' : ''}${al ? ' applyAlignment="1"' : ''}${st.unlocked ? ' applyProtection="1"' : ''}>${al}${st.unlocked ? '<protection locked="0"/>' : ''}</xf>`);
      xfKey[k] = xfs.length - 1; return xfKey[k];
    };
    const dxf = (cf) => {
      const k = JSON.stringify([cf.fill, cf.fontColor, cf.bold, cf.strike]);
      if (dxfKey[k] !== undefined) return dxfKey[k];
      dxfs.push(`<dxf>${(cf.fontColor || cf.bold || cf.strike) ? `<font>${cf.bold ? '<b/>' : ''}${cf.strike ? '<strike/>' : ''}${cf.fontColor ? `<color rgb="FF${cf.fontColor}"/>` : ''}</font>` : ''}${cf.fill ? `<fill><patternFill patternType="solid"><bgColor rgb="FF${cf.fill}"/></patternFill></fill>` : ''}</dxf>`);
      dxfKey[k] = dxfs.length - 1; return dxfKey[k];
    };
    // standaardstijl 0 + legacy-stijlen 1..7 vooraf registreren zodat oude s-ids blijven werken
    xf({ v: 'bottom' }); LEGACY_STYLES.slice(1).forEach(s => xf(s));
    const xml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${fonts.length}">${fonts.join('')}</fonts>
<fills count="${fills.length}">${fills.join('')}</fills>
<borders count="${borders.length}">${borders.join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Standaard" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="${dxfs.length}">${dxfs.join('')}</dxfs>
</styleSheet>`;
    return { xf, dxf, xml };
  }
  function sheetXml(sh, reg) {
    let out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
    out += `<sheetPr>${sh.tabColor ? `<tabColor rgb="FF${sh.tabColor}"/>` : ''}<outlinePr summaryBelow="0"/><pageSetUpPr fitToPage="1"/></sheetPr>`;
    out += `<sheetViews><sheetView workbookViewId="0"${sh.first ? ' tabSelected="1"' : ''}${sh.gridLines === false ? ' showGridLines="0"' : ''}${sh.zoom ? ` zoomScale="${sh.zoom}"` : ''}>`;
    if (sh.freeze) {
      const m = sh.freeze.match(/^([A-Z]+)(\d+)$/); const c = colIndex(m[1]) - 1, r = +m[2] - 1;
      out += `<pane${c ? ` xSplit="${c}"` : ''}${r ? ` ySplit="${r}"` : ''} topLeftCell="${sh.freeze}" activePane="bottomRight" state="frozen"/>`;
    }
    out += `</sheetView></sheetViews>`;
    out += `<sheetFormatPr defaultRowHeight="15"/>`;
    if (sh.cols && sh.cols.length) {
      out += '<cols>';
      sh.cols.forEach((c, i) => { out += `<col min="${i + 1}" max="${i + 1}" width="${c.width || 12}" customWidth="1"${c.hidden ? ' hidden="1"' : ''}/>`; });
      out += '</cols>';
    }
    out += '<sheetData>';
    sh.rows.forEach((row, ri) => {
      if (!row) return;
      const ht = row.__height ? ` ht="${row.__height}" customHeight="1"` : '';
      out += `<row r="${ri + 1}"${ht}>`;
      row.forEach((cell, ci) => {
        if (cell === undefined || cell === null || cell === '') return;
        const ref = colLetter(ci + 1) + (ri + 1);
        let v = cell, f = null, s = 0;
        if (typeof cell === 'object') { v = cell.v; f = cell.f || null; s = cell.st ? reg.xf(cell.st) : (cell.s || 0); }
        const sAttr = s ? ` s="${s}"` : '';
        if (f) { out += `<c r="${ref}"${sAttr}${typeof v === 'string' ? ' t="str"' : ''}><f>${xmlEsc(f)}</f>${v !== undefined && v !== null && v !== '' ? `<v>${xmlEsc(String(v))}</v>` : ''}</c>`; return; }
        if (v === undefined || v === null || v === '') { if (s) out += `<c r="${ref}"${sAttr}/>`; return; }
        if (typeof v === 'number') out += `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
        else if (typeof v === 'boolean') out += `<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
        else if (heeftOpmaak(v)) out += `<c r="${ref}"${sAttr} t="inlineStr"><is>${opmaakRuns(v)}</is></c>`;
        else out += `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(xmlSafe(v))}</t></is></c>`;
      });
      out += '</row>';
    });
    out += '</sheetData>';
    if (sh.protect) {
      const p = sh.protect; const a = (k, def) => (p[k] === undefined ? def : p[k]) ? '1' : '0';
      out += `<sheetProtection sheet="1" objects="1" scenarios="1" formatCells="${a('formatCells', true)}" formatColumns="${a('formatColumns', true)}" formatRows="${a('formatRows', false)}" insertColumns="${a('insertColumns', true)}" insertRows="${a('insertRows', true)}" insertHyperlinks="1" deleteColumns="${a('deleteColumns', true)}" deleteRows="${a('deleteRows', true)}" selectLockedCells="0" sort="${a('sort', true)}" autoFilter="${a('autoFilter', false)}" pivotTables="1" selectUnlockedCells="0"/>`;
    }
    if (sh.autoFilter) out += `<autoFilter ref="${sh.autoFilter}"/>`;
    if (sh.merges && sh.merges.length) out += `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`;
    if (sh.condFormats && sh.condFormats.length) {
      sh.condFormats.forEach((cf, i) => { out += `<conditionalFormatting sqref="${cf.sqref}"><cfRule type="expression" dxfId="${reg.dxf(cf)}" priority="${i + 1}"><formula>${xmlEsc(cf.formula)}</formula></cfRule></conditionalFormatting>`; });
    }
    if (sh.validations && sh.validations.length) {
      out += `<dataValidations count="${sh.validations.length}">`;
      for (const dv of sh.validations) {
        const type = dv.type || 'list';
        out += `<dataValidation type="${type}"${dv.operator ? ` operator="${dv.operator}"` : ''} allowBlank="${dv.allowBlank === false ? 0 : 1}" showInputMessage="${dv.prompt ? 1 : 0}" showErrorMessage="1" errorStyle="stop" errorTitle="${xmlEsc(dv.errorTitle || 'Ongeldige waarde')}" error="${xmlEsc(dv.error || 'Kies een waarde uit de lijst.')}"${dv.prompt ? ` promptTitle="${xmlEsc(dv.promptTitle || '')}" prompt="${xmlEsc(dv.prompt)}"` : ''} sqref="${dv.sqref}"><formula1>${xmlEsc(dv.formula1 || dv.list)}</formula1>${dv.formula2 ? `<formula2>${xmlEsc(dv.formula2)}</formula2>` : ''}</dataValidation>`;
      }
      out += '</dataValidations>';
    }
    out += `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sh.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>`;
    out += '</worksheet>';
    return out;
  }
  async function writeXlsx(spec) {
    const sheets = spec.sheets;
    sheets[0].first = true;
    const reg = maakStijlRegister();
    const sheetXmls = sheets.map(s => sheetXml(s, reg));
    const entries = [];
    entries.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` });
    entries.push({ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` });
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const app = spec.app || 'Porteum e-PTA';
    entries.push({ name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${xmlEsc(app)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` });
    entries.push({ name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${xmlEsc(app)}</Application></Properties>` });
    entries.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="12000"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets>${sheets.some(s => s.printTitleRows) ? `<definedNames>${sheets.map((s, i) => s.printTitleRows ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${xmlEsc(s.name).replace(/'/g, "''")}'!$${s.printTitleRows.replace(':', ':$')}</definedName>` : '').join('')}</definedNames>` : ''}<calcPr fullCalcOnLoad="1"/></workbook>` });
    entries.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
    entries.push({ name: 'xl/styles.xml', data: reg.xml() });
    sheetXmls.forEach((x, i) => entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x }));
    return await zip(entries);
  }

  // ---------- DOCX lezen (alinea-tekst) ----------
  async function readDocxParagraphs(arrayBuffer) {
    const z = await unzip(arrayBuffer);
    const xml = await z.readText('word/document.xml');
    if (!xml) throw new Error('Geen word/document.xml gevonden');
    const paras = [];
    for (const p of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
      const block = p[0];
      const hm = block.match(/<w:pStyle w:val="(?:Heading|Kop|Title|Titel)\s*(\d?)[^"]*"/i);
      const isHeading = !!hm;
      const level = hm ? (parseInt(hm[1], 10) || 1) : 0;
      const list = /<w:numPr>/.test(block) || /<w:pStyle w:val="(ListParagraph|Lijstalinea)"/i.test(block);
      // per run de opmaak (vet/cursief/onderstreept) meenemen als {b}/{i}/{u}-markering
      let text = '';
      let open = [];
      const sluitAlles = () => { for (const st of open.slice().reverse()) text += `{/${st}}`; open = []; };
      for (const r of block.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>|<w:(?:tab|br)\b[^>]*\/>/g)) {
        const run = r[0];
        if (/^<w:(tab|br)/.test(run)) { text += run.startsWith('<w:tab') ? '\t' : '\n'; continue; }
        const rpr = (run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || '';
        let deel = '';
        for (const t of run.matchAll(/<w:(t|tab|br)\b([^>]*?)\s*(?:\/>|>([\s\S]*?)<\/w:t>)/g)) {
          if (t[1] === 't') deel += xmlUnesc(t[3] || '');
          else if (t[1] === 'tab') deel += '\t';
          else deel += '\n';
        }
        if (!deel) continue;
        if (deel.trim()) {
          const wil = [];
          if (/<w:b\b(?![^>]*w:val="(0|false)")/.test(rpr)) wil.push('b');
          if (/<w:i\b(?![^>]*w:val="(0|false)")/.test(rpr)) wil.push('i');
          if (/<w:u\b(?![^>]*w:val="none")/.test(rpr)) wil.push('u');
          if (open.some(st => !wil.includes(st))) sluitAlles();
          for (const st of wil) if (!open.includes(st)) { text += `{${st}}`; open.push(st); }
        }
        text += deel;
      }
      sluitAlles();
      paras.push({ text, heading: isHeading, level, list });
    }
    return paras;
  }

  // ---------- CSV / TSV ----------
  function parseDelimited(text, delim) {
    text = text.replace(/^\uFEFF/, '');
    if (!delim) {
      const first = text.split(/\r?\n/, 1)[0] || '';
      const cnt = (ch) => (first.match(new RegExp('\\' + ch, 'g')) || []).length;
      delim = cnt('\t') >= cnt(';') && cnt('\t') >= cnt(',') ? '\t' : (cnt(';') >= cnt(',') ? ';' : ',');
    }
    const rows = []; let row = []; let field = ''; let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"' && field === '') inQ = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = ''; rows.push(row); row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return { rows: rows.filter(r => r.some(x => x !== '')), delim };
  }
  function csvField(v, delim = ';') {
    let s = v === null || v === undefined ? '' : String(v);
    if (s.includes('"') || s.includes(delim) || /[\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // ---------- Tekst-sanitizing (uit de bouwer-formule) ----------
  const REPL = [
    ['\t', ' '], ['\n', ' '], ['\r', ' '], ['\uFEFF', ''], ['\u00A0', ' '],
    ['‘', "'"], ['’', "'"], ['`', "'"], ['´', "'"], ['“', '"'], ['”', '"'], ['„', '"'],
    ['–', '-'], ['—', '-'], ['…', '...'], ['¹', '1'], ['²', '2'], ['³', '3'], ['½', '1/2'], [';', ','],
    ['á', 'a'], ['à', 'a'], ['â', 'a'], ['ä', 'a'], ['é', 'e'], ['è', 'e'], ['ê', 'e'], ['ë', 'e'], ['í', 'i'], ['ì', 'i'], ['î', 'i'], ['ï', 'i'],
    ['ó', 'o'], ['ò', 'o'], ['ô', 'o'], ['ö', 'o'], ['ú', 'u'], ['ù', 'u'], ['û', 'u'], ['ü', 'u'], ['ñ', 'n'], ['ç', 'c'],
    ['Á', 'A'], ['Ä', 'A'], ['É', 'E'], ['È', 'E'], ['Ë', 'E'], ['Í', 'I'], ['Ï', 'I'], ['Ó', 'O'], ['Ö', 'O'], ['Ü', 'U'], ['Ñ', 'N'], ['Ç', 'C'], ['§', 'par.'],
  ];
  const REPL_BASIS = REPL.slice(0, 20); // t/m ';' -> ',' ; daarna accenten
  let accenten = false;
  let eigen = null; // instelbare vervangingstabel [[van, naar], ...]
  function sanitize(s) {
    if (s === null || s === undefined) return '';
    let t = String(s).replace(OPMAAK_RE, '');
    const tabel = eigen || (accenten ? REPL : REPL_BASIS);
    for (const [a, b] of tabel) if (a) t = t.split(a).join(b);
    if (accenten && eigen) for (const [a, b] of REPL.slice(20)) t = t.split(a).join(b);
    return t.replace(/\s+/g, ' ').trim();
  }
  function zetAccenten(v) { accenten = !!v; }
  function zetVervangingen(lijst) { eigen = Array.isArray(lijst) && lijst.length ? lijst : null; }
  const STANDAARD_VERVANGINGEN = REPL_BASIS.map(x => [x[0], x[1]]);

  function download(name, data, mime = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  return { crc32, unzip, zip, pakIn, pakUit, readXlsx, writeXlsx, zonderOpmaak, heeftOpmaak, opmaakHtml, readDocxParagraphs, parseDelimited, csvField, sanitize, zetAccenten, zetVervangingen, STANDAARD_VERVANGINGEN, download, colLetter, colIndex, STYLES, xmlEsc };
})();

/* ===================== MODEL: instellingen, normalisatie, berekeningen, validatie ===================== */
const PERIODES = ['P0', 'P1', 'P2', 'P3', 'P4', 'AFSE'];
const PERIODE_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, AFSE: 5 };
const PERIODE_CIJFER = { P0: '0', P1: '1', P2: '2', P3: '3', P4: '4', AFSE: '9' };
// oude (v1/v2) handmatige vakstatus; wordt bij migratie omgezet naar gebeurtenissen
const STATUSSEN = ['concept', 'uitgezet', 'ontvangen', 'gecontroleerd', 'akkoord'];
const STATUS_LABEL = { concept: 'Nog niet uitgezet', uitgezet: 'Uitgezet', ontvangen: 'Retour ontvangen', gecontroleerd: 'Retour verwerkt', akkoord: 'Akkoord' };
// v3: status per vak/studie wordt afgeleid uit gebeurtenissen (zie vakStatus)
const STATUS_V3 = ['niet', 'sectie', 'ingeleverd', 'fouten', 'gecontroleerd', 'magister', 'nvt'];
const STATUS_V3_LABEL = { niet: 'nog niet uitgezet', sectie: 'bij de sectie', ingeleverd: 'ingeleverd', fouten: 'fouten', gecontroleerd: 'goedgekeurd', magister: 'in Magister', nvt: 'n.v.t.' };
const STATUS_V3_UITLEG = {
  niet: 'Er is nog geen sectie-Excel voor dit vak gemaakt.',
  sectie: 'De sectie-Excel is gemaakt en verstuurd; er is nog niets terug.',
  ingeleverd: 'De retour is ingelezen; het vak wacht op controle en goedkeuring.',
  fouten: 'Er staan regels met fouten; los ze op of accepteer ze in Verwerken › Controleren.',
  gecontroleerd: 'Alle regels zijn goedgekeurd; het vak kan naar Magister.',
  magister: 'De Magister-CSV van deze studie is gemaakt na de goedkeuring.',
  nvt: 'Dit vak is uitgesloten voor deze studie.',
};
// gebeurtenissen: uitgezet (Excel gemaakt), retour (retour ingelezen), ongewijzigd (sectie hoeft niets te wijzigen = retour + goedkeuring),
// goedgekeurd, heropend, magister (CSV gemaakt voor de studie)
const GEBEURTENIS_LABEL = { opgehaald: 'Opgehaald uit Decibel', uitgezet: 'Sectie-Excel gemaakt', retour: 'Retour ingelezen', ongewijzigd: 'Gemarkeerd als ongewijzigd', goedgekeurd: 'Goedgekeurd', heropend: 'Goedkeuring ingetrokken', magister: 'Magister-CSV gemaakt', inleiding: 'Vakinleiding ingelezen' };
function vakGebeurtenis(project, key, soort, info = '') {
  const v = project.vakken[key] || (project.vakken[key] = { inleiding: '', notitie: '' });
  v.gebeurtenissen = v.gebeurtenissen || [];
  const t = new Date().toISOString();
  v.gebeurtenissen.push({ t, soort, info });
  if (v.gebeurtenissen.length > 60) v.gebeurtenissen.splice(0, v.gebeurtenissen.length - 60);
  if (soort === 'uitgezet') v.uitgezetOp = t;
  if (soort === 'retour' || soort === 'ongewijzigd') v.ontvangenOp = t;
  return v;
}
function laatsteGebeurtenis(v, ...soorten) { const g = (v && v.gebeurtenissen) || []; for (let i = g.length - 1; i >= 0; i--) if (soorten.includes(g[i].soort)) return g[i]; return null; }
// status van één vak; perVakStat = valideerProject(project).perVak[key] (mag ontbreken)
function vakStatus(project, key, perVakStat) {
  const [studie, vak] = key.split('|');
  if (vakUitgesloten(project, studie, vak)) return { code: 'nvt', datum: '', uitgezet: false, terug: false };
  const v = project.vakken[key] || {};
  const uit = laatsteGebeurtenis(v, 'uitgezet');
  const laatst = laatsteGebeurtenis(v, 'goedgekeurd', 'ongewijzigd', 'heropend', 'retour');
  const goedOk = laatst && (laatst.soort === 'goedgekeurd' || laatst.soort === 'ongewijzigd');
  const goed = laatst;
  // 'ongewijzigd' telt als retour, tenzij daarna heropend
  const ret = laatst && laatst.soort === 'ongewijzigd' ? laatst : laatsteGebeurtenis(v, 'retour');
  const mag = laatsteGebeurtenis(v, 'magister');
  const terug = !!(ret && (!uit || ret.t >= uit.t)) || !!goedOk;
  const vlag = { uitgezet: !!uit || terug, terug };
  if (perVakStat && perVakStat.fouten) return Object.assign({ code: 'fouten', datum: ret ? ret.t : (uit ? uit.t : '') }, vlag);
  if (goedOk && mag && mag.t >= goed.t) return Object.assign({ code: 'magister', datum: mag.t }, vlag);
  if (goedOk) return Object.assign({ code: 'gecontroleerd', datum: goed.t }, vlag);
  if (terug) return Object.assign({ code: 'ingeleverd', datum: ret.t }, vlag);
  if (uit) return Object.assign({ code: 'sectie', datum: uit.t }, vlag);
  return Object.assign({ code: 'niet', datum: '' }, vlag);
}
// stand van zaken: per studie en totaal, voor Overzicht, zijbalk en Studies
function standVanZaken(project, validatie) {
  const v = validatie || valideerProject(project);
  const perStudie = {};
  const tel = {}; STATUS_V3.forEach(s => tel[s] = 0);
  const vakkenMap = {};
  for (const r of project.rijen) { const k = vakKey(r); if (!vakkenMap[k]) vakkenMap[k] = { key: k, studie: r.studie, vak: r.vak, aantal: 0 }; vakkenMap[k].aantal++; }
  // ook vakken die alleen in project.vakken staan (bijv. na n.v.t.) meenemen als ze rijen hebben: nee — alleen vakken met regels
  const vakken = Object.values(vakkenMap).sort((a, b) => a.studie.localeCompare(b.studie) || vakCompare(a.vak, b.vak));
  let metInleiding = 0, uitgezet = 0, terug = 0;
  for (const x of vakken) {
    const st = vakStatus(project, x.key, v.perVak[x.key]);
    x.status = st.code; x.datum = st.datum; x.stat = v.perVak[x.key]; x.uitgezet = st.uitgezet; x.terug = st.terug;
    if (st.code !== 'nvt') { if (st.uitgezet) uitgezet++; if (st.terug) terug++; }
    const info = project.vakken[x.key] || {};
    x.inleiding = !!(info.inleiding || '').trim(); if (x.inleiding) metInleiding++;
    tel[st.code]++;
    const s = perStudie[x.studie] || (perStudie[x.studie] = { studie: x.studie, vakken: [], tel: Object.fromEntries(STATUS_V3.map(q => [q, 0])) });
    s.vakken.push(x); s.tel[st.code]++;
  }
  for (const s of Object.values(perStudie)) { s.actief = s.vakken.length - s.tel.nvt; s.klaar = s.tel.gecontroleerd + s.tel.magister; s.uitgezet = s.vakken.filter(x => x.uitgezet && x.status !== 'nvt').length; s.terug = s.vakken.filter(x => x.terug && x.status !== 'nvt').length; }
  const actief = vakken.length - tel.nvt;
  return { vakken, perStudie, tel, actief, metInleiding, uitgezet, terug, nogTerug: uitgezet - terug, klaar: tel.gecontroleerd + tel.magister, validatie: v };
}
function deadlineTekst(project, studie) {
  const st = studieInfo(project, studie);
  if (st && st.deadline) { const d = new Date(st.deadline + 'T12:00:00'); if (!isNaN(d)) return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }); }
  return project.instellingen.sectie.deadline || '';
}
const TOETSVORMEN = ['Schriftelijke Toets', 'Praktische Toets', 'Mondelinge Toets', 'Voortgangstoets'];
const TYPES_TOETS = ['Schoolexamen', 'Voortgangstoets'];
const TYPE_AUTO = 'auto'; // type toets afleiden uit PTA ja/nee
const KOLOMKOP = { 'Schriftelijke Toets': 'ST', 'Praktische Toets': 'PO', 'Mondelinge Toets': 'MT', 'Voortgangstoets': 'VT' };
// de in Magister bestaande waarden; instelbaar per project (Cijferkolommen -> Toetsvorm / Soort toets)
function magVormen(project) { const l = project && project.instellingen && project.instellingen.magToetsvormen; return Array.isArray(l) && l.length ? l : TOETSVORMEN; }
function magTypen(project) { const l = project && project.instellingen && project.instellingen.magTypes; return Array.isArray(l) && l.length ? l : TYPES_TOETS; }
function kolomkopVoor(project, vorm) { const m = (project && project.instellingen && project.instellingen.kolomkopVan) || KOLOMKOP; return m[vorm] || KOLOMKOP[vorm] || ''; }
// de Code (CSV-kolom Kolomkop) voor één regel: 1) wat de sectie zelf invulde, 2) een code die
// hoort bij de ruwe toetsingsvorm uit de Excel (bijv. klv -> KLV), 3) de code van de Magister-toetsingsvorm
function codeVoorRegel(project, r, toetsvorm) {
  if (r && r.kolomkop) return r.kolomkop;
  const ruw = String((r && r.toetsvorm) ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const cm = (project && project.instellingen && project.instellingen.codeVanRuw) || {};
  if (ruw && cm[ruw]) return cm[ruw];
  return kolomkopVoor(project, toetsvorm) || '';
}

const STANDAARD_LOGO = 'data:image/png;base64,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';
const MAGISTER_KOLOMMEN = ['Locatie', 'Studiecode', 'Vakcode', 'Cijferperiode', 'Kolomnummer', 'Volgnummer', 'PTO/PTA', 'Omschrijving', 'Kolomkop', 'Kolomnaam', 'Weegfactor', 'Soort herkansing', 'Cijfertekst', 'Minimum cijfer', 'Maximum cijfer', 'Aantal decimalen', 'Tijdsduur', 'Afnamemoment', 'Examenstof SE', 'Eindtermen SE', 'Examenstof CE', 'Eindtermen CE', 'Eigen examenstof', 'Type toets', 'Toetsingsvorm', 'Uitgebreide uitleg'];

function standaardInstellingen() {
  return {
    vakSortering: 'naam',   // v3.48: 'naam' = op volledige vaknaam, 'code' = op vakcode
    schooljaar: '2627',
    schooljaarTekst: '2026-2027',
    bronLesperiode: '2526',       // lesperiode in Decibel waaruit query 1 exporteert
    nummerPrefix: '2627',         // uniek nummer: prefix/0002
    idGebr: '55488',              // useraanm/userwijz in sis_ckolx
    schoolnaam: 'Porteum',
    maxAfnamemoment: 15,
    maxEindtermen: 100,
    kolomnummerMetLeerjaar: true,
    rveld1Bron: 'hulpmiddelen',   // 'hulpmiddelen' of 'typeToets'
    decimaleWeging: 'sluitend',   // iveld2/init_wfac zijn int 0-100: 'sluitend' (afronden, som blijft gelijk), 'afronden' of 'fout'
    inleidingAlleenLeeg: false,   // sis_svak.ptainleiding alleen vullen als het veld nog leeg is
    // keuzelijsten in de sectie-Excel (lichtblauwe cellen); toetsvorm/soort worden via mapToetsvorm/mapTypeToets naar Magister vertaald
    keuzelijsten: { periode: ['P0', 'P1', 'P2', 'P3', 'P4', 'AFSE'], toetsvorm: ['Schriftelijk', 'Mondeling', 'Praktisch'], soort: ['Toets', 'Opdracht', 'Presentatie'], afname: [] },
    afnameStrikt: false,          // onbekend afnamemoment als waarschuwing melden in Controleren
    // teksten in de sectie-Excel en het boekje
    sectie: { deadline: '26 september 2026', contact: 'ict@porteum.nl', extraRegels: 5, uitlegExtra: '' },
    rapport: { titelPta: 'Programma van toetsing en afsluiting', titelPtd: 'Programma van toetsing en doorstroom', kopPta: 'PTA', kopPtd: 'PTD', logo: STANDAARD_LOGO, ondertitel: 'Porteum', legendaToetsvorm: 'MT = mondelinge toets\nPO = praktische opdracht\nST = schriftelijke toets\nKLV = kijk-/luistervaardigheid', legendaAfname: 'TW1 = toetsweek 1 · TW2 = toetsweek 2 · TW3 = toetsweek 3\nLes = afname tijdens vakles\nCentraal = gehele leerjaar op één moment roosteren buiten toetsweek', legendaPeriode: 'P = periode', inleidingBoven: true, vakOpNieuwePagina: true, versieOpmaak: 'lang', versieHistorie: true, inhoudVak: 'code', inhoudPaginas: true, inhoudKlikbaar: true, voetPaginas: true, voetSjabloon: 'Pagina {n} van {totaal}' },
    accentenVervangen: false,     // é->e enz. (CSV is UTF-8, dus niet nodig; de oude bouwer deed dit wel)
    // tekens die Magister niet accepteert in tekstvelden en waarmee ze vervangen worden
    vervangingen: [['\t', ' '], ['\n', ' '], ['\r', ' '], ['\u00A0', ' '], ['\uFEFF', ''], ['"', "'"], ['\u201C', "'"], ['\u201D', "'"], ['\u201E', "'"], ['\u2018', "'"], ['\u2019', "'"], ['`', "'"], ['\u00B4', "'"], ['\u2013', '-'], ['\u2014', '-'], ['\u2026', '...'], ['\u00B9', '1'], ['\u00B2', '2'], ['\u00B3', '3'], ['\u00BD', '1/2'], [';', ',']],
    regeleindenInUitlegCsv: false, // regeleinden in Uitgebreide uitleg in de CSV laten staan (test eerst in Magister)
    // lijsten zoals ze in Magister bestaan (onbekende waarde = vraag of afbreken bij import)
    kolomkoppen: ['ST', 'PO', 'MT', 'VT', 'KLV', 'inzet', 'regie', 'start'],
    // de toetsingsvormen en typen zoals ze in Magister zelf bestaan; hier uit te breiden als Magister
    // een nieuwe waarde krijgt, met per toetsingsvorm de kolomkop die eruit volgt
    magToetsvormen: ['Schriftelijke Toets', 'Praktische Toets', 'Mondelinge Toets', 'Voortgangstoets'],
    magTypes: ['Schoolexamen', 'Voortgangstoets'],
    kolomkopVan: { 'Schriftelijke Toets': 'ST', 'Praktische Toets': 'PO', 'Mondelinge Toets': 'MT', 'Voortgangstoets': 'VT' },
    cijferteksten: ['OBVG', 'OVG tabel', 'O/M/V/R', 'O,M,V,RV,G'],
    vakcodes: [],                 // optioneel: bekende vakcodes per studie ('HAVO4|biol'); leeg = niet controleren
    studies: [
      { code: 'HAVO4', locatie: 'P-HV', examenjaar: false, actief: true, vmboFilter: false, deadline: '' },
      { code: 'HAVO5', locatie: 'P-HV', examenjaar: true, actief: true, vmboFilter: false, deadline: '' },
      { code: 'VWO4', locatie: 'P-HV', examenjaar: false, actief: true, vmboFilter: false, deadline: '' },
      { code: 'VWO5', locatie: 'P-HV', examenjaar: false, actief: true, vmboFilter: false, deadline: '' },
      { code: 'VWO6', locatie: 'P-HV', examenjaar: true, actief: true, vmboFilter: false, deadline: '' },
      { code: 'BB3', locatie: '', examenjaar: false, actief: true, vmboFilter: true, deadline: '' },
      { code: 'BB4', locatie: '', examenjaar: false, actief: true, vmboFilter: true, deadline: '' },
      { code: 'KB3', locatie: '', examenjaar: false, actief: true, vmboFilter: true, deadline: '' },
      { code: 'KB4', locatie: '', examenjaar: false, actief: true, vmboFilter: true, deadline: '' },
      { code: 'TL3', locatie: 'P-TL', examenjaar: false, actief: true, vmboFilter: true, deadline: '' },
      { code: 'TL4', locatie: 'P-TL', examenjaar: false, actief: true, vmboFilter: true, deadline: '' },
    ],
    // ruwe waarde (kleine letters) -> Magister-toetsingsvorm
    mapToetsvorm: {
      'schriftelijke toets': 'Schriftelijke Toets', 'schriftelijk': 'Schriftelijke Toets', 'st': 'Schriftelijke Toets', 'toets': 'Schriftelijke Toets',
      'schrijftelijke toets': 'Schriftelijke Toets', 'kennistoets': 'Schriftelijke Toets', 'leestoets': 'Schriftelijke Toets', 'schrijftoets': 'Schriftelijke Toets',
      'kijk-en luistertoets': 'Schriftelijke Toets', 'kijk- en luistertoets': 'Schriftelijke Toets', 'digitale toets': 'Schriftelijke Toets', 'digitaal': 'Schriftelijke Toets',
      'schriftelijke / praktische toets': 'Schriftelijke Toets', 'schriftelijke toets*****': 'Schriftelijke Toets',
      'praktische toets': 'Praktische Toets', 'praktisch': 'Praktische Toets', 'practische opdracht': 'Praktische Toets', 'praktische opdracht': 'Praktische Toets',
      'po': 'Praktische Toets', 'opdracht': 'Praktische Toets', 'opdracht en/of presentatie': 'Praktische Toets', 'praktische opdracht ****': 'Praktische Toets', 'praktische opdracht****': 'Praktische Toets',
      'mondelinge toets': 'Mondelinge Toets', 'mondeling': 'Mondelinge Toets', 'mondeing': 'Mondelinge Toets', 'mt': 'Mondelinge Toets', 'mo': 'Mondelinge Toets', 'presentatie': 'Mondelinge Toets',
      'voortgangstoets': 'Voortgangstoets', 'vt': 'Voortgangstoets',
      // let op: 'klv' staat hier bewust NIET. KLV is een Code (kolomkop), geen toetsingsvorm;
      // welke toetsingsvorm erbij hoort (meestal Mondelinge Toets) bevestig je per vak in Cijferkolommen.
    },
    // ruwe waarde uit de Excel -> vaste Code (CSV-kolom Kolomkop), ongeacht de toetsingsvorm
    codeVanRuw: { 'klv': 'KLV' },
    // ruwe waarde -> Magister-type toets
    mapTypeToets: {
      'schoolexamen': 'Schoolexamen', 'se': 'Schoolexamen', 'schriftelijk': 'Schoolexamen', 'praktisch': 'Schoolexamen', 'mondeling': 'Schoolexamen',
      'po': 'Schoolexamen', 'mo': 'Schoolexamen', 'mt': 'Schoolexamen', 'klv': 'Schoolexamen', 'digitaal (woots)': 'Schoolexamen', 'digitaal': 'Schoolexamen',
      'voortgangstoets': 'Voortgangstoets', 'vt': 'Voortgangstoets',
      'toets': 'auto', 'opdracht': 'auto', 'presentatie': 'auto',
    },
    // ruwe waarde -> { naar: nette schrijfwijze voor Magister/boekje, periode: P1..AFSE of '' voor het toetsrooster }
    mapAfname: {},
  };
}

function leegProject() {
  return {
    versie: 3,
    naam: 'PTA',
    aangemaakt: new Date().toISOString(),
    instellingen: standaardInstellingen(),
    rijen: [],          // zie nieuweRij()
    vakken: {},         // key STUDIE|vak -> { inleiding, notitie, methode, contact, gebeurtenissen: [{t, soort, info}], uitgezetOp, ontvangenOp }
    archief: [],        // afgesloten schooljaren (v3, stap 5)
    ckolx: [],          // [{id, idckol, idsvak, studie, vak, kolomnr}] uit query 2
    ckolxInfo: null,    // { t, schooljaar, aantal } — wanneer query 2 voor het laatst is ingelezen
    nummerTeller: {},   // prefix -> hoogste uitgegeven volgnummer (nummers worden nooit hergebruikt)
    exports: [],        // [{t, label, aantal, studies, ids, bevestigdOp}] — downloads voor Magister
    magVervallen: [],   // regels die in Magister staan maar uit het project zijn verdwenen
    studieInleiding: {}, // STUDIE -> { tekst, bron, datum }
    vaknamen: {},       // vakcode -> volledige naam
    checklist: {},      // fase 6 vinkjes
    versies: {},        // 'HAVO4|ptd' -> { reeks: [{v, t, datum, door, tekst, telling, mutaties, stempel?}] }
    mutaties: [],       // [{t, wie, soort, studie, vak, id, veld, van, naar, bron}] — het mutatielogboek
    rapportages: [],    // [{t, wie, studie, soort, versie, proef, bestand, paginas, vakken, toetsen}]
    log: [],
  };
}

// ---------- versiebeheer per studie en soort (e-PTA / e-PTD apart) ----------
// Velden die het CIJFER raken: die dwingen een hoofdnummer af (1.1 -> 2.0).
const MUT_ZWAAR = ['pta', 'periode', 'wfac', 'wse', 'herk'];
const MUT_SOORT_ZWAAR = ['toegevoegd', 'vervallen'];
function versieSleutel(studie, soort) { return `${studie}|${soort}`; }
function versieReeks(project, studie, soort) {
  project.versies = project.versies || {};
  const k = versieSleutel(studie, soort);
  return project.versies[k] || (project.versies[k] = { reeks: [] });
}
function huidigeVersie(project, studie, soort) { const r = versieReeks(project, studie, soort).reeks; return r.length ? r[r.length - 1] : null; }
// alle mutaties van deze studie sinds de laatste vastgestelde versie
function mutatiesSinds(project, studie, soort) {
  const h = huidigeVersie(project, studie, soort);
  const vanaf = h ? h.t : '';
  return (project.mutaties || []).filter(m => (!vanaf || m.t > vanaf) && (!m.studie || m.studie === studie) && m.telt !== false);
}
function volgendeVersie(huidig, zwaar) {
  const m = String(huidig || '1.0').match(/^(\d+)\.(\d+)/);
  if (!m) return zwaar ? '2.0' : '1.1';
  const hoofd = +m[1], sub = +m[2];
  return zwaar ? `${hoofd + 1}.0` : `${hoofd}.${sub + 1}`;
}
// Wat stelt het dashboard voor? Geeft ook de telling per soort wijziging terug voor het scherm.
function versieVoorstel(project, studie, soort) {
  const h = huidigeVersie(project, studie, soort);
  const muts = mutatiesSinds(project, studie, soort);
  const telling = { toegevoegd: 0, vervallen: 0, weging: 0, tekst: 0, afname: 0, vakinleiding: 0, overig: 0 };
  let zwaar = false;
  for (const m of muts) {
    if (MUT_SOORT_ZWAAR.includes(m.soort)) { telling[m.soort]++; zwaar = true; continue; }
    if (m.soort === 'vakinleiding') { telling.vakinleiding++; continue; }
    if (m.veld && MUT_ZWAAR.includes(m.veld)) { telling.weging++; zwaar = true; continue; }
    if (m.veld === 'afname') { telling.afname++; continue; }
    if (m.veld) { telling.tekst++; continue; }
    telling.overig++;
  }
  const eerste = !h;
  return {
    eerste, huidig: h ? h.v : '', aantal: muts.length, telling, zwaar,
    klein: eerste ? '1.0' : volgendeVersie(h.v, false),
    groot: eerste ? '1.0' : volgendeVersie(h.v, true),
    advies: eerste ? '1.0' : volgendeVersie(h.v, zwaar),
  };
}
// Korte omschrijving van wat er veranderde, als voorzet voor het wijzigingsoverzicht.
function versieTekstVoorstel(project, studie, soort) {
  const vs = versieVoorstel(project, studie, soort);
  if (vs.eerste) return 'eerste vaststelling';
  const t = vs.telling, d = [];
  if (t.toegevoegd) d.push(`${t.toegevoegd} ${t.toegevoegd === 1 ? 'toets' : 'toetsen'} toegevoegd`);
  if (t.vervallen) d.push(`${t.vervallen} ${t.vervallen === 1 ? 'toets' : 'toetsen'} vervallen`);
  if (t.weging) d.push(`${t.weging}× weging/periode aangepast`);
  if (t.tekst) d.push(`${t.tekst} tekstwijziging${t.tekst === 1 ? '' : 'en'}`);
  if (t.afname) d.push(`${t.afname}× afnamemoment`);
  if (t.vakinleiding) d.push(`${t.vakinleiding} vakinleiding${t.vakinleiding === 1 ? '' : 'en'}`);
  const vakken = [...new Set(mutatiesSinds(project, studie, soort).map(m => m.vak).filter(Boolean))].sort();
  return (vakken.length && vakken.length <= 6 ? vakken.join(', ') + ': ' : '') + (d.join('; ') || 'geen inhoudelijke wijzigingen');
}
// Alleen van versie 1.0 bewaren we een exacte momentopname; latere versies zijn met de mutaties te herleiden.
function versieStempel(project, studie, soort, rijen) {
  return {
    rijen: rijen.map(r => ({ id: r.id, vak: r.vak, periode: r.periode, pta: r.pta, oms: r.omschrijving, wfac: r.wfac, wse: r.wse, herk: r.herk, tv: r.toetsvorm, tt: r.typeToets, kop: r.kolomkop, afn: r.afname })),
    vakken: [...new Set(rijen.map(r => r.vak))].sort(),
  };
}
function legVersieVast(project, studie, soort, o) {
  const reeks = versieReeks(project, studie, soort).reeks;
  const vs = versieVoorstel(project, studie, soort);
  const rec = {
    v: o.versie, t: new Date().toISOString(), datum: o.datum || new Date().toISOString().slice(0, 10),
    door: o.wie || '', tekst: o.tekst || '', telling: vs.telling, mutaties: vs.aantal,
  };
  if (!reeks.length && o.rijen) rec.stempel = versieStempel(project, studie, soort, o.rijen);  // alleen 1.0
  reeks.push(rec);
  return rec;
}
function versieTekst(project, studie, soort) {
  const h = huidigeVersie(project, studie, soort); if (!h) return '';
  const opm = (project.instellingen.rapport || {}).versieOpmaak || 'lang';
  const d = new Date(h.datum + 'T12:00:00');
  const dl = isNaN(d) ? h.datum : d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  if (opm === 'kort') return `v${h.v}`;
  if (opm === 'haakjes') return `Versie ${h.v} (${h.datum.split('-').reverse().join('-')})`;
  return `versie ${h.v} · vastgesteld ${dl}`;
}

// ---------- mutatielogboek ----------
const MUT_MAX = 4000;
function logMutatie(project, o) {
  project.mutaties = project.mutaties || [];
  const m = Object.assign({ t: new Date().toISOString() }, o);
  for (const k of ['van', 'naar']) if (typeof m[k] === 'string' && m[k].length > 90) m[k] = `${m[k].slice(0, 60)}… (${m[k].length} tekens)`;
  project.mutaties.push(m);
  if (project.mutaties.length > MUT_MAX) project.mutaties.splice(0, project.mutaties.length - MUT_MAX);
  return m;
}
function logMutaties(project, lijst) { for (const o of lijst) logMutatie(project, o); }
const MUT_LABEL = { gewijzigd: 'gewijzigd', toegevoegd: 'toegevoegd', vervallen: 'vervallen', vakinleiding: 'vakinleiding', instelling: 'instelling', bestand: 'bestand', correctie: 'correctie' };
function mutatieSoortVanVeld(veld) { return MUT_ZWAAR.includes(veld) ? 'weging' : veld === 'afname' ? 'afname' : veld === 'kolomkop' || veld === 'toetsvorm' || veld === 'typeToets' ? 'magister' : 'tekst'; }

const RIJVELDEN = ['id', 'studie', 'vak', 'periode', 'pta', 'omschrijving', 'wfac', 'wse', 'herk', 'tijdsduur', 'afname', 'eindtermen', 'hulpmiddelen', 'typeToets', 'toetsvorm', 'uitleg', 'cijfertekst', 'decimalen', 'minc', 'maxc', 'examenstofSE', 'kolomnr', 'kolomkop'];
const VELD_LABEL = { id: 'ID', studie: 'Studie', vak: 'Vak', periode: 'Periode', pta: 'PTA', omschrijving: 'Omschrijving', wfac: 'Weging jaar', wse: 'Weging SE', herk: 'Herkansing', tijdsduur: 'Tijdsduur', afname: 'Afnamemoment', eindtermen: 'Eindtermen SE', hulpmiddelen: 'Hulpmiddelen', typeToets: 'Type', toetsvorm: 'Toetsingsvorm', uitleg: 'Uitgebreide uitleg', cijfertekst: 'Cijfertekst', decimalen: 'Decimalen', minc: 'Min. cijfer', maxc: 'Max. cijfer', examenstofSE: 'Examenstof SE', kolomnr: 'Kolomnummer (vast)', kolomkop: 'Code (kolomkop)' };

function nieuweRij(o = {}) {
  return Object.assign({
    id: '', studie: '', vak: '', periode: 'P1', pta: false, omschrijving: '', wfac: '', wse: '', herk: false,
    tijdsduur: '', afname: '', eindtermen: '', hulpmiddelen: '', typeToets: '', toetsvorm: '', uitleg: '',
    cijfertekst: '', decimalen: '', minc: '', maxc: '', examenstofSE: false, kolomnr: '', kolomkop: '', volgorde: 0, bron: 'decibel',
  }, o);
}

// ---------- kopherkenning ----------
const HEADER_ALIASES = {
  id: ['id', 'id (niet wijzigen)', 'nummer', 'nummers', 'eindtermence', 'eindtermen ce', 'uniek nummer', 'ptaid'],
  vervallen: ['vervallen', 'vervallen?', 'vervalt', 'verwijderen'],
  studie: ['studie', 'studiecode'],
  vak: ['vakcode', 'vak', 'c_vak', 'cvak'],
  periode: ['cijferperiode', 'periode', 'c_periode', 'cperiode'],
  pta: ['pta', 'pta?', 'pto/pta', 'ptopta', 'bex_kolom', 'bexkolom', 'pta (ja/nee)', 'pta ja/nee'],
  uitleg: ['uitgebreide_uitleg', 'uitgebreide uitleg', 'uitgebreideuitleg', 'rveld2', 'uitleg', 'wat moet de leerling leren / kunnen / weten', 'leerstof/inhoud', 'leerstof / inhoud'],
  omschrijving: ['korte_omschrijving_magister', 'korte omschrijving magister', 'omschrijving', 'omschr', 'korte omschrijving', 'korte omschrijving (zo komt het in magister)'],
  wfac: ['weegfactor_niet_examenjaar', 'weegfactor niet examenjaar', 'weegfactor', 'weging jaar', 'wegingjaar', 'init_wfac', 'weging jaarplanner', 'weging (jaar)', 'weging jaarcijfer'],
  wse: ['weging_examenjaar', 'weging examenjaar', 'weging se', 'wegingse', 'se weging', 'se-weging', 'iveld2', 'weging (se)', 'weging se (%)'],
  herk: ['herkansing', 'soort herkansing', 'bherkansing', 'herkansing (ja/nee)', 'herkansing ja/nee', 'herkansbaar', 'herkansbaar?'],
  tijdsduur: ['tijdsduur', 'duur'],
  afname: ['afnamemoment', 'afname moment', 'afname'],
  eindtermen: ['eindtermen_se', 'eindtermen se', 'eindtermense', 'eindtermen', 'eindtermen / domein', 'eindterm/domein'],
  hulpmiddelen: ['hulpmiddelen', 'rveld1'],
  typeToets: ['type_toets', 'type toets', 'typetoets', 'soort toets', 'soort'],
  toetsvorm: ['toetsingsvorm', 'toetsvorm', 'toetsvorm *'],
  cijfertekst: ['cijfertekst'],
  decimalen: ['aantal decimalen', 'decimalen'],
  minc: ['minimum cijfer', 'min cijfer', 'min. cijfer'],
  maxc: ['maximum cijfer', 'max cijfer', 'max. cijfer'],
  examenstofSE: ['examenstof se'],
  kolomnr: ['kolomnummer', 'kol_nr', 'kolnr'],
  kolomkop: ['kolomkop', 'code', 'code (kolomkop)', 'afkorting'],
};
function normKop(s) { return String(s ?? '').toLowerCase().replace(/\uFEFF/g, '').replace(/\(niet voor dit leerjaar\)/g, '').trim().replace(/\s+/g, ' '); }
function herkenKoppen(headerRow) {
  const map = {}; // veld -> kolomindex
  const gebruikt = new Set();
  const koppen = headerRow.map(normKop);
  // Bouwer-/Totaal_voor_import-indeling: 'Uitgebreide uitleg' bevat het nummer en 'Uitgebreide_uitleg' de tekst
  const bouwer = koppen.includes('uitgebreide uitleg') && koppen.includes('uitgebreide_uitleg');
  koppen.forEach((k, i) => {
    if (!k) return;
    if (bouwer && k === 'uitgebreide uitleg') { if (map.id === undefined) map.id = i; return; }
    if (bouwer && k === 'eindtermen ce') return; // afgeleide kolom, niet de bron
    for (const [veld, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[veld] !== undefined) continue;
      if (aliases.includes(k)) { map[veld] = i; gebruikt.add(i); break; }
    }
  });
  return map;
}

// ---------- normalisatie ----------
function normStudie(s) { return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function normVak(s) { return String(s ?? '').trim().toLowerCase(); }
function normPeriode(s) {
  const t = String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!t) return '';
  if (/^[0-4]$/.test(t)) return 'P' + t;
  if (/^P[0-4]$/.test(t)) return t;
  if (t === 'AFSE' || t === 'SE') return 'AFSE';
  return t; // ongeldig, wordt door validatie gemeld
}
function normBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const t = String(v ?? '').trim().toLowerCase();
  return ['1', 'true', 'waar', 'ja', 'j', 'yes', 'x', 'h'].includes(t);
}
function normGetal(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v;
  const t = String(v).trim().replace(',', '.');
  if (t === '') return '';
  const n = Number(t);
  return isNaN(n) ? String(v).trim() : n;
}
function normTekst(v) { return v === null || v === undefined ? '' : String(v).replace(/\r\n?/g, '\n').trim(); }

function rijenUitTabel(rows, opties = {}) {
  // rows: array van arrays, eerste niet-lege rij = kopregel
  const start = rows.findIndex(r => r && r.some(x => x !== null && x !== undefined && String(x).trim() !== ''));
  if (start < 0) return { rijen: [], koppen: {}, fouten: ['Geen gegevens gevonden'] };
  const koppen = Object.assign({}, herkenKoppen(rows[start]), opties.kolommen || {});
  for (const k of Object.keys(koppen)) if (koppen[k] === -1 || koppen[k] === undefined || koppen[k] === null) delete koppen[k];
  const fouten = [];
  const verplicht = opties.verplicht || ['studie', 'vak', 'periode', 'omschrijving'];
  for (const v of verplicht) if (koppen[v] === undefined) fouten.push(`Kolom '${VELD_LABEL[v]}' niet gevonden in de kopregel`);
  if (fouten.length) return { rijen: [], koppen, fouten };
  const rijen = [];
  for (let i = start + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const g = (veld) => koppen[veld] === undefined ? undefined : r[koppen[veld]];
    const leeg = RIJVELDEN.every(v => { const x = g(v); return x === undefined || x === null || String(x).trim() === ''; });
    if (leeg) continue;
    const rij = nieuweRij({
      id: normTekst(g('id')),
      studie: opties.studie || normStudie(g('studie')),
      vak: opties.vak || normVak(g('vak')),
      periode: normPeriode(g('periode')),
      pta: normBool(g('pta')),
      omschrijving: normTekst(g('omschrijving')),
      wfac: normGetal(g('wfac')),
      wse: normGetal(g('wse')),
      herk: normBool(g('herk')),
      tijdsduur: normTekst(g('tijdsduur')),
      afname: normTekst(g('afname')),
      eindtermen: normTekst(g('eindtermen')),
      hulpmiddelen: normTekst(g('hulpmiddelen')),
      typeToets: normTekst(g('typeToets')),
      toetsvorm: normTekst(g('toetsvorm')),
      uitleg: normTekst(g('uitleg')),
      cijfertekst: normTekst(g('cijfertekst')),
      decimalen: normGetal(g('decimalen')),
      minc: normGetal(g('minc')),
      maxc: normGetal(g('maxc')),
      examenstofSE: normBool(g('examenstofSE')),
      kolomnr: opties.kolomnummersVast ? String(g('kolomnr') ?? '').trim().replace(/\.0$/, '') : '',
      kolomkop: normTekst(g('kolomkop')),
      vervallen: koppen.vervallen !== undefined ? normBool(g('vervallen')) : false,
      volgorde: i,
      bron: opties.bron || 'decibel',
    });
    rijen.push(rij);
  }
  return { rijen, koppen, fouten };
}

// ---------- kolomtoewijzing bij een oud verzamelbestand ----------
// De oude Totaal.xlsx heeft misleidende kopteksten: de kolom 'Type_toets' bevat Schriftelijk/Praktisch
// (dat is in Magister de TOETSINGSVORM) en 'Toetsingsvorm' bevat Toets/Opdracht (dat is het TYPE).
// Daarom kijken we niet naar de kop maar naar de waarden eronder, en laten we de gebruiker bevestigen.
const TOEWIJSBAAR = ['studie', 'vak', 'periode', 'pta', 'omschrijving', 'uitleg', 'wfac', 'wse', 'herk', 'tijdsduur', 'afname', 'eindtermen', 'hulpmiddelen', 'toetsvorm', 'typeToets', 'kolomkop', 'cijfertekst', 'id', 'kolomnr', 'vervallen'];
function kolomWaarden(rows, start, index, max = 400) {
  const tel = {};
  for (let i = start + 1; i < Math.min(rows.length, start + 1 + max); i++) {
    const v = String(((rows[i] || [])[index]) ?? '').trim(); if (!v) continue;
    tel[v] = (tel[v] || 0) + 1;
  }
  return Object.entries(tel).sort((a, b) => b[1] - a[1]);
}
// Hoe goed passen de waarden van deze kolom bij een toetsingsvorm of bij een type?
// We vergelijken met de woordenschat die we kennen: de keuzelijst Toetsingsvorm en de Magister-toetsingsvormen
// tegenover de keuzelijst Type en de Magister-typen. Een woord dat in beide lijsten staat telt half.
function kolomSoort(project, waarden) {
  const i = project.instellingen;
  const norm = (x) => String(x).trim().toLowerCase().replace(/\s+/g, ' ');
  const vormWoorden = new Set([...(i.keuzelijsten.toetsvorm || []), ...magVormen(project)].map(norm));
  const typeWoorden = new Set([...(i.keuzelijsten.soort || []), ...magTypen(project)].map(norm));
  let vorm = 0, type = 0, tot = 0;
  for (const [w, n] of waarden) {
    tot += n;
    const t = norm(w);
    const isVorm = vormWoorden.has(t), isType = typeWoorden.has(t);
    if (isVorm && isType) { vorm += n / 2; type += n / 2; }
    else if (isVorm) vorm += n;
    else if (isType) type += n;
  }
  if (!tot) return { vorm: 0, type: 0 };
  return { vorm: vorm / tot, type: type / tot };
}
// zoek de kopregel: de rij in de eerste 12 regels die de meeste velden oplevert
function vindKopregel(rows) {
  let beste = -1, score = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const r = rows[i]; if (!r || !r.some(x => x !== null && x !== undefined && String(x).trim() !== '')) continue;
    const k = herkenKoppen(r);
    let n = Object.keys(k).length;
    // een echte kopregel heeft de sleutelvelden
    if (k.periode !== undefined) n += 3;
    if (k.omschrijving !== undefined) n += 2;
    if (n > score) { score = n; beste = i; }
  }
  return beste;
}
function analyseerKoppen(project, rows) {
  const start = vindKopregel(rows);
  if (start < 0) return null;
  const kopRij = (rows[start] || []).map(x => String(x ?? '').trim());
  const koppen = herkenKoppen(rows[start]);
  const waarden = {}; kopRij.forEach((_, i) => { waarden[i] = kolomWaarden(rows, start, i); });
  // voorstel = wat de koppen zeggen, gecorrigeerd met wat de waarden laten zien
  const voorstel = Object.assign({}, koppen);
  const opmerkingen = [];
  const kv = koppen.toetsvorm, kt = koppen.typeToets;
  if (kv !== undefined && kt !== undefined) {
    const sv = kolomSoort(project, waarden[kv]), st = kolomSoort(project, waarden[kt]);
    // zeggen de waarden dat de twee kolommen verwisseld zijn?
    if (st.vorm > st.type + 0.3 && sv.type > sv.vorm + 0.3) {
      voorstel.toetsvorm = kt; voorstel.typeToets = kv;
      opmerkingen.push(`De kolom '${kopRij[kt]}' bevat waarden als ${waarden[kt].slice(0, 3).map(x => `'${x[0]}'`).join(', ')} — dat is in Magister de Toetsingsvorm. De kolom '${kopRij[kv]}' bevat ${waarden[kv].slice(0, 3).map(x => `'${x[0]}'`).join(', ')} — dat is het Type. Voorstel: deze twee omwisselen.`);
    }
  } else if (kv !== undefined && kt === undefined) {
    const sv = kolomSoort(project, waarden[kv]);
    if (sv.type > sv.vorm + 0.3) { voorstel.typeToets = kv; delete voorstel.toetsvorm; opmerkingen.push(`De kolom '${kopRij[kv]}' bevat waarden die bij het Type horen, niet bij de Toetsingsvorm.`); }
  }
  return { start, kopRij, koppen, voorstel, waarden, opmerkingen };
}

// Losse regels waar Toetsingsvorm en Type verwisseld staan. Dat komt voor als in de oude Totaal.xlsx
// niet de hele kolom maar een deel van de regels omgedraaid is ingevuld.
function omgedraaideRijen(project, rijen) {
  const i = project.instellingen;
  const norm = (x) => String(x ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const vormWoorden = new Set([...(i.keuzelijsten.toetsvorm || []), ...magVormen(project)].map(norm));
  const typeWoorden = new Set([...(i.keuzelijsten.soort || []), ...magTypen(project)].map(norm));
  // een waarde telt als vorm/type als hij in de keuzelijst staat óf als de vertaaltabel hem zo kent
  const isVorm = (x) => { if (vormWoorden.has(x)) return true; const m = mapToetsvorm(project, x); return !!(m.bekend && !m.leeg); };
  const isType = (x) => { if (typeWoorden.has(x)) return true; const m = i.mapTypeToets[x]; return m !== undefined && m !== TYPE_AUTO; };
  return (rijen || project.rijen).filter(r => {
    const v = norm(r.toetsvorm), t = norm(r.typeToets);
    if (!v) return false;
    // toetsingsvorm is uitsluitend een type-waarde; type is leeg of uitsluitend een vorm-waarde
    if (!(isType(v) && !isVorm(v))) return false;
    return !t || (isVorm(t) && !isType(t));
  });
}
function draaiOm(rijen) { let n = 0; for (const r of rijen) { const x = r.toetsvorm; r.toetsvorm = r.typeToets; r.typeToets = x; n++; } return n; }

// ---------- nummers ----------
// Hoogste tot nu toe uitgegeven volgnummer van dit prefix. Kijkt niet alleen naar de huidige regels maar ook
// naar de teller in het project, de koppelingen uit query 2 en de historie, zodat een nummer van een verwijderde
// regel NOOIT opnieuw wordt uitgegeven (dat zou de koppeling in sis_ckolx naar de verkeerde kolom laten wijzen).
function nummerTellerStand(project) {
  const pre = project.instellingen.nummerPrefix;
  let max = ((project.nummerTeller || {})[pre]) || 0;
  const kijk = (s) => { const m = String(s || '').match(/^(.+)\/(\d+)$/); if (m && m[1] === pre) max = Math.max(max, +m[2]); };
  for (const r of project.rijen) kijk(r.id);
  for (const x of (project.ckolx || [])) kijk(x.id);
  for (const x of (project.magVervallen || [])) kijk(x.id);
  return max;
}
function volgendNummer(project) {
  const pre = project.instellingen.nummerPrefix;
  let n = nummerTellerStand(project) + 2; if (n % 2) n++;
  project.nummerTeller = project.nummerTeller || {};
  project.nummerTeller[pre] = n;
  return `${pre}/${String(n).padStart(4, '0')}`;
}
function kenNummersToe(project) {
  let teller = 0;
  for (const r of project.rijen) if (!r.id) { r.id = volgendNummer(project); teller++; }
  return teller;
}


// Tussenjaar: in de bron-lesperiode stond bij examenjaren de SE-weging nog in de Magister-weegfactor (iveld2 leeg).
// Zet voor examenjaar-studies Weging jaar over naar Weging SE. Geeft het aantal omgezette regels.
function conversieExamenWegingen(project, rijen) {
  let n = 0;
  for (const r of (rijen || project.rijen)) {
    const st = studieInfo(project, r.studie);
    if (!st || !st.examenjaar) continue;
    if ((r.wse === '' || r.wse === 0 || r.wse === null) && typeof r.wfac === 'number' && r.wfac !== 0) { r.wse = r.wfac; r.wfac = ''; n++; }
  }
  return n;
}
function telExamenWegingenInJaar(project, rijen) {
  let n = 0;
  for (const r of rijen) { const st = studieInfo(project, r.studie); if (st && st.examenjaar && (r.wse === '' || r.wse === 0) && typeof r.wfac === 'number' && r.wfac !== 0) n++; }
  return n;
}

// ---------- sorteren en kolomnummers ----------
function vakKey(r) { return `${r.studie}|${r.vak}`; }
/* v3.48 — vakken op VOLLEDIGE NAAM sorteren in plaats van op vakcode.
   Op code komt 'lo' vóór 'ltc', terwijl Latijnse taal en cultuur vóór Lichamelijke opvoeding hoort.
   Staat er geen volledige naam bij een code, dan telt de code zelf mee, zodat zo'n vak niet
   plotseling bovenaan of onderaan belandt. Via Project > Vaknamen om te zetten naar sorteren op code.
   Let op: dit verandert alleen de VOLGORDE waarin vakken verschijnen. Kolomnummers worden per
   vak en periode geteld, dus die blijven hetzelfde. */
const vakCollator = new Intl.Collator('nl', { sensitivity: 'base', numeric: true });
function vakSorteerSleutel(vak) {
  if (typeof project === 'object' && project && project.instellingen && project.instellingen.vakSortering === 'code') return String(vak || '');
  const n = (typeof vakNaam === 'function') ? vakNaam(vak) : null;
  return String(n || vak || '');
}
// vergelijkt twee VAKCODES; de tweede sleutel houdt vakken met dezelfde naam uit elkaar
function vakCompare(a, b) {
  return vakCollator.compare(vakSorteerSleutel(a), vakSorteerSleutel(b)) || vakCollator.compare(String(a || ''), String(b || ''));
}
function sorteerRijen(rijen, modus) {
  const per = (r) => (PERIODE_ORDER[r.periode] ?? 9);
  if (modus === 'periode') return [...rijen].sort((a, b) => a.studie.localeCompare(b.studie) || (per(a) - per(b)) || vakCompare(a.vak, b.vak) || (a.volgorde - b.volgorde));
  return [...rijen].sort((a, b) => a.studie.localeCompare(b.studie) || vakCompare(a.vak, b.vak) || (per(a) - per(b)) || (a.volgorde - b.volgorde));
}
function berekenKolomnummers(project) {
  // geeft Map rij -> kolomnummer; vaste nummers blijven, nieuwe regels krijgen het eerste VRIJE volgnummer
  // binnen hun vak/periode (dus nooit een nummer dat al door een vaste regel bezet is)
  const inst = project.instellingen;
  const map = new Map();
  const bezet = {};   // vak -> Set met nummers die al vergeven zijn
  const tellers = {};
  for (const r of project.rijen) if (r.kolomnr) (bezet[vakKey(r)] = bezet[vakKey(r)] || new Set()).add(String(r.kolomnr).trim());
  for (const r of sorteerRijen(project.rijen)) {
    if (r.kolomnr) { map.set(r, String(r.kolomnr).trim()); continue; }
    const key = `${r.studie}|${r.vak}|${r.periode}`;
    const lj = parseInt(r.studie.slice(-1), 10);
    let nr = '';
    if (!isNaN(lj)) {
      const pre = inst.kolomnummerMetLeerjaar ? String(lj) : '';
      const prePrev = inst.kolomnummerMetLeerjaar ? String(lj - 1) : '';
      const stam = /^P[1234]$/.test(r.periode) ? pre + r.periode[1] : r.periode === 'P0' ? prePrev + '1' : r.periode === 'AFSE' ? pre + '9' : null;
      if (stam !== null) {
        const set = bezet[vakKey(r)] = bezet[vakKey(r)] || new Set();
        let n = (tellers[key] || 0) + 1;
        while (n < 100 && set.has(stam + String(n).padStart(2, '0'))) n++;
        tellers[key] = n;
        nr = stam + String(n).padStart(2, '0');
        set.add(nr);
      }
    }
    map.set(r, nr);
  }
  return map;
}

// ---------- volgorde van de cijferkolommen binnen een periode ----------
// De regels van één studie/vak/periode in een nieuwe volgorde zetten. Met wisselNummers worden de kolomnummers
// van die groep opnieuw over de regels verdeeld (dezelfde nummers, andere toets); regels met een slotje (nrVast)
// houden hun eigen nummer. Het unieke nummer (prefix/0008) blijft ALTIJD aan dezelfde toets zitten.
function volgordeGroep(project, studie, vak, periode) {
  return sorteerRijen(project.rijen.filter(r => r.studie === studie && r.vak === vak && r.periode === periode));
}
function volgordeVoorbeeld(project, rijen, wisselNummers) {
  // rijen = de gewenste nieuwe volgorde; geeft per rij het huidige en het nieuwe kolomnummer
  const nrs = berekenKolomnummers(project);
  const huidig = rijen.map(r => nrs.get(r) || '');
  const pool = rijen.filter(r => !r.nrVast).map(r => nrs.get(r) || '').filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  let i = 0;
  return rijen.map((r, n) => {
    const nu = huidig[n];
    let nieuw = nu;
    if (wisselNummers && !r.nrVast) nieuw = pool[i++] !== undefined ? pool[i - 1] : nu;
    return { rij: r, nu, nieuw, anders: !!nu && String(nu) !== String(nieuw) };
  });
}
function pasVolgordeToe(project, rijen, wisselNummers) {
  const plan = volgordeVoorbeeld(project, rijen, wisselNummers);
  const basis = Math.min(...rijen.map(r => r.volgorde));
  rijen.forEach((r, i) => { r.volgorde = basis + i / 1000; });
  let gewisseld = 0;
  if (wisselNummers) for (const p of plan) { if (p.nieuw && String(p.nieuw) !== String(p.rij.kolomnr)) { p.rij.kolomnr = String(p.nieuw); } if (p.anders) gewisseld++; }
  return { gewisseld, plan };
}

// ---------- mappings ----------
function studieInfo(project, code) { return project.instellingen.studies.find(s => s.code === code); }
// vakken die per studie zijn uitgesloten (Studies & vakken → Uitgesloten vakken)
function vakUitgesloten(project, studie, vak) { const st = studieInfo(project, studie); return !!(st && Array.isArray(st.uitgesloten) && st.uitgesloten.includes(normVak(vak))); }
function filterUitgesloten(project, rijen) { const weg = {}; const rest = []; for (const r of rijen) { if (vakUitgesloten(project, r.studie, r.vak)) weg[vakKey(r)] = (weg[vakKey(r)] || 0) + 1; else rest.push(r); } return { rijen: rest, uitgesloten: weg }; }
// vakinleiding uit een Word-bestand: tekst onder de kop 'Vakinleiding', zonder instructieregels; leeg = null
function vakinleidingUitParas(paras) {
  let start = paras.findIndex(p => p.heading && /^vakinleiding$/i.test(p.text.trim()));
  const sel = start >= 0 ? paras.slice(start + 1) : paras.filter(p => !p.heading);
  const regels = [];
  for (const p of sel) {
    const t = p.text.replace(/\s+$/g, '').trim();
    if (!t) { regels.push(''); continue; }
    if (/^(instructie voor de vaksectie|schrijf hieronder|\[schrijf hier)/i.test(t)) continue;
    if (p.heading && start < 0) continue;
    regels.push(p.list ? `- ${t}` : t);
  }
  const tekst = regels.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return tekst ? tekst : null;
}
// afnamemoment: vrije tekst van de sectie -> nette schrijfwijze (+ periode voor het toetsrooster)
function afnameSleutel(s) { return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
function mapAfname(project, raw) {
  const t = afnameSleutel(raw);
  if (!t) return { waarde: '', bekend: true, leeg: true, periode: '' };
  const m = (project.instellingen.mapAfname || {})[t];
  if (m === undefined) return { waarde: String(raw).trim(), bekend: false, periode: '' };
  const naar = typeof m === 'string' ? m : (m.naar || '');
  return { waarde: naar || String(raw).trim(), bekend: true, periode: (typeof m === 'string' ? '' : m.periode) || '' };
}
// alle afnamemomenten die in het project voorkomen, met aantal, de cijferperioden waarin ze voorkomen,
// een voorstel voor de roosterperiode (dominante cijferperiode, of AUTO als het over meerdere perioden verdeeld is)
// en of ze in de vertaaltabel staan
const AFNAME_AUTO = 'auto';
function afnameWaarden(project) {
  const tel = {};
  for (const r of project.rijen) {
    const t = afnameSleutel(r.afname); if (!t) continue;
    const x = tel[t] = tel[t] || { sleutel: t, ruw: String(r.afname).trim(), n: 0, per: {} };
    x.n++; if (r.periode) x.per[r.periode] = (x.per[r.periode] || 0) + 1;
  }
  const map = project.instellingen.mapAfname || {};
  const uit = Object.values(tel);
  for (const k of Object.keys(map)) if (!tel[k]) uit.push({ sleutel: k, ruw: k, n: 0, per: {} });
  for (const x of uit) {
    x.bekend = map[x.sleutel] !== undefined;
    const paren = Object.entries(x.per).sort((a, b) => b[1] - a[1]);
    x.perLijst = paren;
    // één periode goed voor 80% of meer -> die periode; anders 'volgt de regel'
    x.voorstel = !paren.length ? '' : (paren[0][1] / x.n >= 0.8 ? paren[0][0] : AFNAME_AUTO);
  }
  return uit.sort((a, b) => b.n - a.n || a.sleutel.localeCompare(b.sleutel));
}
// de roosterperiode van één regel: 'auto' betekent de cijferperiode van de regel zelf
function afnamePeriode(project, r) {
  const m = mapAfname(project, r.afname);
  return m.periode === AFNAME_AUTO ? r.periode : (m.periode || '');
}
// hoeveel waarden van een mapping komen daadwerkelijk in het project voor
function mapGebruik(project, veld) {
  const tel = {};
  for (const r of project.rijen) {
    const raw = veld === 'toetsvorm' ? r.toetsvorm : veld === 'typeToets' ? r.typeToets : r.afname;
    const t = afnameSleutel(raw); if (!t) continue; tel[t] = (tel[t] || 0) + 1;
  }
  return tel;
}
function mapToetsvorm(project, raw) {
  const t = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return { waarde: 'Voortgangstoets', bekend: true, leeg: true };
  const vormen = magVormen(project);
  if (vormen.map(x => x.toLowerCase()).includes(t)) return { waarde: vormen.find(x => x.toLowerCase() === t), bekend: true };
  const m = project.instellingen.mapToetsvorm[t];
  return m ? { waarde: m, bekend: true } : { waarde: '', bekend: false };
}
function mapTypeToets(project, raw, pta) {
  const t = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return { waarde: pta ? 'Schoolexamen' : 'Voortgangstoets', bekend: true, leeg: true };
  const typen = magTypen(project);
  if (typen.map(x => x.toLowerCase()).includes(t)) return { waarde: typen.find(x => x.toLowerCase() === t), bekend: true };
  const m = project.instellingen.mapTypeToets[t];
  if (m === TYPE_AUTO) return { waarde: pta ? 'Schoolexamen' : 'Voortgangstoets', bekend: true, auto: true };
  return m ? { waarde: m, bekend: true } : { waarde: '', bekend: false };
}
// Type (Schoolexamen / Voortgangstoets) moet hetzelfde zeggen als de kolom PTA.
// Geeft de foutmelding terug, of '' als het klopt.
function typeConflict(project, r) {
  const tt = mapTypeToets(project, r.typeToets, r.pta);
  if (!tt.bekend || tt.auto || tt.leeg) return '';
  const hoort = r.pta ? 'Schoolexamen' : 'Voortgangstoets';
  if (tt.waarde === hoort) return '';
  return `Type '${tt.waarde}' hoort niet bij PTA=${r.pta ? 'Ja' : 'Nee'} (dat moet '${hoort}' zijn). Corrigeer het Type of de kolom PTA.`;
}
// alle regels met zo'n conflict, voor de knop 'Type gelijkzetten aan PTA'
function typeConflicten(project, rijen) {
  return (rijen || project.rijen).filter(r => !r.akkoord && typeConflict(project, r));
}
// zet het Type van deze regels op de waarde die bij PTA hoort
function zetTypeNaarPta(project, rijen) {
  let n = 0;
  for (const r of rijen) { const w = r.pta ? 'Schoolexamen' : 'Voortgangstoets'; if (r.typeToets !== w) { r.typeToets = w; n++; } }
  return n;
}

/* ---------- v3.44: Examenstof SE volgt de kolom PTA ----------
   Per studie aan te zetten (Studies & vakken > Eigenschappen, of in één keer bij Project > Algemeen).
   Staat hij aan, dan geldt voor die studie: PTA=Ja hoort het vinkje 'Examenstof SE' aan te hebben
   (waarschuwing als dat niet zo is) en PTA=Nee hoort het vinkje uit te hebben (fout — zo'n toets telt
   in Magister mee als examenstof terwijl hij niet in het PTA staat). Er wordt niets automatisch
   omgezet; dat doet de knop 'Examenstof SE gelijkzetten aan PTA' bij Verwerken > Controleren. */
function seStofVolgtPta(project, studie) {
  const st = studieInfo(project, studie);
  return !!(st && st.seStofVolgtPta);
}
// '' = klopt of niet bewaakt; anders {soort:'fout'|'waarschuwing', tekst}
function seStofConflict(project, r) {
  if (!seStofVolgtPta(project, r.studie)) return null;
  if (r.pta && !r.examenstofSE) return { soort: 'waarschuwing', tekst: "PTA=Ja maar 'Examenstof SE' staat uit (deze studie heeft 'Examenstof SE volgt PTA' aan)" };
  if (!r.pta && r.examenstofSE) return { soort: 'fout', tekst: "PTA=Nee maar 'Examenstof SE' staat aan — deze toets telt in Magister dan mee als examenstof terwijl hij niet in het PTA staat" };
  return null;
}
// alle toetsen met zo'n conflict, voor de knop bij Controleren
function seStofConflicten(project, rijen) {
  return (rijen || project.rijen).filter(r => !r.akkoord && seStofConflict(project, r));
}
// zet 'Examenstof SE' van deze toetsen gelijk aan PTA; geeft het aantal gewijzigde toetsen terug
function zetSeStofNaarPta(project, rijen) {
  let n = 0;
  for (const r of rijen) { if (!!r.examenstofSE !== !!r.pta) { r.examenstofSE = !!r.pta; n++; } }
  return n;
}

// ---------- tekencontrole ----------
const TEKST_VELDEN = ['omschrijving', 'tijdsduur', 'afname', 'eindtermen', 'hulpmiddelen', 'uitleg', 'cijfertekst', 'typeToets', 'toetsvorm', 'kolomkop'];
const TEKEN_NAAM = { '\t': 'tab', '\n': 'regeleinde', '\r': 'regeleinde', '"': 'dubbel aanhalingsteken', '\u201C': 'aanhalingsteken “', '\u201D': 'aanhalingsteken ”', '\u201E': 'aanhalingsteken „', '\u2018': 'aanhalingsteken ‘', '\u2019': 'aanhalingsteken ’', ';': 'puntkomma', '\u00A0': 'harde spatie', '\uFEFF': 'BOM-teken', '`': 'accent grave', '\u00B4': 'accent aigu', '\u2013': 'en-streepje', '\u2014': 'em-streepje', '\u2026': 'beletselteken' };
const BLOKKEREND = new Set(['\t', '"', '\u201C', '\u201D', '\u201E', '\u2018', '\u2019', ';']);
function tekenProblemen(project, r) {
  const inst = project.instellingen;
  const vervang = new Map((inst.vervangingen || []).map(([a, b]) => [a, b]));
  const out = [];
  for (const veld of TEKST_VELDEN) {
    const t = String(r[veld] ?? ''); if (!t) continue;
    const gezien = {};
    for (let i = 0; i < t.length; i++) {
      const ch = t[i]; const code = ch.codePointAt(0);
      let naam = TEKEN_NAAM[ch];
      if (!naam) {
        const ok = (code >= 0x20 && code <= 0x7E) || (code >= 0xA1 && code <= 0xFF) || ch === '€';
        if (ok) continue;
        naam = `teken ${ch} (U+${code.toString(16).toUpperCase().padStart(4, '0')})`;
      }
      if (veld === 'uitleg' && (ch === '\n' || ch === '\r') && inst.regeleindenInUitlegCsv) continue;
      if (gezien[ch]) { gezien[ch].n++; continue; }
      gezien[ch] = { veld, teken: ch, naam, n: 1, positie: i, blokkerend: BLOKKEREND.has(ch) || (code < 0x20 && ch !== '\n' && ch !== '\r'), vervanging: vervang.has(ch) ? vervang.get(ch) : null };
    }
    out.push(...Object.values(gezien));
  }
  return out;
}
function schoonRij(project, r) {
  const inst = project.instellingen;
  const tabel = inst.vervangingen || [];
  let gewijzigd = 0;
  for (const veld of TEKST_VELDEN) {
    let t = String(r[veld] ?? ''); if (!t) continue;
    const oud = t;
    for (const [a, b] of tabel) { if (!a) continue; if (veld === 'uitleg' && (a === '\n' || a === '\r') && inst.regeleindenInUitlegCsv) continue; t = t.split(a).join(b); }
    t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[ ]{2,}/g, ' ').trim();
    if (t !== oud) { r[veld] = t; gewijzigd++; }
  }
  return gewijzigd;
}

// ---------- validatie ----------
function valideerRij(project, r) {
  const inst = project.instellingen;
  Kern.zetAccenten(inst.accentenVervangen);
  Kern.zetVervangingen(inst.vervangingen);
  const fouten = [], waarschuwingen = [];
  if (!r.studie) fouten.push('Studie ontbreekt');
  if (!r.vak) fouten.push('Vakcode ontbreekt');
  if (!PERIODES.includes(r.periode)) fouten.push(`Ongeldige periode '${r.periode}' (P0, P1, P2, P3 of AFSE)`);
  if (!r.omschrijving) fouten.push('Omschrijving ontbreekt');
  if (r.wfac !== '' && typeof r.wfac !== 'number') fouten.push(`Weging jaar is geen getal ('${r.wfac}')`);
  if (r.wse !== '' && typeof r.wse !== 'number') fouten.push(`Weging SE is geen getal ('${r.wse}')`);
  for (const veld of ['wfac', 'wse']) if (typeof r[veld] === 'number' && (r[veld] < 0 || r[veld] > 100)) fouten.push(`${VELD_LABEL[veld]} ${r[veld]} valt buiten 0–100 (Decibel bewaart hier een geheel getal van 0 t/m 100)`);
  if (r.wfac === '' && r.wse === '') waarschuwingen.push('Weegfactor is verplicht in Magister; leeg wordt 0');
  if (r.cijfertekst && !inst.cijferteksten.map(x => x.toLowerCase()).includes(String(r.cijfertekst).trim().toLowerCase())) fouten.push(`Cijfertekst '${r.cijfertekst}' bestaat niet in Magister (import wordt afgebroken)`);
  if (inst.vakcodes && inst.vakcodes.length && r.studie && r.vak && !inst.vakcodes.includes(`${r.studie}|${r.vak}`)) fouten.push(`Vak '${r.vak}' is niet bekend bij ${r.studie} in Magister (import wordt afgebroken)`);
  for (const tp of tekenProblemen(project, r)) {
    const msg = `${tp.naam} in ${VELD_LABEL[tp.veld]}${tp.n > 1 ? ` (${tp.n}×)` : ''}${tp.vervanging !== null ? ` → wordt '${tp.vervanging === ' ' ? 'spatie' : tp.vervanging}' bij opschonen` : ''}`;
    if (tp.blokkerend) fouten.push(msg); else waarschuwingen.push(msg);
  }
  if (r.pta && (r.wse === '' || r.wse === 0)) waarschuwingen.push('PTA-regel zonder SE-weging');
  if (!r.pta && r.wse !== '' && r.wse !== 0) waarschuwingen.push('SE-weging op een niet-PTA-regel');
  const tv = mapToetsvorm(project, r.toetsvorm);
  if (!tv.bekend) fouten.push(`Toetsingsvorm '${r.toetsvorm}' niet herkend`);
  const tt = mapTypeToets(project, r.typeToets, r.pta);
  if (!tt.bekend) fouten.push(`Type '${r.typeToets}' niet herkend`);
  // Type en PTA moeten in Magister hetzelfde zeggen: Schoolexamen hoort bij PTA=Ja, Voortgangstoets bij PTA=Nee
  const tc = typeConflict(project, r);
  if (tc) fouten.push(tc);
  const sc = seStofConflict(project, r);
  if (sc) (sc.soort === 'fout' ? fouten : waarschuwingen).push(sc.tekst);
  const code = codeVoorRegel(project, r, tv.waarde || '');
  if (code && !inst.kolomkoppen.map(x => x.toLowerCase()).includes(code.toLowerCase())) waarschuwingen.push(`Code '${code}' staat niet in de lijst met codes die Magister kent (de import vraagt dan of hij aangemaakt moet worden)`);
  const af = mapAfname(project, r.afname);
  if (inst.afnameStrikt && r.afname && !af.bekend) waarschuwingen.push(`Afnamemoment '${r.afname}' staat niet in de vertaaltabel`);
  if (Kern.sanitize(af.waarde).length > inst.maxAfnamemoment) waarschuwingen.push(`Afnamemoment langer dan ${inst.maxAfnamemoment} tekens, wordt afgekapt`);
  if (Kern.sanitize(r.eindtermen).length > inst.maxEindtermen) waarschuwingen.push(`Eindtermen SE langer dan ${inst.maxEindtermen} tekens, wordt afgekapt`);
  if (!r.id) waarschuwingen.push('Nog geen nummer toegekend');
  // door de gebruiker geaccepteerd: meldingen blijven zichtbaar maar tellen niet mee
  if (r.akkoord) return { fouten: [], waarschuwingen: [], geaccepteerd: [...fouten, ...waarschuwingen] };
  return { fouten, waarschuwingen, geaccepteerd: [] };
}
// meldingen op studie-niveau (instellingen), één keer per studie in plaats van per regel
function studieMeldingen(project) {
  const out = {};
  for (const code of [...new Set(project.rijen.map(r => r.studie))]) {
    const st = studieInfo(project, code);
    const m = [];
    if (!code) continue;
    if (!st) m.push(`Studiecode '${code}' staat niet bij Studies & vakken (toevoegen, of de regels corrigeren)`);
    else if (!st.locatie) m.push(`Locatiecode voor ${code} is niet ingevuld bij Studies & vakken (nodig voor de Magister-import)`);
    if (m.length) out[code] = m;
  }
  return out;
}
function valideerProject(project) {
  const perRij = new Map();
  const perVak = {};
  const dubbel = {};
  for (const r of project.rijen) {
    const k = `${vakKey(r)}|${r.periode}|${r.omschrijving.toLowerCase()}`;
    dubbel[k] = (dubbel[k] || 0) + 1;
  }
  const ids = {};
  for (const r of project.rijen) if (r.id) ids[r.id] = (ids[r.id] || 0) + 1;
  const nrs = berekenKolomnummers(project);
  const nrTel = {};
  for (const r of project.rijen) { const k = `${vakKey(r)}|${nrs.get(r)}`; nrTel[k] = (nrTel[k] || 0) + 1; }
  const weg = ckolxWegingen(project);
  const modus = decimaleModus(project);
  const wegJaar = jaarWegingen(project);
  for (const r of project.rijen) {
    const v = valideerRij(project, r);
    // beide weegvelden zijn in Decibel gehele getallen: iveld2 (SE) en init_wfac (jaar)
    for (const [veld, w, doel] of [['wse', weg, 'iveld2'], ['wfac', wegJaar, 'init_wfac']]) {
      if (typeof r[veld] !== 'number' || isGeheel(r[veld])) continue;
      const label = VELD_LABEL[veld];
      const s = w.perVak[vakKey(r)];
      if (modus === 'sluitend') v.waarschuwingen.push(`${label} ${r[veld]} is geen geheel getal; in Decibel (${doel}) wordt het ${w.waarde.get(r)} — de som van ${r.vak} blijft ${s ? s.somNa : '?'}`);
      else if (modus === 'afronden') v.waarschuwingen.push(`${label} ${r[veld]} is geen geheel getal; in Decibel (${doel}) wordt het ${w.waarde.get(r)}${s && Math.abs(s.somNa - s.som) > 0.001 ? ` (som van ${r.vak} wordt ${s.somNa} in plaats van ${Math.round(s.som * 100) / 100})` : ''}`);
      else v.fouten.push(`${label} ${r[veld]} is geen geheel getal (${doel} in Decibel is een int)`);
    }
    const nr = nrs.get(r);
    if (nr) {
      if (nrTel[`${vakKey(r)}|${nr}`] > 1) v.fouten.push(`Kolomnummer ${nr} komt meer dan één keer voor bij ${r.vak} (import wordt afgebroken)`);
      const n = parseInt(nr, 10); if (n >= 1900 && n <= 2000) v.fouten.push(`Kolomnummer ${nr} ligt in het verboden bereik 1900–2000`);
    } else if (r.studie && r.vak) v.fouten.push('Geen kolomnummer af te leiden (ongeldige periode of studiecode zonder leerjaarcijfer)');
    const k = `${vakKey(r)}|${r.periode}|${r.omschrijving.toLowerCase()}`;
    if (r.omschrijving && dubbel[k] > 1) v.waarschuwingen.push('Dubbele omschrijving binnen vak/periode');
    if (r.id && ids[r.id] > 1) v.fouten.push(`Nummer ${r.id} komt meerdere keren voor`);
    if (r.akkoord && (v.fouten.length || v.waarschuwingen.length)) { v.geaccepteerd.push(...v.fouten, ...v.waarschuwingen); v.fouten = []; v.waarschuwingen = []; }
    perRij.set(r, v);
    const vk = vakKey(r);
    const s = perVak[vk] || (perVak[vk] = { studie: r.studie, vak: r.vak, aantal: 0, ptaAantal: 0, fouten: 0, waarschuwingen: 0, geaccepteerd: 0, somSE: 0, somJaar: 0, somJaarPta: 0, somSEP0: 0 });
    s.aantal++;
    if (r.pta) s.ptaAantal++;
    s.fouten += v.fouten.length; s.waarschuwingen += v.waarschuwingen.length; s.geaccepteerd += v.geaccepteerd.length;
    if (typeof r.wse === 'number' && r.periode !== 'P0') s.somSE += r.wse;
    if (typeof r.wse === 'number' && r.periode === 'P0') s.somSEP0 += r.wse;
    if (typeof r.wfac === 'number' && r.periode !== 'P0') { s.somJaar += r.wfac; if (r.pta) s.somJaarPta += r.wfac; }
  }
  for (const [vk, s] of Object.entries(perVak)) {
    s.meldingen = [];
    const st = studieInfo(project, s.studie);
    // vmbo werkt met weegfactoren, niet met percentages: daar hoort de som NIET op 100 uit te komen
    if (st && st.examenjaar && !st.vmboFilter && s.ptaAantal && Math.abs(s.somSE + s.somSEP0 - 100) > 0.01) s.meldingen.push(`SE-wegingen tellen op tot ${Math.round((s.somSE + s.somSEP0) * 100) / 100} in plaats van 100`);
    const idsvak = idsvakVan(project, vk);
    if (idsvak && idsvak.conflict) s.meldingen.push(`Query 2 geeft meerdere idsvak-waarden voor dit vak (${idsvak.alle.join(', ')})`);
  }
  return { perRij, perVak, perStudie: studieMeldingen(project) };
}

// ---------- Magister-CSV ----------
function magisterRecord(project, r, kolomnummer, wegs) {
  const inst = project.instellingen;
  Kern.zetAccenten(inst.accentenVervangen); Kern.zetVervangingen(inst.vervangingen);
  const st = studieInfo(project, r.studie) || {};
  const tv = mapToetsvorm(project, r.toetsvorm);
  const tt = mapTypeToets(project, r.typeToets, r.pta);
  const examen = !!st.examenjaar;
  // Weegfactor gaat naar sis_ckol.init_wfac: altijd een geheel getal
  const w = wegs || alleWegingen(project);
  const bron = examen && r.wse !== '' ? 'se' : 'jaar';
  let weeg = w[bron].waarde.get(r);
  if (weeg === '' || weeg === null || weeg === undefined || isNaN(weeg)) weeg = 0;
  const toetsvorm = tv.waarde || '';
  const kolomkop = codeVoorRegel(project, r, toetsvorm);
  return [
    st.locatie || '',
    r.studie,
    r.vak,
    r.periode,
    kolomnummer,
    kolomnummer,
    r.pta ? 'Ja' : 'Nee',
    Kern.sanitize(r.omschrijving),
    kolomkop,
    r.vak + kolomnummer,
    weeg,
    r.herk ? 'H' : '',
    r.cijfertekst || '',
    r.minc === '' ? 1 : r.minc,
    r.maxc === '' ? 10 : r.maxc,
    r.decimalen === '' ? '' : r.decimalen,
    Kern.sanitize(r.tijdsduur),
    Kern.sanitize(mapAfname(project, r.afname).waarde).slice(0, inst.maxAfnamemoment),
    r.examenstofSE ? 'Ja' : 'Nee',
    Kern.sanitize(r.eindtermen).slice(0, inst.maxEindtermen),
    'Nee',
    r.id,
    'Nee',
    tt.waarde || '',
    toetsvorm,
    inst.regeleindenInUitlegCsv ? Kern.sanitize(r.uitleg.replace(/\r?\n/g, '\u0001')).replace(/\u0001 ?/g, '\n') : Kern.sanitize(r.uitleg),
  ];
}
function magisterCsv(project, rijen) {
  const nrs = berekenKolomnummers(project);
  const wegs = alleWegingen(project);
  const lines = [MAGISTER_KOLOMMEN.join(';')];
  for (const r of sorteerRijen(rijen)) {
    const rec = magisterRecord(project, r, nrs.get(r), wegs);
    lines.push(rec.map(v => Kern.csvField(v, ';')).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// ---------- Wat staat er in Magister? (stand sinds de laatste bevestigde import) ----------
const MAG_SEP = String.fromCharCode(31);
// De lange tekstkolommen worden niet letterlijk bewaard maar als korte vingerafdruk: anders zou het project
// (en daarmee de browseropslag van 5 MB) verdubbelen. Van die twee kolommen weten we dus wél of ze zijn
// gewijzigd, maar niet meer wat er precies stond.
const MAG_LANG = new Set([19, 25]);   // Eindtermen SE, Uitgebreide uitleg
function korteHash(s) {
  let h = 0x811c9dc5;
  const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return '#' + h.toString(36) + '.' + t.length.toString(36);
}
function magRecordTekst(project, r, nr, wegs) {
  return magisterRecord(project, r, nr, wegs).map((v, i) => MAG_LANG.has(i) ? korteHash(v) : String(v ?? '')).join(MAG_SEP);
}
// per regel: nieuw (nooit geëxporteerd), gewijzigd (anders dan wat er in Magister staat) of gelijk
function magisterStand(project) {
  const nrs = berekenKolomnummers(project);
  const wegs = alleWegingen(project);
  const perRij = new Map();
  const tel = { nieuw: 0, gewijzigd: 0, gelijk: 0 };
  for (const r of project.rijen) {
    const nu = magRecordTekst(project, r, nrs.get(r), wegs);
    const oud = r.mag && r.mag.v;
    const uit = { code: 'nieuw', diffs: [], nu, t: r.mag ? r.mag.t : '' };
    if (oud === nu) uit.code = 'gelijk';
    else if (oud) {
      uit.code = 'gewijzigd';
      const a = String(oud).split(MAG_SEP), b = nu.split(MAG_SEP);
      const nuVol = magisterRecord(project, r, nrs.get(r), wegs);
      for (let i = 0; i < MAGISTER_KOLOMMEN.length; i++) {
        if ((a[i] || '') === (b[i] || '')) continue;
        if (MAG_LANG.has(i)) uit.diffs.push({ kolom: MAGISTER_KOLOMMEN[i], was: '', wordt: String(nuVol[i] ?? ''), lang: true });
        else uit.diffs.push({ kolom: MAGISTER_KOLOMMEN[i], was: a[i] || '', wordt: b[i] || '' });
      }
    }
    tel[uit.code]++;
    perRij.set(r, uit);
  }
  return { perRij, tel, nrs, vervallen: project.magVervallen || [], laatste: laatsteImport(project) };
}
function laatsteImport(project) {
  const lijst = (project.exports || []).filter(x => x.bevestigdOp);
  return lijst.length ? lijst[0] : null;
}
// een regel die al in Magister stond en uit het project verdwijnt, onthouden (Magister ruimt niets op via een import)
function onthoudVervallen(project, rijen, nrs) {
  project.magVervallen = project.magVervallen || [];
  for (const r of [].concat(rijen)) {
    if (!r || !r.mag) continue;
    if (project.magVervallen.some(x => x.id === r.id)) continue;
    project.magVervallen.push({ id: r.id, studie: r.studie, vak: r.vak, periode: r.periode, kolomnr: (nrs && nrs.get(r)) || r.kolomnr || '', omschrijving: r.omschrijving, t: new Date().toISOString() });
  }
  if (project.magVervallen.length > 500) project.magVervallen.splice(0, project.magVervallen.length - 500);
}
// vastleggen wat er in de CSV stond; pas na bevestiging geldt dat als 'staat in Magister'
function registreerExport(project, rijen, label, stand) {
  const t = new Date().toISOString();
  const ex = { t, label, aantal: rijen.length, studies: [...new Set(rijen.map(r => r.studie))].sort(), ids: rijen.map(r => r.id).filter(Boolean), bevestigdOp: '' };
  project.exports = project.exports || [];
  project.exports.unshift(ex);
  if (project.exports.length > 40) project.exports.length = 40;
  ex.__stand = null;
  return ex;
}
function bevestigExport(project, ex) {
  const stand = magisterStand(project);
  const ids = new Set(ex.ids || []);
  let n = 0;
  for (const r of project.rijen) {
    if (!ids.has(r.id)) continue;
    const s = stand.perRij.get(r);
    r.mag = { t: ex.t, v: s ? s.nu : magRecordTekst(project, r, stand.nrs.get(r)) };
    n++;
  }
  ex.bevestigdOp = new Date().toISOString();
  return n;
}
// de stand handmatig gelijkzetten (bijv. na een import buiten het dashboard om)
function markeerAllesGeimporteerd(project, rijen) {
  const stand = magisterStand(project);
  const t = new Date().toISOString();
  for (const r of (rijen || project.rijen)) { const s = stand.perRij.get(r); r.mag = { t, v: s ? s.nu : magRecordTekst(project, r, stand.nrs.get(r)) }; }
  return (rijen || project.rijen).length;
}

// ---------- Testbestand voor Magister ----------
function testCsv(project, studie, vak) {
  const inst = project.instellingen;
  const lj = studie.slice(-1);
  const basis = nieuweRij({ studie, vak, periode: 'AFSE', pta: false, wfac: 0, id: `${inst.nummerPrefix}/TEST` });
  const rijen = [
    Object.assign({}, basis, { kolomnr: `${lj}991`, omschrijving: 'TEST 1 gewone regel', uitleg: 'Gewone uitleg zonder bijzondere tekens' }),
    Object.assign({}, basis, { kolomnr: `${lj}992`, omschrijving: 'TEST 2 regeleinde in uitleg', uitleg: 'Eerste alinea\nTweede alinea' }),
    Object.assign({}, basis, { kolomnr: `${lj}993`, omschrijving: 'TEST 3\ttab in omschrijving', uitleg: 'Uitleg met "aanhalingstekens" en punt; komma' }),
  ];
  // bewust NIET opschonen: dit bestand test wat Magister accepteert
  const lines = [MAGISTER_KOLOMMEN.join(';')];
  const st = studieInfo(project, studie) || {};
  for (const r of rijen) {
    const rec = [st.locatie || '', studie, vak, r.periode, r.kolomnr, r.kolomnr, 'Nee', r.omschrijving, 'VT', vak + r.kolomnr, 0, '', '', 1, 10, '', '', '', 'Nee', '', 'Nee', r.id, 'Nee', 'Voortgangstoets', 'Voortgangstoets', r.uitleg];
    lines.push(rec.map(v => Kern.csvField(v, ';')).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// ---------- CkolX MERGE ----------
function sqlStr(s) { return String(s ?? '').replace(/'/g, "''"); }
function isGeheel(n) { return Math.abs(n - Math.round(n)) < 1e-9; }
// iveld2 (Weging SE) in sis_ckolx is een int-kolom. Decimale wegingen (0.5, 33.33) kunnen daar niet in.
// Levert per rij het gehele getal dat in de MERGE komt, plus per vak de gebruikte schaalfactor.
// Zowel sis_ckolx.iveld2 (Weging SE) als sis_ckol.init_wfac (Weging jaar) zijn gehele getallen in Decibel.
// Beide velden zijn gehele getallen van 0 t/m 100, dus schalen (×10) kan niet: dat zou 33,33 tot 333 maken
// en de som van een vak boven 100 tillen. Daarom afronden, en bij 'sluitend' de rest zo verdelen dat de som klopt.
function wegingenVoor(project, veld) {
  const modus = decimaleModus(project);
  const perVak = {};
  const waarde = new Map();
  const groepen = {};
  for (const r of project.rijen) {
    if (typeof r[veld] !== 'number') { waarde.set(r, 0); continue; }
    const vk = vakKey(r);
    (groepen[vk] = groepen[vk] || []).push(r);
  }
  for (const [vk, rijen] of Object.entries(groepen)) {
    const s = perVak[vk] = { decimaal: rijen.some(r => !isGeheel(r[veld])), som: 0, somNa: 0, verschoven: 0 };
    s.som = rijen.reduce((a, r) => a + r[veld], 0);
    if (!s.decimaal || modus === 'afronden' || modus === 'fout') {
      for (const r of rijen) waarde.set(r, Math.round(r[veld]));
    } else {
      // sluitend afronden (grootste-rest-methode): elke waarde naar beneden, de resterende punten
      // gaan naar de regels met de grootste rest. Zo blijft de som van het vak precies gelijk
      // (bij een examenjaar dus 100) en blijft alles binnen 0–100.
      const doel = Math.round(s.som);
      const basis = rijen.map(r => ({ r, laag: Math.floor(r[veld]), rest: r[veld] - Math.floor(r[veld]) }));
      let punten = doel - basis.reduce((a, x) => a + x.laag, 0);
      basis.sort((a, b) => b.rest - a.rest);
      for (const x of basis) { const bij = punten > 0 ? 1 : 0; waarde.set(x.r, x.laag + bij); if (bij) punten--; }
      while (punten > 0) { for (const x of basis) { if (punten <= 0) break; waarde.set(x.r, waarde.get(x.r) + 1); punten--; } }
      while (punten < 0) { for (const x of basis) { if (punten >= 0) break; if (waarde.get(x.r) > 0) { waarde.set(x.r, waarde.get(x.r) - 1); punten++; } } }
      s.verschoven = basis.filter(x => waarde.get(x.r) !== Math.round(x.r[veld])).length;
    }
    s.somNa = rijen.reduce((a, r) => a + waarde.get(r), 0);
  }
  return { waarde, perVak, veld, modus };
}
function decimaleModus(project) {
  const m = project.instellingen.decimaleWeging;
  return m === 'afronden' || m === 'fout' ? m : 'sluitend';   // 'schalen' uit oudere versies -> sluitend
}
// decimale wegingen definitief wegwerken in de gegevens zelf (dus ook in de sectie-Excel en het boekje)
function zetWegingenGeheel(project, modus) {
  const m = modus || (decimaleModus(project) === 'afronden' ? 'afronden' : 'sluitend');
  const oudeModus = project.instellingen.decimaleWeging;
  project.instellingen.decimaleWeging = m;
  let n = 0;
  const perVeld = { wse: wegingenVoor(project, 'wse'), wfac: wegingenVoor(project, 'wfac') };
  project.instellingen.decimaleWeging = oudeModus;
  for (const r of project.rijen) {
    for (const veld of ['wse', 'wfac']) {
      if (typeof r[veld] !== 'number') continue;
      const s = perVeld[veld].perVak[vakKey(r)];
      if (!s || !s.decimaal) continue;
      const nieuw = perVeld[veld].waarde.get(r);
      if (nieuw !== r[veld]) { r[veld] = nieuw; n++; }
    }
  }
  return n;
}
function decimaleWegingen(project) {
  return project.rijen.filter(r => ['wse', 'wfac'].some(v => typeof r[v] === 'number' && !isGeheel(r[v]))).length;
}
function ckolxWegingen(project) { return wegingenVoor(project, 'wse'); }
function jaarWegingen(project) { return wegingenVoor(project, 'wfac'); }
function alleWegingen(project) { return { se: ckolxWegingen(project), jaar: jaarWegingen(project) }; }
// idsvak per vak/studie, afgeleid uit de query-2-koppelingen (kolom idsvak) van de regels van dat vak
function idsvakVan(project, vk) {
  const ids = new Set(project.rijen.filter(r => vakKey(r) === vk).map(r => r.id));
  const waarden = [...new Set(project.ckolx.filter(x => x.idsvak && ids.has(x.id)).map(x => x.idsvak))];
  if (!waarden.length) return null;
  return { idsvak: waarden[0], alle: waarden, conflict: waarden.length > 1 };
}
// vakinleiding (platte tekst met opmaakafspraken) -> schone HTML voor sis_svak.ptainleiding en het boekje
// De vakinleiding mag vet, cursief en onderstreept bevatten ({b}/{i}/{u} uit Excel of Word).
// In het boekje en de voorbeelden wordt dat echte opmaak; naar Magister gaat de tekst zonder markering.
function inleidingHtml(tekst) {
  const escPlat = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // opmaak mag over meerdere regels/alinea's lopen: aan het eind van een regel sluiten en op de volgende heropenen
  let open = [];
  const esc = (s) => {
    let out = open.map(t => `<${t}>`).join('');
    for (const deel of String(s ?? '').split(/(\{\/?[biu]\})/g)) {
      if (!deel) continue;
      const m = deel.match(/^\{(\/?)([biu])\}$/);
      if (m) {
        if (m[1]) { if (open.includes(m[2])) { out += `</${m[2]}>`; open = open.filter(t => t !== m[2]); } }
        else if (!open.includes(m[2])) { out += `<${m[2]}>`; open.push(m[2]); }
        continue;
      }
      out += escPlat(deel);
    }
    return out + open.slice().reverse().map(t => `</${t}>`).join('');
  };
  const regels = String(tekst ?? '').replace(/\r\n?/g, '\n').split('\n');
  let out = '', lijst = false, alinea = [];
  const sluitAlinea = () => { if (alinea.length) { out += `<p>${alinea.map(esc).join('<br>')}</p>`; alinea = []; } };
  const sluitLijst = () => { if (lijst) { out += '</ul>'; lijst = false; } };
  for (const raw of regels) {
    const l = raw.trim();
    const k = l.match(/^(#{2,3})\s*(.*)$/); // ## kop, ### subkop
    if (k && k[2]) { sluitAlinea(); sluitLijst(); out += `<h${k[1].length}>${esc(k[2])}</h${k[1].length}>`; continue; }
    const m = l.match(/^[-*•#]\s+(.*)$/); // opsommingsteken
    if (m) { sluitAlinea(); if (!lijst) { out += '<ul>'; lijst = true; } out += `<li>${esc(m[1])}</li>`; continue; }
    if (!l) { sluitAlinea(); sluitLijst(); continue; }
    sluitLijst(); alinea.push(l);
  }
  sluitAlinea(); sluitLijst();
  return out;
}
function svakStatements(project, rijen) {
  const inst = project.instellingen;
  const out = [], zonderIdsvak = [], leeg = [];
  const vakken = {};
  for (const r of (rijen || project.rijen)) { const k = vakKey(r); if (!vakken[k]) vakken[k] = { studie: r.studie, vak: r.vak }; }
  for (const [vk, x] of Object.entries(vakken).sort()) {
    const info = (project.vakken || {})[vk] || {};
    const tekst = (info.inleiding || '').trim();
    if (!tekst) { leeg.push(x); continue; }
    const iv = idsvakVan(project, vk);
    if (!iv) { zonderIdsvak.push(x); continue; }
    const html = inleidingHtml(Kern.zonderOpmaak(tekst));
    out.push(`UPDATE sis_svak SET ptainleiding = N'${sqlStr(html)}' WHERE idsvak = ${iv.idsvak}${inst.inleidingAlleenLeeg ? " AND (ptainleiding IS NULL OR LTRIM(RTRIM(CAST(ptainleiding AS NVARCHAR(MAX)))) = '')" : ''}; -- ${x.studie} ${x.vak}`);
  }
  return { statements: out, zonderIdsvak, leeg };
}
// Borging van het unieke nummer: vergelijkt de koppelingen uit query 2 met het project.
// Een nummer mag maar bij één regel horen, en de kolom in Magister moet dezelfde studie, hetzelfde vak
// en hetzelfde kolomnummer hebben. Alles wat daar niet aan voldoet, gaat NIET mee in de MERGE.
function ckolxControle(project) {
  const nrs = berekenKolomnummers(project);
  const perId = new Map();
  for (const r of project.rijen) { if (!r.id) continue; if (!perId.has(r.id)) perId.set(r.id, []); perId.get(r.id).push(r); }
  const dubbelId = [...perId.entries()].filter(([, v]) => v.length > 1).map(([id, rijen]) => ({ id, rijen }));
  const perCk = new Map();
  for (const x of (project.ckolx || [])) { if (!perCk.has(x.id)) perCk.set(x.id, []); perCk.get(x.id).push(x); }
  const dubbelCkol = [...perCk.entries()].filter(([, v]) => new Set(v.map(y => y.idckol)).size > 1).map(([id, koppelingen]) => ({ id, koppelingen }));
  const conflict = [], zonder = [];
  for (const r of project.rijen) {
    if (!r.id) continue;
    const xs = perCk.get(r.id) || [];
    if (!xs.length) { zonder.push(r); continue; }
    const x = xs[0];
    const p = [];
    if (x.studie && normStudie(x.studie) !== normStudie(r.studie)) p.push(`hoort in Magister bij studie ${x.studie}, in het project bij ${r.studie}`);
    if (x.vak && normVak(x.vak) !== normVak(r.vak)) p.push(`hoort in Magister bij vak ${x.vak}, in het project bij ${r.vak}`);
    const nr = nrs.get(r);
    if (x.kolomnr && nr && String(x.kolomnr).trim() !== String(nr).trim()) p.push(`hoort in Magister bij kolomnummer ${x.kolomnr}, in het project bij ${nr}`);
    if (p.length) conflict.push({ rij: r, koppeling: x, problemen: p });
  }
  const ids = new Set(project.rijen.map(r => r.id));
  const onbekend = (project.ckolx || []).filter(x => !ids.has(x.id));
  const metContext = (project.ckolx || []).some(x => x.studie || x.kolomnr);
  const geblokkeerd = new Set([...conflict.map(c => c.rij.id), ...dubbelId.map(d => d.id), ...dubbelCkol.map(d => d.id)]);
  return { dubbelId, dubbelCkol, conflict, zonder, onbekend, metContext, geblokkeerd, info: project.ckolxInfo || null };
}
// wat er voor deze regel in sis_ckolx komt te staan (rveld1, iveld2, rveld2), als één tekst voor de vergelijking
function vrijeVeldTekst(project, r, weg) {
  const inst = project.instellingen;
  const w = weg || ckolxWegingen(project);
  const rveld1 = Kern.zonderOpmaak(inst.rveld1Bron === 'typeToets' ? (mapTypeToets(project, r.typeToets, r.pta).waarde || '') : r.hulpmiddelen);
  return [rveld1, String(w.waarde.get(r) || 0), korteHash(Kern.zonderOpmaak(r.uitleg))].join(MAG_SEP);
}
// stand van de vrije velden: nieuw (nog nooit weggeschreven), gewijzigd of gelijk aan de laatste batch
function vrijeVeldenStand(project) {
  const weg = ckolxWegingen(project);
  const perRij = new Map();
  const tel = { nieuw: 0, gewijzigd: 0, gelijk: 0 };
  for (const r of project.rijen) {
    const nu = vrijeVeldTekst(project, r, weg);
    const oud = r.vv && r.vv.v;
    const code = oud === nu ? 'gelijk' : (oud ? 'gewijzigd' : 'nieuw');
    tel[code]++;
    perRij.set(r, { code, nu, t: r.vv ? r.vv.t : '' });
  }
  return { perRij, tel };
}
function markeerVrijeVelden(project, rijen, stand) {
  const s = stand || vrijeVeldenStand(project);
  const t = new Date().toISOString();
  const vorige = [];
  for (const r of rijen) { vorige.push([r, r.vv]); r.vv = { t, v: s.perRij.get(r).nu }; }
  return vorige;   // om terug te draaien
}
function ckolxStatements(project, rijen) {
  const inst = project.instellingen;
  const controle = ckolxControle(project);
  const idmap = new Map(project.ckolx.map(x => [x.id, x.idckol]));
  const weg = ckolxWegingen(project);
  const d = new Date();
  const datum = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  const out = [], ontbreekt = [], geschaald = [], geblokkeerd = [];
  for (const [vk, s] of Object.entries(weg.perVak)) if (s.decimaal) geschaald.push({ vak: vk, factor: s.factor });
  const gekozen = rijen ? new Set(rijen) : null;
  for (const r of sorteerRijen(rijen || project.rijen)) {
    if (gekozen && !gekozen.has(r)) continue;
    const idckol = idmap.get(r.id);
    if (!idckol) { ontbreekt.push(r); continue; }
    if (controle.geblokkeerd.has(r.id)) { geblokkeerd.push(r); continue; }
    const rveld1 = Kern.zonderOpmaak(inst.rveld1Bron === 'typeToets' ? (mapTypeToets(project, r.typeToets, r.pta).waarde || '') : r.hulpmiddelen);
    const iveld2 = weg.waarde.get(r) || 0;
    const rveld2 = Kern.zonderOpmaak(r.uitleg);
    out.push(`MERGE INTO sis_ckolx AS target USING (SELECT ${idckol} AS idckol, '0' AS Schoolid, '${datum}' AS datumaanm, '${sqlStr(inst.idGebr)}' AS useraanm, '${datum}' AS datumwijz, '${sqlStr(inst.idGebr)}' AS userwijz, '${sqlStr(rveld1)}' AS rveld1, ${iveld2} AS iveld2, '${sqlStr(rveld2)}' AS rveld2) AS Source  ON target.idckol = source.idckol WHEN MATCHED THEN UPDATE SET target.Schoolid = source.Schoolid, target.datumwijz = source.datumwijz, target.userwijz = source.userwijz, target.rveld1 = source.rveld1, target.iveld2 = source.iveld2, target.rveld2 = source.rveld2 WHEN NOT MATCHED THEN INSERT (idckol, Schoolid, datumaanm, useraanm, datumwijz, userwijz, rveld1, iveld2, rveld2) VALUES (source.idckol, source.Schoolid, source.datumaanm, source.useraanm, source.datumwijz, source.userwijz, source.rveld1, source.iveld2, source.rveld2);`);
  }
  return { statements: out, ontbreekt, geschaald, geblokkeerd, controle };
}

// ---------- Query-teksten ----------
function query1Tekst(project) {
  const inst = project.instellingen;
  const studies = inst.studies.filter(s => s.actief);
  const clauses = studies.map(s => {
    const base = `b.lesperiode = ${inst.bronLesperiode} AND a.soort_kol = 1 AND CAST(a.kol_nr AS VARCHAR) NOT LIKE '_9%' AND CAST(a.kol_nr AS VARCHAR) NOT LIKE '_7%' AND b.studie = '${s.code.toLowerCase()}'`;
    return s.vmboFilter ? `(${base})` : `(${base} AND CAST(a.kol_nr AS VARCHAR) NOT LIKE '%000')`;
  });
  return `SELECT
    b.studie AS Studie,
    a.c_vak AS Vakcode,
    a.c_periode AS Cijferperiode,
    a.bex_kolom AS PTA,
    CAST(c.rveld2 AS NVARCHAR(MAX)) AS Uitgebreide_uitleg,
    a.omschr AS Korte_omschrijving_Magister,
    a.init_wfac AS Weegfactor_niet_examenjaar,
    c.iveld2 AS Weging_examenjaar,
    a.bherkansing AS Herkansing,
    a.tijdsduur AS Tijdsduur,
    a.afnamemoment AS Afnamemoment,
    a.eindtermen AS Eindtermen_SE,
    CAST(c.rveld1 AS NVARCHAR(MAX)) AS Hulpmiddelen,
    d.omschr AS Type_toets,
    e.omschr AS Toetsingsvorm,
    a.eindtermence AS Nummer
FROM sis_ckol a
INNER JOIN sis_stud b ON a.idstud = b.idstud
LEFT JOIN sis_ckolx c ON a.idckol = c.idckol
LEFT JOIN hrnitem d ON a.idtypetoets = d.idhrnitem
LEFT JOIN hrnitem e ON a.idtoetsvorm = e.idhrnitem
WHERE
${clauses.join('\n OR ')}
ORDER BY b.studie, a.c_vak, a.c_periode, a.kol_nr`;
}
function query2Tekst(project, alleenPta) {
  return `SELECT a.eindtermence, a.idckol, a.idsvak, b.studie, a.c_vak, a.kol_nr
FROM sis_ckol a
INNER JOIN sis_stud b ON a.idstud = b.idstud
WHERE b.lesperiode = ${project.instellingen.schooljaar}${alleenPta ? ' AND a.bex_kolom = 1' : ''}
  AND a.eindtermence LIKE '${project.instellingen.nummerPrefix}/%'`;
}
// controlequery: dubbele of onbekende unieke nummers in Magister opsporen
function queryNummerControleTekst(project) {
  const inst = project.instellingen;
  return `-- Controle op de unieke nummers (${inst.nummerPrefix}/...) in schooljaar ${inst.schooljaar}
-- 1) Eén nummer mag maar bij één cijferkolom horen. Alles met meer dan 1 rij hieronder is fout
--    (meestal een gekopieerde regel in een sectie-Excel of een handmatig gewijzigd kolomnummer).
SELECT a.eindtermence, COUNT(DISTINCT a.idckol) AS kolommen,
       MIN(b.studie) AS studie_1, MAX(b.studie) AS studie_2,
       MIN(a.c_vak) AS vak_1, MAX(a.c_vak) AS vak_2,
       MIN(a.kol_nr) AS kol_1, MAX(a.kol_nr) AS kol_2
FROM sis_ckol a
INNER JOIN sis_stud b ON a.idstud = b.idstud
WHERE b.lesperiode = ${inst.schooljaar}
  AND a.eindtermence LIKE '${inst.nummerPrefix}/%'
GROUP BY a.eindtermence
HAVING COUNT(DISTINCT a.idckol) > 1
ORDER BY a.eindtermence;

-- 2) PTA-kolommen van dit schooljaar zonder uniek nummer: die kan het dashboard niet koppelen
--    (vrije velden blijven leeg). Meestal handmatig in Magister aangemaakt.
SELECT b.studie, a.c_vak, a.kol_nr, a.omschr
FROM sis_ckol a
INNER JOIN sis_stud b ON a.idstud = b.idstud
WHERE b.lesperiode = ${inst.schooljaar}
  AND a.soort_kol = 1 AND a.bex_kolom = 1
  AND (a.eindtermence IS NULL OR a.eindtermence NOT LIKE '${inst.nummerPrefix}/%')
GROUP BY b.studie, a.c_vak, a.kol_nr, a.omschr
ORDER BY b.studie, a.c_vak, a.kol_nr;`;
}
function query3Tekst(project, keuze) {
  // keuze: [{studie, kolom}] — SE-berekeningskolom (soort_kol = 2) per studie. De query is beperkt tot het schooljaar
  // (sis_stud.lesperiode) én de gekozen studies; kolommen van eerdere schooljaren worden nooit geraakt.
  const jaar = project.instellingen.schooljaar;
  const lijst = (keuze || []).filter(k => /^\d{3,5}$/.test(String(k.kolom || '').trim()));
  if (!lijst.length) return `-- Vul eerst per studie het SE-kolomnummer in en vink minimaal één studie aan.`;
  const paren = lijst.map(k => `(s.studie = '${sqlStr(k.studie.toLowerCase())}' AND d.kol_nr = ${String(k.kolom).trim()})`).join('\n       OR ');
  const bereik = `s.lesperiode = ${jaar}\n  AND (${paren})`;
  return `-- Query 3: SE-berekeningskolommen vullen — schooljaar ${jaar}, ${lijst.map(k => `${k.studie}: ${k.kolom}`).join(', ')}
-- Werkt uitsluitend op inschrijvingen van lesperiode ${jaar} (sis_stud) en op de genoemde SE-kolommen;
-- rapport-/overgangskolommen (x7xx) en alle kolommen van eerdere schooljaren blijven ongemoeid.
BEGIN TRANSACTION;

-- Stap 1: INSERT — toetskolommen met een SE-weging (iveld2 > 0) van dezelfde inschrijving en hetzelfde vak
-- die nog niet onder de SE-kolom hangen, eraan koppelen (type 4 = aangepaste weegfactor)
INSERT INTO sis_cg_m (idckol, idckol_gm_kol, wfac, type_wfac)
SELECT d.idckol, c.idckol, x.iveld2, 4
FROM sis_ckol d
JOIN sis_stud s ON s.idstud = d.idstud
JOIN sis_ckol c ON c.idstud = d.idstud AND c.c_vak = d.c_vak AND c.soort_kol = 1
JOIN sis_ckolx x ON x.idckol = c.idckol
WHERE d.soort_kol = 2
  AND ${bereik}
  AND x.iveld2 > 0
  AND NOT EXISTS (SELECT 1 FROM sis_cg_m m WHERE m.idckol = d.idckol AND m.idckol_gm_kol = c.idckol);

-- Stap 2: UPDATE — bestaande koppelingen onder de SE-kolom op de PTA-weging zetten
UPDATE m
SET m.wfac = x.iveld2, m.type_wfac = 4
FROM sis_cg_m m
JOIN sis_ckol d ON d.idckol = m.idckol
JOIN sis_stud s ON s.idstud = d.idstud
JOIN sis_ckolx x ON x.idckol = m.idckol_gm_kol
WHERE d.soort_kol = 2
  AND ${bereik}
  AND x.iveld2 > 0
  AND (m.wfac IS NULL OR m.wfac <> x.iveld2 OR m.type_wfac IS NULL OR m.type_wfac <> 4);

-- Stap 3: DELETE — koppelingen onder de SE-kolom van kolommen zonder SE-weging verwijderen
-- (alleen dit schooljaar en alleen de gekozen studies/SE-kolommen)
DELETE m
FROM sis_cg_m m
JOIN sis_ckol d ON d.idckol = m.idckol
JOIN sis_stud s ON s.idstud = d.idstud
LEFT JOIN sis_ckolx x ON x.idckol = m.idckol_gm_kol
WHERE d.soort_kol = 2
  AND ${bereik}
  AND (x.iveld2 IS NULL OR x.iveld2 = 0);

COMMIT;`;
}
// controle vooraf/achteraf: per studie, SE-kolom en vak hoeveel koppelingen gelijk zijn aan het PTA
function query3ControleTekst(project, keuze) {
  const jaar = project.instellingen.schooljaar;
  const lijst = (keuze || []).filter(k => /^\d{3,5}$/.test(String(k.kolom || '').trim()));
  const paren = lijst.length ? lijst.map(k => `(s.studie = '${sqlStr(k.studie.toLowerCase())}' AND d.kol_nr = ${String(k.kolom).trim()})`).join('\n       OR ') : `CAST(d.kol_nr AS VARCHAR) NOT LIKE '_7__'`;
  return `SELECT s.studie, d.kol_nr AS se_kolom, d.omschr, d.c_vak,
       COUNT(*) AS koppelingen,
       SUM(CASE WHEN m.wfac = x.iveld2 AND m.type_wfac = 4 THEN 1 ELSE 0 END) AS gelijk_aan_pta,
       SUM(CASE WHEN x.iveld2 IS NULL OR x.iveld2 = 0 THEN 1 ELSE 0 END) AS zonder_se_weging,
       COUNT(DISTINCT d.idstud) AS leerlingen
FROM sis_cg_m m
JOIN sis_ckol d ON d.idckol = m.idckol
JOIN sis_stud s ON s.idstud = d.idstud
LEFT JOIN sis_ckolx x ON x.idckol = m.idckol_gm_kol
WHERE d.soort_kol = 2
  AND s.lesperiode = ${jaar}
  AND (${paren})
GROUP BY s.studie, d.kol_nr, d.omschr, d.c_vak
ORDER BY s.studie, d.kol_nr, d.c_vak;`;
}
// welke berekeningskolommen bestaan er dit schooljaar per studie (om het SE-kolomnummer op te zoeken)
function query3ZoekTekst(project) {
  return `SELECT s.studie, d.kol_nr, d.omschr, COUNT(DISTINCT d.idstud) AS leerlingen, COUNT(DISTINCT d.c_vak) AS vakken
FROM sis_ckol d
JOIN sis_stud s ON s.idstud = d.idstud
WHERE d.soort_kol = 2
  AND s.lesperiode = ${project.instellingen.schooljaar}
  AND CAST(d.kol_nr AS VARCHAR) NOT LIKE '_7__'
GROUP BY s.studie, d.kol_nr, d.omschr
ORDER BY s.studie, d.kol_nr;`;
}


/* ---- migratie (uit de UI-sectie van e-PTA) ---- */
function migreer(p) {
  const std = standaardInstellingen();
  p.instellingen = Object.assign({}, std, p.instellingen || {});
  const i = p.instellingen;
  i.mapToetsvorm = Object.assign({}, std.mapToetsvorm, i.mapToetsvorm || {});
  i.mapTypeToets = Object.assign({}, std.mapTypeToets, i.mapTypeToets || {});
  i.codeVanRuw = Object.assign({}, std.codeVanRuw, i.codeVanRuw || {});
  // v3.24: KLV is een Code, geen toetsingsvorm. De oude vertaling klv -> Voortgangstoets wordt
  // eenmalig teruggedraaid zodat de toetsingsvorm per vak bevestigd wordt (de Code blijft KLV).
  if (!i.klvHersteld) { if (i.mapToetsvorm['klv'] === 'Voortgangstoets') delete i.mapToetsvorm['klv']; i.klvHersteld = true; }
  for (const k of ['kolomkoppen', 'cijferteksten', 'vakcodes', 'vervangingen', 'studies']) if (!Array.isArray(i[k])) i[k] = std[k];
  i.keuzelijsten = Object.assign({}, std.keuzelijsten, i.keuzelijsten || {});
  i.mapAfname = Object.assign({}, std.mapAfname, i.mapAfname || {});
  if (!Array.isArray(i.magToetsvormen) || !i.magToetsvormen.length) i.magToetsvormen = std.magToetsvormen.slice();
  if (!Array.isArray(i.magTypes) || !i.magTypes.length) i.magTypes = std.magTypes.slice();
  i.kolomkopVan = Object.assign({}, std.kolomkopVan, i.kolomkopVan || {});
  if (!Array.isArray(i.keuzelijsten.afname)) i.keuzelijsten.afname = [];
  i.sectie = Object.assign({}, std.sectie, i.sectie || {});
  i.rapport = Object.assign({}, std.rapport, i.rapport || {});
  if (i.rapport.logo === undefined) i.rapport.logo = STANDAARD_LOGO;
  if (i.rapport.kopPtd === 'Jaarplanner') i.rapport.kopPtd = 'PTD';
  p.naam = p.naam || 'PTA';
  p.vakken = p.vakken || {}; p.ckolx = p.ckolx || []; p.checklist = p.checklist || {}; p.log = p.log || []; p.studieInleiding = p.studieInleiding || {}; p.vaknamen = p.vaknamen || {};
  p.versies = p.versies || {}; p.mutaties = Array.isArray(p.mutaties) ? p.mutaties : []; p.rapportages = Array.isArray(p.rapportages) ? p.rapportages : [];
  p.rijen.forEach((r, i2) => { const n = nieuweRij(r); Object.assign(r, n); if (r.volgorde === undefined) r.volgorde = i2; });
  for (const st of i.studies) if (st.deadline === undefined) st.deadline = '';
  p.archief = p.archief || [];
  p.exports = p.exports || [];
  compacteerStempels(p);
  p.magVervallen = p.magVervallen || [];
  p.nummerTeller = p.nummerTeller || {};
  // teller bijwerken met wat er al is uitgegeven, zodat nummers ook na opschonen nooit terugkomen
  const pre = i.nummerPrefix;
  if (pre) p.nummerTeller[pre] = Math.max(p.nummerTeller[pre] || 0, nummerTellerStand(p));
  migreerStatussen(p);
}

function compacteerStempels(p) {
  let n = 0;
  const kort = (v) => typeof v === 'string' && v.startsWith('#');   // al een vingerafdruk
  for (const r of p.rijen) {
    if (r.mag && r.mag.v) {
      const d = String(r.mag.v).split(MAG_SEP);
      if (d.length >= 26 && [...MAG_LANG].some(i => !kort(d[i]))) {
        r.mag.v = d.map((v, i) => MAG_LANG.has(i) && !kort(v) ? korteHash(v) : v).join(MAG_SEP); n++;
      }
    }
    if (r.vv && r.vv.v) {
      const d = String(r.vv.v).split(MAG_SEP);
      if (d.length > 3 || (d.length === 3 && !kort(d[2]))) {
        r.vv.v = [d[0], d[1], korteHash(d.slice(2).join(MAG_SEP))].join(MAG_SEP); n++;
      }
    }
  }
  if (n) p.log.unshift({ t: new Date().toISOString(), tekst: `${n} vergelijkingsstempels compacter opgeslagen (browseropslag)` });
}

function migreerStatussen(p) {
  if ((p.versie || 1) >= 3) return;
  const basis = p.gewijzigd || p.aangemaakt || new Date().toISOString();
  let n = 0;
  for (const [key, v] of Object.entries(p.vakken)) {
    if (v.gebeurtenissen) continue;
    v.gebeurtenissen = [];
    const st = v.status || 'concept';
    if (st !== 'concept') v.gebeurtenissen.push({ t: v.uitgezetOp || basis, soort: 'uitgezet', info: 'overgenomen uit v2' });
    if (['ontvangen', 'gecontroleerd', 'akkoord'].includes(st)) v.gebeurtenissen.push({ t: v.ontvangenOp || basis, soort: 'retour', info: 'overgenomen uit v2' });
    if (st === 'akkoord') v.gebeurtenissen.push({ t: v.ontvangenOp || basis, soort: 'goedgekeurd', info: 'overgenomen uit v2' });
    v.gebeurtenissen.sort((a, b) => a.t.localeCompare(b.t));
    delete v.status; n++;
  }
  p.versie = 3;
  p.log.unshift({ t: new Date().toISOString(), tekst: `Project omgezet naar v3: statussen van ${n} vakken afgeleid uit de oude stand` });
}

