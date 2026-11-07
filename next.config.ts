import type { NextConfig } from 'next';
import { networkInterfaces } from 'node:os';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';

// 개발 서버를 폰(같은 와이파이)에서도 열 수 있게, 서버를 켤 때 이 맥의 IPv4 주소를 개발 리소스 허용 출처로 둔다.
// Next 16은 localhost가 아닌 출처의 개발 리소스를 막아, 폰에서 화면이 '불러오는 중'에서 멈췄다.
const lanHosts = () => ['127.0.0.1', ...Object.values(networkInterfaces()).flat().flatMap(a => a && a.family === 'IPv4' && !a.internal ? [a.address] : [])];

const config = (phase: string): NextConfig => ({
  agentRules: false,
  devIndicators: false,
  ...(phase === PHASE_DEVELOPMENT_SERVER ? { allowedDevOrigins: lanHosts() } : {}),
  serverExternalPackages: ['@libsql/client'],
  // 로컬 API는 개발 서버에서만 라우트로 인식하고 정적 빌드에서는 제외한다.
  pageExtensions: phase === PHASE_DEVELOPMENT_SERVER ? ['local.ts', 'tsx', 'ts', 'jsx', 'js'] : ['tsx', 'ts', 'jsx', 'js'],
  ...(phase === PHASE_PRODUCTION_BUILD ? { output: 'export' } : {}),
});

export default config;
