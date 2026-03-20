"use client";

import { useEffect, useState } from "react";

const RESULTS_URL = `https://raw.githubusercontent.com/mathieuask/weather-poly/master/frontend/public/results.json`;

interface Trade {
  opened_at: string;
  closed_at: string | null;
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
  const [data, setData]       = useState<Results | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirFilter, setDir]   = useState<"ALL" | "YES" | "NO">("ALL");
  const [resultFilter, setRes]= useState<"all" | "pending" | "win" | "loss">("all");
  const [edgeMin, setEdge]    = useState(0);
  const [dateFilter, setDate] = useState("all");
  const [cityFilter, setCity] = useState("all");
  const [page, setPage]       = useState(1);

  const load = () => {
    setLoading(true);
    fetch(`${RESULTS_URL}?t=${Date.now()}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [dirFilter, resultFilter, edgeMin, dateFilter, cityFilter]);

  if (loading) return <div className="p-8 text-gray-400 text-sm text-center">Chargement...</div>;
  if (!data)   return <div className="p-8 text-red-400 text-sm text-center">Erreur de chargement</div>;

  const { stats, city_stats, trades, updated_at } = data;

  // Dates et villes disponibles
  const dates  = [...new Set(trades.map(t => t.date))].sort();
  const cities = [...new Set(trades.map(t => t.city))].sort();

  // Filtres
  const filtered = trades.filter(t => {
    if (dirFilter !== "ALL" && t.direction !== dirFilter) return false;
    if (resultFilter !== "all" && t.result !== resultFilter) return false;
    if (Math.abs(t.edge) < edgeMin) return false;
    if (dateFilter !== "all" && t.date !== dateFilter) return false;
    if (cityFilter !== "all" && t.city !== cityFilter) return false;
    return true;
  });

  const visible  = filtered.slice(0, page * PAGE_SIZE);
  const hasMore  = filtered.length > visible.length;

  const EDGE_OPTS = [0, 5, 10, 15, 20, 30];
  const dateLabel = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh" }} className="p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📋 Résultats</h1>
          <p className="text-sm text-gray-500">Paper trading ${stats.paper_amount}/trade · {updated_at.slice(0,16).replace("T"," ")} UTC</p>
        </div>
        <button onClick={load} className="text-sm text-blue-500 hover:text-blue-700 transition-colors">
          ↻ Actualiser
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: "Trades",   value: `${stats.total_trades}` },
          { label: "Win rate", value: stats.win_rate !== null ? `${stats.win_rate}%` : "—" },
          {
            label: "PnL",
            value: `${stats.total_pnl >= 0 ? "+" : ""}$${stats.total_pnl.toFixed(2)}`,
            color: stats.total_pnl > 0 ? "text-green-600" : stats.total_pnl < 0 ? "text-red-500" : "text-gray-900"
          },
          {
            label: "ROI",
            value: stats.roi !== null ? `${stats.roi > 0 ? "+" : ""}${stats.roi}%` : "—",
            color: stats.roi && stats.roi > 0 ? "text-green-600" : stats.roi && stats.roi < 0 ? "text-red-500" : "text-gray-900"
          },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className={`text-lg font-bold ${s.color ?? "text-gray-900"}`}>{s.value}</div>
            <div className="text-xs text-gray-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filtres — Résultat */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-3 space-y-3">

        {/* Direction */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Direction</div>
          <div className="flex gap-1.5">
            {(["ALL","YES","NO"] as const).map(d => (
              <button key={d} onClick={() => setDir(d)}
                className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                  dirFilter === d ? "bg-blue-600 text-white border-blue-600" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                }`}>{d}</button>
            ))}
          </div>
        </div>

        {/* Résultat */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Résultat</div>
          <div className="flex flex-wrap gap-1.5">
            {([["all","Tous"],["pending","⏳ En cours"],["win","✅ Gagnés"],["loss","❌ Perdus"]] as const).map(([v,l]) => (
              <button key={v} onClick={() => setRes(v)}
                className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                  resultFilter === v ? "bg-blue-600 text-white border-blue-600" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                }`}>{l}</button>
            ))}
          </div>
        </div>

        {/* Edge */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Edge min</div>
          <div className="flex flex-wrap gap-1.5">
            {EDGE_OPTS.map(e => (
              <button key={e} onClick={() => setEdge(e)}
                className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                  edgeMin === e ? "bg-blue-600 text-white border-blue-600" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                }`}>{e === 0 ? "Tous" : `${e}%`}</button>
            ))}
          </div>
        </div>

        {/* Date */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Date</div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setDate("all")}
              className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                dateFilter === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
              }`}>Toutes</button>
            {dates.map(d => (
              <button key={d} onClick={() => setDate(d)}
                className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                  dateFilter === d ? "bg-blue-600 text-white border-blue-600" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                }`}>{dateLabel(d)}</button>
            ))}
          </div>
        </div>

        {/* Ville */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Ville</div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setCity("all")}
              className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                cityFilter === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
              }`}>Toutes</button>
            {cities.map(c => (
              <button key={c} onClick={() => setCity(c)}
                className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                  cityFilter === c ? "bg-blue-600 text-white border-blue-600" : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                }`}>{c}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Compteur */}
      <div className="text-xs text-gray-400 mb-2 px-1">
        {visible.length}/{filtered.length} trades · {filtered.length !== trades.length ? `(${trades.length} total)` : ""}
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">Aucun trade avec ces filtres</div>
      ) : (
        <div className="space-y-2">
          {visible.map(t => (
            <div key={t.condition_id} className={`bg-white rounded-xl border p-3 shadow-sm ${
              t.result === "win" ? "border-green-200" :
              t.result === "loss" ? "border-red-200" : "border-gray-200"
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-gray-900 text-sm">{t.city}</span>
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
                  {t.event_title && <div className="text-xs font-medium text-gray-600 mt-0.5 truncate">{t.event_title}</div>}
                  <div className="text-xs text-gray-400 mt-0.5 truncate">{t.bracket}</div>
                  <div className="flex gap-3 mt-1.5 text-xs text-gray-400 flex-wrap">
                    <span>GFS <strong className="text-blue-600">{t.gfs_prob.toFixed(0)}%</strong></span>
                    <span>Marché <strong className="text-gray-600">{t.market_prob.toFixed(0)}%</strong></span>
                    <span>Edge <strong className={Math.abs(t.edge) >= 15 ? (t.edge > 0 ? "text-green-600" : "text-orange-500") : "text-gray-500"}>
                      {t.edge > 0 ? "+" : ""}{t.edge.toFixed(1)}%
                    </strong></span>
                    <span>{new Date(t.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {t.result !== "pending" && t.pnl !== null ? (
                    <div className={`text-base font-bold ${t.pnl >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400">${t.amount}</div>
                  )}
                  <div className="text-xs text-gray-400 mt-0.5">{(t.entry_price * 100).toFixed(1)}¢</div>
                </div>
              </div>
              <div className="flex gap-3 mt-2 pt-2 border-t border-gray-50">
                {t.poly_url && <a href={t.poly_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Polymarket →</a>}
                <a href={t.wunderground} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:underline">Wunderground</a>
              </div>
            </div>
          ))}

          {/* Load more */}
          {hasMore && (
            <button onClick={() => setPage(p => p + 1)}
              className="w-full py-3 text-sm text-blue-600 font-medium bg-white rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
              Voir plus ({filtered.length - visible.length} restants)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
