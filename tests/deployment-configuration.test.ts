import { readFile } from 'node:fs/promises';
import { describe,expect,test } from 'vitest';
import { deploymentConfiguration } from '@commerce/operations';

describe('deployment configuration gates',()=>{
  test('allows a loopback local web workspace',()=>{
    const report=deploymentConfiguration('web',{APP_MODE:'local-demo',APP_ORIGIN:'http://127.0.0.1:3001'});
    expect(report.status).toBe('ok');
  });

  test('requires HTTPS and disabled live AI in staging',()=>{
    const report=deploymentConfiguration('web',{APP_MODE:'staging-demo',APP_ORIGIN:'http://staging.example.test',AI_ENABLED:'true'});
    expect(report.status).toBe('blocked');
    expect(report.checks.filter(item=>item.status==='blocked').map(item=>item.key)).toEqual(['trusted-origin','staging-ai-disabled']);
  });

  test('blocks production until real identity and private evidence storage exist',()=>{
    const report=deploymentConfiguration('web',{APP_MODE:'production',APP_ORIGIN:'https://commerce.example.test'});
    expect(report.status).toBe('blocked');
    expect(report.checks.filter(item=>item.status==='blocked').map(item=>item.key)).toEqual(['production-identity','private-evidence-storage']);
  });

  test('does not require a public origin for a worker',()=>{
    const report=deploymentConfiguration('worker',{APP_MODE:'staging-demo',AI_ENABLED:'false'});
    expect(report.status).toBe('ok');
  });

  test('allows a local monitor without a webhook destination',()=>{
    const report=deploymentConfiguration('monitor',{APP_MODE:'local-demo',MONITOR_BASE_URL:'http://127.0.0.1:3001'});
    expect(report.status).toBe('ok');
    const partial=deploymentConfiguration('monitor',{APP_MODE:'local-demo',MONITOR_BASE_URL:'http://127.0.0.1:3001',MONITOR_ALERT_WEBHOOK_URL:'http://127.0.0.1:4000/alert'});
    expect(partial.checks).toContainEqual(expect.objectContaining({key:'alert-secret',status:'blocked'}));
  });

  test('requires an HTTPS target, webhook and strong secret for a staging monitor',()=>{
    const blocked=deploymentConfiguration('monitor',{APP_MODE:'staging-demo',MONITOR_BASE_URL:'http://staging.example.test'});
    expect(blocked.checks.filter(item=>item.status==='blocked').map(item=>item.key)).toEqual(['monitor-target','alert-webhook','alert-secret']);
    const ready=deploymentConfiguration('monitor',{APP_MODE:'staging-demo',MONITOR_BASE_URL:'https://staging.example.test',MONITOR_ALERT_WEBHOOK_URL:'https://alerts.example.test/runtime',MONITOR_ALERT_WEBHOOK_SECRET:'x'.repeat(32)});
    expect(ready.status).toBe('ok');
  });

  test('lets a managed database owner assign runtime role ownership during migration',async()=>{
    const source=await readFile(new URL('../scripts/migrate.ts',import.meta.url),'utf8');
    const grant='GRANT ${name} TO CURRENT_USER WITH SET TRUE';
    expect(source).toContain(grant);
    expect(source).toContain('rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls');
    expect(source).toContain('Runtime database role ${name} has elevated privileges.');
    expect(source).not.toContain('ALTER ROLE ${name} WITH LOGIN NOSUPERUSER');
    expect(source.indexOf(grant)).toBeLessThan(source.indexOf('CREATE TABLE IF NOT EXISTS public.schema_migrations'));
  });
});
