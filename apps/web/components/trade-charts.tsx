'use client';

import React from 'react';
import { AlertTriangle, ChartCandlestick, RefreshCw } from 'lucide-react';
import { TIMEFRAMES, type Timeframe } from '@trade/shared';
import { date, money, num } from '../lib/api';

interface Rate {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface TradeChart {
  id: string;
  symbol: string;
  side: string;
  lots: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  openedAt: string;
  closedAt: string;
  timeframe: string;
  tradeTimeframe: Timeframe;
  stopLoss?: number;
  takeProfit?: number;
  closeReason?: string;
  signalReason?: string;
  entryTime: number;
  exitTime: number;
  covered: boolean;
  candles: Rate[];
}

interface TradeChartsResponse {
  trades: TradeChart[];
  timeframe?: Timeframe;
  detail?: string;
}

function digitsFor(value: number): number {
  return value >= 100 ? 2 : 5;
}

function nearestIndex(candles: Rate[], time: number): number {
  if (!candles.length) return -1;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candles.length; i += 1) {
    const distance = Math.abs(candles[i]!.t - time);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

function TradeChartSvg({ trade }: { trade: TradeChart }) {
  const candles = trade.candles;
  if (!candles.length)
    return <p className="muted mt-4 text-sm">Sem candles para este trade.</p>;

  const digits = digitsFor(trade.entryPrice);
  const prices = candles.flatMap((candle) => [candle.h, candle.l]);
  prices.push(trade.entryPrice, trade.exitPrice);
  if (trade.stopLoss !== undefined) prices.push(trade.stopLoss);
  if (trade.takeProfit !== undefined) prices.push(trade.takeProfit);

  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const range = rawMax - rawMin > 0 ? rawMax - rawMin : 1;
  const min = rawMin - range * 0.08;
  const max = rawMax + range * 0.08;

  const width = 800;
  const height = 280;
  const left = 12;
  const right = 96;
  const top = 12;
  const bottom = 26;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const y = (value: number) => top + ((max - value) / (max - min)) * plotHeight;
  const x = (index: number) =>
    left + index * (plotWidth / Math.max(1, candles.length - 1));
  const bodyWidth = Math.max(
    1,
    Math.min(7, (plotWidth / Math.max(1, candles.length)) * 0.62),
  );

  const entryIndex = nearestIndex(candles, trade.entryTime);
  const exitIndex = nearestIndex(candles, trade.exitTime);
  const entryX = entryIndex >= 0 ? x(entryIndex) : left;
  const exitX = exitIndex >= 0 ? x(exitIndex) : left + plotWidth;

  const line = (
    value: number | undefined,
    color: string,
    label: string,
    dashed = true,
  ) => {
    if (value === undefined) return null;
    const py = y(value);
    return (
      <g key={label}>
        <line
          x1={left}
          x2={left + plotWidth}
          y1={py}
          y2={py}
          stroke={color}
          strokeWidth="1.2"
          strokeDasharray={dashed ? '5 4' : undefined}
        />
        <text
          x={left + plotWidth + 6}
          y={py + 3}
          fill={color}
          fontSize="10"
          fontWeight="600"
        >
          {label} {num(value, digits)}
        </text>
      </g>
    );
  };

  const band = (
    from: number | undefined,
    to: number,
    color: string,
  ) => {
    if (from === undefined) return null;
    const topY = Math.min(y(from), y(to));
    const heightY = Math.abs(y(from) - y(to));
    return (
      <rect
        x={left}
        y={topY}
        width={plotWidth}
        height={heightY}
        fill={color}
        opacity="0.06"
      />
    );
  };

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700 bg-slate-950 p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[560px]"
        role="img"
        aria-label={`Gráfico do trade ${trade.side} em ${trade.symbol} com entrada, stop e alvo`}
      >
        {band(trade.stopLoss, trade.entryPrice, '#f87171')}
        {band(trade.takeProfit, trade.entryPrice, '#34d399')}

        {candles.map((candle, index) => {
          const up = candle.c >= candle.o;
          const color = up ? '#34d399' : '#fb7185';
          const cx = x(index);
          const bodyTop = y(Math.max(candle.o, candle.c));
          const bodyHeight = Math.max(1, Math.abs(y(candle.o) - y(candle.c)));
          return (
            <g key={candle.t} stroke={color} fill={color}>
              <line
                x1={cx}
                x2={cx}
                y1={y(candle.h)}
                y2={y(candle.l)}
                strokeWidth="1"
              />
              <rect
                x={cx - bodyWidth / 2}
                y={bodyTop}
                width={bodyWidth}
                height={bodyHeight}
                stroke="none"
              />
            </g>
          );
        })}

        <line
          x1={entryX}
          x2={entryX}
          y1={top}
          y2={top + plotHeight}
          stroke="#fbbf24"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <line
          x1={exitX}
          x2={exitX}
          y1={top}
          y2={top + plotHeight}
          stroke="#94a3b8"
          strokeWidth="1"
          strokeDasharray="2 3"
        />

        {line(trade.entryPrice, '#fbbf24', 'ENTRADA', false)}
        {line(trade.stopLoss, '#f87171', 'STOP')}
        {line(trade.takeProfit, '#34d399', 'ALVO')}

        <circle
          cx={entryX}
          cy={y(trade.entryPrice)}
          r="4"
          fill="#fbbf24"
          stroke="#0f172a"
          strokeWidth="1.5"
        />
        <circle
          cx={exitX}
          cy={y(trade.exitPrice)}
          r="4"
          fill="#94a3b8"
          stroke="#0f172a"
          strokeWidth="1.5"
        />

        <text
          x={left}
          y={height - 8}
          fill="#64748b"
          fontSize="10"
        >
          {date(new Date(candles[0]!.t * 1000).toISOString())}
        </text>
        <text
          x={left + plotWidth}
          y={height - 8}
          fill="#64748b"
          fontSize="10"
          textAnchor="end"
        >
          {date(new Date(candles.at(-1)!.t * 1000).toISOString())}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 px-2 text-[11px] text-slate-400">
        <span className="text-amber-300">● Entrada</span>
        <span className="text-rose-400">● Stop</span>
        <span className="text-emerald-400">● Alvo</span>
        <span className="text-slate-300">● Saída</span>
      </div>
    </div>
  );
}

function TradeCard({ trade }: { trade: TradeChart }) {
  const digits = digitsFor(trade.entryPrice);
  const sideTone = trade.side === 'BUY' ? 'green' : 'red';
  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`pill ${sideTone}`}>{trade.side}</span>
            <span className="text-lg font-bold">{trade.symbol}</span>
            <span className="muted text-xs">
              {trade.timeframe}
              {trade.timeframe !== trade.tradeTimeframe
                ? ` · trade ${trade.tradeTimeframe}`
                : ''}
            </span>
          </div>
          <div className="muted mt-1 text-xs">
            {date(trade.openedAt)} → {date(trade.closedAt)}
          </div>
        </div>
        <div className="text-right">
          <div
            className={`text-lg font-bold ${trade.pnl >= 0 ? 'green' : 'red'}`}
          >
            {money(trade.pnl)}
          </div>
          <div className="muted text-xs">{trade.lots} lot</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <div className="muted">Entrada</div>
          <div className="font-semibold text-amber-300">
            {num(trade.entryPrice, digits)}
          </div>
        </div>
        <div>
          <div className="muted">Stop</div>
          <div className="font-semibold text-rose-400">
            {trade.stopLoss === undefined ? '—' : num(trade.stopLoss, digits)}
          </div>
        </div>
        <div>
          <div className="muted">Alvo</div>
          <div className="font-semibold text-emerald-400">
            {trade.takeProfit === undefined
              ? '—'
              : num(trade.takeProfit, digits)}
          </div>
        </div>
        <div>
          <div className="muted">Saída</div>
          <div className="font-semibold">
            {num(trade.exitPrice, digits)}
          </div>
        </div>
        <div>
          <div className="muted">Motivo</div>
          <div className="font-semibold">{trade.closeReason ?? '—'}</div>
        </div>
        <div>
          <div className="muted">Sinal</div>
          <div className="font-semibold">
            {trade.signalReason ? trade.signalReason.slice(0, 48) : '—'}
          </div>
        </div>
      </div>

