import { describe, expect, test } from 'bun:test';
import type { Rate } from '@trade/shared';
import { evaluateMarketForces } from './market-forces';

function series(closes: number[]): Rate[] {
  return closes.map((c, i) => ({ t: i * 60, o: c - 0.4, h: c + 0.1, l: c - 0.5, c, v: 1 }));
}

describe('market forces', () => {
  test('waits for sufficient valid closed history', () => {
    expect(evaluateMarketForces(series([1, 2, 3])).direction).toBe('NOT_READY');
    const invalid = series(Array.from({ length: 65 }, (_, i) => 100 + i));
    invalid[40]!.c = NaN;
    expect(evaluateMarketForces(invalid).frictionScore).toBeNull();
  });

  test('ignores unfinished candle entirely', () => {
    const rates = series(Array.from({ length: 65 }, (_, i) => 100 + i));
    const reading = evaluateMarketForces(rates);
    rates[rates.length - 1] = { t: NaN, o: NaN, h: NaN, l: NaN, c: NaN, v: 0 };
    expect(evaluateMarketForces(rates)).toEqual(reading);
    expect(reading.direction).toBe('UP');
    expect(reading.efficiency).toBe(1);
    // A monotonic price series has no confirmed swing structure.
    expect(reading.action).toBe('WAIT');
  });

  test('detects inefficient overlapping competition', () => {
    const rates = series(Array.from({ length: 65 }, (_, i) => 100 + (i % 2) * 0.1))
      .map((b) => ({ ...b, o: 100, h: 102, l: 98 }));
    const reading = evaluateMarketForces(rates);
    expect(reading.direction).toBe('NEUTRAL');
    expect(reading.friction).toBe('HIGH');
    expect(reading.action).toBe('WAIT');
    expect(reading.overlap).toBe(1);
  });

  test('mirroring price reverses direction and pressure symmetrically', () => {
    const rates = series(Array.from({ length: 65 }, (_, i) => 100 + i));
    const up = evaluateMarketForces(rates);
    const down = evaluateMarketForces(rates.map((b) => ({ ...b, o: -b.o, c: -b.c, h: -b.l, l: -b.h })));
    expect(down.direction).toBe('DOWN');
    expect(up.pressure).toBe('BUY');
    expect(down.pressure).toBe('SELL');
    expect(down.frictionScore).toBe(up.frictionScore);
  });
});
