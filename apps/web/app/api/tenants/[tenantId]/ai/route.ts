import { executeAnalysis,runs } from '@commerce/ai';
import { apiContext,respond,mutationInput } from '../../../../../lib/server';
import { AppError } from '@commerce/contracts';
export const maxDuration=60;
type Params={params:Promise<{tenantId:string}>};
export async function GET(req:Request,{params}:Params){return respond(async()=>{const shopId=new URL(req.url).searchParams.get('shopId');if(!shopId)throw new AppError(400,'SHOP_REQUIRED','กรุณาเลือกร้านค้า');return runs(await apiContext((await params).tenantId),shopId);});}
export async function POST(req:Request,{params}:Params){return respond(async()=>executeAnalysis(await apiContext((await params).tenantId),await mutationInput(req)));}
