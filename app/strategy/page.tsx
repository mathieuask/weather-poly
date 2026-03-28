"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;

async function get<T = any>(path: string): Promise<T> {
  const r = await fetch(`${API}/${path}`);
  if (!r.ok) return [] as unknown as T;
  return r.json();
}

interface Cycle {
  id: number;
  cycle_number: number;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  discoveries: string | null;
  self_critique: string | null;
  next_priorities: string | null;
  prompt_changed: boolean;
  prompt_version: number;
}

interface Trade {
  id: number;
  cycle_id: number;
  placed_at: string;
  station: string;
  city: string;
  target_date: string;
  bracket_temp: number;
  bracket_op: string;
  direction: string;
  entry_price: number;
  amount: number;
  conviction: number;
  reasoning: string;
  status: string;
  exit_price: number | null;
  pnl: number | null;
}

interface Note {
  id: number;
  cycle_id: number;
  created_at: string;
  category: string;
  title: string;
  content: string;
  validated: boolean;
  source_url: string | null;
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function convictionColor(c: number) {
  if (c >= 8) return "#4ade80";
  if (c >= 5) return "#fbbf24";
  return "#f87171";
}

function pnlColor(pnl: number | null) {
  if (pnl === null) return "#64748b";
  return pnl >= 0 ? "#4ade80" : "#f87171";
}

function categoryColor(cat: string) {
  const map: Record<string, string> = {
    hypothese: "#a78bfa",
    validation: "#4ade80",
    rejet: "#f87171",
    observation: "#60a5fa",
    amelioration: "#fbbf24",
    bug: "#f97316",
  };
  return map[cat?.toLowerCase()] ?? "#64748b";
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return mobile;
}

export default function StrategyPage() {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tab, setTab] = useState<"pensee" | "trades" | "notes">("pensee");
  const [loading, setLoading] = useState(true);
  const [selectedCycle, setSelectedCycle] = useState<Cycle | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    Promise.all([
      get<Cycle[]>("agent_cycles?order=cycle_number.desc&limit=50"),
      get<Trade[]>("paper_trades?order=placed_at.desc&limit=200"),
      get<Note[]>("strategy_notes?order=created_at.desc&limit=200"),
    ]).then(([c, t, n]) => {
      setCycles(c);
      setTrades(t);
      setNotes(n);
      if (c.length > 0) setSelectedCycle(c[0]);
      setLoading(false);
    });
  }, []);

  const totalPnl = trades.filter(t => t.pnl !== null).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const openTrades = trades.filter(t => t.status === "open");
  const resolvedTrades = trades.filter(t => t.pnl !== null);
  const winRate =
    resolvedTrades.length > 0
      ? Math.round((resolvedTrades.filter(t => (t.pnl ?? 0) > 0).length / resolvedTrades.length) * 100)
      : null;

  const px = isMobile ? "12px" : "24px";

  return (
    <div style={{ background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ padding: `16px ${px}`, borderBottom: "1px solid #1e293b" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: isMobile ? 17 : 20, fontWeight: 700 }}>🤖 Agent Autonome</h1>
          {cycles.length > 0 && (
            <span style={{ fontSize: 11, color: "#475569" }}>
              Cycle #{cycles[0]?.cycle_number} · {timeAgo(cycles[0].started_at)}
            </span>
          )}
        </div>

        {/* Stats bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: isMobile ? 6 : 16, marginTop: 10 }}>
          {[
            { label: "Cycles", value: cycles.length, color: "#60a5fa" },
            { label: "Ouverts", value: openTrades.length, color: "#fbbf24" },
            { label: "Win Rate", value: winRate !== null ? `${winRate}%` : "—", color: winRate !== null ? convictionColor(winRate / 10) : "#475569" },
            { label: "PnL total", value: resolvedTrades.length > 0 ? `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}` : "—", color: pnlColor(totalPnl) },
            { label: "Notes", value: notes.length, color: "#a78bfa" },
            { label: "Prompt v", value: cycles.length > 0 ? cycles[0].prompt_version : 1, color: "#34d399" },
          ].map(s => (
            <div key={s.label} style={{ background: "#111827", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1e293b", overflowX: "auto" }}>
        {(([
          ["pensee", "🧠 Sa Pensée"],
          ["trades", "💰 Trades"],
          ["notes", "📝 Notes"],
        ] as const)).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: isMobile ? "10px 14px" : "10px 20px",
              background: "transparent",
              border: "none",
              borderBottom: tab === key ? "2px solid #60a5fa" : "2px solid transparent",
              color: tab === key ? "#60a5fa" : "#475569",
              cursor: "pointer",
              fontSize: isMobile ? 12 : 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>Chargement...</div>
      )}

      {/* SA PENSÉE */}
      {!loading && tab === "pensee" && (
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", minHeight: "calc(100vh - 200px)" }}>

          {/* Cycle selector */}
          {isMobile ? (
            /* Mobile: dropdown select */
            <div style={{ padding: "10px 12px", borderBottom: "1px solid #1e293b" }}>
              <select
                value={selectedCycle?.id ?? ""}
                onChange={e => {
                  const c = cycles.find(c => c.id === Number(e.target.value));
                  if (c) setSelectedCycle(c);
                }}
                style={{
                  width: "100%", background: "#111827", border: "1px solid #1e293b",
                  color: "#e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13,
                }}
              >
                {cycles.map(c => (
                  <option key={c.id} value={c.id}>
                    Cycle #{c.cycle_number} · {timeAgo(c.started_at)}{c.prompt_changed ? " ✏️" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            /* Desktop: sidebar */
            <div style={{ width: 220, minWidth: 220, borderRight: "1px solid #1e293b", overflowY: "auto" }}>
              {cycles.length === 0 ? (
                <div style={{ padding: 20, color: "#334155", fontSize: 13, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
                  Aucun cycle encore.<br />Premier démarrage dans moins de 20 min.
                </div>
              ) : cycles.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCycle(c)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                    background: selectedCycle?.id === c.id ? "#1e293b" : "transparent",
                    border: "none", borderBottom: "1px solid #0f172a",
                    borderLeft: selectedCycle?.id === c.id ? "3px solid #60a5fa" : "3px solid transparent",
                    color: selectedCycle?.id === c.id ? "#f1f5f9" : "#64748b",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Cycle #{c.cycle_number}</div>
                  <div style={{ fontSize: 10, color: "#334155", marginTop: 2 }}>{timeAgo(c.started_at)}</div>
                  {c.prompt_changed && <div style={{ fontSize: 9, color: "#fbbf24", marginTop: 2 }}>✏️ prompt modifié</div>}
                </button>
              ))}
            </div>
          )}

          {/* Cycle detail */}
          <div style={{ flex: 1, padding: `16px ${px}`, overflowY: "auto" }}>
            {!selectedCycle ? (
              <div style={{ color: "#334155", textAlign: "center", marginTop: 60 }}>Sélectionne un cycle</div>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>
                  <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 18, fontWeight: 700 }}>Cycle #{selectedCycle.cycle_number}</h2>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
                    {new Date(selectedCycle.started_at).toLocaleString("fr-FR", { timeZone: "UTC" })} UTC
                    {selectedCycle.ended_at &&
                      ` · ${Math.round((new Date(selectedCycle.ended_at).getTime() - new Date(selectedCycle.started_at).getTime()) / 60000)}min`}
                    {selectedCycle.prompt_changed && (
                      <span style={{ marginLeft: 10, color: "#fbbf24" }}>✏️ Prompt v{selectedCycle.prompt_version}</span>
                    )}
                  </div>
                </div>

                {[
                  { label: "📋 Résumé", content: selectedCycle.summary, color: "#60a5fa" },
                  { label: "💡 Découvertes", content: selectedCycle.discoveries, color: "#4ade80" },
                  { label: "🔍 Auto-critique", content: selectedCycle.self_critique, color: "#f87171" },
                  { label: "⏭️ Priorités suivantes", content: selectedCycle.next_priorities, color: "#fbbf24" },
                ].map(({ label, content, color }) => (
                  <div
                    key={label}
                    style={{ background: "#111827", borderRadius: 10, padding: "12px 14px", marginBottom: 10, borderLeft: `3px solid ${color}` }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: isMobile ? 12 : 13, color: "#94a3b8", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {content ?? <span style={{ color: "#334155", fontStyle: "italic" }}>Rien encore</span>}
                    </div>
                  </div>
                ))}

                {/* Trades de ce cycle */}
                {trades.filter(t => t.cycle_id === selectedCycle.id).length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24", marginBottom: 8 }}>💰 Trades placés ce cycle</div>
                    {trades.filter(t => t.cycle_id === selectedCycle.id).map(t => (
                      <div
                        key={t.id}
                        style={{ background: "#111827", borderRadius: 8, padding: "10px 12px", marginBottom: 8, borderLeft: `3px solid ${t.direction === "YES" ? "#4ade80" : "#f87171"}` }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700 }}>
                            {t.city} {t.bracket_temp}° {t.direction}
                          </span>
                          <span style={{ fontSize: 11, color: pnlColor(t.pnl), flexShrink: 0 }}>
                            {t.pnl !== null ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}` : t.status.toUpperCase()}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
                          Conv. {t.conviction}/10 · @{Math.round(t.entry_price * 100)}% · ${t.amount}
                        </div>
                        {t.reasoning && (
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, fontStyle: "italic" }}>{t.reasoning}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* TRADES */}
      {!loading && tab === "trades" && (
        <div style={{ padding: `14px ${px}` }}>
          {trades.length === 0 ? (
            <div style={{ textAlign: "center", color: "#334155", padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              Aucun trade simulé
            </div>
          ) : isMobile ? (
            /* Mobile: card list */
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {trades.map(t => (
                <div
                  key={t.id}
                  style={{
                    background: "#111827", borderRadius: 10, padding: "12px 14px",
                    borderLeft: `3px solid ${t.direction === "YES" ? "#4ade80" : "#f87171"}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{t.city}</span>
                      <span style={{ fontSize: 12, color: "#64748b", marginLeft: 6 }}>{t.target_date}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: pnlColor(t.pnl) }}>
                      {t.pnl !== null ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}` : "—"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontFamily: "monospace" }}>{t.bracket_temp}°</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.direction === "YES" ? "#4ade80" : "#f87171" }}>
                      {t.direction}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: "monospace" }}>@{Math.round(t.entry_price * 100)}%</span>
                    <span style={{ fontSize: 12 }}>${t.amount}</span>
                    <span style={{ fontSize: 12, color: convictionColor(t.conviction) }}>⭐{t.conviction}/10</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                      background: t.status === "open" ? "#1e3a5f" : t.pnl && t.pnl > 0 ? "#14532d" : "#7f1d1d",
                      color: t.status === "open" ? "#60a5fa" : t.pnl && t.pnl > 0 ? "#4ade80" : "#f87171",
                    }}>
                      {t.status.toUpperCase()}
                    </span>
                  </div>
                  {t.reasoning && (
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 6, fontStyle: "italic", lineHeight: 1.4 }}>
                      {t.reasoning}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* Desktop: table */
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b", color: "#475569" }}>
                    {["Date", "Ville", "Bracket", "Dir", "Entrée", "Montant", "Conv.", "Status", "PnL", "Raisonnement"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => (
                    <tr key={t.id} style={{ borderBottom: "1px solid #0f172a" }}>
                      <td style={{ padding: "8px 10px", color: "#64748b" }}>{t.target_date}</td>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>{t.city}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{t.bracket_temp}°</td>
                      <td style={{ padding: "8px 10px", color: t.direction === "YES" ? "#4ade80" : "#f87171", fontWeight: 700 }}>{t.direction}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{Math.round(t.entry_price * 100)}%</td>
                      <td style={{ padding: "8px 10px" }}>${t.amount}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ color: convictionColor(t.conviction), fontWeight: 700 }}>{t.conviction}/10</span>
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                          background: t.status === "open" ? "#1e3a5f" : t.pnl && t.pnl > 0 ? "#14532d" : "#7f1d1d",
                          color: t.status === "open" ? "#60a5fa" : t.pnl && t.pnl > 0 ? "#4ade80" : "#f87171",
                        }}>
                          {t.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: pnlColor(t.pnl), fontFamily: "monospace" }}>
                        {t.pnl !== null ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}` : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", color: "#475569", maxWidth: 300, fontSize: 11 }}>{t.reasoning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* NOTES */}
      {!loading && tab === "notes" && (
        <div style={{ padding: `14px ${px}` }}>
          {notes.length === 0 ? (
            <div style={{ textAlign: "center", color: "#334155", padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              Aucune note de recherche encore
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {notes.map(n => (
                <div
                  key={n.id}
                  style={{
                    background: "#111827", borderRadius: 10, padding: "12px 14px",
                    borderLeft: `3px solid ${categoryColor(n.category)}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                        background: `${categoryColor(n.category)}22`, color: categoryColor(n.category),
                      }}>
                        {n.category?.toUpperCase() ?? "NOTE"}
                      </span>
                      <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, color: "#e2e8f0" }}>{n.title}</span>
                      {n.validated && <span style={{ fontSize: 10, color: "#4ade80" }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 11, color: "#334155", flexShrink: 0 }}>{timeAgo(n.created_at)}</span>
                  </div>
                  <div style={{ fontSize: isMobile ? 12 : 12, color: "#94a3b8", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {n.content}
                  </div>
                  {n.source_url && (
                    <a href={n.source_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "#60a5fa", marginTop: 6, display: "block" }}>
                      🔗 {n.source_url}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
