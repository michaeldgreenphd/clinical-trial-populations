/**
 * The snapshot cache keeps the latest data and the snapshot on screen, and
 * nothing more (decision 8a).
 *
 * A full snapshot costs about 0.75-1 GB of browser memory once parsed, and
 * snapshotCache used to keep every one ever opened: four of them measured
 * 2.96 GiB of a 4 GiB tab. retainSnapshots drops every other entry, and with
 * it the reader that rides on the entry (its Studies-tab extras and detail
 * shards) and the dataset's ?sg=v2 join table. It runs once a switch has
 * rendered or fallen back, never when a dataset is stored, so a failed switch
 * goes back to the snapshot it left with nothing downloaded again, and the
 * one that failed is not left cached.
 *
 * retainSnapshots and initHistorySelector (the change handler) run in a vm,
 * with loadData and sgLoad replaced by stubs that cache what they load and
 * count what they download. The rest of the dashboard is reduced to no-ops.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function fnSource(signature) {
    const at = app.indexOf(signature);
    assert.ok(at >= 0, `app.js lost ${signature}`);
    const end = app.indexOf('\n}\n', at);
    return app.slice(at, end + 2);
}

const A = '2026-05-31', B = '2026-06-14', C = '2026-03-29', D = '2026-08-02';

// The page around the two functions. rowsFor: the rows each dataset loads
// (C, like the 2026-03-29 archive, has none); renderFails: a key whose
// render throws. The reader on each entry stands in for makeReader's, with
// extras and a shard loaded, so the test can follow what goes with it.
const SCAFFOLD = `
let data = null; let datasetReader = null;
const snapshotCache = new Map();
const sgCache = new Map();
const misses = [];          // what loadData downloaded, in order
const sgMisses = [];        // what sgLoad downloaded
const overlays = [];        // the loading screens shown
const renders = [];         // the dataset each render drew
let renderFails = null;
let loadFails = null;       // a key whose load throws, even from the cache
const rowsFor = key => key === '${C}' ? [] : [{ nct_id: 'NCT0' + key }];
function bigMap(key) { const m = new Map(); for (let i = 0; i < 2000; i++) m.set('NCT' + i, { key, sites: new Array(20).fill(key) }); return m; }
async function loadData(date) {
    const key = date || 'latest';
    await null;
    if (loadFails === key) throw new Error('load failed');
    if (snapshotCache.has(key)) {
        const cached = snapshotCache.get(key);
        data = cached.data;
        datasetReader = cached.reader;
        return;
    }
    misses.push(key);
    data = rowsFor(key);
    datasetReader = { key, rows: data, extras: { state: 'loaded', map: bigMap(key) }, shards: new Map([[7, { state: 'loaded', map: { key } }]]) };
    snapshotCache.set(key, { data, dateLabel: key, summary: null, extractedAt: null, reader: datasetReader });
}
async function sgLoad(date) {
    const key = date || 'latest';
    await null;
    if (sgCache.has(key)) return;
    sgMisses.push(key);
    sgCache.set(key, { meta: { key }, table: new Map([['NCT1', { key }]]) });
}
async function fetchHistory() { return { dates: ['${C}', '${A}', '${B}', '${D}'] }; }
async function snapshotStage() {}
function syncYearWindow() {}
function populateConditionsDropdown() {}
function populateCountriesDropdown() {}
function populatePrimaryConditionDropdown() {}
function renderDashboard() {
    const key = datasetReader && datasetReader.key;
    if (renderFails === key) throw new Error('render failed');
    renders.push(key);
}
function labelChartsForA11y() {}
function updateShareUrl() {}
function showToast() {}
function showSnapshotLoading(label) { overlays.push(label); }
function hideSnapshotLoading() {}
const listeners = {};
const select = {
    value: 'latest', dataset: {}, options: [],
    appendChild(o) { this.options.push(o.value); },
    addEventListener(type, fn) { listeners[type] = fn; }
};
const document = {
    getElementById: id => (id === 'history-date' ? select : null),
    querySelector: () => null,   // no tab is open: the switch's FDA-tab check (PR #251) does nothing
    createElement: () => ({})
};
const console = { log() {}, warn() {}, error() {} };
`;

function harness() {
    const ctx = vm.createContext({ Map, Set, Array, Object, Error, Promise, WeakRef });
    // initHistorySelector goes through the newest-date helpers (PR #252); no
    // data/run.json here, so no date is read from data/.
    const newest = ['let NEWEST_PUBLISHED = null;', 'let DATA_RUN_DATE = null;',
        fnSource('function publishedDates(manifest)'), fnSource('function newestPublishedIn(manifest)'),
        fnSource('function noteNewestPublished(manifest)'), fnSource('function servedFromData(date)'),
        fnSource('function datasetKey(date)'),
        // The change handler counts and checks the dataset on screen (PR #251).
        fnSource('function datasetLoaded()'), fnSource('function datasetStudyCount()'), 'let dashboardSummary = null;'];
    vm.runInContext([SCAFFOLD, ...newest, fnSource('function retainSnapshots(onScreen)'), fnSource('async function initHistorySelector()'),
        fnSource('function listHistoryDates(select, manifest)')].join('\n'), ctx);
    const run = (code) => vm.runInContext(code, ctx);
    // An array or object from the vm, as one of this realm's.
    const json = (code) => JSON.parse(run(`JSON.stringify(${code})`));
    return {
        run, json,
        keys: () => json('[...snapshotCache.keys()].sort()'),
        sgKeys: () => json('[...sgCache.keys()].sort()'),
        // Start-up: the latest data, then the selector.
        async start() {
            await run('loadData().then(() => sgLoad())');
            await run('initHistorySelector()');
        },
        // Choose a snapshot in the select, as a reader does.
        async choose(value) {
            run(`select.value = ${JSON.stringify(value)};`);
            await run('listeners.change()');
        }
    };
}

const sorted = (...keys) => keys.slice().sort();

test('retainSnapshots keeps exactly the latest data and the snapshot on screen', () => {
    const h = harness();
    h.run(`for (const k of ['latest', '${A}', '${B}', '${D}']) snapshotCache.set(k, { data: [k] });`);
    h.run(`retainSnapshots('${B}')`);
    assert.deepEqual(h.keys(), sorted('latest', B));
    h.run(`snapshotCache.set('${A}', { data: ['${A}'] }); retainSnapshots('latest')`);
    assert.deepEqual(h.keys(), ['latest']);
    // No key, as loadDataAndRender passes for the latest data
    h.run(`snapshotCache.set('${A}', { data: ['${A}'] }); retainSnapshots(undefined)`);
    assert.deepEqual(h.keys(), ['latest']);
});

test('retainSnapshots never drops the dataset whose data is on screen', () => {
    // Two switches can overlap; the one that finishes first must not drop
    // the data the other has just put on screen.
    const h = harness();
    h.run(`for (const k of ['latest', '${A}', '${B}']) snapshotCache.set(k, { data: [k] });`);
    h.run(`data = snapshotCache.get('${B}').data; retainSnapshots('${A}')`);
    assert.deepEqual(h.keys(), sorted('latest', A, B));
});

test('retainSnapshots drops other snapshots’ ?sg=v2 join tables and keeps the small answers', () => {
    const h = harness();
    h.run(`
        sgCache.set('latest', { meta: {}, table: new Map([['x', {}]]) });
        sgCache.set('${A}', { meta: {}, table: new Map([['x', {}]]) });
        sgCache.set('${B}', { meta: {}, table: new Map([['x', {}]]) });
        sgCache.set('${C}', { meta: null, table: null });   // a remembered 404
        sgCache.set('${D}', { meta: {}, table: null });     // an archive: meta, no table
        retainSnapshots('${B}');
    `);
    assert.deepEqual(h.sgKeys(), sorted('latest', B, C, D));
    assert.equal(h.run(`sgCache.get('${C}').meta`), null, 'the remembered 404 changed');
});

test('a switch drops the snapshot it left only after the new one renders', async () => {
    const h = harness();
    await h.start();
    assert.deepEqual(h.keys(), ['latest']);
    await h.choose(A);
    assert.deepEqual(h.keys(), sorted('latest', A));
    assert.deepEqual(h.sgKeys(), sorted('latest', A));
    // While B loads and draws, A is still cached; it goes after B is drawn.
    h.run(`
        const draw = renderDashboard;
        renderDashboard = () => { globalThis.keysAtRender = [...snapshotCache.keys()].sort(); draw(); };
    `);
    await h.choose(B);
    assert.deepEqual(h.json('keysAtRender'), sorted('latest', A, B), 'the snapshot left went before the new one was drawn');
    assert.deepEqual(h.keys(), sorted('latest', B));
    assert.deepEqual(h.sgKeys(), sorted('latest', B));
    assert.equal(h.run('select.dataset.lastValue'), B);
});

test('latest -> A -> B -> a failing C -> latest: the cache holds two datasets at most, and only what was dropped is downloaded again', async () => {
    const h = harness();
    await h.start();
    h.run("globalThis.latestReader = datasetReader; globalThis.latestExtras = datasetReader.extras.map;");
    await h.choose(A);
    await h.choose(B);
    assert.deepEqual(h.json('misses'), ['latest', A, B]);
    h.run("globalThis.bReader = datasetReader;");

    // C has no study rows (the 2026-03-29 archive): the switch fails and
    // falls back to B from the cache, and C is not left cached.
    await h.choose(C);
    assert.deepEqual(h.keys(), sorted('latest', B), 'the failed snapshot stayed cached, or the one it left was dropped');
    assert.deepEqual(h.sgKeys(), sorted('latest', B), "the failed snapshot's join table stayed");
    assert.deepEqual(h.json('misses'), ['latest', A, B, C], 'the fallback downloaded B again');
    assert.equal(h.run('select.value'), B);
    assert.equal(h.run('select.dataset.lastValue'), B);
    assert.equal(h.run('datasetReader === bReader && data === bReader.rows'), true, 'B is not back on screen');
    assert.equal(h.run('renders[renders.length - 1]'), B);

    // Even when the fallback itself fails, and C's rows stay on screen, C is
    // not kept.
    h.run(`loadFails = '${B}';`);
    await h.choose(C);
    assert.deepEqual(h.keys(), sorted('latest', B));
    h.run('loadFails = null;');
    await h.choose(B);   // from the cache
    assert.deepEqual(h.json('misses'), ['latest', A, B, C, C]);

    // Choosing C again downloads it again, rather than reading an empty entry.
    await h.choose(C);
    assert.deepEqual(h.json('misses'), ['latest', A, B, C, C, C]);
    assert.deepEqual(h.keys(), sorted('latest', B));

    await h.choose('latest');
    assert.deepEqual(h.keys(), ['latest']);
    assert.deepEqual(h.sgKeys(), ['latest']);
    assert.deepEqual(h.json('misses'), ['latest', A, B, C, C, C], 'the latest data was downloaded again');
    // The latest dataset's reader came back with what it had loaded.
    assert.equal(h.run('datasetReader === latestReader && datasetReader.extras.map === latestExtras'), true);
    assert.equal(h.run('datasetReader.shards.size'), 1);

    // Going back to A shows the loading screen and downloads A, and only A.
    const shown = h.run('overlays.length');
    await h.choose(A);
    assert.deepEqual(h.json('misses'), ['latest', A, B, C, C, C, A]);
    assert.deepEqual(h.json('sgMisses'), ['latest', A, B, C, C, C, A]);
    assert.equal(h.run('overlays.length'), shown + 1);
    assert.deepEqual(h.keys(), sorted('latest', A));
});

test('a switch whose render fails falls back without keeping the snapshot it tried', async () => {
    const h = harness();
    await h.start();
    await h.choose(A);
    h.run(`renderFails = '${D}';`);
    await h.choose(D);
    assert.deepEqual(h.keys(), sorted('latest', A));
    assert.deepEqual(h.sgKeys(), sorted('latest', A));
    assert.equal(h.run('select.dataset.lastValue'), A);
    assert.deepEqual(h.json('misses'), ['latest', A, D]);
    // A failure while the latest data is on screen keeps the latest data.
    await h.choose('latest');
    await h.choose(D);
    assert.deepEqual(h.keys(), ['latest']);
    assert.equal(h.run("select.value"), 'latest');
    // A failed switch to the latest data never drops the latest data.
    await h.choose(A);
    h.run("renderFails = 'latest';");
    await h.choose('latest');
    assert.deepEqual(h.keys(), sorted('latest', A));
    assert.equal(h.run('select.dataset.lastValue'), A);
    h.run('renderFails = null;');
    await h.choose('latest');
    assert.deepEqual(h.json('misses'), ['latest', A, D, D, A], 'the latest data was downloaded again');
});

// A dropped dataset's reader, with its extras and shards, must be free to
// collect: nothing else in the switch may hold on to it. Uses V8's gc,
// exposed for this process only.
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a dropped snapshot’s reader, extras and shards are let go; the latest’s and the on-screen one’s are kept', async () => {
    const h = harness();
    await h.start();
    await h.choose(A);
    h.run(`globalThis.refs = {
        reader: new WeakRef(datasetReader),
        extras: new WeakRef(datasetReader.extras.map),
        shard: new WeakRef(datasetReader.shards.get(7)),
        sg: new WeakRef(sgCache.get('${A}').table),
        latest: new WeakRef(snapshotCache.get('latest').reader)
    };`);
    await h.choose(B);
    await settle();
    gc();
    await settle();
    gc();
    assert.equal(h.run('refs.reader.deref()'), undefined, "A's reader is still held after A was dropped");
    assert.equal(h.run('refs.extras.deref()'), undefined, "A's Studies-tab extras are still held");
    assert.equal(h.run('refs.shard.deref()'), undefined, "A's detail shard is still held");
    assert.equal(h.run('refs.sg.deref()'), undefined, "A's ?sg=v2 table is still held");
    assert.notEqual(h.run('refs.latest.deref()'), undefined);
    assert.equal(h.run(`snapshotCache.get('${B}').reader === datasetReader`), true);
});

// ── Where the cache is pruned, in app.js itself ──

test('the cache is pruned only by retainSnapshots and the failed switch, never when a dataset is stored', () => {
    const retain = fnSource('function retainSnapshots(onScreen)');
    const selector = fnSource('async function initHistorySelector()');
    const all = (re) => [...app.matchAll(re)].map((m) => m.index);
    const inside = (at, src) => { const from = app.indexOf(src); return at >= from && at < from + src.length; };

    const deletes = all(/snapshotCache\.delete\(/g);
    assert.equal(deletes.length, 2, 'snapshotCache is pruned somewhere new');
    assert.equal(deletes.filter((at) => inside(at, retain)).length, 1);
    assert.equal(deletes.filter((at) => inside(at, selector)).length, 1);
    assert.equal(all(/snapshotCache\.clear\(/g).length, 0);
    const sgDeletes = all(/sgCache\.(delete|clear)\(/g);
    assert.equal(sgDeletes.length, 1);
    assert.ok(inside(sgDeletes[0], retain), 'sgCache is pruned outside retainSnapshots');

    const load = fnSource('async function loadData(date)').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(load, /retainSnapshots|\.delete\(/, 'loadData prunes when it stores a dataset');
    assert.equal((load.match(/snapshotCache\.set\(/g) || []).length, 2);
});

test('the change handler prunes after the render and after the fallback', () => {
    const selector = fnSource('async function initHistorySelector()');
    const at = (needle, from = 0) => {
        const i = selector.indexOf(needle, from);
        assert.ok(i >= 0, `the change handler lost ${needle}`);
        return i;
    };
    const tryAt = at('try {');
    const catchAt = at('} catch (err) {');
    const render = at('renderDashboard();', tryAt);
    const committed = at('select.dataset.lastValue = chosen;', render);
    const keep = at('retainSnapshots(chosen);', committed);
    assert.ok(keep < catchAt, 'retainSnapshots(chosen) is not in the try, after the render');
    assert.equal(selector.split('retainSnapshots(chosen)').length, 2);

    const drop = at("if (chosen !== 'latest' && chosen !== previousValue) snapshotCache.delete(chosen);", catchAt);
    const revert = at('await loadData(previousValue', catchAt);
    const back = at('retainSnapshots(previousValue);', catchAt);
    assert.ok(drop < revert && revert < back, 'the failed switch does not drop C before, and prune after, its fallback');
    assert.ok(back < at('} finally {', catchAt));

    const reload = fnSource('async function loadDataAndRender(date)');
    const drawn = reload.indexOf('renderDashboard();');
    assert.ok(drawn >= 0 && reload.indexOf("retainSnapshots(date || 'latest');") > drawn,
        'loadDataAndRender does not prune after it renders');
});
