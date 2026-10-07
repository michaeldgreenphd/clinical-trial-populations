/**
 * A shared snapshot link downloads the snapshot, not the latest data first.
 *
 * updateShareUrl writes ?sgsnapshot=<date> whenever a snapshot is on screen.
 * Opening such a link used to load the latest parts, draw them, and only then
 * poll for the selector's option (a setInterval in sgRouteHooks) and switch,
 * downloading the snapshot's parts too: two full datasets for one view. The
 * start-up now reads the link (requestedSnapshot) and loads the snapshot in
 * place of the latest data (loadStartupDataset). A date history.json does
 * not list, a malformed one, or a history.json that does not answer in time
 * opens the latest data with no snapshot request and no toast (owner
 * decision 25b). A listed snapshot that fails to load opens the latest data
 * too, and says so once it is on screen (reportStartupFailure). Phones keep
 * ignoring the parameter.
 *
 * And the newest date when data/run.json was late: without it the run in
 * data/ is undated (DATA_RUN_DATE null), so the newest date is read as an
 * archive and asked of snapshots/<newest>/, which the engine's retention
 * change no longer writes. On that 404 the page reads run.json again past
 * the cache (recheckRun); if data/ holds that date's run, the run is taken
 * (adoptRecheckedRun: its stamp checks the parts, and latest data cached from
 * another run is dropped) and the date is served from data/. Otherwise the
 * date did not load. A run.json that dated data/ as another week is not
 * read again: the date stays an archive, as before.
 *
 * The cache-key block and the loaders run in a vm with a stub fetch that
 * records every request and the cache mode it asked for; timers fire only
 * when a test says so.
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
const line = (start) => {
    const at = app.indexOf(start);
    assert.ok(at >= 0, `app.js lost ${start}`);
    return app.slice(at, app.indexOf('\n', at));
};

const keyStart = app.indexOf('let DATA_CACHE_VERSION =');
const keyEnd = app.indexOf('\n}\n', app.indexOf('async function fetchChecked(path, stampOf)')) + 2;
assert.ok(keyStart >= 0 && keyEnd > keyStart, 'app.js lost the cache key block');

const SOURCES = [
    app.slice(keyStart, keyEnd),
    fnSource('function partsFromDifferentRuns(parts)'),
    fnSource('function stalePartIndexes(parts, expectedStamp)'),
    fnSource('async function refetchStaleParts(parts, expectedStamp, refetch)'),
    line('const NUM_PARTS ='),
    fnSource('function partFiles(n)'),
    fnSource('function datasetKey(date)'),
    fnSource('function datasetBase(key)'),
    fnSource('function getUrlStrategies(date)'),
    // The latest parts go through fetchPart (PR #257), and the start-up's
    // load of the latest data through loadStartupRecords, its Try again.
    'const PARTS_PAST_CACHE = new Set();',
    fnSource('async function fetchPart(url, onProgress, init)'),
    fnSource('async function loadData(date)'),
    fnSource('async function loadStartupRecords()'),
    fnSource('function datasetLoaded()'),
    fnSource('function datasetStudyCount()'),
    fnSource('function requestedSnapshot()'),
    fnSource('async function startupSnapshot(requested)'),
    fnSource('async function loadStartupDataset(requested)'),
    fnSource('function reportStartupFailure(failed)'),
    fnSource('function selectSnapshotOption(date)'),
    line('const RUN_RECHECK_WAIT_MS ='),
    fnSource('async function recheckRun()'),
    fnSource('function adoptRecheckedRun(run)'),
    fnSource('function listHistoryDates(select, manifest)'),
    fnSource('async function initHistorySelector()'),
    'const sgCache = new Map();',
    fnSource('function retainSnapshots(onScreen)'),
    fnSource('function sgQueryParams(hash, search)'),
    fnSource('function initFilterSummary()')
].join('\n');

const SCAFFOLD = `
let data = null; let datasetReader = null; let dashboardSummary = null; let studiesTabReady = false;
const snapshotCache = new Map();
const toasts = []; const sgLoads = []; let overlays = 0;
async function fetchAndDecompress(url, onProgress, init) {
    const resp = await keyedFetch(url, init);
    if (!resp.ok) { const err = new Error('HTTP ' + resp.status + ' for ' + url); err.status = resp.status; throw err; }
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
function renderDashboard() {}
function renderIndustryAfterSwitch() {}   // no Industry view open (industry_switch.test.mjs)
function labelChartsForA11y() {}
function updateShareUrl() {}
async function fetchLatestSummary() { return null; }
// The first view's side of the start-up (PR #257): the startup load closes
// it, and a failed load of the latest data is offered again with Try again
// (startupFailed's retry), which a test presses.
let firstViewClosed = false;
const startupFailures = []; let retryStartup = null; let retries = 0;
function startupFailed(err, retry) { startupFailures.push(err.message); retryStartup = retry || null; }
function startupRetrying() { retries++; retryStartup = null; }
`;

const RUN = { extracted_at: '2026-10-04T12:09:21.454200+00:00', pipeline_commit: 'abc1234' };
const OLD_STAMP = '2026-08-02T06:11:00+00:00';
const DATES = ['2026-02-22', '2026-05-31', '2026-08-02', '2026-10-04'];
const HISTORY = { dates: DATES, latest: '2026-10-04' };

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const never = () => new Promise(() => {});
const tick = () => new Promise((r) => setImmediate(r));
const T = { timeout: 5000 };

function parts(base, stamp, n = 8) {
    const out = {};
    for (let k = 1; k <= n; k++) out[`${base}/demographics.part${k}.json.gz`] = { extracted_at: stamp, part: k, total_parts: n, data: [{ nct_id: `NCT0000000${k}`, from: base }] };
    return out;
}

// The site after the engine's retention change: data/ holds the newest week,
// snapshots/<newest>/ does not exist, an older full week stays in snapshots/.
function site(extra = {}) {
    return { 'history.json': HISTORY, 'data/run.json': RUN, ...parts('data', RUN.extracted_at), ...parts('snapshots/2026-08-02', OLD_STAMP), ...extra };
}

/**
 * files: { path: body | Error | ((init) => promise) }. A missing path is a 404.
 * search / hash: what the page opened with. mobile: a phone.
 */
