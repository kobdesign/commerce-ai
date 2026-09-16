import { z } from 'zod';
import { members,changeMember } from '@commerce/domain';
import { roles } from '@commerce/contracts';
import { apiContext,respond,jsonInput } from '../../../../../lib/server';
type Params={params:Promise<{tenantId:string}>};
export async function GET(_req:Request,{params}:Params){return respond(async()=>members(await apiContext((await params).tenantId)));}
export async function PATCH(req:Request,{params}:Params){return respond(async()=>{const ctx=await apiContext((await params).tenantId);const d=z.object({userId:z.string().uuid(),role:z.enum(roles),active:z.boolean()}).strict().parse(await jsonInput(req));await changeMember(ctx,d.userId,d.role,d.active);return {ok:true};});}
