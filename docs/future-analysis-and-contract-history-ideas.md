# Future analysis and Contract History ideas

Collected 10/28/2026 from GPT-6.1 Sol, Claude Sonnet 5.5 and Gemini 4 Argon. The proposals cover trade decisions and understanding the data already shown. Contract History items 4 and 6 were selected on 10/28/2026 and are implemented in this working tree. The remaining proposals are future candidates.

The visual gap report is [contract-history-gaps.html](./contract-history-gaps.html).

## What to build first

For buy and sell decisions:

1. **Advertised vs. captured quote** is a small Live Signals addition. Compare VADER's advertised premium and yield with the morning bid, ask and mark, and flag wide or illiquid quotes.
2. **Exit-target backtest by tier** compares take-profit percentages across the available outcomes. It answers which thresholds historically captured the most credit.
3. **Exit radar on Owned Contracts** shows each open position's current capture, peak, giveback and delta change. It can use the results of the exit-target backtest.

For understanding:

1. **Contract story** summarizes the selected contract's path using existing Best, Worst and Giveback calculations.
2. **Metric explainer** defines the page's percentages and badges with formulas and worked dollar examples.
3. **Why did it move?** estimates the contribution from the underlying move and labels the remaining change as unexplained.

## When to close a position

### 1. Exit-target backtest by tier

- **Question:** Which take-profit percentage kept the most credit, and how often did each target trigger?
- **Display:** Compare targets from 25% to 90% and holding through expiry, by tier and days-to-expiration bucket. Include hit rate, median time to hit, dollars kept, worst result and sample count.
- **Data:** Entry marks, corrected intraday history, expiration outcomes and regular-close contract prices.
- **Effort:** Medium.
- **Caveats:** Entry capture began 08/05/2026. Intraday targets may be missed by end-of-day data. A mark is not an executable fill.
- **Models:** GPT, Claude, Gemini.

### 2. Conditional outcomes from the current trade state

- **Question:** Given this capture percentage, delta and time remaining, what happened to similar positions that stayed open?
- **Display:** For comparable historical states, show the distribution of additional credit earned versus giveback, the share that later reached a 50% target and the share that finished in the money. Add a median capture curve by hours or days held.
- **Data:** Corrected intraday marks and deltas, entry mark, expiration and remaining days.
- **Effort:** Large.
- **Caveats:** Matching samples will be small. Multiple observations from one contract are correlated, so count independent contracts.
- **Models:** GPT, Claude, Gemini.

### 3. Exit radar on Owned Contracts

- **Question:** What has happened to each open position since entry?
- **Display:** Current captured percentage, peak capture, giveback from peak, entry-to-current delta change, and premium remaining per day. Possible badges include target reached, giving back, delta widening and little premium left to earn.
- **Data:** Owned positions, transaction records, latest corrected history mark and delta, plus exit targets from idea 1.
- **Effort:** Small to medium.
- **Caveats:** Keep badges advisory. Some owned positions may only have end-of-day quotes.
- **Models:** GPT, Claude, Gemini.

### 4. Delta and stress thresholds

- **Question:** How did positions tend to finish after delta widened, the underlying fell, or the option mark rose?
- **Display:** Compare final outcome with maximum delta, underlying move from entry and mark change. Show counts and outcomes above candidate thresholds.
- **Data:** History delta, mark and underlying, strike, regular-close price and VIX.
- **Effort:** Medium.
- **Caveats:** There are few losing contracts. Thresholds may change as more data arrives.
- **Models:** Claude, Gemini.

## What to sell

### 5. Advertised vs. captured quote

- **Question:** How much of VADER's advertised premium and yield was available in the morning market?
- **Display:** On each signal, show advertised premium and yield beside captured bid, ask, mark and estimated yield. Include spread width, illiquid status, capture time and filters for wide spreads.
- **Data:** `opt.telegram_signal` and `opt.telegram_entry_quote`.
- **Effort:** Small.
- **Caveats:** A morning snapshot may differ from the quote at order time. Spread width estimates execution friction; it is not a recorded fill.
- **Models:** GPT, Claude, Gemini.

### 6. Entry attribute explorer

