import { NextResponse } from 'next/server';
import { AccessDenied } from '../../db/request-ledger';
// 변경 요청은 이 앱 화면에서 시작된 경우에만 처리한다.
// 브라우저가 실제로 접속한 주소(Host)와 요청 출처(Origin)를 비교한다.
export function checkOrigin(request: { headers: Headers }) {
  const origin = request.headers.get('origin');
  const sameHost = !origin || URL.parse(origin)?.host === request.headers.get('host');
  if (!sameHost || request.headers.get('sec-fetch-site') === 'cross-site') throw new Error('가계부 화면에서 시작한 요청만 처리할 수 있습니다.');
}

// 로그인 확인에서 막히면 403. 그 밖의 실패는 위로 던져 500으로 남긴다.
export function denied(e: unknown) {
  if (e instanceof AccessDenied) return NextResponse.json({ error: e.message }, { status: 403 });
  throw e;
}
