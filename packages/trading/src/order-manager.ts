import type { BrokerAdapter } from '@trade/broker';
import type { MarketOrderRequest, OrderResult } from '@trade/shared';
export class OrderManager {
  constructor(
    private broker: BrokerAdapter,
    private timeoutMs = 10000,
  ) {}
  async submit(
    order: MarketOrderRequest,
  ): Promise<{ result: OrderResult; latencyMs: number }> {
    if (!this.broker.connected) throw new Error('Broker disconnected');
    const started = Date.now();
    // Market orders are deliberately never retried after an ambiguous timeout.
    const result = await Promise.race([
      this.broker.placeMarketOrder(order),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Broker timeout: reconcile by clientOrderId before retry',
              ),
            ),
          this.timeoutMs,
        ),
      ),
    ]);
    return { result, latencyMs: Date.now() - started };
  }
}
