import { expect, test } from 'bun:test';
import type {
  AccountInfo,
  CapitalPoint,
  Position,
  TerminalDeal,
  TerminalHistory,
} from '@trade/shared';
import { calculatePerformance, modifiedDietz } from './performance-calculation';
const account: AccountInfo = {
  id: 'demo',
  balance: 1100,
  equity: 1100,
  currency: 'EUR',
  usedMargin: 10,
  freeMargin: 1090,
  marginLevel: 11000,
};
const at = Date.parse('2026-10-11T15:00:00Z') / 1000;
const deal = (overrides: Partial<TerminalDeal> = {}): TerminalDeal => ({
  id: '1',
  positionId: '0',
  symbol: '',
  type: 2,
  entry: 0,
  at,
  volume: 0,
  price: 0,
  profit: 100,
  commission: 0,
  swap: 0,
  fee: 0,
  ...overrides,
});
const history = (
  deals: TerminalDeal[],
  overrides: Partial<TerminalHistory> = {},
): TerminalHistory => ({
  accountId: 'demo',
  server: 'test',
  currency: 'EUR',
  updatedAt: at,
  serverOffsetSeconds: 10800,
  complete: true,
  deals,
  openPositionIds: [],
  ...overrides,
});
const calculate = (
  h: TerminalHistory | null,
  extra: Partial<Parameters<typeof calculatePerformance>[0]> = {},
) =>
  calculatePerformance({
    account,
    positions: [],
    symbols: {},
    history: h,
    observations: [],
    updatedAt: new Date(at * 1000).toISOString(),
    timezone: 'America/Sao_Paulo',
    now: at * 1000,
    ...extra,
  });
