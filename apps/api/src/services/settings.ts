import { db, schema } from '@trade/database';
import { eq } from 'drizzle-orm';
import type { RiskSettings } from '@trade/trading';
const bool = (value: string | undefined) => value === 'true';
export async function getSettings(): Promise<RiskSettings & { id: string }> {
  let row = await db.query.riskSettings.findFirst();
  if (!row) {
    await db
      .insert(schema.riskSettings)
      .values({
        autoTradingEnabled: bool(process.env.AUTO_TRADING_ENABLED),
        emergencyStop: bool(process.env.EMERGENCY_STOP),
        maximumLotSize: process.env.MAX_LOT_SIZE ?? '0.01',
        maximumOpenPositions: Number(process.env.MAX_OPEN_POSITIONS ?? 1),
        maximumDailyLoss: process.env.MAX_DAILY_LOSS || '100',
        maximumDailyTrades: Number(process.env.MAX_DAILY_TRADES ?? 10),
      })
      .onConflictDoNothing();
    row = await db.query.riskSettings.findFirst({
      where: eq(schema.riskSettings.key, 'default'),
    });
  }
  if (!row) throw new Error('Risk settings unavailable');
  return {
    id: row.id,
    autoTradingEnabled: row.autoTradingEnabled,
    emergencyStop: row.emergencyStop,
    maximumLotSize: Number(row.maximumLotSize),
    minimumLotSize: Number(row.minimumLotSize ?? 0.01),
    maximumOpenPositions: row.maximumOpenPositions,
    maximumPositionsPerSymbol: row.maximumPositionsPerSymbol,
    maximumDailyLoss: Number(row.maximumDailyLoss ?? 100),
    maximumDailyTrades: row.maximumDailyTrades ?? 10,
    maximumExposure: Number(row.maximumExposure ?? 100000),
    maximumMarginUsagePercentage: Number(
      row.maximumMarginUsagePercentage ?? 50,
    ),
    allowedSymbols: row.allowedSymbols,
    blockedSymbols: row.blockedSymbols,
    requireStopLoss: row.requireStopLoss,
    minimumStopDistance: Number(row.minimumStopDistance ?? 0.01),
    maximumStopDistance: Number(row.maximumStopDistance ?? 1000),
    positionPolicy: row.positionPolicy as RiskSettings['positionPolicy'],
  };
}
export async function updateSettings(
  patch: Partial<
    Pick<
      RiskSettings,
      | 'autoTradingEnabled'
      | 'emergencyStop'
      | 'positionPolicy'
      | 'allowedSymbols'
      | 'blockedSymbols'
    >
  >,
) {
  const current = await getSettings();
  await db
    .update(schema.riskSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.riskSettings.id, current.id));
  return getSettings();
}
