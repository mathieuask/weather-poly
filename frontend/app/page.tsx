"use client";

import { useEffect, useRef, useState } from "react";


interface BracketContext {
  label: string;
  temp: number;
  op: string;
  p_yes: number;
  liquidity: number;
}

interface Signal {
  city: string;
  date: string;
  bracket: string;
  direction: "YES" | "NO";
  condition_id: string;
  gfs_prob: number;
  market_prob: number;
  edge: number;
  entry_price: number;
  payout: number;
  ev: number;
  liquidity: number;
  question: string;
  event_title: string;
  wunderground: string;
  poly_url: string;
  all_brackets: BracketContext[];
  gfs_min: number;
  gfs_max: number;
  gfs_mean: number;
  gfs_unit: string;
  gfs_members: number;
  gfs_values: number[];
  windy_url: string;
}

interface ScanResult {
  generated_at: string;
  total_signals: number;
  signals: Signal[];
}

const PAGE_SIZE = 10;

function EdgeBadge({ edge }: { edge: number }) {
  const abs = Math.abs(edge);
  const color =
    abs >= 20 ? "bg-green-500" : abs >= 10 ? "bg-yellow-500" : "bg-gray-400";
  return (
    <span className={`${color} text-white text-xs font-bold px-2 py-0.5 rounded`}>
      {edge > 0 ? "+" : ""}{edge.toFixed(1)}%
    </span>
  );
}

function DirectionBadge({ direction }: { direction: "YES" | "NO" }) {
  return (
    <span className={`font-bold text-sm px-2 py-0.5 rounded ${
      direction === "YES" ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"
    }`}>
      {direction}
    </span>
  );
}

