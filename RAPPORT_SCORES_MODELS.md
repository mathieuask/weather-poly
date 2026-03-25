# Rapport — Scores de Fiabilite + Modeles Locaux

## Ce qu'on a construit

### Architecture complete automatisee

Un pipeline 100% automatique tourne sur Supabase (pg_cron toutes les 5 min) qui :
- Fetch les prix Polymarket pour les marches ouverts
- Detecte les resolutions et fetch la temperature reelle (Weather Underground)
- Scanne les nouveaux events Polymarket
- **Refresh les forecasts** des 8 modeles meteo (1x/heure) via Open-Meteo Previous Runs API
- **Recalcule les scores MAE** (Mean Absolute Error) par modele/station/horizon (1x/heure)

Tout tourne meme ordi eteint. Free plan Supabase, largement dans les limites.

---

### 8 modeles meteo

5 modeles globaux + 3 locaux, tous fetches automatiquement :

| Modele | Type | Resolution grille | Source |
|--------|------|-------------------|--------|
| GFS | Global (US) | 1.4-4.3 km | NOAA |
| ECMWF | Global (EU) | 3.9-10.9 km | ECMWF |
| ICON | Global (DE) | 0.7-19.1 km | DWD |
| UKMO | Global (UK) | 0.9-4.7 km | Met Office |
| MétéoFrance | Global (FR) | 0.6-10.9 km | Meteo-France |
| GEM | Local (Canada) | 4.4-5.3 km | CMC |
| JMA | Local (Japon) | 1.2-2.2 km | JMA |
| KNMI | Local (Pays-Bas) | 0.6-1.2 km | KNMI |

---

### Scores de fiabilite (MAE sur ~425 jours d'historique)

#### London (EGLC) — Tous excellents

| Modele | J-0 | J-1 | J-2 | J-3 | Moyenne |
|--------|-----|-----|-----|-----|---------|
| ICON | 0.55 | 0.78 | 1.05 | 1.15 | 0.88 |
| GFS | 0.74 | 1.06 | 1.21 | 1.42 | 1.11 |
| GEM | 0.76 | 1.16 | 1.27 | 1.38 | 1.14 |
| ECMWF | 0.80 | 1.01 | 1.10 | 1.16 | 1.02 |
| KNMI | 0.83 | 1.07 | 1.09 | 1.16 | 1.04 |
| MétéoFrance | 0.76 | 0.87 | 1.41 | 1.56 | 1.15 |
| UKMO | 0.55 | 1.02 | 1.21 | 1.33 | 1.03 |
| JMA | 1.19 | 1.38 | 1.49 | 1.63 | 1.42 |

#### NYC (KLGA) — En Fahrenheit, erreurs plus grandes

| Modele | J-0 | J-1 | J-2 | J-3 | Moyenne |
|--------|-----|-----|-----|-----|---------|
| GFS | 1.21 | 2.64 | 3.00 | 3.18 | 2.51 |
| ICON | 1.47 | 2.13 | 2.48 | 2.79 | 2.22 |
| GEM | 1.64 | 2.23 | 3.09 | 3.62 | 2.65 |
| UKMO | 1.77 | 2.57 | 3.17 | 3.45 | 2.74 |
| ECMWF | 2.31 | 3.34 | 3.63 | 3.90 | 3.30 |
| MétéoFrance | 2.42 | 3.14 | 3.61 | 3.96 | 3.28 |
| KNMI | 2.42 | 3.25 | 3.52 | 3.81 | 3.25 |
| JMA | 2.67 | 3.38 | 3.73 | 4.09 | 3.47 |

#### Seoul (RKSI) — 109 jours d'historique

| Modele | J-0 | J-1 | J-2 | J-3 | Moyenne |
|--------|-----|-----|-----|-----|---------|
| GEM | 0.88 | 0.95 | 1.15 | 1.44 | 1.11 |
| ECMWF | 0.96 | 1.10 | 1.14 | 1.15 | 1.09 |
| KNMI | 0.97 | 1.00 | 1.12 | 1.14 | 1.06 |
| ICON | 1.32 | 1.39 | 1.51 | 1.49 | 1.43 |
| MétéoFrance | 1.47 | 1.51 | 1.57 | 1.62 | 1.54 |
| JMA | 1.98 | 2.12 | 2.09 | 2.05 | 2.06 |
| GFS | 2.09 | 2.13 | 2.17 | 2.23 | 2.16 |
| UKMO | 2.12 | 2.20 | 2.25 | 2.38 | 2.24 |

