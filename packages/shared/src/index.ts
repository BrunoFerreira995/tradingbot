import { z } from 'zod';

export const signalSchema = z
  .object({
    secret: z.string().optional(),
    strategy: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/),
    signalId: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9_:.-]+$/),
    symbol: z
      .string()
      .min(1)
      .max(30)
      .regex(/^[A-Z0-9._-]+$/),
    action: z.enum(['BUY', 'SELL', 'CLOSE', 'CLOSE_LONG', 'CLOSE_SHORT']),
    orderType: z.literal('MARKET').default('MARKET'),
    lots: z.number().positive().finite().optional(),
    stopLoss: z.number().positive().finite().optional(),
    takeProfit: z.number().positive().finite().optional(),
    price: z
      .union([
        z.number().positive().finite(),
        z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .transform(Number),
      ])
      .optional(),
    // A webhook timeframe is a label the strategy records, so it stays a string
    // here; anything the bot actually pulls bars for is narrowed by
    // `isTimeframe` before it reaches the service.
    timeframe: z.string().max(20).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.action === 'BUY' || v.action === 'SELL') && !v.lots)
      ctx.addIssue({
        code: 'custom',
        path: ['lots'],
        message: 'Lots required',
      });
  });
export type TradingSignal = z.infer<typeof signalSchema>;
export type Side = 'BUY' | 'SELL';
export type OrderStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'APPROVED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED';
export type SignalStatus =
  | 'RECEIVED'
  | 'VALIDATING'
  | 'REJECTED'
  | 'APPROVED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'FAILED'
  | 'DUPLICATE';
export interface AccountInfo {
  id: string;
  balance: number;
  equity: number;
  freeMargin: number;
  usedMargin: number;
  marginLevel: number;
  currency: string;
}
export interface SymbolInfo {
  symbol: string;
  minLot: number;
  maxLot: number;
  lotStep: number;
  contractSize: number;
  tickValue: number;
  tickSize: number;
  maxSpread: number;
  maxSlippage: number;
  defaultStopLoss: number;
  defaultTakeProfit: number;
  marginRate: number;
  marketOpen: boolean;
  /**
   * Minimum SL/TP distance the broker accepts, already resolved to price units
   * by the bridge (`SYMBOL_TRADE_STOPS_LEVEL * SYMBOL_POINT`).
   *
   * This is what makes stop sizing portable. A floor expressed as an absolute
   * price amount only works for the instrument it was chosen on: 0.01 is a
   * sensible minimum for XAUUSD and larger than a whole percent of USDCHF, so a
   * percent-of-price stop on a sub-1.00 pair is rejected no matter how it is
   * configured.
   */
  stopsLevel: number;
}
export interface MarketPrice {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  at: string;
}
export interface Position {
  id: string;
  symbol: string;
  side: Side;
  lots: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: string;
}
/** One OHLC bar, oldest first. `t` is the bar open time in epoch seconds. */
export interface Rate {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
/**
 * Timeframes use the TradingView spelling so strategy config, the webhook
 * payloads and the Pine alerts all agree on one vocabulary.
 */
export type Timeframe =
  'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN1';

/** Every supported timeframe, for validating configuration at boot. */
export const TIMEFRAMES = [
  'M1',
  'M5',
  'M15',
  'M30',
  'H1',
  'H4',
  'D1',
  'W1',
  'MN1',
] as const satisfies readonly Timeframe[];

/**
 * Narrows an untrusted timeframe string, e.g. from configuration.
 *
 * The cast this replaces was unsound in a way that failed quietly: an unknown
 * value reached the service, which falls back to `PERIOD_CURRENT`, so the bot
 * would silently evaluate the strategy against whatever timeframe a chart
 * happened to be on instead of erroring on a typo.
 */
export function isTimeframe(value: string): value is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(value);
}
export interface Order {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: Side;
  lots: number;
  status: OrderStatus;
  requestedPrice?: number;
  executedPrice?: number;
  createdAt: string;
}
export interface MarketOrderRequest {
  clientOrderId: string;
  symbol: string;
  side: Side;
  lots: number;
  stopLoss?: number;
  takeProfit?: number;
  maxSlippage?: number;
}
export interface OrderResult {
  brokerOrderId: string;
  status: 'FILLED' | 'REJECTED';
  executedPrice?: number;
  positionId?: string;
  /**
   * Realised profit reported by the terminal for a closing deal, in account
   * currency. Preferred over any host-side recomputation because it already
   * includes contract size, currency conversion, commission and swap.
   */
  brokerProfit?: number;
  reason?: string;
  confirmedAt: string;
}
export interface RiskDecision {
  approved: boolean;
  reason?: string;
  lots?: number;
  stopLoss?: number;
  takeProfit?: number;
  /**
   * The stop distance actually used, when it differs from the requested one
   * because the broker's per-instrument minimum was applied. Recorded so a
   * widened stop is visible in the audit trail instead of looking like the
   * strategy's own number.
   */
  stopDistance?: number;
  stopDistanceAdjusted?: boolean;
}
