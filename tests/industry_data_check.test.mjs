/**
 * industryDataProblem: data/industry_sponsors.json as the Industry view reads
 * it, checked before loadIndustryView keeps a parsed body.
 *
 * A body that is JSON but not the sponsor dataset ({}, an error object, a
 * schema the view does not know) used to be kept as loaded: the first step
 * that read it threw, the view showed its error while the archive line and
 * the Filters button said the data was there, and a reopen skipped the fetch
 * and threw outside the loader's catch. The check runs here, in a vm, on the
 * files the engine actually published and on the first format the view still
 * reads (the July 2026 file: 11 companies, 7-field rows, none of the keys
 * added since). How a load uses the answer is followed in
 * archive_filters.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const readJson = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));

function fnSource(signature) {
    const at = app.indexOf(signature);
    assert.ok(at >= 0, `app.js lost ${signature}`);
    const end = app.indexOf('\n}\n', at);
    return app.slice(at, end + 2);
}

const context = vm.createContext({});
vm.runInContext(fnSource('function industryDataProblem(d)'), context);
const problem = (d) => {
    context.payload = d;
    return vm.runInContext('industryDataProblem(payload)', context);
};

const LATEST = readJson('data/industry_sponsors.json');

// The first published format (scripts/generate_industry_sponsors.py at
// 132ffa8, July 2026), rebuilt from today's file: the top 10 plus a pooled
// "Other Industry" bucket, 7-field rows, and no company_n, top_n, lead-only
// or demographic fits, race/ethnicity categories, census block or
// sex-specific list. industryTop10 and industryMenuCompanies still read it.
function firstFormat() {
    const keep = ['generated_at', 'source_extracted_at', 'cohort_n', 'min_cell', 'primaries',
        'secondaries', 'heatmap_conditions', 'contrasts', 'pooled'];
    const d = Object.fromEntries(keep.map(k => [k, structuredClone(LATEST[k])]));
    d.companies = [...LATEST.companies.slice(0, 10), 'Other Industry'];
    d.trial_fields = ['bucket', 'pf', 'results_year', 'pcd_year', 'primary', 'secondary', 'has_explicit_unknown'];
    d.trials = LATEST.trials.slice(0, 500).map(t => [Math.min(t[0], 10), ...t.slice(1, 7)]);
    return d;
}

test('every sponsor file the engine published passes, and so does the first format', () => {
    assert.equal(problem(LATEST), null, 'data/industry_sponsors.json');
    for (const date of ['2026-08-02', '2026-10-04']) {
        assert.equal(problem(readJson(`snapshots/${date}/industry_sponsors.json`)), null, date);
    }
    const first = firstFormat();
    assert.equal(problem(first), null, 'the first format, which the view still reads');
    // The optional keys may also be null, as a hand-trimmed or partial file
    // would carry them; the view reads each through a guard.
    assert.equal(problem({ ...first, min_cell: null, top_n: null, contrasts_lead: null, pooled_lead: null,
        contrasts_demo: null, race_categories: null, eth_categories: null, sex_specific_conditions: null,
        source_extracted_at: null, pooled: null }), null);
});

test('JSON that is not the sponsor dataset is a problem, each named', () => {
    for (const [what, body] of [['{}', {}], ['null', null], ['an array', []], ['a string', 'Not Found'],
        ['an error object', { error: 'rate limited', status: 429 }]]) {
        assert.equal(typeof problem(body), 'string', what);
    }
    assert.match(problem({}), /trials/);
});

// Each key the view reads unguarded, removed or of the wrong shape, from an
// otherwise complete file. The reason is the read that would throw.
const without = (key) => { const d = { ...LATEST }; delete d[key]; return d; };
const replace = (patch) => ({ ...LATEST, ...patch });
const BROKEN = [
    // industryFilteredRows filters it; industryNewestResultsYear walks it.
    ['no trials', without('trials'), /trials/],
    ['trials not a list', replace({ trials: {} }), /trials/],
    // Rows are read by index (t[0] … t[9]); a row that is not a list throws.
    ['a row that is not a list', replace({ trials: [...LATEST.trials.slice(0, 3), null] }), /row/],
    // t[1], percent female: the heatmap and trend take medians and call
    // toFixed on them, so it is a number or null (does not report sex).
    ['percent female as text', replace({ trials: [[0, '40.5', 2015, 2012, 1, 1, 0]] }), /row/],
    ['a row without percent female', replace({ trials: [[0]] }), /row/],
    // industryTop10 slices it; the menu escapes and lists each name.
    ['no companies', without('companies'), /companies/],
    ['companies as objects', replace({ companies: [{ name: 'Pfizer' }] }), /companies/],
    // The Primary and Secondary condition filters compare names; the
    // heatmap's columns and a shared ?condition= read secondaries.
    ['no primaries', without('primaries'), /primaries/],
    ['no secondaries', without('secondaries'), /secondaries/],
    // The meta line: "n of cohort_n cohort trials" (toLocaleString).
    ['no cohort_n', without('cohort_n'), /cohort_n/],
    ['cohort_n as text', replace({ cohort_n: '30229' }), /cohort_n/],
    // The forest's Sex tier spreads it and reads sponsor, beta, lo, hi, n.
    ['no contrasts', without('contrasts'), /contrasts/],
    ['a contrast without its interval', replace({ contrasts: [{ sponsor: 'Pfizer', beta: 1, n: 5 }] }), /contrasts/],
    ['a lead-only contrast without n', replace({ contrasts_lead: [{ sponsor: 'Pfizer', beta: 1, lo: 0, hi: 2 }] }), /contrasts_lead/],
    // The forest footnote: pooled.n.toLocaleString() whenever pooled is set.
    ['pooled without n', replace({ pooled: {} }), /pooled/],
    ['pooled_lead without n', replace({ pooled_lead: { r2: 0.1 } }), /pooled_lead/],
    // The Race/Ethnicity forest spreads contrasts_demo[tier][category][role].
    ['a demographic fit that is not a list', replace({ contrasts_demo: { race: { white: { any: { beta: 1 } } } } }), /contrasts_demo/],
    // The category chips map over these; the Sex tier builds a Set of this.
    ['race_categories as text', replace({ race_categories: 'white' }), /race_categories/],
    ['eth_categories as an object', replace({ eth_categories: { a: 1 } }), /eth_categories/],
    ['sex_specific_conditions as a number', replace({ sex_specific_conditions: 5 }), /sex_specific_conditions/],
    // The benchmark note slices its date; the cell floor and the top-N cut.
    ['source_extracted_at as a number', replace({ source_extracted_at: 20261004 }), /source_extracted_at/],
    ['min_cell as text', replace({ min_cell: 'ten' }), /min_cell/],
    ['top_n as text', replace({ top_n: 'ten' }), /top_n/]
];
for (const [what, body, named] of BROKEN) {
    test(`a file with ${what} is a problem`, () => {
        const p = problem(body);
        assert.equal(typeof p, 'string', `${what} passed the check`);
        assert.match(p, named, `the problem does not say what is wrong: ${p}`);
    });
}

test('keys the view never reads are not required', () => {
    // trial_fields documents the row layout; heatmap_conditions,
    // prevalence_benchmarks, generated_at and source_pipeline_commit are
    // shipped but unread. census is read through guards (?.source, c && c[tier]).
    const d = { ...LATEST };
    for (const k of ['trial_fields', 'heatmap_conditions', 'heatmap_conditions_all', 'prevalence_benchmarks',
        'generated_at', 'source_pipeline_commit', 'census', 'company_n']) delete d[k];
    assert.equal(problem(d), null);
});
