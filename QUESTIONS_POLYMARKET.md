# Questions sur le fonctionnement des marchés météo Polymarket

## Contexte

J'utilise un bot de paper trading sur les marchés météo Polymarket.
Le système scanne les marchés de température journalière du type :
"Will the highest temperature in Seoul be 12°C on March 20?"

Il y a plusieurs brackets mutuellement exclusifs (8°C, 9°C, 10°C... ≥14°C).
Un seul bracket résout YES, tous les autres résolvent NO.
On trade en achetant YES ou NO sur un bracket donné.

## Questions

### 1. Fermeture du marché au trading

À quelle heure exacte un marché ferme-t-il pour le trading ?
- Est-ce minuit heure locale de la ville concernée ?
- Minuit UTC ?
- Une heure fixe définie par Polymarket ?
- Exemple concret : marché "Seoul March 20" — à quelle heure précise
  ne peut-on plus placer de trade ?

### 2. Trading en cours de journée

Est-il possible de trader PENDANT la journée du marché ?
Exemple concret : il est midi heure locale à Seoul, la température
affiche 12°C sur les stations météo, le soleil commence à descendre,
on sait avec 90% de certitude que 12°C sera le maximum du jour.
- Peut-on encore acheter NO sur le bracket "13°C" à ce moment-là ?
- Le marché est-il encore ouvert pour les trades à cet instant ?

### 3. Ajustement des prix en temps réel

Si le marché reste ouvert pendant la journée :
- Les prix AMM (Automated Market Maker) s'ajustent-ils en temps réel
  en fonction des données météo du jour ?
- Ou bien les prix sont-ils "figés" depuis la veille et les traders
  ne réagissent pas aux données intraday ?
- Y a-t-il de la liquidité disponible en cours de journée pour trader ?

### 4. Source de résolution officielle

Comment Polymarket détermine-t-il la température officielle ?
- Quelle station météo / quel service de données utilise-t-il ?
- Exemple : pour Seoul, est-ce la station RKSI (Incheon Airport) ?
  Weather Underground ? Open Weather ? KMA (météo coréenne) ?
- À quelle heure de la journée prend-il la mesure officielle ?
- Que se passe-t-il si deux sources donnent des températures différentes ?

### 5. Délai résolution

Quel est le délai entre :
a) La fermeture du marché au trading
b) La résolution officielle (paiement des gagnants)
- Exemple : marché Seoul March 20 fermé à minuit heure locale
  → résolution effective à quelle heure ?

### 6. Stratégie intraday

Existe-t-il une stratégie connue et documentée qui exploite le trading
EN COURS DE JOURNÉE sur ces marchés météo Polymarket ?
- Par exemple : acheter NO sur un bracket impossible une fois qu'on
  voit la température réelle de la journée progresser
- Cette stratégie est-elle pratiquée ? Rentable ? Risquée ?
- Quels sont les risques (liquidité insuffisante, marché déjà pricé) ?

### 7. Aspects légaux / règles Polymarket

- Est-il autorisé d'utiliser des données météo temps réel pour trader ?
- Y a-t-il des règles contre le trading basé sur des informations
  supérieures (insider trading) sur Polymarket ?
- Un bot automatique qui trade en cours de journée est-il autorisé ?

### 8. Résumé pratique attendu

À la fin de tes réponses, donne-moi un résumé en bullet points :
- Quelle est la meilleure fenêtre de temps pour trader ces marchés ?
- Est-ce plus rentable de trader la veille (données GFS, incertitude)
  ou le jour même (données réelles, certitude) ?
- Quelle stratégie recommanderais-tu pour maximiser l'edge ?

Réponds de façon précise et pratique, en français.
