/**
 * The address names the dataset on screen (owner decision 4a, 2026-10-07).
 *
 * A snapshot link carries ?sgsnapshot=<date>, in the query or in the hash
 * (the routing stubs move the query there), and a reload reads the query
 * first. Two paths left the address on a dataset that was no longer shown:
 *
 *  - The Industry tab. updateShareUrl returned before it took sgsnapshot out
 *    of the query there, and updateIndustryShareUrl rewrote only the hash, so
 *    a reader who opened ?sgsnapshot=2026-08-02, went to Industry and chose
 *    Latest kept the archive in the address, and a reload reopened it. The
 *    other way, a snapshot chosen on Industry never reached the address.
 *  - A link whose snapshot gave way to the latest data at start-up (a date
 *    history.json does not list, a malformed one, or a listed one that did
 *    not load: loadStartupDataset, PR #256) kept its ?sgsnapshot=, so a
 *    reload asked for it again.
 *
 * After every switch and every fallback, on every tab, the address now says
 * sgsnapshot=<date> for a snapshot and nothing for the latest data, and keeps
 * every other parameter, the route and its filters (Industry's own #industry?
 * parameters, the share filters, sg=v2) as they were. A phone ignores
 * sgsnapshot and its address is left as the link wrote it.
 *
 * The real updateShareUrl, updateIndustryShareUrl, applyRouteFromHash, the
 * selector's change handler (initHistorySelector), loadDataAndRender and the
 * start-up's steps from the selector to the deep links run in a vm, over a
 * stub document and a location that history.replaceState rewrites as a
 * browser does. A reload is read the way requestedSnapshot reads the link.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function slice(from, to) {
    const at = app.indexOf(from);
    assert.ok(at >= 0, `app.js lost ${from}`);
    const end = app.indexOf(to, at);
    assert.ok(end > at, `could not find the end of ${from}`);
    return app.slice(at, end);
}
const fnSource = (sig) => slice(sig, '\n}\n') + '\n}\n';
// The start-up's steps from naming the opened snapshot in the selector to
// the deep links: what runs once loadStartupDataset has answered.
const startupTail = (() => {
    const init = slice("document.addEventListener('DOMContentLoaded', async () => {", '\n});\n');
    const from = 'if (opened) selectSnapshotOption(opened);';
    const to = 'labelChartsForA11y();';
    const a = init.indexOf(from);
    assert.ok(a >= 0 && init.indexOf(to, a) > a, 'start-up lost its selector … deep links steps');
    return init.slice(a, init.indexOf(to, a));
})();

const SOURCES = [
    // shareUrlReady, SHARE_FILTERS, updateShareUrl and what sits beside it
    slice('let shareUrlReady = false;', 'function applyShareParams(query)'),
    fnSource('function applyRouteFromHash()'),
    fnSource('function sgQueryParams(hash, search)'),
    "const SG_STORAGE_KEY = 'civicsample.sg';",
    fnSource('function sgShareFlag()'),
    fnSource('function industryActive()'),
    fnSource('function renderIndustryAfterSwitch()'),
    fnSource('function updateIndustryShareUrl()'),
    fnSource('function selectSnapshotOption(date)'),
    fnSource('async function initHistorySelector()'),
    fnSource('async function loadDataAndRender(date)')
].join('\n');

const SCAFFOLD = `
const SG_V2 = false;
let industryData = {};
let industryDemo = 'sex';
let industryCat = { race: 'black_african_american', ethnicity: 'hispanic_latino' };
let industryBenchmark = 'cohort', industryRole = 'any', industryScope = 'top10', industryView = 'heatmap';
let industrySexSpecific = false, industryConditionMode = 'top', industryConditionSelected = new Set();
// The Industry view's drawing ends by writing its address, as renderIndustry does.
function renderIndustry() { if (!industryData) return; updateIndustryShareUrl(); }
const snapshotCache = new Map();
function datasetKey(date) { return date || 'latest'; }
async function fetchHistory() { return { dates: ['2026-02-22', '2026-05-31', '2026-08-02'], latest: '2026-10-04' }; }
function listHistoryDates(select, manifest) {
    for (const d of manifest.dates.slice().reverse()) if (!select.options.some(o => o.value === d)) select.appendChild({ value: d });
}
function servedFromData() { return false; }
async function loadData() {}
async function snapshotStage() {}
async function sgLoad() {}
function datasetLoaded() { return true; }
function datasetStudyCount() { return 1; }
function showSnapshotLoading() {} function hideSnapshotLoading() {}
function syncYearWindow() {} function populateConditionsDropdown() {} function populateCountriesDropdown() {}
function populatePrimaryConditionDropdown() {} function renderDashboard() {} function labelChartsForA11y() {}
function retainSnapshots() {} function showToast() {} function sgRouteHooks() {}
function applyShareParams() {}
function yearWindowRequest() { return { start: 0, end: null }; }
`;

/**
 * search / hash: the address the page has. tab: the tab on screen (its
 * route's tab, as start-up has opened it). snapshot: the dataset on screen
 * (the selector's value; 'latest' for the latest data). mobile: a phone.
 */
