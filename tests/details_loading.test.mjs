/**
 * When the study modals fetch data/details.part1/2.json.gz.
 *
 * The details files are a frozen 2026-03-05 extract. The part files already
 * carry every field the modals read, so a dataset loaded from parts must not
 * fetch them: the download is 82 MB, and merged over a current record they
 * replace its sites and outcomes with March values. Only the summary-only
 * archives (desktop, dashboardSummary set) still read them.
 *
 * loadDetailData, resetDetailState and prepareStudiesTab are evaluated on
 * their own in a vm, with the globals they read declared beside them and
 * fetchAndDecompress stubbed to log requests and answer them on demand. A
 * dataset switch is played the way loadData does it: data, dashboardSummary
 * and resetDetailState() in one synchronous step. That loadData keeps doing
 * it that way, and that the modals check for a switch after their wait, is
 * asserted on the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// The source of one top-level function: from its declaration to the first
// line that closes it.
function fnSource(signature) {
    const at = app.indexOf(signature);
    assert.ok(at >= 0, `app.js lost ${signature}`);
    const end = app.indexOf('\n}\n', at);
    assert.ok(end > at, `could not find the end of ${signature}`);
    return { at, end: end + 2, src: app.slice(at, end + 2) };
}

const startIdx = app.indexOf('let detailLoad = null;');
const loader = fnSource('async function loadDetailData()');
assert.ok(startIdx >= 0 && loader.at > startIdx, 'app.js lost loadDetailData or its in-flight state');
const block = app.slice(startIdx, loader.end);
assert.match(block, /function resetDetailState\(\)/, 'resetDetailState moved away from loadDetailData');
const prepare = fnSource('async function prepareStudiesTab()');

function harness({ mobile = false } = {}) {
    const requests = [];
    const pending = [];
    const els = {
        'studies-loading-screen': { style: { display: 'none' } },
        'studies-ready-content': { style: { display: '' } }
    };
    let renders = 0;
    const context = vm.createContext({
        console: { log() {}, warn() {} },
        document: { getElementById: (id) => els[id] || null },
        initColumnPicker() {},
        renderStudiesTable() { renders++; },
        fetchAndDecompress: (url) => {
            requests.push(url);
            return new Promise((resolve, reject) => pending.push({ url, resolve, reject }));
        }
    });
    vm.runInContext(
        `let data = []; let detailCache = {}; let detailsLoaded = false; let dashboardSummary = null;
         let studiesTabReady = false; let currentPage = 0;
         const isMobileDevice = ${mobile};\n${block}\n${prepare.src}`, context);
    // Values cross the vm realm boundary as plain JSON, so deepEqual compares
    // structure rather than realm-specific prototypes.
    const run = (src) => vm.runInContext(src, context);
    const json = (src) => JSON.parse(vm.runInContext(`JSON.stringify(${src})`, context));
    const answer = ({ url, resolve, reject }, fail) => {
        if (fail) reject(new Error('HTTP 404'));
        else resolve({ data: { [url.includes('part1') ? 'NCT00000001' : 'NCT00000002']: { study_sites: [{ facility: 'March' }] } } });
    };
    // Answer every outstanding request, or only the oldest n.
    const settle = (fail = false) => { while (pending.length) answer(pending.shift(), fail); };
    const settleFirst = (n) => { for (let i = 0; i < n; i++) answer(pending.shift(), false); };
    const tick = () => new Promise((r) => setImmediate(r));
    // loadData putting a dataset on screen.
    const showArchive = () => run(`data = [{ nct_id: 'NCT-A' }]; dashboardSummary = { recentStudies: data }; resetDetailState();`);
    const showParts = () => run(`data = [{ nct_id: 'NCT-L' }]; resetDetailState(); dashboardSummary = null;`);
    return { requests, run, json, settle, settleFirst, tick, els, renders: () => renders, showArchive, showParts };
}

// A request is issued synchronously, before loadDetailData's first await, so
// each test checks the request log before it awaits, and answers whatever was
// asked: a regression then fails the assertion instead of hanging the run.
const T = { timeout: 5000 };

test('a dataset loaded from part files never fetches the details', T, async () => {
    const h = harness();
    h.showParts();
    const calls = [h.run('loadDetailData()'), h.run('loadDetailData()')];
    assert.deepEqual(h.requests, []);
    h.settle();
    await Promise.all(calls);
    await h.tick();
    assert.deepEqual(h.requests, [], 'a details fetch was started in the background');
    assert.equal(h.run('detailsLoaded'), true);
    assert.equal(h.run('Object.keys(detailCache).length'), 0, 'nothing is merged over the current records');
});

test('mobile never fetches the details', T, async () => {
    const h = harness({ mobile: true });
    h.showArchive();
    const call = h.run('loadDetailData()');
    assert.deepEqual(h.requests, []);
    h.settle();
    await call;
    assert.equal(h.run('detailsLoaded'), true);
});

test('a summary-only archive fetches both files once, however many callers wait', T, async () => {
    const h = harness();
    h.showArchive();
    const a = h.run('loadDetailData()');
    const b = h.run('loadDetailData()');
    assert.deepEqual(h.requests, ['data/details.part1.json.gz', 'data/details.part2.json.gz']);
    h.settle();
    await Promise.all([a, b]);
    assert.equal(h.run('detailsLoaded'), true);
    assert.deepEqual(h.json('Object.keys(detailCache).sort()'), ['NCT00000001', 'NCT00000002']);
    await h.run('loadDetailData()');
    assert.equal(h.requests.length, 2, 'a loaded archive does not fetch again');
});

test('resetDetailState gives the new dataset a new cache object', () => {
    const h = harness();
    h.run('globalThis.before = detailCache; detailsLoaded = true; studiesTabReady = true;');
    h.run('resetDetailState()');
    assert.equal(h.run('detailCache === globalThis.before'), false, 'the cache was emptied in place, so a late fetch would land in the new dataset');
    assert.equal(h.run('detailsLoaded'), false);
    assert.equal(h.run('studiesTabReady'), false);
});

test('a fetch that finishes after a switch to the latest data fills the old cache, not the new one', T, async () => {
    const h = harness();
    h.showArchive();
    const archiveLoad = h.run('loadDetailData()');
    h.showParts();
    const latestLoad = h.run('loadDetailData()');
    assert.equal(h.requests.length, 2, 'the latest view started a details fetch of its own');
    h.settle();
    await Promise.all([archiveLoad, latestLoad]);
    assert.equal(h.run('Object.keys(detailCache).length'), 0, 'March details leaked into the latest view');
    assert.equal(h.run('detailsLoaded'), true);
});

test('a call made while an uncached dataset loads belongs to the dataset still on screen', T, async () => {
    // Archive on screen; the user picks a full snapshot, whose parts take a
    // while. A keyboard user opens a study meanwhile: that call still sees
    // the archive, and its March details must stay with the archive.
    const h = harness();
    h.showArchive();
    const during = h.run('loadDetailData()');
    assert.equal(h.requests.length, 2);
    h.showParts();
    h.settle();
    await during;
    assert.equal(h.run('Object.keys(detailCache).length'), 0, 'March details landed in the full snapshot');
    assert.equal(h.run('detailsLoaded'), false, 'the full snapshot was marked loaded by the archive fetch');

    // The other way round: latest on screen, an archive loading.
    const k = harness();
    k.showParts();
    await k.run('loadDetailData()');
    k.showArchive();
    const archive = k.run('loadDetailData()');
    assert.equal(k.requests.length, 2, 'the archive inherited "loaded" from the latest view and never fetched');
    k.settle();
    await archive;
    assert.equal(k.run('detailsLoaded'), true);
});

test('when the old archive fetch finishes first, the new archive keeps waiting for its own', T, async () => {
    const h = harness();
    h.showArchive();
    const first = h.run('loadDetailData()');
    h.showArchive();
    const second = h.run('loadDetailData()');
    assert.equal(h.requests.length, 4, 'the new dataset waited on a fetch that fills the old cache');
    h.settleFirst(2);
    await first;
    assert.equal(h.run('detailsLoaded'), false, 'the old fetch marked the new archive loaded');
    const again = h.run('loadDetailData()');
    assert.equal(h.requests.length, 4, 'the old fetch cleared the new one in flight, so a third download started');
    h.settle();
    await Promise.all([second, again]);
    assert.equal(h.run('detailsLoaded'), true);
    assert.equal(h.run('Object.keys(detailCache).length'), 2);
});

test('a failed fetch is retried on the next call, and leaves the records as they are', T, async () => {
    const h = harness();
    h.showArchive();
    const p = h.run('loadDetailData()');
    h.settle(true);
    await p;
    await h.tick();
    assert.equal(h.run('detailsLoaded'), false);
    assert.equal(h.run('Object.keys(detailCache).length'), 0);
    const retry = h.run('loadDetailData()');
    assert.equal(h.requests.length, 4);
    h.settle();
    await retry;
    assert.equal(h.run('detailsLoaded'), true);
});

test('after a switch, the Studies tab follows the new dataset, not the old wait', T, async () => {
    const h = harness();
    h.showArchive();
    const archiveTab = h.run('prepareStudiesTab()');
    assert.equal(h.els['studies-loading-screen'].style.display, '', 'the archive shows its loading screen');
    // Switch to the latest data with the Studies tab open: renderDashboard
    // hands the tab to prepareStudiesTab for the new dataset.
    h.showParts();
    await h.run('prepareStudiesTab()');
    assert.equal(h.els['studies-loading-screen'].style.display, 'none', 'the latest view waits on the archive download');
    assert.equal(h.els['studies-ready-content'].style.display, '');
    assert.equal(h.renders(), 1);
    h.settle();
    await archiveTab;
    assert.equal(h.renders(), 1, 'the archive call redrew the tab after the switch');
    assert.equal(h.run('studiesTabReady'), true);
});

test('loadData resets the detail state in the step that puts a dataset on screen', () => {
    const { src } = fnSource('async function loadData(date)');
    assert.doesNotMatch(src, /detailCache\s*=|detailsLoaded\s*=/, 'loadData resets detail state outside resetDetailState');
    const resets = [...src.matchAll(/resetDetailState\(\);/g)].map((m) => m.index);
    assert.equal(resets.length, 3, 'expected a reset on the cache-hit, part-file and archive paths');
    for (const r of resets) {
        // The straight-line stretch around the reset: from the last await or
        // return before it to the first return after it.
        const before = src.slice(0, r);
        const from = Math.max(before.lastIndexOf('await '), before.lastIndexOf('return'));
        const to = src.indexOf('return', r);
        const stretch = src.slice(from, to).replace(/^(await|return)[^\n]*\n/, '');
        assert.doesNotMatch(stretch, /\bawait\b/, `an await separates resetDetailState() from the data it belongs to:\n${stretch}`);
        assert.match(stretch, /\bdata = /, `resetDetailState() is not beside the data assignment:\n${stretch}`);
        assert.match(stretch, /dashboardSummary = /, `resetDetailState() is not beside the dashboardSummary assignment:\n${stretch}`);
    }
});

test('the modals and the Studies tab stand down when the dataset changes during their wait', () => {
    for (const sig of ['async function showStudyDetails(nctId)', 'async function showGeographyBreakdown(nctId)', 'async function prepareStudiesTab()']) {
        const { src } = fnSource(sig);
        assert.match(src, /const rows = data;[\s\S]*await loadDetailData\(\);/, `${sig} does not note its dataset before the wait`);
        assert.match(src, /await loadDetailData\(\);\s*if \(data !== rows\) return;/, `${sig} does not check for a switch right after the wait`);
    }
    const { src } = fnSource('function renderDashboard()');
    assert.match(src, /if \(studiesTabReady\)[\s\S]*?else[\s\S]*?prepareStudiesTab\(\)/, 'renderDashboard no longer hands an unready Studies tab to prepareStudiesTab');
});

test('only loadDetailData names the details files', () => {
    const outside = app.slice(0, startIdx) + app.slice(loader.end);
    assert.doesNotMatch(outside, /details\.part/, 'another code path in app.js fetches the frozen details files');
    assert.doesNotMatch(html, /details\.part/, 'index.html references the frozen details files');
});
