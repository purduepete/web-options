# WebOptions repository instructions

## Commit, push and deploy

For the existing jimbrownhome1 installation, "commit, push and deploy" requires
the recorded common release workflow. This applies to frontend-only changes too.
After committing and pushing, resolve the exact full commit and run:

```powershell
& C:\Files\Dev\main\solution-deploy\Deploy.ps1 -Action Release `
    -App web-options -Component web -Target jimbrownhome1 -Commit <full-pushed-commit> `
    -TailscaleUrl 'https://jimbrownhome1.tail8ad282.ts.net:8797/' `
    -ApproveRelease -ApprovalReason '<approved change>' -DatabaseChangesReviewed
```

Follow the shared [deployment procedure](https://github.com/purduepete/solution-deploy/blob/main/docs/Deployment.md#one-entry-point-existing-procedures).
Review database changes independently before running them; for changes without
database work, state that explicitly in the approval reason.
Select only `web` for UI/backend changes. Leave collector tasks and releases
unchanged unless collector deployment was requested.

Never copy a local build into `current` or an existing release folder. A build,
file copy, task restart or passing health check does not complete deployment.
Do not edit release dates or metadata to make an unrecorded copy look recorded.
Build and launcher scripts are internal steps, not substitute release commands.

Before reporting completion, verify both Tailscale and Cloudflare and read
Solution Directory's `/deployments.json`. Require this app's `web` release commit
to match the requested commit and its completion time to match the release
receipt, displayed in local time. Confirm `state\common-release.json` agrees.
On `NoChanges`, retain the existing date and explain that nothing was released.
If the record is absent, stale or a record-write warning occurs, report the
deployment as incomplete and investigate; do not silently retry or fabricate
a release record.

## Collector deployment and runtime changes

Follow the shared [collector reliability procedure](https://github.com/purduepete/solution-deploy/blob/main/docs/CollectorReliability.md).

- For collector task changes, use the current supported
  `C:\ProgramData\SolutionDeploy\installers\web-options\Install-CollectorTasks.ps1`.
  Do not manually repoint tasks or use an installer from a retained release.
  If the supported installer is broken or unsupported for the change, stop and
  escalate to Jim. These are procedural rules; they cannot prevent privileged
  manual changes.
- Before registering or switching any task, require a successful actual LOCAL
  SERVICE (`S-1-5-19`) preflight for every candidate release, Python interpreter,
  runtime or dependency path change, including new runtime versions and junction
  targets. Use the existing SolutionDeploy `scripts\Test-CollectorAccess.ps1`
  helper for permission-only work; the supported installer runs the same gate.
  The probe can apply scoped read/execute permissions and restores original
  release ACLs on failure, so it is not read-only.
- If preflight fails, retain the existing healthy task targets. Never grant
  blanket access across releases or loosen runtime permissions to bypass a
  failure. Do not rerun database activation or isolation probes solely to repair
  file permissions. Database-altering work requires separate independent review.
- Preserve disabled task states, activation approvals and deliberate compatible
  split targets across collector and watchdog tasks. Frontend-only
  deployments must not change collector tasks, releases or runtimes.
- Use the managed PowerShell runtime. Update shared framework code only through
  SolutionDeploy `scripts\Update-HostExecutor.ps1` to preserve its inventory.
  Instruction-only edits require no live redeployment or probe of an unchanged
  runtime.

## Upstream repo: webportfolio

The signal data this app renders is produced by a separate app, **webportfolio**,
checked out at `C:\Files\Dev\main\web-portfolio`. That repo owns the ingest jobs,
the Azure SQL database, and every `opt.telegram_*` table. WebOptions is a reader.

It is the upstream for style and behaviour as well. Where a screen, a URL shape, a
visual treatment, or a percentage definition exists in both apps, webportfolio's
version is the contract. **Read its source before building the WebOptions
equivalent**, because a hand-built version that looks right will still diverge on
the details that matter.

- Workspace search tools cannot reach outside this folder. To search webportfolio,
  use terminal commands rather than the grep/file search tools.
- Both apps share one PROD database, `sqlgkhw25ijhyzzy.database.windows.net` /
  `webportfolio`, schema `opt` (never `dbo`).
- This repo connects as `weboptions_ro`, which holds `SELECT` on the `opt` schema,
  an explicit `DENY INSERT, UPDATE, DELETE` on every other schema, and a
  database-scoped `DENY ALTER`. Never write to the shared tables from here. See
  [003_grant_readonly_user.sql](database/migrations/003_grant_readonly_user.sql)
  and [009_grant_caution_symbol_write.sql](database/migrations/009_grant_caution_symbol_write.sql).
- One object outside `opt` is readable: `dbo.stock_price`, granted by name in
  [012_grant_stock_price_read.sql](database/migrations/012_grant_stock_price_read.sql)
  so the navbar can show the VIX. Webportfolio's price-updater writes one row per
  symbol per session there; the VIX is under the symbol `VIX`, not in
  `dbo.historical_indices`, which has no VIX row at all.
- There is exactly one exception: the `optcfg` schema, which WebOptions owns
  outright and can write to. It holds `optcfg.caution_symbol`, the global caution
  list the app saves from Settings. A DENY at schema scope beats a GRANT at object
  scope, so a writable table cannot live in `opt` — anything new that WebOptions
  needs to write goes in `optcfg`. Widening the login further needs a reason.
- Migrations in `database/migrations` cover only what WebOptions owns: the `opt`
  schema itself, `opt.api_key`, the `opt.calendar_*` tables, and all of `optcfg`.
  Anything named `telegram_*` belongs to webportfolio; changes to it go in that
  repo.
- `npm run verify-readonly` connects as the service login and probes what it can
  and cannot do. Run it after touching any grant.
- Ad-hoc read-only queries: the password is in `.secrets\weboptions_ro.password`,
  and the server/database/user constants are in
  [scripts/weboptions.ps1](scripts/weboptions.ps1). Clear `DB_*` from the
  environment afterwards.

### Parity sources

Paths are relative to `C:\Files\Dev\main\web-portfolio`.

- `frontend/src/utils/optionResearchLinks.ts` owns the research link set and the
  `#trade_*` context hash the Tampermonkey overlays read, including the key order
  and each value's decimal places. Fidelity is the one exception: query parameters
  on `/ftgw/digital/exp-options-research/`, with no `trade_ticker`. Never
  hand-build one of these URLs.
