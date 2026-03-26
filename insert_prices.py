#!/usr/bin/env python3
"""Insert price history from JSON using Supabase REST API with service role key."""

import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

SUPABASE_URL = "https://bpccdqgvkbfboqylzaie.supabase.co"
SERVICE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwY2NkcWd2a2JmYm9xeWx6YWllIiwi"
    "cm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDAzNDgwOSwiZXhwIjoyMDg5"
    "NjEwODA5fQ.rpZACnmKqPB3-WS1KeEc3JVp0oetSyx-lB9S4yMyahg"
)


def _log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"[{ts}] {msg}", flush=True)


def sb_post(table, data):
    body = json.dumps(data).encode()
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates",
    }
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{table}",
        data=body, headers=headers, method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=60)
        return True
    except urllib.error.HTTPError as e:
        if e.code == 409:
            return True  # duplicates, OK
        _log(f"  HTTP {e.code}: {e.read().decode()[:200]}")
        return False
    except Exception as e:
        _log(f"  Error: {e}")
        return False


def main():
    _log("Loading prices from JSON...")
    with open("/tmp/backfill_prices_new.json") as f:
        prices = json.load(f)
    _log(f"Loaded {len(prices)} price points")

    batch_size = 500
    total_batches = (len(prices) + batch_size - 1) // batch_size
    inserted = 0
    failed = 0

    for i in range(0, len(prices), batch_size):
        batch = prices[i:i + batch_size]
        batch_num = i // batch_size + 1

        ok = sb_post("price_history", batch)
        if ok:
            inserted += len(batch)
        else:
            failed += len(batch)

        if batch_num % 50 == 0 or batch_num == total_batches:
            _log(f"  Batch {batch_num}/{total_batches}: {inserted:,} inserted, {failed:,} failed")

        time.sleep(0.05)

    _log(f"DONE: {inserted:,} inserted, {failed:,} failed")


if __name__ == "__main__":
    main()
