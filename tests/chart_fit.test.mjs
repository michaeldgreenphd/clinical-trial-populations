/**
 * Chart text in a window resized after load (app.js).
 *
 * isMobileDevice is fixed when the page loads, so a desktop window narrowed
 * afterwards kept every chart's desktop text: axis titles longer than their
 * axis ran off the canvas, an event caption landed on the Overview's y title,
 * the FDA dot plot's rows collapsed until values sat on the row above, and the
 * Overview chart, once narrowed, never grew back. The functions here are
 * app.js's own, sliced out and run in a vm against stub charts whose text
 * width is 7px a character.
 *
 * What is pinned: an axis title takes its short form, or is hidden, when the
 * full one does not fit its axis, and comes back with the room; an event
 * caption that fits neither side of its line is left out, never drawn over
 * the y title; the Overview chart is drawn again when its box crosses its
 * narrow width, and only then; the charts whose height used to follow a fixed
 * aspect ratio now take it from a box with a floor; and the Industry legend
 * goes under a narrow plot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const fnSource = (sig) => {
    const at = app.indexOf(sig);
    assert.ok(at >= 0, `app.js lost ${sig}`);
    return app.slice(at, app.indexOf('\n}\n', at) + 3);
};
const objSource = (start) => {
    const at = app.indexOf(start);
    assert.ok(at >= 0, `app.js lost ${start}`);
    return app.slice(at, app.indexOf('\n};\n', at) + 4);
};

// A canvas context whose text is 7px a character, recording what it draws.
function stubCtx() {
    const drawn = [];
    return {
        drawn, font: '', textAlign: 'left', textBaseline: 'alphabetic', fillStyle: '', strokeStyle: '', lineWidth: 1,
        save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {},
        measureText: (t) => ({ width: String(t).length * 7 }),
        fillText(text, x, y) { drawn.push({ text: String(text), x, y, align: this.textAlign }); }
    };
}

function context(extra = {}) {
    const frames = [];
    const ctx = vm.createContext({
        Chart: { helpers: { toFont: () => ({ string: '12px sans-serif' }) } },
        requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
        ...extra
    });
    return { ctx, frames, run: (src) => vm.runInContext(src, ctx) };
}

// ── Axis titles ──

// A chart with one vertical axis whose title is `text` (and `short`), on a
// canvas `h` tall with the plot from `top` to `bottom`.
function titledChart({ h, top, bottom, text, short }) {
    const updates = [];
    const title = { display: true, text, ...(short ? { short } : {}) };
    const scaleTitle = { ...title };
    return {
        updates, title, scaleTitle,
        width: 600, height: h, ctx: stubCtx(), canvas: {},
        chartArea: { top, bottom, left: 60, right: 580 },
        options: { scales: { y: { title } } },
        scales: { y: { isHorizontal: () => false, options: { title: scaleTitle } } },
        update(mode) { updates.push(mode); }
    };
}

test('an axis title too long for its axis takes its short form, or is hidden, and comes back with the room', () => {
    const { run, frames, ctx } = context();
    run(objSource('const civicAxisTitleFitPlugin = {') + 'globalThis.civicAxisTitleFitPlugin = civicAxisTitleFitPlugin;');
    const plugin = ctx.civicAxisTitleFitPlugin;
    // "Number of Authorizations" is 24 characters, 168px here.
    const chart = titledChart({ h: 400, top: 20, bottom: 360, text: 'Number of Authorizations', short: 'Authorizations' });
    plugin.afterLayout(chart);
    assert.equal(chart.title.text, 'Number of Authorizations', 'a title with room was changed');
    assert.equal(chart.title.display, true);
    assert.equal(frames.length, 0, 'a title with room asked for another layout');
    // Plot 34..154 on a 194px canvas (the AI timeline at 420px): centre 94,
    // so 186px of room less 2. The full title (168) fits; at 150px tall it
    // does not, and the short one (98) does, on the same line: no relayout.
    chart.height = 150; chart.chartArea = { top: 20, bottom: 110, left: 60, right: 580 };
    plugin.afterLayout(chart);
    assert.equal(chart.title.text, 'Authorizations', 'the full title was kept where it is cut off');
    assert.equal(chart.scaleTitle.text, 'Authorizations', "the scale's own options would still draw the full title");
    assert.equal(frames.length, 0, 'swapping to the short title, which takes the same line, asked for another layout');
    // Too short for either: hidden, and one more layout gives back its line.
    chart.height = 80; chart.chartArea = { top: 10, bottom: 60, left: 60, right: 580 };
    plugin.afterLayout(chart);
    assert.equal(chart.title.display, false, 'a title that fits in no form is still drawn');
    assert.equal(chart.scaleTitle.display, false);
    assert.equal(frames.length, 1, 'hiding the title did not lay the chart out again');
    plugin.afterLayout(chart);
    assert.equal(frames.length, 1, 'a second pending layout was asked for');
    frames.shift()();
    assert.deepEqual(chart.updates, ['none']);
    plugin.afterLayout(chart);
    assert.equal(frames.length, 0, 'the same size asked for another layout: it does not settle');
    // Room again: the full title, and its line back.
    chart.height = 400; chart.chartArea = { top: 20, bottom: 360, left: 60, right: 580 };
    plugin.afterLayout(chart);
    assert.equal(chart.title.display, true);
    assert.equal(chart.title.text, 'Number of Authorizations', 'the full title did not come back with the room');
    assert.equal(frames.length, 1, 'showing the title again did not lay the chart out again');
});

test('a title with no short form is hidden rather than cut; a chart without titles is left alone', () => {
    const { run, frames, ctx } = context();
    run(objSource('const civicAxisTitleFitPlugin = {') + 'globalThis.civicAxisTitleFitPlugin = civicAxisTitleFitPlugin;');
    const plugin = ctx.civicAxisTitleFitPlugin;
    const chart = titledChart({ h: 120, top: 10, bottom: 80, text: 'Trials not in the Reported state' });
    plugin.afterLayout(chart);
    assert.equal(chart.title.display, false);
    assert.equal(frames.length, 1);
    const bare = { width: 600, height: 300, ctx: stubCtx(), canvas: {}, chartArea: { top: 0, bottom: 280, left: 0, right: 600 },
        options: { scales: { x: { ticks: {} } } }, scales: { x: { isHorizontal: () => true, options: {} } }, update() { throw new Error('updated'); } };
    plugin.afterLayout(bare);
    assert.deepEqual(Object.keys(bare.options.scales.x), ['ticks'], 'a scale without a title was given one');
});

test('the axis-title plugin is registered, and the clipped titles carry a short form', () => {
    assert.match(app, /Chart\.register\(civicWatermarkPlugin, civicEventLinesPlugin, civicAxisTitleFitPlugin\)/);
    assert.equal((app.match(/text: 'Number of Authorizations', short: 'Authorizations'/g) || []).length, 2, 'an AI Devices chart lost its short title');
    assert.match(app, /yTitle: 'Trials not in the Reported state', yTitleShort: 'Trials'/);
    assert.match(fnSource('function demoConfig(config, spec = {})'), /short: spec\.yTitleShort/);
    assert.match(fnSource('function renderIndustryTrend(rows)'), /'Median % female per trial', short: '% female'/);
});

// ── Event captions ──

function eventChart({ px, left = 60, right = 560, top = 40, above = false, label = 'FDAAA Final Rule effective', legendShown = false }) {
    return {
        canvas: { id: 'test-chart' },
        ctx: stubCtx(),
        chartArea: { left, right, top, bottom: 300 },
        data: { labels: ['2016', '2017', '2018'] },
        scales: { x: { getPixelForValue: () => px } },
        options: { plugins: { legend: { display: legendShown }, eventLines: [{ x: '2017', label, above }] } }
    };
}

test('an event caption goes right of its line, else left, else is left out, and above the plot never goes left', () => {
    const { run, ctx } = context({ CHART_EVENT_LINES: {} });
    run(objSource('const civicEventLinesPlugin = {') + 'globalThis.civicEventLinesPlugin = civicEventLinesPlugin;');
    const plugin = ctx.civicEventLinesPlugin;
    const label = 'FDAAA Final Rule effective';   // 26 characters: 182px
    const right = eventChart({ px: 200 });
    plugin.beforeDatasetsDraw(right);
    assert.equal(right.ctx.drawn.length, 1);
    assert.equal(right.ctx.drawn[0].align, 'left', 'a caption with room on the right was not drawn there');
    const left = eventChart({ px: 450 });
    plugin.beforeDatasetsDraw(left);
    assert.equal(left.ctx.drawn[0].align, 'right', 'a caption with room only on the left was not drawn there');
    assert.ok(left.ctx.drawn[0].x - label.length * 7 > left.chartArea.left, 'the left caption starts outside the plot');
    // A narrowed window: no room either side. The dashed line stays (the
    // footnotes name every captioned marker); the caption is not drawn.
    const neither = eventChart({ px: 160, left: 60, right: 260 });
    plugin.beforeDatasetsDraw(neither);
    assert.equal(neither.ctx.drawn.length, 0, 'a caption with no room was drawn over the plot edge');
    // Above the plot (the Overview), the left is the y title's: a caption
    // that fits only there is left out.
    const aboveLeft = eventChart({ px: 450, above: true });
    plugin.beforeDatasetsDraw(aboveLeft);
    assert.equal(aboveLeft.ctx.drawn.length, 0, 'a caption above the plot was flipped onto the y title');
    const aboveRight = eventChart({ px: 200, above: true });
    plugin.beforeDatasetsDraw(aboveRight);
    assert.equal(aboveRight.ctx.drawn.length, 1);
    assert.equal(aboveRight.ctx.drawn[0].y, aboveRight.chartArea.top - 10, 'the caption above the plot moved');
});

test('every chart with a captioned marker names its markers in a footnote too', () => {
    // Leaving a caption out is safe only because the page still says what
    // the line is.
    const block = app.slice(app.indexOf('const CHART_EVENT_LINES = {'), app.indexOf('};', app.indexOf('const CHART_EVENT_LINES = {')));
    const captioned = [...block.matchAll(/'([\w-]+-chart)': \[([\s\S]*?)\](?=,\n|\n)/g)]
        .filter(([, , body]) => /label: '[^']+'/.test(body)).map(([, id]) => id);
    assert.deepEqual(captioned.sort(), ['ai-nonk-chart', 'ai-timeline-chart', 'reporting-trends-chart']);
    for (const id of captioned) {
        const at = html.indexOf(`<canvas id="${id}"`);
        assert.ok(at > 0, `${id} is not in index.html`);
        const after = html.slice(at, html.indexOf('</div>', html.indexOf('</div>', at) + 1));
        assert.match(after, /class="chart-footnote[^"]*">(Dashed 2017 marker|Markers:)/, `${id} has no footnote naming its markers`);
    }
});

// ── The Overview chart and the window ──

function overviewHarness({ narrowDrawn = false, args = { filtered: ['a'], counted: null } } = {}) {
    const charts = { reportingTrends: { civicNarrow: narrowDrawn } };
    let observed = null;
    const calls = [];
    const box = { clientWidth: 900 };
    const canvas = { parentElement: box, civicTrendArgs: args };
    const { run, frames } = context({
        document: { getElementById: (id) => (id === 'reporting-trends-chart' ? canvas : null) },
        ResizeObserver: function (cb) { this.observe = (el) => { observed = { el, cb }; }; },
        charts,
        renderReportingTrends: (filtered, counted) => calls.push([filtered, counted])
    });
    run(fnSource('function initReportingTrendsResize()'));
    run('initReportingTrendsResize()');
    return { box, calls, frames, canvas, charts, fire: () => observed.cb([]), observed: () => observed };
}

test('the Overview chart is drawn again when its box crosses the narrow width, and only then', () => {
    const h = overviewHarness({ narrowDrawn: false });
    assert.ok(h.observed(), 'nothing watches the chart box');
    h.fire();                                   // 900px, drawn wide: nothing to do
    assert.equal(h.frames.length, 0);
    h.box.clientWidth = 0; h.fire();            // the tab hidden
    assert.equal(h.frames.length, 0, 'a hidden chart was drawn again');
    h.box.clientWidth = 480; h.fire(); h.fire();
    assert.equal(h.frames.length, 1, 'crossing to narrow did not redraw once');
    h.frames.shift()();
    assert.deepEqual(h.calls, [[['a'], null]], 'the redraw did not use what the chart was last asked to draw');
    // Drawn narrow now; staying narrow does nothing, widening redraws.
    const n = overviewHarness({ narrowDrawn: true, args: { filtered: null, counted: { 2020: {} } } });
    n.box.clientWidth = 500; n.fire();
    assert.equal(n.frames.length, 0);
    n.box.clientWidth = 1200; n.fire();
    n.frames.shift()();
    assert.deepEqual(n.calls, [[null, { 2020: {} }]], 'the first view was not redrawn from its own counts');
});

test('the Overview chart takes its height from its box, records what it drew, and does not animate a redesign', () => {
    const src = fnSource('function renderReportingTrends(filtered, counted)');
    assert.match(src, /ctx\.civicTrendArgs = \{ filtered, counted \};/);
    assert.match(src, /charts\.reportingTrends\.civicNarrow = narrow;/);
    assert.match(src, /ctx\.parentElement\.style\.aspectRatio = String\(shape\)/);
    assert.match(src, /maintainAspectRatio: false/);
    assert.match(src, /fromFirstView \|\| redesign \? \{ animation: false \}/);
    assert.ok(src.indexOf('ctx.civicTrendArgs') < src.indexOf('if (fromFirstView && !counted'), 'the arguments are recorded only after the first view can return early');
    assert.match(app, /initOverlayOpeners\(\);[\s\S]{0,200}initReportingTrendsResize\(\);/, 'initReportingTrendsResize is not called at startup');
    // An aspect-ratio box takes its content's height as its minimum unless
    // told otherwise; the canvas drawn wide would hold it open.
    assert.match(css, /#overview \.overview-trends-canvas \{[^}]*min-height: 0;/);
});

// ── The FDA dot plot and the Industry trend ──

test("the FDA dot plot's height has a floor, and its narrow treatment follows the chart's width", () => {
    assert.match(html, /<div class="fda-reporting-canvas" id="fda-reporting-wrap"><canvas id="fda-reporting-chart"><\/canvas><\/div>/);
    assert.match(css, /\.fda-reporting-canvas \{[^}]*aspect-ratio: 2\.6;[^}]*min-height: 360px;/);
    const src = app.slice(app.indexOf('function renderFdaOversight(filtered)'), app.indexOf('plugins: [ChartDataLabels, fdaRowConnectorPlugin]'));
    assert.match(src, /const narrow = \(chart\) => isMobileDevice \|\| chart\.width < 640;/);
    assert.match(src, /maintainAspectRatio: false/);
    assert.doesNotMatch(src, /aspectRatio: isMobileDevice \? 1 : 2\.6/);
    assert.match(src, /if \(!narrow\(this\.chart\)\) return text;\s*text = text\.replace\(/, 'the row names keep their (n=…) on a narrow chart');
    assert.match(src, /display: \(c\) => \(narrow\(c\.chart\) \? 'auto' : true\)/, 'colliding values on a narrow chart are drawn over each other');
    assert.match(src, /align: \(c\) => \(narrow\(c\.chart\) && c\.datasetIndex === 1 \? 'bottom' : 'top'\)/);
    // The archive without FDA data hides the box as well as the canvas.
    assert.match(src, /const wrap = document\.getElementById\('fda-reporting-wrap'\);\s*if \(wrap\) wrap\.style\.display = 'none';/);
});

test('the Industry legend goes under a narrow plot, and the trend box has a floor', () => {
    const { run, ctx } = context({ CHART_LEGEND_POSITION: 'right' });
    run(fnSource('function industryLegendPosition(width)'));
    assert.equal(ctx.industryLegendPosition(420), 'bottom');
    assert.equal(ctx.industryLegendPosition(900), 'right');
    assert.equal(ctx.industryLegendPosition(0), 'right', 'an unmeasured box moved the legend');
    const plugin = objSource('const industryTrendEndLabels = {');
    assert.match(plugin, /resize\(chart, args\) \{\s*if \(args && args\.size\) chart\.options\.plugins\.legend\.position = industryLegendPosition\(args\.size\.width\);/);
    assert.match(css, /\.industry-canvas-wrap \{[^}]*aspect-ratio: 2;[^}]*min-height: 340px;/);
    assert.match(fnSource('function renderIndustryTrend(rows)'), /responsive: true, maintainAspectRatio: false,/);
});

test("a demographic chart's legend entry too wide for the chart takes its short name, and the definitions stay in the footnote", () => {
    const demo = fnSource('function demoConfig(config, spec = {})');
    assert.match(demo, /generateLabels: \(chart\) => \{[\s\S]*?if \(!spec\.names\) return items;[\s\S]*?if \(spec\.names\[it\.text\] && chart\.ctx\.measureText\(it\.text\)\.width > room\) it\.text = spec\.names\[it\.text\];/,
        'a legend entry wider than the chart is no longer swapped for its short name');
    // The short names drop the definitions in brackets; the footnote keeps them.
    const pf = fnSource('function sgRenderPercentFemale(filtered)');
    assert.match(pf, /foot\.textContent = 'Mean of within-trial % female: each trial counts once\. Participant-weighted % female: sum female \/ \(sum female \+ male\)\. '/);
    assert.match(pf, /names: \{ \[aLabel\]: 'Mean of within-trial % female', \[bLabel\]: 'Participant-weighted' \}/);
});

test('a render between the resize and its frame wins: the frame uses the newest arguments, or does nothing', () => {
    // A filter change draws the chart after the resize asked for a frame:
    // the frame redraws from the filter change's arguments, not the old ones.
    const h = overviewHarness({ narrowDrawn: false, args: { filtered: ['old'], counted: null } });
    h.box.clientWidth = 480; h.fire();
    assert.equal(h.frames.length, 1);
    h.canvas.civicTrendArgs = { filtered: ['new'], counted: null };
    h.frames.shift()();
    assert.deepEqual(h.calls, [[['new'], null]], 'the frame redrew the chart with the arguments from before the filter change');
    // The records take over from the first view, already drawn narrow at this
    // width: nothing left to do.
    const g = overviewHarness({ narrowDrawn: false, args: { filtered: null, counted: { 2020: {} } } });
    g.box.clientWidth = 480; g.fire();
    g.canvas.civicTrendArgs = { filtered: ['records'], counted: null };
    g.charts.reportingTrends = { civicNarrow: true };
    g.frames.shift()();
    assert.deepEqual(g.calls, [], 'a chart already drawn for this width was drawn again');
});
