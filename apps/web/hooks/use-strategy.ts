'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StrategyState } from '../lib/api';

/**
 * Polls the runner state.
 *
 * The interval is deliberately short. The runner decides once per closed bar,
 * which on M30 is most of an hour, so a 15s dashboard poll would show the same
 * values for an hour and the countdown to the next bar would be the only thing
 * moving. Five seconds keeps the per-second countdown honest without turning
 * this into a load on the terminal, which the dashboard shares with the runner.
 */
export function useStrategy() {
  const [state, setState] = useState<StrategyState | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/data/strategy', {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`API ${response.status}`);
        const json = (await response.json()) as StrategyState;
        if (active.current) {
          setState(json);
          setError('');
        }
      } catch (e) {
        if (active.current)
          setError(e instanceof Error ? e.message : 'Connection error');
      }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, []);

  const setTimeframe = useCallback(async (timeframe: string) => {
    setSaving(true);
    try {
      const response = await fetch('/api/strategy', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ timeframe }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error ?? `API ${response.status}`);
      if (active.current) setState(json as StrategyState);
      return true;
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : 'Connection error');
      return false;
    } finally {
      if (active.current) setSaving(false);
    }
  }, []);

  return { state, error, saving, setTimeframe };
}
