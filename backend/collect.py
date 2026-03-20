"""
collect.py — Collecte historique complète
------------------------------------------
1. Récupère TOUS les marchés Polymarket température résolus (4500+ events)
2. Pour chaque marché : fetch WU temp réelle + GFS J-1/J-2/J-3
3. Stocke dans backtest.db (SQLite)

Usage :
    python3 collect.py              # collecte complète
    python3 collect.py --days 7     # derniers 7 jours seulement
    python3 collect.py --check      # vérifie l'état de la DB
"""

import sqlite3
import requests
import json
import re
import time
import sys
import os
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from wunderground import get_daily_max

DB_PATH  = os.path.join(os.path.dirname(__file__), "backtest.db")
GAMMA    = "https://gamma-api.polymarket.com"
OM_PREV  = "https://previous-runs-api.open-meteo.com/v1/forecast"
TIMEOUT  = 12

# Mapping station → (lat, lon, tz, country, city_name)
STATIONS = {
    "RKSI": (37.469, 126.451, "Asia/Seoul",               "KR", "Seoul"),
    "RJTT": (35.553, 139.781, "Asia/Tokyo",               "JP", "Tokyo"),
    "LFPG": (49.010,   2.548, "Europe/Paris",             "FR", "Paris"),
    "EGLC": (51.505,   0.053, "Europe/London",            "GB", "London"),
    "KLGA": (40.777, -73.873, "America/New_York",         "US", "NYC"),
    "KORD": (41.979, -87.905, "America/Chicago",          "US", "Chicago"),
    "CYYZ": (43.678, -79.625, "America/Toronto",          "CA", "Toronto"),
    "LEMD": (40.472,  -3.563, "Europe/Madrid",            "ES", "Madrid"),
    "WSSS": ( 1.350, 103.994, "Asia/Singapore",           "SG", "Singapore"),
    "KMIA": (25.796, -80.287, "America/New_York",         "US", "Miami"),
    "SAEZ": (-34.822,-58.536, "America/Argentina/Buenos_Aires","AR","Buenos Aires"),
    "RCTP": (25.078, 121.233, "Asia/Taipei",              "TW", "Taipei"),
    # Nouvelles villes détectées
    "LLBG": (32.011,  34.886, "Asia/Jerusalem",           "IL", "Tel Aviv"),
    "NZWN": (-41.327, 174.805,"Pacific/Auckland",         "NZ", "Wellington"),
    "KSEA": (47.449,-122.309, "America/Los_Angeles",      "US", "Seattle"),
    "KDAL": (32.847, -96.852, "America/Chicago",          "US", "Dallas"),
    "KATL": (33.636, -84.428, "America/New_York",         "US", "Atlanta"),
    "LIMC": (45.630,   8.723, "Europe/Rome",              "IT", "Milan"),
    "LTAC": (40.128,  32.995, "Europe/Istanbul",          "TR", "Ankara"),
    "NZAA": (-37.008, 174.791,"Pacific/Auckland",         "NZ", "Auckland"),
    "ZSPD": (31.143, 121.805, "Asia/Shanghai",            "CN", "Shanghai"),
    # Nouvelles villes (Passe 5)
    "SBGR": (-23.432, -46.470,"America/Sao_Paulo",        "BR", "Sao Paulo"),
    "EDDM": (48.354,  11.786, "Europe/Berlin",            "DE", "Munich"),
    "VILK": (26.761,  80.889, "Asia/Kolkata",             "IN", "Lucknow"),
    "EPWA": (52.166,  20.967, "Europe/Warsaw",            "PL", "Warsaw"),
    # Nouvelles villes (Passe 15)
    "VHHH": (22.309, 113.915, "Asia/Hong_Kong",           "HK", "Hong Kong"),
    "ZBAA": (40.080, 116.584, "Asia/Shanghai",            "CN", "Beijing"),
    "ZGSZ": (22.639, 113.811, "Asia/Shanghai",            "CN", "Shenzhen"),
    "ZUUU": (30.578, 103.947, "Asia/Shanghai",            "CN", "Chengdu"),
    "ZUCK": (29.719, 106.642, "Asia/Shanghai",            "CN", "Chongqing"),
    "ZHHH": (30.784, 114.208, "Asia/Shanghai",            "CN", "Wuhan"),
}


