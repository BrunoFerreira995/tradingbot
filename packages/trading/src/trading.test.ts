import { describe, expect, test } from 'bun:test';
import { InMemoryBrokerAdapter } from '@trade/broker/testing';
import type {
  AccountInfo,
  MarketPrice,
  Position,
  SymbolInfo,
  TradingSignal,
} from '@trade/shared';
import { RiskManager, type RiskSettings } from './risk-manager';
import { OrderManager } from './order-manager';
import { PositionManager } from './position-manager';

const account: AccountInfo = {
  id: 'paper-account',
  balance: 10000,
  equity: 10000,
  freeMargin: 10000,
  usedMargin: 0,
  marginLevel: 0,
  currency: 'USD',
};
const symbol: SymbolInfo = {
  symbol: 'XAUUSD',
  minLot: 0.01,
  maxLot: 100,
  lotStep: 0.01,
  contractSize: 100,
  tickValue: 1,
  tickSize: 0.01,
  maxSpread: 1,
  maxSlippage: 0.2,
  defaultStopLoss: 25,
  defaultTakeProfit: 50,
  marginRate: 0.01,
  marketOpen: true,
  stopsLevel: 0.00001,
};
const price: MarketPrice = {
  symbol: 'XAUUSD',
  bid: 2649.85,
  ask: 2650.15,
  spread: 0.3,
  at: new Date().toISOString(),
};
const settings: RiskSettings = {
  autoTradingEnabled: true,
  emergencyStop: false,
  maximumLotSize: 0.01,
  minimumLotSize: 0.01,
  maximumOpenPositions: 1,
  maximumPositionsPerSymbol: 1,
  maximumDailyLoss: 100,
  maximumDailyTrades: 10,
  maximumExposure: 100000,
  maximumMarginUsagePercentage: 50,
  allowedSymbols: ['XAUUSD'],
  blockedSymbols: [],
  requireStopLoss: true,
  minimumStopDistance: 0.01,
  maximumStopDistance: 1000,
  positionPolicy: 'ONE_POSITION_PER_SYMBOL',
};
const signal: TradingSignal = {
  strategy: 'gold-scalping-v1',
  signalId: 'test-1',
  symbol: 'XAUUSD',
  action: 'BUY',
  orderType: 'MARKET',
  lots: 0.01,
  stopLoss: 25,
  takeProfit: 50,
};
const risk = new RiskManager();
const evaluate = (
  overrides: Partial<{
    signal: TradingSignal;
    settings: RiskSettings;
    positions: Position[];
    dailyPnl: number;
    dailyTrades: number;
  }> = {},
) =>
  risk.evaluate({
    signal,
    settings,
    account,
    symbol,
    price,
    positions: [],
    dailyPnl: 0,
    dailyTrades: 0,
    ...overrides,
  });

describe('risk gates', () => {
  test('approves BUY and SELL with absolute protective prices', () => {
    expect(evaluate().approved).toBe(true);
    expect(evaluate().stopLoss).toBeCloseTo(2625.15);
    const sell = evaluate({ signal: { ...signal, action: 'SELL' } });
    expect(sell.approved).toBe(true);
    expect(sell.stopLoss).toBeCloseTo(2674.85);
  });
  test('blocks lot over cap and disallowed symbol', () => {
    expect(evaluate({ signal: { ...signal, lots: 0.02 } }).reason).toContain(
      'Lot exceeds',
    );
    expect(
      evaluate({ settings: { ...settings, allowedSymbols: [] } }).reason,
    ).toContain('Symbol not allowed');
  });
  test('blocks missing stop, daily loss and position limit', () => {
    expect(
      evaluate({ signal: { ...signal, stopLoss: undefined } }).reason,
    ).toContain('Stop loss');
    expect(evaluate({ dailyPnl: -100 }).reason).toContain('Daily loss');
    const open: Position = {
      id: 'p1',
      symbol: 'XAUUSD',
      side: 'BUY',
      lots: 0.01,
      entryPrice: 2650,
      currentPrice: 2650,
      unrealizedPnl: 0,
      openedAt: new Date().toISOString(),
    };
    expect(evaluate({ positions: [open] }).reason).toContain(
      'Maximum open positions',
    );
  });
  test('blocks emergency stop and auto trading off', () => {
    expect(
      evaluate({ settings: { ...settings, emergencyStop: true } }).reason,
    ).toContain('Emergency');
    expect(
      evaluate({ settings: { ...settings, autoTradingEnabled: false } }).reason,
    ).toContain('Auto trading');
  });
  test('allows CLOSE without opening risk checks', () => {
    expect(
      evaluate({
        signal: {
          ...signal,
          action: 'CLOSE',
          lots: undefined,
          stopLoss: undefined,
        },
        dailyPnl: -200,
      }).approved,
    ).toBe(true);
  });

  test('does not confuse contract notional with terminal margin', () => {
    const decision = risk.evaluate({
      signal,
      settings,
      account: { ...account, equity: 167.32, freeMargin: 167.32 },
      symbol: { ...symbol, marginRate: 1 },
      price,
      positions: [],
      dailyPnl: 0,
      dailyTrades: 0,
    });
    expect(decision.approved).toBe(true);
    expect(risk.evaluateMarginUsage(8.37, 167.32, 50).approved).toBe(true);
    expect(risk.evaluateMarginUsage(100, 167.32, 50).reason).toContain(
      'Margin usage limit',
    );
  });

  test('rejects unusable terminal margin data', () => {
    for (const [margin, equity] of [
      [NaN, 100],
      [-1, 100],
      [1, 0],
      [1, Infinity],
    ])
      expect(risk.evaluateMarginUsage(margin!, equity!, 50).approved).toBe(
        false,
      );
  });
});

