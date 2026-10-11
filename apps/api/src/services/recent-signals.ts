import { db, schema } from '@trade/database';
import { and, desc, inArray, sql } from 'drizzle-orm';

export function attachSignalReasons<
  T extends { signalId: string; status: string },
>(
  signals: T[],
  outcomes: Array<{ event: string; details: Record<string, unknown> | null }>,
) {
  const latest = new Map<string, { reason: string; reasonSource: string }>();
  for (const { event, details } of outcomes) {
    const signalId = details?.signalId;
    const reason = details?.reason;
    if (
      typeof signalId !== 'string' ||
      typeof reason !== 'string' ||
      latest.has(signalId)
    )
      continue;
    latest.set(signalId, {
      reason,
      reasonSource:
        typeof details?.source === 'string'
          ? details.source
          : reason.startsWith('MetaTrader:')
            ? 'MetaTrader.OrderCheck'
            : event === 'rejected'
              ? 'risk'
              : 'execution',
    });
  }
  return signals.map((signal) => ({
    ...signal,
    ...(['REJECTED', 'FAILED'].includes(signal.status)
      ? latest.get(signal.signalId)
      : undefined),
  }));
}

export async function getRecentSignals() {
  const signals = await db
    .select()
    .from(schema.tradingSignals)
    .orderBy(desc(schema.tradingSignals.receivedAt))
    .limit(50);
  if (!signals.length) return [];
  const outcomes = await db
    .select({
      event: schema.auditLogs.event,
      details: schema.auditLogs.details,
    })
    .from(schema.auditLogs)
    .where(
      and(
        inArray(schema.auditLogs.event, ['rejected', 'failed']),
        inArray(
          sql<string>`${schema.auditLogs.details}->>'signalId'`,
          signals.map((signal) => signal.signalId),
        ),
      ),
    )
    .orderBy(desc(schema.auditLogs.createdAt));
  return attachSignalReasons(signals, outcomes);
}
