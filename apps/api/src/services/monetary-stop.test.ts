import { describe, expect, test } from 'bun:test';
import type { MarketPrice, Position, SymbolInfo } from '@trade/shared';
import { monetaryStopAction } from './monetary-stop';

const symbol = {
  tickSize: 0.01,
  tickValueLoss: 1,
  tickValue: 2,
  stopsLevel: 0.01,
} as SymbolInfo;
const position = { entryPrice: 100, lots: 0.01, side: 'BUY' } as Position;
const quote = { bid: 100, ask: 100.02 } as MarketPrice;
describe('monetary stops on open positions', () => {
  test('caps risk from entry, rounded inward using loss tick value', () => {
    expect(monetaryStopAction(position, symbol, quote, 0.269)).toBeCloseTo(
      99.74,
    );
    expect(
      monetaryStopAction({ ...position, side: 'SELL' }, symbol, quote, 0.269),
    ).toBeCloseTo(100.26);
  });
  test('preserves tighter stops on both sides', () => {
    expect(
      monetaryStopAction(
        { ...position, stopLoss: 100.1 },
        symbol,
        quote,
        0.269,
      ),
    ).toBe('keep');
    expect(
      monetaryStopAction(
        { ...position, side: 'SELL', stopLoss: 99.9 },
        symbol,
        quote,
        0.269,
      ),
    ).toBe('keep');
  });
  test('closes when the market passed the cap or broker minimum prevents protection', () => {
    expect(
      monetaryStopAction(position, symbol, { ...quote, bid: 99.7 }, 0.269),
    ).toBe('close');
    expect(
      monetaryStopAction(
        position,
        { ...symbol, stopsLevel: 0.3 },
        quote,
        0.269,
      ),
    ).toBe('close');
    expect(
      monetaryStopAction(
        { ...position, grossPnl: -0.27 },
        symbol,
        quote,
        0.269,
      ),
    ).toBe('close');
  });
  test('refuses invalid contract data', () => {
    expect(() =>
      monetaryStopAction(
        position,
        { ...symbol, tickValueLoss: 0 },
        quote,
        0.269,
      ),
    ).toThrow();
  });
});
