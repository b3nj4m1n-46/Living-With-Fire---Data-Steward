"""
Scrape Lady Bird Johnson Wildflower Center — Native Plant Database
Collections for Oregon, California, and Washington.

Source: https://www.wildflower.org/
Two-phase scrape:
  Phase 1: Get all plant IDs from collection pages (paginated, 100 per page)
  Phase 2: Get detail page for each plant (rich horticultural data)
"""

import csv
import json
import os
import re
import sqlite3
import sys
import time

import requests
from bs4 import BeautifulSoup

sys.stdout.reconfigure(encoding="utf-8")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(SCRIPT_DIR)
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
DELAY = 1.0  # seconds between requests

STATES = {
    "OR": "Oregon",
    "CA": "California",
    "WA": "Washington",
}


def scrape_collection(state_code):
    """Phase 1: Get all plant USDA IDs from a state collection."""
    plants = []
    start = 0
    pagecount = 100

    while True:
        url = f"https://www.wildflower.org/collections/collection.php?start={start}&collection={state_code}&pagecount={pagecount}"
        resp = requests.get(url, headers=HEADERS, timeout=30)
        soup = BeautifulSoup(resp.text, "html.parser")

        links = soup.find_all("a", href=re.compile(r"result\.php\?id_plant="))
        if not links:
            break

        for link in links:
            href = link.get("href", "")
            m = re.search(r"id_plant=(\w+)", href)
            usda_id = m.group(1) if m else ""
            sci = link.get_text(strip=True)
            if usda_id and sci:
                plants.append({"usda_symbol": usda_id, "scientific_name": sci, "state": state_code})

        print(f"  {state_code} start={start}: got {len(links)} links ({len(plants)} total)")

        if len(links) < pagecount:
            break
        start += pagecount
        time.sleep(DELAY)

    return plants


def scrape_detail(usda_id):
    """Phase 2: Get rich detail data for a single plant."""
    url = f"https://www.wildflower.org/plants/result.php?id_plant={usda_id}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        soup = BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"    ERROR {usda_id}: {e}")
        return {}

    detail = {}

    # Extract from the structured data sections
    # The page has definition lists and tables with plant attributes
    text = soup.get_text(separator="\n")

    # Common patterns to extract
    patterns = {
        "common_name": r"Common Name[:\s]*([^\n]+)",
        "family": r"Family[:\s]*([^\n]+)",
        "usda_symbol": r"USDA Symbol[:\s]*(\w+)",
        "plant_type": r"Plant Type[:\s]*([^\n]+)",
        "duration": r"Duration[:\s]*([^\n]+)",
        "habit": r"Habit[:\s]*([^\n]+)",
        "height": r"Height[:\s]*([^\n]+)",
        "spread": r"Spread[:\s]*([^\n]+)",
        "light": r"Light Requirement[:\s]*([^\n]+)",
        "water": r"Water Use[:\s]*([^\n]+)",
        "soil_moisture": r"Soil Moisture[:\s]*([^\n]+)",
        "soil_description": r"Soil Description[:\s]*([^\n]+)",
        "conditions_comments": r"Conditions Comments[:\s]*([^\n]+)",
        "bloom_time": r"Bloom Time[:\s]*([^\n]+)",
        "bloom_color": r"Bloom Color[:\s]*([^\n]+)",
        "bloom_notes": r"Bloom Notes[:\s]*([^\n]+)",
        "fruit_type": r"Fruit Type[:\s]*([^\n]+)",
        "leaf_retention": r"Leaf Retention[:\s]*([^\n]+)",
        "leaf_color": r"Leaf Color[:\s]*([^\n]+)",
        "propagation": r"Propagation[:\s]*([^\n]+)",
        "native_status": r"Native Status[:\s]*([^\n]+)",
        "distribution": r"(?:USA Distribution|Distribution)[:\s]*([^\n]+)",
        "habitat": r"Native Habitat[:\s]*([^\n]+)",
        "wildlife": r"Wildlife[:\s]*([^\n]+)",
        "pollinator_value": r"(?:Pollinator|Bee) Value[:\s]*([^\n]+)",
    }

    for key, pattern in patterns.items():
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            val = m.group(1).strip()
            if val and val.lower() not in ("none", "n/a", ""):
                detail[key] = val

    # Also try to get data from dt/dd pairs
    for dt in soup.find_all("dt"):
        dd = dt.find_next_sibling("dd")
        if dd:
            key = dt.get_text(strip=True).lower().replace(" ", "_").replace(":", "")
            val = dd.get_text(strip=True)
            if val and key not in detail:
                detail[key] = val

    return detail


