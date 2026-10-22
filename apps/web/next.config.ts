import type { NextConfig } from 'next';
const config: NextConfig = {
  // TypeScript 6 exposes the compiler API. Worker threads avoid an intermittent
  // child-process exit without diagnostics during production builds.
  experimental: { useTypeScriptCli: false, workerThreads: true },
  transpilePackages: ['@commerce/db', '@commerce/contracts', '@commerce/domain', '@commerce/ai', '@commerce/imports', '@commerce/integrations', '@commerce/connectors'],
  serverExternalPackages: ['pg', 'pg-boss'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Cache-Control', value: 'private, no-store' },
    ] }];
  },
};
export default config;
