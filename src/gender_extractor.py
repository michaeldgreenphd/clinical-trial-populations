"""
Gender Data Extractor

Extracts gender identity data from baseline characteristics.
Note: Many studies conflate sex and gender. This extractor focuses on
tables explicitly labeled as "gender" or "gender identity".
"""
from typing import Dict, List

GENDER_MAPPINGS = {
    "Woman": "woman",
    "Female": "woman",
    "Cisgender Woman": "woman",
    "Cis Woman": "woman",
    "Transgender Woman": "woman",
    "Trans Woman": "woman",
    "Man": "man",
    "Male": "man",
    "Cisgender Man": "man",
    "Cis Man": "man",
    "Transgender Man": "man",
    "Trans Man": "man",
    "Non-binary": "nonbinary",
    "Nonbinary": "nonbinary",
    "Genderqueer": "nonbinary",
    "Gender Non-conforming": "nonbinary",
    "Agender": "nonbinary",
    "Genderfluid": "nonbinary",
    "Two-Spirit": "nonbinary",
    "Other": "other",
    "Unknown": "unknown",
    "Not Reported": "unknown",
    "Prefer not to say": "unknown",
}

GENDER_TABLE_KEYWORDS = ["gender", "gender identity"]

# Category titles that represent measurement values, not gender labels.
# When a category has one of these titles the actual label is on its parent class.
_MEASUREMENT_LABELS = {"count", "number", "n", "total", "value", "mean", "median"}

def is_gender_table(title: str) -> bool:
    """Check if a baseline measure is about gender identity."""
    title_lower = title.lower()
    return any(kw in title_lower for kw in GENDER_TABLE_KEYWORDS)

def map_gender_category(label: str) -> Dict:
    """Map a gender category label to standard."""
    label_clean = label.strip()

    for key, value in GENDER_MAPPINGS.items():
        if key.lower() == label_clean.lower():
            return {
                "category": value,
                "confidence": "high",
                "original": label_clean,
                "flags": []
            }

    return {"category": "unknown", "confidence": "low", "original": label_clean, "flags": ["unmapped"]}

def extract_gender_from_measure(measure: dict, overall_group_id=None) -> List[Dict]:
    """Extract gender data from a single baseline measure.

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
                # the real gender label lives on the parent class
                if cat_title.lower() in _MEASUREMENT_LABELS:
                    label = cls.get("title", "").strip()
                else:
                    label = cat_title or cls.get("title", "").strip()
                if not label:
                    continue

                count = sum_measurements(cat.get("measurements", []), overall_group_id)

                mapping = map_gender_category(label)
                mapping["count"] = count
                results.append(mapping)
        else:
            # Fallback: class itself carries measurements with no categories
            label = cls.get("title", "").strip()
            if not label:
                continue

            count = sum_measurements(cls.get("measurements", []), overall_group_id)

            mapping = map_gender_category(label)
            mapping["count"] = count
            results.append(mapping)

    return results

def extract_gender_data(study: dict) -> Dict:
    """Extract all gender data from a study."""
    from src.utils import get_baseline_measures, get_overall_group_id

    measures = get_baseline_measures(study)
    overall_group_id = get_overall_group_id(study)

    result = {
        "reported": False,
        "totals": {
            "woman": 0,
            "man": 0,
            "nonbinary": 0,
            "other": 0,
            "unknown": 0
        },
        "raw_categories": [],
        "flags": []
    }

    for measure in measures:
        title = measure.get("title", "")

        if not is_gender_table(title):
            continue

        result["reported"] = True

        categories = extract_gender_from_measure(measure, overall_group_id)
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

    result["flags"] = list(set(result["flags"]))

    return result
