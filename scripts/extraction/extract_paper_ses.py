#!/usr/bin/env python3
"""
Peer-reviewed Manuscript Demographic Extraction Pipeline — 3-Way Model Comparison

Reads local AI/ML validation manuscript PDFs from `data/pilot_AIML_manuscripts/`,
cross-references each filename (sanitized DOI) with
`data/fuzzy_matches_pending_review.csv` to inject study metadata
(FDA submission number, FDA device, publication year, CC license), and runs
each manuscript through three Anthropic models (Haiku 4.5, Sonnet 4.6,
Opus 4.7) to compare extraction quality and cost.

PDF fetching is decoupled from extraction — this script only reads local files
so it can run in constrained environments (e.g., GitHub Actions) without
outbound access to publisher sites or Unpaywall.

Outputs:
  - data/lit_ses_extracted.json    (per-document, per-model results)
  - data/lit_token_metrics.json    (aggregate per-model token usage)

Requires:
  - ANTHROPIC_API_KEY environment variable
  - pip install anthropic pdfplumber
"""

import csv
import glob
import json
import os
import sys
import time

import anthropic
import pdfplumber

# Make scripts/utils/cost_tracker.py importable when this file runs from the
# repo root (the extraction scripts are launched via `python scripts/...`).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.cost_tracker import log_api_cost

PILOT_LIMIT = 2
PILOT_SIZE = 9
PILOT_PDF_DIR = "data/pilot_AIML_manuscripts"
METADATA_CSV = "data/fuzzy_matches_pending_review.csv"
OUTPUT_DATA = "data/lit_ses_extracted.json"
OUTPUT_METRICS = "data/lit_token_metrics.json"

# Total studies in the full AACT dataset (for scaling projections)
TOTAL_STUDIES = 53841

# Pipeline identifier recorded against every row in data/token_costs.csv.
PIPELINE_NAME = "aiml-lit"
AI_PROVIDER = os.environ.get("AI_PROVIDER", "anthropic")

MODELS = [
    {"key": "haiku_4_5",  "id": "claude-haiku-4-5-20251001", "label": "Haiku 4.5",  "input_cost_per_m": 1.00,  "output_cost_per_m": 5.00},
    {"key": "sonnet_4_6", "id": "claude-sonnet-4-6",         "label": "Sonnet 4.6", "input_cost_per_m": 3.00,  "output_cost_per_m": 15.00},
    {"key": "opus_4_7",   "id": "claude-opus-4-7",           "label": "Opus 4.7",   "input_cost_per_m": 15.00, "output_cost_per_m": 75.00},
]

# Vertex AI uses its own model identifiers for Claude and rejects the direct
# Anthropic API IDs with 404 NOT_FOUND. When AI_PROVIDER=vertex_ai we must look
# up the Vertex equivalent here and pass *that* string to AnthropicVertex.
# Source: https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai
VERTEX_MODEL_MAP = {
    "claude-haiku-4-5-20251001": "claude-haiku-4-5@20251001",
    "claude-sonnet-4-6":         "claude-sonnet-4-6",
    "claude-opus-4-7":           "claude-opus-4-7",
}


def _make_client():
    """Route to the Vertex-backed Anthropic client when AI_PROVIDER=vertex_ai;
    otherwise use the standard Anthropic API client."""
    if AI_PROVIDER == "vertex_ai":
        from anthropic import AnthropicVertex
        return AnthropicVertex(
            project_id=os.environ.get("GCP_PROJECT_ID"),
            region="us-east5",
        )
    return anthropic.Anthropic()


client = _make_client()

