'use client';
import { useRef,useState } from 'react';
import { AlertTriangle,CheckCircle2,ExternalLink,Link2,LockKeyhole,RefreshCw,Store } from 'lucide-react';
import type { MarketplaceConnection,TikTokConnectorEnvironment } from '@commerce/connectors';
import type { Role } from '@commerce/contracts';

const blockerLabels:Record<string,string>={
  'app-key':'ยังไม่ได้ตั้ง App Key','app-secret':'ยังไม่ได้ตั้ง App Secret','seller-authorization-url':'ยังไม่ได้วาง Seller authorization URL จาก Partner Center',
  'https-origin':'เว็บไซต์ต้องมี HTTPS origin','oauth-state-secret':'ยังไม่ได้ตั้งกุญแจป้องกัน OAuth state','token-encryption-key':'ยังไม่ได้ตั้งกุญแจเข้ารหัส token',
  'staging-development-shop-only':'Staging เชื่อมได้เฉพาะ Development Shop','production-connector-mode':'Production ต้องใช้ connector mode แบบ production'
};
const dateTime=(value:string|null)=>value?new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'ไม่ระบุ';

export function MarketplaceConnectionsWorkspace({tenantId,shop,role,connections,configuration,callbackStatus}:{tenantId:string;shop:{id:string;name:string;channel:string}|null;
  role:Role;connections:MarketplaceConnection[];configuration:{ready:boolean;environment:TikTokConnectorEnvironment;redirectUri:string|null;blockers:string[]};callbackStatus:string|null}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),errorRef=useRef<HTMLParagraphElement>(null),connection=connections.find(item=>item.provider==='tiktok_shop');
  const isTikTok=shop?.channel==='tiktok',canConnect=role==='owner'&&isTikTok&&configuration.ready;
  async function connect(){
    if(!shop||!canConnect)return;setBusy(true);setError('');
    try{const response=await fetch(`/api/tenants/${tenantId}/connectors/tiktok/authorize`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({shopId:shop.id})});
      const body=await response.json() as {authorizationUrl?:string;error?:string};if(!response.ok||!body.authorizationUrl)throw new Error(body.error??'เริ่มการเชื่อมต่อไม่ได้');
      window.location.assign(body.authorizationUrl);
    }catch(caught){setError(caught instanceof Error?caught.message:'เริ่มการเชื่อมต่อไม่ได้');requestAnimationFrame(()=>errorRef.current?.focus());setBusy(false);}
  }
  return <div className="page-stack marketplace-connections">
    <header className="page-header"><div><p className="eyebrow">Marketplace connections</p><h1>เชื่อมช่องทางขาย</h1><p>{shop?`ร้านที่เลือก: ${shop.name}`:'กรุณาเลือกร้านก่อน'}</p></div></header>
    {callbackStatus==='authorized'&&<p className="notice success" role="status"><CheckCircle2 size={18}/>รับสิทธิ์จาก TikTok Shop แล้ว ระบบเก็บ token แบบเข้ารหัสและรอตรวจร้านที่อนุญาต</p>}
    {callbackStatus==='failed'&&<p className="notice error" role="alert"><AlertTriangle size={18}/>เชื่อม TikTok Shop ไม่สำเร็จ กรุณาตรวจการตั้งค่าและลองใหม่</p>}
    <section className="panel marketplace-provider-card">
      <header><div className="marketplace-provider-title"><span className="marketplace-logo">T</span><div><h2>TikTok Shop</h2><p>รับออเดอร์และสถานะในโหมดอ่านอย่างเดียวก่อน</p></div></div>
        <span className={`pill ${connection?'green':'neutral'}`}>{connection?'รับสิทธิ์แล้ว':'ยังไม่เชื่อม'}</span></header>
      {connection?<div className="marketplace-connection-detail"><dl><div><dt>สถานะ</dt><dd>{connection.status==='authorized'?'รอตรวจร้าน':connection.status}</dd></div><div><dt>Environment</dt><dd>{connection.connectorEnvironment}</dd></div><div><dt>Scope ที่ได้รับ</dt><dd>{connection.grantedScopes.length?connection.grantedScopes.join(', '):'TikTok ไม่ส่งรายการ scope กลับมา'}</dd></div><div><dt>Access token หมดอายุ</dt><dd>{dateTime(connection.tokenExpiresAt)}</dd></div><div><dt>อัปเดตล่าสุด</dt><dd>{dateTime(connection.updatedAt)}</dd></div></dl>
        <p className="field-help"><LockKeyhole size={15}/>หน้าจอนี้ไม่แสดง App Secret, access token หรือ refresh token</p></div>:
        <div className="marketplace-connect-body"><div><h3>สิ่งที่จะเกิดขึ้น</h3><ol><li>ออกจากระบบนี้ไปยืนยันร้านใน TikTok Shop</li><li>TikTok ส่งสิทธิ์กลับมายังระบบผ่าน OAuth callback</li><li>ระบบเก็บ token แบบเข้ารหัสและตรวจร้านก่อนเริ่มอ่านออเดอร์</li></ol></div>
          <button className="button primary" type="button" disabled={!canConnect||busy} onClick={connect}><Link2 size={17}/>{busy?'กำลังเปิด TikTok…':'เชื่อม TikTok Shop'}</button></div>}
      {!isTikTok&&<p className="notice warning"><Store size={17}/>กรุณาเลือกร้านช่องทาง TikTok จากด้านบนก่อนเชื่อม</p>}
      {role!=='owner'&&<p className="notice warning"><LockKeyhole size={17}/>เฉพาะเจ้าของบริษัทเท่านั้นที่ให้สิทธิ์ Marketplace ได้</p>}
      {!configuration.ready&&<div className="marketplace-readiness"><h3>ยังเปิดเชื่อมต่อไม่ได้</h3><p>ผู้ดูแลระบบต้องตั้งค่าต่อไปนี้บน Render</p><ul>{configuration.blockers.map(item=><li key={item}>{blockerLabels[item]??item}</li>)}</ul></div>}
      {error&&<p ref={errorRef} className="notice error" role="alert" tabIndex={-1}>{error}</p>}
      {connection&&role==='owner'&&<button className="button secondary" type="button" disabled={!canConnect||busy} onClick={connect}><RefreshCw size={16}/>ให้สิทธิ์ใหม่</button>}
    </section>
    <section className="panel marketplace-setup"><h2>ค่าที่ใช้ใน TikTok Shop Partner Center</h2><dl><div><dt>โหมด</dt><dd>{configuration.environment==='development'?'Development Shop':'Production'}</dd></div><div><dt>Redirect URL</dt><dd><code>{configuration.redirectUri??'ยังไม่มี HTTPS origin'}</code></dd></div></dl>
      <p><a href="https://partner.tiktokshop.com/" target="_blank" rel="noreferrer">เปิด TikTok Shop Partner Center <ExternalLink size={14}/></a></p>
      <p className="field-help">รอบแรกเปิดเฉพาะสิทธิ์อ่านข้อมูลร้านและออเดอร์ ระบบยังไม่แก้สต็อก ราคา หรือสถานะจัดส่งบน TikTok</p></section>
  </div>;
}