- **Question:** Which entry traits had better outcomes and smaller interim drawdowns?
- **Display:** Heatmap by entry delta and days to expiration, split by tier and top-pick status. Optional filters include VIX regime, cushion, IV and sector. Cells show win rate, target-hit rate, drawdown and credit retained under one fixed exit rule.
- **Data:** Signal, captured entry quote, outcome, history and VIX records.
- **Effort:** Medium to large.
- **Caveats:** Deduplicate repeat signals for the same contract. Separate unquoted and illiquid entries from quoted results.
- **Models:** GPT, Claude, Gemini.

### 7. Symbol track record and Caution suggestions

- **Question:** Which symbols repeatedly performed poorly or reached a profit target quickly?
- **Display:** Symbol leaderboard with signal count, traded count, in-the-money rate, 50% capture rate, median time to target and worst drawdown. Offer links to Caution and Favorites.
- **Data:** Signal and outcome records, transaction records, `optcfg.caution_symbol`.
- **Effort:** Small.
- **Caveats:** Most symbols have few observations. Same-week contracts on one symbol may share risk.
- **Models:** Claude, Gemini.

### 8. Compare personal picks and exits with the signal baseline

- **Question:** Did selected signals perform differently from the ones passed over, and how did actual exits compare with later outcomes?
- **Display:** Compare traded and untraded signals from the same date and tier. For closed positions, compare the actual buyback with later best capture and final outcome.
- **Data:** `dbo.option_transactions`, signals and outcomes.
- **Effort:** Medium.
- **Caveats:** Requires reliable pairing of opening and closing transactions with their signals.
- **Models:** Gemini.

### 9. Candidate impact on existing exposure

- **Question:** Would a new put add risk to symbols, sectors, strikes or expirations already held?
- **Display:** Before-and-after exposure by symbol, sector and expiration, with overlapping strikes and approximate delta-equivalent shares.
- **Data:** Owned positions, transactions, signal sector and collateral, captured delta.
- **Effort:** Medium.
- **Caveats:** Delta and sector totals do not estimate losses during a broad selloff.
- **Models:** GPT.

### 10. Entry-window timing comparison

- **Question:** Did a later entry window offer enough additional credit to justify its risk?
- **Display:** Compare fixed entry times on the signal day using the same exit rule. Show credit, delta, subsequent loss and quote coverage.
- **Data:** Corrected intraday marks and deltas, signal dates and collection timestamps.
- **Effort:** Large.
- **Caveats:** Use predetermined times, not each day's best quote. Intraday coverage is limited.
- **Models:** GPT.

## Understand and interpret the data

### U1. "Why did it move?" breakdown

- **Question:** Did the option mark change with the underlying, time passing, or other factors?
- **Display:** For entry-to-now or a selected interval, estimate the stock contribution as average delta times underlying change. Show time decay as an estimate and label the unexplained residual separately.
- **Data:** Corrected mark, delta and underlying history, entry IV, strike and expiration.
- **Effort:** Medium.
- **Caveats:** Intraday theta and IV are not captured. The residual also contains spread effects and approximation error.
- **Models:** GPT, Claude, Gemini.

### U2. Market backdrop overlay

- **Question:** Did the selected contract move on its own or with the broader market and other signals?
- **Display:** Show daily VIX and the share of open signals or same-sector signals whose delta widened that session. Add a plain-language daily summary.
- **Data:** `dbo.stock_price` for VIX, signal sector, history underlying and delta.
- **Effort:** Medium.
- **Caveats:** VIX is daily while contract history is intraday.
- **Models:** Claude, Gemini.

### U3. Contract story and path type

- **Question:** What happened to this contract from entry to the latest observation or expiration?
- **Display:** A short narrative using entry, peak capture, giveback and key underlying moves. Add a descriptive path label such as steady decay, fast then flat, scare and recover, late breach or noisy quotes.
- **Data:** Existing analysis values, entry quote, contract close, history and override metadata.
- **Effort:** Small.
- **Caveats:** Keep the narrative tied to displayed values and disclose overrides. Path labels are descriptive heuristics.
- **Models:** Claude, Gemini.

### U4. Repeat recommendation timeline

