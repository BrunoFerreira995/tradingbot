'use client';
import { MarketSessionsControl } from './market-sessions-control';
import { CyclesPanel } from './cycles-panel';
import { Radio, ShieldAlert, Wifi } from 'lucide-react';
import { useDashboard } from '../hooks/use-dashboard';
import { MonetaryStopControl } from './monetary-stop-control';
import { ExportTrades } from './export-trades';
import { PerformancePanel } from './performance-panel';
import { TradeCharts } from './trade-charts';
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
          {data.mode === 'live' ? 'LIVE' : data.mode === 'paper' ? 'DEMO' : 'UNKNOWN'}
        </span>
        <Badge
          active={data.settings.autoTradingEnabled}
          label={data.settings.autoTradingEnabled ? 'AUTO ON' : 'AUTO OFF'}
        />
        {data.settings.invertIncomingSignals && (
          <span className="pill amber">SIGNALS INVERTED</span>
        )}
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
          hint={data.mode === 'live' ? 'Real-money account' : data.mode === 'paper' ? 'Demo account' : 'Account mode unavailable'}
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
        <Control
          name="Inverter sinais recebidos"
          description="BUY vira SELL e SELL vira BUY antes da execução. Sinais de fechamento não são alterados."
          value={s.invertIncomingSignals}
          field="invertIncomingSignals"
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
          [
            'Daily profit target',
            s.maximumDailyProfit == null
              ? 'Disabled'
              : money(s.maximumDailyProfit, data.account.currency),
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
        <MarketSessionsControl windows={s.marketSessions} />
        <MonetaryStopControl
          amount={s.stopRiskAmount}
          currency={data.account.currency}
          connected={data.brokerConnected}
          needsConfig={s.stopRiskNeedsConfig}
          symbols={s.allowedSymbols}
          symbolAmounts={s.stopRiskBySymbol}
        />
        <DailyTradeLimitControl
          limit={s.maximumDailyTrades}
          tradesToday={data.stats.tradesToday}
        />
        <DailyProfitTargetControl
          target={s.maximumDailyProfit ?? null}
          currency={data.account.currency}
          dailyPnl={data.stats.dailyPnl}
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
function DailyProfitTargetControl({
  target,
  currency,
  dailyPnl,
}: {
  target: number | null;
  currency: string;
  dailyPnl: number;
}) {
  const format = (value: number | null) =>
    value == null ? '' : String(value).replace('.', ',');
  const [draft, setDraft] = React.useState(format(target));
  const [savedTarget, setSavedTarget] = React.useState(target);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState(false);
  const previousTarget = React.useRef(target);
  React.useEffect(() => {
    const previous = previousTarget.current;
    setDraft((current) =>
      current === format(previous) ? format(target) : current,
    );
    setSavedTarget(target);
    previousTarget.current = target;
  }, [target]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    const value = Number(text.replace(',', '.'));
    const maximumDailyProfit = text ? value : null;
    if (
      text &&
      (!/^\d+(?:[.,]\d{1,8})?$/.test(text) ||
        !Number.isFinite(value) ||
        value <= 0 ||
        value > 999999999)
    ) {
      setError('Informe um valor positivo, como 50, ou deixe vazio para desativar.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess(false);
    try {
      const response = await fetch('/api/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maximumDailyProfit }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? `Request failed: ${response.status}`);
      setSavedTarget(result.maximumDailyProfit ?? null);
      setDraft(format(result.maximumDailyProfit ?? null));
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="mt-5">
      <label htmlFor="daily-profit-target" className="text-sm font-semibold">
        Take profit do dia ({currency})
      </label>
      <p id="daily-profit-target-help" className="muted my-2 text-xs">
        Resultado realizado hoje: {money(dailyPnl, currency)}.
        {savedTarget == null
          ? ' Nenhuma meta configurada.'
          : ` Meta atual: ${money(savedTarget, currency)}.`}{' '}
        Ao atingir a meta, novas entradas são bloqueadas até o próximo dia. As
        posições abertas continuam com seus próprios stops e take profits. Deixe
        vazio para desativar.
      </p>
      <div className="flex gap-2">
        <input
          id="daily-profit-target"
          aria-describedby="daily-profit-target-help"
          type="text"
          inputMode="decimal"
          placeholder="ex.: 50,00"
          value={draft}
          disabled={busy}
          onChange={(event) => {
            setDraft(event.target.value);
            setSuccess(false);
          }}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
        />
        <button type="submit" disabled={busy} className="btn">
          {busy ? 'Salvando…' : 'Salvar meta'}
        </button>
      </div>
      {error && (
        <p role="alert" className="red mt-2 text-xs">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="green mt-2 text-xs">
          Meta diária salva.
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
  description,
  value,
  field,
  danger = false,
}: {
  name: string;
  description?: string;
  value: boolean;
  field: 'autoTradingEnabled' | 'emergencyStop' | 'invertIncomingSignals';
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
        {description && (
          <div className="muted mt-1 text-xs">{description}</div>
        )}
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
import { SmaMicroSettings } from './sma-micro-settings';
import { SmaMicroChart } from './sma-micro-chart';

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
function StrategyPanel({ data }: { data: DashboardData }) {
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
  const firstSymbol = pairs[0]?.[0];

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

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {pairs.map(([symbol, entry]) => entry?.diversifiedTrend && (
          <div key={`trend-${symbol}`} className="rounded border border-white/10 p-3 text-xs">
            <div className="mb-2 font-semibold">{symbol} · Tendência diária diversificada</div>
            {state.trendConfig && <div className="muted mb-1">Momentum: {state.trendConfig.lookback} sessões · Vol: {state.trendConfig.volatilityPeriod} · Stop: {state.trendConfig.stopAtr} ATR · Alvo: {state.trendConfig.rewardRisk}R</div>}
            <div>Direção: {entry.diversifiedTrend.ready ? entry.diversifiedTrend.side ?? 'NEUTRA' : 'SEM DADOS'}</div>
            <div>Momentum: {entry.diversifiedTrend.momentum == null ? '—' : `${(entry.diversifiedTrend.momentum * 100).toFixed(2)}% log`}</div>
            <div>Score normalizado: {entry.diversifiedTrend.score?.toFixed(2) ?? '—'} · Volatilidade anual: {entry.diversifiedTrend.annualVolatility == null ? '—' : `${(entry.diversifiedTrend.annualVolatility * 100).toFixed(1)}%`}</div>
            <div className="muted mt-2">Dimensionamento por volatilidade na entrada · não é previsão de volatilidade da carteira</div>
            {entry.detail && <div className="muted mt-1">{entry.detail}</div>}
          </div>
        ))}
        {pairs.map(([symbol, entry]) => entry?.marketForces && !entry.diversifiedTrend && (
          <div key={symbol} className="rounded border border-white/10 p-3 text-xs">
            <div className="mb-2 font-semibold">{symbol} · Direção e atrito</div>
            <div className="grid grid-cols-2 gap-2">
              <span>Direção: {({ UP: 'ALTA', DOWN: 'BAIXA', NEUTRAL: 'NEUTRA', NOT_READY: 'SEM DADOS' })[entry.marketForces.direction]}</span>
              <span>Pressão: {({ BUY: 'COMPRADORA', SELL: 'VENDEDORA', BALANCED: 'EQUILIBRADA' })[entry.marketForces.pressure]}</span>
              <span>Atrito: {({ LOW: 'BAIXO', MODERATE: 'MODERADO', HIGH: 'ALTO', UNKNOWN: 'SEM DADOS' })[entry.marketForces.friction]} {entry.marketForces.frictionScore === null ? '' : `(${entry.marketForces.frictionScore}/100)`}</span>
              <span>Leitura: {({ BUY: 'FAVORECE COMPRA', SELL: 'FAVORECE VENDA', WAIT: 'AGUARDAR' })[entry.forceShock?.action ?? entry.marketForces.action]}</span>
            </div>
            <ul className="muted mt-2 space-y-1">{entry.marketForces.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            {entry.forceShock && <div className={`mt-2 ${entry.forceShock.blocked ? 'text-amber-400' : 'muted'}`}>
              <div>Choque: {entry.forceShock.shock.index?.toFixed(2) ?? 'SEM DADOS'} · Limite: {entry.forceShock.config.threshold} · Bloqueio: {entry.forceShock.cooldownRemaining} candle(s)</div>
              <div>{entry.forceShock.reason}</div>
            </div>}
            <div className="muted mt-2">Candles fechados · estimativa por preço · score não é probabilidade · {['market_forces', 'market_forces_shock'].includes(state.strategy ?? '') ? 'entradas automáticas sujeitas aos controles de risco' : 'leitura analítica'}</div>
          </div>
        ))}
      </div>
      {state.strategy === 'sma_micro_trend' && <SmaMicroSettings state={state} />}
      {state.strategy === 'sma_micro_trend' && firstSymbol && <>
        <SmaMicroChart state={state} symbol={firstSymbol} />
        {state.configs?.[firstSymbol]?.visual.showPanel && <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
          <span>Estratégia: SMA Micro Trend</span><span>Ativo: {firstSymbol} · {state.timeframe}</span><span>Tendência: {pairs[0]?.[1]?.trend ?? 'NOT_READY'}</span>
          <span>SMA rápida: {pairs[0]?.[1]?.fastSMA ?? '—'}</span><span>SMA lenta: {pairs[0]?.[1]?.slowSMA ?? '—'}</span><span>ATR: {pairs[0]?.[1]?.atr ?? '—'}</span>
          <span>Último sinal: {pairs[0]?.[1]?.side ?? '—'}</span><span>Posição: {data.positions.find((p) => p.symbol === firstSymbol)?.side ?? '—'}</span>
          <span>Entrada: {data.positions.find((p) => p.symbol === firstSymbol)?.entryPrice ?? '—'}</span><span>Stop: {data.positions.find((p) => p.symbol === firstSymbol)?.stopLoss ?? '—'}</span>
          <span>P&L não realizado: {data.positions.filter((p) => p.symbol === firstSymbol).reduce((n,p) => n + p.unrealizedPnl,0)}</span>
          <span>P&L realizado: {data.trades.filter((t) => t.symbol === firstSymbol).reduce((n,t) => n + Number(t.pnl ?? 0),0)}</span>
          <span>Operações executadas: {data.orders.filter((o) => o.symbol === firstSymbol && o.status === 'FILLED').length}</span>
        </div>}
      </>}

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
      <StrategyPanel data={data} />
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

function Mt5Maintenance() {
  const [busy, setBusy] = React.useState<'install' | 'doctor' | null>(null);
  const [result, setResult] = React.useState<{
    action: 'install' | 'doctor';
    ok: boolean;
    exitCode: number | null;
    output: string;
  } | null>(null);
  const [error, setError] = React.useState('');
  const run = async (action: 'install' | 'doctor') => {
    setBusy(action);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/mt5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = (await response.json()) as {
        error?: string;
        action?: 'install' | 'doctor';
        ok?: boolean;
        exitCode?: number | null;
        output?: string;
      };
      if (!response.ok)
        throw new Error(json.error ?? `Request failed: ${response.status}`);
      setResult({
        action: json.action ?? action,
        ok: Boolean(json.ok),
        exitCode: json.exitCode ?? null,
        output: json.output ?? '',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="panel p-4 sm:col-span-2">
      <h2 className="text-lg font-bold">Bridge MT5</h2>
      <p className="muted my-2 text-xs">
        Recompila e instala o serviço AurumBridge no terminal. O diagnóstico é
        somente leitura e verifica heartbeat, conta, watch list e fila de
        comandos.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => void run('install')}
        >
          {busy === 'install' ? 'Instalando…' : 'Instalar / atualizar bridge'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => void run('doctor')}
        >
          {busy === 'doctor' ? 'Diagnosticando…' : 'Diagnosticar conexão'}
        </button>
      </div>
      {error && (
        <p role="alert" className="red mt-3 text-xs">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-4">
          <p
            role="status"
            className={`text-xs font-semibold ${result.ok ? 'green' : 'red'}`}
          >
            {result.ok
              ? result.action === 'install'
                ? 'Bridge instalada com sucesso.'
                : 'Bridge pronta.'
              : `Falha (código ${result.exitCode ?? '—'}).`}
          </p>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
            {result.output || 'Sem saída.'}
          </pre>
        </div>
      )}
    </section>
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
      : section === 'cycles'
        ? 'Ciclos'
        : section === 'trade-charts'
          ? 'Gráficos de trades'
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
            : section === 'cycles'
              ? 'Projeção de capital composto por ciclo.'
              : section === 'trade-charts'
                ? 'Entrada, stop e alvo nos últimos 10 trades fechados.'
                : isTrading
                ? 'Signals, orders and positions in one workspace.'
                : `Monitor ${section} and execution status.`
        }
        data={data}
      />
      {section === 'dashboard' ? (
        <Overview data={data} />
      ) : section === 'cycles' ? (
        <CyclesPanel
          balance={data.account.balance}
          currency={data.account.currency}
        />
      ) : section === 'trade-charts' ? (
        <TradeCharts />
      ) : section === 'strategies' ? (
        <div className="space-y-5">
          <StrategyPanel data={data} />
          <Table
            rows={data.strategies}
            columns={fields.strategies ?? []}
            empty="No strategies registered."
          />
        </div>
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
            value={data.mode === 'live' ? 'Live' : data.mode === 'paper' ? 'Demo' : 'Unknown'}
            hint={
              data.mode === 'live'
                ? 'Real-money account'
                : data.mode === 'paper' ? 'Demo account, real market data' : 'Waiting for terminal account'
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
          <Mt5Maintenance />
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
          <ExportTrades />
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
