'use client';
import { useEffect, useState } from 'react';
import type { PerformanceData } from '@trade/shared';
import { date, money, num, type DashboardData } from '../lib/api';

function Metric({
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
      <div className="muted mb-2 text-xs uppercase tracking-widest">
        {label}
      </div>
      <div className="text-xl font-bold">{value}</div>
      {hint && <div className="muted mt-2 text-xs">{hint}</div>}
    </div>
  );
}
function formatAxisTime(value: number, timezone: string, span: number) {
  const dateValue = new Date(value);
  if (span <= 86400000)
    return dateValue.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    });
  if (span <= 14 * 86400000)
    return dateValue.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    });
  if (span <= 365 * 86400000)
    return dateValue.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      timeZone: timezone,
    });
  return dateValue.toLocaleDateString('pt-BR', {
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  });
}

function CapitalChart({ performance }: { performance: PerformanceData }) {
  const [period, setPeriod] = useState<'day' | 'week' | 'all'>('all');
  const [mode, setMode] = useState<'observed' | 'balance'>('observed');
  const [selected, setSelected] = useState<number | null>(null);
  const source =
    mode === 'observed'
      ? performance.curve
      : performance.balanceCurve.map((p) => ({ ...p, equity: p.balance }));
  const latest = source.at(-1);
  const cutoff =
    period === 'all'
      ? -Infinity
      : Date.parse(latest?.at ?? '') -
        (period === 'day' ? 86400000 : 7 * 86400000);
  const points = source.filter((p) => Date.parse(p.at) >= cutoff);
  const values = points.flatMap((p) =>
    mode === 'observed' ? [p.balance, p.equity] : [p.balance],
  );
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const spread = rawMax - rawMin;
  const padding =
    spread > 0 ? spread * 0.08 : Math.max(1, Math.abs(rawMax) * 0.01);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const start = Date.parse(points[0]?.at ?? '');
  const end = Date.parse(points.at(-1)?.at ?? '');
  const span = Math.max(1, end - start);
  const width = 1000;
  const height = 340;
  const left = 82;
  const right = 24;
  const top = 20;
  const bottom = 46;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (at: string | number) => {
    const value = typeof at === 'number' ? at : Date.parse(at);
    return start === end
      ? left + plotWidth / 2
      : left + ((value - start) / span) * plotWidth;
  };
  const y = (value: number) =>
    top + (1 - (value - min) / Math.max(1, max - min)) * plotHeight;
  const linePath = (field: 'balance' | 'equity') =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'} ${x(point.at)} ${y(point[field])}`,
      )
      .join(' ');
  const areaPath = (field: 'balance' | 'equity') => {
    const first = points[0];
    const last = points.at(-1);
    if (!first || !last) return '';
    return [
      `M ${x(first.at)} ${top + plotHeight}`,
      ...points.map((point) => `L ${x(point.at)} ${y(point[field])}`),
      `L ${x(last.at)} ${top + plotHeight}`,
      'Z',
    ].join(' ');
  };
  const active = points[selected ?? points.length - 1];
  const yTicks = [0, 1, 2, 3, 4].map(
    (index) => min + ((max - min) * index) / 4,
  );
  const xTicks =
    start === end
      ? [start]
      : [0, 1, 2, 3, 4].map((index) => start + (span * index) / 4);
  const selectNearest = (clientX: number, rect: DOMRect) => {
    const ratio = Math.max(
      0,
      Math.min(
        1,
        (((clientX - rect.left) / rect.width) * width - left) / plotWidth,
      ),
    );
    const target = start + ratio * span;
    let nearest = 0;
    for (let index = 1; index < points.length; index++)
      if (
        Math.abs(Date.parse(points[index]!.at) - target) <
        Math.abs(Date.parse(points[nearest]!.at) - target)
      )
        nearest = index;
    setSelected(nearest);
  };
  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold">Saldo e equity</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-700 bg-slate-950 p-0.5">
            {(['observed', 'balance'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={mode === item}
                onClick={() => {
                  setMode(item);
                  setSelected(null);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${mode === item ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                {item === 'observed'
                  ? 'Saldo + equity observados'
                  : 'Saldo pelo histórico MT5'}
              </button>
            ))}
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-700 bg-slate-950 p-0.5">
            {(['day', 'week', 'all'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={period === item}
                onClick={() => {
                  setPeriod(item);
                  setSelected(null);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${period === item ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                {item === 'day' ? '24h' : item === 'week' ? '7 dias' : 'Tudo'}
              </button>
            ))}
          </div>
        </div>
      </div>
      {points.length ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span className="muted">Saldo</span>
              <strong>{money(active?.balance, performance.currency)}</strong>
            </span>
            {mode === 'observed' && (
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="muted">Equity</span>
                <strong className="text-emerald-400">
                  {money(active?.equity, performance.currency)}
                </strong>
              </span>
            )}
            <span className="muted ml-auto text-xs">
              {date(active?.at, performance.timezone)}
            </span>
          </div>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full touch-none"
            role="img"
            aria-label={`Curva de capital em ${performance.currency}`}
            onPointerLeave={() => setSelected(null)}
            onPointerMove={(event) =>
              selectNearest(
                event.clientX,
                event.currentTarget.getBoundingClientRect(),
              )
            }
          >
            <defs>
              <linearGradient
                id="capital-balance-area"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
              </linearGradient>
              <linearGradient
                id="capital-equity-area"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor="#34d399" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
              </linearGradient>
            </defs>
            {yTicks.map((value, index) => (
              <g key={`y-${index}`}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="#1e2b3e"
                />
                <text
                  x={left - 10}
                  y={y(value) + 4}
                  textAnchor="end"
                  fill="#8b9bb2"
                  fontSize="11"
                >
                  {money(value, performance.currency)}
                </text>
              </g>
            ))}
            {xTicks.map((value, index) => (
              <g key={`x-${index}`}>
                <line
                  x1={x(value)}
                  x2={x(value)}
                  y1={top + plotHeight}
                  y2={top + plotHeight + 5}
                  stroke="#334155"
                />
                <text
                  x={x(value)}
                  y={height - 18}
                  textAnchor={
                    index === 0
                      ? 'start'
                      : index === xTicks.length - 1
                        ? 'end'
                        : 'middle'
                  }
                  fill="#8b9bb2"
                  fontSize="11"
                >
                  {formatAxisTime(value, performance.timezone, span)}
                </text>
              </g>
            ))}
            <path d={areaPath('balance')} fill="url(#capital-balance-area)" />
            {mode === 'observed' && (
              <path d={areaPath('equity')} fill="url(#capital-equity-area)" />
            )}
            <path
              d={linePath('balance')}
              fill="none"
              stroke="#fbbf24"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {mode === 'observed' && (
              <path
                d={linePath('equity')}
                fill="none"
                stroke="#34d399"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {active && (
              <>
                <line
                  x1={x(active.at)}
                  x2={x(active.at)}
                  y1={top}
                  y2={top + plotHeight}
                  stroke="#64748b"
                  strokeDasharray="4 4"
                />
                <circle
                  cx={x(active.at)}
                  cy={y(active.balance)}
                  r="5"
                  fill="#fbbf24"
                  stroke="#0f172a"
                  strokeWidth="2"
                />
                {mode === 'observed' && (
                  <circle
                    cx={x(active.at)}
                    cy={y(active.equity)}
                    r="5"
                    fill="#34d399"
                    stroke="#0f172a"
                    strokeWidth="2"
                  />
                )}
              </>
            )}
          </svg>
          <p className="muted text-xs">
            {mode === 'observed'
              ? `Equity disponível desde ${date(performance.observedSince, performance.timezone)}. Amostras por minuto enquanto a API está ativa.`
              : 'Saldo reconstruído com os negócios do terminal. Aportes também alteram esta curva.'}
          </p>
        </>
      ) : (
        <p className="muted py-8 text-center">
          Aguardando dados de capital do MetaTrader.
        </p>
      )}
    </section>
  );
}
export function PerformancePanel({ data }: { data: DashboardData }) {
  const performance = data.performance;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!performance) return null;
  const cash = (value: number | null) =>
    value === null ? '—' : money(value, performance.currency);
  const stale =
    !data.brokerConnected ||
    !performance.updatedAt ||
    now - Date.parse(performance.updatedAt) > 30000;
  const historyStale =
    !performance.historyUpdatedAt ||
    now - Date.parse(performance.historyUpdatedAt) > 60000;
  const d = performance.drawdown;
  return (
    <div className="mt-6 space-y-5">
      <div className="panel flex flex-wrap justify-between gap-3 p-4 text-sm">
        <span>
          {performance.currency} · {performance.timezone}
        </span>
        <span className={stale ? 'text-red-400' : 'text-emerald-400'}>
          {stale ? 'Dados desatualizados' : 'Dados atuais'} ·{' '}
          {date(performance.updatedAt, performance.timezone)}
        </span>
      </div>
      {(!performance.historyAvailable ||
        historyStale ||
        !performance.historyComplete) && (
        <div className="panel border border-amber-400/30 p-4 text-sm text-amber-300">
          {!performance.historyAvailable
            ? 'Histórico MT5 ainda indisponível. Reinicie o serviço AurumBridge atualizado no terminal para carregar operações, aportes e custos.'
            : historyStale
              ? `Histórico desatualizado: ${date(performance.historyUpdatedAt, performance.timezone)}. Os resultados abaixo usam a última leitura disponível.`
              : 'Histórico parcial (últimos 50.000 negócios). Resultados cobrem apenas os negócios disponíveis; rentabilidade e drawdown aguardam histórico completo.'}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Líquido diário"
          value={cash(performance.netDaily)}
          hint={`Dia em ${performance.timezone}`}
        />
        <Metric
          label="Líquido mensal"
          value={cash(performance.netMonthly)}
          hint="Com comissão, swap e taxas"
        />
        <Metric
          label="Líquido acumulado"
          value={cash(performance.netTotal)}
          hint="Aportes e ajustes separados"
        />
        <Metric
          label="Retorno ajustado aos aportes"
          value={
            performance.adjustedReturn === null
              ? '—'
              : `${num(performance.adjustedReturn)}%`
          }
          hint="Modified Dietz · estimativa desde o início da coleta"
        />
        <Metric
          label="Depósitos"
          value={cash(performance.deposits)}
          hint="Movimentos positivos de saldo MT5"
        />
        <Metric
          label="Saques"
          value={cash(performance.withdrawals)}
          hint="Movimentos negativos de saldo MT5"
        />
        <Metric
          label="Créditos e ajustes"
          value={cash(performance.adjustments)}
          hint="Crédito, correção e bônus"
        />
        <Metric
          label="Comissão / swap / taxas"
          value={`${cash(performance.commission)} / ${cash(performance.swap)} / ${cash(performance.fees)}`}
        />
        <Metric
          label="Drawdown atual"
          value={d ? `${cash(d.amount)} · ${num(d.percent)}%` : '—'}
          hint="Equity ajustada aos fluxos desde a coleta"
        />
        <Metric
          label="Drawdown máximo"
          value={d ? `${cash(d.maxAmount)} · ${num(d.maxPercent)}%` : '—'}
          hint="Entre as amostras coletadas"
        />
        <Metric
          label="Margem comprometida"
          value={money(data.account.usedMargin, performance.currency)}
          hint={
            data.account.equity > 0
              ? `${num((data.account.usedMargin / data.account.equity) * 100)}% da equity`
              : 'Equity indisponível'
          }
        />
        <Metric
          label="Risco até os stops"
          value={cash(performance.stopRisk)}
          hint="Estimativa desde o preço atual; não inclui slippage e custos futuros"
        />
      </div>
      <CapitalChart performance={performance} />
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Símbolo</th>
              <th>Lotes abertos</th>
              <th>Risco até SL ({performance.currency})</th>
              <th>Sem stop</th>
            </tr>
          </thead>
          <tbody>
            {performance.exposure.map((row) => (
              <tr key={row.symbol}>
                <td>{row.symbol}</td>
                <td>{num(row.lots)}</td>
                <td>{cash(row.stopRisk)}</td>
                <td>{row.missingStops}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted p-4 text-xs">
          Risco indisponível quando há posição sem stop ou sem valor de tick
          publicado. Volumes de instrumentos diferentes não são somados como
          exposição monetária.
        </p>
      </section>
    </div>
  );
}
