// Three typography fixes from the review of the DM Sans change:
//  1. DM Sans has no tabular figures, so numbers are lined up by a
//     digits-only face, 'DM Sans Figures' (fonts/README.md). The shipped files
//     are read here: each maps exactly 0-9, and all ten share one advance.
//  2. The Overview's rate rows share one line box in rem, so the value, label
//     and count keep one baseline and still grow with enlarged text.
//  3. The FDA dot plot gets more height whenever race's value drops below its
//     dot, which is when each row carries labels above and below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const css = readFileSync(new URL('styles.css', root), 'utf8');
const app = readFileSync(new URL('app.js', root), 'utf8');

// WOFF2 (W3C WOFF File Format 2.0, section 5): a 48-byte header, a table
// directory of variable-length entries, then one Brotli stream holding the
// tables in directory order.
const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
function woff2Tables(buf) {
  assert.equal(buf.toString('latin1', 0, 4), 'wOF2', 'not a WOFF2 file');
  const numTables = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  let off = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[off++];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('bad UIntBase128');
  };
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[off++];
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) { tag = buf.toString('latin1', off, off + 4); off += 4; }
    const version = flags >> 6;
    const origLength = base128();
    const transformed = (tag === 'glyf' || tag === 'loca') ? version === 0 : version !== 0;
    const length = transformed ? base128() : origLength;
    dir.push({ tag, length, transformed });
  }
  const data = brotliDecompressSync(buf.subarray(off, off + compressed));
  const tables = {};
  let at = 0;
  for (const t of dir) { tables[t.tag] = { ...t, data: data.subarray(at, at + t.length) }; at += t.length; }
  return tables;
}

function cmapCodepoints(cmap) {
  const n = cmap.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8), encoding = cmap.readUInt16BE(6 + i * 8);
    const sub = cmap.subarray(cmap.readUInt32BE(8 + i * 8));
    if (!(platform === 3 && encoding === 1) || sub.readUInt16BE(0) !== 4) continue;
    const segs = sub.readUInt16BE(6) / 2;
    const map = new Map();
    for (let s = 0; s < segs; s++) {
      const end = sub.readUInt16BE(14 + s * 2), start = sub.readUInt16BE(16 + segs * 2 + s * 2);
      const delta = sub.readInt16BE(16 + segs * 4 + s * 2), rangeAt = 16 + segs * 6 + s * 2;
      const range = sub.readUInt16BE(rangeAt);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        const gid = range === 0 ? (c + delta) & 0xffff : sub.readUInt16BE(rangeAt + range + (c - start) * 2);
        if (gid) map.set(c, gid);
      }
    }
    return map;
  }
  throw new Error('no Windows Unicode BMP (3,1) format 4 cmap');
}

const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1])
  .filter((body) => /font-family:\s*'DM Sans Figures'/.test(body));

test('the figures face covers the four weights the page loads, digits only, from relative paths', () => {
  const weights = faces.map((body) => Number(body.match(/font-weight:\s*(\d+)/)[1])).sort();
  assert.deepEqual(weights, [400, 500, 600, 700]);
  for (const body of faces) {
    assert.match(body, /unicode-range:\s*U\+0030-0039\s*;/, 'the face must cover the digits and nothing else');
    const src = body.match(/url\('([^']+)'\)/)[1];
    assert.ok(!src.startsWith('/') && !/^https?:/.test(src), `${src} must resolve relative to the stylesheet`);
    assert.ok(existsSync(new URL(src, root)), `${src} is missing`);
  }
  assert.ok(existsSync(new URL('fonts/OFL.txt', root)), 'the DM Sans licence ships with the derived files');
});

test('every shipped figures file maps exactly 0-9, all on one advance', () => {
  for (const body of faces) {
    const src = body.match(/url\('([^']+)'\)/)[1];
    const t = woff2Tables(readFileSync(new URL(src, root)));
    assert.ok(!t.hmtx.transformed, `${src}: hmtx is stored transformed; this check reads it plain`);
    assert.equal(t.hhea.data.readUInt16BE(0), 1, `${src}: hhea did not decode`);
    const cps = cmapCodepoints(t.cmap.data);
    assert.deepEqual([...cps.keys()].sort((a, b) => a - b), [...'0123456789'].map((c) => c.charCodeAt(0)), src);
    const nhm = t.hhea.data.readUInt16BE(34);
    const advance = (gid) => t.hmtx.data.readUInt16BE(Math.min(gid, nhm - 1) * 4);
    const advances = new Set([...cps.values()].map(advance));
    assert.equal(advances.size, 1, `${src}: digits have advances ${[...advances].join(', ')}`);
  }
});

test('the shared sans stack puts the figures ahead of DM Sans', () => {
  assert.match(css, /--font-sans:\s*'DM Sans Figures',\s*'DM Sans',/);
});

test('the Overview rate cells share one rem line box and rem baseline offsets', () => {
  const cell = css.match(/#overview \.overview-rates > \* \{([^}]*)\}/)[1];
  assert.match(cell, /line-height:\s*[\d.]+rem/, 'a line-height relative to each cell\'s own size splits the baselines');
  assert.match(cell, /padding:\s*[\d.]+rem 0/);
  const offsets = css.match(/#overview \.overview-rates \.rate-label,\s*#overview \.overview-rates \.rate-group,\s*#overview \.overview-rates \.rate-count \{([^}]*)\}/);
  assert.ok(offsets, 'label, group and count are set down together');
  assert.match(offsets[1], /padding-top:\s*[\d.]+rem/);
});

test('the FDA plot is taller whenever its labels split above and below the dots', () => {
  assert.match(css, /\.fda-reporting-canvas\.fda-split-labels \{ min-height: 440px; \}/);
  const fn = app.slice(app.indexOf('function renderFdaOversight('), app.indexOf('function renderGeographyDashboard('));
  assert.match(fn, /const narrow = \(chart\) => isMobileDevice \|\| chart\.width < 640;/);
  assert.match(fn, /classList\.toggle\('fda-split-labels', narrow\(\{ width \}\)\)/, 'the class follows the labels\' own test');
  assert.match(fn, /splitLabels\(fdaWrap \? fdaWrap\.clientWidth : 0\);\s*\n\s*charts\.fdaReporting = new Chart/, 'set before the chart first sizes itself');
  assert.match(fn, /onResize: \(chart, size\) => splitLabels\(size\.width\)/, 'and again on every resize');
  // The label rule the height is sized for: race below its dot when narrow.
  assert.match(fn, /align: \(c\) => \(narrow\(c\.chart\) && c\.datasetIndex === 1 \? 'bottom' : 'top'\)/);
});
