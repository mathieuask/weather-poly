#!/usr/bin/env python3
"""Pipeline weather-poly — prix, events, résolutions, ensembles.
Writes directly to PostgreSQL on localhost (no Supabase dependency).
"""

import json, os, re, sys, time
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

# ── Config ──────────────────────────────────────────────────

DB_DSN = os.environ.get(
    "DATABASE_URL",
    "dbname=weatherpoly user=weatherpoly password=wp_b28a537c321173b4ed40342f host=127.0.0.1"
)
WU_KEY = "e1f10a1e78da46f5b10a1e78da96f525"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

STATIONS = {
    "KLGA": {"lat": 40.7769, "lon": -73.8740, "country": "US", "city": "NYC"},
    "EGLC": {"lat": 51.5053, "lon": -0.0553, "country": "GB", "city": "London"},
    "RKSI": {"lat": 37.4602, "lon": 126.4407, "country": "KR", "city": "Seoul"},
}

CITY_SLUGS = {}  # Built dynamically from cities table

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}

ENSEMBLE_MODELS = {
    "gfs_seamless": {"db": "gfs", "members": 31},
    "ecmwf_ifs025_ensemble": {"db": "ecmwf", "members": 51},
    "icon_seamless": {"db": "icon", "members": 40},
    "gem_global": {"db": "gem", "members": 21},
}

# ── Database ────────────────────────────────────────────────

_conn = None

def _get_conn():
    global _conn
    if _conn is None or _conn.closed:
        import psycopg2
        _conn = psycopg2.connect(DB_DSN)
        _conn.autocommit = True
    return _conn


def _db_query(sql, params=None):
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(sql, params)
        if cur.description:
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
        return []


def _db_execute(sql, params=None):
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(sql, params)


def _db_execute_many(sql, params_list):
    conn = _get_conn()
    with conn.cursor() as cur:
        from psycopg2.extras import execute_values
        # For bulk inserts, use execute_values or executemany
        cur.executemany(sql, params_list)


# ── Helpers ─────────────────────────────────────────────────

