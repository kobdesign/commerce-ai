import { Pool } from 'pg';
import { readFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const admin = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const client = await admin.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('commerce-ai-migrations'))");
  for (const [name,key] of [['commerce_app','DATABASE_URL'],['commerce_identity','IDENTITY_DATABASE_URL'],['commerce_queue','QUEUE_DATABASE_URL']] as const) {
    const url = new URL(process.env[key] ?? '');
    const password = decodeURIComponent(url.password).replaceAll("'", "''");
    if (!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rowCount) {
      await client.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'`);
    } else {
      await client.query(`ALTER ROLE ${name} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'`);
    }
  }
  await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())');
  for(const name of (await readdir(new URL('../packages/db/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) {
  const sql=await readFile(new URL('../packages/db/migrations/'+name,import.meta.url),'utf8');
  const checksum=createHash('sha256').update(sql).digest('hex');
  const prior=await client.query('SELECT checksum FROM public.schema_migrations WHERE name=$1',[name]);
  if(prior.rowCount && prior.rows[0].checksum!==checksum) throw new Error('Applied migration changed. Add a new migration instead.');
  if(!prior.rowCount) {
    await client.query(sql);
    await client.query('INSERT INTO public.schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
  }
  }
  await client.query('COMMIT');
  console.log('Foundation migration applied or already current.');
} catch(error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await admin.end(); }
