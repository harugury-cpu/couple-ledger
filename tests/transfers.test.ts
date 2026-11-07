import { afterEach, expect, it } from 'vitest';
import { Ledger } from '../src/db/ledger';
import { computeLines, transferRows } from '../src/lib/calculations';

let l: Ledger;
afterEach(() => l?.client.close());

// 1월 줄 두 개를 'A은행' 계좌 묶음에 넣고 이체 금액을 정한다.
async function setup() {
  l = new Ledger(':memory:');
  const january = await l.month(2026, 1);
  const pick = (name: string) => january.find(r => r.name === name)!;
  for (const name of ['대출 이자', '실비 보험']) {
    const { id, year, month, series_id, sort, ...fields } = pick(name);
    await l.updateLine(id, fields, false, 'A은행');
  }
  const snapshot = await l.snapshot(2026, 1);
  await l.saveTransfer(snapshot.transfers[0].id, { amount: 450000 });
  return { loan: pick('대출 이자'), insurance: pick('실비 보험'), gas: pick('가스비') };
}
async function rows(year: number, month: number) {
  const s = await l.snapshot(year, month);
  const lines = computeLines(s.lines.filter(r => r.month === month), s.entries, s.adjustments);
  return transferRows(lines, s.transfers.filter(t => t.month === month));
}

it('같은 계좌 이름의 줄은 한 묶음이 되고, 남음은 이체 금액에서 묶음이 쓴 돈을 뺀 값이다', async () => {
  const { loan, insurance } = await setup();
  await l.setAmount(loan.id, 400000); await l.setAmount(insurance.id, 25000);
  const [kei, ...rest] = await rows(2026, 1);
  expect(rest).toHaveLength(0);
  expect(kei).toMatchObject({ account: 'A은행', amount: 450000, lineCount: 2, spent: 425000, remaining: 25000 });
});

it('쓴 돈이 이체 금액을 넘으면 남음이 음수다', async () => {
  const { loan } = await setup();
  await l.setAmount(loan.id, 500000);
  expect((await rows(2026, 1))[0].remaining).toBe(-50000);
});

it('새 달은 계좌 묶음과 이체 금액을 이어받고 쓴 돈은 비운다', async () => {
  const { loan } = await setup();
  await l.setAmount(loan.id, 400000);
  const [kei] = await rows(2026, 2);
  expect(kei).toMatchObject({ account: 'A은행', amount: 450000, lineCount: 2, spent: 0, remaining: 450000 });
  await l.month(2026, 2);
  expect(await rows(2026, 2)).toHaveLength(1);
});

it('이름이 같아도 떨어져 있는 줄은 따로 묶음이고, 붙은 줄은 한 묶음이며 줄 자리는 그대로다', async () => {
  const { loan, gas } = await setup();
  const before = (await l.month(2026, 1)).map(r => r.id);
  const { id, year, month, series_id, sort, ...fields } = gas;
  await l.updateLine(id, fields, false, 'A은행');
  expect((await l.month(2026, 1)).map(r => r.id)).toEqual(before);
  const all = await rows(2026, 1);
  expect(all.filter(t => t.account === 'A은행').map(t => t.lineCount).sort()).toEqual([1, 2]);
  // 떨어진 가스비 묶음은 이체 금액을 따로 갖는다. 원래 묶음(대출 이자·실비 보험)의 금액은 그대로다.
  expect(all.find(t => t.lineCount === 2)!.amount).toBe(450000);
  // 붙은 자리로 옮기면 한 묶음으로 합쳐지고 윗 묶음의 이체 금액을 쓴다.
  const fixed = (await l.month(2026, 1)).filter(r => r.section === 'fixed');
  await l.moveLine(id, fixed.findIndex(r => r.id === loan.id));
  const merged = await rows(2026, 1);
  expect(merged.filter(t => t.account === 'A은행')).toHaveLength(1);
  expect(merged[0]).toMatchObject({ lineCount: 3, amount: 450000 });
  // 다시 떼어 놓으면 아래 덩어리는 새 묶음이 되고 이체 금액은 그 줄들의 예산 합계로 시작한다.
  await l.moveLine(id, 999);
  const split = await rows(2026, 1);
  expect(split.filter(t => t.account === 'A은행').map(t => t.lineCount).sort()).toEqual([1, 2]);
  expect(split.find(t => t.lineCount === 1)!.amount).toBe(gas.budget);
});

it('줄을 끌어 옮기면 같은 구역 안의 그 자리로만 순서가 바뀐다', async () => {
  l = new Ledger(':memory:');
  const all = async () => (await l.month(2026, 1)).map(r => r.name);
  const names = async () => (await l.month(2026, 1)).filter(r => r.section === 'variable').map(r => r.name);
  const before = await names();
  const others = (await l.month(2026, 1)).filter(r => r.section !== 'variable').map(r => r.name);
  const second = (await l.month(2026, 1)).find(r => r.name === before[1])!;
  await l.moveLine(second.id, 0);
  expect(await names()).toEqual([before[1], before[0], ...before.slice(2)]);
  await l.moveLine(second.id, 999);
  expect(await names()).toEqual([before[0], ...before.slice(2), before[1]]);
  expect((await all()).filter(n => !before.includes(n))).toEqual(others);
});