function harness(files, { search = '', hash = '', mobile = false } = {}) {
    const calls = [];
    const timers = [];
    const select = {
        id: 'history-date', value: 'latest', dataset: {}, options: [], handlers: [],
        // As in the DOM, removing the selected option selects the first one left.
        appendChild(opt) {
            const sel = this; const all = this.options;
            opt.remove = () => { all.splice(all.indexOf(opt), 1); if (sel.value === opt.value) sel.value = all.length ? all[0].value : ''; };
            all.push(opt);
        },
        addEventListener(type, fn) { if (type === 'change') this.handlers.push(fn); },
        dispatchEvent() { this.fired = Promise.all(this.handlers.map((fn) => fn())); return true; }
    };
    // The page's own first option, as index.html writes it.
    select.appendChild({ value: 'latest', textContent: 'Latest' });
    const els = {};
    const el = (id) => (id === 'history-date' ? select : (els[id] ||= {
        id, textContent: '', hidden: false, style: {}, listeners: [], attrs: {},
        addEventListener(type, fn) { this.listeners.push(type); },
        setAttribute(k, v) { this.attrs[k] = v; }
    }));
    const ctx = vm.createContext({
        Date, Array, Promise, Map, Set, Error, JSON, Object, String, Number, URLSearchParams,
        console: { warn() {}, log() {}, error() {} },
        window: {},
        location: { search, hash },
        isMobileDevice: mobile,
        SG_INITIAL_SEARCH: search, SG_INITIAL_HASH: hash,
        document: { getElementById: el, createElement: () => ({}), querySelector: () => null },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        fetch: async (url, init) => {
            calls.push({ url, cache: init && init.cache });
            const path = url.replace(/\?v=.*$/, '');
            if (!(path in files)) return new Response('not found', { status: 404 });
            const f = files[path];
            if (f instanceof Error) throw f;
            if (typeof f === 'function') return f(init);
            return json(f);
        }
    });
    vm.runInContext(SOURCES + SCAFFOLD, ctx);
    const run = (src) => vm.runInContext(src, ctx);
    return {
        calls, timers, select, els, run,
        fireTimers: () => timers.splice(0).forEach((t) => t.fn()),
        paths: () => calls.map((c) => c.url.replace(/\?v=.*$/, '')),
        dataFrom: () => JSON.parse(run('JSON.stringify(data.map(r => r.from))')),
        // The start-up as app.js runs it: the key, the one dataset, the
        // selector named before the first share URL, the selector filled,
        // and a listed snapshot that did not load reported.
        async startup() {
            await run('dataKeyReady()');
            return finishStartup(run);
        }
    };
}

