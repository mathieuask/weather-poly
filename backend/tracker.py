"""
tracker.py — Paper trading autonome
-------------------------------------
1. Lit les signaux du scanner (signals.json)
2. Pour chaque nouveau signal (condition_id + direction jamais vu) → crée un paper trade
3. Vérifie les marchés résolus sur Polymarket → marque win/loss
4. Exporte results.json pour le dashboard
5. Calcule les stats de performance
"""

import json
import os
import sqlite3
import subprocess
import requests
from datetime import datetime, timezone

DB_PATH      = os.path.join(os.path.dirname(__file__), "tracker.db")
SIGNALS_FILE = os.path.join(os.path.dirname(__file__), "signals.json")
RESULTS_FILE = os.path.join(os.path.dirname(__file__), "results.json")
FRONTEND_OUT = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "results.json")
PAPER_AMOUNT = 10.0   # $ simulé par trade

POLY_GAMMA = "https://gamma-api.polymarket.com"


# ─── DB SETUP ────────────────────────────────────────────────────────────────
def init_db(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS signal_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          TEXT NOT NULL,
        condition_id TEXT NOT NULL,
        city        TEXT,
        date        TEXT,
        bracket     TEXT,
        direction   TEXT,
        gfs_prob    REAL,
        market_prob REAL,
        edge        REAL,
        entry_price REAL,
        ev          REAL,
        liquidity   REAL,
        gfs_mean    REAL,
        gfs_min     REAL,
        gfs_max     REAL,
        question    TEXT,
        event_title TEXT,
        poly_url    TEXT
    );

    CREATE TABLE IF NOT EXISTS paper_trades (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        opened_at    TEXT NOT NULL,
        closed_at    TEXT,
        condition_id TEXT NOT NULL UNIQUE,
        city         TEXT,
        date         TEXT,
        bracket      TEXT,
        direction    TEXT,
        gfs_prob     REAL,
        market_prob  REAL,
        edge         REAL,
        entry_price  REAL,
        amount       REAL,
        result       TEXT DEFAULT 'pending',
        pnl          REAL,
        question     TEXT,
        event_title  TEXT,
        poly_url     TEXT,
        wunderground TEXT,
        gfs_mean     REAL,
        gfs_min      REAL,
        gfs_max      REAL,
        gfs_values   TEXT
    );

    CREATE TABLE IF NOT EXISTS resolutions (
        condition_id TEXT PRIMARY KEY,
        resolved_at  TEXT,
        outcome      TEXT,
        final_price  REAL
    );
    """)
    conn.commit()


# ─── LOG SIGNAL ──────────────────────────────────────────────────────────────
def log_signal(conn, sig, ts):
    conn.execute("""
        INSERT INTO signal_log
        (ts, condition_id, city, date, bracket, direction, gfs_prob, market_prob,
         edge, entry_price, ev, liquidity, gfs_mean, gfs_min, gfs_max, question, event_title, poly_url)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (ts, sig["condition_id"], sig["city"], sig["date"], sig["bracket"],
          sig["direction"], sig["gfs_prob"], sig["market_prob"],
          sig["edge"], sig["entry_price"], sig["ev"], sig["liquidity"],
          sig.get("gfs_mean"), sig.get("gfs_min"), sig.get("gfs_max"),
          sig.get("question"), sig.get("event_title"), sig.get("poly_url")))
    conn.commit()


