
import json
from pathlib import Path

folder = Path("public/data")

source = folder / "nyc-streets.geojson"
output = folder / "redhook-streets.geojson"

# Red Hook map boundaries
MIN_LON = -74.025
MAX_LON = -73.995
MIN_LAT = 40.66
MAX_LAT = 40.69


# Clip a street segment to the map boundary
def clip_segment(a, b):
    x1, y1 = a[:2]
    x2, y2 = b[:2]

    dx = x2 - x1
    dy = y2 - y1

    p = [-dx, dx, -dy, dy]
    q = [
        x1 - MIN_LON,
        MAX_LON - x1,
        y1 - MIN_LAT,
        MAX_LAT - y1,
    ]

    u1 = 0.0
    u2 = 1.0

    for pi, qi in zip(p, q):
        if pi == 0:
            if qi < 0:
                return None
        else:
            t = qi / pi

            if pi < 0:
                u1 = max(u1, t)
            else:
                u2 = min(u2, t)

    if u1 > u2:
        return None

    return [
        [x1 + u1 * dx, y1 + u1 * dy],
        [x1 + u2 * dx, y1 + u2 * dy],
    ]


def clip_line(coordinates):
    segments = []
    current = []

    for a, b in zip(coordinates, coordinates[1:]):
        clipped = clip_segment(a, b)

        if clipped is None:
            if len(current) >= 2:
                segments.append(current)
            current = []
            continue

        start, end = clipped

        if start == end:
            continue

        if current and current[-1] == start:
            current.append(end)
        else:
            if len(current) >= 2:
                segments.append(current)
            current = [start, end]

    if len(current) >= 2:
        segments.append(current)

    return segments


print("Reading NYC street network...")

with open(source, "r", encoding="utf-8") as file:
    data = json.load(file)

features = []

for feature in data["features"]:
    geometry = feature.get("geometry") or {}
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates", [])

    if kind == "LineString":
        lines = [coordinates]

    elif kind == "MultiLineString":
        lines = coordinates

    else:
        continue

    for line in lines:
        for segment in clip_line(line):
            features.append({
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "LineString",
                    "coordinates": segment,
                },
            })

result = {
    "type": "FeatureCollection",
    "features": features,
}

with open(output, "w", encoding="utf-8") as file:
    json.dump(result, file, separators=(",", ":"))

print("Street segments:", len(features))
print("Saved:", output)
print(
    "New file size:",
    round(output.stat().st_size / (1024 * 1024), 2),
    "MB",
)
