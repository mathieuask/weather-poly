# RAPPORT 01 — Audit du repo weather-poly

**Date d'audit :** 2026-03-20
**Auditeur :** Claude Code (Opus 4.6)
**Commit HEAD :** 49a2e55

---

## 1. Arborescence

```
weather-poly/
├── backend/
│   ├── scanner.py          (21 154 octets) — Scanner principal : Polymarket + ensemble GFS/ICON/ECMWF
│   ├── tracker.py          (14 024 octets) — Paper trading autonome + résolution
│   ├── calibrate.py        ( 6 028 octets) — Calcul biais GFS par ville
│   ├── metar.py            (10 020 octets) — Scanner METAR intraday (post-pic)
│   ├── wunderground.py     ( 4 260 octets) — Client API Wunderground
│   ├── collect.py          (17 506 octets) — Collecte historique backtest
│   ├── export_data.py      ( 4 312 octets) — Export backtest.db → JSON frontend
│   ├── autoresearch.py     ( 7 755 octets) — Analyse quotidienne + Telegram
│   ├── cities.json         ( 3 089 octets) — 12 villes
│   ├── city_bias.json      (   497 octets) — Biais calculé (3 villes seulement)
│   ├── signals.json        (819 344 octets) — Signaux actifs (copie identique dans frontend)
│   ├── results.json        (683 617 octets) — Paper trades exportés
│   ├── metar.json          (    95 octets) — 0 signaux METAR
│   └── tracker.db          (     0 octets) — ⚠ VIDE (0 bytes !)
├── frontend/               — Next.js app (React + Tailwind)
│   ├── app/
│   │   ├── page.tsx        (18 553 octets) — Dashboard signaux
│   │   ├── results/page.tsx(13 627 octets) — Page résultats paper trading
│   │   ├── data/page.tsx   ( 8 246 octets) — Page données backtest
│   │   ├── strategy/page.tsx(12 718 octets) — Strategy Arena
│   │   ├── navbar.tsx      ( 4 197 octets) — Navigation drawer
│   │   ├── layout.tsx      (   531 octets) — Layout root
│   │   ├── globals.css     (   119 octets) — CSS minimal
│   │   └── api/signals/route.ts (814 octets) — API route locale
│   └── public/
│       ├── signals.json    (819 344 octets) — Copie identique backend
│       ├── results.json    (683 617 octets) — Copie identique backend
│       ├── backtest_stats.json (23 082 octets) — Stats backtest
│       └── best_strategy.json (189 octets) — Placeholder, backtest jamais exécuté
├── scanner.log             (404 623 octets) — Logs scanner
├── tracker.log             ( 12 721 octets) — Logs tracker
├── metar.log               (  7 110 octets) — Logs METAR
├── calibrate.log           (    702 octets) — Logs calibrate
├── collect.log             (      0 octets) — Vide
├── SPEC.md, ANALYSIS.md, BACKTEST_SYSTEM.md, etc.
└── README.md
```

**Total fichiers de code Python :** 8 fichiers
**Total fichiers frontend :** 6 fichiers TypeScript/TSX
**Pas de `backtest.db`** — le fichier n'existe pas sur disque (seulement `tracker.db` à 0 bytes)

---

## 2. Scanner (scanner.py)

### APIs appelées
| API | URL exacte | Usage |
|-----|-----------|-------|
| Polymarket Gamma | `https://gamma-api.polymarket.com/events?active=true&limit=200&tag_slug=temperature&order=endDate&ascending=false` | Marchés météo actifs |
| Open-Meteo Ensemble | `https://ensemble-api.open-meteo.com/v1/ensemble` | Prévisions ensemble multi-modèles |

### Modèles météo utilisés
- **GFS** (gfs_seamless) : 30 membres, poids **0.8×**
- **ICON** (icon_seamless) : 39 membres, poids **1.0×**
- **ECMWF** (ecmwf_ifs025) : 50 membres, poids **1.2×**

**Méthode de blend :** Pondération par répétition de membres. Ex: si GFS a 30 membres et poids 0.8, on prend `max(30, round(30 × 0.8)) = 30` membres (pas de différence avec poids 1.0 puisque `n_effective = max(len, round(len*weight))`).