# ─── CRÉE PAPER TRADE (1 fois par condition_id) ──────────────────────────────
def maybe_create_trade(conn, sig, ts):
    exists = conn.execute(
        "SELECT 1 FROM paper_trades WHERE condition_id=?", (sig["condition_id"],)
    ).fetchone()
    if exists:
        return False

    conn.execute("""
        INSERT INTO paper_trades
        (opened_at, condition_id, city, date, bracket, direction, gfs_prob, market_prob,
         edge, entry_price, amount, result, question, event_title, poly_url, wunderground,
         gfs_mean, gfs_min, gfs_max, gfs_values)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (ts, sig["condition_id"], sig["city"], sig["date"], sig["bracket"],
          sig["direction"], sig["gfs_prob"], sig["market_prob"],
          sig["edge"], sig["entry_price"], PAPER_AMOUNT, "pending",
          sig.get("question"), sig.get("event_title"), sig.get("poly_url"),
          sig.get("wunderground"), sig.get("gfs_mean"), sig.get("gfs_min"), sig.get("gfs_max"),
          json.dumps(sig.get("gfs_values", []))))
    conn.commit()
    print(f"  📝 Nouveau paper trade: {sig['city']} {sig['bracket']} {sig['direction']}")
    return True


# ─── CHECK RÉSOLUTIONS ───────────────────────────────────────────────────────
def check_resolutions(conn):
    """Vérifie les paper trades 'pending' dont la date est passée."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    pending = conn.execute(
        "SELECT condition_id, date, direction, entry_price, amount FROM paper_trades WHERE result='pending' AND date <= ?",
        (today,)
    ).fetchall()

    if not pending:
        return

    print(f"  🔍 Vérification de {len(pending)} trade(s) potentiellement résolus...")

    for condition_id, date, direction, entry_price, amount in pending:
        # Déjà en cache ?
        cached = conn.execute(
            "SELECT outcome FROM resolutions WHERE condition_id=?", (condition_id,)
        ).fetchone()

        if cached:
            outcome = cached[0]
        else:
            outcome = fetch_resolution(condition_id)
            if outcome is None:
                continue  # pas encore résolu
            ts_now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "INSERT OR REPLACE INTO resolutions (condition_id, resolved_at, outcome) VALUES (?,?,?)",
                (condition_id, ts_now, outcome)
            )
            conn.commit()

        # Calcule PnL
        win = (direction == "YES" and outcome == "YES") or (direction == "NO" and outcome == "NO")
        result = "win" if win else "loss"
        if win:
            pnl = round(amount / entry_price - amount, 2)
        else:
            pnl = -round(amount, 2)

        closed_at = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE paper_trades SET result=?, pnl=?, closed_at=? WHERE condition_id=?",
            (result, pnl, closed_at, condition_id)
        )
        conn.commit()
        emoji = "✅" if win else "❌"
        print(f"  {emoji} Résolu: {condition_id[:8]}... → {result} PnL={pnl:+.2f}$")


def fetch_resolution(condition_id):
    """
    Récupère l'outcome d'un marché résolu via l'API CLOB Polymarket.
    Le CLOB supporte le condition_id complet (32 bytes hex).
    """
    try:
        # ── 1. CLOB API (endpoint correct pour condition_id complet) ──
        r = requests.get(
            f"https://clob.polymarket.com/markets/{condition_id}",
            timeout=10
        )
        if r.status_code != 200:
            return None
        data = r.json()

        # Marché résolu quand closed=True ET les tokens ont des prices finales
        if not data.get("closed", False):
            return None

        # Prix via tokens (token YES = index 0 selon l'outcome_index)
        tokens = data.get("tokens", [])
        if tokens:
            # Cherche les last_trade_price ou price dans chaque token
            for tok in tokens:
                outcome = tok.get("outcome", "")
                price   = float(tok.get("price", 0) or 0)
                if outcome.upper() == "YES" and price >= 0.99:
                    return "YES"
                if outcome.upper() == "YES" and price <= 0.01:
                    return "NO"

        # ── 2. Fallback : Gamma API via conditionId query ──
        r2 = requests.get(
            f"{POLY_GAMMA}/markets",
            params={"conditionIds": condition_id},
            timeout=10
        )
        if r2.status_code == 200:
            markets = r2.json()
            if isinstance(markets, list):
                for m in markets:
                    if m.get("conditionId","").lower() == condition_id.lower():
                        if not m.get("resolved", False):
                            return None
                        winner = m.get("winner")
                        if winner in ("YES", "NO"):
                            return winner
                        prices = m.get("outcomePrices")
                        if isinstance(prices, str):
                            prices = json.loads(prices)
                        if prices:
                            return "YES" if float(prices[0]) > 0.5 else "NO"

    except Exception as e:
        print(f"  ⚠ fetch_resolution error: {e}")
    return None


