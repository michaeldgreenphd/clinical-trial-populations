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
});

test('part_count is the number of parts app.js actually fetches', () => {
    // NUM_PARTS is a declaration; the fetch path calls partFiles(n). Each call
    // must ask for part_count parts, by literal or through NUM_PARTS, or a
    // browser would silently skip parts the budget says exist.
    const app = readFileSync(new URL('app.js', root), 'utf8');
    const declared = app.match(/const NUM_PARTS = (\d+);/);
    assert.ok(declared, 'app.js lost NUM_PARTS');
    assert.equal(Number(declared[1]), budget.part_count, 'part_count differs from app.js NUM_PARTS');
    const calls = [...app.matchAll(/\bpartFiles\(\s*([^)]*?)\s*\)/g)].map((m) => m[1]).filter((arg) => arg !== 'n');
    assert.ok(calls.length > 0, 'app.js no longer builds its part list with partFiles()');
    for (const arg of calls) {
        const n = arg === 'NUM_PARTS' ? Number(declared[1]) : Number(arg);
        assert.equal(n, budget.part_count, `app.js fetches partFiles(${arg}), not the ${budget.part_count} parts the budget names`);
    }
});

test("the budget's notes name GitHub's hard limit, not a CDN's", () => {
    // The parts are served from GitHub Pages. The budget is a budget; the
    // hard per-file limit is GitHub's 100 MiB push limit, which is where the
    // engine's weekly gate blocks.
    const about = budget.about.join(' ');
    assert.doesNotMatch(about, /jsDelivr|CDN/i, 'the notes still cite a CDN limit the site does not depend on');
    assert.match(about, /\b100 MiB\b/, "the notes do not name GitHub's 100 MiB per-file push limit");
});

test('every full snapshot holds exactly the parts app.js asks for', () => {
    // app.js fetches a snapshot with the same partFiles(n) as the latest data,
    // and the snapshots are frozen sets. A part_count that no longer matches
    // them needs a per-snapshot count in the fetch path first, or "View
    // snapshot" would skip parts or ask for ones that do not exist.
    const dirs = readdirSync(new URL('snapshots/', root), { withFileTypes: true }).filter((d) => d.isDirectory());
    const expected = Array.from({ length: budget.part_count }, (_, i) => `demographics.part${i + 1}.json.gz`).join(', ');
    const mismatched = [];
    for (const d of dirs) {
        const parts = readdirSync(new URL(`snapshots/${d.name}/`, root)).filter((f) => /^demographics\.part\d+\.json\.gz$/.test(f))
            .sort((a, b) => Number(a.match(/part(\d+)/)[1]) - Number(b.match(/part(\d+)/)[1]));
        if (parts.length > 0 && parts.join(', ') !== expected) mismatched.push(`${d.name} (${parts.join(', ')})`);
    }
    assert.deepEqual(mismatched, [], `snapshots that do not hold exactly parts 1 to ${budget.part_count}, the parts app.js fetches`);
});

test('the startup parts stay within the budget', (t) => {
    const partNumber = (f) => Number(f.match(/part(\d+)/)[1]);
    const parts = readdirSync(new URL('data/', root)).filter((f) => /^demographics\.part\d+\.json\.gz$/.test(f))
        .sort((a, b) => partNumber(a) - partNumber(b));
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
