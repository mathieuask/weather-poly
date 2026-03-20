"""
export_data.py — Exporte backtest.db → JSON pour le frontend
"""
import sqlite3, json, os, subprocess
from datetime import datetime, timezone

DB   = os.path.join(os.path.dirname(__file__), "backtest.db")
PUB  = os.path.join(os.path.dirname(__file__), "../frontend/public")

def export():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    now  = datetime.now(timezone.utc).isoformat()

    # ── 1. Stats globales ──────────────────────────────────────────────
    nm  = conn.execute("SELECT COUNT(*) FROM poly_markets").fetchone()[0]
    nt  = conn.execute("SELECT COUNT(*) FROM actual_temps").fetchone()[0]
    ng  = conn.execute("SELECT COUNT(*) FROM gfs_forecasts").fetchone()[0]

    cities = [dict(r) for r in conn.execute("""
        SELECT city, COUNT(*) as n_markets,
               MIN(date) as date_from, MAX(date) as date_to,
               station
        FROM poly_markets WHERE resolved=1
        GROUP BY city ORDER BY n_markets DESC
    """).fetchall()]

    # ── 2. Biais GFS par ville (J-1/J-2/J-3) ─────────────────────────
    biases = [dict(r) for r in conn.execute("""
        SELECT g.station,
               pm.city,
               g.lead_days,
               COUNT(*)                          AS n,
               ROUND(AVG(g.temp_max_c - at.temp_max_c), 2)  AS mean_bias,
               ROUND(AVG(ABS(g.temp_max_c - at.temp_max_c)), 2) AS mae,
               ROUND(MIN(g.temp_max_c - at.temp_max_c), 2)  AS min_bias,
               ROUND(MAX(g.temp_max_c - at.temp_max_c), 2)  AS max_bias
        FROM gfs_forecasts g
        JOIN actual_temps at ON at.station = g.station AND at.date = g.target_date
        JOIN (SELECT DISTINCT station, city FROM poly_markets) pm ON pm.station = g.station
        GROUP BY g.station, g.lead_days
        ORDER BY pm.city, g.lead_days
    """).fetchall()]

    # ── 3. Résumé température réelle vs GFS J-1 par ville ─────────────
    accuracy = [dict(r) for r in conn.execute("""
        SELECT pm.city, g.lead_days,
               COUNT(*) as n,
               ROUND(AVG(ABS(g.temp_max_c - at.temp_max_c)), 2) as mae,
               ROUND(AVG(g.temp_max_c - at.temp_max_c), 2) as bias,
               ROUND(AVG(CASE WHEN ABS(g.temp_max_c-at.temp_max_c) <= 1 THEN 1.0 ELSE 0.0 END)*100,1) as pct_within_1c
        FROM gfs_forecasts g
        JOIN actual_temps at ON at.station=g.station AND at.date=g.target_date
        JOIN (SELECT DISTINCT station, city FROM poly_markets) pm ON pm.station=g.station
        GROUP BY pm.city, g.lead_days
        ORDER BY pm.city, g.lead_days
    """).fetchall()]

    stats = {
        "updated_at":     now,
        "n_markets":      nm,
        "n_actual_temps": nt,
        "n_gfs":          ng,
        "cities":         cities,
        "gfs_bias":       biases,
        "gfs_accuracy":   accuracy,
    }

    with open(f"{PUB}/backtest_stats.json", "w") as f:
        json.dump(stats, f, indent=2)
    print(f"✅ backtest_stats.json ({nm} marchés, {nt} temps, {ng} GFS)")

    # ── 4. best_strategy.json (placeholder avant backtest.py) ─────────
    bs_path = f"{PUB}/best_strategy.json"
    if not os.path.exists(bs_path):
        placeholder = {
            "updated_at": now,
            "status": "pending",
            "message": "Backtest en cours — résultats disponibles après backtest.py",
            "n_markets": nm,
        }
        with open(bs_path, "w") as f:
            json.dump(placeholder, f, indent=2)
        print("✅ best_strategy.json (placeholder)")

    conn.close()

    # Push GitHub
    os.chdir(os.path.join(os.path.dirname(__file__), ".."))
    subprocess.run(["git", "add", "frontend/public/backtest_stats.json",
                    "frontend/public/best_strategy.json"], check=False)
    subprocess.run(["git", "commit", "-m",
                    f"data: export backtest stats {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"],
                   check=False, capture_output=True)
    subprocess.run(["git", "push"], check=False, capture_output=True)
    print("✅ Push GitHub OK")

if __name__ == "__main__":
    export()
