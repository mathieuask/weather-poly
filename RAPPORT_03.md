# RAPPORT 03 — Nettoyage et vérification des sources

**Date :** 2026-03-20
**Auditeur :** Claude Code (Opus 4.6)

---

## 1. Nettoyage du code

### scanner.py (636 lignes → 636 lignes)
Docstring mis à jour pour refléter le nouveau pipeline (3 modèles, pondération, biais).
Pas de code mort identifié après les modifications de la Passe 2.

**Fonctions :**
| Fonction | Rôle |
|----------|------|
| `fetch_poly_markets()` | Récupère les marchés Polymarket actifs (tag: temperature), parse les brackets |
| `parse_bracket()` | Extrait température + opérateur (lte/gte/exact) d'une question Polymarket |
| `fetch_ensemble()` | Récupère N membres d'un modèle ensemble via Open-Meteo (appel unique) |
| `fetch_gfs_ensemble()` | Orchestre la récupération des 3 modèles, retourne raw_models dict |
| `_weighted_prob()` | Calcule la probabilité pondérée par modèle (déterministe) |
| `_raw_to_flat_members()` | Aplatit raw_models en liste simple pour stats d'affichage |
| `_load_city_bias()` | Charge city_bias.json |
| `_apply_bias_correction()` | Corrige le biais GFS sur chaque membre |
| `gfs_bracket_prob()` | Dispatche vers _weighted_prob (dict) ou calcul legacy (list) |
| `compute_signals()` | Calcule edge + EV pour chaque bracket, génère les signaux |
| `format_bracket()` | Formate "≤12°C" / "≥20°F" etc. |
| `run()` | Orchestre le pipeline complet |
| `_git_push()` | Commit + push automatique vers GitHub |

### tracker.py (364 lignes, inchangé)
**Fonctions :**
| Fonction | Rôle |
|----------|------|
| `init_db()` | Crée les 3 tables (signal_log, paper_trades, resolutions) |
| `log_signal()` | INSERT dans signal_log (pas de déduplication) |
| `maybe_create_trade()` | Crée un paper trade si condition_id jamais vu |
| `check_resolutions()` | Vérifie les trades pending via CLOB + Gamma API |
| `fetch_resolution()` | Récupère l'outcome YES/NO d'un marché résolu |
| `export_results()` | Exporte trades + stats vers results.json |
| `git_push()` | Commit + push (git add -A) |
| `run()` | Orchestre le pipeline |

### wunderground.py (132 lignes, inchangé)
**Fonctions :**
| Fonction | Rôle |
|----------|------|
| `_extract_key_from_wu()` | Scrape la clé API depuis le JS Wunderground |
| `get_observations()` | Récupère les observations horaires WU pour une station/date |
| `get_daily_max()` | Retourne le max(temp) d'une journée |
| `get_daily_min()` | Retourne le min(temp) d'une journée |
| `get_current_max()` | Max depuis minuit heure locale (pour metar.py) |
| `is_key_alive()` | Vérifie si la clé WU fonctionne |

### calibrate.py (191 lignes, inchangé sauf FIX 5)
**Fonctions :**
| Fonction | Rôle |
|----------|------|
| `load_resolved_trades()` | Lit les trades résolus avec données GFS |
| `update_actual_temps()` | Récupère la vraie temp WU pour les trades sans actual_temp |
| `compute_bias()` | Calcule bias_mean = gfs_mean - actual_temp par ville |
| `save_bias()` | Sauvegarde city_bias.json |
| `run()` | Orchestre le pipeline |

### metar.py (292 → 226 lignes, -66 lignes)
**Code mort supprimé :** `fetch_daily_max()` (Iowa State Mesonet) — fonction de 64 lignes jamais appelée. Le `run()` utilise `wunderground.get_current_max()` à la place.

**Fonctions restantes :**
| Fonction | Rôle |
|----------|------|
| `fetch_metar()` | Récupère les dernières observations METAR (aviationweather.gov) |
| `run()` | Scanne les villes post-pic, identifie les brackets impossibles |

