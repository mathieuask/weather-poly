# ANALYSIS.md — Weather Arb System
## Document complet pour analyse externe

**Projet** : Arbitrage de marchés météo sur Polymarket via modèles GFS+ICON  
**Repo** : https://github.com/mathieuask/weather-poly  
**Dashboard** : https://frontend-two-xi-86.vercel.app  
**Date** : 2026-03-19 (jour 1 du système)

---

## 1. CONCEPT DE BASE

### L'opportunité

Polymarket propose des marchés de température journalière :
> "Quelle sera la température maximale à Seoul le 21 mars ?"

Le marché est structuré en **brackets mutuellement exclusifs** :
```
≤4°C : 0%  |  5°C : 1%  |  6°C : 1%  |  ... |  ≥14°C : 32%
```
Un seul bracket résout YES. Tous les autres résolvent NO.

### Notre edge supposé

Les traders Polymarket utilisent des apps météo grand public (weather.com, iPhone Météo). Nous utilisons **30 membres GFS + 39 membres ICON = 69 membres d'ensemble** via Open-Meteo (gratuit). Quand nos 69 modèles convergent fortement vers une température ET que le marché price différemment → **edge = GFS_prob - prix_marché**.

### Exemple concret

Seoul 22 mars :
- **GFS+ICON** : moy=10.2°C, min=8.1, max=12.3 → 0% de chance d'atteindre ≥14°C
- **Marché** : 32% pour ≥14°C
- **Signal** : acheter NO sur ≥14°C à 68.5¢ → EV = +0.31

---

## 2. ARCHITECTURE TECHNIQUE

### Fichiers clés

```
/root/weather-poly/
├── backend/
│   ├── scanner.py       ← cœur : Polymarket → GFS+ICON → signaux
│   ├── tracker.py       ← paper trading : crée trades, check résolutions
│   ├── autoresearch.py  ← analyse quotidienne autonome
│   ├── cities.json      ← 12 villes avec coordonnées + timezones
│   ├── signals.json     ← signaux actuels (mis à jour toutes les 30 min)
│   ├── results.json     ← paper trades + stats (mis à jour toutes les 30 min)
│   └── tracker.db       ← SQLite : signal_log, paper_trades, resolutions
└── frontend/
    ├── app/page.tsx     ← dashboard signaux (Next.js + Tailwind)
    └── app/results/     ← page résultats paper trading
```

### Flux de données

```
[Open-Meteo GFS+ICON] → scanner.py → signals.json → [GitHub] → [Vercel dashboard]
                                   ↓
                             tracker.py → tracker.db → results.json → [dashboard Résultats]
                                   ↓
                         [Polymarket API résolutions] → win/loss → PnL calculé
```

### Crons actifs (serveur Linux)

```bash
*/30 * * * *  scanner.py   # signaux frais toutes les 30 min
*/30 * * * *  sleep 90 && tracker.py  # paper trades + résolutions
0 8 * * *     autoresearch (OpenClaw cron)  # rapport Telegram quotidien
0 9 * * 1     autoresearch hebdo (OpenClaw cron)  # analyse semaine
```

---

## 3. PARAMÈTRES ACTUELS

```python
MIN_EDGE  = 5.0    # % minimum pour afficher un signal
MIN_LIQ   = 100.0  # $ minimum de liquidité sur le bracket
MIN_HOURS = 6.0    # heures avant résolution (en dessous → skip)
PAPER_AMOUNT = 10.0  # $ simulé par trade (paper trading)

# Modèles utilisés
GFS   : 30 membres (Open-Meteo gfs_seamless)
ICON  : 39 membres (Open-Meteo icon_seamless)
Total : 69 membres blendés (poids égaux)
```

### Qualité des signaux (badge dashboard)
- **⭐ Fort** : edge ≥ 20% ET liq ≥ $500 ET bracket end-band (≤X ou ≥X)
- **Moyen** : edge ≥ 10% ET liq ≥ $200
- **Faible** : tout le reste

### Priorité de tri
1. End-bands (≤X / ≥X) EN PREMIER — prouvé plus fiables (doc académique)
2. Puis par |edge| décroissant

---

## 4. STRUCTURE DES MARCHÉS POLYMARKET

### Brackets et résolution

```
Polymarket température = brackets mutuellement exclusifs
Le plus bas ouvert (closed=False) = "X°C or below"  ← lte
Le plus haut ouvert (closed=False) = "X°C or higher" ← gte
Tous les autres = brackets exacts (ex: "exactly 14°C")

Résolution via : Weather Underground, station aéroport
Ex: Seoul → RKSI (Incheon Airport)
```

### API utilisée

```python
# Marchés actifs
GET https://gamma-api.polymarket.com/events?active=true&limit=200&tag_slug=temperature

# Champs importants par bracket
m["closed"]          # True = bracket fermé (ne pas utiliser)
m["liquidity"]       # $ en pool AMM
m["outcomePrices"]   # '["0.28", "0.72"]' → prix YES/NO (JSON string!)
m["conditionId"]     # ID unique du bracket
```

