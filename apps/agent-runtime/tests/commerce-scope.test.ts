import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionContext } from 'eve/context';
import { requireCommerceDelegation,requireCommerceScope } from '../agent/lib/commerce-scope.ts';

const ids={user:'10000000-0000-4000-8000-000000000001',other:'10000000-0000-4000-8000-000000000002',tenant:'20000000-0000-4000-8000-000000000001',otherTenant:'20000000-0000-4000-8000-000000000002',shop:'30000000-0000-4000-8000-000000000001'};
const principal=(user=ids.user,tenant=ids.tenant)=>({authenticator:'jwt-ecdsa' as const,issuer:'commerce-core',principalId:user,principalType:'user' as const,subject:user,
  attributes:{tenantId:tenant,shopIds:[ids.shop],role:'owner',grantId:'70000000-0000-4000-8000-000000000001',capability:'create'}});
function context(current:ReturnType<typeof principal>|null,initiator:ReturnType<typeof principal>|null){
  return {session:{auth:{current,initiator}}} as unknown as Pick<SessionContext,'session'>;
}

test('takes Commerce scope only from the signed, pinned session initiator',()=>{
  assert.deepEqual(requireCommerceScope(context(principal(),principal())),{tenantId:ids.tenant,shopIds:[ids.shop]});
});

test('rejects a different user or tenant continuing the session',()=>{
  assert.throws(()=>requireCommerceScope(context(principal(ids.other,ids.otherTenant),principal())),/does not own/);
  assert.throws(()=>requireCommerceScope(context(principal(ids.other,ids.tenant),principal())),/does not own/);
});

test('rejects untrusted principal attributes even when they look like a valid scope',()=>{
  const forged={...principal(),issuer:'https://oidc.example'};
  assert.throws(()=>requireCommerceScope(context(forged as ReturnType<typeof principal>,forged as ReturnType<typeof principal>)),/Commerce Core authenticated/);
});

test('requires a fresh continuation grant for read tools',()=>{
  const initiator=principal();
  const current={...principal(),attributes:{...principal().attributes,capability:'continue',sessionId:'wrun_example_session',commerceGrant:'csg1_example'}};
  const ctx={session:{id:'wrun_example_session',auth:{current,initiator}}} as unknown as Pick<SessionContext,'session'>;
  assert.deepEqual(requireCommerceDelegation(ctx),{scope:{tenantId:ids.tenant,shopIds:[ids.shop]},grantToken:'csg1_example'});
  assert.throws(()=>requireCommerceDelegation(context(principal(),principal())),/fresh Commerce continuation/);
});
