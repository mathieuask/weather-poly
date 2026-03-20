"use client";
import { useEffect, useState } from "react";

const RAW = "https://raw.githubusercontent.com/mathieuask/weather-poly/master/frontend/public/backtest_stats.json";

interface BiasData { mean: number; mae: number; pct_within_1: number; n: number }
interface CityData {
  station: string; unit: string; n_dates: number;
  first_date: string; last_date: string;
  bias: Record<string, BiasData>;
}
interface BracketDetail {
  bracket: string; op: string; temp: number; winner: string;
  gfs_j1_prediction?: string; gfs_j1_correct?: boolean;
}
interface DailyRow {
  station: string; city: string; date: string; actual_temp: number; unit: string;
  gfs_j0?: number; gfs_j1?: number; gfs_j2?: number; gfs_j3?: number;
  error_j0?: number; error_j1?: number; error_j2?: number; error_j3?: number;
  winning_bracket?: string; n_brackets: number; brackets: BracketDetail[];
}
interface HorizonData { mae: number; bias: number; n_dates: number; bracket_accuracy: number; n_brackets: number }
interface Stats {
  updated_at: string;
  summary?: { n_markets: number; n_wu: number; n_gfs: number; n_cities: number };
  cities?: Record<string, CityData>;
  horizon_summary?: Record<string, HorizonData>;
  daily_detail?: DailyRow[];
  // Legacy fields
  n_markets?: number;
  n_actual_temps?: number;
  n_gfs?: number;
}

const biasColor = (b: number) => Math.abs(b) <= 0.5 ? "#16a34a" : Math.abs(b) <= 1.5 ? "#ca8a04" : "#dc2626";
const accColor = (a: number) => a >= 0.85 ? "#16a34a" : a >= 0.70 ? "#ca8a04" : "#dc2626";

