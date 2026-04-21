"""Map Anthropic API model IDs to their Vertex AI equivalents.

Vertex AI Claude models use an `@<version>` separator instead of the trailing
`-<date>` suffix the direct Anthropic API uses. Claude 3.5 Sonnet's second
release additionally carries a `-v2` infix on Vertex. Models whose canonical
ID already matches the `-YYYYMMDD` pattern are converted by moving the date
after `@`; unknown inputs pass through unchanged so Vertex returns its own
error message rather than us silently targeting the wrong model.
"""
import re

# Explicit overrides for cases where a simple date-suffix transformation
# doesn't produce the right Vertex ID. The `-v2` infix on Claude 3.5 Sonnet
# is the canonical example — both the dated alias and `-latest` resolve to
# the same Vertex model name.
_EXPLICIT_VERTEX_MAP = {
    "claude-3-5-sonnet-20241022": "claude-3-5-sonnet-v2@20241022",
    "claude-3-5-sonnet-latest":   "claude-3-5-sonnet-v2@20241022",
    "claude-3-5-sonnet-20240620": "claude-3-5-sonnet@20240620",
}

# Generic date-suffix matcher: trailing `-YYYYMMDD` → `@YYYYMMDD`.
# Matches e.g. `claude-haiku-4-5-20251001` → `claude-haiku-4-5@20251001`.
_DATE_SUFFIX = re.compile(r"^(?P<base>.+)-(?P<date>\d{8})$")


def to_vertex_model(model_id: str) -> str:
    """Return the Vertex AI model ID corresponding to an Anthropic API model ID.

    Unknown inputs are returned unchanged so that a typo or a newly-released
    model that isn't in the override table surfaces as a clear Vertex error
    rather than being silently rewritten into something wrong.
    """
    if not model_id:
        return model_id
    if model_id in _EXPLICIT_VERTEX_MAP:
        return _EXPLICIT_VERTEX_MAP[model_id]
    m = _DATE_SUFFIX.match(model_id)
    if m:
        return f"{m['base']}@{m['date']}"
    return model_id
