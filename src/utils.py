"""Shared utilities"""
import json
import re
from pathlib import Path
from datetime import datetime
from typing import Optional

# Translation table that strips invisible Unicode characters commonly
# inserted by ClinicalTrials.gov (zero-width space, joiner, etc.)
_ZERO_WIDTH_CHARS = str.maketrans("", "", "\u200b\u200c\u200d\ufeff")

# Regex patterns for measurement suffixes appended to row labels in
# ClinicalTrials.gov "Customized" tables (e.g. "Female, %", "White, %",
# "Black, n", "Asian (%)").
_LABEL_SUFFIX_RE = re.compile(
    r',\s*'             # REQUIRE a comma before the suffix
    r'(?:'
    r'%'                # bare percent
    r'|n'               # bare "n" (count indicator)
    r'|\(%?\)'          # parenthesized percent "(%) or "()"
    r'|\(n\)'           # parenthesized n "(n)"
    r')'
    r'\s*$',            # end of string
    re.IGNORECASE
)


def clean_demographic_label(label: str) -> str:
    """Strip measurement suffixes from demographic labels.

    ClinicalTrials.gov "Customized" tables often append units like ', %'
    to row labels (e.g. 'Female, %', 'White, %').  This strips those
    suffixes so standard category matching works.

    Also removes invisible Unicode characters (zero-width spaces, etc.).
    """
    label = label.strip().translate(_ZERO_WIDTH_CHARS)
    label = _LABEL_SUFFIX_RE.sub('', label)
    return label.strip()

def calculate_days_between(start_date: str, end_date: str) -> Optional[int]:
    """
    Calculate days between two dates in YYYY-MM-DD format.
    Returns None if either date is missing or invalid.

    Note: ClinicalTrials.gov API sometimes returns partial dates (YYYY-MM or YYYY).
    We normalize these by assuming the 1st day of the month/year.
    """
    if not start_date or not end_date:
        return None

    try:
        # Normalize partial dates to full dates
        # If date is YYYY-MM, append -01
        # If date is YYYY, append -01-01
        def normalize_date(date_str: str) -> str:
            parts = date_str.split('-')
            if len(parts) == 1:  # YYYY only
                return f"{parts[0]}-01-01"
            elif len(parts) == 2:  # YYYY-MM
                return f"{parts[0]}-{parts[1]}-01"
            else:  # YYYY-MM-DD already
                return date_str

        start_normalized = normalize_date(start_date)
        end_normalized = normalize_date(end_date)

        start = datetime.strptime(start_normalized, "%Y-%m-%d")
        end = datetime.strptime(end_normalized, "%Y-%m-%d")
        return (end - start).days
    except (ValueError, TypeError):
        return None

def extract_references(study: dict) -> list:
    """Extract publication references from a study."""
    protocol = study.get("protocolSection", {})
    refs_mod = protocol.get("referencesModule", {})

    references = []

    # Get references from the referencesModule
    for ref in refs_mod.get("references", []):
        pmid = ref.get("pmid")
        citation = ref.get("citation", "")
        ref_type = ref.get("type", "")

        if pmid:
            references.append({
                "pmid": pmid,
                "citation": citation,
                "type": ref_type,
                "source": "clinicaltrials.gov"
            })

    return references

def get_baseline_measures(study: dict) -> list:
    """Extract baseline characteristic measures from a study."""
    return (study
            .get("resultsSection", {})
            .get("baselineCharacteristicsModule", {})
            .get("measures", []))

def get_overall_group_id(study: dict) -> Optional[str]:
    """
    Find the groupId of the 'Overall' group in baseline characteristics.

    Multi-arm studies have per-arm measurements AND an Overall measurement
    in each category.  We need the Overall groupId so we can read that single
    measurement instead of summing (which would double-count).

    Returns None when there is only one group (no ambiguity) or when no
    Overall group can be identified.
    """
    groups = (study.get("resultsSection", {})
              .get("baselineCharacteristicsModule", {})
              .get("groups", []))

    if len(groups) <= 1:
        return None          # single group — every measurement IS the overall

    for group in groups:
        title_lower = group.get("title", "").lower().strip()
        if ("overall" in title_lower or
            title_lower in {"total", "all participants", "all subjects", "all patients"}):
            return group.get("groupId")

    return None

