export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){return Response.json({status:'ok',service:'commerce-alert-bridge'},{headers:{'cache-control':'no-store'}});}
