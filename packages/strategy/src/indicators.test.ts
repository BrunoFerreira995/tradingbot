import { describe, expect, test } from 'bun:test';
import { at, bollingerBands, rsi, sma, stdDev } from './indicators';
import {
  defaultMeanReversionConfig,
  evaluateMeanReversion,
  lastClosedBarTime,
  type MeanReversionConfig,
} from './mean-reversion-bb-rsi';

/** RSI(14) closes, the canonical Wilder example. */
const wilderCloses = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
  46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25,
  45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13,
];

describe('sma', () => {
  test('leaves the warm-up region undefined', () => {
    const series = sma([1, 2, 3, 4, 5], 3);
    expect(series[0]).toBeNull();
    expect(series[1]).toBeNull();
    expect(series[2]).toBe(2);
    expect(series[3]).toBe(3);
    expect(series[4]).toBe(4);
  });

  test('is stable on a constant series', () => {
    expect(sma([7, 7, 7, 7], 4)).toEqual([null, null, null, 7]);
  });
});

describe('stdDev', () => {
  test('uses the population formula, matching MetaTrader', () => {
    // [2,4,4,4,5,5,7,9]: mean 5, population variance 4, so sigma 2. The sample
    // deviation would be ~2.138, which would widen the bands by ~7%.
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9], 8)[7]).toBeCloseTo(2, 10);
  });

  test('is zero on a constant series', () => {
    expect(stdDev([3, 3, 3, 3], 4)[3]).toBe(0);
  });
});

describe('bollingerBands', () => {
  test('places the bands symmetrically around the base', () => {
    const bands = bollingerBands([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(bands.base[7]).toBeCloseTo(5, 10);
    expect(bands.upper[7]).toBeCloseTo(9, 10);
    expect(bands.lower[7]).toBeCloseTo(1, 10);
  });

  test('collapses onto the base when there is no variance', () => {
    const bands = bollingerBands([5, 5, 5, 5], 4, 2);
    expect(bands.upper[3]).toBe(5);
    expect(bands.lower[3]).toBe(5);
  });
});

describe('rsi', () => {
  test('seeds the first value from the simple average of the first period', () => {
    // Verified by hand over the 14 changes ending at index 14:
    // gains 3.34, losses 1.40, so avgGain 0.2385714, avgLoss 0.1,
    // RS 2.385714 and RSI = 100 - 100/3.385714 = 70.4641.
    const series = rsi(wilderCloses, 14);
    expect(series[14]).toBeCloseTo(70.4641, 4);
  });

  test('agrees with an independent Wilder implementation', () => {
    // Deliberately written without incremental averaging: every value is
    // recomputed from scratch, so a bug in the smoothing of one cannot hide in
    // the other.
    const reference = (values: number[], period: number): number[] => {
      const out: number[] = [];
      let avgGain = 0;
      let avgLoss = 0;
      for (let i = 1; i < values.length; i++) {
        const change = (values[i] as number) - (values[i - 1] as number);
        if (i <= period) {
          if (change > 0) avgGain += change;
          else avgLoss -= change;
          if (i === period) {
            avgGain /= period;
            avgLoss /= period;
          }
        } else {
          avgGain =
            (avgGain * (period - 1) + Math.max(change, 0)) / (period + 1);
          avgLoss =
            (avgLoss * (period - 1) + Math.max(-change, 0)) / (period + 1);
        }
        const total = avgGain + avgLoss;
        out.push(total === 0 ? 50 : (avgGain / total) * 100);
      }
      return out;
    };

    const mine = rsi(wilderCloses, 14);
    const theirs = reference(wilderCloses, 14);
    // The first value lands at change index 14, which is position 13 in the
    // reference list and 14 in the series.
    expect(theirs[13]).toBeCloseTo(70.4641, 4);
    expect(mine[14]).toBeCloseTo(theirs[13] as number, 9);
    for (let i = 14; i < theirs.length; i++) {
      expect(mine[i + 1]).toBeCloseTo(theirs[i] as number, 9);
    }
  });

  test('leaves the warm-up region undefined', () => {
    const series = rsi(wilderCloses, 14);
    for (let i = 0; i < 14; i++) expect(series[i]).toBeNull();
  });

  test('is 100 on a monotonically rising series', () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(rising, 14)[19]).toBeCloseTo(100, 6);
  });

  test('is 0 on a monotonically falling series', () => {
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(falling, 14)[19]).toBeCloseTo(0, 6);
  });

  test('stays neutral on a flat series instead of dividing by zero', () => {
    const flat = new Array(20).fill(42);
    expect(rsi(flat, 14)[19]).toBe(50);
  });
});

