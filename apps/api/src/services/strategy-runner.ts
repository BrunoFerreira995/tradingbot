import { db, schema } from '@trade/database';
import { eq } from 'drizzle-orm';
import type { BrokerAdapter } from '@trade/broker';
import type { Rate, Timeframe, TradingSignal } from '@trade/shared';
import {
  at,
  atr,
  bollingerBands,
  defaultMeanReversionConfig,
  evaluateMeanReversion,
  lastClosedBarTime,
  rsi,
  evaluateSmaMicroTrend,
  defaultSmaMicroTrendConfig,
  atrTrailingStop,
  macroTrendAt,
  resolveMacroTimeframe,
  type SmaMicroTrendConfig,
  defaultDowTheoryConfig,
  evaluateDowTheory,
  type DowTheoryConfig,
  evaluateMarketForces,
  type MarketForcesReading,
  evaluateForceShockStrategy,
  type ForceShockConfig,
  type ForceShockStrategyReading,
  evaluateDiversifiedTrend,
  diversifiedTrendSchema,
  defaultDiversifiedTrendConfig,
  sizeDiversifiedTrend,
  TREND_FOREX_SYMBOLS,
  type DiversifiedTrendConfig,
  type DiversifiedTrendReading,
} from '@trade/strategy';
import { audit, emit } from './events';
import { getSettings } from './settings';
import type { TradingEngine } from './trading-engine';

/**
 * Turns a strategy into signals.
 *
 * The webhook path assumes someone else already decided to trade: TradingView
 * alerts, cron jobs, manual curls. This runner closes that gap for strategies
 * that decide for themselves by watching the market, which is the case for
 * every indicator-based strategy.
 *
 * The contract with the engine is deliberately narrow: the runner emits an
 * ordinary `TradingSignal` and lets the existing risk engine decide whether it
 * is acceptable. Position sizing, lot normalisation, spread checks, daily loss
 * caps and the audit trail all stay in one place instead of being reimplemented
 * per strategy, and the dashboard needs no new code to display a runner's work.
 */

export interface StrategyRunnerOptions {
  strategyName: string;
  /** Every symbol the strategy watches and may trade. */
  symbols: string[];
  timeframe: Timeframe;
  /** Bars to pull. Must exceed the indicator warm-up. */
  history?: number;
  pollIntervalMs?: number;
  config?: Partial<typeof defaultMeanReversionConfig>;
  smaConfig?: SmaMicroTrendConfig;
  smaConfigs?: Record<string, SmaMicroTrendConfig>;
  dowConfig?: DowTheoryConfig;
  shockConfig?: Partial<ForceShockConfig>;
  trendConfig?: DiversifiedTrendConfig;
  getMaximumLotSize?: () => Promise<number>;
  /** Live risk allowlist; disabled symbols must not stop enabled symbols. */
  getAllowedSymbols?: () => Promise<string[]>;
  /**
   * Observability sink. Injected rather than imported so the evaluation logic
   * stays independent of the database and can be driven by a test, and so a
   * future strategy can report elsewhere without touching this file.
   */
  reporter?: StrategyReporter;
}

export interface StrategyEvaluationReport {
  strategy: string;
  symbol: string;
  timeframe: Timeframe;
  outcome: string;
  barTime: string;
  side?: string;
  close?: number;
  rsi?: number;
  upper?: number;
  lower?: number;
  fastSMA?: number;
  slowSMA?: number;
  atr?: number;
  trend?: string;
  stopLoss?: number;
  reason?: string;
}

export interface StrategyReporter {
  evaluated(report: StrategyEvaluationReport): Promise<void>;
  failed(report: {
    strategy: string;
    symbol: string;
    error: string;
  }): Promise<void>;
}

export type RunnerStatus =
  'IDLE' | 'WAITING_BAR' | 'SIGNAL' | 'NO_SETUP' | 'BLOCKED';

/** What one watched symbol is doing right now, for the dashboard. */
export interface SymbolState {
  diversifiedTrend?: DiversifiedTrendReading;
  forceShock?: ForceShockStrategyReading;
  marketForces?: MarketForcesReading;
  status: RunnerStatus;
  /** Timestamp of the last closed bar that was evaluated, ISO 8601. */
  lastBarAt: string | null;
  /** Seconds until this symbol's next bar closes on the active timeframe. */
  secondsToNextBar: number | null;
  close?: number;
  rsi?: number;
  upper?: number;
  lower?: number;
  fastSMA?: number;
  slowSMA?: number;
  atr?: number;
  trend?: string;
  macroTrend?: string;
  macroTimeframe?: Timeframe;
  stopLoss?: number;
  /**
   * How far the bar is from a setup, in each condition's own units: RSI points
   * to the extreme, and percent of band width to the band. Both are always
   * present after an evaluation, so a symbol sitting one RSI point away is
   * visibly different from one that is far away.
   */
  rsiToTrigger?: number;
  bandToTrigger?: number;
  side?: string;
  detail?: string;
}

export interface RunnerSnapshot {
  trendConfig?: DiversifiedTrendConfig;
  status: RunnerStatus;
  symbols: string[];
  timeframe: Timeframe;
  lastCheckAt: string | null;
  detail?: string;
  /** Per-symbol state, keyed by symbol. */
  symbolStates: Record<string, SymbolState>;
}

/** Per-symbol verdict for one evaluation pass. */
interface Outcome {
  status: RunnerStatus;
  detail?: string;
}

/**
 * Ordering used to collapse a pass over many symbols into one status. A blocked
 * symbol outranks a signal on purpose: the bot must not present a healthy run
 * while a symbol it claims to watch is silently failing.
 */
const SEVERITY: Record<RunnerStatus, number> = {
  IDLE: 0,
  WAITING_BAR: 1,
  NO_SETUP: 2,
  SIGNAL: 3,
  BLOCKED: 4,
};

const DEFAULTS = {
  history: 120,
  pollIntervalMs: 5000,
};

// Entry guards target costs and stops that are large relative to a closed M1
// candle. They skip a setup; they never increase the user's monetary risk cap.
const SMA_MAX_SPREAD_ATR = 1.5;
const SMA_MIN_STOP_ATR = 0.5;

