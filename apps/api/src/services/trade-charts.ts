import type { BrokerAdapter } from '@trade/broker';
import type {
  AccountInfo,
  Position,
  Rate,
  Timeframe,
  TradeMetadata,
} from '@trade/shared';
import { isTimeframe } from '@trade/shared';
import { getPerformance } from './performance';
import { exportTradeMetadata } from './trade-telemetry';

const timeframeSeconds: Record<Timeframe, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
  W1: 604800,
  MN1: 2592000,
};

const PAD_BARS = 20;
const MAX_CANDLES = 240;
const MAX_COUNT = 5000;

export interface TradeChart {
  id: string;
  symbol: string;
  side: string;
  lots: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  openedAt: string;
  closedAt: string;
  timeframe: Timeframe;
  tradeTimeframe: Timeframe;
  stopLoss?: number;
  takeProfit?: number;
  closeReason?: string;
  signalReason?: string;
  entryTime: number;
  exitTime: number;
  covered: boolean;
  candles: Rate[];
}

export interface TradeChartsResult {
  trades: TradeChart[];
  timeframe?: Timeframe;
  detail?: string;
}

type ClosedTrade = Awaited<
  ReturnType<typeof getPerformance>
>['closedTrades'][number];

interface ChartRequest {
  trade: ClosedTrade;
  tradeTimeframe: Timeframe;
  timeframe: Timeframe;
  openedAt: string;
  entryTime: number;
  exitTime: number;
  from: number;
  to: number;
  stopLoss?: number;
  takeProfit?: number;
  closeReason?: string;
  signalReason?: string;
}

function chartWindow(
  bars: ReadonlyArray<Rate>,
  from: number,
  to: number,
  tfSeconds: number,
): Rate[] {
  const pad = PAD_BARS * tfSeconds;
  let window = bars.filter((bar) => bar.t >= from - pad && bar.t <= to + pad);
  // Never fall back to the newest bars: they can sit after the trade and would
  // draw a chart that has nothing to do with the levels being reviewed.
  if (!window.length) return [];
  if (window.length > MAX_CANDLES) {
    const step = (window.length - 1) / (MAX_CANDLES - 1);
    window = Array.from(
      { length: MAX_CANDLES },
      (_, index) => window[Math.round(index * step)]!,
    );
  }
  return window;
}

function positivePrice(...values: Array<number | undefined>) {
  return values.find(
    (value) => value !== undefined && Number.isFinite(value) && value > 0,
  );
}

function mergeMetadata(trade: ClosedTrade, meta: TradeMetadata | undefined) {
  const tradeTimeframe =
    meta?.timeframe && isTimeframe(meta.timeframe) ? meta.timeframe : 'H1';
  return {
    trade,
    tradeTimeframe,
    openedAt: trade.openedAt ?? meta?.openedAt ?? trade.closedAt,
    stopLoss: positivePrice(trade.initialSl, meta?.initialSl),
    takeProfit: positivePrice(trade.initialTp, meta?.initialTp),
    closeReason: trade.closeReason ?? meta?.closeReason,
    signalReason: meta?.signalReason,
  };
}

/**
 * Builds the candles and levels needed to review the most recent closed trades.
 *
 * The chart timeframe is either forced by the caller or taken from each trade's
 * context, with H1 as a fallback. When the adapter can serve a timestamp range,
 * the candles are fetched around the trade itself, so old trades render at every
 * timeframe. Otherwise the newest bars are fetched and `covered` reports whether
 * they still reach the entry.
 */
