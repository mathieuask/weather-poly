# Strategie Auto-Adaptive — Weather Poly

## Ce qu'on a

### Donnees en temps reel (automatique, Supabase Edge Function)
- **143 membres ensemble** (GFS 31, ECMWF 51, ICON 40, GEM 21) — snapshots horaires
- **20 variables meteo** par membre (temp, vent, pluie, neige, humidite, pression, nuages...)
- **Prix Polymarket** toutes les 5 min pour chaque bracket
- **Temperatures reelles** (Weather Underground) apres resolution
- **3 villes** : London (EGLC, °C), NYC (KLGA, °F), Seoul (RKSI, °C)

### Donnees historiques
- **425 jours** de forecasts deterministes (8 modeles) vs actuals — table `gfs_forecasts` + `daily_temps`
- **~960 jours** de temperatures reelles
- **~966 events** Polymarket passes avec brackets, prix, et resultats (winner YES/NO)
- **Score MAE** par modele/station/horizon — table `model_scores`
- Tout est dans Supabase, queryable via REST API

### Frontend actuel
- 4 courbes : Polymarket, Model Prediction (143 membres), Conditions Meteo, Score de Confiance
- Bracket cards avec edge (notre proba vs prix marche)
- Score de confiance 0-100% (concentration des votes des 143 membres sur top 2 brackets)

### Tables Supabase
```
poly_events          — events Polymarket (event_id, station, target_date, closed)
poly_markets         — brackets (condition_id, bracket_temp, bracket_op, winner, resolved)
price_history        — prix CLOB (condition_id, ts, price_yes) — ~5M rows
daily_temps          — temp reelle (station, date, temp_max_c, temp_max_f)
gfs_forecasts        — forecasts deterministes (station, target_date, horizon, model, temp_max)
model_scores         — MAE par modele (station, model, horizon, mae, sample_count)
ensemble_forecasts   — 143 membres (station, target_date, fetch_ts, ensemble_model, member_id, temp_max, + 19 autres variables)
```

---

## Objectif

Creer un systeme de trading qui :
1. Genere des signaux d'achat/vente sur les brackets Polymarket
2. S'auto-ameliore avec le temps en apprenant de ses erreurs
3. Mesure ses performances en continu

---

## Phase 1 — Backtest sur les 425 jours historiques

### Donnees disponibles pour le backtest
On a pour chaque event passe :
- Les **forecasts deterministes** a J-3, J-2, J-1, J-0 (8 modeles)
- La **temperature reelle** (actual)
- Les **prix Polymarket** (evolution complete)
- Le **resultat** (quel bracket a gagne)

On n'a PAS les ensembles historiques (API ne donne que le dernier run). Mais on peut simuler une distribution depuis les 8 modeles deterministes :
- Si 5/8 modeles predisent 14°C et 3/8 predisent 15°C → P(14°C) ≈ 62%, P(15°C) ≈ 38%

### Questions a repondre par le backtest
1. **Edge minimum rentable** : a partir de quel ecart (notre proba - prix marche) un pari est rentable ? 5% ? 10% ? 15% ?
2. **Horizon optimal** : faut-il parier a J-3, J-2, J-1 ou J-0 ? Probablement J-2 ou J-1 (assez de donnees, pas trop tard)
3. **Seuil de confiance** : si les modeles divergent (spread > X°), faut-il s'abstenir ?
4. **Kelly criterion** : quel pourcentage du bankroll miser par pari ?
5. **Win rate et ROI** par ville, par horizon, par taille d'edge

### Metriques a calculer
- Nombre de paris, win rate, ROI total
- Profit factor (gains / pertes)
- Max drawdown
- Sharpe ratio si possible
- Comparaison avec strategie naive (toujours parier sur le bracket le plus probable)

---

## Phase 2 — Strategie live avec les ensembles

### Signal generation
Pour chaque event ouvert, a chaque snapshot ensemble :

```
1. Calculer P(bracket) pour chaque bracket depuis les 143 membres
2. Comparer avec le prix Polymarket actuel
3. Edge = notre_proba - prix_marche
4. Score de confiance = concentration des votes top 2 brackets
5. Signal si : edge > SEUIL_EDGE ET confiance > SEUIL_CONFIANCE
```

