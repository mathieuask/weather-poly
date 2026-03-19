"use client";

import { useEffect, useState } from "react";

interface Trade {
  id: string;
  date_added: string;
  city: string;
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

export default function Results() {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    setTrades(loadTrades());
  }, []);

  const total_invested = trades.reduce((s, t) => s + t.amount, 0);
  const total_pnl = trades.filter(t => t.pnl !== null).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const wins = trades.filter(t => t.result === "win").length;
  const losses = trades.filter(t => t.result === "loss").length;
  const pending = trades.filter(t => t.result === "pending").length;
  const wr = wins + losses > 0 ? Math.round(wins / (wins + losses) * 100) : null;

  const setResult = (id: string, result: "win" | "loss") => {
    const updated = trades.map(t => {
      if (t.id !== id) return t;
      const pnl = result === "win"
        ? Math.round(t.amount * (1 / t.entry_price - 1) * 100) / 100
        : -t.amount;
      return { ...t, result, pnl };
    });
    setTrades(updated);
    saveTrades(updated);
  };

  const removeTrade = (id: string) => {
    const updated = trades.filter(t => t.id !== id);
    setTrades(updated);
    saveTrades(updated);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">📋 Résultats</h1>
        <p className="text-sm text-gray-500 mt-1">Paper trading — suivi des paris</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Investi", value: `$${total_invested.toFixed(0)}` },
          { label: "PnL total", value: `${total_pnl >= 0 ? "+" : ""}$${total_pnl.toFixed(2)}`, color: total_pnl >= 0 ? "text-green-600" : "text-red-500" },
          { label: "Win rate", value: wr !== null ? `${wr}%` : "—" },
          { label: "En cours", value: `${pending}` },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`text-xl font-bold ${s.color ?? "text-gray-900"}`}>{s.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Liste */}
      {trades.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📭</div>
          <p>Aucun pari enregistré</p>
          <p className="text-sm mt-1">Ajoute un pari depuis la page Signaux</p>
        </div>
      ) : (
        <div className="space-y-3">
          {trades.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900">{t.city}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${t.direction === "YES" ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"}`}>
                      {t.direction}
                    </span>
                    <span className="text-xs text-gray-500">{t.bracket}</span>
                  </div>
                  <div className="text-sm text-gray-600 mt-0.5">{t.question}</div>
                  <div className="flex gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                    <span>Mis ${t.amount} à {(t.entry_price * 100).toFixed(1)}¢</span>
                    <span>·</span>
                    <span>GFS {t.gfs_prob.toFixed(0)}% vs marché {t.market_prob.toFixed(0)}%</span>
                    <span>·</span>
                    <span>Résout {new Date(t.resolve_date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {t.result === "pending" ? (
                    <div className="flex gap-1">
                      <button onClick={() => setResult(t.id, "win")}
                        className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 font-medium">
                        ✓ Gagné
                      </button>
                      <button onClick={() => setResult(t.id, "loss")}
                        className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 font-medium">
                        ✗ Perdu
                      </button>
                    </div>
                  ) : (
                    <div className={`text-sm font-bold ${t.result === "win" ? "text-green-600" : "text-red-500"}`}>
                      {t.result === "win" ? "+" : ""}{t.pnl?.toFixed(2)}$
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex gap-3">
                  {t.poly_url && (
                    <a href={t.poly_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline">Polymarket →</a>
                  )}
                  <a href={t.wunderground} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:underline">Wunderground</a>
                </div>
                <button onClick={() => removeTrade(t.id)}
                  className="text-xs text-gray-300 hover:text-red-400">supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
