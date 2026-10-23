import { expect, test } from 'bun:test';
import {
  initialRiskAmount,
  tradeExcursionPoint,
  sampledExcursions,
  type TradeContext,
} from './trade-telemetry';
import type { Position } from '@trade/shared';
const context: TradeContext = {
  accountId: 'a',
  server: 's',
  entryPrice: 100,
  tickSize: 0.5,
  tickValue: 2,
  lots: 0.25,
};
const position: Position = {
  id: 'p',
  symbol: 'XAUUSD',
  side: 'BUY',
  lots: 0.25,
  entryPrice: 100,
  currentPrice: 104,
  unrealizedPnl: 0,
  openedAt: '',
};

test('samples excursions in account currency, preserves prior maxima and handles sell direction', () => {
  expect(sampledExcursions(context, position)).toEqual({
    maxFavorableExcursion: 4,
    maxAdverseExcursion: 0,
  });
  expect(
    sampledExcursions(
      { ...context, maxFavorableExcursion: 7 },
      { ...position, currentPrice: 97 },
    ),
  ).toEqual({ maxFavorableExcursion: 7, maxAdverseExcursion: 3 });
  expect(sampledExcursions(context, { ...position, side: 'SELL' })).toEqual({
    maxFavorableExcursion: 0,
    maxAdverseExcursion: 4,
  });
  expect(
    sampledExcursions({ ...context, tickValue: 0 }, position),
  ).toBeUndefined();
});

test('initial risk uses the fill, stop distance, lots and loss-side tick value', () => {
  const input = {
    side: 'BUY' as const,
    entryPrice: 101,
    stopLoss: 95,
    lots: 0.25,
    tickSize: 0.5,
    tickValue: 2,
    tickValueLoss: 3,
  };
  expect(initialRiskAmount(input)).toBe(9);
  expect(
    initialRiskAmount({
      ...input,
      side: 'SELL',
      entryPrice: 99,
      stopLoss: 105,
    }),
  ).toBe(9);
  expect(initialRiskAmount({ ...input, tickValueLoss: undefined })).toBe(6);
  expect(initialRiskAmount({ ...input, stopLoss: undefined })).toBeUndefined();
  expect(initialRiskAmount({ ...input, stopLoss: 0 })).toBeUndefined();
  expect(initialRiskAmount({ ...input, tickValueLoss: 0 })).toBeUndefined();
  expect(initialRiskAmount({ ...input, tickSize: 0 })).toBeUndefined();
  expect(initialRiskAmount({ ...input, entryPrice: NaN })).toBeUndefined();
  expect(initialRiskAmount({ ...input, stopLoss: 101 })).toBe(0);
});

test('uses terminal gross profit rather than entry tick estimates or swap-inclusive net PnL', () => {
  expect(
    sampledExcursions(context, { ...position, grossPnl: 12, unrealizedPnl: 8 }),
  ).toEqual({ maxFavorableExcursion: 12, maxAdverseExcursion: 0 });
  expect(
    sampledExcursions(
      { ...context, maxFavorableExcursion: 12, maxAdverseExcursion: 3 },
      { ...position, grossPnl: -10 },
    ),
  ).toEqual({ maxFavorableExcursion: 12, maxAdverseExcursion: 10 });
  expect(
    sampledExcursions(
      { ...context, tickValueLoss: 3 },
      { ...position, currentPrice: 98 },
    ),
  ).toEqual({ maxFavorableExcursion: 0, maxAdverseExcursion: 3 });
});

test('includes partial realized gross profit and confirms a final closing observation only for complete positions', () => {
  const entry = {
    id: 'entry',
    positionId: 'p',
    symbol: 'XAUUSD',
    type: 0,
    entry: 0,
    at: 1000,
    volume: 0.25,
    price: 100,
    profit: 0,
    commission: -2,
    swap: -1,
    fee: 0,
  };
  const partial = {
    ...entry,
    id: 'partial',
    type: 1,
    entry: 1,
    at: 1001,
    volume: 0.1,
    profit: 4,
  };
  const exit = { ...partial, id: 'exit', at: 1002, volume: 0.15, profit: 6 };
  const open = tradeExcursionPoint(
    context,
    { ...position, grossPnl: 6 },
    [entry, partial],
    true,
  );
  expect(open?.position.grossPnl).toBe(10);
  expect(open?.closedAt).toBeUndefined();
  expect(
    tradeExcursionPoint(context, undefined, [entry, partial], false),
  ).toBeUndefined();
  expect(
    tradeExcursionPoint(context, undefined, [entry, partial, exit], true),
  ).toBeUndefined();
  const closed = tradeExcursionPoint(
    context,
    undefined,
    [entry, partial, exit],
    false,
  );
  expect(closed?.position.grossPnl).toBe(10);
  expect(closed?.closedAt).toBe(new Date(1002 * 1000).toISOString());
  expect(
    tradeExcursionPoint(
      context,
      position,
      [entry, { ...partial, entry: 2 }],
      true,
    ),
  ).toBeUndefined();
});
