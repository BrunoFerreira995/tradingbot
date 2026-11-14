import { expect, test } from 'bun:test';
import type { Rate, SymbolInfo } from '@trade/shared';
import { defaultDiversifiedTrendConfig, evaluateDiversifiedTrend, sizeDiversifiedTrend, trendAllocationWeight } from './diversified-trend';
import { normalizeForexDailyRates, backtestDiversifiedTrend, type PreparedTrendMarket } from './diversified-trend-backtest';

const config = { ...defaultDiversifiedTrendConfig, lookback: 20, volatilityPeriod: 20 };
const candles = (): Rate[] => Array.from({ length: 80 }, (_, i) => {
  const c = 1 + i * 0.001 + (i % 3) * 0.0002;
  return { t: i * 86400, o: c - 0.0001, h: c + 0.001, l: c - 0.001, c, v: 1 };
});
test('momentum is causal and detects positive and negative trends', () => {
  const bars = candles();
  const reading = evaluateDiversifiedTrend(bars, config);
  expect(reading.side).toBe('BUY');
  expect(reading.annualVolatility!).toBeGreaterThan(0);
  bars[bars.length - 1] = { t: NaN, o: NaN, h: NaN, l: NaN, c: NaN, v: 0 };
  expect(evaluateDiversifiedTrend(bars, config)).toEqual(reading);
  const falling = candles().map((b) => ({ ...b, o: 3 - b.o, h: 3 - b.l, l: 3 - b.h, c: 3 - b.c }));
  expect(evaluateDiversifiedTrend(falling, config).side).toBe('SELL');
  expect(evaluateDiversifiedTrend([], config).ready).toBe(false);
});
test('higher volatility and more legs reduce allocation; gross budget caps weight', () => {
  expect(trendAllocationWeight(0.1, 7, config)).toBeCloseTo(1 / 7);
  expect(trendAllocationWeight(0.2, 7, config)).toBeCloseTo(1 / 14);
  expect(trendAllocationWeight(0.001, 7, config)).toBeCloseTo(2 / 7);
});
test('lot sizing rounds down without increasing a subminimum budget', () => {
  const info = { tickSize: 0.00001, tickValue: 1, tickValueLoss: 1, lotStep: 0.01, minLot: 0.01, maxLot: 100 } as SymbolInfo;
  expect(sizeDiversifiedTrend(10000, 1, 0.1, 7, info, 1, config)).toBe(0.01);
  expect(sizeDiversifiedTrend(100, 1, 0.1, 7, info, 1, config)).toBeNull();
  expect(sizeDiversifiedTrend(10000, 1, 0.1, 1, info, 0.02, config)).toBe(0.02);
});
test('Sunday merges into Monday preserving Sunday open and both extremes', () => {
  const sunday = Date.UTC(2025, 0, 5) / 1000;
  const result = normalizeForexDailyRates([
    { t: sunday, o: 1, h: 1.1, l: 0.9, c: 1.05, v: 1 },
    { t: sunday + 86400, o: 1.05, h: 1.2, l: 1, c: 1.15, v: 2 },
  ]);
  expect(result).toEqual([{ t: sunday + 86400, o: 1, h: 1.2, l: 0.9, c: 1.15, v: 3 }]);
});

function market(symbol = 'EURUSD', scale = 1): PreparedTrendMarket {
  const bars = [0, 1, 2].map((i) => ({ t: i * 86400, o: scale, h: scale * 1.02, l: scale * 0.999, c: scale * (i === 2 ? 1.01 : 1), v: 1 }));
  const reading = { ready: true, side: 'BUY' as const, close: scale, momentum: 0.1, score: 1, annualVolatility: 0.1, atr: scale * 0.01 };
  return { symbols: [symbol], times: bars.map((b) => b.t), bars: { [symbol]: bars }, readings: { [symbol]: bars.map(() => reading) } };
}
const options = { from: 86400, to: 3 * 86400, initialCapital: 10000, spreads: { EURUSD: 0, USDJPY: 0 }, spreadMultiplier: 1,
  slippageFraction: 0, commissionPerLotRoundTrip: 7, annualFinancingDrag: 0 };
test('portfolio reconciles entry/exit fees and cash', () => {
  const result = backtestDiversifiedTrend(market(), config, options);
  expect(result.tradeCount).toBe(1);
  expect(result.netUsd).toBeCloseTo(99.3, 6);
  expect(result.totalFees).toBeCloseTo(0.7, 6);
  expect(result.finalEquity).toBeCloseTo(10099.3, 6);
});
test('USD-base P&L converts quote currency at exit rate', () => {
  const result = backtestDiversifiedTrend(market('USDJPY', 100), config, options);
  expect(result.netUsd).toBeCloseTo(10000 / 101 - 0.7, 6);
});
test('stop wins an ambiguous candle; no optimistic target fill', () => {
  const m = market();
  m.bars.EURUSD![1] = { ...m.bars.EURUSD![1]!, h: 1.2, l: 0.9 };
  m.readings.EURUSD![2] = { ...m.readings.EURUSD![2]!, side: null };
  const result = backtestDiversifiedTrend(m, config, options);
  expect(result.trades[0]!.reason).toBe('SL');
  expect(result.netUsd).toBeCloseTo(-300.7, 6);
});
test('financing stress reduces cash and reconciles to trade P&L', () => {
  const result = backtestDiversifiedTrend(market(), config, { ...options, annualFinancingDrag: 0.02 });
  expect(result.netUsd).toBeLessThan(99.3);
  expect(result.totalFinancing).toBeGreaterThan(0);
  expect(result.netUsd).toBeCloseTo(99.3 - result.totalFinancing, 6);
});
