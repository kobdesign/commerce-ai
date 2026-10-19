import { workspace } from '../../../../lib/server';
import { SupportPocWorkspace } from '../../../../components/support-poc-workspace';

export const metadata={title:'Co-browsing PoC · Commerce'};

export default async function SupportPocPage(){
  const w=await workspace();
  if(w.ctx.role!=='owner')return <div className="empty-state"><h1>คุณไม่มีสิทธิ์เปิดพื้นที่ทดสอบ Support</h1><p>พื้นที่นี้ใช้สำหรับเจ้าขององค์กรและทีมทดสอบที่ได้รับมอบหมาย</p></div>;
  return <SupportPocWorkspace organizationName={w.org.name}/>;
}
