#!/usr/bin/env python3
"""
FDA AI/ML Device Demographic Extraction Pipeline

Reads the FDA AI/ML-enabled devices CSV, selects a pilot sample of the most
recent devices, downloads their 510(k)/De Novo/PMA summary PDFs from the FDA
database, and uses the Anthropic API (Claude) to extract race, sex, and age
demographics from the clinical validation sections.

Outputs:
  - data/fda_demographics_extracted.json  (table data)
  - data/fda_token_metrics.json           (aggregate token usage)

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

PILOT_SIZE = 15
INPUT_CSV = "data/ai-ml-enabled-devices-csv_20260305.csv"
OUTPUT_DATA = "data/fda_demographics_extracted.json"
OUTPUT_METRICS = "data/fda_token_metrics.json"

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
    """Build the FDA CDRH PDF URL from a submission number."""
    sn = submission_number.strip().upper()

    # Extract the 2-digit year prefix from the submission number
    # K253532 -> 25, DEN240068 -> 24, P230022 -> 23
    match = re.match(r'[A-Z]+(\d{2})', sn)
    if not match:
        return None

    year_prefix = match.group(1)
    return f"https://www.accessdata.fda.gov/cdrh_docs/pdf{year_prefix}/{submission_number}.pdf"


def download_and_extract_text(url: str) -> str | None:
    """Download a PDF from the given URL and extract text."""
    try:
        resp = requests.get(url, timeout=30, headers={
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


def extract_demographics(text: str) -> tuple[dict, dict]:
    """Send text to Claude and extract demographics. Returns (data, token_usage)."""
    # Truncate to ~100K chars to stay within context window
    truncated = text[:100_000]

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
        temperature=0,
        messages=[{
            "role": "user",
            "content": f"{EXTRACTION_PROMPT}\n\n--- FDA DOCUMENT TEXT ---\n{truncated}"
        }]
    )

    token_usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }

    try:
        data = json.loads(response.content[0].text)
    except (json.JSONDecodeError, IndexError):
        data = {"error": "Failed to parse Claude response"}

    return data, token_usage


def read_fda_csv(path: str) -> list[dict]:
    """Read the FDA CSV handling multiline quoted fields."""
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

    print(f"Reading FDA CSV: {INPUT_CSV}")
    devices = read_fda_csv(INPUT_CSV)
    print(f"  Found {len(devices)} total devices")

    # Select pilot sample: most recent devices (CSV is already sorted by date desc)
    pilot = devices[:PILOT_SIZE]
    print(f"  Selected {len(pilot)} devices for pilot extraction\n")

    results = []
    total_input_tokens = 0
    total_output_tokens = 0
    successful_extractions = 0

    for i, device in enumerate(pilot):
        sub_num = device.get("Submission Number", "").strip()
        device_name = device.get("Device", "Unknown")
        panel = device.get("Panel (Lead)", "Unknown")

        print(f"[{i+1}/{len(pilot)}] {sub_num} — {device_name}")

        pdf_url = build_pdf_url(sub_num)
        if not pdf_url:
            print(f"  ✗ Could not build URL for {sub_num}")
            results.append({
                "device_name": device_name,
                "panel": panel,
                "submission_number": sub_num,
                "total_participants": "Not Reported",
                "sex_male": "Not Reported",
                "sex_female": "Not Reported",
                "race_white": "Not Reported",
                "race_black": "Not Reported",
                "race_asian": "Not Reported",
                "race_other": "Not Reported",
                "age_range": "Not Reported",
                "source_url": None,
                "extraction_status": "no_url",
            })
            continue

        text = download_and_extract_text(pdf_url)
        if not text:
            print(f"  ✗ No text extracted from PDF")
            results.append({
                "device_name": device_name,
                "panel": panel,
                "submission_number": sub_num,
                "total_participants": "Not Reported",
                "sex_male": "Not Reported",
                "sex_female": "Not Reported",
                "race_white": "Not Reported",
                "race_black": "Not Reported",
                "race_asian": "Not Reported",
                "race_other": "Not Reported",
                "age_range": "Not Reported",
                "source_url": pdf_url,
                "extraction_status": "pdf_failed",
            })
            continue

        print(f"  ✓ Extracted {len(text):,} chars from PDF")

        try:
            demographics, tokens = extract_demographics(text)
            total_input_tokens += tokens["input_tokens"]
            total_output_tokens += tokens["output_tokens"]
            successful_extractions += 1

            print(f"  ✓ Claude: {tokens['input_tokens']:,} in / {tokens['output_tokens']:,} out")

            # Merge Claude output with metadata
            record = {
                "device_name": demographics.get("device_name", device_name),
                "panel": demographics.get("panel", panel),
                "submission_number": sub_num,
                "total_participants": demographics.get("total_participants", "Not Reported"),
                "sex_male": demographics.get("sex_male", "Not Reported"),
                "sex_female": demographics.get("sex_female", "Not Reported"),
                "race_white": demographics.get("race_white", "Not Reported"),
                "race_black": demographics.get("race_black", "Not Reported"),
                "race_asian": demographics.get("race_asian", "Not Reported"),
                "race_other": demographics.get("race_other", "Not Reported"),
                "age_range": demographics.get("age_range", "Not Reported"),
                "source_url": pdf_url,
                "extraction_status": "success",
            }
            results.append(record)

        except Exception as e:
            print(f"  ✗ Claude extraction failed: {e}", file=sys.stderr)
            results.append({
                "device_name": device_name,
                "panel": panel,
                "submission_number": sub_num,
                "total_participants": "Not Reported",
                "sex_male": "Not Reported",
                "sex_female": "Not Reported",
                "race_white": "Not Reported",
                "race_black": "Not Reported",
                "race_asian": "Not Reported",
                "race_other": "Not Reported",
                "age_range": "Not Reported",
                "source_url": pdf_url,
                "extraction_status": "api_error",
            })

        # Rate limiting: 1 second between API calls
        time.sleep(1)

    # Write extraction results
    print(f"\nWriting {len(results)} results to {OUTPUT_DATA}")
    with open(OUTPUT_DATA, "w") as f:
        json.dump(results, f, indent=2)

    # Write token metrics
    metrics = {
        "pilot_size": successful_extractions,
        "total_fda_tools": len(devices),
        "avg_input_per_doc": (
            total_input_tokens / successful_extractions
            if successful_extractions > 0 else 0
        ),
        "avg_output_per_doc": (
            total_output_tokens / successful_extractions
            if successful_extractions > 0 else 0
        ),
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
    }
    print(f"Writing token metrics to {OUTPUT_METRICS}")
    print(f"  Successful extractions: {successful_extractions}/{len(pilot)}")
    print(f"  Total tokens: {total_input_tokens:,} input + {total_output_tokens:,} output")
    with open(OUTPUT_METRICS, "w") as f:
        json.dump(metrics, f, indent=2)

    print("\nDone.")


if __name__ == "__main__":
    main()
