"""
weather-poly scanner
--------------------
1. Récupère tous les marchés météo actifs sur Polymarket (tag: temperature)
2. Pour chaque ville, récupère les 30 membres GFS via Open-Meteo
3. Calcule la probabilité par bracket
4. Compare au prix AMM → edge = GFS_prob - marché
5. Sauvegarde dans signals.json
"""

import json
import re
import os
import requests
from datetime import datetime, timezone, timedelta

# ─── CONFIG ───────────────────────────────────────────────────────────────────
POLY_API  = "https://gamma-api.polymarket.com"
OMAPI     = "https://ensemble-api.open-meteo.com/v1/ensemble"
MIN_EDGE  = 5.0       # % minimum pour afficher un signal
MIN_LIQ   = 100.0     # liquidité minimum du sous-marché
OUT_FILE  = os.path.join(os.path.dirname(__file__), "signals.json")
CITIES_F  = os.path.join(os.path.dirname(__file__), "cities.json")

# ─── CHARGEMENT DES VILLES ────────────────────────────────────────────────────
with open(CITIES_F) as f:
    CITIES = json.load(f)
CITY_MAP = {c["poly_name"].lower(): c for c in CITIES}

def c_to_f(c): return c * 9/5 + 32
def f_to_c(f): return (f - 32) * 5/9


# ─── ÉTAPE 1 : récupère marchés Polymarket ────────────────────────────────────
def fetch_poly_markets(days_ahead=3):
    """
    Récupère tous les marchés météo actifs qui closent dans les prochains jours.
    Retourne une liste de dicts : { city, date, brackets: [{question, temp, op, p_yes, liquidity}] }
    """
    url = f"{POLY_API}/events?active=true&limit=200&tag_slug=temperature&order=endDate&ascending=false"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    events = r.json()

    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=days_ahead)

    markets_by_city_date = {}

    for event in events:
        end_str = event.get("endDate", "")
        if not end_str:
            continue
        try:
            end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
        except:
            continue

        # On garde uniquement les marchés qui closent dans les prochains jours
        if not (now < end <= cutoff):
            continue

        title = event.get("title", "")
        date_str = end.strftime("%Y-%m-%d")

        # Identifie la ville depuis le titre
        city_key = None
        for cname in CITY_MAP:
            if cname in title.lower():
                city_key = cname
                break
        if not city_key:
            continue

        city_info = CITY_MAP[city_key]
        key = f"{city_key}_{date_str}"

        if key not in markets_by_city_date:
            markets_by_city_date[key] = {
                "city": city_info["name"],
                "city_key": city_key,
                "date": date_str,
                "unit": city_info["unit"],
                "lat": city_info["lat"],
                "lon": city_info["lon"],
                "station": city_info["station"],
                "wunderground": f"https://www.wunderground.com/history/daily/{city_info['station']}",
                "brackets": []
            }

        # Parse chaque sous-marché
        for m in event.get("markets", []):
            question = m.get("question", "")
            prices = m.get("outcomePrices", ["0", "0"])
            liq = float(m.get("liquidity", 0) or 0)

            # outcomePrices peut être une string JSON ou une liste
            if isinstance(prices, str):
                try:
                    prices = json.loads(prices)
                except:
                    continue
            try:
                p_yes = float(prices[0])
            except:
                continue

            if liq < MIN_LIQ:
                continue

            # Filtre marchés déjà résolus (prix à 0% ou 100%)
            if p_yes >= 0.99 or p_yes <= 0.01:
                continue

            # Parse la température et l'opérateur depuis la question
            # Ex: "Will the highest temperature in Madrid be 15°C on March 20?"
            # Ex: "Will the highest temperature in NYC be 12°C or below on..."
            # Ex: "Will the highest temperature in NYC be 22°C or higher on..."
            bracket = parse_bracket(question, city_info["unit"])
            if bracket is None:
                continue

            markets_by_city_date[key]["brackets"].append({
                "question": question,
                "temp": bracket["temp"],
                "op": bracket["op"],   # "exact", "lte", "gte"
                "p_yes": round(p_yes * 100, 1),
                "liquidity": round(liq, 0),
                "condition_id": m.get("conditionId", "")
            })

    return list(markets_by_city_date.values())


