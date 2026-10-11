export interface TerminalDeal {
  id: string;
  positionId: string;
  symbol: string;
  type: number;
  entry: number;
  at: number;
  volume: number;
  price: number;
  profit: number;
  commission: number;
  swap: number;
  fee: number;
}
export interface TerminalHistory {
  accountId: string;
  server: string;
  currency: string;
  updatedAt: number;
  serverOffsetSeconds: number;
  complete: boolean;
  deals: TerminalDeal[];
  openPositionIds: string[];
}
export interface CapitalPoint {
  at: string;
  balance: number;
  equity: number;
}
export interface PerformanceData {
  currency: string;
  timezone: string;
  updatedAt: string | null;
  historyUpdatedAt: string | null;
  historyAvailable: boolean;
  historyComplete: boolean;
  observedSince: string | null;
  curve: CapitalPoint[];
  balanceCurve: Array<{ at: string; balance: number }>;
  deposits: number | null;
  withdrawals: number | null;
  adjustments: number | null;
  netDaily: number | null;
  netMonthly: number | null;
  netTotal: number | null;
  commission: number | null;
  swap: number | null;
  fees: number | null;
  adjustedReturn: number | null;
  drawdown: {
    amount: number;
    percent: number;
    maxAmount: number;
    maxPercent: number;
  } | null;
  marginUsed: number;
  marginPercent: number | null;
  stopRisk: number | null;
  exposure: Array<{
    symbol: string;
    lots: number;
    stopRisk: number | null;
    missingStops: number;
  }>;
  closedTrades: Array<{
    id: string;
    symbol: string;
    side: string;
    lots: number;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    closedAt: string;
  }>;
  closedTradeCount: number;
  tradesToday: number;
  winRate: number | null;
  wins: number;
  losses: number;
}
