import { Elysia, t } from 'elysia';
import { db, schema, sql } from '@trade/database';
import { runMigrations } from '@trade/database/migrate';
import { desc, eq, sql as dsql } from 'drizzle-orm';
import { atr, backtestSmaMicroTrend, candlePatternsSchema, defaultSmaMicroTrendConfig, evaluateSmaMicroTrend, macroTrendAt, resolveMacroTimeframe, sma, smaMicroTrendSchema } from '@trade/strategy';
import { diversifiedTrendSchema, TREND_FOREX_SYMBOLS } from '@trade/strategy';
import { MT5BrokerAdapter } from '@trade/broker';
import type { Timeframe } from '@trade/shared';
import { TIMEFRAMES, isTimeframe, signalSchema } from '@trade/shared';
import { safeEqual, verifyWebhook } from './services/webhook-security';
import { invertEntrySignal } from './services/signal-inversion';
import { TradingEngine } from './services/trading-engine';
import { audit, emit, subscribe } from './services/events';
import { getSettings, updateSettings } from './services/settings';
import { getRecentSignals } from './services/recent-signals';
import { getTradeStats } from './services/trade-stats';
import { getPerformance } from './services/performance';
import { getTradeCharts } from './services/trade-charts';
import {
  startBotSession,
  recordBotSessionParameters,
  heartbeatBotSession,
  endBotSession,
  getBotSessions,
} from './services/bot-session';
import { tradeServer } from './services/trade-telemetry';
import { botSessionsCsv } from './services/bot-sessions-export';
import { tradesCsv } from './services/trades-export';
import {
  isMt5MaintenanceAction,
  runMt5Maintenance,
} from './services/mt5-maintenance';
import {
  exportTradeMetadata,
  observeTradeExcursions,
} from './services/trade-telemetry';
import { StrategyRunner, ensureStrategy } from './services/strategy-runner';
import { resolveAccountMode, type TradingMode, type TradingModePolicy } from './services/account-mode';
import { monetaryStopForCurrency } from '@trade/trading';

if (process.env.AUTO_MIGRATE === 'true') {
  try {
    await runMigrations(
      process.env.MIGRATIONS_DIR ?? './packages/database/drizzle',
      false,
    );
    console.log('[database] migrations applied');
  } catch (error) {
    console.error(
      '[database] automatic migration failed',
      error instanceof Error ? error.message : error,
    );
  }
}

// The application trades MetaTrader 5 and nothing else. There is no mock
// provider to fall back to: an unreachable terminal is reported as
// disconnected and retried, never faked with synthetic data.
const provider = 'mt5';
const modePolicy = process.env.TRADING_MODE ?? 'auto';
if (modePolicy !== 'paper' && modePolicy !== 'live' && modePolicy !== 'auto')
  throw new Error(`Unknown TRADING_MODE: ${modePolicy}`);
let detectedMode: TradingMode | null = null;
const mode = () => detectedMode ?? 'unknown';

// The dashboard leads with one symbol; the strategy watches and trades the whole
// list. Both default to XAUUSD, so setting only MT5_SYMBOLS still leaves the
// focus symbol valid, and MT5_PRIMARY_SYMBOL is folded into the list so it can
// never name a symbol the bot is not watching.
const primarySymbol = process.env.MT5_PRIMARY_SYMBOL ?? 'XAUUSD';
const watchedSymbols = [
  ...new Set(
    (process.env.MT5_SYMBOLS ?? primarySymbol)
      .split(',')
      .map((symbol) => symbol.trim())
      .filter(Boolean),
  ),
];
if (!watchedSymbols.includes(primarySymbol))
  watchedSymbols.unshift(primarySymbol);

const broker = new MT5BrokerAdapter({
  symbols: watchedSymbols,
  validateHeartbeat: (beat) => {
    detectedMode = resolveAccountMode(beat, modePolicy as TradingModePolicy, process.env.MT5_LIVE_ACK);
  },
  ...(process.env.MT5_BRIDGE_DIR
    ? { directory: process.env.MT5_BRIDGE_DIR }
    : {}),
  ...(process.env.MT5_MAGIC ? { magic: Number(process.env.MT5_MAGIC) } : {}),
});

const RECONNECT_MS = Number(process.env.MT5_RECONNECT_MS ?? 15000);
// null until the first probe, so the boot state is always announced once even
// when it starts disconnected.
let brokerOnline: boolean | null = null;

/**
 * Single source of truth for the broker connection.
 *
 * Runs at boot and then on a timer. The terminal is a separate process we do
 * not control, so "connected" is a fact about the heartbeat, not something the
 * API can establish once and forget: this picks the terminal up after it
 * starts and notices when the heartbeat goes stale.
 */
let pendingReconciliation: Promise<boolean> | undefined;
function reconcileBroker(): Promise<boolean> {
  if (!pendingReconciliation)
    pendingReconciliation = performBrokerReconciliation().finally(() => {
      pendingReconciliation = undefined;
    });
  return pendingReconciliation;
}