// Everything the start-up does after the key, as app.js orders it.
async function finishStartup(run) {
    await run('loadStartupDataset(requestedSnapshot()).then(r => { globalThis.__startup = r; })');
    const opened = run('__startup.opened');
    if (opened) run(`selectSnapshotOption(${JSON.stringify(opened)})`);
    await run('initHistorySelector()');
    run('if (__startup.failed) reportStartupFailure(__startup.failed)');
    return opened;
}

const toasts = (h) => JSON.parse(h.run('JSON.stringify(toasts)'));
const demographics = (h) => h.paths().filter((p) => p.includes('demographics'));
const partsIn = (base) => Array.from({ length: 8 }, (_, i) => `${base}/demographics.part${i + 1}.json.gz`);

test('the snapshot a link names is read from the query or the hash, on desktop only', () => {
    const ask = (opts) => harness(site(), opts).run('requestedSnapshot()');
    assert.equal(ask({ search: '?sgsnapshot=2026-08-02' }), '2026-08-02');
    // the routing stubs move the query into the hash
    assert.equal(ask({ hash: '#sex?sg=v2&sgsnapshot=2026-08-02' }), '2026-08-02');
    for (const bad of ['latest', '2026-8-2', '2026-08-02x', '']) {
        assert.equal(ask({ search: `?sgsnapshot=${bad}` }), null, `a malformed date (${bad}) was taken`);
    }
    assert.equal(ask({}), null);
    assert.equal(ask({ search: '?sgsnapshot=2026-08-02', mobile: true }), null, 'a phone honoured the link');
});

test('a link to a listed snapshot loads that snapshot first, and only it', async () => {
    for (const opts of [{ search: '?sgsnapshot=2026-08-02' }, { hash: '#race?sgsnapshot=2026-08-02' }]) {
        const h = harness(site(), opts);
        assert.equal(await h.startup(), '2026-08-02');
        assert.deepEqual(demographics(h), partsIn('snapshots/2026-08-02'), 'the latest parts were fetched too, or first');
        assert.deepEqual(h.dataFrom(), Array(8).fill('snapshots/2026-08-02'));
        assert.deepEqual(JSON.parse(h.run('JSON.stringify(sgLoads)')), ['2026-08-02'], 'the parser files are not the snapshot\'s');
        assert.deepEqual(JSON.parse(h.run('JSON.stringify([...snapshotCache.keys()])')), ['2026-08-02'], 'a second dataset is held');
        assert.deepEqual(toasts(h), []);
        // The selector names it, in order, and a failed switch reverts to it.
        assert.equal(h.select.value, '2026-08-02');
        assert.equal(h.select.dataset.lastValue, '2026-08-02');
        assert.deepEqual(h.select.options.map((o) => o.value), ['latest', '2026-10-04', '2026-08-02', '2026-05-31', '2026-02-22']);
    }
});

test('a link to the newest date opens the latest data from data/ and keeps the date in the selector', async () => {
    const h = harness(site(), { search: '?sgsnapshot=2026-10-04' });
    assert.equal(await h.startup(), '2026-10-04');
    assert.deepEqual(demographics(h), partsIn('data'));
    assert.equal(h.select.value, '2026-10-04');
    assert.equal(h.select.options.find((o) => o.value === '2026-10-04').textContent, '2026-10-04 (latest)');
    assert.equal(h.select.options.filter((o) => o.value === '2026-10-04').length, 1, 'the option is listed twice');
    // A "latest" that "dates" does not list is still the date data/ serves.
    const g = harness(site({ 'history.json': { dates: ['2026-08-02'], latest: '2026-10-04' } }), { search: '?sgsnapshot=2026-10-04' });
    assert.equal(await g.startup(), '2026-10-04');
    assert.deepEqual(demographics(g), partsIn('data'));
});

test('an unlisted or malformed date opens the latest data with no snapshot request and no toast', async () => {
    for (const search of ['?sgsnapshot=2026-07-05', '?sgsnapshot=2026-7-5', '?sgsnapshot=latest']) {
        const h = harness(site(), { search });
        assert.equal(await h.startup(), null, search);
        assert.deepEqual(h.paths().filter((p) => p.startsWith('snapshots/')), [], `${search} asked snapshots/`);
        assert.deepEqual(demographics(h), partsIn('data'));
        assert.deepEqual(toasts(h), [], `${search} showed a toast`);
        assert.equal(h.select.value, 'latest');
        assert.equal(h.select.dataset.lastValue, 'latest');
    }
});

