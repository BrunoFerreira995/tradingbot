import type { TradingSignal } from '@trade/shared';

export function invertEntrySignal(signal: TradingSignal): TradingSignal {
  if (signal.action === 'BUY') return { ...signal, action: 'SELL' };
  if (signal.action === 'SELL') return { ...signal, action: 'BUY' };
  return signal;
}
