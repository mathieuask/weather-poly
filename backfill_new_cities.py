#!/usr/bin/env python3
"""
Backfill Polymarket events and price history for ALL 35 cities.

Fetches open temperature events from Gamma API, matches them to cities in our
Supabase `cities` table, and outputs JSON files with events, markets, and
price history ready for bulk SQL insert.
"""

import json
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

# ── Config ──────────────────────────────────────────────────

SUPABASE_URL = "https://bpccdqgvkbfboqylzaie.supabase.co"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwY2NkcWd2a2JmYm9xeWx6YWllIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzQ4MDksImV4cCI6MjA4OTYxMDgwOX0."
    "0ZABT5pnbxsDxBFA4RR-QEPkocJpjrtPoInG1hzDI2Q"
)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def _log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"[{ts}] {msg}", flush=True)


def _get_json(url, headers=None):
    hdrs = headers or {}
    if "User-Agent" not in hdrs:
        hdrs["User-Agent"] = UA
    req = urllib.request.Request(url, headers=hdrs)
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())


# ── Step 1: Load cities from Supabase ──────────────────────

def load_cities():
    """Fetch all cities from Supabase REST API (anon SELECT is allowed)."""
    url = (
        f"{SUPABASE_URL}/rest/v1/cities"
        f"?select=name,slug,station,unit&order=name&limit=100"
    )
    headers = {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
    }
    cities = _get_json(url, headers)
    _log(f"Loaded {len(cities)} cities from Supabase")
    return cities


# ── Step 2: Load existing event IDs ───────────────────────

def load_existing_event_ids():
    """Fetch all existing event IDs to skip duplicates."""
    url = (
        f"{SUPABASE_URL}/rest/v1/poly_events"
        f"?select=event_id&limit=1000"
    )
    headers = {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
    }
    rows = _get_json(url, headers)
    ids = {r["event_id"] for r in rows}
    _log(f"Found {len(ids)} existing events in DB")
    return ids


# ── Step 3: Fetch Gamma events ─────────────────────────────

def fetch_gamma_events():
    """Fetch all open temperature events from Gamma API."""
    url = "https://gamma-api.polymarket.com/events?tag_slug=temperature&limit=200&closed=false"
    events = _get_json(url)
    _log(f"Fetched {len(events)} open temperature events from Gamma")
    return events


# ── Step 4: Match events to cities ─────────────────────────

def match_city(title_lower, cities):
    """
    Match event title to a city. Uses the 'in <city> on' pattern first,
    then falls back to checking if the slug appears in the title.
    Returns the matched city dict or None.
    """
    # Try regex extraction first: "in <city> on"
    city_match = re.search(r"in\s+(.+?)\s+on\s+", title_lower)
    if city_match:
        extracted = city_match.group(1).strip()
        for c in cities:
            if c["slug"] == extracted:
                return c
        # Also try partial: "new york" in "new york city"
        for c in cities:
            if c["slug"] in extracted or extracted in c["slug"]:
                return c

    # Fallback: slug appears anywhere in title
    for c in cities:
        if c["slug"] in title_lower:
            return c

    return None


def parse_date(title):
    """Extract target date from event title."""
    date_match = re.search(
        r"on\s+(\w+)\s+(\d+)(?:,?\s*(\d{4}))?", title
    )
    if not date_match:
        return None
    month = MONTHS.get(date_match.group(1).lower())
    if not month:
        return None
    day = int(date_match.group(2))
    year = int(date_match.group(3)) if date_match.group(3) else datetime.now(timezone.utc).year
    return f"{year}-{month:02d}-{day:02d}"


def parse_unit_from_markets(markets):
    """Detect unit from market questions (most reliable: look for °F or °C)."""
    for m in markets:
        q = (m.get("question") or m.get("groupItemTitle") or "")
        if "°F" in q:
            return "F"
        if "°C" in q:
            return "C"
    return "C"  # default


