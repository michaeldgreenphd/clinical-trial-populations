/**
 * The ?sg=v2 beta: the parser-v2 Sex and Gender tabs.
 *
 * The v2 code is one contiguous block in app.js between the
 * "Sex/gender parser v2 (sg=v2)" and "end sg=v2" markers, so it is evaluated
 * here on its own in a vm with a stub document. The pure helpers (the four
 * quality rows, the tiles, the aggregates, the CSV join) are exercised
 * directly; the invariants that matter to the three-state rule are asserted
 * on the source text: no state is collapsed, the enrollment gap is never
 * summed into a bucket, nothing reads a balancing field, and no tile is
 * named after a single source label.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const START = '// ── Sex/gender parser v2 (sg=v2)';
const END = '// ── end sg=v2';
const startIdx = app.indexOf(START);
const endIdx = app.indexOf(END);
assert.ok(startIdx >= 0 && endIdx > startIdx, 'app.js lost the sg=v2 block markers');
const block = app.slice(startIdx, endIdx);

// Code only: the block with its comments removed, so a prohibition is on what
// runs, not on the prose that explains it.
const code = block.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/(^|[^:'"`])\/\/(?![^'"`]*['"`]).*$/, '$1')).join('\n');

function harness(opts = {}) {
    const els = {};
    const el = (id) => (els[id] ||= { id, innerHTML: '', textContent: '', classList: { toggle() {} }, value: 'all', disabled: false, style: {}, title: '', removeAttribute() { this.title = ''; } });
    const context = vm.createContext({
        console, JSON, Number, String, Object, Array, Map, Set, Math, URLSearchParams,
        location: { search: opts.search || '', hash: opts.hash || '' },
        localStorage: { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); } },
        window: {}, setTimeout: () => 0,
        document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], body: { classList: { toggle() {} } } },
        escapeHtml: (t) => String(t).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
        CHART_COLORS: { c1: '#0F7A4F', c2: '#C2477E', c3: '#2E6FB7', c4: '#C77A0A', c5: '#7A4FCF', notReported: '#8A968F' },
        CHART_ASPECT_RATIO: undefined, CHART_LEGEND_POSITION: 'right', isMobileDevice: false,
        DATA_CACHE_VERSION: 'test', hasDecompressionStream: false, ensurePako: async () => {},
        fetch: opts.fetch || (async () => ({ ok: false, status: 404 })),
        charts: {}, dashboardSummary: null, data: [], Chart: function () { return { destroy() {} }; },
        ChartDataLabels: {}, donutConfig: () => ({})
    });
    vm.runInContext(block, context);
    // Values cross the vm realm boundary as plain JSON, so deepEqual compares
    // structure rather than realm-specific prototypes.
    const run = (src) => {
        const v = vm.runInContext(src, context);
        return (v !== null && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    };
    const runRaw = (src) => vm.runInContext(src, context);
    return { els, run, runRaw };
}

const rowDefaults = {
    sex_report_status: 'reported', reported_sex: true, reported_gender: false, reported_both: false,
    n_female: 40, n_male: 50, n_unknown: null, n_gender_diverse: null, n_ambiguous_gender: null,
    is_participant_count: true, uninformative_reason: null, declared_not_collected: false,
    has_sex_table: true, has_gender_table: true,
    enrollment_minus_parsed: 10, parser_rules_version: 'test-rules'
};
const row = (over) => {
    const r = Object.assign({}, rowDefaults, over);
    if (!over || !('percent_female' in over)) {
        const f = Number(r.n_female) || 0, m = Number(r.n_male) || 0;
        r.percent_female = (r.reported_sex === true && r.is_participant_count === true && f + m > 0) ? 100 * f / (f + m) : null;
    }
    if (!over || !('n_total_parsed' in over)) {
        r.n_total_parsed = ['n_female', 'n_male', 'n_gender_diverse', 'n_ambiguous_gender', 'n_unknown']
            .reduce((a, k) => a + (Number(r[k]) || 0), 0) || null;
    }
    return r;
};

test('the four quality states render in fixed order, and a zero state is a zero row, not a missing one', () => {
    const h = harness();
    const rows = h.run('sgQualityRows({ reported: 79270, explicit_unknown_only: 66, uninformative: 720, not_reported: 0, parse_error: 3 })');
    assert.deepEqual(rows.map((r) => r.key), ['reported', 'explicit_unknown_only', 'uninformative', 'not_reported']);
    assert.deepEqual(rows.map((r) => r.count), [79270, 66, 720, 0]);
    assert.deepEqual(rows.map((r) => r.label), ['Reported', 'Explicit Unknown', 'Uninformative', 'Not Reported (Missing)']);
    // parse_error is the methods page's only; it never joins the visible four
    assert.ok(!rows.some((r) => r.key === 'parse_error'));
    const table = h.run('sgQualityTableHtml(sgQualityRows({ reported: 79270, explicit_unknown_only: 66, uninformative: 720, not_reported: 0 }))');
    for (const state of ['Reported', 'Explicit Unknown', 'Uninformative', 'Not Reported (Missing)']) {
        assert.ok(table.includes(state), `${state} row is missing from the quality table`);
    }
    assert.match(table, /data-state="not_reported"><th scope="row">[^<]*<span class="sg-swatch"[^>]*><\/span>Not Reported \(Missing\)<\/th><td>0<\/td><td>0\.0%<\/td>/,
        'the Not Reported row must render with a 0 count and a 0.0% share');
    // an empty selection still lists all four states
    const empty = h.run('sgQualityRows({})');
    assert.deepEqual(empty.map((r) => r.count), [0, 0, 0, 0]);
});

test('each state renders its own badge or cross in the Studies table cell; states are never merged', () => {
    const h = harness();
    h.run('sgTable = null; sgAvailable = true;');
    const cell = (over, field = 'sex') => h.run(`sgDemographicCell(${JSON.stringify({ nct_id: 'NCT1', sex_gender: row(over) })}, '${field}')`);
    assert.match(cell({}), /demo-badge/);                                                  // reported: the check
    assert.match(cell({ sex_report_status: 'explicit_unknown_only', reported_sex: false }), /explicit-unknown-badge"[^>]*>Explicit Unknown/);
    assert.match(cell({ sex_report_status: 'uninformative', reported_sex: false, uninformative_reason: 'all_values_na' }), /sg-badge-uninformative[^>]*every value posted as NA[^>]*>Uninformative/);
    assert.match(cell({ sex_report_status: 'not_reported', reported_sex: false }), /demo-disabled/);
    assert.match(cell({ sex_report_status: 'parse_error', reported_sex: null }), /sg-badge-parse-error/);
    // the gender cell: reported_gender is the check; a Female/Male-only "Gender" table is named as such
    assert.match(cell({ reported_gender: true }, 'gender'), /demo-badge/);
    assert.match(cell({ gender_labeled_binary_only: true }, 'gender'), /F\/M only/);
});

test('each pip answers for its own dimension: reported_sex for Sex, reported_gender for Gender', () => {
    const h = harness();
    h.run('sgTable = null;');
    const dim = (over, field) => h.run(`sgDimensionReported(${JSON.stringify({ nct_id: 'NCT1', sex_gender: row(over) })}, '${field}')`);
    // a gender-only trial: 51 rows in the shipped table report gender with
    // reported_sex false, and reported_any is true for all of them
    const genderOnly = { reported_sex: false, reported_gender: true, reported_any: true };
    assert.equal(dim(genderOnly, 'sex'), false, 'a gender-only trial lit the Sex pip');
    assert.equal(dim(genderOnly, 'gender'), true);
    // an ordinary sex-reporting trial
    assert.equal(dim({}, 'sex'), true);
    assert.equal(dim({}, 'gender'), false);
    // both fields are in the lean row, so the pip needs no derivation anywhere
    const lean = h.run(`Object.keys(${JSON.stringify(row({}))})`);
    assert.ok(lean.includes('reported_sex') && lean.includes('reported_gender'));
    // and the Sex column cell agrees with the Sex pip
    const cell = h.run(`sgDemographicCell(${JSON.stringify({ nct_id: 'NCT1', sex_gender: row(genderOnly) })}, 'sex')`);
    assert.ok(!/demo-badge-check/.test(cell), 'the Sex column checked a trial that did not report sex');
});

test('aggregates: totals over reported_sex AND is_participant_count; the excluded set is reported_sex AND NOT is_participant_count', () => {
    const h = harness();
    h.run('sgTable = null;');
    const studies = [
        { nct_id: 'A', results_date: '2020-01-01', sex_gender: row({}) },
        { nct_id: 'B', results_date: '2020-02-01', sex_gender: row({ sex_report_status: 'explicit_unknown_only', reported_sex: false, n_female: 0, n_male: 0, n_unknown: 9 }) },
        { nct_id: 'C', results_date: '2021-01-01', sex_gender: row({ is_participant_count: false, n_female: 100, n_male: 5 }) },
        { nct_id: 'D', results_date: '2021-01-01', sex_gender: row({ reported_gender: true, reported_both: true, n_gender_diverse: 2, n_ambiguous_gender: 1 }) },
        { nct_id: 'E', results_date: '2021-01-01', sex_gender: row({ sex_report_status: 'uninformative', reported_sex: false, n_female: null, n_male: null, uninformative_reason: 'no_measurements', declared_not_collected: true }) },
        { nct_id: 'F', results_date: '2021-01-01', sex_gender: null }
    ];
    const agg = h.run(`sgAggregate(${JSON.stringify(studies)})`);
    assert.deepEqual(agg.statusCounts, { reported: 3, explicit_unknown_only: 1, uninformative: 1, not_reported: 0, parse_error: 0 });
    assert.equal(agg.denominatorTrials, 2);
    assert.deepEqual(agg.totals, { female: 80, male: 100, gender_diverse: 2, ambiguous: 1, explicit_unknown: 0 });
    assert.deepEqual(agg.excluded, { trials: 1, female: 100, male: 5 });
    assert.deepEqual(agg.uninformativeReasons, { no_measurements: 1 });
    assert.equal(agg.declaredNotCollected, 1);
    assert.equal(agg.outcomes.reported_gender, 1);
    assert.equal(agg.glbKnown, false, 'gender_labeled_binary_only is unknown without the CSV join, so the sentence is omitted');
    assert.equal(h.run(`sgGlbSentence(${JSON.stringify(agg)})`), '');
    agg.glbKnown = true; agg.outcomes.gender_labeled_binary_only = 7;
    assert.equal(h.run(`sgGlbSentence(${JSON.stringify(agg)})`), 'Gender-titled tables with only Female/Male, counted as sex: 7.');
    // percent female is computed here, never read: series (a) mean and (b) weighted, largest trial kept
    const years = h.run(`sgYearSeries(${JSON.stringify(studies)})`);
    const pts = h.run(`sgSeriesPoints(${JSON.stringify(years)})`);
    assert.deepEqual(pts.labels, ['2020', '2021']);
    assert.ok(Math.abs(pts.a[0] - 100 * 40 / 90) < 1e-9 && Math.abs(pts.b[0] - 100 * 40 / 90) < 1e-9);
    assert.deepEqual(pts.largest[1], { nct_id: 'D', share: 1 });      // C is not a participant count: outside both series
});

test('the summary block yields the same shape for mobile, and the beta panel labels the exclusion as reported_sex AND NOT is_participant_count', () => {
    const h = harness();
    const summary = {
        cards: { sexCount: 77906, genderCount: 1676 },
        sexDistribution: { female: 55582100, male: 48540358, unknown: 3746272 },
        genderDistribution: { woman: 39164, man: 23308, nonbinary: 3498, transgender: 1371, other: 589, unknown: 1239450 },
        sexGender: {
            parser_rules_version: 'r', statusCounts: { reported: 79270, explicit_unknown_only: 66, uninformative: 720, not_reported: 0, parse_error: 0 },
            outcomes: { reported_sex: 79219, reported_gender: 665, reported_both: 614, reported_any: 79270, gender_labeled_binary_only: 2955 },
            totals: { female: 51775993, male: 45070116, explicit_unknown: 259436, gender_diverse: 20220, ambiguous: 2722 },
            denominatorTrials: 79107, excludedFromComposition: { trials: 112, female: 804166, male: 666273 },
            uninformativeReasons: { no_measurements: 437 }, declaredNotCollected: 5, labels: {}, byYear: {}
        }
    };
    const agg = h.run(`sgAggregateFromSummary(${JSON.stringify(summary.sexGender)})`);
    assert.equal(agg.statusCounts.not_reported, 0);
    assert.equal(agg.totals.gender_diverse, 20220);
    assert.equal(agg.outcomes.gender_labeled_binary_only, 2955);
    const beta = h.run(`sgBetaHtml(sgBetaRows(${JSON.stringify(summary)}))`);
    assert.match(beta, /Excluded from composition \(reported_sex AND NOT is_participant_count\): 112 trials/);
    assert.match(beta, /pull\/15/);
    assert.match(beta, /removed at cutover/);
});

test('no tile is named Transgender or Non-binary; the five buckets are the display', () => {
    const h = harness();
    const labels = h.run('SG_BUCKETS.map(b => b.label)');
    assert.deepEqual(labels, ['Female', 'Male', 'Gender diverse', 'Cis/trans-qualified', 'Explicit Unknown']);
    for (const l of labels) assert.ok(!/transgender|non-?binary/i.test(l), `${l} is a tile named after a source label`);
    const tiles = h.run(`sgTiles(sgEmptyAggregate(), SG_BUCKETS.map(b => b.key)).map(t => t.label)`);
    assert.deepEqual(tiles, labels);
    // the markup has no such tile either (the words may appear in the note that says they are labels, not tiles)
    const genderV2 = html.match(/<div id="sg-gender-v2"[\s\S]*?<div class="sg-legacy">/)[0];
    assert.ok(!/<h3>[^<]*(Transgender|Non-binary)[^<]*<\/h3>/i.test(genderV2), 'a v2 heading names Transgender or Non-binary');
});

test('enrollment_minus_parsed is never summed into a bucket and no balancing field is read', () => {
    // Allowed: at most a comment. Not allowed anywhere in the v2 code: reading the field.
    assert.ok(!/enrollment_minus_parsed/.test(code), 'the v2 code reads enrollment_minus_parsed');
    assert.ok(!/balanc/i.test(code), 'the v2 code reads a field named like balanc*');
    // and no v2 total is built from enrollment
    assert.ok(!/agg\.totals\.[a-z_]+\s*\+=\s*[^;]*enrollment/i.test(code), 'a v2 bucket total reads enrollment');
});

test('the four label trails are read as arrays; a label containing "; " stays one label', () => {
    const h = harness();
    const ugly = 'Other (Transwoman; Transman; Gender-variant/non-binary; Other Identity; Prefer not to answer)';
    const csv = 'nct_id,reported_any,gender_labeled_binary_only,unknown_labels,gender_diverse_labels,ambiguous_labels\n' +
        `NCT1,True,False,"[""${ugly}""]","[""Other"",""Non-binary""]",[]\n` +
        'NCT2,False,,[],[],[]\n';
    const table = h.run(`[...sgParseCsv(${JSON.stringify(csv)}, SG_CSV_KEEP).entries()]`);
    assert.equal(table.length, 2);
    const r1 = Object.fromEntries(table)['NCT1'];
    assert.deepEqual(r1.unknown_labels, [ugly]);
    assert.deepEqual(r1.gender_diverse_labels, ['Other', 'Non-binary']);
    assert.equal(r1.reported_any, true);
    assert.equal(Object.fromEntries(table)['NCT2'].gender_labeled_binary_only, null);
    assert.ok(!/split\(['"];/.test(code), 'the v2 code splits a label trail on ";"');
});

test('the flag: ?sg=v2 turns the beta on and is remembered; ?sg=v1 turns it off', () => {
    assert.equal(harness({ search: '?sg=v2' }).run('SG_V2'), true);
    assert.equal(harness({ search: '' }).run('SG_V2'), false);
    const h = harness({ search: '?sg=v2' });
    assert.equal(h.run("localStorage.getItem('civicsample.sg')"), 'v2');
    assert.equal(harness({ search: '?sg=v1' }).run('SG_V2'), false);
});

test('the markup carries the v2 filters, the methods section and the anchors the tabs link to', () => {
    for (const id of ['sg-status', 'sg-reported-sex', 'sg-reported-gender', 'sg-reported-both', 'sg-glb', 'sg-participant-count']) {
        assert.ok(html.includes(`id="${id}"`), `index.html has no #${id} control`);
    }
    assert.ok(html.includes('id="methods-sex-gender"'), 'the FAQ has no methods section for parser v2');
    // the tile is built in app.js; its note links to the methods anchor
    assert.ok(block.includes("sgOpenMethods('unknown_tile')"), 'the Explicit Unknown tile does not link to the methods anchor');
    assert.ok(block.includes('Registrant-reported Unknown categories only.'), 'the Explicit Unknown tile lost its one-line note');
    assert.ok(html.includes('id="sg-retired-banner"'));
    // the legacy blocks are wrapped so the v2 blocks can replace them by class
    assert.equal((html.match(/class="sg-legacy"/g) || []).length, 2);
    // and the app wires the flag into the loader, the filters, the table and the tab renders
    for (const needle of ['await sgLoad()', 'sgV2Filters = sgReadFilters()', 'return sgDimensionReported(study, field)', 'return sgDemographicCell(study, field)', 'return sgShowBreakdown(nctId, categoryName)', 'sgAfterRender(filtered)']) {
        assert.ok(app.includes(needle), `app.js lost the hook: ${needle}`);
    }
});

test('share links carry the v2 filters, the methods deep link survives the hash rewrite, and totals are whole participants', () => {
    const sfStart = app.indexOf('const SHARE_FILTERS = [');
    assert.ok(sfStart >= 0, 'app.js lost SHARE_FILTERS');
    const sf = app.slice(sfStart, app.indexOf('];', sfStart));
    for (const id of ['sg-status', 'sg-reported-sex', 'sg-reported-gender', 'sg-reported-both', 'sg-glb', 'sg-participant-count']) {
        assert.ok(sf.includes(`['${id}',`), `share links drop the ${id} filter`);
    }
    // the tab router rewrites location.hash on the first render, so the
    // #faq?m=<section> hook must read the hash the page opened with
    assert.ok(block.includes('const SG_INITIAL_HASH'), 'the initial hash is not captured');
    assert.ok(block.includes('sgQueryParams(SG_INITIAL_HASH)'), 'sgRouteHooks reads location.hash after the router rewrote it');
    // one registrant posts fractional counts, so the published sums carry a
    // fraction; a participant total is shown as a whole number
    const h = harness({ search: '?sg=v2' });
    const tile = h.run("sgTileHtml({ key: 'female', label: 'Female', color: '#000', value: 51775992.7, note: 'n' }, '')");
    assert.match(tile, /51,775,993/);
    assert.ok(!tile.includes('992.7'), 'a tile shows a fractional participant count');
    const beta = h.run(`sgBetaHtml(sgBetaRows({
        sexDistribution: { female: 1, male: 1, unknown: 1 }, genderDistribution: {}, cards: {},
        sexGender: { totals: { female: 51775992.7, male: 45070116.3, explicit_unknown: 259436, gender_diverse: 0, ambiguous: 0 },
                     outcomes: {}, excludedFromComposition: { trials: 112, female: 804166.56, male: 666273.91 }, denominatorTrials: 79107 }
    }))`);
    assert.match(beta, /51,775,993/);
    assert.match(beta, /804,167 female \/ 666,274 male units/);
    assert.ok(!/\d\.\d/.test(beta.replace(/parsers\.R@[^<]*/, '')), 'the beta panel shows a fractional participant count');
});

