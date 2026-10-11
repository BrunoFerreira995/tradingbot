import type {
  AccountInfo,
  CapitalPoint,
  PerformanceData,
  Position,
  TerminalDeal,
  TerminalHistory,
} from '@trade/shared';
import type { BridgeSymbolState } from '@trade/broker';

const net = (d: TerminalDeal) => d.profit + d.commission + d.swap + d.fee;
const adjustment = (d: TerminalDeal) => [3, 5, 6].includes(d.type);
const flow = (d: TerminalDeal) => d.type === 2 || adjustment(d);
const sample = <T>(points: T[]): T[] =>
  points.length <= 600
    ? points
    : Array.from(
        { length: 600 },
        (_, i) => points[Math.round((i * (points.length - 1)) / 599)]!,
      );
const key = (at: number, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  return ['year', 'month', 'day']
    .map((name) => parts.find((p) => p.type === name)!.value)
    .join('-');
};

export function modifiedDietz(
  points: CapitalPoint[],
  deals: TerminalDeal[],
): number | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points.at(-1)!;
  const start = Date.parse(first.at),
    end = Date.parse(last.at);
  if (end <= start) return null;
  const flows = deals.filter(
    (d) => flow(d) && d.at * 1000 > start && d.at * 1000 <= end,
  );
  const total = flows.reduce((sum, d) => sum + net(d), 0);
  const weighted = flows.reduce(
    (sum, d) => sum + (net(d) * (end - d.at * 1000)) / (end - start),
    0,
  );
  const capital = first.equity + weighted;
  return capital > 0
    ? ((last.equity - first.equity - total) / capital) * 100
    : null;
}

