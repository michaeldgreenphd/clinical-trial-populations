# Pre-Publication Audit — clinical-trial-populations

**Date:** 2026-07-08 · **Scope:** full worktree at `main`, complete git history (604 commits, 12 branches, 9 tags = 828 historical text blobs), all 3 workflow files + 58 historical workflow versions, PR/issue text, GitHub Actions run history (439 runs).
**Purpose:** (1) security/exposure audit before making the repository public; (2) GitHub Actions cost prevention.

> ⚠️ Sensitive values found by this audit are referenced by file/line only — they are deliberately **not** reproduced in this document.

---

## 0. The single most important context

**Most of this repository is already public.** GitHub Pages deploys the entire `main` branch to the custom domain in `CNAME`, and `.nojekyll` disables all file filtering. Every file at HEAD of `main` — extraction scripts, notebooks, the README, the manuscript PDFs, data files — is already downloadable from the live site by anyone who knows or guesses the path. What flipping the repo to public *newly* exposes is:

1. **Git history** (all old versions of every file, on all branches),
2. **Non-`main` branches** (11 of them),
3. **Pull-request / issue threads** (212+ PRs and their comments),
4. **GitHub Actions run logs** (all runs within the 90-day retention window),
5. Repo metadata (contributor list, commit emails, timestamps).

The audit therefore focused hardest on those five surfaces. Good news: they are largely clean (see §1.4).

---

## 1. Security & Exposure Audit

### 1.1 Method

- `detect-secrets` + targeted pattern scans (Anthropic/OpenAI/Google/AWS/GitHub token formats, OAuth client secrets, private keys, connection strings) over the full worktree **and** over every text blob ever committed on any branch or tag.
- Manual read of all workflows, all Python in `scripts/`, `src/`, `extraction_pipeline/`, both notebooks (including output cells), all Markdown docs, `app.js` (383 KB) and every subdirectory HTML page.
- 58 historical versions of the workflow YAMLs reviewed for fork-reachable secret paths.
- PR/issue full-text search for pasted credentials.
- EXIF inspection of both headshot JPEGs.
- Six independent scan dimensions, every finding adversarially re-verified against the exact file/line before inclusion.

### 1.2 Findings — fix BEFORE flipping to public

