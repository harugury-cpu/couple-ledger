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
  return assetRows(s.accounts, computeLines(s.lines, s.entries, s.adjustments), s.balances, s.assetCarry, year, s.deposits, s.lastMonth);
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
  // 금액이 적힌 달은 아직 안 온 12월도 원금에 넣는다.
  expect(rows[0].principal).toBe(1_050_000 + 200_000 - 30_000 + 900_000);
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

it('기록 시작 달 전 달은 표에 나오지 않고 원금에도 더하지 않는다', async () => {
  const { l, series, line } = await setup();
  for (let m = 1; m <= 12; m++) await l.setAmount((await line(2026, m)).id, 100_000);
  await l.setAmount((await line(2025, 12)).id, 50_000);
  await action(l, { type: 'account-save', name: '토스증권', kind: 'invest', target: null, principal: 4_498_939, start_month: '2026-11', series: [series[0]] });
  const { rows, visible } = await view(l);
  expect(visible).toEqual([11, 12]);
  expect(rows[0]).toMatchObject({ opening: 4_498_939, principal: 4_498_939 + 200_000 });
  // 시작 달이 없는 계좌가 함께 있으면 1월부터 보이고, 시작 달 계좌의 앞 달 칸은 비어 있다.
  await action(l, { type: 'account-save', name: '우리 적금', kind: 'ready', target: null, principal: 0, series: [series[1]] });
  const both = await view(l);
  expect(both.visible).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  expect(both.rows.find(r => r.account.name === '토스증권')!.months.slice(0, 10).every(m => m.amount === null)).toBe(true);
  // 다음 해 이월 원금은 시작 달부터 센다(2025년 12월 금액은 넣지 않는다).
  expect((await view(l, 2027)).rows.find(r => r.account.name === '토스증권')!.opening).toBe(4_498_939 + 200_000);
});

it('저축 줄을 연결하지 않은 계좌는 달 칸에 직접 적고, 적은 값이 만들어진 마지막 달까지 이어진다', async () => {
  const { l, series } = await setup(); // 2026년 12월까지 만들어져 있다
  await action(l, { type: 'account-save', name: '용돈 적립', kind: 'ready', target: null, principal: 0, start_month: '2026-10', series: [] });
  const [acc] = (await l.snapshot(2026, 11)).accounts;
  await action(l, { type: 'deposit', id: acc.id, year: 2026, month: 10, amount: 100_000 });
  let row = (await view(l)).rows[0];
  expect(row.months.map(m => [m.month, m.amount, m.carried])).toEqual([[10, 100_000, false], [11, 100_000, true], [12, 100_000, true]]);
  expect(row.principal).toBe(300_000);
  // 12월만 바꾸면 그 달부터 그 값, 0을 적으면 그 뒤로 0
  const done = await action(l, { type: 'deposit', id: acc.id, year: 2026, month: 12, amount: 0 });
  row = (await view(l)).rows[0];
  expect(row.months.map(m => m.amount)).toEqual([100_000, 100_000, 0]);
  await applyEditHistory(l, done.history_id!, 'undo');
  expect((await view(l)).rows[0].principal).toBe(300_000);
  // 다음 해 이월 원금은 지난해 이어 쓴 달까지 더한다. 아직 만들지 않은 달(2027년)은 이어 쓰지 않는다.
  const next = (await view(l, 2027)).rows[0];
  expect(next.opening).toBe(300_000);
  expect(next.months.every(m => m.amount === null)).toBe(true);
  // 저축 줄을 연결한 계좌는 직접 적을 수 없다.
  await action(l, { type: 'account-save', name: '토스', kind: 'invest', target: null, principal: 0, series: [series[0]] });
  const toss = (await l.snapshot(2026, 11)).accounts.find(a => a.name === '토스')!;
  await expect(action(l, { type: 'deposit', id: toss.id, year: 2026, month: 11, amount: 1 })).rejects.toThrow('월별 표');
  // 백업에 입금 기록이 남고 그대로 복원된다.
  const archive = await l.exportArchive();
  expect(archive.data.account_deposits).toHaveLength(1);
  const copy = make(); await copy.importArchive(archive);
  expect((await copy.exportArchive()).data.account_deposits).toEqual(archive.data.account_deposits);
});

