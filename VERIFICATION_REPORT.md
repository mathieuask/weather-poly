# City Configuration Verification Report

**Date:** 2026-03-26
**Total cities:** 35
**Overall status:** 34/35 PASS, 1 minor coordinate issue (London)

---

## Summary of Checks

| Check | Result |
|-------|--------|
| Coordinates match airport | 34/35 PASS, 1 WARN (London lon sign) |
| Unit (F/C) correct | 35/35 PASS |
| WU URL resolves (HTTP 200) | 32/32 PASS (3 cities use non-WU sources) |
| Open-Meteo ensemble API works | 6/6 tested PASS |
| Timezone valid IANA | 23/23 unique timezones PASS |

---

## Detailed Results by City

| # | City | Station | Coords | Unit | WU URL | Timezone | Status |
|---|------|---------|--------|------|--------|----------|--------|
| 1 | Ankara | LTAC | OK | C | 200 | Europe/Istanbul | PASS |
| 2 | Atlanta | KATL | OK | F | 200 | America/New_York | PASS |
| 3 | Austin | KAUS | OK | F | 200 | America/Chicago | PASS |
| 4 | Beijing | ZBAA | OK | C | 200 | Asia/Shanghai | PASS |
| 5 | Buenos Aires | SAEZ | OK | C | 200 | America/Argentina/Buenos_Aires | PASS |
| 6 | Chengdu | ZUUU | OK | C | 200 | Asia/Shanghai | PASS |
| 7 | Chicago | KORD | OK | F | 200 | America/Chicago | PASS |
| 8 | Chongqing | ZUCK | OK | C | 200 | Asia/Shanghai | PASS |
| 9 | Dallas | KDAL | OK | F | 200 | America/Chicago | PASS |
| 10 | Denver | KDEN | OK | F | 200 | America/Denver | PASS |
| 11 | Hong Kong | VHHH | OK | C | N/A (hko) | Asia/Hong_Kong | PASS |
| 12 | Houston | KHOU | OK | F | 200 | America/Chicago | PASS |
| 13 | **London** | **EGLC** | **WARN** | C | 200 | Europe/London | **WARN** |
| 14 | Los Angeles | KLAX | OK | F | 200 | America/Los_Angeles | PASS |
| 15 | Lucknow | VILK | OK | C | 200 | Asia/Kolkata | PASS |
| 16 | Madrid | LEMD | OK | C | 200 | Europe/Madrid | PASS |
| 17 | Miami | KMIA | OK | F | 200 | America/New_York | PASS |
| 18 | Milan | LIMC | OK | C | 200 | Europe/Rome | PASS |
| 19 | Munich | EDDM | OK | C | 200 | Europe/Berlin | PASS |
| 20 | NYC | KLGA | OK | F | 200 | America/New_York | PASS |
| 21 | Paris | LFPG | OK | C | 200 | Europe/Paris | PASS |
| 22 | San Francisco | KSFO | OK | F | 200 | America/Los_Angeles | PASS |
| 23 | Sao Paulo | SBGR | OK | C | 200 | America/Sao_Paulo | PASS |
| 24 | Seattle | KSEA | OK | F | 200 | America/Los_Angeles | PASS |
| 25 | Seoul | RKSI | OK | C | 200 | Asia/Seoul | PASS |
| 26 | Shanghai | ZSPD | OK | C | 200 | Asia/Shanghai | PASS |
| 27 | Shenzhen | ZGSZ | OK | C | 200 | Asia/Shanghai | PASS |
| 28 | Singapore | WSSS | OK | C | 200 | Asia/Singapore | PASS |
| 29 | Taipei | RCTP | OK | C | N/A (noaa) | Asia/Taipei | PASS |
| 30 | Tel Aviv | LLBG | OK | C | N/A (noaa) | Asia/Jerusalem | PASS |
| 31 | Tokyo | RJTT | OK | C | 200 | Asia/Tokyo | PASS |
| 32 | Toronto | CYYZ | OK | C | 200 | America/Toronto | PASS |
| 33 | Warsaw | EPWA | OK | C | 200 | Europe/Warsaw | PASS |
| 34 | Wellington | NZWN | OK | C | 200 | Pacific/Auckland | PASS |
| 35 | Wuhan | ZHHH | OK | C | 200 | Asia/Shanghai | PASS |

---

## Issue Details

### London (EGLC) -- Longitude Sign Error

