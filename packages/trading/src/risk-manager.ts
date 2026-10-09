import type {
  AccountInfo,
  MarketPrice,
  Position,
  RiskDecision,
  SymbolInfo,
  TradingSignal,
} from '@trade/shared';
import { LotSizeCalculator } from './lot-size-calculator';
export interface RiskSettings {
  autoTradingEnabled: boolean;
  emergencyStop: boolean;
  maximumLotSize: number;
  minimumLotSize: number;
  maximumOpenPositions: number;
  maximumPositionsPerSymbol: number;
  maximumDailyLoss: number;
  maximumDailyTrades: number;
  maximumExposure: number;
  maximumMarginUsagePercentage: number;
  allowedSymbols: string[];
  blockedSymbols: string[];
  requireStopLoss: boolean;
  minimumStopDistance: number;
  maximumStopDistance: number;
  positionPolicy:
    'ONE_POSITION_PER_SYMBOL' | 'ALLOW_MULTIPLE_POSITIONS' | 'REVERSE_POSITION';
}
export class RiskManager {
  private calculator = new LotSizeCalculator();
  evaluate(input: {
    signal: TradingSignal;
    settings: RiskSettings;
    account: AccountInfo;
    symbol: SymbolInfo;
    price: MarketPrice;
    positions: Position[];
    dailyPnl: number;
    dailyTrades: number;
    strategy?: {
      enabled: boolean;
      allowedSymbols: string[];
      maxLot?: number;
      riskPercentage?: number;
      maxDailyTrades?: number;
      maxDailyLoss?: number;
    };
  }): RiskDecision {
    const {
      signal,
      settings: s,
      account,
      symbol,
      price,
      positions,
      dailyPnl,
      dailyTrades,
      strategy,
    } = input;
    const reject = (reason: string): RiskDecision => ({
      approved: false,
      reason,
    });
    if (s.emergencyStop) return reject('Emergency stop enabled');
    if (!s.autoTradingEnabled) return reject('Auto trading disabled');
    if (
      !s.allowedSymbols.includes(signal.symbol) ||
      s.blockedSymbols.includes(signal.symbol)
    )
      return reject('Symbol not allowed');
    if (
      strategy &&
      (!strategy.enabled || !strategy.allowedSymbols.includes(signal.symbol))
    )
      return reject('Strategy disabled or symbol not allowed');
    if (signal.action.startsWith('CLOSE')) return { approved: true };
    if (!symbol.marketOpen) return reject('Market closed');
    if (price.spread > symbol.maxSpread)
      return reject('Spread exceeds broker limit');
    if (
      dailyPnl <= -s.maximumDailyLoss ||
      (strategy?.maxDailyLoss !== undefined &&
        dailyPnl <= -strategy.maxDailyLoss)
    )
      return reject('Daily loss limit exceeded');
    if (
      dailyTrades >= s.maximumDailyTrades ||
      (strategy?.maxDailyTrades !== undefined &&
        dailyTrades >= strategy.maxDailyTrades)
    )
      return reject('Daily trade limit exceeded');
    const same = positions.filter((p) => p.symbol === signal.symbol);
    const reversing =
      s.positionPolicy === 'REVERSE_POSITION' &&
      same.length > 0 &&
      same.every((p) => p.side !== signal.action);
    if (!reversing && positions.length >= s.maximumOpenPositions)
      return reject('Maximum open positions exceeded');
    if (!reversing && same.length >= s.maximumPositionsPerSymbol)
      return reject('Maximum positions per symbol exceeded');
    if (s.positionPolicy === 'ONE_POSITION_PER_SYMBOL' && same.length)
      return reject('Position already exists');
    const requested = signal.stopLoss ?? symbol.defaultStopLoss;
    if (s.requireStopLoss && !signal.stopLoss)
      return reject('Stop loss required');
    // A configured floor is only meaningful next to the broker's own. The
    // broker floor is per instrument: expressed as an absolute price amount it
    // is smaller than a percent of price for every sub-1.00 pair, so comparing
    // a percent-of-price stop against a fixed 0.01 rejects USDCHF and NZDUSD on
    // every signal no matter how they are configured.
    const floor = Math.max(s.minimumStopDistance, symbol.stopsLevel);
    // Too tight is widened to the floor rather than rejected: the intent of a
    // percent-of-price stop survives, and the terminal would reject it anyway.
    // Too wide is a genuine risk decision and stays a rejection, because
    // widening it silently would move the stop further from price.
    if (requested > s.maximumStopDistance)
      return reject(
        `Stop distance ${requested.toFixed(5)} above maximum ${s.maximumStopDistance}`,
      );
    const distance = Math.max(requested, floor);
    if (distance > s.maximumStopDistance)
      return reject(
        `Stop distance ${distance.toFixed(5)} above maximum ${s.maximumStopDistance} after applying broker minimum ${symbol.stopsLevel}`,
      );
    const maxLot = Math.min(s.maximumLotSize, strategy?.maxLot ?? Infinity);
    if ((signal.lots ?? 0) > maxLot) return reject('Lot exceeds maximum');
    let lots: number;
    try {
      lots = this.calculator.calculate({
        mode: strategy?.riskPercentage ? 'RISK_PERCENTAGE' : 'FIXED_LOT',
        fixedLots: signal.lots,
        riskPercentage: strategy?.riskPercentage,
        account,
        symbol,
        stopLossDistance: distance,
        maximumLotSize: maxLot,
      });
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Invalid lot');
    }
    if (lots < s.minimumLotSize) return reject('Lot below minimum');
    // Margin is checked after sizing through the terminal's OrderCheck.
    // Contract notional multiplied by marginRate is not broker margin.
    const exposure =
      positions.reduce(
        (sum, p) => sum + p.lots * p.currentPrice * symbol.contractSize,
        0,
      ) +
      lots * price.ask * symbol.contractSize;
    if (exposure > s.maximumExposure)
      return reject('Maximum exposure exceeded');
    const entry = signal.action === 'BUY' ? price.ask : price.bid;
    const takeProfitDistance = signal.takeProfit ?? symbol.defaultTakeProfit;
    return {
      approved: true,
      lots,
      stopLoss: signal.action === 'BUY' ? entry - distance : entry + distance,
      takeProfit:
        signal.action === 'BUY'
          ? entry + takeProfitDistance
          : entry - takeProfitDistance,
      stopDistance: distance,
      stopDistanceAdjusted: distance > requested,
    };
  }

  evaluateMarginUsage(
    margin: number,
    equity: number,
    maximumMarginUsagePercentage: number,
  ): RiskDecision {
    if (
      !Number.isFinite(margin) ||
      margin < 0 ||
      !Number.isFinite(equity) ||
      equity <= 0
    )
      return { approved: false, reason: 'Invalid MetaTrader margin data' };
    if ((margin / equity) * 100 > maximumMarginUsagePercentage)
      return {
        approved: false,
        reason: 'Margin usage limit exceeded (MetaTrader projection)',
      };
    return { approved: true };
  }
}
