"""Append-only CSV logger for per-call Claude API token usage and cost.

Extraction pipelines call log_api_cost() after every successful
messages.create() so we can compare spend between the direct Anthropic API
and Anthropic-on-Vertex during the Vertex pilot. Rows land in
data/token_costs.csv; the file is created with a header row on first write.
"""
import csv
import os
from datetime import datetime

COST_CSV = os.path.join("data", "token_costs.csv")
HEADERS = [
    "Date",
    "Provider",
    "Pipeline",
    "Model",
    "Input Tokens",
    "Output Tokens",
    "Total Cost ($)",
]

# Per-million-token pricing keyed by model family. Sonnet is the default
# fallback when the model string doesn't match a known family — this matches
# the $3 / $15 rates the pilot spec calls out for Sonnet.
_PRICING = {
    "haiku":  (1.00,   5.00),
    "sonnet": (3.00,  15.00),
    "opus":  (15.00,  75.00),
}


def _rates_for(model: str) -> tuple[float, float]:
    key = (model or "").lower()
    for family, rates in _PRICING.items():
        if family in key:
            return rates
    return _PRICING["sonnet"]


def log_api_cost(provider, pipeline_name, input_tokens, output_tokens, model="claude-3-5-sonnet"):
    """Calculate token cost and append one row to data/token_costs.csv.

    Cost is (input/1M)*in_rate + (output/1M)*out_rate. Rates are looked up by
    model family (haiku/sonnet/opus); unknown models fall back to Sonnet
    pricing ($3 input / $15 output per million tokens).

    Returns the dollar cost so callers can aggregate in-process if they want.
    """
    in_rate, out_rate = _rates_for(model)
    total_cost = (input_tokens / 1_000_000.0) * in_rate + (output_tokens / 1_000_000.0) * out_rate

    os.makedirs(os.path.dirname(COST_CSV) or ".", exist_ok=True)
    new_file = not os.path.exists(COST_CSV)
    with open(COST_CSV, "a", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        if new_file:
            writer.writerow(HEADERS)
        writer.writerow([
            datetime.now().isoformat(timespec="seconds"),
            provider,
            pipeline_name,
            model,
            input_tokens,
            output_tokens,
            f"{total_cost:.6f}",
        ])
    return total_cost
