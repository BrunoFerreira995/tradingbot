import type { Rate, Side } from '@trade/shared';
import { atrTrailingStop, evaluateSmaMicroTrend, macroTrendAt, type SmaMicroTrendConfig } from './sma-micro-trend';

export interface SmaBacktestOptions {
  initialCapital: number;
  spread: number;
  slippage: number;
  commissionPerUnit: number;
  units: number;
}
export interface SmaBacktestTrade {
  side: Side;
  entryTime: number;
  exitTime: number | null;
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number | null;
  pnl: number | null;
  costs: number;
}

/** Signals use bar i-1 close and fill at bar i open. Stops are checked against
 * bar i OHLC before its close is allowed to update trailing levels. Gap fills
 * use the worse of stop and open; a stop wins over an opposite signal. */
export function backtestSmaMicroTrend(bars: readonly Rate[], config: SmaMicroTrendConfig, options: SmaBacktestOptions, macroBars?: readonly Rate[]) {
  if (bars.length < 3 || Object.values(options).some((n) => !Number.isFinite(n)) || options.initialCapital <= 0 || options.units <= 0 || options.spread < 0 || options.slippage < 0 || options.commissionPerUnit < 0)
    throw new Error('Invalid backtest input');
  if (config.filters.requireMacroTrendAlignment && !macroBars)
    throw new Error('Macro bars required when trend alignment is enabled');
  const trades: SmaBacktestTrade[] = [];
  const equityCurve: Array<{ t: number; equity: number }> = [];
  let cash = options.initialCapital;
  let open: SmaBacktestTrade | null = null;
  let peak = cash, maxDrawdown = 0, costs = 0;
  const half = options.spread / 2 + options.slippage;
  const entry = (side: Side, bar: Rate, atr: number) => {
    const price = bar.o + (side === 'BUY' ? half : -half);
    const fee = options.commissionPerUnit * options.units;
    cash -= fee; costs += fee;
    open = { side, entryTime: bar.t, exitTime: null, entryPrice: price, exitPrice: null,
      stopLoss: config.risk.useATRStop ? price + (side === 'BUY' ? -1 : 1) * atr * config.risk.atrStopMultiplier : null,
      pnl: null, costs: fee };
  };
  const exit = (bar: Rate, price: number) => {
    if (!open) return;
    const trade = open as SmaBacktestTrade;
    const fee = options.commissionPerUnit * options.units;
    const pnl = (price - trade.entryPrice) * (trade.side === 'BUY' ? 1 : -1) * options.units - fee - trade.costs;
    cash += pnl + trade.costs;
    costs += fee;
    trades.push({ ...trade, exitTime: bar.t, exitPrice: price, pnl, costs: trade.costs + fee });
    open = null;
  };
  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i]!;
    const reading = evaluateSmaMicroTrend(bars.slice(0, i + 1), config);
    const macroTrend = macroBars ? macroTrendAt(macroBars, bar.t, config) : 'NOT_READY';
    const alignedSignal = reading.signal && (
      !config.filters.requireMacroTrendAlignment ||
      (reading.signal === 'BUY' && macroTrend === 'UP') ||
      (reading.signal === 'SELL' && macroTrend === 'DOWN')
    ) ? reading.signal : null;
    let position = open as SmaBacktestTrade | null;
    if (reading.trend !== 'NOT_READY') {
      if (position && ((alignedSignal && alignedSignal !== position.side && config.operations.reverseOnOppositeSignal) || (config.operations.closeOnNeutralTrend && reading.neutral))) {
        exit(bar, bar.o + (position.side === 'BUY' ? -half : half));
        position = null;
      }
      if (!position && alignedSignal && reading.atr && cash > 0 && options.spread <= reading.atr * 1.5 && (!config.risk.useATRStop || config.risk.atrStopMultiplier >= 0.5)) {
        entry(alignedSignal, bar, reading.atr);
        position = open as SmaBacktestTrade | null;
      }
    }
    if (position && config.risk.useATRTrailingStop && reading.atr && reading.close !== null && position.stopLoss !== null)
      position.stopLoss = atrTrailingStop(position.side, position.stopLoss, reading.close, reading.atr, config.risk.atrTrailingMultiplier);
    if (position && position.stopLoss !== null) {
      const hit = position.side === 'BUY' ? bar.l <= position.stopLoss : bar.h >= position.stopLoss;
      if (hit) {
        const raw = position.side === 'BUY' ? Math.min(bar.o, position.stopLoss) : Math.max(bar.o, position.stopLoss);
        exit(bar, raw + (position.side === 'BUY' ? -half : half));
        position = null;
      }
    }
    const marked = cash + (position ? (bar.c - position.entryPrice) * (position.side === 'BUY' ? 1 : -1) * options.units : 0);
    peak = Math.max(peak, marked);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - marked) / peak : 0);
    equityCurve.push({ t: bar.t, equity: marked });
  }
  const wins = trades.filter((t) => t.pnl! > 0);
  const losses = trades.filter((t) => t.pnl! < 0);
  const sum = (items: SmaBacktestTrade[]) => items.reduce((n, t) => n + t.pnl!, 0);
  const pnl = sum(trades);
  const returns = equityCurve.slice(1).map((p, i) => p.equity / equityCurve[i]!.equity - 1).filter(Number.isFinite);
  const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return { trades, openTrade: open, equityCurve, metrics: {
    totalReturn: (equityCurve.at(-1)!.equity / options.initialCapital - 1), netPnl: pnl,
    winRate: trades.length ? wins.length / trades.length : null,
    profitFactor: losses.length ? sum(wins) / -sum(losses) : null,
    maxDrawdown, sharpePerBar: returns.length > 1 && variance > 0 ? mean / Math.sqrt(variance) : null,
    tradeCount: trades.length, averageWin: wins.length ? sum(wins) / wins.length : null,
    averageLoss: losses.length ? sum(losses) / losses.length : null,
    expectancy: trades.length ? pnl / trades.length : null, totalCosts: costs,
  } };
}
