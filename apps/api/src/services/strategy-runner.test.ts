import { describe, expect, test } from 'bun:test';
import type { BrokerAdapter } from '@trade/broker';
import { defaultSmaMicroTrendConfig, defaultDiversifiedTrendConfig } from '@trade/strategy';
import type {
  AccountInfo,
  MarketOrderRequest,
  MarketPrice,
  Order,
  OrderResult,
  Position,
  Rate,
  SymbolInfo,
  Timeframe,
  TradingSignal,
} from '@trade/shared';
import {
  StrategyRunner,
  type StrategyEvaluationReport,
} from './strategy-runner';

/**
 * The runner's job is narrow and safety-critical: decide once per closed bar,
 * never twice, and never on a forming bar. Everything it needs is injected, so
 * these tests drive the real evaluation path with no database and no terminal.
 */

const account: AccountInfo = {
  id: '61605908',
  balance: 200,
  equity: 200,
  freeMargin: 200,
  usedMargin: 0,
  marginLevel: 0,
  currency: 'USD',
};

const symbolInfo: SymbolInfo = {
  symbol: 'XAUUSD',
  minLot: 0.01,
  maxLot: 100,
  lotStep: 0.01,
  contractSize: 100,
  tickValue: 1,
  tickSize: 0.01,
  maxSpread: 50,
  maxSlippage: 2,
  defaultStopLoss: 25,
  defaultTakeProfit: 50,
  marginRate: 0.01,
  marketOpen: true,
  stopsLevel: 0.00001,
};

/** Prices around 100 so a 1% stop is a clean 1 unit. */
const price: MarketPrice = {
  symbol: 'XAUUSD',
  bid: 99.5,
  ask: 100.5,
  spread: 1,
  at: new Date().toISOString(),
};

class FakeBroker implements BrokerAdapter {
  connected = true;
  positions: Position[] = [];
  rates: Rate[] = [];
  /** Per-symbol overrides, for tests where symbols must behave differently. */
  ratesBySymbol: Record<string, Rate[]> = {};
  ratesByTimeframe: Partial<Record<Timeframe, Rate[]>> = {};
  failWith: Error | undefined;
  priceFailure: Error | undefined;
  failSymbols = new Set<string>();
  rateRequests: number[] = [];
  priceRequests = 0;
  quote: MarketPrice = price;
  async connect() {}
  async disconnect() {
    this.connected = false;
  }
  async getAccount() {
    return account;
  }
  async getSymbol() {
    return symbolInfo;
  }
  async getPrice() {
    this.priceRequests++;
    if (this.priceFailure) throw this.priceFailure;
    if (this.failWith) throw this.failWith;
    return this.quote;
  }
  async getRates(
    symbol: string,
    _period: Timeframe,
    count: number,
  ): Promise<Rate[]> {
    if (this.failWith) throw this.failWith;
    if (this.failSymbols.has(symbol))
      throw new Error(`${symbol} not reachable`);
    this.rateRequests.push(count);
    return (this.ratesByTimeframe[_period] ?? this.ratesBySymbol[symbol] ?? this.rates).slice(-count);
  }
  async getPositions(): Promise<Position[]> {
    return this.positions;
  }
  async getOrders(): Promise<Order[]> {
    return [];
  }
  async placeMarketOrder(_order: MarketOrderRequest): Promise<OrderResult> {
    return {
      brokerOrderId: '1',
      status: 'FILLED',
      executedPrice: 100,
      positionId: '1',
      confirmedAt: new Date().toISOString(),
    };
  }
  async closePosition(): Promise<OrderResult> {
    return {
      brokerOrderId: '1',
      status: 'FILLED',
      executedPrice: 100,
      confirmedAt: new Date().toISOString(),
    };
  }
  async modifyPosition(): Promise<OrderResult> {
    return {
      brokerOrderId: '1',
      status: 'FILLED',
      confirmedAt: new Date().toISOString(),
    };
  }
}

const engine = () => {
  const signals: TradingSignal[] = [];
  return {
    signals,
    async process(signal: TradingSignal) {
      signals.push(signal);
      return { status: 'EXECUTED' as const, signalId: signal.signalId };
    },
  };
};

const collector = () => {
  const evaluated: StrategyEvaluationReport[] = [];
  const failures: string[] = [];
  return {
    evaluated,
    failures,
    reporter: {
      async evaluated(report: StrategyEvaluationReport) {
        evaluated.push(report);
      },
      async failed(report: { error: string }) {
        failures.push(report.error);
      },
    },
  };
};

/** A rising run followed by a sharp drop: the closed bar at index -2 buys. */
function buyingRates(): Rate[] {
  const calm = Array.from({ length: 40 }, (_, i) => 100 + i * 0.05);
  return [...calm, 96, 97].map((c, i) => ({
    t: 1_000_000 + i,
    o: c,
    h: c,
    l: c,
    c,
    v: 1,
  }));
}

/**
 * The same shape at a later time. `advance` appends bars, which changes the
 * indicator maths and can stop reproducing a setup; shifting keeps the series
 * identical so a test can advance the clock and still expect the same decision.
 */
function shiftRates(offset: number): Rate[] {
  return buyingRates().map((rate) => ({ ...rate, t: rate.t + offset }));
}

