/**
 * The newest published date is the latest dataset. history.json names the
 * date data/ serves ("latest", or the newest of "dates" in a history.json
 * written before that field existed), and the engine's retention change stops
 * copying that week into snapshots/<date>/. So the page reads that date from
 * data/ (datasetBase), keeps it under the 'latest' cache entry (datasetKey),
 * lists it in the archive selector as "YYYY-MM-DD (latest)", and learns it
 * when the cache key resolves, not when the selector fills: a shared
 * ?sgsnapshot=<newest> link must never ask for snapshots/<newest>/.
 *
 * The cache-key block, datasetKey, datasetBase, getUrlStrategies, loadData,
 * initHistorySelector and sgRouteHooks run in a vm with a stub fetch that
 * records every request; the parts are served as JSON (fetchAndDecompress is
 * reduced to keyedFetch + json, its own behaviour is study_sidecars'), and
 * everything the selector redraws is a stub. Timers fire only when a test
 * says so.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function fnSource(sig) {
    const at = app.indexOf(sig);
    assert.ok(at >= 0, `app.js lost ${sig}`);
    return app.slice(at, app.indexOf('\n}\n', at) + 2);
}

const keyStart = app.indexOf('let DATA_CACHE_VERSION =');
const keyEnd = app.indexOf('\n}\n', app.indexOf('async function fetchChecked(path, stampOf)')) + 2;
assert.ok(keyStart >= 0 && keyEnd > keyStart, 'app.js lost the cache key block');

const SOURCES = [
    app.slice(keyStart, keyEnd),
    fnSource('function partsFromDifferentRuns(parts)'),
    fnSource('function stalePartIndexes(parts, expectedStamp)'),
    fnSource('async function refetchStaleParts(parts, expectedStamp, refetch)'),
    app.slice(app.indexOf('const NUM_PARTS ='), app.indexOf('\n', app.indexOf('const NUM_PARTS ='))),
    fnSource('function partFiles(n)'),
    fnSource('function datasetKey(date)'),
    fnSource('function datasetBase(key)'),
    fnSource('function getUrlStrategies(date)'),
    // loadData's part fetch: a 4xx is asked for again past the cache.
    'const PARTS_PAST_CACHE = new Set();',
    fnSource('async function fetchPart(url, onProgress, init)'),
    fnSource('async function loadData(date)'),
    fnSource('function datasetLoaded()'),
    fnSource('function datasetStudyCount()'),
    fnSource('async function loadDataAndRender(date)'),
    fnSource('async function initHistorySelector()'),
    fnSource('function listHistoryDates(select, manifest)'),
    // The change handler drops what is not on screen (PR #253).
    'const sgCache = new Map();',
    fnSource('function retainSnapshots(onScreen)'),
    fnSource('function sgQueryParams(hash, search)'),
    fnSource('function sgRouteHooks()')
].join('\n');

// What loadData and the selector call around the paths under test.
const SCAFFOLD = `
let data = null; let datasetReader = null; let dashboardSummary = null; let studiesTabReady = false;
const snapshotCache = new Map();
const toasts = []; const sgLoads = []; let renders = 0; let overlays = 0;
async function fetchAndDecompress(url, onProgress, init) {
    const resp = await keyedFetch(url, init);
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + url);
    return resp.json();
}
function describePartsProgress() { return { fraction: 1, text: '' }; }
function updateLoadingProgress() {}
function requestAnimationFrame() { return 0; }
function cancelAnimationFrame() {}
function datasetLayout() { return null; }
function partsReader(key) { return { mode: 'inline', key, base: datasetBase(key) }; }
function aggregateReader(key) { return { mode: 'summary', key, base: datasetBase(key) }; }
function setDataPulledDate() {}
function showToast(message, type) { toasts.push({ message, type }); }
function showSnapshotLoading() { overlays++; }
function hideSnapshotLoading() {}
async function snapshotStage() {}
async function sgLoad(date) { sgLoads.push(date === undefined ? null : date); }
function syncYearWindow() {}
function populateConditionsDropdown() {}
function populateCountriesDropdown() {}
function populatePrimaryConditionDropdown() {}
function renderDashboard() { renders++; }
function labelChartsForA11y() {}
function updateShareUrl() {}
function sgOpenMethods() {}
function loadStudyColumns() { return new Set(); }
async function fetchLatestSummary() { return null; }
const SG_INITIAL_HASH = '';
const SG_INITIAL_SEARCH = location.search;
`;

const RUN = { extracted_at: '2026-10-04T12:09:21.454200+00:00', pipeline_commit: 'abc1234' };
const OLD_STAMP = '2026-08-02T06:11:00+00:00';
const DATES = ['2026-02-22', '2026-05-31', '2026-08-02', '2026-10-04'];
const NEW_HISTORY = { dates: DATES, latest: '2026-10-04', archives: { '2026-02-22': { kind: 'aggregate', detail: 'archive_records.json.gz' } } };
const OLD_HISTORY = { dates: DATES };

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const never = () => new Promise(() => {});
const tick = () => new Promise((r) => setImmediate(r));
const T = { timeout: 5000 };

// The eight parts of one dataset, in a folder, stamped with its run.
function parts(base, stamp, n = 8) {
    const out = {};
    for (let k = 1; k <= n; k++) out[`${base}/demographics.part${k}.json.gz`] = { extracted_at: stamp, part: k, total_parts: n, data: [{ nct_id: `NCT0000000${k}`, from: base }] };
    return out;
}

// The published site after the engine's retention change: data/ holds the
// newest week, and snapshots/<newest>/ does not exist. An older full week
// stays in snapshots/.
function site(history, extra = {}) {
    const files = { 'data/run.json': RUN, ...parts('data', RUN.extracted_at), ...parts('snapshots/2026-08-02', OLD_STAMP), ...extra };
    if (history !== undefined) files['history.json'] = history;
    return files;
}

/**
 * files: { path: body | Error | (() => promise) }. A missing path is a 404.
 * search: the query the page opened with (sgRouteHooks reads it).
 */
