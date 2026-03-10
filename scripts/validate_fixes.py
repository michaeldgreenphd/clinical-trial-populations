"""
Offline validation script for demographic extraction fixes.
Uses mock API data that mirrors the ClinicalTrials.gov v2 response
structure for the four target studies.

Tests:
  1. NCT02498067 — Quarantine of non-race labels ("Condom", "IUD", etc.)
  2. NCT01221441 — Combined Race/Ethnicity splitting ("Unknown race, Hispanic")
  3. NCT02766335 — Combined Race/Ethnicity splitting ("Caucasian/White, Hispanic")
  4. NCT05109104 — All-zero count rejection
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.race_extractor import extract_race_data
from src.ethnicity_extractor import extract_ethnicity_data
from src.sex_extractor import extract_sex_data

# ---------------------------------------------------------------------------
# Mock studies — structured exactly like ClinicalTrials.gov API v2 responses
# ---------------------------------------------------------------------------

def _make_measurement(value, group_id="BG000"):
    return {"groupId": group_id, "value": str(value)}

def _make_category(title, value, group_id="BG000"):
    return {
        "title": title,
        "measurements": [_make_measurement(value, group_id)]
    }

def _make_class(title, categories):
    return {"title": title, "categories": categories}

def _make_measure(title, classes):
    return {"title": title, "paramType": "COUNT_OF_PARTICIPANTS", "classes": classes}

def _make_study(nct_id, title, measures, groups=None):
    if groups is None:
        groups = [{"groupId": "BG000", "title": "All Participants"}]
    return {
        "protocolSection": {
            "identificationModule": {"nctId": nct_id, "briefTitle": title},
            "statusModule": {"overallStatus": "COMPLETED",
                             "startDateStruct": {"date": "2015-01-01"},
                             "completionDateStruct": {"date": "2020-01-01"},
                             "lastUpdatePostDateStruct": {"date": "2020-06-01"},
                             "resultsFirstPostDateStruct": {"date": "2020-03-01"}},
            "designModule": {"studyType": "INTERVENTIONAL", "phases": ["PHASE3"],
                             "enrollmentInfo": {"count": 100, "type": "ACTUAL"}},
            "sponsorCollaboratorsModule": {"leadSponsor": {"name": "Test", "class": "OTHER"}},
            "conditionsModule": {"conditions": ["Test Condition"]},
            "eligibilityModule": {},
            "contactsLocationsModule": {"locations": []},
            "outcomesModule": {}
        },
        "resultsSection": {
            "baselineCharacteristicsModule": {
                "groups": groups,
                "measures": measures
            }
        }
    }

# ---------- NCT02498067: Non-race labels in a "Race" table ----------
MOCK_NCT02498067 = _make_study(
    "NCT02498067",
    "Contraceptive Methods Study (mock)",
    [
        _make_measure("Race (NIH/OMB)", [
            _make_class("", [
                _make_category("White", 30),
                _make_category("Black or African American", 15),
                _make_category("Asian", 10),
                _make_category("Condom", 8),
                _make_category("IUD", 5),
                _make_category("Withdrawal", 3),
                _make_category("Oral Contraceptive Pills", 4),
            ])
        ]),
        _make_measure("Sex: Female, Male", [
            _make_class("", [
                _make_category("Female", 40),
                _make_category("Male", 35),
            ])
        ]),
    ]
)

# ---------- NCT01221441: Combined "Unknown race, Hispanic" ----------
MOCK_NCT01221441 = _make_study(
    "NCT01221441",
    "Combined Race/Ethnicity Study A (mock)",
    [
        _make_measure("Race/Ethnicity, Customized", [
            _make_class("", [
                _make_category("White", 50),
                _make_category("Black or African American", 20),
                _make_category("Unknown race, Hispanic", 12),
                _make_category("Asian", 8),
                _make_category("Not Hispanic or Latino", 60),
                _make_category("Hispanic or Latino", 30),
            ])
        ]),
    ]
)

# ---------- NCT02766335: Combined "Caucasian/White, Hispanic" ----------
MOCK_NCT02766335 = _make_study(
    "NCT02766335",
    "Combined Race/Ethnicity Study B (mock)",
    [
        _make_measure("Race/Ethnicity, Customized", [
            _make_class("", [
                _make_category("Black or African American", 25),
                _make_category("Caucasian/White, Hispanic", 18),
                _make_category("Caucasian/White, Not Hispanic", 40),
                _make_category("Asian", 7),
                _make_category("Unknown or Not Reported", 5),
            ])
        ]),
    ]
)

# ---------- NCT05109104: All-zero counts ----------
MOCK_NCT05109104 = _make_study(
    "NCT05109104",
    "All-Zero Study (mock)",
    [
        _make_measure("Race (NIH/OMB)", [
            _make_class("", [
                _make_category("White", 0),
                _make_category("Black or African American", 0),
                _make_category("Asian", 0),
                _make_category("Unknown or Not Reported", 0),
            ])
        ]),
        _make_measure("Ethnicity (NIH/OMB)", [
            _make_class("", [
                _make_category("Hispanic or Latino", 0),
                _make_category("Not Hispanic or Latino", 0),
                _make_category("Unknown or Not Reported", 0),
            ])
        ]),
        _make_measure("Sex: Female, Male", [
            _make_class("", [
                _make_category("Female", 0),
                _make_category("Male", 0),
            ])
        ]),
    ]
)


def validate_study(study, nct_id):
    print(f"\n{'='*70}")
    print(f"  {nct_id}")
    print(f"{'='*70}")

    race = extract_race_data(study)
    ethnicity = extract_ethnicity_data(study)
    sex = extract_sex_data(study)

    # Race
    print(f"\n  RACE:")
    print(f"    reported: {race['reported']}")
    print(f"    omb_totals: {json.dumps(race['omb_totals'], indent=6)}")
    if race.get("quarantined_labels"):
        print(f"    quarantined_labels:")
        for q in race["quarantined_labels"]:
            print(f"      - \"{q['original']}\" (count={q['count']}, reason={q['reason']})")
    else:
        print(f"    quarantined_labels: []")
    print(f"    flags: {race['flags']}")
    if race.get("raw_categories"):
        print(f"    raw_categories ({len(race['raw_categories'])}):")
        for rc in race["raw_categories"]:
            print(f"      - \"{rc['original']}\" -> {rc['omb_category']} "
                  f"(confidence={rc['confidence']}, count={rc.get('count', 0)}, flags={rc['flags']})")

    # Ethnicity
    print(f"\n  ETHNICITY:")
    print(f"    reported: {ethnicity['reported']}")
    print(f"    omb_totals: {json.dumps(ethnicity['omb_totals'], indent=6)}")
    print(f"    flags: {ethnicity['flags']}")
    if ethnicity.get("raw_categories"):
        print(f"    raw_categories ({len(ethnicity['raw_categories'])}):")
        for rc in ethnicity["raw_categories"]:
            print(f"      - \"{rc['original']}\" -> {rc['omb_category']} "
                  f"(confidence={rc['confidence']}, count={rc.get('count', 0)}, flags={rc['flags']})")

    # Sex
    print(f"\n  SEX:")
    print(f"    reported: {sex['reported']}")
    print(f"    totals: {json.dumps(sex.get('totals', {}), indent=6)}")
    print(f"    flags: {sex['flags']}")


def main():
    studies = [
        (MOCK_NCT02498067, "NCT02498067"),
        (MOCK_NCT01221441, "NCT01221441"),
        (MOCK_NCT02766335, "NCT02766335"),
        (MOCK_NCT05109104, "NCT05109104"),
    ]
    for study, nct_id in studies:
        validate_study(study, nct_id)

    print(f"\n{'='*70}")
    print("  Validation complete.")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
