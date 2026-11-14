import { z } from 'zod';
import { TIMEFRAMES, type Rate, type Side, type Timeframe } from '@trade/shared';
import { atr, sma } from './indicators';

export const smaMicroTrendSchema = z.object({
  strategy: z.literal('sma_micro_trend').default('sma_micro_trend'),
  enabled: z.boolean().default(true),
  indicators: z.object({
    fastSMA: z.number().int().min(1).default(9),
    slowSMA: z.number().int().min(2).default(40),
    atrPeriod: z.number().int().min(1).default(14),
  }),
  filters: z.object({
    requirePriceSameSideAsFastSMA: z.boolean().default(false),
    requireSlowSMASlope: z.boolean().default(true),
    requireMacroTrendAlignment: z.boolean().default(false),
    macroTimeframe: z.union([z.literal('AUTO'), z.enum(TIMEFRAMES)]).default('AUTO'),
  }),
  operations: z.object({
    allowLong: z.boolean().default(true),
    allowShort: z.boolean().default(true),
    closeOnNeutralTrend: z.boolean().default(false),
    neutralAtrFraction: z.number().finite().min(0).default(0.1),
    reverseOnOppositeSignal: z.boolean().default(true),
  }),
  risk: z.object({
    useATRStop: z.boolean().default(true),
    atrStopMultiplier: z.number().finite().positive().default(2),
    useATRTrailingStop: z.boolean().default(false),
    atrTrailingMultiplier: z.number().finite().positive().default(2),
    lots: z.number().finite().positive().default(0.01),
  }),
  visual: z.object({
    showSignals: z.boolean().default(true),
    colorCandles: z.boolean().default(true),
    colorTrendBackground: z.boolean().default(true),
    showPanel: z.boolean().default(true),
  }),
}).superRefine((value, ctx) => {
  if (value.indicators.fastSMA >= value.indicators.slowSMA)
    ctx.addIssue({ code: 'custom', path: ['indicators', 'fastSMA'], message: 'Fast SMA must be shorter than slow SMA' });
});

export type SmaMicroTrendConfig = z.infer<typeof smaMicroTrendSchema>;
export const defaultSmaMicroTrendConfig: SmaMicroTrendConfig = {
  strategy: 'sma_micro_trend', enabled: true,
  indicators: { fastSMA: 9, slowSMA: 40, atrPeriod: 14 },
  filters: { requirePriceSameSideAsFastSMA: false, requireSlowSMASlope: true, requireMacroTrendAlignment: false, macroTimeframe: 'AUTO' },
  operations: { allowLong: true, allowShort: true, closeOnNeutralTrend: false, neutralAtrFraction: 0.1, reverseOnOppositeSignal: true },
  risk: { useATRStop: true, atrStopMultiplier: 2, useATRTrailingStop: false, atrTrailingMultiplier: 2, lots: 0.01 },
  visual: { showSignals: true, colorCandles: true, colorTrendBackground: true, showPanel: true },
};

export type Trend = 'UP' | 'DOWN' | 'NEUTRAL' | 'NOT_READY';

export function resolveMacroTimeframe(micro: Timeframe, configured: Timeframe | 'AUTO'): Timeframe | null {
  const microIndex = TIMEFRAMES.indexOf(micro);
  if (microIndex < 0) return null;
  const macro = configured === 'AUTO' ? TIMEFRAMES[microIndex + 1] : configured;
  return macro && TIMEFRAMES.indexOf(macro) > microIndex ? macro : null;
}

/** Uses only macro bars whose following bar had already begun at decisionAt.
 * The following bar proves closure but never contributes its price. */
export function macroTrendAt(rates: readonly Rate[], decisionAt: number, config: SmaMicroTrendConfig): Trend {
  if (!Number.isFinite(decisionAt)) return 'NOT_READY';
  let lastClosed = -1;
  for (let i = 0; i + 1 < rates.length; i++)
    if (rates[i + 1]!.t <= decisionAt) lastClosed = i;
  if (lastClosed + 1 < config.indicators.slowSMA) return 'NOT_READY';
  const closes = rates.slice(0, lastClosed + 1).map((rate) => rate.c);
  const fast = sma(closes, config.indicators.fastSMA)[lastClosed];
  const slow = sma(closes, config.indicators.slowSMA)[lastClosed];
  if (fast == null || slow == null) return 'NOT_READY';
  return fast > slow ? 'UP' : fast < slow ? 'DOWN' : 'NEUTRAL';
}
export interface SmaMicroTrendReading {
  trend: Trend;
  signal: Side | null;
  neutral: boolean;
  barTime: number | null;
  close: number | null;
  fastSMA: number | null;
  slowSMA: number | null;
  previousFastSMA: number | null;
  previousSlowSMA: number | null;
  atr: number | null;
}

/** Input includes the forming candle at the end. Only indexes <= length-2
 * participate in calculations; no future or unfinished candle is read. */
export function evaluateSmaMicroTrend(rates: readonly Rate[], config: SmaMicroTrendConfig): SmaMicroTrendReading {
  const closed = rates.slice(0, -1);
  const i = closed.length - 1;
  const empty: SmaMicroTrendReading = { trend: 'NOT_READY', signal: null, neutral: false, barTime: null, close: null, fastSMA: null, slowSMA: null, previousFastSMA: null, previousSlowSMA: null, atr: null };
  if (i < 0 || !config.enabled) return empty;
  const closes = closed.map((bar) => bar.c);
  const fast = sma(closes, config.indicators.fastSMA);
  const slow = sma(closes, config.indicators.slowSMA);
  const atrValues = atr(closed, config.indicators.atrPeriod);
  const f = fast[i] ?? null, s = slow[i] ?? null;
  const pf = fast[i - 1] ?? null, ps = slow[i - 1] ?? null;
  const a = atrValues[i] ?? null;
  const close = closed[i]!.c;
  if (f === null || s === null || pf === null || ps === null || a === null || !Number.isFinite(a) || a <= 0)
    return { ...empty, barTime: closed[i]!.t, close, fastSMA: f, slowSMA: s, previousFastSMA: pf, previousSlowSMA: ps, atr: a };
  const trend: Trend = f > s ? 'UP' : f < s ? 'DOWN' : 'NEUTRAL';
  const neutral = Math.abs(f - s) <= a * config.operations.neutralAtrFraction;
  const up = pf <= ps && f > s && config.operations.allowLong &&
    (!config.filters.requirePriceSameSideAsFastSMA || close > f) &&
    (!config.filters.requireSlowSMASlope || s > ps);
  const down = pf >= ps && f < s && config.operations.allowShort &&
    (!config.filters.requirePriceSameSideAsFastSMA || close < f) &&
    (!config.filters.requireSlowSMASlope || s < ps);
  return { trend, signal: up ? 'BUY' : down ? 'SELL' : null, neutral,
    barTime: closed[i]!.t, close, fastSMA: f, slowSMA: s,
    previousFastSMA: pf, previousSlowSMA: ps, atr: a };
}

export function atrTrailingStop(side: Side, previousStop: number, lastClosedPrice: number, currentAtr: number, multiplier: number): number {
  if (![previousStop, lastClosedPrice, currentAtr, multiplier].every(Number.isFinite) || currentAtr <= 0 || multiplier <= 0)
    throw new Error('Invalid ATR trailing inputs');
  const candidate = side === 'BUY' ? lastClosedPrice - currentAtr * multiplier : lastClosedPrice + currentAtr * multiplier;
  return side === 'BUY' ? Math.max(previousStop, candidate) : Math.min(previousStop, candidate);
}
