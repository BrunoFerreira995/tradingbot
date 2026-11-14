import { describe, expect, test } from 'bun:test';
import type { Rate } from '@trade/shared';
import { atr } from './indicators';
import { atrTrailingStop, defaultSmaMicroTrendConfig, evaluateSmaMicroTrend, macroTrendAt, resolveMacroTimeframe, smaMicroTrendSchema } from './sma-micro-trend';
import { backtestSmaMicroTrend } from './sma-backtest';

const config = { ...defaultSmaMicroTrendConfig,
  indicators: { fastSMA: 2, slowSMA: 3, atrPeriod: 2 },
  filters: { ...defaultSmaMicroTrendConfig.filters, requirePriceSameSideAsFastSMA: false, requireSlowSMASlope: false },
  operations: { ...defaultSmaMicroTrendConfig.operations, reverseOnOppositeSignal: true },
};
function bars(closes: number[]): Rate[] {
  return closes.map((c, i) => ({ t: 1000 + i * 60, o: c, h: c + 1, l: c - 1, c, v: 1 }));
}

describe('SMA Micro Trend', () => {
  test('ATR seeds with first two true ranges and applies Wilder smoothing', () => {
    const input = [
      { h: 11, l: 9, c: 10 },
      { h: 13, l: 10, c: 12 },
      { h: 12, l: 8, c: 9 },
    ];
    expect(atr(input, 2)).toEqual([null, 2.5, 3.25]);
  });
  test('detects bullish and bearish crossover on closed bars only', () => {
    expect(evaluateSmaMicroTrend(bars([5, 4, 3, 4, 6, 100]), config).signal).toBe('BUY');
    expect(evaluateSmaMicroTrend(bars([3, 4, 5, 4, 2, -100]), config).signal).toBe('SELL');
    expect(evaluateSmaMicroTrend(bars([5, 4, 3, 4, 6, 100]), config).fastSMA).toBe(5);
    expect(evaluateSmaMicroTrend(bars([5, 4, 3]), config).trend).toBe('NOT_READY');
  });
  test('honors side, slope and neutral settings', () => {
    const bullish = bars([5, 4, 3, 4, 6, 7]);
    expect(evaluateSmaMicroTrend(bullish, { ...config, operations: { ...config.operations, allowLong: false } }).signal).toBeNull();
    expect(evaluateSmaMicroTrend(bullish, { ...config, filters: { ...config.filters, requireSlowSMASlope: true } }).signal).toBe('BUY');
    expect(evaluateSmaMicroTrend(bullish, { ...config, operations: { ...config.operations, neutralAtrFraction: 100 } }).neutral).toBe(true);
    expect(smaMicroTrendSchema.safeParse({ ...config, indicators: { fastSMA: 3, slowSMA: 2, atrPeriod: 2 } }).success).toBe(false);
  });
  test('price and slope filters independently reject crossovers', () => {
    const priceFilter = { ...config, filters: { ...config.filters, requirePriceSameSideAsFastSMA: true } };
    const slopeFilter = { ...config, filters: { ...config.filters, requireSlowSMASlope: true } };
    const long = bars([5, 4, 6, 5, 50]);
    const short = bars([5, 6, 4, 5, -50]);
    expect(evaluateSmaMicroTrend(long, config).signal).toBe('BUY');
    expect(evaluateSmaMicroTrend(short, config).signal).toBe('SELL');
    expect(evaluateSmaMicroTrend(long, priceFilter).signal).toBeNull();
    expect(evaluateSmaMicroTrend(short, priceFilter).signal).toBeNull();
    expect(evaluateSmaMicroTrend(long, slopeFilter).signal).toBeNull();
    expect(evaluateSmaMicroTrend(short, slopeFilter).signal).toBeNull();
  });
  test('macro trend uses only bars closed by the micro decision time', () => {
    const macro = [5, 4, 3, 100, 200].map((c, i) => ({ t: i * 300, o: c, h: c + 1, l: c - 1, c, v: 1 }));
    expect(macroTrendAt(macro, 899, config)).toBe('NOT_READY');
    expect(macroTrendAt(macro, 900, config)).toBe('DOWN');
    expect(macroTrendAt(macro, 1200, config)).toBe('UP');
    expect(resolveMacroTimeframe('M1', 'AUTO')).toBe('M5');
    expect(resolveMacroTimeframe('M30', 'AUTO')).toBe('H1');
    expect(resolveMacroTimeframe('M30', 'M5')).toBeNull();
  });
  test('backtest requires macro bars and filters entries by closed macro trend', () => {
    const history = bars([5, 4, 3, 4, 6, 7, 8, 7, 5, 3, 2]);
    const opts = { initialCapital: 1000, spread: 0, slippage: 0, commissionPerUnit: 0, units: 1 };
    const alignedConfig = { ...config, filters: { ...config.filters, requireMacroTrendAlignment: true } };
    expect(() => backtestSmaMicroTrend(history, alignedConfig, opts)).toThrow('Macro bars required');
    const macro = [10, 9, 8, 7, 6, 5].map((c, i) => ({ t: i * 300, o: c, h: c + 1, l: c - 1, c, v: 1 }));
    const result = backtestSmaMicroTrend(history, alignedConfig, opts, macro);
    expect(result.trades.some((trade) => trade.side === 'BUY' && trade.entryTime === history[5]?.t)).toBe(false);
  });
  test('trailing never loosens either stop', () => {
    expect(atrTrailingStop('BUY', 90, 100, 2, 2)).toBe(96);
    expect(atrTrailingStop('BUY', 96, 90, 2, 2)).toBe(96);
    expect(atrTrailingStop('SELL', 110, 100, 2, 2)).toBe(104);
    expect(atrTrailingStop('SELL', 104, 110, 2, 2)).toBe(104);
  });
  test('backtest enters after crossover and reproduces metrics', () => {
    const history = bars([5, 4, 3, 4, 6, 7, 8, 7, 5, 3, 2]);
    const opts = { initialCapital: 1000, spread: 0, slippage: 0, commissionPerUnit: 0, units: 1 };
    const first = backtestSmaMicroTrend(history, config, opts);
    expect(first.trades.length).toBeGreaterThan(0);
    expect(first.trades[0]?.entryTime).toBe(history[5]?.t);
    expect(backtestSmaMicroTrend(history, config, opts)).toEqual(first);
  });
});
