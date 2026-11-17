import { Redis } from '@upstash/redis';
import { alertBridgeConfig } from './config';
import { DurableAlertReplayStore,type AtomicRedisClient } from './replay-store';

let client:AtomicRedisClient|undefined;

export function runtimeDependencies(){
  const config=alertBridgeConfig();
  client??=Redis.fromEnv() as AtomicRedisClient;
  return {config,replayStore:new DurableAlertReplayStore(client)};
}

export async function runtimeReadiness(){
  alertBridgeConfig();
  client??=Redis.fromEnv() as AtomicRedisClient;
  const pong=await client.ping();
  if(pong!=='PONG')throw new Error('Redis readiness check failed.');
}
