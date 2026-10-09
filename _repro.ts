// Reproduces the exact rejection the engine made, from the stored signal row.
import { db, schema } from '@trade/database';
import { eq } from 'drizzle-orm';
import { getSettings } from './apps/api/src/services/settings';

const [signal] = await db
  .select()
  .from(schema.tradingSignals)
  .orderBy(eq(schema.tradingSignals.receivedAt, schema.tradingSignals.receivedAt))
  .limit(1);

const s = await getSettings();
const distance = signal!.stopLoss ?? null;
console.log('sinal gravado :', signal!.signalId);
console.log('stopLoss no sinal :', distance);
console.log('takeProfit        :', signal!.takeProfit);
console.log();
console.log('limites resolvidos pelo settings.ts:');
console.log('  minimumStopDistance :', s.minimumStopDistance);
console.log('  maximumStopDistance :', s.maximumStopDistance);
console.log();
console.log('  distance < minimum ?', distance! < s.minimumStopDistance);
console.log('  distance > maximum ?', distance! > s.maximumStopDistance);
console.log();
console.log('=> primeiro que falha dispara:', distance! < s.minimumStopDistance ? 'MINIMO' : 'MAXIMO');
