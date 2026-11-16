'use client';
import { useEffect, useRef, useState } from 'react';

function formatAmount(value: number | null | undefined) {
  return value == null ? '' : String(value).replace('.', ',');
}

function parseAmount(text: string) {
  const value = Number(text.replace(',', '.'));
  if (
    !/^\d+(?:[.,]\d{1,8})?$/.test(text) ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 999999999
  )
    return null;
  return value;
}

export function MonetaryStopControl({
  amount,
  currency,
  connected,
  needsConfig,
  symbols = [],
  symbolAmounts = {},
}: {
  amount?: number | null;
  currency: string;
  connected: boolean;
  needsConfig?: boolean;
  symbols?: string[];
  symbolAmounts?: Record<string, number | null>;
}) {
  const [draft, setDraft] = useState(
    amount == null ? '' : String(amount).replace('.', ','),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const previous = useRef(amount);
  useEffect(() => {
    const old =
      previous.current == null
        ? ''
        : String(previous.current).replace('.', ',');
    setDraft((current) =>
      current === old
        ? amount == null
          ? ''
          : String(amount).replace('.', ',')
        : current,
    );
    previous.current = amount;
  }, [amount]);
  async function save(value: number | null) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stopRiskAmount: value,
          stopRiskCurrency: value === null ? null : currency,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : 'Não foi possível salvar o stop.',
        );
      setDraft(
        result.stopRiskAmount == null
          ? ''
          : String(result.stopRiskAmount).replace('.', ','),
      );
      setMessage(
        value === null
          ? 'Stop monetário desativado. Novas operações usarão o stop da estratégia.'
          : 'Stop monetário salvo para todas as operações, incluindo posições abertas.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    const value = Number(text.replace(',', '.'));
    if (
      !/^\d+(?:[.,]\d{1,8})?$/.test(text) ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > 999999999
    ) {
      setError('Informe um valor positivo, como 0,269.');
      return;
    }
    void save(value);
  }
  return (
    <>
      <form onSubmit={submit} className="mt-5">
        <label htmlFor="monetary-stop" className="text-sm font-semibold">
          Stop monetário por operação ({currency})
        </label>
        <p id="monetary-stop-help" className="muted my-2 text-xs">
          Risco estimado até o SL, sem comissão, swap ou slippage. Aceita 0,269.
          Se o spread atual mais um tick exigir um stop maior que o valor
          configurado, a entrada é rejeitada para não abrir uma posição que
          seria encerrada imediatamente pelo próprio spread. A entrada também é
          rejeitada se o valor não cobrir um tick executável ou exceder a
          distância máxima. Aplica-se também a todas as posições abertas da
          conta. Stops mais protetores são preservados. Se o limite for atingido
          ou o broker impedir o ajuste, a posição será encerrada.
        </p>
        {needsConfig && (
          <p role="alert" className="red mb-2 text-xs">
            Há um limite monetário salvo para outra moeda. Configure o limite em{' '}
            {currency} ou escolha “Usar stop da estratégia” para esta conta;
            novas entradas ficam bloqueadas até lá.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            id="monetary-stop"
            aria-describedby="monetary-stop-help"
            type="text"
            inputMode="decimal"
            placeholder="0,269"
            required
            value={draft}
            disabled={busy || !connected}
            onChange={(e) => {
              setDraft(e.target.value);
              setMessage('');
            }}
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
          />
          <button type="submit" disabled={busy || !connected} className="btn">
            {busy ? 'Salvando…' : 'Salvar stop'}
          </button>
          {(amount != null || needsConfig) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(null)}
              className="btn"
            >
              Usar stop da estratégia
            </button>
          )}
        </div>
        {!connected && (
          <p className="muted mt-2 text-xs">
            Conecte o MT5 para confirmar a moeda da conta.
          </p>
        )}
        {error && (
          <p role="alert" className="red mt-2 text-xs">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="green mt-2 text-xs">
            {message}
          </p>
        )}
      </form>
      <SymbolMonetaryStops
        symbols={symbols}
        amounts={symbolAmounts}
        currency={currency}
        connected={connected}
        defaultAmount={amount}
      />
    </>
  );
}

function SymbolMonetaryStops({
  symbols,
  amounts,
  currency,
  connected,
  defaultAmount,
}: {
  symbols: string[];
  amounts: Record<string, number | null>;
  currency: string;
  connected: boolean;
  defaultAmount?: number | null;
}) {
  const saved = JSON.stringify(amounts);
  const symbolKey = symbols.join('|');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const symbol of symbols) next[symbol] = formatAmount(amounts[symbol]);
    setDrafts(next);
    // `saved` and `symbolKey` capture the server state and symbol list.
  }, [saved, symbolKey]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const next: Record<string, number> = {};
    for (const symbol of symbols) {
      const text = (drafts[symbol] ?? '').trim();
      if (!text) continue;
      const value = parseAmount(text);
      if (value == null) {
        setError(
          `Valor inválido para ${symbol}. Use um valor positivo, como 2,24.`,
        );
        setBusy(false);
        return;
      }
      next[symbol] = value;
    }
    try {
      const response = await fetch('/api/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopRiskBySymbol: next }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : 'Não foi possível salvar os stops por símbolo.',
        );
      const savedAmounts = (result.stopRiskBySymbol ?? {}) as Record<
        string,
        number | null
      >;
      const updated: Record<string, string> = {};
      for (const symbol of symbols)
        updated[symbol] = formatAmount(savedAmounts[symbol]);
      setDrafts(updated);
      setMessage('Stops por símbolo salvos para novas operações.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  if (!symbols.length) return null;

  return (
    <form onSubmit={save} className="mt-6 border-t border-slate-800 pt-5">
      <h3 className="text-sm font-semibold">Stop por símbolo ({currency})</h3>
      <p className="muted my-2 text-xs">
        Cada valor sobrescreve o stop padrão acima para aquele símbolo. Deixe
        vazio para usar o padrão. Aplica-se a novas entradas e às posições
        abertas do símbolo.
        {defaultAmount == null
          ? ' Padrão atual: stop da estratégia.'
          : ` Padrão atual: ${formatAmount(defaultAmount)}.`}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {symbols.map((symbol) => (
          <label key={symbol} className="block text-xs">
            <span className="font-semibold">{symbol}</span>
            <input
              type="text"
              inputMode="decimal"
              value={drafts[symbol] ?? ''}
              placeholder={
                defaultAmount == null
                  ? 'stop da estratégia'
                  : `padrão ${formatAmount(defaultAmount)}`
              }
              disabled={busy || !connected}
              onChange={(event) => {
                setDrafts((current) => ({
                  ...current,
                  [symbol]: event.target.value,
                }));
                setMessage('');
              }}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !connected} className="btn">
          {busy ? 'Salvando…' : 'Salvar stops por símbolo'}
        </button>
      </div>
      {error && (
        <p role="alert" className="red mt-2 text-xs">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="green mt-2 text-xs">
          {message}
        </p>
      )}
    </form>
  );
}