function calmRates(): Rate[] {
  return Array.from({ length: 60 }, (_, i) => {
    const c = 100 + (i % 2) * 0.01;
    return { t: 1_000_000 + i, o: c, h: c, l: c, c, v: 1 };
  });
}

function build(
  broker: FakeBroker,
  eng: ReturnType<typeof engine>,
  rep: ReturnType<typeof collector>,
) {
  return new StrategyRunner(broker as unknown as BrokerAdapter, eng as never, {
    strategyName: 'meanrev-bb-rsi-v1',
    symbols: ['XAUUSD'],
    timeframe: 'M30',
    history: 120,
    reporter: rep.reporter,
  });
}

/** A runner over an explicit symbol list, for the multi-symbol cases. */
function buildMany(
  broker: FakeBroker,
  eng: ReturnType<typeof engine>,
  rep: ReturnType<typeof collector>,
  symbols: string[],
) {
  return new StrategyRunner(broker as unknown as BrokerAdapter, eng as never, {
    strategyName: 'meanrev-bb-rsi-v1',
    symbols,
    timeframe: 'M30',
    history: 120,
    reporter: rep.reporter,
  });
}

/**
 * Closes one more bar. Two bars are appended, not one: the first becomes the
 * newly closed bar the strategy reads, the second is the still-forming bar that
 * must be ignored. Appending only one would quietly promote the previous
 * forming bar, and the test would pass while reading the wrong close.
 */
function advance(
  broker: FakeBroker,
  closedClose: number,
  formingClose = closedClose,
): void {
  let t = broker.rates[broker.rates.length - 1]?.t ?? 0;
  const bar = (c: number) => ({
    t: (t += 1_800),
    o: c,
    h: c,
    l: c,
    c,
    v: 1,
  });
  broker.rates = [...broker.rates, bar(closedClose), bar(formingClose)];
}

/** The same two-bar step, applied to one symbol of a multi-symbol watch list. */
function advanceSymbol(
  broker: FakeBroker,
  symbol: string,
  closedClose: number,
  formingClose = closedClose,
): void {
  const series = broker.ratesBySymbol[symbol] ?? [];
  let t = series[series.length - 1]?.t ?? 0;
  const bar = (c: number) => ({ t: (t += 1_800), o: c, h: c, l: c, c, v: 1 });
  broker.ratesBySymbol[symbol] = [
    ...series,
    bar(closedClose),
    bar(formingClose),
  ];
}

