import { expect, test } from 'bun:test';
import { AccountExecutionQueue } from './account-execution-queue';

test('decisions for different symbols of one account cannot overlap', async () => {
  const queue = new AccountExecutionQueue();
  let active = 0;
  let maxActive = 0;
  let opened = 7;
  const results = await Promise.all(
    ['EURUSD', 'GBPUSD', 'USDJPY'].map((symbol) =>
      queue.run('demo-account', async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        const observed = opened;
        await new Promise((resolve) => setTimeout(resolve, 1));
        const approved = observed < 8;
        if (approved) opened++;
        active--;
        return { symbol, approved };
      }),
    ),
  );
  expect(maxActive).toBe(1);
  expect(opened).toBe(8);
  expect(results.filter((result) => result.approved)).toHaveLength(1);
});

test('failed decisions release the next operation', async () => {
  const queue = new AccountExecutionQueue();
  const results = await Promise.allSettled([
    queue.run('demo', async () => {
      throw new Error('terminal unavailable');
    }),
    queue.run('demo', async () => 'next decision'),
  ]);
  expect(results[0]?.status).toBe('rejected');
  expect(results[1]).toEqual({ status: 'fulfilled', value: 'next decision' });
});

test('separate accounts do not block one another', async () => {
  const queue = new AccountExecutionQueue();
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.run('account-a', async () => {
    await blocker;
    return 'a';
  });
  expect(await queue.run('account-b', async () => 'b')).toBe('b');
  release();
  expect(await first).toBe('a');
});
