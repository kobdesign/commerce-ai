import { createHash,createHmac,randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { demo } from '@commerce/domain';
import { createServicePrincipal,ingestIncomingEvent,revokeServicePrincipal,rotateServicePrincipalCredential,servicePrincipalWorkspace,type IncomingEventInput } from '@commerce/integrations';
import type { ServicePrincipalScope } from '@commerce/contracts';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
const queue=new Pool({connectionString:process.env.QUEUE_DATABASE_URL});
const verificationSecret='service-principal-test-signature-secret';
afterAll(async()=>Promise.all([closePools(),admin.end(),queue.end()]));
const owner=()=>resolveContext(demo.users.owner,demo.tenants.chino);
const createInput=(shopIds=[demo.shops.tiktok],scopes:readonly ServicePrincipalScope[]=['integration:ingest'])=>({name:`Connector ${randomUUID()}`,shopIds,scopes:[...scopes],expiresAt:new Date(Date.now()+3600_000).toISOString(),confirmed:true as const});
function eventInput(credential:string,shopId=demo.shops.tiktok,serviceEnvironment:'development'|'staging'|'production'='development',serviceAudience='integration-inbox'):IncomingEventInput{
  const stamp=randomUUID(),rawBody=JSON.stringify({orderId:`SERVICE-${stamp}`,status:'paid'});
  return {tenantId:demo.tenants.chino,shopId,providerNamespace:`service.test.${stamp}`,providerEventId:`event-${stamp}`,eventType:'order.status_changed',streamType:'order',streamId:`SERVICE-${stamp}`,sequenceNumber:1,occurredAt:new Date().toISOString(),rawBody,signature:`sha256=${createHmac('sha256',verificationSecret).update(rawBody).digest('hex')}`,verificationSecret,serviceCredential:credential,serviceEnvironment,serviceAudience,verificationMethod:'hmac-sha256-v1',verificationKeyReference:'service-test-v1',metadata:{adapterVersion:'service-principal-test',contentType:'application/json'}};
}

describe('Service principals and delegated shop scopes',()=>{
  it('returns a high-entropy credential once and stores only its hash and safe prefix',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput()),workspace=await servicePrincipalWorkspace(ctx),principal=workspace.principals.find(item=>item.id===created.id)!;
    expect(created.credential).toMatch(/^svc_[A-Za-z0-9_-]{43}$/);
    expect(principal).toMatchObject({status:'active',environment:'development',audience:'integration-inbox',credentialPrefix:created.credentialPrefix,shops:[{id:demo.shops.tiktok}],scopes:['integration:ingest'],version:1,credentials:[{prefix:created.credentialPrefix,status:'active',authorizedRequestCount:'0'}]});
    expect(JSON.stringify(workspace)).not.toContain(created.credential);
    const stored=(await admin.query<{secret_hash:string;secret_prefix:string}>('SELECT secret_hash,secret_prefix FROM private.service_principal_credentials WHERE tenant_id=$1 AND principal_id=$2',[ctx.tenantId,created.id])).rows[0];
    expect(stored).toEqual({secret_hash:createHash('sha256').update(created.credential).digest('hex'),secret_prefix:created.credentialPrefix});
    expect(await withTenant(ctx,tx=>tx.query("SELECT action FROM app.audit_events WHERE entity_id=$1 AND action='service_principal.created'",[created.id]))).toEqual([{action:'service_principal.created'}]);
  });

  it('authorizes inbox ingestion only through the scoped wrapper',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput()),event=await ingestIncomingEvent(queue,eventInput(created.credential));
    expect(event).toMatchObject({duplicate:false,reconciliationStatus:'ready'});
    const directPrivilege=(await admin.query<{allowed:boolean}>("SELECT has_function_privilege('commerce_queue','app.ingest_integration_inbox_event(uuid,uuid,uuid,text,text,text,text,text,bigint,timestamptz,text,jsonb,jsonb,text,text,text)','EXECUTE') AS allowed")).rows[0];
    expect(directPrivilege.allowed).toBe(false);
    const scopedPrivilege=(await admin.query<{allowed:boolean}>("SELECT has_function_privilege('commerce_queue','app.ingest_scoped_integration_inbox_event(text,text,text,uuid,uuid,uuid,text,text,text,text,text,bigint,timestamptz,text,jsonb,jsonb,text,text,text)','EXECUTE') AS allowed")).rows[0];
    expect(scopedPrivilege.allowed).toBe(true);
  });

  it('denies a missing scope and a shop outside the current delegation before inbox write',async()=>{
    const ctx=await owner(),readOnly=await createServicePrincipal(ctx,createInput([demo.shops.tiktok],['integration:read'])),shopScoped=await createServicePrincipal(ctx,createInput());
    const noScope=eventInput(readOnly.credential),wrongShop=eventInput(shopScoped.credential,demo.shops.shopee);
    await expect(ingestIncomingEvent(queue,noScope)).rejects.toThrow('SERVICE_SCOPE_FORBIDDEN');
    await expect(ingestIncomingEvent(queue,wrongShop)).rejects.toThrow('SERVICE_SCOPE_FORBIDDEN');
    const count=Number((await admin.query('SELECT count(*) FROM app.integration_inbox_events WHERE tenant_id=$1 AND provider_namespace=ANY($2)',[ctx.tenantId,[noScope.providerNamespace,wrongShop.providerNamespace]])).rows[0].count);
    expect(count).toBe(0);
  });

  it('rechecks revocation before every event and preserves prior committed evidence',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput()),first=await ingestIncomingEvent(queue,eventInput(created.credential));
    await revokeServicePrincipal(ctx,created.id,{version:1,reason:'หยุด connector เพื่อทดสอบ current-policy recheck',confirmed:true});
    await expect(ingestIncomingEvent(queue,eventInput(created.credential))).rejects.toThrow('SERVICE_CREDENTIAL_INVALID');
    expect(Number((await admin.query('SELECT count(*) FROM app.integration_inbox_events WHERE tenant_id=$1 AND id=$2',[ctx.tenantId,first.id])).rows[0].count)).toBe(1);
    expect((await servicePrincipalWorkspace(ctx)).principals.find(item=>item.id===created.id)).toMatchObject({status:'revoked',version:2,revokeReason:'หยุด connector เพื่อทดสอบ current-policy recheck'});
  });

  it('rejects an expired credential even when its delegation remains present',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput());
    await admin.query("UPDATE private.service_principal_credentials SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND principal_id=$2",[ctx.tenantId,created.id]);
    await expect(ingestIncomingEvent(queue,eventInput(created.credential))).rejects.toThrow('SERVICE_CREDENTIAL_INVALID');
  });

  it('binds a credential to its environment and audience before checking the shop scope',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,{...createInput(),environment:'staging',audience:'tiktok-orders'});
    await expect(ingestIncomingEvent(queue,eventInput(created.credential,demo.shops.tiktok,'development','tiktok-orders'))).rejects.toThrow('SERVICE_AUDIENCE_FORBIDDEN');
    await expect(ingestIncomingEvent(queue,eventInput(created.credential,demo.shops.tiktok,'staging','integration-inbox'))).rejects.toThrow('SERVICE_AUDIENCE_FORBIDDEN');
    await expect(ingestIncomingEvent(queue,eventInput(created.credential,demo.shops.tiktok,'staging','tiktok-orders'))).resolves.toMatchObject({reconciliationStatus:'ready'});
  });

  it('rotates with dual-key overlap, reports safe usage and retires the previous secret',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput());
    await ingestIncomingEvent(queue,eventInput(created.credential));
    const rotated=await rotateServicePrincipalCredential(ctx,created.id,{version:1,expiresAt:new Date(Date.now()+2*3600_000).toISOString(),overlapMinutes:30,reason:'หมุน credential ตามรอบทดสอบ',confirmed:true});
    expect(rotated).toMatchObject({id:created.id,version:2});expect(rotated.credential).not.toBe(created.credential);expect(rotated.retirePreviousAt).not.toBeNull();
    await expect(ingestIncomingEvent(queue,eventInput(created.credential))).resolves.toMatchObject({reconciliationStatus:'ready'});
    await expect(ingestIncomingEvent(queue,eventInput(rotated.credential))).resolves.toMatchObject({reconciliationStatus:'ready'});
    let principal=(await servicePrincipalWorkspace(ctx)).principals.find(item=>item.id===created.id)!;
    expect(principal.credentials).toHaveLength(2);expect(principal.credentials.map(item=>item.status).sort()).toEqual(['active','retiring']);
    expect(principal.credentials.reduce((sum,item)=>sum+Number(item.authorizedRequestCount),0)).toBe(3);
    expect(JSON.stringify(principal)).not.toContain(created.credential);expect(JSON.stringify(principal)).not.toContain(rotated.credential);
    await admin.query('UPDATE private.service_principal_credentials SET created_at=created_at-interval \'1 day\',retire_at=clock_timestamp()-interval \'1 second\' WHERE tenant_id=$1 AND principal_id=$2 AND secret_hash=$3',[ctx.tenantId,created.id,createHash('sha256').update(created.credential).digest('hex')]);
    await expect(ingestIncomingEvent(queue,eventInput(created.credential))).rejects.toThrow('SERVICE_CREDENTIAL_INVALID');
    await expect(ingestIncomingEvent(queue,eventInput(rotated.credential))).resolves.toMatchObject({reconciliationStatus:'ready'});
    principal=(await servicePrincipalWorkspace(ctx)).principals.find(item=>item.id===created.id)!;
    expect(principal.credentials.find(item=>item.prefix===created.credentialPrefix)?.status).toBe('retired');
    expect(await withTenant(ctx,tx=>tx.query("SELECT action FROM app.audit_events WHERE entity_id=$1 AND action='service_principal.credential_rotated'",[created.id]))).toEqual([{action:'service_principal.credential_rotated'}]);
  });

  it('serializes concurrent rotations and prevents an auditor from issuing a new secret',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput()),input={version:1,expiresAt:new Date(Date.now()+2*3600_000).toISOString(),overlapMinutes:30,reason:'ทดสอบการหมุนพร้อมกันด้วย version เดียว',confirmed:true as const};
    const results=await Promise.allSettled([rotateServicePrincipalCredential(ctx,created.id,input),rotateServicePrincipalCredential(ctx,created.id,input)]);
    expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1);
    const rejected=results.find(item=>item.status==='rejected');expect(rejected?.status==='rejected'&&rejected.reason).toMatchObject({code:'STALE_SERVICE_PRINCIPAL'});
    const auditor=await resolveContext(demo.users.consultant,ctx.tenantId),version=(results.find(item=>item.status==='fulfilled') as PromiseFulfilledResult<{version:number}>).value.version;
    await expect(rotateServicePrincipalCredential(auditor,created.id,{...input,version})).rejects.toMatchObject({status:403});
  });

  it('revokes every credential that is still valid during an overlap window',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput()),rotated=await rotateServicePrincipalCredential(ctx,created.id,{version:1,expiresAt:new Date(Date.now()+2*3600_000).toISOString(),overlapMinutes:30,reason:'เตรียมทดสอบ emergency revoke ทุก Secret',confirmed:true});
    await revokeServicePrincipal(ctx,created.id,{version:rotated.version,reason:'หยุด connector ฉุกเฉินระหว่าง overlap',confirmed:true});
    await expect(ingestIncomingEvent(queue,eventInput(created.credential))).rejects.toThrow('SERVICE_CREDENTIAL_INVALID');
    await expect(ingestIncomingEvent(queue,eventInput(rotated.credential))).rejects.toThrow('SERVICE_CREDENTIAL_INVALID');
    const principal=(await servicePrincipalWorkspace(ctx)).principals.find(item=>item.id===created.id)!;
    expect(principal.status).toBe('revoked');expect(principal.credentials.every(item=>item.status==='revoked')).toBe(true);
  });

  it('allows auditor visibility but keeps creation, revocation and credential storage owner-controlled',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput()),auditor=await resolveContext(demo.users.consultant,ctx.tenantId),operator=await resolveContext(demo.users.limited,ctx.tenantId),marketing=await resolveContext(demo.users.marketing,ctx.tenantId);
    expect((await servicePrincipalWorkspace(auditor)).principals.some(item=>item.id===created.id)).toBe(true);
    await expect(createServicePrincipal(auditor,createInput())).rejects.toMatchObject({status:403});
    await expect(revokeServicePrincipal(auditor,created.id,{version:1,reason:'ผู้ตรวจไม่ควรเพิกถอนสิทธิ์',confirmed:true})).rejects.toMatchObject({status:403});
    await expect(servicePrincipalWorkspace(operator)).rejects.toMatchObject({status:403});
    await expect(servicePrincipalWorkspace(marketing)).rejects.toMatchObject({status:403});
    await expect(withTenant(ctx,tx=>tx.query('SELECT secret_hash FROM private.service_principal_credentials'))).rejects.toMatchObject({code:'42501'});
  });

  it('serializes concurrent revocation with optimistic versioning',async()=>{
    const ctx=await owner(),created=await createServicePrincipal(ctx,createInput()),input={version:1,reason:'เพิกถอนพร้อมกันเพื่อทดสอบ version boundary',confirmed:true as const};
    const results=await Promise.allSettled([revokeServicePrincipal(ctx,created.id,input),revokeServicePrincipal(ctx,created.id,input)]);
    expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1);
    const rejected=results.find(item=>item.status==='rejected');
    expect(rejected?.status==='rejected'&&rejected.reason).toMatchObject({code:'STALE_SERVICE_PRINCIPAL'});
  });
});
