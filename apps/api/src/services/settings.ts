import {
  marketWindows,
  validateMarketWindows,
  type MarketWindow,
} from './market-session';
import { db, schema } from '@trade/database';
import { eq } from 'drizzle-orm';
import type { RiskSettings } from '@trade/trading';
const bool = (value: string | undefined) => value === 'true';
export async function getSettings(): Promise<
  RiskSettings & {
    id: string;
    marketSessions: MarketWindow[];
    invertIncomingSignals: boolean;
  }
> {
  let row = await db.query.riskSettings.findFirst();
  if (!row) {
    await db
      .insert(schema.riskSettings)
      .values({
        autoTradingEnabled: bool(process.env.AUTO_TRADING_ENABLED),
        emergencyStop: bool(process.env.EMERGENCY_STOP),
        invertIncomingSignals: bool(process.env.INVERT_INCOMING_SIGNALS),
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
    marketSessions: row.marketSessions ?? marketWindows,
    autoTradingEnabled: row.autoTradingEnabled,
    invertIncomingSignals: row.invertIncomingSignals,
    closeOnOppositeSignal: bool(process.env.CLOSE_ON_OPPOSITE_SIGNAL),
    emergencyStop: row.emergencyStop,
    maximumLotSize: Number(row.maximumLotSize),
    minimumLotSize: Number(row.minimumLotSize ?? 0.01),
    maximumOpenPositions: row.maximumOpenPositions,
    reservedPositionSymbols: [
      ...new Set(
        (process.env.RESERVED_POSITION_SYMBOLS ?? '')
          .split(',')
          .map((symbol) => symbol.trim())
          .filter(Boolean),
      ),
    ],
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
    stopRiskAmount:
      row.stopRiskAmount === null ? null : Number(row.stopRiskAmount),
    stopRiskCurrency: row.stopRiskCurrency,
    stopRiskByCurrency: row.stopRiskByCurrency ?? {},
    stopRiskBySymbol: row.stopRiskBySymbol ?? {},
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
      | 'maximumDailyTrades'
      | 'stopRiskAmount'
      | 'stopRiskCurrency'
    >
  > & {
    marketSessions?: MarketWindow[];
    invertIncomingSignals?: boolean;
    stopRiskBySymbol?: Record<string, number | null>;
  },
) {
  if (patch.marketSessions !== undefined)
    validateMarketWindows(patch.marketSessions);
  const current = await getSettings();
  const byCurrency = { ...current.stopRiskByCurrency };
  if (
    current.stopRiskAmount != null &&
    current.stopRiskCurrency &&
    !Object.prototype.hasOwnProperty.call(byCurrency, current.stopRiskCurrency)
  )
    byCurrency[current.stopRiskCurrency] = current.stopRiskAmount;
  if (patch.stopRiskAmount !== undefined && patch.stopRiskCurrency)
    byCurrency[patch.stopRiskCurrency] = patch.stopRiskAmount;
  const bySymbol = { ...(current.stopRiskBySymbol ?? {}) };
  if (patch.stopRiskBySymbol !== undefined) {
    const currency = patch.stopRiskCurrency ?? current.stopRiskCurrency;
    if (!currency)
      throw new Error('Monetary stop currency required for symbol overrides');
    bySymbol[currency] = { ...patch.stopRiskBySymbol };
  }
  await db
    .update(schema.riskSettings)
    .set({
      ...patch,
      stopRiskAmount:
        patch.stopRiskAmount === undefined
          ? undefined
          : patch.stopRiskAmount === null
            ? null
            : String(patch.stopRiskAmount),
      stopRiskByCurrency: byCurrency,
      stopRiskBySymbol: bySymbol,
      updatedAt: new Date(),
    })
    .where(eq(schema.riskSettings.id, current.id));
  return getSettings();
}
