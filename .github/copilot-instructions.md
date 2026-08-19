# WebOptions repository instructions

## Upstream data: the webportfolio repo

The signal data this app renders is produced by a separate app, **webportfolio**,
checked out at `C:\Files\Dev\main\webportfolio`. That repo owns the ingest jobs,
the Azure SQL database, and every `opt.telegram_*` table. WebOptions is a reader.

- Workspace search tools cannot reach outside this folder. To search webportfolio,
  use terminal commands rather than the grep/file search tools.
- Both apps share one PROD database, `sqlgkhw25ijhyzzy.database.windows.net` /
  `webportfolio`, schema `opt` (never `dbo`).
- This repo connects as `weboptions_ro`, which holds `SELECT` on the `opt` schema,
  an explicit `DENY INSERT, UPDATE, DELETE` on every other schema, and a
  database-scoped `DENY ALTER`. Never write to the shared tables from here. See
  [003_grant_readonly_user.sql](database/migrations/003_grant_readonly_user.sql)
  and [009_grant_caution_symbol_write.sql](database/migrations/009_grant_caution_symbol_write.sql).
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
- The day-card calendar uses row subgrid for vertical alignment. Responsive rules
  may change its columns, but must not remove or replace its subgrid rows.

Run `npm test -- --run frontend/test/responsive-css.test.ts frontend/test/grid-css.test.ts frontend/test/safe-area-css.test.ts`
after changing page markup or CSS, then run `npm run build:frontend`.

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
  `auto` margins split the free space in one row.
- **`Loading` already waits 250ms** before it shows, so a fast answer flashes
  nothing. Do not add a second delay, and do not mount it where an element that
  reserves the same space would do.