function harness({ search = '', hash = '', tab = 'overview', snapshot = 'latest', mobile = false, industry = {} } = {}) {
    const location = { pathname: '/', search, hash };
    const writes = [];
    const history = {
        replaceState(_state, _title, url) {
            const u = new URL(url, 'https://civicsample.com' + location.pathname + location.search + location.hash);
            location.pathname = u.pathname; location.search = u.search; location.hash = u.hash;
            writes.push(url);
        }
    };
    const select = {
        id: 'history-date', value: snapshot, dataset: {}, handlers: [],
        options: [{ value: 'latest' }],
        appendChild(opt) { this.options.push(opt); },
        addEventListener(type, fn) { if (type === 'change') this.handlers.push(fn); }
    };
    if (snapshot !== 'latest') select.options.push({ value: snapshot });
    const section = { classList: { contains: (c) => c === 'active' && tab === 'industry' } };
    const tabButton = (id) => ({
        dataset: { tab: id },
        classList: { contains: (c) => c === 'active' && id === tab },
        click() { throw new Error(`start-up clicked the ${id} tab, which is already on screen in these tests`); }
    });
    const document = {
        getElementById: (id) => (id === 'history-date' ? select : id === 'industry' ? section : null),
        querySelector(sel) {
            if (sel === '.tab.active') return tabButton(tab);
            const m = sel.match(/^\.tab\[data-tab="(.+)"\]$/);
            return m ? tabButton(m[1]) : null;
        },
        createElement: () => ({})
    };
    const ctx = vm.createContext({
        URL, URLSearchParams, Map, Set, Array, Promise, Error, JSON, String,
        console: { log() {}, warn() {}, error() {} },
        location, history, document,
        localStorage: { getItem: () => null, setItem() {} },
        CSS: { escape: (x) => x },
        window: {},
        isMobileDevice: mobile,
        SG_INITIAL_HASH: hash, SG_INITIAL_SEARCH: search
    });
    vm.runInContext(SOURCES + SCAFFOLD, ctx);
    for (const [k, v] of Object.entries(industry)) {
        ctx.__v = v;
        vm.runInContext(`${k} = __v;`, ctx);
    }
    const run = (src) => vm.runInContext(src, ctx);
    return {
        location, writes, select, run,
        address: () => location.pathname + location.search + location.hash,
        // What a reload opens: the date requestedSnapshot reads from the
        // address it is given, query first (null: the latest data).
        reloadOpens() {
            const snap = run(`sgQueryParams(${JSON.stringify(location.hash)}, ${JSON.stringify(location.search)}).get('sgsnapshot')`);
            return snap && /^\d{4}-\d{2}-\d{2}$/.test(snap) ? snap : null;
        },
        // The page up: the selector wired, the share URLs on.
        async ready() {
            await run('initHistorySelector()');
            run('shareUrlReady = true;');
        },
        // The reader picks a dataset in the selector.
        async choose(value) {
            select.value = value;
            await Promise.all(select.handlers.map((fn) => fn()));
        },
        // Start-up once loadStartupDataset answered with `opened` (null: the
        // latest data, after a link's snapshot gave way to it).
        startup(opened) {
            ctx.__opened = opened;
            run(`(() => { const opened = __opened;\n${startupTail}\n})()`);
        }
    };
}

