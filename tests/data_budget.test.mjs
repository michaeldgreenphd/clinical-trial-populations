/**
 * The startup data budget: the committed data/demographics.partN.json.gz
 * stay within tests/data_budget.json. The engine's weekly publish checks the
 * same ceilings before it pushes; this test is the alarm on the site side,
 * after a push is already live. It reads file sizes only, no data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const budget = JSON.parse(readFileSync(new URL('tests/data_budget.json', root), 'utf8'));
const MB = (b) => `${(b / 1e6).toFixed(1)} MB`;

test('the budget is well formed', () => {
    for (const k of ['part_count', 'part_gzip_max_bytes', 'total_gzip_max_bytes']) {
        assert.ok(Number.isInteger(budget[k]) && budget[k] > 0, `${k} must be a positive integer`);
    }
    assert.ok(budget.total_gzip_max_bytes <= budget.part_count * budget.part_gzip_max_bytes,
        'the total ceiling is looser than the per-part ceilings allow');
    const app = readFileSync(new URL('app.js', root), 'utf8');
    assert.match(app, new RegExp(`const NUM_PARTS = ${budget.part_count};`), 'part_count differs from app.js NUM_PARTS');
});

test('the startup parts stay within the budget', (t) => {
    const parts = readdirSync(new URL('data/', root)).filter((f) => /^demographics\.part\d+\.json\.gz$/.test(f)).sort();
    assert.deepEqual(parts, Array.from({ length: budget.part_count }, (_, i) => `demographics.part${i + 1}.json.gz`),
        'data/ holds a different set of parts from the one app.js fetches');
    const sizes = parts.map((f) => statSync(new URL(`data/${f}`, root)).size);
    const total = sizes.reduce((a, b) => a + b, 0);
    t.diagnostic(`parts: ${sizes.map(MB).join(', ')}; total ${MB(total)} of ${MB(budget.total_gzip_max_bytes)}`);
    if (total > 0.9 * budget.total_gzip_max_bytes) t.diagnostic('the parts are within 10% of the total ceiling');
    const over = parts.filter((f, i) => sizes[i] > budget.part_gzip_max_bytes);
    assert.deepEqual(over, [], `parts over ${MB(budget.part_gzip_max_bytes)}: ${over.join(', ')}`);
    assert.ok(total <= budget.total_gzip_max_bytes, `the parts total ${MB(total)}, over the ${MB(budget.total_gzip_max_bytes)} ceiling`);
});
