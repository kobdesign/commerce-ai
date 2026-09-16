import { workspace } from '../../../lib/server';
import { importDrafts,getDraft } from '@commerce/imports';
import { AppError } from '@commerce/contracts';
import { ImportWorkspace } from '../../../components/import-workspace';
export const metadata={title:'นำเข้ารายงาน · Commerce'};
export default async function Imports({searchParams}:{searchParams:Promise<{draft?:string}>}){
  const w=await workspace();
  if(!w.shop||!['owner','finance','auditor'].includes(w.ctx.role))return <div className="empty-state"><h1>คุณไม่มีสิทธิ์จัดการรายงานในร้านนี้</h1></div>;
  const {draft}=await searchParams;
  let initialPreview,initialCommitted=false;
  if(draft){try{const saved=await getDraft(w.ctx,w.shop.id,draft);initialPreview=saved.preview;initialCommitted=!!saved.batch_id;}catch(e){if(e instanceof AppError||e instanceof Error&&e.name==='ZodError')return <div className="empty-state"><h1>ไม่พบร่างรายงานในร้านนี้</h1><a href="/imports">กลับไปนำเข้ารายงาน</a></div>;throw e;}}
  const drafts=await importDrafts(w.ctx,w.shop.id);
  return <ImportWorkspace key={`${w.org.id}:${w.shop.id}:${draft??'new'}`} tenantId={w.org.id} shopId={w.shop.id} shopName={w.shop.name} canWrite={w.ctx.role!=='auditor'} drafts={drafts.map(d=>({...d,created_at:d.created_at.toISOString(),committed_at:d.committed_at?.toISOString()??null}))} initialPreview={initialPreview} initialDraftId={draft} initialCommitted={initialCommitted}/>;
}
