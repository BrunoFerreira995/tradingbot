import { expect, test } from 'bun:test';
import { botSessionStatus, botSessionsCsv } from './bot-sessions-export';
import type { BotSession } from './bot-session';
const session: BotSession = {
  id: 'run',
  startedAt: '2026-10-14T12:00:00Z',
  lastSeenAt: '2026-10-14T12:01:00Z',
  endedAt: null,
  endReason: null,
  codeVersion: 'sha256:version',
  parameters: { timeframe: 'M30' },
  accountId: 'account',
  server: 'server',
  currency: 'USD',
  balanceAtStart: 1000,
  equityAtStart: 1000,
  lastBalance: 1010,
  balanceAtEnd: null,
};
test('distinguishes running, confirmed end and interruptions without inventing an end timestamp', () => {
  expect(botSessionStatus(session, Date.parse('2026-10-14T12:01:30Z'))).toBe(
    'RUNNING',
  );
  expect(botSessionStatus(session, Date.parse('2026-10-14T12:03:00Z'))).toBe(
    'INTERRUPTED_END_UNKNOWN',
  );
  const ended = {
    ...session,
    endedAt: '2026-10-14T12:02:00Z',
    endReason: 'SIGTERM',
    balanceAtEnd: 1010,
  };
  expect(botSessionStatus(ended)).toBe('ENDED');
  const csv = botSessionsCsv(
    [session, ended],
    Date.parse('2026-10-14T12:03:00Z'),
  );
  expect(csv).toContain('"INTERRUPTED_END_UNKNOWN","","sha256:version"');
  expect(csv).toContain('"2026-10-14T12:02:00Z"');
  expect(csv).toContain(
    '"ENDED","SIGTERM","sha256:version","{""timeframe"":""M30""}"',
  );
});