test('without an answer from history.json the link opens the latest data, after the key\'s wait only', T, async () => {
    // history.json missing
    const gone = site();
    delete gone['history.json'];
    const h = harness(gone, { search: '?sgsnapshot=2026-08-02' });
    await h.run('dataKeyReady()');
    assert.equal(await h.run('loadStartupDataset(requestedSnapshot()).then(r => r.opened || r.failed)'), null);
    assert.deepEqual(h.paths().filter((p) => p.startsWith('snapshots/')), []);
    assert.deepEqual(toasts(h), []);

    // history.json stalled: nothing loads until the key's wait for it is over
    const s = harness(site({ 'history.json': never }), { search: '?sgsnapshot=2026-08-02' });
    await s.run('dataKeyReady()');
    const opening = s.run('loadStartupDataset(requestedSnapshot()).then(r => r.opened || r.failed)');
    await tick();
    assert.deepEqual(demographics(s), [], 'the load went ahead before history.json could answer');
    assert.ok(s.timers.length > 0 && s.timers.every((t) => t.ms === 5000), 'the start-up set a wait of its own');
    s.fireTimers();
    assert.equal(await opening, null, 'a stalled history.json held up the start-up');
    assert.deepEqual(s.paths().filter((p) => p.startsWith('snapshots/')), []);
    assert.deepEqual(demographics(s), partsIn('data'));
    assert.deepEqual(toasts(s), []);
});

test('a phone ignores the link and loads its summary', async () => {
    const h = harness(site(), { search: '?sgsnapshot=2026-08-02', mobile: true });
    await h.run('dataKeyReady()');
    assert.equal(await h.run('loadStartupDataset(requestedSnapshot()).then(r => r.opened || r.failed)'), null);
    assert.deepEqual(h.paths().filter((p) => p.startsWith('snapshots/')), []);
});

test('a listed snapshot that does not load gives way to the latest data, and says so', async () => {
    const h = harness(site(), { search: '?sgsnapshot=2026-05-31' });   // listed, nothing published
    assert.equal(await h.startup(), null);
    assert.deepEqual(demographics(h).filter((p) => p.startsWith('data/')), partsIn('data'));
    assert.deepEqual(h.dataFrom(), Array(8).fill('data'));
    assert.deepEqual(JSON.parse(h.run('JSON.stringify(sgLoads)')), [null]);
    assert.equal(h.select.value, 'latest');
    // Decision 25b's silence covers a date history.json does not list; a
    // listed one that fails is reported, as the selector's switch reports it.
    const said = toasts(h);
    assert.equal(said.length, 1, JSON.stringify(said));
    assert.equal(said[0].type, 'error');
    assert.match(said[0].message, /^Snapshot "2026-05-31" unavailable: Could not load data for 2026-05-31: .*\. Showing the latest data\.$/);

    // Parts from two runs (a deploy in progress): the actionable message.
    const mixed = site();
    mixed['snapshots/2026-08-02/demographics.part3.json.gz'] = { extracted_at: '2026-08-09T06:00:00+00:00', part: 3, total_parts: 8, data: [] };
    const g = harness(mixed, { search: '?sgsnapshot=2026-08-02' });
    assert.equal(await g.startup(), null);
    assert.deepEqual(g.dataFrom(), Array(8).fill('data'));
    const told = toasts(g);
    assert.equal(told.length, 1, JSON.stringify(told));
    assert.match(told[0].message, /^Snapshot "2026-08-02" unavailable: .*different weekly runs.*refresh in a few minutes\. Showing the latest data\.$/);
});

// ── data/run.json late: the newest date was taken for an archive ──

// run.json that misses the first wait and answers its second, uncached read.
function lateRun(second = () => json(RUN)) {
    const seen = [];
    return {
        seen,
        file: (init) => {
            seen.push(init && init.cache);
            return seen.length === 1 ? never() : second();
        }
    };
}

async function lateStartup(h) {
    const key = h.run('dataKeyReady()');
    await tick();
    h.fireTimers();                 // run.json missed its wait
    await key;
    assert.equal(h.run('DATA_RUN_DATE'), null);
    return finishStartup(h.run);
}

