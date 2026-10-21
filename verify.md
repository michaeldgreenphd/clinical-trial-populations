# Verification guide

Run commands from the **clinical-trial-populations repository root** unless a
different working directory is stated. Read [AGENTS.md](AGENTS.md) and any
applicable nested/override instructions first. This is the canonical check
selection guide; [README.md](README.md) maps the product and
[data/geo/README.md](data/geo/README.md) owns the run-advance procedure.

Commands below are derived from the checked-in configuration and code. They
are instructions, not a claim that all checks ran in a particular session.
Completion reports must name the revisions, runtime versions, commands,
results, skips and unrun checks actually observed.

## Setup and quick path

- Use **Node 22**, as pinned in
  [.github/workflows/geo-contract-tests.yml](.github/workflows/geo-contract-tests.yml).
  There is no Node engine/version-manager pin in package.json. Record any
  local runtime mismatch; a pass elsewhere is not an exact CI reproduction.
- `npm ci` installs the committed lockfile v3. No build or bundler runs.
  Change package.json and package-lock.json together only for an intentional
  dependency change. The Node tests need d3-dsv; the browser loads separate
  CDN dependencies. Installing npm dependencies does not make the UI offline.
- Python 3's standard library is sufficient for the HTTP server and the
  manual geography advance script. There is no Python environment to install
  for ordinary frontend work, no .env file, backend service, database or
  required credential. The client-side beta password is public UI state,
  not authentication.
- Tests read checked-in data and fixtures; do not regenerate data to make a
  frontend test pass. `npm ci` may need registry access on a cold cache.

```bash
git status --short --branch
git rev-parse HEAD
# Resolve the intended fetched PR base once; retain this SHA for all checks.
DOCS_WIRING_BASE="$(git rev-parse --verify 'origin/main^{commit}')"
export DOCS_WIRING_BASE
git merge-base "$DOCS_WIRING_BASE" HEAD
node --version
npm --version
npm ci
npm test
git diff --check
```

Expected evidence: installation exits zero without changing the lockfile;
the Node runner reports zero failures; diff check emits nothing. Run each
command and inspect its exit status; stop if base resolution fails. A later
successful command does not erase an earlier failure. `npm test` is required for every change, including
documentation. Use targeted commands below while iterating; a final full-suite
run covers them, so do not rerun identical checks without a change or failure.

`DOCS_WIRING_BASE` must be exported in the shell running both the quick path
and targeted docs/wiring commands below. Resolve the intended PR base after
fetching origin (or record a blocked fetch); do not assume local main equals
origin/main. Record the resolved SHA and `git merge-base` output. Use the
**same SHA** for comparisons across workspaces. If the intended ref is absent,
choose and explain an available integration base; do not unset the variable
to turn a failed comparison into a skip. CI uses GITHUB_BASE_REF on pull
requests with full history.

The cache-key test identifies changed asset names between that merge base and
**committed HEAD**, not uncommitted changes (it reads the current index.html
for the keys). Before committing, inspect
`git diff -- app.js styles.css geo/ index.html` and
`git diff --cached -- app.js styles.css geo/ index.html`; verify changed keys
manually. After local commits, rerun the targeted docs/wiring command against
the same exported base so the automated comparison includes those commits.

Known check boundaries:

- The Python inventory excludes verified nested Git repositories/worktrees,
  including ones under .claude/worktrees, while retaining parent-tracked Python
  files and ordinary ignored/untracked project files. It still exempts
  node_modules and Git internals. Do not remove another session's checkout to
  make it pass; tests/repository_python_inventory.test.mjs covers the boundary.
- Docs wiring checks backticked paths/selected identifiers in AGENTS.md and
  CLAUDE.md, and local inline Markdown link paths in those files, README.md and
  this guide. It ignores URLs, code fences and command placeholders. Anchors,
  external links and command flags still need inspection against their source.
- `git diff` does not show new untracked file contents. Review those explicitly
  with `git status --short`, along with `git diff` and `git diff --cached`.

## Select additional checks

