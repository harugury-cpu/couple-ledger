import { afterEach, expect, it } from 'vitest';
import { Ledger } from '../src/db/ledger';
import { validateArchive } from '../src/lib/archive';
import { accountRows, accountTotals, balanceHistory } from '../src/lib/calculations';
const opened: Ledger[] = [];
const make = () => { const l = new Ledger(':memory:'); opened.push(l); return l; };
afterEach(() => { opened.forEach(l => l.client.close()); opened.length = 0; });

async function sample() {
  const l = make();
  await l.saveAccount('비상금', 'ready', 6_000_000); await l.saveAccount('여유 계좌', 'reserved', null); await l.saveAccount('적금 A', 'invest', null);
  const s = await l.snapshot(2026, 10); const id = (name: string) => s.accounts.find(a => a.name === name)!.id;
  await l.setBalance(id('비상금'), 2026, 8, 1_200_000); await l.setBalance(id('비상금'), 2026, 10, 950_000);
  await l.setBalance(id('여유 계좌'), 2026, 9, 2_100_000);
  await l.setBalance(id('적금 A'), 2025, 12, 5_000_000); await l.setBalance(id('적금 A'), 2026, 10, 5_320_000);
  return { l, id };
}

it('고른 달 잔액, 마지막 기록, 바로 앞 기록 대비 증감을 계산한다', async () => {
  const { l } = await sample(); const s = await l.snapshot(2026, 10);
  const rows = accountRows(s.accounts, s.balances, 2026, 10); const row = (name: string) => rows.find(r => r.name === name)!;
  // 9월을 건너뛰어도 바로 앞 기록(8월)과 비교한다.
  expect(row('비상금')).toMatchObject({ entered: 950_000, change: -250_000, previous: { month: 8 } });
  // 10월에 적지 않은 계좌는 9월 값으로 세고 증감은 없다.
  expect(row('여유 계좌')).toMatchObject({ entered: null, change: null, latest: { month: 9, amount: 2_100_000 } });
  // 지난해 기록과도 비교한다.
  expect(row('적금 A')).toMatchObject({ entered: 5_320_000, change: 320_000, previous: { year: 2025, month: 12 } });
  expect(accountTotals(rows)).toEqual({ ready: 950_000, reserved: 2_100_000, invest: 5_320_000, total: 8_370_000 });
});

it('아직 기록이 없는 달은 그 전 기록만으로 센다', async () => {
  const { l } = await sample(); const s = await l.snapshot(2026, 10);
  const july = accountRows(s.accounts, s.balances, 2026, 7);
  expect(july.find(r => r.name === '비상금')).toMatchObject({ entered: null, latest: null });
  expect(accountTotals(july)).toEqual({ ready: 0, reserved: 0, invest: 5_000_000, total: 5_000_000 });
});

it('월별 합계는 그 해 마지막 기록 달까지 만든다', async () => {
  const { l } = await sample(); const s = await l.snapshot(2026, 10);
  const history = balanceHistory(s.accounts, s.balances, 2026);
  expect(history).toHaveLength(10);
  expect(history[6]).toEqual({ month: 7, assets: 5_000_000 });
  expect(history[7]).toEqual({ month: 8, assets: 6_200_000 });
  expect(history[9]).toEqual({ month: 10, assets: 8_370_000 });
  expect(balanceHistory(s.accounts, s.balances, 2027)).toEqual([]);
  // 지난해 기록이 없으면 처음 적은 달부터 시작한다.
  const fresh = s.balances.filter(b => b.year === 2026);
  expect(balanceHistory(s.accounts, fresh, 2026).map(r => r.month)).toEqual([8, 9, 10]);
  expect(balanceHistory(s.accounts, fresh, 2026)[0]).toEqual({ month: 8, assets: 1_200_000 });
});

it('잔액을 다시 적으면 바뀌고, 비우면 기록이 지워진다', async () => {
  const { l, id } = await sample();
  await l.setBalance(id('비상금'), 2026, 10, 1_000_000); await l.setBalance(id('여유 계좌'), 2026, 9, null);
  const s = await l.snapshot(2026, 10);
  expect(s.balances.filter(b => b.account_id === id('비상금') && b.month === 10).map(b => b.amount)).toEqual([1_000_000]);
  expect(s.balances.some(b => b.account_id === id('여유 계좌'))).toBe(false);
});

