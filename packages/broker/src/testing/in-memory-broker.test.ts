import { describe, expect, test } from 'bun:test';
import type { Timeframe } from '@trade/shared';
import { InMemoryBrokerAdapter } from './in-memory-broker';

const stepSeconds: Record<Timeframe, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
  W1: 604800,
  MN1: 2592000,
};

async function bars(symbol: string, period: Timeframe, count: number) {
  const broker = new InMemoryBrokerAdapter();
  await broker.connect();
  return broker.getRates(symbol, period, count);
}

describe('InMemoryBrokerAdapter.getRates', () => {
  test('returns the requested number of bars', async () => {
    expect(await bars('XAUUSD', 'M30', 120)).toHaveLength(120);
  });

  test('caps runaway requests', async () => {
    expect((await bars('XAUUSD', 'M30', 100000)).length).toBeLessThanOrEqual(
      500,
    );
  });

  test('orders bars oldest first on the timeframe grid', async () => {
    const rates = await bars('XAUUSD', 'M30', 50);
    for (let i = 1; i < rates.length; i++) {
      expect(
        (rates[i] as { t: number }).t - (rates[i - 1] as { t: number }).t,
      ).toBe(1800);
    }
    const last = rates.at(-1) as { t: number };
    expect(last.t % 1800).toBe(0);
  });

  test('uses epoch seconds, not milliseconds', async () => {
    // Regression guard: a millisecond timestamp here would place bars in the
    // year 58000 once the runner converts them for display and audit, and the
    // strategy would compare a bar clock that never matches the terminal's.
    const rates = await bars('XAUUSD', 'H1', 10);
    const now = Math.floor(Date.now() / 1000);
    const last = (rates.at(-1) as { t: number }).t;
    expect(last).toBeLessThanOrEqual(now);
    expect(now - last).toBeLessThan(3600);
  });

  test('keeps every timeframe on its own grid', async () => {
    for (const [period, step] of Object.entries(stepSeconds)) {
      const rates = await bars('EURUSD', period as Timeframe, 3);
      expect((rates.at(-1) as { t: number }).t % step).toBe(0);
    }
  });

  test('emits finite, coherent OHLC', async () => {
    const rates = await bars('XAUUSD', 'M30', 200);
    for (const rate of rates) {
      expect(
        [rate.o, rate.h, rate.l, rate.c, rate.v].every(Number.isFinite),
      ).toBe(true);
      expect(rate.h).toBeGreaterThanOrEqual(Math.max(rate.o, rate.c));
      expect(rate.l).toBeLessThanOrEqual(Math.min(rate.o, rate.c));
      expect(rate.l).toBeGreaterThan(0);
    }
  });

  test('is deterministic per symbol and varies across symbols', async () => {
    const first = await bars('XAUUSD', 'M30', 10);
    const again = await bars('XAUUSD', 'M30', 10);
    const other = await bars('EURUSD', 'M30', 10);
    // Compare the body of the series, excluding the time anchors which move.
    expect(first.map((r) => r.c)).toEqual(again.map((r) => r.c));
    expect(first.map((r) => r.c)).not.toEqual(other.map((r) => r.c));
  });

  test('refuses to serve a disconnected broker', async () => {
    const broker = new InMemoryBrokerAdapter();
    await expect(broker.getRates('XAUUSD', 'M30', 10)).rejects.toThrow(
      'Broker disconnected',
    );
  });
});
