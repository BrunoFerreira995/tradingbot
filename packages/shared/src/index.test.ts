import { describe, expect, test } from 'bun:test';
import { TIMEFRAMES, isTimeframe } from './index';

/**
 * `isTimeframe` guards the runner's configuration. The bug it prevents was
 * silent: an unrecognised value reaches the service, which falls back to
 * PERIOD_CURRENT, and the strategy then evaluates against whatever timeframe a
 * chart happens to carry instead of failing on the typo.
 */
describe('isTimeframe', () => {
  test('accepts every timeframe the service can parse', () => {
    for (const timeframe of TIMEFRAMES) expect(isTimeframe(timeframe)).toBe(true);
  });

  test('rejects values that would fall back to PERIOD_CURRENT', () => {
    for (const bad of ['', 'M20', 'm30', 'H2', 'D', 'PERIOD_M30', '30m'])
      expect(isTimeframe(bad)).toBe(false);
  });

  test('covers the nine periods ParsePeriod understands', () => {
    expect(TIMEFRAMES).toHaveLength(9);
  });
});
