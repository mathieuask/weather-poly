#!/usr/bin/env python3
"""Pipeline live — prix, events, résolutions, backfill pour London/NYC/Seoul."""

import json, os, re, sys, time
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime, timedelta, timezone

# ── Config ──────────────────────────────────────────────────

SUPABASE_URL = "https://bpccdqgvkbfboqylzaie.supabase.co"
SUPABASE_KEY = ""
WU_KEY = "e1f10a1e78da46f5b10a1e78da96f525"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

STATIONS = {
    "EGLC": {"country": "GB", "city": "London"},
    "KLGA": {"country": "US", "city": "NYC"},
    "RKSI": {"country": "KR", "city": "Seoul"},
}

CITY_SLUGS = {"london": "EGLC", "new york": "KLGA", "nyc": "KLGA", "seoul": "RKSI"}

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def _load_key():
    global SUPABASE_KEY
    if SUPABASE_KEY:
        return
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env.local")
    if os.path.exists(env_path):
        for line in open(env_path):
            if line.strip().startswith("SUPABASE_SERVICE_ROLE_KEY="):
                SUPABASE_KEY = line.strip().split("=", 1)[1]


def _sb_h():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates",
    }


def _sb_get(path):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def _sb_get_all(path):
    rows = []
    offset = 0
    while True:
        sep = "&" if "?" in path else "?"
        batch = _sb_get(f"{path}{sep}offset={offset}&limit=1000")
        if not batch:
            break
        rows.extend(batch)
        offset += 1000
    return rows


