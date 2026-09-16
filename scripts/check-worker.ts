import { PgBoss } from 'pg-boss';
import { resolveContext, withTenant, closePools } from '@commerce/db';
import { demo } from '../packages/domain/src/demo';
if (process.env.APP_MODE !== 'local-demo') throw new Error('Synthetic smoke check requires local-demo.');
const boss = new PgBoss({ connectionString: process.env.QUEUE_DATABASE_URL, schema: 'jobs', createSchema: false });
boss.on('error', () => console.error('Queue connectivity error'));
try {
  await boss.start();
  await boss.createQueue('catalog-check', { retryLimit: 1, expireInSeconds: 60 });
  const id = await boss.send('catalog-check', { userId: demo.users.owner, tenantId: demo.tenants.chino, shopId: demo.shops.tiktok });
  const ctx = await resolveContext(demo.users.owner, demo.tenants.chino);
  let complete = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const rows = await withTenant(ctx, tx => tx.query("SELECT id FROM app.audit_events WHERE action='catalog.checked' AND details->>'jobId'=$1", [id]));
    if (rows.length) { complete = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!complete) throw new Error('Worker did not finish within 30 seconds. Start npm run worker first.');
  console.log('Worker smoke check passed: queued job → authorized catalog read → tenant audit event.');
} finally { await boss.stop(); await closePools(); }
