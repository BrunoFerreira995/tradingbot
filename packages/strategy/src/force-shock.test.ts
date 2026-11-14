import { expect, test } from 'bun:test';
import type { Rate } from '@trade/shared';
import { evaluateForceShock, evaluateForceShockStrategy } from './force-shock';

const bar = (c: number, t: number, o = c - 0.05): Rate => ({ t, o, h: Math.max(o, c) + 0.1, l: Math.min(o, c) - 0.1, c, v: 1 });
function fixture() {
  const prior = Array.from({ length: 50 }, (_, i) => bar(100 + i * 0.1, i * 60));
  const shock = bar(prior.at(-1)!.c - 3, 50 * 60, prior.at(-1)!.c);
  return [...prior, shock, bar(shock.c, 51 * 60)];
}
test('measures a strong opposing shock using prior volatility', () => {
  const reading = evaluateForceShock(fixture());
  expect(reading.ready).toBe(true);
  expect(reading.priorDirection).toBe('UP');
  expect(reading.accelerationAtr!).toBeLessThan(-1);
  expect(reading.index!).toBeGreaterThan(1.18);
});
test('ignores forming candle including invalid forming prices', () => {
  const rates = fixture();
  const before = evaluateForceShockStrategy(rates);
  rates[rates.length - 1] = { t: NaN, o: NaN, h: NaN, l: NaN, c: NaN, v: 0 };
  expect(evaluateForceShockStrategy(rates)).toEqual(before);
});
test('cooldown reconstructs from history and expires after two following candles', () => {
  const rates = fixture();
  expect(evaluateForceShockStrategy(rates).cooldownRemaining).toBe(3);
  const shockClose = rates.at(-2)!.c;
  for (let age = 1; age <= 3; age++) {
    rates[rates.length - 1] = bar(shockClose + age * 0.1, (50 + age) * 60);
    rates.push(bar(shockClose + age * 0.1, (51 + age) * 60));
    const reading = evaluateForceShockStrategy(rates);
    expect(reading.cooldownRemaining).toBe(3 - age);
    expect(reading.blocked).toBe(age < 3);
  }
});
test('mirrored prices preserve shock intensity and invert prior direction', () => {
  const rates = fixture();
  const inverse = rates.map((b) => ({ ...b, o: 300 - b.o, h: 300 - b.l, l: 300 - b.h, c: 300 - b.c }));
  expect(evaluateForceShock(inverse).index).toBeCloseTo(evaluateForceShock(rates).index!, 8);
  expect(evaluateForceShock(inverse).priorDirection).toBe('DOWN');
});
test('invalid history blocks; invalid configuration fails explicitly', () => {
  expect(evaluateForceShockStrategy([]).blocked).toBe(true);
  const rates = fixture();
  rates[40]!.c = NaN;
  expect(evaluateForceShockStrategy(rates).action).toBe('WAIT');
  expect(() => evaluateForceShockStrategy([], { threshold: NaN })).toThrow();
  expect(() => evaluateForceShockStrategy([], { cooldownBars: 0 })).toThrow();
});
