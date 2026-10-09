'use client';
import { useEffect, useState } from 'react';
import type { DashboardData } from '../lib/api';
export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let latestOpenPnl: number | undefined;
    const refresh = async () => {
      try {
        const response = await fetch('/api/data/dashboard', {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`API ${response.status}`);
        const json = (await response.json()) as DashboardData;
        if (active) {
          setData(
            latestOpenPnl === undefined
              ? json
              : {
                  ...json,
                  stats: { ...json.stats, openPnl: latestOpenPnl },
                },
          );
          setError('');
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : 'Connection error');
      }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    const events = new EventSource('/api/data/events/stream');
    events.onmessage = () => {
      void refresh();
    };
    const pnlEvents = new EventSource('/api/data/open-pnl/stream');
    pnlEvents.onmessage = (event) => {
      if (!active) return;
      try {
        const { openPnl } = JSON.parse(event.data) as { openPnl: number };
        if (!Number.isFinite(openPnl)) return;
        latestOpenPnl = openPnl;
        setData((current) =>
          current && current.stats.openPnl !== openPnl
            ? {
                ...current,
                stats: { ...current.stats, openPnl },
              }
            : current,
        );
      } catch {
        // EventSource reconnects automatically; ignore malformed frames.
      }
    };
    return () => {
      active = false;
      clearInterval(timer);
      events.close();
      pnlEvents.close();
    };
  }, []);
  return { data, error };
}
