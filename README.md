# weboptions

Personal, single-user dashboards for options-trading data. React front end, Express
API, Azure SQL. Deployment can use Cloudflare Access and a private Tailscale fallback.

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

## Local intraday history

The separate [Python collector](collector/README.md) captures Tastytrade prices,
delta and implied volatility for every locally known unexpired VADER Telegram put.
New processing runs locally and stores history in PostgreSQL `web_options`.
Azure SQL remains a SELECT-only discovery source until a later migration.
The existing dashboard connection and pages are unchanged.

### Contract history page

Open **Tools > Contract History** to search VADER puts, including expired
contracts with retained quotes. Intraday opens the contract's latest usable
Pacific session. Multi-day retains every observation across up to 93 calendar
dates. Switching to Multi-day, or stepping to another contract while in it,
selects the contract's first available date through its latest. The dual-axis chart shows signed delta on the left and mark dollars per
share (or captured percentage) on the right.
Compact quote and analysis summaries keep the charts visible first. Click a
summary row to expand it for timestamps and the full figures. The summaries
stack as full-width rows, with the exit-target menu at the far right of the
analysis row. On large fine-pointer screens at least 800px tall, the collapsed
page fits the viewport and gives the selected chart the remaining height.
The entry and target rows and the contract picker all drop over the chart
instead of pushing it down, so opening one never resizes or redraws the chart.
Only one row panel is open at a time, and each closes on Escape or a click
elsewhere; the picker also closes on a pick. Smaller windows and touch layouts
keep them in the flow and scroll normally.
Switching contracts retains the chosen view mode and date range. The 06:35
Pacific opening capture quotes poorly, so the charts and the best, worst,
giveback and target figures leave it out; the entry price is unaffected. A new contract
clears the old one and fades in fresh, like a page load; changing the date range
for the same contract dims the current view and swaps in place. The Option and
Stock charts share one space and crossfade; each stays built once drawn, and
the hidden one is built shortly after the first one paints. Both charts
use equally spaced, two-line date/time labels; tooltips show exact capture times.
Each contract-picker card shows its latest captured premium percentage at the
upper right, calculated against that card's signal-date entry, independent of the
viewed dates. Negative percentages remain negative; `--` means no usable entry or mark.
The percentage uses compact text rounded to whole numbers. Picker labels omit "put";
in-the-money symbol-and-strike labels have a red border with unchanged text colors.
Captured percentages at or above 50% use green text, based on the unrounded value.
Top Picks use their tier's color on the label text and border in place of extra tier text;
ITM takes precedence, retaining normal text with a red border.
A compact, color-coded legend sits at the right of the date-navigation row and wraps on narrow screens.
The option chart defaults to **Captured %**, plotting `(entry mark - observed mark) / entry mark * 100`.
Use the Option / Stock segmented control to show one chart at a time; the chart choice is remembered.
The option chart's Price / Captured % menu sits beside the contract title. Stock
view shows the strike note in that same position.
The entry card uses the captured market quote for the selected signal date,
independent of the chart's viewing range. Repeated signals have separate entries.
The premium-captured card shows the last viewed mark's percentage and hypothetical
gross dollars per standard 100-share contract. Negative returns remain negative;
fees and actual fills are excluded. Missing captured entries stay unavailable,
with no VADER-premium substitution; zero entries cannot produce percentages.
Points before the entry capture are excluded from captured percentages.
The dashed entry-price line and, when in range, the entry capture marker locate
the baseline. The stock chart uses the same time range,
with a dashed strike and a shaded put ITM region below it. Missing observations
and market-session boundaries break both lines.
The stock axis fits its observed prices with padding, independent of the strike.
A strike outside that scale is labeled above or below the chart range; ITM shading
is clipped to the visible range so a distant strike never compresses the movement.

**Since signal entry** analyzes every recorded capture after that signal's entry
and through expiration or the latest collection, independent of the chart dates.
Choose a 25%, 50% (default), or 75% exit target. The card gives the closing mark
needed, first observed crossing, actual sampled credit retained, and elapsed
calendar time from entry, including nights and weekends. Crossings include exact
threshold matches and are never interpolated across gaps.
Best and worst are the highest and lowest observed captured percentages, with
their timestamps and hypothetical dollars. Giveback is best minus latest valid
observation, in percentage points and dollars. An entirely losing history keeps
its negative best and worst; no artificial zero-profit entry point is added.
Tied extrema use the earliest capture. The chart marks best and first crossing
only when their times are visible. The target line appears in Price and Captured %
when inside the fitted scale; an off-scale note preserves readable movement.
Missing/nonpositive entries and missing observations remain explicit. Recorded
gaps are counted separately; unrecorded periods remain unknown. A sampled target
crossing does not prove an executable fill.

