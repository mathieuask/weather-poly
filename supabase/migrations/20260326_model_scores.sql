-- Model reliability scores per station/model/horizon
-- MAE = Mean Absolute Error of forecast vs actual temperature

CREATE TABLE model_scores (
  station TEXT NOT NULL,
  model TEXT NOT NULL,
  horizon INT NOT NULL,           -- 0, 1, 2, 3
  mae FLOAT NOT NULL,             -- Mean Absolute Error
  sample_count INT NOT NULL,      -- number of comparisons
  last_updated TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (station, model, horizon)
);

-- RLS: anon can read
ALTER TABLE model_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON model_scores FOR SELECT USING (true);