      {!trade.covered && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          Histórico de candles insuficiente para cobrir a abertura deste trade.
          As linhas continuam corretas, mas o gráfico pode mostrar apenas o
          trecho recente.
        </div>
      )}

      <TradeChartSvg trade={trade} />
    </div>
  );
}

export function TradeCharts() {
  const [data, setData] = React.useState<TradeChartsResponse | null>(null);
  const [timeframe, setTimeframe] = React.useState<Timeframe | 'auto'>('auto');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '10' });
      if (timeframe !== 'auto') params.set('timeframe', timeframe);
      const response = await fetch(`/api/data/trade-charts?${params}`, {
        cache: 'no-store',
      });
      const body = (await response.json()) as TradeChartsResponse & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? `API ${response.status}`);
      setData({
        trades: body.trades ?? [],
        timeframe: body.timeframe,
        detail: body.detail,
      });
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar trades');
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold">
            <ChartCandlestick size={19} className="text-amber-400" />
            Gráficos de trades
          </div>
          <p className="muted mt-1 text-sm">
            Até 10 operações fechadas com direção, entrada, stop e alvo. O
            tempo gráfico pode ser trocado para qualquer um dos nove
            timeframes; no automático, cada trade usa o seu próprio contexto.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-slate-400">
            Tempo gráfico
            <select
              value={timeframe}
              onChange={(event) =>
                setTimeframe(event.target.value as Timeframe | 'auto')
              }
              className="ml-2 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100"
            >
              <option value="auto">Automático (por trade)</option>
              {TIMEFRAMES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="btn flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="panel border-red-500/30 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {data?.detail && (
        <div className="panel p-4 text-sm text-amber-300">{data.detail}</div>
      )}

      {!loading && !error && data?.trades.length === 0 && (
        <div className="panel p-8 text-center">
          <ChartCandlestick
            size={28}
            className="mx-auto mb-3 text-slate-500"
          />
          <p className="muted text-sm">
            Nenhum trade fechado disponível no histórico do MT5.
          </p>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {data?.trades.map((trade) => (
          <TradeCard key={trade.id} trade={trade} />
        ))}
      </div>
    </div>
  );
}