def _clob(token, start_ts, end_ts, fidelity=5):
    url = (
        f"https://clob.polymarket.com/prices-history"
        f"?market={token}&startTs={start_ts}&endTs={end_ts}&fidelity={fidelity}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read()).get("history", [])
    except Exception:
        return []


def _now():
    return datetime.now(timezone.utc)


def _log(msg):
    print(f"[{_now().strftime('%Y-%m-%d %H:%M:%S UTC')}] {msg}", flush=True)


def _load_city_slugs():
    """Load city slugs from DB for event matching."""
    global CITY_SLUGS
    rows = _db_query("SELECT name, slug, station FROM cities WHERE active = true")
    for r in rows:
        name_lower = r["name"].lower()
        CITY_SLUGS[name_lower] = r["station"]
        if r.get("slug"):
            CITY_SLUGS[r["slug"].lower()] = r["station"]
    # Add hardcoded aliases
    CITY_SLUGS.setdefault("nyc", "KLGA")
    CITY_SLUGS.setdefault("new york", "KLGA")
    CITY_SLUGS.setdefault("london", "EGLC")
    CITY_SLUGS.setdefault("seoul", "RKSI")


# ── 1. fetch_open_prices ────────────────────────────────────

def fetch_open_prices():
    """Fetch prix des marchés ouverts depuis le dernier point en DB."""
    brackets = _db_query(
        "SELECT condition_id, station, date, clob_token_yes "
        "FROM poly_markets WHERE resolved = false AND clob_token_yes IS NOT NULL "
        "ORDER BY station, date"
    )

    if not brackets:
        _log("prices: aucun marché ouvert")
        return

    _log(f"prices: {len(brackets)} brackets ouverts")
    now_ts = int(_now().timestamp())
    total_new = 0

    for b in brackets:
        cid = b["condition_id"]
        token = b["clob_token_yes"]

        # Dernier ts en DB
        last = _db_query(
            "SELECT ts FROM price_history WHERE condition_id = %s ORDER BY ts DESC LIMIT 1",
            (cid,)
        )
        last_ts = last[0]["ts"] if last else int(
            (datetime.combine(b["date"], datetime.min.time()) - timedelta(days=5)).timestamp()
        )

        history = _clob(token, last_ts, now_ts)
        new_pts = [
            (cid, b["station"], str(b["date"]), p["t"], round(float(p["p"]), 4))
            for p in history if p["t"] > last_ts
        ]

        if new_pts:
            _db_execute_many(
                "INSERT INTO price_history (condition_id, station, target_date, ts, price_yes) "
                "VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                new_pts
            )
            total_new += len(new_pts)

        time.sleep(0.15)

    _log(f"prices: +{total_new} points insérés")


# ── 2. check_new_events ────────────────────────────────────

def check_new_events():
    """Détecter les nouveaux events Polymarket pour nos villes."""
    _load_city_slugs()

    req = urllib.request.Request(
        "https://gamma-api.polymarket.com/events?tag_slug=temperature&limit=200&closed=false",
        headers={"User-Agent": UA},
    )
    gamma_events = json.loads(urllib.request.urlopen(req, timeout=30).read())

    _log(f"events: {len(gamma_events)} events ouverts sur Gamma")

    new_events = 0
    new_brackets = 0

    for event in gamma_events:
        title = (event.get("title") or "").lower()

        # Match nos villes
        station = None
        city_name = None
        for slug, stn in CITY_SLUGS.items():
            if slug in title:
                station = stn
                # Get city name from STATIONS or cities table
                city_name = STATIONS.get(stn, {}).get("city", slug.title())
                break
        if not station:
            continue

        event_id = str(event.get("id"))

        # Déjà en DB ?
        existing = _db_query(
            "SELECT event_id FROM poly_events WHERE event_id = %s LIMIT 1", (event_id,)
        )
        if existing:
            continue

        # Extraire la date
        date_match = re.search(
            r"on\s+(\w+)\s+(\d+)(?:,?\s*(\d{4}))?", event.get("title", "")
        )
        if not date_match:
            continue

        month = MONTHS.get(date_match.group(1).lower())
        if not month:
            continue
        day = int(date_match.group(2))
        year = int(date_match.group(3)) if date_match.group(3) else _now().year
        target_date = f"{year}-{month:02d}-{day:02d}"

        markets = event.get("markets", [])

        _db_execute(
            "INSERT INTO poly_events (event_id, slug, title, city, station, target_date, created_at, closed, unit, n_brackets, total_volume) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, false, %s, %s, %s) ON CONFLICT DO NOTHING",
            (
                event_id, event.get("slug"), event.get("title"), city_name, station,
                target_date, event.get("creationDate") or event.get("startDate"),
                "C", len(markets),
                sum(float(m.get("volume") or 0) for m in markets),
            )
        )
        new_events += 1

        for m in markets:
            question = m.get("question") or m.get("groupItemTitle") or ""
            clob_ids = json.loads(m.get("clobTokenIds", "[]") or "[]")

            bracket_temp = None
            bracket_op = "exact"
            q = question.lower()

            if re.search(r"or\s+below", q):
                match = re.search(r"(-?\d+)\s*°", q)
                if match:
                    bracket_temp = int(match.group(1))
                    bracket_op = "lte"
            elif re.search(r"or\s+(?:higher|above)", q):
                match = re.search(r"(-?\d+)\s*°", q)
                if match:
                    bracket_temp = int(match.group(1))
                    bracket_op = "gte"
            elif re.search(r"between", q):
                match = re.search(r"between\s+(-?\d+)\s*[-–]\s*(-?\d+)", q)
                if match:
                    bracket_temp = int(match.group(1))
                    bracket_op = "between"
            else:
                match = re.search(r"be\s+(-?\d+)\s*°", q)
                if match:
                    bracket_temp = int(match.group(1))
                    bracket_op = "exact"

            _db_execute(
                "INSERT INTO poly_markets (condition_id, station, date, bracket_str, bracket_temp, bracket_op, "
                "unit, winner, resolved, volume, clob_token_yes, clob_token_no, poly_event_id, event_title) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, false, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                (
                    m.get("conditionId"), station, target_date, question, bracket_temp, bracket_op,
                    "C", float(m.get("volume") or 0),
                    clob_ids[0] if clob_ids else None,
                    clob_ids[1] if len(clob_ids) > 1 else None,
                    event_id, event.get("title"),
                )
            )
            new_brackets += 1

    if new_events:
        _log(f"events: +{new_events} events, +{new_brackets} brackets")
    else:
        _log("events: aucun nouvel event")