def sum_measurements(measurements: list, overall_group_id: str = None) -> int:
    if overall_group_id:
        for m in measurements:
            if m.get("groupId") == overall_group_id:
                val = m.get("value")
                if val is not None:
                    try:
                        return int(float(str(val).replace(",", "")))
                    except (ValueError, TypeError):
                        pass
                break
    if not measurements:
        return 0
    if len(measurements) == 1:
        val = measurements[0].get("value")
    else:
        val = measurements[-1].get("value")
    if val is None:
        return 0
    try:
        return int(float(str(val).replace(",", "")))
    except (ValueError, TypeError):
        return 0

def get_total_baseline_participants(study: dict, overall_group_id: Optional[str] = None) -> Optional[int]:
    """Extract the total number of participants analyzed in baseline characteristics.

    Reads the ``denoms`` array in the baselineCharacteristicsModule.  When an
    *overall_group_id* is known, returns that group's denominator directly
    (avoids double-counting arms).  Otherwise sums all denominator counts, or
    — for single-group studies — returns the single value.

    Falls back to the protocol-section enrollment count when denoms are absent.
    Returns None if nothing can be determined.
    """
    baseline = (study.get("resultsSection", {})
                .get("baselineCharacteristicsModule", {}))

    # Try denoms (most reliable — "Number Analyzed" for baseline)
    for denom in baseline.get("denoms", []):
        if denom.get("units", "").lower() != "participants":
            continue
        counts = denom.get("counts", [])
        if not counts:
            continue

        if overall_group_id:
            for c in counts:
                if c.get("groupId") == overall_group_id:
                    try:
                        return int(float(str(c["value"]).replace(",", "")))
                    except (ValueError, TypeError):
                        pass
            # overall_group_id didn't match any count — fall through

        # Single group or no overall — use last entry (mirrors sum_measurements)
        if len(counts) == 1:
            val = counts[0].get("value")
        else:
            val = counts[-1].get("value")
        if val is not None:
            try:
                return int(float(str(val).replace(",", "")))
            except (ValueError, TypeError):
                pass

    # Fallback: enrollment from the protocol section
    enrollment = (study.get("protocolSection", {})
                  .get("designModule", {})
                  .get("enrollmentInfo", {})
                  .get("count"))
    if enrollment is not None:
        try:
            return int(enrollment)
        except (ValueError, TypeError):
            pass

    return None

