"""
Ethnicity Data Extractor

Extracts ethnicity data from baseline characteristics.
"""
from typing import Dict, List
from rapidfuzz import fuzz, process

ETHNICITY_MAPPINGS = {
    # Hispanic or Latino - with subcategories
    "Hispanic or Latino": ("hispanic_latino", None),
    "Hispanic/Latino": ("hispanic_latino", None),
    "Hispanic": ("hispanic_latino", None),
    "Latino": ("hispanic_latino", None),
    "Latina": ("hispanic_latino", None),
    "Latinx": ("hispanic_latino", None),
    "Spanish origin": ("hispanic_latino", None),
    "Mexican": ("hispanic_latino", "mexican"),
    "Mexican American": ("hispanic_latino", "mexican"),
    "Chicano": ("hispanic_latino", "mexican"),
    "Puerto Rican": ("hispanic_latino", "puerto_rican"),
    "Cuban": ("hispanic_latino", "cuban"),
    "Dominican": ("hispanic_latino", "dominican"),
    "Central American": ("hispanic_latino", "central_american"),
    "South American": ("hispanic_latino", "south_american"),
    "Guatemalan": ("hispanic_latino", "central_american_guatemalan"),
    "Honduran": ("hispanic_latino", "central_american_honduran"),
    "Salvadoran": ("hispanic_latino", "central_american_salvadoran"),
    "Colombian": ("hispanic_latino", "south_american_colombian"),
    "Peruvian": ("hispanic_latino", "south_american_peruvian"),
    "Venezuelan": ("hispanic_latino", "south_american_venezuelan"),
    "Ecuadorian": ("hispanic_latino", "south_american_ecuadorian"),
    "Argentine": ("hispanic_latino", "south_american_argentine"),
    "Chilean": ("hispanic_latino", "south_american_chilean"),

    # Not Hispanic or Latino
    "Not Hispanic or Latino": ("not_hispanic_latino", None),
    "Not Hispanic/Latino": ("not_hispanic_latino", None),
    "Non-Hispanic": ("not_hispanic_latino", None),
    "Non Hispanic": ("not_hispanic_latino", None),
    "Not Hispanic": ("not_hispanic_latino", None),

    # Unknown / Not Reported
    "Unknown": ("unknown_not_reported", None),
    "Not Reported": ("unknown_not_reported", None),
    "Unknown or Not Reported": ("unknown_not_reported", None),
    "Declined": ("unknown_not_reported", None),
    "Missing": ("unknown_not_reported", None),
}

ETHNICITY_TABLE_KEYWORDS = ["ethnicity", "ethnic", "hispanic", "latino"]

def is_ethnicity_table(title: str) -> bool:
    """Check if a baseline measure is about ethnicity."""
    title_lower = title.lower()

    # Exclude if it's primarily about race
    if "race" in title_lower and "ethnicity" not in title_lower:
        return False

    return any(kw in title_lower for kw in ETHNICITY_TABLE_KEYWORDS)

def map_ethnicity_category(label: str, fuzzy_threshold: int = 85) -> Dict:
    """Map an ethnicity category label to NIH/OMB standard."""
    label_clean = label.strip()
    flags = []

    # Exact match
    if label_clean in ETHNICITY_MAPPINGS:
        omb, subcat = ETHNICITY_MAPPINGS[label_clean]
        return {
            "omb_category": omb,
            "subcategory": subcat,
            "confidence": "high",
            "original": label_clean,
            "flags": flags
        }

    # Case-insensitive match
    for key, (omb, subcat) in ETHNICITY_MAPPINGS.items():
        if key.lower() == label_clean.lower():
            return {
                "omb_category": omb,
                "subcategory": subcat,
                "confidence": "high",
                "original": label_clean,
                "flags": flags
            }

    # Fuzzy match
    match = process.extractOne(label_clean, ETHNICITY_MAPPINGS.keys(), scorer=fuzz.ratio)
    if match and match[1] >= fuzzy_threshold:
        omb, subcat = ETHNICITY_MAPPINGS[match[0]]
        flags.append(f"fuzzy_match_{match[1]}")
        return {
            "omb_category": omb,
            "subcategory": subcat,
            "confidence": "medium",
            "original": label_clean,
            "flags": flags
        }

    flags.append("unmapped")
    return {
        "omb_category": "unknown_not_reported",
        "subcategory": None,
        "confidence": "low",
        "original": label_clean,
        "flags": flags
    }

def extract_ethnicity_from_measure(measure: dict) -> List[Dict]:
    """Extract ethnicity data from a single baseline measure."""
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

            mapping = map_ethnicity_category(label)
            mapping["count"] = count
            results.append(mapping)

    return results

def extract_ethnicity_data(study: dict) -> Dict:
    """Extract all ethnicity data from a study."""
    from src.utils import get_baseline_measures

    measures = get_baseline_measures(study)

    result = {
        "reported": False,
        "omb_totals": {
            "hispanic_latino": 0,
            "not_hispanic_latino": 0,
            "unknown_not_reported": 0
        },
        "subcategory_totals": {},
        "raw_categories": [],
        "flags": []
    }

    ethnicity_tables_found = 0

    for measure in measures:
        title = measure.get("title", "")

        if not is_ethnicity_table(title):
            continue

        ethnicity_tables_found += 1
        result["reported"] = True

        categories = extract_ethnicity_from_measure(measure)
        result["raw_categories"].extend(categories)

        for cat in categories:
            omb = cat["omb_category"]
            result["omb_totals"][omb] = result["omb_totals"].get(omb, 0) + cat["count"]

            if cat["subcategory"]:
                key = f"{omb}_{cat['subcategory']}"
                result["subcategory_totals"][key] = result["subcategory_totals"].get(key, 0) + cat["count"]

            result["flags"].extend(cat["flags"])

    if ethnicity_tables_found > 1:
        result["flags"].append(f"multiple_ethnicity_tables_{ethnicity_tables_found}")

    result["flags"] = list(set(result["flags"]))

    return result
