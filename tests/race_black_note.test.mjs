/**
 * The Race distribution's Black row says what its name is.
 *
 * "Black or African American" is OMB's name for a category that counts every
 * Black participant, not only African Americans; outside the United States
 * most of its rows come from the registry's "Race (NIH/OMB)" template, whose
 * wording is the registry's. The row's label carries that as a tooltip:
 * focusable, shown on hover and on focus, and the label's accessible
 * description. The note is the row's last cell, spanning the row in the flow,
 * so the panel's overflow cannot clip it (a review finding: placed over the
 * rows below, it was cut off when its row was the last one). No other row has
 * one, and a row without a note is drawn as it was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const fnAt = (sig) => {
    const at = app.indexOf(sig);
    assert.ok(at >= 0, `app.js lost ${sig}`);
    return app.slice(at, app.indexOf('\n}\n', at) + 2);
};
const lineAt = (sig) => {
    const at = app.indexOf(sig);
    assert.ok(at >= 0, `app.js lost ${sig}`);
    return app.slice(at, app.indexOf('\n', at) + 1);
};
const blockAt = (sig, end) => {
    const at = app.indexOf(sig);
    assert.ok(at >= 0, `app.js lost ${sig}`);
    return app.slice(at, app.indexOf(end, at) + end.length);
};

const escapeHtml = (t) => String(t).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function rowsHarness() {
    const context = vm.createContext({ escapeHtml, DEMO_INK: { absent: '#8A968F' } });
    vm.runInContext(lineAt('const DONUT_ABSENT_LABELS =') + fnAt('function demoScale(maxPct)')
        + fnAt('function demoRowsHtml(rows, opts = {})') + fnAt('function demoRowsFromTotals(totals, colors)'), context);
    return (src) => vm.runInContext(src, context);
}

// renderRaceDistribution with its DOM replaced by recorders, as in
// race_mena_split.test.mjs.
function raceDistribution(studies, apart = false) {
    const elements = {};
    const element = (id) => (elements[id] ??= {
        id, set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; },
    });
    const context = vm.createContext({
        escapeHtml, DEMO_INK: { absent: '#8A968F' }, DEMO_COLORS: { race: { white: '#0F7A4F' } },
        charts: {}, dashboardSummary: null, document: { getElementById: element },
    });
    vm.runInContext(lineAt('const DONUT_ABSENT_LABELS =') + blockAt('const RACE_ETHNICITY_ONLY_LABEL', '\n}\n')
        + blockAt('// ── Middle Eastern or North African apart from White', '// (end of the Middle Eastern or North African block)') + '\n'
        + fnAt('function demoScale(maxPct)') + fnAt('function demoRowsHtml(rows, opts = {})')
        + fnAt('function demoRowsFromTotals(totals, colors)') + fnAt('function renderRaceDistribution(filtered)'), context);
    vm.runInContext(`raceMenaApart = ${apart}; renderRaceDistribution(${JSON.stringify(studies)})`, context);
    return elements['race-distribution-chart'].html;
}

const race = (omb, mena) => ({ race: { reported: true,
    omb_totals: { white: 0, black_african_american: 0, asian: 0, unknown_not_reported: 0, other: 0, ...omb },
    ...(mena === undefined ? {} : { mena_in_white: mena }) } });

// Each row's label element, by its visible name.
function labels(html) {
    const out = {};
    for (const m of html.matchAll(/<div class="demo-row[^"]*" role="listitem">(<span class="demo-label[\s\S]*?)<span class="demo-bar"/g)) {
        const name = m[1].replace(/<[^>]+>/g, '').replace('&#9432;', '');
        out[name] = m[1];
    }
    return out;
}

// Each row's whole element, by its label's visible name.
function rowsByName(html) {
    const out = {};
    for (const m of html.matchAll(/<div class="demo-row[^"]*" role="listitem">[\s\S]*?<\/div>/g)) {
        const label = m[0].match(/<span class="demo-label[^>]*>([\s\S]*?)<span class="demo-(?:note-mark|bar)|<span class="demo-label[^>]*>([^<]*)<\/span>/);
        out[(label[1] ?? label[2]).replace(/<[^>]+>/g, '')] = m[0];
    }
    return out;
}

test('a row with a note: its label is focusable and described by the note', () => {
    const run = rowsHarness();
    const html = run(`demoRowsHtml([{ label: 'A & B', value: 3, color: '#000', note: 'x < y' }, { label: 'C', value: 1, color: '#000' }], { idPrefix: 'p' })`);
    const l = labels(html);
    assert.equal(l['A &amp; B'], '<span class="demo-label demo-label-noted" tabindex="0" aria-describedby="p-note-0">A &amp; B'
        + '<span class="demo-note-mark" aria-hidden="true">&#9432;</span></span>');
    assert.equal(l.C, '<span class="demo-label">C</span>');
    // The note is the row's last cell, after the count, not inside the label.
    const rows = rowsByName(html);
    assert.match(rows['A &amp; B'], /<span class="demo-n">[\s\S]*?<\/span><\/span><span class="demo-note" role="tooltip" id="p-note-0">x &lt; y<\/span><\/div>$/);
    assert.doesNotMatch(rows.C, /demo-note/);
});

test('rows without a note are drawn as before', () => {
    const run = rowsHarness();
    const rows = `[{ label: 'White', value: 5, color: '#000' }, { label: 'Unknown', value: 2, absent: true, texture: 'hatch', color: '#888' }]`;
    const html = run(`demoRowsHtml(${rows})`);
    assert.doesNotMatch(html, /tabindex|demo-note|aria-describedby/);
    assert.match(html, /<span class="demo-label">White<\/span><span class="demo-bar"/);
});

test('ids follow the prefix and the row, so two charts never share one', () => {
    const run = rowsHarness();
    const a = run(`demoRowsHtml([{ label: 'X', value: 1, color: '#000', note: 'n' }], { idPrefix: 'race-distribution' })`);
    const b = run(`demoRowsHtml([{ label: 'X', value: 1, color: '#000', note: 'n' }])`);
    assert.match(a, /id="race-distribution-note-0"/);
    assert.match(b, /id="demo-note-0"/);
});

test('the Race distribution gives only the Black row the note', () => {
    const html = raceDistribution([race({ white: 60, black_african_american: 30, asian: 10 })]);
    const l = labels(html);
    assert.deepEqual(Object.keys(l).sort(), ['Asian', 'Black/African American', 'White']);
    assert.match(l['Black/African American'], /demo-label-noted/);
    assert.match(l['Black/African American'], /aria-describedby="race-distribution-note-\d+"/);
    assert.equal(l.White, '<span class="demo-label">White</span>');
    assert.equal(l.Asian, '<span class="demo-label">Asian</span>');
    const note = rowsByName(html)['Black/African American'].match(/role="tooltip"[^>]*>([^<]*)</)[1];
    assert.match(note, /OMB’s name for the category/);
    assert.match(note, /every Black participant, not only African Americans/);
    assert.match(note, /registry’s “Race \(NIH\/OMB\)” template/);
});

test('the note stays on the Black row with Middle Eastern or North African apart', () => {
    const html = raceDistribution([race({ white: 60, black_african_american: 30 }, 5)], true);
    const l = labels(html);
    assert.match(l['Black/African American'], /demo-label-noted/);
    for (const [name, row] of Object.entries(rowsByName(html))) {
        if (name !== 'Black/African American') assert.doesNotMatch(row, /demo-note|demo-label-noted/, name);
        else assert.match(row, /<span class="demo-note" role="tooltip" id="race-distribution-note-\d+">/);
    }
});

test('no Black participants, no row and no note', () => {
    const html = raceDistribution([race({ white: 60, asian: 10 })]);
    assert.doesNotMatch(html, /demo-note|Black/);
});

test('the note is hidden until the label is hovered or focused', () => {
    assert.match(css, /\.demo-note \{\s*display: none;/);
    assert.match(css, /\.demo-label-noted:hover ~ \.demo-note,\s*\.demo-label-noted:focus ~ \.demo-note,\s*\.demo-note:hover \{ display: block; \}/);
    assert.match(css, /\.demo-label-noted:focus-visible \{ outline:/);
    const rule = css.slice(css.indexOf('.demo-note {'), css.indexOf('}', css.indexOf('.demo-note {')));
    assert.match(rule, /background: #[0-9a-f]{6};/i);
});

test('the note spans its row in the flow, within the panel', () => {
    // Absolutely placed, it was clipped by .chart-container's overflow: hidden
    // when its row was last, and ran past the panel at 390px.
    const rule = css.slice(css.indexOf('.demo-note {'), css.indexOf('}', css.indexOf('.demo-note {')));
    assert.doesNotMatch(rule, /position:/);
    assert.match(rule, /grid-column: 1 \/ -1;/);
    assert.match(rule, /box-sizing: border-box;/);
    assert.match(rule, /max-width: min\([^)]*, 100%\);/);
    const noted = css.slice(css.indexOf('.demo-label-noted {'), css.indexOf('}', css.indexOf('.demo-label-noted {')));
    assert.doesNotMatch(noted, /position:/);
});
