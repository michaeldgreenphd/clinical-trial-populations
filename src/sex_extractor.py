"""
Sex Data Extractor

Extracts biological sex data from baseline characteristics.
"""
from typing import Dict, List

SEX_MAPPINGS = {
    "Female": "female",
    "F": "female",
    "Woman": "female",
    "Women": "female",
    "Male": "male",
    "M": "male",
    "Man": "male",
    "Men": "male",
    "Unknown": "unknown",
    "Not Reported": "unknown",
    "Intersex": "unknown",
    "Other": "unknown",
}

SEX_TABLE_KEYWORDS = ["sex", "biological sex"]

# Category titles that represent measurement values, not sex labels.
# When a category has one of these titles the actual label is on its parent class.
_MEASUREMENT_LABELS = {"count", "number", "n", "total", "value", "mean", "median"}

def is_sex_table(title: str) -> bool:
    """Check if a baseline measure is about sex."""
    title_lower = title.lower()

    # Exclude gender tables
    if "gender" in title_lower and "sex" not in title_lower:
        return False

    return any(kw in title_lower for kw in SEX_TABLE_KEYWORDS)

def map_sex_category(label: str) -> Dict:
    """Map a sex category label to standard."""
    label_clean = label.strip()

    # Direct mapping
    for key, value in SEX_MAPPINGS.items():
        if key.lower() == label_clean.lower():
            return {
                "category": value,
                "confidence": "high",
                "original": label_clean,
                "flags": []
            }

    # Heuristics
    label_lower = label_clean.lower()
    if "female" in label_lower or "woman" in label_lower:
        return {"category": "female", "confidence": "medium", "original": label_clean, "flags": ["heuristic_match"]}
    if "male" in label_lower or "man" in label_lower:
        return {"category": "male", "confidence": "medium", "original": label_clean, "flags": ["heuristic_match"]}

    return {"category": "unknown", "confidence": "low", "original": label_clean, "flags": ["unmapped"]}

def extract_sex_from_measure(measure: dict, overall_group_id=None) -> List[Dict]:
    """Extract sex data from a single baseline measure.

    Args:
        measure: A single baseline measure dict from the API
        overall_group_id: groupId of the Overall group (avoids double-counting arms)

    Returns list of category records with counts.
    """
    from src.utils import sum_measurements

    results = []

    for cls in measure.get("classes", []):
        categories = cls.get("categories", [])

        if categories:
            for cat in categories:
                cat_title = (cat.get("title") or "").strip()
                # If the category title is a measurement label (e.g. "Count")
                # the real sex label lives on the parent class
                if cat_title.lower() in _MEASUREMENT_LABELS:
                    label = cls.get("title", "").strip()
                else:
                    label = cat_title or cls.get("title", "").strip()
                if not label:
                    continue

                count = sum_measurements(cat.get("measurements", []), overall_group_id)

                mapping = map_sex_category(label)
                mapping["count"] = count
                results.append(mapping)
        else:
            # Fallback: class itself carries measurements with no categories
            label = cls.get("title", "").strip()
            if not label:
                continue

            count = sum_measurements(cls.get("measurements", []), overall_group_id)

            mapping = map_sex_category(label)
            mapping["count"] = count
            results.append(mapping)

    return results

def extract_sex_data(study: dict) -> Dict:
    """Extract all sex data from a study."""
    from src.utils import get_baseline_measures, get_overall_group_id

    measures = get_baseline_measures(study)
    overall_group_id = get_overall_group_id(study)

    result = {
        "reported": False,
        "totals": {
            "female": 0,
            "male": 0,
            "unknown": 0
        },
        "raw_categories": [],
        "flags": []
    }

    for measure in measures:
        title = measure.get("title", "")

        if not is_sex_table(title):
            continue

        result["reported"] = True

        categories = extract_sex_from_measure(measure, overall_group_id)
        result["raw_categories"].extend(categories)

        for cat in categories:
            result["totals"][cat["category"]] += cat["count"]
            result["flags"].extend(cat["flags"])

    result["flags"] = list(set(result["flags"]))

    return result
