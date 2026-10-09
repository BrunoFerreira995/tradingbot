import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './index';
import { strategies } from './schema';
await migrate(db, { migrationsFolder: './packages/database/drizzle' });
await db
  .insert(strategies)
  .values({
    name: 'gold-scalping-v1',
    description:
      'Technical TradingView integration example. No profitability claim.',
    allowedSymbols: ['XAUUSD'],
    enabled: true,
  })
  .onConflictDoNothing();
await sql.end();
console.log('Migrations complete');