describe('StrategyRunner', () => {
  test('runs enabled symbols and re-primes symbols when their toggle is enabled', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    broker.failSymbols.add('XAUUSD');
    const eng = engine();
    let allowed = ['EURUSD'];
    const runner = new StrategyRunner(broker, eng as never, {
      strategyName: 'meanrev-bb-rsi-v1',
      symbols: ['XAUUSD', 'EURUSD'],
      timeframe: 'M30',
      reporter: collector().reporter,
      getAllowedSymbols: async () => allowed,
    });
    expect((await runner.tick()).status).toBe('WAITING_BAR');
    expect(broker.rateRequests).toEqual([120]);
    expect(runner.state.symbolStates.XAUUSD?.detail).toBe(
      'Disabled in Allowed symbols',
    );
    advance(broker, 96, 97);
    expect((await runner.tick()).status).toBe('SIGNAL');
    expect(eng.signals.map((signal) => signal.symbol)).toEqual(['EURUSD']);
    allowed = [];
    expect((await runner.tick()).status).toBe('BLOCKED');
    allowed = ['EURUSD'];
    expect((await runner.tick()).status).toBe('WAITING_BAR');
    expect(eng.signals).toHaveLength(1);
  });

  test('exposes startup refusals per symbol and can evaluate once unblocked', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const runner = buildMany(broker, engine(), collector(), [
      'XAUUSD',
      'GASOLINE',
    ]);
    runner.blockStartup('GASOLINE not in risk_settings.allowedSymbols');
    expect(runner.state.status).toBe('BLOCKED');
    expect(runner.state.detail).toContain('GASOLINE');
    for (const state of Object.values(runner.state.symbolStates)) {
      expect(state.status).toBe('BLOCKED');
      expect(state.detail).toContain('allowedSymbols');
      expect(state.secondsToNextBar).toBeNull();
    }
    expect((await runner.tick()).status).toBe('WAITING_BAR');
    expect(runner.state.symbolStates.GASOLINE?.rsi).toBeDefined();
  });

  test('polls two bars while waiting and loads full history for a new decision', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const eng = engine();
    const runner = build(broker, eng, collector());
    await runner.tick();
    await runner.tick();
    await runner.tick();
    expect(broker.rateRequests).toEqual([120, 2, 2]);
    expect(broker.priceRequests).toBe(0);
    advance(broker, 96, 97);
    await runner.tick();
    expect(broker.rateRequests).toEqual([120, 2, 2, 2, 120]);
    expect(broker.priceRequests).toBe(1);
    expect(eng.signals).toHaveLength(1);
  });

  test('does not fetch quotes when a new closed bar has no setup', async () => {
    const broker = new FakeBroker();
    broker.rates = calmRates();
    const runner = build(broker, engine(), collector());
    await runner.tick();
    const forces = runner.state.symbolStates.XAUUSD?.marketForces;
    expect(forces).toBeDefined();
    await runner.tick();
    expect(runner.state.symbolStates.XAUUSD?.marketForces).toEqual(forces);
    advance(broker, 100, 100);
    expect((await runner.tick()).status).toBe('NO_SETUP');
    expect(broker.priceRequests).toBe(0);
  });

  test('retries a setup after a transient quote failure without losing the bar', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const eng = engine();
    const runner = build(broker, eng, collector());
    await runner.tick();
    advance(broker, 96, 97);
    const getPrice = broker.getPrice.bind(broker);
    broker.getPrice = async () => {
      throw new Error('quote unavailable');
    };
    expect((await runner.tick()).status).toBe('BLOCKED');
    broker.getPrice = getPrice;
    expect((await runner.tick()).status).toBe('SIGNAL');
    await runner.tick();
    expect(eng.signals).toHaveLength(1);
  });

  test('primes on the first tick without trading, even on a setup', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const eng = engine();
    const rep = collector();
    const runner = build(broker, eng, rep);

    const state = await runner.tick();

    expect(state.status).toBe('WAITING_BAR');
    expect(eng.signals).toHaveLength(0);
    expect(state.detail).toContain('primed');
  });

  test('does not fire twice on the same bar', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const eng = engine();
    const runner = build(broker, eng, collector());

    await runner.tick();
    const second = await runner.tick();

    expect(second.status).toBe('WAITING_BAR');
    expect(eng.signals).toHaveLength(0);
  });

  test('fires one BUY when a new bar closes on a setup', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const eng = engine();
    const rep = collector();
    const runner = build(broker, eng, rep);

    await runner.tick();
    advance(broker, 96, 97);
    const state = await runner.tick();

    expect(state.status).toBe('SIGNAL');
    expect(eng.signals).toHaveLength(1);
    const signal = eng.signals[0] as TradingSignal;
    expect(signal.action).toBe('BUY');
    expect(signal.signalReason).toContain('BUY: closed candle close=');
    expect(signal.signalReason).toContain('<= lower Bollinger band=');
    expect(signal.signalReason).toContain('RSI=');
    expect(signal.signalReason).toContain('timeframe=M30; bar=');
    expect(signal.symbol).toBe('XAUUSD');
    expect(signal.strategy).toBe('meanrev-bb-rsi-v1');
    expect(signal.timeframe).toBe('M30');
    expect(signal.orderType).toBe('MARKET');
    expect(rep.evaluated.at(-1)?.outcome).toBe('executed');
    expect(rep.evaluated.at(-1)?.side).toBe('BUY');
    // The bar that triggered it, not the one forming above it.
    expect(rep.evaluated.at(-1)?.close).toBe(96);
  });

  test('sizes stops as distances from the mid price', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const eng = engine();
    const runner = build(broker, eng, collector());

    await runner.tick();
    advance(broker, 96, 97);
    await runner.tick();

    const signal = eng.signals[0] as TradingSignal;
    // Mid of bid 99.5 and ask 100.5 is 100; 0.2% stop, 0.4% target.
    expect(signal.stopLoss).toBeCloseTo(0.2, 8);
    expect(signal.takeProfit).toBeCloseTo(0.4, 8);
    expect(signal.lots).toBe(0.01);
  });

  test('produces a deterministic signal id per bar, side and strategy', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const eng = engine();
    const runner = build(broker, eng, collector());

    await runner.tick();
    advance(broker, 96, 97);
    await runner.tick();

    const id = (eng.signals[0] as TradingSignal).signalId;
    expect(id).toBe('meanrev-bb-rsi-v1:XAUUSD:M30:1001841:BUY');

    // A second runner replaying the same bar derives the same id, so the
    // engine's unique index absorbs it instead of opening a duplicate.
    const replay = build(broker, engine(), collector());
    await replay.tick();
    advance(broker, 96, 97);
    await replay.tick();
  });

  test('reports NO_SETUP without emitting a signal', async () => {
    const broker = new FakeBroker();
    broker.rates = calmRates();
    const eng = engine();
    const rep = collector();
    const runner = build(broker, eng, rep);

    await runner.tick();
    advance(broker, 100, 100);
    const state = await runner.tick();

    expect(state.status).toBe('NO_SETUP');
    expect(eng.signals).toHaveLength(0);
    expect(rep.evaluated.at(-1)?.outcome).toBe('no_setup');
  });

  test('blocks instead of throwing when the broker fails', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const eng = engine();
    const rep = collector();
    const runner = build(broker, eng, rep);

    broker.failWith = new Error('bridge unreachable');
    const state = await runner.tick();

    expect(state.status).toBe('BLOCKED');
    expect(state.detail).toBe('bridge unreachable');
    expect(eng.signals).toHaveLength(0);
    expect(rep.failures).toEqual(['bridge unreachable']);
  });

  test('recovers on the next tick after a failure', async () => {
    const broker = new FakeBroker();
    broker.rates = calmRates();
    const eng = engine();
    const runner = build(broker, eng, collector());

    broker.failWith = new Error('bridge unreachable');
    expect((await runner.tick()).status).toBe('BLOCKED');

    broker.failWith = undefined;
    expect((await runner.tick()).status).toBe('WAITING_BAR');
  });

  test('blocks when no bars come back', async () => {
    const broker = new FakeBroker();
    broker.rates = [];
    const runner = build(broker, engine(), collector());
    const state = await runner.tick();
    expect(state.status).toBe('BLOCKED');
    expect(state.detail).toContain('no M30 bars');
  });

  test('surfaces a rejection reason from the engine', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const rep = collector();
    const rejecting = {
      signals: [] as TradingSignal[],
      async process(signal: TradingSignal) {
        rejecting.signals.push(signal);
        return {
          status: 'REJECTED' as const,
          reason: 'Symbol not allowed',
          signalId: signal.signalId,
        };
      },
    };
    const runner = new StrategyRunner(
      broker as unknown as BrokerAdapter,
      rejecting as never,
      {
        strategyName: 'meanrev-bb-rsi-v1',
        symbols: ['XAUUSD'],
        timeframe: 'M30',
        reporter: rep.reporter,
      },
    );

    await runner.tick();
    advance(broker, 96, 97);
    const state = await runner.tick();

    expect(state.detail).toContain('rejected');
    expect(rep.evaluated.at(-1)?.outcome).toBe('rejected');
    expect(rep.evaluated.at(-1)?.reason).toBe('Symbol not allowed');
  });

  test('exposes its state for the API', async () => {
    const broker = new FakeBroker();
    broker.rates = calmRates();
    const runner = build(broker, engine(), collector());
    const state = await runner.tick();
    expect(state.symbols).toEqual(['XAUUSD']);
    expect(state.timeframe).toBe('M30');
    expect(state.lastCheckAt).not.toBeNull();
  });

  test('evaluates every watched symbol, not just the first', async () => {
    const broker = new FakeBroker();
    broker.ratesBySymbol = { XAUUSD: buyingRates(), EURUSD: calmRates() };
    const eng = engine();
    const rep = collector();
    const runner = buildMany(broker, eng, rep, ['XAUUSD', 'EURUSD']);

    // First pass primes both symbols without trading on either.
    expect((await runner.tick()).status).toBe('WAITING_BAR');
    expect(eng.signals).toHaveLength(0);

    advanceSymbol(broker, 'XAUUSD', 96, 97);
    advanceSymbol(broker, 'EURUSD', 100, 100);
    const state = await runner.tick();

    // XAUUSD set up and bought, EURUSD had no setup, and the pass reports the
    // more consequential outcome rather than stopping at the first symbol.
    expect(state.status).toBe('SIGNAL');
    expect(eng.signals).toHaveLength(1);
    expect(eng.signals[0]?.symbol).toBe('XAUUSD');
    const outcomes = rep.evaluated.map((r) => `${r.symbol}:${r.outcome}`);
    expect(outcomes).toEqual(['XAUUSD:executed', 'EURUSD:no_setup']);
  });

  test('keeps evaluating the rest of the list when one symbol fails', async () => {
    const broker = new FakeBroker();
    broker.ratesBySymbol = { XAUUSD: buyingRates(), EURUSD: calmRates() };
    broker.failSymbols = new Set(['EURUSD']);
    const eng = engine();
    const rep = collector();
    const runner = buildMany(broker, eng, rep, ['XAUUSD', 'EURUSD']);

    await runner.tick();
    advanceSymbol(broker, 'XAUUSD', 96, 97);
    const state = await runner.tick();

    // The failure is reported against EURUSD and does not veto XAUUSD's trade,
    // but it does keep the overall status at BLOCKED so the dashboard cannot
    // present a clean run while a watched symbol is unreachable.
    expect(eng.signals).toHaveLength(1);
    expect(eng.signals[0]?.symbol).toBe('XAUUSD');
    expect(state.status).toBe('BLOCKED');
    expect(rep.failures).toEqual(['EURUSD not reachable']);
  });

  test('does not replay a bar for one symbol because another advanced', async () => {
    const broker = new FakeBroker();
    broker.ratesBySymbol = { XAUUSD: buyingRates(), EURUSD: calmRates() };
    const eng = engine();
    const rep = collector();
    const runner = buildMany(broker, eng, rep, ['XAUUSD', 'EURUSD']);

    await runner.tick();
    advanceSymbol(broker, 'XAUUSD', 96, 97);
    await runner.tick();
    expect(eng.signals).toHaveLength(1);

    // EURUSD closes a bar while XAUUSD's is unchanged. XAUUSD must stay on the
    // bar it already acted on instead of evaluating it a second time, so the
    // only new outcome is EURUSD's.
    advanceSymbol(broker, 'EURUSD', 100, 100);
    const state = await runner.tick();
    expect(state.status).toBe('NO_SETUP');
    expect(eng.signals).toHaveLength(1);
    expect(rep.evaluated.map((r) => r.outcome)).toEqual([
      'executed',
      'no_setup',
    ]);
  });
});

