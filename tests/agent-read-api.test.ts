import { generateKeyPairSync,randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { handleAgentQueryRequest } from '@commerce/agent-api';
import { AgentEvidenceVerificationError,verifyAgentEvidenceResponse } from '@commerce/agent-evidence';
import { CommerceAgentApiError,commerceAgentIdempotencyId,createCommerceAgentClient } from '@commerce/commerce-agent-client';
import { activatePlatformAgentRoute,closePools,platformAgentControlWorkspace,resolveContext } from '@commerce/db';
import { demo } from '@commerce/domain';
import { createServicePrincipal } from '@commerce/integrations';
import {bindCommerceAgentSession,consumeCommerceAgentSessionGrant,createCommerceAgentSession} from '@commerce/agent-session';
import {exportCommerceSessionPublicKey,verifyCommerceSessionGrant} from '@commerce/agent-session-auth';
import {readAgentRouteConfiguration} from '@commerce/agent-routing';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
let credential='',goodsCredential='';
const owner=()=>resolveContext(demo.users.owner,demo.tenants.chino);

function operationFor(pathname:string){
  if(pathname.endsWith('/products/query'))return 'products.query' as const;
  if(pathname.endsWith('/sales/query'))return 'sales.query' as const;
  return 'inventory.query' as const;
}
const localFetch:typeof fetch=async(input,init)=>{
  const request=new Request(input,init);return handleAgentQueryRequest(request,operationFor(new URL(request.url).pathname));
};

beforeAll(async()=>{
  const created=await createServicePrincipal(await owner(),{
    name:`POC read models ${randomUUID()}`,shopIds:[demo.shops.tiktok,demo.shops.shopee],
    scopes:['catalog:read','sales:read','inventory:read'],environment:'development',audience:'commerce-agent-api',
    expiresAt:new Date(Date.now()+3600_000).toISOString(),confirmed:true,
  });
  credential=created.credential;
  const goods=await createServicePrincipal(await resolveContext(demo.users.other,demo.tenants.goods),{
    name:`POC isolated read models ${randomUUID()}`,shopIds:[demo.shops.goods],
    scopes:['catalog:read','sales:read','inventory:read'],environment:'development',audience:'commerce-agent-api',
    expiresAt:new Date(Date.now()+3600_000).toISOString(),confirmed:true,
  });
  goodsCredential=goods.credential;
});
afterAll(async()=>Promise.all([closePools(),admin.end()]));

const client=()=>createCommerceAgentClient({baseUrl:'http://localhost:3000',credential,environment:'development',fetch:localFetch});
const goodsClient=()=>createCommerceAgentClient({baseUrl:'http://localhost:3000',credential:goodsCredential,environment:'development',fetch:localFetch});

describe('receipt-bound Commerce Agent read APIs',()=>{
  it('recovers a response lost after Core completion without duplicating receipt or evidence',async()=>{
    const key=`eve:session:turn:call:${randomUUID()}`;
    const requestId=commerceAgentIdempotencyId(key,'products.query');
    const replayHeaders:string[]=[];let loseFirstResponse=true;
    const lossyFetch:typeof fetch=async(input,init)=>{
      const response=await localFetch(input,init);replayHeaders.push(response.headers.get('x-commerce-idempotent-replay')??'missing');
      if(loseFirstResponse){loseFirstResponse=false;await response.clone().json();throw new Error('SIMULATED_RUNTIME_CRASH_AFTER_CORE_COMMIT');}
      return response;
    };
    const durable=createCommerceAgentClient({baseUrl:'http://localhost:3000',credential,environment:'development',fetch:lossyFetch});
    const query={shopIds:[demo.shops.tiktok],cursor:null,limit:2,search:'',status:'active' as const};
    await expect(durable.products(query,{idempotencyKey:key})).rejects.toThrow('SIMULATED_RUNTIME_CRASH_AFTER_CORE_COMMIT');
    const recovered=await durable.products(query,{idempotencyKey:key});
    expect(recovered.requestId).toBe(requestId);expect(replayHeaders).toEqual(['false','true']);
    const counts=(await admin.query<{receipts:number;results:number}>(`SELECT
      (SELECT count(*)::int FROM app.agent_service_request_receipts WHERE request_id=$1) AS receipts,
      (SELECT count(*)::int FROM app.agent_service_request_results WHERE request_id=$1) AS results`,[requestId])).rows[0];
    expect(counts).toEqual({receipts:1,results:1});
    await expect(durable.products({...query,search:'different'},{idempotencyKey:key}))
      .rejects.toMatchObject<Partial<CommerceAgentApiError>>({status:409,response:{error:{code:'REQUEST_REPLAYED'}} as never});
  });

  it('derives stable operation-separated request identities',()=>{
    const key='eve:session-1:turn-1:call-1';
    expect(commerceAgentIdempotencyId(key,'products.query')).toBe(commerceAgentIdempotencyId(key,'products.query'));
    expect(commerceAgentIdempotencyId(key,'products.query')).not.toBe(commerceAgentIdempotencyId(key,'inventory.query'));
    expect(commerceAgentIdempotencyId(key,'products.query')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('partitions an identical idempotency key by authenticated tenant',async()=>{
    const key=`eve:shared-shape:${randomUUID()}`;
    const chino=await client().products({shopIds:[demo.shops.tiktok],cursor:null,limit:2,search:'',status:'active'},{idempotencyKey:key});
    const goods=await goodsClient().products({shopIds:[demo.shops.goods],cursor:null,limit:2,search:'',status:'active'},{idempotencyKey:key});
    expect(chino.requestId).toBe(goods.requestId);
    expect(JSON.stringify(chino)).not.toContain(demo.tenants.goods);expect(JSON.stringify(chino)).not.toContain(demo.shops.goods);
    const rows=(await admin.query<{tenant_id:string}>('SELECT tenant_id FROM app.agent_service_request_results WHERE request_id=$1 ORDER BY tenant_id',[chino.requestId])).rows;
    expect(rows.map(row=>row.tenant_id).sort()).toEqual([demo.tenants.chino,demo.tenants.goods].sort());
  });

  it('returns reduced product facts with evidence and opaque pagination',async()=>{
    const first=await client().products({shopIds:[demo.shops.tiktok],cursor:null,limit:1,search:'',status:'active'});
    expect(first.resource).toBe('products');expect(first.isSynthetic).toBe(true);expect(first.items).toHaveLength(1);
    expect(first.page).toMatchObject({returned:1,hasMore:true});expect(first.page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.items[0].evidence.map(item=>item.kind)).toEqual(['product','variant']);
    expect(JSON.stringify(first.items)).not.toMatch(/cost|supplier|customer/i);
    const second=await client().products({shopIds:[demo.shops.tiktok],cursor:first.page.nextCursor,limit:1,search:'',status:'active'});
    expect(second.items[0].variantId).not.toBe(first.items[0].variantId);
    expect(second.asOf).toBe(first.asOf);
  });

  it('produces independently verifiable evidence and detects payload tampering',async()=>{
    const response=await client().products({shopIds:[demo.shops.tiktok],cursor:null,limit:100,search:'CH-L-BK-32',status:'active'});
    const manifest=await verifyAgentEvidenceResponse(response);
    expect(manifest).toHaveLength(response.items.length*2);
    expect(manifest.every(item=>item.resource==='products'&&item.sourceRequestId===response.requestId)).toBe(true);
    const tampered=structuredClone(response);tampered.items[0].name=`${tampered.items[0].name} changed`;
    await expect(verifyAgentEvidenceResponse(tampered)).rejects.toBeInstanceOf(AgentEvidenceVerificationError);
  });

  it('returns inventory arithmetic and only channels inside delegated request scope',async()=>{
    const response=await client().inventory({shopIds:[demo.shops.tiktok],cursor:null,limit:10,search:'',availability:'all',includeChannelAllocation:true});
    expect(response.items.length).toBeGreaterThan(0);
    for(const item of response.items){
      expect(item.available).toBe(Math.max(0,item.onHand-item.reserved));
      expect(item.distributable).toBe(Math.max(0,item.available-item.safetyStock));
      expect(item.channels.every(channel=>channel.shopId===demo.shops.tiktok)).toBe(true);
      expect(item.evidence.map(evidence=>evidence.kind)).toEqual(['inventory_balance','inventory_policy']);
    }
  });

  it('returns privacy-reduced sales aggregates without raw order identities',async()=>{
    const today=new Date().toISOString().slice(0,10);
    const response=await client().sales({shopIds:[demo.shops.tiktok],cursor:null,limit:10,period:{from:today,to:today},granularity:'variant',orderStates:['completed']});
    expect(response.resource).toBe('sales');
    for(const item of response.items){
      expect(item.quantity).toBeGreaterThan(0);expect(item.orderCount).toBeGreaterThan(0);
      expect(item.evidence.map(evidence=>evidence.kind)).toEqual(['sales_aggregate']);
    }
    expect(JSON.stringify(response.items)).not.toMatch(/externalOrder|customer|buyer|address/i);
  });

  it('rejects a cross-tenant shop even through the typed client',async()=>{
    await expect(client().products({shopIds:[demo.shops.goods],cursor:null,limit:10,search:'',status:'active'}))
      .rejects.toMatchObject<Partial<CommerceAgentApiError>>({status:403,response:{error:{code:'SHOP_FORBIDDEN'}} as never});
  });

  it('binds cursors to the complete query so they cannot be replayed across a shop or tenant',async()=>{
    const first=await client().products({shopIds:[demo.shops.tiktok],cursor:null,limit:1,search:'',status:'active'});
    expect(first.page.nextCursor).not.toBeNull();
    await expect(client().products({shopIds:[demo.shops.shopee],cursor:first.page.nextCursor,limit:1,search:'',status:'active'}))
      .rejects.toMatchObject<Partial<CommerceAgentApiError>>({status:400,response:{error:{code:'INVALID_REQUEST'}} as never});
    await expect(goodsClient().products({shopIds:[demo.shops.goods],cursor:first.page.nextCursor,limit:1,search:'',status:'active'}))
      .rejects.toMatchObject<Partial<CommerceAgentApiError>>({status:400,response:{error:{code:'INVALID_REQUEST'}} as never});
  });

  it('does not expose foreign tenant identifiers in scope, evidence or serialized facts',async()=>{
    const response=await client().inventory({shopIds:[demo.shops.tiktok],cursor:null,limit:20,search:'',availability:'all',includeChannelAllocation:true});
    const serialized=JSON.stringify(response);
    expect(serialized).not.toContain(demo.tenants.goods);
    expect(serialized).not.toContain(demo.shops.goods);
    expect(serialized).not.toContain(demo.products.serum);
    expect(response.scope.shopIds).toEqual([demo.shops.tiktok]);
    expect(response.items.flatMap(item=>item.channels).every(channel=>channel.shopId===demo.shops.tiktok)).toBe(true);
  });

  it('marks successful and rejected agent responses private and non-cacheable',async()=>{
    const observed:string[]=[];
    const inspectedFetch:typeof fetch=async(input,init)=>{
      const response=await localFetch(input,init);observed.push(response.headers.get('cache-control')??'');return response;
    };
    const inspected=createCommerceAgentClient({baseUrl:'http://localhost:3000',credential,environment:'development',fetch:inspectedFetch});
    await inspected.products({shopIds:[demo.shops.tiktok],cursor:null,limit:2,search:'',status:'active'});
    await expect(inspected.products({shopIds:[demo.shops.goods],cursor:null,limit:2,search:'',status:'active'})).rejects.toBeInstanceOf(CommerceAgentApiError);
    expect(observed).toEqual(['private, no-store','private, no-store']);
  });

  it('keeps receipt validation helper private from the runtime role',async()=>{
    const result=await admin.query<{allowed:boolean}>("SELECT has_function_privilege('commerce_app','app.assert_agent_read_receipt(uuid,uuid,text,uuid[])','EXECUTE') AS allowed");
    expect(result.rows[0].allowed).toBe(false);
    const resultTable=await admin.query<{allowed:boolean}>("SELECT has_table_privilege('commerce_app','app.agent_service_request_results','SELECT') AS allowed");
    expect(resultTable.rows[0].allowed).toBe(false);
  });

  it('authorizes tenant-scoped reads with a consumed continuation grant and no tenant credential',async()=>{
    const pair=generateKeyPairSync('ed25519');
    const privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url');
    const keyId=`delegated-${randomUUID()}`,ctx=await owner(),sessionId=`wrun_${randomUUID()}`;
    const previousKeyId=process.env.COMMERCE_AGENT_SESSION_KEY_ID,previousPrivateKey=process.env.COMMERCE_AGENT_SESSION_PRIVATE_KEY;
    process.env.COMMERCE_AGENT_SESSION_KEY_ID=keyId;process.env.COMMERCE_AGENT_SESSION_PRIVATE_KEY=privateKey;
    try{
      const policy=(await platformAgentControlWorkspace(demo.users.owner)).tenants.find(item=>item.tenantId===demo.tenants.chino);
      await activatePlatformAgentRoute(demo.users.owner,{tenantId:demo.tenants.chino,version:policy?.version??0,environment:'development',
        expiresAt:new Date(Date.now()+3600_000).toISOString(),reason:'เปิด dynamic tenant policy สำหรับ delegated read integration test',confirmed:true});
      const configuration={environment:'development' as const,keyId,privateKey,dynamicRouting:true,
        route:readAgentRouteConfiguration({COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'false'})};
      const verifier={environment:'development' as const,keyId,publicKey:exportCommerceSessionPublicKey(privateKey)};
      const created=await createCommerceAgentSession(ctx,{shopIds:[demo.shops.tiktok]},configuration);
      if(!created.token)throw new Error('Expected create grant');
      await consumeCommerceAgentSessionGrant(created.token,verifier);
      await bindCommerceAgentSession(ctx,{grantToken:created.token,sessionId,confirmed:true},configuration);
      const continued=await createCommerceAgentSession(ctx,{sessionId},configuration);
      if(!continued.token)throw new Error('Expected continuation grant');
      await consumeCommerceAgentSessionGrant(continued.token,verifier);

      const delegated=createCommerceAgentClient({baseUrl:'http://localhost:3000',grantToken:continued.token,environment:'development',fetch:localFetch});
      const response=await delegated.products({shopIds:[demo.shops.tiktok],cursor:null,limit:2,search:'',status:'active'});
      expect(response.scope.shopIds).toEqual([demo.shops.tiktok]);
      expect(JSON.stringify(response)).not.toContain(demo.tenants.goods);
      await expect(delegated.products({shopIds:[demo.shops.goods],cursor:null,limit:2,search:'',status:'active'}))
        .rejects.toMatchObject<Partial<CommerceAgentApiError>>({status:403,response:{error:{code:'SHOP_FORBIDDEN'}} as never});
      const claims=verifyCommerceSessionGrant(continued.token,verifier);
      const receipt=await admin.query<{tenant_id:string;subject_id:string}>('SELECT tenant_id,subject_id FROM app.agent_session_read_receipts WHERE grant_id=$1',[claims.grantId]);
      expect(receipt.rows[0]).toEqual({tenant_id:demo.tenants.chino,subject_id:demo.users.owner});
    }finally{
      if(previousKeyId===undefined)delete process.env.COMMERCE_AGENT_SESSION_KEY_ID;else process.env.COMMERCE_AGENT_SESSION_KEY_ID=previousKeyId;
      if(previousPrivateKey===undefined)delete process.env.COMMERCE_AGENT_SESSION_PRIVATE_KEY;else process.env.COMMERCE_AGENT_SESSION_PRIVATE_KEY=previousPrivateKey;
    }
  });
});
