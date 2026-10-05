/**
 * The Year Range window follows the data, not a year written into the page.
 *
 * index.html ships the slider at 2009–2026, and app.js compared every study's
 * results year against that 2026. From the first 2027 results date, the
 * desktop default (and the Industry view, which honours the same slider)
 * would have left those studies out without saying so, and a range input
 * cannot even be set past its max. The window's upper end is now the latest
 * results year in the dataset on screen, and an upper thumb at that end
 * applies no bound at all.
 *
 * getFilteredData, industryFilteredRows, disableFiltersForMobile and the
 * year-window helpers run on their own in a vm with a stub document whose
 * sliders start from index.html's own attributes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function fnSource(signature) {
    const at = app.indexOf(signature);
    assert.ok(at >= 0, `app.js lost ${signature}`);
    const end = app.indexOf('\n}\n', at);
    return app.slice(at, end + 2);
}
const attr = (id, name) => {
    const m = html.match(new RegExp(`id="${id}"[^>]*\\b${name}="(\\d+)"`));
    assert.ok(m, `index.html lost #${id}'s ${name}`);
    return m[1];
};

function harness() {
    const slider = (id) => ({ value: attr(id, 'value'), min: attr(id, 'min'), max: attr(id, 'max'), style: {} });
    const hint = { textContent: '(Results Posted Date)' };
    const filters = {
        classList: { add() {} }, querySelectorAll: () => [], prepend() {},
        querySelector: (sel) => (sel === '.filter-hint' ? hint : null)
    };
    const els = {
        'year-start': slider('year-start'), 'year-end': slider('year-end'),
        'year-start-label': { textContent: '' }, 'year-end-label': { textContent: '' },
        'year-range-fill': { style: {} }, 'year-start-tooltip': { style: {} }, 'year-end-tooltip': { style: {} },
        // The desktop default: Interventional, every other control at "all".
        'study-type': { value: 'INTERVENTIONAL' }, 'min-participants': { value: '' }, 'max-participants': { value: '' },
        filters
    };
    const context = vm.createContext({
        document: {
            getElementById: (id) => els[id] || null,
            querySelectorAll: () => [],
            createElement: () => ({ style: {} })
        },
        sgReadFilters: () => null, isAIStudy: () => false, getStudyPediatricStatus: () => '',
        studyMatchesConditionFilter: () => true, sgRow: () => null,
        industryRole: 'any', industryDemo: 'sex', industryTrialValue: () => 1
    });
    const start = app.indexOf('const YEAR_WINDOW_MIN');
    assert.ok(start >= 0, 'app.js lost YEAR_WINDOW_MIN');
    const helpers = app.slice(start, app.indexOf('function initFilters()'));
    vm.runInContext(`let data = null; let dashboardSummary = null; let sgV2Filters = null; let industryData = null;
        ${helpers}\n${fnSource('function getFilteredData()')}\n${fnSource('function industryFilteredRows()')}
        ${fnSource('function disableFiltersForMobile()')}`, context);
    const run = (src) => JSON.parse(JSON.stringify(vm.runInContext(src, context) ?? null));
    return { els, hint, run };
}

const STUDIES = `[{ nct_id: 'A', study_type: 'INTERVENTIONAL', results_date: '2026-12-30' },
                  { nct_id: 'B', study_type: 'INTERVENTIONAL', results_date: '2027-01-02' }]`;
// Row layout: [bucket, pf, results_year, pcd_year, primary, secondary, has_explicit_unknown, via_lead]
const TRIALS = `{ trials: [[0, 50, 2026, 2024, 0, 0, 0, 1], [0, 50, 2027, 2025, 0, 0, 0, 1]], primaries: [], secondaries: [] }`;

test('a 2027 results date survives the default desktop view', () => {
    const h = harness();
    h.run(`data = ${STUDIES}; syncYearWindow();`);
    assert.equal(h.els['year-end'].max, '2027', 'the window still ends at the year written into index.html');
    assert.equal(h.els['year-start'].max, '2027', 'the lower thumb cannot reach the new year');
    assert.equal(h.els['year-end'].value, '2027', 'the default upper thumb did not move to the new end');
    assert.equal(h.els['year-end-label'].textContent, '2027');
    assert.equal(h.els['year-end-tooltip'].style.left, '100%');
    assert.deepEqual(h.run('getFilteredData().map(s => s.nct_id)'), ['A', 'B']);
});

test('the Industry view keeps 2027 trials under the same slider', () => {
    const h = harness();
    h.run(`data = ${STUDIES}; industryData = ${TRIALS}; syncYearWindow();`);
    assert.deepEqual(h.run('industryFilteredRows().map(t => t[2])'), [2026, 2027]);
});

test('an upper thumb at the end of a stale window applies no bound; a narrowed one does', () => {
    // A slider that has not caught up with the data (a view drawn before the
    // sync, or industry_sponsors.json running ahead of the study records)
    // still drops nothing.
    const h = harness();
    h.run(`data = ${STUDIES}; industryData = ${TRIALS};`);
    assert.equal(h.els['year-end'].max, '2026', 'the stub no longer starts from index.html’s 2026');
    assert.deepEqual(h.run('getFilteredData().map(s => s.nct_id)'), ['A', 'B']);
    assert.deepEqual(h.run('industryFilteredRows().map(t => t[2])'), [2026, 2027]);
    // A thumb the reader moved off the end is a real bound.
    h.run('syncYearWindow();');
    h.els['year-end'].value = '2026';
    assert.deepEqual(h.run('getFilteredData().map(s => s.nct_id)'), ['A']);
    assert.deepEqual(h.run('industryFilteredRows().map(t => t[2])'), [2026]);
});

test('a narrowed range is kept across a dataset switch; the default follows the data', () => {
    const h = harness();
    h.run(`data = ${STUDIES}; syncYearWindow();`);
    h.els['year-end'].value = '2020';
    // An aggregate archive whose results end in 2026
    h.run(`dashboardSummary = { byYear: { '2009': {}, '2026': {} } }; syncYearWindow();`);
    assert.equal(h.els['year-end'].max, '2026', 'an archive kept the latest data’s window');
    assert.equal(h.els['year-end'].value, '2020', 'a narrowed range was widened by a switch');
    // Back at the archive's end, then back to the latest data
    h.els['year-end'].value = '2026';
    h.run('dashboardSummary = null; syncYearWindow();');
    assert.equal(h.els['year-end'].value, '2027', 'a thumb at the archive’s end did not follow the latest data');
    assert.deepEqual(h.run('getFilteredData().map(s => s.nct_id)'), ['A', 'B']);
    // A lower thumb past a shorter window's end is pulled back inside it
    h.els['year-start'].value = '2027';
    h.run(`dashboardSummary = { byYear: { '2009': {}, '2026': {} } }; syncYearWindow();`);
    assert.equal(h.els['year-start'].value, '2026');
    assert.equal(h.els['year-end'].value, '2026');
});

test('the phone hint names the summary’s own latest year', () => {
    const h = harness();
    h.run(`dashboardSummary = { byYear: { '2009': {}, '2027': {} } }; data = []; disableFiltersForMobile();`);
    assert.equal(h.hint.textContent, '(2009–2027 · full range shown)');
});

test('every dataset change re-syncs the window before it draws', () => {
    const order = (src, from, what) => {
        const at = src.indexOf(from);
        assert.ok(at >= 0, `lost ${from}`);
        const sync = src.indexOf('syncYearWindow()', at);
        const draw = src.indexOf(what, at);
        assert.ok(sync >= 0 && sync < draw, `${what} after ${from} runs before syncYearWindow()`);
    };
    const selector = fnSource('async function initHistorySelector()');
    order(selector, 'await loadData(chosen)', 'populateConditionsDropdown()');
    order(selector, 'await loadData(previousValue', 'renderDashboard()');
    order(fnSource('async function loadDataAndRender('), 'await loadData(date)', 'populateConditionsDropdown()');
    const init = fnSource('function initFilters()');
    assert.match(init, /syncYearWindow\(\)/, 'the desktop start-up never sizes the window from the data');
});

test('no year logic is written against a fixed final year', () => {
    for (const sig of ['function resetFilters()', 'function updateActiveFilters()', 'function getFilteredData()',
                       'function industryFilteredRows()', 'function disableFiltersForMobile()',
                       'function datasetLatestYear()', 'function paintYearSlider()',
                       'function syncYearWindow()', 'function yearWindowEnds()']) {
        const code = fnSource(sig).replace(/^\s*\/\/.*$/gm, '');   // comments may name years
        assert.doesNotMatch(code, /\b20(2[6-9]|[3-9]\d)\b|2100/, `${sig} still names a final year`);
    }
});
