import { expect, test } from 'vitest';
import { moneyFormula, parseMoney } from '../src/lib/validation';
import { computeLines } from '../src/lib/calculations';

test('여러 기록의 합은 = a + b + c 식으로 보이고, 그 식을 그대로 읽으면 같은 합계다', () => {
  const text = moneyFormula([12000, 8500, -500]);
  expect(text).toBe('=12,000 + 8,500 - 500');
  expect(parseMoney(text, true)).toBe(20000);
  expect(parseMoney('=1000+2000')).toBe(3000);
  expect(() => parseMoney('=1000*2')).toThrow('식은');
  expect(() => parseMoney('=100-500')).toThrow();
});

test('금액 칸의 parts는 기록을 넣은 순서다', () => {
  const line = { id: 'a', budget: 0 } as Parameters<typeof computeLines>[0][number];
  const entry = (id: string, amount: number, created_at: string) => ({ id, month_line_id: 'a', amount, created_at }) as Parameters<typeof computeLines>[1][number];
  const [computed] = computeLines([line], [entry('2', 8500, '2026-11-02'), entry('1', 12000, '2026-11-01')], []);
  expect(computed.parts).toEqual([12000, 8500]);
  expect(computed.actual).toBe(20500);
});
