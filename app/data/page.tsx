"use client";
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  LineChart,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
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
const CHART_H = 400;
const CHART_MARGIN = { top: 8, right: 16, left: 44, bottom: 40 };

/* ─── Supabase helper ────────────────────────────────────── */

async function sb<T = any>(path: string): Promise<T> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) return [] as unknown as T;
  return r.json();
}

/** Fetch all rows (paginate past Supabase 1000-row default) */
async function sbAll<T = any>(path: string): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const batch: T[] = await sb(`${path}${sep}limit=${limit}&offset=${offset}`);
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
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

interface ModelScore {
  station: string;
  model: string;
  horizon: number;
  mae: number;
  sample_count: number;
}

interface GfsForecast {
  station: string;
  target_date: string;
  horizon: number;
  model: string;
  temp_max: number | null;
  temp_max_f: number | null;
  ensemble_mean: number | null;
  ensemble_min: number | null;
  ensemble_max: number | null;
}

interface EnsembleForecast {
  station: string;
  target_date: string;
  fetch_ts: string;
  ensemble_model: string;
  member_id: number;
  temp_max: number | null;
  wind_gusts_max: number | null;
  precipitation: number | null;
  snowfall: number | null;
  cloud_cover: number | null;
  pressure_msl: number | null;
}

/* ─── Helpers ────────────────────────────────────────────── */

