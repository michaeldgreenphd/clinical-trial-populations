/**
 * The data cache key: every data URL carries ?v=DATA_CACHE_VERSION, and
 * that is now the latest run's extracted_at from data/run.json (unique per
 * run), or the newest publish date from history.json, instead of today's
 * date, so a returning browser keeps a run's files instead of downloading
 * all of them again every new day. And the parts merged into one dataset
 * must come from one weekly run.
 *
 * resolveDataCacheVersion, the small-file fetchers and
 * partsFromDifferentRuns run in a vm with a stub fetch; the startup order
 * and loadData's retry are checked on the source.
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
const keySrc = app.slice(keyStart, keyEnd) + fnSource('function partsFromDifferentRuns(parts)');

// respond(url) -> a fetch Response stand-in, or throws for a network failure.
function harness(respond) {
    const calls = [];
    const ctx = vm.createContext({
        Date, Array, Promise,
        fetch: async (url, init) => {
            calls.push([url, init]);
            return respond(url);
        }
    });
    vm.runInContext(keySrc, ctx);
    return { calls, run: (src) => vm.runInContext(src, ctx) };
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
    const rerun = harness(serve({ 'history.json': HISTORY, 'data/run.json': { ...RUN, extracted_at: '2026-09-27T15:02:11.5+00:00' } }));
    assert.notEqual(await rerun.run('resolveDataCacheVersion()'), '20260927T1149536090810000');
});

test('without data/run.json the key is the newest publish date in history.json', async () => {
    for (const run of [undefined, { extracted_at: 'last Sunday' }, { pipeline_commit: 'x' }, new Error('offline')]) {
        const files = { 'history.json': HISTORY };
        if (run !== undefined) files['data/run.json'] = run;
        const h = harness(serve(files));
        assert.equal(await h.run('resolveDataCacheVersion()'), '2026-09-27');
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

test('loadData fetches mixed parts again past the cache, and refuses to merge two runs', () => {
    const load = fnSource('async function loadData(date)');
    assert.match(load, /if \(partsFromDifferentRuns\(parts\)\) \{[\s\S]*?fetchAndDecompress\(url, null, \{ cache: 'reload' \}\)[\s\S]*?if \(partsFromDifferentRuns\(parts\)\) \{\s*throw new Error/,
        'loadData merges parts from different runs');
    assert.ok(load.indexOf('partsFromDifferentRuns(parts)') < load.indexOf('data = parts.flatMap'), 'the check runs after the merge');
});

test('every data URL carries the key', () => {
    const dataFetches = [...app.matchAll(/fetch\(\s*`([^`]*(?:data\/|snapshots\/|sgBase|\$\{base\}|\$\{url\})[^`]*)`/g)].map((m) => m[1]);
    assert.ok(dataFetches.length >= 6, 'expected the data fetches in app.js');
    const unkeyed = dataFetches.filter((u) => !u.includes('?v=${DATA_CACHE_VERSION}'));
    assert.deepEqual(unkeyed, [], 'data fetched without the cache key');
});
