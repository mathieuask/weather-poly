# Discussion: Scale to All 35 Polymarket Cities

> Document de discussion vivant. Mis a jour au fur et a mesure de nos echanges.
> Derniere MAJ: 2026-03-26 (v2 — donnees Polymarket verifiees)

## Contexte

On a actuellement 3 villes (London, NYC, Seoul) avec le systeme complet:
- 143 ensembles (GFS 31 + ECMWF 51 + ICON 40 + GEM 21)
- Prix CLOB toutes les 5min
- Resolutions auto
- Decouverte de nouveaux events

**Objectif**: Passer aux **35 villes** que Polymarket propose, en gardant le meme systeme.

### Decisions prises
- **32 villes WU en priorite** — systeme de resolution existant
- **3 villes non-WU (Tel Aviv, Taipei, Hong Kong)**: affichees dans le frontend avec "Bientot disponible", pas de resolution auto pour l'instant
- **Bug `cities.unit`**: Latent, pas actif. London/Seoul marques F mais le pipeline hardcode les unites. A corriger au moment du scale quand le pipeline lira `cities.unit`.
- **Frontend**: 35 onglets avec drapeaux, on verra le design plus tard

---

## 1. Les 35 villes — MAPPING VERIFIE depuis Polymarket

> TOUTES les infos ci-dessous sont extraites directement des descriptions Polymarket.
> Chaque marche specifie: l'aeroport exact, le code ICAO, l'URL WU, et l'unite (°F/°C).

### Sources de resolution

**3 sources differentes** (pas juste WU!):

| Source | Villes | URL pattern |
|--------|--------|-------------|
| **Weather Underground** | 32 villes | `wunderground.com/history/daily/{cc}/{city}/{ICAO}` |
| **NOAA** | Tel Aviv, Taipei | `weather.gov/wrh/timeseries?site={ICAO}` |
| **HK Observatory** | Hong Kong | `weather.gov.hk/en/cis/climat.htm` |

### Fahrenheit (11 villes US) — Source: WU

| Ville | ICAO | Aeroport (Polymarket) | WU URL | Coords aeroport |
|-------|------|----------------------|--------|-----------------|
| Atlanta | KATL | Hartsfield-Jackson International Airport | `/us/ga/atlanta/KATL` | 33.6407, -84.4277 |
| Austin | KAUS | Austin-Bergstrom International Airport | `/us/tx/austin/KAUS` | 30.1975, -97.6664 |
| Chicago | KORD | Chicago O'Hare Intl Airport | `/us/il/chicago/KORD` | 41.9742, -87.9073 |
| Dallas | KDAL | Dallas Love Field | `/us/tx/dallas/KDAL` | 32.8471, -96.8518 |
| Denver | KDEN | Buckley Space Force Base | `/us/co/denver/KDEN` | 39.8561, -104.6737 |
| Houston | KHOU | William P. Hobby Airport | `/us/tx/houston/KHOU` | 29.6454, -95.2789 |
| Los Angeles | KLAX | Los Angeles International Airport | `/us/ca/los-angeles/KLAX` | 33.9425, -118.4081 |
| Miami | KMIA | Miami Intl Airport | `/us/fl/miami/KMIA` | 25.7959, -80.2870 |
| NYC | KLGA | LaGuardia Airport | `/us/ny/new-york-city/KLGA` | 40.7769, -73.8740 |
| San Francisco | KSFO | San Francisco International Airport | `/us/ca/san-francisco/KSFO` | 37.6213, -122.3790 |
| Seattle | KSEA | Seattle-Tacoma International Airport | `/us/wa/seatac/KSEA` | 47.4502, -122.3088 |

### Celsius (24 villes internationales)

