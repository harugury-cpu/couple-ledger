// 배포 진입점. /api/*는 가벼운 공용 핸들러가 바로 처리하고, 화면 요청만 OpenNext(Next.js)에 넘긴다.
// OpenNext 번들(수 MB)은 화면 요청이 처음 올 때만 불러온다: 맨 위에서 import하면 API 요청에도
// 그 번들 전체를 실행하는 비용이 들어 무료 요금제 CPU 한도(요청당 10ms)를 넘긴다.
// wrangler.jsonc에 Durable Object 바인딩이 없으므로 OpenNext의 DO 클래스는 다시 내보내지 않는다.
import { handleApi } from './src/server/api';
import { workerApiContext } from './src/db/worker-ledger';

type NextWorker = { fetch(request: Request, env: CloudflareEnv, ctx: unknown): Promise<Response> };
let next: Promise<NextWorker> | undefined;
// @ts-ignore OpenNext가 빌드할 때 생성하는 모듈이다.
const loadNext = () => next ??= import('./.open-next/worker.js').then(m => m.default as NextWorker);

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: unknown) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleApi(request, workerApiContext(env));
    return (await loadNext()).fetch(request, env, ctx);
  },
};
