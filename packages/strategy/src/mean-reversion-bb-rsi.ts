import type { Side } from '@trade/shared';
import { at, bollingerBands, rsi } from './indicators';

/**
 * Mean reversion on Bollinger Bands + RSI.
 *
 * This is the bot-side port of `MeanReversion_BB_RSI_MT5.mq5`. The EA traded
 * from inside the terminal; moving it here keeps the risk engine, the audit
 * trail and the dashboard in the loop, with the terminal reduced to a
 * transport. The decision itself is unchanged:
 *
 *   BUY  when the last closed candle closed at or below the lower band and RSI
 *        is oversold;
 *   SELL when it closed at or above the upper band and RSI is overbought.
 *
 * Two deliberate departures from the EA, both because the bot has to be
 * defensible rather than merely functional:
 *
 * - Stops are computed as *distances* from the reference price. The bot's
 *   `stopLoss`/`takeProfit` fields are distances, not price levels, and the risk
 *   manager re-derives the level itself.
 * - A signal only fires on a newly *closed* candle. The EA relied on `OnTick`
 *   plus an `IsNewBar` guard; here the runner only calls `evaluate` when the
 *   bar timestamp changes, so the newest bar is never traded while forming.
 */

export interface MeanReversionConfig {
  symbol: string;
  timeframe: string;
  bollingerLength: number;
  bollingerMultiplier: number;
  rsiLength: number;
  rsiOversold: number;
  rsiOverbought: number;
  /** Stop distance as a percentage of the reference price, like the EA's input. */
  stopLossPercent: number;
  takeProfitPercent: number;
  lots: number;
  enableShort: boolean;
}

export const defaultMeanReversionConfig: Omit<
  MeanReversionConfig,
  'symbol' | 'timeframe'
> = {
  bollingerLength: 20,
  bollingerMultiplier: 2,
  rsiLength: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  stopLossPercent: 1,
  takeProfitPercent: 1.5,
  lots: 0.01,
  enableShort: true,
};

export interface StrategyDecision {
  side: Side;
  close: number;
  upper: number;
  lower: number;
  rsiValue: number;
  /** Stop distance in price units, for the risk manager. */
  stopDistance: number;
  takeProfitDistance: number;
}

/**
 * Evaluates the last closed bar.
 *
 * `rates` is oldest first and includes the still-forming bar, exactly as
 * MetaTrader's buffers do; decisions read offset 1. Returns null when there is
 * nothing to act on, which is the overwhelmingly common case for a strategy
 * that waits for a band touch *and* an RSI extreme.
 */
export function evaluateMeanReversion(
  rates: ReadonlyArray<{ t: number; c: number }>,
  config: MeanReversionConfig,
  referencePrice: number,
): StrategyDecision | null {
  const closes = rates.map((rate) => rate.c);
  const bands = bollingerBands(
    closes,
    config.bollingerLength,
    config.bollingerMultiplier,
  );
  const rsiSeries = rsi(closes, config.rsiLength);

  // Offset 1 in every series: the last closed bar, never the forming one.
  const close = closes[closes.length - 2] ?? null;
  const upper = at(bands.upper, 1);
  const lower = at(bands.lower, 1);
  const rsiValue = at(rsiSeries, 1);
  const lastBar = rates[rates.length - 2];
  if (
    close === null ||
    upper === null ||
    lower === null ||
    rsiValue === null ||
    !lastBar
  )
    return null;

  const buy = close <= lower && rsiValue <= config.rsiOversold;
  const sell =
    config.enableShort && close >= upper && rsiValue >= config.rsiOverbought;
  if (!buy && !sell) return null;

  return {
    side: buy ? 'BUY' : 'SELL',
    close,
    upper,
    lower,
    rsiValue,
    stopDistance: referencePrice * (config.stopLossPercent / 100),
    takeProfitDistance: referencePrice * (config.takeProfitPercent / 100),
  };
}

/** Bar timestamp that carries a decision, used to keep signal ids stable. */
export function lastClosedBarTime(
  rates: ReadonlyArray<{ t: number }>,
): number | null {
  return rates[rates.length - 2]?.t ?? null;
}