test('the flag survives the routing stubs, which move the query into the hash', () => {
    // /sex/?sg=v2 is bounced by the stub to /#sex?sg=v2: location.search is
    // then empty and the only copy of the flag is in the hash query.
    assert.equal(harness({ search: '', hash: '#sex?sg=v2' }).run('SG_V2'), true);
    assert.equal(harness({ search: '', hash: '#sex?ys=2015&sg=v2' }).run('SG_V2'), true);
    assert.equal(harness({ search: '', hash: '#sex?sg=v1' }).run('SG_V2'), false);
    assert.equal(harness({ search: '', hash: '#sex' }).run('SG_V2'), false);
    // location.search still wins when both carry it
    assert.equal(harness({ search: '?sg=v1', hash: '#sex?sg=v2' }).run('SG_V2'), false);
    // and the deep-link hooks read the same merged params
    const h = harness({ search: '', hash: '#sex?sg=v2&sgbeta=1' });
    assert.equal(h.run("sgQueryParams('#sex?sg=v2&sgbeta=1').get('sgbeta')"), '1');
});

test('the retired-rule banner is in both tab sections, since only the active section renders', () => {
    assert.equal((html.match(/class="sg-banner sg-retired-banner sg-hidden"/g) || []).length, 2,
        'the Sex and Gender sections must each carry the retired-rule banner');
    const sex = html.slice(html.indexOf('<section id="sex"'), html.indexOf('<section id="gender"'));
    const gender = html.slice(html.indexOf('<section id="gender"'), html.indexOf('<section id="studies"'));
    assert.ok(sex.includes('sg-retired-banner'), 'the Sex section lost its banner');
    assert.ok(gender.includes('sg-retired-banner'), 'the Gender section has no banner, so the notice is invisible there');
    // and the toggle is by class, so both move together
    assert.ok(block.includes("querySelectorAll('.sg-retired-banner')"), 'the banner is toggled by id, so the second one never shows');
});

