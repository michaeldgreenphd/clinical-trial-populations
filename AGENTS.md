# AGENTS.md

Guidance for AI agents working in this repository.

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

**Asset cache keys.** `index.html` pins `styles.css` and `app.js` with version
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
