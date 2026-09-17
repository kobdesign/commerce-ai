import { spawn } from 'node:child_process';

const service=process.argv[2];
if(!['web','worker'].includes(service))throw new Error('Usage: node scripts/render-start.mjs <web|worker>');
if(process.env.APP_MODE!=='staging-demo')throw new Error('Render pilot startup requires APP_MODE=staging-demo.');

let adminUrl=process.env.ADMIN_DATABASE_URL;
if(!adminUrl)throw new Error('ADMIN_DATABASE_URL is required during startup.');

const roleUrls={
  DATABASE_URL:roleUrl('commerce_app','COMMERCE_APP_DB_PASSWORD'),
  IDENTITY_DATABASE_URL:roleUrl('commerce_identity','COMMERCE_IDENTITY_DB_PASSWORD'),
  QUEUE_DATABASE_URL:roleUrl('commerce_queue','COMMERCE_QUEUE_DB_PASSWORD'),
};
const startupEnv={...process.env,...roleUrls};

await run(['--import','tsx','scripts/migrate.ts'],startupEnv);
if(service==='web')await run(['--import','tsx','scripts/seed.ts'],startupEnv);

const runtimeEnv={...startupEnv};
const startupOnly=['ADMIN_DATABASE_URL','COMMERCE_APP_DB_PASSWORD','COMMERCE_IDENTITY_DB_PASSWORD','COMMERCE_QUEUE_DB_PASSWORD','STAGING_DEMO_PASSWORD'];
for(const key of startupOnly){delete runtimeEnv[key];delete startupEnv[key];delete process.env[key];}
if(service==='web')delete runtimeEnv.QUEUE_DATABASE_URL;
else delete runtimeEnv.IDENTITY_DATABASE_URL;
for(const key of Object.keys(roleUrls)){delete startupEnv[key];delete process.env[key];delete roleUrls[key];}
adminUrl=undefined;

const command=service==='web'?['scripts/next.mjs','start']:['--import','tsx','apps/worker/src/index.ts'];
const child=spawn(process.execPath,command,{stdio:'inherit',env:runtimeEnv});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));

function roleUrl(role,passwordKey){
  const explicit=process.env[role==='commerce_app'?'DATABASE_URL':role==='commerce_identity'?'IDENTITY_DATABASE_URL':'QUEUE_DATABASE_URL'];
  if(explicit)return explicit;
  const password=process.env[passwordKey];
  if(!password)throw new Error(`${passwordKey} is required during startup.`);
  const value=new URL(adminUrl);value.username=role;value.password=password;
  return value.toString();
}

function run(args,env){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{stdio:'inherit',env});
    child.on('error',reject);
    child.on('exit',code=>code===0?resolve():reject(new Error(`Startup command failed with exit code ${code??'unknown'}.`)));
  });
}
