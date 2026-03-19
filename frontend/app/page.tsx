"use client";

import { useEffect, useState } from "react";

interface Signal {
  city: string;
  date: string;
  bracket: string;
  direction: "YES" | "NO";
  gfs_prob: number;
  market_prob: number;
  edge: number;
  entry_price: number;
  payout: number;
  ev: number;
  liquidity: number;
  question: string;
  wunderground: string;
}

interface ScanResult {
  generated_at: string;
  total_signals: number;
  signals: Signal[];
}

function EdgeBadge({ edge }: { edge: number }) {
  const abs = Math.abs(edge);
  const color =
    abs >= 20 ? "bg-green-500" : abs >= 10 ? "bg-yellow-500" : "bg-gray-500";
  return (
    <span className={`${color} text-white text-xs font-bold px-2 py-0.5 rounded`}>
      {edge > 0 ? "+" : ""}
      {edge.toFixed(1)}%
    </span>
  );
}

function DirectionBadge({ direction }: { direction: "YES" | "NO" }) {
  return (
    <span
      className={`font-bold text-sm px-2 py-0.5 rounded ${
        direction === "YES"
          ? "bg-blue-100 text-blue-700"
          : "bg-red-100 text-red-700"
      }`}
    >
      {direction}
    </span>
  );
}

function ProbBar({
  gfs,
  market,
  direction,
}: {
  gfs: number;
  market: number;
  direction: "YES" | "NO";
}) {
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-14 text-gray-500">Modèles</span>
        <div className="flex-1 bg-gray-100 rounded-full h-2">
          <div
            className="bg-blue-400 h-2 rounded-full"
            style={{ width: `${gfs}%` }}
          />
        </div>
        <span className="w-8 text-right font-mono text-gray-700">
          {gfs.toFixed(0)}%
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="w-14 text-gray-500">Marché</span>
        <div className="flex-1 bg-gray-100 rounded-full h-2">
          <div
            className="bg-orange-400 h-2 rounded-full"
            style={{ width: `${market}%` }}
          />
        </div>
        <span className="w-8 text-right font-mono text-gray-700">
          {market.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [filter, setFilter] = useState<"ALL" | "YES" | "NO">("ALL");
  const [minEdge, setMinEdge] = useState(10);

  useEffect(() => {
    fetch("/api/signals")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  const signals = (data?.signals ?? []).filter((s) => {
    if (filter !== "ALL" && s.direction !== filter) return false;
    if (Math.abs(s.edge) < minEdge) return false;
    return true;
  });

  const generatedAt = data?.generated_at
    ? new Date(data.generated_at).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC"
    : null;

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      {/* Header */}
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              🌤 Weather Arb
            </h1>
            <p className="text-sm text-gray-500">
              Polymarket × GFS — {generatedAt ?? "chargement..."}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">
              {signals.length}
            </div>
            <div className="text-xs text-gray-500">signaux</div>
          </div>
        </div>

        {/* Filtres */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <div className="flex gap-1 bg-white border rounded-lg p-1">
            {(["ALL", "YES", "NO"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  filter === f
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1">
            <span className="text-sm text-gray-500">Edge min</span>
            <select
              value={minEdge}
              onChange={(e) => setMinEdge(Number(e.target.value))}
              className="text-sm font-medium text-gray-900 bg-transparent outline-none"
            >
              {[5, 10, 15, 20, 30].map((v) => (
                <option key={v} value={v}>
                  {v}%
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Légende */}
        <div className="flex gap-4 text-xs text-gray-500 mb-4">
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-full bg-blue-400 inline-block" />{" "}
            GFS (30 modèles)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-full bg-orange-400 inline-block" />{" "}
            Marché Polymarket
          </span>
        </div>

        {/* Signaux */}
        {!data && (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        )}

        <div className="space-y-3">
          {signals.map((s, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900">{s.city}</span>
                    <span className="text-gray-400 text-sm">·</span>
                    <span className="font-mono text-sm text-gray-700">
                      {s.bracket}
                    </span>
                    <DirectionBadge direction={s.direction} />
                    <EdgeBadge edge={s.edge} />
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(s.date).toLocaleDateString("fr-FR", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    · liq ${s.liquidity.toLocaleString()}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono text-sm font-bold text-gray-900">
                    {s.entry_price.toFixed(2)}¢
                  </div>
                  <div className="text-xs text-gray-400">entrée</div>
                </div>
              </div>

              <ProbBar
                gfs={s.gfs_prob}
                market={s.market_prob}
                direction={s.direction}
              />

              <div className="mt-3 flex items-center justify-between">
                <a
                  href={s.wunderground}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline"
                >
                  Wunderground →
                </a>
                <span className="text-xs text-gray-400">
                  EV{" "}
                  <span
                    className={
                      s.ev > 0 ? "text-green-600 font-medium" : "text-red-500"
                    }
                  >
                    {s.ev > 0 ? "+" : ""}
                    {s.ev.toFixed(3)}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>

        {signals.length === 0 && data && (
          <div className="text-center py-12 text-gray-400">
            Aucun signal avec edge ≥ {minEdge}%
          </div>
        )}
      </div>
    </main>
  );
}