### collect.py (500 lignes, inchangé)
**Fonctions :**
| Fonction | Rôle |
|----------|------|
| `init_db()` | Crée 3 tables dans backtest.db (poly_markets, actual_temps, gfs_forecasts) |
| `extract_station_from_event()` | Détecte la station ICAO depuis titre + description |
| `parse_bracket()` | Parse un titre de bracket (similaire à scanner.py, version séparée) |
| `fetch_all_poly_markets()` | Récupère tous les events via pagination |
| `fetch_gfs_leadtime()` | Récupère la prévision GFS J-N via Previous Runs API |
| `store_markets()` | Parse et stocke tous les marchés dans poly_markets |
| `fetch_actual_temps()` | Récupère les temps réels WU pour les marchés résolus |
| `fetch_gfs_history()` | Récupère les prévisions GFS J-1/J-2/J-3 |
| `print_stats()` | Affiche les statistiques de la DB |

### export_data.py (99 lignes, inchangé)
Fonction unique `export()` : exporte backtest.db → backtest_stats.json + best_strategy.json

### autoresearch.py (195 lignes, inchangé)
**Fonctions :**
| Fonction | Rôle |
|----------|------|
| `send_telegram()` | Envoie un message Telegram |
| `load_results()` | Charge results.json |
| `analyze()` | Analyse WR par ville, par bracket type, par edge range |
| `run()` | Orchestre et envoie le rapport |

**Total lignes : 2408 → 2343 (-65 lignes de code mort)**

---

## 2. Vérification des APIs

### A. Polymarket Gamma API ✅

- **Statut :** 200 OK
- **Events actifs température :** 200 (limite paginée) — il y en a probablement plus
- **Villes trouvées (20/20) :** Toutes les villes de cities.json sont présentes ✅
- **Champ resolutionSource :** Contient l'URL WU complète avec station ICAO (ex: `https://www.wunderground.com/history/daily/us/ny/new-york-city/KLGA`)
- **Champ description :** Contient aussi le lien WU mais le scanner le parse via regex — résultats incohérents (capture partielle pour certaines villes chinoises)

**Recommandation :** Utiliser `resolutionSource` au lieu de parser `description`. Le champ est propre, toujours présent, et contient la station ICAO exacte.

#### BUG CRITIQUE TROUVÉ — NYC jamais détecté

Le scanner matche les villes via `if cname in title.lower()` où `cname` est la clé de cities.json.

- cities.json : `"key": "new york"`
- Polymarket titre : `"Highest temperature in NYC on March 24?"`
- `"new york" in "highest temperature in nyc on march 24?"` = **False**

**NYC, le marché le plus liquide (299 marchés résolus, le plus actif), n'est JAMAIS scanné.** Le signals.json actuel confirme : **0 signal NYC** sur 180 signaux.

**Villes non couvertes** (pas dans cities.json) : Beijing, Chengdu, Chongqing, Hong Kong, Lucknow, Munich, Sao Paulo, Shenzhen, Wuhan, Warsaw, Houston, Denver, Austin, Los Angeles, San Francisco — soit **15 villes Polymarket supplémentaires** non trackées.

### B. Wunderground API ✅

| Ville | Statut | Observations | Max temp |
|-------|--------|-------------|----------|
| NYC (KLGA) | ✅ 200 | 24 obs/jour | 5°C (2026-03-19) |
| Seoul (RKSI) | ✅ 200 | 48 obs/jour | 9°C (2026-03-19) |
| Paris (LFPG) | ✅ 200 | 47 obs/jour | 17°C (2026-03-19) |

- **Clé API :** Fonctionne (`e1f10a1e78da46f5b10a1e78da96f525`)
- **Champ température :** `temp` (°C avec `units=m`)
- **Champ `max_temp` :** Présent mais contient une valeur intermédiaire (pas le vrai max journalier). Le code fait correctement `max([o['temp'] for o in obs])`.
- **Fréquence :** 24-48 observations/jour (environ toutes les 30-60 min)

### C. Open-Meteo Ensemble API ✅

