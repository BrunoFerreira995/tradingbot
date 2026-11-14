import type { Rate } from '@trade/shared';

export interface PriceGeometry {
  /** Least-squares slope, ATR per candle. */
  slope: number;
  efficiency: number;
  /** Signed determinant of normalized early/recent displacement vectors.
   * Equals sine of the turning angle, bounded by [-1, 1]. */
  determinant: number;
}

/** Closed bars only, oldest first. Scale independent; translation invariant. */
export function priceGeometry(closed: readonly Rate[], lookback: number, volatility: number): PriceGeometry | null {
  if (!Number.isInteger(lookback) || lookback < 4 || closed.length < lookback || !Number.isFinite(volatility) || volatility <= 0) return null;
  const bars = closed.slice(-lookback);
  if (bars.some((b) => !Number.isFinite(b.c))) return null;
  const origin = bars[0]!.c;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, path = 0;
  for (let i = 0; i < bars.length; i++) {
    const y = (bars[i]!.c - origin) / volatility;
    sx += i; sy += y; sxx += i * i; sxy += i * y;
    if (i) path += Math.abs(bars[i]!.c - bars[i - 1]!.c);
  }
  const n = bars.length;
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const middle = Math.floor((n - 1) / 2);
  const early = (bars[middle]!.c - origin) / (middle * volatility);
  const recent = (bars[n - 1]!.c - bars[middle]!.c) / ((n - 1 - middle) * volatility);
  const determinant = (recent - early) / (Math.hypot(1, early) * Math.hypot(1, recent));
  return { slope, determinant,
    efficiency: path > 0 ? Math.abs(bars[n - 1]!.c - origin) / path : 0 };
}
