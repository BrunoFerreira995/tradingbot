'use client';
import { Radio, ShieldAlert, Wifi } from 'lucide-react';
import { useDashboard } from '../hooks/use-dashboard';
import { PerformancePanel } from './performance-panel';
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
    ['reason', 'Reason'],
    ['reasonSource', 'Source'],
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
    ['id', 'MT5 Ticket'],
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
          value={money(data.account.balance, data.account.currency)}
          hint={data.mode === 'live' ? 'Real-money account' : 'Paper account'}
        />
        <Stat
          label="Account Equity"
          value={money(data.account.equity, data.account.currency)}
          hint="Including open P&L"
        />
        <Stat
          label="Free Margin"
          value={money(data.account.freeMargin, data.account.currency)}
          hint={`Margin level ${num(data.account.marginLevel)}%`}
        />
        <Stat
          label="Daily P&L"
          value={money(data.stats.dailyPnl, data.account.currency)}
          hint={
            data.performance?.historyAvailable
              ? data.performance.timezone
              : 'UTC · histórico salvo'
          }
        />
        <Stat
          label="Open P&L"
          value={money(data.stats.openPnl, data.account.currency)}
        />
        <Stat label="Open Positions" value={String(data.positions.length)} />
        <Stat label="Trades Today" value={String(data.stats.tradesToday)} />
        <WinRate data={data} />
      </div>
      <PerformancePanel data={data} />
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
                {p ? money(p.unrealizedPnl, data.account.currency) : '—'}
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
              {typeof latest.reason === 'string' && (
                <p className="mt-3 text-sm text-amber-300">
                  {latest.reason}
                  <span className="muted ml-2">
                    ({String(latest.reasonSource ?? 'risk')})
                  </span>
                </p>
              )}
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
          ['Maximum non-reserved positions', s.maximumOpenPositions],
          [
            'Reserved positions (1 each)',
            s.reservedPositionSymbols?.join(', ') || 'None',
          ],
          [
            'Maximum daily loss',
            money(s.maximumDailyLoss, data.account.currency),
          ],
          ['Position policy', s.positionPolicy],
          [
            'Close on opposite signal',
            s.closeOnOppositeSignal ? 'Enabled' : 'Disabled',
          ],
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
        <DailyTradeLimitControl
          limit={s.maximumDailyTrades}
          tradesToday={data.stats.tradesToday}
        />
        <AllowedSymbolsControl
          symbols={s.allowedSymbols}
          availableSymbols={data.symbols ?? []}
        />
      </div>
    </div>
  );
}
function DailyTradeLimitControl({
  limit,
  tradesToday,
}: {
  limit: number;
  tradesToday: number;
}) {
  const [draft, setDraft] = React.useState(String(limit));
  const [savedLimit, setSavedLimit] = React.useState(limit);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState(false);
  const previousLimit = React.useRef(limit);
  React.useEffect(() => {
    const previous = previousLimit.current;
    setDraft((current) =>
      current === String(previous) ? String(limit) : current,
    );
    setSavedLimit(limit);
    previousLimit.current = limit;
  }, [limit]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const maximumDailyTrades = Number(draft);
    if (
      !draft.trim() ||
      !Number.isInteger(maximumDailyTrades) ||
      maximumDailyTrades < 0 ||
      maximumDailyTrades > 2147483647
    ) {
      setError('Informe um número inteiro entre 0 e 2147483647.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess(false);
    try {
      const response = await fetch('/api/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maximumDailyTrades }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? `Request failed: ${response.status}`);
      setSavedLimit(result.maximumDailyTrades);
      setDraft(String(result.maximumDailyTrades));
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="mt-5">
      <label htmlFor="daily-trade-limit" className="text-sm font-semibold">
        Maximum daily trades
      </label>
      <p id="daily-trade-limit-help" className="muted my-2 text-xs">
        Operações hoje: {tradesToday} / {savedLimit}. Para liberar novas
        operações, salve um limite maior que a quantidade já realizada. Zero
        bloqueia novas operações.
      </p>
      <div className="flex gap-2">
        <input
          id="daily-trade-limit"
          aria-describedby="daily-trade-limit-help"
          type="number"
          min={0}
          max={2147483647}
          step={1}
          required
          value={draft}
          disabled={busy}
          onChange={(event) => {
            setDraft(event.target.value);
            setSuccess(false);
          }}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
        />
        <button type="submit" disabled={busy} className="btn">
          {busy ? 'Salvando…' : 'Salvar limite'}
        </button>
      </div>
      {error && (
        <p role="alert" className="red mt-2 text-xs">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="green mt-2 text-xs">
          Limite diário salvo.
        </p>
      )}
    </form>
  );
}
function AllowedSymbolsControl({
  symbols,
  availableSymbols,
}: {
  symbols: string[];
  availableSymbols: string[];
}) {
  const [selected, setSelected] = React.useState(symbols);
  const [extraSymbols, setExtraSymbols] = React.useState<string[]>([]);
  const [newSymbol, setNewSymbol] = React.useState('');
  const [gasolineSymbol, setGasolineSymbol] = React.useState('Gasoline');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState(false);
  const saved = JSON.stringify(symbols);
  React.useEffect(() => {
    setSelected(JSON.parse(saved) as string[]);
  }, [saved]);
  const options = [
    ...new Set(
      [...availableSymbols, ...symbols, ...extraSymbols, gasolineSymbol].filter(
        Boolean,
      ),
    ),
  ];
  const toggle = async (symbol: string) => {
    const allowedSymbols = selected.includes(symbol)
      ? selected.filter((item) => item !== symbol)
      : [...selected, symbol];
    if (allowedSymbols.length > 50) {
      setError('Use no máximo 50 símbolos.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess(false);
    try {
      const response = await fetch('/api/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedSymbols }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? `Request failed: ${response.status}`);
      setExtraSymbols((current) => [...new Set([...current, ...selected])]);
      setSelected(result.allowedSymbols as string[]);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold">Allowed symbols</h3>
      <p className="muted my-2 text-xs">
        Cada toggle salva imediatamente. Desativar todos bloqueia novos sinais
        de todos os símbolos.
      </p>
      <label className="mb-3 block text-xs">
        Gasolina · Commodity — código no MT5
        <input
          value={gasolineSymbol}
          placeholder="Código da gasolina na sua corretora"
          disabled={busy || selected.includes(gasolineSymbol)}
          onChange={(event) => setGasolineSymbol(event.target.value.trim())}
          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
        />
        <span className="muted mt-1 block">
          Informe o código exato exibido na Observação do Mercado do MT5. O
          ticker informado é gasoline, em minúsculas.
        </span>
      </label>
      <div className="space-y-2">
        {options.map((symbol) => {
          const enabled = selected.includes(symbol);
          return (
            <div
              key={symbol}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 p-3"
            >
              <div>
                <span className="text-sm font-semibold">
                  {symbol === gasolineSymbol ? 'Gasolina · Commodity' : symbol}
                </span>
                {symbol === gasolineSymbol && (
                  <div className="muted text-xs">{symbol}</div>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`Permitir ${symbol}`}
                disabled={busy}
                onClick={() => void toggle(symbol)}
                className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
              >
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${enabled ? 'left-6' : 'left-1'}`}
                />
              </button>
            </div>
          );
        })}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const added = newSymbol.trim();
          if (!added) return;
          setExtraSymbols((current) => [...new Set([...current, added])]);
          setNewSymbol('');
        }}
        className="mt-3 flex gap-2"
      >
        <input
          aria-label="Novo símbolo MT5"
          placeholder="Código exato do MT5"
          value={newSymbol}
          disabled={busy}
          onChange={(event) => setNewSymbol(event.target.value)}
          pattern="[^,;\\s]+"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !newSymbol.trim()}
          className="btn"
        >
          Adicionar
        </button>
      </form>
      {error && (
        <p role="alert" className="red mt-2 text-xs">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="green mt-2 text-xs">
          Símbolos salvos.
        </p>
      )}
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
  if (seconds === null) return '—';
  if (seconds <= 0) return 'closing';
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

      {state.detail && (
        <p
          role="status"
          className={`mb-4 text-sm ${state.status === 'BLOCKED' ? 'red' : 'muted'}`}
        >
          {state.detail}
        </p>
      )}
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
  const rsiMet = entry.rsiToTrigger !== undefined && entry.rsiToTrigger <= 0;
  const bandMet = (entry.bandToTrigger ?? 1) <= 0;
  return (
    <tr>
      <td className="font-semibold">{symbol}</td>
      <td>
        <span className={`pill ${STATUS_TONE[entry.status] ?? 'muted'}`}>
          {entry.side ? `${entry.side} ` : ''}
          {entry.status}
        </span>
        {entry.status === 'BLOCKED' && entry.detail && (
          <div className="red mt-1 max-w-xs text-xs">{entry.detail}</div>
        )}
      </td>
      <td>{entry.rsi === undefined ? '—' : num(entry.rsi, 1)}</td>
      <td className={rsiMet ? 'green' : ''}>
        {entry.rsiToTrigger === undefined
          ? '—'
          : rsiMet
            ? 'met'
            : `${num(entry.rsiToTrigger, 1)} pts`}
      </td>
      <td className={bandMet ? 'green' : ''}>
        {entry.bandToTrigger === undefined
          ? '—'
          : bandMet
            ? 'touched'
            : `${((entry.bandToTrigger ?? 0) * 100).toFixed(1)}% of band`}
      </td>
      <td>{entry.close ? num(entry.close, entry.close > 100 ? 2 : 5) : '—'}</td>
      <td className="muted">{countdown(entry.secondsToNextBar)}</td>
      <td className="muted">{date(entry.lastBarAt)}</td>
    </tr>
  );
}

type TradingTab = 'signals' | 'orders' | 'positions';

function WinRate({ data }: { data: DashboardData }) {
  const { winRate, winningTrades, losingTrades, closedTrades } = data.stats;
  return (
    <Stat
      label="Win Rate"
      value={winRate == null ? '—' : `${num(winRate)}%`}
      hint={
        winRate == null
          ? data.performance && !data.performance.historyAvailable
            ? 'Histórico MT5 indisponível · aguardando atualização da ponte'
            : 'Awaiting closed trades · Aguardando operações encerradas'
          : `${winningTrades} wins · ${losingTrades} losses · ${closedTrades} closed · ${data.performance?.historyAvailable ? (data.performance.historyComplete ? 'MT5' : 'MT5 · histórico parcial') : 'histórico salvo'}`
      }
    />
  );
}

function TradingPanel({
  data,
  initialTab,
}: {
  data: DashboardData;
  initialTab: TradingTab;
}) {
  const [tab, setTab] = React.useState<TradingTab>(initialTab);
  return (
    <div className="space-y-5">
      <WinRate data={data} />
      <StrategyPanel />
      <div role="tablist" aria-label="Trading" className="flex gap-2">
        {(['signals', 'orders', 'positions'] as const).map((item) => (
          <button
            key={item}
            id={`trading-tab-${item}`}
            role="tab"
            aria-selected={tab === item}
            aria-controls="trading-panel"
            onClick={() => setTab(item)}
            className={`rounded-lg px-4 py-2 text-sm ${tab === item ? 'bg-amber-400/10 text-amber-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
          >
            {item[0]!.toUpperCase() + item.slice(1)} ({data[item].length})
          </button>
        ))}
      </div>
      <div
        id="trading-panel"
        role="tabpanel"
        aria-labelledby={`trading-tab-${tab}`}
      >
        <Table
          rows={data[tab] as Array<Record<string, unknown>>}
          columns={fields[tab] ?? []}
          empty={
            tab === 'signals'
              ? 'No signals yet. Waiting for a qualifying signal.'
              : tab === 'positions'
                ? 'No open positions in MetaTrader 5.'
                : 'No orders yet.'
          }
        />
      </div>
    </div>
  );
}

export function Dashboard({ section }: { section: string }) {
  const { data, error } = useDashboard();
  const isTrading = ['trading', 'signals', 'orders', 'positions'].includes(
    section,
  );
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
      : isTrading
        ? 'Trading'
        : section[0]!.toUpperCase() + section.slice(1);
  return (
    <>
      <Header
        title={title}
        subtitle={
          section === 'dashboard'
            ? 'Your paper trading operation at a glance.'
            : isTrading
              ? 'Signals, orders and positions in one workspace.'
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
          <Stat
            label="Balance"
            value={money(data.account.balance, data.account.currency)}
          />
          <Stat
            label="Equity"
            value={money(data.account.equity, data.account.currency)}
          />
        </div>
      ) : section === 'logs' ? (
        <Logs />
      ) : isTrading ? (
        <TradingPanel
          key={section}
          data={data}
          initialTab={
            section === 'trading' ? 'positions' : (section as TradingTab)
          }
        />
      ) : section === 'trades' ? (
        <div className="space-y-6">
          <WinRate data={data} />
          <PerformancePanel data={data} />
          <section>
            <h2 className="mb-3 text-lg font-bold">
              Open trades ({data.positions.length})
            </h2>
            <Table
              rows={data.positions.map((position) => ({
                ...position,
                status: 'OPEN',
              }))}
              columns={[...fields.positions!, ['status', 'Status']]}
              empty="No open trades in MetaTrader 5."
            />
          </section>
          <section>
            <h2 className="mb-3 text-lg font-bold">Closed trades</h2>
            <Table
              rows={data.trades}
              columns={fields.trades!}
              empty="No closed trades yet. Active trades are listed above."
            />
          </section>
        </div>
      ) : (
        <div className="space-y-5">
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