export function calculatePerformance(input: {
  account: AccountInfo;
  positions: Position[];
  symbols: Record<string, BridgeSymbolState>;
  history: TerminalHistory | null;
  observations: CapitalPoint[];
  updatedAt: string | null;
  timezone: string;
  now?: number;
}): PerformanceData {
  const {
    account,
    positions,
    symbols,
    history,
    observations,
    updatedAt,
    timezone,
  } = input;
  const now = input.now ?? Date.now();
  const deals = [...(history?.deals ?? [])].sort(
    (a, b) => a.at - b.at || a.id.localeCompare(b.id),
  );
  const available = history !== null;
  const today = key(now, timezone),
    month = today.slice(0, 7);
  const trading = deals.filter((d) => !flow(d));
  const deposits = deals
    .filter((d) => d.type === 2 && net(d) > 0)
    .reduce((sum, d) => sum + net(d), 0);
  const withdrawals = -deals
    .filter((d) => d.type === 2 && net(d) < 0)
    .reduce((sum, d) => sum + net(d), 0);
  const adjustments = deals
    .filter(adjustment)
    .reduce((sum, d) => sum + net(d), 0);
  const curve = [...observations].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  // Cash-neutral equity prevents a withdrawal from creating a false drawdown.
  let peak = -Infinity,
    maxAmount = 0,
    maxPercent = 0,
    amount = 0,
    percent = 0;
  const start = curve[0] ? Date.parse(curve[0].at) : now;
  let cash = 0,
    flowIndex = 0;
  const cashEvents = deals.filter((d) => flow(d) && d.at * 1000 > start);
  for (const point of curve) {
    while (
      flowIndex < cashEvents.length &&
      cashEvents[flowIndex]!.at * 1000 <= Date.parse(point.at)
    )
      cash += net(cashEvents[flowIndex++]!);
    const wealth = point.equity - cash;
    peak = Math.max(peak, wealth);
    amount = Math.max(0, peak - wealth);
    percent = peak > 0 ? (amount / peak) * 100 : 0;
    maxAmount = Math.max(maxAmount, amount);
    maxPercent = Math.max(maxPercent, percent);
  }
  // Reconstruct balance backwards from terminal balance; credit affects equity,
  // not ACCOUNT_BALANCE. Historical equity cannot be reconstructed from deals.
  let balance =
    account.balance -
    deals.filter((d) => d.type !== 3).reduce((sum, d) => sum + net(d), 0);
  const balanceCurve = deals.map((d) => {
    if (d.type !== 3) balance += net(d);
    return { at: new Date(d.at * 1000).toISOString(), balance };
  });
  const grouped = new Map<string, TerminalDeal[]>();
  for (const d of deals.filter(
    (d) => (d.type === 0 || d.type === 1) && d.positionId !== '0',
  )) {
    const list = grouped.get(d.positionId) ?? [];
    list.push(d);
    grouped.set(d.positionId, list);
  }
  const open = new Set(history?.openPositionIds ?? []);
  const closedTrades: PerformanceData['closedTrades'] = [];
  for (const [id, list] of grouped) {
    const entries = list.filter((d) => d.entry === 0);
    const exits = list.filter((d) => d.entry === 1 || d.entry === 3);
    const entryLots = entries.reduce((sum, d) => sum + d.volume, 0);
    const exitLots = exits.reduce((sum, d) => sum + d.volume, 0);
    // Netting reversals need leg allocation; never fabricate a closed trade.
    if (
      open.has(id) ||
      list.some((d) => d.entry === 2) ||
      !entryLots ||
      Math.abs(entryLots - exitLots) > 1e-6
    )
      continue;
    closedTrades.push({
      id,
      symbol: entries[0]!.symbol,
      side: entries[0]!.type === 0 ? 'BUY' : 'SELL',
      lots: exitLots,
      entryPrice:
        entries.reduce((sum, d) => sum + d.price * d.volume, 0) / entryLots,
      exitPrice:
        exits.reduce((sum, d) => sum + d.price * d.volume, 0) / exitLots,
      pnl: list.reduce((sum, d) => sum + net(d), 0),
      closedAt: new Date(exits.at(-1)!.at * 1000).toISOString(),
    });
  }
  closedTrades.sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt));
  const exposure = new Map<string, PerformanceData['exposure'][number]>();
  for (const p of positions) {
    const row = exposure.get(p.symbol) ?? {
      symbol: p.symbol,
      lots: 0,
      stopRisk: 0,
      missingStops: 0,
    };
    row.lots += p.lots;
    const symbol = symbols[p.symbol];
    const tickValue = symbol?.tickValueLoss ?? symbol?.tickValue;
    if (!p.stopLoss || !symbol?.tickSize || !tickValue || tickValue <= 0) {
      row.stopRisk = null;
      if (!p.stopLoss) row.missingStops++;
    } else if (row.stopRisk !== null) {
      const distance =
        p.side === 'BUY'
          ? p.currentPrice - p.stopLoss
          : p.stopLoss - p.currentPrice;
      row.stopRisk +=
        (Math.max(0, distance) / symbol.tickSize) * tickValue * p.lots;
    }
    exposure.set(p.symbol, row);
  }
  const exposureRows = [...exposure.values()];
  const wins = closedTrades.filter((t) => t.pnl > 0).length,
    losses = closedTrades.filter((t) => t.pnl < 0).length;
  return {
    currency: account.currency,
    timezone,
    updatedAt,
    historyUpdatedAt: history
      ? new Date(history.updatedAt * 1000).toISOString()
      : null,
    historyAvailable: available,
    historyComplete: history?.complete ?? false,
    observedSince: curve[0]?.at ?? null,
    curve: sample(curve),
    balanceCurve: sample(balanceCurve),
    deposits: available ? deposits : null,
    withdrawals: available ? withdrawals : null,
    adjustments: available ? adjustments : null,
    netDaily: available
      ? trading
          .filter((d) => key(d.at * 1000, timezone) === today)
          .reduce((sum, d) => sum + net(d), 0)
      : null,
    netMonthly: available
      ? trading
          .filter((d) => key(d.at * 1000, timezone).startsWith(month))
          .reduce((sum, d) => sum + net(d), 0)
      : null,
    netTotal: available ? trading.reduce((sum, d) => sum + net(d), 0) : null,
    commission: available
      ? deals.reduce((sum, d) => sum + d.commission, 0)
      : null,
    swap: available ? deals.reduce((sum, d) => sum + d.swap, 0) : null,
    fees: available ? deals.reduce((sum, d) => sum + d.fee, 0) : null,
    adjustedReturn:
      available && history.complete ? modifiedDietz(curve, deals) : null,
    drawdown:
      available && history.complete && curve.length
        ? { amount, percent, maxAmount, maxPercent }
        : null,
    marginUsed: account.usedMargin,
    marginPercent:
      account.equity > 0 ? (account.usedMargin / account.equity) * 100 : null,
    stopRisk: exposureRows.some((row) => row.stopRisk === null)
      ? null
      : exposureRows.reduce((sum, row) => sum + row.stopRisk!, 0),
    exposure: exposureRows,
    closedTradeCount: closedTrades.length,
    tradesToday: closedTrades.filter(
      (t) => key(Date.parse(t.closedAt), timezone) === today,
    ).length,
    closedTrades: closedTrades.slice(0, 50),
    winRate:
      available && closedTrades.length
        ? (wins / closedTrades.length) * 100
        : null,
    wins,
    losses,
  };
}
