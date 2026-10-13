import { afterEach, expect, it } from 'vitest';
import { Ledger } from '../src/db/ledger';
import { validateArchive } from '../src/lib/archive';
import { computeLines, monthTotals, savingsRows } from '../src/lib/calculations';
import { readFile } from 'node:fs/promises';
const opened: Ledger[] = [];
const make = () => { const l = new Ledger(':memory:'); opened.push(l); return l; };
afterEach(() => { opened.forEach(l => l.client.close()); opened.length = 0; });
it('전체 JSON을 빈 DB에 복원하면 모든 테이블과 집계가 같다', async () => {
  const a = make(); const donor = (await a.month(2026, 1)).find(l => l.name === '생활비')!;
  await a.setBudget(donor.id, 1000); await a.setAmount(donor.id, 300); await a.setOpening(2026, 2000);
  await a.addSpecial(2026, 1, '경조사', 200, 'line', donor.id); await a.addSpecial(2026, 1, '선물', 100, 'saving', null);
  await a.month(2026, 2); await a.markPrompt(2026, 1);
  const archive = await a.exportArchive(); expect(() => validateArchive(archive)).not.toThrow();
  const b = make(); await b.importArchive(archive); expect((await b.exportArchive()).data).toEqual(archive.data);
  const before = await a.snapshot(2026, 1); const after = await b.snapshot(2026, 1);
  expect(after).toEqual(before);
  const ca = computeLines(before.lines, before.entries, before.adjustments); const cb = computeLines(after.lines, after.entries, after.adjustments);
  expect(monthTotals(cb)).toEqual(monthTotals(ca)); expect(savingsRows(2026, cb, after.uses, 2000)).toEqual(savingsRows(2026, ca, before.uses, 2000));
});
it('복원 전 JSON 백업은 원래 자료와 같고 읽을 수 있다', async () => {
  const a = make(); const b = make(); const [line] = await b.month(2026, 1); await b.setAmount(line.id, 1234);
  const before = await b.exportArchive(); const backupPath = await b.importArchive(await a.exportArchive());
  const saved = JSON.parse(await readFile(backupPath, 'utf8')); expect(saved.data).toEqual(before.data);
});
it('형식·중복·참조·안전하지 않은 금액은 기존 DB를 바꾸지 않는다', async () => {
  const l = make(); await l.ensureMonth(2026, 1); const archive = await l.exportArchive();
  const invalids = [
    { ...archive, version: 99 },
    { ...archive, data: { ...archive.data, month_lines: [...archive.data.month_lines, archive.data.month_lines[0]] } },
    { ...archive, data: { ...archive.data, month_lines: archive.data.month_lines.map((r, i) => i ? r : { ...r, category_id: 'missing' }) } },
    { ...archive, data: { ...archive.data, entries: [{ id: 'bad', month_line_id: archive.data.month_lines[0].id, amount: 1.5, source: 'manual', raw_text: null, created_by: 'local-owner', created_at: new Date().toISOString() }] } },
  ];
  for (const bad of invalids) { await expect(l.importArchive(bad)).rejects.toThrow(); expect((await l.exportArchive()).data).toEqual(archive.data); }
});
it('특별 지출의 재원·월·연결 금액이 어긋난 JSON을 거부한다', async () => {
  const l = make(); const [line] = await l.month(2026, 1); await l.setBudget(line.id, 100); await l.addSpecial(2026, 1, '경조사', 20, 'line', line.id);
  const a = await l.exportArchive(); a.data.budget_adjustments[0].amount = -21;
  expect(() => validateArchive(a)).toThrow('예산 조정');
});
it('카테고리·결제수단 변경과 사용 중 삭제 보호', async () => {
  const l = make(); await l.ensureMonth(2026, 1); await l.saveCategory('여행'); await l.savePayment('여행 통장', 'account', 'A');
  let s = await l.snapshot(2026, 1); const c = s.categories.find(c => c.name === '여행')!; const m = s.paymentMethods.find(m => m.name === '여행 통장')!;
  await l.saveCategory('여행비', c.id); await l.savePayment('새 통장', 'card', 'B', m.id);
  await expect(l.saveCategory('고정비')).rejects.toThrow('같은 이름'); await expect(l.deleteCategory('category-0')).rejects.toThrow('사용 중'); await expect(l.deletePayment('payment-0')).rejects.toThrow('사용 중');
  await l.deleteCategory(c.id); await l.deletePayment(m.id); s = await l.snapshot(2026, 1); expect(s.categories.some(ca => ca.id === c.id)).toBe(false); expect(s.paymentMethods.some(me => me.id === m.id)).toBe(false);
});
it('입력 한도보다 큰 내부 차액 기록도 자기 백업으로 복원된다', async () => {
  const a = make(); const [line] = await a.month(2026, 1);
  await a.setAmount(line.id, -1_000_000_000_000); await a.setAmount(line.id, 1_000_000_000_000);
  const archive = await a.exportArchive(); expect(archive.data.entries[1].amount).toBe(2_000_000_000_000);
  const b = make(); await b.importArchive(archive); const s = await b.snapshot(2026, 1);
  expect(computeLines(s.lines, s.entries, [])[0].actual).toBe(1_000_000_000_000);
});
it('알 수 없는 저축 명의 키는 사전순으로 a와 b에 맞춘다', async () => {
  const a = make();
  const month = await a.month(2026, 1);
  await a.setAmount(month.find(l => l.name === '저축 1')!.id, 100);
  await a.setAmount(month.find(l => l.name === '저축 2')!.id, 40);
  const archive = await a.exportArchive();
  const rewritten = {
    ...archive,
    data: {
      ...archive.data,
      month_lines: archive.data.month_lines.map(line => ({
        ...line,
        saving_owner: line.saving_owner === 'a' ? 'z-legacy' : line.saving_owner === 'b' ? 'm-legacy' : line.saving_owner,
      })),
    },
  };
  const parsed = validateArchive(rewritten);
  const parsedText = JSON.stringify(parsed.data.month_lines);
  expect(parsedText).not.toContain('z-legacy');
  expect(parsedText).not.toContain('m-legacy');
  const b = make();
  await b.importArchive(rewritten);
  const before = await a.snapshot(2026, 1);
  const after = await b.snapshot(2026, 1);
  expect(savingsRows(2026, computeLines(after.lines, after.entries, after.adjustments), after.uses, 0))
    .toEqual(savingsRows(2026, computeLines(before.lines, before.entries, before.adjustments), before.uses, 0));
});
it('마지막 series 줄 삭제는 연결된 매칭 규칙도 함께 정리한다', async () => {
  const l = make(); await l.ensureMonth(2026, 1); const [line] = await l.month(2026, 1); const archive = await l.exportArchive();
  archive.data.match_rules.push({ id: 'rule', payment_method_id: 'payment-0', keyword: null, series_id: line.series_id });
  await l.importArchive(archive); await l.deleteLine(line.id);
  const saved = await l.exportArchive(); expect(saved.data.match_rules).toHaveLength(0); expect(() => validateArchive(saved)).not.toThrow();
});
