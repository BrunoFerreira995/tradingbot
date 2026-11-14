import { z } from 'zod';
import type { Rate, Side } from '@trade/shared';
import { atr, sma } from './indicators';

/**
 * Classic candlestick patterns.
 *
 * Every decision reads closed bars only: the final input bar is treated as the
 * forming candle and never contributes. Patterns are pure geometry, so they are
 * easy to test, but geometry alone is not an edge. The strategy therefore pairs
 * a pattern with a trend context and sizes its stop from ATR, and it makes no
 * profitability claim.
 */

export const candlePatternsSchema = z
  .object({
    fastSma: z.number().int().min(2).max(200).default(20),
    slowSma: z.number().int().min(3).max(500).default(50),
    atrLength: z.number().int().min(2).max(100).default(14),
    atrStopMultiplier: z.number().finite().min(0.25).max(10).default(1.5),
    rewardRisk: z.number().finite().min(0.5).max(10).default(2),
    lots: z.number().finite().positive().max(100).default(0.01),
    enableShort: z.boolean().default(true),
    /**
     * trend:    only trade with the SMA structure.
     * reversal: only trade classic reversal patterns against the SMA structure.
     * none:     take the pattern wherever it appears.
     */
    alignment: z.enum(['trend', 'reversal', 'none']).default('trend'),
    /** Minimum last-candle range as a multiple of ATR; 0 disables the filter. */
    minRangeAtr: z.number().finite().min(0).max(5).default(0),
    patterns: z
      .object({
        engulfing: z.boolean().default(true),
        hammer: z.boolean().default(true),
        shootingStar: z.boolean().default(true),
        doji: z.boolean().default(true),
        harami: z.boolean().default(true),
        insideBar: z.boolean().default(true),
        marubozu: z.boolean().default(true),
      })
      .default({
        engulfing: true,
        hammer: true,
        shootingStar: true,
        doji: true,
        harami: true,
        insideBar: true,
        marubozu: true,
      }),
  })
  .superRefine((value, ctx) => {
    if (value.fastSma >= value.slowSma)
      ctx.addIssue({
        code: 'custom',
        path: ['fastSma'],
        message: 'fastSma must be lower than slowSma',
      });
  });

export type CandlePatternsConfig = z.infer<typeof candlePatternsSchema>;
export const defaultCandlePatternsConfig = candlePatternsSchema.parse({});

export type CandlePattern =
  | 'BULLISH_ENGULFING'
  | 'BEARISH_ENGULFING'
  | 'HAMMER'
  | 'SHOOTING_STAR'
  | 'DOJI'
  | 'BULLISH_HARAMI'
  | 'BEARISH_HARAMI'
  | 'INSIDE_BAR'
  | 'BULLISH_INSIDE_BREAKOUT'
  | 'BEARISH_INSIDE_BREAKOUT'
  | 'BULLISH_MARUBOZU'
  | 'BEARISH_MARUBOZU';

export type CandleTrend = 'UP' | 'DOWN' | 'NEUTRAL' | 'NOT_READY';

export interface CandleShape {
  body: number;
  range: number;
  upperWick: number;
  lowerWick: number;
  bullish: boolean;
  bearish: boolean;
  doji: boolean;
}

export interface CandlePatternsReading {
  ready: boolean;
  close: number | null;
  fastSMA: number | null;
  slowSMA: number | null;
  atr: number | null;
  trend: CandleTrend;
  patterns: CandlePattern[];
  signal: Side | null;
  stopDistance: number | null;
  takeProfitDistance: number | null;
  reason: string;
}

function shape(bar: Rate): CandleShape {
  const body = Math.abs(bar.c - bar.o);
  const range = bar.h - bar.l;
  return {
    body,
    range,
    upperWick: bar.h - Math.max(bar.o, bar.c),
    lowerWick: Math.min(bar.o, bar.c) - bar.l,
    bullish: bar.c > bar.o,
    bearish: bar.c < bar.o,
    doji: range > 0 && body <= range * 0.1,
  };
}

function engulfing(previous: CandleShape, current: CandleShape): boolean {
  return (
    previous.body > 0 &&
    current.body > previous.body &&
    ((previous.bearish && current.bullish) ||
      (previous.bullish && current.bearish))
  );
}

