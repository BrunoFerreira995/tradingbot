'use client';
import { useState } from 'react';
type Window = {
  name: string;
  timezone: string;
  start: string;
  end: string;
  enabled?: boolean;
};
const defaults: Window[] = [
  { name: 'SYDNEY', timezone: 'Etc/GMT+3', start: '18:00', end: '03:00' },
  { name: 'ASIA', timezone: 'Etc/GMT+3', start: '21:00', end: '06:00' },
  { name: 'LONDON', timezone: 'Etc/GMT+3', start: '04:00', end: '13:00' },
  { name: 'NEW_YORK', timezone: 'Etc/GMT+3', start: '09:00', end: '18:00' },
];
const labels: Record<string, string> = {
  SYDNEY: 'Sydney',
  ASIA: 'Ásia (Tóquio)',
  LONDON: 'Europa (Londres)',
  NEW_YORK: 'América (Nova York)',
};
export function MarketSessionsControl({ windows }: { windows?: Window[] }) {
  const [draft, setDraft] = useState(() =>
    defaults.map((w) => {
      const saved = windows?.find(
        (v) => v.name === w.name && v.timezone === w.timezone,
      );
      return { ...(saved ?? w), enabled: saved?.enabled !== false };
    }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (draft.some((w) => w.start === w.end)) {
      setError('A abertura deve ser diferente do fechamento.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketSessions: draft }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : 'Não foi possível salvar as sessões.',
        );
      setDraft(result.marketSessions);
      setMessage('Horários e ativação das sessões salvos.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="mt-5">
      <h3 className="text-sm font-semibold">
        Horários das sessões Forex — Brasília (UTC−3)
      </h3>
      <p className="muted my-2 text-xs">
        Novas entradas são permitidas durante qualquer sessão ativada. Se todas
        estiverem desativadas, nenhuma nova entrada será aceita. Posições
        abertas continuam sendo gerenciadas. O fechamento pode ocorrer no dia
        seguinte. Horários fixos em UTC−3: ajuste manualmente quando necessário.
      </p>
      <div className="space-y-2">
        {draft.map((w, index) => (
          <div
            key={w.name}
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <label className="flex w-40 items-center gap-2">
              <input
                type="checkbox"
                checked={w.enabled !== false}
                disabled={busy}
                onChange={(e) => {
                  setDraft((current) =>
                    current.map((v, i) =>
                      i === index ? { ...v, enabled: e.target.checked } : v,
                    ),
                  );
                  setMessage('');
                }}
              />
              {labels[w.name]}
            </label>
            {(['start', 'end'] as const).map((field) => (
              <label key={field} className="text-xs">
                {field === 'start' ? 'Abertura' : 'Fechamento'}
                <input
                  aria-label={`${labels[w.name]} — ${field === 'start' ? 'abertura' : 'fechamento'}`}
                  type="time"
                  required
                  disabled={busy}
                  value={w[field]}
                  onChange={(e) => {
                    setDraft((current) =>
                      current.map((v, i) =>
                        i === index ? { ...v, [field]: e.target.value } : v,
                      ),
                    );
                    setMessage('');
                  }}
                  className="ml-2 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      <button type="submit" disabled={busy} className="btn mt-3">
        {busy ? 'Salvando…' : 'Salvar sessões'}
      </button>
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
