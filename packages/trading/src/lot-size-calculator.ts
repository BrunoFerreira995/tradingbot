import type { AccountInfo, SymbolInfo } from '@trade/shared';
export class LotSizeCalculator {
  calculate(input: {
    mode: 'FIXED_LOT' | 'RISK_PERCENTAGE';
    fixedLots?: number;
    riskPercentage?: number;
    account: AccountInfo;
    symbol: SymbolInfo;
    stopLossDistance: number;
    maximumLotSize: number;
  }): number {
    const {
      mode,
      fixedLots,
      riskPercentage,
      account,
      symbol,
      stopLossDistance,
      maximumLotSize,
    } = input;
    let lots = fixedLots ?? 0;
    if (mode === 'RISK_PERCENTAGE') {
      if (
        !riskPercentage ||
        riskPercentage <= 0 ||
        stopLossDistance <= 0 ||
        symbol.tickSize <= 0 ||
        symbol.tickValue <= 0
      )
        throw new Error('Invalid risk sizing inputs');
      const riskBudget =
        (Math.min(account.balance, account.equity) * riskPercentage) / 100;
      lots =
        riskBudget / ((stopLossDistance / symbol.tickSize) * symbol.tickValue);
    }
    const capped = Math.min(lots, maximumLotSize, symbol.maxLot);
    const steps = Math.floor((capped - symbol.minLot + 1e-9) / symbol.lotStep);
    const normalized = Number(
      (symbol.minLot + Math.max(0, steps) * symbol.lotStep).toFixed(8),
    );
    if (
      !Number.isFinite(capped) ||
      capped < symbol.minLot ||
      normalized > capped + 1e-9
    )
      throw new Error('Calculated lot below broker minimum');
    return normalized;
  }
}
