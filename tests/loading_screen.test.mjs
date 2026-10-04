/**
 * The loading screen: what it says, and how it follows the download.
 *
 * fetchAndDecompress reports a part's bytes as they arrive; the parts loop
 * turns those into one share and one megabytes line (describePartsProgress);
 * updateLoadingProgress writes them to every open loading screen; and the
 * sample field fills in proportion. Each is evaluated on its own in a vm
 * with stubs for the network and the DOM. The markup is checked on the
 * source: the credit, the progress semantics, and the wording.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function slice(startMarker, endMarker) {
    const at = app.indexOf(startMarker);
    assert.ok(at >= 0, `app.js lost ${startMarker}`);
    const end = app.indexOf(endMarker, at);
    assert.ok(end > at, `could not find the end of ${startMarker}`);
    return app.slice(at, end + endMarker.length);
}
const fnSource = (sig) => slice(sig, '\n}\n');

const helpers = fnSource('function formatLoadMB(bytes)') + fnSource('function describePartsProgress(loaded, totals, finished)');
const fetcher = fnSource('async function fetchAndDecompress(url, onProgress, init)');
const sample = slice('const loadingSample = (() => {', '\n})();\n');
const updater = fnSource('function updateLoadingProgress(percent, statusText, bytesText = \'\')');

const T = { timeout: 5000 };

// A gzip body served in three chunks, as a stream.
function gzBody(payload) {
    const gz = gzipSync(Buffer.from(JSON.stringify(payload)));
    const cuts = [0, Math.floor(gz.length / 3), Math.floor((2 * gz.length) / 3), gz.length];
    const stream = new ReadableStream({
        start(c) {
            for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(gz.subarray(cuts[i], cuts[i + 1])));
            c.close();
        }
    });
    return { gz, stream };
}

function fetchHarness(headersFor) {
    const payload = { extracted_at: 'x', data: [{ nct_id: 'NCT00000001' }, { nct_id: 'NCT00000002' }] };
    const context = vm.createContext({
        console: { log() {}, warn() {} },
        DATA_CACHE_VERSION: 'test', hasDecompressionStream: true, ensurePako: async () => {},
        Response, TransformStream, DecompressionStream,
        fetch: async () => {
            const { gz, stream } = gzBody(payload);
            return new Response(stream, { status: 200, headers: headersFor(gz.length) });
        }
    });
    vm.runInContext(fetcher, context);
    return (onProgress) => vm.runInContext('fetchAndDecompress', context)('data/demographics.part1.json.gz', onProgress);
}

test('a part reports its bytes as they arrive, ending at its Content-Length', T, async () => {
    let size = 0;
    const get = fetchHarness((n) => { size = n; return { 'content-length': String(n) }; });
    const calls = [];
    const json = await get((loaded, total) => calls.push([loaded, total]));
    assert.equal(json.data.length, 2, 'the part still parses');
    assert.deepEqual(calls[0], [0, size], 'the size is reported before any bytes');
    assert.ok(calls.length >= 4, 'progress arrives chunk by chunk, not at the end');
    assert.deepEqual(calls.at(-1), [size, size]);
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i][0] >= calls[i - 1][0], 'bytes never go backwards');
});

test('a body re-encoded in transit, or sent without a length, reports no total', T, async () => {
    const encoded = fetchHarness((n) => ({ 'content-length': String(n), 'content-encoding': 'br' }));
    const a = [];
    await encoded((loaded, total) => a.push(total));
    assert.ok(a.every((t) => t === null), 'a Content-Length for encoded bytes was taken as the total');

    const unsized = fetchHarness(() => ({}));
    const b = [];
    await unsized((loaded, total) => b.push(total));
    assert.ok(b.every((t) => t === null));
});

test('without a progress callback the part loads as before', T, async () => {
    const get = fetchHarness((n) => ({ 'content-length': String(n) }));
    const json = await get();
    assert.deepEqual(json.data.map((s) => s.nct_id), ['NCT00000001', 'NCT00000002']);
});

test('the parts progress is the mean of each part, with the total once every size is known', () => {
    const ctx = vm.createContext({});
    vm.runInContext(helpers, ctx);
    const d = (l, t, f) => JSON.parse(JSON.stringify(vm.runInContext('describePartsProgress', ctx)(l, t, f)));
    const MB = 1e6;
    // Two parts sized and half done.
    assert.deepEqual(d([10 * MB, 10 * MB], [20 * MB, 20 * MB], [false, false]), { fraction: 0.5, text: '20 of 40 MB' });
    // One part not started (no headers yet): no total, and it counts as 0.
    assert.deepEqual(d([10 * MB, 0], [20 * MB, undefined], [false, false]), { fraction: 0.25, text: '10 MB' });
    // A part with no length counts as half done once bytes arrive, whole once finished.
    assert.deepEqual(d([5 * MB, 5 * MB], [10 * MB, null], [false, false]), { fraction: 0.5, text: '10 MB' }, 'a total was shown without every size');
    assert.equal(d([10 * MB, 7 * MB], [10 * MB, null], [true, true]).fraction, 1);
    // Never past 1, whatever the server says.
    assert.equal(d([30 * MB], [20 * MB], [false]).fraction, 1);
    assert.deepEqual(d([], [], []), { fraction: 0, text: '0 MB' });
});

function sampleHarness(width) {
    const made = [];
    const field = { clientWidth: width, appended: 0, appendChild(frag) { this.appended += frag.kids.length; } };
    const ctx = vm.createContext({
        document: {
            getElementById: (id) => (id === 'loading-sample' ? field : null),
            createDocumentFragment: () => ({ kids: [], appendChild(n) { this.kids.push(n); } }),
            createElement: () => {
                const el = { className: '', classes: new Set(), classList: { add: (c) => el.classes.add(c) } };
                made.push(el);
                return el;
            }
        }
    });
    vm.runInContext(sample, ctx);
    const fill = (f) => vm.runInContext('loadingSample', ctx).fill(f);
    const filled = () => made.filter((d) => d.classes.has('is-in')).length;
    return { made, field, fill, filled };
}

test('the sample field fills in proportion to the load, and never empties', () => {
    const h = sampleHarness(400);
    h.fill(0);
    const n = h.made.length;
    assert.equal(n % 5, 0, 'five full rows');
    assert.equal(n, 5 * Math.floor((400 + 8) / 14), 'the row is sized to the column (6px dot, 8px gap)');
    assert.equal(h.field.appended, n);
    h.fill(0.5);
    assert.equal(h.filled(), Math.round(n / 2));
    h.fill(0.3);
    assert.equal(h.filled(), Math.round(n / 2), 'a lower share (a new download starting) emptied dots');
    h.fill(1);
    assert.equal(h.filled(), n);
});

test('the sample field fills in a scattered order, the same on every load', () => {
    const firstQuarter = () => {
        const h = sampleHarness(400);
        h.fill(0.25);
        return h.made.map((d, i) => (d.classes.has('is-in') ? i : -1)).filter((i) => i >= 0);
    };
    const a = firstQuarter();
    assert.deepEqual(a, firstQuarter(), 'the order changed between loads');
    const cols = Math.floor((400 + 8) / 14);
    const rows = new Set(a.map((i) => Math.floor(i / cols)));
    assert.equal(rows.size, 5, 'the first quarter is not spread over every row');
    assert.notDeepEqual(a, a.map((_, k) => k), 'dots fill left to right, not scattered');
});

test('the sample field waits until it has a width', () => {
    const h = sampleHarness(0);
    h.fill(0.5);
    assert.equal(h.made.length, 0);
});

test('updateLoadingProgress writes to every open loading screen', () => {
    const screen = () => {
        const parts = {
            '.loading-progress-bar': { style: {} },
            '[role="progressbar"]': { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
            '.loading-status-text': { textContent: 'Starting up' },
            '.loading-bytes': { textContent: '' }
        };
        return { parts, querySelector: (sel) => parts[sel] || null };
    };
    const a = screen();
    const b = screen();
    let filledWith = null;
    const ctx = vm.createContext({
        document: { querySelectorAll: (sel) => (sel === '[data-load-progress]' ? [a, b] : []) },
        loadingSample: { fill: (f) => { filledWith = f; } },
        String, Math
    });
    vm.runInContext(updater, ctx);
    vm.runInContext('updateLoadingProgress', ctx)(42.6, 'Loading trial records', '64 of 152 MB');
    for (const s of [a, b]) {
        assert.equal(s.parts['.loading-progress-bar'].style.width, '42.6%');
        assert.equal(s.parts['[role="progressbar"]'].attrs['aria-valuenow'], '43');
        assert.equal(s.parts['.loading-status-text'].textContent, 'Loading trial records');
        assert.equal(s.parts['.loading-bytes'].textContent, '64 of 152 MB');
    }
    assert.equal(filledWith, 0.426);
    vm.runInContext('updateLoadingProgress', ctx)(78, undefined);
    assert.equal(a.parts['.loading-status-text'].textContent, 'Loading trial records', 'a missing stage blanked the old one');
    assert.equal(a.parts['.loading-bytes'].textContent, '', 'the bytes line outlived the download');
});

test('the loading screen credits its authors and announces progress accessibly', () => {
    const start = html.indexOf('<div id="loading-overlay"');
    const end = html.indexOf('</div>\n\n', start);
    assert.ok(start >= 0 && end > start, 'index.html lost the loading overlay');
    const overlay = html.slice(start, end);
    const text = overlay.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    assert.match(text, /Created and managed by Michael D\. Green and Maryam Aziz/);
    assert.match(overlay, /data-load-progress/);
    assert.match(overlay, /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="0"/);
    assert.match(overlay, /id="loading-status"[^>]*aria-live="polite"/);
    assert.match(overlay, /class="loading-bytes" aria-hidden="true"/, 'the megabytes line would be read aloud on every update');
});

test('the loading wording says loading, not downloading', () => {
    assert.doesNotMatch(html, /[Dd]ownload(ing|ed) /);
    for (const m of app.matchAll(/updateLoadingProgress\([^,]+,\s*([^)]*)\)/g)) {
        assert.doesNotMatch(m[1], /[Dd]ownload/, `a stage still says download: ${m[0]}`);
    }
});

// ── The loading screen's figure ──

const figureSrc = fnSource('function loadingFigureModel(summary)') +
    fnSource('function loadingFigureNote(summary, model)') +
    fnSource('function loadingFigureSVG(model, width)');

function figureHarness() {
    const ctx = vm.createContext({ COLORS: { reporting: { race: '#0F7A4F', both: '#2E6FB7' } } });
    vm.runInContext(figureSrc, ctx);
    const call = (name, ...args) => JSON.parse(JSON.stringify(vm.runInContext(name, ctx)(...args)) ?? 'null');
    const svg = (model, w) => vm.runInContext('loadingFigureSVG', ctx)(model, w);
    return { call, svg };
}

const summaryFixture = {
    extracted_at: '2026-09-27T11:49:53+00:00',
    totalStudies: 6000,
    byYear: {
        2017: { total: 1000, race_reported: 400, both_reported: 220 },
        2009: { total: 1000, race_reported: 360, both_reported: 150 },
        2013: { total: 0, race_reported: 0, both_reported: 0 },
        2021: { total: 2000, race_reported: 1480, both_reported: 940 },
        2026: { total: 2000, race_reported: 1620, both_reported: 1180 },
        2015: { total: 500, race_reported: null, both_reported: 70 }
    }
};

test('the figure shows each year as its own counts, and leaves out a year without them', () => {
    const { call } = figureHarness();
    const m = call('loadingFigureModel', summaryFixture);
    assert.deepEqual(m.years, ['2009', '2017', '2021', '2026'], 'a year with no trials, or a missing count, was drawn');
    assert.deepEqual(m.race, [36, 40, 74, 81]);
    assert.deepEqual(m.both, [15, 22, 47, 59]);
    assert.equal(call('loadingFigureModel', { byYear: { 2020: { total: 10, race_reported: 5, both_reported: 2 } } }), null, 'one year is not a trend');
    assert.equal(call('loadingFigureModel', {}), null);
});

test('the figure names its denominator, its size and how current it is', () => {
    const { call } = figureHarness();
    const m = call('loadingFigureModel', summaryFixture);
    assert.deepEqual(call('loadingFigureNote', summaryFixture, m), [
        "Percent of each year's trials with posted results, all study types",
        '6,000 trials · data as of Sep 27, 2026 · 2026 to date'
    ]);
});

test('the figure draws both lines, labels each end and says the same in words', () => {
    const { call, svg } = figureHarness();
    const out = svg(call('loadingFigureModel', summaryFixture), 416);
    assert.equal((out.match(/<path class="lf-line" pathLength="1"/g) || []).length, 2);
    for (const v of ['36%', '81%', '15%', '59%']) assert.match(out, new RegExp(`>${v}</text>`));
    assert.match(out, /aria-label="Race reported by 36% of trials with results posted in 2009 and 81% in 2026; race and ethnicity together by 15% and 59%\."/);
    assert.match(out, />Final Rule</, 'the 2017 marker the Overview chart carries is missing');
    assert.doesNotMatch(out, /NaN|undefined/);
});

test('each line name sits clear of its line, above the upper and below the lower', () => {
    const { call, svg } = figureHarness();
    const out = svg(call('loadingFigureModel', summaryFixture), 416);
    const pts = [...out.matchAll(/<path class="lf-line" pathLength="1" d="([^"]+)"/g)]
        .map((m) => m[1].split(/[ML]/).filter(Boolean).map((p) => p.split(',').map(Number)));
    const names = Object.fromEntries([...out.matchAll(/<text class="lf-name lf-late" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)</g)]
        .map((m) => [m[3], { right: +m[1], y: +m[2], left: +m[1] - m[3].length * 6.6 }]));
    const span = (line, n) => line.filter(([px]) => px >= n.left - 30 && px <= n.right + 2).map(([, py]) => py);
    const race = names['Race'];
    const both = names['Race and ethnicity'];
    assert.ok(race && both, 'a line lost its name');
    assert.ok(span(pts[0], race).every((py) => race.y < py - 4), 'the Race name touches its line');
    assert.ok(span(pts[1], both).every((py) => both.y - 10 > py), 'the Race and ethnicity name touches its line');
});

test('the summary is fetched once and shared; a failure is not remembered', T, async () => {
    const src = fnSource('function fetchLatestSummary()');
    let calls = 0;
    let fail = true;
    const ctx = vm.createContext({
        DATA_CACHE_VERSION: 'test',
        fetch: async () => {
            calls++;
            if (fail) throw new Error('offline');
            return { ok: true, json: async () => ({ byYear: {} }) };
        }
    });
    vm.runInContext(`let latestSummaryRequest = null;\n${src}`, ctx);
    const get = () => vm.runInContext('fetchLatestSummary()', ctx);
    await assert.rejects(get());
    fail = false;
    const [a, b] = await Promise.all([get(), get()]);
    assert.equal(calls, 2, 'the failure was remembered, or the figure and the mobile view fetched twice');
    assert.equal(a, b);
    const missing = vm.createContext({ DATA_CACHE_VERSION: 'test', fetch: async () => ({ ok: false, status: 404 }) });
    vm.runInContext(`let latestSummaryRequest = null;\n${src}`, missing);
    assert.equal(await vm.runInContext('fetchLatestSummary()', missing), null);
});

test('the figure is desktop only, and the mobile view reads the shared summary', () => {
    const init = app.slice(app.indexOf("document.addEventListener('DOMContentLoaded', async () => {"));
    assert.match(init, /if \(isMobileDevice\) renderLoadingFigure\(null\);\s*else keyReady\.then\(\(\) => fetchLatestSummary\(\)\)\.then\(renderLoadingFigure, \(\) => renderLoadingFigure\(null\)\);/);
    const load = fnSource('async function loadData(date)');
    assert.match(load, /const summary = await fetchLatestSummary\(\);/);
    assert.doesNotMatch(load, /fetch\(`data\/dashboard-summary\.json/, 'the mobile view fetches the summary a second time');
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    assert.match(css, /@media \(max-width: 768px\) \{\s*\.loading-figure \{\s*display: none;/);
    assert.match(html, /<figure class="loading-figure" id="loading-figure">/);
});

// ── The snapshot switcher's screen ──

test('reopening the snapshot screen resets what a screen reader hears', () => {
    const src = fnSource('function showSnapshotLoading(label)');
    const parts = {
        '.loading-title': { textContent: 'Loading 2026-05-31 snapshot…' },
        '.loading-progress-bar': { style: { width: '72%' } },
        '[role="progressbar"]': { attrs: { 'aria-valuenow': '72' }, setAttribute(k, v) { this.attrs[k] = v; } },
        '.loading-status-text': { textContent: 'Reading trial records' },
        '.loading-bytes': { textContent: '151 of 151 MB' }
    };
    const overlay = { style: {}, querySelector: (sel) => parts[sel] };
    const ctx = vm.createContext({ document: { getElementById: (id) => (id === 'snapshot-loading' ? overlay : null) } });
    vm.runInContext(src, ctx);
    vm.runInContext('showSnapshotLoading', ctx)('Loading 2026-06-14 snapshot…');
    assert.equal(parts['.loading-progress-bar'].style.width, '0%');
    assert.equal(parts['[role="progressbar"]'].attrs['aria-valuenow'], '0', 'the previous load\'s progress is still announced');
    assert.equal(parts['.loading-status-text'].textContent, 'Starting');
    assert.equal(parts['.loading-bytes'].textContent, '');
    assert.equal(overlay.style.display, 'flex');
});

test('a snapshot switch runs its meter to the end before the screen hides', () => {
    const handler = app.slice(app.indexOf("select.addEventListener('change', async () => {"));
    const bodies = {
        loadDataAndRender: fnSource('async function loadDataAndRender(date)'),
        'the snapshot selector': handler.slice(0, handler.indexOf('\n    });\n'))
    };
    for (const [name, src] of Object.entries(bodies)) {
        const at = (needle) => {
            const i = src.indexOf(needle);
            assert.ok(i >= 0, `${name} lost ${needle}`);
            return i;
        };
        const load = at('await loadData(');
        const filters = at("await snapshotStage(78, 'Setting up filters');");
        const charts = at("await snapshotStage(90, 'Drawing charts');");
        const render = at('renderDashboard();');
        const ready = at("await snapshotStage(100, 'Ready');");
        const hide = at('hideSnapshotLoading();');
        assert.ok(load < filters && filters < charts && charts < render && render < ready && ready < hide,
            `${name} does not advance the meter in order: load, 78, 90, render, 100, hide`);
    }
    const load = fnSource('async function loadData(date)');
    assert.match(load, /updateLoadingProgress\(60, 'Loading the archive summary'\);\s*const resp = await fetch\(`snapshots\/\$\{date\}\/dashboard-summary\.json/,
        'a summary-only archive leaves its meter at 0%');
});

test('the loading screens scroll in a window too short for them', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const rule = (sel) => {
        const m = css.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`));
        assert.ok(m, `styles.css lost ${sel}`);
        return m[1];
    };
    assert.match(rule('.loading-overlay'), /overflow-y: auto;/);
    assert.match(rule('.snapshot-loading-overlay'), /overflow-y: auto;/);
    assert.doesNotMatch(rule('.loading-overlay'), /justify-content: center/, 'centring with justify-content cuts off the top of an overflowing screen');
    assert.doesNotMatch(rule('.snapshot-loading-overlay'), /align-items: center/, 'centring with align-items cuts off the top of an overflowing panel');
});

test('the frame wait before drawing charts also ends in a hidden tab', T, async () => {
    const src = fnSource('async function snapshotStage(percent, statusText)');
    const seen = [];
    const ctx = vm.createContext({
        updateLoadingProgress: (p, s) => seen.push([p, s]),
        requestAnimationFrame: () => 0,          // a hidden tab: no frame ever comes
        setTimeout, Promise
    });
    vm.runInContext(src, ctx);
    await vm.runInContext('snapshotStage', ctx)(90, 'Drawing charts');
    assert.deepEqual(seen, [[90, 'Drawing charts']]);
});
