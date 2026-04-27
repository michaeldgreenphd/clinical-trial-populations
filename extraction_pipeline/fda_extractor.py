import pandas as pd
import requests
import pdfplumber
import io
import json
import os
import anthropic

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# System prompt drives the chain-of-thought: every value must be backed by a
# verbatim quote in the matching `_evidence` field BEFORE the structured
# value is committed. Race buckets mirror the Civic Trial dashboard.
FDA_SYSTEM_PROMPT = """You are a clinical data extractor for FDA 510(k) and PMA summary documents.

Your job for every field on the `record_fda_demographics` tool is a two-step chain of thought:
  1. First, copy the shortest verbatim sentence(s) from the FDA text that establish the value into the matching `_evidence` field. If no such sentence exists, write "Not Reported".
  2. ONLY AFTER recording the evidence, commit the structured value (integer count, label, etc.).

Race counts must be reported as integers using these mutually exclusive buckets that mirror the Civic Trial dashboard:
  white, black, asian, hispanic, native_american, other, unknown.

If an integer is not reported in the text, set it to -1 (do NOT guess).
If a string is not reported in the text, set it to "Not Reported".
Do not skip the evidence fields — they are required for downstream auditing.
"""

# Anthropic tool schema for FDA extraction. `_evidence` fields are listed
# immediately before each value field so the model is nudged to write evidence
# first when filling the tool input top-to-bottom.
FDA_DEMOGRAPHICS_TOOL = {
    "name": "record_fda_demographics",
    "description": (
        "Record extracted demographic data from an FDA summary statement. "
        "For every value field there is a paired `_evidence` field that "
        "must contain the verbatim quote(s) supporting that value. Fill "
        "the evidence field first, then the value."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "device_name_evidence": {
                "type": "string",
                "description": "Verbatim sentence/phrase from the FDA text that names the device.",
            },
            "device_name": {"type": "string"},
            "panel_evidence": {
                "type": "string",
                "description": "Verbatim sentence/phrase identifying the FDA medical specialty panel.",
            },
            "panel": {"type": "string"},
            "total_participants_evidence": {
                "type": "string",
                "description": "Verbatim sentence stating the total participant count of the validation cohort.",
            },
            "total_participants": {
                "type": "integer",
                "description": "Total participants in the validation cohort. Use -1 if not reported.",
            },
            "sex_evidence": {
                "type": "string",
                "description": "Verbatim sentence(s) reporting the male/female breakdown.",
            },
            "sex": {
                "type": "object",
                "properties": {
                    "male": {"type": "integer", "description": "Male count, or -1 if not reported."},
                    "female": {"type": "integer", "description": "Female count, or -1 if not reported."},
                },
                "required": ["male", "female"],
            },
            "race_evidence": {
                "type": "string",
                "description": "Verbatim sentence(s) reporting the race / ethnicity breakdown.",
            },
            "race": {
                "type": "object",
                "description": (
                    "Race counts using the Civic Trial dashboard buckets. "
                    "Each bucket is an integer; use -1 when the bucket is "
                    "not reported in the text."
                ),
                "properties": {
                    "white": {"type": "integer"},
                    "black": {"type": "integer"},
                    "asian": {"type": "integer"},
                    "hispanic": {"type": "integer"},
                    "native_american": {"type": "integer"},
                    "other": {"type": "integer"},
                    "unknown": {"type": "integer"},
                },
                "required": [
                    "white", "black", "asian",
                    "hispanic", "native_american",
                    "other", "unknown",
                ],
            },
            "age_range_evidence": {
                "type": "string",
                "description": "Verbatim sentence stating the age range or mean/median age.",
            },
            "age_range": {"type": "string"},
        },
        "required": [
            "device_name_evidence", "device_name",
            "panel_evidence", "panel",
            "total_participants_evidence", "total_participants",
            "sex_evidence", "sex",
            "race_evidence", "race",
            "age_range_evidence", "age_range",
        ],
    },
}


def extract_fda_text(submission_number, year_prefix):
    url = f"https://www.accessdata.fda.gov/cdrh_docs/pdf{year_prefix}/{submission_number}.pdf"
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        with pdfplumber.open(io.BytesIO(response.content)) as pdf:
            return "\n".join([page.extract_text() for page in pdf.pages if page.extract_text()]), url
    except Exception as e:
        print(f"Error retrieving {submission_number}: {e}")
        return None, url

def extract_demographics_with_claude(text):
    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            temperature=0,
            system=FDA_SYSTEM_PROMPT,
            tools=[FDA_DEMOGRAPHICS_TOOL],
            tool_choice={"type": "tool", "name": FDA_DEMOGRAPHICS_TOOL["name"]},
            messages=[{"role": "user", "content": text[:100000]}],
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

def process_fda_batch(input_csv, output_csv):
    df = pd.read_csv(input_csv)
    results, total_input, total_output = [], 0, 0

    for index, row in df.head(30).iterrows():
        sub_num, year = row['submission_number'], row['year_prefix']
        text, url = extract_fda_text(sub_num, year)
        if text:
            demographics, tokens = extract_demographics_with_claude(text)
            demographics.update({'submission_number': sub_num, 'source_url': url})
            results.append(demographics)
            total_input += tokens['input']
            total_output += tokens['output']

    pd.DataFrame(results).to_csv(output_csv, index=False)

    metrics = {
        "pilot_size": 30,
        "total_fda_tools": len(df),
        "avg_input_per_doc": total_input / 30,
        "avg_output_per_doc": total_output / 30
    }
    with open('fda_token_metrics.json', 'w') as f:
        json.dump(metrics, f)


if __name__ == "__main__":
    process_fda_batch(
        input_csv="data/fda_pilot_input.csv",
        output_csv="data/fda_demographics_extracted.csv"
    )
