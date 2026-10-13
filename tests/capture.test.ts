import { afterEach, describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeLines } from '../src/lib/calculations';
import { captureDedupeKey, matchCaptureItems } from '../src/lib/capture-match';
import { parseCaptureResponse } from '../src/lib/capture-read';
import { matchRules, entries } from '../src/db/schema';
import { Ledger } from '../src/db/ledger';
import { LedgerCore, type LedgerOptions } from '../src/db/ledger-core';
import { LibsqlStore, migrateLocal } from '../src/db/store-libsql';
import type { Statement } from '../src/db/store';
import { createD1Ledger } from '../src/db/ledger-d1';
import { FakeD1 } from './fake-d1';

const opened: { close(): void }[] = [];
afterEach(() => { opened.forEach(client => client.close()); opened.length = 0; });
const clock: LedgerOptions = { today: () => ({ year: 2026, month: 10 }) };

function item(date = '10/02', merchant = 'OTT 구독', amount = 13_900) {
  return { date, merchant, amount, raw: `${date} ${merchant} ${amount.toLocaleString('ko-KR')}원` };
}

async function preparedLedger() {
  const ledger = new Ledger(':memory:', clock); opened.push(ledger.client); await ledger.ensureMonth(2026, 10); return ledger;
}

describe('명세서 매칭', () => {
  it('매칭 규칙 우선 → 줄 이름 → 미분류 순서로 고른다', async () => {
    const ledger = await preparedLedger();
    const lines = computeLines((await ledger.month(2026, 10)), [], []);
    const fixed = lines.find(line => line.name === '기타')!;
    const named = lines.find(line => line.name === 'OTT 구독')!;
    const ruleLine = lines.find(line => line.name === '가스비')!;
    const rules = [{ id: 'rule-1', payment_method_id: null, keyword: '정기결제', series_id: ruleLine.series_id }];
    const found = matchCaptureItems([item('10/01', '정기결제 OTT 구독'), item('10/02', 'OTT 구독'), item('10/03', '이름 없는 상점')], lines, rules, [], 2026, 10);
    expect(found[0].lineId).toBe(ruleLine.id);
    expect(found[1].lineId).toBe(named.id);
    expect(found[2].lineId).toBeNull();
    expect(fixed.id).not.toBe(found[2].lineId);
  });

  it('같은 캡처 묶음의 같은 거래도 각각 남기고, 다시 읽으면 두 건 모두 중복으로 표시한다', async () => {
    const ledger = await preparedLedger();
    const line = (await ledger.month(2026, 10)).find(row => row.name === '생활비')!;
    const first = matchCaptureItems([item('10/02', '동일마트'), item('10/02', '동일마트')], computeLines(await ledger.month(2026, 10), [], []), [], [], 2026, 10);
    expect(first[0].key).not.toBe(first[1].key);
    await ledger.addCaptured(2026, 10, first.map(entry => ({ ...entry, lineId: line.id, remember: false })));
    const existing = await ledger.db.select().from(entries);
    const second = matchCaptureItems([item('10/02', '동일마트'), item('10/02', '동일마트')], computeLines(await ledger.month(2026, 10), existing, []), [], existing, 2026, 10);
    expect(second.map(entry => entry.duplicate)).toEqual([true, true]);
    expect(existing.filter(entry => entry.source === 'capture')).toHaveLength(2);
    await ledger.addCaptured(2026, 10, second.map(entry => ({ ...entry, lineId: line.id, remember: false })));
    expect((await ledger.db.select().from(entries)).filter(entry => entry.source === 'capture')).toHaveLength(2);
  });

  it('미분류 거래를 기억하면 다음 매칭에서 같은 줄로 붙는다', async () => {
    const ledger = await preparedLedger();
    const line = (await ledger.month(2026, 10)).find(row => row.name === '생활비')!;
    const read = item('10/02', '새로운마트');
    const [matched] = matchCaptureItems([read], computeLines(await ledger.month(2026, 10), [], []), [], [], 2026, 10);
    await ledger.addCaptured(2026, 10, [{ ...matched, lineId: line.id, remember: true }]);
    const rules = await ledger.db.select().from(matchRules);
    expect(rules).toContainEqual(expect.objectContaining({ keyword: '새로운마트', series_id: line.series_id, payment_method_id: null }));
    const next = matchCaptureItems([read], computeLines(await ledger.month(2026, 10), await ledger.db.select().from(entries), []), rules, [], 2026, 10);
    expect(next[0].lineId).toBe(line.id);
  });
});

describe('명세서 확정 저장', () => {
  it('확정은 store.batch 한 번으로 처리하고 실패하면 아무것도 남기지 않는다', async () => {
    class FailingStore extends LibsqlStore {
      fail = false; calls = 0;
      override async batch(statements: Statement[]) {
        this.calls++;
        return super.batch(this.fail ? [...statements, { sql: 'INSERT INTO no_such_table VALUES (1)', params: [] }] : statements);
      }
    }
    const store = new FailingStore(':memory:'); opened.push(store);
    const ledger = new LedgerCore(store, clock); await ledger.ensureMonth(2026, 10);
    const line = (await ledger.month(2026, 10)).find(row => row.name === '생활비')!;
    const captured = { key: captureDedupeKey(2026, 10, '10/02', '테스트마트', 1200, 0), lineId: line.id, amount: 1200, raw: '테스트마트 1,200원', remember: false, merchant: '테스트마트' };
    store.fail = true; store.calls = 0;
    await expect(ledger.addCaptured(2026, 10, [captured])).rejects.toThrow();
    expect(store.calls).toBe(1);
    expect((await ledger.db.select().from(entries)).filter(entry => entry.source === 'capture')).toHaveLength(0);
  });
});

