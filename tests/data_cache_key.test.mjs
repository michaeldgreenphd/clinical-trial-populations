/**
 * The data cache key: every data URL carries ?v=DATA_CACHE_VERSION, and
 * that is now the latest run's extracted_at from data/run.json (unique per
 * run), or the newest publish date from history.json, instead of today's
 * date, so a returning browser keeps a run's files instead of downloading
 * all of them again every new day. And the parts merged into one dataset
 * must come from one weekly run, the latest parts from the run run.json
 * names; a stale part is fetched again without holding two datasets.
 * Every data file is fetched through keyedFetch, after the one shared key;
 * the latest JSON files are checked against the run like the parts; a
 * stalled small file cannot hold up startup; without a run stamp the browser
 * revalidates its copies.
 *
 * resolveDataCacheVersion, the small-file fetchers, keyedFetch,
 * fetchChecked and the part checks run in a vm with a stub fetch and stub
 * timers; the startup order and the call sites are checked on the source.
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
const keySrc = app.slice(keyStart, keyEnd) + fnSource('function partsFromDifferentRuns(parts)')
    + fnSource('function stalePartIndexes(parts, expectedStamp)')
    + fnSource('async function refetchStaleParts(parts, expectedStamp, refetch)');

// respond(url, init) -> a fetch Response stand-in, a promise of one, or
// throws for a network failure. Timers fire only when the test says so.
function harness(respond) {
    const calls = [];
    const warnings = [];
    const timers = [];
    const ctx = vm.createContext({
        Date, Array, Promise,
        console: { warn: (msg) => warnings.push(String(msg)), log() {} },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        fetch: async (url, init) => {
            calls.push([url, init]);
            return respond(url, init);
        }
    });
    vm.runInContext(keySrc, ctx);
    const fireTimers = () => timers.splice(0).forEach((t) => t.fn());
    return { calls, warnings, timers, fireTimers, ctx, run: (src) => vm.runInContext(src, ctx) };
}
const today = new Date().toISOString().slice(0, 10);
// Real Responses: a body read twice throws, as in a browser, so a check that
// reads the caller's body instead of a clone fails here too.
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const never = () => new Promise(() => {});
// A regression here tends to leave a promise pending: fail it, don't hang.
const T = { timeout: 5000 };
const tick = () => new Promise((r) => setImmediate(r));
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
    const key = at('const keyReady = dataKeyReady();');
    assert.ok(key < at('await keyReady;') && at('await keyReady;') < at('await loadData();'), 'data is fetched before the key is set');
    assert.equal([...app.matchAll(/(?<!function )resolveDataCacheVersion\(\)/g)].length, 1, 'the key is resolved outside the shared promise');
    assert.match(fnSource('function dataKeyReady()'), /dataKeyRequest = resolveDataCacheVersion\(\);/);
});

test('a stalled history.json does not hold up the key once run.json answers', T, async () => {
    const h = harness((url) => (url === 'data/run.json' ? json(RUN) : never()));
    assert.equal(await h.run('resolveDataCacheVersion()'), '20260927T1149536090810000');
    assert.equal(h.timers[0].ms, 5000);
});

test('a stalled run.json or history.json falls back once the wait is over', T, async () => {
    const stalledRun = harness((url) => (url === 'history.json' ? json(HISTORY) : never()));
    const a = stalledRun.run('resolveDataCacheVersion()');
    await tick();
    stalledRun.fireTimers();
    assert.equal(await a, '2026-09-27');
    assert.equal(stalledRun.run('LATEST_RUN_STAMP'), null);
    const both = harness(() => never());
    const b = both.run('resolveDataCacheVersion()');
    await tick();
    both.fireTimers();
    assert.equal(await b, today, 'two stalled files held up the dashboard');
});

test('the key is resolved once, and a data fetch made before startup waits for it', T, async () => {
    const h = harness(serve({ 'history.json': HISTORY, 'data/run.json': RUN, 'data/industry_sponsors.json': { companies: [] } }));
    await Promise.all([h.run("keyedFetch('data/industry_sponsors.json')"), h.run('dataKeyReady()'), h.run('dataKeyReady()')]);
    assert.equal(h.run('dataKeyReady()'), h.run('dataKeyReady()'));
    const urls = h.calls.map(([u]) => u);
    assert.deepEqual(urls.filter((u) => !u.includes('?v=')).sort(), ['data/run.json', 'history.json'], 'the key was resolved twice');
    assert.deepEqual(urls.filter((u) => u.includes('?v=')), ['data/industry_sponsors.json?v=20260927T1149536090810000'],
        'a data fetch made first ran under the date key');
});

test('a #industry deep link fetching while startup\'s key is still pending waits for it', T, async () => {
    // The page's order: the startup listener asks for the key first, then the
    // #industry listener fetches while run.json is still in flight.
    let answerRun;
    const h = harness((url) => {
        if (url === 'data/run.json') return new Promise((r) => { answerRun = () => r(json(RUN)); });
        if (url === 'history.json') return json(HISTORY);
        return json({ companies: [] });
    });
    const startup = h.run('dataKeyReady()');
    const industry = h.run("keyedFetch('data/industry_sponsors.json')");
    await tick();
    assert.deepEqual(h.calls.filter(([u]) => u.includes('?v=')), [], 'the deep link fetched before the key resolved');
    answerRun();
    await Promise.all([startup, industry]);
    assert.deepEqual(h.calls.filter(([u]) => u.includes('?v=')).map(([u]) => u),
        ['data/industry_sponsors.json?v=20260927T1149536090810000'], 'a deep-linked view fetched under the date key before the run key was set');
});

test('without a run stamp the browser revalidates its copies; with one it may trust them', T, async () => {
    const without = harness(serve({ 'history.json': HISTORY, 'data/x.json': {} }));
    await without.run("keyedFetch('data/x.json')");
    await without.run("keyedFetch('data/x.json', { cache: 'reload' })");
    const keyed = without.calls.filter(([u]) => u.startsWith('data/x.json'));
    assert.deepEqual(keyed.map(([u, init]) => [u, init?.cache]), [['data/x.json?v=2026-09-27', 'no-cache'], ['data/x.json?v=2026-09-27', 'reload']]);
    const withRun = harness(serve({ 'history.json': HISTORY, 'data/run.json': RUN, 'data/x.json': {} }));
    await withRun.run("keyedFetch('data/x.json')");
    assert.equal(withRun.calls.find(([u]) => u.startsWith('data/x.json'))[1], undefined, 'a run-keyed file was revalidated every visit');
});

// What the server answers for a latest JSON file on the first and later
// fetches: a stamp, or 'offline' (the request fails), a status code,
// 'garbled' (a body that is not JSON), or 'json-503' (an error whose body
// happens to parse, and carries the right stamp).
function checkedHarness(answers, files = { 'history.json': HISTORY, 'data/run.json': RUN }) {
    let n = 0;
    return harness((url) => {
        const path = url.split('?')[0];
        if (path in files) return json(files[path]);
        if (!path.endsWith('dashboard-summary.json')) return notFound;
        const a = answers[Math.min(n++, answers.length - 1)];
        if (a === 'offline') throw new TypeError('Failed to fetch');
        if (a === 'garbled') return new Response('not json', { status: 200 });
        if (typeof a === 'number') return new Response('busy', { status: a });
        if (a === 'json-503') return new Response(JSON.stringify({ extracted_at: RUN.extracted_at }), { status: 503 });
        return json({ extracted_at: a });
    });
}
const OLD_RUN = '2026-09-20T11:02:41.118204+00:00';
const checked = (h, path) => h.run(`fetchChecked('${path}', (s) => s.extracted_at).then(async (r) => r.ok ? (await r.json()).extracted_at : r.status)`);
const fetchesOf = (h, path) => h.calls.filter(([u]) => u.startsWith(path)).map(([, init]) => init?.cache ?? 'default');

test('a latest JSON file from the run is fetched once', T, async () => {
    const h = checkedHarness([RUN.extracted_at]);
    assert.equal(await checked(h, 'data/dashboard-summary.json'), RUN.extracted_at);
    assert.deepEqual(fetchesOf(h, 'data/dashboard-summary.json'), ['default']);
    assert.deepEqual(h.warnings, []);
});

test('a latest JSON file from another run is fetched again past the cache', T, async () => {
    const h = checkedHarness([OLD_RUN, RUN.extracted_at]);
    assert.equal(await checked(h, 'data/dashboard-summary.json'), RUN.extracted_at, 'mobile rendered the superseded summary');
    assert.deepEqual(fetchesOf(h, 'data/dashboard-summary.json'), ['default', 'reload']);
    assert.deepEqual(h.calls.filter(([u]) => u.startsWith('data/dashboard-summary.json')).map(([u]) => u),
        Array(2).fill('data/dashboard-summary.json?v=20260927T1149536090810000'),
        'the reload must replace the browser\'s copy under the keyed URL, or every visit downloads it twice');
});

test('when the second request fails, the first answer stands under its own date', T, async () => {
    for (const second of ['offline', 503, 404, 'garbled', 'json-503']) {
        const h = checkedHarness([OLD_RUN, second]);
        assert.equal(await checked(h, 'data/dashboard-summary.json'), OLD_RUN,
            `a usable summary was thrown away when the reload was ${second} (mobile would download the full parts)`);
        assert.ok(h.warnings.some((w) => w.includes('Could not fetch data/dashboard-summary.json again')), h.warnings.join('\n'));
    }
});

test('a server still serving an earlier run is shown under its own date, with a warning', T, async () => {
    const h = checkedHarness([OLD_RUN, OLD_RUN]);
    assert.equal(await checked(h, 'data/dashboard-summary.json'), OLD_RUN);
    assert.ok(h.warnings.some((w) => w.includes(`still serves data/dashboard-summary.json from the run of ${OLD_RUN}`)), h.warnings.join('\n'));
});

test('snapshot files, files without a run stamp to compare, and failures are not checked', T, async () => {
    const snap = checkedHarness([OLD_RUN]);
    assert.equal(await checked(snap, 'snapshots/2026-09-20/dashboard-summary.json'), OLD_RUN);
    assert.deepEqual(fetchesOf(snap, 'snapshots/'), ['default']);
    const noRun = checkedHarness([OLD_RUN], { 'history.json': HISTORY });
    assert.equal(await checked(noRun, 'data/dashboard-summary.json'), OLD_RUN);
    assert.deepEqual(fetchesOf(noRun, 'data/dashboard-summary.json'), ['no-cache'], 'without run.json the copy must be revalidated');
    const missing = checkedHarness([404]);
    assert.equal(await checked(missing, 'data/dashboard-summary.json'), 404);
    const garbled = checkedHarness(['garbled']);
    await assert.rejects(checked(garbled, 'data/dashboard-summary.json'), { name: 'SyntaxError' });
    assert.equal(fetchesOf(garbled, 'data/dashboard-summary.json').length, 1);
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

test('every data file is fetched through keyedFetch, and the latest JSON files are checked', () => {
    const keyed = [...app.matchAll(/\?v=\$\{DATA_CACHE_VERSION\}/g)];
    assert.equal(keyed.length, 1, 'a data URL is built outside keyedFetch');
    assert.match(fnSource('async function keyedFetch(path, init)'), /await dataKeyReady\(\);[\s\S]*fetch\(`\$\{path\}\?v=\$\{DATA_CACHE_VERSION\}`, options\)/);
    const dataFetches = [...app.matchAll(/(?<![\w.])fetch\(\s*`([^`]*)`/g)].map((m) => m[1]);
    assert.deepEqual(dataFetches, ['${path}?v=${DATA_CACHE_VERSION}'], 'a data file is fetched without the shared key');
    assert.match(fnSource('async function fetchAndDecompress(url, onProgress, init)'), /await keyedFetch\(url, init\)/);
    assert.match(fnSource('async function sgFetchGzText(url, init)'), /await keyedFetch\(url, init\)/);
    assert.match(fnSource('function fetchLatestSummary()'), /fetchChecked\('data\/dashboard-summary\.json', s => s\.extracted_at\)/);
    assert.match(fnSource('async function loadIndustryView()'), /fetchChecked\('data\/industry_sponsors\.json', d => d\.source_extracted_at\)/);
    assert.match(app, /fetchChecked\(`\$\{sgBase\(date\)\}\/sex_gender_parsed_meta\.json`, m => m\.source_extracted_at\)/);
    assert.match(app, /fetchChecked\(`\$\{base\}\/sex_gender\/methods\.json`, m => m\.source_extracted_at\)/);
    assert.match(app, /fetchChecked\(`\$\{sgBase\(key\)\}\/dashboard-summary\.json`, s => s\.extracted_at\)/);
});
