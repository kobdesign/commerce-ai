import { z } from 'zod';
import { organizations,createOrganization } from '@commerce/domain';
import { respond,requireUser,jsonInput } from '../../../lib/server';
export async function GET(){return respond(async()=>organizations((await requireUser()).id));}
export async function POST(req:Request){return respond(async()=>{const u=await requireUser();const {name}=z.object({name:z.string()}).strict().parse(await jsonInput(req));return {id:await createOrganization(u.id,name)};});}
