import { afterEach,describe,expect,test } from 'vitest';
import { applicationOrigin,environmentLabel,isLocalDemo,secureCookies } from '../apps/web/lib/environment';

const original={APP_MODE:process.env.APP_MODE,APP_ORIGIN:process.env.APP_ORIGIN,RENDER_EXTERNAL_HOSTNAME:process.env.RENDER_EXTERNAL_HOSTNAME};
afterEach(()=>{
  for(const [key,value] of Object.entries(original)){
    if(value===undefined)delete process.env[key];
    else process.env[key]=value;
  }
});

describe('deployment environment boundary',()=>{
  test('keeps local cookies compatible with the local HTTP workspace',()=>{
    process.env.APP_MODE='local-demo';process.env.APP_ORIGIN='http://127.0.0.1:3001';delete process.env.RENDER_EXTERNAL_HOSTNAME;
    expect(isLocalDemo()).toBe(true);expect(secureCookies()).toBe(false);expect(environmentLabel()).toBe('ทดสอบในเครื่อง');
  });

  test('derives the trusted HTTPS origin and secure cookies from Render',()=>{
    process.env.APP_MODE='staging-demo';delete process.env.APP_ORIGIN;process.env.RENDER_EXTERNAL_HOSTNAME='commerce-ai-staging-web.onrender.com';
    expect(applicationOrigin()).toBe('https://commerce-ai-staging-web.onrender.com');expect(secureCookies()).toBe(true);expect(environmentLabel()).toContain('Staging');
  });
});
