#!/usr/bin/env python3
"""
Split large demographics.json into 2 compressed parts to stay under GitHub's 100MB limit
"""
import json
import gzip
import sys

def main():
    # Load the full dataset
    print("Loading full dataset...")
    with open('data/demographics.json', 'r') as f:
        full_data = json.load(f)

    total_studies = len(full_data['data'])
    mid_point = total_studies // 2

    print(f"Splitting {total_studies} studies into 2 parts...")

    # Split into two parts
    part1 = {
        'extracted_at': full_data['extracted_at'],
        'part': 1,
        'total_parts': 2,
        'data': full_data['data'][:mid_point]
    }

    part2 = {
        'extracted_at': full_data['extracted_at'],
        'part': 2,
        'total_parts': 2,
        'data': full_data['data'][mid_point:]
    }

    # Compress and save
    print(f"Compressing part 1 ({len(part1['data'])} studies)...")
    with gzip.open('data/demographics.part1.json.gz', 'wt', compresslevel=9) as f:
        json.dump(part1, f, separators=(',', ':'))

    print(f"Compressing part 2 ({len(part2['data'])} studies)...")
    with gzip.open('data/demographics.part2.json.gz', 'wt', compresslevel=9) as f:
        json.dump(part2, f, separators=(',', ':'))

    print(f"✓ Split {total_studies} studies into 2 parts of {mid_point} and {total_studies - mid_point}")

if __name__ == '__main__':
    main()
