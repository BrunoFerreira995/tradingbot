import { timingSafeEqual } from 'node:crypto';
export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export async function verifyWebhook(
  body: unknown,
  headers: Headers,
  raw: string,
  config: {
    secret: string;
    hmacSecret: string;
    recordNonce: (nonce: string) => Promise<boolean>;
  },
): Promise<string | null> {
  const payload =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const supplied =
    headers.get('x-webhook-secret') ??
    (typeof payload.secret === 'string' ? payload.secret : '');
  const signature = headers.get('x-tradingview-signature') ?? '';
  const timestamp = headers.get('x-tradingview-timestamp') ?? '';
  const nonce = headers.get('x-tradingview-nonce') ?? '';
  if (
    !signature &&
    !timestamp &&
    !nonce &&
    config.secret &&
    safeEqual(supplied, config.secret)
  )
    return null;
  if (!config.hmacSecret || !signature || !timestamp || !nonce)
    return 'Invalid webhook credentials';
  const time = Number(timestamp);
  if (!Number.isFinite(time) || Math.abs(Date.now() - time) > 300000)
    return 'Expired webhook';
  const expected = Buffer.from(
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
  if (!safeEqual(signature.replace(/^sha256=/, ''), expected))
    return 'Invalid HMAC';
  return (await config.recordNonce(nonce)) ? null : 'Replay detected';
}
