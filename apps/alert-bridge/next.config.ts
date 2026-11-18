import type { NextConfig } from 'next';

const config:NextConfig={
  // TypeScript 6 exposes the compiler API. Worker threads avoid an intermittent
  // child-process exit without diagnostics during production builds.
  experimental:{useTypeScriptCli:false,workerThreads:true},
  transpilePackages:['@commerce/operations'],
  poweredByHeader:false,
  async headers(){return [{source:'/:path*',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Referrer-Policy',value:'no-referrer'},
    {key:'Cache-Control',value:'no-store'},
  ]}]},
};

export default config;
