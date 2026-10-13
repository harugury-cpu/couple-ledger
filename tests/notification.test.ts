import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { Ledger } from '../src/db/ledger';
import { createD1Ledger } from '../src/db/ledger-d1';
import type { LedgerCore } from '../src/db/ledger-core';
import { NotificationInbox } from '../src/db/notification-inbox';
import { entries, matchRules, monthLines, notificationEvents, paymentMethods, ledgerMonths } from '../src/db/schema';
import { authorizedIngest, notificationMonth, notificationSchema, parseNotification, readNotification } from '../src/lib/notification';
import type { NotificationInput } from '../src/lib/notification';
import { validateArchive } from '../src/lib/archive';
import { FakeD1 } from './fake-d1';

const context = vi.hoisted(() => ({ ledger: null as LedgerCore | null, denied: false }));
vi.mock('../src/db/request-ledger', async () => {
  const { authorizedIngest } = await import('../src/lib/notification');
  class AccessDenied extends Error {}
  return { AccessDenied,
    requestNotificationLedger: async (headers: Headers) => {
      if (!await authorizedIngest(headers, 'a'.repeat(32))) throw new AccessDenied();
      return context.ledger!;
    },
    requestLedger: async () => { if (context.denied) throw new AccessDenied(); return context.ledger!; },
  };
});
import * as ingest from '../src/app/api/ingest/route';
import * as web from '../src/app/api/notifications/route';

