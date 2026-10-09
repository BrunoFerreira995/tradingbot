import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/database/src/schema.ts',
  out: './packages/database/drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://trader:trader@localhost:5432/tradingbot',
  },
});
