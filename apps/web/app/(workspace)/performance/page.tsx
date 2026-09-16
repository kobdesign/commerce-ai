import Link from 'next/link';
import { ArrowRight,FileInput } from 'lucide-react';
import { financialSummary } from '@commerce/imports';
import { workspace } from '../../../lib/server';

export const metadata={title:'เงินรับและต้นทุน · Commerce'};
const money=(value:number)=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB',minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
const date=(value:string)=>new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(`${value}T00:00:00+07:00`));

export default async function PerformancePage(){
  const w=await workspace();
  if(!w.shop||!['owner','finance','auditor'].includes(w.ctx.role))return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดูเงินรับและต้นทุนในร้านนี้</h1></div>;
  const data=await financialSummary(w.ctx,w.shop.id),hasLines=data.total.lineCount>0,complete=hasLines&&data.total.missingCostLines===0;
  return <>
    <div className="page-heading"><div><h1>เงินรับและต้นทุน</h1><p>{w.shop.name} · ข้อมูลที่ยืนยันนำเข้าแล้วทั้งหมด</p></div><Link href="/imports" className="button secondary"><FileInput size={17}/>นำเข้ารายงาน</Link></div>
    <section className="summary-strip performance-summary" aria-label="สรุปเงินรับและต้นทุน">
      <div><span>คำสั่งซื้อ</span><strong>{data.total.orderCount}<small>คำสั่งซื้อ</small></strong></div>
      <div><span>เงินรับสุทธิตามไฟล์</span><strong>{money(data.total.netReceiptMinor)}</strong></div>
      <div><span>ต้นทุนสินค้าที่คำนวณครบ</span><strong>{complete&&data.total.cogsMinor!==null?money(data.total.cogsMinor):'—'}</strong></div>
      <div><span>ส่วนต่างเบื้องต้น</span><strong className={complete&&data.total.contributionMinor!==null&&data.total.contributionMinor<0?'text-error':''}>{complete&&data.total.contributionMinor!==null?money(data.total.contributionMinor):'—'}</strong></div>
    </section>
    {hasLines&&data.total.missingCostLines>0&&<div className="notice error"><strong>ยังคำนวณส่วนต่างรวมไม่ได้</strong><p>มี {data.total.missingCostLines} รายการที่ไม่พบต้นทุนซึ่งมีผลไม่เกินวันที่ขาย ระบบไม่แทนต้นทุนที่ขาดด้วยศูนย์</p><Link className="text-link" href="/reviews">เปิดรายการที่ต้องตรวจ <ArrowRight size={15}/></Link></div>}
    {hasLines&&data.total.manualCostLines>0&&<p className="notice">มี {data.total.manualCostLines} รายการใช้ต้นทุนที่ผู้ใช้ยืนยันย้อนหลัง เปิดประวัติการทำงานเพื่อตรวจผู้ดำเนินการและเหตุผลได้</p>}
    {hasLines&&data.total.feeLineCount<data.total.lineCount&&<p className="notice">มีค่าธรรมเนียมจากไฟล์ {data.total.feeLineCount} จาก {data.total.lineCount} รายการ ยอดค่าธรรมเนียมจึงยังไม่ใช่ยอดรวมที่ครบถ้วน</p>}
    {!hasLines?<section className="panel empty-state"><h2>ยังไม่มีข้อมูลที่ยืนยันนำเข้า</h2><p>นำเข้า CSV ตรวจการจับคู่คอลัมน์ แล้วกดยืนยันก่อนข้อมูลจะปรากฏในหน้านี้</p><Link href="/imports" className="button primary">เริ่มนำเข้ารายงาน</Link></section>:<div className="performance-grid">
      <section className="panel table-panel"><div className="panel-heading performance-heading"><div><h2>แยกตาม SKU</h2><p className="field-help">สูงสุด 100 SKU เรียงตามเงินรับสุทธิ</p></div></div><div className="table-scroll"><table><thead><tr><th>สินค้า / SKU</th><th className="numeric">จำนวน</th><th className="numeric">เงินรับสุทธิ</th><th className="numeric">ค่าธรรมเนียมที่มีข้อมูล</th><th className="numeric">ต้นทุนสินค้า</th><th className="numeric">ส่วนต่างเบื้องต้น</th></tr></thead><tbody>{data.bySku.map(row=><tr key={row.variantId}><td><strong>{row.name}</strong><code>{row.sku}</code></td><td className="numeric">{row.quantity}</td><td className="numeric">{money(row.netReceiptMinor)}</td><td className="numeric">{row.feeLineCount?money(row.platformFeeMinor):'—'}</td><td className="numeric">{row.cogsMinor===null?<span className="text-warning">ไม่ครบ</span>:<>{money(row.cogsMinor)}{row.manualCostLines>0&&<small>ยืนยันย้อนหลัง {row.manualCostLines}</small>}</>}</td><td className="numeric">{row.contributionMinor===null?'—':money(row.contributionMinor)}</td></tr>)}</tbody></table></div></section>
      <section className="panel table-panel"><div className="panel-heading performance-heading"><div><h2>คำสั่งซื้อล่าสุด</h2><p className="field-help">50 คำสั่งซื้อล่าสุด แยกตามเลขคำสั่งซื้อและวันที่ขาย</p></div></div><div className="table-scroll"><table><thead><tr><th>คำสั่งซื้อ</th><th>วันที่ขาย</th><th className="numeric">รายการ</th><th className="numeric">เงินรับสุทธิ</th><th className="numeric">ค่าธรรมเนียมที่มีข้อมูล</th><th className="numeric">ต้นทุนสินค้า</th><th className="numeric">ส่วนต่างเบื้องต้น</th><th>หลักฐาน</th></tr></thead><tbody>{data.orders.map(row=><tr key={`${row.orderId}:${row.soldOn}`}><td><code>{row.orderId}</code></td><td>{date(row.soldOn)}</td><td className="numeric">{row.lineCount}</td><td className="numeric">{money(row.netReceiptMinor)}</td><td className="numeric">{row.feeLineCount?money(row.platformFeeMinor):'—'}</td><td className="numeric">{row.cogsMinor===null?<span className="text-warning">ไม่ครบ</span>:money(row.cogsMinor)}</td><td className="numeric">{row.contributionMinor===null?'—':money(row.contributionMinor)}</td><td>{row.draftId?<Link className="text-link" href={`/imports?draft=${row.draftId}`}>เปิดร่างต้นทาง</Link>:'หลายแหล่งข้อมูล'}</td></tr>)}</tbody></table></div></section>
    </div>}
    <section className="panel metric-definition"><h2>ตัวเลขนี้หมายถึงอะไร</h2><dl><div><dt>เงินรับสุทธิ</dt><dd>ค่าต่อรายการจากคอลัมน์ที่ผู้ใช้ยืนยัน ไม่ใช่ยอดเงินเข้าธนาคารที่ตรวจสอบแล้ว</dd></div><div><dt>ส่วนต่างเบื้องต้น</dt><dd>เงินรับสุทธิ − ต้นทุนสินค้า ณ วันที่ขาย หรือเวอร์ชันที่ผู้ใช้ยืนยันย้อนหลัง ยังไม่หักค่าโฆษณา เงินเดือน น้ำมัน และค่าใช้จ่ายบริษัท</dd></div><div><dt>ค่าธรรมเนียม</dt><dd>แสดงจากไฟล์เพื่อเป็นหลักฐานเท่านั้น ไม่หักซ้ำ เพราะต้องรวมอยู่ในเงินรับสุทธิที่ยืนยันแล้ว</dd></div></dl><p className="field-help">รุ่นการคำนวณ: {data.calculationVersion} · อัปเดตเมื่อ {new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(data.asOf))} · {data.batchCount} ชุดข้อมูล</p></section>
  </>;
}
