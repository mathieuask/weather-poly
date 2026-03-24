# RAPPORT V2_07 — Page Data Explorer

**Date** : 2026-03-24

---

## Modifié
- `app/data/page.tsx` : remplacé l'ancien placeholder (calendrier/bias V1) par un explorateur de données V2

## Dépendances ajoutées
- `recharts` (graphiques multi-courbes)

## Fonctionnalités

### City tabs
- 3 onglets : London, NYC, Seoul avec drapeaux et couleur accent
- Clic = charge les events de la ville

### Liste des events (colonne gauche)
- Triée par date desc (récent en haut)
- Paginée par 30
- Affiche : date, nombre de brackets, volume total, badge OPEN si non résolu
- Event actif surligné avec bordure couleur ville

### Graphique multi-courbes
- Recharts LineChart, fond sombre (#111827)
- Chaque bracket = une ligne, couleur distincte (11 couleurs)
- Bracket winner = trait épais (3px) + opaque, autres = trait fin (1.2px) + semi-transparent
- Axe X = heure UTC, axe Y = probabilité 0-100%
- Ligne de référence à 50%
- Tooltip au survol : liste tous les brackets triés par % décroissant
- Données downsamplées à 400 points max pour performance

### Température réelle
- Affichée dans le header : "Actual: 15°C" en jaune
- Source : table `daily_temps` (Wunderground)

### Grille des brackets
- Grid responsive (auto-fill, 140px min)
- Chaque carte : couleur du bracket, label (≤9°, 10°, ≥17°), badge WIN si gagnant
- Prix d'ouverture → prix final
- Volume en dollars

### Responsive
- Desktop : liste à gauche, chart à droite (sidebar 260px)
- Mobile : liste en pleine page, clic ouvre le chart, bouton retour

### Style
- Fond sombre (#0a0a0f), texte clair (#e2e8f0)
- Font mono pour les chiffres
- Design compact, pas de padding excessif

## Build
- Next.js build : **OK** (0 erreurs)

## Requêtes Supabase par event
1. `poly_markets` : 1 requête (brackets de l'event)
2. `daily_temps` : 1 requête (température du jour)
3. `price_history` : N requêtes en parallèle (1 par bracket, ~7-9)

Total : ~10 requêtes par event sélectionné

## Prêt pour V2_08 : oui
