import { marketSession } from './market-session';
import type { Position, TradeMetadata } from '@trade/shared';

type ClosedTrade = TradeMetadata & {
  id: string;
  symbol: string;
  side: string;
  lots: number | string;
  entryPrice: number | string;
  exitPrice: number | string;
  pnl: number | string;
  closedAt: Date | string;
};

function cell(value: unknown): string {
  let text = value instanceof Date ? value.toISOString() : String(value ?? '');
  // Keep text identifiers from being interpreted as spreadsheet formulas.
  if (typeof value === 'string' && /^[=+\-@\t\r\n]/.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function tradesCsv(
  positions: Position[],
  trades: ClosedTrade[],
  currency: string,
  metadata = new Map<string, TradeMetadata>(),
): string {
  const rows: unknown[][] = [
    [
      'id',
      'status',
      'symbol',
      'side',
      'lots',
      'entry_price',
      'exit_price',
      'current_price',
      'pnl',
      'currency',
      'closed_at',
      ...exportFields.map(([header]) => header),
    ],
    ...positions.map((p) => [
      p.id,
      'OPEN',
      p.symbol,
      p.side,
      p.lots,
      p.entryPrice,
      '',
      p.currentPrice,
      p.unrealizedPnl,
      currency,
      '',
      ...metadataCells({
        ...metadata.get(p.positionIdentifier ?? p.id),
        ...metadata.get(p.id),
        openedAt: p.openedAt,
      }),
    ]),
    ...trades.map((t) => [
      t.id,
      'CLOSED',
      t.symbol,
      t.side,
      Number(t.lots),
      Number(t.entryPrice),
      Number(t.exitPrice),
      '',
      Number(t.pnl),
      currency,
      t.closedAt,
      ...metadataCells(mergeTradeMetadata(metadata.get(t.id), t)),
    ]),
  ];
  return csvTable(rows);
}

const exportFields: Array<[string, keyof TradeMetadata]> = [
  ['session_id', 'sessionId'],
  ['strategy_id', 'strategyId'],
  ['opened_at', 'openedAt'],
  ['close_reason', 'closeReason'],
  ['timeframe', 'timeframe'],
  ['signal_reason', 'signalReason'],
  ['signal_confidence', 'signalConfidence'],
  ['spread_at_entry', 'spreadAtEntry'],
  ['commission', 'commission'],
  ['swap', 'swap'],
  ['initial_sl', 'initialSl'],
  ['initial_tp', 'initialTp'],
  ['risk_amount', 'riskAmount'],
  ['balance_at_entry', 'balanceAtEntry'],
  ['equity_at_entry', 'equityAtEntry'],
  ['max_favorable_excursion', 'maxFavorableExcursion'],
  ['max_adverse_excursion', 'maxAdverseExcursion'],
  ['execution_latency_ms', 'executionLatencyMs'],
  ['slippage', 'slippage'],
  ['bot_session_id', 'botSessionId'],
  ['market_session', 'marketSession'],
  ['excursion_observed_from', 'excursionObservedFrom'],
  ['excursion_observed_until', 'excursionObservedUntil'],
];
function metadataCells(value: TradeMetadata) {
  const enriched = {
    ...value,
    botSessionId: value.botSessionId ?? value.sessionId,
    marketSession:
      value.marketSession ??
      (value.openedAt ? marketSession(value.openedAt) : undefined),
  };
  return exportFields.map(([, key]) => enriched[key]);
}

export function mergeTradeMetadata(
  recorded: TradeMetadata | undefined,
  terminal: TradeMetadata,
): TradeMetadata {
  const merged = {
    ...recorded,
    ...Object.fromEntries(
      Object.entries(terminal).filter(([, value]) => value !== undefined),
    ),
  };
  // SL/TP remain authoritative. EXPERT only identifies the submitting program;
  // a confirmed bot closure can additionally explain its business reason.
  if (
    recorded?.closeReason &&
    (!terminal.closeReason || terminal.closeReason === 'EXPERT')
  )
    merged.closeReason = recorded.closeReason;
  return merged;
}

export function csvTable(rows: unknown[][]): string {
  return (
    '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
  );
}