function harness(files, { search = '' } = {}) {
    const calls = [];
    const timers = [];
    const intervals = [];
    const els = {};
    const select = {
        id: 'history-date', value: 'latest', dataset: {}, options: [], handlers: [],
        appendChild(opt) { this.options.push(opt); },
        addEventListener(type, fn) { if (type === 'change') this.handlers.push(fn); },
        dispatchEvent() { this.fired = Promise.all(this.handlers.map((fn) => fn())); return true; }
    };
    const el = (id) => (id === 'history-date' ? select : (els[id] ||= { id, textContent: '', style: {}, classList: { add() {}, remove() {} } }));
    const ctx = vm.createContext({
        Date, Array, Promise, Map, Set, Error, JSON, Object, String, Number, URLSearchParams, Event: class { constructor(type) { this.type = type; } },
        console: { warn() {}, log() {}, error() {} },
        window: {},
        location: { search, hash: '' },
        isMobileDevice: false,
        document: { getElementById: el, createElement: () => ({}), querySelector: () => null },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        setInterval: (fn, ms) => { intervals.push({ fn, ms, live: true }); return intervals.length; },
        clearInterval: (id) => { if (intervals[id - 1]) intervals[id - 1].live = false; },
        fetch: async (url, init) => {
            calls.push(url);
            const path = url.replace(/\?v=.*$/, '');
            if (!(path in files)) return new Response('not found', { status: 404 });
            const f = files[path];
            if (f instanceof Error) throw f;
            if (typeof f === 'function') return f();
            return json(f);
        }
    });
    vm.runInContext(SOURCES + SCAFFOLD, ctx);
    const run = (src) => vm.runInContext(src, ctx);
    return {
        calls, timers, select, run,
        fireTimers: () => timers.splice(0).forEach((t) => t.fn()),
        // One beat of every live setInterval (sgRouteHooks polls the selector).
        beat: () => intervals.filter((i) => i.live).forEach((i) => i.fn()),
        paths: () => calls.map((u) => u.replace(/\?v=.*$/, '')),
        dataFrom: () => JSON.parse(run('JSON.stringify(data.map(r => r.from))'))
    };
}

