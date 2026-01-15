"""
Extract all demographics data from ClinicalTrials.gov

This orchestrator script extracts race, ethnicity, sex, and gender data
from clinical trials and saves them to a unified JSON file.
"""
import argparse
import logging
from pathlib import Path
from tqdm import tqdm

from src.api_client import CTGovAPIClient
from src.utils import get_study_metadata, save_json
from src.race_extractor import extract_race_data
from src.ethnicity_extractor import extract_ethnicity_data
from src.sex_extractor import extract_sex_data
from src.gender_extractor import extract_gender_data

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def extract_demographics_from_study(study: dict) -> dict:
    """
    Extract all demographic data from a single study.

    Args:
        study: Study data from ClinicalTrials.gov API

    Returns:
        Dictionary containing study metadata and all demographic data
    """
    try:
        metadata = get_study_metadata(study)
        race_data = extract_race_data(study)
        ethnicity_data = extract_ethnicity_data(study)
        sex_data = extract_sex_data(study)
        gender_data = extract_gender_data(study)

        return {
            **metadata,
            "race": race_data,
            "ethnicity": ethnicity_data,
            "sex": sex_data,
            "gender": gender_data
        }
    except Exception as e:
        logger.error(f"Error extracting from study {study.get('protocolSection', {}).get('identificationModule', {}).get('nctId', 'UNKNOWN')}: {str(e)}")
        return None

def main():
    parser = argparse.ArgumentParser(
        description="Extract demographics data from ClinicalTrials.gov"
    )
    parser.add_argument(
        "--output", "-o",
        required=True,
        help="Output file path (will be saved as JSON)"
    )
    parser.add_argument(
        "--limit", "-n",
        type=int,
        default=None,
        help="Limit number of studies to extract (for testing)"
    )
    parser.add_argument(
        "--condition", "-c",
        default=None,
        help="Filter by medical condition"
    )
    parser.add_argument(
        "--results-after",
        default=None,
        help="Filter by results posted after date (YYYY-MM-DD)"
    )
    args = parser.parse_args()

    # Initialize API client
    logger.info("Initializing ClinicalTrials.gov API client...")
    client = CTGovAPIClient(page_size=100, rate_limit_delay=0.5)

    # Extract data
    logger.info("Starting extraction...")
    if args.limit:
        logger.info(f"Limiting to {args.limit} studies")
    if args.condition:
        logger.info(f"Filtering by condition: {args.condition}")

    results = []
    errors = 0

    studies = client.iter_all_studies_with_results(
        limit=args.limit,
        condition=args.condition,
        results_after=args.results_after
    )

    for study in tqdm(studies, desc="Extracting demographics"):
        result = extract_demographics_from_study(study)
        if result:
            results.append(result)
        else:
            errors += 1

    # Save results
    output_path = Path(args.output)
    if not output_path.suffix:
        output_path = output_path / "demographics.json"

    logger.info(f"Saving {len(results)} studies to {output_path}")
    save_json(results, output_path)

    # Summary statistics
    logger.info("\n=== Extraction Summary ===")
    logger.info(f"Total studies extracted: {len(results)}")
    logger.info(f"Errors encountered: {errors}")

    if results:
        race_reporting = sum(1 for r in results if r.get("race", {}).get("reported"))
        ethnicity_reporting = sum(1 for r in results if r.get("ethnicity", {}).get("reported"))
        sex_reporting = sum(1 for r in results if r.get("sex", {}).get("reported"))
        gender_reporting = sum(1 for r in results if r.get("gender", {}).get("reported"))

        logger.info(f"\nReporting rates:")
        logger.info(f"  Race: {race_reporting} ({race_reporting/len(results)*100:.1f}%)")
        logger.info(f"  Ethnicity: {ethnicity_reporting} ({ethnicity_reporting/len(results)*100:.1f}%)")
        logger.info(f"  Sex: {sex_reporting} ({sex_reporting/len(results)*100:.1f}%)")
        logger.info(f"  Gender: {gender_reporting} ({gender_reporting/len(results)*100:.1f}%)")

        both_race_ethnicity = sum(1 for r in results if r.get("race", {}).get("reported") and r.get("ethnicity", {}).get("reported"))
        logger.info(f"  Both race & ethnicity: {both_race_ethnicity} ({both_race_ethnicity/len(results)*100:.1f}%)")

    logger.info("\nExtraction complete!")

if __name__ == "__main__":
    main()
