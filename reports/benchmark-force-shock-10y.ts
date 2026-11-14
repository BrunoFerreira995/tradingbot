import type { Rate } from '@trade/shared';
import { defaultForceShockConfig } from '../packages/strategy/src';
import { simulate } from './backtest-market-forces';

const root = new URL('./', import.meta.url);
const raw = await Bun.file(new URL('gbpusd-h1-bid-2016-2025.json', root)).json();
const bars: Rate[] = raw.map((b: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }) =>
  ({ t: b.timestamp / 1000, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
if (bars.length < 55000 || bars[0]!.t > Date.UTC(2016, 0, 5) / 1000 || bars.at(-1)!.t < Date.UTC(2025, 11, 30) / 1000)
  throw new Error('Incomplete ten-year coverage');
const rows = [];
for (const scenario of ['base', 'stress'] as const) {
  for (const strategy of ['market_forces', 'market_forces_shock'] as const) {
    const result = simulate(bars, 'GBPUSD', scenario === 'base' ? 0.00012 : 0.00018,
      scenario === 'base' ? 0 : 0.000012, undefined, strategy === 'market_forces_shock' ? {} : undefined);
    const annual = Array.from({ length: 10 }, (_, i) => {
      const year = i + 2016;
      const trades = result.trades.filter((t) => new Date(t.exitedAt * 1000).getUTCFullYear() === year);
      return { year, trades: trades.length, netUsd: trades.reduce((n, t) => n + t.pnl, 0) };
    });
    if (annual.reduce((n, y) => n + y.trades, 0) !== result.tradeCount || Math.abs(annual.reduce((n, y) => n + y.netUsd, 0) - result.netUsd) > 1e-7)
      throw new Error('Annual totals mismatch');
    let streak = 0, maxLosingStreak = 0;
    for (const trade of result.trades) {
      streak = trade.pnl < 0 ? streak + 1 : 0;
      maxLosingStreak = Math.max(maxLosingStreak, streak);
    }
    rows.push({ strategy, scenario, ...result, annual, maxLosingStreak, monthlyAverageUsd: result.netUsd / 120 });
  }
}
const report = { generatedAt: new Date().toISOString(), symbol: 'GBPUSD', timeframe: 'H1', period: '2016–2025',
  lot: 0.01, parameters: defaultForceShockConfig, rows,
  assumptions: ['Dukascopy UTC bid candles, 62345 observations; same dataset as ten-year base benchmark.',
    'Only entry filter differs: shock threshold 1.18, cooldown 3 closed candles. Same evaluator as live strategy; same stops/targets and execution mechanics.',
    'Base spread 1.2 pips; stress spread 1.8 pips + adverse slippage 0.12 pip per market fill. Commission/swap excluded for comparability with initial ten-year benchmark.',
    'Conservative OHLC drawdown estimate; no margin/insolvency, engine monetary stops or daily-loss simulation.',
    'Threshold derived from this same historical dataset; retrospective comparison, NOT independent validation. No parameter search in this run.',
    'Shock blocked count measures candidate bar setups rejected by guard, not guaranteed missed executable trades; bars may overlap an open position.',
    'Open P&L separate; last dataset candle excluded, matching prior benchmark.'],
};
await Bun.write(new URL('force-shock-benchmark-10y-2016-2025.json', root), JSON.stringify(report, null, 2));
const money = (n: number | null) => n === null ? '—' : n.toFixed(2);
const lines = ['# Benchmark — filtro de choque, GBPUSD H1, 2016–2025', '',
  `Lote: 0,01. Choque ≥ ${defaultForceShockConfig.threshold}; janela de ${defaultForceShockConfig.cooldownBars} candles.`, '',
  '| Estratégia | Cenário | Trades | Acerto | P&L USD | PF | DD USD | Média/mês USD | Setups bloqueados por choque |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map((r) => `| ${r.strategy} | ${r.scenario} | ${r.tradeCount} | ${r.winRate === null ? '—' : (r.winRate * 100).toFixed(1) + '%'} | ${money(r.netUsd)} | ${money(r.profitFactor)} | ${money(r.maxSymbolDrawdownUsd)} | ${money(r.monthlyAverageUsd)} | ${r.shockBlocked} |`),
  '', '## Resultado anual (operações fechadas, USD)', '',
  '| Ano | Original base | Choque base | Original stress | Choque stress |', '|---|---:|---:|---:|---:|',
  ...Array.from({ length: 10 }, (_, i) => `| ${2016 + i} | ${rows.map((r) => money(r.annual[i]!.netUsd)).join(' | ')} |`),
  '', '## Posições abertas e sequência de perdas', '',
  ...rows.map((r) => `- ${r.strategy} / ${r.scenario}: P&L aberto USD ${money(r.openPnlUsd)}; máxima sequência de perdas ${r.maxLosingStreak}.`),
  '', '## Premissas', '', ...report.assumptions.map((a) => `- ${a}`),
];
await Bun.write(new URL('force-shock-benchmark-10y-2016-2025.md', root), lines.join('\n') + '\n');
console.table(rows.map((r) => ({ strategy: r.strategy, scenario: r.scenario, trades: r.tradeCount,
  winRate: r.winRate, pnlUsd: r.netUsd, pf: r.profitFactor, drawdownUsd: r.maxSymbolDrawdownUsd,
  shockBlocked: r.shockBlocked, monthlyAverageUsd: r.monthlyAverageUsd })));
