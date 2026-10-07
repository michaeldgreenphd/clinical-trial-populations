/**
 * A dataset switch redraws an open Industry view under the Year Range it
 * leaves.
 *
 * The Industry Sponsors view draws the latest sponsor data under the global
 * Year Range and Condition controls, whatever dataset is on screen. A switch
 * fits the Year Range to the dataset it opens (syncYearWindow): an archive
 * whose results end earlier clamps a chosen bound, and the way back to Latest
 * puts it back. The switch then redrew the dashboard, and with it the line
 * above the panel, but renderDashboard never draws the Industry view, so its
 * chart and its cohort count stayed on the old window while the line named
 * the new one. Every switch path (the selector's change handler, Latest
 * included, its revert after a failed switch, loadDataAndRender, the
 * recovery reload, and start-up) now calls renderIndustryAfterSwitch right
 * after renderDashboard, which draws an open Industry view once. Start-up
 * too: a #industry link opens the view at DOMContentLoaded, and its small
 * sponsor file can be drawn while the dataset is still loading, from the
 * thumbs as they stood before initFilters fitted them.
 *
 * The real selector handler (initHistorySelector), loadDataAndRender,
 * syncYearWindow and its helpers, renderDashboard, renderFilterSummary,
 * syncFilterToggle, industryFilteredRows, renderIndustry and start-up's
 * drawing steps run in a vm with a stub document. loadData, the chart renderers and the Industry view's
 * three drawings are stubbed; the drawings record the rows they were given.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function slice(startMarker, endMarker) {
    const at = app.indexOf(startMarker);
    assert.ok(at >= 0, `app.js lost ${startMarker}`);
    const end = app.indexOf(endMarker, at);
    assert.ok(end > at, `could not find the end of ${startMarker}`);
    return app.slice(at, end + endMarker.length);
}
const fnSource = (sig) => slice(sig, '\n}\n');
const line = (start) => slice(start, '\n');
// The start-up listener, and in it the steps that draw the first screen.
const init = slice("document.addEventListener('DOMContentLoaded', async () => {", '\n});\n');
const initDraw = (() => {
    const from = "updateLoadingProgress(90, 'Drawing charts');";
    const to = "updateLoadingProgress(100, 'Ready');";
    const at = init.indexOf(from);
    assert.ok(at >= 0 && init.indexOf(to, at) > at, 'start-up lost its drawing steps');
    return init.slice(at, init.indexOf(to, at) + to.length);
})();
// The Industry redraw the switch paths share, once it exists: before it they
// drew the dashboard alone, and the tests below show what that left.
const optional = (sig) => (app.includes(sig) ? fnSource(sig) : '');

const SOURCES = [
    fnSource('async function loadDataAndRender(date)'),
    fnSource('async function initHistorySelector()'),
    optional('function renderIndustryAfterSwitch()'),
    fnSource('function datasetLoaded()'),
    fnSource('function datasetStudyCount()'),
    // The Year Range window: syncYearWindow and the helpers it and the
    // Industry view read (yearWindowEnds, industryNewestResultsYear).
    slice('const YEAR_WINDOW_MIN', 'function initFilters()').slice(0, -'function initFilters()'.length),
    fnSource('function renderDashboard()'),
    fnSource('function renderFilterSummary(total, unfiltered)'),
    line('const ARCHIVE_FILTERS_NOTE'),
    fnSource('function syncFilterToggle()'),
    fnSource('function redrawArchiveSummary()'),
    fnSource('function industryActive()'),
    line('let industryData = null;'),
    line('let industryLoadFailed = false;'),
    line("let industryView = 'heatmap';"),
    fnSource('function industryFilteredRows()'),
    fnSource('function renderIndustry()')
].join('\n');

// What the page around these functions provides, reduced to what they call.
const SCAFFOLD = `
let data = null; let dashboardSummary = null; let NEWEST_PUBLISHED = '2026-10-04';
const snapshotCache = new Map();
const calls = { loads: [], dashboards: 0, toasts: [], failShareOnce: false };
const FAIL = new Set();
async function loadData(date) {
    const key = date || 'latest';
    calls.loads.push(key);
    if (FAIL.has(key)) throw new Error('HTTP 404');
    const d = DATASETS[key];
    if (d.summary) { dashboardSummary = d.summary; data = null; }
    else { dashboardSummary = null; data = d.records; }
}
function datasetKey(d) { return d; }
function servedFromData() { return false; }
function noteNewestPublished() {}
async function fetchHistory() { return { dates: ['2026-02-22', '2026-10-04'] }; }
function showSnapshotLoading() {} function hideSnapshotLoading() {}
async function snapshotStage() {} async function sgLoad() {}
function retainSnapshots() {}
function populateConditionsDropdown() {} function populateCountriesDropdown() {} function populatePrimaryConditionDropdown() {}
function labelChartsForA11y() {}
function updateShareUrl() { if (calls.failShareOnce) { calls.failShareOnce = false; throw new Error('share link'); } }
function showToast(msg, kind) { calls.toasts.push({ kind, msg }); }
function updateActiveFilters() {}
function getFilteredData() { return data ? [...data] : []; }
function showDashboardSpinner() { calls.dashboards++; } function hideDashboardSpinner() {}
function requestAnimationFrame(f) { f(); }
function renderOverviewFinding() {} function renderOverviewTileContext() {}
function renderReportingTrends() {} function renderRaceDistribution() {} function renderRaceTrends() {}
function renderRaceSubcategories() {} function renderRaceReportedParticipants() {} function renderRaceFullDistribution() {}
function renderEthnicityDistribution() {} function renderEthnicityTrends() {} function renderEthnicitySubcategories() {}
function renderEthnicityReportedParticipants() {} function renderEthnicityFullDistribution() {}
function renderSexReportedParticipants() {} function renderSexFullDistribution() {} function renderSexDistribution() {}
function renderSexTrends() {} function renderGenderReportedParticipants() {} function renderGenderFullDistribution() {}
function renderGenderDistribution() {} function renderGenderTrends() {} function renderGeographyDashboard() {}
function renderFdaOversight() {} function refreshStudiesTab() {}
function sgActive() { return false; } function sgApplyMode() {} function sgAfterRender() {}
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// The Industry view around renderIndustry: one sponsor, the Sex tier, and
// its three drawings recording what they were given.
let industryRole = 'any', industryDemo = 'sex';
function industryTrialValue() { return 50; }
const INDUSTRY_VIEW_QUESTIONS = { heatmap: '{metric}', trend: '{metric}', forest: '' };
function industryMetricLabel() { return 'female'; }
function industrySelectedOrdered() { return { list: ['Pfizer'], total: 1, start: 0 }; }
function renderIndustryPager() {} function updateIndustryShareUrl() {}
const drawn = [];
function renderIndustryHeatmap(rows) { drawn.push({ view: 'heatmap', years: rows.map(t => t[2]) }); }
function renderIndustryTrend(rows) { drawn.push({ view: 'trend', years: rows.map(t => t[2]) }); }
function renderIndustryForest() { drawn.push({ view: 'forest', years: null }); }
`;

// Latest: study records whose results run 2009-2026. The archive: a summary
// whose byYear ends in 2024, two years before Latest's.
const studies = (years) => years.map((y, i) => ({ nct_id: `NCT${i}`, results_date: `${y}-06-01` }));
const DATASETS = {
    latest: { records: studies([2009, 2015, 2026]) },
    '2026-02-22': {
        summary: {
            totalStudies: 76560, cards: { raceCount: 1, ethCount: 1, bothCount: 1 },
            byYear: { 2009: {}, 2016: {}, 2024: {} }
        }
    }
};
// The sponsor data: one trial per results year, and one with none.
const SPONSOR_YEARS = [2010, 2012, 2020, 2024, 2025, 2026, 2027, null];
const SPONSOR_DATA = {
    cohort_n: SPONSOR_YEARS.length, primaries: ['Oncology'], secondaries: ['Breast'],
    trials: SPONSOR_YEARS.map(y => [0, 50, y, 2011, 0, 0, 0, 1])
};

function element(id) {
    const classes = new Set();
    const e = {
        id, textContent: '', innerHTML: '', value: '', hidden: false, style: {}, dataset: {}, attrs: {},
        listeners: {},
        classList: {
            add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c)
        },
        setAttribute(k, v) { e.attrs[k] = String(v); },
        getAttribute(k) { return k in e.attrs ? e.attrs[k] : null; },
        removeAttribute(k) { delete e.attrs[k]; },
        addEventListener(type, fn) { e.listeners[type] = fn; }
    };
    return e;
}

// The selector: an options list that initHistorySelector can rebuild.
function selectElement() {
    const sel = element('history-date');
    const option = (value) => {
        const o = { value, textContent: value };
        o.remove = () => { sel.options = sel.options.filter(x => x !== o); };
        return o;
    };
    sel.options = [option('latest')];
    sel.value = 'latest';
    sel.appendChild = (o) => { o.remove = () => { sel.options = sel.options.filter(x => x !== o); }; sel.options.push(o); };
    return sel;
}

// The desktop page on Latest, the Industry tab open on `view` with its
// sponsor data loaded and drawn, and the Year Range at the reader's request.
async function harness({ view = 'heatmap', industryOpen = true, sponsorLoaded = true, start = '2009', end = '' } = {}) {
    const els = { 'history-date': selectElement() };
    const el = (id) => (els[id] ||= element(id));
    Object.assign(el('year-start'), { min: '2009', max: '2026', value: '2009' });
    Object.assign(el('year-end'), { min: '2009', max: '2026', value: '2026' });
    el('condition-primary').value = 'all';
    el('condition-secondary').value = 'all';
    el('filters').hidden = true;
    if (industryOpen) el('industry').classList.add('active');
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        window: {},
        document: {
            getElementById: el,
            createElement: () => ({ value: '', textContent: '' }),
            querySelector: () => null,
            querySelectorAll: () => []
        },
        DATASETS
    });
    vm.runInContext(SCAFFOLD + SOURCES, context);
    const run = (src) => vm.runInContext(src, context);
    run(`industryView = '${view}'; data = DATASETS.latest.records;`);
    if (sponsorLoaded) run(`industryData = ${JSON.stringify(SPONSOR_DATA)};`);
    // The reader's request, as a thumb move records it (noteYearChoice).
    el('year-start').dataset.chosen = start;
    el('year-end').dataset.chosen = end;
    run('syncYearWindow(); renderDashboard(); if (industryActive()) renderIndustry();');
    await run('initHistorySelector()');
    const select = els['history-date'];
    const h = {
        run, el, select,
        draws: () => run('drawn.length'),
        last: () => JSON.parse(JSON.stringify(run('drawn[drawn.length - 1] || null'))),
        rows: () => JSON.parse(run('JSON.stringify(industryFilteredRows().map(t => t[2]))')),
        meta: () => el('industry-meta').textContent,
        text: () => el('filter-summary-text').innerHTML,
        thumbs: () => `${el('year-start').value}-${el('year-end').value}`,
        // A reader's pick in the selector, through its change handler.
        async choose(value) {
            select.value = value;
            await select.listeners.change();
        }
    };
    return h;
}

// The chart, the count above it and the line all describe the same rows:
// what industryFilteredRows() returns for the controls now on screen.
function assertInStep(h, years, lineYears, why) {
    const last = h.last();
    assert.deepEqual(h.rows(), years, `${why}: the controls select other rows`);
    assert.deepEqual(last.years, years, `${why}: the ${last.view} was drawn from another window`);
    assert.equal(h.meta(), `${years.length} of ${SPONSOR_YEARS.length} cohort trials in the current filter`,
        `${why}: the cohort count is the old window's`);
    assert.match(h.text(), new RegExp(`results posted <b>${lineYears}</b>`), `${why}: the line names another window`);
}

for (const view of ['heatmap', 'trend']) {
    test(`a chosen end the archive clamps redraws the ${view}, and Latest puts it back`, async () => {
        // 2012-2025 on Latest; the archive's window ends 2024.
        const h = await harness({ view, start: '2012', end: '2025' });
        assertInStep(h, [2012, 2020, 2024, 2025, null], '2012–2025', 'on Latest');

        let before = h.draws();
        await h.choose('2026-02-22');
        assert.equal(h.thumbs(), '2012-2024', 'the archive did not clamp the end thumb');
        assert.equal(h.draws() - before, 1, 'one switch, one Industry drawing');
        assertInStep(h, [2012, 2020, 2024, null], '2012–2024', 'on the archive');

        before = h.draws();
        await h.choose('latest');
        assert.equal(h.thumbs(), '2012-2025', 'Latest did not put the request back');
        assert.equal(h.draws() - before, 1, 'one switch back, one Industry drawing');
        assertInStep(h, [2012, 2020, 2024, 2025, null], '2012–2025', 'back on Latest');
    });
}

test('a chosen end at Latest’s last year (a shared link’s 2009–2026) is clamped and restored too', async () => {
    const h = await harness({ start: '2009', end: '2026' });
    assertInStep(h, [2010, 2012, 2020, 2024, 2025, 2026, null], '2009–2026', 'on Latest');
    await h.choose('2026-02-22');
    assertInStep(h, [2010, 2012, 2020, 2024, null], '2009–2024', 'on the archive');
    await h.choose('latest');
    assertInStep(h, [2010, 2012, 2020, 2024, 2025, 2026, null], '2009–2026', 'back on Latest');
});

test('a start the archive clamps redraws the view: an open end reaches the newest sponsor year', async () => {
    const h = await harness({ start: '2026', end: '' });
    // On Latest an open end applies no bound; the line names the sponsor data's newest year.
    assert.deepEqual(h.rows(), [2026, 2027, null]);
    assert.deepEqual(h.last().years, [2026, 2027, null]);
    let before = h.draws();
    await h.choose('2026-02-22');
    assert.equal(h.thumbs(), '2024-2024');
    assert.equal(h.draws() - before, 1);
    assertInStep(h, [2024, 2025, 2026, 2027, null], '2024–2027', 'on the archive');
    before = h.draws();
    await h.choose('latest');
    assert.equal(h.draws() - before, 1);
    assert.deepEqual(h.last().years, [2026, 2027, null]);
    assert.equal(h.meta(), `3 of ${SPONSOR_YEARS.length} cohort trials in the current filter`);
});

test('the forest is redrawn once per switch, and its line still claims no window', async () => {
    const h = await harness({ view: 'forest', start: '2012', end: '2025' });
    let before = h.draws();
    await h.choose('2026-02-22');
    assert.equal(h.draws() - before, 1);
    assert.equal(h.last().view, 'forest');
    assert.equal(h.meta(), `4 of ${SPONSOR_YEARS.length} cohort trials in the current filter`);
    assert.match(h.text(), /adjusted estimates over all years and conditions/);
    before = h.draws();
    await h.choose('latest');
    assert.equal(h.draws() - before, 1);
    assert.equal(h.meta(), `5 of ${SPONSOR_YEARS.length} cohort trials in the current filter`);
});

test('a closed Industry view, or one whose sponsor data has not loaded, is not drawn by a switch', async () => {
    const closed = await harness({ industryOpen: false, start: '2012', end: '2025' });
    let before = closed.draws();
    await closed.choose('2026-02-22');
    await closed.choose('latest');
    assert.equal(closed.draws(), before, 'a switch drew the Industry view behind another tab');
    assert.equal(closed.run('calls.dashboards') >= 3, true);

    const unloaded = await harness({ sponsorLoaded: false, start: '2012', end: '2025' });
    before = unloaded.draws();
    await unloaded.choose('2026-02-22');
    assert.equal(unloaded.draws(), before, 'a switch drew the Industry view with no sponsor data');
    assert.deepEqual(unloaded.run('calls.toasts.filter(t => t.kind === "error").length'), 0);
});

test('a failed switch that reverts redraws the view once, from the window it reverts to', async () => {
    const h = await harness({ start: '2012', end: '2025' });
    await h.choose('2026-02-22');
    assertInStep(h, [2012, 2020, 2024, null], '2012–2024', 'on the archive');

    // Latest does not load: the archive stays, and so does its window.
    h.run("FAIL.add('latest');");
    let before = h.draws();
    await h.choose('latest');
    assert.equal(h.select.value, '2026-02-22', 'the selector did not revert');
    assert.equal(h.draws() - before, 1, 'the revert redraws the view once');
    assertInStep(h, [2012, 2020, 2024, null], '2012–2024', 'after the revert');

    // Latest loads and is drawn, then a later step throws: the revert puts
    // the archive back and narrows the window again.
    h.run("FAIL.delete('latest'); calls.failShareOnce = true;");
    before = h.draws();
    await h.choose('latest');
    assert.equal(h.select.value, '2026-02-22', 'the selector did not revert');
    assert.equal(h.draws() - before, 2, 'Latest drawn, then the archive it reverted to');
    assert.equal(h.thumbs(), '2012-2024');
    assertInStep(h, [2012, 2020, 2024, null], '2012–2024', 'after a revert from a drawn Latest');
});

test('loadDataAndRender, the reload a recovery button runs, redraws the view once', async () => {
    const h = await harness({ start: '2012', end: '2025' });
    let before = h.draws();
    await h.run("loadDataAndRender('2026-02-22')");
    assert.equal(h.draws() - before, 1);
    assertInStep(h, [2012, 2020, 2024, null], '2012–2024', 'after the reload of the archive');
    before = h.draws();
    await h.run("loadDataAndRender('latest')");
    assert.equal(h.draws() - before, 1);
    assertInStep(h, [2012, 2020, 2024, 2025, null], '2012–2025', 'after the reload of Latest');
});

test('start-up redraws an Industry view its route drew before the window was fitted', async () => {
    // A reload of ?sgsnapshot=2026-02-22#industry: the route opens the view
    // at DOMContentLoaded and its small sponsor file is drawn while the
    // archive still loads, from the thumbs as the reload restored them
    // (2025 to the end, nothing recorded) on the page's 2009-2026 slider.
    const h = await harness();
    for (const id of ['year-start', 'year-end']) {
        delete h.el(id).dataset.chosen;
        h.el(id).max = '2026';
    }
    h.el('year-start').value = '2025';
    h.el('year-end').value = '2026';
    h.run('renderIndustry();');
    assert.deepEqual(h.last().years, [2025, 2026, 2027, null]);

    // The archive lands; initFilters fits the window to it, then start-up
    // draws the first screen.
    h.run(`dashboardSummary = DATASETS['2026-02-22'].summary; data = null;
        function updateLoadingProgress() {}
        syncYearWindow();`);
    assert.equal(h.thumbs(), '2024-2024');
    const before = h.draws();
    h.run(initDraw);
    assert.equal(h.draws() - before, 1, 'start-up drew the Industry view other than once');
    assertInStep(h, [2024, 2025, 2026, 2027, null], '2024–2027', 'after start-up');
});

// Every place that fits the Year Range to a newly loaded dataset draws the
// dashboard and, as the very next step, an open Industry view
// (renderIndustryAfterSwitch): the selector's switch and its revert,
// loadDataAndRender, and start-up, whose initFilters syncs before the first
// screen is drawn.
test('every syncYearWindow() after a dataset load draws an open Industry view right after the dashboard', () => {
    const fns = ['async function loadDataAndRender(date)', 'async function initHistorySelector()'];
    let syncs = 0;
    for (const sig of fns) {
        const src = fnSource(sig);
        const parts = src.split('syncYearWindow();').slice(1);
        assert.ok(parts.length > 0, `${sig} no longer syncs the Year Range`);
        for (const after of parts) {
            syncs++;
            const draw = after.indexOf('renderDashboard();');
            assert.ok(draw >= 0, `${sig}: a sync with no dashboard drawn after it`);
            assert.match(after.slice(draw), /^renderDashboard\(\);\s*renderIndustryAfterSwitch\(\);/,
                `${sig}: the dashboard is drawn with no Industry redraw right after it`);
        }
    }
    assert.equal(syncs, 3, 'the switch, its revert and loadDataAndRender');
    // Outside those functions syncYearWindow() is called only by initFilters,
    // at start-up, which draws the dashboard and then the Industry view.
    assert.equal(app.split('syncYearWindow();').length - 1 - syncs, 1);
    assert.ok(fnSource('function initFilters()').includes('syncYearWindow();'));
    assert.ok(init.indexOf('initFilters();') >= 0 && init.indexOf('initFilters();') < init.indexOf(initDraw));
    assert.match(initDraw, /renderDashboard\(\);\s*(\/\/[^\n]*\s*)*renderIndustryAfterSwitch\(\);/,
        'start-up draws the dashboard with no Industry redraw right after it');
    assert.match(fnSource('function renderIndustryAfterSwitch()'),
        /\{\s*if \(industryActive\(\)\) renderIndustry\(\);\s*\}/);
});
