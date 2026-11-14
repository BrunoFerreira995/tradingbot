import type { Rate } from '@trade/shared';
import { atr, evaluateMarketForces } from '../packages/strategy/src';
import { priceGeometry } from '../packages/strategy/src/price-geometry';

const root = new URL('./', import.meta.url);
const raw = await Bun.file(new URL('gbpusd-h1-bid-2016-2025.json', root)).json();
const bars: Rate[] = raw.map((b: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }) =>
  ({ t: b.timestamp / 1000, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
const rows = [];
for (let i = 42; i < bars.length - 1; i++) {
  const previous = bars[i - 1]!, last = bars[i]!, before = bars[i - 2]!;
  // ATR ends before the shock candle so that the shock does not inflate its denominator.
  const history = bars.slice(Math.max(0, i - 119), i);
  const volatility = atr(history, 14).at(-1);
  const geometry = volatility ? priceGeometry(history, 16, volatility) : null;
  if (!volatility || !geometry) continue;
  const direction = geometry.slope > 0 ? 1 : geometry.slope < 0 ? -1 : 0;
  const velocityBefore = (previous.c - before.c) / volatility;
  const velocityNow = (last.c - previous.c) / volatility;
  const acceleration = velocityNow - velocityBefore;
  // A reversal against the preceding 16-bar slope, with at least 0.03 ATR/bar trend.
  const opposing = direction !== 0 && velocityNow * direction < 0 && Math.abs(geometry.slope) >= 0.03;
  const range = last.h - last.l;
  const opposingBody = range > 0 ? Math.max(0, -direction * (last.c - last.o) / range) : 0;
  const rejection = range > 0 ? (direction > 0 ? last.h - Math.max(last.o, last.c) : Math.min(last.o, last.c) - last.l) / range : 0;
  const magnitude = opposing ? Math.max(0, -direction * acceleration) : 0;
  const shock = magnitude * (0.5 + 0.5 * opposingBody);
  // Final synthetic closure marker contributes no prices to evaluateMarketForces.
  const forces = evaluateMarketForces([...history, last, { ...last, t: last.t + 1 }]);
  rows.push({ t: last.t, at: new Date(last.t * 1000).toISOString(), precedingDirection: direction > 0 ? 'UP' : direction < 0 ? 'DOWN' : 'NEUTRAL',
    shock, magnitudeAtr: magnitude, opposingBody, rejection, velocityBefore, velocityNow,
    determinantBefore: geometry.determinant, strategyActionAfter: forces.action,
    // Forward measurements are outcomes only, never part of the score.
    forward6Atr: i + 6 < bars.length - 1 ? (bars[i + 6]!.c - last.c) * direction / volatility : null });
}
const sorted = rows.map((r) => r.shock).toSorted((a, b) => a - b);
const quantile = (p: number) => sorted[Math.floor((sorted.length - 1) * p)]!;
const buckets = [[0, 0.5], [0.5, 1], [1, 2], [2, Infinity]].map(([low, high]) => {
  const subset = rows.filter((r) => r.shock >= low! && r.shock < high!);
  const outcomes = subset.filter((r) => r.forward6Atr !== null);
  return { range: `${low}–${high}`, candles: subset.length,
    opposingShocks: subset.filter((r) => r.shock > 0).length,
    meanForward6AtrInPriorDirection: outcomes.length ? outcomes.reduce((n, r) => n + r.forward6Atr!, 0) / outcomes.length : null };
});
const report = { symbol: 'GBPUSD', timeframe: 'H1', period: '2016–2025',
  formula: 'shock = max(0, -priorDirection * (velocityNow - velocityBefore)) * (0.5 + 0.5 * opposingBody), only if price moves against prior 16-bar regression slope >=0.03 ATR/bar; velocities normalized by prior ATR(14)',
  assumptions: ['Descriptive OHLC proxy, not order flow, probability or executable signal.',
    'Thresholds 0.5/1/2 are illustrative, not calibrated; quantiles computed retrospectively on full dataset.',
    'Gaps included; shocks may reflect news/weekend repricing. Forward outcomes overlap and are not trade P&L.',
    'No strategy execution/settings changed. Determinant is a separate turning-angle descriptor, not shock magnitude.'],
  evaluatedCandles: rows.length, positiveShocks: rows.filter((r) => r.shock > 0).length,
  quantiles: { median: quantile(0.5), p90: quantile(0.9), p95: quantile(0.95), p99: quantile(0.99) },
  buckets, latest: rows.at(-1), strongest: rows.toSorted((a, b) => b.shock - a.shock).slice(0, 20) };
await Bun.write(new URL('force-shock-gbpusd-h1-2016-2025.json', root), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ evaluatedCandles: report.evaluatedCandles, positiveShocks: report.positiveShocks,
  quantiles: report.quantiles, buckets, latest: report.latest, strongest: report.strongest.slice(0, 3) }, null, 2));
