/**
 * The Year Range window follows the data, not a year written into the page.
 *
 * index.html ships the slider at 2009–2026, and app.js compared every study's
 * results year against that 2026. From the first 2027 results date, the
 * desktop default (and the Industry view, which honours the same slider)
 * would have left those studies out without saying so, and a range input
 * cannot even be set past its max. The window's upper end is now the latest
 * results year in the dataset on screen, and an upper thumb at that end
 * applies no bound at all. The Years chip names the range the filters apply
 * after every move of the window.
 *
 * The year-window helpers, initFilters (for the slider's own listeners),
 * Reset, the chips, the share-link writer and reader, getFilteredData,
 * industryFilteredRows and disableFiltersForMobile run on their own in a vm
 * with a stub document. Its range inputs start from index.html's own
 * attributes and clamp their value the way a browser does.
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
function between(from, to) {
    const a = app.indexOf(from), b = app.indexOf(to, a);
    assert.ok(a >= 0 && b > a, `app.js lost ${from} … ${to}`);
    return app.slice(a, b);
}
const attr = (id, name) => {
    const m = html.match(new RegExp(`id="${id}"[^>]*\\b${name}="(\\d+)"`));
    assert.ok(m, `index.html lost #${id}'s ${name}`);
    return m[1];
};

function stubElement(id, props = {}) {
    const handlers = {};
    const el = {
        id, value: 'all', style: {}, dataset: {}, textContent: '', innerHTML: '',
        classList: { add() {} }, prepend() {}, querySelectorAll: () => [],
        querySelector: (sel) => (sel === 'option' ? { value: 'all' } : null),
        addEventListener: (type, fn) => (handlers[type] ||= []).push(fn),
        dispatchEvent: (ev) => { for (const fn of handlers[ev.type] || []) fn({ type: ev.type, target: el }); return true; }
    };
    return Object.assign(el, props);
}

// A range input as a browser keeps one: the value stays inside [min, max],
// and moving min or max re-clamps it.
function rangeInput(id) {
    const el = stubElement(id, { type: 'range' });
    let min = attr(id, 'min'), max = attr(id, 'max'), value = attr(id, 'value');
    const clamp = (v) => {
        const n = parseInt(v, 10), lo = +min, hi = +max;
        return String(Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : Math.round((lo + hi) / 2));
    };
    Object.defineProperties(el, {
        min: { get: () => min, set: (v) => { min = String(v); value = clamp(value); }, enumerable: true },
        max: { get: () => max, set: (v) => { max = String(v); value = clamp(value); }, enumerable: true },
        value: { get: () => value, set: (v) => { value = clamp(v); }, enumerable: true }
    });
    return el;
}

function harness() {
    const hint = { textContent: '(Results Posted Date)' };
    const els = {
        'year-start': rangeInput('year-start'), 'year-end': rangeInput('year-end'),
        // The desktop default: Interventional, every other control at "all".
        'study-type': stubElement('study-type', { value: 'INTERVENTIONAL' }),
        'min-participants': stubElement('min-participants', { value: '' }),
        'max-participants': stubElement('max-participants', { value: '' }),
        'ai-study-filter': stubElement('ai-study-filter', { checked: false }),
        'history-date': stubElement('history-date', { value: 'latest' }),
        // The chips' container hands back one tag per chip, as the DOM would.
        'active-filters': stubElement('active-filters', {
            querySelectorAll: (sel) => (sel === '.filter-tag' ? (tags = chipLabels().map(() => ({ dataset: {} }))) : [])
        }),
        filters: stubElement('filters', { querySelector: (sel) => (sel === '.filter-hint' ? hint : null) })
    };
    let url = null, tags = [];
    const chipLabels = () => [...els['active-filters'].innerHTML.matchAll(/filter-tag">\s*([^<]*?)\s*</g)].map(m => m[1]);
    const context = vm.createContext({
        document: {
            getElementById: (id) => (els[id] ||= stubElement(id)),
            querySelectorAll: () => [],
            querySelector: (sel) => (sel === '.tab.active' ? { dataset: { tab: 'overview' } } : null),
            createElement: () => stubElement('')
        },
        history: { replaceState: (_s, _t, u) => { url = u; } },
        location: { pathname: '/', search: '', hash: '' },
        URLSearchParams, Event: class { constructor(type) { this.type = type; } },
        sgReadFilters: () => null, isAIStudy: () => false, getStudyPediatricStatus: () => '',
        studyMatchesConditionFilter: () => true, sgRow: () => null, SG_STATE_LABELS: {},
        populateConditionsDropdown() {}, populateCountriesDropdown() {}, populateSecondaryConditionDropdown() {},
        renderDashboard() {},
        industryRole: 'any', industryDemo: 'sex', industryTrialValue: () => 1
    });
    const helpers = between('const YEAR_WINDOW_MIN', 'function initFilters()');
    const share = between('let shareUrlReady = false;', 'function applyRouteFromHash()');
    vm.runInContext(`let data = null; let dashboardSummary = null; let sgV2Filters = null; let industryData = null;
        ${helpers}\n${share}\n${fnSource('function initFilters()')}\n${fnSource('function resetFilters()')}
        ${fnSource('function updateActiveFilters()')}\n${fnSource('function removeFilter(')}\n${fnSource('function getFilteredData()')}
        ${fnSource('function industryFilteredRows()')}\n${fnSource('function disableFiltersForMobile()')}`, context);
    const run = (src) => JSON.parse(JSON.stringify(vm.runInContext(src, context) ?? null));
    const ys = els['year-start'], ye = els['year-end'];
    return {
        els, hint, run, ys, ye,
        // The reader drags a thumb: the slider's own input listener, then change.
        drag(el, year) {
            el.value = String(year);
            el.dispatchEvent({ type: 'input' });
            el.dispatchEvent({ type: 'change' });
        },
        // A dataset switch, as the selector's change handler makes it.
        latest(studies = STUDIES) { run(`data = ${studies}; dashboardSummary = null; syncYearWindow();`); },
        archive(last) { run(`dashboardSummary = { byYear: { '2009': {}, '${last}': {} } }; syncYearWindow();`); },
        window: () => `${ys.value}-${ye.value} of ${ys.min}-${ye.max}`,
        rows: () => run('getFilteredData().map(s => s.nct_id)'),
        end: () => run('yearWindowEnds().end'),   // Infinity serialises as null
        chips: chipLabels,
        // The reader clicks a chip's ×
        removeChip(label) {
            const i = chipLabels().indexOf(label);
            assert.ok(i >= 0, `no chip ${label}`);
            context.__tag = tags[i];
            run('removeFilter({ closest: () => __tag }, { preventDefault() {} });');
        },
        link() {
            run('shareUrlReady = true; updateShareUrl();');
            const q = new URLSearchParams((url || '').split('?')[1] || '');
            return { ys: q.get('ys'), ye: q.get('ye') };
        }
    };
}

const STUDIES = `[{ nct_id: 'A', study_type: 'INTERVENTIONAL', results_date: '2026-12-30' },
                  { nct_id: 'B', study_type: 'INTERVENTIONAL', results_date: '2027-01-02' }]`;
const STUDIES_2026 = `[{ nct_id: 'A', study_type: 'INTERVENTIONAL', results_date: '2026-12-30' }]`;
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

test('the Years chip names the range the filters apply after every switch', () => {
    const h = harness();
    h.run(`data = ${STUDIES}; initFilters();`);
    const agrees = (step) => {
        const bounded = h.ys.value !== h.ys.min || h.end() !== null;
        assert.deepEqual(h.chips(), bounded ? [`Years: ${h.ys.value}-${h.ye.value}`] : [],
            `the chip disagrees with the filters ${step}`);
    };
    agrees('at start-up');
    h.drag(h.ye, 2026);
    agrees('after narrowing to 2026');
    h.archive(2026);
    agrees('on an archive ending in 2026');
    h.latest();
    agrees('back on Latest');
    h.drag(h.ys, 2027);
    agrees('with the lower thumb at 2027');
    h.archive(2026);
    agrees('with the lower thumb on the archive');
    h.latest();
    agrees('back on Latest again');
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
