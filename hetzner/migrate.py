#!/usr/bin/env python3
"""Migrate all data from Supabase to local PostgreSQL on Hetzner.
Resilient: retries on error, resumes where it left off (ON CONFLICT DO NOTHING)."""

import json, urllib.request, urllib.error, time, os
import psycopg2
import psycopg2.extras

SB = "https://bpccdqgvkbfboqylzaie.supabase.co"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwY2NkcWd2a2JmYm9xeWx6YWllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDAzNDgwOSwiZXhwIjoyMDg5NjEwODA5fQ.rpZACnmKqPB3-WS1KeEc3JVp0oetSyx-lB9S4yMyahg"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

PROGRESS_FILE = "/opt/weather-poly/.migrate_progress"

conn = psycopg2.connect("dbname=weatherpoly user=weatherpoly password=wp_b28a537c321173b4ed40342f host=127.0.0.1")
conn.autocommit = True


def sb_get(path, retries=5):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(f"{SB}/rest/v1/{path}", headers=H)
            return json.loads(urllib.request.urlopen(req, timeout=60).read())
        except (urllib.error.HTTPError, urllib.error.URLError, Exception) as e:
            wait = 5 * (attempt + 1)
            print(f"  retry {attempt+1}/{retries} after error: {e} (wait {wait}s)", flush=True)
            time.sleep(wait)
    print(f"  SKIPPED after {retries} retries", flush=True)
    return []


def sb_get_all(path):
    rows, offset = [], 0
    while True:
        sep = "&" if "?" in path else "?"
        batch = sb_get(f"{path}{sep}offset={offset}&limit=1000")
        if not batch:
            break
        rows.extend(batch)
        offset += 1000
        print(f"  ...{len(rows)} rows", flush=True)
        time.sleep(1)
    return rows


def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {}


def save_progress(data):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(data, f)


progress = load_progress()

# 1. poly_events
if not progress.get("events_done"):
    print("=== poly_events ===")
    events = sb_get_all("poly_events?select=*&order=target_date")
    print(f"Got {len(events)} events")
    with conn.cursor() as cur:
        for e in events:
            cur.execute(
                "INSERT INTO poly_events (event_id,slug,title,city,station,target_date,created_at,closed,unit,n_brackets,total_volume) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (e["event_id"], e.get("slug"), e.get("title"), e.get("city"), e["station"],
                 e["target_date"], e.get("created_at"), e.get("closed", False),
                 e.get("unit", "C"), e.get("n_brackets", 0), e.get("total_volume", 0))
            )
    print(f"Done: {len(events)} events")
    progress["events_done"] = True
    save_progress(progress)
else:
    print("=== poly_events === SKIPPED (already done)")

# 2. poly_markets
if not progress.get("markets_done"):
    print("\n=== poly_markets ===")
    markets = sb_get_all("poly_markets?select=*&order=station,date")
    print(f"Got {len(markets)} markets")
    with conn.cursor() as cur:
        for m in markets:
            cur.execute(
                "INSERT INTO poly_markets (condition_id,station,date,bracket_str,bracket_temp,bracket_op,"
                "unit,winner,resolved,volume,clob_token_yes,clob_token_no,poly_event_id,event_title) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (m["condition_id"], m["station"], m["date"], m.get("bracket_str"),
                 m.get("bracket_temp"), m.get("bracket_op", "exact"), m.get("unit", "C"),
                 m.get("winner"), m.get("resolved", False), m.get("volume", 0),
                 m.get("clob_token_yes"), m.get("clob_token_no"),
                 m.get("poly_event_id"), m.get("event_title"))
            )
    print(f"Done: {len(markets)} markets")
    progress["markets_done"] = True
    save_progress(progress)
else:
    print("=== poly_markets === SKIPPED (already done)")

# 3. daily_temps
if not progress.get("temps_done"):
    print("\n=== daily_temps ===")
    temps = sb_get_all("daily_temps?select=*&order=date")
    print(f"Got {len(temps)} temps")
    with conn.cursor() as cur:
        for t in temps:
            cur.execute(
                "INSERT INTO daily_temps (station,date,temp_max_c,temp_max_f,source,is_polymarket_day) "
                "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (t["station"], t["date"], t.get("temp_max_c"), t.get("temp_max_f"),
                 t.get("source", "wunderground"), t.get("is_polymarket_day", True))
            )
    print(f"Done: {len(temps)} temps")
    progress["temps_done"] = True
    save_progress(progress)
else:
    print("=== daily_temps === SKIPPED (already done)")

# 4. ensemble_forecasts
if not progress.get("ensembles_done"):
    print("\n=== ensemble_forecasts ===")
    ens = sb_get_all(
        "ensemble_forecasts?select=station,target_date,fetch_ts,ensemble_model,member_id,temp_max"
        "&order=fetch_ts,ensemble_model,member_id"
    )
    print(f"Got {len(ens)} ensemble rows")
    with conn.cursor() as cur:
        for e in ens:
            cur.execute(
                "INSERT INTO ensemble_forecasts (station,target_date,fetch_ts,ensemble_model,member_id,temp_max) "
                "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (e["station"], e["target_date"], e["fetch_ts"],
                 e["ensemble_model"], e["member_id"], e.get("temp_max"))
            )
    print(f"Done: {len(ens)} ensemble rows")
    progress["ensembles_done"] = True
    save_progress(progress)
else:
    print("=== ensemble_forecasts === SKIPPED (already done)")

# 5. price_history (1.5M rows — the big one)
print("\n=== price_history (1.5M rows) ===")
price_offset = progress.get("price_offset", 0)
if price_offset > 0:
    print(f"Resuming from offset {price_offset}")
total = price_offset
errors = 0
while True:
    batch = sb_get(
        f"price_history?select=condition_id,station,target_date,ts,price_yes"
        f"&order=ts&offset={price_offset}&limit=1000"
    )
    if not batch:
        break
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO price_history (condition_id,station,target_date,ts,price_yes) "
                "VALUES %s ON CONFLICT DO NOTHING",
                [(r["condition_id"], r["station"], r["target_date"], r["ts"], r["price_yes"])
                 for r in batch]
            )
    except Exception as e:
        print(f"  DB error at offset {price_offset}: {e}", flush=True)
        errors += 1
    total += len(batch)
    price_offset += 1000
    if total % 10000 == 0:
        print(f"  ...{total}/1553448 rows ({total*100//1553448}%)", flush=True)
        progress["price_offset"] = price_offset
        save_progress(progress)
    time.sleep(0.5)

print(f"Done: {total} price rows ({errors} errors)")
progress["prices_done"] = True
save_progress(progress)

print("\n=== MIGRATION COMPLETE ===")
conn.close()
