/**
 * The part of race unknown that a combined race and ethnicity table counted
 * as Hispanic or Latino and gave no race (engine: race.unknown_ethnicity_only,
 * a PART of race.omb_totals.unknown_not_reported).
 *
 * The Race distribution rows and the study's race breakdown take it out of
 * "Unknown" and show it on a row of its own. Nothing is added: the rows sum to
 * what they summed to before. A record, or a summary, published before the
 * engine wrote the field has no such key, and its unknown is shown whole, as
 * it always was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
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

const LABEL = 'Hispanic or Latino, no race category';

// renderRaceDistribution with its DOM and chart helpers replaced by recorders.
function raceDistribution({ summary = null, studies = [] }) {
    const context = vm.createContext({
        escapeHtml: (t) => String(t).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
        DEMO_INK: { absent: '#8A968F' }, DEMO_COLORS: { race: { white: '#0F7A4F' } },
        charts: {}, dashboardSummary: summary, captured: null,
        document: { getElementById: () => ({ set innerHTML(v) { context.html = v; } }) },
    });
    vm.runInContext(blockAt('const DONUT_ABSENT_LABELS =', ']);\n') + blockAt('const RACE_ETHNICITY_ONLY_LABEL', '\n}\n')
        + fnAt('function demoScale(maxPct)') + fnAt('function demoRowsHtml(rows, opts = {})')
        + 'function demoRowsFromTotals(totals, colors) { captured = totals; return ('
        + fnAt('function demoRowsFromTotals(totals, colors)').replace('function demoRowsFromTotals(totals, colors)', 'function (totals, colors)')
        + ')(totals, colors); }\n'
        + fnAt('function renderRaceDistribution(filtered)'), context);
    vm.runInContext(`renderRaceDistribution(${JSON.stringify(studies)})`, context);
    return { totals: context.captured, html: context.html };
}

const race = (omb, part) => ({ reported: true, omb_totals: { white: 0, black_african_american: 0, unknown_not_reported: 0, other: 0, ...omb },
    ...(part === undefined ? {} : { unknown_ethnicity_only: part }) });

test('the part is taken out of Unknown and shown on its own row; nothing is added', () => {
    const studies = [
        { race: race({ white: 39, black_african_american: 10, unknown_not_reported: 4 }, 2) },   // NCT00416078's shape
        { race: race({ white: 50, unknown_not_reported: 10 }, 0) },
        { race: race({ white: 5, unknown_not_reported: 3 }) },                                   // published before the field
    ];
    const { totals, html } = raceDistribution({ studies });
    assert.equal(totals.Unknown, 2 + 10 + 3);
    assert.equal(totals[LABEL], 2);
    const before = 39 + 10 + 4 + 50 + 10 + 5 + 3;
    assert.equal(Object.values(totals).reduce((a, b) => a + b, 0), before, 'the rows no longer add up to the participants');
    assert.match(html, new RegExp(`${LABEL}`));
    // drawn as an absence row, after the race rows
    const rowFor = (label) => html.split('<div class="demo-row').find((r) => r.includes(`>${label}<`));
    assert.match(rowFor(LABEL), /^ demo-absent/);
    assert.match(rowFor('Unknown'), /^ demo-absent/);
});

test('records and summaries without the field show unknown whole, as before', () => {
    const { totals, html } = raceDistribution({ studies: [{ race: race({ white: 5, unknown_not_reported: 3 }) }] });
    assert.equal(totals.Unknown, 3);
    assert.equal(totals[LABEL], 0);
    assert.ok(!html.includes(LABEL), 'a zero part drew a row');
    const old = raceDistribution({ summary: { raceDistribution: { white: 80, unknown_not_reported: 20 } } });
    assert.equal(old.totals.Unknown, 20);
    assert.equal(old.totals[LABEL], 0);
});

test('the phone path reads the summary key the engine writes', () => {
    const { totals } = raceDistribution({ summary: { raceDistribution: { white: 80, unknown_not_reported: 20, unknown_ethnicity_only: 6 } } });
    assert.equal(totals.Unknown, 14);
    assert.equal(totals[LABEL], 6);
});

test('a part larger than the unknown it belongs to is capped, never drawn below zero', () => {
    const { totals } = raceDistribution({ studies: [{ race: race({ white: 5, unknown_not_reported: 3 }, 9) }] });
    assert.equal(totals.Unknown, 0);
    assert.equal(totals[LABEL], 3);
});

test('the study breakdown shows the part on its own row and subtracts it from Unknown', () => {
    const src = fnAt('function breakdownHtml(study, categoryName, tab)');
    assert.match(src, /raceUnknownEthnicityOnly\(study\.race\?\.unknown_ethnicity_only, ombTotals\.unknown_not_reported\)/);
    assert.match(src, /cat\.key === 'unknown_not_reported' \? ethnicityOnly : 0/);
    assert.match(src, /if \(ethnicityOnly > 0\)/);
    assert.match(lineAt('const RACE_ETHNICITY_ONLY_LABEL'), new RegExp(LABEL));
});
