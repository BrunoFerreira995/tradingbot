import { z } from 'zod';
import type { Rate, SymbolInfo } from '@trade/shared';
import { atr } from './indicators';

export const TREND_FOREX_SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD'] as const;
export const diversifiedTrendSchema = z.object({
  lookback: z.number().int().min(20).max(300).default(126),
  volatilityPeriod: z.number().int().min(10).max(90).default(60),
  minimumScore: z.number().finite().min(0).max(2).default(0),
  stopAtr: z.number().finite().min(1).max(10).default(3),
  rewardRisk: z.number().finite().min(1).max(10).default(3),
  annualRiskBudget: z.number().finite().positive().max(0.3).default(0.1),
  maximumGrossLeverage: z.number().finite().positive().max(3).default(2),
});
export type DiversifiedTrendConfig = z.infer<typeof diversifiedTrendSchema>;
export const defaultDiversifiedTrendConfig = diversifiedTrendSchema.parse({});
export interface DiversifiedTrendReading {
  ready: boolean;
  side: 'BUY' | 'SELL' | null;
  close: number | null;
  momentum: number | null;
  score: number | null;
  annualVolatility: number | null;
  atr: number | null;
}

/** Daily time-series momentum. Final candle is forming and never participates. */
export function evaluateDiversifiedTrend(rates: readonly Rate[], config: DiversifiedTrendConfig = defaultDiversifiedTrendConfig): DiversifiedTrendReading {
  const c = diversifiedTrendSchema.parse(config);
  const empty: DiversifiedTrendReading = { ready: false, side: null, close: null, momentum: null, score: null, annualVolatility: null, atr: null };
  const bars = rates.slice(0, -1).slice(-Math.max(c.lookback + 1, c.volatilityPeriod + 1, 100));
  if (bars.length < Math.max(c.lookback, c.volatilityPeriod, 14) + 1 || bars.some((b, i) =>
    ![b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) || b.l <= 0 ||
    b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c) || (i > 0 && b.t <= bars[i - 1]!.t))) return empty;
  const close = bars.at(-1)!.c;
  const returns = bars.slice(-c.volatilityPeriod).map((b, i) => Math.log(b.c / bars[bars.length - c.volatilityPeriod + i - 1]!.c));
  const mean = returns.reduce((n, r) => n + r, 0) / returns.length;
  const dailyVolatility = Math.sqrt(returns.reduce((n, r) => n + (r - mean) ** 2, 0) / (returns.length - 1));
  const volatility = atr(bars, 14).at(-1);
  if (!Number.isFinite(dailyVolatility) || dailyVolatility <= 0 || volatility == null || volatility <= 0) return { ...empty, close };
  const momentum = Math.log(close / bars[bars.length - 1 - c.lookback]!.c);
  const score = momentum / (dailyVolatility * Math.sqrt(c.lookback));
  return { ready: true, side: score > c.minimumScore ? 'BUY' : score < -c.minimumScore ? 'SELL' : null,
    close, momentum, score, annualVolatility: dailyVolatility * Math.sqrt(252), atr: volatility };
}

/** Equal per-leg inverse-volatility budgets, capped by gross leverage / legs.
 * annualRiskBudget is a sum of stand-alone budgets, NOT a predicted portfolio vol. */
export function trendAllocationWeight(annualVolatility: number, legs: number, config: DiversifiedTrendConfig): number {
  if (!Number.isFinite(annualVolatility) || annualVolatility <= 0 || !Number.isInteger(legs) || legs < 1) return 0;
  return Math.min(config.annualRiskBudget / (legs * annualVolatility), config.maximumGrossLeverage / legs);
}

export function sizeDiversifiedTrend(equity: number, close: number, annualVolatility: number, legs: number,
  info: SymbolInfo, maximumLot: number, config: DiversifiedTrendConfig): number | null {
  const tickValue = info.tickValueLoss ?? info.tickValue;
  if (![equity, close, tickValue, info.tickSize, info.lotStep, info.minLot, info.maxLot, maximumLot].every(Number.isFinite) ||
      equity <= 0 || close <= 0 || tickValue <= 0 || info.tickSize <= 0 || info.lotStep <= 0 || info.minLot <= 0 || maximumLot <= 0) return null;
  const accountNotionalPerLot = close / info.tickSize * tickValue;
  const desired = equity * trendAllocationWeight(annualVolatility, legs, config) / accountNotionalPerLot;
  const lots = Math.floor((Math.min(desired, maximumLot, info.maxLot) + 1e-12) / info.lotStep) * info.lotStep;
  return lots + 1e-12 >= info.minLot ? Number(lots.toFixed(8)) : null;
}
