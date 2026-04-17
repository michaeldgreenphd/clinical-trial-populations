# ClinicalTrials.gov Demographics Dashboard

Automated system to extract demographic data (race, ethnicity, sex, gender) from ClinicalTrials.gov and display it in a live dashboard hosted on GitHub Pages.

## Overview

This project extracts and standardizes demographic reporting from clinical trials registered on ClinicalTrials.gov, using NIH/OMB standard categories for race and ethnicity, enabling analysis of diversity in clinical research.

## Features

- **Comprehensive Extraction**: Extracts race, ethnicity, biological sex, and gender identity data
- **Standardized Categories**: Maps to NIH/OMB standard categories with granular subcategories
- **Fuzzy Matching**: Handles variations in demographic category labels
- **Interactive Dashboard**: GitHub Pages site with filterable visualizations
- **Automated Updates**: Weekly scheduled extraction via GitHub Actions

## Project Structure

```
├── src/
│   ├── api_client.py          # ClinicalTrials.gov API v2 client
│   ├── utils.py                # Shared utility functions
│   ├── race_extractor.py       # Race data extraction and mapping
│   ├── ethnicity_extractor.py  # Ethnicity data extraction
│   ├── sex_extractor.py        # Biological sex extraction
│   ├── gender_extractor.py     # Gender identity extraction
│   └── extract_all.py          # Main orchestrator script
├── config/
│   └── settings.yaml           # Configuration settings
├── .github/workflows/
│   └── extract.yml             # GitHub Actions workflow
├── data/                       # Output directory for extracted data
└── requirements.txt            # Python dependencies
```

## Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/clinical-trial-populations.git
cd clinical-trial-populations

# Install dependencies
pip install -r requirements.txt
```

## Usage

### Extract Demographics Data

```bash
# Test with 100 studies
python src/extract_all.py --output data/test_100.json --limit 100

# Test with 1,000 studies
python src/extract_all.py --output data/test_1000.json --limit 1000

# Full extraction (all studies with results)
python src/extract_all.py --output data/demographics.json

# Filter by condition
python src/extract_all.py --output data/diabetes.json --condition "diabetes"

# Filter by results posted after date
python src/extract_all.py --output data/recent.json --results-after "2020-01-01"
```

## Demographic Categories

### Race (NIH/OMB Standard)
- American Indian or Alaska Native
- Asian (with subcategories: Chinese, Japanese, Korean, etc.)
- Black or African American (with subcategories: African American, Caribbean, etc.)
- Native Hawaiian or Other Pacific Islander
- White (with subcategories: European, Middle Eastern, etc.)
- More than one race
- Unknown or Not Reported

### Ethnicity (NIH/OMB Standard)
- Hispanic or Latino (with subcategories: Mexican, Puerto Rican, Cuban, etc.)
- Not Hispanic or Latino
- Unknown or Not Reported

### Biological Sex
- Female
- Male
- Unknown

### Gender Identity
- Woman
- Man
- Non-binary
- Other
- Unknown

## Data Output Format

The extraction produces JSON files with the following structure:

```json
{
  "extracted_at": "2024-01-15T10:30:00",
  "data": [
    {
      "nct_id": "NCT12345678",
      "brief_title": "Study Title",
      "study_type": "INTERVENTIONAL",
      "phase": "Phase 3",
      "enrollment": 500,
      "status": "COMPLETED",
      "results_date": "2023-06-15",
      "sponsor_class": "INDUSTRY",
      "race": {
        "reported": true,
        "omb_totals": {
          "white": 300,
          "black_african_american": 100,
          "asian": 75,
          ...
        },
        "subcategory_totals": {
          "asian_chinese": 30,
          "asian_south_asian_indian": 25,
          ...
        },
        "flags": []
      },
      "ethnicity": { ... },
      "sex": { ... },
      "gender": { ... }
    }
  ]
}
```

## GitHub Actions Workflow

The repository includes a GitHub Actions workflow that:
1. Runs weekly (Sunday at 6 AM UTC)
2. Extracts demographics data from ClinicalTrials.gov
3. Commits updated data to the repository
4. Triggers dashboard rebuild

Can also be manually triggered via workflow_dispatch.

## Configuration

Edit `config/settings.yaml` to customize:
- API rate limiting
- Fuzzy matching threshold
- Output format and directory

## Dashboard

The interactive dashboard is hosted on GitHub Pages and includes:
- Overview statistics and reporting trends
- Race distribution with subcategory drill-down
- Ethnicity distribution and trends
- Sex distribution and trends
- Gender identity reporting
- Filterable by year range, study type, and sponsor

## Beta & Curation Access

This repository is private and the dashboard exposes two Beta tabs that display
raw LLM extractions awaiting review. Access to those tabs and to the curator
actions on the manuscript discrepancy report is password-gated. Because the
repository is private, the passwords live in source.

| Scope | Password(s) | What it unlocks |
|-------|-------------|-----------------|
| **Beta tab access** | `claude4science` | Opens the two Beta tabs — *(Beta) AI Demographic Extraction* and *(Beta) Paper Data Extraction*. Once entered, the tabs stay unlocked for the rest of the browser session (`sessionStorage`). |
| **Curator actions** | `maryam` *or* `michael` | Required when a curator clicks **Confirm** or **Deny** on an Addition or Conflict row in the manuscript discrepancy engine. The matched lowercase identity is stored alongside the resolution so we have a lightweight audit trail for the pilot. |

These gates are deliberately lightweight — they're a speed bump that keeps
unreviewed numbers from being shared casually, not a real authentication
system. Treat the passwords as shared secrets: rotate them if the repository
is ever made public, and don't paste them into issues or public PRs.

### Where the passwords live in code

- `app.js` — `BETA_PASSWORD`, `CURATOR_PASSWORDS`, and the `showPasswordGate()`
  modal. Session-scoped unlock state is kept in `sessionStorage` under
  `betaExtractionUnlocked`.
- The curator resolution map (manuscript slug + field path → `{status,
  curator, timestamp}`) is kept in `sessionStorage` under `litCurationState`
  for the pilot. Persistent curation output belongs in a reviewed CSV, not in
  browser storage.

## Contributing

Contributions are welcome! Areas for improvement:
- Additional demographic categories
- Enhanced fuzzy matching
- Dashboard visualizations
- Documentation

## License

MIT License

## Acknowledgments

Based on research methodology from:
- Green MD, et al. Racial and Ethnic Diversity in Clinical Studies, 2009-2024
- NIH/OMB standard categories for race and ethnicity data collection

## References

- [ClinicalTrials.gov API v2 Documentation](https://clinicaltrials.gov/data-api/api)
- [NIH Policy on Reporting Race and Ethnicity Data](https://grants.nih.gov/grants/guide/notice-files/NOT-OD-15-089.html)
- [OMB Standards for Race and Ethnicity](https://www.govinfo.gov/content/pkg/FR-1997-10-30/pdf/97-28653.pdf)