function bodyEngulfs(previous: Rate, current: Rate): boolean {
  const high = Math.max(previous.o, previous.c);
  const low = Math.min(previous.o, previous.c);
  return current.c > current.o
    ? current.c >= high && current.o <= low
    : current.o >= high && current.c <= low;
}

function harami(previous: CandleShape, current: CandleShape): boolean {
  return (
    previous.body > 0 &&
    current.body > 0 &&
    current.body < previous.body &&
    previous.bearish !== current.bearish
  );
}

function bodyInside(previous: Rate, current: Rate): boolean {
  return (
    current.c <= Math.max(previous.o, previous.c) &&
    current.c >= Math.min(previous.o, previous.c) &&
    current.o <= Math.max(previous.o, previous.c) &&
    current.o >= Math.min(previous.o, previous.c)
  );
}

function hammer(current: CandleShape): boolean {
  return (
    current.range > 0 &&
    current.body > 0 &&
    current.lowerWick >= current.body * 2 &&
    current.upperWick <= Math.max(current.body, current.range * 0.1) &&
    current.body <= current.range * 0.4
  );
}

function shootingStar(current: CandleShape): boolean {
  return (
    current.range > 0 &&
    current.body > 0 &&
    current.upperWick >= current.body * 2 &&
    current.lowerWick <= Math.max(current.body, current.range * 0.1) &&
    current.body <= current.range * 0.4
  );
}

function marubozu(current: CandleShape): boolean {
  return current.range > 0 && current.body >= current.range * 0.9;
}

/**
 * Detects patterns on the last closed bar of `bars`. The caller passes closed
 * bars only; this function never looks at a still-forming candle.
 */
export function detectCandlePatterns(
  bars: readonly Rate[],
  config: CandlePatternsConfig = defaultCandlePatternsConfig,
): CandlePattern[] {
  const c = candlePatternsSchema.parse(config);
  const last = bars.at(-1);
  const previous = bars.at(-2);
  if (!last || !previous) return [];
  const patterns: CandlePattern[] = [];
  const lastShape = shape(last);
  const previousShape = shape(previous);

  if (c.patterns.engulfing) {
    if (engulfing(previousShape, lastShape) && bodyEngulfs(previous, last)) {
      patterns.push(
        lastShape.bullish ? 'BULLISH_ENGULFING' : 'BEARISH_ENGULFING',
      );
    }
  }
  if (c.patterns.hammer && hammer(lastShape)) patterns.push('HAMMER');
  if (c.patterns.shootingStar && shootingStar(lastShape))
    patterns.push('SHOOTING_STAR');
  if (c.patterns.doji && lastShape.doji) patterns.push('DOJI');
  if (c.patterns.harami && harami(previousShape, lastShape) && bodyInside(previous, last)) {
    patterns.push(lastShape.bullish ? 'BULLISH_HARAMI' : 'BEARISH_HARAMI');
  }
  if (c.patterns.marubozu && marubozu(lastShape)) {
    patterns.push(
      lastShape.bullish ? 'BULLISH_MARUBOZU' : 'BEARISH_MARUBOZU',
    );
  }

  if (c.patterns.insideBar) {
    const mother = bars.at(-3);
    if (mother) {
      const motherShape = shape(mother);
      const lastInsidePrevious = last.h <= previous.h && last.l >= previous.l;
      if (lastInsidePrevious) patterns.push('INSIDE_BAR');
      // A breakout is the bar after an inside bar closing beyond the mother
      // range, so it needs three closed bars: mother, inside, trigger.
      const previousInsideMother =
        previous.h <= mother.h && previous.l >= mother.l;
      if (previousInsideMother && motherShape.range > 0) {
        if (last.c > mother.h) patterns.push('BULLISH_INSIDE_BREAKOUT');
        else if (last.c < mother.l)
          patterns.push('BEARISH_INSIDE_BREAKOUT');
      }
    }
  }

  return patterns;
}

/** Bullish and bearish pattern names implied by a detected pattern list. */
export function patternSides(patterns: readonly CandlePattern[]): {
  buy: boolean;
  sell: boolean;
} {
  const buy = patterns.some((pattern) =>
    [
      'BULLISH_ENGULFING',
      'HAMMER',
      'BULLISH_HARAMI',
      'BULLISH_INSIDE_BREAKOUT',
      'BULLISH_MARUBOZU',
    ].includes(pattern),
  );
  const sell = patterns.some((pattern) =>
    [
      'BEARISH_ENGULFING',
      'SHOOTING_STAR',
      'BEARISH_HARAMI',
      'BEARISH_INSIDE_BREAKOUT',
      'BEARISH_MARUBOZU',
    ].includes(pattern),
  );
  return { buy, sell };
}