test('the beta panel reads the summary of the snapshot on screen, not the latest one', async () => {
    const urls = [];
    const h = harness({ search: '?sg=v2', fetch: async (u) => { urls.push(u); return { ok: false, status: 404 }; } });
    h.run("sgSnapshotKey = '2026-08-02';");
    await h.runRaw('sgRenderBetaPanel()');
    assert.ok(urls.some((u) => u.startsWith('snapshots/2026-08-02/dashboard-summary.json')),
        `the panel fetched ${urls.join(', ') || 'nothing'} instead of the selected snapshot's summary`);
    assert.match(h.els['sg-beta-body'].innerHTML, /2026-08-02 snapshot/);
    // switching snapshots re-fetches rather than reusing the first one's cache
    urls.length = 0;
    h.run("sgSnapshotKey = 'latest';");
    await h.runRaw('sgRenderBetaPanel()');
    assert.ok(urls.some((u) => u.startsWith('data/dashboard-summary.json')),
        `the panel fetched ${urls.join(', ') || 'nothing'} for the latest pull`);
    // the rendered panel names the snapshot it is reporting on
    const summary = { extracted_at: '2026-09-15T00:09:44Z', cards: {}, sexDistribution: {}, genderDistribution: {},
        sexGender: { totals: {}, outcomes: {}, excludedFromComposition: {}, denominatorTrials: 79107, parser_rules_version: 'r' } };
    const panel = h.run(`sgBetaHtml(sgBetaRows(${JSON.stringify(summary)}), 'the 2026-09-15 snapshot')`);
    assert.match(panel, /for the 2026-09-15 snapshot/);
    assert.match(panel, /extracted 2026-09-15/);
});