def _sb_post(table, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{table}",
        data=body, headers=_sb_h(), method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as e:
        if e.code == 409:
            pass  # Duplicate — skip silently
        else:
            raise


def _sb_patch(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        data=body, headers=_sb_h(), method="PATCH",
    )
    urllib.request.urlopen(req, timeout=30)


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


# ── 1. fetch_open_prices ────────────────────────────────────

def fetch_open_prices():
    """Fetch prix des marchés ouverts depuis le dernier point en DB."""
    _load_key()

    brackets = _sb_get(
        "poly_markets?select=condition_id,station,date,clob_token_yes"
        "&resolved=eq.false&clob_token_yes=not.is.null&order=station,date"
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
        last_rows = _sb_get(
            f"price_history?condition_id=eq.{cid}&select=ts&order=ts.desc&limit=1"
        )
        last_ts = last_rows[0]["ts"] if last_rows else int(
            (datetime.strptime(b["date"], "%Y-%m-%d") - timedelta(days=5)).timestamp()
        )

        history = _clob(token, last_ts, now_ts)
        new_pts = [
            {
                "condition_id": cid, "station": b["station"],
                "target_date": b["date"], "ts": p["t"],
                "price_yes": round(float(p["p"]), 4),
            }
            for p in history if p["t"] > last_ts
        ]

        if new_pts:
            for i in range(0, len(new_pts), 200):
                _sb_post("price_history", new_pts[i : i + 200])
            total_new += len(new_pts)

        time.sleep(0.15)

    _log(f"prices: +{total_new} points insérés")


# ── 2. check_new_events ────────────────────────────────────

def check_new_events():
    """Détecter les nouveaux events Polymarket pour nos 3 villes."""
    _load_key()

    req = urllib.request.Request(
        "https://gamma-api.polymarket.com/events?tag_slug=temperature&limit=200&closed=false",
        headers={"User-Agent": UA},
    )
    gamma_events = json.loads(urllib.request.urlopen(req, timeout=30).read())

    _log(f"events: {len(gamma_events)} events ouverts sur Gamma")

    new_events = []
    new_brackets = []

    for event in gamma_events:
        title = (event.get("title") or "").lower()

        # Match nos villes
        station = None
        city_name = None
        for slug, stn in CITY_SLUGS.items():
            if slug in title:
                station = stn
                city_name = STATIONS[stn]["city"]
                break
        if not station:
            continue

        event_id = str(event.get("id"))

        # Déjà en DB ?
        existing = _sb_get(f"poly_events?event_id=eq.{event_id}&select=event_id&limit=1")
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

        new_events.append({
            "event_id": event_id,
            "slug": event.get("slug"),
            "title": event.get("title"),
            "city": city_name,
            "station": station,
            "target_date": target_date,
            "created_at": event.get("creationDate") or event.get("startDate"),
            "closed": False,
            "unit": "C",
            "n_brackets": len(markets),
            "total_volume": sum(float(m.get("volume") or 0) for m in markets),
        })

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

            new_brackets.append({
                "station": station,
                "date": target_date,
                "condition_id": m.get("conditionId"),
                "bracket_str": question,
                "bracket_temp": bracket_temp,
                "bracket_op": bracket_op,
                "unit": "C",
                "winner": None,
                "resolved": False,
                "volume": float(m.get("volume") or 0),
                "clob_token_yes": clob_ids[0] if clob_ids else None,
                "clob_token_no": clob_ids[1] if len(clob_ids) > 1 else None,
                "poly_event_id": event_id,
                "event_title": event.get("title"),
            })

    if new_events:
        _sb_post("poly_events", new_events)
        _log(f"events: +{len(new_events)} events, +{len(new_brackets)} brackets")
    else:
        _log("events: aucun nouvel event")

    if new_brackets:
        _sb_post("poly_markets", new_brackets)


# ── 3. check_resolutions ───────────────────────────────────

def check_resolutions():
    """Vérifier si des marchés ouverts sont maintenant résolus."""
    _load_key()

    open_events = _sb_get(
        "poly_events?closed=eq.false&select=event_id,station,target_date,city&order=target_date"
    )

    if not open_events:
        _log("resolutions: aucun event ouvert")
        return

    _log(f"resolutions: {len(open_events)} events ouverts à vérifier")

    for event in open_events:
        eid = event["event_id"]
        station = event["station"]
        target_date = event["target_date"]
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
        # Only check "resolved" — "closed" just means trading stopped, NOT that the outcome is known
        any_resolved = any(m.get("resolved") for m in markets)
        if not any_resolved:
            continue

        _log(f"resolutions: {city} {target_date} RÉSOLU")

        # Update event
        _sb_patch(f"poly_events?event_id=eq.{eid}", {"closed": True})

        # Update winners — only if the market is actually resolved
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

            _sb_patch(
                f"poly_markets?condition_id=eq.{cid}",
                {"winner": winner, "resolved": True},
            )

        # Fetch WU temperature (native unit: °F for KLGA, °C for others)
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
                    row = {
                        "station": station, "date": target_date,
                        "temp_max_f": temp_f, "temp_max_c": temp_c,
                        "source": "wunderground", "is_polymarket_day": True,
                    }
                    _log(f"  WU: {temp_f}°F ({temp_c}°C)")
                else:
                    row = {
                        "station": station, "date": target_date,
                        "temp_max_c": round(max(temps), 1),
                        "source": "wunderground", "is_polymarket_day": True,
                    }
                    _log(f"  WU: {max(temps):.1f}°C")
                _sb_post("daily_temps", [row])
        except Exception:
            _log(f"  WU: erreur fetch")

        # Complete price curves (post-resolution)
        brackets = _sb_get(
            f"poly_markets?poly_event_id=eq.{eid}"
            f"&select=condition_id,station,clob_token_yes&clob_token_yes=not.is.null"
        )
        end_ts = int((datetime.strptime(target_date, "%Y-%m-%d") + timedelta(days=2)).timestamp())

        for b in brackets:
            last_rows = _sb_get(
                f"price_history?condition_id=eq.{b['condition_id']}&select=ts&order=ts.desc&limit=1"
            )
            last_ts = last_rows[0]["ts"] if last_rows else 0

            history = _clob(b["clob_token_yes"], last_ts, end_ts)
            new_pts = [
                {
                    "condition_id": b["condition_id"], "station": station,
                    "target_date": target_date, "ts": p["t"],
                    "price_yes": round(float(p["p"]), 4),
                }
                for p in history if p["t"] > last_ts
            ]
            if new_pts:
                for i in range(0, len(new_pts), 200):
                    _sb_post("price_history", new_pts[i : i + 200])
            time.sleep(0.1)

        time.sleep(0.5)


# ── 4. backfill_gap ────────────────────────────────────────

def backfill_gap():
    """One-shot : combler le trou entre le dernier fetch et maintenant."""
    _load_key()

    brackets = _sb_get_all(
        "poly_markets?select=condition_id,station,date,clob_token_yes"
        "&date=gte.2026-03-23&clob_token_yes=not.is.null&order=station,date"
    )

    _log(f"backfill: {len(brackets)} brackets à combler")
    now_ts = int(_now().timestamp())
    total_new = 0

    for i, b in enumerate(brackets):
        cid = b["condition_id"]
        token = b["clob_token_yes"]

        last_rows = _sb_get(
            f"price_history?condition_id=eq.{cid}&select=ts&order=ts.desc&limit=1"
        )
        last_ts = last_rows[0]["ts"] if last_rows else int(
            (datetime.strptime(b["date"], "%Y-%m-%d") - timedelta(days=5)).timestamp()
        )

        end_ts = max(
            now_ts,
            int((datetime.strptime(b["date"], "%Y-%m-%d") + timedelta(days=2)).timestamp()),
        )

        history = _clob(token, last_ts, end_ts)
        new_pts = [
            {
                "condition_id": cid, "station": b["station"],
                "target_date": b["date"], "ts": p["t"],
                "price_yes": round(float(p["p"]), 4),
            }
            for p in history if p["t"] > last_ts
        ]

        if new_pts:
            for j in range(0, len(new_pts), 200):
                _sb_post("price_history", new_pts[j : j + 200])
            total_new += len(new_pts)

        if (i + 1) % 20 == 0:
            _log(f"  backfill: {i + 1}/{len(brackets)}, +{total_new} pts")

        time.sleep(0.15)

    _log(f"backfill: DONE +{total_new} points")


# ── 5. refresh_forecasts ──────────────────────────────────

FORECAST_STATIONS = {
    "KLGA": {"lat": 40.7769, "lon": -73.8740, "tz": "America/New_York"},
    "EGLC": {"lat": 51.5053, "lon": -0.0553, "tz": "Europe/London"},
    "RKSI": {"lat": 37.4602, "lon": 126.4407, "tz": "Asia/Seoul"},
}

FORECAST_MODELS = {
    "gfs_seamless": "gfs",
    "ecmwf_ifs025": "ecmwf",
    "icon_seamless": "icon",
    "ukmo_seamless": "ukmo",
    "meteofrance_seamless": "meteofrance",
    "gem_seamless": "gem",
    "jma_seamless": "jma",
    "knmi_seamless": "knmi",
}

HOURLY_VARS = (
    "temperature_2m,"
    "temperature_2m_previous_day1,"
    "temperature_2m_previous_day2,"
    "temperature_2m_previous_day3"
)

OFFSET_MAP = {
    "temperature_2m": 0,
    "temperature_2m_previous_day1": 1,
    "temperature_2m_previous_day2": 2,
    "temperature_2m_previous_day3": 3,
}


def refresh_forecasts():
    """Fetch fresh forecasts from Open-Meteo for all open poly_events."""
    _load_key()

    open_events = _sb_get(
        "poly_events?closed=eq.false&select=station,target_date"
    )
    if not open_events:
        _log("forecasts: no open events")
        return

    # Group dates by station
    station_dates = {}
    for ev in open_events:
        st = ev["station"]
        if st not in station_dates:
            station_dates[st] = set()
        station_dates[st].add(ev["target_date"])

    today = datetime.now(timezone.utc).date()
    total_rows = 0

    for station, dates in station_dates.items():
        cfg = FORECAST_STATIONS.get(station)
        if not cfg:
            continue

        sorted_dates = sorted(dates)
        min_d = datetime.strptime(sorted_dates[0], "%Y-%m-%d").date() - timedelta(days=3)
        max_d = datetime.strptime(sorted_dates[-1], "%Y-%m-%d").date()
        start_date = str(min_d)
        end_date = str(max_d)
        is_f = station == "KLGA"

        for om_model, db_model in FORECAST_MODELS.items():
            try:
                unit_param = "&temperature_unit=fahrenheit" if is_f else ""
                url = (
                    f"https://previous-runs-api.open-meteo.com/v1/forecast"
                    f"?latitude={cfg['lat']}&longitude={cfg['lon']}"
                    f"&hourly={HOURLY_VARS}"
                    f"&timezone={cfg['tz']}"
                    f"&start_date={start_date}&end_date={end_date}"
                    f"&models={om_model}{unit_param}"
                )
                req = urllib.request.Request(url)
                resp = urllib.request.urlopen(req, timeout=120)
                data = json.loads(resp.read())
                hourly = data.get("hourly", {})
                time_arr = hourly.get("time", [])
                if not time_arr:
                    continue

                # Compute daily max per horizon
                daily_max = {}
                for var_name, offset in OFFSET_MAP.items():
                    vals = hourly.get(var_name, [])
                    if not vals:
                        continue

                    daily = defaultdict(list)
                    for i, ts in enumerate(time_arr):
                        if i >= len(vals) or vals[i] is None:
                            continue
                        daily[ts[:10]].append(vals[i])

                    for date_str, temps in daily.items():
                        target = datetime.strptime(date_str, "%Y-%m-%d").date()
                        if target <= today:
                            real_horizon = offset
                        else:
                            real_horizon = (target - today).days + offset
                        if real_horizon > 3:
                            continue

                        if date_str not in daily_max:
                            daily_max[date_str] = {}
                        daily_max[date_str][real_horizon] = round(max(temps), 2)

                # Build rows for event dates only
                rows = []
                for date_str, horizons in daily_max.items():
                    if date_str not in dates:
                        continue
                    for horizon, temp in horizons.items():
                        row = {
                            "station": station,
                            "target_date": date_str,
                            "horizon": horizon,
                            "model": db_model,
                            "temp_max": temp,
                        }
                        if is_f:
                            row["temp_max_f"] = round(temp, 1)
                        rows.append(row)

                if rows:
                    headers = {
                        "apikey": SUPABASE_KEY,
                        "Authorization": f"Bearer {SUPABASE_KEY}",
                        "Content-Type": "application/json",
                        "Prefer": "resolution=merge-duplicates",
                    }
                    for bi in range(0, len(rows), 500):
                        batch = rows[bi:bi+500]
                        body = json.dumps(batch).encode()
                        req = urllib.request.Request(
                            f"{SUPABASE_URL}/rest/v1/gfs_forecasts?on_conflict=station,target_date,horizon,model",
                            data=body, headers=headers, method="POST",
                        )
                        urllib.request.urlopen(req, timeout=60)
                    total_rows += len(rows)
                    _log(f"  forecasts: {station}/{db_model} +{len(rows)} rows")

                time.sleep(0.5)
            except Exception as e:
                _log(f"  forecasts: {station}/{db_model} error: {e}")

    _log(f"forecasts: {total_rows} total rows upserted")


# ── 6. run_all ─────────────────────────────────────────────

def run_all():
    """Single cron entry: prices + resolutions + events + forecasts + scores."""
    _load_key()

    # Always: fetch prices for open markets
    try:
        fetch_open_prices()
    except Exception as e:
        _log(f"ERROR prices: {e}")

    # Always: check resolutions
    try:
        check_resolutions()
    except Exception as e:
        _log(f"ERROR resolutions: {e}")

    now = _now()

    # Check new events
    try:
        check_new_events()
    except Exception as e:
        _log(f"ERROR events: {e}")

    # Hourly: refresh ensemble forecasts (143 members)
    if now.minute < 10:
        try:
            from fetch_ensembles import fetch_ensembles
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
    elif cmd == "backfill":
        backfill_gap()
    elif cmd == "scores":
        from compute_scores import compute_model_scores
        compute_model_scores()
    elif cmd == "ensembles":
        from fetch_ensembles import fetch_ensembles
        fetch_ensembles()
    else:
        print(f"Usage: python3 pipeline.py [all|prices|events|resolutions|backfill|scores|ensembles]")
        sys.exit(1)
