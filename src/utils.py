"""Shared utilities"""
import json
from pathlib import Path
from datetime import datetime

def get_baseline_measures(study: dict) -> list:
    """Extract baseline characteristic measures from a study."""
    return (study
            .get("resultsSection", {})
            .get("baselineCharacteristicsModule", {})
            .get("measures", []))

def get_study_metadata(study: dict) -> dict:
    """Extract common study metadata."""
    protocol = study.get("protocolSection", {})
    id_mod = protocol.get("identificationModule", {})
    status_mod = protocol.get("statusModule", {})
    design_mod = protocol.get("designModule", {})
    sponsor_mod = protocol.get("sponsorCollaboratorsModule", {})
    outcomes_mod = protocol.get("outcomesModule", {})

    # Extract unique country names from locations
    locations = protocol.get("contactsLocationsModule", {}).get("locations", [])
    countries = [{"country": c} for c in sorted(set(
        loc.get("country", "")
        for loc in locations
        if loc.get("country")
    ))]

    # Extract study design information
    design_info = design_mod.get("designInfo", {})
    allocation = design_info.get("allocation", "N/A")
    intervention_model = design_info.get("interventionModel", "N/A")
    primary_purpose = design_info.get("primaryPurpose", "N/A")
    masking_info = design_info.get("maskingInfo", {})
    masking = masking_info.get("masking", "NONE")

    # Extract primary outcomes
    primary_outcomes = outcomes_mod.get("primaryOutcomes", [])
    primary_outcome_measures = [outcome.get("measure", "") for outcome in primary_outcomes]
    primary_endpoint = primary_outcome_measures[0] if primary_outcome_measures else "N/A"

    # Extract sponsor information
    lead_sponsor = sponsor_mod.get("leadSponsor", {})
    lead_sponsor_name = lead_sponsor.get("name", "Unknown")
    lead_sponsor_class = lead_sponsor.get("class", "Unknown")

    return {
        "nct_id": id_mod.get("nctId", ""),
        "brief_title": id_mod.get("briefTitle", ""),
        "study_type": design_mod.get("studyType", ""),
        "phase": ", ".join(design_mod.get("phases", [])),
        "enrollment": design_mod.get("enrollmentInfo", {}).get("count", 0),
        "status": status_mod.get("overallStatus", ""),
        "results_date": status_mod.get("resultsFirstPostDateStruct", {}).get("date", ""),
        "last_update": status_mod.get("lastUpdatePostDateStruct", {}).get("date", ""),
        "sponsor_class": lead_sponsor_class,
        "lead_sponsor_name": lead_sponsor_name,
        "countries": countries,
        # Study design fields
        "allocation": allocation,
        "intervention_model": intervention_model,
        "primary_purpose": primary_purpose,
        "masking": masking,
        "primary_endpoint": primary_endpoint
    }

def extract_demographic_breakdown(measures: list, category_type: str) -> dict:
    """
    Extract demographic breakdown with counts and percentages.

    Args:
        measures: List of baseline characteristic measures
        category_type: 'race', 'ethnicity', or 'sex'

    Returns:
        Dictionary mapping category names to {count, percent} dicts
    """
    breakdown = {}
    category_lower = category_type.lower()

    for measure in measures:
        title = measure.get("title", "").lower()

        # Match the category type
        if category_lower not in title:
            continue

        # Skip combined race/ethnicity tables
        if category_lower == "race" and "ethnicity" in title:
            continue
        if category_lower == "ethnicity" and "race" in title:
            continue

        classes = measure.get("classes", [])

        for cls in classes:
            categories = cls.get("categories", [])

            for cat in categories:
                cat_title = cat.get("title") or cls.get("title", "Unknown")
                if not cat_title or cat_title == "Unknown":
                    continue

                measurements = cat.get("measurements", [])

                # Sum across all arms/groups for total
                total_count = 0
                for m in measurements:
                    value = m.get("value", "0")
                    try:
                        # Handle both integer and string values
                        total_count += int(float(value))
                    except (ValueError, TypeError):
                        pass

                if cat_title not in breakdown:
                    breakdown[cat_title] = {"count": 0}
                breakdown[cat_title]["count"] += total_count

    # Calculate percentages
    total = sum(d["count"] for d in breakdown.values())
    if total > 0:
        for cat in breakdown:
            breakdown[cat]["percent"] = round((breakdown[cat]["count"] / total) * 100, 1)
    else:
        for cat in breakdown:
            breakdown[cat]["percent"] = 0.0

    return breakdown if breakdown else None


def save_json(data: any, path: Path):
    """Save data as JSON with timestamp."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump({
            "extracted_at": datetime.now().isoformat(),
            "data": data
        }, f, indent=2)

def load_json(path: Path) -> dict:
    """Load JSON file."""
    with open(path) as f:
        return json.load(f)
