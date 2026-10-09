/**
 * Terminal-side diagnostic for the MT5 file bridge.
 *
 * Every step here is read-only against the account: it resolves the bridge
 * directory, reads what the service published, and round-trips a single ping
 * through the command queue. Nothing sends an order, so it is safe to run
 * against a live terminal.
 *
 *   bun packages/broker/scripts/doctor-mt5.ts
 *   MT5_PRIMARY_SYMBOL=XAUUSD.m bun packages/broker/scripts/doctor-mt5.ts
 */
import {
  MT5Bridge,
  bridgeDirCandidates,
  resolveBridgeDir,
} from '../src/mt5/bridge';

const problems: string[] = [];
const notes: string[] = [];

function check(label: string, ok: boolean, detail: string, fix?: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(14)} ${detail}`);
  if (!ok) {
    problems.push(label);
    if (fix) notes.push(`${label}: ${fix}`);
  }
}

const bridge = new MT5Bridge({
  commandTimeoutMs: Number(process.env.MT5_DOCTOR_TIMEOUT_MS ?? 2000),
});

let dir: string;
try {
  dir = resolveBridgeDir();
} catch (error) {
  console.log('FAIL  bridge dir     could not resolve the bridge directory');
  console.log(`      ${(error as Error).message}\n`);
  console.log('      candidates:');
  for (const candidate of bridgeDirCandidates())
    console.log(`        - ${candidate}`);
  process.exit(1);
}
check('bridge dir', true, dir);

const descriptor = await bridge.descriptor();
if (!descriptor) {
  check(
    'service',
    false,
    'bridge.json missing',
    'Start AurumBridge in Navigator > Expert Advisors > Services',
  );
} else {
  check(
    'service',
    descriptor.protocol === 'aurum-file-queue/1',
    `${descriptor.protocol} | build ${descriptor.build} | login ${descriptor.login} | ${descriptor.server}`,
  );
  const wanted = process.env.MT5_LIVE_ACK;
  if (wanted && String(descriptor.login) !== wanted)
    check(
      'account ack',
      false,
      `terminal is ${descriptor.login}, MT5_LIVE_ACK is ${wanted}`,
    );
  else if (wanted) check('account ack', true, `matches MT5_LIVE_ACK=${wanted}`);
}

const heartbeat = await bridge.heartbeat();
if (!heartbeat) {
  check(
    'heartbeat',
    false,
    'no aurum-heartbeat.json',
    'Start the service in Navigator > Expert Advisors > Services',
  );
} else {
  const ageMs = await bridge.heartbeatAgeMs();
  check(
    'heartbeat',
    ageMs !== null && ageMs < 5000,
    `${ageMs} ms old`,
    'Service writes every 200ms when started',
  );
  check(
    'connected',
    heartbeat.connected,
    `login ${heartbeat.login} on ${heartbeat.server}`,
  );
  check(
    'trade allowed',
    heartbeat.tradeAllowed,
    heartbeat.tradeAllowed
      ? 'automated trading is enabled'
      : 'order sending will be rejected',
    'Tools > Options > Expert Advisors > uncheck "Disable automated trading"',
  );
  console.log(
    `      account holder ${heartbeat.name} (${heartbeat.currency}, ${heartbeat.tradeMode === 0 ? 'demo' : 'live'})`,
  );
}

try {
  const account = await bridge.account();
  if (!account) check('account', false, 'no aurum-account.json');
  else
    check(
      'account',
      true,
      `${account.id} balance ${account.balance} ${account.currency} leverage ${account.leverage}`,
    );
} catch (error) {
  check('account', false, (error as Error).message);
}

try {
  const states = await bridge.symbols();
  const names = Object.keys(states);
  // The API pushes the watch list on every connect, so a stale list here means
  // the service has not been told about it, or is running an older build.
  const configured = (
    process.env.MT5_SYMBOLS ??
    process.env.MT5_PRIMARY_SYMBOL ??
    ''
  )
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (configured.length === 0) {
    if (names.length === 0) {
      check(
        'symbols',
        false,
        'watch list is empty',
        'Set MT5_SYMBOLS and restart the API to populate it',
      );
    } else check('symbols', true, `${names.length} in the watch list`);
  } else {
    const missing = configured.filter((symbol) => !states[symbol]);
    check(
      'watch list',
      missing.length === 0,
      missing.length === 0
        ? `all ${configured.length} configured symbol(s) watched (${names.length} in the list)`
        : `not watched: ${missing.join(', ')}`,
      'The API pushes MT5_SYMBOLS on every connect; restart the service so it picks the list up',
    );
    // Ask the terminal what it actually carries instead of guessing suffixes.
    // A failure here must not mask the finding above, so it stays contained.
    for (const symbol of missing.slice(0, 3)) {
      const base = symbol
        .replace(/[._#].*$/, '')
        .toUpperCase()
        .slice(0, 3);
      try {
        const matches = await bridge.findSymbols(base);
        console.log(
          matches.length > 0
            ? `      did you mean: ${matches.join(', ')}`
            : `      no symbol on this account contains "${base}"`,
        );
      } catch (error) {
        console.log(
          `      could not list symbols: ${(error as Error).message}`,
        );
      }
    }
  }
} catch (error) {
  check('symbols', false, (error as Error).message);
}

try {
  const positions = await bridge.positions();
  const orders = await bridge.orders();
  check(
    'positions',
    true,
    `${positions.length} open, ${orders.length} working orders`,
  );
} catch (error) {
  check('positions', false, (error as Error).message);
}

try {
  const startedAt = Date.now();
  const reply = await bridge.ping();
  check(
    'command queue',
    reply.ok,
    reply.ok
      ? `round trip in ${Date.now() - startedAt} ms (pong ${reply.data?.pong})`
      : (reply.error ?? `retcode ${reply.retcode} ${reply.retcodeText}`),
  );
} catch (error) {
  check(
    'command queue',
    false,
    (error as Error).message,
    'The service must be running, not attached to a chart or run once as a script',
  );
}

if (problems.length === 0) {
  console.log('\nbridge is ready');
  process.exit(0);
}

console.log(`\n${problems.length} problem(s): ${problems.join(', ')}`);
for (const note of notes) console.log(`  - ${note}`);
process.exit(1);
