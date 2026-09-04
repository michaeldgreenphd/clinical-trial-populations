/**
 * Docs wiring tests: AGENTS.md and CLAUDE.md make factual claims about this
 * repository, and nothing else checks them. AGENTS.md said the geography
 * advance script was "not on `main` yet" for two days after it landed, and the
 * correction that introduced that wording was itself written against a tree
 * the merge had already moved past.
 *
 * These tests assert the claims a test can check: every path the documents
 * name resolves, every identifier they name appears where they say it does,
 * the Pages files they call load-bearing are present, the twelve redirect
 * stubs still use the root-absolute targets CLAUDE.md carves out of the
 * relative-paths rule, the cache keys they say exist do exist, `npm test` is
 * what they say it is, and neither document points at unlanded work.
 *
 * Claims that need a human (Pages serves `main`, DNS lives in Cloudflare,
 * Codex reviews every pull request, Chart.js is v4 when the CDN tag is
 * unpinned, the visual and accessibility constraints) are deliberately not
 * asserted here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');
const exists = (p) => existsSync(join(repo, p));

// assert.match prints the whole subject on failure; for a 7,000-line file that
// buries the message. This keeps the message and drops the dump.
const matches = (text, re, msg) => assert.ok(re.test(text), msg);

const DOCS = ['AGENTS.md', 'CLAUDE.md'];
const docs = Object.fromEntries(DOCS.map((d) => [d, read(d)]));

const pin = JSON.parse(read('data/geo/active_run.json'));
const runDir = pin.run_dir;

// Every backticked token in either document, with the documents it appears in.
function backticked() {
  const found = new Map();
  for (const [doc, text] of Object.entries(docs)) {
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      if (!found.has(m[1])) found.set(m[1], new Set());
      found.get(m[1]).add(doc);
    }
  }
  return found;
}

const where = (tok) => [...(backticked().get(tok) ?? [])].join(', ') || 'neither document';

// ---------------------------------------------------------------------------
// 1. Paths
// ---------------------------------------------------------------------------

// A backticked token is treated as a path when it has no spaces, quotes,
// parentheses or colons, and contains a dot or a slash. Everything that meets
// that shape must resolve from the repository root, except the entries below,
// each of which says why it is not a repository path and which test covers
// it instead. An exemption nobody uses any more fails the test, so the list
// cannot silently outlive the wording that needed it.
const PATH_EXEMPTIONS = {
  'civicsample.com': 'a domain, asserted by the CNAME test',
  '@babel/standalone': 'an npm package loaded from a CDN, asserted by the React island test',
  '/#race': 'an example of the root-absolute redirect target, asserted by the stubs test',
  '/data/...': 'an example of the forbidden root-absolute pattern, asserted by the relative-paths test',
  '/app.js': 'an example of the forbidden root-absolute pattern, asserted by the relative-paths test',
  'geo_rep_LATEST.txt': 'deliberately absent; the docs say the app must never follow it, asserted below',
};

const looksLikePath = (tok) => /^[\w.@#/-]+$/.test(tok) && /[./]/.test(tok);

test('every backticked path in AGENTS.md and CLAUDE.md resolves', () => {
  const tokens = backticked();
  const used = new Set();
  const missing = [];
  for (const [tok, inDocs] of tokens) {
    if (!looksLikePath(tok)) continue;
    if (tok in PATH_EXEMPTIONS) { used.add(tok); continue; }
    // A bare filename may live in the pinned run directory (d3_blank_inventory.csv).
    const candidates = tok.includes('/') ? [tok] : [tok, join(runDir, tok)];
    if (!candidates.some(exists)) {
      missing.push(`${tok} (named in ${[...inDocs].join(', ')}; looked in ${candidates.join(' and ')})`);
    }
  }
  assert.deepEqual(missing, [],
    'documented paths that do not exist — either restore the file or correct the document:\n  ' +
    missing.join('\n  '));
  const stale = Object.keys(PATH_EXEMPTIONS).filter((tok) => !used.has(tok));
  assert.deepEqual(stale, [],
    `PATH_EXEMPTIONS lists tokens the documents no longer name — remove them: ${stale.join(', ')}`);
});

test('the app never follows geo_rep_LATEST.txt, which the docs say must stay unfollowed', () => {
  // The docs backtick a file that is correctly absent from this repository.
  // The meaningful assertion is that no code path references it; comments may.
  const sources = ['app.js', ...readdirSync(join(repo, 'geo')).filter((f) => f.endsWith('.js')).map((f) => `geo/${f}`)];
  const offenders = [];
  for (const src of sources) {
    read(src).split('\n').forEach((line, i) => {
      if (!line.includes('geo_rep_LATEST')) return;
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comment line
      offenders.push(`${src}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [],
    'code references geo_rep_LATEST.txt outside a comment — the geography tab reads the pinned run only:\n  ' +
    offenders.join('\n  '));
  matches(docs['AGENTS.md'], /geo_rep_LATEST\.txt/,
    'AGENTS.md no longer names geo_rep_LATEST.txt; drop this test and its PATH_EXEMPTIONS entry together');
});

// ---------------------------------------------------------------------------
// 2. Identifiers: every non-path token the docs name, and where it must appear
// ---------------------------------------------------------------------------

// A blind grep proves nothing for a word like `country`, so each identifier
// names the file the document is describing when it uses it. Every key must
// still be backticked in a document, so the map cannot outlive the wording.
const longTable = join(runDir, pin.long_table);
const IDENTIFIERS = {
  '_loadScriptOnce': ['app.js'],
  '#approval-queue-root': ['app.js', 'index.html'],
  'plugins:': ['app.js'],
  'fetch()': ['app.js'],
  '?v=': ['index.html'],
  'npm test': ['package.json'],
  'node --test tests/*.test.mjs': ['package.json'],
  'gate_reason': [longTable],
  'withheld': [longTable],
  'delta_from_raw_pp': [longTable],
  'country': [longTable, join(runDir, 'geo_dictionary.csv')],
  'us_state': [longTable, join(runDir, 'geo_dictionary.csv')],
  "'not_applicable'": [longTable],
  "'true'": [longTable],
  "'false'": [longTable],
};

// `npm test` is a command whose token in package.json is the script key.
const NEEDLE = {
  'npm test': '"test":',
  '#approval-queue-root': 'approval-queue-root', // the id attribute in index.html has no '#'
  'fetch()': 'fetch(',
  "'not_applicable'": 'not_applicable',
  "'true'": ',true,',
  "'false'": ',false,',
};

test('every identifier the docs name appears in the file the docs are describing', () => {
  const tokens = backticked();
  const problems = [];
  for (const [tok, files] of Object.entries(IDENTIFIERS)) {
    if (!tokens.has(tok)) {
      problems.push(`IDENTIFIERS lists \`${tok}\`, which neither document names any more — remove it`);
      continue;
    }
    const needle = NEEDLE[tok] ?? tok;
    for (const f of files) {
      if (!exists(f)) { problems.push(`\`${tok}\`: ${f} does not exist`); continue; }
      if (!read(f).includes(needle)) {
        problems.push(`\`${tok}\` (named in ${where(tok)}) does not appear in ${f}`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n  '));
});

// ---------------------------------------------------------------------------
// 3. Cache keys
// ---------------------------------------------------------------------------

test('index.html pins styles.css and app.js with a ?v= cache key, as the docs say', () => {
  const html = read('index.html');
  const stylesheet = html.match(/<link[^>]*href="styles\.css([^"]*)"/);
  assert.ok(stylesheet, 'index.html does not link styles.css');
  matches(stylesheet[1], /^\?v=[\w.-]+$/,
    `styles.css is linked without a ?v= cache key (href="styles.css${stylesheet[1]}") — ` +
    'returning browsers will keep the old stylesheet');
  const script = html.match(/<script[^>]*src="app\.js([^"]*)"/);
  assert.ok(script, 'index.html does not load app.js');
  matches(script[1], /^\?v=[\w.-]+$/,
    `app.js is loaded without a ?v= cache key (src="app.js${script[1]}") — ` +
    'returning browsers will keep the old script');
});

test('the geo/ scripts index.html loads are cache-keyed too', () => {
  // Not a documented claim, but the same failure mode: geo_render.js changing
  // under a browser that cached the old one.
  const html = read('index.html');
  const unkeyed = [...html.matchAll(/<script[^>]*src="(geo\/[^"?]+)(\?[^"]*)?"/g)]
    .filter((m) => !/^\?v=/.test(m[2] ?? ''))
    .map((m) => m[1]);
  assert.deepEqual(unkeyed, [], `geo scripts loaded without a ?v= key: ${unkeyed.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 4. Redirect stubs
// ---------------------------------------------------------------------------

test('the twelve directory redirect stubs exist and use root-absolute /#<tab> targets', () => {
  const stubs = readdirSync(join(repo), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
    .map((d) => d.name)
    .filter((d) => existsSync(join(repo, d, 'index.html')))
    .sort();
  assert.equal(stubs.length, 12,
    `CLAUDE.md says there are twelve directory index.html stubs; found ${stubs.length}: ${stubs.join(', ')} — ` +
    'update the document or restore the stub');
  matches(docs['CLAUDE.md'], /\btwelve\b/, 'CLAUDE.md no longer says "twelve"; keep the count and the wording together');
  for (const named of ['race', 'geography', 'studies']) {
    assert.ok(stubs.includes(named), `CLAUDE.md names ${named}/ as a stub, but ${named}/index.html is missing`);
  }
  for (const dir of stubs) {
    const html = read(join(dir, 'index.html'));
    const meta = html.match(/http-equiv="refresh"\s+content="0;\s*url=([^"]+)"/);
    assert.ok(meta, `${dir}/index.html has no meta refresh redirect`);
    assert.equal(meta[1], `/#${dir}`,
      `${dir}/index.html meta-refreshes to "${meta[1]}", expected the root-absolute "/#${dir}" — ` +
      'stubs sit one level down and must reach the site root; do not make them relative');
    const replace = html.match(/location\.replace\('([^']+)'/);
    assert.ok(replace, `${dir}/index.html has no location.replace redirect`);
    assert.equal(replace[1], `/#${dir}`,
      `${dir}/index.html location.replace()s to "${replace[1]}", expected the root-absolute "/#${dir}"`);
  }
});

// ---------------------------------------------------------------------------
// 5. Pages files
// ---------------------------------------------------------------------------

test('CNAME and .nojekyll are present and CNAME names the custom domain', () => {
  assert.ok(exists('.nojekyll'),
    '.nojekyll is missing — without it Pages drops every path beginning with an underscore');
  assert.ok(exists('CNAME'), 'CNAME is missing — the custom domain civicsample.com comes from it');
  assert.equal(read('CNAME').trim(), 'civicsample.com',
    `CNAME reads "${read('CNAME').trim()}", but CLAUDE.md says the custom domain is civicsample.com`);
  assert.equal(read('CNAME').trim().split('\n').length, 1, 'CNAME must hold exactly one domain');
});

// ---------------------------------------------------------------------------
// 6. No unlanded work
// ---------------------------------------------------------------------------

test('neither document points at unlanded work', () => {
  // The phrasing that has gone stale here before, plus the shapes it takes.
  const patterns = [
    [/not (yet )?on `main`/i, 'says something is not on main'],
    [/not (yet )?(merged|landed)/i, 'says something is not merged or landed'],
    [/\bopen(ed)? pull request/i, 'names an open pull request'],
    [/\bpull request #\s?\d+/i, 'names a pull request by number'],
    [/\bPR\s?#?\d+\b/, 'names a PR by number'],
    [/(?<![\w/])#\d+\b/, 'carries an issue or pull request number'],
    [/`[\w./-]+` (branch|pull request)\b/, 'names a branch or pull request by backticked name'],
    [/\b(branch|pull request) `[\w./-]+`/, 'names a branch or pull request by backticked name'],
    [/\bwill be (added|restored|moved|removed|renamed)\b/i, 'describes future work as fact'],
  ];
  const hits = [];
  for (const [doc, text] of Object.entries(docs)) {
    text.split('\n').forEach((line, i) => {
      for (const [re, why] of patterns) {
        if (re.test(line)) hits.push(`${doc}:${i + 1} ${why}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(hits, [],
    'a document describes work that has not landed; documents describe main as it is:\n  ' + hits.join('\n  '));
});

// ---------------------------------------------------------------------------
// 7. Test runner
// ---------------------------------------------------------------------------

test('npm test is exactly what the docs say it is, and is the only runner', () => {
  const pkg = JSON.parse(read('package.json'));
  const documented = 'node --test tests/*.test.mjs';
  assert.equal(pkg.scripts?.test, documented,
    `package.json "test" is ${JSON.stringify(pkg.scripts?.test)}; CLAUDE.md says \`npm test\` runs \`${documented}\``);
  assert.ok(docs['CLAUDE.md'].includes(`\`${documented}\``),
    'CLAUDE.md no longer quotes the test command; keep package.json and the document together');
  const otherRunners = Object.keys(pkg.scripts).filter((k) => k !== 'test' && /test/i.test(k));
  assert.deepEqual(otherRunners, [], `CLAUDE.md says "No other runner"; package.json has: ${otherRunners.join(', ')}`);
  for (const dep of ['jest', 'mocha', 'vitest', 'ava', 'tap']) {
    assert.ok(!(dep in (pkg.devDependencies ?? {})) && !(dep in (pkg.dependencies ?? {})),
      `CLAUDE.md says "No other runner"; package.json depends on ${dep}`);
  }
});

// ---------------------------------------------------------------------------
// 8. No Python, no build, no deployment workflow
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name === '.git' || d.name === 'node_modules') continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(p, out); else out.push(relative(repo, p));
  }
  return out;
}

test('the only Python file is scripts/geo/advance_run.py and no workflow runs it', () => {
  const py = walk(repo).filter((f) => f.endsWith('.py')).sort();
  assert.deepEqual(py, ['scripts/geo/advance_run.py'],
    'CLAUDE.md says advance_run.py is the single exception to "no Python"; found: ' + py.join(', '));
  for (const wf of readdirSync(join(repo, '.github/workflows'))) {
    const yml = read(join('.github/workflows', wf));
    assert.ok(!/\bpython3?\b|advance_run/.test(yml),
      `.github/workflows/${wf} runs Python; CLAUDE.md says the advance script never runs in CI`);
  }
});

test('there is no deployment workflow and no build step', () => {
  const workflows = readdirSync(join(repo, '.github/workflows'));
  const deployers = /actions\/deploy-pages|actions\/upload-pages-artifact|peaceiris\/actions-gh-pages|github-pages-deploy-action/;
  for (const wf of workflows) {
    assert.ok(!deployers.test(read(join('.github/workflows', wf))),
      `.github/workflows/${wf} deploys Pages; CLAUDE.md says merging to main is deploying and there is no deployment workflow`);
  }
  const pkg = JSON.parse(read('package.json'));
  const buildish = Object.keys(pkg.scripts).filter((k) => /^(build|bundle|compile|prepare)$/.test(k));
  assert.deepEqual(buildish, [], `CLAUDE.md says there is no build step; package.json has: ${buildish.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 9. The CDN runtime claims in CLAUDE.md §1
// ---------------------------------------------------------------------------

test('the React island loads what CLAUDE.md says it loads, scoped how it says', () => {
  const app = read('app.js');
  const claims = [
    [/function _loadScriptOnce\(/, 'defines _loadScriptOnce'],
    [/cdn\.tailwindcss\.com/, 'loads the Tailwind Play CDN'],
    [/react@18\/umd\/react\.production\.min\.js/, 'loads React 18'],
    [/react-dom@18\/umd\/react-dom\.production\.min\.js/, 'loads ReactDOM 18'],
    [/@babel\/standalone/, 'loads @babel/standalone'],
    [/corePlugins:\s*\{\s*preflight:\s*false\s*\}/, "disables Tailwind's preflight reset"],
    [/important:\s*'#approval-queue-root'/, 'scopes Tailwind utilities to #approval-queue-root'],
    [/fetch\('beta\/approval-queue\.jsx/, 'fetches beta/approval-queue.jsx over a relative path'],
  ];
  for (const [re, what] of claims) {
    matches(app, re, `CLAUDE.md says app.js ${what}; it no longer does`);
  }
  assert.ok(exists('beta/approval-queue.jsx'), 'beta/approval-queue.jsx is missing');
  matches(read('index.html'), /id="approval-queue-root"/, 'index.html has no #approval-queue-root mount point');
});

test('charting libraries come from CDN and datalabels is passed per chart, not registered globally', () => {
  const html = read('index.html');
  const app = read('app.js');
  matches(html, /<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js[^"]*"/,
    'CLAUDE.md says Chart.js loads from CDN; index.html no longer does');
  matches(html, /<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/chartjs-plugin-datalabels@2[^"]*"/,
    'CLAUDE.md says chartjs-plugin-datalabels v2 loads from CDN; index.html no longer does');
  const globalRegister = [...app.matchAll(/Chart\.register\(([^)]*)\)/g)].filter((m) => /ChartDataLabels/.test(m[1]));
  assert.deepEqual(globalRegister.map((m) => m[0]), [],
    'CLAUDE.md says the datalabels plugin is not auto-registered, but app.js registers it globally');
  matches(app, /plugins:\s*\[[^\]]*ChartDataLabels/,
    'CLAUDE.md says a chart that wants datalabels passes it in plugins:; no chart does');
  matches(app, /d3js\.org\/d3\.v\d+/, 'CLAUDE.md says D3 loads from CDN; app.js no longer does');
  matches(app, /topojson-client@/, 'CLAUDE.md says TopoJSON loads from CDN; app.js no longer does');
});

// ---------------------------------------------------------------------------
// 10. Relative paths everywhere but the stubs
// ---------------------------------------------------------------------------

test('assets and data outside the redirect stubs resolve relative to the page', () => {
  const offenders = [];
  read('index.html').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\b(?:src|href)="(\/[^/"][^"]*)"/g)) {
      offenders.push(`index.html:${i + 1} ${m[1]}`);
    }
  });
  const sources = ['app.js', ...readdirSync(join(repo, 'geo')).filter((f) => f.endsWith('.js')).map((f) => `geo/${f}`)];
  for (const src of sources) {
    read(src).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/(?:fetch\(|\.src\s*=|\.href\s*=)\s*[`'"](\/[^/`'"][^`'"]*)/g)) {
        offenders.push(`${src}:${i + 1} ${m[1]}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    'root-absolute paths outside the redirect stubs break every project-page and preview URL:\n  ' +
    offenders.join('\n  '));
});

// ---------------------------------------------------------------------------
// 11. The snapshot control the docs say still loads snapshots/
// ---------------------------------------------------------------------------

test('the "View snapshot" control exists and loads from snapshots/', () => {
  const html = read('index.html');
  const label = html.match(/<label for="history-date">([^<]*)<\/label>/);
  assert.ok(label, 'index.html has no label for the #history-date snapshot selector');
  assert.equal(label[1].trim(), 'View snapshot:',
    `the docs call it the "View snapshot" control; the label now reads "${label[1].trim()}" — rename in both places or neither`);
  matches(html, /<select id="history-date">/, 'index.html has no #history-date snapshot selector');
  matches(read('app.js'), /getElementById\('history-date'\)/, 'app.js no longer drives the #history-date selector');
  matches(read('app.js'), /`snapshots\/\$\{/,
    'the docs say the snapshot control loads snapshots/; app.js no longer fetches from there');
  assert.ok(exists('snapshots'), 'snapshots/ is missing');
  assert.ok(statSync(join(repo, 'snapshots')).isDirectory(), 'snapshots is not a directory');
});
