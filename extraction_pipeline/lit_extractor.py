import json
import os
import re
import sys
from datetime import date

import anthropic
import pandas as pd
import requests
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

# Provider routing — default to Anthropic so existing CI keeps working unless
# AI_PROVIDER=vertex_gemini is set explicitly. Both providers share the same
# tool schema (defined below); the per-provider helpers translate it.
AI_PROVIDER = os.environ.get("AI_PROVIDER", "anthropic")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))


def _is_retriable(exc):
    """True if `exc` is a transient API failure worth retrying.

    Covers Anthropic (RateLimitError 429, OverloadedError 529, network /
    timeout errors), Vertex AI / Gemini (ResourceExhausted,
    ServiceUnavailable, DeadlineExceeded), plus plain `requests` timeouts.
    Matched by class name to avoid hard-importing google.api_core in the
    Anthropic-only path.
    """
    name = type(exc).__name__
    if name in {
        "RateLimitError", "OverloadedError",
        "APIConnectionError", "APITimeoutError",
        "ResourceExhausted", "ServiceUnavailable", "DeadlineExceeded",
    }:
        return True
    if isinstance(exc, requests.exceptions.RequestException):
        return True
    status_code = getattr(exc, "status_code", None)
    if status_code in (429, 529):
        return True
    return False


# Up to 3 attempts with exponential backoff (2s, 4s, 8s — capped at 30s).
# `reraise=True` so the final failure surfaces the original exception.
retry_api_call = retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    retry=retry_if_exception(_is_retriable),
    reraise=True,
)


def _to_gemini_schema(schema):
    """Recursively normalise an Anthropic-style JSON schema into the subset
    Gemini function declarations accept. Gemini forbids union types, so we
    flatten them to `"string"`. `properties` and `items` recurse."""
    if not isinstance(schema, dict):
        return schema
    out = dict(schema)
    t = out.get("type")
    if isinstance(t, list):
        out["type"] = "string"
    if "properties" in out:
        out["properties"] = {k: _to_gemini_schema(v) for k, v in out["properties"].items()}
    if "items" in out:
        out["items"] = _to_gemini_schema(out["items"])
    return out


# Strict integer-string pattern: optional leading minus, then digits only.
# Used to recover integer typing for fields that `_to_gemini_schema` had to
# flatten to "string" (Gemini rejects union types in function-call schemas),
# so the resulting CSV stays numerically typed regardless of provider.
_INT_STRING_RE = re.compile(r"^-?\d+$")


def _proto_to_dict(val):
    """Convert Gemini's protobuf MapComposite / RepeatedComposite return
    values into plain Python dicts and lists so the result matches the
    Anthropic `tool_use.input` payload shape exactly.

    Also coerces strings that represent whole integers (e.g. "-1", "42")
    back into Python `int`. Gemini's schema flattening pushes integer
    fields with a union type to "string", which means the model returns
    "−1" instead of -1; that breaks downstream type checks (frontend
    `typeof === 'number'`) and pandas mixes types when serialising the
    CSV. Coercing on the way out keeps the dict shape identical to the
    Anthropic branch.
    """
    if hasattr(val, "items") and not isinstance(val, (str, bytes)):
        return {k: _proto_to_dict(v) for k, v in val.items()}
    if hasattr(val, "__iter__") and not isinstance(val, (str, bytes)):
        return [_proto_to_dict(v) for v in val]
    if isinstance(val, str):
        s = val.strip()
        if _INT_STRING_RE.match(s):
            try:
                return int(s)
            except ValueError:
                pass
    return val
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


