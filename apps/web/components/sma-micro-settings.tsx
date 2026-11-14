'use client';
import React from 'react';
import type { SmaMicroTrendConfig } from '@trade/strategy';
import { TIMEFRAMES } from '@trade/shared';
import type { StrategyState } from '../lib/api';

export function SmaMicroSettings({ state }: { state: StrategyState }) {
  const [symbol, setSymbol] = React.useState(state.symbols[0] ?? '');
  const [draft, setDraft] = React.useState<SmaMicroTrendConfig | null>(null);
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [backtest, setBacktest] = React.useState<Record<string, number | null> | null>(null);
  const config = draft ?? state.configs?.[symbol];
  React.useEffect(() => { setDraft(null); }, [symbol, state.timeframe]);
  if (!config) return null;
  const update = <K extends 'indicators' | 'filters' | 'operations' | 'risk' | 'visual'>(group: K, field: keyof SmaMicroTrendConfig[K], value: number | boolean | string) =>
    setDraft({ ...config, [group]: { ...config[group], [field]: value } });
  const numberField = (group: 'indicators' | 'operations' | 'risk', field: string, label: string, step = '1') => (
    <label className="block text-sm">{label}<input type="number" min="0" step={step} value={String((config[group] as unknown as Record<string, unknown>)[field])}
      onChange={(e) => update(group, field as never, Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2" /></label>
  );
  const checkbox = (group: 'filters' | 'operations' | 'risk' | 'visual', field: string, label: string) => (
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={Boolean((config[group] as unknown as Record<string, unknown>)[field])}
      onChange={(e) => update(group, field as never, e.target.checked)} />{label}</label>
  );
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/strategy', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol, timeframe: state.timeframe, config }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Save failed');
      setMessage('Configuração salva.'); setDraft(null);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const runBacktest = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/strategy/backtest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol, timeframe: state.timeframe, config, count: 1000, options: { initialCapital: 10000, spread: 0, slippage: 0, commissionPerUnit: 0, units: 1 } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Backtest failed');
      setBacktest(result.metrics);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="mt-6 space-y-5 border-t border-slate-700 pt-5">
    <div className="flex items-center gap-3"><h3 className="font-semibold">SMA Micro Trend</h3><select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 p-2">{state.symbols.map((item) => <option key={item}>{item}</option>)}</select><span className="muted text-xs">{state.timeframe}</span></div>
    <div className="grid gap-5 md:grid-cols-2">
      <fieldset className="space-y-3"><legend className="mb-2 font-semibold">SMA MICRO</legend>{numberField('indicators','fastSMA','SMA rápida')}{numberField('indicators','slowSMA','SMA lenta')}{checkbox('filters','requirePriceSameSideAsFastSMA','Exigir preço do mesmo lado da SMA rápida')}{checkbox('filters','requireSlowSMASlope','Exigir inclinação da SMA lenta')}{checkbox('filters','requireMacroTrendAlignment','Exigir tendência macro na direção da entrada')}<label className="block text-sm">Timeframe macro<select value={config.filters.macroTimeframe} onChange={(e) => update('filters','macroTimeframe',e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2"><option value="AUTO">Automático (próximo timeframe)</option>{TIMEFRAMES.filter((item) => TIMEFRAMES.indexOf(item) > TIMEFRAMES.indexOf(state.timeframe)).map((item) => <option key={item} value={item}>{item}</option>)}</select></label><p className="muted text-xs">O alinhamento usa somente candles macro fechados. Desligado por padrão: nos trades M1 analisados, a confirmação M5 não melhorou o resultado observado.</p></fieldset>
      <fieldset className="space-y-3"><legend className="mb-2 font-semibold">OPERAÇÃO</legend>{checkbox('operations','allowLong','Permitir compras')}{checkbox('operations','allowShort','Permitir vendas')}{checkbox('operations','reverseOnOppositeSignal','Reverter no sinal oposto')}{checkbox('operations','closeOnNeutralTrend','Fechar quando médias neutras')}{numberField('operations','neutralAtrFraction','Zona neutra (fração ATR)','0.01')}</fieldset>
      <fieldset className="space-y-3"><legend className="mb-2 font-semibold">RISCO</legend>{checkbox('risk','useATRStop','Usar stop por ATR')}{numberField('indicators','atrPeriod','Período ATR')}{numberField('risk','atrStopMultiplier','Stop ATR','0.1')}{checkbox('risk','useATRTrailingStop','Usar trailing por ATR')}{numberField('risk','atrTrailingMultiplier','Trailing ATR','0.1')}{numberField('risk','lots','Lotes','0.01')}</fieldset>
      <fieldset className="space-y-3"><legend className="mb-2 font-semibold">VISUAL</legend>{checkbox('visual','showSignals','Mostrar sinais')}{checkbox('visual','colorCandles','Colorir candles')}{checkbox('visual','colorTrendBackground','Colorir fundo da tendência')}{checkbox('visual','showPanel','Mostrar painel')}</fieldset>
    </div>
    <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void save()} className="btn">Salvar estratégia</button><button disabled={busy} onClick={() => void runBacktest()} className="btn">Backtest · 1000 candles</button></div>
    <p className="muted text-xs">Backtest ilustrativo: capital 10.000, 1 unidade, custos zero. Resultados históricos não garantem lucro. Use a API para definir spread, slippage e comissão reais.</p>
    {backtest && <div className="grid gap-2 text-xs sm:grid-cols-3">{Object.entries(backtest).map(([key, value]) => <span key={key}>{key}: {value === null ? '—' : Number(value).toFixed(4)}</span>)}</div>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