### Calcul de l'edge
```
edge = gfs_prob - market_prob
```
- `gfs_prob` = % des membres blendés tombant dans le bracket (avec ±0.5° de marge)
- `market_prob` = prix YES × 100 sur Polymarket
- **Pas de prise en compte du spread bid/ask** — utilise le prix AMM brut
- **Pas de correction de biais** — le `city_bias.json` est calculé mais jamais utilisé dans le scanner

### Coordonnées utilisées
**Coordonnées d'aéroport** (correctes pour Polymarket qui résout via Wunderground/aéroport)

### Fréquence de scan
- Pas de cron intégré. Exécution manuelle `python scanner.py`
- Le navbar du frontend indique "Scan toutes les 30 min" mais **aucun mécanisme cron n'est visible dans le repo**

### Bugs/problèmes trouvés
1. **Pondération biaisée par `random.choices`** — le blend utilise `random.choices()` pour sur-échantillonner les modèles pondérés. Résultat non-déterministe : deux exécutions consécutives donnent des probabilités différentes.
2. **Poids GFS 0.8× ne fait rien** — `n_effective = max(len(members), round(len(members) * weight))`. Avec weight=0.8 et len=30, `max(30, 24) = 30`. Le poids < 1 n'a AUCUN effet — GFS contribue autant que ICON.
3. **`ascending=false`** dans la requête Polymarket — tri descendant par endDate, mais combiné avec `cutoff` de 7 jours ça marche. Cependant limite à 200 events, potentiellement insuffisant.
4. **Forçage des extremes** (`all_raw[0]["op"] = "lte"`, `all_raw[-1]["op"] = "gte"`) — écrase l'opérateur parsé de la question Polymarket. Potentiellement correct mais fragile si le bracket le plus bas n'est pas réellement "or below".
5. **Git auto-push** dans `_git_push()` — commit + push automatique à chaque run. Dangereux sur branche master.
6. **Toronto unitée "F"** — `cities.json` met `"unit": "F"` pour Toronto. Polymarket Toronto utilise effectivement °F (vérifié).

---

## 3. Tracker (tracker.py)

### Comment crée-t-il les paper trades ?
- Lit `signals.json` (sortie du scanner)
- Pour chaque signal avec un `condition_id` non vu → INSERT dans `paper_trades`
- **Un seul trade par `condition_id`** (UNIQUE constraint) — ne met pas à jour si l'edge change
- Mise fixe : $10 par trade

### Comment détecte-t-il les résolutions ?
1. Cherche les trades `pending` dont la `date <= today`
2. Appelle l'API CLOB : `https://clob.polymarket.com/markets/{condition_id}`
3. Si `closed=True` et prix token YES >= 0.99 → résolu YES; <= 0.01 → résolu NO
4. Fallback : Gamma API `GET /markets?conditionIds={cid}`
5. Calcul PnL :
   - WIN: `amount / entry_price - amount`
   - LOSS: `-amount`

### Utilise-t-il Wunderground ?
**NON pour la résolution.** Le tracker résout uniquement via les prix Polymarket (CLOB + Gamma), pas via la température réelle Wunderground.

### Bugs/problèmes trouvés
1. **tracker.db est VIDE (0 bytes)** — Le fichier existe mais fait 0 octets. Les données `results.json` (358 trades) semblent avoir été générées puis la DB a été corrompue ou réinitialisée. Toute la data historique de résolution est perdue.
2. **`git add -A`** dans `git_push()` — ajoute TOUS les fichiers, y compris potentiellement des fichiers sensibles ou des .db volumineux.
3. **Pas de déduplication signal_log** — chaque exécution insère TOUS les signaux actuels. Si le scanner produit 180 signaux et le tracker tourne 10 fois par jour → 1800 lignes/jour dans signal_log.

---

## 4. Base de données

### tracker.db
**STATUT : VIDE (0 bytes)**

Le fichier existe mais ne contient aucune donnée. Aucune table, aucun schéma.

Le `results.json` montre que des données ont existé à un moment :
- 358 trades total (351 pending, 3 wins, 4 losses)
- Les 7 trades résolus sont tous sur des villes asiatiques (Seoul, Singapore, Taipei)

