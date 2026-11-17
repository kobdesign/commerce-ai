import { createHash,randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { authenticateAgentServiceRequest,agentApiErrorResponse,agentServiceHeaders,signAgentServiceRequest,type AgentSigningInput } from '@commerce/agent-api';
import { closePools,resolveContext } from '@commerce/db';
import { demo } from '@commerce/domain';
import { createServicePrincipal,revokeServicePrincipal } from '@commerce/integrations';
import type { ServicePrincipalScope } from '@commerce/contracts';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
afterAll(async()=>Promise.all([closePools(),admin.end()]));
const owner=()=>resolveContext(demo.users.owner,demo.tenants.chino);
const createInput=(shopIds=[demo.shops.tiktok],scopes:readonly ServicePrincipalScope[]=['catalog:read'],environment:'development'|'staging'|'production'='development',audience='commerce-agent-api')=>({
  name:`Agent reader ${randomUUID()}`,shopIds,scopes:[...scopes],environment,audience,
  expiresAt:new Date(Date.now()+3600_000).toISOString(),confirmed:true as const,
});

type RequestOptions={
  operation?:'products.query'|'sales.query'|'inventory.query';body?:Record<string,unknown>;requestId?:string;timestamp?:string;
  environment?:'development'|'staging'|'production';audience?:string;signature?:string|null;credentialForSignature?:string;
};
function signedRequest(credential:string,options:RequestOptions={}){
  const operation=options.operation??'products.query';
  const paths={
    'products.query':'/api/agent/v1/products/query','sales.query':'/api/agent/v1/sales/query','inventory.query':'/api/agent/v1/inventory/query',
  } as const;
  const path=paths[operation],body=JSON.stringify(options.body??{shopIds:[demo.shops.tiktok]});
  const signing:AgentSigningInput={method:'POST',path,body,requestId:options.requestId??randomUUID(),timestamp:options.timestamp??new Date().toISOString(),environment:options.environment??'development',audience:'commerce-agent-api'};
  const signature=options.signature===undefined?signAgentServiceRequest(options.credentialForSignature??credential,signing):options.signature;
  const headers:Record<string,string>={
    authorization:`Bearer ${credential}`,'content-type':'application/json',[agentServiceHeaders.requestId]:signing.requestId,
    [agentServiceHeaders.timestamp]:signing.timestamp,[agentServiceHeaders.environment]:signing.environment,
    [agentServiceHeaders.audience]:options.audience??signing.audience,
  };
  if(signature!==null)headers[agentServiceHeaders.signature]=signature;
  return {request:new Request(`https://commerce.test${path}`,{method:'POST',headers,body}),operation,requestId:signing.requestId};
}
async function rejectionCode(request:Request,operation:'products.query'|'sales.query'|'inventory.query'){
  try{await authenticateAgentServiceRequest(request,operation);throw new Error('Expected authentication to fail');}
  catch(error){return (await agentApiErrorResponse(error).json()).error.code as string;}
}

describe('Commerce Agent service-to-service authentication',()=>{
  it('derives tenant from the credential and records only safe request evidence',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput()),signed=signedRequest(created.credential);
    const authenticated=await authenticateAgentServiceRequest(signed.request,signed.operation);
    expect(authenticated.context).toMatchObject({tenantId:demo.tenants.chino,principalId:created.id,allowedShopIds:[demo.shops.tiktok],scopes:['catalog:read'],audience:'commerce-agent-api',environment:'development',requestId:signed.requestId});
    expect(authenticated.query).toMatchObject({shopIds:[demo.shops.tiktok],limit:25,status:'active'});
    const receipt=(await admin.query<{tenant_id:string;request_id:string;principal_id:string;body_hash:string;request_hash:string}>(
      'SELECT tenant_id,request_id,principal_id,body_hash,request_hash FROM app.agent_service_request_receipts WHERE tenant_id=$1 AND request_id=$2',
      [ctx.tenantId,signed.requestId],
    )).rows[0];
    expect(receipt).toMatchObject({tenant_id:ctx.tenantId,request_id:signed.requestId,principal_id:created.id,body_hash:authenticated.bodyHash});
    expect(receipt.request_hash).toMatch(/^[0-9a-f]{64}$/);
    const columns=(await admin.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='agent_service_request_receipts'")).rows.map(row=>row.column_name);
    expect(columns).not.toContain('credential');expect(columns).not.toContain('signature');expect(JSON.stringify(receipt)).not.toContain(created.credential);
    const stored=(await admin.query<{authorized_request_count:string}>('SELECT authorized_request_count::text FROM private.service_principal_credentials WHERE secret_hash=$1',[createHash('sha256').update(created.credential).digest('hex')])).rows[0];
    expect(stored.authorized_request_count).toBe('1');
  });

  it('rejects unsigned, incorrectly signed and stale requests before creating a receipt',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput());
    const unsigned=signedRequest(created.credential,{signature:null}),bad=signedRequest(created.credential,{credentialForSignature:`svc_${'A'.repeat(43)}`}),stale=signedRequest(created.credential,{timestamp:new Date(Date.now()-301_000).toISOString()});
    await expect(rejectionCode(unsigned.request,unsigned.operation)).resolves.toBe('SIGNATURE_INVALID');
    await expect(rejectionCode(bad.request,bad.operation)).resolves.toBe('SIGNATURE_INVALID');
    await expect(rejectionCode(stale.request,stale.operation)).resolves.toBe('REQUEST_EXPIRED');
    const count=(await admin.query<{count:number}>('SELECT count(*)::int AS count FROM app.agent_service_request_receipts WHERE tenant_id=$1 AND request_id=ANY($2::uuid[])',[ctx.tenantId,[unsigned.requestId,bad.requestId,stale.requestId]])).rows[0].count;
    expect(count).toBe(0);
  });

  it('accepts an exact concurrent retry once while retaining one receipt',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput()),signed=signedRequest(created.credential);
    const results=await Promise.allSettled([
      authenticateAgentServiceRequest(signed.request.clone(),signed.operation),
      authenticateAgentServiceRequest(signed.request.clone(),signed.operation),
    ]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(2);
    const authorizations=results.filter((result):result is PromiseFulfilledResult<Awaited<ReturnType<typeof authenticateAgentServiceRequest>>> => result.status==='fulfilled').map(result=>result.value.replayed).sort();
    expect(authorizations).toEqual([false,true]);
    const count=(await admin.query<{count:number}>('SELECT count(*)::int AS count FROM app.agent_service_request_receipts WHERE tenant_id=$1 AND request_id=$2',[ctx.tenantId,signed.requestId])).rows[0].count;
    expect(count).toBe(1);
  });

  it('rejects reuse of an idempotent request ID with a different payload',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput()),first=signedRequest(created.credential);
    await authenticateAgentServiceRequest(first.request,first.operation);
    const changed=signedRequest(created.credential,{requestId:first.requestId,body:{shopIds:[demo.shops.tiktok],cursor:null,limit:10,search:'changed',status:'active'}});
    await expect(rejectionCode(changed.request,changed.operation)).resolves.toBe('REQUEST_REPLAYED');
    const count=(await admin.query<{count:number}>('SELECT count(*)::int AS count FROM app.agent_service_request_receipts WHERE tenant_id=$1 AND request_id=$2',[ctx.tenantId,first.requestId])).rows[0].count;
    expect(count).toBe(1);
  });

  it('enforces audience, runtime environment, operation scope and delegated shop at request time',async()=>{
    const ctx=await owner();
    const wrongAudience=await createServicePrincipal(ctx,createInput([demo.shops.tiktok],['catalog:read'],'development','different-agent-api'));
    const wrongEnvironment=await createServicePrincipal(ctx,createInput([demo.shops.tiktok],['catalog:read'],'staging'));
    const wrongScope=await createServicePrincipal(ctx,createInput([demo.shops.tiktok],['sales:read']));
    const scopedShop=await createServicePrincipal(ctx,createInput());
    const audienceRequest=signedRequest(wrongAudience.credential),environmentRequest=signedRequest(wrongEnvironment.credential),scopeRequest=signedRequest(wrongScope.credential),shopRequest=signedRequest(scopedShop.credential,{body:{shopIds:[demo.shops.shopee]}});
    await expect(rejectionCode(audienceRequest.request,audienceRequest.operation)).resolves.toBe('WRONG_AUDIENCE');
    await expect(rejectionCode(environmentRequest.request,environmentRequest.operation)).resolves.toBe('WRONG_ENVIRONMENT');
    await expect(rejectionCode(scopeRequest.request,scopeRequest.operation)).resolves.toBe('SCOPE_FORBIDDEN');
    await expect(rejectionCode(shopRequest.request,shopRequest.operation)).resolves.toBe('SHOP_FORBIDDEN');
  });

  it('rejects expired and revoked credentials on every request',async()=>{
    const ctx=await owner(),expired=await createServicePrincipal(ctx,createInput()),revoked=await createServicePrincipal(ctx,createInput());
    await admin.query("UPDATE private.service_principal_credentials SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND principal_id=$2",[ctx.tenantId,expired.id]);
    await revokeServicePrincipal(ctx,revoked.id,{version:1,reason:'ทดสอบยกเลิกสิทธิ์ Agent API',confirmed:true});
    const expiredRequest=signedRequest(expired.credential),revokedRequest=signedRequest(revoked.credential);
    await expect(rejectionCode(expiredRequest.request,expiredRequest.operation)).resolves.toBe('SERVICE_IDENTITY_EXPIRED');
    await expect(rejectionCode(revokedRequest.request,revokedRequest.operation)).resolves.toBe('UNAUTHENTICATED');
  });

  it('does not accept a caller-supplied tenant and cannot use a shop from another tenant',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput());
    const forgedTenant=signedRequest(created.credential,{body:{shopIds:[demo.shops.tiktok],tenantId:demo.tenants.goods}});
    const otherTenantShop=signedRequest(created.credential,{body:{shopIds:[demo.shops.goods]}});
    await expect(rejectionCode(forgedTenant.request,forgedTenant.operation)).resolves.toBe('INVALID_REQUEST');
    await expect(rejectionCode(otherTenantShop.request,otherTenantShop.operation)).resolves.toBe('SHOP_FORBIDDEN');
    const count=(await admin.query<{count:number}>('SELECT count(*)::int AS count FROM app.agent_service_request_receipts WHERE tenant_id=$1 AND request_id=ANY($2::uuid[])',[ctx.tenantId,[forgedTenant.requestId,otherTenantShop.requestId]])).rows[0].count;
    expect(count).toBe(0);
  });
});
