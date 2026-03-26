import { useState, useEffect } from "react";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export interface City {
  name: string;
  station: string;
  flag: string;
  unit: string;
  resolution_source: string;
}

export function useCities() {
  const [cities, setCities] = useState<City[]>([]);
  useEffect(() => {
    fetch(
      `${URL}/rest/v1/cities?select=name,station,flag,unit,resolution_source&active=eq.true&order=name`,
      { headers: { apikey: KEY } }
    )
      .then((r) => r.json())
      .then(setCities)
      .catch(() => {});
  }, []);
  return cities;
}

/** Generate a stable accent color from a station code */
const ACCENT_PALETTE = [
  "#60a5fa", "#f87171", "#34d399", "#a78bfa", "#fbbf24",
  "#f472b6", "#22d3ee", "#fb923c", "#a3e635", "#818cf8",
  "#e879f9", "#38bdf8", "#fb7185", "#c084fc", "#4ade80",
];

export function stationAccent(station: string): string {
  let hash = 0;
  for (let i = 0; i < station.length; i++) {
    hash = ((hash << 5) - hash + station.charCodeAt(i)) | 0;
  }
  return ACCENT_PALETTE[Math.abs(hash) % ACCENT_PALETTE.length];
}