def main():
    all_plants = []

    # Phase 1: Collect all plant IDs
    print("=== Phase 1: Collecting plant IDs ===")
    for code, name in STATES.items():
        print(f"\n{name} ({code}):")
        plants = scrape_collection(code)
        all_plants.extend(plants)
        print(f"  Total: {len(plants)}")
        time.sleep(DELAY)

    # Deduplicate by usda_symbol (some plants appear in multiple states)
    seen = {}
    for p in all_plants:
        key = p["usda_symbol"]
        if key not in seen:
            seen[key] = p.copy()
            seen[key]["states"] = [p["state"]]
        else:
            if p["state"] not in seen[key]["states"]:
                seen[key]["states"].append(p["state"])

    unique_plants = list(seen.values())
    print(f"\nTotal plants: {len(all_plants)} ({len(unique_plants)} unique across states)")

    # Phase 2: Get detail pages
    print("\n=== Phase 2: Scraping detail pages ===")
    for i, plant in enumerate(unique_plants):
        usda_id = plant["usda_symbol"]
        detail = scrape_detail(usda_id)
        plant.update(detail)

        if (i + 1) % 25 == 0:
            print(f"  [{i+1}/{len(unique_plants)}] Last: {plant['scientific_name']}")
        time.sleep(DELAY)

    print(f"\nDetail scraping complete. {len(unique_plants)} plants enriched.")

    # Convert states list to comma-separated string
    for p in unique_plants:
        p["states"] = ",".join(p.get("states", []))

    # Determine all fields
    all_fields = set()
    for p in unique_plants:
        all_fields.update(p.keys())
    # Order fields sensibly
    priority_fields = [
        "usda_symbol", "scientific_name", "common_name", "family",
        "states", "habit", "duration", "height", "spread",
        "light", "water", "soil_moisture", "bloom_time", "bloom_color",
        "leaf_retention", "native_status", "distribution", "habitat",
        "wildlife", "pollinator_value", "propagation",
    ]
    other_fields = sorted(all_fields - set(priority_fields))
    fields = [f for f in priority_fields if f in all_fields] + other_fields

    # Write CSV
    csv_path = os.path.join(DATA_DIR, "plants.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for p in unique_plants:
            writer.writerow(p)
    print(f"Wrote {csv_path} ({len(unique_plants)} plants, {len(fields)} fields)")

    # State-specific CSVs
    for code in STATES:
        state_plants = [p for p in unique_plants if code in p.get("states", "")]
        csv_path = os.path.join(DATA_DIR, f"plants_{STATES[code].lower()}.csv")
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            for p in state_plants:
                writer.writerow(p)
        print(f"Wrote {csv_path} ({len(state_plants)} plants)")

    # JSON
    json_path = os.path.join(DATA_DIR, "plants.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "source": "Lady Bird Johnson Wildflower Center — Native Plant Database",
            "url": "https://www.wildflower.org/plants/",
            "states": {code: len([p for p in unique_plants if code in p.get("states", "")])
                       for code in STATES},
            "total_unique": len(unique_plants),
            "fields": fields,
            "plants": unique_plants,
        }, f, indent=2, ensure_ascii=False)
    print(f"Wrote {json_path}")

    # SQLite
    db_path = os.path.join(DATA_DIR, "plants.db")
    if os.path.exists(db_path):
        os.remove(db_path)
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    col_defs = ", ".join(f'"{f}" TEXT' for f in fields)
    cur.execute(f"CREATE TABLE plants ({col_defs})")
    cur.execute('CREATE INDEX idx_usda ON plants(usda_symbol)')
    cur.execute('CREATE INDEX idx_sci ON plants(scientific_name)')
    cur.execute('CREATE INDEX idx_states ON plants(states)')

    placeholders = ", ".join(["?"] * len(fields))
    for p in unique_plants:
        vals = [str(p.get(f, "")) for f in fields]
        cur.execute(f"INSERT INTO plants VALUES ({placeholders})", vals)

    conn.commit()
    conn.close()
    print(f"Wrote {db_path}")

    # Summary
    print(f"\n=== Summary ===")
    for code, name in STATES.items():
        count = len([p for p in unique_plants if code in p.get("states", "")])
        print(f"  {name}: {count}")
    print(f"  Unique total: {len(unique_plants)}")

    # Field coverage
    print(f"\nField coverage:")
    for f in priority_fields:
        if f in all_fields:
            filled = sum(1 for p in unique_plants if p.get(f))
            print(f"  {f:25s} {filled:4d}/{len(unique_plants)} ({filled/len(unique_plants)*100:.0f}%)")


if __name__ == "__main__":
    main()