def get_study_metadata(study: dict) -> dict:
    """Extract common study metadata."""
    protocol = study.get("protocolSection", {})
    id_mod = protocol.get("identificationModule", {})
    status_mod = protocol.get("statusModule", {})
    design_mod = protocol.get("designModule", {})
    sponsor_mod = protocol.get("sponsorCollaboratorsModule", {})
    outcomes_mod = protocol.get("outcomesModule", {})
    eligibility_mod = protocol.get("eligibilityModule", {})
    conditions_mod = protocol.get("conditionsModule", {})

    # Extract detailed location information from study sites
    raw_locations = protocol.get("contactsLocationsModule", {}).get("locations", [])

    # Build detailed location list with geo_identification_method
    detailed_locations = []
    for loc in raw_locations:
        country = loc.get("country", "")
        if not country:
            continue

        state = loc.get("state", "")
        city = loc.get("city", "")
        zip_code = loc.get("zip", "")
        facility = loc.get("facility", "")

        # Determine geo_identification_method based on available precision
        if zip_code:
            geo_method = "High Precision (Zip)"
        elif city and state:
            geo_method = "Medium Precision (City)"
        elif city or state:
            geo_method = "Medium Precision (City)"
        else:
            geo_method = "Low Precision (Country)"

        detailed_locations.append({
            "facility": facility,
            "city": city,
            "state": state,
            "zip": zip_code,
            "country": country,
            "geo_identification_method": geo_method
        })

    # Also create simplified countries list for backward compatibility
    countries = [{"country": c} for c in sorted(set(
        loc.get("country", "")
        for loc in raw_locations
        if loc.get("country")
    ))]

    # Calculate overall geo_identification_method for the study
    if detailed_locations:
        methods = [loc["geo_identification_method"] for loc in detailed_locations]
        if all(m == "High Precision (Zip)" for m in methods):
            study_geo_method = "High Precision (Zip)"
        elif any("High" in m or "Medium" in m for m in methods):
            study_geo_method = "Medium Precision (City)"
        else:
            study_geo_method = "Low Precision (Country)"
    else:
        study_geo_method = "Not Reported"

    # Extract conditions (diseases/medical conditions)
    conditions = conditions_mod.get("conditions", [])
    # Also get keywords which can provide additional condition information
    keywords = conditions_mod.get("keywords", [])

    # Extract study design information
    design_info = design_mod.get("designInfo", {})
    allocation = design_info.get("allocation", "N/A")
    intervention_model = design_info.get("interventionModel", "N/A")
    intervention_model_description = design_info.get("interventionModelDescription", "")
    observational_model = design_info.get("observationalModel", "N/A")
    time_perspective = design_info.get("timePerspective", "N/A")
    primary_purpose = design_info.get("primaryPurpose", "N/A")

    # Extract masking information
    masking_info = design_info.get("maskingInfo", {})
    masking = masking_info.get("masking", "NONE")
    masking_description = masking_info.get("maskingDescription", "")
    who_masked = masking_info.get("whoMasked", [])
    subject_masked = "PARTICIPANT" in who_masked
    caregiver_masked = "CARE_PROVIDER" in who_masked
    investigator_masked = "INVESTIGATOR" in who_masked
    outcomes_assessor_masked = "OUTCOMES_ASSESSOR" in who_masked

    # Extract primary outcomes with full details
    primary_outcomes = outcomes_mod.get("primaryOutcomes", [])
    primary_outcome = primary_outcomes[0] if primary_outcomes else {}
    primary_endpoint = primary_outcome.get("measure", "N/A")
    primary_outcome_time_frame = primary_outcome.get("timeFrame", "")
    primary_outcome_description = primary_outcome.get("description", "")

    # Extract secondary outcomes
    secondary_outcomes_raw = outcomes_mod.get("secondaryOutcomes", [])
    secondary_outcomes = [
        {
            "measure": outcome.get("measure", ""),
            "time_frame": outcome.get("timeFrame", ""),
            "description": outcome.get("description", "")
        }
        for outcome in secondary_outcomes_raw
    ] if secondary_outcomes_raw else []

    # Extract sponsor and collaborator information
    lead_sponsor = sponsor_mod.get("leadSponsor", {})
    lead_sponsor_name = lead_sponsor.get("name", "Unknown")
    lead_sponsor_class = lead_sponsor.get("class", "Unknown")

    collaborators_raw = sponsor_mod.get("collaborators", [])
    collaborators = [
        {
            "name": collab.get("name", ""),
            "class": collab.get("class", "")
        }
        for collab in collaborators_raw
    ] if collaborators_raw else []

    # Extract enrollment information
    enrollment_info = design_mod.get("enrollmentInfo", {})
    enrollment = enrollment_info.get("count", 0)
    enrollment_type = enrollment_info.get("type", "N/A")  # ACTUAL or ANTICIPATED

    # Extract eligibility criteria
    min_age = eligibility_mod.get("minimumAge", "N/A")
    max_age = eligibility_mod.get("maximumAge", "N/A")
    std_ages = eligibility_mod.get("stdAges", [])
    gender = eligibility_mod.get("sex", "ALL")
    healthy_volunteers = eligibility_mod.get("healthyVolunteers", False)

    # Compute pediatric status from stdAges
    has_child = "CHILD" in std_ages
    has_adult = "ADULT" in std_ages or "OLDER_ADULT" in std_ages
    if not std_ages:
        pediatric_status = "Not Specified"
    elif has_child and not has_adult:
        pediatric_status = "Pediatric Only"
    elif has_child and has_adult:
        pediatric_status = "Pediatric Included"
    else:
        pediatric_status = "Adult Only"

    # Extract completion and status details
    start_date_struct = status_mod.get("startDateStruct", {})
    start_date = start_date_struct.get("date", "")
    completion_date_struct = status_mod.get("completionDateStruct", {})
    completion_date = completion_date_struct.get("date", "")
    primary_completion_date_struct = status_mod.get("primaryCompletionDateStruct", {})
    primary_completion_date = primary_completion_date_struct.get("date", "")
    results_date = status_mod.get("resultsFirstPostDateStruct", {}).get("date", "")
    why_stopped = status_mod.get("whyStopped", "")

    # Calculate time metrics
    completion_to_report = calculate_days_between(primary_completion_date, results_date)
    start_to_report = calculate_days_between(start_date, results_date)

    # Extract publication references
    references = extract_references(study)

    return {
        "nct_id": id_mod.get("nctId", ""),
        "brief_title": id_mod.get("briefTitle", ""),
        "study_type": design_mod.get("studyType", ""),
        "phase": ", ".join(design_mod.get("phases", [])),
        "enrollment": enrollment,
        "enrollment_type": enrollment_type,
        "status": status_mod.get("overallStatus", ""),
        "start_date": start_date,
        "results_date": results_date,
        "last_update": status_mod.get("lastUpdatePostDateStruct", {}).get("date", ""),
        "completion_date": completion_date,
        "primary_completion_date": primary_completion_date,
        "why_stopped": why_stopped,
        "sponsor_class": lead_sponsor_class,
        "lead_sponsor_name": lead_sponsor_name,
        "collaborators": collaborators,
        "countries": countries,
        "study_sites": detailed_locations,  # Full location details with facility, city, state, zip
        "geo_identification_method": study_geo_method,  # Overall precision level for the study
        "conditions": conditions,
        "keywords": keywords,
        # Study design fields
        "allocation": allocation,
        "intervention_model": intervention_model,
        "intervention_model_description": intervention_model_description,
        "observational_model": observational_model,
        "time_perspective": time_perspective,
        "primary_purpose": primary_purpose,
        "masking": masking,
        "masking_description": masking_description,
        "subject_masked": subject_masked,
        "caregiver_masked": caregiver_masked,
        "investigator_masked": investigator_masked,
        "outcomes_assessor_masked": outcomes_assessor_masked,
        # Outcome fields
        "primary_endpoint": primary_endpoint,
        "primary_outcome_time_frame": primary_outcome_time_frame,
        "primary_outcome_description": primary_outcome_description,
        "secondary_outcomes": secondary_outcomes,
        # Eligibility fields
        "min_age": min_age,
        "max_age": max_age,
        "std_ages": std_ages,
        "pediatric_status": pediatric_status,
        "gender": gender,
        "healthy_volunteers": healthy_volunteers,
        # Time metrics
        "completion_to_report_days": completion_to_report,
        "start_to_report_days": start_to_report,
        # Publications
        "references": references
    }

