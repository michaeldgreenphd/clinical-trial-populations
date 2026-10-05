/**
 * The startup data budget: the committed data/demographics.partN.json.gz
 * stay within tests/data_budget.json, and so do the class files of any split
 * dataset folder (its studies_tab parts and detail shards, within classes).
 * The engine's weekly publish checks the same ceilings before it pushes; this
 * test is the alarm on the site side, after a push is already live. It reads
 * file sizes only, no data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';

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
    // NUM_PARTS is the one place app.js states the part count, and it must
    // equal part_count, or a browser would silently skip parts the budget
    // says exist. Every partFiles() call passes NUM_PARTS itself: a literal
    // beside it is a second copy that a change to the part count would miss.
    // A call is matched with or without a space before the bracket and as
    // partFiles?.(...); a second NUM_PARTS declaration (a shadowing local)
    // fails too.
    const app = readFileSync(new URL('app.js', root), 'utf8');
    const declared = app.match(/const NUM_PARTS = (\d+);/);
    assert.ok(declared, 'app.js lost NUM_PARTS');
    assert.equal(Number(declared[1]), budget.part_count, 'part_count differs from app.js NUM_PARTS');
    assert.equal(app.match(/\b(?:const|let|var)\s+NUM_PARTS\b/g).length, 1, 'app.js declares NUM_PARTS more than once');
    assert.match(app, /\bfunction partFiles\(n\)/, 'app.js lost the partFiles(n) definition');
    const calls = [...app.matchAll(/(?<!\bfunction\s+)\bpartFiles\s*(?:\?\.\s*)?\(\s*([^)]*?)\s*\)/g)].map((m) => m[1]);
    assert.ok(calls.length > 0, 'app.js no longer builds its part list with partFiles()');
    assert.deepEqual(calls.filter((arg) => arg !== 'NUM_PARTS'), [],
        'app.js builds a part list from a count other than NUM_PARTS');
});

test('getUrlStrategies asks for NUM_PARTS parts, for the latest data and for a snapshot', () => {
    // The fetch path itself, run in a vm: the latest data and a full snapshot
    // each list parts 1 to part_count, from data/ and snapshots/<date>/. A
    // second run with NUM_PARTS changed checks that both lists follow it, so
    // another copy of the count on the fetch path fails here whatever its
    // spelling.
    const app = readFileSync(new URL('app.js', root), 'utf8');
    const start = app.indexOf('const NUM_PARTS =');
    const at = app.indexOf('function getUrlStrategies(date)');
    assert.ok(start >= 0 && at > start, 'app.js lost NUM_PARTS or getUrlStrategies');
    const source = app.slice(start, app.indexOf('\n}\n', at) + 2);
    const run = (src, count, label) => {
        const ctx = vm.createContext({});
        vm.runInContext(`${src}\nthis.getUrlStrategies = getUrlStrategies;`, ctx);
        const files = Array.from({ length: count }, (_, i) => `demographics.part${i + 1}.json.gz`);
        for (const date of [undefined, 'latest']) {
            const strategies = ctx.getUrlStrategies(date);
            assert.equal(strategies.length, 1);
            assert.deepEqual([...strategies[0].urls], files.map((f) => `data/${f}`), `${label}: latest (${date}) lists different parts`);
        }
        const snapshot = ctx.getUrlStrategies('2026-08-02');
        assert.equal(snapshot.length, 1);
        assert.deepEqual([...snapshot[0].urls], files.map((f) => `snapshots/2026-08-02/${f}`), `${label}: a snapshot lists different parts`);
    };
    run(source, budget.part_count, 'as shipped');
    const probe = budget.part_count + 3;
    const changed = source.replace(/^const NUM_PARTS = \d+;/, `const NUM_PARTS = ${probe};`);
    assert.notEqual(changed, source, 'could not change NUM_PARTS for the second run');
    run(changed, probe, `with NUM_PARTS = ${probe}`);
});

test("the budget's notes name GitHub's hard limit, not a CDN's", () => {
    // The parts are served from GitHub Pages. The budget is a budget; the
    // hard per-file limit is GitHub's 100 MiB push limit, which is where the
    // engine's weekly gate blocks on size.
    const about = budget.about.join(' ');
    assert.doesNotMatch(about, /jsDelivr|CDN/i, 'the notes still cite a CDN limit the site does not depend on');
    assert.match(about, /\b100 MiB\b/, "the notes do not name GitHub's 100 MiB per-file push limit");
});

test("the budget's notes say a wrong part count blocks the engine's push", () => {
    // Warn-only applies to size. The engine's gate (check_site_contract.py)
    // fails the push when data/ holds a different set of parts than
    // part_count, so notes that call every rule here warn-only mislead.
    const about = budget.about.join(' ');
    assert.match(about, /part count other than part_count blocks the push/,
        'the notes do not say that a part count other than part_count blocks the push');
    for (const sentence of about.split(/(?<=\.)\s+/).filter((s) => /blocks only/.test(s))) {
        assert.match(sentence, /^For size\b/, `the notes say the gate blocks only at the hard limits without limiting that to size: "${sentence}"`);
    }
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

// ── The class files of a split dataset (tests/record_contract.json, layout) ──
// A split folder holds studies_tab.part1..part_count.json.gz beside its core
// parts and detail/0..N-1.json.gz; an inline folder holds neither. Sizes only.

const CLASS_BUDGET_KEYS = ['file_gzip_max_bytes', 'total_gzip_max_bytes'];

test('the class budgets are well formed', () => {
    const classes = budget.classes;
    if (classes === undefined) return;   // optional: the engine reads it with a default
    assert.deepEqual(Object.keys(classes).sort(), ['detail', 'studies_tab'], 'classes budgets the studies_tab and detail files only');
    for (const [klass, b] of Object.entries(classes)) {
        for (const k of CLASS_BUDGET_KEYS) assert.ok(Number.isInteger(b[k]) && b[k] > 0, `classes.${klass}.${k} must be a positive integer`);
        assert.ok(b.total_gzip_max_bytes >= b.file_gzip_max_bytes, `classes.${klass}: the total is below one file's ceiling`);
    }
});

// What breaks the budget or the file set in one folder's class files, given
// as { studies_tab: [{ name, size }], detail: [{ name, size }] }.
function classFileFailures(folder, listing, partCount, classes) {
    const failures = [];
    const tab = listing.studies_tab;
    const shards = listing.detail;
    if (!tab.length && !shards.length) return failures;   // inline
    const names = tab.map((f) => f.name).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    const expected = Array.from({ length: partCount }, (_, i) => `studies_tab.part${i + 1}.json.gz`);
    if (names.join() !== expected.join()) failures.push(`${folder}: studies_tab parts ${names.join(', ') || 'none'}, not parts 1 to ${partCount}`);
    const numbers = shards.map((f) => (/^\d+\.json\.gz$/.test(f.name) ? Number(f.name.split('.')[0]) : NaN));
    if (numbers.some(Number.isNaN)) failures.push(`${folder}/detail holds files that are not shards: ${shards.filter((f, i) => Number.isNaN(numbers[i])).map((f) => f.name).join(', ')}`);
    const sorted = numbers.filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    if (!sorted.length || sorted.some((n, i) => n !== i)) failures.push(`${folder}/detail does not hold shards 0 to ${sorted.length - 1} without a gap`);
    if (!classes) return failures;
    for (const [klass, files] of [['studies_tab', tab], ['detail', shards]]) {
        const b = classes[klass];
        const over = files.filter((f) => f.size > b.file_gzip_max_bytes);
        if (over.length) failures.push(`${folder}: ${klass} files over ${MB(b.file_gzip_max_bytes)}: ${over.map((f) => `${f.name} ${MB(f.size)}`).join(', ')}`);
        const total = files.reduce((a, f) => a + f.size, 0);
        if (total > b.total_gzip_max_bytes) failures.push(`${folder}: ${klass} files total ${MB(total)}, over the ${MB(b.total_gzip_max_bytes)} ceiling`);
    }
    return failures;
}

test('the class-file check catches a missing part, a gap in the shards, and files over budget', () => {
    const classes = budget.classes;
    const tab = (sizes) => sizes.map((size, i) => ({ name: `studies_tab.part${i + 1}.json.gz`, size }));
    const shards = (sizes) => sizes.map((size, i) => ({ name: `${i}.json.gz`, size }));
    const ok = { studies_tab: tab(Array(8).fill(3_000_000)), detail: shards(Array(256).fill(240_000)) };
    assert.deepEqual(classFileFailures('data', ok, 8, classes), []);
    assert.deepEqual(classFileFailures('data', { studies_tab: [], detail: [] }, 8, classes), [], 'an inline folder failed');
    const cases = {
        'a missing studies_tab part': [{ ...ok, studies_tab: ok.studies_tab.slice(1) }, /studies_tab parts/],
        'a gap in the shards': [{ ...ok, detail: ok.detail.filter((f) => f.name !== '17.json.gz') }, /without a gap/],
        'a stray file in detail/': [{ ...ok, detail: [...ok.detail, { name: 'index.json', size: 10 }] }, /not shards: index\.json/],
        'a shard over its ceiling': [{ ...ok, detail: ok.detail.map((f, i) => (i === 80 ? { ...f, size: classes.detail.file_gzip_max_bytes + 1 } : f)) }, /detail files over .*80\.json\.gz/],
        'extras over their total': [{ ...ok, studies_tab: tab(Array(8).fill(3_599_000)) }, /studies_tab files total .* over the/],
        'shards over their total': [{ ...ok, detail: shards(Array(256).fill(390_000)) }, /detail files total .* over the/]
    };
    for (const [name, [listing, message]] of Object.entries(cases)) {
        const found = classFileFailures('data', listing, 8, classes);
        assert.ok(found.some((f) => message.test(f)), `${name} was not caught: ${found.join('; ') || 'no failure'}`);
    }
});

test('every split folder holds its whole set of class files, within the class budgets', (t) => {
    const folders = ['data', ...readdirSync(new URL('snapshots/', root), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `snapshots/${d.name}`)];
    const failures = [];
    let split = 0;
    for (const folder of folders) {
        const at = new URL(`${folder}/`, root);
        const sized = (dir, name) => ({ name, size: statSync(new URL(name, dir)).size });
        const tab = readdirSync(at).filter((f) => /^studies_tab\.part\d+\.json\.gz$/.test(f)).map((f) => sized(at, f));
        let detail = [];
        try {
            const dir = new URL(`${folder}/detail/`, root);
            detail = readdirSync(dir).map((f) => sized(dir, f));
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }
        if (tab.length || detail.length) split++;
        failures.push(...classFileFailures(folder, { studies_tab: tab, detail }, budget.part_count, budget.classes));
    }
    t.diagnostic(`${split} of ${folders.length} dataset folders are split`);
    assert.deepEqual(failures, [], `class files out of budget or incomplete:\n${failures.join('\n')}`);
});