# ─── EXPORT results.json ─────────────────────────────────────────────────────
def export_results(conn):
    trades = conn.execute("""
        SELECT opened_at, closed_at, condition_id, city, date, bracket, direction,
               gfs_prob, market_prob, edge, entry_price, amount, result, pnl,
               question, event_title, poly_url, wunderground,
               gfs_mean, gfs_min, gfs_max, gfs_values
        FROM paper_trades
        ORDER BY opened_at DESC
    """).fetchall()

    cols = ["opened_at","closed_at","condition_id","city","date","bracket","direction",
            "gfs_prob","market_prob","edge","entry_price","amount","result","pnl",
            "question","event_title","poly_url","wunderground","gfs_mean","gfs_min","gfs_max","gfs_values"]

    trades_list = []
    for row in trades:
        t = dict(zip(cols, row))
        t["gfs_values"] = json.loads(t["gfs_values"] or "[]")
        trades_list.append(t)

    # Stats globales
    closed = [t for t in trades_list if t["result"] != "pending"]
    wins   = [t for t in closed if t["result"] == "win"]
    losses = [t for t in closed if t["result"] == "loss"]
    pending_count = len([t for t in trades_list if t["result"] == "pending"])
    total_invested = len(closed) * PAPER_AMOUNT
    total_pnl = sum(t["pnl"] or 0 for t in closed)
    wr = round(len(wins) / len(closed) * 100, 1) if closed else None
    roi = round(total_pnl / total_invested * 100, 1) if total_invested > 0 else None

    # Stats par ville
    city_stats = {}
    for t in closed:
        c = t["city"]
        if c not in city_stats:
            city_stats[c] = {"wins": 0, "losses": 0, "pnl": 0}
        if t["result"] == "win":
            city_stats[c]["wins"] += 1
        else:
            city_stats[c]["losses"] += 1
        city_stats[c]["pnl"] = round(city_stats[c]["pnl"] + (t["pnl"] or 0), 2)

    results = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "stats": {
            "total_trades": len(trades_list),
            "pending": pending_count,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": wr,
            "total_invested": round(total_invested, 2),
            "total_pnl": round(total_pnl, 2),
            "roi": roi,
            "paper_amount": PAPER_AMOUNT
        },
        "city_stats": city_stats,
        "trades": trades_list
    }

    with open(RESULTS_FILE, "w") as f:
        json.dump(results, f, indent=2)
    if os.path.exists(os.path.dirname(FRONTEND_OUT)):
        import shutil
        shutil.copy(RESULTS_FILE, FRONTEND_OUT)

    print(f"  📊 {len(trades_list)} trades exportés | WR={wr}% | PnL={total_pnl:+.2f}$")
    return results


# ─── GIT PUSH ────────────────────────────────────────────────────────────────
def git_push():
    try:
        root = os.path.join(os.path.dirname(__file__), "..")
        subprocess.run(["git", "add", "-A"], cwd=root, capture_output=True)
        result = subprocess.run(
            ["git", "commit", "-m", f"tracker: update results {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"],
            cwd=root, capture_output=True, text=True
        )
        if "nothing to commit" not in result.stdout:
            subprocess.run(["git", "push"], cwd=root, capture_output=True)
    except Exception as e:
        print(f"  ⚠ git push: {e}")


# ─── MAIN ────────────────────────────────────────────────────────────────────
def run():
    ts = datetime.now(timezone.utc).isoformat()
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M UTC')}] Tracker démarré")

    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    # 1. Lit les signaux actuels
    if not os.path.exists(SIGNALS_FILE):
        print("  ⚠ signals.json introuvable — lance scanner.py d'abord")
        conn.close()
        return

    with open(SIGNALS_FILE) as f:
        data = json.load(f)
    signals = data.get("signals", [])
    print(f"  📡 {len(signals)} signaux lus")

    # 2. Log + crée paper trades
    new_trades = 0
    for sig in signals:
        if not sig.get("condition_id"):
            continue
        log_signal(conn, sig, ts)
        if maybe_create_trade(conn, sig, ts):
            new_trades += 1

    print(f"  ✅ {new_trades} nouveau(x) paper trade(s)")

    # 3. Check résolutions
    check_resolutions(conn)

    # 4. Export + push
    export_results(conn)
    git_push()

    conn.close()
    print(f"  ✓ Tracker terminé")


if __name__ == "__main__":
    run()
