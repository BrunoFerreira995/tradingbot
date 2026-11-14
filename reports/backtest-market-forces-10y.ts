import type { Rate } from '@trade/shared';
import { createHash } from 'node:crypto';
import { simulate } from './backtest-market-forces';

interface Candle { timestamp: number; open: number; high: number; low: number; close: number; volume: number }
const root = new URL('./', import.meta.url);
const input = new URL('gbpusd-h1-bid-2016-2025.json', root);
const bytes = await Bun.file(input).arrayBuffer();
const source: Candle[] = JSON.parse(new TextDecoder().decode(bytes));
const bars: Rate[] = source.map((b) => ({ t: b.timestamp / 1000, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
if (bars.length < 55000 || bars[0]!.t > Date.UTC(2016, 0, 5) / 1000 || bars.at(-1)!.t < Date.UTC(2025, 11, 30) / 1000)
  throw new Error('Insufficient ten-year coverage');
const coverage = Array.from({ length: 10 }, (_, i) => {
  const year = 2016 + i;
  const subset = bars.filter((b) => new Date(b.t * 1000).getUTCFullYear() === year);
  if (subset.length < 5500) throw new Error(`Insufficient data in ${year}: ${subset.length}`);
  return { year, bars: subset.length, from: new Date(subset[0]!.t * 1000).toISOString(), to: new Date(subset.at(-1)!.t * 1000).toISOString() };
});
const gapsOver96Hours = bars.slice(1).flatMap((b, i) => b.t - bars[i]!.t > 96 * 3600
  ? [{ from: bars[i]!.t, to: b.t, hours: (b.t - bars[i]!.t) / 3600 }] : []);
const costs = [
  { name: 'base', spread: 0.00012, slippage: 0 },
  { name: 'stress', spread: 0.00018, slippage: 0.000012 },
];
const results = costs.map((cost) => {
  const result = simulate(bars, 'GBPUSD', cost.spread, cost.slippage);
  let streak = 0, maxConsecutiveLosses = 0;
  for (const trade of result.trades) {
    streak = trade.pnl < 0 ? streak + 1 : 0;
    maxConsecutiveLosses = Math.max(streak, maxConsecutiveLosses);
  }
  const annual = coverage.map(({ year }) => {
    const trades = result.trades.filter((t) => new Date(t.exitedAt * 1000).getUTCFullYear() === year);
    const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
    const sum = (items: typeof trades) => items.reduce((n, t) => n + t.pnl, 0);
    return { year, trades: trades.length, wins: wins.length, losses: losses.length,
      winRate: trades.length ? wins.length / trades.length : null,
      netUsd: sum(trades), profitFactor: losses.length ? sum(wins) / -sum(losses) : null };
  });
  const monthly = Array.from({ length: 120 }, (_, i) => {
    const month = `${2016 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
    const trades = result.trades.filter((t) => new Date(t.exitedAt * 1000).toISOString().startsWith(month));
    return { month, trades: trades.length, netUsd: trades.reduce((n, t) => n + t.pnl, 0) };
  });
  if (annual.reduce((n, y) => n + y.trades, 0) !== result.tradeCount ||
      monthly.reduce((n, m) => n + m.trades, 0) !== result.tradeCount ||
      Math.abs(annual.reduce((n, y) => n + y.netUsd, 0) - result.netUsd) > 1e-7 ||
      Math.abs(monthly.reduce((n, m) => n + m.netUsd, 0) - result.netUsd) > 1e-7 ||
      ![result.netUsd, result.maxSymbolDrawdownUsd].every(Number.isFinite))
    throw new Error(`Aggregation mismatch: ${cost.name}`);
  return { scenario: cost.name, ...result, annual, monthly, maxConsecutiveLosses,
    averageMonthlyClosedPnlUsd: result.netUsd / 120,
    averageYearlyClosedPnlUsd: result.netUsd / 10,
    expectancyUsd: result.tradeCount ? result.netUsd / result.tradeCount : null,
    profitableYears: annual.filter((y) => y.netUsd > 0).length,
    profitableMonths: monthly.filter((m) => m.netUsd > 0).length,
    bestMonth: monthly.toSorted((a, b) => b.netUsd - a.netUsd)[0],
    worstMonth: monthly.toSorted((a, b) => a.netUsd - b.netUsd)[0] };
});
const report = {
  generatedAt: new Date().toISOString(), strategy: 'market_forces', symbol: 'GBPUSD', timeframe: 'H1', lot: 0.01,
  requestedFrom: '2016-01-01T00:00:00Z', requestedToExclusive: '2026-01-01T00:00:00Z',
  source: 'Dukascopy public historical bid candles; dukascopy-node@1.51.1, UTC, volumes enabled, zero-volume flats excluded',
  sourceFile: 'gbpusd-h1-bid-2016-2025.json', sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),
  coverage, gapsOver96Hours,
  assumptions: [
    'Rules unchanged; single continuous simulation per scenario, positions carry across years. Annual/monthly P&L assigned at exit.',
    'Same evaluateMarketForces and rolling 120-bar ATR as live runner. Signals use closed candles, fills next open.',
    'One position per symbol; stop 2 ATR; target 4 ATR; max spread 20% ATR; fixed 0.01 lot.',
    'USD tick specification 0.00001 / 1 USD per full lot; prices from Dukascopy, not the MT5 broker feed.',
    'Base fixed spread 1.2 pips. Stress spread 1.8 pips + 0.12 pip adverse slippage on market entries and stop exits.',
    'Costs are scenarios, NOT historical variable spreads. Commission and swap excluded; overnight holding can be material over ten years.',
    'No simulation of engine monetary stops, margin, daily-loss controls or insolvency; no capital-based return/CAGR implied.',
    'Stop wins if both stop/target touched; stops gap adversely; TP no favorable gap improvement.',
    'DD conservative sampled OHLC monetary estimate using close peaks/adverse intrabar lows, not exact tick equity DD.',
    'Final source candle excluded as in snapshot simulator; first 41 bars warm up. No optimization or independent validation claimed.',
    'Different data source from short benchmark: this is a robustness check, not an exact MT5 execution reproduction.',
  ], results,
};
await Bun.write(new URL('market-forces-gbpusd-h1-10y-2016-2025.json', root), JSON.stringify(report, null, 2));
const money = (n: number | null) => n == null ? '—' : n.toFixed(2);
const pct = (n: number | null) => n == null ? '—' : `${(100 * n).toFixed(1)}%`;
const lines = ['# GBPUSD H1 — backtest de 10 anos (2016–2025)', '',
  `Fonte: ${report.source}. Candles: ${bars.length}. Lote: 0,01.`,
  `SHA-256: \`${report.sha256}\`.`, '',
  '| Cenário | Trades | Acerto | P&L fechado USD | PF | DD estimado USD | Média/mês USD | Anos positivos |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...results.map((r) => `| ${r.scenario} | ${r.tradeCount} | ${pct(r.winRate)} | ${money(r.netUsd)} | ${money(r.profitFactor)} | ${money(r.maxSymbolDrawdownUsd)} | ${money(r.averageMonthlyClosedPnlUsd)} | ${r.profitableYears}/10 |`),
  '', '## Conclusão', '',
  'A regra atual apresentou prejuízo nos dois cenários em dez anos. O resultado positivo da amostra curta de 2026 não se sustentou neste histórico maior de outra fonte. A extrapolação anterior de aproximadamente USD 22/mês não é uma estimativa confiável de rendimento.',
  'Nenhum parâmetro foi otimizado durante este teste; configurações de execução não foram alteradas.',
  '', '## Resultados anuais (operações atribuídas ao ano de saída)', '',
  '| Ano | Candles | Trades base/stress | Acerto base/stress | P&L base USD | P&L stress USD |',
  '|---|---:|---:|---:|---:|---:|',
  ...coverage.map((c, i) => {
    const a = results[0]!.annual[i]!, b = results[1]!.annual[i]!;
    return `| ${c.year} | ${c.bars} | ${a.trades} / ${b.trades} | ${pct(a.winRate)} / ${pct(b.winRate)} | ${money(a.netUsd)} | ${money(b.netUsd)} |`;
  }), '', '## Distribuição e posições abertas', '',
  ...results.flatMap((r) => [
    `### ${r.scenario}`,
    `- Média por trade: USD ${money(r.expectancyUsd)}. Máxima sequência de perdas: ${r.maxConsecutiveLosses}.`,
    `- Meses positivos: ${r.profitableMonths}/120. Melhor mês: ${r.bestMonth!.month}, USD ${money(r.bestMonth!.netUsd)}. Pior: ${r.worstMonth!.month}, USD ${money(r.worstMonth!.netUsd)}.`,
    `- P&L aberto ao final (separado): USD ${money(r.openPnlUsd)}.`,
  ]), '', '## Cobertura', '',
  ...coverage.map((c) => `- ${c.year}: ${c.from} até ${c.to} (${c.bars} candles).`),
  `- Lacunas maiores que 96 horas: ${gapsOver96Hours.length} (detalhes no JSON). Finais de semana e feriados não são preenchidos artificialmente.`,
  '', '## Premissas e limitações', '', ...report.assumptions.map((a) => `- ${a}`),
];
await Bun.write(new URL('market-forces-gbpusd-h1-10y-2016-2025.md', root), lines.join('\n') + '\n');
console.table(results.map((r) => ({ scenario: r.scenario, candles: r.bars, trades: r.tradeCount,
  winRate: pct(r.winRate), pnlUsd: money(r.netUsd), profitFactor: money(r.profitFactor),
  drawdownUsd: money(r.maxSymbolDrawdownUsd), averageMonthUsd: money(r.averageMonthlyClosedPnlUsd), positiveYears: r.profitableYears })));
console.table(results[0]!.annual);
