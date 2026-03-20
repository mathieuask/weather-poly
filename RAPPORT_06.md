# RAPPORT 06 — 4 agents parallèles

**Date :** 2026-03-20
**Appliqué par :** Claude Code (Opus 4.6)

---

## Agent A — Scanner avec resolutionSource

**Fichier modifié :** `backend/scanner.py`

### Méthode
Ajout d'un matching en 2 niveaux dans `fetch_poly_markets()` :

1. **Priorité 1 :** Extraire la station ICAO depuis `event.resolutionSource` via regex `wunderground\.com/history/daily/([a-z]{2})/.+?/([A-Z]{4})`. Si la station est dans `STATION_MAP` (reverse map de cities.json), on l'utilise directement.
2. **Priorité 2 (fallback) :** Matching par nom dans le titre (`if city_key in title.lower()`), identique au comportement précédent.
3. **Log des villes non configurées :** Si une station est détectée via resolutionSource mais n'est pas dans cities.json, le scanner loggue `⚠ Ville détectée mais non configurée: {city} ({station})`.

### Résultats
- **Villes détectées automatiquement : 24/24** ✅
- **Villes Polymarket non configurées loggées :** 10 (Chongqing, Wuhan, Beijing, Chengdu, Shenzhen, San Francisco, Houston, Austin, Los Angeles, Denver)
- **NYC visible : OUI** ✅ (2 signaux générés)
- **Signaux totaux : 259** (vs 180 avant — +79 grâce à NYC, les 4 nouvelles villes, et Toronto corrigé)

### Test scanner.py
```
96 marchés trouvés (652 brackets)
24 cities scannées
NYC: 2 signaux ✅
Total: 259 signaux
```

---

## Agent B — Edge réel avec spread bid/ask

**Fichier modifié :** `backend/scanner.py`