| Ville | ICAO | Aeroport (Polymarket) | Source | Coords aeroport |
|-------|------|----------------------|--------|-----------------|
| Ankara | LTAC | Esenboga Intl Airport | WU `/tr/cubuk/LTAC` | 40.1281, 32.9951 |
| Beijing | ZBAA | Beijing Capital International Airport | WU `/cn/beijing/ZBAA` | 40.0799, 116.6031 |
| Buenos Aires | SAEZ | Minister Pistarini Intl Airport | WU `/ar/ezeiza/SAEZ` | -34.8222, -58.5358 |
| Chengdu | ZUUU | Chengdu Shuangliu International Airport | WU `/cn/chengdu/ZUUU` | 30.5728, 103.9422 |
| Chongqing | ZUCK | Chongqing Jiangbei International Airport | WU `/cn/chongqing/ZUCK` | 29.7192, 106.6417 |
| Hong Kong | VHHH | Hong Kong Intl Airport | **HK Observatory** | 22.3080, 113.9185 |
| London | EGLC | London City Airport | WU `/gb/london/EGLC` | 51.5053, -0.0553 |
| Lucknow | VILK | Chaudhary Charan Singh Intl Airport | WU `/in/lucknow/VILK` | 26.7606, 80.8893 |
| Madrid | LEMD | Adolfo Suarez Madrid-Barajas Airport | WU `/es/madrid/LEMD` | 40.4936, -3.5668 |
| Milan | LIMC | Malpensa Intl Airport | WU `/it/milan/LIMC` | 45.6306, 8.7231 |
| Munich | EDDM | Munich Airport | WU `/de/munich/EDDM` | 48.3537, 11.7750 |
| Paris | LFPG | Charles de Gaulle Airport | WU `/fr/paris/LFPG` | 49.0097, 2.5479 |
| Sao Paulo | SBGR | Sao Paulo-Guarulhos International Airport | WU `/br/guarulhos/SBGR` | -23.4356, -46.4731 |
| Seoul | RKSI | Incheon Intl Airport | WU `/kr/incheon/RKSI` | 37.4602, 126.4407 |
| Shanghai | ZSPD | Shanghai Pudong International Airport | WU `/cn/shanghai/ZSPD` | 31.1443, 121.8083 |
| Shenzhen | ZGSZ | Shenzhen Bao'an International Airport | WU `/cn/shenzhen/ZGSZ` | 22.6393, 113.8107 |
| Singapore | WSSS | Singapore Changi Airport | WU `/sg/singapore/WSSS` | 1.3644, 103.9915 |
| Taipei | RCTP | Taiwan Taoyuan International Airport | **NOAA** `site=RCTP` | 25.0777, 121.2328 |
| Tel Aviv | LLBG | Ben Gurion International Airport | **NOAA** `site=LLBG` | 32.0114, 34.8867 |
| Tokyo | RJTT | Tokyo Haneda Airport | WU `/jp/tokyo/RJTT` | 35.5533, 139.7811 |
| Toronto | CYYZ | Toronto Pearson Intl Airport | WU `/ca/mississauga/CYYZ` | 43.6777, -79.6248 |
| Warsaw | EPWA | Warsaw Chopin Airport | WU `/pl/warsaw/EPWA` | 52.1672, 20.9679 |
| Wellington | NZWN | Wellington Intl Airport | WU `/nz/wellington/NZWN` | -41.3272, 174.8053 |
| Wuhan | ZHHH | Wuhan Tianhe International Airport | WU `/cn/wuhan/ZHHH` | 30.7838, 114.2081 |

---

## 2. ALERTES CRITIQUES (erreurs = pertes d'argent)

### 2a. Erreurs dans la DB actuelle `cities`

| Champ | Valeur actuelle | Probleme |
|-------|----------------|----------|
| London `unit` | `F` | **FAUX!** London = Celsius. Bug dans la DB |
| Seoul `unit` | `F` | **FAUX!** Seoul = Celsius. Bug dans la DB |
| London `lon` | `0.053` | **Signe manquant!** Devrait etre `-0.0553` (ouest de Greenwich) |
| Seoul `lat/lon` | Arrondi | OK mais verifier precision |

> **ACTION**: Corriger ces bugs AVANT de scaler!

### 2b. Dallas: KDAL pas KDFW!

Polymarket utilise **Dallas Love Field (KDAL)**, PAS DFW (KDFW).
- KDAL coords: 32.8471, -96.8518
- KDFW coords: 32.8998, -97.0403
- ~20km de distance, temperatures potentiellement differentes

### 2c. Houston: KHOU pas KIAH!

Polymarket utilise **William P. Hobby (KHOU)**, PAS George Bush Intercontinental (KIAH).
- KHOU coords: 29.6454, -95.2789
- KIAH coords: 29.9902, -95.3368
- ~40km de distance

### 2d. Denver: Buckley Space Force Base (KDEN)

Polymarket specifie "Buckley Space Force Base" mais le code ICAO est KDEN (Denver International).
A verifier si WU KDEN reporte bien les donnees de Buckley ou de Denver Intl.

### 2e. 3 sources de resolution differentes!