export async function getTradeCharts(input: {
  broker: BrokerAdapter;
  account: AccountInfo;
  positions: Position[];
  connected: boolean;
  limit?: number;
  timeframe?: Timeframe;
}): Promise<TradeChartsResult> {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 10);
  const performance = await getPerformance(
    input.account,
    input.positions,
    input.connected,
    true,
  );
  if (!performance.historyAvailable)
    return { trades: [], detail: 'MT5 history is unavailable' };

  // Deals are stored in GMT but MT5 candles carry the broker server clock, so
  // the rate window must be requested on the server clock and then shifted back
  // to GMT. Otherwise the entry marker lands a few bars off the real candle.
  const serverOffsetSeconds = performance.serverOffsetSeconds;

  const metadata = await exportTradeMetadata(
    input.account.id,
    input.account.currency,
  ).catch(() => new Map<string, TradeMetadata>());

  const requests: ChartRequest[] = [];
  for (const trade of performance.closedTrades.slice(0, limit)) {
    const opened = Date.parse(trade.openedAt ?? trade.closedAt);
    const closed = Date.parse(trade.closedAt);
    if (!Number.isFinite(opened) || !Number.isFinite(closed)) continue;
    const merged = mergeMetadata(trade, metadata.get(trade.id));
    const timeframe = input.timeframe ?? merged.tradeTimeframe;
    const tfSeconds = timeframeSeconds[timeframe];
    const openedAt = Math.floor(opened / 1000);
    const closedAt = Math.floor(closed / 1000);
    requests.push({
      ...merged,
      timeframe,
      entryTime: openedAt,
      exitTime: closedAt,
      from: openedAt + serverOffsetSeconds - PAD_BARS * tfSeconds,
      to: closedAt + serverOffsetSeconds + PAD_BARS * tfSeconds,
    });
  }

  const groups = new Map<
    string,
    { symbol: string; timeframe: Timeframe; from: number; to: number }
  >();
  for (const request of requests) {
    const key = `${request.trade.symbol}:${request.timeframe}`;
    const current = groups.get(key);
    if (!current)
      groups.set(key, {
        symbol: request.trade.symbol,
        timeframe: request.timeframe,
        from: request.from,
        to: request.to,
      });
    else {
      current.from = Math.min(current.from, request.from);
      current.to = Math.max(current.to, request.to);
    }
  }

  const useRange = typeof input.broker.getRatesRange === 'function';
  const barsByKey = new Map<string, Rate[]>();
  await Promise.all(
    [...groups.entries()].map(async ([key, group]) => {
      const tfSeconds = timeframeSeconds[group.timeframe];
      try {
        if (useRange) {
          barsByKey.set(
            key,
            await input.broker.getRatesRange!(
              group.symbol,
              group.timeframe,
              group.from,
              group.to,
            ),
          );
        } else {
          const now = Math.floor(Date.now() / 1000);
          const needed = Math.ceil((now - group.from) / tfSeconds) + 10;
          const count = Math.min(Math.max(needed, 60), MAX_COUNT);
          barsByKey.set(
            key,
            await input.broker.getRates(group.symbol, group.timeframe, count),
          );
        }
      } catch {
        barsByKey.set(key, []);
      }
    }),
  );

  const trades: TradeChart[] = [];
  for (const request of requests) {
    const bars =
      barsByKey.get(`${request.trade.symbol}:${request.timeframe}`) ?? [];
    const tfSeconds = timeframeSeconds[request.timeframe];
    const candles = chartWindow(
      bars,
      request.from,
      request.to,
      tfSeconds,
    ).map((bar) =>
      serverOffsetSeconds ? { ...bar, t: bar.t - serverOffsetSeconds } : bar,
    );
    const entryServer = request.entryTime + serverOffsetSeconds;
    const exitServer = request.exitTime + serverOffsetSeconds;
    const covered =
      bars.length > 0 &&
      bars[0]!.t <= entryServer &&
      bars.at(-1)!.t + tfSeconds >= exitServer;
    trades.push({
      id: request.trade.id,
      symbol: request.trade.symbol,
      side: request.trade.side,
      lots: request.trade.lots,
      entryPrice: request.trade.entryPrice,
      exitPrice: request.trade.exitPrice,
      pnl: request.trade.pnl,
      openedAt: request.openedAt,
      closedAt: request.trade.closedAt,
      timeframe: request.timeframe,
      tradeTimeframe: request.tradeTimeframe,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      closeReason: request.closeReason,
      signalReason: request.signalReason,
      entryTime: request.entryTime,
      exitTime: request.exitTime,
      covered,
      candles,
    });
  }

  return { trades, timeframe: input.timeframe };
}
