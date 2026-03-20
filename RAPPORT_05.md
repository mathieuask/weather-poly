# RAPPORT 05 — Corrections chirurgicales appliquées

**Date :** 2026-03-20
**Appliqué par :** Claude Code (Opus 4.6)
**Base :** RAPPORT_04 (données vérifiées Agent 1/2/3)

---

## Correction 1 — 4 stations ICAO corrigées

**Fichiers modifiés :** `cities.json`, `collect.py`, `calibrate.py`, `metar.py`

| Ville | Avant (FAUX) | Après (VRAI) | Coords mises à jour | Statut |
|-------|-------------|-------------|---------------------|--------|
| Dallas | KDFW (32.897, -97.038) | **KDAL** (32.847, -96.852) | ✅ | ✅ |
| Ankara | LTBA (40.976, 28.814) | **LTAC** (40.128, 32.995) | ✅ | ✅ |
| Milan | LIML (45.445, 9.277) | **LIMC** (45.630, 8.723) | ✅ | ✅ |
| Shanghai | ZSSS (31.198, 121.336) | **ZSPD** (31.143, 121.805) | ✅ | ✅ |

**Source :** Champ `resolutionSource` de Polymarket (1 178 events analysés).

**collect.py aussi corrigé :**
- Dict `STATIONS` : 4 entrées mises à jour (ancien code supprimé, nouveau ajouté)
- Dict `CITY_TO_STATION` : 4 mappings corrigés
- Dict `AIRPORT_KEYWORDS` : 4 mappings corrigés
- Ligne `unit = "F" if station in (...)` : CYYZ retiré (Toronto est °C), KDFW→KDAL

**calibrate.py :** Dict `CITY_STATIONS` mis à jour (+ ajout des 12 nouvelles villes).

**metar.py :** Dict `PEAK_CONFIRMED_HOUR` étendu avec les 12 nouvelles stations.

**Test :**
```
Dallas: ✅  Ankara: ✅  Milan: ✅  Shanghai: ✅
```

---

## Correction 2 — Toronto °C

**Fichier :** `cities.json`

| | Avant | Après |
|-|-------|-------|
| unit | °F | **°C** |

**Source :** Question Polymarket : `"Will the highest temperature in Toronto be -4°C or below on March 24?"` — les brackets sont en °C.

**Impact corrigé :** Le scanner convertissait les membres GFS (en °C) vers °F avant de comparer aux brackets °C de Toronto. Résultat : toutes les probabilités Toronto étaient décalées. Exemple : un membre à 5°C devenait 41°F, comparé à un bracket de 5°C → jamais matché.

**Également corrigé dans collect.py :** CYYZ retiré de la liste des stations °F.

**Test :**
```
Toronto unit: C ✅
```

---

## Correction 3 — NYC matching

**Fichier :** `cities.json`

| | Avant | Après |
|-|-------|-------|
| key | `"new york"` | `"nyc"` |

**Source :** Tous les titres Polymarket utilisent "NYC", jamais "New York". Vérifié sur 65 events actifs.

**Autres fichiers impactés :**
- `scanner.py` CITY_CONFIDENCE : `"new york"` → `"nyc"` ✅
- `collect.py` CITY_TO_STATION : garde les deux (`"nyc"` et `"new york"`) car le titre peut varier entre titre et question ✅

**Test :**
```
Title: "Highest temperature in NYC on March 24?"
✅ Matched: key='nyc' found in title
```

---

## Correction 4 — 4 villes ajoutées

**Fichiers modifiés :** `cities.json`, `scanner.py`, `collect.py`, `calibrate.py`, `metar.py`

| Ville | Station | Coords | wu_country | Unit | Statut |
|-------|---------|--------|-----------|------|--------|
| Sao Paulo | SBGR | -23.432, -46.470 | BR | °C | ✅ |
| Munich | EDDM | 48.354, 11.786 | DE | °C | ✅ |
| Lucknow | VILK | 26.761, 80.889 | IN | °C | ✅ |
| Warsaw | EPWA | 52.166, 20.967 | PL | °C | ✅ |

**Source :** Agent 1 — ces 4 villes ont ≥ 12 events actifs sur Polymarket.

**Total villes : 24** (12 originales + 8 Passe 2 + 4 Passe 5)

**Ajouté dans :**
- `cities.json` : 4 entrées complètes
- `scanner.py` CITY_CONFIDENCE : Munich="high", Warsaw/Sao Paulo/Lucknow="medium"
- `collect.py` STATIONS + CITY_TO_STATION + AIRPORT_KEYWORDS
- `calibrate.py` CITY_STATIONS
- `metar.py` PEAK_CONFIRMED_HOUR