- **Question:** Has VADER recommended this exact contract before, and what changed each time?
- **Display:** Pin every signal date on one timeline with tier, top-pick status, advertised premium and yield, captured entry values, cushion and remaining days.
- **Data:** Signal records, entry quote records and history entry records.
- **Effort:** Small to medium.
- **Caveats:** Most contracts appear once. Repeat recommendations are not independent trades and do not mean VADER held the position.
- **Models:** GPT, Gemini.

### U5. Metric explainer and dollar translation

- **Question:** What does each percentage or badge mean, how is it calculated, and what does it equal in dollars?
- **Display:** Contextual explanations for Captured %, Best, Worst, Giveback, strike distance, moneyness and VADER fallback values. Include a formula and a worked example using the selected contract.
- **Data:** The same analysis and quote values already shown, plus signal collateral.
- **Effort:** Small.
- **Caveats:** Explanations must use the same calculation source as the page. Mark-based dollars exclude fees and the user's actual fill.
- **Models:** GPT, Claude.

### U6. Data coverage strip

- **Question:** Which chart regions are measured, missing, excluded or repaired?
- **Display:** A strip under the chart marking valid observations, gaps, excluded opening captures and overrides. Tooltips explain whether a point contributes to Best, Worst or target detection.
- **Data:** Quote statuses, capture schedule, coverage counts, override metadata and analysis exclusions.
- **Effort:** Medium.
- **Caveats:** Contract History already exposes some quote status and coverage details. Reuse those fields and avoid duplicating the amber override bands.
- **Models:** GPT, Claude.

### U7. VADER vs. morning market bridge

- **Question:** Why do VADER's advertised numbers differ from the captured morning quote?
- **Display:** Compare advertised values with the morning quote, prior close, opening gap, cushion, delta change and spread. Add a short explanation of the largest differences.
- **Data:** `opt.telegram_signal`, `opt.telegram_entry_quote`, and prior close from `optcfg.price_bar`.
- **Effort:** Small.
- **Caveats:** Available only for signal dates with captured entry quotes. Timestamp differences explain some of the gap.
- **Models:** Claude, Gemini.

### U8. Same-day cohort comparison

- **Question:** How did contracts from one signal date, tier or expiration behave side by side?
- **Display:** Small-multiple Captured % curves aligned by time since entry, with a median line and range. Add signal date and daily VIX context.
- **Data:** Corrected history, entry marks, signal tier/date and VIX.
- **Effort:** Medium.
- **Caveats:** The current history spans only a short period. Show sample counts and describe patterns rather than claiming statistical certainty.
- **Models:** Claude.

### U9. Delta interpretation

- **Question:** What does an entry delta such as -0.20 describe, and how often did contracts in that range finish in the money?
- **Display:** Plain-language sensitivity explanation and historical outcomes by entry-delta band, with contract count and uncertainty range.
- **Data:** Captured entry delta, strike, expiration and expiry-day underlying.
- **Effort:** Medium.
- **Caveats:** Delta is not an exact probability of expiring in the money. Expiration moneyness is not the same as assignment.
- **Models:** GPT.

## Shared analysis rules

- Apply the history override rules before analysis. A held mark is not a market observation and must not set extrema or trigger a target.
- Keep original captured database values unchanged. Overrides are read-time corrections.
- Show counts and quote coverage alongside comparisons. Entry quote capture began 08/05/2026.
- Distinguish market marks from executable fills. The captured quote and bid-ask spread are proxies, not proof of an order fill.
- Treat repeated signals and multiple observations from one contract as correlated.

## Contract History page review

The user clarified that the next question is: **What functionality is missing from the existing Contract History page to better understand and interpret its available data?**

The three models reviewed the page and its supporting code. The proposals below merge their overlapping suggestions while retaining which models raised each idea. Items 4 and 6 are implemented; the other items remain candidates for later work.

### Existing page functionality

Contract History already has intraday and multi-day views; separate Option and Stock chart panes; Mark and Captured % metrics; captured entry price and delta markers; current quote summaries; Best, Worst, Giveback and first-crossing target analysis; a best-point chart marker; override bands and tooltip notes; and contract navigation by signal date and tier.

