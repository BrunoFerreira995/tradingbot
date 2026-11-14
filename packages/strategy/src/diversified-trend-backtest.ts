import type { Rate, Side } from '@trade/shared';
import { evaluateDiversifiedTrend, trendAllocationWeight, type DiversifiedTrendConfig, type DiversifiedTrendReading } from './diversified-trend';

/** UTC Sunday sessions are merged into Monday; this is a research calendar,
 * not a reconstruction of the broker's timezone-specific daily candles. */
export function normalizeForexDailyRates(input: readonly Rate[]): Rate[] {
  const result = new Map<number, Rate>();
  for (const b of input) {
    if (![b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) || b.l <= 0 || b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c)) throw new Error('Invalid daily candle');
    const day = new Date(b.t * 1000).getUTCDay();
    if (day === 6) { if (b.h !== b.l) throw new Error('Unexpected non-flat Saturday candle'); continue; }
    const t = day === 0 ? b.t + 86400 : b.t;
    const previous = result.get(t);
    if (previous) result.set(t, { ...previous, h: Math.max(previous.h, b.h), l: Math.min(previous.l, b.l), c: b.c, v: previous.v + b.v });
    else result.set(t, { ...b, t });
  }
  return [...result.values()].sort((a, b) => a.t - b.t);
}

export interface PreparedTrendMarket {
  symbols: string[];
  times: number[];
  bars: Record<string, Rate[]>;
  readings: Record<string, DiversifiedTrendReading[]>;
}
export function prepareTrendMarket(input: Record<string, Rate[]>, config: DiversifiedTrendConfig): PreparedTrendMarket {
  const symbols = Object.keys(input).sort();
  if (!symbols.length) throw new Error('No market data');
  const timeSets = Object.fromEntries(symbols.map((s) => [s, new Set(input[s]!.map((b) => b.t))]));
  const common = input[symbols[0]!]!.map((b) => b.t).filter((t) => symbols.every((s) => timeSets[s]!.has(t)));
  const bars: Record<string, Rate[]> = {}, readings: Record<string, DiversifiedTrendReading[]> = {};
  for (const symbol of symbols) {
    const byTime = new Map(input[symbol]!.map((b) => [b.t, b]));
    bars[symbol] = common.map((t) => byTime.get(t)!);
    if (bars[symbol]!.some((b, i) => i > 0 && b.t <= bars[symbol]![i - 1]!.t)) throw new Error('Unordered daily history');
    readings[symbol] = bars[symbol]!.map((_, i) => evaluateDiversifiedTrend(bars[symbol]!.slice(Math.max(0, i - 303), i + 1), config));
  }
  return { symbols, times: common, bars, readings };
}