async function performBrokerReconciliation(): Promise<boolean> {
  const online = await broker.probe();
  if (online) {
    const beat = await broker.heartbeat();
    if (!beat) {
      await broker.disconnect();
      detectedMode = null;
      return false;
    }
    if (beat) {
      try {
        const previousMode = detectedMode;
        detectedMode = resolveAccountMode(beat, modePolicy as TradingModePolicy, process.env.MT5_LIVE_ACK);
        if (detectedMode !== previousMode)
          await audit('BROKER', 'account_mode_detected', undefined, undefined, { login: beat.login, mode: detectedMode });
      } catch (error) {
        // A connected-but-unsafe terminal is worse than a disconnected one, so
        // drop the session rather than letting orders route to it.
        console.error(`[broker] ${(error as Error).message}`);
        await broker.disconnect();
        detectedMode = null;
        if (brokerOnline) {
          brokerOnline = false;
          await emit('broker.disconnected', { reason: 'account-safety' });
          await audit('BROKER', 'safety_block', undefined, undefined, {
            login: beat.login,
            tradeMode: beat.tradeMode,
          });
        }
        return false;
      }
    }
  }
  if (!online) detectedMode = null;
  if (online !== brokerOnline) {
    brokerOnline = online;
    if (online) {
      console.log('[broker] MetaTrader 5 connected');
      await emit('broker.connected', { provider });
      await audit('BROKER', 'connected');
    } else {
      console.warn(
        '[broker] MetaTrader 5 not reachable. Start AurumBridge as a Service ' +
          'in the Navigator and enable Algo Trading; retrying in the background.',
      );
      await emit('broker.disconnected', {});
      await audit('BROKER', 'disconnected');
    }
  }
  return online;
}

await reconcileBroker();
setInterval(() => {
  void reconcileBroker().catch(() => {});
}, RECONNECT_MS);

async function brokerIdentity(): Promise<string> {
  try {
    return (await broker.getAccount()).id;
  } catch {
    // Disconnected at boot: the engine only needs a stable id for locks and
    // audit rows, and the real one takes over on the first successful read.
    return 'mt5-unconnected';
  }
}

const initialSessionAccount = await broker.getAccount().catch(() => null);
await startBotSession(
  initialSessionAccount,
  initialSessionAccount
    ? await tradeServer(initialSessionAccount.id)
    : undefined,
);
let updatingBotSession = false;
setInterval(() => {
  if (updatingBotSession) return;
  updatingBotSession = true;
  void broker
    .getAccount()
    .catch(() => null)
    .then(async (account) =>
      heartbeatBotSession(
        account,
        account ? await tradeServer(account.id) : undefined,
      ),
    )
    .catch((error) =>
      console.warn(
        '[bot session]',
        error instanceof Error ? error.message : 'heartbeat failed',
      ),
    )
    .finally(() => {
      updatingBotSession = false;
    });
}, 30000);

const engine = new TradingEngine(broker, await brokerIdentity());

let enforcingMonetaryStops = false;
async function enforceMonetaryStops() {
  if (enforcingMonetaryStops) return;
  enforcingMonetaryStops = true;
  try {
    await engine.enforceMonetaryStops();
  } catch (error) {
    console.warn('[monetary stop]', error);
  } finally {
    enforcingMonetaryStops = false;
  }
}
setInterval(() => void enforceMonetaryStops(), 1000);

// Sample monetary excursions independently of dashboard visits.
let collectingExcursions = false;
setInterval(() => {
  if (collectingExcursions || !broker.connected) return;
  collectingExcursions = true;
  void Promise.all([broker.getAccount(), broker.getPositions()])
    .then(([account, positions]) =>
      observeTradeExcursions(account.id, positions),
    )
    .catch((error) =>
      console.warn(
        '[trade telemetry]',
        error instanceof Error ? error.message : 'collection failed',
      ),
    )
    .finally(() => {
      collectingExcursions = false;
    });
}, 5000);

// Collect capital while the server runs, including when no dashboard is open.
let collectingCapital = false;
setInterval(() => {
  if (collectingCapital || !broker.connected) return;
  collectingCapital = true;
  void Promise.all([broker.getAccount(), broker.getPositions()])
    .then(([account, positions]) =>
      getPerformance(account, positions, broker.connected),
    )
    .catch((error) =>
      console.warn(
        `[performance] ${error instanceof Error ? error.message : 'collection failed'}`,
      ),
    )
    .finally(() => {
      collectingCapital = false;
    });
}, 60000);

