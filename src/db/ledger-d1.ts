// 배포용 진입점: Cloudflare Workers + D1. node 전용 모듈을 가져오지 않는다.
// 요청마다 env.DB 바인딩으로 만든다(전역 하나짜리 연결을 두지 않는다).
// request-ledger.ts가 Workers에서 Access 확인을 통과한 요청에만 이걸 쓴다.
import { LedgerCore, type LedgerOptions } from './ledger-core';
import { D1Store, type D1DatabaseLike } from './store-d1';

export function createD1Ledger(d1: D1DatabaseLike, options?: LedgerOptions) {
  return new LedgerCore(new D1Store(d1), options);
}
