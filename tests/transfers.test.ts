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

it('묶음에 들어온 줄은 묶음의 마지막 줄 바로 아래로 옮겨져 병합 칸이 하나로 이어진다', async () => {
  const { gas } = await setup();
  const { id, year, month, series_id, sort, ...fields } = gas;
  await l.updateLine(id, fields, false, 'A은행');
  const fixed = (await l.month(2026, 1)).filter(r => r.section === 'fixed');
  const group = fixed.map((r, i) => (r.transfer_key ? i : -1)).filter(i => i >= 0);
  expect(group).toHaveLength(3);
  expect(group[2] - group[0]).toBe(2);
  expect(fixed[group[2]].name).toBe('가스비');
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

it('같은 달에 같은 이름의 이체 계좌를 둘 만들 수 없다', async () => {
  const { gas } = await setup();
  const { id, year, month, series_id, sort, ...fields } = gas;
  await l.updateLine(id, fields, false, 'E은행');
  const s = await l.snapshot(2026, 1);
  const other = s.transfers.find(t => t.account === 'E은행')!;
  await expect(l.saveTransfer(other.id, { account: 'A은행' })).rejects.toThrow();
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

it('자동 줄의 금액을 고치면 예산이 같이 바뀌고, 고를 때 이후 달의 예산·자동 금액도 바뀐다', async () => {
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
  expect(await actualOf(1)).toMatchObject({ budget: 200000, actual: 200000 });
  expect((await actualOf(2)).budget).toBe(jan.budget);
  await l.setAmount(jan.id, 300000, true);
  expect(await actualOf(2)).toMatchObject({ budget: 300000, actual: 300000 });
  // 아직 안 만든 달은 마지막 달을 이어받는다
  expect((await actualOf(3)).budget).toBe(300000);
});
