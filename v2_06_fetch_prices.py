#!/usr/bin/env python3
"""V2_06 — Fetch complete CLOB price history for all brackets (London/NYC/Seoul)."""

import json, os, time, sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

# ============================================================
# Config
# ============================================================
env = {}
with open(".env.local") as f:
    for line in f:
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k] = v

SB_URL = env["NEXT_PUBLIC_SUPABASE_URL"]
SB_KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
SB_HEADERS = {
    "apikey": SB_KEY,
    "Authorization": f"Bearer {SB_KEY}",
    "Content-Type": "application/json",
}
CLOB_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
FIDELITY = 5  # 5-minute granularity
MAX_WORKERS = 8
BATCH_SIZE = 200

# ============================================================
# STEP 1 — Load all brackets from Supabase
# ============================================================
print("=" * 60)
print("STEP 1 — Loading brackets from Supabase")
print("=" * 60)


def sb_get(path):
    req = urllib.request.Request(
        f"{SB_URL}/rest/v1/{path}",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def sb_get_all(path):
    """Paginate through all results."""
    all_rows = []
    offset = 0
    while True:
        sep = "&" if "?" in path else "?"
        rows = sb_get(f"{path}{sep}offset={offset}&limit=1000")
        if not rows:
            break
        all_rows.extend(rows)
        offset += 1000
    return all_rows


all_brackets = sb_get_all(
    "poly_markets?select=id,condition_id,station,date,clob_token_yes,bracket_str"
    "&clob_token_yes=not.is.null&order=station,date"
)
print(f"  Total brackets: {len(all_brackets)}")

# Load event creation dates for startTs calculation
events_raw = sb_get_all(
    "poly_events?select=station,target_date,created_at&order=station,target_date"
)
events_created = {}
for e in events_raw:
    events_created[(e["station"], e["target_date"])] = e.get("created_at")

# Stats
by_station = defaultdict(int)
for b in all_brackets:
    by_station[b["station"]] += 1
for stn, n in sorted(by_station.items()):
    print(f"  {stn}: {n} brackets")

# ============================================================
# STEP 2 — Check what's already fetched
# ============================================================
print("\n" + "=" * 60)
print("STEP 2 — Checking existing price_history")
print("=" * 60)

to_fetch = all_brackets
print(f"  To fetch: {len(to_fetch)} brackets")

# ============================================================
# STEP 3 — Fetch function
# ============================================================


def insert_rows(rows):
    """Insert rows into Supabase in chunks of BATCH_SIZE."""
    if not rows:
        return True
    for i in range(0, len(rows), BATCH_SIZE):
        chunk = rows[i : i + BATCH_SIZE]
        data = json.dumps(chunk).encode()
        req = urllib.request.Request(
            f"{SB_URL}/rest/v1/price_history",
            data=data,
            headers={**SB_HEADERS, "Prefer": "resolution=ignore-duplicates"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=60)
        except Exception:
            return False
    return True


def fetch_and_insert(bracket):
    """Fetch CLOB price history for a single bracket and insert immediately."""
    token = bracket["clob_token_yes"]
    condition_id = bracket["condition_id"]
    station = bracket["station"]
    target_date = bracket["date"]

    # Calculate time window
    created = events_created.get((station, target_date))
    if created:
        try:
            created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            start_ts = int((created_dt - timedelta(days=1)).timestamp())
        except Exception:
            start_ts = int(
                (datetime.strptime(target_date, "%Y-%m-%d") - timedelta(days=5)).timestamp()
            )
    else:
        start_ts = int(
            (datetime.strptime(target_date, "%Y-%m-%d") - timedelta(days=5)).timestamp()
        )

    end_ts = int(
        (datetime.strptime(target_date, "%Y-%m-%d") + timedelta(days=1)).timestamp()
    )

    url = (
        f"https://clob.polymarket.com/prices-history"
        f"?market={token}&startTs={start_ts}&endTs={end_ts}&fidelity={FIDELITY}"
    )

    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": CLOB_UA})
            resp = urllib.request.urlopen(req, timeout=15)
            data = json.loads(resp.read())
            history = data.get("history", [])

            if not history:
                return 0, None

            rows = []
            for point in history:
                rows.append(
                    {
                        "condition_id": condition_id,
                        "station": station,
                        "target_date": target_date,
                        "ts": point["t"],
                        "price_yes": round(float(point["p"]), 4),
                    }
                )

            # Insert directly from this thread
            ok = insert_rows(rows)
            if not ok:
                return 0, "insert failed"
            return len(rows), None

        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            return 0, f"HTTP {e.code}"
        except Exception as e:
            if attempt < 2:
                time.sleep(1)
            continue

    return 0, "max retries"


# ============================================================
# STEP 4 — Parallel fetch + insert
# ============================================================
print("\n" + "=" * 60)
print(f"STEP 3 — Fetching prices ({len(to_fetch)} brackets, {MAX_WORKERS} threads)")
print("=" * 60)

all_points = 0
n_with_data = 0
n_empty = 0
errors = []
done = 0
total = len(to_fetch)
start_time = time.time()

with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
    future_to_bracket = {
        executor.submit(fetch_and_insert, b): b for b in to_fetch
    }

    for future in as_completed(future_to_bracket):
        bracket = future_to_bracket[future]
        done += 1

        try:
            n_pts, err = future.result()

            if n_pts > 0:
                all_points += n_pts
                n_with_data += 1
            else:
                n_empty += 1
                if err:
                    errors.append(
                        {
                            "condition_id": bracket["condition_id"],
                            "station": bracket["station"],
                            "date": bracket["date"],
                            "error": err,
                        }
                    )
        except Exception as e:
            n_empty += 1
            errors.append(
                {
                    "condition_id": bracket["condition_id"],
                    "station": bracket["station"],
                    "date": bracket["date"],
                    "error": str(e)[:80],
                }
            )

        if done % 200 == 0 or done == total:
            elapsed = time.time() - start_time
            rate = done / elapsed if elapsed > 0 else 0
            eta = (total - done) / rate / 60 if rate > 0 else 0
            print(
                f"  {done}/{total} ({done*100//total}%) | "
                f"{all_points} pts | {n_with_data} OK | {n_empty} empty | "
                f"{rate:.0f}/s | ETA {eta:.1f}min",
                flush=True,
            )

elapsed = time.time() - start_time

# ============================================================
# STEP 5 — Summary
# ============================================================
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
print(f"  Time: {elapsed/60:.1f} min ({elapsed:.0f}s)")
print(f"  Brackets processed: {done}")
print(f"  Brackets with data: {n_with_data} ({n_with_data*100//done if done else 0}%)")
print(f"  Brackets empty: {n_empty}")
print(f"  Total price points: {all_points}")
print(f"  Avg points/bracket: {all_points/n_with_data:.0f}" if n_with_data else "  N/A")
print(f"  Speed: {done/elapsed:.0f} brackets/sec")
print(f"  Errors: {len(errors)}")

if errors:
    print(f"\n  Error breakdown:")
    err_by_type = defaultdict(int)
    for e in errors:
        err_by_type[e.get("error", "unknown")] += 1
    for etype, count in sorted(err_by_type.items(), key=lambda x: -x[1]):
        print(f"    {etype}: {count}")

# Save results summary
summary = {
    "timestamp": datetime.now().isoformat(),
    "elapsed_sec": round(elapsed),
    "brackets_total": done,
    "brackets_with_data": n_with_data,
    "brackets_empty": n_empty,
    "total_points": all_points,
    "errors": len(errors),
    "by_station": dict(by_station),
}
print(f"\n  Summary: {json.dumps(summary)}")
