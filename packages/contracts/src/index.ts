import { z } from 'zod';
export const roles = ['owner','finance','operator','marketing','auditor'] as const;
export type Role = typeof roles[number];
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