const opened: { close(): void }[] = [];
afterEach(() => { opened.forEach(client => client.close()); opened.length = 0; context.denied = false; vi.restoreAllMocks(); });
const input: NotificationInput = { app: '삼성카드', title: '삼성카드 승인', text: '김*수님\n10/10 12:34\nOTT 구독\n13,900원 일시불\n누적 45,000원' };
const raw = `${input.title}\n${input.text}`;
const token = 'a'.repeat(32);
function request(body: unknown, authorization: string | null = `Bearer ${token}`, url = 'http://localhost/api/ingest') {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization && { authorization }) }, body: JSON.stringify(body) });
}
async function prepared(d1: boolean, credit = false) {
  const clock = { today: () => ({ year: 2026, month: 10 }) };
  const fake = d1 ? new FakeD1() : null;
  if (fake) { opened.push(fake.client); await fake.migrate(); }
  const ledger = fake ? createD1Ledger(fake, clock) : new Ledger(':memory:', clock);
  if (ledger instanceof Ledger) opened.push(ledger.client);
  await ledger.ensureMonth(2026, 10);
  await ledger.savePayment('카드', 'card', '공통', 'payment-0', { notify_app: '삼성카드', billing_kind: credit ? 'credit' : 'debit', cutoff_day: 20 });
  const line = (await ledger.month(2026, 10)).find(row => row.name === 'OTT 구독')!;
  await ledger.store.batch([
    { sql: "UPDATE month_lines SET input_mode='card' WHERE id=?", params: [line.id] },
    { sql: 'INSERT INTO match_rules (id,payment_method_id,keyword,series_id) VALUES (?,?,?,?)', params: ['rule', 'payment-0', 'OTT 구독', line.series_id] },
  ]);
  let now = new Date('2026-10-10T03:34:00Z');
  const inbox = new NotificationInbox(ledger, () => now);
  context.ledger = ledger;
  const notificationEntries = () => ledger.db.select().from(entries).where(eq(entries.source, 'notification'));
  const events = () => ledger.db.select().from(notificationEvents);
  return { ledger, fake, inbox, line, notificationEntries, events, advance: (ms: number) => { now = new Date(now.valueOf() + ms); } };
}
async function pending(inbox: NotificationInbox) { return (await inbox.list(2026, 10)).pending[0]; }

 describe('알림 원문 계약·읽기·청구월', () => {
  it('누적 금액 대신 결제 금액을 읽고 일부 값도 보존한다', () => {
    expect(parseNotification(raw, '2026-10-10T03:34:00Z')).toEqual({ date: '2026-10-10', merchant: 'OTT 구독', amount: 13900 });
    expect(readNotification('삼성카드 승인\n마트', '2026-10-10T03:34:00Z')).toMatchObject({ merchant: '마트', amount: null, transaction: null });
  });
  it('취소는 음수, 날짜가 없으면 서울 수신 날짜를 쓴다', () => {
    expect(parseNotification('승인취소\n마트\n1,000원', '2026-10-09T16:00:00Z')).toEqual({ date: '2026-10-10', merchant: '마트', amount: -1000 });
  });
  it.each(['-', '−', '－'])('알림에 적힌 음수 금액은 취소 문구가 없어도 부호를 보존한다: %s', minus => {
    expect(parseNotification(`삼성카드 승인\n10/10 12:34\nOTT 구독\n${minus}13,900원 환불`, '2026-10-10T03:34:00Z')?.amount).toBe(-13900);
  });
  it('가맹점 후보가 둘이면 일부 읽기에서도 임의로 첫 줄을 고르지 않는다', () => {
    expect(readNotification('승인\n마트\n알 수 없는 안내', '2026-10-10T03:34:00Z')).toMatchObject({
      date: '2026-10-10', merchant: null, amount: null, transaction: null,
    });
  });
  it.each(['카드 청구 예정\nOTT 구독\n13,900원', '승인\n마트\n약국\n1,000원', '승인\n마트\n1,000원 2,000원', '승인\n02/30 12:34\n마트\n100원'])('불확실한 형식은 review 후보: %s', text => {
    expect(parseNotification(text, '2026-10-10T03:34:00Z')).toBeNull();
  });
  it('연초 12월 결제는 전년도, 신용 마감일 전후는 다음/다다음 달', () => {
    expect(parseNotification(raw.replace('10/10', '12/31'), '2027-01-01T00:00:00Z')?.date).toBe('2026-12-31');
    expect(notificationMonth('2026-12-20', { billing_kind: 'credit', cutoff_day: 20 })).toEqual({ year: 2027, month: 1 });
    expect(notificationMonth('2026-12-21', { billing_kind: 'credit', cutoff_day: 20 })).toEqual({ year: 2027, month: 2 });
    for (const billing_kind of ['debit', 'transfer'] as const)
      expect(notificationMonth('2026-12-21', { billing_kind, cutoff_day: 20 })).toEqual({ year: 2026, month: 12 });
  });
  it('필수 3개만 받고 빈 제목과 추가 키를 허용한다', () => {
    expect(notificationSchema.parse({ ...input, title: '', deviceId: 'ignored', billing: 'ignored' })).toEqual({ ...input, title: '' });
    for (const body of [{}, { ...input, app: 1 }, { ...input, title: null }, { ...input, text: false }])
      expect(notificationSchema.safeParse(body).success).toBe(false);
  });
  it('정확한 bearer만 통과하고 설정 없는 인증은 닫는다', async () => {
    expect(await authorizedIngest(new Headers({ authorization: `Bearer ${token}` }), token)).toBe(true);
    for (const configured of [undefined, 'short', 'b'.repeat(32)])
      expect(await authorizedIngest(new Headers({ authorization: `Bearer ${token}` }), configured)).toBe(false);
    expect(await authorizedIngest(new Headers({ 'cf-access-jwt-assertion': token }), token)).toBe(false);
  });
 });

