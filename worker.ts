// OpenNext가 빌드할 때 생성하는 모듈이다.
// @ts-ignore
import handler from './.open-next/worker.js';
import { handleApi } from './src/server/api';
import { workerApiContext } from './src/db/worker-ledger';

export default {
  fetch(request: Request, env: CloudflareEnv, ctx: Parameters<typeof handler.fetch>[2]) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleApi(request, workerApiContext(env));
    return handler.fetch(request, env, ctx);
  },
};

// OpenNext의 Durable Object 등 이름 있는 export도 그대로 공개한다.
// @ts-ignore
export * from './.open-next/worker.js';
