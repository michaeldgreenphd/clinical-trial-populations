"""
Sex Data Extractor

Extracts biological sex data from baseline characteristics.
Implements context-aware routing: only biological sex labels (Female, Male)
are mapped here.  Gender identity labels (Woman, Man) are never cross-mapped.
"""
from typing import Dict, List, Optional
from src.utils import clean_demographic_label

# ── Strict standardized target array for biological sex ──
SEX_CATEGORIES = ["Female", "Male", "Unknown or Not Reported"]

# Direct-match labels → standardized sex category (lowercase keys for case-insensitive lookup)
_SEX_LABEL_MAP = {
    "female":           "female",
    "f":                "female",
    "females":          "female",
    "male":             "male",
    "m":                "male",
    "males":            "male",
    "intersex":         "unknown",
    "unknown":          "unknown",
    "not reported":     "unknown",
    "other":            "unknown",
}

# Labels that are strictly gender identity — must NEVER be mapped to sex
_GENDER_ONLY_LABELS = {
    "woman", "women", "man", "men",
    "non-binary", "nonbinary", "genderqueer", "gender non-conforming",
    "agender", "genderfluid", "two-spirit",
    "cisgender woman", "cis woman", "transgender woman", "trans woman",
    "cisgender man", "cis man", "transgender man", "trans man",
    "transgender", "prefer not to say",
}

SEX_TABLE_KEYWORDS = ["sex", "biological sex"]

# Category titles that represent measurement values, not demographic labels.
_MEASUREMENT_LABELS = {"count", "number", "n", "total", "value", "mean", "median"}


def is_sex_table(title: str) -> bool:
    """Check if a baseline measure is about sex (Context A)."""
    title_lower = title.lower()
    # Exclude pure gender tables
    if "gender" in title_lower and "sex" not in title_lower:
        return False
    return any(kw in title_lower for kw in SEX_TABLE_KEYWORDS)


def is_combined_sex_gender_table(title: str) -> bool:
    """Check if a baseline measure is a combined Sex/Gender table (Context C)."""
    title_lower = title.lower()
    return "sex" in title_lower and "gender" in title_lower


def map_sex_label(label: str) -> Optional[Dict]:
    """Map a label to a sex category, returning None if it's a gender-only label.

    Returns None for gender-identity labels so callers can route them
    to the gender extractor instead of cross-mapping.
    """
    label_clean = clean_demographic_label(label)
    label_lower = label_clean.lower()

    # Reject gender-only labels outright
    if label_lower in _GENDER_ONLY_LABELS:
        return None

    # Direct mapping
    if label_lower in _SEX_LABEL_MAP:
        return {
            "category": _SEX_LABEL_MAP[label_lower],
            "confidence": "high",
            "original": label_clean,
            "flags": [],
        }

    # Heuristics — only biological sex terms
    if "female" in label_lower:
        return {"category": "female", "confidence": "medium", "original": label_clean, "flags": ["heuristic_match"]}
    if "male" in label_lower and "female" not in label_lower:
        return {"category": "male", "confidence": "medium", "original": label_clean, "flags": ["heuristic_match"]}

    # Unknown / unmapped — still a sex record (not a gender one)
    return {"category": "unknown", "confidence": "low", "original": label_clean, "flags": ["unmapped"]}


def _extract_rows_from_measure(measure: dict, overall_group_id=None,
                               fallback_denom: int = None) -> List[Dict]:
    """Low-level row extraction: yields (label, count) pairs from a measure.

    Percentage-aware: if the measure reports percentages, values are
    converted to estimated counts using the measure's Number Analyzed,
    or the study enrollment as a fallback for cluster-randomized studies.
    """
    from src.utils import sum_measurements, is_percentage_measure, get_measure_denom

    is_pct = is_percentage_measure(measure)
    denom = None
    if is_pct:
        denom = get_measure_denom(measure, overall_group_id)
        if denom is None:
            denom = fallback_denom

    rows = []
    for cls in measure.get("classes", []):
        categories = cls.get("categories", [])
        if categories:
            for cat in categories:
                cat_title = (cat.get("title") or "").strip()
                if cat_title.lower() in _MEASUREMENT_LABELS:
                    label = cls.get("title", "").strip()
                else:
                    label = cat_title or cls.get("title", "").strip()
                if not label:
                    continue
                count = sum_measurements(cat.get("measurements", []), overall_group_id,
                                         is_pct=is_pct, denom=denom)
                rows.append({"label": label, "count": count})
        else:
            label = cls.get("title", "").strip()
            if not label:
                continue
            count = sum_measurements(cls.get("measurements", []), overall_group_id,
                                     is_pct=is_pct, denom=denom)
            rows.append({"label": label, "count": count})
    return rows


def extract_sex_from_measure(measure: dict, overall_group_id=None,
                             fallback_denom: int = None) -> List[Dict]:
    """Extract sex data from a standard sex table (Context A).

    All rows are routed to sex.  Gender-only labels are mapped to unknown.
    """
    results = []
    for row in _extract_rows_from_measure(measure, overall_group_id, fallback_denom):
        mapping = map_sex_label(row["label"])
        if mapping is None:
            # Gender-only label in a sex table — treat as unknown sex
            mapping = {"category": "unknown", "confidence": "low",
                       "original": row["label"], "flags": ["gender_label_in_sex_table"]}
        mapping["count"] = row["count"]
        results.append(mapping)
    return results