// Startup as app.js runs it: the key, then the latest data, then (after the
// first render) the archive selector.
async function startup(h, { selector = true } = {}) {
    await h.run('dataKeyReady()');
    await h.run('loadData()');
    if (selector) await h.run('initHistorySelector()');
}

test('the newest published date is history.json\'s "latest", else the newest of "dates"', () => {
    const h = harness({});
    const newest = (m) => h.run(`newestPublishedIn(${JSON.stringify(m)})`);
    assert.equal(newest(NEW_HISTORY), '2026-10-04');
    assert.equal(newest(OLD_HISTORY), '2026-10-04', 'a history.json without "latest" names its newest date');
    assert.equal(newest({ dates: ['2026-10-04', '2026-08-02', 'not-a-date', 7] }), '2026-10-04', 'the order of "dates" decides nothing');
    assert.equal(newest({ dates: DATES, latest: '2026-10-11' }), '2026-10-11', '"latest" is what data/ serves, listed or not');
    for (const latest of ['latest', '2026-10', 20261004, null]) {
        assert.equal(newest({ dates: DATES, latest }), '2026-10-04', `a malformed "latest" (${latest}) is not taken`);
    }
    for (const none of [null, {}, { dates: [] }, { dates: 'x' }]) assert.equal(newest(none), null);
    // A manifest that names no date leaves the date an earlier one named.
    h.run(`noteNewestPublished(${JSON.stringify(NEW_HISTORY)})`);
    for (const none of [null, {}, { dates: [] }]) assert.equal(h.run(`noteNewestPublished(${JSON.stringify(none)})`), '2026-10-04');
    assert.equal(h.run('NEWEST_PUBLISHED'), '2026-10-04');
});

test('datasetBase maps the newest published date to data/, with "latest" and without it', async () => {
    for (const history of [NEW_HISTORY, OLD_HISTORY]) {
        const h = harness(site(history));
        await h.run('newestPublishedReady()');
        assert.equal(h.run('NEWEST_PUBLISHED'), '2026-10-04');
        for (const key of [undefined, 'latest', '2026-10-04']) {
            assert.equal(h.run(`datasetKey(${JSON.stringify(key)})`), 'latest');
            assert.equal(h.run(`datasetBase(${JSON.stringify(key)})`), 'data');
        }
        assert.equal(h.run("datasetKey('2026-08-02')"), '2026-08-02');
        assert.equal(h.run("datasetBase('2026-08-02')"), 'snapshots/2026-08-02');
        assert.deepEqual(JSON.parse(h.run("JSON.stringify(getUrlStrategies('2026-10-04')[0].urls)")),
            Array.from({ length: 8 }, (_, i) => `data/demographics.part${i + 1}.json.gz`));
    }
});

test('without a history.json every date is an archive, as before', async () => {
    for (const history of [undefined, new Error('offline'), {}, { dates: [] }]) {
        const h = harness(site(history));
        await h.run('newestPublishedReady()');
        assert.equal(h.run('NEWEST_PUBLISHED'), null);
        assert.equal(h.run("datasetBase('2026-10-04')"), 'snapshots/2026-10-04');
        assert.equal(h.run("datasetKey('2026-10-04')"), '2026-10-04');
    }
});

test('the newest date is known when the key resolves, before the archive selector fills', async () => {
    const h = harness(site(NEW_HISTORY));
    await startup(h, { selector: false });
    assert.equal(h.run('NEWEST_PUBLISHED'), '2026-10-04', 'the newest date waited for the archive selector');
    assert.equal(h.select.options.length, 0, 'the selector ran');
    // The direct path a shared link may take at startup: no snapshots/ request.
    await h.run("loadData('2026-10-04')");
    assert.deepEqual(h.paths().filter((p) => p.startsWith('snapshots/')), []);
});

