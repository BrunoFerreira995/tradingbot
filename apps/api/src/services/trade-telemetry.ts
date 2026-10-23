import { db, schema } from '@trade/database';
import { and, asc, eq, sql } from 'drizzle-orm';
import { MT5Bridge } from '@trade/broker';
import { marketSession, type MarketWindow } from './market-session';
import type { Position, TradeMetadata, TerminalHistory } from '@trade/shared';

const bridge = new MT5Bridge(
  process.env.MT5_BRIDGE_DIR ? { directory: process.env.MT5_BRIDGE_DIR } : {},
);
export { botSessionId as tradeSessionId } from './bot-session';
export interface TradeContext extends TradeMetadata {
  accountId: string;
  server: string;
  brokerPositionId?: string;
  entryOrderId?: string;
  entryPrice?: number;
  lots?: number;
  tickSize?: number;
  tickValue?: number;
  tickValueLoss?: number;
  excursionClosedAt?: string;
  marketSessionWindows?: MarketWindow[];
}

export async function tradeServer(
  accountId: string,
): Promise<string | undefined> {
  const beat = await bridge.heartbeat();
  return beat && String(beat.login) === accountId ? beat.server : undefined;
}

export function sampledExcursions(context: TradeContext, position: Position) {
  if (position.grossPnl !== undefined && Number.isFinite(position.grossPnl))
    return {
      maxFavorableExcursion: Math.max(
        context.maxFavorableExcursion ?? 0,
        position.grossPnl,
      ),
      maxAdverseExcursion: Math.max(
        context.maxAdverseExcursion ?? 0,
        -position.grossPnl,
      ),
    };
  if (
    !context.tickSize ||
    context.tickSize <= 0 ||
    context.tickValue === undefined ||
    context.tickValue <= 0 ||
    context.entryPrice === undefined ||
    context.lots === undefined
  )
    return undefined;
  let amount =
    (((position.currentPrice - context.entryPrice) *
      (position.side === 'BUY' ? 1 : -1)) /
      context.tickSize) *
    context.tickValue *
    context.lots;
  if (amount < 0 && context.tickValueLoss !== undefined) {
    if (context.tickValueLoss <= 0) return undefined;
    amount = (amount / context.tickValue) * context.tickValueLoss;
  }
  if (!Number.isFinite(amount)) return undefined;
  return {
    maxFavorableExcursion: Math.max(context.maxFavorableExcursion ?? 0, amount),
    maxAdverseExcursion: Math.max(context.maxAdverseExcursion ?? 0, -amount),
  };
}

async function contexts(accountId: string, server: string, activeOnly = false) {
  return db
    .select({
      id: schema.tradingSignals.id,
      payload: schema.tradingSignals.rawPayload,
    })
    .from(schema.tradingSignals)
    .where(
      and(
        sql`${schema.tradingSignals.rawPayload}->'tradeContext'->>'brokerPositionId' IS NOT NULL`,
        sql`${schema.tradingSignals.rawPayload}->'tradeContext'->>'accountId' = ${accountId}`,
        sql`${schema.tradingSignals.rawPayload}->'tradeContext'->>'server' = ${server}`,
        ...(activeOnly
          ? [
              sql`${schema.tradingSignals.rawPayload}->'tradeContext'->>'excursionClosedAt' IS NULL`,
            ]
          : []),
      ),
    )
    .orderBy(asc(schema.tradingSignals.receivedAt));
}

