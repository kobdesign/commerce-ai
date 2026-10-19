import { catalog,createProduct,type CatalogStatus } from '@commerce/domain';
import { apiContext,respond,mutationInput } from '../../../../../lib/server';
type Params={params:Promise<{tenantId:string}>};
export async function GET(req:Request,{params}:Params){return respond(async()=>{const search=new URL(req.url).searchParams;return catalog(await apiContext((await params).tenantId),search.get('shopId')??'',search.get('q')??'',(search.get('status')??'active') as CatalogStatus);});}
export async function POST(req:Request,{params}:Params){return respond(async()=>createProduct(await apiContext((await params).tenantId),await mutationInput(req)));}
