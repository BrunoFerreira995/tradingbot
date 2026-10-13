import type { Position, TradingSignal } from '@trade/shared';

/** An opposite entry signal becomes a close of that symbol's opposite side. */
export function resolveOppositeSignal(
  signal: TradingSignal,
  positions: Position[],
  enabled: boolean,
): TradingSignal {
  if (!enabled || (signal.action !== 'BUY' && signal.action !== 'SELL'))
    return signal;
  if (
    !positions.some(
      (position) =>
        position.symbol === signal.symbol && position.side !== signal.action,
    )
  )
    return signal;
  return {
    ...signal,
    action: signal.action === 'BUY' ? 'CLOSE_SHORT' : 'CLOSE_LONG',
  };
}
