"""
metar.py — Scanner METAR intraday pour Polymarket Weather
-----------------------------------------------------------
Stratégie : après l'heure de pic probable pour chaque ville,
on compare la temp max observée depuis minuit avec les brackets actifs.
Si la temp max est CONFIRMÉE (pic passé + temp descendante), on
identifie les brackets impossibles → signal NO quasi-certain.

API : aviationweather.gov (gratuit, sans clé, 100 req/min)
Mise à jour : toutes les 30 min (METAR émis toutes les ~30 min)

Heure de pic probable par ville en mars (heure locale) :
Seoul       : 14h-15h30 KST
Tokyo       : 13h30-15h JST
Paris       : 14h30-16h CET
London      : 14h-15h30 GMT
NYC         : 14h-15h30 EST
Chicago     : 14h30-16h CST
Toronto     : 14h-15h30 EST
Madrid      : 15h-16h30 CET  (timezone offset avancé)
Singapore   : 14h-15h SGT (très stable)
Miami       : 14h-15h30 EST
Buenos Aires: 14h-15h30 ART
Taipei      : 13h30-15h CST
"""

import json
import os
import requests
from datetime import datetime, timezone, timedelta
import pytz

BASE_DIR    = os.path.dirname(__file__)
CITIES_FILE = os.path.join(BASE_DIR, "cities.json")
METAR_OUT   = os.path.join(BASE_DIR, "metar.json")
SIGNALS_FILE= os.path.join(BASE_DIR, "signals.json")

METAR_API   = "https://aviationweather.gov/api/data/metar"

# Heure à partir de laquelle le pic est probablement passé (heure locale)
PEAK_CONFIRMED_HOUR = {
    "RKSI": 16,   # Seoul — pic à 14-15h30, confirmé à 16h
    "RJTT": 16,   # Tokyo
    "LFPG": 17,   # Paris
    "EGLC": 16,   # London
    "KLGA": 16,   # NYC
    "KORD": 17,   # Chicago
    "CYYZ": 16,   # Toronto
    "LEMD": 17,   # Madrid (timezone en retard, pic tardif)
    "WSSS": 15,   # Singapore — très stable, pic à 14h
    "KMIA": 16,   # Miami
    "SAEZ": 16,   # Buenos Aires
    "RCTP": 16,   # Taipei
    "KDAL": 17,   # Dallas
    "KATL": 16,   # Atlanta
    "KSEA": 17,   # Seattle
    "NZWN": 16,   # Wellington
    "LLBG": 16,   # Tel Aviv
    "ZSPD": 16,   # Shanghai
    "LIMC": 17,   # Milan
    "LTAC": 17,   # Ankara
    "SBGR": 16,   # Sao Paulo
    "EDDM": 17,   # Munich
    "VILK": 16,   # Lucknow
    "EPWA": 16,   # Warsaw
}


