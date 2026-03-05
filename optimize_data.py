#!/usr/bin/env python3
"""
Split demographics data into lean core files (for dashboard) and detail files
(lazy-loaded when viewing individual studies).

Core files: All fields needed for charts, filters, table, and geography tab.
Detail files: Heavy fields only used in the study detail modal.

study_sites is kept in core but slimmed to only country/state/city
(the geography tab needs these). Full site records go to detail files.
"""

import gzip
import json
import os

# Fields moved entirely to detail files (only used in detail modal)
DETAIL_ONLY_FIELDS = {
    'secondary_outcomes',
    'primary_outcome_description',
    'intervention_model_description',
}

# Fields not used anywhere in app.js
UNUSED_FIELDS = {
    'keywords',
    'time_perspective',
    'masking_description',
    'raceBreakdown',
    'ethnicityBreakdown',
    'sexBreakdown',
}

FIELDS_TO_REMOVE = DETAIL_ONLY_FIELDS | UNUSED_FIELDS

# study_sites keys to keep in core (geography tab needs country/state/city)
SITE_CORE_KEYS = {'country', 'state', 'city'}

DATA_DIR = 'data'


def slim_sites(sites):
    """Keep only geography-relevant keys from study_sites for core data."""
    if not sites:
        return sites
    if isinstance(sites, str):
        sites = json.loads(sites)
    return [{k: v for k, v in site.items() if k in SITE_CORE_KEYS}
            for site in sites]


def process_part(part_num):
    input_path = os.path.join(DATA_DIR, f'demographics.part{part_num}.json.gz')
    core_path = os.path.join(DATA_DIR, f'demographics.part{part_num}.json.gz')
    detail_path = os.path.join(DATA_DIR, f'details.part{part_num}.json.gz')

    print(f'Reading {input_path}...')
    with gzip.open(input_path, 'rb') as f:
        raw = json.load(f)

    original_size = os.path.getsize(input_path)
    studies = raw['data']
    print(f'  {len(studies)} studies, {original_size / 1024 / 1024:.1f} MB compressed')

    core_studies = []
    detail_records = {}

    for study in studies:
        nct_id = study['nct_id']

        # Extract detail-only fields + full study_sites
        detail = {}
        for field in DETAIL_ONLY_FIELDS:
            if field in study:
                detail[field] = study[field]
        # Store full study_sites in detail (for facility, zip, geo_identification_method)
        if 'study_sites' in study:
            detail['study_sites'] = study['study_sites']
            detail['geo_identification_method'] = study.get('geo_identification_method', '')
        detail_records[nct_id] = detail

        # Build core study: remove unused/detail fields, slim study_sites
        core_study = {k: v for k, v in study.items()
                      if k not in FIELDS_TO_REMOVE and k != 'study_sites' and k != 'geo_identification_method'}
        if 'study_sites' in study:
            core_study['study_sites'] = slim_sites(study['study_sites'])
        core_studies.append(core_study)

    # Write core file
    core_data = {
        'extracted_at': raw['extracted_at'],
        'part': raw['part'],
        'total_parts': raw['total_parts'],
        'data': core_studies,
    }

    print(f'  Writing core file: {core_path}')
    with gzip.open(core_path, 'wt', compresslevel=6) as f:
        json.dump(core_data, f, separators=(',', ':'))
    core_size = os.path.getsize(core_path)
    print(f'  Core: {core_size / 1024 / 1024:.1f} MB (was {original_size / 1024 / 1024:.1f} MB)')

    # Write detail file
    detail_data = {
        'part': raw['part'],
        'data': detail_records,
    }

    print(f'  Writing detail file: {detail_path}')
    with gzip.open(detail_path, 'wt', compresslevel=6) as f:
        json.dump(detail_data, f, separators=(',', ':'))
    detail_size = os.path.getsize(detail_path)
    print(f'  Detail: {detail_size / 1024 / 1024:.1f} MB')

    savings = original_size - core_size
    print(f'  Savings: {savings / 1024 / 1024:.1f} MB ({savings / original_size * 100:.0f}%)')

    return original_size, core_size, detail_size


def main():
    total_orig = 0
    total_core = 0
    total_detail = 0

    for part in [1, 2]:
        orig, core, detail = process_part(part)
        total_orig += orig
        total_core += core
        total_detail += detail

    print(f'\nTotal original: {total_orig / 1024 / 1024:.1f} MB')
    print(f'Total core (initial load): {total_core / 1024 / 1024:.1f} MB')
    print(f'Total detail (lazy): {total_detail / 1024 / 1024:.1f} MB')
    print(f'Initial load reduction: {(total_orig - total_core) / total_orig * 100:.0f}%')


if __name__ == '__main__':
    main()