describe('at', () => {
  test('counts the newest bar as offset 0 and skips the forming bar at 1', () => {
    const series = [10, 20, 30, 40];
    expect(at(series, 0)).toBe(40);
    expect(at(series, 1)).toBe(30);
    expect(at([1, null, 3], 1)).toBeNull();
  });
});

const config: MeanReversionConfig = {
  ...defaultMeanReversionConfig,
  symbol: 'XAUUSD',
  timeframe: 'M30',
};

function bars(closes: number[]): Array<{ t: number; c: number }> {
  return closes.map((c, i) => ({ t: 1000 + i, c }));
}

/**
 * `rates` is oldest first and its last entry is the still-forming bar, so a
 * setup has to place the shock one position before the end. These helpers build
 * [calm..., shock, forming].
 */
function buyingSetup(): number[] {
  const calm = Array.from({ length: 40 }, (_, i) => 100 + i * 0.05);
  return [...calm, 96, 97];
}

function sellingSetup(): number[] {
  const calm = Array.from({ length: 40 }, (_, i) => 100 - i * 0.05);
  return [...calm, 104, 105];
}

describe('evaluateMeanReversion', () => {
  test('stays silent while the indicators are still warming up', () => {
    expect(evaluateMeanReversion(bars([1, 2, 3, 4, 5]), config, 3)).toBeNull();
  });

  test('stays silent when price is inside the bands', () => {
    const flat = new Array(60).fill(100);
    expect(evaluateMeanReversion(bars(flat), config, 100)).toBeNull();
  });

  test('buys when the closed candle touches the lower band with oversold RSI', () => {
    const decision = evaluateMeanReversion(bars(buyingSetup()), config, 96);
    expect(decision?.side).toBe('BUY');
    expect(decision?.close).toBe(96);
    expect(decision?.close).toBeLessThanOrEqual(decision?.lower ?? 0);
    expect(decision?.rsiValue).toBeLessThanOrEqual(config.rsiOversold);
  });

  test('sells on the mirrored setup', () => {
    const decision = evaluateMeanReversion(bars(sellingSetup()), config, 104);
    expect(decision?.side).toBe('SELL');
    expect(decision?.close).toBe(104);
    expect(decision?.close).toBeGreaterThanOrEqual(decision?.upper ?? Infinity);
    expect(decision?.rsiValue).toBeGreaterThanOrEqual(config.rsiOverbought);
  });

  test('never sells a long when shorts are disabled', () => {
    expect(
      evaluateMeanReversion(
        bars(sellingSetup()),
        { ...config, enableShort: false },
        104,
      ),
    ).toBeNull();
  });

  test('converts the stop percentages into price distances', () => {
    const decision = evaluateMeanReversion(bars(buyingSetup()), config, 2000);
    expect(decision?.stopDistance).toBeCloseTo(20, 8);
    expect(decision?.takeProfitDistance).toBeCloseTo(30, 8);
  });

  test('ignores the forming bar when deciding', () => {
    // The closed bar closed below the lower band and must trigger; the forming
    // bar is back inside the range, so reading offset 0 would find nothing.
    const calm = Array.from({ length: 40 }, (_, i) => 100 + i * 0.05);
    const series = [...calm, 96, 102];
    expect(evaluateMeanReversion(bars(series), config, 96)?.side).toBe('BUY');
    // The forming bar alone would be mid-band: no setup at all.
    expect(evaluateMeanReversion(bars([...calm, 96]), config, 102)).toBeNull();
  });
});

describe('lastClosedBarTime', () => {
  test('returns the bar before the forming one', () => {
    expect(lastClosedBarTime([{ t: 1 }, { t: 2 }, { t: 3 }])).toBe(2);
  });

  test('returns null without a closed bar', () => {
    expect(lastClosedBarTime([])).toBeNull();
    expect(lastClosedBarTime([{ t: 1 }])).toBeNull();
  });
});
