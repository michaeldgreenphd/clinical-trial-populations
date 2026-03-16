#!/usr/bin/env python3
"""
Generate mobile-optimized data files from the full demographics parts.

The full dataset is ~136 MB compressed / 780 MB uncompressed across 8 parts.
Mobile browsers (especially iOS Safari) crash or time-out trying to download
and parse that much data.

This script produces lightweight "mobile" parts that keep only the fields
needed for the dashboard charts, filters, and Studies table — stripping
detail-only fields (study_sites, secondary_outcomes, references, etc.) and
trimming demographic objects to just their summary totals.

Result: ~10-15 MB compressed across 2 parts — loadable on mobile.
"""
import json
import gzip
import math
import os

NUM_MOBILE_PARTS = 2
MAX_PART_MB = 20

# Fields kept verbatim from the full study record
KEEP_FIELDS = {
    "nct_id", "brief_title", "results_date", "enrollment", "enrollment_type",
    "study_type", "phase", "status", "start_date", "completion_date",
    "primary_completion_date", "sponsor_class", "intervention_model",
    "masking", "primary_purpose", "healthy_volunteers", "conditions",
    "countries", "completion_to_report_days", "start_to_report_days",
    "std_ages", "why_stopped", "primary_condition", "secondary_condition",
    "pediatric_status",
}


def slim_demographic(obj, totals_key="omb_totals"):
    """Reduce a demographic object to just reported + totals."""
    if not obj or not isinstance(obj, dict):
        return obj
    return {
        "reported": obj.get("reported", False),
        totals_key: obj.get(totals_key, {}),
    }


def slim_study(study):
    """Return a mobile-friendly copy of a study record."""
    slim = {}
    for k in KEEP_FIELDS:
        if k in study:
            slim[k] = study[k]

    # Slim demographics: keep only reported flag + totals
    slim["race"] = slim_demographic(study.get("race"), "omb_totals")
    slim["ethnicity"] = slim_demographic(study.get("ethnicity"), "omb_totals")
    slim["sex"] = slim_demographic(study.get("sex"), "totals")
    slim["gender"] = slim_demographic(study.get("gender"), "totals")

    # Countries: if study_sites exist but countries is missing, derive from sites
    if not slim.get("countries") and study.get("study_sites"):
        unique = list({s["country"] for s in study["study_sites"] if s.get("country")})
        slim["countries"] = [{"country": c} for c in unique]

    # Minimal references: just count (for the publications column badge)
    refs = study.get("references") or []
    if refs:
        slim["reference_count"] = len(refs)

    return slim


def main():
    # Collect all studies from the full parts
    all_studies = []
    extracted_at = None

    for i in range(1, 9):
        path = f"data/demographics.part{i}.json.gz"
        if not os.path.exists(path):
            continue
        print(f"Reading {path}...")
        with gzip.open(path, "rt") as f:
            container = json.load(f)
        if extracted_at is None:
            extracted_at = container.get("extracted_at")
        all_studies.extend(container["data"])

    total = len(all_studies)
    print(f"Loaded {total} studies from full dataset")

    # Slim each study
    slim_studies = [slim_study(s) for s in all_studies]

    # Measure savings
    full_sample = json.dumps(all_studies[0], separators=(",", ":"))
    slim_sample = json.dumps(slim_studies[0], separators=(",", ":"))
    print(f"Per-study size: {len(full_sample)} → {len(slim_sample)} bytes "
          f"({100 * len(slim_sample) / len(full_sample):.0f}%)")

    # Split into parts
    chunk_size = math.ceil(total / NUM_MOBILE_PARTS)
    os.makedirs("data", exist_ok=True)

    for i in range(NUM_MOBILE_PARTS):
        start = i * chunk_size
        end = min(start + chunk_size, total)
        part_data = {
            "extracted_at": extracted_at,
            "part": i + 1,
            "total_parts": NUM_MOBILE_PARTS,
            "mobile": True,
            "data": slim_studies[start:end],
        }
        path = f"data/demographics.mobile.part{i + 1}.json.gz"
        print(f"  Mobile part {i + 1}: studies {start}–{end - 1} ({end - start} studies)")
        with gzip.open(path, "wt", compresslevel=9) as f:
            json.dump(part_data, f, separators=(",", ":"))

        size_mb = os.path.getsize(path) / (1024 * 1024)
        print(f"    → {size_mb:.1f} MB")

    total_mb = sum(
        os.path.getsize(f"data/demographics.mobile.part{i + 1}.json.gz") / (1024 ** 2)
        for i in range(NUM_MOBILE_PARTS)
    )
    print(f"\n✓ Generated {NUM_MOBILE_PARTS} mobile parts, total {total_mb:.1f} MB compressed")
    print(f"  (vs ~136 MB for full desktop data)")


if __name__ == "__main__":
    main()
