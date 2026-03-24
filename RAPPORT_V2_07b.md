# RAPPORT V2_07b — Analyse qualité des données prix

**Date** : 2026-03-24

---

## Le problème observé

En regardant les courbes sur la page Data, on voit que les données s'arrêtent à des heures incohérentes :
- London 18 mars → courbe s'arrête le 18 à 11:30 UTC
- London 19 mars → courbe s'arrête le 19 à 22:55 UTC
- NYC 22 mars → courbe s'arrête le 22 à 22:55 UTC (= 17:55 local)

Pourquoi les courbes ne vont pas jusqu'à la résolution du marché ?

---

## Analyse

### 1. Quand les marchés se résolvent-ils ?

Via l'API Gamma, le champ `endDate` de TOUS les marchés est **12:00 UTC** le jour de la target_date. Ça ne correspond pas à minuit local — c'est une valeur fixe.

Mais en réalité, **la résolution se fait quand Wunderground publie les données du jour** (la source officielle de résolution). WU publie typiquement :
- Entre 02:00 et 08:00 UTC pour NYC (= soir/nuit local du target_date)
- Entre 02:00 et 14:00 UTC pour London (= nuit/matin suivant)
- Entre 17:00 et 05:00 UTC pour Seoul (= nuit locale)

Le dernier trade se fait juste avant la résolution. Après résolution, le prix passe à 0.001 (perdant) ou 0.999 (gagnant) et plus personne ne trade.

### 2. Pourquoi certaines courbes sont coupées ?

Le script `v2_06_fetch_prices.py` utilisait cette fenêtre :
```
startTs = created_at - 1 jour
endTs   = target_date + 1 jour (= minuit UTC du lendemain)
```

Pour la grande majorité des marchés, c'est suffisant car le dernier trade se fait **avant minuit UTC du lendemain**. Mais pour certains cas :

| Situation | endTs (UTC) | Dernier trade possible | Coupé ? |
|-----------|------------|----------------------|---------|
| London, résolution tardive | J+1 00:00 | Jusqu'à J+0 23:00 UTC | Parfois (7/50 = 14%) |
| NYC, résolution tardive | J+1 00:00 | Jusqu'à J+1 07:00 UTC (= 02:00 local) | Rarement (2/49 = 4%) |
| Seoul | J+1 00:00 | Jusqu'à J+0 18:00 UTC max | Non (0/50) |

### 3. Test en direct : données manquantes confirmées

En re-fetchant avec une fenêtre étendue (+2 jours au lieu de +1) :

| Event | Points old | Points new | Extra | Données manquantes |
|-------|-----------|-----------|-------|-------------------|
| NYC 22 mars | 1 299 | 1 404 | **+105** | Oui, jusqu'à 02:40 local (07:40 UTC) |
| NYC 21 mars | 1 091 | 1 091 | 0 | Non |
| NYC 20 mars | 1 225 | 1 225 | 0 | Non |
| London 19 mars | 1 301 | 1 354 | **+53** | Oui, jusqu'à 03:40 UTC |
| London 22 mars | 1 180 | 1 180 | 0 | Non |
| London 18 mars | 1 166 | 1 166 | 0 | Non |

→ Environ **10% des events** ont des données coupées (~1-8h manquantes).

### 4. Les heures de fin sont naturellement variables

Même sans le problème de fenêtre, les courbes ne s'arrêtent PAS toutes à la même heure, car :
- Le dernier trade dépend de quand quelqu'un trade pour la dernière fois
- La résolution de Polymarket dépend de quand WU publie les données
- WU publie à des heures variables (souvent entre 02:00 et 08:00 UTC)

**Statistiques des heures de fin (heure locale) :**

| Ville | Min | Max | Moyenne | Médiane ~  |
|-------|-----|-----|---------|-----------|
| London | 02:30 | 22:55 | 09:36 | ~03:00 |
| NYC | 01:15 | 23:50 | 08:30 | ~02:30 |
| Seoul | 02:05 | 18:15 | 09:24 | ~03:00 |

La majorité des marchés se terminent **entre 02:00 et 04:00 heure locale** du lendemain du target_date.

---

## Cycle de vie d'un marché météo Polymarket

```
J-3  10:00 UTC  │ Marché créé (toutes les villes, toujours ~10:00 UTC)
     ...        │ Trading commence
J-0  (journée)  │ target_date — la météo se produit
J-0  ~23:59     │ Fin de la journée heure locale
J+1  02:00-08:00│ Wunderground publie les données du jour
J+1  ~03:00     │ Polymarket résout le marché
J+1  ~03:00     │ Dernier trade (prix → 0.001 ou 0.999)
```

---

## Plan de correction

### Étape 1 : Re-fetch avec fenêtre corrigée

Modifier le endTs pour couvrir jusqu'à **minuit local + 12h de marge** :

```python
# Par ville, en UTC:
RESOLUTION_BUFFER = {
    "EGLC": 2,  # London UTC+0 → minuit + 12h = +12h UTC = target+2 jours pour être safe
    "KLGA": 2,  # NYC UTC-5 → minuit local = 05:00 UTC → +12h = 17:00 UTC J+1 → target+2 jours
    "RKSI": 1,  # Seoul UTC+9 → minuit local = 15:00 UTC → +12h = 03:00 UTC J+1 → target+1 jour suffit
}
# Nouveau: endTs = target_date + 2 jours pour London/NYC, +1 jour pour Seoul
```

### Étape 2 : Script de patch

Ne refetcher que les events potentiellement coupés (~10% = ~100 events), pas les 7085 brackets :

1. Pour chaque event, comparer le `last_ts` en DB avec `endTs` utilisé
2. Si `last_ts` est à < 10 min de `endTs` → probablement coupé → re-fetch avec fenêtre étendue
3. Ne mettre à jour QUE les brackets coupés

### Étape 3 : Pour les futures fetchs

Utiliser systématiquement `endTs = target_date + 2 jours` pour toutes les villes. Le surplus de données (entre résolution et endTs) ne coûte que quelques points en plus et garantit de ne rien couper.

---

## Ce qui marche bien

- **100% des brackets** ont des données de prix (7085/7085)
- **Span moyen** : 30-100h de trading par event (suffisant pour le modèle)
- **Granularité** : 5 min (700 pts par bracket en moyenne)
- **Timezones** : les timestamps sont en UTC dans la DB, la conversion est correcte
- **Création des marchés** : très régulière, toujours à ~10:00 UTC, J-3

## Ce qui est à corriger

- **~100 events** (~10%) ont 1-8h de données coupées en fin de courbe
- **Impact** : on perd les derniers trades avant résolution — justement la partie la plus intéressante pour le modèle (convergence du prix vers 0 ou 1)
- **Effort** : ~30 min de re-fetch ciblé (100 events × ~7 brackets × 1 requête)

---

## Prochaine étape : V2_08

1. Script de patch pour re-fetch les ~100 events coupés avec `endTs + 2 jours`
2. Vérification que toutes les courbes vont bien jusqu'au dernier trade
3. Puis : feature engineering + modèle