| Change | Targeted iteration checks and additional evidence |
|---|---|
| Documentation/instructions | With DOCS_WIRING_BASE exported above: `node --test tests/docs_wiring.test.mjs tests/repo_wiring.test.mjs tests/docs_references.test.mjs tests/repository_python_inventory.test.mjs`; inspect changed links, instruction precedence and documented command options. No pipeline refresh needed. |
| HTML/CSS/JS or routes | A served browser at desktop and 390px, applicable flows below, keyboard/focus checks, changed asset keys. For routes, open the affected directory redirect as well as the hash route. |
| Industry controls/rendering | `node --test tests/industry_tab.test.mjs tests/industry_conditions.test.mjs`; populated, empty and shared-link flows; compare a displayed cell to its published inputs. |
| Sex/Gender parser-v2 display | `node --test tests/sex_gender_v2.test.mjs`; v1/v2, participant eligibility, missing values, archive provenance and retry flows. Parser-rule changes belong in the manuscript bundle, then the engine. |
| Geography reader/render/pin | `node --test tests/geo_contract.test.mjs tests/repo_wiring.test.mjs`; inspect pin/expectations, withheld reasons, absent states, separate tiers/levels, browser provenance. A pin advance also needs the external run's own validation. |
| Published artifacts/readers/shared contract | `node --test tests/study_record_contract.test.mjs tests/study_sidecars.test.mjs tests/data_budget.test.mjs tests/snapshot_latest.test.mjs tests/first_view.test.mjs`; engine checks in its root verify.md, the readiness and connected flow below, desktop/mobile and old full/summary-only snapshots. State the producer revision and migration/compatibility path. |
| Backend behavior only | Work in the engine and run its guide. If output semantics or shape changes, exercise the consumer here too; a fixture-only producer pass is insufficient. |
| CI, runtime, Pages/configuration | Compare workflow triggers and runtime pins, run the entire suite, inspect CNAME/.nojekyll and relative asset paths. Hosting/DNS permissions and live deployment are separate evidence; no merge/deploy is part of local verification. |

For a CI-equivalent environment, use Node 22 and run `npm ci` then `npm test`.
Retain the exported DOCS_WIRING_BASE SHA above for local comparisons. CI sets
GITHUB_BASE_REF on PRs; on pushes it skips only the base-dependent cache test.
CI runs every push/PR without a path filter. There is no lint/build command or
browser test runner to substitute for the required suite.

## What the tests establish

- Geography tests parse the actual pinned CSVs with d3-dsv and exercise the
  reader/renderer models against `tests/run_expectations.json`. They protect
  the five geography rules in AGENTS.md, string-valued flags, blank meanings,
  omitted rankings and polygon eligibility. They do not rerun the geography
  analysis or render a browser map.
- Industry conditions tests use the actual published industry JSON in a
  stubbed DOM/VM. They protect top-10 desktop/top-5 mobile columns, all/custom
  persistence, sex-specific exclusions, empty selections, share-link round
  trips and unchanged cells when columns are hidden. Other Industry tests
  mostly inspect source and markup.
- Sex/Gender tests use synthetic rows, mocked fetch, storage, Chart and DOM.
  They protect five distinct states, zero versus absent, snapshot-specific
  metadata, transient failures versus confirmed 404s, and rollback/retry.
  Composition requires reported sex and participant counts; COUNT_OF_UNITS
  remains in reporting counts but not composition. Published percent_female
  is read, never reconstructed from enrollment; a missing eligible figure
  withholds the within-trial mean. Enrollment gaps are not an Unknown bucket,
  and the largest-trial annotation comes from the engine.
- Contract, sidecar, loading, snapshot and first-view tests exercise the real
  inline records where specified and synthetic split/DOM/fetch fixtures for
  other paths. The contract checks app.js field reads; data budgets fail over
  their ceilings on the site, while the engine warns at budgets and blocks
  at hosting limits. Engine first-view parity runs selected real site functions
  with DOM/helper stubs; it is cross-repository numeric evidence, not a browser.
- Wiring tests inspect files and code. A passing source assertion about a
  scroll container, caption or chart is not evidence of its rendered layout.

There is no random sample-size/seed workflow in the frontend. It filters the
published cohort and formats existing display aggregates. Existing code
includes sums, means and Industry deviations; this is not permission to add a
new estimand or invent a denominator. Geography has the stricter prohibition
on all client aggregation. The general filter path has limited direct test
coverage: manually verify inclusive results-year bounds, phase combinations,
null enrollment with active bounds, and unreported versus negative FDA flags.

## Served-browser verification

