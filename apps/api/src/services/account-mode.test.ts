import { describe, expect, test } from 'bun:test';
import { resolveAccountMode } from './account-mode';

describe('automatic MetaTrader account mode', () => {
  test('auto accepts demo and contest without a real-account acknowledgement', () => {
    expect(resolveAccountMode({ tradeMode: 0, login: 123 }, 'auto', '999')).toBe('paper');
    expect(resolveAccountMode({ tradeMode: 1, login: 123 }, 'auto', undefined)).toBe('paper');
  });
  test('auto accepts only the acknowledged real account', () => {
    expect(resolveAccountMode({ tradeMode: 2, login: 456 }, 'auto', '456')).toBe('live');
    expect(() => resolveAccountMode({ tradeMode: 2, login: 456 }, 'auto', '123')).toThrow('MT5_LIVE_ACK');
  });
  test('explicit legacy modes remain strict', () => {
    expect(() => resolveAccountMode({ tradeMode: 0, login: 123 }, 'live', '123')).toThrow('TRADING_MODE');
    expect(() => resolveAccountMode({ tradeMode: 2, login: 123 }, 'paper', '123')).toThrow('TRADING_MODE');
  });
  test('unknown account modes and logins fail closed', () => {
    expect(() => resolveAccountMode({ tradeMode: 3, login: 123 }, 'auto', '123')).toThrow('Unknown');
    expect(() => resolveAccountMode({ tradeMode: 0, login: 0 }, 'auto', undefined)).toThrow('Invalid');
  });
});