- `frontend/src/pages/performance/OptionsWatchlist.tsx` and `CashSecuredPuts.tsx`
  are the canonical callers, and they define what the percentages mean.
  `underlyingChange` is measured against the prior close; `strikePct` against the
  strike, not the underlying.
- `frontend/src/pages/trading/OptionTrade.tsx` is where the Web Portfolio trade
  link lands, and it decides which query parameters that link has to carry.
- `scripts/tampermonkey/` holds the overlay userscripts that consume the context.
  They fix the parameter names, so renaming one here breaks them with no error.
- `frontend/src/index.css` puts the `.theme-midnight` rules outside `@layer` and
  marks them `!important`, so they beat the Tailwind classes written on the JSX.
  Read the stylesheet. The JSX on its own will mislead you.

## Option numbers: VADER's versus captured

Each signal carries two sets of numbers, and the UI toggles between them.

- `opt.telegram_signal` holds what VADER advertised: `delta`, `premium`,
  `annualized_yield`, `collateral`. Puts only (`option_right = 'P'`).
- `opt.telegram_entry_quote` holds the market as actually captured, one row per
  `(contract_key, report_date)`: `bid`, `ask`, `mark`, `mid`, `last_price`,
  `underlying_price`, `delta`, `implied_volatility`, `is_illiquid_quote`,
  `captured_at_utc`. WebOptions reads `mark`, `delta` and `is_illiquid_quote`.
- **Capture began 2026-08-05** and runs each trading morning. There is no
  backfill, and none is possible — an expired contract cannot be re-priced. Any
  date before that has signals but no captured numbers.
