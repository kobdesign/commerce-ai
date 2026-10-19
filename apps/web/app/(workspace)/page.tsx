import Link from 'next/link';
import { ArrowRight,Package,FileInput,ShoppingBag,ChartNoAxesCombined,Warehouse } from 'lucide-react';
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
 const canViewOrders=['owner','finance','operator','auditor'].includes(w.ctx.role);
 const tasks=[
  {href:'/inventory',title:'ดูสต็อกกลาง',description:'ดูคงเหลือ จองแล้ว และพร้อมขายของทุก SKU',icon:Warehouse,visible:!!data?.canReadInventory},
  {href:'/catalog',title:'ดูรายการสินค้า',description:'ค้นหาชื่อสินค้า ราคา และตัวเลือกสินค้า',icon:Package,visible:!!data&&!data.canReadInventory},
  {href:'/orders',title:'จัดการคำสั่งซื้อ',description:'ดูสถานะรายการที่บันทึกไว้ในระบบ',icon:ShoppingBag,visible:canViewOrders&&!!w.shop},
  {href:'/imports',title:canImport?'เอารายงานยอดขายเข้าระบบ':'ดูรายงานที่นำเข้า',description:canImport?'เลือกไฟล์รายงาน แล้วตรวจข้อมูลก่อนยืนยัน':'เปิดร่างรายงานและตรวจข้อมูลต้นทาง',icon:FileInput,visible:canViewReports&&!!w.shop},
  {href:'/performance',title:'ดูเงินรับและต้นทุน',description:'ดูยอดจากรายการที่ยืนยันแล้ว พร้อมที่มาของตัวเลข',icon:ChartNoAxesCombined,visible:canViewReports&&!!w.shop}
 ].filter(task=>task.visible);
 return <>
  <div className="page-heading"><div><h1>ภาพรวม</h1><p>{w.shop?.name??w.org.name} · ข้อมูลแสดงตามร้านที่เลือกด้านบน</p></div>{data?.canWrite&&<Link href="/catalog/new" className="button secondary">เพิ่มสินค้า <ArrowRight size={17} aria-hidden="true"/></Link>}</div>
  <details id="start-guide" className="merchant-guide" open={!items.length}>
   <summary><span><strong>เริ่มใช้งานครั้งแรก</strong><span>ดูขั้นตอนและสิ่งที่ต้องเตรียม</span></span><span className="guide-toggle" aria-hidden="true">ดูขั้นตอน</span></summary>
   {!w.shop?<div className="guide-empty"><p>{w.ctx.role==='owner'?'เริ่มจากเพิ่มร้านค้าและเลือกช่องทางขาย แล้วจึงเพิ่มสินค้าและรายงานของร้าน':'ยังไม่มีร้านที่คุณเข้าถึงได้ ให้เจ้าของบริษัทเพิ่มร้านหรือให้สิทธิ์ก่อนเริ่มงาน'}</p>{w.ctx.role==='owner'&&<a href="#shop-settings" className="text-link">ไปเพิ่มร้านค้า <ArrowRight size={15}/></a>}</div>:<>
    <ol className="merchant-steps">
     <li><span className="step-number" aria-hidden="true">1</span><div><h2>{data?.canWrite?'เตรียมรายการสินค้า':'ดูรายการสินค้า'}</h2><p>{data?.canWrite?'เตรียมชื่อ ราคา และรหัสสินค้า เช่น เสื้อสีดำ ไซซ์ M ใช้รหัส SHIRT-BK-M':'ค้นหาสินค้าด้วยชื่อหรือรหัส เพื่อดูราคาและตัวเลือกที่มี'}</p><Link href="/catalog" className="text-link">เปิดรายการสินค้า <ArrowRight size={15} aria-hidden="true"/></Link></div></li>
     {canViewReports?<>
      <li><span className="step-number" aria-hidden="true">2</span><div><h2>{canImport?'นำรายงานยอดขายเข้า':'ตรวจรายงานยอดขาย'}</h2><p>{canImport?'เตรียมไฟล์รายงานยอดขายจากช่องทางที่ร้านขาย เปิดตัวอย่างรูปแบบในหน้านำเข้า แล้วตรวจข้อมูลก่อนยืนยัน':'เปิดร่างที่ร้านนำเข้าไว้ เพื่อตรวจข้อมูลและไฟล์ต้นทาง'}</p><Link href="/imports" className="text-link">{canImport?'ไปเลือกรายงาน':'เปิดร่างรายงาน'} <ArrowRight size={15} aria-hidden="true"/></Link></div></li>
      <li><span className="step-number" aria-hidden="true">3</span><div><h2>ดูเงินรับและต้นทุน</h2><p>เมื่อยืนยันรายงานแล้ว จึงดูยอดและรายการที่ยังขาดข้อมูลได้ ตัวเลขส่วนต่างยังไม่ใช่กำไรสุทธิของบริษัท</p><Link href="/performance" className="text-link">เปิดสรุปตัวเลข <ArrowRight size={15} aria-hidden="true"/></Link></div></li>
     </>:<li><span className="step-number" aria-hidden="true">2</span><div><h2>{canViewOrders?'ดูคำสั่งซื้อของร้าน':'ตรวจข้อมูลด้วยผู้ช่วย'}</h2><p>{canViewOrders?'ดูรายการที่บันทึกไว้และสถานะการจัดสินค้า ส่วนรายงานการเงินให้เจ้าของหรือฝ่ายการเงินจัดการ':'เปิดผู้ช่วยเพื่อตรวจข้อมูลที่คุณมีสิทธิ์ดู แล้วตรวจหลักฐานประกอบคำตอบ'}</p><Link href={canViewOrders?'/orders':'/ai'} className="text-link">{canViewOrders?'เปิดคำสั่งซื้อ':'เปิดผู้ช่วย'} <ArrowRight size={15} aria-hidden="true"/></Link></div></li>}
    </ol>
    <p className="guide-note">เลือกทำขั้นตอนที่ต้องการได้ทันที ไม่จำเป็นต้องทำครบทุกครั้ง</p>
   </>}
  </details>
  {!!tasks.length&&<section className="merchant-tasks" aria-labelledby="daily-tasks-title"><h2 id="daily-tasks-title">วันนี้ต้องการทำอะไร?</h2><div className="merchant-task-grid">{tasks.map(task=><Link key={task.href} href={task.href} className="merchant-task"><task.icon size={23} aria-hidden="true"/><div><h3>{task.title}</h3><p>{task.description}</p></div><ArrowRight size={18} aria-hidden="true"/></Link>)}</div></section>}
  {data&&<>
   <section className="summary-strip merchant-summary" aria-label="สรุปข้อมูลร้าน"><div><span>สินค้าที่แสดง</span><strong>{count.toLocaleString('th-TH')}<small>รายการ</small></strong></div><div><span>รหัสแยกตามตัวเลือกสินค้า</span><strong>{items.length.toLocaleString('th-TH')}<small>รหัส (SKU)</small></strong></div>{data.canReadCosts&&<div><span>ยังไม่ได้ใส่ต้นทุน</span><strong className={missing.length?'text-warning':''}>{missing.length.toLocaleString('th-TH')}<small>รหัสสินค้า</small></strong></div>}</section>
   {items.length===data.limit&&<p className="field-help">สรุปเฉพาะ {data.limit} รหัสสินค้าแรกที่แสดง ไม่ใช่จำนวนรวมทั้งร้าน</p>}
  </>}
  <div className="overview-grid merchant-overview-grid">
   <section className="panel"><div className="panel-heading"><h2>สิ่งที่ควรตรวจต่อ</h2></div>{data?.canReadCosts&&missing.length?<><p className="field-help">สินค้าด้านล่างยังไม่มีต้นทุน จึงยังคำนวณส่วนต่างได้ไม่ครบ{!data.canWrite?' ให้เจ้าของหรือผู้ดูแลสินค้าเพิ่มต้นทุนให้ก่อน':''}</p><div className="attention-list">{missing.slice(0,5).map(i=><Link key={i.id} href={`/catalog?focus=${i.productId}`}><div><strong>{i.name}</strong><code>{i.sku}</code></div><span className="text-warning">ยังไม่มีต้นทุน <ArrowRight size={13} aria-hidden="true"/></span></Link>)}</div>{missing.length>5&&<Link href="/catalog" className="text-link spaced">เปิดรายการสินค้าเพื่อตรวจต่อ</Link>}</>:<p className="field-help">{data?.canReadCosts?'ไม่พบสินค้าขาดต้นทุนในรายการที่แสดง':'เริ่มตรวจข้อมูลได้จากรายการสินค้าของร้าน'}</p>}
    {canViewReports&&w.shop&&<div className="next-task"><h3>เงินที่โอนมาตรงกับรายงานหรือยัง?</h3><p>นำรายการเงินโอนจากแพลตฟอร์มมาเทียบกับยอดที่ระบบคำนวณ แล้วตรวจรายการที่ยังไม่ตรงกัน</p><Link href="/settlements" className="text-link">ไปตรวจเงินโอน <ArrowRight size={15} aria-hidden="true"/></Link></div>}
   </section>
   <section className="panel merchant-help" aria-labelledby="help-title"><h2 id="help-title">คำที่อาจยังไม่คุ้น</h2>
    <details><summary>รหัสสินค้า (SKU) คืออะไร?</summary><p>รหัสสำหรับแยกสินค้าแต่ละตัวเลือก เช่น เสื้อดำไซซ์ M กับเสื้อดำไซซ์ L ใช้คนละรหัส เพื่อให้จับคู่ยอดขายและสต็อกได้ถูกตัว</p></details>
    {canViewReports&&<><details><summary>เงินรับ กับกำไร ต่างกันอย่างไร?</summary><p>เงินรับคือยอดตามรายการขายและรายการปรับยอดที่ยืนยันแล้ว ต้องพิจารณาต้นทุนสินค้า ค่าแอด ค่าใช้จ่ายร้าน และค่าใช้จ่ายอื่นให้ครบก่อนสรุปกำไรของบริษัท</p></details><details><summary>กระทบยอดเงินโอน คืออะไร?</summary><p>คือการนำรายการเงินโอนจากแพลตฟอร์มมาเทียบกับยอดที่ควรได้รับ เพื่อหายอดที่ยังไม่ตรงกัน ยังไม่ใช่การยืนยันว่าเงินเข้าบัญชีธนาคารแล้ว</p></details></>}
    <details><summary>ผู้ช่วย AI ช่วยอะไรได้บ้าง?</summary><p>ช่วยตรวจและอธิบายข้อมูลที่คุณมีสิทธิ์ดู พร้อมหลักฐานให้ตรวจต่อ งานที่ต้องยืนยันยังเป็นหน้าที่ของคุณ ความสามารถที่พร้อมใช้จะแสดงในหน้าผู้ช่วย</p><Link href="/ai" className="text-link">ไปที่ผู้ช่วยวิเคราะห์ข้อมูล <ArrowRight size={15} aria-hidden="true"/></Link></details>
   </section>
  </div>
  <details id="shop-settings" className="merchant-shop-settings" open={!w.shop}>
   <summary>ร้านค้าและบริษัท <span>{w.shops.length.toLocaleString('th-TH')} ร้านที่เข้าถึงได้</span></summary>
   <div className="panel"><p className="field-help">เปลี่ยนร้านที่ทำงานอยู่ได้จากช่องเลือกร้านด้านบน</p>{w.shops.map(s=><div className="shop-row" key={s.id}><div><strong>{s.name}</strong><small>{channelNames[s.channel]??s.channel}</small></div>{s.id===w.shop?.id&&<span className="pill neutral">กำลังใช้งาน</span>}</div>)}{w.ctx.role==='owner'&&<ShopForm tenantId={w.org.id}/>}<details className="subtle-details"><summary>สร้างบริษัทใหม่</summary><form action={newOrganization} className="inline-form"><input name="name" aria-label="ชื่อองค์กรใหม่" placeholder="ชื่อบริษัท" maxLength={100} required/><button className="button secondary">สร้างบริษัท</button></form></details></div>
  </details>
 </>;
}
