import { existsSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Rate, Timeframe } from '@trade/shared';

/**
 * File transport for the MQL5 bridge service.
 *
 * The service runs inside the MetaTrader 5 terminal and owns all MT5 access.
 * MQL5 cannot host an HTTP server, and the terminal is reachable only through
 * the files it exposes under its *common* data folder, so the two halves talk
 * over flat files:
 *
 *   - reads  : the service pushes snapshots (`aurum-*.json`), we just read them
 *   - writes : a sequential request/response queue (`aurum-cmd-*` -> `aurum-res-*`)
 *
 * The service owns the sequence counter and skips anything at or below its
 * high-water mark, so this client must never reuse a sequence number. It only
 * has to pick a number greater than every sequence file already on disk.
 */

/** File names are flat because MQL5 can neither create nor list directories. */
export const BRIDGE_PREFIX = 'aurum-';

export interface BridgeHeartbeat {
  ts: number;
  build: number;
  connected: boolean;
  tradeAllowed: boolean;
  login: number;
  server: string;
  name: string;
  currency: string;
  tradeMode: number;
  dataPath: string;
  commonPath: string;
  /** Last command sequence the service executed; the client resumes above it. */
  seq?: number;
}

export interface BridgeSymbolState {
  symbol: string;
  minLot?: number;
  maxLot?: number;
  lotStep?: number;
  contractSize?: number;
  tickValue?: number;
  tickSize?: number;
  maxSpread?: number;
  maxSlippage?: number;
  defaultStopLoss?: number;
  defaultTakeProfit?: number;
  marginRate?: number;
  stopsLevel?: number;
  spread?: number;
  bid?: number;
  ask?: number;
  digits?: number;
  point?: number;
  marketOpen?: boolean;
}

export interface BridgeCommand {
  op:
    | 'ping'
    | 'account'
    | 'symbols'
    | 'positions'
    | 'orders'
    | 'place'
    | 'close'
    | 'modify'
    | 'find_symbols'
    | 'rates';
  query?: string;
  symbol?: string;
  side?: 'BUY' | 'SELL';
  lots?: number;
  sl?: number;
  tp?: number;
  comment?: string;
  magic?: number;
  maxSlippage?: number;
  positionId?: number;
  symbols?: string;
  period?: Timeframe;
  count?: number;
}

/**
 * Rejections travel as `ok: false` plus a reason, never as a transport failure,
 * because the trading engine treats a thrown error as a failed signal and a
 * `REJECTED` result as a business outcome worth recording.
 */
export interface BridgeReply {
  ok: boolean;
  error?: string;
  retcode?: number;
  retcodeText?: string;
  brokerOrderId?: string;
  dealId?: string;
  positionId?: string;
  executedPrice?: number;
  /** Server-side realised profit for the deal, in account currency. */
  profit?: number;
  comment?: string;
  data?: {
    refreshed?: boolean;
    watching?: number;
    pong?: boolean;
    matches?: string;
    symbol?: string;
    period?: string;
    rates?: Rate[];
  };
}

/**
 * Written by the service into the common folder only, so its presence is what
 * proves a candidate directory really is the one MT5 treats as common. That
 * matters because the macOS terminal runs under a Wine prefix where the path is
 * not obvious from the documentation.
 */
export interface BridgeDescriptor {
  version: number;
  protocol: string;
  build: number;
  login: number;
  server: string;
  company: string;
  dataPath: string;
  commonPath: string;
}

export interface BridgeOptions {
  directory?: string;
  /** How long to wait for the service to answer a command. */
  commandTimeoutMs?: number;
  /** A snapshot older than this means the service is gone, not that data is stale. */
  heartbeatMaxAgeMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 8000;
const DEFAULT_HEARTBEAT_MAX_AGE_MS = 15000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const SEQUENCE_PATTERN = /^aurum-(?:cmd|res)-(\d+)\.json$/;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Candidate locations of `Terminal\Common\Files` inside the Wine prefix that the
 * MetaTrader 5 macOS app creates. The per-terminal hash folder does not appear
 * here because the common folder is shared between terminals.
 */
export function bridgeDirCandidates(home = homedir()): string[] {
  const candidates = [
    process.env.MT5_BRIDGE_DIR,
    process.env.MT5_TERMINAL_DIR,
  ].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  const wineRoot = join(
    home,
    'Library/Application Support/net.metaquotes.wine.metatrader5/drive_c',
  );
  candidates.push(
    join(wineRoot, 'Program Files/MetaTrader 5/MQL5/Files'),
    join(
      wineRoot,
      'users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files',
    ),
  );
  return candidates;
}

/**
 * Resolves the bridge directory.
 *
 * An explicit path always wins, then any candidate the service has already
 * proven by writing its descriptor, then mere existence. Guessing is confined
 * to the last case, where a wrong guess only replaces one "not reachable" error
 * with a more precise one; once the service has run, discovery is exact.
 */
export function resolveBridgeDir(options: BridgeOptions = {}): string {
  const explicit = options.directory ?? process.env.MT5_BRIDGE_DIR;
  if (explicit) return explicit;
  const candidates = bridgeDirCandidates();
  for (const candidate of candidates)
    if (existsSync(join(candidate, `${BRIDGE_PREFIX}bridge.json`)))
      return candidate;
  for (const candidate of candidates)
    if (existsSync(candidate)) return candidate;
  throw new Error(
    'MetaTrader bridge directory not found. Tried: ' +
      candidates.join(', ') +
      '. Set MT5_BRIDGE_DIR to the Terminal\\Common\\Files folder of the terminal.',
  );
}

export class MT5Bridge {
  readonly directory: string;
  readonly commandTimeoutMs: number;
  readonly heartbeatMaxAgeMs: number;
  private readonly pollIntervalMs: number;
  /** Last good parse per snapshot file, so a torn read never blanks broker state. */
  private readonly cache = new Map<string, unknown>();
  private reserved = 0;

