// 배포 진입점. 정적 파일은 Cloudflare 자산이 먼저 응답하고, Worker는 API만 처리한다.
import { handleApi } from './src/server/api';
import { workerApiContext } from './src/db/worker-ledger';

export default {
  async fetch(request: Request, env: CloudflareEnv) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleApi(request, workerApiContext(env));
    return new Response('요청한 경로를 찾을 수 없습니다.', { status: 404 });
  },
};
