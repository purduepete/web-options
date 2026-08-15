# weboptions

Personal, single-user web dashboards for options-trading data. Currently two
capabilities live here:

1. **Live Telegram VADER dashboard** (`server/`, `web/vader-telegram-live.html`)
   - a small read-only Flask API serving live VADER cash-secured-put signals
     from webportfolio's production `telegram_signal` SQL table, rendered as
     a Monday-Friday calendar dashboard.
2. Weekly Substack-derived calendars (built ad hoc by the `web-options`
   Copilot skill, saved to `OneDrive\Trading\Vader\`) are a separate,
   static-file workflow and don't live in this repo.

This repo is the dev home for the live dashboard, ahead of a later move to
the `jimbrownhome` server for permanent hosting with automated startup and
refresh (not yet done).

## Start the server

```powershell
cd server
pip install -r requirements.txt
copy secrets.example.ini secrets.ini
# edit secrets.ini and set a real random api_key value
python server.py
```

The server prints the LAN address it bound to, e.g.
`http://192.168.1.20:5057`. It binds to this machine's specific LAN IPv4
address (not `0.0.0.0`), so it's reachable from other devices on the home
network but not on every network interface.

Then open `web/vader-telegram-live.html` in a browser. It will prompt once
for:
- the server's `host:port` (e.g. `192.168.1.20:5057`)
- the API key from `secrets.ini`

Both are remembered in the browser's `sessionStorage` for that tab/session
only (cleared when the tab/browser closes), not `localStorage`.

## API

- `GET /api/week-signals` - current Mon-Fri week's signals (only days with
  data so far). Requires header `X-API-Key: <value>`.
- `GET /api/week-signals?week=YYYY-MM-DD` - any prior week (normalized to
  that week's Monday). Response includes `isCurrentWeek`, `hasPriorWeekData`,
  `hasNextWeekData`.
- `GET /api/health` - basic liveness check. Also requires the API key.

## Security notes

- **SELECT-only.** No write path exists in this code.
- **Binds to a specific LAN IPv4 address**, not `0.0.0.0` - reachable from
  the home LAN, not every network interface on the machine.
- **Shared-secret API key** required on every `/api/*` route via the
  `X-API-Key` header. Read from `server/secrets.ini` (gitignored, never
  committed). Rotate by editing the value and restarting the server; clients
  will get a 401 and be re-prompted.
- **CORS is scoped**, not wildcard, to the origins the dashboard is actually
  opened from (see `ALLOWED_ORIGINS` in `server.py`).
- **Known, accepted limitations for this dev phase** (not solved by the
  above): plaintext HTTP (no TLS), and the DB credentials in
  `webportfolio`'s `config.ini` have full read/write rights, not
  DB-enforced read-only. Both were flagged by an independent review
  (GPT-5.4 + Mai-1.1-flash, session `ae15e7af`) and accepted as follow-up
  hardening items, not blockers, for a personal home-LAN tool. Revisit if
  this ever becomes reachable beyond the home LAN.
- Never print, log, or commit `secrets.ini` or `webportfolio`'s
  `config.ini`.
