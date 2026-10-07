/**
 * The first view: the Overview painted from dashboard-summary.json's
 * "firstView" block before the study records load, then handed to them.
 *
 * The engine counts the Overview as it opens from the week's full records
 * (civicsample-engine src/first_view.py) and checks the block every week by
 * running this site's Overview code on both (scripts/first_view_parity.mjs,
 * which slices app.js by function name). These tests hold the site's half:
 *
 *  - painted from the real block and painted from the real records, the
 *    Overview is the same, string for string, and its trend chart draws the
 *    same years and series (the block of the 2026-10-04 run, from
 *    tests/first_view_block.json, until data/dashboard-summary.json carries
 *    its own);
 *  - the first view paints only where it can show what the records would:
 *    a desktop, the latest data, no link to a filter, a tab or a snapshot,
 *    no ?firstview=0, a well-formed block from the summary's run (and from
 *    data/run.json's, when that answered), and every control at the block's
 *    filter once the year window is sized to its newest year;
 *  - the hand-over: equal records leave the screen as it was (no second
 *    chart, no warning); different ones repaint without animation and warn;
 *    every tab but the Overview, the Filters button and the snapshot
 *    selector wait for the records and open after them; a failed load says
 *    so in the strip;
 *  - a summary without the block (today's, and every archive's) does what
 *    it did: the loading screen's figure, nothing painted, nothing disabled;
 *  - the engine's gate itself (its script, copied unchanged and pinned in
 *    tests/engine_first_view_parity.json) passes on this app.js and
 *    index.html, and the pieces it slices run on their own in its runtime,
 *    calling no other app.js function but the ones named in ENGINE_STUBBED;
 *  - a phone on the latest summary opens on the same Overview from the same
 *    block, under the same checks, while its other tabs stay on the
 *    summary's all-study-type aggregates and its scope line says which
 *    study types each tab counts (the real summary of the 2026-10-04 run
 *    with its block, tests/phone_first_view_summary.json).
 *
 * Everything runs app.js's own functions in a vm, over a stub document
 * built from index.html's markup (its controls start at their defaults).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const app = read('app.js');
const html = read('index.html');

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
function constLine(name) {
    const m = app.match(new RegExp(`^const ${name} = .*;$`, 'm'));
    assert.ok(m, `app.js lost const ${name}`);
    return m[0];
}

// ── A document from index.html ─────────────────────────────────────────────
// The body from its start through the Overview's section: the loading
// screen, the strip, the header, the tabs, the filter panel and the Overview.
const MARKUP = (() => {
    const a = html.indexOf('<body>'), o = html.indexOf('<section id="overview"'), e = html.indexOf('</section>', o);
    assert.ok(a >= 0 && o > a && e > o, 'index.html lost its body … Overview section');
    return html.slice(a, e + '</section>'.length).replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
})();
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'source', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
});
function attributes(text) {
    const out = {};
    for (const m of (text || '').matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
    }
    return out;
}
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function buildDocument() {
    const all = [];
    const byId = new Map();
    const focus = { body: { tagName: 'BODY' }, active: null };
    const stack = [];
    let root = null;
    const matches = (el, simple) => {
        // tag, .class, #id, [attr="v"], [attr], :not(simple), :disabled — what app.js's selectors here use
        let rest = simple.trim();
        const not = /:not\(([^)]*)\)/.exec(rest);
        if (not) {
            if (matches(el, not[1])) return false;
            rest = rest.replace(not[0], '');
        }
        if (rest.endsWith(':disabled')) { if (!el.disabled) return false; rest = rest.slice(0, -9); }
        for (const m of rest.matchAll(/([#.]?)([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)) {
            if (m[3] && m[4] === undefined) { if (el.getAttribute(m[3]) === null) return false; continue; }
            if (m[3]) { if (el.getAttribute(m[3]) !== m[4]) return false; continue; }
            if (m[1] === '#') { if (el.id !== m[2]) return false; }
            else if (m[1] === '.') { if (!el.classList.contains(m[2])) return false; }
            else if (el.tagName !== m[2].toUpperCase()) return false;
        }
        return true;
    };
    const query = (scope, sel) => {
        const parts = sel.split(',').map((s) => s.trim());
        return all.filter((el) => el !== scope && (!scope || (el.at > scope.at && el.at < scope.end))
            && parts.some((p) => matches(el, p)));
    };
    function element(tag, attrs, at) {
        const set = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
        const dataset = {};
        for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) dataset[camel(k.slice(5))] = v;
        const el = {
            tagName: tag.toUpperCase(), at, end: at, attrs, style: {}, dataset,
            textContent: '', innerHTML: '',
            classList: {
                contains: (c) => set.has(c), add: (...c) => c.forEach((x) => set.add(x)),
                remove: (...c) => c.forEach((x) => set.delete(x)),
                toggle: (c, force) => ((force ?? !set.has(c)) ? (set.add(c), true) : (set.delete(c), false))
            },
            get id() { return attrs.id ?? ''; },
            get hidden() { return 'hidden' in attrs; }, set hidden(v) { if (v) attrs.hidden = ''; else delete attrs.hidden; },
            // As a browser does: focus leaves a control as it is disabled, for <body>.
            get disabled() { return 'disabled' in attrs; },
            set disabled(v) { if (v) { attrs.disabled = ''; if (focus.active === el) focus.active = focus.body; } else delete attrs.disabled; },
            get title() { return attrs.title ?? ''; }, set title(v) { attrs.title = String(v); },
            setAttribute(name, value) { attrs[name] = String(value); if (name.startsWith('data-')) dataset[camel(name.slice(5))] = String(value); },
            getAttribute: (name) => (name in attrs ? attrs[name] : name.startsWith('data-') && camel(name.slice(5)) in dataset ? dataset[camel(name.slice(5))] : null),
            removeAttribute(name) { delete attrs[name]; if (name.startsWith('data-')) delete dataset[camel(name.slice(5))]; },
            hasAttribute: (name) => name in attrs,
            querySelector: (sel) => query(el, sel)[0] ?? null,
            querySelectorAll: (sel) => query(el, sel),
            listeners: {},
            addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); }, removeEventListener() {}, dispatchEvent() { return true; },
            // As a browser's: nothing on a disabled control.
            click() { if (el.disabled) return; (el.listeners.click || []).forEach((fn) => fn({ target: el })); if (el.onclick) el.onclick({ target: el }); },
            appendChild: (c) => c, prepend() {}, focus() { if (!el.disabled) focus.active = el; }
        };
        return el;
    }
    for (const m of MARKUP.matchAll(/<(\/?)([a-zA-Z][\w-]*)(\s[^<>]*?)?\s*(\/?)>/g)) {
        const tag = m[2].toLowerCase();
        if (m[1]) {
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].tagName === tag.toUpperCase()) {
                    stack[i].end = m.index;
                    stack[i].textContent = decode(MARKUP.slice(stack[i].contentAt, m.index).replace(/<[^>]*>/g, ''))
                        .replace(/\s+/g, ' ').trim();
                    stack.length = i;
                    break;
                }
            }
            continue;
        }
        const attrs = attributes(m[3]);
        const el = element(tag, attrs, m.index);
        el.contentAt = m.index + m[0].length;
        if (tag === 'input') {
            const type = (attrs.type || 'text').toLowerCase();
            el.type = type;
            if (type === 'range') {
                let min = attrs.min, max = attrs.max, value = attrs.value;
                const clamp = (v) => {
                    const n = parseInt(v, 10), lo = +min, hi = Math.max(+max, lo);
                    return String(Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : Math.round((lo + hi) / 2));
                };
                value = clamp(value);
                Object.defineProperties(el, {
                    min: { get: () => min, set: (v) => { min = String(v); value = clamp(value); } },
                    max: { get: () => max, set: (v) => { max = String(v); value = clamp(value); } },
                    value: { get: () => value, set: (v) => { value = clamp(v); } }
                });
            } else {
                el.value = attrs.value ?? (type === 'checkbox' ? 'on' : '');
                el.checked = 'checked' in attrs;
            }
        } else if (tag === 'select') {
            const body = MARKUP.slice(m.index + m[0].length, MARKUP.indexOf('</select>', m.index));
            const options = [...body.matchAll(/<option(\s[^>]*)?>([\s\S]*?)<\/option>/g)].map((o) => {
                const a = attributes(o[1]);
                const text = decode(o[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
                return { value: 'value' in a ? a.value : text, text, selected: 'selected' in a, defaultSelected: 'selected' in a };
            });
            let index = Math.max(options.findIndex((o) => o.selected), options.length ? 0 : -1);
            // As a browser's: an appended <option> joins the list.
            el.appendChild = (c) => { options.push({ value: String(c.value), get text() { return c.textContent; }, selected: false }); return c; };
            Object.defineProperties(el, {
                options: { get: () => options },
                selectedIndex: { get: () => index, set: (v) => { index = v; } },
                value: { get: () => (index >= 0 ? options[index].value : ''), set: (v) => { index = options.findIndex((o) => o.value === String(v)); } }
            });
        }
        all.push(el);
        if (attrs.id && !byId.has(attrs.id)) byId.set(attrs.id, el);
        if (!root) root = el;
        if (!VOID.has(tag) && !m[4]) stack.push(el);
    }
    const rootClasses = new Set();
    const rootStyle = {};
    focus.active = focus.body;
    const document = {
        get activeElement() { return focus.active; },
        documentElement: {
            classList: { add: (c) => rootClasses.add(c), remove: (c) => rootClasses.delete(c), contains: (c) => rootClasses.has(c) },
            style: { setProperty: (k, v) => { rootStyle[k] = v; } }
        },
        getElementById: (id) => byId.get(id) ?? null,
        querySelector: (sel) => query(null, sel)[0] ?? null,
        querySelectorAll: (sel) => query(null, sel),
        createElement(tag) {
            if (String(tag).toLowerCase() !== 'div') return element(String(tag), {}, -1);
            // escapeHtml's div: its markup is its text, escaped as a browser serialises a text node
            let text = '';
            return {
                set textContent(v) { text = String(v); }, get textContent() { return text; },
                get innerHTML() { return text.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
            };
        }
    };
    return { document, byId, rootClasses, rootStyle };
}

// ── app.js in a vm ─────────────────────────────────────────────────────────

// What renderDashboard and initFilters call outside the Overview: inert here.
const ELSEWHERE = [
    'sgApplyMode', 'sgAfterRender', 'refreshStudiesTab', 'updateActiveFilters',
    'populateConditionsDropdown', 'populateCountriesDropdown', 'populateSecondaryConditionDropdown',
    'renderRaceDistribution', 'renderRaceTrends', 'renderRaceSubcategories', 'renderRaceReportedParticipants',
    'renderRaceFullDistribution', 'renderEthnicityDistribution', 'renderEthnicityTrends',
    'renderEthnicitySubcategories', 'renderEthnicityReportedParticipants', 'renderEthnicityFullDistribution',
    'renderSexReportedParticipants', 'renderSexFullDistribution', 'renderSexDistribution', 'renderSexTrends',
    'renderGenderReportedParticipants', 'renderGenderFullDistribution', 'renderGenderDistribution',
    'renderGenderTrends', 'renderFdaOversight', 'renderGeographyDashboard', 'labelChartsForA11y',
    'resetFilters', 'updateShareUrl', 'sgOpenMethods', 'updateLoadingProgress'
];
// Filters that apply only away from the default view: they throw, so a
// default view that ran one would fail.
const AWAY_FROM_DEFAULT = ['isAIStudy', 'getStudyPediatricStatus', 'studyMatchesConditionFilter', 'sgRow'];

const SITE = [
    between('const YEAR_WINDOW_MIN', 'function initFilters()'),
    fnSource('function initFilters()'),
    fnSource('function getFilteredData()'),
    fnSource('function sgReadFilters()'),
    fnSource('function showDashboardSpinner()'),
    fnSource('function hideDashboardSpinner()'),
    fnSource('function renderOverviewTileContext('),
    fnSource('function renderOverviewFinding('),
    fnSource('function renderFilterSummary('),
    fnSource('function renderUnfilteredFilterSummary(el, total, scope)'),
    // The Filters button's archive state, which renderDashboard syncs first
    // (PR #255): the real one, so a records render cannot leave the button
    // the first view holds off looking open, or the reverse.
    'let industryLoadFailed = false;',
    constLine('ARCHIVE_FILTERS_NOTE'),
    fnSource('function industryActive()'),
    fnSource('function redrawArchiveSummary()'),
    fnSource('function syncFilterToggle()'),
    fnSource('function renderDashboard()'),
    fnSource('function escapeHtml('),
    fnSource('function renderReportingTrends('),
    fnSource('function setDataPulledDate(iso)'),
    fnSource('function sgQueryParams(hash, search)'),
    // The archive selector's dates (history.json).
    fnSource('function publishedDates(manifest)'),
    fnSource('function newestPublishedIn(manifest)'),
    fnSource('function noteNewestPublished(manifest)'),
    fnSource('function servedFromData(date)'),
    fnSource('function listHistoryDates(select, manifest)'),
    fnSource('function listHistoryWhileWaiting()'),
    fnSource('async function initHistorySelector()'),
    between('const SHARE_FILTERS = [', 'function shareFilterDefault('),
    constLine('FIRST_VIEW_COUNTS'),
    fnSource('function firstViewBlock(summary)'),
    fnSource('function firstViewSummaryProblem(summary, run)'),
    fnSource('function firstViewProblem(summary, run)'),
    fnSource('function overviewOnScreen()'),
    fnSource('function paintOverviewFromBlock(b, years)'),
    fnSource('function paintFirstView(summary)'),
    fnSource('async function firstViewOrFigure(summary)'),
    fnSource('function withdrawFirstView()'),
    constLine('RECORDS_PENDING_CONTROLS'),
    fnSource('function setRecordsPending(on)'),
    fnSource('function keepPageAboveStrip(strip)'),
    fnSource('function focusOffClosing(els)'),
    fnSource('function clearRestoredDisabled()'),
    fnSource('function settleFirstView()'),
    fnSource('function firstViewFailed(err, retry)'),
    fnSource('function firstViewRetrying()'),
    fnSource('function offerRetry(button, retry)'),
    constLine('RECORD_FREE_TABS'),
    fnSource('function openRecordFreeTabs()'),
    fnSource('async function loadStartupRecords()'),
    fnSource('function startupFailed(err, retry)'),
    fnSource('function startupRetrying()'),
    // The phone's Overview from the block, and its scope line.
    between('// ── Phones: the desktop', '// Initialize\n'),
    // What startup runs once the records are drawn: an open Industry view's
    // redraw (PR #255; the Overview is open here, so it draws nothing) and
    // the deep-link hooks.
    fnSource('function renderIndustryAfterSwitch()'),
    fnSource('function applyRouteFromHash()'),
    fnSource('function sgRouteHooks()')
].join('\n');

// Startup, and its tail from the records' render through the hand-over
// (the deep links run in it).
const STARTUP = (() => {
    const init = app.slice(app.indexOf("document.addEventListener('DOMContentLoaded', async () => {"));
    return init.slice(0, init.indexOf('\n});\n'));
})();
const STARTUP_TAIL = (() => {
    const a = STARTUP.indexOf("updateLoadingProgress(90, 'Drawing charts');");
    const b = STARTUP.search(/if \(!summaryMode\) \{\s*initHistorySelector\(\);/);
    assert.ok(a >= 0 && b > a, 'startup lost its render … history selector tail');
    // What loadStartupDataset hands the tail on a visit with no snapshot
    // link (PR #256): the latest data, and no failed snapshot to report.
    return 'var opened = null; var startupFailure = null;\n' + STARTUP.slice(a, b);
})();

// One page: index.html's controls at their defaults, the app's Overview
// code, and switches for what the first view reads from the page around it.
function page({ mobile = false, hash = '', search = '', runStamp = null, run = null, history = null, runDate = null } = {}) {
    const { document, byId, rootClasses, rootStyle } = buildDocument();
    const charts = [];
    const observers = [];
    const frames = [];
    const timers = [];
    const warnings = [];
    const infos = [];
    const figures = [];
    const sandbox = {
        document, window: {},
        console: { log() {}, debug() {}, error() {}, info: (...a) => infos.push(a), warn: (...a) => warnings.push(a) },
        requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
        cancelAnimationFrame() {},
        setTimeout: (fn) => { timers.push(fn); return timers.length; },
        Chart: class {
            constructor(canvas, config) { this.canvas = canvas; this.config = config; charts.push(this); }
            destroy() { this.destroyed = true; }
        },
        sgActive: () => false,
        URLSearchParams,
        // A browser's ResizeObserver: fire() is the browser noticing a new size.
        ResizeObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(target) { this.target = target; }
            fire() { this.callback([{ target: this.target }]); }
        },
        renderLoadingFigure: (s) => figures.push(s),
        hideLoadingOverlay: () => { const o = byId.get('loading-overlay'); if (o) o.classList.add('fade-out'); },
        fetchRun: async () => { sandbox.__runAsked = (sandbox.__runAsked || 0) + 1; return run; },
        fetchHistory: async () => history,
        location: { hash, search },
        __mobile: mobile, __hash: hash, __search: search, __runStamp: runStamp, __runDate: runDate
    };
    for (const name of ELSEWHERE) sandbox[name] = () => {};
    for (const name of AWAY_FROM_DEFAULT) sandbox[name] = () => { throw new Error(`${name} ran in the default view`); };
    const context = vm.createContext(sandbox);
    vm.runInContext([
        'let data = null; let dashboardSummary = null; let charts = {}; let sgV2Filters = null;',
        'const isMobileDevice = __mobile; const SG_INITIAL_HASH = __hash; const SG_INITIAL_SEARCH = __search;',
        'let LATEST_RUN_STAMP = __runStamp; let NEWEST_PUBLISHED = null; let DATA_RUN_DATE = __runDate;',
        "const COLORS = { reporting: { race: '#000000', ethnicity: '#000000', both: '#000000' } };",
        'const CHART_ASPECT_RATIO = undefined;',
        'let firstViewShown = null; let firstViewClosed = false; var shareUrlReady = false;',
        SITE,
        // The counts renderDashboard hands its finding.
        'var __finding = [];',
        'const __siteFinding = renderOverviewFinding;',
        'renderOverviewFinding = function (...args) { __finding.push(args); return __siteFinding(...args); };'
    ].join('\n'), context, { filename: 'first-view.js' });
    const run$ = (code) => vm.runInContext(code, context);
    const flushFrames = () => { while (frames.length) frames.shift()(); };
    return {
        context, byId, charts, warnings, infos, figures, timers, rootClasses, rootStyle, observers, run: run$, flushFrames,
        el: (id) => byId.get(id),
        text: (id) => { const e = byId.get(id); return { text: e.textContent, html: e.innerHTML }; },
        trendCharts: () => charts.filter((c) => c.canvas && c.canvas.id === 'reporting-trends-chart'),
        // The Overview as a reader sees it: every line of text, whether the
        // finding shows, and the trend chart's years and series.
        overview() {
            const ids = ['total-studies', 'race-reporting', 'ethnicity-reporting', 'both-reporting', 'stat-sub-total',
                'stat-sub-race', 'stat-sub-ethnicity', 'stat-sub-both', 'finding-headline', 'finding-context', 'filter-summary-text'];
            const shown = Object.fromEntries(ids.map((id) => [id, this.text(id)]));
            shown.findingShown = !byId.get('overview-finding').hidden;
            const live = this.trendCharts().filter((c) => !c.destroyed);
            assert.equal(live.length, 1, 'one trend chart on screen');
            const { data } = live[0].config;
            shown.chart = { labels: [...data.labels], series: data.datasets.map((d) => ({ label: d.label, data: [...d.data] })) };
            return shown;
        },
        lastCounts: () => run$('__finding.length ? __finding[__finding.length - 1].slice() : null'),
        loadRecords(records) {
            context.__records = records;
            run$('data = __records; initFilters(); renderDashboard();');
        }
    };
}

// ── Blocks ─────────────────────────────────────────────────────────────────
const RUN = { extracted_at: '2026-10-04T12:09:21.454200+00:00', pipeline_commit: 'd853532eb8b1297e6333653e81bce5bea9caed4e' };

function rec(year, type, race, eth) {
    return { results_date: `${year}-05-01`, study_type: type, race: { reported: race }, ethnicity: { reported: eth } };
}
// 240 records over 2009-2026: what the block below counts.
function syntheticRecords() {
    const out = [];
    for (let y = 2009; y <= 2026; y++) {
        for (let i = 0; i < 12; i++) out.push(rec(y, 'INTERVENTIONAL', i % 2 === 0, i % 3 === 0));
        out.push(rec(y, 'OBSERVATIONAL', true, true));
    }
    return out;
}
// The block the engine would write for records, by its rule (src/first_view.py).
function blockFor(records, stamps = RUN) {
    const byYear = {};
    for (const r of records) {
        if (r.study_type !== 'INTERVENTIONAL') continue;
        const y = String(r.results_date || '').slice(0, 4);
        if (!/^\d{4}$/.test(y) || +y < 2009) continue;
        const c = byYear[y] ||= { trials: 0, trials_reporting_race: 0, trials_reporting_ethnicity: 0, trials_reporting_race_and_ethnicity: 0 };
        c.trials++;
        if (r.race?.reported) c.trials_reporting_race++;
        if (r.ethnicity?.reported) c.trials_reporting_ethnicity++;
        if (r.race?.reported && r.ethnicity?.reported) c.trials_reporting_race_and_ethnicity++;
    }
    const sum = (k) => Object.values(byYear).reduce((a, c) => a + c[k], 0);
    const newest = Math.max(...records.map((r) => parseInt(String(r.results_date).slice(0, 4), 10) || 0));
    return {
        ...stamps,
        filter: { study_type: 'INTERVENTIONAL', results_year_from: 2009, results_year_to: null, other_filters: 'none' },
        newest_results_year: newest,
        trials: sum('trials'), trials_reporting_race: sum('trials_reporting_race'),
        trials_reporting_ethnicity: sum('trials_reporting_ethnicity'),
        trials_reporting_race_and_ethnicity: sum('trials_reporting_race_and_ethnicity'),
        denominators: { trials_reporting_race: 'trials', trials_reporting_ethnicity: 'trials', trials_reporting_race_and_ethnicity: 'trials' },
        by_results_year: Object.fromEntries(Object.entries(byYear).sort()),
        not_counted: { no_results_date: 0, results_year_not_from_2009: 0, not_interventional: records.filter((r) => r.study_type !== 'INTERVENTIONAL').length }
    };
}
function summaryWith(block, stamps = RUN) {
    const s = { ...stamps, totalStudies: 0, cards: {}, byYear: {}, recentStudies: [] };
    if (block !== undefined) s.firstView = block;
    return s;
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const FIRST_VIEW_TOTALS = ['trials', 'trials_reporting_race', 'trials_reporting_ethnicity', 'trials_reporting_race_and_ethnicity'];

// ── 1. Parity on the real data ─────────────────────────────────────────────

// The records app.js loads for the latest data: data/ + partFiles(NUM_PARTS).
function realRecords() {
    const n = parseInt(app.match(/^const NUM_PARTS = (\d+);$/m)?.[1], 10);
    assert.ok(n > 0, 'app.js lost NUM_PARTS');
    const ctx = vm.createContext({});
    vm.runInContext(fnSource('function partFiles(n)'), ctx);
    const files = vm.runInContext(`partFiles(${n})`, ctx).map((f) => `data/${f}`);
    const parts = files.map((f) => {
        const url = new URL(`../${f}`, import.meta.url);
        assert.ok(existsSync(url), `${f} is missing`);
        return JSON.parse(gunzipSync(readFileSync(url)).toString('utf8'));
    });
    return { parts, records: parts.flatMap((p) => p.data) };
}

// The live summary's block when it has one; else the fixture's, while its
// stamps are the parts'.
function realSummary(parts) {
    const live = JSON.parse(read('data/dashboard-summary.json'));
    const stamp = { extracted_at: parts[0].extracted_at, pipeline_commit: parts[0].pipeline_commit };
    if (live.firstView !== undefined) return { summary: live, from: 'data/dashboard-summary.json', stamp };
    const fixture = JSON.parse(read('tests/first_view_block.json'));
    if (fixture.extracted_at === stamp.extracted_at && fixture.pipeline_commit === stamp.pipeline_commit) {
        return { summary: { ...fixture, about: undefined }, from: 'tests/first_view_block.json', stamp };
    }
    return { summary: null, stamp };
}

test('painted from the real block, the Overview is the one the real records paint', { timeout: 120000 }, async (t) => {
    const { parts, records } = realRecords();
    const { summary, from, stamp } = realSummary(parts);
    if (!summary) {
        t.skip(`neither data/dashboard-summary.json nor tests/first_view_block.json carries a block for the run of ${stamp.extracted_at}`);
        return;
    }
    t.diagnostic(`block from ${from}; ${records.length} records from the run of ${stamp.extracted_at}`);
    const live = JSON.parse(read('data/dashboard-summary.json'));
    for (const k of ['extracted_at', 'pipeline_commit']) {
        assert.equal(summary[k], parts[0][k], `the summary's ${k} is not the parts'`);
        assert.equal(summary.firstView[k], parts[0][k], `the block's ${k} is not the parts'`);
    }
    assert.equal(summary.totalStudies, records.length, 'the summary counted other records');
    assert.equal(live.extracted_at, parts[0].extracted_at, 'data/dashboard-summary.json is from another run than the parts');

    const block = summary.firstView;
    const fromBlock = page({ runStamp: stamp.extracted_at, run: stamp });
    assert.equal(fromBlock.run('firstViewBlock')(summary), summary.firstView, 'the real block is not well formed');
    assert.equal(await fromBlock.run('firstViewOrFigure')(summary), true, `the real block does not paint: ${fromBlock.run('firstViewProblem')(summary, stamp)}`);
    const painted = fromBlock.overview();

    const fromRecords = page();
    fromRecords.loadRecords(records);
    const counted = [...fromRecords.lastCounts()];
    assert.deepEqual(counted, [block.trials, block.trials_reporting_race, block.trials_reporting_ethnicity,
        block.trials_reporting_race_and_ethnicity], 'the records count other totals than the block');
    const drawn = fromRecords.overview();
    for (const id of Object.keys(drawn).filter((k) => k !== 'chart')) {
        assert.deepEqual(painted[id], drawn[id], `#${id} differs`);
    }
    assert.deepEqual(painted.chart.labels, drawn.chart.labels, 'the trend chart\'s years differ');
    drawn.chart.series.forEach((s, i) => {
        assert.equal(painted.chart.series[i].label, s.label);
        assert.ok(s.data.every((v, k) => Object.is(v, painted.chart.series[i].data[k])), `the ${s.label} series differs`);
    });
    // What the reader sees, for the record.
    assert.equal(drawn['total-studies'].text, block.trials.toLocaleString());
    assert.match(drawn['filter-summary-text'].html, new RegExp(`results posted <b>2009–${block.newest_results_year}</b>`));

    // And the hand-over on the same page: the records' render keeps the
    // block's chart, warns of nothing, and opens the page.
    fromBlock.loadRecords(records);
    fromBlock.run('settleFirstView()');
    assert.equal(fromBlock.trendCharts().length, 1, 'the records rebuilt a chart with the same numbers');
    assert.deepEqual(fromBlock.warnings, []);
    assert.deepEqual(fromBlock.overview(), painted);
});

// ── 2. Where the first view paints ─────────────────────────────────────────

test('the first view paints only the latest default Overview on a desktop', async () => {
    const records = syntheticRecords();
    const good = blockFor(records);
    const problem = (opts, summary = summaryWith(clone(good)), run = null, before = () => {}) => {
        const p = page(opts);
        before(p);
        return p.run('firstViewProblem')(summary, run);
    };
    assert.equal(problem({}), null, 'the default view does not paint');
    assert.equal(problem({ hash: '#overview' }), null, '#overview does not paint');
    assert.equal(problem({ search: '?sg=v2' }), null, '?sg=v2 (its filters at Any) does not paint');
    assert.equal(problem({ search: '?firstview=1' }), null);
    assert.equal(problem({ search: '?utm_source=x' }), null, 'a parameter the page does not read stops it');
    // The same parameters in the hash: the site writes #overview?sg=v2 itself
    // (updateShareUrl, for a remembered ?sg choice), and the /overview/ stub
    // moves any query into the hash.
    assert.equal(problem({ hash: '#overview?sg=v2' }), null, '#overview?sg=v2 does not paint');
    assert.equal(problem({ hash: '#overview?sgfilters=1' }), null, '#overview?sgfilters=1 does not paint');
    assert.equal(problem({ hash: '#overview?utm_source=x' }), null, '#overview?utm_source=x does not paint');
    assert.equal(problem({}, summaryWith(clone(good)), RUN), null, 'data/run.json naming this run stops it');
    assert.equal(problem({}, summaryWith(clone(good)), { extracted_at: RUN.extracted_at }), null, 'a run.json without a commit stops it');

    const no = {
        'a phone': [{ mobile: true }],
        '?firstview=0': [{ search: '?firstview=0' }],
        '?firstview=0 in the hash': [{ hash: '#overview?firstview=0' }],
        'a link to another tab': [{ hash: '#race' }],
        'a link to another tab with a query': [{ hash: '#race?sg=v2' }],
        'a snapshot link in the hash': [{ hash: '#overview?sgsnapshot=2026-09-27' }],
        'a link with filters in the hash': [{ hash: '#overview?st=all' }],
        'a link with filters in the query': [{ search: '?sp=INDUSTRY' }],
        'a link with a year': [{ search: '?ye=2020' }],
        'a snapshot link': [{ search: '?sgsnapshot=2026-09-27' }],
        'a methods link': [{ search: '?m=race' }],
        'no summary': [{}, null],
        'a summary without the block': [{}, summaryWith(undefined)],
        'a block from another run than the summary': [{}, summaryWith({ ...clone(good), extracted_at: '2026-09-27T00:00:00+00:00' })],
        'a block from another commit than the summary': [{}, summaryWith({ ...clone(good), pipeline_commit: 'abc' })],
        'a block without a commit': [{}, summaryWith((() => { const b = clone(good); delete b.pipeline_commit; return b; })())],
        'a summary from another run than data/run.json': [{}, summaryWith(clone(good)), { ...RUN, extracted_at: '2026-10-11T00:00:00+00:00' }],
        'a summary from another commit than data/run.json': [{}, summaryWith(clone(good)), { ...RUN, pipeline_commit: 'abc' }],
        'another study type': [{}, summaryWith({ ...clone(good), filter: { ...good.filter, study_type: 'OBSERVATIONAL' } })],
        'another first year': [{}, summaryWith({ ...clone(good), filter: { ...good.filter, results_year_from: 2010 } })],
        'an upper year bound': [{}, summaryWith({ ...clone(good), filter: { ...good.filter, results_year_to: 2026 } })],
        'other filters': [{}, summaryWith({ ...clone(good), filter: { ...good.filter, other_filters: 'sponsor' } })],
        'a filter-less block': [{}, summaryWith((() => { const b = clone(good); delete b.filter; return b; })())],
        'a count that is not whole': [{}, summaryWith({ ...clone(good), trials_reporting_race: 1.5 })],
        'a negative count': [{}, summaryWith({ ...clone(good), trials_reporting_ethnicity: -1 })],
        'a count as a string': [{}, summaryWith({ ...clone(good), trials: String(good.trials) })],
        'a numerator over its trials': [{}, summaryWith({ ...clone(good), trials_reporting_race: good.trials + 1 })],
        'a year\'s numerator over its trials': [{}, summaryWith((() => {
            // the years still add up, and the whole stays within its trials
            const b = clone(good);
            b.by_results_year['2010'].trials_reporting_race += b.by_results_year['2010'].trials;
            b.trials_reporting_race += b.by_results_year['2010'].trials;
            assert.ok(b.trials_reporting_race <= b.trials);
            return b;
        })())],
        'no trials': [{}, summaryWith({ ...clone(good), trials: 0, trials_reporting_race: 0, trials_reporting_ethnicity: 0, trials_reporting_race_and_ethnicity: 0, by_results_year: {} })],
        'years that do not add up': [{}, summaryWith((() => { const b = clone(good); b.by_results_year['2010'].trials_reporting_race++; return b; })())],
        'a year with no trials': [{}, summaryWith((() => {
            // inside the window, and adding nothing to the whole
            const b = { ...clone(good), newest_results_year: 2027 };
            b.by_results_year['2027'] = { trials: 0, trials_reporting_race: 0, trials_reporting_ethnicity: 0, trials_reporting_race_and_ethnicity: 0 };
            return b;
        })())],
        'a year key that is not a year': [{}, summaryWith((() => { const b = clone(good); b.by_results_year['20x6'] = b.by_results_year['2026']; delete b.by_results_year['2026']; return b; })())],
        'a year before the first': [{}, summaryWith((() => { const b = clone(good); b.by_results_year['2008'] = b.by_results_year['2009']; delete b.by_results_year['2009']; return b; })())],
        'a year after the newest': [{}, summaryWith({ ...clone(good), newest_results_year: 2025 })],
        'no newest year': [{}, summaryWith((() => { const b = clone(good); delete b.newest_results_year; return b; })())],
        'another denominator': [{}, summaryWith({ ...clone(good), denominators: { ...good.denominators, trials_reporting_ethnicity: 'trials_reporting_race' } })],
        'no denominators': [{}, summaryWith((() => { const b = clone(good); delete b.denominators; return b; })())],
        'a block that is a list': [{}, summaryWith([])],
        'the records already in': [{}, summaryWith(clone(good)), null, (p) => p.run('data = []')],
        'a summary already on screen': [{}, summaryWith(clone(good)), null, (p) => p.run('dashboardSummary = {}')],
        'the startup load already over': [{}, summaryWith(clone(good)), null, (p) => p.run('firstViewClosed = true')],
        'the sponsor filter restored by the browser': [{}, summaryWith(clone(good)), null, (p) => { p.el('sponsor-class').value = 'INDUSTRY'; }],
        'the study type restored by the browser': [{}, summaryWith(clone(good)), null, (p) => { p.el('study-type').value = 'all'; }],
        'the year thumb restored by the browser': [{}, summaryWith(clone(good)), null, (p) => { p.el('year-end').value = '2020'; }],
        'the start thumb moved': [{}, summaryWith(clone(good)), null, (p) => { p.el('year-start').value = '2012'; }],
        'the AI checkbox ticked': [{}, summaryWith(clone(good)), null, (p) => { p.el('ai-study-filter').checked = true; }],
        'a participant floor': [{}, summaryWith(clone(good)), null, (p) => { p.el('min-participants').value = '10'; }],
        'a ?sg=v2 filter set': [{}, summaryWith(clone(good)), null, (p) => { p.el('sg-status').value = p.el('sg-status').options.at(-1).value; }]
    };
    for (const [name, [opts, summary = summaryWith(clone(good)), run = null, before]] of Object.entries(no)) {
        const why = problem(opts, summary, run, before);
        assert.equal(typeof why, 'string', `${name}: the first view would paint`);
    }
});

// PR #256 opens a link's snapshot in place of the latest data, or the latest
// data, silently, when history.json does not list the date or it is
// malformed. Either way the link names sgsnapshot, and the first view stays
// off: one rule for every form of the link, whatever startup then opens. A
// late data/run.json changes nothing: the newest date's re-read of it
// (recheckRun) only runs on such a link, so no first view is up beside it.
test('any link naming sgsnapshot keeps the first view off, listed or not, with run.json on time or late', async () => {
    const records = syntheticRecords();
    const forms = ['2026-08-02', '2026-10-04', '2026-07-05', '2026-7-5', 'latest', ''];
    for (const runStamp of [RUN.extracted_at, null]) {
        for (const date of forms) {
            for (const where of [{ search: `?sgsnapshot=${date}` }, { hash: `#overview?sgsnapshot=${date}` }, { hash: `#overview?sg=v2&sgsnapshot=${date}` }]) {
                const name = `${JSON.stringify(where)} run.json ${runStamp ? 'on time' : 'late'}`;
                const p = page({ ...where, runStamp, run: runStamp ? RUN : null });
                const s = summaryWith(blockFor(records));
                assert.equal(await p.run('firstViewOrFigure')(s), false, `${name}: the first view painted`);
                assert.deepEqual(p.figures, [s], `${name}: the loading screen's figure did not draw`);
                assert.deepEqual(p.infos.map((a) => a.join(' ')), ['The Overview waits for the records: the link sets sgsnapshot'], name);
                assert.equal(p.trendCharts().length, 0, name);
                assert.equal(p.el('records-pending').hidden, true, name);
                assert.equal(p.el('loading-overlay').classList.contains('fade-out'), false, name);
            }
        }
    }
});

test('the first view reads data/run.json only once it has answered, and stays off when it names another run', async () => {
    const records = syntheticRecords();
    const summary = () => summaryWith(blockFor(records));
    const other = {
        'another extracted_at': { ...RUN, extracted_at: '2026-10-11T12:00:00+00:00' },
        'another pipeline_commit': { ...RUN, pipeline_commit: 'abc' }
    };
    // data/run.json answered (LATEST_RUN_STAMP set) and names another run:
    // the loading screen's figure, nothing painted, and the console says why.
    for (const [name, run] of Object.entries(other)) {
        const p = page({ runStamp: run.extracted_at, run });
        const s = summary();
        assert.equal(await p.run('firstViewOrFigure')(s), false, `${name}: the first view painted`);
        assert.equal(p.context.__runAsked, 1, `${name}: data/run.json was not read`);
        assert.deepEqual(p.figures, [s], `${name}: the figure did not draw`);
        assert.deepEqual(p.infos.map((a) => a.join(' ')), ['The Overview waits for the records: the summary is not from the run data/run.json names'], name);
        assert.equal(p.trendCharts().length, 0);
        assert.equal(p.rootClasses.size, 0);
        assert.equal(p.el('records-pending').hidden, true);
        assert.ok(!p.context.document.querySelector('.tab[data-tab="race"]').disabled);
    }
    // It answered and names this run: the first view paints.
    const same = page({ runStamp: RUN.extracted_at, run: RUN });
    assert.equal(await same.run('firstViewOrFigure')(summary()), true);
    assert.equal(same.context.__runAsked, 1);
    // It never answered (LATEST_RUN_STAMP null): nothing to hold the summary
    // to, and no new request for it; the first view paints, even though the
    // file would now name another run.
    const never = page({ runStamp: null, run: other['another extracted_at'] });
    assert.equal(await never.run('firstViewOrFigure')(summary()), true, 'a run.json that never answered holds the first view');
    assert.equal(never.context.__runAsked, undefined, 'data/run.json was asked for again');
    assert.deepEqual(never.infos, []);
    // The wiring, as app.js writes it.
    assert.match(fnSource('async function firstViewOrFigure(summary)'), /const run = LATEST_RUN_STAMP \? await fetchRun\(\) : null;/);
});

test('the year window is sized to the block\'s newest year before it is checked', async () => {
    const records = [...syntheticRecords(), rec(2027, 'INTERVENTIONAL', true, false)];
    const block = blockFor(records);
    assert.equal(block.newest_results_year, 2027);
    const p = page();
    assert.equal(p.el('year-end').max, '2026', 'index.html\'s slider no longer ends at 2026: this test needs a later year');
    assert.equal(await p.run('firstViewOrFigure')(summaryWith(block)), true, 'a newer year than the markup\'s turns the first view off');
    assert.equal(p.el('year-end').max, '2027');
    assert.equal(p.el('year-end').value, '2027');
    assert.match(p.text('filter-summary-text').html, /results posted <b>2009–2027<\/b>/);
    assert.equal(p.text('stat-sub-total').text, 'results posted 2009–2027');
    // The records size it the same way: nothing moves when they arrive.
    const painted = p.overview();
    p.loadRecords(records);
    p.run('settleFirstView()');
    assert.deepEqual(p.warnings, []);
    assert.deepEqual(p.overview(), painted);
});

// ── 3. The hand-over ───────────────────────────────────────────────────────

const WAITING = ['.tab:not([data-tab="overview"])', '#filter-summary-toggle', '#history-date'];

test('equal records leave the first view as it is; the rest of the page opens', async () => {
    const records = syntheticRecords();
    const p = page();
    const tabs = p.context.document.querySelectorAll('.tab');
    assert.ok(tabs.length > 10, 'index.html lost its tabs');
    assert.equal(await p.run('firstViewOrFigure')(summaryWith(blockFor(records))), true);
    assert.deepEqual(p.figures, [], 'the loading figure drew under the first view');
    assert.ok(p.el('loading-overlay').classList.contains('fade-out'), 'the loading screen stays up');
    // Waiting for the records.
    for (const sel of WAITING) {
        for (const el of p.context.document.querySelectorAll(sel)) {
            assert.ok(el.disabled, `${sel} is open before the records`);
            assert.equal(el.getAttribute('aria-disabled'), 'true');
        }
    }
    const overviewTab = p.context.document.querySelector('.tab[data-tab="overview"]');
    assert.ok(!overviewTab.disabled, 'the Overview tab is disabled');
    const strip = p.el('records-pending');
    assert.equal(strip.hidden, false, 'no status strip');
    assert.equal(strip.getAttribute('role'), 'status');
    assert.ok(strip.querySelector('.loading-meter'), 'the strip has no hairline meter');
    assert.equal(strip.querySelectorAll('.dashboard-loading-spinner, .spinner').length, 0, 'the strip has a ring');
    assert.match(strip.querySelector('.records-pending-text').textContent, /other tabs and the filters open when they arrive/);
    assert.ok(p.rootClasses.has('first-view-pending'));
    // Provenance, from the summary's run: the masthead's date as loadData
    // writes it from the parts, and the footer's pulled date.
    assert.equal(p.el('last-updated').textContent, new Date(RUN.extracted_at).toLocaleDateString());
    assert.equal(p.context.window.__dataExtractedAt, RUN.extracted_at.slice(0, 10));

    const painted = p.overview();
    assert.equal(p.trendCharts().length, 1);
    p.loadRecords(records);
    // renderDashboard ran its spinner; styles.css keeps it hidden while the
    // root class stands, which outlasts the frame that hides it.
    assert.equal(p.el('dashboard-loading').style.display, 'flex');
    p.run('settleFirstView()');
    assert.ok(p.rootClasses.has('first-view-pending'), 'the spinner can flash: the class went before its frame');
    p.flushFrames();
    assert.equal(p.el('dashboard-loading').style.display, 'none');
    assert.ok(!p.rootClasses.has('first-view-pending'));
    assert.equal(p.trendCharts().length, 1, 'the records rebuilt a chart with the same numbers (its draw-in replays)');
    assert.deepEqual(p.warnings, []);
    assert.deepEqual(p.overview(), painted);
    for (const sel of WAITING) {
        for (const el of p.context.document.querySelectorAll(sel)) {
            assert.ok(!el.disabled, `${sel} stays closed after the records`);
            assert.equal(el.getAttribute('aria-disabled'), null);
            assert.equal(el.getAttribute('title'), null, `${sel} keeps the waiting tooltip`);
        }
    }
    assert.ok(strip.classList.contains('is-done'));
    assert.match(strip.querySelector('.records-pending-text').textContent, /Trial records loaded/);
    assert.equal(strip.getAttribute('data-load-progress'), null, 'later loads still drive the strip');
    p.timers.forEach((fn) => fn());
    assert.equal(strip.hidden, true, 'the strip stays');

    // Later filter renders draw as always: a new chart, animated.
    p.el('study-type').value = 'all';
    p.run('renderDashboard()');
    const charts = p.trendCharts();
    assert.equal(charts.length, 2);
    assert.equal(charts[1].config.options.animation, undefined, 'a filter change after the hand-over does not animate');
});

test('keyboard focus on a control the first view closes moves to the Overview tab, not to <body>', async () => {
    const p = page();
    const doc = p.context.document;
    const race = doc.querySelector('.tab[data-tab="race"]');
    race.focus();
    assert.equal(doc.activeElement, race);
    await p.run('firstViewOrFigure')(summaryWith(blockFor(syntheticRecords())));
    assert.ok(race.disabled);
    assert.equal(doc.activeElement, doc.querySelector('.tab[data-tab="overview"]'), `focus went to ${doc.activeElement.tagName}`);
    // Focus elsewhere stays where it is.
    const q = page();
    const studyType = q.el('study-type');
    studyType.focus();
    await q.run('firstViewOrFigure')(summaryWith(blockFor(syntheticRecords())));
    assert.equal(q.context.document.activeElement, studyType);
});

test('the archive selector lists its dates while it waits, as it lists them after: the masthead does not reflow at the swap', async () => {
    // Between about 905 and 925 px a selector that widened at the swap (from
    // "Latest" to "YYYY-MM-DD (latest)") wrapped the masthead to a second
    // row and moved the Overview down 54 px.
    const history = { dates: ['2026-02-22', '2026-08-02', '2026-10-04'] };
    const records = syntheticRecords();
    const p = page({ history, runDate: '2026-10-04' });
    const select = p.el('history-date');
    const listed = (el) => el.options.map((o) => [o.value, o.text]);
    assert.deepEqual(listed(select), [['latest', 'Latest']]);
    assert.equal(await p.run('firstViewOrFigure')(summaryWith(blockFor(records))), true);
    await tick();
    const during = listed(select);
    assert.deepEqual(during, [['latest', 'Latest'], ['2026-10-04', '2026-10-04 (latest)'], ['2026-08-02', '2026-08-02'], ['2026-02-22', '2026-02-22']],
        'the selector does not list its dates while it waits: it widens at the swap');
    assert.ok(select.disabled, 'the selector opened before the records');
    assert.equal(select.value, 'latest');
    // The records arrive and startup lists the dates as it always has:
    // nothing is listed twice.
    p.loadRecords(records);
    p.run('settleFirstView()');
    await p.run('initHistorySelector()');
    assert.deepEqual(listed(select), during, 'initHistorySelector listed the dates a second time');
    assert.ok(!select.disabled);
    assert.equal(select.value, 'latest');
    // Without the first view, the dates wait for initHistorySelector, as before.
    const q = page({ history, runDate: '2026-10-04' });
    assert.equal(await q.run('firstViewOrFigure')(summaryWith(undefined)), false);
    await tick();
    assert.deepEqual(listed(q.el('history-date')), [['latest', 'Latest']]);
    // A date history.json names twice is listed once.
    const twice = page({ history: { dates: ['2026-08-02', '2026-08-02', '2026-10-04'] }, runDate: '2026-10-04' });
    assert.equal(await twice.run('firstViewOrFigure')(summaryWith(blockFor(records))), true);
    await tick();
    assert.deepEqual(listed(twice.el('history-date')).map(([v]) => v), ['latest', '2026-10-04', '2026-08-02']);
    // A history.json that did not answer lists nothing.
    const r = page({ history: null });
    assert.equal(await r.run('firstViewOrFigure')(summaryWith(blockFor(records))), true);
    await tick();
    assert.deepEqual(listed(r.el('history-date')), [['latest', 'Latest']]);
});

test('different records repaint the Overview without animation, and warn', async () => {
    const records = syntheticRecords();
    const block = blockFor(records);
    const p = page();
    assert.equal(await p.run('firstViewOrFigure')(summaryWith(block)), true);
    const painted = p.overview();
    const changed = clone(records);
    changed.find((r) => r.study_type === 'INTERVENTIONAL' && !r.race.reported).race.reported = true;
    p.loadRecords(changed);
    p.run('settleFirstView()');
    const charts = p.trendCharts();
    assert.equal(charts.length, 2, 'the chart was not redrawn from the records');
    assert.equal(charts[1].config.options.animation, false, 'the repaint animates');
    assert.equal(p.warnings.length, 1, 'no warning, or more than one');
    assert.match(String(p.warnings[0][0]), /differs from the trial records/);
    const now = p.overview();
    assert.notDeepEqual(now['race-reporting'], painted['race-reporting']);
    assert.equal(now['race-reporting'].text, `${(((block.trials_reporting_race + 1) / block.trials) * 100).toFixed(1)}%`);
    assert.ok(!p.context.document.querySelector('.tab[data-tab="race"]').disabled);
});

test('records that differ only in the chart redraw the chart without animation, keep the tiles, and warn once', async () => {
    // One trial moves from one results year to the next: every total, and
    // so every tile and line of text, is unchanged; two years of the trend
    // chart are not.
    const records = syntheticRecords();
    const block = blockFor(records);
    const p = page();
    assert.equal(await p.run('firstViewOrFigure')(summaryWith(block)), true);
    const painted = p.overview();
    const moved = clone(records);
    const trial = moved.find((r) => r.study_type === 'INTERVENTIONAL' && r.results_date.startsWith('2010-'));
    trial.results_date = '2011-05-01';
    const after = blockFor(moved);
    for (const k of FIRST_VIEW_TOTALS) assert.equal(after[k], block[k], `moving the trial changed ${k}`);
    assert.notDeepEqual(after.by_results_year, block.by_results_year);
    p.loadRecords(moved);
    p.run('settleFirstView()');
    const charts = p.trendCharts();
    assert.equal(charts.length, 2, 'the chart kept the block\'s years');
    assert.equal(charts[0].destroyed, true);
    assert.equal(charts[1].config.options.animation, false, 'the redraw animates');
    const now = p.overview();
    for (const id of Object.keys(now).filter((k) => k !== 'chart')) assert.deepEqual(now[id], painted[id], `#${id} changed`);
    // The chart now draws the records' years: the same years, and in the
    // two the trial moved between, the records' shares.
    assert.deepEqual(now.chart.labels, painted.chart.labels);
    const race = now.chart.series.find((x) => x.label === 'Race').data;
    for (const y of ['2010', '2011']) {
        const c = after.by_results_year[y];
        assert.equal(race[now.chart.labels.indexOf(y)], (c.trials_reporting_race / c.trials) * 100, `${y} is not the records'`);
        assert.notEqual(race[now.chart.labels.indexOf(y)], (block.by_results_year[y].trials_reporting_race / block.by_results_year[y].trials) * 100);
    }
    assert.equal(p.warnings.length, 1, `${p.warnings.length} warnings`);
    assert.match(String(p.warnings[0][0]), /differs from the trial records/);
    assert.ok(!p.context.document.querySelector('.tab[data-tab="race"]').disabled);
});

test('a first view that cannot finish painting takes back what it did: the loading screen and the records, as without it', async () => {
    const records = syntheticRecords();
    const breaks = {
        'the masthead has no #last-updated': (p) => { p.byId.delete('last-updated'); },
        'the finding painter throws once': (p) => {
            p.run('renderOverviewFinding = function (...args) { renderOverviewFinding = function (...a) { __finding.push(a); return __siteFinding(...a); }; throw new Error(\'finding\'); };');
        },
        // After the controls have closed and the strip is up.
        'the loading screen will not hide': (p) => { p.context.hideLoadingOverlay = () => { throw new Error('overlay'); }; }
    };
    for (const [name, breakIt] of Object.entries(breaks)) {
        const p = page();
        breakIt(p);
        const s = summaryWith(blockFor(records));
        assert.equal(await p.run('firstViewOrFigure')(s), false, `${name}: it says it painted`);
        assert.deepEqual(p.figures, [s], `${name}: the loading screen's figure did not draw`);
        assert.match(String(p.warnings[0] && p.warnings[0][0]), /could not paint from the summary/, name);
        assert.equal(p.run('firstViewShown'), null, name);
        // At once, not a frame later: the records' render shows its spinner as always.
        assert.ok(!p.rootClasses.has('first-view-pending'), `${name}: the root keeps first-view-pending`);
        const strip = p.el('records-pending');
        assert.equal(strip.hidden, true, `${name}: the strip is up`);
        assert.ok(!strip.classList.contains('is-done'), `${name}: the strip says the records loaded`);
        assert.doesNotMatch(strip.querySelector('.records-pending-text').textContent, /loaded/, name);
        for (const sel of WAITING) {
            for (const el of p.context.document.querySelectorAll(sel)) {
                assert.ok(!el.disabled, `${name}: ${sel} is left disabled`);
                assert.equal(el.getAttribute('aria-disabled'), null, name);
                assert.equal(el.getAttribute('title'), null, name);
            }
        }
        // The records then draw as they do without a first view: a chart of
        // their own, animated, and no warning that they differ.
        p.loadRecords(records);
        p.run('settleFirstView()');
        const live = p.trendCharts().filter((c) => !c.destroyed);
        assert.equal(live.length, 1, name);
        assert.equal(live[0].config.options.animation, undefined, `${name}: the records' chart does not animate`);
        assert.equal(p.warnings.length, 1, `${name}: ${p.warnings.map((w) => w[0]).join(' | ')}`);
    }
});

test('controls closed before the first view stay closed after it', async () => {
    const records = syntheticRecords();
    const p = page();
    const beta = p.context.document.querySelector('.tab[data-tab="approval-queue"]');
    beta.disabled = true;
    beta.title = 'Not yet';
    await p.run('firstViewOrFigure')(summaryWith(blockFor(records)));
    p.loadRecords(records);
    p.run('settleFirstView()');
    assert.ok(beta.disabled);
    assert.equal(beta.title, 'Not yet');
});

test('controls a browser restored disabled across a reload open when the records arrive; ones closed on purpose stay closed', async () => {
    // Firefox keeps a button's disabled state across a reload: a refresh
    // during the wait brings the waiting controls back disabled, without
    // the marks setRecordsPending puts on them.
    const records = syntheticRecords();
    const p = page();
    const doc = p.context.document;
    const waiting = WAITING.flatMap((sel) => doc.querySelectorAll(sel));
    for (const el of waiting) el.disabled = true;
    // One the page means to keep closed, and the filter panel's
    // subcategory, which the app closes until a category is chosen.
    const kept = doc.querySelector('.tab[data-tab="approval-queue"]');
    kept.setAttribute('data-stays-disabled', '');
    const sub = p.el('condition-secondary');
    sub.disabled = true;
    // Startup, as app.js runs it: the restored state is cleared first.
    assert.ok(STARTUP.indexOf('clearRestoredDisabled();') >= 0 && STARTUP.indexOf('clearRestoredDisabled();') < STARTUP.indexOf('fetchLatestSummary().then(firstViewOrFigure,'),
        'startup does not clear a restored disabled state before the first view can paint');
    p.run('clearRestoredDisabled()');
    assert.equal(await p.run('firstViewOrFigure')(summaryWith(blockFor(records))), true);
    p.loadRecords(records);
    p.run('settleFirstView()');
    for (const el of waiting) {
        if (el === kept) continue;
        assert.ok(!el.disabled, `${el.getAttribute('data-tab') || el.id} stays disabled after the records arrive`);
    }
    assert.ok(kept.disabled, 'a control marked data-stays-disabled was opened');
    assert.ok(sub.disabled, 'the condition subcategory was opened');
    // And Firefox is told not to keep the state: in the markup, and on
    // whatever setRecordsPending disables.
    for (const el of waiting) assert.equal(el.getAttribute('autocomplete'), 'off', `${el.getAttribute('data-tab') || el.id} has no autocomplete="off"`);
});

test('a failed load after the first view says so in the strip and keeps the rest closed', async () => {
    const p = page();
    await p.run('firstViewOrFigure')(summaryWith(blockFor(syntheticRecords())));
    p.run('firstViewFailed')(new Error('Could not load data for latest: HTTP 503'));
    const strip = p.el('records-pending');
    assert.equal(strip.hidden, false);
    assert.equal(strip.getAttribute('role'), 'alert');
    assert.ok(strip.classList.contains('is-failed'));
    assert.equal(strip.querySelector('.loading-meter').hidden, true);
    assert.match(strip.querySelector('.records-pending-text').textContent, /HTTP 503\. Refresh the page to try again\./);
    assert.ok(p.context.document.querySelector('.tab[data-tab="race"]').disabled);
    assert.equal(p.run('firstViewShown'), null);
    // The waiting controls no longer promise to open: their tooltip says
    // what the strip says.
    let closed = 0;
    for (const sel of WAITING) {
        for (const el of p.context.document.querySelectorAll(sel)) {
            if (!el.disabled) continue;
            closed++;
            assert.equal(el.title, 'Unavailable: the trial records did not load.', `${sel} still says it opens when the records load`);
        }
    }
    assert.ok(closed >= 14, `only ${closed} controls stayed closed`);
});

test('while the strip is up the page ends above it, so the footer\'s last link is not under it', async () => {
    const records = syntheticRecords();
    const p = page();
    assert.equal(await p.run('firstViewOrFigure')(summaryWith(blockFor(records))), true);
    const strip = p.el('records-pending');
    assert.equal(p.observers.length, 1, 'nothing follows the strip\'s height');
    assert.equal(p.observers[0].target, strip);
    strip.offsetHeight = 37;
    p.observers[0].fire();
    assert.equal(p.rootStyle['--records-pending-height'], '37px');
    // A failure says more, and the line wraps.
    p.run('firstViewFailed')(new Error(HTTP_404), () => {});
    strip.offsetHeight = 57;
    p.observers[0].fire();
    assert.equal(p.rootStyle['--records-pending-height'], '57px');
    // The strip shown again follows with the same observer.
    p.run('setRecordsPending(true)');
    assert.equal(p.observers.length, 1, 'a second observer');
    // The records arrive and the strip goes after its moment: so does the padding.
    p.loadRecords(records);
    p.run('settleFirstView()');
    p.timers.forEach((fn) => fn());
    assert.equal(strip.hidden, true);
    p.observers[0].fire();
    assert.equal(p.rootStyle['--records-pending-height'], '0px');
    // styles.css pads the page by it; without it (no first view) by nothing.
    const css = read('styles.css');
    assert.match(css, /\nhtml \{ scroll-padding-bottom: var\(--records-pending-height, 0px\); \}/);
    assert.match(css, /\nbody \{ padding-bottom: var\(--records-pending-height, 0px\); \}/);
    const q = page();
    assert.equal(await q.run('firstViewOrFigure')(summaryWith(undefined)), false);
    assert.equal(q.observers.length, 0);
});

test('a failed load on the loading screen keeps its error: parts still in flight do not write over it', async () => {
    const p = page();
    // The loading screen's own writer, as the parts loop calls it.
    p.run(fnSource("function updateLoadingProgress(percent, statusText, bytesText = '')").replace('function updateLoadingProgress', 'function __writeProgress'));
    p.run('var loadingSample = { fill() {} };');
    const overlay = p.el('loading-overlay');
    const status = p.el('loading-status');
    p.run('__writeProgress')(40, 'Loading trial records', '60 of 152 MB');
    assert.equal(status.textContent, 'Loading trial records');
    p.run('startupFailed')(new Error('Could not load data for latest: Failed to fetch data/demographics.part3.json.gz: HTTP 404'));
    assert.match(status.textContent, /^Error: .*HTTP 404\. Please refresh the page\.$/);
    // A part still downloading reports its bytes a frame later.
    p.run('__writeProgress')(55, 'Loading trial records', '90 of 152 MB');
    assert.match(status.textContent, /HTTP 404/, 'a part still in flight wrote "Loading trial records" over the error');
    assert.equal(overlay.getAttribute('data-load-progress'), null);
    assert.equal(p.run('firstViewClosed'), true, 'a summary that answers later could still paint over the error');
});

// loadData for loadStartupRecords: fails with each error in turn, then
// loads the records.
function loadDataFailing(p, records, ...errors) {
    p.context.__loadErrors = errors;
    p.context.__records = records;
    p.run('var __loads = 0; loadData = async function () { __loads++; const e = __loadErrors.shift(); if (e) throw e; data = __records; };');
}
const tick = () => new Promise((r) => setImmediate(r));
const HTTP_404 = 'Could not load data for latest: Failed to fetch data/demographics.part3.json.gz: HTTP 404';

test('a failed load under the first view offers Try again, which loads the records and opens the page', async () => {
    const records = syntheticRecords();
    const p = page();
    const doc = p.context.document;
    assert.equal(await p.run('firstViewOrFigure')(summaryWith(blockFor(records))), true);
    loadDataFailing(p, records, new Error(HTTP_404));
    const loading = p.run('loadStartupRecords()');
    await tick();
    const strip = p.el('records-pending');
    const again = strip.querySelector('.records-pending-retry');
    assert.ok(again, 'index.html has no Try again button in the strip');
    assert.ok(strip.classList.contains('is-failed'));
    assert.equal(again.hidden, false, 'the strip offers no Try again');
    assert.equal(strip.querySelector('.records-pending-text').textContent, `Loading stopped: ${HTTP_404}.`);
    assert.equal(p.run('firstViewClosed'), true);
    assert.ok(p.run('firstViewShown'), 'the first view forgot it is on screen: a retry could not hand it over');
    const race = doc.querySelector('.tab[data-tab="race"]');
    assert.ok(race.disabled);
    assert.equal(race.title, 'Unavailable: the trial records did not load.');
    // Try again.
    again.click();
    await Promise.resolve();   // the load's await hands back to loadStartupRecords
    assert.equal(again.hidden, true);
    assert.ok(!strip.classList.contains('is-failed'));
    assert.equal(strip.getAttribute('role'), 'status');
    assert.equal(strip.querySelector('.loading-meter').hidden, false);
    assert.equal(strip.getAttribute('data-load-progress'), '', 'the strip no longer follows the load');
    assert.equal(strip.querySelector('.records-pending-text').textContent, 'The other tabs and the filters open when they arrive.');
    assert.equal(race.title, 'Opens when the trial records have loaded');
    await loading;
    assert.equal(p.run('__loads'), 2);
    // Startup goes on from the load: the records draw and the page opens.
    p.run('initFilters(); renderDashboard(); settleFirstView();');
    p.flushFrames();
    for (const sel of WAITING) {
        for (const el of doc.querySelectorAll(sel)) {
            assert.ok(!el.disabled, `${sel} stays closed after a retry loaded the records`);
            assert.equal(el.getAttribute('title'), null, `${sel} keeps a waiting tooltip`);
        }
    }
    assert.ok(strip.classList.contains('is-done'));
    assert.deepEqual(p.warnings, []);
});

test('a failed load on the loading screen offers Try again there too', async () => {
    const records = syntheticRecords();
    const p = page();
    loadDataFailing(p, records, new Error(HTTP_404), new Error(HTTP_404));
    const loading = p.run('loadStartupRecords()');
    await tick();
    const overlay = p.el('loading-overlay');
    const status = p.el('loading-status');
    const again = p.el('loading-retry');
    assert.ok(again, 'index.html has no Try again button on the loading screen');
    assert.equal(status.textContent, `Loading stopped: ${HTTP_404}.`);
    assert.equal(overlay.getAttribute('data-load-progress'), null);
    assert.equal(overlay.querySelector('.loading-bytes').textContent, '', 'the megabytes of a stopped load stay on screen');
    assert.equal(again.hidden, false);
    again.click();
    await Promise.resolve();   // the load's await hands back to loadStartupRecords
    assert.equal(again.hidden, true);
    assert.equal(overlay.getAttribute('data-load-progress'), '', 'the loading screen no longer follows the load');
    assert.equal(status.style.color, '');
    await tick();
    // Failed again: offered again.
    assert.equal(again.hidden, false);
    again.click();
    await loading;
    assert.equal(p.run('__loads'), 3);
    assert.equal(p.run('data.length'), records.length);
    // A layout the page cannot read is refused, not offered again.
    const q = page();
    const refused = Object.assign(new Error('layout 9'), { layoutRefused: true });
    loadDataFailing(q, records, refused);
    await assert.rejects(q.run('loadStartupRecords()'), /layout 9/);
    assert.equal(q.el('loading-retry').hidden, true);
});

test('after a failed load, About and FAQ open (they need no records), and the Overview tab returns', async () => {
    const p = page();
    const doc = p.context.document;
    await p.run('firstViewOrFigure')(summaryWith(blockFor(syntheticRecords())));
    const tab = (name) => doc.querySelector(`.tab[data-tab="${name}"]`);
    tab('about').click();
    assert.ok(!tab('about').classList.contains('active'), 'About opened while the records were still loading');
    p.run('firstViewFailed')(new Error(HTTP_404));
    for (const name of ['about', 'faq']) {
        assert.ok(!tab(name).disabled, `${name} stays closed after a failed load`);
        assert.equal(tab(name).getAttribute('aria-disabled'), null);
        assert.equal(tab(name).getAttribute('title'), null);
    }
    assert.ok(tab('race').disabled);
    tab('about').click();
    assert.ok(tab('about').classList.contains('active'));
    assert.ok(!tab('overview').classList.contains('active'));
    assert.ok(!p.el('overview').classList.contains('active'));
    assert.equal(p.el('filter-summary').style.display, 'none', 'the filter summary shows on About');
    tab('faq').click();
    assert.ok(tab('faq').classList.contains('active') && !tab('about').classList.contains('active'));
    tab('overview').click();
    assert.ok(tab('overview').classList.contains('active'));
    assert.ok(p.el('overview').classList.contains('active'));
    assert.equal(p.el('filter-summary').style.display, '');
    // A second failure wires nothing twice.
    p.run('firstViewFailed')(new Error(HTTP_404));
    assert.equal(tab('about').listeners.click.length, 1);
});

test('a deep-link hook that clicks a waiting control finds it open: ?sgfilters=1 opens the filters', async () => {
    const records = syntheticRecords();
    const p = page({ search: '?sgfilters=1' });
    assert.equal(await p.run('firstViewOrFigure')(summaryWith(blockFor(records))), true, '?sgfilters=1 no longer paints the first view');
    const panel = p.el('filters'), toggle = p.el('filter-summary-toggle');
    assert.ok(panel.hidden, 'index.html opens the filter panel');
    assert.ok(toggle.disabled, 'the Filters button is open before the records');
    // As in a browser: HTMLElement.click() does nothing on a disabled control.
    toggle.click = () => {
        if (toggle.disabled) return;
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
    };
    p.context.__records = records;
    p.run('data = __records; initFilters();');
    p.run(STARTUP_TAIL);
    assert.ok(!toggle.disabled);
    assert.equal(panel.hidden, false, 'the ?sgfilters=1 link clicked the Filters button while it still waited for the records');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(p.warnings, []);
});

test('the nav menus behave as menus from the start, before the records arrive', () => {
    const wire = STARTUP.indexOf('initNavGroups();');
    assert.ok(wire >= 0, 'startup does not wire the nav menus');
    assert.ok(wire < STARTUP.indexOf('fetchLatestSummary().then(firstViewOrFigure,'), 'the nav menus are wired after the first view can paint');
    assert.doesNotMatch(fnSource('function initTabs()'), /addEventListener\('(toggle|keydown)'/, 'initTabs wires the nav menus a second time');
    // Three menus over a stub document: one open at a time, an outside
    // click closes them, Escape closes the open one and returns focus.
    const docListeners = {};
    const focused = [];
    const groups = ['demographics', 'context', 'tools'].map((id) => {
        const listeners = {};
        const summary = { focus: () => focused.push(id) };
        const g = {
            id, attrs: {}, listeners,
            get open() { return 'open' in this.attrs; }, set open(v) { if (v) this.attrs.open = ''; else delete this.attrs.open; },
            removeAttribute(n) { delete this.attrs[n]; },
            addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
            querySelector: (sel) => (sel === 'summary' ? summary : null)
        };
        return g;
    });
    const sandbox = {
        document: {
            querySelectorAll: (sel) => (sel === '.nav-group' ? groups : []),
            querySelector: (sel) => (sel === '.nav-group[open]' ? groups.find((g) => g.open) ?? null : null),
            addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); }
        }
    };
    vm.runInContext([fnSource('function closeNavGroups(except)'), fnSource('function initNavGroups()'), 'initNavGroups();'].join('\n'),
        vm.createContext(sandbox));
    const openGroup = (g) => { g.open = true; g.listeners.toggle.forEach((fn) => fn()); };
    const openOnes = () => groups.filter((g) => g.open).map((g) => g.id);
    openGroup(groups[0]);
    openGroup(groups[1]);
    assert.deepEqual(openOnes(), ['context'], 'opening a menu leaves another open');
    docListeners.click.forEach((fn) => fn({ target: { closest: () => null } }));
    assert.deepEqual(openOnes(), [], 'a click outside leaves a menu open');
    openGroup(groups[2]);
    docListeners.click.forEach((fn) => fn({ target: { closest: (sel) => (sel === '.nav-group' ? groups[2] : null) } }));
    assert.deepEqual(openOnes(), ['tools'], 'a click inside a menu closes it');
    docListeners.keydown.forEach((fn) => fn({ key: 'Escape' }));
    assert.deepEqual(openOnes(), [], 'Escape leaves the menu open');
    assert.deepEqual(focused, ['tools'], 'Escape does not return focus to the menu heading');
});

// ── 4. Off, and without the block: as before ───────────────────────────────

for (const [name, opts, summary] of [
    ['?firstview=0', { search: '?firstview=0' }, () => summaryWith(blockFor(syntheticRecords()))],
    ['a summary without the block', {}, () => summaryWith(undefined)],
    ['a phone', { mobile: true }, () => summaryWith(blockFor(syntheticRecords()))]
]) {
    test(`${name}: the loading screen draws its figure and nothing else changes`, async () => {
        const p = page(opts);
        const s = summary();
        const before = JSON.stringify([...p.byId.entries()].map(([id, el]) => [id, el.textContent, el.innerHTML, el.disabled, el.hidden, el.value, el.max]));
        assert.equal(await p.run('firstViewOrFigure')(s), false);
        assert.deepEqual(p.figures, [s], 'the figure did not draw from the summary');
        const after = JSON.stringify([...p.byId.entries()].map(([id, el]) => [id, el.textContent, el.innerHTML, el.disabled, el.hidden, el.value, el.max]));
        assert.equal(after, before, 'the page changed');
        assert.equal(p.trendCharts().length, 0);
        assert.equal(p.rootClasses.size, 0);
        assert.equal(p.el('loading-overlay').classList.contains('fade-out'), false);
        if (s.firstView === undefined) assert.deepEqual(p.infos, [], 'a summary without the block is reported');
        // The records then draw as they always have.
        p.loadRecords(syntheticRecords());
        p.run('settleFirstView()');
        assert.equal(p.trendCharts().length, 1);
        assert.equal(p.trendCharts()[0].config.options.animation, undefined);
        assert.deepEqual(p.warnings, []);
        assert.equal(p.el('records-pending').hidden, true);
    });
}

test('startup wires the first view in, and never through dashboardSummary', () => {
    const init = app.slice(app.indexOf("document.addEventListener('DOMContentLoaded', async () => {"));
    const body = init.slice(0, init.indexOf('\n});\n'));
    const at = (needle) => {
        const i = body.indexOf(needle);
        assert.ok(i >= 0, `startup lost ${needle}`);
        return i;
    };
    // The records load in loadStartupDataset (PR #256: a link's snapshot,
    // else the latest data through loadStartupRecords), which closes the
    // first view once they are in.
    assert.ok(at('fetchLatestSummary().then(firstViewOrFigure,') < at('await loadStartupDataset(requested);'));
    assert.match(fnSource('async function loadStartupDataset(requested)'), /await loadStartupRecords\(\);\s*(\/\/.*\n\s*)*firstViewClosed = true;/, 'the startup load does not close the first view');
    // The page opens right after the records draw, before the deep links run
    // (a hook that clicks a waiting control would find it disabled).
    assert.ok(at('renderDashboard();') < at('settleFirstView();'));
    assert.ok(at('settleFirstView();') < at('applyRouteFromHash();') && at('settleFirstView();') < at('sgRouteHooks();'),
        'the deep links run before the page opens');
    const fail = body.slice(body.indexOf('} catch (err) {'));
    assert.match(fail, /startupFailed\(err\);/);
    assert.match(fnSource('function startupFailed(err, retry)'), /firstViewClosed = true;\s*if \(firstViewShown\) \{\s*firstViewFailed\(err, retry\);/);
    for (const sig of ['function firstViewBlock(summary)', 'function firstViewProblem(summary, run)', 'function overviewOnScreen()',
        'function paintFirstView(summary)', 'async function firstViewOrFigure(summary)', 'function setRecordsPending(on)',
        'function settleFirstView()', 'function firstViewFailed(err, retry)', 'function withdrawFirstView()']) {
        assert.doesNotMatch(fnSource(sig), /dashboardSummary\s*=[^=]/, `${sig} assigns dashboardSummary, the phone and archive mode`);
    }
    // The spinner rule the hand-over relies on, and one loader: no ring.
    const css = read('styles.css');
    assert.match(css, /\.first-view-pending #dashboard-loading \{ display: none !important; \}/);
    const strip = html.slice(html.indexOf('<div id="records-pending"'), html.indexOf('<header>'));
    assert.match(strip, /class="loading-meter"/);
    assert.doesNotMatch(strip, /spinner/);
    assert.match(strip, /data-load-progress hidden>/);
});

// ── 5. The engine's gate ───────────────────────────────────────────────────
// civicsample-engine scripts/first_view_parity.mjs runs this app.js and
// index.html over the week's staged data parts before every weekly publish
// of a firstView block; a mismatch (exit 1), or site code it cannot run
// faithfully (exit 2), holds the publish. Its copy here
// (tests/engine_first_view_parity.mjs, pinned by tests/
// engine_first_view_parity.json) is run as the publish runs it, and its stub
// document and runtime are read from it rather than written again: a
// querySelector that answers class selectors only and throws on any other,
// the markup from <header> to the end of the Overview's section,
// requestAnimationFrame run at once, the pieces it slices, and every other
// top-level app.js function run as an inert stub that records its calls
// (engine PR #24). The site's own stub above answers more (attribute
// selectors, :not, the markup from <body>, the real functions), so a change
// can pass the tests above and still stop the publish; it fails here.
const ENGINE_FILE = new URL('./engine_first_view_parity.mjs', import.meta.url);
const ENGINE_PIN = JSON.parse(read('tests/engine_first_view_parity.json'));
const ENGINE = readFileSync(ENGINE_FILE, 'utf8');

// The app.js functions, beyond the gate's fixed list (its ELSEWHERE), that
// the Overview's pieces call and the gate runs as inert stubs. It passes
// with them, with a note, when the numbers agree whether they answer nothing
// or true; what it cannot see is a stub that paints an Overview number on
// the real page. So each is named here, and one added to the pieces fails
// the tests below until someone has read it and added it:
//  - renderUnfilteredFilterSummary (PR #255, from renderFilterSummary over
//    a summary): the filter line over a summary or archive, which the gate
//    compares only with no summary on screen. It reads the Industry view's
//    state and ARCHIVE_FILTERS_NOTE, which the gate does not give the
//    pieces, so it stays out of renderFilterSummary itself.
//  - syncFilterToggle (PR #255, first in renderDashboard): the Filters
//    button's archive state, and over a summary the filter line, as above.
//  - phoneOverview (PR #259, last in renderDashboard's summary painter): a
//    phone's Overview from the block. It returns at once off a phone or
//    without a summary on screen, which is every run of the gate, and on a
//    phone it paints the block's own counts, never the records'.
// None paints a desktop tile, the finding or the chart, and each is a lone
// call statement, so the gate reads no answer from it.
const ENGINE_STUBBED = ['phoneOverview', 'renderUnfilteredFilterSummary', 'syncFilterToggle'];

// The engine script's own lists, slicers, stub document and runtime, from
// its text (its `export`s dropped: the slices run as a script).
function engineSource(from, to) {
    const a = ENGINE.indexOf(from), b = ENGINE.indexOf(to, a);
    assert.ok(a >= 0 && b > a, `the engine script lost ${from} … ${to}`);
    return ENGINE.slice(a, b).replace(/^export /gm, '');
}
const ENGINE_PARTS = (() => {
    const ctx = vm.createContext({ readFileSync, vm });
    vm.runInContext([
        engineSource('const APP_PIECES = [', '// What renderDashboard and initFilters call outside the Overview'),
        engineSource('const ELSEWHERE = [', '// The Overview\'s text'),
        'class InputError extends Error {}',
        engineSource('function slicePiece(', 'function writeExcerpt('),
        engineSource('const ENTITIES = ', '// ── the site\'s code in a vm'),
        engineSource('function siteRuntime(', '// ── the comparison'),
        'this.parts = { APP_PIECES, INDEX_SLICE, ELSEWHERE, AWAY_FROM_DEFAULT, readSite, buildDocument, siteRuntime };'
    ].join('\n'), ctx, { filename: 'engine_first_view_parity.mjs' });
    return ctx.parts;
})();
const APP_PATH = fileURLToPath(new URL('../app.js', import.meta.url));
const INDEX_PATH = fileURLToPath(new URL('../index.html', import.meta.url));

// Synthetic records and the summary the engine would publish for them, as
// files, and the engine script run on them and on an app.js. The records
// go in as the publish passes them: the site's eight staged parts
// (demographics.partN.json.gz), each a container of the run's stamps and
// its share of the records, as repeated --records.
const ENGINE_PARTS_COUNT = 8;
function runEngineGate(appPath = APP_PATH) {
    const dir = mkdtempSync(join(tmpdir(), 'first-view-gate-'));
    try {
        const records = syntheticRecords();
        const block = blockFor(records);
        const size = Math.ceil(records.length / ENGINE_PARTS_COUNT);
        const parts = [];
        for (let i = 0; i < ENGINE_PARTS_COUNT; i++) {
            const file = join(dir, `demographics.part${i + 1}.json.gz`);
            writeFileSync(file, gzipSync(JSON.stringify({ ...RUN, data: records.slice(i * size, (i + 1) * size) })));
            parts.push('--records', file);
        }
        writeFileSync(join(dir, 'summary.json'), JSON.stringify({ ...summaryWith(block), totalStudies: records.length }));
        const r = spawnSync(process.execPath, [fileURLToPath(ENGINE_FILE), ...parts,
            '--summary', join(dir, 'summary.json'), '--app', appPath, '--index', INDEX_PATH], { encoding: 'utf8', timeout: 60000 });
        let report = null;
        try { report = JSON.parse(r.stdout); } catch { /* exit 2 on an input error prints no report */ }
        return { status: r.status, stderr: r.stderr, report, records };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('the engine\'s gate is the pinned copy of its script', () => {
    assert.equal(createHash('sha256').update(readFileSync(ENGINE_FILE)).digest('hex'), ENGINE_PIN.sha256,
        'tests/engine_first_view_parity.mjs is not the engine script tests/engine_first_view_parity.json pins');
    assert.equal(ENGINE_PIN.path, 'scripts/first_view_parity.mjs');
    assert.match(ENGINE_PIN.commit, /^[0-9a-f]{40}$/);
});

