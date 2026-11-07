import { afterEach, expect, it } from 'vitest';
import { Ledger } from '../src/db/ledger';
import { runLedgerAction } from '../src/db/ledger-action';
import { applyEditHistory } from '../src/db/edit-history';
import { commandSchema } from '../src/lib/validation';
import { assetRows, computeLines } from '../src/lib/calculations';

const opened: Ledger[] = [];
afterEach(() => { for (const l of opened.splice(0)) l.client.close(); });
const now = { year: 2026, month: 11 };
const make = () => { const l = new Ledger(':memory:', { today: () => now }); opened.push(l); return l; };
const action = (l: Ledger, command: unknown) => runLedgerAction(l, commandSchema.parse(command), crypto.randomUUID());
const view = async (l: Ledger, year = 2026) => {
  const s = await l.snapshot(year, 11);
  return assetRows(s.accounts, computeLines(s.lines, s.entries, s.adjustments), s.balances, s.assetCarry, year, now);
};

async function setup() {
  const l = make(); await l.ensureMonth(2025, 12); await l.ensureMonth(2026, 12);
  const series = (await l.month(2026, 1)).filter(r => r.section === 'saving').map(r => r.series_id);
  const line = async (year: number, month: number, i = 0) => (await l.month(year, month)).find(r => r.series_id === series[i])!;
  return { l, series, line };
}

it('계좌에 연결한 저축 줄의 금액이 달별 원금이 되고, 시작 원금·지난해 금액이 이월 원금이 된다', async () => {
  const { l, series, line } = await setup();
  await action(l, { type: 'account-save', name: '토스', kind: 'invest', target: null, principal: 1_000_000, series: [series[0]] });
  for (let m = 1; m <= 12; m++) await l.setAmount((await line(2026, m)).id, 100_000);
  await l.setAmount((await line(2025, 12)).id, 50_000);
  // 인출은 그 달 저축 줄에 마이너스로 적는다. 매달 같은 금액 줄이라 뒤 달로 이어지므로, 다음 달에 원래 금액을 다시 적는다.
  await l.setAmount((await line(2026, 3)).id, -30_000);
  expect((await view(l)).rows[0].months[3].amount).toBe(-30_000);
  await l.setAmount((await line(2026, 4)).id, 100_000);
  const { rows, totals } = await view(l);
  expect(rows[0].opening).toBe(1_050_000);
  expect(rows[0].months.map(m => m.amount)).toEqual([100_000, 100_000, -30_000, ...Array(9).fill(100_000)]);
  expect(rows[0].months[11].future).toBe(true);
  // 12월(아직 안 옴)은 총 원금에 넣지 않는다.
  expect(rows[0].principal).toBe(1_050_000 + 200_000 - 30_000 + 800_000);
  // 평가금액을 적기 전에는 증감이 없고, 합계는 원금으로 센다.
  expect(rows[0]).toMatchObject({ value: null, change: null });
  expect(totals.value).toBe(rows[0].principal);
});

it('투자는 확인한 날과 평가금액으로 증감을 내고, 저축은 원금과 같고, 묶인 돈은 총 자산에만 더한다', async () => {
  const { l, series, line } = await setup();
  await action(l, { type: 'account-save', name: '오빠 ISA', kind: 'invest', target: null, principal: 2_000_000, series: [series[1]] });
  await action(l, { type: 'account-save', name: '우리 적금', kind: 'ready', target: null, principal: 300_000, series: [series[0]] });
  await action(l, { type: 'account-save', name: '월세 보증금', kind: 'reserved', target: null, principal: 10_000_000, due_on: '2027-08-31', series: [series[2]] });
  await l.setAmount((await line(2026, 1, 1)).id, 0);
  const { accounts } = await l.snapshot(2026, 11);
  const isa = accounts.find(a => a.name === '오빠 ISA')!;
  await action(l, { type: 'balance', id: isa.id, year: 2026, month: 11, amount: 2_500_000, checked_on: '2026-11-07' });
  const { rows, locked, totals } = await view(l);
  const isaRow = rows.find(r => r.account.id === isa.id)!;
  expect(isaRow).toMatchObject({ value: 2_500_000, checkedOn: '2026-11-07' });
  expect(isaRow.change).toBe(2_500_000 - isaRow.principal);
  const saving = rows.find(r => r.account.name === '우리 적금')!;
  expect(saving.value).toBe(saving.principal);
  // 묶인 돈은 저축 줄을 연결하지 않는다.
  expect(locked).toEqual([expect.objectContaining({ name: '월세 보증금', principal: 10_000_000, due_on: '2027-08-31', series: '[]' })]);
  expect(totals.total).toBe(totals.value + 10_000_000);
  expect(totals.change).toBe(totals.value - totals.principal);
});

it('한 저축 줄은 한 계좌에만 연결되고, 계좌 저장은 실행 취소로 되돌리며 백업에 새 칸이 그대로 남는다', async () => {
  const { l, series } = await setup();
  await action(l, { type: 'account-save', name: '토스', kind: 'invest', target: null, principal: 0, series: [series[0]] });
  await expect(action(l, { type: 'account-save', name: '내 ISA', kind: 'invest', target: null, principal: 0, series: [series[0]] })).rejects.toThrow('토스');
  const [toss] = (await l.snapshot(2026, 11)).accounts;
  const before = (await l.exportArchive()).data;
  const done = await action(l, { type: 'account-save', id: toss.id, name: '토스증권', kind: 'invest', target: null, principal: 500_000, series: [series[0], series[1]] });
  expect((await l.snapshot(2026, 11)).accounts[0]).toMatchObject({ name: '토스증권', principal: 500_000, series: JSON.stringify([series[0], series[1]]) });
  await applyEditHistory(l, done.history_id!, 'undo');
  expect((await l.exportArchive()).data.accounts).toEqual(before.accounts);
  await action(l, { type: 'balance', id: toss.id, year: 2026, month: 11, amount: 10, checked_on: '2026-11-07' });
  const archive = await l.exportArchive();
  const copy = make(); await copy.importArchive(archive);
  expect((await copy.exportArchive()).data.account_balances).toEqual(archive.data.account_balances);
  expect(archive.data.account_balances[0].checked_on).toBe('2026-11-07');
});
