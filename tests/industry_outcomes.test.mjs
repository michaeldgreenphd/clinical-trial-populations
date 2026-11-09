/**
 * Industry tab, Trial outcomes pane (industry_outcomes.js).
 *
 * Runs the module's pure functions in a vm against the fictional artifact families copied from
 * the engine (tests/fixtures/outcomes/, see SOURCE.json there): the consumer-side contract, the
 * display boundary between reviewed and unreviewed assessments, list filtering, wording, and the
 * three layers of the evidence panel. Also checks the wiring in index.html, app.js and
 * .gitignore. It does not render in a browser; the served-page check is separate (verify.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ctx = { globalThis: {} };
vm.runInNewContext(read('industry_outcomes.js'), ctx);
const O = ctx.globalThis.IndustryOutcomes;

function family(mode) {
  const base = `tests/fixtures/outcomes/${mode}/`;
  const shards = {};
  for (const f of readdirSync(new URL(`../${base}records/`, import.meta.url))) {
    shards[`records/${f}`] = JSON.parse(read(`${base}records/${f}`));
  }
  return { run: JSON.parse(read(`${base}run.json`)), summary: JSON.parse(read(`${base}summary.json`)),
           index: JSON.parse(read(`${base}index.json`)), shards };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

test('both fixture builds pass the consumer contract', () => {
  for (const mode of ['evidence_only', 'provisional_preview']) {
    const f = family(mode);
    assert.equal(O.dataProblem(f.run, f.summary, f.index), null, mode);
    for (const shard of Object.values(f.shards)) assert.equal(O.shardProblem(shard, f.run), null);
  }
});

test('the contract refuses mixed runs, dropped states and machine rows in an evidence-only build', () => {
  const f = family('evidence_only');
  let s = clone(f.summary); s.run_id = 'outcomes-2026-11-09-0000000000';
  assert.match(O.dataProblem(f.run, s, f.index), /another run/);
  s = clone(f.summary); delete s.assessment_states.by_kind.human_reviewed.ROLL_UP_NOT_SUPPORTED;
  assert.match(O.dataProblem(f.run, s, f.index), /all eight states/);
  const p = family('provisional_preview');
  const run = clone(p.run); run.display_mode = 'evidence_only';
  assert.match(O.dataProblem(run, p.summary, p.index), /evidence-only/);
  const idx = clone(f.index); idx.rows[0].results_state = 'OVERDUE';
  assert.match(O.dataProblem(f.run, f.summary, idx), /results state/);
  const idx2 = clone(f.index); idx2.rows.pop();
  assert.match(O.dataProblem(f.run, f.summary, idx2), /denominator/);
  assert.match(O.shardProblem({ ...f.shards['records/r01.json'], run_id: 'x' }, f.run), /another run/);
});

test('machine assessments show only on a local preview, labelled; never on a public host', () => {
  const p = family('provisional_preview');
  assert.equal(O.showsMachine(p.run, 'localhost'), true);
  assert.equal(O.showsMachine(p.run, 'civicsample.com'), false);
  assert.equal(O.showsMachine(family('evidence_only').run, 'localhost'), false);
  const publicRows = O.visibleRows(p.index.rows, p.run, 'civicsample.com');
  assert.deepEqual(publicRows.filter((r) => r.assessment_kind).map((r) => [r.nct_id, r.assessment_kind]),
    [['NCT99000001', 'human_reviewed']]);
  const local = O.listHTML(O.visibleRows(p.index.rows, p.run, 'localhost'), p.run, 100);
  assert.match(local, /Provisional, machine only/);
  const pub = O.listHTML(publicRows, p.run, 100);
  assert.doesNotMatch(pub, /Provisional, machine only/);
  assert.match(pub, /Not shown until reviewed by a person/);
  const rec = p.shards['records/r02.json'].records.NCT99000002;
  assert.doesNotMatch(O.recordHTML(rec, p.run, false), /Provisional, machine only|past the standard window<\/span>/);
  assert.match(O.recordHTML(rec, p.run, true), /Provisional, machine only/);
});

test('list filters select rows by the published fields only', () => {
  const { index } = family('evidence_only');
  const ids = (f) => O.filterRows(index.rows, f).map((r) => r.nct_id);
  assert.deepEqual(ids({ results: 'NO_RESULTS' }), ['NCT99000002', 'NCT99000003', 'NCT99000004', 'NCT99000008']);
  assert.deepEqual(ids({ results: 'UNREPORTED' }), ['NCT99000002', 'NCT99000008']);
  assert.deepEqual(ids({ collection: 'audit' }), ['NCT99000001', 'NCT99000002', 'NCT99000007']);
  assert.deepEqual(ids({ collection: 'reviewed' }), ['NCT99000001']);
  assert.deepEqual(ids({ docs: 'none' }), ['NCT99000002', 'NCT99000003', 'NCT99000004', 'NCT99000007', 'NCT99000008']);
  assert.deepEqual(ids({ q: 'other fictional' }), ['NCT99000002']);
  assert.deepEqual(ids({ area: 'Endocrine and Metabolic' }), ['NCT99000007']);
  assert.deepEqual(ids({ state: 'MET' }), ['NCT99000001']);
});

test('the results filter keeps unconfirmed completion apart from not-yet-due results', () => {
  const { index } = family('evidence_only');
  const ids = (rows, f) => O.filterRows(rows, f).map((r) => r.nct_id);
  // NCT99000003 is PENDING / STATUS_UNCERTAIN: its window cannot be placed, so it is not "not yet due".
  assert.deepEqual(ids(index.rows, { results: 'PENDING_DUE' }), []);
  assert.deepEqual(ids(index.rows, { results: 'PENDING_UNCERTAIN' }), ['NCT99000003']);
  const base = index.rows.find((r) => r.nct_id === 'NCT99000003');
  const rows = [
    { ...base, nct_id: 'NCT99100001', results_sub_reason: 'WITHIN_STANDARD_WINDOW' },
    { ...base, nct_id: 'NCT99100002', results_sub_reason: 'CERTIFIED_DELAY' },
    base,
  ];
  assert.deepEqual(ids(rows, { results: 'PENDING_DUE' }), ['NCT99100001', 'NCT99100002']);
  assert.deepEqual(ids(rows, { results: 'PENDING_UNCERTAIN' }), ['NCT99000003']);
  assert.deepEqual(ids(rows, { results: 'PENDING' }), ['NCT99100001', 'NCT99100002', 'NCT99000003']);
  const html = O.filtersHTML(index.rows, {});
  assert.match(html, /not yet due</);
  assert.match(html, /completion not confirmed</);
  assert.doesNotMatch(html, /not yet past/);
});

test('absence is worded as a dated fact, never as non-compliance or a confidence score', () => {
  const { run, index } = family('evidence_only');
  const row = index.rows.find((r) => r.nct_id === 'NCT99000002');
  assert.equal(O.resultsLabel(row, run.cutoff), 'No posted results as of 9 Nov 2026 (past the standard window)');
  const uncertain = index.rows.find((r) => r.nct_id === 'NCT99000003');
  assert.equal(O.resultsLabel(uncertain, run.cutoff), 'No posted results as of 9 Nov 2026 (completion not confirmed)');
  // Everything the view can render: labels, reasons and the HTML of every fixture record.
  const p = family('provisional_preview');
  const rendered = [JSON.stringify(O.STATE_LABELS), JSON.stringify(O.REASONS), O.overviewHTML(p.run, p.summary, true),
    O.listHTML(p.index.rows, p.run, 100),
    ...Object.values(p.shards).flatMap((sh) => Object.values(sh.records).map((r) => O.recordHTML(r, p.run, true)))].join('\n');
  assert.doesNotMatch(rendered.replace(/not a finding of non-compliance/gi, ''), /violat|complian|overdue|confidence score|certainty score/i);
  assert.match(O.REASONS.PAST_STANDARD_WINDOW, /not a finding of non-compliance/);
  for (const s of O.TRIAL_STATES) assert.ok(O.STATE_LABELS[s], `no label for ${s}`);
});

test('the overview names every denominator and lists all eight states', () => {
  const p = family('provisional_preview');
  const html = O.overviewHTML(p.run, p.summary, true);
  assert.match(html, /2 of 6 \(33%\)/);                 // results posted, of the eligible trials
  assert.match(html, /1 of 3 \(33%\)/);                 // reviewed by a person, of the eligible audit trials
  assert.doesNotMatch(html.replace(/\d+ of \d+ \(\d+%\)/g, ''), /\d+%/, 'a percentage without its denominator');
  for (const s of O.TRIAL_STATES) assert.ok(html.includes(O.STATE_LABELS[s]), `overview drops ${s}`);
  assert.match(html, /Not a success rate|not a success rate/i);
  const pub = O.overviewHTML(p.run, p.summary, false);
  assert.doesNotMatch(pub, /Provisional, machine only/);
  assert.match(pub, /document that exists, not a decision rule/);
});

test('the evidence panel keeps registry, method and person apart, with dates', () => {
  const f = family('evidence_only');
  const rec = f.shards['records/r01.json'].records.NCT99000001;
  const html = O.recordHTML(rec, f.run, false);
  for (const h of ['What the registry reports', 'What the method concludes', 'What a person checked', 'Dates and links']) {
    assert.ok(html.includes(h), h);
  }
  assert.match(html, /Reviewed by a person on 10 Nov 2026: confirmed/);
  assert.match(html, /Prot_SAP_000\.pdf, page 12/);
  assert.match(html, /Results availability as of 9 Nov 2026/);
  assert.match(html, /demographics data of 8 Nov 2026/);
  const withdrawn = O.recordHTML(f.shards['records/r04.json'].records.NCT99000004, f.run, false);
  assert.match(withdrawn, /No posted results as of 9 Nov 2026/);
  assert.match(withdrawn, /Not assessed: only trials in the development collection/);
  const hostile = clone(rec); hostile.facts.brief_title = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(O.recordHTML(hostile, f.run, false), /<img/);
});

test('an evidence record that arrives after another trial was opened is dropped', async () => {
  const f = family('evidence_only');
  const pending = {};
  const get = (path) => new Promise((resolve) => { pending[path] = () => resolve(f.shards[path]); });
  const panel = { hidden: true, innerHTML: '', focused: 0, focus() { this.focused += 1; },
    querySelector() { return { addEventListener() {} }; } };
  const el = { querySelector: () => panel };
  const data = { run: f.run, index: f.index, get };
  const a = O.openRecord(el, 'NCT99000001', null, data);   // records/r01.json
  const b = O.openRecord(el, 'NCT99000002', null, data);   // records/r02.json
  pending['records/r02.json']();
  await b;
  assert.match(panel.innerHTML, /NCT99000002/);
  pending['records/r01.json']();                            // the earlier request resolves last
  await a;
  assert.match(panel.innerHTML, /NCT99000002/);
  assert.doesNotMatch(panel.innerHTML, /<h4>NCT99000001/);
  assert.equal(panel.focused, 1, 'only the current request moves focus');
});

test('index.html: the switch, the hidden outcomes pane and the keyed script before app.js', () => {
  const html = read('index.html');
  const section = html.slice(html.indexOf('<section id="industry"'), html.indexOf('</section>', html.indexOf('<section id="industry"')));
  assert.match(section, /id="industry-pane-switch"[^>]*role="group"/);
  assert.match(section, /data-ipane="demographics" aria-pressed="true">Participant demographics</);
  assert.match(section, /data-ipane="outcomes" aria-pressed="false">Trial outcomes</);
  assert.match(section, /id="industry-demographics-pane"/);
  assert.match(section, /id="industry-outcomes-pane" hidden/);
  const outcomes = html.indexOf('src="industry_outcomes.js?v=');
  assert.ok(outcomes > 0 && outcomes < html.indexOf('src="app.js?v='), 'industry_outcomes.js must load, keyed, before app.js');
});

test('app.js switches panes, hides the global filters on outcomes and keeps pane in the share URL', () => {
  const app = read('app.js');
  assert.match(app, /function setIndustryPane\(pane\)/);
  assert.match(app, /getElementById\('industry-outcomes-pane'\)\?\.hidden === false\) p\.set\('pane', 'outcomes'\);/);
  assert.match(app, /window\.IndustryOutcomes\.open\(outcomes, \{ fetchJSON: outcomesFetchJSON \}\)/);
  assert.match(app, /async function outcomesFetchJSON\(path, reload\) \{\n {4}const resp = await keyedFetch\(path/);
  assert.match(read('.gitignore'), /^data\/outcomes\/$/m, 'local preview builds must stay out of git');
});
