/**
 * Study details on demand: the reader app.js keeps for the dataset on screen
 * (tests/record_contract.json's layout section, app.js "Study details on
 * demand").
 *
 * The reader block, loadData and the views that read studies_tab and detail
 * fields are evaluated in a vm with a stub document and a stub fetch that
 * serves in-memory gzip files (tests/split_fixture.mjs), through app.js's own
 * fetchAndDecompress. Requests can be held and answered later, so a dataset
 * switch can be played in the middle of a load. Nothing binary is committed.
 *
 * What is pinned: an inline dataset fetches nothing more and renders as it
 * always has; a split dataset fetches its Studies-tab extras once, all or
 * nothing, and one shard per study, from its own folder; files from another
 * run are refetched once past the cache and otherwise never merged; a late
 * answer fills the dataset it was started for and never draws over another;
 * pending, failed and not-included views never show a value the record does
 * not have; and the phone and archive views say what they do not carry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { contract, dataset, fullRecord, gz } from './split_fixture.mjs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function slice(startMarker, endMarker) {
    const at = app.indexOf(startMarker);
    assert.ok(at >= 0, `app.js lost ${startMarker}`);
    const end = app.indexOf(endMarker, at);
    assert.ok(end > at, `could not find the end of ${startMarker}`);
    return app.slice(at, end + endMarker.length);
}
const fnSource = (sig) => slice(sig, '\n}\n');

const READER = slice('// ── Study details on demand', '// ── end study details on demand');
const SOURCES = [
    READER,
    slice('const NUM_PARTS =', '\n'),
    fnSource('function partFiles(n)'),
    fnSource('function datasetBase(key)'),
    fnSource('function getUrlStrategies(date)'),
    fnSource('async function fetchAndDecompress(url, onProgress, init)'),
    fnSource('function formatLoadMB(bytes)'),
    fnSource('function describePartsProgress(loaded, totals, finished)'),
    fnSource('function partsFromDifferentRuns(parts)'),
    fnSource('function stalePartIndexes(parts, expectedStamp)'),
    fnSource('async function refetchStaleParts(parts, expectedStamp, refetch)'),
    fnSource('async function loadData(date)'),
    fnSource('function setDataPulledDate(iso)'),
    fnSource('function pubLabel(ref, index)'),
    fnSource('function renderPublications(study, tab = READY)'),
    fnSource('function showPublications(nctId)'),
    fnSource('function publicationsHtml(study, tab, redraw)'),
    fnSource('function prepareStudiesTab()'),
    fnSource('function refreshStudiesTab()'),
    fnSource('function renderStudiesTable()'),
    fnSource('function renderFdaCell(value, tooltipText)'),
    fnSource('function renderDemographicCell(study, field, tab = READY)'),
    fnSource('function studyHasGeography(study)'),
    fnSource('function renderGeographyCell(study)'),
    fnSource('function showGeographyBreakdown(nctId)'),
    fnSource('function showBreakdown(nctId, categoryName)'),
    fnSource('function breakdownHtml(study, categoryName, tab)'),
    fnSource('function breakdownCountsHtml(study, categoryName, tab)'),
    fnSource('function formatOmbCategory(ombCat)'),
    fnSource('function closeBreakdown()'),
    fnSource('function deriveFundingSource(study)'),
    fnSource('function formatGenderDisplay(study)'),
    fnSource('function getStudyPediatricStatus(study)'),
    fnSource("function renderPublicationsDetail(study, tab = READY, retry = '')"),
    fnSource('function showStudyDetails(nctId)'),
    fnSource('function studyDetailsHtml(fullStudy, states)'),
    fnSource("function renderStudySites(study, detail = READY, retry = '')"),
    fnSource('function closeStudyDetails()')
].join('\n');

// What the dashboard around these functions provides, reduced to what they
// call. The table's own filters, sort cells and pagination are not under test.
const SCAFFOLD = `
let data = null; let datasetReader = null; let dashboardSummary = null; let studiesTabReady = false;
let currentPage = 0; let studiesPageSize = 15; let currentSort = { field: null, direction: 'asc' };
let tableRenders = 0;
const snapshotCache = new Map();
function getFilteredData() { tableRenders++; return data ? [...data] : []; }
function initColumnPicker() {}
function renderReportedCell() { return ''; }
function renderSparkline() { return ''; }
function getTimeToReport() { return null; }
function renderPagination() {}
function fixTableScroll() {}
function sgActive() { return false; }
function sgShowBreakdown() {}
function sgDemographicCell() { return ''; }
function escapeHtml(text) { return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
// keyedFetch's own behaviour is tests/data_cache_key.test.mjs's; here it adds the key.
async function keyedFetch(path, init) { return fetch(\`\${path}?v=\${DATA_CACHE_VERSION}\`, init); }
`;

const T = { timeout: 20000 };
const STAMP = '2026-10-11T06:00:00+00:00';
const NEWER = '2026-10-18T06:00:00+00:00';
const OLDER = '2026-10-04T12:09:21.454200+00:00';

// The markup of the element whose opening tag `open` (a match of
// /<(tag)\b[^>]*>/) found, to its own closing tag, nested tags of its name
// counted.
function wholeElement(markup, open) {
    const tags = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, 'g');
    tags.lastIndex = open.index;
    let depth = 0;
    for (let t; (t = tags.exec(markup));) {
        depth += t[1] ? -1 : 1;
        if (!depth) return markup.slice(open.index, t.index + t[0].length);
    }
    return markup.slice(open.index);
}

// The first element a simple selector ('.cls', '[attr="v"]', or a list of
// them) picks out of a piece of markup, as its own markup, or null.
function pick(markup, selector) {
    const quote = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const sel of selector.split(',').map((x) => x.trim())) {
        const attr = /^\[([a-z-]+)="([^"]*)"\]$/.exec(sel);
        const cls = /^\.([\w-]+)$/.exec(sel);
        if (!attr && !cls) throw new Error(`the stub document cannot read the selector ${sel}`);
        const open = attr ? new RegExp(`<([a-z0-9]+)\\b[^>]*\\s${attr[1]}="${quote(attr[2])}"[^>]*>`)
            : new RegExp(`<([a-z0-9]+)\\b[^>]*\\sclass="(?:[^"]*\\s)?${quote(cls[1])}(?:\\s[^"]*)?"[^>]*>`);
        const m = open.exec(markup);
        if (m) return wholeElement(markup, m);
    }
    return null;
}

/**
 * A stub element. doc is the stub document whose activeElement focus() sets.
 * markup is null for an element whose children the tests do not model (each
 * querySelector answers with a child of its own); otherwise it is the
 * element's markup (an overlay and what it holds): querySelector then finds
 * only what the markup holds, getAttribute reads the element's own tag, and
 * writing innerHTML replaces the children, so focus on one of them falls to
 * the page, as in a browser. Hiding a focused element does the same.
 */
function element(id, doc, markup = null) {
    let kids = {};
    let html = markup ?? '';
    let hidden = false;
    const classes = new Set();
    const el = {
        id, textContent: '', value: '', style: {}, dataset: {}, attrs: {}, firstElementChild: null, scrollTop: 0,
        // Hiding the element that has focus, or one it is in, sends focus to
        // the page at once (Chrome's focus fixup, which fires no blur).
        get hidden() { return hidden; },
        set hidden(value) {
            hidden = !!value;
            if (hidden && el.contains(doc.activeElement)) doc.activeElement = doc.body;
        },
        get innerHTML() { return html; },
        set innerHTML(value) {
            const lost = doc.activeElement !== el && el.contains(doc.activeElement);
            html = String(value);
            if (markup === null) return;
            kids = {};
            const first = /<([a-z0-9]+)\b[^>]*>/.exec(html);
            el.firstElementChild = first ? element(`${id} >`, doc, wholeElement(html, first)) : null;
            if (lost) doc.activeElement = doc.body;
        },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) {
            if (markup === null) return k in this.attrs ? this.attrs[k] : null;
            const m = new RegExp(`^\\s*<[a-z0-9]+\\b[^>]*\\s${k}="([^"]*)"`).exec(html);
            return m ? m[1] : null;
        },
        classList: {
            add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
            toggle(c, on) { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); }
        },
        querySelector(sel) {
            if (kids[sel]) return kids[sel];
            if (markup === null) return (kids[sel] = element(sel, doc));
            const found = pick(html, sel);
            return found === null ? null : (kids[sel] = element(sel, doc, found));
        },
        querySelectorAll() { return []; },
        contains(x) { return !!x && (x === el || Object.values(kids).some((k) => k.contains(x)) || (!!el.firstElementChild && el.firstElementChild.contains(x))); },
        focus() { doc.activeElement = el; }
    };
    return el;
}

/**
 * files: { path: body } served to fetch (gzipped); a body that is an Error is
 * a network failure, a missing path a 404. again: what a cache: 'reload'
 * request gets instead, by path. hold: answer nothing until release().
 */
function harness({ files = {}, again = {}, mobile = false, history = null, summary = null, studiesTab = true, decompression = true } = {}) {
    const requests = [];
    const served = { ...files };
    const reloaded = { ...again };
    let holding = false;
    const held = [];
    const els = {};
    const doc = {
        getElementById: (id) => el(id),
        querySelector: (sel) => (sel === '.tab[data-tab="studies"]' ? tab : null),
        querySelectorAll: () => [],
        activeElement: null, body: null
    };
    doc.body = element('body', doc);
    doc.activeElement = doc.body;
    const el = (id) => els[id] || (els[id] = element(id, doc, /overlay$/.test(id) ? '' : null));
    const tab = element('tab-studies', doc);
    if (studiesTab) tab.classList.add('active');
    let reloads = 0;
    const answer = (path, cache) => {
        const body = cache === 'reload' && path in reloaded ? reloaded[path] : served[path];
        if (body === undefined) return new Response('', { status: 404 });
        if (body instanceof Error) throw body;
        const bytes = path.endsWith('.gz') ? gz(body) : Buffer.from(JSON.stringify(body));
        return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        Response, TransformStream, DecompressionStream, Uint8Array,
        setTimeout, clearTimeout,
        requestAnimationFrame: (fn) => { setImmediate(fn); return 1; },
        cancelAnimationFrame() {},
        DATA_CACHE_VERSION: 'test', LATEST_RUN_STAMP: null, SMALL_FILE_WAIT_MS: 50,
        hasDecompressionStream: decompression,
        ensurePako: async () => {},
        pako: { inflate: (bytes) => gunzipSync(Buffer.from(bytes)).toString('utf8') },
        isMobileDevice: mobile,
        window: {},
        location: { reload() { reloads++; } },
        document: doc,
        updateLoadingProgress() {},
        showToast() {},
        fetchLatestSummary: async () => summary,
        fetchHistory: async () => history,
        fetch: (url, init) => {
            const path = url.replace(/\?v=.*$/, '');
            const cache = init && init.cache;
            requests.push({ url, path, cache });
            if (holding) return new Promise((resolve, reject) => held.push({ path, go: () => { try { resolve(answer(path, cache)); } catch (e) { reject(e); } } }));
            return Promise.resolve().then(() => answer(path, cache));
        }
    });
    vm.runInContext(SCAFFOLD + SOURCES, context);
    // Count the file reads in flight (app.js's fetchAndDecompress, wrapped in
    // place), so flush() waits for the real gunzip and parse to finish rather
    // than for a fixed number of turns of the event loop, which a busy machine
    // can outrun.
    vm.runInContext(`globalThis.__reads = 0;
        { const read = fetchAndDecompress;
          fetchAndDecompress = function (...args) {
              __reads++;
              const p = read.apply(this, args);
              p.then(() => { __reads--; }, () => { __reads--; });
              return p;
          }; }`, context);
    const run = (src) => vm.runInContext(src, context);
    const json = (src) => JSON.parse(vm.runInContext(`JSON.stringify(${src})`, context));
    // Settle everything that is not held: every read that can finish has
    // finished, and the redraws it set off have run. A held request is a read
    // that cannot finish until release().
    const heldReads = () => held.filter((x) => x.path.endsWith('.gz')).length;
    const turns = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
    const flush = async () => {
        for (let round = 0; round < 2000; round++) {
            await turns(30);
            if (context.__reads <= heldReads()) {
                await turns(30);
                if (context.__reads <= heldReads()) return;
            }
            await new Promise((r) => setTimeout(r, 2));
        }
        throw new Error(`flush: ${context.__reads} file reads still in flight`);
    };
    return {
        run, json, flush, els, el, tab, doc, requests, served, reloaded,
        paths: () => requests.map((r) => r.path),
        reloads: () => reloads,
        hold() { holding = true; },
        // Answer the held requests whose path passes `which` (all by default).
        async release(which = () => true) {
            holding = false;
            for (const h of held.splice(0).filter((x) => { if (which(x.path)) return true; held.push(x); return false; })) h.go();
            if (held.length) holding = true;
            await flush();
        },
        overlay: (id = 'study-details-overlay') => el(id).innerHTML,
        status: () => ({
            hidden: el('studies-extras-status').hidden,
            text: el('studies-extras-status').querySelector('.extras-status-text').textContent,
            bytes: el('studies-extras-status').querySelector('.extras-status-bytes').textContent,
            action: el('studies-extras-status').querySelector('.extras-status-action').hidden ? null
                : el('studies-extras-status').querySelector('.extras-status-action').textContent,
            meter: el('studies-extras-status').querySelector('.loading-meter')
        })
    };
}