test('a dated load waits for history.json even when run.json answered first', T, async () => {
    let answer;
    const late = new Promise((r) => { answer = r; });
    const h = harness(site(undefined, { 'history.json': () => late }));
    await h.run('dataKeyReady()');   // run.json answered: the key does not wait
    assert.equal(h.run('NEWEST_PUBLISHED'), null);
    const loading = h.run("loadData('2026-10-04')");
    await tick();
    assert.deepEqual(h.paths().filter((p) => p.includes('demographics')), [], 'the load did not wait for the newest date');
    answer(json(NEW_HISTORY));
    await loading;
    assert.deepEqual(h.paths().filter((p) => p.startsWith('snapshots/')), [], 'the newest date was asked of snapshots/');
    assert.deepEqual(h.dataFrom(), Array(8).fill('data'));
});

test('a history.json that never answers holds a dated load only for the wait, then reads it as an archive', T, async () => {
    const h = harness(site(undefined, { 'history.json': never, ...parts('snapshots/2026-10-04', RUN.extracted_at) }));
    await h.run('dataKeyReady()');
    const loading = h.run("loadData('2026-10-04')");
    await tick();
    h.fireTimers();
    await loading;
    assert.equal(h.run('NEWEST_PUBLISHED'), null);
    assert.equal(h.paths().filter((p) => p.startsWith('snapshots/2026-10-04/')).length, 8, 'as before this change');
});

test('the archive selector lists the newest date as "YYYY-MM-DD (latest)", its value the date', async () => {
    for (const history of [NEW_HISTORY, OLD_HISTORY]) {
        const h = harness(site(history));
        await startup(h);
        assert.deepEqual(h.select.options.map((o) => o.value), ['2026-10-04', '2026-08-02', '2026-05-31', '2026-02-22']);
        assert.deepEqual(h.select.options.map((o) => o.textContent), ['2026-10-04 (latest)', '2026-08-02', '2026-05-31', '2026-02-22']);
    }
    // A "latest" the dates do not list is still offered, so a link to it opens.
    const h = harness(site({ dates: ['2026-08-02'], latest: '2026-10-04' }));
    await startup(h);
    assert.deepEqual(h.select.options.map((o) => o.textContent), ['2026-10-04 (latest)', '2026-08-02']);
});

test('a history.json that failed at startup and answers the selector still names the newest date', async () => {
    let up = false;
    const files = site(undefined);
    const h = harness({ ...files, 'history.json': () => { if (!up) throw new Error('offline'); return json(NEW_HISTORY); } });
    await startup(h, { selector: false });
    assert.equal(h.run('NEWEST_PUBLISHED'), null);
    up = true;
    await h.run('initHistorySelector()');
    assert.equal(h.run('NEWEST_PUBLISHED'), '2026-10-04', 'the selector\'s answer was not taken');
    assert.equal(h.select.options[0].textContent, '2026-10-04 (latest)');
    assert.equal(h.run("datasetBase('2026-10-04')"), 'data');
});

test('choosing the newest date shows the latest data with no download', async () => {
    const h = harness(site(NEW_HISTORY));
    await startup(h);
    const before = h.calls.length;
    h.select.value = '2026-10-04';
    h.select.dispatchEvent();
    await h.select.fired;
    assert.equal(h.calls.length, before, `choosing the newest date fetched ${h.paths().slice(before).join(', ')}`);
    assert.equal(h.run('snapshotCache.size'), 1, 'a second copy of the latest data is held');
    assert.deepEqual(JSON.parse(h.run('JSON.stringify([...snapshotCache.keys()])')), ['latest']);
    assert.equal(h.run('overlays'), 0, 'the loading screen was shown for a dataset already on screen');
    assert.equal(h.select.dataset.lastValue, '2026-10-04', 'the selector keeps the date, so a copied link names it');
    assert.equal(h.run('datasetReader.key'), 'latest');
    assert.match(h.run('toasts[toasts.length - 1].message'), /\(cached\)/);
    assert.ok(!h.run('toasts').some((t) => t.type === 'error'));
    // And back to Latest: still nothing fetched.
    h.select.value = 'latest';
    h.select.dispatchEvent();
    await h.select.fired;
    assert.equal(h.calls.length, before);
    // An older week is still its own dataset, from its own folder.
    h.select.value = '2026-08-02';
    h.select.dispatchEvent();
    await h.select.fired;
    assert.equal(h.paths().slice(before).filter((p) => p.startsWith('snapshots/2026-08-02/demographics')).length, 8);
    assert.deepEqual(h.dataFrom(), Array(8).fill('snapshots/2026-08-02'));
    assert.equal(h.run('snapshotCache.size'), 2);
});

