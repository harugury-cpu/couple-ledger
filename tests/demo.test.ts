import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { createDemoLedger, handleDemoRequest } from '../src/demo/demo-ledger';
import { computeLines, savingsRows } from '../src/lib/calculations';

const migrations = readdirSync('migrations').filter(f => f.endsWith('.sql')).map(name => ({ name, sql: readFileSync(`migrations/${name}`, 'utf8') }));
// 2026-10-13 오후 3시(한국 시간)
const now = new Date('2026-10-13T06:00:00Z');
async function demo() {
  const SQL = await initSqlJs();
  return createDemoLedger(new SQL.Database(), migrations, now);
}
describe('공유용 데모 가계부', () => {
  it('화면에 보이는 이름은 예시 이름이다', async () => {
    const core = await demo();
    const s = await core.snapshot(2026, 10);
    const names = [...s.lines.map(l => l.name), ...s.categories.map(c => c.name), ...s.paymentMethods.map(p => p.name), ...s.accounts.map(a => a.name)];
    expect(names.length).toBeGreaterThan(30);
    expect(names).toEqual(expect.arrayContaining(['휴대폰 A', '휴대폰 B', '용돈 A', '용돈 B', 'A은행', '비상금']));
  });

  it('1월~이번 달을 채우고, 이번 달은 결제일이 지난 줄까지만 채운다', async () => {
    const core = await demo();
    const s = await core.snapshot(2026, 10);
    const lines = computeLines(s.lines, s.entries, s.adjustments);
    const september = lines.filter(l => l.month === 9);
    expect(september.filter(l => l.series_id !== 'initial-28' && l.series_id !== 'initial-25').every(l => l.hasEntry)).toBe(true);
    const october = lines.filter(l => l.month === 10);
    expect(october.filter(l => l.pay_day !== null && l.pay_day <= 13 && l.input_mode !== 'fixed').every(l => l.hasEntry)).toBe(true);
    expect(october.some(l => !l.hasEntry)).toBe(true);
    const rows = savingsRows(2026, lines, s.uses, 12_000_000);
    expect(rows[9].assets).toBeGreaterThan(rows[0].assets);
    expect(s.specials.some(e => e.month === 9)).toBe(true);
    expect(s.balances.length).toBe(4 * 10);
  });

  it('화면의 요청을 브라우저 안 가계부가 처리하고, 서버 기능은 막는다', async () => {
    const core = await demo();
    const get = await handleDemoRequest(core, new URL('http://x/api/ledger?year=2026&month=10'));
    const snapshot = await get!.json();
    const line = snapshot.lines.find((l: { month: number; series_id: string }) => l.month === 10 && l.series_id === 'initial-17');
    const post = await handleDemoRequest(core, new URL('http://x/api/ledger'), { method: 'POST', body: JSON.stringify({ type: 'amount', id: line.id, amount: 123_400 }) });
    expect(post!.status).toBe(200);
    const after = await core.snapshot(2026, 10);
    expect(computeLines(after.lines, after.entries, after.adjustments).find(l => l.id === line.id)!.actual).toBe(123_400);
    expect((await handleDemoRequest(core, new URL('http://x/api/capture/read'), { method: 'POST' }))!.status).toBe(400);
    expect((await handleDemoRequest(core, new URL('http://x/api/ledger'), { method: 'POST', body: '{"type":"amount"}' }))!.status).toBe(400);
    expect(await handleDemoRequest(core, new URL('http://x/_next/static/a.js'))).toBeNull();
  });
});