def parse_bracket(question):
    """Parse bracket from market question. Returns (bracket_temp, bracket_op)."""
    q = question.lower()

    if re.search(r"or\s+below", q):
        match = re.search(r"(-?\d+)\s*°", q)
        if match:
            return int(match.group(1)), "lte"
    elif re.search(r"or\s+(?:higher|above)", q):
        match = re.search(r"(-?\d+)\s*°", q)
        if match:
            return int(match.group(1)), "gte"
    elif re.search(r"between", q):
        match = re.search(r"between\s+(-?\d+)\s*[-\u2013]\s*(-?\d+)", q)
        if match:
            return int(match.group(1)), "between"
    else:
        match = re.search(r"be\s+(-?\d+)\s*°", q)
        if match:
            return int(match.group(1)), "exact"

    return None, "exact"


# ── Step 5: Fetch CLOB price history ───────────────────────

def fetch_clob_history(token, target_date):
    """Fetch price history for a YES token from CLOB API."""
    try:
        dt = datetime.strptime(target_date, "%Y-%m-%d")
    except ValueError:
        return []

    # Start 7 days before event date
    start_ts = int((dt - timedelta(days=7)).timestamp())
    end_ts = int(datetime.now(timezone.utc).timestamp())

    url = (
        f"https://clob.polymarket.com/prices-history"
        f"?market={token}&startTs={start_ts}&endTs={end_ts}&fidelity=5"
    )
    try:
        data = _get_json(url)
        return data.get("history", [])
    except Exception as e:
        _log(f"  CLOB error for {token[:20]}...: {e}")
        return []


# ── Main ────────────────────────────────────────────────────

def main():
    cities = load_cities()
    existing_ids = load_existing_event_ids()
    gamma_events = fetch_gamma_events()

    new_events = []
    new_markets = []
    new_prices = []
    skipped_existing = 0
    skipped_no_city = 0
    skipped_no_date = 0

    for event in gamma_events:
        event_id = str(event.get("id"))
        title = event.get("title") or ""
        title_lower = title.lower()

        # Skip existing
        if event_id in existing_ids:
            skipped_existing += 1
            continue

        # Match city
        city = match_city(title_lower, cities)
        if not city:
            skipped_no_city += 1
            _log(f"  No city match: {title}")
            continue

        # Parse date
        target_date = parse_date(title)
        if not target_date:
            skipped_no_date += 1
            _log(f"  No date parsed: {title}")
            continue

        markets = event.get("markets", [])

        # Detect unit from market questions (°C or °F in the question text)
        unit = parse_unit_from_markets(markets)

        event_row = {
            "event_id": event_id,
            "slug": event.get("slug"),
            "title": title,
            "city": city["name"],
            "station": city["station"],
            "target_date": target_date,
            "created_at": event.get("creationDate") or event.get("startDate"),
            "closed": False,
            "unit": unit,
            "n_brackets": len(markets),
            "total_volume": sum(float(m.get("volume") or 0) for m in markets),
        }
        new_events.append(event_row)

        _log(f"  + {city['name']} {target_date} ({len(markets)} brackets) [event {event_id}]")

        for m in markets:
            question = m.get("question") or m.get("groupItemTitle") or ""
            clob_ids = json.loads(m.get("clobTokenIds", "[]") or "[]")
            bracket_temp, bracket_op = parse_bracket(question)

            market_row = {
                "station": city["station"],
                "date": target_date,
                "condition_id": m.get("conditionId"),
                "bracket_str": question,
                "bracket_temp": bracket_temp,
                "bracket_op": bracket_op,
                "unit": unit,
                "winner": None,
                "resolved": False,
                "volume": float(m.get("volume") or 0),
                "clob_token_yes": clob_ids[0] if clob_ids else None,
                "clob_token_no": clob_ids[1] if len(clob_ids) > 1 else None,
                "poly_event_id": event_id,
                "event_title": title,
            }
            new_markets.append(market_row)

            # Fetch price history for YES token
            token = clob_ids[0] if clob_ids else None
            if token:
                history = fetch_clob_history(token, target_date)
                for p in history:
                    new_prices.append({
                        "condition_id": m.get("conditionId"),
                        "station": city["station"],
                        "target_date": target_date,
                        "ts": p["t"],
                        "price_yes": round(float(p["p"]), 4),
                    })
                if history:
                    _log(f"    {bracket_op} {bracket_temp}: {len(history)} price points")
                time.sleep(0.1)

    # Summary
    _log("=" * 60)
    _log(f"SUMMARY:")
    _log(f"  New events:  {len(new_events)}")
    _log(f"  New markets: {len(new_markets)}")
    _log(f"  Price points: {len(new_prices)}")
    _log(f"  Skipped (existing): {skipped_existing}")
    _log(f"  Skipped (no city):  {skipped_no_city}")
    _log(f"  Skipped (no date):  {skipped_no_date}")

    # Save JSON files
    with open("/tmp/backfill_events.json", "w") as f:
        json.dump(new_events, f, indent=2, default=str)
    _log(f"Saved /tmp/backfill_events.json ({len(new_events)} events)")

    with open("/tmp/backfill_markets.json", "w") as f:
        json.dump(new_markets, f, indent=2, default=str)
    _log(f"Saved /tmp/backfill_markets.json ({len(new_markets)} markets)")

    with open("/tmp/backfill_prices.json", "w") as f:
        json.dump(new_prices, f, indent=2, default=str)
    _log(f"Saved /tmp/backfill_prices.json ({len(new_prices)} prices)")

    # Generate SQL for bulk insert
    generate_sql(new_events, new_markets, new_prices)


