import {platformAgentControlWorkspace} from '@commerce/db';
import {workspace} from '../../../../lib/server';
import {PlatformAiControlCenter} from '../../../../components/platform-ai-control-center';

export const metadata={title:'AI Control Center · Commerce'};
export default async function PlatformAiPage(){
  const w=await workspace();
  try{
    const control=await platformAgentControlWorkspace(w.user.id);
    return <PlatformAiControlCenter environment={process.env.APP_MODE==='staging-demo'?'staging':'development'} tenants={control.tenants.map(item=>({
      ...item,expiresAt:item.expiresAt?.toISOString()??null,updatedAt:item.updatedAt?.toISOString()??null,lastEventAt:item.lastEventAt?.toISOString()??null,
    }))}/>;
  }catch{
    return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดู AI Control Center</h1><p>หน้านี้สงวนไว้สำหรับผู้ดูแลแพลตฟอร์ม</p></div>;
  }
}