# ── 3. check_resolutions ───────────────────────────────────

def check_resolutions():
    """Vérifier si des marchés ouverts sont maintenant résolus."""
    open_events = _db_query(
        "SELECT event_id, station, target_date, city FROM poly_events "
        "WHERE closed = false ORDER BY target_date"
    )

    if not open_events:
        _log("resolutions: aucun event ouvert")
        return

    _log(f"resolutions: {len(open_events)} events ouverts à vérifier")

    for event in open_events:
        eid = event["event_id"]
        station = event["station"]
        target_date = str(event["target_date"])
        city = event["city"]

        # Check Gamma
        try:
            req = urllib.request.Request(
                f"https://gamma-api.polymarket.com/events/{eid}",
                headers={"User-Agent": UA},
            )
            gamma = json.loads(urllib.request.urlopen(req, timeout=10).read())
        except Exception:
            continue

        markets = gamma.get("markets", [])
        any_resolved = any(m.get("resolved") for m in markets)
        if not any_resolved:
            continue

        _log(f"resolutions: {city} {target_date} RÉSOLU")

        # Update event
        _db_execute("UPDATE poly_events SET closed = true WHERE event_id = %s", (eid,))

        # Update winners
        for m in markets:
            cid = m.get("conditionId")
            if not cid or not m.get("resolved"):
                continue
            prices = json.loads(m.get("outcomePrices", "[]") or "[]")
            winner = None
            try:
                if prices and float(prices[0]) > 0.9:
                    winner = "YES"
                elif len(prices) > 1 and float(prices[1]) > 0.9:
                    winner = "NO"
            except (ValueError, IndexError):
                pass

            _db_execute(
                "UPDATE poly_markets SET winner = %s, resolved = true WHERE condition_id = %s",
                (winner, cid)
            )

        # Fetch WU temperature
        country = STATIONS.get(station, {}).get("country", "US")
        wu_date = target_date.replace("-", "")
        is_f = station == "KLGA"
        wu_units = "e" if is_f else "m"
        try:
            wu_url = (
                f"https://api.weather.com/v1/location/{station}:9:{country}"
                f"/observations/historical.json?apiKey={WU_KEY}&units={wu_units}&startDate={wu_date}"
            )
            req = urllib.request.Request(wu_url)
            obs = json.loads(urllib.request.urlopen(req, timeout=15).read()).get("observations", [])
            temps = [o["temp"] for o in obs if o.get("temp") is not None]
            if temps:
                if is_f:
                    temp_f = round(max(temps))
                    temp_c = round((temp_f - 32) / 1.8, 1)
                else:
                    temp_c = round(max(temps), 1)
                    temp_f = None

                _db_execute(
                    "INSERT INTO daily_temps (station, date, temp_max_c, temp_max_f, source, is_polymarket_day) "
                    "VALUES (%s, %s, %s, %s, 'wunderground', true) "
                    "ON CONFLICT (station, date) DO UPDATE SET temp_max_c = EXCLUDED.temp_max_c, temp_max_f = EXCLUDED.temp_max_f",
                    (station, target_date, temp_c, temp_f)
                )
                _log(f"  WU: {temp_f}°F ({temp_c}°C)" if is_f else f"  WU: {temp_c}°C")
        except Exception:
            _log("  WU: erreur fetch")

        # Complete price curves (post-resolution)
        brackets = _db_query(
            "SELECT condition_id, station, clob_token_yes FROM poly_markets "
            "WHERE poly_event_id = %s AND clob_token_yes IS NOT NULL",
            (eid,)
        )
        end_ts = int((datetime.strptime(target_date, "%Y-%m-%d") + timedelta(days=2)).timestamp())

        for b in brackets:
            last = _db_query(
                "SELECT ts FROM price_history WHERE condition_id = %s ORDER BY ts DESC LIMIT 1",
                (b["condition_id"],)
            )
            last_ts = last[0]["ts"] if last else 0

            history = _clob(b["clob_token_yes"], last_ts, end_ts)
            new_pts = [
                (b["condition_id"], station, target_date, p["t"], round(float(p["p"]), 4))
                for p in history if p["t"] > last_ts
            ]
            if new_pts:
                _db_execute_many(
                    "INSERT INTO price_history (condition_id, station, target_date, ts, price_yes) "
                    "VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                    new_pts
                )
            time.sleep(0.1)

        time.sleep(0.5)


