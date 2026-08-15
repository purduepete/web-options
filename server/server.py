"""
Vader Telegram Live Dashboard - read-only Flask server.

Serves live VADER cash-secured-put option signals parsed from the private
Telegram channel and stored in webportfolio's production `telegram_signal`
SQL table, so `vader-telegram-live.html` can render the same Monday-Friday
calendar layout as the Substack weekly calendar, but backed by live data
instead of a static newsletter. Puts only, per @jimb's request; covered
calls are excluded from this view.

SECURITY / SCOPE (read this before changing anything):
  * SELECT-only. This script must never INSERT/UPDATE/DELETE. There is no
    write path here at all - if you need one, stop and ask first.
  * Reads DB credentials from webportfolio's own config/config.ini
    ([Database] section). Those credentials currently have full read/write
    rights on the shared production database (they are the same ones the
    ingest pipeline uses to write). This script is trusted to only SELECT;
    that trust is NOT enforced by a database-level read-only login yet.
    Independent review (GPT + Mai, session ae15e7af) flagged this and
    recommended a dedicated read-only SQL login as a follow-up hardening
    step; @jimb chose to defer that and use the existing credentials for
    now. Do not "fix" this by adding writes - if hardening happens, it
    happens as a separate, explicitly-requested change.
  * Binds to this machine's specific LAN IPv4 address (not 0.0.0.0), so it
    is reachable from other devices on the home LAN but doesn't listen on
    every interface (Wi-Fi, Ethernet, VPN, virtual adapters). See
    LAN_BIND_HOST below.
  * Every /api/* route requires an `X-API-Key` header matching the value in
    the untracked server/secrets.ini file (see _load_api_key). Requests
    without a valid key get 401. OPTIONS (CORS preflight) requests are
    exempt from this check so cross-origin fetches from the dashboard
    still work.
  * This LAN-reachable + shared-secret-key model was independently reviewed
    by GPT-5.4 and Mai-1.1-flash (session ae15e7af, plan step 3) before
    being adopted. Known accepted limitations for this dev phase, not yet
    solved: plaintext HTTP (no TLS) and the DB credentials above are not
    scoped to read-only. Revisit both if/when this moves beyond the home
    LAN (e.g. the planned jimbrownhome permanent-hosting step).
  * Never print/log the DB password or the API key. Never commit
    secrets.ini or config.ini.

Usage:
    python server.py
    (then open ../web/vader-telegram-live.html in a browser; it fetches
    from http://<LAN-IP>:5057/api/week-signals with an X-API-Key header)
"""

import configparser
import datetime as dt
import os
import socket
import sys

import pyodbc
from flask import Flask, jsonify, request
from flask_cors import CORS

# --- config -------------------------------------------------------------

# webportfolio's config.ini lives in a sibling repo under C:\Files\Dev\main.
# Resolve it explicitly rather than guessing a relative path, since this
# script lives in a different repo.
WEBPORTFOLIO_CONFIG_PATH = r"C:\Files\Dev\main\webportfolio\config\config.ini"

# This repo's own untracked secrets file (gitignored), holding the shared
# API key clients must send as X-API-Key. Never commit this file.
SECRETS_PATH = os.path.join(os.path.dirname(__file__), "secrets.ini")

# Origins the dashboard is actually served from. Kept narrow (not "*") now
# that a real auth header is in play; add entries here if the dashboard is
# opened from a new host/port.
ALLOWED_ORIGINS = [
    "null",  # a file:// page's Origin header is literally the string "null"
    "http://localhost:5057",
    "http://127.0.0.1:5057",
]

PORT = 5057


def _lan_bind_host():
    """Resolve this machine's LAN IPv4 address to bind to (not 0.0.0.0)."""
    override = os.environ.get("WEBOPTIONS_BIND_HOST")
    if override:
        return override
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # Doesn't actually send anything; just asks the OS which local
            # interface/IP would be used to reach an external address.
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return "127.0.0.1"


LAN_BIND_HOST = _lan_bind_host()


