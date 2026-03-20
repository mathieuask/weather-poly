# RAPPORT 04 — Résultats des 3 agents

**Date :** 2026-03-20
**Auditeur :** Claude Code (Opus 4.6)

---

## Agent 1 — Stations ICAO vérité Polymarket

### Source : champ `resolutionSource` de 1 178 events Polymarket

**34 villes** trouvées sur Polymarket avec le tag `temperature`.

### Toutes les villes Polymarket avec station ICAO réelle

| Ville | Station ICAO | Pays | Unité | Events |
|-------|-------------|------|-------|--------|
| Atlanta | KATL | US | °F | 67 |
| Miami | KMIA | US | °F | 67 |
| Seattle | KSEA | US | °F | 67 |
| Toronto | CYYZ | CA | **°C** | 66 |
| Chicago | KORD | US | °F | 66 |
| Ankara | **LTAC** | TR | °C | 66 |
| Dallas | **KDAL** | US | °F | 66 |
| Seoul | RKSI | KR | °C | 66 |
| London | EGLC | GB | °C | 66 |
| Buenos Aires | SAEZ | AR | °C | 66 |
| Wellington | NZWN | NZ | °C | 66 |
| Sao Paulo | SBGR | BR | °C | 66 |
| Paris | LFPG | FR | °C | 65 |
| NYC | KLGA | US | °F | 65 |
| Munich | EDDM | DE | °C | 35 |
| Lucknow | VILK | IN | °C | 34 |
| Tokyo | RJTT | JP | °C | 24 |
| Tel Aviv | LLBG | IL | °C | 23 |
| Shanghai | **ZSPD** | CN | °C | 19 |
| Singapore | WSSS | SG | °C | 19 |
| Milan | **LIMC** | IT | °C | 13 |
| Madrid | LEMD | ES | °C | 13 |
| Warsaw | EPWA | PL | °C | 12 |
| Shenzhen | ZGSZ | CN | °C | 6 |
| Beijing | ZBAA | CN | °C | 5 |
| Wuhan | ZHHH | CN | °C | 5 |
| Chongqing | ZUCK | CN | °C | 5 |
| Chengdu | ZUUU | CN | °C | 4 |
| Hong Kong | VHHH | HK | °C | 4 |
| San Francisco | KSFO | US | °F | 1 |
| Denver | KDEN | US | °F | 1 |
| Houston | KHOU | US | °F | 1 |
| Los Angeles | KLAX | US | °F | 1 |
| Austin | KAUS | US | °F | 1 |

### Stations FAUSSES dans cities.json (4 erreurs)

| Ville | cities.json (FAUX) | Polymarket (VRAI) | Distance | Impact |
|-------|-------------------|-------------------|----------|--------|
| **Dallas** | KDFW (DFW Intl) | **KDAL** (Love Field) | 16 km | Moyen — même zone métro |
| **Ankara** | LTBA (Istanbul Atatürk!) | **LTAC** (Ankara Esenboğa) | **350 km** | **CRITIQUE** — mauvaise ville ! |
| **Milan** | LIML (Linate) | **LIMC** (Malpensa) | 40 km | Moyen — 127m de différence d'altitude |
| **Shanghai** | ZSSS (Hongqiao) | **ZSPD** (Pudong) | 55 km | Moyen — côtier vs intérieur |

**Coordonnées correctes pour les 4 stations :**

| Station | Lat | Lon | Élev | Note |
|---------|-----|-----|------|------|
| KDAL | 32.847 | -96.852 | 148m | Dallas Love Field — 10km NW of downtown |
| LTAC | 40.128 | 32.995 | 953m | Ankara Esenboğa — 28km NE of city |
| LIMC | 45.630 | 8.723 | 234m | Malpensa — 49km NW of city |
| ZSPD | 31.143 | 121.805 | 4m | Pudong Intl — 30km E of city |

### Unité FAUSSE dans cities.json (1 erreur)

| Ville | cities.json | Polymarket | Impact |
|-------|------------|------------|--------|
| **Toronto** | °F | **°C** | **CRITIQUE** — le scanner convertit °C→°F inutilement, fausse toutes les probabilités par bracket pour Toronto |

