"use client";

import { useEffect, useState } from "react";

const RESULTS_URL = `https://raw.githubusercontent.com/mathieuask/weather-poly/master/frontend/public/results.json`;

interface CityStats {
  wins: number;
  losses: number;
  pnl: number;
}

interface Stats {
  total_trades: number;
  pending: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  total_invested: number;
  total_pnl: number;
  roi: number | null;
  paper_amount: number;
}

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
  gfs_mean: number;
  gfs_min: number;
  gfs_max: number;
  gfs_values: number[];
}

interface Results {
  updated_at: string;
  stats: Stats;
  city_stats: Record<string, CityStats>;
  trades: Trade[];
}

function DirectionBadge({ direction }: { direction: "YES" | "NO" }) {
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
      direction === "YES" ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"
    }`}>{direction}</span>
  );
}

function ResultBadge({ result }: { result: Trade["result"] }) {
  if (result === "pending") return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">⏳ En cours</span>;
  if (result === "win") return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✅ Gagné</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">❌ Perdu</span>;
}

export default function Results() {
  const [data, setData] = useState<Results | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "win" | "loss">("all");

  useEffect(() => {
    fetch(`${RESULTS_URL}?t=${Date.now()}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-400 text-sm">Chargement...</div>;
  if (!data) return <div className="p-8 text-red-400 text-sm">Erreur de chargement</div>;

  const { stats, city_stats, trades, updated_at } = data;
  const filtered = trades.filter(t => filter === "all" || t.result === filter);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">📋 Résultats</h1>
          <p className="text-xs text-gray-400 mt-0.5">Paper trading ${stats.paper_amount}/trade · {updated_at}</p>
        </div>
      </div>

      {/* Stats globales */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: "Trades", value: `${stats.total_trades}` },
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

      {/* Mini stats par ville */}
      {Object.keys(city_stats).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4">
          <div className="text-xs font-semibold text-gray-500 mb-2">Par ville</div>
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(city_stats)
              .sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses))
              .map(([city, cs]) => {
                const total = cs.wins + cs.losses;
                const wr = total > 0 ? Math.round(cs.wins / total * 100) : null;
                return (
                  <div key={city} className="text-xs bg-gray-50 rounded-lg p-2">
                    <div className="font-medium text-gray-700">{city}</div>
                    <div className="text-gray-400">{cs.wins}W / {cs.losses}L {wr !== null ? `· ${wr}%` : ""}</div>
                    <div className={cs.pnl >= 0 ? "text-green-600 font-medium" : "text-red-500 font-medium"}>
                      {cs.pnl >= 0 ? "+" : ""}${cs.pnl.toFixed(2)}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Filtres */}
      <div className="flex gap-1.5 mb-3">
        {(["all","pending","win","loss"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1 rounded-full font-medium transition-colors border ${
              filter === f
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}>
            {f === "all" ? `Tous (${trades.length})` :
             f === "pending" ? `⏳ En cours (${stats.pending})` :
             f === "win" ? `✅ Gagnés (${stats.wins})` :
             `❌ Perdus (${stats.losses})`}
          </button>
        ))}
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">Aucun trade dans cette catégorie</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(t => (
            <div key={t.condition_id} className={`bg-white rounded-xl border p-3 ${
              t.result === "win" ? "border-green-200" :
              t.result === "loss" ? "border-red-200" :
              "border-gray-200"
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-gray-900 text-sm">{t.city}</span>
                    <DirectionBadge direction={t.direction} />
                    <span className="text-xs text-gray-500">{t.bracket}</span>
                    <ResultBadge result={t.result} />
                  </div>
                  {t.event_title && <div className="text-xs font-medium text-gray-600 mt-0.5 truncate">{t.event_title}</div>}
                  <div className="flex gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                    <span>GFS <strong className="text-blue-600">{t.gfs_prob.toFixed(0)}%</strong></span>
                    <span>Marché <strong className="text-gray-600">{t.market_prob.toFixed(0)}%</strong></span>
                    <span>Edge <strong className={t.edge > 0 ? "text-green-600" : "text-red-500"}>{t.edge > 0 ? "+" : ""}{t.edge.toFixed(1)}%</strong></span>
                    <span>Entrée {(t.entry_price * 100).toFixed(1)}¢</span>
                    <span>{new Date(t.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {t.result !== "pending" && t.pnl !== null ? (
                    <div className={`text-base font-bold ${t.pnl >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400">${t.amount} misé</div>
                  )}
                </div>
              </div>
              <div className="flex gap-3 mt-2">
                {t.poly_url && <a href={t.poly_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Polymarket →</a>}
                <a href={t.wunderground} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:underline">Wunderground</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