export default function DataPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${RAW}?t=${Date.now()}`).then(r => r.json()).then(setStats).catch(console.error);
  }, []);

  if (!stats) return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#6b7280", fontSize: 18 }}>Chargement des donn\u00e9es\u2026</p>
    </div>
  );

  // Handle both new format (summary key) and legacy (flat keys)
  const summary = stats.summary ?? {
    n_markets: (stats as any).n_markets ?? 0,
    n_wu: (stats as any).n_actual_temps ?? 0,
    n_gfs: (stats as any).n_gfs ?? 0,
    n_cities: Object.keys(stats.cities ?? {}).length,
  };
  // cities can be an object {name: data} or legacy array [{city, station, ...}]
  const citiesRaw = stats.cities ?? {};
  let cities: Record<string, CityData>;
  if (Array.isArray(citiesRaw)) {
    // Legacy array format: convert to object
    cities = {};
    for (const c of citiesRaw as any[]) {
      cities[c.city || c.name || "?"] = {
        station: c.station || "?",
        unit: c.unit || "C",
        n_dates: c.n_markets || c.n_dates || 0,
        first_date: c.date_from || c.first_date || "",
        last_date: c.date_to || c.last_date || "",
        bias: {},
      };
    }
  } else {
    cities = citiesRaw as Record<string, CityData>;
  }
  const horizon_summary = stats.horizon_summary ?? {};
  const daily_detail = stats.daily_detail ?? [];
  const cityList = Object.entries(cities).sort((a, b) => (b[1].n_dates || 0) - (a[1].n_dates || 0));

  // Filter daily_detail for selected city
  const cityDays = selectedCity
    ? daily_detail.filter(d => d.city === selectedCity).sort((a, b) => b.date.localeCompare(a.date))
    : [];

  // Selected date brackets
  const dateBrackets = selectedDate && selectedCity
    ? daily_detail.find(d => d.city === selectedCity && d.date === selectedDate)
    : null;

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", padding: "24px 16px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0 }}>Data</h1>
          <p style={{ color: "#6b7280", marginTop: 4, fontSize: 14 }}>
            {summary.n_markets.toLocaleString()} brackets &middot; {summary.n_wu} jours WU &middot; {summary.n_gfs.toLocaleString()} GFS &middot; {summary.n_cities} villes
          </p>
        </div>

        {/* KPIs */}
        {Object.keys(horizon_summary).length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Object.keys(horizon_summary).length}, 1fr)`, gap: 12, marginBottom: 24 }}>
          {Object.entries(horizon_summary).map(([key, h]) => (
            <div key={key} style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{key.toUpperCase()}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: accColor(h.bracket_accuracy), marginTop: 4 }}>
                {(h.bracket_accuracy * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                MAE {h.mae}&deg;C &middot; biais {h.bias > 0 ? "+" : ""}{h.bias}&deg;C
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>{h.n_dates} jours</div>
            </div>
          ))}
        </div>
        )}

        {/* City table */}
        {cityList.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: "0 0 16px" }}>Par ville</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                  {["Ville", "Station", "N", "Biais J-1", "MAE J-1", "\u00b11\u00b0C J-1", "Biais J-2", "MAE J-2", "Biais J-3", "MAE J-3"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cityList.map(([name, city], i) => {
                  const j1 = city.bias?.j1;
                  const j2 = city.bias?.j2;
                  const j3 = city.bias?.j3;
                  const isSelected = selectedCity === name;
                  return (
                    <tr key={name}
                      onClick={() => { setSelectedCity(isSelected ? null : name); setSelectedDate(null); }}
                      style={{
                        borderBottom: "1px solid #f3f4f6",
                        background: isSelected ? "#eff6ff" : i % 2 === 0 ? "#fff" : "#f9fafb",
                        cursor: "pointer",
                      }}>
                      <td style={{ padding: "10px", fontWeight: 600, color: "#111827" }}>{name}</td>
                      <td style={{ padding: "10px" }}><span style={{ fontFamily: "monospace", background: "#f3f4f6", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>{city.station}</span></td>
                      <td style={{ padding: "10px", color: "#6b7280" }}>{city.n_dates}</td>
                      {j1 ? <>
                        <td style={{ padding: "10px", fontWeight: 600, color: biasColor(j1.mean) }}>{j1.mean > 0 ? "+" : ""}{j1.mean}&deg;C</td>
                        <td style={{ padding: "10px" }}>{j1.mae}&deg;C</td>
                        <td style={{ padding: "10px" }}>{j1.pct_within_1 != null ? `${(j1.pct_within_1 * 100).toFixed(0)}%` : "\u2014"}</td>
                      </> : <><td /><td /><td /></>}
                      {j2 ? <>
                        <td style={{ padding: "10px", color: biasColor(j2.mean) }}>{j2.mean > 0 ? "+" : ""}{j2.mean}&deg;C</td>
                        <td style={{ padding: "10px" }}>{j2.mae}&deg;C</td>
                      </> : <><td /><td /></>}
                      {j3 ? <>
                        <td style={{ padding: "10px", color: biasColor(j3.mean) }}>{j3.mean > 0 ? "+" : ""}{j3.mean}&deg;C</td>
                        <td style={{ padding: "10px" }}>{j3.mae}&deg;C</td>
                      </> : <><td /><td /></>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* Daily detail for selected city */}
        {selectedCity && cityDays.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: "0 0 16px" }}>
              {selectedCity} &mdash; {cityDays.length} jours
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                    {["Date", "T\u00b0 r\u00e9elle", "GFS J-1", "Err J-1", "GFS J-2", "Err J-2", "GFS J-3", "Err J-3", "Bracket gagnant"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cityDays.map((day, i) => {
                    const unit = day.unit === "F" ? "\u00b0F" : "\u00b0C";
                    const actual = day.unit === "F" ? Math.round(day.actual_temp * 9/5 + 32) : day.actual_temp;
                    const isDateSelected = selectedDate === day.date;
                    return (
                      <tr key={day.date}
                        onClick={() => setSelectedDate(isDateSelected ? null : day.date)}
                        style={{
                          borderBottom: "1px solid #f3f4f6",
                          background: isDateSelected ? "#fef3c7" : i % 2 === 0 ? "#fff" : "#f9fafb",
                          cursor: "pointer",
                        }}>
                        <td style={{ padding: "10px", fontWeight: 500 }}>{day.date}</td>
                        <td style={{ padding: "10px", fontWeight: 700 }}>{actual}{unit}</td>
                        <td style={{ padding: "10px" }}>{day.gfs_j1 != null ? `${day.unit === "F" ? Math.round(day.gfs_j1 * 9/5 + 32) : day.gfs_j1.toFixed(1)}${unit}` : "\u2014"}</td>
                        <td style={{ padding: "10px", color: day.error_j1 != null ? biasColor(day.error_j1) : "#9ca3af", fontWeight: 600 }}>
                          {day.error_j1 != null ? `${day.error_j1 > 0 ? "+" : ""}${day.error_j1.toFixed(1)}\u00b0` : "\u2014"}
                        </td>
                        <td style={{ padding: "10px" }}>{day.gfs_j2 != null ? `${day.unit === "F" ? Math.round(day.gfs_j2 * 9/5 + 32) : day.gfs_j2.toFixed(1)}${unit}` : "\u2014"}</td>
                        <td style={{ padding: "10px", color: day.error_j2 != null ? biasColor(day.error_j2) : "#9ca3af" }}>
                          {day.error_j2 != null ? `${day.error_j2 > 0 ? "+" : ""}${day.error_j2.toFixed(1)}\u00b0` : "\u2014"}
                        </td>
                        <td style={{ padding: "10px" }}>{day.gfs_j3 != null ? `${day.unit === "F" ? Math.round(day.gfs_j3 * 9/5 + 32) : day.gfs_j3.toFixed(1)}${unit}` : "\u2014"}</td>
                        <td style={{ padding: "10px", color: day.error_j3 != null ? biasColor(day.error_j3) : "#9ca3af" }}>
                          {day.error_j3 != null ? `${day.error_j3 > 0 ? "+" : ""}${day.error_j3.toFixed(1)}\u00b0` : "\u2014"}
                        </td>
                        <td style={{ padding: "10px", fontWeight: 600, color: "#2563eb" }}>{day.winning_bracket || "\u2014"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Bracket detail for selected date */}
        {dateBrackets && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: "0 0 16px" }}>
              {selectedCity} &mdash; {selectedDate} &mdash; {dateBrackets.n_brackets} brackets
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                    {["Bracket", "Type", "Winner", "GFS J-1 pr\u00e9dit", "Correct ?"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dateBrackets.brackets.map((b, i) => (
                    <tr key={i} style={{
                      borderBottom: "1px solid #f3f4f6",
                      background: b.winner === "YES" ? "#f0fdf4" : i % 2 === 0 ? "#fff" : "#f9fafb",
                    }}>
                      <td style={{ padding: "10px", fontWeight: b.winner === "YES" ? 700 : 400 }}>{b.bracket}</td>
                      <td style={{ padding: "10px" }}>
                        <span style={{
                          background: b.op === "lte" || b.op === "gte" ? "#dbeafe" : b.op === "range" ? "#fef3c7" : "#f3f4f6",
                          color: b.op === "lte" || b.op === "gte" ? "#1d4ed8" : b.op === "range" ? "#92400e" : "#374151",
                          padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                        }}>{b.op}</span>
                      </td>
                      <td style={{ padding: "10px" }}>
                        <span style={{
                          background: b.winner === "YES" ? "#dcfce7" : "#fee2e2",
                          color: b.winner === "YES" ? "#166534" : "#991b1b",
                          padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600,
                        }}>{b.winner}</span>
                      </td>
                      <td style={{ padding: "10px" }}>{b.gfs_j1_prediction || "\u2014"}</td>
                      <td style={{ padding: "10px" }}>
                        {b.gfs_j1_correct != null ? (
                          <span style={{ color: b.gfs_j1_correct ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
                            {b.gfs_j1_correct ? "\u2713" : "\u2717"}
                          </span>
                        ) : "\u2014"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, marginTop: 24 }}>
          Mis \u00e0 jour le {new Date(stats.updated_at).toLocaleString("fr-FR")} &middot; Source: Wunderground + Open-Meteo GFS
        </p>
      </div>
    </div>
  );
}