/**
 * Evaluates the last closed bar and returns a reading for the runner.
 *
 * `rates` is oldest first and includes the still-forming bar, exactly as the
 * MT5 bridge returns it. The trend uses closed bars only.
 */
export function evaluateCandlePatterns(
  rates: readonly Rate[],
  config: CandlePatternsConfig = defaultCandlePatternsConfig,
): CandlePatternsReading {
  const c = candlePatternsSchema.parse(config);
  const empty: CandlePatternsReading = {
    ready: false,
    close: null,
    fastSMA: null,
    slowSMA: null,
    atr: null,
    trend: 'NOT_READY',
    patterns: [],
    signal: null,
    stopDistance: null,
    takeProfitDistance: null,
    reason: 'Histórico insuficiente para padrões de candle.',
  };

  const bars = rates.slice(0, -1);
  const last = bars.at(-1);
  if (!last) return empty;
  if (
    bars.some(
      (bar) =>
        ![bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite) ||
        bar.l <= 0 ||
        bar.h < Math.max(bar.o, bar.c) ||
        bar.l > Math.min(bar.o, bar.c),
    )
  )
    return { ...empty, reason: 'Histórico de candles inválido.' };

  const closes = bars.map((bar) => bar.c);
  const fastSMA = sma(closes, c.fastSma).at(-1) ?? null;
  const slowSMA = sma(closes, c.slowSma).at(-1) ?? null;
  const atrValue = atr(bars, c.atrLength).at(-1) ?? null;
  const close = last.c;
  if (fastSMA === null || slowSMA === null || atrValue === null)
    return { ...empty, close };

  const trend: CandleTrend =
    close > slowSMA && fastSMA > slowSMA
      ? 'UP'
      : close < slowSMA && fastSMA < slowSMA
        ? 'DOWN'
        : 'NEUTRAL';

  const patterns = detectCandlePatterns(bars, c);
  const { buy, sell } = patternSides(patterns);
  const base: CandlePatternsReading = {
    ready: true,
    close,
    fastSMA,
    slowSMA,
    atr: atrValue,
    trend,
    patterns,
    signal: null,
    stopDistance: atrValue * c.atrStopMultiplier,
    takeProfitDistance: atrValue * c.atrStopMultiplier * c.rewardRisk,
    reason:
      patterns.length > 0
        ? `Padrões: ${patterns.join(', ')}; tendência ${trend}.`
        : 'Nenhum padrão de candle na última barra fechada.',
  };

  if (!patterns.length) return base;
  if (buy && sell)
    return { ...base, reason: `Padrões conflitantes: ${patterns.join(', ')}.` };
  if (!buy && !sell)
    return {
      ...base,
      reason: `Padrões neutros (${patterns.join(', ')}); sem direção de entrada.`,
    };

  const side: Side = buy ? 'BUY' : 'SELL';
  if (side === 'SELL' && !c.enableShort)
    return { ...base, reason: 'Venda desabilitada na configuração.' };
  if (c.alignment !== 'none') {
    const expected =
      c.alignment === 'trend'
        ? side === 'BUY'
          ? 'UP'
          : 'DOWN'
        : side === 'BUY'
          ? 'DOWN'
          : 'UP';
    if (trend !== expected)
      return {
        ...base,
        reason: `Padrão ${side} em tendência ${trend}; alinhamento ${c.alignment} exige ${expected}.`,
      };
  }
  if (c.minRangeAtr > 0) {
    const lastShape = shape(last);
    if (lastShape.range < atrValue * c.minRangeAtr)
      return {
        ...base,
        reason: `Range ${lastShape.range} abaixo de ${c.minRangeAtr} ATR; ruído filtrado.`,
      };
  }
  if (!(atrValue > 0))
    return { ...base, reason: 'ATR inválido para dimensionar o stop.' };

  return {
    ...base,
    signal: side,
    reason: `${side} por ${patterns.join(', ')}; tendência ${trend}; ATR=${atrValue}.`,
  };
}
