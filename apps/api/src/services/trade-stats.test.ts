import { expect, test } from 'bun:test';
import { completedTradeStats } from './trade-stats';

test('win rate is unavailable until a trade closes', () => {
  expect(completedTradeStats(0, 0, 0).winRate).toBeNull();
});
test('win rate includes break-even trades in the denominator', () => {
  expect(completedTradeStats(4, 2, 1)).toEqual({
    closedTrades: 4,
    winningTrades: 2,
    losingTrades: 1,
    winRate: 50,
  });
});
test('completed losses produce a real zero win rate', () => {
  expect(completedTradeStats(3, 0, 3).winRate).toBe(0);
});