test('the engine\'s gate passes on this app.js and index.html, run as the weekly publish runs it', () => {
    const { status, stderr, report, records } = runEngineGate();
    // Exit 1 is a mismatch, exit 2 code it could not run (faithfully): either holds the publish.
    assert.equal(status, 0, `the gate would hold the publish (exit ${status}): ${stderr || JSON.stringify(report && report.mismatches, null, 1)}`);
    assert.equal(report.ok, true);
    assert.equal(report.could_not_run, null);
    assert.deepEqual(report.mismatches, []);
    assert.ok(report.checked >= 40, `only ${report.checked} checks ran`);
    assert.equal(report.records.count, records.length, 'the gate did not count the eight parts together');
    // Its stubs: no answer the Overview uses, and none of app.js's own
    // beyond the ones named above (ENGINE_STUBBED), noted as the gate notes them.
    assert.deepEqual(report.answer_matters_for, []);
    assert.deepEqual(report.site_functions_stubbed, ENGINE_STUBBED,
        'the Overview calls another app.js function the engine\'s gate only stubs: read it, then name it in ENGINE_STUBBED');
    assert.match(stderr, new RegExp(`note: the Overview now calls ${ENGINE_STUBBED.join(', ')}, which the parity does not run`));
    assert.doesNotMatch(stderr, /could not run faithfully/);
    // And it holds the publish for what the site's own stub lets by: one of
    // its pieces asking for an attribute selector.
    const dir = mkdtempSync(join(tmpdir(), 'first-view-gate-app-'));
    try {
        const at = app.indexOf('function renderFilterSummary(');
        const body = app.indexOf('{', at) + 1;
        const changed = `${app.slice(0, body)}\n    document.querySelector('.tab[data-tab="overview"]');${app.slice(body)}`;
        writeFileSync(join(dir, 'app.js'), changed);
        const held = runEngineGate(join(dir, 'app.js'));
        assert.equal(held.status, 2, 'the engine\'s gate ran a piece with an attribute selector');
        assert.match(held.stderr, /class selectors only/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the pieces the engine\'s gate slices are all there and run on their own, in its runtime, calling no other app.js function but those named', () => {
    // Sliced by the engine's own readSite (a piece it cannot find is an
    // input error that holds the publish), then run in the engine's own
    // runtime (siteRuntime): its document, its fixed stubs, and every other
    // top-level app.js function an inert stub that records its calls. A
    // name app.js does not declare as a function (a top-level value, a
    // let) is a ReferenceError there, which holds the publish.
    const site = ENGINE_PARTS.readSite(APP_PATH, INDEX_PATH);
    assert.equal(site.pieces.length, ENGINE_PARTS.APP_PIECES.length);
    assert.ok(site.markup.startsWith('<header>') && site.markup.endsWith('</section>'));
    for (const name of ENGINE_STUBBED) assert.ok(site.stubs.some((s) => s.name === name), `the gate no longer stubs ${name}`);
    const s = ENGINE_PARTS.siteRuntime(site, new Set());
    assert.throws(() => s.run('document.querySelector(\'.tab[data-tab="overview"]\')'), /class selectors only/,
        'the engine\'s document answers more than class selectors');
    const records = syntheticRecords();
    const b = blockFor(records);
    s.context.__records = records;
    // What the gate runs, in its order: the records' Overview, the
    // controls, ?sg=v2 at Any, the block through the summary painter and
    // through the desktop painters, each results year alone, and the
    // filter with study type All.
    s.run('data = __records; dashboardSummary = null; initFilters(); renderDashboard();');
    const recordsChart = s.chart();
    const painted = Object.fromEntries(['total-studies', 'race-reporting', 'stat-sub-total', 'finding-headline', 'filter-summary-text']
        .map((id) => [id, s.text(id).html || s.text(id).text]));
    assert.equal(s.run('(() => { const w = yearWindowEnds(); return JSON.stringify([w.start, w.end === Infinity ? null : w.end]); })()'), '[2009,null]');
    assert.equal(s.run('datasetLatestYear()'), b.newest_results_year);
    assert.equal(s.controls.length > 5, true, 'the engine finds no filter controls');
    s.setSg(true);
    assert.equal(s.run('getFilteredData().length'), b.trials);
    s.setSg(false);
    s.context.__summary = {
        totalStudies: b.trials,
        cards: { raceCount: b.trials_reporting_race, ethCount: b.trials_reporting_ethnicity, bothCount: b.trials_reporting_race_and_ethnicity },
        byYear: Object.fromEntries(Object.entries(b.by_results_year).map(([y, c]) => [y, { total: c.trials, race_reported: c.trials_reporting_race,
            eth_reported: c.trials_reporting_ethnicity, both_reported: c.trials_reporting_race_and_ethnicity }]))
    };
    s.run('dashboardSummary = __summary; renderDashboard();');
    const blockChart = s.chart();
    const args = [b.trials, b.trials_reporting_race, b.trials_reporting_ethnicity, b.trials_reporting_race_and_ethnicity].join(', ');
    s.run(`dashboardSummary = null; renderOverviewTileContext(${args}); renderOverviewFinding(${args}); renderFilterSummary(${b.trials});`);
    for (const [id, html] of Object.entries(painted)) assert.equal(s.text(id).html || s.text(id).text, html, `#${id}`);
    for (const y of Object.keys(b.by_results_year)) {
        s.run(`(() => { const ys = document.getElementById('year-start'), ye = document.getElementById('year-end');
            ye.value = '${y}'; ys.value = '${y}'; noteYearChoice(ys); noteYearChoice(ye);
            dashboardSummary = null; renderDashboard(); })()`);
    }
    s.run('resetYearWindow(); document.getElementById(\'study-type\').value = \'all\';');
    assert.equal(s.run('getFilteredData().length'), records.length);
    assert.ok(recordsChart && blockChart, 'the trend chart was not drawn');
    assert.deepEqual(blockChart.series.map((d) => d.data), recordsChart.series.map((d) => d.data),
        'the gate would read the records\' chart as the block\'s');
    // What ran as a stub: the gate's fixed list, and of app.js's own only
    // the ones named above (an array of this realm, not the vm's).
    const ran = Array.from(s.stubbedRan());
    assert.deepEqual(ran.filter((n) => !ENGINE_PARTS.ELSEWHERE.includes(n)), ENGINE_STUBBED,
        'the Overview calls another app.js function the engine\'s gate only stubs: read it, then name it in ENGINE_STUBBED');
});

// ── 6. Phones: the desktop's Overview from the block ───────────────────────
// Owner decision 29b. A phone reads dashboard-summary.json; on the latest
// summary its Overview paints from the firstView block when the block passes
// the desktop's checks, and every other tab stays on the summary's
// all-study-type aggregates. tests/phone_first_view_summary.json is the real
// summary of the 2026-10-04 run with its block, as the engine's first-view
// branch writes it (the Overview's fields of it).

const PHONE_SUMMARY = (() => {
    const s = JSON.parse(read('tests/phone_first_view_summary.json'));
    delete s.about;
    return s;
})();
const phoneSummary = (edit = () => {}) => { const s = clone(PHONE_SUMMARY); edit(s); return s; };
const stampsOf = (s) => ({ extracted_at: s.extracted_at, pipeline_commit: s.pipeline_commit });
const OVERVIEW_IDS = ['total-studies', 'race-reporting', 'ethnicity-reporting', 'both-reporting', 'stat-sub-total',
    'stat-sub-race', 'stat-sub-ethnicity', 'stat-sub-both', 'finding-headline', 'finding-context'];
const FIRST_VIEW_KEYS = ['trials', 'trials_reporting_race', 'trials_reporting_ethnicity', 'trials_reporting_race_and_ethnicity'];
const DESKTOP_ONLY = ' · filters are a desktop feature';
// Values from the page's realm, compared as plain data.
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, message) => assert.deepEqual(plain(a), plain(b), message);

// A phone opening the latest summary, as loadData's phone branch and
// startup run it: the block's verdict, the summary, then renderDashboard.
// The tab renderers record what each one read. today: the summary painter
// without the phone's own step (phoneOverview), as before this change.
async function phonePage(summary, { search = '', hash = '', run = stampsOf(summary), today = false } = {}) {
    const p = page({ mobile: true, search, hash, runStamp: run ? run.extracted_at : null, run });
    p.context.__summary = summary;
    // A phone on its summary hides the Filters button (initFilterSummary).
    p.run("document.getElementById('filter-summary-toggle').hidden = true;");
    p.run(`var __calls = [];
        ${ELSEWHERE.filter((n) => /^render/.test(n)).map((n) => `${n} = function () { __calls.push(['${n}', dashboardSummary && dashboardSummary.totalStudies, dashboardSummary === __summary]); };`).join('\n')}
        ${today ? 'phoneOverview = function () {};' : ''}`);
    await p.run('(async () => { phoneFirstView = await phoneFirstViewFor(__summary); dashboardSummary = __summary; data = __summary.recentStudies || []; renderDashboard(); })()');
    p.flushFrames();
    return p;
}
const openTab = (p, name) => p.run(`document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === '${name}')); renderPhoneScope();`);

test('a phone opens on the desktop\'s first-view Overview: 75,607 trials, 58.9% report race', async () => {
    const summary = phoneSummary();
    const b = summary.firstView;
    const phone = await phonePage(summary);
    const desk = page({ runStamp: summary.extracted_at, run: stampsOf(summary) });
    assert.equal(await desk.run('firstViewOrFigure')(phoneSummary()), true, 'the desktop does not paint the real block');
    const onPhone = phone.overview(), onDesk = desk.overview();
    for (const id of OVERVIEW_IDS) same(onPhone[id], onDesk[id], `#${id} differs from the desktop's`);
    assert.equal(onPhone.findingShown, onDesk.findingShown);
    same(onPhone.chart, onDesk.chart, 'the trend chart differs from the desktop\'s');

    // The numbers, as the reader sees them: the block's counts over its trials.
    assert.equal(onPhone['total-studies'].text, '75,607');
    assert.equal(onPhone['race-reporting'].text, '58.9%');
    assert.equal(onPhone['ethnicity-reporting'].text, '40.6%');
    assert.equal(onPhone['both-reporting'].text, '38.3%');
    assert.equal(onPhone['stat-sub-total'].text, 'results posted 2009–2026');
    assert.equal(onPhone['stat-sub-race'].text, '44,516 of 75,607 trials');
    assert.equal(onPhone['finding-headline'].html, '<strong>58.9%</strong> of these trials report race, but only <strong>38.3%</strong> report race and ethnicity together.');
    assert.equal(onPhone['finding-context'].text, '75,607 trials · 20.5-point gap · ethnicity reported by 40.6%');
    same(phone.lastCounts(), [b.trials, b.trials_reporting_race, b.trials_reporting_ethnicity, b.trials_reporting_race_and_ethnicity]);

    // The trend chart: each year's ratio from by_results_year, over its trials.
    const years = Object.keys(b.by_results_year).sort();
    same(onPhone.chart.labels, years);
    const want = { Race: 'trials_reporting_race', Ethnicity: 'trials_reporting_ethnicity', Both: 'trials_reporting_race_and_ethnicity' };
    for (const s of onPhone.chart.series) {
        const key = want[s.label];
        assert.ok(key, `an unexpected series ${s.label}`);
        assert.ok(s.data.every((v, i) => Object.is(v, (b.by_results_year[years[i]][key] / b.by_results_year[years[i]].trials) * 100)), `the ${s.label} series is not by_results_year's`);
    }

    // The scope line names the view, from the block.
    assert.equal(onPhone['filter-summary-text'].html, `<b>75,607</b> trials · Interventional studies, results posted 2009–2026${DESKTOP_ONLY}`);
    // The summary on screen is still the all-study-type one, unchanged.
    assert.equal(phone.run('dashboardSummary === __summary'), true);
    same(phone.run('dashboardSummary'), phoneSummary(), 'the phone changed the summary');
    same(phone.infos, []);
});

test('a phone\'s other tabs stay on the all-study-type aggregates, and say so', async () => {
    const phone = await phonePage(phoneSummary());
    const calls = phone.run('__calls');
    for (const name of ['renderRaceDistribution', 'renderRaceTrends', 'renderEthnicityDistribution', 'renderSexDistribution', 'renderGenderTrends']) {
        const call = calls.find((c) => c[0] === name);
        assert.ok(call, `${name} did not run`);
        same(call.slice(1), [80320, true], `${name} did not read the all-study-type summary`);
    }
    for (const tab of ['race', 'ethnicity', 'sex', 'gender', 'studies', 'fda-oversight']) {
        openTab(phone, tab);
        assert.equal(phone.text('filter-summary-text').html, `<b>80,320</b> trials · All study types, unfiltered${DESKTOP_ONLY}`, `the ${tab} tab`);
    }
    openTab(phone, 'overview');
    assert.equal(phone.text('filter-summary-text').html, `<b>75,607</b> trials · Interventional studies, results posted 2009–2026${DESKTOP_ONLY}`);
    // The Overview's tiles never mix the two: all four are the block's.
    same(['total-studies', 'race-reporting', 'ethnicity-reporting', 'both-reporting'].map((id) => phone.text(id).text),
        ['75,607', '58.9%', '40.6%', '38.3%']);
    // Every tab switch rewrites the line (initTabs).
    const tabs = fnSource('function initTabs()');
    assert.match(tabs, /showFilterChrome\(tab\.dataset\.tab\);\s*\/\/[^\n]*\n\s*renderPhoneScope\(\);/);
});

test('without the block a phone paints as before, and says All study types', async () => {
    const summary = phoneSummary((s) => { delete s.firstView; });
    const now = await phonePage(summary);
    const before = await phonePage(phoneSummary((s) => { delete s.firstView; }), { today: true });
    const a = now.overview(), b = before.overview();
    for (const id of OVERVIEW_IDS) same(a[id], b[id], `#${id} changed`);
    same(a.chart, b.chart);
    assert.equal(a['total-studies'].text, '80,320');
    assert.equal(a['race-reporting'].text, '57.4%');
    assert.equal(a['stat-sub-total'].text, 'trials with results posted');
    assert.equal(b['filter-summary-text'].html, `<b>80,320</b> trials · the full dataset, unfiltered${DESKTOP_ONLY}`);
    assert.equal(a['filter-summary-text'].html, `<b>80,320</b> trials · All study types, unfiltered${DESKTOP_ONLY}`);
    const years = Object.keys(summary.byYear).sort();
    assert.ok(a.chart.series[0].data.every((v, i) => Object.is(v, (summary.byYear[years[i]].race_reported / summary.byYear[years[i]].total) * 100)));
    same(now.infos, [], 'a summary without the block is reported');
});

test('a block that fails the desktop\'s checks leaves the phone on all study types', async () => {
    const noBlock = (await phonePage(phoneSummary((s) => { delete s.firstView; }))).overview();
    const cases = {
        'a stale block (from an earlier run than its summary)': [phoneSummary((s) => { s.firstView.extracted_at = '2026-09-27T12:00:00+00:00'; })],
        'a block from another commit': [phoneSummary((s) => { s.firstView.pipeline_commit = 'abc'; })],
        'a summary from another run than data/run.json': [phoneSummary(), { run: { ...stampsOf(PHONE_SUMMARY), extracted_at: '2026-10-11T00:00:00+00:00' } }],
        'a malformed count': [phoneSummary((s) => { s.firstView.trials = String(s.firstView.trials); })],
        'years that do not add up': [phoneSummary((s) => { s.firstView.by_results_year['2015'].trials += 1; })],
        'another study type': [phoneSummary((s) => { s.firstView.filter.study_type = 'OBSERVATIONAL'; })],
        'another first year': [phoneSummary((s) => {
            // well formed: 2009 leaves the block and its totals
            const b = s.firstView;
            b.filter.results_year_from = 2010;
            for (const k of FIRST_VIEW_KEYS) b[k] -= b.by_results_year['2009'][k];
            delete b.by_results_year['2009'];
        })],
        '?firstview=0': [phoneSummary(), { search: '?firstview=0' }],
        '?firstview=0 in the hash': [phoneSummary(), { hash: '#overview?firstview=0' }]
    };
    const refusedByShape = ['a stale block (from an earlier run than its summary)', 'a block from another commit', 'a malformed count', 'years that do not add up'];
    for (const [name, [summary]] of Object.entries(cases)) {
        // Each case fails one check only: the shape and stamp checks (firstViewBlock) or a later one.
        const reachesPhone = !refusedByShape.includes(name);
        const desk = page();
        assert.equal(!!desk.run('firstViewBlock')(summary), reachesPhone, `${name}: the block's shape`);
    }
    for (const [name, [summary, opts]] of Object.entries(cases)) {
        const p = await phonePage(summary, opts);
        const shown = p.overview();
        for (const id of OVERVIEW_IDS) same(shown[id], noBlock[id], `${name}: #${id}`);
        same(shown.chart, noBlock.chart, `${name}: the chart`);
        assert.equal(shown['filter-summary-text'].html, `<b>80,320</b> trials · All study types, unfiltered${DESKTOP_ONLY}`, name);
        assert.equal(p.infos.length, 1, `${name}: not reported`);
        assert.match(p.infos[0][0], /^The phone Overview counts all study types: /);
    }
    // A link to another tab or to filters does not stop it: a phone applies
    // no filters, and its Overview is the same whatever tab a link opens.
    // Nor does a snapshot link: a phone ignores it and opens the latest
    // summary (requestedSnapshot), which is the block's.
    for (const opts of [{ hash: '#race' }, { search: '?st=all' }, { search: '?sgsnapshot=2026-03-29' }, { hash: '#overview?sgsnapshot=2026-03-29' }]) {
        const p = await phonePage(phoneSummary(), opts);
        assert.equal(p.text('total-studies').text, '75,607', JSON.stringify(opts));
        assert.equal(p.text('filter-summary-text').html, `<b>75,607</b> trials · Interventional studies, results posted 2009–2026${DESKTOP_ONLY}`, JSON.stringify(opts));
        same(p.infos, [], JSON.stringify(opts));
    }
    assert.match(fnSource('function requestedSnapshot()'), /if \(isMobileDevice\) return null;/);
});

test('a phone keeps the block only while its summary is on screen', async () => {
    const phone = await phonePage(phoneSummary());
    // Another summary on screen (an archive): the block is not its.
    phone.context.__archive = phoneSummary((s) => { delete s.firstView; s.totalStudies = 70000; });
    phone.run('dashboardSummary = __archive; renderDashboard();');
    assert.equal(phone.run('phoneFirstViewOnScreen()'), null);
    assert.equal(phone.text('total-studies').text, '70,000');
    assert.equal(phone.text('filter-summary-text').html, `<b>70,000</b> trials · All study types, unfiltered${DESKTOP_ONLY}`);
    // loadData's phone branch takes the verdict before the summary goes on screen.
    assert.match(fnSource('async function loadData(date)'),
        /if \(summary\) \{[^}]*?phoneFirstView = await phoneFirstViewFor\(summary\);\s*dashboardSummary = summary;/);
});

test('a phone whose summary failed draws its records as before, with their own line', async () => {
    // The summary answered and its block passed, then the phone fell back to
    // the records (loadData: the rest of its summary branch threw, or a
    // later switch loaded parts): dashboardSummary is null, and the phone
    // code leaves the records' Overview and line alone, on every tab.
    const draw = async (today) => {
        const summary = phoneSummary();
        const p = page({ mobile: true, runStamp: summary.extracted_at, run: stampsOf(summary) });
        p.context.__summary = summary;
        if (today) p.run('phoneOverview = function () {}; renderPhoneScope = function () {};');
        await p.run('(async () => { phoneFirstView = await phoneFirstViewFor(__summary); dashboardSummary = null; })()');
        assert.notEqual(p.run('phoneFirstView'), null, 'the block did not pass');
        p.loadRecords(syntheticRecords());
        p.flushFrames();
        const shown = { overview: p.overview(), lines: [] };
        for (const tab of ['race', 'studies', 'overview']) {
            openTab(p, tab);
            shown.lines.push(p.text('filter-summary-text').html);
        }
        return shown;
    };
    const now = await draw(false), before = await draw(true);
    same(now, before, 'the phone code changed a phone drawing records');
    assert.notEqual(now.overview['total-studies'].text, '75,607');
    for (const line of now.lines) assert.doesNotMatch(line, /All study types|Interventional studies/);
});

test('a desktop paints exactly as before: its first view, and an archive summary', async () => {
    // An aggregate archive on a desktop goes through the summary painter: the
    // phone's step does nothing there.
    const archive = () => phoneSummary((s) => { s.extracted_at = s.firstView.extracted_at = '2026-03-29T00:00:00+00:00'; });
    const paint = (today) => {
        const p = page();
        p.context.__summary = archive();
        if (today) p.run('phoneOverview = function () {};');
        p.run('phoneFirstView = { summary: __summary, block: __summary.firstView, studyType: "Interventional" }; dashboardSummary = __summary; renderDashboard();');
        return p.overview();
    };
    same(paint(false), paint(true));
    // On a desktop the archive's line says why its filters are off (PR #255).
    assert.equal(paint(false)['filter-summary-text'].html,
        '<b>80,320</b> trials · the full dataset, unfiltered · this archive keeps totals only; filters apply to the latest data and the complete snapshots');
    // A tab switch on a desktop leaves its line as its filters wrote it.
    for (const withRecords of [false, true]) {
        const p = page();
        p.context.__summary = archive();
        p.run('dashboardSummary = __summary; renderDashboard();');
        const line = p.text('filter-summary-text').html;
        p.run("document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'race')); renderPhoneScope();");
        assert.equal(p.text('filter-summary-text').html, line, 'renderPhoneScope wrote a desktop\'s line');
        if (withRecords) {
            p.run('dashboardSummary = null;');
            p.loadRecords(syntheticRecords());
            const records = p.text('filter-summary-text').html;
            assert.match(records, /<b>interventional<\/b>/);
            p.run('renderPhoneScope();');
            assert.equal(p.text('filter-summary-text').html, records);
        }
    }
    // The desktop's first view still reads its year controls for the total's line.
    const desk = page({ runStamp: PHONE_SUMMARY.extracted_at, run: stampsOf(PHONE_SUMMARY) });
    assert.equal(await desk.run('firstViewOrFigure')(phoneSummary()), true);
    assert.equal(desk.text('stat-sub-total').text, `results posted ${desk.el('year-start').value}–${desk.el('year-end').value}`);
    assert.match(desk.text('filter-summary-text').html, /<b>75,607<\/b> trials · <b>interventional<\/b> · results posted <b>2009–2026<\/b>/);
    // A phone never takes the desktop's first view (it has no records to hand over to).
    assert.equal((await phonePage(phoneSummary())).run('firstViewProblem')(phoneSummary(), null), 'a phone reads the summary itself');
    // renderDashboard reaches the phone's step only where it is defined, so
    // the engine's gate, which runs renderDashboard alone, is unaffected
    // (its pieces still run on their own: section 5).
    const render = fnSource('function renderDashboard()');
    same(render.replace(/^\s*\/\/.*$/gm, '').match(/phone\w*/gi), ['phoneOverview', 'phoneOverview'], 'renderDashboard calls more phone code');
    assert.match(render, /if \(typeof phoneOverview === 'function'\) phoneOverview\(\);/);
    for (const sig of ['function phoneFirstViewProblem(summary, run)', 'async function phoneFirstViewFor(summary)',
        'function renderPhoneScope()', 'function phoneOverview()', 'function paintOverviewFromBlock(b, years)']) {
        assert.doesNotMatch(fnSource(sig), /dashboardSummary\s*=[^=]/, `${sig} assigns dashboardSummary`);
    }
});

test('a phone checks the block against the declared default study type, not a restored control', async () => {
    // A browser that restores form state on reload can bring back a study
    // type chosen on a desktop-width window (All). A phone applies no
    // filters, so its Overview is still the default view, and the block,
    // which counts that view, still paints it.
    const restored = async (value) => {
        const summary = phoneSummary();
        const p = page({ mobile: true, runStamp: summary.extracted_at, run: stampsOf(summary) });
        p.context.__summary = summary;
        p.el('study-type').value = value;
        assert.equal(p.el('study-type').value, value, 'the stub did not restore the control');
        await p.run('(async () => { phoneFirstView = await phoneFirstViewFor(__summary); dashboardSummary = __summary; data = __summary.recentStudies || []; renderDashboard(); })()');
        p.flushFrames();
        return p;
    };
    for (const value of ['all', 'OBSERVATIONAL']) {
        const p = await restored(value);
        assert.equal(p.text('total-studies').text, '75,607', `a restored ${value}`);
        assert.equal(p.text('race-reporting').text, '58.9%', `a restored ${value}`);
        assert.equal(p.text('filter-summary-text').html, `<b>75,607</b> trials · Interventional studies, results posted 2009–2026${DESKTOP_ONLY}`, `a restored ${value}`);
        same(p.infos, [], `a restored ${value}`);
    }
    // The declared default is still what the block must match.
    const p = page({ mobile: true });
    p.run("document.getElementById('study-type').options.forEach(o => { o.defaultSelected = o.value === 'all'; });");
    assert.equal(p.run('phoneFirstViewProblem')(phoneSummary(), stampsOf(PHONE_SUMMARY)), 'the block’s study type is not the desktop’s default');
});

test('a phone opened on /#industry says All study types, as the Industry tab does', async () => {
    // The hash route (openIndustryView) activates Industry without the tab's
    // click handler; the line above the tabs must still leave the Overview's
    // view, whichever of the route and the summary's render comes first.
    const viaRoute = async (routeFirst) => {
        const summary = phoneSummary();
        const p = page({ mobile: true, hash: '#industry', runStamp: summary.extracted_at, run: stampsOf(summary) });
        p.context.__summary = summary;
        p.run("document.getElementById('filter-summary-toggle').hidden = true;");
        p.run(constLine('NO_FILTER_TABS') + '\n' + fnSource('function showFilterChrome(tabId)') + '\n' + fnSource('async function openIndustryView()'));
        p.run(`var promptForBetaAccess = async () => true; var loadIndustryView = async () => {};
            var __industry = document.createElement('section');
            const __byId = document.getElementById; document.getElementById = (id) => (id === 'industry' ? __industry : __byId(id));`);
        const render = '(async () => { phoneFirstView = await phoneFirstViewFor(__summary); dashboardSummary = __summary; data = __summary.recentStudies || []; renderDashboard(); })()';
        if (routeFirst) await p.run('openIndustryView()');
        await p.run(render);
        p.flushFrames();
        if (!routeFirst) {
            assert.equal(p.text('filter-summary-text').html, `<b>75,607</b> trials · Interventional studies, results posted 2009–2026${DESKTOP_ONLY}`);
            await p.run('openIndustryView()');
        }
        assert.equal(p.run("document.querySelector('.tab.active').dataset.tab"), 'industry');
        return p.text('filter-summary-text').html;
    };
    const tab = await phonePage(phoneSummary());
    openTab(tab, 'industry');
    const clicked = tab.text('filter-summary-text').html;
    assert.equal(clicked, `<b>80,320</b> trials · All study types, unfiltered${DESKTOP_ONLY}`);
    assert.equal(await viaRoute(false), clicked, 'the route left the Overview\'s line over Industry');
    assert.equal(await viaRoute(true), clicked);
});
