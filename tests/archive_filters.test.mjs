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
    fnSource('function renderUnfilteredFilterSummary(el, total)'),
    fnSource('function initFilterSummary()'),
    fnSource('function syncFilterToggle()'),
    line('const NO_FILTER_TABS'),
    fnSource('function showFilterChrome(tabId)'),
    fnSource('function redrawArchiveSummary()'),
    fnSource('function industryActive()'),
    // The Industry sub-view (heatmap, trend or forest) the line describes.
    line("let industryView = 'heatmap';"),
    // The sponsor data, null until the Industry view loads it: an open end of
    // the Year Range names its newest results year (industryNewestResultsYear).
    line('let industryData = null;'),
    // Whether its last load failed: the line and the button say so.
    line('let industryLoadFailed = false;'),
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
        URLSearchParams,   // a Node global, not part of a bare vm context
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
    // Both go through showFilterChrome, which ends in syncFilterToggle.
    assert.match(fnSource('function showFilterChrome(tabId)'), /syncFilterToggle\(\);\n\}$/);
    const sync = tabs.indexOf('showFilterChrome(tab.dataset.tab);');
    assert.ok(active > 0, 'initTabs lost its activation line');
    assert.ok(sync > active, 'a tab click does not set the Filters button after the tab is active');
    const route = fnSource('async function openIndustryView()');
    const routeActive = route.indexOf("document.getElementById('industry').classList.add('active');");
    const routeSync = route.indexOf("showFilterChrome('industry');");
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
// years is a range, '2009–2027', or an open end, 'from 2009'.
const industryLine = (years, conditions = 'all conditions') =>
    `the latest sponsor data · results posted ${years.startsWith('from ')
        ? `from <b>${years.slice(5)}</b>` : `<b>${years}</b>`} · ` +
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
    assert.equal(h.text(), industryLine('from 2009'), 'a tab switch onto Industry leaves the archive line');
    h.run('renderFilterSummary(77176, true);');
    assert.equal(h.text(), industryLine('from 2009'));

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
    // Before the sponsor data loads, an open end is said in words; once it
    // loads, the line names the newest results year in it.
    assert.match(h.text(), /results posted from <b>2012<\/b>/);
    h.run('industryData = { trials: [[0, 0, 2026], [0, 0, 2013]] }; renderFilterSummary(77176, true);');
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
    assert.equal(h.text(), industryLine('from 2009'));
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
function renderFdaOversight() {} function refreshStudiesTab() {} function renderIndustry() {}
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
    assert.equal(h.text(), industryLine('from 2009'));

    const ys = h.el('year-start');
    ys.value = '2015';
    ys.listeners.input({ target: ys });
    ys.listeners.change();
    assert.equal(h.text(), industryLine('from 2015'), 'the year change left the old window on the line');

    const cp = h.el('condition-primary');
    cp.value = 'Oncology';
    cp.listeners.change();
    assert.equal(h.text(), industryLine('from 2015', 'condition <b>Oncology</b>'));
});

