-- GFS / ECMWF forecast predictions table
-- Stores deterministic + ensemble forecasts at multiple horizons (J-3..J-0)

DROP TABLE IF EXISTS gfs_forecasts;

CREATE TABLE gfs_forecasts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station TEXT NOT NULL,
  target_date DATE NOT NULL,
  horizon INT NOT NULL,              -- 0=J-0, 1=J-1, 2=J-2, 3=J-3
  model TEXT NOT NULL DEFAULT 'gfs',  -- 'gfs' or 'ecmwf'
  temp_max FLOAT,                    -- deterministic forecast (°C)
  ensemble_mean FLOAT,
  ensemble_min FLOAT,
  ensemble_max FLOAT,
  ensemble_values JSONB,             -- array of ensemble members (31 GEFS or 51 ENS)
  fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(station, target_date, horizon, model)
);

CREATE INDEX idx_gfs_station_date ON gfs_forecasts(station, target_date);

-- RLS: anon can read
ALTER TABLE gfs_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON gfs_forecasts FOR SELECT USING (true);
