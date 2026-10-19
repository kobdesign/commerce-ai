import { createHmac,randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { demo } from '@commerce/domain';
import { createServicePrincipal,ingestIncomingEvent,integrationInboxWorkspace,transitionIntegrationInboxEvent,type IncomingEventInput } from '@commerce/integrations';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
const queue=new Pool({connectionString:process.env.QUEUE_DATABASE_URL});
const secret='synthetic-inbox-secret-that-is-long-enough';
let serviceCredential='';
beforeAll(async()=>{
  const owner=await resolveContext(demo.users.owner,demo.tenants.chino);
  serviceCredential=(await createServicePrincipal(owner,{name:`Inbox test ${randomUUID()}`,shopIds:[demo.shops.tiktok],scopes:['integration:ingest'],expiresAt:new Date(Date.now()+3600_000).toISOString(),confirmed:true})).credential;
});
afterAll(async()=>Promise.all([closePools(),admin.end(),queue.end()]));

function signedInput(providerNamespace:string,providerEventId:string,sequenceNumber:number|null,streamId='ORDER-1',body?:Record<string,unknown>):IncomingEventInput{
  const rawBody=JSON.stringify(body??{orderId:streamId,status:'paid',amountMinor:12500});
  return {
    tenantId:demo.tenants.chino,shopId:demo.shops.tiktok,providerNamespace,providerEventId,eventType:'order.status_changed',
    streamType:'order',streamId,sequenceNumber,occurredAt:'2026-10-18T10:00:00.000Z',rawBody,
    signature:`sha256=${createHmac('sha256',secret).update(rawBody).digest('hex')}`,verificationSecret:secret,serviceCredential,
    verificationMethod:'hmac-sha256-v1',verificationKeyReference:'synthetic-key-v1',
    metadata:{adapterVersion:'synthetic-v1',providerApiVersion:'test-v1',deliveryAttempt:1,contentType:'application/json'},
  };
}
const namespace=()=>`synthetic.orders.${randomUUID()}`;

describe('Incoming integration event inbox',()=>{
  it('verifies HMAC, stores immutable evidence and returns the prior row for an exact replay',async()=>{
    const provider=namespace(),input=signedInput(provider,'event-1',10);
    const first=await ingestIncomingEvent(queue,input),replay=await ingestIncomingEvent(queue,input);
    expect(first).toMatchObject({duplicate:false,reconciliationStatus:'ready',disposition:'accepted',version:1});
    expect(replay).toEqual({...first,duplicate:true});
    const stored=(await admin.query<{raw_body_hash:string;signature_status:string;verification_key_reference:string;payload:Record<string,unknown>;metadata:Record<string,unknown>}>(
      'SELECT raw_body_hash,signature_status,verification_key_reference,payload,metadata FROM app.integration_inbox_events WHERE tenant_id=$1 AND id=$2',
      [input.tenantId,first.id],
    )).rows[0];
    expect(stored).toMatchObject({signature_status:'verified',verification_key_reference:'synthetic-key-v1',payload:{orderId:'ORDER-1'},metadata:{adapterVersion:'synthetic-v1'}});
    expect(stored.raw_body_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(stored)).not.toContain(input.signature);
    const emitted=(await admin.query<{event_type:string;aggregate_version:number}>(
      'SELECT event_type,aggregate_version FROM app.integration_outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 ORDER BY aggregate_version',
      [input.tenantId,first.id],
    )).rows;
    expect(emitted).toEqual([{event_type:'integration.inbox_ready.v1',aggregate_version:1}]);
  });

  it('rejects reuse of a provider event ID when the immutable content differs',async()=>{
    const provider=namespace(),input=signedInput(provider,'event-conflict',1);
    await ingestIncomingEvent(queue,input);
    const changed=signedInput(provider,'event-conflict',1,'ORDER-1',{orderId:'ORDER-1',status:'cancelled'});
    await expect(ingestIncomingEvent(queue,changed)).rejects.toThrow('INBOX_EVENT_CONFLICT');
  });

  it('quarantines an invalid signature without advancing the stream cursor',async()=>{
    const provider=namespace(),input={...signedInput(provider,'event-invalid',1),signature:'sha256='.concat('0'.repeat(64))};
    const result=await ingestIncomingEvent(queue,input);
    expect(result).toMatchObject({reconciliationStatus:'rejected',disposition:'invalid_signature'});
    const cursor=Number((await admin.query('SELECT count(*) FROM app.integration_inbox_streams WHERE tenant_id=$1 AND provider_namespace=$2',[input.tenantId,provider])).rows[0].count);
    expect(cursor).toBe(0);
    const emitted=(await admin.query<{event_type:string}>('SELECT event_type FROM app.integration_outbox_events WHERE tenant_id=$1 AND aggregate_id=$2',[input.tenantId,result.id])).rows;
    expect(emitted).toEqual([{event_type:'integration.inbox_rejected.v1'}]);
  });

  it('classifies gaps and stale events, then recovers contiguous gaps automatically',async()=>{
    const provider=namespace(),stream='ORDER-SEQUENCE';
    const ten=await ingestIncomingEvent(queue,signedInput(provider,'event-10',10,stream));
    const twelve=await ingestIncomingEvent(queue,signedInput(provider,'event-12',12,stream));
    const nine=await ingestIncomingEvent(queue,signedInput(provider,'event-9',9,stream));
    const eleven=await ingestIncomingEvent(queue,signedInput(provider,'event-11',11,stream));
    expect(ten.disposition).toBe('accepted');
    expect(twelve).toMatchObject({reconciliationStatus:'needs_review',disposition:'gap',version:1});
    expect(nine).toMatchObject({reconciliationStatus:'needs_review',disposition:'stale'});
    expect(eleven.disposition).toBe('accepted');
    const recovered=(await admin.query<{reconciliation_status:string;disposition:string;version:number}>(
      'SELECT reconciliation_status,disposition,version FROM app.integration_inbox_events WHERE tenant_id=$1 AND id=$2',[demo.tenants.chino,twelve.id],
    )).rows[0];
    expect(recovered).toEqual({reconciliation_status:'ready',disposition:'recovered_gap',version:2});
    const cursor=(await admin.query<{last_sequence:string}>('SELECT last_sequence FROM app.integration_inbox_streams WHERE tenant_id=$1 AND provider_namespace=$2 AND stream_id=$3',[demo.tenants.chino,provider,stream])).rows[0];
    expect(Number(cursor.last_sequence)).toBe(12);
    const emitted=(await admin.query<{event_type:string;aggregate_version:number}>('SELECT event_type,aggregate_version FROM app.integration_outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 ORDER BY aggregate_version',[demo.tenants.chino,twelve.id])).rows;
    expect(emitted).toEqual([
      {event_type:'integration.inbox_needs_review.v1',aggregate_version:1},
      {event_type:'integration.inbox_ready.v1',aggregate_version:2},
    ]);
  });

  it('routes verified events without a provider sequence to review',async()=>{
    const result=await ingestIncomingEvent(queue,signedInput(namespace(),'event-unordered',null));
    expect(result).toMatchObject({reconciliationStatus:'needs_review',disposition:'unordered'});
  });

  it('serializes concurrent exact deliveries into one event',async()=>{
    const input=signedInput(namespace(),'event-concurrent',1);
    const results=await Promise.all(Array.from({length:5},()=>ingestIncomingEvent(queue,input)));
    expect(new Set(results.map(item=>item.id)).size).toBe(1);
    expect(results.filter(item=>item.duplicate)).toHaveLength(4);
    expect(results.filter(item=>!item.duplicate)).toHaveLength(1);
  });

  it('enforces tenant/shop read scope and denies direct queue-role mutation',async()=>{
    const provider=namespace(),result=await ingestIncomingEvent(queue,signedInput(provider,'event-access',1));
    const owner=await resolveContext(demo.users.owner,demo.tenants.chino);
    const operator=await resolveContext(demo.users.limited,demo.tenants.chino);
    const auditor=await resolveContext(demo.users.consultant,demo.tenants.chino);
    const marketing=await resolveContext(demo.users.marketing,demo.tenants.chino);
    for(const actor of [owner,operator,auditor]){
      expect(await withTenant(actor,tx=>tx.query('SELECT id FROM app.integration_inbox_events WHERE provider_namespace=$1',[provider]))).toEqual([{id:result.id}]);
    }
    expect(await withTenant(marketing,tx=>tx.query('SELECT id FROM app.integration_inbox_events WHERE provider_namespace=$1',[provider]))).toEqual([]);
    await expect(queue.query("UPDATE app.integration_inbox_events SET event_type='tampered' WHERE tenant_id=$1 AND id=$2",[demo.tenants.chino,result.id])).rejects.toMatchObject({code:'42501'});
  });
});

describe('Operational integration inbox review',()=>{
  it('returns safe evidence, cursor gap and SLA metrics without payload values',async()=>{
    const provider=namespace(),stream='ORDER-SAFE-EVIDENCE',owner=await resolveContext(demo.users.owner,demo.tenants.chino);
    await ingestIncomingEvent(queue,signedInput(provider,'safe-10',10,stream,{orderId:stream,customerEmail:'private@example.test',status:'paid'}));
    const gap=await ingestIncomingEvent(queue,signedInput(provider,'safe-12',12,stream,{orderId:stream,customerEmail:'private@example.test',status:'shipped'}));
    const workspace=await integrationInboxWorkspace(owner,demo.shops.tiktok),event=workspace.events.find(item=>item.id===gap.id)!;
    expect(event).toMatchObject({operationalStatus:'open',reconciliationStatus:'needs_review',disposition:'gap',cursorSequence:'10',missingSequenceCount:1});
    expect(event.payloadKeys).toEqual(['customerEmail','orderId','status']);
    expect(JSON.stringify(event)).not.toContain('private@example.test');
    expect(workspace.providers).toContain(provider);
    expect(workspace.metrics).toMatchObject({reviewSlaMinutes:15});
    expect(workspace.metrics.open).toBeGreaterThanOrEqual(1);
    expect(workspace.metrics.openGaps).toBeGreaterThanOrEqual(1);
  });

  it('records replay request and acknowledgement with versioned outbox and audit history',async()=>{
    const provider=namespace(),owner=await resolveContext(demo.users.owner,demo.tenants.chino),created=await ingestIncomingEvent(queue,signedInput(provider,'review-action',1));
    const replay=await transitionIntegrationInboxEvent(owner,created.id,{shopId:demo.shops.tiktok,version:1,action:'request_replay',reason:'ตรวจหลักฐานแล้วและต้องการทดสอบ processor อีกครั้ง',confirmed:true});
    expect(replay).toMatchObject({id:created.id,operationalStatus:'replay_requested',version:2});
    const resolved=await transitionIntegrationInboxEvent(owner,created.id,{shopId:demo.shops.tiktok,version:2,action:'acknowledge',reason:'ตรวจผลคำขอแล้วและปิดการติดตามรายการนี้',confirmed:true});
    expect(resolved).toMatchObject({id:created.id,operationalStatus:'resolved',version:3});
    const actions=(await admin.query<{action:string;event_version:number;reason:string}>('SELECT action,event_version,reason FROM app.integration_inbox_actions WHERE tenant_id=$1 AND inbox_event_id=$2 ORDER BY event_version',[demo.tenants.chino,created.id])).rows;
    expect(actions).toEqual([
      {action:'request_replay',event_version:2,reason:'ตรวจหลักฐานแล้วและต้องการทดสอบ processor อีกครั้ง'},
      {action:'acknowledge',event_version:3,reason:'ตรวจผลคำขอแล้วและปิดการติดตามรายการนี้'},
    ]);
    const outbox=(await admin.query<{event_type:string;aggregate_version:number}>('SELECT event_type,aggregate_version FROM app.integration_outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND aggregate_version>1 ORDER BY aggregate_version',[demo.tenants.chino,created.id])).rows;
    expect(outbox).toEqual([{event_type:'integration.inbox_replay_requested.v1',aggregate_version:2},{event_type:'integration.inbox_resolved.v1',aggregate_version:3}]);
    expect(await withTenant(owner,tx=>tx.query("SELECT action FROM app.audit_events WHERE entity_id=$1 AND action LIKE 'integration_inbox.%' ORDER BY created_at",[created.id]))).toEqual([{action:'integration_inbox.request_replay'},{action:'integration_inbox.acknowledge'}]);
  });

  it('never replays an invalid signature but allows a human to close its follow-up',async()=>{
    const owner=await resolveContext(demo.users.owner,demo.tenants.chino),input={...signedInput(namespace(),'invalid-operation',1),signature:'sha256='.concat('f'.repeat(64))},created=await ingestIncomingEvent(queue,input);
    await expect(transitionIntegrationInboxEvent(owner,created.id,{shopId:demo.shops.tiktok,version:1,action:'request_replay',reason:'ไม่ควรส่ง event ที่ตรวจลายเซ็นไม่ผ่าน',confirmed:true})).rejects.toMatchObject({code:'INBOX_SIGNATURE_NOT_VERIFIED'});
    await expect(transitionIntegrationInboxEvent(owner,created.id,{shopId:demo.shops.tiktok,version:1,action:'acknowledge',reason:'ยืนยันว่าเป็นลายเซ็นที่ไม่ถูกต้องและปิดการติดตาม',confirmed:true})).resolves.toMatchObject({operationalStatus:'resolved',version:2});
  });

  it('allows only one concurrent command for the same expected version',async()=>{
    const owner=await resolveContext(demo.users.owner,demo.tenants.chino),created=await ingestIncomingEvent(queue,signedInput(namespace(),'concurrent-operation',1));
    const input={shopId:demo.shops.tiktok,version:1,action:'request_replay' as const,reason:'ทดสอบ optimistic version ภายใต้คำสั่งพร้อมกัน',confirmed:true as const};
    const results=await Promise.allSettled([transitionIntegrationInboxEvent(owner,created.id,input),transitionIntegrationInboxEvent(owner,created.id,input)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const rejected=results.find(result=>result.status==='rejected');
    expect(rejected?.status==='rejected'&&rejected.reason).toMatchObject({code:'STALE_INBOX_EVENT'});
  });

  it('enforces operator write, auditor read-only and marketing isolation',async()=>{
    const provider=namespace(),stream='ORDER-ROLE';await ingestIncomingEvent(queue,signedInput(provider,'role-10',10,stream));
    const gap=await ingestIncomingEvent(queue,signedInput(provider,'role-12',12,stream));
    const operator=await resolveContext(demo.users.limited,demo.tenants.chino),auditor=await resolveContext(demo.users.consultant,demo.tenants.chino),marketing=await resolveContext(demo.users.marketing,demo.tenants.chino);
    expect((await integrationInboxWorkspace(auditor,demo.shops.tiktok)).events.some(item=>item.id===gap.id)).toBe(true);
    await expect(integrationInboxWorkspace(marketing,demo.shops.tiktok)).rejects.toMatchObject({status:403});
    await expect(transitionIntegrationInboxEvent(auditor,gap.id,{shopId:demo.shops.tiktok,version:1,action:'acknowledge',reason:'ผู้ตรวจไม่ควรเปลี่ยนสถานะรายการ',confirmed:true})).rejects.toMatchObject({status:403});
    await expect(transitionIntegrationInboxEvent(operator,gap.id,{shopId:demo.shops.tiktok,version:1,action:'acknowledge',reason:'ผู้ดูแลตรวจลำดับแล้วและปิดการติดตาม',confirmed:true})).resolves.toMatchObject({operationalStatus:'resolved'});
  });
});
