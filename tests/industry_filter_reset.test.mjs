/**
 * Reset and a filter chip's × redraw the Industry Sponsors view.
 *
 * The Industry view honours the global Year Range and Condition filters, and
 * redraws on their 'change' events. Reset (resetFilters) and a chip's ×
 * (removeFilter) set the controls' values directly, so no 'change' fires:
 * the filter line and industryFilteredRows() moved to the cleared filter
 * while #industry-meta and the charts kept the old one (e.g. "49 of 30,229
 * cohort trials" over a view the controls said was unfiltered). Both now
 * redraw the view when it is the active tab, as the 'change' listeners do.
 *
 * The Industry block of app.js (from INDUSTRY_PINK to the end, its
 * DOMContentLoaded wiring included), the year-window helpers, Reset, the
 * chips and removeFilter run in a vm with a stub document, over the shipped
 * data/industry_sponsors.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sponsors = JSON.parse(readFileSync(new URL('../data/industry_sponsors.json', import.meta.url)));

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
    const classes = new Set();
    const el = {
        id, value: 'all', style: {}, dataset: {}, textContent: '', innerHTML: '', hidden: false,
        classList: {
            add: (c) => classes.add(c), remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
        },
        querySelectorAll: () => [], querySelector: () => null,
        addEventListener: (type, fn) => (handlers[type] ||= []).push(fn),
        dispatchEvent: (ev) => { for (const fn of handlers[ev.type] || []) fn({ type: ev.type, target: el }); return true; }
    };
    return Object.assign(el, props);
}

// `active`: whether the Industry Sponsors section is the tab on screen.
function harness({ active = true } = {}) {
    let tags = [];
    const chipLabels = () => [...els['active-filters'].innerHTML.matchAll(/filter-tag">\s*([^<]*?)\s*</g)].map(m => m[1]);
    const els = {
        // The slider as index.html ships it.
        'year-start': stubElement('year-start', { type: 'range', min: attr('year-start', 'min'), max: attr('year-start', 'max'), value: attr('year-start', 'value') }),
        'year-end': stubElement('year-end', { type: 'range', min: attr('year-end', 'min'), max: attr('year-end', 'max'), value: attr('year-end', 'value') }),
        // The desktop default: Interventional, every other control at "all".
        'study-type': stubElement('study-type', { value: 'INTERVENTIONAL' }),
        'min-participants': stubElement('min-participants', { value: '' }),
        'max-participants': stubElement('max-participants', { value: '' }),
        'ai-study-filter': stubElement('ai-study-filter', { checked: false }),
        // The chips' container hands back one tag per chip, as the DOM would.
        'active-filters': stubElement('active-filters', {
            querySelectorAll: (sel) => (sel === '.filter-tag' ? (tags = chipLabels().map(() => ({ dataset: {} }))) : [])
        })
    };
    const industry = (els.industry = stubElement('industry'));
    if (active) industry.classList.add('active');
    const mobile = { matches: false, addEventListener() {} };
    let onReady = null;
    const context = vm.createContext({
        sponsors, URLSearchParams, location: { hash: '', pathname: '/', search: '' },
        history: { replaceState(_state, _title, hash) { context.location.hash = hash; } },
        window: { matchMedia: () => mobile, addEventListener() {} },
        document: {
            getElementById: (id) => (els[id] ||= stubElement(id)),
            querySelectorAll: () => [], querySelector: () => null,
            addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') onReady = fn; }
        },
        escapeHtml: (s) => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
        COLORS: { race: {}, ethnicity: {} }, SG_STATE_LABELS: {},
        dashboardRenders: 0
    });
    vm.runInContext(`let data = null; let dashboardSummary = null;
        function renderDashboard() { dashboardRenders++; }
        function updateShareUrl() {}
        function keepAddressOnDataset() {}   // the snapshot in the address (address_dataset.test.mjs)
        ${between('const YEAR_WINDOW_MIN', 'function initFilters()')}
        ${fnSource('function resetFilters()')}\n${fnSource('function updateActiveFilters()')}\n${fnSource('function removeFilter(')}`, context);
    vm.runInContext(app.slice(app.indexOf('const INDUSTRY_PINK =')), context);
    // The column picker, the overflow note and the tier chips draw markup
    // these tests do not read.
    vm.runInContext(`renderIndustryConditionControls = () => {}; industrySyncHeatmapScrollNote = () => {};
        renderIndustryCatRow = () => {};
        industryData = sponsors; industrySelected = new Set(industryTop10());
        let industryRenders = 0;
        const drawIndustry = renderIndustry;
        renderIndustry = () => { industryRenders++; drawIndustry(); };`, context);
    assert.ok(onReady, 'the Industry block no longer wires its listeners on DOMContentLoaded');
    onReady();   // the real 'change' listeners on the year and condition controls
    const run = (src) => vm.runInContext(src, context);
    return {
        els, run,
        // The cohort trials #industry-meta says the view is drawn over.
        shown() {
            const m = els['industry-meta'].textContent.match(/^([\d,]+) of ([\d,]+) cohort trials/);
            assert.ok(m, `#industry-meta reads "${els['industry-meta'].textContent}"`);
            return parseInt(m[1].replace(/,/g, ''), 10);
        },
        // What the filters on the controls select right now.
        filtered: () => run('industryFilteredRows().length'),
        renders: () => run('industryRenders'),
        // The reader picks a value: the control's 'change' event, as a browser fires it.
        choose(id, value) {
            els[id].value = value;
            if (id.startsWith('year-')) run(`noteYearChoice(document.getElementById('${id}'))`);
            els[id].dispatchEvent({ type: 'change' });
            run('updateActiveFilters()');
        },
        chips: chipLabels,
        // The reader clicks a chip's ×.
        removeChip(label) {
            const i = chipLabels().indexOf(label);
            assert.ok(i >= 0, `no chip ${label} among ${chipLabels().join(', ')}`);
            context.__tag = tags[i];
            run('removeFilter({ closest: () => __tag }, { preventDefault() {} });');
        }
    };
}

// The most common primary condition category in the shipped data, so the
// narrowed view is never empty.
function commonPrimary() {
    const counts = new Map();
    for (const t of sponsors.trials) counts.set(t[4], (counts.get(t[4]) || 0) + 1);
    const [index] = [...counts].sort((a, b) => b[1] - a[1])[0];
    return sponsors.primaries[index];
}

test('Reset redraws the Industry view under the cleared filters', () => {
    const h = harness();
    h.run('renderIndustry()');
    const all = h.shown();
    assert.equal(all, h.filtered());
    h.choose('condition-primary', commonPrimary());
    h.choose('year-start', '2020');
    const narrowed = h.shown();
    assert.ok(narrowed > 0 && narrowed < all, `the filters did not narrow the view (${narrowed} of ${all})`);
    assert.equal(narrowed, h.filtered(), 'a change event no longer redraws the view');
    h.run('resetFilters()');
    assert.equal(h.filtered(), all, 'Reset did not clear the filters the view reads');
    assert.equal(h.shown(), all, `after Reset #industry-meta still counts ${narrowed} trials, the old filter`);
});

test("a chip's × redraws the Industry view without that filter", () => {
    const h = harness();
    h.run('renderIndustry()');
    const all = h.shown();
    const primary = commonPrimary();
    h.choose('condition-primary', primary);
    const byCondition = h.shown();
    h.choose('year-start', '2020');
    const both = h.shown();
    assert.ok(both < byCondition && byCondition < all, `the filters did not narrow the view (${both} < ${byCondition} < ${all})`);
    h.removeChip(`Years: 2020-${h.els['year-end'].value}`);
    assert.equal(h.filtered(), byCondition);
    assert.equal(h.shown(), byCondition, "after the Years chip's × #industry-meta still applies the year bound");
    h.removeChip(`Category: ${primary}`);
    assert.equal(h.filtered(), all);
    assert.equal(h.shown(), all, "after the Category chip's × #industry-meta still applies the condition");
    assert.deepEqual(h.chips(), []);
});

test('off the Industry tab, Reset and the chips leave the hidden view alone', () => {
    // Chart.js draws a hidden canvas at 0x0; the tab click redraws the view
    // (loadIndustryView) when the reader comes back to it.
    const h = harness({ active: false });
    h.choose('condition-primary', commonPrimary());
    h.removeChip(`Category: ${commonPrimary()}`);
    h.choose('year-start', '2020');
    h.run('resetFilters()');
    assert.equal(h.renders(), 0, 'the Industry view was drawn while another tab is on screen');
    assert.equal(h.run('dashboardRenders'), 2, 'Reset and the × still redraw the dashboard');
});
