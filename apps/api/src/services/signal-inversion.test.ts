import { describe, expect, test } from 'bun:test';
import type { TradingSignal } from '@trade/shared';
import { invertEntrySignal } from './signal-inversion';

const signal: TradingSignal = {
  strategy: 'test',
  signalId: 'signal-1',
  symbol: 'XAUUSD',
  action: 'BUY',
  orderType: 'MARKET',
  lots: 0.01,
  stopLoss: 25,
  takeProfit: 50,
};

describe('signal inversion', () => {
  test('swaps BUY and SELL while keeping the rest of the signal intact', () => {
    expect(invertEntrySignal(signal)).toEqual({ ...signal, action: 'SELL' });
    expect(invertEntrySignal({ ...signal, action: 'SELL' })).toEqual(signal);
    expect(invertEntrySignal(signal).stopLoss).toBe(25);
    expect(invertEntrySignal(signal).takeProfit).toBe(50);
  });
  test('leaves closing signals unchanged', () => {
    for (const action of ['CLOSE', 'CLOSE_LONG', 'CLOSE_SHORT'] as const)
      expect(invertEntrySignal({ ...signal, action })).toEqual({
        ...signal,
        action,
      });
  });
});
