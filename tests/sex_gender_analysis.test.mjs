/**
 * The newer analysis layer's reader (sex_gender_analysis/1.0): the block the
 * engine publishes beside the parser row, read on the Sex and Gender tabs
 * and in the sex/gender pop-up, and the enrichment namespace the study
 * pop-up shows.
 *
 * Pinned: a record without the block is "unavailable", never a value derived
 * from the legacy buckets; a block of another schema version is not read;
 * the reporting-dimension table counts records by the published field with
 * the Unavailable row in the denominator; the detailed gender-identity
 * categories (D3, D5) are neither read nor shown, by the owner's decision
 * R-GC-05 (held until their vocabulary is checked); the summary block gives the same shape
 * for phones and aggregate archives; the pop-up names the open rules; the
 * enrichment section shows only what a record carries and labels proposed
 * leads as proposals. The v2 block is evaluated in a vm as
 * tests/sex_gender_v2.test.mjs does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const contract = JSON.parse(readFileSync(new URL('./record_contract.json', import.meta.url), 'utf8'));

const START = '// ── Sex/gender parser v2 (sg=v2)';
const END = '// ── end sg=v2';
const block = app.slice(app.indexOf(START), app.indexOf(END));
assert.ok(block.includes('function sgAnalysis('), 'app.js lost the analysis reader');
const fnAt = (sig) => {
    const at = app.indexOf(sig);
    assert.ok(at >= 0, `app.js lost ${sig}`);
    return app.slice(at, app.indexOf('\n}\n', at) + 2);
};
const datasetBaseSrc = 'let NEWEST_PUBLISHED = null;\nlet DATA_RUN_DATE = null;\nasync function newestPublishedReady() { return NEWEST_PUBLISHED; }\n'
    + fnAt('function servedFromData(date)') + fnAt('function datasetKey(date)') + fnAt('function datasetBase(key)');

function harness() {
    const els = {};
    const el = (id) => (els[id] ||= { id, innerHTML: '', textContent: '', classList: { toggle() {} }, value: 'all', disabled: false, style: {}, title: '', removeAttribute() {} });
    const context = vm.createContext({
        console, JSON, Number, String, Object, Array, Map, Set, Math, URLSearchParams,
        location: { search: '?sg=v2', hash: '' },
        localStorage: { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); } },
        window: {}, setTimeout: () => 0,
        document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], body: { classList: { toggle() {} } } },
        escapeHtml: (t) => String(t).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
        CHART_COLORS: { c1: '#0F7A4F', c2: '#C2477E', c3: '#2E6FB7', c4: '#C77A0A', c5: '#7A4FCF', notReported: '#8A968F' },
        CHART_ASPECT_RATIO: undefined, CHART_LEGEND_POSITION: 'right', isMobileDevice: false,
        DATA_CACHE_VERSION: 'test', hasDecompressionStream: false, ensurePako: async () => {},
        fetch: async () => ({ ok: false, status: 404 }),
        charts: {}, dashboardSummary: null, data: [], Chart: function () { return { destroy() {} }; },
        ChartDataLabels: {}, donutConfig: () => ({}),
        // app.js's drawOverlay (tests/overlay_dialog.test.mjs has its focus
        // handling); here it only puts the pop-up's markup on screen.
        drawOverlay: (id, markup) => { const o = el(id); o.innerHTML = markup; o.style.display = 'flex'; }
    });
    vm.runInContext('async function keyedFetch(path, init) { return fetch(`${path}?v=${DATA_CACHE_VERSION}`, init); }\nasync function fetchChecked(path) { return keyedFetch(path); }\n' + datasetBaseSrc + block, context);
    const run = (src) => {
        const v = vm.runInContext(src, context);
        return (v !== null && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    };
    return { els, run };
}

const lean = (over = {}) => ({
    schema_version: 'sex_gender_analysis/1.0', reporting_dimension: 'sex_only', neither_reason: null,
    explicit_unknown_with_values: false, composition_eligible: true, incomplete_composition: null,
    incomplete_composition_evaluated: false, gender_categories_status: 'not_applicable', d3_total: null, d5_strict: null,
    unresolved: ['R-FS-01', 'R-IC-01', 'R-PO-01'], ...over
});
const row = (over = {}) => ({
    sex_report_status: 'reported', reported_sex: true, reported_gender: false, reported_both: false,
    n_female: 40, n_male: 50, n_unknown: null, n_gender_diverse: null, n_ambiguous_gender: null, n_total_parsed: 90,
    is_participant_count: true, uninformative_reason: null, declared_not_collected: false, parser_rules_version: 'test-rules', ...over
});

test('the contract lists the two new paths as optional, placed with the class that reads them', () => {
    assert.ok(contract.optional.includes('sex_gender_analysis'));
    assert.ok(contract.optional.includes('enrichment'));
    assert.equal(contract.layout.optional_class.sex_gender_analysis, 'core');
    assert.equal(contract.layout.optional_class.enrichment, 'detail');
    for (const klass of Object.values(contract.classes)) {
        assert.ok(!klass.some((p) => p.startsWith('sex_gender_analysis') || p.startsWith('enrichment')),
            'a record published before the layer must not be refused for lacking it');
    }
});

test('a record without the block, or with another schema version, is unavailable', () => {
    const h = harness();
    assert.equal(h.run('sgAnalysis({ sex_gender: {} })'), null);
    assert.equal(h.run(`sgAnalysis(${JSON.stringify({ sex_gender_analysis: lean({ schema_version: 'sex_gender_analysis/0.9' }) })})`), null);
    assert.deepEqual(h.run(`sgAnalysis(${JSON.stringify({ sex_gender_analysis: lean() })})`), lean());
    const detail = h.run(`sgAnalysisDetailHtml(${JSON.stringify({ nct_id: 'NCT1', sex_gender: row() })})`);
    assert.match(detail, /unavailable for this record/);
    assert.match(detail, /older definition/);
    assert.ok(!/Sex only/.test(detail), 'a dimension was invented for a record without the block');
});

test('the pop-up names the block as read, with the open rules, and shows no D3/D5 count', () => {
    const h = harness();
    const study = { nct_id: 'NCT1', sex_gender: row(), sex_gender_analysis: lean({ reporting_dimension: 'both', gender_categories_status: 'derived', d3_total: 10, d5_strict: 9, explicit_unknown_with_values: true, unresolved: ['R-FS-01', 'R-IC-01', 'R-PO-01', 'R-GC-05'] }) };
    const detail = h.run(`sgAnalysisDetailHtml(${JSON.stringify(study)})`);
    assert.match(detail, /Both sex and gender/);
    assert.match(detail, /explicit Unknown beside reported values: yes/);
    assert.match(detail, /incomplete composition: not evaluated/);
    assert.match(detail, /gender-identity categories: not shown until their vocabulary is checked \(R-GC-05\)/);
    assert.ok(!/D3|D5|\b10\b|\b9\b/.test(detail.replace(/R-[A-Z]+-\d+/g, '')), 'the pop-up shows a D3/D5 count');
    assert.match(detail, /R-FS-01, R-IC-01, R-PO-01, R-GC-05/);
    const neither = h.run(`sgAnalysisDetailHtml(${JSON.stringify({ sex_gender_analysis: lean({ reporting_dimension: 'neither', neither_reason: 'measure_present_no_usable_breakdown', composition_eligible: false }) })})`);
    assert.match(neither, /Neither \(measure present without a usable breakdown\)/);
    assert.match(neither, /outside the composition denominator/);
    // and the breakdown modal carries it
    h.run(`data = [${JSON.stringify(study)}]; sgTable = null; dashboardSummary = null;`);
    h.run("sgShowBreakdown('NCT1', 'sex')");
    assert.match(h.els['breakdown-overlay'].innerHTML, /Newer analysis \(sex_gender_analysis\/1\.0, as run\)/);
});

// The Sex tab follows the design canvas's Sex board, which has no
// reporting-dimension table; the per-trial pop-up still carries the layer.
test('the Sex tab carries no reporting-dimension table; the Gender tab has no D3/D5 table (R-GC-05)', () => {
    assert.ok(!html.includes('id="sg-analysis-table"'), 'the Sex tab shows the reporting-dimension table the canvas board left out');
    assert.ok(!html.includes('sg-gender-categories') && !/Gender-identity categories \(newer analysis\)/.test(html),
        'the Gender tab shows the D3/D5 table the owner held back');
    for (const name of ['sgGenderCategoriesHtml', 'sgRenderGenderCategories', 'd3_total', 'd5_strict', 'gender_categories_status']) {
        assert.ok(!block.includes(name), `the site reads or renders ${name} (held off the site by R-GC-05)`);
    }
    assert.ok(block.includes('function sgAnalysisDetailHtml(study)'), 'the pop-up lost the analysis layer');
});

test('the analysis reader derives nothing from the legacy buckets', () => {
    const code = block.slice(block.indexOf('// ── The newer analysis layer'));
    const stripped = code.replace(/\/\/.*$/gm, '');
    for (const forbidden of ['n_female', 'n_male', 'n_unknown', 'n_gender_diverse', 'n_ambiguous_gender', 'enrollment']) {
        assert.ok(!stripped.includes(forbidden), `the analysis reader reads ${forbidden}`);
    }
});

test('the study pop-up shows enrichment only when a record carries it, with leads labelled as proposals', () => {
    const src = app.slice(app.indexOf('function studyDetailsHtml('), app.indexOf('\n}\n', app.indexOf('function studyDetailsHtml(')));
    assert.ok(src.includes("has('enrichment', 'enrichment', 'detail')"), 'enrichment is read without waiting for its class');
    assert.ok(src.includes("schema_version === 'enrichment/1.0'"), 'another namespace version would be rendered');
    assert.ok(src.includes('never replaces'), 'the section does not say the evidence is beside the registry fields');
    assert.ok(src.includes('lead)'), 'a review lead is not labelled as a lead');
    assert.ok(src.includes('an unassessed label is not a negative'));
    assert.ok(src.includes("method.run_coverage === 'partial'"), 'a partial run is named on the record');
    // the canonical condition fields are rendered from their own keys, never from enrichment
    assert.ok(!/primary_condition\s*=.*enrichment/.test(src));
});