test('a late run.json: the newest date is read again from run.json and opened from data/', T, async () => {
    const run = lateRun();
    const h = harness(site({ 'data/run.json': run.file }), { search: '?sgsnapshot=2026-10-04' });
    assert.equal(await lateStartup(h), '2026-10-04');
    assert.deepEqual(run.seen, ['no-cache', 'no-store'], 'run.json was not read again past the cache');
    assert.deepEqual(h.paths().filter((p) => p.startsWith('snapshots/')), partsIn('snapshots/2026-10-04'),
        'the newest date should be asked of snapshots/ once, before the re-read');
    assert.deepEqual(demographics(h).filter((p) => p.startsWith('data/')), partsIn('data'));
    assert.deepEqual(h.dataFrom(), Array(8).fill('data'));
    assert.equal(h.run('DATA_RUN_DATE'), '2026-10-04');
    assert.deepEqual(JSON.parse(h.run('JSON.stringify([...snapshotCache.keys()])')), ['latest']);
    assert.deepEqual(JSON.parse(h.run('JSON.stringify(sgLoads)')), ['2026-10-04']);
    assert.ok(!h.paths().includes('snapshots/2026-10-04/dashboard-summary.json'), 'an archive summary was asked for the newest date');
    assert.equal(h.select.value, '2026-10-04');
    assert.equal(h.select.options.find((o) => o.value === '2026-10-04').textContent, '2026-10-04 (latest)');
    assert.deepEqual(toasts(h), []);
});

test('a late run.json that dates data/ otherwise, or stays silent, opens the latest data and says the date did not load', T, async () => {
    const other = { extracted_at: '2026-09-27T12:00:00+00:00' };
    for (const [label, second] of [['another week', () => json(other)], ['no run.json', () => new Response('', { status: 404 })], ['silent', never]]) {
        const run = lateRun(second);
        const h = harness(site({ 'data/run.json': run.file }), { search: '?sgsnapshot=2026-10-04' });
        const opening = lateStartup(h);
        if (label === 'silent') {
            // lateStartup fires the key's wait; then the re-read sets its own.
            for (let i = 0; i < 50 && !h.timers.some((t) => t.ms === 10000); i++) await tick();
            assert.deepEqual(h.timers.map((t) => t.ms), [10000], 'the re-read has no bounded wait, or not twice the key\'s');
            h.fireTimers();
        }
        assert.equal(await opening, null, label);
        assert.equal(run.seen[1], 'no-store', label);
        assert.equal(h.run('DATA_RUN_DATE'), null, label);
        assert.deepEqual(h.dataFrom(), Array(8).fill('data'), label);
        assert.ok(!h.paths().includes('snapshots/2026-10-04/dashboard-summary.json'), `${label}: an archive summary was asked for the newest date`);
        const said = toasts(h);
        assert.equal(said.length, 1, `${label}: ${JSON.stringify(said)}`);
        assert.match(said[0].message, /^Snapshot "2026-10-04" unavailable: .*Showing the latest data\.$/, label);
        assert.equal(h.select.value, 'latest', label);
    }
});

test('an older snapshot missing from snapshots/, or a failed connection, does not read run.json again', async () => {
    const run = lateRun();
    const h = harness(site({ 'data/run.json': run.file }), { search: '?sgsnapshot=2026-05-31' });
    assert.equal(await lateStartup(h), null);
    assert.deepEqual(run.seen, ['no-cache'], 'run.json was read again for a date data/ cannot hold');
    // Nor does a dropped connection: only a 404 says the newest week is not in snapshots/.
    const offline = {};
    for (const p of partsIn('snapshots/2026-10-04')) offline[p] = new Error('offline');
    const late = lateRun();
    const g = harness(site({ 'data/run.json': late.file, ...offline }), { search: '?sgsnapshot=2026-10-04' });
    assert.equal(await lateStartup(g), null);
    assert.deepEqual(late.seen, ['no-cache'], 'run.json was read again after a network error');
});

test('choosing the newest date in the selector after a late run.json serves it from data/ too', T, async () => {
    const run = lateRun();
    const h = harness(site({ 'data/run.json': run.file }));
    assert.equal(await lateStartup(h), null);
    h.select.value = '2026-10-04';
    h.select.dispatchEvent();
    await h.select.fired;
    assert.equal(h.select.dataset.lastValue, '2026-10-04');
    assert.ok(!toasts(h).some((t) => t.type === 'error'), JSON.stringify(toasts(h)));
    assert.equal(h.run('datasetReader.key'), 'latest');
    assert.deepEqual(demographics(h).filter((p) => p.startsWith('data/')), partsIn('data'), 'data/ was fetched twice');
});

// ── run.json and data/ from different weeks: never one week under another's date ──

const PREV = { extracted_at: '2026-09-27T12:00:00+00:00', pipeline_commit: 'prev123' };

// data/'s parts as a deploy leaves them: the run stampOf(init) names, tagged
// with it so the test can tell which week is on screen.
function weekParts(stampOf) {
    const out = {};
    for (let k = 1; k <= 8; k++) {
        out[`data/demographics.part${k}.json.gz`] = (init) => {
            const stamp = stampOf(init);
            return json({ extracted_at: stamp, part: k, total_parts: 8, data: [{ nct_id: `NCT0000000${k}`, from: `data@${stamp.slice(0, 10)}` }] });
        };
    }
    return out;
}

