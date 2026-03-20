# Prompt stratégie — À envoyer à Claude avant tout développement

## Contexte du projet

Je construis un système de trading automatisé sur les marchés météo Polymarket.
Le système génère des signaux en comparant des prévisions météo (modèles GFS+ICON+ECMWF)
aux prix des marchés Polymarket.

Voici ce qu'on fait actuellement et les problèmes identifiés :

---

## Problème 1 : Position géographique incorrecte

**Ce qu'on fait** : On récupère les prévisions GFS/ICON/ECMWF pour les coordonnées
de la VILLE (ex: Seoul centre = 37.57°N, 126.98°E).

**Ce que Polymarket résout** : La température de la STATION AÉROPORT sur Weather Underground.
Exemples :
- Seoul → RKSI Incheon Airport (37.46°N, 126.44°E) — à 50-70km du centre, côtier
- NYC → KLGA LaGuardia Airport (40.77°N, 73.87°W)
- London → EGLC London City Airport (51.50°N, 0.05°E)
- Tokyo → RJTT Haneda Airport (35.55°N, 139.78°E)
- Paris → LFPG Charles de Gaulle (49.01°N, 2.55°E)
- Madrid → LEMD Barajas Airport (40.47°N, -3.57°E)
- Singapore → WSSS Changi Airport (1.36°N, 103.99°E)
- Toronto → CYYZ Pearson Airport (43.68°N, -79.63°W)
- Miami → KMIA Miami Airport (25.80°N, -80.29°W)
- Buenos Aires → SAEZ Ezeiza Airport (34.82°S, -58.54°W)
- Taipei → RCTP Taoyuan Airport (25.08°N, 121.22°E)
- Chicago → KMDW Midway Airport (41.79°N, -87.75°W)

**Question 1** : Est-ce que simplement changer les coordonnées dans notre API
Open-Meteo (de la ville vers l'aéroport) suffit à corriger ce problème ?
Ou y a-t-il d'autres différences (micro-climat, effet côtier, urbain) qui
nécessitent une correction supplémentaire ?

**Question 2** : Open-Meteo peut-il fournir des prévisions précises pour des
coordonnées d'aéroport spécifiques ? Ou doit-on utiliser directement les
données METAR de ces stations ?

---

## Problème 2 : Stratégie intraday — heure du pic de température

**Découverte clé** : Les marchés Polymarket restent ouverts TOUTE la journée,
même après que la température maximale est atteinte. Si à 15h heure locale
le thermomètre affiche 12°C et commence à descendre, on peut encore acheter
NO sur le bracket 13°C avec quasi-certitude.

**Ce qu'on ne sait pas** :
- À quelle heure locale le pic de température est-il généralement atteint
  pour chaque ville et chaque saison ?
- Comment savoir en temps réel si le pic est DÉJÀ atteint ou si la
  température peut encore monter ?

**Question 3** : Pour chaque ville de notre liste, quelle est l'heure
habituelle du pic de température journalier (ex: 14h-16h heure locale) ?
Cette heure varie-t-elle selon les saisons ?

**Question 4** : Quelle API gratuite permet de récupérer les observations
METAR en temps réel pour ces stations aéroport ? (NOAA, aviationweather.gov,
open-meteo historical ?) Quel format ? Quelle fréquence de mise à jour ?

**Question 5** : Comment détecter algorithmiquement que le pic est atteint ?
Par exemple : "si la température n'a pas augmenté depuis 2 heures et qu'on
est après 13h heure locale" → signal fort que le pic est passé ?

---

## Problème 3 : CLOB vs AMM — je n'ai pas compris comment ça marche

Polymarket utilise un CLOB (Central Limit Order Book), pas un AMM.

**Question 6** : Explique-moi exactement comment fonctionne le CLOB Polymarket :
- Comment sont créés les tokens YES et NO ?
- Comment se forme le prix ? (pas de market maker automatique ?)
- Quand j'achète NO à 0.68$, qu'est-ce qui se passe exactement ?
- Est-ce que quelqu'un doit obligatoirement vendre YES à 0.32$ pour
  que mon ordre s'exécute ? Ou y a-t-il un autre mécanisme ?
- Qu'est-ce que le "minting" et le "merging" dans ce contexte ?
- Comment lire un carnet d'ordres sur ces marchés ?

**Question 7** : Dans notre scanner, on récupère `outcomePrices` via l'API
Gamma de Polymarket — ex: `["0.28", "0.72"]` pour YES/NO.
Est-ce le prix du DERNIER trade ? Le mid-price ? Le best bid/ask ?
Quelle est la différence pratique pour calculer notre EV (expected value) ?

---

## Problème 4 : Notre formule EV est peut-être fausse

**Ce qu'on calcule** :
```
edge = gfs_prob - market_prob
ev = (gfs_prob/100) * (1 - entry_price) - (1 - gfs_prob/100) * entry_price
```

**Question 8** : Cette formule est-elle correcte pour un CLOB ?
Doit-on tenir compte du spread bid/ask ? Des frais de transaction ?
Du slippage sur les petits marchés (< $500 de liquidité) ?

---

## Problème 5 : Nos données historiques pour calibration

Pour corriger le biais GFS, on a besoin de comparer :
- Ce que GFS prédisait N jours avant pour une date donnée
- La température réelle enregistrée par la station aéroport

**Question 9** : 
- Peut-on récupérer les données METAR historiques gratuitement pour
  les 6-12 derniers mois pour nos 12 stations ? (NOAA, Iowa State Mesonet ?)
- Peut-on récupérer ce que GFS PRÉDISAIT (pas ce qu'il observe) pour
  des dates passées via Open-Meteo Historical Forecast API ?
- Ces deux sources sont-elles comparables directement ?

---

## Question synthèse finale

**Question 10** : Avant tout développement, donne-moi dans l'ordre :

1. Les 3 changements les plus impactants à faire immédiatement
   (par ordre de ROI sur la précision du système)

2. La stack technique recommandée pour :
   - Données METAR temps réel (intraday)
   - Données historiques de stations (calibration)
   - Prévisions modèles aux bonnes coordonnées

3. Est-ce que l'approche "GFS vs marché" a un edge réel ou on perd
   notre temps ? Quel est le vrai edge selon toi ?

4. Un plan d'implémentation en 4 étapes max, du plus simple au plus complexe.

Réponds de façon précise, pratique, chiffrée quand possible. En français.
