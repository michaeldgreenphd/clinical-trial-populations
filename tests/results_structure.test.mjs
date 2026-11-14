/**
 * Industry tab, Trial outcomes pane: posted results structure and subgroup reporting
 * (industry_outcomes.js reading data/results_structure/).
 *
 * Runs the module's pure functions in a vm against the fictional family copied from the engine
 * (tests/fixtures/results_structure/, see SOURCE.json there) and the fictional outcomes family
 * beside it. Covers: the five labels, a trial or a whole family that is absent or fails its check
 * reading "Not yet processed" and never "none detected", the three statuses kept apart, signals
 * labelled as awaiting review, usable-content flags with reasons, the methods wording, and that
 * every number in the summary block is one summary.json published. Also checks the published
 * data/results_structure/ when it is present. It does not render in a browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const json = (p) => JSON.parse(read(p));
const ctx = { globalThis: {} };
vm.runInNewContext(read('industry_outcomes.js'), ctx);
const O = ctx.globalThis.IndustryOutcomes;
const clone = (o) => JSON.parse(JSON.stringify(o));

const FIX = 'tests/fixtures/results_structure/';
const files = () => ({ run: json(`${FIX}run.json`), summary: json(`${FIX}summary.json`), records: json(`${FIX}records.json`) });
function structure() {
  const f = files();
  assert.equal(O.structureProblem(f.run, f.summary, f.records), null);
  return { ok: true, run: f.run, summary: f.summary, records: f.records.records };
}
function outcomes() {
  const base = 'tests/fixtures/outcomes/evidence_only/';
  const shards = {};
  for (const name of readdirSync(new URL(`${base}records/`, root))) shards[`records/${name}`] = json(`${base}records/${name}`);
  return { run: json(`${base}run.json`), index: json(`${base}index.json`), shards };
}
const NONE = 'No explicit subgroup results detected in reviewed structured fields';
const cellOf = (html, nct) => {
  const row = html.slice(html.indexOf(`data-row="${nct}"`));
  const cell = row.slice(row.indexOf('<td data-label="Subgroup results">'), row.indexOf('<td data-label="Assessment">'));
  assert.ok(cell.length > 0, `no subgroup cell for ${nct}`);
  return cell;
};

test('the five values map to the five exact labels', () => {
  assert.deepEqual(clone(O.SUBGROUP_LABELS), {
    not_yet_processed: 'Not yet processed',
    processing_failed_or_indeterminate: 'Processing failed or indeterminate',
    no_explicit_subgroup_results_detected_in_reviewed_structured_fields: NONE,
    explicit_subgroup_results_detected: 'Explicit subgroup results detected',
    not_applicable_no_posted_results: 'No posted results',
  });
  assert.deepEqual(clone(O.RS_DIMENSIONS), ['age', 'sex', 'race', 'ethnicity']);
  const s = structure();
  // The fixture's own vocabulary is the one the page knows, in run.json and in every record.
  assert.deepEqual([...s.run.subgroup_states].sort(), [...O.SUBGROUP_STATES].sort());
});

test('each fixture trial shows its published state per dimension', () => {
  const s = structure();
  assert.deepEqual(clone(O.subgroupStates(s, 'NCT99000001')), {
    age: 'no_explicit_subgroup_results_detected_in_reviewed_structured_fields', sex: 'explicit_subgroup_results_detected',
    race: 'no_explicit_subgroup_results_detected_in_reviewed_structured_fields',
    ethnicity: 'no_explicit_subgroup_results_detected_in_reviewed_structured_fields' });
  const { run, index } = outcomes();
  const html = O.listHTML(index.rows, run, 100, s);
  assert.match(html, /<th scope="col">Subgroup results<\/th>/);
  const one = cellOf(html, 'NCT99000001');
  assert.match(one, /<span class="oc-sg-dim">Sex<\/span> <span class="oc-sg [^"]*">Explicit subgroup results detected</);
  assert.match(one, new RegExp(`<span class="oc-sg-dim">Race</span> <span class="oc-sg [^"]*">${NONE}<`));
  assert.match(cellOf(html, 'NCT99000002'), />No posted results<\/span><div class="oc-sub">age, sex, race and ethnicity</);
  assert.match(cellOf(html, 'NCT99000007'), />Processing failed or indeterminate<\/span>/);
  // NCT99000003: requested, not retrieved. NCT99000008: not in the family at all.
  for (const nct of ['NCT99000003', 'NCT99000008']) {
    assert.match(cellOf(html, nct), />Not yet processed<\/span>/, nct);
    assert.doesNotMatch(cellOf(html, nct), /No explicit|No posted results/, nct);
  }
});

test('a trial absent from records.json reads "Not yet processed", never "none detected"', () => {
  const s = structure();
  assert.equal(s.records.NCT99000008, undefined);
  assert.deepEqual(Object.values(clone(O.subgroupStates(s, 'NCT99000008'))), Array(4).fill('not_yet_processed'));
  const { run, shards } = outcomes();
  const html = O.recordHTML(shards['records/r00.json'].records.NCT99000008, run, false, s);
  assert.equal((html.match(/>Not yet processed</g) || []).length, 4);
  assert.doesNotMatch(html, /No explicit subgroup results/);
  assert.match(html, /not in the results-structure data/);
  assert.match(html, /That is not a finding that no subgroup result was posted/);
});

test('an absent family reads "Not yet processed" for every trial and shows no count', async () => {
  const missing = await O.loadStructure(async () => { throw new Error('HTTP 404'); });
  assert.deepEqual(clone(missing), { ok: false, reason: 'the files are not published on this site' });
  const { run, index, shards } = outcomes();
  for (const s of [missing, null, undefined]) {
    const html = O.listHTML(index.rows, run, 100, s);
    assert.equal((html.match(/>Not yet processed<\/span>/g) || []).length, index.rows.length);
    assert.doesNotMatch(html, /No explicit subgroup results|Explicit subgroup results detected|Processing failed/);
    const rec = O.recordHTML(shards['records/r01.json'].records.NCT99000001, run, false, s);
    assert.equal((rec.match(/>Not yet processed</g) || []).length, 4);
    assert.doesNotMatch(rec, /No explicit subgroup results|Explicit subgroup results detected/);
    assert.match(rec, /Posted documents and publications: not reviewed/);
  }
  const block = O.structureSummaryHTML(missing);
  assert.match(block, /<strong>Not yet processed\.<\/strong>/);
  assert.match(block, /the files are not published on this site/);
  assert.match(block, /That is not a finding that no subgroup result was posted/);
  assert.doesNotMatch(block.replace(/<details[\s\S]*<\/details>/, '').replace(/<[^>]+>/g, ' '), /\d/, 'no number is shown without the data');
  // The older three-argument calls (no family passed) behave the same.
  assert.equal((O.listHTML(index.rows, run, 100).match(/>Not yet processed<\/span>/g) || []).length, index.rows.length);
});

test('a family that fails its integrity check is not used at all', async () => {
  const serve = (f) => async (path) => clone(f[path.split('/').pop().replace('.json', '')]);
  const good = await O.loadStructure(serve(files()));
  assert.equal(good.ok, true);
  const cases = {
    'another run': (f) => { f.summary.run_id = 'results-structure-2026-11-14-0000000000'; },
    'another run or method version': (f) => { f.records.method_version = 'results-structure-0'; },
    'outside the vocabulary': (f) => { f.records.records.NCT99000006.subgroup.by_dimension.age = 'none_detected'; },
    'without an accepted human review': (f) => { f.records.records.NCT99000006.subgroup.by_dimension.race = 'explicit_subgroup_results_detected'; },
    'number of records run.json states': (f) => { delete f.records.records.NCT99000007; },
    'all five values': (f) => { delete f.summary.subgroup_states.by_dimension.sex.not_yet_processed; },
    'metric usable_baseline is incomplete': (f) => { f.summary.metrics.find((m) => m.id === 'usable_baseline').numerator = 99; },
    'does not list fields not inspected': (f) => { f.run.fields_not_inspected = []; },
    'schema version 1': (f) => { f.run.schema_version = 2; },
    'separate tables': (f) => { delete f.summary.tables.negative_findings; },
  };
  const { run, index } = outcomes();
  for (const [message, breakIt] of Object.entries(cases)) {
    const f = files(); breakIt(f);
    assert.match(O.structureProblem(f.run, f.summary, f.records), new RegExp(message), message);
    const loaded = await O.loadStructure(serve(f));
    assert.equal(loaded.ok, false, message);
    const html = O.listHTML(index.rows, run, 100, loaded);
    assert.equal((html.match(/>Not yet processed<\/span>/g) || []).length, index.rows.length, message);
    assert.doesNotMatch(html, /No explicit subgroup results|Explicit subgroup results detected/, message);
  }
  // A reviewed acceptance removed from the record: the detected state is then refused too.
  const f = files();
  f.records.records.NCT99000001.subgroup.signals.forEach((s) => { s.review = []; });
  assert.match(O.structureProblem(f.run, f.summary, f.records), /without an accepted human review/);
});

test('a stale cached file is fetched once more before the family is given up', async () => {
  const f = files();
  const calls = [];
  const fetchJSON = async (path, reload) => {
    calls.push([path, Boolean(reload)]);
    const name = path.split('/').pop().replace('.json', '');
    if (name === 'summary' && !reload) return { ...clone(f.summary), run_id: 'results-structure-2026-11-01-aaaaaaaaaa' };
    return clone(f[name]);
  };
  const loaded = await O.loadStructure(fetchJSON);
  assert.equal(loaded.ok, true);
  assert.ok(calls.every(([p]) => p.startsWith('data/results_structure/')), 'relative paths under data/results_structure/');
  assert.deepEqual(calls.filter(([, reload]) => reload).map(([p]) => p).sort(),
    ['data/results_structure/records.json', 'data/results_structure/summary.json']);
});

test('the trial detail keeps Results, Demographics and Subgroup results apart, with documents on their own line', () => {
  const s = structure();
  const { run, shards } = outcomes();
  const html = O.recordHTML(shards['records/r01.json'].records.NCT99000001, run, false, s);
  const block = html.slice(html.indexOf('oc-structure-detail'));
  const order = ['<dt>Results</dt>', '<dt>Demographics</dt>', '<dt>Subgroup results</dt>'].map((h) => block.indexOf(h));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'three statuses, in order');
  // Results: the outcomes family's own wording, unchanged.
  assert.match(block, /<dt>Results<\/dt><dd>Posted 1 May 2021<\/dd>/);
  // Demographics: what the demographics link carries (sex, race, ethnicity) and nothing more.
  const demo = block.slice(order[1], order[2]);
  assert.match(demo, /<span class="oc-sg-dim">Sex<\/span> Reported/);
  assert.match(demo, /<span class="oc-sg-dim">Race<\/span> Reported/);
  assert.match(demo, /<span class="oc-sg-dim">Ethnicity<\/span> Not reported/);
  assert.doesNotMatch(demo, /Age/, 'the demographics link has no age field; none is invented');
  const sub = block.slice(order[2], block.indexOf('</dl>', order[2]));
  for (const d of ['Age', 'Sex', 'Race', 'Ethnicity']) assert.ok(sub.includes(`<span class="oc-sg-dim">${d}</span>`), d);
  assert.match(sub, />Explicit subgroup results detected</);
  assert.match(block, /<p class="oc-note oc-doc-review">Posted documents and publications: not reviewed<\/p>/);
  // A trial with no posted results: the registry's state, not a processing state.
  const none = O.recordHTML(shards['records/r02.json'].records.NCT99000002, run, false, s);
  assert.equal((none.match(/>No posted results</g) || []).length, 4);
  assert.match(none, /The registry holds no posted results for this trial, so there is nothing for the method to read/);
  assert.match(none, /Posted documents and publications: not reviewed/);
  assert.match(none, /No posted results as of 9 Nov 2026/, 'the Results status keeps its dated wording');
});

test('each signal shows its field, measure title and verbatim text, labelled as awaiting review', () => {
  const s = structure();
  const { run, shards } = outcomes();
  const html = O.recordHTML(shards['records/r07.json'].records.NCT99000007, run, false, s);
  assert.match(html, /<span class="oc-tag oc-awaiting">signal awaiting review<\/span> <strong>No named dimension<\/strong>/);
  assert.match(html, /<dt>Measure<\/dt><dd>Fictional exposure/);
  assert.match(html, /<code class="oc-loc">resultsSection\.outcomeMeasuresModule\.outcomeMeasures\[1\]\.description<\/code>/);
  assert.match(html, /<dt>Matched text<\/dt><dd><q>subgroup<\/q>/);
  assert.match(html, /<dt>In context<\/dt><dd><q>Measured in the subgroup of participants who gave a week 4 sample\.<\/q>/);
  assert.match(html, /1 signal found by the current method/);
  assert.equal((html.match(/>Processing failed or indeterminate</g) || []).length, 4, 'an unreviewed signal with no named dimension');
  // Signals a person reviewed say so, with the decision; they are not called awaiting.
  const reviewed = O.recordHTML(shards['records/r01.json'].records.NCT99000001, run, false, s);
  assert.match(reviewed, /reviewed by a person: accepted for sex, 14 Nov 2026/);
  assert.match(reviewed, /reviewed by a person: rejected for age, 14 Nov 2026/);
  assert.match(reviewed, /<q>Female<\/q> <q>Male<\/q>/);
  assert.doesNotMatch(reviewed, /signal awaiting review/);
  assert.doesNotMatch(reviewed + html, /Fictional Reviewer/, 'no reviewer name is published or shown');
  // Registry text is escaped.
  const hostile = clone(s);
  hostile.records.NCT99000007.subgroup.signals[0].matched_text = ['<img src=x onerror=alert(1)>'];
  hostile.records.NCT99000007.subgroup.signals[0].measure_title = '<script>x</script>';
  assert.doesNotMatch(O.recordHTML(shards['records/r07.json'].records.NCT99000007, run, false, hostile), /<img|<script/);
});

test('usable-content flags are shown with their reasons, and a parse failure is not "not usable"', () => {
  const s = structure();
  const { run, shards } = outcomes();
  const seven = O.recordHTML(shards['records/r07.json'].records.NCT99000007, run, false, s);
  assert.match(seven, /Baseline characteristics <span class="oc-sub">rule B1<\/span><\/dt><dd>Not usable: no baseline measure has a numeric value/);
  assert.match(seven, /Participant flow <span class="oc-sub">rule F1<\/span><\/dt><dd>Not usable: a started or completed count is missing for a group, or no participant started/);
  assert.match(seven, /Primary outcome <span class="oc-sub">rule O1<\/span><\/dt><dd>Not usable: a primary measure has no data table/);
  assert.match(seven, /Adverse events <span class="oc-sub">rule A1<\/span><\/dt><dd>Usable</);
  // NCT99000005 is in the results-structure fixture only: render its detail on another record's frame.
  const base = clone(shards['records/r01.json'].records.NCT99000001); base.nct_id = 'NCT99000005';
  const five = O.structureDetailHTML(base, s, 'Posted');
  assert.match(five, /<strong>Processing failed<\/strong> for part of this record/);
  assert.match(five, /<strong>outcome measures<\/strong>: AttributeError/);
  assert.match(five, /rule O1<\/span><\/dt><dd>Not evaluated: the record could not be parsed, so the rule was not evaluated/);
  assert.match(five, /The outcome measures could not be read, so the subgroup rule was not applied/);
  assert.equal((five.match(/>Processing failed or indeterminate</g) || []).length, 4);
  assert.doesNotMatch(five, /No explicit subgroup results/);
  // An unknown reason code is shown as published, not dropped.
  const odd = clone(s); odd.records.NCT99000007.modules.baseline.reason = 'a_new_reason+no_measures';
  assert.match(O.structureDetailHTML({ ...base, nct_id: 'NCT99000007' }, odd, 'Posted'), /Not usable: a_new_reason; no baseline measure is posted/);
});

test('the summary block shows only numbers summary.json published, each with its denominator', () => {
  const s = structure();
  // Give every published count a value that occurs nowhere else, so each number on the page can be
  // traced to the one summary.json field it came from.
  const marked = clone(s);
  // Labels and definitions mention rule names and field counts ("B1", "18 listed fields"); take the
  // digits out of every published string so that any digit left on the page is a count.
  (function strip(v) {
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && ['label', 'definition', 'scope', 'note'].includes(k)) v[k] = x.replace(/\d/g, '');
      else if (x && typeof x === 'object') strip(x);
    }
  })(marked.summary);
  let next = 7001;
  const expected = new Set();
  const mark = () => { expected.add(next.toLocaleString('en-US')); return next++; };
  for (const d of Object.values(marked.summary.denominators)) { d.n = 900000 + next; next += 1; }
  for (const r of marked.summary.scope.rows) r.n = mark();
  for (const m of marked.summary.metrics) m.numerator = mark();
  for (const d of O.RS_DIMENSIONS) for (const st of O.SUBGROUP_STATES) marked.summary.subgroup_states.by_dimension[d][st] = mark();
  for (const t of ['retrieval_failures', 'parsing_failures']) marked.summary.tables[t].n = mark();
  for (const t of ['missing_data', 'negative_findings']) for (const r of marked.summary.tables[t].rows) r.n = mark();
  for (const k of ['n_signals', 'n_trials_with_a_signal', 'n_reviewed']) marked.summary.signals[k] = mark();
  const denominators = new Set(Object.values(marked.summary.denominators).map((d) => d.n.toLocaleString('en-US')));
  const html = O.structureSummaryHTML(marked);
  const visible = html.slice(0, html.indexOf('<details class="oc-methods')).replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, ' ');
  const shown = visible.match(/\d[\d,]*/g) || [];
  const stray = shown.filter((n) => !expected.has(n) && !denominators.has(n));
  assert.deepEqual(stray, [], 'a number on the page that summary.json did not publish');
  assert.ok(shown.length >= expected.size, 'every published count is shown');
  for (const n of expected) assert.ok(shown.includes(n), `published count ${n} is not shown`);
  assert.doesNotMatch(visible, /%/, 'no percentage is derived');
  // The block reads summary.json only: emptying records.json changes nothing in it.
  const noRecords = { ...marked, records: {} };
  assert.equal(O.structureSummaryHTML(noRecords), html);
  // Each metric names its denominator in words, from the same file.
  const real = O.structureSummaryHTML(s);
  assert.match(real, /<th scope="row">Primary outcome usable \(rule O1\)<\/th><td class="num"><span class="oc-fig"><strong>2<\/strong> of 4<\/span><\/td><td>Retrieved trials with posted results/);
  assert.match(real, /<th scope="row">Between-arm analysis posted on a primary measure<\/th><td class="num"><span class="oc-fig"><strong>1<\/strong> of 1<\/span>/);
  assert.match(real, /Posted results structure and subgroup reporting <span class="oc-h-sub">7 trials<\/span>/);
  assert.match(real, /Retrieval failures<\/dt><dd><span class="oc-fig"><strong>1<\/strong> of 7<\/span>/);
  assert.match(real, /Parsing failures<\/dt><dd><span class="oc-fig"><strong>1<\/strong> of 6<\/span>/);
  assert.match(real, /Missing data: what the records do not contain/);
  assert.match(real, /Negative findings: searches that found nothing, with their scope/);
  assert.match(real, /Scope: Rule SG2 over the 18 listed fields/);
  for (const label of Object.values(O.SUBGROUP_LABELS)) assert.ok(real.includes(`<th scope="row">${label}</th>`), `the state table drops ${label}`);
});

