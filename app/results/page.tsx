"use client";
import { useEffect, useState } from "react";
import { useCities, type City } from "../lib/useCities";

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function sb<T = any>(path: string): Promise<T> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) return [] as unknown as T;
  return r.json();
}

interface ResolvedEvent {
  event_id: string;
  station: string;
  city: string;
  target_date: string;
}

interface ResolvedBracket {
  condition_id: string;
  bracket_temp: number;
  bracket_op: string;
  bracket_str: string;
  winner: string | null;
  volume: number;
  poly_event_id: string;
}

interface DailyTemp {
  station: string;
  date: string;
  temp_max_c: number | null;
  temp_max_f: number | null;
}

interface Forecast {
  model: string;
  horizon: number;
  temp_max: number | null;
  temp_max_f: number | null;
}

interface PastTrade {
  city: string;
  station: string;
  target_date: string;
  bracket_str: string;
  bracket_temp: number;
  bracket_op: string;
  our_prob: number;
  market_price: number;
  edge: number;
  direction: "BUY" | "SELL";
  winner: string | null;
  outcome: "win" | "loss" | "skip";
  pnl: number;
  actual_temp: number | null;
}

function bracketLabel(op: string, temp: number) {
  if (op === "lte") return `\u2264${temp}\u00b0`;
  if (op === "gte") return `\u2265${temp}\u00b0`;
  if (op === "between") return `${temp}-${temp + 1}\u00b0`;
  return `${temp}\u00b0`;
}

