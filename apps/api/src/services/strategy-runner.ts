import { db, schema } from '@trade/database';
import { eq } from 'drizzle-orm';
import type { BrokerAdapter } from '@trade/broker';
import type { Rate, Timeframe, TradingSignal } from '@trade/shared';
import {
  at,
  bollingerBands,
  defaultMeanReversionConfig,
  evaluateMeanReversion,
  lastClosedBarTime,
  rsi,
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
  status: RunnerStatus;
  /** Timestamp of the last closed bar that was evaluated, ISO 8601. */
  lastBarAt: string | null;
  /** Seconds until this symbol's next bar closes on the active timeframe. */
  secondsToNextBar: number | null;
  close?: number;
  rsi?: number;
  upper?: number;
  lower?: number;
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
  constructor(
    private broker: BrokerAdapter,
    private engine: TradingEngine,
    private options: StrategyRunnerOptions,
  ) {
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

  get state(): RunnerSnapshot {
    return { ...this.snapshot };
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
    const history = this.options.history ?? DEFAULTS.history;

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
    const consider = (outcome: Outcome) => {
      if (SEVERITY[outcome.status] > SEVERITY[best.status]) best = outcome;
    };

    for (const symbol of symbols) {
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
    return this.set(best.status, best.detail);
  }

  private record(symbol: string, state: SymbolState): void {
    this.symbolStates.set(symbol, state);
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
    const rates = await this.broker.getRates(symbol, timeframe, history);
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
        ...this.levels(rates),
      });
      return { status: 'WAITING_BAR', detail: `primed at bar ${iso(barTime)}` };
    }
    if (barTime === lastBarTime) {
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
    this.lastBarTimes.set(symbol, barTime);

    // The stop is a percentage of this reference. Mid is used rather than the
    // side-specific price because the side is what the evaluation is deciding.
    const price = await this.broker.getPrice(symbol);
    const decision = evaluateMeanReversion(
      rates,
      {
        ...defaultMeanReversionConfig,
        ...this.options.config,
        symbol,
        timeframe,
      },
      (price.bid + price.ask) / 2,
    );

    if (!decision) {
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

    const signal = this.buildSignal(symbol, decision.side, barTime, {
      stopDistance: decision.stopDistance,
      takeProfitDistance: decision.takeProfitDistance,
    });
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
  const notAllowed = symbols.filter((symbol) => !permitted.has(symbol));
  if (notAllowed.length > 0) {
    return {
      ok: false,
      detail: `${notAllowed.join(', ')} not in risk_settings.allowedSymbols (currently ${settings.allowedSymbols.join(', ') || 'empty'}). Add them before enabling the runner.`,
    };
  }

  // The strategy row carries its own allowlist that the risk manager checks per
  // signal, so widening the watch list has to widen this too or every new symbol
  // is rejected as "Strategy disabled or symbol not allowed".
  const wanted = [...new Set([...(settings.allowedSymbols ?? []), ...symbols])];
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
        'Bollinger Bands + RSI mean reversion. Port of MeanReversion_BB_RSI_MT5 to the bot; no profitability claim.',
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