test('choosing Latest on the Industry tab takes the link\'s snapshot out of the address', async () => {
    for (const [search, hash] of [['?sgsnapshot=2026-08-02', '#industry'], ['', '#industry?sgsnapshot=2026-08-02']]) {
        const h = harness({ search, hash, tab: 'industry', snapshot: '2026-08-02' });
        await h.ready();
        await h.choose('latest');
        assert.equal(h.reloadOpens(), null, `${search}${hash}: a reload reopens the archive the reader left (${h.address()})`);
        assert.equal(h.address(), '/#industry');
    }
});

test('a snapshot chosen on the Industry tab is named in the address, and only it', async () => {
    const h = harness({ hash: '#industry', tab: 'industry' });
    await h.ready();
    await h.choose('2026-08-02');
    assert.equal(h.reloadOpens(), '2026-08-02', `the address does not name the snapshot on screen (${h.address()})`);
    assert.equal(h.address(), '/#industry?sgsnapshot=2026-08-02');
    // From one snapshot to another, with the first still in the query, which
    // a reload reads first.
    const g = harness({ search: '?sgsnapshot=2026-08-02', hash: '#industry', tab: 'industry', snapshot: '2026-08-02' });
    await g.ready();
    await g.choose('2026-05-31');
    assert.equal(g.reloadOpens(), '2026-05-31', `a reload opens another snapshot than the one on screen (${g.address()})`);
    assert.equal(g.address(), '/#industry?sgsnapshot=2026-05-31');
});

test('an Industry switch keeps every other parameter, the route and the view\'s own state', async () => {
    const industry = { industryDemo: 'race', industryCat: { race: 'asian', ethnicity: 'hispanic_latino' }, industryView: 'trend' };
    const h = harness({
        search: '?sg=v2&sgsnapshot=2026-08-02&ref=mail', hash: '#industry?demo=race&cat=asian&view=trend',
        tab: 'industry', snapshot: '2026-08-02', industry
    });
    await h.ready();
    await h.choose('latest');
    assert.equal(h.address(), '/?sg=v2&ref=mail#industry?demo=race&cat=asian&view=trend');
    await h.choose('2026-05-31');
    assert.equal(h.address(), '/?sg=v2&ref=mail#industry?demo=race&cat=asian&view=trend&sgsnapshot=2026-05-31');
    assert.equal(h.reloadOpens(), '2026-05-31');
    // Without its sponsor data (a failed load), the view writes nothing, and
    // the switch still moves the address.
    const g = harness({ search: '?sgsnapshot=2026-08-02&ref=mail', hash: '#industry?demo=race&cat=asian', tab: 'industry', snapshot: '2026-08-02', industry: { industryData: null } });
    await g.ready();
    await g.choose('latest');
    assert.equal(g.address(), '/?ref=mail#industry?demo=race&cat=asian');
});

test('another tab\'s switch still writes the snapshot into its route and out of the query', async () => {
    const h = harness({ search: '?sgsnapshot=2026-08-02&ref=mail', hash: '#race', tab: 'race', snapshot: '2026-08-02' });
    await h.ready();
    await h.choose('2026-05-31');
    assert.equal(h.address(), '/?ref=mail#race?sgsnapshot=2026-05-31');
    await h.choose('latest');
    assert.equal(h.address(), '/?ref=mail#race');
});

