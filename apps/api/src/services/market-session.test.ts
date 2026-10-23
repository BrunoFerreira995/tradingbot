import { expect, test } from 'bun:test';
import {
  marketSession as classify,
  validateMarketWindows,
  sessionEntryAllowed,
} from './market-session';

const legacyWindows = [
  { name: 'ASIA', timezone: 'Asia/Tokyo', start: '09:00', end: '18:00' },
  { name: 'LONDON', timezone: 'Europe/London', start: '08:00', end: '17:00' },
  {
    name: 'NEW_YORK',
    timezone: 'America/New_York',
    start: '08:00',
    end: '17:00',
  },
];
const marketSession = (at: string, windows = legacyWindows) =>
  classify(at, windows);

test('Brasilia defaults include Sydney, overnight sessions and fixed UTC offset', () => {
  expect(classify('2026-10-23T21:00:00Z')).toBe('SYDNEY');
  expect(classify('2026-10-24T00:00:00Z')).toBe('SYDNEY+ASIA');
  expect(classify('2026-10-23T07:00:00Z')).toBe('ASIA+LONDON');
  expect(classify('2026-10-23T12:00:00Z')).toBe('LONDON+NEW_YORK');
  expect(classify('2026-10-23T16:00:00Z')).toBe('NEW_YORK');
  expect(classify('2026-11-03T12:00:00Z')).toBe('LONDON+NEW_YORK');
});
test('edited hours change classification and exclude closing boundary', () => {
  const windows = validateMarketWindows([
    { name: 'SYDNEY', timezone: 'Etc/GMT+3', start: '19:00', end: '02:00' },
  ]);
  expect(classify('2026-10-23T21:00:00Z', windows)).toBe('OFF_SESSION');
  expect(classify('2026-10-23T22:00:00Z', windows)).toBe('SYDNEY');
  expect(classify('2026-10-24T05:00:00Z', windows)).toBe('OFF_SESSION');
});

test('accounts for independent US and UK daylight-saving transitions and overlaps', () => {
  expect(marketSession('2026-01-15T12:30:00Z')).toBe('LONDON');
  expect(marketSession('2026-03-10T12:30:00Z')).toBe('LONDON+NEW_YORK');
  expect(marketSession('2026-03-31T12:30:00Z')).toBe('LONDON+NEW_YORK');
  expect(marketSession('2026-10-27T12:30:00Z')).toBe('LONDON+NEW_YORK');
  expect(marketSession('2026-11-03T12:30:00Z')).toBe('LONDON');
  expect(marketSession('2026-01-15T07:00:00Z')).toBe('ASIA');
  expect(marketSession('2026-07-15T07:00:00Z')).toBe('ASIA+LONDON');
});

test('uses local weekday, excludes closing boundary and supports overnight configurable sessions', () => {
  expect(marketSession('2026-10-17T12:00:00Z')).toBe('OFF_SESSION');
  expect(marketSession('2026-01-15T22:00:00Z')).toBe('OFF_SESSION');
  const windows = validateMarketWindows([
    { name: 'OVERNIGHT', timezone: 'Asia/Tokyo', start: '22:00', end: '06:00' },
  ]);
  expect(marketSession('2026-10-16T18:00:00Z', windows)).toBe('OVERNIGHT');
  expect(marketSession('2026-10-17T18:00:00Z', windows)).toBe('OFF_SESSION');
  expect(marketSession('invalid')).toBeUndefined();
  expect(() =>
    validateMarketWindows([
      { name: 'ASIA', timezone: 'Invalid/Zone', start: '09:00', end: '18:00' },
    ]),
  ).toThrow();
  expect(() =>
    validateMarketWindows([
      { name: 'ASIA', timezone: 'Asia/Tokyo', start: '25:00', end: '18:00' },
    ]),
  ).toThrow();
});

test('entry gates honor enabled sessions, overlaps and all disabled', () => {
  const windows = [
    {
      name: 'LONDON',
      timezone: 'Etc/GMT+3',
      start: '04:00',
      end: '13:00',
      enabled: false,
    },
    {
      name: 'NEW_YORK',
      timezone: 'Etc/GMT+3',
      start: '09:00',
      end: '18:00',
      enabled: true,
    },
  ];
  expect(sessionEntryAllowed('BUY', '2026-10-23T11:00:00Z', windows)).toBe(
    false,
  );
  expect(sessionEntryAllowed('SELL', '2026-10-23T12:00:00Z', windows)).toBe(
    true,
  );
  expect(sessionEntryAllowed('BUY', '2026-10-23T21:00:00Z', windows)).toBe(
    false,
  );
  const disabled = windows.map((w) => ({ ...w, enabled: false }));
  expect(sessionEntryAllowed('BUY', '2026-10-23T12:00:00Z', disabled)).toBe(
    false,
  );
  for (const action of ['CLOSE', 'CLOSE_LONG', 'CLOSE_SHORT'])
    expect(sessionEntryAllowed(action, '2026-10-23T12:00:00Z', disabled)).toBe(
      true,
    );
});

test('entry gates support overnight sessions and existing settings without enabled', () => {
  const windows = [
    { name: 'SYDNEY', timezone: 'Etc/GMT+3', start: '18:00', end: '03:00' },
  ];
  expect(sessionEntryAllowed('BUY', '2026-10-24T01:00:00Z', windows)).toBe(
    true,
  );
  expect(sessionEntryAllowed('BUY', '2026-10-24T06:00:00Z', windows)).toBe(
    false,
  );
  expect(() =>
    validateMarketWindows([{ ...windows[0], enabled: 'false' }]),
  ).toThrow();
});