test('the block states the scope of the build: records fetched, trials covered, records left out and why', () => {
  const s = structure();
  const html = O.structureSummaryHTML(s);
  const scope = html.slice(html.indexOf('oc-structure-scope'), html.indexOf('</dl>', html.indexOf('oc-structure-scope')));
  assert.match(scope, /<dt>Registry records fetched \(the frame\)<\/dt><dd><strong>8<\/strong>/);
  assert.match(scope, /<dt>Trials in this build<\/dt><dd><strong>7<\/strong>/);
  assert.match(scope, /<dt>Frame records left out<\/dt><dd><strong>1<\/strong> <span class="oc-sub">Reason: fictional: excluded by the cohort&#39;s eligibility rules\.<\/span>/);
  assert.match(html, /Every count below is over the trials in this build/);
  // The excluded frame record has no record, and the counts' denominator is the trials covered.
  assert.equal(s.records.NCT99000009, undefined);
  assert.equal(s.summary.denominators.requested.n, 7);
  assert.deepEqual(clone(s.run.scope.excluded.nct_ids), ['NCT99000009']);
  // Nothing left out: the row says zero and gives no reason.
  const all = clone(s); all.summary.scope.rows[2].n = 0; all.summary.scope.rows[2].reason = null;
  assert.doesNotMatch(O.structureSummaryHTML(all), /Reason:/);
  // A family that does not state its scope, or leaves records out without a reason, is refused.
  const cases = {
    'does not state the scope': (f) => { delete f.summary.scope; },
    'does not state the scope of the build': (f) => { f.summary.scope.rows = f.summary.scope.rows.filter((r) => r.id !== 'excluded'); },
    'without a stated reason': (f) => { f.summary.scope.rows.find((r) => r.id === 'excluded').reason = null; },
    'scope does not match the requested denominator': (f) => { f.summary.scope.rows.find((r) => r.id === 'included').n = 8; },
  };
  for (const [message, breakIt] of Object.entries(cases)) {
    const f = files(); breakIt(f);
    assert.match(O.structureProblem(f.run, f.summary, f.records), new RegExp(message), message);
  }
});

test('the browser computes no aggregate in the results-structure code', () => {
  const src = read('industry_outcomes.js');
  const start = src.indexOf('posted results structure and subgroup reporting');
  const end = src.indexOf('// ---------------------------------------------------------------- the live view');
  assert.ok(start > 0 && end > start);
  const code = src.slice(start, end).replace(/^\s*\/\/.*$/gm, '');
  // No reduction, no arithmetic on counts, no percentage, and no list length used as a count.
  // (The file writes binary operators with a space either side, as in pctOf above this section.)
  assert.doesNotMatch(code, /\.reduce\(|Math\.|pctOf|figure\(/);
  assert.doesNotMatch(code, / [*/%] | - /, 'no multiplication, division, remainder or subtraction');
  assert.match(src.slice(0, start), / \* num\) \/ den/, 'the operator check does find arithmetic where the file has it');
  assert.doesNotMatch(code, /\.length\.toLocaleString|\$\{[^}]*\.length\s*\}/, 'no row count is displayed');
  // The one counter there is the integrity check, compared with run.json and never shown.
  assert.deepEqual(code.match(/\+=.*/g), ['+= 1;'], 'nothing is summed');
  assert.match(code, /if \(seen !== run\.n_records\) return/);
});

test('methods and limitations: the required wording and both field lists', () => {
  const s = structure();
  const html = O.structureMethodsHTML(s);
  assert.match(html, /<strong>subgroup reporting detected by the current method<\/strong>/);
  assert.match(html, /Results are never inferred for a subgroup from a trial's overall result and baseline proportions/);
  assert.match(html, /Outcome switching is not assessed/);
  assert.match(html, /Posted documents and publications: not reviewed/);
  assert.match(html, /“signal awaiting review”/);
  assert.equal(s.run.fields_inspected.length, 18);
  const inspected = html.slice(html.indexOf('<h5>Fields inspected</h5>'), html.indexOf('<h5>Fields not inspected</h5>'));
  const notInspected = html.slice(html.indexOf('<h5>Fields not inspected</h5>'), html.indexOf('<h5>Usable content'));
  for (const f of s.run.fields_inspected) assert.ok(inspected.includes(`<code>${f}</code>`), f);
  for (const f of s.run.fields_not_inspected) assert.ok(notInspected.includes(`<code>${f}</code>`), f);
  assert.match(html, /Version results-structure-1; subgroup rule SG2/);
  assert.match(html, /2 review records in the review file/);
  // Without the data the fixed statements still show, and the page says the lists are unavailable.
  const absent = O.structureMethodsHTML({ ok: false, reason: 'x' });
  assert.match(absent, /subgroup reporting detected by the current method/);
  assert.match(absent, /Outcome switching is not assessed/);
  assert.match(absent, /fields inspected and not inspected are published with the data, which is not available here/);
  // Nothing on the page calls a machine finding verified or confirmed.
  const { run, index, shards } = outcomes();
  const all = [O.structureSummaryHTML(s), html, ...index.rows.map((r) => O.subgroupCell(O.subgroupStates(s, r.nct_id))),
    ...Object.values(shards).flatMap((sh) => Object.values(sh.records).map((r) => O.structureDetailHTML(r, s, '')))].join('\n');
  assert.doesNotMatch(all, /verified|\bconfirmed\b|validated/i);
});

test('the fixture names its engine source', () => {
  const src = json(`${FIX}SOURCE.json`);
  assert.match(src.engine_commit, /^[0-9a-f]{40}$/);
  assert.equal(src.method_version, files().run.method.version);
  const f = files();
  for (const [name, sha] of Object.entries(f.run.files)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(FIX + name, root))).digest('hex'), sha, name);
  }
});

