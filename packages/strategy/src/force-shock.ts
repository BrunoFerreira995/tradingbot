import type { Rate } from '@trade/shared';
import { atr } from './indicators';
import { evaluateMarketForces } from './market-forces';
import { priceGeometry } from './price-geometry';

export interface ForceShockConfig {
  threshold: number;
  /** Window including the shock candle: 3 blocks that candle and the next two. */
  cooldownBars: number;
}
export const defaultForceShockConfig: ForceShockConfig = { threshold: 1.18, cooldownBars: 3 };
export interface ForceShockReading {
  ready: boolean;
  index: number | null;
  priorDirection: 'UP' | 'DOWN' | 'NEUTRAL';
  accelerationAtr: number | null;
  opposingBody: number | null;
  determinant: number | null;
}

/** Input ends in a forming candle. ATR and geometry end BEFORE the shock candle;
 * neither its volatility nor any unfinished prices enter the reference. */
export function evaluateForceShock(rates: readonly Rate[]): ForceShockReading {
  const empty: ForceShockReading = { ready: false, index: null, priorDirection: 'NEUTRAL',
    accelerationAtr: null, opposingBody: null, determinant: null };
  const closed = rates.slice(0, -1).slice(-120);
  if (closed.length < 42 || closed.some((b, i) =>
    ![b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) ||
    b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c) ||
    (i > 0 && b.t <= closed[i - 1]!.t))) return empty;
  const last = closed.at(-1)!;
  const prior = closed.slice(0, -1);
  const volatility = atr(prior, 14).at(-1);
  if (volatility == null || !Number.isFinite(volatility) || volatility <= 0) return empty;
  const geometry = priceGeometry(prior, 16, volatility);
  if (!geometry) return empty;
  const direction = geometry.slope > 0 ? 1 : geometry.slope < 0 ? -1 : 0;
  const previous = prior.at(-1)!, before = prior.at(-2)!;
  const velocityNow = (last.c - previous.c) / volatility;
  const accelerationAtr = velocityNow - (previous.c - before.c) / volatility;
  const range = last.h - last.l;
  const opposingBody = range > 0 ? Math.max(0, -direction * (last.c - last.o) / range) : 0;
  const opposing = direction !== 0 && velocityNow * direction < 0 && Math.abs(geometry.slope) >= 0.03;
  const magnitude = opposing ? Math.max(0, -direction * accelerationAtr) : 0;
  return { ready: true, index: magnitude * (0.5 + 0.5 * opposingBody),
    priorDirection: direction > 0 ? 'UP' : direction < 0 ? 'DOWN' : 'NEUTRAL',
    accelerationAtr, opposingBody, determinant: geometry.determinant };
}

export function evaluateForceShockStrategy(rates: readonly Rate[], overrides: Partial<ForceShockConfig> = {}) {
  const config = { ...defaultForceShockConfig, ...overrides };
  if (!Number.isFinite(config.threshold) || config.threshold <= 0 ||
    !Number.isInteger(config.cooldownBars) || config.cooldownBars < 1 || config.cooldownBars > 20)
    throw new Error('Invalid force shock configuration');
  const forces = evaluateMarketForces(rates);
  const shock = evaluateForceShock(rates);
  let cooldownRemaining = 0;
  let strongestRecentShock = 0;
  let ready = shock.ready;
  for (let age = 0; age < config.cooldownBars; age++) {
    const reading = age === 0 ? shock : evaluateForceShock(rates.slice(0, rates.length - age));
    ready &&= reading.ready;
    if (reading.index !== null && reading.index >= config.threshold) {
      cooldownRemaining = Math.max(cooldownRemaining, config.cooldownBars - age);
      strongestRecentShock = Math.max(strongestRecentShock, reading.index);
    }
  }
  const blocked = !ready || cooldownRemaining > 0;
  const reason = !ready ? 'Choque: histórico insuficiente ou inválido; aguardar.'
    : cooldownRemaining > 0 ? `Choque forte ${strongestRecentShock.toFixed(2)} ≥ ${config.threshold}; bloqueio por ${cooldownRemaining} candle(s), incluindo o atual.`
    : `Sem choque forte nos últimos ${config.cooldownBars} candles fechados.`;
  return { forces, shock, config, ready, blocked, cooldownRemaining, strongestRecentShock, reason,
    action: blocked ? 'WAIT' as const : forces.action };
}
export type ForceShockStrategyReading = ReturnType<typeof evaluateForceShockStrategy>;
