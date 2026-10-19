import { createHash } from 'node:crypto';
import { Pool } from 'pg';

if(!process.env.ADMIN_DATABASE_URL)throw new Error('ADMIN_DATABASE_URL is required for storage migration verification.');
const database=new Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1,connectionTimeoutMillis:5000});
try{
  const {rows:[links]}=await database.query<{
    import_total:number;import_missing:number;import_mismatch:number;settlement_total:number;settlement_missing:number;settlement_mismatch:number;
  }>(`SELECT
    (SELECT count(*)::int FROM app.import_sources) AS import_total,
    (SELECT count(*)::int FROM app.import_sources WHERE evidence_object_id IS NULL) AS import_missing,
    (SELECT count(*)::int FROM app.import_sources source JOIN app.evidence_objects evidence ON evidence.tenant_id=source.tenant_id AND evidence.id=source.evidence_object_id
      WHERE (source.shop_id,source.source_hash,source.byte_size,source.content_type) IS DISTINCT FROM (evidence.shop_id,evidence.source_hash,evidence.byte_size,evidence.content_type)) AS import_mismatch,
    (SELECT count(*)::int FROM app.settlement_import_batches) AS settlement_total,
    (SELECT count(*)::int FROM app.settlement_import_batches WHERE evidence_object_id IS NULL) AS settlement_missing,
    (SELECT count(*)::int FROM app.settlement_import_batches batch JOIN app.evidence_objects evidence ON evidence.tenant_id=batch.tenant_id AND evidence.id=batch.evidence_object_id
      WHERE (batch.shop_id,batch.source_hash,batch.byte_size,batch.content_type) IS DISTINCT FROM (evidence.shop_id,evidence.source_hash,evidence.byte_size,evidence.content_type)) AS settlement_mismatch`);
  const objects=(await database.query<{source_hash:string;byte_size:number;content:Buffer}>(`SELECT source_hash,byte_size,content FROM app.evidence_objects ORDER BY tenant_id,id`)).rows;
  let corrupt=0;
  for(const object of objects){
    if(object.content.byteLength!==object.byte_size||createHash('sha256').update(object.content).digest('hex')!==object.source_hash)corrupt++;
  }
  const report={status:'ok' as 'ok'|'failed',objects:objects.length,corruptObjects:corrupt,...links};
  if(corrupt||links.import_missing||links.import_mismatch||links.settlement_missing||links.settlement_mismatch)report.status='failed';
  console.log(JSON.stringify(report,null,2));
  if(report.status==='failed')process.exitCode=1;
}finally{await database.end();}
