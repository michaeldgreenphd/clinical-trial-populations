/**
 * The study-record contract: tests/record_contract.json lists every field
 * of a study record the site reads, and the weekly engine publish refuses
 * to push parts that drop one. These tests keep the contract honest in both
 * directions:
 *
 *  - app.js reads no record field the contract leaves out (so a new read
 *    has to be added to the contract, where the engine will see it), and
 *    the contract lists no field app.js never reads;
 *  - every published part carries every listed path on every record.
 *
 * The app.js side is a source scan of the member chains it reads off a
 * record (`study.`, `fullStudy.`, `ctgov.`, including `?.`): each chain is
 * followed until it reaches a listed field, and a step that is neither a
 * listed field nor a standard method on a value fails (so a new
 * `study.race.new_metric` is caught, not only a new top-level name). The
 * Studies table's sort keys are checked too. List items are read through
 * the variable names in the contract's item_names (`ref` for a reference,
 * `site` for a study site, ...), and every member read through one of those
 * names must be a listed field of that list's items. Other short names
 * (`s.`, `o.`, `c.`) and reads through an ad-hoc local variable are left
 * out: app.js uses those names for other things, and a scan over them
 * would fail on noise.
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
const optional = contract.optional;
const readPaths = [...allPaths, ...optional];
const topLevel = new Set(readPaths.map((p) => p.split(/[.[]/)[0]));
const notRecord = new Set(Object.keys(contract.not_record_fields));

// Contract paths without their list markers: 'race.raw_categories.omb_category'.
const leaves = new Set(readPaths.map((p) => p.replaceAll('[]', '')));
const prefixes = new Set([...leaves].flatMap((p) => p.split('.').slice(1).map((_, i, a) => p.split('.').slice(0, i + 1).join('.'))));
// Methods and properties of the values a record holds (strings, numbers, lists).
const VALUE_MEMBERS = new Set(['length', 'forEach', 'map', 'filter', 'some', 'every', 'find', 'includes', 'reduce',
    'slice', 'join', 'split', 'indexOf', 'sort', 'concat', 'substring', 'toLowerCase', 'toUpperCase', 'trim',
    'startsWith', 'endsWith', 'replace', 'match', 'toLocaleString', 'toString', 'toFixed']);

// The first step of a chain of member names that the contract does not cover, or null.
function uncovered(chain) {
    if (notRecord.has(chain[0])) return null;
    for (let k = 1; k <= chain.length; k++) {
        const path = chain.slice(0, k).join('.');
        if (leaves.has(path)) return null;              // a listed field; what follows works on its value
        if (prefixes.has(path)) continue;                // an object or list the contract reaches into
        if (k > 1 && VALUE_MEMBERS.has(chain[k - 1])) return null;
        return path;
    }
    return null;                                         // the chain stops at an object the contract reaches into
}

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
    for (const p of readPaths) {
        assert.match(p, /^[a-z_]+(\[\])?(\.[a-z_]+(\[\])?)*$/, `malformed path: ${p}`);
        assert.ok(!seen.has(p), `path listed twice: ${p}`);
        seen.add(p);
    }
    for (const name of notRecord) assert.ok(!topLevel.has(name), `${name} is both a record field and not one`);
});

function recordReads(source) {
    const chains = [];
    for (const m of source.matchAll(/\b(?:study|fullStudy|ctgov)((?:\??\.[A-Za-z_][A-Za-z0-9_]*)+)/g)) {
        chains.push(m[1].replaceAll('?.', '.').split('.').filter(Boolean));
    }
    for (const m of source.matchAll(/\b(?:study|fullStudy|ctgov)\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g)) chains.push([m[1]]);
    return chains;
}

test('app.js reads no record field the contract leaves out', () => {
    const chains = recordReads(app);
    const table = html.slice(html.indexOf('class="studies-table'), html.indexOf('</thead>', html.indexOf('class="studies-table')));
    assert.ok(table.length > 0, 'index.html lost the studies table header');
    for (const m of table.matchAll(/data-sort="([^"]+)"/g)) chains.push([m[1]]);
    const unlisted = [...new Set(chains.map(uncovered).filter(Boolean))].sort();
    assert.deepEqual(unlisted, [],
        `app.js reads record fields the contract does not list: ${unlisted.join(', ')}. ` +
        'Add each to tests/record_contract.json under the class that reads it, or to not_record_fields if it is not a record field.');
});

test('the source scan follows nested reads, not only top-level names', () => {
    const flagged = (src) => [...new Set(recordReads(src).map(uncovered).filter(Boolean))];
    assert.deepEqual(flagged('x = study.race.new_metric;'), ['race.new_metric']);
    assert.deepEqual(flagged('x = study?.sex?.totals?.female;'), [], 'a key inside a listed object is the object\'s business');
    assert.deepEqual(flagged('n = fullStudy.secondary_outcomes.length; s = study.results_date.substring(0, 4);'), []);
    assert.deepEqual(flagged('x = ctgov.study_sites.map(f);'), []);
    assert.deepEqual(flagged('x = study.study_sites.facility_count;'), ['study_sites.facility_count']);
    assert.deepEqual(flagged("x = study['keywords'];"), ['keywords']);
    assert.deepEqual(flagged('x = study._isAI;'), []);
});

// The fields of a list's items, wherever the list sits in a record:
// 'raw_categories' -> omb_category, category, confidence, original, flags.
function itemFields(list) {
    return new Set(readPaths.map((p) => p.split('.'))
        .filter((segs) => segs.slice(0, -1).at(-1) === `${list}[]`)
        .map((segs) => segs.at(-1)));
}

test('members read through a list item variable are listed fields of that list', () => {
    const unlisted = [];
    for (const [list, names] of Object.entries(contract.item_names)) {
        const fields = itemFields(list);
        assert.ok(fields.size > 0, `item_names names ${list}, which no contract path lists items of`);
        for (const name of names) {
            const reads = [...app.matchAll(new RegExp(`\\b${name}\\??\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g'))].map((m) => m[1]);
            assert.ok(reads.length > 0, `app.js no longer reads ${list} items as ${name}; update item_names`);
            for (const member of reads) {
                if (!fields.has(member) && !VALUE_MEMBERS.has(member)) unlisted.push(`${list}[].${member} (read as ${name}.${member})`);
            }
        }
    }
    assert.deepEqual([...new Set(unlisted)].sort(), [],
        'app.js reads list-item fields the contract does not list; add each to a class, or to optional if records may lack it');
});

test('the contract lists no field app.js never reads', () => {
    const unread = [...new Set(readPaths.map((p) => p.split('.').at(-1).replace('[]', '')))]
        .filter((name) => !new RegExp(`[.'"\\[]${name}\\b`).test(app));
    assert.deepEqual(unread, [], `listed but never read by app.js: ${unread.join(', ')}`);
});

test('every record in every published part carries every contract path', { timeout: 120000 }, () => {
    // The browser downloads every part, so every part is read: one at a
    // time, each gunzipped and parsed, then released.
    const failures = [];
    const seen = new Set();
    let first = null;           // part 1's stamps only, not its records
    for (let i = 1; i <= budget.part_count; i++) {
        const file = `data/demographics.part${i}.json.gz`;
        assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} is missing`);
        let part;
        try {
            part = JSON.parse(gunzipSync(readFileSync(new URL(`../${file}`, import.meta.url))).toString('utf8'));
        } catch (e) {
            assert.fail(`${file} is not gzipped JSON: ${e.message}`);
        }
        for (const key of ['extracted_at', 'pipeline_commit', 'part', 'total_parts', 'data']) assert.ok(key in part, `${file} header lost ${key}`);
        assert.equal(part.part, i, `${file} says it is part ${part.part}`);
        assert.equal(part.total_parts, budget.part_count, `${file}: the part count differs from the one app.js fetches`);
        first ??= { extracted_at: part.extracted_at, pipeline_commit: part.pipeline_commit };
        assert.equal(part.extracted_at, first.extracted_at, `${file} comes from another pull than part 1`);
        assert.equal(part.pipeline_commit, first.pipeline_commit, `${file} comes from another engine run than part 1`);
        assert.ok(Array.isArray(part.data) && part.data.length > 0, `${file} has no records`);
        for (const record of part.data) {
            if (seen.has(record.nct_id)) failures.push(`${record.nct_id} appears in more than one record (${file})`);
            seen.add(record.nct_id);
            for (const path of allPaths) {
                const why = missing(record, path);
                if (why) failures.push(`${file} ${record.nct_id ?? '(no nct_id)'} ${path}: ${why}`);
            }
            if (failures.length >= 20) break;
        }
        if (failures.length >= 20) break;
    }
    assert.deepEqual(failures, [], `published records break the contract:\n${failures.join('\n')}`);
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