test('run.json that dated data/ as the previous week: choosing the newest date does not show that week under it', async () => {
    // At load run.json and data/ are still the 09-27 run; then the deploy settles.
    let settled = false;
    const runSeen = [];
    const h = harness(site({
        'data/run.json': (init) => { runSeen.push(init && init.cache); return json(settled ? RUN : PREV); },
        ...weekParts(() => (settled ? RUN : PREV).extracted_at)
    }));
    assert.equal(await h.startup(), null);
    assert.equal(h.run('DATA_RUN_DATE'), '2026-09-27');
    settled = true;
    h.select.value = '2026-10-04';
    h.select.dispatchEvent();
    await h.select.fired;
    assert.deepEqual(runSeen, ['no-cache'], 'run.json was read again although it had dated data/');
    assert.equal(h.run('DATA_RUN_DATE'), '2026-09-27');
    assert.deepEqual(h.dataFrom(), Array(8).fill('data@2026-09-27'));
    const said = toasts(h);
    assert.ok(!said.some((t) => t.type === 'info'), `the switch said it loaded: ${JSON.stringify(said)}`);
    assert.ok(said.some((t) => t.type === 'error' && t.message.startsWith('Snapshot "2026-10-04" unavailable')), JSON.stringify(said));
    assert.equal(h.select.value, 'latest');
    assert.equal(h.select.dataset.lastValue, 'latest');
});

test('a start-up link to the newest date while run.json dates data/ as the previous week opens the latest data under its own date, and says so', async () => {
    let settled = false;
    const runSeen = [];
    const h = harness(site({
        'data/run.json': (init) => { runSeen.push(init && init.cache); const r = settled ? RUN : PREV; settled = true; return json(r); },
        // the browser still holds the old parts; only a reload reaches the new ones
        ...weekParts((init) => (init && init.cache === 'reload' ? RUN : PREV).extracted_at)
    }), { search: '?sgsnapshot=2026-10-04' });
    assert.equal(await h.startup(), null);
    assert.deepEqual(runSeen, ['no-cache']);
    assert.equal(h.run('DATA_RUN_DATE'), '2026-09-27');
    assert.equal(h.run('LATEST_RUN_STAMP'), PREV.extracted_at);
    assert.deepEqual(h.dataFrom(), Array(8).fill('data@2026-09-27'));
    assert.equal(h.select.value, 'latest');
    assert.equal(h.select.options.find((o) => o.value === '2026-10-04').textContent, '2026-10-04', 'the newest date is labelled as the data on screen');
    const said = toasts(h);
    assert.equal(said.length, 1, JSON.stringify(said));
    assert.match(said[0].message, /^Snapshot "2026-10-04" unavailable: .*Showing the latest data\.$/);
});

test('a late run.json: the latest data cached from an earlier run is not reused for the newest date', T, async () => {
    // run.json misses its wait; data/ still holds the previous week, so the
    // latest data on screen is that week. Then the deploy settles.
    let settled = false;
    const run = lateRun();
    const h = harness(site({ 'data/run.json': run.file, ...weekParts(() => (settled ? RUN : PREV).extracted_at) }));
    assert.equal(await lateStartup(h), null);
    assert.deepEqual(h.dataFrom(), Array(8).fill('data@2026-09-27'));
    settled = true;
    h.select.value = '2026-10-04';
    h.select.dispatchEvent();
    await h.select.fired;
    assert.deepEqual(run.seen, ['no-cache', 'no-store']);
    assert.equal(h.run('LATEST_RUN_STAMP'), RUN.extracted_at, 'the re-read run\'s stamp was not taken');
    assert.deepEqual(h.dataFrom(), Array(8).fill('data@2026-10-04'), 'the previous week was shown under the newest date');
    assert.deepEqual(demographics(h).filter((p) => p.startsWith('data/')), [...partsIn('data'), ...partsIn('data')]);
    assert.equal(h.select.dataset.lastValue, '2026-10-04');
    assert.deepEqual(JSON.parse(h.run('JSON.stringify([...snapshotCache.keys()])')), ['latest']);
    assert.equal(h.run("snapshotCache.get('latest').data === data"), true);
});

