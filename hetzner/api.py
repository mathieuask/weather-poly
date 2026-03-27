#!/usr/bin/env python3
"""
Lightweight REST API for weather-poly frontend.
Replaces the Supabase REST API with direct PostgreSQL queries.

Runs on port 8080. Endpoints mirror the Supabase PostgREST format
so the frontend needs minimal changes.

Usage:
    pip3 install psycopg2-binary
    python3 api.py
"""

import json, os, re
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import psycopg2
import psycopg2.extras

DB_DSN = os.environ.get(
    "DATABASE_URL",
    "dbname=weatherpoly user=weatherpoly password=wp_b28a537c321173b4ed40342f host=127.0.0.1"
)

PORT = int(os.environ.get("API_PORT", "8080"))

# ── Database ────────────────────────────────────────────────

def get_conn():
    conn = psycopg2.connect(DB_DSN)
    conn.autocommit = True
    return conn


def query(sql, params=None):
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
            # Convert to plain dicts and handle dates
            result = []
            for row in rows:
                d = dict(row)
                for k, v in d.items():
                    if hasattr(v, 'isoformat'):
                        d[k] = v.isoformat() if v else None
                result.append(d)
            return result
    finally:
        conn.close()


# ── PostgREST-compatible query parser ───────────────────────

def parse_postgrest_params(table, params):
    """Parse Supabase PostgREST-style query params into SQL."""
    select_cols = params.get("select", ["*"])[0]

    where_clauses = []
    where_params = []

    order_by = ""
    limit = ""
    offset = ""

    for key, values in params.items():
        val = values[0] if values else ""

        if key == "select" or key == "":
            continue
        elif key == "order":
            parts = val.split(",")
            order_parts = []
            for p in parts:
                if ".desc" in p:
                    order_parts.append(f"{p.replace('.desc', '')} DESC")
                elif ".asc" in p:
                    order_parts.append(f"{p.replace('.asc', '')} ASC")
                else:
                    order_parts.append(p)
            order_by = f" ORDER BY {', '.join(order_parts)}"
        elif key == "limit":
            limit = f" LIMIT {int(val)}"
        elif key == "offset":
            offset = f" OFFSET {int(val)}"
        else:
            # Filter: column=op.value
            col = key
            if val.startswith("eq."):
                where_clauses.append(f"{col} = %s")
                where_params.append(val[3:])
            elif val.startswith("neq."):
                where_clauses.append(f"{col} != %s")
                where_params.append(val[4:])
            elif val.startswith("gt."):
                where_clauses.append(f"{col} > %s")
                where_params.append(val[3:])
            elif val.startswith("gte."):
                where_clauses.append(f"{col} >= %s")
                where_params.append(val[4:])
            elif val.startswith("lt."):
                where_clauses.append(f"{col} < %s")
                where_params.append(val[3:])
            elif val.startswith("lte."):
                where_clauses.append(f"{col} <= %s")
                where_params.append(val[4:])
            elif val.startswith("is."):
                v = val[3:]
                if v == "null":
                    where_clauses.append(f"{col} IS NULL")
                elif v == "true":
                    where_clauses.append(f"{col} = true")
                elif v == "false":
                    where_clauses.append(f"{col} = false")
            elif val.startswith("not.is.null"):
                where_clauses.append(f"{col} IS NOT NULL")
            elif val.startswith("in."):
                # in.(val1,val2,val3)
                inner = val[3:].strip("()")
                items = [i.strip().strip('"') for i in inner.split(",")]
                placeholders = ",".join(["%s"] * len(items))
                where_clauses.append(f"{col} IN ({placeholders})")
                where_params.extend(items)

    where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    sql = f"SELECT {select_cols} FROM {table}{where_sql}{order_by}{limit}{offset}"
    return sql, where_params


# ── HTTP Handler ────────────────────────────────────────────

ALLOWED_TABLES = {
    "cities", "poly_events", "poly_markets", "price_history",
    "daily_temps", "gfs_forecasts", "ensemble_forecasts", "model_scores"
}

class APIHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.strip("/")

        # Health check
        if path == "health":
            self._json_response({"status": "ok"})
            return

        # Remove /rest/v1/ prefix if present (Supabase compat)
        if path.startswith("rest/v1/"):
            path = path[8:]

        # Extract table name
        table = path.split("?")[0]
        if table not in ALLOWED_TABLES:
            self._json_response({"error": f"Unknown table: {table}"}, 404)
            return

        params = parse_qs(parsed.query)

        try:
            sql, sql_params = parse_postgrest_params(table, params)
            rows = query(sql, sql_params if sql_params else None)
            self._json_response(rows)
        except Exception as e:
            self._json_response({"error": str(e)}, 500)

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def _json_response(self, data, status=200):
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "apikey, Authorization, Content-Type")

    def log_message(self, format, *args):
        # Quieter logging
        pass


# ── Main ────────────────────────────────────────────────────

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), APIHandler)
    print(f"Weather-Poly API running on port {PORT}")
    print(f"Database: {DB_DSN.split('password=')[0]}...")
    server.serve_forever()
