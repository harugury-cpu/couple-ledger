import { NextResponse } from 'next/server';
import { AccessDenied } from '../../db/request-ledger';
export { checkOrigin } from '../../server/request';

// 로그인 확인에서 막히면 403. 그 밖의 실패는 위로 던져 500으로 남긴다.
export function denied(e: unknown) {
  if (e instanceof AccessDenied) return NextResponse.json({ error: e.message }, { status: 403 });
  throw e;
}