describe('SMA runner integration', () => {
  const smaConfig = { ...defaultSmaMicroTrendConfig, indicators: { fastSMA: 2, slowSMA: 3, atrPeriod: 2 } };
  const rates = (closes: number[]) => closes.map((c, i) => ({ t: 1000 + i * 1800, o: c, h: c + 1, l: c - 1, c, v: 1 }));
  test('submits one closed-bar signal with ATR distance and no replay', async () => {
    const broker = new FakeBroker();
    broker.rates = rates([5, 4, 3, 4]);
    const eng = engine();
    const runner = new StrategyRunner(broker, eng as never, { strategyName: 'sma_micro_trend', symbols: ['XAUUSD'], timeframe: 'M30', smaConfig, reporter: collector().reporter });
    await runner.tick();
    broker.rates = rates([5, 4, 3, 4, 6, 7]);
    await runner.tick();
    await runner.tick();
    expect(eng.signals).toHaveLength(1);
    expect(eng.signals[0]?.action).toBe('BUY');
    expect(eng.signals[0]?.stopLoss).toBeGreaterThan(0);
    expect(eng.signals[0]?.maximumEntrySpread).toBeGreaterThan(0);
    expect(eng.signals[0]?.minimumEntryStopDistance).toBeGreaterThan(0);
  });
  test('skips a costly crossover before closing an opposite position', async () => {
    const broker = new FakeBroker();
    broker.rates = rates([3, 4, 5, 4]);
    broker.quote = { ...price, bid: 90, ask: 100, spread: 10 };
    broker.positions = [{ id: 'old', symbol: 'XAUUSD', side: 'BUY', lots: 1, entryPrice: 4, currentPrice: 4, unrealizedPnl: 0, openedAt: '' }];
    const eng = engine();
    const runner = new StrategyRunner(broker, eng as never, { strategyName: 'sma_micro_trend', symbols: ['XAUUSD'], timeframe: 'M30', smaConfig, reporter: collector().reporter });
    await runner.tick();
    broker.rates = rates([3, 4, 5, 4, 2, 1]);
    expect((await runner.tick()).status).toBe('BLOCKED');
    expect(eng.signals).toHaveLength(0);
    expect(broker.positions).toHaveLength(1);
  });
  test('retries a crossover when the spread quote briefly fails', async () => {
    const broker = new FakeBroker();
    broker.rates = rates([5, 4, 3, 4]);
    const eng = engine();
    const runner = new StrategyRunner(broker, eng as never, { strategyName: 'sma_micro_trend', symbols: ['XAUUSD'], timeframe: 'M30', smaConfig, reporter: collector().reporter });
    await runner.tick();
    broker.rates = rates([5, 4, 3, 4, 6, 7]);
    broker.priceFailure = new Error('temporary quote failure');
    expect((await runner.tick()).status).toBe('BLOCKED');
    broker.priceFailure = undefined;
    expect((await runner.tick()).status).toBe('SIGNAL');
    expect(eng.signals).toHaveLength(1);
  });
  test('macro disagreement skips an entry without closing the opposite position', async () => {
    const broker = new FakeBroker();
    broker.rates = rates([3, 4, 5, 4]);
    broker.ratesByTimeframe.H1 = [1, 2, 3, 4, 5].map((c, i) => ({ t: -2600 + i * 3600, o: c, h: c + 1, l: c - 1, c, v: 1 }));
    broker.positions = [{ id: 'old', symbol: 'XAUUSD', side: 'BUY', lots: 1, entryPrice: 4, currentPrice: 4, unrealizedPnl: 0, openedAt: '' }];
    const eng = engine();
    const alignedConfig = { ...smaConfig, filters: { ...smaConfig.filters, requireMacroTrendAlignment: true } };
    const runner = new StrategyRunner(broker, eng as never, { strategyName: 'sma_micro_trend', symbols: ['XAUUSD'], timeframe: 'M30', smaConfig: alignedConfig, reporter: collector().reporter });
    await runner.tick();
    broker.rates = rates([3, 4, 5, 4, 2, 1]);
    expect((await runner.tick()).symbolStates.XAUUSD?.detail).toContain('not aligned');
    expect(eng.signals).toHaveLength(0);
    expect(broker.positions).toHaveLength(1);
  });
  test('macro agreement permits the micro crossover', async () => {
    const broker = new FakeBroker();
    broker.rates = rates([5, 4, 3, 4]);
    broker.ratesByTimeframe.H1 = [1, 2, 3, 4, 5].map((c, i) => ({ t: -2600 + i * 3600, o: c, h: c + 1, l: c - 1, c, v: 1 }));
    const eng = engine();
    const alignedConfig = { ...smaConfig, filters: { ...smaConfig.filters, requireMacroTrendAlignment: true } };
    const runner = new StrategyRunner(broker, eng as never, { strategyName: 'sma_micro_trend', symbols: ['XAUUSD'], timeframe: 'M30', smaConfig: alignedConfig, reporter: collector().reporter });
    await runner.tick();
    broker.rates = rates([5, 4, 3, 4, 6, 7]);
    expect((await runner.tick()).status).toBe('SIGNAL');
    expect(eng.signals.map((signal) => signal.action)).toEqual(['BUY']);
  });
  test('confirms opposite close before opening a reversal', async () => {
    const broker = new FakeBroker();
    broker.rates = rates([3, 4, 5, 4]);
    broker.positions = [{ id: 'old', symbol: 'XAUUSD', side: 'BUY', lots: 1, entryPrice: 4, currentPrice: 4, unrealizedPnl: 0, openedAt: '' }];
    const signals: TradingSignal[] = [];
    const eng = { async process(signal: TradingSignal) { signals.push(signal); if (signal.action === 'CLOSE_LONG') broker.positions = []; return { status: 'EXECUTED' as const, signalId: signal.signalId }; } };
    const runner = new StrategyRunner(broker, eng as never, { strategyName: 'sma_micro_trend', symbols: ['XAUUSD'], timeframe: 'M30', smaConfig, reporter: collector().reporter });
    await runner.tick();
    broker.rates = rates([3, 4, 5, 4, 2, 1]);
    await runner.tick();
    expect(signals.map((s) => s.action)).toEqual(['CLOSE_LONG', 'SELL']);
  });
  test('does not open inverse position when close is rejected', async () => {
    const broker = new FakeBroker();
    broker.rates = rates([3, 4, 5, 4]);
    broker.positions = [{ id: 'old', symbol: 'XAUUSD', side: 'BUY', lots: 1, entryPrice: 4, currentPrice: 4, unrealizedPnl: 0, openedAt: '' }];
    const signals: TradingSignal[] = [];
    const eng = { async process(signal: TradingSignal) { signals.push(signal); return { status: 'REJECTED' as const, signalId: signal.signalId }; } };
    const runner = new StrategyRunner(broker, eng as never, { strategyName: 'sma_micro_trend', symbols: ['XAUUSD'], timeframe: 'M30', smaConfig, reporter: collector().reporter });
    await runner.tick();
    broker.rates = rates([3, 4, 5, 4, 2, 1]);
    expect((await runner.tick()).status).toBe('BLOCKED');
    expect(signals.map((s) => s.action)).toEqual(['CLOSE_LONG']);
  });
});

