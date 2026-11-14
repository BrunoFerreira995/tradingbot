# SMA Micro Trend

`sma_micro_trend` uses the existing OHLCV runner, TradingEngine, RiskManager,
OrderManager, PositionManager and MT5 adapter. It is opt-in: set
`STRATEGY_RUNNER=sma_micro_trend`, `STRATEGY_TIMEFRAME=M30` (or another supported
timeframe), and `MT5_SYMBOLS` to the desired broker symbols. Apply the database
migration before starting: `bun run db:migrate`. The trading engine still
requires its existing auto-trading, broker, symbol and risk permissions. Merely
selecting this strategy does not authorize live orders.

The dashboard's Trading section exposes settings for each symbol and active
timeframe. Saved settings are stored in `strategies.config` under
`SYMBOL:TIMEFRAME`; unspecified pairs use defaults. The form validates periods,
positive multipliers and the fast period being shorter than the slow period.

The runner evaluates only the last **closed** bar. It primes on startup or
timeframe change without replaying that bar. A bullish crossover is previous
fast <= previous slow and current fast > current slow; a bearish crossover is
the mirror. Price-side and slow-SMA-slope filters are optional. The ATR uses the
first `period` true ranges as its simple-average seed; the first true range is
high-low. Later ATR values use Wilder's RMA. No entry occurs until both current
and prior SMA values and a positive ATR are available.

The neutral zone is `abs(fast - slow) <= ATR * neutralAtrFraction`, default
`0.1`. It matters only when `closeOnNeutralTrend` is enabled. The initial ATR
stop distance is `ATR * atrStopMultiplier` from the last closed bar; the
RiskManager converts this to a broker order, checks limits, and the MT5
`OrderCheck` checks margin. Trailing moves only in the favorable direction,
rounds to the broker tick, respects the broker minimum stop distance, and uses
the latest closed price. Reversals close the opposite position through the
existing engine, verify that the broker no longer reports it, then submit the
new entry. Deterministic signal IDs prevent the same bar from being submitted
twice.

SMA entries also require the live spread to be at most `1.5 * ATR` and the
final stop distance to be at least `0.5 * ATR`. These guards use the last
closed bar's ATR. The spread is checked before a reversal closes the old
position, during risk evaluation, and again before order submission. A
monetary stop below the volatility floor rejects the entry rather than
increasing the chosen monetary risk amount. The guards do not apply to close
signals.

Optional micro/macro alignment can be enabled per symbol and entry timeframe
with `filters.requireMacroTrendAlignment`. `macroTimeframe: "AUTO"` selects the
next supported timeframe (M1→M5, M30→H1); an explicit higher timeframe can be
selected in the dashboard. The macro direction is the sign of the same fast
and slow SMA values on the last macro bar that had closed when the micro signal
closed. A BUY requires macro fast > slow, and a SELL requires macro fast < slow.
Missing history, a neutral macro trend, or an invalid lower/equal macro
timeframe cannot authorize an entry. The filter is **off by default**: in the
4 Nov 2026 M1 sample, M5 agreement selected a worse realized subset than M5
disagreement. The historical comparison is in
`reports/macro-m1-m5-trade-alignment-2026-11-04-summary.json`. Backtests and
the strategy chart also apply the configured macro filter using closed macro
bars. Backtests still simplify execution and do not simulate the account's
monetary stop monitor.

Backtesting is available through the dashboard button or
`POST /api/strategy/backtest` with admin authentication and JSON fields
`symbol`, `timeframe`, optional `count` and `config`, and `options` containing
`initialCapital`, `spread`, `slippage`, `commissionPerUnit`, and `units`.
Signals are read at bar close and filled at the next bar open. Spread and
slippage are adverse on both entry and exit. Stops use candle OHLC, and a gap
through the stop fills at the worse opening price. A stop reached on an entry
bar can close that new position; it does not reenter on that bar. Trailing uses
only the previously closed bar before checking the next bar's range. Results
include trades, an open trade, equity curve, P&L, return, win rate, profit
factor, drawdown, average wins/losses, expectancy, total costs, and Sharpe per
bar when a variance exists. Sharpe is not annualized. Position size is fixed
in units for this historical simulator; broker margin and MT5 execution are
not simulated. The dashboard's quick run deliberately uses zero costs and one
unit; specify realistic costs through the API for research. Historical
results do not guarantee future profit.

Run checks with `bun test`, `bun run typecheck`, and `bun run lint`.