def extract_demographic_breakdown(measures: list, category_type: str, overall_group_id: Optional[str] = None) -> dict:
    """
    Extract demographic breakdown with counts and percentages.

    Args:
        measures: List of baseline characteristic measures
        category_type: 'race', 'ethnicity', or 'sex'
        overall_group_id: groupId of the Overall group (from get_overall_group_id)

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

        # Combined "Race/Ethnicity" tables: process for race (the race
        # extractor flags unmapped labels transparently) but skip for
        # ethnicity (race labels like "White" would appear as noise).
        if category_lower == "ethnicity" and "race" in title:
            continue

        classes = measure.get("classes", [])

        # Category titles that represent measurement values, not demographic labels
        _measurement_labels = {"count", "number", "n", "total", "value", "mean", "median"}

        for cls in classes:
            categories = cls.get("categories", [])

            if categories:
                for cat in categories:
                    cat_title = (cat.get("title") or "").strip().translate(_ZERO_WIDTH_CHARS)
                    # If the category title is empty or is a measurement label
                    # (e.g. "Count") the real demographic label lives on the
                    # parent class — fall back to it.
                    if not cat_title or cat_title.lower() in _measurement_labels:
                        cat_title = cls.get("title", "Unknown").strip().translate(_ZERO_WIDTH_CHARS)
                    if not cat_title or cat_title == "Unknown":
                        continue

                    total_count = sum_measurements(cat.get("measurements", []), overall_group_id)

                    if cat_title not in breakdown:
                        breakdown[cat_title] = {"count": 0}
                    breakdown[cat_title]["count"] += total_count
            else:
                # Fallback: class itself carries measurements with no categories
                cat_title = cls.get("title", "Unknown").strip().translate(_ZERO_WIDTH_CHARS)
                if not cat_title or cat_title == "Unknown":
                    continue

                total_count = sum_measurements(cls.get("measurements", []), overall_group_id)

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