The contract picker lists each signal date separately, using that day's tiers
and top picks. Its calendar enables dates with signals and shows the number of
contracts beneath each day. Arrow buttons step between signal dates. A Tier
menu narrows the picker to one or more of Top Picks, Conservative, Balanced and
Aggressive, as on the signals page, and the choice is remembered. Stepping
between contracts stays within the selected tiers.
Seeking Alpha and TradingView links beside the selected contract open its
underlying in new tabs, with the option context for the research overlays.
Quotes are read fresh on every history request. Exchange schedules are reused
for up to 5 minutes (at most 32 date ranges), avoiding a Python startup on each
contract switch. The navbar reload button refetches the page, including the
selected contract's available dates.

This page reads PostgreSQL using the separate `sd_web_options_reader` login.
It never uses the collector's writable credentials. Production settings require
`PGPASSFILE` (an absolute protected reader passfile),
`WEBOPTIONS_HISTORY_PYTHON` (the existing collector virtual environment's absolute
Python executable), and `WEBOPTIONS_HISTORY_COLLECTOR_ROOT` (the deployed release).
The Python process exports the collector's exchange-calendar schedule without
database access or broker calls. PostgreSQL stays on host loopback.
Apply `database/postgres/007_history_signal_entry.sql` as administrator after
independent review. This narrowly readable view exposes the entry capture time
without granting the reader access to the collector's full source payload.

History readiness is `/api/contract-history/readiness` under the existing API
access boundary. PostgreSQL failure affects history only; `/healthz`, Azure
`/readyz`, and existing pages retain their previous behavior. The page reports
missing and invalid components independently. It does not replace them with
zero or VADER-advertised numbers. The API reports unknown historical discovery
or cadence as unknown coverage, not an exact missed-observation count; the page
does not show the coverage counts.

Ranges above 93 dates or 10,000 timeline points are rejected explicitly.
Settle and recovery observations are labeled. Each point sits at its scheduled
capture time; the readout shows separate market-event and receipt timestamps.
Sampling cannot establish movements between observations.

The collector has its own reviewed schema and disabled-by-default activation gate.
Broker compatibility and database isolation must pass before its tasks are enabled.
See the collector guide for schedules, partial-data handling, credentials and status.

## Embedding in SiteDock

Web Options allows framing by itself and the exact SiteDock HTTPS origins:
`https://jimbrownlaptop.tail8ad282.ts.net` (kept until the laptop instance is retired),
`https://site-dock.jimlertech.com` (SolutionDeploy), and
`https://jimbrownhome1.tail8ad282.ts.net:8790`.
The port is part of the origin, so it must match exactly.
The backend sets
`Content-Security-Policy: frame-ancestors 'self' https://jimbrownlaptop.tail8ad282.ts.net https://site-dock.jimlertech.com https://jimbrownhome1.tail8ad282.ts.net:8790`
instead of `X-Frame-Options: SAMEORIGIN`. Other parent origins, including local
HTTP SiteDock, remain blocked. This policy does not change API authentication,
CORS, or database permissions. Standalone access continues to work.

If SiteDock moves to another host, update the explicit allowlist in
`backend/src/app.ts`, update its tests, build, and restart the deployed backend.
Changing only the local checkout does not update the running home-server instance.

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

### Protected deployment settings

API-key authentication remains the default. Set `WEBOPTIONS_AUTH_MODE=access`
on the backend and build the frontend with `VITE_AUTH_MODE=access` only for the
approved host deployment. Access mode skips `opt.api_key` lookups and reports
`{"authMode":"access","label":"Deployment platform access"}` from `/api/me`.
It does not claim a database user or an authenticated person's identity.
The browser sends no API key in this mode. The outbound Portfolio service key
is still required and remains server-side.

Access mode requires a literal loopback bind and an explicit comma-separated list
of exact HTTPS origins. Every mutating request requires an allowed `Origin`,
including non-browser callers. Missing, `null`, wildcard and lookalike origins are
rejected before routing. CORS permits only that list. Embedding permission is a
separate allowlist and doesn't grant API write access.

