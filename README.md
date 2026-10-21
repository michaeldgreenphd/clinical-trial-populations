# ClinicalTrials.gov Demographics Dashboard

The frontend for [civicsample.com](https://civicsample.com) — an interactive
dashboard of demographic reporting (race, ethnicity, biological sex, gender
identity) across ~80,000 clinical trials with posted results on
ClinicalTrials.gov, standardized to NIH/OMB categories.

**This repo serves; the engine repo computes.** Everything here is a static
site published by GitHub Pages, plus the data files it displays. The numbers
are produced elsewhere — by
[`civicsample-engine`](https://github.com/michaeldgreenphd/civicsample-engine),
which runs the extraction weekly and pushes finished data files into this
repo. If you want to change how the dashboard looks or behaves, you're in
the right place; if you want to change what the numbers *are*, that's the
engine.

## Where things live

| Path | One-line job |
|---|---|
| `index.html`, `app.js`, `styles.css` | The dashboard — a single-page app; every tab's markup and logic |
| `geo/` | The Geography tab's modules (reader, renderer, UI), contract-tested |
| `beta/approval-queue.jsx` | The beta Approval Queue tab — fetched and compiled in the browser at runtime |
| `about/`, `race/`, `geography/`, … | One-line redirect stubs so `/race` etc. deep-link into the app |
| `data/` | The published data the dashboard fetches: demographics parts, summaries, extraction results, the pinned geography run (and, once the engine splits the data, the Studies-tab parts and detail shards beside the parts) |
| `data/pilot_trials_manuscripts/` | Trial manuscript PDFs the site serves directly — manuscript links fall back to these when a paper has no DOI |
| `snapshots/` + `history.json` | Dated point-in-time copies powering the "View snapshot" selector (the latest week from `data/`, three earlier weeks about two weeks apart in full, then one summary per month, with its recent studies' records from October 2026 on). The newest date in `history.json` (its `latest`, else the newest of `dates`) is read from `data/`, not `snapshots/` |
| `condition_ontology.json` | Condition category tree the app loads at startup (canonical copy lives in the engine, published here) |
| `tests/` + `package.json` | Geography contracts, repository/docs wiring, Industry and Sex/Gender checks; CI runs on every push and pull request |
| [AGENTS.md](AGENTS.md), [verify.md](verify.md) | Contributor constraints and the canonical setup, verification and integration guide |
| `CNAME`, `.nojekyll`, `og-preview.png` | GitHub Pages plumbing and the social-share image |

## How the data gets here

Every Sunday 06:00 UTC, the engine's weekly workflow extracts from
ClinicalTrials.gov, packages the artifacts, and publishes data plus follow-up
audit/bridge commits to this repo. Read provenance from the artifact headers or companion
metadata (`extracted_at`, `pipeline_commit` or `source_pipeline_commit`);
the geography run has its own explicit pin. These are not one synchronized
dataset: the verification guide describes the separate inputs and boundaries.
Nothing in this repo runs the pipeline anymore.

## Local development

It's a static site — serve the folder and open it:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# then http://127.0.0.1:8000
```

Use Node 22, matching CI. From the repository root, the quick verification is:

```bash
npm ci
DOCS_WIRING_BASE="$(git rev-parse --verify 'origin/main^{commit}')"
export DOCS_WIRING_BASE
git merge-base "$DOCS_WIRING_BASE" HEAD
npm test
git diff --check
```

[verify.md](verify.md) explains prerequisites, targeted checks, known test
limits, browser flows, and the engine-to-site contract readiness gate. Read it
before selecting checks or claiming a change is complete. There is no build
step or backend service to start.

## Known quirks (so reviews don't rediscover them)

- **The beta Approval Queue tab sits behind a client-side password prompt**
  in `app.js`. It is a curtain, not security — the passwords are visible in
  this public repo, so everything here, data included, should be treated as
  public. Replacing or removing the gate is an open item.
- **Study details load on demand.** The Studies table and every pop-up open
  at once from the core fields. Where the rest comes from is the dataset's
  layout (the `layout` section of `tests/record_contract.json`): a dataset
  whose parts carry every field (inline: everything published so far, and
  every snapshot) fetches nothing more; a split one fetches its Studies-tab
  extras (`studies_tab.partN.json.gz`) when the Studies tab opens and one
  detail shard (`detail/<n>.json.gz`) per pop-up, from its own folder. The
  engine writes split files only while that section's `enabled` is true.
- **`data/details.part1.json.gz` / `part2` are frozen** at 2026-03-05; their
  generator was retired before the repo split. Only the 2026-02-22 archive,
  extracted before them, still reads them, on desktop, for its pop-ups,
  labelled "from the 2026-03-05 extract". They carry five fields (sites,
  secondary outcomes, and the primary-outcome and design descriptions), and
  only those wait on them; the archive's other detail fields say "Not
  included in this archive" from the start. A phone never fetches them (82 MB
  of gzip) and says "Not included in this archive" instead. The other
  summary-only archives (snapshots
  holding just `dashboard-summary.json`) say "Not included in this archive"
  for what their summary rows lack, until the engine writes an archive's own
  `archive_records.json.gz` and names it in `history.json`; the latest view
  and the full snapshots never fetch the March files. Once 2026-02-22 has
  its own file they can be removed.

## History

Until August 2026 this repo also contained the extraction pipeline. That
moved to `civicsample-engine`; the complete pre-split repo is preserved on
the [`pre-split-archive`](https://github.com/michaeldgreenphd/clinical-trial-populations/tree/pre-split-archive) branch and in git
history.
