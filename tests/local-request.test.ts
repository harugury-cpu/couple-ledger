import { expect, it } from 'vitest';
import { checkOrigin } from '../src/app/api/local-request';
const request = (headers: Record<string, string>) => ({ headers: new Headers(headers) });
it('접속한 주소와 출처가 같으면 통과한다 (127.0.0.1로 열어도)', () => {
  expect(() => checkOrigin(request({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' }))).not.toThrow();
  expect(() => checkOrigin(request({ host: 'localhost:3000', origin: 'http://localhost:3000' }))).not.toThrow();
  expect(() => checkOrigin(request({ host: '127.0.0.1:3000' }))).not.toThrow();
});
it('다른 사이트에서 온 변경 요청은 거부한다', () => {
  expect(() => checkOrigin(request({ host: '127.0.0.1:3000', origin: 'http://evil.example' }))).toThrow();
  expect(() => checkOrigin(request({ host: '127.0.0.1:3000', origin: 'http://localhost:3000' }))).toThrow();
  expect(() => checkOrigin(request({ host: '127.0.0.1:3000', 'sec-fetch-site': 'cross-site' }))).toThrow();
});
