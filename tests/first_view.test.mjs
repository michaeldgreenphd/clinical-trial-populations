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
 *  - the pieces the engine's gate slices are all still there and still run
 *    on their own, as it runs them.
 *
 * Everything runs app.js's own functions in a vm, over a stub document
 * built from index.html's markup (its controls start at their defaults).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
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
    const stack = [];
    let root = null;
    const matches = (el, simple) => {
        // tag, .class, #id, [attr="v"], :not(simple), :disabled — what app.js's selectors here use
        let rest = simple.trim();
        const not = /:not\(([^)]*)\)/.exec(rest);
        if (not) {
            if (matches(el, not[1])) return false;
            rest = rest.replace(not[0], '');
        }
        if (rest.endsWith(':disabled')) { if (!el.disabled) return false; rest = rest.slice(0, -9); }
        for (const m of rest.matchAll(/([#.]?)([\w-]+)|\[([\w-]+)="([^"]*)"\]/g)) {
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
            get disabled() { return 'disabled' in attrs; }, set disabled(v) { if (v) attrs.disabled = ''; else delete attrs.disabled; },
            get title() { return attrs.title ?? ''; }, set title(v) { attrs.title = String(v); },
            setAttribute(name, value) { attrs[name] = String(value); if (name.startsWith('data-')) dataset[camel(name.slice(5))] = String(value); },
            getAttribute: (name) => (name in attrs ? attrs[name] : name.startsWith('data-') && camel(name.slice(5)) in dataset ? dataset[camel(name.slice(5))] : null),
            removeAttribute(name) { delete attrs[name]; if (name.startsWith('data-')) delete dataset[camel(name.slice(5))]; },
            hasAttribute: (name) => name in attrs,
            querySelector: (sel) => query(el, sel)[0] ?? null,
            querySelectorAll: (sel) => query(el, sel),
            addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
            appendChild: (c) => c, prepend() {}, focus() {}
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
                return { value: 'value' in a ? a.value : text, text, selected: 'selected' in a };
            });
            let index = Math.max(options.findIndex((o) => o.selected), options.length ? 0 : -1);
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
    const document = {
        documentElement: { classList: { add: (c) => rootClasses.add(c), remove: (c) => rootClasses.delete(c), contains: (c) => rootClasses.has(c) } },
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
    return { document, byId, rootClasses };
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
    fnSource('function renderDashboard()'),
    fnSource('function escapeHtml('),
    fnSource('function renderReportingTrends('),
    fnSource('function setDataPulledDate(iso)'),
    fnSource('function sgQueryParams(hash, search)'),
    between('const SHARE_FILTERS = [', 'function shareFilterDefault('),
    constLine('FIRST_VIEW_COUNTS'),
    fnSource('function firstViewBlock(summary)'),
    fnSource('function firstViewProblem(summary, run)'),
    fnSource('function overviewOnScreen()'),
    fnSource('function paintFirstView(summary)'),
    fnSource('async function firstViewOrFigure(summary)'),
    constLine('RECORDS_PENDING_CONTROLS'),
    fnSource('function setRecordsPending(on)'),
    fnSource('function settleFirstView()'),
    fnSource('function firstViewFailed(err)'),
    // What startup runs once the records are drawn: the deep-link hooks.
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
    const b = STARTUP.search(/if \(!dashboardSummary\) \{\s*initHistorySelector\(\);/);
    assert.ok(a >= 0 && b > a, 'startup lost its render … history selector tail');
    return STARTUP.slice(a, b);
})();

// One page: index.html's controls at their defaults, the app's Overview
// code, and switches for what the first view reads from the page around it.
function page({ mobile = false, hash = '', search = '', runStamp = null, run = null } = {}) {
    const { document, byId, rootClasses } = buildDocument();
    const charts = [];
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
        renderLoadingFigure: (s) => figures.push(s),
        hideLoadingOverlay: () => { const o = byId.get('loading-overlay'); if (o) o.classList.add('fade-out'); },
        fetchRun: async () => run,
        location: { hash, search },
        __mobile: mobile, __hash: hash, __search: search, __runStamp: runStamp
    };
    for (const name of ELSEWHERE) sandbox[name] = () => {};
    for (const name of AWAY_FROM_DEFAULT) sandbox[name] = () => { throw new Error(`${name} ran in the default view`); };
    const context = vm.createContext(sandbox);
    vm.runInContext([
        'let data = null; let dashboardSummary = null; let charts = {}; let sgV2Filters = null;',
        'const isMobileDevice = __mobile; const SG_INITIAL_HASH = __hash; const SG_INITIAL_SEARCH = __search;',
        'let LATEST_RUN_STAMP = __runStamp;',
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
        context, byId, charts, warnings, infos, figures, timers, rootClasses, run: run$, flushFrames,
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
    assert.equal(problem({}, summaryWith(clone(good)), RUN), null, 'data/run.json naming this run stops it');
    assert.equal(problem({}, summaryWith(clone(good)), { extracted_at: RUN.extracted_at }), null, 'a run.json without a commit stops it');

    const no = {
        'a phone': [{ mobile: true }],
        '?firstview=0': [{ search: '?firstview=0' }],
        '?firstview=0 in the hash': [{ hash: '#overview?firstview=0' }],
        'a link to another tab': [{ hash: '#race' }],
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
    assert.ok(at('fetchLatestSummary().then(firstViewOrFigure,') < at('await loadData();'));
    assert.match(body, /await loadData\(\);\s*firstViewClosed = true;/, 'the startup load does not close the first view');
    // The page opens right after the records draw, before the deep links run
    // (a hook that clicks a waiting control would find it disabled).
    assert.ok(at('renderDashboard();') < at('settleFirstView();'));
    assert.ok(at('settleFirstView();') < at('applyRouteFromHash();') && at('settleFirstView();') < at('sgRouteHooks();'),
        'the deep links run before the page opens');
    const fail = body.slice(body.indexOf('} catch (err) {'));
    assert.match(fail, /firstViewClosed = true;[\s\S]*if \(firstViewShown\) firstViewFailed\(err\);/);
    for (const sig of ['function firstViewBlock(summary)', 'function firstViewProblem(summary, run)', 'function overviewOnScreen()',
        'function paintFirstView(summary)', 'async function firstViewOrFigure(summary)', 'function setRecordsPending(on)',
        'function settleFirstView()', 'function firstViewFailed(err)']) {
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
// civicsample-engine scripts/first_view_parity.mjs slices these from the
// live app.js by name and runs them alone in a vm with these names defined.
// A rename, or a new helper one of them calls, stops the weekly publish.
const ENGINE_APP_PIECES = [
    ['between', 'const YEAR_WINDOW_MIN', 'function initFilters()'],
    ['fn', 'function initFilters()'],
    ['fn', 'function getFilteredData()'],
    ['fn', 'function sgReadFilters()'],
    ['fn', 'function showDashboardSpinner()'],
    ['fn', 'function hideDashboardSpinner()'],
    ['fn', 'function renderOverviewTileContext('],
    ['fn', 'function renderOverviewFinding('],
    ['fn', 'function renderFilterSummary('],
    ['fn', 'function renderDashboard()'],
    ['fn', 'function escapeHtml('],
    ['fn', 'function renderReportingTrends(']
];
const ENGINE_ELSEWHERE = [
    'sgApplyMode', 'sgAfterRender', 'refreshStudiesTab', 'updateActiveFilters',
    'populateConditionsDropdown', 'populateCountriesDropdown', 'populateSecondaryConditionDropdown',
    'renderRaceDistribution', 'renderRaceTrends', 'renderRaceSubcategories', 'renderRaceReportedParticipants',
    'renderRaceFullDistribution', 'renderEthnicityDistribution', 'renderEthnicityTrends',
    'renderEthnicitySubcategories', 'renderEthnicityReportedParticipants', 'renderEthnicityFullDistribution',
    'renderSexReportedParticipants', 'renderSexFullDistribution', 'renderSexDistribution', 'renderSexTrends',
    'renderGenderReportedParticipants', 'renderGenderFullDistribution', 'renderGenderDistribution',
    'renderGenderTrends', 'renderFdaOversight', 'renderGeographyDashboard'
];

test('the pieces the engine\'s gate slices are all there and run on their own', () => {
    const pieces = ENGINE_APP_PIECES.map(([kind, from, to]) => (kind === 'fn' ? fnSource(from) : between(from, to)));
    const { document } = buildDocument();
    const made = [];
    const sandbox = {
        document, window: {}, console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
        requestAnimationFrame: (fn) => { fn(); return 1; }, cancelAnimationFrame() {},
        Chart: class { constructor(canvas, config) { made.push({ canvas, config }); } destroy() {} },
        sgActive: () => false
    };
    for (const name of ENGINE_ELSEWHERE) sandbox[name] = () => {};
    for (const name of [...AWAY_FROM_DEFAULT, 'resetFilters', 'updateShareUrl']) sandbox[name] = () => { throw new Error(`${name} ran`); };
    const context = vm.createContext(sandbox);
    vm.runInContext([
        'let data = null; let dashboardSummary = null; let charts = {}; let sgV2Filters = null;',
        "const COLORS = { reporting: { race: '#000000', ethnicity: '#000000', both: '#000000' } };",
        'const CHART_ASPECT_RATIO = undefined;',
        ...pieces
    ].join('\n'), context);
    const records = syntheticRecords();
    context.__records = records;
    vm.runInContext('data = __records; initFilters(); renderDashboard();', context);
    // The block through the summary painter, as the gate paints it.
    const b = blockFor(records);
    context.__summary = {
        totalStudies: b.trials,
        cards: { raceCount: b.trials_reporting_race, ethCount: b.trials_reporting_ethnicity, bothCount: b.trials_reporting_race_and_ethnicity },
        byYear: Object.fromEntries(Object.entries(b.by_results_year).map(([y, c]) => [y, { total: c.trials, race_reported: c.trials_reporting_race,
            eth_reported: c.trials_reporting_ethnicity, both_reported: c.trials_reporting_race_and_ethnicity }]))
    };
    vm.runInContext('dashboardSummary = __summary; renderDashboard();', context);
    const trend = made.filter((c) => c.canvas && c.canvas.id === 'reporting-trends-chart');
    assert.equal(trend.length, 2, 'the gate would read the records\' chart as the block\'s');
    assert.deepEqual(trend[1].config.data.datasets.map((d) => d.data), trend[0].config.data.datasets.map((d) => d.data));
});
