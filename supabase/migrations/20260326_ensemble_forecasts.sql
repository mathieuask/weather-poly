-- Ensemble member forecasts (143 members: GFS 31 + ECMWF 51 + ICON 40 + GEM 21)
-- Each row = 1 member's prediction for 1 date, fetched at fetch_ts
-- Snapshots stored every hour, deduped by rounding to hour
-- horizon = target_date - fetch_ts::date (computed at query time)

CREATE TABLE ensemble_forecasts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station TEXT NOT NULL,
  target_date DATE NOT NULL,
  fetch_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  ensemble_model TEXT NOT NULL,      -- 'gfs', 'ecmwf', 'icon', 'gem'
  member_id INT NOT NULL,            -- 0 to 50
  temp_max DOUBLE PRECISION,
  temp_min DOUBLE PRECISION,
  temp_mean DOUBLE PRECISION,
  apparent_temp_max DOUBLE PRECISION,
  apparent_temp_min DOUBLE PRECISION,
  dew_point_max DOUBLE PRECISION,
  dew_point_min DOUBLE PRECISION,
  wind_speed_max DOUBLE PRECISION,
  wind_gusts_max DOUBLE PRECISION,
  wind_direction DOUBLE PRECISION,
  precipitation DOUBLE PRECISION,
  rain DOUBLE PRECISION,
  snowfall DOUBLE PRECISION,
  humidity_max DOUBLE PRECISION,
  humidity_min DOUBLE PRECISION,
  humidity_mean DOUBLE PRECISION,
  pressure_msl DOUBLE PRECISION,
  cloud_cover DOUBLE PRECISION,
  radiation DOUBLE PRECISION,
  UNIQUE(station, target_date, fetch_ts, ensemble_model, member_id)
);

CREATE INDEX idx_ef_station_target ON ensemble_forecasts(station, target_date);
CREATE INDEX idx_ef_fetch_ts ON ensemble_forecasts(fetch_ts);

-- RLS: anon can read
ALTER TABLE ensemble_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON ensemble_forecasts FOR SELECT USING (true);