### backtest.db
**STATUT : N'EXISTE PAS**

`collect.py` est configuré pour créer `backtest.db` mais le fichier n'est pas présent sur le disque. Cependant, `backtest_stats.json` a été exporté avec :
- 4 217 marchés poly
- 455 températures réelles WU
- 1 362 prévisions GFS

→ Le backtest.db a existé, a été exporté via `export_data.py`, puis probablement supprimé ou gitignored.

### Schéma attendu (tracker.db)
```sql
CREATE TABLE signal_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    condition_id TEXT NOT NULL,
    city TEXT, date TEXT, bracket TEXT, direction TEXT,
    gfs_prob REAL, market_prob REAL, edge REAL, entry_price REAL,
    ev REAL, liquidity REAL, gfs_mean REAL, gfs_min REAL, gfs_max REAL,
    question TEXT, event_title TEXT, poly_url TEXT
);

CREATE TABLE paper_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opened_at TEXT NOT NULL, closed_at TEXT,
    condition_id TEXT NOT NULL UNIQUE,
    city TEXT, date TEXT, bracket TEXT, direction TEXT,
    gfs_prob REAL, market_prob REAL, edge REAL, entry_price REAL,
    amount REAL, result TEXT DEFAULT 'pending', pnl REAL,
    question TEXT, event_title TEXT, poly_url TEXT, wunderground TEXT,
    gfs_mean REAL, gfs_min REAL, gfs_max REAL, gfs_values TEXT
);

CREATE TABLE resolutions (
    condition_id TEXT PRIMARY KEY,
    resolved_at TEXT, outcome TEXT, final_price REAL
);
```

### Schéma attendu (backtest.db)
```sql
CREATE TABLE poly_markets (...);  -- 4217 marchés
CREATE TABLE actual_temps (...);  -- 455 températures WU
CREATE TABLE gfs_forecasts (...); -- 1362 prévisions GFS
```

---

## 5. Cities.json

### Nombre de villes : 12

| Ville | Station | Lat (code) | Lon (code) | Lat (référence) | Lon (référence) | Écart | Unit |
|-------|---------|-----------|-----------|-----------------|-----------------|-------|------|
| Seoul | RKSI | 37.469 | 126.451 | 37.469 | 126.451 | ✅ 0 | C |
| Tokyo | RJTT | 35.553 | 139.781 | 35.553 | 139.781 | ✅ 0 | C |
| Paris | LFPG | 49.010 | 2.548 | — | — | N/A (pas dans liste Poly) | C |
| London | EGLC | 51.505 | 0.053 | 51.505 | 0.053 | ✅ 0 | C |
| NYC | KLGA | 40.777 | -73.873 | 40.777 | -73.873 | ✅ 0 | F |
| Chicago | KORD | 41.979 | -87.905 | 41.978 | -87.904 | ✅ ~0.001° | F |
| Toronto | CYYZ | 43.678 | -79.625 | 43.678 | -79.625 | ✅ 0 | F |
| Madrid | LEMD | 40.472 | -3.563 | 40.472 | -3.563 | ✅ 0 | C |
| Singapore | WSSS | 1.350 | 103.994 | 1.350 | 103.994 | ✅ 0 | C |
| Miami | KMIA | 25.796 | -80.287 | 25.796 | -80.287 | ✅ 0 | F |
| Buenos Aires | SAEZ | -34.822 | -58.536 | -34.822 | -58.536 | ✅ 0 | C |
| Taipei | RCTP | 25.078 | 121.233 | 25.078 | 121.233 | ✅ 0 | C |

### Coordonnées : AÉROPORT ✅
Toutes les coordonnées correspondent aux aéroports (stations ICAO), ce qui est correct car Polymarket résout via Wunderground/stations aéroport.

### Villes MANQUANTES vs liste Polymarket active

Les villes suivantes sont sur Polymarket mais **absentes de cities.json** (donc ignorées par le scanner live) :

