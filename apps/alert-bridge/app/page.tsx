import { runtimeReadiness } from '../src/runtime';

export const dynamic='force-dynamic';

async function serviceStatus(){
  try{await runtimeReadiness();return {ready:true,label:'ระบบพร้อมใช้งาน'} as const;}
  catch{return {ready:false,label:'ระบบยังไม่พร้อมใช้งาน'} as const;}
}

export default async function StatusPage(){
  const status=await serviceStatus();
  return <main className="page-shell">
    <section className="status-card" aria-labelledby="page-title">
      <div className="brand" aria-label="Commerce Operations">
        <span className="brand-mark" aria-hidden="true">C.</span>
        <span>commerce operations</span>
      </div>

      <div className="status-heading">
        <span className={status.ready?'status-dot is-ready':'status-dot is-unavailable'} aria-hidden="true"/>
        <span className="status-label">{status.label}</span>
      </div>

      <h1 id="page-title">Alert Delivery Gateway</h1>
      <p className="summary">
        บริการตรวจสอบลายเซ็นของการแจ้งเตือน ป้องกันรายการซ้ำ
        และส่งต่อเหตุการณ์สำหรับระบบ Commerce Operations
      </p>

      <dl className="service-details">
        <div><dt>บริการ</dt><dd>Alert Bridge</dd></div>
        <div><dt>สภาพแวดล้อม</dt><dd>Staging</dd></div>
        <div><dt>การรับข้อมูล</dt><dd>Signed requests only</dd></div>
      </dl>

      <div className="actions">
        <a className="primary-action" href="/api/health">ตรวจสอบสถานะบริการ</a>
        <a className="secondary-action" href="/api/ready">ตรวจสอบความพร้อม</a>
      </div>

      <p className="security-note">
        Endpoint สำหรับรับเหตุการณ์ไม่เปิดให้ใช้งานจากหน้าเว็บ และต้องผ่านการยืนยันลายเซ็นทุกครั้ง
      </p>
    </section>
  </main>;
}
