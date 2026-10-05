/**
 * The Year Range window follows the data, not a year written into the page.
 *
 * index.html ships the slider at 2009–2026, and app.js compared every study's
 * results year against that 2026. From the first 2027 results date, the
 * desktop default (and the Industry view, which honours the same slider)
 * would have left those studies out without saying so, and a range input
 * cannot even be set past its max. The window's upper end is now the latest
 * results year in the dataset on screen, and an upper thumb the reader
 * leaves at that end applies no bound at all.
 *
 * What the reader asked for is kept apart from the thumbs, so a switch to a
 * dataset whose window ends at or before a chosen year neither drops the
 * bound nor narrows it, and the Years chip and the share link follow.
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
    assert.equal(h.ye.max, '2027', 'the window still ends at the year written into index.html');
    assert.equal(h.ys.max, '2027', 'the lower thumb cannot reach the new year');
    assert.equal(h.ye.value, '2027', 'the default upper thumb did not move to the new end');
    assert.equal(h.els['year-end-label'].textContent, '2027');
    assert.equal(h.els['year-end-tooltip'].style.left, '100%');
    assert.deepEqual(h.rows(), ['A', 'B']);
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
    assert.equal(h.ye.max, '2026', 'the stub no longer starts from index.html’s 2026');
    assert.deepEqual(h.rows(), ['A', 'B']);
    assert.deepEqual(h.run('industryFilteredRows().map(t => t[2])'), [2026, 2027]);
    // A thumb the reader moved off the end is a real bound.
    h.run('initFilters();');
    h.drag(h.ye, 2026);
    assert.deepEqual(h.rows(), ['A']);
    assert.deepEqual(h.run('industryFilteredRows().map(t => t[2])'), [2026]);
});

test('a narrowed range is kept across dataset switches; the default follows the data', () => {
    const h = harness();
    h.run(`data = ${STUDIES}; initFilters();`);
    h.drag(h.ye, 2020);
    h.archive(2026);   // an aggregate archive whose results end in 2026
    assert.equal(h.window(), '2009-2020 of 2009-2026', 'a narrowed range was widened by a switch');
    h.latest();
    assert.equal(h.window(), '2009-2020 of 2009-2027');
    // Reset: the upper end is open again and follows each dataset's end
    h.run('resetFilters();');
    h.archive(2026);
    assert.equal(h.window(), '2009-2026 of 2009-2026');
    h.latest();
    assert.equal(h.window(), '2009-2027 of 2009-2027', 'an open upper end did not follow the latest data');
    assert.deepEqual(h.rows(), ['A', 'B']);
    // A lower thumb past a shorter window's end is pulled inside it, and
    // goes back to the reader's year once the data reaches it again
    h.drag(h.ys, 2027);
    h.archive(2026);
    assert.equal(h.window(), '2026-2026 of 2009-2026');
    h.latest();
    assert.equal(h.window(), '2027-2027 of 2009-2027', 'the lower thumb lost the reader’s year');
    assert.deepEqual(h.rows(), ['B']);
});

test('a deliberate end at an archive’s last year stays a bound, on screen and in the link', () => {
    // From January 2027 every archive ends in 2026, and "leave out the
    // partial new year" (an end of 2026) is the likeliest narrowing.
    const h = harness();
    h.run(`data = ${STUDIES}; initFilters();`);
    h.drag(h.ye, 2026);
    assert.deepEqual(h.rows(), ['A']);
    assert.deepEqual(h.link(), { ys: null, ye: '2026' });
    h.archive(2026);
    assert.equal(h.window(), '2009-2026 of 2009-2026');
    assert.equal(h.end(), 2026, 'a deliberate 2026 became "no upper limit" where the window ends in 2026');
    assert.deepEqual(h.link(), { ys: null, ye: '2026' }, 'the share link dropped the bound');
    h.latest();
    assert.equal(h.window(), '2009-2026 of 2009-2027', 'the range widened on the way back to Latest');
    assert.deepEqual(h.rows(), ['A']);
    assert.deepEqual(h.link(), { ys: null, ye: '2026' });
    // A window that ends before the bound clamps the thumb, and the bound
    // comes back with the data
    h.archive(2024);
    assert.equal(h.window(), '2009-2024 of 2009-2024');
    assert.deepEqual(h.link(), { ys: null, ye: '2026' }, 'a link copied here would lose the reader’s 2026');
    h.latest();
    assert.equal(h.window(), '2009-2026 of 2009-2027', 'the clamp to 2024 outlived the archive');
    // The reader dragging the thumb to a window's end is "no upper limit"
    h.archive(2026);
    h.drag(h.ye, 2025);
    h.drag(h.ye, 2026);
    assert.equal(h.end(), null);
    h.latest();
    assert.equal(h.window(), '2009-2027 of 2009-2027');
    assert.deepEqual(h.rows(), ['A', 'B']);
});

test('the Years chip names the range the filters apply after every switch', () => {
    const h = harness();
    h.run(`data = ${STUDIES}; initFilters();`);
    const agrees = (step) => {
        const bounded = h.ys.value !== h.ys.min || h.end() !== null;
        assert.deepEqual(h.chips(), bounded ? [`Years: ${h.ys.value}-${h.ye.value}`] : [], step);
    };
    agrees('start-up');
    h.drag(h.ye, 2026);
    assert.deepEqual(h.chips(), ['Years: 2009-2026']);
    h.archive(2024);
    assert.deepEqual(h.chips(), ['Years: 2009-2024'], 'the chip kept naming 2026 over a window clamped to 2024');
    h.latest();
    assert.deepEqual(h.chips(), ['Years: 2009-2026']);
    h.removeChip('Years: 2009-2026');
    assert.deepEqual(h.chips(), []);
    assert.equal(h.end(), null, 'the chip’s × left the bound in place');
    h.archive(2026);
    h.latest();
    assert.equal(h.window(), '2009-2027 of 2009-2027', 'a bound cleared by the chip’s × came back after a switch');
    h.drag(h.ye, 2026);
    h.drag(h.ye, 2027);
    agrees('thumb back at the end');
    h.drag(h.ys, 2027);
    assert.deepEqual(h.chips(), ['Years: 2027-2027']);
    h.archive(2026);
    assert.deepEqual(h.chips(), ['Years: 2026-2026'], 'a stale “Years: 2027-2027” over a window ending in 2026');
    h.latest();
    agrees('back on Latest');
    h.run('resetFilters();');
    assert.deepEqual(h.chips(), []);
});

test('a shared link keeps its years where the window ends at or before them', () => {
    // A link copied from an archive ending in 2026, after the reader left
    // out 2027 on Latest, opens on that archive first.
    const h = harness();
    h.latest(STUDIES_2026);
    h.run('initFilters(); applyShareParams("ye=2026");');
    assert.equal(h.window(), '2009-2026 of 2009-2026');
    assert.equal(h.end(), 2026, 'the link’s 2026 end turned into “no upper limit”');
    assert.deepEqual(h.chips(), ['Years: 2009-2026']);
    h.latest();
    assert.equal(h.window(), '2009-2026 of 2009-2027');
    assert.deepEqual(h.rows(), ['A']);
    // A start past this window's end is clamped on screen and kept for the
    // data that reaches it; a link without ye stays open-ended
    const g = harness();
    g.latest(STUDIES_2026);
    g.run('initFilters(); applyShareParams("ys=2027");');
    assert.equal(g.window(), '2026-2026 of 2009-2026');
    assert.equal(g.end(), null);
    assert.deepEqual(g.link(), { ys: '2027', ye: null });
    g.latest();
    assert.equal(g.window(), '2027-2027 of 2009-2027', 'the link’s 2027 start was lost to the clamp');
    assert.deepEqual(g.rows(), ['B']);
    assert.deepEqual(g.link(), { ys: '2027', ye: null });
    // A hand-edited link whose end is before its start keeps the thumbs'
    // own clamp (2020–2020), before and after a switch
    const k = harness();
    k.latest(STUDIES_2026);
    k.run('initFilters(); applyShareParams("ys=2020&ye=2015");');
    assert.equal(k.window(), '2020-2020 of 2009-2026');
    k.latest();
    assert.equal(k.window(), '2020-2020 of 2009-2027');
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
                       'function noteYearChoice(', 'function noteYearFromLink(', 'function yearWindowRequest()',
                       'function syncYearWindow()', 'function resetYearWindow()', 'function yearWindowEnds()',
                       'function shareYearValue(', 'function updateShareUrl()', 'function applyShareParams(']) {
        const code = fnSource(sig).replace(/^\s*\/\/.*$/gm, '');   // comments may name years
        assert.doesNotMatch(code, /\b20(2[6-9]|[3-9]\d)\b|2100/, `${sig} still names a final year`);
    }
});
