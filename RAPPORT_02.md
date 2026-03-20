# RAPPORT 02 — Corrections critiques appliquées

**Date :** 2026-03-20
**Appliqué par :** Claude Code (Opus 4.6)
**Base :** RAPPORT_01 du même jour

---

## FIX 1 — cities.json (8 villes ajoutées)

**Fichier modifié :** `backend/cities.json`

**Nombre de villes avant/après :** 12 → 20

**Villes ajoutées :**

| Ville | Station | Coordonnées | Unit | Timezone |
|-------|---------|-------------|------|----------|
| Dallas | KDFW | 32.897, -97.038 | F | America/Chicago |
| Atlanta | KATL | 33.640, -84.427 | F | America/New_York |
| Seattle | KSEA | 47.449, -122.309 | F | America/Los_Angeles |
| Wellington | NZWN | -41.327, 174.805 | C | Pacific/Auckland |
| Tel Aviv | LLBG | 32.011, 34.887 | C | Asia/Jerusalem |
| Shanghai | ZSSS | 31.198, 121.336 | C | Asia/Shanghai |
| Milan | LIML | 45.445, 9.277 | C | Europe/Rome |
| Ankara | LTBA | 40.976, 28.814 | C | Europe/Istanbul |

**Également modifié :** `scanner.py` — ajout des 8 villes dans `CITY_CONFIDENCE` (Dallas/Atlanta/Seattle = "high", les autres = "medium").

**Note Ankara/LTBA :** Conservé tel quel car Polymarket utilise bien LTBA dans ses descriptions de résolution, même si c'est techniquement Istanbul Atatürk (fermé).

**Test :**
```
$ python3 -c "import json; d=json.load(open('backend/cities.json')); print(len(d))"
20  ✅
```

---

## FIX 2 — Blend déterministe

**Fichier modifié :** `backend/scanner.py`

**Méthode :** Remplacement complet de l'approche par concaténation + `random.choices()` par un calcul de probabilité pondérée par modèle.

### Avant (cassé)
```python
# random.choices() → non-déterministe
# max(len, round(len*weight)) → poids < 1 sans effet
n_effective = max(len(members), round(len(members) * weight))
blended += random.choices(members, k=n_effective)
```

### Après (déterministe + poids fonctionnels)
```python
# Chaque modèle calcule sa probabilité séparément
# Moyenne pondérée : P = Σ(w_i × P_i) / Σ(w_i)
# GFS: 0.8, ICON: 1.0, ECMWF: 1.2 → total = 3.0
# → GFS pèse 26.7%, ICON 33.3%, ECMWF 40.0%
```

**Changements structurels :**
- `fetch_gfs_ensemble()` retourne maintenant `raw_models: dict {model: (members, weight)}` au lieu d'une liste plate
- Nouvelle fonction `_weighted_prob()` : calcule la probabilité par modèle puis fait la moyenne pondérée
- Nouvelle fonction `_raw_to_flat_members()` : aplatit les membres pour les stats d'affichage (min/max/mean)
- `gfs_bracket_prob()` accepte soit un dict raw_models (nouveau) soit une liste (legacy fallback)
- `compute_signals()` adapté pour recevoir raw_models

**Test déterminisme :**
```
$ python3 -c "from scanner import _weighted_prob; ..."
p1=16.6, p2=16.6, identical=True  ✅
p3=33.6, p4=33.6, identical=True  ✅
```

Deux exécutions identiques → résultats identiques. Le `import random` a été supprimé de la fonction.

---

## FIX 3 — Biais GFS appliqué dans le scanner

**Fichier modifié :** `backend/scanner.py`

**Nouvelles fonctions ajoutées :**
- `_load_city_bias()` : charge `city_bias.json` au démarrage du module
- `_apply_bias_correction(raw_models, city_name)` : corrige chaque membre de chaque modèle

**Logique de correction :**
1. Si `reliable=True` (n >= 5) → correction complète du biais
2. Si `n >= 3` et `|bias| > 1.5°C` → demi-correction (prudent)
3. Si `|bias| < 0.5°C` → pas de correction (négligeable)
4. Sinon → pas de correction

**Signe :** `bias_mean = GFS - réel`. Si `bias_mean = -2.9` (GFS trop froid), on soustrait le biais : `m - (-2.9) = m + 2.9°C`. Les membres montent.

**Application :** dans `run()`, la correction est appliquée juste après la récupération des données ensemble et avant le calcul des signaux.

