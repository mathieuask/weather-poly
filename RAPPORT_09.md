# RAPPORT 09 — J-1/J-2/J-3 corrigés + backtest v3

**Date :** 2026-03-20
**Appliqué par :** Claude Code (Opus 4.6)

---

## Agent A — collect.py corrigé

### Bug identifié
La fonction `fetch_gfs_leadtime()` utilisait l'API Previous Runs avec `daily=temperature_2m_max` et un décalage de `start_date`. Cette approche retourne toujours la **même valeur** (dernière prédiction GFS disponible) quel que soit le lead time.

### Fix appliqué
Remplacé par `fetch_gfs_all_leadtimes()` qui utilise les variables **hourly** :
```
hourly=temperature_2m,temperature_2m_previous_day1,temperature_2m_previous_day2,temperature_2m_previous_day3
```
Puis calcule le max journalier à partir des 24 valeurs horaires.

**Le suffixe `_previous_dayN` fonctionne en hourly mais PAS en daily.**

### Test API : J-1 ≠ J-2 ≠ J-3 — OUI ✅

```
NYC (KLGA) — derniers 5 jours :
  2026-03-15: J-0=7.2  J-1=6.8  J-2=7.8  J-3=7.9   ✅ DIFF
  2026-03-16: J-0=13.4 J-1=15.0 J-2=12.4 J-3=13.1  ✅ DIFF
  2026-03-17: J-0=11.7 J-1=13.1 J-2=7.7  J-3=6.9   ✅ DIFF
  2026-03-18: J-0=2.8  J-1=3.3  J-2=3.7  J-3=3.8   ✅ DIFF
  2026-03-19: J-0=5.2  J-1=4.5  J-2=5.8  J-3=6.7   ✅ DIFF
```

Taux de différenciation J-1 vs J-2 : **96%** (861/900 différents).

### Données re-collectées
- **3 600 prévisions GFS** stockées (900 par lead_days × 4 horizons)
- 24 stations couvertes
- 0 erreurs

### Accuracy vs WU par horizon (520 dates)

| Horizon | MAE | Biais | Interprétation |
|---------|-----|-------|---------------|
| **J-0** | **1.33°C** | **-0.55°C** | Meilleur — quasi-observation |
| **J-1** | **1.86°C** | **-0.85°C** | Bon — forecast 24h |
| **J-2** | **1.92°C** | **-0.68°C** | Correct — forecast 48h |
| **J-3** | **2.15°C** | **-0.72°C** | Dégradé — forecast 72h |

**Dégradation J-1 → J-3 : +0.29°C de MAE (16% de dégradation).**
Le biais est systématiquement négatif (GFS trop froid) à tous les horizons.

---

## Agent B — Backtest v3 avec vrais lead times

### Résultats par horizon

| Horizon | Accuracy | WR (conf≥0) | WR (conf≥2) | Sharpe (conf≥2) | N |
|---------|---------|-------------|-------------|-----------------|---|
| **J-1** | **84.6%** | 84.6% | **94.3%** | **3.76** | 4 838 |
| **J-2** | 84.7% | 84.8% | 94.0% | 3.65 | 4 838 |
| **J-3** | 84.5% | 84.5% | 93.1% | 3.19 | 4 838 |

### Par type de bracket (J-1)

| Type | Accuracy |
|------|---------|
| Endbands ≤ | **93.7%** |
| Endbands ≥ | **90.8%** |
| Range (24-25°F) | **85.5%** |
| Exact (15°C) | **80.9%** |

### Par ville (J-1, top 15)

| Ville | Accuracy | N |
|-------|---------|---|
| Dallas | 88.3% | 299 |
| Atlanta | 87.6% | 299 |
| Miami | 87.4% | 278 |
| Buenos Aires | 86.3% | 292 |
| NYC | 86.3% | 299 |
| Toronto | 86.0% | 292 |
| Seoul | 81.5% | 292 |
| Sao Paulo | 85.5% | 278 |
| Paris | 80.2% | 278 |
| London | 84.6% | 292 |
| Ankara | 82.0% | 278 |
| Chicago | 82.2% | 269 |
| Seattle | 84.6% | 292 |
| Munich | 80.5% | 154 |
| Wellington | 79.9% | 289 |

