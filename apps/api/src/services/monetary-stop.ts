import type { MarketPrice, Position, SymbolInfo } from '@trade/shared';

/** Cap total loss from entry; never loosen an existing, more protective SL. */
export function monetaryStopAction(
  position: Position,
  symbol: SymbolInfo,
  price: MarketPrice,
  amount: number,
): number | 'keep' | 'close' {
  const tickValue = symbol.tickValueLoss ?? symbol.tickValue;
  if (
    ![amount, tickValue, symbol.tickSize, position.lots].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error('Invalid monetary stop calculation inputs');
  const buy = position.side === 'BUY';
  const target =
    position.entryPrice +
    ((buy ? -1 : 1) * amount * symbol.tickSize) / (tickValue * position.lots);
  // Align inward on the price grid, so rounding cannot increase risk.
  const stop =
    (buy
      ? Math.ceil(target / symbol.tickSize - 1e-10)
      : Math.floor(target / symbol.tickSize + 1e-10)) * symbol.tickSize;
  if (
    position.stopLoss &&
    (buy ? position.stopLoss >= stop : position.stopLoss <= stop)
  )
    return 'keep';
  const distance = buy ? price.bid - stop : stop - price.ask;
  if (
    distance <= 0 ||
    distance + 1e-12 < symbol.stopsLevel ||
    (position.grossPnl != null && position.grossPnl <= -amount)
  )
    return 'close';
  return stop;
}