/** Writes to the audit trail and the event stream the dashboard listens to. */
export const eventStreamReporter: StrategyReporter = {
  async evaluated(report) {
    const { strategy, symbol, outcome, barTime, timeframe, ...detail } = report;
    await audit('STRATEGY', `evaluated_${outcome}`, undefined, undefined, {
      strategy,
      symbol,
      timeframe,
      barTime,
      ...detail,
    });
    await emit('strategy.evaluated', {
      strategy,
      symbol,
      outcome,
      barTime,
      ...(report.side ? { side: report.side } : {}),
      ...(report.reason ? { reason: report.reason } : {}),
    });
  },
  async failed({ strategy, symbol, error }) {
    await audit('STRATEGY', 'evaluation_failed', undefined, undefined, {
      strategy,
      symbol,
      error,
    });
  },
};

export class StrategyRunner {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Last closed bar acted on, per symbol, so one symbol cannot mask another. */
  private readonly lastBarTimes = new Map<string, number>();
  /** Last failure message audited per symbol, so repeats are not re-audited. */
  private readonly lastFailures = new Map<string, string>();
  private running = false;
  private snapshot: RunnerSnapshot;
  /**
   * The timeframe currently in force. Held as its own field, not read from
   * `options`, so it can be changed while the runner is live; the constructor
   * value is only the starting point.
   */
  private timeframe: Timeframe;
  /**
   * Latest verdict per symbol, kept so the dashboard can show what each of the
   * watched pairs is doing. Without it, eight symbols collapse into one
   * aggregate status and "all pairs fine" is indistinguishable from "one pair
   * silently failing".
   */
  private readonly symbolStates = new Map<string, SymbolState>();
  private readonly marketForces = new Map<string, MarketForcesReading>();
  private readonly forceShocks = new Map<string, ForceShockStrategyReading>();
  private readonly trendReadings = new Map<string, DiversifiedTrendReading>();
  constructor(
    private broker: BrokerAdapter,
    private engine: TradingEngine,
    private options: StrategyRunnerOptions,
  ) {
    if (options.strategyName === 'diversified_trend') {
      if (options.timeframe !== 'D1') throw new Error('Diversified trend requires D1');
      diversifiedTrendSchema.parse(options.trendConfig ?? defaultDiversifiedTrendConfig);
    }
    this.timeframe = options.timeframe;
    this.snapshot = {
      status: 'IDLE',
      symbols: options.symbols,
      timeframe: options.timeframe,
      lastCheckAt: null,
      symbolStates: {},
    };
    this.reporter = options.reporter ?? eventStreamReporter;
  }

  private readonly reporter: StrategyReporter;

  setSmaConfig(config: SmaMicroTrendConfig): void {
    this.options.smaConfig = config;
  }

  setScopedSmaConfig(symbol: string, timeframe: Timeframe, config: SmaMicroTrendConfig): void {
    this.options.smaConfigs ??= {};
    this.options.smaConfigs[`${symbol}:${timeframe}`] = config;
  }

  scopedSmaConfig(symbol: string, timeframe = this.timeframe): SmaMicroTrendConfig {
    return this.options.smaConfigs?.[`${symbol}:${timeframe}`] ?? this.smaConfig;
  }

  get smaConfig(): SmaMicroTrendConfig {
    return this.options.smaConfig ?? defaultSmaMicroTrendConfig;
  }

  get state(): RunnerSnapshot {
    return { ...this.snapshot, ...(this.options.strategyName === 'diversified_trend'
      ? { trendConfig: this.options.trendConfig ?? defaultDiversifiedTrendConfig } : {}) };
  }

  /** Exposes a startup refusal instead of leaving an unevaluated IDLE state. */
  blockStartup(detail: string): void {
    for (const symbol of this.options.symbols) {
      this.record(symbol, {
        status: 'BLOCKED',
        lastBarAt: null,
        secondsToNextBar: null,
        detail,
      });
    }
    this.set('BLOCKED', detail);
  }

  /**
   * Switches the timeframe the runner trades on, without a restart.
   *
   * `lastBarTimes` must be cleared alongside the change. Its values are bar
   * timestamps belonging to the *old* timeframe, so leaving them in place would
   * compare a new M5 bar time against an M30 bar time: the first bar of the new
   * timeframe would be treated as already acted on, and the symbol would sit in
   * WAITING_BAR until the clock happened to produce that exact timestamp again.
   */
  setTimeframe(timeframe: Timeframe): void {
    if (this.options.strategyName === 'diversified_trend' && timeframe !== 'D1')
      throw new Error('Diversified trend requires D1');
    if (timeframe === this.timeframe) return;
    this.timeframe = timeframe;
    this.lastBarTimes.clear();
    this.symbolStates.clear();
    this.snapshot = {
      ...this.snapshot,
      timeframe,
      status: 'WAITING_BAR',
      detail: `timeframe changed to ${timeframe}, re-priming bars`,
      symbolStates: {},
    };
  }

