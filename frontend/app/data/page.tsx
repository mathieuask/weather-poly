"use client";
import { useEffect, useState } from "react";

const RAW = "https://raw.githubusercontent.com/mathieuask/weather-poly/master/frontend/public/backtest_stats.json";

interface City { city: string; n_markets: number; date_from: string; date_to: string; station: string; }
interface Accuracy { city: string; lead_days: number; n: number; mae: number; bias: number; pct_within_1c: number; }
interface Stats {
  updated_at: string; n_markets: number; n_actual_temps: number; n_gfs: number;
  cities: City[]; gfs_accuracy: Accuracy[];
}

export default function DataPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeCity, setActiveCity] = useState<string>("all");

  useEffect(() => {
    fetch(`${RAW}?t=${Date.now()}`).then(r => r.json()).then(setStats).catch(console.error);
  }, []);

  if (!stats) return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#6b7280", fontSize: 18 }}>Chargement des données…</p>
    </div>
  );

  const cities = stats.cities || [];
  const accuracy = (stats.gfs_accuracy || []).filter(a =>
    activeCity === "all" || a.city === activeCity
  );

  // Groupe accuracy par ville + lead
  const cityLeadMap: Record<string, Record<number, Accuracy>> = {};
  for (const a of stats.gfs_accuracy || []) {
    if (!cityLeadMap[a.city]) cityLeadMap[a.city] = {};
    cityLeadMap[a.city][a.lead_days] = a;
  }

  const biasColor = (b: number) => {
    const abs = Math.abs(b);
    if (abs <= 0.5) return "#16a34a";
    if (abs <= 1.5) return "#ca8a04";
    return "#dc2626";
  };

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", padding: "24px 16px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0 }}>📊 Data</h1>
          <p style={{ color: "#6b7280", marginTop: 4, fontSize: 14 }}>
            Historique Polymarket × Wunderground × GFS — mis à jour en continu
          </p>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Marchés résolus", value: stats.n_markets.toLocaleString(), icon: "📋" },
            { label: "Températures WU", value: stats.n_actual_temps.toLocaleString(), icon: "🌡" },
            { label: "Prévisions GFS", value: stats.n_gfs.toLocaleString(), icon: "📡" },
          ].map(k => (
            <div key={k.label} style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <div style={{ fontSize: 24 }}>{k.icon}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#111827", marginTop: 4 }}>{k.value}</div>
              <div style={{ fontSize: 13, color: "#6b7280" }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Tableau villes */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: "0 0 16px" }}>Couverture par ville</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                  {["Ville", "Station", "Marchés", "Depuis", "Jusqu'à"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cities.map((c, i) => (
                  <tr key={c.city} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "#111827" }}>{c.city}</td>
                    <td style={{ padding: "10px 12px" }}><span style={{ fontFamily: "monospace", background: "#f3f4f6", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>{c.station}</span></td>
                    <td style={{ padding: "10px 12px", color: "#2563eb", fontWeight: 600 }}>{c.n_markets}</td>
                    <td style={{ padding: "10px 12px", color: "#6b7280" }}>{c.date_from}</td>
                    <td style={{ padding: "10px 12px", color: "#6b7280" }}>{c.date_to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Précision GFS */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: 0 }}>🎯 Précision GFS par ville & horizon</h2>
            <select
              value={activeCity}
              onChange={e => setActiveCity(e.target.value)}
              style={{ fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb" }}
            >
              <option value="all">Toutes les villes</option>
              {cities.map(c => <option key={c.city} value={c.city}>{c.city}</option>)}
            </select>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                  {["Ville", "Horizon", "N jours", "Biais moyen", "MAE (°C)", "% ±1°C"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accuracy.map((a, i) => (
                  <tr key={`${a.city}-${a.lead_days}`} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "#111827" }}>{a.city}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ background: a.lead_days === 1 ? "#dbeafe" : a.lead_days === 2 ? "#fef3c7" : "#fee2e2", color: a.lead_days === 1 ? "#1d4ed8" : a.lead_days === 2 ? "#92400e" : "#991b1b", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
                        J-{a.lead_days}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: "#6b7280" }}>{a.n}</td>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: biasColor(a.bias) }}>
                      {a.bias > 0 ? "+" : ""}{a.bias}°C
                    </td>
                    <td style={{ padding: "10px 12px", color: "#374151" }}>{a.mae}°C</td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ background: "#e5e7eb", borderRadius: 4, height: 8, width: 80, overflow: "hidden" }}>
                          <div style={{ background: a.pct_within_1c >= 60 ? "#16a34a" : a.pct_within_1c >= 40 ? "#ca8a04" : "#dc2626", height: "100%", width: `${a.pct_within_1c}%` }} />
                        </div>
                        <span style={{ color: "#374151", minWidth: 36 }}>{a.pct_within_1c}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
          Mis à jour le {new Date(stats.updated_at).toLocaleString("fr-FR")} · Source: Wunderground + Open-Meteo GFS
        </p>
      </div>
    </div>
  );
}
