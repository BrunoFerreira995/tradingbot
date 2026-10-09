import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
const url =
  process.env.DATABASE_URL ??
  'postgres://trader:trader@localhost:5432/tradingbot';
export const sql = postgres(url, { max: 10 });
export const db = drizzle(sql, { schema });
export { schema };