def init_db(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS poly_markets (
        condition_id  TEXT PRIMARY KEY,
        event_id      TEXT,
        station       TEXT,
        city          TEXT,
        date          DATE,
        bracket_temp  REAL,
        bracket_op    TEXT,
        bracket_str   TEXT,
        unit          TEXT DEFAULT 'C',
        resolved      INTEGER DEFAULT 0,
        winner        TEXT,
        final_temp    REAL,
        market_prob   REAL,
        liquidity     REAL,
        end_date      TEXT,
        created_at    TEXT,
        fetched_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS actual_temps (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        station     TEXT NOT NULL,
        date        DATE NOT NULL,
        temp_max_c  REAL,
        temp_min_c  REAL,
        source      TEXT DEFAULT 'wunderground',
        fetched_at  TEXT,
        UNIQUE(station, date)
    );

    CREATE TABLE IF NOT EXISTS gfs_forecasts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        station     TEXT NOT NULL,
        target_date DATE NOT NULL,
        lead_days   INTEGER NOT NULL,
        model       TEXT DEFAULT 'gfs_seamless',
        temp_max_c  REAL,
        fetched_at  TEXT,
        UNIQUE(station, target_date, lead_days, model)
    );

    CREATE INDEX IF NOT EXISTS idx_pm_station_date  ON poly_markets(station, date);
    CREATE INDEX IF NOT EXISTS idx_at_station_date  ON actual_temps(station, date);
    CREATE INDEX IF NOT EXISTS idx_gfs_station_date ON gfs_forecasts(station, target_date);
    """)
    conn.commit()


CITY_TO_STATION = {
    "nyc":          "KLGA", "new york":     "KLGA",
    "london":       "EGLC",
    "seoul":        "RKSI",
    "tokyo":        "RJTT",
    "paris":        "LFPG",
    "chicago":      "KORD",
    "toronto":      "CYYZ",
    "madrid":       "LEMD",
    "singapore":    "WSSS",
    "miami":        "KMIA",
    "buenos aires": "SAEZ",
    "taipei":       "RCTP",
    "tel aviv":     "LLBG",
    "wellington":   "NZWN",
    "seattle":      "KSEA",
    "dallas":       "KDAL",
    "atlanta":      "KATL",
    "milan":        "LIMC",
    "ankara":       "LTAC",
    "auckland":     "NZAA",
    "shanghai":     "ZSPD",
    "sao paulo":    "SBGR",
    "munich":       "EDDM",
    "lucknow":      "VILK",
    "warsaw":       "EPWA",
    "hong kong":    "VHHH",
    "beijing":      "ZBAA",
    "shenzhen":     "ZGSZ",
    "chengdu":      "ZUUU",
    "chongqing":    "ZUCK",
    "wuhan":        "ZHHH",
}

# Mapping station aéroport Polymarket (via description)
AIRPORT_KEYWORDS = {
    "laguardia":   "KLGA",
    "la guardia":  "KLGA",
    "london city": "EGLC",
    "incheon":     "RKSI",
    "haneda":      "RJTT",
    "charles de gaulle": "LFPG", "cdg": "LFPG",
    "o'hare":      "KORD", "ohare": "KORD",
    "pearson":     "CYYZ",
    "barajas":     "LEMD",
    "changi":      "WSSS",
    "miami intl":  "KMIA",
    "ezeiza":      "SAEZ",
    "taoyuan":     "RCTP",
    "ben gurion":  "LLBG",
    "wellington":  "NZWN",
    "sea-tac":     "KSEA",
    "love field":  "KDAL",
    "hartsfield":  "KATL",
    "malpensa":    "LIMC",
    "esenboga":    "LTAC",  "esenboğa": "LTAC",
    "auckland":    "NZAA",
    "pudong":      "ZSPD",
    "guarulhos":   "SBGR",
    "munich":      "EDDM",  "franz josef": "EDDM",
    "lucknow":     "VILK",
    "chopin":      "EPWA",  "warsaw":  "EPWA",
}


def extract_station_from_event(event: dict) -> str | None:
    """Détecte la station ICAO depuis le titre et la description de l'event."""
    title = (event.get("title") or "").lower()
    desc  = (event.get("description") or "").lower()
    for m in event.get("markets", []):
        desc += " " + (m.get("description") or "").lower()

    # 1. Cherche nom d'aéroport dans la description
    for keyword, station in AIRPORT_KEYWORDS.items():
        if keyword in desc:
            return station

    # 2. Cherche nom de ville dans le titre
    for city, station in CITY_TO_STATION.items():
        if city in title:
            return station

    return None


def parse_bracket(title: str) -> tuple[float | None, str]:
    """
    Parse le titre d'un bracket market.
    Retourne (temp, op) où op = 'exact', 'lte', 'gte', 'range'
    Pour les ranges (24-25°F): retourne (24.0, 'range') — borne basse.
    """
    title = title.strip()

    # ≤ / or below / or lower
    m = re.search(r'(-?\d+(?:\.\d+)?)\s*°?[CF]?\s*(?:or below|or lower|≤)', title, re.I)
    if m:
        return float(m.group(1)), 'lte'
    m = re.search(r'(?:≤|<=)\s*(-?\d+(?:\.\d+)?)', title)
    if m:
        return float(m.group(1)), 'lte'

    # ≥ / or above / or higher
    m = re.search(r'(-?\d+(?:\.\d+)?)\s*°?[CF]?\s*(?:or above|or higher|≥)', title, re.I)
    if m:
        return float(m.group(1)), 'gte'
    m = re.search(r'(?:≥|>=)\s*(-?\d+(?:\.\d+)?)', title)
    if m:
        return float(m.group(1)), 'gte'

    # Range: "24-25°F" or "between 24-25°F"
    m = re.search(r'(\d+)\s*[-–]\s*(\d+)\s*°[CF]', title)
    if m:
        low = float(m.group(1))
        return low, 'range'

    # Exact single value: "-7°C" or "15°C"
    m = re.search(r'(-?\d+(?:\.\d+)?)\s*°[CF]', title)
    if m:
        return float(m.group(1)), 'exact'

    # Fallback
    m = re.search(r'(-?\d+(?:\.\d+)?)\s*°?[CF]?$', title)
    if m:
        return float(m.group(1)), 'exact'

    return None, 'exact'


def fetch_all_poly_markets(days_back: int | None = None) -> list[dict]:
    """Récupère tous les marchés température résolus via pagination."""
    all_events = []
    offset = 0
    limit  = 100

    cutoff = None
    if days_back:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d")

    print(f"📡 Récupération marchés Polymarket température résolus...")

    while True:
        try:
            r = requests.get(
                f"{GAMMA}/events",
                params={
                    "active": "false", "closed": "true",
                    "tag_slug": "temperature",
                    "limit": limit, "offset": offset,
                    "order": "endDate", "ascending": "false"
                },
                timeout=TIMEOUT
            )
            r.raise_for_status()
            events = r.json()
        except Exception as e:
            print(f"  ⚠ Gamma API erreur offset={offset}: {e}")
            time.sleep(2)
            break

        if not events:
            break

        # Filtre par date si spécifié
        if cutoff:
            events = [e for e in events if (e.get("endDate") or "")[:10] >= cutoff]
            if not events:
                break

        all_events.extend(events)
        print(f"  📦 {len(all_events)} events récupérés (offset={offset})...", end="\r")

        if len(events) < limit:
            break
        offset += limit
        time.sleep(0.3)  # Rate limit gentil

    print(f"\n  ✅ Total : {len(all_events)} events Polymarket")
    return all_events


def fetch_gfs_all_leadtimes(station: str, start_date: str, end_date: str) -> dict:
    """
    Récupère les prévisions GFS à J-0/J-1/J-2/J-3 via l'API Previous Runs.
    Utilise les variables HOURLY (_previous_dayN) puis calcule le max journalier.

    Retourne { date_str: {0: max_temp, 1: max_temp, 2: max_temp, 3: max_temp} }
    """
    if station not in STATIONS:
        return {}

    lat, lon, tz, _, _ = STATIONS[station]

    try:
        r = requests.get(
            OM_PREV,
            params={
                "latitude":       lat,
                "longitude":      lon,
                "start_date":     start_date,
                "end_date":       end_date,
                "hourly":         "temperature_2m,temperature_2m_previous_day1,temperature_2m_previous_day2,temperature_2m_previous_day3",
                "timezone":       tz,
                "models":         "gfs_seamless",
                "cell_selection": "nearest"
            },
            timeout=60
        )
        data = r.json()
        if data.get("error"):
            return {}

        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        d0_vals = hourly.get("temperature_2m", [])
        d1_vals = hourly.get("temperature_2m_previous_day1", [])
        d2_vals = hourly.get("temperature_2m_previous_day2", [])
        d3_vals = hourly.get("temperature_2m_previous_day3", [])

        if not times:
            return {}

        # Group by date and compute daily max for each lead time
        from collections import defaultdict
        by_date = defaultdict(lambda: {0: [], 1: [], 2: [], 3: []})
        for i, t in enumerate(times):
            date = t[:10]
            if i < len(d0_vals) and d0_vals[i] is not None:
                by_date[date][0].append(d0_vals[i])
            if i < len(d1_vals) and d1_vals[i] is not None:
                by_date[date][1].append(d1_vals[i])
            if i < len(d2_vals) and d2_vals[i] is not None:
                by_date[date][2].append(d2_vals[i])
            if i < len(d3_vals) and d3_vals[i] is not None:
                by_date[date][3].append(d3_vals[i])

        result = {}
        for date, leads in by_date.items():
            result[date] = {}
            for lead in [0, 1, 2, 3]:
                result[date][lead] = round(max(leads[lead]), 1) if leads[lead] else None
        return result

    except Exception as e:
        print(f"  ⚠ GFS leadtime error {station}: {e}")
        return {}


def fetch_opening_price(token_id: str) -> float | None:
    """Récupère le prix d'ouverture d'un marché via CLOB prices-history."""
    try:
        r = requests.get(
            "https://clob.polymarket.com/prices-history",
            params={"market": token_id, "interval": "max", "fidelity": 720},
            timeout=8
        )
        hist = r.json().get("history", [])
        if hist:
            return float(hist[0]["p"])  # Premier point = ouverture
    except Exception:
        pass
    return None


def store_markets(conn, events: list[dict]):
    """Parse et stocke tous les marchés dans poly_markets."""
    inserted = updated = skipped = 0
    now = datetime.now(timezone.utc).isoformat()

    for event in events:
        station  = extract_station_from_event(event)
        event_id = event.get("id", "")

        # Extract market date from title (more reliable than endDate which can be +1 day)
        title_str = event.get("title") or ""
        date_match = re.search(
            r'on\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d+)',
            title_str, re.I
        )
        if date_match:
            month_map = {'january':'01','february':'02','march':'03','april':'04','may':'05','june':'06',
                         'july':'07','august':'08','september':'09','october':'10','november':'11','december':'12'}
            mo = month_map[date_match.group(1).lower()]
            day = int(date_match.group(2))
            end_raw = event.get("endDate") or ""
            year = 2025 if "2025" in end_raw else 2026
            end_date = f"{year}-{mo}-{day:02d}"
        else:
            end_date = (event.get("endDate") or "")[:10]

        if not station or not end_date:
            skipped += 1
            continue

        city = STATIONS.get(station, (None, None, None, None, "Unknown"))[4]

        for market in event.get("markets", []):
            cid = market.get("conditionId") or market.get("id")
            if not cid:
                continue

            title = market.get("groupItemTitle") or market.get("question") or ""
            bracket_temp, bracket_op = parse_bracket(title)
            if bracket_temp is None:
                continue

            # Résolution : winner via outcomePrices final
            prices_raw = market.get("outcomePrices", "[]")
            try:
                prices    = json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
                yes_final = float(prices[0]) if prices else 0.5
            except Exception:
                yes_final = 0.5

            winner   = None
            resolved = market.get("closed", False)
            if resolved:
                if yes_final >= 0.99:
                    winner = "YES"
                elif yes_final <= 0.01:
                    winner = "NO"

            # Prix d'ouverture (pour backtest) via CLOB prices-history
            yes_price = 0.5  # fallback
            existing = conn.execute(
                "SELECT market_prob FROM poly_markets WHERE condition_id=?", (cid,)
            ).fetchone()
            if existing and existing[0] and 0 < existing[0] < 100:
                yes_price = existing[0] / 100  # déjà stocké
            else:
                clob_ids_raw = market.get("clobTokenIds", "[]")
                try:
                    clob_ids = json.loads(clob_ids_raw) if isinstance(clob_ids_raw, str) else clob_ids_raw
                    if clob_ids:
                        op = fetch_opening_price(str(clob_ids[0]))
                        if op is not None and 0.001 < op < 0.999:
                            yes_price = op
                        time.sleep(0.05)
                except Exception:
                    pass

            liquidity = float(market.get("liquidity") or 0)
            unit = "F" if station in ("KLGA", "KORD", "KMIA", "KSEA", "KDAL", "KATL") else "C"

            try:
                conn.execute("""
                    INSERT OR REPLACE INTO poly_markets
                    (condition_id, event_id, station, city, date, bracket_temp,
                     bracket_op, bracket_str, unit, resolved, winner, market_prob,
                     liquidity, end_date, fetched_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    cid, event_id, station, city, end_date,
                    bracket_temp, bracket_op, title, unit,
                    1 if resolved else 0,
                    winner, round(yes_price * 100, 1),
                    liquidity, end_date, now
                ))
                inserted += 1
            except Exception as e:
                print(f"  ⚠ DB insert error {cid}: {e}")

    conn.commit()
    print(f"  💾 {inserted} marchés stockés, {skipped} events sans station")


def fetch_actual_temps(conn):
    """Récupère les temps réels WU pour tous les marchés résolus sans actual_temp."""
    rows = conn.execute("""
        SELECT DISTINCT pm.station, pm.date
        FROM poly_markets pm
        LEFT JOIN actual_temps at ON at.station=pm.station AND at.date=pm.date
        WHERE pm.resolved=1 AND at.id IS NULL
        ORDER BY pm.date DESC
    """).fetchall()

    print(f"\n🌡 Récupération températures réelles WU ({len(rows)} station-dates)...")
    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    for i, (station, date) in enumerate(rows):
        country = STATIONS.get(station, (None,None,None,"US",None))[3]
        date_wu = date.replace("-", "")
        max_t   = get_daily_max(station, country, date_wu)

        if max_t is not None:
            conn.execute("""
                INSERT OR REPLACE INTO actual_temps (station, date, temp_max_c, source, fetched_at)
                VALUES (?,?,?,?,?)
            """, (station, date, max_t, "wunderground", now))
            ok += 1
        else:
            fail += 1

        if (i + 1) % 10 == 0:
            conn.commit()
            print(f"  {i+1}/{len(rows)} | ✅{ok} ❌{fail}", end="\r")
        time.sleep(0.4)  # Max 30 req/min WU

    conn.commit()
    print(f"\n  ✅ {ok} temps réels stockés | ❌ {fail} non disponibles")


def fetch_gfs_history(conn):
    """Récupère les prévisions GFS J-0/J-1/J-2/J-3 via hourly Previous Runs API."""
    # Group dates by station
    rows = conn.execute("""
        SELECT DISTINCT pm.station, MIN(pm.date) as min_date, MAX(pm.date) as max_date
        FROM poly_markets pm
        WHERE pm.resolved=1
        GROUP BY pm.station
        ORDER BY pm.station
    """).fetchall()

    print(f"\n📡 Récupération prévisions GFS (hourly → daily max, {len(rows)} stations)...")
    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    for station, min_date, max_date in rows:
        # Delete old (identical) data for this station
        conn.execute("DELETE FROM gfs_forecasts WHERE station=?", (station,))

        # Fetch all lead times in one batch call per station
        result = fetch_gfs_all_leadtimes(station, min_date, max_date)
        if not result:
            print(f"  ⚠ {station}: no data")
            continue

        for date_str, leads in result.items():
            for lead_days in [0, 1, 2, 3]:
                temp = leads.get(lead_days)
                if temp is not None:
                    conn.execute("""
                        INSERT OR REPLACE INTO gfs_forecasts
                        (station, target_date, lead_days, model, temp_max_c, fetched_at)
                        VALUES (?,?,?,?,?,?)
                    """, (station, date_str, lead_days, "gfs_seamless", temp, now))
                    ok += 1
                else:
                    fail += 1

        conn.commit()
        n_dates = len(result)
        print(f"  {station}: {n_dates} dates fetched")
        time.sleep(0.3)

    conn.commit()
    print(f"\n  ✅ {ok} prévisions GFS stockées | ❌ {fail} non disponibles")


def print_stats(conn):
    """Affiche les statistiques de la DB."""
    nm = conn.execute("SELECT COUNT(*) FROM poly_markets").fetchone()[0]
    nr = conn.execute("SELECT COUNT(*) FROM poly_markets WHERE resolved=1").fetchone()[0]
    nt = conn.execute("SELECT COUNT(*) FROM actual_temps").fetchone()[0]
    ng = conn.execute("SELECT COUNT(*) FROM gfs_forecasts").fetchone()[0]

    cities = conn.execute("""
        SELECT city, COUNT(*) as n, MIN(date), MAX(date)
        FROM poly_markets WHERE resolved=1
        GROUP BY city ORDER BY n DESC
    """).fetchall()

    print(f"\n📊 État de la DB backtest :")
    print(f"   poly_markets  : {nm:,} total | {nr:,} résolus")
    print(f"   actual_temps  : {nt:,} enregistrements")
    print(f"   gfs_forecasts : {ng:,} prévisions")
    print(f"\n   Marchés résolus par ville :")
    for city, n, dmin, dmax in cities:
        print(f"   {city:20} {n:4} marchés | {dmin} → {dmax}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--days",  type=int, help="Derniers N jours seulement")
    parser.add_argument("--check", action="store_true", help="Affiche stats DB uniquement")
    parser.add_argument("--markets-only", action="store_true", help="Marchés seulement (pas WU/GFS)")
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    if args.check:
        print_stats(conn)
        conn.close()
        sys.exit(0)

    # 1. Marchés Polymarket
    events = fetch_all_poly_markets(days_back=args.days)
    store_markets(conn, events)

    if not args.markets_only:
        # 2. Températures réelles WU
        fetch_actual_temps(conn)

        # 3. Prévisions GFS J-1/J-2/J-3
        fetch_gfs_history(conn)

    print_stats(conn)
    conn.close()
    print("\n✅ collect.py terminé")
