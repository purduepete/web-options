# Weekly Wrap-up

The Weekly Wrap-up page reads imported publisher reports. It includes puts only
from **Management Plan**, **Closed Trades**, and **Rolls**. Weekly Overview and
Disclaimer are ignored. Calls and combined put/call summaries are excluded.
Closed Trades keeps its controlled-exit table separately from profitable closes.
These are publisher examples, not your holdings or returns.

## Import a workbook

In an agent session opened on this repository, run
`/weekly-wrapup <weekly-report-url>`. The repository skill in
`.agents/skills/weekly-wrapup/SKILL.md` finds the linked workbook, reuses the
importer below, validates it locally, then publishes through the managed SSH
transport and verifies the live app. A URL request authorizes a new report import;
replacing changed content for an existing report still requires confirmation.
Use a preview-only request to stop before live publication. The app must already
have the weekly-wrap-up feature deployed; the skill does not deploy it.

Download the `.xlsx` from the source report through your authorized access.
The importer uses Python 3's standard library. It does not need database access
or additional packages. From the repository root, preview an import:

```powershell
python .\backend\tools\import_weekly_wrapup.py 'C:\Downloads\weekly-report.xlsx' `
    --source-url 'https://themultiplier.substack.com/p/source-report'
```

Inspect the printed put counts and exclusions. Publish the validated report:

```powershell
python .\backend\tools\import_weekly_wrapup.py 'C:\Downloads\weekly-report.xlsx' `
    --source-url 'https://themultiplier.substack.com/p/source-report' `
    --confirm
```

The default destination is
`C:\ProgramData\SolutionDeploy\apps\web-options\shared\weekly-wrapups`.
Run this on the host as an authorized operator, or use `--directory` for a local
preview folder and transfer the validated JSON using the Solution Deploy SSH
transport. This is a manual operation; no collector task is added or changed.
Do not copy into a release folder.

Before a hosted release, verify the existing shared-folder configuration and
ACLs: the web service needs read access to these reports; only the operator
import identity needs write access. No live permissions are changed by this
feature. The service never creates or writes report files.

The reporting period's end date identifies a report (`YYYY-MM-DD.json`).
An exact source hash repeat is unchanged. Changed content for the same report
requires `--replace --confirm` after reviewing the new preview. Validation
finishes before a same-directory atomic replacement. A failed parse or write
retains the prior report. Keep source workbooks in your chosen permanent backup
location if you need to reimport them.

## Runtime configuration

`WEBOPTIONS_WRAPUP_DIRECTORY` overrides the read directory. The deployment
launcher's environment allowlist supports it. The default is the persistent
shared folder above, outside the versioned releases. For local development:

```powershell
$env:WEBOPTIONS_WRAPUP_DIRECTORY = 'C:\Data\web-options\weekly-wrapups'
```

The existing authentication boundary protects both read endpoints:

- `GET /api/weekly-wrapups`: report index, newest first.
- `GET /api/weekly-wrapups/:id`: one validated report.

A missing import directory means no reports have been imported. Malformed files
produce a logged server error and an error in the page, rather than an empty
report. There is no upload or write API.

## Live Signals association

Live Signals uses only the newest imported report's Management Plan. A match
requires the same symbol, put type, strike, and expiration, and applies only to
Top Picks published before the current local Monday. Signals from the current
week or later never receive guidance, even when viewing a historical report.
Contract expiration does not determine eligibility. Calls, incomplete contracts,
non-Top Picks, and unmatched signals have no weekly-guidance badge. Closed Trades,
Rolls, and archived reports do not supply badges.

Cards show a compact title-case label such as `Red - Take Shares` or
`Green - Close`. Hover or keyboard focus opens the shared themed tooltip with
only `Weekly Guidance`, the zone/action labels, and the guidance date range.
Notes, quote dates, categories, and source links remain in the card's detail panel.
Unrecognized zones remain neutral and say Unclassified. Separate
source notes remain separate, including conflicting guidance for one contract.
Each existing signal card has at most one guidance badge. Repeated zone/action
labels appear once in that badge; conflicting zones keep their own labeled colors.
Signal cards are neither added nor combined by this association.
The detail panel shows each note, its quote date, and a link that opens and
focuses the exact Management Plan row.

This is contract-level publisher guidance. The source has no original signal
date, so a badge does not identify a particular entry or your own position.
Dates remain visible even when the latest imported report is old. A guidance
read failure is shown with a retry action while signal data stays available.

## Parsing and dates

The importer supports the inspected workbook's headers and explicit table
layouts. Unexpected headers, malformed put rows, unsupported dates, or required
formula cells without cached values fail the import with a sheet/row error.
Only P-to-P rolls are retained. The position field determines type, never the
ticker. Repeated contract rows remain separate, using sheet and source row.
The importer counts excluded call rows and metadata/summary rows without
publishing their contents.

Management Plan shows its guidance period and closing quote date. Closed Trades
and Rolls show their own historical reporting periods. The report selector uses
the Closed Trades reporting period; there is no assumed fixed week offset.

Yearless opening dates use the latest occurrence on or before the historical
period end; expiration dates use the next occurrence on or after the quote date
(Management Plan) or reporting start (Closed Trades/Rolls). Both use a window
shorter than 365 days. The source period determines the year, never the host clock.
An unresolved date requires a corrected source workbook with an explicit year
within that supported window. Year-boundary expirations and prior-year openings
are tested. Excel serial dates and unrecognized layouts are rejected explicitly.

Source monetary values and percentages retain their supplied units. There are
no derived financial totals. Close-leg P&L and roll transaction net are shown as
separate measures and must not be added together. The importer never executes
formulas, macros, external links, or embedded content. Workbook size,
decompressed size, entry count, row count, and cell lengths are bounded.

## Focused validation

```powershell
python -m unittest discover -s backend\test -p test_weekly_wrapup_import.py -v
npm test -- backend/test/wrapup-routes.test.ts frontend/test/WeeklyWrapupPage.test.tsx frontend/test/weeklyGuidance.test.tsx frontend/test/LiveSignalsPage.test.tsx frontend/test/TradeDetail.test.tsx
npm run typecheck
```

Use synthetic fixtures for committed tests. A publisher workbook used in a
local review stays outside the repository. No database changes are required.
