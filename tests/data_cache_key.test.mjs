/**
 * The data cache key: every data URL carries ?v=DATA_CACHE_VERSION, and
 * that is now the latest run's extracted_at from data/run.json (unique per
 * run), or the newest publish date from history.json, instead of today's
 * date, so a returning browser keeps a run's files instead of downloading
 * all of them again every new day. And the parts merged into one dataset
 * must come from one weekly run, the latest parts from the run run.json
 * names; a stale part is fetched again without holding two datasets.
 *
 * resolveDataCacheVersion, the small-file fetchers and the part checks run
 * in a vm with a stub fetch; the startup order and loadData's wiring are
 * checked on the source.
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
const keyEnd = app.indexOf('\n}\n', app.indexOf('async function resolveDataCacheVersion()')) + 2;
assert.ok(keyStart >= 0 && keyEnd > keyStart, 'app.js lost the cache key block');
const keySrc = app.slice(keyStart, keyEnd) + fnSource('function partsFromDifferentRuns(parts)')
    + fnSource('function stalePartIndexes(parts, expectedStamp)')
    + fnSource('async function refetchStaleParts(parts, expectedStamp, refetch)');

// respond(url) -> a fetch Response stand-in, or throws for a network failure.
function harness(respond) {
    const calls = [];
    const warnings = [];
    const ctx = vm.createContext({
        Date, Array, Promise,
        console: { warn: (msg) => warnings.push(String(msg)), log() {} },
        fetch: async (url, init) => {
            calls.push([url, init]);
            return respond(url);
        }
    });
    vm.runInContext(keySrc, ctx);
    return { calls, warnings, ctx, run: (src) => vm.runInContext(src, ctx) };
}
const today = new Date().toISOString().slice(0, 10);
const json = (body) => ({ ok: true, json: async () => body });
const notFound = { ok: false, status: 404 };
const HISTORY = { dates: ['2026-02-22', '2026-09-27', 'not-a-date', '2026-08-02', 7] };
const RUN = { extracted_at: '2026-09-27T11:49:53.609081+00:00', pipeline_commit: '12b9b65' };
const serve = (files) => (url) => {
    if (!(url in files)) return notFound;
    const f = files[url];
    if (f instanceof Error) throw f;
    return json(f);
};

test('the key is the latest run\'s extracted_at, so a same-day re-run gets a new one', async () => {
    const h = harness(serve({ 'history.json': HISTORY, 'data/run.json': RUN }));
    assert.equal(await h.run('resolveDataCacheVersion()'), '20260927T1149536090810000');
    assert.equal(h.run('LATEST_RUN_STAMP'), RUN.extracted_at, 'the parts are checked against the stamp as run.json writes it');
    const rerun = harness(serve({ 'history.json': HISTORY, 'data/run.json': { ...RUN, extracted_at: '2026-09-27T15:02:11.5+00:00' } }));
    assert.notEqual(await rerun.run('resolveDataCacheVersion()'), '20260927T1149536090810000');
});

test('without data/run.json the key is the newest publish date in history.json', async () => {
    for (const run of [undefined, { extracted_at: 'last Sunday' }, { pipeline_commit: 'x' }, new Error('offline')]) {
        const files = { 'history.json': HISTORY };
        if (run !== undefined) files['data/run.json'] = run;
        const h = harness(serve(files));
        assert.equal(await h.run('resolveDataCacheVersion()'), '2026-09-27');
        assert.equal(h.run('LATEST_RUN_STAMP'), null, 'no run to check the parts against');
    }
});

test('without either file the key stays today\'s date', async () => {
    for (const history of [undefined, new Error('offline'), {}, { dates: [] }, null]) {
        const h = harness(serve(history === undefined ? {} : { 'history.json': history }));
        assert.equal(await h.run('resolveDataCacheVersion()'), today);
    }
});

test('each small file is fetched once, and checked with the server each visit', async () => {
    const h = harness(serve({ 'history.json': HISTORY, 'data/run.json': RUN }));
    await Promise.all([h.run('resolveDataCacheVersion()'), h.run('fetchHistory()'), h.run('fetchHistory()'), h.run('fetchRun()')]);
    assert.deepEqual(h.calls.map(([u]) => u).sort(), ['data/run.json', 'history.json'], 'a file was fetched more than once');
    for (const [, init] of h.calls) assert.equal(init?.cache, 'no-cache', 'a cached copy could hide a new run for its whole max-age');
});

test('a failed fetch is not remembered: the archive selector tries again', async () => {
    let up = false;
    const h = harness((url) => {
        if (!up) throw new Error('offline');
        return url === 'history.json' ? json(HISTORY) : notFound;
    });
    assert.equal(await h.run('fetchHistory()'), null);
    up = true;
    const later = await h.run('fetchHistory()');
    assert.ok(later && Array.isArray(later.dates), 'the startup failure stuck for the rest of the visit');
    assert.equal(h.calls.filter(([u]) => u === 'history.json').length, 2);
});

test('parts from two weekly runs are told apart', () => {
    const h = harness(serve({}));
    const parts = (...stamps) => JSON.stringify(stamps.map((s) => ({ extracted_at: s })));
    assert.equal(h.run(`partsFromDifferentRuns(${parts('a', 'a', 'a')})`), false);
    assert.equal(h.run(`partsFromDifferentRuns(${parts('a', 'a', 'b')})`), true);
});

test('startup resolves the key before it fetches any data', () => {
    const init = app.slice(app.indexOf("document.addEventListener('DOMContentLoaded', async () => {"));
    const at = (needle) => {
        const i = init.indexOf(needle);
        assert.ok(i >= 0, `startup lost ${needle}`);
        return i;
    };
    const key = at('const keyReady = resolveDataCacheVersion();');
    assert.ok(key < at('keyReady.then(() => fetchLatestSummary())'), 'the figure fetches the summary before the key is set');
    assert.ok(key < at('await keyReady;') && at('await keyReady;') < at('await loadData();'), 'data is fetched before the key is set');
    assert.doesNotMatch(init.slice(0, at('await loadData();')), /(?<!keyReady\.then\(\(\) => )fetchLatestSummary\(\)\.then/,
        'a summary fetch starts before the key');
});

test('every reader of history.json shares the one request', () => {
    assert.deepEqual([...app.matchAll(/fetch\(\s*['"`](?:history\.json|data\/run\.json)/g)], [],
        'history.json or data/run.json is fetched outside the shared fetchers');
    assert.match(app, /const fetchHistory = smallJsonOnce\('history\.json'\);/);
    assert.match(app, /const fetchRun = smallJsonOnce\('data\/run\.json'\);/);
    assert.match(fnSource('async function initHistorySelector()'), /await fetchHistory\(\)/);
});

const OLD = '2026-09-20T11:02:41.118204+00:00';
const NEW = RUN.extracted_at;
const stamped = (...stamps) => stamps.map((s, i) => ({ extracted_at: s, data: [`part ${i + 1} of ${s}`] }));

test('a part not from the expected run, or not from the newest run among them, is stale', () => {
    const h = harness(serve({}));
    const stale = (stamps, expected) => JSON.parse(h.run(
        `JSON.stringify(stalePartIndexes(${JSON.stringify(stamped(...stamps))}, ${JSON.stringify(expected)}))`));
    assert.deepEqual(stale([NEW, NEW, NEW], NEW), []);
    assert.deepEqual(stale([OLD, OLD, OLD], NEW), [0, 1, 2], 'a coherent earlier run passed as the latest');
    assert.deepEqual(stale([NEW, OLD, NEW], NEW), [1]);
    assert.deepEqual(stale([NEW, OLD, NEW], null), [1], 'without run.json the newest run wins');
    assert.deepEqual(stale([OLD, OLD], null), []);
    assert.deepEqual(stale([undefined, undefined], null), [], 'unstamped parts of one kind are not fetched twice');
    assert.deepEqual(stale(['x', 'y'], null), [0, 1]);
});

// The browser's parts, then what the server returns for a refetch of part i.
async function settle(h, have, expected, server) {
    const refetched = [];
    let heldDuringRefetch = null;
    h.ctx.refetch = async (i) => {
        refetched.push(i);
        heldDuringRefetch ??= h.ctx.parts.filter(Boolean).length;
        return stamped(...server)[i];
    };
    h.ctx.parts = stamped(...have);
    h.ctx.expected = expected;
    const out = await h.run('refetchStaleParts(parts, expected, refetch)');
    return { stamps: out.map((p) => p.extracted_at), refetched, heldDuringRefetch };
}

test('a stale part is fetched again, and dropped before it is', async () => {
    const h = harness(serve({}));
    const r = await settle(h, [OLD, OLD, OLD], NEW, [NEW, NEW, NEW]);
    assert.deepEqual(r.stamps, [NEW, NEW, NEW]);
    assert.deepEqual(r.refetched, [0, 1, 2]);
    assert.equal(r.heldDuringRefetch, 0, 'the stale payloads were still held while their replacements downloaded');
    const one = await settle(harness(serve({})), [NEW, OLD, NEW], NEW, [NEW, NEW, NEW]);
    assert.deepEqual(one.refetched, [1], 'a part already from the run was downloaded again');
    assert.equal(one.heldDuringRefetch, 2);
});

test('parts already from the run are not fetched again', async () => {
    const h = harness(serve({}));
    const r = await settle(h, [NEW, NEW], NEW, []);
    assert.deepEqual(r.refetched, []);
    assert.deepEqual(h.warnings, []);
});

test('two runs after the refetch refuse to merge', async () => {
    const h = harness(serve({}));
    await assert.rejects(settle(h, [OLD, OLD, OLD], NEW, [NEW, OLD, NEW]), /different weekly runs/);
});

test('a server still serving one earlier run is shown under that run\'s date, with a warning', async () => {
    const h = harness(serve({}));
    const r = await settle(h, [OLD, OLD], NEW, [OLD, OLD]);
    assert.deepEqual(r.stamps, [OLD, OLD]);
    assert.ok(h.warnings.some((w) => w.includes(`still serves the run of ${OLD}, not ${NEW}`)), h.warnings.join('\n'));
});

test('loadData checks the latest parts against run.json and refetches past the cache', () => {
    const load = fnSource('async function loadData(date)');
    assert.match(load, /const expectedStamp = !date \|\| date === 'latest' \? LATEST_RUN_STAMP : null;/,
        'snapshots would be checked against the latest run, or the latest against nothing');
    assert.match(load, /parts = await refetchStaleParts\(parts, expectedStamp, \(i\) => \{[\s\S]*?fetchAndDecompress\(strategy\.urls\[i\], null, \{ cache: 'reload' \}\)/,
        'a stale part is not fetched again past the browser cache');
    assert.ok(load.indexOf('refetchStaleParts(') < load.indexOf('data = parts.flatMap'), 'the check runs after the merge');
    assert.doesNotMatch(load, /const \w+ = strategy\.urls\.map\(/, 'an array of the part promises keeps the first payloads alive');
});

test('every data URL carries the key', () => {
    const dataFetches = [...app.matchAll(/fetch\(\s*`([^`]*(?:data\/|snapshots\/|sgBase|\$\{base\}|\$\{url\})[^`]*)`/g)].map((m) => m[1]);
    assert.ok(dataFetches.length >= 6, 'expected the data fetches in app.js');
    const unkeyed = dataFetches.filter((u) => !u.includes('?v=${DATA_CACHE_VERSION}'));
    assert.deepEqual(unkeyed, [], 'data fetched without the cache key');
});
