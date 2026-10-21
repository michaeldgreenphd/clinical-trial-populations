import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localReferenceProblems } from './docs_references.mjs';

function fixture(t, content) {
  const repo = mkdtempSync(join(tmpdir(), 'civicsample-doc-links-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, 'tests'));
  writeFileSync(join(repo, 'tests/record_contract.json'), '{}');
  writeFileSync(join(repo, 'verify.md'), content);
  return repo;
}

test('verify guide links resolve while URLs, anchors and fenced examples are excluded', (t) => {
  const repo = fixture(t, '[contract](tests/record_contract.json#layout)\n' +
    '[remote](https://example.invalid/missing) [section](#setup)\n' +
    '```markdown\n[placeholder](missing.json)\n```\n');
  assert.deepEqual(localReferenceProblems(repo, ['verify.md']), []);
});

test('a broken verify.md reference is reported with its document and target', (t) => {
  const repo = fixture(t, '[contract](tests/missing_contract.json)');
  assert.deepEqual(localReferenceProblems(repo, ['verify.md']), [
    'verify.md: missing or wrong-case local reference: tests/missing_contract.json',
  ]);
});

test('reference case must match even on a case-insensitive filesystem', (t) => {
  const repo = fixture(t, '[contract](tests/Record_contract.json)');
  assert.equal(localReferenceProblems(repo, ['verify.md']).length, 1);
});
