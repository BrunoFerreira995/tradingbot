export interface MarketWindow {
  name: string;
  timezone: string;
  start: string;
  end: string;
  weekdays?: number[];
  enabled?: boolean;
}
export const defaultMarketWindows: MarketWindow[] = [
  { name: 'SYDNEY', timezone: 'Etc/GMT+3', start: '18:00', end: '03:00' },
  { name: 'ASIA', timezone: 'Etc/GMT+3', start: '21:00', end: '06:00' },
  { name: 'LONDON', timezone: 'Etc/GMT+3', start: '04:00', end: '13:00' },
  { name: 'NEW_YORK', timezone: 'Etc/GMT+3', start: '09:00', end: '18:00' },
];
const minutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export function validateMarketWindows(value: unknown): MarketWindow[] {
  if (!Array.isArray(value))
    throw new Error('MARKET_SESSIONS must be an array');
  const names = new Set<string>();
  for (const window of value) {
    if (
      !window ||
      typeof window.name !== 'string' ||
      !/^[A-Z][A-Z0-9_]*$/.test(window.name) ||
      names.has(window.name) ||
      typeof window.timezone !== 'string' ||
      ![window.start, window.end].every(
        (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t),
      ) ||
      window.start === window.end ||
      (window.enabled !== undefined && typeof window.enabled !== 'boolean') ||
      (window.weekdays !== undefined &&
        (!Array.isArray(window.weekdays) ||
          !window.weekdays.every(
            (day: unknown) =>
              Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6,
          )))
    )
      throw new Error('Invalid MARKET_SESSIONS window');
    new Intl.DateTimeFormat('en', { timeZone: window.timezone });
    names.add(window.name);
  }
  return value;
}
export const marketWindows = validateMarketWindows(
  process.env.MARKET_SESSIONS
    ? JSON.parse(process.env.MARKET_SESSIONS)
    : defaultMarketWindows,
);
const dayNumbers: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Labels local trading windows, including overlaps; these are not exchange calendars. */
export function marketSession(
  at: string | number | Date,
  windows = marketWindows,
): string | undefined {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return undefined;
  const active = windows.filter((window) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: window.timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    const now = Number(get('hour')) * 60 + Number(get('minute'));
    const start = minutes(window.start),
      end = minutes(window.end);
    const overnight = start > end;
    const inWindow = overnight
      ? now >= start || now < end
      : now >= start && now < end;
    const localDay = dayNumbers[get('weekday')]!;
    const startDay = overnight && now < end ? (localDay + 6) % 7 : localDay;
    return inWindow && (window.weekdays ?? [1, 2, 3, 4, 5]).includes(startDay);
  });
  return active.length ? active.map((w) => w.name).join('+') : 'OFF_SESSION';
}

/** Closing and protective management remain available outside entry windows. */
export function sessionEntryAllowed(
  action: string,
  at: string | number | Date,
  windows: MarketWindow[],
): boolean {
  if (action.startsWith('CLOSE')) return true;
  const active = marketSession(
    at,
    windows.filter((window) => window.enabled !== false),
  );
  return active !== undefined && active !== 'OFF_SESSION';
}
