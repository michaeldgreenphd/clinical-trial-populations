#!/usr/bin/env python3
"""
Paper SES/Demographics Extraction Pipeline — 3-Way Model Comparison

Selects clinical trial publications with known open-access availability,
fetches the full text, and runs each through three Anthropic models
(Haiku 4.5, Sonnet 4.6, Opus 4.6) to compare extraction quality and cost.

Outputs:
  - data/lit_ses_extracted.json    (per-document, per-model results)
  - data/lit_token_metrics.json    (aggregate per-model token usage)

Requires:
  - ANTHROPIC_API_KEY environment variable
  - pip install anthropic pdfplumber requests
"""

import io
import json
import os
import sys
import time

import anthropic
import pdfplumber
import requests

OUTPUT_DATA = "data/lit_ses_extracted.json"
OUTPUT_METRICS = "data/lit_token_metrics.json"
UNPAYWALL_EMAIL = "info@civicsample.com"

# Total studies in the full AACT dataset (for scaling projections)
TOTAL_STUDIES = 53841

MODELS = [
    {"id": "claude-haiku-4-5-20251001", "label": "Haiku 4.5",  "input_cost_per_m": 1.00,  "output_cost_per_m": 5.00},
    {"id": "claude-sonnet-4-6",         "label": "Sonnet 4.6",  "input_cost_per_m": 3.00,  "output_cost_per_m": 15.00},
    {"id": "claude-opus-4-6",           "label": "Opus 4.6",    "input_cost_per_m": 15.00, "output_cost_per_m": 75.00},
]

client = anthropic.Anthropic()

# Curated pilot sample: 3 real clinical trial publications known to have
# open-access full text. These DOIs are verified against Unpaywall/PubMed.
PILOT_DOIS = [
    "10.1056/NEJMoa1911303",   # DAPA-HF trial (dapagliflozin, heart failure)
    "10.1001/jama.2020.12839",  # RECOVERY trial (dexamethasone, COVID-19)
    "10.1056/NEJMoa2034577",   # BNT162b2 vaccine trial (Pfizer COVID-19)
]

EXTRACTION_PROMPT = """\
You are a population health researcher. Read the provided clinical trial
manuscript and extract information about the study population demographics,
with a focus on socioeconomic status (SES) indicators.

Extract ONLY information explicitly stated in the text. Do not infer or guess.

Return a single valid JSON object with this exact schema:
{
  "income_reported": boolean,
  "education_reported": boolean,
  "insurance_status_reported": boolean,
  "ses_notes": "Brief summary of any SES data found, or 'None'",
  "detailed_race_breakdown": "Summary of race/ethnicity percentages, or 'Not Reported'",
  "study_name": "Formal study name (e.g. 'SPRINT Trial') or 'Not Reported'",
  "nct_id": "NCT registry number or 'Not Reported'"
}

Return ONLY the JSON object, no other text."""


def get_open_access_pdf(doi: str) -> tuple[str | None, str]:
    """Query Unpaywall for an open-access PDF URL. Returns (pdf_url, title)."""
    url = f"https://api.unpaywall.org/v2/{doi}?email={UNPAYWALL_EMAIL}"
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        title = data.get("title", "Title Not Found")

        if data.get("is_oa") and data.get("best_oa_location"):
            loc = data["best_oa_location"]
            pdf_url = loc.get("url_for_pdf") or loc.get("url")
            if pdf_url:
                return pdf_url, title

        return None, title
    except Exception as e:
        print(f"  ✗ Unpaywall lookup failed: {e}", file=sys.stderr)
        return None, "Title Not Found"


def extract_pdf_text(url: str) -> str | None:
    """Download a PDF and extract ALL pages — no page limits."""
    try:
        resp = requests.get(url, timeout=60, headers={
            "User-Agent": "CivicSample-Research/1.0 (academic research)"
        })
        resp.raise_for_status()

        with pdfplumber.open(io.BytesIO(resp.content)) as pdf:
            pages = [p.extract_text() for p in pdf.pages if p.extract_text()]
            return "\n\n".join(pages) if pages else None
    except Exception as e:
        print(f"  ✗ PDF extraction failed: {e}", file=sys.stderr)
        return None


def extract_with_model(text: str, model_id: str) -> tuple[dict, dict]:
    """Run extraction against a single model. Returns (data, token_usage)."""
    response = client.messages.create(
        model=model_id,
        max_tokens=800,
        temperature=0,
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

    print(f"Paper SES 3-Way Model Comparison Pipeline")
    print(f"  Pilot DOIs: {len(PILOT_DOIS)} (full PDF, 3 models each)\n")

    results = []
    model_totals = {m["id"]: {"input": 0, "output": 0, "docs": 0} for m in MODELS}

    for i, doi in enumerate(PILOT_DOIS):
        print(f"[{i+1}/{len(PILOT_DOIS)}] {doi}")

        pdf_url, title = get_open_access_pdf(doi)

        if not pdf_url:
            print(f"  ✗ No open-access PDF found")
            results.append({
                "doi": doi,
                "study_title": title,
                "oa_pdf_url": None,
                "extraction_status": "closed_access",
                "models": {},
            })
            continue

        text = extract_pdf_text(pdf_url)
        if not text:
            print(f"  ✗ Could not extract text from PDF")
            results.append({
                "doi": doi,
                "study_title": title,
                "oa_pdf_url": pdf_url,
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
            "doi": doi,
            "study_title": title,
            "oa_pdf_url": pdf_url,
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
        "total_studies": TOTAL_STUDIES,
        "per_model": per_model,
    }
    print(f"Writing metrics to {OUTPUT_METRICS}")
    with open(OUTPUT_METRICS, "w") as f:
        json.dump(metrics, f, indent=2)

    print("\nDone.")


if __name__ == "__main__":
    main()