describe.each([false, true])('MacroDroid 서버와 웹 API (D1=%s)', d1 => {
  it('토큰 없음/틀림 401, 필수 누락/타입 오류 400, 모르는 키 무시', async () => {
    await prepared(d1);
    for (const auth of [null, `Bearer ${'b'.repeat(32)}`]) expect((await ingest.POST(request(input, auth))).status).toBe(401);
    for (const body of [{}, { app: '삼성카드', text: '원문' }, { ...input, title: 7 }]) expect((await ingest.POST(request(body))).status).toBe(400);
    const response = await ingest.POST(request({ ...input, unexpected: true }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'saved', lineName: 'OTT 구독' });
    expect(Object.keys(ingest).filter(key => ['GET', 'PATCH', 'DELETE'].includes(key))).toEqual([]);
  });
  it('MacroDroid 폼 형식 본문도 여러 줄 원문 그대로 받는다', async () => {
    const { notificationEntries } = await prepared(d1);
    const body = new URLSearchParams({ app: input.app, title: input.title, text: input.text }).toString();
    const response = await ingest.POST(new NextRequest('http://localhost/api/ingest', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', authorization: `Bearer ${token}` }, body }));
    expect(await response.json()).toEqual({ status: 'saved', lineName: 'OTT 구독' });
    expect(await notificationEntries()).toEqual([expect.objectContaining({ raw_text: raw })]);
  });
  it('MacroDroid가 줄바꿈을 그대로 끼워 넣은 JSON 본문도 받는다', async () => {
    const { notificationEntries } = await prepared(d1);
    const body = `{\n  "app": "${input.app}",\n  "title": "${input.title}",\n  "text": "${input.text}"\n}`;
    expect(() => JSON.parse(body)).toThrow();
    const response = await ingest.POST(new NextRequest('http://localhost/api/ingest', { method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` }, body }));
    expect(await response.json()).toEqual({ status: 'saved', lineName: 'OTT 구독' });
    expect(await notificationEntries()).toEqual([expect.objectContaining({ raw_text: raw })]);
  });
  it('토큰만으로 Access 안쪽 API를 열 수 없고 교차 출처 쓰기를 거절한다', async () => {
    await prepared(d1); context.denied = true;
    expect((await web.GET(new NextRequest('http://localhost/api/notifications?year=2026&month=10', { headers: { authorization: `Bearer ${token}` } }))).status).toBe(403);
    context.denied = false;
    const req = request({ type: 'discard', id: 'missing' }, null, 'http://localhost/api/notifications');
    req.headers.set('origin', 'https://other.example'); req.headers.set('host', 'localhost');
    expect((await web.POST(req)).status).toBe(400);
  });
  it('결제수단 0개도 카드 미지정 미분류로 보존한다', async () => {
    const { ledger, inbox, events, notificationEntries } = await prepared(d1);
    expect(await inbox.receive({ ...input, app: '알 수 없는 카드' })).toEqual({ status: 'review' });
    expect(await pending(inbox)).toMatchObject({ reason: '카드 미지정', paymentMethodId: null, raw });
    expect(await events()).toHaveLength(1); expect(await notificationEntries()).toHaveLength(0);
    expect((await ledger.snapshot(2026, 10)).notificationCount).toBe(1);
  });
  it('앱과 선택 키워드가 정확히 한 카드를 골라야 한다', async () => {
    const { ledger, inbox } = await prepared(d1);
    await ledger.savePayment('두번째', 'card', '공통', undefined, { notify_app: '삼성' });
    expect((await inbox.receive(input)).status).toBe('review');
    expect((await pending(inbox)).reason).toBe('카드 설정이 겹칩니다');
    const second = (await ledger.db.select().from(paymentMethods)).find(m => m.name === '두번째')!;
    await ledger.savePayment(second.name, 'card', '공통', second.id, { notify_keyword: '5678' });
    expect((await inbox.receive({ ...input, text: input.text.replace('12:34', '12:35') })).status).toBe('saved');
  });
  it('체크카드는 결제월에 자동 저장하고 원문·서버시각을 보관한다', async () => {
    const { inbox, line, notificationEntries, events } = await prepared(d1);
    expect(await inbox.receive(input)).toEqual({ status: 'saved', lineName: 'OTT 구독' });
    expect(await notificationEntries()).toEqual([expect.objectContaining({ amount: 13900, month_line_id: line.id, raw_text: raw })]);
    expect((await events())[0]).toMatchObject({ year: 2026, month: 10, created_at: '2026-10-10T03:34:00.000Z' });
  });
  it('신용카드 청구월은 서버 마감일과 다음/다다음 달로 결정한다', async () => {
    const { inbox, ledger, events } = await prepared(d1, true);
    await inbox.receive({ ...input, text: input.text.replace('10/10', '10/20') });
    await inbox.receive({ ...input, text: input.text.replace('10/10', '10/21') });
    expect((await events()).map(e => [e.year, e.month]).sort()).toEqual([[2026, 11], [2026, 12]]);
    expect((await ledger.db.select().from(ledgerMonths)).map(m => m.month).sort()).toEqual([10, 11, 12]);
  });
  it('읽기 실패는 원문과 일부 읽은 값을 미분류에 남긴다', async () => {
    const { inbox, notificationEntries } = await prepared(d1);
    const text = '삼성카드 승인\n10/10 12:34\n처음마트';
    expect((await inbox.receive({ ...input, title: '', text })).status).toBe('review');
    expect(await pending(inbox)).toMatchObject({ raw: text, date: '2026-10-10', merchant: '처음마트', amount: null });
    expect(await notificationEntries()).toHaveLength(0);
  });
  it('규칙 없음, 할부는 review이고 취소는 음수 저장', async () => {
    const { inbox, notificationEntries } = await prepared(d1);
    expect((await inbox.receive({ ...input, text: input.text.replace('OTT 구독', '처음마트') })).status).toBe('review');
    expect((await inbox.receive({ ...input, text: input.text.replace('일시불', '3개월 할부') })).status).toBe('review');
    expect((await inbox.receive({ ...input, title: '삼성카드 승인취소' })).status).toBe('saved');
    expect(await notificationEntries()).toEqual([expect.objectContaining({ amount: -13900 })]);
  });
  it('키워드 규칙은 카드 전체 규칙보다 우선하고 두 줄 충돌은 review', async () => {
    const { ledger, inbox } = await prepared(d1);
    const other = (await ledger.month(2026, 10)).find(l => l.name === '가스비')!;
    await ledger.store.batch([
      { sql: "UPDATE month_lines SET input_mode='card' WHERE id=?", params: [other.id] },
      { sql: 'INSERT INTO match_rules VALUES (?,?,?,?)', params: ['whole', 'payment-0', null, other.series_id] },
    ]);
    expect((await inbox.receive(input)).lineName).toBe('OTT 구독');
    await ledger.store.batch([{ sql: 'INSERT INTO match_rules VALUES (?,?,?,?)', params: ['conflict', 'payment-0', 'OTT', other.series_id] }]);
    expect((await inbox.receive({ ...input, text: input.text.replace('12:34', '12:35') })).status).toBe('review');
  });
  it('명세서에서 기억한 규칙(카드 없음)과 줄 이름으로 직접 입력 줄에도 넣고, 매달 같은 금액 줄은 넣지 않는다', async () => {
    const { ledger, inbox, line } = await prepared(d1);
    const gas = (await ledger.month(2026, 10)).find(l => l.name === '가스비')!;
    await ledger.store.batch([
      { sql: "UPDATE month_lines SET input_mode='manual' WHERE id=?", params: [line.id] },
      { sql: 'DELETE FROM match_rules', params: [] },
      { sql: 'INSERT INTO match_rules VALUES (?,?,?,?)', params: ['capture', null, '서울도시가스', gas.series_id] },
    ]);
    expect(await inbox.receive(input)).toEqual({ status: 'saved', lineName: 'OTT 구독' });
    const gasText = (time: string) => input.text.replace('12:34', time).replace('OTT 구독', '서울도시가스');
    expect(await inbox.receive({ ...input, text: gasText('12:36') })).toEqual({ status: 'saved', lineName: '가스비' });
    await ledger.store.batch([{ sql: "UPDATE month_lines SET input_mode='fixed' WHERE id=?", params: [gas.id] }]);
    expect((await inbox.receive({ ...input, text: gasText('12:37') })).status).toBe('review');
  });
  it('동시 재전송은 한 건만 저장하고 나머지는 duplicate', async () => {
    const { inbox, notificationEntries, events } = await prepared(d1);
    const results = await Promise.all([inbox.receive(input), inbox.receive(input), inbox.receive(input)]);
    expect(results.map(r => r.status).sort()).toEqual(['duplicate', 'duplicate', 'saved']);
    expect(await notificationEntries()).toHaveLength(1); expect(await events()).toHaveLength(1);
  });
  it('같은 가게·금액이라도 다른 승인 시각은 두 건 모두 저장', async () => {
    const { inbox, notificationEntries } = await prepared(d1);
    expect((await inbox.receive(input)).status).toBe('saved');
    expect((await inbox.receive({ ...input, text: input.text.replace('12:34', '12:35') })).status).toBe('saved');
    expect(await notificationEntries()).toHaveLength(2);
  });
  it('승인시각 키는 3분 이후·누적 안내 변경에도 중복을 잡는다', async () => {
    const { inbox, advance } = await prepared(d1);
    await inbox.receive(input); advance(24 * 3600_000);
    expect(await inbox.receive({ ...input, text: input.text.replace('45,000', '59,000') })).toEqual({ status: 'duplicate' });
  });
  it('시각 없는 원문은 정규화해 3분 안에만 중복 처리한다', async () => {
    const { inbox, advance, notificationEntries } = await prepared(d1);
    const unstamped = { ...input, text: input.text.replace('10/10 12:34\n', '') };
    await inbox.receive(unstamped); advance(179_999);
    expect((await inbox.receive({ ...unstamped, text: unstamped.text.replace('OTT 구독', ' OTT 구독 ') })).status).toBe('duplicate');
    advance(2);
    expect((await inbox.receive(unstamped)).status).toBe('saved');
    expect(await notificationEntries()).toHaveLength(2);
  });
  it('웹에서 넣기와 기억하기를 실행하면 다음 가맹점은 자동 저장', async () => {
    const { inbox, line, notificationEntries, ledger } = await prepared(d1);
    const merchantInput = { ...input, text: input.text.replace('OTT 구독', '처음마트') };
    await inbox.receive(merchantInput); const review = await pending(inbox);
    const response = await web.POST(request({ type: 'save', id: review.id, transaction: review.transaction, lineId: line.id, remember: true, paymentMethodId: 'payment-0' }, null, 'http://localhost/api/notifications'));
    expect(response.status).toBe(200); expect((await response.json()).event.status).toBe('saved');
    expect((await inbox.receive({ ...merchantInput, text: merchantInput.text.replace('12:34', '12:36') })).status).toBe('saved');
    expect(await notificationEntries()).toHaveLength(2);
    expect(await ledger.db.select().from(matchRules)).toContainEqual(expect.objectContaining({ keyword: '처음마트', payment_method_id: 'payment-0', series_id: line.series_id }));
  });
  it('카드 미지정은 웹에서 카드와 읽은 값 수정 후 넣을 수 있다', async () => {
    const { inbox, line } = await prepared(d1);
    await inbox.receive({ app: '카드앱', title: '', text: '읽을 수 없는 알림' });
    const event = await pending(inbox);
    expect((await inbox.save(event.id, { date: '2026-10-10', merchant: '마트', amount: 900 }, line.id, true, 'payment-0')).status).toBe('saved');
  });
  it('매달 같은 금액 줄은 기억하기 불가, 다른 청구월 선택도 거절', async () => {
    const { inbox, ledger } = await prepared(d1);
    await inbox.receive({ ...input, text: input.text.replace('OTT 구독', '처음마트') }); const event = await pending(inbox);
    const fixed = (await ledger.month(2026, 10)).find(l => l.input_mode === 'fixed' && l.section === 'variable')!;
    await expect(inbox.save(event.id, event.transaction!, fixed.id, true, 'payment-0')).rejects.toThrow('매달 같은 금액');
    const next = (await ledger.month(2026, 11)).find(l => l.name === 'OTT 구독')!;
    await expect(inbox.save(event.id, event.transaction!, next.id, false, 'payment-0')).rejects.toThrow('청구월');
  });
  it('자동 저장 기록 되돌리기 뒤 재전송은 다시 들어가지 않는다', async () => {
    const { inbox, notificationEntries, advance, events } = await prepared(d1);
    await inbox.receive(input); const id = (await events())[0].id;
    expect((await web.POST(request({ type: 'undo', id }, null, 'http://localhost/api/notifications'))).status).toBe(200);
    advance(3600_000); expect((await inbox.receive(input)).status).toBe('duplicate');
    expect(await notificationEntries()).toHaveLength(0); expect((await inbox.result(id)).status).toBe('undone');
    expect((await inbox.list(2026, 10)).history[0].status).toBe('undone');
  });
  it('버리기는 재전송과 중복 확정에서도 복원되지 않는다', async () => {
    const { inbox, advance, line } = await prepared(d1);
    const unknown = { ...input, text: '알 수 없는 원문' };
    await inbox.receive(unknown); const event = await pending(inbox);
    await inbox.discard(event.id); advance(3600_000);
    expect((await inbox.receive(unknown)).status).toBe('duplicate');
    expect((await inbox.list(2026, 10)).pending).toHaveLength(0);
    await expect(inbox.save(event.id, { date: '2026-10-10', merchant: '마트', amount: 1000 }, line.id, false, null)).rejects.toThrow('이미 처리');
  });
  it('수신과 월 생성·저장은 batch 한 번, 실패 시 모두 롤백', async () => {
    const { inbox, ledger, notificationEntries, events } = await prepared(d1, true);
    const original = ledger.store.batch.bind(ledger.store);
    const spy = vi.spyOn(ledger.store, 'batch').mockImplementation(statements => original([...statements, { sql: 'INSERT INTO no_such_table VALUES (1)', params: [] }]));
    await expect(inbox.receive(input)).rejects.toThrow(); expect(spy).toHaveBeenCalledTimes(1);
    expect(await notificationEntries()).toHaveLength(0); expect(await events()).toHaveLength(0);
    expect((await ledger.db.select().from(ledgerMonths)).map(m => m.month)).toEqual([10]);
    spy.mockImplementation(original); spy.mockClear(); await inbox.receive(input); expect(spy).toHaveBeenCalledTimes(1);
  });
  it('동시 미분류 확정은 entry와 기억 규칙을 한 번만 쓴다', async () => {
    const { inbox, line, ledger, notificationEntries } = await prepared(d1);
    await inbox.receive({ ...input, text: input.text.replace('OTT 구독', '처음마트') }); const event = await pending(inbox);
    await Promise.all([inbox.save(event.id, event.transaction!, line.id, true, 'payment-0'), inbox.save(event.id, event.transaction!, line.id, true, 'payment-0')]);
    expect(await notificationEntries()).toHaveLength(1);
    expect((await ledger.db.select().from(matchRules)).filter(r => r.keyword === '처음마트')).toHaveLength(1);
  });
  it('JSON 내보내기→가져오기에 새 설정·알림·되돌리기 흔적 포함', async () => {
    const { ledger, inbox, events } = await prepared(d1);
    await inbox.receive(input); await inbox.undo((await events())[0].id);
    await inbox.receive({ ...input, text: input.text.replace('OTT 구독', '처음마트') });
    const archive = await ledger.exportArchive(); expect(validateArchive(archive)).toEqual(archive);
    const target = await prepared(d1); await target.ledger.importArchive(archive);
    const restored = await target.ledger.exportArchive(); expect(restored.data).toEqual(archive.data);
    expect((await target.inbox.receive(input)).status).toBe('duplicate');
  });
  it('수신과 겹친 백업도 알림과 입력 기록이 같은 시점이다', async () => {
    const { ledger, inbox } = await prepared(d1);
    for (let i = 0; i < 6; i++) {
      const [, archive] = await Promise.all([
        inbox.receive({ ...input, text: input.text.replace('12:34', `12:${String(40 + i).padStart(2, '0')}`) }),
        ledger.exportArchive(),
      ]);
      for (const event of archive.data.notification_events.filter(e => e.status === 'saved'))
        expect(archive.data.entries.some(e => e.id === event.entry_id)).toBe(true);
      for (const entry of archive.data.entries.filter(e => e.source === 'notification'))
        expect(archive.data.notification_events.some(e => e.entry_id === entry.id)).toBe(true);
    }
  });
  it('미래 청구월의 자동 금액 대기 상태도 복원한다', async () => {
    const { ledger, inbox } = await prepared(d1, true);
    await inbox.receive(input);
    const archive = await ledger.exportArchive();
    const restored = await prepared(d1); await restored.ledger.importArchive(archive);
    expect((await restored.ledger.db.select().from(ledgerMonths)).find(m => m.month === 11)?.auto_filled).toBe(false);
  });
  it('예전 백업은 새 열·표 없이도 읽히고 이전 알림함을 대체한다', async () => {
    const { ledger, inbox } = await prepared(d1);
    const old = JSON.parse(JSON.stringify(await ledger.exportArchive()));
    delete old.data.notification_events;
    old.data.ledger_months.forEach((m: Record<string, unknown>) => { delete m.auto_filled; });
    old.data.payment_methods.forEach((p: Record<string, unknown>) => { for (const key of ['notify_app', 'notify_keyword', 'billing_kind', 'cutoff_day']) delete p[key]; });
    await inbox.receive(input); await ledger.importArchive(old);
    expect((await ledger.exportArchive()).data.notification_events).toEqual([]);
    expect((await ledger.exportArchive()).data.payment_methods[0]).toMatchObject({ notify_app: null, notify_keyword: null, billing_kind: 'debit', cutoff_day: 31 });
  });
});
