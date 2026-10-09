import { describe, expect, test } from 'bun:test';
import type { BrokerAdapter } from '@trade/broker';
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
  rates: Rate[] = [];
  /** Per-symbol overrides, for tests where symbols must behave differently. */
  ratesBySymbol: Record<string, Rate[]> = {};
  failWith: Error | undefined;
  failSymbols = new Set<string>();
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
    if (this.failWith) throw this.failWith;
    return price;
  }
  async getRates(
    symbol: string,
    _period: Timeframe,
    _count: number,
  ): Promise<Rate[]> {
    if (this.failWith) throw this.failWith;
    if (this.failSymbols.has(symbol)) throw new Error(`${symbol} not reachable`);
    return this.ratesBySymbol[symbol] ?? this.rates;
  }
  async getPositions(): Promise<Position[]> {
    return [];
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
    // Mid of bid 99.5 and ask 100.5 is 100; 1% stop, 1.5% target.
    expect(signal.stopLoss).toBeCloseTo(1, 8);
    expect(signal.takeProfit).toBeCloseTo(1.5, 8);
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

/**
 * Two properties the dashboard depends on: a timeframe switch takes effect
 * without a restart, and per-symbol state stays visible so eight pairs do not
 * collapse into one aggregate verdict.
 */
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
