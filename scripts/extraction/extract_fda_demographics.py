#!/usr/bin/env python3
"""
FDA AI/ML Device Demographic Extraction Pipeline — 3-Way Model Comparison

Reads the FDA AI/ML-enabled devices CSV, selects 3 devices for a pilot run,
downloads their full 510(k)/De Novo/PMA summary PDFs, and runs each through
three Anthropic models (Haiku 4.5, Sonnet 4.6, Opus 4.6) to compare
extraction quality and cost.

Outputs:
  - data/fda_demographics_extracted.json  (per-document, per-model results)
  - data/fda_token_metrics.json           (aggregate per-model token usage)

Requires:
  - ANTHROPIC_API_KEY environment variable
  - pip install anthropic pdfplumber requests
"""

import csv
import io
import json
import os
import re
import sys
import time

import anthropic
import pdfplumber
import requests

PILOT_SIZE = 3
INPUT_CSV = "data/ai-ml-enabled-devices-csv_20260305.csv"
OUTPUT_DATA = "data/fda_demographics_extracted.json"
OUTPUT_METRICS = "data/fda_token_metrics.json"

MODELS = [
    {"id": "claude-haiku-4-5-20251001", "label": "Haiku 4.5",  "input_cost_per_m": 1.00,  "output_cost_per_m": 5.00},
    {"id": "claude-sonnet-4-6",         "label": "Sonnet 4.6",  "input_cost_per_m": 3.00,  "output_cost_per_m": 15.00},
    {"id": "claude-opus-4-6",           "label": "Opus 4.6",    "input_cost_per_m": 15.00, "output_cost_per_m": 75.00},
]

client = anthropic.Anthropic()

EXTRACTION_PROMPT = """\
You are a clinical data extractor specializing in FDA medical device submissions.
Read the provided FDA summary document text and extract the demographic breakdown
of the clinical validation cohort.

Extract ONLY information explicitly stated in the text. If a field is not mentioned,
use "Not Reported".

Return a single valid JSON object with this exact schema:
{
  "device_name": "string",
  "panel": "string (medical specialty)",
  "total_participants": integer or "Not Reported",
  "sex_male": integer or "Not Reported",
  "sex_female": integer or "Not Reported",
  "race_white": integer or "Not Reported",
  "race_black": integer or "Not Reported",
  "race_asian": integer or "Not Reported",
  "race_other": integer or "Not Reported",
  "age_range": "string like '22-84' or 'Not Reported'"
}

Return ONLY the JSON object, no other text."""


def build_pdf_url(submission_number: str) -> str | None:
    sn = submission_number.strip().upper()
    match = re.match(r'[A-Z]+(\d{2})', sn)
    if not match:
        return None
    year_prefix = match.group(1)
    return f"https://www.accessdata.fda.gov/cdrh_docs/pdf{year_prefix}/{submission_number}.pdf"


def download_and_extract_full_text(url: str) -> str | None:
    """Download a PDF and extract ALL pages — no page limits."""
    try:
        resp = requests.get(url, timeout=60, headers={
            "User-Agent": "CivicSample-Research/1.0 (academic research)"
        })
        resp.raise_for_status()
        with pdfplumber.open(io.BytesIO(resp.content)) as pdf:
            pages = [p.extract_text() for p in pdf.pages if p.extract_text()]
            if not pages:
                return None
            return "\n\n".join(pages)
    except Exception as e:
        print(f"  ✗ PDF download/parse failed: {e}", file=sys.stderr)
        return None


def extract_with_model(text: str, model_id: str) -> tuple[dict, dict]:
    """Run extraction against a single model. Returns (data, token_usage)."""
    response = client.messages.create(
        model=model_id,
        max_tokens=600,
        temperature=0,
        messages=[{
            "role": "user",
            "content": f"{EXTRACTION_PROMPT}\n\n--- FDA DOCUMENT TEXT ---\n{text}"
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


def read_fda_csv(path: str) -> list[dict]:
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    print(f"FDA 3-Way Model Comparison Pipeline")
    devices = read_fda_csv(INPUT_CSV)
    print(f"  Total devices in CSV: {len(devices)}")
    pilot = devices[:PILOT_SIZE]
    print(f"  Pilot size: {len(pilot)} (full PDF, 3 models each)\n")

    results = []
    # Per-model aggregate token tracking
    model_totals = {m["id"]: {"input": 0, "output": 0, "docs": 0} for m in MODELS}

    for i, device in enumerate(pilot):
        sub_num = device.get("Submission Number", "").strip()
        device_name = device.get("Device", "Unknown")
        panel = device.get("Panel (Lead)", "Unknown")
        print(f"[{i+1}/{len(pilot)}] {sub_num} — {device_name}")

        pdf_url = build_pdf_url(sub_num)
        if not pdf_url:
            print(f"  ✗ Could not build URL")
            results.append({
                "submission_number": sub_num,
                "device_name": device_name,
                "panel": panel,
                "source_url": None,
                "extraction_status": "no_url",
                "models": {},
            })
            continue

        text = download_and_extract_full_text(pdf_url)
        if not text:
            print(f"  ✗ No text from PDF")
            results.append({
                "submission_number": sub_num,
                "device_name": device_name,
                "panel": panel,
                "source_url": pdf_url,
                "extraction_status": "pdf_failed",
                "models": {},
            })
            continue

        print(f"  ✓ Full PDF: {len(text):,} chars")

        model_results = {}
        for model in MODELS:
            mid = model["id"]
            label = model["label"]
            print(f"    → {label} ({mid})...", end=" ", flush=True)
            try:
                data, tokens = extract_with_model(text, mid)
                model_results[mid] = {
                    "label": label,
                    "data": data,
                    "input_tokens": tokens["input_tokens"],
                    "output_tokens": tokens["output_tokens"],
                }
                model_totals[mid]["input"] += tokens["input_tokens"]
                model_totals[mid]["output"] += tokens["output_tokens"]
                model_totals[mid]["docs"] += 1
                print(f"{tokens['input_tokens']:,} in / {tokens['output_tokens']:,} out")
            except Exception as e:
                print(f"ERROR: {e}")
                model_results[mid] = {
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
            "extraction_status": "success",
            "models": model_results,
        })

    # Write results
    print(f"\nWriting {len(results)} results to {OUTPUT_DATA}")
    with open(OUTPUT_DATA, "w") as f:
        json.dump(results, f, indent=2)

    # Build per-model metrics
    per_model = {}
    for model in MODELS:
        mid = model["id"]
        t = model_totals[mid]
        docs = t["docs"] or 1
        per_model[mid] = {
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
        "pilot_size": len([r for r in results if r["extraction_status"] == "success"]),
        "total_fda_tools": len(devices),
        "per_model": per_model,
    }
    print(f"Writing metrics to {OUTPUT_METRICS}")
    with open(OUTPUT_METRICS, "w") as f:
        json.dump(metrics, f, indent=2)

    print("\nDone.")


if __name__ == "__main__":
    main()
