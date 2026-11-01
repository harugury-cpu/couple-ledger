import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';

const config = (phase: string): NextConfig => ({
  agentRules: false,
  devIndicators: false,
  serverExternalPackages: ['@libsql/client'],
  // 로컬 API는 개발 서버에서만 라우트로 인식하고 정적 빌드에서는 제외한다.
  pageExtensions: phase === PHASE_DEVELOPMENT_SERVER ? ['local.ts', 'tsx', 'ts', 'jsx', 'js'] : ['tsx', 'ts', 'jsx', 'js'],
  ...(phase === PHASE_PRODUCTION_BUILD ? { output: 'export' } : {}),
});

export default config;
