import { InputError } from '../lib/input-error';

// 브라우저가 접속한 Host와 Origin을 비교한다. 폰 알림 전송에는 적용하지 않는다.
export function checkOrigin(request: { headers: Headers }) {
  const origin = request.headers.get('origin');
  const sameHost = !origin || URL.parse(origin)?.host === request.headers.get('host');
  if (!sameHost || request.headers.get('sec-fetch-site') === 'cross-site') throw new InputError('가계부 화면에서 시작한 요청만 처리할 수 있습니다.');
}
