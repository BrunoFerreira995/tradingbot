import { TREND_FOREX_SYMBOLS } from '../packages/strategy/src/diversified-trend';

// Two warm-up years precede the 2016–2025 evaluation window.
for (let i = 0; i < TREND_FOREX_SYMBOLS.length; i += 3) {
  await Promise.all(TREND_FOREX_SYMBOLS.slice(i, i + 3).map(async (symbol) => {
    const output = new URL(`trend-${symbol.toLowerCase()}-d1-2014-2025.json`, import.meta.url);
    if (await Bun.file(output).exists()) { console.log(`Using cached ${symbol}`); return; }
    const child = Bun.spawn(['npx', '--yes', 'dukascopy-node@1.51.1', '-i', symbol.toLowerCase(),
      '-from', '2014-01-01', '-to', '2026-01-01', '-t', 'd1', '-p', 'bid', '-f', 'json', '-v',
      '-dir', new URL('./', import.meta.url).pathname, '-fn', `trend-${symbol.toLowerCase()}-d1-2014-2025`,
      '-bs', '3', '-bp', '1000', '--retries', '2'], { stdout: 'inherit', stderr: 'inherit' });
    if (await child.exited !== 0) throw new Error(`Download failed: ${symbol}`);
  }));
}
