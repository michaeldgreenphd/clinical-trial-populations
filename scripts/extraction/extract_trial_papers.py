#!/usr/bin/env python3
"""
Clinical Trial Manuscript Demographic Extraction Pipeline — 3-Way Model Comparison

Reads open-access clinical trial manuscript PDFs from
`data/Clinical Trials Manuscripts/`, cross-references each filename (NCT ID)
with `data/pilot_clinical_trials_targets.csv` to inject trial metadata
(Condition, Intervention, Total Participants), and runs each manuscript
through three Anthropic models (Haiku 4.5, Sonnet 4.6, Opus 4.7) to
compare extraction quality and cost.

Filenames are expected to start with the NCT identifier, e.g.
`NCT06199934.pdf` or `NCT06199934_primary_results.pdf`. Anything that isn't
obviously an NCT ID falls back to the sanitized filename stem so the pipeline
still runs; the metadata join will simply miss on those rows.

PDF fetching is decoupled from extraction — this script only reads local
files so it can run in constrained environments (e.g., GitHub Actions)
without outbound access to publisher sites.

Safety valve:
  - `RUN_MODE=pilot-test` (default)  → process at most `PILOT_LIMIT` PDFs
  - `RUN_MODE=full-extraction`       → process every PDF in the folder

Outputs:
  - data/trials_lit_extracted.json    (per-document, per-model results)
  - data/trials_lit_token_metrics.json (aggregate per-model token usage)

Requires:
  - ANTHROPIC_API_KEY environment variable
  - pip install anthropic pdfplumber
"""

import csv
import glob
import json
import os
import re
import sys
import time

import anthropic
import pdfplumber

PILOT_LIMIT = 2
# PDF_DIR is resolved at runtime based on RUN_MODE — pilot-test reads from a
# small curated pilot folder; full-extraction reads the full manuscript corpus.
PILOT_PDF_DIR = "data/pilot_trials_manuscripts"
FULL_PDF_DIR  = "data/Clinical Trials Manuscripts"
METADATA_CSV = "data/pilot_clinical_trials_targets.csv"
OUTPUT_DATA = "data/trials_lit_extracted.json"
OUTPUT_METRICS = "data/trials_lit_token_metrics.json"

# Total clinical trials in the AACT dataset — used for cost-projection math
# alongside the pilot token counts.
TOTAL_STUDIES = 77347

MODELS = [
    {"key": "haiku_4_5",  "id": "claude-haiku-4-5-20251001", "label": "Haiku 4.5",  "input_cost_per_m": 1.00,  "output_cost_per_m": 5.00},
    {"key": "sonnet_4_6", "id": "claude-sonnet-4-6",         "label": "Sonnet 4.6", "input_cost_per_m": 3.00,  "output_cost_per_m": 15.00},
    {"key": "opus_4_7",   "id": "claude-opus-4-7",           "label": "Opus 4.7",   "input_cost_per_m": 15.00, "output_cost_per_m": 75.00},
]

NCT_RE = re.compile(r"(NCT\d{8})", re.IGNORECASE)
# Filenames are structured like `2026-04-18_NCT02349132_01_Tier1.pdf`; the
# trailing `_Tier<N>` token is the manuscript-quality tier assigned during
# triage. `Tier[_\s-]*(\d+)` tolerates `Tier1`, `Tier 1`, `Tier_1`, etc.
TIER_RE = re.compile(r"Tier[_\s-]*(\d+)", re.IGNORECASE)

client = anthropic.Anthropic()

