/**
 * Acceptance tests for the geography-tab contract layer — the ten tests from
 * the implementation handoff (§10), run against the staged run directory
 * pinned in data/geo/active_run.json.
 *
 * These use d3-dsv's csvParse — the same parser (d3-dsv) the browser build
 * uses via the lazy-loaded d3 bundle — so the tests exercise the identical
 * parse semantics the app ships with.
 *
 * On test 3's wording: the run's own gate_reason strings quote the support
 * arithmetic ("support 0.215 < floor 0.25 ..."), so a blanket "no numeral in
 * rendered output" is unsatisfiable on correct output. The handoff's precise
 * form is asserted instead: a withheld rendering IS the gate_reason verbatim,
 * carries no value under any key, introduces no digits beyond gate_reason's
 * own, and contains no formatted value of any other estimand for that
 * geography.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { csvParse } from 'd3-dsv';

const require = createRequire(import.meta.url);
const { createGeoReader } = require('../geo/geo_reader.js');
const { createGeoRender } = require('../geo/geo_render.js');

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const activeRun = JSON.parse(readFileSync(join(repo, 'data/geo/active_run.json'), 'utf8'));
const runDir = join(repo, activeRun.run_dir);
const load = (f) => csvParse(readFileSync(join(runDir, f), 'utf8'));

const tables = {
  long: load(activeRun.long_table),
  vocabulary: load('d2_display_rule_vocabulary.csv'),
  viewDefs: load('b1_view_definitions.csv'),
  columnDict: load('column_dictionary.csv'),
};
const geoDict = load('geo_dictionary.csv');
const blankInventory = load('d3_blank_inventory.csv');
const unitDrivers = load('g1_unit_drivers.csv');

const reader = createGeoReader(tables);
const render = createGeoRender({ reader, geoDict, blankInventory, unitDrivers });

const distinctGeos = (rows) => new Set(rows.map((r) => r.geo_code)).size;

// ---------------------------------------------------------------------------
test('1. the four views return 68/13/78/12 rows and 34/13/39/12 geographies', () => {
  const v = reader.views();
  assert.equal(v.country_descriptive.length, 68);
  assert.equal(distinctGeos(v.country_descriptive), 34);
  assert.equal(v.country_adjusted.length, 13);
  assert.equal(distinctGeos(v.country_adjusted), 13);
  assert.equal(v.state_descriptive.length, 78);
  assert.equal(distinctGeos(v.state_descriptive), 39);
  assert.equal(v.state_adjusted.length, 12);
  assert.equal(distinctGeos(v.state_adjusted), 12);
});

// ---------------------------------------------------------------------------
test('2. the rendered adjusted country panel contains 13 geographies, not 34', () => {
  const panel = render.adjustedPanelModel('country');
  assert.equal(panel.shown.length, 13);
  assert.equal(panel.shownGeographies, 13);
  // and the withheld companion list is reasons only — the other 21 countries
  assert.equal(panel.withheld.length, 34 - 13);
  const statePanel = render.adjustedPanelModel('us_state');
  assert.equal(statePanel.shownGeographies, 12);
  assert.equal(statePanel.withheld.length, 39 - 12);
});

// ---------------------------------------------------------------------------
test('3. a withheld row renders gate_reason and no value from any estimand', () => {
  const withheldRows = reader
    .readGeo({ metric: 'female_share_pct', includeGateFailures: false })
    .filter((r) => r.display_rule === 'withheld');
  assert.ok(withheldRows.length > 0, 'expected withheld rows in the run');

  for (const r of withheldRows) {
    const cell = render.valueCell(r);
    assert.equal(cell.kind, 'withheld');
    assert.ok(!('value' in cell), 'withheld cell must carry no value key');
    assert.equal(cell.text, r.gate_reason, 'withheld renders gate_reason verbatim');

    // rendering introduces no digits beyond gate_reason's own
    const own = (r.gate_reason.match(/\d/g) || []).length;
    const rendered = (cell.text.match(/\d/g) || []).length;
    assert.equal(rendered, own);

    // and contains no formatted value of another estimand for this geography
    const siblings = reader
      .readGeo({ geoLevel: r.geo_level, metric: 'female_share_pct' })
      .filter((s) => s.geo_code === r.geo_code && s.value !== null);
    for (const s of siblings) {
      assert.ok(!cell.text.includes(s.value.toFixed(1)),
        `withheld text for ${r.geo_code} leaks ${s.estimand} value ${s.value}`);
    }
  }
});

// ---------------------------------------------------------------------------
test('4. no ranking contains a withheld or omit_from_ranking row', () => {
  for (const [viewName, est] of [
    ['country_descriptive', 'pw_raw'], ['country_descriptive', 'tw_median'],
    ['state_descriptive', 'pw_raw'], ['state_descriptive', 'tw_median'],
  ]) {
    const m = render.rankedListModel(viewName, est);
    for (const item of m.items) {
      assert.ok(['show', 'badge_concentration'].includes(item.display_rule),
        `${viewName}/${est} ranked ${item.geo_code} with rule ${item.display_rule}`);
    }
    // the on-request rows are counted and named, not silently dropped
    assert.equal(m.items.length + m.onRequestCount, m.totalGeographies);
  }
  // rankable() itself, on rows that include withheld and omit rows
  const all = reader.readGeo({ metric: 'female_share_pct' });
  const ranked = reader.rankable(all);
  assert.ok(ranked.every((r) => r.display_rule === 'show' || r.display_rule === 'badge_concentration'));
});

// ---------------------------------------------------------------------------
test('5. an unrecognised display_rule raises and does not render a default', () => {
  // reader level: a tampered long table throws on read
  const tampered = tables.long.map((r, i) => (i === 0 ? { ...r, display_rule: 'shw' } : r));
  const badReader = createGeoReader({ ...tables, long: tampered });
  assert.throws(() => badReader.readGeo({}), /not in the published vocabulary: shw/);

  // render level: an unknown rule on a row throws, never a default cell
  assert.throws(
    () => render.valueCell({ display_rule: 'display_normally', value: 50, gate_reason: '' }),
    /unrecognised display_rule/
  );
});

// ---------------------------------------------------------------------------
test('6. every geo_code in the long table resolves in geo_dictionary; inner join loses zero rows', () => {
  const dictKeys = new Set(geoDict.map((r) => `${r.geo_level}|${r.geo_code}`));
  const rows = reader.readGeo({});
  const matched = rows.filter((r) => dictKeys.has(`${r.geo_level}|${r.geo_code}`));
  assert.equal(matched.length, rows.length);
  assert.equal(rows.length, 823);
});

// ---------------------------------------------------------------------------
test('7. Hong Kong appears in every table and on no map (has_polygon = FALSE)', () => {
  const hkDict = geoDict.find((r) => r.geo_name === 'Hong Kong');
  assert.equal(hkDict.has_polygon, 'FALSE');

  // in every table it belongs to: the long table and the country descriptive view
  assert.ok(reader.readGeo({ geoLevel: 'country' }).some((r) => r.geo_code === 'HKG'));
  assert.ok(reader.geoView('country_descriptive').some((r) => r.geo_code === 'HKG'));

  // on no map: the only map model is us_state, and the polygon gate would
  // exclude HKG even from a hypothetical country map
  const map = render.mapModel('pw_raw');
  const mapped = Object.values(map.units).map((u) => u.geo_code);
  assert.ok(!mapped.includes('HKG'));
  for (const key of Object.keys(map.units)) {
    const d = geoDict.find((r) => r.polygon_key === key && r.geo_level === 'us_state');
    assert.equal(d.has_polygon, 'TRUE', `map attached data to non-polygon unit ${key}`);
  }
});

// ---------------------------------------------------------------------------
test('8. no screen mixes geo_levels on one axis', () => {
  // every shipped model declares exactly one geo_level
  for (const m of [
    render.rankedListModel('country_descriptive', 'pw_raw'),
    render.rankedListModel('state_descriptive', 'pw_raw'),
    render.adjustedPanelModel('country'),
    render.adjustedPanelModel('us_state'),
    render.mapModel('pw_raw'),
  ]) {
    assert.ok(['country', 'us_state'].includes(m.axis.geo_level));
  }
  // and the guard itself refuses mixed input
  const mixed = reader.readGeo({ metric: 'female_share_pct', estimand: 'pw_raw' });
  assert.throws(() => render.assertHomogeneous(mixed, 'test'), /mixing geo_levels/);
});

// ---------------------------------------------------------------------------
test('9. no screen mixes tiers on one axis', () => {
  const tier1 = reader.readGeo({ geoLevel: 'country', metric: 'female_share_pct', estimand: 'pw_raw' });
  const tier3 = reader.readGeo({ geoLevel: 'country', metric: 'portfolio_female_share_pct' });
  assert.ok(tier3.length > 0);
  assert.throws(() => render.assertHomogeneous(tier1.concat(tier3), 'test'), /mixing tiers/);

  // the detail card keeps tier 3 in a separate block flagged for its own axis
  const withTier3 = tier3[0].geo_code;
  const card = render.detailCardModel('country', withTier3);
  assert.ok(card.tier3 && card.tier3.separateAxis === true && card.tier3.tier === '3');
});

// ---------------------------------------------------------------------------
test('10. blanks render their documented meaning, never zero', () => {
  // parse layer: blanks in numeric columns are null, not 0
  const rows = reader.readGeo({});
  const blankValueRows = rows.filter((r) => r.value === null);
  assert.equal(blankValueRows.length, 196);            // d3_blank_inventory: value n_blank = 196
  assert.ok(rows.every((r) => r.lo === null || typeof r.lo === 'number'));

  // a gate-failed geography renders the documented meaning for its missing counts
  const failed = rows.find((r) => r.metric === 'no_value_gate_failed');
  const card = render.detailCardModel(failed.geo_level, failed.geo_code);
  assert.match(card.nTrials.text, /failed the gate/);
  assert.ok(!/^0$/.test(card.nTrials.text));

  // interval blanks in the adjusted panel render the documented meaning
  // (only std_gcomp carries an interval), and never the string "0"
  const meaning = render.blankMeaning('lo');
  assert.match(meaning, /no interval/);

  // three-state flag columns survive as strings — 'false' vs 'not_applicable'
  // must remain distinguishable
  const flags = new Set(rows.map((r) => r.concentration_flag));
  assert.ok(flags.has('true') && flags.has('false') && flags.has('not_applicable'));

  // undocumented blank columns are loud
  assert.throws(() => render.blankMeaning('geo_name'), /does not document/);
});

// ---------------------------------------------------------------------------
// Port-fidelity checks beyond the ten: the R reader's exact filter semantics.
test('port fidelity: gate filter and withheld filter match geo_reader.R', () => {
  // include_gate_failures = FALSE keeps only gate_status == "pass" — which
  // also drops tier 3 rows (gate_status "n/a (tier 3 applies no gate)")
  const passOnly = reader.readGeo({ includeGateFailures: false });
  assert.ok(passOnly.every((r) => r.gate_status === 'pass'));
  assert.equal(passOnly.length, 584);

  // include_withheld = FALSE drops exactly the 96 withheld rows
  const noWithheld = reader.readGeo({ includeWithheld: false });
  assert.equal(823 - noWithheld.length, 96);

  // unknown view name throws with the known names, like geo_view()
  assert.throws(() => reader.geoView('countr_adjusted'), /unknown view: countr_adjusted. Known: country_descriptive/);

  // every returned row carries ui_meaning from the vocabulary join
  assert.ok(reader.readGeo({}).every((r) => typeof r.ui_meaning === 'string' && r.ui_meaning.length > 0));
});

// ---------------------------------------------------------------------------
// Where omit_from_ranking actually lives in run063 — tier-3 portfolio rows and
// gate-failed registry rows — and the by-name-only contract around it. If a
// future run puts omit rows on the descriptive views, the map's on_request
// path (uncolored until clicked) picks them up; assert both directions.
test('omit_from_ranking: never ranked, values render only in by-name contexts', () => {
  const omitRows = reader.readGeo({}).filter((r) => r.display_rule === 'omit_from_ranking');
  assert.ok(omitRows.length > 0);
  for (const r of omitRows) {
    assert.ok(['portfolio_female_share_pct', 'no_value_gate_failed'].includes(r.metric),
      `unexpected omit_from_ranking on ${r.metric} — revisit the map's on_request handling`);
  }

  // rankable() excludes every one of them
  assert.equal(reader.rankable(omitRows).length, 0);

  // any on_request unit the map ever carries must be uncolored
  const map = render.mapModel('pw_raw');
  for (const u of Object.values(map.units)) {
    if (u.status === 'on_request') {
      assert.equal(u.value, null);
      assert.equal(u.text, null);
    }
  }

  // the detail card is the by-name context: a gate-failed geography renders
  // its reason, no tier-1 composition, and its tier-3 block on its own axis
  const gateFailGeo = omitRows.find((r) => r.metric === 'no_value_gate_failed' && r.geo_level === 'country');
  const card = render.detailCardModel('country', gateFailGeo.geo_code);
  assert.ok(card.gateFail && /trials on the spine|gate/i.test(card.gateFail.reason));
  assert.equal(card.composition.length, 0);
  if (card.tier3) {
    assert.equal(card.tier3.separateAxis, true);
    assert.match(card.tier3.text, /%/);   // a by-name context may show the tier-3 value
  }
});
