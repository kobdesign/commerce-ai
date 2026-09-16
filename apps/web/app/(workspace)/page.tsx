import Link from 'next/link';
import { ArrowRight,Plus } from 'lucide-react';
import { workspace } from '../../lib/server';
import { catalog } from '@commerce/domain';
import { newOrganization } from '../actions';
import { ShopForm } from '../../components/forms';
export const metadata={title:'ภาพรวม · Commerce'};
const channelNames:Record<string,string>={tiktok:'TikTok',shopee:'Shopee',lazada:'Lazada',direct:'ขายตรง'};
export default async function Overview(){
 const w=await workspace(),data=w.shop?await catalog(w.ctx,w.shop.id):null;
 const items=data?.items??[],count=new Set(items.map(p=>p.productId)).size;
 const missing=data?.canReadCosts?items.filter(i=>i.costMinor==null):[];
 const canViewReports=['owner','finance','auditor'].includes(w.ctx.role),canImport=['owner','finance'].includes(w.ctx.role);
 return <><div className="page-heading"><div><h1>ภาพรวม</h1><p>{w.shop?.name??w.org.name}</p></div>{data?.canWrite&&<Link href="/catalog/new" className="button primary"><Plus size={17}/>เพิ่มสินค้า</Link>}</div>
 <section className="summary-strip" aria-label="สรุปข้อมูลร้าน"><div><span>สินค้า</span><strong>{count}<small>รายการ</small></strong></div><div><span>รหัสสินค้า</span><strong>{items.length}<small>SKU</small></strong></div><div><span>ร้านที่เข้าถึงได้</span><strong>{w.shops.length}<small>ร้าน</small></strong></div>{data?.canReadCosts&&<div><span>ยังไม่มีต้นทุน</span><strong className={missing.length?'text-warning':''}>{missing.length}<small>SKU</small></strong></div>}</section>
 {items.length===data?.limit&&<p className="field-help">สรุปจาก {data.limit} SKU แรกของร้าน</p>}
 <div className="overview-grid"><section className="panel"><div className="panel-heading"><h2>ข้อมูลที่ต้องตรวจ</h2><Link href="/catalog" className="text-link">ดูสินค้า <ArrowRight size={15}/></Link></div>{data?.canReadCosts&&missing.length?<><p className="field-help">ระบุต้นทุนให้ครบก่อนนำไปวิเคราะห์กำไร</p><div className="attention-list">{missing.slice(0,5).map(i=><Link key={i.id} href={`/catalog?focus=${i.productId}`}><div><strong>{i.name}</strong><code>{i.sku}</code></div><span className="text-warning">ยังไม่มีต้นทุน</span></Link>)}</div></>:<p className="quiet-empty">{data?.canReadCosts?'ไม่มีรายการขาดต้นทุนในสินค้าที่แสดง':'ตรวจรายการสินค้าและรหัส SKU ได้จากหน้าสินค้า'}</p>}
 <div className="next-task"><h3>รายงานการขาย</h3><p>อัปโหลดและยืนยันรายการขาย เพื่อดูเงินรับสุทธิ ต้นทุนสินค้า และส่วนต่างเบื้องต้นที่ตรวจย้อนกลับถึงร่างต้นทางได้</p>{canViewReports?<Link href="/imports" className="button secondary">{canImport?'เริ่มนำเข้ารายงาน':'ดูร่างรายงาน'} <ArrowRight size={15}/></Link>:<p className="field-help">เจ้าของ ฝ่ายการเงิน หรือผู้ตรวจสอบเป็นผู้เปิดดูรายงาน</p>}</div></section>
 <section className="panel"><div className="panel-heading"><h2>ร้านค้า</h2><span>{w.shops.length} ร้าน</span></div>{w.shops.map(s=><div className="shop-row" key={s.id}><div><strong>{s.name}</strong><small>{channelNames[s.channel]??s.channel}</small></div>{s.id===w.shop?.id&&<span className="pill neutral">กำลังใช้งาน</span>}</div>)}{w.ctx.role==='owner'&&<ShopForm tenantId={w.org.id}/>}<p className="field-help spaced">สลับร้านได้จากเมนูด้านบน รายการสินค้าและรายงานจะแสดงตามร้านที่เลือก</p></section></div>
 <details className="subtle-details"><summary>สร้างบริษัทใหม่</summary><form action={newOrganization} className="inline-form"><input name="name" aria-label="ชื่อองค์กรใหม่" placeholder="ชื่อบริษัท" maxLength={100} required/><button className="button secondary">สร้างบริษัท</button></form></details></>;
}
