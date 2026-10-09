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
export interface MarketOrderCheck {
  approved: boolean;
  reason?: string;
  retcode: number;
  equity: number;
  margin: number;
  freeMargin: number;
}
export interface BrokerAdapter {
  readonly connected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getAccount(): Promise<AccountInfo>;
  getSymbol(symbol: string): Promise<SymbolInfo>;
  getPrice(symbol: string): Promise<MarketPrice>;
  /**
   * OHLC history, oldest first. Required by strategies that compute their own
   * indicators, which is why it sits on the shared adapter rather than behind
   * an MT5-specific extension.
   */
  getRates(symbol: string, period: Timeframe, count: number): Promise<Rate[]>;
  getPositions(): Promise<Position[]>;
  getOrders(): Promise<Order[]>;
  /** Read-only terminal preflight; implementations without support must not submit. */
  checkMarketOrder?(order: MarketOrderRequest): Promise<MarketOrderCheck>;
  placeMarketOrder(order: MarketOrderRequest): Promise<OrderResult>;
  closePosition(positionId: string): Promise<OrderResult>;
  modifyPosition(
    positionId: string,
    stopLoss?: number,
    takeProfit?: number,
  ): Promise<OrderResult>;
}
