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
import { gunzipSync } from 'node:zlib';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const START = '// ── Sex/gender parser v2 (sg=v2)';
const END = '// ── end sg=v2';
const startIdx = app.indexOf(START);
const endIdx = app.indexOf(END);
assert.ok(startIdx >= 0 && endIdx > startIdx, 'app.js lost the sg=v2 block markers');
const block = app.slice(startIdx, endIdx);
// sgBase resolves a snapshot's folder through app.js's datasetBase, and
// sgLoad names its dataset through datasetKey; both live outside the block:
// the real ones are evaluated beside it. No history.json has answered here
// (NEWEST_PUBLISHED null), so every date is an archive, as before it existed.
const fnAt = (sig) => {
    const at = app.indexOf(sig);
    assert.ok(at >= 0, `app.js lost ${sig}`);
    return app.slice(at, app.indexOf('\n}\n', at) + 2);
};
const datasetBaseSrc = 'let NEWEST_PUBLISHED = null;\nlet DATA_RUN_DATE = null;\nasync function newestPublishedReady() { return NEWEST_PUBLISHED; }\n'
    + fnAt('function servedFromData(date)') + fnAt('function datasetKey(date)') + fnAt('function datasetBase(key)');

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
        ChartDataLabels: {}, donutConfig: () => ({}),
        // app.js's drawOverlay (tests/overlay_dialog.test.mjs has its focus
        // handling); here it only puts the pop-up's markup on screen.
        drawOverlay: (id, markup) => { const o = el(id); o.innerHTML = markup; o.style.display = 'flex'; }
    });
    // keyedFetch and fetchChecked are tests/data_cache_key.test.mjs's; here
    // they only add the key, through the stub fetch.
    vm.runInContext("async function keyedFetch(path, init) { return fetch(`${path}?v=${DATA_CACHE_VERSION}`, init); }\nasync function fetchChecked(path) { return keyedFetch(path); }\n" + datasetBaseSrc + block, context);
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
    assert.equal(agg.glbKnown, false, 'gender_labeled_binary_only is unknown without the CSV join');
    // percent female is computed here, never read: series (a) mean and (b) weighted, largest trial kept
    const years = h.run(`sgYearSeries(${JSON.stringify(studies)})`);
    const pts = h.run(`sgSeriesPoints(${JSON.stringify(years)})`);
    assert.deepEqual(pts.labels, ['2020', '2021']);
    assert.ok(Math.abs(pts.a[0] - 100 * 40 / 90) < 1e-9 && Math.abs(pts.b[0] - 100 * 40 / 90) < 1e-9);
    assert.equal(pts.largest[1], null, 'the desktop path ranked the rows and named a largest trial of its own');
});

