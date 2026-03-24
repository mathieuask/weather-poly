"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

/* ─── Config ─────────────────────────────────────────────── */

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const CITIES = [
  { name: "London", station: "EGLC", flag: "\u{1F1EC}\u{1F1E7}", accent: "#60a5fa" },
  { name: "NYC", station: "KLGA", flag: "\u{1F1FA}\u{1F1F8}", accent: "#f87171" },
  { name: "Seoul", station: "RKSI", flag: "\u{1F1F0}\u{1F1F7}", accent: "#34d399" },
];

const COLORS = [
  "#818cf8", "#a78bfa", "#c084fc", "#e879f9", "#f472b6",
  "#fb7185", "#f97316", "#fbbf24", "#a3e635", "#34d399", "#22d3ee",
];

const PAGE_SIZE = 30;

/* ─── Supabase helper ────────────────────────────────────── */

async function sb<T = any>(path: string): Promise<T> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/* ─── Types ──────────────────────────────────────────────── */

interface Event {
  event_id: string;
  city: string;
  station: string;
  target_date: string;
  closed: boolean;
  n_brackets: number;
  total_volume: number;
  created_at: string;
}

interface Bracket {
  condition_id: string;
  bracket_temp: number;
  bracket_op: string;
  bracket_str: string;
  winner: string | null;
  volume: number;
}

interface PricePoint { ts: number; price_yes: number }

/* ─── Helpers ────────────────────────────────────────────── */

function fmtDate(d: string) {
  const dt = new Date(d + "T12:00:00Z");
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function fmtHour(ts: number) {
  const d = new Date(ts * 1000);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
}

function bracketLabel(b: Bracket) {
  const t = b.bracket_temp;
  if (b.bracket_op === "lte") return `\u2264${t}\u00b0`;
  if (b.bracket_op === "gte") return `\u2265${t}\u00b0`;
  return `${t}\u00b0`;
}

/* ─── Downsample ─────────────────────────────────────────── */

function downsample(pts: PricePoint[], max: number): PricePoint[] {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  const out: PricePoint[] = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

/* ─── Tooltip (stable ref — outside component to avoid re-render flicker) ── */

function ChartTooltip({ active, payload, label, brackets }: any) {
  if (!active || !payload) return null;
  return (
    <div style={{ background: "#1a1a2e", border: "1px solid #2a2a4a", borderRadius: 8, padding: "10px 14px", fontSize: 12, pointerEvents: "none" }}>
      <div style={{ color: "#94a3b8", marginBottom: 6, fontFamily: "monospace" }}>{label}</div>
      {payload
        .filter((p: any) => p.value != null)
        .sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0))
        .map((p: any) => {
          const b = (brackets as Bracket[]).find(br => br.condition_id === p.dataKey);
          return (
            <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 16, color: p.color }}>
              <span>{b ? bracketLabel(b) : "?"}</span>
              <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{p.value}%</span>
            </div>
          );
        })}
    </div>
  );
}

/* ─── Component ──────────────────────────────────────────── */

