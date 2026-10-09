import { db, schema } from '@trade/database';
type Listener = (event: {
  type: string;
  payload: Record<string, unknown>;
  at: string;
}) => void;
const listeners = new Set<Listener>();
export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export async function emit(type: string, payload: Record<string, unknown>) {
  const event = { type, payload, at: new Date().toISOString() };
  await db.insert(schema.systemEvents).values({ type, payload });
  for (const listener of listeners) listener(event);
}
export async function audit(
  category: string,
  event: string,
  requestId?: string,
  ip?: string,
  details?: Record<string, unknown>,
) {
  await db
    .insert(schema.auditLogs)
    .values({ category, event, requestId, ip, details });
}
