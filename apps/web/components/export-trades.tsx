'use client';
import { useState } from 'react';

export function ExportTrades() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download(kind: 'trades' | 'bot-sessions') {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/data/${kind}/export`);
      if (!response.ok)
        throw new Error('Could not export trades. Please try again.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `all-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not export trades.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => download('trades')}
        disabled={busy}
        className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5 disabled:opacity-50"
      >
        {busy ? 'Exporting…' : 'Export all trades (CSV)'}
      </button>
      <button
        type="button"
        onClick={() => download('bot-sessions')}
        disabled={busy}
        className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5 disabled:opacity-50"
      >
        Export bot sessions (CSV)
      </button>
    </div>
  );
}