- **DB value:** lat=51.505, lon=**-0.0553**
- **Correct value:** lat=51.5053, lon=**+0.0553**
- **Impact:** EGLC (London City Airport) is east of Greenwich, not west. The longitude sign is inverted.
- **Functional impact:** LOW. Open-Meteo resolves both to the same grid cell (51.5, 0.0) because the GFS grid resolution is 0.25 degrees. The ~12km difference falls within the same cell.
- **Recommended fix:** `UPDATE cities SET lon = 0.0553 WHERE station = 'EGLC';`

---

## Check 1: Coordinate Verification

All 35 cities were cross-referenced against known ICAO airport coordinates. Tolerance threshold: 0.05 degrees (~5.5 km).

- **34 cities** have coordinates matching their ICAO airport within tolerance (max deviation ~0.006 degrees).
- **1 city** (London) has an inverted longitude sign (difference: 0.1106 degrees in lon).

---

## Check 2: Unit (F/C) Verification

### US cities (should be F -- Fahrenheit):
| City | Unit | Status |
|------|------|--------|
| Atlanta | F | PASS |
| Austin | F | PASS |
| Chicago | F | PASS |
| Dallas | F | PASS |
| Denver | F | PASS |
| Houston | F | PASS |
| Los Angeles | F | PASS |
| Miami | F | PASS |
| NYC | F | PASS |
| San Francisco | F | PASS |
| Seattle | F | PASS |

### Non-US cities (should be C -- Celsius):
All 24 non-US cities correctly use unit=C.

---

## Check 3: Weather Underground URL Verification

Tested all 32 WU-sourced cities (excluding Hong Kong/hko, Taipei/noaa, Tel Aviv/noaa). All returned HTTP 200.

Sample URLs verified:
- `https://www.wunderground.com/history/daily/us/ga/atlanta/KATL` -- 200
- `https://www.wunderground.com/history/daily/gb/london/EGLC` -- 200
- `https://www.wunderground.com/history/daily/jp/tokyo/RJTT` -- 200
- `https://www.wunderground.com/history/daily/kr/incheon/RKSI` -- 200
- `https://www.wunderground.com/history/daily/cn/beijing/ZBAA` -- 200
- `https://www.wunderground.com/history/daily/br/guarulhos/SBGR` -- 200
- `https://www.wunderground.com/history/daily/tr/%C3%A7ubuk/LTAC` -- 200
- `https://www.wunderground.com/history/daily/de/munich/EDDM` -- 200
- `https://www.wunderground.com/history/daily/nz/wellington/NZWN` -- 200
- `https://www.wunderground.com/history/daily/sg/singapore/WSSS` -- 200
- `https://www.wunderground.com/history/daily/in/lucknow/VILK` -- 200

Non-WU cities use alternate resolution sources:
- Hong Kong: HKO (`https://www.weather.gov.hk/en/cis/climat.htm`)
- Taipei: NOAA (`https://www.weather.gov/wrh/timeseries?site=RCTP`)
- Tel Aviv: NOAA (`https://www.weather.gov/wrh/timeseries?site=LLBG`)

---

## Check 4: Open-Meteo Ensemble API Verification

Tested 6 cities (mix of US/F and international/C):

| City | Coords | Unit Param | API Response | Status |
|------|--------|------------|-------------|--------|
| NYC | 40.777, -73.873 | fahrenheit | Returns F data | PASS |
| London | 51.505, -0.0553 | (none/C) | Returns C data | PASS |
| Tokyo | 35.5533, 139.781 | (none/C) | Returns C data | PASS |
| Buenos Aires | -34.8222, -58.5358 | (none/C) | Returns C data | PASS |
| Los Angeles | 33.9425, -118.408 | fahrenheit | Returns F data | PASS |
| Singapore | 1.3644, 103.992 | (none/C) | Returns C data | PASS |

All return valid ensemble forecast data with correct temperature units.

---

## Check 5: Timezone Verification

All 23 unique IANA timezone strings are valid:

```
America/Argentina/Buenos_Aires  America/Chicago  America/Denver
America/Los_Angeles  America/New_York  America/Sao_Paulo  America/Toronto
Asia/Hong_Kong  Asia/Jerusalem  Asia/Kolkata  Asia/Seoul  Asia/Shanghai
Asia/Singapore  Asia/Taipei  Asia/Tokyo
Europe/Berlin  Europe/Istanbul  Europe/London  Europe/Madrid  Europe/Paris
Europe/Rome  Europe/Warsaw  Pacific/Auckland
```

City-to-timezone mapping verified correct for all 35 cities.

---

## Conclusion

The database configuration is in excellent shape. The only issue found is a minor longitude sign error for London (EGLC) which has no practical impact on forecasting due to Open-Meteo grid resolution, but should be corrected for data accuracy.