### Parametres a optimiser (via backtest)
- `SEUIL_EDGE` : edge minimum pour parier (ex: 10%)
- `SEUIL_CONFIANCE` : confiance minimum (ex: 70%)
- `HORIZON_MIN` : ne pas parier trop tot (ex: attendre J-2)
- `HORIZON_MAX` : ne pas parier trop tard (ex: pas apres J-0 12h)
- `KELLY_FRACTION` : fraction du Kelly criterion (ex: demi-Kelly = plus conservateur)
- `MAX_BET_SIZE` : taille max d'un pari (ex: $50)

### Sizing (Kelly Criterion)
```
kelly_pct = (edge * win_probability) / odds
bet_size = bankroll * kelly_pct * KELLY_FRACTION
bet_size = min(bet_size, MAX_BET_SIZE)
```

---

## Phase 3 — Auto-amelioration

### Feedback loop
Apres chaque event resolu :
1. Comparer notre signal avec le resultat reel
2. Si on avait raison (signal BUY et bracket gagnant) → renforcer les parametres
3. Si on avait tort → analyser pourquoi :
   - Edge trop faible ? → augmenter SEUIL_EDGE
   - Confiance trop basse ? → augmenter SEUIL_CONFIANCE
   - Modele biaise ? → identifier quel ensemble est systematiquement faux
4. Logger chaque trade dans une table `trades_log`

### Table trades_log (a creer)
```sql
CREATE TABLE trades_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT,
  station TEXT,
  target_date DATE,
  condition_id TEXT,
  bracket_temp INT,
  bracket_op TEXT,
  signal_ts TIMESTAMPTZ,         -- quand on a genere le signal
  our_prob FLOAT,                -- notre probabilite
  market_price FLOAT,            -- prix Polymarket au moment du signal
  edge FLOAT,                    -- ecart
  confidence FLOAT,              -- score de confiance
  horizon INT,                   -- jours avant l'event
  bet_size FLOAT,                -- taille du pari
  direction TEXT,                -- 'BUY' ou 'SELL'
  outcome TEXT,                  -- 'WIN', 'LOSS', 'PENDING'
  pnl FLOAT,                    -- profit/perte
  actual_temp FLOAT,             -- temperature reelle
  notes TEXT
);
```

### Ajustement automatique des parametres
Toutes les X resolutions (ex: 20 events), recalculer :
- Win rate par tranche d'edge (0-5%, 5-10%, 10-15%, 15%+)
- Win rate par tranche de confiance (0-50%, 50-75%, 75-100%)
- Win rate par horizon (J-3, J-2, J-1, J-0)
- Win rate par ville
- Ajuster les seuils pour maximiser le ROI

### Scoring des membres individuels
Au bout de 60+ jours d'ensembles :
- Calculer le MAE de chaque membre (143 scores)
- Identifier les "super-membres" (MAE < moyenne)
- Ponderer les votes par l'inverse du MAE → prediction ponderee au lieu de vote egal
- Comparer : vote egal vs vote pondere → lequel a un meilleur ROI ?

---

## Phase 4 — Dashboard et alertes

### Page /strategy (existante, a enrichir)
- Signaux actifs en temps reel
- Historique des trades (win/loss/pending)
- P&L cumule
- Metriques (win rate, ROI, drawdown)
- Parametres actuels (seuils, Kelly)

### Alertes (optionnel)
- Notification quand un signal depasse un edge de X%
- Recap quotidien des signaux

---

## Ordre d'implementation

1. **Backtest** : script Python qui simule la strategie sur les 425 jours historiques avec les 8 modeles deterministes. Trouver les seuils optimaux.
2. **trades_log** : creer la table + logique d'enregistrement
3. **Signal engine** : dans l'Edge Function ou en Python, generer les signaux a chaque snapshot
4. **Dashboard** : afficher signaux + P&L sur la page /strategy
5. **Auto-tune** : apres 20+ events avec ensembles, ajuster les parametres automatiquement
6. **Ponderation** : apres 60+ jours, ponderer les membres par leur MAE individuel
