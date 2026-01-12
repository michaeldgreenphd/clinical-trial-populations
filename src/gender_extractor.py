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

def extract_gender_from_measure(measure: dict) -> List[Dict]:
    """Extract gender data from a single baseline measure."""
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

            mapping = map_gender_category(label)
            mapping["count"] = count
            results.append(mapping)

    return results

def extract_gender_data(study: dict) -> Dict:
    """Extract all gender data from a study."""
    from src.utils import get_baseline_measures

    measures = get_baseline_measures(study)

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

        categories = extract_gender_from_measure(measure)
        result["raw_categories"].extend(categories)

        for cat in categories:
            result["totals"][cat["category"]] += cat["count"]
            result["flags"].extend(cat["flags"])

    result["flags"] = list(set(result["flags"]))

    return result
