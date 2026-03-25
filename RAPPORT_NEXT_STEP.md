# Tache — Ajouter 2 courbes : Intemperies + Score de Confiance

## Contexte projet

### Ce qu'on a
- App Next.js 16.2 + React 19 + Recharts + Supabase
- 3 villes : London (EGLC, °C), NYC (KLGA, °F), Seoul (RKSI, °C)
- **143 membres ensemble** (GFS 31, ECMWF 51, ICON 40, GEM 21) fetches toutes les heures automatiquement via Edge Function
- Table `ensemble_forecasts` : chaque ligne = 1 membre, 1 date cible, 1 timestamp de fetch, 20 variables meteo
- Frontend `app/data/page.tsx` (1041 lignes) avec deja 2 courbes Recharts

### Les 2 courbes existantes
- **Courbe 1 (haut)** : Prix Polymarket — evolution des probabilites marche par bracket (LineChart, meme couleur par bracket, tooltip crosshair custom, axe X = timestamps epoch)
- **Courbe 2** : Model Prediction — notre probabilite par bracket calculee depuis les 143 membres (meme design exact que courbe 1, meme axe X, meme tooltip)

### Donnees disponibles dans ensemble_forecasts (par membre)
```sql
temp_max, temp_min, temp_mean,
apparent_temp_max, apparent_temp_min,
dew_point_max, dew_point_min,
wind_speed_max, wind_gusts_max, wind_direction,
precipitation, rain, snowfall,
humidity_max, humidity_min, humidity_mean,
pressure_msl, cloud_cover, radiation
```

### Ce qui est deja fetche dans le frontend
Actuellement le `loadEvent` ne fetch que `temp_max` depuis `ensemble_forecasts`. Il faudra ajouter les autres colonnes au SELECT pour alimenter les 2 nouvelles courbes.

---

## A implementer

### Courbe 3 — Intemperies

**But** : Voir l'evolution des conditions meteo dans le temps. Permet de comprendre visuellement POURQUOI le score de confiance monte ou descend.

**Contenu** : Plusieurs lignes, chacune = la moyenne des 143 membres pour une variable meteo cle. Un point par snapshot (1x/heure).

| Ligne | Variable source | Unite | Couleur suggeree |
|-------|----------------|-------|-----------------|
| Precipitation | `precipitation` | mm | bleu |
| Neige | `snowfall` | cm | blanc/gris clair |
| Rafales | `wind_gusts_max` | km/h | violet |
| Nuages | `cloud_cover` | % | gris |
| Pression (ecart) | `pressure_msl` — 1013 | hPa | orange |

**Design** : Meme design que les 2 courbes existantes (meme background #111827, meme border-radius, meme axe X aligne sur les timestamps Polymarket, tooltip crosshair). Hauteur peut etre plus petite (250-300px) car c'est du contexte visuel.

**Note** : Les unites sont differentes (mm, km/h, %). A toi de determiner la meilleure facon de les afficher ensemble (normalisation, axes multiples, ou echelle relative).

---

### Courbe 4 — Score de Confiance (0-100%)

**But** : Un seul chiffre qui dit "est-ce que les 143 membres sont d'accord entre eux sur la temperature max ?"

**Principe** : Pour chaque snapshot horaire, les 143 membres predisent chacun une temp_max. Si ils votent tous pour le meme bracket → confiance haute. Si ils sont disperses sur 5+ brackets → confiance basse.

**Calcul du score** : A toi (Claude) de determiner la meilleure methode pour transformer la distribution des 143 votes en un score 0-100%. Quelques pistes possibles (choisis ou combine) :
- Concentration sur les top brackets (quel % des membres est dans les 1-2 brackets dominants ?)
- Inverse de l'entropie de Shannon de la distribution
- Inverse du spread normalise (max - min des predictions)
- Coefficient de variation
- Ou toute autre approche que tu juges plus robuste

**L'important** : le score doit etre intuitif. 90% = "quasi tous d'accord, on peut parier". 30% = "tres disperse, danger".

**Affichage** :
- Une seule ligne epaisse (strokeWidth 3) avec area fill sous la courbe
- Couleur dynamique selon le niveau (vert/jaune/orange/rouge)
- Axe Y : 0-100%
- Meme axe X que les 3 autres courbes
- Tooltip : score + detail (top bracket, % de membres, spread)
- Meme design general que les autres courbes

---

## Strategie d'utilisation (pour info, pas a implementer)

Comment on utilisera le score de confiance pour trader :
- Score > 70% + edge > 10% → on mise
- Score 50-70% → on attend le prochain snapshot pour voir si ca se stabilise
- Score < 50% → on ne mise pas, trop d'incertitude
- Si le score monte jour apres jour (J-3: 40%, J-2: 60%, J-1: 85%) → la prediction se consolide, on peut entrer

---

## Contraintes techniques
- Les donnees sont DEJA dans le state `ensembles` du frontend (il faut juste ajouter les colonnes au SELECT)
- Le calcul se fait entierement cote frontend (pas de nouvelle table, pas de changement backend)
- Les 4 courbes partagent le MEME axe X (timestamps des prix Polymarket, interpolation pour les snapshots ensemble)
- Meme design, meme tooltip crosshair, meme background, meme police monospace
- Fichier a modifier : `app/data/page.tsx`
- Build doit passer : `npm run build`
