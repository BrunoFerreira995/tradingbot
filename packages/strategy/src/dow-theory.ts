import type { Rate, Side } from '@trade/shared';

export interface DowTheoryConfig {
  pivotBars: number;
  rewardRiskRatio: number;
}

export const defaultDowTheoryConfig: DowTheoryConfig = {
  pivotBars: 1,
  rewardRiskRatio: 3,
};

export type DowTrend = 'UP' | 'DOWN' | 'RANGE' | 'NOT_READY';

export interface DowTheoryReading {
  trend: DowTrend;
  signal: Side | null;
  close: number | null;
  pivotHigh: number | null;
  pivotLow: number | null;
  stopPrice: number | null;
  stopDistance: number | null;
  takeProfitDistance: number | null;
}

function swingIndexes(
  bars: readonly Rate[],
  pivotBars: number,
  side: 'high' | 'low',
): number[] {
  const indexes: number[] = [];
  for (let i = pivotBars; i < bars.length - pivotBars; i++) {
    const value = side === 'high' ? bars[i]!.h : bars[i]!.l;
    let pivot = true;
    for (let offset = 1; offset <= pivotBars; offset++) {
      const before =
        side === 'high' ? bars[i - offset]!.h : bars[i - offset]!.l;
      const after = side === 'high' ? bars[i + offset]!.h : bars[i + offset]!.l;
      if (
        side === 'high'
          ? value <= before || value <= after
          : value >= before || value >= after
      ) {
        pivot = false;
        break;
      }
    }
    if (pivot) indexes.push(i);
  }
  return indexes;
}

/** Evaluates confirmed swing structure and a close breaking its latest pivot.
 * The final input bar is treated as forming and never contributes. */
export function evaluateDowTheory(
  rates: readonly Rate[],
  config: DowTheoryConfig = defaultDowTheoryConfig,
): DowTheoryReading {
  const empty: DowTheoryReading = {
    trend: 'NOT_READY',
    signal: null,
    close: null,
    pivotHigh: null,
    pivotLow: null,
    stopPrice: null,
    stopDistance: null,
    takeProfitDistance: null,
  };
  if (
    !Number.isInteger(config.pivotBars) ||
    config.pivotBars < 1 ||
    !Number.isFinite(config.rewardRiskRatio) ||
    config.rewardRiskRatio <= 0
  )
    throw new Error('Invalid Dow Theory configuration');

  const bars = rates.slice(0, -1);
  const last = bars.at(-1);
  const previous = bars.at(-2);
  if (!last || !previous) return empty;

  const highs = swingIndexes(bars, config.pivotBars, 'high');
  const lows = swingIndexes(bars, config.pivotBars, 'low');
  if (highs.length < 2 || lows.length < 2) return { ...empty, close: last.c };

  const previousHigh = bars[highs.at(-2)!]!.h;
  const latestHigh = bars[highs.at(-1)!]!.h;
  const previousLow = bars[lows.at(-2)!]!.l;
  const latestLow = bars[lows.at(-1)!]!.l;
  const trend: DowTrend =
    latestHigh > previousHigh && latestLow > previousLow
      ? 'UP'
      : latestHigh < previousHigh && latestLow < previousLow
        ? 'DOWN'
        : 'RANGE';

  const buy = trend === 'UP' && previous.c <= latestHigh && last.c > latestHigh;
  const sell =
    trend === 'DOWN' && previous.c >= latestLow && last.c < latestLow;
  const signal: Side | null = buy ? 'BUY' : sell ? 'SELL' : null;
  const stopPrice = buy ? latestLow : sell ? latestHigh : null;
  const stopDistance = stopPrice === null ? null : Math.abs(last.c - stopPrice);
  if (signal && (!stopDistance || !Number.isFinite(stopDistance)))
    return {
      ...empty,
      trend,
      close: last.c,
      pivotHigh: latestHigh,
      pivotLow: latestLow,
    };

  return {
    trend,
    signal,
    close: last.c,
    pivotHigh: latestHigh,
    pivotLow: latestLow,
    stopPrice,
    stopDistance,
    takeProfitDistance:
      stopDistance === null ? null : stopDistance * config.rewardRiskRatio,
  };
}
