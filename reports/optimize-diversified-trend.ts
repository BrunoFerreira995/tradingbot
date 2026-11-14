import type { Rate } from '@trade/shared';
import { createHash } from 'node:crypto';
import { TREND_FOREX_SYMBOLS, defaultDiversifiedTrendConfig, type DiversifiedTrendConfig,
  normalizeForexDailyRates, prepareTrendMarket, backtestDiversifiedTrend, type PreparedTrendMarket } from '../packages/strategy/src';

const root = new URL('./', import.meta.url);
const data: Record<string, Rate[]> = {};
const coverage = [];
for (const symbol of TREND_FOREX_SYMBOLS) {
  const file = Bun.file(new URL(`trend-${symbol.toLowerCase()}-d1-2014-2025.json`, root));
  const bytes = await file.arrayBuffer();
  const raw: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }> = JSON.parse(new TextDecoder().decode(bytes));
  if (raw.some((b, i) => i > 0 && b.timestamp <= raw[i - 1]!.timestamp)) throw new Error(`Unordered source ${symbol}`);
  data[symbol] = normalizeForexDailyRates(raw.map((b) => ({ t: b.timestamp / 1000, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume })));
  for (let year = 2014; year <= 2025; year++) {
    if (data[symbol]!.filter((b) => new Date(b.t * 1000).getUTCFullYear() === year).length < 240) throw new Error(`Incomplete year ${symbol} ${year}`);
  }
  coverage.push({ symbol, rawBars: raw.length, normalizedBars: data[symbol]!.length,
    from: data[symbol]![0]!.t, to: data[symbol]!.at(-1)!.t,
    sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex') });
}
const splits = { train: [2016, 2021], validation: [2021, 2023], test: [2023, 2026], full: [2016, 2026] } as const;
type Split = keyof typeof splits;
const cached = new Map<string, PreparedTrendMarket>();
const spreads = { EURUSD: 0.0001, GBPUSD: 0.00012, USDJPY: 0.012, USDCHF: 0.00011, USDCAD: 0.00011, AUDUSD: 0.00011, NZDUSD: 0.00012 };
const prepare = (config: DiversifiedTrendConfig, single = false) => {
  const key = `${config.lookback}:${config.volatilityPeriod}:${config.minimumScore}:${single}`;
  if (!cached.has(key)) cached.set(key, prepareTrendMarket(single ? { GBPUSD: data.GBPUSD! } : data, config));
  return cached.get(key)!;
};
const run = (config: DiversifiedTrendConfig, split: Split, scenario: 'base' | 'stress', single = false) => {
  const years = splits[split];
  return backtestDiversifiedTrend(prepare(config, single), config, {
    from: Date.UTC(years[0], 0, 1) / 1000, to: Date.UTC(years[1], 0, 1) / 1000,
    initialCapital: 10000, spreads,
    spreadMultiplier: scenario === 'base' ? 1 : 1.5, slippageFraction: scenario === 'base' ? 0 : 0.1,
    commissionPerLotRoundTrip: scenario === 'base' ? 7 : 10,
    annualFinancingDrag: scenario === 'base' ? 0 : 0.02,
  });
};
const summarize = (r: ReturnType<typeof run>) => {
  const { trades: _trades, curve: _curve, ...summary } = r;
  void _trades; void _curve;
  return { ...summary, score: r.sharpe - r.maxDrawdown };
};
const trials = [];
for (const lookback of [63, 126, 252])
  for (const volatilityPeriod of [20, 60])
    for (const minimumScore of [0, 0.5])
      for (const stopAtr of [2, 3, 4])
        for (const rewardRisk of [3, 6]) {
          const config = { ...defaultDiversifiedTrendConfig, lookback, volatilityPeriod, minimumScore, stopAtr, rewardRisk };
          trials.push({ config, train: summarize(run(config, 'train', 'stress')) });
        }
const trainQualified = trials.filter((t) => t.train.tradeCount >= 60 && t.train.netUsd > 0 && (t.train.profitFactor ?? 0) >= 1.05 && t.train.maxDrawdown <= 0.2);
const shortlist = (trainQualified.length ? trainQualified : trials.filter((t) => t.train.tradeCount >= 60))
  .toSorted((a, b) => b.train.score - a.train.score).slice(0, 12)
  .map((t) => ({ ...t, validation: summarize(run(t.config, 'validation', 'stress')) }));
if (!shortlist.length) throw new Error('No candidates with enough trades');
const validationQualified = shortlist.filter((t) => t.validation.tradeCount >= 20 && t.validation.netUsd > 0 && (t.validation.profitFactor ?? 0) >= 1.05);
const selected = (validationQualified.length ? validationQualified : shortlist).toSorted((a, b) => b.validation.score - a.validation.score)[0]!;
// Freeze here: no test-period results above this line enter parameter selection.
const comparisons = (['test', 'full'] as Split[]).flatMap((split) => (['base', 'stress'] as const).flatMap((scenario) =>
  ([['selected_portfolio', selected.config, false], ['default_portfolio', defaultDiversifiedTrendConfig, false], ['selected_GBPUSD', selected.config, true]] as const)
    .map(([name, config, single]) => ({ split, scenario, name, ...summarize(run(config, split, scenario, single)) }))));
const full = run(selected.config, 'full', 'base');
const annual = Array.from({ length: 10 }, (_, i) => {
  const year = 2016 + i;
  const points = full.curve.filter((p) => new Date(p.t * 1000).getUTCFullYear() === year);
  const previous = full.curve.filter((p) => new Date(p.t * 1000).getUTCFullYear() < year).at(-1)?.equity ?? 10000;
  return { year, startEquity: previous, endEquity: points.at(-1)!.equity, pnlUsd: points.at(-1)!.equity - previous,
    return: points.at(-1)!.equity / previous - 1 };
});
if (Math.abs(annual.reduce((n, y) => n + y.pnlUsd, 0) - full.netUsd) > 1e-6) throw new Error('Annual equity reconciliation failed');
const test = comparisons.find((r) => r.split === 'test' && r.scenario === 'stress' && r.name === 'selected_portfolio')!;
const approved = trainQualified.length > 0 && validationQualified.length > 0 && test.netUsd > 0 && (test.profitFactor ?? 0) >= 1.05;
const report = { generatedAt: new Date().toISOString(), strategy: 'diversified_trend', source: 'Dukascopy bid daily UTC, 2014–2025',
  evaluation: '2016–2025; 2014–2015 warmup only', coverage, trials: trials.length,
  trainingQualified: trainQualified.length, validationQualified: validationQualified.length, approved,
  selected, comparisons, annual, trainingGrid: trials, shortlist,
  assumptions: [
    'Trend-inspired adaptation, NOT replication of Moskowitz/Ooi/Pedersen: spot Forex rather than diversified futures, with ATR SL/TP and discrete lots.',
    'Seven USD majors are correlated; risk budget 10% is sum of standalone volatility budgets, NOT predicted portfolio volatility. Gross leverage capped at entry to 2x; exposures drift between entries.',
    'Sizing at entry only, no daily rebalancing; 10000 USD start for every split, 0.01 lot minimum/step, 100000 base currency per lot.',
    'USD-base currency profits converted at exit quote. Cash, realized trades and funding reconciled. MTM equity used for portfolio DD/Sharpe; DD is DAILY CLOSE, not intraday risk.',
    'Daily volatility from log returns, annualization 252; momentum 63/126/252 sessions. UTC Sunday merged into Monday, research session calendar differs from MT5 server daily candles.',
    'Indicators warmed up from past data; entries next open; no future prices enter features. Stop/target at entry, same-bar stop-first, gaps adverse for SL and no favorable TP gap improvement.',
    'Base commissions USD 7/lot round trip, archived fixed median spreads, zero slippage, NO swap. Stress spread1.5x, slippage0.1x base spread, commission USD10/lot, negative financing2% annual gross notional.',
    'Funding stress is a hypothetical uniformly negative drag, NOT actual historical swaps or interest differentials. Base results without swap are optimistic for long holds.',
    'Selection under stress: train2016–20, min60 trades/PF1.05/positive net/DD<=20%; top12 to validation2021–22, min20 trades/PF1.05/positive net. Score Sharpe minus DD fraction.',
    'Only 72 configurations; no per-pair parameter fitting or removal of losing symbols. Test2023–25 used only after selection froze. GBPUSD aggregate periods have been viewed previously; not pristine independent validation.',
    'Full2016–25 includes training and selection periods: descriptive, not out-of-sample. GBPUSD alone uses same total budget as portfolio, not same lot.',
    'Not a full trading-engine replay: broker market hours, account-specific risk limits, execution failures, riskPercentage/monetary-stop overrides not reproduced.',
    'Candidate config is saved for research, not promoted automatically to live settings. Positive backtest does not establish a persistent edge.',
  ] };
await Bun.write(new URL('diversified-trend-optimization-2016-2025.json', root), JSON.stringify(report, null, 2));
await Bun.write(new URL('diversified-trend-candidate-config.json', root), JSON.stringify(selected.config, null, 2));
const pct = (n: number | null) => n == null ? '—' : `${(100 * n).toFixed(2)}%`;
const money = (n: number | null) => n == null ? '—' : n.toFixed(2);
const lines = ['# Tendência diversificada — busca limitada e benchmark', '',
  `Fonte: ${report.source}. Capital inicial: USD 10000. Avaliação: ${report.evaluation}.`,
  `Configurações: ${trials.length}; qualificadas treino: ${trainQualified.length}; validação: ${validationQualified.length}; critérios finais atendidos: ${approved ? 'SIM' : 'NÃO'}.`,
  '', '## Conclusão', '',
  approved ? 'O candidato atende aos critérios nesta avaliação retrospectiva; ainda requer confirmação prospectiva.' : 'Nenhuma configuração foi aprovada ao final. O candidato abaixo é apenas um fallback exploratório, não um conjunto validado para execução.',
  'Diversificação e dimensionamento de risco podem reduzir concentração sem criar uma fonte de retorno positivo. Esta é uma adaptação de tendência, não reprodução da carteira multiclasse dos artigos.',
  '', '## Configuração selecionada', '', '```json', JSON.stringify(selected.config, null, 2), '```', '',
  '| Seleção (stress) | Trades | P&L USD | Sharpe | DD diário | PF |', '|---|---:|---:|---:|---:|---:|',
  ...(['train', 'validation'] as const).map((s) => { const r = selected[s]; return `| ${s} | ${r.tradeCount} | ${money(r.netUsd)} | ${money(r.sharpe)} | ${pct(r.maxDrawdown)} | ${money(r.profitFactor)} |`; }),
  '', '## Benchmark com orçamento de risco comparável', '',
  '| Janela | Cenário | Estratégia | P&L USD | Retorno | CAGR | Sharpe | DD diário | Trades | Acerto | PF |',
  '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...comparisons.map((r) => `| ${r.split} | ${r.scenario} | ${r.name} | ${money(r.netUsd)} | ${pct(r.totalReturn)} | ${pct(r.cagr)} | ${money(r.sharpe)} | ${pct(r.maxDrawdown)} | ${r.tradeCount} | ${pct(r.winRate)} | ${money(r.profitFactor)} |`),
  '', '## Resultado anual — selecionada, carteira, base (inclui treino)', '',
  '| Ano | P&L USD | Retorno anual |', '|---|---:|---:|', ...annual.map((y) => `| ${y.year} | ${money(y.pnlUsd)} | ${pct(y.return)} |`),
  '', '## Contribuição por par — teste2023–25, stress (trades fechados)', '',
  ...Object.entries(test.bySymbol).map(([s, p]) => `- ${s}: USD ${money(p)}.`),
  '', '## Premissas e limites', '', ...report.assumptions.map((a) => `- ${a}`),
];
await Bun.write(new URL('diversified-trend-optimization-2016-2025.md', root), lines.join('\n') + '\n');
console.log(`Trials ${trials.length}; qualified train=${trainQualified.length}, validation=${validationQualified.length}, final=${approved}`);
console.log('Selected:', selected.config);
console.table(comparisons.map((r) => ({ split: r.split, scenario: r.scenario, name: r.name, netUsd: money(r.netUsd),
  return: pct(r.totalReturn), sharpe: money(r.sharpe), dd: pct(r.maxDrawdown), trades: r.tradeCount })));
