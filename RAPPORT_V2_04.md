# RAPPORT V2_04 — État des lieux, tests API, nettoyage

**Date**: 2026-03-24

---

## 1. Inventaire Supabase

### Tables

| Table | Rows | Colonnes clés |
|-------|------|---------------|
| `cities` | 38 | name, station, wu_country, unit, lat/lon, tz |
| `poly_events` | 2 117 | event_id, slug, title, city, station, target_date, closed, unit, n_brackets, lead_days, total_volume |
| `poly_markets` | 17 170 | condition_id, bracket_str, bracket_temp, bracket_op, unit, winner, resolved, volume, clob_token_yes/no, last_trade_price |
| `daily_temps` | 1 200 | station, date, temp_max_c, source (wunderground) |

### Focus cities (London / NYC / Seoul)

| Ville | Events | Date range | Resolved | Open |
|-------|--------|------------|----------|------|
| London | 428 | 2025-01-22 → 2026-03-27 | 423 | 5 |
| NYC | 426 | 2025-01-22 → 2026-03-27 | 421 | 5 |
| Seoul | 112 | 2025-12-06 → 2026-03-27 | 108 | 4 |
| **Total focus** | **966** (46% des events) | | **952** | **14** |

### Brackets focus cities

- Total brackets DB: 17 170
- Focus cities brackets: ~7 085 (41%)
- Stations: London=EGLC, NYC=KLGA, Seoul=RKSI

### WU daily_temps couverture

| Station | Rows | Complet? |
|---------|------|----------|
| EGLC (London) | 423 | Oui (423/423 resolved events) |
| KLGA (NYC) | 223 | Partiel (223/421 — script interrompu) |
| RKSI (Seoul) | 0 | Non commencé |
| Autres | 354 | Partiel (10 stations sur 38) |

---

## 2. Test CLOB prices-history API

### Protocole
- 18 brackets testés : 6 par ville focus (2 OLD, 2 MID, 2 RECENT)
- Endpoint: `https://clob.polymarket.com/prices-history?market={token}&interval=max&fidelity=60`
- **User-Agent requis** (403 sans)

### Résultats

| Période | Resolved? | Points | Span |
|---------|-----------|--------|------|
| OLD (jan 2025) | Oui | **0** | — |
| MID (fév 2026) | Oui | **0** | — |
| RECENT (mar 27) | Non | 27-29 | ~1.1j |

### Test de rétention (dates récentes → anciennes)

