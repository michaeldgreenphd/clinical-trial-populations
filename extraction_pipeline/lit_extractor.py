import pandas as pd
import requests
import json
import os
import re
import anthropic
from datetime import date

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
UNPAYWALL_EMAIL = "michaeldgreen0520@gmail.com"
EUROPEPMC_SEARCH_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"

# Titles containing these tokens describe something other than the primary
# results manuscript we actually want (design papers, secondary analyses,
# observational extensions, surveys, etc.). We deduct a heavy penalty so that
# when a primary-results paper exists in the candidate set, it wins.
TITLE_PENALTY_KEYWORDS = [
    "protocol",
    "secondary analysis",
    "retrospective",
    "observational",
    "survey",
    "post-hoc",
    "post hoc",
    "design",
    "rationale",
]
TITLE_PENALTY = -50

# Primary-results papers typically appear within ~2 years of trial
# completion. Candidates published in that window get a bonus so they
# outrank late follow-up analyses.
TEMPORAL_BONUS = 30
TEMPORAL_WINDOW_MONTHS = 24

# NCT-match bonus: EuropePMC returns the query as free-text, so papers that
# genuinely reference the NCT in their abstract/body deserve a small nudge
# above papers that merely happen to match on other fields.
NCT_MATCH_BONUS = 10


def parse_iso_date(value):
    """Accept 'YYYY', 'YYYY-MM', or 'YYYY-MM-DD' and return a date at the
    start of the month/year. Returns None if unparseable."""
    if not value or not isinstance(value, str):
        return None
    s = value.strip()
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            from datetime import datetime
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def months_between(earlier, later):
    if not earlier or not later:
        return None
    return (later.year - earlier.year) * 12 + (later.month - earlier.month)


def score_candidate(title, pub_date, trial_completion_date, nct_id=None, abstract=None):
    """Return an adjusted relevance score for a single candidate paper.

    Penalises titles containing protocol / secondary-analysis / observational
    / survey / post-hoc / design / rationale tokens, and rewards papers
    published 0-24 months after the trial's primary completion date."""
    score = 0.0
    lowered = (title or "").lower()
    for kw in TITLE_PENALTY_KEYWORDS:
        if kw in lowered:
            score += TITLE_PENALTY

    pub = parse_iso_date(pub_date)
    comp = parse_iso_date(trial_completion_date)
    delta_months = months_between(comp, pub)
    if delta_months is not None and 0 <= delta_months <= TEMPORAL_WINDOW_MONTHS:
        score += TEMPORAL_BONUS

    if nct_id and abstract and nct_id.upper() in abstract.upper():
        score += NCT_MATCH_BONUS

    return score


def europepmc_candidates(nct_id):
    """Query EuropePMC for papers referencing an NCT ID. Returns a list of
    dicts with title, doi, pub_date, abstract, pmid."""
    params = {
        "query": nct_id,
        "format": "json",
        "pageSize": 25,
        "resultType": "core",
    }
    try:
        resp = requests.get(EUROPEPMC_SEARCH_URL, params=params, timeout=15)
        payload = resp.json()
    except Exception:
        return []
    hits = payload.get("resultList", {}).get("result", []) or []
    candidates = []
    for h in hits:
        candidates.append({
            "title": h.get("title") or "",
            "doi": (h.get("doi") or "").lower(),
            "pub_date": h.get("firstPublicationDate") or h.get("pubYear") or "",
            "abstract": h.get("abstractText") or "",
            "pmid": h.get("pmid") or "",
            "journal": h.get("journalTitle") or "",
        })
    return candidates


def pick_best_candidate(nct_id, trial_completion_date):
    """Score all EuropePMC candidates for `nct_id` and return the highest-
    scoring one (or None). Ties are broken by newer publication date."""
    candidates = europepmc_candidates(nct_id)
    if not candidates:
        return None, []
    ranked = []
    for c in candidates:
        s = score_candidate(
            title=c["title"],
            pub_date=c["pub_date"],
            trial_completion_date=trial_completion_date,
            nct_id=nct_id,
            abstract=c["abstract"],
        )
        ranked.append({**c, "score": s})
    ranked.sort(key=lambda x: (x["score"], x["pub_date"]), reverse=True)
    return ranked[0], ranked