**Test :**
```
Sao Paulo: ✅  Munich: ✅  Lucknow: ✅  Warsaw: ✅
Total villes: 24
```

---

## Correction 5 — wu_country vérifiés

**Résultat :** 0 divergence trouvée.

```
✅ All 24 wu_country codes correct
```

Tous les codes pays correspondent à ceux extraits du champ `resolutionSource` de Polymarket.

---

## Vérification finale — Syntaxe

| Fichier | Statut |
|---------|--------|
| scanner.py | ✅ |
| tracker.py | ✅ |
| collect.py | ✅ |
| calibrate.py | ✅ |
| metar.py | ✅ |

---

## État du système après Passe 5

### Couverture villes
- **24/34 villes Polymarket couvertes** (71%)
- 10 villes non couvertes : Shenzhen, Beijing, Wuhan, Chongqing, Chengdu, Hong Kong, San Francisco, Denver, Houston, Los Angeles, Austin
- Les 4 villes à 1 event (SF, Denver, Houston, LA, Austin) sont probablement des tests Polymarket

### Stations ICAO
- **24/24 correctes** (vérifié via `resolutionSource` Polymarket)

### Matching titres
- **24/24 villes matchent** — NYC corrigé, toutes les autres fonctionnent

### Données fiables par ville

| Ville | Station ✅ | Unit ✅ | Coords ✅ | Confiance |
|-------|-----------|--------|----------|-----------|
| NYC | ✅ | ✅ | ✅ | high |
| Chicago | ✅ | ✅ | ✅ | high |
| Toronto | ✅ | ✅ (°C) | ✅ | high |
| London | ✅ | ✅ | ✅ | high |
| Paris | ✅ | ✅ | ✅ | high |
| Dallas | ✅ KDAL | ✅ | ✅ | high |
| Atlanta | ✅ | ✅ | ✅ | high |
| Seattle | ✅ | ✅ | ✅ | high |
| Munich | ✅ | ✅ | ✅ | high |
| Madrid | ✅ | ✅ | ✅ | medium |
| Miami | ✅ | ✅ | ✅ | medium |
| Buenos Aires | ✅ | ✅ | ✅ | medium |
| Tokyo | ✅ | ✅ | ✅ | medium |
| Milan | ✅ LIMC | ✅ | ✅ | medium |
| Tel Aviv | ✅ | ✅ | ✅ | medium |
| Wellington | ✅ | ✅ | ✅ | medium |
| Ankara | ✅ LTAC | ✅ | ✅ | medium |
| Shanghai | ✅ ZSPD | ✅ | ✅ | medium |
| Sao Paulo | ✅ | ✅ | ✅ | medium |
| Lucknow | ✅ | ✅ | ✅ | medium |
| Warsaw | ✅ | ✅ | ✅ | medium |
| Seoul | ✅ | ✅ | ✅ | low (biais -2.9°C) |
| Singapore | ✅ | ✅ | ✅ | low (biais -2.4°C) |
| Taipei | ✅ | ✅ | ✅ | low (pas d'events actifs) |

---

## Problèmes restants pour Passe 6

### Haute priorité
1. **Scanner devrait utiliser `resolutionSource`** au lieu de parser la description — le champ est propre et contient la station ICAO directement
2. **Backtest données faussées** — backtest.db a été collecté avec les mauvais ICAO pour Dallas/Ankara/Milan/Shanghai + mauvaise unité Toronto. Il faudrait re-collecter ou au minimum re-fetcher les actual_temps et GFS pour ces villes
3. **Edge sans spread bid/ask** — le calcul `edge = gfs_prob - market_prob` ne prend pas en compte le spread (2-5%)
4. **10 villes Polymarket non couvertes** — principalement chinoises (Shenzhen, Beijing, Wuhan, Chongqing, Chengdu) + Hong Kong

### Moyenne priorité
5. **Pas de crontab** — aucune automatisation visible
6. **signal_log grossit sans limite** — pas de déduplication
7. **Timezone resolution** — tracker compare dates en UTC, peut décaler la résolution pour villes asiatiques
8. **Git auto-push sur master** — `scanner.py` et `tracker.py` push automatiquement

### Basse priorité
9. **Frontend dit "GFS (30 modèles)"** dans la légende
10. **Clé WU hardcodée** dans wunderground.py
11. **`backtest.py` n'existe pas** — la Strategy Arena est un placeholder