The parent deployment must verify Cloudflare Access on
`https://web-options.jimlertech.com`, including intended API policy exceptions,
and Tailscale access controls on
`https://jimbrownhome1.tail8ad282.ts.net:8797`. Both proxies must point to
`http://127.0.0.1:18797`; never expose the origin publicly. Access mode trusts these
external boundaries and does not validate Cloudflare JWTs or identity headers.
Trade links use `https://web-portfolio.jimlertech.com`.

For the hosted installation, use the recorded release procedure below, including
for frontend-only updates. Its build uses `npm run build:frontend:access` from the repository
root. This selects the checked-in `frontend/.env.access` profile, so a rebuild cannot
accidentally restore the API-key prompt by omitting a shell environment variable.
The ordinary frontend build keeps API-key mode for other installations.

### Recorded hosted releases

After committing and pushing, release the exact pushed commit through
[Solution Deploy](https://github.com/purduepete/solution-deploy/blob/main/docs/Deployment.md#one-entry-point-existing-procedures):

```powershell
& C:\Files\Dev\main\solution-deploy\Deploy.ps1 -Action Release `
    -App web-options -Component web -Target jimbrownhome1 -Commit <full-pushed-commit> `
    -TailscaleUrl 'https://jimbrownhome1.tail8ad282.ts.net:8797/' `
    -ApproveRelease -ApprovalReason '<approved change>' -DatabaseChangesReviewed
```

Database changes require independent review before execution. For a release
without database changes, say so in the approval reason. Selecting `web` leaves
the collector unchanged.

Do not copy builds into `current` or an existing release folder, or invoke the
launcher below as a replacement for a recorded release. Verify both access
paths, `state\common-release.json`, and the `web-options` web component in
Solution Directory's `/deployments.json`. Its commit and completion time must
match the release receipt. A missing/stale record or record-write warning
means deployment verification is incomplete. `NoChanges` retains the prior date.

### Runtime settings and launcher

Keep protected settings JSON outside the repo and release, readable only by
administrators and `NT AUTHORITY\LOCAL SERVICE`:

```json
{
    "Environment": {
        "DB_SERVER": "sqlgkhw25ijhyzzy.database.windows.net",
        "DB_NAME": "webportfolio",
        "DB_USER": "weboptions_ro",
        "DB_PASSWORD": "<existing password>",
        "WEBOPTIONS_AUTH_MODE": "access",
        "WEBOPTIONS_ALLOWED_ORIGINS": "https://web-options.jimlertech.com,https://jimbrownhome1.tail8ad282.ts.net:8797",
        "WEBPORTFOLIO_API_URL": "<existing Portfolio API URL>",
        "WEBPORTFOLIO_SERVICE_KEY": "<existing outbound service key>"
    }
}
```

`scripts\Start-Deployment.ps1 -ReleasePath <release> -SettingsPath <protected-json>
-NodePath "C:\Program Files\nodejs\node.exe"` runs the built
`backend\dist\server.js` in the foreground and serves `frontend\dist`. It pins
loopback port 18797 and Pacific time, restores its process environment on exit,
and makes no SQL, credential, user or schema changes. The settings dictionary
accepts only the keys above. Use a machine-wide Node install.

The parent creates the boot-triggered task as `NT AUTHORITY\LOCAL SERVICE` with
`pwsh.exe -NoProfile -NonInteractive -File <release>\scripts\Start-Deployment.ps1`
and the arguments above. Grant that account read/execute on the release and Node,
read on the protected JSON, and configure restart on failure. This launcher
creates no scheduled task, proxy, route or database objects. Verify `/healthz`,
`/readyz`, both external access paths and SiteDock embedding during deployment.

### Existing local deployment

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

# Appearance

System follows the OS live; Light, Midnight and optional gray Dark remain selectable.
The header palette icon, first in the header tools before Search and Reload, opens a
segmented theme picker with one text-only row
ordered Light, Dark, Midnight, System. Selecting a theme keeps
the picker open; press the palette icon again, click outside, move focus outside,
or press Escape to close it. The header reload button uses the two-arrow refresh
icon and reloads the page.
On phones, the theme popup spans the navbar's safe-area gutters rather than
extending left from the palette button; short screens can scroll its contents.
Midnight is the default. Preferences use plain strings in `config_theme_preference`;
legacy JSON-quoted preferences are accepted. Switching resolved themes restores
Midnight Blue in Light and Steel Blue in either dark theme. A custom color can still
be selected within each theme. The pre-paint script and provider set matching classes,
color scheme, browser chrome and backgrounds. Deploy the complete `frontend/dist`.
Installed iOS status-bar rendering still needs device verification.
