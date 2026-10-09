# Aurum Terminal

MetaTrader 5 terminal → MQL5 service bridge → Elysia API → PostgreSQL → risk engine → real-time Next.js dashboard. Bun/TypeScript monorepo. There is no simulated broker: the terminal is the only source of market data, account state, positions and orders. A TradingView webhook can still inject a signal that someone else decided on. See [Pepperstone / MT5](#pepperstone--mt5).

The bot decides, the terminal executes. Nothing is attached to a chart and no Expert Advisor runs on a symbol; the only MQL5 code is the bridge service, and all strategy logic lives in `packages/strategy`.

## Start locally

Requirements: Bun 1.3+ and PostgreSQL 16. Docker is optional. Copy `.env.example` to `.env` only if you do not already have a configured `.env`, and set long random values for `TRADINGVIEW_WEBHOOK_SECRET`, `ADMIN_API_KEY`, and `DASHBOARD_PASSWORD`. `AUTO_TRADING_ENABLED=false` is the safe default; enable it in the dashboard after testing.

### macOS without Docker

Install PostgreSQL with Homebrew and start the local service:

```sh
brew install postgresql@16
brew services start postgresql@16
export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
pg_isready -h localhost -p 5432
```

Create the role and database once. These match the local `DATABASE_URL` in `.env.example`; skip creation if they already exist:

```sh
psql -d postgres -c "CREATE ROLE trader WITH LOGIN PASSWORD 'trader';"
createdb -O trader tradingbot
```

Set `DATABASE_URL=postgres://trader:trader@localhost:5432/tradingbot` in `.env`. Install dependencies, apply migrations, and start both apps from the repository root:

```sh
bun install
bun db:migrate
bun dev
```

The development scripts explicitly load the repository-root `.env` for both apps. If `DASHBOARD_USER` and `DASHBOARD_PASSWORD` are set, the browser asks for those credentials in development too.

For an initial inspection with the indicator strategy disabled and a demo account required:

```sh
TRADING_MODE=paper AUTO_TRADING_ENABLED=false STRATEGY_RUNNER= bun dev
```

Risk settings already stored in PostgreSQL take precedence over `AUTO_TRADING_ENABLED`; check Auto Trading in the dashboard before enabling the strategy. The application can run while MetaTrader is disconnected, but account data, prices and execution require the `AurumBridge` service described below. `paper` uses a real demo terminal; it does not simulate market data.

To run the apps in separate terminals (both from the repository root):

```sh
# Terminal 1: API
TRADING_MODE=paper AUTO_TRADING_ENABLED=false STRATEGY_RUNNER= bun --filter '@trade/api' dev
# Terminal 2: dashboard
bun --filter '@trade/web' dev
```

Stop the apps with Ctrl+C. To stop the local database, run `brew services stop postgresql@16`.

### Login local do painel

Acesse http://localhost:3002 e use as credenciais locais configuradas no `.env`:

- Login: `admin`
- Senha: consulte `DASHBOARD_PASSWORD` no arquivo local `.env`.

### Optional Docker setup

```sh
bun install
docker compose up -d postgres
bun db:migrate
bun dev
```

Local development opens the dashboard at `http://localhost:3002`; set `WEB_ORIGIN=http://localhost:3002` in `.env`. The API is at `http://localhost:3001/health`, and the webhook accepts POST at `http://localhost:3001/api/webhooks/tradingview`. In production the dashboard uses HTTP Basic authentication. Run `bun typecheck`, `bun lint`, `bun test`, and `bun run build` before deployment.

For an all-container run, set the required variables in `.env` and run `docker compose up --build`. The API container runs migrations at startup. The web container proxies dashboard data and SSE through `API_INTERNAL_URL`, keeping the admin key on the server.

If ports 3000 or 3001 are occupied, set `WEB_PORT=3100`, `API_PORT=3101`, and `WEB_ORIGIN=http://localhost:3100` in `.env` before starting Compose. The dashboard proxies data and SSE requests to the API internally.

## TradingView

See [docs/tradingview.md](docs/tradingview.md) for webhook JSON and a Pine Script example. A webhook can authenticate with the JSON `secret`, `X-Webhook-Secret`, or timestamped HMAC headers. It must contain a unique `signalId`. Test locally:

```sh
curl -X POST http://localhost:3001/api/webhooks/tradingview -H 'content-type: application/json' -d '{"secret":"YOUR_SECRET","strategy":"gold-scalping-v1","signalId":"manual-001","symbol":"XAUUSD","action":"BUY","orderType":"MARKET","lots":0.01,"stopLoss":25,"takeProfit":50}'
```

In development, `POST /api/test/signal` accepts `{ "action": "BUY" }`, `{ "action": "SELL" }`, or `{ "action": "CLOSE" }`. It is unavailable in production. TradingView must be able to reach a public HTTPS endpoint; localhost is only for local tests.

## Architecture and controls

- `apps/api`: webhook security, API, audit, SSE, and orchestration. Each signal is inserted with a unique `signal_id`. PostgreSQL advisory locking serializes work by account and symbol across API instances.
- `packages/trading`: lot sizing, risk limits, position policy, and order submission. Broker market orders are never retried blindly after timeout.
- `packages/strategy`: indicator maths (Bollinger, RSI, ATR) and the strategies built on it. Host-side and unit-tested, so there is one implementation of each rather than one in MQL5 and one in TypeScript.
- `packages/broker`: the MetaTrader 5 bridge adapter (real market data and order routing) plus an isolated cTrader placeholder. The in-memory double used by tests lives behind `@trade/broker/testing`; the application imports real brokers only and has no mock provider to fall back to.
- `packages/database`: Drizzle schema and SQL migrations. Migration seeds `gold-scalping-v1`.
- `apps/web`: responsive dark terminal with signals, orders, positions, trades, risk, broker, strategies, and audit views.

`AUTO_TRADING_ENABLED=false` registers but rejects signals. `EMERGENCY_STOP=true` blocks new orders. It does not close positions. `EMERGENCY_CLOSE_POSITIONS` is reserved for a separate confirmed workflow and has no automatic action. Risk settings are stored in PostgreSQL after first initialization and are editable from the dashboard; the defaults seed only once. The default maximum lot is 0.01 and the default policy is one position per symbol. The provider is MetaTrader 5 and nothing else: contract specifications, account, positions and orders all come from the terminal.

`TRADING_MODE` is independent of that policy and guards the account itself. `paper` refuses to boot against a real-money terminal; `live` refuses to boot against a demo and additionally requires `MT5_LIVE_ACK` to equal the connected login, so neither mode can be reached by flipping one flag.

Before opening an order, the API asks the terminal to run `OrderCheck` with the sized lot and protective prices. Margin, projected equity, free margin and rejection codes come from MetaTrader; contract notional is never used as a substitute for margin. The configured margin usage limit still applies to the terminal's projection. Missing or invalid check data blocks submission. After updating the bridge, run `bun run mt5:install` and restart the `AurumBridge` service in MT5. `OrderCheck` validates without sending an order; a successful check does not guarantee that the subsequent execution will succeed.

The API boots even when the terminal is unreachable: it reports the broker as disconnected, keeps retrying every `MT5_RECONNECT_MS`, and starts serving the moment the AurumBridge service publishes a heartbeat. MetaTrader is the source of truth for account, positions and orders, so nothing is rehydrated from PostgreSQL. Run one API instance: the PostgreSQL lock serializes each account and symbol across processes.

The admin key is server-only and required for dashboard data and settings mutations. The dashboard proxies these requests and uses HTTP Basic authentication in production. Put the API behind HTTPS and restrict public access to the webhook and health endpoints. Never put broker credentials, the webhook secret, or the admin key in `NEXT_PUBLIC_` variables.

## Operational notes

Open P&L uses the authenticated `/api/open-pnl/stream` SSE endpoint, proxied through `/api/data/open-pnl/stream`. The API checks the terminal position snapshot every 10 ms and sends changed values without querying PostgreSQL. The bridge currently publishes snapshots approximately every 600 ms, so a 10 ms check interval does not guarantee a new market value every 10 ms.

The full dashboard still refreshes every 15 seconds and on signal/order events. The Open P&L stream updates only the aggregate Open P&L; account totals and position table rows use the full dashboard refresh. Stream requests keep the admin key on the server and require the configured dashboard login.

- `/health`, `/ready`, and `/metrics` expose health and counts. `/api/events/stream` streams signal and order events to the dashboard.
- Audit entries store category, request ID, IP, event, and safe metadata. Raw payloads in `trading_signals` exclude `secret`.
- If a market order times out, inspect `clientOrderId`, broker order ID, and current positions before manual retry. The API does not automatically repeat it.
- Docker daemon unavailable: start Docker Desktop, then rerun `docker compose up -d postgres`.
- PostgreSQL connection refused: check `DATABASE_URL` and container health; run `bun db:migrate`.
- No orders executing: check Auto Trading, Emergency Stop, strategy enabled state, stop loss, lot cap, and `/api/logs`.
- `MetaTrader: AutoTrading disabled by client (retcode 10027)`: enable Algo Trading and the service's trading permission in MT5. Dashboard Auto Trading and terminal Algo Trading are separate controls.
- `unknown op 'check_order'`: the running service is an older build. Run `bun run mt5:install`, then stop and start `AurumBridge` in the terminal.
- A signal marked `REJECTED` was not executed. Inspect its reason in `/api/logs`; terminal preflight results appear as `BROKER / order_checked` with source `MetaTrader.OrderCheck`. The bot's configured margin usage cap can still reject a terminal-approved check.
- Terminal running but the API says disconnected: the API waits for `aurum-heartbeat.json`, so the `AurumBridge` service must be started. Check `bun run mt5:doctor` first.
- Service responds to `ping` but every `rates` call times out: the service answered with a payload the bot could not parse. The client now says so directly (`wrote a reply that is not valid JSON`) instead of reporting a timeout against a healthy-looking terminal.

## Pepperstone / MT5

How a real MetaTrader 5 terminal is driven from a Bun/TypeScript app.

### Why a bridge runs inside the terminal

The official `MetaTrader5` Python package is Windows-only, and the macOS build of
MT5 runs under a bundled Wine prefix, so it cannot be driven from Bun directly.
Instead an MQL5 Service runs inside the terminal and owns every MT5 call
(`OrderSend`, `SymbolInfoDouble`, `PositionsGet`); the Bun adapter only exchanges
files with it. MQL5 cannot host an HTTP server, cannot create directories, and
cannot list them, so the two halves exchange flat files in the terminal's common
folder (`Terminal\Common\Files`):

| Path                   | Direction      | Purpose                                         |
| ---------------------- | -------------- | ----------------------------------------------- |
| `aurum-heartbeat.json` | service -> bot | liveness, login, server, build, trade mode      |
| `aurum-account.json`   | service -> bot | balance, equity, margin                         |
| `aurum-symbols.json`   | service -> bot | `SymbolInfo` + `MarketPrice` per watched symbol |
| `aurum-positions.json` | service -> bot | open positions with ticket ids                  |
| `aurum-orders.json`    | service -> bot | working orders                                  |
| `aurum-cmd-<n>.json`   | bot -> service | one command per queue slot                      |
| `aurum-res-<n>.json`   | service -> bot | one reply per queue slot                        |

Reads are push-based and cost nothing; only order placement, closing and
modifying consume the queue. Sequence numbers are owned by the terminal: the
service refuses to replay anything at or below its high-water mark, so a command
is executed at most once even if the API dies mid-flight. The client resumes
above that mark rather than restarting the count, so a restarted API does not
deadlock against a service that kept running.

### Setup

1. `bun run mt5:install` compiles `AurumBridge.mq5` with the MetaEditor bundled
   in the MT5 app and deploys it to `MQL5/Services`.
2. In the terminal: log in, enable Algo Trading under Tools -> Options, then add
   `AurumBridge` from Navigator -> Expert Advisors -> Services. It must be added
   as a **Service**; a chart attachment or a one-shot script run exits
   immediately and leaves a stale heartbeat.
3. Set the watched symbols and, for Docker, mount the terminal's common folder
   into the API container:

```bash
export MT5_HOST_BRIDGE_DIR="$HOME/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files"
docker compose -f docker-compose.yml -f docker-compose.mt5.yml up -d
```

`/health` reports the connected login and server. The API does not wait for the
terminal at boot: it starts, reports `broker: disconnected`, and lights up as soon
as the service publishes a heartbeat.

### Strategies in the bot

Signals normally arrive from a webhook, which assumes something else already
decided to trade. For a strategy that decides for itself, `STRATEGY_RUNNER` runs
it inside the API:

```bash
STRATEGY_RUNNER=meanrev-bb-rsi-v1   # off when unset
STRATEGY_TIMEFRAME=M30
STRATEGY_POLL_MS=5000
```

All nine MT5 timeframes are supported and verified against a live terminal: `M1`,
`M5`, `M15`, `M30`, `H1`, `H4`, `D1`, `W1`, `MN1`. `STRATEGY_TIMEFRAME` is
validated at boot, so a typo fails immediately with the accepted list instead of
reaching the service: an unrecognised value falls back to `PERIOD_CURRENT` there,
which would make the strategy evaluate against whatever timeframe a chart happened
to carry and look like it was working.

Note what a timeframe means for `history` (default 120 bars). The window is what
the indicators see, so 120 bars is 2 hours on M1, 61 hours on M30, and 120 months
on MN1. Lower timeframes evaluate more often on less history.

`meanrev-bb-rsi-v1` is the bot-side port of `MeanReversion_BB_RSI_MT5.mq5`: buy
when the last closed candle touches the lower Bollinger band with oversold RSI,
sell on the mirrored setup. Three things make it safe to run unattended:

- **Bars come from the terminal.** The runner reads OHLC through the service
  (`op: rates`) because the terminal owns the bars, and computes indicators
  host-side so there is one implementation of each under test. `StdDev` is the
  population deviation and `rsi` is Wilder's smoothing, matching MetaTrader
  exactly; the values would otherwise drift from the EA this replaces.
- **One decision per closed bar.** The runner acts on the bar at offset 1 and
  never on the forming one, and primes on its first tick so a restart cannot
  replay the bar it already traded.
- **The risk engine still has the last word.** The runner emits an ordinary
  `TradingSignal`, so lot sizing, spread checks, daily loss caps and the audit
  trail apply unchanged. `GET /api/strategy` reports what the runner is doing.

#### Choosing a timeframe at runtime

`PATCH /api/strategy` changes the timeframe without a restart:

```bash
curl -X PATCH localhost:3001/api/strategy -H "x-admin-key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' -d '{"timeframe":"H1"}'
```

An unrecognised value is refused with the accepted list. Changing it clears the
per-symbol last-bar map: those values are timestamps belonging to the old
timeframe, so keeping them would compare a new M5 bar against an old M30 one and
stall the symbol until the clock produced that exact timestamp again. The first
pass after a switch re-primes instead of acting, exactly as a restart does, and
signal ids carry the active timeframe so a switch cannot replay a bar.

The dashboard exposes the same control on `/signals`, `/positions` and `/orders`,
where `GET /api/strategy` returns per-pair state: last bar, RSI, how far the pair
is from the RSI extreme and from the band, and a countdown to the next bar. This
exists because the signals table alone cannot distinguish a quiet strategy from
a broken one — a mean-reversion setup that needs a band touch and an RSI extreme
is absent from most bars of most hours, so an empty table is the normal state.

Two requirements are easy to miss and fail late, so the runner refuses to start
without them: the strategy must exist in `strategies`, and every symbol must be in
`risk_settings.allowedSymbols`. Broker symbols carry suffixes, so allowlist the
real one:

```bash
curl -X PATCH localhost:3001/api/settings -H "x-admin-key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' -d '{"allowedSymbols":["XAUUSD.a"]}'
```

#### Watching several symbols

`MT5_SYMBOLS` is the watch list: the service publishes quotes for every symbol in
it and the runner evaluates each one. `MT5_PRIMARY_SYMBOL` is only the symbol the
dashboard leads with, and is always included in the list.

```bash
MT5_SYMBOLS=XAUUSD,EURUSD,GBPUSD,USDJPY,USDCHF,USDCAD,AUDUSD,NZDUSD,USDCNH,USDSEK
```

The strategy row carries its own allowlist that the risk manager checks per
signal, so the runner widens it to match on boot; a symbol missing from
`risk_settings.allowedSymbols` is a boot-time refusal, not a silent no-op.

Symbols are independent. Each keeps its own last acted bar, so one symbol's tick
never advances another's, and a symbol whose bars fail to arrive does not stop the
rest from being evaluated. The reported status is the most consequential outcome of
the pass, with one deliberate exception: `BLOCKED` outranks `SIGNAL`, so the
dashboard cannot show a healthy run while a symbol it claims to watch is
unreachable. Repeated identical failures are audited once per symbol rather than
once per poll.

Use `op: find_symbols` (or the doctor's suggestion line) rather than guessing a
name. This command lists selected Market Watch symbols, not the entire broker
catalogue. The locally verified watch list contains nine Forex pairs plus
`XAUUSD`; other instruments may need to be selected in MT5 first. Updating
`MT5_SYMBOLS` does not change the persisted Allowed symbols setting: add the
same symbols under Risk in the dashboard before restarting the runner.

The runner needs a live terminal: it pulls real bars with `op: rates` and stays
`BLOCKED` with `broker disconnected` until the AurumBridge service is running, so
nothing is ever evaluated against synthetic data.

### Diagnostics

`bun run mt5:doctor` checks the whole chain without sending an order: it
resolves the bridge directory, reads the descriptor and heartbeat, verifies the
connected login against `MT5_LIVE_ACK`, confirms every symbol in `MT5_SYMBOLS` is
in the service watch list, and round-trips a single ping through the command
queue. Every failure prints the fix, and a symbol the account does not carry comes
back as a concrete suggestion rather than a guess:

```
FAIL  trade allowed  order sending will be rejected
      account holder Bruno Ferreira Pedraca (USD, demo)
FAIL  watch list     not watched: EURUSD
      did you mean: EURUSD
      - trade allowed: Tools > Options > Expert Advisors > uncheck "Disable automated trading"
```

A clean run prints `bridge is ready` and exits 0.

#### The four bridge bugs worth knowing

Each of these presented as "the strategy never fires", and none was visible from
the API side. They are recorded because the symptom was identical every time:

- **The service compiled as a Script.** `#property service` was missing, so it ran
  once per Start and exited, leaving a stale heartbeat that looked alive.
- **The service exited on its own.** MQL5 delivers only `OnStart` to a service —
  no `OnTimer`, no `OnTick`, no `OnStop` — so returning from `OnStart` ends it. The
  loop has to live inside `OnStart`.
- **The watch list was silently empty.** `{"op":"symbols","symbols":"XAUUSD"}`
  contains `"symbols"` twice; the JSON reader matched the value of `op` instead of
  the key and returned an empty string, so the service watched nothing and answered
  `{"ok":true,"data":{"watching":0}}`. A key match only counts when a colon
  follows it.
- **`rates` replied with invalid JSON.** The MQL5 `Esc()` helper already adds the
  surrounding quotes, and the reply added a second pair, producing
  `{"symbol":""EURUSD""}`. The client's `JSON.parse` failed and it retried until
  the timeout, so a service answering in 200 ms looked like a dead terminal.

The last one is why the client now reports an unparseable reply instead of
timing out. When a command is slow, check whether the service is answering at all
before assuming it is stuck.

### Idempotency and safety

`clientOrderId` can be up to 300 characters but an MT5 order comment holds 31,
so the adapter sends `sha256(clientOrderId)` truncated to 24 characters and
caches the terminal's answer per `clientOrderId`. A repeated signal for the same
id returns the original fill instead of opening a second position, which is the
contract `packages/trading` already relies on.

Broker rejections come back as `status: 'REJECTED'` with a reason rather than as
an exception, so an invalid lot step or a stop inside the broker's stop level is
recorded as a business outcome instead of a failed signal.

Lot size and tick value come from the broker. The terminal's `OrderCheck`
supplies projected margin, equity, free margin, rejection code and comment;
the API does not estimate margin using contract notional or `marginRate`.
`defaultStopLoss` uses the recent 20-bar M30 range and falls back to `0`.
Spread, slippage and stop distances retain the symbol's price precision,
preventing Forex limits from being rounded to zero.

`MT5_MAGIC` tags every order the bot sends so it can tell its own positions from
a manual trade in the same account.

### Verified demo execution

On 2026-10-09, a test signal completed the signal -> risk validation ->
MetaTrader OrderCheck -> OrderSend -> position confirmation flow on a demo
account. The confirmed position was BUY XAUUSD, 0.01 lot, ticket `400591320`,
entry `4189.25`, stop loss `4164.10`, and take profit `4239.10`. These are
historical test results, not the current position state. Closing and persisting
that trade was not verified in this session.

The current checks passed: `bun typecheck`, `bun lint`, 107 tests from
`bun test`, and bridge compilation with zero errors and zero warnings.
The Open P&L stream was also verified through the authenticated dashboard
proxy (HTTP 200), with unauthenticated direct API requests refused (HTTP 403).

### Known gaps

**Bar timestamps and countdown use broker server time.** `CopyRates` timestamps
are not normalised to UTC. On the demo verified on 2026-10-09, displayed bars
were approximately three hours ahead of the host clock and the M1 countdown
showed roughly 10,800 seconds. The runner still compares successive bar
identifiers, but the displayed time and countdown need timezone correction.

**Closed-trade profit may still be estimated.** `persistClose` uses terminal
profit when supplied; otherwise it estimates with the symbol tick size and tick
value. The estimate does not account for commission or swap. It no longer uses
a hardcoded XAUUSD contract size.

**Position ticket visibility is incomplete.** API position IDs are MT5 tickets,
and orders show broker IDs, but the position table does not render the ticket
and closed trades have no dedicated broker-ticket column.

**Open P&L source cadence remains approximately 600 ms.** The API checks every
10 ms, but the file bridge determines when fresh values become available.
Only aggregate Open P&L uses this fast stream; other dashboard values keep
their normal refresh cadence.

Stops below the configured or broker minimum are widened to that floor by the
risk manager, rather than rejected solely for being below it. Stops exceeding
the configured maximum remain rejected. Forex spread limits now retain symbol
precision, and margin validation uses terminal OrderCheck results.

### Still out of scope

No limit or stop-entry orders (the adapter is market-only), no trailing stops,
and no partial-fill reconciliation beyond the returned position ticket. Run
against a demo account first: `TRADING_MODE=paper` and `AUTO_TRADING_ENABLED=false`
register and record signals without sending any.