**Preuve :** Question Polymarket : `"Will the highest temperature in Toronto be -4°C or below on March 24?"`
Le bracket est en °C. Le scanner convertit les membres GFS en °F avant de comparer → tous les calculs Toronto sont faux.

### Villes manquantes (non trackées)

**Priorité haute** (≥ 12 events actifs) :

| Ville | Station | Pays | Unité | Events |
|-------|---------|------|-------|--------|
| **Sao Paulo** | SBGR | BR | °C | 66 |
| **Munich** | EDDM | DE | °C | 35 |
| **Lucknow** | VILK | IN | °C | 34 |
| **Warsaw** | EPWA | PL | °C | 12 |

**Priorité moyenne** (4-6 events) :

| Ville | Station | Pays | Unité | Events |
|-------|---------|------|-------|--------|
| Shenzhen | ZGSZ | CN | °C | 6 |
| Beijing | ZBAA | CN | °C | 5 |
| Wuhan | ZHHH | CN | °C | 5 |
| Chongqing | ZUCK | CN | °C | 5 |
| Chengdu | ZUUU | CN | °C | 4 |
| Hong Kong | VHHH | HK | °C | 4 |

**Priorité basse** (1 event, probablement tests) :

San Francisco, Denver, Houston, Los Angeles, Austin — 1 event chacun.

### Taipei

Taipei (RCTP) n'a **aucun event actif** sur Polymarket actuellement. Peut être un marché saisonnier ou supprimé.

---

## Agent 2 — Matching ville ↔ marché

### Events non matchés par le scanner (158 events, 16 villes)

Le scanner utilise `if city_key in title.lower()` pour associer un event à une ville.

| Ville (titre Poly) | Events ratés | Cause |
|--------------------|-------------|-------|
| **NYC** | **36 events** | key="new york", titre dit "NYC" |
| Sao Paulo | 37 events | Pas dans cities.json |
| Munich | 19 events | Pas dans cities.json |
| Lucknow | 19 events | Pas dans cities.json |
| Hong Kong | 10 events | Pas dans cities.json |
| Warsaw | 8 events | Pas dans cities.json |
| Beijing | 5 events | Pas dans cities.json |
| Shenzhen | 5 events | Pas dans cities.json |
| Wuhan | 5 events | Pas dans cities.json |
| Chongqing | 5 events | Pas dans cities.json |
| Chengdu | 4 events | Pas dans cities.json |
| San Francisco | 1 event | Pas dans cities.json |
| Denver | 1 event | Pas dans cities.json |
| Houston | 1 event | Pas dans cities.json |
| Los Angeles | 1 event | Pas dans cities.json |
| Austin | 1 event | Pas dans cities.json |

**NYC est le SEUL cas** où une ville est dans cities.json mais le matching échoue. Toutes les 19 autres villes de cities.json matchent correctement.

### Différence titre ↔ question

Polymarket utilise des noms différents entre le titre de l'event et les questions des brackets :

| Titre event | Question bracket |
|-------------|-----------------|
| "NYC" | "New York City" |

Pas d'autre différence détectée.

### Table d'aliases recommandée

Pour fixer le matching NYC, il suffit de changer la clé dans cities.json :

```json
// Avant
"key": "new york"

// Option A : changer la clé
"key": "nyc"

// Option B : ajouter une logique d'alias dans le scanner
// Le scanner devrait aussi chercher "nyc" quand key="new york"
```

**Recommandation :** Option A est plus simple. Changer le key de "new york" à "nyc" dans cities.json. Le scanner matche via `if cname in title.lower()`, et "nyc" est bien dans tous les titres NYC.

---

## Agent 3 — Validation croisée

### Test 1 : WU vs résolution Polymarket — 6/6 cohérents ✅

| Event | Winner Poly | WU Max | Cohérent |
|-------|------------|--------|----------|
| Wellington March 20 | 17°C | 17°C | ✅ |
| Madrid March 19 | 18°C | 18°C | ✅ |
| Warsaw March 19 | 13°C or higher | 13°C | ✅ |
| Milan March 19 | 18°C or higher | 18°C | ✅ |
| Munich March 20 | 13°C or higher | 14°C | ✅ |
| Lucknow March 19 | 35°C | 35°C | ✅ |

