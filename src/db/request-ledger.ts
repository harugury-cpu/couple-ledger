// Next 전용 연결 어댑터. 로컬은 libSQL, OpenNext 요청은 env 기반 연결을 쓴다.
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { LedgerCore } from './ledger-core';
import { AccessDenied, workerRequestContext } from './worker-ledger';
import { authorizedIngest } from '../lib/notification';
export { AccessDenied } from './worker-ledger';

const onWorkers = () => typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

export async function requestContext(headers: Headers): Promise<{ ledger: LedgerCore; geminiKey: string | undefined }> {
  if (!onWorkers()) return { ledger: (await import('./ledger')).getLedger(), geminiKey: process.env.GEMINI_API_KEY?.trim() || undefined };
  const { env } = await getCloudflareContext({ async: true });
  return workerRequestContext(headers, env);
}

export async function requestLedger(headers: Headers): Promise<LedgerCore> {
  return (await requestContext(headers)).ledger;
}

// 폰 알림은 Access 로그인 대신 전송 토큰을 확인한다.
export async function requestNotificationLedger(headers: Headers): Promise<LedgerCore> {
  if (!onWorkers()) {
    if (!await authorizedIngest(headers, process.env.INGEST_TOKEN)) throw new AccessDenied();
    return (await import('./ledger')).getLedger();
  }
  const { env } = await getCloudflareContext({ async: true });
  return (await workerRequestContext(headers, env, 'ingest')).ledger;
}
