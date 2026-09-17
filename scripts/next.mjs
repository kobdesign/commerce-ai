import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
if (existsSync('.env')) loadEnvFile('.env');
const command = process.argv[2] || 'dev';
const args = ['node_modules/next/dist/bin/next', command, 'apps/web'];
if (command !== 'build') {
  const host=process.env.HOST??(process.env.RENDER?'0.0.0.0':'127.0.0.1');
  const port=process.env.PORT??(new URL(process.env.APP_ORIGIN||'http://127.0.0.1:3001').port||'3001');
  args.push('--hostname',host,'--port',port);
}
const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