export default function DataPage() {
  const [city, setCity] = useState(CITIES[0]);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [page, setPage] = useState(0);

  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [prices, setPrices] = useState<Record<string, PricePoint[]>>({});
  const [tempC, setTempC] = useState<number | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  /* ── Load events for city ── */
  const loadEvents = useCallback(async (station: string) => {
    setEventsLoading(true);
    try {
      const data = await sb<Event[]>(
        `poly_events?station=eq.${station}&select=event_id,city,station,target_date,closed,n_brackets,total_volume,created_at&order=target_date.desc&limit=1000`
      );
      setEvents(data);
    } catch (e) { console.error(e); }
    setEventsLoading(false);
  }, []);

  useEffect(() => { loadEvents(city.station); }, [city.station, loadEvents]);

  /* ── Load event detail ── */
  const loadEvent = useCallback(async (ev: Event) => {
    setSelectedEvent(ev);
    setChartLoading(true);
    setBrackets([]);
    setPrices({});
    setTempC(null);

    try {
      const [brk, tmp] = await Promise.all([
        sb<Bracket[]>(
          `poly_markets?poly_event_id=eq.${ev.event_id}&select=condition_id,bracket_temp,bracket_op,bracket_str,winner,volume&order=bracket_temp`
        ),
        sb<{ temp_max_c: number }[]>(
          `daily_temps?station=eq.${ev.station}&date=eq.${ev.target_date}&select=temp_max_c&limit=1`
        ),
      ]);

      setBrackets(brk);
      if (tmp.length > 0) setTempC(tmp[0].temp_max_c);

      // Fetch prices for all brackets in parallel
      const priceResults = await Promise.all(
        brk.map(b =>
          sb<PricePoint[]>(
            `price_history?condition_id=eq.${b.condition_id}&select=ts,price_yes&order=ts&limit=2000`
          ).then(pts => [b.condition_id, pts] as const)
        )
      );

      const priceMap: Record<string, PricePoint[]> = {};
      for (const [cid, pts] of priceResults) priceMap[cid] = pts;
      setPrices(priceMap);
    } catch (e) { console.error(e); }
    setChartLoading(false);
  }, []);

  /* ── Build chart data ── */
  const chartData = useMemo(() => {
    if (brackets.length === 0 || Object.keys(prices).length === 0) return [];

    // Collect all timestamps, then sample to max 400
    const allTs = new Set<number>();
    for (const pts of Object.values(prices)) {
      for (const p of pts) allTs.add(p.ts);
    }
    const sortedTs = [...allTs].sort((a, b) => a - b);
    const sampled = downsample(
      sortedTs.map(ts => ({ ts, price_yes: 0 })),
      400
    ).map(p => p.ts);

    // For each sampled timestamp, find closest price for each bracket
    return sampled.map(ts => {
      const row: Record<string, any> = { ts, time: fmtHour(ts) };
      for (const b of brackets) {
        const pts = prices[b.condition_id];
        if (!pts || pts.length === 0) { row[b.condition_id] = null; continue; }
        // Binary search for closest
        let lo = 0, hi = pts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (pts[mid].ts < ts) lo = mid + 1; else hi = mid;
        }
        // Check neighbors
        const best =
          lo > 0 && Math.abs(pts[lo - 1].ts - ts) < Math.abs(pts[lo].ts - ts)
            ? pts[lo - 1]
            : pts[lo];
        row[b.condition_id] = Math.round(best.price_yes * 100);
      }
      return row;
    });
  }, [brackets, prices]);

  /* ── Pagination ── */
  const pagedEvents = events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(events.length / PAGE_SIZE);

  /* ── Tooltip wrapper (passes brackets as prop) ── */
  const renderTooltip = useCallback(
    (props: any) => <ChartTooltip {...props} brackets={brackets} />,
    [brackets]
  );

  /* ─── RENDER ───────────────────────────────────────────── */

  return (
    <div style={{ background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0" }}>

      {/* ── City tabs ── */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1e293b" }}>
        {CITIES.map(c => (
          <button
            key={c.station}
            onClick={() => { setCity(c); setSelectedEvent(null); setPage(0); }}
            style={{
              flex: 1,
              padding: "14px 0",
              background: city.station === c.station ? "#1e293b" : "transparent",
              color: city.station === c.station ? c.accent : "#64748b",
              border: "none",
              borderBottom: city.station === c.station ? `2px solid ${c.accent}` : "2px solid transparent",
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 600,
              transition: "all 0.15s",
            }}
          >
            {c.flag} {c.name}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", minHeight: "calc(100vh - 100px)" }}>

        {/* ── Date list (left) ── */}
        <div style={{
          width: 260, minWidth: 260, borderRight: "1px solid #1e293b",
          overflowY: "auto", flexShrink: 0,
        }}
          className="hidden md:block"
        >
          {eventsLoading ? (
            <div style={{ padding: 24, color: "#475569", textAlign: "center" }}>Loading...</div>
          ) : (
            <>
              <div style={{ padding: "12px 16px", fontSize: 12, color: "#475569", borderBottom: "1px solid #1e293b" }}>
                {events.length} events &middot; page {page + 1}/{totalPages}
              </div>
              {pagedEvents.map(ev => {
                const active = selectedEvent?.event_id === ev.event_id;
                return (
                  <button
                    key={ev.event_id}
                    onClick={() => loadEvent(ev)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 16px",
                      background: active ? "#1e293b" : "transparent",
                      border: "none",
                      borderBottom: "1px solid #0f172a",
                      borderLeft: active ? `3px solid ${city.accent}` : "3px solid transparent",
                      color: active ? "#f1f5f9" : "#94a3b8",
                      cursor: "pointer",
                      transition: "all 0.1s",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(ev.target_date)}</div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                      {ev.n_brackets} brackets &middot; ${Math.round(ev.total_volume).toLocaleString()}
                      {!ev.closed && <span style={{ color: "#22d3ee", marginLeft: 6 }}>OPEN</span>}
                    </div>
                  </button>
                );
              })}
              {/* Pagination */}
              <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: 12 }}>
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  style={{ padding: "4px 12px", background: "#1e293b", border: "none", borderRadius: 6, color: page === 0 ? "#334155" : "#94a3b8", cursor: page === 0 ? "default" : "pointer", fontSize: 13 }}
                >&larr;</button>
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}
                  style={{ padding: "4px 12px", background: "#1e293b", border: "none", borderRadius: 6, color: page >= totalPages - 1 ? "#334155" : "#94a3b8", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: 13 }}
                >&rarr;</button>
              </div>
            </>
          )}
        </div>

        {/* ── Mobile date selector ── */}
        <div className="block md:hidden" style={{ width: "100%" }}>
          {!selectedEvent && (
            <div style={{ padding: 8 }}>
              <div style={{ fontSize: 12, color: "#475569", padding: "8px 8px 4px" }}>
                {events.length} events &middot; page {page + 1}/{totalPages}
              </div>
              {pagedEvents.map(ev => (
                <button
                  key={ev.event_id}
                  onClick={() => loadEvent(ev)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
                    background: "transparent", border: "none", borderBottom: "1px solid #1e293b",
                    color: "#94a3b8", cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{fmtDate(ev.target_date)}</div>
                  <div style={{ fontSize: 12, color: "#475569" }}>
                    {ev.n_brackets} brackets &middot; ${Math.round(ev.total_volume).toLocaleString()}
                  </div>
                </button>
              ))}
              <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: 12 }}>
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                  style={{ padding: "6px 16px", background: "#1e293b", border: "none", borderRadius: 6, color: page === 0 ? "#334155" : "#94a3b8", cursor: page === 0 ? "default" : "pointer" }}>&larr;</button>
                <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                  style={{ padding: "6px 16px", background: "#1e293b", border: "none", borderRadius: 6, color: page >= totalPages - 1 ? "#334155" : "#94a3b8", cursor: page >= totalPages - 1 ? "default" : "pointer" }}>&rarr;</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Main content ── */}
        <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}
          className={!selectedEvent ? "hidden md:block" : ""}
        >
          {!selectedEvent ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#334155" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>📊</div>
                <div style={{ fontSize: 15 }}>Select an event from the list</div>
              </div>
            </div>
          ) : chartLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "#475569" }}>
              Loading chart data...
            </div>
          ) : (
            <>
              {/* Mobile back button */}
              <button
                onClick={() => setSelectedEvent(null)}
                className="block md:hidden"
                style={{ background: "none", border: "none", color: city.accent, fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 12, padding: 0 }}
              >
                &larr; Back to list
              </button>

              {/* ── Header ── */}
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
                  {city.flag} {city.name} &mdash; {fmtDate(selectedEvent.target_date)}
                </h2>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                  {brackets.length} brackets &middot; ${Math.round(selectedEvent.total_volume).toLocaleString()} volume
                  {tempC !== null && (
                    <span style={{ marginLeft: 12, color: "#fbbf24", fontWeight: 700 }}>
                      Actual: {tempC}\u00b0C
                    </span>
                  )}
                  {!selectedEvent.closed && (
                    <span style={{ marginLeft: 12, color: "#22d3ee", fontWeight: 600 }}>OPEN</span>
                  )}
                </div>
              </div>

              {/* ── Chart ── */}
              {chartData.length > 0 && (
                <div style={{ background: "#111827", borderRadius: 12, padding: "16px 8px 8px 0", marginBottom: 20 }}>
                  <ResponsiveContainer width="100%" height={380}>
                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <XAxis
                        dataKey="time"
                        tick={{ fill: "#475569", fontSize: 11 }}
                        axisLine={{ stroke: "#1e293b" }}
                        tickLine={false}
                        interval="preserveStartEnd"
                        minTickGap={60}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fill: "#475569", fontSize: 11 }}
                        axisLine={{ stroke: "#1e293b" }}
                        tickLine={false}
                        tickFormatter={(v: number) => `${v}%`}
                        width={44}
                      />
                      <Tooltip
                        content={renderTooltip}
                        cursor={{ stroke: "#334155", strokeWidth: 1 }}
                        isAnimationActive={false}
                        wrapperStyle={{ pointerEvents: "none" }}
                      />
                      <ReferenceLine y={50} stroke="#1e293b" strokeDasharray="4 4" />
                      {brackets.map((b, i) => {
                        const isWinner = b.winner === "YES";
                        return (
                          <Line
                            key={b.condition_id}
                            dataKey={b.condition_id}
                            stroke={COLORS[i % COLORS.length]}
                            strokeWidth={isWinner ? 3 : 1.2}
                            strokeOpacity={isWinner ? 1 : 0.45}
                            dot={false}
                            name={bracketLabel(b)}
                            connectNulls
                            isAnimationActive={false}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* ── Bracket grid ── */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                {brackets.map((b, i) => {
                  const color = COLORS[i % COLORS.length];
                  const isWinner = b.winner === "YES";
                  const pts = prices[b.condition_id] || [];
                  const openPrice = pts.length > 0 ? Math.round(pts[0].price_yes * 100) : null;
                  const closePrice = pts.length > 0 ? Math.round(pts[pts.length - 1].price_yes * 100) : null;

                  return (
                    <div
                      key={b.condition_id}
                      style={{
                        background: isWinner ? "#0f2a1a" : "#111827",
                        borderRadius: 10,
                        padding: "10px 12px",
                        borderLeft: `3px solid ${color}`,
                        borderColor: isWinner ? "#22c55e" : color,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: isWinner ? "#4ade80" : "#e2e8f0" }}>
                          {bracketLabel(b)}
                        </span>
                        {isWinner && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: "#166534", color: "#4ade80", padding: "1px 6px", borderRadius: 4, marginLeft: "auto" }}>
                            WIN
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>
                        {openPrice != null && closePrice != null
                          ? `${openPrice}% \u2192 ${closePrice}%`
                          : "no data"}
                      </div>
                      <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                        ${Math.round(b.volume).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
