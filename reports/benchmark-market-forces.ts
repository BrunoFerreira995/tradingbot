/** Run the backtest first: bun reports/backtest-market-forces.ts */
const root = new URL('./', import.meta.url);
interface SymbolResult {
  symbol: string; bars: number; from: number; to: number; tradeCount: number;
  netUsd: number; openPnlUsd: number; profitFactor: number | null; winRate: number | null;
  maxSymbolDrawdownUsd: number; candidates: number; costBlocked: number;
}
interface Result { timeframe: string; scenario: string; symbols: SymbolResult[] }
const report: { results: Result[] } = await Bun.file(new URL('market-forces-backtest-2026-11-13.json', root)).json();
// Read only the non-secret watchlist settings; never export the environment file.
const env = await Bun.file(new URL('../.env', root)).text();
const setting = (name: string) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
const primary = setting('MT5_PRIMARY_SYMBOL') ?? 'XAUUSD';
const symbols = [...new Set([primary, ...(setting('MT5_SYMBOLS') ?? primary).split(',')].map((s) => s.trim()).filter(Boolean))];
const frames = ['M1', 'M5', 'M15', 'M30', 'H1'];
const find = (symbol: string, timeframe: string, scenario: string) => report.results
  .find((r) => r.timeframe === timeframe && r.scenario === scenario)?.symbols.find((s) => s.symbol === symbol);
const rows = symbols.flatMap((symbol) => frames.map((timeframe) => {
  const base = find(symbol, timeframe, 'base'), stress = find(symbol, timeframe, 'stress');
  return { symbol, timeframe, status: base && stress ? 'AVAILABLE' : 'NO_DATA', base: base ?? null, stress: stress ?? null };
}));
const ranking = symbols.map((symbol) => {
  const available = rows.filter((r) => r.symbol === symbol && r.base && r.stress && r.base.tradeCount > 0 && r.stress.tradeCount > 0);
  // Descriptive ranking, not an independently validated timeframe selection.
  const best = available.toSorted((a, b) => b.stress!.netUsd - a.stress!.netUsd)[0];
  return { symbol, status: best ? 'AVAILABLE' : rows.some((r) => r.symbol === symbol && r.base) ? 'NO_CLOSED_TRADES' : 'NO_DATA', bestObservedTimeframe: best?.timeframe ?? null,
    basePnlUsd: best?.base?.netUsd ?? null, stressPnlUsd: best?.stress?.netUsd ?? null,
    trades: best?.base?.tradeCount ?? null, stressTrades: best?.stress?.tradeCount ?? null };
}).toSorted((a, b) => (b.stressPnlUsd ?? -Infinity) - (a.stressPnlUsd ?? -Infinity));
const number = (n: number | null | undefined) => n == null ? '—' : n.toFixed(2);
const percentage = (n: number | null | undefined) => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
const markdown = ['# Benchmark por ativo — Market Forces', '',
  `Ativos configurados: ${symbols.join(', ')}.`, '',
  'Comparação da mesma estratégia entre ativos e timeframes, sem otimização de parâmetros. Lote fixo de 0,01; valores USD antes de comissão e swap. Base inclui spread; stress usa spread 1,5× e slippage. P&L aberto é separado.',
  '', '## Matriz de resultado fechado: base / stress (USD)', '',
  '| Ativo | M1 | M5 | M15 | M30 | H1 |', '|---|---:|---:|---:|---:|---:|',
  ...symbols.map((symbol) => `| ${symbol} | ${frames.map((frame) => {
    const row = rows.find((r) => r.symbol === symbol && r.timeframe === frame)!;
    return row.base && row.stress ? `${number(row.base.netUsd)} / ${number(row.stress.netUsd)}` : 'SEM DADOS';
  }).join(' | ')} |`),
  '', '## Melhor timeframe observado por ativo (ordenado pelo resultado stress)', '',
  '**Seleção retrospectiva na mesma amostra, não recomendação validada.** Ranking exige trades fechados nos dois cenários. Zero trades não demonstra desempenho positivo. Não somar timeframes sobrepostos.', '',
  '| Ativo | Timeframe | Trades base/stress | USD base | USD stress |', '|---|---|---:|---:|---:|',
  ...ranking.map((r) => `| ${r.symbol} | ${r.bestObservedTimeframe ?? (r.status === 'NO_DATA' ? 'SEM DADOS' : 'SEM TRADES NOS DOIS CENÁRIOS')} | ${r.trades ?? '—'} / ${r.stressTrades ?? '—'} | ${number(r.basePnlUsd)} | ${number(r.stressPnlUsd)} |`),
  '', '## Detalhes por ativo e timeframe', '',
  '| Ativo | TF | Trades base/stress | Acerto base | PF base/stress | DD ativo base USD* | USD aberto base/stress | Sinais / bloqueios spread base |',
  '|---|---|---:|---:|---:|---:|---:|---:|',
  ...rows.filter((r) => r.base && r.stress).map((r) => `| ${r.symbol} | ${r.timeframe} | ${r.base!.tradeCount} / ${r.stress!.tradeCount} | ${percentage(r.base!.winRate)} | ${number(r.base!.profitFactor)} / ${number(r.stress!.profitFactor)} | ${number(r.base!.maxSymbolDrawdownUsd)} | ${number(r.base!.openPnlUsd)} / ${number(r.stress!.openPnlUsd)} | ${r.base!.candidates} / ${r.base!.costBlocked} |`),
  '', '## Cobertura e interpretação', '',
  ...symbols.map((symbol) => {
    const covered = rows.filter((r) => r.symbol === symbol && r.status === 'AVAILABLE');
    return `- ${symbol}: ${covered.length ? covered.map((r) => `${r.timeframe}: ${r.base!.bars} candles`).join('; ') : 'sem histórico/custos no conjunto local; não testado, não equivale a zero trades'}.`;
  }), '',
  '- Os históricos são snapshots locais coletados em 04/11/2026, com períodos distintos entre timeframes; consulte datas no relatório do backtest.',
  '- Amostra curta e sem validação fora da amostra. Não representa comparação em janela temporal comum.',
  '- DD por ativo estimado conservadoramente por OHLC; não é drawdown de carteira nem precisão tick a tick.',
  '- PF ausente pode significar ausência de perdas ou ausência de trades; veja a contagem.',
  '- M1 pode apresentar zero trades porque o spread supera o filtro de 20% ATR.',
  '- Não simula todos os controles do motor de risco, margem, swaps, comissão ou conversão cambial histórica.',
  '- Ativos sem dados precisam de candles MT5 e especificações/custos correspondentes antes de entrarem no benchmark.',
  '- Tentativa de coleta complementar em 13/11/2026 bloqueada por timeout da ponte MT5 (8000 ms), apesar de /health indicar broker conectado.',
];
await Bun.write(new URL('market-forces-benchmark-2026-11-13.json', root), JSON.stringify({ generatedAt: new Date().toISOString(), symbols, ranking, rows }, null, 2));
await Bun.write(new URL('market-forces-benchmark-2026-11-13.md', root), markdown.join('\n') + '\n');
console.table(ranking);
console.log(`Cobertura: ${rows.filter((r) => r.status === 'AVAILABLE').length}/${rows.length} combinações ativo/timeframe.`);
