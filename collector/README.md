# Local VADER collector

This worker runs on `jimbrownhome1`, separate from the existing dashboard.
Tastytrade REST supplies prices and a bounded DXLink Greeks subscription supplies
delta and IV. Azure SQL is a temporary, SELECT-only signal discovery source.
Known local contracts continue to be priced if discovery fails.

## Setup and activation

Use Python 3.13 in an isolated virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r collector\requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest collector\tests -q
.\.venv\Scripts\python.exe -m ruff check --no-cache collector
```

Production installs only `collector\requirements.txt`. Copy the shape in
`config.example.json` into a protected file outside the release, never a tracked
file. Keep the Azure login SELECT-only. Configure direct Tastytrade OAuth
credentials and Pushover credentials there. Runtime uses a protected PostgreSQL
passfile, not a command-line password.

Before provisioning, independently review `provision.py`, the PostgreSQL migration,
the isolation probes and the collector's write behavior. On the database host,
the administrator may run the provisioning dry run, then its reviewed confirmed
operation. Do not run this as part of worker startup.

```powershell
python -m collector.provision --admin-passfile <protected-admin-pgpass> --secrets <protected-directory> --migration database\postgres\001_option_history.sql
```

The confirmed operation needs `--confirm`. It creates only `web_options` and
`sd_web_options_owner`, `sd_web_options_migrator`, `sd_web_options_runtime`.
First-match HBA rules restrict the two new logins to this database over loopback;
existing roles and their authentication rules stay unchanged. It retains a
protected `pg_hba.conf.before-web-options` backup and role-specific passfiles.

Secret directory ACLs must initially allow Administrators and SYSTEM only.
After provisioning, give LOCAL SERVICE directory traversal/read and read access
to **only** `collector.json` and `sd_web_options_runtime.pgpass`. Do not give it
access to the migration password or administrator credentials. Grant worker
write access to its own shared logs directory, never to its code or secrets.

The following is an activation gate, including every existing database on IPv4
and IPv6:

```powershell
python -m collector.verify_database --admin-passfile <protected-admin-pgpass> --secrets <protected-directory>
```

If provisioning fails, leave collection disabled. Inspect retained roles, files,
database, schema and HBA rules before retrying. If a passfile exists but its role
has no password, an administrator can apply a new SCRAM verifier derived from
that retained password, after independent review. Do not reset a password or
delete roles/files automatically. Destructive cleanup needs a separately reviewed
exact action. Never copy a credential into logs or a command line.

The second activation gate is a recorded broker compatibility probe overlapping
a real existing broker job: neither session displaced, both jobs inside their
capture windows, and existing coverage unchanged. An uncertain result leaves the
worker disabled until a safe exclusive schedule or coexistence is verified.
Only then set `enabled: true` in the protected configuration and install the
tasks with `scripts\Install-CollectorTasks.ps1 -EnableCollection`.

The installer registers a one-minute collector tick and a separate one-minute
watchdog under `\JimlerTech`, running as LOCAL SERVICE without sign-in. Without
`-EnableCollection` both tasks are registered disabled.

## Commands

Run from the release root with the worker's virtual-environment interpreter:

```powershell
python -m collector dryrun --config <protected-config>
python -m collector sync --config <protected-config>
python -m collector tick --config <protected-config>
python -m collector status --config <protected-config>
python -m collector watchdog --config <protected-config>
```

`dryrun` reads discovery metadata and prints counts and scheduled local times.
It never opens a broker connection or writes either database. `tick` performs
only a due capture or recovery; it refuses activation when `enabled` is false.
`status` is read-only. The watchdog checks heartbeat and unresolved capture errors
and sends operational notifications, not trading alerts.

`sync` refreshes the local contract/signal mirror without a broker connection.
It writes only PostgreSQL and uses the same process lock as capture. This allows
source validation before broker activation.

Logs from the task launcher are in `shared\logs\collector-<action>.log`.
SDK exception messages are not logged because they may include credentials.
Nonzero exits and explicit status distinguish partial or failed collection.

## History and quality

- An exchange calendar defines holidays, early closes and daylight saving.
  Ordinary sessions have 13 half-hour captures from 6:30 AM Pacific, plus a
  1:00 PM closing snapshot. A closing snapshot is an observed quote, not an
  official closing print or guaranteed execution.
- Capture windows end 5 minutes after their slot; intraday/recovery windows stop
  at session close. Late components never populate earlier snapshot fields.
- Prices are **per share**. `advertised_premium_per_contract` is VADER's advertised
  per-contract entry premium. Actual entry marks remain nullable.
- Put delta is signed, from -1 to 0. `implied_volatility_fraction = 0.25` means
  25% annualized IV. IV above 100% is valid. Provider-supplied zero is retained
  and flagged for Greeks.
- Each component has its own status, event time when available and receipt time.
  REST and Greeks are separate observations, not an atomic market event.
  Missing provider time means unknown freshness. Stale, wide and crossed
  observations are flagged. Availability counts do not imply executable quotes.
- Keep valid partial components, retry missing components within the same run
  window, and never overwrite successful components. Missing prices/Greeks are
  not filled with yesterday's values or VADER's advertised values.
- A PostgreSQL session advisory lock prevents concurrent streams. A contending
  process logs and exits without stealing the lock. Connection loss releases it.
- Expiration day is included through the close. Discovered contracts stay in
  collection until expiration even when their source recommendations change.
  Separate signal metadata and revision records preserve provenance.
- History is retained indefinitely. Missed slots are recorded with no fabricated
  prices. Recovery during an open session gets its own actual capture timestamp;
  recovery after the closing window cannot reconstruct that close.

## Backup and deployment

Deploy committed worker code under the existing Web Options app's permanent
release tree and keep its virtual environment/runtime outside writable release
code. The web app does not need a restart or route change.

The host's nightly PostgreSQL backup discovers all connectable application
databases. Verify that `web_options` appears in a successful backup manifest,
including its existing restore/count checks, before reporting backup coverage.
The source Azure database and existing dashboard remain unchanged.