The page now shows selected-range quote coverage counts, warnings, point flags and override counts, with chart markers at affected observations. Multi-day charts now draw session dividers and show changes from the previous session's last valid capture to the next session's first valid capture. Selecting a date opens that session in Intraday view. Whole-life analysis spans from entry, while the plotted chart and mark/delta changes follow the selected date range. Make those scopes clear in any new displays.

### Gaps worth considering

#### 1. Unified event timeline and jump-to moments

- **Question:** What happened, in what order, and where does each event sit on the chart?
- **Display:** A chronological list of entry, first target crossing, Best, Worst, latest observation, strike crossing, selected delta thresholds and overrides. Selecting an event focuses the chart on that point and shows a short explanation.
- **Data:** Existing analysis Best, Worst, Latest and target crossings; corrected history points; strike; override metadata.
- **Already present:** Entry lines, a Best marker, first-crossing marker, summary figures and override tooltip notes. They are separate. Worst has no chart marker, and there is no unified event list or jump-to interaction.
- **Effort:** Small to medium.
- **Caveat:** Derive every event from the same corrected and excluded series used by the chart and analysis.
- **Models:** Claude.

#### 2. Compare two points on the chart

- **Question:** What changed between these two captures?
- **Display:** Select A and B by mouse or keyboard. Pin elapsed time, mark and Captured % changes, delta change and underlying move in a comparison strip. Keep the selection when switching chart panes.
- **Data:** `HistoryPoint` time, mark, delta and underlying; entry credit; override metadata.
- **Already present:** Tooltips show one point at a time. Page summaries show first-to-last changes for the loaded range.
- **Effort:** Medium.
- **Caveat:** Show when a selected mark or delta was held by an override. A simultaneous move does not prove cause.
- **Models:** GPT, Claude.

#### 3. Make the displayed range and analysis scope explicit

- **Question:** Do Best, Worst and Giveback describe the date range on the chart or the contract's full history?
- **Display:** Label the two scopes, or provide `Visible range` and `Since entry` tabs. Selecting a summary extreme can move the chart to its date.
- **Data:** `history.points`, entry, and `history.analysis`.
- **Already present:** The details panel says “Since signal entry,” while summary values for price and delta use the points in the selected range. The distinction is easy to miss.
- **Effort:** Medium.
- **Caveat:** A visible-range Captured % must retain the original entry credit as its baseline.
- **Models:** GPT.

#### 4. Show session dividers and overnight changes

- **Question:** Did a move happen during a trading session or between sessions?
- **Display:** Add date dividers to multi-day charts and show the change between the prior session's last capture and the next session's first capture. Selecting a date can open Intraday view for that session.
- **Data:** Session date, scheduled time, capture kind, mark, delta and underlying.
- **Already present:** The backend inserts session-boundary points. The page now shows dashed session dividers, overnight changes in Mark, Delta and Stock, and a date button that opens Intraday view.
- **Status:** Implemented 10/28/2026.
- **Caveat:** Label actual capture times. First and last captures are not necessarily official open and close prices. Thin labels for long ranges.
- **Models:** GPT, Gemini.

#### 5. Explain intrinsic value, extrinsic value and expiration breakeven

- **Question:** How much of the put's mark is intrinsic value, and where is the short put's expiration breakeven?
- **Display:** In the tooltip and summary, show intrinsic value `max(strike - underlying, 0)` and extrinsic value `mark - intrinsic`. On the Stock chart, add the entry-credit expiration breakeven line at `strike - entry credit`.
- **Data:** Contract strike, history mark and underlying, captured entry credit.
- **Already present:** The Stock pane shows whether the underlying is above or below strike. It does not decompose the option mark or show expiration breakeven.
- **Effort:** Small to medium.
- **Caveat:** Label breakeven as an expiration calculation, excluding fees and actual fill differences. Flag negative extrinsic values caused by unsynchronized or poor quotes.
- **Models:** GPT, Claude.

#### 6. Page-level quote coverage and quality summary