| Ville | Station | Présente dans collect.py ? |
|-------|---------|---------------------------|
| **Dallas** | KDFW | ✅ Oui (collect.py) |
| **Atlanta** | KATL | ✅ Oui (collect.py) |
| **Seattle** | KSEA | ✅ Oui (collect.py) |
| **Wellington** | NZWN | ✅ Oui (collect.py) |
| **Tel Aviv** | LLBG | ✅ Oui (collect.py) |
| **Shanghai** | ZSSS | ✅ Oui (collect.py) |
| **Milan** | LIML | ✅ Oui (collect.py) |
| **Ankara** | LTBA | ✅ Oui (collect.py) |

→ **8 villes sont dans `collect.py` (backtest) mais PAS dans `cities.json` (scanner live)**. Le scanner live ne couvre que 12/20 villes Polymarket.

### Note sur Paris
Paris (LFPG) est dans `cities.json` mais **n'apparaît pas dans la liste de référence Polymarket**. Peut-être un marché ancien ou intermittent.

### Codes ICAO
Tous corrects. Note : `LTBA` pour Ankara est en fait le code d'Istanbul Atatürk (fermé en 2019). Le vrai aéroport d'Ankara est `LTAC` (Esenboğa). **Erreur dans collect.py** si c'est censé être Ankara.

---

## 6. Frontend

### Technologies
- **Next.js** (React 19 + TypeScript)
- **Tailwind CSS** v4
- Pas de backend serveur — le frontend fetch les JSON depuis **GitHub Raw** directement

### Ce qu'il affiche
4 pages :
1. **/ (Signaux)** — Dashboard des signaux actifs avec filtres (direction, edge, date, ville), barres de probabilité GFS vs marché, histogramme des membres ensemble
2. **/results** — Paper trades avec statut (pending/win/loss), PnL, stats globales
3. **/data** — Backtest stats (couverture par ville, biais GFS par horizon J-1/J-2/J-3)
4. **/strategy** — Strategy Arena (placeholder, backtest.py jamais exécuté)

### Déployé où ?
**Pas de déploiement visible.** Le frontend fetch depuis `https://raw.githubusercontent.com/mathieuask/weather-poly/master/frontend/public/...` — donc c'est servi depuis GitHub directement. Pas de Vercel, Netlify, ou autre déploiement configuré.

### Problème UX
Le frontend montre "GFS (30 modèles)" dans la légende alors que le blend utilise en fait 119 membres (30 GFS + 39 ICON + 50 ECMWF). Le navbar dit correctement "129 membres" mais c'est incohérent.

---

## 7. APIs manquantes

| API | Utilisée ? | Détails |
|-----|-----------|---------|
| **Polymarket Gamma** (marchés actifs) | ✅ OUI | `scanner.py`, `collect.py` |
| **Polymarket CLOB** (résolution) | ✅ OUI | `tracker.py` pour détecter les résolutions |
| **Open-Meteo Ensemble** (GFS/ICON/ECMWF) | ✅ OUI | `scanner.py` — 3 modèles blendés |
| **Wunderground** (source de vérité Polymarket) | ⚠️ PARTIELLEMENT | `wunderground.py` existe mais n'est utilisé que dans `calibrate.py` et `collect.py`. **Le scanner principal ne l'utilise PAS.** Le tracker ne l'utilise PAS pour résoudre. |
| **Ensemble ECMWF 51 membres** | ✅ OUI | Via `ecmwf_ifs025` dans Open-Meteo (50 membres dans le code) |
| **METAR temps réel** (aviationweather.gov) | ⚠️ CODE PRÉSENT | `metar.py` existe mais la sortie est vide (0 signaux). L'appel METAR est fait mais `fetch_daily_max` dans metar.py appelle en fait Wunderground via le module `wunderground`, pas l'API METAR directement. |
| **Previous Runs** (calibration historique) | ✅ OUI | `collect.py` utilise `https://previous-runs-api.open-meteo.com/v1/forecast` |
| **Polymarket prix historiques** (CLOB prices-history) | ❌ NON | `https://clob.polymarket.com/prices-history?market={TOKEN_ID}` n'est jamais appelé |
| **Iowa State Mesonet** | ⚠️ CODE MORT | `metar.py:fetch_daily_max()` (ligne 92-155) contient un client IEM Mesonet mais n'est **jamais appelé** — la fonction `run()` utilise `wunderground.get_current_max()` à la place |

