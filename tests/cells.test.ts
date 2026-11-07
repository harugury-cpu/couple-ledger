import { afterEach, expect, test } from 'vitest';
import { Ledger } from '../src/db/ledger';
import { runLedgerAction } from '../src/db/ledger-action';
import { commandSchema } from '../src/lib/validation';
import { computeLines } from '../src/lib/calculations';
import { applyEditHistory, recordEdit } from '../src/db/edit-history';
import { FakeD1 } from './fake-d1';
import { createD1Ledger } from '../src/db/ledger-d1';
import { formatClipboard, parseClipboard, manualAreas, sheetOrder, layoutAreas } from '../src/lib/sheet-grid';

const ledgers: Ledger[] = [];
afterEach(() => { for (const l of ledgers.splice(0)) l.client.close(); });
const ledger = () => { const l = new Ledger(':memory:'); ledgers.push(l); return l; };
const data = async (l: Ledger) => (await l.exportArchive()).data;
const current = async (l: Ledger) => { const s = await l.snapshot(2026, 1); return computeLines(s.lines.filter(r => r.month === 1), s.entries, s.adjustments); };
async function setup() {
  const l = ledger(); await l.ensureMonth(2026, 1);
  const line = (await l.month(2026, 1)).find(r => r.section === 'variable')!;
  const { id, year, month, series_id, sort, ...fields } = line;
  await l.updateLine(id, { ...fields, budget: 10, input_mode: 'manual' }); await l.setAmount(id, 20);
  return { l, id };
}
const action = (l: Ledger, command: unknown, id = crypto.randomUUID()) => runLedgerAction(l, commandSchema.parse(command), id);

test('붙여넣기는 새 수단·계좌·여러 값까지 한 batch에 저장한다', async () => {
  const { l, id } = await setup();
  const rows = await l.month(2026, 1); const second = rows[rows.findIndex(r => r.id === id) + 1];
  let batches = 0; const original = l.store.batch.bind(l.store);
  l.store.batch = async statements => { batches++; await original(statements); };
  await l.editCells(2026, 1, [id, second.id].flatMap(id => [
    { id, col: 0, value: '8일(새 카드)' }, { id, col: 3, value: '100,000' }, { id, col: 4, value: '50,000' },
    { id, col: 5, value: '공통 이체' }, { id, col: 6, value: '200000' },
  ]));
  expect(batches).toBe(1);
  const s = await l.snapshot(2026, 1);
  expect(s.paymentMethods.filter(p => p.name === '새 카드')).toHaveLength(1);
  expect(s.transfers.filter(t => t.account === '공통 이체')).toHaveLength(1);
  expect((await current(l)).filter(r => [id, second.id].includes(r.id)).every(r => r.actual === 50000 && r.budget === 100000)).toBe(true);
});

test('가상 월의 잘못된 값은 새 수단·월·다른 칸을 남기지 않는다', async () => {
  const l = ledger(); await l.init(); const row = (await l.month(2026, 1))[0];
  const before = await data(l);
  await expect(l.editCells(2026, 1, [{ id: row.id, col: 0, value: '생기면 안 되는 카드' }, { id: row.id, col: 3, value: '돈' }])).rejects.toThrow();
  expect(await data(l)).toEqual(before);
});

test('작업별 붙여넣기 취소·재실행은 같은 칸의 후속 카드 거래를 보존한다', async () => {
  const { l, id } = await setup();
  const result = await action(l, { type: 'cells', year: 2026, month: 1, changes: [{ id, col: 3, value: '123' }, { id, col: 4, value: '70' }] });
  expect(result.history_id).toBeTruthy();
  await l.store.batch([{ sql: "INSERT INTO entries(id,month_line_id,amount,source,created_by,created_at) VALUES(?,?,17,'notification','local-owner','2026-01-01T00:00:00Z')", params: ['notification:new', id] }]);
  await applyEditHistory(l, result.history_id!, 'undo');
  expect((await current(l)).find(r => r.id === id)).toMatchObject({ budget: 10, actual: 37 });
  await applyEditHistory(l, result.history_id!, 'redo');
  expect((await current(l)).find(r => r.id === id)).toMatchObject({ budget: 123, actual: 87 });
  expect((await data(l)).entries.some(e => e.id === 'notification:new')).toBe(true);
});

