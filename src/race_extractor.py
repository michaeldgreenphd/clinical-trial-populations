"""
Race Data Extractor

Extracts race data from baseline characteristics and maps to NIH/OMB categories
with granular subcategories preserved.
"""
from typing import Dict, List, Tuple, Optional
from rapidfuzz import fuzz, process

# Translation table that strips invisible Unicode characters commonly
# inserted by ClinicalTrials.gov (zero-width space, joiner, etc.)
_ZERO_WIDTH_CHARS = str.maketrans("", "", "\u200b\u200c\u200d\ufeff")

# NIH/OMB Race mappings with subcategories
RACE_MAPPINGS = {
    # American Indian / Alaska Native
    "American Indian or Alaska Native": ("american_indian_alaska_native", None),
    "American Indian or Alaskan Native": ("american_indian_alaska_native", None),
    "American Indian/Alaska Native": ("american_indian_alaska_native", None),
    "Native American": ("american_indian_alaska_native", None),
    "Indigenous": ("american_indian_alaska_native", None),
    "First Nations": ("american_indian_alaska_native", None),

    # Asian - with subcategories
    "Asian": ("asian", None),
    "Chinese": ("asian", "chinese"),
    "Japanese": ("asian", "japanese"),
    "Korean": ("asian", "korean"),
    "Vietnamese": ("asian", "vietnamese"),
    "Filipino": ("asian", "filipino"),
    "Asian Indian": ("asian", "south_asian_indian"),
    "Indian": ("asian", "south_asian_indian"),  # Note: ambiguous
    "Pakistani": ("asian", "south_asian_pakistani"),
    "Bangladeshi": ("asian", "south_asian_bangladeshi"),
    "Thai": ("asian", "southeast_asian_thai"),
    "Cambodian": ("asian", "southeast_asian_cambodian"),
    "Laotian": ("asian", "southeast_asian_laotian"),
    "Malaysian": ("asian", "southeast_asian_malaysian"),
    "Indonesian": ("asian", "southeast_asian_indonesian"),
    "Taiwanese": ("asian", "east_asian_taiwanese"),
    "East Asian": ("asian", "east_asian"),
    "South Asian": ("asian", "south_asian"),
    "Southeast Asian": ("asian", "southeast_asian"),

    # Black or African American - with subcategories
    "Black or African American": ("black_african_american", None),
    "Black": ("black_african_american", None),
    "African American": ("black_african_american", "african_american"),
    "African-American": ("black_african_american", "african_american"),
    "African": ("black_african_american", "african"),
    "Haitian": ("black_african_american", "caribbean_haitian"),
    "Jamaican": ("black_african_american", "caribbean_jamaican"),
    "Caribbean": ("black_african_american", "caribbean"),
    "West Indian": ("black_african_american", "caribbean"),
    "Sub-Saharan African": ("black_african_american", "african"),
    "Negro": ("black_african_american", None),  # Deprecated term

    # Native Hawaiian or Pacific Islander - with subcategories
    "Native Hawaiian or Other Pacific Islander": ("native_hawaiian_pacific_islander", None),
    "Native Hawaiian/Pacific Islander": ("native_hawaiian_pacific_islander", None),
    "Pacific Islander": ("native_hawaiian_pacific_islander", None),
    "Native Hawaiian": ("native_hawaiian_pacific_islander", "native_hawaiian"),
    "Hawaiian": ("native_hawaiian_pacific_islander", "native_hawaiian"),
    "Samoan": ("native_hawaiian_pacific_islander", "samoan"),
    "Guamanian": ("native_hawaiian_pacific_islander", "guamanian_chamorro"),
    "Chamorro": ("native_hawaiian_pacific_islander", "guamanian_chamorro"),
    "Tongan": ("native_hawaiian_pacific_islander", "tongan"),
    "Fijian": ("native_hawaiian_pacific_islander", "fijian"),

    # White - with subcategories
    "White": ("white", None),
    "Caucasian": ("white", None),
    "European": ("white", "european"),
    "Middle Eastern": ("white", "middle_eastern"),
    "North African": ("white", "north_african"),
    "Arab": ("white", "middle_eastern_arab"),
    "Persian": ("white", "middle_eastern_persian"),
    "Iranian": ("white", "middle_eastern_persian"),
    "Turkish": ("white", "middle_eastern_turkish"),
    "Eastern European": ("white", "european_eastern"),
    "Western European": ("white", "european_western"),

    # More than one race
    "More than one race": ("more_than_one_race", None),
    "Two or more races": ("more_than_one_race", None),
    "Multiple races": ("more_than_one_race", None),
    "Multi-racial": ("more_than_one_race", None),
    "Multiracial": ("more_than_one_race", None),
    "Mixed": ("more_than_one_race", None),
    "Mixed Race": ("more_than_one_race", None),
    "Biracial": ("more_than_one_race", None),

    # Unknown / Not Reported  (including slash-separated variants that
    # ClinicalTrials.gov returns for "Customized" measures)
    "Unknown": ("unknown_not_reported", None),
    "Not Reported": ("unknown_not_reported", None),
    "Unknown or Not Reported": ("unknown_not_reported", None),
    "Unknown/Not Reported": ("unknown_not_reported", None),
    "Unknown/Not-reported": ("unknown_not_reported", None),
    "Unknown/Not-Reported": ("unknown_not_reported", None),
    "Declined": ("unknown_not_reported", None),
    "Not Specified": ("unknown_not_reported", None),
    "Missing": ("unknown_not_reported", None),
}

# Keywords to identify race tables
RACE_TABLE_KEYWORDS = ["race", "racial"]

