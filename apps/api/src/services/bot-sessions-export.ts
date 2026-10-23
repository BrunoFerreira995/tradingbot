import type { BotSession } from './bot-session';
import { csvTable } from './trades-export';
export function botSessionStatus(session: BotSession, now = Date.now()) {
  if (session.endedAt) return 'ENDED';
  return now - Date.parse(session.lastSeenAt) <= 90000
    ? 'RUNNING'
    : 'INTERRUPTED_END_UNKNOWN';
}
export function botSessionsCsv(sessions: BotSession[], now = Date.now()) {
  return csvTable([
    [
      'bot_session_id',
      'started_at',
      'ended_at',
      'last_seen_at',
      'status',
      'end_reason',
      'code_version',
      'parameters',
      'account_id',
      'server',
      'currency',
      'balance_at_start',
      'equity_at_start',
      'last_balance',
      'balance_at_end',
      'parameter_changes',
    ],
    ...sessions.map((s) => [
      s.id,
      s.startedAt,
      s.endedAt,
      s.lastSeenAt,
      botSessionStatus(s, now),
      s.endReason,
      s.codeVersion,
      JSON.stringify(s.parameters),
      s.accountId,
      s.server,
      s.currency,
      s.balanceAtStart,
      s.equityAtStart,
      s.lastBalance,
      s.balanceAtEnd,
      JSON.stringify(s.parameterChanges ?? []),
    ]),
  ]);
}
