import { Pool } from 'pg';
import { demo } from '../packages/domain/src/demo';

const enabled=process.env.COMMERCE_AGENT_STAGING_PRINCIPAL_BOOTSTRAP==='true';
if(enabled){
if(process.env.APP_MODE!=='staging-demo')throw new Error('Agent service principal bootstrap is allowed only in staging-demo.');

const databaseUrl=required('ADMIN_DATABASE_URL');
const credentialHash=required('COMMERCE_AGENT_STAGING_CREDENTIAL_HASH');
const credentialPrefix=required('COMMERCE_AGENT_STAGING_CREDENTIAL_PREFIX');
const expiresAt=new Date(required('COMMERCE_AGENT_STAGING_CREDENTIAL_EXPIRES_AT'));
if(!/^[0-9a-f]{64}$/.test(credentialHash))throw new Error('COMMERCE_AGENT_STAGING_CREDENTIAL_HASH must be a SHA-256 hex digest.');
if(!/^svc_[A-Za-z0-9_-]{12}$/.test(credentialPrefix))throw new Error('COMMERCE_AGENT_STAGING_CREDENTIAL_PREFIX format is invalid.');
if(!Number.isFinite(expiresAt.getTime())||expiresAt.getTime()<=Date.now()+5*60_000||expiresAt.getTime()>Date.now()+366*24*60*60_000){
  throw new Error('COMMERCE_AGENT_STAGING_CREDENTIAL_EXPIRES_AT must be 5 minutes to 366 days in the future.');
}

const principalId='51111111-1111-4111-8111-111111111111';
const credentialId='61111111-1111-4111-8111-111111111111';
const principalName='Eve staging synthetic reader';
const audience='commerce-agent-api';
const scopes=['catalog:read','sales:read','inventory:read'];
const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5_000});
const client=await pool.connect();
try{
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.actor_id',$1,true),set_config('app.tenant_id',$2,true)",[demo.users.owner,demo.tenants.chino]);
  await client.query("SET LOCAL statement_timeout='8s'");
  const existing=await client.query<{id:string;credential_hash:string;credential_prefix:string;environment:string;audience:string;status:string;shop_ids:string[];scopes:string[]}>(`
    SELECT p.id,c.secret_hash AS credential_hash,c.secret_prefix AS credential_prefix,p.environment,p.audience,p.status,
      array_agg(DISTINCT d.shop_id::text ORDER BY d.shop_id::text) AS shop_ids,
      array_agg(DISTINCT scope ORDER BY scope)::text[] AS scopes
    FROM app.service_principals p
    JOIN private.service_principal_credentials c ON c.tenant_id=p.tenant_id AND c.principal_id=p.id AND c.id=$2
    JOIN app.service_principal_delegations d ON d.tenant_id=p.tenant_id AND d.principal_id=p.id
    CROSS JOIN LATERAL unnest(d.scopes) AS delegated(scope)
    WHERE p.tenant_id=$1 AND p.id=$3
    GROUP BY p.id,c.secret_hash,c.secret_prefix,p.environment,p.audience,p.status`,[demo.tenants.chino,credentialId,principalId]);
  if(existing.rowCount){
    const row=existing.rows[0];
    const expectedScopes=[...scopes].sort();
    if(row.credential_hash!==credentialHash||row.credential_prefix!==credentialPrefix||row.environment!=='staging'||row.audience!==audience||row.status!=='active'||
      JSON.stringify(row.shop_ids)!==JSON.stringify([demo.shops.tiktok])||JSON.stringify(row.scopes)!==JSON.stringify(expectedScopes)){
      throw new Error('Existing staging agent principal does not match the approved synthetic read-only policy.');
    }
    await client.query('COMMIT');
    console.log(`Staging agent service principal already current: ${principalId}`);
  }else{
    await client.query('SELECT app.create_service_principal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[
      principalId,credentialId,principalName,[demo.shops.tiktok],scopes,expiresAt.toISOString(),'staging',audience,credentialHash,credentialPrefix,
    ]);
    await client.query('COMMIT');
    console.log(`Staging agent service principal created: ${principalId}`);
  }
}catch(error){
  await client.query('ROLLBACK');
  throw error;
}finally{
  client.release();
  await pool.end();
}
}

function required(name:string){
  const value=process.env[name]?.trim();
  if(!value)throw new Error(`${name} is required when staging principal bootstrap is enabled.`);
  return value;
}