def is_race_table(title: str) -> bool:
    """Check if a baseline measure is about race.

    Combined titles like "Race/Ethnicity, Customized" are accepted — the
    race extractor will map whatever it can and flag unmapped labels as
    "other".  The ethnicity extractor independently handles the same
    measure and drops labels it cannot map.
    """
    title_lower = title.lower()
    return any(kw in title_lower for kw in RACE_TABLE_KEYWORDS)

def map_race_category(label: str, fuzzy_threshold: int = 85) -> Dict:
    """
    Map a race category label to NIH/OMB standard.

    Returns dict with:
        - omb_category: NIH/OMB standard category
        - subcategory: Granular subcategory if available
        - confidence: high/medium/low
        - original: Original label
        - flags: Any issues noted
    """
    # Strip invisible Unicode characters that ClinicalTrials.gov sometimes
    # inserts (e.g. U+200B ZERO WIDTH SPACE between slash and next word)
    label_clean = label.strip().translate(_ZERO_WIDTH_CHARS)
    flags = []

    # Exact match
    if label_clean in RACE_MAPPINGS:
        omb, subcat = RACE_MAPPINGS[label_clean]
        return {
            "omb_category": omb,
            "subcategory": subcat,
            "confidence": "high",
            "original": label_clean,
            "flags": flags
        }

    # Case-insensitive match
    for key, (omb, subcat) in RACE_MAPPINGS.items():
        if key.lower() == label_clean.lower():
            return {
                "omb_category": omb,
                "subcategory": subcat,
                "confidence": "high",
                "original": label_clean,
                "flags": flags
            }

    # Fuzzy match
    match = process.extractOne(label_clean, RACE_MAPPINGS.keys(), scorer=fuzz.ratio)
    if match and match[1] >= fuzzy_threshold:
        omb, subcat = RACE_MAPPINGS[match[0]]
        flags.append(f"fuzzy_match_{match[1]}")
        return {
            "omb_category": omb,
            "subcategory": subcat,
            "confidence": "medium",
            "original": label_clean,
            "flags": flags
        }

    # Could not map
    flags.append("unmapped")
    return {
        "omb_category": "other",
        "subcategory": None,
        "confidence": "low",
        "original": label_clean,
        "flags": flags
    }

# Category titles that represent measurement values, not race labels.
# When a category has one of these titles the actual label is on its parent class.
_MEASUREMENT_LABELS = {"count", "number", "n", "total", "value", "mean", "median"}

def extract_race_from_measure(measure: dict, overall_group_id: Optional[str] = None) -> List[Dict]:
    """
    Extract race data from a single baseline measure.

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
                # the real race label lives on the parent class
                if cat_title.lower() in _MEASUREMENT_LABELS:
                    label = cls.get("title", "").strip()
                else:
                    label = cat_title or cls.get("title", "").strip()
                if not label:
                    continue

                count = sum_measurements(cat.get("measurements", []), overall_group_id)

                mapping = map_race_category(label)
                mapping["count"] = count
                results.append(mapping)
        else:
            # Fallback: class itself carries measurements with no categories
            label = cls.get("title", "").strip()
            if not label:
                continue

            count = sum_measurements(cls.get("measurements", []), overall_group_id)

            mapping = map_race_category(label)
            mapping["count"] = count
            results.append(mapping)

    return results

def extract_race_data(study: dict) -> Dict:
    """
    Extract all race data from a study.

    Returns dict with:
        - reported: bool
        - omb_totals: Dict of NIH/OMB category totals
        - subcategory_totals: Dict of granular subcategory totals
        - raw_categories: List of all extracted categories
        - flags: List of any issues
    """
    from src.utils import get_baseline_measures, get_overall_group_id

    measures = get_baseline_measures(study)
    overall_group_id = get_overall_group_id(study)

    result = {
        "reported": False,
        "omb_totals": {
            "american_indian_alaska_native": 0,
            "asian": 0,
            "black_african_american": 0,
            "native_hawaiian_pacific_islander": 0,
            "white": 0,
            "more_than_one_race": 0,
            "unknown_not_reported": 0,
            "other": 0
        },
        "subcategory_totals": {},
        "raw_categories": [],
        "flags": []
    }

    race_tables_found = 0

    for measure in measures:
        title = measure.get("title", "")

        if not is_race_table(title):
            continue

        race_tables_found += 1
        result["reported"] = True

        categories = extract_race_from_measure(measure, overall_group_id)

        # Annotate categories from non-standard / combined measures so the
        # dashboard can surface the match-quality signal to the user
        title_lower = title.lower()
        is_combined   = "ethnicity" in title_lower
        is_customized = "customized" in title_lower
        if is_combined or is_customized:
            for cat in categories:
                if is_combined:
                    cat["flags"].append("combined_race_ethnicity")
                if is_customized:
                    cat["flags"].append("customized_table")

        result["raw_categories"].extend(categories)

        for cat in categories:
            # Add to OMB totals
            omb = cat["omb_category"]
            result["omb_totals"][omb] = result["omb_totals"].get(omb, 0) + cat["count"]

            # Add to subcategory totals if present
            if cat["subcategory"]:
                key = f"{omb}_{cat['subcategory']}"
                result["subcategory_totals"][key] = result["subcategory_totals"].get(key, 0) + cat["count"]

            # Collect flags
            result["flags"].extend(cat["flags"])

    if race_tables_found > 1:
        result["flags"].append(f"multiple_race_tables_{race_tables_found}")

    # Dedupe flags
    result["flags"] = list(set(result["flags"]))

    return result