test('the recovery reload (loadDataAndRender) moves the address with the dataset', async () => {
    const h = harness({ search: '?sgsnapshot=2026-08-02', hash: '#industry', tab: 'industry', snapshot: '2026-08-02' });
    await h.ready();
    await h.run("loadDataAndRender('latest')");
    assert.equal(h.address(), '/#industry');
    const g = harness({ hash: '#sex?ys=2015', tab: 'sex' });
    await g.ready();
    await g.run("loadDataAndRender('2026-05-31')");
    assert.equal(g.reloadOpens(), '2026-05-31', `the address does not name the snapshot on screen (${g.address()})`);
});

test('a link whose snapshot gave way to the latest data leaves the address with it', () => {
    // [search, hash, tab, the address once the latest data is on screen]
    const cases = [
        // unlisted
        ['?sgsnapshot=2026-07-05', '', 'overview', '/'],
        // malformed, with other parameters
        ['?sg=v2&sgsnapshot=2026-7-5&utm_source=x', '', 'overview', '/?sg=v2&utm_source=x'],
        // in the hash, with the share filters and the flag
        ['', '#overview?ys=2015&sgsnapshot=2026-07-05&sg=v2', 'overview', '/#overview?ys=2015&sg=v2'],
        // listed but did not load, on another route
        ['', '#faq?m=sex-gender&sgsnapshot=2026-05-31', 'faq', '/#faq?m=sex-gender'],
        // the Industry route keeps its own parameters
        ['?sgsnapshot=2026-07-05', '#industry?demo=race&cat=asian', 'industry', '/#industry?demo=race&cat=asian'],
        ['', '#industry?demo=race&cat=asian&sgsnapshot=2026-07-05', 'industry', '/#industry?demo=race&cat=asian']
    ];
    for (const [search, hash, tab, want] of cases) {
        const h = harness({ search, hash, tab });
        h.startup(null);
        assert.equal(h.reloadOpens(), null, `${search}${hash}: a reload asks for the snapshot again (${h.address()})`);
        assert.equal(h.address(), want);
    }
});

test('a link whose snapshot opened keeps its address as written', () => {
    for (const [search, hash, tab] of [
        ['?sgsnapshot=2026-08-02', '', 'overview'],
        ['?sg=v2&sgsnapshot=2026-08-02', '#industry?demo=race&cat=asian&sgsnapshot=2026-08-02', 'industry'],
        ['', '#race?sgsnapshot=2026-08-02', 'race']
    ]) {
        const h = harness({ search, hash, tab });
        h.startup('2026-08-02');
        assert.equal(h.reloadOpens(), '2026-08-02');
        assert.equal(h.address(), `/${search}${hash}`);
        assert.deepEqual(h.writes, [], `${search}${hash}: start-up rewrote an address that already named the dataset`);
    }
    // A link with no snapshot is not touched either.
    const g = harness({ hash: '#overview?ys=2015' });
    g.startup(null);
    assert.deepEqual(g.writes, []);
});

test('a phone, which ignores sgsnapshot, keeps the address the link wrote', async () => {
    for (const [search, hash, tab] of [
        ['?sgsnapshot=2026-08-02', '', 'overview'],
        ['', '#overview?sgsnapshot=2026-08-02', 'overview'],
        ['?sgsnapshot=2026-08-02', '#industry?demo=race&cat=asian', 'industry']
    ]) {
        const industry = { industryDemo: 'race', industryCat: { race: 'asian', ethnicity: 'hispanic_latino' } };
        const h = harness({ search, hash, tab, mobile: true, industry });
        h.startup(null);
        assert.deepEqual(h.writes, [], `${search}${hash}: start-up rewrote a phone's address`);
        // On the Industry tab, its own writes leave the query as it was.
        if (tab === 'industry') {
            h.run('shareUrlReady = true; updateIndustryShareUrl(); updateShareUrl();');
            assert.equal(h.address(), `/${search}${hash}`);
        }
    }
});
