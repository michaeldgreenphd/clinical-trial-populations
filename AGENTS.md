# AGENTS.md

Guidance for AI agents working in this repository. This file is the source of
truth for code generation and for pull request review; `CLAUDE.md` points here
and adds only Claude-Code-specific notes.

## What this repository is

The GitHub Pages front end for [civicsample.com](https://civicsample.com): a
static dashboard of ClinicalTrials.gov demographics. There is no build step —
`index.html`, `app.js` and `styles.css` are served as written, alongside the
`geo/` contract layer and the data files under `data/`.

Numbers are produced elsewhere. The
[`civicsample-engine`](https://github.com/michaeldgreenphd/civicsample-engine)
repository computes them and pushes the published files here. A change to how
the dashboard *looks or behaves* belongs in this repo; a change to what the
numbers *are* belongs in the engine.

## Repository workflow

Every pull request in this repository is independently reviewed by Codex
agents. Keep changes focused and testable, and include migration or
compatibility notes whenever a change affects published data files, stored
state, or anything another repository or a returning browser depends on.

Practical consequences:

- Prefer several small, single-purpose pull requests over one broad one; a
  reviewer that can hold the whole change in view finds more.
- State what you verified and how. Assertions about rendered output should be
  backed by something observable, not by inspection alone.
- Say plainly what you did *not* do, and why, rather than leaving it implied.

## Code Review Rules

- Flag changes that could corrupt, silently alter, or irreversibly delete
  stored data.
- Flag backward-incompatible API, database, configuration, or schema changes
  that lack a documented migration or compatibility path.
- For authentication and authorization changes, verify every relevant entry
  point—not only the primary request path.
- Prioritize concrete correctness, security, data-loss, and regression risks
  over stylistic preferences.
- Confirm that behavior-changing code has appropriate tests, or identify the
  specific untested behavior and resulting risk.
- Do not report formatting or lint issues that should be handled
  deterministically by CI.
- Include the affected scenario and evidence when reporting a finding; do not
  report speculative issues without a plausible failure path.

## Repository-specific review notes

These are the places where a change most easily causes the harm the rules
above are meant to catch.

**The geography tab renders one pinned, frozen pipeline run.** Its contract is
documented in `data/geo/README.md` and enforced by `tests/geo_contract.test.mjs`
(`npm test`). Five rules hold there, and a change that breaks any of them is a
correctness failure rather than a style question:

1. Never substitute an estimand for a withheld one — a `withheld` row renders
   its `gate_reason` text and carries no value under any key.
2. Never put `country` and `us_state` on one axis; they come from different
   registry tables and overlapping, non-nested trial sets.
3. Never put tier 1 and tier 3 on one axis or colour scale.
4. Never compute a difference estimand except the shipped `delta_from_raw_pp`.
5. Never compute client-side aggregates — every number rendered is a shipped
   row.

Blanks there mean absence with a reason (see `d3_blank_inventory.csv`), never
zero; three-state flags stay strings (`'true'` / `'false'` /
`'not_applicable'`); and the app must never follow `geo_rep_LATEST.txt`.
Advancing the pinned run is a deliberate act, reviewed as its own pull
request. The script that performs it, `scripts/geo/advance_run.py`, belongs
in this repository rather than in the engine, because every path it writes
resolves from its own repository root. If it is missing, that is the bug;
`tests/repo_wiring.test.mjs` checks that it stays here, and
`tests/docs_wiring.test.mjs` checks that every path and command this file
and `CLAUDE.md` name still resolves.

**Asset cache keys.** `index.html` pins `styles.css` and `app.js` with `?v=`
query strings. A change to either file that does not bump its key ships new
markup to returning browsers running the old script — treat a missing bump as
a defect, not a nit. On a pull request, `tests/docs_wiring.test.mjs` fails
when either file, or a `geo/` script, changes without its key changing.

**Published data files** under `data/` are written by the engine's weekly job.
Editing them by hand, or changing how the app reads them, needs a
compatibility note covering the snapshots in `snapshots/` that the "View
snapshot" control still loads.

**History is not rewritten here.** No force-pushes, no rebases of pushed
branches, no deletions of published history.

## Pull request workflow — required

1. Branch from `main` and open a pull request against `main`. Never push to
   `main` directly unless the owner explicitly says to.
2. Immediately after opening the PR, post a comment containing exactly
   "@codex review". Do this for every PR, without being asked, and again
   after any push that changes the diff so the new head is reviewed.
3. Address every Codex finding before the PR is considered done: verify it
   against the diff, push a fix for anything real, and reply on the thread
   saying what changed. Resolve the threads you addressed.
4. Ask before disputing. When a finding is unclear or looks wrong, do not
   argue with it or ignore it — post a comment addressed to @codex with the
   specific question, then act on the answer: fix, or reply with the reason
   it should not be taken. Codex answers direct questions; it does not
   respond to ordinary thread replies.
5. One editor per branch. Never use "@codex address that feedback", or
   otherwise ask Codex to push commits, while an agent or session is working
   on the branch. Asking Codex questions is fine at any time.
6. Keep the PR title and description accurate as the branch changes.
7. Agents do not merge; the owner merges.

## Stack and environment

**Nothing here is built, and nothing here runs on a server.** The single
exception to "no Python" is `scripts/geo/advance_run.py`, a maintenance
script a person runs by hand to advance the geography pin. It is not part of
the site, is never served, and never runs in CI. Everything the browser
executes is JavaScript.

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
  then `http://localhost:8000`. In VS Code the workspace's default build task
  runs the same command. Opening `index.html` as a `file://` URL does not
  work — the app `fetch()`es its JSON and gzip data over relative paths,
  which that origin blocks, so the page loads with no data and looks broken
  for a reason that has nothing to do with the change. A UI change is not
  verified until it has been seen on a served page.

## Agent responsibilities

* **Generator (Claude Code):** writes implementations, structures multi-file
  edits, runs the local checks, and opens the pull request. It states what it
  verified and how, and says plainly what it did not do.
* **Reviewers (Codex, Copilot):** audit for security, data-loss and
  correctness; check that the numbers a change renders still match the
  published files; check UI consistency. Do not report formatting or lint
  nits, and do not report a stylistic preference as a finding unless it
  violates a constraint stated in this file.

## Coding constraints

Where a general rule below meets a specific carve-out, the carve-out wins —
several of them exist because the obvious reading of the rule is wrong here.
The geography tab's five rules, asset cache keys and the no-rewrite rule are
in the review notes above; no change outside a reviewed pin advance may alter
how that tab renders numbers.

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
Everywhere else, see the pull request requirements below.

**Accessibility and responsiveness.** Colour is never the only carrier of
meaning; every chart series is distinguishable without it. Interactive
controls are reachable and operable from the keyboard and keep a visible
focus ring. Layouts hold from 390px up — wide content scrolls inside its own
container rather than making the page scroll sideways. Any new palette is
checked for contrast and for colour-vision separation before it ships.

## Pull request requirements

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