- `opt.telegram_contract_price` is the separate END-OF-DAY snapshot, one row per
  `(contract_key, price_date)` with a `market_session` of `regular_close` /
  `after_hours` / `missed` / `holiday`. WebOptions reads only the most recent
  `regular_close` row per contract, for the moneyness badge. The capture job that
  fills it lives in webportfolio, so a missing day is upstream, not a bug here —
  and today's signals never have a close until that evening.
- A missing quote is normal, not a bug: an individual contract can come back
  unquoted on a given morning. Treat a per-contract gap as data, and fall back to
  VADER's number with the `.value-quoted` dotted underline rather than blanking
  the figure.
- Differences between the two are only shown in `actual` mode, since in VADER's
  own mode there is nothing to compare against.

## Responsive UI contract

Every frontend page must work from a narrow phone through a large desktop. This
contract applies to existing pages and every page added under `frontend/src/pages`.

- Use a semantic `main` page root so shared viewport padding, safe-area insets,
  text wrapping, and page-entry behavior apply consistently.
- Build phone-first. At 320 CSS px wide, the document must not scroll
  horizontally and content must not be clipped or overlap.
- Do not give layout elements fixed `width` or `min-width` values. Use `%`,
  `min()`, `max()`, `clamp()`, `calc()`, or flexible grid/flex tracks. Fixed
  dimensions up to 48px are reserved for icons, spinners, and swatches.
- Flex rows containing headings, navigation, filters, pills, or actions must wrap.
  Inputs in those rows must be allowed to shrink to the available width.
- Fixed-count grids must collapse to one column by 640px. Prefer `auto-fit` with
  fluid `minmax()` tracks when the content can reflow without a breakpoint.
- Desktop-only layout rules above 1100px must also require a fine pointer or hover
  capability. Width alone does not distinguish a landscape tablet from a laptop.
- Keep touch targets at least 44px in both dimensions for coarse pointers. Do not
  hide controls behind hover-only interaction.
- Preserve `viewport-fit=cover` and use `env(safe-area-inset-*)` in addition to,
  rather than instead of, the normal page gutters.
- Long symbols, URLs, and user-provided text must wrap inside their column.
- A form control sizes itself from its own `size` or `cols` and will run off a
  phone rather than admit it does not fit, so nothing may rely on the intrinsic
  width of an `input`.
- An element placed by an inline `grid-column` cannot be reflowed by a media
  query: a card asking for column five makes the browser invent the tracks it
  needs, however narrow the template has been told to be. The week grid and the
  published calendar place their day cards that way, so below the full week the
  cards leave the grid altogether and stack as flex children, which makes every
  inline placement inert. Container and cards must leave together — a card that
  is still a grid item when its rows go collapses its whole contents onto one
  track, painting the day head, the rule and the first risk group on top of one
  another.
- A stacked order that differs from the desktop order is reordered in the DOM,
  never with `row-reverse`/`column-reverse`, so reading order and tab order stay
  with what is on screen. The week grid does this for the week in progress: on a
  phone its day cards render newest first, while a week already over, and every
  width that still shows the columns, keeps Monday first.
- A wrapper added so a phone can fold a run of controls away must cost nothing
  above its breakpoint. `display: contents` gives the wrapper up entirely, so
  every control stays a direct child of the head and keeps wrapping against the
  heading and the week navigation as before — but document order is now the
  wrapper's order, so anything the head used to interleave has to be put back by
  hand with `order`. The live signals head does exactly that for the week
  navigation and the symbol filter.
- `hidden` is only a default. The user-agent's `[hidden] { display: none }` is
  beaten by any later rule of equal specificity — a class that sets
  `display: contents` or `flex` — and always by an inline style. A wrapper that
  must be able to disappear needs its own `[hidden]` rule, and a fold cannot be
  built on an inline `display` at all.
- A control the fold hides cannot take focus, so a shortcut that focuses one
  opens the fold with `flushSync` first and focuses after the DOM has caught up.
