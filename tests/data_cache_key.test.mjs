/**
 * The data cache key: every data URL carries ?v=DATA_CACHE_VERSION, and
 * that is now the newest weekly publish date from history.json instead of
 * today's date, so a returning browser keeps a week's files instead of
 * downloading all of them again every new day. And the parts merged into
 * one dataset must come from one weekly run.
 *
 * resolveDataCacheVersion, fetchHistory and partsFromDifferentRuns run in a
 * vm with a stub fetch; the startup order and loadData's retry are checked
 * on the source.
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

const keySrc = 'let DATA_CACHE_VERSION = new Date().toISOString().slice(0, 10);\nlet historyRequest = null;\n' +
    fnSource('function fetchHistory()') + fnSource('async function resolveDataCacheVersion()') +
    fnSource('function partsFromDifferentRuns(parts)');

function harness(respond) {
    const calls = [];
    const ctx = vm.createContext({
        Date, Array,
        fetch: async (url, init) => {
            calls.push([url, init]);
            return respond();
        }
    });
    vm.runInContext(keySrc, ctx);
    return { calls, run: (src) => vm.runInContext(src, ctx) };
}
const today = new Date().toISOString().slice(0, 10);
const ok = (body) => () => ({ ok: true, json: async () => body });

test('the key is the newest publish date in history.json', async () => {
    const h = harness(ok({ dates: ['2026-02-22', '2026-09-27', 'not-a-date', '2026-08-02', 7] }));
    assert.equal(await h.run('resolveDataCacheVersion()'), '2026-09-27');
    assert.equal(h.run('DATA_CACHE_VERSION'), '2026-09-27');
});

test('history.json is fetched once, and checked with the server each visit', async () => {
    const h = harness(ok({ dates: ['2026-09-27'] }));
    await Promise.all([h.run('resolveDataCacheVersion()'), h.run('fetchHistory()'), h.run('fetchHistory()')]);
    assert.equal(h.calls.length, 1, 'history.json was fetched more than once');
    assert.equal(h.calls[0][0], 'history.json');
    assert.equal(h.calls[0][1]?.cache, 'no-cache', 'a cached history.json could hide a new week for its whole max-age');
});

test('without a readable history.json the key stays today\'s date', async () => {
    for (const respond of [() => ({ ok: false, status: 404 }), () => { throw new Error('offline'); }, ok({}), ok({ dates: [] }), ok(null)]) {
        const h = harness(respond);
        assert.equal(await h.run('resolveDataCacheVersion()'), today);
    }
});

test('parts from two weekly runs are told apart', () => {
    const h = harness(ok({}));
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
    const fetches = [...app.matchAll(/fetch\(\s*['"`]history\.json/g)];
    assert.equal(fetches.length, 1, 'history.json is fetched outside fetchHistory');
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
