/**
 * The study-record contract: tests/record_contract.json lists every field
 * of a study record the site reads, and the weekly engine publish refuses
 * to push parts that drop one. These tests keep the contract honest in both
 * directions:
 *
 *  - app.js reads no record field the contract leaves out (so a new read
 *    has to be added to the contract, where the engine will see it), and
 *    the contract lists no field app.js never reads;
 *  - every published record carries every listed path, in the files the
 *    dataset's layout gives its class: all of them on the parts of an inline
 *    dataset; core on the parts, studies_tab in the studies_tab part aligned
 *    with each core part, and detail in each study's shard for a split one
 *    (the contract's layout section). An in-memory split dataset
 *    (tests/split_fixture.mjs) runs the split branch before any split data
 *    is published.
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
import { dataset, fullRecord } from './split_fixture.mjs';

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

// ── Which class a read needs ──
// A split dataset's parts carry the core class alone (the layout section);
// the studies_tab and detail classes arrive later, and only the views below
// wait for them: each draws a record with what its dataset has loaded laid
// over it (app.js studyView) and says where a class stands until it arrives.
// Everything else in app.js (the filters, the charts, the table's sort and
// search, share links, the approval queue) runs over the records as loaded,
// so a field it reads must be core, or the split would quietly empty it.
const CLASS_AWARE = ['breakdownHtml', 'deriveFundingSource', 'pubLabel', 'publicationsHtml', 'renderDemographicCell',
    'renderPublications', 'renderPublicationsDetail', 'renderStudySites', 'studyDetailsHtml'];
// The entry points that hand those renderers a record from studyView.
const CLASS_VIEWS = ['renderStudiesTable', 'showStudyDetails', 'showBreakdown', 'showPublications', 'showGeographyBreakdown'];

// app.js's top-level functions: { name, start, end } (a body ends at the
// first closing brace in column 0).
function topLevelFunctions(source) {
    return [...source.matchAll(/^(?:async )?function (\w+)\s*\(/gm)].map((m) => ({ name: m[1], start: m.index, end: source.indexOf('\n}\n', m.index) + 3 }));
}

// The class a chain of member names off a record needs: the class of the
// longest listed path it reaches; for an object or list read whole, core
// when any of its paths is core (what is read from it then is the reader's
// business), else the class of its paths. null for a field that is not a
// record field, or one the contract does not list (the test above says so).
const leafClass = new Map([
    ...Object.entries(classes).flatMap(([klass, paths]) => paths.map((p) => [p.replaceAll('[]', ''), klass])),
    ...Object.entries(contract.layout.optional_class).map(([p, klass]) => [p.replaceAll('[]', ''), klass])
]);
function readClass(chain) {
    if (notRecord.has(chain[0])) return null;
    for (let k = chain.length; k >= 1; k--) {
        const path = chain.slice(0, k).join('.');
        if (leafClass.has(path)) return leafClass.get(path);
    }
    for (let k = chain.length; k >= 1; k--) {
        const path = chain.slice(0, k).join('.');
        const under = [...leafClass].filter(([p]) => p.startsWith(`${path}.`)).map(([, klass]) => klass);
        if (under.length) return under.includes('core') ? 'core' : under[0];
    }
    return null;
}

test('every record field read outside the views that wait for their class is core', () => {
    const fns = topLevelFunctions(app);
    for (const name of [...CLASS_AWARE, ...CLASS_VIEWS]) assert.ok(fns.some((f) => f.name === name), `app.js lost ${name}; update this test`);
    // app.js with the class-aware renderers' bodies taken out.
    let rest = app;
    for (const f of fns.filter((x) => CLASS_AWARE.includes(x.name)).sort((a, b) => b.start - a.start)) rest = rest.slice(0, f.start) + rest.slice(f.end);
    const needs = [];
    for (const chain of recordReads(rest)) {
        const klass = readClass(chain);
        if (klass && klass !== 'core') needs.push(`${chain.join('.')} (${klass})`);
    }
    // The table sorts every row by its data-sort key.
    const table = html.slice(html.indexOf('class="studies-table'), html.indexOf('</thead>', html.indexOf('class="studies-table')));
    for (const m of table.matchAll(/data-sort="([^"]+)"/g)) {
        const klass = readClass([m[1]]);
        if (klass !== 'core') needs.push(`sort key ${m[1]} (${klass})`);
    }
    // List items read through their item names.
    for (const [listPath, names] of Object.entries(contract.item_names)) {
        for (const name of names) {
            for (const m of rest.matchAll(new RegExp(`\\b${name}\\??\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g'))) {
                const klass = readClass([...listPath.split('.'), m[1]]);
                if (klass && klass !== 'core') needs.push(`${name}.${m[1]} as ${listPath}[].${m[1]} (${klass})`);
            }
        }
    }
    assert.deepEqual([...new Set(needs)].sort(), [],
        'app.js reads these fields over records as loaded, where a split dataset carries the core class alone. ' +
        'Class each core in tests/record_contract.json, or read it in a view that waits for its class (studyView).');
});

test('the class-aware renderers are called only from the views that lay a record\'s loaded classes over it', () => {
    const fns = topLevelFunctions(app);
    const owner = (at) => fns.find((f) => f.start <= at && at < f.end)?.name ?? '(top level)';
    const callers = [];
    for (const name of CLASS_AWARE) {
        for (const m of app.matchAll(new RegExp(`(?<!function )\\b${name}\\(`, 'g'))) {
            const from = owner(m.index);
            if (![...CLASS_AWARE, ...CLASS_VIEWS].includes(from)) callers.push(`${name} from ${from}`);
        }
    }
    assert.deepEqual(callers, [], 'a class-aware renderer is called on a record no view has laid its loaded classes over');
    for (const name of CLASS_VIEWS) {
        const f = fns.find((x) => x.name === name);
        assert.match(app.slice(f.start, f.end), /\bstudyView\(/, `${name} hands out a record without its loaded classes`);
    }
});

test('the class check reads the contract as the split does', () => {
    assert.equal(readClass(['results_date']), 'core');
    assert.equal(readClass(['results_date', 'substring']), 'core');
    assert.equal(readClass(['race', 'reported']), 'core');
    assert.equal(readClass(['race', 'raw_categories']), 'studies_tab');
    assert.equal(readClass(['references', 'length']), 'studies_tab');
    assert.equal(readClass(['study_sites']), 'core', 'study_sites carries its countries in core');
    assert.equal(readClass(['collaborators']), 'detail');
    assert.equal(readClass(['official_title']), 'core');
    assert.equal(readClass(['_isAI']), null);
});

// The fields of one list's items, by the list's full path:
// 'race.raw_categories' -> omb_category, confidence, original, flags (+ optional category).
function itemFields(listPath) {
    const prefix = `${listPath}[].`;
    return new Set(readPaths.filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('.'))
        .map((p) => p.slice(prefix.length)));
}

test('members read through a list item variable are listed on every list it serves', () => {
    const lists = {};                                   // variable name -> the list paths it serves
    for (const [listPath, names] of Object.entries(contract.item_names)) {
        assert.ok(itemFields(listPath).size > 0, `item_names names ${listPath}, which no contract path lists items of`);
        for (const name of names) (lists[name] ||= []).push(listPath);
    }
    const unlisted = [];
    for (const [name, listPaths] of Object.entries(lists)) {
        const reads = [...app.matchAll(new RegExp(`\\b${name}\\??\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g'))].map((m) => m[1]);
        assert.ok(reads.length > 0, `app.js no longer reads list items as ${name}; update item_names`);
        for (const member of new Set(reads)) {
            if (VALUE_MEMBERS.has(member)) continue;
            for (const listPath of listPaths) {
                if (!itemFields(listPath).has(member)) unlisted.push(`${listPath}[].${member} (read as ${name}.${member})`);
            }
        }
    }
    assert.deepEqual(unlisted.sort(), [],
        'app.js reads list-item fields the contract does not list; add each to a class, or to optional if records may lack it');
});

test('the contract lists no field app.js never reads', () => {
    const unread = [...new Set(readPaths.map((p) => p.split('.').at(-1).replace('[]', '')))]
        .filter((name) => !new RegExp(`[.'"\\[]${name}\\b`).test(app));
    assert.deepEqual(unread, [], `listed but never read by app.js: ${unread.join(', ')}`);
});

// Why a dataset's published files break the contract, as a list (empty when
// they keep it). read(path) gives a file of the dataset, parsed, or null when
// there is none. Core part 1's header says how the records are laid out
// (contract.layout): with no layout key every class is on the parts' records
// (inline); with layout version 1 core is on the parts, studies_tab on the
// studies_tab part aligned with each core part, and detail in the shard each
// study's NCT number picks (split). Any other layout fails.
function datasetFailures(read, partCount) {
    const failures = [];
    const fail = (msg) => { if (failures.length < 20) failures.push(msg); };
    const layoutOf = (part) => JSON.stringify(part.layout ?? null);
    const seen = new Set();
    let first = null;
    let layout = null;
    const coreIds = [];
    for (let i = 1; i <= partCount; i++) {
        const file = contract.layout.files.core.replace('{K}', i);
        const part = read(file);
        if (!part) { fail(`${file} is missing`); return failures; }
        for (const key of ['extracted_at', 'pipeline_commit', 'part', 'total_parts', 'data']) if (!(key in part)) fail(`${file} header lost ${key}`);
        if (part.part !== i) fail(`${file} says it is part ${part.part}`);
        if (part.total_parts !== partCount) fail(`${file}: the part count differs from the one app.js fetches`);
        if (!first) {
            // Part 1's stamps are the baseline every file must match, so they
            // must be real: the browser shows extracted_at as "Last updated".
            if (!(typeof part.extracted_at === 'string' && !Number.isNaN(Date.parse(part.extracted_at)))) fail(`${file}: extracted_at is not a timestamp (${JSON.stringify(part.extracted_at)})`);
            if (!/^[0-9a-f]{7,40}$/.test(String(part.pipeline_commit ?? ''))) fail(`${file}: pipeline_commit is not a commit id`);
            first = part;
            layout = part.layout ?? null;
            if (layout !== null && layout.version !== contract.layout.version) { fail(`${file}: layout version ${layout.version} is not one this site reads`); return failures; }
        }
        if (part.extracted_at !== first.extracted_at) fail(`${file} comes from another pull than part 1`);
        if (part.pipeline_commit !== first.pipeline_commit) fail(`${file} comes from another engine run than part 1`);
        if (layoutOf(part) !== layoutOf(first)) fail(`${file}: its layout differs from part 1's`);
        if (!Array.isArray(part.data) || part.data.length === 0) { fail(`${file} has no records`); continue; }
        const paths = layout ? classes.core : allPaths;
        coreIds.push(part.data.map((r) => r.nct_id));
        for (const record of part.data) {
            if (seen.has(record.nct_id)) fail(`${record.nct_id} appears in more than one record (${file})`);
            seen.add(record.nct_id);
            for (const path of paths) {
                const why = missing(record, path);
                if (why) fail(`${file} ${record.nct_id ?? '(no nct_id)'} ${path}: ${why}`);
            }
        }
    }
    if (!layout) return failures;

    // Split: the layout adds up, and each class sits in its own files.
    if (layout.studies_tab?.files !== partCount) fail(`layout.studies_tab.files ${layout.studies_tab?.files} is not total_parts ${partCount}`);
    if (layout.detail?.key !== contract.layout.detail.key) fail(`layout.detail.key ${layout.detail?.key} is not ${contract.layout.detail.key}`);
    const shards = layout.detail?.shards;
    if (!Number.isInteger(shards) || shards < 1) { fail(`layout.detail.shards ${shards} is not a shard count`); return failures; }
    const stamped = (file, body, header) => {
        if (body.extracted_at !== first.extracted_at || body.pipeline_commit !== first.pipeline_commit) fail(`${file} comes from another run than core part 1`);
        for (const [k, v] of Object.entries(header)) if (body[k] !== v) fail(`${file} says ${k} ${JSON.stringify(body[k])}, not ${JSON.stringify(v)}`);
        if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) { fail(`${file}: data is not an object keyed by nct_id`); return false; }
        return true;
    };
    coreIds.forEach((ids, i) => {
        const file = contract.layout.files.studies_tab.replace('{K}', i + 1);
        const body = read(file);
        if (!body) { fail(`${file} is missing`); return; }
        if (!stamped(file, body, { class: 'studies_tab', part: i + 1, total_parts: partCount })) return;
        const keys = Object.keys(body.data);
        if (keys.length !== ids.length || ids.some((id) => !(id in body.data))) fail(`${file} does not hold exactly core part ${i + 1}'s studies`);
        for (const [id, entry] of Object.entries(body.data)) {
            for (const path of classes.studies_tab) {
                const why = missing(entry, path);
                if (why) fail(`${file} ${id} ${path}: ${why}`);
            }
        }
    });
    const placed = new Set();
    for (let n = 0; n < shards; n++) {
        const file = contract.layout.files.detail.replace('{n}', n);
        const body = read(file);
        if (!body) { fail(`${file} is missing`); continue; }
        if (!stamped(file, body, { class: 'detail', shard: n, shards, key: contract.layout.detail.key })) continue;
        for (const [id, entry] of Object.entries(body.data)) {
            if (Number(id.slice(3)) % shards !== n) fail(`${file} holds ${id}, whose shard is ${Number(id.slice(3)) % shards}`);
            if (placed.has(id)) fail(`${id} is in more than one shard`);
            placed.add(id);
            if (!seen.has(id)) fail(`${file} holds ${id}, which no core part has`);
            for (const path of classes.detail) {
                const why = missing(entry, path);
                if (why) fail(`${file} ${id} ${path}: ${why}`);
            }
            // whole_lists come whole: the shard's list replaces the core's.
            for (const list of contract.layout.detail.whole_lists) {
                for (const path of allPaths.filter((p) => p.startsWith(`${list}[].`))) {
                    const why = missing(entry, path);
                    if (why) fail(`${file} ${id} ${path}: ${why} (${list} is written whole)`);
                }
            }
        }
    }
    for (const id of seen) if (!placed.has(id)) fail(`${id} has no entry in its detail shard`);
    return failures;
}

test('every record in every published file carries every contract path, in the files its layout gives it', { timeout: 120000 }, () => {
    // The browser downloads every core part, so every part is read: one at a
    // time, each gunzipped and parsed, then released. The class files of a
    // split dataset are read the same way.
    const read = (path) => {
        const url = new URL(`../data/${path}`, import.meta.url);
        if (!existsSync(url)) return null;
        try {
            return JSON.parse(gunzipSync(readFileSync(url)).toString('utf8'));
        } catch (e) {
            assert.fail(`data/${path} is not gzipped JSON: ${e.message}`);
        }
    };
    const failures = datasetFailures(read, budget.part_count);
    assert.deepEqual(failures, [], `published records break the contract:\n${failures.join('\n')}`);
});

// A dataset in memory, laid out by tests/split_fixture.mjs as the engine's
// split will lay it out, so the split branch above runs before any split
// data is published.
function memory(files, base = 'data') {
    return (path) => (files[`${base}/${path}`] === undefined ? null : JSON.parse(JSON.stringify(files[`${base}/${path}`])));
}
const fixtureRecords = Array.from({ length: 12 }, (_, i) => fullRecord(`NCT0${String(1975376 + i * 7).padStart(7, '0')}`));

test('the fixture records carry every contract path', () => {
    for (const record of fixtureRecords) for (const path of allPaths) assert.equal(missing(record, path), null, `${record.nct_id} ${path}`);
});

test('a split dataset passes only with each class in its own files', () => {
    const files = dataset(fixtureRecords, { parts: 3, shards: 5 });
    assert.ok(Object.keys(files).some((p) => p.startsWith('data/detail/')), 'the fixture did not split');
    assert.deepEqual(datasetFailures(memory(files), 3), []);
    assert.deepEqual(datasetFailures(memory(dataset(fixtureRecords, { parts: 3, layout: false })), 3), [], 'the inline fixture fails');
    // A core part without its layout, or a split dataset read as inline, is caught.
    const core = files['data/demographics.part1.json.gz'];
    assert.ok(!('references' in core.data[0]) && !('allocation' in core.data[0]) && core.data[0].study_sites.every((s) => Object.keys(s).join() === 'country'),
        'the core parts carry more than core');
    const edit = (path, change) => {
        const copy = JSON.parse(JSON.stringify(files));
        change(copy[path]);
        return datasetFailures(memory(copy), 3);
    };
    const first = (body) => Object.values(body.data)[0];
    const firstId = (body) => Object.keys(body.data)[0];
    const n0 = Number(fixtureRecords[0].nct_id.slice(3)) % 5;
    const cases = {
        'a studies_tab entry without its references': ['data/studies_tab.part2.json.gz', (b) => { delete first(b).references; }, /references\[\]\.pmid: no references/],
        'a studies_tab part holding another part\'s studies': ['data/studies_tab.part2.json.gz', (b) => { b.data = { NCT00000001: first(b) }; }, /does not hold exactly core part 2's studies/],
        'a studies_tab part from another run': ['data/studies_tab.part3.json.gz', (b) => { b.extracted_at = '2027-01-01T00:00:00Z'; }, /another run than core part 1/],
        'a detail entry without its sites': [`data/detail/${n0}.json.gz`, (b) => { first(b).study_sites = [{ country: 'Peru' }]; }, /study_sites\[\]\.facility: no facility/],
        'a detail entry whose sites lost their country': [`data/detail/${n0}.json.gz`, (b) => { first(b).study_sites.forEach((x) => delete x.country); }, /written whole/],
        'a study in the wrong shard': [`data/detail/${n0}.json.gz`, (b) => { const id = firstId(b); b.data[`NCT0${String(Number(id.slice(3)) + 1).padStart(7, '0')}`] = first(b); }, /whose shard is/],
        'a shard that says it is another': [`data/detail/${n0}.json.gz`, (b) => { b.shard = n0 + 1; }, /says shard/],
        'a study missing from the shards': [`data/detail/${n0}.json.gz`, (b) => { delete b.data[firstId(b)]; }, /has no entry in its detail shard/],
        'a core part with another layout': ['data/demographics.part2.json.gz', (b) => { b.layout = { ...b.layout, detail: { ...b.layout.detail, shards: 6 } }; }, /layout differs from part 1's/],
        'a layout version this site does not read': ['data/demographics.part1.json.gz', (b) => { b.layout = { ...b.layout, version: 2 }; }, /layout version 2 is not one this site reads/],
        'extras that are not one per part': ['data/demographics.part1.json.gz', (b) => { b.layout = { ...b.layout, studies_tab: { files: 2 } }; }, /studies_tab\.files 2 is not total_parts 3/]
    };
    for (const [name, [path, change, message]] of Object.entries(cases)) {
        const found = edit(path, change);
        assert.ok(found.some((f) => message.test(f)), `${name} was not caught: ${found.join('; ') || 'no failure'}`);
    }
    const gone = JSON.parse(JSON.stringify(files));
    delete gone['data/studies_tab.part2.json.gz'];
    assert.ok(datasetFailures(memory(gone), 3).some((f) => /studies_tab\.part2\.json\.gz is missing/.test(f)));
});

test('the layout section is well formed and places every optional path once', () => {
    const layout = contract.layout;
    assert.equal(layout.version, 1);
    assert.equal(typeof layout.enabled, 'boolean', 'enabled is the switch the engine reads');
    assert.deepEqual(layout.files, { core: 'demographics.part{K}.json.gz', studies_tab: 'studies_tab.part{K}.json.gz', detail: 'detail/{n}.json.gz' });
    assert.equal(layout.files.core.replace('{K}', 1), 'demographics.part1.json.gz', 'the core parts keep their names');
    assert.equal(layout.detail.key, 'nct_number_mod');
    assert.equal(layout.detail.shards, 256, 'the shard count the engine writes is 256 (decision 13a)');
    for (const { nct_id: id, shards, shard } of layout.detail.vectors) {
        assert.equal(Number(id.slice(3)) % shards, shard, `the vector ${id} at ${shards} does not follow n = Number(nct_id.slice(3)) % shards`);
    }
    const distinguishes = layout.detail.vectors.filter((v) => v.nct_id === 'NCT01174160').map((v) => v.shard);
    assert.equal(new Set(distinguishes).size, 2, 'no vector tells 128 shards from 256');
    assert.deepEqual(Object.keys(layout.optional_class).sort(), [...optional].sort(), 'optional_class does not place exactly the optional paths');
    for (const [path, klass] of Object.entries(layout.optional_class)) {
        assert.ok(klass in classes, `${path} rides with ${klass}, which is not a class`);
        const container = path.split('.').slice(0, -1).join('.');
        if (container) {
            assert.ok(classes[klass].some((p) => p.startsWith(`${container}.`)), `${path} rides with ${klass}, but no ${klass} path shares its container`);
        }
    }
    for (const list of layout.detail.whole_lists) {
        assert.ok(classes.detail.some((p) => p.startsWith(`${list}[].`)), `${list} is written whole in the shards but has no detail paths`);
    }
    for (const [file, keys] of Object.entries(layout.headers)) {
        assert.ok(keys.includes('data'), `${file} header has no data`);
        assert.ok(keys.includes(file === 'archive' ? 'source_extracted_at' : 'extracted_at'), `${file} header carries no run stamp`);
    }
    assert.ok(classes.detail.includes('status') && classes.detail.includes('why_stopped'), 'status and why_stopped are read only by the pop-up (15a)');
});

test('the layout section says what the split spec says, word for word', () => {
    // The engine's split and publish gate read this section, and app.js's
    // reader checks the same keys and vectors: a change here is a change to
    // the spec both repositories follow (layout version 1), not a local edit.
    const layout = contract.layout;
    assert.deepEqual(layout.headers, {
        core: ['extracted_at', 'pipeline_commit', 'part', 'total_parts', 'layout', 'data'],
        studies_tab: ['extracted_at', 'pipeline_commit', 'class', 'part', 'total_parts', 'data'],
        detail: ['extracted_at', 'pipeline_commit', 'class', 'shard', 'shards', 'key', 'data'],
        archive: ['source_extracted_at', 'source_pipeline_commit', 'class', 'data']
    });
    assert.deepEqual(layout.detail.vectors, [
        { nct_id: 'NCT01975376', shards: 256, shard: 80 },
        { nct_id: 'NCT01975376', shards: 128, shard: 80 },
        { nct_id: 'NCT00663858', shards: 256, shard: 50 },
        { nct_id: 'NCT00663858', shards: 128, shard: 50 },
        { nct_id: 'NCT01174160', shards: 256, shard: 144 },
        { nct_id: 'NCT01174160', shards: 128, shard: 16 }
    ]);
    assert.deepEqual(layout.optional_class, {
        official_title: 'core',
        'references[].title': 'studies_tab',
        'references[].journal': 'studies_tab',
        'race.raw_categories[].category': 'studies_tab',
        'ethnicity.raw_categories[].category': 'studies_tab',
        'sex.raw_categories[].omb_category': 'studies_tab',
        'gender.raw_categories[].omb_category': 'studies_tab'
    });
    assert.deepEqual(layout.detail.whole_lists, ['study_sites', 'collaborators']);
    assert.deepEqual(layout.archive, { file: 'archive_records.json.gz', class: 'archive', listed_in: 'history.json archives.<date>.detail' });
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