test("percent female is the engine's published estimand, and is never recomputed here", () => {
    const h = harness();
    // the published column is the answer
    assert.equal(h.run(`sgPercentFemale(${JSON.stringify(row({ n_female: 40, n_male: 60, percent_female: 37.5 }))})`), 37.5);
    // a row inside the denominator whose file omits the column has no percent
    // female at all: the formula is not reapplied in the presentation layer
    const noCol = row({ n_female: 40, n_male: 60, percent_female: null });
    assert.equal(h.run(`sgPercentFemale(${JSON.stringify(noCol)})`), null);
    assert.equal(h.run(`sgPercentFemaleMissing(${JSON.stringify(noCol)})`), true);
    assert.ok(!/100 \* f \/ \(f \+ m\)/.test(code.slice(code.indexOf('function sgPercentFemale'), code.indexOf('function sgEmptyAggregate'))),
        'the client-side formula is back in the percent-female path');
    // outside the denominator set there is nothing missing and nothing to show
    const outside = row({ is_participant_count: false, percent_female: 99 });
    assert.equal(h.run(`sgPercentFemale(${JSON.stringify(outside)})`), null);
    assert.equal(h.run(`sgPercentFemaleMissing(${JSON.stringify(outside)})`), false);
    // and the column is joined in from the CSV as a number, with a blank absent
    assert.ok(h.run("SG_CSV_KEEP.includes('percent_female')"), 'the CSV join drops the published percent_female');
    const parsed = h.run("[...sgParseCsv('nct_id,percent_female\\nNCT1,52.5\\nNCT2,\\n', SG_CSV_KEEP).entries()]");
    assert.equal(parsed[0][1].percent_female, 52.5);
    assert.equal(parsed[1][1].percent_female, null);
});

test('a year series withholds the within-trial mean rather than averaging a subset', () => {
    const h = harness();
    h.run('sgTable = null;');
    const studies = [
        { nct_id: 'A', results_date: '2020-01-01', sex_gender: row({}) },
        { nct_id: 'B', results_date: '2020-02-01', sex_gender: row({ n_female: 10, n_male: 10, percent_female: null }) }
    ];
    const pts = h.run(`sgSeriesPoints(sgYearSeries(${JSON.stringify(studies)}))`);
    assert.equal(pts.missing, 1, 'the row without a published figure was skipped instead of counted');
    assert.equal(pts.eligible, 2);
    // the participant-weighted series is a sum of published counts and stands
    assert.ok(Math.abs(pts.b[0] - 100 * 50 / 110) < 1e-9);
    // and the renderer withholds series (a) and names what is missing
    const render = block.slice(block.indexOf('function sgRenderPercentFemale'), block.indexOf('function sgRenderSexDonut'));
    assert.ok(render.includes('pts.missing > 0'), 'the mean is drawn even when a trial in the denominator has no published figure');
    assert.ok(render.includes('aMissing ? pts.labels.map(() => null) : pts.a'), 'the withheld series still plots its points');
    assert.match(render, /unavailable for this selection/);
});

