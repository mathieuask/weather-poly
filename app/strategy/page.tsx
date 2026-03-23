"use client";
import { useEffect, useState } from "react";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface BestStrategy {
  updated_at: string; status: string; message?: string; n_markets?: number;
  best_strategy?: {
    lead_days: number; min_edge: number; bracket_type: string; direction: string;
    min_liquidity: number; win_rate: number; pnl_per_100: number; sharpe: number;
    n_trades: number; confidence: string; max_drawdown: number;
  };
  by_city?: Record<string, { win_rate: number; n: number; best_lead: number; bias: number }>;
  horizon_analysis?: Record<string, { win_rate: number; n: number; pnl: number }>;
  all_strategies?: Array<{
    id: number; lead_days: number; min_edge: number; bracket_type: string;
    direction: string; min_liquidity: number; win_rate: number; pnl_total: number;
    sharpe: number; n_trades: number; max_drawdown: number;
  }>;
}

export default function StrategyPage() {
  const [data, setData] = useState<BestStrategy | null>(null);
  const [sortBy, setSortBy] = useState<"sharpe" | "win_rate" | "pnl_total">("sharpe");

  useEffect(() => {
    // Primary: fetch from Supabase kv_cache
    if (SB_URL && SB_KEY) {
      fetch(`${SB_URL}/rest/v1/kv_cache?key=eq.backtest_output&select=value`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      })
        .then(r => r.json())
        .then((rows: Array<{ value: BestStrategy }>) => {
          if (rows.length > 0 && rows[0].value) {
            setData(rows[0].value);
          }
        })
        .catch(() => {
          // No fallback — V2 clean state
        });
    } else {
      // No Supabase configured — show empty state
    }
  }, []);

  const pending = !data || data.status === "pending";

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", padding: "24px 16px" }}>
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0 }}>🧠 Strategy Arena</h1>
          <p style={{ color: "#6b7280", marginTop: 4, fontSize: 14 }}>
            Backtest automatique · Optimisation en continu
          </p>
        </div>

        {pending ? (
          /* État en attente */
          <div style={{ background: "#fff", borderRadius: 16, padding: 40, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚙️</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>Aucune donnée</h2>
            <p style={{ color: "#6b7280", marginTop: 8, maxWidth: 400, margin: "8px auto 0" }}>
              {data?.message || "V2 en cours de construction. Les résultats de backtest seront disponibles après la collecte et l'analyse des données."}
            </p>
            <div style={{ marginTop: 24, background: "#f3f4f6", borderRadius: 12, padding: 20, display: "inline-block", textAlign: "left" }}>
              <div style={{ fontSize: 13, color: "#374151", fontFamily: "monospace" }}>
                <div>✅ {data?.n_markets?.toLocaleString() || "—"} marchés chargés</div>
                <div>✅ Températures WU collectées</div>
                <div>✅ Prévisions GFS J-0/J-1/J-2/J-3</div>
                <div style={{ color: "#ca8a04" }}>⏳ backtest.py — en cours…</div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Meilleure stratégie */}
            {data?.best_strategy && (
              <div style={{ background: "linear-gradient(135deg, #1d4ed8, #7c3aed)", borderRadius: 16, padding: 28, color: "#fff", marginBottom: 24, boxShadow: "0 4px 20px rgba(29,78,216,0.3)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>🏆 STRATÉGIE OPTIMALE ACTUELLE</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>
                      {(data.best_strategy.win_rate * 100).toFixed(1)}% WR · +${data.best_strategy.pnl_per_100?.toFixed(0)}/100 trades
                    </div>
                    <div style={{ marginTop: 8, fontSize: 14, opacity: 0.9 }}>
                      Sharpe {data.best_strategy.sharpe?.toFixed(2)} · {data.best_strategy.n_trades} trades · Max DD ${Math.abs(data.best_strategy.max_drawdown || 0).toFixed(0)}
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "12px 20px", fontSize: 13 }}>
                    <div>⏱ Horizon : <strong>J-{data.best_strategy.lead_days}</strong></div>
                    <div>📐 Edge min : <strong>{data.best_strategy.min_edge}%</strong></div>
                    <div>🎯 Type : <strong>{data.best_strategy.bracket_type}</strong></div>
                    <div>💧 Liq min : <strong>${data.best_strategy.min_liquidity}</strong></div>
                    <div>↕️ Direction : <strong>{data.best_strategy.direction}</strong></div>
                  </div>
                </div>
              </div>
            )}

            {/* Analyse par horizon */}
            {data?.horizon_analysis && (
              <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: "0 0 16px" }}>📅 Win rate par horizon temporel</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                  {Object.entries(data.horizon_analysis).sort().map(([h, v]) => (
                    <div key={h} style={{ background: "#f9fafb", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: v.win_rate >= 0.55 ? "#16a34a" : v.win_rate >= 0.5 ? "#ca8a04" : "#dc2626" }}>
                        {(v.win_rate * 100).toFixed(1)}%
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{h}</div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>{v.n} trades</div>
                      <div style={{ fontSize: 12, color: v.pnl >= 0 ? "#16a34a" : "#dc2626" }}>{v.pnl >= 0 ? "+" : ""}{v.pnl?.toFixed(0)}$</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Win rate par ville */}
            {data?.by_city && (
              <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: "0 0 16px" }}>🌍 Performance par ville</h2>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                        {["Ville", "WR", "N trades", "Meilleur horizon", "Biais GFS"].map(h => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(data.by_city).sort((a, b) => b[1].win_rate - a[1].win_rate).map(([city, v], i) => (
                        <tr key={city} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600, color: "#111827" }}>{city}</td>
                          <td style={{ padding: "10px 12px", fontWeight: 700, color: v.win_rate >= 0.55 ? "#16a34a" : v.win_rate >= 0.5 ? "#ca8a04" : "#dc2626" }}>
                            {(v.win_rate * 100).toFixed(1)}%
                          </td>
                          <td style={{ padding: "10px 12px", color: "#6b7280" }}>{v.n}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <span style={{ background: "#dbeafe", color: "#1d4ed8", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
                              J-{v.best_lead}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px", color: Math.abs(v.bias) <= 1 ? "#16a34a" : "#dc2626" }}>
                            {v.bias > 0 ? "+" : ""}{v.bias?.toFixed(1)}°C
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Toutes les stratégies */}
            {data?.all_strategies && data.all_strategies.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: 0 }}>
                    🔬 Toutes les stratégies testées ({data.all_strategies.length})
                  </h2>
                  <div style={{ display: "flex", gap: 8 }}>
                    {(["sharpe", "win_rate", "pnl_total"] as const).map(s => (
                      <button key={s} onClick={() => setSortBy(s)} style={{
                        padding: "5px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12, fontWeight: 600, cursor: "pointer",
                        background: sortBy === s ? "#2563eb" : "#f9fafb", color: sortBy === s ? "#fff" : "#374151"
                      }}>
                        {s === "sharpe" ? "Sharpe" : s === "win_rate" ? "WR" : "PnL"}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                        {["#", "Horizon", "Edge min", "Type", "Direction", "Liq", "WR", "PnL/100", "Sharpe", "N"].map(h => (
                          <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.all_strategies]
                        .sort((a, b) => (b[sortBy] as number) - (a[sortBy] as number))
                        .slice(0, 50)
                        .map((s, i) => (
                          <tr key={s.id} style={{ borderBottom: "1px solid #f3f4f6", background: i === 0 ? "#f0fdf4" : i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                            <td style={{ padding: "8px 10px", color: "#6b7280" }}>{i === 0 ? "🏆" : i + 1}</td>
                            <td style={{ padding: "8px 10px" }}><span style={{ background: "#dbeafe", color: "#1d4ed8", padding: "1px 6px", borderRadius: 8, fontWeight: 600 }}>J-{s.lead_days}</span></td>
                            <td style={{ padding: "8px 10px" }}>{s.min_edge}%</td>
                            <td style={{ padding: "8px 10px" }}>{s.bracket_type}</td>
                            <td style={{ padding: "8px 10px" }}>{s.direction}</td>
                            <td style={{ padding: "8px 10px" }}>${s.min_liquidity}</td>
                            <td style={{ padding: "8px 10px", fontWeight: 700, color: s.win_rate >= 0.55 ? "#16a34a" : s.win_rate >= 0.5 ? "#ca8a04" : "#dc2626" }}>
                              {(s.win_rate * 100).toFixed(1)}%
                            </td>
                            <td style={{ padding: "8px 10px", color: s.pnl_total >= 0 ? "#16a34a" : "#dc2626" }}>{s.pnl_total >= 0 ? "+" : ""}{s.pnl_total?.toFixed(0)}$</td>
                            <td style={{ padding: "8px 10px", fontWeight: 600 }}>{s.sharpe?.toFixed(2)}</td>
                            <td style={{ padding: "8px 10px", color: "#6b7280" }}>{s.n_trades}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, marginTop: 24 }}>
          {data && `Mis à jour : ${new Date(data.updated_at).toLocaleString("fr-FR")}`}
        </p>
      </div>
    </div>
  );
}