  constructor(options: BridgeOptions = {}) {
    this.directory = resolveBridgeDir(options);
    this.commandTimeoutMs =
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.heartbeatMaxAgeMs =
      options.heartbeatMaxAgeMs ?? DEFAULT_HEARTBEAT_MAX_AGE_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  private path(name: string) {
    return join(this.directory, `${BRIDGE_PREFIX}${name}`);
  }

  /**
   * Clears commands and responses orphaned by a previous process. The service
   * already refuses to replay a sequence at or below its high-water mark, but
   * removing them keeps a stale `place` from being answered to a dead caller.
   */
  async cleanup() {
    for (const entry of await this.entries())
      if (SEQUENCE_PATTERN.test(entry))
        await rm(join(this.directory, entry), { force: true });
  }

  private async entries(): Promise<string[]> {
    try {
      return await readdir(this.directory);
    } catch {
      return [];
    }
  }

  private async readSnapshot<T>(name: string): Promise<T | null> {
    let raw: string;
    try {
      raw = await readFile(this.path(name), 'utf8');
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as T;
      this.cache.set(name, parsed);
      return parsed;
    } catch {
      // The service replaces snapshots delete-then-move, so a brief window
      // exists with the file absent or half written. Serve the last good parse
      // instead of reporting a live broker as unreachable.
      return (this.cache.get(name) as T | undefined) ?? null;
    }
  }

  /** Identity the service published for itself, or null before it first ran. */
  descriptor() {
    return this.readSnapshot<BridgeDescriptor>('bridge.json');
  }

  heartbeat() {
    return this.readSnapshot<BridgeHeartbeat>('heartbeat.json');
  }

  account() {
    return this.readSnapshot<Record<string, number | string>>('account.json');
  }

  async symbols(): Promise<Record<string, BridgeSymbolState>> {
    const payload = await this.readSnapshot<{
      symbols?: Record<string, BridgeSymbolState>;
    }>('symbols.json');
    return payload?.symbols ?? {};
  }

  async positions(): Promise<Record<string, number | string>[]> {
    const payload = await this.readSnapshot<{
      positions?: Record<string, number | string>[];
    }>('positions.json');
    return payload?.positions ?? [];
  }

  async orders(): Promise<Record<string, number | string>[]> {
    const payload = await this.readSnapshot<{
      orders?: Record<string, number | string>[];
    }>('orders.json');
    return payload?.orders ?? [];
  }

  /** True while the service is writing snapshots and the terminal holds a session. */
  async isAlive(): Promise<boolean> {
    const beat = await this.heartbeat();
    if (!beat) return false;
    if (Date.now() - beat.ts * 1000 > this.heartbeatMaxAgeMs) return false;
    return beat.connected;
  }

  /** Seconds since the service last wrote a heartbeat, or null if it never ran. */
  async heartbeatAgeMs(): Promise<number | null> {
    const beat = await this.heartbeat();
    return beat ? Date.now() - beat.ts * 1000 : null;
  }

  /**
   * Reserves the next sequence. The service walks 1, 2, 3... and refuses to
   * replay anything at or below its high-water mark, so the only rule is that
   * this number must exceed every sequence file already on disk. Counting up
   * from `reserved` additionally guarantees uniqueness between concurrent
   * callers, which a directory scan alone cannot do.
   */
  private nextSequence(): number {
    let highest = 0;
    try {
      for (const entry of readdirSync(this.directory)) {
        const match = SEQUENCE_PATTERN.exec(entry);
        if (match?.[1]) highest = Math.max(highest, Number(match[1]));
      }
    } catch {
      // A missing directory simply means the service has never run.
    }
    // The service keeps its own high-water mark across restarts (an MT5 global
    // variable) and skips anything at or below it, so a directory scan is not
    // enough once our own replies have been deleted. Never fall behind it.
    this.reserved = Math.max(
      highest + 1,
      this.serviceSequence() + 1,
      this.reserved + 1,
    );
    return this.reserved;
  }

  /** The service's last executed sequence, read straight from the heartbeat. */
  private serviceSequence(): number {
    try {
      const beat = JSON.parse(
        readFileSync(this.path('heartbeat.json'), 'utf8'),
      ) as BridgeHeartbeat;
      return typeof beat.seq === 'number' ? beat.seq : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Publishes one command and waits for its reply.
   *
   * `run` is deliberately the only writer: it reserves the sequence, stages the
   * payload, renames it into place atomically, and always removes the command
   * afterwards so a crash cannot leave the service with work for nobody.
   */
  private async run(
    command: BridgeCommand,
    timeoutMs?: number,
  ): Promise<BridgeReply> {
    // Plain decimal, unpadded: MQL5 builds the name with IntegerToString, so
    // anything fancier here would never match the file the service looks for.
    const name = String(this.nextSequence());
    const commandPath = this.path(`cmd-${name}.json`);
    const stagedPath = this.path(`cmd-${name}.json.partial`);
    const responsePath = this.path(`res-${name}.json`);
    const limit = timeoutMs ?? this.commandTimeoutMs;

    await rm(responsePath, { force: true });
    await writeFile(stagedPath, JSON.stringify(command), 'utf8');
    renameSync(stagedPath, commandPath);

    const deadline = Date.now() + limit;
    try {
      let unreadable = 0;
      while (Date.now() < deadline) {
        let raw: string | null = null;
        try {
          raw = await readFile(responsePath, 'utf8');
        } catch {
          raw = null;
        }
        if (raw !== null) {
          let reply: BridgeReply;
          try {
            reply = JSON.parse(raw) as BridgeReply;
          } catch {
            // The service answered but the payload is not JSON. Reporting that
            // beats burning the whole timeout against a terminal that looks
            // perfectly healthy, which is the hardest version of this bug to
            // diagnose. A few retries absorb a torn read without hiding it.
            unreadable++;
            if (unreadable >= 3)
              throw new Error(
                `MetaTrader wrote a reply that is not valid JSON ` +
                  `(${raw.length} bytes): ${raw.slice(0, 160)}`,
              );
            await sleep(this.pollIntervalMs);
            continue;
          }
          if (!reply.ok)
            throw new Error(reply.error ?? 'MetaTrader rejected the command');
          return reply;
        }
        await sleep(this.pollIntervalMs);
      }
      throw new Error(
        `MetaTrader bridge timed out after ${limit}ms (sequence ${name}); ` +
          'check that the terminal is logged in and the AurumBridge service is running.',
      );
    } finally {
      // Both halves are removed: the service has no interest in a command it
      // has answered, and leaving replies behind would grow the terminal's
      // data folder by one file per trade forever.
      await rm(commandPath, { force: true });
      await rm(responsePath, { force: true });
    }
  }

  ping(timeoutMs = 2000) {
    return this.run({ op: 'ping' }, timeoutMs);
  }

  /**
   * OHLC history, oldest first. Indicators are computed host-side because the
   * terminal owns the bars and this keeps a single implementation of each
   * indicator under test.
   */
  async getRates(
    symbol: string,
    period: Timeframe = 'M30',
    count = 200,
    timeoutMs = 8000,
  ): Promise<Rate[]> {
    // A rejection throws out of `run` rather than returning `ok: false`, so the
    // caller sees "no bars available for XAUUSD.a M30" instead of an empty list
    // that would read as a quiet market.
    const reply = await this.run(
      { op: 'rates', symbol, period, count },
      timeoutMs,
    );
    return reply.data?.rates ?? [];
  }

  /**
   * Asks the terminal for symbols matching a substring. Broker naming carries
   * suffixes (`XAUUSD.a`, `XAUUSDm`) that cannot be derived host-side, so this
   * exists instead of a hard-coded list that would rot with the account.
   */
  async findSymbols(query: string, timeoutMs = 4000): Promise<string[]> {
    const reply = await this.run({ op: 'find_symbols', query }, timeoutMs);
    const matches = reply.data?.matches;
    if (typeof matches !== 'string' || matches.length === 0) return [];
    return matches.split(',').filter((name) => name.length > 0);
  }

  refresh() {
    return this.run({ op: 'account' }, this.commandTimeoutMs);
  }

  /**
   * Narrows published snapshots to the symbols the bot actually trades. MT5
   * exposes thousands of symbols, so snapshotting all of them is not viable.
   */
  async watch(symbols: string[]) {
    if (symbols.length === 0) return;
    await this.run({ op: 'symbols', symbols: symbols.join(',') });
  }

  place(command: Omit<BridgeCommand, 'op'>) {
    return this.run({ op: 'place', ...command });
  }

  close(command: Omit<BridgeCommand, 'op'>) {
    return this.run({ op: 'close', ...command });
  }

  modify(command: Omit<BridgeCommand, 'op'>) {
    return this.run({ op: 'modify', ...command });
  }
}
