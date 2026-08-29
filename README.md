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
| `data/` | The published data the dashboard fetches: demographics parts, summaries, extraction results, the pinned geography run |
| `snapshots/` + `history.json` | Dated point-in-time copies powering the "View snapshot" selector (4 recent bi-weekly in full, then monthly summaries) |
| `condition_ontology.json` | Condition category tree the app loads at startup (canonical copy lives in the engine, published here) |
| `tests/` + `package.json` | Geography contract tests (`npm ci && npm test`), run by CI on any push touching geo code or data |
| `CNAME`, `.nojekyll`, `og-preview.png` | GitHub Pages plumbing and the social-share image |

## How the data gets here

Every Sunday 06:00 UTC, the engine's weekly workflow extracts from
ClinicalTrials.gov, packages the artifacts, and pushes a single data commit
to this repo (you'll see them as "Update demographics data YYYY-MM-DD" from
github-actions). Each data file records when it was extracted
(`extracted_at`) and which engine commit produced it (`pipeline_commit`).
Nothing in this repo runs the pipeline anymore.

## Local development

It's a static site — serve the folder and open it:

```bash
python3 -m http.server 8000
# then http://localhost:8000
```

Geography tab changes should keep the contract tests green:

```bash
npm ci && npm test
```

## History

Until August 2026 this repo also contained the extraction pipeline. That
moved to `civicsample-engine`; the complete pre-split repo is preserved on
the [`pre-split-archive`](../../tree/pre-split-archive) branch and in git
history.