---

## 8. Bugs et problèmes

### CRITIQUES (faussent les résultats)

1. **tracker.db est VIDE (0 bytes)** — La base de données de paper trading est corrompue/vide. Plus aucune donnée de suivi. Le `results.json` contient 358 trades mais la DB source est morte. Toute exécution future du tracker recréera la DB depuis zéro et perdra l'historique.

2. **Le biais GFS n'est JAMAIS appliqué dans le scanner** — `calibrate.py` calcule `city_bias.json` (Seoul: -2.9°C, Singapore: -2.4°C, Taipei: -1.9°C → biais négatif = GFS trop froid) mais `scanner.py` ne lit jamais ce fichier. Les probabilités calculées sont donc systématiquement fausses pour ces villes.

3. **Le poids GFS 0.8× est inopérant** — Code ligne 287 : `n_effective = max(len(members), round(len(members) * weight))`. Avec weight < 1, `round(30 * 0.8) = 24`, mais `max(30, 24) = 30`. GFS conserve 100% de ses membres au lieu d'être down-pondéré.

4. **8 villes Polymarket ignorées par le scanner live** — Dallas, Atlanta, Seattle, Wellington, Tel Aviv, Shanghai, Milan, Ankara sont dans `collect.py` mais pas dans `cities.json`. Le scanner vit ne les détecte jamais → opportunités manquées sur ~40% des marchés.

5. **Code ICAO erroné pour Ankara** — `LTBA` dans collect.py est le code d'Istanbul Atatürk Airport (fermé 2019), pas Ankara Esenboğa (`LTAC`). Les coordonnées (40.976, 28.814) correspondent bien à Istanbul, pas Ankara. **Le nom "Ankara" est associé aux coordonnées d'Istanbul.**

### IMPORTANTS (réduisent la précision)

6. **Edge calculé sans spread bid/ask** — `edge = gfs_prob - market_prob` utilise le prix AMM (`outcomePrices[0]`). En réalité, l'exécution se fait au prix bid/ask qui inclut un spread de 2-5%. Un edge de 5% peut être entièrement mangé par le spread.

7. **Blend non-déterministe** — `random.choices()` dans `fetch_gfs_ensemble()` rend le résultat aléatoire à chaque exécution. Deux scans consécutifs produisent des edges différents.

8. **La résolution du tracker n'utilise pas Wunderground** — Le tracker résout via les prix CLOB/Gamma. Si le marché n'est pas encore résolu sur Polymarket mais que Wunderground a déjà la température, le tracker attend. Pas critique mais lent.

9. **calibrate.py a un bug variable non définie** — Ligne 97 : `actual_temp = get_daily_max(station, wu_country, date_wu)` — la variable `station` n'est jamais définie dans la boucle. C'est `city_info["station"]` qui devrait être utilisé. **Ce code crashe systématiquement** (NameError).

10. **metar.py : `fetch_daily_max()` est du code mort** — La fonction Iowa State Mesonet (lignes 92-155) existe mais `run()` appelle `wunderground.get_current_max()` à la place. Deux implémentations coexistent sans raison.

11. **Pas de gestion timezone dans le calcul du jour** — `tracker.py` compare `date <= today` en UTC. Pour Seoul (UTC+9), un marché qui clôt le 20 mars heure locale serait déjà le 21 mars UTC après 15h locale. Le tracker peut tenter de résoudre trop tôt ou trop tard.

### MINEURS (améliorations)

12. **Pas de crontab/scheduler visible** — Le scanner, tracker et METAR doivent être lancés manuellement. Le navbar indique "scan toutes les 30 min" mais rien ne l'automatise dans le repo.

13. **signal_log grossit sans limite** — Chaque exécution du tracker insère TOUS les signaux actifs. 180 signaux × 48 exécutions/jour = 8 640 lignes/jour.

14. **Git auto-push sur master** — `scanner.py` et `tracker.py` font `git commit` + `git push` automatiquement sur la branche master à chaque exécution.

