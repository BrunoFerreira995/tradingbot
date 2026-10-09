/**
 * Technical indicators, bit-for-bit compatible with the MetaTrader 5 built-ins.
 *
 * Parity with MQL5 is the whole point of this file. The strategy this replaces
 * was an EA calling `iBands` and `iRSI`, so a bot-side implementation that
 * disagreed by one rounding step would silently change when it enters and
 * exits. Two details matter and are easy to get wrong:
 *
 * - `StdDev` in MetaTrader is the *population* deviation (`/ period`), not the
 *   sample one (`/ period - 1`) that most statistics libraries default to.
 * - `iRSI` is Wilder's smoothing, seeded with the simple average of the first
 *   `period` price changes, not an EMA seeded with the first price change.
 *
 * Every series is returned aligned to its input with `null` where the
 * indicator is not yet defined, matching how MetaTrader leaves the warm-up
 * region of a buffer empty.
 */

/** A window of the input, oldest first. */
function window(
  values: readonly number[],
  end: number,
  period: number,
): number[] {
  const out: number[] = [];
  for (let i = end - period + 1; i <= end; i++) {
    const value = values[i];
    if (value === undefined) return [];
    out.push(value);
  }
  return out;
}

/** Simple moving average, as `iMA(..., MODE_SMA, ...)`. */
export function sma(
  values: readonly number[],
  period: number,
): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === undefined) continue;
    sum += value;
    if (i >= period) sum -= values[i - period] ?? 0;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Population standard deviation, as MetaTrader's `StdDev`.
 *
 * Using the sample deviation here would make the bands measurably narrower on
 * short windows, which is exactly the regime a mean-reversion strategy trades
 * in.
 */
export function stdDev(
  values: readonly number[],
  period: number,
): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  const means = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    const mean = at(means, values.length - 1 - i);
    if (mean === null) continue;
    const slice = window(values, i, period);
    if (slice.length !== period) continue;
    let squares = 0;
    for (const value of slice) {
      const delta = value - mean;
      squares += delta * delta;
    }
    out[i] = Math.sqrt(squares / period);
  }
  return out;
}

export interface BollingerBands {
  upper: Array<number | null>;
  base: Array<number | null>;
  lower: Array<number | null>;
}

/** Bollinger Bands, as `iBands(symbol, period, bandsShift 0, deviation, applied)`. */
export function bollingerBands(
  values: readonly number[],
  period: number,
  deviation: number,
): BollingerBands {
  const base = sma(values, period);
  const sigma = stdDev(values, period);
  const upper: Array<number | null> = new Array(values.length).fill(null);
  const lower: Array<number | null> = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const offset = values.length - 1 - i;
    const mean = at(base, offset);
    const spread = at(sigma, offset);
    if (mean === null || spread === null) continue;
    upper[i] = mean + deviation * spread;
    lower[i] = mean - deviation * spread;
  }
  return { upper, base, lower };
}

/**
 * Relative Strength Index, as `iRSI`, using Wilder's smoothing.
 *
 * The seed is the simple average of the first `period` changes; every later
 * value is `((prev * (period - 1)) + current) / (period + 1)`. A window with no
 * net movement returns 50 rather than dividing by zero: it can never cross a
 * threshold, so a flat series stays flat instead of faking a signal.
 */
export function rsi(
  values: readonly number[],
  period: number,
): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (period <= 0 || values.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous === undefined || current === undefined) return out;
    const change = current - previous;
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let averageGain = gain / period;
  let averageLoss = loss / period;
  out[period] = rsiValue(averageGain, averageLoss);

  for (let i = period + 1; i < values.length; i++) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous === undefined || current === undefined) break;
    const change = current - previous;
    const up = change > 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    averageGain = (averageGain * (period - 1) + up) / (period + 1);
    averageLoss = (averageLoss * (period - 1) + down) / (period + 1);
    out[i] = rsiValue(averageGain, averageLoss);
  }
  return out;
}

function rsiValue(averageGain: number, averageLoss: number): number {
  const total = averageGain + averageLoss;
  if (total === 0) return 50;
  return (averageGain / total) * 100;
}

/**
 * Reads a series at a fixed distance from the end, counting the newest bar as
 * offset 0. Offset 1 is the last *closed* bar, which is what a strategy must
 * act on: the newest bar is still forming and its indicator values will move.
 */
export function at<T>(
  series: readonly (T | null)[],
  offsetFromEnd: number,
): T | null {
  if (offsetFromEnd < 0) return null;
  return series[series.length - 1 - offsetFromEnd] ?? null;
}
