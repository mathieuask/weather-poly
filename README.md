# weather-poly

Scanner d'arbitrage météo sur Polymarket.

## Principe

1. Récupère tous les marchés météo actifs sur Polymarket
2. Pour chaque marché, interroge les 30 modèles GFS via Open-Meteo
3. Calcule la probabilité réelle par bracket de température
4. Compare avec le prix AMM Polymarket → edge = modèle − marché
5. Affiche les meilleurs signaux du jour

## Stack

- **Backend** : Python 3 — `scanner.py`
- **Frontend** : Next.js — dashboard simple, une page

## Lancer le backend

```bash
cd backend
pip install -r requirements.txt
python scanner.py
# → génère signals.json
```

## Lancer le frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```