---

## 5. CALCUL DE PROBABILITÉ GFS

### Formule par type de bracket

```python
# Pour bracket exact (ex: "14°C exact")
count = sum(1 for t in members if 13.5 <= t < 14.5)
prob = count / len(members) * 100

# Pour bracket lte (ex: "≤13°C or below")
count = sum(1 for t in members if t <= 13.5)
prob = count / len(members) * 100

# Pour bracket gte (ex: "≥14°C or higher")
count = sum(1 for t in members if t >= 13.5)
prob = count / len(members) * 100
```

### Timezone locale (CRITIQUE)

Open-Meteo doit recevoir le timezone de la ville pour que `temperature_2m_max` 
corresponde au jour LOCAL (pas UTC).

```python
Seoul     → Asia/Seoul      (UTC+9)
Tokyo     → Asia/Tokyo      (UTC+9)
NYC       → America/New_York (UTC-5/4)
Paris     → Europe/Paris    (UTC+1/2)
...
```
**Sans ça : le "max du 21 mars" en UTC ≠ max local → erreurs systématiques.**

---

## 6. PAPER TRADING — FONCTIONNEMENT DÉTAILLÉ

### Création automatique

```python
# Pour chaque signal avec condition_id jamais vu → crée un trade
paper_trades = {
    condition_id: unique,    # 1 trade par bracket (pas de doublons)
    amount: $10,             # montant simulé fixe
    direction: "YES"/"NO",   # selon l'edge
    entry_price: float,      # prix au moment du signal
    result: "pending",       # → sera mis à jour à la résolution
}
```

### Résolution automatique

```python
# Appel API toutes les 30 min pour les trades pending dont date <= today
GET https://gamma-api.polymarket.com/markets/{condition_id}

# Si resolved=True
winner = data["winner"]  # "YES" ou "NO"

# Calcul PnL
if win:
    pnl = amount / entry_price - amount  # ex: $10 / 0.285 - $10 = +$25.1
else:
    pnl = -amount  # ex: -$10
```

### Base de données

```sql
-- tracker.db (SQLite)

signal_log      -- chaque signal généré (historique complet)
paper_trades    -- 1 ligne par condition_id, mis à jour à résolution  
resolutions     -- cache des résolutions Polymarket
```

---

## 7. ÉTAT ACTUEL (2026-03-19, jour 1)

### Signaux

- **169 signaux actifs** (5-day lookahead)
- Villes : Madrid, Paris, London, NYC, Chicago, Toronto, Seoul, Tokyo, Singapore, Buenos Aires, Miami, Taipei
- Top signals du jour :

| Ville | Bracket | Dir | GFS% | Marché% | Edge | Liq |
|-------|---------|-----|------|---------|------|-----|
| Seoul | ≥14°C | NO | 0% | 32% | -32% | $3,564 |
| Seoul | 12°C | NO | 0% | 28% | -28% | $1,504 |
| Tokyo | 17°C | YES | 44% | 12% | +32% | $1,215 |
| Seoul | 11°C | NO | 3% | 28% | -25% | ~$1k |

### Paper trades

- **205 trades créés** (créés depuis début du système)
- **0 résolus** (jour 1, marchés pas encore clôturés)
- Premiers résultats attendus : demain 20 mars (Seoul, Tokyo, Madrid)

---

## 8. PROBLÈMES IDENTIFIÉS

### 8.1 Biais GFS sur Seoul (CRITIQUE, non résolu)

**Observation :**
- Seoul 20-22 mars : GFS prédit 7.8-10.2°C
- Marché : consensus 10-13°C (mode autour de 11-12°C)
- Écart systématique : **+3 à +4°C** entre GFS et marché