- A text input does not centre its own text the way a button does. Give one a
  `min-height` to reach the 44px touch target and the line stays at the top of
  the box, taking the caret with it. Give the line box the height instead —
  `padding-block: 0` and `line-height: calc(44px - 2 * var(--border-width))` —
  so the text sits in the middle and still measures the same as the triggers
  beside it.

Run `npm test -- --run frontend/test/responsive-css.test.ts frontend/test/grid-css.test.ts frontend/test/safe-area-css.test.ts`
after changing page markup or CSS, then run `npm run build:frontend`.

## Control sizing contract

Two buttons sitting next to each other must never be two different heights, and
the way that happens is always the same: each one is given its own recipe.

- A button's height is the shared one in [index.css](frontend/src/index.css) —
  `padding: 0.4rem 0.6rem` on the inherited font — or, in a page head, the head's
  smaller one, `padding: 0.3rem 0.6rem` at `font-size: 0.8rem`. `.week-jump`,
  `.filters-toggle`, `.menus-reset` and `.owned-refresh-button` all use the head
  recipe and all measure 30.8px because of it.
- Vary colour, weight, horizontal padding and icons. Do not vary the vertical
  padding or the font-size on their own, because both feed the height.
- A `min-height` is not a way to size a button. The owned-contracts refresh
  button carried `min-height: 2.25rem` with `padding: 0`, which put it 5px taller
  than the filters trigger beside it. The only `min-height` a button should carry
  is the 44px coarse-pointer target, which `index.css` already applies globally.
- Icons inside a head button are 14-15px. An 18px icon in a 19.2px line box is
  the next thing that starts pushing a height around.
- Measure rather than eyeball: `getBoundingClientRect().height` across every
  `button` on the page should come back with one value per role, not per button.

## Page loading contract

A page should arrive once and hold still. Every rule below exists because a
reader watched something jump, flash, or fill in underneath them.

- **Settle once, not twice.** A page whose data comes in stages waits for the
  stages a reader would see as one arrival before it reveals anything. The
  summary page fetches the month index and then the month it opens; it holds a
  single spinner across both rather than spinning, resolving, and spinning again.
  Two spinners in sequence is the failure this rule prevents.
- **Once revealed, stay revealed.** Refetching under a changed filter must not
  send the page back to a spinner. Gate the first arrival only, and let later
  answers swap in place.
- **Fade the late data in.** The page frame animates itself through `main`, but
  data that lands after it needs the shared `enter` class or nobody sees it
  arrive. Both use the same opacity-only `enter` keyframe in
  [index.css](frontend/src/index.css) — no sliding, and both are switched off
  under `prefers-reduced-motion`. [motion-css.test.ts](frontend/test/motion-css.test.ts)
  guards this.
- **Never let a heading fill in.** A static title renders on the first frame. A
  title derived from data renders a full-length invisible spacer instead, so the
  head opens at the width it will keep — see `WEEK_TITLE_SPACER` in
  [format.ts](frontend/src/signals/format.ts). An empty heading that later gains
  text is the same jump by another name.
- **Withhold controls that lead somewhere the page has not reached.** The live
  signals summary link waits for the week, since there is nothing to leave yet.
- **A control that appears must not move the ones already there.** Put the single
  `margin-right: auto` that pins a control run on an element that is always
  present — a slot wrapper if the control itself is conditional. Never let two
  `auto` margins split the free space in one row. A control wide enough to
  rewrap the row, like the signals reset, stays rendered and takes
  `visibility: hidden` instead of leaving: it holds its width and gives up
  everything else, so nothing shifts when it comes back.
- **`Loading` already waits 250ms** before it shows, so a fast answer flashes
  nothing. Do not add a second delay, and do not mount it where an element that
  reserves the same space would do. A whole-page wait passes `page`, which
  covers the view with a fixed overlay in the page background. Refetches keep
  full opacity; do not dim stale results.
- **Route changes fade.** `Layout` fades the old view out over 250ms through
  `.route-fade[data-leaving]`, then the new `main` fades in over 0.6s. Tests
  that navigate wait for the new view with `findBy*`.
