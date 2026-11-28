import {activatePlatformAgentRoute,revokePlatformAgentRoute} from '@commerce/db';
import {mutationInput,requireUser,respond} from '../../../../lib/server';

export async function POST(req:Request){
  return respond(async()=>activatePlatformAgentRoute((await requireUser()).id,await mutationInput(req,8192)));
}

export async function PATCH(req:Request){
  return respond(async()=>revokePlatformAgentRoute((await requireUser()).id,await mutationInput(req,8192)));
}