Note : un premier test montrait 3 échecs, mais c'était un bug de timezone dans le script de test. Après correction (WU retourne les obs de 23h UTC J-1 à 22h30 UTC J), tous les 6 marchés sont cohérents.

**Conclusion :** WU est bien la source de vérité. Polymarket résout exactement avec le max WU de la journée.

### Test 2 : Open-Meteo élévation par station — 12/12 cohérentes ✅

| Ville | Station | Élev. réelle | Élev. Open-Meteo | Écart |
|-------|---------|-------------|------------------|-------|
| Seoul | RKSI | 7m | 5m | -2m ✅ |
| Tokyo | RJTT | 6m | 4m | -2m ✅ |
| Paris | LFPG | 119m | 106m | -13m ✅ |
| London | EGLC | 6m | 4m | -2m ✅ |
| NYC | KLGA | 6m | 1m | -5m ✅ |
| Chicago | KORD | 205m | 213m | +8m ✅ |
| Toronto | CYYZ | 173m | 172m | -1m ✅ |
| Madrid | LEMD | 609m | 593m | -16m ✅ |
| Singapore | WSSS | 7m | 4m | -3m ✅ |
| Miami | KMIA | 3m | 2m | -1m ✅ |
| Buenos Aires | SAEZ | 20m | 18m | -2m ✅ |
| Taipei | RCTP | 32m | 30m | -2m ✅ |

Aucune station côtière n'est en mer. `cell_selection=nearest` fonctionne correctement.

### Test 3 : Top 5 signaux vs prix marché actuel

| Signal | Edge signal | Prix signal | Prix actuel | Δ | Statut |
|--------|-----------|------------|-------------|---|--------|
| Paris 15°C YES | +63.6% | 3.1¢ | 4.0¢ | +0.9pp | ACTIF |
| Singapore 33°C NO | -47.5% | 47.5¢ | 49.5¢ | +2.0pp | ACTIF |
| Seoul ≥14°C NO | -36.7% | 37.5¢ | 37.0¢ | -0.5pp | ACTIF |
| Paris 17°C NO | -35.0% | 35.0¢ | 41.0¢ | +6.0pp | ACTIF |
| Singapore 33°C NO | -33.8% | 40.0¢ | 40.5¢ | +0.5pp | ACTIF |

Tous les marchés sont encore actifs. Les prix ont peu bougé sauf Paris 17°C NO (+6pp), ce qui réduit l'edge réel de ce signal.

---

## Actions prioritaires pour Passe 5

### 1. CRITIQUE — Corriger les 4 stations ICAO fausses
- Dallas : KDFW → **KDAL** (32.847, -96.852)
- Ankara : LTBA → **LTAC** (40.128, 32.995) — **350km de décalage actuel**
- Milan : LIML → **LIMC** (45.630, 8.723)
- Shanghai : ZSSS → **ZSPD** (31.143, 121.805)

Modifier dans : `cities.json` + `collect.py` (STATIONS dict, CITY_TO_STATION, AIRPORT_KEYWORDS)

### 2. CRITIQUE — Corriger Toronto °F → °C
Le scanner convertit les membres GFS en °F avant de comparer aux brackets Toronto. Mais les brackets Toronto sont en **°C**. Tous les signaux Toronto sont faux.

### 3. CRITIQUE — Fixer le matching NYC
Changer `"key": "new york"` → `"key": "nyc"` dans cities.json.

### 4. IMPORTANT — Utiliser `resolutionSource` au lieu de parser `description`
Le champ `event.resolutionSource` contient l'URL WU propre (ex: `https://www.wunderground.com/history/daily/us/ny/new-york-city/KLGA`). Le scanner parse actuellement la `description` avec une regex fragile. Basculer sur `resolutionSource` est plus fiable.

### 5. IMPORTANT — Ajouter les 4 villes prioritaires
Sao Paulo (SBGR, 66 events), Munich (EDDM, 35), Lucknow (VILK, 34), Warsaw (EPWA, 12).

### 6. MINEUR — Corriger les mêmes stations dans collect.py
Les mêmes erreurs KDFW/LTBA/LIML/ZSSS sont dans `collect.py`. Les données backtest pour ces villes sont faussées.