test('a bucket no trial in the selection published renders as absent, never as a zero', () => {
    const h = harness();
    h.run('sgTable = null;');
    const study = (id, over) => ({ nct_id: id, results_date: '2020-01-01', sex_gender: row(over) });
    // nothing here posts an Unknown category: the tile has no count to show
    const agg = h.run(`sgAggregate(${JSON.stringify([study('A', { n_female: 10, n_male: 5 })])})`);
    assert.equal(agg.totals.explicit_unknown, 0);
    assert.equal(agg.totalsPresent.explicit_unknown, false);
    assert.equal(agg.totalsPresent.female, true);
    const tile = h.run(`sgTiles(${JSON.stringify(agg)}, SG_SEX_TILE_KEYS)`).find((t) => t.key === 'explicit_unknown');
    const absentHtml = h.run(`sgTileHtml(${JSON.stringify(tile)}, '')`);
    assert.match(absentHtml, /&mdash;/);
    assert.match(absentHtml, /not a reported zero/);
    assert.ok(!/>0</.test(absentHtml), 'an absent category rendered as 0, which overstates coverage');
    // an explicitly reported zero is still a zero
    const zero = h.run(`sgAggregate(${JSON.stringify([study('B', { n_unknown: 0 })])})`);
    assert.equal(zero.totalsPresent.explicit_unknown, true);
    const zeroTile = h.run(`sgTiles(${JSON.stringify(zero)}, SG_SEX_TILE_KEYS)`).find((t) => t.key === 'explicit_unknown');
    assert.match(h.run(`sgTileHtml(${JSON.stringify(zeroTile)}, '')`), />0</);
    // the engine's published totals are aggregates: a key it omits is absent too
    const fromSummary = h.run("sgAggregateFromSummary({ totals: { female: 10, male: 5 }, outcomes: {}, statusCounts: {} })");
    assert.equal(fromSummary.totalsPresent.female, true);
    assert.equal(fromSummary.totalsPresent.explicit_unknown, false);
});

test('a copied link keeps whichever mode it was written with', () => {
    const fn = app.slice(app.indexOf('function updateShareUrl()'), app.indexOf('\nfunction ', app.indexOf('function updateShareUrl()') + 10));
    assert.ok(fn.includes("p.set('sg', sgFlag)"), 'the rebuilt hash drops the beta flag');
    assert.ok(fn.indexOf("p.set('sg', sgFlag)") < fn.indexOf('history.replaceState'), 'the flag is added after the hash is written');
    // an explicit opt-out survives as readily as an opt-in
    assert.equal(harness({ search: '', hash: '#sex?sg=v1' }).run('sgShareFlag()'), 'v1');
    assert.equal(harness({ search: '', hash: '#sex?sg=v2' }).run('sgShareFlag()'), 'v2');
    // the flag in the query survives replaceState on its own, so nothing is written
    assert.equal(harness({ search: '?sg=v2', hash: '#sex' }).run('sgShareFlag()'), null);
    // a remembered choice with nothing in the URL is written so a copy keeps it
    const remembered = harness({ search: '?sg=v2', hash: '' });
    remembered.run("location.search = '';");
    assert.equal(remembered.run('sgShareFlag()'), 'v2');
    assert.equal(harness({ search: '', hash: '#sex' }).run('sgShareFlag()'), null);
});

test('the beta comparison leaves an unpublished figure absent instead of zero', () => {
    const h = harness();
    // a summary that publishes nothing but the two sex totals
    const rows = h.run(`sgBetaRows({ cards: {}, sexDistribution: { female: 10 }, genderDistribution: {},
        sexGender: { totals: { female: 7 }, outcomes: {}, excludedFromComposition: {} } })`);
    assert.equal(rows.sex[0][1], 10);
    assert.equal(rows.sex[0][2], 7);
    assert.equal(rows.sex[1][1], null, 'an unpublished old total became a zero');
    assert.equal(rows.sex[1][2], null, 'an unpublished parser-v2 total became a zero');
    assert.equal(rows.gender[2][1], null, 'the three old gender tiles summed to zero when none was published');
    assert.equal(rows.excluded.trials, null);
    assert.equal(rows.denominatorTrials, null);
    const html = h.run(`sgBetaHtml(${JSON.stringify(rows)}, 'the latest pull')`);
    assert.ok(!/>0</.test(html), 'the comparison table rendered an absent figure as 0');
    assert.match(html, /over — trials with reported sex/);
    // and a published zero is still a zero
    const zero = h.run(`sgBetaRows({ cards: {}, sexDistribution: { male: 0 }, genderDistribution: {},
        sexGender: { totals: { male: 0 }, outcomes: {}, excludedFromComposition: {} } })`);
    assert.equal(zero.sex[1][1], 0);
    assert.equal(zero.sex[1][2], 0);
});

