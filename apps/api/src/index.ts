import { Elysia, t } from 'elysia';
import { db, schema, sql } from '@trade/database';
import { desc, sql as dsql } from 'drizzle-orm';
import { MT5BrokerAdapter } from '@trade/broker';
import type { Timeframe } from '@trade/shared';
import { TIMEFRAMES, isTimeframe, signalSchema } from '@trade/shared';
import { safeEqual, verifyWebhook } from './services/webhook-security';
import { TradingEngine } from './services/trading-engine';
import { audit, emit, subscribe } from './services/events';
import { getSettings, updateSettings } from './services/settings';
import { StrategyRunner, ensureStrategy } from './services/strategy-runner';

// The application trades MetaTrader 5 and nothing else. There is no mock
// provider to fall back to: an unreachable terminal is reported as
// disconnected and retried, never faked with synthetic data.
const provider = 'mt5';
const mode = process.env.TRADING_MODE ?? 'paper';
if (mode !== 'paper' && mode !== 'live')
  throw new Error(`Unknown TRADING_MODE: ${mode}`);

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
      .filter(Boolean)
      .map((symbol) => symbol.toUpperCase()),
  ),
];
if (!watchedSymbols.includes(primarySymbol))
  watchedSymbols.unshift(primarySymbol.toUpperCase());

const broker = new MT5BrokerAdapter({
  symbols: watchedSymbols,
  ...(process.env.MT5_BRIDGE_DIR
    ? { directory: process.env.MT5_BRIDGE_DIR }
    : {}),
  ...(process.env.MT5_MAGIC ? { magic: Number(process.env.MT5_MAGIC) } : {}),
});

// ACCOUNT_TRADE_MODE: 0 = demo, 1 = contest, 2 = real.
const ACCOUNT_TRADE_MODE_DEMO = 0;

async function assertAccountIsSafe(beat: { tradeMode: number; login: number }) {
  const isReal = beat.tradeMode > ACCOUNT_TRADE_MODE_DEMO;
  if (mode === 'paper' && isReal)
    throw new Error(
      `TRADING_MODE=paper but the terminal is logged into a real-money account ` +
        `(login ${beat.login}). Set TRADING_MODE=live only when you mean it.`,
    );
  if (mode === 'live' && !isReal)
    throw new Error(
      `TRADING_MODE=live but the terminal is on a demo/contest account ` +
        `(login ${beat.login}); there is nothing to trade live.`,
    );
  if (mode === 'live' && process.env.MT5_LIVE_ACK !== String(beat.login))
    throw new Error(
      `Refusing to trade live: set MT5_LIVE_ACK=${beat.login} to confirm that ` +
        `account ${beat.login} is the one you intend to trade.`,
    );
}

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
async function reconcileBroker(): Promise<boolean> {
  const online = await broker.probe();
  if (online) {
    const beat = await broker.heartbeat();
    if (beat) {
      try {
        await assertAccountIsSafe(beat);
      } catch (error) {
        // A connected-but-unsafe terminal is worse than a disconnected one, so
        // drop the session rather than letting orders route to it.
        console.error(`[broker] ${(error as Error).message}`);
        await broker.disconnect();
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

const engine = new TradingEngine(broker, await brokerIdentity());

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
        path === '/api/logs' ||
        path === '/api/events' ||
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
      mode,
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
    const result = await engine.process(parsed.data, {
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
      return engine.process(parsed.data, {
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
      db
        .select()
        .from(schema.tradingSignals)
        .orderBy(desc(schema.tradingSignals.receivedAt))
        .limit(50),
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
    ]);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const daily = trades.filter((trade) => trade.closedAt >= today);
    const pnl = daily.reduce((sum, trade) => sum + Number(trade.pnl), 0);
    return {
      account,
      positions,
      price,
      settings,
      signals,
      orders,
      trades,
      strategies,
      stats: {
        dailyPnl: pnl,
        openPnl: positions.reduce((sum, p) => sum + p.unrealizedPnl, 0),
        tradesToday: daily.length,
        winningTrades: trades.filter((t) => Number(t.pnl) > 0).length,
        losingTrades: trades.filter((t) => Number(t.pnl) < 0).length,
        winRate: trades.length
          ? (trades.filter((t) => Number(t.pnl) > 0).length / trades.length) *
            100
          : 0,
      },
      brokerConnected: broker.connected,
      provider,
      mode,
      symbol: primarySymbol,
      symbols: watchedSymbols,
    };
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
      const updated = await updateSettings(body);
      if (body.emergencyStop === true) {
        await emit('risk.emergency_stop', { enabled: true });
        await audit('RISK', 'emergency_stop_enabled');
      }
      if (body.autoTradingEnabled === false)
        await audit('RISK', 'auto_trading_disabled');
      if (body.autoTradingEnabled !== undefined)
        await emit('risk.auto_trading', { enabled: body.autoTradingEnabled });
      return updated;
    },
    {
      body: t.Object({
        autoTradingEnabled: t.Optional(t.Boolean()),
        emergencyStop: t.Optional(t.Boolean()),
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
if (runnerStrategy) {
  const requested = process.env.STRATEGY_TIMEFRAME ?? 'M30';
  if (!isTimeframe(requested))
    throw new Error(
      `Unknown STRATEGY_TIMEFRAME "${requested}". Expected one of: ${TIMEFRAMES.join(', ')}.`,
    );
  const timeframe: Timeframe = requested;
  runner = new StrategyRunner(broker, engine, {
    strategyName: runnerStrategy,
    symbols: watchedSymbols,
    timeframe,
    ...(process.env.STRATEGY_POLL_MS
      ? { pollIntervalMs: Number(process.env.STRATEGY_POLL_MS) }
      : {}),
  });
  const readiness = await ensureStrategy(runnerStrategy, watchedSymbols);
  if (!readiness.ok) {
    console.error(
      `[strategy] ${runnerStrategy} not started: ${readiness.detail}`,
    );
    await audit('STRATEGY', 'runner_blocked', undefined, undefined, {
      strategy: runnerStrategy,
      detail: readiness.detail,
    });
  } else {
    runner.start();
    console.log(
      `[strategy] ${runnerStrategy} watching ${watchedSymbols.join(', ')} ${timeframe} (${readiness.detail})`,
    );
  }
}

app.get('/api/strategy', () => ({
  strategy: runnerStrategy || null,
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
    const timeframe = body.timeframe;
    if (!isTimeframe(timeframe)) {
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
    const previous = runner.state.timeframe;
    runner.setTimeframe(timeframe);
    await audit('STRATEGY', 'timeframe_changed', undefined, undefined, {
      strategy: runnerStrategy,
      from: previous,
      to: timeframe,
    });
    await emit('strategy.timeframe', { from: previous, to: timeframe });
    return runner.state;
  },
  { body: t.Object({ timeframe: t.String() }) },
);

if (process.env.NODE_ENV !== 'test') app.listen(3001);
console.log('API listening on http://localhost:3001');
export { app, broker };
