import { expect, test } from 'bun:test';
import { priceGeometry } from './price-geometry';
const bars = (values: number[]) => values.map((c, t) => ({ t, o: c, h: c, l: c, c, v: 1 }));
test('straight line has unit efficiency, known slope and zero turning determinant', () => {
  const g = priceGeometry(bars([0, 2, 4, 6, 8]), 5, 2)!;
  expect(g.slope).toBeCloseTo(1);
  expect(g.efficiency).toBe(1);
  expect(g.determinant).toBeCloseTo(0);
});
test('acceleration sign reverses when price is mirrored', () => {
  const values = [0, 1, 2, 4, 8];
  const a = priceGeometry(bars(values), 5, 1)!;
  const b = priceGeometry(bars(values.map((v) => -v)), 5, 1)!;
  expect(a.determinant).toBeGreaterThan(0);
  expect(b.determinant).toBeCloseTo(-a.determinant);
  expect(Math.abs(a.determinant)).toBeLessThanOrEqual(1);
});
test('translation and simultaneous price/ATR scaling preserve features', () => {
  const a = priceGeometry(bars([0, 1, 2, 4, 8]), 5, 2)!;
  const b = priceGeometry(bars([100, 103, 106, 112, 124]), 5, 6)!;
  expect(b.slope).toBeCloseTo(a.slope);
  expect(b.determinant).toBeCloseTo(a.determinant);
  expect(b.efficiency).toBeCloseTo(a.efficiency);
});
test('flat path and invalid inputs are explicit', () => {
  expect(priceGeometry(bars([1, 1, 1, 1]), 4, 1)?.efficiency).toBe(0);
  expect(priceGeometry(bars([1, 2, 3, 4]), 4, 0)).toBeNull();
});
