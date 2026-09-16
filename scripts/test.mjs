import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
if(!process.env.ADMIN_DATABASE_URL)throw new Error('ADMIN_DATABASE_URL required for isolated integration tests.');
const database='commerce_test_'+randomBytes(6).toString('hex');
const adminUrl=new URL(process.env.ADMIN_DATABASE_URL);adminUrl.pathname='/postgres';
const admin=new Pool({connectionString:adminUrl.toString()});
const env={...process.env,APP_MODE:'local-demo',AI_ENABLED:'false'};
for(const key of ['DATABASE_URL','IDENTITY_DATABASE_URL','QUEUE_DATABASE_URL','ADMIN_DATABASE_URL']){
 const u=new URL(process.env[key]);u.pathname='/'+database;env[key]=u.toString();
}
const run=args=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{stdio:'inherit',env});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`Check exited ${code}`)));});
let created=false;
try{
 await admin.query(`CREATE DATABASE ${database}`);created=true;
 await run(['--import','tsx','scripts/migrate.ts']);
 await run(['--import','tsx','scripts/seed.ts']);
 await run(['node_modules/vitest/vitest.mjs','run']);
}catch(error){console.error(error.message);process.exitCode=1;}
finally{if(created)await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);await admin.end();}