test('the summary block yields the same shape for mobile', () => {
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
    assert.deepEqual(agg.excluded, { trials: 112, female: 804166, male: 666273 });
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

// Desktop counts the source labels itself (sgLabelCounts); phones and
// aggregate archives show the engine's published top lists, which
// generate_mobile_data.py sorts with sorted(key=(-count, label)): Python
// compares strings by code point. Tied labels must land in the same order on
// both, or the 60-row table cut keeps different labels.
const sgStudiesWithLabels = (key, pairs) => pairs.flatMap(([label, n], i) =>
    Array.from({ length: n }, (_, j) => ({ nct_id: `NCT${i}-${j}`, sex_gender: { [key]: [label] } })));

test('tied source labels sort by code point, as the engine sorts its published lists', () => {
    const h = harness();
    const put = h.runRaw('(name, value) => { globalThis[name] = value; }');
    const order = (pairs) => {
        put('__studies', sgStudiesWithLabels('gender_diverse_labels', pairs));
        return h.run("sgLabelCounts(__studies, 'gender_diverse_labels')");
    };
    // capitals before lower case, whatever the browser's locale
    assert.deepEqual(order([['other', 7], ['Other Gender', 7], ['Non-binary', 9]]),
        [['Non-binary', 9], ['Other Gender', 7], ['other', 7]]);
    // Python's own order for these five tied labels (sorted() on 3.x):
    // ASCII, then Latin-1, then U+FF4F, then U+1F308. A UTF-16 comparison
    // (JS <) would put the astral label before U+FF4F; localeCompare would
    // compare letters before case and accents. Every input below arrives out
    // of order, since a sort that leaves ties alone would keep input order.
    const tied = ['\u{1F308} queer', 'ｏther', 'Étranger', 'other', 'Other'];
    assert.deepEqual(order(tied.map((l) => [l, 3])).map(([l]) => l),
        ['Other', 'other', 'Étranger', 'ｏther', '\u{1F308} queer']);
    // a label that is a prefix of another sorts first; count still leads
    assert.deepEqual(order([['Other Gender', 2], ['Other', 2], ['Z', 4]]),
        [['Z', 4], ['Other', 2], ['Other Gender', 2]]);
});

test("desktop ranks the published top lists' labels in the published order", () => {
    const summary = JSON.parse(readFileSync(new URL('../data/dashboard-summary.json', import.meta.url), 'utf8'));
    const h = harness();
    const put = h.runRaw('(name, value) => { globalThis[name] = value; }');
    const moved = {}, ranked = [];
    for (const t of h.run('SG_LABEL_TRAILS')) {
        const published = ((summary.sexGender || {}).labels || {})[t.summaryKey];
        assert.ok(published && published.top.length > 0, `${t.summaryKey}: the summary has no published top list`);
        const expected = published.top.map(([l, n]) => [l, n]);
        // fed in reverse, so a tie the comparator leaves alone stays reversed
        put('__studies', sgStudiesWithLabels(t.key, [...expected].reverse()));
        const desktop = h.run(`sgLabelCounts(__studies, '${t.key}')`);
        // the rows the label table renders (sgLabelTableHtml shows 60)
        moved[t.summaryKey] = desktop.slice(0, 60).filter((p, i) => !expected[i] || p[0] !== expected[i][0]).length;
        ranked.push([t.summaryKey, desktop, expected]);
    }
    assert.deepEqual(moved, { gender_diverse: 0, ambiguous: 0, unknown: 0 },
        'rows of the top 60 that desktop places differently from the published list');
    for (const [k, desktop, expected] of ranked) {
        assert.deepEqual(desktop, expected, `${k}: desktop's ranking differs from the published list`);
    }
});

test('the flag: parser v2 is the default; ?sg=v1 turns it off and is remembered, ?sg=v2 back on', () => {
    assert.equal(harness({ search: '?sg=v2' }).run('SG_V2'), true);
    assert.equal(harness({ search: '' }).run('SG_V2'), true, 'a reader who chose nothing sees parser v2');
    const h = harness({ search: '?sg=v2' });
    assert.equal(h.run("localStorage.getItem('civicsample.sg')"), 'v2');
    assert.equal(harness({ search: '?sg=v1' }).run('SG_V2'), false);
    // a remembered opt-out outlives the default
    const out = harness({ search: '?sg=v1' });
    out.run("location.search = '';");
    assert.equal(out.run("localStorage.getItem('civicsample.sg')"), 'v1');
    assert.equal(out.run('sgReadFlag()'), false, 'a remembered ?sg=v1 was overridden by the default');
});

test('the markup carries the v2 filters, the methods section and the anchors the tabs link to', () => {
    for (const id of ['sg-status', 'sg-reported-sex', 'sg-reported-gender', 'sg-reported-both', 'sg-glb', 'sg-participant-count']) {
        assert.ok(html.includes(`id="${id}"`), `index.html has no #${id} control`);
    }
    assert.ok(html.includes('id="methods-sex-gender"'), 'the FAQ has no entry on how sex and gender are counted');
    // the status filter is the overall state, which counts gender-only trials as Reported
    assert.ok(html.includes('<label for="sg-status">Sex and gender reporting status:</label>'), 'the status filter is labelled as sex-only');
    // both tabs link to the FAQ entry, and it carries no engine methods text
    assert.equal((html.match(/How sex and gender are counted: <a href="#faq" onclick="return sgOpenMethods\(\)">see the FAQ<\/a>\./g) || []).length, 2);
    assert.ok(!html.includes('id="sg-methods-full"') && !html.includes('id="sg-methods"'), 'the FAQ shows the full methods panel again');
    assert.ok(!/methods\.json/.test(block.replace(/\/\/.*$/gm, '')), 'the site still fetches the methods text');
    assert.ok(html.includes('id="sg-retired-banner"'));
    // the legacy blocks are wrapped so the v2 blocks can replace them by class
    assert.equal((html.match(/class="sg-legacy"/g) || []).length, 2);
    // and the app wires the flag into the loader, the filters, the table and the tab renders
    for (const needle of ['await sgLoad(opened || undefined)', 'sgV2Filters = sgReadFilters()', 'return sgDimensionReported(study, field)', 'return sgDemographicCell(study, field)', 'return sgShowBreakdown(nctId, categoryName)', 'sgAfterRender(filtered)']) {
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
    assert.ok(!/stat-sub/.test(h.run("sgTileHtml({ key: 'female', label: 'Female', color: '#000', value: 1, note: '' }, '')")),
        'a tile without a note still carries an empty note line');
});

test('the flag survives the routing stubs, which move the query into the hash', () => {
    // /sex/?sg=v2 is bounced by the stub to /#sex?sg=v2: location.search is
    // then empty and the only copy of the flag is in the hash query.
    assert.equal(harness({ search: '', hash: '#sex?sg=v2' }).run('SG_V2'), true);
    assert.equal(harness({ search: '', hash: '#sex?ys=2015&sg=v2' }).run('SG_V2'), true);
    assert.equal(harness({ search: '', hash: '#sex?sg=v1' }).run('SG_V2'), false);
    assert.equal(harness({ search: '', hash: '#sex' }).run('SG_V2'), true, 'no flag anywhere: the default, parser v2');
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
    assert.match(render, /unavailable: not published for every trial here/);
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
    // and a remembered opt-out travels the same way, or a reader who remembers
    // v2 would open the sender's legacy view as the beta
    const optedOut = harness({ search: '?sg=v1', hash: '' });
    optedOut.run("location.search = '';");
    assert.equal(optedOut.run('sgShareFlag()'), 'v1', 'a remembered v1 is dropped from the link');
    assert.equal(harness({ search: '', hash: '#sex' }).run('sgShareFlag()'), null);
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

test('the newest published date reads the latest pull\'s v2 files, and shares their cache entry', async () => {
    const urls = [];
    const h = harness({ search: '?sg=v2', fetch: async (url) => { urls.push(url); return { ok: false, status: 404 }; } });
    h.runRaw("NEWEST_PUBLISHED = '2026-10-04'; DATA_RUN_DATE = '2026-10-04'");   // history.json and data/run.json agree
    await h.runRaw("sgLoad('2026-10-04')");
    assert.equal(h.run('sgSnapshotKey'), 'latest', 'the newest date is shown as an archive of itself');
    assert.ok(urls.length > 0 && urls.every((u) => u.startsWith('data/')), `asked of snapshots/: ${urls.join(', ')}`);
    assert.equal(h.run("sgCache.has('2026-10-04')"), false, 'a second cache entry for the latest pull');
    const before = urls.length;
    await h.runRaw('sgLoad()');
    assert.equal(urls.slice(before).filter((u) => u.includes('sex_gender_parsed')).length, 0, 'the latest pull was fetched again');
    // An older week keeps its own folder.
    await h.runRaw("sgLoad('2026-08-02')");
    assert.ok(urls.some((u) => u.startsWith('snapshots/2026-08-02/sex_gender_parsed_meta.json')));
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

test('every v2 table scrolls inside its own container at 390px', () => {
    // The panels clip (overflow: hidden) and the global breakdown-table rules
    // floor the first two columns at 150px, so a table a few pixels too wide
    // loses a column instead of scrolling. Measured at 390px: the quality
    // table fits at 99.0% and overflows at 100.0%; the beta tables overflow.
    const h = harness();
    // The tabs no longer carry these tables (the canvas boards left them out);
    // the scroller remains for the tables the pop-ups still show.
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

test('a gender-only trial with a sex table gets a named Sex cell, not a blank button', () => {
    // Four rows ship with reported_sex false, reported_gender true, a sex
    // table present and the overall state "reported"; sgStatusBadge() has no
    // badge for "reported", so the cell used to be an empty button.
    const h = harness();
    h.run('sgTable = null;');
    const over = { reported_sex: false, reported_gender: true, has_sex_table: true, has_gender_table: true,
                   sex_report_status: 'reported', n_female: null, n_male: null, n_gender_diverse: 37 };
    const cell = h.run(`sgDemographicCell(${JSON.stringify({ nct_id: 'NCT1', sex_gender: row(over) })}, 'sex')`);
    assert.ok(!/<button[^>]*>\s*<\/button>/.test(cell), 'the Sex cell is an empty button');
    assert.match(cell, /—/);
    assert.match(cell, /carries no Female, Male or Unknown count/);
    // and the Gender column still reports
    assert.match(h.run(`sgDemographicCell(${JSON.stringify({ nct_id: 'NCT1', sex_gender: row(over) })}, 'gender')`), /demo-badge-check/);
});

test('the stacked states carry a texture as well as a colour', () => {
    const h = harness();
    // every visible state has one, and they are all different
    const textures = h.run('SG_VISIBLE_STATES.map(s => SG_STATE_TEXTURES[s])');
    assert.equal(textures.length, 4);
    assert.equal(new Set(textures).size, 4, 'two states share a texture, so colour is still the only thing separating them');
    // both year charts ask for them, so a state looks the same in each
    const render = block.slice(block.indexOf('function sgRenderQualityByYear'), block.indexOf('function sgRenderPercentFemale'));
    assert.ok(render.includes('color: SG_STATE_COLORS[st], texture: SG_STATE_TEXTURES[st]'), 'the year charts dropped the state textures');
    assert.ok(render.includes('sgTexture(ctx, x.color, x.texture)'), 'the stacked bars are painted with flat colour');
    // the reporting-status rows name the same texture as CSS classes
    const horizontal = block.slice(block.indexOf('function sgRenderQuality('), block.indexOf('function sgStatusByYear'));
    assert.ok(horizontal.includes('texture: SG_ROW_TEXTURES[SG_STATE_TEXTURES[r.key]]'), 'the status rows use a different encoding from the stacked bars');
    const rowTex = h.run('SG_VISIBLE_STATES.map(s => SG_ROW_TEXTURES[SG_STATE_TEXTURES[s]])');
    assert.equal(new Set(rowTex).size, 4, 'two status rows share a texture');
    for (const t of rowTex.filter((x) => x !== 'solid')) assert.ok(styles.includes(`.demo-tex-${t}`), `styles.css has no .demo-tex-${t}`);
    // and a context-less environment degrades to the colour rather than throwing
    assert.equal(h.run("sgTexture(null, '#0F7A4F', 'dots')"), '#0F7A4F');
    assert.equal(h.run("sgTexture(null, '#0F7A4F', 'solid')"), '#0F7A4F');
    // the legend shows each texture beside its name
    assert.ok(render.includes("{ canvas: ctx, legend: true, yTicks: 'pct' }"), 'the year charts lost the legend that names the textures');
});

test('the bucket compositions are named rows, with Explicit Unknown set apart as absence', () => {
    // The doughnuts became labelled rows (the design canvas, 2026-11-08):
    // every bucket is named in text, so colour never carries identity alone,
    // and Explicit Unknown keeps the hatched absence grey, never a hue.
    const h = harness();
    const agg = { totals: { female: 60, male: 30, gender_diverse: 4, ambiguous: 1, explicit_unknown: 5 }, totalsPresent: {} };
    const rows = h.run(`sgBucketRows(${JSON.stringify(agg)}, SG_BUCKETS.map(b => b.key), SG_GENDER_SHADES)`);
    assert.deepEqual(rows.map((r) => r.label), ['Female', 'Male', 'Gender diverse', 'Cis/trans-qualified', 'Explicit Unknown']);
    const unknown = rows.find((r) => r.label === 'Explicit Unknown');
    assert.equal(unknown.absent, true);
    assert.equal(unknown.texture, 'hatch');
    assert.ok(rows.filter((r) => !r.absent).every((r) => r.texture === 'solid'));
    // an absent bucket is left out of the rows, as it was out of the doughnut
    const missing = h.run(`sgBucketRows(${JSON.stringify({ ...agg, totalsPresent: { explicit_unknown: false } })}, SG_SEX_TILE_KEYS, SG_SEX_SHADES)`);
    assert.deepEqual(missing.map((r) => r.label), ['Female', 'Male']);
    // each tab draws Female and Male in its own shade
    assert.notEqual(h.run('SG_SEX_SHADES.female'), h.run('SG_GENDER_SHADES.female'));
    assert.notEqual(h.run('SG_SEX_SHADES.male'), h.run('SG_GENDER_SHADES.male'));
    for (const fn of ['sgRenderSexDonut', 'sgRenderGenderTab']) {
        const src = block.slice(block.indexOf(`function ${fn}`), block.indexOf(`function ${fn}`) + 1400);
        assert.ok(src.includes('demoRowsHtml(sgBucketRows('), `${fn} no longer draws named rows`);
    }
    // the textures still degrade to the colour without a canvas
    assert.equal(h.run("sgTexture(null, '#C2477E', 'horizontal')"), '#C2477E');
    assert.ok(styles.includes('.demo-tex-hatch'));
});

test('an unavailable F/M-only flag is not read as a negative', () => {
    // The lean rows carry no gender_labeled_binary_only, so === true would
    // drop the label from all 2,955 such trials whenever the join fails.
    const h = harness();
    h.run('sgTable = null;');
    const cell = (glb) => h.run(`sgDemographicCell(${JSON.stringify({ nct_id: 'NCT1', sex_gender: row({ gender_labeled_binary_only: glb }) })}, 'gender')`);
    assert.match(cell(true), /F\/M only/);
    assert.match(cell(false), /no gender-diverse or cis\/trans-qualified category/);
    const unknown = cell(null);
    assert.ok(!/F\/M only/.test(unknown), 'an unknown flag was rendered as a positive');
    assert.match(unknown, /not shipped to this view/);
    assert.ok(!/no gender-diverse or cis\/trans-qualified category/.test(unknown), 'an unknown flag was rendered as a negative');
});

test('the address names the archived snapshot on screen', () => {
    // The stubs move ?sgsnapshot= into the hash and the first rewrite dropped
    // it, so a copied or reloaded address opened Latest over an archive.
    const fn = app.slice(app.indexOf('function updateShareUrl()'), app.indexOf('\nfunction ', app.indexOf('function updateShareUrl()') + 10));
    assert.ok(fn.includes("p.set('sgsnapshot', snap.value)"), 'the rebuilt hash does not name the archive on screen');
    assert.ok(fn.includes("snap.value !== 'latest'"), 'Latest is written into the address as if it were an archive');
    assert.ok(fn.indexOf("p.set('sgsnapshot'") < fn.indexOf('history.replaceState'));
    // and the address is rewritten when the snapshot changes, in both directions
    const handler = app.slice(app.indexOf("select.addEventListener('change'"), app.indexOf('// Provenance: the extraction date'));
    const success = handler.slice(0, handler.indexOf('} catch (err)'));
    const rollback = handler.slice(handler.indexOf('} catch (err)'));
    assert.ok(success.includes('updateShareUrl()'), 'a snapshot switch leaves the address on the previous snapshot');
    assert.ok(rollback.includes('updateShareUrl()'), 'a rolled-back switch leaves the address on the snapshot that failed');
});

test('the chart text alternatives are relabelled after a snapshot change', () => {
    // The provenance note under the parser-v2 charts names the snapshot and
    // is copied into each canvas's aria-label; a switch that leaves the Sex
    // tab open re-rendered the note but not the label.
    const handler = app.slice(app.indexOf("select.addEventListener('change'"), app.indexOf('// Provenance: the extraction date'));
    const success = handler.slice(0, handler.indexOf('} catch (err)'));
    const rollback = handler.slice(handler.indexOf('} catch (err)'));
    for (const [name, part] of [['success', success], ['rollback', rollback]]) {
        assert.ok(part.includes('labelChartsForA11y()'), `the ${name} path leaves the canvases labelled with the previous snapshot`);
        assert.ok(part.indexOf('renderDashboard()') < part.indexOf('labelChartsForA11y()'), `the ${name} path relabels before it re-renders`);
    }
});

test("the largest-trial annotation is the engine's, never ranked or shared here", () => {
    const h = harness();
    // the summary path carries the published annotation as published
    const fromSummary = h.run(`sgSeriesPoints(sgYearSeriesFromSummary({ '2013': { sg_pf_sum: 100, sg_pf_count: 2, sg_f_sum: 70, sg_fm_sum: 100, largest_trial: { nct_id: 'NCT01077817', share: 0.288 } },
                                                                      '2014': { sg_pf_sum: 100, sg_pf_count: 2, sg_f_sum: 50, sg_fm_sum: 100 } }))`);
    assert.deepEqual(fromSummary.largest[0], { nct_id: 'NCT01077817', share: 0.288 });
    assert.equal(fromSummary.largest[1], null, 'a year the engine did not annotate was annotated here');
    // and the desktop path computes none, whatever the rows say
    h.run('sgTable = null;');
    const desktop = h.run(`sgSeriesPoints(sgYearSeries(${JSON.stringify([
        { nct_id: 'BIG', results_date: '2020-01-01', sex_gender: row({ n_female: 900, n_male: 100 }) },
        { nct_id: 'SMALL', results_date: '2020-01-01', sex_gender: row({ n_female: 1, n_male: 1 }) }])}))`);
    assert.equal(desktop.largest[0], null);
    assert.ok(!/d\.largest\.fm \/ d\.fm/.test(code), 'the client-side share derivation is back');
    assert.ok(!/f \+ m > d\.largest\.fm/.test(code), 'the client-side ranking is back');
    // the series itself still stands, as a sum of published counts
    assert.ok(Math.abs(desktop.b[0] - 100 * 901 / 1002) < 1e-9);
});

test('a stale sgsnapshot in the query is rewritten with the hash', () => {
    const fn = app.slice(app.indexOf('function updateShareUrl()'), app.indexOf('\nfunction ', app.indexOf('function updateShareUrl()') + 10));
    assert.ok(fn.includes("sp.delete('sgsnapshot')"), 'the query keeps the archive the page opened with, and the readers prefer the query');
    assert.ok(fn.includes('location.pathname + search + '), 'the rewrite replaces only the fragment, so the query survives untouched');
});

test('sgLoad records which kind of missing meta it saw', async () => {
    const gone = harness({ search: '?sg=v2', fetch: async () => ({ ok: false, status: 404 }) });
    await gone.runRaw("sgLoad('2026-05-31')");
    assert.equal(gone.run('sgMetaAbsent'), true);
    const down = harness({ search: '?sg=v2', fetch: async () => { throw new Error('offline'); } });
    await down.runRaw("sgLoad('2026-05-31')");
    assert.equal(down.run('sgMetaAbsent'), false, 'a dropped meta request was recorded as a confirmed absence');
});

test('a second chart in a panel is named by its own heading, not the panel\'s', () => {
    const src = app.slice(app.indexOf('function labelChartsForA11y()'), app.indexOf('// ── Shareable URLs'));
    const el = (tag, text, cls = '') => ({ tagName: tag, textContent: text, classList: { contains: (k) => cls.split(' ').includes(k) },
        matches: (q) => q.split(', ').includes(tag.toLowerCase()), attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
    const h1 = el('H3', 'Reporting status'), rows = el('DIV', ''), h2 = el('H3', 'Trials not reporting sex, zoomed in', 'sg-follow');
    const zoom = el('CANVAS', ''), lone = el('CANVAS', ''), lh = el('H3', 'Percent female over time'), ln = el('P', 'A note.', 'note');
    const link = (list) => list.forEach((x, i) => { x.previousElementSibling = list[i - 1] || null; x.nextElementSibling = list[i + 1] || null; });
    link([h1, rows, h2, zoom]); link([lh, ln, lone]);
    const boxA = { querySelector: (q) => (q === '.note' ? null : h1) }, boxB = { querySelector: (q) => (q === '.note' ? ln : lh) };
    zoom.closest = () => boxA; lone.closest = () => boxB;
    const ctx = vm.createContext({ document: { querySelectorAll: () => [zoom, lone] } });
    vm.runInContext(src, ctx);
    vm.runInContext('labelChartsForA11y()', ctx);
    assert.equal(zoom.attrs['aria-label'], 'Trials not reporting sex, zoomed in', 'the zoomed chart is announced with the panel\'s first heading');
    assert.equal(lone.attrs['aria-label'], 'Percent female over time. A note.', 'a single-chart panel lost its label');
});

test('the FAQ entry states the unit of each figure and the parser\'s rule for reporting sex', () => {
    const faq = html.slice(html.indexOf('id="methods-sex-gender"'), html.indexOf('</details>', html.indexOf('id="methods-sex-gender"')));
    assert.match(faq, /The composition rows count participants; the reporting charts count trials\./);
    assert.match(faq, /at least one female or male participant/, 'the FAQ requires both counts, which the parser does not');
    // a share in fixed markup goes stale with the data; the tab shows it with its denominator
    assert.ok(!/\d+(\.\d+)?%/.test(faq), 'the FAQ states a fixed percentage');
    // the states are the engine's, mutually exclusive
    assert.match(faq, /lists participants only as Unknown/);
    assert.match(faq, /Not reported: the trial posted no sex or gender table at all\./);
    assert.match(faq, /A trial that lists Unknown beside female or male counts is Reported\./);
});

test('the year charts count every trial in the year, parse errors included', () => {
    const h = harness();
    h.run('sgTable = null; dashboardSummary = null;');
    const studies = [
        { nct_id: 'A', results_date: '2021-01-01', sex_gender: row({}) },
        { nct_id: 'B', results_date: '2021-03-01', sex_gender: row({}) },
        { nct_id: 'C', results_date: '2021-06-01', sex_gender: row({ sex_report_status: 'parse_error', reported_sex: false }) }
    ];
    const y = h.run(`sgStatusByYear(${JSON.stringify(studies)})`)['2021'];
    assert.equal(y.total, 3, 'a parse error left the year\'s denominator');
    assert.equal(y.reported, 2);
    assert.equal(y.parse_error, 1);
    // the summary path reads the same five states
    h.run(`dashboardSummary = { sexGender: { byYear: { 2021: { status_reported: 2, status_parse_error: 1 } } } };`);
    assert.equal(h.run('sgStatusByYear([])')['2021'].total, 3);
    // a trial that posted only a gender category is Reported, but not a sex report
    h.run('dashboardSummary = null;');
    const withGender = studies.concat([{ nct_id: 'D', results_date: '2021-07-01', sex_gender: row({ reported_sex: false, reported_gender: true }) }]);
    const shares = h.run(`sgSexYearShares(${JSON.stringify(withGender)})`)['2021'];
    assert.equal(shares.reported, 3);
    assert.equal(shares.reported_sex, 2, 'a gender-only trial was counted as reporting sex');
    assert.equal(shares.gender_only, 1);
    h.run(`dashboardSummary = { sexGender: { byYear: { 2021: { status_reported: 3, reported_sex: 2, status_parse_error: 1 } } } };`);
    assert.equal(h.run('sgSexYearShares([])')['2021'].gender_only, 1);
    const sexSeries = block.slice(block.indexOf('const SG_SEX_YEAR_LEAD'), block.indexOf('function sgRenderQualityByYear'));
    assert.match(sexSeries, /label: 'Reported sex'/);
    assert.ok(!h.run('SG_VISIBLE_STATES.map(s => SG_STATE_TEXTURES[s])').includes('horizontal'), 'the gender-only series shares a texture with a state');
    // and the gender series read apart without colour
    const marks = h.run('SG_DIMENSION_SERIES.map(x => x.outline ? "outline" : x.texture)');
    assert.equal(new Set(marks).size, 4, 'two gender series share a mark, so colour alone tells them apart');
});

test('the reporting shares are over every selected trial, parse errors included', () => {
    const render = block.slice(block.indexOf('function sgRenderQuality('), block.indexOf('function sgStatusByYear'));
    assert.ok(render.includes('const total = SG_V2_STATES.reduce('), 'the rows left the unparsed trials out of the denominator');
    assert.ok(render.includes("{ noun: 'trials', total, keepOrder: true }"));
    assert.match(render, /could not be read\. They are in the shares above\./);
});

test('a query-style archive link still opens the archive after the query is rewritten', () => {
    // The first tab render rewrites the query without sgsnapshot, and the
    // deep-link hooks run after it, so they must read the query the page
    // opened with rather than the live one.
    const h = harness({ search: '?sg=v2&sgsnapshot=2026-08-02', hash: '#sex' });
    h.run("location.search = '?sg=v2';");                 // what the rewrite leaves behind
    assert.equal(h.run("sgQueryParams('#sex').get('sgsnapshot')"), undefined, 'the live query still carries it, so this test proves nothing');
    assert.equal(h.run("sgQueryParams(SG_INITIAL_HASH, SG_INITIAL_SEARCH).get('sgsnapshot')"), '2026-08-02');
    const hooks = block.slice(block.indexOf('function sgRouteHooks()'), block.indexOf('// Which v2 tab renderers'));
    assert.ok(hooks.includes('sgQueryParams(SG_INITIAL_HASH, SG_INITIAL_SEARCH)'), 'the hooks read the live query, which the rewrite has already stripped');
});

test('the retired-rule banner is reserved for a confirmed absence; a failed fetch says so and offers a retry', () => {
    const h = harness({ search: '?sg=v2' });
    // the two texts differ in what they claim
    const retired = h.run("sgBannerHtml('retired')");
    const unavailable = h.run("sgBannerHtml('unavailable')");
    assert.match(retired, /made before the current sex and gender counts/);
    assert.ok(!/made before/.test(unavailable), 'a failed fetch was described as an older snapshot');
    assert.match(unavailable, /could not be fetched just now/);
    assert.match(unavailable, /does not mean the snapshot lacks them/);
    for (const t of [retired, unavailable]) assert.ok(!/parser|v2|rule\b/i.test(t.replace('sgRetry', '')), `the banner still uses jargon: ${t}`);
    assert.match(unavailable, /sgRetry\(\)/);
    // and the mode picks by the confirmed-absence flag, not by availability alone
    const apply = block.slice(block.indexOf('function sgApplyMode()'), block.indexOf('// ── Sex tab'));
    assert.ok(apply.includes("(sgMetaAbsent ? 'retired' : 'unavailable')"), 'any missing table enters retired mode');
    assert.ok(apply.includes('el.innerHTML = sgBannerHtml(state)'), 'the banner text is fixed in the markup, so it cannot say which case it is');
    // the retry re-fetches the snapshot on screen and re-renders
    const retry = block.slice(block.indexOf('async function sgRetry()'), block.indexOf('window.sgRetry'));
    assert.ok(retry.includes("sgLoad(sgSnapshotKey === 'latest' ? undefined : sgSnapshotKey)"));
    assert.ok(retry.indexOf('sgLoad(') < retry.indexOf('renderDashboard()'));
});

// The joined table must be the run its meta describes (sgTableMatchesMeta):
// during a deploy the server can answer last week's CSV beside this week's
// meta, and joining them would show last week's parse on this week's trials.
const CSV_META = { n_rows: 2, snapshot_date: '2026-10-04', source_extracted_at: '2026-10-04T11:02:41+00:00' };
const sgCsv = (date, n = 2) => 'nct_id,snapshot_date,reported_any\n'
    + Array.from({ length: n }, (_, i) => `NCT0000000${i + 1},${date},TRUE`).join('\n') + '\n';
async function loadWithCsv(texts) {
    const h = harness({ search: '?sg=v2', fetch: async (u) => (u.startsWith('data/sex_gender_parsed_meta.json')
        ? { ok: true, status: 200, json: async () => CSV_META } : { ok: false, status: 404 }) });
    h.runRaw(`var __csv = []; var __texts = ${JSON.stringify(texts)};
        sgFetchGzText = async (url, init) => { __csv.push([url, (init && init.cache) || 'default']); return __texts[Math.min(__csv.length - 1, __texts.length - 1)]; };`);
    await h.runRaw('sgLoad()');
    return { csvCalls: h.run('__csv'), size: h.run('sgTable ? sgTable.size : null'), cached: h.run("sgCache.has('latest')") };
}

test('a table matching its meta is joined after one fetch', async () => {
    const r = await loadWithCsv([sgCsv('2026-10-04')]);
    assert.deepEqual(r.csvCalls, [['data/sex_gender_parsed.csv.gz', 'default']]);
    assert.equal(r.size, 2);
    assert.equal(r.cached, true);
});

test('a table from another run than its meta is fetched again past the cache', async () => {
    for (const stale of [sgCsv('2026-09-27'), sgCsv('2026-10-04', 3)]) {
        const r = await loadWithCsv([stale, sgCsv('2026-10-04')]);
        assert.deepEqual(r.csvCalls.map(([, c]) => c), ['default', 'reload']);
        assert.equal(r.size, 2, 'the fresh table was not joined');
        assert.equal(r.cached, true);
    }
});

test('a table that still does not match is not joined, and not cached', async () => {
    const r = await loadWithCsv([sgCsv('2026-09-27'), sgCsv('2026-09-27')]);
    assert.equal(r.size, null, 'last week\'s parse was joined onto this week\'s trials');
    assert.equal(r.cached, false, 'a mismatch was cached for the session');
});

test('this week\'s real table matches its meta', () => {
    const h = harness({});
    const put = h.runRaw('(name, value) => { globalThis[name] = value; }');
    put('__text', gunzipSync(readFileSync(new URL('../data/sex_gender_parsed.csv.gz', import.meta.url))).toString('utf8'));
    put('__meta', JSON.parse(readFileSync(new URL('../data/sex_gender_parsed_meta.json', import.meta.url), 'utf8')));
    assert.equal(h.runRaw("sgTableMatchesMeta(sgParseCsv(__text, [...SG_CSV_KEEP, 'snapshot_date']), __meta)"), true,
        'the check would refuse a good week and leave every visitor on lean rows');
});
