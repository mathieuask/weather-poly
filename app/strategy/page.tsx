"use client";
import { useEffect, useState } from "react";

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function sb<T = any>(path: string): Promise<T> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) return [] as unknown as T;
  return r.json();
}

async function sbAll<T = any>(path: string): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const batch: T[] = await sb(`${path}${sep}limit=1000&offset=${offset}`);
    all.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return all;
}

interface Event {
  event_id: string;
  station: string;
  city: string;
  target_date: string;
  closed: boolean;
}

interface Bracket {
  condition_id: string;
  station: string;
  date: string;
  bracket_temp: number;
  bracket_op: string;
  bracket_str: string;
  volume: number;
}

interface PricePoint { ts: number; price_yes: number }

interface EnsembleMember {
  temp_max: number | null;
  fetch_ts: string;
  ensemble_model: string;
  member_id: number;
}

interface Signal {
  station: string;
  city: string;
  target_date: string;
  bracket_temp: number;
  bracket_op: string;
  bracket_str: string;
  condition_id: string;
  our_prob: number;
  market_price: number;
  edge: number;
  confidence: number;
  horizon: number;
  volume: number;
}

const CITIES: Record<string, { name: string; flag: string }> = {
  EGLC: { name: "London", flag: "\u{1F1EC}\u{1F1E7}" },
  KLGA: { name: "NYC", flag: "\u{1F1FA}\u{1F1F8}" },
  RKSI: { name: "Seoul", flag: "\u{1F1F0}\u{1F1F7}" },
};

function bracketLabel(op: string, temp: number) {
  if (op === "lte") return `\u2264${temp}\u00b0`;
  if (op === "gte") return `\u2265${temp}\u00b0`;
  if (op === "between") return `${temp}-${temp + 1}\u00b0`;
  return `${temp}\u00b0`;
}

