import { db, schema } from '@trade/database';
import { and, asc, eq } from 'drizzle-orm';
import { MT5Bridge } from '@trade/broker';
import type { AccountInfo, Position } from '@trade/shared';
import { calculatePerformance } from './performance-calculation';

const bridge = new MT5Bridge(
  process.env.MT5_BRIDGE_DIR ? { directory: process.env.MT5_BRIDGE_DIR } : {},
);
const timezone = process.env.REPORT_TIMEZONE ?? 'America/Sao_Paulo';
new Intl.DateTimeFormat('en', { timeZone: timezone });

export async function getPerformance(
  account: AccountInfo,
  positions: Position[],
  connected: boolean,
) {
  const [beat, candidate, symbols] = await Promise.all([
    bridge.heartbeat(),
    bridge.history(),
    bridge.symbols(),
  ]);
  const accountMatches = beat && String(beat.login) === account.id;
  const fresh =
    connected && accountMatches && Date.now() - beat.ts * 1000 < 15000;
  const updatedAt = accountMatches
    ? new Date(beat.ts * 1000).toISOString()
    : null;
  const history =
    candidate?.accountId === account.id &&
    candidate.server === beat?.server &&
    candidate.currency === account.currency
      ? candidate
      : null;
  const accountKey = `${beat?.server ?? 'unknown'}:${account.id}`;
  if (fresh) {
    const observedAt = new Date(beat.ts * 1000);
    const bucket = new Date(Math.floor(observedAt.getTime() / 60000) * 60000);
    await db
      .insert(schema.accountObservations)
      .values({
        accountId: accountKey,
        currency: account.currency,
        bucket,
        observedAt,
        balance: String(account.balance),
        equity: String(account.equity),
      })
      .onConflictDoNothing();
  }
  const rows = await db
    .select()
    .from(schema.accountObservations)
    .where(
      and(
        eq(schema.accountObservations.accountId, accountKey),
        eq(schema.accountObservations.currency, account.currency),
      ),
    )
    .orderBy(asc(schema.accountObservations.observedAt));
  const observations = rows.map((row) => ({
    at: row.observedAt.toISOString(),
    balance: Number(row.balance),
    equity: Number(row.equity),
  }));
  if (fresh && observations.at(-1)?.at !== updatedAt)
    observations.push({
      at: updatedAt!,
      balance: account.balance,
      equity: account.equity,
    });
  return calculatePerformance({
    account,
    positions,
    symbols,
    history,
    observations,
    updatedAt,
    timezone,
  });
}