  start(): void {
    if (this.timer) return;
    // Prime on the first tick rather than in the constructor so a boot failure
    // in the broker cannot take the API down with it.
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.pollIntervalMs ?? DEFAULTS.pollIntervalMs);
    void this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One evaluation. Exposed so tests and a future manual trigger can drive it. */
  async tick(): Promise<RunnerSnapshot> {
    if (this.running) return this.state;
    this.running = true;
    try {
      return await this.evaluate();
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        status: 'BLOCKED',
        lastCheckAt: new Date().toISOString(),
        detail: (error as Error).message,
      };
      await this.reporter.failed({
        strategy: this.options.strategyName,
        symbol: this.options.symbols.join(','),
        error: (error as Error).message,
      });
      return this.state;
    } finally {
      this.running = false;
    }
  }

  /**
   * One pass over every watched symbol.
   *
   * Symbols are independent: a symbol whose bars do not arrive must not stop the
   * others from being evaluated, and each keeps its own last acted bar so one
   * symbol's tick never advances another's. The reported status is the most
   * consequential outcome of the pass, so a signal on any symbol stays visible
   * even when another symbol was blocked.
   */
  private async evaluate(): Promise<RunnerSnapshot> {
    const { strategyName, symbols } = this.options;
    const timeframe = this.timeframe;
    const history = this.options.strategyName === 'diversified_trend'
      ? Math.max(305, this.options.history ?? 0) : this.options.history ?? DEFAULTS.history;

    // A sleeping terminal is routine, not an evaluation failure: report it as a
    // blocked state without touching the broker or writing an audit row every
    // poll, then pick straight back up when the connection returns.
    if (!this.broker.connected) {
      // Symbols are marked blocked individually too, otherwise the dashboard
      // keeps showing a stale per-symbol verdict from before the outage.
      for (const symbol of symbols)
        this.record(symbol, {
          status: 'BLOCKED',
          lastBarAt: null,
          secondsToNextBar: null,
          detail: 'broker disconnected',
        });
      return this.set('BLOCKED', 'broker disconnected');
    }

    let best: Outcome = { status: 'IDLE' };
    const allowedSymbols = this.options.getAllowedSymbols
      ? new Set(await this.options.getAllowedSymbols())
      : undefined;
    const consider = (outcome: Outcome) => {
      if (SEVERITY[outcome.status] > SEVERITY[best.status]) best = outcome;
    };

    for (const symbol of symbols) {
      if (allowedSymbols && !allowedSymbols.has(symbol)) {
        this.lastBarTimes.delete(symbol);
        this.lastFailures.delete(symbol);
        this.record(symbol, {
          status: 'BLOCKED',
          lastBarAt: null,
          secondsToNextBar: null,
          detail: 'Disabled in Allowed symbols',
        });
        continue;
      }
      try {
        consider(await this.evaluateSymbol(symbol, timeframe, history));
        this.lastFailures.delete(symbol);
      } catch (error) {
        const message = (error as Error).message;
        // A broken symbol fails on every poll. Audit it once per distinct
        // message so the trail records the outage rather than the poll rate.
        if (this.lastFailures.get(symbol) !== message) {
          this.lastFailures.set(symbol, message);
          await this.reporter.failed({
            strategy: strategyName,
            symbol,
            error: message,
          });
        }
        this.record(symbol, {
          status: 'BLOCKED',
          lastBarAt: null,
          secondsToNextBar: null,
          detail: message,
        });
        consider({ status: 'BLOCKED', detail: message });
      }
    }
    if (best.status === 'IDLE' && symbols.length > 0)
      return this.set(
        'BLOCKED',
        'No watched symbols enabled in Allowed symbols',
      );
    return this.set(best.status, best.detail);
  }

  private record(symbol: string, state: SymbolState): void {
    this.symbolStates.set(symbol, {
      ...state,
      ...(state.lastBarAt ? { marketForces: this.marketForces.get(symbol) } : {}),
      ...(state.lastBarAt && this.options.strategyName === 'market_forces_shock'
        ? { forceShock: this.forceShocks.get(symbol) } : {}),
      ...(state.lastBarAt && this.options.strategyName === 'diversified_trend'
        ? { diversifiedTrend: this.trendReadings.get(symbol) } : {}),
    });
  }

  /**
   * Indicator levels for the last closed bar, plus how far the pair still is
   * from a setup on each condition.
   *
   * `evaluateMeanReversion` returns null unless *both* conditions are met, so
   * this recomputes the same values from the same series to answer "why not".
   * The RSI distance is in RSI points to the relevant extreme and the band
   * distance is a fraction of band width, which keeps a 1.13 EURUSD and a 4156
   * XAUUSD on one comparable scale.
   */
  private levels(rates: ReadonlyArray<Rate>): Partial<SymbolState> {
    const config = { ...defaultMeanReversionConfig, ...this.options.config };
    const closes = rates.map((rate) => rate.c);
    const bands = bollingerBands(
      closes,
      config.bollingerLength,
      config.bollingerMultiplier,
    );
    const series = rsi(closes, config.rsiLength);
    // Offset 1 mirrors the decision: the last closed bar, never the forming one.
    const close = at(closes, 1);
    const upper = at(bands.upper, 1);
    const lower = at(bands.lower, 1);
    const value = at(series, 1);
    if (close === null || upper === null || lower === null || value === null)
      return {};

    const width = upper - lower;
    // Below the midline the pair is a buy candidate, above it a sell candidate,
    // so the distance quoted is always to the side it is actually working toward.
    const towardsBuy = value < 50;
    const band = towardsBuy ? close - lower : upper - close;
    return {
      close,
      rsi: Number(value.toFixed(2)),
      upper,
      lower,
      rsiToTrigger: Number(
        (towardsBuy
          ? config.rsiOversold - value
          : value - config.rsiOverbought
        ).toFixed(2),
      ),
      bandToTrigger: width > 0 ? Number((band / width).toFixed(4)) : undefined,
    };
  }

  /** Computes seconds until the next bar boundary for a timeframe. */
  private secondsToNextBar(barTime: number, timeframe: Timeframe): number {
    const seconds: Record<Timeframe, number> = {
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
    const size = seconds[timeframe];
    const lastBoundary = Math.floor(barTime / size) * size;
    return Math.max(0, lastBoundary + size - Math.floor(Date.now() / 1000));
  }

  private async evaluateSymbol(
    symbol: string,
    timeframe: Timeframe,
    history: number,
  ): Promise<Outcome> {
    // Two bars are enough to detect a new closed candle. Keep the full RSI
    // warm-up for priming and decisions, not for every unchanged-bar poll.
    const primed = this.lastBarTimes.has(symbol);
    let rates = await this.broker.getRates(
      symbol,
      timeframe,
      primed ? 2 : history,
    );
    if (
      primed &&
      rates.length >= 2 &&
      lastClosedBarTime(rates) !== this.lastBarTimes.get(symbol)
    ) {
      rates = await this.broker.getRates(symbol, timeframe, history);
    }
    // A live timeframe switch may happen while the bridge request is pending.
    if (timeframe !== this.timeframe) return { status: 'WAITING_BAR' };
    if (rates.length === 0) {
      const detail = `no ${timeframe} bars returned for ${symbol}`;
      this.record(symbol, {
        status: 'BLOCKED',
        lastBarAt: null,
        secondsToNextBar: null,
        detail,
      });
      return { status: 'BLOCKED', detail };
    }

    const barTime = lastClosedBarTime(rates);
    if (barTime === null) {
      const detail = `not enough bars to close one on ${symbol}`;
      this.record(symbol, {
        status: 'BLOCKED',
        lastBarAt: null,
        secondsToNextBar: null,
        detail,
      });
      return { status: 'BLOCKED', detail };
    }

    const secondsToNextBar = this.secondsToNextBar(barTime, timeframe);
    if (!primed || barTime !== this.lastBarTimes.get(symbol)) {
      this.marketForces.set(symbol, evaluateMarketForces(rates));
      if (this.options.strategyName === 'diversified_trend')
        this.trendReadings.set(symbol, evaluateDiversifiedTrend(rates, this.options.trendConfig));
      if (this.options.strategyName === 'market_forces_shock')
        this.forceShocks.set(symbol, evaluateForceShockStrategy(rates, this.options.shockConfig));
    }

    // A restart must not replay the bar that was already acted on. The engine
    // dedupes by signal id, so seeding from the current bar is enough, and it
    // means a crash mid-bar never double-trades.
    const lastBarTime = this.lastBarTimes.get(symbol);
    if (lastBarTime === undefined) {
      this.lastBarTimes.set(symbol, barTime);
      this.record(symbol, {
        status: 'WAITING_BAR',
        lastBarAt: iso(barTime),
        secondsToNextBar,
        detail: 'primed, waiting for the next bar to close',
        ...(this.options.strategyName === 'sma_micro_trend'
          ? this.smaLevels(rates, symbol)
          : this.options.strategyName === 'dow_theory'
            ? this.dowLevels(rates)
            : this.options.strategyName === 'diversified_trend'
              ? { close: rates.at(-2)?.c, trend: this.trendReadings.get(symbol)?.side ?? 'NEUTRAL' }
            : ['market_forces', 'market_forces_shock'].includes(this.options.strategyName)
              ? { close: rates.at(-2)?.c, trend: this.marketForces.get(symbol)?.direction }
            : this.levels(rates)),
      });
      return { status: 'WAITING_BAR', detail: `primed at bar ${iso(barTime)}` };
    }
    if (barTime === lastBarTime) {
      if (['sma_micro_trend', 'dow_theory', 'market_forces', 'market_forces_shock', 'diversified_trend'].includes(this.options.strategyName)) {
        this.record(symbol, { ...this.symbolStates.get(symbol), status: 'WAITING_BAR', lastBarAt: iso(barTime), secondsToNextBar } as SymbolState);
        return { status: 'WAITING_BAR' };
      }
      // Keep the previous RSI/band reading so the dashboard still shows how far
      // this pair is from a setup while the bar is forming, but refresh the
      // countdown so it ticks down live.
      // Carry the last RSI/band reading forward so the dashboard keeps showing
      // how far this pair is from a setup while the bar is still forming.
      const { close, rsi, upper, lower, rsiToTrigger, bandToTrigger, side } =
        this.symbolStates.get(symbol) ?? {};
      this.record(symbol, {
        status: 'WAITING_BAR',
        lastBarAt: iso(barTime),
        secondsToNextBar,
        detail: 'waiting for the next bar to close',
        ...(close !== undefined ? { close } : {}),
        ...(rsi !== undefined ? { rsi } : {}),
        ...(upper !== undefined ? { upper } : {}),
        ...(lower !== undefined ? { lower } : {}),
        ...(rsiToTrigger !== undefined ? { rsiToTrigger } : {}),
        ...(bandToTrigger !== undefined ? { bandToTrigger } : {}),
        ...(side !== undefined ? { side } : {}),
      });
      return { status: 'WAITING_BAR' };
    }
    if (this.options.strategyName === 'sma_micro_trend')
      return this.evaluateSmaSymbol(symbol, timeframe, rates, barTime, secondsToNextBar);
    if (this.options.strategyName === 'dow_theory')
      return this.evaluateDowSymbol(symbol, timeframe, rates, barTime, secondsToNextBar);
    if (['market_forces', 'market_forces_shock'].includes(this.options.strategyName))
      return this.evaluateForcesSymbol(symbol, timeframe, rates, barTime, secondsToNextBar);
    if (this.options.strategyName === 'diversified_trend')
      return this.evaluateTrendSymbol(symbol, timeframe, barTime, secondsToNextBar);
    // Entry conditions depend on closed bars, not on the quote. Obtain the
    // price only for actual setups and then size protective distances from mid.
    const decision = evaluateMeanReversion(
      rates,
      {
        ...defaultMeanReversionConfig,
        ...this.options.config,
        symbol,
        timeframe,
      },
      1,
    );

    if (!decision) {
      this.lastBarTimes.set(symbol, barTime);
      this.record(symbol, {
        status: 'NO_SETUP',
        lastBarAt: iso(barTime),
        secondsToNextBar,
        detail: 'no band touch with RSI extreme',
        ...this.levels(rates),
      });
      await this.report(symbol, 'no_setup', barTime);
      return { status: 'NO_SETUP' };
    }

    const price = await this.broker.getPrice(symbol);
    if (timeframe !== this.timeframe) return { status: 'WAITING_BAR' };
    const mid = (price.bid + price.ask) / 2;
    const signal = this.buildSignal(symbol, decision.side, barTime, {
      stopDistance: mid * decision.stopDistance,
      takeProfitDistance: mid * decision.takeProfitDistance,
    });
    signal.signalReason = `${decision.side}: closed candle close=${decision.close} ${decision.side === 'BUY' ? '<= lower' : '>= upper'} Bollinger band=${decision.side === 'BUY' ? decision.lower : decision.upper}; RSI=${decision.rsiValue} ${decision.side === 'BUY' ? '<= oversold' : '>= overbought'} threshold=${decision.side === 'BUY' ? (this.options.config?.rsiOversold ?? defaultMeanReversionConfig.rsiOversold) : (this.options.config?.rsiOverbought ?? defaultMeanReversionConfig.rsiOverbought)}; timeframe=${timeframe}; bar=${iso(barTime)}`;
    this.lastBarTimes.set(symbol, barTime);
    const result = await this.engine.process(signal, {
      requestId: `strategy:${this.options.strategyName}:${barTime}`,
      ip: 'strategy-runner',
      receivedAt: Date.now(),
    });

    this.record(symbol, {
      status: 'SIGNAL',
      lastBarAt: iso(barTime),
      secondsToNextBar,
      side: decision.side,
      detail: `${decision.side} ${result.status.toLowerCase()}`,
      ...this.levels(rates),
    });

    await this.report(
      symbol,
      result.status.toLowerCase(),
      barTime,
      decision,
      result.status === 'REJECTED' ? result.reason : undefined,
    );
    return {
      status: 'SIGNAL',
      detail: `${decision.side} ${result.status.toLowerCase()}`,
    };
  }

  private async evaluateForcesSymbol(
    symbol: string, timeframe: Timeframe, rates: ReadonlyArray<Rate>,
    barTime: number, secondsToNextBar: number,
  ): Promise<Outcome> {
    const reading = evaluateMarketForces(rates);
    const finish = (status: RunnerStatus, detail: string, side?: string): Outcome => {
      this.lastBarTimes.set(symbol, barTime);
      this.record(symbol, { status, detail, side, lastBarAt: iso(barTime), secondsToNextBar,
        close: rates.at(-2)?.c, trend: reading.direction });
      return { status, detail };
    };
    const shock = this.options.strategyName === 'market_forces_shock'
      ? this.forceShocks.get(symbol) : undefined;
    if (this.options.strategyName === 'market_forces_shock' && (!shock || shock.blocked)) {
      const reason = shock?.reason ?? 'Choque: leitura indisponível; aguardar.';
      const outcome = finish('NO_SETUP', reason);
      await this.reporter.evaluated({ strategy: this.options.strategyName, symbol, timeframe,
        outcome: 'shock_blocked', barTime: iso(barTime), reason });
      return outcome;
    }
    if (reading.action === 'WAIT')
      return finish('NO_SETUP', `Market forces: ${reading.reasons.join(' ')}`);
    const positions = await this.broker.getPositions();
    if (timeframe !== this.timeframe) return { status: 'WAITING_BAR' };
    if (positions.some((p) => p.symbol === symbol))
      return finish('NO_SETUP', 'Market forces: position already open for symbol');
    const volatility = atr(rates.slice(0, -1), 14).at(-1);
    if (volatility == null || !Number.isFinite(volatility) || volatility <= 0)
      return finish('BLOCKED', 'Market forces: invalid ATR');
    const quote = await this.broker.getPrice(symbol);
    if (timeframe !== this.timeframe) return { status: 'WAITING_BAR' };
    const spread = Math.max(quote.spread, quote.ask - quote.bid);
    if (![quote.bid, quote.ask, spread].every(Number.isFinite) || quote.bid <= 0 || quote.ask < quote.bid || spread < 0 || spread > volatility * 0.2)
      return finish('BLOCKED', 'Market forces: invalid quote or spread above 20% ATR');
    const signal = this.buildSignal(symbol, reading.action, barTime, {
      stopDistance: volatility * 2,
      takeProfitDistance: volatility * 4,
    });
    signal.signalReason = `Market forces ${reading.action}; friction=${reading.frictionScore}/100; ${reading.reasons.join(' ')}; timeframe=${timeframe}; bar=${iso(barTime)}`;
    if (shock) signal.signalReason += `; shock=${shock.shock.index}; ${shock.reason}`;
    // Consume before submission: an uncertain broker outcome must not replay an entry.
    this.lastBarTimes.set(symbol, barTime);
    const result = await this.engine.process(signal, {
      requestId: `strategy:${signal.signalId}`, ip: 'strategy-runner', receivedAt: Date.now(),
    });
    const outcome = finish(result.status === 'EXECUTED' ? 'SIGNAL' : 'BLOCKED',
      `${reading.action} ${result.status.toLowerCase()}${result.status === 'REJECTED' ? `: ${result.reason}` : ''}`, reading.action);
    await this.reporter.evaluated({ strategy: this.options.strategyName, symbol, timeframe,
      outcome: result.status.toLowerCase(), barTime: iso(barTime), side: reading.action,
      reason: result.status === 'REJECTED' ? result.reason : signal.signalReason });
    return outcome;
  }

  private async evaluateTrendSymbol(symbol: string, timeframe: Timeframe, barTime: number, secondsToNextBar: number): Promise<Outcome> {
    const config = this.options.trendConfig ?? defaultDiversifiedTrendConfig;
    const reading = this.trendReadings.get(symbol)!;
    const finish = (status: RunnerStatus, detail: string, side?: string): Outcome => {
      this.lastBarTimes.set(symbol, barTime);
      this.record(symbol, { status, detail, side, lastBarAt: iso(barTime), secondsToNextBar,
        close: reading.close ?? undefined, atr: reading.atr ?? undefined, trend: reading.side ?? 'NEUTRAL' });
      return { status, detail };
    };
    if (!(TREND_FOREX_SYMBOLS as readonly string[]).includes(symbol))
      return finish('BLOCKED', 'Diversified trend: unsupported Forex symbol');
    if (!reading.ready) return finish('NO_SETUP', 'Daily momentum/volatility history not ready');
    const allPositions = await this.broker.getPositions();
    const positions = allPositions.filter((p) => p.symbol === symbol);
    if (timeframe !== this.timeframe) return { status: 'WAITING_BAR' };
    if (positions.length && positions.every((p) => p.side === reading.side))
      return finish('NO_SETUP', 'Holding aligned daily trend position');
    if (positions.length) {
      const close: TradingSignal = { strategy: this.options.strategyName,
        signalId: `${this.options.strategyName}:${symbol}:${timeframe}:${barTime}:close`,
        symbol, action: 'CLOSE', orderType: 'MARKET', timeframe, closeReason: 'SIGNAL',
        signalReason: `Daily trend changed or neutral; score=${reading.score}` };
      this.lastBarTimes.set(symbol, barTime);
      const result = await this.engine.process(close, { requestId: `strategy:${close.signalId}`, ip: 'strategy-runner', receivedAt: Date.now() });
      if (result.status !== 'EXECUTED' || (await this.broker.getPositions()).some((p) => p.symbol === symbol))
        return finish('BLOCKED', 'Daily trend exit not confirmed');
      if (!reading.side) return finish('SIGNAL', 'Daily neutral trend: position closed', 'CLOSE');
    }
    if (!reading.side) return finish('NO_SETUP', 'Daily momentum in neutral zone');
    const [account, info, quote, maximumLot] = await Promise.all([
      this.broker.getAccount(), this.broker.getSymbol(symbol), this.broker.getPrice(symbol),
      this.options.getMaximumLotSize?.() ?? getSettings().then((s) => s.maximumLotSize),
    ]);
    if (timeframe !== this.timeframe) return { status: 'WAITING_BAR' };
    const spread = Math.max(quote.spread, quote.ask - quote.bid);
    if (![quote.bid, quote.ask, spread].every(Number.isFinite) || quote.bid <= 0 || quote.ask < quote.bid || spread < 0 || spread > reading.atr! * 0.05)
      return finish('BLOCKED', 'Daily trend: invalid quote or spread above 5% ATR');
    let usedNotional = 0;
    for (const position of allPositions.filter((p) => p.symbol !== symbol)) {
      const specification = await this.broker.getSymbol(position.symbol);
      const value = specification.tickValueLoss ?? specification.tickValue;
      const exposure = position.currentPrice / specification.tickSize * value * position.lots;
      if (!Number.isFinite(exposure) || exposure < 0 || specification.tickSize <= 0 || value <= 0)
        return finish('BLOCKED', 'Daily trend: cannot verify current gross allocation');
      usedNotional += exposure;
    }
    const notionalPerLot = reading.close! / info.tickSize * (info.tickValueLoss ?? info.tickValue);
    const availableLots = Math.max(0, account.equity * config.maximumGrossLeverage - usedNotional) / notionalPerLot;
    const lots = sizeDiversifiedTrend(account.equity, reading.close!, reading.annualVolatility!,
      this.options.symbols.length, info, Math.min(maximumLot, availableLots), config);
    if (lots === null) return finish('BLOCKED', 'Daily trend: volatility allocation below broker minimum or invalid specification');
    const signal: TradingSignal = { strategy: this.options.strategyName,
      signalId: `${this.options.strategyName}:${symbol}:${timeframe}:${barTime}:${reading.side}`,
      symbol, action: reading.side, orderType: 'MARKET', timeframe, lots,
      stopLoss: reading.atr! * config.stopAtr, takeProfit: reading.atr! * config.stopAtr * config.rewardRisk,
      maximumEntrySpread: reading.atr! * 0.05, minimumEntryStopDistance: reading.atr! * config.stopAtr,
      signalReason: `Daily time-series momentum; lookback=${config.lookback}; score=${reading.score}; annualVol=${reading.annualVolatility}; legs=${this.options.symbols.length}; config=${JSON.stringify(config)}` };
    this.lastBarTimes.set(symbol, barTime);
    const result = await this.engine.process(signal, { requestId: `strategy:${signal.signalId}`, ip: 'strategy-runner', receivedAt: Date.now() });
    const detail = `${reading.side} ${result.status.toLowerCase()}${result.status === 'REJECTED' ? `: ${result.reason}` : ''}`;
    await this.reporter.evaluated({ strategy: this.options.strategyName, symbol, timeframe, outcome: result.status.toLowerCase(),
      barTime: iso(barTime), side: reading.side, reason: result.status === 'REJECTED' ? result.reason : signal.signalReason });
    return finish(result.status === 'EXECUTED' ? 'SIGNAL' : 'BLOCKED', detail, reading.side);
  }

  private smaLevels(rates: ReadonlyArray<Rate>, symbol: string): Partial<SymbolState> {
    const value = evaluateSmaMicroTrend(rates, this.scopedSmaConfig(symbol));
    return { close: value.close ?? undefined, fastSMA: value.fastSMA ?? undefined,
      slowSMA: value.slowSMA ?? undefined, atr: value.atr ?? undefined, trend: value.trend };
  }

  private dowLevels(rates: ReadonlyArray<Rate>): Partial<SymbolState> {
    const reading = evaluateDowTheory(rates, this.options.dowConfig ?? defaultDowTheoryConfig);
    return {
      close: reading.close ?? undefined,
      trend: reading.trend,
    };
  }

  private async evaluateDowSymbol(
    symbol: string,
    timeframe: Timeframe,
    rates: ReadonlyArray<Rate>,
    barTime: number,
    secondsToNextBar: number,
  ): Promise<Outcome> {
    const reading = evaluateDowTheory(rates, this.options.dowConfig ?? defaultDowTheoryConfig);
    const levels = this.dowLevels(rates);
    if (reading.trend === 'NOT_READY') {
      this.lastBarTimes.set(symbol, barTime);
      this.record(symbol, {
        status: 'NO_SETUP',
        lastBarAt: iso(barTime),
        secondsToNextBar,
        detail: 'not enough confirmed Dow swing points',
        ...levels,
      });
      return { status: 'NO_SETUP' };
    }
    if (!reading.signal || reading.stopPrice === null || reading.close === null) {
      this.lastBarTimes.set(symbol, barTime);
      this.record(symbol, {
        status: 'NO_SETUP',
        lastBarAt: iso(barTime),
        secondsToNextBar,
        detail: `Dow ${reading.trend}: waiting for a confirmed swing breakout`,
        ...levels,
      });
      return { status: 'NO_SETUP' };
    }

    const positions = (await this.broker.getPositions()).filter((position) => position.symbol === symbol);
    if (positions.length > 0) {
      this.lastBarTimes.set(symbol, barTime);
      const detail = 'Dow breakout ignored while a position is already open for this symbol';
      this.record(symbol, { status: 'NO_SETUP', lastBarAt: iso(barTime), secondsToNextBar, detail, ...levels });
      return { status: 'NO_SETUP', detail };
    }

    const quote = await this.broker.getPrice(symbol);
    if (timeframe !== this.timeframe) return { status: 'WAITING_BAR' };
    const entryPrice = reading.signal === 'BUY' ? quote.ask : quote.bid;
    const stopDistance = reading.signal === 'BUY'
      ? entryPrice - reading.stopPrice
      : reading.stopPrice - entryPrice;
    const spread = Math.max(0, quote.spread, quote.ask - quote.bid);
    if (!Number.isFinite(stopDistance) || stopDistance <= spread) {
      this.lastBarTimes.set(symbol, barTime);
      const detail = 'Dow swing stop is not beyond the entry price and spread';
      this.record(symbol, { status: 'BLOCKED', lastBarAt: iso(barTime), secondsToNextBar, detail, ...levels });
      return { status: 'BLOCKED', detail };
    }

    const signal = this.buildSignal(symbol, reading.signal, barTime, {
      stopDistance,
      takeProfitDistance: stopDistance * (this.options.dowConfig ?? defaultDowTheoryConfig).rewardRiskRatio,
    });
    signal.signalReason = `Dow ${reading.trend} breakout on closed ${timeframe} bar ${iso(barTime)}; close=${reading.close}; pivotHigh=${reading.pivotHigh}; pivotLow=${reading.pivotLow}`;
    const result = await this.engine.process(signal, {
      requestId: `strategy:${signal.signalId}`,
      ip: 'strategy-runner',
      receivedAt: Date.now(),
    });
    this.lastBarTimes.set(symbol, barTime);
    this.record(symbol, {
      status: result.status === 'EXECUTED' ? 'SIGNAL' : 'BLOCKED',
      lastBarAt: iso(barTime),
      secondsToNextBar,
      side: reading.signal,
      trend: reading.trend,
      detail: `${reading.signal} ${result.status.toLowerCase()}`,
      ...levels,
    });
    await this.reporter.evaluated({
      strategy: this.options.strategyName,
      symbol,
      timeframe,
      outcome: result.status.toLowerCase(),
      barTime: iso(barTime),
      side: reading.signal,
      close: reading.close,
      reason: result.status === 'REJECTED' ? result.reason : signal.signalReason,
    });
    return {
      status: result.status === 'EXECUTED' ? 'SIGNAL' : 'BLOCKED',
      detail: `${reading.signal} ${result.status.toLowerCase()}`,
    };
  }

  private async evaluateSmaSymbol(symbol: string, timeframe: Timeframe, rates: ReadonlyArray<Rate>, barTime: number, secondsToNextBar: number): Promise<Outcome> {
    const config = this.scopedSmaConfig(symbol, timeframe);
    const reading = evaluateSmaMicroTrend(rates, config);
    const levels = this.smaLevels(rates, symbol);
    if (reading.trend === 'NOT_READY' || !config.enabled) {
      this.lastBarTimes.set(symbol, barTime);
      this.record(symbol, { status: 'NO_SETUP', lastBarAt: iso(barTime), secondsToNextBar, detail: 'indicators not ready or strategy disabled', ...levels });
      return { status: 'NO_SETUP' };
    }
    const positions = (await this.broker.getPositions()).filter((p) => p.symbol === symbol);
    if (config.risk.useATRTrailingStop && reading.atr && reading.close !== null) {
      const info = await this.broker.getSymbol(symbol);
      if (!Number.isFinite(info.tickSize) || info.tickSize <= 0 || !Number.isFinite(info.stopsLevel) || info.stopsLevel < 0)
        throw new Error('Invalid broker tick size or stop level');
      for (const position of positions) {
        if (position.stopLoss === undefined || !Number.isFinite(position.stopLoss)) continue;
        const candidate = atrTrailingStop(position.side, position.stopLoss, reading.close, reading.atr, config.risk.atrTrailingMultiplier);
        const ticks = position.side === 'BUY' ? Math.floor(candidate / info.tickSize) : Math.ceil(candidate / info.tickSize);
        const stop = Number((ticks * info.tickSize).toFixed(10));
        const price = await this.broker.getPrice(symbol);
        const market = position.side === 'BUY' ? price.bid : price.ask;
        if (stop > 0 && (position.side === 'BUY' ? stop > position.stopLoss && stop < market - info.stopsLevel : stop < position.stopLoss && stop > market + info.stopsLevel)) {
          const result = await this.broker.modifyPosition(position.id, stop, position.takeProfit);
          if (result.status !== 'FILLED') throw new Error(result.reason ?? 'Trailing stop rejected');
        }
      }
    }
    let action: TradingSignal['action'] | null = reading.signal;
    if (!action && config.operations.closeOnNeutralTrend && reading.neutral && positions.length)
      action = 'CLOSE';
    if (reading.signal && positions.some((p) => p.side !== reading.signal) && !config.operations.reverseOnOppositeSignal)
      action = null;
    if (reading.signal && positions.some((p) => p.side === reading.signal))
      action = null;
    if (!action) {
      this.lastBarTimes.set(symbol, barTime);
      this.record(symbol, { status: 'NO_SETUP', lastBarAt: iso(barTime), secondsToNextBar, detail: reading.neutral ? 'neutral zone' : 'no crossover', ...levels });
      return { status: 'NO_SETUP' };
    }
    if (action !== 'CLOSE' && (!reading.atr || !Number.isFinite(reading.atr * config.risk.atrStopMultiplier))) {
      this.lastBarTimes.set(symbol, barTime);
      return { status: 'BLOCKED', detail: 'ATR stop invalid' };
    }
    if (reading.signal && config.filters.requireMacroTrendAlignment) {
      const macroTimeframe = resolveMacroTimeframe(timeframe, config.filters.macroTimeframe);
      if (!macroTimeframe) {
        const detail = 'Macro timeframe must be higher than entry timeframe';
        this.record(symbol, { status: 'BLOCKED', lastBarAt: iso(barTime), secondsToNextBar, detail, ...levels });
        return { status: 'BLOCKED', detail };
      }
      const macroRates = await this.broker.getRates(symbol, macroTimeframe, Math.max(DEFAULTS.history, config.indicators.slowSMA + 2));
      const macroTrend = macroTrendAt(macroRates, rates.at(-1)!.t, config);
      if (macroTrend === 'NOT_READY') {
        const detail = `${macroTimeframe} trend not ready`;
        this.record(symbol, { status: 'BLOCKED', lastBarAt: iso(barTime), secondsToNextBar, detail, macroTrend, macroTimeframe, ...levels });
        return { status: 'BLOCKED', detail };
      }
      if ((reading.signal === 'BUY' && macroTrend !== 'UP') || (reading.signal === 'SELL' && macroTrend !== 'DOWN')) {
        const detail = `${timeframe} ${reading.signal} not aligned with closed ${macroTimeframe} ${macroTrend}`;
        this.lastBarTimes.set(symbol, barTime);
        this.record(symbol, { status: 'NO_SETUP', lastBarAt: iso(barTime), secondsToNextBar, detail, macroTrend, macroTimeframe, ...levels });
        return { status: 'NO_SETUP', detail };
      }
    }
    if (action !== 'CLOSE') {
      const quote = await this.broker.getPrice(symbol);
      const spread = Math.max(0, quote.spread, quote.ask - quote.bid);
      if (spread > reading.atr! * SMA_MAX_SPREAD_ATR) {
        this.lastBarTimes.set(symbol, barTime);
        const detail = `Spread ${spread.toFixed(6)} exceeds ${SMA_MAX_SPREAD_ATR} ATR`;
        this.record(symbol, { status: 'BLOCKED', lastBarAt: iso(barTime), secondsToNextBar, detail, ...levels });
        return { status: 'BLOCKED', detail };
      }
    }
    this.lastBarTimes.set(symbol, barTime);
    if (reading.signal && action === reading.signal && positions.some((p) => p.side !== reading.signal)) {
      const closeSignal: TradingSignal = {
        strategy: this.options.strategyName,
        signalId: `${this.options.strategyName}:${symbol}:${timeframe}:${barTime}:close_opposite`,
        symbol, action: reading.signal === 'BUY' ? 'CLOSE_SHORT' : 'CLOSE_LONG',
        orderType: 'MARKET', timeframe, closeReason: 'SIGNAL',
      };
      const closeResult = await this.engine.process(closeSignal, { requestId: `strategy:${closeSignal.signalId}`, ip: 'strategy-runner', receivedAt: Date.now() });
      if (closeResult.status !== 'EXECUTED' || (await this.broker.getPositions()).some((p) => p.symbol === symbol && p.side !== reading.signal)) {
        this.record(symbol, { status: 'BLOCKED', lastBarAt: iso(barTime), secondsToNextBar, detail: 'Opposite position close not confirmed', ...levels });
        return { status: 'BLOCKED', detail: 'Opposite position close not confirmed' };
      }
    }
    const signal: TradingSignal = {
      strategy: this.options.strategyName,
      signalId: `${this.options.strategyName}:${symbol}:${timeframe}:${barTime}:${action}`,
      symbol, action, orderType: 'MARKET', timeframe,
      ...(action !== 'CLOSE' ? {
        lots: config.risk.lots,
        stopLoss: config.risk.useATRStop ? reading.atr! * config.risk.atrStopMultiplier : undefined,
        maximumEntrySpread: reading.atr! * SMA_MAX_SPREAD_ATR,
        minimumEntryStopDistance: reading.atr! * SMA_MIN_STOP_ATR,
      } : {}),
      signalReason: `${action} on closed ${timeframe} bar ${iso(barTime)}; fast=${reading.fastSMA}; slow=${reading.slowSMA}; ATR=${reading.atr}`,
    };
    const result = await this.engine.process(signal, { requestId: `strategy:${signal.signalId}`, ip: 'strategy-runner', receivedAt: Date.now() });
    this.record(symbol, { status: result.status === 'EXECUTED' ? 'SIGNAL' : 'BLOCKED', lastBarAt: iso(barTime), secondsToNextBar, side: action, detail: `${action} ${result.status.toLowerCase()}`, ...levels });
    return { status: result.status === 'EXECUTED' ? 'SIGNAL' : 'BLOCKED', detail: `${action} ${result.status.toLowerCase()}` };
  }

  private buildSignal(
    symbol: string,
    side: 'BUY' | 'SELL',
    barTime: number,
    stops: { stopDistance: number; takeProfitDistance: number },
  ): TradingSignal {
    const { strategyName } = this.options;
    return {
      strategy: strategyName,
      // Deterministic per bar: a retried evaluation collides on the engine's
      // unique index instead of opening a second position.
      signalId: `${strategyName}:${symbol}:${this.timeframe}:${barTime}:${side}`,
      symbol,
      action: side,
      orderType: 'MARKET',
      lots: this.options.config?.lots ?? defaultMeanReversionConfig.lots,
      stopLoss: stops.stopDistance,
      takeProfit: stops.takeProfitDistance,
      timeframe: this.timeframe,
    };
  }

  private async report(
    symbol: string,
    outcome: string,
    barTime: number,
    decision?: {
      side: string;
      close: number;
      rsiValue: number;
      upper: number;
      lower: number;
    },
    reason?: string,
  ): Promise<void> {
    await this.reporter.evaluated({
      strategy: this.options.strategyName,
      symbol,
      timeframe: this.timeframe,
      outcome,
      barTime: iso(barTime),
      ...(decision
        ? {
            side: decision.side,
            close: decision.close,
            rsi: Number(decision.rsiValue.toFixed(2)),
            upper: decision.upper,
            lower: decision.lower,
          }
        : {}),
      ...(reason ? { reason } : {}),
    });
  }

  private set(
    status: RunnerStatus,
    detail: string | undefined,
  ): RunnerSnapshot {
    const next: RunnerSnapshot = {
      ...this.snapshot,
      status,
      lastCheckAt: new Date().toISOString(),
      symbolStates: Object.fromEntries(this.symbolStates),
    };
    // Detail is per-pass, so a stale reason must not outlive the pass that set it.
    if (detail) next.detail = detail;
    else delete next.detail;
    this.snapshot = next;
    return this.state;
  }
}

