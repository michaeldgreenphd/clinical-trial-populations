# System Architecture & Development Guidelines

The source of truth for code generation (Claude Code) and pull request review
(Codex, Copilot) in this repository. `AGENTS.md` holds the review rules
themselves and the places this repository most easily breaks; this file
describes the system those rules are applied to. Read both. Where a general
rule below meets a specific carve-out, the carve-out wins — several of them
exist because the obvious reading of the rule is wrong here.

## 1. Stack & Environment

**This repository is the front end. Nothing here is built, and nothing here
runs on a server.** The pipeline that produces its data is a separate
repository,
[`civicsample-engine`](https://github.com/michaeldgreenphd/civicsample-engine).

The single exception to "no Python" is `scripts/geo/advance_run.py`, a
maintenance script a person runs by hand to advance the geography pin. It is
not part of the site, is never served, and never runs in CI. Everything the
browser executes is JavaScript.

* **Core stack:** static HTML, CSS and vanilla JavaScript. There is no build
  step: nothing is compiled ahead of time, and what is committed is what
  ships.
* **One framework, deliberately contained.** The beta Approval Queue tab is a
  React island. Opening it lazy-loads React 18, ReactDOM, the Tailwind Play
  CDN and `@babel/standalone`, then transpiles `beta/approval-queue.jsx` in
  the browser (`app.js`, the `_loadScriptOnce` block). Tailwind's preflight
  reset is disabled before its first build and its utilities are scoped to
  `#approval-queue-root`, so it cannot bleed into the vanilla-CSS dashboard.
  A change to that tab is React work with CDN runtime dependencies and should
  be reviewed as such; nothing else in the repository is.
* **Charting:** Chart.js v4 with chartjs-plugin-datalabels v2, and D3 with
  TopoJSON for the maps, all from CDN. The datalabels plugin is **not**
  auto-registered; a chart that wants it must pass it in `plugins:`.
* **Data:** static JSON and CSV under `data/` and `snapshots/`, written into
  this repository by the engine's scheduled job. Never edited by hand.
* **Hosting:** GitHub Pages, serving `main` directly from the branch. There
  is no deployment workflow — **merging to `main` is deploying.** The custom
  domain `civicsample.com` comes from the `CNAME` file, with DNS managed in
  Cloudflare outside this repository; nothing committed here can change it.
* **`.nojekyll`** is present and load-bearing. Removing it makes Pages drop
  every path beginning with an underscore.
* **Tests:** `npm test` runs `node --test tests/*.test.mjs`. No other runner.
* **Running it locally: serve the folder.** `python3 -m http.server 8000`,
  then `http://localhost:8000`. Opening `index.html` as a `file://` URL does
  not work — the app `fetch()`es its JSON and gzip data over relative paths,
  which that origin blocks, so the page loads with no data and looks broken
  for a reason that has nothing to do with the change. A UI change is not
  verified until it has been seen on a served page.

## 2. Agent Responsibilities

* **Generator (Claude Code):** writes implementations, structures multi-file
  edits, runs the local checks, and opens the pull request. It states what it
  verified and how, and says plainly what it did not do.
* **Reviewers (Codex, Copilot):** audit for security, data-loss and
  correctness; check that the numbers a change renders still match the
  published files; check UI consistency. Do not report formatting or lint
  nits, and do not report a stylistic preference as a finding unless it
  violates a constraint stated in this file or in `AGENTS.md`.

## 3. Strict Coding Constraints

**Separation of concerns.** This repository presents; it does not compute.
Anything that changes what a number *is* belongs in the engine. A pull request
here that derives a new statistic in JavaScript, rather than reading one the
engine published, is doing the engine's job in the wrong place and should be
challenged.

**Derived display values may not invent a denominator.** The app filters and
formats published counts. Every percentage it renders must name the
denominator it used, and that denominator must come from the same file as the
numerator. A ratio assembled from two different published files is a defect
even when both numbers are individually correct.

**Absence is not zero.** Blank, "not reported" and "not applicable" are
distinct states throughout the data and must stay distinct through to the
rendered cell. Coercing any of them to `0`, or to each other, silently
overstates coverage. Three-state flags stay strings — `'true'`, `'false'`,
`'not_applicable'` — and are never treated as booleans.

**Deployment safety.** Because Pages serves the branch, every merge to `main`
is live immediately, for everyone, with no staging step and no rollback but
another commit. Scrutinise anything touching `CNAME`, `.nojekyll`, the
redirect stubs, or `.github/workflows/`. A change to routing needs an explicit
justification in the pull request body.

**Routing stubs use absolute paths on purpose.** The twelve directory
`index.html` files (`race/`, `geography/`, `studies/`, …) are static redirects
that bounce a deep link to the hash route the app handles. They sit one level
down and must reach the site root, so they correctly use root-absolute paths
(`/#race`). Do not "fix" them to relative paths — that breaks every deep link.
Everywhere else, see §4.

**Asset cache keys.** `index.html` pins `styles.css` and `app.js` with `?v=`
query strings. A change to either file without bumping its key ships new
markup to returning browsers still running the old script. Treat a missing
bump as a defect, not a nit.

**The geography tab is a frozen contract.** It reads one pinned pipeline run
via `data/geo/active_run.json`. Its five non-negotiables are documented in
`data/geo/README.md` and enforced by `tests/geo_contract.test.mjs`. Advancing
the pin is a deliberate act performed by `scripts/geo/advance_run.py` and
reviewed as its own pull request. No other change may alter how that tab
renders numbers.

**Accessibility and responsiveness.** Colour is never the only carrier of
meaning; every chart series is distinguishable without it. Interactive
controls are reachable and operable from the keyboard and keep a visible
focus ring. Layouts hold from 390px up — wide content scrolls inside its own
container rather than making the page scroll sideways. Any new palette is
checked for contrast and for colour-vision separation before it ships.

**History is not rewritten here.** No force-pushes, no rebases of pushed
branches, no deletion of published history.

## 4. Pull Request Requirements

* **Relative paths for assets**, with the routing-stub carve-out above. A
  root-absolute `/data/...` or `/app.js` works on the custom domain and breaks
  on any project-page or preview URL. Data fetches, scripts, styles and images
  outside the stubs must resolve relative to the page.
* **A change to a published number states its provenance** — which file it
  came from and which engine run wrote it.
* **The relevant local checks are run and their output reported**, not
  asserted. `npm test` must pass. A UI change is shown, not described.
* **A behaviour change carries a test**, or the pull request names the
  specific untested behaviour and the risk of leaving it untested.
* **Prefer several small, single-purpose pull requests** over one broad one.
* Migration or compatibility notes accompany any change affecting published
  data files, stored state, or the snapshots the "View snapshot" control
  still loads.
