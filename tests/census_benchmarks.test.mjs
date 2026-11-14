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
  // the denominator for "contextual" must be published; the pane does not add one up
  assert.match(C.dataProblem(run, { ...summary, reference_population_assessed: undefined }, null), /assessed-trials count/);
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
  const html = C.tableHTML(rows, state({ category: 'white' }), fx('run.json'));
  assert.match(html, /Fictional Falls, ZZ Metro Area/);
  assert.match(html, /−6\.0/); assert.match(html, /\[−7\.9, −4\.1\]/);
  assert.match(html, /Open: unknowns could reverse it/);
  assert.match(html, /unknown included, so each share is a floor/);
  assert.match(html, /1 area withheld/); assert.match(html, /never filled from a wider level/);
  assert.doesNotMatch(html, /Sampleton[^<]*<\/button>/, 'a withheld area is listed, not offered as a row with figures');
  const b = C.tableHTML(rows, state({ category: 'white', denominator: 'classified' }), fx('run.json'));
  assert.match(b, /Not a correction for missing data/); assert.doesNotMatch(b, /\[−7\.9/);
});

test('an open area shows every category, both denominators, the bound and an undefined ratio', () => {
  const rows = C.areaRows(fx('areas.race.json'), 'cbsa', 'with_referral_zips', '');
  const html = C.tableHTML(rows, state({ open: '99991' }), fx('run.json'));
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
  assert.match(head, /400 of 1,000/); assert.match(head, /Of the 400 whose eligibility could be read, 340 are marked/);
  const controls = C.controlsHTML(state(), fx('run.json'));
  assert.match(controls, /Metro area \(default\)/); assert.match(controls, /No level is the answer/);
  assert.doesNotMatch(head + controls, /underrepresent/i);
  const methods = C.methodsHTML(fx('run.json'), fx('summary.json'));
  assert.match(methods, /A fictional limitation/); assert.match(methods, /do not show that a site-area benchmark/);
});

test('area names are escaped', () => {
  const areas = fx('areas.race.json'); areas.areas[0].name = '<img src=x onerror=1>';
  const html = C.tableHTML(C.areaRows(areas, 'cbsa', 'with_referral_zips', ''), state(), fx('run.json'));
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
});

test('index.html loads the module keyed and before app.js, and app.js opens it from the geography switch', () => {
  const html = read('index.html'), app = read('app.js');
  const mod = html.indexOf('src="census_benchmarks.js?v=');
  assert.ok(mod > 0 && mod < html.indexOf('src="app.js?v='), 'census_benchmarks.js must load, keyed, before app.js');
  assert.match(html, /id="geography-pane-switch"/); assert.match(html, /id="geography-census-pane"[^>]*hidden/);
  assert.match(app, /function setGeographyPane\(/); assert.match(app, /CensusBenchmarks\.open\(census/);
  // every other direct child of the tab belongs to the registry pane and is hidden with it, notes included
  assert.match(read('styles.css'), /#geography\.census-open > :not\(#geography-pane-switch\):not\(#geography-census-pane\) \{ display: none; \}/);
  const section = html.slice(html.indexOf('<section id="geography"'), html.indexOf('</section>', html.indexOf('<section id="geography"')));
  assert.match(section, /class="note geo-spine-note"/); assert.match(section, /id="geo-run-pin"/);
});

test('a file that arrives after the reader chose another characteristic does not paint over it', async () => {
  const run = fx('run.json'), summary = fx('summary.json'), race = fx('areas.race.json');
  const sex = { ...clone(race), dimension: 'sex' };
  sex.areas = sex.areas.map((a) => (a.categories ? { ...a, categories: [{ ...a.categories[0], category: 'female' }] } : a));
  const waiting = {};
  const fetchJSON = (path) => {
    if (path.endsWith('run.json')) return Promise.resolve(run);
    if (path.endsWith('summary.json')) return Promise.resolve(summary);
    return new Promise((resolve) => { waiting[path] = resolve; });      // area files resolve when the test says
  };
  const el = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], contains: () => true };
  const opening = C.open(el, { fetchJSON });
  await new Promise((r) => setTimeout(r, 0));
  const press = (key, value) => el.onclick({ target: { closest: () => ({ dataset: { [key]: value } }) } });
  press('cbDimension', 'sex');                                           // chosen while race is still loading
  await new Promise((r) => setTimeout(r, 0));
  waiting['data/census/areas.sex.json'](sex);
  await new Promise((r) => setTimeout(r, 0));
  assert.match(el.innerHTML, /<option value="female" selected>/);
  waiting['data/census/areas.race.json'](race);                          // the stale file arrives last
  await opening; await new Promise((r) => setTimeout(r, 0));
  assert.match(el.innerHTML, /<option value="female" selected>/, 'the late race file must not replace the sex view');
  assert.doesNotMatch(el.innerHTML, /value="black_african_american"/);
});

test('the manifest is read past the cache, and a file from an earlier build is read once more', async () => {
  const run = fx('run.json'), summary = fx('summary.json'), race = fx('areas.race.json');
  const calls = [];
  const fetchJSON = (path, reload) => {
    calls.push([path.replace('data/census/', ''), Boolean(reload)]);
    if (path.endsWith('run.json')) return Promise.resolve(run);
    if (path.endsWith('summary.json')) return Promise.resolve(summary);
    return Promise.resolve(reload ? race : { ...clone(race), run_id: 'census-an-earlier-build' });   // the cache holds an old file
  };
  const el = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], contains: () => true };
  const fresh = { globalThis: {} };                       // its own module, so no area file is already held
  vm.runInNewContext(read('census_benchmarks.js'), fresh);
  await fresh.globalThis.CensusBenchmarks.open(el, { fetchJSON });
  assert.deepEqual(calls, [['run.json', true], ['summary.json', false], ['areas.race.json', false], ['areas.race.json', true]]);
  assert.match(el.innerHTML, /cb-table|<table/);
  assert.doesNotMatch(el.innerHTML, /could not be read/);
});

