import { db, schema, sql } from '@trade/database';
import { and, eq, gte, sql as dsql } from 'drizzle-orm';
import type { BrokerAdapter } from '@trade/broker';
import type {
  TradingSignal,
  SignalStatus,
  Position,
  Side,
  OrderResult,
} from '@trade/shared';
import { OrderManager, PositionManager, RiskManager } from '@trade/trading';
import { audit, emit } from './events';
import { getSettings } from './settings';

export class TradingEngine {
  private risk = new RiskManager();
  private orders: OrderManager;
  private positions: PositionManager;
  /**
   * `accountId` scopes the per-symbol advisory lock. It must be the real broker
   * account id: the lock serialises trade decisions across API instances, and a
   * shared placeholder would serialise unrelated accounts while letting two
   * instances that really are the same account race.
   */
  constructor(
    private broker: BrokerAdapter,
    private accountId = 'unresolved-account',
  ) {
    this.orders = new OrderManager(broker);
    this.positions = new PositionManager(broker);
  }
  async process(
    signal: TradingSignal,
    context: { requestId: string; ip: string; receivedAt: number },
  ) {
    const rawPayload = { ...signal, secret: undefined };
    const inserted = await db
      .insert(schema.tradingSignals)
      .values({
        signalId: signal.signalId,
        strategy: signal.strategy,
        symbol: signal.symbol,
        action: signal.action,
        orderType: signal.orderType,
        lots: signal.lots?.toString(),
        stopLoss: signal.stopLoss?.toString(),
        takeProfit: signal.takeProfit?.toString(),
        price: signal.price ? String(signal.price) : undefined,
        timeframe: signal.timeframe,
        rawPayload,
        webhookProcessingMs: Date.now() - context.receivedAt,
      })
      .onConflictDoNothing()
      .returning();
    const record = inserted[0];
    if (!record) {
      await audit('SIGNAL', 'duplicate', context.requestId, context.ip, {
        signalId: signal.signalId,
      });
      return { status: 'DUPLICATE' as SignalStatus, signalId: signal.signalId };
    }
    await audit('SIGNAL', 'received', context.requestId, context.ip, {
      signalId: signal.signalId,
    });
    await emit('signal.received', { signalId: signal.signalId });
    const lock = await sql.reserve();
    const lockKey = `trade-lock:${this.accountId}:${signal.symbol}`;
    await lock`select pg_advisory_lock(hashtext(${lockKey}))`;
    const setStatus = async (
      status: SignalStatus,
      details?: Record<string, unknown>,
    ) => {
      await db
        .update(schema.tradingSignals)
        .set({
          status,
          processedAt: ['REJECTED', 'EXECUTED', 'FAILED'].includes(status)
            ? new Date()
            : undefined,
          totalExecutionMs: Date.now() - context.receivedAt,
        })
        .where(eq(schema.tradingSignals.id, record.id));
      if (details)
        await audit(
          status === 'REJECTED' ? 'RISK' : 'SIGNAL',
          status.toLowerCase(),
          context.requestId,
          context.ip,
          { signalId: signal.signalId, ...details },
        );
      await emit(`signal.${status.toLowerCase()}`, {
        signalId: signal.signalId,
        status,
        ...details,
      });
    };
    try {
      await db
        .update(schema.tradingSignals)
        .set({ status: 'VALIDATING' })
        .where(eq(schema.tradingSignals.id, record.id));
      const settings = await getSettings();
      if (settings.emergencyStop || !settings.autoTradingEnabled) {
        const reason = settings.emergencyStop
          ? 'Emergency stop enabled'
          : 'Auto trading disabled';
        await setStatus('REJECTED', { reason });
        return {
          status: 'REJECTED' as SignalStatus,
          reason,
          signalId: signal.signalId,
        };
      }
      if (!this.broker.connected) throw new Error('Broker disconnected');
      const strategy = await db.query.strategies.findFirst({
        where: eq(schema.strategies.name, signal.strategy),
      });
      if (!strategy) {
        await setStatus('REJECTED', { reason: 'Unknown strategy' });
        return {
          status: 'REJECTED' as SignalStatus,
          reason: 'Unknown strategy',
          signalId: signal.signalId,
        };
      }
      const [account, symbol, price, positions] = await Promise.all([
        this.broker.getAccount(),
        this.broker.getSymbol(signal.symbol),
        this.broker.getPrice(signal.symbol),
        this.broker.getPositions(),
      ]);
      await db
        .update(schema.tradingSignals)
        .set({ validationCompletedAt: new Date() })
        .where(eq(schema.tradingSignals.id, record.id));
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const [tradeRows, closedRows] = await Promise.all([
        db
          .select({ count: dsql<number>`count(*)::int` })
          .from(schema.orders)
          .where(
            and(
              gte(schema.orders.createdAt, today),
              eq(schema.orders.status, 'FILLED'),
            ),
          ),
        db
          .select({
            pnl: dsql<number>`coalesce(sum(${schema.trades.pnl}),0)::float8`,
          })
          .from(schema.trades)
          .where(gte(schema.trades.closedAt, today)),
      ]);
      const riskStart = Date.now();
      const decision = this.risk.evaluate({
        signal,
        settings,
        account,
        symbol,
        price,
        positions,
        dailyTrades: tradeRows[0]?.count ?? 0,
        dailyPnl: closedRows[0]?.pnl ?? 0,
        strategy: {
          enabled: strategy.enabled,
          allowedSymbols: strategy.allowedSymbols,
          maxLot: strategy.maxLot ? Number(strategy.maxLot) : undefined,
          riskPercentage: strategy.riskPercentage
            ? Number(strategy.riskPercentage)
            : undefined,
          maxDailyTrades: strategy.maxDailyTrades ?? undefined,
          maxDailyLoss: strategy.maxDailyLoss
            ? Number(strategy.maxDailyLoss)
            : undefined,
        },
      });
      await db
        .update(schema.tradingSignals)
        .set({
          riskProcessingMs: Date.now() - riskStart,
          riskValidationCompletedAt: new Date(),
        })
        .where(eq(schema.tradingSignals.id, record.id));
      if (!decision.approved) {
        await setStatus('REJECTED', { reason: decision.reason });
        return {
          status: 'REJECTED' as SignalStatus,
          reason: decision.reason,
          signalId: signal.signalId,
        };
      }
      if (signal.action.startsWith('CLOSE')) {
        await setStatus('APPROVED');
        const targets = positions.filter(
          (p) =>
            p.symbol === signal.symbol &&
            (signal.action === 'CLOSE' ||
              (signal.action === 'CLOSE_LONG'
                ? p.side === 'BUY'
                : p.side === 'SELL')),
        );
        for (const position of targets) await this.close(position, record.id);
        await setStatus('EXECUTED');
        return {
          status: 'EXECUTED' as SignalStatus,
          signalId: signal.signalId,
          closed: targets.length,
        };
      }
      const side = signal.action as Side;
      if (!this.broker.checkMarketOrder)
        throw new Error('Broker order check unavailable; submission blocked');
      const check = await this.broker.checkMarketOrder({
        clientOrderId: signal.signalId,
        symbol: signal.symbol,
        side,
        lots: decision.lots!,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
        maxSlippage: symbol.maxSlippage,
      });
      await audit('BROKER', 'order_checked', context.requestId, context.ip, {
        signalId: signal.signalId,
        source: 'MetaTrader.OrderCheck',
        ...check,
      });
      const marginDecision = check.approved
        ? this.risk.evaluateMarginUsage(
            check.margin,
            check.equity,
            settings.maximumMarginUsagePercentage,
          )
        : {
            approved: false,
            reason: `MetaTrader: ${check.reason || 'OrderCheck rejected'} (retcode ${check.retcode})`,
          };
      if (!marginDecision.approved) {
        await setStatus('REJECTED', {
          reason: marginDecision.reason,
          source: check.approved ? 'risk' : 'MetaTrader.OrderCheck',
        });
        return {
          status: 'REJECTED' as SignalStatus,
          reason: marginDecision.reason,
          signalId: signal.signalId,
        };
      }
      await setStatus('APPROVED');
      const closed = await this.positions.resolve(
        signal.symbol,
        side,
        settings.positionPolicy,
        positions,
      );
      for (const item of closed)
        await this.persistClose(item.position, record.id, item.exitPrice);
      const clientOrderId =
        `${signal.strategy}-${signal.signalId}-${signal.symbol}-${side}`.slice(
          0,
          300,
        );
      const [order] = await db
        .insert(schema.orders)
        .values({
          signalId: record.id,
          clientOrderId,
          symbol: signal.symbol,
          side,
          lots: String(decision.lots),
          requestedPrice: String(side === 'BUY' ? price.ask : price.bid),
          stopLoss: String(decision.stopLoss),
          takeProfit: String(decision.takeProfit),
          status: 'CREATED',
        })
        .returning();
      if (!order) throw new Error('Order persistence failed');
      await emit('order.created', {
        orderId: order.id,
        signalId: signal.signalId,
      });
      const latestSettings = await getSettings();
      if (latestSettings.emergencyStop || !latestSettings.autoTradingEnabled) {
        await db
          .update(schema.orders)
          .set({ status: 'CANCELLED', updatedAt: new Date() })
          .where(eq(schema.orders.id, order.id));
        await setStatus('REJECTED', {
          reason: 'Trading disabled before submission',
        });
        return {
          status: 'REJECTED' as SignalStatus,
          signalId: signal.signalId,
          reason: 'Trading disabled before submission',
        };
      }
      await db
        .update(schema.orders)
        .set({ status: 'SUBMITTING' })
        .where(eq(schema.orders.id, order.id));
      await db
        .update(schema.tradingSignals)
        .set({ status: 'EXECUTING' })
        .where(eq(schema.tradingSignals.id, record.id));
      await db
        .update(schema.tradingSignals)
        .set({ brokerRequestSentAt: new Date() })
        .where(eq(schema.tradingSignals.id, record.id));
      await audit('ORDER', 'broker_order_sent', context.requestId, context.ip, {
        clientOrderId,
      });
      const { result, latencyMs } = await this.orders.submit({
        clientOrderId,
        symbol: signal.symbol,
        side,
        lots: decision.lots!,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
        maxSlippage: symbol.maxSlippage,
      });
      await db
        .update(schema.tradingSignals)
        .set({
          brokerConfirmationReceivedAt: new Date(),
          brokerLatencyMs: latencyMs,
        })
        .where(eq(schema.tradingSignals.id, record.id));
      await db
        .update(schema.orders)
        .set({
          status: result.status,
          brokerOrderId: result.brokerOrderId,
          executedPrice: result.executedPrice?.toString(),
          slippage:
            result.executedPrice === undefined
              ? undefined
              : String(
                  Math.abs(
                    result.executedPrice -
                      (side === 'BUY' ? price.ask : price.bid),
                  ),
                ),
          latencyMs,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, order.id));
      if (
        result.status !== 'FILLED' ||
        !result.positionId ||
        !result.executedPrice
      )
        throw new Error(result.reason ?? 'Broker rejected order');
      await db.insert(schema.positions).values({
        brokerPositionId: result.positionId,
        symbol: signal.symbol,
        side,
        lots: String(decision.lots),
        entryPrice: String(result.executedPrice),
        currentPrice: String(result.executedPrice),
        stopLoss: String(decision.stopLoss),
        takeProfit: String(decision.takeProfit),
      });
      await emit('order.executed', { orderId: order.id, latencyMs });
      await emit('position.opened', { symbol: signal.symbol, side });
      await audit('BROKER', 'order_filled', context.requestId, context.ip, {
        clientOrderId,
        brokerOrderId: result.brokerOrderId,
      });
      await setStatus('EXECUTED');
      return {
        status: 'EXECUTED' as SignalStatus,
        signalId: signal.signalId,
        orderId: order.id,
        brokerOrderId: result.brokerOrderId,
      };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Unknown execution error';
      await setStatus('FAILED', { reason });
      await emit('order.failed', { signalId: signal.signalId, reason });
      return {
        status: 'FAILED' as SignalStatus,
        signalId: signal.signalId,
        reason,
      };
    } finally {
      await lock`select pg_advisory_unlock(hashtext(${lockKey}))`;
      lock.release();
    }
  }
  private async close(position: Position, signalId: string) {
    const result = await this.broker.closePosition(position.id);
    if (result.status !== 'FILLED' || result.executedPrice === undefined)
      throw new Error(result.reason ?? 'Close not confirmed');
    await this.persistClose(position, signalId, result.executedPrice, result);
  }
  /**
   * Realised P&L.
   *
   * The terminal's own deal profit is authoritative when the broker supplies
   * it: it already accounts for the real contract size, the account currency and
   * any commission or swap the server applied. The local figure is a fallback
   * for paths that close without a deal result, and is derived from the symbol
   * specification rather than a constant.
   *
   * An earlier version multiplied by a literal 100, which is XAUUSD's contract
   * size; for EURUSD, at 100000, that understated FX results by 10000x.
   */
  private async estimatePnl(
    position: Position,
    exitPrice: number,
  ): Promise<number> {
    const symbol = await this.broker.getSymbol(position.symbol);
    const priceDelta =
      position.side === 'BUY'
        ? exitPrice - position.entryPrice
        : position.entryPrice - exitPrice;
    if (symbol.tickSize <= 0) return 0;
    const ticks = priceDelta / symbol.tickSize;
    return ticks * symbol.tickValue * position.lots;
  }
  private async persistClose(
    position: Position,
    _signalId: string,
    exitPrice?: number,
    result?: OrderResult,
  ) {
    const price =
      exitPrice ??
      (await this.broker.getPrice(position.symbol))[
        position.side === 'BUY' ? 'bid' : 'ask'
      ];
    const pnl =
      result?.brokerProfit ?? (await this.estimatePnl(position, price));
    const [row] = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.brokerPositionId, position.id));
    if (row) {
      await db
        .update(schema.positions)
        .set({
          status: 'CLOSED',
          closedAt: new Date(),
          currentPrice: String(price),
        })
        .where(eq(schema.positions.id, row.id));
      await db.insert(schema.trades).values({
        positionId: row.id,
        symbol: position.symbol,
        side: position.side,
        lots: String(position.lots),
        entryPrice: String(position.entryPrice),
        exitPrice: String(price),
        pnl: String(pnl),
      });
    }
    await emit('position.closed', {
      symbol: position.symbol,
      positionId: position.id,
      pnl,
    });
  }
}