test('leaving the Industry tab over an archive puts the archive line back', () => {
    const h = harness();
    setControls(h, { start: '2015' });
    h.run('initFilterSummary(); dashboardSummary = ' + JSON.stringify(ARCHIVE) + ';');
    h.el('industry').classList.add('active');
    h.run('syncFilterToggle();');
    assert.equal(h.text(), industryLine('from 2015'));
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

// index.html puts a fixed "Showing" label in front of the line on every tab,
// so each line opens with what is shown: a count of trials or a noun phrase
// starting "the". A clause there ("Showing Industry Sponsors uses …") reads
// as a garden-path sentence.
test('every line completes the Showing label in front of it', () => {
    assert.match(html, /<span class="filter-summary-label">Showing<\/span>\s*<span class="filter-summary-text" id="filter-summary-text">/,
        'the label the lines are written to follow moved or changed');
    const opens = (text) => assert.match(text, /^(<b>[\d,]+<\/b> trials|the )/,
        `"Showing ${text.split(' · ')[0]}" does not read as a phrase`);
    const lines = [];
    const h = harness();
    setControls(h, { start: '2015', primary: 'Oncology' });
    h.run('initFilterSummary(); dashboardSummary = ' + JSON.stringify(ARCHIVE) + ';');
    h.run('renderFilterSummary(77176, true);'); lines.push(h.text());
    h.el('industry').classList.add('active');
    h.run('syncFilterToggle();'); lines.push(h.text());
    h.run('dashboardSummary = null; renderFilterSummary(1234);'); lines.push(h.text());
    const p = harness({ mobile: true, summary: ARCHIVE });
    p.run('initFilterSummary(); renderFilterSummary(77176, true);'); lines.push(p.text());
    lines.forEach(opens);
    assert.equal(lines[1], industryLine('from 2015', 'condition <b>Oncology</b>'));
});

// Not every Industry sub-view applies the Year Range and Condition controls.
// The heatmap and the trend draw industryFilteredRows(); the Adjusted
// Differences view (forest) draws the engine's model estimates, fitted once
// over the whole cohort, and its footnote says they do not respond to the
// year/condition filters. Over an archive the line says what the visible
// sub-view applies, and is redrawn when the sub-view changes.
const forestLine = 'the latest sponsor data · adjusted estimates over all years and conditions · ' +
    "other tabs show this archive's totals, unfiltered";

function industryArchive(h, view, controls = {}) {
    setControls(h, controls);
    h.run('initFilterSummary(); dashboardSummary = ' + JSON.stringify(ARCHIVE) + `; industryView = '${view}';`);
    h.el('industry').classList.add('active');
}

test('the forest view’s line claims no year or condition narrowing and stays put when they change', () => {
    // What the forest view itself says about the filters.
    assert.match(fnSource('function renderIndustryForest()'),
        /respond to the Role toggle but not to the year\/condition filters/,
        'the forest footnote changed: re-read what the line should say');
    assert.doesNotMatch(fnSource('function renderIndustryForest()'), /industryFilteredRows|yearWindowEnds|condition-primary/,
        'the forest view now reads the filters: its line should name them');

    const h = harness();
    industryArchive(h, 'forest');
    h.run('syncFilterToggle();');
    assert.equal(h.text(), forestLine);
    assert.doesNotMatch(h.text(), /results posted|condition <b>|subcategory/);

    setControls(h, { start: '2015', end: '2020', primary: 'Oncology', secondary: 'Breast Cancer' });
    h.run('renderFilterSummary(77176, true);');
    assert.equal(h.text(), forestLine, 'the year or condition change rewrote the forest line');
});

test('the forest line holds when the year moves through the real change handlers', () => {
    const h = harness();
    setControls(h);
    h.run(DASHBOARD_STUBS + fnSource('function renderDashboard()') + '\n' + fnSource('function initFilters()'));
    h.run('document.querySelector = () => null; initFilterSummary(); initFilters();');
    h.run('dashboardSummary = ' + JSON.stringify(ARCHIVE_YEARS) + "; industryView = 'forest'; renderDashboard();");
    h.el('industry').classList.add('active');
    h.run('syncFilterToggle();');
    assert.equal(h.text(), forestLine);
    const ys = h.el('year-start');
    ys.value = '2015';
    ys.listeners.input({ target: ys });
    ys.listeners.change();
    assert.equal(h.text(), forestLine, 'moving the start year rewrote the forest line');
    const cp = h.el('condition-primary');
    cp.value = 'Oncology';
    cp.listeners.change();
    assert.equal(h.text(), forestLine);
});

// The trend draws the same industryFilteredRows() as the heatmap, and says
// so ("Respects the global Year Range (results posted) and Condition
// filters"). The Industry column controls it hides are presentation for the
// heatmap, never a filter, and the line never named them.
test('the trend view’s line names the years and conditions its rows honour', () => {
    const trend = fnSource('function renderIndustryTrend(rows)');
    assert.match(trend, /Respects the global Year Range \(results posted\) and Condition filters/);
    const render = fnSource('function renderIndustry()');
    assert.match(render, /const rows = industryFilteredRows\(\);/);
    assert.match(render, /else if \(industryView === 'trend'\) renderIndustryTrend\(rows\);/);

    // industryFilteredRows applies the year and both conditions whatever the
    // sub-view, and not the column picker.
    const h = harness();
    h.run(`let industryRole = 'any', industryDemo = 'sex', industryConditionSelected = new Set(['Nothing']);
        function industryTrialValue() { return 50; }
        industryData = { primaries: ['Oncology', 'Cardiology'], secondaries: ['Breast', 'Heart'],
            trials: [[0, 0, 2012, 2011, 0, 0], [0, 0, 2018, 2017, 0, 0], [0, 0, 2018, 2017, 1, 1]] };
        ${fnSource('function industryFilteredRows()')}`);
    industryArchive(h, 'trend', { start: '2015' });
    assert.equal(h.run('industryFilteredRows().length'), 2, 'the trend rows ignore the start year');
    setControls(h, { start: '2015', primary: 'Oncology' });
    assert.equal(h.run('industryFilteredRows().length'), 1, 'the trend rows ignore the condition');
    setControls(h, { start: '2015', primary: 'Oncology', secondary: 'Heart' });
    assert.equal(h.run('industryFilteredRows().length'), 0, 'the trend rows ignore the subcategory');

    setControls(h, { start: '2015', end: '2020', primary: 'Oncology', secondary: 'Breast' });
    h.run('renderFilterSummary(77176, true);');
    assert.equal(h.text(), industryLine('2015–2020', 'condition <b>Oncology</b> · subcategory <b>Breast</b>'));
});

// An open end (the end thumb at the window's end, no bound asked for) is no
// upper bound: yearWindowEnds() returns Infinity and industryFilteredRows()
// keeps sponsor trials posted after the archive's last year, as after a
// calendar-year rollover. syncYearWindow() clamps that thumb to the
// archive's last year, so the line names the end the Industry view reaches:
// the newest results year in the sponsor data, or, before that data loads,
// the open end in words. A finite end keeps the thumb's year.
const SPONSOR_ROWS = `let industryRole = 'any', industryDemo = 'sex';
    function industryTrialValue() { return 50; }
    ${fnSource('function industryFilteredRows()')}`;
const sponsorData = (years) => JSON.stringify({ primaries: ['Oncology'], secondaries: ['Breast'],
    trials: years.map(y => [0, 0, y, 2011, 0, 0]) });
// The same rows as a whole file, as loadIndustryView checks a fetched one
// (industryDataProblem): today's format, every key the view reads.
const sponsorPayload = (years) => JSON.stringify({ ...JSON.parse(sponsorData(years)),
    source_extracted_at: '2026-10-04T12:09:21+00:00', cohort_n: years.length, min_cell: 10,
    companies: ['Pfizer'], company_n: [years.length], top_n: 10, contrasts: [], pooled: { n: years.length, r2: 0.1 } });
const rowYears = (h) => JSON.parse(h.run('JSON.stringify(industryFilteredRows().map(t => t[2]))'));

test('an open end names the newest results year the Industry view includes, not the clamped thumb', () => {
    const h = harness();
    h.run(SPONSOR_ROWS);
    industryArchive(h, 'heatmap');   // an archive window ending 2026, the end thumb at its end
    h.run(`industryData = ${sponsorData([2012, 2027, null, 0, 2026])};`);
    h.run('syncFilterToggle();');
    assert.equal(h.run('yearWindowEnds().end'), Infinity);
    assert.deepEqual(rowYears(h), [2012, 2027, null, 0, 2026], 'the view leaves out the 2027 trial');
    assert.equal(h.text(), industryLine('2009–2027'));
    assert.doesNotMatch(h.text(), /2009–2026/, 'the line names the clamped thumb');

    // The trend draws the same rows and says the same.
    h.run("industryView = 'trend'; redrawArchiveSummary();");
    assert.equal(h.text(), industryLine('2009–2027'));
    // A start thumb is a bound and keeps its year.
    setControls(h, { start: '2015', primary: 'Oncology' });
    h.run('renderFilterSummary(77176, true);');
    assert.equal(h.text(), industryLine('2015–2027', 'condition <b>Oncology</b>'));
    assert.deepEqual(rowYears(h), [2027, null, 0, 2026]);
    // The forest line names no years.
    h.run("industryView = 'forest'; redrawArchiveSummary();");
    assert.equal(h.text(), forestLine);
});

test('an end thumb below the window’s end, or a recorded end at it, keeps the thumb’s year', () => {
    const h = harness();
    h.run(SPONSOR_ROWS);
    industryArchive(h, 'heatmap', { end: '2020' });
    h.run(`industryData = ${sponsorData([2012, 2027, null, 2026])};`);
    h.run('syncFilterToggle();');
    assert.equal(h.run('yearWindowEnds().end'), 2020);
    assert.equal(h.text(), industryLine('2009–2020'));
    assert.deepEqual(rowYears(h), [2012, null]);
    h.run("industryView = 'trend'; redrawArchiveSummary();");
    assert.equal(h.text(), industryLine('2009–2020'));

    // A shared link's end=2026 is recorded: a bound at the window's last year.
    setControls(h);
    h.el('year-end').dataset.chosen = '2026';
    h.run('renderFilterSummary(77176, true);');
    assert.equal(h.text(), industryLine('2009–2026'));
    assert.deepEqual(rowYears(h), [2012, null, 2026]);
});

test('before the sponsor data loads, an open end is said in words, never as the clamped year', () => {
    const h = harness();
    industryArchive(h, 'heatmap');
    h.run('syncFilterToggle();');
    assert.equal(h.text(), industryLine('from 2009'));
    assert.doesNotMatch(h.text(), /2026/, 'the line names the clamped thumb');
    h.run("industryView = 'trend'; redrawArchiveSummary();");
    assert.equal(h.text(), industryLine('from 2009'));
    setControls(h, { start: '2015' });
    h.run('renderFilterSummary(77176, true);');
    assert.equal(h.text(), industryLine('from 2015'));

    // The load redraws the line (loadIndustryView, after it sets industryData).
    // syncFilterToggle() redraws it, and sets the button a failed load turned off.
    assert.match(fnSource('async function loadIndustryView()'),
        /industryData = parsed;[\s\S]*?syncFilterToggle\(\);/);
    h.run(`industryData = ${sponsorData([2012, 2027])}; redrawArchiveSummary();`);
    assert.equal(h.text(), industryLine('2015–2027'));
    // Each load names its own newest year.
    h.run(`industryData = ${sponsorData([2028, 2012])}; redrawArchiveSummary();`);
    assert.equal(h.text(), industryLine('2015–2028'));
    // No results year, or none at or after the start: no end to name.
    h.run(`industryData = ${sponsorData([null, 0])}; redrawArchiveSummary();`);
    assert.equal(h.text(), industryLine('from 2015'));
    h.run(`industryData = ${sponsorData([2012, 2014])}; redrawArchiveSummary();`);
    assert.equal(h.text(), industryLine('from 2015'));
});

test('the latest data keeps its line on the Industry tab whatever the sponsor data reaches', () => {
    const h = harness();
    setControls(h);
    h.run('initFilterSummary();');
    h.el('industry').classList.add('active');
    h.run(`industryData = ${sponsorData([2012, 2027])};`);
    h.run('renderFilterSummary(1234); syncFilterToggle();');
    assert.equal(h.text(), '<b>1,234</b> trials · results posted <b>2009–2026</b> · all sponsors, purposes and conditions');
});

// The View switcher's click handler, as app.js attaches it.
function viewSwitcher(h) {
    const start = app.indexOf('    // View switcher.');
    const end = app.indexOf('    // Demographic tier tabs');
    assert.ok(start > 0 && end > start, 'app.js lost the Industry view switcher');
    h.run(`let industryRenders = 0; function renderIndustry() { industryRenders++; }
        const viewBtns = ['heatmap', 'trend', 'forest'].map(v => {
            const b = document.getElementById('iview-' + v); b.dataset.iview = v; return b; });
        document.querySelectorAll = (s) => s === '#industry-view-toggle .view-btn' ? viewBtns : [];
        ${app.slice(start, end)}`);
    return (v) => h.el('iview-' + v).click();
}

test('switching heatmap → forest → heatmap over an archive redraws the line each time', () => {
    const h = harness();
    industryArchive(h, 'heatmap', { start: '2015' });
    const click = viewSwitcher(h);
    h.run('syncFilterToggle();');
    assert.equal(h.text(), industryLine('from 2015'));
    click('forest');
    assert.equal(h.run('industryView'), 'forest');
    assert.equal(h.text(), forestLine, 'the switch to Adjusted Differences left the year claim on the line');
    click('trend');
    assert.equal(h.text(), industryLine('from 2015'), 'the switch to the trend left the forest line');
    click('forest');
    assert.equal(h.text(), forestLine);
    click('heatmap');
    assert.equal(h.text(), industryLine('from 2015'), 'the switch back to the heatmap left the forest line');
    assert.equal(h.run('industryRenders'), 4);
});

test('a sub-view switch on the latest data and in the phone view leaves their lines alone', () => {
    const h = harness();
    setControls(h, { start: '2015' });
    h.run('initFilterSummary();');
    h.el('industry').classList.add('active');
    const click = viewSwitcher(h);
    h.run('renderFilterSummary(1234);');
    const latest = '<b>1,234</b> trials · results posted <b>2015–2026</b> · all sponsors, purposes and conditions';
    assert.equal(h.text(), latest);
    click('forest');
    assert.equal(h.text(), latest, 'a switch on the latest data rewrote the line');
    h.run('renderFilterSummary(1234);');
    assert.equal(h.text(), latest, 'the latest data line depends on the sub-view');
    click('heatmap');
    assert.equal(h.text(), latest);

    const p = harness({ mobile: true, summary: ARCHIVE });
    setControls(p);
    p.run('initFilterSummary(); renderFilterSummary(77176, true);');
    p.el('industry').classList.add('active');
    const pclick = viewSwitcher(p);
    const phone = '<b>77,176</b> trials · the full dataset, unfiltered · filters are a desktop feature';
    pclick('forest');
    assert.equal(p.text(), phone);
    pclick('heatmap');
    assert.equal(p.text(), phone);
});

test('off the Industry tab an archive keeps its line whatever the sub-view', () => {
    const h = harness();
    setControls(h);
    h.run('initFilterSummary(); dashboardSummary = ' + JSON.stringify(ARCHIVE) + "; industryView = 'forest';");
    h.run('syncFilterToggle();');
    assert.equal(h.text(), ARCHIVE_LINE);
    h.run("industryView = 'trend'; renderFilterSummary(77176, true);");
    assert.equal(h.text(), ARCHIVE_LINE);
});

// /#industry?view=forest: openIndustryView syncs the button (and draws the
// line) before the dataset loads and the route sets the sub-view, so the
// load redraws it once the route is applied.
test('the ?view=forest route over an archive draws the forest line', async () => {
    const h = harness();
    industryArchive(h, 'heatmap', { start: '2015' });
    h.run('syncFilterToggle();');
    assert.equal(h.text(), industryLine('from 2015'), 'what openIndustryView draws before the load');
    h.run(`const location = { hash: '#industry?view=forest' };
        let industryDemo = 'sex', industryCat = {}, industryBenchmark = 'cohort', industryRole = 'any',
            industryScope = 'top10', industrySexSpecific = false, industryConditionMode = 'top',
            industryConditionSelected = new Set(), industrySelected = null;
        const INDUSTRY_CAT_LABELS = {}, INDUSTRY_SUBTITLES = {};
        document.querySelectorAll = () => [];
        function industryTop10() { return []; } function renderIndustryCatRow() {}
        function renderIndustrySponsorMenu() {} function updateIndustryShareUrl() {}
        function renderIndustry() {}
        async function fetchChecked() {
            return { ok: true, json: async () => (${sponsorPayload([2012])}) };
        }
        ${fnSource('function industryDataProblem(d)')}
        ${line('let industryRouteApplied = false;')}
        ${fnSource('function applyIndustryShareParams()')}
        ${fnSource('async function loadIndustryView()')}`);
    await h.run('loadIndustryView()');
    assert.equal(h.run('industryView'), 'forest');
    assert.equal(h.text(), forestLine, 'the ?view=forest route left the heatmap line');
});

// /#industry reached after a tab with no filters. Geography, FAQ, About and
// the other NO_FILTER_TABS set both #filters and #filter-summary to
// display: none; a tab click onto any other tab shows them again. The hash
// route (openIndustryView) must do the same, archive or not, or the Industry
// view's Year Range and Condition controls, and the line saying it applies
// them, stay invisible though its Filters button is on. The real initTabs and
// openIndustryView run here, over four tabs, with the real closeNavGroups a
// tab click calls first (no nav menus on this page: it closes none).
const TABS_PAGE = `
const TAB_IDS = ['overview', 'geography', 'faq', 'industry'];
document.querySelectorAll = (sel) => sel === '.tab'
    ? TAB_IDS.map(id => { const t = document.getElementById('tab-' + id); t.dataset.tab = id; return t; })
    : sel === '.tab-content' ? TAB_IDS.map(id => document.getElementById(id)) : [];
document.querySelector = (sel) => {
    const m = /data-tab="([^"]+)"/.exec(sel);
    return m ? document.getElementById('tab-' + m[1]) : null;
};
document.addEventListener = () => {};
const history = { replaceState() {} };
const location = { pathname: '/', search: '', hash: '#industry' };
let data = [];
function getFilteredData() { return []; }
async function promptForBetaAccess() { return true; }
async function loadIndustryView() {}
function renderGeographyDashboard() {} function updateShareUrl() {} function labelChartsForA11y() {}
`;
function tabsHarness(opts) {
    const h = harness(opts);
    setControls(h);
    h.run(TABS_PAGE + fnSource('function closeNavGroups(except)') + '\n' + fnSource('function initTabs()') + '\n'
        + fnSource('async function openIndustryView()'));
    h.run('initFilterSummary(); initTabs();');
    const shown = (id) => h.el(id).style.display !== 'none';
    return {
        ...h,
        clickTab: (id) => h.el('tab-' + id).listeners.click(),
        route: () => h.run('openIndustryView()'),
        filtersShown: () => shown('filters'),
        summaryShown: () => shown('filter-summary')
    };
}

for (const from of ['faq', 'geography']) {
    test(`over an archive, /#industry after the ${from} tab shows the filters and the Industry line`, async () => {
        const h = tabsHarness();
        h.run('dashboardSummary = ' + JSON.stringify(ARCHIVE) + ';');
        await h.clickTab('overview');
        h.run('renderFilterSummary(77176, true);');
        assert.equal(h.text(), ARCHIVE_LINE);
        await h.clickTab(from);
        assert.equal(h.filtersShown(), false, `the ${from} tab shows the filters`);
        assert.equal(h.summaryShown(), false, `the ${from} tab shows the filter line`);

        await h.route();
        assert.equal(h.el('industry').classList.contains('active'), true);
        assert.equal(h.summaryShown(), true, 'the /#industry route leaves the filter line hidden');
        assert.equal(h.filtersShown(), true, 'the /#industry route leaves the filters hidden');
        assert.equal(h.text(), industryLine('from 2009'));
        assert.equal(h.btn.getAttribute('aria-disabled'), null, 'the Filters button is off on the Industry view');
        assert.equal(h.panel.hidden, true, 'the route opened the panel by itself');
        h.btn.click();
        assert.equal(h.panel.hidden, false, 'the Filters button does not open the panel');
    });
}

test('on the latest data, /#industry after FAQ shows the filters and keeps the panel as it was', async () => {
    const h = tabsHarness();
    await h.clickTab('overview');
    h.btn.click();
    assert.equal(h.panel.hidden, false);
    await h.clickTab('faq');
    assert.equal(h.filtersShown(), false);
    assert.equal(h.summaryShown(), false);
    assert.equal(h.panel.hidden, false, 'a tab with no filters collapsed the panel');

    await h.route();
    assert.equal(h.summaryShown(), true, 'the /#industry route leaves the filter line hidden');
    assert.equal(h.filtersShown(), true, 'the /#industry route leaves the filters hidden');
    assert.equal(h.panel.hidden, false, 'the route collapsed the open panel');
    assert.equal(h.btn.getAttribute('aria-disabled'), null);

    // Collapsed before FAQ: collapsed after the route.
    h.btn.click();
    assert.equal(h.panel.hidden, true);
    await h.clickTab('faq');
    await h.route();
    assert.equal(h.filtersShown(), true);
    assert.equal(h.panel.hidden, true, 'the route expanded the collapsed panel');
});

test('the /#industry route shows and hides what a click on the Industry tab does', async () => {
    for (const opts of [{}, { summary: ARCHIVE }, { mobile: true, summary: ARCHIVE }]) {
        const viaTab = tabsHarness(opts);
        await viaTab.clickTab('faq');
        await viaTab.clickTab('industry');
        const viaRoute = tabsHarness(opts);
        await viaRoute.clickTab('faq');
        await viaRoute.route();
        const state = (h) => ({
            filters: h.filtersShown(), summary: h.summaryShown(), panelHidden: h.panel.hidden,
            btnHidden: h.btn.hidden, disabled: h.btn.getAttribute('aria-disabled'), text: h.text()
        });
        assert.deepEqual(state(viaRoute), state(viaTab), `route and tab click differ for ${JSON.stringify(opts)}`);
    }
});

test('the phone summary view: /#industry after FAQ keeps the Filters button hidden and the panel closed', async () => {
    const h = tabsHarness({ mobile: true, summary: ARCHIVE });
    assert.equal(h.btn.hidden, true);
    h.run('renderFilterSummary(77176, true);');
    await h.clickTab('faq');
    assert.equal(h.summaryShown(), false);
    await h.route();
    assert.equal(h.summaryShown(), true, 'the phone keeps the line hidden on Industry, unlike a tab click');
    assert.equal(h.btn.hidden, true, 'the phone summary view shows a Filters button');
    assert.equal(h.btn.getAttribute('aria-disabled'), null);
    assert.equal(h.panel.hidden, true, 'the phone summary view opened the panel');
    assert.equal(h.text(), '<b>77,176</b> trials · the full dataset, unfiltered · filters are a desktop feature');
});

// Changing the primary condition with a subcategory set. The Industry view
// registers its change listeners at DOMContentLoaded, before the data loads
// and initFilters() adds its own, so on #condition-primary the Industry
// listener ran first and drew the chart from the new condition and the old
// subcategory; initFilters' handler then reset the subcategory to all
// (populateSecondaryConditionDropdown) and redrew the line from the reset
// controls, and nothing redrew the Industry view. The chart and its count
// kept a subcategory the controls no longer showed, often matching no rows.
// The Industry listener now resets the subcategory itself before it draws.
// Both listeners run here, in page order (and reversed, and the Industry
// listener alone, as tests/industry_filter_reset.test.mjs builds it), over a
// select that resets its value when its options are replaced, as a
// browser's does.
const ONTOLOGY = { Oncology: { Breast: {}, Lung: {} }, Cardiology: { Heart: {} } };
const CONDITION_ROWS = JSON.stringify({ primaries: ['Oncology', 'Cardiology'], secondaries: ['Breast', 'Lung', 'Heart'],
    trials: [[0, 0, 2015, 2011, 0, 0], [0, 0, 2016, 2011, 0, 1], [0, 0, 2017, 2011, 1, 2], [0, 0, 2018, 2011, 1, 2]] });
function industryListeners() {
    const start = app.indexOf('    // Re-render under the global filters this view honors.');
    const end = app.indexOf('    // Leaving via the nav clears the hash');
    assert.ok(start > 0 && end > start, 'app.js lost the Industry view’s filter listeners');
    return app.slice(start, end);
}
function conditionHarness({ archive, order = 'page' }) {
    const h = harness();
    setControls(h);
    // Every listener a control gets, in the order they were added.
    for (const id of ['year-start', 'year-end', 'condition-primary', 'condition-secondary']) {
        const e = h.el(id);
        e.addEventListener = (type, fn) => {
            const prev = e.listeners[type];
            e.listeners[type] = prev ? (...a) => { prev(...a); fn(...a); } : fn;
        };
    }
    let secValue = 'all';
    Object.defineProperty(h.el('condition-secondary'), 'innerHTML', {
        get: () => '', set: () => { secValue = 'all'; }
    });
    Object.defineProperty(h.el('condition-secondary'), 'value', {
        get: () => secValue, set: (v) => { secValue = String(v); }
    });
    h.run(DASHBOARD_STUBS.replace('function populateSecondaryConditionDropdown() {} ', '') +
        `const CONDITION_ONTOLOGY = ${JSON.stringify(ONTOLOGY)};
        document.createElement = () => ({}); document.getElementById('condition-secondary').appendChild = () => {};
        ${fnSource('function populateSecondaryConditionDropdown(selectedPrimary)')}
        ${SPONSOR_ROWS}
        const industryRenders = [];
        function renderIndustry() {
            if (!industryData) return;
            industryRenders.push({ pri: document.getElementById('condition-primary').value,
                sec: document.getElementById('condition-secondary').value, rows: industryFilteredRows().length });
        }
        ${fnSource('function renderDashboard()')}
        ${fnSource('function initFilters()')}`);
    // DOMContentLoaded: the Industry view's listeners; then the load: initFilters.
    const wiring = { page: `${industryListeners()}\ninitFilters();`,
        reversed: `initFilters();\n${industryListeners()}`,
        industryOnly: industryListeners() }[order];
    h.run(`document.querySelector = () => null; initFilterSummary();
        ${wiring}`);
    h.run(`industryData = ${CONDITION_ROWS};`);
    if (archive) h.run('dashboardSummary = ' + JSON.stringify(ARCHIVE_YEARS) + ';');
    h.el('industry').classList.add('active');
    const pick = (id, v) => { h.el(id).value = v; h.el(id).listeners.change(); };
    const renders = () => JSON.parse(h.run('JSON.stringify(industryRenders.splice(0))'));
    return { ...h, pick, renders };
}

for (const archive of [true, false]) {
    test(`a new primary condition redraws Industry once, without the old subcategory (${archive ? 'archive' : 'latest data'})`, () => {
        const h = conditionHarness({ archive });
        h.pick('condition-primary', 'Oncology');
        h.pick('condition-secondary', 'Breast');
        assert.deepEqual(h.renders().at(-1), { pri: 'Oncology', sec: 'Breast', rows: 1 });
        if (archive) assert.equal(h.text(), industryLine('2009–2018', 'condition <b>Oncology</b> · subcategory <b>Breast</b>'));

        h.pick('condition-primary', 'Cardiology');
        assert.equal(h.el('condition-secondary').value, 'all', 'the subcategory survived a new primary');
        const renders = h.renders();
        assert.equal(renders.length, 1, `Industry drew ${renders.length} times for one change`);
        assert.deepEqual(renders[0], { pri: 'Cardiology', sec: 'all', rows: 2 },
            'Industry drew the new condition with the old subcategory');
        assert.equal(h.run('industryFilteredRows().length'), renders[0].rows);
        if (archive) assert.equal(h.text(), industryLine('2009–2018', 'condition <b>Cardiology</b>'));
        else assert.match(h.text(), /condition <b>Cardiology<\/b>$/);

        // Back to all: one draw, both controls at all.
        h.pick('condition-primary', 'all');
        assert.deepEqual(h.renders(), [{ pri: 'all', sec: 'all', rows: 4 }]);
        // The other controls the view honours still redraw it once.
        h.pick('condition-primary', 'Oncology');
        h.renders();
        h.pick('condition-secondary', 'Lung');
        assert.deepEqual(h.renders(), [{ pri: 'Oncology', sec: 'Lung', rows: 1 }]);
        h.pick('year-start', '2016');
        assert.equal(h.renders().length, 1);
    });
}

test('off the Industry tab a primary-condition change draws no Industry view', () => {
    const h = conditionHarness({ archive: true });
    h.el('industry').classList.remove('active');
    h.pick('condition-primary', 'Oncology');
    assert.deepEqual(h.renders(), []);
});

// The sponsor data failing to load over an archive (an HTTP error or a body
// that is not JSON). loadIndustryView() leaves industryData null and puts an
// error in the view; the line said "the latest sponsor data · results posted
// …" and the Filters button stayed on, though no sponsor data was loaded and
// the controls changed nothing. Three states now: loading (no data, no
// failure yet: the line as before), loaded, and failed: a line that says the
// sponsor data did not load and a greyed-out button that says why, until a
// load succeeds.
const FAILED_LINE = 'the Industry view without its sponsor data, which did not load · ' +
    "other tabs show this archive's totals, unfiltered";
function loadHarness({ archive = true, view = 'heatmap' } = {}) {
    const h = harness();
    if (archive) industryArchive(h, view, { start: '2015' });
    else {
        setControls(h, { start: '2015' });
        h.run(`initFilterSummary(); industryView = '${view}';`);
        h.el('industry').classList.add('active');
    }
    h.run(`const location = { hash: '#industry' };
        let industryDemo = 'sex', industryCat = {}, industryBenchmark = 'cohort', industryRole = 'any',
            industryScope = 'top10', industrySexSpecific = false, industryConditionMode = 'top',
            industryConditionSelected = new Set(), industrySelected = null;
        const INDUSTRY_CAT_LABELS = {}, INDUSTRY_SUBTITLES = {};
        document.querySelectorAll = () => [];
        function renderIndustryCatRow() {}
        function renderIndustrySponsorMenu() {} function updateIndustryShareUrl() {}
        // The real top-10 cut (Codex's case: {} threw there), and a render
        // that reads the rows, as renderIndustry does (industryFilteredRows).
        ${fnSource('function industryTop10()')}
        let industryRenders = 0;
        function renderIndustry() { if (!industryData) return; industryData.trials.filter(Boolean); industryRenders++; }
        let nextResponse = null, fetches = 0;
        async function fetchChecked() { fetches++; return nextResponse; }
        ${fnSource('function industryDataProblem(d)')}
        ${line('let industryRouteApplied = false;')}
        ${fnSource('function applyIndustryShareParams()')}
        ${fnSource('async function loadIndustryView()')}`);
    const respond = (r) => h.run(`nextResponse = ${r};`);
    return { ...h, respond, load: () => h.run('loadIndustryView()') };
}
const HTTP_500 = '{ ok: false, status: 500, json: async () => ({}) }';
const BAD_JSON = "{ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); } }";
const GOOD = `{ ok: true, status: 200, json: async () => (${sponsorPayload([2012, 2027])}) }`;
// JSON, but not the sponsor dataset: an empty object, and a file without its rows.
const EMPTY = '{ ok: true, status: 200, json: async () => ({}) }';
const NO_TRIALS = `{ ok: true, status: 200, json: async () => { const d = ${sponsorPayload([2012, 2027])}; delete d.trials; return d; } }`;
// The first published format (July 2026), which industryTop10 and
// industryMenuCompanies still read: the top 10 plus a pooled "Other
// Industry", 7-field rows, and no company_n, top_n, lead-only or
// demographic fits.
const FIRST_FORMAT = `{ ok: true, status: 200, json: async () => (${JSON.stringify({
    generated_at: '2026-07-03T13:58:56Z', source_extracted_at: '2026-06-28T09:08:13.834989', cohort_n: 2, min_cell: 10,
    companies: ['Novartis', 'GlaxoSmithKline', 'Merck Sharp & Dohme', 'Pfizer', 'Eli Lilly and Company', 'AstraZeneca',
        'Bristol-Myers Squibb', 'Johnson & Johnson', 'Boehringer Ingelheim', 'Roche', 'Other Industry'],
    primaries: ['Oncology'], secondaries: ['Breast'], heatmap_conditions: ['Breast'],
    contrasts: [{ sponsor: 'Novartis', n: 120, beta: 1.2, lo: 0.1, hi: 2.3, p: 0.03 }], pooled: { n: 2, r2: 0.1, adj_r2: 0.1 },
    trial_fields: ['bucket', 'pf', 'results_year', 'pcd_year', 'primary', 'secondary', 'has_explicit_unknown'],
    trials: [[10, 33.3, 2012, 2010, 0, 0, 0], [0, null, 2027, 2022, 0, 0, 0]]
})}) }`;
const off = (h, why) => {
    assert.equal(h.btn.getAttribute('aria-disabled'), 'true', `the Filters button is on ${why}`);
    assert.equal(h.btn.getAttribute('aria-describedby'), 'filter-summary-text', why);
    assert.match(h.btn.title, /^Filters are off: the Industry sponsor data did not load/, why);
};
const on = (h, why) => {
    assert.equal(h.btn.getAttribute('aria-disabled'), null, `the Filters button is off ${why}`);
    assert.equal(h.btn.title, '', why);
};

for (const [name, failure] of [['an HTTP 500', HTTP_500], ['a body that is not JSON', BAD_JSON]]) {
    test(`over an archive, ${name} for the sponsor data says so and greys out the button until a load succeeds`, async () => {
        const h = loadHarness();
        h.run('syncFilterToggle();');
        // Loading: no data, no failure yet. Unchanged.
        assert.equal(h.text(), industryLine('from 2015'));
        on(h, 'while the sponsor data loads');

        h.btn.click();
        assert.equal(h.panel.hidden, false);
        h.respond(failure);
        await h.load();
        assert.match(h.el('industry-view-heatmap').innerHTML, /Could not load the industry sponsor dataset/);
        assert.equal(h.text(), FAILED_LINE, 'the line claims sponsor data that did not load');
        off(h, 'after the sponsor data failed');
        assert.equal(h.panel.hidden, true, 'the panel stayed open over controls that change nothing');
        h.btn.click();
        assert.equal(h.panel.hidden, true, 'the greyed-out button opened the panel');

        // Every redraw keeps it: the forest sub-view, renderDashboard's line.
        h.run("industryView = 'forest'; redrawArchiveSummary();");
        assert.equal(h.text(), FAILED_LINE, 'the forest line claims sponsor data that did not load');
        h.run("industryView = 'heatmap'; renderFilterSummary(77176, true);");
        assert.equal(h.text(), FAILED_LINE);
        // Another tab: the archive's own line and reason.
        h.el('industry').classList.remove('active');
        h.run('syncFilterToggle();');
        assert.equal(h.text(), ARCHIVE_LINE);
        assert.equal(h.btn.title, 'Filters are off: ' + 'this archive keeps totals only; filters apply to the latest data and the complete snapshots');

        // Back on Industry, a failed retry keeps it; a successful one restores both.
        h.el('industry').classList.add('active');
        h.run('syncFilterToggle();');
        assert.equal(h.text(), FAILED_LINE);
        h.respond(failure);
        await h.load();
        assert.equal(h.text(), FAILED_LINE);
        off(h, 'after a second failure');
        h.respond(GOOD);
        await h.load();
        assert.equal(h.run('industryRenders'), 1);
        assert.equal(h.text(), industryLine('2015–2027'), 'a successful load left the failure line');
        on(h, 'after the sponsor data loaded');
        h.btn.click();
        assert.equal(h.panel.hidden, false, 'the Filters button does not open the panel after the load');
    });
}

test('a failed sponsor load on the latest data keeps the line and the Filters button', async () => {
    const h = loadHarness({ archive: false });
    h.run('renderFilterSummary(1234); syncFilterToggle();');
    const latest = '<b>1,234</b> trials · results posted <b>2015–2026</b> · all sponsors, purposes and conditions';
    assert.equal(h.text(), latest);
    h.respond(HTTP_500);
    await h.load();
    assert.equal(h.text(), latest);
    on(h, 'on the latest data: its controls still filter the dataset the line counts');
    // A later archive with Industry open shows the failure there.
    h.run('dashboardSummary = ' + JSON.stringify(ARCHIVE) + '; syncFilterToggle();');
    assert.equal(h.text(), FAILED_LINE);
    off(h, 'over an archive after the failure');
});

test('the phone summary view leaves its hidden button alone when the sponsor data fails', async () => {
    const h = harness({ mobile: true, summary: ARCHIVE });
    setControls(h);
    h.run('initFilterSummary();');
    h.el('industry').classList.add('active');
    h.run(`industryLoadFailed = true; syncFilterToggle(); renderFilterSummary(77176, true);`);
    assert.equal(h.btn.hidden, true);
    assert.equal(h.btn.getAttribute('aria-disabled'), null);
    assert.equal(h.text(), '<b>77,176</b> trials · the full dataset, unfiltered · filters are a desktop feature');
});

// JSON that is not the sponsor dataset (Codex, PR #255): {} used to be kept
// as loaded. industryTop10() threw on it inside the loader's try, so the view
// showed its error, but industryLoadFailed stayed false: over an archive the
// line said the latest sponsor data was shown and the Filters button stayed
// on. And a reopen found industryData set, skipped the fetch and rendered it,
// throwing outside the catch. industryDataProblem now turns such a body away
// before it is kept: a failed load like an HTTP error.
for (const [name, body] of [['{}', EMPTY], ['a file without its trial rows', NO_TRIALS]]) {
    test(`over an archive, ${name} for the sponsor data is a failed load, and a reopen fetches again`, async () => {
        const h = loadHarness();
        h.run('syncFilterToggle();');
        h.btn.click();
        assert.equal(h.panel.hidden, false);
        h.respond(body);
        await h.load();
        assert.match(h.el('industry-view-heatmap').innerHTML, /Could not load the industry sponsor dataset \(not the sponsor dataset: .*trials/);
        assert.equal(h.run('industryData'), null, 'a body that is not the sponsor dataset was kept');
        assert.equal(h.run('industryLoadFailed'), true);
        assert.equal(h.text(), FAILED_LINE, 'the line claims sponsor data that did not load');
        off(h, 'after a body that is not the sponsor dataset');
        assert.equal(h.panel.hidden, true, 'the panel stayed open over controls that change nothing');

        // Reopening the tab fetches again (it used to render the held object
        // and throw outside the catch), and fails the same way.
        await h.load();
        assert.equal(h.run('fetches'), 2, 'the reopen did not fetch the sponsor data again');
        assert.equal(h.text(), FAILED_LINE);
        off(h, 'after the reopen');
        assert.equal(h.run('industryRenders'), 0);

        // A good file afterwards loads as usual.
        h.respond(GOOD);
        await h.load();
        assert.equal(h.run('fetches'), 3);
        assert.equal(h.run('industryRenders'), 1);
        assert.equal(h.text(), industryLine('2015–2027'));
        on(h, 'after the sponsor data loaded');
    });
}

test('the first published sponsor format still loads, and a reopen keeps it without fetching', async () => {
    const h = loadHarness();
    h.respond(FIRST_FORMAT);
    await h.load();
    assert.equal(h.run('industryLoadFailed'), false);
    assert.doesNotMatch(h.el('industry-view-heatmap').innerHTML, /Could not load/);
    assert.deepEqual(JSON.parse(h.run('JSON.stringify([...industrySelected])')),
        ['Novartis', 'GlaxoSmithKline', 'Merck Sharp & Dohme', 'Pfizer', 'Eli Lilly and Company', 'AstraZeneca',
            'Bristol-Myers Squibb', 'Johnson & Johnson', 'Boehringer Ingelheim', 'Roche'],
        'the named top 10 of the first format (no top_n: the first 10 companies)');
    assert.equal(h.text(), industryLine('2015–2027'));
    on(h, 'with the sponsor data held');
    await h.load();
    assert.equal(h.run('fetches'), 1, 'held sponsor data was fetched again');
    assert.equal(h.run('industryRenders'), 2);
});

test('{} for the sponsor data on the latest data keeps the line and the Filters button, and a reopen fetches again', async () => {
    const h = loadHarness({ archive: false });
    h.run('renderFilterSummary(1234); syncFilterToggle();');
    const latest = '<b>1,234</b> trials · results posted <b>2015–2026</b> · all sponsors, purposes and conditions';
    h.respond(EMPTY);
    await h.load();
    assert.match(h.el('industry-view-heatmap').innerHTML, /Could not load the industry sponsor dataset/);
    assert.equal(h.text(), latest);
    on(h, 'on the latest data: its controls still filter the dataset the line counts');
    // The reopen used to throw here, outside the loader's catch.
    await h.load();
    assert.equal(h.run('fetches'), 2, 'the reopen did not fetch the sponsor data again');
    assert.equal(h.text(), latest);
    on(h, 'after the reopen on the latest data');
    h.respond(GOOD);
    await h.load();
    assert.equal(h.run('industryRenders'), 1);
    assert.equal(h.text(), latest);
});

// A step after a good file parsed that throws (here the category row) used
// to keep the half-set-up data as loaded: the view showed the error, but
// the line and the Filters button said the data was there, and a reopen
// skipped the fetch and drew the half-set-up view outside the catch. The
// data is now dropped and the load reported as failed, so a reopen sets it
// up again from a fresh fetch.
test('a step after the sponsor data parsed that throws drops the data: a failed load, and a reopen fetches again', async () => {
    const h = loadHarness();
    h.run("renderIndustryCatRow = () => { throw new Error('cat row'); };");
    h.respond(GOOD);
    await h.load();
    assert.match(h.el('industry-view-heatmap').innerHTML, /cat row/);
    assert.equal(h.run('industryData'), null, 'half-set-up sponsor data was kept');
    assert.equal(h.run('industryLoadFailed'), true);
    assert.equal(h.text(), FAILED_LINE);
    off(h, 'with no usable sponsor data');
    h.run('renderIndustryCatRow = () => {};');
    await h.load();
    assert.equal(h.run('fetches'), 2, 'the reopen did not fetch the sponsor data again');
    assert.equal(h.run('industryRenders'), 1);
    assert.equal(h.text(), industryLine('2015–2027'));
    on(h, 'after the reopen loaded the sponsor data');
});

// Whichever listener runs first, and with only the Industry view's own (the
// harness tests/industry_filter_reset.test.mjs builds), a new primary draws
// the view once, with the subcategory at all.
for (const order of ['reversed', 'industryOnly']) {
    test(`a new primary condition redraws Industry once, without the old subcategory (${order})`, () => {
        const h = conditionHarness({ archive: true, order });
        h.pick('condition-primary', 'Oncology');
        h.pick('condition-secondary', 'Breast');
        assert.deepEqual(h.renders().at(-1), { pri: 'Oncology', sec: 'Breast', rows: 1 });
        h.pick('condition-primary', 'Cardiology');
        assert.equal(h.el('condition-secondary').value, 'all', 'the subcategory survived a new primary');
        assert.deepEqual(h.renders(), [{ pri: 'Cardiology', sec: 'all', rows: 2 }],
            'Industry did not draw the new condition once, with subcategory all');
        assert.equal(h.run('industryFilteredRows().length'), 2);
    });
}