EXTRACTION_PROMPT = """\
You are a clinical data extractor specializing in published clinical trial manuscripts. Extract demographic, socioeconomic, clinical-context, and functional status data of the trial cohort.

Extract ONLY information explicitly stated in the text. If a field is not mentioned, return "Not Reported".

CRITICAL: "Unknown" is an explicit reporting category. If the paper explicitly lists "Unknown" or "Not Stated" with a count, record that number. Do not confuse this with implicitly missing data.

For Age, Disability/Functional Limitations, and Religion, provide a concise string summary of how the data is reported (e.g., "Mean 65.2 (SD 5.1)" or "ECOG Performance Status 1-2").

LINKAGE CRITICAL: We must link this manuscript to ClinicalTrials.gov if possible. Scan the text for any ClinicalTrials.gov identifier (format: NCT followed by 8 digits) and list it under associated_nct_ids.

CLINICAL CONTEXT: Scan the "Methods", "Study Design", "Patients and Methods", or "Background" sections for:
- `target_patient_age_range`: the inclusion-criteria age range (e.g., "18-80 years of age", ">=18 years"). Prefer verbatim phrasing. Return "Not Reported" if only a mean/median is given without a range.
- `study_design`: a concise 1-2 sentence summary of the trial design (randomised vs. single-arm, blinding, comparator, number of sites, primary endpoint).

Return a single valid JSON object with this exact schema:
{
  "associated_nct_ids": ["list of strings"] or "Not Reported",
  "target_patient_age_range": "string or 'Not Reported'",
  "study_design": "string or 'Not Reported'",
  "total_participants": integer or "Not Reported",
  "age": "string summary or 'Not Reported'",
  "geography": {
    "us_states": ["list of strings"] or "Not Reported",
    "countries": ["list of strings"] or "Not Reported",
    "total_sites": integer or "Not Reported"
  },
  "sex": {
    "female": integer or "Not Reported",
    "male": integer or "Not Reported",
    "unknown": integer or "Not Reported"
  },
  "gender": {
    "woman": integer or "Not Reported",
    "man": integer or "Not Reported",
    "non_binary": integer or "Not Reported",
    "transgender": integer or "Not Reported",
    "other": integer or "Not Reported",
    "unknown": integer or "Not Reported"
  },
  "race_nih_omb": {
    "american_indian_or_alaska_native": integer or "Not Reported",
    "asian": integer or "Not Reported",
    "black_or_african_american": integer or "Not Reported",
    "native_hawaiian_or_other_pacific_islander": integer or "Not Reported",
    "white": integer or "Not Reported",
    "more_than_one_race": integer or "Not Reported",
    "unknown": integer or "Not Reported"
  },
  "ethnicity": {
    "hispanic_or_latino": integer or "Not Reported",
    "not_hispanic_or_latino": integer or "Not Reported",
    "unknown": integer or "Not Reported"
  },
  "socioeconomic_status": {
    "education": "string summary or 'Not Reported'",
    "income": "string summary or 'Not Reported'",
    "wealth": "string summary or 'Not Reported'",
    "family_size": "string summary or 'Not Reported'",
    "adi_area_deprivation_index": "string summary or 'Not Reported'"
  },
  "disability_and_functional_limitations": "string summary or 'Not Reported'",
  "religion": "string summary or 'Not Reported'"
}

Return ONLY the JSON object, no other text."""


def resolve_mode() -> str:
    """Return the normalised RUN_MODE, defaulting to pilot-test."""
    mode = (os.environ.get("RUN_MODE") or "pilot-test").strip().lower()
    if mode not in ("pilot-test", "full-extraction"):
        print(f"  ! Unknown RUN_MODE {mode!r} — defaulting to pilot-test",
              file=sys.stderr)
        return "pilot-test"
    return mode


def resolve_limit(mode: str) -> int | None:
    """Pilot-test caps at PILOT_LIMIT docs; full-extraction removes the cap."""
    return None if mode == "full-extraction" else PILOT_LIMIT


def resolve_pdf_dir(mode: str) -> str:
    """Pilot-test reads the curated `pilot_trials_manuscripts/` folder; full
    extraction reads the full `Clinical Trials Manuscripts/` corpus."""
    return FULL_PDF_DIR if mode == "full-extraction" else PILOT_PDF_DIR


def tier_from_filename(stem: str) -> str | None:
    """Pull the `Tier N` token out of a manuscript filename stem. Returns
    None if the stem doesn't contain one."""
    m = TIER_RE.search(stem)
    return f"Tier {m.group(1)}" if m else None


