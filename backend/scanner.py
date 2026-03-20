"""
weather-poly scanner
--------------------
1. Récupère tous les marchés météo actifs sur Polymarket (tag: temperature)
2. Pour chaque ville, récupère les membres GFS (30) + ICON (39) + ECMWF (50) via Open-Meteo
3. Calcule la probabilité pondérée par bracket (GFS 0.8× / ICON 1.0× / ECMWF 1.2×)
4. Applique la correction de biais GFS par ville (city_bias.json)
5. Compare au prix AMM → edge = model_prob - marché
6. Sauvegarde dans signals.json
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
MIN_EDGE  = 5.0       # % minimum pour afficher
MIN_LIQ   = 100.0     # $ minimum liquidité
MIN_HOURS = 6.0       # heures avant résolution
# Blend poids : ECMWF 1.2× / ICON 1.0× / GFS 0.8× (doc recommandation)
MODEL_WEIGHTS = {"gfs_seamless": 0.8, "icon_seamless": 1.0, "ecmwf_ifs025": 1.2}

# Confiance GFS par ville (high/medium/low) — pour badge et futur filtre live
CITY_CONFIDENCE = {
    "nyc":           "high",
    "chicago":       "high",
    "toronto":       "high",
    "london":        "high",
    "paris":         "high",
    "dallas":        "high",
    "atlanta":       "high",
    "seattle":       "high",
    "munich":        "high",
    "warsaw":        "medium",
    "madrid":        "medium",
    "miami":         "medium",
    "buenos aires":  "medium",
    "tokyo":         "medium",
    "milan":         "medium",
    "tel aviv":      "medium",
    "wellington":    "medium",
    "ankara":        "medium",
    "shanghai":      "medium",
    "sao paulo":     "medium",
    "lucknow":       "medium",
    "seoul":         "low",    # biais froid suspecté +3-4°C
    "singapore":     "low",    # biais froid tropical +2-3°C
    "taipei":        "low",    # subtropical
}

GFS_UNRELIABLE: set = set()  # blacklist manuelle (vide = toutes actives)
OUT_FILE      = os.path.join(os.path.dirname(__file__), "signals.json")
FRONTEND_OUT  = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "signals.json")
CITIES_F      = os.path.join(os.path.dirname(__file__), "cities.json")
TRACKER_DB    = os.path.join(os.path.dirname(__file__), "tracker.db")

# ─── CHARGEMENT DES VILLES ────────────────────────────────────────────────────
with open(CITIES_F) as f:
    CITIES = json.load(f)
CITY_MAP = {c["key"].lower(): c for c in CITIES}
# Reverse map: station ICAO → city info (pour matching via resolutionSource)
STATION_MAP = {c["station"]: c for c in CITIES}

def c_to_f(c): return c * 9/5 + 32
def f_to_c(f): return (f - 32) * 5/9


def _log_price_snapshots(brackets):
    """Stocke un snapshot de prix dans tracker.db pour backtest futur."""
    import sqlite3
    try:
        conn = sqlite3.connect(TRACKER_DB)
        ts = datetime.now(timezone.utc).isoformat()
        for b in brackets:
            conn.execute("""
                INSERT OR IGNORE INTO price_snapshots
                (condition_id, timestamp, price_yes, best_bid, best_ask, liquidity)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (b.get("condition_id", ""), ts,
                  b.get("p_yes", 0) / 100, b.get("best_bid", 0),
                  b.get("best_ask", 0), b.get("liquidity", 0)))
        conn.commit()
        conn.close()
    except Exception:
        pass  # don't break scanner if DB issue


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
    min_close = now + timedelta(hours=MIN_HOURS)  # filtre résolution imminente

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
        # ET qui ne résolvent pas dans moins de MIN_HOURS (obs réelle > GFS)
        if not (min_close < end <= cutoff):
            continue

        title = event.get("title", "")
        date_str = end.strftime("%Y-%m-%d")

        # ── Identification de la ville ──
        # Priorité 1 : extraire la station ICAO depuis resolutionSource (source de vérité)
        city_key = None
        city_info = None
        station_code = None
        wu_path = None

        res_source = event.get("resolutionSource", "") or ""
        wu_match = re.search(r'wunderground\.com/history/daily/([a-z]{2})/.+?/([A-Z]{4})', res_source)
        if wu_match:
            station_code = wu_match.group(2)  # ICAO code
            wu_path = res_source.split("wunderground.com/history/daily/")[-1].rstrip("/")
            if station_code in STATION_MAP:
                city_info = STATION_MAP[station_code]
                city_key = city_info["key"].lower()
            else:
                # Station trouvée mais pas dans cities.json — log et skip
                city_title = re.search(r'[Hh]ighest temperature in (.+?) on ', title)
                city_name = city_title.group(1) if city_title else title
                print(f"  ⚠ Ville détectée mais non configurée: {city_name} ({station_code})")
                continue

        # Priorité 2 : fallback matching par nom dans le titre
        if not city_key:
            for cname in CITY_MAP:
                if cname in title.lower():
                    city_key = cname
                    city_info = CITY_MAP[city_key]
                    break

        if not city_key:
            continue
        if city_key in GFS_UNRELIABLE:
            continue

        key = f"{city_key}_{date_str}"

        if key not in markets_by_city_date:
            # Station code : priorité resolutionSource, fallback cities.json
            if not station_code:
                station_code = city_info["station"]
            if not wu_path:
                wu_path = f"{station_code}/{station_code}"

            markets_by_city_date[key] = {
                "city": city_info["name"],
                "city_key": city_key,
                "date": date_str,
                "unit": city_info["unit"],
                "lat": city_info["lat"],
                "lon": city_info["lon"],
                "station": station_code,
                "wu_path": wu_path,
                "event_slug": event.get("slug", ""),
                "event_title": title,
                "wunderground": f"https://www.wunderground.com/history/daily/{wu_path}",
                "brackets": []
            }

        # 1re passe : parse uniquement les brackets OUVERTS (closed=False)
        # closed=True = bracket fermé définitivement par Polymarket (pas juste vide)
        all_raw = []
        for m in event.get("markets", []):
            # Filtre strict : on ne garde que les brackets réellement ouverts
            if m.get("closed", False):
                continue

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
            # Spread data from Gamma API
            best_bid = float(m.get("bestBid") or 0)
            best_ask = float(m.get("bestAsk") or 0)

            all_raw.append({
                "question": question,
                "temp": bracket["temp"],
                "op": bracket["op"],
                "p_yes": round(p_yes * 100, 1),
                "liquidity": round(liq, 0),
                "condition_id": m.get("conditionId", ""),
                "best_bid": round(best_bid, 4),
                "best_ask": round(best_ask, 4),
            })

        if not all_raw:
            continue

        # Identifie les extrêmes parmi les brackets OUVERTS (tous, même liq=0)
        all_raw.sort(key=lambda b: b["temp"])
        if all_raw:
            all_raw[0]["op"] = "lte"   # le plus bas ouvert = toujours "or below"
            all_raw[-1]["op"] = "gte"  # le plus haut ouvert = toujours "or higher"

        # Stocke tous les brackets ouverts (closed=False), même liq=0
        markets_by_city_date[key]["all_brackets"] = [
            {
                "label": format_bracket(b["temp"], b["op"], city_info["unit"]),
                "temp": b["temp"],
                "op": b["op"],
                "p_yes": b["p_yes"],
                "liquidity": b["liquidity"]
            }
            for b in all_raw
        ]

        # 2e passe : filtre liquidité + prix extrêmes, ajoute au marché
        for b in all_raw:
            if b["liquidity"] < MIN_LIQ:
                continue
            if b["p_yes"] >= 99 or b["p_yes"] <= 1:
                continue
            markets_by_city_date[key]["brackets"].append(b)

    # Log price snapshots pour backtest futur
    all_brackets = []
    for mkt in markets_by_city_date.values():
        all_brackets.extend(mkt.get("brackets", []))
    if all_brackets:
        _log_price_snapshots(all_brackets)

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
def fetch_ensemble(model, n_members, lat, lon, date_str, tz="UTC"):
    """Récupère N membres d'un modèle ensemble via Open-Meteo. Retourne °C."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "temperature_2m_max",
        "models": model,
        "forecast_days": 7,
        "timezone": tz,
        "cell_selection": "nearest"  # Utilise la cellule la plus proche (idéal pour aéroports)
    }
    r = requests.get(OMAPI, params=params, timeout=15)
    r.raise_for_status()
    data = r.json()
    daily = data.get("daily", {})
    dates = daily.get("time", [])
    if date_str not in dates:
        return []
    idx = dates.index(date_str)
    members = []
    for i in range(1, n_members + 1):
        key = f"temperature_2m_max_member{i:02d}"
        vals = daily.get(key, [])
        if idx < len(vals) and vals[idx] is not None:
            members.append(float(vals[idx]))
    return members


def fetch_gfs_ensemble(lat, lon, date_str, tz="UTC"):
    """
    Récupère les membres de chaque modèle ensemble.
    Retourne (raw_models: dict, model_str: str, model_stats: dict).
    raw_models = {model_name: (members_list, weight)}
    """
    raw = {}
    for model, weight in MODEL_WEIGHTS.items():
        n_max = {"gfs_seamless": 30, "icon_seamless": 39, "ecmwf_ifs025": 50}[model]
        try:
            members = fetch_ensemble(model, n_max, lat, lon, date_str, tz)
            if members:
                raw[model] = (members, weight)
        except Exception as e:
            print(f"  ⚠ {model} indispo: {e}")

    if not raw:
        return None, "no_data", {}

    stats = {}
    all_members = []
    for model, (members, weight) in raw.items():
        mean = sum(members) / len(members)
        std  = (sum((x - mean)**2 for x in members) / len(members)) ** 0.5
        stats[model] = {"n": len(members), "mean": round(mean, 1), "std": round(std, 2)}
        all_members.extend(members)

    parts = []
    for m, key in [("GFS","gfs_seamless"),("ICON","icon_seamless"),("ECMWF","ecmwf_ifs025")]:
        if key in raw:
            parts.append(f"{m}:{len(raw[key][0])}")
    model_str = "+".join(parts)

    # Stocke raw_models pour le calcul pondéré dans gfs_bracket_prob
    return raw, model_str, stats


def _weighted_prob(raw_models, temp, op, unit):
    """
    Calcule la probabilité pondérée à partir de chaque modèle.
    P = Σ(weight_i × P_i) / Σ(weight_i)
    Déterministe, pas de random.
    """
    def single_model_prob(members_c, temp, op, unit):
        n = len(members_c)
        if n == 0:
            return None
        if unit == "F":
            members = [c_to_f(t) for t in members_c]
        else:
            members = members_c[:]
        if op == "lte":
            count = sum(1 for t in members if t <= temp + 0.5)
        elif op == "gte":
            count = sum(1 for t in members if t >= temp - 0.5)
        else:
            count = sum(1 for t in members if temp - 0.5 <= t < temp + 0.5)
        return count / n

    total_weight = 0.0
    weighted_sum = 0.0
    for model, (members, weight) in raw_models.items():
        p = single_model_prob(members, temp, op, unit)
        if p is not None:
            weighted_sum += weight * p
            total_weight += weight

    if total_weight == 0:
        return None
    return round(weighted_sum / total_weight * 100, 1)


def _raw_to_flat_members(raw_models):
    """Flatten raw_models to a simple list of members (°C) for stats/display."""
    members = []
    for model, (m, w) in raw_models.items():
        members.extend(m)
    return members


# ─── CORRECTION BIAIS GFS ────────────────────────────────────────────────────
BIAS_FILE = os.path.join(os.path.dirname(__file__), "city_bias.json")

def _load_city_bias():
    """Charge city_bias.json (calculé par calibrate.py)."""
    if not os.path.exists(BIAS_FILE):
        return {}
    try:
        with open(BIAS_FILE) as f:
            data = json.load(f)
        return data.get("cities", {})
    except Exception:
        return {}

_CITY_BIAS = _load_city_bias()


def _apply_bias_correction(raw_models, city_name):
    """
    Corrige le biais GFS sur chaque membre (en °C).
    bias_mean = GFS_prédit - réel.
    Si bias_mean = -2.9 → GFS trop froid → on ajoute 2.9°C à chaque membre.
    Correction prudente : demi-biais si n < 5, plein biais si reliable.
    """
    bias_info = _CITY_BIAS.get(city_name, {})
    if not bias_info:
        return raw_models

    bias_mean = bias_info.get("bias_mean", 0)
    n = bias_info.get("n", 0)
    reliable = bias_info.get("reliable", False)

    if abs(bias_mean) < 0.5:
        return raw_models  # biais négligeable

    if reliable:
        correction = bias_mean
    elif n >= 3 and abs(bias_mean) > 1.5:
        correction = bias_mean * 0.5  # prudent : demi-correction
    else:
        return raw_models  # pas assez de données

    print(f"    🔧 Correction biais {city_name}: {correction:+.1f}°C (n={n}, reliable={reliable})")

    corrected = {}
    for model, (members, weight) in raw_models.items():
        corrected[model] = ([m - correction for m in members], weight)
    return corrected


# ─── ÉTAPE 3 : calcule proba GFS par bracket ─────────────────────────────────
def gfs_bracket_prob(raw_models_or_members, temp, op, unit):
    """
    Calcule la probabilité (%) que la température tombe dans le bracket.
    Accepte soit un dict raw_models (pondéré) soit une liste de membres (legacy).
    """
    if isinstance(raw_models_or_members, dict):
        return _weighted_prob(raw_models_or_members, temp, op, unit)

    # Legacy fallback: simple list of members
    members_c = raw_models_or_members
    n = len(members_c)
    if n == 0:
        return None

    if unit == "F":
        members = [c_to_f(t) for t in members_c]
    else:
        members = members_c[:]

    if op == "lte":
        count = sum(1 for t in members if t <= temp + 0.5)
    elif op == "gte":
        count = sum(1 for t in members if t >= temp - 0.5)
    else:
        count = sum(1 for t in members if temp - 0.5 <= t < temp + 0.5)

    return round(count / n * 100, 1)


# ─── ÉTAPE 4 : calcule les signaux ───────────────────────────────────────────
def compute_signals(market, raw_models):
    """
    Pour chaque bracket d'un marché, calcule l'edge et génère un signal.
    raw_models: dict {model: (members, weight)} ou list (legacy).
    Retourne une liste de signaux triés par |edge| décroissant.
    """
    signals = []
    unit = market["unit"]

    # Flat members pour les stats d'affichage
    if isinstance(raw_models, dict):
        members_c_flat = _raw_to_flat_members(raw_models)
    else:
        members_c_flat = raw_models

    for b in market["brackets"]:
        gfs_prob = gfs_bracket_prob(raw_models, b["temp"], b["op"], unit)
        if gfs_prob is None:
            continue

        edge = round(gfs_prob - b["p_yes"], 1)

        if abs(edge) < MIN_EDGE:
            continue

        direction = "YES" if edge > 0 else "NO"
        entry_price = b["p_yes"] / 100 if direction == "YES" else (100 - b["p_yes"]) / 100
        payout = round(1 - entry_price, 2)

        prob_win = gfs_prob / 100 if direction == "YES" else (100 - gfs_prob) / 100
        ev = round(prob_win * payout - (1 - prob_win) * entry_price, 3)

        # Edge réel tenant compte du spread bid/ask
        best_bid = b.get("best_bid", 0)
        best_ask = b.get("best_ask", 0)
        spread = round(best_ask - best_bid, 4) if best_ask and best_bid else None
        if direction == "YES" and best_ask > 0:
            # On achète YES au ask → edge réel = gfs_prob - ask*100
            entry_real = best_ask
            edge_real = round(gfs_prob - best_ask * 100, 1)
        elif direction == "NO" and best_bid > 0:
            # On achète NO = on vend YES au bid → entry = 1-bid, edge réel = (100-gfs_prob) - (1-bid)*100
            entry_real = 1 - best_bid
            edge_real = round((100 - gfs_prob) - (1 - best_bid) * 100, 1)
        else:
            entry_real = entry_price
            edge_real = edge

        event_slug = market.get("event_slug", "")
        temps = members_c_flat if unit == "C" else [c_to_f(t) for t in members_c_flat]
        sym = "°C" if unit == "C" else "°F"

        # Réécrire la question pour les brackets extrêmes (lte/gte)
        raw_q = b["question"]
        if b["op"] == "lte":
            # Remplace "be X°C" → "be X°C or below" seulement si pas déjà présent
            if "or below" not in raw_q and "or higher" not in raw_q:
                display_q = re.sub(r"(be -?\d+°[CF])", r"\1 or below", raw_q)
            else:
                display_q = raw_q
        elif b["op"] == "gte":
            if "or higher" not in raw_q and "or below" not in raw_q:
                display_q = re.sub(r"(be -?\d+°[CF])", r"\1 or higher", raw_q)
            else:
                display_q = raw_q
        else:
            display_q = raw_q

        is_endband = b["op"] in ("lte", "gte")
        city_key_lower = market["city"].lower()
        confidence = CITY_CONFIDENCE.get(city_key_lower, "medium")

        # Qualité du signal : strong / medium / weak
        if abs(edge) >= 20 and b["liquidity"] >= 500 and is_endband and confidence != "low":
            quality = "strong"
        elif abs(edge) >= 10 and b["liquidity"] >= 200:
            quality = "medium"
        else:
            quality = "weak"

        signals.append({
            "city":          market["city"],
            "date":          market["date"],
            "bracket":       format_bracket(b["temp"], b["op"], unit),
            "is_endband":    is_endband,
            "quality":       quality,
            "city_confidence": confidence,
            "direction":     direction,
            "gfs_prob":      gfs_prob,
            "market_prob":   b["p_yes"],
            "edge":          edge,
            "edge_real":     edge_real,
            "spread":        spread,
            "entry_price":   round(entry_price, 3),
            "entry_real":    round(entry_real, 3),
            "payout":        payout,
            "ev":            ev,
            "liquidity":     b["liquidity"],
            "question":      display_q,
            "condition_id":  b["condition_id"],
            "station":       market.get("station", ""),
            "wunderground":  f"{market['wunderground']}/date/{market['date']}?units=m",
            "poly_url":      f"https://polymarket.com/event/{event_slug}" if event_slug else "",
            "all_brackets":  market.get("all_brackets", []),
            "event_title":   market.get("event_title", ""),
            "gfs_min":       round(min(temps), 1),
            "gfs_max":       round(max(temps), 1),
            "gfs_mean":      round(sum(temps) / len(temps), 1),
            "gfs_unit":      sym,
            "gfs_members":   len(temps),
            "gfs_values":    [round(t, 1) for t in sorted(temps)],
            "windy_url":     f"https://www.windy.com/{market['lat']}/{market['lon']}?gfs,{market['date']},{market['lat']},{market['lon']}"
        })

    # Tri : end-band EN PREMIER, puis par |edge| décroissant
    return sorted(signals, key=lambda x: (not x["is_endband"], -abs(x["edge"])))


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

        # Cache GFS+ECMWF blend par ville+date
        tz = CITY_MAP[market["city_key"]]["tz"]
        cache_key = f"{lat}_{lon}_{date}"
        if cache_key not in gfs_cache:
            print(f"→ Ensemble {city} {date} (tz={tz})...")
            try:
                raw_models, model_str, model_stats = fetch_gfs_ensemble(lat, lon, date, tz)
            except Exception as e:
                print(f"  ⚠ Erreur ensemble pour {city} {date}: {e}")
                raw_models, model_str, model_stats = None, "error", {}
            gfs_cache[cache_key] = (raw_models, model_str, model_stats)
        else:
            raw_models, model_str, model_stats = gfs_cache[cache_key]

        if not raw_models:
            print(f"  ⚠ Pas de données ensemble pour {city} {date}")
            continue

        # Correction biais GFS (FIX 3)
        raw_models = _apply_bias_correction(raw_models, city)

        members_flat = _raw_to_flat_members(raw_models)
        unit = market["unit"]
        temps = members_flat if unit == "C" else [c_to_f(t) for t in members_flat]
        mean = round(sum(temps) / len(temps), 1)
        sym = "°C" if unit == "C" else "°F"
        print(f"  {city}: {len(members_flat)} membres ({model_str}) | moy={mean}{sym} | range={min(temps):.0f}–{max(temps):.0f}{sym}")

        # Étape 3+4 : signaux
        signals = compute_signals(market, raw_models)
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
