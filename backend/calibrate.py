"""
calibrate.py — Biais GFS par ville
------------------------------------
Après chaque batch de résolutions, calcule le biais moyen GFS par ville.
bias = gfs_mean_prédit - temp_réelle

Sorties :
- city_bias.json : correction à appliquer par ville
- Rapport Telegram si biais > 1.5°C sur une ville avec > 5 trades
"""

import json
import os
import sqlite3
import requests
from datetime import datetime, timezone
from collections import defaultdict

DB_PATH    = os.path.join(os.path.dirname(__file__), "tracker.db")
BIAS_FILE  = os.path.join(os.path.dirname(__file__), "city_bias.json")
WU_BASE    = "https://www.wunderground.com/history/daily/{station}/date/{date}"

# Station aéroport par ville (pour scraper la vraie temp)
CITY_STATIONS = {
    "Madrid":       "LEMD",
    "Paris":        "LFPG",
    "London":       "EGLC",
    "NYC":          "KLGA",
    "Chicago":      "KMDW",
    "Toronto":      "CYYZ",
    "Seoul":        "RKSI",
    "Tokyo":        "RJTT",
    "Singapore":    "WSSS",
    "Buenos Aires": "SAEZ",
    "Miami":        "KMIA",
    "Taipei":       "RCTP",
}

BIAS_WARN_THRESHOLD = 1.5   # °C — biais > 1.5°C = alerte
MIN_TRADES_FOR_BIAS = 5     # minimum de trades pour calculer un biais fiable


def load_resolved_trades(conn):
    """Lit les trades résolus avec leurs données GFS."""
    rows = conn.execute("""
        SELECT city, date, gfs_mean, result, direction, bracket
        FROM paper_trades
        WHERE result != 'pending' AND gfs_mean IS NOT NULL
        ORDER BY city, date
    """).fetchall()
    return rows


def update_actual_temps(conn):
    """
    Tente de récupérer la vraie température pour les trades résolus
    qui n'ont pas encore de actual_temp.
    Utilise l'API Open-Meteo Archive (données observées).
    """
    # S'assurer que la colonne existe
    try:
        conn.execute("ALTER TABLE paper_trades ADD COLUMN actual_temp REAL")
        conn.commit()
    except Exception:
        pass  # déjà existe

    rows = conn.execute("""
        SELECT condition_id, city, date
        FROM paper_trades
        WHERE result != 'pending' AND actual_temp IS NULL
    """).fetchall()

    if not rows:
        return

    # Group par ville+date pour batch les requêtes
    city_dates = defaultdict(list)
    for cid, city, date in rows:
        city_dates[(city, date)].append(cid)

    print(f"  🌡 Récupération des températures réelles pour {len(city_dates)} ville-dates...")

    # Import cities pour les coordonnées
    cities_f = os.path.join(os.path.dirname(__file__), "cities.json")
    with open(cities_f) as f:
        cities = {c["name"]: c for c in json.load(f)}

    for (city, date), cids in city_dates.items():
        city_info = cities.get(city)
        if not city_info:
            continue

        try:
            r = requests.get(
                "https://archive-api.open-meteo.com/v1/archive",
                params={
                    "latitude": city_info["lat"],
                    "longitude": city_info["lon"],
                    "start_date": date,
                    "end_date": date,
                    "daily": "temperature_2m_max",
                    "timezone": city_info["tz"]
                },
                timeout=10
            )
            data = r.json()
            temps = data.get("daily", {}).get("temperature_2m_max", [])
            if not temps or temps[0] is None:
                continue

            actual_temp = float(temps[0])
            # Convertit en °F si nécessaire
            if city_info["unit"] == "F":
                actual_temp = actual_temp * 9/5 + 32

            for cid in cids:
                conn.execute(
                    "UPDATE paper_trades SET actual_temp=? WHERE condition_id=?",
                    (round(actual_temp, 1), cid)
                )
            conn.commit()
            print(f"    ✅ {city} {date}: temp réelle = {actual_temp:.1f}°{'F' if city_info['unit']=='F' else 'C'}")

        except Exception as e:
            print(f"    ⚠ {city} {date}: {e}")


def compute_bias(conn):
    """Calcule le biais moyen GFS par ville."""
    rows = conn.execute("""
        SELECT city, gfs_mean, actual_temp
        FROM paper_trades
        WHERE result != 'pending'
          AND gfs_mean IS NOT NULL
          AND actual_temp IS NOT NULL
        ORDER BY city
    """).fetchall()

    by_city = defaultdict(list)
    for city, gfs_mean, actual_temp in rows:
        bias = gfs_mean - actual_temp  # positif = GFS trop chaud, négatif = GFS trop froid
        by_city[city].append(bias)

    results = {}
    for city, biases in by_city.items():
        n = len(biases)
        mean_bias = sum(biases) / n
        std_bias = (sum((b - mean_bias)**2 for b in biases) / n) ** 0.5
        results[city] = {
            "n": n,
            "bias_mean": round(mean_bias, 2),   # °C : GFS prédit X°C de trop
            "bias_std": round(std_bias, 2),
            "reliable": n >= MIN_TRADES_FOR_BIAS,
            "status": "✅" if abs(mean_bias) < BIAS_WARN_THRESHOLD else ("⚠️" if abs(mean_bias) < 3.0 else "❌")
        }
    return results


def save_bias(bias_data):
    """Sauvegarde city_bias.json."""
    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "cities": bias_data
    }
    with open(BIAS_FILE, "w") as f:
        json.dump(output, f, indent=2)
    print(f"  💾 city_bias.json mis à jour ({len(bias_data)} villes)")


def run():
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M UTC')}] Calibrate démarré")

    if not os.path.exists(DB_PATH):
        print("  ⚠ tracker.db introuvable")
        return

    conn = sqlite3.connect(DB_PATH)

    # 1. Récupère les vraies températures depuis Open-Meteo Archive
    update_actual_temps(conn)

    # 2. Calcule les biais
    bias_data = compute_bias(conn)

    if not bias_data:
        print("  ℹ Pas encore assez de données pour calculer les biais")
        conn.close()
        return

    # 3. Sauvegarde
    save_bias(bias_data)

    # 4. Rapport console
    print("\n  📊 Biais GFS par ville :")
    for city, b in sorted(bias_data.items(), key=lambda x: abs(x[1]["bias_mean"]), reverse=True):
        reliable = "✓" if b["reliable"] else f"({b['n']}/{MIN_TRADES_FOR_BIAS})"
        print(f"    {b['status']} {city:15}: {b['bias_mean']:+.1f}°C ± {b['bias_std']:.1f} (N={b['n']}) {reliable}")

    conn.close()
    print("  ✓ Calibrate terminé")


if __name__ == "__main__":
    run()