test('loadDataAndRender for the newest date reuses the latest entry too', async () => {
    const h = harness(site(NEW_HISTORY));
    await startup(h);
    const before = h.calls.length;
    await h.run("loadDataAndRender('2026-10-04')");
    assert.equal(h.calls.length, before);
    assert.equal(h.run('overlays'), 0);
    assert.equal(h.run('snapshotCache.size'), 1);
});

test('a ?sgsnapshot=<newest> link opens the latest data with no snapshots/ request and no 404', async () => {
    for (const history of [NEW_HISTORY, OLD_HISTORY]) {
        const h = harness(site(history), { search: '?sgsnapshot=2026-10-04' });
        await h.run('dataKeyReady()');
        await h.run('loadData()');
        h.run('sgRouteHooks()');
        h.beat();                      // the selector has not filled yet
        await h.run('initHistorySelector()');
        h.beat();
        await h.select.fired;
        assert.equal(h.select.value, '2026-10-04');
        assert.equal(h.select.dataset.lastValue, '2026-10-04', 'the link did not open its date');
        assert.deepEqual(h.paths().filter((p) => p.startsWith('snapshots/')), [], 'the newest date was asked of snapshots/');
        const missing = h.paths().filter((p) => !(p in site(history)));
        assert.deepEqual(missing, [], 'a request went to a file that is not published');
        assert.ok(!h.run('toasts').some((t) => t.type === 'error'), 'the link fell back with an error');
        assert.deepEqual(h.dataFrom(), Array(8).fill('data'));
        assert.deepEqual(JSON.parse(h.run('JSON.stringify(sgLoads)')), ['2026-10-04'], 'the parser files follow the link (sgLoad maps the date the same way)');
    }
});

test('a ?sgsnapshot link to an older week still opens that week from snapshots/', async () => {
    const h = harness(site(NEW_HISTORY), { search: '?sgsnapshot=2026-08-02' });
    await startup(h);
    h.run('sgRouteHooks()');
    h.beat();
    await h.select.fired;
    assert.equal(h.select.dataset.lastValue, '2026-08-02');
    assert.deepEqual(h.dataFrom(), Array(8).fill('snapshots/2026-08-02'));
});

