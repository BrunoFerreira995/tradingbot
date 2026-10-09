import type {
  AccountInfo,
  MarketOrderRequest,
  MarketPrice,
  Order,
  OrderResult,
  Position,
  Rate,
  SymbolInfo,
  Timeframe,
} from '@trade/shared';
import type { BrokerAdapter } from '../broker-adapter';

const timeframeSeconds: Record<Timeframe, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
  W1: 604800,
  MN1: 2592000,
};

/**
 * In-memory broker double.
 *
 * Test-only. It exists so the trading engine's order/position logic can be
 * exercised without a terminal; nothing in the running application imports it,
 * because the application talks to MetaTrader 5 and nothing else.
 */
export class InMemoryBrokerAdapter implements BrokerAdapter {
  connected = false;
  private balance = 10000;
  private positions = new Map<string, Position>();
  private orders = new Map<string, Order>();
  private results = new Map<string, OrderResult>();
  private mid = 2650;
  private spread = 0.3;
  private slippage = 0.02;
  async connect() {
    this.connected = true;
  }
  async disconnect() {
    this.connected = false;
  }
  private ensure() {
    if (!this.connected) throw new Error('Broker disconnected');
  }
  async getSymbol(symbol: string): Promise<SymbolInfo> {
    this.ensure();
    if (symbol !== 'XAUUSD') throw new Error('Symbol unavailable');
    return {
      symbol,
      minLot: 0.01,
      maxLot: 100,
      lotStep: 0.01,
      contractSize: 100,
      tickValue: 1,
      tickSize: 0.01,
      maxSpread: 1,
      maxSlippage: 0.2,
      defaultStopLoss: 25,
      defaultTakeProfit: 50,
      marginRate: 0.01,
      marketOpen: true,
      stopsLevel: 0.00001,
    };
  }
  async getPrice(symbol: string): Promise<MarketPrice> {
    this.ensure();
    await this.getSymbol(symbol);
    return {
      symbol,
      bid: this.mid - this.spread / 2,
      ask: this.mid + this.spread / 2,
      spread: this.spread,
      at: new Date().toISOString(),
    };
  }
  async getAccount(): Promise<AccountInfo> {
    this.ensure();
    const positions = await this.getPositions();
    const equity =
      this.balance + positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const usedMargin = positions.reduce(
      (sum, p) => sum + p.lots * p.entryPrice,
      0,
    );
    return {
      id: 'paper-account',
      balance: this.balance,
      equity,
      usedMargin,
      freeMargin: equity - usedMargin,
      marginLevel: usedMargin ? (equity / usedMargin) * 100 : 0,
      currency: 'USD',
    };
  }
  async getPositions(): Promise<Position[]> {
    this.ensure();
    const price = await this.getPrice('XAUUSD');
    return [...this.positions.values()].map((p) => ({
      ...p,
      currentPrice: p.side === 'BUY' ? price.bid : price.ask,
      unrealizedPnl:
        (p.side === 'BUY'
          ? price.bid - p.entryPrice
          : p.entryPrice - price.ask) *
        p.lots *
        100,
    }));
  }
  async getOrders(): Promise<Order[]> {
    this.ensure();
    return [...this.orders.values()];
  }
  async placeMarketOrder(request: MarketOrderRequest): Promise<OrderResult> {
    this.ensure();
    const existing = this.results.get(request.clientOrderId);
    if (existing) return existing;
    const symbol = await this.getSymbol(request.symbol);
    if (request.lots < symbol.minLot || request.lots > symbol.maxLot)
      throw new Error('Invalid lot');
    const price = await this.getPrice(request.symbol);
    const executedPrice =
      request.side === 'BUY'
        ? price.ask + this.slippage
        : price.bid - this.slippage;
    const id = crypto.randomUUID();
    const position: Position = {
      id,
      symbol: request.symbol,
      side: request.side,
      lots: request.lots,
      entryPrice: executedPrice,
      currentPrice: executedPrice,
      unrealizedPnl: 0,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      openedAt: new Date().toISOString(),
    };
    const result: OrderResult = {
      brokerOrderId: id,
      positionId: id,
      status: 'FILLED',
      executedPrice,
      confirmedAt: new Date().toISOString(),
    };
    this.positions.set(id, position);
    this.orders.set(id, {
      id,
      clientOrderId: request.clientOrderId,
      symbol: request.symbol,
      side: request.side,
      lots: request.lots,
      status: 'FILLED',
      requestedPrice: request.side === 'BUY' ? price.ask : price.bid,
      executedPrice,
      createdAt: new Date().toISOString(),
    });
    this.results.set(request.clientOrderId, result);
    return result;
  }
  async closePosition(positionId: string): Promise<OrderResult> {
    this.ensure();
    const position = this.positions.get(positionId);
    if (!position)
      return {
        brokerOrderId: positionId,
        status: 'REJECTED',
        reason: 'Position not found',
        confirmedAt: new Date().toISOString(),
      };
    const price = await this.getPrice(position.symbol);
    const exit = position.side === 'BUY' ? price.bid : price.ask;
    this.balance +=
      (position.side === 'BUY'
        ? exit - position.entryPrice
        : position.entryPrice - exit) *
      position.lots *
      100;
    this.positions.delete(positionId);
    return {
      brokerOrderId: crypto.randomUUID(),
      positionId,
      status: 'FILLED',
      executedPrice: exit,
      confirmedAt: new Date().toISOString(),
    };
  }
  async modifyPosition(
    positionId: string,
    stopLoss?: number,
    takeProfit?: number,
  ): Promise<OrderResult> {
    this.ensure();
    const position = this.positions.get(positionId);
    if (!position)
      return {
        brokerOrderId: positionId,
        status: 'REJECTED',
        reason: 'Position not found',
        confirmedAt: new Date().toISOString(),
      };
    this.positions.set(positionId, { ...position, stopLoss, takeProfit });
    return {
      brokerOrderId: positionId,
      positionId,
      status: 'FILLED',
      confirmedAt: new Date().toISOString(),
    };
  }
  /**
   * Deterministic mean-reverting series around the current mid, seeded by
   * symbol so strategy tests get stable indicators without a terminal. Bars are
   * anchored to the timeframe's epoch so bar boundaries line up with a real
   * terminal's.
   */
  async getRates(
    symbol: string,
    period: Timeframe,
    count: number,
  ): Promise<Rate[]> {
    this.ensure();
    const step = timeframeSeconds[period];
    const size = Math.max(1, Math.min(count, 500));
    const seed = [...symbol].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    // Seconds, like the terminal: Rate.t is epoch seconds everywhere, and a
    // millisecond value here would silently put bar timestamps in the year 58000.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const start = Math.floor(nowSeconds / step) * step;
    const rates: Rate[] = [];
    for (let i = size; i > 0; i--) {
      // Two interleaved sine waves plus a seeded phase: trending enough to move
      // RSI, reverting enough to hit the bands.
      const phase = (seed % 17) / 17;
      const drift = Math.sin((i + phase * 20) / 7) * 0.012;
      const wave = Math.sin((i + phase * 20) / 23) * 0.006;
      const close = this.mid * (1 + drift + wave);
      const high = close * (1 + 0.0015);
      const low = close * (1 - 0.0015);
      rates.push({
        t: start - (i - 1) * step,
        o: close * (1 - 0.0004),
        h: Math.max(high, close),
        l: Math.min(low, close),
        c: close,
        v: 1000 + (i % 37) * 10,
      });
    }
    return rates;
  }
  setMarket(mid: number, spread = this.spread) {
    this.mid = mid;
    this.spread = spread;
  }
  restore(balance: number, positions: Position[]) {
    this.balance = balance;
    this.positions = new Map(
      positions.map((position) => [position.id, position]),
    );
  }
}
