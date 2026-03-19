"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const SIGNALS_URL = "https://raw.githubusercontent.com/mathieuask/weather-poly/master/frontend/public/signals.json";

interface Signal {
  condition_id: string;
  city: string;
  date: string;
  bracket: string;
  gfs_unit: string;
  gfs_mean: number;
  gfs_min: number;
  gfs_max: number;
  gfs_prob: number;
  gfs_members: number;
  gfs_values: number[];
  market_prob: number;
  edge: number;
  direction: string;
  model_str: string;
  city_confidence?: string;
}

function ModelPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const [signal, setSignal] = useState<Signal | null>(null);

  useEffect(() => {
    fetch(SIGNALS_URL)
      .then(r => r.json())
      .then((data: Signal[]) => {
        const s = data.find(x => x.condition_id === id);
        setSignal(s ?? null);
      });
  }, [id]);

  if (!signal) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-gray-400">
        <div className="text-4xl mb-3">🌤</div>
        <div className="text-sm">Chargement...</div>
      </div>
    );
  }

  const vals = signal.gfs_values ?? [];
  const counts: Record<number, number> = {};
  vals.forEach(v => {
    const k = Math.round(v);
    counts[k] = (counts[k] ?? 0) + 1;
  });
  const uniq = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const maxCount = Math.max(...Object.values(counts));
  const totalMembers = vals.length || signal.gfs_members;

  const dateStr = new Date(signal.date).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC"
  });

  const confidenceColor: Record<string, string> = {
    high: "text-green-600 bg-green-50",
    medium: "text-yellow-600 bg-yellow-50",
    low: "text-red-500 bg-red-50",
  };
  const confLabel: Record<string, string> = {
    high: "✅ Fiable",
    medium: "⚠️ Moyen",
    low: "🚨 Biais suspecté",
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <div className="font-bold text-gray-900">{signal.city} — Distribution modèles</div>
            <div className="text-xs text-gray-400 capitalize">{dateStr}</div>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

        {/* Stats */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            {signal.model_str} membres
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: "Min", value: `${signal.gfs_min}°${signal.gfs_unit}` },
              { label: "Moyenne", value: `${signal.gfs_mean}°${signal.gfs_unit}`, bold: true },
              { label: "Max", value: `${signal.gfs_max}°${signal.gfs_unit}` },
            ].map(st => (
              <div key={st.label} className="bg-blue-50 rounded-xl py-3">
                <div className={`text-base ${st.bold ? "font-bold text-blue-700" : "font-semibold text-blue-500"}`}>
                  {st.value}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{st.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Confiance */}
        {signal.city_confidence && (
          <div className={`rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2 ${confidenceColor[signal.city_confidence] ?? "text-gray-500 bg-gray-50"}`}>
            {confLabel[signal.city_confidence] ?? signal.city_confidence}
            {signal.city_confidence === "low" && (
              <span className="text-xs font-normal opacity-80">— biais GFS non encore mesuré pour cette ville</span>
            )}
          </div>
        )}

        {/* Histogramme */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Distribution des {totalMembers} membres
          </div>
          <div className="space-y-2">
            {uniq.map(temp => {
              const count = counts[temp];
              const pct = Math.round(count / maxCount * 100);
              const probPct = Math.round(count / totalMembers * 100);
              const isBracket = signal.bracket.includes(`${temp}`);
              return (
                <div key={temp} className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 w-12 text-right shrink-0 font-mono">
                    {temp}°{signal.gfs_unit}
                  </span>
                  <div className="flex-1 bg-gray-100 rounded-full h-7 relative overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isBracket ? "bg-blue-500" : "bg-gray-300"}`}
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                    <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-gray-700">
                      {count} modèle{count > 1 ? "s" : ""}
                    </span>
                  </div>
                  <span className={`text-sm font-semibold w-10 text-right shrink-0 ${isBracket ? "text-blue-600" : "text-gray-400"}`}>
                    {probPct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Signal résumé */}
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Signal</div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Bracket cible</span>
            <span className="text-sm font-semibold text-gray-800">{signal.bracket}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">GFS prédit</span>
            <span className="text-sm font-bold text-blue-600">{signal.gfs_prob.toFixed(0)}%</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Marché prix</span>
            <span className="text-sm font-bold text-gray-700">{signal.market_prob.toFixed(0)}%</span>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-gray-100">
            <span className="text-sm text-gray-500">Edge</span>
            <span className={`text-sm font-bold ${signal.edge > 0 ? "text-green-600" : "text-red-500"}`}>
              {signal.edge > 0 ? "+" : ""}{signal.edge.toFixed(1)}% → {signal.direction}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}

export default function ModelPage() {
  return (
    <Suspense fallback={<div className="text-center text-gray-400 mt-20">Chargement...</div>}>
      <ModelPageInner />
    </Suspense>
  );
}
