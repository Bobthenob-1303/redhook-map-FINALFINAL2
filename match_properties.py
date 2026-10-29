
import csv
import json
import re
from pathlib import Path
from datetime import datetime

folder = Path("public/data")

lots_file = folder / "nyc-property-lots.csv"
sales_file = folder / "nyc-property-sales.csv"
output_file = folder / "redhook-priced-properties.json"

EXTRA_PROPERTIES = 300

# Approximate Red Hook boundary
MIN_LON, MAX_LON = -74.025, -73.995
MIN_LAT, MAX_LAT = 40.66, 40.69


def clean_row(row):
    return {
        re.sub(r"[^a-z0-9]", "", str(key).lower()): value
        for key, value in row.items()
        if key is not None
    }


def clean_bbl(value):
    try:
        return str(int(float(value))).zfill(10)
    except (ValueError, TypeError):
        return None


def make_bbl(borough, block, lot):
    try:
        return (
            str(int(float(borough)))
            + str(int(float(block))).zfill(5)
            + str(int(float(lot))).zfill(4)
        )
    except (ValueError, TypeError):
        return None


def parse_date(value):
    value = str(value or "").strip()

    for fmt in (
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%Y-%m-%dT%H:%M:%S",
    ):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass

    return None


# STEP 1: FIND ALL RESIDENTIAL LOTS
properties = {}

with open(lots_file, newline="", encoding="utf-8-sig") as file:
    reader = csv.DictReader(file)

    for original in reader:
        row = clean_row(original)

        try:
            lat = float(row.get("latitude") or "")
            lon = float(row.get("longitude") or "")
        except ValueError:
            continue

        if not (
            MIN_LAT <= lat <= MAX_LAT
            and MIN_LON <= lon <= MAX_LON
        ):
            continue

        landuse = str(row.get("landuse") or "").strip().zfill(2)

        if landuse not in ("01", "02", "03", "04"):
            continue

        bbl = clean_bbl(row.get("bbl"))

        if not bbl:
            bbl = make_bbl(
                row.get("borocode"),
                row.get("block"),
                row.get("lot"),
            )

        if not bbl:
            continue

        properties[bbl] = {
            "bbl": bbl,
            "address": row.get("address", ""),
            "longitude": lon,
            "latitude": lat,
            "landUse": landuse,
        }

print("Residential lots found:", len(properties))


# STEP 2: MATCH RECORDED SALES
matched = {}

with open(sales_file, newline="", encoding="utf-8-sig") as file:
    reader = csv.DictReader(file)

    for original in reader:
        row = clean_row(original)

        bbl = make_bbl(
            row.get("borough"),
            row.get("block"),
            row.get("lot"),
        )

        if bbl not in properties:
            continue

        try:
            price = float(
                str(row.get("saleprice") or "0")
                .replace(",", "")
                .replace("$", "")
            )
        except ValueError:
            continue

        if price <= 1000:
            continue

        date = parse_date(row.get("saledate"))

        if date is None:
            continue

        if bbl not in matched or date > matched[bbl]["date"]:
            matched[bbl] = {
                "date": date,
                "property": {
                    **properties[bbl],
                    "salePrice": price,
                    "saleDate": date.strftime("%Y-%m-%d"),
                    "hasSale": True,
                },
            }


# STEP 3: FIND ADDITIONAL RESIDENTIAL LOTS
unmatched = [
    property
    for bbl, property in properties.items()
    if bbl not in matched
]

# Distribute the additional properties across Red Hook
unmatched.sort(
    key=lambda p: (
        round(p["longitude"], 3),
        p["latitude"],
        p["bbl"],
    )
)

extras = []

if unmatched:
    count = min(EXTRA_PROPERTIES, len(unmatched))

    for i in range(count):
        index = int((i + 0.5) * len(unmatched) / count)

        property = unmatched[index]

        extras.append({
            **property,
            "salePrice": None,
            "saleDate": None,
            "hasSale": False,
        })


# STEP 4: COMBINE EVERYTHING
priced = [
    item["property"]
    for item in matched.values()
]

result = priced + extras

with open(output_file, "w", encoding="utf-8") as file:
    json.dump(result, file, indent=2)


print("Matched sales:", len(priced))
print("Additional residential properties:", len(extras))
print("Total properties:", len(result))
print("Saved:", output_file)
