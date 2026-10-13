import { afterEach, expect, it } from 'vitest';
import { Ledger } from '../src/db/ledger';
import { computeLines, monthTotals, savingsRows } from '../src/lib/calculations';
let l: Ledger;
afterEach(() => l?.client.close());
it('특별 지출은 이번 달 예산을 옮기고 다음 달 기본 예산을 보존한다', async () => {
  l = new Ledger(':memory:'); const donor = (await l.month(2026, 1)).find(r => r.name === '생활비')!; await l.setBudget(donor.id, 1000000);
  const id = await l.addSpecial(2026, 1, '경조사', 100000, 'line', donor.id);
  const snap = await l.snapshot(2026, 1); const lines = computeLines(snap.lines, snap.entries, snap.adjustments);
  expect(lines.find(r => r.id === donor.id)).toMatchObject({ budget: 1000000, effectiveBudget: 900000 });
  expect(monthTotals(lines).expense).toEqual({ budget: 1000000, actual: 100000 });
  const feb = await l.month(2026, 2); expect(feb.find(r => r.name === '생활비')?.budget).toBe(1000000); expect(feb.some(r => r.name === '경조사')).toBe(false);
  await expect(l.deleteLine(donor.id)).rejects.toThrow('특별 지출');
  await l.deleteSpecial(id); const restored = await l.snapshot(2026, 1); expect(restored.adjustments).toHaveLength(0); expect(restored.entries.filter(e => restored.lines.some(r => r.id === e.month_line_id && r.month === 1))).toHaveLength(0);
});
it('저축 재원은 사용·자산에 반영되고 월 예산·지출은 그대로다', async () => {
  l = new Ledger(':memory:'); await l.setOpening(2026, 2000); const snap = await l.snapshot(2026, 1); const before = monthTotals(computeLines(snap.lines, [], []));
  const id = await l.addSpecial(2026, 1, '선물', 300, 'saving', null);
  const after = await l.snapshot(2026, 1); expect(monthTotals(computeLines(after.lines, after.entries, after.adjustments))).toEqual(before);
  expect(savingsRows(2026, [], after.uses, 2000)[0]).toMatchObject({ used: 300, assets: 1700 });
  await l.setUse(2026, 1, 500); await expect(l.setUse(2026, 1, 200)).rejects.toThrow('특별 지출');
  await l.deleteSpecial(id); expect((await l.snapshot(2026, 1)).uses.reduce((sum, u) => sum + u.amount, 0)).toBe(200);
});
it('예산 부족·다른 달 재원·음수·특별 줄 일반 수정은 원자적으로 거부한다', async () => {
  l = new Ledger(':memory:'); const [line] = await l.month(2026, 1);
  await expect(l.addSpecial(2026, 1, '경조사', 1, 'line', line.id)).rejects.toThrow('부족');
  await l.setBudget(line.id, 100); await expect(l.addSpecial(2026, 2, '경조사', 50, 'line', line.id)).rejects.toThrow('이번 달');
  await l.addSpecial(2026, 1, '경조사', 50, 'line', line.id);
  await expect(l.setBudget(line.id, 20)).rejects.toThrow('특별 지출');
  const snap = await l.snapshot(2026, 1); expect(snap.specials).toHaveLength(1); expect(snap.adjustments).toHaveLength(1);
  const special = snap.lines.find(r => r.series_id.startsWith('special:'))!; await expect(l.setAmount(special.id, 40)).rejects.toThrow('특별 지출');
});
it('새 달 질문의 확인 상태를 한 번 기록하고 다음 달은 따로 묻는다', async () => {
  l = new Ledger(':memory:'); await l.month(2026, 1); await l.markPrompt(2026, 1); await l.month(2026, 2);
  const snap = await l.snapshot(2026, 2); expect(snap.months.find(m => m.month === 1)?.special_prompt_seen).toBe(true); expect(snap.months.find(m => m.month === 2)?.special_prompt_seen).toBe(false);
});
