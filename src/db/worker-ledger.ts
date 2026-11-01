// Workers의 env만 사용한다. Next 런타임과 로컬 파일 DB를 가져오지 않는다.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createD1Ledger } from './ledger-d1';
import type { D1DatabaseLike } from './store-d1';
import type { ApiContext, ContextKind } from '../server/api';
import { authorizedIngest } from '../lib/notification';

declare global {
  interface CloudflareEnv { DB: D1DatabaseLike; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; GEMINI_API_KEY?: string; INGEST_TOKEN?: string }
}

export class AccessDenied extends Error {
  constructor() { super('허용된 계정으로 로그인해야 열 수 있습니다.'); }
}

// 공개 키는 팀마다 재사용하며, 키 교체는 jose가 처리한다.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function verifyAccess(headers: Headers, env: CloudflareEnv) {
  const team = env.ACCESS_TEAM_DOMAIN?.trim(); const aud = env.ACCESS_AUD?.trim();
  const token = headers.get('cf-access-jwt-assertion');
  if (!team || !aud || !token) throw new AccessDenied();
  const issuer = `https://${team}`;
  let keys = keySets.get(issuer);
  if (!keys) { keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)); keySets.set(issuer, keys); }
  try { await jwtVerify(token, keys, { issuer, audience: aud }); } catch { throw new AccessDenied(); }
}

export async function workerRequestContext(headers: Headers, env: CloudflareEnv, kind: ContextKind = 'access', access = verifyAccess) {
  if (kind === 'ingest') {
    if (!await authorizedIngest(headers, env.INGEST_TOKEN)) throw new AccessDenied();
  } else await access(headers, env);
  return { ledger: createD1Ledger(env.DB), geminiKey: env.GEMINI_API_KEY?.trim() || undefined };
}

// Access 검증만 테스트에서 교체할 수 있다. ingest 토큰 검증은 항상 수행한다.
export function workerApiContext(env: CloudflareEnv, access = verifyAccess): ApiContext {
  return { resolve: (headers, kind) => workerRequestContext(headers, env, kind, access) };
}