def parse_bracket(question, unit):
    """
    Extrait la température et l'opérateur d'une question Polymarket.
    Retourne { temp: float, op: 'exact'|'lte'|'gte' } ou None
    """
    q = question.lower()
    symbol = "°c" if unit == "C" else "°f"

    # Pattern: "be 15°c or below"
    m = re.search(r'be (\d+)' + re.escape(symbol) + r' or below', q)
    if m:
        return {"temp": float(m.group(1)), "op": "lte"}

    # Pattern: "be 22°c or higher"
    m = re.search(r'be (\d+)' + re.escape(symbol) + r' or higher', q)
    if m:
        return {"temp": float(m.group(1)), "op": "gte"}

    # Pattern: "be 15°c on" (exact)
    m = re.search(r'be (\d+)' + re.escape(symbol) + r'(?: on| in)', q)
    if m:
        return {"temp": float(m.group(1)), "op": "exact"}

    # Fallback: cherche juste le nombre avant °
    m = re.search(r'be (\d+)' + re.escape(symbol[1:]), q)
    if m:
        return {"temp": float(m.group(1)), "op": "exact"}

    return None


# ─── ÉTAPE 2 : récupère ensemble GFS via Open-Meteo ──────────────────────────
def fetch_gfs_ensemble(lat, lon, date_str):
    """
    Récupère les 30 membres GFS pour temperature_2m_max à la date donnée.
    Retourne une liste de floats (°C).
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "temperature_2m_max",
        "models": "gfs_seamless",
        "forecast_days": 7,
        "timezone": "UTC"
    }
    r = requests.get(OMAPI, params=params, timeout=15)
    r.raise_for_status()
    data = r.json()
    daily = data.get("daily", {})
    dates = daily.get("time", [])

    if date_str not in dates:
        return None

    idx = dates.index(date_str)

    members = []
    for i in range(1, 31):
        key = f"temperature_2m_max_member{i:02d}"
        vals = daily.get(key, [])
        if idx < len(vals) and vals[idx] is not None:
            members.append(vals[idx])

    return members if members else None


# ─── ÉTAPE 3 : calcule proba GFS par bracket ─────────────────────────────────
def gfs_bracket_prob(members_c, temp, op, unit):
    """
    Calcule la probabilité (%) que la température tombe dans le bracket.
    members_c : températures en °C
    temp      : seuil du bracket
    op        : 'exact' | 'lte' | 'gte'
    unit      : 'C' | 'F'
    """
    n = len(members_c)
    if n == 0:
        return None

    # Convertit les membres en l'unité du marché
    if unit == "F":
        members = [c_to_f(t) for t in members_c]
    else:
        members = members_c[:]

    if op == "lte":
        count = sum(1 for t in members if t <= temp + 0.5)
    elif op == "gte":
        count = sum(1 for t in members if t >= temp - 0.5)
    else:  # exact: bracket [temp-0.5, temp+0.5)
        count = sum(1 for t in members if temp - 0.5 <= t < temp + 0.5)

    return round(count / n * 100, 1)


# ─── ÉTAPE 4 : calcule les signaux ───────────────────────────────────────────
def compute_signals(market, members_c):
    """
    Pour chaque bracket d'un marché, calcule l'edge et génère un signal.
    Retourne une liste de signaux triés par |edge| décroissant.
    """
    signals = []
    unit = market["unit"]

    for b in market["brackets"]:
        gfs_prob = gfs_bracket_prob(members_c, b["temp"], b["op"], unit)
        if gfs_prob is None:
            continue

        edge = round(gfs_prob - b["p_yes"], 1)

        if abs(edge) < MIN_EDGE:
            continue

        direction = "YES" if edge > 0 else "NO"
        entry_price = b["p_yes"] / 100 if direction == "YES" else (100 - b["p_yes"]) / 100
        payout = round(1 - entry_price, 2)

        # EV: prob_win × gain - prob_lose × mise
        # Pour YES : prob_win = gfs_prob
        # Pour NO  : prob_win = 1 - gfs_prob (on gagne si la temp N'est PAS dans ce bracket)
        prob_win = gfs_prob / 100 if direction == "YES" else (100 - gfs_prob) / 100
        ev = round(prob_win * payout - (1 - prob_win) * entry_price, 3)

        signals.append({
            "city":        market["city"],
            "date":        market["date"],
            "bracket":     format_bracket(b["temp"], b["op"], unit),
            "direction":   direction,
            "gfs_prob":    gfs_prob,
            "market_prob": b["p_yes"],
            "edge":        edge,
            "entry_price": round(entry_price, 3),
            "payout":      payout,
            "ev":          ev,
            "liquidity":   b["liquidity"],
            "question":    b["question"],
            "condition_id": b["condition_id"],
            "wunderground": market["wunderground"]
        })

    return sorted(signals, key=lambda x: abs(x["edge"]), reverse=True)


def format_bracket(temp, op, unit):
    sym = "°C" if unit == "C" else "°F"
    if op == "lte":
        return f"≤{int(temp)}{sym}"
    elif op == "gte":
        return f"≥{int(temp)}{sym}"
    else:
        return f"{int(temp)}{sym}"


# ─── MAIN ─────────────────────────────────────────────────────────────────────
def run():
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M UTC')}] Scanner démarré")

    # Étape 1 : marchés Polymarket
    print("→ Récupération des marchés Polymarket...")
    poly_markets = fetch_poly_markets(days_ahead=3)
    print(f"  {len(poly_markets)} marchés trouvés ({sum(len(m['brackets']) for m in poly_markets)} brackets)")

    all_signals = []
    gfs_cache = {}

    for market in poly_markets:
        city = market["city"]
        date = market["date"]
        lat, lon = market["lat"], market["lon"]

        # Cache GFS par ville+date
        cache_key = f"{lat}_{lon}_{date}"
        if cache_key not in gfs_cache:
            print(f"→ GFS {city} {date}...")
            members = fetch_gfs_ensemble(lat, lon, date)
            gfs_cache[cache_key] = members
        else:
            members = gfs_cache[cache_key]

        if not members:
            print(f"  ⚠ Pas de données GFS pour {city} {date}")
            continue

        unit = market["unit"]
        temps = members if unit == "C" else [c_to_f(t) for t in members]
        mean = round(sum(temps) / len(temps), 1)
        sym = "°C" if unit == "C" else "°F"
        print(f"  {city}: {len(members)} membres GFS | moy={mean}{sym} | range={min(temps):.0f}–{max(temps):.0f}{sym}")

        # Étape 3+4 : signaux
        signals = compute_signals(market, members)
        all_signals.extend(signals)

        for s in signals[:3]:
            print(f"    🎯 {s['bracket']:>8} → {s['direction']} | GFS={s['gfs_prob']:.0f}% vs Marché={s['market_prob']:.0f}% | Edge={s['edge']:+.1f}%")

    # Tri final par |edge|
    all_signals.sort(key=lambda x: abs(x["edge"]), reverse=True)

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_signals": len(all_signals),
        "signals": all_signals
    }

    with open(OUT_FILE, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # Copie aussi dans frontend/public/ pour le dashboard local
    public_out = os.path.join(os.path.dirname(__file__), "../frontend/public/signals.json")
    if os.path.exists(os.path.dirname(public_out)):
        with open(public_out, "w") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n✅ {len(all_signals)} signaux sauvegardés → {OUT_FILE}")
    print(f"\nTOP 5 SIGNAUX:")
    for s in all_signals[:5]:
        print(f"  {s['city']:12} {s['bracket']:>8} | {s['direction']} | GFS={s['gfs_prob']:.0f}% vs {s['market_prob']:.0f}% | Edge={s['edge']:+.1f}% | EV={s['ev']:+.3f}")

    return output


if __name__ == "__main__":
    run()
