# Anthropic progress deck

## Primary deliverable

`Presentation_for_Anthropic_Healthcare_filled.pptx` — the working Anthropic
Healthcare deck with its two placeholder slides filled in:

1. **Conclusions from Civic Sample Project so Far** — the four demographic
   dimensions from the dashboard (race, ethnicity, sex, geography), each with its
   segment shares, then the pivot to FDA-authorized medical AI.
2. **What we did with tokens, and where feedback would be most useful** — the
   extraction end to end, what a concept costs to pull out, and four questions
   for the Anthropic team.

### Placeholders to fill before presenting

| Slide | Placeholder | Who |
|---|---|---|
| 2 | `1 · THE REVIEW PROMPT` — dashed box | Maryam: paste the review prompt |
| 2 | Cost table rows 2–4, `[ Maryam — concept group ]` | Maryam: name the concept groups being retained, and their per-1,000-document costs |
| 2 | `PLACEHOLDER — efficiency` — dashed box | manual-review hours per document vs. pipeline time |

Dashed terracotta borders mark everything still to be supplied. Row 1 of the
cost table and the `2 · WHAT COMES BACK` sample are real and can stay as-is —
the sample is genuine Sonnet 4.6 output for DEN140025, which happens to show the
core finding: the device summary reports an age range but no sex, race or
ethnicity at all.

Rebuild after editing figures or swapping screenshots:

```bash
pip install python-pptx
python3 slides/fill_user_deck.py <source-deck.pptx> -o slides/Presentation_for_Anthropic_Healthcare_filled.pptx
```

The script never modifies the source deck and never touches slides 3–6.

### Matching the deck's styling

Measurements taken from slide 6, and reused verbatim by the script:

| Element | Spec |
|---|---|
| Canvas | 10 × 5.625 in |
| Font | Century Schoolbook throughout |
| Title | 18pt bold, `x=0.35 y=0.29`, width 9.30 |
| Subtitle | 10.5pt italic, `y=0.69` |
| Column header | 11pt, `y=1.02`, hairline rule beneath at `y=1.32` |
| Body | 8.5pt (9pt for lead-ins) |
| Footnote | 7pt, `y=5.26` |
| Columns | split at `x=5.90` with a vertical hairline |
| Ink | `111827` · muted `6D6C66` · green `15803D` · terracotta `B4483D` · rule `D9D8D3` |

## Also here

`anthropic-interim-progress.pptx` — an earlier standalone two-slide version on a
13.3 × 7.5 canvas with its own palette, built by `build_deck.js` before the
working deck was available. **Superseded** by the filled deck above; kept only
as a wide-format alternative.

## Regenerating the screenshots

`slides/img/` holds element-scoped captures of the live dashboard:

```bash
npm install playwright-core chart.js chartjs-plugin-datalabels d3@7 topojson-client@3 us-atlas@3
python3 -m http.server 8899 --bind 127.0.0.1 &
node slides/capture_screenshots.js
```

Four things the capture script handles that a plain screenshot won't:

- **Chart.js, D3, topojson and the US atlas are served from local `node_modules`**
  instead of jsdelivr / d3js.org, so charts and the choropleth render in
  environments with restricted egress. Without this the Geography tab is blank.
- **The Beta gate is pre-unlocked** by seeding `sessionStorage`
  (`betaExtractionUnlocked = '1'`) before page scripts run.
- **Tabs are activated by clicking** `.tab[data-tab="…"]`. Setting
  `location.hash` alone does *not* switch tabs — only `industryRoute` listens for
  `hashchange`.
- **The viewport is 1680px wide**, because the Geography tab refuses to render
  below desktop width.

The donut captures are then cropped to the ring itself (the on-canvas legend is
illegible at slide scale). The slide rebuilds the key underneath each ring from
`data/dashboard-summary.json`, with swatch colours sampled from the captured
pixels so the key matches the chart. Geography is a green choropleth rather than
a categorical chart, so its rows carry no swatches — they are US Census regions,
not map colours.

## Notes on the figures

- Slide 1's trial figures are the **all study types** cohort from
  `data/dashboard-summary.json` (79,297 trials). The live Overview tab defaults
  to the *Interventional* filter and shows 74,617 — label the cohort if you
  screenshot that tab.
- Slide 2 flags a discrepancy worth fixing before presenting: the
  `data/*_token_metrics.json` files hardcode Opus 4.7 at **$15/$75** per 1M
  tokens, while the current rate is **$5/$25** (and `scripts/utils/cost_tracker.py`
  already uses the correct figure). The dashboard's projected costs come from the
  metrics JSON and so read roughly 3× high for Opus. The AI for Science proposal's
  own budget uses the correct rate — only the dashboard display is stale.
- The ~1,400-token estimate for the cacheable prefix (system prompt + tool schema)
  is a 4-chars-per-token approximation. Confirm with `messages.count_tokens`
  before acting on the prompt-caching question.
