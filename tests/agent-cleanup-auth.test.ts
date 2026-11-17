import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {
  CommerceCleanupGrantError,
  issueCommerceCleanupGrant,
  verifyCommerceCleanupGrant,
} from '@commerce/agent-session-auth';

const ids={tenant:randomUUID(),intent:randomUUID(),session:'wrun_cleanup_auth_12345678'};
function pair(){
  const value=generateKeyPairSync('ed25519');
  return {
    privateKey:value.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url'),
    publicKey:value.publicKey.export({format:'der',type:'spki'}).toString('base64url'),
  };
}
const oldKey=pair(),currentKey=pair(),now=new Date('2026-11-16T10:00:00.000Z');
function issue(keyId:string,privateKey:string){return issueCommerceCleanupGrant({
  tenantId:ids.tenant,intentId:ids.intent,sessionId:ids.session,environment:'staging',ttlSeconds:60,
},{keyId,privateKey,now});}

describe('Commerce cleanup service identity',()=>{
  it('binds a short-lived grant to one tenant, intent, session and end capability',()=>{
    const issued=issue('cleanup-current',currentKey.privateKey);
    expect(verifyCommerceCleanupGrant(issued.token,{
      environment:'staging',publicKeys:{'cleanup-current':currentKey.publicKey},now,
    })).toEqual(issued.claims);
    expect(issued.claims).toMatchObject({
      tenantId:ids.tenant,intentId:ids.intent,sessionId:ids.session,capability:'cleanup:end',subject:'commerce-lifecycle-worker',
    });
  });

  it('supports a bounded current/previous rotation window and explicit emergency revocation',()=>{
    const old=issue('cleanup-old',oldKey.privateKey),current=issue('cleanup-current',currentKey.privateKey);
    const keyring={'cleanup-old':oldKey.publicKey,'cleanup-current':currentKey.publicKey};
    expect(verifyCommerceCleanupGrant(old.token,{environment:'staging',publicKeys:keyring,now}).intentId).toBe(ids.intent);
    expect(verifyCommerceCleanupGrant(current.token,{environment:'staging',publicKeys:keyring,now}).intentId).toBe(ids.intent);
    expect(()=>verifyCommerceCleanupGrant(old.token,{environment:'staging',publicKeys:keyring,revokedKeyIds:['cleanup-old'],now}))
      .toThrowError(expect.objectContaining<Partial<CommerceCleanupGrantError>>({code:'CLEANUP_KEY_REVOKED'}));
  });

  it('rejects expiry, environment mismatch, tampering and oversized keyrings',()=>{
    const issued=issue('cleanup-current',currentKey.privateKey),keyring={'cleanup-current':currentKey.publicKey};
    expect(()=>verifyCommerceCleanupGrant(issued.token,{environment:'development',publicKeys:keyring,now}))
      .toThrowError(expect.objectContaining<Partial<CommerceCleanupGrantError>>({code:'CLEANUP_ENVIRONMENT_MISMATCH'}));
    expect(()=>verifyCommerceCleanupGrant(issued.token,{environment:'staging',publicKeys:keyring,now:new Date('2026-11-16T10:03:00.000Z')}))
      .toThrowError(expect.objectContaining<Partial<CommerceCleanupGrantError>>({code:'EXPIRED_CLEANUP_GRANT'}));
    const tampered=`${issued.token.slice(0,-1)}${issued.token.endsWith('A')?'B':'A'}`;
    expect(()=>verifyCommerceCleanupGrant(tampered,{environment:'staging',publicKeys:keyring,now})).toThrow();
    expect(()=>verifyCommerceCleanupGrant(issued.token,{environment:'staging',publicKeys:{...keyring,a:'x'.repeat(50),b:'x'.repeat(50),c:'x'.repeat(50)},now})).toThrow();
  });
});