EXTRACTION_PROMPT = """\
You are a clinical data extractor specializing in published AI/ML validation studies. Record demographic, socioeconomic, clinical-context, and functional-status data via the `record_extracted_data` tool.

The manuscript text is delimited by `--- PAGE N ---` markers. Every evidence quote you record MUST come from the page that immediately precedes the text you're quoting, and you must record that page number on the field.

Before calling the extraction tool, use a <thinking> block to locate the sections containing the demographic and clinical context data. Specifically, scan "Methods", "Study Design", "Patients and Methods", and "Background" sections for clinical context, and the cohort / participants tables for demographics.

CRITICAL: The "Explicit Unknown" category is a specific reported value, completely distinct from "Not Reported" (missing) data. If researchers explicitly state a value is unknown, unrecorded, or declined, record the count under "unknown". If they fail to mention the category entirely, record "Not Reported".

LINKAGE CRITICAL: We must link this paper to ClinicalTrials.gov if possible. Scan the text for any NCT identifier (format: NCT followed by 8 digits) and place them under `associated_nct_ids`.

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
    "description": "Record evidence-grounded demographic, clinical-context, SES, and functional-status data extracted from a peer-reviewed AI/ML validation manuscript.",
    "input_schema": {
        "type": "object",
        "properties": {
            "associated_nct_ids": _ev("ClinicalTrials.gov NCT identifiers referenced in the paper.", _EV_LIST),
            "target_patient_age_range": _ev("Inclusion-criteria age range, verbatim when possible.", _EV_STR),
            "study_design": _ev("Concise 1-2 sentence summary of the validation study design.", _EV_STR),
            "total_participants": _ev("Total N in the validation cohort.", _EV_INT),
            "age": _ev("String summary of how age is reported (e.g., 'Mean 65.2 (SD 5.1)').", _EV_STR),
            "geography": {
                "type": "object",
                "properties": {
                    "us_states": _ev("US states represented.", _EV_LIST),
                    "countries": _ev("Countries represented.", _EV_LIST),
                    "total_sites": _ev("Total number of clinical sites.", _EV_INT),
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


def doi_slug(value: str) -> str:
    """Normalize a DOI (or DOI-derived filename stem) into a comparable slug.

    PDFs are stored on disk with their DOI sanitized — typically by replacing
    `/` with `_`. The metadata CSV may or may not carry that same
    transformation. Normalizing both sides by lowercasing and mapping every
    `/` to `_` gives a stable join key regardless of which side applied the
    sanitization.
    """
    return (value or "").strip().lower().replace("/", "_")


def build_metadata_index(csv_path: str) -> dict[str, dict]:
    """Map DOI slug -> CSV row. Returns {} if the CSV is missing."""
    if not os.path.exists(csv_path):
        print(f"  ! metadata CSV not found: {csv_path} "
              f"(continuing with empty metadata)", file=sys.stderr)
        return {}
    idx: dict[str, dict] = {}
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            doi = row.get("DOI") or row.get("doi") or ""
            key = doi_slug(doi)
            if key:
                idx[key] = row
    return idx


def resolve_limit() -> int | None:
    """Translate RUN_MODE into an optional cap on the number of PDFs processed.

    Defaults to pilot-test so an accidental workflow trigger can't burn through
    the full corpus. `None` means "no limit" (full extraction).
    """
    mode = (os.environ.get("RUN_MODE") or "pilot-test").strip().lower()
    if mode == "full-extraction":
        return None
    if mode == "pilot-test":
        return PILOT_LIMIT
    print(f"  ! Unknown RUN_MODE {mode!r} — defaulting to pilot-test", file=sys.stderr)
    return PILOT_LIMIT


def discover_pilot_pdfs(pdf_dir: str) -> list[tuple[str, str]]:
    """Return (doi_slug, pdf_path) pairs sorted by filename."""
    if not os.path.isdir(pdf_dir):
        print(f"Error: pilot PDF directory not found: {pdf_dir}", file=sys.stderr)
        return []
    paths = sorted(glob.glob(os.path.join(pdf_dir, "*.pdf")))
    return [(doi_slug(os.path.splitext(os.path.basename(p))[0]), p) for p in paths]


def lookup_metadata(index: dict[str, dict], slug: str) -> dict:
    """Return the metadata block for the results payload, injecting whatever the
    CSV provides. Always returns the expected shape so downstream consumers
    don't have to branch on missing metadata."""
    row = index.get(slug, {})
    return {
        "fda_submission_number": (row.get("FDA_Submission_Number") or row.get("FDA Submission Number") or "Not Reported").strip() or "Not Reported",
        "fda_device": (row.get("FDA_Device") or row.get("FDA Device") or "Not Reported").strip() or "Not Reported",
        "publication_year": str(row.get("Year") or row.get("publication_year") or "Not Reported").strip() or "Not Reported",
        "cc_license": (row.get("CC_License") or row.get("CC License") or "Not Reported").strip() or "Not Reported",
    }


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
    # Vertex requires its own model IDs (see VERTEX_MODEL_MAP). Cost logging
    # keeps the canonical Anthropic ID so rows stay comparable across providers.
    if AI_PROVIDER == "vertex_ai":
        effective_model = VERTEX_MODEL_MAP.get(model_id, model_id)
    else:
        effective_model = model_id
    response = client.messages.create(
        model=effective_model,
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
    log_api_cost(
        provider=AI_PROVIDER,
        pipeline_name=PIPELINE_NAME,
        input_tokens=token_usage["input_tokens"],
        output_tokens=token_usage["output_tokens"],
        model=model_id,
    )
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

    limit = resolve_limit()
    run_mode = os.environ.get("RUN_MODE", "pilot-test")

    print(f"Paper SES 3-Way Model Comparison Pipeline (local PDF mode)")
    print(f"  Pilot PDF dir: {PILOT_PDF_DIR}")
    print(f"  Metadata CSV:  {METADATA_CSV}")
    print(f"  RUN_MODE:      {run_mode}  (limit={'none' if limit is None else limit})")

    metadata_index = build_metadata_index(METADATA_CSV)
    all_pdfs = discover_pilot_pdfs(PILOT_PDF_DIR)
    pilot = all_pdfs if limit is None else all_pdfs[:limit]

    if not pilot:
        print(f"  No PDFs found in {PILOT_PDF_DIR}. Nothing to do — exiting cleanly.",
              file=sys.stderr)
        sys.exit(0)

    print(f"  Found {len(all_pdfs)} PDFs; processing {len(pilot)}\n")

    results = []
    model_totals = {m["key"]: {"input": 0, "output": 0, "docs": 0} for m in MODELS}

    for i, (slug, pdf_path) in enumerate(pilot):
        metadata = lookup_metadata(metadata_index, slug)
        print(f"[{i+1}/{len(pilot)}] {slug}")
        print(f"  ↪ {pdf_path}")
        print(f"  metadata: submission={metadata['fda_submission_number']} "
              f"year={metadata['publication_year']} "
              f"device={metadata['fda_device']} license={metadata['cc_license']}")

        text = extract_text_from_local_pdf(pdf_path)
        if not text:
            print(f"  ✗ No text from PDF")
            results.append({
                "doi_slug": slug,
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
                wrapped = {"metadata": metadata, "extracted_data": data}
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
                    "data": {"metadata": metadata, "extracted_data": {"error": str(e)}},
                    "input_tokens": 0,
                    "output_tokens": 0,
                }
            time.sleep(1)

        results.append({
            "doi_slug": slug,
            "local_pdf_path": pdf_path,
            "metadata": metadata,
            "extraction_status": "success",
            "models": model_results,
        })

    print(f"\nWriting {len(results)} results to {OUTPUT_DATA}")
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
