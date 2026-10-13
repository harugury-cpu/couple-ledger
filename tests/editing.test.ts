import { afterEach, expect, it } from 'vitest';
import { Ledger } from '../src/db/ledger';
import { computeLines } from '../src/lib/calculations';
let l: Ledger;
afterEach(() => l?.client.close());
it('금액 수정은 차액 기록이고 비우기는 미입력으로 돌아간다', async () => {
  l = new Ledger(':memory:'); const [line] = await l.month(2026, 1);
  await l.setAmount(line.id, 100); await l.setAmount(line.id, 300); await l.setAmount(line.id, 300);
  let s = await l.snapshot(2026, 1); expect(s.entries.map(e => e.amount)).toEqual([100, 200]);
  expect(computeLines(s.lines, s.entries, [])[0].actual).toBe(300);
  await l.setAmount(line.id, null); s = await l.snapshot(2026, 1); expect(s.entries).toHaveLength(0);
  await l.setAmount(line.id, 0); expect((await l.snapshot(2026, 1)).entries).toHaveLength(1);
});
it('줄 추가·변경·삭제와 관련 기록 제거', async () => {
  l = new Ledger(':memory:'); const [line] = await l.month(2026, 1);
  const fields = { ...line, name: '추가항목', category_id: null };
  const { id: _, year: __, month: ___, series_id: ____, sort: _____, ...valid } = fields;
  const id = await l.createLine(2026, 1, valid); await l.setAmount(id, 500);
  await l.updateLine(id, { ...valid, name: '변경항목', pay_day: 31 });
  expect((await l.month(2026, 1)).find(r => r.id === id)?.name).toBe('변경항목');
  await l.deleteLine(id); const snapshot = await l.snapshot(2026, 1);
  expect(snapshot.lines.some(r => r.id === id)).toBe(false); expect(snapshot.entries).toHaveLength(0);
});
it('소수·음수 예산·범위 밖 월을 저장하지 않는다', async () => {
  l = new Ledger(':memory:'); const [line] = await l.month(2026, 1);
  await expect(l.setAmount(line.id, 1.5)).rejects.toThrow();
  await expect(l.setBudget(line.id, -1)).rejects.toThrow();
  await expect(l.month(2026, 13)).rejects.toThrow();
});
it('새 줄을 이미 만들어진 이후 달에도 넣는다', async () => {
  l = new Ledger(':memory:'); const [line] = await l.month(2026, 1); await l.ensureMonth(2026, 1); await l.ensureMonth(2026, 3);
  const { id: _, year: __, month: ___, series_id: ____, sort: _____, ...base } = line;
  const fields = { ...base, category_id: null, payment_method_id: null, transfer_key: null, section: 'variable' as const, saving_owner: null };
  const only = await l.createLine(2026, 1, { ...fields, name: '이번달만줄' }, 700);
  const all = await l.createLine(2026, 1, { ...fields, name: '이후달도줄', budget: 300 }, 900, '새계좌', true);
  await l.createLine(2026, 1, { ...fields, name: '일회성줄', one_off: true }, undefined, undefined, true);
  const january = await l.month(2026, 1); const series = january.find(r => r.id === all)!.series_id;
  for (const month of [2, 3]) {
    const rows = await l.month(2026, month); const copy = rows.find(r => r.name === '이후달도줄')!;
    expect(copy).toMatchObject({ series_id: series, budget: 300, section: 'variable' });
    expect(rows.some(r => r.name === '이번달만줄' || r.name === '일회성줄')).toBe(false);
    const snapshot = await l.snapshot(2026, month);
    expect(snapshot.transfers.filter(t => t.month === month && t.account === '새계좌').map(t => t.series_id)).toEqual([copy.transfer_key]);
    expect(snapshot.entries.some(e => e.month_line_id === copy.id)).toBe(false);
  }
  expect((await l.snapshot(2026, 1)).entries.filter(e => e.month_line_id === all).map(e => e.amount)).toEqual([900]);
  expect(january.some(r => r.id === only)).toBe(true);
  // 아직 만들지 않은 달은 평소처럼 직전 달을 이어받는다
  expect((await l.month(2026, 4)).filter(r => r.name === '이후달도줄')).toHaveLength(1);
});
it('수단 칸은 묶인 줄을 한 번에 바꾸고 이후 달에도 적용할 수 있다', async () => {
  l = new Ledger(':memory:'); const january = await l.month(2026, 1); await l.ensureMonth(2026, 1); await l.ensureMonth(2026, 2);
  const [a, b, c] = january; const method = (await l.snapshot(2026, 1)).paymentMethods[0];
  await l.setPayment([a.id, b.id], 9, method.id);
  let rows = await l.month(2026, 1);
  expect(rows.filter(r => r.pay_day === 9 && r.payment_method_id === method.id).map(r => r.id).sort()).toEqual([a.id, b.id].sort());
  expect(rows.find(r => r.id === c.id)).toMatchObject({ pay_day: c.pay_day, payment_method_id: c.payment_method_id });
  expect((await l.month(2026, 2)).find(r => r.series_id === a.series_id)).toMatchObject({ pay_day: a.pay_day, payment_method_id: a.payment_method_id });
  await l.setPayment([a.id], null, null, true);
  rows = await l.month(2026, 1); expect(rows.find(r => r.id === a.id)).toMatchObject({ pay_day: null, payment_method_id: null });
  expect((await l.month(2026, 2)).find(r => r.series_id === a.series_id)).toMatchObject({ pay_day: null, payment_method_id: null });
  await expect(l.setPayment([a.id], 1, '없는수단')).rejects.toThrow('결제수단을 찾을 수 없습니다');
});
