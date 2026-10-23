'use client';
import { useEffect, useRef, useState } from 'react';

export function MonetaryStopControl({
  amount,
  currency,
  connected,
}: {
  amount?: number | null;
  currency: string;
  connected: boolean;
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
    <form onSubmit={submit} className="mt-5">
      <label htmlFor="monetary-stop" className="text-sm font-semibold">
        Stop monetário por operação ({currency})
      </label>
      <p id="monetary-stop-help" className="muted my-2 text-xs">
        Risco estimado até o SL, sem comissão, swap ou slippage. Aceita 0,269.
        Se o lote ou o stop mínimo do broker impedir esse valor, a nova entrada
        será rejeitada. Aplica-se também a todas as posições abertas da conta.
        Stops mais protetores são preservados. Se o limite for atingido ou o
        broker impedir o ajuste, a posição será encerrada.
      </p>
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
        {amount != null && (
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
  );
}
