import { pool } from '@commerce/db';

export const dynamic='force-dynamic';

export async function GET(){
  try{
    await pool().query('SELECT 1');
    return Response.json({status:'ok'},{headers:{'Cache-Control':'no-store'}});
  }catch{
    return Response.json({status:'unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
