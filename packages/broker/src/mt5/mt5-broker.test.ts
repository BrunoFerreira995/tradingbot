import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MT5Bridge, resolveBridgeDir } from './bridge';
import { MT5BrokerAdapter, fingerprint } from './mt5-broker';

/**
 * Stands in for the MQL5 service. It honours the same flat-file contract:
 * snapshots written continuously, a strictly sequential command queue, and a
 * high-water mark so an already-executed sequence is never replayed.
 */
class FakeTerminal {
  readonly directory: string;
  private highWater = 0;
  private handler: (command: Record<string, unknown>) => unknown = () => ({
    ok: true,
  });
  private readonly seen: Record<string, unknown>[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;

  constructor(directory: string) {
    this.directory = directory;
  }

  path(name: string) {
    return join(this.directory, `aurum-${name}`);
  }

  private async write(name: string, payload: unknown) {
    await writeFile(this.path(name), JSON.stringify(payload), 'utf8');
  }

  /** Runs the queue on a timer, exactly as the 200 ms MQL5 service timer does. */
  start() {
    this.timer = setInterval(() => void this.drain(), 2);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  respondWith(handler: (command: Record<string, unknown>) => unknown) {
    this.handler = handler;
  }

  commands() {
    return this.seen;
  }

  lastCommand() {
    return this.seen[this.seen.length - 1];
  }

  async publish(
    state: {
      connected?: boolean;
      tradeMode?: number;
      account?: Record<string, unknown>;
      symbols?: Record<string, unknown>;
      positions?: unknown[];
      orders?: unknown[];
      heartbeatAgeSeconds?: number;
    } = {},
  ) {
    const age = state.heartbeatAgeSeconds ?? 0;
    await this.write('heartbeat.json', {
      ts: Math.floor(Date.now() / 1000) - age,
      build: 6230,
      connected: state.connected ?? true,
      tradeAllowed: true,
      login: 61549674,
      server: 'Pepperstone-Demo',
      name: 'Trader',
      currency: 'USD',
      tradeMode: state.tradeMode ?? 0,
      dataPath: 'C:\\data',
      commonPath: this.directory,
    });
    if (state.account)
      await this.write('account.json', {
        id: '61549674',
        balance: 10000,
        equity: 10000,
        usedMargin: 0,
        freeMargin: 10000,
        marginLevel: 0,
        currency: 'USD',
        ...state.account,
      });
    if (state.symbols)
      await this.write('symbols.json', { symbols: state.symbols });
    if (state.positions)
      await this.write('positions.json', { positions: state.positions });
    if (state.orders) await this.write('orders.json', { orders: state.orders });
  }

  /** Drains the queue the way the service does: strictly in sequence order. */
  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const next = this.highWater + 1;
        let raw: string;
        try {
          raw = await readFile(this.path(`cmd-${next}.json`), 'utf8');
        } catch {
          return;
        }
        const command = JSON.parse(raw) as Record<string, unknown>;
        this.seen.push(command);
        // Advance before replying: MQL5 handles a tick without yielding, so the
        // client can never observe a reply ahead of the high-water mark.
        this.highWater = next;
        await this.write(`res-${next}.json`, this.handler(command));
        await rm(this.path(`cmd-${next}.json`), { force: true });
      }
    } finally {
      this.busy = false;
    }
  }

  get lastSequence() {
    return this.highWater;
  }

  pending(): string[] {
    return readdirSync(this.directory).filter((entry) =>
      /^aurum-(cmd|res)-/.test(entry),
    );
  }
}

const XAUUSD = {
  symbol: 'XAUUSD',
  minLot: 0.01,
  maxLot: 100,
  lotStep: 0.01,
  contractSize: 100,
  tickValue: 1,
  tickSize: 0.01,
  maxSpread: 1.5,
  maxSlippage: 0.3,
  defaultStopLoss: 12,
  defaultTakeProfit: 24,
  marginRate: 1,
  marketOpen: true,
  stopsLevel: 0.00001,
  bid: 2650.1,
  ask: 2650.3,
  spread: 0.2,
  digits: 2,
  point: 0.01,
};