const point = (iso: string, equity: number): CapitalPoint => ({
  at: iso,
  balance: equity,
  equity,
});
test('deposits and withdrawals are separate from profit and costs', () => {
  const p = calculate(
    history([
      deal(),
      deal({ id: '2', profit: -20 }),
      deal({
        id: '3',
        type: 0,
        positionId: 'a',
        profit: 30,
        commission: -2,
        swap: -1,
        fee: -3,
      }),
      deal({ id: '4', type: 4, profit: -4 }),
    ]),
  );
  expect(p.deposits).toBe(100);
  expect(p.withdrawals).toBe(20);
  expect(p.netTotal).toBe(20);
  expect(p.commission).toBe(-2);
  expect(p.netDaily).toBe(20);
});
test('deposit-only growth is not performance and withdrawal is not drawdown', () => {
  const points = [
    point('2026-10-11T10:00:00Z', 1000),
    point('2026-10-11T11:00:00Z', 1500),
    point('2026-10-11T12:00:00Z', 1000),
  ];
  const cash = [
    deal({ at: Date.parse('2026-10-11T10:30:00Z') / 1000, profit: 500 }),
    deal({
      id: '2',
      at: Date.parse('2026-10-11T11:30:00Z') / 1000,
      profit: -500,
    }),
  ];
  expect(modifiedDietz(points, cash)).toBe(0);
  expect(
    calculate(history(cash), { observations: points }).drawdown?.maxAmount,
  ).toBe(0);
});
test('Modified Dietz weights external flows by time', () => {
  const points = [
    point('2026-10-11T10:00:00Z', 1000),
    point('2026-10-11T12:00:00Z', 1600),
  ];
  expect(
    modifiedDietz(points, [
      deal({ at: Date.parse('2026-10-11T11:00:00Z') / 1000, profit: 500 }),
    ]),
  ).toBeCloseTo(8);
});
test('drawdown measures peak decline in amount and percentage', () => {
  const p = calculate(history([]), {
    observations: [
      point('2026-10-11T10:00:00Z', 1000),
      point('2026-10-11T11:00:00Z', 1200),
      point('2026-10-11T12:00:00Z', 900),
    ],
  });
  expect(p.drawdown).toEqual({
    amount: 300,
    percent: 25,
    maxAmount: 300,
    maxPercent: 25,
  });
});
test('daily net uses account report timezone at the midnight boundary', () => {
  const p = calculate(
    history([
      deal({
        type: 4,
        at: Date.parse('2026-10-11T02:59:00Z') / 1000,
        profit: -2,
      }),
      deal({
        id: '2',
        type: 4,
        at: Date.parse('2026-10-11T03:00:00Z') / 1000,
        profit: -3,
      }),
    ]),
  );
  expect(p.netDaily).toBe(-3);
  expect(p.netMonthly).toBe(-5);
});
test('win rate uses fully closed positions including opening commission', () => {
  const entry = deal({
    type: 0,
    entry: 0,
    positionId: 'p',
    symbol: 'BTCUSD',
    profit: 0,
    commission: -5,
    stopLoss: 95,
    takeProfit: 104,
    volume: 1,
    price: 100,
  });
  const exit = deal({
    id: '2',
    type: 1,
    entry: 1,
    positionId: 'p',
    symbol: 'BTCUSD',
    profit: 4,
    commission: -1,
    volume: 1,
    price: 104,
    at: at + 1,
    reason: 5,
  });
  const p = calculate(history([entry, exit]));
  expect(p.closedTrades[0]?.pnl).toBe(-2);
  expect(p.closedTrades[0]).toMatchObject({
    commission: -6,
    swap: 0,
    initialSl: 95,
    initialTp: 104,
    closeReason: 'TP',
    openedAt: new Date(at * 1000).toISOString(),
  });
  expect(p.winRate).toBe(0);
  expect(p.losses).toBe(1);
  expect(
    calculate(history([entry, { ...exit, volume: 0.5 }])).closedTrades,
  ).toHaveLength(0);
  expect(
    calculate(history([entry, exit], { openPositionIds: ['p'] })).closedTrades,
  ).toHaveLength(0);
});
test('risk at stops is in account currency and missing stops stay unknown', () => {
  const position: Position = {
    id: 'p',
    symbol: 'BTCUSD',
    side: 'BUY',
    lots: 2,
    entryPrice: 100,
    currentPrice: 110,
    stopLoss: 90,
    unrealizedPnl: 20,
    openedAt: new Date().toISOString(),
  };
  const p = calculate(null, {
    positions: [position],
    symbols: { BTCUSD: { symbol: 'BTCUSD', tickSize: 1, tickValueLoss: 3 } },
  });
  expect(p.stopRisk).toBe(120);
  const unknown = calculate(null, {
    positions: [{ ...position, stopLoss: undefined }],
    symbols: { BTCUSD: { symbol: 'BTCUSD', tickSize: 1, tickValueLoss: 3 } },
  });
  expect(unknown.stopRisk).toBeNull();
  expect(unknown.exposure[0]?.missingStops).toBe(1);
});
test('missing or partial history never invents performance', () => {
  expect(calculate(null).netTotal).toBeNull();
  expect(calculate(null).winRate).toBeNull();
  expect(calculate(null).drawdown).toBeNull();
  expect(
    calculate(history([], { complete: false }), {
      observations: [
        point('2026-10-11T10:00:00Z', 1000),
        point('2026-10-11T11:00:00Z', 1100),
      ],
    }).adjustedReturn,
  ).toBeNull();
});

test('win rate and daily count cover all closed positions beyond the table limit', () => {
  const deals: TerminalDeal[] = [];
  for (let i = 0; i < 60; i++) {
    deals.push(
      deal({
        id: `entry${i}`,
        positionId: `position${i}`,
        type: 0,
        entry: 0,
        volume: 1,
        price: 100,
        profit: 0,
      }),
    );
    deals.push(
      deal({
        id: `exit${i}`,
        positionId: `position${i}`,
        type: 1,
        entry: 1,
        volume: 1,
        price: 101,
        profit: i % 2 ? -1 : 1,
        at: at + 1,
      }),
    );
  }
  const p = calculate(history(deals));
  expect(p.closedTrades).toHaveLength(50);
  expect(
    calculate(history(deals), { includeAllTrades: true }).closedTrades,
  ).toHaveLength(60);
  expect(p.closedTradeCount).toBe(60);
  expect(p.tradesToday).toBe(60);
  expect(p.winRate).toBe(50);
});
