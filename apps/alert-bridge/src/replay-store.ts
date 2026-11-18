import type { AlertReplayStore } from '@commerce/operations';

export type AtomicRedisClient={set(key:string,value:string,options:{nx:true;pxat:number}):Promise<'OK'|null>;ping():Promise<string>};

export class DurableAlertReplayStore implements AlertReplayStore{
  constructor(private readonly redis:AtomicRedisClient,private readonly keyPrefix='commerce:alert-replay:v1'){}
  async consume(eventId:string,expiresAt:Date):Promise<'accepted'|'duplicate'>{
    const expiresAtMs=expiresAt.getTime();
    if(!Number.isSafeInteger(expiresAtMs)||expiresAtMs<=Date.now())throw new Error('Replay expiry must be in the future.');
    const result=await this.redis.set(`${this.keyPrefix}:${eventId}`,'1',{nx:true,pxat:expiresAtMs});
    return result==='OK'?'accepted':'duplicate';
  }
}