---

### Tables Supabase

| Table | Contenu | Rows approx |
|-------|---------|-------------|
| `poly_events` | Events Polymarket (3 villes) | ~966 |
| `poly_markets` | Brackets par event | ~8000 |
| `price_history` | Prix CLOB toutes les 5 min | ~5.3M |
| `daily_temps` | Temperatures reelles (WU) | ~960 |
| `gfs_forecasts` | Forecasts 8 modeles x 4 horizons | ~31 000 |
| `model_scores` | MAE par modele/station/horizon | 96 |

### Frontend (Next.js)

Page `/data` affiche pour chaque event :
- Courbe de prix Polymarket (evolution des brackets)
- Tableau Forecast Evolution : 8 modeles tries par MAE, avec MAE par horizon dans chaque cellule
- Badge MAE colore : vert (<=1.5), jaune (1.5-2.5), rouge (>2.5)
- Temperature reelle si le marche est resolu

---

## Donnees disponibles pour la suite

Pour chaque event Polymarket a venir, on a :
1. **8 forecasts** (temp max prevue) a J-3, J-2, J-1, J-0 — mis a jour toutes les heures
2. **Score de fiabilite (MAE)** de chaque modele pour cette station et cet horizon
3. **Historique des prix** Polymarket (evolution de la probabilite de chaque bracket)
4. **Distance de grille** de chaque modele a la station
5. **~425 jours d'historique** forecast vs actual pour calibrer

### Ce qu'on peut faire avec

#### Option A — Prediction ponderee
Combiner les forecasts des 8 modeles en utilisant l'inverse du MAE comme poids :
```
poids(modele) = 1 / MAE(modele, station, horizon)
prediction = somme(poids * forecast) / somme(poids)
```
Exemple London J-0 : ICON (poids 1/0.55=1.82) aurait 3x plus d'influence que JMA (poids 1/1.19=0.84).

#### Option B — Signal de trading
Comparer la prediction ponderee aux brackets Polymarket :
- Si le consensus des modeles dit 14C et le bracket ">=15C" est a 60%, c'est potentiellement surpaye
- Calculer la probabilite implicite de chaque bracket depuis la distribution des forecasts vs le prix du marche

#### Option C — Distribution de probabilites
Utiliser l'historique des erreurs (pas juste le MAE) pour construire une distribution :
- Si ICON predit 14C avec un MAE de 0.55C, on peut estimer P(>=15C) ~ 3%
- Si le marche price ce bracket a 20%, c'est un signal SHORT

#### Option D — Tracker de performance
Comparer nos predictions ponderees aux prix Polymarket pour voir si on bat le marche sur l'historique.

---

## Questions ouvertes

1. **Quelle approche pour les predictions ?** Ponderee simple (A), signal de trading (B), distribution (C), ou les trois ?
2. **Faut-il un ensemble mean ?** On a les colonnes `ensemble_mean/min/max` dans `gfs_forecasts` mais elles sont vides. On pourrait fetch les ensembles (31 membres GFS, 51 membres ECMWF) pour avoir une vraie distribution.
3. **Paper trading ?** On a une table `paper_trades` — faut-il simuler des trades basees sur les signaux ?
4. **Seuil de confiance ?** A partir de quel ecart forecast/marche on considere que c'est un signal ? 5% ? 10% ?
5. **Combien de modeles utiliser ?** Les 8 ou seulement les top 3-4 par station ?
6. **Faut-il inclure le vent, l'humidite, les precipitations ?** Pour l'instant on n'a que temp_max.

## Fichiers cles

```
pipeline.py                           — Pipeline Python (CLI)
compute_scores.py                     — Calcul MAE
backfill_gfs.py                       — Backfill historique (one-shot)
supabase/functions/pipeline/index.ts  — Edge Function (tourne en auto)
supabase/migrations/20260326_model_scores.sql — Table scores
app/data/page.tsx                     — Frontend
```
