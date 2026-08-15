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

Then just browse to `http://<LAN-IP>:5057/vader-telegram-live.html` (or
`http://<LAN-IP>:5057/`, which redirects there) from any device on the home
LAN. The server serves the dashboard page itself with the API key already
embedded, so there's nothing to configure or type in.

## API

- `GET /` - redirects to `/vader-telegram-live.html`.
- `GET /vader-telegram-live.html` - the dashboard page, served with the real
  API key injected in place of a placeholder in the committed source.
  Response is `Cache-Control: no-store` so a rotated key never sticks in a
  cached copy.
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
  committed). Rotate by editing the value and restarting the server.
- **The API key is NOT real per-request authentication once embedded in the
  served page.** The dashboard page is served by this same app with the key
  auto-injected, so anyone who can browse to the page can view-source it out
  and call `/api/*` directly with it. This was flagged by two independent
  reviews (GPT-5.4 approve-with-changes, Mai-1.1-flash reject, session
  `ae15e7af`) before @jimb chose to keep the header check anyway, as a light
  nuisance control against accidental/naive script access - not a security
  boundary. **The real trust boundary here is being on the home LAN**, same
  as it practically was before this page was Flask-served (that flow handed
  the key/host to anyone using the dashboard via a one-time prompt instead
  of automatically; this is not a regression).
- **CORS is scoped**, not wildcard, to the origins the dashboard is actually
  opened from (see `ALLOWED_ORIGINS` in `server.py`), though it's largely
  moot now that the page and API are same-origin.
- **Known, accepted limitations for this dev phase** (not solved by the
  above): plaintext HTTP (no TLS), and the DB credentials in
  `webportfolio`'s `config.ini` have full read/write rights, not
  DB-enforced read-only. The DB-credential scoping remains the single
  highest-priority follow-up hardening item. Revisit both if this ever
  becomes reachable beyond the home LAN.
- Never print, log, or commit `secrets.ini` or `webportfolio`'s
  `config.ini`.