def _load_api_key():
    config = configparser.ConfigParser()
    if not config.read(SECRETS_PATH):
        print(
            f"Error: could not read {SECRETS_PATH}. Copy secrets.example.ini "
            "to secrets.ini and set an api_key value.",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        return config.get("auth", "api_key").strip()
    except (configparser.NoSectionError, configparser.NoOptionError) as exc:
        print(f"Error: missing api_key in {SECRETS_PATH}: {exc}", file=sys.stderr)
        sys.exit(1)


API_KEY = _load_api_key()


def _load_database_config():
    config = configparser.ConfigParser()
    if not config.read(WEBPORTFOLIO_CONFIG_PATH):
        print(
            f"Error: could not read config file at {WEBPORTFOLIO_CONFIG_PATH}",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        db_config = dict(config.items("Database"))
    except configparser.NoSectionError as exc:
        print(f"Error: missing config section: {exc}", file=sys.stderr)
        sys.exit(1)
    return db_config


DATABASE_CONFIG = _load_database_config()


def _odbc_escape(value):
    """Wrap a value in braces and double any closing braces so special characters
    in credentials cannot break the ODBC connection string."""
    return "{" + str(value).replace("}", "}}") + "}"


def get_database_connection():
    """Open a fresh read-only-intent connection. Callers must only SELECT."""
    cfg = DATABASE_CONFIG
    connection_string = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={cfg['server']};"
        f"DATABASE={cfg['database']};"
        f"UID={_odbc_escape(cfg['username'])};"
        f"PWD={_odbc_escape(cfg['password'])};"
        f"Encrypt=yes;"
        f"TrustServerCertificate=no;"
        f"Connection Timeout=30;"
        # ApplicationIntent=ReadOnly is honored by SQL Server read-replica
        # routing on some topologies; it is not a hard guarantee on Azure SQL
        # single-database, but it signals intent and costs nothing to set.
        f"ApplicationIntent=ReadOnly;"
    )
    return pyodbc.connect(connection_string)


# --- week math (Pacific calendar dates) ----------------------------------


def _monday_of(d: dt.date) -> dt.date:
    return d - dt.timedelta(days=d.weekday())


def _current_week_monday() -> dt.date:
    # The server and the user are both effectively Pacific-local for this
    # personal tool; use the local system clock's date.
    return _monday_of(dt.date.today())


def _parse_week_param(value: str) -> dt.date:
    parsed = dt.datetime.strptime(value, "%Y-%m-%d").date()
    return _monday_of(parsed)


DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

# The dedup SQL below mirrors webportfolio's own getCspExplorer/getLatestCspSignals
# pattern (telegramSignalService.ts): partition by (report_date, contract_key),
# prefer the tier-bucketed row over a Top-Picks-only row, and OR is_top_pick
# across duplicates. Puts only ('P') - per @jimb's request the dashboard omits
# covered calls entirely.
SIGNAL_QUERY = """
WITH base AS (
    SELECT
        s.report_date,
        s.symbol,
        s.sector,
        s.option_right,
        s.strike,
        s.expiration,
        s.dte,
        s.delta,
        s.annualized_yield,
        s.premium,
        s.collateral,
        s.collateral_bucket,
        COALESCE(s.tier, s.profile) AS tier,
        COALESCE(s.contract_key,
            CONCAT(s.symbol, '|', s.strike, '|', s.expiration)) AS contract_key,
        MAX(CAST(s.is_top_pick AS INT)) OVER (
            PARTITION BY s.report_date,
                COALESCE(s.contract_key,
                    CONCAT(s.symbol, '|', s.strike, '|', s.expiration))
        ) AS is_top_pick,
        ROW_NUMBER() OVER (
            PARTITION BY s.report_date,
                COALESCE(s.contract_key,
                    CONCAT(s.symbol, '|', s.strike, '|', s.expiration))
            ORDER BY CASE WHEN s.tier IS NULL THEN 1 ELSE 0 END,
                     s.annualized_yield DESC
        ) AS rn
    FROM telegram_signal s
    WHERE s.is_current = 1 AND s.parse_status = 'parsed' AND s.option_right = 'P'
      AND s.report_date BETWEEN ? AND ?
)
SELECT
    report_date, symbol, sector, option_right, strike, expiration, dte, delta,
    annualized_yield, premium, collateral, collateral_bucket, tier, is_top_pick
FROM base
WHERE rn = 1
ORDER BY report_date, tier, option_right, annualized_yield DESC
"""

EXISTS_QUERY = """
SELECT TOP 1 1 AS found
FROM telegram_signal
WHERE is_current = 1 AND parse_status = 'parsed' AND option_right = 'P'
  AND report_date BETWEEN ? AND ?
"""


def _iso(d):
    if d is None:
        return None
    if isinstance(d, (dt.date, dt.datetime)):
        return d.strftime("%Y-%m-%d")
    return str(d)[:10]


def _week_has_data(conn, monday: dt.date) -> bool:
    friday = monday + dt.timedelta(days=4)
    cursor = conn.cursor()
    cursor.execute(EXISTS_QUERY, monday, friday)
    return cursor.fetchone() is not None


def _fetch_week(conn, monday: dt.date):
    friday = monday + dt.timedelta(days=4)
    cursor = conn.cursor()
    cursor.execute(SIGNAL_QUERY, monday, friday)
    columns = [c[0] for c in cursor.description]
    rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    days = []
    for offset in range(5):
        day_date = monday + dt.timedelta(days=offset)
        day_iso = _iso(day_date)
        day_rows = [r for r in rows if _iso(r["report_date"]) == day_iso]
        if not day_rows:
            continue
        trades = []
        for r in day_rows:
            trades.append(
                {
                    "symbol": r["symbol"],
                    "sector": r["sector"],
                    "optionRight": r["option_right"],
                    "strike": float(r["strike"]) if r["strike"] is not None else None,
                    "expiration": _iso(r["expiration"]),
                    "dte": int(r["dte"]) if r["dte"] is not None else None,
                    "delta": float(r["delta"]) if r["delta"] is not None else None,
                    "annualizedYield": float(r["annualized_yield"])
                    if r["annualized_yield"] is not None
                    else None,
                    "premium": float(r["premium"]) if r["premium"] is not None else None,
                    "collateral": float(r["collateral"]) if r["collateral"] is not None else None,
                    "tier": r["tier"],
                    "isTopPick": bool(r["is_top_pick"]),
                }
            )
        days.append(
            {
                "name": DAY_NAMES[offset],
                "date": day_iso,
                "hasData": True,
                "trades": trades,
            }
        )
    return days


app = Flask(__name__)
CORS(
    app,
    resources={r"/api/*": {"origins": ALLOWED_ORIGINS}},
    allow_headers=["X-API-Key", "Content-Type"],
)


@app.before_request
def _require_api_key():
    # CORS preflight requests never carry the app's custom headers (browsers
    # send a bare OPTIONS first); exempt them or every cross-origin fetch
    # from the dashboard would 401 before the real request is even sent.
    if request.method == "OPTIONS":
        return None
    if not request.path.startswith("/api/"):
        return None
    supplied = request.headers.get("X-API-Key", "")
    if supplied != API_KEY:
        return jsonify({"error": "missing or invalid X-API-Key header"}), 401
    return None


@app.route("/api/week-signals")
def week_signals():
    week_param = request.args.get("week")
    current_monday = _current_week_monday()

    if week_param:
        try:
            monday = _parse_week_param(week_param)
        except ValueError:
            return jsonify({"error": "week must be YYYY-MM-DD"}), 400
    else:
        monday = current_monday

    friday = monday + dt.timedelta(days=4)
    is_current_week = monday == current_monday

    conn = get_database_connection()
    try:
        days = _fetch_week(conn, monday)
        has_prior = _week_has_data(conn, monday - dt.timedelta(days=7))
        # Never treat a future week as navigable, even if it happened to have
        # rows (shouldn't happen, but the rule is "stop at current week").
        if monday >= current_monday:
            has_next = False
        else:
            has_next = _week_has_data(conn, monday + dt.timedelta(days=7))
    finally:
        conn.close()

    return jsonify(
        {
            "weekStart": _iso(monday),
            "weekEnd": _iso(friday),
            "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
            "isCurrentWeek": is_current_week,
            "hasPriorWeekData": has_prior,
            "hasNextWeekData": has_next,
            "days": days,
        }
    )


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    print(f"Vader Telegram Live Dashboard server starting on http://{LAN_BIND_HOST}:{PORT}")
    print("Read-only. SELECT-only queries against webportfolio's telegram_signal table.")
    print("All /api/* routes require an X-API-Key header (see secrets.ini).")
    app.run(host=LAN_BIND_HOST, port=PORT, debug=False)