// Eight parts (app.js fetches NUM_PARTS), two studies in each, over 4 detail
// shards: IDS[0], IDS[1] and IDS[2] are in shards 0, 3 and 2, and every
// fourth id shares a shard (shard4).
const IDS = Array.from({ length: 16 }, (_, i) => `NCT0${String(1000000 + i * 3).padStart(7, '0')}`);
const RECORDS = IDS.map((id) => fullRecord(id));
const shard4 = (id) => Number(id.slice(3)) % 4;
const split = (opts = {}) => dataset(RECORDS, { parts: 8, shards: 4, stamp: STAMP, commit: 'abc1234', ...opts });
const inline = (opts = {}) => dataset(RECORDS, { parts: 8, layout: false, stamp: STAMP, commit: 'abc1234', ...opts });
const withFile = (files, path, edit) => ({ ...files, [path]: edit(structuredClone(files[path])) });

// Text that states a value a pending, failed or not-included view does not have.
const CLAIMS = [
    'No publications linked', 'Location data not available', 'Facility not specified',
    'Healthy Volunteers:</strong> No', 'Funding Source:</strong> <span class="badge">Other',
    'Allocation:</strong> N/A', 'Last Update:</strong> N/A', 'Status:</strong> N/A', 'Not Reported</span>',
    'Population:</strong> Not Specified'
];
const claims = (text) => CLAIMS.filter((c) => text.includes(c));

test('the shard rule gives the layout test vectors, and nothing for a malformed id', () => {
    const h = harness();
    assert.ok(contract.layout.detail.vectors.length >= 6);
    for (const { nct_id: id, shards, shard } of contract.layout.detail.vectors) {
        assert.equal(h.run(`shardOf('${id}', ${shards})`), shard, `${id} at ${shards} shards`);
    }
    assert.equal(h.run("shardOf('NCT01174160', 256)"), 144);
    assert.equal(h.run("shardOf('NCT01174160', 128)"), 16, 'the vectors cannot tell 128 shards from 256');
    assert.equal(h.run("shardOf('NCT', 256)"), null);
    assert.equal(h.run("shardOf('01975376', 256)"), null);
});

test('the reader reads the layout the contract describes', () => {
    const h = harness();
    assert.equal(h.run('LAYOUT_VERSION'), contract.layout.version);
    assert.equal(h.run('LAYOUT_SHARD_KEY'), contract.layout.detail.key);
    assert.equal(typeof contract.layout.enabled, 'boolean', 'layout.enabled is the owner switch the engine reads');
    // The file names app.js builds are the contract's patterns.
    h.run(`globalThis.r = makeReader({ mode: 'split', base: 'snapshots/2026-10-18', layout: { version: 1, studies_tab: { files: 3 }, detail: { shards: 256, key: 'nct_number_mod' } } });`);
    const urls = h.json('extrasFiles(r).map(f => f.url)');
    assert.deepEqual(urls, [1, 2, 3].map((k) => `snapshots/2026-10-18/${contract.layout.files.studies_tab.replace('{K}', k)}`));
    assert.deepEqual(h.json("[1, 2].map(k => partFiles(2)[k - 1])"), [1, 2].map((k) => contract.layout.files.core.replace('{K}', k)));
    assert.match(READER, /`\$\{r\.base\}\/detail\/\$\{n\}\.json\.gz`/, 'the shard path is not detail/{n}.json.gz under the dataset folder');
    assert.equal(contract.layout.files.detail, 'detail/{n}.json.gz');
});

test('mergeStudy lays the extras over the record one level deep for the demographics, and replaces the rest', () => {
    const h = harness();
    h.run(`globalThis.core = { nct_id: 'NCT00000001', race: { reported: true, omb_totals: { white: 3 } }, sex: { reported: true, totals: { female: 2 } },
        study_sites: [{ country: 'Canada' }], ethnicity: { reported: false } };`);
    h.run(`globalThis.tab = { race: { raw_categories: [{ omb_category: 'white' }] }, sex: { raw_categories: [] }, ethnicity: null };`);
    h.run(`globalThis.detail = { study_sites: [{ facility: 'A', country: 'Canada' }, { facility: 'B', country: 'Peru' }], allocation: 'RANDOMIZED' };`);
    const merged = h.json('mergeStudy(core, tab, detail)');
    assert.deepEqual(merged.race, { reported: true, omb_totals: { white: 3 }, raw_categories: [{ omb_category: 'white' }] }, 'race lost its core fields');
    assert.deepEqual(merged.sex, { reported: true, totals: { female: 2 }, raw_categories: [] });
    assert.deepEqual(merged.ethnicity, { reported: false }, 'a null dimension in the extras erased the core one');
    assert.equal(merged.study_sites.length, 2, "the shard's whole sites list did not replace the core's");
    assert.equal(merged.allocation, 'RANDOMIZED');
    assert.deepEqual(h.json('core.race'), { reported: true, omb_totals: { white: 3 } }, 'the record itself was changed');
    assert.equal(h.json('core.study_sites').length, 1);
});

test('an inline dataset fetches nothing beyond its parts, and every view renders from its records', T, async () => {
    const h = harness({ files: inline() });
    await h.run('loadData()');
    assert.equal(h.run('datasetReader.mode'), 'inline');
    assert.equal(h.requests.length, 8);
    h.run('prepareStudiesTab()');
    h.run(`showStudyDetails('${IDS[0]}')`);
    const modal = h.overlay();
    h.run(`showBreakdown('${IDS[0]}', 'race')`);
    const breakdown = h.overlay('breakdown-overlay');
    h.run(`showGeographyBreakdown('${IDS[0]}')`);
    const sites = h.overlay('breakdown-overlay');
    await h.flush();
    assert.equal(h.requests.length, 8, `an inline dataset made requests: ${h.paths().slice(8).join(', ')}`);
    assert.equal(h.status().hidden, true, 'an inline dataset showed the status row');
    for (const text of [modal, breakdown, sites]) assert.doesNotMatch(text, /detail-state|loading-meter|not included/i);
    for (const needle of ['<strong>Allocation:</strong> RANDOMIZED', 'Masked: Participants, Investigators', 'Design Description:</strong> Two parallel arms',
        'Time Frame: 12 weeks', 'Secondary Outcomes (1)', '<strong>Healthy Volunteers:</strong> No', 'Lead Sponsor:</strong> Harbor University',
        'Funding Source:</strong> <span class="badge">NIH</span>', 'National Heart, Lung, and Blood Institute', '<strong>Status:</strong> TERMINATED',
        'Last Update:</strong> 2024-06-01', 'Why Stopped:</strong> Slow accrual', 'Publications (1)', 'Study Sites (2 total)', 'Harbor Clinic']) {
        assert.ok(modal.includes(needle), `the inline pop-up lost ${needle}`);
    }
    assert.match(breakdown, /<th>Original Label<\/th>/);
    assert.match(breakdown, /Caucasian/);
    assert.match(breakdown, /Quarantined Labels/);
    assert.match(sites, /Lakeside Hospital/);
    // The table: the publications cell lists the reference at once.
    assert.match(h.el('studies-table-body').innerHTML, /Doe J\. A randomized trial|A randomized trial/);
    assert.doesNotMatch(h.el('studies-table-body').innerHTML, /cell-pending/);
    // An inline record with none says so, as it always has.
    h.run(`data[1].references = []; data[1].study_sites = []; data[1].countries = [];`);
    h.run(`showStudyDetails('${IDS[1]}')`);
    assert.match(h.overlay(), /No publications linked to this study\./);
    assert.match(h.overlay(), /Location data not available for this study\./);
});

test('a split Studies tab draws at once, fetches its extras once, and fills the page in place when they land', T, async () => {
    const h = harness({ files: split() });
    await h.run('loadData()');
    assert.equal(h.run('datasetReader.mode'), 'split');
    assert.equal(h.requests.length, 8, 'the startup load fetched more than the core parts');
    h.hold();
    h.run('studiesPageSize = 4; prepareStudiesTab()');
    // The table is there before any extra has arrived.
    const before = h.el('studies-table-body').innerHTML;
    assert.match(before, new RegExp(IDS[0]));
    assert.match(before, /class="cell-pending" role="img" aria-label="Loading publications"/, 'a waiting publications cell is not marked pending');
    assert.doesNotMatch(before, /<td class="col-publications"><span class="text-muted">-<\/span>/, "a waiting publications cell shows the '-' of none");
    assert.match(before, /Category labels are loading/);
    const status = h.status();
    assert.equal(status.hidden, false);
    assert.equal(status.text, 'Loading publications and category labels');
    assert.equal(status.meter.hidden, false);
    // More callers join the same load.
    h.run('prepareStudiesTab(); loadStudiesTabExtras(datasetReader); loadStudiesTabExtras(datasetReader);');
    const pack = h.paths().filter((p) => p.includes('studies_tab.part'));
    assert.deepEqual(pack, Array.from({ length: 8 }, (_, i) => `data/studies_tab.part${i + 1}.json.gz`), 'the extras were not fetched once each');
    h.run('currentPage = 2;');
    const renders = h.run('tableRenders');
    await h.release();
    assert.equal(h.run('datasetReader.extras.state'), 'loaded');
    assert.ok(h.run('tableRenders') > renders, 'the open tab was not redrawn when the extras landed');
    assert.equal(h.run('currentPage'), 2, 'the redraw sent the reader back to the first page');
    const after = h.el('studies-table-body').innerHTML;
    assert.doesNotMatch(after, /cell-pending/);
    assert.match(after, /Raw data: ✓ &quot;Caucasian&quot;|Raw data: ✓ "Caucasian"/);
    h.run('studiesPageSize = 15; currentPage = 0; renderStudiesTable()');
    assert.match(h.el('studies-table-body').innerHTML, /A randomized trial/);
    assert.equal(h.status().hidden, true, 'the status row stayed after the extras loaded');
    assert.equal(h.paths().filter((p) => p.includes('/detail/')).length, 0, 'the tab fetched detail shards');
});

