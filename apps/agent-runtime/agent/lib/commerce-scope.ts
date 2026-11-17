import { z } from 'zod';
import type { SessionContext } from 'eve/context';

const scopeSchema=z.object({
  tenantId:z.string().uuid(),
  shopIds:z.array(z.string().uuid()).min(1).max(20).refine(values=>new Set(values).size===values.length,'Shop IDs must be unique'),
}).strict();

export type CommerceScope=z.infer<typeof scopeSchema>;

/** Scope is accepted only from Eve's verified session principal, never a prompt or tool input. */
export function requireCommerceScope(ctx:Pick<SessionContext,'session'>):CommerceScope{
  const initiator=ctx.session.auth.initiator;
  if(initiator?.principalType!=='user'||initiator.issuer!=='commerce-core'||initiator.attributes.capability!=='create'){
    throw new Error('A Commerce Core authenticated session initiator is required.');
  }
  const current=ctx.session.auth.current;
  if(current?.principalType==='user'&&(current.issuer!==initiator.issuer||current.principalId!==initiator.principalId||current.attributes.tenantId!==initiator.attributes.tenantId)){
    throw new Error('The current caller does not own this Commerce session.');
  }
  return scopeSchema.parse({tenantId:initiator.attributes.tenantId,shopIds:initiator.attributes.shopIds});
}
