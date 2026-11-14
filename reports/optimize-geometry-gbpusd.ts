import type { Rate } from '@trade/shared';
import { atr, evaluateMarketForces } from '../packages/strategy/src';
import { priceGeometry, type PriceGeometry } from '../packages/strategy/src/price-geometry';
import { protectiveExit } from './backtest-market-forces';

type Parameters = { lookback: number; minSlope: number; minEfficiency: number;
  determinant: 'ANY' | 'ACCELERATING' | 'DECELERATING'; stopAtr: number; rewardRisk: number };
type Feature = { atr: number; side: 'BUY' | 'SELL' | null; baseline: 'BUY' | 'SELL' | null;
  geometry: Record<number, PriceGeometry | null> };
const root = new URL('./', import.meta.url);
const raw = await Bun.file(new URL('gbpusd-h1-bid-2016-2025.json', root)).json();
const bars: Rate[] = raw.map((b: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }) =>
  ({ t: b.timestamp / 1000, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
if (bars.length < 55000 || bars.some((b, i) => ![b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) || b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c) || (i > 0 && b.t <= bars[i - 1]!.t)))
  throw new Error('Invalid or insufficient historical input');
const features: Feature[] = bars.map((_, i) => {
  const history = bars.slice(Math.max(0, i - 119), i + 1);
  const closed = history.slice(0, -1);
  const a = atr(closed, 14).at(-1) ?? 0;
  const forces = evaluateMarketForces(history);
  const side = forces.frictionScore !== null && forces.frictionScore < 50
    ? forces.direction === 'UP' && forces.pressure === 'BUY' ? 'BUY'
      : forces.direction === 'DOWN' && forces.pressure === 'SELL' ? 'SELL' : null
    : null;
  return { atr: a, side, baseline: forces.action === 'WAIT' ? null : forces.action,
    geometry: Object.fromEntries([8, 16, 32].map((n) => [n, priceGeometry(closed, n, a)])) };
});
const spans = {
  train: [Date.UTC(2016, 0, 1) / 1000, Date.UTC(2021, 0, 1) / 1000],
  validation: [Date.UTC(2021, 0, 1) / 1000, Date.UTC(2023, 0, 1) / 1000],
  test: [Date.UTC(2023, 0, 1) / 1000, Date.UTC(2026, 0, 1) / 1000],
} as const;
type Span = keyof typeof spans;
const indices = Object.fromEntries(Object.entries(spans).map(([name, [from, to]]) =>
  [name, bars.flatMap((b, i) => b.t >= from && b.t < to && i >= 41 && i < bars.length - 1 ? [i] : [])])) as Record<Span, number[]>;
const costs = { base: { spread: 0.00012, slippage: 0 }, stress: { spread: 0.00018, slippage: 0.000012 } };
type Cost = keyof typeof costs;
const fee = 0.07; // USD 7 per full lot round trip x 0.01 lot.

function simulate(p: Parameters, span: Span, costName: Cost, baseline = false) {
  const cost = costs[costName];
  let position: { side: 'BUY' | 'SELL'; entry: number; stop: number; target: number; enteredAt: number } | null = null;
  let net = 0, peak = 0, dd = 0, wins = 0, losses = 0, grossWin = 0, grossLoss = 0, trades = 0;
  let streak = 0, maxLosingStreak = 0;
  const annual: Record<string, { trades: number; netUsd: number }> = {};
  const pnl = (exit: number) => (exit - position!.entry) * (position!.side === 'BUY' ? 1 : -1) * 1000 - fee;
  const exit = (price: number, t: number) => {
    const value = pnl(price);
    net += value; trades++;
    if (value > 0) { wins++; grossWin += value; streak = 0; }
    else if (value < 0) { losses++; grossLoss -= value; streak++; }
    maxLosingStreak = Math.max(maxLosingStreak, streak);
    const year = new Date(t * 1000).getUTCFullYear();
    const record = annual[year] ??= { trades: 0, netUsd: 0 };
    record.trades++; record.netUsd += value;
    position = null;
  };
  for (const i of indices[span]) {
    const b = bars[i]!, f = features[i]!;
    let side = baseline ? f.baseline : f.side;
    if (!baseline && side) {
      const g = f.geometry[p.lookback];
      const sign = side === 'BUY' ? 1 : -1;
      if (!g || g.slope * sign < p.minSlope || g.efficiency < p.minEfficiency ||
        (p.determinant === 'ACCELERATING' && g.determinant * sign < 0.02) ||
        (p.determinant === 'DECELERATING' && g.determinant * sign > -0.02)) side = null;
    }
    if (!position && side && f.atr > 0 && cost.spread <= 0.2 * f.atr) {
      const sign = side === 'BUY' ? 1 : -1;
      const entry = b.o + (side === 'BUY' ? cost.spread + cost.slippage : -cost.slippage);
      position = { side, entry, enteredAt: b.t, stop: entry - sign * f.atr * p.stopAtr,
        target: entry + sign * f.atr * p.stopAtr * p.rewardRisk };
    }
    if (position) {
      const hit = protectiveExit(position, b, cost.spread, cost.slippage);
      const worst = hit?.reason === 'SL' ? hit.exit : position.side === 'BUY' ? b.l : b.h + cost.spread;
      dd = Math.max(dd, peak - (net + pnl(worst)));
      if (hit) exit(hit.exit, b.t);
    }
    const marked = net + (position ? pnl(b.c + (position.side === 'BUY' ? 0 : cost.spread)) : 0);
    peak = Math.max(peak, marked);
    dd = Math.max(dd, peak - marked);
  }
  // Liquidate at each split end; no position/outcome crosses selection boundaries.
  if (position) {
    const b = bars[indices[span].at(-1)!]!;
    exit(b.c + (position.side === 'BUY' ? -cost.slippage : cost.spread + cost.slippage), b.t);
    dd = Math.max(dd, peak - net);
  }
  return { netUsd: net, drawdownUsd: dd, trades, wins, losses, winRate: trades ? wins / trades : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null, maxLosingStreak, annual,
    score: net - 0.5 * dd };
}

const candidates = [];
for (const lookback of [8, 16, 32])
  for (const minSlope of [0.03, 0.1])
    for (const minEfficiency of [0.2, 0.35, 0.5])
      for (const determinant of ['ANY', 'ACCELERATING', 'DECELERATING'] as const)
        for (const stopAtr of [1.5, 2, 3])
          for (const rewardRisk of [1.5, 2, 3]) {
            const parameters: Parameters = { lookback, minSlope, minEfficiency, determinant, stopAtr, rewardRisk };
            const train = simulate(parameters, 'train', 'stress');
            candidates.push({ parameters, train });
          }
const qualified = candidates.filter((c) => c.train.trades >= 100 && c.train.netUsd > 0 && (c.train.profitFactor ?? 0) >= 1.05);
const shortlist = (qualified.length ? qualified : candidates.filter((c) => c.train.trades >= 100))
  .toSorted((a, b) => b.train.score - a.train.score).slice(0, 30)
  .map((c) => ({ ...c, validation: simulate(c.parameters, 'validation', 'stress') }));
if (!shortlist.length) throw new Error('No configurations with sufficient trades');
const validated = shortlist.filter((c) => c.validation.trades >= 40 && c.validation.netUsd > 0 && (c.validation.profitFactor ?? 0) >= 1.05);
const selected = (validated.length ? validated : shortlist).toSorted((a, b) => b.validation.score - a.validation.score)[0]!;
const baselineParameters: Parameters = { lookback: 16, minSlope: 0, minEfficiency: 0, determinant: 'ANY', stopAtr: 2, rewardRisk: 2 };
const comparison = (['train', 'validation', 'test'] as Span[]).flatMap((span) => (['base', 'stress'] as Cost[]).map((cost) =>
  ({ span, cost, optimized: simulate(selected.parameters, span, cost), baseline: simulate(baselineParameters, span, cost, true) })));
const ablation = { noDeterminant: simulate({ ...selected.parameters, determinant: 'ANY' }, 'test', 'stress'),
  noSlope: simulate({ ...selected.parameters, minSlope: 0 }, 'test', 'stress'),
  noEfficiency: simulate({ ...selected.parameters, minEfficiency: 0 }, 'test', 'stress') };
const finalTest = comparison.find((r) => r.span === 'test' && r.cost === 'stress')!.optimized;
const testPassed = finalTest.netUsd > 0 && (finalTest.profitFactor ?? 0) >= 1.05 && finalTest.trades >= 40;
const report = { generatedAt: new Date().toISOString(), strategy: 'geometric_market_forces_research', symbol: 'GBPUSD', timeframe: 'H1',
  lot: 0.01, candidates: candidates.length, trainingQualified: qualified.length, validationQualified: validated.length,
  selectionPassed: qualified.length > 0 && validated.length > 0, testPassed,
  splits: { train: '2016–2020', validation: '2021–2022', test: '2023–2025' }, selected, comparison, ablation,
  trainingGrid: candidates,
  topValidation: shortlist.toSorted((a, b) => b.validation.score - a.validation.score).slice(0, 10),
  assumptions: [
    'Retrospective temporal split: aggregate 2016–2025 results were already inspected previously. Test is NOT pristine independent evidence.',
    'No optimization against test-period outcomes; selected config frozen after train/validation before test evaluation.',
    'Features use only closed bars, 120-bar rolling ATR; regression slope ATR/candle, path efficiency and normalized 2x2 determinant.',
    'Determinant of unit vectors (1, earlySlope), (1, recentSlope) is sine of signed turning angle. Direction-aligned sign distinguishes acceleration/deceleration; not a probability.',
    'Geometry candidate replaces Dow structure gate with geometric filters, retaining SMA direction, candle pressure and friction <50. Original baseline retains its own Dow gate.',
    'Training search under stress; rank net P&L minus 0.5 drawdown, min 100 trades, P&L >0, PF>=1.05. Top 30 enter validation.',
    'Validation min 40 trades, P&L >0, PF>=1.05; rank same score. If none qualify, best fallback displayed explicitly, not approved.',
    'USD; 0.01 fixed lot; commission scenario USD 0.07 round trip, reserved at entry; swap not simulated.',
    'Base spread 1.2 pips; stress spread 1.8 pips and adverse slippage 0.12 pip per market fill; no historical variable spreads.',
    'Same OHLC stop-first/gap mechanics as prior research, conservative approximate monetary DD; no margin/daily-loss caps or capital depletion simulation.',
    'Each split starts flat and liquidates at its final close; past bars may warm up features. Last dataset candle excluded.',
    'Ablation on test is diagnostic only, not a new parameter selection. Live strategy/settings unchanged.',
  ] };
await Bun.write(new URL('geometry-optimization-gbpusd-2016-2025.json', root), JSON.stringify(report, null, 2));
const money = (n: number | null) => n == null ? '—' : n.toFixed(2);
const pct = (n: number | null) => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
const lines = ['# Otimização geométrica — GBPUSD H1, 2016–2025', '',
  `Configurações: ${report.candidates}. Aprovadas no treino: ${qualified.length}. Aprovadas na validação: ${validated.length}. Critérios de seleção atendidos: ${report.selectionPassed ? 'SIM' : 'NÃO'}.`,
  `Resultado no teste temporal final aprovado: ${testPassed ? 'SIM' : 'NÃO'}.`,
  '', '## Conclusão', '',
  testPassed ? 'O candidato selecionado permaneceu positivo no teste temporal; isso ainda exige validação prospectiva independente.' : 'O candidato selecionado não sustentou vantagem no teste temporal. Não há base para promover esta configuração à execução automática.',
  `A remoção diagnóstica do determinante no teste produziu USD ${money(ablation.noDeterminant.netUsd)} contra USD ${money(finalTest.netUsd)} do candidato. Este contraste é retrospectivo e não autoriza selecionar novamente usando o teste.`,
  'A geometria reduziu perdas frente à regra original no teste, mas melhora relativa não equivale a rentabilidade. A busca e as comparações posteriores têm risco de sobreajuste.',
  '', '## Parâmetros selecionados', '', '```json', JSON.stringify(selected.parameters, null, 2), '```', '',
  '| Janela | Custos | Trades otimizado/original | P&L otimizado/original USD | Acerto otimizado | PF otimizado | DD otimizado/original USD |',
  '|---|---|---:|---:|---:|---:|---:|',
  ...comparison.map((r) => `| ${r.span} | ${r.cost} | ${r.optimized.trades} / ${r.baseline.trades} | ${money(r.optimized.netUsd)} / ${money(r.baseline.netUsd)} | ${pct(r.optimized.winRate)} | ${money(r.optimized.profitFactor)} | ${money(r.optimized.drawdownUsd)} / ${money(r.baseline.drawdownUsd)} |`),
  '', '## Teste temporal 2023–2025 por ano — stress', '',
  '| Ano | Trades | P&L USD |', '|---|---:|---:|',
  ...Object.entries(comparison.find((r) => r.span === 'test' && r.cost === 'stress')!.optimized.annual).map(([year, r]) => `| ${year} | ${r.trades} | ${money(r.netUsd)} |`),
  '', '## Ablação no teste — stress', '',
  '| Filtro removido | Trades | P&L USD | PF | DD USD |', '|---|---:|---:|---:|---:|',
  ...Object.entries(ablation).map(([name, r]) => `| ${name} | ${r.trades} | ${money(r.netUsd)} | ${money(r.profitFactor)} | ${money(r.drawdownUsd)} |`),
  '', '## Metodologia e limitações', '', ...report.assumptions.map((a) => `- ${a}`),
];
await Bun.write(new URL('geometry-optimization-gbpusd-2016-2025.md', root), lines.join('\n') + '\n');
console.log(`Tested ${candidates.length} configs; train qualified=${qualified.length}; validation qualified=${validated.length}`);
console.log('Selected:', selected.parameters);
console.table(comparison.map((r) => ({ split: r.span, cost: r.cost, trades: r.optimized.trades,
  netUsd: money(r.optimized.netUsd), baselineUsd: money(r.baseline.netUsd), winRate: pct(r.optimized.winRate),
  pf: money(r.optimized.profitFactor), ddUsd: money(r.optimized.drawdownUsd) })));
console.log('Ablation:', ablation);