def extract_sex_from_combined_measure(measure: dict, overall_group_id=None,
                                      fallback_denom: int = None):
    """Extract from a combined Sex/Gender table (Context C).

    Uses strict row-level routing: Female/Male → sex, Woman/Man → gender.
    Returns (sex_rows, gender_rows) tuple.
    """
    from src.gender_extractor import map_gender_label

    sex_rows = []
    gender_rows = []

    rows = _extract_rows_from_measure(measure, overall_group_id, fallback_denom)

    # Explicit gender identity labels that unambiguously belong in the gender array
    _EXPLICIT_GENDER_LABELS = {
        "woman", "women", "man", "men",
        "non-binary", "nonbinary", "genderqueer", "gender non-conforming",
        "agender", "genderfluid", "two-spirit", "transgender",
        "cisgender woman", "cis woman", "transgender woman", "trans woman",
        "cisgender man", "cis man", "transgender man", "trans man",
    }

    # First pass: classify each row
    unclassified = []
    for row in rows:
        label_lower = row["label"].strip().lower()

        # Try sex mapping first (Female/Male)
        sex_mapping = map_sex_label(row["label"])
        if sex_mapping is not None and sex_mapping["category"] != "unknown":
            sex_mapping["count"] = row["count"]
            sex_rows.append(sex_mapping)
            continue

        # Try explicit gender identity labels only (not "Other"/"Unknown")
        if label_lower in _EXPLICIT_GENDER_LABELS:
            gender_mapping = map_gender_label(row["label"])
            if gender_mapping is not None:
                gender_mapping["count"] = row["count"]
                gender_rows.append(gender_mapping)
                continue

        # Ambiguous (Other/Unknown) — save for second pass
        unclassified.append(row)

    # Second pass: route ambiguous rows based on table context
    has_sex_data = len(sex_rows) > 0
    has_gender_data = len(gender_rows) > 0

    for row in unclassified:
        if has_sex_data and not has_gender_data:
            # Table is primarily sex → route to sex unknown
            mapping = {"category": "unknown", "confidence": "medium",
                       "original": row["label"], "flags": ["ambiguous_routed_to_sex"],
                       "count": row["count"]}
            sex_rows.append(mapping)
        elif has_gender_data and not has_sex_data:
            # Table is primarily gender → route to gender
            label_lower = row["label"].strip().lower()
            cat = "other" if label_lower == "other" else "unknown"
            mapping = {"category": cat, "confidence": "medium",
                       "original": row["label"], "flags": ["ambiguous_routed_to_gender"],
                       "count": row["count"]}
            gender_rows.append(mapping)
        else:
            # Both present or neither — default to sex unknown
            mapping = {"category": "unknown", "confidence": "low",
                       "original": row["label"], "flags": ["ambiguous_combined_table"],
                       "count": row["count"]}
            sex_rows.append(mapping)

    return sex_rows, gender_rows


def extract_sex_data(study: dict) -> Dict:
    """Extract all sex data from a study.

    Unified iterative loop — exhaustively checks all available modules:
      1) Standard sex tables (Context A) → all rows to sex
      2) Combined Sex/Gender tables (Context C) → row-level routing, sex portion
      3) Customized sex tables → handled same as standard
    Only declares "Not Reported" after checking all tables.
    """
    from src.utils import get_baseline_measures, get_overall_group_id, get_total_baseline_participants

    measures = get_baseline_measures(study)
    overall_group_id = get_overall_group_id(study)
    total_participants = get_total_baseline_participants(study, overall_group_id)

    result = {
        "reported": False,
        "totals": {"female": 0, "male": 0, "unknown": 0},
        "raw_categories": [],
        "flags": [],
    }

    for measure in measures:
        title = measure.get("title", "")

        # Context C: combined Sex/Gender table — extract only sex rows
        if is_combined_sex_gender_table(title):
            sex_rows, _gender_rows = extract_sex_from_combined_measure(
                measure, overall_group_id, fallback_denom=total_participants
            )
            if sex_rows:
                result["reported"] = True
                result["raw_categories"].extend(sex_rows)
                for cat in sex_rows:
                    result["totals"][cat["category"]] += cat["count"]
                    result["flags"].extend(cat["flags"])
                result["flags"].append("from_combined_table")
            continue

        # Standard or Customized sex table (Context A)
        if not is_sex_table(title):
            continue

        result["reported"] = True
        categories = extract_sex_from_measure(measure, overall_group_id,
                                             fallback_denom=total_participants)
        result["raw_categories"].extend(categories)
        for cat in categories:
            result["totals"][cat["category"]] += cat["count"]
            result["flags"].extend(cat["flags"])

    # All-zero rejection
    if result["reported"] and all(v == 0 for v in result["totals"].values()):
        result["reported"] = False
        result["totals"] = {k: 0 for k in result["totals"]}
        result["raw_categories"] = []
        result["flags"] = ["all_zero_rejection"]

    # Denominator balancing
    if result["reported"]:
        total_participants = get_total_baseline_participants(study, overall_group_id)
        if total_participants is not None and total_participants > 0:
            reported_sum = sum(result["totals"].values())
            remainder = total_participants - reported_sum
            if remainder > 0:
                result["totals"]["unknown"] += remainder
                result["flags"].append("denominator_balanced")

    result["flags"] = list(set(result["flags"]))
    return result
