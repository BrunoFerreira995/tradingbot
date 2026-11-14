'use client';

import React from 'react';
import type { StrategyState } from '../lib/api';

type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  fast: number | null;
  slow: number | null;
  signal: 'BUY' | 'SELL' | null;
  trend: string;
};

type Position = {
  side: string;
  entryPrice: number;
  stopLoss?: number;
  unrealizedPnl: number;
};

type ChartData = {
  candles: Candle[];
  positions: Position[];
};

export function SmaMicroChart({ state, symbol }: { state: StrategyState; symbol: string }) {
  const [chart, setChart] = React.useState<ChartData | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void fetch('/api/strategy/chart', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol, timeframe: state.timeframe }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: ChartData) => {
        if (active) setChart(data);
      })
      .catch((err) => {
        if (err.name !== 'AbortError' && active) setChart(null);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [symbol, state.timeframe, state.lastCheckAt]);

  if (!chart?.candles.length) {
    return <p className="text-sm text-slate-400">Gráfico indisponível.</p>;
  }

  const candles = chart.candles.slice(-80);
  const config = state.configs?.[symbol];
  const position = chart.positions[0];

  // Cálculo seguro de limites para evitar divisão por zero
  const prices = candles.flatMap((c) => [c.h, c.l, c.fast ?? c.c, c.slow ?? c.c]);
  if (position?.stopLoss) prices.push(position.stopLoss);

  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const range = rawMax - rawMin > 0.00001 ? rawMax - rawMin : 1;
  const min = rawMin - range * 0.05; // margem superior/inferior de 5%
  const max = rawMax + range * 0.05;
  const adjustedRange = max - min;

  const y = (value: number) => 210 - ((value - min) / adjustedRange) * 180;
  const x = (i: number) => 20 + i * (760 / Math.max(1, candles.length - 1));

  const linePath = (key: 'fast' | 'slow') => {
    let started = false;
    return candles
      .map((c, i) => {
        if (c[key] === null) return null;
        const cmd = `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(c[key]!).toFixed(1)}`;
        started = true;
        return cmd;
      })
      .filter(Boolean)
      .join(' ');
  };

  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-slate-700 bg-slate-950 p-3">
      <div className="mb-2 text-xs text-slate-300">
        <span className="text-amber-300 font-medium">SMA {config?.indicators.fastSMA ?? 9}</span> ·{' '}
        <span className="text-sky-300 font-medium">SMA {config?.indicators.slowSMA ?? 40}</span> · {symbol}{' '}
        {state.timeframe}
        {config?.filters.requireMacroTrendAlignment
          ? ` · alinhamento macro ${config.filters.macroTimeframe}`
          : ''}
      </div>

      <svg
        viewBox="0 0 800 240"
        className="w-full min-w-[600px]"
        role="img"
        aria-label={`Candles, médias móveis e sinais operacionais de ${symbol}`}
      >
        {/* Fundo de tendência */}
        {config?.visual.colorTrendBackground &&
          candles.map((c, i) => (
            <rect
              key={`bg-${c.t}`}
              x={x(i) - 4}
              y="15"
              width="8"
              height="200"
              fill={c.trend === 'UP' ? '#064e3b' : c.trend === 'DOWN' ? '#450a0a' : 'transparent'}
              opacity="0.32"
            />
          ))}

        {/* Barras de Candles */}
        {candles.map((c, i) => {
          const isUp = c.c >= c.o;
          const strokeColor = config?.visual.colorCandles
            ? c.trend === 'UP'
              ? '#34d399'
              : c.trend === 'DOWN'
              ? '#fb7185'
              : '#94a3b8'
            : isUp
            ? '#34d399'
            : '#fb7185';

          return (
            <g key={c.t} stroke={strokeColor}>
              <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} strokeWidth="1" />
              <line x1={x(i) - 2} x2={x(i)} y1={y(c.o)} y2={y(c.o)} strokeWidth="2" />
              <line x1={x(i)} x2={x(i) + 2} y1={y(c.c)} y2={y(c.c)} strokeWidth="2" />
              {config?.visual.showSignals && c.signal && (
                <text
                  x={x(i)}
                  y={c.signal === 'BUY' ? y(c.l) + 14 : y(c.h) - 8}
                  textAnchor="middle"
                  fill={c.signal === 'BUY' ? '#34d399' : '#fb7185'}
                  stroke="none"
                  fontSize="9"
                  fontWeight="bold"
                >
                  {c.signal}
                </text>
              )}
            </g>
          );
        })}

        {/* Linhas de Média Móvel */}
        <path d={linePath('fast')} fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={linePath('slow')} fill="none" stroke="#7dd3fc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Linha de Stop Loss / Trailing Stop */}
        {position?.stopLoss && (
          <g>
            <line
              x1="15"
              x2="790"
              y1={y(position.stopLoss)}
              y2={y(position.stopLoss)}
              stroke="#f87171"
              strokeDasharray="5 4"
              strokeWidth="1.2"
            />
            <text
              x="790"
              y={y(position.stopLoss) - 4}
              textAnchor="end"
              fill="#f87171"
              fontSize="10"
              fontWeight="medium"
            >
              {config?.risk.useATRTrailingStop ? 'TRAIL STOP' : 'STOP'} {position.stopLoss}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}