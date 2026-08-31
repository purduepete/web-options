# weboptions

Personal, single-user dashboards for options-trading data. React front end, Express
API, Azure SQL. It runs on the home LAN only and has no cloud hosting.

Three things to look at:

- **Live signals** - this week's VADER cash-secured-put signals from webportfolio's
  `opt.telegram_signal` table, laid out Monday to Friday and grouped by risk tier.
  Arrow keys walk backwards and forwards through the weeks.
- **Summary** - every week rolled up by risk group, a month at a time, so the weeks
  can be read against each other rather than one at a time. Weeks are filed by their
  Monday, so a month can carry a few of the next month's days.
- **Weekly calendars** - each week's Substack-derived calendar, ingested into the
  `opt` schema rather than read off disk. Latest Calendar plus the arrow keys walks
  the whole archive.

The trading data is read-only. The one thing this app writes is its own caution
list, and it writes it to its own schema. See
[Security notes](#security-notes).

## Layout

npm workspaces, no TypeScript project references.

| Workspace  | What it is                                       |
| ---------- | ------------------------------------------------ |
| `shared`   | `@weboptions/shared` - types and theme constants |
| `backend`  | Express 5 API and the operator tools             |
| `frontend` | React 19 and Vite                                |

`database/migrations` holds the numbered SQL that builds the `opt` schema and the
writable `optcfg` one.
`docs/site-review.html` is the current plan and the reasoning behind it.

## Running it in development

This is the two-server setup for working on the code, on the machine you are
working on. To run it as a deployment, on jimbrownhome or anywhere else, skip to
[Running it for real](#running-it-for-real).

```powershell
npm install
npm run serve          # or: pwsh -File scripts/weboptions.ps1 start
```

Both servers start detached, with pids and logs under `.run/`. Browse to
**http://localhost:5173** only: Vite proxies `/api` to the API on 5057, so hitting
5057 directly gets you the API without a front end.

```powershell
npm run serve:status
npm run serve:stop
pwsh -File scripts/weboptions.ps1 restart
```

The API connects as `weboptions_ro`, the SELECT-only login, reading its password
from `.secrets\weboptions_ro.password`. Pass `-Operator` to connect with the
webportfolio `config.ini` credentials instead, which the migration and key tools
need. Pass `-ApiOnly` to skip Vite.

The owned-contracts page calls the WebPortfolio API through the WebOptions
backend. Configure that once with ignored files under `.secrets`:

```powershell
Set-Content .secrets\webportfolio_api_url 'https://cagkhw25ijhyzzy-api.greenmushroom-35ba4d3d.eastus2.azurecontainerapps.io' -Encoding ascii
$key = Read-Host 'WebPortfolio API key' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | Set-Content .secrets\webportfolio_service.key -Encoding ascii
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
```

Environment variables `WEBPORTFOLIO_API_URL` and `WEBPORTFOLIO_SERVICE_KEY` still
override those files for one-off runs.

Running as the service login exports `DB_*` into the calling session, and the
operator tools refuse to run while those are set. The script clears them after
launch, but if a tool complains:

```powershell
Remove-Item Env:DB_SERVER,Env:DB_NAME,Env:DB_USER,Env:DB_PASSWORD -ErrorAction SilentlyContinue
```

## Running it for real

In development, Vite serves the app and proxies `/api`. In production there is no
Vite, so the API serves the built front end itself. One process, one port.

This is not just tidier, it is the only thing that works off the box. Vite rejects
requests whose `Host` header it does not recognise, so `npm run serve` on a server
answers `localhost` and 403s every other machine on the network.

```powershell
npm run build
npm start
```

`npm start` runs `scripts/serve.ps1`, which reads the read-only password from
`.secrets`, points `WEBOPTIONS_WEB_ROOT` at `frontend/dist`, pins the timezone,
and runs node in the foreground so Task Scheduler can own the process. It refuses
to start if the build is missing rather than serving a blank page.

Everything it prints goes to `.run\weboptions.log` as well as the console.

Set `WEBOPTIONS_WEB_ROOT` yourself only if you know why. It has to be absolute, or
it resolves against whatever directory the process started in rather than the repo
root, and the dev server refuses to start while it is set at all.

`docs/runbook.html` covers the rest: the Task Scheduler entry, the update procedure,
what to check when something looks wrong.

## First-time setup

Run these with `-Operator` credentials, in order.

```powershell
npm run migrate                 # build the opt schema
npm run create-readonly-user    # mint weboptions_ro and grant SELECT on opt
npm run verify-readonly         # prove it can read and cannot write
npm run keys -- --list          # mint a browser key with --mint "Label"
```

A key looks like `woak_` plus 48 characters. Only its hash is stored, in
`opt.api_key`, so the value is shown once at mint time and never again. Paste it
into the app's unlock prompt; it lives in browser storage under
`weboptions_api_key`. Revoke with the same tool, and the browser drops back to the
prompt on its next request.

## Ingesting a calendar

```powershell
npm run validate-calendar -- .\data\calendars\weekly-options-calendar-<date>.json <count> <iso-published-timestamp>
npm run render-calendar -- .\data\calendars\weekly-options-calendar-<date>.json <count> <iso-published-timestamp>
npm run test:calendar
npx tsx backend/tools/ingest-calendar.ts .\data\calendars\weekly-options-calendar-<date>.json
```

The JSON sidecar is the source for the standalone HTML and the SQL rows. The
validator checks the five weekdays, advertised trade count, calendar dates,
Pacific time labels, risk tiers, and prohibited punctuation before it writes
anything. The renderer writes the dated HTML to `OneDrive\Trading\Vader` by
default; a fourth positional value names another file or directory.

The ingest command above is a dry run. Review its summary, get the required
independent database-write review, then add `--confirm`. Run the dry command
again afterward; it should report `unchanged` and a matching source hash.

## API

Everything under `/api` needs an `X-API-Key` header.

| Route                      | Key | What it answers                                   |
| -------------------------- | --- | ------------------------------------------------- |
| `GET /healthz`             | no  | Liveness. The process is answering, nothing more. |
| `GET /readyz`              | no  | Readiness. Reads a row from `opt.api_key`, so it  |
|                            |     | also proves the login, the schema and the grants. |
| `GET /api/health`          | yes | Liveness behind the key.                          |
| `GET /api/me`              | yes | The label and prefix of the key being used.       |
| `GET /api/week-signals`    | yes | This week's signals. `?week=YYYY-MM-DD` for any   |
|                            |     | other, normalised to that week's Monday.          |
| `GET /api/earliest-week`   | yes | The Monday of the earliest week on record.        |
| `GET /api/signal-months`   | yes | Every month that has signals, newest first, with  |
|                            |     | the week starts each one covers.                  |
| `GET /api/signal-summary`  | yes | One month rolled up by week and risk group.       |
|                            |     | `?month=YYYY-MM`, plus `?symbols=` to narrow it.  |
| `GET /api/calendars`       | yes | Every ingested week, newest first.                |
| `GET /api/calendars/:date` | yes | One week, keyed on publish date.                  |
| `GET /api/caution-symbols` | yes | The global caution list.                          |
| `PUT /api/caution-symbols` | yes | Replaces it. The only write in the app.           |

Failures are meant to be told apart rather than guessed at. A 401 means the key was
refused. A 503 carries a `code` of `database_login_failed` or
`database_unreachable`. A 500 means a bug, never an outage. An error body that is
not JSON means nothing reached the API at all.

## Tests

```powershell
npm test -- --run
npm run typecheck
```

Every suite runs by default. The parity gate that held the Node API against JSON
recorded from the Flask server was retired once that server had been gone long
enough for the recordings to be history rather than a target; it and its fixtures
are in the git log if the old behaviour is ever worth looking up.

## Security notes

- **SELECT-only on the trading data, enforced by the database.** `weboptions_ro`
  holds SELECT on `opt` and an explicit DENY on writing to it, so a bug cannot
  touch the signals or the calendars.
- **One writable table, in its own schema.** `optcfg.caution_symbol` is the caution
  list, and `optcfg` is the only schema the login can write to. A DENY at schema
  scope beats a GRANT at object scope in SQL Server, which is why the writable
  table could not simply live in `opt`. `npm run verify-readonly` connects as the
  service login and proves the split rather than asserting it.
- **The real trust boundary is the home LAN.** The API key is a nuisance control
  against naive access, not authentication. Anyone holding a key can replace the
  caution list; nothing else about the database is theirs to change.
- **The key is per browser, not per page.** It is typed in once and stored, rather
  than injected into the served HTML the way the Flask version did. View-source no
  longer hands it out.
- Never print, log or commit anything under `.secrets`, or webportfolio's
  `config.ini`.

## TLS

The Node app itself still only speaks plain HTTP on 5057; nothing about it changed.
`scripts/install-tls.ps1` puts [Caddy](https://caddyserver.com) in front of it as a
second, minimal process that terminates TLS and reverse-proxies back to
`127.0.0.1:5057`, using a locally-trusted self-signed cert (`tls internal`) rather
than a real CA, since this never leaves the home LAN.

```powershell
# elevated shell, one time
./scripts/install-tls.ps1 -Start
# also once, interactively, so this machine's browsers stop warning:
& scripts\caddy\caddy.exe trust --config scripts\Caddyfile
```

That registers a `WebOptionsTLS` logon task the same way `install-task.ps1`
registers `WebOptions` itself: hidden window, starts at logon, no console. Browse
to `https://<lan-ip>:5443` instead of `http://<lan-ip>:5057`. Other devices on the
LAN will still see a self-signed warning unless Caddy's local CA root is exported
and imported into their trust stores too; that's optional; the connection is
encrypted either way.

**Trusting it on another device (e.g. a laptop):** `caddy trust` only touches the
trust store on the machine it ran on. To stop the warning on another device, copy
that machine's copy of the CA root over and import it there too:

```powershell
# on jimbrownhome, put the CA root somewhere the other device can reach it
Copy-Item "$env:APPDATA\Caddy\pki\authorities\local\root.crt" "$env:OneDrive\Caddy-Local-CA.crt"

# on the other device, elevated
certutil -addstore -f "ROOT" "$env:OneDrive\Caddy-Local-CA.crt"
```

Fully restart the browser afterwards (see below); a refresh isn't enough.

**Trusting it on an iPad / iPhone:** iOS treats a root CA as a configuration
profile and needs two separate steps, install then enable.

1. Get `Caddy-Local-CA.crt` onto the device: open the OneDrive app (it's the same
   file copied above), tap it, and share it to Files, or AirDrop it from a Mac.
   Opening it prompts "Profile Downloaded".
2. Install the profile: **Settings → General → VPN & Device Management** → tap the
   downloaded profile → **Install** (enter the passcode).
3. Enable full trust, which step 2 does not do on its own: **Settings → General →
   About → Certificate Trust Settings** → turn on trust for "Caddy Local
   Authority".
4. Close and reopen Safari, then browse to `https://<lan-ip>:5443`.

Without step 3, iOS installs the profile but Safari still shows the untrusted
warning; that's the step people usually miss.

**Still shows "Not secure" after `caddy trust` succeeds?** Chromium browsers (Edge,
Chrome) cache trust decisions per running process, so a page refresh isn't enough.
Fully restart the browser: type `edge://restart` in the address bar, or close every
window and confirm no `msedge.exe` is left in Task Manager, then reopen. If it's
still untrusted after that, confirm the CA actually landed in the Windows store:

```powershell
certutil -user -store Root | Select-String "Caddy Local Authority"
```

If nothing is found, `caddy trust` installed to a different store context than the
browser reads from; re-run it from the same interactive Windows logon session the
browser runs under.

## What used to be here

A Flask app in `server/` served two static pages from `web/`, reading calendar HTML
straight out of OneDrive. It was deleted once the parity gate passed against it. By
then it could not open a database connection at all: its ODBC string named the host
with no protocol prefix and no port, so the driver settled on Named Pipes and Azure
SQL refused it.
