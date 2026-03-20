"""
export_data.py — Exporte backtest.db → JSON pour le frontend
Produit :
  - backtest_stats.json  : summary + cities + daily_detail
  - best_strategy.json   : inchangé si déjà produit par backtest.py
"""
import sqlite3, json, os, subprocess
from datetime import datetime, timezone
from collections import defaultdict

DB   = os.path.join(os.path.dirname(__file__), "backtest.db")
PUB  = os.path.join(os.path.dirname(__file__), "../frontend/public")


def c_to_f(c):
    return round(c * 9/5 + 32)


def predict_bracket(gfs_temp_c, bracket_temp, bracket_op, unit):
    """Prédit YES ou NO pour un bracket donné la prévision GFS."""
    g = c_to_f(gfs_temp_c) if unit == "F" else gfs_temp_c
    if bracket_op == "lte":
        return "YES" if g <= bracket_temp else "NO"
    elif bracket_op == "gte":
        return "YES" if g >= bracket_temp else "NO"
    elif bracket_op == "range":
        return "YES" if bracket_temp <= g < bracket_temp + 2 else "NO"
    else:
        return "YES" if abs(g - bracket_temp) < 0.5 else "NO"


def export():
    if not os.path.exists(DB):
        print("backtest.db not found")
        return

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    now = datetime.now(timezone.utc).isoformat()

    # ── 1. Summary ────────────────────────────────────────────────────
    nm = conn.execute("SELECT COUNT(*) FROM poly_markets").fetchone()[0]
    nw = conn.execute("SELECT COUNT(*) FROM actual_temps").fetchone()[0]
    ng = conn.execute("SELECT COUNT(*) FROM gfs_forecasts").fetchone()[0]
    nc = conn.execute("SELECT COUNT(DISTINCT station) FROM poly_markets").fetchone()[0]

    # ── 2. Cities with bias per horizon ───────────────────────────────
    city_rows = conn.execute("""
        SELECT pm.city, pm.station, pm.unit,
               COUNT(DISTINCT pm.date) as n_dates,
               MIN(pm.date) as first_date, MAX(pm.date) as last_date
        FROM poly_markets pm
        JOIN actual_temps at ON pm.station = at.station AND pm.date = at.date
        GROUP BY pm.city
        ORDER BY n_dates DESC
    """).fetchall()

    cities = {}
    for r in city_rows:
        city, station = r["city"], r["station"]
        bias = {}
        for lead in [0, 1, 2, 3]:
            row = conn.execute("""
                SELECT ROUND(AVG(gf.temp_max_c - at.temp_max_c), 2) as mean_bias,
                       ROUND(AVG(ABS(gf.temp_max_c - at.temp_max_c)), 2) as mae,
                       ROUND(AVG(CASE WHEN ABS(gf.temp_max_c - at.temp_max_c) <= 1 THEN 1.0 ELSE 0.0 END), 3) as pct1,
                       COUNT(*) as n
                FROM gfs_forecasts gf
                JOIN actual_temps at ON gf.station = at.station AND gf.target_date = at.date
                WHERE gf.station = ? AND gf.lead_days = ?
            """, (station, lead)).fetchone()
            if row and row["n"] > 0:
                bias[f"j{lead}"] = {
                    "mean": row["mean_bias"],
                    "mae": row["mae"],
                    "pct_within_1": row["pct1"],
                    "n": row["n"],
                }
        cities[city] = {
            "station": station,
            "unit": r["unit"],
            "n_dates": r["n_dates"],
            "first_date": r["first_date"],
            "last_date": r["last_date"],
            "bias": bias,
        }

    # ── 3. Daily detail ───────────────────────────────────────────────
    daily_detail = []
    date_station_rows = conn.execute("""
        SELECT DISTINCT pm.station, pm.city, pm.date, pm.unit, at.temp_max_c
        FROM poly_markets pm
        JOIN actual_temps at ON pm.station = at.station AND pm.date = at.date
        ORDER BY pm.date DESC, pm.city
    """).fetchall()

    for ds in date_station_rows:
        station, city, date, unit, actual = ds["station"], ds["city"], ds["date"], ds["unit"], ds["temp_max_c"]

        # GFS forecasts for this date
        gfs_vals = {}
        for r in conn.execute(
            "SELECT lead_days, temp_max_c FROM gfs_forecasts WHERE station=? AND target_date=?",
            (station, date)
        ).fetchall():
            gfs_vals[r["lead_days"]] = r["temp_max_c"]

        # Brackets for this date
        brackets_raw = conn.execute("""
            SELECT bracket_str, bracket_temp, bracket_op, winner
            FROM poly_markets
            WHERE station=? AND date=?
            ORDER BY bracket_temp
        """, (station, date)).fetchall()

        brackets = []
        for b in brackets_raw:
            bkt = {
                "bracket": b["bracket_str"],
                "op": b["bracket_op"],
                "temp": b["bracket_temp"],
                "winner": b["winner"],
            }
            # Add GFS J-1 prediction if available
            gfs_j1 = gfs_vals.get(1)
            if gfs_j1 is not None:
                pred = predict_bracket(gfs_j1, b["bracket_temp"], b["bracket_op"], unit)
                bkt["gfs_j1_prediction"] = pred
                bkt["gfs_j1_correct"] = pred == b["winner"]
            brackets.append(bkt)

        # Find winning bracket
        winning = next((b["bracket_str"] for b in brackets_raw if b["winner"] == "YES"), None)

        row = {
            "station": station,
            "city": city,
            "date": date,
            "actual_temp": actual,
            "unit": unit,
            "winning_bracket": winning,
            "n_brackets": len(brackets),
        }
        for lead in [0, 1, 2, 3]:
            g = gfs_vals.get(lead)
            row[f"gfs_j{lead}"] = round(g, 1) if g is not None else None
            if g is not None and actual is not None:
                row[f"error_j{lead}"] = round(g - actual, 1)
        row["brackets"] = brackets
        daily_detail.append(row)

    # ── 4. Horizon summary ────────────────────────────────────────────
    horizon_summary = {}
    for lead in [0, 1, 2, 3]:
        row = conn.execute("""
            SELECT ROUND(AVG(ABS(gf.temp_max_c - at.temp_max_c)), 2) as mae,
                   ROUND(AVG(gf.temp_max_c - at.temp_max_c), 2) as bias,
                   COUNT(*) as n
            FROM gfs_forecasts gf
            JOIN actual_temps at ON gf.station = at.station AND gf.target_date = at.date
            WHERE gf.lead_days = ?
        """, (lead,)).fetchone()
        if row and row["n"] > 0:
            # Compute bracket accuracy for this lead
            correct = 0
            total = 0
            for dd in daily_detail:
                gfs_val = dd.get(f"gfs_j{lead}")
                if gfs_val is None:
                    continue
                for b in dd.get("brackets", []):
                    pred = predict_bracket(gfs_val, b["temp"], b["op"], dd["unit"])
                    if pred == b["winner"]:
                        correct += 1
                    total += 1

            horizon_summary[f"j{lead}"] = {
                "mae": row["mae"],
                "bias": row["bias"],
                "n_dates": row["n"],
                "bracket_accuracy": round(correct / total, 4) if total > 0 else None,
                "n_brackets": total,
            }

    conn.close()

    # ── 5. Write output ──────────────────────────────────────────────
    output = {
        "updated_at": now,
        "summary": {
            "n_markets": nm,
            "n_wu": nw,
            "n_gfs": ng,
            "n_cities": nc,
        },
        "cities": cities,
        "horizon_summary": horizon_summary,
        "daily_detail": daily_detail,
        # Keep legacy fields for backward compat with existing frontend
        "n_markets": nm,
        "n_actual_temps": nw,
        "n_gfs": ng,
    }

    # Legacy city list for old frontend code
    output["gfs_accuracy"] = []
    for city_name, city_data in cities.items():
        for lead_key, bias_data in city_data.get("bias", {}).items():
            lead_int = int(lead_key[1])
            output["gfs_accuracy"].append({
                "city": city_name,
                "lead_days": lead_int,
                "n": bias_data["n"],
                "mae": bias_data["mae"],
                "bias": bias_data["mean"],
                "pct_within_1c": round(bias_data["pct_within_1"] * 100, 1),
            })

    os.makedirs(PUB, exist_ok=True)
    with open(f"{PUB}/backtest_stats.json", "w") as f:
        json.dump(output, f, indent=2)

    size_kb = os.path.getsize(f"{PUB}/backtest_stats.json") / 1024
    print(f"✅ backtest_stats.json ({size_kb:.0f} KB, {nm} marchés, {len(cities)} villes, {len(daily_detail)} daily rows)")

    # Git push
    repo = os.path.join(os.path.dirname(__file__), "..")
    subprocess.run(["git", "add", "frontend/public/backtest_stats.json"], cwd=repo, check=False, capture_output=True)
    subprocess.run(["git", "commit", "-m",
                    f"data: export backtest stats {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"],
                   cwd=repo, check=False, capture_output=True)
    subprocess.run(["git", "push"], cwd=repo, check=False, capture_output=True)


if __name__ == "__main__":
    export()