it('계좌 이름·묶음·목표를 고치고, 같은 이름과 없는 계좌는 거절한다', async () => {
  const { l, id } = await sample();
  await l.saveAccount('비상금 통장', 'reserved', null, id('비상금'));
  expect((await l.snapshot(2026, 10)).accounts.find(a => a.id === id('비상금'))).toMatchObject({ name: '비상금 통장', kind: 'reserved', target: null, sort: 0 });
  await expect(l.saveAccount('적금 A', 'ready', null)).rejects.toThrow('같은 이름');
  await expect(l.saveAccount('없음', 'ready', null, 'missing')).rejects.toThrow('찾을 수 없습니다');
  await expect(l.setBalance('missing', 2026, 10, 1)).rejects.toThrow('찾을 수 없습니다');
  await expect(l.setBalance(id('비상금'), 2026, 13, 1)).rejects.toThrow();
  await expect(l.saveAccount('음수 목표', 'ready', -1)).rejects.toThrow();
});

it('계좌를 지우면 그 계좌의 잔액 기록도 지워진다', async () => {
  const { l, id } = await sample(); const target = id('비상금');
  await l.deleteAccount(target); const s = await l.snapshot(2026, 10);
  expect(s.accounts.map(a => a.name)).toEqual(['여유 계좌', '적금 A']);
  expect(s.balances.some(b => b.account_id === target)).toBe(false); expect(s.balances).toHaveLength(3);
  await expect(l.deleteAccount(target)).rejects.toThrow('찾을 수 없습니다');
});

it('계좌와 잔액은 월별 표의 줄·금액을 바꾸지 않는다', async () => {
  const l = make(); const before = await l.snapshot(2026, 10);
  await l.saveAccount('비상금', 'ready', null); const { accounts } = await l.snapshot(2026, 10); await l.setBalance(accounts[0].id, 2026, 10, 100);
  const after = await l.snapshot(2026, 10);
  expect({ ...after, accounts: [], balances: [] }).toEqual({ ...before, accounts: [], balances: [] });
});

it('JSON 내보내기·가져오기에 계좌와 잔액이 포함된다', async () => {
  const { l } = await sample(); const archive = await l.exportArchive();
  expect(archive.data.accounts).toHaveLength(3); expect(archive.data.account_balances).toHaveLength(5);
  const b = make(); await b.importArchive(archive);
  expect((await b.exportArchive()).data).toEqual(archive.data);
  expect(accountTotals(accountRows((await b.snapshot(2026, 10)).accounts, (await b.snapshot(2026, 10)).balances, 2026, 10)).total).toBe(8_370_000);
});

it('잔액 화면 이전에 내보낸 JSON도 읽히고, 가져오면 계좌는 비어 있다', async () => {
  const { l } = await sample(); const archive = await l.exportArchive();
  const { accounts: _a, account_balances: _b, ...old } = archive.data;
  expect(validateArchive({ ...archive, data: old }).data.accounts).toEqual([]);
  await l.importArchive({ ...archive, data: old });
  const s = await l.snapshot(2026, 10); expect(s.accounts).toEqual([]); expect(s.balances).toEqual([]);
});

it('없는 계좌의 잔액·중복 달·같은 계좌 이름이 든 JSON은 거부한다', async () => {
  const { l } = await sample(); const archive = await l.exportArchive(); const d = archive.data;
  const invalids = [
    { ...d, account_balances: [...d.account_balances, { ...d.account_balances[0], id: 'x', account_id: 'missing' }] },
    { ...d, account_balances: [...d.account_balances, { ...d.account_balances[0], id: 'x' }] },
    { ...d, accounts: [...d.accounts, { ...d.accounts[0], id: 'x' }] },
    { ...d, accounts: d.accounts.map((a, i) => i ? a : { ...a, kind: 'other' }) },
  ];
  for (const data of invalids) { await expect(l.importArchive({ ...archive, data })).rejects.toThrow(); expect((await l.exportArchive()).data).toEqual(d); }
});
