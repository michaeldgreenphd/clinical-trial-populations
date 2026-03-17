"""
Gender Identity Data Extractor

Extracts gender identity data from baseline characteristics.
Strictly decoupled from biological sex: Female/Male are NEVER mapped to
Woman/Man.  Only tables explicitly labeled as "gender" are parsed here.
"""
from typing import Dict, List, Optional
from src.utils import clean_demographic_label

# ── Strict standardized target array for gender identity ──
GENDER_CATEGORIES = ["Woman", "Man", "Non-binary", "Transgender", "Other", "Unknown or Not Reported"]

# Direct-match labels → standardized gender category
_GENDER_LABEL_MAP = {
    "woman":                    "woman",
    "women":                    "woman",
    "cisgender woman":          "woman",
    "cis woman":                "woman",
    "man":                      "man",
    "men":                      "man",
    "cisgender man":            "man",
    "cis man":                  "man",
    "non-binary":               "nonbinary",
    "nonbinary":                "nonbinary",
    "genderqueer":              "nonbinary",
    "gender non-conforming":    "nonbinary",
    "agender":                  "nonbinary",
    "genderfluid":              "nonbinary",
    "two-spirit":               "nonbinary",
    "transgender":              "transgender",
    "transgender woman":        "transgender",
    "trans woman":              "transgender",
    "transgender man":          "transgender",
    "trans man":                "transgender",
    "other":                    "other",
    "unknown":                  "unknown",
    "not reported":             "unknown",
    "prefer not to say":        "unknown",
}

# Labels that are strictly biological sex — must NEVER be mapped to gender
_SEX_ONLY_LABELS = {"female", "f", "females", "male", "m", "males", "intersex"}

GENDER_TABLE_KEYWORDS = ["gender", "gender identity"]

_MEASUREMENT_LABELS = {"count", "number", "n", "total", "value", "mean", "median"}


def is_gender_table(title: str) -> bool:
    """Check if a baseline measure is about gender identity (Context B)."""
    title_lower = title.lower()
    # Exclude combined Sex/Gender tables (handled by orchestrator)
    if "sex" in title_lower and "gender" in title_lower:
        return False
    return any(kw in title_lower for kw in GENDER_TABLE_KEYWORDS)


def map_gender_label(label: str) -> Optional[Dict]:
    """Map a label to a gender category, returning None if it's a sex-only label.

    Returns None for biological sex labels so callers can route them
    to the sex extractor instead of cross-mapping.
    """
    label_clean = clean_demographic_label(label)
    label_lower = label_clean.lower()

    # Reject sex-only labels outright
    if label_lower in _SEX_ONLY_LABELS:
        return None

    # Direct mapping
    if label_lower in _GENDER_LABEL_MAP:
        return {
            "category": _GENDER_LABEL_MAP[label_lower],
            "confidence": "high",
            "original": label_clean,
            "flags": [],
        }

    # Unknown / unmapped
    return {"category": "unknown", "confidence": "low", "original": label_clean, "flags": ["unmapped"]}


def _extract_rows_from_measure(measure: dict, overall_group_id=None,
                               fallback_denom: int = None) -> List[Dict]:
    """Low-level row extraction: yields (label, count) pairs.

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


def extract_gender_from_measure(measure: dict, overall_group_id=None,
                                fallback_denom: int = None) -> List[Dict]:
    """Extract gender data from a standard gender table (Context B).

    All rows are routed to gender.  Sex-only labels are mapped to unknown.
    """
    results = []
    for row in _extract_rows_from_measure(measure, overall_group_id, fallback_denom):
        mapping = map_gender_label(row["label"])
        if mapping is None:
            # Sex-only label in a gender table — treat as unknown gender
            mapping = {"category": "unknown", "confidence": "low",
                       "original": row["label"], "flags": ["sex_label_in_gender_table"]}
        mapping["count"] = row["count"]
        results.append(mapping)
    return results


def extract_gender_data(study: dict) -> Dict:
    """Extract all gender data from a study.

    Unified iterative loop — exhaustively checks all available modules:
      1) Standard gender tables (Context B) → all rows to gender
      2) Combined Sex/Gender tables (Context C) → row-level routing, gender portion
      3) Customized gender tables → handled same as standard
    Only declares "Not Reported" after checking all tables.
    """
    from src.utils import get_baseline_measures, get_overall_group_id, get_total_baseline_participants
    from src.sex_extractor import is_combined_sex_gender_table, extract_sex_from_combined_measure

    measures = get_baseline_measures(study)
    overall_group_id = get_overall_group_id(study)
    total_participants = get_total_baseline_participants(study, overall_group_id)

    result = {
        "reported": False,
        "totals": {
            "woman": 0,
            "man": 0,
            "nonbinary": 0,
            "transgender": 0,
            "other": 0,
            "unknown": 0,
        },
        "raw_categories": [],
        "flags": [],
    }

    combined_table_found = False

    for measure in measures:
        title = measure.get("title", "")

        # Context C: combined Sex/Gender table — extract only gender rows
        if is_combined_sex_gender_table(title):
            combined_table_found = True
            _sex_rows, gender_rows = extract_sex_from_combined_measure(
                measure, overall_group_id, fallback_denom=total_participants
            )
            if gender_rows:
                result["reported"] = True
                result["raw_categories"].extend(gender_rows)
                for cat in gender_rows:
                    result["totals"][cat["category"]] += cat["count"]
                    result["flags"].extend(cat["flags"])
                result["flags"].append("from_combined_table")
            continue

        # Standard or Customized gender table (Context B)
        if not is_gender_table(title):
            continue

        result["reported"] = True
        categories = extract_gender_from_measure(measure, overall_group_id,
                                                 fallback_denom=total_participants)
        result["raw_categories"].extend(categories)
        for cat in categories:
            result["totals"][cat["category"]] += cat["count"]
            result["flags"].extend(cat["flags"])

    # "Not Collected" enforcement: if a combined table was found but yielded
    # no gender rows (only Female/Male), explicitly mark as not collected
    if combined_table_found and not result["reported"]:
        result["flags"] = ["not_collected_from_combined_table"]

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
