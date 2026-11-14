import { MT5BrokerAdapter } from '@trade/broker';
import type { Rate, Timeframe } from '@trade/shared';

const primary = process.env.MT5_PRIMARY_SYMBOL ?? 'XAUUSD';
const symbols = [...new Set([primary, ...(process.env.MT5_SYMBOLS ?? primary).split(',')].map((s) => s.trim()).filter(Boolean))];
const broker = new MT5BrokerAdapter({ symbols,
  ...(process.env.MT5_BRIDGE_DIR ? { directory: process.env.MT5_BRIDGE_DIR } : {}),
});
const rates: Record<string, Record<string, Rate[]>> = {};
const costs: Record<string, { spread: number; tickSize: number; tickValue: number; tickValueLoss: number }> = {};
const errors: string[] = [];
await broker.connect();
try {
  const account = await broker.getAccount();
  if (account.currency !== 'USD') throw new Error('Benchmark expects USD account tick values');
  for (const symbol of symbols) {
    try {
      const info = await broker.getSymbol(symbol);
      const price = await broker.getPrice(symbol);
      const spread = Math.max(price.spread, price.ask - price.bid);
      const tickValueLoss = info.tickValueLoss ?? info.tickValue;
      if (![spread, info.tickSize, info.tickValue, tickValueLoss].every(Number.isFinite) || spread < 0 || info.tickSize <= 0 || info.tickValue <= 0 || tickValueLoss <= 0)
        throw new Error('Missing or invalid tick specification/quote');
      costs[symbol] = { spread, tickSize: info.tickSize, tickValue: info.tickValue, tickValueLoss };
      for (const timeframe of ['M1', 'M5', 'M15', 'M30', 'H1'] as Timeframe[]) {
        try {
          const bars = await broker.getRates(symbol, timeframe, 1000);
          (rates[timeframe] ??= {})[symbol] = bars;
          console.log(`${symbol} ${timeframe}: ${bars.length} candles`);
        } catch (error) { errors.push(`${symbol} ${timeframe}: ${String(error)}`); }
      }
    } catch (error) { errors.push(`${symbol}: ${String(error)}`); }
  }
  await Bun.write(new URL('market-forces-current-data-2026-11-13.json', import.meta.url),
    JSON.stringify({ collectedAt: new Date().toISOString(), currency: account.currency, symbols, costs, rates, errors }, null, 2));
  console.log(`Collection finished; ${errors.length} errors.`);
  for (const error of errors) console.log(error);
} finally { await broker.disconnect(); }
