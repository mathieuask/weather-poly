"use client";

import { useEffect, useRef, useState } from "react";

const RESULTS_URL = `https://raw.githubusercontent.com/mathieuask/weather-poly/master/frontend/public/results.json`;

interface Trade {
  condition_id: string;
  city: string;
  date: string;
  bracket: string;
  direction: "YES" | "NO";
  gfs_prob: number;
  market_prob: number;
  edge: number;
  entry_price: number;
  amount: number;
  result: "pending" | "win" | "loss";
  pnl: number | null;
  question: string;
  event_title: string;
  poly_url: string;
  wunderground: string;
}

interface Stats {
  total_trades: number;
  pending: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  total_pnl: number;
  roi: number | null;
  paper_amount: number;
}

interface Results {
  updated_at: string;
  stats: Stats;
  city_stats: Record<string, { wins: number; losses: number; pnl: number }>;
  trades: Trade[];
}

const PAGE_SIZE = 20;

export default function ResultsPage() {
  const [data, setData]         = useState<Results | null>(null);
  const [loading, setLoading]   = useState(true);
  const [dirFilter, setDir]     = useState<"ALL" | "YES" | "NO">("ALL");
  const [resultFilter, setRes]  = useState<"all" | "pending" | "win" | "loss">("all");
  const [edgeMin, setEdge]      = useState(5);
  const [dateFilter, setDate]   = useState("ALL");
  const [cityFilter, setCity]   = useState("ALL");
  const [page, setPage]         = useState(1);
  const loaderRef               = useRef<HTMLDivElement>(null);

  const load = () => {
    setLoading(true);
    fetch(`${RESULTS_URL}?t=${Date.now()}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [dirFilter, resultFilter, edgeMin, dateFilter, cityFilter]);

  // Infinite scroll
  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setPage(p => p + 1);
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [data]);

  if (loading) return <div className="p-8 text-gray-400 text-sm text-center">Chargement...</div>;
  if (!data)   return <div className="p-8 text-red-400 text-sm text-center">Erreur de chargement</div>;

  const { stats, trades, updated_at } = data;

  const allDates  = [...new Set(trades.map(t => t.date))].sort();
  const allCities = [...new Set(trades.map(t => t.city))].sort();

  const filtered = trades.filter(t => {
    if (dirFilter !== "ALL" && t.direction !== dirFilter) return false;
    if (resultFilter !== "all" && t.result !== resultFilter) return false;
    if (Math.abs(t.edge) < edgeMin) return false;
    if (dateFilter !== "ALL" && t.date !== dateFilter) return false;
    if (cityFilter !== "ALL" && t.city !== cityFilter) return false;
    return true;
  });

  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = filtered.length > visible.length;

  return (
    <main className="min-h-screen p-4 md:p-8" style={{ background: "#f3f4f6" }}>
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">📋 Résultats</h1>
            <p className="text-sm text-gray-500">
              Paper trading ${stats.paper_amount}/trade · {updated_at.slice(0,16).replace("T"," ")} UTC
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={load} className="text-sm text-blue-500 hover:text-blue-700 transition-colors">
              ↻ Actualiser
            </button>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900">{stats.total_trades}</div>
              <div className="text-xs text-gray-500">trades</div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mb-6">
          {[
            { label: "Win rate", value: stats.win_rate !== null ? `${stats.win_rate}%` : "—" },
            { label: "Gagnés",   value: `${stats.wins}` },
            { label: "Perdus",   value: `${stats.losses}` },
            {
              label: "PnL",
              value: `${stats.total_pnl >= 0 ? "+" : ""}$${stats.total_pnl.toFixed(2)}`,
              color: stats.total_pnl > 0 ? "text-green-600" : stats.total_pnl < 0 ? "text-red-500" : "text-gray-900"
            },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
              <div className={`text-lg font-bold ${s.color ?? "text-gray-900"}`}>{s.value}</div>
              <div className="text-xs text-gray-400">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filtres — même style que signals */}
        <div className="flex gap-2 mb-6 flex-wrap">

          {/* Direction */}
          <div className="flex gap-1 bg-white border rounded-lg p-1">
            {(["ALL","YES","NO"] as const).map(f => (
              <button key={f} onClick={() => setDir(f)}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  dirFilter === f ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"
                }`}>{f}</button>
            ))}
          </div>

          {/* Résultat */}
          <div className="flex gap-1 bg-white border rounded-lg p-1">
            {([["all","Tous"],["pending","⏳"],["win","✅"],["loss","❌"]] as const).map(([v,l]) => (
              <button key={v} onClick={() => setRes(v)}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  resultFilter === v ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"
                }`}>{l}</button>
            ))}
          </div>

          {/* Edge */}
          <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1">
            <span className="text-sm text-gray-500">Edge</span>
            <select value={edgeMin} onChange={e => setEdge(Number(e.target.value))}
              className="text-sm font-medium text-gray-900 bg-transparent outline-none">
              {[0,5,10,15,20,30].map(v => (
                <option key={v} value={v}>{v === 0 ? "Tous" : `${v}%`}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1">
            <span className="text-sm text-gray-500">Date</span>
            <select value={dateFilter} onChange={e => setDate(e.target.value)}
              className="text-sm font-medium text-gray-900 bg-transparent outline-none">
              <option value="ALL">Toutes</option>
              {allDates.map(d => (
                <option key={d} value={d}>
                  {new Date(d).toLocaleDateString("fr-FR", { day:"numeric", month:"short", timeZone:"UTC" })}
                </option>
              ))}
            </select>
          </div>

          {/* Ville */}
          <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1">
            <span className="text-sm text-gray-500">Ville</span>
            <select value={cityFilter} onChange={e => setCity(e.target.value)}
              className="text-sm font-medium text-gray-900 bg-transparent outline-none">
              <option value="ALL">Toutes</option>
              {allCities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Légende */}
        <div className="flex gap-4 text-xs text-gray-400 mb-4">
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-full bg-blue-400 inline-block" /> GFS Modèles
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-full bg-orange-400 inline-block" /> Marché Polymarket
          </span>
        </div>

        {/* Compteur */}
        {!loading && (
          <div className="text-xs text-gray-400 mb-3">
            {visible.length} / {filtered.length} trades affichés
          </div>
        )}

        {/* Liste */}
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">Aucun trade avec ces filtres</div>
        ) : (
          <div className="space-y-3">
            {visible.map(t => (
              <div key={t.condition_id} className={`bg-white rounded-xl border p-4 shadow-sm ${
                t.result === "win" ? "border-green-200" :
                t.result === "loss" ? "border-red-200" : "border-gray-200"
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900">{t.city}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        t.direction === "YES" ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"
                      }`}>{t.direction}</span>
                      {t.result === "pending"
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">⏳ En cours</span>
                        : t.result === "win"
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✅ Gagné</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">❌ Perdu</span>
                      }
                    </div>
                    {t.event_title && <div className="text-sm font-semibold text-gray-700 mt-0.5">{t.event_title}</div>}
                    <div className="text-xs text-gray-400 mt-0.5">{t.bracket}</div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-gray-400">
                        {new Date(t.date).toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", timeZone:"UTC" })}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {t.result !== "pending" && t.pnl !== null ? (
                      <div className={`text-lg font-bold ${t.pnl >= 0 ? "text-green-600" : "text-red-500"}`}>
                        {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                      </div>
                    ) : (
                      <div className="text-sm font-bold text-gray-400">${t.amount}</div>
                    )}
                    <div className="text-xs text-gray-400">{(t.entry_price * 100).toFixed(1)}¢</div>
                  </div>
                </div>

                {/* Barre GFS vs Marché */}
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-12 text-right shrink-0">GFS</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className="h-full bg-blue-400 rounded-full" style={{ width: `${t.gfs_prob}%` }} />
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-gray-700">
                      {t.gfs_prob.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-12 text-right shrink-0">Marché</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className="h-full bg-orange-400 rounded-full" style={{ width: `${t.market_prob}%` }} />
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-gray-700">
                      {t.market_prob.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-12 text-right shrink-0">Edge</span>
                  <span className={`font-bold ${Math.abs(t.edge) >= 15 ? (t.edge > 0 ? "text-green-600" : "text-orange-500") : "text-gray-500"}`}>
                    {t.edge > 0 ? "+" : ""}{t.edge.toFixed(1)}%
                  </span>
                </div>

                <div className="flex gap-3 mt-2 pt-2 border-t border-gray-50">
                  {t.poly_url && <a href={t.poly_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Polymarket →</a>}
                  <a href={t.wunderground} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:underline">Wunderground</a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sentinel scroll infini */}
        <div ref={loaderRef} className="py-4 text-center text-xs text-gray-400">
          {hasMore
            ? `${visible.length} / ${filtered.length} — scroll pour charger plus`
            : filtered.length > 0 ? `${filtered.length} trades au total` : ""}
        </div>
      </div>
    </main>
  );
}