test('the status row shows the bytes summed over the parts on a determinate meter', T, async () => {
    const h = harness({ files: split() });
    await h.run('loadData()');
    h.hold();
    h.run('prepareStudiesTab()');
    h.run(`(() => { const x = datasetReader.extras; x.loaded = x.loaded.map(() => 1.2e6); x.totals = x.totals.map(() => 3.1e6); renderExtrasStatus(); })()`);
    const s = h.status();
    assert.equal(s.text, 'Loading publications and category labels');
    assert.equal(s.bytes, ' · 9.6 of 24.8 MB');
    assert.equal(s.meter.attrs['aria-valuenow'], '39');
    assert.equal(h.el('studies-extras-status').querySelector('.loading-progress-bar').style.width, '39%');
    assert.match(html, /<div id="studies-extras-status" class="extras-status" hidden>\s*<div class="loading-meter" role="progressbar"[^>]*aria-valuemin="0" aria-valuemax="100"/,
        'the status row lost its determinate hairline');
    await h.release();
});

test("a split pop-up opens at once with the hairline meter and redraws when its study's shard lands", T, async () => {
    const h = harness({ files: split() });
    await h.run('loadData()');
    h.hold();
    h.run(`showStudyDetails('${IDS[2]}')`);
    const pending = h.overlay();
    assert.equal(h.el('study-details-overlay').style.display, 'flex', 'the pop-up waited for its shard to open');
    assert.match(pending, /<div class="loading-meter is-indeterminate" role="progressbar" aria-label="Loading sites">/);
    assert.match(pending, /aria-busy="true"/);
    for (const needle of ['<strong>Type:</strong> INTERVENTIONAL', '<strong>Phase:</strong> PHASE2', '<strong>Masking:</strong> DOUBLE', 'Change in FEV1', '<strong>Healthy Volunteers:</strong> No']) {
        assert.ok(pending.includes(needle), `the core field ${needle} waited for the shard`);
    }
    assert.deepEqual(claims(pending).filter((c) => c !== 'Healthy Volunteers:</strong> No'), [], 'the pending pop-up stated values it does not have');
    assert.doesNotMatch(pending, /Funding Source/, 'the funding source was worked out before the collaborators were known');
    assert.doesNotMatch(pending, /spin|shimmer/i);
    const n = shard4(IDS[2]);
    // Two more pop-ups for studies of the same shard, and the geography one.
    h.run(`showStudyDetails('${IDS[2]}'); showGeographyBreakdown('${IDS[2]}')`);
    assert.deepEqual(h.paths().filter((p) => p.includes('/detail/')), [`data/detail/${n}.json.gz`], 'concurrent pop-ups fetched the shard more than once');
    await h.release();
    const ready = h.overlay('breakdown-overlay');
    assert.match(ready, /Lakeside Hospital/);
    h.run(`showStudyDetails('${IDS[2]}')`);
    await h.flush();
    const full = h.overlay();
    assert.doesNotMatch(full, /loading-meter/);
    for (const needle of ['<strong>Allocation:</strong> RANDOMIZED', 'Funding Source:</strong> <span class="badge">NIH</span>',
        'Study Sites (2 total)', 'Harbor Clinic', '<strong>Status:</strong> TERMINATED', 'Why Stopped:</strong> Slow accrual', 'Publications (1)']) {
        assert.ok(full.includes(needle), `the loaded pop-up lost ${needle}`);
    }
    assert.equal(h.paths().filter((p) => p.includes('/detail/')).length, 1, 'a loaded shard was fetched again');
});

test("a snapshot's extras and shards come from its own folder", T, async () => {
    const h = harness({ files: split({ base: 'snapshots/2026-10-18' }) });
    await h.run("loadData('2026-10-18')");
    assert.equal(h.run('datasetReader.base'), 'snapshots/2026-10-18');
    h.run('prepareStudiesTab()');
    h.run(`showStudyDetails('${IDS[0]}')`);
    await h.flush();
    const sidecars = h.paths().slice(8);
    assert.ok(sidecars.length > 0);
    for (const p of sidecars) assert.match(p, /^snapshots\/2026-10-18\/(studies_tab\.part\d\.json\.gz|detail\/\d+\.json\.gz)$/, `${p} is not in the snapshot's folder`);
    assert.match(h.overlay(), /Harbor Clinic/);
});