**Hypothèses :**
1. GFS a un biais froid sur Seoul en mars (jet stream, influence continentale ?)
2. Les traders utilisent KMA (Korean Meteorological Administration) qui est plus précise
3. Bug timezone (vérifié et corrigé, mais l'écart persiste)

**Impact :** Si GFS est froid de 3-4°C sur Seoul, tous les signaux Seoul sont FAUX.

**Résolution :** Attendre les résolutions du 20-22 mars. Si GFS rate de 3-4°C → blacklister Seoul.

### 8.2 Même question pour Singapore

**Observation :**
- Singapore : GFS prédit 30-31°C, marché dit 32-34°C
- Écart : +2 à +3°C systématique
- Explication probable : biais tropical GFS (humidité, convection)

### 8.3 Qualité des signaux end-band vs exact

**Non encore testé empiriquement :**
La doc académique (Bürgi et al.) dit que les end-bands (≤X/≥X) ont les signaux les plus solides. Mais nous n'avons pas encore de données de résolution pour valider.

### 8.4 Impact price non calculé

Sur un marché à $300 de liquidité, acheter $10 déplace le prix de ~3%. On ne le calcule pas actuellement. Pour les petits marchés, le prix d'entrée que nous voyons ≠ prix d'exécution réel.

---

## 9. CE QU'ON NE SAIT PAS ENCORE

1. **GFS est-il calibré pour Seoul/Tokyo en mars ?**
   → Réponse dans 24-48h

2. **Les end-bands performent-ils mieux que les brackets exacts ?**
   → Réponse dans 2-3 semaines (25+ trades résolus par catégorie)

3. **Le blend GFS+ICON est-il meilleur que GFS seul ?**
   → Réponse dans 4 semaines (comparaison A/B impossible en l'absence de données)

4. **MIN_EDGE optimal : 5% ? 10% ? 15% ?**
   → Réponse dans 4-6 semaines (courbe edge vs win rate)

5. **Les marchés à liq < $500 sont-ils tradables en pratique ?**
   → Impact price à mesurer. Un achat de $10 sur $300 de liq = 3.3% de la pool

---

## 10. QUESTIONS POUR L'ANALYSTE

### Sur la stratégie

1. **Le biais GFS sur Seoul est-il documenté ?** Existe-t-il une correction connue pour les modèles globaux en Corée du Sud en mars ?

2. **La formule de probabilité GFS est-elle correcte ?** Pour un bracket exact "14°C", on compte les membres dans [13.5, 14.5). La résolution Polymarket utilise probablement des températures arrondies à 1°C. Est-ce aligné ?

3. **L'EV est-il calculé correctement ?**
   ```python
   # Pour NO :
   prob_win = (100 - gfs_prob) / 100  # prob que le bracket ne se réalise pas
   ev = prob_win * (1 - entry_price) - (1 - prob_win) * entry_price
   ```
   Est-ce la bonne formule ? On ne prend pas en compte les frais AMM Polymarket (0-2%).

4. **Le blend GFS+ICON à poids égaux est-il optimal ?** La doc dit ECMWF devrait être pondéré 1.2× et HRRR à 1.3× pour les marchés intraday. Devrait-on pondérer ICON différemment de GFS ?

### Sur le tracking des résultats

5. **Le calcul PnL est-il correct ?**
   ```python
   # Win : on a acheté YES à entry_price, ca résout à 1.0
   pnl = amount / entry_price - amount
   # Ex: $10 / 0.285 = $35.09 retour → PnL = +$25.09
   
   # Lose : on perd la mise
   pnl = -amount
   ```

6. **La résolution Polymarket est-elle détectée correctement ?**
   ```python
   GET /markets/{condition_id}
   # On regarde winner="YES" ou winner="NO"
   # Fallback: outcomePrices[0] > 0.5 → YES
   ```
   Y a-t-il des edge cases où winner est null même après résolution ?

7. **La méthode paper trading $10 fixe est-elle représentative ?** Devrait-on utiliser Kelly sizing simulé pour avoir des stats plus réalistes ?

### Sur les améliorations prioritaires

8. **Que faire en attendant les premières résolutions ?**
   - Backtest sur données historiques (Open-Meteo Historical Forecast API existe) ?
   - Analyser des marchés déjà résolus manuellement ?
   - Autre chose ?

9. **Comment détecter le biais GFS par ville avec seulement 20-30 trades résolus ?**
   - Régression linéaire gfs_mean vs actual_temp par ville ?
   - Test statistique minimum ?

10. **Est-ce que l'approche est fondamentalement viable ?**
    - La doc académique dit "no longshot bias on Polymarket" (contrairement à Kalshi)
    - Ça veut dire qu'acheter YES à 2¢ n'est PAS systématiquement mauvais sur Polymarket
    - Mais est-ce que les marchés météo Polymarket spécifiquement ont un longshot bias ?
    - Avec $300-3500 de liquidité par bracket, les AMMs sont-ils efficacement pricés ?

---

## 11. DONNÉES DISPONIBLES POUR ANALYSE

### Live
- Signaux : https://raw.githubusercontent.com/mathieuask/weather-poly/master/frontend/public/signals.json
- Résultats : https://raw.githubusercontent.com/mathieuask/weather-poly/master/frontend/public/results.json

### Code source
- Scanner : https://github.com/mathieuask/weather-poly/blob/master/backend/scanner.py
- Tracker : https://github.com/mathieuask/weather-poly/blob/master/backend/tracker.py
- Spec complète : https://github.com/mathieuask/weather-poly/blob/master/SPEC.md

### Base de données (accès serveur)
```bash
sqlite3 /root/weather-poly/backend/tracker.db
.tables  # signal_log, paper_trades, resolutions
SELECT * FROM paper_trades ORDER BY opened_at DESC LIMIT 10;
```

---

## 12. RÉSUMÉ EN UNE PHRASE

Système de paper trading sur marchés météo Polymarket — **169 signaux actifs, 205 trades créés, 0 résolus au jour 1** — qui utilise 69 modèles GFS+ICON pour trouver des divergences vs prix AMM, avec un doute majeur sur le biais froid GFS pour Seoul (+3-4°C d'écart systématique vs marché) qui sera validé ou infirmé dans 24-48h.

**Verdict attendu sur la viabilité : 20-21 mars 2026.**
