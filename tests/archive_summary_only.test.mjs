/**
 * The 2026-03-29 archive opens.
 *
 * history.json lists 2026-03-29, and snapshots/2026-03-29/ holds only a
 * dashboard-summary.json from before the summary carried a study list
 * (recentStudies) or an FDA block. loadData opened it as an aggregate
 * archive, but the selector's change handler read the absent study list as a
 * failed load ("No data returned"), reverted, and left the archive
 * unreachable. An aggregate archive is loaded once its summary is. What the
 * summary lacks is shown as absent, never as zero: the Studies tab says the
 * archive keeps no study list, and the FDA tiles show a dash and say the
 * archive did not record it.
 *
 * The real loadData, initHistorySelector (and its change handler),
 * loadDataAndRender, renderDashboard, the Studies tab and renderFdaOversight
 * run in a vm against the real history.json and the real
 * snapshots/2026-03-29/dashboard-summary.json. Every part request answers
 * 404, as it does on the site; anything else the page asks for is recorded,
 * so a fetch of study records or details for this archive fails the test.
 * Chart drawing and the filter controls are stubbed: they are not under test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const app = readFileSync(new URL('app.js', root), 'utf8');
const html = readFileSync(new URL('index.html', root), 'utf8');
const history = JSON.parse(readFileSync(new URL('history.json', root), 'utf8'));
const DATE = '2026-03-29';
const SUMMARY_PATH = `snapshots/${DATE}/dashboard-summary.json`;

function slice(startMarker, endMarker) {
    const at = app.indexOf(startMarker);
    assert.ok(at >= 0, `app.js lost ${startMarker}`);
    const end = app.indexOf(endMarker, at);
    assert.ok(end > at, `could not find the end of ${startMarker}`);
    return app.slice(at, end + endMarker.length);
}
const fnSource = (sig) => slice(sig, '\n}\n');

const SOURCES = [
    slice('// ── Study details on demand', '// ── end study details on demand'),
    slice('const NUM_PARTS =', '\n'),
    fnSource('function partFiles(n)'),
    // The newest-date helpers (PR #252) the loaders and the selector go through.
    'let NEWEST_PUBLISHED = null;\nlet DATA_RUN_DATE = null;\nasync function newestPublishedReady() { return NEWEST_PUBLISHED; }',
    fnSource('function publishedDates(manifest)'),
    fnSource('function newestPublishedIn(manifest)'),
    fnSource('function noteNewestPublished(manifest)'),
    fnSource('function servedFromData(date)'),
    fnSource('function datasetKey(date)'),
    fnSource('function datasetBase(key)'),
    fnSource('function getUrlStrategies(date)'),
    fnSource('async function fetchAndDecompress(url, onProgress, init)'),
    fnSource('function partsFromDifferentRuns(parts)'),
    fnSource('function stalePartIndexes(parts, expectedStamp)'),
    fnSource('async function refetchStaleParts(parts, expectedStamp, refetch)'),
    fnSource('async function loadData(date)'),
    // loadData reads data/run.json again when the newest date is not in
    // snapshots/ (snapshot_link.test.mjs); not reached here.
    fnSource('function runDate(run)'),
    slice('const RUN_RECHECK_WAIT_MS =', '\n'),
    fnSource('async function recheckRunDate()'),
    fnSource('function datasetLoaded()'),
    fnSource('function datasetStudyCount()'),
    fnSource('async function loadDataAndRender(date)'),
    fnSource('async function initHistorySelector()'),
    // The change handler drops what is not on screen (PR #253).
    'const sgCache = new Map();',
    fnSource('function retainSnapshots(onScreen)'),
    fnSource('function setDataPulledDate(iso)'),
    fnSource('function renderDashboard()'),
    fnSource('function refreshStudiesTab()'),
    slice('const ARCHIVE_NO_STUDY_LIST', '\n'),
    fnSource('function prepareStudiesTab()'),
    fnSource('function renderStudiesTable()'),
    // The FDA tab's constants, fdaClassOf and renderFdaOversight, which ends
    // where the Geography tab's doc comment starts.
    slice('const FDA_CLASS_ORDER', '\n}\n\n/**').slice(0, -3)
].join('\n');

// What the dashboard around these functions provides, reduced to what they
// call. The chart renderers, filters and pager are not under test.
const SCAFFOLD = `
let data = null; let datasetReader = null; let dashboardSummary = null; let studiesTabReady = false;
let charts = {}; let currentPage = 0; let studiesPageSize = 15; let currentSort = { field: null, direction: 'asc' };
const snapshotCache = new Map();
const calls = { render: 0, syncYearWindow: 0, chartsBuilt: 0 };
function getFilteredData() { return data ? [...data] : []; }
async function keyedFetch(path, init) { return fetch(\`\${path}?v=test\`, init); }
function describePartsProgress() { return { fraction: 0, text: '' }; }
function showSnapshotLoading() {} function hideSnapshotLoading() {}
async function snapshotStage() {} async function sgLoad() {}
function syncYearWindow() { calls.syncYearWindow++; }
function populateConditionsDropdown() {} function populateCountriesDropdown() {} function populatePrimaryConditionDropdown() {}
function labelChartsForA11y() {} function updateShareUrl() {}
function showDashboardSpinner() { calls.render++; } function hideDashboardSpinner() {}
function renderOverviewFinding() {} function renderOverviewTileContext() {} function renderFilterSummary() {}
function renderReportingTrends() {} function renderRaceDistribution() {} function renderRaceTrends() {}
function renderRaceSubcategories() {} function renderRaceReportedParticipants() {} function renderRaceFullDistribution() {}
function renderEthnicityDistribution() {} function renderEthnicityTrends() {} function renderEthnicitySubcategories() {}
function renderEthnicityReportedParticipants() {} function renderEthnicityFullDistribution() {}
function renderSexReportedParticipants() {} function renderSexFullDistribution() {} function renderSexDistribution() {}
function renderSexTrends() {} function renderGenderReportedParticipants() {} function renderGenderFullDistribution() {}
function renderGenderDistribution() {} function renderGenderTrends() {} function renderGeographyDashboard() {}
function sgActive() { return false; } function sgApplyMode() {} function sgAfterRender() {}
function initColumnPicker() {} function renderPagination() {} function fixTableScroll() {}
function renderSparkline() { return ''; } function getTimeToReport() { return null; }
function renderReportedCell() { return ''; } function renderDemographicCell() { return ''; }
function renderGeographyCell() { return ''; } function renderFdaCell() { return ''; } function renderPublications() { return ''; }
function escapeHtml(t) { return String(t); }
const COLORS = { reporting: { both: '#111', race: '#222', ethnicity: '#333' } };
const ChartDataLabels = {}; const fdaRowConnectorPlugin = {};
class Chart { constructor(canvas) { calls.chartsBuilt++; this.canvas = canvas; } destroy() {} }
`;

// A stub element: what these functions read and write on one.
function element(id) {
    const kids = {};
    const classes = new Set();
    return {
        id, textContent: '', innerHTML: '', value: '', hidden: false, style: {}, dataset: {}, attrs: {},
        options: [{ value: 'latest' }],
        classList: {
            add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
            toggle(c, on) { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); }
        },
        querySelector(sel) { return (kids[sel] ||= element(`${id} ${sel}`)); },
        querySelectorAll() { return []; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        contains() { return false; },
        focus() {},
        appendChild(o) { this.options.push(o); },
        addEventListener(type, fn) { (this.listeners ||= {})[type] = fn; }
    };
}

const FDA_COUNTS = ['fda-regulated-count', 'fda-drug-count', 'fda-device-count', 'fda-nonregulated-count'];
const FDA_SUBS = ['fda-regulated-sub', 'fda-drug-sub', 'fda-device-sub', 'fda-nonregulated-sub'];

// The page on Latest (two records, cached, as after start-up), with the given
// tab open and the FDA tiles showing Latest's numbers.
function harness({ activeTab = 'overview' } = {}) {
    const requests = [];
    const toasts = [];
    const els = {};
    const el = (id) => (els[id] ||= element(id));
    const tabs = {};
    const tab = (name) => (tabs[name] ||= Object.assign(element(`tab-${name}`), { dataset: { tab: name } }));
    tab(activeTab).classList.add('active');
    const document = {
        getElementById: el,
        createElement: () => element('option'),
        querySelector(sel) {
            if (sel === '.tab.active') return Object.values(tabs).find((t) => t.classList.contains('active')) || null;
            const m = /^\.tab\[data-tab="([\w-]+)"\]$/.exec(sel);
            return m ? tab(m[1]) : null;
        },
        querySelectorAll: () => [],
        activeElement: null
    };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        Response, setTimeout, clearTimeout,
        requestAnimationFrame: (fn) => { setImmediate(fn); return 1; }, cancelAnimationFrame() {},
        LATEST_RUN_STAMP: null, SMALL_FILE_WAIT_MS: 50, hasDecompressionStream: true,
        isMobileDevice: false, window: {}, location: { reload() {} }, document,
        updateLoadingProgress() {},
        showToast: (msg, kind) => toasts.push({ kind, msg }),
        fetchHistory: async () => history,
        fetch: async (url) => {
            const path = url.replace(/\?v=.*$/, '');
            requests.push(path);
            // The archive keeps no parts; nothing but its summary is served.
            if (/\/demographics\.part\d+\.json\.gz$/.test(path) || path !== SUMMARY_PATH) return new Response('', { status: 404 });
            const file = new URL(path, root);
            assert.ok(existsSync(file), `${path} is not in the repository`);
            return new Response(readFileSync(file), { status: 200 });
        }
    });
    vm.runInContext(SCAFFOLD + SOURCES, context);
    const run = (src) => vm.runInContext(src, context);
    run(`data = [
            { nct_id: 'NCT00000001', is_fda_regulated_drug: true, is_fda_regulated_device: false, race: { reported: true }, sex: { reported: true }, ethnicity: { reported: false } },
            { nct_id: 'NCT00000002', is_fda_regulated_drug: false, is_fda_regulated_device: true, race: { reported: false }, sex: { reported: true }, ethnicity: { reported: false } }
        ];
        datasetReader = makeReader({ mode: 'inline', key: 'latest', base: 'data', rows: data });
        snapshotCache.set('latest', { data, dateLabel: 'Latest', summary: null, extractedAt: '2026-10-04', reader: datasetReader });`);
    FDA_COUNTS.forEach((id) => { el(id).textContent = '1,234'; });
    FDA_SUBS.forEach((id) => { el(id).textContent = 'from Latest'; });
    el('fda-chart-absent').hidden = true;   // as index.html ships it
    const select = el('history-date');
    select.value = 'latest';
    const choose = async (value) => { select.value = value; await select.listeners.change(); };
    return { run, el, tab, select, choose, requests, toasts, calls: run('calls') };
}

const errors = (h) => h.toasts.filter((t) => t.kind === 'error').map((t) => t.msg);

test('2026-03-29 is still offered, and its archive is a summary without a study list or an FDA block', () => {
    assert.ok(history.dates.includes(DATE));
    const s = JSON.parse(readFileSync(new URL(SUMMARY_PATH, root), 'utf8'));
    assert.equal(s.recentStudies, undefined);
    assert.equal(s.fda, undefined);
    assert.equal(s.totalStudies, 77176);
    assert.ok(s.byYear && s.cards, 'the charts draw from byYear and cards');
});

test('choosing 2026-03-29 opens it as an aggregate archive instead of reverting', async () => {
    const h = harness();
    await h.run('initHistorySelector()');
    assert.ok(h.select.options.some((o) => o.value === DATE), 'the selector offers the archive');
    await h.choose(DATE);
    assert.deepEqual(errors(h), [], 'the archive was reported unavailable');
    assert.equal(h.select.value, DATE, 'the selector snapped back');
    assert.equal(h.select.dataset.lastValue, DATE);
    assert.equal(h.run('dashboardSummary && dashboardSummary.totalStudies'), 77176);
    assert.equal(h.run('datasetReader.mode'), 'summary');
    assert.ok(h.calls.render >= 1, 'the dashboard was not drawn');
    assert.equal(h.el('total-studies').textContent, '77,176');
    const loaded = h.toasts.filter((t) => t.msg.startsWith('Loaded '));
    assert.equal(loaded.length, 1);
    assert.match(loaded[0].msg, /^Loaded 2026-03-29 snapshot — 77,176 studies$/,
        'the toast counts the summary, not its absent study list');
});

test('the archive fetches its summary and nothing of study records or details, Studies tab included', async () => {
    const h = harness({ activeTab: 'studies' });
    await h.run('initHistorySelector()');
    await h.choose(DATE);
    await h.run('prepareStudiesTab()');
    const parts = Array.from({ length: 8 }, (_, i) => `snapshots/${DATE}/demographics.part${i + 1}.json.gz`);
    assert.deepEqual([...h.requests].sort(), [...parts, SUMMARY_PATH].sort(),
        'only the parts (404) and the summary may be asked for');
    assert.equal(h.el('studies-extras-status').hidden, true, 'the extras row is shown for an archive with no extras');
});

test('the Studies tab says the archive keeps no study list, not "No studies found"', async () => {
    const h = harness({ activeTab: 'studies' });
    await h.run('initHistorySelector()');
    await h.choose(DATE);
    // The switch redraws the open Studies tab (refreshStudiesTab).
    assert.equal(h.el('study-count').textContent,
        'This archive keeps no study list; its charts show the archive’s totals');
    assert.equal(h.el('studies-table-body').innerHTML, '');
    // An archive that has a study list still counts its rows.
    h.run(`dashboardSummary = { totalStudies: 9, recentStudies: [{ nct_id: 'NCT1' }] }; data = dashboardSummary.recentStudies; renderStudiesTable();`);
    assert.equal(h.el('study-count').textContent, 'Showing 1–1 of 1 studies');
    // A list that is there but empty is not an absent one.
    h.run('dashboardSummary = { totalStudies: 9, recentStudies: [] }; data = dashboardSummary.recentStudies; renderStudiesTable();');
    assert.equal(h.el('study-count').textContent, 'No studies found');
});

test('with the FDA tab open, the switch shows the tiles as absent, not zero and not Latest\'s', async () => {
    const h = harness({ activeTab: 'fda-oversight' });
    await h.run('initHistorySelector()');
    h.run("charts.fdaReporting = new Chart(document.getElementById('fda-reporting-chart'))");   // Latest's chart
    await h.choose(DATE);
    for (const id of FDA_COUNTS) assert.equal(h.el(id).textContent, '—', `${id} shows ${h.el(id).textContent}`);
    for (const id of FDA_SUBS) assert.equal(h.el(id).textContent, 'not recorded in this archive', id);
    assert.equal(h.el('fda-reporting-chart').style.display, 'none', 'an empty chart is left on screen');
    assert.equal(h.el('fda-chart-absent').hidden, false, 'the chart area does not say why it is empty');
    assert.equal(h.run('charts.fdaReporting'), null, "Latest's chart is left in place");
    // Clicking the FDA tab calls renderFdaOversight(filtered), and filtered is
    // [] while data is empty. That input gives the same dashes. (The click
    // handler itself is not loaded here; the served check clicks the tab.)
    FDA_COUNTS.forEach((id) => { h.el(id).textContent = '0'; });
    h.run('renderFdaOversight([])');
    for (const id of FDA_COUNTS) assert.equal(h.el(id).textContent, '—');
});

test('back on Latest, the FDA tiles and chart return', async () => {
    const h = harness({ activeTab: 'fda-oversight' });
    await h.run('initHistorySelector()');
    await h.choose(DATE);
    await h.choose('latest');
    assert.deepEqual(errors(h), []);
    assert.equal(h.select.value, 'latest');
    assert.equal(h.run('dashboardSummary'), null);
    assert.equal(h.el('fda-regulated-count').textContent, '2');
    assert.equal(h.el('fda-drug-count').textContent, '1');
    assert.equal(h.el('fda-chart-absent').hidden, true, 'the archive note stays on Latest');
    assert.equal(h.el('fda-reporting-chart').style.display, '', 'the chart stays hidden on Latest');
    assert.ok(h.calls.chartsBuilt >= 1);
    assert.match(h.toasts.at(-1).msg, /^Loaded latest snapshot \(cached\) — 2 studies$/);
});

test('an archive with an FDA block still renders its numbers', async () => {
    const h = harness({ activeTab: 'fda-oversight' });
    const s = JSON.parse(readFileSync(new URL('snapshots/2026-04-26/dashboard-summary.json', root), 'utf8'));
    assert.ok(s.fda, '2026-04-26 is expected to carry an FDA block');
    h.run(`dashboardSummary = ${JSON.stringify({ totalStudies: s.totalStudies, fda: s.fda })}; data = []; renderFdaOversight([]);`);
    for (const id of FDA_COUNTS) assert.match(h.el(id).textContent, /^\d[\d,]*$/, `${id} shows ${h.el(id).textContent}`);
    assert.equal(h.el('fda-chart-absent').hidden, true);
});

test('the error-recovery reload opens 2026-03-29 too', async () => {
    const h = harness();
    await h.run(`loadDataAndRender('${DATE}')`);
    assert.deepEqual(errors(h), []);
    assert.ok(h.calls.render >= 1, 'loadDataAndRender drew nothing for the archive');
    assert.equal(h.calls.syncYearWindow, 1);
    assert.equal(h.el('total-studies').textContent, '77,176');
});

test('the chart note for an archive without an FDA block is in the page, hidden', () => {
    const m = /<p class="note" id="fda-chart-absent" hidden>([^<]+)<\/p>/.exec(html);
    assert.ok(m, 'index.html lost #fda-chart-absent');
    const section = html.slice(html.indexOf('<section id="fda-oversight"'), html.indexOf('</section>', html.indexOf('<section id="fda-oversight"')));
    assert.ok(section.includes('id="fda-chart-absent"'), 'the note is not in the FDA tab');
});
