/**
 * The startup load of the latest records, when a part does not arrive.
 *
 * Cloudflare sends max-age=14400 with a .gz 404 as well as with the file,
 * so a part that was missing for a moment (a deploy in progress) would stay
 * missing in a browser for four hours, through every "Refresh the page".
 * fetchPart asks for a 4xx part once more past the browser cache, as
 * fetchSidecar does for the Studies-tab and detail files, and remembers the
 * parts that still failed (PARTS_PAST_CACHE), so a Try again goes past the
 * cache for them and only them.
 *
 * loadData, fetchPart and fetchAndDecompress run in a vm over a stub fetch
 * that serves gzipped parts and records each request and its cache mode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function fnSource(sig) {
    const at = app.indexOf(sig);
    assert.ok(at >= 0, `app.js lost ${sig}`);
    return app.slice(at, app.indexOf('\n}\n', at) + 2);
}
function constLine(name) {
    const m = app.match(new RegExp(`^const ${name} = .*;$`, 'm'));
    assert.ok(m, `app.js lost const ${name}`);
    return m[0];
}

const SOURCES = [
    constLine('NUM_PARTS'),
    fnSource('function partFiles(n)'),
    fnSource('function getUrlStrategies(date)'),
    fnSource('async function fetchAndDecompress(url, onProgress, init)'),
    constLine('PARTS_PAST_CACHE'),
    fnSource('async function fetchPart(url, onProgress, init)'),
    fnSource('function partsFromDifferentRuns(parts)'),
    fnSource('function stalePartIndexes(parts, expectedStamp)'),
    fnSource('async function refetchStaleParts(parts, expectedStamp, refetch)'),
    fnSource('async function loadData(date)')
].join('\n');

// What loadData calls around the parts: the keyed fetch adds the key only
// (its own behaviour is tests/data_cache_key.test.mjs's).
const SCAFFOLD = `
let data = null; let datasetReader = null; let dashboardSummary = null; let studiesTabReady = false;
let LATEST_RUN_STAMP = null;
const isMobileDevice = false;
const snapshotCache = new Map();
const hasDecompressionStream = true;
async function ensurePako() {}
async function newestPublishedReady() {}
function datasetKey(date) { return date || 'latest'; }
function datasetBase(key) { return !key || key === 'latest' ? 'data' : 'snapshots/' + key; }
async function keyedFetch(path, init) { return fetch(path + '?v=test', init); }
function describePartsProgress() { return { fraction: 0, text: '' }; }
function datasetLayout() { return null; }
function partsReader(key) { return { mode: 'inline', key }; }
function setDataPulledDate() {}
`;

const STAMP = '2026-10-04T12:09:21.454200+00:00';
const PARTS = Array.from({ length: 8 }, (_, i) => `data/demographics.part${i + 1}.json.gz`);
const gz = (k) => gzipSync(Buffer.from(JSON.stringify({ extracted_at: STAMP, part: k, data: [{ nct_id: `NCT0000000${k}` }] })));

/**
 * serve(path, n, init) answers the n-th request (from 1) for a path: a
 * number is that HTTP status, a Response is sent as it is, anything else is
 * the part's gzipped body. Frames run at once; progress records each write.
 */
function harness(serve = () => 'ok') {
    const requests = [];
    const counts = {};
    const progress = [];
    const ctx = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        document: { getElementById: () => ({ textContent: '' }) },
        window: {},
        requestAnimationFrame: (fn) => { fn(); return 0; }, cancelAnimationFrame() {},
        updateLoadingProgress: (...args) => progress.push(args),
        Response, TransformStream, DecompressionStream, AbortController,
        fetch: async (url, init = {}) => {
            const path = url.replace(/\?v=.*$/, '');
            counts[path] = (counts[path] || 0) + 1;
            requests.push({ path, cache: init.cache || 'default' });
            const k = PARTS.indexOf(path) + 1;
            const answer = serve(path, counts[path], init);
            if (typeof answer === 'number') return new Response('', { status: answer });
            if (answer instanceof Response) return answer;
            return new Response(gz(k), { status: 200 });
        }
    });
    vm.runInContext(SOURCES + SCAFFOLD, ctx);
    return {
        requests, progress,
        run: (src) => vm.runInContext(src, ctx),
        of: (path) => requests.filter((r) => r.path === path).map((r) => r.cache)
    };
}

