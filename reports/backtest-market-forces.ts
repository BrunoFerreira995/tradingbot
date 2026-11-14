import type { Rate } from '@trade/shared';
import { atr, evaluateMarketForces, evaluateForceShockStrategy, type ForceShockConfig } from '../packages/strategy/src';

const files: Record<string, string> = {
  M1: 'post-trade-rates-2026-11-04.json', M5: 'macro-m5-rates-2026-11-04.json',
  M15: 'macro-m15-rates-2026-11-04.json', M30: 'm30-rates-2026-11-04.json', H1: 'h1-rates-2026-11-04.json',
};
const specs: Record<string, [number, number, number]> = {
  EURUSD: [0.00001, 1, 1], USDJPY: [0.001, 0.63133306, 0.63150450],
  USDCAD: [0.00001, 0.71535364, 0.71560447], AUDUSD: [0.00001, 1, 1],
  NZDUSD: [0.00001, 1, 1], USDCNH: [0.00001, 0.14980623, 0.14992032],
  Gasoline: [0.0001, 0.1, 0.1], GBPUSD: [0.00001, 1, 1], USDCHF: [0.00001, 1.22324159, 1.22473974],
};
type Position = { side: 'BUY' | 'SELL'; entry: number; stop: number; target: number; enteredAt: number };
type Trade = Position & { exitedAt: number; exit: number; reason: string; pnl: number };

/** Rates assumed to be MT5 bid candles. Long exits use bid; short exits ask.
 * If both protective levels are hit, stop wins. Stops gap at adverse open;
 * targets fill at their level without favorable gap improvement. */
export function protectiveExit(p: Position, b: Rate, spread: number, slippage: number) {
  const buy = p.side === 'BUY';
  const low = b.l + (buy ? 0 : spread), high = b.h + (buy ? 0 : spread);
  const open = b.o + (buy ? 0 : spread);
  if (buy ? low <= p.stop : high >= p.stop)
    return { exit: (buy ? Math.min(open, p.stop) : Math.max(open, p.stop)) + (buy ? -slippage : slippage), reason: 'SL' };
  if (buy ? high >= p.target : low <= p.target)
    return { exit: p.target, reason: 'TP' };
  return null;
}

export function simulate(bars: Rate[], symbol: string, spread: number, slippage: number, specification?: [number, number, number], shockConfig?: Partial<ForceShockConfig>) {
  const spec = specification ?? specs[symbol];
  if (!spec || !Number.isFinite(spread) || spread < 0 || slippage < 0) throw new Error('Invalid costs/specification');
  if (bars.some((b, i) => ![b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) || b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c) || (i > 0 && b.t <= bars[i - 1]!.t))) throw new Error(`Invalid bars: ${symbol}`);
  const trades: Trade[] = [];
  let position: Position | null = null;
  let candidates = 0, costBlocked = 0, occupied = 0, realized = 0, peak = 0, drawdown = 0;
  let shockBlocked = 0;
  const pnl = (p: Position, exit: number) => {
    const move = (exit - p.entry) * (p.side === 'BUY' ? 1 : -1);
    return move / spec[0] * (move >= 0 ? spec[1] : spec[2]) * 0.01;
  };
  // Last snapshot candle may still be forming, so exclude it even for exits.
  for (let i = 41; i < bars.length - 1; i++) {
    const bar = bars[i]!;
    // Same 120-bar input as the runner. Current bar only proves closure.
    const history = bars.slice(Math.max(0, i - 119), i + 1);
    const guard = shockConfig ? evaluateForceShockStrategy(history, shockConfig) : undefined;
    const reading = guard ?? evaluateMarketForces(history);
    if (guard?.blocked && guard.forces.action !== 'WAIT') shockBlocked++;
    const a = atr(history.slice(0, -1), 14).at(-1);
    if (reading.action !== 'WAIT') {
      candidates++;
      if (position) occupied++;
      else if (a == null || a <= 0 || spread > a * 0.2) costBlocked++;
      else {
        const buy = reading.action === 'BUY';
        const entry = bar.o + (buy ? spread + slippage : -slippage);
        position = { side: reading.action, entry, stop: entry + (buy ? -2 : 2) * a,
          target: entry + (buy ? 4 : -4) * a, enteredAt: bar.t };
      }
    }
    if (position) {
      const hit = protectiveExit(position, bar, spread, slippage);
      // Observe the adverse intrabar excursion before exit for conservative DD.
      const worstQuote = position.side === 'BUY' ? bar.l : bar.h + spread;
      const worst = hit?.reason === 'SL' ? hit.exit : worstQuote;
      drawdown = Math.max(drawdown, peak - (realized + pnl(position, worst)));
      if (hit) {
        const result = pnl(position, hit.exit);
        trades.push({ ...position, ...hit, exitedAt: bar.t, pnl: result });
        realized += result;
        position = null;
      }
    }
    const equity = realized + (position ? pnl(position, bar.c + (position.side === 'BUY' ? 0 : spread)) : 0);
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const sum = (ts: Trade[]) => ts.reduce((n, t) => n + t.pnl, 0);
  const last = bars.at(-2);
  return { symbol, bars: bars.length, from: bars[0]?.t, to: last?.t, spread, slippage, candidates, costBlocked, occupied,
    shockBlocked, tradeCount: trades.length, wins: wins.length, losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : null,
    profitFactor: losses.length ? sum(wins) / -sum(losses) : null,
    netUsd: realized, maxSymbolDrawdownUsd: drawdown,
    openPnlUsd: position && last ? pnl(position, last.c + (position.side === 'BUY' ? 0 : spread)) : 0,
    openPosition: position, trades };
}

