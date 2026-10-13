import type { NextConfig } from 'next';
const config: NextConfig = { agentRules: false, devIndicators: false, serverExternalPackages: ['@libsql/client'] };
export default config;