function fmtDate(d: string) {
  const dt = new Date(d + "T12:00:00Z");
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function fmtHour(ts: number) {
  const d = new Date(ts * 1000);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
}

function fmtDayHour(ts: number) {
  const d = new Date(ts * 1000);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const h = `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
  return `${day} ${h}`;
}

/** For the X axis: show "Mon 24" at day boundaries, "14:00" otherwise */
function fmtAxisTick(ts: number, prevTs: number | null) {
  const d = new Date(ts * 1000);
  const prev = prevTs ? new Date(prevTs * 1000) : null;
  const newDay = !prev || d.getUTCDate() !== prev.getUTCDate();
  if (newDay) {
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
  }
  return `${d.getUTCHours().toString().padStart(2, "0")}:00`;
}

function bracketLabel(b: Bracket) {
  const t = b.bracket_temp;
  if (b.bracket_op === "lte") return `\u2264${t}\u00b0`;
  if (b.bracket_op === "gte") return `\u2265${t}\u00b0`;
  if (b.bracket_op === "between") return `${t}-${t + 1}\u00b0`;
  return `${t}\u00b0`;
}

function downsample(pts: PricePoint[], max: number): PricePoint[] {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  const out: PricePoint[] = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
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
  const [tempF, setTempF] = useState<number | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [forecasts, setForecasts] = useState<GfsForecast[]>([]);
  const [modelScores, setModelScores] = useState<ModelScore[]>([]);
  const [ensembles, setEnsembles] = useState<EnsembleForecast[]>([]);
  const [closedBrackets, setClosedBrackets] = useState<Set<string>>(new Set());

  // Chart sizing
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);

  // Custom tooltip state (no recharts Tooltip = no flicker)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  /* ── Measure chart wrapper ── */
  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setChartWidth(el.clientWidth));
    ro.observe(el);
    setChartWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

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
    setTempF(null);
    setForecasts([]);
    setModelScores([]);
    setEnsembles([]);
    setHoverIdx(null);
    setClosedBrackets(new Set());

    try {
      const [brk, tmp, fc, scores] = await Promise.all([
        sb<Bracket[]>(
          `poly_markets?poly_event_id=eq.${ev.event_id}&select=condition_id,bracket_temp,bracket_op,bracket_str,winner,volume&order=bracket_temp`
        ),
        sb<{ temp_max_c: number; temp_max_f?: number | null }[]>(
          `daily_temps?station=eq.${ev.station}&date=eq.${ev.target_date}&select=*&limit=1`
        ),
        sb<GfsForecast[]>(
          `gfs_forecasts?station=eq.${ev.station}&target_date=eq.${ev.target_date}&select=*&order=model,horizon`
        ),
        sb<ModelScore[]>(
          `model_scores?station=eq.${ev.station}&select=*`
        ),
      ]);
      setBrackets(brk);
      if (tmp.length > 0) {
        setTempC(tmp[0].temp_max_c);
        setTempF(tmp[0].temp_max_f ?? null);
      }
      setForecasts(fc);
      setModelScores(scores);

      // Fetch ensemble data for this event
      const ens = await sbAll<EnsembleForecast>(
        `ensemble_forecasts?station=eq.${ev.station}&target_date=eq.${ev.target_date}&select=station,target_date,fetch_ts,ensemble_model,member_id,temp_max,wind_gusts_max,precipitation,snowfall,cloud_cover,pressure_msl&order=fetch_ts,ensemble_model,member_id`
      );
      setEnsembles(ens);

      const priceResults = await Promise.all(
        brk.map(b =>
          sbAll<PricePoint>(
            `price_history?condition_id=eq.${b.condition_id}&select=ts,price_yes&order=ts`
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
    const allTs = new Set<number>();
    for (const pts of Object.values(prices)) {
      for (const p of pts) allTs.add(p.ts);
    }
    const sortedTs = [...allTs].sort((a, b) => a - b);
    const sampled = downsample(
      sortedTs.map(ts => ({ ts, price_yes: 0 })), 200
    ).map(p => p.ts);

    return sampled.map(ts => {
      const row: Record<string, any> = { ts, time: fmtHour(ts), fullTime: fmtDayHour(ts) };
      for (const b of brackets) {
        const pts = prices[b.condition_id];
        if (!pts || pts.length === 0) { row[b.condition_id] = null; continue; }
        let lo = 0, hi = pts.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].ts < ts) lo = mid + 1; else hi = mid; }
        const best = lo > 0 && Math.abs(pts[lo - 1].ts - ts) < Math.abs(pts[lo].ts - ts) ? pts[lo - 1] : pts[lo];
        row[b.condition_id] = Math.round(best.price_yes * 100);
      }
      return row;
    });
  }, [brackets, prices]);

  /* ── Chart mouse handler: map pixel X → data index ── */
  const handleChartMouse = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartData.length || !chartWidth) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const cw = chartWidth - 48; // matches LineChart width
    const plotLeft = CHART_MARGIN.left;
    const plotRight = cw - CHART_MARGIN.right;
    const plotW = plotRight - plotLeft;
    if (x < plotLeft || x > plotRight) { setHoverIdx(null); return; }
    const ratio = (x - plotLeft) / plotW;
    const idx = Math.round(ratio * (chartData.length - 1));
    setHoverIdx(Math.max(0, Math.min(idx, chartData.length - 1)));
    setHoverX(x);
  }, [chartData, chartWidth]);

  /* ── Pagination ── */
  const pagedEvents = events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(events.length / PAGE_SIZE);

  /* ── Hovered data point ── */
  const hoverRow = hoverIdx !== null ? chartData[hoverIdx] : null;

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
              flex: 1, padding: "14px 0",
              background: city.station === c.station ? "#1e293b" : "transparent",
              color: city.station === c.station ? c.accent : "#64748b",
              border: "none",
              borderBottom: city.station === c.station ? `2px solid ${c.accent}` : "2px solid transparent",
              cursor: "pointer", fontSize: 15, fontWeight: 600,
            }}
          >
            {c.flag} {c.name}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", minHeight: "calc(100vh - 100px)" }}>

        {/* ── Date list (left sidebar) ── */}
        <div
          style={{ width: 260, minWidth: 260, borderRight: "1px solid #1e293b", overflowY: "auto", flexShrink: 0 }}
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
                  <button key={ev.event_id} onClick={() => loadEvent(ev)} style={{
                    display: "block", width: "100%", textAlign: "left", padding: "10px 16px",
                    background: active ? "#1e293b" : "transparent", border: "none",
                    borderBottom: "1px solid #0f172a",
                    borderLeft: active ? `3px solid ${city.accent}` : "3px solid transparent",
                    color: active ? "#f1f5f9" : "#94a3b8", cursor: "pointer",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(ev.target_date)}</div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                      {ev.n_brackets} brackets &middot; ${Math.round(ev.total_volume).toLocaleString()}
                      {!ev.closed && <span style={{ color: "#22d3ee", marginLeft: 6 }}>OPEN</span>}
                    </div>
                  </button>
                );
              })}
              <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: 12 }}>
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                  style={{ padding: "4px 12px", background: "#1e293b", border: "none", borderRadius: 6, color: page === 0 ? "#334155" : "#94a3b8", cursor: page === 0 ? "default" : "pointer", fontSize: 13 }}>&larr;</button>
                <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                  style={{ padding: "4px 12px", background: "#1e293b", border: "none", borderRadius: 6, color: page >= totalPages - 1 ? "#334155" : "#94a3b8", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: 13 }}>&rarr;</button>
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
                <button key={ev.event_id} onClick={() => loadEvent(ev)} style={{
                  display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
                  background: "transparent", border: "none", borderBottom: "1px solid #1e293b",
                  color: "#94a3b8", cursor: "pointer",
                }}>
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
        <div
          ref={chartWrapRef}
          style={{ flex: 1, padding: "20px 24px", overflowY: "auto", minWidth: 0 }}
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
              {/* Mobile back */}
              <button onClick={() => setSelectedEvent(null)} className="block md:hidden"
                style={{ background: "none", border: "none", color: city.accent, fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 12, padding: 0 }}>
                &larr; Back to list
              </button>

              {/* ── Header ── */}
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
                  {city.flag} {city.name} &mdash; {fmtDate(selectedEvent.target_date)}
                </h2>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                  {brackets.length} brackets &middot; ${Math.round(selectedEvent.total_volume).toLocaleString()} volume
                  {(() => {
                    const isF = selectedEvent?.station === "KLGA";
                    if (isF && tempF != null) {
                      return <span style={{ marginLeft: 12, color: "#fbbf24", fontWeight: 700 }}>Actual: {tempF}&deg;F</span>;
                    }
                    if (tempC != null) {
                      return <span style={{ marginLeft: 12, color: "#fbbf24", fontWeight: 700 }}>Actual: {tempC}&deg;C</span>;
                    }
                    return null;
                  })()}
                  {!selectedEvent.closed && (() => {
                    // Find the most recent price point across all brackets
                    let maxTs = 0;
                    for (const pts of Object.values(prices)) {
                      if (pts.length > 0 && pts[pts.length - 1].ts > maxTs) maxTs = pts[pts.length - 1].ts;
                    }
                    const agoMin = maxTs > 0 ? Math.round((Date.now() / 1000 - maxTs) / 60) : null;
                    const agoStr = agoMin !== null
                      ? agoMin < 60 ? `${agoMin}min ago` : `${Math.round(agoMin / 60)}h ago`
                      : "";
                    return (
                      <>
                        <span style={{ marginLeft: 12, color: "#22d3ee", fontWeight: 600 }}>OPEN</span>
                        {agoStr && (
                          <span style={{ marginLeft: 8, color: "#475569", fontSize: 11 }}>
                            updated {agoStr}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* ── Chart + custom tooltip ── */}
              {chartData.length > 0 && chartWidth > 0 && (
                <div style={{ position: "relative", marginBottom: 20 }}>
                  {/* Invisible overlay for mouse tracking — sits on top of chart */}
                  <div
                    onMouseMove={handleChartMouse}
                    onMouseLeave={() => setHoverIdx(null)}
                    style={{
                      position: "absolute", inset: 0, zIndex: 10, cursor: "crosshair",
                    }}
                  />

                  {/* Vertical crosshair line */}
                  {hoverIdx !== null && (
                    <div style={{
                      position: "absolute", left: hoverX, top: CHART_MARGIN.top, bottom: CHART_MARGIN.bottom,
                      width: 1, background: "#475569", zIndex: 5, pointerEvents: "none",
                    }} />
                  )}

                  {/* Tooltip panel — follows cursor X, flips at right edge */}
                  {hoverRow && (
                    <div style={{
                      position: "absolute", top: 8, zIndex: 20, pointerEvents: "none",
                      left: hoverX > (chartWidth - 48) * 0.65 ? undefined : hoverX + 16,
                      right: hoverX > (chartWidth - 48) * 0.65 ? (chartWidth - 48) - hoverX + 16 : undefined,
                      background: "#1a1a2eee", border: "1px solid #2a2a4a", borderRadius: 8, padding: "10px 14px",
                      fontSize: 12, minWidth: 140,
                    }}>
                      <div style={{ color: "#94a3b8", marginBottom: 6, fontFamily: "monospace" }}>{hoverRow.fullTime}</div>
                      {brackets
                        .map((b, i) => ({ b, i, v: hoverRow[b.condition_id] as number | null }))
                        .filter(x => x.v != null)
                        .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
                        .map(({ b, i, v }) => (
                          <div key={b.condition_id} style={{ display: "flex", justifyContent: "space-between", gap: 16, color: COLORS[i % COLORS.length] }}>
                            <span>{bracketLabel(b)}</span>
                            <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{v}%</span>
                          </div>
                        ))
                      }
                    </div>
                  )}

                  {/* Actual recharts — NO Tooltip component */}
                  <div style={{ background: "#111827", borderRadius: 12, overflow: "hidden" }}>
                    <LineChart
                      data={chartData}
                      width={chartWidth - 48}
                      height={CHART_H}
                      margin={CHART_MARGIN}
                    >
                      {/* Row 1: hours */}
                      <XAxis
                        dataKey="time"
                        xAxisId="hours"
                        tick={{ fill: "#475569", fontSize: 11 }}
                        axisLine={{ stroke: "#1e293b" }}
                        tickLine={false}
                        interval="preserveStartEnd"
                        minTickGap={60}
                      />
                      {/* Row 2: day label once per day, at midnight */}
                      <XAxis
                        dataKey="ts"
                        xAxisId="days"
                        axisLine={false}
                        tickLine={false}
                        ticks={(() => {
                          // Find the first data point of each new UTC day
                          const seen = new Set<string>();
                          const dayTicks: number[] = [];
                          for (const row of chartData) {
                            const d = new Date(row.ts * 1000);
                            const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
                            if (!seen.has(key)) {
                              seen.add(key);
                              dayTicks.push(row.ts);
                            }
                          }
                          return dayTicks;
                        })()}
                        tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                        tickFormatter={(ts: number) => {
                          const d = new Date(ts * 1000);
                          return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
                        }}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fill: "#475569", fontSize: 11 }}
                        axisLine={{ stroke: "#1e293b" }}
                        tickLine={false}
                        tickFormatter={(v: number) => `${v}%`}
                        width={44}
                      />
                      <ReferenceLine y={50} stroke="#1e293b" strokeDasharray="4 4" />
                      {brackets.map((b, i) => {
                        const isWinner = b.winner === "YES";
                        const isClosed = closedBrackets.has(b.condition_id);
                        return (
                          <Line
                            key={b.condition_id}
                            xAxisId="hours"
                            dataKey={b.condition_id}
                            stroke={isClosed ? "#334155" : COLORS[i % COLORS.length]}
                            strokeWidth={isWinner ? 3 : 1.2}
                            strokeOpacity={isWinner ? 1 : isClosed ? 0.25 : 0.45}
                            dot={false}
                            connectNulls
                            isAnimationActive={false}
                            strokeDasharray={isClosed ? "4 4" : undefined}
                          />
                        );
                      })}
                    </LineChart>
                  </div>
                </div>
              )}

              {/* ── Bracket grid ── */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                {brackets.map((b, i) => {
                  const color = COLORS[i % COLORS.length];
                  const isWinner = b.winner === "YES";
                  const isClosed = closedBrackets.has(b.condition_id);
                  const pts = prices[b.condition_id] || [];
                  const openPrice = pts.length > 0 ? Math.round(pts[0].price_yes * 100) : null;
                  const closePrice = pts.length > 0 ? Math.round(pts[pts.length - 1].price_yes * 100) : null;

                  return (
                    <div key={b.condition_id} style={{
                      background: isClosed ? "#0a0a0f" : isWinner ? "#0f2a1a" : "#111827",
                      borderRadius: 10, padding: "10px 12px",
                      borderLeft: `3px solid ${isClosed ? "#1e293b" : isWinner ? "#22c55e" : color}`,
                      opacity: isClosed ? 0.5 : 1,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: isClosed ? "#334155" : color, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: isClosed ? "#475569" : isWinner ? "#4ade80" : "#e2e8f0" }}>
                          {bracketLabel(b)}
                        </span>
                        {isWinner && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: "#166534", color: "#4ade80", padding: "1px 6px", borderRadius: 4, marginLeft: "auto" }}>WIN</span>
                        )}
                        {isClosed && !isWinner && (
                          <span style={{ fontSize: 9, fontWeight: 600, background: "#1e293b", color: "#475569", padding: "1px 5px", borderRadius: 4, marginLeft: "auto" }}>CLOSED</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: isClosed ? "#334155" : "#64748b", fontFamily: "monospace" }}>
                        {openPrice != null && closePrice != null ? `${openPrice}% \u2192 ${closePrice}%` : "no data"}
                      </div>
                      <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                        ${Math.round(b.volume).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── Model Prediction (courbe 2) ── */}
              {ensembles.length > 0 && (() => {
                // Group ensembles by fetch_ts → compute probability per bracket per snapshot
                const snapshots = [...new Set(ensembles.map(e => e.fetch_ts))].sort();

                const snapshotProbs: { ts: number; probs: Record<string, number>; consensus: number; spread: number; total: number }[] = [];
                for (const fetchTs of snapshots) {
                  const members = ensembles.filter(e => e.fetch_ts === fetchTs && e.temp_max != null);
                  const total = members.length;
                  if (total === 0) continue;

                  const tsEpoch = Math.floor(new Date(fetchTs).getTime() / 1000);
                  const probs: Record<string, number> = {};

                  for (const b of brackets) {
                    const matching = members.filter(m => {
                      const t = Math.round(m.temp_max!);
                      if (b.bracket_op === "lte") return t <= b.bracket_temp;
                      if (b.bracket_op === "gte") return t >= b.bracket_temp;
                      if (b.bracket_op === "between") return t >= b.bracket_temp && t <= b.bracket_temp + 1;
                      return t === b.bracket_temp;
                    }).length;
                    probs[b.condition_id] = Math.round((matching / total) * 100);
                  }

                  const mean = members.reduce((s, e) => s + e.temp_max!, 0) / total;
                  const spread = Math.max(...members.map(e => e.temp_max!)) - Math.min(...members.map(e => e.temp_max!));
                  snapshotProbs.push({ ts: tsEpoch, probs, consensus: mean, spread, total });
                }

                if (snapshotProbs.length === 0) return null;
                const latest = snapshotProbs[snapshotProbs.length - 1];
                const isF = selectedEvent?.station === "KLGA";
                const unit = isF ? "F" : "C";

                // Build chart data using same X axis as price chart
                const predChartData = chartData.map(row => {
                  const newRow: Record<string, any> = { ts: row.ts, time: row.time, fullTime: row.fullTime };
                  let best: typeof snapshotProbs[0] | null = null;
                  for (const sp of snapshotProbs) {
                    if (sp.ts <= row.ts) best = sp;
                  }
                  if (best) {
                    for (const b of brackets) {
                      newRow[b.condition_id] = best.probs[b.condition_id] ?? null;
                    }
                  }
                  return newRow;
                });

                const hasData = predChartData.some(row => brackets.some(b => row[b.condition_id] != null));

                // Hover data for this chart (reuse hoverIdx from parent)
                const predHoverRow = hoverIdx !== null && predChartData[hoverIdx] ? predChartData[hoverIdx] : null;

                return (
                  <div style={{ marginTop: 20 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>
                      Model Prediction — {latest.total} membres
                    </h3>
                    <div style={{ fontSize: 11, color: "#475569", marginBottom: 12 }}>
                      Consensus: {latest.consensus.toFixed(1)}&deg;{unit}
                      <span style={{ marginLeft: 8, color: latest.spread < 3 ? "#4ade80" : latest.spread < 6 ? "#fbbf24" : "#f87171" }}>
                        &plusmn;{(latest.spread / 2).toFixed(1)}&deg;
                      </span>
                      <span style={{ marginLeft: 12, color: "#334155" }}>{snapshotProbs.length} snapshot{snapshotProbs.length > 1 ? "s" : ""}</span>
                    </div>

                    {/* Chart — exact same design + tooltip as price chart */}
                    {hasData && chartWidth > 0 && (
                      <div style={{ position: "relative", marginBottom: 12 }}>
                        {/* Mouse overlay for crosshair */}
                        <div
                          onMouseMove={handleChartMouse}
                          onMouseLeave={() => setHoverIdx(null)}
                          style={{ position: "absolute", inset: 0, zIndex: 10, cursor: "crosshair" }}
                        />

                        {/* Vertical crosshair */}
                        {hoverIdx !== null && (
                          <div style={{
                            position: "absolute", left: hoverX, top: CHART_MARGIN.top, bottom: CHART_MARGIN.bottom,
                            width: 1, background: "#475569", zIndex: 5, pointerEvents: "none",
                          }} />
                        )}

                        {/* Tooltip — same as price chart */}
                        {predHoverRow && (
                          <div style={{
                            position: "absolute", top: 8, zIndex: 20, pointerEvents: "none",
                            left: hoverX > (chartWidth - 48) * 0.65 ? undefined : hoverX + 16,
                            right: hoverX > (chartWidth - 48) * 0.65 ? (chartWidth - 48) - hoverX + 16 : undefined,
                            background: "#1a1a2eee", border: "1px solid #2a2a4a", borderRadius: 8, padding: "10px 14px",
                            fontSize: 12, minWidth: 140,
                          }}>
                            <div style={{ color: "#94a3b8", marginBottom: 6, fontFamily: "monospace" }}>{predHoverRow.fullTime}</div>
                            {brackets
                              .map((b, i) => ({ b, i, v: predHoverRow[b.condition_id] as number | null }))
                              .filter(x => x.v != null)
                              .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
                              .map(({ b, i, v }) => (
                                <div key={b.condition_id} style={{ display: "flex", justifyContent: "space-between", gap: 16, color: COLORS[i % COLORS.length] }}>
                                  <span>{bracketLabel(b)}</span>
                                  <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{v}%</span>
                                </div>
                              ))
                            }
                          </div>
                        )}

                        <div style={{ background: "#111827", borderRadius: 12, overflow: "hidden" }}>
                          <LineChart
                            data={predChartData}
                            width={chartWidth - 48}
                            height={CHART_H}
                            margin={CHART_MARGIN}
                          >
                            <XAxis
                              dataKey="time"
                              xAxisId="hours"
                              tick={{ fill: "#475569", fontSize: 11 }}
                              axisLine={{ stroke: "#1e293b" }}
                              tickLine={false}
                              interval="preserveStartEnd"
                              minTickGap={60}
                            />
                            <XAxis
                              dataKey="ts"
                              xAxisId="days"
                              axisLine={false}
                              tickLine={false}
                              ticks={(() => {
                                const seen = new Set<string>();
                                const dayTicks: number[] = [];
                                for (const row of predChartData) {
                                  const d = new Date(row.ts * 1000);
                                  const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
                                  if (!seen.has(key)) { seen.add(key); dayTicks.push(row.ts); }
                                }
                                return dayTicks;
                              })()}
                              tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                              tickFormatter={(ts: number) => {
                                const d = new Date(ts * 1000);
                                return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
                              }}
                            />
                            <YAxis
                              domain={[0, 100]}
                              tick={{ fill: "#475569", fontSize: 11 }}
                              axisLine={{ stroke: "#1e293b" }}
                              tickLine={false}
                              tickFormatter={(v: number) => `${v}%`}
                              width={44}
                            />
                            <ReferenceLine y={50} stroke="#1e293b" strokeDasharray="4 4" />
                            {brackets.map((b, i) => {
                              const isClosed = closedBrackets.has(b.condition_id);
                              return (
                                <Line
                                  key={b.condition_id}
                                  xAxisId="hours"
                                  dataKey={b.condition_id}
                                  stroke={isClosed ? "#334155" : COLORS[i % COLORS.length]}
                                  strokeWidth={1.5}
                                  strokeOpacity={isClosed ? 0.25 : 0.7}
                                  dot={false}
                                  connectNulls
                                  isAnimationActive={false}
                                  strokeDasharray={isClosed ? "4 4" : undefined}
                                />
                              );
                            })}
                          </LineChart>
                        </div>
                      </div>
                    )}

                    {/* Bracket cards: our prob vs market */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 6 }}>
                      {brackets.map((b, i) => {
                        const ourProb = latest.probs[b.condition_id] ?? 0;
                        const pts = prices[b.condition_id] || [];
                        const marketProb = pts.length > 0 ? Math.round(pts[pts.length - 1].price_yes * 100) : null;
                        const edge = marketProb != null ? ourProb - marketProb : null;
                        const edgeColor = edge != null ? (edge > 10 ? "#4ade80" : edge < -10 ? "#f87171" : "#475569") : "#475569";
                        const color = COLORS[i % COLORS.length];
                        const isClosed = closedBrackets.has(b.condition_id);

                        return (
                          <button
                            key={b.condition_id}
                            onClick={() => setClosedBrackets(prev => {
                              const next = new Set(prev);
                              if (next.has(b.condition_id)) next.delete(b.condition_id); else next.add(b.condition_id);
                              return next;
                            })}
                            style={{
                              background: isClosed ? "#0a0a0f" : "#111827", borderRadius: 8, padding: "8px 10px",
                              borderLeft: `3px solid ${isClosed ? "#1e293b" : color}`,
                              border: "none", textAlign: "left", cursor: "pointer",
                              opacity: isClosed ? 0.4 : 1,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                              <div style={{ width: 6, height: 6, borderRadius: "50%", background: isClosed ? "#334155" : color }} />
                              <span style={{ fontSize: 12, fontWeight: 700, color: isClosed ? "#475569" : "#e2e8f0" }}>{bracketLabel(b)}</span>
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: isClosed ? "#334155" : color, fontFamily: "monospace" }}>
                              {ourProb}%
                            </div>
                            {marketProb != null && (
                              <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                                Poly: {marketProb}%
                                <span style={{ color: isClosed ? "#334155" : edgeColor, fontWeight: 700, marginLeft: 4 }}>
                                  {edge! > 0 ? "+" : ""}{edge}
                                </span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* ── Courbe 3 — Intemperies ── */}
                    {hasData && chartWidth > 0 && (() => {
                      // Build weather data using same X axis as price chart
                      const avg = (arr: (number | null)[]) => {
                        const valid = arr.filter((v): v is number => v != null);
                        return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
                      };
                      const weatherData = predChartData.map(row => {
                        const newRow: Record<string, any> = { ts: row.ts, time: row.time, fullTime: row.fullTime };
                        let best: typeof snapshotProbs[0] | null = null;
                        for (const sp of snapshotProbs) {
                          if (sp.ts <= row.ts) best = sp;
                        }
                        if (best) {
                          const snapMembers = ensembles.filter(e => {
                            const ets = Math.floor(new Date(e.fetch_ts).getTime() / 1000);
                            return Math.abs(ets - best!.ts) < 3600;
                          });
                          if (snapMembers.length > 0) {
                            newRow.precipitation = avg(snapMembers.map(e => e.precipitation));
                            newRow.snowfall = avg(snapMembers.map(e => e.snowfall));
                            newRow.windGusts = avg(snapMembers.map(e => e.wind_gusts_max));
                            newRow.cloudCover = avg(snapMembers.map(e => e.cloud_cover));
                            const pressures = snapMembers.map(e => e.pressure_msl).filter((v): v is number => v != null);
                            newRow.pressureDelta = pressures.length > 0 ? pressures.reduce((a, b) => a + b, 0) / pressures.length - 1013 : null;
                          }
                        }
                        return newRow;
                      });

                      const hasWeather = weatherData.some(r => r.precipitation != null);
                      if (!hasWeather) return null;

                      return (
                        <div style={{ marginTop: 16 }}>
                          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>
                            Conditions Meteo
                          </h3>
                          <div style={{ position: "relative" }}>
                            <div
                              onMouseMove={handleChartMouse}
                              onMouseLeave={() => setHoverIdx(null)}
                              style={{ position: "absolute", inset: 0, zIndex: 10, cursor: "crosshair" }}
                            />
                            {hoverIdx !== null && (
                              <div style={{
                                position: "absolute", left: hoverX, top: CHART_MARGIN.top, bottom: CHART_MARGIN.bottom,
                                width: 1, background: "#475569", zIndex: 5, pointerEvents: "none",
                              }} />
                            )}
                            {hoverIdx !== null && weatherData[hoverIdx] && (() => {
                              const wr = weatherData[hoverIdx];
                              return (
                                <div style={{
                                  position: "absolute", top: 8, zIndex: 20, pointerEvents: "none",
                                  left: hoverX > (chartWidth - 48) * 0.65 ? undefined : hoverX + 16,
                                  right: hoverX > (chartWidth - 48) * 0.65 ? (chartWidth - 48) - hoverX + 16 : undefined,
                                  background: "#1a1a2eee", border: "1px solid #2a2a4a", borderRadius: 8, padding: "10px 14px",
                                  fontSize: 12, minWidth: 160,
                                }}>
                                  <div style={{ color: "#94a3b8", marginBottom: 6, fontFamily: "monospace" }}>{wr.fullTime}</div>
                                  {wr.precipitation != null && <div style={{ color: "#60a5fa" }}>Precip: {wr.precipitation.toFixed(1)} mm</div>}
                                  {wr.snowfall != null && wr.snowfall > 0 && <div style={{ color: "#e2e8f0" }}>Neige: {wr.snowfall.toFixed(1)} cm</div>}
                                  {wr.windGusts != null && <div style={{ color: "#a78bfa" }}>Rafales: {wr.windGusts.toFixed(0)} km/h</div>}
                                  {wr.cloudCover != null && <div style={{ color: "#94a3b8" }}>Nuages: {wr.cloudCover.toFixed(0)}%</div>}
                                  {wr.pressureDelta != null && <div style={{ color: "#f97316" }}>Pression: {wr.pressureDelta > 0 ? "+" : ""}{wr.pressureDelta.toFixed(1)} hPa</div>}
                                </div>
                              );
                            })()}
                            <div style={{ background: "#111827", borderRadius: 12, overflow: "hidden" }}>
                              <LineChart data={weatherData} width={chartWidth - 48} height={280} margin={CHART_MARGIN}>
                                <XAxis dataKey="time" xAxisId="hours" tick={{ fill: "#475569", fontSize: 11 }} axisLine={{ stroke: "#1e293b" }} tickLine={false} interval="preserveStartEnd" minTickGap={60} />
                                <XAxis dataKey="ts" xAxisId="days" axisLine={false} tickLine={false}
                                  ticks={(() => { const seen = new Set<string>(); const t: number[] = []; for (const r of weatherData) { const d = new Date(r.ts * 1000); const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`; if (!seen.has(k)) { seen.add(k); t.push(r.ts); } } return t; })()}
                                  tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                                  tickFormatter={(ts: number) => new Date(ts * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                                />
                                <YAxis tick={{ fill: "#475569", fontSize: 11 }} axisLine={{ stroke: "#1e293b" }} tickLine={false} width={44} />
                                <Line xAxisId="hours" dataKey="precipitation" stroke="#60a5fa" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} name="Precip (mm)" />
                                <Line xAxisId="hours" dataKey="snowfall" stroke="#e2e8f0" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} name="Neige (cm)" />
                                <Line xAxisId="hours" dataKey="windGusts" stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} name="Rafales (km/h)" />
                                <Line xAxisId="hours" dataKey="cloudCover" stroke="#64748b" strokeWidth={1} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} name="Nuages (%)" />
                              </LineChart>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Courbe 4 — Score de Confiance ── */}
                    {hasData && chartWidth > 0 && (() => {
                      // Build confidence data using same X axis as price chart
                      const confidenceData = predChartData.map(row => {
                        const newRow: Record<string, any> = { ts: row.ts, time: row.time, fullTime: row.fullTime, confidence: null };
                        let best: typeof snapshotProbs[0] | null = null;
                        for (const sp of snapshotProbs) {
                          if (sp.ts <= row.ts) best = sp;
                        }
                        if (!best) return newRow;

                        const snapMembers = ensembles.filter(e => {
                          const ets = Math.floor(new Date(e.fetch_ts).getTime() / 1000);
                          return Math.abs(ets - best!.ts) < 3600 && e.temp_max != null;
                        });
                        if (snapMembers.length === 0) return newRow;

                        const votes: Record<number, number> = {};
                        for (const m of snapMembers) {
                          const t = Math.round(m.temp_max!);
                          votes[t] = (votes[t] || 0) + 1;
                        }

                        const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
                        const top1 = sorted[0] ? sorted[0][1] : 0;
                        const top2 = sorted[1] ? sorted[1][1] : 0;
                        const total = snapMembers.length;

                        newRow.confidence = Math.round(((top1 + top2) / total) * 100);
                        newRow._top1Temp = sorted[0] ? parseInt(sorted[0][0]) : null;
                        newRow._top1Pct = Math.round((top1 / total) * 100);
                        newRow._top2Temp = sorted[1] ? parseInt(sorted[1][0]) : null;
                        newRow._top2Pct = Math.round((top2 / total) * 100);
                        newRow._spread = Math.max(...snapMembers.map(m => m.temp_max!)) - Math.min(...snapMembers.map(m => m.temp_max!));
                        newRow._total = total;

                        return newRow;
                      });

                      const hasConfidence = confidenceData.some(r => r.confidence != null);
                      if (!hasConfidence) return null;

                      // Get latest confidence for color
                      const latestConf = [...confidenceData].reverse().find(r => r.confidence != null);
                      const confValue = latestConf?.confidence ?? 50;
                      const confColor = confValue >= 75 ? "#4ade80" : confValue >= 50 ? "#fbbf24" : confValue >= 25 ? "#f97316" : "#f87171";
                      const confLabel = confValue >= 75 ? "Fort consensus" : confValue >= 50 ? "Consensus modere" : confValue >= 25 ? "Faible consensus" : "Aucun consensus";

                      const isF = selectedEvent?.station === "KLGA";
                      const unit = isF ? "F" : "C";

                      return (
                        <div style={{ marginTop: 16 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
                            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", margin: 0 }}>
                              Score de Confiance
                            </h3>
                            <span style={{ fontSize: 22, fontWeight: 800, color: confColor, fontFamily: "monospace" }}>{confValue}%</span>
                            <span style={{ fontSize: 11, color: confColor }}>{confLabel}</span>
                            {latestConf?._top1Temp != null && (
                              <span style={{ fontSize: 11, color: "#475569" }}>
                                Top: {latestConf._top1Temp}&deg;{unit} ({latestConf._top1Pct}%)
                                {latestConf._top2Temp != null && <> + {latestConf._top2Temp}&deg;{unit} ({latestConf._top2Pct}%)</>}
                                {" "}&middot; spread {latestConf._spread.toFixed(1)}&deg;
                              </span>
                            )}
                          </div>
                          <div style={{ position: "relative" }}>
                            <div
                              onMouseMove={handleChartMouse}
                              onMouseLeave={() => setHoverIdx(null)}
                              style={{ position: "absolute", inset: 0, zIndex: 10, cursor: "crosshair" }}
                            />
                            {hoverIdx !== null && (
                              <div style={{
                                position: "absolute", left: hoverX, top: CHART_MARGIN.top, bottom: CHART_MARGIN.bottom,
                                width: 1, background: "#475569", zIndex: 5, pointerEvents: "none",
                              }} />
                            )}
                            {hoverIdx !== null && confidenceData[hoverIdx]?.confidence != null && (() => {
                              const cr = confidenceData[hoverIdx];
                              const c = cr.confidence;
                              const col = c >= 75 ? "#4ade80" : c >= 50 ? "#fbbf24" : c >= 25 ? "#f97316" : "#f87171";
                              return (
                                <div style={{
                                  position: "absolute", top: 8, zIndex: 20, pointerEvents: "none",
                                  left: hoverX > (chartWidth - 48) * 0.65 ? undefined : hoverX + 16,
                                  right: hoverX > (chartWidth - 48) * 0.65 ? (chartWidth - 48) - hoverX + 16 : undefined,
                                  background: "#1a1a2eee", border: "1px solid #2a2a4a", borderRadius: 8, padding: "10px 14px",
                                  fontSize: 12, minWidth: 160,
                                }}>
                                  <div style={{ color: "#94a3b8", marginBottom: 6, fontFamily: "monospace" }}>{cr.fullTime}</div>
                                  <div style={{ color: col, fontWeight: 700, fontSize: 16 }}>{c}%</div>
                                  {cr._top1Temp != null && <div style={{ color: "#e2e8f0", marginTop: 4 }}>Top: {cr._top1Temp}&deg;{unit} ({cr._top1Pct}%)</div>}
                                  {cr._top2Temp != null && <div style={{ color: "#94a3b8" }}>2e: {cr._top2Temp}&deg;{unit} ({cr._top2Pct}%)</div>}
                                  <div style={{ color: "#475569", marginTop: 2 }}>Spread: {cr._spread.toFixed(1)}&deg; &middot; {cr._total} membres</div>
                                </div>
                              );
                            })()}
                            <div style={{ background: "#111827", borderRadius: 12, overflow: "hidden" }}>
                              <AreaChart data={confidenceData} width={chartWidth - 48} height={200} margin={CHART_MARGIN}>
                                <defs>
                                  <linearGradient id="confGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={confColor} stopOpacity={0.3} />
                                    <stop offset="100%" stopColor={confColor} stopOpacity={0.02} />
                                  </linearGradient>
                                </defs>
                                <XAxis dataKey="time" xAxisId="hours" tick={{ fill: "#475569", fontSize: 11 }} axisLine={{ stroke: "#1e293b" }} tickLine={false} interval="preserveStartEnd" minTickGap={60} />
                                <XAxis dataKey="ts" xAxisId="days" axisLine={false} tickLine={false}
                                  ticks={(() => { const seen = new Set<string>(); const t: number[] = []; for (const r of confidenceData) { const d = new Date(r.ts * 1000); const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`; if (!seen.has(k)) { seen.add(k); t.push(r.ts); } } return t; })()}
                                  tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                                  tickFormatter={(ts: number) => new Date(ts * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                                />
                                <YAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 11 }} axisLine={{ stroke: "#1e293b" }} tickLine={false} tickFormatter={(v: number) => `${v}%`} width={44} />
                                <ReferenceLine y={50} stroke="#334155" strokeDasharray="4 4" xAxisId="hours" />
                                <ReferenceLine y={75} stroke="#334155" strokeDasharray="2 6" xAxisId="hours" />
                                <Area xAxisId="hours" dataKey="confidence" stroke={confColor} strokeWidth={3} fill="url(#confGrad)" dot={false} connectNulls isAnimationActive={false} />
                              </AreaChart>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                  </div>
                );
              })()}

              {/* ── Forecast evolution table (old deterministic, shown for past events) ── */}
              {forecasts.length > 0 && ensembles.length === 0 && (() => {
                // Build average MAE per model for sorting
                const scoreMap: Record<string, { totalMae: number; count: number }> = {};
                for (const s of modelScores) {
                  if (!scoreMap[s.model]) scoreMap[s.model] = { totalMae: 0, count: 0 };
                  scoreMap[s.model].totalMae += s.mae;
                  scoreMap[s.model].count += 1;
                }
                const avgMae = (model: string) => {
                  const s = scoreMap[model];
                  return s ? s.totalMae / s.count : Infinity;
                };

                // Build per-horizon MAE lookup
                const maeByModelHorizon: Record<string, number> = {};
                for (const s of modelScores) {
                  maeByModelHorizon[`${s.model}|${s.horizon}`] = s.mae;
                }

                const models = [...new Set(forecasts.map(f => f.model))].sort((a, b) => avgMae(a) - avgMae(b));
                const horizons = [3, 2, 1, 0]; // J-3 → J-0

                const errColor = (err: number | null) => {
                  if (err == null) return "#475569";
                  const a = Math.abs(err);
                  return a <= 1 ? "#4ade80" : a <= 2 ? "#fbbf24" : "#f87171";
                };

                const fmtErr = (err: number | null) => {
                  if (err == null) return "\u2014";
                  return `${err > 0 ? "+" : ""}${err}\u00b0`;
                };

                // Grid distance + availability times in LOCAL timezone per station
                // GFS:    runs 00/06/12/18z, avail +3.5h → 03:30/09:30/15:30/21:30 UTC
                // ECMWF:  runs 00/12z,       avail +6h   → 06:00/18:00 UTC
                // ICON:   runs 00/06/12/18z, avail +3h   → 03:00/09:00/15:00/21:00 UTC
                // UKMO:   runs 00/12z,       avail +6h   → 06:00/18:00 UTC
                // MétéoFr:runs 00/06/12/18z, avail +4h   → 04:00/10:00/16:00/22:00 UTC
                const MODEL_INFO: Record<string, Record<string, { dist: string; runs: string }>> = {
                  KLGA: { // EDT UTC-4
                    gfs:         { dist: "1.4 km",  runs: "23h 05h 11h 17h" },
                    ecmwf:       { dist: "10.9 km", runs: "02h 14h" },
                    icon:        { dist: "3.0 km",  runs: "23h 05h 11h 17h" },
                    ukmo:        { dist: "3.9 km",  runs: "02h 14h" },
                    meteofrance: { dist: "10.9 km", runs: "00h 06h 12h 18h" },
                    gem:         { dist: "5.3 km",  runs: "20h 02h 08h 14h" },
                    jma:         { dist: "1.2 km",  runs: "23h 02h 05h 08h 11h 14h 17h 20h" },
                    knmi:        { dist: "1.2 km",  runs: "hourly" },
                  },
                  EGLC: { // GMT UTC+0
                    gfs:         { dist: "4.3 km",  runs: "03h 09h 15h 21h" },
                    ecmwf:       { dist: "3.9 km",  runs: "06h 18h" },
                    icon:        { dist: "0.7 km",  runs: "03h 09h 15h 21h" },
                    ukmo:        { dist: "0.9 km",  runs: "06h 18h" },
                    meteofrance: { dist: "0.6 km",  runs: "04h 10h 16h 22h" },
                    gem:         { dist: "4.4 km",  runs: "00h 06h 12h 18h" },
                    jma:         { dist: "2.2 km",  runs: "03h 06h 09h 12h 15h 18h 21h 00h" },
                    knmi:        { dist: "0.8 km",  runs: "hourly" },
                  },
                  RKSI: { // KST UTC+9
                    gfs:         { dist: "3.5 km",  runs: "12h 18h 00h 06h" },
                    ecmwf:       { dist: "6.9 km",  runs: "15h 03h" },
                    icon:        { dist: "19.1 km", runs: "12h 18h 00h 06h" },
                    ukmo:        { dist: "4.7 km",  runs: "15h 03h" },
                    meteofrance: { dist: "6.9 km",  runs: "13h 19h 01h 07h" },
                    gem:         { dist: "5.1 km",  runs: "09h 15h 21h 03h" },
                    jma:         { dist: "1.9 km",  runs: "12h 15h 18h 21h 00h 03h 06h 09h" },
                    knmi:        { dist: "0.6 km",  runs: "hourly" },
                  },
                };

                return (
                  <div style={{ marginTop: 20 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>
                      Forecast Evolution
                    </h3>
                    <div style={{ background: "#111827", borderRadius: 12, overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "monospace", minWidth: 600 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #1e293b" }}>
                            <th style={{ padding: "10px 12px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 11 }}>Model</th>
                            {horizons.map(h => (
                              <th key={`h${h}`} colSpan={2} style={{ padding: "10px 8px", textAlign: "center", color: "#64748b", fontWeight: 600, fontSize: 11, borderLeft: "1px solid #1e293b" }}>
                                J-{h}
                              </th>
                            ))}
                            <th style={{ padding: "10px 8px", textAlign: "center", color: "#fbbf24", fontWeight: 600, fontSize: 11, borderLeft: "1px solid #1e293b" }}>Actual</th>
                          </tr>
                        </thead>
                        <tbody>
                          {models.map(model => {
                            const modelForecasts = forecasts.filter(f => f.model === model);
                            const byHorizon: Record<number, GfsForecast> = {};
                            for (const f of modelForecasts) byHorizon[f.horizon] = f;

                            const info = selectedEvent ? MODEL_INFO[selectedEvent.station]?.[model] : null;

                            return (
                              <tr key={model} style={{ borderBottom: "1px solid #0f172a" }}>
                                <td style={{ padding: "10px 12px", fontWeight: 700, color: { gfs: "#60a5fa", ecmwf: "#a78bfa", icon: "#34d399", ukmo: "#fb923c", meteofrance: "#f472b6", gem: "#38bdf8", jma: "#fb7185", knmi: "#a3e635" }[model] ?? "#94a3b8", textTransform: "uppercase", fontSize: 12, minWidth: 120 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span>{model}</span>
                                    {scoreMap[model] && (() => {
                                      const avg = avgMae(model);
                                      const maeColor = avg <= 1.5 ? "#4ade80" : avg <= 2.5 ? "#fbbf24" : "#f87171";
                                      return (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: maeColor, background: `${maeColor}20`, padding: "2px 6px", borderRadius: 4, letterSpacing: 0 }}>
                                          MAE {avg.toFixed(1)}&deg;
                                        </span>
                                      );
                                    })()}
                                  </div>
                                  {info && (
                                    <div style={{ fontSize: 9, color: "#475569", fontWeight: 400, marginTop: 2 }}>
                                      {info.dist} · {info.runs}
                                    </div>
                                  )}
                                  {(() => {
                                    const ms = modelScores.find(s => s.model === model && s.horizon === 0);
                                    return ms ? (
                                      <div style={{ fontSize: 9, color: "#334155", fontWeight: 400, marginTop: 1 }}>
                                        {ms.sample_count} comparaisons
                                      </div>
                                    ) : null;
                                  })()}
                                </td>
                                {horizons.map(h => {
                                  const isF = selectedEvent?.station === "KLGA";
                                  const fc = byHorizon[h];
                                  const val = (isF && fc?.temp_max_f != null) ? fc.temp_max_f : fc?.temp_max;
                                  const actual = (isF && tempF != null) ? tempF : tempC;
                                  const sameUnit = (isF && fc?.temp_max_f != null && tempF != null) || (!isF);
                                  const err = val != null && actual != null && sameUnit ? +((val - actual).toFixed(1)) : null;
                                  const histMae = maeByModelHorizon[`${model}|${h}`];
                                  const histMaeColor = histMae != null ? (histMae <= 1.5 ? "#4ade80" : histMae <= 2.5 ? "#fbbf24" : "#f87171") : undefined;
                                  return (
                                    <React.Fragment key={`h${h}`}>
                                      <td style={{ padding: "6px 8px", textAlign: "center", borderLeft: "1px solid #1e293b", verticalAlign: "middle" }}>
                                        <div style={{ color: val != null ? "#e2e8f0" : "#334155" }}>
                                          {val != null ? `${val.toFixed(1)}\u00b0` : "\u2014"}
                                        </div>
                                        {histMae != null && (
                                          <div style={{ fontSize: 9, color: histMaeColor, marginTop: 2, opacity: 0.8 }}>
                                            MAE {histMae.toFixed(1)}&deg;
                                          </div>
                                        )}
                                      </td>
                                      <td style={{ padding: "6px 6px", textAlign: "center", color: errColor(err), fontWeight: 700, fontSize: 11, verticalAlign: "top" }}>
                                        {fmtErr(err)}
                                      </td>
                                    </React.Fragment>
                                  );
                                })}
                                {(() => {
                                  const isF = selectedEvent?.station === "KLGA";
                                  const actual = (isF && tempF != null) ? tempF : tempC;
                                  return (
                                    <td style={{ padding: "10px 8px", textAlign: "center", color: "#fbbf24", fontWeight: 700, borderLeft: "1px solid #1e293b" }}>
                                      {actual != null ? `${actual.toFixed(1)}\u00b0` : "\u2014"}
                                    </td>
                                  );
                                })()}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