describe('0003 마이그레이션과 Gemini 응답 파싱', () => {
  it('기존 entries를 보존하고 capture source와 dedupe_key를 쓸 수 있다 (libSQL)', async () => {
    const url = ':memory:';
    const client = createClient({ url }); opened.push(client);
    await client.executeMultiple(readFileSync(resolve('migrations/0001_init.sql'), 'utf8'));
    await client.execute("INSERT INTO members VALUES ('local-owner', '', '사용자', 'owner')");
    await client.execute("INSERT INTO categories VALUES ('category-0', '고정비', 0)");
    await client.execute("INSERT INTO payment_methods VALUES ('payment-0', '카드', 'card', '공통')");
    await client.execute("INSERT INTO ledger_months (year, month, special_prompt_seen) VALUES (2026, 10, 0)");
    await client.execute("INSERT INTO month_lines (id,year,month,series_id,section,name,budget,input_mode,one_off,sort) VALUES ('line-1',2026,10,'series-1','fixed','기존',0,'manual',0,0)");
    await client.execute("INSERT INTO entries (id,month_line_id,amount,source,raw_text,created_by,created_at) VALUES ('entry-1','line-1',100,'manual',NULL,'local-owner','2026-10-01T00:00:00.000Z')");
    await migrateLocal(client, resolve('migrations'));
    expect((await client.execute('SELECT amount, source FROM entries WHERE id = \'entry-1\'')).rows[0]).toMatchObject({ amount: 100, source: 'manual' });
    await client.execute("INSERT INTO entries (id,month_line_id,amount,source,raw_text,dedupe_key,created_by,created_at) VALUES ('entry-2','line-1',200,'capture','원문','capture:2026-10:10/02:테스트:200:0','local-owner','2026-10-02T00:00:00.000Z')");
    expect((await client.execute('SELECT source, dedupe_key FROM entries WHERE id = \'entry-2\'')).rows[0]).toMatchObject({ source: 'capture', dedupe_key: 'capture:2026-10:10/02:테스트:200:0' });
  });

  it('Fake D1에도 0003 표 구조가 적용된다', async () => {
    const d1 = new FakeD1(); opened.push(d1.client); await d1.migrate();
    const ledger = createD1Ledger(d1, clock); await ledger.ensureMonth(2026, 10);
    const line = (await ledger.month(2026, 10)).find(row => row.name === '생활비')!;
    await ledger.addCaptured(2026, 10, [{ key: captureDedupeKey(2026, 10, '10/02', 'D1마트', 900, 0), lineId: line.id, amount: 900, raw: 'D1마트 900원', remember: false, merchant: 'D1마트' }]);
    expect((await d1.client.execute("SELECT source FROM entries WHERE source = 'capture'")).rows).toHaveLength(1);
  });

  it('D1에서 150건을 한 번에 확정하고(값 100개 제한), 금액을 고쳐 넣어도 같은 캡처를 다시 올리면 이미 있음이다', async () => {
    const d1 = new FakeD1(); opened.push(d1.client); await d1.migrate();
    const ledger = createD1Ledger(d1, clock); await ledger.ensureMonth(2026, 10);
    const lines = await ledger.month(2026, 10);
    const line = lines.find(row => row.name === '생활비')!;
    const read = Array.from({ length: 150 }, (_, i) => item('10/02', `마트${i}`, 1000 + i));
    const matched = matchCaptureItems(read, computeLines(lines, [], []), [], [], 2026, 10);
    // 첫 건은 읽기 오류를 고쳐 다른 금액으로 넣는다. 나머지는 미분류에서 줄을 고르고 기억한다.
    const inserted = await ledger.addCaptured(2026, 10, matched.map((m, i) => ({ key: m.key, lineId: line.id, amount: i === 0 ? 9999 : m.amount, raw: m.raw, remember: true, merchant: m.merchant })));
    expect(inserted).toBe(150);
    const existing = await ledger.db.select().from(entries);
    const again = matchCaptureItems(read, computeLines(await ledger.month(2026, 10), existing, []), [], existing, 2026, 10);
    expect(again.every(m => m.duplicate)).toBe(true);
    expect(existing.find(e => e.dedupe_key === matched[0].key)?.amount).toBe(9999);
    expect(await ledger.db.select().from(matchRules)).toHaveLength(150);
    // 같은 150건을 다시 확정해도 늘지 않는다.
    expect(await ledger.addCaptured(2026, 10, again.map(m => ({ key: m.key, lineId: line.id, amount: m.amount, raw: m.raw, remember: true, merchant: m.merchant })))).toBe(0);
    expect((await ledger.db.select().from(entries)).filter(e => e.source === 'capture')).toHaveLength(150);
  });

  it('Gemini JSON 응답을 네트워크 없이 검증하고 읽는다', () => {
    const payload = { candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [item('2026-10-02', '테스트마트', -1200)] }) }] } }] };
    expect(parseCaptureResponse(payload)).toEqual([item('2026-10-02', '테스트마트', -1200)]);
    expect(() => parseCaptureResponse({ candidates: [{ content: { parts: [{ text: '{"items":[{"date":"bad"}]}' }] } }] })).toThrow('명세서 내용을 읽지 못했습니다.');
  });
});
