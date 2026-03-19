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
import shutil
import requests
from datetime import datetime, timezone, timedelta

# ─── CONFIG ───────────────────────────────────────────────────────────────────
POLY_API  = "https://gamma-api.polymarket.com"
OMAPI     = "https://ensemble-api.open-meteo.com/v1/ensemble"
MIN_EDGE  = 5.0       # % minimum pour afficher un signal
MIN_LIQ   = 100.0     # liquidité minimum du sous-marché
OUT_FILE      = os.path.join(os.path.dirname(__file__), "signals.json")
FRONTEND_OUT  = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "signals.json")
CITIES_F      = os.path.join(os.path.dirname(__file__), "cities.json")

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
        except (ValueError, TypeError):
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
                "event_slug": event.get("slug", ""),
                "wunderground": f"https://www.wunderground.com/history/daily/{city_info['station']}",
                "brackets": []
            }

        # 1re passe : parse TOUS les brackets (sans filtre liq) pour trouver les vrais extrêmes
        all_raw = []
        for m in event.get("markets", []):
            question = m.get("question", "")
            prices = m.get("outcomePrices", ["0", "0"])
            liq = float(m.get("liquidity", 0) or 0)
            if isinstance(prices, str):
                try:
                    prices = json.loads(prices)
                except (json.JSONDecodeError, ValueError):
                    continue
            try:
                p_yes = float(prices[0])
            except (ValueError, IndexError, TypeError):
                continue
            bracket = parse_bracket(question, city_info["unit"])
            if bracket is None:
                continue
            all_raw.append({
                "question": question,
                "temp": bracket["temp"],
                "op": bracket["op"],
                "p_yes": round(p_yes * 100, 1),
                "liquidity": round(liq, 0),
                "condition_id": m.get("conditionId", "")
            })

        if not all_raw:
            continue

        # Identifie les extrêmes parmi les brackets AFFICHÉS sur Polymarket (liq > 0)
        # = exactement ce que le site montre, sans les brackets à $0
        all_raw.sort(key=lambda b: b["temp"])
        shown = [b for b in all_raw if b["liquidity"] > 0]

        if shown:
            shown[0]["op"] = "lte"   # le plus bas affiché = toujours "or below"
            shown[-1]["op"] = "gte"  # le plus haut affiché = toujours "or higher"

        # Stocke uniquement les brackets visibles sur Polymarket (liq > 0)
        markets_by_city_date[key]["all_brackets"] = [
            {
                "label": format_bracket(b["temp"], b["op"], city_info["unit"]),
                "temp": b["temp"],
                "op": b["op"],
                "p_yes": b["p_yes"],
                "liquidity": b["liquidity"]
            }
            for b in all_raw if b["liquidity"] > 0
        ]

        # 2e passe : filtre liquidité + prix extrêmes, ajoute au marché
        for b in all_raw:
            if b["liquidity"] < MIN_LIQ:
                continue
            if b["p_yes"] >= 99 or b["p_yes"] <= 1:
                continue
            markets_by_city_date[key]["brackets"].append(b)

    return list(markets_by_city_date.values())


def parse_bracket(question, unit):
    """
    Extrait la température et l'opérateur d'une question Polymarket.
    Retourne { temp: float, op: 'exact'|'lte'|'gte' } ou None
    """
    q = question.lower()
    symbol = "°c" if unit == "C" else "°f"

    # Pattern: "be 15°c or below"
    m = re.search(r'be (-?\d+)' + re.escape(symbol) + r' or below', q)
    if m:
        return {"temp": float(m.group(1)), "op": "lte"}

    # Pattern: "be 22°c or higher"
    m = re.search(r'be (-?\d+)' + re.escape(symbol) + r' or higher', q)
    if m:
        return {"temp": float(m.group(1)), "op": "gte"}

    # Pattern: "be 15°c on" (exact)
    m = re.search(r'be (-?\d+)' + re.escape(symbol) + r'(?: on| in)', q)
    if m:
        return {"temp": float(m.group(1)), "op": "exact"}

    # Fallback: cherche juste le nombre avant °
    m = re.search(r'be (-?\d+)' + re.escape(symbol[1:]), q)
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

        event_slug = market.get("event_slug", "")
        signals.append({
            "city":          market["city"],
            "date":          market["date"],
            "bracket":       format_bracket(b["temp"], b["op"], unit),
            "direction":     direction,
            "gfs_prob":      gfs_prob,
            "market_prob":   b["p_yes"],
            "edge":          edge,
            "entry_price":   round(entry_price, 3),
            "payout":        payout,
            "ev":            ev,
            "liquidity":     b["liquidity"],
            "question":      b["question"],
            "condition_id":  b["condition_id"],
            "wunderground":  f"{market['wunderground']}/date/{market['date']}?units=m",
            "poly_url":      f"https://polymarket.com/event/{event_slug}" if event_slug else "",
            "all_brackets":  market.get("all_brackets", [])
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
    poly_markets = fetch_poly_markets(days_ahead=7)
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
            try:
                members = fetch_gfs_ensemble(lat, lon, date)
            except Exception as e:
                print(f"  ⚠ Erreur GFS pour {city} {date}: {e}")
                members = None
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

    # Copie vers le frontend
    os.makedirs(os.path.dirname(FRONTEND_OUT), exist_ok=True)
    shutil.copy2(OUT_FILE, FRONTEND_OUT)
    print(f"📋 Copié vers {FRONTEND_OUT}")

    print(f"\n✅ {len(all_signals)} signaux sauvegardés → {OUT_FILE}")
    print(f"\nTOP 5 SIGNAUX:")
    for s in all_signals[:5]:
        print(f"  {s['city']:12} {s['bracket']:>8} | {s['direction']} | GFS={s['gfs_prob']:.0f}% vs {s['market_prob']:.0f}% | Edge={s['edge']:+.1f}% | EV={s['ev']:+.3f}")

    # Auto-push vers GitHub si git dispo
    _git_push(len(all_signals))

    return output


def _git_push(nb_signals: int):
    import subprocess
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    try:
        subprocess.run(["git", "add", "backend/signals.json", "frontend/public/signals.json"],
                       cwd=repo_root, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", f"data: {nb_signals} signals — {now}"],
                       cwd=repo_root, check=True, capture_output=True)
        subprocess.run(["git", "push"],
                       cwd=repo_root, check=True, capture_output=True)
        print(f"→ GitHub: {nb_signals} signaux pushés ({now})")
    except subprocess.CalledProcessError as e:
        # Pas de changements ou git non configuré → pas grave
        print(f"→ GitHub push skipped: {e.stderr.decode()[:100] if e.stderr else 'no changes'}")


if __name__ == "__main__":
    run()
