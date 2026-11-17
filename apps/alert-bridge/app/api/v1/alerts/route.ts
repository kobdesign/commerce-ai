import { receiveSignedAlert } from '../../../../src/receiver';
import { runtimeDependencies } from '../../../../src/runtime';

export const runtime='nodejs';

export async function POST(request:Request){
  let dependencies:ReturnType<typeof runtimeDependencies>;
  try{dependencies=runtimeDependencies();}catch{return Response.json({status:'unavailable',code:'CONFIGURATION_INVALID'},{status:503,headers:{'cache-control':'no-store'}});}
  return receiveSignedAlert(request,dependencies);
}