it('계좌 이름을 비우면 묶음에서 빠지고, 줄이 없는 묶음은 사라진다', async () => {
  const { loan, insurance } = await setup();
  for (const line of [loan, insurance]) {
    const { id, year, month, series_id, sort, ...fields } = line;
    await l.updateLine(id, fields, false, '');
  }
  expect(await rows(2026, 1)).toHaveLength(0);
});

it('계좌를 보내지 않은 수정은 기존 묶음을 유지한다', async () => {
  const { loan } = await setup();
  const { id, year, month, series_id, sort, ...fields } = loan;
  await l.updateLine(id, { ...fields, name: '이자 조정' });
  expect((await rows(2026, 1))[0].lineCount).toBe(2);
});

it('이체 계좌 묶음도 JSON으로 내보내고 그대로 복원된다', async () => {
  await setup();
  const archive = await l.exportArchive();
  expect(archive.data.transfers).toHaveLength(1);
  const other = new Ledger(':memory:');
  await other.importArchive(archive);
  const restored = await other.exportArchive();
  other.client.close();
  expect(restored.data.transfers).toEqual(archive.data.transfers);
  expect(restored.data.month_lines.filter(r => r.transfer_key).length).toBe(2);
});

it('떨어진 묶음은 같은 이름으로 바꿔도 따로 남는다', async () => {
  const { gas } = await setup();
  const { id, year, month, series_id, sort, ...fields } = gas;
  await l.updateLine(id, fields, false, 'E은행');
  const s = await l.snapshot(2026, 1);
  const other = s.transfers.find(t => t.account === 'E은행')!;
  await l.saveTransfer(other.id, { account: 'A은행' });
  expect((await rows(2026, 1)).map(t => t.account)).toEqual(['A은행', 'A은행']);
});

it('이체 금액·계좌 이름은 고를 때만 이미 만든 이후 달에도 반영된다', async () => {
  await setup();
  await l.ensureMonth(2026, 2);
  const jan = (await l.snapshot(2026, 1)).transfers.find(t => t.month === 1)!;
  const feb = () => l.snapshot(2026, 2).then(s => s.transfers.find(t => t.month === 2 && t.series_id === jan.series_id)!);
  await l.saveTransfer(jan.id, { amount: 500000 });
  expect((await feb()).amount).toBe(450000);
  await l.saveTransfer(jan.id, { amount: 520000, account: '데통' }, true);
  expect(await feb()).toMatchObject({ amount: 520000, account: '데통' });
});

it('매달 같은 금액 줄의 금액을 고치면 뒤 달 금액이 따라오고, 예산은 그대로다', async () => {
  l = new Ledger(':memory:');
  // 1월을 먼저 만들어야 2월이 1월을 이어받아 자동 금액을 넣는다(첫 달은 양식이라 자동 금액이 없다).
  await l.ensureMonth(2026, 1);
  const jan = (await l.month(2026, 1)).find(r => r.input_mode === 'fixed' && r.section === 'variable')!;
  await l.ensureMonth(2026, 2);
  const actualOf = async (month: number) => {
    const snap = await l.snapshot(2026, month);
    return computeLines(snap.lines.filter(r => r.month === month), snap.entries, snap.adjustments).find(r => r.series_id === jan.series_id)!;
  };
  await l.setAmount(jan.id, 200000);
  expect(await actualOf(1)).toMatchObject({ budget: jan.budget, actual: 200000 });
  expect(await actualOf(2)).toMatchObject({ budget: jan.budget, actual: 200000 });
  // 아직 안 만든 달은 마지막 달 금액을 이어받는다
  expect((await actualOf(3)).actual).toBe(200000);
});

it('구역이 다르면 이름이 같고 표에서 맞닿아도 따로 묶음이다(월세·우리 적금)', async () => {
  const { settleTransfers } = await import('../src/db/months');
  const line = (id: string, section: 'fixed' | 'saving', sort: number, budget: number) =>
    ({ id, section, sort, budget, transfer_key: 'w', year: 2026, month: 11 }) as Parameters<typeof settleTransfers>[2][number];
  const rows = [line('rent', 'fixed', 16, 300000), line('saving', 'saving', 21, 300000)];
  let n = 0;
  const result = settleTransfers(2026, 11, rows, [{ id: 't', year: 2026, month: 11, series_id: 'w', account: '우리(7일)', amount: 300000 }], () => `new${n++}`);
  expect(result.created).toEqual([{ id: 'new0', year: 2026, month: 11, series_id: 'new1', account: '우리(7일)', amount: 300000 }]);
  expect(result.relink).toEqual([{ id: 'saving', key: 'new1' }]);
});
