import io
import json
import os
import sys

import anthropic
import pandas as pd
import pdfplumber
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
    Gemini function declarations accept. Gemini forbids union types
    (e.g. `["integer", "string"]`), so we flatten them to `"string"`.
    `properties` and `items` recurse."""
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


def _proto_to_dict(val):
    """Convert Gemini's protobuf MapComposite / RepeatedComposite return
    values into plain Python dicts and lists so the result matches the
    Anthropic `tool_use.input` payload shape exactly."""
    if hasattr(val, "items") and not isinstance(val, (str, bytes)):
        return {k: _proto_to_dict(v) for k, v in val.items()}
    if hasattr(val, "__iter__") and not isinstance(val, (str, bytes)):
        return [_proto_to_dict(v) for v in val]
    return val

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

@retry_api_call
def _extract_demographics_anthropic(text):
    """Anthropic path. Decorated with `retry_api_call` so 429 / 529 / network
    blips are retried up to 3 times with exponential backoff before the
    exception bubbles up to the batch-loop's try/finally."""
    response = client.messages.create(
        model=ANTHROPIC_MODEL,
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
    tokens = {
        "input": response.usage.input_tokens,
        "output": response.usage.output_tokens,
    }
    if tool_block is None:
        return {"error": "Model returned no tool_use block"}, tokens
    return tool_block.input, tokens


@retry_api_call
def _extract_demographics_vertex(text):
    """Vertex AI / Gemini path. Translates `FDA_DEMOGRAPHICS_TOOL` into a
    `FunctionDeclaration`, forces tool use via `ToolConfig.Mode.ANY`, and
    passes the FDA system prompt via `system_instruction` so the user
    message is just the raw PDF text (matching the Anthropic call shape).
    Returns the same dict shape as the Anthropic branch.
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
            name=FDA_DEMOGRAPHICS_TOOL["name"],
            description=FDA_DEMOGRAPHICS_TOOL["description"],
            parameters=_to_gemini_schema(FDA_DEMOGRAPHICS_TOOL["input_schema"]),
        )
    ])
    tool_config = ToolConfig(
        function_calling_config=ToolConfig.FunctionCallingConfig(
            mode=ToolConfig.FunctionCallingConfig.Mode.ANY,
            allowed_function_names=[FDA_DEMOGRAPHICS_TOOL["name"]],
        )
    )
    model = GenerativeModel(
        model_name=GEMINI_MODEL,
        tools=[gemini_tool],
        tool_config=tool_config,
        system_instruction=FDA_SYSTEM_PROMPT,
    )
    response = model.generate_content(
        text[:100000],
        generation_config={"max_output_tokens": 4096, "temperature": 0},
    )

    data = {"error": "Model returned no function_call"}
    for cand in response.candidates:
        for part in cand.content.parts:
            fc = getattr(part, "function_call", None)
            if fc and getattr(fc, "name", "") == FDA_DEMOGRAPHICS_TOOL["name"]:
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


def extract_demographics_with_claude(text):
    """Provider-agnostic facade. Routes to Anthropic or Vertex Gemini based
    on the AI_PROVIDER env var. Both branches return identical dict shapes
    so downstream `process_fda_batch` doesn't need to branch."""
    try:
        if AI_PROVIDER == "vertex_gemini":
            data, tokens = _extract_demographics_vertex(text)
        else:
            data, tokens = _extract_demographics_anthropic(text)
        return data, tokens
    except Exception as e:
        print(f"  ✗ Extraction failed after retries: {type(e).__name__}: {e}",
              file=sys.stderr)
        return (
            {"error": "Extraction failed", "exception": f"{type(e).__name__}: {e}"},
            {"input": 0, "output": 0},
        )


def process_fda_batch(input_csv, output_csv, metrics_path="fda_token_metrics.json"):
    """Run the FDA pilot batch.

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
        for _, row in df.head(30).iterrows():
            sub_num, year = row["submission_number"], row["year_prefix"]
            text, url = extract_fda_text(sub_num, year)
            if not text:
                continue
            demographics, tokens = extract_demographics_with_claude(text)
            demographics.update({"submission_number": sub_num, "source_url": url})
            results.append(demographics)
            total_input += tokens["input"]
            total_output += tokens["output"]
            if "error" not in demographics:
                success_count += 1
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
            "total_fda_tools": len(df),
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
    process_fda_batch(
        input_csv="data/fda_pilot_input.csv",
        output_csv="data/fda_demographics_extracted.csv",
    )
