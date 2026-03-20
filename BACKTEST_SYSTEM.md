# BACKTEST SYSTEM — Architecture & Mission

## Objectif

Construire un système autonome qui :
1. Collecte et stocke toutes les données historiques (GFS + Wunderground + Polymarket)
2. Analyse en continu ces données pour trouver la meilleure stratégie de trading
3. S'améliore automatiquement chaque jour avec les nouveaux trades résolus
4. Produit une stratégie optimisée avec win rate et PnL simulé sur données réelles

---

## Partie 1 — Collecte et stockage des données

### Structure cible (SQLite ou PostgreSQL)

```
database/
├── gfs_forecasts        ← ce que GFS prédisait à chaque run
├── actual_temps         ← températures réelles Wunderground
├── poly_markets         ← marchés Polymarket (brackets, prix, résolutions)
├── poly_prices_history  ← évolution des prix dans le temps
└── strategies_results   ← résultats de chaque stratégie testée
```

### Table `gfs_forecasts`
```sql
CREATE TABLE gfs_forecasts (
    id            INTEGER PRIMARY KEY,
    station       TEXT,        -- RKSI, LFPG, etc.
    target_date   DATE,        -- date pour laquelle on prédit
    run_time      DATETIME,    -- quand le run GFS a été fait (ex: 2026-03-19 12:00 UTC)
    lead_hours    INTEGER,     -- heures avant la date cible (6, 12, 24, 48, 72...)
    model         TEXT,        -- gfs_seamless, icon_seamless, ecmwf_ifs025
    temp_max_c    REAL,        -- prévision température max °C
    temp_mean_c   REAL,
    temp_std_c    REAL,        -- écart-type ensemble (incertitude)
    n_members     INTEGER,     -- nb membres ensemble utilisés
    lat           REAL,
    lon           REAL
);
```

### Table `actual_temps`
```sql
CREATE TABLE actual_temps (
    id          INTEGER PRIMARY KEY,
    station     TEXT,        -- RKSI, LFPG, etc.
    date        DATE,        -- date de mesure
    temp_max_c  REAL,        -- max observé (source: Wunderground = source officielle Polymarket)
    temp_min_c  REAL,
    source      TEXT,        -- "wunderground"
    fetched_at  DATETIME
);
```

### Table `poly_markets`
```sql
CREATE TABLE poly_markets (
    condition_id  TEXT PRIMARY KEY,
    event_id      TEXT,
    station       TEXT,        -- RKSI, LFPG, etc.
    city          TEXT,
    date          DATE,
    bracket_temp  REAL,        -- température du bracket (ex: 11.0)
    bracket_op    TEXT,        -- "exact", "lte", "gte"
    bracket_str   TEXT,        -- "11°C", "≤8°C", "≥14°C"
    unit          TEXT,        -- "C" ou "F"
    resolved      BOOLEAN,
    winner        TEXT,        -- "YES" ou "NO"
    final_temp    REAL,        -- temp réelle à la résolution
    end_date      DATE,
    created_at    DATETIME
);
```

### Table `poly_prices_history`
```sql
CREATE TABLE poly_prices_history (
    id            INTEGER PRIMARY KEY,
    condition_id  TEXT,
    timestamp     DATETIME,
    price_yes     REAL,        -- prix YES (0-1)
    price_no      REAL,        -- = 1 - price_yes
    liquidity     REAL,
    lead_hours    REAL         -- heures avant résolution
);
```

---

## Partie 2 — Sources de données et APIs

### GFS historique (prévisions passées)
```
API : https://historical-forecast-api.open-meteo.com/v1/forecast
Params : latitude, longitude, start_date, end_date, daily=temperature_2m_max,
         models=gfs_seamless, cell_selection=nearest
Disponible depuis : Janvier 2025
Limite : gratuit, pas de clé requise
```

### Wunderground (températures réelles officielles Polymarket)
```
API : https://api.weather.com/v1/location/{STATION}:9:{COUNTRY}/observations/historical.json
Params : apiKey=e1f10a1e78da46f5b10a1e78da96f525, units=m, startDate=YYYYMMDD
Donne : toutes les observations horaires de la journée
Max de la journée = ce que Polymarket lit pour résoudre
```

### Polymarket marchés résolus
```
API : https://gamma-api.polymarket.com/events?active=false&closed=true&tag_slug=temperature&limit=100
Donne : 526 marchés depuis Déc 2025, avec brackets, prix, winner
```

### Polymarket prix historiques CLOB
```
API : https://clob.polymarket.com/prices-history?market={TOKEN_ID}&interval=max&fidelity=60
Donne : évolution du prix YES dans le temps (timestamp + price)
Limite : peu de points (~7 par marché actuellement)
```

---

## Partie 3 — Le bot d'analyse autonome

### Principe
Un agent tourne en permanence (cron toutes les 5-10 min ou boucle infinie).
Chaque cycle il :
1. Vérifie s'il y a de nouveaux marchés résolus → les ajoute à la DB
2. Récupère les vrais températures Wunderground pour les marchés résolus
3. Lance un cycle d'analyse sur les données disponibles
4. Teste de nouvelles combinaisons de stratégie
5. Met à jour le fichier `best_strategy.json` si une meilleure est trouvée

### Ce qu'il analyse

