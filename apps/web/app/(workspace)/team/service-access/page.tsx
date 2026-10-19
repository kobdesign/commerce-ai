import { servicePrincipalWorkspace } from '@commerce/integrations';
import { workspace } from '../../../../lib/server';
import { ServiceAccessWorkspace } from '../../../../components/service-access-workspace';
export const metadata={title:'Service Access · Commerce'};
export default async function ServiceAccessPage(){
  const w=await workspace();
  if(!['owner','auditor'].includes(w.ctx.role))return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดู Service Access</h1><p>เฉพาะเจ้าของและผู้ตรวจสอบของบริษัทเท่านั้น</p></div>;
  return <ServiceAccessWorkspace key={w.org.id} tenantId={w.org.id} shops={w.shops} workspace={await servicePrincipalWorkspace(w.ctx)}/>;
}
