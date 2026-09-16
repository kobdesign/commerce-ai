import { catalog,createProduct } from '@commerce/domain';
import { apiContext,respond,jsonInput } from '../../../../../lib/server';
type Params={params:Promise<{tenantId:string}>};
export async function GET(req:Request,{params}:Params){return respond(async()=>catalog(await apiContext((await params).tenantId),new URL(req.url).searchParams.get('shopId')??''));}
export async function POST(req:Request,{params}:Params){return respond(async()=>createProduct(await apiContext((await params).tenantId),await jsonInput(req)));}