test('같은 필드의 후속 수정과 충돌하면 취소 전체를 되돌린다', async () => {
  const { l, id } = await setup();
  const result = await action(l, { type: 'cells', year: 2026, month: 1, changes: [{ id, col: 3, value: '123' }, { id, col: 4, value: '70' }] });
  await l.setBudget(id, 999);
  const before = await data(l);
  await expect(applyEditHistory(l, result.history_id!, 'undo')).rejects.toThrow('변경');
  expect(await data(l)).toEqual(before);
});

test('다른 필드의 후속 수정은 보존한 채 예산만 되돌린다', async () => {
  const { l, id } = await setup();
  const result = await action(l, { type: 'budget', id, amount: 123 });
  await l.setPayment([id], 15, null);
  await applyEditHistory(l, result.history_id!, 'undo');
  expect((await l.month(2026, 1)).find(r => r.id === id)).toMatchObject({ budget: 10, pay_day: 15 });
});

test('병합·해제·취소·JSON 복원은 원래 예산과 금액을 보존한다', async () => {
  const { l } = await setup(); const ids = (await l.month(2026, 1)).filter(r => r.section === 'variable').slice(0, 2).map(r => r.id);
  const before = await data(l);
  const result = await action(l, { type: 'cell-merge', year: 2026, month: 1, ids, first_col: 3, last_col: 4 });
  const merged = await l.snapshot(2026, 1); expect(merged.cellMerges).toHaveLength(1);
  expect((await data(l)).entries).toEqual(before.entries); expect((await data(l)).month_lines).toEqual(before.month_lines);
  const restored = ledger(); await restored.importArchive(await l.exportArchive()); expect((await restored.snapshot(2026, 1)).cellMerges).toEqual(merged.cellMerges);
  const split = await action(l, { type: 'cell-unmerge', ids: [merged.cellMerges[0].id] });
  expect((await l.snapshot(2026, 1)).cellMerges).toHaveLength(0);
  await applyEditHistory(l, split.history_id!, 'undo'); expect((await l.snapshot(2026, 1)).cellMerges).toEqual(merged.cellMerges);
  await applyEditHistory(l, result.history_id!, 'undo'); expect((await l.snapshot(2026, 1)).cellMerges).toHaveLength(0);
});

test('새 줄에 후속 거래가 생기면 줄 생성 취소가 그 거래를 삭제하지 않는다', async () => {
  const { l } = await setup(); const line = (await l.month(2026, 1)).find(r => r.section === 'variable')!;
  const { id, year, month, series_id, sort, ...fields } = line;
  const result = await action(l, { type: 'create', year, month, fields: { ...fields, name: '새 줄' } });
  const created = (await l.month(year, month)).find(r => r.name === '새 줄')!;
  await l.quickEntry(created.id, 100, '후속 알림');
  await expect(applyEditHistory(l, result.history_id!, 'undo')).rejects.toThrow('변경');
  expect((await current(l)).find(r => r.id === created.id)?.actual).toBe(100);
});

test('같은 작업 식별자를 재전송해도 새 줄이 중복되지 않는다', async () => {
  const { l } = await setup(); const line = (await l.month(2026, 1))[0]; const { id, year, month, series_id, sort, ...fields } = line;
  const op = crypto.randomUUID(); const command = { type: 'create', year, month, fields: { ...fields, name: '한 번만' } };
  await action(l, command, op); await action(l, command, op);
  expect((await l.month(year, month)).filter(r => r.name === '한 번만')).toHaveLength(1);
});

test('기존 명령 중 실패한 선행 쓰기도 해당 작업의 기록으로 복구한다', async () => {
  const { l } = await setup(); const before = await data(l);
  await expect(recordEdit(l, crypto.randomUUID(), {}, async tracked => { await tracked.saveCategory('임시 분류'); throw new Error('중간 실패'); })).rejects.toThrow('중간 실패');
  expect(await data(l)).toEqual(before);
});

