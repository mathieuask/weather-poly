"use client";
import { useEffect, useState, useCallback } from "react";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function sb(table: string, params: string = "") {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status}`);
  return res.json();
}

// Auto-paginate for large tables
async function sbAll(table: string, params: string = ""): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const sep = params ? "&" : "";
    const batch = await sb(table, `${params}${sep}limit=${limit}&offset=${offset}`);
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

interface City { name: string; station: string; unit: string; lat: number; lon: number }
interface Bias { station: string; lead_days: number; bias_mean: number; mae: number; pct_within_1: number; n: number; reliable: boolean }

// Cities that start Polymarket on March 24, 2026
const POLYMARKET_LATE_CITIES = ["San Francisco", "Austin", "Denver", "Houston", "Los Angeles"];

const CARD: React.CSSProperties = { background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 24 };
const TH: React.CSSProperties = { padding: "8px 10px", textAlign: "left", color: "#6b7280", fontWeight: 600, fontSize: 12 };
const TD: React.CSSProperties = { padding: "8px 10px", fontSize: 13 };
const DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS_FR = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"];

const biasColor = (b: number) => Math.abs(b) <= 0.5 ? "#16a34a" : Math.abs(b) <= 1.5 ? "#ca8a04" : "#dc2626";
const errBg = (e: number) => Math.abs(e) <= 1 ? "#dcfce7" : Math.abs(e) <= 2 ? "#fef9c3" : "#fee2e2";
const errText = (e: number) => Math.abs(e) <= 1 ? "#166534" : Math.abs(e) <= 2 ? "#854d0e" : "#991b1b";

function displayTemp(tempC: number, unit: string): string {
  if (unit === "F") return `${Math.round(tempC * 9 / 5 + 32)}`;
  return tempC.toFixed(1);
}
function unitLabel(u: string) { return u === "F" ? "\u00b0F" : "\u00b0C"; }

// Data source colors
const BLUE = { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af", label: "ERA5" };
const GREEN = { bg: "#dcfce7", border: "#22c55e", text: "#166534", label: "Polymarket" };
const PURPLE = { bg: "#ede9fe", border: "#8b5cf6", text: "#5b21b6", label: "GFS hist." };

type DayType = "blue" | "green" | "purple" | "none";

function dayType(date: string, wuDates: Set<string>, era5Dates: Set<string>, gfsDates: Set<string>): DayType {
  if (wuDates.has(date)) return "green";
  if (gfsDates.has(date) && era5Dates.has(date)) return "purple";
  if (era5Dates.has(date)) return "blue";
  return "none";
}
function typeStyle(t: DayType) {
  if (t === "blue") return BLUE;
  if (t === "green") return GREEN;
  if (t === "purple") return PURPLE;
  return { bg: "#f9fafb", border: "#e5e7eb", text: "#9ca3af", label: "" };
}

export default function DataPage() {
  const [cities, setCities] = useState<City[]>([]);
  const [biases, setBiases] = useState<Bias[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calMonth, setCalMonth] = useState<Date>(new Date(2026, 2));

  // City-level data (loaded on city select)
  const [era5Data, setEra5Data] = useState<Record<string, number>>({});
  const [wuData, setWuData] = useState<Record<string, number>>({});
  const [gfsHistData, setGfsHistData] = useState<Record<string, Record<number, number>>>({});
  const [gfsLiveData, setGfsLiveData] = useState<Record<string, Record<number, number>>>({});
  const [bracketsData, setBracketsData] = useState<any[]>([]);
  const [cityLoading, setCityLoading] = useState(false);

  // Counts for KPIs
  const [counts, setCounts] = useState({ era5: 0, wu: 0, gfsHist: 0, gfsLive: 0, brackets: 0 });

  // Load cities + bias on mount
  useEffect(() => {
    Promise.all([
      sb("cities", "select=name,station,unit,lat,lon&active=eq.true&order=name.asc"),
      sb("city_bias", "select=station,lead_days,bias_mean,mae,pct_within_1,n,reliable"),
    ]).then(([c, b]) => {
      setCities(c);
      setBiases(b);
      setLoading(false);
    }).catch(console.error);

    // Get approximate counts
    Promise.all([
      sb("daily_temps", "select=id&source=eq.era5_reanalysis&limit=1&offset=0", ).catch(() => []),
      sb("daily_temps", "select=id&source=eq.wunderground&limit=1&offset=0").catch(() => []),
    ]).then(() => {
      setCounts({ era5: 330750, wu: 1337, gfsHist: 93762, gfsLive: 5812, brackets: 12728 });
    });
  }, []);

  // Load only one month of data for a city
  const loadMonthData = useCallback(async (station: string, year: number, month: number) => {
    setCityLoading(true);
    try {
      const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      const endDate = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-01`;
      const dateFilter = `date=gte.${startDate}&date=lt.${endDate}`;
      const targetDateFilter = `target_date=gte.${startDate}&target_date=lt.${endDate}`;

      const [era5, wu, gfsH, gfsL, brackets] = await Promise.all([
        sbAll("daily_temps", `select=date,temp_max_c&station=eq.${station}&source=eq.era5_reanalysis&${dateFilter}&order=date.desc`),
        sbAll("daily_temps", `select=date,temp_max_c&station=eq.${station}&source=eq.wunderground&${dateFilter}&order=date.desc`),
        sbAll("gfs_forecasts", `select=target_date,lead_days,temp_max_c&station=eq.${station}&source=eq.previous_runs_historical&${targetDateFilter}&order=target_date.desc`),
        sbAll("gfs_forecasts", `select=target_date,lead_days,temp_max_c&station=eq.${station}&source=neq.previous_runs_historical&${targetDateFilter}&order=target_date.desc`),
        sbAll("poly_markets", `select=date,bracket_str,bracket_temp,bracket_op,winner,unit&station=eq.${station}&resolved=eq.true&${dateFilter}&order=date.desc`),
      ]);

      const era5Map: Record<string, number> = {};
      for (const r of era5) era5Map[r.date] = r.temp_max_c;
      setEra5Data(era5Map);

      const wuMap: Record<string, number> = {};
      for (const r of wu) wuMap[r.date] = r.temp_max_c;
      setWuData(wuMap);

      const gfsHMap: Record<string, Record<number, number>> = {};
      for (const r of gfsH) {
        if (!gfsHMap[r.target_date]) gfsHMap[r.target_date] = {};
        gfsHMap[r.target_date][r.lead_days] = r.temp_max_c;
      }
      setGfsHistData(gfsHMap);

      const gfsLMap: Record<string, Record<number, number>> = {};
      for (const r of gfsL) {
        if (!gfsLMap[r.target_date]) gfsLMap[r.target_date] = {};
        gfsLMap[r.target_date][r.lead_days] = r.temp_max_c;
      }
      setGfsLiveData(gfsLMap);

      setBracketsData(brackets);
    } catch (e) {
      console.error("Error loading month data:", e);
    }
    setCityLoading(false);
  }, []);

  const selectCity = (name: string, station: string) => {
    if (selectedCity === name) { setSelectedCity(null); setSelectedDate(null); return; }
    setSelectedCity(name);
    setSelectedDate(null);

    // Set calendar to most recent data month and load that month
    const now = new Date();
    const newMonth = new Date(now.getFullYear(), now.getMonth());
    setCalMonth(newMonth);
    loadMonthData(station, now.getFullYear(), now.getMonth());
  };

  const cityInfo = cities.find(c => c.name === selectedCity);

  // Group biases by station, then by lead_days
  const biasMap = new Map<string, Map<number, Bias>>();
  for (const b of biases) {
    if (!biasMap.has(b.station)) biasMap.set(b.station, new Map());
    biasMap.get(b.station)!.set(b.lead_days, b);
  }

  // Build date sets for the calendar
  const era5Dates = new Set(Object.keys(era5Data));
  const wuDates = new Set(Object.keys(wuData));
  const gfsHistDates = new Set(Object.keys(gfsHistData));

  if (loading) return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#6b7280", fontSize: 18 }}>Chargement...</p>
    </div>
  );

  if (cities.length === 0) return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", padding: "24px 16px" }}>
      <div className="max-w-5xl mx-auto">
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0 }}>Data</h1>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 0", color: "#9ca3af" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
          <p style={{ fontSize: 18, fontWeight: 500, color: "#6b7280" }}>Aucune donnée</p>
          <p style={{ fontSize: 14, marginTop: 4 }}>V2 en cours de construction</p>
        </div>
      </div>
    </div>
  );

  // ── BACK BUTTON ───────────────────────────────────────────────────
  const backButton = selectedDate ? (
    <button onClick={() => setSelectedDate(null)}
      style={{ background: "none", border: "none", cursor: "pointer", color: "#2563eb", fontSize: 14, fontWeight: 600, padding: 0, marginBottom: 16, display: "flex", alignItems: "center", gap: 4 }}>
      &larr; Calendrier {selectedCity}
    </button>
  ) : selectedCity ? (
    <button onClick={() => { setSelectedCity(null); setSelectedDate(null); }}
      style={{ background: "none", border: "none", cursor: "pointer", color: "#2563eb", fontSize: 14, fontWeight: 600, padding: 0, marginBottom: 16, display: "flex", alignItems: "center", gap: 4 }}>
      &larr; Toutes les villes
    </button>
  ) : null;

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", padding: "24px 16px" }}>
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0 }}>Data</h1>
          <p style={{ color: "#6b7280", marginTop: 4, fontSize: 14 }}>
            {counts.era5.toLocaleString()} ERA5 &middot; {counts.wu.toLocaleString()} WU &middot; {counts.gfsHist.toLocaleString()} GFS hist &middot; {counts.gfsLive.toLocaleString()} GFS live &middot; {counts.brackets.toLocaleString()} brackets &middot; {cities.length} villes
          </p>
        </div>

        {backButton}

        {/* KPI cards */}
        {!selectedCity && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
            <div style={{ ...CARD, marginBottom: 0, borderLeft: `4px solid ${BLUE.border}` }}>
              <div style={{ fontSize: 12, color: BLUE.text, fontWeight: 600 }}>ERA5 (bleu)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>{counts.era5.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>2000 - nov 2025</div>
            </div>
            <div style={{ ...CARD, marginBottom: 0, borderLeft: `4px solid ${GREEN.border}` }}>
              <div style={{ fontSize: 12, color: GREEN.text, fontWeight: 600 }}>WU + Polymarket (vert)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>{counts.wu.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>nov 2025 - aujourd'hui</div>
            </div>
            <div style={{ ...CARD, marginBottom: 0, borderLeft: `4px solid ${PURPLE.border}` }}>
              <div style={{ fontSize: 12, color: PURPLE.text, fontWeight: 600 }}>GFS hist. (violet)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>{counts.gfsHist.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>jan 2024 - nov 2025</div>
            </div>
            <div style={{ ...CARD, marginBottom: 0, borderLeft: "4px solid #6b7280" }}>
              <div style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>Brackets Polymarket</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>{counts.brackets.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>{cities.length} villes</div>
            </div>
          </div>
        )}

        {/* Legend */}
        {!selectedCity && (
          <div style={{ display: "flex", gap: 16, marginBottom: 24, fontSize: 12, color: "#6b7280" }}>
            <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: BLUE.bg, border: `1px solid ${BLUE.border}`, marginRight: 4, verticalAlign: "middle" }} /> Bleu = ERA5 reanalyse (2000-2025)</span>
            <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: GREEN.bg, border: `1px solid ${GREEN.border}`, marginRight: 4, verticalAlign: "middle" }} /> Vert = Polymarket + WU (nov 2025+)</span>
            <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: PURPLE.bg, border: `1px solid ${PURPLE.border}`, marginRight: 4, verticalAlign: "middle" }} /> Violet = GFS Previous Runs (2024-2025)</span>
          </div>
        )}

        {/* ═══ LEVEL 1: City table ═══ */}
        {!selectedCity && cities.length > 0 && (
          <div style={CARD}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: "0 0 16px" }}>Par ville</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                    {["Ville", "Station", "Unite", "Biais J-1", "MAE J-1", "Biais J-2", "MAE J-2", "Biais J-3", "MAE J-3", "N", "Fiable"].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cities.map((city, i) => {
                    const stationBiases = biasMap.get(city.station);
                    const b1 = stationBiases?.get(1);
                    const b2 = stationBiases?.get(2);
                    const b3 = stationBiases?.get(3);
                    return (
                      <tr key={city.station} onClick={() => selectCity(city.name, city.station)}
                        style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#f9fafb", cursor: "pointer" }}>
                        <td style={{ ...TD, fontWeight: 600, color: "#111827" }}>{city.name}</td>
                        <td style={TD}><code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>{city.station}</code></td>
                        <td style={TD}>{unitLabel(city.unit)}</td>
                        {b1 ? <>
                          <td style={{ ...TD, fontWeight: 600, color: biasColor(b1.bias_mean) }}>{b1.bias_mean > 0 ? "+" : ""}{b1.bias_mean.toFixed(2)}&deg;C</td>
                          <td style={TD}>{b1.mae.toFixed(2)}&deg;C</td>
                        </> : <><td /><td /></>}
                        {b2 ? <>
                          <td style={{ ...TD, fontWeight: 600, color: biasColor(b2.bias_mean) }}>{b2.bias_mean > 0 ? "+" : ""}{b2.bias_mean.toFixed(2)}&deg;C</td>
                          <td style={TD}>{b2.mae.toFixed(2)}&deg;C</td>
                        </> : <><td /><td /></>}
                        {b3 ? <>
                          <td style={{ ...TD, fontWeight: 600, color: biasColor(b3.bias_mean) }}>{b3.bias_mean > 0 ? "+" : ""}{b3.bias_mean.toFixed(2)}&deg;C</td>
                          <td style={TD}>{b3.mae.toFixed(2)}&deg;C</td>
                        </> : <><td /><td /></>}
                        <td style={{ ...TD, color: "#6b7280" }}>{b1?.n ?? ""}</td>
                        <td style={TD}>
                          {b1 ? (
                            <span style={{ background: b1.reliable ? "#dcfce7" : "#fef3c7", color: b1.reliable ? "#166534" : "#92400e", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                              {b1.reliable ? "oui" : "non"}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ LEVEL 2: Calendar ═══ */}
        {selectedCity && !selectedDate && (() => {
          if (cityLoading) return (
            <div style={CARD}>
              <p style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>Chargement des donnees {selectedCity}...</p>
            </div>
          );

          const unit = cityInfo?.unit || "C";
          const year = calMonth.getFullYear();
          const month = calMonth.getMonth();

          // Calendar grid
          const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const cells: (number | null)[] = [];
          for (let i = 0; i < firstDow; i++) cells.push(null);
          for (let d = 1; d <= daysInMonth; d++) cells.push(d);
          while (cells.length % 7 !== 0) cells.push(null);

          return (
            <div style={CARD}>
              {/* Month nav */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <button onClick={() => {
                  const prev = new Date(year, month - 1);
                  setCalMonth(prev);
                  if (cityInfo) loadMonthData(cityInfo.station, prev.getFullYear(), prev.getMonth());
                }}
                  style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 14, color: "#374151" }}>&larr;</button>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: 0 }}>
                  {selectedCity} &mdash; {MONTHS_FR[month]} {year}
                </h2>
                <button onClick={() => {
                  const next = new Date(year, month + 1);
                  setCalMonth(next);
                  if (cityInfo) loadMonthData(cityInfo.station, next.getFullYear(), next.getMonth());
                }}
                  style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 14, color: "#374151" }}>&rarr;</button>
              </div>

              {/* Legend */}
              <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 16, fontSize: 11 }}>
                <span style={{ color: BLUE.text }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: BLUE.bg, border: `1px solid ${BLUE.border}`, marginRight: 3, verticalAlign: "middle" }} />ERA5</span>
                <span style={{ color: GREEN.text }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: GREEN.bg, border: `1px solid ${GREEN.border}`, marginRight: 3, verticalAlign: "middle" }} />Polymarket</span>
                <span style={{ color: PURPLE.text }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: PURPLE.bg, border: `1px solid ${PURPLE.border}`, marginRight: 3, verticalAlign: "middle" }} />GFS hist.</span>
              </div>

              {/* Polymarket late cities notice */}
              {POLYMARKET_LATE_CITIES.includes(selectedCity!) && wuDates.size === 0 && (
                <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#92400e", lineHeight: 1.5 }}>
                  Les premiers marches Polymarket pour {selectedCity} commencent le 24 mars 2026.<br />
                  Les donnees GFS historiques (<span style={{ color: PURPLE.text }}>&#9679;</span>) et ERA5 (<span style={{ color: BLUE.text }}>&#9679;</span>) sont disponibles dans le calendrier.
                </div>
              )}

              {/* Day headers */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
                {DAYS_FR.map(d => (
                  <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "#9ca3af", padding: 4 }}>{d}</div>
                ))}
              </div>

              {/* Calendar cells */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {cells.map((day, i) => {
                  if (day === null) return <div key={i} />;
                  const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const dtype = dayType(dateStr, wuDates, era5Dates, gfsHistDates);
                  const style = typeStyle(dtype);

                  // Get temperature
                  let temp: number | null = null;
                  if (dtype === "green") temp = wuData[dateStr] ?? null;
                  else if (dtype === "blue") temp = era5Data[dateStr] ?? null;
                  else if (dtype === "purple") temp = era5Data[dateStr] ?? null;

                  // GFS error for green days
                  let gfsError: number | null = null;
                  if (dtype === "green" && gfsLiveData[dateStr]?.[1] != null && temp != null) {
                    gfsError = gfsLiveData[dateStr][1] - temp;
                  }

                  if (dtype === "none") {
                    return (
                      <div key={i} style={{ padding: 8, borderRadius: 8, background: "#f9fafb", minHeight: 64, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ fontSize: 11, color: "#d1d5db" }}>{day}</div>
                      </div>
                    );
                  }

                  return (
                    <div key={i} onClick={() => setSelectedDate(dateStr)}
                      style={{
                        padding: 8, borderRadius: 8, minHeight: 64, cursor: "pointer",
                        background: style.bg, border: `1px solid ${style.border}20`,
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = style.border)}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = `${style.border}20`)}>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>{day}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
                        {temp != null ? `${displayTemp(temp, unit)}\u00b0` : "\u2014"}
                      </div>
                      {dtype === "green" && gfsError != null && (
                        <div style={{ fontSize: 9, fontWeight: 600, color: errText(gfsError) }}>
                          J-1: {gfsError > 0 ? "+" : ""}{gfsError.toFixed(1)}\u00b0
                        </div>
                      )}
                      {dtype === "purple" && gfsHistData[dateStr]?.[1] != null && (
                        <div style={{ fontSize: 9, fontWeight: 600, color: PURPLE.text }}>
                          GFS: {displayTemp(gfsHistData[dateStr][1], unit)}\u00b0
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ═══ LEVEL 3: Day detail ═══ */}
        {selectedCity && selectedDate && (() => {
          const unit = cityInfo?.unit || "C";
          const uLabel = unitLabel(unit);
          const dtype = dayType(selectedDate, wuDates, era5Dates, gfsHistDates);

          // Temperature
          const actualTemp = dtype === "green" ? wuData[selectedDate] : era5Data[selectedDate];

          // GFS data
          const gfs = dtype === "green" ? gfsLiveData[selectedDate] : gfsHistData[selectedDate];

          // Brackets (only for green days)
          const dayBrackets = dtype === "green"
            ? bracketsData.filter(b => b.date === selectedDate)
            : [];

          // Timeline
          const points = [
            { label: "J-3", temp: gfs?.[3] ?? null },
            { label: "J-2", temp: gfs?.[2] ?? null },
            { label: "J-1", temp: gfs?.[1] ?? null },
            { label: "J-0", temp: gfs?.[0] ?? null },
            { label: dtype === "green" ? "Reel WU" : "Reel ERA5", temp: actualTemp ?? null },
          ];

          const style = typeStyle(dtype);

          return <>
            {/* Date header */}
            <div style={{ ...CARD, borderLeft: `4px solid ${style.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ background: style.bg, color: style.text, padding: "2px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
                  {style.label}
                </span>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: 0 }}>
                  {selectedCity} &mdash; {selectedDate}
                </h2>
              </div>
              <p style={{ color: "#6b7280", fontSize: 13, margin: "4px 0 0" }}>
                Station {cityInfo?.station}
                {dtype === "green" && dayBrackets.length > 0 && <> &middot; {dayBrackets.length} brackets</>}
                {dtype === "blue" && <> &middot; Donnee ERA5 reanalyse</>}
                {dtype === "purple" && <> &middot; GFS Previous Runs historique</>}
              </p>
            </div>

            {/* Timeline */}
            <div style={CARD}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", margin: "0 0 20px", textTransform: "uppercase", letterSpacing: 1 }}>
                {dtype === "blue" ? "Temperature ERA5" : "Convergence des previsions"}
              </h3>
              {dtype === "blue" ? (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div style={{ fontSize: 48, fontWeight: 700, color: BLUE.text }}>
                    {actualTemp != null ? `${displayTemp(actualTemp, unit)}${uLabel}` : "\u2014"}
                  </div>
                  <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>Temperature max ERA5 reanalyse</div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "flex-end", position: "relative", padding: "0 8px" }}>
                  <div style={{ position: "absolute", top: "50%", left: 40, right: 40, height: 2, background: "#e5e7eb", zIndex: 0 }} />
                  {points.map((p, i) => {
                    const isReal = i === points.length - 1;
                    const error = p.temp != null && actualTemp != null && !isReal ? p.temp - actualTemp : null;
                    return (
                      <div key={p.label} style={{ flex: 1, textAlign: "center", position: "relative", zIndex: 1 }}>
                        <div style={{
                          width: isReal ? 16 : 12, height: isReal ? 16 : 12, borderRadius: "50%",
                          background: isReal ? style.border : error != null ? (Math.abs(error) <= 1 ? "#16a34a" : Math.abs(error) <= 2 ? "#ca8a04" : "#dc2626") : "#d1d5db",
                          margin: "0 auto 8px", border: isReal ? `3px solid ${style.bg}` : "2px solid #fff",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                        }} />
                        <div style={{ fontSize: isReal ? 22 : 18, fontWeight: 700, color: isReal ? style.text : "#111827" }}>
                          {p.temp != null ? `${displayTemp(p.temp, unit)}${uLabel}` : "\u2014"}
                        </div>
                        {error != null && (
                          <div style={{ fontSize: 13, fontWeight: 600, color: Math.abs(error) <= 1 ? "#16a34a" : Math.abs(error) <= 2 ? "#ca8a04" : "#dc2626", marginTop: 2 }}>
                            {error > 0 ? "+" : ""}{error.toFixed(1)}&deg;C
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, fontWeight: 600 }}>{p.label}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Brackets table (green days only) */}
            {dtype === "green" && dayBrackets.length > 0 && (() => {
              // Predict brackets using GFS J-1
              const gfsJ1 = gfs?.[1];
              const gfsJ2 = gfs?.[2];
              const gfsJ3 = gfs?.[3];

              function predictBracket(gfsTemp: number | undefined, bracketTemp: number, op: string, bUnit: string): string | null {
                if (gfsTemp == null) return null;
                const g = bUnit === "F" ? Math.round(gfsTemp * 9 / 5 + 32) : Math.round(gfsTemp);
                if (op === "lte") return g <= bracketTemp ? "YES" : "NO";
                if (op === "gte") return g >= bracketTemp ? "YES" : "NO";
                if (op === "range") return (g >= bracketTemp && g <= bracketTemp + 1) ? "YES" : "NO";
                return g === bracketTemp ? "YES" : "NO";
              }

              const sorted = [...dayBrackets].sort((a, b) => (a.bracket_temp ?? 0) - (b.bracket_temp ?? 0));

              return (
                <div style={CARD}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: 1 }}>
                    Detail des brackets
                  </h3>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                          {["Bracket", "Type", "Winner", "GFS J-3", "GFS J-2", "GFS J-1"].map((h, i) => (
                            <th key={i} style={TH}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((b, i) => {
                          const isWinner = b.winner === "YES";
                          const bUnit = b.unit || unit;
                          const predJ1 = predictBracket(gfsJ1, b.bracket_temp, b.bracket_op, bUnit);
                          const predJ2 = predictBracket(gfsJ2, b.bracket_temp, b.bracket_op, bUnit);
                          const predJ3 = predictBracket(gfsJ3, b.bracket_temp, b.bracket_op, bUnit);
                          const correctJ1 = predJ1 === b.winner;
                          const correctJ2 = predJ2 === b.winner;
                          const correctJ3 = predJ3 === b.winner;

                          return (
                            <tr key={i} style={{
                              borderBottom: "1px solid #f3f4f6",
                              background: isWinner ? "#f0fdf4" : i % 2 === 0 ? "#fff" : "#f9fafb",
                            }}>
                              <td style={{ ...TD, fontWeight: isWinner ? 700 : 400, color: isWinner ? "#166534" : "#111827" }}>{b.bracket_str}</td>
                              <td style={TD}>
                                <span style={{
                                  background: b.bracket_op === "lte" || b.bracket_op === "gte" ? "#dbeafe" : b.bracket_op === "range" ? "#fef3c7" : "#f3f4f6",
                                  color: b.bracket_op === "lte" || b.bracket_op === "gte" ? "#1d4ed8" : b.bracket_op === "range" ? "#92400e" : "#374151",
                                  padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                                }}>{b.bracket_op}</span>
                              </td>
                              <td style={TD}>
                                <span style={{
                                  background: isWinner ? "#dcfce7" : "#fee2e2",
                                  color: isWinner ? "#166534" : "#991b1b",
                                  padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600,
                                }}>{b.winner}</span>
                              </td>
                              <td style={TD}>{predJ3 != null ? <span style={{ color: correctJ3 ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{predJ3} {correctJ3 ? "\u2713" : "\u2717"}</span> : <span style={{ color: "#d1d5db" }}>\u2014</span>}</td>
                              <td style={TD}>{predJ2 != null ? <span style={{ color: correctJ2 ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{predJ2} {correctJ2 ? "\u2713" : "\u2717"}</span> : <span style={{ color: "#d1d5db" }}>\u2014</span>}</td>
                              <td style={TD}>{predJ1 != null ? <span style={{ color: correctJ1 ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{predJ1} {correctJ1 ? "\u2713" : "\u2717"}</span> : <span style={{ color: "#d1d5db" }}>\u2014</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </>;
        })()}

        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, marginTop: 24 }}>
          Source: ERA5 (Open-Meteo) + Wunderground + GFS Previous Runs + Polymarket
        </p>
      </div>
    </div>
  );
}
