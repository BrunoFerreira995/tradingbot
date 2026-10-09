import { expect, test } from 'bun:test';
import { signalSchema } from '@trade/shared';
import { verifyWebhook } from './webhook-security';
const config = {
  secret: 'shared-test-secret',
  hmacSecret: 'hmac-test-secret',
  recordNonce: async (_nonce: string) => true,
};
const body = {
  secret: config.secret,
  strategy: 'gold-scalping-v1',
  signalId: 'xau-001',
  symbol: 'XAUUSD',
  action: 'BUY',
  orderType: 'MARKET',
  lots: 0.01,
  stopLoss: 25,
};
test('valid TradingView JSON and shared secret', async () => {
  expect(signalSchema.safeParse(body).success).toBe(true);
  expect(
    await verifyWebhook(body, new Headers(), JSON.stringify(body), config),
  ).toBeNull();
  expect(signalSchema.safeParse({ ...body, action: 'SELL' }).success).toBe(
    true,
  );
  expect(
    signalSchema.safeParse({ ...body, action: 'CLOSE', lots: undefined })
      .success,
  ).toBe(true);
  expect(
    signalSchema.safeParse({ ...body, price: '2650.25' }).data?.price,
  ).toBe(2650.25);
});
test('invalid shared secret and malformed signal', async () => {
  expect(
    await verifyWebhook({ secret: 'bad' }, new Headers(), '{}', config),
  ).toContain('Invalid');
  expect(
    signalSchema.safeParse({ action: 'BUY', symbol: '<script>' }).success,
  ).toBe(false);
  expect(
    signalSchema.safeParse({ ...body, price: 'not-a-price' }).success,
  ).toBe(false);
});
test('invalid, stale and replayed HMAC', async () => {
  const raw = '{"action":"BUY"}';
  const timestamp = String(Date.now());
  const nonce = 'nonce-1';
  const signature = Buffer.from(
    await crypto.subtle.sign(
      'HMAC',
      await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(config.hmacSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
      new TextEncoder().encode(`${timestamp}.${nonce}.${raw}`),
    ),
  ).toString('hex');
  const headers = new Headers({
    'x-tradingview-signature': signature,
    'x-tradingview-timestamp': timestamp,
    'x-tradingview-nonce': nonce,
  });
  expect(await verifyWebhook({}, headers, raw, config)).toBeNull();
  expect(
    await verifyWebhook({}, headers, raw, {
      ...config,
      recordNonce: async () => false,
    }),
  ).toBe('Replay detected');
  headers.set('x-tradingview-signature', 'bad');
  expect(await verifyWebhook({}, headers, raw, config)).toBe('Invalid HMAC');
  headers.set('x-tradingview-timestamp', String(Date.now() - 600000));
  expect(await verifyWebhook({}, headers, raw, config)).toBe('Expired webhook');
});