function iso(barTime: number): string {
  return new Date(barTime * 1000).toISOString();
}

/**
 * Registers the strategy row the engine requires, and makes sure every watched
 * symbol is tradable under the active risk settings.
 *
 * Both are easy to miss and fail late: an unregistered strategy is rejected as
 * `Unknown strategy`, and an unlisted symbol as `Symbol not allowed`, both of
 * which look like the strategy simply not firing.
 */
export async function ensureStrategy(
  strategyName: string,
  symbols: string[],
): Promise<{ ok: boolean; detail: string }> {
  const settings = await getSettings();
  const permitted = new Set(settings.allowedSymbols);
  const enabledSymbols = symbols.filter((symbol) => permitted.has(symbol));
  if (enabledSymbols.length === 0) {
    return {
      ok: false,
      detail:
        'No watched symbols enabled in Allowed symbols. Enable at least one before starting the runner.',
    };
  }

  // The strategy row carries its own allowlist that the risk manager checks per
  // signal, so widening the watch list has to widen this too or every new symbol
  // is rejected as "Strategy disabled or symbol not allowed".
  const wanted = [...new Set(enabledSymbols)];
  const existing = await db.query.strategies.findFirst({
    where: eq(schema.strategies.name, strategyName),
  });
  if (existing) {
    const missing = wanted.filter(
      (symbol) => !(existing.allowedSymbols ?? []).includes(symbol),
    );
    if (missing.length > 0) {
      await db
        .update(schema.strategies)
        .set({
          allowedSymbols: [...(existing.allowedSymbols ?? []), ...missing],
          updatedAt: new Date(),
        })
        .where(eq(schema.strategies.id, existing.id));
      await audit('STRATEGY', 'symbols_allowed', undefined, undefined, {
        strategy: strategyName,
        symbols: missing,
      });
    }
    return { ok: true, detail: 'strategy already registered' };
  }

  await db
    .insert(schema.strategies)
    .values({
      name: strategyName,
      description:
        strategyName === 'sma_micro_trend'
          ? 'SMA crossover trend strategy with Wilder ATR risk controls; no profitability claim.'
          : strategyName === 'dow_theory'
            ? 'Dow Theory swing-structure breakout with swing-based stop and fixed reward/risk target; no profitability claim.'
          : strategyName === 'diversified_trend'
            ? 'Daily time-series momentum on major Forex pairs with inverse-volatility entry sizing and capped per-leg budgets.'
          : strategyName === 'market_forces_shock'
            ? 'Market forces with causal opposing-price shock guard and three-bar cooldown; 2 ATR stop and 4 ATR target.'
          : strategyName === 'market_forces'
            ? 'Aligned direction, swing structure and candle pressure with low friction; 2 ATR stop and 4 ATR target.'
          : 'Bollinger Bands + RSI mean reversion. Port of MeanReversion_BB_RSI_MT5 to the bot; no profitability claim.',
      enabled: true,
      allowedSymbols: wanted,
    })
    .onConflictDoNothing();
  await audit('STRATEGY', 'registered', undefined, undefined, {
    strategy: strategyName,
    symbols,
  });
  return { ok: true, detail: 'strategy registered' };
}