test('choosing a control leaves focus on that control after the redraw', async () => {
  const run = fx('run.json'), summary = fx('summary.json'), race = fx('areas.race.json');
  const fetchJSON = (path) => Promise.resolve(path.endsWith('run.json') ? run : path.endsWith('summary.json') ? summary : race);
  const focused = [];
  const button = (dataset) => ({ dataset, focus: () => focused.push(dataset) });
  const buttons = [button({ cbLevel: 'county' }), button({ cbLevel: 'cbsa' }), button({ cbDenominator: 'classified' })];
  const el = { innerHTML: '', querySelector: () => null, querySelectorAll: () => buttons, contains: () => true };
  await C.open(el, { fetchJSON });
  assert.deepEqual(focused, [], 'opening the pane does not move focus');
  el.onclick({ target: { closest: () => ({ dataset: { cbLevel: 'county' } }) } });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(focused, [{ cbLevel: 'county' }]);
});

test('the thresholds stated in words are the build\'s own, and a manifest without them is refused', () => {
  const run = clone(fx('run.json'));
  run.parameters.floor_trials_per_area = 30; run.parameters.geography_spread_flag_pp = 7; run.margin_of_error_level = 0.95;
  const rows = C.areaRows(fx('areas.race.json'), 'cbsa', 'with_referral_zips', '');
  assert.ok(rows.withheld.length > 0, 'the fixture has a withheld area');
  const html = C.tableHTML(rows, state({ open: rows.shown[0].geoid }), run);
  assert.match(html, /at least 30 qualifying trials/);
  assert.match(html, /moves by 7 points or more/);
  assert.match(html, /±95% margin/);
  assert.doesNotMatch(html, /at least 50 qualifying|by 10 points|±90% margin/);
  const bare = clone(fx('run.json')); delete bare.parameters;
  assert.match(C.dataProblem(bare, fx('summary.json'), null), /lacks the thresholds/);
});

test('area files held from an earlier build are dropped when the manifest names a new one', async () => {
  const fresh = { globalThis: {} };
  vm.runInNewContext(read('census_benchmarks.js'), fresh);
  const F = fresh.globalThis.CensusBenchmarks;
  const serve = (id, calls) => (path) => {
    calls.push(path.replace('data/census/', ''));
    const f = path.endsWith('run.json') ? fx('run.json') : path.endsWith('summary.json') ? fx('summary.json') : fx('areas.race.json');
    return Promise.resolve({ ...clone(f), run_id: id });
  };
  const el = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], contains: () => true };
  const first = [], second = [], third = [];
  await F.open(el, { fetchJSON: serve('census-build-a', first) });
  await F.open(el, { fetchJSON: serve('census-build-b', second) });        // a new build was published in between
  assert.ok(second.includes('areas.race.json'), 'the area file is fetched again for the new build');
  assert.doesNotMatch(el.innerHTML, /could not be read/);
  await F.open(el, { fetchJSON: serve('census-build-b', third) });        // same build: the held file is reused
  assert.ok(!third.includes('areas.race.json'));
});

test('closing an open area with its own button returns focus to that button', async () => {
  const fresh = { globalThis: {} };
  vm.runInNewContext(read('census_benchmarks.js'), fresh);
  const fetchJSON = (path) => Promise.resolve(path.endsWith('run.json') ? fx('run.json') : path.endsWith('summary.json') ? fx('summary.json') : fx('areas.race.json'));
  const focused = [];
  const areaButton = { dataset: { cbArea: '99991' }, focus: () => focused.push('button') };
  const el = { innerHTML: '', querySelector: (sel) => (sel === '#cb-detail-99991' ? { focus: () => focused.push('detail') } : null),
    querySelectorAll: () => [areaButton], contains: () => true };
  await fresh.globalThis.CensusBenchmarks.open(el, { fetchJSON });
  const press = () => el.onclick({ target: { closest: () => areaButton } });
  press(); await new Promise((r) => setTimeout(r, 0));
  press(); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(focused, ['detail', 'button']);
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
