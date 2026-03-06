import pandas as pd
import requests
import json
import os
import anthropic

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
UNPAYWALL_EMAIL = "michaeldgreen0520@gmail.com"

def get_open_access_pdf_url(doi):
    url = f"https://api.unpaywall.org/v2/{doi}?email={UNPAYWALL_EMAIL}"
    try:
        data = requests.get(url, timeout=10).json()
        if data.get('is_oa') and data.get('best_oa_location'):
            return data['best_oa_location'].get('url_for_pdf')
    except Exception:
        pass
    return None

def extract_pdf_text_from_url(pdf_url):
    import pdfplumber
    import io
    try:
        response = requests.get(pdf_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
        with pdfplumber.open(io.BytesIO(response.content)) as pdf:
            return "\n".join([page.extract_text() for page in pdf.pages if page.extract_text()])
    except Exception:
        return None

def extract_ses_and_race_with_claude(text, doi):
    prompt = """
    You are a population health researcher. Extract the validation cohort demographics, explicitly looking for Socioeconomic Status (SES) indicators.
    Return ONLY a valid JSON object matching this schema exactly:
    {"income_reported": bool, "education_reported": bool, "insurance_status_reported": bool, "ses_notes": "Summary or 'None'", "detailed_race_breakdown": "Summary or 'None'"}
    """
    try:
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=800, temperature=0,
            messages=[{"role": "user", "content": f"{prompt}\n\nManuscript Text:\n{text[:150000]}"}]
        )
        data = json.loads(response.content[0].text)
        tokens = {"input": response.usage.input_tokens, "output": response.usage.output_tokens}
        return data, tokens
    except Exception:
        return {"error": "Extraction failed"}, {"input": 0, "output": 0}

def process_literature_batch(input_csv, output_csv):
    df = pd.read_csv(input_csv)
    results, total_input, total_output, success_count = [], 0, 0, 0

    for index, row in df.head(30).iterrows():
        doi = row['doi']
        pdf_url = get_open_access_pdf_url(doi)
        if pdf_url:
            text = extract_pdf_text_from_url(pdf_url)
            if text:
                data, tokens = extract_ses_and_race_with_claude(text, doi)
                data.update({'doi': doi, 'oa_pdf_url': pdf_url, 'status': 'Extracted'})
                results.append(data)
                total_input += tokens['input']
                total_output += tokens['output']
                success_count += 1
            else:
                results.append({'doi': doi, 'status': 'Failed text read'})
        else:
            results.append({'doi': doi, 'status': 'Closed Access'})

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