export default function ResultsPage() {
  const citiesList = useCities();
  const cityMap: Record<string, City> = {};
  for (const c of citiesList) cityMap[c.station] = c;

  const [trades, setTrades] = useState<PastTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [cityFilter, setCityFilter] = useState("ALL");
  const [minEdge, setMinEdge] = useState(10);

  useEffect(() => {
    loadResults();
  }, []);

  async function loadResults() {
    setLoading(true);
    try {
      // Get resolved events
      const events = await sb<ResolvedEvent[]>(
        "poly_events?closed=eq.true&select=event_id,station,city,target_date&order=target_date.desc&limit=200"
      );

      // Get all resolved brackets
      const brackets = await sb<ResolvedBracket[]>(
        "poly_markets?resolved=eq.true&select=condition_id,bracket_temp,bracket_op,bracket_str,winner,volume,poly_event_id&order=bracket_temp"
      );

      // Get actuals
      const temps = await sb<DailyTemp[]>(
        "daily_temps?select=station,date,temp_max_c,temp_max_f&order=date.desc&limit=1000"
      );
      const tempMap: Record<string, DailyTemp> = {};
      for (const t of temps) tempMap[`${t.station}|${t.date}`] = t;

      // Get deterministic forecasts for simulation
      const forecasts = await sb<(Forecast & { station: string; target_date: string })[]>(
        "gfs_forecasts?horizon=eq.1&select=station,target_date,model,horizon,temp_max,temp_max_f&order=target_date.desc&limit=5000"
      );

      // Group forecasts by station+date
      const fcMap: Record<string, (Forecast & { station: string })[]> = {};
      for (const f of forecasts) {
        const key = `${f.station}|${f.target_date}`;
        if (!fcMap[key]) fcMap[key] = [];
        fcMap[key].push(f);
      }

      // Simulate trades
      const allTrades: PastTrade[] = [];

      for (const ev of events) {
        const evBrackets = brackets.filter(b => b.poly_event_id === ev.event_id);
        const actual = tempMap[`${ev.station}|${ev.target_date}`];
        const fcs = fcMap[`${ev.station}|${ev.target_date}`] || [];

        if (fcs.length === 0) continue;

        // Simulate ensemble-like probability from deterministic models
        const totalModels = fcs.length;
        const isF = ev.station === "KLGA";

        for (const b of evBrackets) {
          // Count how many models predict this bracket
          const matching = fcs.filter(f => {
            const t = Math.round(isF && f.temp_max_f != null ? f.temp_max_f : f.temp_max ?? 0);
            if (b.bracket_op === "lte") return t <= b.bracket_temp;
            if (b.bracket_op === "gte") return t >= b.bracket_temp;
            if (b.bracket_op === "between") return t >= b.bracket_temp && t <= b.bracket_temp + 1;
            return t === b.bracket_temp;
          }).length;

          const ourProb = Math.round((matching / totalModels) * 100);

          // Market price: we don't have the exact J-1 price easily
          // Use winner as proxy: if winner=YES, market ended at ~100%
          // For simulation, estimate market at 1/n_brackets (uniform prior)
          const nBrackets = evBrackets.length;
          const marketPrice = Math.round(100 / nBrackets);

          const edge = ourProb - marketPrice;
          const isBuy = edge > 0;
          const direction = isBuy ? "BUY" as const : "SELL" as const;

          // Outcome
          const won = (isBuy && b.winner === "YES") || (!isBuy && b.winner === "NO");
          const actualTemp = actual ? (isF ? actual.temp_max_f : actual.temp_max_c) : null;

          // PnL simulation: $10 per trade
          const betAmount = 10;
          let pnl = 0;
          if (isBuy && b.winner === "YES") {
            pnl = betAmount * (100 / Math.max(ourProb, 1)) - betAmount; // simplified
          } else if (isBuy && b.winner !== "YES") {
            pnl = -betAmount;
          } else if (!isBuy && b.winner === "NO") {
            pnl = betAmount * 0.5; // simplified sell profit
          } else {
            pnl = -betAmount;
          }

          allTrades.push({
            city: ev.city || cityMap[ev.station]?.name || ev.station,
            station: ev.station,
            target_date: ev.target_date,
            bracket_str: b.bracket_str,
            bracket_temp: b.bracket_temp,
            bracket_op: b.bracket_op,
            our_prob: ourProb,
            market_price: marketPrice,
            edge,
            direction,
            winner: b.winner,
            outcome: Math.abs(edge) < minEdge ? "skip" : won ? "win" : "loss",
            pnl: Math.abs(edge) < minEdge ? 0 : pnl,
            actual_temp: actualTemp,
          });
        }
      }

      setTrades(allTrades);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  // Apply filters
  const filtered = trades
    .filter(t => t.outcome !== "skip")
    .filter(t => Math.abs(t.edge) >= minEdge)
    .filter(t => cityFilter === "ALL" || t.city === cityFilter);

  const wins = filtered.filter(t => t.outcome === "win").length;
  const losses = filtered.filter(t => t.outcome === "loss").length;
  const totalPnl = filtered.reduce((s, t) => s + t.pnl, 0);
  const winRate = filtered.length > 0 ? Math.round((wins / filtered.length) * 100) : 0;

  // Per city stats
  const cities = [...new Set(trades.map(t => t.city))].sort();
  const cityStats = cities.map(city => {
    const ct = filtered.filter(t => t.city === city);
    const cw = ct.filter(t => t.outcome === "win").length;
    return {
      city,
      trades: ct.length,
      wins: cw,
      losses: ct.length - cw,
      winRate: ct.length > 0 ? Math.round((cw / ct.length) * 100) : 0,
      pnl: ct.reduce((s, t) => s + t.pnl, 0),
    };
  });

  return (
    <div style={{ background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0" }}>
      {/* Header */}
      <div style={{ padding: "20px 24px", borderBottom: "1px solid #1e293b" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Resultats</h1>
        <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
          Simulation sur les events resolus &middot; $10/trade &middot; Edge min {minEdge}%
        </div>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1000, margin: "0 auto" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>Chargement...</div>
        ) : (
          <>
            {/* Stats globales */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 20 }}>
              {[
                { label: "Trades", value: filtered.length, color: "#e2e8f0" },
                { label: "Wins", value: wins, color: "#4ade80" },
                { label: "Losses", value: losses, color: "#f87171" },
                { label: "Win Rate", value: `${winRate}%`, color: winRate >= 55 ? "#4ade80" : winRate >= 50 ? "#fbbf24" : "#f87171" },
                { label: "P&L", value: `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(0)}`, color: totalPnl >= 0 ? "#4ade80" : "#f87171" },
              ].map(s => (
                <div key={s.label} style={{ background: "#111827", borderRadius: 10, padding: "14px 12px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <div style={{ background: "#111827", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Edge min</span>
                <select value={minEdge} onChange={e => setMinEdge(Number(e.target.value))}
                  style={{ background: "#1e293b", border: "none", color: "#e2e8f0", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}>
                  {[0, 5, 10, 15, 20, 30].map(v => <option key={v} value={v}>{v}%</option>)}
                </select>
              </div>
              <div style={{ background: "#111827", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Ville</span>
                <select value={cityFilter} onChange={e => setCityFilter(e.target.value)}
                  style={{ background: "#1e293b", border: "none", color: "#e2e8f0", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}>
                  <option value="ALL">Toutes</option>
                  {cities.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Per city */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8, marginBottom: 20 }}>
              {cityStats.map(c => (
                <div key={c.city} style={{ background: "#111827", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{c.city}</div>
                  <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: c.winRate >= 55 ? "#4ade80" : c.winRate >= 50 ? "#fbbf24" : "#f87171", fontFamily: "monospace" }}>
                        {c.winRate}%
                      </div>
                      <div style={{ fontSize: 9, color: "#475569" }}>WR ({c.trades})</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: c.pnl >= 0 ? "#4ade80" : "#f87171", fontFamily: "monospace" }}>
                        {c.pnl >= 0 ? "+" : ""}${c.pnl.toFixed(0)}
                      </div>
                      <div style={{ fontSize: 9, color: "#475569" }}>P&L</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Trades list */}
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>
              Derniers trades ({filtered.length})
            </h3>
            <div style={{ background: "#111827", borderRadius: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "monospace", minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b" }}>
                    {["Date", "Ville", "Bracket", "Notre %", "Marche %", "Edge", "Dir", "Resultat", "P&L"].map(h => (
                      <th key={h} style={{ padding: "10px 8px", textAlign: "left", color: "#475569", fontWeight: 600, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 100).map((t, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #0f172a" }}>
                      <td style={{ padding: "8px", color: "#94a3b8" }}>{t.target_date}</td>
                      <td style={{ padding: "8px" }}>{t.city}</td>
                      <td style={{ padding: "8px", fontWeight: 700 }}>{bracketLabel(t.bracket_op, t.bracket_temp)}</td>
                      <td style={{ padding: "8px", color: "#60a5fa" }}>{t.our_prob}%</td>
                      <td style={{ padding: "8px", color: "#f97316" }}>{t.market_price}%</td>
                      <td style={{ padding: "8px", fontWeight: 700, color: t.edge > 0 ? "#4ade80" : "#f87171" }}>
                        {t.edge > 0 ? "+" : ""}{t.edge}%
                      </td>
                      <td style={{ padding: "8px" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                          background: t.direction === "BUY" ? "#052e16" : "#450a0a",
                          color: t.direction === "BUY" ? "#4ade80" : "#f87171",
                        }}>
                          {t.direction}
                        </span>
                      </td>
                      <td style={{ padding: "8px" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                          background: t.outcome === "win" ? "#052e16" : "#450a0a",
                          color: t.outcome === "win" ? "#4ade80" : "#f87171",
                        }}>
                          {t.outcome === "win" ? "WIN" : "LOSS"}
                        </span>
                      </td>
                      <td style={{ padding: "8px", fontWeight: 700, color: t.pnl >= 0 ? "#4ade80" : "#f87171" }}>
                        {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