test('a late run.json: a start-up link checks data/\'s parts against the re-read run', T, async () => {
    // The browser holds the previous week's parts under the date key; only
    // a reload reaches the run run.json names.
    const run = lateRun();
    const h = harness(site({ 'data/run.json': run.file, ...weekParts((init) => (init && init.cache === 'reload' ? RUN : PREV).extracted_at) }),
        { search: '?sgsnapshot=2026-10-04' });
    assert.equal(await lateStartup(h), '2026-10-04');
    assert.equal(h.run('LATEST_RUN_STAMP'), RUN.extracted_at);
    assert.deepEqual(h.dataFrom(), Array(8).fill('data@2026-10-04'), 'parts from another run were shown as 2026-10-04 (latest)');
    assert.equal(h.calls.filter((c) => c.url.startsWith('data/demographics') && c.cache === 'reload').length, 8);
    assert.deepEqual(toasts(h), []);
});

// ── With the first view (PR #257) ──
// A link naming sgsnapshot never paints the first view (firstViewProblem;
// tests/first_view.test.mjs), so its start-up has no strip under an Overview:
// what goes wrong is said on the loading screen, then in the toast.

test('the start-up load closes the first view, whichever dataset it opens', async () => {
    for (const search of ['', '?sgsnapshot=2026-08-02', '?sgsnapshot=2026-07-05', '?sgsnapshot=2026-05-31']) {
        const h = harness(site(), { search });
        assert.equal(h.run('firstViewClosed'), false);
        await h.startup();
        assert.equal(h.run('firstViewClosed'), true, `${search || 'no link'}: a summary answering now could still paint`);
        assert.deepEqual(JSON.parse(h.run('JSON.stringify(startupFailures)')), [], search);
    }
});

test('a listed snapshot that fails, then latest data that fails once: one failure on screen at a time, then the toast', async () => {
    // snapshots/2026-05-31/ holds nothing; data/'s part 3 answers 503 once.
    let asked = 0;
    const flaky = site({
        'data/demographics.part3.json.gz': () => (++asked === 1
            ? new Response('busy', { status: 503 })
            : json({ extracted_at: RUN.extracted_at, part: 3, total_parts: 8, data: [{ nct_id: 'NCT00000003', from: 'data' }] }))
    });
    const h = harness(flaky, { search: '?sgsnapshot=2026-05-31' });
    await h.run('dataKeyReady()');
    const startup = finishStartup(h.run);
    // Wait for the latest data's failure to reach the loading screen.
    for (let i = 0; i < 50 && !h.run('retryStartup'); i++) await tick();
    // The loading screen says the latest data stopped, with Try again; the
    // snapshot's failure waits for the page to be up.
    const failures = JSON.parse(h.run('JSON.stringify(startupFailures)'));
    assert.equal(failures.length, 1, JSON.stringify(failures));
    assert.match(failures[0], /HTTP 503 for data\/demographics\.part3/);
    assert.equal(typeof h.run('retryStartup'), 'function', 'the latest data is not offered again');
    assert.deepEqual(toasts(h), [], 'the snapshot was reported over the loading screen');
    // Try again: the part that failed goes past the browser cache; the
    // snapshot is not asked for again.
    const before = h.calls.length;
    h.run('retryStartup()');
    assert.equal(await startup, null);
    const again = h.calls.slice(before);
    assert.deepEqual(again.filter((c) => c.url.includes('part3')).map((c) => c.cache), ['reload']);
    assert.deepEqual(again.filter((c) => c.url.includes('snapshots/')), [], 'Try again asked the snapshot again');
    assert.equal(h.run('retries'), 1);
    assert.deepEqual(h.dataFrom(), Array(8).fill('data'));
    assert.equal(h.run('firstViewClosed'), true);
    assert.deepEqual(JSON.parse(h.run('JSON.stringify(sgLoads)')), [null]);
    assert.equal(h.select.value, 'latest');
    // Once up, the snapshot's failure is said once.
    const said = toasts(h);
    assert.equal(said.length, 1, JSON.stringify(said));
    assert.match(said[0].message, /^Snapshot "2026-05-31" unavailable: .*\. Showing the latest data\.$/);
});

test('a snapshot link\'s own failure is not offered again: only the latest data has Try again', async () => {
    // The snapshot fails and the latest data loads: no Try again at all.
    const h = harness(site(), { search: '?sgsnapshot=2026-05-31' });
    await h.startup();
    assert.deepEqual(JSON.parse(h.run('JSON.stringify(startupFailures)')), []);
    assert.equal(h.run('retries'), 0);
    // A snapshot's parts are fixed once listed: a 404 is not asked again past
    // the cache (fetchPart is for the latest parts only).
    assert.deepEqual(h.calls.filter((c) => c.url.startsWith('snapshots/') && c.cache === 'reload'), []);
});