describe('Dow Theory runner integration', () => {
  test('submits a confirmed closed-bar breakout with the swing stop and 3R target', async () => {
    const makeRates = (values: Array<[number, number, number]>) => values.map(([h, l, c], i) => ({
      t: 1_000 + i * 1_800,
      o: c,
      h,
      l,
      c,
      v: 1,
    }));
    const initial = makeRates([
      [10, 7, 8], [11, 6, 9], [12, 7, 10], [11, 8, 10],
      [10, 6, 9], [12, 7, 11], [13, 8, 12], [12, 9, 11],
      [11, 7, 10], [13, 8, 12], [14, 9, 13], [13, 10, 12.5],
      [12, 8, 11], [13, 10, 12], [15, 11, 13.8],
    ]);
    const broker = new FakeBroker();
    broker.rates = initial;
    const eng = engine();
    const runner = new StrategyRunner(broker, eng as never, {
      strategyName: 'dow_theory',
      symbols: ['XAUUSD'],
      timeframe: 'M30',
      reporter: collector().reporter,
    });

    expect((await runner.tick()).status).toBe('WAITING_BAR');
    broker.rates = [
      ...initial,
      ...makeRates([[16, 11, 14.6], [17, 10, 15]]).map((rate, i) => ({
        ...rate,
        t: 1_000 + (initial.length + i) * 1_800,
      })),
    ];
    expect((await runner.tick()).status).toBe('SIGNAL');
    await runner.tick();

    expect(eng.signals).toHaveLength(1);
    expect(eng.signals[0]?.action).toBe('BUY');
    expect(eng.signals[0]?.stopLoss).toBe(92.5);
    expect(eng.signals[0]?.takeProfit).toBe(277.5);
    expect(eng.signals[0]?.signalReason).toContain('Dow UP breakout');
  });
});