// ---------------------------------------------------------------- the published family

const DIR = 'data/results_structure/';
const published = existsSync(new URL(DIR, root)) && readdirSync(new URL(DIR, root)).length > 0;

test('the published results-structure data is a family the page accepts, unchanged since its run', { skip: !published && 'nothing published' }, () => {
  assert.deepEqual(readdirSync(new URL(DIR, root)).sort(), ['records.json', 'run.json', 'summary.json']);
  const run = json(`${DIR}run.json`); const summary = json(`${DIR}summary.json`); const records = json(`${DIR}records.json`);
  assert.equal(O.structureProblem(run, summary, records), null);
  assert.deepEqual(Object.keys(run.files).sort(), ['records.json', 'summary.json']);
  for (const [name, sha] of Object.entries(run.files)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(DIR + name, root))).digest('hex'), sha, name);
  }
  assert.match(run.producer.commit, /^[0-9a-f]{40}$/);
  assert.equal(run.producer.uncommitted_changes, false, 'built from a committed engine revision');
  assert.ok(run.acquisition.sha256_uncompressed && run.retrieval_window.from && run.retrieval_window.to);
  // No reviewer name or review note is published.
  const keys = new Set();
  (function walk(v) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } })(records);
  assert.ok(!keys.has('reviewer') && !keys.has('note'));
  // A detected state needs an accepted human review; the review file's row count is in run.json.
  const detected = Object.values(records.records).filter((r) => Object.values(r.subgroup.by_dimension).includes('explicit_subgroup_results_detected'));
  if (run.reviews.n_rows === 0) assert.equal(detected.length, 0, 'no review rows, so no trial may read as detected');
  for (const r of Object.values(records.records)) assert.equal(r.document_and_publication_review, 'not_reviewed', r.nct_id);
});

