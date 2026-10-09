import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  jsonb,
  boolean,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').defaultRandom().primaryKey();
const created = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const money = (name: string) => numeric(name, { precision: 20, scale: 8 });
export const users = pgTable('users', {
  id: id(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: created(),
});
export const strategies = pgTable('strategies', {
  id: id(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  enabled: boolean('enabled').default(true).notNull(),
  allowedSymbols: jsonb('allowed_symbols')
    .$type<string[]>()
    .default(['XAUUSD'])
    .notNull(),
  maxLot: money('max_lot'),
  riskPercentage: money('risk_percentage'),
  maxDailyTrades: integer('max_daily_trades'),
  maxDailyLoss: money('max_daily_loss'),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const tradingSignals = pgTable('trading_signals', {
  id: id(),
  signalId: varchar('signal_id', { length: 160 }).notNull().unique(),
  strategy: varchar('strategy', { length: 100 }).notNull(),
  symbol: varchar('symbol', { length: 30 }).notNull(),
  action: varchar('action', { length: 20 }).notNull(),
  orderType: varchar('order_type', { length: 20 }).notNull(),
  lots: money('lots'),
  stopLoss: money('stop_loss'),
  takeProfit: money('take_profit'),
  price: money('price'),
  timeframe: varchar('timeframe', { length: 20 }),
  status: varchar('status', { length: 20 }).default('RECEIVED').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  validationCompletedAt: timestamp('validation_completed_at', {
    withTimezone: true,
  }),
  riskValidationCompletedAt: timestamp('risk_validation_completed_at', {
    withTimezone: true,
  }),
  brokerRequestSentAt: timestamp('broker_request_sent_at', {
    withTimezone: true,
  }),
  brokerConfirmationReceivedAt: timestamp('broker_confirmation_received_at', {
    withTimezone: true,
  }),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
  webhookProcessingMs: integer('webhook_processing_ms'),
  riskProcessingMs: integer('risk_processing_ms'),
  brokerLatencyMs: integer('broker_latency_ms'),
  totalExecutionMs: integer('total_execution_ms'),
});
export const orders = pgTable('orders', {
  id: id(),
  signalId: uuid('signal_id').references(() => tradingSignals.id),
  clientOrderId: varchar('client_order_id', { length: 300 }).notNull().unique(),
  brokerOrderId: varchar('broker_order_id', { length: 120 }),
  symbol: varchar('symbol', { length: 30 }).notNull(),
  side: varchar('side', { length: 8 }).notNull(),
  type: varchar('type', { length: 20 }).default('MARKET').notNull(),
  lots: money('lots').notNull(),
  requestedPrice: money('requested_price'),
  executedPrice: money('executed_price'),
  slippage: money('slippage'),
  stopLoss: money('stop_loss'),
  takeProfit: money('take_profit'),
  status: varchar('status', { length: 24 }).notNull(),
  latencyMs: integer('latency_ms'),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const positions = pgTable('positions', {
  id: id(),
  brokerPositionId: varchar('broker_position_id', { length: 120 })
    .notNull()
    .unique(),
  symbol: varchar('symbol', { length: 30 }).notNull(),
  side: varchar('side', { length: 8 }).notNull(),
  lots: money('lots').notNull(),
  entryPrice: money('entry_price').notNull(),
  currentPrice: money('current_price'),
  unrealizedPnl: money('unrealized_pnl'),
  stopLoss: money('stop_loss'),
  takeProfit: money('take_profit'),
  status: varchar('status', { length: 12 }).default('OPEN').notNull(),
  openedAt: created(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});
export const trades = pgTable('trades', {
  id: id(),
  positionId: uuid('position_id').references(() => positions.id),
  symbol: varchar('symbol', { length: 30 }).notNull(),
  side: varchar('side', { length: 8 }).notNull(),
  lots: money('lots').notNull(),
  entryPrice: money('entry_price').notNull(),
  exitPrice: money('exit_price').notNull(),
  pnl: money('pnl').notNull(),
  closedAt: created(),
});
export const brokerAccounts = pgTable('broker_accounts', {
  id: id(),
  provider: varchar('provider', { length: 30 }).notNull(),
  externalId: varchar('external_id', { length: 120 }).notNull(),
  mode: varchar('mode', { length: 10 }).notNull(),
  createdAt: created(),
});
export const riskSettings = pgTable('risk_settings', {
  id: id(),
  key: varchar('key', { length: 40 }).default('default').notNull().unique(),
  accountId: uuid('account_id').references(() => brokerAccounts.id),
  autoTradingEnabled: boolean('auto_trading_enabled').default(false).notNull(),
  emergencyStop: boolean('emergency_stop').default(false).notNull(),
  maximumLotSize: money('maximum_lot_size').default('0.01').notNull(),
  minimumLotSize: money('minimum_lot_size'),
  maximumOpenPositions: integer('maximum_open_positions').default(1).notNull(),
  maximumPositionsPerSymbol: integer('maximum_positions_per_symbol')
    .default(1)
    .notNull(),
  maximumDailyLoss: money('maximum_daily_loss'),
  maximumDailyTrades: integer('maximum_daily_trades'),
  maximumExposure: money('maximum_exposure'),
  maximumMarginUsagePercentage: money('maximum_margin_usage_percentage'),
  allowedSymbols: jsonb('allowed_symbols')
    .$type<string[]>()
    .default(['XAUUSD'])
    .notNull(),
  blockedSymbols: jsonb('blocked_symbols')
    .$type<string[]>()
    .default([])
    .notNull(),
  requireStopLoss: boolean('require_stop_loss').default(true).notNull(),
  minimumStopDistance: money('minimum_stop_distance'),
  maximumStopDistance: money('maximum_stop_distance'),
  positionPolicy: varchar('position_policy', { length: 40 })
    .default('ONE_POSITION_PER_SYMBOL')
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    category: varchar('category', { length: 20 }).notNull(),
    event: varchar('event', { length: 100 }).notNull(),
    requestId: varchar('request_id', { length: 100 }),
    ip: varchar('ip', { length: 100 }),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: created(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt)],
);
export const systemEvents = pgTable(
  'system_events',
  {
    id: id(),
    type: varchar('type', { length: 100 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: created(),
  },
  (t) => [index('events_created_idx').on(t.createdAt)],
);
export const webhookNonces = pgTable('webhook_nonces', {
  nonce: varchar('nonce', { length: 128 }).primaryKey(),
  receivedAt: created(),
});
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: varchar('key', { length: 200 }).primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
  },
  (t) => [uniqueIndex('rate_key_idx').on(t.key)],
);
