import { executeAnalysis,runs } from '@commerce/ai';
import { apiContext,respond,jsonInput } from '../../../../../lib/server';
export const maxDuration=60;
type Params={params:Promise<{tenantId:string}>};
export async function GET(_req:Request,{params}:Params){return respond(async()=>runs(await apiContext((await params).tenantId)));}
export async function POST(req:Request,{params}:Params){return respond(async()=>executeAnalysis(await apiContext((await params).tenantId),await jsonInput(req)));}
