import { createHash,randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { describe,expect,it } from 'vitest';
import { demo } from '../packages/domain/src/demo';

const execute=promisify(execFile);
const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
const principalId='51111111-1111-4111-8111-111111111111';
const credentialId='61111111-1111-4111-8111-111111111111';

describe('staging agent principal provisioning',()=>{
  it('creates one audited, tenant-scoped read identity and is idempotent',async()=>{
    const credential=`svc_${randomBytes(32).toString('base64url')}`;
    const environment={...process.env,
      APP_MODE:'staging-demo',COMMERCE_AGENT_STAGING_PRINCIPAL_BOOTSTRAP:'true',
      COMMERCE_AGENT_STAGING_CREDENTIAL_HASH:createHash('sha256').update(credential).digest('hex'),
      COMMERCE_AGENT_STAGING_CREDENTIAL_PREFIX:credential.slice(0,16),
      COMMERCE_AGENT_STAGING_CREDENTIAL_EXPIRES_AT:new Date(Date.now()+90*86400000).toISOString(),
    };
    const args=['--import','tsx','scripts/provision-agent-staging-principal.ts'];
    const first=await execute(process.execPath,args,{cwd:process.cwd(),env:environment});
    const second=await execute(process.execPath,args,{cwd:process.cwd(),env:environment});
    expect(first.stdout).toContain('created');
    expect(second.stdout).toContain('already current');

    const principal=(await admin.query<{tenant_id:string;environment:string;audience:string;status:string;secret_hash:string;raw_present:boolean}>(`
      SELECT p.tenant_id,p.environment,p.audience,p.status,c.secret_hash,
        EXISTS(SELECT 1 FROM private.service_principal_credentials WHERE secret_hash=$3) AS raw_present
      FROM app.service_principals p
      JOIN private.service_principal_credentials c ON c.tenant_id=p.tenant_id AND c.principal_id=p.id AND c.id=$2
      WHERE p.id=$1`,[principalId,credentialId,credential])).rows[0];
    expect(principal).toMatchObject({tenant_id:demo.tenants.chino,environment:'staging',audience:'commerce-agent-api',status:'active',raw_present:false});
    expect(principal.secret_hash).toBe(environment.COMMERCE_AGENT_STAGING_CREDENTIAL_HASH);
    const delegations=(await admin.query<{shop_id:string;scopes:string[]}>(
      'SELECT shop_id,scopes FROM app.service_principal_delegations WHERE tenant_id=$1 AND principal_id=$2',[demo.tenants.chino,principalId],
    )).rows;
    expect(delegations).toEqual([{shop_id:demo.shops.tiktok,scopes:['catalog:read','sales:read','inventory:read']}]);
    const audit=(await admin.query<{count:number}>(
      "SELECT count(*)::int AS count FROM app.audit_events WHERE tenant_id=$1 AND entity_id=$2 AND action='service_principal.created'",
      [demo.tenants.chino,principalId],
    )).rows[0].count;
    expect(audit).toBe(1);
  });
});
