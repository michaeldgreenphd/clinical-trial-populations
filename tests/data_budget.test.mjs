/**
 * The startup data budget: the committed data/demographics.partN.json.gz
 * stay within tests/data_budget.json, and so do the class files of any split
 * dataset folder (its studies_tab parts and detail shards, within classes).
 * The engine's weekly publish checks the same ceilings before it pushes; this
 * test is the alarm on the site side, after a push is already live. It reads
 * file sizes, and the header of each folder's core part 1 (its first bytes
 * only), which says whether the folder is split and how many files it has.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { gunzipSync, gzipSync, constants } from 'node:zlib';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';

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
        const ctx = vm.createContext({ NEWEST_PUBLISHED: null });   // no history.json: the dates are archives
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
// Core part 1's header says whether a folder is split: a layout key gives the
// studies_tab part count (layout.studies_tab.files) and the shard count
// (layout.detail.shards), and the folder must hold exactly those files, 1 to
// files and 0 to shards - 1. A folder with no layout is inline: the reader
// never reads class files there. Sizes only, beside that header.

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

// The header of a gzipped core part: its keys before data (the engine writes
// them first), read from the first 64 KB of the file (prefix); the whole file
// (whole()) only when data comes first. null when it is not gzipped JSON with
// a header.
function headerOf(prefix, whole) {
    try {
        const text = gunzipSync(prefix, { finishFlush: constants.Z_SYNC_FLUSH }).toString('utf8');
        const at = text.indexOf('"data"');
        if (at > 0 && text.slice(0, at).trim() !== '{') return JSON.parse(`${text.slice(0, at).replace(/,\s*$/, '')}}`);
        const { data, ...rest } = JSON.parse(gunzipSync(whole()).toString('utf8'));
        return data === undefined ? null : rest;
    } catch (e) {
        return null;
    }
}

function partHeader(url) {
    const fd = openSync(url);
    const head = Buffer.alloc(65536);
    const n = readSync(fd, head, 0, head.length, 0);
    closeSync(fd);
    return headerOf(head.subarray(0, n), () => readFileSync(url));
}

// What breaks the budget or the file set in one folder's class files, given
// its core part 1's layout (null: inline) and its listing as
// { studies_tab: [{ name, size }], detail: [{ name, size }] }.
function classFileFailures(folder, layout, listing, partCount, classes) {
    const failures = [];
    const tab = listing.studies_tab;
    const shards = listing.detail;
    if (!layout) return failures;   // inline: the reader reads no class files here
    const files = layout.studies_tab?.files;
    const count = layout.detail?.shards;
    if (files !== partCount) failures.push(`${folder}: its layout gives ${files} studies_tab parts, not one per core part (${partCount})`);
    if (!Number.isInteger(count) || count < 1) {
        failures.push(`${folder}: its layout gives no shard count (${JSON.stringify(count)})`);
        return failures;
    }
    const names = tab.map((f) => f.name).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    const expected = Array.from({ length: Number.isInteger(files) ? files : partCount }, (_, i) => `studies_tab.part${i + 1}.json.gz`);
    if (names.join() !== expected.join()) failures.push(`${folder}: studies_tab parts ${names.join(', ') || 'none'}, not parts 1 to ${expected.length}`);
    const numbers = shards.map((f) => (/^\d+\.json\.gz$/.test(f.name) ? Number(f.name.split('.')[0]) : NaN));
    if (numbers.some(Number.isNaN)) failures.push(`${folder}/detail holds files that are not shards: ${shards.filter((f, i) => Number.isNaN(numbers[i])).map((f) => f.name).join(', ')}`);
    const held = numbers.filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    if (held.length !== count || held.some((n, i) => n !== i)) {
        const missing = Array.from({ length: count }, (_, n) => n).filter((n) => !held.includes(n));
        const extra = held.filter((n) => n >= count);
        failures.push(`${folder}/detail does not hold shards 0 to ${count - 1}, as its layout says` +
            `${missing.length ? `: ${missing.length} missing (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''})` : ''}` +
            `${extra.length ? `; beyond the count: ${extra.slice(0, 5).join(', ')}` : ''}`);
    }
    if (!classes) return failures;
    for (const [klass, list] of [['studies_tab', tab], ['detail', shards]]) {
        const b = classes[klass];
        const over = list.filter((f) => f.size > b.file_gzip_max_bytes);
        if (over.length) failures.push(`${folder}: ${klass} files over ${MB(b.file_gzip_max_bytes)}: ${over.map((f) => `${f.name} ${MB(f.size)}`).join(', ')}`);
        const total = list.reduce((a, f) => a + f.size, 0);
        if (total > b.total_gzip_max_bytes) failures.push(`${folder}: ${klass} files total ${MB(total)}, over the ${MB(b.total_gzip_max_bytes)} ceiling`);
    }
    return failures;
}

test('the class-file check catches a missing part, a gap or a cut in the shards, and files over budget', () => {
    const classes = budget.classes;
    const layout = { version: 1, studies_tab: { files: 8 }, detail: { shards: 256, key: 'nct_number_mod' } };
    const tab = (sizes) => sizes.map((size, i) => ({ name: `studies_tab.part${i + 1}.json.gz`, size }));
    const shards = (sizes) => sizes.map((size, i) => ({ name: `${i}.json.gz`, size }));
    const ok = { studies_tab: tab(Array(8).fill(3_000_000)), detail: shards(Array(256).fill(240_000)) };
    const none = { studies_tab: [], detail: [] };
    assert.deepEqual(classFileFailures('data', layout, ok, 8, classes), []);
    assert.deepEqual(classFileFailures('data', null, none, 8, classes), [], 'an inline folder failed');
    assert.deepEqual(classFileFailures('data', { ...layout, detail: { ...layout.detail, shards: 128 } }, { ...ok, detail: ok.detail.slice(0, 128) }, 8, classes), [],
        'a folder with the shard count its header gives failed');
    const cases = {
        'a missing studies_tab part': [layout, { ...ok, studies_tab: ok.studies_tab.slice(1) }, /studies_tab parts/],
        'a gap in the shards': [layout, { ...ok, detail: ok.detail.filter((f) => f.name !== '17.json.gz') }, /does not hold shards 0 to 255.*1 missing \(17\)/],
        'a stray file in detail/': [layout, { ...ok, detail: [...ok.detail, { name: 'index.json', size: 10 }] }, /not shards: index\.json/],
        'a shard over its ceiling': [layout, { ...ok, detail: ok.detail.map((f, i) => (i === 80 ? { ...f, size: classes.detail.file_gzip_max_bytes + 1 } : f)) }, /detail files over .*80\.json\.gz/],
        'extras over their total': [layout, { ...ok, studies_tab: tab(Array(8).fill(3_599_000)) }, /studies_tab files total .* over the/],
        'shards over their total': [layout, { ...ok, detail: shards(Array(256).fill(390_000)) }, /detail files total .* over the/],
        // A split header with no class files at all (a snapshot copied without them).
        'core parts with a layout and no class files': [layout, none, /studies_tab parts none.*|does not hold shards 0 to 255: 256 missing/],
        'the last shard cut off': [layout, { ...ok, detail: ok.detail.slice(0, 255) }, /does not hold shards 0 to 255.*1 missing \(255\)/],
        'half the shards the header gives': [layout, { ...ok, detail: ok.detail.slice(0, 128) }, /does not hold shards 0 to 255.*128 missing/],
        'shards beyond the count': [{ ...layout, detail: { ...layout.detail, shards: 128 } }, ok, /beyond the count: 128/],
        'a layout with no shard count': [{ ...layout, detail: { key: 'nct_number_mod' } }, ok, /no shard count/],
        'a layout with another part count': [{ ...layout, studies_tab: { files: 4 } }, ok, /gives 4 studies_tab parts, not one per core part/]
    };
    for (const [name, [given, listing, message]] of Object.entries(cases)) {
        const found = classFileFailures('data', given, listing, 8, classes);
        assert.ok(found.some((f) => message.test(f)), `${name} was not caught: ${found.join('; ') || 'no failure'}`);
    }
    const bare = classFileFailures('data', layout, none, 8, classes);
    assert.ok(bare.some((f) => /studies_tab parts none/.test(f)) && bare.some((f) => /256 missing/.test(f)), 'a split folder with no class files was not caught on both classes');
});

test('the header reader finds the layout in the first bytes of a part, and none in an inline one', () => {
    const header = (body) => {
        const file = gzipSync(Buffer.from(JSON.stringify(body)));
        return headerOf(file.subarray(0, 65536), () => file);
    };
    const layout = { version: 1, studies_tab: { files: 8 }, detail: { shards: 256, key: 'nct_number_mod' } };
    const rows = Array.from({ length: 3000 }, (_, i) => ({ nct_id: `NCT${i}`, brief_title: randomBytes(48).toString('hex') }));
    assert.ok(gzipSync(Buffer.from(JSON.stringify(rows))).length > 65536, 'the test part fits in the first 64 KB');
    assert.deepEqual(header({ extracted_at: 'a', part: 1, total_parts: 8, layout, data: rows }), { extracted_at: 'a', part: 1, total_parts: 8, layout });
    assert.deepEqual(header({ extracted_at: 'a', part: 1, total_parts: 8, data: rows }), { extracted_at: 'a', part: 1, total_parts: 8 });
    assert.deepEqual(header({ data: rows, extracted_at: 'a', layout }), { extracted_at: 'a', layout }, 'a header after its data was not read');
    assert.equal(headerOf(Buffer.from('not gzip'), () => Buffer.from('not gzip')), null);
    // Today's files: each folder's part 1 header, read this way, carries its stamps.
    for (const folder of ['data', ...readdirSync(new URL('snapshots/', root)).map((d) => `snapshots/${d}`)]) {
        const part1 = new URL(`${folder}/demographics.part1.json.gz`, root);
        if (!existsSync(part1)) continue;
        const h = partHeader(part1);
        assert.ok(h && typeof h.extracted_at === 'string' && h.part === 1, `${folder}: part 1's header was not read (${JSON.stringify(h)})`);
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
        const part1 = new URL('demographics.part1.json.gz', at);
        const header = existsSync(part1) ? partHeader(part1) : null;
        if (existsSync(part1) && !header) failures.push(`${folder}/demographics.part1.json.gz has no header the reader can read`);
        const layout = header?.layout ?? null;
        if (layout) split++;
        else if (tab.length || detail.length) t.diagnostic(`${folder} is inline but holds ${tab.length} studies_tab parts and ${detail.length} detail files the reader never reads`);
        failures.push(...classFileFailures(folder, layout, { studies_tab: tab, detail }, budget.part_count, budget.classes));
    }
    t.diagnostic(`${split} of ${folders.length} dataset folders are split`);
    assert.deepEqual(failures, [], `class files out of budget or incomplete:\n${failures.join('\n')}`);
});