it('연결한 저축 줄이 하나인 달은 그 줄을 칸에서 고칠 수 있고, 둘 이상이면 월별 표에서 고친다', async () => {
  const { l, series, line } = await setup();
  await action(l, { type: 'account-save', name: '우리', kind: 'ready', target: null, principal: 0, start_month: '2026-11', series: [series[0]] });
  await action(l, { type: 'account-save', name: '토스', kind: 'invest', target: null, principal: 0, start_month: '2026-11', series: [series[1], series[2]] });
  const { rows } = await view(l);
  expect(rows.find(r => r.account.name === '우리')!.months[0].lineId).toBe((await line(2026, 11, 0)).id);
  expect(rows.find(r => r.account.name === '토스')!.months.every(m => m.lineId === null)).toBe(true);
});

it('아직 오지 않은 달은 회색으로 보이고 총 원금·그래프에 넣지 않는다', async () => {
  const { l, series } = await setup();
  await action(l, { type: 'account-save', name: '우리', kind: 'ready', target: null, principal: 1_000, start_month: '2026-11', series: [series[0]] });
  await action(l, { type: 'account-save', name: '용돈 적립', kind: 'ready', target: null, principal: 0, start_month: '2026-11', series: [] });
  const s = await l.snapshot(2026, 11);
  const nov = s.lines.find(r => r.month === 11 && r.series_id === series[0])!; const dec = s.lines.find(r => r.month === 12 && r.series_id === series[0])!;
  await l.setAmount(nov.id, 100); await l.setAmount(dec.id, 200);
  await action(l, { type: 'deposit', id: s.accounts.find(a => a.name === '용돈 적립')!.id, year: 2026, month: 11, amount: 50 });
  const t = await l.snapshot(2026, 11);
  const result = assetRows(t.accounts, computeLines(t.lines, t.entries, t.adjustments), t.balances, t.assetCarry, 2026, t.deposits, t.lastMonth, 2026 * 12 + 11);
  const ours = result.rows.find(r => r.account.name === '우리')!;
  expect(ours.months.map(m => [m.amount, m.future])).toEqual([[100, false], [200, true]]);
  expect(ours.principal).toBe(1_100);
  const extra = result.rows.find(r => r.account.name === '용돈 적립')!;
  expect(extra.months.map(m => [m.amount, m.future])).toEqual([[50, false], [50, true]]);
  expect(extra.principal).toBe(50);
  expect(result.history.map(h => h.month)).toEqual([11]);
});

it('기록 시작 달 전 달 칸은 막혀 있고, 거기 남은 입금은 보이지도 더해지지도 않는다', async () => {
  const { l } = await setup();
  await action(l, { type: 'account-save', name: '우리', kind: 'ready', target: null, principal: 0, start_month: '2026-10', series: [] });
  await action(l, { type: 'account-save', name: '퇴직연금', kind: 'invest', target: null, principal: 1_000, start_month: '2026-12', series: [] });
  const id = (await l.snapshot(2026, 11)).accounts.find(a => a.name === '퇴직연금')!.id;
  await action(l, { type: 'deposit', id, year: 2026, month: 11, amount: 500 });
  const row = (await view(l)).rows.find(r => r.account.name === '퇴직연금')!;
  // 시작 달 전 입금은 뒤 달로 이어지지도 않는다.
  expect(row.months.map(m => [m.month, m.before, m.amount])).toEqual([[10, true, null], [11, true, null], [12, false, null]]);
  expect(row.principal).toBe(1_000);
});