const FILLED = {
  ok: true,
  retcode: 10009,
  brokerOrderId: '778899',
  positionId: '4455662',
  executedPrice: 2650.3,
};

let directory: string;
let terminal: FakeTerminal;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'aurum-bridge-'));
  terminal = new FakeTerminal(directory);
  terminal.start();
});

afterEach(async () => {
  terminal.stop();
  await rm(directory, { recursive: true, force: true });
});

/** Boots an adapter against the fake terminal, already connected. */
async function boot(
  options: { magic?: number; startupTimeoutMs?: number } = {},
) {
  await terminal.publish({
    symbols: { XAUUSD },
    account: { balance: 10000 },
  });
  const bridge = new MT5Bridge({
    directory,
    commandTimeoutMs: 1000,
    pollIntervalMs: 2,
  });
  const adapter = new MT5BrokerAdapter({
    bridge,
    symbols: ['XAUUSD'],
    startupTimeoutMs: options.startupTimeoutMs ?? 2000,
    ...(options.magic ? { magic: options.magic } : {}),
  });
  await adapter.connect();
  return adapter;
}

describe('MT5Bridge', () => {
  test('reports an unreachable service until a heartbeat lands', async () => {
    const bridge = new MT5Bridge({ directory, pollIntervalMs: 2 });
    expect(await bridge.isAlive()).toBe(false);
    expect(await bridge.heartbeatAgeMs()).toBeNull();
    expect(await bridge.account()).toBeNull();
    expect(await bridge.symbols()).toEqual({});
    expect(await bridge.positions()).toEqual([]);
  });

  test('goes alive on a fresh heartbeat and stale when time moves on', async () => {
    const bridge = new MT5Bridge({ directory, heartbeatMaxAgeMs: 1000 });
    await terminal.publish();
    expect(await bridge.isAlive()).toBe(true);
    expect(await bridge.heartbeatAgeMs()).toBeLessThan(1000);

    await terminal.publish({ heartbeatAgeSeconds: 3600 });
    expect(await bridge.isAlive()).toBe(false);
  });

  test('is not alive while the terminal has no session', async () => {
    const bridge = new MT5Bridge({ directory });
    await terminal.publish({ connected: false });
    expect(await bridge.isAlive()).toBe(false);
  });

  test('treats a torn snapshot as stale data rather than a dead broker', async () => {
    const bridge = new MT5Bridge({ directory });
    await terminal.publish({ account: { balance: 10000 } });
    expect((await bridge.account())?.balance).toBe(10000);

    // The service replaces snapshots delete-then-move, so a half-written file
    // must not blank the account the trading engine already holds.
    writeFileSync(terminal.path('account.json'), '{"balance":1000');
    expect((await bridge.account())?.balance).toBe(10000);
  });

  test('prefers the directory the service proved over one that only exists', () => {
    const proven = mkdtempSync(join(tmpdir(), 'aurum-proven-'));
    const decoy = mkdtempSync(join(tmpdir(), 'aurum-decoy-'));
    const previous = process.env.MT5_BRIDGE_DIR;
    try {
      // The macOS terminal runs under a Wine prefix, so more than one plausible
      // folder exists. The descriptor the service writes into the common folder
      // is what breaks the tie instead of trusting the Wine path layout.
      writeFileSync(
        join(proven, 'aurum-bridge.json'),
        JSON.stringify({ version: 1 }),
      );
      process.env.MT5_BRIDGE_DIR = decoy;
      expect(resolveBridgeDir()).toBe(decoy);
      process.env.MT5_BRIDGE_DIR = proven;
      expect(resolveBridgeDir()).toBe(proven);
    } finally {
      if (previous === undefined) delete process.env.MT5_BRIDGE_DIR;
      else process.env.MT5_BRIDGE_DIR = previous;
      void rm(proven, { recursive: true, force: true });
      void rm(decoy, { recursive: true, force: true });
    }
  });

  test('an explicit directory always wins over discovery', () => {
    expect(resolveBridgeDir({ directory })).toBe(directory);
  });

  test('requests bars and returns them oldest first', async () => {
    const bridge = new MT5Bridge({ directory, pollIntervalMs: 2 });
    // The service serialises MqlRates with its series flag cleared, so the bars
    // arrive oldest first and the bridge must preserve that order: indicators
    // depend on it.
    terminal.respondWith((command) => {
      expect(command).toMatchObject({
        op: 'rates',
        symbol: 'XAUUSD',
        period: 'M30',
        count: 120,
      });
      return {
        ok: true,
        data: {
          symbol: 'XAUUSD',
          period: 'M30',
          rates: [
            { t: 100, o: 1, h: 2, l: 0, c: 1, v: 10 },
            { t: 101, o: 2, h: 3, l: 1, c: 2, v: 20 },
            { t: 102, o: 3, h: 4, l: 2, c: 3, v: 30 },
          ],
        },
      };
    });

    const rates = await bridge.getRates('XAUUSD', 'M30', 120);

    // The service already emits oldest-first, so ordering must survive intact.
    expect(rates.map((r) => r.t)).toEqual([100, 101, 102]);
    expect(rates.at(-1)).toEqual({ t: 102, o: 3, h: 4, l: 2, c: 3, v: 30 });
  });

  test('surfaces the reason instead of an empty series when history is missing', async () => {
    const bridge = new MT5Bridge({ directory, pollIntervalMs: 2 });
    terminal.respondWith(() => ({
      ok: false,
      error: 'no bars available for XAUUSD.a M30',
    }));
    // An empty array would read as a calm market and hide a misconfigured
    // symbol, so a missing symbol has to be an error.
    await expect(bridge.getRates('XAUUSD.a', 'M30', 120)).rejects.toThrow(
      'no bars available for XAUUSD.a M30',
    );
  });

  test('returns no bars when the reply carries no rate array', async () => {
    const bridge = new MT5Bridge({ directory, pollIntervalMs: 2 });
    terminal.respondWith(() => ({ ok: true, data: { symbol: 'XAUUSD' } }));
    expect(await bridge.getRates('XAUUSD', 'M30', 120)).toEqual([]);
  });

  test('finds symbols the account actually carries', async () => {
    const bridge = new MT5Bridge({ directory, pollIntervalMs: 2 });
    terminal.respondWith((command) => {
      expect(command).toMatchObject({ op: 'find_symbols', query: 'XAU' });
      return { ok: true, data: { matches: 'XAUUSD.a,XAUUSDm', count: 2 } };
    });
    expect(await bridge.findSymbols('XAU')).toEqual(['XAUUSD.a', 'XAUUSDm']);
  });

  test('reads the descriptor the service published for itself', async () => {
    const bridge = new MT5Bridge({ directory });
    expect(await bridge.descriptor()).toBeNull();
    await terminal.publish();
    writeFileSync(
      terminal.path('bridge.json'),
      JSON.stringify({
        version: 1,
        protocol: 'aurum-file-queue/1',
        build: 6230,
        login: 61549674,
        server: 'Pepperstone-Demo',
        company: 'Pepperstone',
        dataPath: 'C:\\data',
        commonPath: 'C:\\common',
      }),
    );
    expect(await bridge.descriptor()).toMatchObject({
      protocol: 'aurum-file-queue/1',
      login: 61549674,
    });
  });

  test('routes a command through the queue and removes both files', async () => {
    const bridge = new MT5Bridge({ directory, pollIntervalMs: 2 });
    terminal.respondWith(() => ({ ok: true, data: { pong: true } }));
    const reply = await bridge.ping();
    expect(reply.data?.pong).toBe(true);
    expect(terminal.lastSequence).toBe(1);
    expect(terminal.pending()).toEqual([]);
  });

  test('throws the reason when the service rejects a command', async () => {
    const bridge = new MT5Bridge({ directory, pollIntervalMs: 2 });
    terminal.respondWith(() => ({ ok: false, error: 'market closed' }));
    await expect(bridge.ping()).rejects.toThrow('market closed');
  });

  test('times out with an actionable message when the service never answers', async () => {
    const bridge = new MT5Bridge({ directory, pollIntervalMs: 2 });
    terminal.stop();
    await expect(bridge.ping(120)).rejects.toThrow(/timed out after 120ms/);
  });

  test('serialises concurrent callers so sequences are never reused', async () => {
    const bridge = new MT5Bridge({ directory, pollIntervalMs: 2 });
    const replies = await Promise.all([
      bridge.ping(),
      bridge.ping(),
      bridge.ping(),
    ]);
    expect(terminal.lastSequence).toBe(3);
    expect(terminal.commands().map((c) => c.op)).toEqual([
      'ping',
      'ping',
      'ping',
    ]);
    expect(replies).toHaveLength(3);
  });

  test('cleanup clears orphaned queue files but keeps snapshots', async () => {
    writeFileSync(terminal.path('cmd-000000000007.json'), '{}');
    writeFileSync(terminal.path('res-000000000007.json'), '{}');
    writeFileSync(terminal.path('account.json'), '{}');
    const bridge = new MT5Bridge({ directory });
    await bridge.cleanup();
    expect(terminal.pending()).toEqual([]);
    expect(readdirSync(directory)).toContain('aurum-account.json');
  });

  test('cleanup starts a fresh sequence even after orphans were left behind', async () => {
    writeFileSync(terminal.path('cmd-000000000042.json'), '{}');
    writeFileSync(terminal.path('res-000000000042.json'), '{}');
    const bridge = new MT5Bridge({ directory, pollIntervalMs: 2 });
    await bridge.cleanup();
    terminal.respondWith(() => ({ ok: true, data: { pong: true } }));
    await bridge.ping();
    expect(terminal.lastSequence).toBe(1);
  });
});

