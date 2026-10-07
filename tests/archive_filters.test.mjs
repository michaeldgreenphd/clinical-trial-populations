/**
 * On desktop, an aggregate archive says why its filters are off, and its
 * Filters button is greyed out.
 *
 * A summary-only archive (2026-02-22, 2026-03-29, 2026-04-26 and every
 * monthly summary the engine's retention keeps) renders from its totals and
 * applies no filters. On desktop the line above the panel said "filters are
 * a desktop feature", which is wrong on desktop, and the Filters button still
 * opened a panel whose controls changed nothing. The line now names the
 * archive as the reason and where the filters do apply; the button is
 * aria-disabled (still in the tab order, announced as dimmed, described by
 * that line) and the panel is closed until the latest data or a complete
 * snapshot is back. The phone view keeps its text and its hidden button.
 *
 * renderFilterSummary, initFilterSummary and syncFilterToggle run in a vm
 * with a stub document. The switch itself (the selector, loadData,
 * renderDashboard) is followed in archive_summary_only.test.mjs.
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
function line(start) {
    const at = app.indexOf(start);
    assert.ok(at >= 0, `app.js lost ${start}`);
    return app.slice(at, app.indexOf('\n', at) + 1);
}

const SOURCES = [
    line('const ARCHIVE_FILTERS_NOTE'),
    fnSource('function renderFilterSummary(total, unfiltered)'),
    fnSource('function initFilterSummary()'),
    fnSource('function syncFilterToggle()'),
    fnSource('function industryActive()'),
    // The Year Range helpers the Industry view filters by (yearWindowEnds).
    app.slice(app.indexOf('const YEAR_WINDOW_MIN'), app.indexOf('function initFilters()'))
].join('\n');

// What these functions read and write on an element. The title property
// reflects the title attribute, as in a browser.
function element(id) {
    const attrs = {};
    const classes = new Set();
    const e = {
        id, innerHTML: '', textContent: '', hidden: false, listeners: {}, style: {}, dataset: {},
        classList: {
            add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c)
        },
        get title() { return attrs.title || ''; },
        set title(v) { attrs.title = String(v); },
        getAttribute: (k) => (k in attrs ? attrs[k] : null),
        setAttribute: (k, v) => { attrs[k] = String(v); },
        removeAttribute: (k) => { delete attrs[k]; },
        addEventListener(type, fn) { e.listeners[type] = fn; },
        click() { if (e.listeners.click) e.listeners.click(); }
    };
    return e;
}

// The page as index.html ships it: the button closed and enabled, the panel
// hidden. `mobile` is the device the page detected.
function harness({ mobile = false, summary = null } = {}) {
    const els = {};
    const el = (id) => (els[id] ||= element(id));
    el('filter-summary-toggle').setAttribute('aria-expanded', 'false');
    el('filters').hidden = true;
    const context = vm.createContext({
        document: { getElementById: el },
        escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    });
    vm.runInContext(`const isMobileDevice = ${mobile}; let dashboardSummary = ${JSON.stringify(summary)};\n${SOURCES}`, context);
    const run = (src) => vm.runInContext(src, context);
    return { run, el, btn: el('filter-summary-toggle'), panel: el('filters'), text: () => el('filter-summary-text').innerHTML };
}

const ARCHIVE = { totalStudies: 77176 };

test('on a desktop archive the line names the archive, not the device', () => {
    const h = harness();
    h.run('dashboardSummary = ' + JSON.stringify(ARCHIVE) + '; renderFilterSummary(77176, true);');
    const text = h.text();
    assert.doesNotMatch(text, /desktop feature/, 'a desktop reader is told the filters are a desktop feature');
    assert.match(text, /^<b>77,176<\/b> trials · the full dataset, unfiltered · /);
    assert.match(text, /this archive keeps totals only/);
    assert.match(text, /filters apply to the latest data and the complete snapshots/);
    assert.doesNotMatch(text, /bi-?weekly/i, 'the engine now keeps three complete snapshots about two weeks apart');
});

test('the phone view keeps its text', () => {
    const h = harness({ mobile: true, summary: ARCHIVE });
    h.run('initFilterSummary(); renderFilterSummary(77176, true);');
    assert.equal(h.text(), '<b>77,176</b> trials · the full dataset, unfiltered · filters are a desktop feature');
});

test('the Filters button is off on an archive and back on the latest data and a complete snapshot', () => {
    const h = harness();
    h.run('initFilterSummary(); syncFilterToggle();');
    const on = (where) => {
        assert.equal(h.btn.getAttribute('aria-disabled'), null, `the button is still off ${where}`);
        assert.equal(h.btn.getAttribute('aria-describedby'), null, where);
        assert.equal(h.btn.title, '', where);
        h.btn.click();
        assert.equal(h.panel.hidden, false, `the button does not open the panel ${where}`);
        assert.equal(h.btn.getAttribute('aria-expanded'), 'true', where);
    };
    on('on the latest data');

    // An archive with the panel open: the panel closes and the button is off.
    h.run('dashboardSummary = ' + JSON.stringify(ARCHIVE) + '; syncFilterToggle();');
    assert.equal(h.btn.getAttribute('aria-disabled'), 'true', 'the button is not announced as off');
    assert.equal(h.btn.disabled, undefined, 'the disabled attribute takes the button out of the tab order');
    assert.equal(h.btn.hidden, false, 'the button is hidden rather than greyed out');
    assert.equal(h.btn.getAttribute('aria-describedby'), 'filter-summary-text', 'the reason is not tied to the button');
    assert.match(h.btn.title, /this archive keeps totals only/);
    assert.equal(h.panel.hidden, true, 'the panel stays open on an archive');
    assert.equal(h.btn.getAttribute('aria-expanded'), 'false');
    h.btn.click();
    assert.equal(h.panel.hidden, true, 'the button still opens the panel on an archive');
    assert.equal(h.btn.getAttribute('aria-expanded'), 'false');

    // Back on the latest data (no summary) …
    h.run('dashboardSummary = null; syncFilterToggle();');
    on('on the latest data after an archive');
    // … and on a complete snapshot, which is loaded from its parts and so
    // carries no summary either (loadData sets dashboardSummary = null).
    h.btn.click();   // close it again
    h.run('dashboardSummary = ' + JSON.stringify(ARCHIVE) + '; syncFilterToggle(); dashboardSummary = null; syncFilterToggle();');
    on('on a complete snapshot after an archive');
});

test('the phone view is left alone: its button stays hidden and is never marked off', () => {
    const h = harness({ mobile: true, summary: ARCHIVE });
    h.run('initFilterSummary(); syncFilterToggle();');
    assert.equal(h.btn.hidden, true);
    assert.equal(h.btn.getAttribute('aria-disabled'), null);
});

test('renderDashboard sets the button before either path draws', () => {
    const render = fnSource('function renderDashboard()');
    const sync = render.indexOf('syncFilterToggle();');
    assert.ok(sync > 0, 'renderDashboard no longer calls syncFilterToggle');
    assert.ok(sync < render.indexOf('if (dashboardSummary)'), 'the archive path draws before the button is set');
    assert.ok(sync < render.indexOf('Desktop path'), 'the desktop path draws before the button is set');
});

test('the greyed-out button keeps its focus ring and its description target exists', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.filter-summary-toggle\[aria-disabled="true"\]\s*\{[^}]*color:\s*var\(--text-secondary\)/);
    assert.match(css, /\.filter-summary-toggle:focus-visible\s*\{[^}]*outline:/);
    assert.match(html, /id="filter-summary-text"/);
    assert.match(html, /<button type="button" class="filter-summary-toggle" id="filter-summary-toggle"/);
});

// The Industry Sponsors view (Tools, beta) always draws from the latest
// data/industry_sponsors.json and honours the global Year Range and Condition
// filters (industryFilteredRows), whatever snapshot the selector shows. Its
// Filters button stays on while an archive is on screen, and goes off again
// on leaving the tab.
test('on the Industry tab the Filters button stays on while an archive is on screen', () => {
    const h = harness();
    h.run('initFilterSummary(); dashboardSummary = ' + JSON.stringify(ARCHIVE) + '; syncFilterToggle();');
    assert.equal(h.btn.getAttribute('aria-disabled'), 'true', 'off on an archive tab');

    // The Industry tab opens (initTabs / openIndustryView mark it active).
    h.el('industry').classList.add('active');
    h.run('syncFilterToggle();');
    assert.equal(h.btn.getAttribute('aria-disabled'), null, 'the Industry view still reads the filters, but its button is off');
    assert.equal(h.btn.getAttribute('aria-describedby'), null);
    assert.equal(h.btn.title, '');
    h.btn.click();
    assert.equal(h.panel.hidden, false, 'the Filters button does not open the panel on the Industry tab');
    assert.equal(h.btn.getAttribute('aria-expanded'), 'true');

    // A snapshot switch while on the Industry tab redraws (renderDashboard
    // syncs): the button stays on there.
    h.run('syncFilterToggle();');
    assert.equal(h.btn.getAttribute('aria-disabled'), null);
    assert.equal(h.panel.hidden, false);

    // Back to a tab drawn from the archive: off again, panel closed.
    h.el('industry').classList.remove('active');
    h.run('syncFilterToggle();');
    assert.equal(h.btn.getAttribute('aria-disabled'), 'true');
    assert.equal(h.panel.hidden, true);
    assert.equal(h.btn.getAttribute('aria-expanded'), 'false');
});

test('a tab switch and the /#industry route set the Filters button', () => {
    const tabs = fnSource('function initTabs()');
    const active = tabs.indexOf("document.getElementById(tab.dataset.tab).classList.add('active');");
    const sync = tabs.indexOf('syncFilterToggle();');
    assert.ok(active > 0, 'initTabs lost its activation line');
    assert.ok(sync > active, 'a tab click does not set the Filters button after the tab is active');
    const route = fnSource('async function openIndustryView()');
    const routeActive = route.indexOf("document.getElementById('industry').classList.add('active');");
    const routeSync = route.indexOf('syncFilterToggle();');
    assert.ok(routeActive > 0, 'openIndustryView lost its activation line');
    assert.ok(routeSync > routeActive, 'the /#industry route does not set the Filters button after the view is active');
});

// A phone (isMobileDevice: a phone, a window ≤768px at load, or deviceMemory
// ≤4) whose dashboard-summary.json did not load falls back to the full parts:
// its filters work on Latest, its button is shown, and its history selector
// offers the archives. On an archive it is a desktop page in all but name.
test('a phone whose summary did not load gets the desktop archive line and a greyed-out button', () => {
    const h = harness({ mobile: true, summary: null });
    h.run('initFilterSummary(); syncFilterToggle();');
    assert.equal(h.btn.hidden, false, 'the fallback phone has a Filters button on Latest');
    assert.equal(h.btn.getAttribute('aria-disabled'), null);

    h.run('dashboardSummary = ' + JSON.stringify(ARCHIVE) + '; syncFilterToggle(); renderFilterSummary(77176, true);');
    assert.equal(h.btn.getAttribute('aria-disabled'), 'true', 'the fallback phone keeps a live Filters button on an archive');
    h.btn.click();
    assert.equal(h.panel.hidden, true, 'the fallback phone opens a panel of controls that change nothing');
    assert.doesNotMatch(h.text(), /desktop feature/, 'the fallback phone is told filters are a desktop feature, though they work on Latest');
    assert.match(h.text(), /this archive keeps totals only/);

    h.run('dashboardSummary = null; syncFilterToggle();');
    assert.equal(h.btn.getAttribute('aria-disabled'), null, 'off after returning to Latest');
});

// Over an archive the Industry Sponsors view still applies the Year Range
// and the two Condition controls to the latest sponsor data
// (industryFilteredRows), so the line above the panel says that there,
// rather than "unfiltered … filters apply to the latest data". It reads the
// same controls the view reads (yearWindowEnds, condition-primary/-secondary
// values), and is redrawn wherever the button is synced: a tab click, the
// /#industry route and every renderDashboard.
const ARCHIVE_LINE = '<b>77,176</b> trials · the full dataset, unfiltered · ' +
    'this archive keeps totals only; filters apply to the latest data and the complete snapshots';
const industryLine = (years, conditions = 'all conditions') =>
    `Industry Sponsors uses the latest sponsor data · results posted <b>${years}</b> · ` +
    `${conditions} · other tabs show this archive's totals, unfiltered`;

// The Year Range as an archive ending in 2026 leaves it (syncYearWindow), and
// both Condition controls on "all".
function setControls(h, { start = '2009', end = '2026', max = '2026', primary = 'all', secondary = 'all' } = {}) {
    Object.assign(h.el('year-start'), { min: '2009', max, value: start });
    Object.assign(h.el('year-end'), { min: '2009', max, value: end });
    h.el('condition-primary').value = primary;
    h.el('condition-secondary').value = secondary;
}

test('on an archive with the Industry tab open the line says what the Industry view applies', () => {
    const h = harness();
    setControls(h);
    h.run('initFilterSummary(); dashboardSummary = ' + JSON.stringify(ARCHIVE) + ';');
    h.el('industry').classList.add('active');
    // The tab click and the route only sync the button: that redraws the line.
    h.run('syncFilterToggle();');
    assert.equal(h.text(), industryLine('2009–2026'), 'a tab switch onto Industry leaves the archive line');
    h.run('renderFilterSummary(77176, true);');
    assert.equal(h.text(), industryLine('2009–2026'));

    // The year window and both condition controls, escaped.
    setControls(h, { start: '2015', end: '2020', primary: 'Heart & <Lung>', secondary: 'Breast <Cancer> & more' });
    h.run('renderFilterSummary(77176, true);');
    assert.equal(h.text(), industryLine('2015–2020',
        'condition <b>Heart &amp; &lt;Lung&gt;</b> · subcategory <b>Breast &lt;Cancer&gt; &amp; more</b>'));
    assert.doesNotMatch(h.text(), /\d+,\d+<\/b> trials/, 'the archive total is not the Industry count');
});

test('the Industry line names the years the Industry view filters by', () => {
    const h = harness();
    setControls(h, { start: '2012', end: '2026' });
    h.run('dashboardSummary = ' + JSON.stringify(ARCHIVE) + ';');
    h.el('industry').classList.add('active');
    h.run('renderFilterSummary(77176, true);');
    const ends = JSON.parse(h.run('JSON.stringify(yearWindowEnds())'));
    assert.equal(ends.start, 2012);
    assert.match(h.text(), /results posted <b>2012–2026<\/b>/);
    // An end thumb below the window's end is a bound the view applies.
    setControls(h, { start: '2012', end: '2019' });
    h.run('renderFilterSummary(77176, true);');
    assert.equal(JSON.parse(h.run('JSON.stringify(yearWindowEnds())')).end, 2019);
    assert.match(h.text(), /results posted <b>2012–2019<\/b>/);
});

test('an empty Condition control reads as all conditions, as the Industry view reads it', () => {
    const h = harness();
    setControls(h, { primary: '', secondary: '' });
    h.run('dashboardSummary = ' + JSON.stringify(ARCHIVE) + ';');
    h.el('industry').classList.add('active');
    h.run('renderFilterSummary(77176, true);');
    assert.equal(h.text(), industryLine('2009–2026'));
});

// The change handlers initFilters attaches call renderDashboard, whose
// summary path draws the line; the real functions run here.
const DASHBOARD_STUBS = `
function populateConditionsDropdown() {} function populateCountriesDropdown() {}
function populateSecondaryConditionDropdown() {} function updateActiveFilters() {} function updateShareUrl() {}
function resetFilters() {} function getFilteredData() { return []; }
function showDashboardSpinner() {} function hideDashboardSpinner() {} function requestAnimationFrame(f) { f(); }
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
let data = [];
`;
const ARCHIVE_YEARS = { totalStudies: 77176, cards: { raceCount: 1, ethCount: 1, bothCount: 1 },
    byYear: { 2009: {}, 2026: {} } };

test('moving the year on the Industry tab over an archive redraws the Industry line', () => {
    const h = harness();
    setControls(h);
    h.run(DASHBOARD_STUBS + fnSource('function renderDashboard()') + '\n' + fnSource('function initFilters()'));
    h.run('document.querySelector = () => null; initFilterSummary(); initFilters();');
    h.run('dashboardSummary = ' + JSON.stringify(ARCHIVE_YEARS) + '; renderDashboard();');
    assert.equal(h.text(), ARCHIVE_LINE, 'an archive tab shows the archive line');

    h.el('industry').classList.add('active');
    h.run('syncFilterToggle();');
    assert.equal(h.text(), industryLine('2009–2026'));

    const ys = h.el('year-start');
    ys.value = '2015';
    ys.listeners.input({ target: ys });
    ys.listeners.change();
    assert.equal(h.text(), industryLine('2015–2026'), 'the year change left the old window on the line');

    const cp = h.el('condition-primary');
    cp.value = 'Oncology';
    cp.listeners.change();
    assert.equal(h.text(), industryLine('2015–2026', 'condition <b>Oncology</b>'));
});

test('leaving the Industry tab over an archive puts the archive line back', () => {
    const h = harness();
    setControls(h, { start: '2015' });
    h.run('initFilterSummary(); dashboardSummary = ' + JSON.stringify(ARCHIVE) + ';');
    h.el('industry').classList.add('active');
    h.run('syncFilterToggle();');
    assert.equal(h.text(), industryLine('2015–2026'));
    h.el('industry').classList.remove('active');
    h.run('syncFilterToggle();');
    assert.equal(h.text(), ARCHIVE_LINE, 'the Industry line stays on an archive tab');
    assert.equal(h.btn.getAttribute('aria-disabled'), 'true');
});

test('on the latest data the Industry tab keeps today’s line', () => {
    const h = harness();
    setControls(h);
    h.run('initFilterSummary();');
    h.el('industry').classList.add('active');
    h.run('renderFilterSummary(1234);');
    const latest = '<b>1,234</b> trials · results posted <b>2009–2026</b> · all sponsors, purposes and conditions';
    assert.equal(h.text(), latest);
    h.run('syncFilterToggle();');
    assert.equal(h.text(), latest, 'a tab switch on the latest data rewrote the line');
});

test('the phone summary view keeps its line on the Industry tab', () => {
    const h = harness({ mobile: true, summary: ARCHIVE });
    setControls(h);
    h.run('initFilterSummary();');
    h.el('industry').classList.add('active');
    h.run('renderFilterSummary(77176, true); syncFilterToggle();');
    assert.equal(h.text(), '<b>77,176</b> trials · the full dataset, unfiltered · filters are a desktop feature');
});
