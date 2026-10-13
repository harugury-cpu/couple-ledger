// 요청 하나가 쓸 가계부를 고르는 곳. 화면(page)과 API 라우트는 모두 여기서만 가계부를 받는다.
// - 배포(Cloudflare Workers): Access 로그인 토큰을 검증한 뒤에만 D1 가계부를 돌려준다.
// - 로컬(npm run dev / start): 지금처럼 data/ledger.db (libSQL). 127.0.0.1에서만 열리므로 로그인 확인은 없다.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { LedgerCore } from './ledger-core';
import { createD1Ledger } from './ledger-d1';
import type { D1DatabaseLike } from './store-d1';
import { authorizedIngest } from '../lib/notification';

declare global {
  interface CloudflareEnv { DB: D1DatabaseLike; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; GEMINI_API_KEY?: string; INGEST_TOKEN?: string }
}

export class AccessDenied extends Error {
  constructor() { super('허용된 계정으로 로그인해야 열 수 있습니다.'); }
}

const onWorkers = () => typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

// Access 공개 키는 팀 주소마다 한 번 받아 두고 재사용한다(jose가 키 교체도 알아서 다시 받는다).
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

// Access를 거쳐 들어온 요청인지 확인한다: Access가 붙여 주는 토큰의 서명·발급처·대상 앱(AUD)을 검증한다.
// 설정값이 비어 있으면 아무도 통과시키지 않는다.
async function verifyAccess(headers: Headers, env: CloudflareEnv) {
  const team = env.ACCESS_TEAM_DOMAIN?.trim(); const aud = env.ACCESS_AUD?.trim();
  const token = headers.get('cf-access-jwt-assertion');
  if (!team || !aud || !token) throw new AccessDenied();
  const issuer = `https://${team}`;
  let keys = keySets.get(issuer);
  if (!keys) { keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)); keySets.set(issuer, keys); }
  try { await jwtVerify(token, keys, { issuer, audience: aud }); } catch { throw new AccessDenied(); }
}

export async function requestContext(headers: Headers): Promise<{ ledger: LedgerCore; geminiKey: string | undefined }> {
  if (!onWorkers()) return { ledger: (await import('./ledger')).getLedger(), geminiKey: process.env.GEMINI_API_KEY?.trim() || undefined };
  const { env } = await getCloudflareContext({ async: true });
  await verifyAccess(headers, env);
  return { ledger: createD1Ledger(env.DB), geminiKey: env.GEMINI_API_KEY?.trim() || undefined };
}

export async function requestLedger(headers: Headers): Promise<LedgerCore> {
  return (await requestContext(headers)).ledger;
}

// /api/ingest 전용: Access 쿠키 대신 폰에 등록한 비밀 토큰을 확인한다.
export async function requestNotificationLedger(headers: Headers): Promise<LedgerCore> {
  if (!onWorkers()) {
    if (!await authorizedIngest(headers, process.env.INGEST_TOKEN)) throw new AccessDenied();
    return (await import('./ledger')).getLedger();
  }
  const { env } = await getCloudflareContext({ async: true });
  if (!await authorizedIngest(headers, env.INGEST_TOKEN)) throw new AccessDenied();
  return createD1Ledger(env.DB);
}