test('every dated path goes through datasetKey: loadData, sgLoad and the selector\'s cache checks', () => {
    const load = fnSource('async function loadData(date)');
    assert.match(load, /if \(date && date !== 'latest'\) await newestPublishedReady\(\);\s*const cacheKey = datasetKey\(date\);\s*if \(cacheKey === 'latest'\) date = undefined;/);
    const sg = fnSource('async function sgLoad(date)');
    assert.match(sg, /if \(date && date !== 'latest'\) await newestPublishedReady\(\);\s*const key = datasetKey\(date\);\s*if \(key === 'latest'\) date = undefined;/);
    assert.match(fnSource('function sgBase(date)'), /return datasetBase\(date\);/);
    assert.match(fnSource('async function loadDataAndRender(date)'), /snapshotCache\.has\(datasetKey\(date\)\)/);
    assert.match(fnSource('async function initHistorySelector()'), /snapshotCache\.has\(datasetKey\(chosen\)\)/);
    // No folder is built from a date anywhere but datasetBase.
    assert.deepEqual([...app.matchAll(/`snapshots\/\$\{/g)].length, 1, 'a snapshots/ path is built outside datasetBase');
    // The newest date is taken where history.json is first read, at key resolution.
    assert.match(fnSource('async function resolveDataCacheVersion()'), /newestPublishedRequest = Promise\.race\(\[manifestRequest, deadline\]\)\.then\(noteNewestPublished\);/);
});

// ── history.json and data/ from different weeks (a deploy in progress) ──
// The newest date is read from data/ only when data/run.json is that date's
// run; otherwise it is an archive like any other, so one week's numbers are
// never shown under another week's date.

test('history.json ahead of data/: its newest date is not read from data/', async () => {
    const ahead = { dates: [...DATES, '2026-10-11'], latest: '2026-10-11' };
    const h = harness(site(ahead));   // data/run.json is still the 2026-10-04 run
    await startup(h);
    assert.equal(h.run('NEWEST_PUBLISHED'), '2026-10-11');
    assert.equal(h.run("datasetKey('2026-10-11')"), '2026-10-11', "the 10-11 date would show the 10-04 run's numbers");
    assert.equal(h.run("datasetBase('2026-10-11')"), 'snapshots/2026-10-11');
    assert.equal(h.select.options.find((o) => o.value === '2026-10-11').textContent, '2026-10-11', 'labelled latest before data/ holds it');
    assert.ok(!h.select.options.some((o) => /\(latest\)/.test(o.textContent)));
});

test('history.json behind data/: the date it calls newest is not read from data/', async () => {
    const newer = { extracted_at: '2026-10-11T06:12:00.000000+00:00', pipeline_commit: 'def5678' };
    const h = harness(site(NEW_HISTORY, { 'data/run.json': newer, ...parts('data', newer.extracted_at), ...parts('snapshots/2026-10-04', RUN.extracted_at) }));
    await startup(h);
    assert.equal(h.run('NEWEST_PUBLISHED'), '2026-10-04');
    assert.equal(h.run("datasetKey('2026-10-04')"), '2026-10-04', "the 10-04 date would show the 10-11 run's numbers");
    assert.ok(!h.select.options.some((o) => /\(latest\)/.test(o.textContent)));
    const before = h.paths().length;
    await h.run("loadData('2026-10-04')");
    const asked = h.paths().slice(before).filter((p) => p.includes('demographics'));
    assert.ok(asked.length === 8 && asked.every((p) => p.startsWith('snapshots/2026-10-04/')), `read from: ${asked.join(', ')}`);
});

test("run.json's snapshot_date decides the run's date when the engine writes one", async () => {
    // A run that starts just before midnight UTC: extracted_at says the next day.
    const late = { extracted_at: '2026-10-05T00:04:00.000000+00:00', pipeline_commit: 'abc1234', snapshot_date: '2026-10-04' };
    const h = harness(site(NEW_HISTORY, { 'data/run.json': late }));
    await h.run('newestPublishedReady()');
    assert.equal(h.run('DATA_RUN_DATE'), '2026-10-04');
    assert.equal(h.run("datasetKey('2026-10-04')"), 'latest');
    for (const bad of ['2026-10', 20261004, null]) {
        const g = harness(site(NEW_HISTORY, { 'data/run.json': { ...RUN, snapshot_date: bad } }));
        await g.run('newestPublishedReady()');
        assert.equal(g.run('DATA_RUN_DATE'), '2026-10-04', `a malformed snapshot_date (${bad}) is not taken; extracted_at's date is`);
    }
});

test('without a data/run.json the newest date is an archive, as on main today', async () => {
    const files = site(NEW_HISTORY, { ...parts('snapshots/2026-10-04', RUN.extracted_at) });
    delete files['data/run.json'];
    const h = harness(files);
    await h.run('newestPublishedReady()');
    assert.equal(h.run('NEWEST_PUBLISHED'), '2026-10-04');
    assert.equal(h.run('DATA_RUN_DATE'), null);
    assert.equal(h.run("datasetBase('2026-10-04')"), 'snapshots/2026-10-04');
});