def fetch_metar(stations: list[str]) -> dict:
    """
    Récupère les dernières observations METAR pour une liste de stations.
    Retourne dict {station: {temp_c, dewpoint_c, time_utc, raw}}
    """
    ids = ",".join(stations)
    try:
        r = requests.get(
            METAR_API,
            params={"ids": ids, "format": "json", "hours": 1},
            timeout=10
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  ⚠ METAR API error: {e}")
        return {}

    result = {}
    for obs in data:
        station = obs.get("icaoId", "")
        temp = obs.get("temp")      # °C
        dewp = obs.get("dewp")      # °C
        obs_time = obs.get("obsTime", "")
        raw = obs.get("rawOb", "")
        if station and temp is not None:
            result[station] = {
                "temp_c": float(temp),
                "dewpoint_c": float(dewp) if dewp is not None else None,
                "obs_time": obs_time,
                "raw": raw
            }
    return result


def run():
    now_utc = datetime.now(timezone.utc)
    print(f"[{now_utc.strftime('%H:%M UTC')}] METAR scanner démarré")

    with open(CITIES_FILE) as f:
        cities = json.load(f)

    # Charge les signaux actifs
    try:
        with open(SIGNALS_FILE) as f:
            signals_data = json.load(f)
        signals = signals_data if isinstance(signals_data, list) else signals_data.get("signals", [])
    except Exception:
        signals = []

    results = []

    for city in cities:
        station = city["station"]
        tz_name = city["tz"]
        city_name = city["name"]

        tz = pytz.timezone(tz_name)
        now_local = datetime.now(tz)
        local_hour = now_local.hour

        peak_hour = PEAK_CONFIRMED_HOUR.get(station, 16)

        # Seulement après l'heure de pic probable
        if local_hour < peak_hour:
            continue

        print(f"  📡 {city_name} ({station}) — {local_hour}h locale ≥ {peak_hour}h pic → vérif METAR")

        # Max depuis minuit via Wunderground (même source que Polymarket)
        from wunderground import get_current_max
        wu_country = city.get("wu_country", "")
        daily_max = get_current_max(station, wu_country, tz_name)
        if daily_max is None:
            print(f"    ⚠ Pas de données IEM pour {station}")
            continue

        print(f"    🌡 Max depuis minuit : {daily_max}°C")

        # Trouve les signaux actifs pour cette ville (date = aujourd'hui local)
        today_local = now_local.strftime("%Y-%m-%d")
        city_signals = [
            s for s in signals
            if s.get("city") == city_name and s.get("date") == today_local
        ]

        if not city_signals:
            print(f"    ℹ Aucun signal actif pour {city_name} aujourd'hui")
            continue

        # Identifie les brackets impossibles
        for s in city_signals:
            bracket_temp = None
            op = None

            # Parse le bracket
            import re
            m = re.search(r'(-?\d+)', s.get("bracket", ""))
            if m:
                bracket_temp = float(m.group(1))

            bracket_str = s.get("bracket", "")
            if "or below" in bracket_str or "lte" in bracket_str:
                op = "lte"
            elif "or higher" in bracket_str or "gte" in bracket_str:
                op = "gte"
            else:
                op = "exact"

            if bracket_temp is None:
                continue

            # Détermine si le bracket est impossible
            impossible = False
            direction = None

            if op == "gte" and daily_max < bracket_temp - 0.5:
                # Max observé < seuil → impossible d'atteindre ce bracket
                impossible = True
                direction = "NO"
            elif op == "lte" and daily_max > bracket_temp + 0.5:
                # Max observé > seuil → ce bracket ne peut pas gagner
                impossible = True
                direction = "NO"
            elif op == "exact":
                if abs(daily_max - bracket_temp) > 0.5:
                    impossible = True
                    direction = "NO"

            if impossible:
                market_prob = s.get("market_prob", 0)
                entry_price = 1 - market_prob / 100  # prix NO = 1 - prix YES
                edge = market_prob  # edge = probabilité marché (on gagne si ça ne se réalise pas)

                results.append({
                    "city": city_name,
                    "station": station,
                    "date": today_local,
                    "bracket": bracket_str,
                    "daily_max_observed": daily_max,
                    "bracket_temp": bracket_temp,
                    "op": op,
                    "direction": direction,
                    "market_prob_yes": market_prob,
                    "entry_price_no": round(entry_price, 3),
                    "edge_pct": round(edge, 1),
                    "confidence": "HIGH",  # max observé confirme l'impossibilité
                    "local_hour": local_hour,
                    "condition_id": s.get("condition_id", ""),
                    "poly_url": s.get("poly_url", ""),
                    "wunderground": s.get("wunderground", "")
                })
                print(f"    🎯 {bracket_str} → NO quasi-certain (max obs={daily_max}°C, bracket={bracket_temp}°C) edge={edge:.1f}%")

    # Sauvegarde
    output = {
        "generated_at": now_utc.isoformat(),
        "signals_count": len(results),
        "signals": results
    }
    with open(METAR_OUT, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n  💾 {len(results)} signaux METAR intraday sauvegardés → metar.json")
    if results:
        print("  ⚠ ATTENTION: Ces signaux sont quasi-certains — vérifier avant de trader!")


if __name__ == "__main__":
    run()
