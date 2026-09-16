import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
if (existsSync('.env')) {
  console.log('.env exists; preserved without changes.');
} else {
  const admin = randomBytes(24).toString('hex');
  const app = randomBytes(24).toString('hex');
  const identity = randomBytes(24).toString('hex');
  const queue = randomBytes(24).toString('hex');
  writeFileSync('.env', `APP_MODE=local-demo\nAPP_ORIGIN=http://127.0.0.1:3001\nPOSTGRES_PASSWORD=${admin}\nDATABASE_URL=postgresql://commerce_app:${app}@127.0.0.1:55432/commerce_ai\nIDENTITY_DATABASE_URL=postgresql://commerce_identity:${identity}@127.0.0.1:55432/commerce_ai\nADMIN_DATABASE_URL=postgresql://postgres:${admin}@127.0.0.1:55432/commerce_ai\nAI_ENABLED=false\nAI_MODEL=\nAI_GATEWAY_API_KEY=\n`, { mode: 0o600, flag: 'wx' });
  console.log('Created local .env with random database credentials.');
  writeFileSync('.env', `QUEUE_DATABASE_URL=postgresql://commerce_queue:${queue}@127.0.0.1:55432/commerce_ai\n`, { flag: 'a' });
}
