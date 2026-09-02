# Geography contract data — how this stays alive

The geography tab renders exactly one pinned pipeline run. Nothing in the app
follows `geo_rep_LATEST.txt`, computes its own aggregates, or updates itself:
**advancing runs is a deliberate act**, and this file documents the loop that
keeps the tab current in perpetuity.

## What is pinned where

- `active_run.json` — the pin: `run_id`, `snapshot_date`, and the run
  directory the app fetches at load. The footer of the geography tab renders
  these two values so the provenance is always on screen.
- `geo_rep_<date>_runNNN/` — the 12 contract files for the pinned run, staged
  byte-for-byte and hash-verified against the run's own `MANIFEST.csv`. The
  app reads only these; analysis tables (`b1_tier1_composition.csv`,
  `c5_state_composition.csv`, …) are never staged.
- `../../tests/run_expectations.json` — the pinned run's numbers (view
  cardinalities, withheld/blank/gate-pass counts, absent US states), generated
  by `advance_run.py`. The acceptance tests assert the app renders *these*
  numbers and refuse to run if the expectations' `run_id` differs from the
  pin's — so a pin advance without regenerated expectations fails loudly.

## The loop (roughly monthly)

1. **AACT publishes a static copy.** CTTI posts pipe-delimited exports named
   `YYYYMMDD_export_ctgov.zip` at
   <https://aact.ctti-clinicaltrials.org/pipe_files>. The
   `geo-snapshot-watcher` workflow checks this page on the 3rd of each month
   and opens/refreshes an issue when a copy newer than the pin appears. That
   issue is a *nudge*, not an action — the workflow never downloads data or
   touches the pin.
2. **Run the pipeline.** Every run directory ships its complete pipeline
   (`refresh.R` sources `run_all.R`, which drives the `build_part*.R` scripts;
   deps are readr + dplyr; ~8 min). Point it at the unzipped snapshot:
   `Rscript refresh.R /path/to/snapshot --final`. The pipeline's own
   cross-check suite (`a_/b_cross_checks`, `b2_reader_test`,
   `b3_view_invariants`) is what validates the *numbers*; the app never
   re-derives them.
3. **Advance the pin.** From a checkout of *this* repository:
   `python3 scripts/geo/advance_run.py /path/to/run_dir`
   — refuses non-`final` runs, hash-verifies the 12 contract files, stages
   them, rewrites the pin, regenerates the expectations, and prints an
   old→new diff of every number that moved.
4. **Review what the dashboard will now say.** The expectations diff is the
   review artifact. If the set of absent US states changed, the caveat
   sentence in `index.html` must be updated by hand — the prose-tripwire test
   fails until the named states are actually absent in the pinned run.
5. **PR, gated.** `npm test` locally, then a PR; the `geo-contract-tests`
   workflow re-runs the 13 acceptance tests on the new pin. Remove the
   previous run directory in the same PR unless both should be retained.

## Which repository owns which step

The pipeline moved to
[`civicsample-engine`](https://github.com/michaeldgreenphd/civicsample-engine)
in the 2026 frontend/backend split, but this loop deliberately stayed split
across both repos along the line of *what each step writes*:

| Step | Repo | Why |
|---|---|---|
| 1. Watch for a newer AACT snapshot | engine (`geo-snapshot-watcher.yml`) | It reads this repo's `active_run.json` over HTTPS, writes nothing, and opens its advisory issue where the pipeline maintainers look |
| 2. Run the pipeline (`refresh.R`) | neither | Every run directory ships its own complete pipeline; that is what makes an old run reproducible |
| 3. Advance the pin (`advance_run.py`) | **this repo** | Every path it writes is a site path — the staged run directory, the pin, and the expectations file. A copy living elsewhere would stage into the wrong working tree |
| 4. Review, PR, merge | this repo | `geo-contract-tests` is the gate |

`tests/repo_wiring.test.mjs` asserts step 3's script is actually present and
that the paths naming it resolve, so a future repository reshuffle cannot
quietly break the loop again.

## Why the AACT fork matters

Both geography sources — `countries` and per-site `facilities` — derive from
a single API module (`protocolSection.contactsLocationsModule.locations`,
plus `derivedSection.miscInfoModule.removedCountries` for removed flags); see
the fork's `app/models/country.rb` and `app/models/facility.rb`. The fork is
the **semantic tripwire**: when AACT upgrades its loaders, diff the fork
against upstream *before* refreshing. A change in how those fields are
derived is a contract question (does the estimand still mean what
`CONTRACT.md` says?) before it is a data refresh.

## What must never happen

- No client-side aggregation, differencing (beyond the shipped
  `delta_from_raw_pp`), or estimand substitution — withheld rows render their
  `gate_reason`, never a number.
- No mixing of tier 1 and tier 3, or countries and US states, on one axis.
- No automatic pin advance. The watcher opens an issue; a human runs the loop.