def _sql_val(v):
    """Format a Python value for SQL."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    # Escape single quotes
    s = str(v).replace("'", "''")
    return f"'{s}'"


def generate_sql(events, markets, prices):
    """Generate SQL INSERT statements and save to /tmp/backfill.sql."""
    lines = []
    lines.append("-- Backfill events")

    if events:
        lines.append(
            "INSERT INTO poly_events "
            "(event_id, slug, title, city, station, target_date, created_at, closed, unit, n_brackets, total_volume) "
            "VALUES"
        )
        vals = []
        for e in events:
            vals.append(
                f"({_sql_val(e['event_id'])}, {_sql_val(e['slug'])}, {_sql_val(e['title'])}, "
                f"{_sql_val(e['city'])}, {_sql_val(e['station'])}, {_sql_val(e['target_date'])}, "
                f"{_sql_val(e['created_at'])}, {_sql_val(e['closed'])}, {_sql_val(e['unit'])}, "
                f"{_sql_val(e['n_brackets'])}, {_sql_val(e['total_volume'])})"
            )
        lines.append(",\n".join(vals))
        lines.append("ON CONFLICT (event_id) DO NOTHING;\n")

    if markets:
        lines.append("-- Backfill markets")
        lines.append(
            "INSERT INTO poly_markets "
            "(station, date, condition_id, bracket_str, bracket_temp, bracket_op, "
            "unit, winner, resolved, volume, clob_token_yes, clob_token_no, poly_event_id, event_title) "
            "VALUES"
        )
        vals = []
        for m in markets:
            vals.append(
                f"({_sql_val(m['station'])}, {_sql_val(m['date'])}, {_sql_val(m['condition_id'])}, "
                f"{_sql_val(m['bracket_str'])}, {_sql_val(m['bracket_temp'])}, {_sql_val(m['bracket_op'])}, "
                f"{_sql_val(m['unit'])}, {_sql_val(m['winner'])}, {_sql_val(m['resolved'])}, "
                f"{_sql_val(m['volume'])}, {_sql_val(m['clob_token_yes'])}, {_sql_val(m['clob_token_no'])}, "
                f"{_sql_val(m['poly_event_id'])}, {_sql_val(m['event_title'])})"
            )
        lines.append(",\n".join(vals))
        lines.append("ON CONFLICT (condition_id) DO NOTHING;\n")

    if prices:
        lines.append("-- Backfill price history (batched)")
        batch_size = 500
        for i in range(0, len(prices), batch_size):
            batch = prices[i:i + batch_size]
            lines.append(
                "INSERT INTO price_history "
                "(condition_id, station, target_date, ts, price_yes) VALUES"
            )
            vals = []
            for p in batch:
                vals.append(
                    f"({_sql_val(p['condition_id'])}, {_sql_val(p['station'])}, "
                    f"{_sql_val(p['target_date'])}, {_sql_val(p['ts'])}, {_sql_val(p['price_yes'])})"
                )
            lines.append(",\n".join(vals))
            lines.append("ON CONFLICT (condition_id, ts) DO NOTHING;\n")

    sql = "\n".join(lines)
    with open("/tmp/backfill.sql", "w") as f:
        f.write(sql)
    _log(f"Saved /tmp/backfill.sql ({len(sql)} chars)")


if __name__ == "__main__":
    main()
