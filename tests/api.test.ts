import { afterEach, expect, it, vi } from 'vitest';
import { handleApi, type ApiContext } from '../src/server/api';
import { AccessDenied, workerApiContext } from '../src/db/worker-ledger';
import { createD1Ledger } from '../src/db/ledger-d1';
import { FakeD1 } from './fake-d1';

const opened: FakeD1[] = [];
afterEach(() => { opened.forEach(db => db.client.close()); opened.length = 0; vi.restoreAllMocks(); });

async function fixture() {
  const db = new FakeD1(); opened.push(db); await db.migrate();
  const ledger = createD1Ledger(db, { today: () => ({ year: 2026, month: 11 }) });
  const ctx: ApiContext = { resolve: async () => ({ ledger }) };
  const env: CloudflareEnv = { DB: db, INGEST_TOKEN: 'a'.repeat(32) };
  return { db, ledger, ctx, env };
}

function request(path = '/api/ledger?year=2026&month=11', body?: unknown, headers?: HeadersInit) {
  const values = new Headers({ host: 'ledger.example', origin: 'https://ledger.example', 'Content-Type': 'application/json' });
  new Headers(headers).forEach((value, key) => values.set(key, value));
  return new Request(`https://ledger.example${path}`, { method: body === undefined ? 'GET' : 'POST', headers: values,
    ...(body !== undefined && { body: JSON.stringify(body) }) });
}

async function json(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/json');
  return response.json();
}

it('Next를 거치지 않는 ledger GET은 기존 snapshot을 200 JSON으로 반환한다', async () => {
  const { ledger, ctx } = await fixture();
  const expected = await ledger.snapshot(2026, 11);
  const response = await handleApi(request(), ctx);
  expect(await json(response, 200)).toEqual(expected);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('같은 작업 ID로 POST를 재전송해도 금액과 이력이 중복되지 않는다', async () => {
  const { ledger, ctx } = await fixture();
  const line = (await ledger.snapshot(2026, 11)).lines.find(row => row.month === 11 && row.name === '가스비')!;
  const command = { type: 'quick', id: line.id, amount: 1200, raw: '1200' };
  const headers = { 'X-Ledger-Operation': 'api-operation-1' };
  const first = await json(await handleApi(request('/api/ledger', command, headers), ctx), 200);
  const second = await json(await handleApi(request('/api/ledger', command, headers), ctx), 200);
  expect(second).toEqual(first);
  expect(first).toMatchObject({ ok: true, history_id: 'api-operation-1' });
  const snapshot = await json(await handleApi(request(), ctx), 200);
  expect(snapshot.entries.filter((entry: { month_line_id: string }) => entry.month_line_id === line.id))
    .toEqual([expect.objectContaining({ id: first.entry_id, amount: 1200 })]);
  const conflict = await json(await handleApi(request('/api/ledger', { ...command, amount: 2400 }, headers), ctx), 409);
  expect(conflict.error).toBe('이 작업 뒤에 같은 항목이 변경되었습니다. 최신 내용을 확인한 뒤 다시 시도하세요.');
});

it('잘못된 월·명령·JSON은 400 JSON으로 반환한다', async () => {
  const { ctx } = await fixture();
  expect(await json(await handleApi(request('/api/ledger?year=2026&month=13'), ctx), 400))
    .toEqual({ error: '월 데이터를 불러오지 못했습니다. 연도와 월을 확인하세요.' });
  expect(await json(await handleApi(request('/api/ledger', { type: 'unknown' }), ctx), 400))
    .toEqual({ error: '입력값을 확인하세요. 금액은 원 단위 정수입니다.' });
  const broken = new Request('https://ledger.example/api/ledger', { method: 'POST', headers: { host: 'ledger.example' }, body: '{' });
  expect(await json(await handleApi(broken, ctx), 400)).toHaveProperty('error');
});

it('Access 실패는 403 JSON이며 DB를 읽지 않는다', async () => {
  const { db, env } = await fixture();
  const prepare = vi.spyOn(db, 'prepare');
  const denied = vi.fn(async () => { throw new AccessDenied(); });
  expect(await json(await handleApi(request(), workerApiContext(env, denied)), 403))
    .toEqual({ error: '허용된 계정으로 로그인해야 열 수 있습니다.' });
  expect(denied).toHaveBeenCalledOnce();
  expect(prepare).not.toHaveBeenCalled();
});

it('env 기반 연결은 주입한 Access를 확인하고 D1에서 200 JSON을 반환한다', async () => {
  const { env } = await fixture();
  const access = vi.fn(async () => {});
  expect(await json(await handleApi(request(), workerApiContext(env, access)), 200)).toMatchObject({ year: 2026, month: 11 });
  expect(access).toHaveBeenCalledOnce();
});

it('예상 못한 조회·저장·연결 오류도 500 JSON으로 반환한다', async () => {
  const { ledger, ctx } = await fixture();
  vi.spyOn(ledger, 'snapshot').mockRejectedValueOnce(new Error('내부 조회 장애'));
  expect(await json(await handleApi(request(), ctx), 500)).toHaveProperty('error');
  vi.spyOn(ledger, 'saveCategory').mockRejectedValueOnce(new Error('내부 저장 장애'));
  expect(await json(await handleApi(request('/api/ledger', { type: 'category-save', name: '테스트' }), ctx), 500))
    .toEqual({ error: '가계부를 처리하지 못했습니다. 다시 시도하세요.' });
  const broken: ApiContext = { resolve: async () => { throw new Error('연결 실패'); } };
  for (const path of ['/api/ledger?year=2026&month=11', '/api/notifications?year=2026&month=11', '/api/backup'])
    expect(await json(await handleApi(request(path), broken), 500)).toHaveProperty('error');
});

it('기존 출처 검사와 업무 오류의 400 문구를 보존한다', async () => {
  const { ctx } = await fixture();
  const command = { type: 'category-save', name: '테스트' };
  for (const headers of [{ origin: 'https://other.example' }, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) {
    expect(await json(await handleApi(request('/api/ledger', command, headers), ctx), 400))
      .toEqual({ error: '가계부 화면에서 시작한 요청만 처리할 수 있습니다.' });
  }
  expect(await json(await handleApi(request('/api/ledger', { type: 'category-delete', id: 'missing' }), ctx), 400))
    .toEqual({ error: '카테고리를 찾을 수 없습니다.' });
  expect(await json(await handleApi(request('/api/ledger', command, { 'X-Ledger-Operation': 'bad operation' }), ctx), 400))
    .toEqual({ error: '작업 식별자가 올바르지 않습니다.' });
});

it('알림 목록·백업 다운로드·잘못된 명세서 확정도 공용 핸들러에서 처리한다', async () => {
  const { ctx } = await fixture();
  expect(await json(await handleApi(request('/api/notifications?year=2026&month=11'), ctx), 200)).toBeDefined();
  const backup = await handleApi(request('/api/backup'), ctx);
  expect(await json(backup, 200)).toHaveProperty('data');
  expect(backup.headers.get('content-disposition')).toMatch(/^attachment; filename="couple-ledger-.*\.json"$/);
  expect(backup.headers.get('cache-control')).toBe('no-store');
  expect(await json(await handleApi(request('/api/capture/confirm', {}), ctx), 400))
    .toEqual({ error: '확정할 명세서 항목을 확인하세요.' });
  expect(await json(await handleApi(request('/api/backup', {}), ctx), 400))
    .toEqual({ error: '가계부 JSON 형식·버전·금액·필수 항목을 확인하세요.' });
});

it('명세서 읽기는 주입한 키를 사용하고 확정은 같은 가계부에 저장한다', async () => {
  const { ledger } = await fixture();
  const ctx: ApiContext = { resolve: async () => ({ ledger, geminiKey: 'test-key' }) };
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ candidates: [{ content: {
    parts: [{ text: JSON.stringify({ items: [{ date: '11/01', merchant: '가스비', amount: 1200, raw: '가스비 1200원' }] }) }],
  } }] }));
  const form = new FormData();
  form.set('year', '2026'); form.set('month', '11');
  form.append('images', new File(['test'], 'capture.png', { type: 'image/png' }));
  const read = await json(await handleApi(new Request('https://ledger.example/api/capture/read', {
    method: 'POST', headers: { host: 'ledger.example', origin: 'https://ledger.example' }, body: form,
  }), ctx), 200);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { 'x-goog-api-key': 'test-key' } });
  expect(read.items).toEqual([expect.objectContaining({ merchant: '가스비', amount: 1200, duplicate: false })]);
  const item = read.items[0];
  const confirmed = await json(await handleApi(request('/api/capture/confirm', { year: 2026, month: 11,
    items: [{ key: item.key, lineId: item.lineId, amount: item.amount, raw: item.raw, merchant: item.merchant, remember: false }],
  }), ctx), 200);
  expect(confirmed).toEqual({ ok: true, inserted: 1 });
  expect((await ledger.snapshot(2026, 11)).entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ month_line_id: item.lineId, amount: 1200, source: 'capture' }),
  ]));
});

