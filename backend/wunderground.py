"""
wunderground.py — Lecture des données Weather Underground
----------------------------------------------------------
Même source que Polymarket pour résoudre ses marchés.
API key extraite du JS WU — peut être révoquée. Détection auto.

Usage :
    from wunderground import get_daily_max, get_observations
"""

import requests
import time
from datetime import datetime, timezone

WU_API  = "https://api.weather.com/v1/location/{station}:9:{country}/observations/historical.json"
WU_KEY  = "e1f10a1e78da46f5b10a1e78da96f525"
TIMEOUT = 15

_key_dead = False  # Flag global si clé révoquée


def _extract_key_from_wu() -> str | None:
    """Extrait la clé API depuis le JS Weather Underground en cas de rotation."""
    try:
        r = requests.get(
            "https://www.wunderground.com/weather/kr/incheon/RKSI",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10
        )
        import re
        m = re.search(r'"apiKey"\s*:\s*"([a-f0-9]{32})"', r.text)
        if m:
            return m.group(1)
    except Exception:
        pass
    return None


def get_observations(station: str, country: str, date: str, _retry=True) -> list[dict]:
    """
    Récupère toutes les observations horaires Wunderground.
    date = 'YYYYMMDD'
    Retourne liste de dicts. Retourne [] si clé morte ou rate-limit.
    """
    global WU_KEY, _key_dead

    if _key_dead:
        return []

    url = WU_API.format(station=station, country=country)
    try:
        r = requests.get(
            url,
            params={"apiKey": WU_KEY, "units": "m", "startDate": date},
            timeout=TIMEOUT
        )

        # Clé révoquée ou auth error
        if r.status_code in (401, 403):
            print(f"  ⚠ WU API key révoquée (HTTP {r.status_code}) — tentative extraction...")
            new_key = _extract_key_from_wu()
            if new_key and new_key != WU_KEY:
                print(f"  ✅ Nouvelle clé extraite : {new_key[:8]}...")
                WU_KEY = new_key
                if _retry:
                    return get_observations(station, country, date, _retry=False)
            else:
                print(f"  ❌ Impossible d'extraire une nouvelle clé WU")
                _key_dead = True
                return []

        r.raise_for_status()
        data = r.json()
        obs = data.get("observations", [])

        # Détection rate-limit silencieux (retourne vide sans erreur HTTP)
        if not obs and r.status_code == 200:
            # Peut être rate-limit ou données absentes pour cette date
            # On ne logue pas en spam mais on retourne []
            return []

        return obs

    except requests.exceptions.Timeout:
        print(f"  ⚠ WU timeout {station}/{date}")
        return []
    except Exception as e:
        print(f"  ⚠ WU API error {station}/{date}: {e}")
        return []


def get_daily_max(station: str, country: str, date: str) -> float | None:
    """
    Température maximale de la journée selon Wunderground.
    = exactement ce que Polymarket lit pour résoudre.
    date = 'YYYYMMDD'
    """
    obs = get_observations(station, country, date)
    if not obs:
        return None
    temps = []
    for o in obs:
        t = o.get("temp")
        if t is not None:
            try:
                temps.append(float(t))
            except (TypeError, ValueError):
                pass
    return max(temps) if temps else None


def get_daily_min(station: str, country: str, date: str) -> float | None:
    """Température minimale de la journée."""
    obs = get_observations(station, country, date)
    if not obs:
        return None
    temps = [float(o["temp"]) for o in obs if o.get("temp") is not None]
    return min(temps) if temps else None


def get_current_max(station: str, country: str, tz_name: str) -> float | None:
    """Max observé depuis minuit heure locale jusqu'à maintenant."""
    import pytz
    tz = pytz.timezone(tz_name)
    today_local = datetime.now(tz).strftime("%Y%m%d")
    return get_daily_max(station, country, today_local)


def is_key_alive() -> bool:
    """Vérifie si la clé WU est toujours fonctionnelle."""
    obs = get_observations("RKSI", "KR", "20260101")
    return len(obs) > 0
