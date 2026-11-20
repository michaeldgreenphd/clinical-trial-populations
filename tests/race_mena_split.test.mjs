/**
 * Middle Eastern or North African (MENA) apart from White (engine:
 * race.mena_in_white, a PART of race.omb_totals.white; in the summary,
 * raceDistribution.mena_in_white).
 *
 * The race categories are the 1997 OMB ones, under which MENA is White, as
 * the registry's race template has them. OMB's 2024 revision makes MENA a
 * category of its own. The Race distribution's toggle shows White without the
 * participants of rows that name MENA groups, and those participants on a row
 * of their own, from the same published counts: nothing is added, and the
 * rows sum to what they summed to before. Data published before the engine
 * wrote the field has no such key: the toggle is unavailable and White whole.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
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

const MENA = 'Middle Eastern or North African';
const WHITE_WITHOUT = 'White, without Middle Eastern or North African';

// renderRaceDistribution with its DOM replaced by recorders: the rows' html,
// the note's text, and the toggle's state, by element id.
function raceDistribution({ summary = null, studies = [], apart = false }) {
    const elements = {};
    const element = (id) => (elements[id] ??= {
        id, set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; },
    });
    const context = vm.createContext({
        escapeHtml: (t) => String(t).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
        DEMO_INK: { absent: '#8A968F' }, DEMO_COLORS: { race: { white: '#0F7A4F' } },
        charts: {}, dashboardSummary: summary, captured: null,
        document: { getElementById: element },
    });
    vm.runInContext(lineAt('const DONUT_ABSENT_LABELS =') + blockAt('const RACE_ETHNICITY_ONLY_LABEL', '\n}\n')
        + blockAt('// ── Middle Eastern or North African apart from White', '// (end of the Middle Eastern or North African block)') + '\n'
        + fnAt('function demoScale(maxPct)') + fnAt('function demoRowsHtml(rows, opts = {})')
        + 'function demoRowsFromTotals(totals, colors) { captured = totals; return ('
        + fnAt('function demoRowsFromTotals(totals, colors)').replace('function demoRowsFromTotals(totals, colors)', 'function (totals, colors)')
        + ')(totals, colors); }\n'
        + fnAt('function renderRaceDistribution(filtered)'), context);
    vm.runInContext(`raceMenaApart = ${apart}; renderRaceDistribution(${JSON.stringify(studies)})`, context);
    const toggle = elements['race-mena-toggle'];
    return { totals: context.captured, html: elements['race-distribution-chart'].html,
        note: elements['race-mena-note'].textContent, disabled: toggle.disabled, checked: toggle.checked };
}

const race = (omb, mena) => ({ reported: true,
    omb_totals: { white: 0, black_african_american: 0, unknown_not_reported: 0, other: 0, ...omb },
    ...(mena === undefined ? {} : { mena_in_white: mena }) });
const sum = (totals) => Object.values(totals).reduce((a, b) => a + b, 0);

test('off by default: White is whole, as the 1997 categories count it', () => {
    const { totals, note, disabled, checked } = raceDistribution({ studies: [{ race: race({ white: 140, black_african_american: 20 }, 35) }] });
    assert.equal(totals.White, 140);
    assert.ok(!(MENA in totals));
    assert.equal(disabled, false);
    assert.equal(checked, false);
    assert.match(note, /White includes Middle Eastern or North African participants/);
});

test('on: White without MENA and a MENA row, from the same counts; nothing is added', () => {
    const studies = [
        { race: race({ white: 140, black_african_american: 20 }, 35) },
        { race: race({ white: 70, unknown_not_reported: 5 }, 0) },
        { race: { reported: false } },                                   // reports no race: not counted
    ];
    const off = raceDistribution({ studies });
    const on = raceDistribution({ studies, apart: true });
    assert.equal(on.totals[WHITE_WITHOUT], 210 - 35);
    assert.equal(on.totals[MENA], 35);
    assert.ok(!('White' in on.totals));
    assert.equal(sum(on.totals), sum(off.totals), 'the rows no longer add up to the participants');
    const labels = Object.keys(on.totals);
    assert.equal(labels.indexOf(MENA), labels.indexOf(WHITE_WITHOUT) + 1, 'the MENA row does not follow White');
    assert.match(on.html, new RegExp(MENA));
    assert.equal(on.checked, true);
    assert.match(on.note, /White: 210 with Middle Eastern or North African participants, 175 without them \(35 fewer, 16\.7% of White\)/);
});

test('the summary path reads the key the engine writes', () => {
    const summary = { raceDistribution: { white: 25590699, black_african_american: 10, mena_in_white: 17179 } };
    const on = raceDistribution({ summary, apart: true });
    assert.equal(on.totals[MENA], 17179);
    assert.equal(on.totals[WHITE_WITHOUT], 25590699 - 17179);
    assert.match(on.note, /0\.067% of White/);
});

test('data without the field: the toggle is unavailable and White stays whole, even if switched on', () => {
    const old = raceDistribution({ studies: [{ race: race({ white: 50 }) }], apart: true });
    assert.equal(old.totals.White, 50);
    assert.ok(!(MENA in old.totals));
    assert.equal(old.disabled, true);
    assert.equal(old.checked, false);
    assert.match(old.note, /Not available for this data: it does not carry a Middle Eastern or North African count/);
    const oldSummary = raceDistribution({ summary: { raceDistribution: { white: 80 } }, apart: true });
    assert.equal(oldSummary.totals.White, 80);
    assert.equal(oldSummary.disabled, true);
});

test('a null or non-numeric value is not a count: the toggle is unavailable', () => {
    for (const value of [null, '', '12', NaN, -1]) {
        const r = raceDistribution({ studies: [{ race: race({ white: 50 }, value) }], apart: true });
        assert.equal(r.disabled, true, `value ${JSON.stringify(value)} enabled the toggle`);
        assert.equal(r.totals.White, 50);
        assert.ok(!(MENA in r.totals));
    }
    const summary = raceDistribution({ summary: { raceDistribution: { white: 80, mena_in_white: null } }, apart: true });
    assert.equal(summary.disabled, true);
    assert.equal(summary.totals.White, 80);
});

test('a selection mixing trials with and without a count is not split', () => {
    const r = raceDistribution({ studies: [{ race: race({ white: 140 }, 35) }, { race: race({ white: 10 }) }], apart: true });
    assert.equal(r.disabled, true);
    assert.equal(r.totals.White, 150);
    assert.ok(!(MENA in r.totals));
});

test('a part larger than White is capped, never drawn below zero', () => {
    const { totals } = raceDistribution({ studies: [{ race: race({ white: 5 }, 9) }], apart: true });
    assert.equal(totals[WHITE_WITHOUT], 0);
    assert.equal(totals[MENA], 5);
});

test('the toggle is a labelled checkbox described by the note', () => {
    assert.match(html, /<label class="ai-toggle-label race-mena-toggle" for="race-mena-toggle">/);
    assert.match(html, /<input type="checkbox" id="race-mena-toggle" aria-describedby="race-mena-note">/);
    assert.match(html, /<p class="note" id="race-mena-note" aria-live="polite"><\/p>/);
});

// 2026-11-20: on data published before the count existed, the toggle was
// disabled but kept its clickable look (pointer, hover highlight, tinted box),
// and the reason sat in a note under the rows. It now looks unavailable and
// says why on hover.
test('an unavailable toggle looks unavailable and says why where the reader points', () => {
    const label = { title: '', removeAttribute(k) { delete this[k]; } };
    const toggle = { closest: (q) => (q === 'label' ? label : null), dataset: {} };
    const note = {};
    const context = vm.createContext({ document: { getElementById: (id) => (id === 'race-mena-toggle' ? toggle : note) } });
    vm.runInContext(blockAt('// ── Middle Eastern or North African apart from White', '// (end of the Middle Eastern or North African block)'), context);
    vm.runInContext('raceMenaControls(false, false, 0, 0)', context);
    assert.equal(toggle.disabled, true);
    assert.match(label.title, /^Not available for this data: it does not carry a Middle Eastern or North African count/);
    assert.equal(note.textContent, label.title, 'the tooltip and the note give different reasons');
    vm.runInContext('raceMenaControls(true, false, 100, 5)', context);
    assert.equal(toggle.disabled, false);
    assert.ok(!('title' in label), 'an available toggle still carries the unavailable tooltip');
    assert.match(css, /\.ai-toggle-label:has\(input:disabled\) \{[^}]*cursor: not-allowed;[^}]*border-style: dashed;/);
    assert.match(css, /\.ai-toggle-label:has\(input:disabled\):hover \{\s*border-color: var\(--border-color\);/);
});
