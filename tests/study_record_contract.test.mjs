/**
 * The study-record contract: tests/record_contract.json lists every field
 * of a study record the site reads, and the weekly engine publish refuses
 * to push parts that drop one. These tests keep the contract honest in both
 * directions:
 *
 *  - app.js reads no record field the contract leaves out (so a new read
 *    has to be added to the contract, where the engine will see it), and
 *    the contract lists no field app.js never reads;
 *  - the published parts carry every listed path on every record.
 *
 * The app.js side is a source scan of the names it reads off a record
 * (`study.`, `fullStudy.`, `ctgov.`, including `?.`) and of the Studies
 * table's sort keys. Short names such as `s.` are left out: app.js uses
 * them for other things too, and a scan over them would fail on noise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const app = read('app.js');
const html = read('index.html');
const contract = JSON.parse(read('tests/record_contract.json'));
const budget = JSON.parse(read('tests/data_budget.json'));

const classes = contract.classes;
const allPaths = Object.values(classes).flat();
const topLevel = new Set(allPaths.map((p) => p.split(/[.[]/)[0]));
const notRecord = new Set(Object.keys(contract.not_record_fields));

// "race.raw_categories[].omb_category" -> [race, raw_categories[], omb_category]
function segments(path) {
    return path.split('.').map((s) => (s.endsWith('[]') ? { key: s.slice(0, -2), each: true } : { key: s, each: false }));
}

// Why `record` fails `path`, or null when every reachable key is present.
function missing(record, path) {
    let level = [record];
    for (const { key, each } of segments(path)) {
        const next = [];
        for (const obj of level) {
            if (obj === null || typeof obj !== 'object' || !(key in obj)) return `no ${key}`;
            const v = obj[key];
            if (each) {
                if (!Array.isArray(v)) return `${key} is not a list`;
                next.push(...v);
            } else {
                next.push(v);
            }
        }
        level = next;
    }
    return null;
}

test('the contract is well formed: each path once, in one class', () => {
    const seen = new Set();
    for (const p of allPaths) {
        assert.match(p, /^[a-z_]+(\[\])?(\.[a-z_]+(\[\])?)*$/, `malformed path: ${p}`);
        assert.ok(!seen.has(p), `path listed twice: ${p}`);
        seen.add(p);
    }
    for (const name of notRecord) assert.ok(!topLevel.has(name), `${name} is both a record field and not one`);
});

test('app.js reads no record field the contract leaves out', () => {
    const reads = new Set();
    for (const m of app.matchAll(/\b(?:study|fullStudy|ctgov)\??\.([A-Za-z_][A-Za-z0-9_]*)/g)) reads.add(m[1]);
    for (const m of app.matchAll(/\b(?:study|fullStudy|ctgov)\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g)) reads.add(m[1]);
    const table = html.slice(html.indexOf('class="studies-table'), html.indexOf('</thead>', html.indexOf('class="studies-table')));
    assert.ok(table.length > 0, 'index.html lost the studies table header');
    for (const m of table.matchAll(/data-sort="([^"]+)"/g)) reads.add(m[1]);
    const unlisted = [...reads].filter((f) => !topLevel.has(f) && !notRecord.has(f)).sort();
    assert.deepEqual(unlisted, [],
        `app.js reads record fields the contract does not list: ${unlisted.join(', ')}. ` +
        'Add each to tests/record_contract.json under the class that reads it, or to not_record_fields if it is not a record field.');
});

test('the contract lists no field app.js never reads', () => {
    const unread = [...new Set(allPaths.map((p) => p.split('.').at(-1).replace('[]', '')))]
        .filter((name) => !new RegExp(`[.'"\\[]${name}\\b`).test(app));
    assert.deepEqual(unread, [], `listed but never read by app.js: ${unread.join(', ')}`);
});

test('every record in the published parts carries every contract path', () => {
    const file = 'data/demographics.part1.json.gz';
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} is missing`);
    const part = JSON.parse(gunzipSync(readFileSync(new URL(`../${file}`, import.meta.url))).toString('utf8'));
    for (const key of ['extracted_at', 'part', 'total_parts', 'data']) assert.ok(key in part, `the part header lost ${key}`);
    assert.equal(part.total_parts, budget.part_count, 'the part count differs from the one app.js fetches');
    assert.ok(Array.isArray(part.data) && part.data.length > 0, 'part 1 has no records');
    const failures = [];
    for (const record of part.data) {
        for (const path of allPaths) {
            const why = missing(record, path);
            if (why) failures.push(`${record.nct_id ?? '(no nct_id)'} ${path}: ${why}`);
        }
        if (failures.length >= 20) break;
    }
    assert.deepEqual(failures, [], `published records are missing contract fields:\n${failures.join('\n')}`);
});

test('the path check itself tells present, empty and absent apart', () => {
    const r = { a: { b: [] }, c: [{ d: null }, { d: 1 }], e: null };
    assert.equal(missing(r, 'a.b'), null);
    assert.equal(missing(r, 'a.b[].x'), null, 'an empty list has nothing to check');
    assert.equal(missing(r, 'c[].d'), null, 'null is a value');
    assert.equal(missing(r, 'e'), null);
    assert.equal(missing(r, 'f'), 'no f');
    assert.equal(missing({ c: [{ d: 1 }, {}] }, 'c[].d'), 'no d');
    assert.equal(missing({ c: {} }, 'c[].d'), 'c is not a list');
});
