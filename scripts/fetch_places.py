#!/usr/bin/env python3
"""Find the Google place ID for every restaurant in data.js and save them in places.js.

    python3 scripts/fetch_places.py            # look up restaurants that have no place ID yet
    python3 scripts/fetch_places.py --refresh  # look every restaurant up again

The key comes from PLACES_API_KEY in the environment, or else from config.js.

Only place IDs are saved. Google's terms let a site store place IDs but nothing else from the
Places API, so photos are fetched by the visitor's browser when a card comes into view (see app.js).
Google suggests refreshing stored place IDs about once a year.
"""
import datetime, json, os, re, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VALLEY_CENTER = {"latitude": 47.51, "longitude": -121.80}  # between North Bend and Snoqualmie
ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
FIELDS = "places.id,places.displayName,places.formattedAddress"  # name and address are only used to check the match
REFRESH = "--refresh" in sys.argv


def read_js_value(path, var):
    src = open(path, encoding="utf-8").read()
    m = re.search(r"window\." + re.escape(var) + r"\s*=\s*(.*?);\s*(?:\n|$)", src, re.S)
    return json.loads(m.group(1)) if m else None


def read_js_string(path, var):
    m = re.search(r'window\.' + re.escape(var) + r'\s*=\s*"([^"]*)"', open(path, encoding="utf-8").read())
    return m.group(1) if m else ""


key = os.environ.get("PLACES_API_KEY") or read_js_string(os.path.join(ROOT, "config.js"), "PLACES_API_KEY")
site_url = read_js_string(os.path.join(ROOT, "config.js"), "SITE_URL") or "https://localhost/"
if not key:
    sys.exit("No API key. Set PLACES_API_KEY in the environment or fill in PLACES_API_KEY in config.js.")

restaurants = read_js_value(os.path.join(ROOT, "data.js"), "RESTAURANTS") or []
try:
    previous = read_js_value(os.path.join(ROOT, "places.js"), "PLACES") or {}
except Exception:
    previous = {}


class QuotaExhausted(Exception):
    pass


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower().replace("&", "and"))


def street_number(s):
    m = re.match(r"\s*(\d+)", s or "")
    return m.group(1) if m else None


def search(query):
    body = {"textQuery": query, "pageSize": 1, "locationBias": {"circle": {"center": VALLEY_CENTER, "radius": 15000.0}}}
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS,
        # A key restricted to this website only accepts requests that say they come from it.
        "Referer": site_url, "User-Agent": "valley-eats fetch_places.py"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            if e.code == 429 and "per day" in detail:
                raise QuotaExhausted(detail)
            if e.code in (429, 500, 503) and attempt < 3:
                time.sleep(2 ** attempt); continue
            if e.code == 403:
                sys.exit(f"Google refused the key (403). Check that Places API (New) is enabled and that the key's "
                         f"website restriction includes {site_url}\n{detail[:400]}")
            raise SystemExit(f"HTTP {e.code} from Places API: {detail[:400]}")
    return {}


out, notes, calls, stopped = {}, [], 0, False
for p in restaurants:
    k = f"{p['name']}|{p['town']}"
    kept = (previous.get(k) or {}).get("placeId")
    if kept and not REFRESH:
        out[k] = {"placeId": kept}; continue
    if stopped:
        if kept: out[k] = {"placeId": kept}
        continue
    try:
        resp = search(f"{p['name']}, {p['address']}"); calls += 1
    except QuotaExhausted:
        stopped = True
        notes.append("Google's daily lookup allowance ran out; the remaining restaurants keep what they had. Run again tomorrow.")
        if kept: out[k] = {"placeId": kept}
        continue
    places = resp.get("places") or []
    if not places:
        notes.append(f"NOT FOUND: {p['name']} ({p['town']})")
        if kept: out[k] = {"placeId": kept}
        continue
    g = places[0]
    gname = (g.get("displayName") or {}).get("text", "")
    gaddr = g.get("formattedAddress", "")
    ours, theirs = street_number(p["address"]), street_number(gaddr)
    wrong_street = bool(ours and theirs and ours != theirs)
    same_name = norm(gname) in norm(p["name"]) or norm(p["name"]) in norm(gname)
    if wrong_street or p["town"].lower() not in gaddr.lower():
        # A different street number or town means Google found some other business. No photo beats a wrong photo.
        notes.append(f"SKIPPED, wrong place: {p['name']} ({p['address'].split(',')[0]}) -> {gname} ({gaddr.split(',')[0]})")
        continue
    if not same_name:
        notes.append(f"Kept, but the name differs: {p['name']} -> {gname} ({gaddr.split(',')[0]})")
    out[k] = {"placeId": g.get("id")}
    time.sleep(0.15)

today = datetime.date.today().isoformat()
with open(os.path.join(ROOT, "places.js"), "w", encoding="utf-8") as f:
    f.write("/* Google place IDs for each restaurant, keyed by \"name|town\". Generated by scripts/fetch_places.py.\n"
            "   To fix a wrong match, replace that entry's placeId (or delete the entry to show no photo). */\n")
    f.write(f'window.PLACES_META = {{ updated: "{today}" }};\n')
    f.write("window.PLACES = " + json.dumps(out, indent=1, ensure_ascii=False) + ";\n")
missing = [f"{p['name']} ({p['town']})" for p in restaurants if f"{p['name']}|{p['town']}" not in out]
print(f"{calls} lookups made; {len(out)} of {len(restaurants)} restaurants have a place ID; written to places.js")
if missing:
    print("No place ID yet:", "; ".join(missing))
for n in notes:
    print(" -", n)
