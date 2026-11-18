import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './index';
import { strategies } from './schema';

export async function runMigrations(
  migrationsFolder = process.env.MIGRATIONS_DIR ??
    './packages/database/drizzle',
  seed = true,
) {
  await migrate(db, { migrationsFolder });
  if (seed)
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
}

if (import.meta.main) {
  await runMigrations();
  await sql.end();
  console.log('Migrations complete');
}
