import { shops,createShop } from '@commerce/domain';
import { apiContext,respond,jsonInput } from '../../../../../lib/server';
type Params={params:Promise<{tenantId:string}>};
export async function GET(_req:Request,{params}:Params){return respond(async()=>shops(await apiContext((await params).tenantId)));}
export async function POST(req:Request,{params}:Params){return respond(async()=>({id:await createShop(await apiContext((await params).tenantId),await jsonInput(req))}));}
