import Link from 'next/link';
import { integrationInboxWorkspace } from '@commerce/integrations';
import { workspace } from '../../../../lib/server';
import { IntegrationInboxWorkspace } from '../../../../components/integration-inbox-workspace';
export const metadata={title:'Event Inbox · Commerce'};
export default async function IntegrationInboxPage(){
  const w=await workspace();
  if(!w.shop)return <div className="empty-state"><h1>เลือกร้านค้าก่อนเปิด Event Inbox</h1><Link href="/">กลับหน้าภาพรวม</Link></div>;
  if(!['owner','operator','auditor'].includes(w.ctx.role))return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดู Event Inbox</h1><p>ข้อมูล integration operations เปิดให้เจ้าของ ผู้ดูแลคำสั่งซื้อ และผู้ตรวจสอบ</p></div>;
  const data=await integrationInboxWorkspace(w.ctx,w.shop.id);
  return <IntegrationInboxWorkspace key={`${w.org.id}:${w.shop.id}`} tenantId={w.org.id} shop={w.shop} workspace={data}/>;
}
