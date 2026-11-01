import { afterEach, expect, test, vi } from 'vitest';
import { fetchJson } from '../src/lib/fetch-json';

const html = () => new Response('<!DOCTYPE html><html>Worker exceeded CPU time limit.</html>', { status: 503, headers: { 'content-type': 'text/html' } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

test('HTML 오류 페이지가 오면 파싱 에러 대신 한국어 안내를 던진다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => html()));
  await expect(fetchJson('/api/ledger')).rejects.toThrow('서버가 잠깐 응답하지 못했습니다');
});

test('다시 보내도 되는 요청은 끊기면 한 번 더 보내서 성공한다', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(html()).mockResolvedValueOnce(json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  await expect(fetchJson('/api/ledger', undefined, 1)).resolves.toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('재시도 0이면 한 번만 보내고, 서버의 JSON 오류 문구는 그대로 보여 준다', async () => {
  const fetch = vi.fn(async () => json({ error: '금액을 확인하세요.' }, 400));
  vi.stubGlobal('fetch', fetch);
  await expect(fetchJson('/api/notifications', { method: 'POST' })).rejects.toThrow('금액을 확인하세요.');
  expect(fetch).toHaveBeenCalledTimes(1);
});
