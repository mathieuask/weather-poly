# Weather Arb — Spec

## Principe

On exploite un écart entre les **modèles météo GFS** (30 membres) et les **marchés de température Polymarket**.

Les traders Polymarket ne consultent pas les modèles. Quand 25/30 modèles s'accordent sur une température, le marché est souvent mal pricé.

**Edge = probabilité GFS − prix Polymarket**

Si edge > 0 → acheter YES. Si edge < 0 → acheter NO.

---

## Stack

- **Backend** : Python 3, zéro dépendance externe sauf `requests`
- **Frontend** : Next.js + Tailwind, une seule page
- **Données météo** : Open-Meteo Ensemble API (gratuit, pas de clé)
- **Données marchés** : Polymarket Gamma API (gratuit, pas de clé)
- **Source de résolution** : Weather Underground (station aéroport)

---

## Backend — `backend/scanner.py`

### Ce qu'il fait

1. Appelle l'API Polymarket pour lister les marchés météo actifs
2. Pour chaque ville, récupère les 30 membres GFS via Open-Meteo
3. Calcule la probabilité par bracket de température
4. Compare au prix AMM → calcule l'edge
5. Sauvegarde `backend/signals.json` + `frontend/public/signals.json`

### API Polymarket

```
GET https://gamma-api.polymarket.com/events
  ?active=true
  &limit=200
  &tag_slug=temperature
  &order=endDate
  &ascending=false
```

Chaque event a un tableau `markets[]`. Chaque market a :
- `question` : ex. "Will the highest temperature in London be 14°C on March 20?"
- `outcomePrices` : string JSON ex. `'["0.30", "0.70"]'` → parser avec `json.loads()`
- `liquidity` : float, filtrer < 100
- `conditionId` : identifiant unique du marché
- `resolutionSource` : URL Wunderground

### API Open-Meteo Ensemble

```
GET https://ensemble-api.open-meteo.com/v1/ensemble
  ?latitude=51.5048
  &longitude=-0.0495
  &daily=temperature_2m_max
  &models=gfs_seamless
  &forecast_days=7
  &timezone=UTC
```

Réponse : `daily.time[]` (dates) + `daily.temperature_2m_max_member01[]` ... `member30[]`

Pour chaque membre, prendre la valeur à l'index correspondant à la date cible.

⚠️ Les membres sont toujours en **°C**. Convertir en °F si besoin : `F = C × 9/5 + 32`

### Calcul des brackets

| Question contient | Opérateur | Calcul |
|---|---|---|
| "X°C or below" | `lte` | `count(membres ≤ X + 0.5)` |
| "X°C or higher" | `gte` | `count(membres ≥ X - 0.5)` |
| "be X°C on" | `exact` | `count(X - 0.5 ≤ membre < X + 0.5)` |

Probabilité = count / 30 × 100

### Calcul de l'edge et de l'EV

```python
edge = gfs_prob - market_prob  # en %

direction = "YES" if edge > 0 else "NO"
entry_price = market_prob / 100 if direction == "YES" else (100 - market_prob) / 100
payout = 1 - entry_price

prob = gfs_prob / 100
ev = prob * payout - (1 - prob) * entry_price
```

### Villes

| Ville | Lat | Lon | Station | Unité |
|-------|-----|-----|---------|-------|
| Madrid | 40.4936 | -3.5668 | LEMD | C |
| Paris | 49.0097 | 2.5478 | LFPG | C |
| London | 51.5048 | -0.0495 | EGLC | C |
| New York | 40.7769 | -73.874 | KLGA | F |
| Chicago | 41.9742 | -87.9073 | KMDW | F |
| Toronto | 43.6772 | -79.6306 | CYYZ | C |
| Seoul | 37.4602 | 126.4407 | RKSI | C |
| Tokyo | 35.5494 | 139.7798 | RJTT | C |
| Singapore | 1.3644 | 103.9915 | WSSS | C |
| Buenos Aires | -34.5597 | -58.4116 | SAEZ | C |
| Miami | 25.7959 | -80.287 | KMIA | F |
| Taipei | 25.0777 | 121.2331 | RCTP | C |

⚠️ Le nom Polymarket peut être "New York City" → chercher "new york" dans le titre en lowercase.

### Format de `signals.json`

```json
{
  "generated_at": "2026-03-19T19:00:00+00:00",
  "total_signals": 131,
  "signals": [
    {
      "city": "London",
      "date": "2026-03-20",
      "bracket": "14°C",
      "direction": "YES",
      "gfs_prob": 60.0,
      "market_prob": 29.5,
      "edge": 30.5,
      "entry_price": 0.295,
      "payout": 0.705,
      "ev": 0.127,
      "liquidity": 404,
      "question": "Will the highest temperature in London be 14°C on March 20?",
      "condition_id": "0xabc...",
      "wunderground": "https://www.wunderground.com/history/daily/EGLC"
    }
  ]
}
```

Triés par `|edge|` décroissant.

---

## Frontend — `frontend/`

### Page principale (`app/page.tsx`)

Fetch au chargement :
```ts
fetch("/signals.json")  // fichier statique dans public/
```

Pas d'API route, pas de backend requis côté Next.js.

### Layout

```
┌─────────────────────────────────┐
│ 🌤 Weather Arb        131 signaux│
│ Dernière maj : 19:20 UTC         │
├─────────────────────────────────┤
│ [ALL] [YES] [NO]  Edge min: 10% │
│ Date: [Toutes ▾]                 │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ London · 14°C  YES  +30.5% │ │
│ │ ven. 20 mars · liq $404    │ │
│ │                             │ │
│ │ Modèles ████████████ 60%   │ │
│ │ Marché  ██████      30%    │ │
│ │                             │ │
│ │ Wunderground →    EV +0.13 │ │
│ └─────────────────────────────┘ │
│ ...                             │
└─────────────────────────────────┘
```

### Filtres

- **Direction** : ALL / YES / NO (toggle buttons)
- **Edge min** : dropdown 5% / 10% / 15% / 20% / 30%
- **Date** : dropdown généré depuis les dates dans signals.json ("Toutes", "20 mars", "21 mars"...)

### Couleurs des badges edge

| Edge | Couleur |
|------|---------|
| ≥ 20% | Vert |
| ≥ 10% | Jaune |
| < 10% | Gris |

### Barres de probabilité

- Barre bleue = GFS (modèles)
- Barre orange = Polymarket (marché)
- Largeur proportionnelle au % (0–100%)

### Bouton Actualiser

Refait le `fetch("/signals.json")` sans recharger la page.

---

## Lancer le projet

```bash
git clone https://github.com/mathieuask/weather-poly
cd weather-poly

# Scan (génère signals.json)
python3 -m venv venv
venv/bin/pip install requests
venv/bin/python3 backend/scanner.py

# Dashboard
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

---

## Ce qu'on ne fait PAS encore

- Pas d'exécution automatique des trades
- Pas de paper trading / suivi des résultats
- Pas de déploiement (tout tourne en local)
