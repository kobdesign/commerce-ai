import {z} from 'zod';

type Environment=Readonly<Record<string,string|undefined>>;
const responseSchema=z.object({status:z.literal('consumed'),grantId:z.string().uuid(),consumedAt:z.string().datetime({offset:true})}).strict();

export async function consumeCommerceGrant(
  token:string,
  expectedGrantId:string,
  env:Environment=process.env,
  fetchImpl:typeof fetch=fetch,
){
  const baseUrl=env.COMMERCE_CORE_URL?.trim();
  if(!baseUrl)throw new Error('Commerce Core URL is not configured.');
  const response=await fetchImpl(`${baseUrl.replace(/\/$/,'')}/api/agent/v1/session-grants/consume`,{
    method:'POST',
    headers:{authorization:`Bearer ${token}`},
    signal:AbortSignal.timeout(5_000),
  });
  if(!response.ok)throw new Error(`Commerce grant consumption failed with HTTP ${response.status}.`);
  const parsed=responseSchema.parse(await response.json());
  if(parsed.grantId!==expectedGrantId)throw new Error('Commerce grant consumption response does not match the signed grant.');
  return parsed;
}