test('a part that answers a cached 404 is asked for once more past the cache, and the load goes on', async () => {
    // The browser's copy of part 3 is a 404 the CDN served during a deploy;
    // the server has the file now.
    const h = harness((path, n, init) => (path === PARTS[2] && init.cache !== 'reload' ? 404 : 'ok'));
    await h.run('loadData()');
    assert.equal(h.run('data.length'), 8, 'the records did not load');
    assert.deepEqual(h.of(PARTS[2]), ['default', 'reload'], 'part 3 was not asked for again past the cache');
    for (const p of PARTS.filter((p) => p !== PARTS[2])) assert.deepEqual(h.of(p), ['default'], `${p} was asked for twice`);
    assert.equal(h.run('PARTS_PAST_CACHE.size'), 0);
});

test('a part still missing fails the load once, and a Try again asks for it past the cache, and for nothing else', async () => {
    let published = false;
    const h = harness((path) => (path === PARTS[2] && !published ? 404 : 'ok'));
    await assert.rejects(h.run('loadData()'), /part3\.json\.gz: HTTP 404/);
    assert.deepEqual(h.of(PARTS[2]), ['default', 'reload'], 'a 404 is asked for more than twice, or not past the cache');
    assert.deepEqual([...h.run('PARTS_PAST_CACHE')], [PARTS[2]]);
    published = true;
    h.requests.length = 0;
    await h.run('loadData()');
    assert.equal(h.run('data.length'), 8);
    assert.deepEqual(h.of(PARTS[2]), ['reload'], 'the retry asked the browser cache for the part that failed');
    for (const p of PARTS.filter((p) => p !== PARTS[2])) assert.deepEqual(h.of(p), ['default'], `${p} went past the cache`);
    assert.equal(h.run('PARTS_PAST_CACHE.size'), 0, 'a part that loaded is still marked');
});

test('a 5xx is not asked for twice in one load, but goes past the cache on the next', async () => {
    let down = true;
    const h = harness((path) => (path === PARTS[0] && down ? 503 : 'ok'));
    await assert.rejects(h.run('loadData()'), /HTTP 503/);
    assert.deepEqual(h.of(PARTS[0]), ['default']);
    down = false;
    h.requests.length = 0;
    await h.run('loadData()');
    assert.deepEqual(h.of(PARTS[0]), ['reload']);
});

test('a snapshot\'s parts are asked for once: a 404 there is a summary-only archive', async () => {
    const h = harness(() => 404);
    await assert.rejects(h.run("loadData('2026-03-29')"));
    const asked = h.requests.filter((r) => /demographics\.part/.test(r.path));
    assert.equal(asked.length, 8, 'a snapshot part was asked for twice');
    assert.ok(asked.every((r) => r.cache === 'default'));
    assert.equal(h.run('PARTS_PAST_CACHE.size'), 0);
});

test('when a part fails, the parts still downloading stop, and stop moving the loading screen', async () => {
    // Part 2 has sent its first bytes and is still coming; part 1 is gone.
    let slow = null;
    let signal = null;
    const h = harness((path, n, init) => {
        if (path === PARTS[0]) return 404;
        if (path !== PARTS[1]) return 'ok';
        signal = init.signal;
        const body = new ReadableStream({
            start(c) {
                slow = c;
                c.enqueue(new Uint8Array(gz(2).subarray(0, 8)));
                if (init.signal) init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
            }
        });
        return new Response(body, { status: 200 });
    });
    await assert.rejects(h.run('loadData()'), /part1\.json\.gz: HTTP 404/);
    assert.ok(signal, 'the parts are fetched without a signal to stop them');
    assert.equal(signal.aborted, true, 'part 2 goes on downloading after the load failed');
    const writes = h.progress.length;
    try { slow.enqueue(new Uint8Array(64)); } catch { /* stopped: the stream is closed */ }
    await new Promise((r) => setImmediate(r));
    assert.equal(h.progress.length, writes, 'a part still in flight moved the loading screen after the load failed');
    assert.deepEqual([...h.run('PARTS_PAST_CACHE')], [PARTS[0]], 'a part stopped by the failure is asked for past the cache next time');
});