### Meilleur horizon : J-1

Surprise : les 3 horizons sont **très proches** en accuracy (84.5-84.7%). La différence est dans le Sharpe :
- J-1 : Sharpe **3.76** à conf≥2°
- J-2 : Sharpe 3.65
- J-3 : Sharpe 3.19

J-1 est meilleur car le MAE plus bas permet des signaux plus fiables dans la zone critique.

### Comparaison v2 (R08) vs v3

| Métrique | v2 (J identiques) | **v3 (J réels)** |
|----------|-------------------|------------------|
| Accuracy J-1 | 87.5% | **84.6%** |
| WR conf≥2° | 97.1% | **94.3%** |
| Sharpe conf≥2° | 5.20 | **3.76** |
| Sharpe conf≥5° | 6.98 | **6.43** |

**L'accuracy baisse de 87.5% à 84.6%** avec les vrais lead times. C'est normal : les anciennes données utilisaient la prédiction GFS la plus récente (quasi J-0), pas vraiment J-1. Les résultats v3 sont plus réalistes.

**Le signal reste très profitable** — un Sharpe de 3.76 à conf≥2° est excellent.

---

## Agent C — Export + page Data

### backtest_stats.json mis à jour ✅

Contient maintenant :
- 4 838 marchés, 520 températures WU, **3 600 GFS** (vs 1 560 avant)
- Biais GFS par ville et par horizon (J-1/J-2/J-3 **distincts**)
- Accuracy ±1°C par ville et par horizon

### best_strategy.json mis à jour ✅

Contient les résultats du backtest v3 avec les 3 horizons distincts.

### Page Data du frontend (`frontend/app/data/page.tsx`)

La page Data lit `backtest_stats.json` et affiche :
- KPIs (marchés, temps WU, GFS)
- Couverture par ville
- Précision GFS par ville et horizon (J-1/J-2/J-3)

Les données sont correctes. Le frontend n'a pas besoin de modification — il lit déjà les champs `gfs_accuracy` et `gfs_bias` qui contiennent les données par `lead_days`.

---

## Réponse mise à jour

### Meilleur horizon : J-1 (Sharpe 3.76)

La dégradation par jour supplémentaire est modérée :
- **J-1 → J-2 : -0.1 Sharpe** (peu de différence)
- **J-2 → J-3 : -0.5 Sharpe** (dégradation notable)

Le scanner live utilise des prévisions à ~J-1 à J-3 selon la date des marchés. Le sweet spot est **J-1 à J-2** — au-delà de J-3, la précision chute trop.

### Confiance : 8/10

- **3 600 prévisions GFS** avec vrais lead times (vs 1 560 identiques avant)
- **Les 3 horizons sont réellement différents** — 96% de taux de différenciation
- **Le signal est profitable à tous les horizons** — Sharpe > 3 même à J-3
- **Le biais GFS est confirmé** : -0.55°C à -0.85°C (systématiquement trop froid)
- **Limitation restante** : PnL simulé (pas de vrais prix d'entrée historiques)

---

## Problèmes restants pour Passe 10

### Haute priorité
1. **Accumuler les price snapshots** — Le scanner capture maintenant les vrais prix. Après 2-3 semaines, backtest avec PnL réel.
2. **Lancer le bot en continu** — `crontab backend/crontab.txt` pour automatiser scanner + tracker + calibrate.
3. **Archiver les prédictions ensemble quotidiennement** — Stocker les 119 membres (pas juste la moyenne GFS) pour un backtest multi-modèle futur.

### Moyenne priorité
4. **Ajouter les 10 villes manquantes** — Shenzhen, Beijing, Wuhan, Chongqing, Chengdu, Hong Kong.
5. **Frontend : afficher edge_real + spread** — Les données existent dans signals.json.
6. **Correction de biais dynamique par horizon** — J-1 a un biais de -0.85°C, J-3 de -0.72°C. La correction de biais pourrait varier par horizon.