const secret = process.env.TRADINGVIEW_WEBHOOK_SECRET ?? '';
const hmacSecret = process.env.TRADINGVIEW_HMAC_SECRET ?? '';
const adminKey = process.env.ADMIN_API_KEY ?? '';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const rate = new Map<string, { at: number; count: number }>();
const rawBodies = new WeakMap<Request, string>();
const receivedTimes = new WeakMap<Request, number>();
function rateAllowed(key: string) {
  const now = Date.now();
  const current = rate.get(key);
  if (!current || now - current.at > 60000) {
    rate.set(key, { at: now, count: 1 });
    return true;
  }
  current.count++;
  return current.count <= 60;
}
function clientIp(headers: Headers, serverIp?: string) {
  return (
    serverIp ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
const app = new Elysia({ serve: { maxRequestBodySize: 16 * 1024 } })
  .onRequest(async ({ request, set }) => {
    if (
      request.method === 'POST' &&
      request.url.endsWith('/api/webhooks/tradingview')
    ) {
      receivedTimes.set(request, Date.now());
      rawBodies.set(request, await request.clone().text());
    }
    set.headers['x-content-type-options'] = 'nosniff';
    set.headers['x-frame-options'] = 'DENY';
    set.headers['referrer-policy'] = 'no-referrer';
    set.headers['content-security-policy'] = "default-src 'none'";
    set.headers['access-control-allow-origin'] = origin;
    set.headers['access-control-allow-headers'] =
      'content-type,x-admin-key,x-webhook-secret,x-tradingview-signature,x-tradingview-timestamp,x-tradingview-nonce';
    set.headers['access-control-allow-methods'] = 'GET,POST,PATCH,OPTIONS';
    set.headers['x-request-id'] =
      request.headers.get('x-request-id') ?? crypto.randomUUID();
  })
  .onBeforeHandle(({ request, set }) => {
    const path = new URL(request.url).pathname;
    if (
      request.method === 'GET' &&
      (path === '/api/dashboard' ||
        path === '/api/trades/export' ||
        path === '/api/bot-sessions' ||
        path === '/api/bot-sessions/export' ||
        path === '/api/logs' ||
        path === '/api/events' ||
        path === '/api/open-pnl/stream' ||
        path === '/api/events/stream')
    ) {
      if (
        !adminKey ||
        !safeEqual(request.headers.get('x-admin-key') ?? '', adminKey)
      ) {
        set.status = 403;
        return { error: 'Admin key required' };
      }
    }
  })
  .options('/*', ({ set }) => {
    set.status = 204;
    return '';
  })
  .get('/health', async () => {
    let database = 'connected';
    try {
      await sql`select 1`;
    } catch {
      database = 'disconnected';
    }
    return {
      api: 'ok',
      database,
      broker: broker.connected ? 'connected' : 'disconnected',
      tradingEngine: 'ready',
      provider,
      mode: mode(),
      symbol: primarySymbol,
      symbols: watchedSymbols,
    };
  })
  .get('/ready', async ({ set }) => {
    try {
      await sql`select 1`;
      if (!broker.connected) throw new Error('broker');
      return { ready: true };
    } catch {
      set.status = 503;
      return { ready: false };
    }
  })
  .get('/metrics', async () => {
    const [signalRows, orderRows] = await Promise.all([
      db
        .select({ count: dsql<number>`count(*)::int` })
        .from(schema.tradingSignals),
      db.select({ count: dsql<number>`count(*)::int` }).from(schema.orders),
    ]);
    return {
      signalsTotal: signalRows[0]?.count ?? 0,
      ordersTotal: orderRows[0]?.count ?? 0,
      brokerConnected: broker.connected ? 1 : 0,
    };
  })
  .post('/api/webhooks/tradingview', async ({ request, set, server }) => {
    const requestId = set.headers['x-request-id'] as string;
    const ip = clientIp(request.headers, server?.requestIP(request)?.address);
    if (!rateAllowed(ip)) {
      set.status = 429;
      await audit('SECURITY', 'rate_limited', requestId, ip);
      return { error: 'Rate limit exceeded' };
    }
    const raw = rawBodies.get(request) ?? '';
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      set.status = 400;
      return { error: 'Invalid JSON' };
    }
    const authError = await verifyWebhook(body, request.headers, raw, {
      secret,
      hmacSecret,
      recordNonce: async (nonce) => {
        const inserted = await db
          .insert(schema.webhookNonces)
          .values({ nonce })
          .onConflictDoNothing()
          .returning();
        return inserted.length > 0;
      },
    });
    if (authError) {
      set.status = 401;
      await audit('SECURITY', 'webhook_rejected', requestId, ip, {
        reason: authError,
      });
      return { error: authError };
    }
    const parsed = signalSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return {
        error: 'Invalid signal',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      };
    }
    const settings = await getSettings();
    const signal = settings.invertIncomingSignals
      ? invertEntrySignal(parsed.data)
      : parsed.data;
    if (signal.action !== parsed.data.action)
      await audit('SIGNAL', 'signal_inverted', requestId, ip, {
        signalId: signal.signalId,
        from: parsed.data.action,
        to: signal.action,
      });
    const result = await engine.process(signal, {
      requestId,
      ip,
      receivedAt: receivedTimes.get(request) ?? Date.now(),
    });
    set.status =
      result.status === 'DUPLICATE'
        ? 200
        : result.status === 'FAILED'
          ? 502
          : 202;
    return result;
  })
  .post(
    '/api/test/signal',
    async ({ body, set, request }) => {
      if (process.env.NODE_ENV === 'production') {
        set.status = 404;
        return { error: 'Not found' };
      }
      const parsed = signalSchema.safeParse({
        strategy: 'gold-scalping-v1',
        signalId: `test-${crypto.randomUUID()}`,
        symbol: 'XAUUSD',
        orderType: 'MARKET',
        stopLoss: 25,
        takeProfit: 50,
        lots: 0.01,
        ...body,
      });
      if (!parsed.success) {
        set.status = 400;
        return { error: parsed.error.issues };
      }
      const settings = await getSettings();
      const signal = settings.invertIncomingSignals
        ? invertEntrySignal(parsed.data)
        : parsed.data;
      return engine.process(signal, {
        requestId: crypto.randomUUID(),
        ip: clientIp(request.headers),
        receivedAt: Date.now(),
      });
    },
    {
      body: t.Object({
        action: t.Union([
          t.Literal('BUY'),
          t.Literal('SELL'),
          t.Literal('CLOSE'),
        ]),
        lots: t.Optional(t.Number()),
        stopLoss: t.Optional(t.Number()),
      }),
    },
  )
  .get('/api/bot-sessions', async () => getBotSessions())
  .get(
    '/api/bot-sessions/export',
    async () =>
      new Response(botSessionsCsv(await getBotSessions()), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="bot-sessions.csv"',
          'cache-control': 'no-store',
        },
      }),
  )
  .get('/api/trades/export', async () => {
    const [account, positions] = await Promise.all([
      broker.getAccount().catch(() => null),
      broker.getPositions().catch(() => []),
    ]);
    const performance = account
      ? await getPerformance(account, positions, broker.connected, true)
      : null;
    const trades = performance?.historyAvailable
      ? performance.closedTrades
      : await db
          .select()
          .from(schema.trades)
          .orderBy(desc(schema.trades.closedAt));
    const metadata = account
      ? await exportTradeMetadata(account.id, account.currency)
      : new Map();
    return new Response(
      tradesCsv(positions, trades, account?.currency ?? '', metadata),
      {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="all-trades-${new Date().toISOString().slice(0, 10)}.csv"`,
          'cache-control': 'no-store',
        },
      },
    );
  })
  .get('/api/dashboard', async () => {
    const [
      account,
      positions,
      price,
      settings,
      signals,
      orders,
      trades,
      strategies,
      tradeStats,
    ] = await Promise.all([
      // A disconnected terminal is a normal state, not an error: report zeros
      // and let the dashboard show DISCONNECTED instead of failing the request.
      broker.getAccount().catch(() => ({
        id: 'mt5-unconnected',
        balance: 0,
        equity: 0,
        freeMargin: 0,
        usedMargin: 0,
        marginLevel: 0,
        currency: 'USD',
      })),
      broker.getPositions().catch(() => []),
      broker.getPrice(primarySymbol).catch(() => null),
      getSettings(),
      getRecentSignals(),
      db
        .select()
        .from(schema.orders)
        .orderBy(desc(schema.orders.createdAt))
        .limit(50),
      db
        .select()
        .from(schema.trades)
        .orderBy(desc(schema.trades.closedAt))
        .limit(50),
      db
        .select()
        .from(schema.strategies)
        .orderBy(desc(schema.strategies.createdAt)),
      getTradeStats(),
    ]);
    const performance = await getPerformance(
      account,
      positions,
      broker.connected,
    );
    const terminalStats = performance.historyAvailable
      ? {
          closedTrades: performance.closedTradeCount,
          winningTrades: performance.wins,
          losingTrades: performance.losses,
          winRate: performance.winRate,
          dailyPnl: performance.netDaily ?? 0,
          tradesToday: performance.tradesToday,
        }
      : tradeStats;
    return {
      account,
      positions,
      price,
      settings: {
        ...settings,
        stopRiskAmount: monetaryStopForCurrency(settings, account.currency) ?? null,
        stopRiskCurrency: account.currency,
        stopRiskBySymbol: settings.stopRiskBySymbol?.[account.currency] ?? {},
        stopRiskNeedsConfig: monetaryStopForCurrency(settings, account.currency) === undefined,
      },
      signals,
      orders,
      trades: performance.historyAvailable
        ? performance.closedTrades.slice(0, 50)
        : trades,
      strategies,
      performance,
      stats: {
        ...terminalStats,
        openPnl: positions.reduce((sum, p) => sum + p.unrealizedPnl, 0),
      },
      brokerConnected: broker.connected,
      provider,
      mode: mode(),
      symbol: primarySymbol,
      symbols: watchedSymbols,
    };
  })
  .get('/api/trade-charts', async ({ query, request, set }) => {
    if (
      !adminKey ||
      !safeEqual(request.headers.get('x-admin-key') ?? '', adminKey)
    ) {
      set.status = 403;
      return { error: 'Admin key required' };
    }
    const requested = Number(query?.limit ?? 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), 10)
      : 10;
    const requestedTimeframe = query?.timeframe;
    if (requestedTimeframe !== undefined && !isTimeframe(requestedTimeframe)) {
      set.status = 400;
      return { error: `Unknown timeframe: ${requestedTimeframe}` };
    }
    const [account, positions] = await Promise.all([
      broker.getAccount().catch(() => null),
      broker.getPositions().catch(() => []),
    ]);
    if (!account) {
      set.status = 503;
      return { trades: [], detail: 'Broker account is unavailable' };
    }
    return getTradeCharts({
      broker,
      account,
      positions,
      connected: broker.connected,
      limit,
      timeframe:
        requestedTimeframe !== undefined && isTimeframe(requestedTimeframe)
          ? requestedTimeframe
          : undefined,
    });
  })
  .get('/api/logs', async () =>
    db
      .select()
      .from(schema.auditLogs)
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(100),
  )
  .get('/api/events', async () =>
    db
      .select()
      .from(schema.systemEvents)
      .orderBy(desc(schema.systemEvents.createdAt))
      .limit(100),
  )
  .get('/api/open-pnl/stream', ({ request }) => {
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let active = true;
    let busy = false;
    let previous: string | undefined;
    const cleanup = () => {
      active = false;
      if (timer) clearInterval(timer);
      if (heartbeat) clearInterval(heartbeat);
      request.signal.removeEventListener('abort', cleanup);
    };
    return new Response(
      new ReadableStream({
        start(controller) {
          request.signal.addEventListener('abort', cleanup, { once: true });
          const send = (message: string) => {
            if (!active) return;
            try {
              controller.enqueue(encoder.encode(message));
            } catch {
              cleanup();
            }
          };
          const refresh = async () => {
            if (!active || busy) return;
            busy = true;
            try {
              const [account, positions, price] = await Promise.all([
                broker.getAccount(),
                broker.getPositions(),
                broker.getPrice(primarySymbol),
              ]);
              const openPnl = positions.reduce(
                (sum, p) => sum + p.unrealizedPnl,
                0,
              );
              const live = {
                account,
                positions,
                price,
                openPnl,
                brokerConnected: broker.connected,
              };
              // getPrice timestamps each read; ignore that timestamp so an
              // unchanged market does not emit a new frame every 10 ms.
              const signature = JSON.stringify({
                ...live,
                price: { bid: price.bid, ask: price.ask, spread: price.spread },
              });
              if (active && signature !== previous) {
                send(`data: ${JSON.stringify(live)}\n\n`);
                previous = signature;
              }
            } catch {
              // Keep the last value during a torn snapshot or broker outage.
            } finally {
              busy = false;
            }
          };
          send(': connected\n\n');
          void refresh();
          timer = setInterval(() => void refresh(), 10);
          heartbeat = setInterval(() => send(': heartbeat\n\n'), 5000);
          if (request.signal.aborted) cleanup();
        },
        cancel: cleanup,
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': origin,
        },
      },
    );
  })
  .get('/api/events/stream', () => {
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(': connected\n\n'));
          heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(': heartbeat\n\n'));
            } catch {
              if (heartbeat) clearInterval(heartbeat);
            }
          }, 5000);
          unsubscribe = subscribe((event) => {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            } catch {
              unsubscribe();
            }
          });
        },
        cancel() {
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe();
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': origin,
        },
      },
    );
  })
  .patch(
    '/api/settings',
    async ({ body, request, set }) => {
      if (
        !adminKey ||
        !safeEqual(request.headers.get('x-admin-key') ?? '', adminKey)
      ) {
        set.status = 403;
        return { error: 'Admin key required' };
      }
      let monetaryAccount: Awaited<ReturnType<typeof broker.getAccount>> | null = null;
      if (body.stopRiskAmount !== undefined || body.stopRiskBySymbol !== undefined) {
        const account = await broker.getAccount().catch(() => null);
        monetaryAccount = account;
        if (!account || (body.stopRiskAmount !== null && body.stopRiskAmount !== undefined && body.stopRiskCurrency !== account.currency)) {
          set.status = 400;
          return {
            error: account
              ? `A moeda do stop deve ser ${account.currency}.`
              : 'Conecte o MT5 para configurar o stop monetário.',
          };
        }
      }
      if (body.stopRiskBySymbol && Object.keys(body.stopRiskBySymbol).length > 50) {
        set.status = 400;
        return { error: 'Use no máximo 50 símbolos no stop monetário.' };
      }
      if (
        body.marketSessions &&
        (new Set(body.marketSessions.map((w) => w.name)).size !== 4 ||
          body.marketSessions.some((w) => w.start === w.end))
      ) {
        set.status = 400;
        return {
          error:
            'Informe as quatro sessões com abertura diferente do fechamento.',
        };
      }
      const updated = await updateSettings({
        ...body,
        ...(monetaryAccount &&
        (body.stopRiskAmount !== undefined || body.stopRiskBySymbol !== undefined)
          ? { stopRiskCurrency: monetaryAccount.currency }
          : {}),
      });
      if (body.stopRiskAmount != null || body.stopRiskBySymbol !== undefined)
        await enforceMonetaryStops();
      await recordBotSessionParameters('risk_settings', { ...updated });
      if (body.allowedSymbols !== undefined && runner) {
        const readiness = await ensureStrategy(runnerStrategy, watchedSymbols);
        if (readiness.ok) {
          if (!runnerStarted) {
            runner.start();
            runnerStarted = true;
          }
        } else if (!runnerStarted) {
          runner.blockStartup(readiness.detail);
        }
      }
      let emergencyClose:
        | Awaited<ReturnType<typeof engine.closeAllPositions>>
        | undefined;
      let emergencyCloseError: string | undefined;
      if (body.emergencyStop === true) {
        await emit('risk.emergency_stop', { enabled: true });
        await audit('RISK', 'emergency_stop_enabled');
        try {
          emergencyClose = await engine.closeAllPositions('EMERGENCY_STOP');
        } catch (error) {
          emergencyCloseError =
            error instanceof Error ? error.message : String(error);
          await audit('RISK', 'emergency_close_failed', undefined, undefined, {
            reason: emergencyCloseError,
          });
        }
      }
      if (body.autoTradingEnabled === false)
        await audit('RISK', 'auto_trading_disabled');
      if (body.autoTradingEnabled !== undefined)
        await emit('risk.auto_trading', { enabled: body.autoTradingEnabled });
      if (body.invertIncomingSignals !== undefined)
        await emit('risk.signal_inversion', {
          enabled: body.invertIncomingSignals,
        });
      return {
        ...(monetaryAccount
          ? {
              ...updated,
              stopRiskAmount:
                monetaryStopForCurrency(updated, monetaryAccount.currency) ??
                null,
              stopRiskCurrency: monetaryAccount.currency,
              stopRiskBySymbol:
                updated.stopRiskBySymbol?.[monetaryAccount.currency] ?? {},
              stopRiskNeedsConfig:
                monetaryStopForCurrency(updated, monetaryAccount.currency) ===
                undefined,
            }
          : updated),
        ...(emergencyClose ? { emergencyClose } : {}),
        ...(emergencyCloseError ? { emergencyCloseError } : {}),
      };
    },
    {
      body: t.Object({
        autoTradingEnabled: t.Optional(t.Boolean()),
        emergencyStop: t.Optional(t.Boolean()),
        invertIncomingSignals: t.Optional(t.Boolean()),
        marketSessions: t.Optional(
          t.Array(
            t.Object({
              name: t.String({ pattern: '^(SYDNEY|ASIA|LONDON|NEW_YORK)$' }),
              timezone: t.Literal('Etc/GMT+3'),
              enabled: t.Optional(t.Boolean()),
              weekdays: t.Optional(
                t.Array(t.Integer({ minimum: 0, maximum: 6 })),
              ),
              start: t.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }),
              end: t.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }),
            }),
            { minItems: 4, maxItems: 4 },
          ),
        ),
        stopRiskAmount: t.Optional(
          t.Union([
            t.Number({ exclusiveMinimum: 0, maximum: 999999999 }),
            t.Null(),
          ]),
        ),
        stopRiskCurrency: t.Optional(
          t.Union([t.String({ minLength: 1, maxLength: 12 }), t.Null()]),
        ),
        stopRiskBySymbol: t.Optional(
          t.Record(
            t.String({ minLength: 1, maxLength: 50 }),
            t.Union([
              t.Number({ exclusiveMinimum: 0, maximum: 999999999 }),
              t.Null(),
            ]),
          ),
        ),
        maximumDailyProfit: t.Optional(
          t.Union([
            t.Number({ exclusiveMinimum: 0, maximum: 999999999 }),
            t.Null(),
          ]),
        ),
        maximumDailyTrades: t.Optional(
          t.Integer({ minimum: 0, maximum: 2147483647 }),
        ),
        positionPolicy: t.Optional(
          t.Union([
            t.Literal('ONE_POSITION_PER_SYMBOL'),
            t.Literal('ALLOW_MULTIPLE_POSITIONS'),
            t.Literal('REVERSE_POSITION'),
          ]),
        ),
        // Broker symbol names carry suffixes (XAUUSD.a, XAUUSDm), so the
        // allowlist has to be editable or a valid symbol stays untradeable.
        allowedSymbols: t.Optional(t.Array(t.String(), { maxLength: 50 })),
        blockedSymbols: t.Optional(t.Array(t.String(), { maxLength: 50 })),
      }),
    },
  );

// STRATEGY_RUNNER drives the indicator strategy itself instead of waiting for a
// webhook. Off by default: enabling it means the API decides to trade, so it
// stays an explicit opt-in separate from AUTO_TRADING_ENABLED, which only says
// the engine is allowed to act on signals.
const runnerStrategy = process.env.STRATEGY_RUNNER ?? '';
let runner: StrategyRunner | undefined;
let runnerStarted = false;
if (runnerStrategy) {
  const requested =
    process.env.STRATEGY_TIMEFRAME ??
    (runnerStrategy === 'diversified_trend'
      ? 'D1'
      : runnerStrategy === 'meanrev-bb-rsi-v1' ||
          runnerStrategy === 'candle-patterns-v1'
        ? 'H1'
        : 'M30');
  if (!isTimeframe(requested))
    throw new Error(
      `Unknown STRATEGY_TIMEFRAME "${requested}". Expected one of: ${TIMEFRAMES.join(', ')}.`,
    );
  const timeframe: Timeframe = requested;
  runner = new StrategyRunner(broker, engine, {
    strategyName: runnerStrategy,
    symbols: runnerStrategy === 'diversified_trend'
      ? watchedSymbols.filter((s) => (TREND_FOREX_SYMBOLS as readonly string[]).includes(s)) : watchedSymbols,
    timeframe,
    ...(runnerStrategy === 'diversified_trend' ? {
      trendConfig: diversifiedTrendSchema.parse(process.env.TREND_CONFIG_JSON ? JSON.parse(process.env.TREND_CONFIG_JSON) : {}),
    } : {}),
    ...(runnerStrategy === 'candle-patterns-v1' ? {
      candleConfig: candlePatternsSchema.parse(process.env.CANDLE_CONFIG_JSON ? JSON.parse(process.env.CANDLE_CONFIG_JSON) : {}),
    } : {}),
    getAllowedSymbols: async () => (await getSettings()).allowedSymbols,
    ...(process.env.STRATEGY_POLL_MS
      ? { pollIntervalMs: Number(process.env.STRATEGY_POLL_MS) }
      : {}),
  });
  if (runnerStrategy === 'sma_micro_trend') {
    const saved = await db.query.strategies.findFirst({ where: eq(schema.strategies.name, runnerStrategy) });
    for (const [key, value] of Object.entries(saved?.config ?? {})) {
      const split = key.lastIndexOf(':');
      const symbol = key.slice(0, split);
      const frame = key.slice(split + 1);
      const parsed = smaMicroTrendSchema.safeParse(value);
      if (split > 0 && isTimeframe(frame) && parsed.success)
        runner.setScopedSmaConfig(symbol, frame, parsed.data);
    }
  }
  const readiness = await ensureStrategy(runnerStrategy, watchedSymbols);
  const savedStrategy = await db.query.strategies.findFirst({
    where: eq(schema.strategies.name, runnerStrategy),
  });
  const savedTimeframe = savedStrategy?.timeframe;
  if (
    savedTimeframe &&
    isTimeframe(savedTimeframe) &&
    (runnerStrategy !== 'diversified_trend' || savedTimeframe === 'D1')
  ) {
    runner.setTimeframe(savedTimeframe);
  }
  if (!readiness.ok) {
    runner.blockStartup(readiness.detail);
    console.error(
      `[strategy] ${runnerStrategy} not started: ${readiness.detail}`,
    );
    await audit('STRATEGY', 'runner_blocked', undefined, undefined, {
      strategy: runnerStrategy,
      detail: readiness.detail,
    });
  } else {
    runner.start();
    runnerStarted = true;
    console.log(
      `[strategy] ${runnerStrategy} watching ${watchedSymbols.join(', ')} ${runner.state.timeframe} (${readiness.detail})`,
    );
  }
}

app.get('/api/strategy', () => ({
  strategy: runnerStrategy || null,
  ...(runnerStrategy === 'sma_micro_trend' && runner ? {
    configs: Object.fromEntries(watchedSymbols.map((symbol) => [symbol, runner!.scopedSmaConfig(symbol)])),
  } : {}),
  timeframes: TIMEFRAMES,
  ...(runner
    ? runner.state
    : {
        status: 'DISABLED' as const,
        symbols: watchedSymbols,
        timeframe: isTimeframe(process.env.STRATEGY_TIMEFRAME ?? '')
          ? (process.env.STRATEGY_TIMEFRAME as Timeframe)
          : 'M30',
        lastCheckAt: null,
        symbolStates: {},
      }),
}));

// Timeframe switching is a live trading decision, so it is admin-gated like
// /api/settings rather than open like the read above.
app.patch(
  '/api/strategy',
  async ({ body, request, set }) => {
    if (
      !adminKey ||
      !safeEqual(request.headers.get('x-admin-key') ?? '', adminKey)
    ) {
      set.status = 403;
      return { error: 'Admin key required' };
    }
    const timeframe = body.timeframe ?? runner?.state.timeframe;
    if (!timeframe || !isTimeframe(timeframe)) {
      set.status = 400;
      return {
        error: `Unknown timeframe "${timeframe}". Expected one of: ${TIMEFRAMES.join(', ')}.`,
      };
    }
    if (!runner) {
      set.status = 409;
      return {
        error:
          'Strategy runner is not enabled. Set STRATEGY_RUNNER to turn it on.',
      };
    }
    if (runnerStrategy === 'diversified_trend' && timeframe !== 'D1') {
      set.status = 400;
      return { error: 'Diversified trend requires D1' };
    }
    if (body.config !== undefined) {
      if (runnerStrategy !== 'sma_micro_trend' || !body.symbol || !watchedSymbols.includes(body.symbol)) {
        set.status = 400;
        return { error: 'Invalid SMA strategy or symbol' };
      }
      const parsed = smaMicroTrendSchema.safeParse(body.config);
      if (!parsed.success) {
        set.status = 400;
        return { error: parsed.error.issues.map((issue) => issue.message).join('; ') };
      }
      const row = await db.query.strategies.findFirst({ where: eq(schema.strategies.name, runnerStrategy) });
      if (!row) { set.status = 409; return { error: 'Strategy is not registered' }; }
      const key = `${body.symbol}:${timeframe}`;
      await db.update(schema.strategies).set({ config: { ...(row.config ?? {}), [key]: parsed.data }, updatedAt: new Date() }).where(eq(schema.strategies.id, row.id));
      runner.setScopedSmaConfig(body.symbol, timeframe, parsed.data);
      await audit('STRATEGY', 'config_changed', undefined, undefined, { strategy: runnerStrategy, symbol: body.symbol, timeframe });
      return { ...runner.state, configs: Object.fromEntries(watchedSymbols.map((symbol) => [symbol, runner!.scopedSmaConfig(symbol)])) };
    }
    const previous = runner.state.timeframe;
    const strategyRow = await db.query.strategies.findFirst({
      where: eq(schema.strategies.name, runnerStrategy),
    });
    if (!strategyRow) {
      set.status = 409;
      return { error: 'Strategy is not registered' };
    }
    await db
      .update(schema.strategies)
      .set({ timeframe, updatedAt: new Date() })
      .where(eq(schema.strategies.id, strategyRow.id));
    runner.setTimeframe(timeframe);
    await recordBotSessionParameters('timeframe', {
      strategy: runnerStrategy,
      timeframe,
    });
    await audit('STRATEGY', 'timeframe_changed', undefined, undefined, {
      strategy: runnerStrategy,
      from: previous,
      to: timeframe,
    });
    await emit('strategy.timeframe', { from: previous, to: timeframe });
    return runner.state;
  },
  { body: t.Object({ timeframe: t.Optional(t.String()), symbol: t.Optional(t.String()), config: t.Optional(t.Any()) }) },
);

app.post('/api/mt5/:action', async ({ params, request, set }) => {
  if (!adminKey || !safeEqual(request.headers.get('x-admin-key') ?? '', adminKey)) {
    set.status = 403;
    return { error: 'Admin key required' };
  }
  const action = params.action;
  if (!isMt5MaintenanceAction(action)) {
    set.status = 400;
    return { error: 'Expected action install or doctor' };
  }
  return runMt5Maintenance(action);
});

app.post('/api/strategy/backtest', async ({ body, request, set }) => {
  if (!adminKey || !safeEqual(request.headers.get('x-admin-key') ?? '', adminKey)) {
    set.status = 403; return { error: 'Admin key required' };
  }
  if (runnerStrategy !== 'sma_micro_trend' || !watchedSymbols.includes(body.symbol) || !isTimeframe(body.timeframe)) {
    set.status = 400; return { error: 'Invalid strategy, symbol or timeframe' };
  }
  const parsed = smaMicroTrendSchema.safeParse(body.config ?? runner?.scopedSmaConfig(body.symbol, body.timeframe) ?? defaultSmaMicroTrendConfig);
  if (!parsed.success) { set.status = 400; return { error: parsed.error.issues }; }
  try {
    const macroTimeframe = parsed.data.filters.requireMacroTrendAlignment
      ? resolveMacroTimeframe(body.timeframe, parsed.data.filters.macroTimeframe)
      : null;
    if (parsed.data.filters.requireMacroTrendAlignment && !macroTimeframe)
      throw new Error('Macro timeframe must be higher than entry timeframe');
    const [bars, macroBars] = await Promise.all([
      broker.getRates(body.symbol, body.timeframe, body.count ?? 1000),
      macroTimeframe ? broker.getRates(body.symbol, macroTimeframe, 400) : Promise.resolve(undefined),
    ]);
    return backtestSmaMicroTrend(bars, parsed.data, body.options, macroBars);
  } catch (error) { set.status = 400; return { error: (error as Error).message }; }
}, { body: t.Object({ symbol: t.String(), timeframe: t.String(), count: t.Optional(t.Number({ minimum: 30, maximum: 10000 })), config: t.Optional(t.Any()), options: t.Object({ initialCapital: t.Number(), spread: t.Number(), slippage: t.Number(), commissionPerUnit: t.Number(), units: t.Number() }) }) });

app.post('/api/strategy/chart', async ({ body, request, set }) => {
  if (!adminKey || !safeEqual(request.headers.get('x-admin-key') ?? '', adminKey)) {
    set.status = 403; return { error: 'Admin key required' };
  }
  if (runnerStrategy !== 'sma_micro_trend' || !watchedSymbols.includes(body.symbol) || !isTimeframe(body.timeframe)) {
    set.status = 400; return { error: 'Invalid strategy, symbol or timeframe' };
  }
  const config = runner?.scopedSmaConfig(body.symbol, body.timeframe) ?? defaultSmaMicroTrendConfig;
  const rates = await broker.getRates(body.symbol, body.timeframe, 150);
  const macroTimeframe = config.filters.requireMacroTrendAlignment
    ? resolveMacroTimeframe(body.timeframe, config.filters.macroTimeframe)
    : null;
  if (config.filters.requireMacroTrendAlignment && !macroTimeframe) {
    set.status = 400;
    return { error: 'Macro timeframe must be higher than entry timeframe' };
  }
  const macroRates = macroTimeframe ? await broker.getRates(body.symbol, macroTimeframe, 400) : null;
  const closed = rates.slice(0, -1);
  const fast = sma(closed.map((r) => r.c), config.indicators.fastSMA);
  const slow = sma(closed.map((r) => r.c), config.indicators.slowSMA);
  const atrSeries = atr(closed, config.indicators.atrPeriod);
  const signals = closed.map((_, i) => {
    if (i === 0) return null;
    const signal = evaluateSmaMicroTrend(rates.slice(0, i + 2), config).signal;
    if (!signal || !macroRates) return signal;
    const macroTrend = macroTrendAt(macroRates, rates[i + 1]!.t, config);
    return (signal === 'BUY' && macroTrend === 'UP') || (signal === 'SELL' && macroTrend === 'DOWN') ? signal : null;
  });
  const positions = (await broker.getPositions()).filter((p) => p.symbol === body.symbol);
  return { symbol: body.symbol, timeframe: body.timeframe, candles: closed.map((bar, i) => ({ ...bar, fast: fast[i], slow: slow[i], atr: atrSeries[i], signal: signals[i], trend: fast[i] != null && slow[i] != null ? (fast[i]! > slow[i]! ? 'UP' : fast[i]! < slow[i]! ? 'DOWN' : 'NEUTRAL') : 'NOT_READY' })), positions };
}, { body: t.Object({ symbol: t.String(), timeframe: t.String() }) });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  runner?.stop();
  const deadline = setTimeout(() => process.exit(1), 5000);
  try {
    const account = await broker.getAccount().catch(() => null);
    await endBotSession(
      signal,
      account,
      account ? await tradeServer(account.id) : undefined,
    );
    await app.stop();
    await sql.end({ timeout: 1 });
    clearTimeout(deadline);
    process.exit(0);
  } catch (error) {
    console.warn(
      '[bot session] shutdown record failed',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  app.listen(Number(process.env.API_PORT ?? 3001));
}
console.log(
  `API listening on http://localhost:${Number(process.env.API_PORT ?? 3001)}`,
);
export { app, broker };