15. **Frontend fetch depuis GitHub Raw** — Le frontend charge `signals.json` et `results.json` depuis `raw.githubusercontent.com`. GitHub Raw a un cache de ~5 min et n'est pas fiable pour du temps réel. L'API route locale (`/api/signals`) existe mais n'est pas utilisée par le frontend en production.

16. **Clé API Wunderground hardcodée** — `WU_KEY = "e1f10a1e78da46f5b10a1e78da96f525"` est en clair dans le code. Avec un mécanisme de fallback (scraping du JS WU) si la clé est révoquée.

17. **`best_strategy.json` est un placeholder** — Le fichier contient `"status": "pending"`. `backtest.py` n'existe pas dans le repo — la Strategy Arena est inopérante.

---

## 9. Données brutes

### tracker.db
```
STATUT : FICHIER VIDE (0 bytes)
Aucune table, aucune donnée.
```

### results.json (extrait des stats)
```json
{
  "updated_at": "2026-03-20 14:01 UTC",
  "stats": {
    "total_trades": 358,
    "pending": 351,
    "wins": 3,
    "losses": 4,
    "win_rate": 42.9,
    "total_invested": 70.0,
    "total_pnl": -31.16,
    "roi": -44.5,
    "paper_amount": 10.0
  },
  "city_stats": {
    "Seoul":     { "wins": 1, "losses": 2, "pnl": -16.75 },
    "Singapore": { "wins": 1, "losses": 1, "pnl": -5.29 },
    "Taipei":    { "wins": 1, "losses": 1, "pnl": -9.12 }
  }
}
```

**Observations :**
- 351/358 trades encore "pending" → presque aucune résolution
- Les 7 seuls trades résolus sont sur Seoul, Singapore, Taipei — les 3 villes marquées "low" confidence
- Win rate 42.9% avec PnL -31.16$ sur 70$ investi = **ROI -44.5%**
- Les villes "high confidence" (NYC, Chicago, Toronto, London) n'ont aucun trade résolu

### city_bias.json
```json
{
  "Seoul":     { "n": 3, "bias_mean": -2.9, "reliable": false },
  "Singapore": { "n": 2, "bias_mean": -2.4, "reliable": false },
  "Taipei":    { "n": 2, "bias_mean": -1.9, "reliable": false }
}
```
**Biais négatif = GFS prédit trop froid.** Cohérent avec les pertes sur ces villes — le modèle sous-estime les températures en Asie.

### backtest_stats.json (extrait)
```
n_markets:      4 217
n_actual_temps:   455
n_gfs:          1 362

Villes par nb marchés résolus :
  NYC       299 marchés | 2025-12-30 → 2026-03-19
  Dallas    299 marchés | 2025-12-30 → 2026-03-19
  Atlanta   299 marchés | 2025-12-30 → 2026-03-19
  Toronto   292 marchés | ...
  Seoul     282 marchés | ...
  London    278 marchés | ...
  Chicago   278 marchés | ...
  Tokyo     277 marchés | ...
  Singapore 273 marchés | ...
  Miami     273 marchés | ...
  Madrid    272 marchés | ...
  Buenos Aires 265 marchés | ...
  Taipei    257 marchés | ...
  Tel Aviv  113 marchés | ...
  Wellington 99 marchés | ...
  Dallas    ... (déjà compté)
  etc.
```

### metar.json
```json
{
  "generated_at": "2026-03-20T14:15:01.650925+00:00",
  "signals_count": 0,
  "signals": []
}
```

---

## Résumé exécutif

Le système weather-poly est une architecture correcte conceptuellement mais avec des **failles critiques d'implémentation** :

1. **La DB est vide** — impossible de suivre les performances
2. **Le biais GFS n'est pas corrigé** — le scanner ignore `city_bias.json`
3. **8/20 villes Polymarket sont manquantes** du scanner live
4. **Le blend pondéré est cassé** — le poids GFS < 1 ne fonctionne pas mathématiquement
5. **Pas de backtest fonctionnel** — `backtest.py` n'existe pas malgré les 4 217 marchés collectés
6. **La seule data de performance (7 trades) montre -44.5% ROI** sur les villes les moins fiables

Le code a les briques pour un bon système (multi-modèle, METAR, Wunderground, calibration) mais elles ne sont pas connectées entre elles.
