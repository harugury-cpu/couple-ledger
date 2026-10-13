import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';

// Workers에서 도는 것처럼 꾸민다: navigator.userAgent와 getCloudflareContext의 env.
const env: Record<string, unknown> = {};
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env }) }));
const { AccessDenied, requestLedger } = await import('../src/db/request-ledger');

const team = 'wonsonal.cloudflareaccess.com';
const aud = 'aud-of-ledger-app';
let key: CryptoKey; let otherKey: CryptoKey; let jwk: object;

// Access 서명 키 한 쌍(공개 키는 Access의 certs 주소에서 받는 것처럼 내려 준다)과, Access가 아닌 다른 키 하나.
beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  key = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  ({ privateKey: otherKey } = await generateKeyPair('RS256'));
});

function setup() {
  vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    expect(String(url)).toBe(`https://${team}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
  }));
  Object.assign(env, { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud, DB: { prepare: () => ({ bind: () => ({}) }), batch: async () => [] } });
}

const token = (signer: CryptoKey, claims: { aud?: string; iss?: string; exp?: string } = {}) =>
  new SignJWT({ email: 'me@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(claims.iss ?? `https://${team}`).setAudience(claims.aud ?? aud).setIssuedAt().setExpirationTime(claims.exp ?? '5m').sign(signer);
const headers = (jwt?: string) => new Headers(jwt ? { 'cf-access-jwt-assertion': jwt } : {});

afterEach(() => { vi.unstubAllGlobals(); for (const k of Object.keys(env)) delete env[k]; });

describe('배포(Workers)에서는 Access 토큰을 검증한 요청에만 가계부를 준다', () => {
  it('Access가 서명한 이 앱용 토큰이면 D1 가계부를 돌려준다', async () => {
    setup();
    const ledger = await requestLedger(headers(await token(key)));
    expect(ledger.store.maxParams).toBe(100); // D1 저장소
  });

  it('토큰이 없거나, 다른 키로 서명했거나, 다른 앱(AUD)·다른 팀용이거나, 만료됐으면 막는다', async () => {
    setup();
    await expect(requestLedger(headers())).rejects.toBeInstanceOf(AccessDenied);
    await expect(requestLedger(headers('abc.def.ghi'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(requestLedger(headers(await token(otherKey)))).rejects.toBeInstanceOf(AccessDenied);
    await expect(requestLedger(headers(await token(key, { aud: 'another-app' })))).rejects.toBeInstanceOf(AccessDenied);
    await expect(requestLedger(headers(await token(key, { iss: 'https://evil.cloudflareaccess.com' })))).rejects.toBeInstanceOf(AccessDenied);
    await expect(requestLedger(headers(await token(key, { exp: '1 minute ago' })))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('팀 주소나 AUD 설정이 비어 있으면 올바른 토큰이어도 막는다', async () => {
    setup();
    const jwt = await token(key);
    env.ACCESS_AUD = '';
    await expect(requestLedger(headers(jwt))).rejects.toBeInstanceOf(AccessDenied);
    env.ACCESS_AUD = aud; env.ACCESS_TEAM_DOMAIN = '';
    await expect(requestLedger(headers(jwt))).rejects.toBeInstanceOf(AccessDenied);
  });
});
