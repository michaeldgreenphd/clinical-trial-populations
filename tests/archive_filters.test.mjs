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
    fnSource('function syncFilterToggle()')
].join('\n');

// What these functions read and write on an element. The title property
// reflects the title attribute, as in a browser.
function element(id) {
    const attrs = {};
    const e = {
        id, innerHTML: '', hidden: false, listeners: {},
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
        escapeHtml: (s) => String(s)
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
    h.run('renderFilterSummary(77176, true);');
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