- **32 villes**: Weather Underground → notre systeme actuel fonctionne
- **Tel Aviv + Taipei**: NOAA (`weather.gov/wrh/timeseries`) → scraper NOAA a faire plus tard
- **Hong Kong**: HK Observatory (`weather.gov.hk`) → scraper HKO a faire plus tard

**DECISION**: On deploie les 32 villes WU maintenant. Les 3 autres sont affichees "Bientot disponible" dans le frontend. Les ensembles sont quand meme fetches pour ces 3 villes (Open-Meteo fonctionne partout), seule la resolution auto n'est pas dispo.

---

## 3. Table `cities` existante en DB

On a deja une table `cities` avec 3 rows:
```
id | name    | station | wu_country | lat    | lon     | tz              | unit | slug    | first_market | active
15 | London  | EGLC    | gb         | 51.505 | 0.053   | Europe/London   | F    | london  | 2025-01-22   | true
22 | NYC     | KLGA    | us         | 40.777 | -73.873 | America/New_York| F    | nyc     | 2025-01-22   | true
28 | Seoul   | RKSI    | kr         | 37.469 | 126.451 | Asia/Seoul      | F    | seoul   | 2025-12-06   | true
```

**Schema actuel**: id, name, station, wu_country, lat, lon, tz, unit, slug, first_market, active, created_at

**Colonnes a ajouter pour le scale**:
- `wu_city` TEXT — le path WU apres le country code (ex: "ny/new-york-city", "paris")
- `resolution_source` TEXT — "wu", "noaa", "hko"
- `resolution_url` TEXT — URL complete de resolution
- `airport_name` TEXT — nom officiel de l'aeroport (pour reference)
- `flag` TEXT — emoji drapeau pour le frontend

---

## 4. Strategie de conversion Fahrenheit/Celsius

### Regle: ZERO conversion. Tout en unite native de Polymarket.

- **Villes US (11)**: `&temperature_unit=fahrenheit` dans l'appel Open-Meteo
  - Ensembles arrivent en °F, brackets Polymarket en °F, zero conversion
- **Toutes les autres (24)**: Celsius par defaut
  - Ensembles arrivent en °C, brackets Polymarket en °C, zero conversion

### Ce qu'on stocke
- `ensemble_forecasts.temp_max` = unite native (°F ou °C selon la ville)
- `poly_markets.bracket_temp` = deja dans la bonne unite
- `daily_temps.temp_max_c` → renommer en `temp_max` + utiliser l'unite native
- Le champ `unit` dans `cities` donne la reference

---

## 5. Donnees a archiver puis supprimer

### Tables a archiver en JSON (commit Git avant suppression)

| Table | Rows | Raison |
|-------|------|--------|
| `gfs_forecasts` | ~30,840 | Ancien systeme deterministe, plus utilise |
| `model_scores` | ~96 | Lie a gfs_forecasts |

### Tables a GARDER

| Table | Rows | Action |
|-------|------|--------|
| `ensemble_forecasts` | ~38,780 | Etendre a 35 villes |
| `poly_events` | ~972 | Etendre (deja generique) |
| `poly_markets` | ~7,151 | Etendre (deja generique) |
| `price_history` | ~5,414,620 | Garder tel quel |
| `daily_temps` | ~957 | Etendre a 35 villes |
| `cities` | 3 → 35 | Ajouter les 32 nouvelles villes |
| `city_bias` | 0 | Garder pour futur |
| `signals` | 0 | Garder pour futur |
| `paper_trades` | 0 | Garder pour futur |
| `trades_log` | 0 | Garder pour futur |

---

## 6. Impact sur le Edge Function (pipeline)

### Plus de hardcode — tout depuis la table `cities`

Au lieu de `CITY_SLUGS` et `STATIONS` hardcodes, le pipeline fera:
```
SELECT * FROM cities WHERE active = true
```
Et construira dynamiquement les mappings. Ajouter une ville = un INSERT.

### Changements cles

1. **checkNewEvents()**: Le parsing des titres doit matcher les 35 city slugs
   - Actuellement: substring match sur "london", "new york", "nyc", "seoul"
   - Nouveau: match contre `cities.slug` + variantes (ex: "new york" → "nyc")
   - **Mieux**: extraire le city slug directement depuis la description Polymarket (plus fiable)

2. **refreshEnsembles()**: 35 × 4 modeles = 140 appels (vs 12)
   - 2s delay chacun = ~280s = ~4.7 min
   - Edge Function timeout Supabase = **150s par defaut**
   - **PROBLEME**: Il faudra soit paralleliser, soit splitter en batches

