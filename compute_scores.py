#!/usr/bin/env python3
"""
Compute model reliability scores (MAE) per station/model/horizon.

Joins gfs_forecasts with daily_temps to calculate Mean Absolute Error.
Results are upserted into model_scores table.

Usage:
    python3 compute_scores.py
"""

import json, os, sys
import urllib.request
import urllib.error

# ── Config ──────────────────────────────────────────────────

SUPABASE_URL = "https://bpccdqgvkbfboqylzaie.supabase.co"
SUPABASE_KEY = ""

STATIONS = ["KLGA", "EGLC", "RKSI"]


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


def _sb_upsert(table, data, on_conflict="station,model,horizon"):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}",
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


def compute_model_scores():
    """Compute MAE for all station/model/horizon combos and upsert to model_scores."""
    _load_key()

    print("Computing model scores...")

    for station in STATIONS:
        print(f"\n{'='*50}")
        print(f"Station: {station}")

        # Fetch all actuals for this station
        actuals_raw = _sb_get_all(
            f"daily_temps?station=eq.{station}&select=date,temp_max_c,temp_max_f"
        )
        # Build lookup: date -> {temp_max_c, temp_max_f}
        actuals = {}
        for a in actuals_raw:
            actuals[a["date"]] = a

        if not actuals:
            print("  No actuals found, skipping")
            continue

        print(f"  {len(actuals)} actual temps")

        # Fetch all forecasts for this station
        forecasts_raw = _sb_get_all(
            f"gfs_forecasts?station=eq.{station}&select=target_date,horizon,model,temp_max,temp_max_f"
        )
        print(f"  {len(forecasts_raw)} forecasts")

        # Group by (model, horizon)
        groups = {}
        for f in forecasts_raw:
            key = (f["model"], f["horizon"])
            if key not in groups:
                groups[key] = []
            groups[key].append(f)

        scores = []
        for (model, horizon), fcs in sorted(groups.items()):
            errors = []
            for fc in fcs:
                actual = actuals.get(fc["target_date"])
                if actual is None:
                    continue

                if station == "KLGA":
                    # Both forecast and actual in °F
                    fc_val = fc.get("temp_max_f")
                    ac_val = actual.get("temp_max_f")
                else:
                    # Forecast in °C (temp_max), actual in °C (temp_max_c)
                    fc_val = fc.get("temp_max")
                    ac_val = actual.get("temp_max_c")

                if fc_val is None or ac_val is None:
                    continue

                errors.append(abs(fc_val - ac_val))

            if errors:
                mae = round(sum(errors) / len(errors), 2)
                scores.append({
                    "station": station,
                    "model": model,
                    "horizon": horizon,
                    "mae": mae,
                    "sample_count": len(errors),
                })
                print(f"  {model:15s} J-{horizon}  MAE={mae:5.2f}  n={len(errors)}")

        if scores:
            _sb_upsert("model_scores", scores)
            print(f"  Upserted {len(scores)} scores")

    print(f"\n{'='*50}")
    print("Done computing model scores.")


if __name__ == "__main__":
    compute_model_scores()
