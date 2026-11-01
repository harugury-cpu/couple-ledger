// 로컬 Next 개발 서버 전용 연결 어댑터. 파일 DB(libSQL)를 사용한다.
import type { LedgerCore } from './ledger-core';
import { AccessDenied } from './worker-ledger';
import { authorizedIngest } from '../lib/notification';
export { AccessDenied } from './worker-ledger';

export async function requestContext(_headers: Headers): Promise<{ ledger: LedgerCore; geminiKey: string | undefined }> {
  return { ledger: (await import('./ledger')).getLedger(), geminiKey: process.env.GEMINI_API_KEY?.trim() || undefined };
}

export async function requestLedger(headers: Headers): Promise<LedgerCore> {
  return (await requestContext(headers)).ledger;
}

// 폰 알림은 Access 로그인 대신 전송 토큰을 확인한다.
export async function requestNotificationLedger(headers: Headers): Promise<LedgerCore> {
  if (!await authorizedIngest(headers, process.env.INGEST_TOKEN)) throw new AccessDenied();
  return (await import('./ledger')).getLedger();
}