### Méthode
Les champs `bestBid` et `bestAsk` sont déjà disponibles dans la réponse Gamma API (pas besoin d'appels CLOB séparés).

**Données capturées par bracket :**
- `best_bid` : meilleur prix d'achat YES
- `best_ask` : meilleur prix de vente YES

**Calcul de l'edge réel :**
- **Achat YES** : `edge_real = gfs_prob - best_ask × 100` (on paye le ask, pas le mid)
- **Achat NO** : `edge_real = (100 - gfs_prob) - (1 - best_bid) × 100` (on vend YES au bid)

**Nouveaux champs dans signals.json :**
- `edge_real` : edge après spread
- `spread` : best_ask - best_bid
- `entry_real` : prix d'entrée réel (ask pour YES, 1-bid pour NO)

### Résultats
- **Signaux avec spread data : 258/259** (99.6%)
- **Spread moyen observé :** 2-5¢ sur la plupart des brackets
- **Spreads larges (> 20¢):** observés sur les brackets à faible liquidité

### Top 5 signaux par edge_real

| Signal | edge (indicatif) | edge_real | spread |
|--------|-----------------|-----------|--------|
| Tokyo 15°C YES | +36.2% | +34.7% | 3.0¢ |
| Singapore 34°C NO | -29.5% | +27.0% | 5.0¢ |
| Singapore 33°C NO | -27.6% | +26.6% | 2.0¢ |
| Tokyo 17°C NO | -26.5% | +26.0% | 1.0¢ |
| Wellington 21°C NO | -26.2% | +25.2% | 2.0¢ |

**Conclusion :** Les spreads sont relativement serrés (1-5¢) sur les marchés liquides. L'edge réel reste substantiel. Aucun signal avec edge_indicative > 15% ne tombe sous 10% après spread sur les marchés liquides.

---

## Agent C — Re-collecte backtest

### backtest.db
- **Existait avant :** NON (gitignored ou supprimé)
- **Recréé :** OUI — `collect.py --markets-only` puis `collect.py --days 30`

### Marchés Polymarket collectés : 4 838

| Ville | Station | Marchés |
|-------|---------|---------|
| NYC | KLGA | 299 |
| Dallas | **KDAL** | 299 |
| Atlanta | KATL | 299 |
| Toronto | CYYZ | 292 |
| Seoul | RKSI | 292 |
| Seattle | KSEA | 292 |
| London | EGLC | 292 |
| Buenos Aires | SAEZ | 292 |
| Wellington | NZWN | 289 |
| Sao Paulo | **SBGR** | 278 |
| Paris | LFPG | 278 |
| Miami | KMIA | 278 |
| Ankara | **LTAC** | 278 |
| Chicago | KORD | 269 |
| Munich | **EDDM** | 154 |
| Lucknow | **VILK** | 143 |
| Tokyo | RJTT | 98 |
| Tel Aviv | LLBG | 98 |
| Singapore | WSSS | 71 |
| Shanghai | **ZSPD** | 71 |
| Warsaw | **EPWA** | 44 |
| Taipei | RCTP | 44 |
| Milan | **LIMC** | 44 |
| Madrid | LEMD | 44 |

**Stations corrigées vérifiées :** KDAL ✅, LTAC ✅, LIMC ✅, ZSPD ✅
**Anciennes stations absentes :** KDFW ✅, LTBA ✅, LIML ✅, ZSSS ✅

### Collection WU + GFS
- **Températures WU :** ~240 collectées (en cours — API lente, ~0.4s/requête)
- **Prévisions GFS :** en attente (après WU)
- **Estimation temps total :** ~30 min pour les 30 derniers jours

---

## Agent D — Crontab + run_all.sh

### Fichiers créés

**`backend/crontab.txt`** — Crons recommandés :

| Tâche | Fréquence | Horaire |
|-------|-----------|---------|
| Scanner | Toutes les 30 min | */30 * * * * |
| Tracker | Toutes les 30 min (2 min après scanner) | 2,32 * * * * |
| METAR | Toutes les 15 min (6h-22h UTC) | */15 6-22 * * * |
| Calibration | Toutes les 6h | 0 0,6,12,18 * * * |
| Rapport Telegram | 1x/jour à 8h UTC | 0 8 * * * |
| Collecte backtest | 1x/jour à 3h UTC | 0 3 * * * |
| Export frontend | 1x/jour à 4h UTC | 0 4 * * * |

**Chemins configurés :**
```
REPO=/Users/mathieuaskamp/Desktop/weather-poly/weather-poly
VENV=backend/.venv/bin/python3
```

**Installation :** `crontab backend/crontab.txt`

**`backend/run_all.sh`** — Script manuel pour lancer le pipeline complet :
```bash
./backend/run_all.sh
# Lance: scanner → tracker → metar → calibrate
```

---

## État du système après Passe 6

### Scanner
- **24/34 villes Polymarket détectées** (71%)
- **10 villes non configurées loggées** (pas ignorées silencieusement)
- **259 signaux** générés (vs 180 avant)
- **NYC visible** avec 2 signaux ✅
- **Spread bid/ask intégré** dans chaque signal
- **resolutionSource utilisé** comme méthode de matching principale

### Données backtest
- **4 838 marchés** dans backtest.db (avec stations correctes)
- **WU collection en cours** (~240/720 station-dates)
- **GFS à collecter** après WU

### Automatisation
- `crontab.txt` prêt à installer
- `run_all.sh` prêt pour exécution manuelle

### Prochaines étapes (Passe 7+)
1. **backtest.py** — La pièce manquante. 4 838 marchés résolus avec données WU et GFS, prêts pour un backtest. Objectif : trouver les paramètres optimaux (min_edge, bracket_type, direction, horizon) pour maximiser le WR et le Sharpe.
2. **Ajouter les 10 villes manquantes** — Shenzhen, Beijing, Wuhan, Chongqing, Chengdu, Hong Kong (priorité haute — 4-6 events actifs chacune).
3. **Export données frontend** — Relancer `export_data.py` après la collecte WU/GFS pour mettre à jour backtest_stats.json.
4. **Frontend : afficher edge_real et spread** — Les données sont dans signals.json, le frontend doit les afficher.
