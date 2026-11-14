'use client';
import React from 'react';
import { money } from '../lib/api';

const STORAGE_KEY = 'aurum.cycles.parameters';
const DEFAULT_PARAMETERS: Parameters = {
  initialCapital: '10',
  profitPer001: '23,04',
  stopPer001: '0,26',
  cycleCount: '10',
};

interface Parameters {
  initialCapital: string;
  profitPer001: string;
  stopPer001: string;
  cycleCount: string;
}

interface CycleRow {
  cycle: number;
  startCapital: number;
  finalCapital: number;
  lots: number;
  totalProfit: number;
  totalStopLoss: number;
}

function parseAmount(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?:[.,]\d{1,8})?$/.test(text)) return null;
  const amount = Number(text.replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function buildRows(
  initialCapital: number,
  profitPer001: number,
  stopPer001: number,
  cycleCount: number,
): CycleRow[] {
  let capital = initialCapital;
  const rows: CycleRow[] = [];
  for (let cycle = 1; cycle <= cycleCount; cycle++) {
    const units = Math.floor(Math.round(capital * 100) / 1000);
    const totalProfit = units * profitPer001;
    const totalStopLoss = units * stopPer001;
    rows.push({
      cycle,
      startCapital: capital,
      finalCapital: capital + totalProfit,
      lots: units / 100,
      totalProfit,
      totalStopLoss,
    });
    capital += totalProfit;
  }
  return rows;
}

function ParameterField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block text-sm font-semibold">
      {label}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 font-normal"
      />
      {hint && (
        <span className="muted mt-1 block text-xs font-normal">{hint}</span>
      )}
    </label>
  );
}