| Paramètre | Attendu (code) | Réel (API) | Match |
|-----------|----------------|------------|-------|
| Membres GFS | 30 | 30 | ✅ |
| Membres ICON | 39 | 39 | ✅ |
| Membres ECMWF | 50 | 50 | ✅ |
| Latitude Seoul | 37.469 | 37.5 | ✅ (~30m écart) |
| Longitude Seoul | 126.451 | 126.5 | ✅ (~50m écart) |
| Élévation retournée | 7m (RKSI) | 5.0m | ✅ (proche) |

- **Format clés (modèle unique) :** `temperature_2m_max_member01` — correspond au parsing du code ✅
- **Format clés (multi-modèle) :** `temperature_2m_max_member01_ncep_gefs_seamless` — le code fait des appels séparés donc pas de conflit ✅
- **cell_selection=nearest :** Fonctionne, retourne la cellule la plus proche de l'aéroport

### D. METAR (aviationweather.gov) ✅

- **Statut :** 200 OK
- **Stations testées :** KLGA, RKSI, LFPG — toutes répondent
- **Champ température :** `temp` en °C
- **Précision :** Entier pour RKSI/LFPG, 1 décimale pour KLGA
- **Fréquence :** ~30-60 min entre observations

### E. Previous Runs API ✅

- **Statut :** 200 OK
- **Données :** 7 derniers jours de prévisions GFS max temp pour Seoul
- **Valeurs :** GFS prédisait 5.6-6.7°C pour Seoul ces 7 jours, WU enregistrait 9°C max → confirme le biais froid GFS de ~3°C pour Seoul

---

## 3. Anomalies dans les données

### 3A. Stations ICAO FAUSSES (4 villes)

**DÉCOUVERTE CRITIQUE :** Le champ `resolutionSource` de Polymarket révèle que **4 stations** dans cities.json (ajoutées en Passe 2) sont **fausses** :

| Ville | cities.json | Polymarket utilise | Écart |
|-------|-------------|-------------------|-------|
| **Dallas** | KDFW (DFW Intl) | **KDAL** (Love Field) | 16 km |
| **Ankara** | LTBA (Istanbul Atatürk) | **LTAC** (Ankara Esenboğa) | 350 km ! |
| **Milan** | LIML (Linate) | **LIMC** (Malpensa) | 40 km |
| **Shanghai** | ZSSS (Hongqiao) | **ZSPD** (Pudong) | 55 km |

**Impact :** Les prévisions ensemble sont faites aux coordonnées du MAUVAIS aéroport. Pour Ankara, c'est catastrophique (350 km d'écart entre Istanbul et Ankara). Pour les autres, l'écart de 16-55 km peut introduire un biais de 1-2°C.

**Également dans collect.py :** Les mêmes erreurs sont présentes dans `STATIONS` dict (l. 32-55). Le backtest historique utilise les mauvaises coordonnées pour ces 4 villes → les données de biais et d'accuracy dans backtest_stats.json sont faussées pour Dallas, Ankara, Shanghai et Milan.

### 3B. NYC jamais scanné

- **0 signal NYC** dans signals.json (180 signaux au total)
- NYC est le marché le plus liquide (299 marchés résolus dans backtest)
- Cause : `"key": "new york"` ne matche pas `"NYC"` dans les titres Polymarket
- Le scanner rate aussi toutes les villes non présentes dans cities.json (15 villes)

### 3C. Trades résolus — PnL vérifié ✅

Les 7 trades résolus ont tous un PnL mathématiquement correct :
- WIN : `PnL = amount / entry_price - amount` ✅
- LOSS : `PnL = -amount` ✅

**Cross-check avec Wunderground :**

| Ville | Date | Bracket | Direction | Result | WU Max | Cohérent ? |
|-------|------|---------|-----------|--------|--------|-----------|
| Seoul | 2026-03-20 | ≤8°C | YES | LOSS | 11°C | ✅ Max > 8 → bracket impossible → YES perd |
| Seoul | 2026-03-20 | ≤9°C | YES | LOSS | 11°C | ✅ Max > 9 → YES perd |
| Seoul | 2026-03-20 | ≤10°C | NO | WIN | 11°C | ✅ Max > 10 → NO gagne |
| Singapore | 2026-03-20 | 31°C | YES | LOSS | 33°C | ✅ Max ≠ 31 → YES perd |
| Singapore | 2026-03-20 | ≤32°C | NO | WIN | 33°C | ✅ Max > 32 → NO gagne |
| Taipei | 2026-03-20 | 22°C | YES | LOSS | 24°C | ✅ Max ≠ 22 → YES perd |
| Taipei | 2026-03-20 | ≤21°C | NO | WIN | 24°C | ✅ Max > 21 → NO gagne |

