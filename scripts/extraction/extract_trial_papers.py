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
You are a clinical data extractor specializing in published clinical trial manuscripts. Record demographic, socioeconomic, clinical-context, and functional-status data of the trial cohort via the `record_extracted_data` tool.

The manuscript text is delimited by `--- PAGE N ---` markers. Every evidence quote you record MUST come from the page that immediately precedes the text you're quoting, and you must record that page number on the field.

Before calling the extraction tool, use a <thinking> block to locate the sections containing the demographic and clinical context data. Specifically, scan "Methods", "Study Design", "Patients and Methods", and "Background" sections for clinical context, and the cohort / participants tables for demographics.

CRITICAL: The "Explicit Unknown" category is a specific reported value, completely distinct from "Not Reported" (missing) data. If researchers explicitly state a value is unknown, unrecorded, or declined, record the count under "unknown". If they fail to mention the category entirely, record "Not Reported".

LINKAGE CRITICAL: We must link this manuscript to ClinicalTrials.gov if possible. Scan the text for any NCT identifier (format: NCT followed by 8 digits) and place them under `associated_nct_ids`.

For every field, populate:
- `value`: the extracted value (or the literal string "Not Reported" for scalars / empty list for list-typed fields when the document is silent).
- `exact_quote`: a verbatim excerpt from the document that proves the value (empty string when "Not Reported").
- `page_number`: the integer page number (1-indexed) where the quote appears (0 when "Not Reported").
"""


def _ev(description: str, value_schema: dict) -> dict:
    return {
        "type": "object",
        "description": description,
        "properties": {
            "value": value_schema,
            "exact_quote": {"type": "string", "description": "Verbatim excerpt proving the value. Empty if Not Reported."},
            "page_number": {"type": "integer", "description": "1-indexed page number from `--- PAGE N ---` markers. 0 if Not Reported."},
        },
        "required": ["value", "exact_quote", "page_number"],
    }


_EV_STR = {"type": "string", "description": "Extracted value, or the literal string 'Not Reported'."}
_EV_INT = {"type": ["integer", "string"], "description": "Extracted integer, or the literal string 'Not Reported'."}
_EV_LIST = {"type": "array", "items": {"type": "string"}, "description": "Extracted list of strings; empty array if none."}


def _breakdown(description: str, fields: list[str]) -> dict:
    return {
        "type": "object",
        "description": description,
        "properties": {f: _ev(f"Count of {f.replace('_', ' ')}", _EV_INT) for f in fields},
        "required": list(fields),
    }


EXTRACTION_TOOL = {
    "name": "record_extracted_data",
    "description": "Record evidence-grounded demographic, clinical-context, SES, and functional-status data extracted from a published clinical trial manuscript.",
    "input_schema": {
        "type": "object",
        "properties": {
            "associated_nct_ids": _ev("ClinicalTrials.gov NCT identifiers referenced in the manuscript.", _EV_LIST),
            "target_patient_age_range": _ev("Inclusion-criteria age range, verbatim when possible.", _EV_STR),
            "study_design": _ev("Concise 1-2 sentence summary of the trial design.", _EV_STR),
            "total_participants": _ev("Total N in the trial cohort.", _EV_INT),
            "age": _ev("String summary of how age is reported (e.g., 'Mean 65.2 (SD 5.1)').", _EV_STR),
            "geography": {
                "type": "object",
                "properties": {
                    "us_states": _ev("US states represented.", _EV_LIST),
                    "countries": _ev("Countries represented.", _EV_LIST),
                    "total_sites": _ev("Total number of trial sites.", _EV_INT),
                },
                "required": ["us_states", "countries", "total_sites"],
            },
            "sex": _breakdown("Participant sex breakdown.", ["female", "male", "unknown"]),
            "gender": _breakdown("Participant gender identity breakdown.",
                                 ["woman", "man", "non_binary", "transgender", "other", "unknown"]),
            "race_nih_omb": _breakdown("Participant race breakdown (NIH/OMB categories).", [
                "american_indian_or_alaska_native", "asian", "black_or_african_american",
                "native_hawaiian_or_other_pacific_islander", "white",
                "more_than_one_race", "unknown",
            ]),
            "ethnicity": _breakdown("Participant ethnicity breakdown.",
                                    ["hispanic_or_latino", "not_hispanic_or_latino", "unknown"]),
            "socioeconomic_status": {
                "type": "object",
                "properties": {
                    "education": _ev("Education summary.", _EV_STR),
                    "income": _ev("Income summary.", _EV_STR),
                    "wealth": _ev("Wealth summary.", _EV_STR),
                    "family_size": _ev("Family size / household summary.", _EV_STR),
                    "adi_area_deprivation_index": _ev("ADI summary.", _EV_STR),
                },
                "required": ["education", "income", "wealth", "family_size", "adi_area_deprivation_index"],
            },
            "disability_and_functional_limitations": _ev("Summary of disability / functional-limitation reporting.", _EV_STR),
            "religion": _ev("Summary of religion reporting.", _EV_STR),
        },
        "required": [
            "associated_nct_ids", "target_patient_age_range", "study_design",
            "total_participants", "age", "geography", "sex", "gender",
            "race_nih_omb", "ethnicity", "socioeconomic_status",
            "disability_and_functional_limitations", "religion",
        ],
    },
}


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
    """Read a local PDF and return concatenated text with explicit page markers.
    Each non-empty page is prefixed with `--- PAGE N ---` so the downstream
    tool-use extraction can cite the exact page for every evidence quote."""
    try:
        with pdfplumber.open(path) as pdf:
            pages = [
                f"--- PAGE {i + 1} ---\n{p.extract_text()}"
                for i, p in enumerate(pdf.pages) if p.extract_text()
            ]
            if not pages:
                return None
            return "\n\n".join(pages)
    except Exception as e:
        print(f"  ✗ PDF parse failed ({path}): {e}", file=sys.stderr)
        return None


def extract_with_model(text: str, model_id: str) -> tuple[dict, dict]:
    """Run extraction via tool use. Returns (data, token_usage). The tool
    call's `input` IS the evidence-grounded payload — no JSON parsing."""
    response = client.messages.create(
        model=model_id,
        max_tokens=4000,
        tools=[EXTRACTION_TOOL],
        tool_choice={"type": "tool", "name": "record_extracted_data"},
        messages=[{
            "role": "user",
            "content": f"{EXTRACTION_PROMPT}\n\n--- MANUSCRIPT TEXT ---\n{text}"
        }]
    )
    token_usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }
    data: dict = {"error": "No tool call in response"}
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "record_extracted_data":
            data = block.input
            break
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