**Pour chaque combinaison de paramètres :**
```python
PARAMS = {
    "lead_hours":       [6, 12, 24, 48, 72],       # à quelle avance trader
    "min_edge":         [5, 8, 10, 15, 20, 25],     # edge minimum %
    "bracket_type":     ["all", "endband_only", "exact_only"],
    "direction":        ["all", "NO_only", "YES_only"],
    "min_liquidity":    [50, 100, 200, 500, 1000],
    "min_ensemble_std": [0, 1, 2, 3],               # écart-type modèles (certitude)
    "cities":           ["all", "high_confidence", "low_bias_only"],
}
```

**Métriques calculées pour chaque stratégie :**
```python
{
    "n_trades":     int,    # nombre de trades simulés
    "win_rate":     float,  # %
    "pnl_total":    float,  # $ simulé
    "roi":          float,  # PnL / capital investi
    "sharpe":       float,  # rendement / volatilité
    "max_drawdown": float,  # perte max consécutive
    "by_city":      dict,   # win rate par ville
    "by_lead":      dict,   # win rate par horizon temporel
    "by_bracket":   dict,   # win rate end-bands vs exact
}
```

### Méthode anti-overfitting (critique)
- **Walk-forward** : entraîner sur 60% des données, valider sur 40%
- **Cross-city** : entraîner sur Seoul/Tokyo, valider sur Paris/Madrid
- **Minimum 25 trades** par segment avant toute conclusion
- **Pas de look-ahead bias** : utiliser uniquement les données disponibles AU MOMENT du trade simulé

---

## Partie 4 — Flux de données quotidien

```
Chaque jour à minuit UTC :
  1. Récupère tous les marchés résolus du jour (Polymarket API)
  2. Pour chaque marché résolu :
     a. Fetch temp réelle → Wunderground API
     b. Fetch prévision GFS J-1, J-2, J-3 → Open-Meteo Historical
     c. Calcule biais = GFS_prévu - temp_réelle
     d. Stocke dans DB
  3. Lance cycle d'analyse (300-500 combinaisons de stratégie)
  4. Compare avec meilleure stratégie précédente
  5. Si amélioration → update best_strategy.json
  6. Envoie rapport Telegram avec :
     - Résolutions du jour (wins/losses)
     - Biais GFS par ville (mis à jour)
     - Meilleure stratégie actuelle
     - Horizon optimal détecté (J-1 ? J-2 ?)

Toutes les 5 min (intraday) :
  1. Vérifie si des marchés du jour viennent d'être résolus
  2. Met à jour les résultats paper trading
  3. Lance METAR scanner pour signaux intraday
```

---

## Partie 5 — Questions à résoudre avant implémentation

### Q1 — Granularité GFS historique
L'API Open-Meteo Historical Forecast donne-t-elle la prévision
faite à un run spécifique (ex: run 12h UTC du 19 mars) ?
Ou seulement la "meilleure prévision" pour une date donnée ?
→ Impact : si on ne peut pas distinguer les runs, on ne peut pas tester
  J-1 run 00h vs J-1 run 12h vs J-2.

### Q2 — Prix Polymarket au moment du signal
Les prix CLOB n'ont que ~7 points par marché.
Pour simuler le vrai prix d'entrée, faut-il :
a) Interpoler entre les snapshots disponibles
b) Utiliser le prix à l'ouverture du marché
c) Utiliser le prix moyen de la journée précédant la résolution

### Q3 — Biais de survie
Polymarket n'a que 526 marchés depuis Déc 2025.
Certaines villes ont peut-être été ajoutées récemment.
Comment s'assurer qu'on ne tire pas de conclusions sur des villes
sous-représentées ?

### Q4 — Ensemble vs déterministe pour backtest
L'API Historical Forecast supporte-t-elle les membres d'ensemble
(30 membres GFS) pour les dates passées ?
Ou seulement la valeur déterministe ?

### Q5 — Quelle DB utiliser ?
- SQLite : simple, local, suffisant pour 526 marchés × 3 modèles × 18 runs
- PostgreSQL : si on scale à Kalshi (3 ans de data = 50K+ marchés)
Recommandation ?

---

## Résultat attendu

Un fichier `best_strategy.json` mis à jour en continu :
```json
{
  "updated_at": "2026-03-20T12:00:00Z",
  "n_resolved_trades": 526,
  "best_strategy": {
    "lead_hours": 24,
    "min_edge": 15,
    "bracket_type": "endband_only",
    "direction": "all",
    "min_liquidity": 200,
    "win_rate": 0.67,
    "pnl_per_100_trades": 312.50,
    "sharpe": 1.84,
    "confidence": "medium"
  },
  "by_city": {
    "Paris": {"win_rate": 0.71, "n": 45, "best_lead": 24},
    "Seoul": {"win_rate": 0.48, "n": 38, "best_lead": 6},
    ...
  },
  "horizon_analysis": {
    "6h":  {"win_rate": 0.72, "n": 180},
    "24h": {"win_rate": 0.61, "n": 420},
    "48h": {"win_rate": 0.55, "n": 380},
    "72h": {"win_rate": 0.52, "n": 310}
  }
}
```

Ce fichier alimente le scanner live pour générer les signaux
avec la stratégie optimale du moment.
