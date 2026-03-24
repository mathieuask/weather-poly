# RAPPORT V2_11 — Pipeline Supabase (Edge Function + pg_cron)

**Date** : 2026-03-24

---

## Migration local → Supabase

Le cron local (Mac crontab) a été remplacé par un pipeline 100% Supabase qui tourne 24/7.

### Architecture

```
pg_cron (*/5 * * * *)
  → pg_net HTTP POST
    → Edge Function "pipeline"
      → 1. fetchOpenPrices()    — prix des marchés ouverts
      → 2. checkResolutions()   — détecte les résolutions (resolved=true, pas juste closed)
      → 3. checkNewEvents()     — nouveaux events (seulement à 10h UTC)
```

### Edge Function déployée

`supabase/functions/pipeline/index.ts` — fait tout en un seul appel :

| Étape | Description | Quand |
|-------|-------------|-------|
| Prix | Fetch CLOB pour chaque bracket ouvert, insert les nouveaux points | Chaque run |
| Résolutions | Check Gamma `resolved=true` → update winners + fetch WU temp | Chaque run |
| Nouveaux events | Scan Gamma pour London/NYC/Seoul, insert events + brackets | À 10h UTC |

### pg_cron

```sql
SELECT cron.schedule(
    'pipeline-5min',
    '*/5 * * * *',
    $$ SELECT net.http_post(...) $$
);
```

- Job ID : 1
- Active : true
- Extensions : pg_cron + pg_net activées

---

## Vérification

### pg_cron runs

| Heure | Status |
|-------|--------|
| 23:25:00 UTC | succeeded |
| 23:30:00 UTC | succeeded |

### Fraîcheur des données

| Ville | Dernier point | Retard |
|-------|--------------|--------|
| London | 23:29 UTC | 2 min |
| NYC | 23:29 UTC | 2 min |
| Seoul | 23:29 UTC | 2 min |

### Cron local

- Mac crontab : **supprimé** (`crontab -r`)
- `pipeline.py` : conservé pour usage manuel (backfill, debug)

---

## Bug corrigé

`check_resolutions()` : ne checke plus `closed` (= trading arrêté) mais uniquement `resolved` (= outcome connu). Évite les faux positifs comme Seoul Mar 25 qui était marqué résolu à tort.

---

## État final du projet

| Table | Lignes |
|-------|--------|
| cities | 3 |
| poly_events | ~972 (966 + résolutions récentes) |
| poly_markets | ~7 150 |
| daily_temps | ~958 |
| price_history | ~5.3M (croît toutes les 5 min) |

### Tout est clean :
- [x] Un seul cron sur Supabase (pas de dépendance Mac)
- [x] Prix live toutes les 5 min
- [x] Résolutions auto-détectées
- [x] Nouveaux events auto-détectés
- [x] WU températures auto-fetchées à la résolution
- [x] Courbes de prix complètes (endTs +2j)
- [x] Page Data fonctionnelle avec tooltip custom
- [x] 100% des données historiques (jan 2025 → maintenant)

## Prêt pour V2_12 : oui
