// Next 전용 연결 어댑터. Workers 진입점에서는 이 모듈을 가져오지 않는다.
import { AccessDenied, requestContext, requestLedger, requestNotificationLedger } from '../db/request-ledger';
import { handleApi } from './api';

export function handleNextApi(request: Request) {
  return handleApi(request, {
    resolve: async (headers, kind) => kind === 'capture' ? requestContext(headers) :
      { ledger: await (kind === 'ingest' ? requestNotificationLedger(headers) : requestLedger(headers)) },
    isAccessDenied: error => error instanceof AccessDenied,
  });
}