test('D1의 문장당 100개 값 제한 안에서 대량 붙여넣기와 취소가 동작한다', async () => {
  const d1 = new FakeD1();
  try {
    await d1.migrate(); const l = createD1Ledger(d1); await l.ensureMonth(2026, 1); const rows = await l.month(2026, 1);
    const before = d1.batches;
    await l.editCells(2026, 1, rows.flatMap(r => [{ id: r.id, col: 0, value: '새 수단' }, { id: r.id, col: 3, value: '100' }, { id: r.id, col: 4, value: '50' }]));
    expect(d1.batches - before).toBe(1);
    const result = await runLedgerAction(l, commandSchema.parse({ type: 'cells', year: 2026, month: 1, changes: rows.map(r => ({ id: r.id, col: 3, value: '200' })) }), crypto.randomUUID());
    await applyEditHistory(l, result.history_id!, 'undo');
    expect((await l.month(2026, 1)).every(r => r.budget === 100)).toBe(true);
  } finally { d1.client.close(); }
});

test('탭·줄바꿈·따옴표·빈칸을 포함한 외부 표도 왕복한다', () => {
  const values = [['이름\t세부', '"인용"', ''], ['두\n줄', '120,000', '-40']];
  expect(parseClipboard(formatClipboard(values))).toEqual(values);
  expect(parseClipboard('100\t200\r\n300\t\r\n')).toEqual([['100', '200'], ['300', '']]);
});

test('줄 삭제·재정렬 뒤 잘못된 병합이 다른 칸을 숨기지 않는다', async () => {
  const { l } = await setup(); const lines = await current(l); const group = lines.filter(r => r.section === 'variable');
  const merge = { id: 'm', year: 2026, month: 1, section: 'variable' as const, line_ids: JSON.stringify(group.slice(0, 2).map(r => r.id)), first_col: 3, last_col: 4 };
  expect(manualAreas(lines, [merge])).toHaveLength(1);
  expect(manualAreas(lines.filter(r => r.id !== group[0].id), [merge])).toHaveLength(0);
});

test('병합한 줄 삭제를 취소하면 줄·병합·백업 연결이 함께 복구된다', async () => {
  const { l } = await setup(); const rows = (await l.month(2026, 1)).filter(r => r.section === 'variable').slice(0, 2);
  await l.mergeCells(2026, 1, rows.map(r => r.id), 3, 3);
  const before = await l.exportArchive();
  const deleted = await action(l, { type: 'delete', id: rows[0].id });
  expect((await l.snapshot(2026, 1)).cellMerges).toHaveLength(0);
  const after = ledger(); await after.importArchive(await l.exportArchive());
  await applyEditHistory(l, deleted.history_id!, 'undo');
  // 되살린 줄은 새로 INSERT되어 저장 순서만 뒤로 간다. 화면 순서는 sort 열이 정하므로 내용만 비교한다.
  const rowsOf = (d: Record<string, unknown[]>) => Object.fromEntries(Object.entries(d).map(([k, rows]) => [k, rows.map(r => JSON.stringify(r)).sort()]));
  expect(rowsOf((await l.exportArchive()).data)).toEqual(rowsOf(before.data));
});

test('구역이 섞인 sort에서도 표 행 번호는 화면의 구역 순서를 따른다', () => {
  const rows = [
    { id: 'a', section: 'fixed' }, { id: 'b', section: 'variable' }, { id: 'c', section: 'fixed' },
    { id: 'd', section: 'income' }, { id: 'e', section: 'saving' }, { id: 'f', section: 'fixed' },
  ];
  expect(sheetOrder(rows).map(r => r.id)).toEqual(['a', 'c', 'f', 'b', 'e', 'd']);
});

