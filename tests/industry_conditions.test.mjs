import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const data = JSON.parse(readFileSync(new URL('../data/industry_sponsors.json', import.meta.url)));

function harness() {
    const host = { innerHTML: '' };
    const mobile = { matches: false, addEventListener() {} };
    const context = vm.createContext({
        data, URLSearchParams, location: { hash: '#industry' },
        history: { replaceState(_state, _title, hash) { context.location.hash = hash; } },
        window: { matchMedia: () => mobile, addEventListener() {} },
        document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => host },
        escapeHtml: text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
        COLORS: { race: { black_african_american: '#457b9d' }, ethnicity: { hispanic_latino: '#52b788' } }
    });
    vm.runInContext(app.slice(app.indexOf("const INDUSTRY_PINK =")), context);
    vm.runInContext(`industryData = data; industrySelected = new Set(industryTop10());
        renderIndustryConditionControls = () => {}; industrySyncHeatmapScrollNote = () => {};
        renderIndustryCatRow = () => {}; industryActive = () => true;`, context);
    return { host, mobile, run: code => vm.runInContext(code, context) };
}

test('condition defaults follow viewport size; all and custom survive resizing', () => {
    const h = harness();
    const visible = () => JSON.parse(h.run('JSON.stringify(industryVisibleConditions(industryConditions(data.trials)))'));
    const desktop = visible();
    assert.equal(desktop.length, 10);
    h.mobile.matches = true;
    assert.deepEqual(visible(), desktop.slice(0, 5));
    h.run("industryConditionMode = 'all'");
    assert.ok(visible().length > 100);
    h.run("industryConditionMode = 'custom'; industryConditionSelected = new Set(['Asthma', 'Hepatitis'])");
    const chosen = visible();
    h.mobile.matches = false;
    assert.deepEqual(visible(), chosen);
    assert.equal(chosen.length, 2);
});

test('custom selections retain unavailable categories and respect sex-specific exclusions', () => {
    const h = harness();
    h.run("industryConditionMode = 'custom'; industryConditionSelected = new Set(['Asthma', 'Breast Cancer'])");
    assert.equal(h.run('industryVisibleConditions(industryConditions(data.trials)).length'), 1);
    assert.equal(h.run('industryVisibleConditions(industryConditions([])).length'), 0);
    h.run('industrySexSpecific = true');
    assert.equal(h.run('industryVisibleConditions(industryConditions(data.trials)).length'), 2);
    assert.equal(h.run('industryConditionSelected.size'), 2);
    h.run('industryConditionSelected.clear()');
    h.run('renderIndustryHeatmap(data.trials)');
    assert.match(h.host.innerHTML, /No condition columns selected/);
});

function cells(markup) {
    const names = [...markup.matchAll(/class="industry-condition-name">([^<]+)</g)].map(m => m[1]);
    return [...markup.matchAll(/<tr><th scope="row">([^<]+)<\/th>(.*?)<\/tr>/g)].flatMap(row =>
        [...row[2].matchAll(/<td\b.*?<\/td>/g)].map((cell, i) => [`${row[1]}:${names[i]}`, cell[0]]));
}

test('limiting or choosing columns preserves every corresponding rendered cell across tiers and benchmarks', () => {
    const h = harness();
    for (const [demo, benchmark] of [['sex', 'cohort'], ['sex', 'parity'], ['race', 'cohort'], ['race', 'census'], ['ethnicity', 'census']]) {
        h.run(`industryDemo = '${demo}'; industryBenchmark = '${benchmark}'; industryConditionMode = 'all'; renderIndustryHeatmap(data.trials)`);
        const full = new Map(cells(h.host.innerHTML));
        assert.ok(full.size > 100);
        for (const mode of ['top', 'custom']) {
            h.run(`industryConditionMode = '${mode}'; industryConditionSelected = new Set(['Asthma', 'Hepatitis']); renderIndustryHeatmap(data.trials)`);
            const subset = cells(h.host.innerHTML);
            assert.ok(subset.length > 0 && subset.length < full.size);
            for (const [key, cell] of subset) assert.equal(cell, full.get(key), `${demo}/${benchmark}: ${key}`);
        }
    }
});

test('shared links round-trip custom names, all mode and deliberately empty selections', () => {
    const h = harness();
    for (const mode of ['all', 'custom']) {
        h.run(`industryConditionMode = '${mode}'; industryConditionSelected = new Set(["Alzheimer's Disease and Dementia", 'Asthma']); updateIndustryShareUrl()`);
        h.run("industryConditionMode = 'top'; industryConditionSelected.clear(); industryRouteApplied = false; applyIndustryShareParams()");
        assert.equal(h.run('industryConditionMode'), mode);
        if (mode === 'custom') assert.equal(h.run('industryConditionSelected.size'), 2);
    }
    h.run("industryConditionSelected.clear(); updateIndustryShareUrl(); industryConditionMode = 'top'; industryRouteApplied = false; applyIndustryShareParams()");
    assert.equal(h.run('industryConditionMode'), 'custom');
    assert.equal(h.run('industryConditionSelected.size'), 0);
});
