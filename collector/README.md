# Local combined option collector

## Dashboard history reader

The Web Options Contract History page reads retained broker quotes through
`sd_web_options_reader`. The collector continues writing through its existing
runtime role. No collector schedules or broker sessions are changed by the page.
`history_schedule` exports the existing calendar as JSON without broker/database
access, for example:

```powershell
python -m collector.history_schedule --from 2026-10-21 --to 2026-10-23
```

Reader provisioning is a separate operator step. Independently review
`database\postgres\004_history_reader.sql`, `provision_history_reader.py` and any
authentication-file changes before running them. Start without `--confirm`.
The administrator passfile and new reader passfile belong on the host's protected
disk, never in a release, repo or command-line password. Lock the parent
directory ACL first. Retained roles, credentials or HBA backup files cause an
abort and require inspection before retrying.

```powershell
python -m collector.provision_history_reader --admin-passfile <protected-admin-pgpass> --passfile <protected-reader-pgpass> --migration database\postgres\004_history_reader.sql
```

The reader has specific SELECT grants, a 3-connection limit, a read-only default,
and a 10-second statement timeout. Owner payloads and account identifiers are
excluded. Verify schema CREATE, database TEMP, write privileges and payload reads
are denied, and that other-database connections are rejected before activation.
Existing collector grants must remain unchanged.

For application rollback, restore the previous Web Options release and protected
settings first; leave the collector alone. If removing reader access is necessary,
review the exact rollback independently: check for active dependencies, remove
only this reader's HBA lines, validate/reload the file, revoke its grants in
`web_options`, and remove only `sd_web_options_reader`. Never drop history tables,
the database, or collector roles. Keep the protected HBA backup for the record.

## Monitoring

