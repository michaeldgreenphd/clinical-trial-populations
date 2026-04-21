#!/usr/bin/env python3
"""
FDA AI/ML Device Demographic Extraction Pipeline — 3-Way Model Comparison

Reads local FDA 510(k)/De Novo/PMA summary PDFs from
`data/pilot_summary_statements/`, enriches each with metadata from the FDA
devices CSV, and runs each document through three LLMs (small / medium / large
tier) to compare extraction quality and cost.

Provider routing (selected via AI_PROVIDER env var):
  - `anthropic`      → Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.7 (default)
  - `vertex_gemini`  → Gemini 3.1 Flash-Lite / Flash / Pro preview (native
                       Vertex AI via google-cloud-aiplatform)

PDF fetching is handled separately by scripts/extraction/fetch_fda_pdfs.py —
this script only reads from disk so it can run in constrained environments
(e.g., GitHub Actions) without outbound access to accessdata.fda.gov.

Outputs:
  - data/fda_demographics_extracted.json  (per-document, per-model results)
  - data/fda_token_metrics.json           (aggregate per-model token usage)

Requires:
  - ANTHROPIC_API_KEY (anthropic provider) OR GCP_PROJECT_ID +
    GOOGLE_APPLICATION_CREDENTIALS (vertex_gemini provider)
  - pip install -r scripts/extraction/requirements.txt
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
PILOT_SIZE = 12
PILOT_PDF_DIR = "data/pilot_summary_statements"
INPUT_CSV = "data/ai-ml-enabled-devices-enriched.csv"
OUTPUT_DATA = "data/fda_demographics_extracted.json"
OUTPUT_METRICS = "data/fda_token_metrics.json"

# Pipeline identifier recorded against every row in data/token_costs.csv so
# we can slice spend by stream (and by provider) when comparing runs.
PIPELINE_NAME = "fda"
AI_PROVIDER = os.environ.get("AI_PROVIDER", "anthropic")
GEMINI_LOCATION = "global"

# Keep per-provider model lists side by side so the active one can be chosen
# at import time; downstream code never has to branch on provider when
# looking up model IDs, labels, or per-token costs.
_ANTHROPIC_MODELS = [
    {"key": "haiku_4_5",  "id": "claude-haiku-4-5-20251001", "label": "Haiku 4.5",  "input_cost_per_m": 1.00,  "output_cost_per_m": 5.00},
    {"key": "sonnet_4_6", "id": "claude-sonnet-4-6",         "label": "Sonnet 4.6", "input_cost_per_m": 3.00,  "output_cost_per_m": 15.00},
    {"key": "opus_4_7",   "id": "claude-opus-4-7",           "label": "Opus 4.7",   "input_cost_per_m": 15.00, "output_cost_per_m": 75.00},
]
# Gemini 3.1 Preview IDs + Standard-tier prices per Vertex AI pricing page
# (https://cloud.google.com/vertex-ai/generative-ai/pricing). The three tiers
# line up small→large with the Haiku/Sonnet/Opus tiers above.
_GEMINI_MODELS = [
    {"key": "haiku_4_5",  "id": "gemini-3.1-flash-lite-preview", "label": "Gemini 3.1 Flash-Lite", "input_cost_per_m": 0.25, "output_cost_per_m": 1.50},
    {"key": "sonnet_4_6", "id": "gemini-3.1-flash-preview",      "label": "Gemini 3.1 Flash",      "input_cost_per_m": 0.50, "output_cost_per_m": 3.00},
    {"key": "opus_4_7",   "id": "gemini-3.1-pro-preview",        "label": "Gemini 3.1 Pro",        "input_cost_per_m": 2.00, "output_cost_per_m": 12.00},
]
MODELS = _GEMINI_MODELS if AI_PROVIDER == "vertex_gemini" else _ANTHROPIC_MODELS


def _make_client():
    """Initialize the active provider. For Anthropic, return an Anthropic
    client. For vertex_gemini, call vertexai.init() and return None — Gemini
    uses one `GenerativeModel` per model name rather than one shared client."""
    if AI_PROVIDER == "vertex_gemini":
        import vertexai
        vertexai.init(
            project=os.environ.get("GCP_PROJECT_ID"),
            location=GEMINI_LOCATION,
        )
        return None
    return anthropic.Anthropic()


client = _make_client()

EXTRACTION_PROMPT = """\
You are a clinical data extractor specializing in FDA medical device submissions. Extract demographic, socioeconomic, clinical-context, and citation data of the clinical validation cohort and record it via the `record_extracted_data` tool.

