import { afterEach, expect, it } from 'vitest';
import { handleApi, type ApiContext } from '../src/server/api';
import { createD1Ledger } from '../src/db/ledger-d1';
import { FakeD1 } from './fake-d1';

// 운영(Cloudflare D1)과 같은 길로 자산 표 칸에서 보내는 요청을 그대로 보낸다.
const opened: FakeD1[] = [];
afterEach(() => { opened.forEach(db => db.client.close()); opened.length = 0; });
async function fixture() {
  const db = new FakeD1(); opened.push(db); await db.migrate();
  const ledger = createD1Ledger(db, { today: () => ({ year: 2026, month: 11 }) });
  await ledger.ensureMonth(2026, 12);
  const ctx: ApiContext = { resolve: async () => ({ ledger }) };
  return { ledger, ctx };
}
const post = (ctx: ApiContext, body: unknown) => handleApi(new Request('https://ledger.example/api/ledger', {
  method: 'POST', body: JSON.stringify(body),
  headers: { host: 'ledger.example', origin: 'https://ledger.example', 'Content-Type': 'application/json', 'X-Ledger-Operation': crypto.randomUUID() },
}), ctx);

it('자산 표 칸 입력(이월 원금·달 원금·직접 입금·평가금액)이 D1에서 저장된다', async () => {
  const { ledger, ctx } = await fixture();
  const saving = (await ledger.month(2026, 11)).find(r => r.section === 'saving')!;
  for (const body of [
    { type: 'account-save', name: '우리', kind: 'ready', target: null, principal: 300_000, due_on: null, series: [saving.series_id], start_month: '2026-11' },
    { type: 'account-save', name: '부모님 적립', kind: 'ready', target: null, principal: 0, due_on: null, series: [], start_month: '2026-11' },
    { type: 'account-save', name: 'ISA', kind: 'invest', target: null, principal: 1_000, due_on: null, series: [], start_month: '2026-11' },
  ]) { const r = await post(ctx, body); expect(r.status, await r.clone().text()).toBe(200); }
  const accounts = (await ledger.snapshot(2026, 11)).accounts;
  const id = (name: string) => accounts.find(a => a.name === name)!.id;
  const ours = accounts.find(a => a.name === '우리')!;
  for (const body of [
    // 이월 원금 칸(시작 원금 맞추기)
    { type: 'account-save', id: ours.id, name: ours.name, kind: ours.kind, target: ours.target, principal: 450_000, due_on: ours.due_on, series: JSON.parse(ours.series), start_month: ours.start_month },
    { type: 'amount', id: saving.id, amount: 350_000 },
    { type: 'deposit', id: id('부모님 적립'), year: 2026, month: 11, amount: 500_000 },
    { type: 'balance', id: id('ISA'), year: 2026, month: 11, amount: 2_000, checked_on: '2026-11-07' },
  ]) { const r = await post(ctx, body); expect(r.status, `${JSON.stringify(body)} → ${await r.clone().text()}`).toBe(200); }
  const s = await ledger.snapshot(2026, 11);
  expect(s.accounts.find(a => a.name === '우리')!.principal).toBe(450_000);
  expect(s.deposits).toHaveLength(1);
  expect(s.balances[0]).toMatchObject({ amount: 2_000, checked_on: '2026-11-07' });
});