**Impact sur Seoul (bias = -2.9°C, n=3, demi-correction = +1.45°C) :**
```
Test avec données synthétiques :
  Original mean = 12.4°C
  Corrected mean = 13.8°C (+1.4°C)  ✅
```

En production, cela signifie que les brackets hauts de Seoul auront une probabilité plus élevée et les brackets bas une probabilité plus basse, ce qui est cohérent avec le fait que GFS sous-estimait les températures.

**Note :** La correction actuelle est partielle (demi-biais, n=3) car les données de calibration sont insuffisantes. Quand `calibrate.py` aura accumulé ≥ 5 observations par ville, la correction sera complète.

---

## FIX 4 — tracker.db reconstruit depuis results.json

**Script exécuté :** reconstruction one-shot depuis `backend/results.json`

**Résultats :**
```
Trades insérés : 358
Répartition :
  pending : 351
  win     : 3
  loss    : 4
Taille fichier DB : 409 600 bytes (400 KB)
Tables créées : paper_trades, signal_log, resolutions
```

**Vérification :**
```
$ sqlite3 backend/tracker.db "SELECT COUNT(*) FROM paper_trades"
358  ✅

$ sqlite3 backend/tracker.db "SELECT result, COUNT(*) FROM paper_trades GROUP BY result"
loss|4
pending|351
win|3  ✅

$ sqlite3 backend/tracker.db ".tables"
paper_trades  resolutions  signal_log  ✅
```

**Note :** La table `signal_log` est vide (les logs historiques sont perdus). Ce n'est pas critique — les prochaines exécutions du tracker la rempliront. La table `resolutions` est également vide — elle sera peuplée au fur et à mesure que le tracker résout des trades.

---

## FIX 5 — calibrate.py corrigé (variable `station` non définie)

**Fichier modifié :** `backend/calibrate.py`

**Bug :** Ligne 97, `get_daily_max(station, wu_country, date_wu)` — la variable `station` n'existait pas dans la portée de la boucle. Crash systématique avec `NameError: name 'station' is not defined`.

**Fix :** Remplacé `station` par `city_info["station"]` :
```python
# Avant (crash)
actual_temp = get_daily_max(station, wu_country, date_wu)

# Après (corrigé)
actual_temp = get_daily_max(city_info["station"], wu_country, date_wu)
```

**Test :**
```
$ python3 -c "import ast; ast.parse(open('backend/calibrate.py').read()); print('syntax OK')"
syntax OK  ✅
```

Le script ne crashe plus au parse. L'exécution complète nécessite tracker.db avec des trades résolus ayant `actual_temp IS NULL`, ce qui arrivera naturellement au prochain cycle.

---

## Problèmes restants pour Passe 3

### Critiques
1. **Edge calculé sans spread bid/ask** — `edge = gfs_prob - market_prob` utilise le prix AMM. Le spread réel (2-5%) n'est pas pris en compte. Un edge de 5% peut être non-profitable après spread.
2. **Toronto en °F** — `cities.json` a `"unit": "F"` pour Toronto. À vérifier si Polymarket résout bien en °F pour Toronto (c'est le cas actuellement, mais inhabituel pour le Canada).

### Importants
3. **Pas de crontab/scheduler** — Aucune automatisation visible. Le scanner, tracker, METAR et calibrate doivent être lancés manuellement.
4. **`backtest.py` n'existe pas** — 4 217 marchés collectés dans `backtest.db` (via collect.py) mais aucun script de backtest. La page Strategy Arena est un placeholder.
5. **Frontend fetch depuis GitHub Raw** — Le frontend charge les JSON via `raw.githubusercontent.com` avec un cache de ~5 min. Pas adapté pour du temps réel.
6. **Résolution timezone** — `tracker.py` compare `date <= today` en UTC. Pour Seoul (UTC+9), cela peut causer des décalages de résolution.
7. **signal_log grossit sans limite** — Chaque run du tracker insère TOUS les signaux. Pas de déduplication.
8. **metar.py Iowa State Mesonet = code mort** — `fetch_daily_max()` (lignes 92-155) n'est jamais appelé.

### Mineurs
9. **Git auto-push sur master** — `scanner.py` et `tracker.py` push automatiquement.
10. **Clé API Wunderground hardcodée** — En clair dans `wunderground.py`.
11. **Frontend dit "GFS (30 modèles)"** dans la légende alors que le blend utilise ~119 membres de 3 modèles.
