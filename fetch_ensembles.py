#!/usr/bin/env python3
"""
Fetch ensemble member forecasts from Open-Meteo for open Polymarket events.
Stores each member's prediction with fetch_date for horizon computation.

Models: GFS (31), ECMWF (51), ICON (40), GEM (21) = 143 members
Variables: temp, wind, humidity, precipitation, pressure, clouds, etc.

Usage:
    python3 fetch_ensembles.py
"""

import json, os, sys, time
import urllib.request
import urllib.error
from datetime import datetime, date, timezone

# ── Config ──────────────────────────────────────────────────

SUPABASE_URL = "https://bpccdqgvkbfboqylzaie.supabase.co"
SUPABASE_KEY = ""

STATIONS = {
    "KLGA": {"lat": 40.7769, "lon": -73.8740},
    "EGLC": {"lat": 51.5053, "lon": -0.0553},
    "RKSI": {"lat": 37.4602, "lon": 126.4407},
}

# Open-Meteo ensemble model names → our DB names
ENSEMBLE_MODELS = {
    "gfs_seamless": {"db": "gfs", "members": 31},
    "ecmwf_ifs025_ensemble": {"db": "ecmwf", "members": 51},
    "icon_seamless": {"db": "icon", "members": 40},
    "gem_global": {"db": "gem", "members": 21},
}

# Daily variables to fetch (all have per-member data)
DAILY_VARS = (
    "temperature_2m_max,temperature_2m_min,temperature_2m_mean,"
    "apparent_temperature_max,apparent_temperature_min,"
    "dew_point_2m_max,dew_point_2m_min,"
    "wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,"
    "precipitation_sum,rain_sum,snowfall_sum,"
    "relative_humidity_2m_max,relative_humidity_2m_min,relative_humidity_2m_mean,"
    "pressure_msl_mean,cloud_cover_mean,shortwave_radiation_sum"
)

# Mapping: API variable name → DB column name
VAR_MAP = {
    "temperature_2m_max": "temp_max",
    "temperature_2m_min": "temp_min",
    "temperature_2m_mean": "temp_mean",
    "apparent_temperature_max": "apparent_temp_max",
    "apparent_temperature_min": "apparent_temp_min",
    "dew_point_2m_max": "dew_point_max",
    "dew_point_2m_min": "dew_point_min",
    "wind_speed_10m_max": "wind_speed_max",
    "wind_gusts_10m_max": "wind_gusts_max",
    "wind_direction_10m_dominant": "wind_direction",
    "precipitation_sum": "precipitation",
    "rain_sum": "rain",
    "snowfall_sum": "snowfall",
    "relative_humidity_2m_max": "humidity_max",
    "relative_humidity_2m_min": "humidity_min",
    "relative_humidity_2m_mean": "humidity_mean",
    "pressure_msl_mean": "pressure_msl",
    "cloud_cover_mean": "cloud_cover",
    "shortwave_radiation_sum": "radiation",
}

NOW_TS = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:00:00Z")  # Round to hour


def _load_key():
    global SUPABASE_KEY
    if SUPABASE_KEY:
        return
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env.local")
    if os.path.exists(env_path):
        for line in open(env_path):
            if line.strip().startswith("SUPABASE_SERVICE_ROLE_KEY="):
                SUPABASE_KEY = line.strip().split("=", 1)[1]
    if not SUPABASE_KEY:
        print("ERROR: SUPABASE_SERVICE_ROLE_KEY not found in .env.local")
        sys.exit(1)


def _sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }


def _sb_get(path):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def _sb_upsert(table, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{table}?on_conflict=station,target_date,fetch_ts,ensemble_model,member_id",
        data=body,
        headers=_sb_headers(),
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  UPSERT error: {e.code} {err[:200]}")
        raise


def _log(msg):
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch_ensembles():
    """Fetch ensemble forecasts for all open events."""
    _load_key()

    # Get open event dates
    open_events = _sb_get("poly_events?closed=eq.false&select=station,target_date")
    if not open_events:
        _log("No open events")
        return

    # Group target dates by station
    station_dates = {}
    for ev in open_events:
        st = ev["station"]
        if st not in station_dates:
            station_dates[st] = set()
        station_dates[st].add(ev["target_date"])

    _log(f"{len(open_events)} open events across {len(station_dates)} stations")
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
                f"&daily={DAILY_VARS}"
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

            # Build rows: one per member per date
            rows = []
            for i, target_d in enumerate(time_arr):
                if target_d not in dates:
                    continue

                for member_id in range(n_members):
                    row = {
                        "station": station,
                        "target_date": target_d,
                        "fetch_ts": NOW_TS,
                        "ensemble_model": db_model,
                        "member_id": member_id,
                    }

                    for api_var, db_col in VAR_MAP.items():
                        # member key: e.g. "temperature_2m_max_member01"
                        suffix = f"_member{member_id:02d}" if member_id > 0 else ""
                        # member00 is the "mean" field (no suffix)
                        if member_id == 0:
                            key = api_var
                        else:
                            key = f"{api_var}_member{member_id:02d}"

                        vals = daily.get(key, [])
                        if i < len(vals) and vals[i] is not None:
                            row[db_col] = round(vals[i], 2)

                    rows.append(row)

            if rows:
                for bi in range(0, len(rows), 2000):
                    _sb_upsert("ensemble_forecasts", rows[bi:bi+2000])
                total_rows += len(rows)
                _log(f"  {station}/{db_model}: {len(rows)} rows ({n_members} members x {len([d for d in time_arr if d in dates])} dates)")

            time.sleep(2)

    _log(f"Total: {total_rows} rows upserted")


if __name__ == "__main__":
    fetch_ensembles()
