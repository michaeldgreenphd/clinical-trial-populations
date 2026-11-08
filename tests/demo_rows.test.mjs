/**
 * The composition rows that replaced the Demographics doughnuts.
 *
 * The legacy renderers start every category at 0 and add what each study
 * reports, so a 0 can mean that nothing in the selection reported it. The
 * doughnut left such categories out; the rows must too, and a selection that
 * reported nothing is said in words, never drawn as a list of zeros (AGENTS.md:
 * absence is not zero).
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

function harness() {
    const context = vm.createContext({
        escapeHtml: (t) => String(t).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
        DEMO_INK: { absent: '#8A968F' },
    });
    vm.runInContext(lineAt('const DONUT_ABSENT_LABELS =') + fnAt('function demoScale(maxPct)')
        + fnAt('function demoRowsHtml(rows, opts = {})') + fnAt('function demoRowsFromTotals(totals, colors)'), context);
    return (src) => vm.runInContext(src, context);
}

const RACE_ZERO = { 'American Indian/Alaska Native': 0, Asian: 0, 'Black/African American': 0,
    'Native Hawaiian/Pacific Islander': 0, White: 0, 'More than one race': 0, Unknown: 0, Other: 0 };

test('a selection that reported nothing is stated, not drawn as zeros', () => {
    const run = harness();
    assert.equal(run(`demoRowsFromTotals(${JSON.stringify(RACE_ZERO)}, { default: '#0F7A4F' }).length`), 0);
    const html = run(`demoRowsHtml(demoRowsFromTotals(${JSON.stringify(RACE_ZERO)}, { default: '#0F7A4F' }), { empty: 'No participants with reported race in this selection.' })`);
    assert.match(html, /class="demo-empty"/);
    assert.match(html, /No participants with reported race in this selection\./);
    assert.ok(!/demo-row/.test(html), 'an empty selection drew rows');
    assert.ok(!/>0</.test(html), 'an empty selection drew a zero count');
});

test('a category with no participants is left out, as it was from the doughnut', () => {
    const run = harness();
    const totals = { ...RACE_ZERO, White: 70, Asian: 20, Unknown: 10 };
    const rows = run(`demoRowsFromTotals(${JSON.stringify(totals)}, { default: '#0F7A4F' })`);
    assert.deepEqual([...rows.map((r) => r.label)].sort(), ['Asian', 'Unknown', 'White']);
    const html = run(`demoRowsHtml(demoRowsFromTotals(${JSON.stringify(totals)}, { default: '#0F7A4F' }))`);
    assert.equal((html.match(/class="demo-row/g) || []).length, 3);
    // shares are over the rows shown, as the doughnut's were
    assert.match(html, /70\.0%/);
    assert.match(html, /20\.0%/);
    assert.match(html, /10\.0%/);
    // Unknown stays below the rule, textured
    assert.match(html, /demo-absent demo-first-absent/);
});

test('every legacy composition renderer names its own empty state', () => {
    for (const [fn, dim] of [['renderRaceDistribution', 'race'], ['renderEthnicityDistribution', 'ethnicity'],
        ['renderSexDistribution', 'sex'], ['renderGenderDistribution', 'gender']]) {
        const src = fnAt(`function ${fn}(filtered)`);
        assert.ok(src.includes('demoRowsHtml(demoRowsFromTotals('), `${fn} no longer draws rows from its totals`);
        assert.ok(src.includes(`No participants with reported ${dim} in this selection.`), `${fn} lost its empty-state sentence`);
    }
});

test('a single series named by its end label keeps a legend on a narrow panel', () => {
    const run = (narrow, spec, n) => {
        const context = vm.createContext({
            demoNarrow: () => narrow, demoPattern: () => '#000', demoCompact: (v) => String(v), demoInkPlugin: {},
        });
        vm.runInContext(lineAt('const DEMO_SERIF =') + 'const DEMO_INK = { muted: "#666", rule: "#ddd", ink2: "#333", absent: "#999" };\n'
            + fnAt('function demoConfig(config, spec = {})'), context);
        context.cfg = { type: 'line', data: { datasets: Array.from({ length: n }, (_, i) => ({ label: 'S' + i, data: [1, 2] })) }, options: {} };
        context.spec = spec;
        return vm.runInContext('demoConfig(cfg, spec).options.plugins.legend.display', context);
    };
    // Ethnicity Over Time: one series, end labels requested
    assert.equal(run(true, { endLabels: true }, 1), true, 'a phone lost the only series name');
    assert.equal(run(false, { endLabels: true }, 1), false, 'the end label already names it on a wide panel');
    // a single bar series without end labels stays without a legend, as before
    assert.equal(run(true, {}, 1), false);
    assert.equal(run(true, { endLabels: true }, 3), true);
});

test('a stacked series with an empty last bar is named in the legend', () => {
    const run = (sets) => {
        const context = vm.createContext({
            demoNarrow: () => false, demoPattern: () => '#000', demoCompact: (v) => String(v), demoInkPlugin: {},
        });
        vm.runInContext(lineAt('const DEMO_SERIF =') + 'const DEMO_INK = { muted: "#666", rule: "#ddd", ink2: "#333", absent: "#999" };\n'
            + fnAt('function demoConfig(config, spec = {})'), context);
        context.cfg = { type: 'bar', data: { datasets: sets.map(([label, data]) => ({ label, data })) }, options: {} };
        const legend = vm.runInContext('demoConfig(cfg, { endLabels: true }).options.plugins.legend', context);
        const shown = sets.map((_, i) => i).filter((i) => !legend.labels.filter || legend.labels.filter({ datasetIndex: i }));
        return { display: legend.display, shown: shown.map((i) => sets[i][0]) };
    };
    // Asian in the first year only, White in both: only White has an end label
    assert.deepEqual(run([['White', [5, 7]], ['Asian', [3, 0]]]), { display: true, shown: ['Asian'] });
    // every series ends above zero: the end labels name them all, no legend
    assert.equal(run([['White', [5, 7]], ['Asian', [3, 2]]]).display, false);
    // a series that never had participants is not added to the legend
    assert.equal(run([['White', [5, 7]], ['Asian', [0, 0]]]).display, false);
});
