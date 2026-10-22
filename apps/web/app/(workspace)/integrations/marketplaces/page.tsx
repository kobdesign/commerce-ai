import { marketplaceConnections,tiktokShopConfiguration } from '@commerce/connectors';
import { MarketplaceConnectionsWorkspace } from '../../../../components/marketplace-connections-workspace';
import { workspace } from '../../../../lib/server';

export default async function MarketplaceConnectionsPage({searchParams}:{searchParams:Promise<{tiktok?:string}>}){
  const w=await workspace(),params=await searchParams,configuration=tiktokShopConfiguration();
  const connections=w.shop?await marketplaceConnections(w.ctx,w.shop.id):[];
  return <MarketplaceConnectionsWorkspace tenantId={w.org.id} shop={w.shop} role={w.ctx.role} connections={connections}
    configuration={{ready:configuration.ready,environment:configuration.environment,redirectUri:configuration.redirectUri,blockers:configuration.blockers}}
    callbackStatus={params.tiktok??null}/>;
}