test('[이후 달에도 반영]은 고른 줄 내용만 이후 달에 맞추고, 실행 취소 한 번으로 되돌린다', async () => {
  const { l, id } = await setup(); await l.ensureMonth(2026, 3);
  const line = (await l.month(2026, 1)).find(r => r.id === id)!;
  const other = (await l.month(2026, 1)).find(r => r.section === 'variable' && r.id !== id)!;
  // 예산은 뒤 달로 이어진다. 3월에 따로 정한 예산이 있으면 거기서 멈추고, [이후 달에도 반영]으로 덮어쓸 수 있다.
  const later = async (series: string) => (await l.month(2026, 3)).find(r => r.series_id === series)!;
  await action(l, { type: 'budget', id: (await later(line.series_id)).id, amount: 333 });
  await action(l, { type: 'budget', id, amount: 777 });
  await action(l, { type: 'budget', id: other.id, amount: 555 });
  expect((await l.month(2026, 2)).find(r => r.series_id === line.series_id)!.budget).toBe(777);
  expect((await later(line.series_id)).budget).toBe(333);
  expect((await later(other.series_id)).budget).toBe(555);
  const before = await data(l);
  const done = await action(l, { type: 'propagate', ids: [id], transfer_ids: [] });
  expect((await later(line.series_id)).budget).toBe(777);
  // 실제로 쓴 금액은 옮기지 않는다.
  const febLine = (await l.month(2026, 2)).find(r => r.series_id === line.series_id)!;
  const feb = (await l.snapshot(2026, 2)).entries.filter(e => e.month_line_id === febLine.id);
  expect(feb.some(e => e.amount === 20)).toBe(false);
  await applyEditHistory(l, done.history_id!, 'undo');
  const sorted = (d: Record<string, unknown[]>) => Object.fromEntries(Object.entries(d).map(([k, rows]) => [k, rows.map(r => JSON.stringify(r)).sort()]));
  expect(sorted(await data(l))).toEqual(sorted(before));
});

test('이체 칸을 병합하면 아랫줄을 맨 윗줄 계좌로 묶어 예산 합계·남음이 묶음 전체로 계산된다', async () => {
  const { l } = await setup();
  const rows = (await l.month(2026, 1)).filter(r => r.section === 'variable').slice(0, 3);
  await l.editCells(2026, 1, [{ id: rows[0].id, col: 5, value: '케이' }, { id: rows[0].id, col: 6, value: '320000' }, { id: rows[2].id, col: 5, value: '다른 계좌' }]);
  // 보이는 칸만 합치던 예전 병합 기록이 있어도 함께 바꾼다.
  await l.mergeCells(2026, 1, rows.map(r => r.id), 5, 5);
  await action(l, { type: 'cell-merge', year: 2026, month: 1, ids: rows.map(r => r.id), first_col: 5, last_col: 7 });
  const s = await l.snapshot(2026, 1);
  const k = s.transfers.find(t => t.month === 1 && t.account === '케이')!;
  expect(s.lines.filter(r => rows.some(x => x.id === r.id)).every(r => r.transfer_key === k.series_id)).toBe(true);
  expect(k.amount).toBe(320000);
  expect(s.transfers.some(t => t.month === 1 && t.account === '다른 계좌')).toBe(false);
  expect(s.cellMerges.filter(m => m.month === 1)).toHaveLength(0);
  // 맨 윗줄에 계좌가 없으면 무엇을 해야 하는지 알려 준다.
  const plain = (await l.month(2026, 1)).filter(r => r.section === 'fixed').slice(0, 2);
  await expect(l.mergeCells(2026, 1, plain.map(r => r.id), 5, 5)).rejects.toThrow('맨 윗줄에 이체 계좌를 먼저 적으세요.');
});

test('구역 사이에 sort가 끼어 있어도 화면에서 붙은 줄은 병합되고 병합 기록도 남는다', async () => {
  const { l } = await setup();
  const fixed = (await l.month(2026, 1)).filter(r => r.section === 'fixed');
  const last = fixed.at(-1)!;
  // 고정생활비 맨 끝 줄을 다른 구역 줄들보다 큰 sort로 보내 실제 운영 데이터(월세 16 · 대출이자 27)와 같게 만든다.
  await l.store.batch([{ sql: 'UPDATE month_lines SET sort=999 WHERE id=?', params: [last.id] }]);
  const ids = [fixed.at(-2)!.id, last.id];
  await l.mergeCells(2026, 1, ids, 2, 2);
  expect((await l.snapshot(2026, 1)).cellMerges.filter(m => m.month === 1)).toHaveLength(1);
  // 다른 편집 뒤 정리(pruneMerges)에서도 지워지지 않는다.
  await l.editCells(2026, 1, [{ id: fixed[0].id, col: 3, value: '1000' }]);
  expect((await l.snapshot(2026, 1)).cellMerges.filter(m => m.month === 1)).toHaveLength(1);
});

test('칸 배치는 표의 열 수만큼 만든다(자산 표는 8열보다 넓을 수 있다)', () => {
  expect(layoutAreas(2, [], [], 17).size).toBe(34);
  expect(layoutAreas(1, [], []).size).toBe(8);
});
