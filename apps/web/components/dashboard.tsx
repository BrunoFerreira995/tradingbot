'use client';
import { Radio, ShieldAlert, Wifi } from 'lucide-react';
import { useDashboard } from '../hooks/use-dashboard';
import { date, money, num, type DashboardData } from '../lib/api';
function Badge({
  active,
  label,
  danger = false,
}: {
  active: boolean;
  label: string;
  danger?: boolean;
}) {
  return (
    <span className={`pill ${active ? (danger ? 'red' : 'green') : 'muted'}`}>
      {label}
    </span>
  );
}
function Header({
  title,
  subtitle,
  data,
}: {
  title: string;
  subtitle: string;
  data: DashboardData;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-1 text-xs font-bold uppercase tracking-[.24em] text-amber-400">
          Aurum Terminal / MetaTrader 5
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="muted mt-2 text-sm">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          active={data.brokerConnected}
          label={data.brokerConnected ? 'CONNECTED' : 'DISCONNECTED'}
        />
        <span className={`pill ${data.mode === 'live' ? 'red' : 'amber'}`}>
          {data.mode === 'live' ? 'LIVE' : 'PAPER'}
        </span>
        <Badge
          active={data.settings.autoTradingEnabled}
          label={data.settings.autoTradingEnabled ? 'AUTO ON' : 'AUTO OFF'}
        />
        {data.settings.emergencyStop && (
          <Badge active danger label="EMERGENCY STOP" />
        )}
      </div>
    </div>
  );
}
const fields: Record<string, Array<[string, string]>> = {
  signals: [
    ['receivedAt', 'Time'],
    ['strategy', 'Strategy'],
    ['signalId', 'Signal ID'],
    ['symbol', 'Symbol'],
    ['action', 'Action'],
    ['lots', 'Lot'],
    ['stopLoss', 'SL'],
    ['takeProfit', 'TP'],
    ['status', 'Status'],
    ['totalExecutionMs', 'Execution ms'],
  ],
  orders: [
    ['id', 'Order ID'],
    ['brokerOrderId', 'Broker Order ID'],
    ['symbol', 'Symbol'],
    ['side', 'Side'],
    ['type', 'Type'],
    ['lots', 'Lots'],
    ['requestedPrice', 'Requested'],
    ['executedPrice', 'Executed'],
    ['slippage', 'Slippage'],
    ['stopLoss', 'SL'],
    ['takeProfit', 'TP'],
    ['status', 'Status'],
    ['latencyMs', 'Latency ms'],
    ['createdAt', 'Created'],
  ],
  positions: [
    ['symbol', 'Symbol'],
    ['side', 'Side'],
    ['lots', 'Lots'],
    ['entryPrice', 'Entry'],
    ['currentPrice', 'Current'],
    ['unrealizedPnl', 'Open P&L'],
    ['stopLoss', 'SL'],
    ['takeProfit', 'TP'],
    ['openedAt', 'Opened'],
  ],
  trades: [
    ['closedAt', 'Closed'],
    ['symbol', 'Symbol'],
    ['side', 'Side'],
    ['lots', 'Lots'],
    ['entryPrice', 'Entry'],
    ['exitPrice', 'Exit'],
    ['pnl', 'P&L'],
  ],
  strategies: [
    ['name', 'Strategy'],
    ['enabled', 'Enabled'],
    ['allowedSymbols', 'Symbols'],
    ['maxLot', 'Max lot'],
    ['riskPercentage', 'Risk %'],
    ['maxDailyTrades', 'Daily trades'],
    ['maxDailyLoss', 'Daily loss'],
  ],
};
function Table({
  rows,
  columns,
  empty = 'No records yet.',
}: {
  rows: Array<Record<string, unknown>>;
  columns: Array<[string, string]>;
  empty?: string;
}) {
  return (
    <div className="panel table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map(([key, label]) => (
              <th key={key}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, i) => (
              <tr key={String(row.id ?? i)}>
                {columns.map(([key]) => (
                  <td
                    key={key}
                    className={
                      key === 'pnl' || key === 'unrealizedPnl'
                        ? Number(row[key]) >= 0
                          ? 'green'
                          : 'red'
                        : ''
                    }
                  >
                    {key.endsWith('At') && row[key]
                      ? date(row[key])
                      : typeof row[key] === 'boolean'
                        ? row[key]
                          ? 'Yes'
                          : 'No'
                        : Array.isArray(row[key])
                          ? row[key].join(', ')
                          : String(row[key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="muted py-10 text-center">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="panel p-5">
      <div className="muted mb-3 text-xs uppercase tracking-widest">
        {label}
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      {hint && <div className="muted mt-2 text-xs">{hint}</div>}
    </div>
  );
}
function Overview({ data }: { data: DashboardData }) {
  const p = data.positions.find((x) => x.symbol === data.symbol);
  const latest = data.signals[0];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Account Balance"
          value={money(data.account.balance)}
          hint={data.mode === 'live' ? 'Real-money account' : 'Paper account'}
        />
        <Stat
          label="Account Equity"
          value={money(data.account.equity)}
          hint="Including open P&L"
        />
        <Stat
          label="Free Margin"
          value={money(data.account.freeMargin)}
          hint={`Margin level ${num(data.account.marginLevel)}%`}
        />
        <Stat
          label="Daily P&L"
          value={money(data.stats.dailyPnl)}
          hint="UTC trading day"
        />
        <Stat label="Open P&L" value={money(data.stats.openPnl)} />
        <Stat label="Open Positions" value={String(data.positions.length)} />
        <Stat label="Trades Today" value={String(data.stats.tradesToday)} />
        <Stat
          label="Win Rate"
          value={`${num(data.stats.winRate)}%`}
          hint={`${data.stats.winningTrades} wins · ${data.stats.losingTrades} losses`}
        />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold tracking-widest text-amber-400">
                GOLD / US DOLLAR
              </div>
              <h2 className="mt-1 text-2xl font-bold">{data.symbol}</h2>
            </div>
            <span
              className={`pill ${data.brokerConnected ? 'green' : 'muted'}`}
            >
              {data.brokerConnected ? 'LIVE QUOTE' : 'NO DATA'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 border-b border-slate-800 pb-6">
            <div>
              <div className="muted text-xs">BID</div>
              <div className="mt-1 text-3xl font-bold">
                {data.price ? num(data.price.bid, 3) : '—'}
              </div>
            </div>
            <div>
              <div className="muted text-xs">ASK</div>
              <div className="mt-1 text-3xl font-bold">
                {data.price ? num(data.price.ask, 3) : '—'}
              </div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-5 text-sm sm:grid-cols-4">
            <div>
              <span className="muted">Spread</span>
              <div className="mt-1 font-semibold">
                {data.price ? num(data.price.spread, 3) : '—'}
              </div>
            </div>
            <div>
              <span className="muted">Position</span>
              <div className="mt-1 font-semibold">
                {p ? `${p.side} ${p.lots} lot` : 'Flat'}
              </div>
            </div>
            <div>
              <span className="muted">Entry</span>
              <div className="mt-1 font-semibold">
                {p ? num(p.entryPrice, 3) : '—'}
              </div>
            </div>
            <div>
              <span className="muted">Current P&L</span>
              <div
                className={`mt-1 font-semibold ${(p?.unrealizedPnl ?? 0) >= 0 ? 'green' : 'red'}`}
              >
                {p ? money(p.unrealizedPnl) : '—'}
              </div>
            </div>
            <div>
              <span className="muted">Stop loss</span>
              <div className="mt-1 font-semibold">{p?.stopLoss ?? '—'}</div>
            </div>
            <div>
              <span className="muted">Take profit</span>
              <div className="mt-1 font-semibold">{p?.takeProfit ?? '—'}</div>
            </div>
          </div>
        </div>
        <div className="panel p-6">
          <div className="mb-6 flex items-center gap-2 text-lg font-semibold">
            <Radio size={17} className="text-amber-400" /> Latest TradingView
            signal
          </div>
          {latest ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-2xl font-bold">
                  {String(latest.action)} {String(latest.symbol)}
                </span>
                <span className="pill amber">{String(latest.status)}</span>
              </div>
              <p className="muted text-sm">
                {String(latest.strategy)} · {String(latest.signalId)}
              </p>
              <div className="muted mt-6 text-xs">
                Received {date(latest.receivedAt)}
              </div>
              <div className="muted mt-2 text-xs">
                Processing {String(latest.totalExecutionMs ?? '—')} ms · Risk{' '}
                {String(latest.riskProcessingMs ?? '—')} ms
              </div>
            </>
          ) : (
            <p className="muted text-sm">Waiting for the first alert.</p>
          )}
          <div className="mt-8 border-t border-slate-800 pt-5 text-sm">
            <div className="mb-3 flex justify-between">
              <span className="muted">Broker connection</span>
              <span className="green flex items-center gap-1">
                <Wifi size={14} /> Connected
              </span>
            </div>
            <div className="flex justify-between">
              <span className="muted">Auto trading</span>
              <span
                className={data.settings.autoTradingEnabled ? 'green' : 'amber'}
              >
                {data.settings.autoTradingEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6">
        <h2 className="mb-4 text-lg font-semibold">Recent signals</h2>
        <Table
          rows={data.signals.slice(0, 5)}
          columns={fields.signals!.slice(0, 7)}
        />
      </div>
    </>
  );
}
function Risk({ data }: { data: DashboardData }) {
  const s = data.settings;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="panel p-6">
        <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert className="text-amber-400" size={20} /> Execution
          controls
        </div>
        <p className="muted mb-6 text-sm">
          Changes require the server side admin API key. Emergency stop blocks
          new orders immediately and does not close existing positions.
        </p>
        <Control
          name="Auto trading"
          value={s.autoTradingEnabled}
          field="autoTradingEnabled"
        />
        <Control
          name="Emergency stop"
          value={s.emergencyStop}
          field="emergencyStop"
          danger
        />
      </div>
      <div className="panel p-6">
        <h2 className="mb-5 text-lg font-semibold">Risk limits</h2>
        {[
          ['Maximum lot', s.maximumLotSize],
          ['Maximum open positions', s.maximumOpenPositions],
          ['Maximum daily loss', money(s.maximumDailyLoss)],
          ['Maximum daily trades', s.maximumDailyTrades],
          ['Position policy', s.positionPolicy],
          ['Allowed symbols', s.allowedSymbols.join(', ')],
          ['Stop loss required', s.requireStopLoss ? 'Yes' : 'No'],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="flex justify-between gap-4 border-b border-slate-800 py-3 text-sm"
          >
            <span className="muted">{label}</span>
            <span className="text-right font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function Control({
  name,
  value,
  field,
  danger = false,
}: {
  name: string;
  value: boolean;
  field: 'autoTradingEnabled' | 'emergencyStop';
  danger?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const change = async () => {
    if (
      danger &&
      !value &&
      !window.confirm(
        'Ativar EMERGENCY STOP? Novas ordens serão bloqueadas imediatamente. Posições abertas permanecerão abertas.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: !value }),
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-slate-700 p-4">
      <div>
        <div className="font-semibold">{name}</div>
        <div
          className={`mt-1 text-xs ${value ? (danger ? 'red' : 'green') : 'muted'}`}
        >
          {value ? 'Enabled' : 'Disabled'}
        </div>
        {error && <div className="red mt-2 text-xs">{error}</div>}
      </div>
      <button
        disabled={busy}
        onClick={change}
        className={`button ${danger && !value ? '!border-red-500 !bg-red-600 !text-white' : ''}`}
      >
        {busy
          ? 'Saving...'
          : danger && !value
            ? 'EMERGENCY STOP'
            : value
              ? 'Disable'
              : 'Enable'}
      </button>
    </div>
  );
}
import React from 'react';
import { useStrategy } from '../hooks/use-strategy';
import type { SymbolState } from '../lib/api';

/** `m:ss`, so a 25-minute wait does not read as 1500. */
function countdown(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return 'closing';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const STATUS_TONE: Record<string, string> = {
  SIGNAL: 'green',
  NO_SETUP: 'amber',
  WAITING_BAR: 'muted',
  BLOCKED: 'red',
  IDLE: 'muted',
  DISABLED: 'muted',
};

/**
 * Live per-pair state from the strategy runner.
 *
 * This is the part the signals table cannot show. The table lists signals that
 * were *acted on*, which for a mean-reversion strategy waiting on a band touch
 * and an RSI extreme is most bars of most hours — so an empty table looks
 * identical to a broken bot. Here every watched pair reports its indicator
 * reading and how far it still is from firing.
 */
function StrategyPanel() {
  const { state, error, saving, setTimeframe } = useStrategy();
  if (!state)
    return (
      <div className="panel p-6">
        <div className="muted">{error || 'Reading strategy state...'}</div>
      </div>
    );

  const pairs = (state.symbols ?? []).map(
    (symbol) => [symbol, state.symbolStates?.[symbol]] as const,
  );

  return (
    <div className="panel p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-lg font-bold">Strategy runner</div>
          <div className="muted mt-1 text-xs">
            {state.strategy ?? 'no strategy'} · evaluates once per closed bar on{' '}
            {pairs.length} pair{pairs.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`pill ${STATUS_TONE[state.status] ?? 'muted'}`}>
            {state.status}
          </span>
          <label className="muted text-xs" htmlFor="timeframe">
            Timeframe
          </label>
          <select
            id="timeframe"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            value={state.timeframe}
            disabled={saving || state.status === 'DISABLED'}
            onChange={(event) => void setTimeframe(event.target.value)}
          >
            {(state.timeframes?.length ? state.timeframes : ['M30']).map(
              (timeframe) => (
                <option key={timeframe} value={timeframe}>
                  {timeframe}
                </option>
              ),
            )}
          </select>
        </div>
      </div>

      {state.status === 'DISABLED' ? (
        <div className="muted text-sm">
          The strategy runner is not enabled. Set <code>STRATEGY_RUNNER</code>{' '}
          on the API to turn it on.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Status</th>
                <th>RSI</th>
                <th>To RSI trigger</th>
                <th>To band</th>
                <th>Close</th>
                <th>Next bar</th>
                <th>Last bar</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map(([symbol, entry]) => (
                <PairRow key={symbol} symbol={symbol} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <div className="mt-4 text-xs text-red-400">Last error: {error}</div>
      )}
    </div>
  );
}

function PairRow({
  symbol,
  entry,
}: {
  symbol: string;
  entry: SymbolState | undefined;
}) {
  if (!entry)
    return (
      <tr>
        <td className="font-semibold">{symbol}</td>
        <td colSpan={7} className="muted">
          not evaluated yet
        </td>
      </tr>
    );
  // A negative RSI distance means the extreme is already met and only the band
  // is outstanding, which is the near-miss case worth showing as such.
  const rsiMet = (entry.rsiToTrigger ?? 0) <= 0;
  const bandMet = (entry.bandToTrigger ?? 1) <= 0;
  return (
    <tr>
      <td className="font-semibold">{symbol}</td>
      <td>
        <span className={`pill ${STATUS_TONE[entry.status] ?? 'muted'}`}>
          {entry.side ? `${entry.side} ` : ''}
          {entry.status}
        </span>
      </td>
      <td>{num(entry.rsi, 1)}</td>
      <td className={rsiMet ? 'green' : ''}>
        {rsiMet ? 'met' : `${num(entry.rsiToTrigger, 1)} pts`}
      </td>
      <td className={bandMet ? 'green' : ''}>
        {bandMet
          ? 'touched'
          : `${((entry.bandToTrigger ?? 0) * 100).toFixed(1)}% of band`}
      </td>
      <td>{entry.close ? num(entry.close, entry.close > 100 ? 2 : 5) : '—'}</td>
      <td className="muted">{countdown(entry.secondsToNextBar)}</td>
      <td className="muted">{date(entry.lastBarAt)}</td>
    </tr>
  );
}

export function Dashboard({ section }: { section: string }) {
  const { data, error } = useDashboard();
  if (!data)
    return (
      <div className="panel p-8">
        {error
          ? `API unavailable: ${error}`
          : 'Connecting to trading engine...'}
      </div>
    );
  const title =
    section === 'dashboard'
      ? 'Trading overview'
      : section[0]!.toUpperCase() + section.slice(1);
  return (
    <>
      <Header
        title={title}
        subtitle={
          section === 'dashboard'
            ? 'Your paper trading operation at a glance.'
            : `Monitor ${section} and execution status.`
        }
        data={data}
      />
      {section === 'dashboard' ? (
        <Overview data={data} />
      ) : section === 'risk' || section === 'settings' ? (
        <Risk data={data} />
      ) : section === 'broker' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat
            label="Provider"
            value="MetaTrader 5"
            hint={
              data.brokerConnected
                ? `Terminal bridge on ${data.symbol}`
                : 'Terminal bridge offline'
            }
          />
          <Stat
            label="Mode"
            value={data.mode === 'live' ? 'Live' : 'Paper'}
            hint={
              data.mode === 'live'
                ? 'Real-money account'
                : 'Demo account, real market data'
            }
          />
          <Stat
            label="Connection"
            value={data.brokerConnected ? 'Connected' : 'Disconnected'}
          />
          <Stat label="Account" value={data.account.id} />
          <Stat label="Balance" value={money(data.account.balance)} />
          <Stat label="Equity" value={money(data.account.equity)} />
        </div>
      ) : section === 'logs' ? (
        <Logs />
      ) : (
        <div className="space-y-5">
          {/* The runner's live state sits above every section it explains: on
              /signals it is the answer to an empty table, and on /positions and
              /orders it is the context for why a position opened or did not. */}
          {(section === 'signals' ||
            section === 'positions' ||
            section === 'orders') && <StrategyPanel />}
          <Table
            rows={
              (data[section as keyof DashboardData] as Array<
                Record<string, unknown>
              >) ?? []
            }
            columns={fields[section] ?? []}
            empty={
              section === 'signals'
                ? 'No signals yet. The runner records a signal only when a bar closes on a band touch with RSI at an extreme, so this stays empty until a pair qualifies.'
                : section === 'positions'
                  ? 'No open positions. The runner has not opened any, or they have all been closed.'
                  : 'No records yet.'
            }
          />
        </div>
      )}
    </>
  );
}
function Logs() {
  const [rows, setRows] = React.useState<Array<Record<string, unknown>>>([]);
  React.useEffect(() => {
    void fetch('/api/data/logs')
      .then((r) => r.json())
      .then(setRows);
  }, []);
  return (
    <Table
      rows={rows}
      columns={[
        ['createdAt', 'Time'],
        ['category', 'Category'],
        ['event', 'Event'],
        ['requestId', 'Request ID'],
        ['ip', 'IP'],
        ['details', 'Details'],
      ]}
    />
  );
}