| # | Severity | What | Where |
|---|----------|------|-------|
| B1 | Medium | Hardcoded shared **Beta-tab password** and **curator passwords** (curators' first names) in client-side JS | `app.js:6360-6361`, enforced at `app.js:6448` and `:6459`; present in ~16 historical versions since 2026-04-17 (commit `bbdf215`) |
| B2 | Medium | **Plaintext password table in README** — documents both passwords and states they exist only because the repo is private ("rotate them if the repository is ever made public") | `README.md:170-186` |
| B3 | Medium | **20 published journal-article PDFs** (~20 MB, NCT-numbered manuscripts) would be redistributed publicly — copyright/licensing exposure; several are likely paywalled publisher versions | `pilot_trials_manuscripts/` (already served by the live site today) |
| B4 | Medium | **Actions run logs become publicly readable on flip.** Logs within the 90-day retention window include extraction-run output, Google Drive child-folder/file IDs and raw Drive API error bodies printed by `scripts/gdrive_upload.py:43-129` | Actions run history (esp. Apr–Jul runs) |
| B5 | Low | **Personal Gmail address** hardcoded as Unpaywall contact (project's public contact elsewhere is the site's info@ address) | `extraction_pipeline/lit_extractor.py:152` (used in request URL at `:278`); also in 11 historical blob versions |
| B6 | Low | "Gated" datasets are **fetchable without any password** — the client-side gate protects nothing; raw unreviewed LLM extraction outputs and the industry-sponsor analysis are fully public artifacts | `app.js:8678`, `:6534-6538`; `data/industry_sponsors.json`, `data/fda_extracted_latest.csv`, `data/lit_extracted_latest.csv`, etc. |

**Action plan for B1/B2:** treat both passwords as burned (they are in git history and in the already-public `app.js` on the live site). Remove the password table from README, remove/rotate the constants in `app.js`, and accept that the Beta tabs and `/#industry` are public — or move genuinely private review UIs off GitHub Pages entirely (e.g. a separate private deployment). History rewrite is *not* required if you rotate, since the old values stop mattering.

**Action plan for B3:** delete `pilot_trials_manuscripts/` from `main` before the flip. Note the PDFs remain in git history; if licensing risk is a concern, rewrite history for that path (`git filter-repo --path pilot_trials_manuscripts --invert-paths`) — this also removes ~20 MB from every future clone.

**Action plan for B4:** before the flip, delete old workflow runs (each run's ⋯ menu → *Delete workflow run*, or loop over `DELETE /repos/{owner}/{repo}/actions/runs/{id}`) or reduce **Settings → Actions → General → Artifact and log retention** to 1 day and wait a day. Optionally stop printing Drive IDs/error bodies in `gdrive_upload.py`.

**Action plan for B5:** replace with the project contact address or an env var. The address also lives in history; rewriting history for your own email is usually not worth it — your call.

### 1.3 Findings — hardening (recommended, not blocking)

| # | Severity | What | Where |
|---|----------|------|-------|
| H1 | Medium | **Unpinned runtime dependencies** (`>=` floors, no hashes; ad-hoc `pip install` lines) installed in jobs that hold `ANTHROPIC_API_KEY`, Vertex service-account JSON, Drive OAuth secrets and a `contents: write` token with persisted credentials. A malicious release of any dependency runs with all of that. | `requirements.txt`, `scripts/extraction/requirements.txt`, `extract.yml:28`, `run_extractions.yml:70` + 6 bare `pip install requests` steps |
| H2 | Low | **Vertex service-account JSON written via raw `echo '${{ secrets… }}'` interpolation** into the workspace root; never deleted, not gitignored. A quote character in the secret breaks quoting (shell-injection-shaped); a future `git add -A` would commit the key. | `run_extractions.yml:75-77` |
| H3 | Low | CI bot pushes unreviewed commits **directly to `main`**, which is the live website source (no branch protection possible for the bot flow as designed) | all three workflows' commit steps |
| H4 | Low | Third-party scripts loaded without SRI or version pins, plus **runtime `eval` of Babel-compiled JSX from a CDN** for the approval-queue tab | `index.html:30-31`, `app.js:578`, `:6507-6530` |
| H5 | Low | A few unescaped `innerHTML` interpolations of registry-sourced fields (`nct_id` into an `onclick`, status/phase/date fields) — no reachable XSS today, but brittle | `app.js:2072-2092`, `:5240` |
| H6 | Low | Literature pipeline downloads and parses PDFs from third-party URLs with **no size cap / content-type check / parse timeout** (CI DoS + parser-exploit surface) | `extraction_pipeline/lit_extractor.py:277-303`, `fda_extractor.py:282-289` |
| H7 | Info | Full-res original headshots (3000 px Canon JPEGs) carry photographer copyright metadata ("HuthPhoto / Ken Huth 2024") — no GPS data. Confirm you have redistribution rights; the site only needs the `.webp` derivatives. | `Michael Headshot.jpg`, `Maryam Headshot.jpeg` (repo root) |
| H8 | Info | LLM extraction outputs publish to the live site with no human review step (data-poisoning pathway via upstream sources) — acceptable residual risk, consider a review gate | commit steps of `run_extractions.yml` / `extract.yml` |

Concrete fixes for H1/H2:

```yaml
# checkout without leaving a writable token on disk except where needed
- uses: actions/checkout@v4        # better: pin to a commit SHA
  with:
    persist-credentials: false

# Vertex auth: never interpolate the secret into script text
- name: Authenticate Vertex AI
  if: ${{ inputs.ai_provider == 'vertex_gemini' }}
  env:
    VERTEX_JSON: ${{ secrets.VERTEX_CREDENTIALS_JSON }}
  run: |
    printf '%s' "$VERTEX_JSON" > "$RUNNER_TEMP/vertex_key.json"
    echo "GOOGLE_APPLICATION_CREDENTIALS=$RUNNER_TEMP/vertex_key.json" >> "$GITHUB_ENV"
```
(better still: `google-github-actions/auth` with Workload Identity Federation — no long-lived key at all). Pin Python deps with `pip-compile --generate-hashes` and install with `--require-hashes`.

### 1.4 Verified clean (checked, no issue found)

- **No API keys, tokens, private keys, or cloud credentials in any of the 828 text blobs across all 604 commits / 12 branches / 9 tags.** All secret usage goes through `${{ secrets.* }}` → env vars, correctly.
- **No `.env`, key files, or service-account JSON ever committed** (checked every path name ever committed, including deleted files; `vertex_key.json` never entered git).
- **Workflow trigger surface clean across all 58 historical workflow versions:** no `pull_request_target`, no fork-reachable secret path; `workflow_dispatch` requires write access; no untrusted `${{ }}` interpolation of attacker-controllable context.
- **No secrets in PR/issue text** (full-text search; the Beta password string appears in no PR/issue).
- **No token-bearing URLs, Google Drive share links, or analytics IDs** in code or history.
- **Headshots contain no GPS EXIF.**
- `gdrive_upload.py` reads all credentials from env; GitHub masks registered secret values in logs.

### 1.5 Residual items this audit could not check

- Contents of large binary blobs in history (data `.gz` archives — aggregate ClinicalTrials.gov data by provenance; and the manuscript PDFs, flagged above).
- The actual text of existing Actions logs (inferred from the scripts' print statements — see B4).
- GitHub settings surfaces: collaborators, deploy keys, webhooks, repo secrets list. Review **Settings → Security** before the flip.
- After flipping: enable **secret scanning + push protection** (free on public repos) and **Dependabot alerts**.

---

## 2. GitHub Actions — where the minutes went, and how to stop the bleeding

### 2.1 The numbers (from the Actions API, all 439 runs)

| Workflow | Trigger | Runs (lifetime) | Typical duration | Worst case |
|---|---|---|---|---|
| `pages-build-deployment` (automatic) | **every push to `main`** | **332** | 2.5 min (small tree) → **10–19 min** (Jun–Jul 3, ~830 MB tree) | 19.2 min |
| Run Extraction Pipelines (`run_extractions.yml`) | manual dispatch | 30 | 5–42 min | **174 min** (28 Apr, manually cancelled) |
| Extract Demographics Data (`extract.yml`) | **cron weekly** + manual | 65 | 12–16 min | 15.9 min |
| Backfill Snapshots (`backfill-releases.yml`) | manual dispatch | 12 | ~4 min | 17 min |

Job-level evidence:

- **Pages deploy = the volume killer.** Each deploy is 2–3 billable jobs: on 3 Jul, `build` took 8.9 min (6m06s just *checking out* the ~830 MB tree + 2m44s uploading it) plus `deploy` 4.1 min ⇒ ~14 billable min for one push. There were **26 deploys in the first 5 days of July** — every human push, every Claude-session PR merge, and every CI data commit triggers one. After the 5 Jul snapshot prune shrank the payload, deploys fell to ~2.4 min — direct proof that **deploy time scales with the size of the tree**.
- **`run_extractions.yml` = the spike killer.** The 28 Apr run sat in "Run Clinical Trials Literature Extraction" (`scripts/extraction/extract_trial_papers.py`) for **2 h 37 m** until manually cancelled. **No job or step anywhere sets `timeout-minutes`**, so the only cap is GitHub's 6-hour job limit. April alone: 462 min from this workflow.
- **`extract.yml` (weekly cron)** ≈ 55–65 min/month: 8m10s crawling the ClinicalTrials.gov API + 2m26s committing/pushing ~150 MB of new snapshot data (which then triggers another full Pages deploy).
- Note: the 3,000-min pool is **per account**, not per repo — if the overage exceeds what this table explains, check the per-repository table under **Settings → Billing → Usage this month**.

### 2.2 Stop the bleeding TODAY (no code changes, all reversible)

1. **Hard-stop any possibility of overage billing:** *Billing & plans → Spending limits → Actions* → set the spending limit to **$0**. Workflows then simply stop running once free minutes are exhausted — overage charges become structurally impossible. Do this first; it is the only step that *guarantees* "no overage billing".
2. **Disable the cron workflow:** *Actions tab → "Extract Demographics Data" → ⋯ menu → Disable workflow*. (Same for "Run Extraction Pipelines" and "Backfill Snapshots" — they are manual-only, but disabling prevents accidental dispatch.) Re-enable with the same menu later. CLI equivalent: `gh workflow disable extract.yml`.
3. **Stop the automatic Pages rebuilds** (the built-in `pages-build-deployment` cannot be disabled from the Actions tab). Options, least to most drastic:
   - stop pushing to `main` (batch your merges) until you flip public;
   - *Settings → Pages* → switch **Source** from "Deploy from a branch" to "GitHub Actions" *without adding a deploy workflow* — branch pushes stop building; the last-deployed site stays live;
   - *Settings → Actions → General → Disable Actions* for the repo (kills everything, including Pages builds).
4. **Know the endgame:** the moment the repo is public, **standard-runner Actions minutes are free and unmetered** — the entire billing problem evaporates at the flip. The disable steps above only need to hold until then.

### 2.3 Make it cheap and safe permanently

**a. Cap every job (protects money *and* your LLM API spend — a runaway extraction burns Anthropic/Vertex tokens too):**

```yaml
jobs:
  extract:
    runs-on: ubuntu-latest
    timeout-minutes: 30          # extract.yml (typ. 12-16 min)
    # run_extractions.yml: job-level 120, plus per-step:
    # - name: Run Clinical Trials Literature Extraction
    #   timeout-minutes: 45
```

**b. Prevent pile-ups:**

```yaml
concurrency:
  group: ${{ github.workflow }}
  cancel-in-progress: true
```

**c. Shrink the Pages payload (the big lever — evidence: 11 min → 2.4 min after the 5 Jul prune):**
- `snapshots/` is **559 MB of the 830 MB tree**; `data/details.part*.json.gz` is another 82 MB. Serve historical snapshots as **GitHub Release assets** (free storage/bandwidth, no per-deploy cost) and have the frontend fetch release URLs, or tighten `scripts/prune_snapshots.py` retention further.
- Longer term, switch Pages to **GitHub Actions source** with an explicit `actions/upload-pages-artifact` step that packages *only site files* — excludes `scripts/`, notebooks, manuscripts, full-res photos, `.github/`. That cuts deploy time *and* closes most of §1's exposure surface in one move.

**d. Reduce deploy count:** every merge to `main` = one full deploy (5 PR merges on 3 Jul = 5 deploys ≈ 60 min). Batch feature merges; let the weekly data commit be the only routine trigger.

**e. Micro-optimizations:** `actions/checkout` with `sparse-checkout: [src, scripts, config, data]` in `extract.yml` (its 62 s checkout → ~10 s); `actions/setup-python` with `cache: pip`; replace the six ad-hoc `pip install requests` steps with one pinned requirements install (also fixes H1).

**f. Consider cadence:** snapshot retention is already bi-weekly — if weekly freshness isn't essential, guard the cron with a week-parity check and halve the extraction cost.

---

## 3. Pre-flip checklist (condensed)

- [ ] Set Actions spending limit to $0 (§2.2-1)
- [ ] Disable the three file-based workflows (§2.2-2)
- [ ] Remove password table from README + rotate/remove `BETA_PASSWORD` / `CURATOR_PASSWORDS` in `app.js` (B1/B2)
- [ ] Delete `pilot_trials_manuscripts/` from `main`; decide on history rewrite (B3)
- [ ] Purge old Actions run logs / set retention to minimum (B4)
- [ ] Swap personal Gmail out of `lit_extractor.py` (B5)
- [ ] Decide explicitly that Beta/industry datasets are public, or move them off Pages (B6)
- [ ] Review Settings: collaborators, deploy keys, webhooks, secrets list
- [ ] Flip visibility → then enable secret scanning + push protection + Dependabot
- [ ] Re-enable workflows (minutes are now free); add `timeout-minutes` + `concurrency` first (§2.3)