export interface TrendBacktestOptions {
  from: number; to: number; initialCapital: number;
  spreads: Record<string, number>;
  spreadMultiplier: number; slippageFraction: number;
  commissionPerLotRoundTrip: number;
  /** Negative financing stress in annual % of gross USD notional, charged per elapsed calendar day. */
  annualFinancingDrag: number;
}
type Holding = { symbol: string; side: Side; entry: number; stop: number; target: number; units: number; entryFee: number; entryTime: number; financing: number };
export function backtestDiversifiedTrend(market: PreparedTrendMarket, config: DiversifiedTrendConfig, options: TrendBacktestOptions) {
  if (!Number.isFinite(options.initialCapital) || options.initialCapital <= 0 || options.to <= options.from ||
    [options.spreadMultiplier, options.slippageFraction, options.commissionPerLotRoundTrip, options.annualFinancingDrag].some((v) => !Number.isFinite(v) || v < 0) ||
    market.symbols.some((s) => !Number.isFinite(options.spreads[s]) || options.spreads[s]! < 0)) throw new Error('Invalid portfolio options');
  const holdings = new Map<string, Holding>();
  const trades: Array<{ symbol: string; side: Side; pnl: number; from: number; to: number; reason: string }> = [];
  const curve: Array<{ t: number; equity: number }> = [];
  let cash = options.initialCapital, peak = cash, maxDrawdown = 0, maxDrawdownUsd = 0, totalFees = 0, totalFinancing = 0, skippedMinimumLot = 0;
  const usdBase = (s: string) => s.startsWith('USD');
  const gross = (p: Holding, price: number) => p.units * (usdBase(p.symbol) ? 1 : price);
  const pnl = (p: Holding, price: number) => (price - p.entry) * (p.side === 'BUY' ? 1 : -1) * p.units / (usdBase(p.symbol) ? price : 1);
  const spread = (s: string) => options.spreads[s]! * options.spreadMultiplier;
  const slip = (s: string) => options.spreads[s]! * options.slippageFraction;
  const close = (p: Holding, price: number, t: number, reason: string) => {
    const fee = p.units / 100000 * options.commissionPerLotRoundTrip / 2;
    const value = pnl(p, price);
    cash += value - fee; totalFees += fee;
    trades.push({ symbol: p.symbol, side: p.side, pnl: value - fee - p.entryFee - p.financing, from: p.entryTime, to: t, reason });
    holdings.delete(p.symbol);
  };
  const indices = market.times.flatMap((t, i) => t >= options.from && t < options.to && i > 0 ? [i] : []);
  if (!indices.length) throw new Error('No evaluation bars');
  let previousTime = market.times[indices[0]!]!;
  for (const i of indices) {
    const t = market.times[i]!;
    const elapsed = (t - previousTime) / 86400;
    // Financing charged only for positions carried into the current day.
    for (const p of holdings.values()) {
      const cost = gross(p, market.bars[p.symbol]![i - 1]!.c) * options.annualFinancingDrag * elapsed / 365.25;
      cash -= cost; p.financing += cost; totalFinancing += cost;
    }
    previousTime = t;
    // Exits at open before entries, so cash/available leverage is shared across legs.
    for (const p of [...holdings.values()]) {
      const b = market.bars[p.symbol]![i]!, reading = market.readings[p.symbol]![i]!;
      const open = b.o + (p.side === 'BUY' ? 0 : spread(p.symbol));
      const sign = p.side === 'BUY' ? 1 : -1;
      if ((open - p.stop) * sign <= 0) close(p, open - sign * slip(p.symbol), t, 'GAP_SL');
      else if ((open - p.target) * sign >= 0) close(p, p.target, t, 'GAP_TP');
      else if (reading.ready && reading.side !== p.side) close(p, open - sign * slip(p.symbol), t, 'SIGNAL');
    }
    let openingEquity = cash;
    for (const p of holdings.values()) openingEquity += pnl(p, market.bars[p.symbol]![i]!.o + (p.side === 'BUY' ? 0 : spread(p.symbol)));
    for (const symbol of market.symbols) {
      if (holdings.has(symbol)) continue;
      const b = market.bars[symbol]![i]!, r = market.readings[symbol]![i]!;
      if (!r.ready || !r.side || openingEquity <= 0 || spread(symbol) > r.atr! * 0.05) continue;
      const sign = r.side === 'BUY' ? 1 : -1;
      const entry = b.o + (r.side === 'BUY' ? spread(symbol) + slip(symbol) : -slip(symbol));
      const usedGross = [...holdings.values()].reduce((n, p) => n + gross(p, market.bars[p.symbol]![i]!.o), 0);
      const notional = Math.min(openingEquity * trendAllocationWeight(r.annualVolatility!, market.symbols.length, config),
        Math.max(0, openingEquity * config.maximumGrossLeverage - usedGross));
      const perLot = 100000 * (usdBase(symbol) ? 1 : entry);
      const lots = Math.floor(notional / perLot / 0.01 + 1e-10) * 0.01;
      if (lots < 0.01) { skippedMinimumLot++; continue; }
      const fee = lots * options.commissionPerLotRoundTrip / 2;
      cash -= fee; totalFees += fee;
      holdings.set(symbol, { symbol, side: r.side, entry, units: lots * 100000, entryFee: fee, entryTime: t, financing: 0,
        stop: entry - sign * r.atr! * config.stopAtr, target: entry + sign * r.atr! * config.stopAtr * config.rewardRisk });
    }
    for (const p of [...holdings.values()]) {
      const b = market.bars[p.symbol]![i]!, sign = p.side === 'BUY' ? 1 : -1;
      const low = b.l + (p.side === 'BUY' ? 0 : spread(p.symbol));
      const high = b.h + (p.side === 'BUY' ? 0 : spread(p.symbol));
      if (p.side === 'BUY' ? low <= p.stop : high >= p.stop)
        close(p, (p.side === 'BUY' ? Math.min(b.o, p.stop) : Math.max(b.o + spread(p.symbol), p.stop)) - sign * slip(p.symbol), t, 'SL');
      else if (p.side === 'BUY' ? high >= p.target : low <= p.target) close(p, p.target, t, 'TP');
    }
    if (i === indices.at(-1)) {
      for (const p of [...holdings.values()]) {
        const b = market.bars[p.symbol]![i]!;
        close(p, b.c + (p.side === 'BUY' ? -slip(p.symbol) : spread(p.symbol) + slip(p.symbol)), t, 'END');
      }
    }
    const equity = cash + [...holdings.values()].reduce((n, p) => n + pnl(p, market.bars[p.symbol]![i]!.c + (p.side === 'BUY' ? 0 : spread(p.symbol))), 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - equity);
    curve.push({ t, equity });
    if (equity <= 0) throw new Error('Portfolio exhausted');
  }
  const dailyReturns = curve.map((p, i) => p.equity / (i ? curve[i - 1]!.equity : options.initialCapital) - 1);
  const mean = dailyReturns.reduce((n, r) => n + r, 0) / dailyReturns.length;
  const stdev = Math.sqrt(dailyReturns.reduce((n, r) => n + (r - mean) ** 2, 0) / Math.max(1, dailyReturns.length - 1));
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const sum = (ts: typeof trades) => ts.reduce((n, t) => n + t.pnl, 0);
  if (Math.abs(sum(trades) - (cash - options.initialCapital)) > 1e-6) throw new Error('Cash/trade reconciliation failed');
  const years = (options.to - options.from) / (365.25 * 86400);
  return { netUsd: cash - options.initialCapital, finalEquity: cash, totalReturn: cash / options.initialCapital - 1,
    cagr: (cash / options.initialCapital) ** (1 / years) - 1, sharpe: stdev > 0 ? mean / stdev * Math.sqrt(252) : 0,
    maxDrawdown, maxDrawdownUsd, tradeCount: trades.length, winRate: trades.length ? wins.length / trades.length : null,
    profitFactor: losses.length ? sum(wins) / -sum(losses) : null, totalFees, totalFinancing, skippedMinimumLot,
    bySymbol: Object.fromEntries(market.symbols.map((s) => [s, sum(trades.filter((t) => t.symbol === s))])),
    trades, curve };
}