export async function observeTradeExcursions(
  accountId: string,
  positions: Position[],
) {
  const server = await tradeServer(accountId);
  if (!server) return;
  const candidate = await bridge.history();
  const history =
    candidate?.accountId === accountId && candidate.server === server
      ? candidate
      : null;
  const byOrder = new Map<string, string>();
  const dealsByPosition = new Map<string, TerminalHistory['deals']>();
  for (const deal of history?.deals ?? []) {
    if (deal.type !== 0 && deal.type !== 1) continue;
    if (deal.orderId && deal.entry === 0)
      byOrder.set(deal.orderId, deal.positionId);
    const list = dealsByPosition.get(deal.positionId) ?? [];
    list.push(deal);
    dealsByPosition.set(deal.positionId, list);
  }
  const open = new Map(positions.map((p) => [p.id, p]));
  const terminalOpen = new Set(history?.openPositionIds ?? []);
  for (const row of await contexts(accountId, server, true)) {
    const context = row.payload.tradeContext as TradeContext;
    const openPosition = context.brokerPositionId
      ? open.get(context.brokerPositionId)
      : undefined;
    const identifier = context.entryOrderId
      ? byOrder.get(context.entryOrderId)
      : undefined;
    const deals = identifier ? (dealsByPosition.get(identifier) ?? []) : [];
    const point = tradeExcursionPoint(
      context,
      openPosition,
      deals,
      !identifier || terminalOpen.has(identifier),
    );
    if (!point) continue;
    const { position, closedAt } = point;
    if (!position) continue;
    const next = sampledExcursions(context, position);
    if (!next) continue;
    const observation = {
      ...next,
      excursionObservedFrom:
        context.excursionObservedFrom ?? closedAt ?? new Date().toISOString(),
      excursionObservedUntil: closedAt ?? new Date().toISOString(),
      ...(closedAt ? { excursionClosedAt: closedAt } : {}),
    };
    // Only amend the context so concurrent signal outcome updates are preserved.
    await db
      .update(schema.tradingSignals)
      .set({
        rawPayload: sql`jsonb_set(${schema.tradingSignals.rawPayload}, '{tradeContext}', (${schema.tradingSignals.rawPayload}->'tradeContext') || ${JSON.stringify(observation)}::jsonb || jsonb_build_object(
          'maxFavorableExcursion', greatest(coalesce((${schema.tradingSignals.rawPayload}->'tradeContext'->>'maxFavorableExcursion')::numeric, 0), ${next.maxFavorableExcursion}),
          'maxAdverseExcursion', greatest(coalesce((${schema.tradingSignals.rawPayload}->'tradeContext'->>'maxAdverseExcursion')::numeric, 0), ${next.maxAdverseExcursion})
        ))`,
      })
      .where(eq(schema.tradingSignals.id, row.id));
  }
}

export async function exportTradeMetadata(accountId: string, currency: string) {
  const server = await tradeServer(accountId);
  const metadata = new Map<string, TradeMetadata>();
  if (!server) return metadata;
  const candidate = await bridge.history();
  const history: TerminalHistory | null =
    candidate?.accountId === accountId &&
    candidate.server === server &&
    candidate.currency === currency
      ? candidate
      : null;
  const entries = new Map<string, NonNullable<typeof history>['deals']>();
  for (const deal of history?.deals ?? []) {
    if (deal.type !== 0 && deal.type !== 1) continue;
    const list = entries.get(deal.positionId) ?? [];
    list.push(deal);
    entries.set(deal.positionId, list);
  }
  for (const [id, deals] of entries) {
    const entry = deals
      .filter((d) => d.entry === 0)
      .sort((a, b) => a.at - b.at)[0];
    metadata.set(id, {
      marketSession: entry ? marketSession(entry.at * 1000) : undefined,
      openedAt: entry ? new Date(entry.at * 1000).toISOString() : undefined,
      commission: deals.reduce((sum, d) => sum + d.commission, 0),
      swap: deals.reduce((sum, d) => sum + d.swap, 0),
      initialSl: entry?.stopLoss,
      initialTp: entry?.takeProfit,
    });
  }
  for (const row of await contexts(accountId, server)) {
    const context = row.payload.tradeContext as TradeContext;
    if (context.brokerPositionId)
      metadata.set(context.brokerPositionId, {
        ...context,
        ...defined(metadata.get(context.brokerPositionId)),
        marketSession:
          context.marketSession ??
          metadata.get(context.brokerPositionId)?.marketSession,
      });
    // Deal position identifiers can differ from current position tickets.
    const entry = history?.deals.find(
      (d) =>
        context.entryOrderId !== undefined &&
        d.entry === 0 &&
        d.orderId === context.entryOrderId,
    );
    if (entry)
      metadata.set(entry.positionId, {
        ...context,
        ...defined(metadata.get(entry.positionId)),
        marketSession: context.marketSessionWindows
          ? marketSession(entry.at * 1000, context.marketSessionWindows)
          : (context.marketSession ??
            metadata.get(entry.positionId)?.marketSession),
      });
  }
  return metadata;
}

