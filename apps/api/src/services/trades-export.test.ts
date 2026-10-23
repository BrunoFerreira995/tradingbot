import { expect, test } from 'bun:test';
import { tradesCsv, mergeTradeMetadata } from './trades-export';

test('exports every closed trade with CSV escaping and numeric losses', () => {
  const trades = Array.from({ length: 60 }, (_, i) => ({
    id: String(i),
    symbol: i === 0 ? '=SUM(1,2)' : 'A,"B',
    side: 'BUY',
    lots: '0.01',
    entryPrice: '100',
    exitPrice: '99',
    pnl: '-1.25',
    closedAt: new Date('2026-10-13T12:00:00Z'),
  }));
  const csv = tradesCsv([], trades, 'USD');
  expect(csv.split('\r\n')).toHaveLength(62);
  expect(csv).toContain('"\'=SUM(1,2)"');
  expect(csv).toContain('"A,""B"');
  expect(csv).toContain('"-1.25","USD","2026-10-13T12:00:00.000Z"');
});

test('exports open positions with unrealized PnL and no closing price', () => {
  const csv = tradesCsv(
    [
      {
        id: 'open',
        symbol: 'XAUUSD',
        side: 'SELL',
        lots: 1,
        entryPrice: 100,
        currentPrice: 99,
        unrealizedPnl: 1,
        stopLoss: 102,
        takeProfit: 95,
        openedAt: '2026-10-13T12:00:00Z',
      },
    ],
    [],
    'USD',
  );
  expect(csv).toContain(
    '"open","OPEN","XAUUSD","SELL","1","100","","99","1","USD",""',
  );
});

test('exports requested metadata, preserves zero confidence and blanks unknown values', () => {
  const csv = tradesCsv(
    [],
    [
      {
        id: 'closed',
        symbol: 'XAUUSD',
        side: 'BUY',
        lots: 1,
        entryPrice: 100,
        exitPrice: 110,
        pnl: 8,
        closedAt: '2026-10-14T12:00:00Z',
        openedAt: '2026-10-14T11:00:00Z',
        commission: -2,
        swap: 0,
        closeReason: 'TP',
      },
    ],
    'GBP',
    new Map([
      [
        'closed',
        {
          sessionId: 'session',
          strategyId: 'strategy',
          timeframe: 'M30',
          signalReason: 'Band touch, RSI extreme',
          signalConfidence: 0,
          spreadAtEntry: 0.5,
          initialSl: 95,
          initialTp: 110,
          riskAmount: 5,
          balanceAtEntry: 1000,
          equityAtEntry: 1000,
          executionLatencyMs: 120,
          slippage: -0.1,
        },
      ],
    ]),
  );
  const lines = csv.split('\r\n');
  expect(lines[0]).toContain(
    '"session_id","strategy_id","opened_at","close_reason","timeframe","signal_reason","signal_confidence","spread_at_entry","commission","swap","initial_sl","initial_tp","risk_amount","balance_at_entry","equity_at_entry","max_favorable_excursion","max_adverse_excursion","execution_latency_ms","slippage"',
  );
  expect(lines[1]).toContain(
    '"session","strategy","2026-10-14T11:00:00Z","TP","M30","Band touch, RSI extreme","0","0.5","-2","0"',
  );
  expect(lines[1]).toContain('"1000","1000","","","120","-0.1"');
});

test('keeps opening strategy and initial protection despite later stop changes', () => {
  const metadata = mergeTradeMetadata(
    { strategyId: 'opening-strategy', initialSl: 95, initialTp: 110 },
    { initialSl: undefined, initialTp: undefined },
  );
  expect(metadata).toMatchObject({
    strategyId: 'opening-strategy',
    initialSl: 95,
    initialTp: 110,
  });
  expect(
    mergeTradeMetadata(metadata, { initialSl: 0, initialTp: 0 }),
  ).toMatchObject({ initialSl: 0, initialTp: 0 });
});

test('uses confirmed bot timeout reason but never overrides terminal SL or TP', () => {
  expect(
    mergeTradeMetadata({ closeReason: 'TIMEOUT' }, { closeReason: 'EXPERT' })
      .closeReason,
  ).toBe('TIMEOUT');
  expect(
    mergeTradeMetadata({ closeReason: 'TIMEOUT' }, { closeReason: 'SL' })
      .closeReason,
  ).toBe('SL');
  expect(
    mergeTradeMetadata({ closeReason: 'SIGNAL' }, { closeReason: 'TP' })
      .closeReason,
  ).toBe('TP');
  expect(
    mergeTradeMetadata(undefined, { closeReason: 'EXPERT' }).closeReason,
  ).toBe('EXPERT');
  expect(mergeTradeMetadata(undefined, {}).closeReason).toBeUndefined();
});

test('separates bot execution identity from the market session at entry', () => {
  const csv = tradesCsv(
    [],
    [
      {
        id: 'p',
        symbol: 'XAUUSD',
        side: 'BUY',
        lots: 1,
        entryPrice: 100,
        exitPrice: 101,
        pnl: 1,
        closedAt: '2026-03-10T13:00:00Z',
        openedAt: '2026-03-10T12:30:00Z',
      },
    ],
    'USD',
    new Map([
      [
        'p',
        {
          sessionId: 'bot-run-1',
          excursionObservedFrom: '2026-03-10T12:30:01Z',
          excursionObservedUntil: '2026-03-10T13:00:00Z',
        },
      ],
    ]),
  );
  expect(csv.split('\r\n')[0]).toContain(
    '"bot_session_id","market_session","excursion_observed_from","excursion_observed_until"',
  );
  expect(csv).toContain(
    '"bot-run-1","LONDON+NEW_YORK","2026-03-10T12:30:01Z","2026-03-10T13:00:00Z"',
  );
});
