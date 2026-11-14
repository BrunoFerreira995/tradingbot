import type { Rate } from '@trade/shared';
import { atr, sma } from './indicators';
import { evaluateDowTheory } from './dow-theory';

export interface MarketForcesReading {
  direction: 'UP' | 'DOWN' | 'NEUTRAL' | 'NOT_READY';
  structure: 'UP' | 'DOWN' | 'RANGE' | 'NOT_READY';
  pressure: 'BUY' | 'SELL' | 'BALANCED';
  friction: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';
  action: 'BUY' | 'SELL' | 'WAIT';
  /** Descriptive score, not a probability. */
  frictionScore: number | null;
  efficiency: number | null;
  overlap: number | null;
  upperRejection: number | null;
  lowerRejection: number | null;
  reasons: string[];
}

/** OHLC proxies for competing forces, never order-flow or calibrated probabilities.
 * Input is oldest first, including a final forming candle that is excluded. */
export function evaluateMarketForces(rates: readonly Rate[]): MarketForcesReading {
  const empty: MarketForcesReading = {
    direction: 'NOT_READY', structure: 'NOT_READY', pressure: 'BALANCED',
    friction: 'UNKNOWN', action: 'WAIT', frictionScore: null, efficiency: null,
    overlap: null, upperRejection: null, lowerRejection: null,
    reasons: ['Histórico insuficiente ou inválido; aguardar candles fechados.'],
  };
  const bars = rates.slice(0, -1).slice(-60);
  if (bars.length < 41 || bars.some((b, i) =>
    ![b.o, b.h, b.l, b.c, b.t].every(Number.isFinite) ||
    b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c) ||
    (i > 0 && b.t <= bars[i - 1]!.t))) return empty;
  const closes = bars.map((b) => b.c);
  const fast = sma(closes, 9).at(-1)!;
  const slowSeries = sma(closes, 40);
  const slow = slowSeries.at(-1)!;
  const previousSlow = slowSeries.at(-2)!;
  const volatility = atr(bars, 14).at(-1);
  if (volatility == null || volatility <= 0) return empty;
  const direction = Math.abs(fast - slow) <= volatility * 0.1 ? 'NEUTRAL'
    : fast > slow && slow > previousSlow ? 'UP'
    : fast < slow && slow < previousSlow ? 'DOWN' : 'NEUTRAL';
  const structure = evaluateDowTheory(rates).trend;
  const window = bars.slice(-10);
  let path = 0, overlap = 0, upper = 0, lower = 0, pressureSum = 0;
  for (let i = 0; i < window.length; i++) {
    const b = window[i]!;
    const range = b.h - b.l;
    upper += range > 0 ? (b.h - Math.max(b.o, b.c)) / range : 0;
    lower += range > 0 ? (Math.min(b.o, b.c) - b.l) / range : 0;
    pressureSum += range > 0 ? (b.c - b.o) / range : 0;
    if (i > 0) {
      const previous = window[i - 1]!;
      path += Math.abs(b.c - previous.c);
      const union = Math.max(b.h, previous.h) - Math.min(b.l, previous.l);
      overlap += union > 0 ? Math.max(0, Math.min(b.h, previous.h) - Math.max(b.l, previous.l)) / union : 1;
    }
  }
  const efficiency = path > 0 ? Math.abs(window.at(-1)!.c - window[0]!.c) / path : 0;
  overlap /= window.length - 1;
  upper /= window.length;
  lower /= window.length;
  const pressure = pressureSum / window.length > 0.15 ? 'BUY'
    : pressureSum / window.length < -0.15 ? 'SELL' : 'BALANCED';
  const conflict = direction === 'NEUTRAL' || structure === 'RANGE' || structure === 'NOT_READY' ||
    direction !== structure || (direction === 'UP' && pressure === 'SELL') ||
    (direction === 'DOWN' && pressure === 'BUY');
  const rejection = direction === 'UP' ? upper : direction === 'DOWN' ? lower : Math.max(upper, lower);
  const frictionScore = Math.round(100 * (0.4 * (1 - efficiency) + 0.25 * overlap + 0.2 * rejection + 0.15 * Number(conflict)));
  const friction = frictionScore >= 60 ? 'HIGH' : frictionScore >= 35 ? 'MODERATE' : 'LOW';
  const action = friction === 'LOW' && !conflict && direction === 'UP' && pressure === 'BUY' ? 'BUY'
    : friction === 'LOW' && !conflict && direction === 'DOWN' && pressure === 'SELL' ? 'SELL' : 'WAIT';
  return {
    direction, structure, pressure, friction, action, frictionScore, efficiency,
    overlap, upperRejection: upper, lowerRejection: lower,
    reasons: [
      direction === 'UP' ? 'Médias e inclinação favorecem alta.' : direction === 'DOWN' ? 'Médias e inclinação favorecem baixa.' : 'Médias próximas ou inclinação sem confirmação.',
      conflict ? 'Estrutura ou pressão sem alinhamento com a direção.' : 'Estrutura e pressão sem oposição à direção.',
      `Eficiência ${(efficiency * 100).toFixed(0)}%; sobreposição ${(overlap * 100).toFixed(0)}%; rejeição contrária ${(rejection * 100).toFixed(0)}%.`,
      action === 'WAIT' ? 'Aguardar confirmação; leitura analítica sem ordem automática.' : 'Condições favorecem continuação; confirmar entrada pela estratégia.',
    ],
  };
}
