import type { BrokerAdapter } from '../broker-adapter';
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
export class CTraderBrokerAdapter implements BrokerAdapter {
  connected = false;
  // TODO: implement OAuth refresh, Open API session, reconciliation, and broker-side clientOrderId lookup.
  private unsupported(): never {
    throw new Error(
      'cTrader integration is not implemented; live trading is unavailable',
    );
  }
  async connect(): Promise<void> {
    this.unsupported();
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  async getAccount(): Promise<AccountInfo> {
    this.unsupported();
  }
  async getSymbol(_symbol: string): Promise<SymbolInfo> {
    this.unsupported();
  }
  async getPrice(_symbol: string): Promise<MarketPrice> {
    this.unsupported();
  }
  async getRates(
    _symbol: string,
    _period: Timeframe,
    _count: number,
  ): Promise<Rate[]> {
    this.unsupported();
  }
  async getPositions(): Promise<Position[]> {
    this.unsupported();
  }
  async getOrders(): Promise<Order[]> {
    this.unsupported();
  }
  async placeMarketOrder(_order: MarketOrderRequest): Promise<OrderResult> {
    this.unsupported();
  }
  async closePosition(_positionId: string): Promise<OrderResult> {
    this.unsupported();
  }
  async modifyPosition(
    _positionId: string,
    _stopLoss?: number,
    _takeProfit?: number,
  ): Promise<OrderResult> {
    this.unsupported();
  }
}