if (import.meta.main) {
  const root = new URL('./', import.meta.url);
  const { spreads } = await Bun.file(new URL('sma-optimization-2026-11-04.json', root)).json();
  const results = [];
  for (const [timeframe, file] of Object.entries(files)) {
    const data: Record<string, Rate[]> = await Bun.file(new URL(file, root)).json();
    for (const scenario of ['base', 'stress']) {
      const multiplier = scenario === 'base' ? 1 : 1.5;
      const symbols = Object.keys(specs).filter((symbol) => data[symbol]).map((symbol) =>
        simulate(data[symbol]!, symbol, spreads[symbol] * multiplier, scenario === 'base' ? 0 : spreads[symbol] * 0.1));
      const trades = symbols.flatMap((s) => s.trades);
      const profits = trades.filter((t) => t.pnl > 0).reduce((n, t) => n + t.pnl, 0);
      const losses = -trades.filter((t) => t.pnl < 0).reduce((n, t) => n + t.pnl, 0);
      results.push({ timeframe, scenario, tradeCount: trades.length,
        netUsd: symbols.reduce((n, s) => n + s.netUsd, 0),
        winRate: trades.length ? trades.filter((t) => t.pnl > 0).length / trades.length : null,
        profitFactor: losses > 0 ? profits / losses : null,
        openPnlUsd: symbols.reduce((n, s) => n + s.openPnlUsd, 0), symbols });
    }
  }
  const report = { strategy: 'market_forces', lot: 0.01, generatedAt: new Date().toISOString(),
    assumptions: ['Local MT5 snapshots, not fresh downloads; final candle excluded.',
      'Bid OHLC assumed. Entry at next bar open; one position per symbol; SL=2 ATR, TP=4 ATR.',
      'Fixed historical median spread per symbol; stress=1.5x spread + 0.1x base spread slippage per market fill.',
      'Commission, swap, margin, daily-loss caps, broker hours, engine monetary stop caps and live sizing NOT simulated.',
      'USD conversion uses archived tick values; not historical FX conversion.',
      'No tuning or parameter search. Timeframes overlap and must not be summed.',
      'Per-symbol drawdown is conservative OHLC-based; no portfolio drawdown inferred.'], results };
  await Bun.write(new URL('market-forces-backtest-2026-11-13.json', root), JSON.stringify(report, null, 2));
  const money = (n: number) => n.toFixed(2);
  const lines = ['# Backtest — Market Forces', '', ...report.assumptions.map((a) => `- ${a}`), '',
    '| Período | Cenário | Trades | P&L fechado USD | Acerto | PF | P&L aberto USD |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...results.map((r) => `| ${r.timeframe} | ${r.scenario} | ${r.tradeCount} | ${money(r.netUsd)} | ${r.winRate === null ? '—' : (r.winRate * 100).toFixed(1) + '%'} | ${r.profitFactor?.toFixed(2) ?? '—'} | ${money(r.openPnlUsd)} |`),
    '', '## Leitura dos resultados', '',
    '- M5, M15 e M30 perderam no cenário base; M1 não operou por bloqueio de spread.',
    '- H1 foi positivo nos dois cenários, com lucro concentrado em GBPUSD e USDCHF.',
    '- Apenas 400 candles por ativo/período; cobertura diferente entre timeframes, sem validação independente fora da amostra.',
    '- O cenário stress pode perder menos por bloquear mais entradas; não significa que custos maiores melhoram a estratégia.',
    '- A amostra não sustenta concluir vantagem robusta. Nenhuma configuração de execução foi alterada pelo backtest.',
    '', '## Cobertura por ativo (cenário base)', '',
    '| Período | Ativo | Início UTC* | Fim UTC* | Candles | Trades | P&L USD | Bloqueios spread |',
    '|---|---|---|---|---:|---:|---:|---:|',
    ...results.filter((r) => r.scenario === 'base').flatMap((r) => r.symbols.map((s) => `| ${r.timeframe} | ${s.symbol} | ${new Date(s.from! * 1000).toISOString()} | ${new Date(s.to! * 1000).toISOString()} | ${s.bars} | ${s.tradeCount} | ${money(s.netUsd)} | ${s.costBlocked} |`)),
    '', '*Conversão literal dos timestamps do snapshot; timezone original do servidor não validado.',
    '', 'Valores antes de comissão e swap. Resultado de pesquisa da regra de sinais, não reprodução completa do motor de risco.'];
  await Bun.write(new URL('market-forces-backtest-2026-11-13.md', root), lines.join('\n') + '\n');
  console.table(results.map(({ symbols: _, ...summary }) => summary));
}
