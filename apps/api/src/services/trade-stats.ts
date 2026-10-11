import { db, schema } from '@trade/database';
import { sql } from 'drizzle-orm';

export function completedTradeStats(
  total: number,
  wins: number,
  losses: number,
) {
  return {
    closedTrades: total,
    winningTrades: wins,
    losingTrades: losses,
    winRate: total > 0 ? (wins / total) * 100 : null,
  };
}

export async function getTradeStats() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const since = today.toISOString();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${schema.trades.pnl} > 0)::int`,
      losses: sql<number>`count(*) filter (where ${schema.trades.pnl} < 0)::int`,
      dailyPnl: sql<number>`coalesce(sum(${schema.trades.pnl}) filter (where ${schema.trades.closedAt} >= ${since}::timestamptz), 0)::float8`,
      tradesToday: sql<number>`count(*) filter (where ${schema.trades.closedAt} >= ${since}::timestamptz)::int`,
    })
    .from(schema.trades);
  return {
    ...completedTradeStats(row!.total, row!.wins, row!.losses),
    dailyPnl: row!.dailyPnl,
    tradesToday: row!.tradesToday,
  };
}