/**
 * Two properties the dashboard depends on: a timeframe switch takes effect
 * without a restart, and per-symbol state stays visible so eight pairs do not
 * collapse into one aggregate verdict.
 */
describe('Market forces automatic entries', () => {
  function setup(mirror = false, strategyName = 'market_forces', threshold = 1.18) {
    const broker = new FakeBroker();
    const makeBars = (length: number): Rate[] => Array.from({ length }, (_, i) => {
      const c = 100 + i * 0.8 + [0, 1, 2, -1][i % 4]!;
      const b = { t: 1000 + i * 1800, o: c - 0.8, h: c + 0.1, l: c - 1, c, v: 1 };
      return mirror ? { ...b, o: 400 - b.o, c: 400 - b.c, h: 400 - b.l, l: 400 - b.h } : b;
    });
    broker.rates = makeBars(64);
    broker.quote = { ...price, bid: 150, ask: 150.01, spread: 0.01 };
    const eng = engine();
    const runner = new StrategyRunner(broker, eng as never, {
      strategyName, symbols: ['XAUUSD'], timeframe: 'M30', reporter: collector().reporter,
      shockConfig: { threshold },
    });
    return { broker, eng, runner, makeBars };
  }

  for (const mirror of [false, true]) {
    test(`executes aligned ${mirror ? 'SELL' : 'BUY'} once with protective distances`, async () => {
      const { broker, eng, runner, makeBars } = setup(mirror);
      await runner.tick();
      expect(eng.signals).toHaveLength(0);
      broker.rates = makeBars(65);
      expect((await runner.tick()).status).toBe('SIGNAL');
      await runner.tick();
      expect(eng.signals).toHaveLength(1);
      expect(eng.signals[0]!.action).toBe(mirror ? 'SELL' : 'BUY');
      expect(eng.signals[0]!.stopLoss).toBeGreaterThan(0);
      expect(eng.signals[0]!.takeProfit).toBe(eng.signals[0]!.stopLoss! * 2);
      expect(eng.signals[0]!.signalReason).toContain('Market forces');
    });
  }

  test('blocks expensive spread without sending an entry', async () => {
    const { broker, eng, runner, makeBars } = setup();
    await runner.tick();
    broker.rates = makeBars(65);
    broker.quote = { ...price, bid: 100, ask: 110, spread: 10 };
    expect((await runner.tick()).status).toBe('BLOCKED');
    expect(eng.signals).toHaveLength(0);
  });

  test('shock variant blocks an otherwise valid entry and reports its cause', async () => {
    const { broker, eng, runner, makeBars } = setup(false, 'market_forces_shock', 0.01);
    await runner.tick();
    broker.rates = makeBars(65);
    expect((await runner.tick()).status).toBe('NO_SETUP');
    const state = runner.state.symbolStates.XAUUSD!;
    expect(state.marketForces?.action).toBe('BUY');
    expect(state.forceShock?.blocked).toBe(true);
    expect(state.forceShock?.action).toBe('WAIT');
    expect(state.detail).toContain('Choque forte');
    expect(eng.signals).toHaveLength(0);
    expect(broker.priceRequests).toBe(0);
    await runner.tick();
    expect(runner.state.symbolStates.XAUUSD!.forceShock).toEqual(state.forceShock);
  });

  test('shock variant routes an unblocked entry through engine with shock context', async () => {
    const { broker, eng, runner, makeBars } = setup(false, 'market_forces_shock', 1000);
    await runner.tick();
    broker.rates = makeBars(65);
    expect((await runner.tick()).status).toBe('SIGNAL');
    expect(eng.signals).toHaveLength(1);
    expect(eng.signals[0]!.strategy).toBe('market_forces_shock');
    expect(eng.signals[0]!.signalReason).toContain('shock=');
    await runner.tick();
    expect(eng.signals).toHaveLength(1);
  });

  test('does not replay submission after an uncertain engine failure', async () => {
    const { broker, eng, runner, makeBars } = setup();
    await runner.tick();
    broker.rates = makeBars(65);
    let submissions = 0;
    eng.process = async () => { submissions++; throw new Error('confirmation timeout'); };
    expect((await runner.tick()).status).toBe('BLOCKED');
    await runner.tick();
    expect(submissions).toBe(1);
  });

  test('does not add or reverse an existing symbol position', async () => {
    const { broker, eng, runner, makeBars } = setup();
    await runner.tick();
    broker.rates = makeBars(65);
    broker.positions = [{ symbol: 'XAUUSD', side: 'SELL' } as Position];
    expect((await runner.tick()).status).toBe('NO_SETUP');
    expect(eng.signals).toHaveLength(0);
    expect(broker.priceRequests).toBe(0);
  });

  test('waits when direction and structure cannot be confirmed', async () => {
    const { broker, eng, runner } = setup();
    broker.rates = calmRates();
    await runner.tick();
    advance(broker, 100, 100);
    expect((await runner.tick()).status).toBe('NO_SETUP');
    expect(eng.signals).toHaveLength(0);
  });
});