function defined(value: TradeMetadata | undefined) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, v]) => v !== undefined),
  );
}

/** Only record a business reason after the terminal confirms the position closed. */
export async function recordTradeClose(
  accountId: string,
  positionId: string,
  reason: string,
) {
  const server = await tradeServer(accountId);
  if (!server) return;
  await db
    .update(schema.tradingSignals)
    .set({
      rawPayload: sql`jsonb_set(${schema.tradingSignals.rawPayload}, '{tradeContext,closeReason}', ${JSON.stringify(reason)}::jsonb)`,
    })
    .where(
      and(
        sql`${schema.tradingSignals.rawPayload}->'tradeContext'->>'accountId' = ${accountId}`,
        sql`${schema.tradingSignals.rawPayload}->'tradeContext'->>'server' = ${server}`,
        sql`${schema.tradingSignals.rawPayload}->'tradeContext'->>'brokerPositionId' = ${positionId}`,
      ),
    );
}

/** Initial stop exposure from the confirmed fill; costs are excluded. */
export function initialRiskAmount(input: {
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss?: number;
  lots: number;
  tickSize: number;
  tickValue: number;
  tickValueLoss?: number;
}): number | undefined {
  const { side, entryPrice, stopLoss, lots, tickSize } = input;
  const tickValue = input.tickValueLoss ?? input.tickValue;
  if (
    stopLoss === undefined ||
    stopLoss <= 0 ||
    lots <= 0 ||
    tickSize <= 0 ||
    tickValue <= 0 ||
    ![entryPrice, stopLoss, lots, tickSize, tickValue].every(Number.isFinite)
  )
    return undefined;
  const distance =
    side === 'BUY' ? entryPrice - stopLoss : stopLoss - entryPrice;
  return (Math.max(0, distance) / tickSize) * tickValue * lots;
}

export function tradeExcursionPoint(
  context: TradeContext,
  position: Position | undefined,
  deals: TerminalHistory['deals'],
  stillOpen: boolean,
): { position: Position; closedAt?: string } | undefined {
  if (deals.some((d) => d.entry === 2)) return undefined;
  if (position)
    return {
      position:
        position.grossPnl === undefined
          ? position
          : {
              ...position,
              grossPnl:
                position.grossPnl + deals.reduce((sum, d) => sum + d.profit, 0),
            },
    };
  if (
    stillOpen ||
    context.entryPrice === undefined ||
    context.lots === undefined
  )
    return undefined;
  const entries = deals.filter((d) => d.entry === 0);
  const exits = deals.filter((d) => d.entry === 1 || d.entry === 3);
  const entryLots = entries.reduce((sum, d) => sum + d.volume, 0);
  const exitLots = exits.reduce((sum, d) => sum + d.volume, 0);
  if (!entryLots || !exits.length || Math.abs(entryLots - exitLots) > 1e-6)
    return undefined;
  const exit = exits.reduce((last, d) => (d.at > last.at ? d : last));
  return {
    closedAt: new Date(exit.at * 1000).toISOString(),
    position: {
      id: context.brokerPositionId ?? '',
      symbol: entries[0]!.symbol,
      side: entries[0]!.type === 0 ? 'BUY' : 'SELL',
      lots: context.lots,
      entryPrice: context.entryPrice,
      currentPrice: exit.price,
      unrealizedPnl: 0,
      grossPnl: deals.reduce((sum, d) => sum + d.profit, 0),
      openedAt: context.openedAt ?? '',
    },
  };
}