def get_open_access_data(doi):
    url = f"https://api.unpaywall.org/v2/{doi}?email={UNPAYWALL_EMAIL}"
    try:
        data = requests.get(url, timeout=10).json()
        title = data.get('title', 'Title Not Found')
        pdf_url = None
        if data.get('is_oa') and data.get('best_oa_location'):
            pdf_url = data['best_oa_location'].get('url_for_pdf')
            if not pdf_url:
                pdf_url = data['best_oa_location'].get('url')
        if not pdf_url:
            pdf_url = f"https://doi.org/{doi}"
        return pdf_url, title
    except Exception:
        pass
    return f"https://doi.org/{doi}", "Title Not Found"


def extract_pdf_text_from_url(pdf_url):
    import pdfplumber
    import io
    try:
        response = requests.get(pdf_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
        with pdfplumber.open(io.BytesIO(response.content)) as pdf:
            return "\n".join([page.extract_text() for page in pdf.pages if page.extract_text()])
    except Exception:
        return None


# System prompt enforces evidence-first chain of thought: every boolean and
# every string summary must be preceded by a verbatim quote in the matching
# `_evidence` field. The booleans must default to false unless the SES
# evidence quote actually contains language about that indicator.
LIT_SYSTEM_PROMPT = """You are a population health researcher extracting Socioeconomic Status (SES) indicators and race detail from clinical trial manuscripts.

Use the `record_ses_and_race` tool. For every value on the tool, follow a strict chain of thought:
  1. FIRST, quote the specific sentence(s) from the manuscript that discuss the topic into the matching `_evidence` field. If no relevant sentence exists, write "Not Reported".
     - For `ses_indicators_evidence`, copy any sentences mentioning income, education, insurance/payer/coverage, employment, occupation, neighborhood, or other socioeconomic markers.
     - For `detailed_race_breakdown_evidence`, copy the sentences (or table rows transcribed as sentences) describing race / ethnicity counts or percentages.
     - For `study_name_evidence`, copy the sentence introducing the formal trial name (e.g., "The ALLHAT Trial", "SPRINT Study").
     - For `nct_id_evidence`, copy the sentence containing the ClinicalTrials.gov registration (NCT followed by 8 digits).
  2. ONLY AFTER recording the evidence, derive the booleans (income_reported, education_reported, insurance_status_reported) and the summary strings (ses_notes, detailed_race_breakdown, study_name, nct_id).

The booleans must be `false` unless the SES evidence quote literally contains language about that indicator. Do NOT infer reporting from study setting, country of origin, or insurance-system context alone.

If the manuscript does not name a formal study, set study_name to "Not Reported".
If no NCT id is present in the text, set nct_id to "Not Reported".
"""

# Anthropic tool schema. `_evidence` fields are positioned immediately before
# the values they support so the model fills them first when iterating
# top-to-bottom over the schema.
LIT_SES_AND_RACE_TOOL = {
    "name": "record_ses_and_race",
    "description": (
        "Record SES indicators, race breakdown, study name, and NCT ID "
        "from a clinical trial manuscript. Each value field is paired with "
        "an `_evidence` field that must contain the verbatim quote(s) "
        "supporting that value. Fill the evidence first, then the value."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "study_name_evidence": {
                "type": "string",
                "description": "Verbatim sentence introducing the formal trial name (e.g., 'The ALLHAT Trial').",
            },
            "study_name": {
                "type": "string",
                "description": "Formal study name, or 'Not Reported' if absent.",
            },
            "nct_id_evidence": {
                "type": "string",
                "description": "Verbatim sentence containing the ClinicalTrials.gov NCT id.",
            },
            "nct_id": {
                "type": "string",
                "description": "Full NCT id (NCT followed by 8 digits), or 'Not Reported'.",
            },
            "ses_indicators_evidence": {
                "type": "string",
                "description": (
                    "Verbatim sentence(s) discussing income, education, "
                    "insurance/payer/coverage, employment, occupation, "
                    "neighborhood, or other socioeconomic markers. "
                    "Use 'Not Reported' if the manuscript discusses none."
                ),
            },
            "income_reported": {
                "type": "boolean",
                "description": "True only if `ses_indicators_evidence` literally mentions income / earnings / wages.",
            },
            "education_reported": {
                "type": "boolean",
                "description": "True only if `ses_indicators_evidence` literally mentions education / schooling / degree attainment.",
            },
            "insurance_status_reported": {
                "type": "boolean",
                "description": "True only if `ses_indicators_evidence` literally mentions insurance, payer, coverage, or Medicare/Medicaid.",
            },
            "ses_notes": {
                "type": "string",
                "description": "Concise summary of how SES was reported, or 'None' if absent.",
            },
            "detailed_race_breakdown_evidence": {
                "type": "string",
                "description": "Verbatim sentence(s) (or table rows in prose) reporting race / ethnicity counts or percentages.",
            },
            "detailed_race_breakdown": {
                "type": "string",
                "description": "Concise summary of the reported race/ethnicity breakdown, or 'None' if absent.",
            },
        },
        "required": [
            "study_name_evidence", "study_name",
            "nct_id_evidence", "nct_id",
            "ses_indicators_evidence",
            "income_reported", "education_reported",
            "insurance_status_reported", "ses_notes",
            "detailed_race_breakdown_evidence", "detailed_race_breakdown",
        ],
    },
}


