# RAPPORT V2_10 — Pipeline live

**Date** : 2026-03-24

---

## Fichier créé

`pipeline.py` — 4 fonctions :

| Commande | Description | Fréquence |
|----------|-------------|-----------|
| `prices` | Fetch prix des marchés ouverts depuis le dernier point en DB | Toutes les 5 min |
| `events` | Détecter les nouveaux events Polymarket pour London/NYC/Seoul | 10h30 UTC |
| `resolutions` | Vérifier si des marchés sont résolus → update winners + fetch WU | 08h00 UTC |
| `backfill` | One-shot : combler le trou entre le dernier fetch et maintenant | Manuel |

---

## Backfill (one-shot)

- Brackets comblés : 165
- Points ajoutés : +737
- Trou comblé : 24 mars ~21h UTC → 24 mars 22:44 UTC

---

## Crontab installé

```
*/5 * * * * cd ~/Desktop/weather-poly && python3 pipeline.py prices >> logs/pipeline.log 2>&1
30 10 * * * cd ~/Desktop/weather-poly && python3 pipeline.py events >> logs/pipeline.log 2>&1
0 8 * * * cd ~/Desktop/weather-poly && python3 pipeline.py resolutions >> logs/pipeline.log 2>&1
```

### Premier run automatique

```
[2026-03-24 22:55:03 UTC] prices: 147 brackets ouverts
[2026-03-24 22:56:06 UTC] prices: +218 points insérés
```

---

## Test

| Ville | Dernier point | Retard |
|-------|--------------|--------|
| London | 24 Mar 22:54 UTC | 3 min |
| NYC | 24 Mar 22:55 UTC | 2 min |
| Seoul | 24 Mar 22:55 UTC | 2 min |

---

## Page Data mise à jour

Les marchés ouverts affichent maintenant "updated Xmin ago" à côté du badge OPEN, pour vérifier visuellement que le cron tourne.

---

## Prêt : oui