3. **fetchOpenPrices()**: ~1400 brackets au lieu de ~120
   - 0.1s par appel = ~140s → OK mais serre

4. **checkResolutions()**: 3 sources differentes (WU, NOAA, HKO)
   - Faut implementer les scrapers NOAA et HKO

### Questions ouvertes
- [ ] Timeout Edge Function: 150s? Extensible? Ou splitter en fonctions separees?
- [ ] Paralleliser les appels Open-Meteo? (risque rate limit)
- [ ] Splitter: 1 EF pour prices, 1 pour events, 1 pour ensembles?

---

## 7. Volume de donnees estime (35 villes)

| Metrique | 3 villes (actuel) | 35 villes (cible) | x |
|----------|-------------------|-------------------|---|
| Events ouverts | ~12 | ~140 | 12x |
| Brackets ouverts | ~120 | ~1400 | 12x |
| Prix/5min | ~120 rows | ~1400 rows | 12x |
| Ensembles/heure | 1,716 rows | 20,020 rows | 12x |
| Ensembles/jour | ~41k rows | ~480k rows | 12x |
| Ensembles/mois | ~1.2M rows | ~14.4M rows | 12x |

> Prevoir cleanup ensemble_forecasts > 30 jours? Ou partition par mois?

---

## 8. Risques

1. **Edge Function timeout** — 140 appels ensembles a 2s > 150s timeout
2. **NOAA/HKO scrapers** — 3 villes sans source de resolution implementee
3. **Rate limits** — Open-Meteo (3,360/jour OK), CLOB (403k/jour a surveiller)
4. **DB size** — 14M rows/mois ensembles, prevoir retention policy
5. **Conversion** — Bugs unit existants dans `cities` (London/Seoul marques F!)
6. **Denver** — Buckley vs Denver Intl a clarifier

---

## 9. Plan d'action (quand on sera d'accord)

### Phase 1: Preparer la DB
1. [ ] Fix `cities.unit`: London → C, Seoul → C
2. [ ] Fix `cities.lon`: London → -0.0553
3. [ ] Ajouter colonnes a `cities`: wu_city, resolution_source, resolution_url, airport_name, flag
4. [ ] INSERT les 32 nouvelles villes WU dans `cities` (active=true)
5. [ ] INSERT les 3 villes non-WU (Tel Aviv, Taipei, HK) avec active=true mais resolution_source='noaa'/'hko'
6. [ ] Archiver gfs_forecasts + model_scores en JSON → commit Git
7. [ ] DROP gfs_forecasts, model_scores

### Phase 2: Mettre a jour le pipeline Edge Function
8. [ ] Pipeline lit `cities` au lieu de constantes hardcodees
9. [ ] `checkNewEvents()`: matcher les slugs depuis `cities` table
10. [ ] `refreshEnsembles()`: loop sur toutes les villes actives, unit depuis `cities`
11. [ ] `fetchOpenPrices()`: inchange (deja generique via poly_markets)
12. [ ] `checkResolutions()`: WU seulement (32 villes), skip les resolution_source != 'wu'
13. [ ] Gerer le timeout (paralleliser ou splitter les EF)

### Phase 3: Frontend
14. [ ] 35 onglets avec drapeaux
15. [ ] Badge "Bientot disponible" pour Tel Aviv, Taipei, Hong Kong (pas de resolution auto)
16. [ ] Adapter Strategie et Resultats

### Phase 4: Deploy progressif
17. [ ] Tester sur 5 nouvelles villes
18. [ ] Monitorer rate limits et performance
19. [ ] Activer les 35

---

## Notes de discussion

- **26 mars 2026 — Init**: 138 events ouverts, 35 villes identifiees (11 °F, 24 °C).
- **26 mars 2026 — Decouverte critique**:
  - London et Seoul marques unit=F dans DB → bug latent, a corriger au scale
  - Dallas = KDAL (Love Field), pas KDFW
  - Houston = KHOU (Hobby), pas KIAH
  - 3 villes (Tel Aviv, Taipei, Hong Kong) n'utilisent PAS WU pour la resolution
  - London lon positif dans DB (devrait etre negatif)
  - La table `cities` existe deja, pas besoin de la recreer
  - Polymarket ouvre toutes les dates futures (pas juste J-0 a J-3)
- **26 mars 2026 — Decisions**:
  - 32 villes WU d'abord, 3 non-WU en "bientot disponible"
  - Bug unit latent, pas actif (pipeline hardcode les unites)
  - Frontend: 35 onglets avec drapeaux, design plus tard