def extract_ses_and_race_with_claude(text):
    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            temperature=0,
            system=LIT_SYSTEM_PROMPT,
            tools=[LIT_SES_AND_RACE_TOOL],
            tool_choice={"type": "tool", "name": LIT_SES_AND_RACE_TOOL["name"]},
            messages=[{"role": "user", "content": text[:150000]}],
        )
        tool_block = next(
            (b for b in response.content if getattr(b, "type", None) == "tool_use"),
            None,
        )
        if tool_block is None:
            return {"error": "Model returned no tool_use block"}, {
                "input": response.usage.input_tokens,
                "output": response.usage.output_tokens,
            }
        data = tool_block.input
        tokens = {"input": response.usage.input_tokens, "output": response.usage.output_tokens}
        return data, tokens
    except Exception:
        return {"error": "Extraction failed"}, {"input": 0, "output": 0}


def resolve_doi_for_row(row):
    """Prefer an explicit DOI on the input row; otherwise pick the best
    EuropePMC candidate using the NCT ID + trial completion date."""
    doi = str(row.get("doi") or "").strip().lower()
    if doi:
        return doi, None, []
    nct = str(row.get("nct_id") or row.get("NCT Number") or "").strip().upper()
    if not nct:
        return None, None, []
    completion = row.get("primary_completion_date") or row.get("completion_date") or ""
    best, ranked = pick_best_candidate(nct, completion)
    return (best["doi"] if best else None), best, ranked


def process_literature_batch(input_csv, output_csv):
    df = pd.read_csv(input_csv)
    results, total_input, total_output, success_count = [], 0, 0, 0

    for index, row in df.head(10).iterrows():
        doi, best, ranked = resolve_doi_for_row(row)
        nct = str(row.get("nct_id") or row.get("NCT Number") or "").strip().upper()
        if not doi:
            results.append({
                "nct_id": nct,
                "status": "No candidate found",
                "candidate_count": len(ranked),
            })
            continue

        pdf_url, title = get_open_access_data(doi)
        base_record = {
            "doi": doi,
            "nct_id": nct,
            "study_title": (best["title"] if best else title) or title,
            "oa_pdf_url": pdf_url,
            "candidate_score": best["score"] if best else None,
            "candidate_count": len(ranked),
        }

        if pdf_url and not pdf_url.startswith("https://doi.org/"):
            text = extract_pdf_text_from_url(pdf_url)
            if text:
                data, tokens = extract_ses_and_race_with_claude(text)
                data.update({**base_record, "status": "Extracted"})
                results.append(data)
                total_input += tokens['input']
                total_output += tokens['output']
                success_count += 1
            else:
                results.append({**base_record, "status": "Failed text read"})
        else:
            results.append({**base_record, "status": "Closed Access"})

    pd.DataFrame(results).to_csv(output_csv, index=False)

    metrics = {
        "pilot_size": success_count,
        "total_studies": len(df),
        "avg_input_per_doc": total_input / success_count if success_count > 0 else 0,
        "avg_output_per_doc": total_output / success_count if success_count > 0 else 0
    }
    with open('lit_token_metrics.json', 'w') as f:
        json.dump(metrics, f)


if __name__ == "__main__":
    process_literature_batch(
        input_csv="data/lit_pilot_input.csv",
        output_csv="data/lit_ses_extracted.csv"
    )
