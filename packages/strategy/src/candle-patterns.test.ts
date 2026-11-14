import { describe, expect, test } from 'bun:test';
import type { Rate } from '@trade/shared';
import {
  candlePatternsSchema,
  defaultCandlePatternsConfig,
  detectCandlePatterns,
  evaluateCandlePatterns,
  type CandlePatternsConfig,
} from './candle-patterns';

function trend(
  direction: 'up' | 'down',
  count = 62,
  start = 100,
): Rate[] {
  return Array.from({ length: count }, (_, index) => {
    const level = start + index * 0.2;
    const open = direction === 'up' ? level : start + (count - 1) * 0.2 - index * 0.2;
    const close = direction === 'up' ? open + 0.12 : open - 0.12;
    return {
      t: 1_700_000_000 + index * 60,
      o: open,
      h: Math.max(open, close) + 0.05,
      l: Math.min(open, close) - 0.05,
      c: close,
      v: 1,
    };
  });
}

type BarInput = Pick<Rate, 'o' | 'h' | 'l' | 'c'> & Partial<Pick<Rate, 'v'>>;

function append(bars: Rate[], bar: BarInput): Rate[] {
  const last = bars.at(-1)!;
  return [...bars, { ...bar, t: last.t + 60, v: bar.v ?? 1 }];
}

function forming(bars: Rate[], bar: BarInput): Rate[] {
  return append(bars, bar);
}

function withFormingBar(bars: Rate[]): Rate[] {
  const close = bars.at(-1)!.c;
  return forming(bars, { o: close, h: close, l: close, c: close });
}

const config = (
  overrides: Partial<CandlePatternsConfig> = {},
): CandlePatternsConfig =>
  candlePatternsSchema.parse({
    ...defaultCandlePatternsConfig,
    ...overrides,
  });

describe('candlestick pattern detection', () => {
  test('detects a bullish engulfing only from the two closed candles', () => {
    const closed = trend('up');
    const top = closed.at(-1)!.c;
    const previous = { o: top + 0.5, h: top + 0.6, l: top + 0.1, c: top + 0.1 };
    const current = { o: top, h: top + 0.7, l: top - 0.1, c: top + 0.6 };
    const bars = append(append(closed, previous), current);

    const patterns = detectCandlePatterns(bars);
    expect(patterns).toContain('BULLISH_ENGULFING');
  });

  test('detects a bearish engulfing', () => {
    const closed = trend('down');
    const bottom = closed.at(-1)!.c;
    const previous = {
      o: bottom - 0.5,
      h: bottom - 0.1,
      l: bottom - 0.6,
      c: bottom - 0.1,
    };
    const current = {
      o: bottom - 0.05,
      h: bottom,
      l: bottom - 0.7,
      c: bottom - 0.65,
    };
    const bars = append(append(closed, previous), current);

    expect(detectCandlePatterns(bars)).toContain('BEARISH_ENGULFING');
  });

  test('detects hammer and shooting star geometry', () => {
    const level = 110;
    const hammerBar = {
      o: level + 0.1,
      h: level + 0.3,
      l: level - 0.9,
      c: level + 0.25,
    };
    const starBar = {
      o: level - 0.1,
      h: level + 0.9,
      l: level - 0.3,
      c: level - 0.25,
    };

    expect(
      detectCandlePatterns(append(trend('up'), hammerBar)),
    ).toContain('HAMMER');
    expect(
      detectCandlePatterns(append(trend('down'), starBar)),
    ).toContain('SHOOTING_STAR');
  });

  test('a doji is reported but carries no direction', () => {
    const level = 110;
    const bars = append(trend('up'), {
      o: level,
      h: level + 0.5,
      l: level - 0.5,
      c: level,
    });

    const reading = evaluateCandlePatterns(withFormingBar(bars));
    expect(reading.patterns).toContain('DOJI');
    expect(reading.signal).toBeNull();
  });

  test('detects an inside-bar breakout only after the trigger closes', () => {
    const level = 110;
    const closed = trend('up');
    const mother = { o: level, h: level + 0.6, l: level - 0.6, c: level + 0.1 };
    const inside = {
      o: level + 0.1,
      h: level + 0.4,
      l: level - 0.3,
      c: level + 0.2,
    };
    const trigger = {
      o: level + 0.1,
      h: level + 0.85,
      l: level + 0.05,
      c: level + 0.8,
    };
    const bars = append(append(append(closed, mother), inside), trigger);

    expect(detectCandlePatterns(bars)).toContain(
      'BULLISH_INSIDE_BREAKOUT',
    );
  });
});

