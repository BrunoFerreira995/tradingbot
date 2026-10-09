import { createHash } from 'node:crypto';
import type {
  AccountInfo,
  MarketOrderRequest,
  MarketPrice,
  Order,
  OrderResult,
  OrderStatus,
  Position,
  Rate,
  Side,
  SymbolInfo,
  Timeframe,
} from '@trade/shared';
import type { BrokerAdapter } from '../broker-adapter';
import type { BridgeOptions, BridgeReply, BridgeSymbolState } from './bridge';
import { MT5Bridge } from './bridge';

/** MT5 truncates order comments to 31 characters, so the full id cannot fit. */
const MAX_MT5_COMMENT = 31;

export interface MT5BrokerOptions extends BridgeOptions {
  bridge?: MT5Bridge;
  /** Tags every order so it can be recognised in the terminal. */
  magic?: number;
  /** Symbols to publish snapshots for; refreshed by `watch`. */
  symbols?: string[];
  /** How long a heartbeat may lag before the adapter reports a disconnect. */
  startupTimeoutMs?: number;
}

const DEFAULT_MAGIC = 20260101;
const DEFAULT_STARTUP_TIMEOUT_MS = 30000;

/**
 * MT5 order comments hold a fingerprint of the client order id, not the id.
 *
 * The engine relies on `placeMarketOrder` being idempotent per `clientOrderId`,
 * and the comment is the only part of an MT5 order that survives to the server,
 * so the fingerprint is what lets a crashed-and-restarted process recognise a
 * position it already opened instead of opening a second one.
 */
export function fingerprint(clientOrderId: string): string {
  return createHash('sha256').update(clientOrderId).digest('hex').slice(0, 24);
}

