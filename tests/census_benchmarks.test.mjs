/**
 * Geography tab, Site-area benchmarks pane (census_benchmarks.js).
 *
 * Runs the module's pure functions in a vm against a fictional family in the engine's site
 * schema (tests/fixtures/census/, see SOURCE.json there): the consumer-side contract, row
 * selection, the two denominators, withheld areas, and the wording that says what the
 * comparison is. Also checks the wiring in index.html and app.js, and the published data when
 * it is present. It does not render in a browser; the served-page check is separate (verify.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const at = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(at(p), 'utf8');
const ctx = { globalThis: {} };
vm.runInNewContext(read('census_benchmarks.js'), ctx);
const C = ctx.globalThis.CensusBenchmarks;
const fx = (f) => JSON.parse(read(`tests/fixtures/census/${f}`));
const clone = (o) => JSON.parse(JSON.stringify(o));
const state = (over = {}) => ({ dimension: 'race', level: 'cbsa', variant: 'with_referral_zips', denominator: 'all',
  category: 'black_african_american', categories: ['black_african_american', 'white', 'asian'], query: '', open: null, ...over });

test('the fixture family passes the consumer contract', () => {
  assert.equal(C.dataProblem(fx('run.json'), fx('summary.json'), fx('areas.race.json')), null);
});

test('the contract refuses mixed builds, unknown levels and a withheld area that carries figures', () => {
  const run = fx('run.json'), summary = fx('summary.json'), areas = fx('areas.race.json');
  assert.match(C.dataProblem(run, { ...summary, run_id: 'census-other' }, null), /different build/);
  assert.match(C.dataProblem(run, summary, { ...areas, run_id: 'census-other' }), /different build/);
  let a = clone(areas); a.areas[0].level = 'tract';
  assert.match(C.dataProblem(run, summary, a), /level or variant/);
  a = clone(areas); a.areas[1].categories = [];
  assert.match(C.dataProblem(run, summary, a), /withheld area carries figures/);
  a = clone(areas); a.areas[0].display_rule = 'badge';
  assert.match(C.dataProblem(run, summary, a), /display rule/);
  assert.match(C.dataProblem({ ...run, limitations: undefined }, summary, null), /limitations/);
});

test('rows are the published areas for one level and variant, withheld kept apart', () => {
  const areas = fx('areas.race.json');
  const rows = C.areaRows(areas, 'cbsa', 'with_referral_zips', '');
  assert.deepEqual(rows.shown.map((a) => a.geoid), ['99991']);
  assert.deepEqual(rows.withheld.map((a) => a.geoid), ['99992']);
  assert.equal(C.areaRows(areas, 'cbsa', 'without_referral_zips', '').shown[0].n_trials, 52);
  assert.equal(C.areaRows(areas, 'county', 'with_referral_zips', 'example').shown.length, 1);
  assert.equal(C.areaRows(areas, 'county', 'with_referral_zips', 'nowhere').shown.length, 0);
});

test('the two denominators show different published values and neither is computed here', () => {
  const area = fx('areas.race.json').areas[0];
  const all = C.cell(area, 'white', 'all'), known = C.cell(area, 'white', 'classified');
  assert.equal(all.observed, 60.0); assert.equal(all.diff, -6.0); assert.equal(all.lo, -7.9);
  assert.equal(known.observed, 65.2); assert.equal(known.diff, -0.8);
  assert.equal(known.lo, null, 'no interval is published for the classified view, so none is shown');
  assert.equal(all.settled, false);
  const noB = clone(area); delete noB.categories[0].of_classified;
  assert.equal(C.cell(noB, 'black_african_american', 'classified').unavailable, true);
  assert.equal(C.cell(area, 'not_a_category', 'all'), null);
});

test('the table states the difference, its interval, the unknown share and an open direction', () => {
  const rows = C.areaRows(fx('areas.race.json'), 'cbsa', 'with_referral_zips', '');
  const html = C.tableHTML(rows, state({ category: 'white' }));
  assert.match(html, /Fictional Falls, ZZ Metro Area/);
  assert.match(html, /−6\.0/); assert.match(html, /\[−7\.9, −4\.1\]/);
  assert.match(html, /Open: unknowns could reverse it/);
  assert.match(html, /unknown included, so each share is a floor/);
  assert.match(html, /1 area withheld/); assert.match(html, /never filled from a wider level/);
  assert.doesNotMatch(html, /Sampleton[^<]*<\/button>/, 'a withheld area is listed, not offered as a row with figures');
  const b = C.tableHTML(rows, state({ category: 'white', denominator: 'classified' }));
  assert.match(b, /Not a correction for missing data/); assert.doesNotMatch(b, /\[−7\.9/);
});

test('an open area shows every category, both denominators, the bound and an undefined ratio', () => {
  const rows = C.areaRows(fx('areas.race.json'), 'cbsa', 'with_referral_zips', '');
  const html = C.tableHTML(rows, state({ open: '99991' }));
  assert.match(html, /aria-expanded="true"/);
  for (const label of ['Black or African American', 'White', 'Asian']) assert.match(html, new RegExp(label));
  assert.match(html, /If every unknown/); assert.match(html, /Participants, of reported/);
  assert.match(html, /undefined/, 'a ratio against a zero reference share is undefined, not infinite');
  assert.match(html, /not a trend/);
});

test('the pane says what the comparison is before any number, and labels the default level', () => {
  const head = C.headHTML(fx('run.json'), fx('summary.json'));
  assert.match(head, /proxy for a\s+potential recruitment population/);
  assert.match(head, /not where participants live/); assert.match(head, /contextual/);
  assert.match(head, /400 of 1,000/); assert.match(head, /340 of 400/);
  const controls = C.controlsHTML(state(), fx('run.json'));
  assert.match(controls, /Metro area \(default\)/); assert.match(controls, /No level is the answer/);
  assert.doesNotMatch(head + controls, /underrepresent/i);
  const methods = C.methodsHTML(fx('run.json'), fx('summary.json'));
  assert.match(methods, /A fictional limitation/); assert.match(methods, /do not show that a site-area benchmark/);
});

test('area names are escaped', () => {
  const areas = fx('areas.race.json'); areas.areas[0].name = '<img src=x onerror=1>';
  const html = C.tableHTML(C.areaRows(areas, 'cbsa', 'with_referral_zips', ''), state());
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
});

test('index.html loads the module keyed and before app.js, and app.js opens it from the geography switch', () => {
  const html = read('index.html'), app = read('app.js');
  const mod = html.indexOf('src="census_benchmarks.js?v=');
  assert.ok(mod > 0 && mod < html.indexOf('src="app.js?v='), 'census_benchmarks.js must load, keyed, before app.js');
  assert.match(html, /id="geography-pane-switch"/); assert.match(html, /id="geography-census-pane"[^>]*hidden/);
  assert.match(app, /function setGeographyPane\(/); assert.match(app, /CensusBenchmarks\.open\(census/);
  assert.match(read('styles.css'), /#geography\.census-open > \.chart-row \{ display: none; \}/);
});

const published = existsSync(at('data/census/run.json'));
test('the published family is one build whose files match its manifest', { skip: !published && 'data/census/ is not published' }, () => {
  const run = JSON.parse(read('data/census/run.json')), summary = JSON.parse(read('data/census/summary.json'));
  assert.equal(C.dataProblem(run, summary, null), null);
  for (const [name, digest] of Object.entries(run.files)) {
    assert.equal(createHash('sha256').update(readFileSync(at(`data/census/${name}`))).digest('hex'), digest, `${name} differs from run.json`);
  }
  for (const dim of ['race', 'ethnicity', 'sex']) {
    const areas = JSON.parse(read(`data/census/areas.${dim}.json`));
    assert.equal(C.dataProblem(run, summary, areas), null, dim);
    for (const a of areas.areas) {
      if (a.display_rule === 'withheld') assert.ok(a.n_trials < run.parameters.floor_trials_per_area, `${a.geoid} is withheld above the floor`);
      else assert.ok(a.n_trials >= run.parameters.floor_trials_per_area, `${a.geoid} is shown below the floor`);
    }
  }
  assert.doesNotMatch(JSON.stringify(run), /key=(?!REDACTED)/, 'no API key may reach a published file');
});
