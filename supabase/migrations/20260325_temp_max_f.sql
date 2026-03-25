-- Add temp_max_f column for Fahrenheit-native stations (KLGA/NYC)
-- Polymarket resolves NYC in °F, London/Seoul in °C.
-- Storing in native unit avoids double-rounding errors.

ALTER TABLE daily_temps ADD COLUMN IF NOT EXISTS temp_max_f FLOAT;
ALTER TABLE gfs_forecasts ADD COLUMN IF NOT EXISTS temp_max_f FLOAT;
