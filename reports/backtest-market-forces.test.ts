import { expect, test } from 'bun:test';
import { protectiveExit, simulate } from './backtest-market-forces';

const bar = { t: 1, o: 100, h: 110, l: 90, c: 100, v: 1 };
const long = { side: 'BUY' as const, entry: 100, stop: 95, target: 105, enteredAt: 0 };

test('ambiguous candle takes stop rather than optimistic target', () => {
  expect(protectiveExit(long, bar, 1, 0)).toEqual({ exit: 95, reason: 'SL' });
});
test('stop gaps and market slippage are adverse', () => {
  expect(protectiveExit(long, { ...bar, o: 92 }, 1, 0.5)).toEqual({ exit: 91.5, reason: 'SL' });
});
test('short stop is triggered on ask, not bid', () => {
  const short = { side: 'SELL' as const, entry: 100, stop: 105, target: 90, enteredAt: 0 };
  expect(protectiveExit(short, { ...bar, h: 104.5, l: 99 }, 1, 0)).toEqual({ exit: 105, reason: 'SL' });
});
test('does not improve target fill through a gap', () => {
  expect(protectiveExit(long, { ...bar, o: 108, l: 107 }, 1, 0)).toEqual({ exit: 105, reason: 'TP' });
});
test('unfinished final candle cannot affect trades or results', () => {
  const bars = Array.from({ length: 100 }, (_, i) => {
    const c = 100 + i * 0.8 + [0, 1, 2, -1][i % 4]!;
    return { t: i * 60, o: c - 0.8, c, h: c + 0.1, l: c - 1, v: 1 };
  });
  const first = simulate(bars, 'EURUSD', 0.0001, 0);
  bars[bars.length - 1] = { ...bar, t: 99 * 60, o: 10000, h: 20000, l: 0, c: 5000 };
  expect(simulate(bars, 'EURUSD', 0.0001, 0)).toEqual(first);
  expect(first.tradeCount).toBeGreaterThan(0);
});

test('shock simulation preserves baseline when guard never triggers and blocks actual setups when enabled', () => {
  const bars = Array.from({ length: 150 }, (_, i) => {
    const c = i < 50 ? 100 : 100 + (i - 50) * 0.8 + [0, 1, 2, -1][i % 4]!;
    return { t: i * 60, o: c - 0.8, c, h: c + 0.1, l: c - 1, v: 1 };
  });
  const baseline = simulate(bars, 'GBPUSD', 0.00012, 0);
  const unblocked = simulate(bars, 'GBPUSD', 0.00012, 0, undefined, { threshold: 1e9, cooldownBars: 1 });
  expect(unblocked).toEqual(baseline);
  const blocked = simulate(bars, 'GBPUSD', 0.00012, 0, undefined, { threshold: 0.01 });
  expect(blocked.shockBlocked).toBeGreaterThan(0);
  expect(blocked.trades).not.toEqual(baseline.trades);
});
