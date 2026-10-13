import { afterEach, describe, expect, it } from 'vitest';
import { Ledger } from '../src/db/ledger';
import { categories, entries, monthLines } from '../src/db/schema';
const opened: Ledger[] = [];
function ledger() { const l = new Ledger(':memory:'); opened.push(l); return l; }
afterEach(() => { opened.forEach(l => l.client.close()); opened.length = 0; });
describe('초기 DB', () => {
  it('양식의 줄 순서·구역·명의·입력 방식을 보존한다', async () => {
    const l = ledger(); const lines = await l.month(2026, 10);
    expect(lines).toHaveLength(29);
    expect(lines.slice(0, 5).map(l => l.name)).toEqual(['쇼핑 멤버십', 'OTT 구독', '가전 구독', '종합 보험', '가스비']);
    expect(lines.filter(l => l.section === 'fixed')).toHaveLength(15);
    expect(lines.filter(l => l.saving_owner === 'a')).toHaveLength(4);
    expect(lines.every(l => l.budget === 0)).toBe(true);
    expect(lines.find(l => l.name === '용돈 A')?.input_mode).toBe('fixed');
    expect(await l.db.select().from(entries)).toHaveLength(0);
    expect(await l.db.select().from(categories)).toHaveLength(7);
  });
  it('같은 달을 여러 번 열어도 중복되지 않는다', async () => {
    // 달 보기는 DB에 쓰지 않는다. 몇 번 봐도 같은 줄(같은 id)이 보이고, 실제로 만드는 것도 한 번만 된다.
    const l = ledger(); const first = await l.month(2026, 1); const second = await l.month(2026, 1);
    expect(second.map(r => r.id)).toEqual(first.map(r => r.id));
    expect(await l.db.select().from(monthLines)).toHaveLength(0);
    await l.ensureMonth(2026, 1); await l.ensureMonth(2026, 1);
    expect((await l.db.select().from(monthLines)).map(r => r.id).sort()).toEqual(first.map(r => r.id).sort());
  });
});
