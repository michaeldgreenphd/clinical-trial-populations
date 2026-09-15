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
    const el = (id) => (els[id] ||= { id, innerHTML: '', textContent: '', classList: { toggle() {} }, value: 'all', disabled: false, style: {} });
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

const row = (over) => Object.assign({
    sex_report_status: 'reported', reported_sex: true, reported_gender: false, reported_both: false,
    n_female: 40, n_male: 50, n_unknown: null, n_gender_diverse: null, n_ambiguous_gender: null,
    is_participant_count: true, uninformative_reason: null, declared_not_collected: false,
    enrollment_minus_parsed: 10, parser_rules_version: 'test-rules'
}, over);

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

test('the per-trial pip uses reported_any, derived as status == reported where the column is absent', () => {
    const h = harness();
    h.run('sgTable = null; sgAvailable = true;');
    const dim = (over, field) => h.run(`sgDimensionReported(${JSON.stringify({ nct_id: 'NCT1', sex_gender: row(over) })}, '${field}')`);
    assert.equal(dim({}, 'sex'), true);
    assert.equal(dim({ sex_report_status: 'explicit_unknown_only', reported_sex: false }, 'sex'), false);
    assert.equal(dim({ reported_any: false, sex_report_status: 'reported' }, 'sex'), false);   // the CSV column wins when present
    assert.equal(dim({ reported_gender: true }, 'gender'), true);
    assert.equal(dim({}, 'gender'), false);
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

test("percent female is the engine's published estimand, derived only where the file omits it", () => {
    const h = harness();
    // the published column wins over anything recomputed here
    assert.equal(h.run(`sgPercentFemale(${JSON.stringify(row({ n_female: 40, n_male: 60, percent_female: 37.5 }))})`), 37.5);
    // a row whose file does not carry the column falls back to the engine's formula
    assert.equal(h.run(`sgPercentFemale(${JSON.stringify(row({ n_female: 40, n_male: 60 }))})`), 40);
    // outside the denominator set there is no percent female, published or not
    assert.equal(h.run(`sgPercentFemale(${JSON.stringify(row({ is_participant_count: false, percent_female: 99 }))})`), null);
    assert.equal(h.run(`sgPercentFemale(${JSON.stringify(row({ reported_sex: false, percent_female: 99 }))})`), null);
    // and the column is joined in from the CSV as a number, with a blank left absent
    assert.ok(h.run("SG_CSV_KEEP.includes('percent_female')"), 'the CSV join drops the published percent_female');
    const parsed = h.run("[...sgParseCsv('nct_id,percent_female\\nNCT1,52.5\\nNCT2,\\n', SG_CSV_KEEP).entries()]");
    assert.equal(parsed[0][1].percent_female, 52.5);
    assert.equal(parsed[1][1].percent_female, null);
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