The nightly Azure comparison audit was removed on 10/29/2026 after its timing
caused repeated false failures. Its saved reports under `shared\logs\audit` and
the `azure_option_observation` rows stay as history. SolutionDeploy's collector
monitor now alerts on local data: missing or overdue tasks, a stale heartbeat,
and close, settle or session runs that finish incomplete. See
`solution-deploy\docs\CollectorReliability.md`.
This worker runs on `jimbrownhome1`, separate from the existing dashboard.
Tastytrade REST supplies prices and a bounded DXLink Greeks subscription supplies
delta and IV. When both REST attempts leave a price crossed or absent, the same
DXLink connection subscribes the `Quote` event for those contracts and stores the
first valid bid/ask, flagged `stream_quote`, with mark set to the midpoint. Azure SQL is a temporary, SELECT-only discovery source for active
tracked VADER puts and eligible open live/paper sell-to-open CSP positions.
Discovery failure blocks collection because current ownership/closure is unknown.
Implementation is tracked by [#4](https://github.com/purduepete/web-options/issues/4),
under [web-portfolio#645](https://github.com/purduepete/web-portfolio/issues/645).

Berkshire class B aliases (`BRK-B`, `BRK.B`, `BRKB`) retain their original
VADER identity in storage. Tastytrade requests use the verified option root
`BRKB` (including DXLink) and underlying equity symbol `BRK/B`.

## Setup and activation

Use Python 3.14.8 in an isolated virtual environment:

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
This release also requires migration 002 below before activation. The updated
isolation probe requires ledger versions 1 and 2 and checks all six new tables,
including UPDATE/DELETE/TRUNCATE denial on immutable evidence.

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

The installer requires SolutionDeploy's shared
`C:\ProgramData\SolutionDeploy\control\framework\src\CollectorAccess.psm1`
(`-CollectorAccessModulePath` overrides it) and uses managed PowerShell at
`C:\ProgramData\SolutionDeploy\runtime\powershell\7\pwsh.exe`, never PATH discovery.
Before registering tasks it grants SID `S-1-5-19` RX only on the selected release,
then uses a temporary LOCAL SERVICE task to open code, dependencies and external protected
config and test a disposable log file. Failure restores original release ACLs and leaves
existing collector tasks unchanged. The printed ACL snapshot permits later rollback.
SolutionDeploy's standalone `scripts\Test-CollectorAccess.ps1` checks access without running
collectors or database isolation probes.

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
only a due capture or existing in-session recovery; it refuses activation when `enabled` is false.
`status` is read-only. The watchdog checks heartbeat and unresolved capture errors
and logs the reason. SolutionDeploy's collector monitor sends the alerts. A partial, failed or
missed slot stops counting as unresolved once a later recovery run completes.
During a PostgreSQL outage, a small diagnostic marker in `shared\logs` prevents
repeated outage notifications. It contains no credentials or market records.

`sync` refreshes the local contract/signal/position-owner mirror without a broker connection.
It writes only PostgreSQL and uses the same process lock as capture. This allows
source validation before broker activation.

Logs from the task launcher are in `shared\logs\collector-<action>.log`.
SDK exception messages are not logged because they may include credentials.
Nonzero exits and explicit status distinguish partial or failed collection.

## History and quality

- An exchange calendar defines holidays, early closes and daylight saving.
  Ordinary sessions have 39 ten-minute captures from 6:35 AM to 12:55 PM
  Pacific, plus a 1:00 PM closing snapshot. Intraday slots sit 5 minutes off
  webportfolio's Azure option job (:00, :10, :20...), which uses the same
  Tastytrade account, so the two broker sessions never run together. Nothing
  runs between the open and 6:35. A closing snapshot is an observed quote, not an
  official closing print or guaranteed execution.
- The entire distinct union also has a 13:10 Pacific `settle` slot every weekday,
  including exchange holidays. Regular days have 41 slots; the Friday after
  Thanksgiving has 23, and weekday full-day holidays have only settle.
  Weekends have none. Actual early close replaces 13:00. The kind was
  `closing_1315` at 13:15 until migration 003 (web-options#16).
- Actual-close and settle each retain their full 5-minute windows. Only
  strictly pre-close intraday/recovery windows stop at actual close.
- Normalize broker OCC before REST batches and Greek subscriptions. Each
  distinct contract is requested once per component attempt, using one broker
  session. Only unsuccessful components are retried. Successful observations
  fan out to all owners. Coincident scheduled purposes share an observation
  while retaining separate run rows and deadlines.
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
- Expiration day is included through 13:15 and the rest of its Pacific date;
  exclude the contract on the following Pacific date. Discovery also requires
  current source eligibility. Closed positions and inactive tracked contracts
  leave the next successfully discovered universe, without deleting history.
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

## Storage upgrade and rollout gates

`database\postgres\002_combined_option_universe.sql` is additive and rerunnable.
It adds `broker_contract`, `option_owner`, `broker_option_quote`,
`option_capture_owner`, `broker_quote_diagnostic`, and `azure_option_observation`,
plus one allowed run kind.
It leaves all VADER identity, signal revision, imported entry metadata and old
`option_quote` history untouched. New independent observations are in
`broker_option_quote`, keyed by canonical broker OCC, not by a fabricated VADER
signal. `option_capture_owner` freezes the original contract key, signal/report
identity or user/account/live-paper/transaction metadata for every run.
Join on `(run_id, contract_key)` to fan out observations. Old quote consumers
remain unchanged; consumer cutover is outside this change.

Do not use initial `collector.provision` to upgrade an existing database.
After independent review, a separate deployment operator applies migration 002
to `web_options` as `sd_web_options_migrator` using its protected passfile and
`psql -v ON_ERROR_STOP=1 -f database\postgres\002_combined_option_universe.sql`.
The short first transaction installs the widened capture-kind check as
`NOT VALID`, enforcing new writes immediately without scanning historical rows
under its exclusive lock. A separate transaction validates existing rows.
Both transactions have a 5-second lock timeout and 30-second statement timeout.
If validation times out, the new-write check remains enforced; retry the migration
before activation. Existing inserts are permitted during the validation scan.
Runtime gets SELECT/INSERT on `broker_contract`, UPDATE on only its `synced_at`
column, SELECT/INSERT/UPDATE on `option_owner` and `broker_option_quote`, and
SELECT/INSERT on immutable run-owner/diagnostic records, with sequence usage.
It receives no DDL, DELETE, role membership or object ownership.

Before activation:

1. Verify a current restorable `web_options` backup. Stage an immutable committed
   Python 3.14.8 release inactive while the old worker keeps running.
2. Independently review the migration, runtime grants, source query inventory
   below and any source SELECT grant. Apply them separately, then verify
   schema version 2 and runtime isolation. Neither worker startup nor this
   implementation applies migrations or changes source permissions.
3. Run `dryrun` with the runtime Azure reader. Reconcile distinct OCC count and
   every owner against the source. Prove broker coexistence in a due window.
4. Back up protected config and current task/release references; switch the
   existing tick/watchdog to the committed release serially. Verify LOCAL SERVICE
   execution, one broker session, first due run and owner coverage, original
   deadlines, early close/holiday schedule and backup inclusion.
5. Roll back by restoring prior task/config references. Retain additive schema
   and observations. Keep Azure and Telegram ingestion running throughout.

No deployment, live DB writes, grants, commits or pushes were performed by this
implementation. Entry capture, 07:50 backstop, Alpaca and price fallbacks are absent.

## Source SELECT inventory

Exact parameterized SQL is in `source.py` (`TRACKED_QUERY`, `QUERY`,
`POSITION_QUERY`). Each expiration comparison uses the slot's Pacific date,
including same-day expiration. Three reads must all succeed before the local
mirror transaction changes current membership.

| Object                          | Required columns/purpose                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opt.telegram_tracked_contract` | contract_key, symbol, option_right, strike, expiration, first_seen_date, is_active; all active tracked puts, even without a current signal                                                                                                    |
| `opt.telegram_signal`           | signal_key, contract_key, symbol, expiration, strike, report_date, tier, profile, is_top_pick, premium, annualized_yield, collateral, dte, delta, is_current, parse_status, option_right, strategy_type; current parsed CSP put signal owners |
| `opt.telegram_entry_quote`      | contract_key, report_date, mark, delta, implied_volatility, bid, ask, underlying_price, is_illiquid_quote, captured_at_utc; imported entry metadata only                                                                                      |
| `dbo.option_transactions`       | id, authenticated_user_id, account_id, is_paper, symbol, expiration_date, strike_price, transaction_date, contracts, status, action; open sell_to_open rows for both is_paper values                                                          |
| `opt.telegram_contract_price`   | contract_key, price_date, captured_at_utc, market_session, bid, ask, mark, mid, last_price, underlying_price, delta, implied_volatility; comparator only                                                                                      |
| `dbo.option_daily_price`        | option_transactions_id_live, option_transactions_id, price_date, created_at, bid, ask, mark, mid, last_price, delta; portfolio comparator only                                                                                                |

The portfolio table is CSP-put-only by the upstream function's contract; there
is no option-right column to filter. This matches the upstream
`get_current_position_options` / `get_open_option_positions` selection, adding
same-day-inclusive expiration eligibility. No accounts/user JOIN or grant is needed.

The configured `weboptions_ro` normally already has SELECT on `opt`. Verify
effective permissions rather than assuming the protected config uses that login.
If needed, the DBA-reviewed grants are:

```sql
GRANT SELECT ON OBJECT::opt.telegram_tracked_contract TO [weboptions_ro];
GRANT SELECT ON OBJECT::opt.telegram_signal TO [weboptions_ro];
GRANT SELECT ON OBJECT::opt.telegram_entry_quote TO [weboptions_ro];
GRANT SELECT ON OBJECT::opt.telegram_contract_price TO [weboptions_ro];
GRANT SELECT ON OBJECT::dbo.option_transactions TO [weboptions_ro];
GRANT SELECT ON OBJECT::dbo.option_daily_price TO [weboptions_ro];
```

The last grant is the new cross-schema requirement. Retain existing write/ALTER
denials. Grant only to the actual configured reader and never copy administrator
credentials into the worker. Run the repository's readonly permission verification
after approved grant execution. Azure discovery remains a runtime dependency.

## Evidence and acceptance

Price, delta and IV retain separate receipt/event times, flags and errors.
The broker summary date, prior-close date and last-trade timestamp are stored
when supplied. A successful REST response omitting a requested contract records
`successful_response_without_contract` plus `provider_no_quote`; it remains
missing and retryable. A holiday is always attempted, never predeclared success.
An empty eligible universe after successful discovery is `no_work`.
Greek timeout alone cannot prove a valid no-data outcome, so the run stays partial.

Stale event flags are evidence, not an off-hours rejection or proof of freshness.
At close/settle require field-specific relevant completed-session date evidence;
missing date evidence stays unknown. Same-day terminal quotes remain stored,
including expiration day after close. Availability counts do not assert date or
value parity. Off-hours comparison needs matching source purpose/run, receipts
within 60 seconds and the same completed-session date. Regular-session comparison
also needs event timestamps within 60 seconds. Compare only intraday slots that
follow an Azure write, and the tracked subset at settle. Portfolio-only
settle coverage has no Azure parity claim. Keep no-data, missing, unmatched and
numeric comparison denominators separate.

Parent read-only DDL inventory confirms Azure closing prices `decimal(18,6)` and
delta/IV `decimal(9,6)`. Compare after rounding to 6 decimal places
(half-unit 0.0000005), with the plan's price agreement tolerance of $0.01.
Portfolio transaction delta is `decimal(10,4)`, a separate source field.
Actual sustained 10-weekday coverage/freshness/parity and first live capture
remain unverified until reviewed rollout and observation.

The `compare` command was removed on 10/29/2026; the evidence it wrote stays in
`azure_option_observation`. `compare --run-id` snapshotted the eligible tracked 13:15 Azure rows with a
read receipt into append-only `azure_option_observation`; missing rows are
explicit payloads. Later calls reuse the first immutable observation. It writes
only that local evidence table, never Azure or local quote fields. Invoke within
60 seconds of the local price receipt while the source's same-purpose row is
still present. Separate field counts distinguish numeric match, mismatch,
coverage failure and both-missing. Results remain inconclusive when source-run,
receipt or field-session-date evidence is unavailable, even with equal values.
No comparator observations were gathered during implementation. Parent reports
reviewed SELECT grants applied to `weboptions_ro` for option_transactions,
telegram_tracked_contract, telegram_contract_price and option_daily_price, with
write/ALTER permissions still absent, plus a successful verified full backup
at 18:46 Pacific on October 20. Those operations were performed by the parent,
separately from this workstream.

Read-only live inventory confirms `dbo.option_daily_price` prices `decimal(18,6)`,
delta `decimal(10,4)`, separate live/paper transaction foreign keys, a DATE
`price_date` and DATETIME `created_at`. The source MERGE updates the same daily
row without a write timestamp or run identity. `compare` snapshots its raw rows
per immutable local-run owner for intraday slots from 07:35 to 12:55, each 5
minutes after an Azure write. The stored dataset name stays `portfolio_halfhour`
so earlier evidence rows still match. It rounds
portfolio delta to 4 decimals, and reports numeric results separately. Its
same-run gate is always unverified because `created_at` cannot prove which
Azure run last updated the row. IV and underlying are absent from that source contract.
Azure
tracked closing rows also lack field-specific broker session dates, so their
off-hours date gate stays unverified. Actual-close and pre-07:35 local history
have no Azure portfolio slot. Additional portfolio-only settle contracts have
no Azure tracked counterpart.