# ── 4. fetch_ensembles ─────────────────────────────────────

def fetch_ensembles():
    """Fetch ensemble forecasts for all open events."""
    open_events = _db_query(
        "SELECT station, target_date FROM poly_events WHERE closed = false"
    )
    if not open_events:
        _log("ensembles: no open events")
        return

    # Group by station
    station_dates = {}
    for ev in open_events:
        st = ev["station"]
        if st not in station_dates:
            station_dates[st] = set()
        station_dates[st].add(str(ev["target_date"]))

    _log(f"ensembles: {len(open_events)} events across {len(station_dates)} stations")
    now_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:00:00Z")
    total_rows = 0

    for station, dates in station_dates.items():
        cfg = STATIONS.get(station)
        if not cfg:
            continue

        sorted_dates = sorted(dates)
        start_date = sorted_dates[0]
        end_date = sorted_dates[-1]

        for om_model, model_cfg in ENSEMBLE_MODELS.items():
            db_model = model_cfg["db"]
            n_members = model_cfg["members"]

            unit_param = "&temperature_unit=fahrenheit" if station == "KLGA" else ""
            url = (
                f"https://ensemble-api.open-meteo.com/v1/ensemble"
                f"?latitude={cfg['lat']}&longitude={cfg['lon']}"
                f"&daily=temperature_2m_max"
                f"&models={om_model}"
                f"&start_date={start_date}&end_date={end_date}"
                f"&timezone=UTC{unit_param}"
            )

            try:
                req = urllib.request.Request(url)
                resp = urllib.request.urlopen(req, timeout=60)
                data = json.loads(resp.read())
            except Exception as e:
                _log(f"  {station}/{db_model}: API error - {e}")
                continue

            daily = data.get("daily", {})
            time_arr = daily.get("time", [])
            if not time_arr:
                _log(f"  {station}/{db_model}: no data")
                continue

            rows = []
            for i, target_d in enumerate(time_arr):
                if target_d not in dates:
                    continue
                for member_id in range(n_members):
                    key = "temperature_2m_max" if member_id == 0 else f"temperature_2m_max_member{member_id:02d}"
                    vals = daily.get(key, [])
                    temp_max = round(vals[i], 2) if i < len(vals) and vals[i] is not None else None

                    rows.append((station, target_d, now_ts, db_model, member_id, temp_max))

            if rows:
                _db_execute_many(
                    "INSERT INTO ensemble_forecasts (station, target_date, fetch_ts, ensemble_model, member_id, temp_max) "
                    "VALUES (%s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (station, target_date, fetch_ts, ensemble_model, member_id) DO UPDATE SET temp_max = EXCLUDED.temp_max",
                    rows
                )
                total_rows += len(rows)
                _log(f"  {station}/{db_model}: {len(rows)} rows")

            time.sleep(2)

    _log(f"ensembles: total {total_rows} rows upserted")


# ── 5. run_all ─────────────────────────────────────────────

def run_all():
    """Single cron entry: prices + resolutions + events + ensembles (hourly)."""
    try:
        fetch_open_prices()
    except Exception as e:
        _log(f"ERROR prices: {e}")

    try:
        check_resolutions()
    except Exception as e:
        _log(f"ERROR resolutions: {e}")

    try:
        check_new_events()
    except Exception as e:
        _log(f"ERROR events: {e}")

    # Hourly: ensembles
    if _now().minute < 10:
        try:
            fetch_ensembles()
        except Exception as e:
            _log(f"ERROR ensembles: {e}")


# ── CLI ─────────────────────────────────────────────────────

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd == "all":
        run_all()
    elif cmd == "prices":
        fetch_open_prices()
    elif cmd == "events":
        check_new_events()
    elif cmd == "resolutions":
        check_resolutions()
    elif cmd == "ensembles":
        fetch_ensembles()
    else:
        print(f"Usage: python3 pipeline_pg.py [all|prices|events|resolutions|ensembles]")
        sys.exit(1)
