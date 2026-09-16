import { workspace } from '../../../lib/server';
import { members } from '@commerce/domain';
import { TeamView } from '../../../components/forms';
export default async function TeamPage(){const w=await workspace();if(w.ctx.role!=='owner')return <div className="empty-state"><h1>คุณไม่มีสิทธิ์จัดการทีม</h1></div>;return <><div className="page-heading"><div><h1>ทีมและสิทธิ์</h1><p>กำหนดบทบาทของสมาชิกภายใน {w.org.name}</p></div><span className="pill green">เจ้าขององค์กร</span></div><TeamView tenantId={w.org.id} currentUser={w.user.id} members={await members(w.ctx)}/><p className="muted small">บัญชีทดลองถูกสร้างไว้แล้ว การส่งคำเชิญและ SSO สำหรับองค์กรจริงอยู่ในระยะถัดไป</p></>;}
