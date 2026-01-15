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

def extract_sex_from_measure(measure: dict) -> List[Dict]:
    """Extract sex data from a single baseline measure."""
    results = []

    for cls in measure.get("classes", []):
        for cat in cls.get("categories", []):
            label = cat.get("title") or cls.get("title", "")
            if not label:
                continue

            count = 0
            for m in cat.get("measurements", []):
                try:
                    count = int(float(m.get("value", 0)))
                    break
                except (ValueError, TypeError):
                    pass

            mapping = map_sex_category(label)
            mapping["count"] = count
            results.append(mapping)

    return results

def extract_sex_data(study: dict) -> Dict:
    """Extract all sex data from a study."""
    from src.utils import get_baseline_measures

    measures = get_baseline_measures(study)

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

        categories = extract_sex_from_measure(measure)
        result["raw_categories"].extend(categories)

        for cat in categories:
            result["totals"][cat["category"]] += cat["count"]
            result["flags"].extend(cat["flags"])

    result["flags"] = list(set(result["flags"]))

    return result
