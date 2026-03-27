-- Weather-Poly Database Schema for Hetzner PostgreSQL
-- Run as: psql -U weatherpoly -d weatherpoly -h 127.0.0.1 -f 01_schema.sql

-- ── Cities ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cities (
  station TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  flag TEXT DEFAULT '',
  unit TEXT DEFAULT 'C',
  resolution_source TEXT DEFAULT 'wu',
  active BOOLEAN DEFAULT true,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  country TEXT
);

-- ── Polymarket Events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS poly_events (
  event_id TEXT PRIMARY KEY,
  slug TEXT,
  title TEXT,
  city TEXT,
  station TEXT NOT NULL,
  target_date DATE NOT NULL,
  created_at TIMESTAMPTZ,
  closed BOOLEAN DEFAULT false,
  unit TEXT DEFAULT 'C',
  n_brackets INT DEFAULT 0,
  total_volume DOUBLE PRECISION DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pe_station ON poly_events(station);
CREATE INDEX IF NOT EXISTS idx_pe_target_date ON poly_events(target_date);
CREATE INDEX IF NOT EXISTS idx_pe_closed ON poly_events(closed);

-- ── Polymarket Markets (brackets) ───────────────────────────
CREATE TABLE IF NOT EXISTS poly_markets (
  condition_id TEXT PRIMARY KEY,
  station TEXT NOT NULL,
  date DATE NOT NULL,
  bracket_str TEXT,
  bracket_temp INT,
  bracket_op TEXT DEFAULT 'exact',
  unit TEXT DEFAULT 'C',
  winner TEXT,
  resolved BOOLEAN DEFAULT false,
  volume DOUBLE PRECISION DEFAULT 0,
  clob_token_yes TEXT,
  clob_token_no TEXT,
  poly_event_id TEXT REFERENCES poly_events(event_id),
  event_title TEXT
);
CREATE INDEX IF NOT EXISTS idx_pm_station_date ON poly_markets(station, date);
CREATE INDEX IF NOT EXISTS idx_pm_event ON poly_markets(poly_event_id);
CREATE INDEX IF NOT EXISTS idx_pm_resolved ON poly_markets(resolved);

-- ── Price History ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_history (
  condition_id TEXT NOT NULL,
  station TEXT NOT NULL,
  target_date DATE NOT NULL,
  ts BIGINT NOT NULL,
  price_yes DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (condition_id, ts)
);
CREATE INDEX IF NOT EXISTS idx_ph_station_date ON price_history(station, target_date);
CREATE INDEX IF NOT EXISTS idx_ph_condition ON price_history(condition_id);

-- ── Daily Temperatures (actual) ─────────────────────────────
CREATE TABLE IF NOT EXISTS daily_temps (
  station TEXT NOT NULL,
  date DATE NOT NULL,
  temp_max_c DOUBLE PRECISION,
  temp_max_f DOUBLE PRECISION,
  source TEXT DEFAULT 'wunderground',
  is_polymarket_day BOOLEAN DEFAULT true,
  PRIMARY KEY (station, date)
);

-- ── GFS Forecasts (old deterministic, historical) ───────────
CREATE TABLE IF NOT EXISTS gfs_forecasts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station TEXT NOT NULL,
  target_date DATE NOT NULL,
  horizon INT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gfs',
  temp_max DOUBLE PRECISION,
  temp_max_f DOUBLE PRECISION,
  ensemble_mean DOUBLE PRECISION,
  ensemble_min DOUBLE PRECISION,
  ensemble_max DOUBLE PRECISION,
  ensemble_values JSONB,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(station, target_date, horizon, model)
);
CREATE INDEX IF NOT EXISTS idx_gfs_station_date ON gfs_forecasts(station, target_date);

-- ── Ensemble Forecasts (143 members) ────────────────────────
CREATE TABLE IF NOT EXISTS ensemble_forecasts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station TEXT NOT NULL,
  target_date DATE NOT NULL,
  fetch_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  ensemble_model TEXT NOT NULL,
  member_id INT NOT NULL,
  temp_max DOUBLE PRECISION,
  UNIQUE(station, target_date, fetch_ts, ensemble_model, member_id)
);
CREATE INDEX IF NOT EXISTS idx_ef_station_target ON ensemble_forecasts(station, target_date);
CREATE INDEX IF NOT EXISTS idx_ef_fetch_ts ON ensemble_forecasts(fetch_ts);

-- ── Model Scores ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS model_scores (
  station TEXT NOT NULL,
  model TEXT NOT NULL,
  horizon INT NOT NULL,
  mae DOUBLE PRECISION NOT NULL,
  sample_count INT NOT NULL,
  last_updated TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (station, model, horizon)
);
