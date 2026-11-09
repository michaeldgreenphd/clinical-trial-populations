/**
 * The published Industry Outcomes data (data/outcomes/).
 *
 * The engine writes this folder by hand (civicsample-engine outcomes/README.md). Only an
 * evidence_only build may be committed: it carries evidence facts and assessments a named person
 * has reviewed, and nothing else. This test runs the page's own reader checks
 * (industry_outcomes.js dataProblem and shardProblem) on the committed files and adds the
 * publication rules the reader cannot see:
 *   - the build is evidence_only and holds no machine-provisional row or record;
 *   - every file the run lists is present with its sha256, and no other file is;
 *   - no key anywhere names a reviewer, ledger, packet, timing or model.
 * Only an absent or empty folder means nothing is published. Any file there requires a valid
 * run.json, and only the artifact family's own names may exist: run.json, summary.json,
 * index.json and the records/rNN.json shards the index points at.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const DIR = 'data/outcomes/';
const at = (p) => new URL(p, root);
const ctx = { globalThis: {} };
vm.runInNewContext(readFileSync(at('industry_outcomes.js'), 'utf8'), ctx);
const O = ctx.globalThis.IndustryOutcomes;
const load = (p) => JSON.parse(readFileSync(at(DIR + p), 'utf8'));

function listFiles(rel) {
  return readdirSync(at(DIR + rel)).flatMap((name) => {
    const p = rel + name;
    return statSync(at(DIR + p)).isDirectory() ? listFiles(p + '/') : [p];
  });
}

const present = existsSync(at(DIR)) ? listFiles('') : [];
const published = present.length > 0;
const FAMILY_FILE = /^(?:run\.json|summary\.json|index\.json|records\/r\d{2}\.json)$/;

const PRIVATE_KEY = /reviewer|ledger|packet|elapsed|minutes|duration|started|finished|model|prompt|raw_?response|rationale_private|email/i;
function privateKeys(value, path = '') {
  if (Array.isArray(value)) return value.flatMap((v, i) => privateKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => (PRIVATE_KEY.test(k) ? [`${path}.${k}`] : []).concat(privateKeys(v, `${path}.${k}`)));
  }
  return [];
}

test('any file under data/outcomes/ needs a run manifest, and only the artifact family may be there', { skip: !published && 'nothing published' }, () => {
  assert.ok(present.includes('run.json'), 'files are present without run.json');
  assert.deepEqual(present.filter((f) => !FAMILY_FILE.test(f)), [], 'files outside the artifact family');
  const run = load('run.json'); const index = load('index.json');
  const shards = [...new Set(index.rows.map((r) => r.record))].sort();
  assert.deepEqual(Object.keys(run.files).sort(), ['index.json', ...shards, 'summary.json'].sort(),
    'run.json must list exactly summary.json, index.json and the shards the index uses');
});

test('the published outcomes data is an evidence_only build the page accepts', { skip: !published && 'nothing published' }, () => {
  const run = load('run.json'); const summary = load('summary.json'); const index = load('index.json');
  assert.equal(run.display_mode, 'evidence_only', 'only an evidence_only build may be published');
  assert.equal(O.dataProblem(run, summary, index), null);
  assert.equal(run.assessments.n_machine_provisional, 0);
  assert.deepEqual(Object.keys(summary.assessment_states.by_kind), ['human_reviewed']);
  for (const r of index.rows) {
    assert.ok([null, 'human_reviewed'].includes(r.assessment_kind ?? null), r.nct_id);
    // A conclusion shows only for an assessment a person reviewed.
    if ((r.assessment_kind ?? null) === null) assert.equal(r.trial_state ?? null, null, `${r.nct_id} has a trial state without a reviewed assessment`);
  }
  const reviewedRows = index.rows.filter((r) => r.assessment_kind === 'human_reviewed').length;
  assert.equal(reviewedRows, run.collections.human_reviewed.n);
  for (const name of Object.keys(run.files).filter((f) => f.startsWith('records/'))) {
    const shard = load(name);
    assert.equal(O.shardProblem(shard, run), null, name);
    for (const [nct, rec] of Object.entries(shard.records)) {
      assert.ok(rec.assessment === null || rec.assessment.assessment_kind === 'human_reviewed', nct);
    }
  }
});

test('the published folder holds exactly the files its run lists, unchanged', { skip: !published && 'nothing published' }, () => {
  const run = load('run.json');
  const listed = Object.keys(run.files).sort();
  assert.deepEqual(listFiles('').filter((f) => f !== 'run.json').sort(), listed);
  for (const [name, sha] of Object.entries(run.files)) {
    assert.equal(createHash('sha256').update(readFileSync(at(DIR + name))).digest('hex'), sha, name);
  }
});

test('no key in the published outcomes data names private review material', { skip: !published && 'nothing published' }, () => {
  for (const f of ['run.json', ...listFiles('').filter((f) => f !== 'run.json')]) {
    assert.deepEqual(privateKeys(load(f)), [], f);
  }
});
