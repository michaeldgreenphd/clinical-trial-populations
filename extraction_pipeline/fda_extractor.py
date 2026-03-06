import pandas as pd
import requests
import pdfplumber
import io
import json
import os
import anthropic

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

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
    prompt = """
    You are a clinical data extractor. Read the provided FDA summary text.
    Extract the device name, the FDA medical specialty panel, and the demographic breakdown of the clinical validation cohort.
    If a metric is missing, output 'Not Reported'.
    Return ONLY a valid JSON object matching this schema exactly:
    {"device_name": str, "panel": str, "total_participants": int or "Not Reported", "sex": {"male": int, "female": int}, "race": {"white": int, "black": int, "asian": int, "other": int}, "age_range": str}
    """
    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            temperature=0,
            messages=[{"role": "user", "content": f"{prompt}\n\nFDA Text:\n{text[:100000]}"}]
        )
        data = json.loads(response.content[0].text)
        tokens = {"input": response.usage.input_tokens, "output": response.usage.output_tokens}
        return data, tokens
    except Exception as e:
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
