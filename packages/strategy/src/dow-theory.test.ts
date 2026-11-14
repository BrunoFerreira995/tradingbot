import { describe, expect, test } from 'bun:test';
import type { Rate } from '@trade/shared';
import { defaultDowTheoryConfig, evaluateDowTheory } from './dow-theory';

function bars(values: Array<[number, number, number]>): Rate[] {
  return values.map(([high, low, close], i) => ({
    t: i * 60,
    o: close,
    h: high,
    l: low,
    c: close,
    v: 1,
  }));
}

describe('Dow Theory', () => {
  test('defaults to one-bar pivots and a 3R target', () => {
    expect(defaultDowTheoryConfig).toEqual({ pivotBars: 1, rewardRiskRatio: 3 });
  });

  test('signals only after confirmed higher highs and higher lows break out', () => {
    const history = bars([
      [10, 7, 8],
      [11, 6, 9],
      [12, 7, 10],
      [11, 8, 10],
      [10, 6, 9],
      [12, 7, 11],
      [13, 8, 12],
      [12, 9, 11],
      [11, 7, 10],
      [13, 8, 12],
      [14, 9, 13],
      [13, 10, 12.5],
      [12, 8, 11],
      [13, 10, 12],
      [15, 11, 14.6],
      [16, 10, 15],
    ]);

    const result = evaluateDowTheory(history, { pivotBars: 2, rewardRiskRatio: 3 });
    expect(result.trend).toBe('UP');
    expect(result.signal).toBe('BUY');
    expect(result.pivotHigh).toBe(14);
    expect(result.pivotLow).toBe(8);
    expect(result.stopPrice).toBe(8);
    expect(result.takeProfitDistance).toBeCloseTo(19.8);
  });

  test('signals only after confirmed lower lows and lower highs break down', () => {
    const history = bars([
      [20, 16, 18],
      [19, 15, 17],
      [21, 16, 18],
      [20, 14, 17],
      [18, 13, 16],
      [20, 14, 17],
      [19, 15, 16],
      [18, 13.5, 15],
      [16, 12, 14],
      [16.5, 13, 15],
      [17, 14, 14.5],
      [16, 12.5, 14],
      [15, 11, 12],
      [16, 12, 14],
      [15, 9, 10],
      [16, 8, 8.5],
    ]);

    const result = evaluateDowTheory(history, { pivotBars: 2, rewardRiskRatio: 3 });
    expect(result.trend).toBe('DOWN');
    expect(result.signal).toBe('SELL');
    expect(result.pivotLow).toBe(12);
    expect(result.pivotHigh).toBe(17);
    expect(result.stopPrice).toBe(17);
  });

  test('does not use the forming candle or enter without a fresh breakout', () => {
    const history = bars([
      [10, 7, 8],
      [11, 6, 9],
      [12, 7, 10],
      [11, 8, 10],
      [10, 6, 9],
      [12, 7, 11],
      [13, 8, 12],
      [12, 9, 11],
      [11, 7, 10],
      [13, 8, 12],
      [14, 9, 13],
      [13, 10, 12.5],
      [12, 8, 11],
      [13, 10, 12],
      [14, 10, 13.5],
      [20, 4, 18],
    ]);

    const result = evaluateDowTheory(history, { pivotBars: 2, rewardRiskRatio: 3 });
    expect(result.trend).toBe('UP');
    expect(result.signal).toBeNull();
    expect(result.close).toBe(13.5);
  });

  test('rejects invalid parameters', () => {
    expect(() =>
      evaluateDowTheory(
        bars([
          [2, 1, 1.5],
          [3, 1, 2],
        ]),
        { pivotBars: 0, rewardRiskRatio: 2 },
      ),
    ).toThrow('Invalid Dow Theory configuration');
  });
});