describe('MT5BrokerAdapter', () => {
  test('fingerprint is stable, collision-free for near ids, and fits a comment', () => {
    const mark = fingerprint('gold-scalping-v1-sig-1-XAUUSD-BUY');
    expect(mark).toHaveLength(24);
    expect(mark.length).toBeLessThanOrEqual(31);
    expect(mark).toBe(fingerprint('gold-scalping-v1-sig-1-XAUUSD-BUY'));
    expect(mark).not.toBe(fingerprint('gold-scalping-v1-sig-2-XAUUSD-BUY'));
  });

  test('refuses to start when the service has never published a heartbeat', async () => {
    const bridge = new MT5Bridge({ directory, pollIntervalMs: 2 });
    const adapter = new MT5BrokerAdapter({
      bridge,
      symbols: ['XAUUSD'],
      startupTimeoutMs: 120,
    });
    await expect(adapter.connect()).rejects.toThrow(/not reachable/);
    expect(adapter.connected).toBe(false);
  });

  test('asks the service to publish only the traded symbols', async () => {
    await boot();
    expect(terminal.commands()[0]).toMatchObject({
      op: 'symbols',
      symbols: 'XAUUSD',
    });
  });

  test('maps the account snapshot onto AccountInfo', async () => {
    const adapter = await boot();
    expect(await adapter.getAccount()).toEqual({
      id: '61549674',
      balance: 10000,
      equity: 10000,
      usedMargin: 0,
      freeMargin: 10000,
      marginLevel: 0,
      currency: 'USD',
    });
  });

  test('maps a symbol snapshot onto SymbolInfo', async () => {
    const adapter = await boot();
    expect(await adapter.getSymbol('XAUUSD')).toEqual({
      symbol: 'XAUUSD',
      minLot: 0.01,
      maxLot: 100,
      lotStep: 0.01,
      contractSize: 100,
      tickValue: 1,
      tickSize: 0.01,
      maxSpread: 1.5,
      maxSlippage: 0.3,
      defaultStopLoss: 12,
      defaultTakeProfit: 24,
      marginRate: 1,
      marketOpen: true,
      stopsLevel: 0.00001,
    });
  });

  test('reports an unwatched symbol as unavailable and starts watching it', async () => {
    const adapter = await boot();
    await expect(adapter.getSymbol('EURUSD')).rejects.toThrow(
      /Symbol unavailable/,
    );
    expect(terminal.lastCommand()).toMatchObject({
      op: 'symbols',
      symbols: 'XAUUSD,EURUSD',
    });
  });

  test('prices come from the terminal, not from a simulated mid', async () => {
    const adapter = await boot();
    const price = await adapter.getPrice('XAUUSD');
    expect(price.bid).toBe(2650.1);
    expect(price.ask).toBe(2650.3);
    expect(price.spread).toBe(0.2);
    expect(price.symbol).toBe('XAUUSD');
  });

  test('converts position epochs to ISO and drops zero stops', async () => {
    await terminal.publish({
      symbols: { XAUUSD },
      positions: [
        {
          id: '4455661',
          symbol: 'XAUUSD',
          side: 'BUY',
          lots: 0.01,
          entryPrice: 2650.25,
          currentPrice: 2655.5,
          unrealizedPnl: 5.25,
          stopLoss: 2640,
          takeProfit: 0,
          openedAt: 1767225600,
        },
      ],
    });
    const adapter = await boot();
    const positions = await adapter.getPositions();
    expect(positions[0]).toEqual({
      id: '4455661',
      symbol: 'XAUUSD',
      side: 'BUY',
      lots: 0.01,
      entryPrice: 2650.25,
      currentPrice: 2655.5,
      unrealizedPnl: 5.25,
      stopLoss: 2640,
      takeProfit: undefined,
      openedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  test('maps the order snapshot onto Order', async () => {
    await terminal.publish({
      symbols: { XAUUSD },
      orders: [
        {
          id: '778899',
          clientOrderId: fingerprint('gold-scalping-v1-sig-1-XAUUSD-BUY'),
          symbol: 'XAUUSD',
          side: 'BUY',
          lots: 0.01,
          status: 'FILLED',
          requestedPrice: 2650.3,
          executedPrice: 2650.28,
          createdAt: 1767225600,
        },
      ],
    });
    const adapter = await boot();
    expect((await adapter.getOrders())[0]).toEqual({
      id: '778899',
      clientOrderId: fingerprint('gold-scalping-v1-sig-1-XAUUSD-BUY'),
      symbol: 'XAUUSD',
      side: 'BUY',
      lots: 0.01,
      status: 'FILLED',
      requestedPrice: 2650.3,
      executedPrice: 2650.28,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  test('sends the client order fingerprint as the MT5 comment and magic', async () => {
    const adapter = await boot({ magic: 777 });
    terminal.respondWith(() => FILLED);
    const result = await adapter.placeMarketOrder({
      clientOrderId: 'gold-scalping-v1-sig-1-XAUUSD-BUY',
      symbol: 'XAUUSD',
      side: 'BUY',
      lots: 0.01,
      stopLoss: 2640,
      takeProfit: 2660,
      maxSlippage: 0.3,
    });
    expect(terminal.lastCommand()).toMatchObject({
      op: 'place',
      symbol: 'XAUUSD',
      side: 'BUY',
      lots: 0.01,
      sl: 2640,
      tp: 2660,
      maxSlippage: 0.3,
      magic: 777,
      comment: fingerprint('gold-scalping-v1-sig-1-XAUUSD-BUY'),
    });
    expect(result).toMatchObject({
      brokerOrderId: '778899',
      status: 'FILLED',
      positionId: '4455662',
      executedPrice: 2650.3,
    });
  });

  test('omits absent stops so the terminal keeps whatever it had', async () => {
    const adapter = await boot();
    terminal.respondWith(() => FILLED);
    await adapter.placeMarketOrder({
      clientOrderId: 'gold-scalping-v1-sig-4-XAUUSD-BUY',
      symbol: 'XAUUSD',
      side: 'BUY',
      lots: 0.01,
    });
    const command = terminal.lastCommand() ?? {};
    expect('sl' in command).toBe(false);
    expect('tp' in command).toBe(false);
  });

  test('is idempotent per clientOrderId, like the mock adapter', async () => {
    const adapter = await boot();
    let calls = 0;
    terminal.respondWith(() => {
      calls += 1;
      return FILLED;
    });
    const order = {
      clientOrderId: 'gold-scalping-v1-sig-1-XAUUSD-BUY',
      symbol: 'XAUUSD',
      side: 'BUY' as const,
      lots: 0.01,
    };
    const first = await adapter.placeMarketOrder(order);
    const second = await adapter.placeMarketOrder(order);
    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  test('returns REJECTED with the broker reason instead of throwing', async () => {
    const adapter = await boot();
    terminal.respondWith(() => ({
      ok: false,
      error: 'volume 0.03 is not a multiple of the 0.01 lot step',
    }));
    const result = await adapter.placeMarketOrder({
      clientOrderId: 'gold-scalping-v1-sig-9-XAUUSD-BUY',
      symbol: 'XAUUSD',
      side: 'BUY',
      lots: 0.03,
    });
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toMatch(/lot step/);
  });

  test('rejects a fill that came back without a position ticket', async () => {
    const adapter = await boot();
    terminal.respondWith(() => ({ ...FILLED, positionId: '0' }));
    const result = await adapter.placeMarketOrder({
      clientOrderId: 'gold-scalping-v1-sig-3-XAUUSD-SELL',
      symbol: 'XAUUSD',
      side: 'SELL',
      lots: 0.01,
    });
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toMatch(/no position ticket/);
  });

  test('caches a transport failure so a retried signal cannot double-fill', async () => {
    const adapter = await boot();
    terminal.respondWith(() => ({ ok: false, error: 'bridge timed out' }));
    const order = {
      clientOrderId: 'gold-scalping-v1-sig-5-XAUUSD-BUY',
      symbol: 'XAUUSD',
      side: 'BUY' as const,
      lots: 0.01,
    };
    const first = await adapter.placeMarketOrder(order);
    expect(first.status).toBe('REJECTED');
    const before = terminal.lastSequence;
    await adapter.placeMarketOrder(order);
    expect(terminal.lastSequence).toBe(before);
  });

  test('closes by MT5 ticket and rejects a non-ticket id locally', async () => {
    const adapter = await boot();
    terminal.respondWith(() => ({
      ok: true,
      retcode: 10009,
      brokerOrderId: '990011',
      executedPrice: 2655.5,
    }));
    const result = await adapter.closePosition('4455661');
    expect(terminal.lastCommand()).toMatchObject({
      op: 'close',
      positionId: 4455661,
    });
    expect(result).toMatchObject({
      status: 'FILLED',
      positionId: '4455661',
      executedPrice: 2655.5,
    });

    const bad = await adapter.closePosition('not-a-ticket');
    expect(bad.status).toBe('REJECTED');
    expect(bad.reason).toMatch(/not an MT5 ticket/);
  });

  test('modifies stops by ticket', async () => {
    const adapter = await boot();
    terminal.respondWith(() => ({
      ok: true,
      retcode: 10009,
      brokerOrderId: '990012',
    }));
    const result = await adapter.modifyPosition('4455661', 2630, 2680);
    expect(terminal.lastCommand()).toMatchObject({
      op: 'modify',
      positionId: 4455661,
      sl: 2630,
      tp: 2680,
    });
    expect(result.status).toBe('FILLED');
  });

  test('every read and write throws once the adapter is disconnected', async () => {
    const adapter = await boot();
    await adapter.disconnect();
    expect(adapter.connected).toBe(false);
    await expect(adapter.getAccount()).rejects.toThrow('Broker disconnected');
    await expect(adapter.getSymbol('XAUUSD')).rejects.toThrow(
      'Broker disconnected',
    );
    await expect(adapter.getPrice('XAUUSD')).rejects.toThrow(
      'Broker disconnected',
    );
    await expect(adapter.getPositions()).rejects.toThrow('Broker disconnected');
    await expect(adapter.getOrders()).rejects.toThrow('Broker disconnected');
    await expect(
      adapter.placeMarketOrder({
        clientOrderId: 'x',
        symbol: 'XAUUSD',
        side: 'BUY',
        lots: 0.01,
      }),
    ).rejects.toThrow('Broker disconnected');
    await expect(adapter.closePosition('1')).rejects.toThrow(
      'Broker disconnected',
    );
    await expect(adapter.modifyPosition('1')).rejects.toThrow(
      'Broker disconnected',
    );
  });

  test('diagnostics surface the terminal identity for /health', async () => {
    const adapter = await boot();
    expect(await adapter.diagnostics()).toMatchObject({
      provider: 'mt5',
      directory,
      connected: true,
      build: 6230,
      login: 61549674,
      server: 'Pepperstone-Demo',
      tradeAllowed: true,
    });
  });
});