test('a file from another run is fetched once more past the cache, and used only if the second copy belongs', T, async () => {
    const n = shard4(IDS[0]);
    const path = `data/detail/${n}.json.gz`;
    const files = split();
    // A newer run's shard, twice: the long-open tab after a weekly publish (16a).
    const newer = harness({ files: withFile(files, path, (b) => ({ ...b, extracted_at: NEWER })) });
    await newer.run('loadData()');
    newer.run(`showStudyDetails('${IDS[0]}')`);
    await newer.flush();
    assert.deepEqual(newer.requests.filter((r) => r.path === path).map((r) => r.cache), [undefined, 'reload']);
    const shown = newer.overlay();
    assert.match(shown, /The data was updated since this page loaded\. <button type="button" class="detail-action" onclick="location\.reload\(\)" data-state="sites">Reload<\/button>/);
    assert.doesNotMatch(shown, /Allocation:|Harbor Clinic|Funding Source/, "another run's details were merged");
    // An earlier run's copy (a CDN mid-deploy): try again later.
    const older = harness({ files: withFile(files, path, (b) => ({ ...b, extracted_at: OLDER })) });
    await older.run('loadData()');
    older.run(`showStudyDetails('${IDS[0]}')`);
    await older.flush();
    assert.match(older.overlay(), /did not load: the server is still updating them\. Try again in a few minutes\./);
    assert.match(older.overlay(), /onclick="showStudyDetails\('NCT/);
    assert.doesNotMatch(older.overlay(), /Allocation:|Harbor Clinic/);
    // Another commit with the same stamp is another run too.
    const commit = harness({ files: withFile(files, path, (b) => ({ ...b, pipeline_commit: 'fff9999' })) });
    await commit.run('loadData()');
    commit.run(`showStudyDetails('${IDS[0]}')`);
    await commit.flush();
    assert.doesNotMatch(commit.overlay(), /Harbor Clinic/);
    // A stale first answer and a right second one: used.
    const fixed = harness({ files: withFile(files, path, (b) => ({ ...b, extracted_at: OLDER })), again: { [path]: files[path] } });
    await fixed.run('loadData()');
    fixed.run(`showStudyDetails('${IDS[0]}')`);
    await fixed.flush();
    assert.deepEqual(fixed.requests.filter((r) => r.path === path).map((r) => r.cache), [undefined, 'reload']);
    assert.match(fixed.overlay(), /Harbor Clinic/);
});

test('the Studies-tab extras are all or nothing: one part from another run, and none is used', T, async () => {
    const files = withFile(split(), 'data/studies_tab.part3.json.gz', (b) => ({ ...b, extracted_at: NEWER }));
    const h = harness({ files });
    await h.run('loadData()');
    h.run('prepareStudiesTab()');
    await h.flush();
    assert.equal(h.run('datasetReader.extras.state'), 'failed');
    assert.equal(h.run('datasetReader.extras.map'), null, 'parts that did load were merged');
    assert.deepEqual(h.requests.filter((r) => r.path.endsWith('part3.json.gz') && r.path.includes('studies_tab')).map((r) => r.cache), [undefined, 'reload']);
    const s = h.status();
    assert.equal(s.text, 'The data was updated since this page loaded.');
    assert.equal(s.action, 'Reload');
    h.run('studiesExtrasAction()');
    assert.equal(h.reloads(), 1, 'Reload did not reload the page');
    const body = h.el('studies-table-body').innerHTML;
    assert.match(body, /class="cell-failed"[^>]*>did not load</);
    assert.doesNotMatch(body, /A randomized trial/);
});

test('a newer run on the server is not downloaded again; this run\'s shards are still used', T, async () => {
    const files = split();
    // A Studies-tab part from a newer run: the extras fail, and are not downloaded again.
    const h = harness({ files: withFile(files, 'data/studies_tab.part3.json.gz', (b) => ({ ...b, extracted_at: NEWER })) });
    await h.run('loadData()');
    h.run('prepareStudiesTab()');
    await h.flush();
    assert.equal(h.run('datasetReader.superseded.kind'), 'newer');
    const pack = () => h.paths().filter((p) => p.includes('studies_tab')).length;
    assert.equal(pack(), 9, 'the eight parts, and part 3 once more past the cache');
    h.run('prepareStudiesTab()');   // the tab opened again
    h.run(`showStudyDetails('${IDS[0]}')`);
    await h.flush();
    assert.equal(pack(), 9, 'the extras were downloaded again after a newer run showed up');
    // The study's shard is this run's, and is used; its publications wait for a reload.
    assert.deepEqual(h.paths().filter((p) => p.includes('/detail/')), [`data/detail/${shard4(IDS[0])}.json.gz`]);
    const modal = h.overlay();
    assert.match(modal, /Harbor Clinic/);
    assert.match(modal, /<h5>Publications<\/h5>\s*<p class="detail-state is-failed" data-state="publications" tabindex="-1">The data was updated since this page loaded\. <button type="button" class="detail-action" onclick="location\.reload\(\)" data-state="publications">Reload<\/button>/);
    assert.deepEqual(claims(modal).filter((c) => c !== 'Healthy Volunteers:</strong> No'), []);
    assert.equal(h.status().action, 'Reload');
    // A shard from a newer run: fetched once more past the cache, then not again,
    // and the extras are not started after it.
    const n = shard4(IDS[2]);
    const s = harness({ files: withFile(files, `data/detail/${n}.json.gz`, (b) => ({ ...b, extracted_at: NEWER })) });
    await s.run('loadData()');
    s.run(`showGeographyBreakdown('${IDS[2]}')`);
    await s.flush();
    s.run(`showGeographyBreakdown('${IDS[2]}')`);
    await s.flush();
    assert.deepEqual(s.requests.filter((r) => r.path === `data/detail/${n}.json.gz`).map((r) => r.cache), [undefined, 'reload']);
    assert.match(s.overlay('breakdown-overlay'), /The data was updated since this page loaded\. <button[^>]*>Reload<\/button>/);
    s.run('prepareStudiesTab()');
    await s.flush();
    assert.equal(s.paths().filter((p) => p.includes('studies_tab')).length, 0, 'the extras were downloaded for a dataset a newer run has replaced');
    assert.equal(s.status().text, 'The data was updated since this page loaded.');
    // Another shard of this run still loads.
    s.run(`showGeographyBreakdown('${IDS[0]}')`);
    await s.flush();
    assert.match(s.overlay('breakdown-overlay'), /Harbor Clinic/);
});

test('a file that does not match its header or its studies is not used', T, async () => {
    const n = shard4(IDS[0]);
    const cases = {
        'a shard that says it is another shard': [`data/detail/${n}.json.gz`, (b) => ({ ...b, shard: (n + 1) % 4 })],
        'a shard with another shard count': [`data/detail/${n}.json.gz`, (b) => ({ ...b, shards: 8 })],
        'a shard holding a study of another shard': [`data/detail/${n}.json.gz`, (b) => ({ ...b, data: { ...b.data, NCT09999997: {} } })],
        'a shard with another key': [`data/detail/${n}.json.gz`, (b) => ({ ...b, key: 'nct_fnv' })]
    };
    for (const [name, [path, edit]] of Object.entries(cases)) {
        if (name === 'a shard holding a study of another shard') assert.notEqual(Number('9999997') % 4, n);
        const h = harness({ files: withFile(split(), path, edit) });
        await h.run('loadData()');
        h.run(`showStudyDetails('${IDS[0]}')`);
        await h.flush();
        assert.equal(h.requests.filter((r) => r.path === path).length, 2, `${name}: not fetched again`);
        assert.doesNotMatch(h.overlay(), /Harbor Clinic/, `${name}: it was used`);
        assert.match(h.overlay(), /did not load \(.*\)\. <button/, `${name}: the pop-up does not say it did not load`);
    }
    // A studies_tab part holding other studies than its core part.
    const files = split();
    const h = harness({ files: withFile(files, 'data/studies_tab.part2.json.gz', (b) => ({ ...b, data: files['data/studies_tab.part1.json.gz'].data })) });
    await h.run('loadData()');
    h.run('prepareStudiesTab()');
    await h.flush();
    assert.equal(h.run('datasetReader.extras.state'), 'failed');
    assert.match(h.status().text, /did not load \(studies_tab part 2 does not hold exactly core part 2's studies\)/);
});

test('a study missing from its loaded shard is its own state, not loading and not none', T, async () => {
    const n = shard4(IDS[0]);
    const h = harness({ files: withFile(split(), `data/detail/${n}.json.gz`, (b) => { delete b.data[IDS[0]]; return b; }) });
    await h.run('loadData()');
    h.run(`showStudyDetails('${IDS[0]}')`);
    await h.flush();
    assert.equal(h.json(`classState(datasetReader, 'detail', '${IDS[0]}')`).state, 'missing');
    assert.equal(h.json(`classState(datasetReader, 'detail', '${IDS[1]}')`).state, shard4(IDS[1]) === n ? 'ready' : 'pending');
    const text = h.overlay();
    assert.match(text, /This study's sites are missing from the published files\./);
    assert.doesNotMatch(text, /loading-meter.*Loading sites/);
    assert.deepEqual(claims(text).filter((c) => c !== 'Healthy Volunteers:</strong> No'), []);
});

test('a failed load says so, and the next call tries again', T, async () => {
    const n = shard4(IDS[0]);
    const path = `data/detail/${n}.json.gz`;
    const files = split();
    const h = harness({ files: { ...files, [path]: undefined } });
    await h.run('loadData()');
    h.run(`showStudyDetails('${IDS[0]}')`);
    await h.flush();
    const failed = h.overlay();
    assert.match(failed, /Sites did not load \(HTTP 404\)\. <button type="button" class="detail-action" onclick="showStudyDetails\('NCT/);
    assert.deepEqual(claims(failed).filter((c) => c !== 'Healthy Volunteers:</strong> No'), []);
    h.served[path] = files[path];
    h.run(`showStudyDetails('${IDS[0]}')`);   // what Try again does
    await h.flush();
    assert.equal(h.requests.filter((r) => r.path === path).length, 2);
    assert.match(h.overlay(), /Harbor Clinic/);
    // The Studies-tab extras: a network failure, then Try again.
    const k = harness({ files: { ...files, 'data/studies_tab.part5.json.gz': new TypeError('Failed to fetch') } });
    await k.run('loadData()');
    k.run('prepareStudiesTab()');
    await k.flush();
    assert.equal(k.status().text, 'Publications and category labels did not load (the connection failed).');
    assert.equal(k.status().action, 'Try again');
    k.served['data/studies_tab.part5.json.gz'] = files['data/studies_tab.part5.json.gz'];
    k.run('studiesExtrasAction()');
    assert.match(k.el('studies-table-body').innerHTML, /cell-pending/, 'Try again did not show the table waiting again');
    await k.flush();
    assert.equal(k.run('datasetReader.extras.state'), 'loaded');
    assert.equal(k.status().hidden, true);
});

test('Try again from the keyboard keeps focus, and the scroll position, inside the pop-up', T, async () => {
    // Try again opens the pop-up afresh, which replaced its markup and sent
    // focus to the page behind it.
    const n = shard4(IDS[0]);
    const path = `data/detail/${n}.json.gz`;
    const files = split();
    const h = harness({ files: { ...files, [path]: undefined } });
    await h.run('loadData()');
    h.run(`showStudyDetails('${IDS[0]}')`);
    await h.flush();
    const overlay = h.el('study-details-overlay');
    const line = overlay.querySelector('[data-state="sites"]');
    assert.ok(line, 'the sites line names its section');
    const button = line.querySelector('.detail-action');
    assert.match(button.innerHTML, /Try again/);
    button.focus();
    overlay.firstElementChild.scrollTop = 640;
    h.served[path] = files[path];
    h.hold();
    h.run(`showStudyDetails('${IDS[0]}')`);   // what the button does
    const active = () => h.doc.activeElement;
    assert.notEqual(active(), h.doc.body, 'focus fell to the page behind the pop-up');
    assert.ok(overlay.contains(active()), 'focus left the pop-up');
    assert.equal(active().getAttribute('data-state'), 'sites', 'focus did not stay on the sites line');
    assert.match(active().innerHTML, /Loading sites/);
    assert.equal(overlay.firstElementChild.scrollTop, 640, 'Try again sent the pop-up back to its top');
    await h.release();
    assert.match(h.overlay(), /Harbor Clinic/);
    assert.ok(overlay.contains(active()) && active().innerHTML.includes('closeStudyDetails'), 'focus did not go to the close button once the line was gone');
    // Again after another failure: back on the line's own Try again.
    const b = harness({ files: { ...files, [path]: undefined } });
    await b.run('loadData()');
    b.run(`showBreakdown('${IDS[0]}', 'race'); showGeographyBreakdown('${IDS[0]}')`);
    await b.flush();
    const sites = b.el('breakdown-overlay');
    sites.querySelector('[data-state="sites"]').querySelector('.detail-action').focus();
    b.run(`showGeographyBreakdown('${IDS[0]}')`);
    await b.flush();
    assert.match(b.doc.activeElement.innerHTML, /Try again/, 'focus is not on the new Try again');
    assert.equal(b.doc.activeElement.getAttribute('data-state'), 'sites');
    // The pop-up's first opening does not take focus from the page.
    const c = harness({ files });
    await c.run('loadData()');
    const before = c.doc.activeElement;
    c.run(`showStudyDetails('${IDS[0]}')`);
    assert.equal(c.doc.activeElement, before);
});

test('a pop-up that fills in place does not play its entrance again', T, async () => {
    // .study-details-modal and .breakdown-modal slide up as they open. A
    // redraw puts new markup in the overlay, and the new box would slide up
    // again from transparent: the whole pop-up blinked as its shard landed.
    const h = harness({ files: split() });
    await h.run('loadData()');
    h.hold();
    h.run(`showStudyDetails('${IDS[0]}')`);
    const overlay = h.el('study-details-overlay');
    assert.match(overlay.firstElementChild.innerHTML, /^\s*<div class="study-details-modal">/);
    assert.equal(overlay.firstElementChild.style.animation, undefined, 'the pop-up did not open with its entrance');
    await h.release();
    assert.match(h.overlay(), /Harbor Clinic/);
    assert.equal(overlay.firstElementChild.style.animation, 'none', 'the filled pop-up played its entrance again');
    h.run('closeStudyDetails()');
    h.run(`showStudyDetails('${IDS[0]}')`);
    assert.equal(overlay.firstElementChild.style.animation, undefined, 'a pop-up opened again lost its entrance');
    // The same for the breakdown pop-ups.
    const b = harness({ files: split() });
    await b.run('loadData()');
    b.hold();
    b.run(`showGeographyBreakdown('${IDS[0]}')`);
    assert.equal(b.el('breakdown-overlay').firstElementChild.style.animation, undefined);
    await b.release();
    assert.equal(b.el('breakdown-overlay').firstElementChild.style.animation, 'none');
});

test("the status row's Try again keeps focus in the row while the extras load, then hands it to the table", T, async () => {
    const files = split();
    const part5 = 'data/studies_tab.part5.json.gz';
    const h = harness({ files: { ...files, [part5]: new TypeError('Failed to fetch') } });
    await h.run('loadData()');
    h.run('prepareStudiesTab()');
    await h.flush();
    const box = h.el('studies-extras-status');
    const action = box.querySelector('.extras-status-action');
    assert.equal(h.status().action, 'Try again');
    action.focus();
    // It fails again: focus waits on the row's line, and the button is back beside it.
    h.run('studiesExtrasAction()');
    assert.equal(action.hidden, true);
    assert.equal(h.doc.activeElement, box.querySelector('.extras-status-line'), 'focus fell to the page with the hidden button');
    await h.flush();
    assert.equal(h.status().action, 'Try again');
    assert.equal(h.doc.activeElement, box.querySelector('.extras-status-line'));
    // It loads: the row goes, and focus goes to the table it filled.
    h.served[part5] = files[part5];
    action.focus();
    h.run('studiesExtrasAction()');
    await h.flush();
    assert.equal(h.status().hidden, true);
    assert.equal(h.doc.activeElement, h.el('studies-table'), 'focus fell to the page with the hidden row');
    assert.match(html, /<p class="extras-status-line" tabindex="-1">/, 'the status line cannot take focus');
    assert.match(html, /<table id="studies-table" class="studies-table" tabindex="-1">/, 'the table cannot take focus');
});

test('after a part of the extras fails, a later call fetches only what failed, never a part already on its way', T, async () => {
    // Each breakdown, publications or study pop-up tries failed extras again.
    // Without this, every click restarted all eight parts (3 MB of gzip and
    // about 28 MB of heap each) while the earlier ones still downloaded.
    const files = split();
    const part3 = 'data/studies_tab.part3.json.gz';
    const h = harness({ files: { ...files, [part3]: undefined } });
    await h.run('loadData()');
    h.hold();   // the parts that exist are slow; part 3's 404 answers first
    h.run('prepareStudiesTab()');
    await h.release((p) => p === part3);
    assert.equal(h.run('datasetReader.extras.state'), 'failed');
    assert.match(h.status().text, /did not load \(HTTP 404\)/);
    for (let i = 0; i < 3; i++) {
        h.run(`showBreakdown('${IDS[0]}', 'race')`);   // a user clicking three check marks
        await h.release((p) => p === part3);
    }
    const tab = () => h.paths().filter((p) => p.includes('studies_tab'));
    assert.equal(tab().filter((p) => p === part3).length, 4, 'part 3 was not tried once per call');
    assert.equal(tab().length, 8 + 3, `parts that were already on their way were fetched again: ${tab().length} requests`);
    assert.ok(h.run('__reads') <= 8, `${h.run('__reads')} reads of the extras in flight at once`);
    assert.match(h.overlay('breakdown-overlay'), /Category labels did not load \(HTTP 404\)/);
    // The other parts land, and are kept: once part 3 is back, only it is fetched.
    await h.release();
    assert.equal(h.run('datasetReader.extras.state'), 'failed');
    h.served[part3] = files[part3];
    h.run('studiesExtrasAction()');
    assert.equal(h.status().text, 'Loading publications and category labels');
    await h.flush();
    assert.equal(tab().length, 8 + 4, 'Try again fetched parts that had loaded');
    assert.equal(h.run('datasetReader.extras.state'), 'loaded');
    assert.equal(h.run('datasetReader.extras.map.size'), IDS.length, 'the parts kept from the first try were not merged');
    assert.equal(h.status().hidden, true);
    h.run(`showBreakdown('${IDS[0]}', 'race')`);
    assert.match(h.overlay('breakdown-overlay'), /<th>Original Label<\/th>/);
});

test("a part from an earlier run (a CDN mid-deploy) says try again, and Try again fetches it once more", T, async () => {
    const files = split();
    const part3 = 'data/studies_tab.part3.json.gz';
    const h = harness({ files: withFile(files, part3, (b) => ({ ...b, extracted_at: OLDER })) });
    await h.run('loadData()');
    h.run('prepareStudiesTab()');
    await h.flush();
    assert.deepEqual(h.requests.filter((r) => r.path === part3).map((r) => r.cache), [undefined, 'reload']);
    assert.equal(h.run('datasetReader.superseded'), null, 'an earlier run was taken for a newer one');
    assert.equal(h.status().text, 'Publications and category labels did not load: the server is still updating them. Try again in a few minutes.');
    assert.equal(h.status().action, 'Try again');
    // The CDN catches up.
    h.served[part3] = files[part3];
    h.run('studiesExtrasAction()');
    await h.flush();
    assert.equal(h.requests.filter((r) => r.path === part3).length, 3, 'Try again did not fetch part 3 again');
    assert.equal(h.requests.filter((r) => r.path.includes('studies_tab')).length, 8 + 2, 'Try again fetched parts that had loaded');
    assert.equal(h.run('datasetReader.extras.state'), 'loaded');
    assert.equal(h.status().hidden, true);
    // The same for a shard: reopening the pop-up fetches it again, and it fills in.
    const n = shard4(IDS[0]);
    const path = `data/detail/${n}.json.gz`;
    const s = harness({ files: withFile(files, path, (b) => ({ ...b, extracted_at: OLDER })) });
    await s.run('loadData()');
    s.run(`showStudyDetails('${IDS[0]}')`);
    await s.flush();
    assert.match(s.overlay(), /the server is still updating them\. Try again in a few minutes\./);
    s.served[path] = files[path];
    s.run(`showStudyDetails('${IDS[0]}')`);
    await s.flush();
    assert.equal(s.requests.filter((r) => r.path === path).length, 3);
    assert.match(s.overlay(), /Harbor Clinic/);
});

// ── Dataset switches (the #241 invariant) ──
// loadData puts a dataset on screen in one synchronous step: data,
// dashboardSummary and datasetReader together. Every load fills the reader it
// was started for; anything that draws checks its dataset is still on screen.

test('extras that land after a switch fill the dataset they were started for, and draw nothing', T, async () => {
    const files = { ...split(), ...inline({ base: 'snapshots/2026-08-02', stamp: OLDER }) };
    const h = harness({ files });
    await h.run('loadData()');
    h.run('globalThis.latest = datasetReader; globalThis.latestRows = data;');
    h.hold();
    h.run('prepareStudiesTab()');
    // Switch to the inline snapshot while the extras are in flight.
    const switching = h.run("loadData('2026-08-02')");
    await h.release((p) => p.startsWith('snapshots/'));
    await switching;
    h.run('renderDashboardStub = () => refreshStudiesTab(); renderDashboardStub();');
    assert.equal(h.run('datasetReader.mode'), 'inline');
    const shown = h.el('studies-table-body').innerHTML;
    const renders = h.run('tableRenders');
    await h.release();
    assert.equal(h.run('latest.extras.state'), 'loaded', 'the extras did not fill the dataset they were started for');
    assert.equal(h.run('datasetReader.extras.state'), 'idle', "the old dataset's extras landed in the new one");
    assert.equal(h.run('tableRenders'), renders, 'the old extras redrew the table after the switch');
    assert.equal(h.el('studies-table-body').innerHTML, shown);
    assert.equal(h.status().hidden, true, "the old dataset's status row came back");
    assert.equal(h.paths().filter((p) => p.startsWith('snapshots/') && !p.includes('demographics')).length, 0, 'the inline snapshot fetched extras');
});

test('a pop-up whose shard lands after a switch, or after it was closed or replaced, is not redrawn', T, async () => {
    const files = { ...split(), ...split({ base: 'snapshots/2026-10-18', stamp: OLDER }) };
    // After a switch.
    const h = harness({ files });
    await h.run('loadData()');
    h.hold();
    h.run(`showStudyDetails('${IDS[0]}')`);
    const pending = h.overlay();
    const switching = h.run("loadData('2026-10-18')");
    await h.release((p) => p.includes('demographics'));
    await switching;
    h.run('globalThis.before = datasetReader.shards.size');
    await h.release();
    assert.equal(h.overlay(), pending, 'a shard of the previous dataset redrew its pop-up over the new one');
    assert.equal(h.run('before'), 0, 'the new dataset holds a shard it never asked for');
    // After it was closed.
    const c = harness({ files });
    await c.run('loadData()');
    c.hold();
    c.run(`showStudyDetails('${IDS[0]}'); closeStudyDetails();`);
    await c.release();
    assert.equal(c.el('study-details-overlay').style.display, 'none', 'a closed pop-up opened itself again');
    // After another study's pop-up replaced it.
    const other = IDS.find((id) => shard4(id) !== shard4(IDS[0]));
    const r = harness({ files });
    await r.run('loadData()');
    r.hold();
    r.run(`showStudyDetails('${IDS[0]}'); showStudyDetails('${other}');`);
    await r.release((p) => p.endsWith(`/${shard4(IDS[0])}.json.gz`));
    assert.match(r.overlay(), new RegExp(other), "the first study's shard drew its pop-up over the second");
    // The same for the shared breakdown pop-up.
    const b = harness({ files });
    await b.run('loadData()');
    b.hold();
    b.run(`showGeographyBreakdown('${IDS[0]}'); closeBreakdown();`);
    await b.release();
    assert.equal(b.el('breakdown-overlay').style.display, 'none');
    // The geography, breakdown and publications pop-ups after a switch: what
    // lands for the old dataset does not draw over the new one.
    for (const open of [`showGeographyBreakdown('${IDS[0]}')`, `showBreakdown('${IDS[0]}', 'race')`, `showPublications('${IDS[0]}')`]) {
        const g = harness({ files });
        await g.run('loadData()');
        g.hold();
        g.run(open);
        const shown = g.overlay('breakdown-overlay');
        const switching = g.run("loadData('2026-10-18')");
        await g.release((p) => p.includes('demographics'));
        await switching;
        await g.release();
        assert.equal(g.overlay('breakdown-overlay'), shown, `${open}: what landed for the previous dataset redrew its pop-up over the new one`);
    }
});

test('when the old dataset finishes first, the new one keeps waiting for its own', T, async () => {
    const files = { ...split(), ...split({ base: 'snapshots/2026-10-18', stamp: OLDER }) };
    const h = harness({ files });
    await h.run('loadData()');
    h.hold();
    h.run('prepareStudiesTab(); globalThis.first = datasetReader;');
    const switching = h.run("loadData('2026-10-18')");
    await h.release((p) => p.includes('demographics'));
    await switching;
    h.run('refreshStudiesTab()');
    const second = h.paths().filter((p) => p.startsWith('snapshots/2026-10-18/studies_tab'));
    assert.equal(second.length, 8, 'the new dataset waited on the old extras instead of fetching its own');
    await h.release((p) => p.startsWith('data/'));
    assert.equal(h.run('first.extras.state'), 'loaded');
    assert.equal(h.run('datasetReader.extras.state'), 'loading', "the old extras marked the new dataset's loaded");
    assert.equal(h.status().text, 'Loading publications and category labels');
    h.run('loadStudiesTabExtras(datasetReader)');
    assert.equal(h.paths().filter((p) => p.startsWith('snapshots/2026-10-18/studies_tab')).length, 8, 'a third download started');
    await h.release();
    assert.equal(h.run('datasetReader.extras.state'), 'loaded');
});

test('a pop-up opened while another dataset loads belongs to the dataset still on screen', T, async () => {
    const files = { ...split(), ...split({ base: 'snapshots/2026-10-18', stamp: OLDER }) };
    const h = harness({ files });
    await h.run('loadData()');
    h.run('globalThis.latest = datasetReader;');
    h.hold();
    const switching = h.run("loadData('2026-10-18')");
    h.run(`showStudyDetails('${IDS[0]}')`);   // the snapshot's parts are still on their way
    assert.deepEqual(h.paths().filter((p) => p.includes('/detail/')), [`data/detail/${shard4(IDS[0])}.json.gz`]);
    await h.release();
    await switching;
    assert.equal(h.run(`latest.shards.get(${shard4(IDS[0])}).state`), 'loaded', 'the shard did not fill the dataset it was asked for');
    assert.equal(h.run('datasetReader.shards.size'), 0, "the latest data's shard landed in the snapshot");
});

test('a dataset seen again brings back what its reader loaded', T, async () => {
    const files = { ...split(), ...inline({ base: 'snapshots/2026-08-02', stamp: OLDER }) };
    const h = harness({ files });
    await h.run('loadData()');
    h.run('prepareStudiesTab()');
    h.run(`showStudyDetails('${IDS[0]}')`);
    await h.flush();
    const count = h.requests.length;
    await h.run("loadData('2026-08-02')");
    await h.run("loadData('latest')");
    assert.equal(h.run('datasetReader.mode'), 'split');
    assert.equal(h.run('datasetReader.extras.state'), 'loaded');
    assert.equal(h.run("snapshotCache.get('latest').reader === datasetReader"), true, 'the reader is not kept on the cache entry');
    h.run(`prepareStudiesTab(); showStudyDetails('${IDS[0]}')`);
    await h.flush();
    assert.equal(h.requests.length, count + 8, 'a revisit fetched again what its reader had loaded');
});

test('loadData puts the reader on screen in the step that puts the data there', () => {
    const src = fnSource('async function loadData(date)');
    const assigns = [...src.matchAll(/\n\s+data = /g)].map((m) => m.index);
    assert.equal(assigns.length, 4, 'expected data assigned on the phone, cache-hit, part-file and archive paths');
    for (const at of assigns) {
        // The straight-line stretch around the assignment: from the last await
        // or return before it to the first return after it.
        const before = src.slice(0, at);
        const from = Math.max(before.lastIndexOf('await '), before.lastIndexOf('return'));
        const to = src.indexOf('return', at);
        const stretch = src.slice(from, to).replace(/^(await|return)[^\n]*\n/, '');
        assert.doesNotMatch(stretch, /\bawait\b/, `an await separates data from its reader:\n${stretch}`);
        assert.match(stretch, /\bdatasetReader = /, `data is assigned without its reader:\n${stretch}`);
        assert.match(stretch, /\bdashboardSummary = /, `data is assigned without its summary state:\n${stretch}`);
        assert.match(stretch, /\bstudiesTabReady = false;/, `data is assigned without handing the Studies tab back:\n${stretch}`);
    }
    assert.doesNotMatch(src, /isMobileDevice\)\s*dashboardSummary/, 'the summary state follows the device, not the dataset');
    assert.match(src, /snapshotCache\.set\(cacheKey, \{[^}]*reader: datasetReader \}\);[\s\S]*snapshotCache\.set\(cacheKey, \{[^}]*reader: datasetReader \}\);/,
        'a cache entry does not carry its reader');
    assert.match(fnSource('function refreshStudiesTab()'), /if \(studiesTabReady\)[\s\S]*?else[\s\S]*?prepareStudiesTab\(\)/,
        'an open Studies tab is no longer handed to a new dataset');
    const render = fnSource('function renderDashboard()');
    assert.equal((render.match(/refreshStudiesTab\(\);/g) || []).length, 2, 'renderDashboard does not hand the Studies tab over on both paths');
});

// ── Layouts ──

test('a layout this page cannot read is refused with an explicit error, and nothing is shown', T, async () => {
    const files = split();
    const bump = (edit) => Object.fromEntries(Object.entries(files).map(([p, b]) => [p, p.includes('demographics') ? edit(structuredClone(b), p) : b]));
    const cases = {
        'a newer version': [bump((b) => ({ ...b, layout: { ...b.layout, version: 2 } })), /this page is older than the data; reload/],
        'an unknown shard key': [bump((b) => ({ ...b, layout: { ...b.layout, detail: { ...b.layout.detail, key: 'fnv1a' } } })), /older than the data/],
        'parts that disagree': [bump((b, p) => (p.endsWith('part5.json.gz') ? { ...b, layout: { ...b.layout, detail: { ...b.layout.detail, shards: 8 } } } : b)), /disagree about their layout/],
        'a layout with no layout in one part': [bump((b, p) => { if (p.endsWith('part2.json.gz')) delete b.layout; return b; }), /disagree about their layout/],
        'extras that are not one per part': [bump((b) => ({ ...b, layout: { ...b.layout, studies_tab: { files: 4 } } })), /does not add up/],
        'no shard count': [bump((b) => ({ ...b, layout: { ...b.layout, detail: { key: 'nct_number_mod' } } })), /does not add up/]
    };
    for (const [name, [served, message]] of Object.entries(cases)) {
        const h = harness({ files: served });
        await assert.rejects(h.run('loadData()'), message, name);
        assert.equal(h.run('data'), null, `${name}: the dataset was shown`);
        assert.equal(h.run('datasetReader'), null, `${name}: a reader was put on screen`);
    }
    // A snapshot in a layout this page cannot read is not read as an archive summary either.
    const snap = Object.fromEntries(Object.entries(split({ base: 'snapshots/2026-10-18' }))
        .map(([p, b]) => [p, p.includes('demographics') ? { ...b, layout: { ...b.layout, version: 2 } } : b]));
    snap['snapshots/2026-10-18/dashboard-summary.json'] = { extracted_at: STAMP, recentStudies: [] };
    const s = harness({ files: snap });
    await assert.rejects(s.run("loadData('2026-10-18')"), /older than the data/);
    assert.ok(!s.paths().some((p) => p.endsWith('dashboard-summary.json')), 'the refused snapshot fell back to its summary');
});

test('a phone whose summary failed reads its parts by their layout, not by being a phone', T, async () => {
    const h = harness({ files: split(), mobile: true, summary: null });
    await h.run('loadData()');
    assert.equal(h.run('datasetReader.mode'), 'split');
    assert.equal(h.run('dashboardSummary'), null);
    h.run('prepareStudiesTab()');
    h.run(`showStudyDetails('${IDS[0]}')`);
    await h.flush();
    assert.equal(h.paths().filter((p) => p.includes('studies_tab')).length, 8);
    assert.match(h.overlay(), /Harbor Clinic/);
});

test('the phone view says what its summary rows do not carry', T, async () => {
    const summary = JSON.parse(readFileSync(new URL('../data/dashboard-summary.json', import.meta.url), 'utf8'));
    const h = harness({ mobile: true, summary });
    await h.run('loadData()');
    assert.equal(h.run('datasetReader.mode'), 'summary');
    const row = summary.recentStudies.find((s) => s.race && s.race.reported && s.reference_count > 0) || summary.recentStudies[0];
    h.run('prepareStudiesTab()');
    h.run(`showStudyDetails('${row.nct_id}')`);
    h.run(`showBreakdown('${row.nct_id}', 'race')`);
    await h.flush();
    assert.equal(h.requests.length, 0, 'the phone view fetched files');
    assert.equal(h.status().hidden, true);
    const modal = h.overlay();
    assert.deepEqual(claims(modal), [], 'the phone pop-up states values its rows do not have');
    assert.ok((modal.match(/<p class="detail-state is-na">Not included in the phone view<\/p>/g) || []).length >= 5, 'sections the rows lack do not say so');
    assert.match(modal, new RegExp(`<h5>Publications \\(${row.reference_count}\\)</h5>`), 'the row\'s own reference count was dropped');
    assert.match(modal, /<strong>Status:<\/strong> /, "the row's own status was dropped");
    const breakdown = h.overlay('breakdown-overlay');
    assert.match(breakdown, /Not included in the phone view: original labels, match quality and quarantined labels\./);
    assert.doesNotMatch(breakdown, /Original Label|Not reported<\/td>/);
    assert.match(h.el('studies-table-body').innerHTML, /pubs?<\/span>|<span class="text-muted">-<\/span>/, 'the table lost the rows\' reference counts');
});

// ── Aggregate archives ──

const ARCHIVE_ROWS = RECORDS.slice(0, 3).map((r) => {
    const { nct_id, brief_title, results_date, start_date, primary_completion_date, completion_date, completion_to_report_days, min_age, max_age,
        enrollment, enrollment_type, status, why_stopped, phase, is_fda_regulated_drug, is_fda_regulated_device, is_unapproved_device } = r;
    return {
        nct_id, brief_title, results_date, start_date, primary_completion_date, completion_date, completion_to_report_days, min_age, max_age,
        enrollment, enrollment_type, status, why_stopped, phase, is_fda_regulated_drug, is_fda_regulated_device, is_unapproved_device,
        race: { reported: true, omb_totals: r.race.omb_totals }, ethnicity: { reported: true, omb_totals: r.ethnicity.omb_totals },
        sex: { reported: true, totals: r.sex.totals }, gender: { reported: false }, reference_count: 1
    };
});
const archiveSummary = (date, extra = {}) => ({ extracted_at: `${date}T07:03:36.020045`, recentStudies: ARCHIVE_ROWS, ...extra });

test('an archive with its own file of study records reads that file, named by history.json', T, async () => {
    const date = '2026-04-26';
    const files = {
        [`snapshots/${date}/dashboard-summary.json`]: archiveSummary(date),
        [`snapshots/${date}/archive_records.json.gz`]: {
            source_extracted_at: `${date}T07:03:36.020045`, source_pipeline_commit: null, class: 'archive',
            data: Object.fromEntries(RECORDS.slice(0, 3).map((r) => [r.nct_id, r]))
        }
    };
    const history = { dates: [date], archives: { [date]: { kind: 'aggregate', detail: 'archive_records.json.gz' } } };
    const h = harness({ files, history });
    await h.run(`loadData('${date}')`);
    assert.equal(h.run('datasetReader.mode'), 'archive');
    h.run('prepareStudiesTab()');
    h.run(`showStudyDetails('${IDS[0]}'); showGeographyBreakdown('${IDS[1]}')`);
    await h.flush();
    // (The eight part requests that 404 first are how loadData finds an archive.)
    const sidecars = (k) => k.paths().filter((p) => p.endsWith('.json.gz') && !p.includes('/demographics.part'));
    assert.deepEqual(sidecars(h), [`snapshots/${date}/archive_records.json.gz`], 'the archive file was not fetched once, from the archive');
    assert.ok(!h.paths().some((p) => p.includes('details.part')), 'an archive with its own file read the March files');
    assert.match(h.overlay(), /<strong>Allocation:<\/strong> RANDOMIZED/);
    assert.match(h.overlay(), /Harbor Clinic/);
    assert.match(h.overlay('breakdown-overlay'), /Lakeside Hospital/);
    // Its stamps are the run it was projected from; a dataset with no commit
    // has none to compare, but its date must match.
    const wrong = harness({ files: { ...files, [`snapshots/${date}/archive_records.json.gz`]: { ...files[`snapshots/${date}/archive_records.json.gz`], source_extracted_at: OLDER } }, history });
    await wrong.run(`loadData('${date}')`);
    wrong.run(`showStudyDetails('${IDS[0]}')`);
    await wrong.flush();
    assert.equal(wrong.requests.filter((r) => r.path.endsWith('archive_records.json.gz')).length, 2);
    assert.doesNotMatch(wrong.overlay(), /Harbor Clinic/);
    // A history.json that names no file, or a file name that is not a plain one, reads no file.
    for (const named of [{ dates: [date] }, { dates: [date], archives: { [date]: { kind: 'aggregate', detail: '../data/details.part1.json.gz' } } }]) {
        const k = harness({ files, history: named });
        await k.run(`loadData('${date}')`);
        assert.equal(k.run('datasetReader.mode'), 'summary');
    }
});

test('the 2026-02-22 archive reads the March files, labelled; every other archive says what it does not include', T, async () => {
    const march = {
        'data/details.part1.json.gz': { part: 1, data: { [IDS[0]]: { study_sites: RECORDS[0].study_sites, secondary_outcomes: RECORDS[0].secondary_outcomes, geo_identification_method: 'High (zip)', primary_outcome_description: 'March text', intervention_model_description: 'March design' } } },
        'data/details.part2.json.gz': { part: 2, data: {} }
    };
    const early = harness({ files: { ...march, 'snapshots/2026-02-22/dashboard-summary.json': archiveSummary('2026-02-22') }, history: null });
    await early.run("loadData('2026-02-22')");
    assert.equal(early.run('datasetReader.mode'), 'legacy');
    early.run(`showStudyDetails('${IDS[0]}')`);
    await early.flush();
    const sidecars = (k) => k.paths().filter((p) => p.endsWith('.json.gz') && !p.includes('/demographics.part'));
    assert.deepEqual(sidecars(early), ['data/details.part1.json.gz', 'data/details.part2.json.gz']);
    const modal = early.overlay();
    assert.match(modal, /from the 2026-03-05 extract, not from this archive's own run/);
    assert.match(modal, /Harbor Clinic/);
    assert.match(modal, /March design/);
    assert.match(modal, /Not included in this archive/);
    assert.deepEqual(claims(modal), []);
    // A study the March files lack.
    early.run(`showStudyDetails('${IDS[1]}')`);
    await early.flush();
    assert.match(early.overlay(), /<h5>Study Sites<\/h5>\s*<p class="detail-state is-na">Not included in this archive<\/p>/);
    assert.doesNotMatch(early.overlay(), /2026-03-05 extract/);

    const later = harness({ files: { ...march, 'snapshots/2026-04-26/dashboard-summary.json': archiveSummary('2026-04-26') }, history: { dates: ['2026-04-26'] } });
    await later.run("loadData('2026-04-26')");
    assert.equal(later.run('datasetReader.mode'), 'summary');
    later.run('prepareStudiesTab()');
    later.run(`showStudyDetails('${IDS[0]}')`);
    await later.flush();
    assert.equal(sidecars(later).length, 0, 'an archive after 2026-03-05 read the March files');
    const text = later.overlay();
    assert.match(text, /Not included in this archive/);
    assert.deepEqual(claims(text), []);
    assert.equal(later.status().hidden, true);
});

test("the March fallback keeps only the archive's own studies, not the whole extract", T, async () => {
    // The March files hold 76,684 studies (about 584 MB once parsed) for an
    // archive of 500 rows, and the reader stays on the archive's cache entry
    // after the user leaves it.
    const others = Object.fromEntries(IDS.slice(3).map((id) => [id, { study_sites: RECORDS[0].study_sites }]));
    const march = {
        'data/details.part1.json.gz': { part: 1, data: { [IDS[0]]: { study_sites: RECORDS[0].study_sites }, ...others } },
        'data/details.part2.json.gz': { part: 2, data: { [IDS[2]]: { secondary_outcomes: [] }, NCT09999999: { study_sites: [] } } }
    };
    const h = harness({ files: { ...march, 'snapshots/2026-02-22/dashboard-summary.json': archiveSummary('2026-02-22') }, history: null });
    await h.run("loadData('2026-02-22')");
    h.run('prepareStudiesTab()');
    await h.flush();
    assert.equal(h.run('datasetReader.extras.state'), 'loaded');
    assert.deepEqual(h.json('[...datasetReader.extras.map.keys()].sort()'), [IDS[0], IDS[2]].sort(), 'the reader kept studies the archive does not have');
    h.run(`showStudyDetails('${IDS[0]}')`);
    assert.match(h.overlay(), /Harbor Clinic/);
    // A split dataset's extras are its own rows already, all of them.
    const s = harness({ files: split() });
    await s.run('loadData()');
    s.run('prepareStudiesTab()');
    await s.flush();
    assert.equal(s.run('datasetReader.extras.map.size'), IDS.length);
});

test('a phone never reads the March files: the 2026-02-22 archive says what it does not include, as every other', T, async () => {
    // data/details.part1+2 are 82 MB of gzip and 487 MB of JSON, which a
    // phone cannot hold; the page before the reader never fetched them on a
    // phone. An archive's own file of study records is small, and still loads.
    const march = {
        'data/details.part1.json.gz': { part: 1, data: { [IDS[0]]: { study_sites: RECORDS[0].study_sites } } },
        'data/details.part2.json.gz': { part: 2, data: {} }
    };
    const phone = harness({ mobile: true, files: { ...march, 'snapshots/2026-02-22/dashboard-summary.json': archiveSummary('2026-02-22') }, history: null });
    await phone.run("loadData('2026-02-22')");
    assert.equal(phone.run('datasetReader.mode'), 'summary');
    phone.run('prepareStudiesTab()');
    phone.run(`showStudyDetails('${IDS[0]}'); showGeographyBreakdown('${IDS[0]}')`);
    await phone.flush();
    assert.deepEqual(phone.paths().filter((p) => p.includes('details.part')), [], 'a phone fetched the March files');
    assert.equal(phone.status().hidden, true);
    const modal = phone.overlay();
    assert.match(modal, /<h5>Study Sites<\/h5>\s*<p class="detail-state is-na">Not included in this archive<\/p>/);
    assert.doesNotMatch(modal, /2026-03-05 extract/);
    assert.deepEqual(claims(modal), []);
    assert.match(phone.overlay('breakdown-overlay'), /Not included in this archive/);
    // The same archive with a file of its own: read on a phone too.
    const date = '2026-02-22';
    const own = harness({
        mobile: true,
        files: {
            ...march,
            [`snapshots/${date}/dashboard-summary.json`]: archiveSummary(date),
            [`snapshots/${date}/archive_records.json.gz`]: {
                source_extracted_at: `${date}T07:03:36.020045`, source_pipeline_commit: null, class: 'archive',
                data: Object.fromEntries(RECORDS.slice(0, 3).map((r) => [r.nct_id, r]))
            }
        },
        history: { dates: [date], archives: { [date]: { kind: 'aggregate', detail: 'archive_records.json.gz' } } }
    });
    await own.run(`loadData('${date}')`);
    assert.equal(own.run('datasetReader.mode'), 'archive');
    own.run(`showStudyDetails('${IDS[0]}')`);
    await own.flush();
    assert.deepEqual(own.paths().filter((p) => /details\.part|archive_records/.test(p)), [`snapshots/${date}/archive_records.json.gz`]);
    assert.match(own.overlay(), /Harbor Clinic/);
});

test('the Population line shows only when the record carries what it is worked out from', T, async () => {
    // getStudyPediatricStatus reads pediatric_status, then std_ages, and only
    // then guesses from min_age and max_age: a row with no age limits ('N/A')
    // reads "Not Specified", although its record says "Pediatric Included".
    // Summary rows (the phone view, aggregate archives) carry neither field.
    const open = { min_age: 'N/A', max_age: 'N/A' };
    const rows = ARCHIVE_ROWS.map((r, i) => (i === 0 ? { ...r, ...open } : r));
    const record = { ...RECORDS[0], ...open, std_ages: ['CHILD', 'ADULT', 'OLDER_ADULT'], pediatric_status: 'Pediatric Included' };
    const population = (text) => (text.match(/<strong>Population:<\/strong> ([^<]*)</) || [])[1] ?? null;
    // The phone view.
    const phone = harness({ mobile: true, summary: { extracted_at: STAMP, recentStudies: rows } });
    await phone.run('loadData()');
    for (const row of rows) {
        phone.run(`showStudyDetails('${row.nct_id}')`);
        assert.equal(population(phone.overlay()), null, `the phone pop-up of ${row.nct_id} (ages ${row.min_age} to ${row.max_age}) states a population its row does not carry`);
        assert.match(phone.overlay(), /<h5>Enrollment &amp; Eligibility<\/h5>[\s\S]*?<p class="detail-state is-na">Not included in the phone view<\/p>|<h5>Enrollment & Eligibility<\/h5>[\s\S]*?<p class="detail-state is-na">Not included in the phone view<\/p>/);
    }
    // An aggregate archive without a file of its own.
    const later = harness({ files: { 'snapshots/2026-04-26/dashboard-summary.json': archiveSummary('2026-04-26', { recentStudies: rows }) }, history: { dates: ['2026-04-26'] } });
    await later.run("loadData('2026-04-26')");
    later.run(`showStudyDetails('${rows[0].nct_id}')`);
    await later.flush();
    assert.equal(population(later.overlay()), null, 'an aggregate archive states a population its row does not carry');
    // An archive with its own file: nothing while the file loads, the record's value once it is here.
    const date = '2026-04-26';
    const files = {
        [`snapshots/${date}/dashboard-summary.json`]: archiveSummary(date, { recentStudies: rows }),
        [`snapshots/${date}/archive_records.json.gz`]: {
            source_extracted_at: `${date}T07:03:36.020045`, source_pipeline_commit: null, class: 'archive',
            data: { [record.nct_id]: record, ...Object.fromEntries(RECORDS.slice(1, 3).map((r) => [r.nct_id, r])) }
        }
    };
    const archive = harness({ files, history: { dates: [date], archives: { [date]: { kind: 'aggregate', detail: 'archive_records.json.gz' } } } });
    await archive.run(`loadData('${date}')`);
    archive.hold();
    archive.run(`showStudyDetails('${rows[0].nct_id}')`);
    assert.equal(population(archive.overlay()), null, 'the pending archive pop-up guessed a population');
    assert.match(archive.overlay(), /Loading eligibility details/);
    await archive.release();
    assert.equal(population(archive.overlay()), 'Pediatric Included');
    // Inline and split records carry pediatric_status: shown as always.
    const h = harness({ files: split() });
    await h.run('loadData()');
    h.hold();
    h.run(`showStudyDetails('${IDS[0]}')`);
    assert.equal(population(h.overlay()), 'Adult Only', 'a split record lost its core population while its shard loads');
    await h.release();
});

// ── What a view shows for fields that are not here ──

test('no pending, failed, missing or not-included view states a value the record does not have', T, async () => {
    const n = shard4(IDS[0]);
    const files = split();
    const seen = {};
    // Each view as it stands once whatever it asked for has settled (a view
    // tries a failed load again, so a failed view is read after that try).
    const views = async (h, label) => {
        h.run(`showStudyDetails('${IDS[0]}')`);
        await h.flush();
        seen[`${label} pop-up`] = h.overlay();
        h.run(`showGeographyBreakdown('${IDS[0]}')`);
        await h.flush();
        seen[`${label} sites`] = h.overlay('breakdown-overlay');
        h.run(`showBreakdown('${IDS[0]}', 'race')`);
        await h.flush();
        seen[`${label} breakdown`] = h.overlay('breakdown-overlay');
        h.run('prepareStudiesTab()');
        await h.flush();
        seen[`${label} table`] = h.el('studies-table-body').innerHTML;
    };
    const pending = harness({ files });
    await pending.run('loadData()');
    pending.hold();
    await views(pending, 'pending');
    const failed = harness({ files: { ...files, [`data/detail/${n}.json.gz`]: undefined, 'data/studies_tab.part1.json.gz': undefined } });
    await failed.run('loadData()');
    await views(failed, 'failed');
    const missing = harness({ files: withFile(files, `data/detail/${n}.json.gz`, (b) => { delete b.data[IDS[0]]; return b; }) });
    await missing.run('loadData()');
    await views(missing, 'missing');
    for (const [label, text] of Object.entries(seen)) {
        // A pending or failed pop-up still shows the record's own core value
        // of healthy_volunteers, which here is false.
        const found = claims(text).filter((c) => !(c === 'Healthy Volunteers:</strong> No' && /pop-up/.test(label)));
        assert.deepEqual(found, [], `${label} states values it does not have`);
        if (/table/.test(label)) {
            assert.doesNotMatch(text, /<td class="col-publications"><span class="text-muted">-<\/span><\/td>/, `${label}: a publications cell that is not here reads as none`);
        }
    }
    assert.match(seen['pending breakdown'], /<th>NIH\/OMB Category<\/th><th>Count<\/th><th>Percent<\/th>/);
    assert.match(seen['pending breakdown'], /Loading category labels/);
    assert.doesNotMatch(seen['pending breakdown'], /Original Label|Not reported<\/td>|Quarantined/);
    assert.match(seen['failed breakdown'], /Category labels did not load \(HTTP 404\)\. <button[^>]*onclick="showBreakdown\('NCT\d+', 'race'\)"[^>]*>Try again/);
    assert.match(seen['failed sites'], /Sites did not load \(HTTP 404\)/);
    assert.match(seen['missing sites'], /This study's sites are missing from the published files\./);
    assert.match(seen['failed table'], /class="cell-failed" title="Publications did not load \(HTTP 404\)\.">did not load<\/span>/);
    // Once the labels land, the breakdown redraws in full, quarantine and all.
    await pending.release();
    pending.run(`showBreakdown('${IDS[0]}', 'race')`);
    await pending.flush();
    const full = pending.overlay('breakdown-overlay');
    assert.match(full, /<th>Original Label<\/th>/);
    assert.match(full, /Quarantined Labels/);
    assert.match(full, /Oral contraceptive/);
});

test('the breakdown counts use the record\'s own totals and the denominators of the full breakdown', T, async () => {
    const h = harness({ files: split() });
    await h.run('loadData()');
    h.hold();
    h.run(`showBreakdown('${IDS[0]}', 'race')`);
    const counts = h.overlay('breakdown-overlay');
    // White 100 and Asian 20 of 120: the same shares the full breakdown shows.
    assert.match(counts, /<td>Asian<\/td>\s*<td>20<\/td>\s*<td style="--percent: 16\.7">16\.7%<\/td>/);
    assert.match(counts, /<td>White<\/td>\s*<td>100<\/td>\s*<td style="--percent: 83\.3">83\.3%<\/td>/);
    h.run(`showBreakdown('${IDS[0]}', 'ethnicity')`);
    assert.match(h.overlay('breakdown-overlay'), /<td>Not Hispanic Latino<\/td>\s*<td>108<\/td>\s*<td style="--percent: 90\.0">90\.0%<\/td>/);
    await h.release();
});

test('the publications pop-up waits for the references, then lists them', T, async () => {
    const h = harness({ files: split() });
    await h.run('loadData()');
    h.hold();
    h.run(`showPublications('${IDS[0]}')`);
    assert.match(h.overlay('breakdown-overlay'), /Loading publications/);
    await h.release();
    assert.match(h.overlay('breakdown-overlay'), /A randomized trial/);
    assert.match(h.overlay('breakdown-overlay'), /PMID 31000001/);
});

test('the funding source waits for the collaborators', T, async () => {
    const h = harness({ files: split() });
    await h.run('loadData()');
    h.hold();
    h.run(`showStudyDetails('${IDS[0]}')`);
    assert.doesNotMatch(h.overlay(), /Funding Source/, 'an OTHER lead with an NIH collaborator would read as Other');
    assert.match(h.overlay(), /Loading sponsor details/);
    await h.release();
    assert.match(h.overlay(), /Funding Source:<\/strong> <span class="badge">NIH<\/span>/);
});

test('without DecompressionStream the shards and extras load through pako', T, async () => {
    const h = harness({ files: split(), decompression: false });
    await h.run('loadData()');
    h.run(`prepareStudiesTab(); showStudyDetails('${IDS[0]}')`);
    await h.flush();
    assert.equal(h.run('datasetReader.extras.state'), 'loaded');
    assert.match(h.overlay(), /Harbor Clinic/);
});

test('every fetch carries the data key, through keyedFetch', T, async () => {
    const h = harness({ files: split() });
    await h.run('loadData()');
    h.run(`prepareStudiesTab(); showStudyDetails('${IDS[0]}')`);
    await h.flush();
    assert.ok(h.requests.length > 9);
    for (const r of h.requests) assert.match(r.url, /\?v=test$/, `${r.path} was fetched without the data key`);
    assert.match(READER, /await fetchAndDecompress\(url, onProgress\);[\s\S]*await fetchAndDecompress\(url, onProgress, \{ cache: 'reload' \}\);/);
});

test('a long session of pop-ups keeps a bounded number of shards', T, async () => {
    const records = Array.from({ length: 40 }, (_, i) => fullRecord(`NCT0${String(2000000 + i).padStart(7, '0')}`));
    const files = dataset(records, { parts: 8, shards: 40, stamp: STAMP, commit: 'abc1234' });
    const h = harness({ files });
    await h.run('loadData()');
    const limit = h.run('SHARD_CACHE_LIMIT');
    for (const r of records.slice(0, limit + 3)) h.run(`showStudyDetails('${r.nct_id}')`);
    await h.flush();
    assert.equal(h.run('[...datasetReader.shards.values()].filter(s => s.state === "loaded").length'), limit);
    assert.equal(h.run(`datasetReader.shards.has(${Number(records[0].nct_id.slice(3)) % 40})`), false, 'the least recently used shard was kept');
    assert.equal(h.run(`datasetReader.shards.has(${Number(records[limit + 2].nct_id.slice(3)) % 40})`), true);
});

test('the shard cache drops the least recently used shard, never the one a pop-up just retried', T, async () => {
    const records = Array.from({ length: 40 }, (_, i) => fullRecord(`NCT0${String(3000000 + i).padStart(7, '0')}`));
    const files = dataset(records, { parts: 8, shards: 64, stamp: STAMP, commit: 'abc1234' });
    const shardOf64 = (r) => Number(r.nct_id.slice(3)) % 64;
    const limit = 32;
    // A shard that failed first, then 32 other shards, then Try again on the first.
    const [x, ...others] = records;
    const path = `data/detail/${shardOf64(x)}.json.gz`;
    const h = harness({ files: { ...files, [path]: undefined } });
    await h.run('loadData()');
    assert.equal(h.run('SHARD_CACHE_LIMIT'), limit);
    h.run(`showStudyDetails('${x.nct_id}')`);
    await h.flush();
    assert.match(h.overlay(), /Sites did not load \(HTTP 404\)/);
    for (const r of others.slice(0, limit)) h.run(`showStudyDetails('${r.nct_id}')`);
    await h.flush();
    h.served[path] = files[path];
    h.run(`showStudyDetails('${x.nct_id}')`);   // Try again
    await h.flush();
    assert.equal(h.run(`datasetReader.shards.get(${shardOf64(x)})?.state`), 'loaded', 'the shard Try again loaded was dropped at once');
    assert.doesNotMatch(h.overlay(), /loading-meter/, 'the pop-up waits for a shard that was dropped');
    assert.match(h.overlay(), /Harbor Clinic/);
    assert.equal(h.requests.filter((r) => r.path === path).length, 2);
    // A shard a user keeps coming back to stays; the one used longest ago goes.
    const k = harness({ files });
    await k.run('loadData()');
    const [a, ...rest] = records;
    k.run(`showStudyDetails('${a.nct_id}')`);
    await k.flush();
    for (const r of rest.slice(0, limit)) {
        k.run(`showStudyDetails('${r.nct_id}')`);
        await k.flush();
        k.run(`showStudyDetails('${a.nct_id}')`);   // back to the first study
    }
    assert.equal(k.run(`datasetReader.shards.has(${shardOf64(a)})`), true, 'the most recently used shard was dropped');
    assert.equal(k.run(`datasetReader.shards.has(${shardOf64(rest[0])})`), false, 'the least recently used shard was kept');
    assert.equal(k.run('[...datasetReader.shards.values()].filter(s => s.state === "loaded").length'), limit);
    assert.equal(k.requests.filter((r) => r.path === `data/detail/${shardOf64(a)}.json.gz`).length, 1, 'the shard in use was fetched again');
});

test('only the 2026-02-22 fallback names the frozen March files', () => {
    const outside = app.replace(/const MARCH_DETAIL_FILES = \[[^\]]*\];/, '');
    assert.doesNotMatch(outside, /details\.part/, 'another code path in app.js names the frozen details files');
    assert.doesNotMatch(html, /details\.part/);
    assert.match(READER, /const MARCH_EXTRACT_DATE = '2026-03-05';/);
});

// The rules of a stylesheet in source order, flattened out of their @media
// blocks: { order, media, selectors, decls }. @keyframes and other at-rules
// are skipped. Enough of CSS for the cascade questions below.
function cssRules(text) {
    const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    const walk = (s, media) => {
        let i = 0;
        while (i < s.length) {
            const open = s.indexOf('{', i);
            if (open < 0) break;
            const head = s.slice(i, open).split(';').pop().trim();
            let depth = 1;
            let j = open + 1;
            for (; j < s.length && depth; j++) depth += s[j] === '{' ? 1 : s[j] === '}' ? -1 : 0;
            const body = s.slice(open + 1, j - 1);
            if (head.startsWith('@media')) walk(body, head);
            else if (!head.startsWith('@')) {
                const decls = {};
                for (const d of body.split(';')) {
                    const k = d.indexOf(':');
                    if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim();
                }
                rules.push({ order: rules.length, media, selectors: head.split(',').map((x) => x.trim().replace(/\s+/g, ' ')), decls });
            }
            i = j;
        }
    };
    walk(src, null);
    return rules;
}

test('under reduced motion the hairline meter holds still: no rule of the meter keeps its animation', () => {
    // Each rule that animates the meter needs a reduced-motion rule for the
    // same selector, later in the file, that stops it: a looser selector
    // (.loading-progress-bar alone) loses to .loading-meter.is-indeterminate
    // .loading-progress-bar on specificity, whatever its place.
    const rules = cssRules(css);
    const motion = (r) => r.decls.animation ?? r.decls['animation-name'];
    const reduced = rules.filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.media || ''));
    const moving = rules.filter((r) => !/prefers-reduced-motion/.test(r.media || '') && motion(r) && !/^none\b/.test(motion(r)));
    const meter = moving.flatMap((r) => r.selectors.filter((s) => /loading-(meter|progress-bar)/.test(s)).map((s) => [s, r]));
    assert.ok(meter.some(([s]) => s === '.loading-meter.is-indeterminate .loading-progress-bar'), 'the indeterminate meter no longer animates; update this test');
    for (const [selector, rule] of meter) {
        const still = reduced.find((r) => r.order > rule.order && r.selectors.includes(selector) && /^none\b/.test(motion(r) || ''));
        assert.ok(still, `under prefers-reduced-motion: reduce, ${selector} keeps animation: ${motion(rule)}`);
    }
    // The parser reads the file as the browser would on these rules.
    assert.deepEqual(cssRules('a{x:1}@media (m){b,c d{y:2;z:3}}@keyframes k{from{t:0}}e{animation:none}').map((r) => [r.media, r.selectors, r.decls]),
        [[null, ['a'], { x: '1' }], ['@media (m)', ['b', 'c d'], { y: '2', z: '3' }], [null, ['e'], { animation: 'none' }]]);
});

test('one quiet loader: the hairline meter, held still under reduced motion, and no ring or shimmer', () => {
    assert.doesNotMatch(html, /studies-loading-screen/, 'the full-tab loading screen came back');
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.loading-meter\.is-indeterminate \.loading-progress-bar \{/, 'the reduced-motion rule for the meter is gone');
    const block = css.slice(css.indexOf('/* ===== Study details on demand'), css.indexOf('/* Tufte-style table design'));
    assert.ok(block.length > 0, 'styles.css lost the study-details block');
    assert.doesNotMatch(block, /animation|@keyframes|border-radius: 50%|gradient/, 'the study-details styles add motion or a spinner of their own');
    for (const cls of ['.extras-status', '.detail-state', '.detail-action', '.cell-pending', '.cell-failed', '.cell-na']) {
        assert.ok(block.includes(`${cls} {`) || block.includes(`${cls},`), `styles.css has no ${cls} rule`);
    }
    for (const token of block.match(/var\(--[a-z-]+\)/g)) {
        assert.match(css.slice(0, css.indexOf('}')), new RegExp(`${token.slice(4, -1)}:`), `${token} is not a token from :root`);
    }
    assert.match(READER, /class="loading-meter is-indeterminate" role="progressbar"/);
});
