"""
ClinicalTrials.gov API v2 Client
"""
import time
import requests
from typing import Iterator, Dict, Any, Optional, List

class CTGovAPIClient:
    BASE_URL = "https://clinicaltrials.gov/api/v2"

    DEFAULT_FIELDS = [
        "NCTId",
        "BriefTitle",
        "StudyType",
        "Phase",
        "EnrollmentCount",
        "OverallStatus",
        "ResultsFirstPostDate",
        "LastUpdatePostDate",
        "LeadSponsorClass",
        "LocationCountry",
        "ResultsSection"
    ]

    def __init__(self, page_size: int = 100, rate_limit_delay: float = 0.5):
        self.page_size = min(page_size, 100)
        self.rate_limit_delay = rate_limit_delay
        self.session = requests.Session()
        self._last_request_time = 0

    def _rate_limit(self):
        elapsed = time.time() - self._last_request_time
        if elapsed < self.rate_limit_delay:
            time.sleep(self.rate_limit_delay - elapsed)
        self._last_request_time = time.time()

    def search_studies(self, page_token: Optional[str] = None, **filters) -> Dict[str, Any]:
        self._rate_limit()

        params = {
            "pageSize": self.page_size,
            "format": "json",
            # Don't specify fields - get the full study record with all protocol sections
            "filter.advanced": "AREA[ResultsFirstPostDate]RANGE[MIN,MAX]"  # Has results
        }

        if page_token:
            params["pageToken"] = page_token
        if filters.get("condition"):
            params["query.cond"] = filters["condition"]

        # Handle date filtering
        if filters.get("results_after") and filters.get("results_before"):
            # Both start and end date provided - use RANGE
            params["filter.resultsFirstPostDate"] = f"{filters['results_after']}:{filters['results_before']}"
        elif filters.get("results_after"):
            # Only start date - use MIN to MAX
            params["filter.resultsFirstPostDate"] = f"{filters['results_after']}:MAX"
        elif filters.get("results_before"):
            # Only end date - use MIN to specified date
            params["filter.resultsFirstPostDate"] = f"MIN:{filters['results_before']}"

        response = self.session.get(f"{self.BASE_URL}/studies", params=params, timeout=30)
        response.raise_for_status()
        return response.json()

    def iter_all_studies_with_results(self, limit: Optional[int] = None, **filters) -> Iterator[Dict]:
        page_token = None
        count = 0

        while True:
            data = self.search_studies(page_token=page_token, **filters)
            studies = data.get("studies", [])

            if not studies:
                break

            for study in studies:
                yield study
                count += 1
                if limit and count >= limit:
                    return

            page_token = data.get("nextPageToken")
            if not page_token:
                break
