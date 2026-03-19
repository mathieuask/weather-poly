"""
autoresearch.py — Analyse autonome quotidienne
------------------------------------------------
1. Lit tracker.db + results.json
2. Calcule win rate par ville, par op (lte/gte/exact), par edge range
3. Détecte anomalies (WR trop haut/bas, biais GFS)
4. Envoie rapport Telegram à Mathieu
5. Propose ajustements (ne modifie rien sans validation)
"""

import json
import os
import sqlite3
import requests
from datetime import datetime, timezone, timedelta
from collections import defaultdict

DB_PATH      = os.path.join(os.path.dirname(__file__), "tracker.db")
RESULTS_FILE = os.path.join(os.path.dirname(__file__), "results.json")

# Telegram
TG_TOKEN  = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT   = "6853323375"

MIN_TRADES_FOR_STATS = 10  # minimum pour tirer des conclusions

def send_telegram(msg):
    if not TG_TOKEN:
        print(f"[Telegram] {msg}")
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT, "text": msg, "parse_mode": "Markdown"},
            timeout=10
        )
    except Exception as e:
        print(f"Telegram error: {e}")


def load_results():
    if not os.path.exists(RESULTS_FILE):
        return None
    with open(RESULTS_FILE) as f:
        return json.load(f)


def analyze(conn, results):
    now = datetime.now(timezone.utc)
    findings = []
    alerts = []
    proposals = []

    # ── 1. Stats globales ────────────────────────────────────────────────────
    stats = results.get("stats", {})
    total = stats.get("total_trades", 0)
    wins  = stats.get("wins", 0)
    losses = stats.get("losses", 0)
    closed = wins + losses
    pending = stats.get("pending", 0)
    wr = stats.get("win_rate")
    pnl = stats.get("total_pnl", 0)
    roi = stats.get("roi")

    findings.append(f"📊 *{total} trades* ({closed} résolus, {pending} en cours)")
    if closed >= MIN_TRADES_FOR_STATS:
        findings.append(f"Win rate : *{wr}%* | PnL : *{pnl:+.2f}$* | ROI : *{roi:+.1f}%*")
    else:
        findings.append(f"⏳ {closed}/{MIN_TRADES_FOR_STATS} trades résolus — pas encore significatif")

    # ── 2. Stats par ville ───────────────────────────────────────────────────
    city_stats = results.get("city_stats", {})
    city_report = []
    for city, cs in sorted(city_stats.items(), key=lambda x: x[1]["wins"]+x[1]["losses"], reverse=True):
        n = cs["wins"] + cs["losses"]
        if n < 5:
            continue
        cwr = round(cs["wins"] / n * 100)
        city_report.append(f"  {city}: {cwr}% WR ({cs['wins']}W/{cs['losses']}L, {cs['pnl']:+.1f}$)")
        if n >= MIN_TRADES_FOR_STATS and cwr < 40:
            alerts.append(f"🔴 *{city}* WR trop bas ({cwr}%) — GFS possiblement biaisé sur cette ville")
        elif n >= MIN_TRADES_FOR_STATS and cwr > 80:
            alerts.append(f"🟡 *{city}* WR suspect ({cwr}%) — vérifie si bug dans résolution")

    if city_report:
        findings.append("Par ville :\n" + "\n".join(city_report))

    # ── 3. Analyse par type de bracket ───────────────────────────────────────
    trades = results.get("trades", [])
    closed_trades = [t for t in trades if t["result"] != "pending"]

    endband = [t for t in closed_trades if "≤" in t["bracket"] or "≥" in t["bracket"]]
    middle  = [t for t in closed_trades if "≤" not in t["bracket"] and "≥" not in t["bracket"]]

    if len(endband) >= 5:
        eb_wr = round(sum(1 for t in endband if t["result"]=="win") / len(endband) * 100)
        findings.append(f"End-bands (≤/≥) : *{eb_wr}%* WR sur {len(endband)} trades")
    if len(middle) >= 5:
        mid_wr = round(sum(1 for t in middle if t["result"]=="win") / len(middle) * 100)
        findings.append(f"Brackets exacts : *{mid_wr}%* WR sur {len(middle)} trades")
        if mid_wr < 40 and len(middle) >= MIN_TRADES_FOR_STATS:
            proposals.append("→ Considère filtrer les brackets exacts (milieu), garde seulement les end-bands (≤/≥)")

    # ── 4. Analyse par tranche d'edge ────────────────────────────────────────
    edge_buckets = defaultdict(list)
    for t in closed_trades:
        e = abs(t["edge"])
        if e < 15:
            bucket = "10-15%"
        elif e < 25:
            bucket = "15-25%"
        elif e < 40:
            bucket = "25-40%"
        else:
            bucket = ">40%"
        edge_buckets[bucket].append(t["result"] == "win")

    edge_report = []
    for bucket in ["10-15%", "15-25%", "25-40%", ">40%"]:
        data = edge_buckets[bucket]
        if len(data) >= 3:
            wr_e = round(sum(data) / len(data) * 100)
            edge_report.append(f"  Edge {bucket}: {wr_e}% WR ({len(data)} trades)")
    if edge_report:
        findings.append("Par edge :\n" + "\n".join(edge_report))

    # ── 5. Signaux actuels (signals.json) ────────────────────────────────────
    signals_file = os.path.join(os.path.dirname(__file__), "signals.json")
    if os.path.exists(signals_file):
        with open(signals_file) as f:
            sdata = json.load(f)
        sigs = sdata.get("signals", [])
        top3 = sigs[:3]
        if top3:
            sig_lines = []
            for s in top3:
                eb = "⭐" if s.get("is_endband") else ""
                sig_lines.append(f"  {eb}{s['city']} {s['bracket']} {s['direction']} edge={s['edge']:+.1f}% liq=${s['liquidity']:.0f}")
            findings.append(f"🎯 Top signaux actuels ({len(sigs)} total) :\n" + "\n".join(sig_lines))
        else:
            findings.append("🎯 Aucun signal actuel (seuils stricts)")

    # ── 6. Score de confiance dans le système ────────────────────────────────
    confidence = 5  # base
    if closed >= 25:
        confidence += 1
    if closed >= 50:
        confidence += 1
    if wr and 50 < wr < 80:
        confidence += 2
    if wr and (wr > 80 or wr < 35):
        confidence -= 2
    if len(alerts) > 0:
        confidence -= 1
    confidence = max(1, min(10, confidence))
    findings.append(f"Confiance système : *{confidence}/10*")

    return findings, alerts, proposals


def run():
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M UTC')}] AutoResearch démarré")

    if not os.path.exists(DB_PATH):
        send_telegram("⚠️ AutoResearch: tracker.db introuvable. Lance tracker.py d'abord.")
        return

    conn = sqlite3.connect(DB_PATH)
    results = load_results()

    if not results:
        send_telegram("⚠️ AutoResearch: results.json introuvable.")
        conn.close()
        return

    findings, alerts, proposals = analyze(conn, results)
    conn.close()

    # ── Rapport Telegram ────────────────────────────────────────────────────
    now_str = datetime.now(timezone.utc).strftime("%d/%m %H:%M UTC")
    lines = [f"🔬 *AutoResearch — {now_str}*", ""]
    lines += findings
    if alerts:
        lines += ["", "⚠️ *Alertes :*"] + alerts
    if proposals:
        lines += ["", "💡 *Propositions :*"] + proposals

    msg = "\n".join(lines)
    print(msg)
    send_telegram(msg)
    print("  ✓ AutoResearch terminé")


if __name__ == "__main__":
    run()
