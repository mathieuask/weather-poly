"use client";

import { useEffect, useState } from "react";

interface Trade {
  id: string;
  date_added: string;
  city: string;
  event_title: string;
  question: string;
  bracket: string;
  direction: "YES" | "NO";
  entry_price: number;
  gfs_prob: number;
  market_prob: number;
  edge: number;
  amount: number;
  result: "pending" | "win" | "loss";
  pnl: number | null;
  poly_url: string;
  wunderground: string;
  resolve_date: string;
  gfs_min: number;
  gfs_max: number;
  gfs_mean: number;
  gfs_unit: string;
}

const STORAGE_KEY = "weather_arb_trades";

function loadTrades(): Trade[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveTrades(trades: Trade[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
}

function DirectionBadge({ direction }: { direction: "YES" | "NO" }) {
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
      direction === "YES" ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"
    }`}>{direction}</span>
  );
}

function StatusBadge({ result }: { result: Trade["result"] }) {
  if (result === "pending") return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">En cours</span>;
  if (result === "win") return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✓ Gagné</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">✗ Perdu</span>;
}

export default function Results() {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    setTrades(loadTrades());
    // sync au focus (si on switch page)
    const onFocus = () => setTrades(loadTrades());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const update = (updated: Trade[]) => {
    setTrades(updated);
    saveTrades(updated);
  };

  const setResult = (id: string, result: "win" | "loss") => {
    update(trades.map(t => {
      if (t.id !== id) return t;
      const payout = result === "win" ? Math.round(t.amount / t.entry_price * 100) / 100 : 0;
      const pnl = Math.round((payout - t.amount) * 100) / 100;
      return { ...t, result, pnl };
    }));
  };

  const removeTrade = (id: string) => update(trades.filter(t => t.id !== id));

  const total_invested = trades.reduce((s, t) => s + t.amount, 0);
  const closed = trades.filter(t => t.result !== "pending");
  const total_pnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const wins = trades.filter(t => t.result === "win").length;
  const losses = trades.filter(t => t.result === "loss").length;
  const pending = trades.filter(t => t.result === "pending").length;
  const wr = wins + losses > 0 ? Math.round(wins / (wins + losses) * 100) : null;
  const roi = total_invested > 0 ? Math.round(total_pnl / total_invested * 1000) / 10 : null;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">📋 Résultats</h1>
        <p className="text-xs text-gray-400 mt-0.5">Paper trading — suivi des positions</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {[
          { label: "Investi", value: `$${total_invested.toFixed(0)}` },
          {
            label: "PnL total",
            value: `${total_pnl >= 0 ? "+" : ""}$${total_pnl.toFixed(2)}`,
            color: total_pnl > 0 ? "text-green-600" : total_pnl < 0 ? "text-red-500" : "text-gray-900"
          },
          { label: "Win rate", value: wr !== null ? `${wr}%` : "—" },
          { label: "ROI", value: roi !== null ? `${roi > 0 ? "+" : ""}${roi}%` : "—",
            color: roi && roi > 0 ? "text-green-600" : roi && roi < 0 ? "text-red-500" : "text-gray-900" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className={`text-lg font-bold ${s.color ?? "text-gray-900"}`}>{s.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Counts */}
      {trades.length > 0 && (
        <div className="flex gap-2 mb-4 text-xs text-gray-500">
          <span>{trades.length} pari{trades.length > 1 ? "s" : ""}</span>
          <span>·</span>
          <span className="text-yellow-600">{pending} en cours</span>
          <span>·</span>
          <span className="text-green-600">{wins} gagnés</span>
          <span>·</span>
          <span className="text-red-500">{losses} perdus</span>
        </div>
      )}

      {/* Liste */}
      {trades.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-sm">Aucun pari enregistré</p>
          <p className="text-xs mt-1">Utilise "+ Suivre" depuis la page Signaux</p>
        </div>
      ) : (
        <div className="space-y-3">
          {trades.map((t) => (
            <div key={t.id} className={`bg-white rounded-xl border p-4 ${
              t.result === "win" ? "border-green-200" :
              t.result === "loss" ? "border-red-200" :
              "border-gray-200"
            }`}>
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-gray-900">{t.city}</span>
                  <DirectionBadge direction={t.direction} />
                  <StatusBadge result={t.result} />
                </div>
                <div className="text-right shrink-0">
                  {t.result !== "pending" ? (
                    <div className={`text-base font-bold ${t.pnl! >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {t.pnl! >= 0 ? "+" : ""}${t.pnl!.toFixed(2)}
                    </div>
                  ) : (
                    <div className="text-sm font-semibold text-gray-400">${t.amount.toFixed(0)} misé</div>
                  )}
                </div>
              </div>

              {/* Titre */}
              {t.event_title && (
                <div className="text-sm font-semibold text-gray-700 mt-1">{t.event_title}</div>
              )}
              <div className="text-xs text-gray-400 mt-0.5">{t.question}</div>

              {/* GFS + marché */}
              <div className="flex gap-4 mt-2">
                <div className="text-center">
                  <div className="text-xs text-gray-400">Modèle GFS</div>
                  <div className="text-sm font-bold text-blue-700">{t.gfs_prob.toFixed(0)}%</div>
                  {t.gfs_min !== undefined && (
                    <div className="text-xs text-blue-500">{t.gfs_min}→{t.gfs_mean}→{t.gfs_max}{t.gfs_unit}</div>
                  )}
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400">Marché</div>
                  <div className="text-sm font-bold text-gray-700">{t.market_prob.toFixed(0)}%</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400">Edge</div>
                  <div className={`text-sm font-bold ${t.edge > 0 ? "text-green-600" : "text-red-500"}`}>
                    {t.edge > 0 ? "+" : ""}{t.edge.toFixed(1)}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400">Entrée</div>
                  <div className="text-sm font-bold text-gray-700">{(t.entry_price * 100).toFixed(1)}¢</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400">Résout</div>
                  <div className="text-xs font-medium text-gray-600">
                    {new Date(t.resolve_date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-3">
                  {t.poly_url && (
                    <a href={t.poly_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-medium text-blue-600 hover:underline">Polymarket →</a>
                  )}
                  <a href={t.wunderground} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:underline">Wunderground</a>
                </div>
                {t.result === "pending" ? (
                  <div className="flex gap-1">
                    <button onClick={() => setResult(t.id, "win")}
                      className="text-xs px-3 py-1 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 font-medium">
                      ✓ Gagné
                    </button>
                    <button onClick={() => setResult(t.id, "loss")}
                      className="text-xs px-3 py-1 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 font-medium">
                      ✗ Perdu
                    </button>
                    <button onClick={() => removeTrade(t.id)}
                      className="text-xs px-2 py-1 rounded-lg text-gray-300 hover:text-red-400">
                      ✕
                    </button>
                  </div>
                ) : (
                  <button onClick={() => removeTrade(t.id)}
                    className="text-xs text-gray-300 hover:text-red-400">supprimer</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
