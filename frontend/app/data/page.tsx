"use client";
import { useEffect, useState } from "react";

const RAW = "/backtest_stats.json";

interface BiasData { mean: number; mae: number; pct_within_1: number; n: number }
interface CityData {
  station: string; unit: string; n_dates: number;
  first_date: string; last_date: string;
  bias: Record<string, BiasData>;
}
interface BracketDetail {
  bracket: string; op: string; temp: number; winner: string;
  gfs_j1_prediction?: string; gfs_j1_correct?: boolean;
  gfs_j2_prediction?: string; gfs_j2_correct?: boolean;
  gfs_j3_prediction?: string; gfs_j3_correct?: boolean;
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
}

const biasColor = (b: number) => Math.abs(b) <= 0.5 ? "#16a34a" : Math.abs(b) <= 1.5 ? "#ca8a04" : "#dc2626";
const accColor = (a: number) => a >= 0.85 ? "#16a34a" : a >= 0.70 ? "#ca8a04" : "#dc2626";
const errBg = (e: number) => Math.abs(e) <= 1 ? "#dcfce7" : Math.abs(e) <= 2 ? "#fef9c3" : "#fee2e2";
const errText = (e: number) => Math.abs(e) <= 1 ? "#166534" : Math.abs(e) <= 2 ? "#854d0e" : "#991b1b";

const CARD = { background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 24 };
const TH: React.CSSProperties = { padding: "8px 10px", textAlign: "left", color: "#6b7280", fontWeight: 600, fontSize: 12 };
const TD: React.CSSProperties = { padding: "8px 10px", fontSize: 13 };
const DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS_FR = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"];

function displayTemp(tempC: number, unit: string): string {
  if (unit === "F") return `${Math.round(tempC * 9 / 5 + 32)}`;
  return tempC.toFixed(1);
}
function unitLabel(unit: string): string {
  return unit === "F" ? "\u00b0F" : "\u00b0C";
}

