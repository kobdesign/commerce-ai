import { z } from 'zod';
export const roles = ['owner','finance','operator','marketing','auditor'] as const;
export type Role = typeof roles[number];
export const payoutTotalBases = ['reported_total','derived_from_lines','unknown'] as const;
export type PayoutTotalBasis = typeof payoutTotalBases[number];
export const uuid = z.string().uuid();
export const nameSchema = z.string().trim().min(1).max(100);
export const shopInput = z.object({name:nameSchema, channel:z.enum(['tiktok','shopee','lazada','direct'])}).strict();
const attributeKey=z.string().min(1).max(40).refine(v=>v===v.trim()&&!['__proto__','constructor','prototype'].includes(v));
export const salesUnits=['ชิ้น','ตัว','ขวด','แพ็ก','คู่','กล่อง','กระปุก','ถุง','ชุด','เล่ม'] as const;
export const attributeMap=z.record(attributeKey,z.string().trim().min(1).max(80)).refine(v=>Object.keys(v).length<=12,'เพิ่มรายละเอียดได้สูงสุด 12 รายการ').refine(v=>new Set(Object.keys(v).map(normalizeLabel)).size===Object.keys(v).length,'ชื่อคุณสมบัติซ้ำกัน');
export function normalizeLabel(value:string){return value.trim().normalize('NFKC').toLocaleLowerCase();}
export const productInput=z.object({
  shopId:uuid, name:z.string().trim().min(1).max(150), category:z.string().trim().min(1).max(80),
  salesUnit:z.enum(salesUnits), sku:z.string().trim().min(1).max(64),
  attributes:attributeMap,
  priceMinor:z.number().int().min(0).max(1_000_000_000), costMinor:z.number().int().min(0).max(1_000_000_000).nullable(),
}).strict();
export const variantInput=productInput.pick({sku:true,attributes:true,priceMinor:true,costMinor:true});
export function variantKey(attributes:Record<string,string>){return JSON.stringify(Object.entries(attributes).map(([k,v])=>[normalizeLabel(k),normalizeLabel(v)]).sort(([a],[b])=>a.localeCompare(b)));}
export const productFamilyInput=productInput.pick({shopId:true,name:true,category:true,salesUnit:true}).extend({
  attributes:attributeMap,
  variants:z.array(variantInput).min(1).max(100),
}).strict().superRefine((data,ctx)=>{
  const skus=new Set<string>(),combinations=new Set<string>();
  const shared=new Set(Object.keys(data.attributes).map(normalizeLabel));
  const axes=Object.keys(data.variants[0]?.attributes??{}).map(normalizeLabel).sort().join('|');
  data.variants.forEach((v,i)=>{
    const sku=normalizeLabel(v.sku),key=variantKey(v.attributes);
    const add=(message:string)=>ctx.addIssue({code:'custom',path:['variants',i],message});
    if(skus.has(sku))add('รหัส SKU ซ้ำกัน');skus.add(sku);
    if(combinations.has(key))add('ชุดตัวเลือกซ้ำกัน');combinations.add(key);
    const keys=Object.keys(v.attributes).map(normalizeLabel);
    if(keys.length>3)add('กำหนดตัวเลือกได้สูงสุด 3 ประเภท');
    if(data.variants.length>1&&keys.length===0)add('แต่ละ SKU ต้องมีตัวเลือกที่แตกต่างกัน');
    if(keys.sort().join('|')!==axes)add('แต่ละ SKU ต้องใช้ชื่อตัวเลือกชุดเดียวกัน');
    if(keys.some(k=>shared.has(k)))add('รายละเอียดสินค้าและตัวเลือกขายต้องใช้ชื่อต่างกัน');
  });
});
export const productUpdateInput=productInput.pick({shopId:true,name:true,category:true,salesUnit:true,attributes:true}).extend({
  version:z.number().int().positive(),
  variants:z.array(productInput.pick({priceMinor:true,costMinor:true}).extend({id:uuid}).strict()).min(1).max(100)
    .refine(v=>new Set(v.map(r=>r.id)).size===v.length,'รายการ SKU ซ้ำกัน'),
  reason:z.string().trim().max(500).default(''),
}).strict();
export const productLifecycleInput=z.object({
  shopId:uuid,
  version:z.number().int().positive(),
  target:z.discriminatedUnion('type',[
    z.object({type:z.literal('product')}).strict(),
    z.object({type:z.literal('variant'),variantId:uuid}).strict(),
  ]),
  action:z.enum(['archive','restore']),
  reason:z.string().trim().min(3).max(500),
}).strict();
const channelIdentity=z.string().trim().min(1).max(160);
const optionalChannelIdentity=z.string().trim().max(160).default('');
const optionalListingText=(max:number)=>z.union([z.string().trim().max(max),z.null()]).default('').transform(value=>value||null);
export const channelListingInput=z.object({
  shopId:uuid,
  productId:uuid,
  variantId:uuid,
  externalProductId:channelIdentity,
  externalVariantId:optionalChannelIdentity,
  externalSku:optionalListingText(160),
  listingName:optionalListingText(200),
  confirmed:z.literal(true),
}).strict();
export const channelListingLifecycleInput=z.object({
  shopId:uuid,
  version:z.number().int().positive(),
  action:z.enum(['archive','restore']),
  reason:z.string().trim().min(3).max(500),
}).strict();
export const inventoryMovementTypes=['opening','receipt','adjustment_in','adjustment_out'] as const;
export type InventoryMovementType=typeof inventoryMovementTypes[number];
export const inventoryLedgerMovementTypes=[...inventoryMovementTypes,'sale_commit'] as const;
export type InventoryLedgerMovementType=typeof inventoryLedgerMovementTypes[number];
export const inventoryMovementInput=z.object({
  shopId:uuid,
  productId:uuid,
  variantId:uuid,
  movementType:z.enum(inventoryMovementTypes),
  quantity:z.number().int().min(1).max(1_000_000),
  sourceReference:z.string().trim().min(1).max(160),
  reason:z.string().trim().min(3).max(500),
  confirmed:z.literal(true),
}).strict();
export const inventoryReservationInput=z.object({
  shopId:uuid,
  productId:uuid,
  variantId:uuid,
  quantity:z.number().int().min(1).max(1_000_000),
  sourceReference:z.string().trim().min(1).max(160),
  expiresAt:z.string().datetime({offset:true}),
  reason:z.string().trim().min(3).max(500),
  confirmed:z.literal(true),
}).strict();
const inventoryReservationActionBase=z.object({
  shopId:uuid,
  productId:uuid,
  version:z.number().int().positive(),
  reason:z.string().trim().min(3).max(500),
  confirmed:z.literal(true),
});
export const inventoryReservationActionInput=z.discriminatedUnion('action',[
  inventoryReservationActionBase.extend({action:z.literal('commit')}).strict(),
  inventoryReservationActionBase.extend({action:z.literal('release')}).strict(),
  inventoryReservationActionBase.extend({action:z.literal('expire')}).strict(),
  inventoryReservationActionBase.extend({action:z.literal('retry'),expiresAt:z.string().datetime({offset:true})}).strict(),
]);
export const inventoryDistributionModes=['shared','fixed','hybrid'] as const;
export type InventoryDistributionMode=typeof inventoryDistributionModes[number];
export const inventoryCompanyDistributionInput=z.object({
  mode:z.enum(inventoryDistributionModes),
  safetyStock:z.number().int().min(0).max(1_000_000_000),
  version:z.number().int().min(0),
  confirmed:z.literal(true),
}).strict();
const inventoryChannelDistributionInput=z.object({
  shopId:uuid,
  quantity:z.number().int().min(0).max(1_000_000_000).nullable(),
}).strict();
export const inventorySkuDistributionInput=z.object({
  variantId:uuid,
  source:z.enum(['inherit','override']),
  mode:z.enum(inventoryDistributionModes),
  safetyStock:z.number().int().min(0).max(1_000_000_000),
  channels:z.array(inventoryChannelDistributionInput).max(50),
  version:z.number().int().min(0),
  confirmed:z.literal(true),
}).strict().superRefine((data,ctx)=>{
  if(new Set(data.channels.map(channel=>channel.shopId)).size!==data.channels.length)ctx.addIssue({code:'custom',path:['channels'],message:'ช่องทางขายต้องไม่ซ้ำกัน'});
  if(data.source==='inherit'&&data.channels.length)ctx.addIssue({code:'custom',path:['channels'],message:'การใช้ค่าบริษัทไม่ต้องกำหนดช่องทางราย SKU'});
  if(data.source==='override'&&data.mode==='shared'&&data.channels.some(channel=>channel.quantity!==null))ctx.addIssue({code:'custom',path:['channels'],message:'Shared Pool ไม่ใช้จำนวนแยกรายช่องทาง'});
  if(data.source==='override'&&data.mode!=='shared'&&data.channels.some(channel=>channel.quantity===null))ctx.addIssue({code:'custom',path:['channels'],message:'กรอกจำนวนของทุกช่องทางให้ครบ'});
});
export const commerceOrderPaymentStates=['pending','paid'] as const;
export const commerceOrderInput=z.object({
  shopId:uuid,
  externalOrderId:z.string().trim().min(1).max(70),
  orderedAt:z.string().datetime({offset:true}),
  paymentState:z.enum(commerceOrderPaymentStates),
  reservationExpiresAt:z.string().datetime({offset:true}).nullable(),
  reason:z.string().trim().min(3).max(500),
  lines:z.array(z.object({
    externalLineId:z.string().trim().min(1).max(70),
    listingMappingId:uuid,
    quantity:z.number().int().min(1).max(1_000_000),
    unitPriceMinor:z.number().int().min(0).max(1_000_000_000).nullable(),
  }).strict()).min(1).max(50),
  confirmed:z.literal(true),
}).strict().superRefine((data,ctx)=>{
  if(new Set(data.lines.map(line=>normalizeLabel(line.externalLineId))).size!==data.lines.length)ctx.addIssue({code:'custom',path:['lines'],message:'รหัสรายการสินค้าในออเดอร์ต้องไม่ซ้ำกัน'});
  if(data.paymentState==='paid'&&!data.reservationExpiresAt)ctx.addIssue({code:'custom',path:['reservationExpiresAt'],message:'กำหนดเวลาหมดอายุของการจองสำหรับออเดอร์ที่ชำระแล้ว'});
});
const commerceOrderActionBase=z.object({
  shopId:uuid,
  version:z.number().int().positive(),
  reason:z.string().trim().min(3).max(500),
  confirmed:z.literal(true),
});
export const commerceOrderActionInput=z.discriminatedUnion('action',[
  commerceOrderActionBase.extend({action:z.literal('confirm_payment'),reservationExpiresAt:z.string().datetime({offset:true})}).strict(),
  commerceOrderActionBase.extend({action:z.literal('ship')}).strict(),
  commerceOrderActionBase.extend({action:z.literal('cancel')}).strict(),
]);
export const integrationInboxActionInput=z.object({
  shopId:uuid,
  version:z.number().int().positive(),
  action:z.enum(['request_replay','acknowledge']),
  reason:z.string().trim().min(3).max(500),
  confirmed:z.literal(true),
}).strict();
export const servicePrincipalScopes=['integration:ingest','integration:read','outbox:publish'] as const;
export type ServicePrincipalScope=typeof servicePrincipalScopes[number];
export const servicePrincipalEnvironments=['development','staging','production'] as const;
export type ServicePrincipalEnvironment=typeof servicePrincipalEnvironments[number];
export const servicePrincipalInput=z.object({
  name:z.string().trim().min(3).max(100),
  shopIds:z.array(uuid).min(1).max(50).refine(values=>new Set(values).size===values.length,'ร้านค้าต้องไม่ซ้ำกัน'),
  scopes:z.array(z.enum(servicePrincipalScopes)).min(1).max(10).refine(values=>new Set(values).size===values.length,'Scope ต้องไม่ซ้ำกัน'),
  expiresAt:z.string().datetime({offset:true}),
  environment:z.enum(servicePrincipalEnvironments).default('development'),
  audience:z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/).default('integration-inbox'),
  confirmed:z.literal(true),
}).strict();
export const servicePrincipalRotationInput=z.object({
  version:z.number().int().positive(),
  expiresAt:z.string().datetime({offset:true}),
  overlapMinutes:z.number().int().min(5).max(1440),
  reason:z.string().trim().min(3).max(500),
  confirmed:z.literal(true),
}).strict();
export const servicePrincipalRevokeInput=z.object({
  version:z.number().int().positive(),
  reason:z.string().trim().min(3).max(500),
  confirmed:z.literal(true),
}).strict();
export type OptionAxis={name:string;values:string[]};
export function buildCombinations(axes:OptionAxis[]):Record<string,string>[] {
  if(!axes.length||axes.length>3)throw new Error('กำหนดตัวเลือก 1–3 ประเภท');
  const names=new Set<string>();let total=1;
  for(const axis of axes){
    if(!attributeKey.safeParse(axis.name).success||names.has(normalizeLabel(axis.name)))throw new Error('กรอกชื่อตัวเลือกให้ครบและไม่ซ้ำกัน');
    names.add(normalizeLabel(axis.name));
    if(!axis.values.length||axis.values.some(v=>!v.trim()||v.trim().length>80)||new Set(axis.values.map(normalizeLabel)).size!==axis.values.length)throw new Error('กรอกค่าตัวเลือกให้ครบและไม่ซ้ำกัน');
    total*=axis.values.length;if(total>100)throw new Error('ชุดตัวเลือกเกิน 100 SKU กรุณาลดจำนวนตัวเลือก');
  }
  return axes.reduce<Record<string,string>[]>((rows,axis)=>rows.flatMap(row=>axis.values.map(value=>({...row,[axis.name]:value.trim()}))),[{}]);
}
export const aiInput=z.object({shopId:uuid,mode:z.enum(['tool-preview','live']),question:z.string().trim().min(1).max(1000)}).strict();
export type ProductInput=z.infer<typeof productInput>;
export type Context={userId:string;tenantId:string;role:Role};
export class AppError extends Error {
  constructor(public status:number, public code:string, message:string) { super(message); }
}
export function canReadCosts(role:Role){return ['owner','finance','auditor'].includes(role);}
export function canWriteCatalog(role:Role){return ['owner','finance'].includes(role);}
export function canReadInventory(role:Role){return ['owner','finance','operator','auditor'].includes(role);}
export function canWriteInventory(role:Role){return ['owner','finance','operator'].includes(role);}
