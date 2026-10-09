import type { Timeframe } from '@trade/shared';

export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** What the strategy runner is doing on one watched pair. */
export interface SymbolState {
  status: 'IDLE' | 'WAITING_BAR' | 'SIGNAL' | 'NO_SETUP' | 'BLOCKED';
  lastBarAt: string | null;
  secondsToNextBar: number | null;
  close?: number;
  rsi?: number;
  upper?: number;
  lower?: number;
  /** RSI points still needed to reach the extreme that triggers a setup. */
  rsiToTrigger?: number;
  /** Share of band width still to travel before the bar touches a band. */
  bandToTrigger?: number;
  side?: string;
  detail?: string;
}

export interface StrategyState {
  strategy: string | null;
  status: SymbolState['status'] | 'DISABLED';
  timeframe: Timeframe;
  timeframes: Timeframe[];
  symbols: string[];
  lastCheckAt: string | null;
  detail?: string;
  symbolStates: Record<string, SymbolState>;
}

export interface DashboardData {
  account: {
    id: string;
    balance: number;
    equity: number;
    freeMargin: number;
    usedMargin: number;
    marginLevel: number;
    currency: string;
  };
  positions: Array<{
    id: string;
    symbol: string;
    side: string;
    lots: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    stopLoss?: number;
    takeProfit?: number;
    openedAt: string;
  }>;
  price: { bid: number; ask: number; spread: number; at: string } | null;
  settings: {
    autoTradingEnabled: boolean;
    emergencyStop: boolean;
    maximumLotSize: number;
    maximumOpenPositions: number;
    maximumDailyLoss: number;
    maximumDailyTrades: number;
    positionPolicy: string;
    allowedSymbols: string[];
    requireStopLoss: boolean;
  };
  signals: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  trades: Array<Record<string, unknown>>;
  strategies: Array<Record<string, unknown>>;
  stats: {
    dailyPnl: number;
    openPnl: number;
    tradesToday: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
  };
  brokerConnected: boolean;
  provider: string;
  mode: string;
  symbol: string;
  symbols?: string[];
}
export const money = (value: number | undefined) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value ?? 0);
export const num = (value: unknown, digits = 2) =>
  Number(value ?? 0).toFixed(digits);
export const date = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString('pt-BR') : '—';