- **Question:** How complete and current is the data behind this chart?
- **Display:** A compact coverage panel with expected and valid captures, gaps, unknown slots, excluded captures, override count, wide-spread flags and stale provider quotes. Mark affected chart positions and explain each quality state.
- **Data:** `HistoryResponse.coverage`, warnings, analysis gap and override counts, point flags and provider/received timestamps.
- **Already present:** Override bands and tooltip notes. The page now summarizes selected-range coverage, gaps, unknown slots, overrides, flags and warnings, with markers at affected chart positions.
- **Status:** Implemented 10/28/2026.
- **Caveat:** Separate tracking that had not started from missing captures during an active period. A valid quote is not proof of an executable fill.
- **Models:** Claude, Gemini.

#### 7. Simultaneous Option and Stock context

- **Question:** What was the underlying doing when the option mark or delta moved?
- **Display:** Include stock price, change from entry and distance to strike in the Option tooltip, and include mark, delta and Captured % in the Stock tooltip. Consider a desktop-only `Both` view with synchronized crosshairs.
- **Data:** Each chart point already includes mark, delta, Captured %, underlying price and strike.
- **Already present:** Option and Stock panes are both built and share a Recharts sync id, but only one pane is visible at a time and each tooltip has a different subset of values.
- **Effort:** Small for cross-context tooltips; medium for a two-chart view.
- **Caveat:** A stacked view needs enough height. Keep a single-pane option on narrow screens.
- **Models:** Gemini.

#### 8. Compare a few contracts on one timeline

- **Question:** How did this put behave relative to similar recommendations?
- **Display:** Add up to 3 or 4 contracts from the picker and overlay their Captured % curves aligned by elapsed time since entry, with a legend and per-contract toggles.
- **Data:** Existing contract history API, entry records, analysis targets, signal date and tier.
- **Already present:** The picker and previous/next controls navigate one contract at a time.
- **Effort:** Medium.
- **Caveat:** State that alignment is by elapsed time. Different expirations and entry times affect comparability. Limit the number of lines.
- **Models:** Claude.

#### 9. Target persistence and reversals

- **Question:** Was a target crossing sustained or a one-observation touch?
- **Display:** Beside the existing first-crossing marker, show qualifying capture count, longest consecutive run and any later reversals below the target. Selecting a run focuses its chart interval.
- **Data:** Entry mark, ordered marks and timestamps, quote status, target thresholds and override exclusions.
- **Already present:** The page shows the first observed crossing only.
- **Effort:** Medium.
- **Caveat:** Report observed samples, not continuous time above target or an executable fill. Gaps and session boundaries break a run.
- **Models:** GPT.

#### 10. Add market context to the history page

- **Question:** Was this contract's move specific to the underlying or shared with the broader market?
- **Display:** Add a daily VIX lane and underlying percentage change, with session notes. A later extension could compare the contract with other same-day or same-sector signals.
- **Data:** `dbo.stock_price` VIX and symbol prices, history underlying, signal sector.
- **Already present:** The navbar can show current VIX. Contract History has no market context.
- **Effort:** Medium.
- **Caveat:** VIX and stock-price rows are daily, not synchronized 5-minute observations. Keep daily context visually distinct from intraday quotes.
- **Models:** Claude. Related market-context proposals also appeared in the earlier recommendation round.

#### 11. Reconcile VADER's advertised values with captured entry

- **Question:** How did the advertised premium and delta differ from the captured entry quote?
- **Display:** Show advertised and captured delta and premium side by side, recomputed yield, and the difference in the entry tooltip and summary details.
- **Data:** Signal delta, premium, annualized yield and collateral; captured entry mark and delta.
- **Already present:** Live Signals can switch between VADER and actual numbers. Contract History shows captured entry values, but not the advertised values beside them.
- **Effort:** Small.
- **Caveat:** Values come from different capture times. Only show comparisons when the matching entry quote exists.
- **Models:** Claude.

### Current implementation references

- Picker, date range, contract navigation and summary composition: `frontend/src/pages/ContractHistoryPage.tsx`.
- Option and Stock charts, entry markers, target markers, session dividers, overnight changes, coverage summary, quality markers and override tooltip: `frontend/src/history/HistoryCharts.tsx`.
- Best, Worst, Giveback and first-crossing analysis display: `frontend/src/history/HistoryAnalysis.tsx`.
- Coverage fields, session-boundary points and history query: `backend/src/history/repository.ts`.
- Analysis definitions and excluded capture rules: `backend/src/history/analysis.ts`.
