import { db, schema } from '@trade/database';
import { eq, desc, and, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { AccountInfo } from '@trade/shared';
import { defaultMeanReversionConfig } from '@trade/strategy';
import { getSettings } from './settings';

export const botSessionId = crypto.randomUUID();
const startedAt = new Date().toISOString();
let registered = false;
let registration: Promise<void> | undefined;
let ended = false;

export interface BotSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  lastSeenAt: string;
  endReason: string | null;
  codeVersion: string;
  parameters: Record<string, unknown>;
  parameterChanges?: Array<{
    at: string;
    kind: string;
    parameters: Record<string, unknown>;
  }>;
  accountId: string | null;
  server: string | null;
  currency: string | null;
  balanceAtStart: number | null;
  equityAtStart: number | null;
  lastBalance: number | null;
  balanceAtEnd: number | null;
}

async function codeVersion() {
  if (process.env.CODE_VERSION) return process.env.CODE_VERSION;
  const root = resolve(import.meta.dir, '../../../..');
  const hash = createHash('sha256');
  async function collect(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? collect(join(directory, entry.name))
          : Promise.resolve(
              /\.(ts|mq5)$/.test(entry.name) && !entry.name.endsWith('.test.ts')
                ? [join(directory, entry.name)]
                : [],
            ),
      ),
    );
    return files.flat();
  }
  let files: string[];
  try {
    files = (
      await Promise.all(
        [
          'apps/api/src',
          'packages/shared/src',
          'packages/broker/src',
          'packages/trading/src',
          'packages/strategy/src',
        ].map((path) => collect(join(root, path))),
      )
    )
      .flat()
      .sort();
  } catch {
    files = [import.meta.path];
  }
  for (const file of files) {
    hash.update(file.slice(root.length));
    hash.update(await readFile(file));
  }
  return `sha256:${hash.digest('hex')}`;
}

export async function startBotSession(
  account: AccountInfo | null,
  server?: string,
) {
  if (registered) return;
  if (registration) return registration;
  registration = (async () => {
    const settings = await getSettings();
    const parameters = {
      tradingMode: process.env.TRADING_MODE ?? 'paper',
      symbols: (
        process.env.MT5_SYMBOLS ??
        process.env.MT5_PRIMARY_SYMBOL ??
        'XAUUSD'
      ).split(','),
      strategy: process.env.STRATEGY_RUNNER ?? null,
      timeframe: process.env.STRATEGY_TIMEFRAME ?? 'M30',
      strategyConfig: defaultMeanReversionConfig,
      riskSettings: settings,
      marketSessions: settings.marketSessions,
      excursionSampleIntervalMs: 5000,
    };
    const session: BotSession = {
      id: botSessionId,
      startedAt,
      endedAt: null,
      lastSeenAt: new Date().toISOString(),
      endReason: null,
      codeVersion: await codeVersion(),
      parameters,
      accountId: account?.id ?? null,
      server: server ?? null,
      currency: account?.currency ?? null,
      balanceAtStart: account?.balance ?? null,
      equityAtStart: account?.equity ?? null,
      lastBalance: account?.balance ?? null,
      balanceAtEnd: null,
    };
    await db
      .insert(schema.systemEvents)
      .values({
        id: botSessionId,
        type: 'bot.session',
        payload: { ...session },
      })
      .onConflictDoNothing();
    registered = true;
  })();
  try {
    await registration;
  } finally {
    registration = undefined;
  }
}

export async function heartbeatBotSession(
  account: AccountInfo | null,
  server?: string,
) {
  if (ended || !registered) return;
  const patch = {
    lastSeenAt: new Date().toISOString(),
    lastBalance: account?.balance,
  };
  const [row] = await db
    .select({ payload: schema.systemEvents.payload })
    .from(schema.systemEvents)
    .where(eq(schema.systemEvents.id, botSessionId));
  if (!row) return;
  const session = row.payload as unknown as BotSession;
  const attach =
    account && !session.accountId
      ? {
          accountId: account.id,
          server: server ?? null,
          currency: account.currency,
          balanceAtStart: account.balance,
          equityAtStart: account.equity,
        }
      : account && session.accountId === account.id && !session.server && server
        ? { server }
        : {};
  // A switched terminal must never replace the original session's balance.
  const balance =
    account &&
    (session.accountId === account.id || !session.accountId) &&
    (!session.server || session.server === server)
      ? patch.lastBalance
      : session.lastBalance;
  await db
    .update(schema.systemEvents)
    .set({
      payload: sql`${schema.systemEvents.payload} || ${JSON.stringify({ ...attach, lastSeenAt: patch.lastSeenAt, lastBalance: balance })}::jsonb`,
    })
    .where(
      and(
        eq(schema.systemEvents.id, botSessionId),
        sql`${schema.systemEvents.payload}->>'endedAt' IS NULL`,
      ),
    );
}

export async function endBotSession(
  reason: string,
  account: AccountInfo | null,
  server?: string,
) {
  ended = true;
  if (!registered) return;
  const [row] = await db
    .select({ payload: schema.systemEvents.payload })
    .from(schema.systemEvents)
    .where(eq(schema.systemEvents.id, botSessionId));
  if (!row) return;
  const session = row.payload as unknown as BotSession;
  const balance =
    account && account.id === session.accountId && session.server === server
      ? account.balance
      : null;
  await db
    .update(schema.systemEvents)
    .set({
      payload: {
        ...row.payload,
        endedAt: new Date().toISOString(),
        endReason: reason,
        balanceAtEnd: balance,
      },
    })
    .where(eq(schema.systemEvents.id, botSessionId));
}

export async function getBotSessions() {
  return (
    await db
      .select({ payload: schema.systemEvents.payload })
      .from(schema.systemEvents)
      .where(eq(schema.systemEvents.type, 'bot.session'))
      .orderBy(desc(schema.systemEvents.createdAt))
  ).map((row) => row.payload as unknown as BotSession);
}

export async function recordBotSessionParameters(
  kind: string,
  parameters: Record<string, unknown>,
) {
  if (!registered || ended) return;
  const change = { at: new Date().toISOString(), kind, parameters };
  await db
    .update(schema.systemEvents)
    .set({
      payload: sql`jsonb_set(${schema.systemEvents.payload}, '{parameterChanges}', coalesce(${schema.systemEvents.payload}->'parameterChanges', '[]'::jsonb) || ${JSON.stringify([change])}::jsonb)`,
    })
    .where(eq(schema.systemEvents.id, botSessionId));
}