describe('candle pattern strategy', () => {
  test('buys a bullish engulfing aligned with an uptrend', () => {
    const closed = trend('up');
    const top = closed.at(-1)!.c;
    const bars = forming(
      append(
        append(closed, {
          o: top + 0.5,
          h: top + 0.6,
          l: top + 0.1,
          c: top + 0.1,
        }),
        { o: top, h: top + 0.7, l: top - 0.1, c: top + 0.6 },
      ),
      { o: top, h: top, l: top, c: top },
    );

    const reading = evaluateCandlePatterns(bars, config());
    expect(reading.ready).toBe(true);
    expect(reading.trend).toBe('UP');
    expect(reading.signal).toBe('BUY');
    expect(reading.patterns).toContain('BULLISH_ENGULFING');
    expect(reading.stopDistance).toBeGreaterThan(0);
    expect(reading.takeProfitDistance).toBe(
      reading.stopDistance! * defaultCandlePatternsConfig.rewardRisk,
    );
  });

  test('sells a bearish engulfing aligned with a downtrend', () => {
    const closed = trend('down');
    const bottom = closed.at(-1)!.c;
    const bars = append(
      append(closed, {
        o: bottom - 0.5,
        h: bottom - 0.1,
        l: bottom - 0.6,
        c: bottom - 0.1,
      }),
      { o: bottom - 0.05, h: bottom, l: bottom - 0.7, c: bottom - 0.65 },
    );

    const reading = evaluateCandlePatterns(withFormingBar(bars), config());
    expect(reading.trend).toBe('DOWN');
    expect(reading.signal).toBe('SELL');
    expect(reading.patterns).toContain('BEARISH_ENGULFING');
  });

  test('rejects a countertrend pattern under trend alignment', () => {
    const closed = trend('down');
    const bottom = closed.at(-1)!.c;
    const bars = append(
      append(closed, {
        o: bottom + 0.5,
        h: bottom + 0.6,
        l: bottom + 0.1,
        c: bottom + 0.1,
      }),
      { o: bottom, h: bottom + 0.7, l: bottom - 0.1, c: bottom + 0.6 },
    );

    const reading = evaluateCandlePatterns(withFormingBar(bars), config());
    expect(reading.signal).toBeNull();
    expect(reading.reason).toContain('alinhamento trend');
  });

  test('never reads the forming candle', () => {
    const closed = trend('up');
    const level = closed.at(-1)!.c;
    const plain = {
      o: level,
      h: level + 0.35,
      l: level - 0.05,
      c: level + 0.3,
    };
    const withPlainClosed = append(closed, plain);
    const bars = forming(withPlainClosed, {
      o: level,
      h: level + 0.3,
      l: level - 0.9,
      c: level + 0.25,
    });

    const reading = evaluateCandlePatterns(bars, config());
    expect(reading.patterns).not.toContain('HAMMER');
    expect(reading.signal).toBeNull();
  });

  test('ignores a forming candle that would complete the pattern', () => {
    const closed = trend('up');
    const top = closed.at(-1)!.c;
    const withEngulfing = append(
      append(closed, {
        o: top + 0.5,
        h: top + 0.6,
        l: top + 0.1,
        c: top + 0.1,
      }),
      { o: top, h: top + 0.7, l: top - 0.1, c: top + 0.6 },
    );
    const bars = forming(withEngulfing, {
      o: top + 0.6,
      h: top + 0.7,
      l: top - 0.5,
      c: top - 0.4,
    });

    expect(evaluateCandlePatterns(bars, config()).signal).toBe('BUY');
  });

  test('respects enableShort', () => {
    const closed = trend('down');
    const bottom = closed.at(-1)!.c;
    const bars = append(
      append(closed, {
        o: bottom - 0.5,
        h: bottom - 0.1,
        l: bottom - 0.6,
        c: bottom - 0.1,
      }),
      { o: bottom - 0.05, h: bottom, l: bottom - 0.7, c: bottom - 0.65 },
    );

    const reading = evaluateCandlePatterns(
      withFormingBar(bars),
      config({ enableShort: false }),
    );
    expect(reading.signal).toBeNull();
    expect(reading.reason).toContain('Venda desabilitada');
  });

  test('reversal alignment expects the opposite trend', () => {
    const closed = trend('up');
    const top = closed.at(-1)!.c;
    const bars = append(
      append(closed, {
        o: top + 0.5,
        h: top + 0.6,
        l: top + 0.1,
        c: top + 0.1,
      }),
      { o: top, h: top + 0.7, l: top - 0.1, c: top + 0.6 },
    );

    const closedBars = withFormingBar(bars);
    const trendAligned = evaluateCandlePatterns(closedBars, config());
    expect(trendAligned.signal).toBe('BUY');
    expect(
      evaluateCandlePatterns(closedBars, config({ alignment: 'reversal' }))
        .signal,
    ).toBeNull();
    expect(
      evaluateCandlePatterns(closedBars, config({ alignment: 'none' })).signal,
    ).toBe('BUY');
  });

  test('rejects an invalid configuration', () => {
    expect(() => config({ fastSma: 60, slowSma: 20 })).toThrow(
      'fastSma must be lower than slowSma',
    );
  });
});
