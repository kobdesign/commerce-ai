import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {relative,resolve} from 'node:path';
import test from 'node:test';
import {commerceCanaryToolFiles} from '../agent/lib/canary-policy-constants.ts';

const root=resolve(import.meta.dirname,'..');
async function files(directory:string):Promise<string[]>{
  const entries=await readdir(directory,{withFileTypes:true});
  const nested=await Promise.all(entries.map(entry=>entry.isDirectory()?files(resolve(directory,entry.name)):[resolve(directory,entry.name)]));
  return nested.flat();
}

test('authored canary tools match the reviewed read-only allowlist exactly',async()=>{
  const authored=(await files(resolve(root,'agent'))).filter(path=>/\/tools\/[^/]+\.ts$/.test(path)).map(path=>relative(root,path)).sort();
  assert.deepEqual(authored,[...commerceCanaryToolFiles].sort());
});

test('root and specialist agents keep framework default tools disabled',async()=>{
  for(const path of ['agent/agent.ts','agent/subagents/inventory-analysis/agent.ts','agent/subagents/marketing-analysis/agent.ts']){
    const source=await readFile(resolve(root,path),'utf8');
    assert.match(source,/tool\s*:\s*false/);
    assert.match(source,/defaultTools\s*:\s*false/);
  }
});
