/**
 * Wiring tests: the geography perpetuity loop spans two repositories, and the
 * 2026 frontend/backend split broke it silently once already — the advance
 * script was moved to civicsample-engine while four files here went on naming
 * `scripts/geo/advance_run.py`, and the moved copy resolved its write paths
 * against the engine's working tree instead of the site's.
 *
 * Nothing in the acceptance suite could catch that: the rendered output was
 * still correct. These tests guard the loop's plumbing instead of its numbers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');

const ADVANCE = 'scripts/geo/advance_run.py';

test('the advance script the loop depends on lives in this repository', () => {
  assert.ok(existsSync(join(repo, ADVANCE)),
    `${ADVANCE} is missing. It writes data/geo/<run_id>/, data/geo/active_run.json and ` +
    'tests/run_expectations.json — all site paths — so it has to run from a checkout of ' +
    'this repo. See "Which repository owns which step" in data/geo/README.md.');
});

test('every file that names the advance script names a path that exists', () => {
  // The four references the split left dangling, plus anything added since.
  const sources = [
    'data/geo/README.md',
    'data/geo/active_run.json',
    'tests/geo_contract.test.mjs',
    '.github/workflows/geo-contract-tests.yml',
  ];
  const named = new Set();
  for (const src of sources) {
    for (const m of read(src).matchAll(/(?:^|[\s`"'(])((?:scripts|geo|data)\/[\w./-]*advance_run\.py)/g)) {
      named.add(m[1]);
    }
  }
  assert.ok(named.size > 0, 'no file names the advance script — the loop lost its documentation');
  for (const path of named) {
    assert.ok(existsSync(join(repo, path)), `documented path does not exist: ${path}`);
  }
});

test('the advance script resolves its write paths to this repository root', () => {
  // REPO = Path(__file__).resolve().parents[2] only lands on the repo root while
  // the script sits at <root>/scripts/geo/. If it is ever moved deeper or
  // shallower, it silently writes somewhere else.
  const src = read(ADVANCE);
  assert.match(src, /REPO\s*=\s*Path\(__file__\)\.resolve\(\)\.parents\[2\]/,
    'advance_run.py no longer derives REPO the way this test assumes');
  assert.equal(ADVANCE.split('/').length, 3,
    `${ADVANCE} must stay two directories below the repo root for parents[2] to be the root`);
  for (const target of ['data/geo', 'tests']) {
    assert.ok(existsSync(join(repo, target)), `${target}/ must exist for the script to write into`);
  }
});

test('the test workflow runs on every push and pull request, with no path filter', () => {
  // This test used to check that the workflow's trigger globs named directories
  // that exist. The docs wiring suite reads the whole tree, so the workflow now
  // has no path filter at all — a filter is a second inventory that goes stale
  // the way the documents did. Guard that it stays that way, and that the
  // checkout fetches full history for the cache-key base comparison.
  const yml = read('.github/workflows/geo-contract-tests.yml');
  assert.ok(!/^\s+paths(-ignore)?:/m.test(yml),
    'geo-contract-tests.yml has a path filter again; the docs wiring suite needs to run on every change');
  assert.match(yml, /^on:\n\s+push:\n\s+pull_request:/m,
    'geo-contract-tests.yml must trigger on push and pull_request');
  assert.match(yml, /fetch-depth:\s*0/,
    'checkout needs fetch-depth: 0 so the cache-key test can diff against the base branch');
});

test('the pinned run directory holds the contract files the pin names', () => {
  const pin = JSON.parse(read('data/geo/active_run.json'));
  const dir = join(repo, pin.run_dir);
  assert.ok(existsSync(dir), `pinned run_dir does not exist: ${pin.run_dir}`);
  const staged = readdirSync(dir);
  assert.ok(staged.includes(pin.long_table), `pin names long_table ${pin.long_table}, which is not staged`);
  for (const f of ['b1_view_definitions.csv', 'd2_display_rule_vocabulary.csv', 'CONTRACT.md']) {
    assert.ok(staged.includes(f), `contract file missing from the pinned run: ${f}`);
  }
});
