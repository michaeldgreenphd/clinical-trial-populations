/**
 * AI Devices tab, "Study links and evidence" pane (device_links.js), and the tab's unit cards.
 *
 * Runs the module in a vm against a fictional family written by the engine itself
 * (tests/fixtures/devices/, see SOURCE.json there: the engine's test fixture, built and exported
 * by civicsample-engine tests/devices/site_fixture.py). Covers the consumer contract, the seven
 * coverage labels, the wording that says what a link is, filters, the detail view, draft
 * reviews and their export, the fallback when the data is absent, the wiring in index.html and
 * app.js, and the published data when it is present. It does not render in a browser; the
 * served-page check is separate (verify.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const at = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(at(p), 'utf8');
const source = read('device_links.js');
// The module keeps the open pane's state, so a test that opens the pane takes its own copy.
const fresh = () => { const ctx = { globalThis: {} }; vm.runInNewContext(source, ctx); return ctx.globalThis.DeviceLinks; };
const D = fresh();
const fx = (f) => JSON.parse(read(`tests/fixtures/devices/${f}`));
const clone = (o) => JSON.parse(JSON.stringify(o));
const family = () => ({ run: fx('run.json'), summary: fx('summary.json'), submissions: fx('submissions.json'),
  families: fx('families.json'), evidence: fx('evidence.json'), setAside: fx('evidence_set_aside.json'), documents: fx('documents.json') });
const parts = (f) => ({ submissions: f.submissions, families: f.families, evidence: f.evidence, setAside: f.setAside, documents: f.documents });
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const store = () => D.draftStore(null);
const blank = (over = {}) => ({ unit: 'submissions', coverage: '', pathway: '', query: '', page: 0, open: null, detail: null,
  detailError: null, setAside: null, setAsideError: null, setAsideLoading: false, showSetAside: false, working: {}, messages: {},
  toggles: {}, exportOpen: false, exportMessage: '', confirmClear: false, ...over });
const bySource = (file) => { const by = {}; for (const r of file.records) (by[r.source.id] = by[r.source.id] || []).push(r); return by; };
const loaded = (f) => { const docsById = {}; for (const l of Object.values(f.documents.documents)) for (const d of l) docsById[d.document_id] = d;
  return { evidence: f.evidence, documents: f.documents, docsById, bySource: bySource(f.evidence) }; };
const row = (f, sn) => f.submissions.submissions.find((s) => s.submission_number === sn);

const STATES = {
  not_searched: 'Not searched',
  search_incomplete_or_blocked: 'Search incomplete or blocked',
  document_unavailable: 'Document unavailable',
  available_document_insufficient: 'Available document insufficient for the question',
  candidate_awaiting_review: 'Candidate link awaiting review',
  no_candidate_in_completed_scope: 'No candidate found in the completed search scope',
  verified_link: 'Verified link: identifier cited (what the citation means is not reviewed)',
};

// ---------------------------------------------------------------- the consumer contract

test('the fixture family, as the engine wrote it, passes the consumer contract', () => {
  const f = family();
  assert.equal(D.dataProblem(f.run, f.summary, parts(f)), null);
  assert.equal(D.dataProblem(f.run, f.summary, null), null);
  const src = fx('SOURCE.json');
  assert.equal(src.run_id, f.run.run_id, 'SOURCE.json names another run than the fixture files');
  assert.match(src.written_by, /civicsample-engine tests\/devices\/site_fixture\.py/);
  for (const [name, digest] of Object.entries(f.run.files)) {
    assert.equal(createHash('sha256').update(readFileSync(at(`tests/fixtures/devices/${name}`))).digest('hex'), digest, `${name} was edited after the engine wrote it`);
  }
});

test('the contract refuses files of mixed run ids', () => {
  const f = family();
  assert.match(D.dataProblem(f.run, { ...f.summary, run_id: 'devices-other' }, null), /summary\.json belongs to a different build/);
  for (const [key, name] of [['submissions', 'submissions.json'], ['families', 'families.json'], ['evidence', 'evidence.json'],
    ['setAside', 'evidence_set_aside.json'], ['documents', 'documents.json']]) {
    assert.match(D.dataProblem(f.run, f.summary, { [key]: { ...f[key], run_id: 'devices-other' } }), new RegExp(name.replace('.', '\\.') + ' belongs to a different build'));
  }
  assert.match(D.dataProblem({ ...f.run, schema_version: 2 }, f.summary, null), /schema this view does not read/);
});

test('the contract refuses a coverage state it has no label for, wherever it stands', () => {
  const f = family();
  let run = clone(f.run); run.vocabularies.coverage_states.push('probably_linked');
  assert.match(D.dataProblem(run, f.summary, null), /coverage state this view does not know \(probably_linked\)/);
  let s = clone(f.submissions); s.submissions[0].coverage_overall = 'probably_linked';
  assert.match(D.dataProblem(f.run, f.summary, { submissions: s }), /K990001 has a coverage state this view does not know \(probably_linked\)/);
  s = clone(f.submissions); s.submissions[0].coverage[3][0] = 'linked';
  assert.match(D.dataProblem(f.run, f.summary, { submissions: s }), /coverage state this view does not know \(linked\)/);
  s = clone(f.submissions); s.submissions[0].coverage[3][1] = 999;
  assert.match(D.dataProblem(f.run, f.summary, { submissions: s }), /coverage cell without its reason/);
  s = clone(f.submissions); s.submissions[0].coverage.pop();
  assert.match(D.dataProblem(f.run, f.summary, { submissions: s }), /one coverage cell per route/);
  const summary = clone(f.summary); summary.tables.coverage_overall.linked = 3;
  assert.match(D.dataProblem(f.run, summary, null), /summary\.json counts a coverage state this view does not know \(linked\)/);
});

test('the contract refuses a family-level record marked validated and a name match at submission level', () => {
  const f = family();
  const name = (e) => e.records.find((r) => r.method === 'device_name_and_organisation_match');
  let e = clone(f.evidence); name(e).automated_validation = 'identifier_confirmed';
  assert.match(D.dataProblem(f.run, f.summary, { evidence: e }), /family-level record marked identifier_confirmed; a family-level record is never validated/);
  e = clone(f.evidence); name(e).automated_validation = 'quote_confirmed_in_source';
  assert.match(D.dataProblem(f.run, f.summary, { evidence: e }), /family-level record marked quote_confirmed_in_source/);
  e = clone(f.evidence); e.records.find((r) => r.method === 'nct_id_in_parent_submission_document').automated_validation = 'identifier_confirmed';
  assert.match(D.dataProblem(f.run, f.summary, { evidence: e }), /a family-level record is never validated/);
  e = clone(f.evidence); name(e).level = 'submission';
  assert.match(D.dataProblem(f.run, f.summary, { evidence: e }), /is a name match at submission level; a name match reaches a family only/);
  e = clone(f.evidence); Object.assign(name(e).source, { entity_type: 'submission', id: 'K990001' });
  assert.match(D.dataProblem(f.run, f.summary, { evidence: e }), /a name match reaches a family only/);
  e = clone(f.evidence); name(e).automated_validation = 'identifier_not_resolved';
  assert.match(D.dataProblem(f.run, f.summary, { evidence: e }), /is a name match marked identifier_not_resolved/);
});

test('the contract refuses unknown statuses, a review without its record, and a record in the wrong file', () => {
  const f = family();
  const change = (fn) => { const e = clone(f.evidence); fn(e.records[0], e); return D.dataProblem(f.run, f.summary, { evidence: e }); };
  assert.match(change((r) => { r.human_review = 'approved'; }), /human review status this view does not know/);
  assert.match(change((r) => { r.automated_validation = 'verified'; }), /automated validation status this view does not know/);
  assert.match(change((r) => { r.method = 'fuzzy_match'; }), /method this view does not know/);
  assert.match(change((r) => { r.human_review = 'accepted'; r.review = null; }), /human review status without its recorded review/);
  assert.match(change((r) => { r.evidence.quote = ' '; }), /no quote, or no page or registry field/);
  assert.match(change((r) => { r.evidence.location = {}; }), /no quote, or no page or registry field/);
  assert.match(change((r) => { r.confidence_reasons = [99]; }), /outside the file's table/);
  assert.match(change((r) => { r.timing.by_submission[0].relation = 'before'; }), /timing relation this view does not know/);
  assert.match(change((r) => { r.target.id = 'ISRCTN1'; }), /does not name a registered study/);
  // a record rejected by rule belongs in the set-aside file, and only such records do
  assert.match(change((r) => { r.automated_validation = 'rejected_by_rule'; }), /rejected by rule and is not in the set-aside file/);
  const aside = clone(f.setAside); aside.records[0].automated_validation = 'not_validated';
  assert.match(D.dataProblem(f.run, f.summary, { setAside: aside }), /in the set-aside file and was not rejected by rule/);
  const s = clone(f.submissions); s.submissions[0].evidence_counts.pop();
  assert.match(D.dataProblem(f.run, f.summary, { submissions: s }), /one evidence count per kind/);
  const fam = clone(f.families); Object.values(fam.families)[0].status = 'product';
  assert.match(D.dataProblem(f.run, f.summary, { families: fam }), /neither a candidate nor a curated family/);
  const summary = clone(f.summary); summary.metrics = summary.metrics.filter((m) => m.id !== 'evidence_records_human_reviewed');
  assert.match(D.dataProblem(f.run, summary, null), /lacks one of the metrics/);
});

// ---------------------------------------------------------------- labels and wording

test('the seven coverage states carry exactly the agreed labels, and only one is a negative finding', () => {
  const f = family();
  assert.deepEqual({ ...D.COVERAGE_LABELS }, STATES);
  assert.deepEqual(f.run.vocabularies.coverage_states.slice().sort(), Object.keys(STATES).sort(), 'the engine vocabulary and the labels differ');
  assert.equal(D.NEGATIVE_FINDING, 'no_candidate_in_completed_scope');
  const html = D.coverageHTML(f.run, f.summary);
  for (const label of Object.values(STATES)) assert.ok(text(html).includes(label), label);
  assert.equal((html.match(/dl-tag-negative/g) || []).length, 1);
  assert.equal((html.match(/Not a negative finding/g) || []).length, 6);
  assert.match(text(html), /Only “No candidate found in the completed search scope” is a negative finding\./);
  // counts are the summary's: the fixture has 2 verified, 4 candidates, and no negative finding at all
  assert.match(html, /Verified link: identifier cited \(what the citation means is not reviewed\)<\/th>\s*<td class="dl-num" data-label="Submissions">2</);
  assert.match(html, /Candidate link awaiting review<\/th>\s*<td class="dl-num" data-label="Submissions">4</);
  assert.match(html, /No candidate found in the completed search scope<\/th>\s*<td class="dl-num" data-label="Submissions">0</);
  assert.match(text(html), /Coverage of the 8 submissions/);
});

test('the header says what a link is before any number, and reads the reviewed count from the summary', () => {
  const f = family();
  const head = text(D.headHTML(f.run, f.summary));
  for (const claim of ['A link is an evidence record, not a finding', 'A submission-level link exists only where an identifier was found in a retrieved source',
    'A name match is a family-level candidate', 'never establishes a link to a submission', 'is evidence, not a requirement',
    'Timing is shown and never decides anything']) assert.ok(head.includes(claim), claim);
  assert.ok(head.search(/\d/) > head.indexOf('Timing is shown and never decides anything'), 'a number stands before the statements');
  assert.match(head, /1 of 10 evidence records have a recorded human review\. The rest have not been reviewed by a person\./);
  const none = clone(f.summary); none.metrics.find((m) => m.id === 'evidence_records_human_reviewed').numerator = 0;
  assert.match(text(D.headHTML(f.run, none)), /Nothing here has been reviewed by a person: 0 of 10 evidence records have a recorded human review\./);
  // the pane's own prose never upgrades a status: no "validated link", "confirmed link" or "proven"
  const all = text(D.headHTML(f.run, f.summary) + D.coverageHTML(f.run, f.summary) + D.evidenceSummaryHTML(f.run, f.summary) + D.methodsHTML(f.run, f.summary, true));
  assert.doesNotMatch(all, /validated link|confirmed link|\bproven\b|\bproves\b/i);
});

test('the three counting units stand side by side with the definitions from run.json', () => {
  const f = family();
  const html = D.unitCardsHTML(f.run, f.summary);
  assert.equal((html.match(/class="stat-card dl-unit"/g) || []).length, 3);
  const t = text(html);
  assert.match(t, /Rows on FDA's list 11 /); assert.match(t, /Distinct submissions 8 /);
  assert.match(t, /Candidate product families: grouped by rule, none curated 7 /);
  for (const unit of ['source_row', 'submission', 'family']) assert.ok(t.includes(f.run.counting_units[unit]), unit);
  const titles = [...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1]);
  assert.equal(titles.length, 3); assert.ok(titles.every((title) => !/device/i.test(title)), 'no unit is called "devices"');
  const curated = clone(f.summary); curated.metrics.find((m) => m.id === 'families_curated').numerator = 2;
  assert.match(text(D.unitCardsHTML(f.run, curated)), /Product families: 2 curated, the rest candidates grouped by rule/);
});

test('the evidence table and the demographic note show the summary\'s counts with their definitions', () => {
  const f = family();
  const ev = D.evidenceSummaryHTML(f.run, f.summary);
  assert.match(ev, /Submission-level: identifier found in a retrieved source<\/th><td class="dl-num" data-label="Records">2</);
  assert.match(ev, /Set aside by rule<\/th><td class="dl-num" data-label="Records">1</);
  assert.ok(ev.includes(f.summary.metrics.find((m) => m.id === 'evidence_records_name_only').definition.replace(/&/g, '&amp;')));
  assert.match(text(ev), /Counted by evidence record, of 10\./);
  const demo = text(D.demographicHTML(f.run, f.summary));
  assert.match(demo, /3 demographic extractions exist, made on 1 document\./);
  assert.match(demo, /None reports a demographic value; 1 is malformed\./);
  assert.match(demo, /Counts from FDA filings are never added to registry counts/);
  const methods = text(D.methodsHTML(f.run, f.summary, true));
  assert.ok(methods.includes(f.run.run_id)); assert.match(methods, /data timestamp 2026-11-13T10:00:06/);
  assert.match(methods, /text layer only, no OCR/); assert.match(methods, /Human reviews applied: 1 of 1 rows/);
  assert.match(methods, /They do not show that a link is right/);
});

// ---------------------------------------------------------------- rows, filters, list

test('rows expand to route, state and reason, and to tallies by kind, as the engine wrote them', () => {
  const f = family();
  const cells = D.coverageOf(row(f, 'K990001'), f.submissions);
  assert.deepEqual(cells.map((c) => c.route), f.run.vocabularies.coverage_routes);
  const scan = cells.find((c) => c.route === 'nct_citation_scan');
  assert.equal(scan.state, 'verified_link'); assert.match(scan.reason, /1 identifier-confirmed evidence record/);
  assert.deepEqual({ ...D.countsOf(row(f, 'K990001'), f.submissions) }, { submission_identifier: 1, family_name_and_organisation: 1,
    family_name_only: 0, parent_submission: 0, set_aside_by_rule: 0, other: 0 });
  assert.equal(D.countsOf(row(f, 'P990007/S002'), f.submissions).parent_submission, 1);
});

test('filters select rows by coverage state, pathway and text; families are listed by their members', () => {
  const f = family(); const rows = f.submissions.submissions;
  const numbers = (flt) => D.filterSubmissions(rows, { coverage: '', pathway: '', query: '', ...flt }).map((s) => s.submission_number);
  assert.equal(numbers({}).length, 8);
  assert.deepEqual(numbers({ coverage: 'verified_link' }), ['K990001', 'DEN990005']);
  assert.deepEqual(numbers({ pathway: 'pma_supplement' }), ['P990007/S002']);
  assert.deepEqual(numbers({ query: 'k990003' }), ['K990003']);
  assert.deepEqual(numbers({ query: 'zorbex' }), ['K990001', 'K990002']);           // device name
  assert.deepEqual(numbers({ query: 'Pearl, Co.' }), ['K990003']);                  // a raw spelling of the company
  assert.deepEqual(numbers({ query: 'viza labs' }), ['DEN990005']);                 // organisation
  assert.deepEqual(numbers({ coverage: 'verified_link', pathway: 'de_novo' }), ['DEN990005']);
  assert.deepEqual(numbers({ query: 'no such device' }), []);
  const fams = (flt) => [...D.filterFamilies(f.families.families, rows, { coverage: '', pathway: '', query: '', ...flt })];   // a plain array of this realm
  assert.equal(fams({}).length, 7);
  assert.deepEqual(clone(fams({ query: 'zorbex' }).map((x) => x.submission_numbers)), [['K990001', 'K990002']]);
  assert.deepEqual(fams({ coverage: 'verified_link' }).map((x) => x.family_name), ['Zorbex Scan (v2.1)', 'Quanta Triage']);
  assert.deepEqual(fams({ query: 'K990008' }).map((x) => x.family_name), ['Lumora']);
});

test('the submission list shows number, device, organisation, date, pathway, family size, state and counts by kind', () => {
  const f = family();
  const html = D.listHTML({ ...f }, blank(), store());
  for (const head of ['Submission', 'Device', 'Organisation', 'Decision date', 'Pathway', 'Family size', 'Coverage state',
    'Identifier', 'Name + organisation', 'Name only', 'Parent submission', 'Set aside', 'Other']) assert.match(html, new RegExp(`<th scope="col"[^>]*>${head.replace('+', '\\+')}</th>`));
  const first = text(html.slice(html.indexOf('data-dl-open="K990001"'), html.indexOf('data-dl-open="K990002"')));
  assert.match(first, /K990001 Zorbex Scan \(v2\.1\) Fictional Imaging, Inc\. 2 Mar 2021 510\(k\) 2 Verified link: identifier cited \(what the citation means is not reviewed\) 1 1 0 0 0 0/);
  assert.match(text(html), /Rows 1–8 of 8 submissions in this list/);
  assert.match(text(html), /do not add up across rows/);
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 8);
  assert.match(D.listHTML({ ...f }, blank({ query: 'nothing' }), store()), /No submissions match these filters/);
  // the real build has no "other" record, and then no such column is drawn
  const none = clone(f); for (const s of none.submissions.submissions) s.evidence_counts[5] = 0;
  assert.doesNotMatch(D.listHTML(none, blank(), store()), />Other<\/th>/);
});

test('the family list shows name, organisation, members and counts, and marks a family as candidate', () => {
  const f = family();
  const html = D.listHTML({ ...f }, blank({ unit: 'families' }), store());
  const zorbex = text(html.slice(html.indexOf('>Zorbex Scan (v2.1)<'), html.indexOf('>Auto Segmentation<')));
  assert.match(zorbex, /Zorbex Scan \(v2\.1\) candidate Fictional Imaging, Inc\. 2: K990001, K990002 2 Mar 2021 to 9 Jun 2023 1 1 0 0 0 1/);
  assert.match(text(html), /Rows 1–7 of 7 families in this list/);
  assert.match(text(html), /none is a curated product unless marked/);
});

test('values from the data are escaped', () => {
  const f = family();
  row(f, 'K990001').device_name = '<img src=x onerror=1>';
  f.evidence.records.find((r) => r.source.id === 'K990001').evidence.quote = 'NCT99000001 <script>alert(1)</script>';
  const html = D.listHTML({ ...f }, blank({ open: { unit: 'submissions', id: 'K990001' }, detail: loaded(f) }), store());
  assert.doesNotMatch(html, /<img|<script/); assert.match(html, /&lt;img/); assert.match(html, /&lt;script&gt;/);
});

// ---------------------------------------------------------------- the detail view

const detail = (f, sn, over = {}, drafts = store()) => D.submissionDetailHTML(row(f, sn), { ...f }, blank({ open: { unit: 'submissions', id: sn }, detail: loaded(f), ...over }), drafts);

test('an open submission shows its source rows and spellings, its family and the cannot-tell-apart statement', () => {
  const f = family();
  const zorbex = text(detail(f, 'K990001'));
  assert.match(zorbex, /2 rows \(list rows 1, 2\): the rows are identical in every column\./);
  assert.match(zorbex, /Company as listed: “Fictional Imaging, Inc\.”\. Device as listed: “Zorbex Scan \(v2\.1\)”\. Decision date as listed: “3\/2\/21”\./);
  assert.match(zorbex, /Candidate family \(same organisation and the same whole core name\): “Zorbex Scan \(v2\.1\)”, 2 submissions\./);
  assert.match(zorbex, /Name evidence cannot tell these 2 submissions apart\. A study that names the device is a candidate for the family and is not evidence about any one of them\./);
  assert.match(zorbex, /K990002 · Zorbex Scan · decision 9 Jun 2023 · Candidate link awaiting review/);
  assert.match(zorbex, /No difference is recorded between the list and FDA's official record in the four fields compared/);
  const pearl = text(detail(f, 'K990003'));
  assert.match(pearl, /the rows differ only in a spelling of the company or device\. Company as listed: “Pearl Co”, “Pearl, Co\.”/);
  assert.match(pearl, /Values that differ between the rows: Company: “Pearl Co”, “Pearl, Co\.”/);
  assert.match(pearl, /not grouped with any other submission: the listed name is made only of device-type words/);
  assert.doesNotMatch(pearl, /cannot tell these/);
  assert.match(text(detail(f, 'K990004')), /the rows disagree on something other than a spelling.*Primary Product Code: “AAA”, “BBB”/);
});

test('official-record differences are shown with both values, and no comparison is claimed without a record', () => {
  const f = family();
  row(f, 'K990001').official_differs_from_list = { applicant: { listed: ['Fictional Imaging, Inc.'], official: 'Fictional Imaging Holdings' },
    product_code: { listed: 'QIH', official: 'LLZ' } };
  const t = text(detail(f, 'K990001'));
  assert.match(t, /applicant: the list has “Fictional Imaging, Inc\.”; FDA's record has “Fictional Imaging Holdings”/);
  assert.match(t, /product code: the list has “QIH”; FDA's record has “LLZ”/); assert.match(t, /Neither is chosen over the other/);
  row(f, 'K990002').official_record_available = false;
  assert.match(text(detail(f, 'K990002')), /No official FDA record was retrieved for this number, so the list was not compared with one\./);
});

test('documents show type, link, short sha256, retrieval date and text status; a granting letter is not a summary', () => {
  const f = family();
  const html = detail(f, 'DEN990005'); const t = text(html);
  assert.match(t, /De Novo granting letter FDA's label: Classification Order DEN990005\.pdf 8cdcda8f58db 13 Nov 2026 Text read 1 of 1 pages with text Kept as regulatory evidence; not treated as a decision summary or a demographic summary\. Not a demographic-summary candidate:/);
  assert.match(t, /De Novo decision summary FDA's label: Decision Summary DEN990005\.pdf 10bb993aa998 13 Nov 2026 Text read 2 of 2 pages with text Demographic-summary candidate:/);
  assert.match(html, /<a href="https:\/\/www\.accessdata\.fda\.gov\/cdrh_docs\/reviews\/DEN990005\.pdf" target="_blank" rel="noopener">DEN990005\.pdf<\/a>/);
  assert.match(html, /<code title="[0-9a-f]{64}">8cdcda8f58db<\/code>/);
  assert.match(t, /Not retrieved FDA's label: Classification Order DEN990005\.pdf not held \(not found\) — — —/);
  const pma = text(detail(f, 'P990006'));
  assert.match(pma, /Summary of safety and effectiveness \(PMA\).*Scan with no text layer; not read/);
  assert.match(pma, /PMA approval order.*Kept as regulatory evidence; not treated as a decision summary or a demographic summary\./);
  assert.match(text(detail(f, 'P990007/S002')), /A document of the original submission, not of this supplement\./);
  // a URL that is not FDA's is text, not a link
  f.documents.documents.K990001[0].url = 'javascript:alert(1)';
  assert.doesNotMatch(detail(f, 'K990001'), /href="javascript/);
});

test('coverage is shown route by route with the state label and the engine\'s reason', () => {
  const f = family();
  const t = text(detail(f, 'K990001'));
  assert.match(t, /Overall: Verified link: identifier cited \(what the citation means is not reviewed\) , from text of every document held for the submission, scanned for NCT ids\./);
  for (const cell of D.coverageOf(row(f, 'K990001'), f.submissions)) {
    assert.ok(t.includes(`${f.run.coverage_routes[cell.route]} ${STATES[cell.state]} ${cell.reason}`), cell.route);
  }
});

test('an evidence record shows every field, and the published review apart from any draft', () => {
  const f = family();
  const html = detail(f, 'K990001'); const t = text(html);
  const own = html.slice(html.indexOf('Records for this submission'), html.indexOf('Records for its candidate family'));
  const o = text(own);
  assert.match(o, /submission-level record for K990001/);
  assert.match(own, /<blockquote class="dl-quote">A clinical study \(ClinicalTrials\.gov NCT99000001\) enrolled 412 patients at three sites\.<\/blockquote>/);
  assert.match(o, /Where it stands Page 3 of the 510\(k\) summary \( open the document at FDA \)\. Matched text: “NCT99000001”/);
  assert.match(o, /Relationship \(proposed\) Study cited in a document of the submission/);
  assert.match(o, /Method NCT number found in a document of this submission/);
  assert.match(o, /Source version document sha256 61dd9b421c23 · retrieved 13 Nov 2026 · .*text extraction pypdf-[\w.-]+ · registry data of 13 Nov 2026 \(API 2\.0\.5\) · registry record retrieved 13 Nov 2026/);
  assert.match(o, /Confidence Identifier NCT id in the text of a 510k_summary \(page 3\)/);
  assert.match(o, /Automated validation Identifier confirmed \(automated check: the citation exists and the identifier resolves\) the cited id resolves to a registry record with that id the document belongs to this submission/);
  assert.match(o, /Study Reader study of an imaging aid · lead sponsor Fictional Imaging Inc\. · registry status completed · clinicaltrials\.gov\/study\/NCT99000001/);
  assert.match(own, /href="https:\/\/clinicaltrials\.gov\/study\/NCT99000001"/);
  assert.match(o, /Timing \(descriptive only\) Study start 1 Mar 2019 · primary completion 15 Jan 2020 · completion not recorded · first posted not recorded K990001: FDA decision 2 Mar 2021 — Primary completion on or before the FDA decision date/);
  // the one published review of the fixture, as the engine applied it
  assert.match(o, /Human review \(published\) Accepted · Explicitly cited supporting study · reviewed 13 Nov 2026\. Note: Fictional review:/);
  assert.match(o, /This record already has a row in devices\/reviews\.csv/);
  assert.doesNotMatch(o, /Draft review, not yet recorded/);
  assert.match(t, /Evidence records Records for this submission/);
});

test('a family-level record is marked as not specific to the submission, with the organisation as evidence', () => {
  const f = family();
  const html = detail(f, 'K990001');
  const fam = html.slice(html.indexOf('Records for its candidate family'));
  assert.match(fam, /<article class="dl-record dl-record-family"/);
  assert.match(fam, /<p class="dl-level dl-level-family">family-level candidate — not specific to this submission<\/p>/);
  assert.equal(D.FAMILY_MARK, 'family-level candidate — not specific to this submission');
  const t = text(fam);
  assert.match(t, /Where it stands Registry field intervention_name of NCT99000001\. Matched text: “zorbex scan”/);
  assert.match(t, /Organisation Listed manufacturer “Fictional Imaging, Inc\.” and the study's lead sponsor “Fictional Imaging Inc\.” \(normalised exact\)\. Agreement is evidence, not a requirement\./);
  assert.match(t, /Automated validation Not validated string evidence only; no identifier joins the study to any submission of the family/);
  assert.match(t, /K990001: FDA decision 2 Mar 2021 — .* K990002: FDA decision 9 Jun 2023 — /);
  assert.match(t, /Human review \(published\) Unreviewed/);
  // the supplement: evidence of the original submission, family level, never the supplement's own
  const supp = text(detail(f, 'P990007/S002'));
  assert.match(supp, /family-level candidate — not specific to this submission \(the evidence belongs to the original submission, not to this supplement\)/);
  assert.match(supp, /Method NCT number found in a document of the original submission, not of this supplement/);
  // a cited id the registry does not hold: absent study facts are said to be absent
  const unresolved = detail(f, 'K990002');
  assert.match(unresolved, /no title held for this study/);
  assert.match(text(unresolved), /Identifier not resolved \(the registry does not hold the cited id\)/);
  assert.match(text(unresolved), /lead sponsor not held · registry status not held · registry lookup: not found/);
});

test('set-aside records load only on request, under the agreed label', () => {
  const f = family();
  assert.equal(D.SET_ASIDE_LABEL, 'Set aside by rule (name returns 50 or more registry records, or the number is in no returned field)');
  const before = detail(f, 'K990003');
  assert.ok(before.includes(D.SET_ASIDE_LABEL));
  assert.match(before, /data-dl-setaside="1">Show the 1 record<\/button>/);
  assert.doesNotMatch(before, /NCT99000004/);
  const after = detail(f, 'K990003', { setAside: { file: f.setAside, bySource: bySource(f.setAside) }, showSetAside: true });
  assert.match(after, /id="dl-setaside" tabindex="-1"/); assert.match(after, /NCT99000004/);
  assert.match(text(after), /Automated validation Rejected by rule the submission number stands in no field of the returned record/);
  assert.match(text(after), /none is a candidate/);
  assert.match(text(detail(f, 'K990001')), /No record was set aside by rule here\./);
});

test('an open family shows its members, the statement and the records of the family and of each member', () => {
  const f = family();
  const fid = row(f, 'K990001').family_id;
  const fam = { family_id: fid, ...f.families.families[fid] };
  const html = D.familyDetailHTML(fam, { ...f }, blank({ unit: 'families', open: { unit: 'families', id: fid }, detail: loaded(f) }), store());
  const t = text(html);
  assert.match(t, /Zorbex Scan \(v2\.1\) Close Candidate family \(same organisation and the same whole core name\) · Fictional Imaging, Inc\./);
  assert.match(t, /Name evidence cannot tell these 2 submissions apart\./);
  assert.match(t, /Records for the family/); assert.match(t, /Records for member K990001/); assert.match(t, /Records for member K990002/);
  assert.match(html, /family-level candidate — not specific to any one submission of the family/);
  assert.equal((html.match(/<article class="dl-record/g) || []).length, 3);
});

// ---------------------------------------------------------------- draft reviews

const draft = (over = {}) => ({ human_review: 'rejected', reviewed_relationship: '', note: 'The quote is about a predicate.', reviewed_on: '2026-11-14', ...over });

test('a draft must satisfy the rules the engine loader applies to devices/reviews.csv', () => {
  const run = fx('run.json');
  assert.equal(D.draftProblem(draft(), run), null);
  assert.equal(D.draftProblem(draft({ human_review: 'accepted', reviewed_relationship: 'related_validation_study' }), run), null);
  assert.match(D.draftProblem(draft({ human_review: '' }), run), /Choose a decision: accepted, rejected, unresolved\./);
  assert.match(D.draftProblem(draft({ human_review: 'unreviewed' }), run), /Choose a decision/);
  assert.match(D.draftProblem(draft({ human_review: 'accepted' }), run), /must say which relationship was accepted/);
  assert.match(D.draftProblem(draft({ reviewed_relationship: 'supports_the_device' }), run), /not one the engine accepts/);
  assert.match(D.draftProblem(draft({ note: '   ' }), run), /note giving the reason is required/);
  assert.match(D.draftProblem(draft({ reviewed_on: '14/11/2026' }), run), /YYYY-MM-DD/);
  assert.equal(D.localDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('review rows export in the column order of devices/reviews.csv, quoted as CSV', () => {
  const run = fx('run.json');
  assert.deepEqual([...D.REVIEW_COLUMNS], ['link_id', 'human_review', 'reviewed_relationship', 'reviewed_on', 'note']);
  const out = D.reviewRowsCSV({
    'link:bbbb': draft({ human_review: 'accepted', reviewed_relationship: 'documented_postmarket_study', note: 'Says "post-market", page 4, then\nnames the device.' }),
    'link:aaaa': draft({ note: ' plain reason ' }),
    'link:cccc': draft({ human_review: 'accepted' }),                       // incomplete: left out and named
  }, run);
  assert.equal(out.text,
    'link_id,human_review,reviewed_relationship,reviewed_on,note\n' +
    'link:aaaa,rejected,,2026-11-14,plain reason\n' +
    'link:bbbb,accepted,documented_postmarket_study,2026-11-14,"Says ""post-market"", page 4, then\nnames the device."\n');
  assert.equal(out.n_rows, 2); assert.deepEqual([...out.skipped], ['link:cccc']);
  assert.equal(D.reviewRowsCSV({}, run).text, 'link_id,human_review,reviewed_relationship,reviewed_on,note\n');
  assert.equal(D.EXPORT_SENTENCE, 'Decisions made here take effect only when these rows are added to devices/reviews.csv in the engine repository and the build is rerun.');
});

test('drafts are held in memory and mirrored to storage; the pane works when storage is missing or throws', () => {
  const kept = {};
  const good = { getItem: (k) => (k in kept ? kept[k] : null), setItem: (k, v) => { kept[k] = v; }, removeItem: (k) => { delete kept[k]; } };
  let s = D.draftStore(good);
  s.set('link:1', draft());
  assert.equal(s.persisted(), true); assert.deepEqual(JSON.parse(kept[D.STORAGE_KEY]), { 'link:1': draft() });
  assert.deepEqual({ ...D.draftStore(good).get('link:1') }, draft(), 'a later visit reads the mirror back');
  s.clear(); assert.equal(D.STORAGE_KEY in kept, false); assert.deepEqual({ ...s.all() }, {});
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
  for (const storage of [null, throwing]) {
    s = D.draftStore(storage);
    s.set('link:2', draft()); assert.deepEqual({ ...s.get('link:2') }, draft()); assert.equal(s.persisted(), false);
    s.remove('link:2'); assert.equal(s.get('link:2'), null); s.clear();
  }
  kept[D.STORAGE_KEY] = '{not json'; assert.deepEqual({ ...D.draftStore(good).all() }, {});
  kept[D.STORAGE_KEY] = JSON.stringify({ 'link:3': 'accepted', 'link:4': draft() });
  assert.deepEqual(Object.keys(D.draftStore(good).all()), ['link:4'], 'an entry that is not a draft is dropped');
  const f = family();
  assert.match(text(D.draftsHTML(blank(), f.run, D.draftStore(null))), /does not allow storage here, so drafts last only until the page is closed or reloaded\. No draft review in this browser\./);
});

// A pane element without a DOM: it records what was drawn and what was given focus.
function pane() {
  const focused = [];
  const el = { innerHTML: '', contains: () => true,
    querySelector: (sel) => ({ focus: () => focused.push(sel), value: '', setSelectionRange() {} }) };
  const click = (dataset, open = false) => el.onclick({ target: { closest: () => ({ dataset, parentElement: { open } }) } });
  return { el, focused, click };
}
const serve = (f, over = {}) => (path) => {
  const name = path.replace('data/devices/', '');
  if (name in over) return over[name]();
  const key = { 'run.json': 'run', 'summary.json': 'summary', 'submissions.json': 'submissions', 'families.json': 'families',
    'evidence.json': 'evidence', 'evidence_set_aside.json': 'setAside', 'documents.json': 'documents' }[name];
  return key ? Promise.resolve(clone(f[key])) : Promise.reject(new Error('HTTP 404'));
};
const tick = () => new Promise((r) => setTimeout(r, 0));

test('a draft review never changes the published status or any count, and is labelled as not yet recorded', async () => {
  const f = family(); const L = fresh(); const { el, click, focused } = pane();
  const id = f.evidence.records.find((r) => r.source.id === 'DEN990005').link_id;       // published status: unreviewed
  await L.open(el, { fetchJSON: serve(f), storage: null, today: () => '2026-11-14' });
  const before = { review: /<li class="dl-review-line">[^<]*<\/li>/.exec(el.innerHTML)[0], coverage: /<table class="dl-table dl-coverage">[\s\S]*?<\/table>/.exec(el.innerHTML)[0],
    evidence: /<table class="dl-table dl-evidence-summary">[\s\S]*?<\/table>/.exec(el.innerHTML)[0], units: /<div class="stats-grid dl-units"[\s\S]*?<section/.exec(el.innerHTML)[0] };
  click({ dlOpen: 'DEN990005' }); await tick(); await tick();
  assert.match(el.innerHTML, /id="dl-detail"/);
  assert.match(text(el.innerHTML), /Human review \(published\) Unreviewed/);
  // saving with nothing chosen is refused, and nothing is stored
  click({ dlSave: id });
  assert.match(text(el.innerHTML), /Choose a decision: accepted, rejected, unresolved\./);
  assert.match(text(el.innerHTML), /No draft review in this browser\./);
  el.onchange({ target: { dataset: { dlDecision: id }, value: 'accepted', checked: true } });
  el.oninput({ target: { dataset: { dlNote: id }, value: 'The record names the cleared device as its intervention.' } });
  click({ dlSave: id });
  assert.match(text(el.innerHTML), /An accepted link must say which relationship was accepted\./);
  assert.match(el.innerHTML, /value="accepted" data-dl-decision="[^"]+" checked/, 'what the reader entered survives the redraw');
  assert.match(el.innerHTML, />The record names the cleared device as its intervention\.<\/textarea>/);
  el.onchange({ target: { dataset: { dlRelationship: id }, value: 'documented_postmarket_study' } });
  click({ dlSave: id });
  const t = text(el.innerHTML);
  assert.match(t, /Draft review, not yet recorded : Accepted · Documented post-market study · dated 2026-11-14\. Note: The record names the cleared device as its intervention\./);
  assert.match(t, /Human review \(published\) Unreviewed/, 'the published status is unchanged');
  assert.match(t, /1 draft review, not yet recorded\./);
  assert.equal(focused.at(-1), `[data-dl-save="${id}"]`);
  // every published count is as it was
  assert.equal(/<li class="dl-review-line">[^<]*<\/li>/.exec(el.innerHTML)[0], before.review);
  assert.equal(/<table class="dl-table dl-coverage">[\s\S]*?<\/table>/.exec(el.innerHTML)[0], before.coverage);
  assert.equal(/<table class="dl-table dl-evidence-summary">[\s\S]*?<\/table>/.exec(el.innerHTML)[0], before.evidence);
  assert.equal(/<div class="stats-grid dl-units"[\s\S]*?<section/.exec(el.innerHTML)[0], before.units);
  // export: the sentence, the rows, in order
  click({ dlExport: '1' });
  assert.ok(el.innerHTML.includes(`<strong>${L.EXPORT_SENTENCE}</strong>`));
  assert.ok(el.innerHTML.includes(`link_id,human_review,reviewed_relationship,reviewed_on,note\n${id},accepted,documented_postmarket_study,2026-11-14,The record names the cleared device as its intervention.\n</textarea>`));
  assert.equal(focused.at(-1), '#dl-export-text');
  // clearing asks first, then removes the drafts and nothing else
  click({ dlClear: '1' }); assert.match(text(el.innerHTML), /Clear 1 draft from this browser\?/);
  click({ dlClearNo: '1' }); assert.match(text(el.innerHTML), /1 draft review, not yet recorded\./);
  click({ dlClear: '1' }); click({ dlClearYes: '1' });
  assert.match(text(el.innerHTML), /No draft review in this browser\./);
  assert.doesNotMatch(el.innerHTML, /Draft review, not yet recorded/);
  assert.equal(/<li class="dl-review-line">[^<]*<\/li>/.exec(el.innerHTML)[0], before.review);
});

// ---------------------------------------------------------------- loading and focus

test('the manifest is read past the cache, and a file from an earlier build is read once more', async () => {
  const f = family(); const L = fresh(); const { el, click } = pane();
  const calls = [];
  const fetchJSON = (path, reload) => {
    const name = path.replace('data/devices/', '');
    calls.push([name, Boolean(reload)]);
    return serve(f)(path).then((file) => ((name === 'families.json' || name === 'evidence.json') && !reload ? { ...file, run_id: 'devices-an-earlier-build' } : file));
  };
  await L.open(el, { fetchJSON, storage: null });
  assert.deepEqual(calls, [['run.json', true], ['summary.json', false], ['submissions.json', false], ['families.json', false], ['families.json', true]]);
  assert.match(el.innerHTML, /dl-list/); assert.doesNotMatch(el.innerHTML, /could not be read/);
  // the evidence and documents are fetched when a row is first opened, not before, and only once
  click({ dlOpen: 'K990001' }); await tick(); await tick();
  assert.deepEqual(calls.slice(5).sort(), [['documents.json', false], ['evidence.json', false], ['evidence.json', true]]);
  assert.match(el.innerHTML, /NCT99000001/);
  click({ dlClose: '1' }); click({ dlOpen: 'K990002' }); await tick();
  assert.equal(calls.length, 8);
  // the set-aside file is fetched only when asked for
  assert.ok(!calls.some(([name]) => name === 'evidence_set_aside.json'));
  click({ dlClose: '1' }); click({ dlOpen: 'K990003' }); await tick();
  click({ dlSetaside: '1' }); await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['evidence_set_aside.json', false]);
  assert.match(el.innerHTML, /NCT99000004/);
});

test('a failed load of the set-aside records keeps a button that asks again', async () => {
  const f = family(); const L = fresh(); const { el, click, focused } = pane();
  let fail = true; const asked = [];
  const fetchJSON = (path, reload) => {
    if (path.endsWith('evidence_set_aside.json')) {
      asked.push(Boolean(reload));
      if (fail) return Promise.reject(new Error('HTTP 503'));
    }
    return serve(f)(path);
  };
  await L.open(el, { fetchJSON, storage: null });
  click({ dlOpen: 'K990003' }); await tick(); await tick();
  click({ dlSetaside: '1' }); await tick(); await tick();
  assert.match(text(el.innerHTML), /Could not load the set-aside records \(HTTP 503\)\./);
  assert.match(el.innerHTML, /data-dl-setaside="1">Try again<\/button>/);
  assert.doesNotMatch(el.innerHTML, /NCT99000004/);
  fail = false;
  click({ dlSetaside: '1' }); await tick(); await tick();
  assert.equal(asked.length, 2, 'asked once more');
  assert.doesNotMatch(el.innerHTML, /Could not load the set-aside records/);
  assert.match(el.innerHTML, /NCT99000004/);
  assert.equal(focused.at(-1), '#dl-setaside');
});

test('the stylesheet is balanced: every rule block that opens is closed', () => {
  // The site has no build step, so a brace left open is served as committed and can swallow every
  // rule after it into a media query.
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  for (const ch of css) {
    depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
    assert.ok(depth >= 0, 'a block closes that was never opened');
  }
  assert.equal(depth, 0, 'a block is left open');
  // the device pane's rules stand at the top level, outside any media query
  const at = css.indexOf('.ai-devices-pane-switch {');
  let d = 0; for (const ch of css.slice(0, at)) d += ch === '{' ? 1 : ch === '}' ? -1 : 0;
  assert.equal(d, 0, 'the AI Devices rules are not nested in another block');
});

test('absent data says so, and data that fails the contract is refused rather than half-drawn', async () => {
  const f = family();
  let L = fresh(); let p = pane();
  await L.open(p.el, { fetchJSON: () => Promise.reject(new Error('HTTP 404')), storage: null });
  assert.match(p.el.innerHTML, /The study-link data is not available on this site\./);
  assert.doesNotMatch(p.el.innerHTML, /<table/);
  L = fresh(); p = pane();
  await L.open(p.el, { fetchJSON: serve(f, { 'summary.json': () => Promise.resolve({ ...clone(f.summary), run_id: 'devices-other' }) }), storage: null });
  assert.match(p.el.innerHTML, /could not be read: summary\.json belongs to a different build/);
  L = fresh(); p = pane();
  const bad = clone(f.submissions); bad.submissions[2].coverage_overall = 'linked';
  await L.open(p.el, { fetchJSON: serve(f, { 'submissions.json': () => Promise.resolve(bad) }), storage: null });
  assert.match(p.el.innerHTML, /could not be read: K990003 has a coverage state this view does not know \(linked\)/);
  assert.doesNotMatch(p.el.innerHTML, /<table/);
  // an evidence file that breaks a rule is refused when a row is opened; the list stays
  L = fresh(); p = pane();
  const ev = clone(f.evidence); ev.records.find((r) => r.method === 'device_name_match').level = 'submission';
  await L.open(p.el, { fetchJSON: serve(f, { 'evidence.json': () => Promise.resolve(ev) }), storage: null });
  p.click({ dlOpen: 'K990001' }); await tick(); await tick();
  assert.match(text(p.el.innerHTML), /Could not load the evidence records \(.*a name match reaches a family only\)/);
  assert.doesNotMatch(p.el.innerHTML, /<article class="dl-record/);
  // loadHead, which the unit cards use, rejects in the same cases
  await assert.rejects(fresh().loadHead(() => Promise.reject(new Error('HTTP 404'))), /HTTP 404/);
  await assert.rejects(fresh().loadHead(serve(f, { 'summary.json': () => Promise.resolve({ ...clone(f.summary), run_id: 'x' }) })), /different build/);
});

test('opening moves focus to the detail, Escape closes it and returns focus, and controls keep focus', async () => {
  const f = family(); const L = fresh(); const { el, click, focused } = pane();
  await L.open(el, { fetchJSON: serve(f), storage: null });
  assert.deepEqual(focused, [], 'opening the pane does not move focus');
  click({ dlOpen: 'P990007/S002' }); await tick(); await tick();
  assert.equal(focused.at(-1), '#dl-detail');
  assert.match(el.innerHTML, /data-dl-open="P990007\/S002" aria-expanded="true" aria-controls="dl-detail"/);
  assert.match(el.innerHTML, /id="dl-detail" role="region" tabindex="-1" aria-label="Evidence for P990007\/S002"/);
  let prevented = false;
  el.onkeydown({ key: 'Escape', preventDefault: () => { prevented = true; } });
  assert.ok(prevented); assert.doesNotMatch(el.innerHTML, /id="dl-detail"/);
  assert.equal(focused.at(-1), '[data-dl-open="P990007/S002"]');
  el.onkeydown({ key: 'Escape', preventDefault: () => { throw new Error('nothing is open'); } });
  click({ dlOpen: 'K990001' }); await tick(); click({ dlOpen: 'K990001' });                 // the row's own button closes it too
  assert.doesNotMatch(el.innerHTML, /id="dl-detail"/); assert.equal(focused.at(-1), '[data-dl-open="K990001"]');
  el.onchange({ target: { id: 'dl-coverage', value: 'verified_link', dataset: {} } });
  assert.equal(focused.at(-1), '#dl-coverage'); assert.match(text(el.innerHTML), /Rows 1–2 of 2 submissions in this list/);
  el.oninput({ target: { id: 'dl-search', value: 'quanta', dataset: {} } });
  assert.equal(focused.at(-1), '#dl-search'); assert.match(text(el.innerHTML), /Rows 1–1 of 1 submissions in this list/);
  click({ dlUnit: 'families' });
  assert.equal(focused.at(-1), '[data-dl-unit="families"]'); assert.match(text(el.innerHTML), /Rows 1–1 of 1 families in this list/);
  assert.match(el.innerHTML, /data-dl-unit="families" aria-pressed="true"/);
});

test('a file that arrives after the row was closed draws nothing', async () => {
  const f = family(); const L = fresh(); const { el, click } = pane();
  let release;
  const held = new Promise((resolve) => { release = () => resolve(clone(f.evidence)); });
  await L.open(el, { fetchJSON: serve(f, { 'evidence.json': () => held }), storage: null });
  click({ dlOpen: 'K990001' }); await tick();
  assert.match(text(el.innerHTML), /Loading the evidence records and documents…/);
  click({ dlClose: '1' });
  const closed = el.innerHTML;
  release(); await tick(); await tick();
  assert.equal(el.innerHTML, closed, 'the late file must not reopen the row');
});

// ---------------------------------------------------------------- the tab: wiring and the unit cards

const app = read('app.js');
function slice(startMarker, endMarker = '\n}\n') {
  const start = app.indexOf(startMarker);
  assert.ok(start >= 0, `app.js lost ${startMarker}`);
  return app.slice(start, app.indexOf(endMarker, start) + endMarker.length);
}

test('index.html loads the module keyed and before app.js, and app.js opens it from the pane switch', () => {
  const html = read('index.html');
  const mod = html.indexOf('src="device_links.js?v=');
  assert.ok(mod > 0 && mod < html.indexOf('src="app.js?v='), 'device_links.js must load, keyed, before app.js');
  const section = html.slice(html.indexOf('<section id="ai-devices"'), html.indexOf('</section>', html.indexOf('<section id="ai-devices"')));
  assert.match(section, /id="ai-devices-pane-switch" role="group" aria-label="AI Devices view"/);
  assert.match(section, /class="view-btn active" data-dpane="list" aria-pressed="true">Device list</);
  assert.match(section, /class="view-btn" data-dpane="links" aria-pressed="false">Study links and evidence</);
  assert.match(section, /id="ai-devices-links-pane" hidden/); assert.doesNotMatch(section, /id="ai-devices-list-pane"[^>]*hidden/);
  for (const id of ['ai-devices-stats', 'ai-panel-chart', 'ai-timeline-chart', 'ai-nonk-chart', 'ai-devices-table']) {
    assert.ok(section.indexOf(`id="${id}"`) > section.indexOf('id="ai-devices-list-pane"'), `${id} belongs to the list pane`);
  }
  // the charts and the table say which unit they count
  assert.ok((section.match(/Counted by list row\./g) || []).length >= 3);
  assert.match(section, /the table is counted by list row/);
  assert.match(app, /function setAIDevicesPane\(/); assert.match(app, /DeviceLinks\.open\(links, \{ fetchJSON: outcomesFetchJSON \}\)/);
  assert.match(app, /#ai-devices-pane-switch \.view-btn'\)\.forEach\(b => b\.addEventListener\('click'/);
  assert.match(read('tests/docs_wiring.test.mjs'), /KEYED_ASSETS = \[[^\]]*'device_links\.js'/);
});

test('the pane switch shows one pane, marks its button, and opens the evidence pane only when chosen', () => {
  const opened = [];
  const nodes = { 'ai-devices-list-pane': { hidden: false }, 'ai-devices-links-pane': { hidden: true, innerHTML: '' } };
  const buttons = ['list', 'links'].map((dpane) => ({ dataset: { dpane }, state: {}, classList: { toggle(c, on) { this.on = on; } },
    setAttribute(k, v) { this.state[k] = v; } }));
  const ctx = { document: { getElementById: (id) => nodes[id], querySelectorAll: () => buttons },
    window: { DeviceLinks: { open: (el, deps) => opened.push([el, typeof deps.fetchJSON]) } }, outcomesFetchJSON: () => {} };
  vm.runInNewContext(`let aiDevicesPane = 'list';\n${slice('function setAIDevicesPane(pane) {')}\nthis.set = setAIDevicesPane;`, ctx);
  ctx.set('links');
  assert.deepEqual([nodes['ai-devices-list-pane'].hidden, nodes['ai-devices-links-pane'].hidden], [true, false]);
  assert.deepEqual(buttons.map((b) => b.state['aria-pressed']), ['false', 'true']);
  assert.deepEqual(opened, [[nodes['ai-devices-links-pane'], 'function']]);
  ctx.set('list');
  assert.deepEqual([nodes['ai-devices-list-pane'].hidden, nodes['ai-devices-links-pane'].hidden], [false, true]);
  assert.equal(opened.length, 1, 'the list pane does not open the evidence pane');
  ctx.set(null);
  assert.equal(nodes['ai-devices-list-pane'].hidden, false, 'null keeps the pane last open');
  ctx.window.DeviceLinks = undefined; ctx.set('links');
  assert.match(nodes['ai-devices-links-pane'].innerHTML, /did not load \(device_links\.js\)/);
});

test('without the devices data the tab still draws from the CSV, with the card relabelled as rows', () => {
  const f = family();
  const counts = { total: 11, pathwayCounts: { '510(k)': 8, 'De Novo': 1, PMA: 2, Other: 0 } };
  const stats = (units, deviceLinks = D) => {
    const ctx = { window: { DeviceLinks: deviceLinks } };
    vm.runInNewContext(`${slice('function aiDevicesStatsHTML(counts, units) {')}\nthis.html = aiDevicesStatsHTML(${JSON.stringify(counts)}, units);`, Object.assign(ctx, { units }));
    return ctx.html;
  };
  // absent, failed its check, or the module did not load: one card, relabelled, from the CSV
  for (const html of [stats(null), stats({ run: f.run, summary: f.summary }, null)]) {
    const t = text(html);
    assert.match(t, /Rows on FDA's list 11 one row per line of FDA's list; rows can share a submission number, so this is not a count of devices/);
    assert.doesNotMatch(t, /Distinct submissions|Candidate product families/);
    assert.match(t, /510\(k\) Clearances 8 counted by list row · 72\.7% of list rows/);
    assert.match(t, /De Novo Grants 1 counted by list row/); assert.match(t, /PMA Approvals 2 counted by list row/);
  }
  // present and built from the same list: the three units, from the published files
  const withUnits = text(stats({ run: f.run, summary: f.summary }));
  assert.match(withUnits, /Rows on FDA's list 11 .* Distinct submissions 8 .* Candidate product families: grouped by rule, none curated 7 /);
  assert.match(withUnits, /510\(k\) Clearances 8 counted by list row/);
  // built from a list of another length: the build does not describe this CSV, so only rows are shown
  const other = clone(f.summary); other.denominators.source_rows.n = 12;
  const mismatch = text(stats({ run: f.run, summary: other }));
  assert.doesNotMatch(mismatch, /Distinct submissions/);
  assert.match(mismatch, /built from a list of 12 rows and this page's list has 11, so only the row count is shown/);
  assert.doesNotMatch(app, /Authorized AI\/ML Devices/, 'the row count is no longer called devices');
  assert.doesNotMatch(app, /Number of Devices/);
});

test('a failed load of the devices data leaves the unit cards on the CSV and does not throw', async () => {
  const warned = []; const drawn = [];
  const ctx = { console: { warn: (...a) => warned.push(a.join(' ')) }, outcomesFetchJSON: () => {},
    window: { DeviceLinks: { loadHead: () => Promise.reject(new Error('HTTP 404')) } } };
  vm.runInNewContext(`let aiDeviceUnits = null;\nfunction renderAIDevicesStats() { drawn.push(aiDeviceUnits); }\n${slice('async function loadAIDeviceUnits() {')}\nthis.load = loadAIDeviceUnits;`, Object.assign(ctx, { drawn }));
  await ctx.load();
  assert.deepEqual(drawn, [null]); assert.match(warned[0], /HTTP 404/);
  ctx.window.DeviceLinks.loadHead = () => Promise.resolve({ run: { run_id: 'r' }, summary: { run_id: 'r' }, current: () => {} });
  await ctx.load();
  assert.deepEqual(clone(drawn[1]), { run: { run_id: 'r' }, summary: { run_id: 'r' } });
});

// ---------------------------------------------------------------- the published data

const DIR = 'data/devices/';
const published = existsSync(at(DIR + 'run.json'));
const FAMILY = ['documents.json', 'evidence.json', 'evidence_set_aside.json', 'families.json', 'run.json', 'submissions.json', 'summary.json'];
const PRIVATE_KEY = /reviewer|model|prompt|raw_?response|email|token|api_?key|local_pdf_path/i;
function privateKeys(value, path = '') {
  if (Array.isArray(value)) return value.flatMap((v, i) => privateKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => (PRIVATE_KEY.test(k) ? [`${path}.${k}`] : []).concat(privateKeys(v, `${path}.${k}`)));
  }
  return [];
}

test('the published family is one build whose files match the sha256 in run.json', { skip: !published && 'data/devices/ is not published' }, () => {
  assert.deepEqual(readdirSync(at(DIR)).sort(), FAMILY, 'only the artifact family may be in data/devices/');
  const load = (name) => JSON.parse(read(DIR + name));
  const run = load('run.json');
  assert.deepEqual(Object.keys(run.files).sort(), FAMILY.filter((n) => n !== 'run.json'));
  for (const [name, digest] of Object.entries(run.files)) {
    assert.equal(createHash('sha256').update(readFileSync(at(DIR + name))).digest('hex'), digest, `${name} differs from run.json`);
  }
  const f = { run, summary: load('summary.json'), submissions: load('submissions.json'), families: load('families.json'),
    evidence: load('evidence.json'), setAside: load('evidence_set_aside.json'), documents: load('documents.json') };
  assert.equal(D.dataProblem(f.run, f.summary, parts(f)), null);
  assert.match(run.run_id, /-[0-9a-f]{8}$/, 'the run id ends with a digest of the build\'s files');
  assert.equal(run.scheduled, false);
  // rows and records are the units the summary counts; nothing is recounted here beyond lengths
  const n = (key) => f.summary.denominators[key].n;
  assert.equal(f.submissions.submissions.length, n('submissions'));
  assert.equal(Object.keys(f.families.families).length, n('families'));
  assert.equal(f.evidence.records.length + f.setAside.records.length, n('evidence_records'));
  assert.deepEqual(run.records, { 'evidence.json': f.evidence.records.length, 'evidence_set_aside.json': f.setAside.records.length });
  // nothing private or machine-local reaches a published file, and no source URL carries a query string
  assert.deepEqual(FAMILY.flatMap((name) => privateKeys(load(name), name)), []);
  assert.doesNotMatch(JSON.stringify(run), /https?:\/\/[^\s"]*\?/);
  for (const list of Object.values(f.documents.documents)) for (const d of list) assert.match(d.url, /^https:\/\/www\.accessdata\.fda\.gov\/[^?#\s]*$/, d.document_id);
});

test('the published list rows equal the CSV the tab draws, so the three units are shown', { skip: !published && 'data/devices/ is not published' }, () => {
  const summary = JSON.parse(read(DIR + 'summary.json'));
  // counted as the tab counts them: by app.js's own CSV reader (a quoted cell can hold a line break)
  const ctx = { text: read('data/ai-ml-enabled-devices-enriched.csv') };
  vm.runInNewContext(`${slice('function parseCSV(text) {')}\nthis.rows = parseCSV(text).length;`, ctx);
  assert.equal(summary.denominators.source_rows.n, ctx.rows, 'the build was made from a list with another number of rows than the CSV on this site');
});