export function CyclesPanel({
  balance,
  currency,
}: {
  balance: number;
  currency: string;
}) {
  const [parameters, setParameters] =
    React.useState<Parameters>(DEFAULT_PARAMETERS);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let next = DEFAULT_PARAMETERS;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const saved = JSON.parse(stored) as Partial<Parameters>;
        next = {
          initialCapital:
            typeof saved.initialCapital === 'string'
              ? saved.initialCapital
              : next.initialCapital,
          profitPer001:
            typeof saved.profitPer001 === 'string'
              ? saved.profitPer001
              : next.profitPer001,
          stopPer001:
            typeof saved.stopPer001 === 'string'
              ? saved.stopPer001
              : next.stopPer001,
          cycleCount:
            typeof saved.cycleCount === 'string'
              ? saved.cycleCount
              : next.cycleCount,
        };
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setParameters(next);
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parameters));
  }, [loaded, parameters]);

  const initialCapital = parseAmount(parameters.initialCapital);
  const profitPer001 = parseAmount(parameters.profitPer001);
  const stopPer001 = parseAmount(parameters.stopPer001);
  const cycleCount = Number(parameters.cycleCount);
  const validCycleCount =
    Number.isInteger(cycleCount) && cycleCount >= 1 && cycleCount <= 20;
  const valid =
    initialCapital !== null &&
    profitPer001 !== null &&
    stopPer001 !== null &&
    validCycleCount;
  const rows = valid
    ? buildRows(initialCapital, profitPer001, stopPer001, cycleCount)
    : [];
  const last = rows.at(-1);
  const belowInitial = rows.length > 0 && balance < rows[0]!.startCapital;
  const currentIndex = belowInitial
    ? -1
    : rows.findIndex((row) => balance < row.finalCapital);
  const currentRow = currentIndex >= 0 ? rows[currentIndex] : undefined;
  const balancePosition = belowInitial
    ? 'Abaixo do capital inicial'
    : currentRow
      ? `Ciclo ${currentRow.cycle}`
      : last
        ? `Acima do ciclo ${last.cycle}`
        : '—';
  const update = (field: keyof Parameters, value: string) =>
    setParameters((current) => ({ ...current, [field]: value }));

  return (
    <div className="space-y-5">
      <section className="panel p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">Parâmetros da tabela</h2>
          <p className="muted mt-1 text-xs">
            Os valores são salvos neste navegador. O lote de cada ciclo é
            calculado como 0,01 lote para cada US$ 10,00 de capital, sempre
            arredondando para baixo. O saldo atual da conta destaca o ciclo
            correspondente.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ParameterField
            id="cycle-initial-capital"
            label="Capital inicial (US$)"
            value={parameters.initialCapital}
            onChange={(value) => update('initialCapital', value)}
          />
          <ParameterField
            id="cycle-profit"
            label="Lucro por 0,01 lote (US$)"
            value={parameters.profitPer001}
            onChange={(value) => update('profitPer001', value)}
          />
          <ParameterField
            id="cycle-stop"
            label="Stop loss por 0,01 lote (US$)"
            value={parameters.stopPer001}
            onChange={(value) => update('stopPer001', value)}
          />
          <label
            htmlFor="cycle-count"
            className="block text-sm font-semibold"
          >
            Ciclos (1 a 20)
            <input
              id="cycle-count"
              type="number"
              min={1}
              max={20}
              step={1}
              value={parameters.cycleCount}
              onChange={(event) => update('cycleCount', event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 font-normal"
            />
          </label>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className="button"
            onClick={() => setParameters(DEFAULT_PARAMETERS)}
          >
            Restaurar padrão
          </button>
        </div>
        {!valid && (
          <p role="alert" className="red mt-4 text-xs">
            Informe capital, lucro e stop positivos e um número de ciclos entre
            1 e 20.
          </p>
        )}
      </section>

      {valid && last && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="panel p-5">
              <div className="muted mb-3 text-xs uppercase tracking-widest">
                Capital inicial
              </div>
              <div className="text-2xl font-bold tracking-tight">
                {money(initialCapital)}
              </div>
            </div>
            <div className="panel p-5">
              <div className="muted mb-3 text-xs uppercase tracking-widest">
                Saldo atual da conta
              </div>
              <div className="text-2xl font-bold tracking-tight">
                {money(balance, currency)}
              </div>
              <div className="muted mt-2 text-xs">{balancePosition}</div>
            </div>
            <div className="panel p-5">
              <div className="muted mb-3 text-xs uppercase tracking-widest">
                Capital final no ciclo {last.cycle}
              </div>
              <div className="text-2xl font-bold tracking-tight">
                {money(last.finalCapital)}
              </div>
            </div>
            <div className="panel p-5">
              <div className="muted mb-3 text-xs uppercase tracking-widest">
                Lucro acumulado
              </div>
              <div className="green text-2xl font-bold tracking-tight">
                {money(last.finalCapital - initialCapital)}
              </div>
            </div>
          </div>

          <section className="panel table-wrap">
            <div className="p-6 pb-0">
              <h2 className="text-lg font-semibold">Tabela de ciclos</h2>
              <p className="muted mt-1 pb-5 text-xs">
                Projeção de capital composto. Cada ciclo usa o capital final do
                ciclo anterior para calcular o próximo lote.
              </p>
              <p className="muted -mt-3 pb-5 text-xs">
                {currentRow
                  ? `Saldo atual de ${money(balance, currency)} está no ciclo ${currentRow.cycle}.`
                  : belowInitial
                    ? `Saldo atual de ${money(balance, currency)} ainda está abaixo do capital inicial.`
                    : `Saldo atual de ${money(balance, currency)} está acima do ciclo ${last.cycle}.`}
              </p>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Ciclo</th>
                  <th>Lotes</th>
                  <th>Lucro total</th>
                  <th>Stop loss</th>
                  <th>Capital final</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isCurrent = currentRow?.cycle === row.cycle;
                  return (
                    <tr
                      key={row.cycle}
                      className={isCurrent ? 'bg-amber-400/10' : ''}
                    >
                      <td
                        className={
                          isCurrent
                            ? 'font-semibold text-amber-300'
                            : 'font-semibold'
                        }
                      >
                        {row.cycle}
                        {isCurrent && (
                          <span className="pill amber ml-2">SALDO ATUAL</span>
                        )}
                      </td>
                      <td>{row.lots.toFixed(2).replace('.', ',')}</td>
                      <td className="green">{money(row.totalProfit)}</td>
                      <td>{money(row.totalStopLoss)}</td>
                      <td className="font-semibold">
                        {money(row.finalCapital)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