function toIso(seconds: unknown): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return new Date().toISOString();
  return new Date(value * 1000).toISOString();
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class MT5BrokerAdapter implements BrokerAdapter {
  private readonly bridge: MT5Bridge;
  private readonly magic: number;
  private readonly startupTimeoutMs: number;
  private watched = new Set<string>();
  private started = false;
  private live = false;
  /** clientOrderId -> the result the terminal already produced for it. */
  private readonly results = new Map<string, OrderResult>();

  constructor(options: MT5BrokerOptions = {}) {
    this.bridge = options.bridge ?? new MT5Bridge(options);
    this.magic = options.magic ?? DEFAULT_MAGIC;
    this.startupTimeoutMs =
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    for (const symbol of options.symbols ?? []) this.watched.add(symbol);
  }

  get connected() {
    return this.started && this.live;
  }

  /**
   * Waits for the MQL5 service to publish a heartbeat.
   *
   * The terminal is a separate process the bot does not control, so connecting
   * means observing it rather than dialling it. Failing fast here keeps the API
   * from accepting signals it cannot execute.
   */
  async connect() {
    await this.bridge.cleanup();
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (await this.bridge.isAlive()) {
        this.started = true;
        this.live = true;
        if (this.watched.size > 0) await this.bridge.watch([...this.watched]);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    this.started = true;
    this.live = false;
    throw new Error(
      `MetaTrader bridge is not reachable at ${this.bridge.directory}. ` +
        'Log into the terminal, add the AurumBridge service under Navigator, ' +
        'and enable Algo Trading.',
    );
  }

  async disconnect() {
    this.started = false;
    this.live = false;
  }

  /**
   * Re-reads the terminal heartbeat and updates `connected`.
   *
   * `connect()` blocks waiting for the service to first appear; `probe()` is the
   * reconnect path for an API that is already up, so it returns immediately and
   * can be run on a timer while the terminal is down. This is what lets the app
   * boot before the service exists and light up the moment it starts.
   */
  async probe(): Promise<boolean> {
    this.started = true;
    const alive = await this.bridge.isAlive();
    if (alive && this.watched.size > 0) {
      try {
        await this.bridge.watch([...this.watched]);
      } catch {
        // The service vanished mid-probe. Reporting connected would be a lie,
        // and the next probe retries anyway.
        this.live = false;
        return false;
      }
    }
    this.live = alive;
    return alive;
  }

  private async requireLive() {
    if (!this.connected) throw new Error('Broker disconnected');
  }

  private async ensureWatched(symbol: string) {
    if (this.watched.has(symbol)) return;
    this.watched.add(symbol);
    await this.bridge.watch([...this.watched]);
  }

  async getAccount(): Promise<AccountInfo> {
    await this.requireLive();
    const raw = await this.bridge.account();
    if (!raw) throw new Error('MetaTrader account snapshot unavailable');
    return {
      id: String(raw.id ?? ''),
      balance: toNumber(raw.balance),
      equity: toNumber(raw.equity),
      freeMargin: toNumber(raw.freeMargin),
      usedMargin: toNumber(raw.usedMargin),
      marginLevel: toNumber(raw.marginLevel),
      currency: String(raw.currency ?? 'USD'),
    };
  }

  private toSymbolInfo(state: BridgeSymbolState): SymbolInfo {
    return {
      symbol: state.symbol,
      minLot: toNumber(state.minLot),
      maxLot: toNumber(state.maxLot),
      lotStep: toNumber(state.lotStep),
      contractSize: toNumber(state.contractSize),
      tickValue: toNumber(state.tickValue),
      tickSize: toNumber(state.tickSize),
      maxSpread: toNumber(state.maxSpread),
      maxSlippage: toNumber(state.maxSlippage),
      defaultStopLoss: toNumber(state.defaultStopLoss),
      defaultTakeProfit: toNumber(state.defaultTakeProfit),
      marginRate: toNumber(state.marginRate),
      marketOpen: state.marketOpen === true,
      // The bridge already resolved STOPS_LEVEL points into price units.
      stopsLevel: toNumber(state.stopsLevel),
    };
  }

  private async symbolState(symbol: string) {
    await this.ensureWatched(symbol);
    const state = (await this.bridge.symbols())[symbol];
    if (!state) throw new Error(`Symbol unavailable: ${symbol}`);
    return state;
  }

  async getSymbol(symbol: string): Promise<SymbolInfo> {
    await this.requireLive();
    return this.toSymbolInfo(await this.symbolState(symbol));
  }

  async getPrice(symbol: string): Promise<MarketPrice> {
    await this.requireLive();
    const state = await this.symbolState(symbol);
    return {
      symbol,
      bid: toNumber(state.bid),
      ask: toNumber(state.ask),
      spread: toNumber(state.spread),
      at: new Date().toISOString(),
    };
  }

  getRates(symbol: string, period: Timeframe, count: number): Promise<Rate[]> {
    return this.bridge.getRates(symbol, period, count);
  }

  async getPositions(): Promise<Position[]> {
    await this.requireLive();
    return (await this.bridge.positions()).map((row) => ({
      id: String(row.id),
      symbol: String(row.symbol),
      side: (row.side === 'SELL' ? 'SELL' : 'BUY') as Side,
      lots: toNumber(row.lots),
      entryPrice: toNumber(row.entryPrice),
      currentPrice: toNumber(row.currentPrice),
      unrealizedPnl: toNumber(row.unrealizedPnl),
      stopLoss: toNumber(row.stopLoss) || undefined,
      takeProfit: toNumber(row.takeProfit) || undefined,
      openedAt: toIso(row.openedAt),
    }));
  }

  async getOrders(): Promise<Order[]> {
    await this.requireLive();
    return (await this.bridge.orders()).map((row) => {
      const order: Order = {
        id: String(row.id),
        // The terminal stores a fingerprint here, not the original id.
        clientOrderId: String(row.clientOrderId ?? ''),
        symbol: String(row.symbol),
        side: (row.side === 'SELL' ? 'SELL' : 'BUY') as Side,
        lots: toNumber(row.lots),
        status: (row.status as OrderStatus) ?? 'SUBMITTED',
        requestedPrice: toNumber(row.requestedPrice) || undefined,
        createdAt: toIso(row.createdAt),
      };
      if (row.executedPrice !== undefined)
        order.executedPrice = toNumber(row.executedPrice);
      return order;
    });
  }

  private reject(
    reason: string,
    brokerOrderId: string,
    positionId?: string,
  ): OrderResult {
    return {
      brokerOrderId,
      status: 'REJECTED',
      reason,
      confirmedAt: new Date().toISOString(),
      ...(positionId ? { positionId } : {}),
    };
  }

  async placeMarketOrder(order: MarketOrderRequest): Promise<OrderResult> {
    await this.requireLive();
    const cached = this.results.get(order.clientOrderId);
    if (cached) return cached;

    const mark = fingerprint(order.clientOrderId);
    if (mark.length > MAX_MT5_COMMENT)
      throw new Error(
        'clientOrderId fingerprint exceeds the MT5 comment limit',
      );

    let reply: BridgeReply;
    try {
      reply = await this.bridge.place({
        symbol: order.symbol,
        side: order.side,
        lots: order.lots,
        sl: order.stopLoss,
        tp: order.takeProfit,
        maxSlippage: order.maxSlippage,
        comment: mark,
        magic: this.magic,
      });
    } catch (error) {
      // A bridge failure is an execution failure, not a business rejection:
      // nothing is cached so a later signal for the same id can still run.
      const result = this.reject(
        error instanceof Error ? error.message : 'Broker request failed',
        mark,
      );
      this.results.set(order.clientOrderId, result);
      return result;
    }

    // TRADE_RETCODE_DONE / TRADE_RETCODE_DONE_PARTIAL.
    const filled = reply.retcode === 10009 || reply.retcode === 10010;
    // The engine treats a filled order without a position id as a failure, so
    // say so here rather than letting it surface as a generic rejection.
    const located =
      filled && Boolean(reply.positionId && reply.positionId !== '0');
    const result: OrderResult = located
      ? {
          brokerOrderId: reply.brokerOrderId ?? mark,
          status: 'FILLED',
          positionId: reply.positionId,
          executedPrice: reply.executedPrice,
          confirmedAt: new Date().toISOString(),
        }
      : this.reject(
          !filled
            ? (reply.retcodeText ?? 'Broker rejected order')
            : 'Order filled but no position ticket was returned',
          reply.brokerOrderId ?? mark,
        );
    this.results.set(order.clientOrderId, result);
    return result;
  }

  async closePosition(positionId: string): Promise<OrderResult> {
    await this.requireLive();
    if (!/^\d+$/.test(positionId))
      return this.reject('Position id is not an MT5 ticket', positionId);
    try {
      const reply = await this.bridge.close({
        positionId: Number(positionId),
        maxSlippage: 0.2,
        comment: fingerprint(`close-${positionId}`),
        magic: this.magic,
      });
      return {
        brokerOrderId: reply.brokerOrderId ?? positionId,
        status: 'FILLED',
        positionId,
        executedPrice: reply.executedPrice,
        ...(reply.profit !== undefined ? { brokerProfit: reply.profit } : {}),
        confirmedAt: new Date().toISOString(),
      };
    } catch (error) {
      return this.reject(
        error instanceof Error ? error.message : 'Close request failed',
        positionId,
        positionId,
      );
    }
  }

  async modifyPosition(
    positionId: string,
    stopLoss?: number,
    takeProfit?: number,
  ): Promise<OrderResult> {
    await this.requireLive();
    if (!/^\d+$/.test(positionId))
      return this.reject('Position id is not an MT5 ticket', positionId);
    try {
      const reply = await this.bridge.modify({
        positionId: Number(positionId),
        sl: stopLoss,
        tp: takeProfit,
        comment: fingerprint(`modify-${positionId}`),
        magic: this.magic,
      });
      return {
        brokerOrderId: reply.brokerOrderId ?? positionId,
        status: 'FILLED',
        positionId,
        confirmedAt: new Date().toISOString(),
      };
    } catch (error) {
      return this.reject(
        error instanceof Error ? error.message : 'Modify request failed',
        positionId,
        positionId,
      );
    }
  }

  /** Raw terminal state, used at startup to verify which account is connected. */
  heartbeat() {
    return this.bridge.heartbeat();
  }

  /** Exposes bridge diagnostics for /health and startup logging. */
  async diagnostics() {
    const beat = await this.bridge.heartbeat();
    return {
      provider: 'mt5',
      directory: this.bridge.directory,
      connected: this.connected,
      heartbeatAgeMs: await this.bridge.heartbeatAgeMs(),
      build: beat?.build ?? 0,
      login: beat?.login ?? 0,
      server: beat?.server ?? '',
      terminalName: beat?.name ?? '',
      tradeAllowed: beat?.tradeAllowed === true,
    };
  }
}