export default function StrategyPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [minEdge, setMinEdge] = useState(10);
  const [minConf, setMinConf] = useState(50);

  useEffect(() => {
    loadSignals();
  }, []);

  async function loadSignals() {
    setLoading(true);
    try {
      // Get open events
      const events = await sb<Event[]>(
        "poly_events?closed=eq.false&select=event_id,station,city,target_date&order=target_date"
      );

      const allSignals: Signal[] = [];
      const today = new Date().toISOString().slice(0, 10);

      for (const ev of events) {
        // Get brackets for this event
        const brackets = await sb<Bracket[]>(
          `poly_markets?poly_event_id=eq.${ev.event_id}&select=condition_id,station,date,bracket_temp,bracket_op,bracket_str,volume&order=bracket_temp`
        );

        // Get latest price for each bracket
        const bracketPrices: Record<string, number> = {};
        for (const b of brackets) {
          const pts = await sb<PricePoint[]>(
            `price_history?condition_id=eq.${b.condition_id}&select=ts,price_yes&order=ts.desc&limit=1`
          );
          if (pts.length > 0) {
            bracketPrices[b.condition_id] = Math.round(pts[0].price_yes * 100);
          }
        }

        // Get ensemble data
        const ensembles = await sbAll<EnsembleMember>(
          `ensemble_forecasts?station=eq.${ev.station}&target_date=eq.${ev.target_date}&select=temp_max,fetch_ts,ensemble_model,member_id&order=fetch_ts.desc`
        );

        if (ensembles.length === 0) continue;

        // Use latest snapshot
        const latestTs = ensembles[0].fetch_ts;
        const members = ensembles.filter(e => e.fetch_ts === latestTs && e.temp_max != null);
        if (members.length === 0) continue;

        const total = members.length;

        // Confidence: top 2 brackets concentration
        const votes: Record<number, number> = {};
        for (const m of members) {
          const t = Math.round(m.temp_max!);
          votes[t] = (votes[t] || 0) + 1;
        }
        const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
        const top1 = sorted[0] ? sorted[0][1] : 0;
        const top2 = sorted[1] ? sorted[1][1] : 0;
        const confidence = Math.round(((top1 + top2) / total) * 100);

        // Horizon
        const targetD = new Date(ev.target_date + "T00:00:00Z");
        const todayD = new Date(today + "T00:00:00Z");
        const horizon = Math.round((targetD.getTime() - todayD.getTime()) / 86400000);

        // Compute probability per bracket
        for (const b of brackets) {
          const matching = members.filter(m => {
            const t = Math.round(m.temp_max!);
            if (b.bracket_op === "lte") return t <= b.bracket_temp;
            if (b.bracket_op === "gte") return t >= b.bracket_temp;
            if (b.bracket_op === "between") return t >= b.bracket_temp && t <= b.bracket_temp + 1;
            return t === b.bracket_temp;
          }).length;

          const ourProb = Math.round((matching / total) * 100);
          const marketPrice = bracketPrices[b.condition_id] ?? 0;
          const edge = ourProb - marketPrice;

          allSignals.push({
            station: ev.station,
            city: CITIES[ev.station]?.name || ev.station,
            target_date: ev.target_date,
            bracket_temp: b.bracket_temp,
            bracket_op: b.bracket_op,
            bracket_str: b.bracket_str,
            condition_id: b.condition_id,
            our_prob: ourProb,
            market_price: marketPrice,
            edge,
            confidence,
            horizon,
            volume: b.volume,
          });
        }
      }

      setSignals(allSignals);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  // Filter and sort
  const filtered = signals
    .filter(s => Math.abs(s.edge) >= minEdge && s.confidence >= minConf)
    .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  const buys = filtered.filter(s => s.edge > 0);
  const sells = filtered.filter(s => s.edge < 0);

  // Stats
  const avgEdge = filtered.length > 0 ? filtered.reduce((s, x) => s + Math.abs(x.edge), 0) / filtered.length : 0;
  const avgConf = filtered.length > 0 ? filtered.reduce((s, x) => s + x.confidence, 0) / filtered.length : 0;

  return (
    <div style={{ background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0" }}>
      {/* Header */}
      <div style={{ padding: "20px 24px", borderBottom: "1px solid #1e293b" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Strategie</h1>
        <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
          Signaux actifs depuis 143 membres ensemble &middot; {signals.length} brackets analyses
        </div>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1000, margin: "0 auto" }}>
        {/* Params */}
        <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ background: "#111827", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>Edge min</span>
            <select value={minEdge} onChange={e => setMinEdge(Number(e.target.value))}
              style={{ background: "#1e293b", border: "none", color: "#e2e8f0", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}>
              {[0, 5, 10, 15, 20, 30].map(v => <option key={v} value={v}>{v}%</option>)}
            </select>
          </div>
          <div style={{ background: "#111827", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>Confiance min</span>
            <select value={minConf} onChange={e => setMinConf(Number(e.target.value))}
              style={{ background: "#1e293b", border: "none", color: "#e2e8f0", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}>
              {[0, 25, 50, 70, 80, 90].map(v => <option key={v} value={v}>{v}%</option>)}
            </select>
          </div>
          <div style={{ background: "#111827", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#4ade80" }}>{buys.length}</div>
              <div style={{ fontSize: 10, color: "#475569" }}>BUY</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#f87171" }}>{sells.length}</div>
              <div style={{ fontSize: 10, color: "#475569" }}>SELL</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#60a5fa" }}>{avgEdge.toFixed(0)}%</div>
              <div style={{ fontSize: 10, color: "#475569" }}>Edge moy</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fbbf24" }}>{avgConf.toFixed(0)}%</div>
              <div style={{ fontSize: 10, color: "#475569" }}>Conf moy</div>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>Analyse en cours...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#334155" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔍</div>
            <div>Aucun signal avec ces filtres</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Baisse le seuil d&apos;edge ou de confiance</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(s => {
              const isBuy = s.edge > 0;
              const edgeColor = Math.abs(s.edge) >= 20 ? (isBuy ? "#4ade80" : "#f87171") : Math.abs(s.edge) >= 10 ? (isBuy ? "#86efac" : "#fca5a5") : "#94a3b8";
              const confColor = s.confidence >= 75 ? "#4ade80" : s.confidence >= 50 ? "#fbbf24" : "#f87171";
              const cityInfo = CITIES[s.station];

              return (
                <div key={s.condition_id} style={{
                  background: "#111827", borderRadius: 12, padding: "14px 16px",
                  borderLeft: `4px solid ${isBuy ? "#4ade80" : "#f87171"}`,
                  display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
                }}>
                  {/* City + date */}
                  <div style={{ minWidth: 120 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {cityInfo?.flag} {s.city}
                    </div>
                    <div style={{ fontSize: 11, color: "#475569" }}>
                      {new Date(s.target_date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                      <span style={{ marginLeft: 6, color: "#334155" }}>J-{s.horizon}</span>
                    </div>
                  </div>

                  {/* Bracket */}
                  <div style={{ minWidth: 70, textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{bracketLabel(s.bracket_op, s.bracket_temp)}</div>
                    <div style={{ fontSize: 10, color: "#475569" }}>${Math.round(s.volume).toLocaleString()}</div>
                  </div>

                  {/* Our prob vs market */}
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#475569", marginBottom: 4 }}>
                      <span>Modeles {s.our_prob}%</span>
                      <span>Marche {s.market_price}%</span>
                    </div>
                    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "#1e293b" }}>
                      <div style={{ width: `${s.our_prob}%`, background: "#60a5fa", borderRadius: 3 }} />
                    </div>
                    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "#1e293b", marginTop: 2 }}>
                      <div style={{ width: `${s.market_price}%`, background: "#f97316", borderRadius: 3 }} />
                    </div>
                  </div>

                  {/* Edge */}
                  <div style={{ textAlign: "center", minWidth: 60 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: edgeColor, fontFamily: "monospace" }}>
                      {s.edge > 0 ? "+" : ""}{s.edge}%
                    </div>
                    <div style={{ fontSize: 10, color: "#475569" }}>edge</div>
                  </div>

                  {/* Confidence */}
                  <div style={{ textAlign: "center", minWidth: 50 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: confColor, fontFamily: "monospace" }}>
                      {s.confidence}%
                    </div>
                    <div style={{ fontSize: 10, color: "#475569" }}>conf</div>
                  </div>

                  {/* Action */}
                  <div style={{
                    background: isBuy ? "#052e16" : "#450a0a",
                    color: isBuy ? "#4ade80" : "#f87171",
                    padding: "6px 14px", borderRadius: 8,
                    fontSize: 12, fontWeight: 800,
                  }}>
                    {isBuy ? "BUY" : "SELL"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