function ProbBar({ gfs, market }: { gfs: number; market: number }) {
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-14 text-gray-500">Modèles</span>
        <div className="flex-1 bg-gray-100 rounded-full h-2">
          <div className="bg-blue-400 h-2 rounded-full transition-all" style={{ width: `${gfs}%` }} />
        </div>
        <span className="w-8 text-right font-mono text-gray-700">{gfs.toFixed(0)}%</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="w-14 text-gray-500">Marché</span>
        <div className="flex-1 bg-gray-100 rounded-full h-2">
          <div className="bg-orange-400 h-2 rounded-full transition-all" style={{ width: `${market}%` }} />
        </div>
        <span className="w-8 text-right font-mono text-gray-700">{market.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function GfsModal({ s, onClose }: { s: Signal; onClose: () => void }) {
  const vals = s.gfs_values ?? [];
  const counts: Record<number, number> = {};
  vals.forEach(v => { counts[v] = (counts[v] ?? 0) + 1; });
  const uniq = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const maxCount = Math.max(...Object.values(counts));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-bold text-gray-900">{s.city} — GFS Ensemble</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.gfs_members} membres · {new Date(s.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-light">✕</button>
        </div>

        {/* Stats */}
        <div className="flex gap-4 mb-4 text-center">
          {[
            { label: "Min", value: `${s.gfs_min}${s.gfs_unit}` },
            { label: "Moyenne", value: `${s.gfs_mean}${s.gfs_unit}`, bold: true },
            { label: "Max", value: `${s.gfs_max}${s.gfs_unit}` },
          ].map(st => (
            <div key={st.label} className="flex-1 bg-blue-50 rounded-xl py-2">
              <div className={`text-sm ${st.bold ? "font-bold text-blue-700" : "font-medium text-blue-600"}`}>{st.value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{st.label}</div>
            </div>
          ))}
        </div>

        {/* Histogramme */}
        <div className="space-y-1.5">
          {uniq.map(temp => {
            const count = counts[temp];
            const pct = Math.round(count / maxCount * 100);
            const isBracket = s.bracket.includes(`${temp}`);
            return (
              <div key={temp} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14 text-right shrink-0">{temp}{s.gfs_unit}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${isBracket ? "bg-blue-500" : "bg-gray-300"}`}
                    style={{ width: `${pct}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700">
                    {count} modèle{count > 1 ? "s" : ""}
                  </span>
                </div>
                <span className="text-xs text-gray-400 w-8 shrink-0">{Math.round(count / s.gfs_members * 100)}%</span>
              </div>
            );
          })}
        </div>

        {/* Bracket cible */}
        <div className="mt-4 p-3 rounded-xl bg-gray-50 text-xs text-gray-500">
          Bracket cible : <span className="font-semibold text-gray-800">{s.bracket}</span>
          {" "}→ GFS <span className="font-bold text-blue-600">{s.gfs_prob.toFixed(0)}%</span>
          {" "}vs marché <span className="font-bold text-gray-700">{s.market_prob.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

function SignalCard({ s }: { s: Signal }) {
  const [showGfs, setShowGfs] = useState(false);

  return (
    <>
      {showGfs && <GfsModal s={s} onClose={() => setShowGfs(false)} />}
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-gray-900">{s.city}</span>
            <DirectionBadge direction={s.direction} />
            <EdgeBadge edge={s.edge} />
          </div>
          {s.event_title && (
            <div className="text-sm text-gray-700 mt-0.5 font-semibold">{s.event_title}</div>
          )}
          <div className="text-xs text-gray-400 mt-0.5">{s.question}</div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs text-gray-400">
              {new Date(s.date).toLocaleDateString("fr-FR", {
                weekday: "long", day: "numeric", month: "long", timeZone: "UTC"
              })}
            </span>
            <span className="text-xs text-gray-400">·</span>
            <span className="flex items-center gap-1.5">
              <button
                onClick={() => setShowGfs(true)}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
              >
                GFS {s.gfs_members} modèles : {s.gfs_min}{s.gfs_unit} → {s.gfs_mean}{s.gfs_unit} → {s.gfs_max}{s.gfs_unit}
              </button>
              {s.windy_url && (
                <a href={s.windy_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-600" title="Voir sur Windy.com">
                  🌬️
                </a>
              )}
            </span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-400">liq ${s.liquidity.toLocaleString()}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-sm font-bold text-gray-900">
            {(s.entry_price * 100).toFixed(1)}¢
          </div>
          <div className="text-xs text-gray-400">entrée</div>
        </div>
      </div>

      <ProbBar gfs={s.gfs_prob} market={s.market_prob} />

      {/* Distribution complète des brackets */}
      {s.all_brackets && s.all_brackets.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <div className="text-xs text-gray-400 mb-1.5">Distribution du marché</div>
          <div className="flex flex-wrap gap-1">
            {s.all_brackets.map((b, i) => {
              const isTarget = b.label === s.bracket;
              const hasLiq = b.liquidity > 0;
              return (
                <div key={i} className={`text-xs px-2 py-0.5 rounded border ${
                  isTarget
                    ? "border-blue-400 bg-blue-50 font-bold text-blue-700"
                    : hasLiq
                    ? "border-gray-200 bg-white text-gray-600"
                    : "border-dashed border-gray-200 text-gray-300"
                }`}>
                  {b.label}
                  {hasLiq && <span className="ml-1 text-gray-400">{b.p_yes.toFixed(0)}%</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-3 items-center">
          {s.poly_url && (
            <a href={s.poly_url} target="_blank" rel="noopener noreferrer"
              className="text-xs font-medium text-blue-600 hover:underline">
              Polymarket →
            </a>
          )}
          <a href={s.wunderground} target="_blank" rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:underline">
            Wunderground
          </a>
          <span className="text-xs text-gray-400">
            EV <span className={s.ev > 0 ? "text-green-600 font-medium" : "text-red-500"}>
              {s.ev > 0 ? "+" : ""}{s.ev.toFixed(3)}
            </span>
          </span>
        </div>

      </div>
    </div>
    </>
  );
}

export default function Home() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "YES" | "NO">("ALL");
  const [minEdge, setMinEdge] = useState(10);
  const [dateFilter, setDateFilter] = useState<string>("ALL");
  const [cityFilter, setCityFilter] = useState<string>("ALL");
  const [hideResolved, setHideResolved] = useState(true);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const loaderRef = useRef<HTMLDivElement>(null);

  const SIGNALS_URL =
    process.env.NEXT_PUBLIC_SIGNALS_URL ||
    "https://raw.githubusercontent.com/mathieuask/weather-poly/master/frontend/public/signals.json";

  const loadData = () => {
    setLoading(true);
    fetch(SIGNALS_URL + "?t=" + Date.now()) // cache-bust
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  // Reset displayCount quand les filtres changent
  useEffect(() => { setDisplayCount(PAGE_SIZE); }, [filter, minEdge, dateFilter, cityFilter, hideResolved]);

  // IntersectionObserver pour charger plus en scrollant
  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayCount((c) => c + PAGE_SIZE);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const allDates = [...new Set((data?.signals ?? []).map((s) => s.date))].sort();
  const allCities = [...new Set((data?.signals ?? []).map((s) => s.city))].sort();

  const filtered = (data?.signals ?? []).filter((s) => {
    if (filter !== "ALL" && s.direction !== filter) return false;
    if (Math.abs(s.edge) < minEdge) return false;
    if (dateFilter !== "ALL" && s.date !== dateFilter) return false;
    if (cityFilter !== "ALL" && s.city !== cityFilter) return false;
    if (hideResolved && (s.market_prob <= 1 || s.market_prob >= 99)) return false;
    return true;
  });

  const visible = filtered.slice(0, displayCount);
  const hasMore = displayCount < filtered.length;

  const generatedAt = data?.generated_at
    ? new Date(data.generated_at).toLocaleTimeString("fr-FR", {
        hour: "2-digit", minute: "2-digit", timeZone: "UTC",
      }) + " UTC"
    : null;

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">🌤 Weather Arb</h1>
            <p className="text-sm text-gray-500">
              Polymarket × GFS — {loading ? "chargement..." : generatedAt ?? "—"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadData}
              className="text-sm text-blue-500 hover:text-blue-700 transition-colors">
              ↻ Actualiser
            </button>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900">{filtered.length}</div>
              <div className="text-xs text-gray-500">signaux</div>
            </div>
          </div>
        </div>

        {/* Filtres */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {/* Direction */}
          <div className="flex gap-1 bg-white border rounded-lg p-1">
            {(["ALL", "YES", "NO"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  filter === f ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"
                }`}>
                {f}
              </button>
            ))}
          </div>

          {/* Edge min */}
          <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1">
            <span className="text-sm text-gray-500">Edge</span>
            <select value={minEdge} onChange={(e) => setMinEdge(Number(e.target.value))}
              className="text-sm font-medium text-gray-900 bg-transparent outline-none">
              {[5, 10, 15, 20, 30].map((v) => (
                <option key={v} value={v}>{v}%</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1">
            <span className="text-sm text-gray-500">Date</span>
            <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
              className="text-sm font-medium text-gray-900 bg-transparent outline-none">
              <option value="ALL">Toutes</option>
              {allDates.map((d) => (
                <option key={d} value={d}>
                  {new Date(d).toLocaleDateString("fr-FR", {
                    day: "numeric", month: "short", timeZone: "UTC"
                  })}
                </option>
              ))}
            </select>
          </div>

          {/* Ville */}
          <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1">
            <span className="text-sm text-gray-500">Ville</span>
            <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}
              className="text-sm font-medium text-gray-900 bg-transparent outline-none">
              <option value="ALL">Toutes</option>
              {allCities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Toggle résolus */}
          <button onClick={() => setHideResolved(!hideResolved)}
            className={`flex items-center gap-2 px-3 py-1 rounded-lg border text-sm font-medium transition-colors ${
              hideResolved
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-500 border-gray-200 hover:text-gray-900"
            }`}>
            {hideResolved ? "0/100% masqués" : "Tout afficher"}
          </button>
        </div>

        {/* Légende */}
        <div className="flex gap-4 text-xs text-gray-400 mb-4">
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-full bg-blue-400 inline-block" /> GFS (30 modèles)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-full bg-orange-400 inline-block" /> Marché Polymarket
          </span>
        </div>

        {/* Liste */}
        {loading && (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            Aucun signal avec edge ≥ {minEdge}%
          </div>
        )}

        <div className="space-y-3">
          {visible.map((s, i) => <SignalCard key={i} s={s} />)}
        </div>

        {/* Sentinel pour IntersectionObserver */}
        <div ref={loaderRef} className="py-4 text-center text-xs text-gray-400">
          {hasMore
            ? `Affichage ${visible.length} / ${filtered.length} — scroll pour charger plus`
            : filtered.length > 0
            ? `${filtered.length} signaux au total`
            : ""}
        </div>

      </div>
    </main>
  );
}
