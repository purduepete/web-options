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
    happens as a separate, explicitly-requested change. This remains the
    single highest-priority follow-up hardening item for this project.
  * Binds to this machine's specific LAN IPv4 address (not 0.0.0.0), so it
    is reachable from other devices on the home LAN but doesn't listen on
    every interface (Wi-Fi, Ethernet, VPN, virtual adapters). See
    LAN_BIND_HOST below.
  * Every /api/* route requires an `X-API-Key` header matching the value in
    the untracked server/secrets.ini file (see _load_api_key). Requests
    without a valid key get 401. OPTIONS (CORS preflight) requests are
    exempt from this check so cross-origin fetches from the dashboard
    still work.
  * `/vader-telegram-live.html` (and `/`, which redirects to it) is served
    directly by this app with the real API key auto-injected into the page
    (replacing a placeholder token in the committed HTML), so browsing
    straight to http://<LAN-IP>:5057/vader-telegram-live.html "just works"
    with no prompts. IMPORTANT HONEST NOTE (per a second independent
    review, GPT-5.4 + Mai-1.1-flash, session ae15e7af): once the key is
    embedded in every served page, it is NOT real per-request
    authentication - anyone who can reach the page can view-source/devtools
    the key out and call /api/* directly. The X-API-Key check is a light
    nuisance control against accidental or naive script access, not a
    security boundary. The actual trust boundary here is LAN reachability
    itself (same as it practically was in the prior round, which handed the
    key/host to anyone using the dashboard via a prompt instead of
    automatically - this is not a regression, just removing a manual step).
    @jimb reviewed this trade-off directly and chose to keep the header
    check anyway, for the minor friction it still adds.
  * The served HTML response sets Cache-Control: no-store, so a rotated key
    can't get stuck in a cached copy of the page.
  * This LAN-reachable + shared-secret-key model was independently reviewed
    by GPT-5.4 and Mai-1.1-flash (session ae15e7af) before being adopted.
    Known accepted limitations for this dev phase, not yet solved:
    plaintext HTTP (no TLS) and the DB credentials above are not scoped to
    read-only. Revisit both if/when this moves beyond the home LAN (e.g.
    the planned jimbrownhome permanent-hosting step).
  * Never print/log the DB password or the API key. Never commit
    secrets.ini or config.ini.

Usage:
    python server.py
    (it prints the LAN address it bound to; browse directly to
    http://<LAN-IP>:5057/vader-telegram-live.html, no local file needed)
"""

import configparser
import datetime as dt
import os
import re
import socket
import sys
from pathlib import Path

import pyodbc
from flask import Flask, Response, jsonify, redirect, request
from flask_cors import CORS

# --- config -------------------------------------------------------------

# webportfolio's config.ini lives in a sibling repo under C:\Files\Dev\main.
# Resolve it explicitly rather than guessing a relative path, since this
# script lives in a different repo.
WEBPORTFOLIO_CONFIG_PATH = r"C:\Files\Dev\main\webportfolio\config\config.ini"

# This repo's own untracked secrets file (gitignored), holding the shared
# API key clients must send as X-API-Key. Never commit this file.
SECRETS_PATH = os.path.join(os.path.dirname(__file__), "secrets.ini")

# The dashboard HTML lives in a sibling web/ folder in this same repo. It's
# served directly by this app (see dashboard_page below), with API_KEY_TOKEN
# swapped for the real key at serve-time. The committed file only ever
# contains the placeholder.
DASHBOARD_HTML_PATH = os.path.join(
    os.path.dirname(__file__), "..", "web", "vader-telegram-live.html"
)
API_KEY_TOKEN = "__WEBOPTIONS_API_KEY__"

# The Substack-derived weekly calendars (built by the web-options skill's
# Substack workflow) currently live in @jimb's OneDrive folder, not in this
# repo. The server reads them directly from there rather than copying them
# in. Override via WEBOPTIONS_CALENDARS_DIR when this moves to a different
# host (e.g. the planned jimbrownhome permanent-hosting step, where this
# OneDrive path won't exist).
CALENDARS_DIR = Path(
    os.environ.get(
        "WEBOPTIONS_CALENDARS_DIR",
        r"C:\Users\JimBrown\OneDrive\Trading\Vader",
    )
)
CALENDARS_INDEX_HTML_PATH = os.path.join(
    os.path.dirname(__file__), "..", "web", "calendars-index.html"
)
CALENDAR_FILENAME_RE = re.compile(r"^weekly-options-calendar-(\d{4}-\d{2}-\d{2})\.html$")
CALENDAR_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

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


def _week_start_for_publish_date(publish_date: dt.date) -> dt.date:
    """Maps a calendar's filename (publish) date to the Monday of the
    trading week it covers. Weekday publish dates use that week's own
    Monday. Weekend publish dates (the newsletter often lands Sat/Sun ahead
    of the week it covers) map forward to the following Monday, not
    backward to the just-finished week - a naive `_monday_of()` on a Sunday
    would silently point at the wrong (already-past) week."""
    weekday = publish_date.weekday()  # Mon=0 ... Sun=6
    if weekday == 5:  # Saturday
        return publish_date + dt.timedelta(days=2)
    if weekday == 6:  # Sunday
        return publish_date + dt.timedelta(days=1)
    return publish_date - dt.timedelta(days=weekday)


def _list_calendar_weeks():
    """Scans CALENDARS_DIR for weekly-options-calendar-YYYY-MM-DD.html files
    and returns them newest-first as
    [{publishDate, weekStart, weekEnd, filename}, ...].

    Degrades gracefully: a missing/inaccessible directory or an unparseable
    filename is skipped rather than raised, so a stale env var or OneDrive
    hiccup returns an empty list instead of a 500."""
    if not CALENDARS_DIR.is_dir():
        return []

    weeks = []
    try:
        entries = os.listdir(CALENDARS_DIR)
    except OSError:
        return []

    for name in entries:
        match = CALENDAR_FILENAME_RE.match(name)
        if not match:
            continue
        try:
            publish_date = dt.datetime.strptime(match.group(1), "%Y-%m-%d").date()
        except ValueError:
            continue
        week_start = _week_start_for_publish_date(publish_date)
        week_end = week_start + dt.timedelta(days=4)
        weeks.append(
            {
                "publishDate": _iso(publish_date),
                "weekStart": _iso(week_start),
                "weekEnd": _iso(week_end),
                "filename": name,
            }
        )

    weeks.sort(key=lambda w: w["publishDate"], reverse=True)
    return weeks


def _resolve_calendar_file(date_str):
    """Given a validated YYYY-MM-DD string, returns the resolved Path to
    that week's calendar file inside CALENDARS_DIR, or None if the date is
    malformed, the file doesn't exist, or the resolved path would escape
    CALENDARS_DIR (defense-in-depth; the date regex alone already makes
    traversal characters like '..' or '/' impossible in this parameter)."""
    if not CALENDAR_DATE_RE.match(date_str):
        return None
    try:
        base = CALENDARS_DIR.resolve(strict=True)
    except OSError:
        return None
    candidate = (base / f"weekly-options-calendar-{date_str}.html").resolve()
    if os.path.commonpath([str(base), str(candidate)]) != str(base):
        return None
    if not candidate.is_file():
        return None
    return candidate


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

EARLIEST_DATE_QUERY = """
SELECT MIN(report_date) AS earliest
FROM telegram_signal
WHERE is_current = 1 AND parse_status = 'parsed' AND option_right = 'P'
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


def _earliest_week_monday(conn):
    """Returns the Monday of the week containing the earliest signal on
    record, or None if there's no data at all. Lets the frontend jump
    straight there in one click instead of stepping back week-by-week."""
    cursor = conn.cursor()
    cursor.execute(EARLIEST_DATE_QUERY)
    row = cursor.fetchone()
    if row is None or row[0] is None:
        return None
    earliest_date = row[0]
    if isinstance(earliest_date, dt.datetime):
        earliest_date = earliest_date.date()
    return _monday_of(earliest_date)


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


@app.route("/")
def index():
    return redirect("/vader-telegram-live.html")


@app.route("/vader-telegram-live.html")
def dashboard_page():
    # Serve this one specific file only (not a generic static-folder mount)
    # so nothing else in web/ is accidentally exposed. The real API key is
    # injected here, replacing the placeholder in the committed source, so
    # the browser never has to prompt for it. See the module docstring for
    # why this key is a nuisance control, not real per-request auth, once
    # embedded this way.
    with open(DASHBOARD_HTML_PATH, "r", encoding="utf-8") as f:
        html = f.read()
    html = html.replace(API_KEY_TOKEN, API_KEY)
    response = Response(html, mimetype="text/html")
    # Never let a rotated key get stuck in a cached copy of this page.
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/calendars")
def calendars_index_page():
    # Same pattern as dashboard_page: one explicit file, key injected,
    # no-store so a rotated key can't get stuck in a cached copy.
    with open(CALENDARS_INDEX_HTML_PATH, "r", encoding="utf-8") as f:
        html = f.read()
    html = html.replace(API_KEY_TOKEN, API_KEY)
    response = Response(html, mimetype="text/html")
    response.headers["Cache-Control"] = "no-store"
    return response


CALENDARS_BACK_LINK_MARKER = 'data-injected="calendars-back-link"'
CALENDARS_BACK_LINK_HTML = (
    '<div ' + CALENDARS_BACK_LINK_MARKER + ' style="display:flex;align-items:center;gap:8px;">'
    '<a href="/calendars" '
    'style="background:var(--surface-2,#1d2538);border:1px solid var(--border,#28324a);'
    'color:var(--text,#e7ecf5);height:36px;padding:0 14px;display:flex;align-items:center;'
    'gap:8px;border-radius:var(--radius,0);text-decoration:none;font-size:0.85rem;'
    'font-weight:600;font-family:\'Inter\',system-ui,sans-serif;">'
    '&larr; All weekly calendars</a>'
)


def _inject_calendars_back_link(html):
    # These weekly-calendar files are static, hand-generated-per-week by the
    # web-options skill, not templated by this server - so rather than
    # editing every past/future file, inject a "back to the calendars list"
    # link into the topbar at serve time, same pattern as the API-key
    # placeholder swap on the dashboard page. Idempotent: skip if a file
    # already has one (e.g. a future skill revision adds it directly). Wraps
    # the theme-toggle button in a flex div alongside the new link, rather
    # than adding a 3rd top-level topbar child, so header.topbar's
    # `justify-content: space-between` (title vs. actions) still lays out
    # as 2 groups instead of spreading 3 items apart.
    if CALENDARS_BACK_LINK_MARKER in html:
        return html
    toggle_marker = '<button class="icon-btn" id="theme-toggle"'
    if toggle_marker in html and "</header>" in html:
        html = html.replace(toggle_marker, CALENDARS_BACK_LINK_HTML + toggle_marker, 1)
        html = html.replace("</header>", "</div>\n</header>", 1)
    return html


@app.route("/calendars/<date_str>")
def calendars_file(date_str):
    # No API key required here (same same-origin/LAN-trust model as
    # dashboard_page/vader-telegram-live.html): these are static pre-rendered
    # pages, not /api/* data endpoints. <date_str> is validated against
    # ^\d{4}-\d{2}-\d{2}$ before any filesystem work, so path-traversal
    # characters can't even reach this route; the resolved-path containment
    # check in _resolve_calendar_file is defense-in-depth on top of that.
    target = _resolve_calendar_file(date_str)
    if target is None:
        if not CALENDAR_DATE_RE.match(date_str):
            return jsonify({"error": "date must be YYYY-MM-DD"}), 400
        return jsonify({"error": "no calendar found for that date"}), 404
    with open(target, "r", encoding="utf-8") as f:
        html = f.read()
    html = _inject_calendars_back_link(html)
    response = Response(html, mimetype="text/html")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/calendars")
def calendars_list():
    return jsonify({"calendars": _list_calendar_weeks()})


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


@app.route("/api/earliest-week")
def earliest_week():
    """Returns the Monday of the earliest week with any data on record, so
    the frontend can jump straight there in one click."""
    conn = get_database_connection()
    try:
        monday = _earliest_week_monday(conn)
    finally:
        conn.close()
    if monday is None:
        return jsonify({"weekStart": None})
    return jsonify({"weekStart": _iso(monday)})


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    if not CALENDARS_DIR.is_dir():
        print(
            f"Warning: CALENDARS_DIR does not exist: {CALENDARS_DIR}. "
            "/calendars and /api/calendars will return no results until "
            "this is fixed (see WEBOPTIONS_CALENDARS_DIR).",
            file=sys.stderr,
        )
    print(f"Vader Telegram Live Dashboard server starting on http://{LAN_BIND_HOST}:{PORT}")
    print(f"Open the dashboard at http://{LAN_BIND_HOST}:{PORT}/vader-telegram-live.html")
    print("Read-only. SELECT-only queries against webportfolio's telegram_signal table.")
    print("All /api/* routes require an X-API-Key header (see secrets.ini).")
    app.run(host=LAN_BIND_HOST, port=PORT, debug=False)