describe('in-memory broker execution', () => {
  test('fills once for duplicate clientOrderId and realizes P&L on close', async () => {
    const broker = new InMemoryBrokerAdapter();
    await broker.connect();
    const request = {
      clientOrderId: 'unique-1',
      symbol: 'XAUUSD',
      side: 'BUY' as const,
      lots: 0.01,
    };
    const first = await broker.placeMarketOrder(request);
    const duplicate = await broker.placeMarketOrder(request);
    expect(duplicate.brokerOrderId).toBe(first.brokerOrderId);
    expect((await broker.getPositions()).length).toBe(1);
    broker.setMarket(2700);
    await broker.closePosition(first.positionId!);
    expect((await broker.getAccount()).balance).toBeGreaterThan(10000);
  });
  test('rejects broker disconnection', async () => {
    const broker = new InMemoryBrokerAdapter();
    await expect(
      new OrderManager(broker).submit({
        clientOrderId: 'x',
        symbol: 'XAUUSD',
        side: 'BUY',
        lots: 0.01,
      }),
    ).rejects.toThrow('disconnected');
  });
  test('does not retry an ambiguous broker timeout', async () => {
    const broker = new InMemoryBrokerAdapter();
    await broker.connect();
    let calls = 0;
    broker.placeMarketOrder = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      throw new Error('late');
    };
    await expect(
      new OrderManager(broker, 5).submit({
        clientOrderId: 'timeout',
        symbol: 'XAUUSD',
        side: 'BUY',
        lots: 0.01,
      }),
    ).rejects.toThrow('reconcile');
    expect(calls).toBe(1);
  });
  test('passes broker rejection through without a second order', async () => {
    const broker = new InMemoryBrokerAdapter();
    await broker.connect();
    let calls = 0;
    broker.placeMarketOrder = async () => {
      calls++;
      return {
        brokerOrderId: 'rejected',
        status: 'REJECTED',
        reason: 'no liquidity',
        confirmedAt: new Date().toISOString(),
      };
    };
    const result = await new OrderManager(broker).submit({
      clientOrderId: 'rejected',
      symbol: 'XAUUSD',
      side: 'SELL',
      lots: 0.01,
    });
    expect(result.result.status).toBe('REJECTED');
    expect(calls).toBe(1);
  });
  test('waits for close confirmation before reverse open', async () => {
    const broker = new InMemoryBrokerAdapter();
    await broker.connect();
    await broker.placeMarketOrder({
      clientOrderId: 'buy',
      symbol: 'XAUUSD',
      side: 'BUY',
      lots: 0.01,
    });
    const previous = await broker.getPositions();
    const closed = await new PositionManager(broker).resolve(
      'XAUUSD',
      'SELL',
      'REVERSE_POSITION',
      previous,
    );
    expect(closed).toHaveLength(1);
    expect(closed[0]?.exitPrice).toBeDefined();
    expect(await broker.getPositions()).toHaveLength(0);
  });
});