test('every trial the pane lists has a record or reads "Not yet processed"', { skip: !published && 'nothing published' }, () => {
  const run = json(`${DIR}run.json`); const summary = json(`${DIR}summary.json`); const records = json(`${DIR}records.json`);
  const s = { ok: true, run, summary, records: records.records };
  const index = json('data/outcomes/index.json'); const orun = json('data/outcomes/run.json');
  const html = O.listHTML(index.rows, orun, index.rows.length, s);
  for (const r of index.rows) {
    const states = O.subgroupStates(s, r.nct_id);
    if (!records.records[r.nct_id]) assert.deepEqual(Object.values(clone(states)), Array(4).fill('not_yet_processed'), r.nct_id);
    // A trial the outcomes family lists without posted results is never shown a "none detected" state.
    if (r.results_state !== 'POSTED' && records.records[r.nct_id] && records.records[r.nct_id].results_status === 'no_posted_results') {
      assert.deepEqual(Object.values(clone(states)), Array(4).fill('not_applicable_no_posted_results'), r.nct_id);
    }
  }
  assert.equal((html.match(/<td data-label="Subgroup results">/g) || []).length, index.rows.length);
});

test('the published build covers the cohort the pane lists, and says what it leaves out', { skip: !published && 'nothing published' }, () => {
  const run = json(`${DIR}run.json`); const summary = json(`${DIR}summary.json`); const records = json(`${DIR}records.json`);
  const index = json('data/outcomes/index.json');
  const listed = index.rows.map((r) => r.nct_id).sort();
  // One record per listed trial, and none for a record the outcomes cohort excludes: the block's
  // denominators are the pane's trials, so its counts can be read beside the pane's own.
  assert.deepEqual(Object.keys(records.records).sort(), listed);
  assert.equal(summary.denominators.requested.n, index.rows.length);
  const scope = Object.fromEntries(summary.scope.rows.map((r) => [r.id, r]));
  assert.equal(scope.included.n, index.rows.length);
  const excluded = index.excluded.map((x) => x.nct_id).sort();
  assert.deepEqual([...run.scope.excluded.nct_ids].sort(), excluded);
  assert.equal(scope.excluded.n, excluded.length);
  assert.equal(scope.frame.n, run.acquisition.n_requested, 'the frame is what the archive was fetched for');
  if (excluded.length) {
    assert.ok(scope.excluded.reason && run.scope.excluded.reason === scope.excluded.reason);
    assert.match(scope.excluded.reason, /data\/outcomes\/index\.json excluded/);
  }
  for (const n of excluded) assert.equal(records.records[n], undefined, n);
});

test('index.html and the stylesheet carry the results-structure view', () => {
  const html = read('index.html');
  assert.match(html, /src="industry_outcomes\.js\?v=[^"]*results-structure/);
  const css = read('styles.css');
  for (const cls of ['.oc-sg-list', '.oc-sg-dim', '.oc-signal', '.oc-doc-review', '.oc-structure-table']) assert.ok(css.includes(cls), cls);
  assert.match(css, /\.oc-trials > tbody > tr > td:nth-child\(6\)/, 'the list has a sixth column');
  const src = read('industry_outcomes.js');
  assert.match(src, /const RS_BASE = 'data\/results_structure\/';/, 'a relative path');
  assert.match(src, /const structure = loadStructure\(fetchJSON\);/);
  assert.match(src, /return \{ run, summary, index, get, structure: await structure \};/);
});
