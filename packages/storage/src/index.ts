import { createHash,randomUUID } from 'node:crypto';
import { AppError,type Context } from '@commerce/contracts';
import type { Tx } from '@commerce/db';

export const inlineEvidenceBackend='postgres-inline-v1' as const;
export const financialEvidenceRetentionClass='financial-evidence' as const;

export type EvidenceObject={
  id:string;contentType:string;byteSize:number;sourceHash:string;storageBackend:typeof inlineEvidenceBackend;
  objectKey:string;retentionClass:typeof financialEvidenceRetentionClass;retainUntil:string|null;lifecycleStatus:'active';createdAt:string;
};
export type EvidenceObjectWithContent=EvidenceObject&{content:Buffer};
type StoredEvidenceObject=Omit<EvidenceObject,'retainUntil'|'createdAt'>&{retainUntil:Date|null;createdAt:Date;content?:Buffer};

function dto(row:StoredEvidenceObject):EvidenceObject{
  return {...row,retainUntil:row.retainUntil?.toISOString()??null,createdAt:row.createdAt.toISOString()};
}
function verify(content:Buffer,byteSize:number,sourceHash:string){
  if(content.byteLength!==byteSize||createHash('sha256').update(content).digest('hex')!==sourceHash){
    throw new AppError(500,'EVIDENCE_INTEGRITY','หลักฐานไฟล์ไม่ผ่านการตรวจสอบความถูกต้อง');
  }
}

export async function storeEvidenceObject(tx:Tx,ctx:Context,input:{shopId:string;contentType:string;content:Buffer;sourceHash?:string}):Promise<EvidenceObject>{
  const sourceHash=createHash('sha256').update(input.content).digest('hex');
  if(input.sourceHash&&input.sourceHash!==sourceHash)throw new AppError(500,'EVIDENCE_HASH_MISMATCH','Checksum ของหลักฐานไฟล์ไม่ตรงกับเนื้อหา');
  const id=randomUUID(),objectKey=`evidence/${ctx.tenantId}/${input.shopId}/${sourceHash}`;
  const inserted=await tx.query<StoredEvidenceObject>(`INSERT INTO app.evidence_objects(tenant_id,id,shop_id,actor_id,content_type,byte_size,source_hash,storage_backend,object_key,retention_class,lifecycle_status,content)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)
    ON CONFLICT(tenant_id,shop_id,source_hash) DO NOTHING
    RETURNING id,content_type AS "contentType",byte_size AS "byteSize",source_hash AS "sourceHash",storage_backend AS "storageBackend",object_key AS "objectKey",retention_class AS "retentionClass",retain_until AS "retainUntil",lifecycle_status AS "lifecycleStatus",created_at AS "createdAt"`,
  [ctx.tenantId,id,input.shopId,ctx.userId,input.contentType,input.content.byteLength,sourceHash,inlineEvidenceBackend,objectKey,financialEvidenceRetentionClass,input.content]);
  const row=inserted[0]??(await tx.query<StoredEvidenceObject>(`SELECT id,content_type AS "contentType",byte_size AS "byteSize",source_hash AS "sourceHash",storage_backend AS "storageBackend",object_key AS "objectKey",retention_class AS "retentionClass",retain_until AS "retainUntil",lifecycle_status AS "lifecycleStatus",created_at AS "createdAt"
    FROM app.evidence_objects WHERE shop_id=$1 AND source_hash=$2`,[input.shopId,sourceHash]))[0];
  if(!row||row.contentType!==input.contentType||row.byteSize!==input.content.byteLength||row.storageBackend!==inlineEvidenceBackend||row.lifecycleStatus!=='active'){
    throw new AppError(500,'EVIDENCE_STORE_FAILED','ไม่สามารถเก็บหลักฐานไฟล์ในพื้นที่จัดเก็บที่กำหนดได้');
  }
  return dto(row);
}

export async function readEvidenceObject(tx:Tx,id:string):Promise<EvidenceObjectWithContent>{
  const row=(await tx.query<StoredEvidenceObject&{content:Buffer}>(`SELECT id,content_type AS "contentType",byte_size AS "byteSize",source_hash AS "sourceHash",storage_backend AS "storageBackend",object_key AS "objectKey",retention_class AS "retentionClass",retain_until AS "retainUntil",lifecycle_status AS "lifecycleStatus",created_at AS "createdAt",content
    FROM app.evidence_objects WHERE id=$1`,[id]))[0];
  if(!row||row.lifecycleStatus!=='active')throw new AppError(404,'EVIDENCE_NOT_AVAILABLE','ไม่พบหลักฐานไฟล์ที่พร้อมใช้งาน');
  verify(row.content,row.byteSize,row.sourceHash);
  return {...dto(row),content:row.content};
}

export function verifyLegacyEvidence(content:Buffer,byteSize:number,sourceHash:string){verify(content,byteSize,sourceHash);}
