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

    return {
        "nct_id": id_mod.get("nctId", ""),
        "brief_title": id_mod.get("briefTitle", ""),
        "study_type": design_mod.get("studyType", ""),
        "phase": ", ".join(design_mod.get("phases", [])),
        "enrollment": design_mod.get("enrollmentInfo", {}).get("count", 0),
        "status": status_mod.get("overallStatus", ""),
        "results_date": status_mod.get("resultsFirstPostDateStruct", {}).get("date", ""),
        "last_update": status_mod.get("lastUpdatePostDateStruct", {}).get("date", ""),
        "sponsor_class": sponsor_mod.get("leadSponsor", {}).get("class", ""),
        "countries": protocol.get("contactsLocationsModule", {}).get("locations", [])
    }

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