describe('Diversified daily trend runner', () => {
  const makeRates = (length: number): Rate[] => Array.from({ length }, (_, i) => {
    const c = 1 + i * 0.001 + (i % 3) * 0.0002;
    return { t: 1000 + i * 86400, o: c - 0.0001, h: c + 0.001, l: c - 0.001, c, v: 1 };
  });
  function setup() {
    const broker = new FakeBroker();
    broker.rates = makeRates(80);
    broker.quote = { ...price, symbol: 'EURUSD', bid: 1.1, ask: 1.10001, spread: 0.00001 };
    const eng = engine();
    const runner = new StrategyRunner(broker, eng as never, {
      strategyName: 'diversified_trend', symbols: ['EURUSD'], timeframe: 'D1',
      trendConfig: { ...defaultDiversifiedTrendConfig, lookback: 20, volatilityPeriod: 20 },
      getMaximumLotSize: async () => 0.02, reporter: collector().reporter,
    });
    return { broker, eng, runner };
  }
  test('primes, requests sufficient history, sizes within cap and emits once per daily bar', async () => {
    const { broker, eng, runner } = setup();
    await runner.tick();
    expect(eng.signals).toHaveLength(0);
    broker.rates = makeRates(81);
    expect((await runner.tick()).status).toBe('SIGNAL');
    expect(broker.rateRequests).toEqual([305, 2, 305]);
    expect(eng.signals[0]!.action).toBe('BUY');
    expect(eng.signals[0]!.lots).toBe(0.02);
    expect(eng.signals[0]!.minimumEntryStopDistance).toBe(eng.signals[0]!.stopLoss);
    expect(runner.state.symbolStates.EURUSD!.diversifiedTrend?.ready).toBe(true);
    await runner.tick();
    expect(eng.signals).toHaveLength(1);
    expect(() => runner.setTimeframe('H1')).toThrow('requires D1');
  });
  test('holds an aligned position without submitting another entry', async () => {
    const { broker, eng, runner } = setup();
    await runner.tick();
    broker.positions = [{ symbol: 'EURUSD', side: 'BUY' } as Position];
    broker.rates = makeRates(81);
    expect((await runner.tick()).status).toBe('NO_SETUP');
    expect(eng.signals).toHaveLength(0);
  });
  test('confirms opposite-position exit before submitting new direction', async () => {
    const { broker, eng, runner } = setup();
    await runner.tick();
    broker.positions = [{ symbol: 'EURUSD', side: 'SELL' } as Position];
    eng.process = async (signal) => {
      eng.signals.push(signal);
      if (signal.action === 'CLOSE') broker.positions = [];
      return { status: 'EXECUTED', signalId: signal.signalId };
    };
    broker.rates = makeRates(81);
    expect((await runner.tick()).status).toBe('SIGNAL');
    expect(eng.signals.map((s) => s.action)).toEqual(['CLOSE', 'BUY']);
  });
  test('does not reverse when close is not reflected in terminal positions', async () => {
    const { broker, eng, runner } = setup();
    await runner.tick();
    broker.positions = [{ symbol: 'EURUSD', side: 'SELL' } as Position];
    broker.rates = makeRates(81);
    expect((await runner.tick()).status).toBe('BLOCKED');
    expect(eng.signals.map((s) => s.action)).toEqual(['CLOSE']);
  });
  test('existing account exposure consumes gross allocation budget', async () => {
    const { broker, eng, runner } = setup();
    await runner.tick();
    broker.positions = [{ symbol: 'USDJPY', side: 'BUY', currentPrice: 100, lots: 10000 } as Position];
    broker.rates = makeRates(81);
    expect((await runner.tick()).status).toBe('BLOCKED');
    expect(eng.signals).toHaveLength(0);
  });
});