test('the methods text follows the snapshot, and a fallback says whose numbers it is', async () => {
    const urls = [];
    const h = harness({ search: '?sg=v2', fetch: async (u) => { urls.push(u); return { ok: false, status: 404 }; } });
    h.run("sgSnapshotKey = '2026-08-02';");
    await h.runRaw('sgLoadMethods()');
    assert.ok(urls.some((u) => u.startsWith('snapshots/2026-08-02/sex_gender/methods.json')),
        `the snapshot's own methods were not tried: ${urls.join(', ')}`);
    assert.ok(urls.some((u) => u.startsWith('data/sex_gender/methods.json')), 'the latest text was not tried as a fallback');
    assert.match(h.els['sg-methods'].innerHTML, /No methods text/);
    // the fallback notice names the mismatch rather than passing the latest off as the archive's
    const notice = h.run(`sgMethodsNotice('2026-08-02', { fromLatest: true, methods: { parser_rules_version: 'new-rules' } }, { parser_rules_version: 'old-rules' })`);
    assert.match(notice, /Not this snapshot's text/);
    assert.match(notice, /old-rules/);
    assert.match(notice, /new-rules/);
    // no notice when the text is the snapshot's own
    assert.equal(h.run(`sgMethodsNotice('2026-08-02', { fromLatest: false, methods: {} }, null)`), '');
    // matching versions may be called matching; a half-known pair may not
    assert.match(h.run(`sgMethodsNotice('2026-08-02', { fromLatest: true, methods: { parser_rules_version: 'same' } }, { parser_rules_version: 'same' })`),
        /Both were parsed with/);
    const halfKnown = h.run(`sgMethodsNotice('2026-08-02', { fromLatest: true, methods: {} }, { parser_rules_version: 'old-rules' })`);
    assert.match(halfKnown, /does not say which rules it describes/);
    assert.ok(!/same rules/.test(halfKnown), 'claimed the rules match with only one version known');
});

test('the v2 filters are disabled where no filter can bite', () => {
    const h = harness({ search: '?sg=v2' });
    h.run('sgAvailable = true; sgTable = new Map(); dashboardSummary = null; sgApplyMode();');
    for (const id of ['sg-status', 'sg-reported-sex', 'sg-participant-count', 'sg-glb']) {
        assert.equal(h.els[id].disabled, false, `${id} should be live on the full desktop dataset`);
    }
    // aggregate-summary mode: renderDashboard() never calls getFilteredData()
    h.run("dashboardSummary = { sexGender: {} }; sgApplyMode();");
    for (const id of ['sg-status', 'sg-reported-sex', 'sg-reported-gender', 'sg-reported-both', 'sg-glb', 'sg-participant-count']) {
        assert.equal(h.els[id].disabled, true, `${id} is inert in summary mode and must be disabled`);
        assert.match(h.els[id].title, /filters cannot apply/);
    }
    // and gender_labeled_binary_only still needs the CSV join
    h.run('dashboardSummary = null; sgTable = null; sgApplyMode();');
    assert.equal(h.els['sg-glb'].disabled, true);
    assert.equal(h.els['sg-status'].disabled, false);
});

test('the legacy Sex and Gender charts are skipped, not hidden, while parser v2 owns the tab', () => {
    // Building them costs eight Chart.js instances on the mobile summary path
    // and four on every desktop filter render, all inside containers
    // sgApplyMode() has already hidden. Every call site must sit behind an
    // sgActive() branch, whichever way round it is written.
    const legacy = ['renderSexReportedParticipants', 'renderSexFullDistribution', 'renderSexDistribution', 'renderSexTrends',
                    'renderGenderReportedParticipants', 'renderGenderFullDistribution', 'renderGenderDistribution', 'renderGenderTrends'];
    let sites = 0;
    for (const call of legacy) {
        for (const arg of ['(stub)', '(filtered)']) {
            let i = app.indexOf(call + arg);
            while (i > 0) {
                if (app.slice(i - 9, i) === 'function ') { i = app.indexOf(call + arg, i + 1); continue; }  // the definition, not a call
                sites++;
                const before = app.slice(Math.max(0, i - 700), i);
                assert.ok(before.includes('sgActive()'),
                    `${call}${arg} is built with no sgActive() guard, so parser v2 pays for a chart nobody sees`);
                i = app.indexOf(call + arg, i + 1);
            }
        }
    }
    assert.ok(sites >= 12, `expected the legacy renderers at the mobile, desktop and tab-click call sites, found ${sites}`);
});

test('the Sex tab leads with the composition, then the reporting quality that qualifies it', () => {
    const sex = html.slice(html.indexOf('<div id="sg-sex-v2"'), html.indexOf('<div class="sg-legacy">'));
    const pf = sex.indexOf('id="sg-pf-chart"');
    const donut = sex.indexOf('id="sg-sex-donut"');
    const quality = sex.indexOf('id="sg-quality-chart"');
    const tiles = sex.indexOf('id="sg-sex-tiles"');
    assert.ok(tiles < pf, 'the tiles lead');
    assert.ok(pf < quality && donut < quality, 'percent female and the sex breakdown belong above the reporting status');
});

test('a failed artifact request is retried; a 404 is remembered', async () => {
    let calls = 0;
    const h = harness({ search: '?sg=v2', fetch: async () => { calls++; throw new Error('network down'); } });
    await h.runRaw("sgLoad('2026-08-02')");
    const afterFailure = calls;
    assert.ok(afterFailure > 0, 'nothing was fetched');
    assert.equal(h.run("sgCache.has('2026-08-02')"), false, 'a dropped connection was cached as "this snapshot has no parser v2"');
    await h.runRaw("sgLoad('2026-08-02')");
    assert.ok(calls > afterFailure, 'the snapshot was never retried after the failure');
    // a 404 is a real answer and is remembered
    const h404 = harness({ search: '?sg=v2', fetch: async () => ({ ok: false, status: 404 }) });
    await h404.runRaw("sgLoad('2026-05-31')");
    assert.equal(h404.run("sgCache.has('2026-05-31')"), true, 'a definitive 404 should not be re-fetched on every switch');
    assert.equal(h404.run('sgAvailable'), false);
});

test('the methods section is reloaded for a snapshot with no parser-v2 artifacts', () => {
    // Otherwise the previous snapshot's text stays in the FAQ, presenting the
    // latest pull's dates, counts and rules as if they described this one.
    const loadFn = block.slice(block.indexOf('async function sgLoad('), block.indexOf('// ── Rows'));
    assert.ok(/if \(SG_V2\) sgMethodsPending = sgLoadMethods\(\)/.test(loadFn), 'the methods text is only refreshed when v2 artifacts exist');
    const h = harness();
    const notice = h.run("sgMethodsNotice('2026-08-02', { fromLatest: true, methods: { parser_rules_version: 'r' } }, null)");
    assert.match(notice, /predates parser v2/);
    assert.match(notice, /rules that were never applied to this snapshot/);
});

test('every v2 table scrolls inside its own container at 390px', () => {
    // The panels clip (overflow: hidden) and the global breakdown-table rules
    // floor the first two columns at 150px, so a table a few pixels too wide
    // loses a column instead of scrolling. Measured at 390px: the quality
    // table fits at 99.0% and overflows at 100.0%; the beta tables overflow.
    const h = harness();
    const quality = h.run('sgQualityTableHtml(sgQualityRows({ reported: 0, explicit_unknown_only: 61, uninformative: 0, not_reported: 0 }))');
    assert.match(quality, /^<div class="sg-table-scroll"><table/);
    assert.match(quality, /100\.0%/);
    const labels = h.run("sgLabelTableHtml([['Non-binary', 83]], 252)");
    assert.match(labels, /<div class="sg-table-scroll"><table/);
    const beta = h.run(`sgBetaHtml(sgBetaRows({ cards: {}, sexDistribution: { female: 1 }, genderDistribution: {},
        sexGender: { totals: { female: 1 }, outcomes: {}, excludedFromComposition: {}, denominatorTrials: 1 } }), 'the latest pull')`);
    assert.equal((beta.match(/<div class="sg-table-scroll">/g) || []).length, 3, 'each beta comparison table needs its own scroller');
    assert.ok(styles.includes('.sg-table-scroll'), 'styles.css has no rule for the scroll container');
    assert.match(styles.slice(styles.indexOf('.sg-table-scroll')), /overflow-x: auto/);
});

test("a column answers from its own table, never from the other dimension's state", () => {
    // sex_report_status covers both tables. On the 2026-09-15 pull 576 trials
    // have an uninformative sex table and no gender table, and 207 carry a
    // state with no sex table at all; the badge belongs in one column only.
    const h = harness();
    h.run('sgTable = null;');
    const cell = (over, field) => h.run(`sgDemographicCell(${JSON.stringify({ nct_id: 'NCT1', sex_gender: row(over) })}, '${field}')`);

    const noGender = { sex_report_status: 'uninformative', reported_sex: false, reported_gender: false, has_sex_table: true, has_gender_table: false };
    assert.match(cell(noGender, 'sex'), /Uninformative/);
    assert.ok(!/Uninformative/.test(cell(noGender, 'gender')), "the gender column borrowed the sex table's state");
    assert.match(cell(noGender, 'gender'), /No gender-titled baseline measure/);

    const noSex = { sex_report_status: 'uninformative', reported_sex: false, reported_gender: false, has_sex_table: false, has_gender_table: true };
    assert.match(cell(noSex, 'gender'), /Uninformative/);
    assert.ok(!/Uninformative/.test(cell(noSex, 'sex')), "the sex column borrowed the gender table's state");
    assert.match(cell(noSex, 'sex'), /No sex-titled baseline measure/);

    // where the flags are not joined in, the cell says so rather than guessing
    const unknown = { sex_report_status: 'uninformative', reported_sex: false, reported_gender: false, has_sex_table: null, has_gender_table: null };
    for (const f of ['sex', 'gender']) {
        assert.ok(!/Uninformative/.test(cell(unknown, f)), `${f} asserted a state without knowing which table it describes`);
        assert.match(cell(unknown, f), /not shipped to this view/);
    }
    assert.ok(h.run("SG_CSV_KEEP.includes('has_sex_table') && SG_CSV_KEEP.includes('has_gender_table')"));
    const parsed = h.run("[...sgParseCsv('nct_id,has_gender_table\\nNCT1,False\\nNCT2,True\\n', SG_CSV_KEEP).entries()]");
    assert.equal(parsed[0][1].has_gender_table, false);
    assert.equal(parsed[1][1].has_gender_table, true);
});

test('a methods request that failed is retried; a 404 is remembered', async () => {
    let calls = 0;
    const h = harness({ search: '?sg=v2', fetch: async () => { calls++; throw new Error('offline'); } });
    await h.runRaw('sgLoadMethods()');
    assert.equal(h.run("sgMethodsCache.has('latest')"), false, 'a dropped request was cached as "no methods published"');
    assert.match(h.els['sg-methods'].innerHTML, /could not be fetched/);
    const after = calls;
    await h.runRaw('sgLoadMethods()');
    assert.ok(calls > after, 'the methods text was never retried');
    const h404 = harness({ search: '?sg=v2', fetch: async () => ({ ok: false, status: 404 }) });
    await h404.runRaw('sgLoadMethods()');
    assert.equal(h404.run("sgMethodsCache.has('latest')"), true, 'a definitive 404 should not be re-fetched every time');
    assert.match(h404.els['sg-methods'].innerHTML, /No methods text/);
});

test('a methods deep link waits for the text instead of scrolling to the section top', () => {
    assert.ok(block.includes('sgMethodsPending'), 'the in-flight methods load is not tracked');
    const open = block.slice(block.indexOf('function sgOpenMethods('), block.indexOf('window.sgOpenMethods'));
    assert.ok(open.includes('sgMethodsPending.then(scroll, scroll)'), 'the deep link resolves its anchor before the text arrives');
    assert.ok(open.indexOf('const scroll = ()') < open.indexOf('sgMethodsPending.then'), 'the scroll is not deferred');
});

test('a rolled-back snapshot switch restores the parser state with the study data', () => {
    const handler = app.slice(app.indexOf("select.addEventListener('change'"), app.indexOf('// Provenance: the extraction date'));
    const cat = handler.slice(handler.indexOf('} catch (err)'));
    assert.ok(cat.includes('loadData(previousValue'), 'the rollback lost its data reload');
    assert.ok(cat.includes('sgLoad(previousValue'), 'the rollback leaves the parser on the snapshot that failed');
    assert.ok(cat.indexOf('sgLoad(previousValue') < cat.indexOf('renderDashboard()'), 'the parser state is restored after the re-render');
});

test('the share URL follows a filter change and a reset, not only a tab click', () => {
    const init = app.slice(app.indexOf('function initFilters()'), app.indexOf('function resetFilters'));
    assert.ok(init.includes('updateShareUrl()'), 'changing a filter leaves the address bar on the previous selection');
    const reset = app.slice(app.indexOf('function resetFilters'), app.indexOf('function updateActiveFilters'));
    assert.ok(reset.includes('updateShareUrl()'), 'resetting the filters leaves the address bar filtered');
});

test('a filter that stops applying stops claiming', () => {
    const apply = block.slice(block.indexOf('function sgApplyMode()'), block.indexOf('// ── Sex tab'));
    assert.ok(apply.includes('updateActiveFilters()'), 'the active-filter chips are not refreshed when the mode changes');
    assert.ok(apply.includes('if (changed'), 'the chips are rebuilt on every render rather than on a change');
    const chips = app.slice(app.indexOf('const sgLabels = {'), app.indexOf('container.innerHTML = filters.map'));
    assert.ok(chips.includes('!el.disabled'), 'a disabled v2 filter still renders a chip');
});

test('no share is computed from values that are not participant counts', () => {
    const h = harness();
    h.run('sgTable = null; data = [];');
    const show = (over) => {
        h.run(`data = [${JSON.stringify({ nct_id: 'NCT1', sex_gender: row(over) })}];`);
        h.run("sgShowBreakdown('NCT1', 'sex')");
        return h.els['breakdown-overlay'].innerHTML;
    };
    // a participant-count row divides its buckets as usual
    const counted = show({ n_female: 40, n_male: 60 });
    assert.match(counted, /Participants/);
    assert.match(counted, /40\.0%/);
    // a row whose values are eyes, percentages or means does not
    const units = show({ is_participant_count: false, n_female: 40, n_male: 60, param_type: 'COUNT_OF_UNITS', unit_of_measure: 'Eyes' });
    assert.match(units, /Published value/);
    assert.ok(!/40\.0%/.test(units), 'a share was computed from values that are not participants');
    assert.match(units, /COUNT_OF_UNITS · Eyes/);
    assert.match(units, /no share is computed from them/);
    assert.ok(h.run("SG_CSV_KEEP.includes('param_type') && SG_CSV_KEEP.includes('unit_of_measure')"));
});

test('a drill-down with no source labels says whether they were shipped', () => {
    const h = harness();
    h.run('sgTable = null; dashboardSummary = { sexGender: {} };');
    h.run(`data = [${JSON.stringify({ nct_id: 'NCT1', sex_gender: row({}) })}];`);
    h.run("sgShowBreakdown('NCT1', 'sex')");
    assert.match(h.els['breakdown-overlay'].innerHTML, /Source labels are not shipped/);
    // on desktop with the join, an empty trail means the trial really had none
    const d = harness();
    d.run('dashboardSummary = null; sgTable = new Map();');
    d.run(`data = [${JSON.stringify({ nct_id: 'NCT1', sex_gender: row({}) })}];`);
    d.run("sgShowBreakdown('NCT1', 'sex')");
    assert.ok(!/Source labels are not shipped/.test(d.els['breakdown-overlay'].innerHTML));
    assert.ok(!/Source labels need the parsed table/.test(d.els['breakdown-overlay'].innerHTML));
});

test('a failed beta-summary fetch is retried; a 404 is remembered', async () => {
    let calls = 0;
    const h = harness({ search: '?sg=v2', fetch: async () => { calls++; throw new Error('offline'); } });
    await h.runRaw('sgRenderBetaPanel()');
    assert.equal(h.run("sgBetaSummaries.has('latest')"), false, 'a dropped request was cached as "no summary published"');
    assert.match(h.els['sg-beta-body'].innerHTML, /could not be fetched/);
    const after = calls;
    await h.runRaw('sgRenderBetaPanel()');
    assert.ok(calls > after, 'the panel never retried');
    const h404 = harness({ search: '?sg=v2', fetch: async () => ({ ok: false, status: 404 }) });
    await h404.runRaw('sgRenderBetaPanel()');
    assert.equal(h404.run("sgBetaSummaries.has('latest')"), true, 'a definitive 404 should not be re-fetched every time');
    assert.match(h404.els['sg-beta-body'].innerHTML, /No dashboard-summary\.json/);
});

test('dismissing a filter chip rewrites the share URL', () => {
    const fn = app.slice(app.indexOf('function removeFilter('), app.indexOf('window.removeFilter'));
    assert.ok(fn.includes('updateShareUrl()'), 'the chip is dismissed but the address still carries the filter');
});

test('the mode is applied before the data is filtered, not after', () => {
    // Leaving a pre-v2 or aggregate archive with a v2 filter still set: the
    // controls were disabled from the archive when getFilteredData() ran, so
    // the filter was skipped, and sgApplyMode() then re-enabled them and
    // restored the chips without a re-render.
    const start = app.indexOf('function renderDashboard()');
    const render = app.slice(start, app.indexOf('\nfunction ', start + 10));
    const desktop = render.slice(render.indexOf('Desktop path'));
    // the call, not the prose about it
    assert.ok(desktop.includes('const filtered = getFilteredData()'), 'the desktop path no longer filters here');
    assert.ok(desktop.indexOf('sgApplyMode();') < desktop.indexOf('const filtered = getFilteredData()'),
        'the v2 controls are enabled after the data is filtered, so a remembered filter is silently dropped');
    // and a disabled control does not filter, whatever value it still holds
    // (sgReadFilters lives beside getFilteredData, outside the v2 block)
    const readFilters = app.slice(app.indexOf('function sgReadFilters()'), app.indexOf('let sgV2Filters'));
    assert.ok(readFilters.includes('!statusEl.disabled'), 'a disabled status select still filters');
    assert.ok(readFilters.includes('!el.disabled'), 'a disabled boolean select still filters');
});

test('the modal divides by the engine\'s published total, not by a sum of the rows', () => {
    const h = harness();
    h.run('sgTable = null; dashboardSummary = null; data = [];');
    const show = (over) => {
        h.run(`data = [${JSON.stringify({ nct_id: 'NCT1', sex_gender: row(over) })}];`);
        h.run("sgShowBreakdown('NCT1', 'sex')");
        return h.els['breakdown-overlay'].innerHTML;
    };
    // published total larger than the five shown buckets: the share follows it
    const published = show({ n_female: 40, n_male: 60, n_total_parsed: 200 });
    const table = (h) => h.slice(h.indexOf('Share of parsed'), h.indexOf('</table>'));
    assert.match(table(published), /20\.0%/, 'the share was computed from the rows rather than the published total');
    assert.ok(!/40\.0%/.test(table(published)), 'the share still divides by the sum of the shown rows');
    // no published total in this view: no share, and the modal says why
    const noTotal = show({ n_female: 40, n_male: 60, n_total_parsed: null });
    assert.ok(!/%/.test(table(noTotal)), 'a share was invented with no published total');
    assert.match(noTotal, /n_total_parsed/);
    assert.ok(h.run("SG_CSV_KEEP.includes('n_total_parsed')"));
});

test('the beta panel shows the three published legacy categories, not their sum', () => {
    const h = harness();
    const rows = h.run(`sgBetaRows({ cards: {}, sexDistribution: {}, genderDistribution: { nonbinary: 3498, transgender: 1371, other: 589 },
        sexGender: { totals: { gender_diverse: 20220 }, outcomes: {}, excludedFromComposition: {} } })`);
    const labels = rows.gender.map((r) => r[0]);
    assert.ok(labels.some((l) => /^Non-binary \(old\)/.test(l)));
    assert.ok(labels.some((l) => /^Transgender \(old\)/.test(l)));
    assert.ok(labels.some((l) => /^Other \(old\)/.test(l)));
    const olds = rows.gender.filter((r) => /\(old\) → Gender diverse/.test(r[0])).map((r) => r[1]);
    assert.deepEqual(olds, [3498, 1371, 589], 'the three published categories are not shown as published');
    assert.ok(!olds.includes(3498 + 1371 + 589), 'the page is still summing them into a statistic of its own');
    // the new bucket stands on its own row
    const gd = rows.gender.find((r) => /^Gender diverse \(new\)/.test(r[0]));
    assert.equal(gd[1], null);
    assert.equal(gd[2], 20220);
    assert.ok(!block.includes('const sum = (...vs)'), 'the summing helper is still in the block');
});

test('a legacy FAQ answer that contradicts parser v2 says so while the beta is on', () => {
    // These entries describe the retired rule, which Race and Ethnicity still
    // use, so they are labelled rather than hidden.
    assert.equal((html.match(/sg-faq-retired/g) || []).length, 2);
    const notReported = html.slice(html.indexOf('How is the "Not Reported (Missing)" category calculated?'));
    assert.ok(notReported.slice(0, 900).includes('sg-faq-retired'), 'the enrollment-residual answer is unlabelled under v2');
    const defined = html.slice(html.indexOf('How are Sex and Gender defined on this dashboard?'));
    assert.ok(defined.slice(0, 900).includes('sg-faq-retired'), 'the strict-separation answer is unlabelled under v2');
    // shown only with the beta on, through the same class the tabs use
    assert.ok(/class="note sg-v2 sg-hidden sg-faq-retired"/.test(html));
});

test('a disabled control is not serialized into the share URL', () => {
    const fn = app.slice(app.indexOf('function updateShareUrl()'), app.indexOf('\nfunction ', app.indexOf('function updateShareUrl()') + 10));
    assert.ok(fn.includes('!el.disabled'), 'a disabled filter still travels in the URL');
    const apply = block.slice(block.indexOf('function sgApplyMode()'), block.indexOf('// ── Sex tab'));
    assert.ok(apply.includes('updateShareUrl()'), 'the URL is not resynced when a control becomes live again');
});

test('the archive methods fallback is shown but not cached when the archive request merely failed', () => {
    const fn = block.slice(block.indexOf('async function sgLoadMethods'), block.indexOf('function sgMethodsNotice'));
    assert.ok(fn.includes('own.absent'), 'the fallback is taken without establishing that the archive has no file');
    assert.ok(fn.includes('if (!failed) sgMethodsCache.set(key, entry)'), 'a failed archive request is cached');
});
