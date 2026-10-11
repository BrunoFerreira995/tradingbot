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
  const min = Math.min(...values),
    max = Math.max(...values);
  const start = Date.parse(points[0]?.at ?? ''),
    end = Date.parse(points.at(-1)?.at ?? '');
  const x = (at: string) =>
    50 + ((Date.parse(at) - start) / Math.max(1, end - start)) * 900;
  const y = (value: number) =>
    215 - ((value - min) / Math.max(1, max - min)) * 180;
  const path = (field: 'balance' | 'equity') =>
    points.map((p) => `${x(p.at)},${y(p[field])}`).join(' ');
  const active = points[selected ?? points.length - 1];
  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Saldo e equity</h2>
        <div className="flex flex-wrap gap-2">
          {(['observed', 'balance'] as const).map((item) => (
            <button
              key={item}
              onClick={() => {
                setMode(item);
                setSelected(null);
              }}
              className={`pill ${mode === item ? 'amber' : 'muted'}`}
            >
              {item === 'observed'
                ? 'Saldo + equity observados'
                : 'Saldo pelo histórico MT5'}
            </button>
          ))}
          {(['day', 'week', 'all'] as const).map((item) => (
            <button
              key={item}
              onClick={() => {
                setPeriod(item);
                setSelected(null);
              }}
              className={`pill ${period === item ? 'amber' : 'muted'}`}
            >
              {item === 'day' ? '24h' : item === 'week' ? '7 dias' : 'Tudo'}
            </button>
          ))}
        </div>
      </div>
      {points.length ? (
        <>
          <p className="mb-3 text-sm">
            <span className="text-amber-300">
              Saldo {money(active?.balance, performance.currency)}
            </span>
            {mode === 'observed' && (
              <span className="ml-4 text-emerald-400">
                Equity {money(active?.equity, performance.currency)}
              </span>
            )}
            <span className="muted ml-4">
              {date(active?.at, performance.timezone)}
            </span>
          </p>
          <svg
            viewBox="0 0 1000 260"
            className="w-full"
            role="img"
            aria-label={`Curva de capital em ${performance.currency}`}
            onMouseLeave={() => setSelected(null)}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = Math.max(
                0,
                Math.min(
                  1,
                  (((event.clientX - rect.left) / rect.width) * 1000 - 50) /
                    900,
                ),
              );
              const target = start + ratio * (end - start);
              let nearest = 0;
              for (let i = 1; i < points.length; i++)
                if (
                  Math.abs(Date.parse(points[i]!.at) - target) <
                  Math.abs(Date.parse(points[nearest]!.at) - target)
                )
                  nearest = i;
              setSelected(nearest);
            }}
          >
            {[min, (min + max) / 2, max].map((value, i) => (
              <g key={i}>
                <line
                  x1="50"
                  x2="950"
                  y1={y(value)}
                  y2={y(value)}
                  stroke="#253247"
                />
                <text x="50" y={y(value) - 6} fill="#94a3b8" fontSize="11">
                  {money(value, performance.currency)}
                </text>
              </g>
            ))}
            <polyline
              points={path('balance')}
              fill="none"
              stroke="#fbbf24"
              strokeWidth="2"
            />
            {mode === 'observed' && (
              <polyline
                points={path('equity')}
                fill="none"
                stroke="#34d399"
                strokeWidth="2"
              />
            )}
            {active && (
              <circle
                cx={x(active.at)}
                cy={y(mode === 'observed' ? active.equity : active.balance)}
                r="4"
                fill="#fff"
              />
            )}
            <text x="50" y="250" fill="#94a3b8" fontSize="11">
              {date(points[0]?.at, performance.timezone)}
            </text>
            <text x="950" y="250" textAnchor="end" fill="#94a3b8" fontSize="11">
              {date(points.at(-1)?.at, performance.timezone)}
            </text>
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