it('알림 전송은 Access를 호출하지 않고 ingest 토큰을 항상 확인한다', async () => {
  const { env, db } = await fixture();
  const access = vi.fn(async () => { throw new AccessDenied(); });
  const ctx = workerApiContext(env, access);
  const prepare = vi.spyOn(db, 'prepare');
  expect(await json(await handleApi(request('/api/ingest', {}), ctx), 401))
    .toEqual({ error: '알림 전송 토큰을 확인하세요.' });
  expect(prepare).not.toHaveBeenCalled();
  const headers = { authorization: `Bearer ${'a'.repeat(32)}` };
  expect(await json(await handleApi(request('/api/ingest', {}, headers), ctx), 400))
    .toEqual({ error: '알림 입력 형식을 확인하세요.' });
  const tooLarge = await handleApi(request('/api/ingest', {}, { ...headers, 'content-length': '32001' }), ctx);
  expect(await json(tooLarge, 413)).toEqual({ error: '알림이 너무 큽니다.' });
  expect(await json(await handleApi(request('/api/ingest', { app: '테스트 카드', title: '승인', text: '가맹점 1200원' }, headers), ctx), 200))
    .toEqual({ status: 'review' });
  expect(access).not.toHaveBeenCalled();
});

it('알 수 없는 경로와 지원하지 않는 요청 방식도 JSON으로 반환한다', async () => {
  const { ctx } = await fixture();
  expect(await json(await handleApi(request('/api/missing'), ctx), 404)).toHaveProperty('error');
  const response = await handleApi(new Request('https://ledger.example/api/ledger', { method: 'DELETE' }), ctx);
  expect(await json(response, 405)).toHaveProperty('error');
  expect(response.headers.get('allow')).toBe('GET, POST, HEAD, OPTIONS');
});