In a dedicated terminal at this repository root:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Wait for the serving message, then in another terminal:

```bash
curl --fail --silent --output /dev/null http://127.0.0.1:8000/index.html
curl --fail --silent --output /dev/null http://127.0.0.1:8000/data/dashboard-summary.json
curl --fail --silent --output /dev/null http://127.0.0.1:8000/data/geo/active_run.json
```

Open <http://127.0.0.1:8000>. A successful HTTP response proves availability,
not rendering. Use a disposable browser profile/tab state, inspect console and
network failures, and capture the changed UI and its viewport in the report.
Charts/maps and the beta React island need the external CDNs named in
index.html/app.js; a blocked CDN is a verification limitation to record.

Choose the affected rows; do not run every expensive desktop load for a prose
edit. Fresh-load at 390px for the summary path: the mobile choice is made at
startup (UA, width <=768px, or reported memory <=4GB), so resizing after a
desktop load does not test it. Desktop loads the eight gzip record parts and can use substantial memory.
Its default Overview can paint from a same-run firstView block before records
arrive, with a loading/retry strip; records replace it when ready. On phones,
a valid firstView also supplies the default Overview (Interventional, results
from 2009 with no upper bound). Other summary displays count all study types;
when firstView is absent/invalid the Overview falls back to that summary.
Summary mode uses precomputed aggregates/recent studies and disables controls
that cannot filter them. A failed mobile summary fetch falls back to the full
record load, so blocking that request alone does not test total load failure. Loading, firstView, records and year-window suites
cover these distinctions; verify the browser when changing them.

| Flow | Success/loading evidence | Empty, invalid or failed evidence |
|---|---|---|
| Initial dashboard/Studies | Default Overview paints with matching firstView/counts; loading strip clears after records arrive. Inspect extraction date, sort/search/page and open a study detail. | A no-match search stays empty rather than showing the previous selection. In a disposable browser, block the initial data request and record the actual error/overlay state; this path lacks end-to-end tests. Inline datasets need no detail fetch. Split datasets load their own extras/shards; aggregate archives use their own archive_records file where listed. Only the legacy February 22 archive can use frozen March details on desktop, explicitly labelled. |
| Filters/share URLs | Change results-year, condition and participant bounds; reset; reopen the copied URL and compare the cohort/control state. | Test unknown query values, inverted years and invalid numeric bounds. Do not claim comprehensive input validation from current tests; record observed behavior and any mismatch with acceptance criteria. |
| View snapshot (desktop) | Pick a full archive and an aggregate archive from history.json, then latest (served from data/, never a same-date snapshot); date, enabled controls and parser methods must follow the visible dataset. | Block an uncached archive's parts AND summary: error toast and previous dataset/selection restored. A missing parts file with an available summary is a fallback, not a total failure. |
| Sex/Gender | Open `/?sg=v2#sex`, then Gender and methods; inspect five buckets, separate quality states and participant-count exclusions. `/?sg=v1#sex` selects the legacy mode. | A truly missing archive parser artifact can say unavailable/retired; an HTTP/server/network failure must stay retryable. Remove the request block and use Retry. Reported zero remains zero; unpublished bucket stays absent. |
| Geography | Pin run/date visible; countries and US states, tier 1 and tier 3 remain separate; global cohort filters do not affect it. | Withheld values show gate_reason only; no substitute value, absent state or nonpolygon geography invented. Contract rejects unknown display_rule. |
| Industry | Enter the public beta curtain, change Year/Condition and its own controls; compare cell values before/after column choices. | Custom zero columns shows the empty-selection message; invalid share parameters should not silently claim an unapplied filter; blocked industry JSON shows its load-error note. |
| Approval Queue / extraction tools | Lazy dependencies load and rows appear; inspect queue decisions and filters if changed. | Cancel/wrong beta password does not enter the tab. Queue decisions are in-memory; reload is not persistence. Currently queue fetch errors collapse to empty inputs, so empty versus failed is a known gap, not a verified guarantee. |

Phones normally load the latest summary and ignore the sgsnapshot URL parameter;
they do not initialize the history selector in summary mode. Exercise archive
selection on desktop.

