import { afterEach, expect, it } from 'vitest';
import { annualCategories, computeLines, savingsRows } from '../src/lib/calculations';
import { categoryNames } from '../src/db/seed';
import { januaryFixture } from './fixture';
import { Ledger } from '../src/db/ledger';
let l: Ledger;
afterEach(() => l?.client.close());
it('카테고리 합계는 양식의 106,000원과 일치한다', () => {
  const f = januaryFixture(); const rows = annualCategories(computeLines(f.lines, f.entries, []), categoryNames.map((name, sort) => ({ id: `category-${sort}`, name, sort })), 1);
  expect(rows.map(r => r.months[0])).toEqual([1900, 1500, 2000, 100000, 0, 0, 600]);
  expect(rows.reduce((sum, r) => sum + r.months[0], 0)).toBe(106000);
});
it('저축 명의와 자산 이월은 위치와 무관하게 계산한다', () => {
  const f = januaryFixture(); const rows = savingsRows(2026, computeLines([...f.lines].reverse(), f.entries, []), [], 2000);
  expect(rows[0]).toEqual({ month: 1, a: 400, b: 200, extra: 0, used: 0, assets: 2600 });
  expect(rows[11].assets).toBe(2600);
});
it('이월·사용 입력은 반복 저장해도 누적 중복되지 않는다', async () => {
  l = new Ledger(':memory:'); await l.setOpening(2026, 2000); await l.setUse(2026, 1, 300); await l.setUse(2026, 1, 500);
  const snap = await l.snapshot(2026, 1); expect(snap.uses).toHaveLength(1);
  expect(savingsRows(2026, [], snap.uses, snap.years[0].opening_balance)[0].assets).toBe(1500);
});
it('카테고리를 비워도 지출은 미분류 행에 보존된다', () => {
  const f = januaryFixture(); f.lines[0].category_id = null;
  const rows = annualCategories(computeLines(f.lines, f.entries, []), categoryNames.map((name, sort) => ({ id: `category-${sort}`, name, sort })), 1);
  expect(rows.at(-1)?.name).toBe('미분류'); expect(rows.reduce((sum, r) => sum + r.months[0], 0)).toBe(106000);
});
