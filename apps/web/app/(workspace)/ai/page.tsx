import { workspace } from '../../../lib/server';
import { runs,aiConfiguration } from '@commerce/ai';
import { AiWorkspace } from '../../../components/ai-workspace';
export default async function AiPage(){const w=await workspace();if(!w.shop)return <div className="empty-state"><h1>เพิ่มร้านค้าก่อนใช้ผู้ช่วย</h1><a href="/">กลับไปเพิ่มร้านค้า</a></div>;return <AiWorkspace key={w.org.id+':'+w.shop.id} tenantId={w.org.id} shopId={w.shop.id} liveEnabled={aiConfiguration().enabled} initialRuns={(await runs(w.ctx)).map(r=>({...r,created_at:r.created_at.toISOString()}))}/>;}
