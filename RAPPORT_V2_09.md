# RAPPORT V2_09 — Investigation heures de fin + correction

**Date** : 2026-03-24

---

## 1. Investigation : DB vs API réelle

Comparé les données en DB (endTs = target_date + 1 jour UTC) vs l'API CLOB avec fenêtre +3 jours, sur 3 périodes.

### Semaine février 2025 (anciens marchés)

| Ville | Date | DB fin UTC | API fin UTC | API fin local | Extra pts | Status |
|-------|------|-----------|-------------|--------------|-----------|--------|
| London | 10 fév | 22:55 | 11 fév 04:00 | 04:00 | +pts | OK (convergé) |
| London | 12 fév | 22:55 | 13 fév 04:30 | 04:30 | +pts | OK |
| London | 14 fév | 22:55 | 15 fév 04:20 | 04:20 | +pts | OK |
| London | 16 fév | 22:55 | 17 fév 04:30 | 04:30 | +pts | OK |
| NYC | 11 fév | 22:55 | 12 fév 09:40 | 04:40 | +pts | OK |
| NYC | 12 fév | 22:55 | 13 fév 09:40 | 04:40 | OK (p=0.005) |
| NYC | 15 fév | 22:55 | 16 fév 10:20 | 05:20 | +pts | OK (p=0.049) |
| NYC | 16 fév | 22:55 | 17 fév 03:30 | 22:30 | +pts | OK (p=0.027) |

### Semaine juillet 2025 (été)

| Ville | Date | DB fin UTC | API fin UTC | Extra | Status |
|-------|------|-----------|-------------|-------|--------|
| London | 15 jul | 21:55 | 16 jul 02:30 | +pts | OK |
| London | 16 jul | 21:55 | 17 jul 02:30 | +pts | OK |
| NYC | 14 jul | 21:55 | 15 jul 08:00 | +pts | OK |
| NYC | 16 jul | 21:55 | 17 jul 08:00 | +pts | OK |
| NYC | 19 jul | 21:55 | 20 jul 08:00 | +pts | OK |
| NYC | 20 jul | 21:55 | 21 jul 08:00 | +pts | OK |

### Semaine mars 2026 (récents)

| Ville | Date | DB fin UTC | API fin UTC | Extra | Status |
|-------|------|-----------|-------------|-------|--------|
| London | 10 mar | 22:55 | 11 mar 03:10 | +pts | OK |
| London | 14 mar | 22:55 | 15 mar 04:10 | +pts | OK |
| NYC | 16 mar | 22:55 | 17 mar 06:45 | +94pts | **CUT** (DB p=0.750) |
| Seoul | tous | OK | OK | 0 | OK |

### Synthèse 3 semaines (48 events)

| Métrique | Valeur |
|----------|--------|
| Events testés | 48 |
| Convergés en DB | 47 (98%) |
| Coupés (DB price 5-95%) | 1 (2%) |
| **API a des données après notre endTs** | **19 (40%)** |

---

## 2. Le vrai problème

Le script V2_06 utilisait `endTs = target_date + 1 jour` = **minuit UTC du lendemain**.

- **London (UTC+0)** : minuit UTC = minuit local → la plupart des marchés se résolvent vers 03-04h local → on coupe les dernières ~4h. Mais souvent le prix a DÉJÀ convergé à 22:55 → "OK" techniquement mais on rate les derniers trades.
- **NYC (UTC-5)** : minuit UTC = **19:00 local** → on coupe **5h avant minuit local** et **~10h avant la résolution** (qui arrive vers 03-05h local = 08-10h UTC). C'est le vrai problème.
- **Seoul (UTC+9)** : minuit UTC = 09:00 local du lendemain → largement après la résolution (~03h local) → OK.

### Pattern des 22:55 UTC

Tous les brackets coupés finissent exactement à **22:55 UTC**. C'est le dernier point de prix avant notre `endTs` de minuit UTC (22:55 + 5 min fidelity = 23:00, plus rien après car on approche de l'endTs).

---

## 3. Scan complet : combien de brackets sont vraiment incomplets ?

Scan de tous les brackets résolus (test: dernière price entre 5% et 95%) :

| Ville | Total brackets | Incomplets | % | Events touchés |
|-------|---------------|------------|---|----------------|
| London | 3 055 | 23 | 0.8% | 15 |
| NYC | 3 034 | **243** | **8.0%** | **137** |
| Seoul | 849 | 0 | 0% | 0 |
| **Total** | **6 938** | **266** | **3.8%** | **152** |

NYC concentre **91% des problèmes** (243/266) car c'est la seule ville où le décalage horaire (UTC-5) fait que minuit UTC tombe bien avant la résolution.

---

## 4. Correction : re-fetch ciblé

### Méthode
- Identifié les 266 brackets incomplets exactement
- Re-fetch depuis l'API CLOB avec `endTs = target_date + 2 jours`
- Inséré uniquement les points APRÈS le dernier point en DB

### Résultats

| Métrique | Valeur |
|----------|--------|
| Brackets re-fetchés | 266 |
| Brackets corrigés | **264** (99.2%) |
| Encore incomplets | 2 (marchés à très faible volume, pas de trades post-résolution) |
| Points ajoutés | **+39 187** |
| Temps | 2 min |

### Vérification
- Sample 20/20 brackets → tous convergés maintenant
- Les courbes vont maintenant jusqu'à p=0.001 (perdant) ou p=1.000 (gagnant)

---

## 5. Heures de résolution réelles

Analysées via l'API CLOB (heure du dernier trade, heure locale) :

| Ville | Min | Médiane | Max |
|-------|-----|---------|-----|
| London | 02:30 | 04:18 | 16:06 |
| NYC | 01:12 | 04:42 | 22:30 |
| Seoul | 02:24 | 03:54 | 13:36 |

→ La majorité des marchés se résolvent **entre 03:00 et 05:00 heure locale** du lendemain, quand Wunderground publie les données.

---

## 6. État final

| Table | Lignes | Delta |
|-------|--------|-------|
| `price_history` | ~5 018 626 | +39 187 pts |
| Brackets convergés | 6 936/6 938 | 99.97% |

### Pour les futurs fetchs

Utiliser **`endTs = target_date + 2 jours`** pour toutes les villes. Ça couvre largement la résolution même pour NYC.

---

## 7. Plan V2_10

Les données sont maintenant propres et complètes. Prochaine étape :
1. Feature engineering : joindre prix + temp WU + metadata brackets
2. Premier modèle prédictif (XGBoost)
3. Évaluation : Brier score, accuracy, profit simulé
