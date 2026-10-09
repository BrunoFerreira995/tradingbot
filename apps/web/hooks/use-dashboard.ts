'use client';
import { useEffect, useState } from 'react';
import type { DashboardData } from '../lib/api';
export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/data/dashboard', {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`API ${response.status}`);
        const json = (await response.json()) as DashboardData;
        if (active) {
          setData(json);
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
    return () => {
      active = false;
      clearInterval(timer);
      events.close();
    };
  }, []);
  return { data, error };
}
