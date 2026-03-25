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

interface Signal {
  station: string;
  city: string;
  target_date: string;
  bracket_temp: number;
  bracket_op: string;
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

  useEffect(() => { loadSignals(); }, []);

  async function loadSignals() {
    setLoading(true);
    try {
      // 3 parallel queries instead of 150 sequential
      const [events, allBrackets, allEnsembles, allPrices] = await Promise.all([
        sb<{ event_id: string; station: string; city: string; target_date: string }[]>(
          "poly_events?closed=eq.false&select=event_id,station,city,target_date&order=target_date"
        ),
        sb<{ condition_id: string; bracket_temp: number; bracket_op: string; volume: number; poly_event_id: string }[]>(
          "poly_markets?resolved=eq.false&select=condition_id,bracket_temp,bracket_op,volume,poly_event_id&order=bracket_temp"
        ),
        sbAll<{ station: string; target_date: string; fetch_ts: string; temp_max: number | null }>(
          "ensemble_forecasts?select=station,target_date,fetch_ts,temp_max&order=fetch_ts.desc"
        ),
        sbAll<{ condition_id: string; ts: number; price_yes: number }>(
          "price_history?select=condition_id,ts,price_yes&order=ts.desc"
        ),
      ]);

      // Index prices: latest price per condition_id
      const priceMap: Record<string, number> = {};
      for (const p of allPrices) {
        if (!(p.condition_id in priceMap)) {
          priceMap[p.condition_id] = Math.round(p.price_yes * 100);
        }
      }

      // Index ensembles: group by station+target_date, keep only latest snapshot
      const ensMap: Record<string, { temp_max: number; fetch_ts: string }[]> = {};
      for (const e of allEnsembles) {
        if (e.temp_max == null) continue;
        const key = `${e.station}|${e.target_date}`;
        if (!ensMap[key]) ensMap[key] = [];
        ensMap[key].push({ temp_max: e.temp_max, fetch_ts: e.fetch_ts });
      }

      const today = new Date().toISOString().slice(0, 10);
      const todayD = new Date(today + "T00:00:00Z");
      const allSignals: Signal[] = [];

      for (const ev of events) {
        const key = `${ev.station}|${ev.target_date}`;
        const ensAll = ensMap[key];
        if (!ensAll || ensAll.length === 0) continue;

        // Latest snapshot only
        const latestTs = ensAll[0].fetch_ts;
        const members = ensAll.filter(e => e.fetch_ts === latestTs);
        if (members.length === 0) continue;
        const total = members.length;

        // Confidence
        const votes: Record<number, number> = {};
        for (const m of members) {
          const t = Math.round(m.temp_max);
          votes[t] = (votes[t] || 0) + 1;
        }
        const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
        const confidence = Math.round(((sorted[0]?.[1] ?? 0) + (sorted[1]?.[1] ?? 0)) / total * 100);

        // Horizon
        const targetD = new Date(ev.target_date + "T00:00:00Z");
        const horizon = Math.round((targetD.getTime() - todayD.getTime()) / 86400000);

        // Brackets for this event
        const evBrackets = allBrackets.filter(b => b.poly_event_id === ev.event_id);

        for (const b of evBrackets) {
          const matching = members.filter(m => {
            const t = Math.round(m.temp_max);
            if (b.bracket_op === "lte") return t <= b.bracket_temp;
            if (b.bracket_op === "gte") return t >= b.bracket_temp;
            if (b.bracket_op === "between") return t >= b.bracket_temp && t <= b.bracket_temp + 1;
            return t === b.bracket_temp;
          }).length;

          const ourProb = Math.round((matching / total) * 100);
          const marketPrice = priceMap[b.condition_id] ?? 0;
          const edge = ourProb - marketPrice;

          allSignals.push({
            station: ev.station,
            city: CITIES[ev.station]?.name || ev.station,
            target_date: ev.target_date,
            bracket_temp: b.bracket_temp,
            bracket_op: b.bracket_op,
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

  // Filter
  const filtered = signals
    .filter(s => Math.abs(s.edge) >= minEdge && s.confidence >= minConf)
    .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  // Group by event
  const eventGroups: Record<string, Signal[]> = {};
  for (const s of filtered) {
    const key = `${s.station}|${s.target_date}`;
    if (!eventGroups[key]) eventGroups[key] = [];
    eventGroups[key].push(s);
  }

  const buys = filtered.filter(s => s.edge > 0).length;
  const sells = filtered.filter(s => s.edge < 0).length;

  return (
    <div style={{ background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0" }}>
      <div style={{ padding: "20px 24px", borderBottom: "1px solid #1e293b" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Strategie</h1>
        <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
          {signals.length} brackets &middot; {filtered.length} signaux actifs
        </div>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1000, margin: "0 auto" }}>
        {/* Params + stats */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ background: "#111827", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>Edge</span>
            <select value={minEdge} onChange={e => setMinEdge(Number(e.target.value))}
              style={{ background: "#1e293b", border: "none", color: "#e2e8f0", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}>
              {[0, 5, 10, 15, 20, 30].map(v => <option key={v} value={v}>&ge;{v}%</option>)}
            </select>
          </div>
          <div style={{ background: "#111827", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>Confiance</span>
            <select value={minConf} onChange={e => setMinConf(Number(e.target.value))}
              style={{ background: "#1e293b", border: "none", color: "#e2e8f0", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}>
              {[0, 25, 50, 70, 80, 90].map(v => <option key={v} value={v}>&ge;{v}%</option>)}
            </select>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#4ade80", fontFamily: "monospace" }}>{buys}</div>
              <div style={{ fontSize: 10, color: "#475569" }}>BUY</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#f87171", fontFamily: "monospace" }}>{sells}</div>
              <div style={{ fontSize: 10, color: "#475569" }}>SELL</div>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>Chargement...</div>
        ) : Object.keys(eventGroups).length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#334155" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔍</div>
            <div>Aucun signal avec ces filtres</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Object.entries(eventGroups)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([key, sigs]) => {
                const first = sigs[0];
                const cityInfo = CITIES[first.station];
                const confColor = first.confidence >= 75 ? "#4ade80" : first.confidence >= 50 ? "#fbbf24" : "#f87171";

                return (
                  <div key={key} style={{ background: "#111827", borderRadius: 12, overflow: "hidden" }}>
                    {/* Event header */}
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>
                        {cityInfo?.flag} {first.city}
                      </span>
                      <span style={{ fontSize: 13, color: "#94a3b8" }}>
                        {new Date(first.target_date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                      </span>
                      <span style={{ fontSize: 11, color: "#334155" }}>J-{first.horizon}</span>
                      <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: confColor }}>
                        {first.confidence}% conf
                      </span>
                      <span style={{ fontSize: 11, color: "#475569" }}>{sigs.length} signaux</span>
                    </div>

                    {/* Signals */}
                    {sigs.map(s => {
                      const isBuy = s.edge > 0;
                      const absEdge = Math.abs(s.edge);
                      const edgeColor = absEdge >= 20 ? (isBuy ? "#4ade80" : "#f87171") : absEdge >= 10 ? (isBuy ? "#86efac" : "#fca5a5") : "#94a3b8";

                      return (
                        <div key={s.condition_id} style={{
                          padding: "10px 16px", borderBottom: "1px solid #0f172a",
                          display: "flex", alignItems: "center", gap: 12,
                        }}>
                          {/* Direction */}
                          <div style={{
                            width: 44, textAlign: "center",
                            background: isBuy ? "#052e16" : "#450a0a",
                            color: isBuy ? "#4ade80" : "#f87171",
                            padding: "3px 0", borderRadius: 6,
                            fontSize: 10, fontWeight: 800,
                          }}>
                            {isBuy ? "BUY" : "SELL"}
                          </div>

                          {/* Bracket */}
                          <div style={{ width: 60, fontSize: 14, fontWeight: 700 }}>
                            {bracketLabel(s.bracket_op, s.bracket_temp)}
                          </div>

                          {/* Bars */}
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                              <span style={{ width: 50, color: "#475569", textAlign: "right" }}>Nous</span>
                              <div style={{ flex: 1, height: 5, borderRadius: 3, background: "#1e293b" }}>
                                <div style={{ width: `${s.our_prob}%`, height: "100%", background: "#60a5fa", borderRadius: 3 }} />
                              </div>
                              <span style={{ width: 30, color: "#60a5fa", fontFamily: "monospace", fontWeight: 600 }}>{s.our_prob}%</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginTop: 3 }}>
                              <span style={{ width: 50, color: "#475569", textAlign: "right" }}>Poly</span>
                              <div style={{ flex: 1, height: 5, borderRadius: 3, background: "#1e293b" }}>
                                <div style={{ width: `${s.market_price}%`, height: "100%", background: "#f97316", borderRadius: 3 }} />
                              </div>
                              <span style={{ width: 30, color: "#f97316", fontFamily: "monospace", fontWeight: 600 }}>{s.market_price}%</span>
                            </div>
                          </div>

                          {/* Edge */}
                          <div style={{ textAlign: "center", minWidth: 55 }}>
                            <div style={{ fontSize: 16, fontWeight: 800, color: edgeColor, fontFamily: "monospace" }}>
                              {s.edge > 0 ? "+" : ""}{s.edge}%
                            </div>
                            <div style={{ fontSize: 9, color: "#475569" }}>edge</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
