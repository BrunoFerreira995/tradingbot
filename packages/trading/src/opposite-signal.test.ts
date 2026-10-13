import { expect, test } from 'bun:test';
import type { Position, TradingSignal } from '@trade/shared';
import { resolveOppositeSignal } from './opposite-signal';
const signal: TradingSignal = {
  strategy: 'meanrev-bb-rsi-v1',
  signalId: 'opposite',
  symbol: 'BTCUSD',
  action: 'SELL',
  orderType: 'MARKET',
  lots: 0.01,
};
const position: Position = {
  id: '1',
  symbol: 'BTCUSD',
  side: 'BUY',
  lots: 0.01,
  entryPrice: 100,
  currentPrice: 101,
  unrealizedPnl: 1,
  openedAt: new Date().toISOString(),
};
test('SELL closes longs and BUY closes shorts without modifying original signal', () => {
  expect(resolveOppositeSignal(signal, [position], true).action).toBe(
    'CLOSE_LONG',
  );
  expect(
    resolveOppositeSignal(
      { ...signal, action: 'BUY' },
      [{ ...position, side: 'SELL' }],
      true,
    ).action,
  ).toBe('CLOSE_SHORT');
  expect(signal.action).toBe('SELL');
});
test('same-side, other-symbol, empty and disabled cases retain entry behavior', () => {
  for (const positions of [
    [],
    [{ ...position, side: 'SELL' as const }],
    [{ ...position, symbol: 'EURUSD' }],
  ])
    expect(resolveOppositeSignal(signal, positions, true)).toBe(signal);
  expect(resolveOppositeSignal(signal, [position], false)).toBe(signal);
});
test('explicit CLOSE actions remain unchanged', () => {
  const close = { ...signal, action: 'CLOSE' as const };
  expect(resolveOppositeSignal(close, [position], true)).toBe(close);
});