The manuscript text is delimited by `--- PAGE N ---` markers. Every evidence quote you record MUST come from the page that immediately precedes the text you're quoting, and you must record that page number on the field.

Before calling the extraction tool, use a <thinking> block to locate the sections containing the demographic and clinical context data. Specifically, scan the "SUMMARY OF CLINICAL INFORMATION", "BACKGROUND", "INDICATIONS FOR USE", and "INTENDED USE" sections for the clinical context, and the validation / cohort description sections for demographics.

CRITICAL: The "Explicit Unknown" category is a specific reported value, completely distinct from "Not Reported" (missing) data. If researchers explicitly state a value is unknown, unrecorded, or declined, record the count under "unknown". If they fail to mention the category entirely, record "Not Reported".

For every field, populate:
- `value`: the extracted value (or the literal string "Not Reported" for scalars / empty list for list-typed fields when the document is silent).
- `exact_quote`: a verbatim excerpt from the document that proves the value (empty string when "Not Reported").
- `page_number`: the integer page number (1-indexed) where the quote appears (0 when "Not Reported").
"""


# ---------------------------------------------------------------------------
# Evidence-grounded tool schema. Every leaf field is wrapped in a
# {value, exact_quote, page_number} object so the LLM is forced to cite the
# source text for every value it records.
# ---------------------------------------------------------------------------

def _ev(description: str, value_schema: dict) -> dict:
    return {
        "type": "object",
        "description": description,
        "properties": {
            "value": value_schema,
            "exact_quote": {
                "type": "string",
                "description": "Verbatim excerpt from the source text proving the value. Empty string if 'Not Reported'.",
            },
            "page_number": {
                "type": "integer",
                "description": "Page number (1-indexed) from the `--- PAGE N ---` markers. 0 if 'Not Reported'.",
            },
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
    "description": "Record evidence-grounded demographic, clinical-context, and citation data from an FDA summary statement.",
    "input_schema": {
        "type": "object",
        "properties": {
            "company_sponsor_name": _ev("Manufacturer / applicant / sponsor that submitted the device.", _EV_STR),
            "device_tool_title": _ev("Formal name of the device or software tool under review.", _EV_STR),
            "target_patient_age_range": _ev("Inclusion-criteria age range for the validation cohort, verbatim when possible.", _EV_STR),
            "clinical_study_design": _ev("Concise 1-2 sentence summary of the validation study design.", _EV_STR),
            "device_name": _ev("Device name as stated in the summary.", _EV_STR),
            "panel": _ev("Medical specialty / review panel.", _EV_STR),
            "total_participants": _ev("Total N in the validation cohort.", _EV_INT),
            "cited_clinical_studies": {
                "type": "object",
                "properties": {
                    "nct_ids": _ev("Referenced ClinicalTrials.gov NCT IDs.", _EV_LIST),
                    "dois": _ev("Referenced DOIs.", _EV_LIST),
                    "publication_titles": _ev("Referenced publication titles.", _EV_LIST),
                },
                "required": ["nct_ids", "dois", "publication_titles"],
            },
            "geography": {
                "type": "object",
                "properties": {
                    "us_states": _ev("US states represented in the validation cohort.", _EV_LIST),
                    "countries": _ev("Countries represented in the validation cohort.", _EV_LIST),
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
        },
        "required": [
            "company_sponsor_name", "device_tool_title", "target_patient_age_range",
            "clinical_study_design", "device_name", "panel", "total_participants",
            "cited_clinical_studies", "geography", "sex", "gender", "race_nih_omb",
            "ethnicity", "socioeconomic_status",
        ],
    },
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


def _to_gemini_schema(schema):
    """Recursively normalize an Anthropic-style JSON schema into the subset
    Gemini function declarations accept. Gemini forbids union types
    (e.g. `["integer", "string"]`), so we flatten them to `"string"` — ints
    round-trip fine through a string and "Not Reported" is the common sentinel
    anyway. `properties` and `items` recurse."""
    if not isinstance(schema, dict):
        return schema
    out = dict(schema)
    t = out.get("type")
    if isinstance(t, list):
        out["type"] = "string"
    if "properties" in out:
        out["properties"] = {k: _to_gemini_schema(v) for k, v in out["properties"].items()}
    if "items" in out:
        out["items"] = _to_gemini_schema(out["items"])
    return out


def _proto_to_dict(val):
    """Convert Gemini's protobuf MapComposite / RepeatedComposite return
    values into plain Python dicts and lists so the result is JSON-serialisable
    the same way the Anthropic `tool_use.input` payload already is."""
    if hasattr(val, "items") and not isinstance(val, (str, bytes)):
        return {k: _proto_to_dict(v) for k, v in val.items()}
    if hasattr(val, "__iter__") and not isinstance(val, (str, bytes)):
        return [_proto_to_dict(v) for v in val]
    return val


def extract_with_model(text: str, model_id: str) -> tuple[dict, dict]:
    """Run extraction against a single model via tool / function calling.
    Returns (data, token_usage). The tool call's arguments ARE the
    evidence-grounded payload — no free-form JSON parsing needed."""
    prompt = f"{EXTRACTION_PROMPT}\n\n--- FDA DOCUMENT TEXT ---\n{text}"
    if AI_PROVIDER == "vertex_gemini":
        data, token_usage = _extract_gemini(prompt, model_id)
    else:
        data, token_usage = _extract_anthropic(prompt, model_id)
    log_api_cost(
        provider=AI_PROVIDER,
        pipeline_name=PIPELINE_NAME,
        input_tokens=token_usage["input_tokens"],
        output_tokens=token_usage["output_tokens"],
        model=model_id,
    )
    return data, token_usage


def _extract_anthropic(prompt: str, model_id: str) -> tuple[dict, dict]:
    response = client.messages.create(
        model=model_id,
        max_tokens=4000,
        tools=[EXTRACTION_TOOL],
        tool_choice={"type": "tool", "name": "record_extracted_data"},
        messages=[{"role": "user", "content": prompt}],
    )
    data: dict = {"error": "No tool call in response"}
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "record_extracted_data":
            data = block.input
            break
    return data, {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }


def _extract_gemini(prompt: str, model_id: str) -> tuple[dict, dict]:
    """Vertex AI Gemini path. Uses google-cloud-aiplatform's GenerativeModel
    with function-calling forced to `ANY` so the model must emit a
    record_extracted_data call. Token usage comes from `usage_metadata`:
    prompt_token_count → input; candidates_token_count → output."""
    from vertexai.generative_models import (
        FunctionDeclaration,
        GenerativeModel,
        Tool,
        ToolConfig,
    )

    gemini_tool = Tool(function_declarations=[
        FunctionDeclaration(
            name=EXTRACTION_TOOL["name"],
            description=EXTRACTION_TOOL["description"],
            parameters=_to_gemini_schema(EXTRACTION_TOOL["input_schema"]),
        )
    ])
    tool_config = ToolConfig(
        function_calling_config=ToolConfig.FunctionCallingConfig(
            mode=ToolConfig.FunctionCallingConfig.Mode.ANY,
            allowed_function_names=[EXTRACTION_TOOL["name"]],
        )
    )
    model = GenerativeModel(
        model_name=model_id,
        tools=[gemini_tool],
        tool_config=tool_config,
    )
    response = model.generate_content(
        prompt,
        generation_config={"max_output_tokens": 4000},
    )

    data: dict = {"error": "No tool call in response"}
    for cand in response.candidates:
        for part in cand.content.parts:
            fc = getattr(part, "function_call", None)
            if fc and getattr(fc, "name", "") == EXTRACTION_TOOL["name"]:
                data = _proto_to_dict(fc.args)
                break
        if not isinstance(data, dict) or "error" not in data:
            break

    usage = response.usage_metadata
    return data, {
        "input_tokens": getattr(usage, "prompt_token_count", 0) or 0,
        "output_tokens": getattr(usage, "candidates_token_count", 0) or 0,
    }


def read_fda_csv(path: str) -> list[dict]:
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def build_metadata_index(csv_path: str) -> dict[str, dict]:
    """Map UPPER(submission number) -> CSV row."""
    if not os.path.exists(csv_path):
        print(f"  ! metadata CSV not found: {csv_path} (continuing without it)",
              file=sys.stderr)
        return {}
    idx: dict[str, dict] = {}
    for row in read_fda_csv(csv_path):
        sub = (row.get("Submission Number") or "").strip().upper()
        if sub:
            idx[sub] = row
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
    """Return (submission_number, pdf_path) pairs sorted by name."""
    if not os.path.isdir(pdf_dir):
        print(f"Error: pilot PDF directory not found: {pdf_dir}", file=sys.stderr)
        return []
    paths = sorted(glob.glob(os.path.join(pdf_dir, "*.pdf")))
    return [(os.path.splitext(os.path.basename(p))[0].upper(), p) for p in paths]


def main():
    if AI_PROVIDER == "vertex_gemini":
        if not os.environ.get("GCP_PROJECT_ID"):
            print("Error: GCP_PROJECT_ID not set (required for vertex_gemini)", file=sys.stderr)
            sys.exit(1)
    else:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("Error: ANTHROPIC_API_KEY environment variable not set", file=sys.stderr)
            sys.exit(1)

    limit = resolve_limit()
    run_mode = os.environ.get("RUN_MODE", "pilot-test")

    print(f"FDA 3-Way Model Comparison Pipeline (local PDF mode)")
    print(f"  Pilot PDF dir: {PILOT_PDF_DIR}")
    print(f"  Metadata CSV:  {INPUT_CSV}")
    print(f"  RUN_MODE:      {run_mode}  (limit={'none' if limit is None else limit})")

    metadata = build_metadata_index(INPUT_CSV)
    all_pdfs = discover_pilot_pdfs(PILOT_PDF_DIR)
    pilot = all_pdfs if limit is None else all_pdfs[:limit]

    if not pilot:
        # Graceful exit: no PDFs is a valid state (e.g. empty seed folder on
        # the CI runner). Print and return 0 so the workflow doesn't fail.
        print(f"  No PDFs found in {PILOT_PDF_DIR}. Nothing to do — exiting cleanly.",
              file=sys.stderr)
        sys.exit(0)

    print(f"  Found {len(all_pdfs)} PDFs; processing {len(pilot)}\n")

    results = []
    model_totals = {m["key"]: {"input": 0, "output": 0, "docs": 0} for m in MODELS}

    for i, (sub_num, pdf_path) in enumerate(pilot):
        row = metadata.get(sub_num, {})
        device_name = row.get("Device", "Unknown")
        panel = row.get("Panel (Lead)", "Unknown")
        pdf_url = row.get("pdf_url") or None
        print(f"[{i+1}/{len(pilot)}] {sub_num} — {device_name}")
        print(f"  ↪ {pdf_path}")

        text = extract_text_from_local_pdf(pdf_path)
        if not text:
            print(f"  ✗ No text from PDF")
            results.append({
                "submission_number": sub_num,
                "device_name": device_name,
                "panel": panel,
                "source_url": pdf_url,
                "local_pdf_path": pdf_path,
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
                model_results[mkey] = {
                    "model_id": mid,
                    "label": label,
                    "data": data,
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
                    "data": {"error": str(e)},
                    "input_tokens": 0,
                    "output_tokens": 0,
                }
            time.sleep(1)

        results.append({
            "submission_number": sub_num,
            "device_name": device_name,
            "panel": panel,
            "source_url": pdf_url,
            "local_pdf_path": pdf_path,
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
        "total_fda_tools": len(metadata) if metadata else None,
        "per_model": per_model,
    }
    print(f"Writing metrics to {OUTPUT_METRICS}")
    with open(OUTPUT_METRICS, "w") as f:
        json.dump(metrics, f, indent=2)

    print("\nDone.")


if __name__ == "__main__":
    main()