describe('StrategyRunner timeframe and per-symbol state', () => {
  test('switching timeframe re-primes bars instead of waiting on a stale one', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const eng = engine();
    const rep = collector();
    const runner = build(broker, eng, rep);

    await runner.tick();
    expect(runner.state.timeframe).toBe('M30');

    runner.setTimeframe('H1');
    expect(runner.state.timeframe).toBe('H1');

    // `lastBarTimes` held M30 timestamps, so without the reset the H1 bar would
    // be compared against an M30 one and the symbol would stall. The first pass
    // re-primes on the H1 bar instead of acting on it, exactly as a restart does.
    broker.rates = shiftRates(3_600);
    expect((await runner.tick()).status).toBe('WAITING_BAR');

    // The next H1 bar is the one that gets evaluated.
    broker.rates = shiftRates(7_200);
    expect((await runner.tick()).status).toBe('SIGNAL');
  });

  test('signal ids carry the active timeframe so a switch cannot replay a bar', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const eng = engine();
    const rep = collector();
    const runner = build(broker, eng, rep);

    await runner.tick();
    runner.setTimeframe('M15');
    // Re-prime on the new timeframe, then close one more bar to act on.
    broker.rates = shiftRates(900);
    await runner.tick();
    broker.rates = shiftRates(1_800);
    await runner.tick();

    expect(eng.signals[0]?.signalId).toContain(':M15:');
    expect(eng.signals[0]?.timeframe).toBe('M15');
  });

  test('rejects the same timeframe as a no-op rather than re-priming', async () => {
    const broker = new FakeBroker();
    broker.rates = buyingRates();
    const eng = engine();
    const runner = build(broker, eng, collector());

    await runner.tick();
    broker.rates = shiftRates(1_800);
    await runner.tick();
    expect(eng.signals).toHaveLength(1);

    // Re-setting the current timeframe must not clear the dedupe map: that
    // would let the already-acted bar fire a second time.
    runner.setTimeframe('M30');
    const state = await runner.tick();
    expect(state.status).toBe('WAITING_BAR');
    expect(eng.signals).toHaveLength(1);
  });

  test('records indicator levels and trigger distance per symbol', async () => {
    const broker = new FakeBroker();
    broker.ratesBySymbol = { XAUUSD: calmRates(), EURUSD: calmRates() };
    const runner = buildMany(broker, engine(), collector(), [
      'XAUUSD',
      'EURUSD',
    ]);

    const state = await runner.tick();
    expect(Object.keys(state.symbolStates).sort()).toEqual([
      'EURUSD',
      'XAUUSD',
    ]);
    for (const symbol of ['XAUUSD', 'EURUSD']) {
      const entry = state.symbolStates[symbol];
      expect(entry?.status).toBe('WAITING_BAR');
      expect(entry?.lastBarAt).toBeTruthy();
      // Priming still reports the levels, so the dashboard is never blank.
      expect(entry?.rsi).toBeTypeOf('number');
      expect(entry?.rsiToTrigger).toBeTypeOf('number');
    }
  });

  test('marks a failing symbol blocked without discarding the others', async () => {
    const broker = new FakeBroker();
    broker.ratesBySymbol = { XAUUSD: calmRates(), EURUSD: calmRates() };
    broker.failSymbols.add('EURUSD');
    const runner = buildMany(broker, engine(), collector(), [
      'XAUUSD',
      'EURUSD',
    ]);

    const state = await runner.tick();
    expect(state.symbolStates.EURUSD?.status).toBe('BLOCKED');
    expect(state.symbolStates.EURUSD?.detail).toContain('not reachable');
    expect(state.symbolStates.XAUUSD?.status).toBe('WAITING_BAR');
  });

  test('clears per-symbol state when the broker drops', async () => {
    const broker = new FakeBroker();
    broker.rates = calmRates();
    const runner = build(broker, engine(), collector());

    await runner.tick();
    expect(runner.state.symbolStates.XAUUSD?.status).toBe('WAITING_BAR');

    broker.connected = false;
    const state = await runner.tick();
    // A stale "fine" verdict after a disconnect would read as still trading.
    expect(state.symbolStates.XAUUSD?.status).toBe('BLOCKED');
  });
});
