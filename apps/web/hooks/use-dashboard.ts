'use client';
import { useEffect, useState } from 'react';
import type { DashboardData, LiveTradingData } from '../lib/api';
const applyTradingData = (
  data: DashboardData,
  live: LiveTradingData,
): DashboardData => ({
  ...data,
  account: live.account,
  positions: live.positions,
  price: live.price,
  brokerConnected: live.brokerConnected,
  stats: { ...data.stats, openPnl: live.openPnl },
});
export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let latestTradingData: LiveTradingData | undefined;
    const refresh = async () => {
      try {
        const response = await fetch('/api/data/dashboard', {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`API ${response.status}`);
        const json = (await response.json()) as DashboardData;
        if (active) {
          if (!json.brokerConnected) latestTradingData = undefined;
          setData(
            latestTradingData === undefined
              ? json
              : applyTradingData(json, latestTradingData),
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
        const live = JSON.parse(event.data) as LiveTradingData;
        if (
          !Number.isFinite(live.openPnl) ||
          !Array.isArray(live.positions) ||
          !live.account
        )
          return;
        latestTradingData = live;
        setData((current) =>
          current ? applyTradingData(current, live) : current,
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