| Date market | Points | Span | Notes |
|-------------|--------|------|-------|
| 2026-03-24 (aujourd'hui) | 83-92 | 3.6j | Encore disponible |
| 2026-03-23 | 106 | 4.6j | OK |
| 2026-03-22 | 94 | 4.1j | OK |
| 2026-03-21 | 85 | 4.1j | OK |
| 2026-03-20 | 96 | 4.0j | OK |
| 2026-03-15 | 49 | 2.0j | Données partielles |
| 2026-03-10 | 18 | 0.7j | Presque vide |
| 2026-03-01 | 40 | 1.6j | Données partielles |
| 2026-02-15 | **0** | — | **Purgé** |
| 2026-01-15 | **0** | — | Purgé |

### Conclusion CLOB

> **L'API CLOB purge l'historique des prix ~3 semaines après résolution.**
> - Markets resolved > 3 semaines : 0 points (données perdues)
> - Markets resolved < 1 semaine : 80-100+ points sur 3-5 jours
> - Markets ouverts : données live, ~30 points sur 1 jour
>
> **Impact critique** : pour avoir des courbes de prix, il faut les scraper AVANT résolution ou dans les jours suivant la résolution. Toute l'histoire pre-février 2026 est **définitivement perdue** via cette API.

---

## 3. Test Wunderground API

### Protocole
- 8 requêtes : London (4 dates), NYC (3 dates), Seoul (1 date)
- Endpoint: `https://api.weather.com/v1/location/{station}:9:{country}/observations/historical.json`
- Paramètres: `apiKey=...&units=m&startDate={YYYYMMDD}`

### Résultats

| Ville | Date | Obs/jour | Temp range (°C) | Champs disponibles |
|-------|------|----------|-----------------|-------------------|
| London | 2025-01-22 | 48 | 2.0 → 5.0 | Tous |
| London | 2025-06-15 | 48 | 14.0 → 24.0 | Tous |
| London | 2026-02-15 | 48 | 3.0 → 9.0 | Tous |
| London | 2026-03-22 | 48 | 4.0 → 13.0 | Tous |
| NYC | 2025-01-22 | 24 | -11.0 → -6.0 | Tous |
| NYC | 2026-02-15 | 28 | -1.0 → 4.0 | Tous |
| NYC | 2026-03-22 | 31 | 6.0 → 14.0 | Tous |
| Seoul | 2026-02-15 | 48 | -1.0 → 8.0 | Tous |

### Champs disponibles (44 total)

**Exploitables pour modèle** :
- `temp` — température (°C avec units=m)
- `dewPt` — point de rosée
- `rh` — humidité relative (%)
- `pressure` — pression atmosphérique (hPa)
- `wspd` — vitesse du vent (km/h)
- `gust` — rafales
- `wdir` / `wdir_cardinal` — direction du vent
- `vis` — visibilité
- `feels_like` — température ressentie
- `heat_index` / `wc` — indice de chaleur / wind chill
- `clds` — couverture nuageuse
- `precip_total` / `precip_hrly` / `snow_hrly` — précipitations
- `uv_index` — index UV
- `wx_phrase` — description météo texte

### Conclusion Wunderground

> **API fiable, données riches, historique illimité.**
> - 24-48 observations par jour (toutes les 30-60 min)
> - Données disponibles depuis jan 2025 et avant
> - 44 champs par observation, dont ~15 exploitables pour un modèle prédictif
> - `precip_total` souvent null mais les autres champs sont toujours remplis
> - Pas de limite de rétention visible (testé jusqu'à jan 2025)

---

## 4. Nettoyage effectué

### Fichiers supprimés (préservés dans git commit `ab870e7`)

| Fichier | Taille | Type |
|---------|--------|------|
| polymarket_RAW_ALL_EVENTS.json | 96 MB | Dump brut 2316 events |
| polymarket_FINAL_INVENTORY.json | 12 MB | Inventaire 2117 events classifiés |
| polymarket_CITY_SUMMARY.json | 85 KB | Résumé par ville |
| polymarket_CLASSIFIED.json | 37 KB | Classification par catégorie |
| polymarket_PRICE_TEST.json | 2 KB | Test de prix |
| scrape_polymarket.py | 21 KB | Scraper initial |
| finalize_scrape.py | 5 KB | Post-processing |
| v2_02_fill_gaps.py | 18 KB | Remplissage gaps |
| v2_02_final_inventory.py | 10 KB | Inventaire final |
| v2_02_fix_gaps.py | 9 KB | Fix gaps |
| v2_02_rebuild.py | 11 KB | Rebuild |
| v2_03_insert.py | 11 KB | Insert Supabase |
| v2_04_fetch_wu.py | 11 KB | Fetch WU v1 |
| v2_04_fetch_wu_v2.py | 8 KB | Fetch WU v2 |
| RAPPORT_V2_00-03.md | ~23 KB | Anciens rapports |
| CONTEXT_V2.md | 8 KB | Contexte |

**Espace libéré** : ~109 MB

---

## 5. Plan recommandé V2_05

### Priorité 1 : Compléter les données manquantes

1. **Finir le fetch WU pour les 3 focus cities**
   - KLGA (NYC) : 198 dates manquantes (223/421)
   - RKSI (Seoul) : 108 dates manquantes (0/108)
   - EGLC (London) : complet

2. **Scraper les prix CLOB en continu** (urgent)
   - Les prix sont purgés ~3 semaines après résolution
   - Mettre en place un cron job (Edge Function ou pg_cron) qui scrape toutes les 6h
   - Stocker dans une table `price_snapshots(market_id, timestamp, price_yes, price_no)`
   - Priorité : les ~14 markets ouverts des focus cities

### Priorité 2 : Enrichir les features WU

3. **Stocker les observations horaires complètes** (pas juste temp_max)
   - Créer table `hourly_obs(station, datetime, temp, dewpt, rh, pressure, wspd, gust, wdir, precip, clouds, uv)`
   - Backfill pour toutes les dates des focus cities
   - Ça donne ~48 features temporelles par jour au lieu d'une seule (temp_max)

### Priorité 3 : Modèle de base

4. **Construire le dataset d'entraînement**
   - Joindre poly_markets (brackets + outcomes) avec daily_temps (temp actuelle)
   - Feature engineering : temp J-1, J-2, J-3, tendance, écart à la moyenne saisonnière
   - Target : bracket winner (binary) ou prix final

5. **Premier modèle simple**
   - Régression logistique ou XGBoost sur les brackets résolus
   - Évaluation : accuracy, Brier score, profit simulé
