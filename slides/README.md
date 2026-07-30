# Anthropic interim-progress deck

Two-slide shell for the Anthropic progress update:

1. **Same question, new frontier** — what the clinical-trial work found, and how the
   same method points at FDA-authorized AI/ML devices.
2. **How we've used the API credits** — pilot spend to date, the full-scale
   projection, and four questions we want the Anthropic team to weigh in on.

Output: `anthropic-interim-progress.pptx`

## Rebuilding

```bash
npm install pptxgenjs                 # build
node slides/build_deck.js
```

Every figure in `build_deck.js` is traceable to a file in this repo; sources are
noted in comments beside each block and in the slide footers. If you edit the
numbers, edit them there rather than in PowerPoint, so the deck stays
regenerable.

## Regenerating the screenshots

`slides/img/` holds element-scoped captures of the live dashboard. To refresh
them after a dashboard change:

```bash
npm install playwright-core chart.js chartjs-plugin-datalabels
python3 -m http.server 8899 --bind 127.0.0.1 &   # serve the repo root
node slides/capture_screenshots.js
```

Two things the capture script handles that a plain screenshot won't:

- **Chart.js is served from the local `node_modules`** instead of the jsdelivr
  CDN, so the charts render in environments with restricted egress.
- **The Beta gate is pre-unlocked** by seeding `sessionStorage`
  (`betaExtractionUnlocked = '1'`) before page scripts run — the extraction tabs
  are password-gated and would otherwise never render.

Tabs are activated by clicking `.tab[data-tab="…"]`. Setting `location.hash`
alone does **not** switch tabs — only `industryRoute` listens for `hashchange`.

## A note on the figures

Slide 1's trial figures are the **all study types** cohort from
`data/dashboard-summary.json` (79,297 trials). The live Overview tab defaults to
the *Interventional* filter and so shows 74,617 — if you screenshot that tab,
label which cohort you're showing.

Slide 2 flags a real discrepancy worth fixing before this is presented: the
`data/*_token_metrics.json` files hardcode Opus at **$15/$75** per 1M tokens,
while `scripts/utils/cost_tracker.py` uses **$5/$25**. The dashboard's projected
costs are computed from the former and are therefore roughly 3× high for Opus.
