"""
wunderground.py — Lecture des données Weather Underground
----------------------------------------------------------
Utilise la même API que le site wunderground.com (même source que Polymarket).
API key publique intégrée dans le JS de wunderground.com.

Usage :
    from wunderground import get_daily_max, get_observations
"""

import requests
from datetime import datetime, timezone
from functools import lru_cache

WU_API   = "https://api.weather.com/v1/location/{station}:9:{country}/observations/historical.json"
WU_KEY   = "e1f10a1e78da46f5b10a1e78da96f525"
TIMEOUT  = 12


def get_observations(station: str, country: str, date: str) -> list[dict]:
    """
    Récupère toutes les observations horaires Wunderground pour une station/date.
    date = 'YYYYMMDD'
    Retourne liste de dicts avec clés : temp (°C), wspd, dewPt, obsTimeUtc, etc.
    """
    url = WU_API.format(station=station, country=country)
    try:
        r = requests.get(
            url,
            params={"apiKey": WU_KEY, "units": "m", "startDate": date},
            timeout=TIMEOUT
        )
        r.raise_for_status()
        return r.json().get("observations", [])
    except Exception as e:
        print(f"  ⚠ WU API error {station}/{date}: {e}")
        return []


def get_daily_max(station: str, country: str, date: str) -> float | None:
    """
    Retourne la température maximale enregistrée sur la journée.
    Identique à ce que Polymarket lit sur Wunderground pour résoudre.
    date = 'YYYYMMDD' (ex: '20260320')
    """
    obs = get_observations(station, country, date)
    temps = [o.get("temp") for o in obs if o.get("temp") is not None]
    if not temps:
        return None
    return max(float(t) for t in temps)


def get_current_max(station: str, country: str, tz_name: str) -> float | None:
    """
    Retourne le max observé DEPUIS MINUIT HEURE LOCALE jusqu'à maintenant.
    Utile pour la stratégie intraday.
    """
    import pytz
    tz = pytz.timezone(tz_name)
    today_local = datetime.now(tz).strftime("%Y%m%d")
    return get_daily_max(station, country, today_local)
