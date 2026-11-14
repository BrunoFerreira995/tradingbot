# Dow Theory swing breakout

The opt-in runner strategy is selected with `STRATEGY_RUNNER=dow_theory` and
uses the configured `STRATEGY_TIMEFRAME`. It does not replace the SMA or
mean-reversion strategies.

The default swing size is one candle on each side. A swing high or low is used
only after the following bar has closed, so no forming or future candle is used
to confirm structure. An uptrend requires both of the latest two confirmed
swing highs and lows to rise; a downtrend requires both to fall.

An entry signal requires a closed candle to cross above the latest confirmed
swing high in an uptrend, or below the latest confirmed swing low in a
downtrend. The initial stop is placed at the opposite latest confirmed swing,
and the take-profit distance is three times the entry-to-stop distance. The runner
submits distances to the existing trading engine, which continues to enforce
the account's configured monetary risk, lot, spread, symbol, session, and
execution rules. If the calculated swing stop is not beyond the live entry
price and spread, the signal is rejected instead of widening the stop.

The runner does not add to or reverse an existing position for the symbol; it
waits for that position to close before considering another breakout. Strategy
signals are evaluated only once per newly closed bar, and startup primes the
current bar without replaying it.

This is a rule implementation, not a claim of profitability. Validate it with
realistic historical spread and slippage assumptions in a demo environment
before enabling automated orders.