def nct_from_filename(stem: str) -> str | None:
    """Extract the first NCT identifier from a filename stem, upper-cased.
    Returns None if the stem doesn't contain one."""
    m = NCT_RE.search(stem)
    return m.group(1).upper() if m else None


def build_metadata_index(csv_path: str) -> dict[str, dict]:
    """Map NCT ID -> CSV row. Returns {} if the CSV is missing."""
    if not os.path.exists(csv_path):
        print(f"  ! metadata CSV not found: {csv_path} "
              f"(continuing with empty metadata)", file=sys.stderr)
        return {}
    idx: dict[str, dict] = {}
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            nct = (row.get("NCT Number") or row.get("nct_id") or "").strip().upper()
            if nct:
                idx[nct] = row
    return idx


def lookup_metadata(index: dict[str, dict], nct: str | None) -> dict:
    """Return the metadata block for the results payload, injecting whatever
    the CSV provides. Always returns the expected shape so downstream
    consumers don't have to branch on missing metadata."""
    row = index.get(nct or "", {})
    total = row.get("Total Participants") or row.get("total_participants") or ""
    try:
        total_int = int(total) if str(total).strip().isdigit() else None
    except (ValueError, TypeError):
        total_int = None
    return {
        "nct_id": nct or "Not Reported",
        "condition": (row.get("Condition") or "Not Reported").strip() or "Not Reported",
        "intervention": (row.get("Intervention") or "Not Reported").strip() or "Not Reported",
        "ctgov_total_participants": total_int if total_int is not None else "Not Reported",
    }


def discover_pilot_pdfs(pdf_dir: str) -> list[tuple[str, str, str | None]]:
    """Return (identifier, pdf_path, tier) triples sorted by filename.
    Identifier is the NCT ID if parseable from the filename, else the raw
    stem. `tier` is "Tier 1" / "Tier 2" / … or None if not encoded in the
    filename."""
    if not os.path.isdir(pdf_dir):
        print(f"  ! manuscript directory not found: {pdf_dir}", file=sys.stderr)
        return []
    paths = sorted(glob.glob(os.path.join(pdf_dir, "*.pdf")))
    triples: list[tuple[str, str, str | None]] = []
    for p in paths:
        stem = os.path.splitext(os.path.basename(p))[0]
        nct = nct_from_filename(stem)
        tier = tier_from_filename(stem)
        triples.append((nct or stem, p, tier))
    return triples


def extract_text_from_local_pdf(path: str) -> str | None:
    try:
        with pdfplumber.open(path) as pdf:
            pages = [p.extract_text() for p in pdf.pages if p.extract_text()]
            if not pages:
                return None
            return "\n\n".join(pages)
    except Exception as e:
        print(f"  ✗ PDF parse failed ({path}): {e}", file=sys.stderr)
        return None


