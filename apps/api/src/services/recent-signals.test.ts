import { expect, test } from 'bun:test';
import { attachSignalReasons } from './recent-signals';

test('shows historical local rejection reasons without replaying the signal', () => {
  const [signal] = attachSignalReasons(
    [{ signalId: 'recent', status: 'REJECTED' }],
    [
      {
        event: 'rejected',
        details: {
          signalId: 'recent',
          reason: 'Maximum open positions exceeded',
        },
      },
    ],
  );
  expect(signal).toMatchObject({
    reason: 'Maximum open positions exceeded',
    reasonSource: 'risk',
  });
});

test('preserves the terminal source and newest outcome', () => {
  const [signal] = attachSignalReasons(
    [{ signalId: 'recent', status: 'REJECTED' }],
    [
      {
        event: 'rejected',
        details: {
          signalId: 'recent',
          reason: 'MetaTrader: No money',
          source: 'MetaTrader.OrderSend',
        },
      },
      {
        event: 'rejected',
        details: { signalId: 'recent', reason: 'older reason' },
      },
    ],
  );
  expect(signal).toMatchObject({
    reason: 'MetaTrader: No money',
    reasonSource: 'MetaTrader.OrderSend',
  });
});

test('does not attach another signal reason or an old failure to executed signals', () => {
  const results = attachSignalReasons(
    [
      { signalId: 'filled', status: 'EXECUTED' },
      { signalId: 'other', status: 'REJECTED' },
    ],
    [
      {
        event: 'failed',
        details: { signalId: 'filled', reason: 'earlier failure' },
      },
    ],
  );
  expect(results[0]?.reason).toBeUndefined();
  expect(results[1]?.reason).toBeUndefined();
});
