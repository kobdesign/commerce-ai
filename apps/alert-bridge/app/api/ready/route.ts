import { runtimeReadiness } from '../../../src/runtime';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  try{await runtimeReadiness();return Response.json({status:'ok',service:'commerce-alert-bridge'},{headers:{'cache-control':'no-store'}});}
  catch{return Response.json({status:'unavailable',service:'commerce-alert-bridge'},{status:503,headers:{'cache-control':'no-store'}});}
}
