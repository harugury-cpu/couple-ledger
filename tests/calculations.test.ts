import { describe, expect, it } from 'vitest';
import { computeLines, monthTotals, total } from '../src/lib/calculations';
import { januaryFixture } from './fixture';
describe('양식 계산', () => {
  it('고정 소계 1,900, 지출 106,000, 수입 106,100, 잔액 100', () => {
    const f = januaryFixture(); const lines = computeLines(f.lines, f.entries, []);
    expect(total(lines.filter(l => l.section === 'fixed')).actual).toBe(1900);
    expect(monthTotals(lines)).toMatchObject({ expense: { actual: 106000 }, income: { actual: 106100 }, balance: { actual: 100 } });
  });
  it('집계는 행 위치에 의존하지 않는다', () => {
    const f = januaryFixture(); const ordered = computeLines(f.lines, f.entries, []);
    expect(monthTotals(computeLines([...f.lines].reverse(), f.entries, []))).toEqual(monthTotals(ordered));
  });
});
