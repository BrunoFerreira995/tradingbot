/**
 * Test doubles for broker behaviour.
 *
 * Kept behind a separate entry point so the application's import graph never
 * reaches an in-memory broker by accident. `@trade/broker` is real brokers only.
 */
export { InMemoryBrokerAdapter } from './in-memory-broker';