export default function DataPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calMonth, setCalMonth] = useState<Date>(new Date(2026, 2)); // Mars 2026

  useEffect(() => {
    fetch(`${RAW}?t=${Date.now()}`).then(r => r.json()).then(setStats).catch(console.error);
  }, []);

  if (!stats) return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#6b7280", fontSize: 18 }}>Chargement...</p>
    </div>
  );

  const summary = stats.summary ?? { n_markets: 0, n_wu: 0, n_gfs: 0, n_cities: 0 };
  const cities = (stats.cities ?? {}) as Record<string, CityData>;
  const horizon_summary = stats.horizon_summary ?? {};
  const daily_detail = stats.daily_detail ?? [];
  const cityList = Object.entries(cities).sort((a, b) => (b[1].n_dates || 0) - (a[1].n_dates || 0));

  // City daily data
  const cityDays = selectedCity
    ? daily_detail.filter(d => d.city === selectedCity).sort((a, b) => a.date.localeCompare(b.date))
    : [];

  // Selected day data
  const dayData = selectedDate && selectedCity
    ? daily_detail.find(d => d.city === selectedCity && d.date === selectedDate)
    : null;

  // Set calendar month when selecting a city (go to most recent month with data)
  const selectCity = (name: string) => {
    if (selectedCity === name) { setSelectedCity(null); setSelectedDate(null); return; }
    setSelectedCity(name);
    setSelectedDate(null);
    const days = daily_detail.filter(d => d.city === name);
    if (days.length > 0) {
      const last = days.sort((a, b) => b.date.localeCompare(a.date))[0].date;
      const [y, m] = last.split("-").map(Number);
      setCalMonth(new Date(y, m - 1));
    }
  };

  // ── BACK BUTTON ─────────────────────────────────────────────────────
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
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0 }}>Data</h1>
          <p style={{ color: "#6b7280", marginTop: 4, fontSize: 14 }}>
            {summary.n_markets.toLocaleString()} brackets &middot; {summary.n_wu} jours WU &middot; {summary.n_gfs.toLocaleString()} GFS &middot; {summary.n_cities} villes
          </p>
        </div>

        {backButton}

        {/* KPIs */}
        {!selectedCity && Object.keys(horizon_summary).length > 0 && (
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
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{h.n_dates} jours &middot; {h.n_brackets.toLocaleString()} brackets</div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ LEVEL 1: City table ═══ */}
        {!selectedCity && cityList.length > 0 && (
          <div style={CARD}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: "0 0 16px" }}>Par ville</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                    {["Ville", "Station", "N", "Biais J-1", "MAE J-1", "\u00b11\u00b0C", "Biais J-2", "MAE J-2", "Biais J-3", "MAE J-3"].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cityList.map(([name, city], i) => {
                    const j1 = city.bias?.j1;
                    const j2 = city.bias?.j2;
                    const j3 = city.bias?.j3;
                    return (
                      <tr key={name} onClick={() => selectCity(name)}
                        style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#f9fafb", cursor: "pointer" }}>
                        <td style={{ ...TD, fontWeight: 600, color: "#111827" }}>{name}</td>
                        <td style={TD}><code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>{city.station}</code></td>
                        <td style={{ ...TD, color: "#6b7280" }}>{city.n_dates}</td>
                        {j1 ? <>
                          <td style={{ ...TD, fontWeight: 600, color: biasColor(j1.mean) }}>{j1.mean > 0 ? "+" : ""}{j1.mean}&deg;C</td>
                          <td style={TD}>{j1.mae}&deg;C</td>
                          <td style={TD}>{j1.pct_within_1 != null ? `${(j1.pct_within_1 * 100).toFixed(0)}%` : "\u2014"}</td>
                        </> : <><td /><td /><td /></>}
                        {j2 ? <>
                          <td style={{ ...TD, color: biasColor(j2.mean) }}>{j2.mean > 0 ? "+" : ""}{j2.mean}&deg;C</td>
                          <td style={TD}>{j2.mae}&deg;C</td>
                        </> : <><td /><td /></>}
                        {j3 ? <>
                          <td style={{ ...TD, color: biasColor(j3.mean) }}>{j3.mean > 0 ? "+" : ""}{j3.mean}&deg;C</td>
                          <td style={TD}>{j3.mae}&deg;C</td>
                        </> : <><td /><td /></>}
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
          const cityUnit = cities[selectedCity]?.unit || "C";
          const year = calMonth.getFullYear();
          const month = calMonth.getMonth();
          // Build day map for this month
          const dayMap: Record<number, DailyRow> = {};
          for (const d of cityDays) {
            const [y, m, day] = d.date.split("-").map(Number);
            if (y === year && m === month + 1) dayMap[day] = d;
          }
          // Calendar grid
          const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const cells: (number | null)[] = [];
          for (let i = 0; i < firstDow; i++) cells.push(null);
          for (let d = 1; d <= daysInMonth; d++) cells.push(d);
          while (cells.length % 7 !== 0) cells.push(null);

          // Available months
          const availableMonths = new Set<string>();
          for (const d of cityDays) availableMonths.add(d.date.slice(0, 7));

          return (
            <div style={CARD}>
              {/* Month nav */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <button onClick={() => setCalMonth(new Date(year, month - 1))}
                  style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 14, color: "#374151" }}>&larr;</button>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: 0 }}>
                  {selectedCity} &mdash; {MONTHS_FR[month]} {year}
                </h2>
                <button onClick={() => setCalMonth(new Date(year, month + 1))}
                  style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 14, color: "#374151" }}>&rarr;</button>
              </div>

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
                  const row = dayMap[day];
                  if (!row) {
                    return (
                      <div key={i} style={{ padding: 8, borderRadius: 8, background: "#f9fafb", minHeight: 64, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ fontSize: 11, color: "#d1d5db" }}>{day}</div>
                      </div>
                    );
                  }
                  const absErr = Math.abs(row.error_j1 ?? 99);
                  return (
                    <div key={i} onClick={() => setSelectedDate(row.date)}
                      style={{
                        padding: 8, borderRadius: 8, minHeight: 64, cursor: "pointer",
                        background: errBg(row.error_j1 ?? 99),
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        border: "1px solid transparent",
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = "#6b7280")}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = "transparent")}>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>{day}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>
                        {displayTemp(row.actual_temp, cityUnit)}&deg;
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: errText(row.error_j1 ?? 99) }}>
                        J-1: {row.error_j1 != null ? `${row.error_j1 > 0 ? "+" : ""}${row.error_j1.toFixed(1)}\u00b0` : "\u2014"}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 12, fontSize: 11, color: "#6b7280" }}>
                <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#dcfce7", marginRight: 4, verticalAlign: "middle" }} /> &le;1&deg;C</span>
                <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#fef9c3", marginRight: 4, verticalAlign: "middle" }} /> 1-2&deg;C</span>
                <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#fee2e2", marginRight: 4, verticalAlign: "middle" }} /> &gt;2&deg;C</span>
              </div>
            </div>
          );
        })()}

        {/* ═══ LEVEL 3: Day detail ═══ */}
        {selectedCity && selectedDate && dayData && (() => {
          const u = dayData.unit;
          const uLabel = unitLabel(u);

          // Timeline points
          const points = [
            { label: "J-3", temp: dayData.gfs_j3, error: dayData.error_j3 },
            { label: "J-2", temp: dayData.gfs_j2, error: dayData.error_j2 },
            { label: "J-1", temp: dayData.gfs_j1, error: dayData.error_j1 },
            { label: "J-0", temp: dayData.gfs_j0, error: dayData.error_j0 },
            { label: "Reel WU", temp: dayData.actual_temp, error: null },
          ];

          // Bracket stats
          const brackets = dayData.brackets || [];
          const total = brackets.length;
          const correctJ1 = brackets.filter(b => b.gfs_j1_correct).length;
          const correctJ2 = brackets.filter(b => b.gfs_j2_correct).length;
          const correctJ3 = brackets.filter(b => b.gfs_j3_correct).length;
          const hasJ2 = brackets.some(b => b.gfs_j2_prediction != null);
          const hasJ3 = brackets.some(b => b.gfs_j3_prediction != null);

          return <>
            {/* Date header */}
            <div style={CARD}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
                {selectedCity} &mdash; {selectedDate}
              </h2>
              <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>
                Station {dayData.station} &middot; {dayData.winning_bracket && <>Bracket gagnant : <strong style={{ color: "#2563eb" }}>{dayData.winning_bracket}</strong> &middot; </>}{total} brackets
              </p>
            </div>

            {/* Timeline */}
            <div style={CARD}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", margin: "0 0 20px", textTransform: "uppercase", letterSpacing: 1 }}>
                Convergence des previsions
              </h3>
              <div style={{ display: "flex", alignItems: "flex-end", position: "relative", padding: "0 8px" }}>
                {/* Connecting line */}
                <div style={{ position: "absolute", top: "50%", left: 40, right: 40, height: 2, background: "#e5e7eb", zIndex: 0 }} />
                {points.map((p, i) => {
                  const isReal = i === points.length - 1;
                  return (
                    <div key={p.label} style={{ flex: 1, textAlign: "center", position: "relative", zIndex: 1 }}>
                      {/* Dot */}
                      <div style={{
                        width: isReal ? 16 : 12, height: isReal ? 16 : 12,
                        borderRadius: "50%",
                        background: isReal ? "#2563eb" : p.error != null ? (Math.abs(p.error) <= 1 ? "#16a34a" : Math.abs(p.error) <= 2 ? "#ca8a04" : "#dc2626") : "#d1d5db",
                        margin: "0 auto 8px",
                        border: isReal ? "3px solid #93c5fd" : "2px solid #fff",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                      }} />
                      {/* Temp */}
                      <div style={{ fontSize: isReal ? 22 : 18, fontWeight: 700, color: isReal ? "#2563eb" : "#111827" }}>
                        {p.temp != null ? `${displayTemp(p.temp, u)}${uLabel}` : "\u2014"}
                      </div>
                      {/* Error */}
                      {p.error != null && (
                        <div style={{ fontSize: 13, fontWeight: 600, color: Math.abs(p.error) <= 1 ? "#16a34a" : Math.abs(p.error) <= 2 ? "#ca8a04" : "#dc2626", marginTop: 2 }}>
                          {p.error > 0 ? "+" : ""}{p.error.toFixed(1)}&deg;C
                        </div>
                      )}
                      {/* Label */}
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, fontWeight: 600 }}>{p.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bracket summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
              {[
                { label: "J-1", correct: correctJ1, has: true },
                { label: "J-2", correct: correctJ2, has: hasJ2 },
                { label: "J-3", correct: correctJ3, has: hasJ3 },
              ].map(h => (
                <div key={h.label} style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: h.has && h.correct === total ? "#16a34a" : h.has && h.correct >= total * 0.9 ? "#ca8a04" : h.has ? "#dc2626" : "#d1d5db" }}>
                    {h.has ? `${h.correct}/${total}` : "\u2014"}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Corrects {h.label}</div>
                  {h.has && <div style={{ fontSize: 11, color: "#9ca3af" }}>{((h.correct / total) * 100).toFixed(0)}%</div>}
                </div>
              ))}
            </div>

            {/* Bracket table */}
            <div style={CARD}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: 1 }}>
                Detail des brackets
              </h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                      {["Bracket", "Type", "Winner", "GFS J-3", "GFS J-2", "GFS J-1", ""].map((h, i) => (
                        <th key={i} style={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {brackets.map((b, i) => {
                      const isWinner = b.winner === "YES";
                      return (
                        <tr key={i} style={{
                          borderBottom: "1px solid #f3f4f6",
                          background: isWinner ? "#f0fdf4" : i % 2 === 0 ? "#fff" : "#f9fafb",
                        }}>
                          <td style={{ ...TD, fontWeight: isWinner ? 700 : 400, color: isWinner ? "#166534" : "#111827" }}>{b.bracket}</td>
                          <td style={TD}>
                            <span style={{
                              background: b.op === "lte" || b.op === "gte" ? "#dbeafe" : b.op === "range" ? "#fef3c7" : "#f3f4f6",
                              color: b.op === "lte" || b.op === "gte" ? "#1d4ed8" : b.op === "range" ? "#92400e" : "#374151",
                              padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                            }}>{b.op}</span>
                          </td>
                          <td style={TD}>
                            <span style={{
                              background: isWinner ? "#dcfce7" : "#fee2e2",
                              color: isWinner ? "#166534" : "#991b1b",
                              padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600,
                            }}>{b.winner}</span>
                          </td>
                          {/* J-3 */}
                          <td style={TD}>
                            {b.gfs_j3_prediction != null ? (
                              <span style={{ color: b.gfs_j3_correct ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                                {b.gfs_j3_prediction} {b.gfs_j3_correct ? "\u2713" : "\u2717"}
                              </span>
                            ) : <span style={{ color: "#d1d5db" }}>\u2014</span>}
                          </td>
                          {/* J-2 */}
                          <td style={TD}>
                            {b.gfs_j2_prediction != null ? (
                              <span style={{ color: b.gfs_j2_correct ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                                {b.gfs_j2_prediction} {b.gfs_j2_correct ? "\u2713" : "\u2717"}
                              </span>
                            ) : <span style={{ color: "#d1d5db" }}>\u2014</span>}
                          </td>
                          {/* J-1 */}
                          <td style={TD}>
                            {b.gfs_j1_prediction != null ? (
                              <span style={{ color: b.gfs_j1_correct ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                                {b.gfs_j1_prediction} {b.gfs_j1_correct ? "\u2713" : "\u2717"}
                              </span>
                            ) : <span style={{ color: "#d1d5db" }}>\u2014</span>}
                          </td>
                          {/* Overall */}
                          <td style={{ ...TD, textAlign: "center" }}>
                            {isWinner && <span style={{ fontSize: 11, background: "#dcfce7", color: "#166534", padding: "2px 6px", borderRadius: 8, fontWeight: 700 }}>GAGNANT</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>;
        })()}

        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, marginTop: 24 }}>
          Mis a jour le {new Date(stats.updated_at).toLocaleString("fr-FR")} &middot; Source: Wunderground + Open-Meteo GFS
        </p>
      </div>
    </div>
  );
}
