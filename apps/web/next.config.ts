import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@commerce/db', '@commerce/contracts', '@commerce/domain', '@commerce/ai', '@commerce/imports'],
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