**Toutes les résolutions sont cohérentes avec les températures réelles Wunderground.** ✅

### 3D. Signaux anormaux

- **Edge > 50% :** 1 signal (`Paris 15°C edge=+63.6%` — GFS dit 66.7% vs marché 3.1%)
- **Edge > 30% :** 18 signaux
- **Aucun gfs_prob anormal** (tous entre 0-100%)
- **Aucun entry_price anormal** (tous entre 0-1)

Le signal Paris à 63.6% d'edge est suspect — probablement un bracket extrême avec très peu de liquidité ou un marché quasi-résolu.

### 3E. Biais GFS confirmé par backtest

Le biais GFS J-1 par ville (backtest_stats.json, 455 observations WU) confirme les tendances :

| Ville | Biais J-1 | MAE | % ±1°C | Fiabilité |
|-------|----------|-----|--------|-----------|
| Wellington | **-3.06°C** | 3.08 | 6.5% | ❌ Très mauvais |
| Seoul | **-2.91°C** | 3.04 | 18.8% | ❌ Très mauvais |
| Taipei | **-2.40°C** | 2.65 | 25.0% | ⚠️ (n=4) |
| Dallas | +0.12°C | 0.92 | 84.8% | ✅ Bon |
| Miami | -0.18°C | 0.62 | 86.7% | ✅ Très bon |
| Toronto | -0.01°C | 0.84 | 71.9% | ✅ Bon |

**Note :** Le biais de Dallas, Ankara, Shanghai et Milan est calculé avec les mauvaises coordonnées (stations fausses) → ces chiffres sont non fiables.

---

## 4. Résumé

### Sources qui marchent ✅
- Polymarket Gamma API (events, marchés, résolution)
- Polymarket CLOB API (résolution trades)
- Wunderground API (clé fonctionnelle, 24-48 obs/jour)
- Open-Meteo Ensemble API (30+39+50 membres, membres corrects)
- METAR aviationweather.gov (temps réel)
- Previous Runs API (calibration historique)

### Sources cassées ❌
Aucune API n'est cassée. Toutes répondent correctement.

### Problèmes trouvés (classés par gravité)

**CRITIQUE (fausse les résultats) :**
1. **NYC jamais scanné** — key "new york" ne matche pas "NYC" dans les titres Polymarket. Le marché le plus liquide est invisible au scanner.
2. **4 stations ICAO fausses** — Dallas (KDFW→KDAL), Ankara (LTBA→LTAC, 350km d'écart !), Milan (LIML→LIMC), Shanghai (ZSSS→ZSPD). Les prévisions ensemble et le backtest utilisent les mauvais aéroports.

**IMPORTANT (réduisent l'efficacité) :**
3. **15 villes Polymarket non trackées** — Beijing, Chengdu, Chongqing, Hong Kong, Lucknow, Munich, Sao Paulo, Shenzhen, Wuhan, Warsaw, Houston, Denver, Austin, Los Angeles, San Francisco.
4. **Scanner parse description au lieu de resolutionSource** — Le champ `resolutionSource` contient l'URL WU propre avec station ICAO. Le scanner parse la `description` avec une regex fragile qui échoue sur certaines villes chinoises.
5. **Backtest données faussées pour 4 villes** — Les biais/accuracy dans backtest_stats.json sont calculés aux mauvaises coordonnées pour Dallas, Ankara, Shanghai et Milan.

### Confiance globale dans les données : 4/10

- Les APIs fonctionnent toutes ✅
- Les résolutions sont cohérentes avec WU ✅
- Mais le scanner rate NYC (le plus gros marché) ❌
- Et 4 stations sur les 8 ajoutées en Passe 2 sont fausses ❌
- Le backtest historique est partiellement non fiable pour les villes à mauvaises stations