def extract_with_model(text: str, model_id: str) -> tuple[dict, dict]:
    response = client.messages.create(
        model=model_id,
        max_tokens=2000,
        messages=[{
            "role": "user",
            "content": f"{EXTRACTION_PROMPT}\n\n--- MANUSCRIPT TEXT ---\n{text}"
        }]
    )
    token_usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }
    try:
        data = json.loads(response.content[0].text)
    except (json.JSONDecodeError, IndexError):
        data = {"error": "Failed to parse response"}
    return data, token_usage


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    run_mode = resolve_mode()
    limit = resolve_limit(run_mode)
    pdf_dir = resolve_pdf_dir(run_mode)

    print("Clinical Trial Manuscript 3-Way Model Comparison Pipeline")
    print(f"  RUN_MODE:      {run_mode}  (limit={'none' if limit is None else limit})")
    print(f"  PDF dir:       {pdf_dir}")
    print(f"  Metadata CSV:  {METADATA_CSV}")

    metadata_index = build_metadata_index(METADATA_CSV)
    all_pdfs = discover_pilot_pdfs(pdf_dir)
    pilot = all_pdfs if limit is None else all_pdfs[:limit]

    if not pilot:
        print(f"  No PDFs found in {pdf_dir}. Nothing to do — exiting cleanly.",
              file=sys.stderr)
        sys.exit(0)

    print(f"  Found {len(all_pdfs)} PDFs; processing {len(pilot)}\n")

    results = []
    model_totals = {m["key"]: {"input": 0, "output": 0, "docs": 0} for m in MODELS}

    for i, (ident, pdf_path, tier) in enumerate(pilot):
        nct = ident if NCT_RE.fullmatch(ident) else None
        metadata = lookup_metadata(metadata_index, nct)
        tier_label = tier or "Not Reported"
        print(f"[{i+1}/{len(pilot)}] {ident}  [{tier_label}]")
        print(f"  ↪ {pdf_path}")
        print(f"  metadata: condition={metadata['condition']} "
              f"intervention={metadata['intervention']} "
              f"N={metadata['ctgov_total_participants']}")

        text = extract_text_from_local_pdf(pdf_path)
        if not text:
            print(f"  ✗ No text from PDF")
            results.append({
                "identifier": ident,
                "nct_id": nct or "Not Reported",
                "tier": tier_label,
                "local_pdf_path": pdf_path,
                "metadata": metadata,
                "extraction_status": "pdf_failed",
                "models": {},
            })
            continue

        print(f"  ✓ Full PDF: {len(text):,} chars")

        model_results = {}
        for model in MODELS:
            mkey = model["key"]
            mid = model["id"]
            label = model["label"]
            print(f"    → {label} ({mid})...", end=" ", flush=True)
            try:
                data, tokens = extract_with_model(text, mid)
                # Carry the manuscript tier into the per-model payload too so
                # the dashboard can surface it even from the per-model view.
                wrapped = {"metadata": metadata, "tier": tier_label, "extracted_data": data}
                model_results[mkey] = {
                    "model_id": mid,
                    "label": label,
                    "data": wrapped,
                    "input_tokens": tokens["input_tokens"],
                    "output_tokens": tokens["output_tokens"],
                }
                model_totals[mkey]["input"] += tokens["input_tokens"]
                model_totals[mkey]["output"] += tokens["output_tokens"]
                model_totals[mkey]["docs"] += 1
                print(f"{tokens['input_tokens']:,} in / {tokens['output_tokens']:,} out")
            except Exception as e:
                print(f"ERROR: {e}")
                model_results[mkey] = {
                    "model_id": mid,
                    "label": label,
                    "data": {"metadata": metadata, "tier": tier_label, "extracted_data": {"error": str(e)}},
                    "input_tokens": 0,
                    "output_tokens": 0,
                }
            time.sleep(1)

        results.append({
            "identifier": ident,
            "nct_id": nct or "Not Reported",
            "tier": tier_label,
            "local_pdf_path": pdf_path,
            "metadata": metadata,
            "extraction_status": "success",
            "models": model_results,
        })

    print(f"\nWriting {len(results)} results to {OUTPUT_DATA}")
    os.makedirs(os.path.dirname(OUTPUT_DATA), exist_ok=True)
    with open(OUTPUT_DATA, "w") as f:
        json.dump(results, f, indent=2)

    per_model = {}
    for model in MODELS:
        mkey = model["key"]
        t = model_totals[mkey]
        docs = t["docs"] or 1
        per_model[mkey] = {
            "model_id": model["id"],
            "label": model["label"],
            "input_cost_per_m": model["input_cost_per_m"],
            "output_cost_per_m": model["output_cost_per_m"],
            "avg_input_per_doc": t["input"] / docs,
            "avg_output_per_doc": t["output"] / docs,
            "total_input_tokens": t["input"],
            "total_output_tokens": t["output"],
            "docs_processed": t["docs"],
        }

    metrics = {
        "run_mode": run_mode,
        "pilot_size": len([r for r in results if r["extraction_status"] == "success"]),
        "total_studies": TOTAL_STUDIES,
        "per_model": per_model,
    }
    print(f"Writing metrics to {OUTPUT_METRICS}")
    with open(OUTPUT_METRICS, "w") as f:
        json.dump(metrics, f, indent=2)

    print("\nDone.")


if __name__ == "__main__":
    main()