// ── The start-up and the hooks around it ──

const init = (() => {
    const start = app.indexOf("document.addEventListener('DOMContentLoaded', async () => {");
    return app.slice(start, app.indexOf('\n});\n', start));
})();

test('the start-up\'s first data load is the link\'s dataset, and the selector names it before the first share URL', () => {
    const at = (needle) => {
        const i = init.indexOf(needle);
        assert.ok(i >= 0, `start-up lost ${needle}`);
        return i;
    };
    assert.ok(at('const requested = requestedSnapshot();') < at('await keyReady;'));
    assert.ok(at('await keyReady;') < at('const { opened, failed: startupFailure } = await loadStartupDataset(requested);'));
    assert.ok(!/await loadData\(|await sgLoad\(/.test(init), 'the start-up loads a dataset of its own');
    assert.ok(at('if (opened) selectSnapshotOption(opened);') < at('shareUrlReady = true;'),
        'the first share URL is written before the selector names the snapshot, so the address drops it');
    // Decision 25b: an unlisted date is silent. The one thing the start-up
    // says is that a listed snapshot did not load, once the overlay is gone.
    assert.ok(!/showToast/.test(init), 'the start-up shows a toast of its own');
    assert.ok(at('hideLoadingOverlay();') < at('if (startupFailure) reportStartupFailure(startupFailure);'));
    const load = fnSource('async function loadStartupDataset(requested)');
    assert.ok(load.indexOf('await startupSnapshot(requested)') < load.indexOf('await loadData(opened)'));
    // The latest data, the link's fallback included, loads with Try again
    // (loadStartupRecords), and the load closes the first view either way.
    assert.ok(load.indexOf('await loadData(opened)') < load.indexOf('if (!opened) await loadStartupRecords();'));
    assert.match(load, /if \(!opened\) await loadStartupRecords\(\);[\s\S]*firstViewClosed = true;[\s\S]*await sgLoad\(/);
    assert.match(load, /await sgLoad\(opened \|\| undefined\);/);
});

test('the phone\'s summary view, not any summary, decides the start-up\'s set-up', async () => {
    assert.match(init, /const summaryMode = isMobileDevice && !!dashboardSummary;/);
    assert.equal((init.match(/if \(!summaryMode\)/g) || []).length, 2, 'the filters or the selector still key off dashboardSummary');
    assert.ok(!/if \(!dashboardSummary\)/.test(init));
    // A desktop that opened an aggregate archive keeps a working Filters button.
    for (const [mobile, hidden] of [[false, false], [true, true]]) {
        const h = harness(site(), { mobile });
        h.run("dashboardSummary = { totalStudies: 500 }; document.getElementById('filters'); initFilterSummary();");
        assert.equal(h.els['filter-summary-toggle'].hidden, hidden, `mobile=${mobile}`);
        assert.deepEqual(h.els['filter-summary-toggle'].listeners, hidden ? [] : ['click'], `mobile=${mobile}`);
    }
});

test('no deep-link hook switches the snapshot after the first render', () => {
    const hooks = fnSource('function sgRouteHooks()');
    assert.doesNotMatch(hooks, /history-date|sgsnapshot'|setInterval|dispatchEvent\(new Event\('change'\)\)/,
        'a hook still loads the snapshot after the latest data');
});

test('a desktop link to an aggregate archive keeps the filters it carries', () => {
    // updateShareUrl writes filter params next to sgsnapshot on an aggregate
    // archive (#overview?st=OBSERVATIONAL&sgsnapshot=2026-04-26). The archive
    // is open before the route is applied, so dashboardSummary is set; only
    // the phone's summary view skips the link's filters.
    const src = fnSource('function applyRouteFromHash()');
    for (const [mobile, applied] of [[false, ['st=OBSERVATIONAL&sgsnapshot=2026-04-26']], [true, []]]) {
        const ctx = vm.createContext({
            location: { hash: '#overview?st=OBSERVATIONAL&sgsnapshot=2026-04-26' },
            isMobileDevice: mobile,
            dashboardSummary: { totalStudies: 500 },
            CSS: { escape: (x) => x },
            document: { querySelector: () => null },
            applied: []
        });
        vm.runInContext(`${src}\nfunction applyShareParams(q) { applied.push(q); }\napplyRouteFromHash();`, ctx);
        assert.deepEqual(ctx.applied, applied, `mobile=${mobile}`);
    }
});