At desktop and 390px, use keyboard-only controls with visible focus, verify
chart meaning without colour, and check wide tables scroll within their own
container. New palettes require contrast and colour-vision checks. Stop the
server with Ctrl-C. Close the disposable profile; if using existing state,
remove only test-created keys: localStorage `civicsample.sg` and
`civicsample.studyColumns`, sessionStorage `betaExtractionUnlocked` and
`litCurationState`. Do not clear unrelated browser data.

## Cross-repository verification

The producer is [civicsample-engine](https://github.com/michaeldgreenphd/civicsample-engine);
this repository is the static consumer. Its root `verify.md` owns the producer
commands (locally `../civicsample-engine/verify.md` for sibling checkouts).
There is no API health endpoint or backend process to launch. The interface
has several independently versioned artifact families:

| Interface | Authority and existing compatibility evidence |
|---|---|
| Demographics parts, summary, ontology, archives/history | Site-owned [record contract](tests/record_contract.json) declares reader fields, classes, headers and layout; [budgets](tests/data_budget.json) declare part counts/size ceilings. app.js supports inline and v1 split; layout.enabled is false, so production remains inline. Engine split/publish reads these exact files; record run.json, part/summary stamps and history.latest. |
| Sex/Gender CSV/meta/methods and summary block | Manuscript parser vendored into engine; engine wrapper publishes parser_rules_version and source stamps. Frontend tests cover display semantics with fixtures, not regeneration. |
| Industry JSON and sponsor bridge/audits | Engine attribution rules/sha and producer scripts. Industry JSON is a separate reader from the bridge; do not assume a published bridge means this frontend imports the engine's browser filter module. |
| Geography | active_run.json selects an immutable run with its own CONTRACT.md and dictionaries; expectations protect consumer behavior. Complete external run bundle validates upstream analysis; advancing it is a separate reviewed change. |
| LLM extraction JSON/CSVs and PDF links | Engine's manual extraction workflow, committed outputs and prompt docs; frontend only displays/reviews these. Local UI decisions are not an API write. |

**Independent checks:** frontend quick path requires no engine checkout;
engine quick path requires no live site or API. The engine's synthetic site
contract and temp-directory tests are valuable producer tests, but do not
prove that a particular frontend revision can read their output.

**Check an existing published pair first:** record HEAD and status in both
repositories and their intended bases. In the engine root, its guide's
existing-site recipe runs scripts/check_site_contract.py with --site and
--latest, followed by scripts/first_view_parity.mjs against the site's own
app.js, index.html, summary and each published part. This reads actual
producer artifacts and consumer code without generating or publishing files.
Run the frontend suite too; the engine's budget warning does not replace the
site's stricter budget gate.

**Readiness and connected rehearsal:** follow the engine's root verify.md
recipe in a disposable site copy. It requires both real site contract files
and their corresponding reader, a complete full-record input with provenance,
and matching Sex/Gender CSV/meta. Record the selected commits and layout
switch. A checkout without either contract file predates this handshake; find
the authoritative merged contract **and reader**, never invent files or copy
a fixture. Inline is a supported producer path; split activation is separate.

The input's declared snapshot date must be at least the site's newest date.
An older local full input cannot rehearse the current publication sequence:
obtain a retained engine data release and matching parsed artifacts for the
site's latest date (or a complete newer run), without rolling history back.
Do not reconstruct full input from site parts, which may omit producer fields.

The current recipe prunes/archives the **previous** data folder first, writes
new artifacts to data/ with --snapshot-date, and validates --latest. It does
not create snapshots/<latest>. The contract check and firstView parity both
must pass before serving **that generated copy** on port 8001; use that port
in the browser procedure above. Compare record counts/IDs, source stamps,
layout, representative details, default Overview versus other summary views,
latest/full/aggregate snapshot routing and retry behavior. Preserve geography.
Stop the server and remove only that rehearsal's temporary directory.

If complete inputs are absent, report generation/browser rehearsal as blocked
separately from an existing-published-pair check. A passing independent suite or
VM parity check is not evidence that a generated copy was viewed in a browser.

Network/costly checks are triggered by a change to upstream extraction,
published schemas/semantics, CDN dependencies, model prompts, or a geography
pin—not by every documentation edit. A live CT.gov extraction, paid LLM pilot,
external geography rebuild or publish requires its own inputs/access and
evidence. No local verification command should push, prune the real site,
rewrite history, merge, or deploy. When a counterpart or full input is missing,
report exactly which connected check remains unrun and hand off that gate.
