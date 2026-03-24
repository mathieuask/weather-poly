# RAPPORT V2_05 — API prix Polymarket découverte + WU complet

**Date** : 2026-03-24

---

## 1. Recherche API courbes de prix

### Contexte

En V2_04, on avait conclu que l'API CLOB `prices-history` purgeait les données ~3 semaines après résolution. **C'était faux** — le problème était l'utilisation du paramètre `interval=max` au lieu de `startTs`/`endTs`.

### Solution trouvée

**L'endpoint officiel fonctionne pour TOUS les marchés (y compris jan 2025), il faut utiliser `startTs` et `endTs` explicites.**

```
GET https://clob.polymarket.com/prices-history
  ?market={clob_token_id}
  &startTs={unix_timestamp}
  &endTs={unix_timestamp}
  &fidelity={minutes}
```

Source : [Polymarket docs](https://docs.polymarket.com/developers/CLOB/timeseries) + [GitHub issue #216](https://github.com/Polymarket/py-clob-client/issues/216)

### Contraintes découvertes

| Paramètre | Valeur | Notes |
|-----------|--------|-------|
| `fidelity` | 1-1440 | Granularité en minutes. 1=max, 60=horaire |
| Window max | **~15 jours** | Au-delà → 400 Bad Request ou 0 pts |
| `interval=max` | ❌ | Ne marche QUE pour marchés récents (~3 semaines) |
| `startTs`/`endTs` | ✅ | Marche pour TOUS les marchés, même jan 2025 |
| User-Agent | **Requis** | 403 sans header User-Agent |

### Test de granularité (London Jan 22, 2025 — résolu il y a 14 mois)

| Fidelity | Points | Interval moyen | Span |
|----------|--------|----------------|------|
| 1 | 1 662 | ~1 min | 28h |
| 5 | 333 | ~5 min | 28h |
| 15 | 111 | ~15 min | 28h |
| 30 | 56 | ~30 min | 28h |
| 60 | 28 | ~60 min | 27h |

### Test systématique 3 villes × 3 périodes (fidelity=60)

| Ville | Période | Date market | Points | Span (h) | p₀ | pₙ |
|-------|---------|-------------|--------|----------|-----|-----|
| London | OLD | 2025-01-22 | 28 | 27 | 0.500 | 0.001 |
| London | MID | 2026-02-15 | 50 | 50 | 0.016 | 0.001 |
| London | RECENT | 2026-03-22 | 94 | 98 | 0.025 | 0.001 |
| NYC | OLD | 2025-01-22 | 28 | 27 | 0.575 | 0.001 |
| NYC | MID | 2026-02-15 | 45 | 45 | 0.038 | 0.001 |
| NYC | RECENT | 2026-03-22 | 106 | 107 | 0.130 | 0.001 |
| Seoul | OLD | 2025-12-06 | 19 | 18 | 0.500 | 0.001 |
| Seoul | MID | 2026-02-15 | 31 | 30 | 0.035 | 0.001 |
| Seoul | RECENT | 2026-03-22 | 85 | 84 | 0.100 | 0.001 |

### Observations sur les courbes

- **Span en croissance** : les marchés récents (mars 2026) ont 85-106 pts sur 84-107h, contre 19-28 pts sur 18-28h pour les anciens (jan 2025)
- **p₀ = prix initial** souvent ~0.5 (50/50) pour les anciens, plus bas pour les récents (marché plus efficient)
- **pₙ toujours 0.001** : prix final post-résolution = quasi-0 pour les perdants
- **Trading window** : typiquement créé J-1, trading jusqu'à résolution J+0

### Endpoints testés qui NE marchent PAS

| Endpoint | Résultat |
|----------|----------|
| `clob /prices-history?interval=max` sur marchés > 3 semaines | 0 pts |
| `clob /prices?token_id=` | 400 |
| `clob /midpoint?token_id=` | 404 |
| `clob /book?token_id=` | 404 |
| `clob /trades?asset_id=` | 401 |
| `clob /order-book?token_id=` | 404 |
| `data-api.polymarket.com/*` | 404 |
| `strapi-matic.polymarket.com/*` | DNS fail |
| `clob /v2/prices-history` | 400 |

### Conclusion API

> **Toutes les données historiques de prix sont accessibles** via `startTs`/`endTs`.
> - Pas besoin de scraping en continu pour les données passées
> - Pour les marchés actifs : fenêtre de 15 jours max par requête
> - Stratégie : pour chaque bracket, une seule requête `startTs=created_at-1d, endTs=target_date+1d, fidelity=1`
> - **Estimation** : 966 events × 8 brackets avg × 1 requête = ~7700 requêtes pour tout l'historique

---

## 2. WU complété

| Ville | Avant V2_05 | Après V2_05 | Couverture |
|-------|-------------|-------------|------------|
| London (EGLC) | 423/423 | 423/423 | **100%** |
| NYC (KLGA) | 421/421 | 421/421 | **100%** |
| Seoul (RKSI) | 0/108 | 108/108 | **100%** |
| **Total** | **844/952** | **952/952** | **100%** |

Seoul (108 dates) a été fetch sans erreur. NYC s'est révélé déjà complet (421 dates existantes, pas les 223 annoncés en V2_04 — l'inventaire V2_04 sous-comptait à cause d'un limit trop bas dans la requête).

---

## 3. État final Supabase

| Table | Lignes | Notes |
|-------|--------|-------|
| `cities` | 3 | London, NYC, Seoul uniquement |
| `poly_events` | 966 | 952 resolved + 14 open |
| `poly_markets` | 7 085 | ~7.3 brackets/event en moyenne |
| `daily_temps` | 952 | 100% couverture WU pour les 3 villes |

> Note : la DB ne contient que les 3 focus cities (pas les 38 d'origine). La pruning a été faite avant V2_05.

---

## 4. Plan V2_06

### Priorité 1 : Fetch historique complet des prix CLOB

Maintenant qu'on sait que TOUTES les données sont accessibles :

1. **Créer table `price_history`** : `(market_id TEXT, timestamp INT, price FLOAT, bracket_id INT)`
2. **Script de fetch** : pour chaque bracket dans `poly_markets`, requête CLOB avec `startTs/endTs/fidelity=5`
3. **Estimation** : ~7 085 requêtes, ~0.3s/req = ~35 min
4. **Résultat** : courbe de prix complète pour chaque bracket

### Priorité 2 : Feature engineering

5. **Joindre** les données : bracket (outcome, volume) + prix (courbe) + WU (temp actuelle)
6. **Features candidates** :
   - `temp_max_c` du jour (WU)
   - `temp_max_c` des jours J-1, J-2, J-3 (WU, tendance)
   - Écart à la moyenne saisonnière
   - Prix d'ouverture du bracket (CLOB)
   - Volume du bracket
   - Nombre de brackets dans l'event
   - Position du bracket (ex: "above 10°C" vs "between 5-6°C")

### Priorité 3 : Premier modèle

7. **Dataset** : 952 events résolus × ~7 brackets = ~7000 samples
8. **Target** : `winner` (binary) ou `last_trade_price`
9. **Modèle** : XGBoost ou régression logistique
10. **Évaluation** : Brier score, accuracy, profit simulé vs. odds du marché
