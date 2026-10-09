import type { BrokerAdapter } from '@trade/broker';
import type { Position, Side } from '@trade/shared';
import type { RiskSettings } from './risk-manager';
export class PositionManager {
  constructor(private broker: BrokerAdapter) {}
  async resolve(
    symbol: string,
    side: Side,
    policy: RiskSettings['positionPolicy'],
    positions: Position[],
  ): Promise<Array<{ position: Position; exitPrice: number }>> {
    const same = positions.filter((p) => p.symbol === symbol);
    if (policy !== 'REVERSE_POSITION') return [];
    const opposite = same.filter((p) => p.side !== side);
    const closed: Array<{ position: Position; exitPrice: number }> = [];
    for (const position of opposite) {
      const result = await this.broker.closePosition(position.id);
      if (result.status !== 'FILLED' || result.executedPrice === undefined)
        throw new Error(result.reason ?? 'Close not confirmed');
      const stillOpen = (await this.broker.getPositions()).some(
        (p) => p.id === position.id,
      );
      if (stillOpen) throw new Error('Close not reflected by broker');
      closed.push({ position, exitPrice: result.executedPrice });
    }
    return closed;
  }
}