@retry_api_call
def _extract_ses_and_race_anthropic(text):
    """Anthropic path. Decorated with `retry_api_call` so 429 / 529 / network
    blips are retried up to 3 times with exponential backoff before the
    exception bubbles up to the batch-loop's try/finally."""
    response = client.messages.create(
        model=ANTHROPIC_MODEL,
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
    tokens = {
        "input": response.usage.input_tokens,
        "output": response.usage.output_tokens,
    }
    if tool_block is None:
        return {"error": "Model returned no tool_use block"}, tokens
    return tool_block.input, tokens


@retry_api_call
def _extract_ses_and_race_vertex(text):
    """Vertex AI / Gemini path. Translates `LIT_SES_AND_RACE_TOOL` into a
    `FunctionDeclaration`, forces tool use via `ToolConfig.Mode.ANY`, and
    passes the literature system prompt via `system_instruction` so the
    user message is just the manuscript text. Returns the same dict shape
    as the Anthropic branch.
    """
    import vertexai
    from vertexai.generative_models import (
        FunctionDeclaration,
        GenerativeModel,
        Tool,
        ToolConfig,
    )

    vertexai.init(
        project=os.environ.get("GCP_PROJECT_ID"),
        location=os.environ.get("GCP_LOCATION", "global"),
    )

    gemini_tool = Tool(function_declarations=[
        FunctionDeclaration(
            name=LIT_SES_AND_RACE_TOOL["name"],
            description=LIT_SES_AND_RACE_TOOL["description"],
            parameters=_to_gemini_schema(LIT_SES_AND_RACE_TOOL["input_schema"]),
        )
    ])
    tool_config = ToolConfig(
        function_calling_config=ToolConfig.FunctionCallingConfig(
            mode=ToolConfig.FunctionCallingConfig.Mode.ANY,
            allowed_function_names=[LIT_SES_AND_RACE_TOOL["name"]],
        )
    )
    model = GenerativeModel(
        model_name=GEMINI_MODEL,
        tools=[gemini_tool],
        tool_config=tool_config,
        system_instruction=LIT_SYSTEM_PROMPT,
    )
    response = model.generate_content(
        text[:150000],
        generation_config={"max_output_tokens": 4096, "temperature": 0},
    )

    data = {"error": "Model returned no function_call"}
    for cand in response.candidates:
        for part in cand.content.parts:
            fc = getattr(part, "function_call", None)
            if fc and getattr(fc, "name", "") == LIT_SES_AND_RACE_TOOL["name"]:
                data = _proto_to_dict(fc.args)
                break
        if isinstance(data, dict) and "error" not in data:
            break

    usage = getattr(response, "usage_metadata", None)
    tokens = {
        "input": getattr(usage, "prompt_token_count", 0) or 0,
        "output": getattr(usage, "candidates_token_count", 0) or 0,
    }
    return data, tokens


def extract_ses_and_race_with_claude(text):
    """Provider-agnostic facade. Routes to Anthropic or Vertex Gemini based
    on the AI_PROVIDER env var. Both branches return identical dict shapes
    so downstream `process_literature_batch` doesn't need to branch."""
    try:
        if AI_PROVIDER == "vertex_gemini":
            data, tokens = _extract_ses_and_race_vertex(text)
        else:
            data, tokens = _extract_ses_and_race_anthropic(text)
        return data, tokens
    except Exception as e:
        print(f"  ✗ Extraction failed after retries: {type(e).__name__}: {e}",
              file=sys.stderr)
        return (
            {"error": "Extraction failed", "exception": f"{type(e).__name__}: {e}"},
            {"input": 0, "output": 0},
        )


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


def process_literature_batch(input_csv, output_csv, metrics_path="lit_token_metrics.json"):
    """Run the literature pilot batch.

    The per-row loop is wrapped in try/except/finally so a hard API failure
    (e.g. Insufficient Credits, auth revocation) still flushes whatever
    documents completed up to that point to `output_csv` and writes
    `metrics_path` using the dynamic `success_count` — no hardcoded denominators.
    """
    df = pd.read_csv(input_csv)
    results = []
    total_input = 0
    total_output = 0
    success_count = 0
    interrupted_by = None

    try:
        for _, row in df.head(10).iterrows():
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
                    total_input += tokens["input"]
                    total_output += tokens["output"]
                    if "error" not in data:
                        success_count += 1
                else:
                    results.append({**base_record, "status": "Failed text read"})
            else:
                results.append({**base_record, "status": "Closed Access"})
    except KeyboardInterrupt:
        interrupted_by = "user (Ctrl+C)"
        print(f"\n✗ Pipeline interrupted by {interrupted_by}.", file=sys.stderr)
    except Exception as e:
        interrupted_by = f"{type(e).__name__}: {e}"
        print(f"\n✗ Pipeline interrupted by {interrupted_by}.", file=sys.stderr)
    finally:
        if interrupted_by:
            print(f"  Saving partial results for {success_count} successful "
                  f"extractions before exit...", file=sys.stderr)
        if results:
            pd.DataFrame(results).to_csv(output_csv, index=False)

        denom = success_count or 1
        metrics = {
            "provider": AI_PROVIDER,
            "model": GEMINI_MODEL if AI_PROVIDER == "vertex_gemini" else ANTHROPIC_MODEL,
            "success_count": success_count,
            "pilot_size": success_count,  # legacy field, mirrors success_count
            "attempted_docs": len(results),
            "total_studies": len(df),
            "avg_input_per_doc": total_input / denom,
            "avg_output_per_doc": total_output / denom,
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "interrupted_by": interrupted_by,
        }
        with open(metrics_path, "w") as f:
            json.dump(metrics, f, indent=2)

    if interrupted_by:
        sys.exit(1)


if __name__ == "__main__":
    process_literature_batch(
        input_csv="data/lit_pilot_input.csv",
        output_csv="data/lit_ses_extracted.csv",
    )
