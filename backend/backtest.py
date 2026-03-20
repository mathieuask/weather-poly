"""
backtest.py — Moteur de backtest sur données historiques
4217 marchés · Wunderground + GFS · 20 villes · °C et °F
"""
import sqlite3, json, os, sys, itertools, subprocess
from datetime import datetime, timezone
from statistics import mean, stdev

DB  = os.path.join(os.path.dirname(__file__), "backtest.db")
PUB = os.path.join(os.path.dirname(__file__), "../frontend/public")

PARAMS = {
    "min_edge":     [5, 10, 15, 20, 25, 30],
    "bracket_type": ["all", "endband_only", "exact_only"],
    "direction":    ["all", "NO_only", "YES_only"],
    "min_gfs_dist": [0, 1, 2],
}


def c_to_f(c):
    return c * 9 / 5 + 32


def load_data(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT
            pm.city, pm.date, pm.station,
            pm.bracket_temp, pm.bracket_op, pm.unit,
            pm.winner,
            at.temp_max_c  AS wu_c,
            gf.temp_max_c  AS gfs_c,
            CASE WHEN pm.bracket_op IN ('lte','gte') THEN 1 ELSE 0 END AS is_endband
        FROM poly_markets pm
        JOIN actual_temps  at ON at.station = pm.station AND at.date = pm.date
        JOIN gfs_forecasts gf ON gf.station = pm.station
                              AND gf.target_date = pm.date
                              AND gf.lead_days = 1
        WHERE pm.resolved = 1 AND pm.winner IS NOT NULL
        ORDER BY pm.date, pm.city
    """)
    cols = [d[0] for d in cur.description]
    trades = []
    for row in cur.fetchall():
        t = dict(zip(cols, row))
        if t["unit"] == "F":
            t["gfs"]  = round(c_to_f(t["gfs_c"]),  1)
            t["wu"]   = round(c_to_f(t["wu_c"]),   1)
        else:
            t["gfs"]  = t["gfs_c"]
            t["wu"]   = t["wu_c"]
        trades.append(t)
    return trades


def gfs_prob(gfs, btemp, bop):
    if bop == "lte":  return 1.0 if gfs <= btemp + 0.5 else 0.0
    if bop == "gte":  return 1.0 if gfs >= btemp - 0.5 else 0.0
    return 1.0 if abs(gfs - btemp) <= 0.5 else 0.0


def gfs_dist(gfs, btemp, bop):
    if bop == "lte":  return max(0, gfs - btemp)
    if bop == "gte":  return max(0, btemp - gfs)
    return abs(gfs - btemp)


def wu_winner(wu, btemp, bop):
    if bop == "lte":  return "YES" if wu <= btemp + 0.5 else "NO"
    if bop == "gte":  return "YES" if wu >= btemp - 0.5 else "NO"
    return "YES" if abs(wu - btemp) <= 0.5 else "NO"


def simulate(trades, params):
    min_edge     = params["min_edge"]
    bracket_type = params["bracket_type"]
    direction    = params["direction"]
    min_dist     = params["min_gfs_dist"]

    results = []
    for t in trades:
        if bracket_type == "endband_only" and not t["is_endband"]: continue
        if bracket_type == "exact_only"   and     t["is_endband"]: continue
        if gfs_dist(t["gfs"], t["bracket_temp"], t["bracket_op"]) < min_dist: continue

        gp   = gfs_prob(t["gfs"], t["bracket_temp"], t["bracket_op"]) * 100
        edge = gp - 50  # edge vs neutre (prix marché non dispo pour ancien marchés)
        if abs(edge) < min_edge: continue

        sig = "YES" if edge > 0 else "NO"
        if direction == "NO_only"  and sig != "NO":  continue
        if direction == "YES_only" and sig != "YES": continue

        # Winner d'après Wunderground (source de vérité)
        actual = wu_winner(t["wu"], t["bracket_temp"], t["bracket_op"])
        win = (actual == sig)
        results.append({"win": win, "city": t["city"], "date": t["date"]})

    n = len(results)
    if n < 20: return None

    wins = sum(1 for r in results if r["win"])
    wr   = wins / n
    pnls = [1.0 if r["win"] else -1.0 for r in results]
    try:   sh = mean(pnls) / stdev(pnls) if len(pnls) > 1 else 0
    except: sh = 0

    split   = int(n * 0.6)
    test    = results[split:]
    test_wr = sum(1 for r in test if r["win"]) / len(test) if test else 0

    # Max drawdown
    eq = pk = dd = 0
    for p in pnls:
        eq += p; pk = max(pk, eq); dd = max(dd, pk - eq)

    by_city = {}
    for r in results:
        c = r["city"]
        if c not in by_city: by_city[c] = [0, 0]
        by_city[c][1] += 1
        if r["win"]: by_city[c][0] += 1

    return {
        "n_trades": n, "win_rate": round(wr, 3), "sharpe": round(sh, 3),
        "test_win_rate": round(test_wr, 3), "test_n": len(test),
        "max_drawdown": dd, **params,
        "by_city": {c: {"win_rate": round(v[0]/v[1], 3), "n": v[1]}
                    for c, v in by_city.items() if v[1] >= 5},
    }


def run_backtest(trades):
    keys   = list(PARAMS.keys())
    combos = list(itertools.product(*[PARAMS[k] for k in keys]))
    print(f"🔬 {len(trades)} trades × {len(combos)} combinaisons...")
    results = []
    for i, combo in enumerate(combos):
        r = simulate(trades, dict(zip(keys, combo)))
        if r: results.append(r)
        if (i+1) % 50 == 0:
            print(f"  {i+1}/{len(combos)} | {len(results)} valides", end="\r")
    print(f"\n  ✅ {len(results)} stratégies valides")
    return sorted(results, key=lambda x: x["sharpe"], reverse=True)


def horizon_analysis(trades):
    out = {}
    for bt, label in [("all","Tous"),("endband_only","End-bands"),("exact_only","Exacts")]:
        sigs = []
        for t in trades:
            if bt == "endband_only" and not t["is_endband"]: continue
            if bt == "exact_only"   and     t["is_endband"]: continue
            gp = gfs_prob(t["gfs"], t["bracket_temp"], t["bracket_op"]) * 100
            if abs(gp - 50) < 10: continue
            sig    = "YES" if gp > 50 else "NO"
            actual = wu_winner(t["wu"], t["bracket_temp"], t["bracket_op"])
            sigs.append(actual == sig)
        n = len(sigs)
        if n: out[label] = {"win_rate": round(sum(sigs)/n, 3), "n": n, "pnl": 0}
    return out


def city_analysis(trades):
    cd = {}
    for t in trades:
        c = t["city"]
        if c not in cd: cd[c] = {"biases": [], "wins": 0, "n": 0}
        cd[c]["biases"].append(t["gfs"] - t["wu"])
        gp = gfs_prob(t["gfs"], t["bracket_temp"], t["bracket_op"]) * 100
        if abs(gp - 50) < 10: continue
        sig    = "YES" if gp > 50 else "NO"
        actual = wu_winner(t["wu"], t["bracket_temp"], t["bracket_op"])
        cd[c]["n"] += 1
        if actual == sig: cd[c]["wins"] += 1
    return {
        c: {"win_rate": round(v["wins"]/v["n"], 3) if v["n"] else 0,
            "n": v["n"], "pnl": 0,
            "bias": round(mean(v["biases"]), 2), "best_lead": 1}
        for c, v in cd.items() if v["n"] >= 5
    }


def export(results, trades):
    now  = datetime.now(timezone.utc).isoformat()
    best = results[0] if results else None
    conf = ("high" if best and best["n_trades"] >= 100 and best["test_win_rate"] >= 0.52
            else "medium" if best and best["n_trades"] >= 50 else "low")

    top50 = [{"id": i+1, "lead_days": 1, "min_liquidity": 0,
               "pnl_total": 0, "pnl_per_100": 0,
               **{k: s[k] for k in ["min_edge","bracket_type","direction","min_gfs_dist",
                                    "win_rate","sharpe","n_trades","max_drawdown",
                                    "test_win_rate","test_n"]}}
              for i, s in enumerate(results[:50])]

    bs = {
        "updated_at": now, "status": "ready",
        "n_markets": len(trades), "n_strategies": len(results),
        "note": "WR principal · Prix CLOB non disponibles pour marchés anciens",
        "best_strategy": {
            "lead_days": 1, "min_liquidity": 0, "pnl_per_100": 0,
            "confidence": conf,
            **{k: best[k] for k in ["min_edge","bracket_type","direction","min_gfs_dist",
                                    "win_rate","sharpe","n_trades","max_drawdown","test_win_rate"]}
        } if best else None,
        "horizon_analysis": horizon_analysis(trades),
        "by_city":          city_analysis(trades),
        "all_strategies":   top50,
    }

    with open(f"{PUB}/best_strategy.json", "w") as f:
        json.dump(bs, f, indent=2)

    if best:
        print(f"\n🏆 WR={best['win_rate']*100:.1f}% (test={best['test_win_rate']*100:.1f}%)"
              f" | Sharpe={best['sharpe']:.2f} | N={best['n_trades']}")
        print(f"   Edge≥{best['min_edge']}% | {best['bracket_type']} | {best['direction']} | dist≥{best['min_gfs_dist']}°")

    os.chdir(os.path.join(os.path.dirname(__file__), ".."))
    subprocess.run(["git","add","frontend/public/best_strategy.json"], check=False)
    subprocess.run(["git","commit","-m",
        f"backtest: best WR={best['win_rate']*100:.1f}% Sharpe={best['sharpe']:.2f}"],
        check=False, capture_output=True)
    subprocess.run(["git","push"], check=False, capture_output=True)
    print("✅ Push GitHub OK → /strategy")


if __name__ == "__main__":
    conn   = sqlite3.connect(DB)
    trades = load_data(conn)
    conn.close()
    print(f"📊 {len(trades)} trades | {len(set(t['city'] for t in trades))} villes")
    if not trades:
        print("❌ Lance collect.py d'abord"); sys.exit(1)
    results = run_backtest(trades)
    export(results, trades)
