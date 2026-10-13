import { afterEach, expect, it } from 'vitest';
import { Ledger } from '../src/db/ledger';
import { computeLines } from '../src/lib/calculations';
import { parseQuick, quickCandidates } from '../src/lib/quick';
let l: Ledger;
afterEach(() => l?.client.close());
it('직전 달 승계·고정액 자동 기록·일회성 제외·중복 방지', async () => {
  l = new Ledger(':memory:'); const january = await l.month(2026, 1);
  const allowance = january.find(r => r.name === '용돈 B')!;
  await l.setBudget(allowance.id, 2000); await l.setAmount(allowance.id, 1700);
  const { id, year, month, series_id, sort, ...fields } = january[0];
  await l.updateLine(id, { ...fields, one_off: true });
  const february = await l.month(2026, 2); await l.month(2026, 2);
  expect(february).toHaveLength(28); expect(february.some(r => r.series_id === series_id)).toBe(false);
  const snapshot = await l.snapshot(2026, 2); const computed = computeLines(snapshot.lines.filter(r => r.month === 2), snapshot.entries, snapshot.adjustments);
  expect(computed.find(r => r.name === '용돈 B')).toMatchObject({ actual: 2000, budget: 2000 });
  expect(computed.find(r => r.name === '가스비')?.hasEntry).toBe(false);
  expect((await l.month(2026, 1)).find(r => r.id === allowance.id)?.budget).toBe(2000);
});
it('월을 건너뛰거나 연도를 넘어도 직전 달을 이어받는다', async () => {
  l = new Ledger(':memory:'); const [line] = await l.month(2026, 11); await l.setBudget(line.id, 400);
  await l.month(2027, 2);
  expect((await l.month(2026, 12))[0].budget).toBe(400); expect((await l.month(2027, 1))[0].budget).toBe(400);
  expect((await l.snapshot(2027, 2)).months.every(m => !m.special_prompt_seen)).toBe(true);
});
it('미래 속성 적용은 과거와 기존 실사용을 유지한다', async () => {
  l = new Ledger(':memory:'); await l.month(2026, 1); const feb = await l.month(2026, 2); await l.month(2026, 3);
  const target = feb.find(r => r.name === '용돈 B')!;
  const march = (await l.month(2026, 3)).find(r => r.series_id === target.series_id)!; await l.setAmount(march.id, 777);
  const { id, year, month, series_id, sort, ...fields } = target;
  await l.updateLine(id, { ...fields, name: '용돈 B 변경', budget: 500 }, true);
  expect((await l.month(2026, 1)).find(r => r.series_id === series_id)?.name).toBe('용돈 B');
  expect((await l.month(2026, 3)).find(r => r.series_id === series_id)?.budget).toBe(500);
  const snap = await l.snapshot(2026, 3); expect(computeLines(snap.lines, snap.entries, []).find(r => r.id === march.id)?.actual).toBe(777);
});
it('빠른 입력 후보·누적·되돌리기', async () => {
  l = new Ledger(':memory:'); const lines = await l.month(2026, 1); const p = parseQuick('가스비 12,000');
  expect(p).toEqual({ name: '가스비', amount: 12000 }); expect(quickCandidates(lines, '월급')).toHaveLength(2); expect(quickCandidates(lines, '새항목')).toHaveLength(0);
  const gas = quickCandidates(lines, p.name)[0]; await l.setAmount(gas.id, 100);
  const entry = await l.quickEntry(gas.id, p.amount, '가스비 12000');
  let snap = await l.snapshot(2026, 1); expect(computeLines(snap.lines, snap.entries, []).find(r => r.id === gas.id)?.actual).toBe(12100);
  await l.undoQuick(entry); snap = await l.snapshot(2026, 1); expect(computeLines(snap.lines, snap.entries, []).find(r => r.id === gas.id)?.actual).toBe(100);
  expect(() => parseQuick('가스비 1.5')).toThrow();
});
it('비어 있는 달을 다시 열거나 이어받아도 양식이 되살아나지 않는다', async () => {
  l = new Ledger(':memory:'); for (const line of await l.month(2026, 1)) await l.deleteLine(line.id);
  expect(await l.month(2026, 1)).toHaveLength(0); expect(await l.month(2026, 2)).toHaveLength(0);
});
