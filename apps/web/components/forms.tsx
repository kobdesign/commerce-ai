'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus,Check } from 'lucide-react';
import { request } from '../lib/client';
import type { Member } from '@commerce/domain';
import type { Role } from '@commerce/contracts';
export function ShopForm({tenantId}:{tenantId:string}){
 const router=useRouter(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <details className="subtle-details"><summary><Plus size={15}/> เพิ่มร้านค้า</summary><form className="stack" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form);setBusy(true);setError('');try{await request(`/api/tenants/${tenantId}/shops`,{name:fd.get('name'),channel:fd.get('channel')});form.reset();router.refresh();}catch(err){setError(err instanceof Error?err.message:'ผิดพลาด');}finally{setBusy(false);}}}><label>ชื่อร้าน<input name="name" required maxLength={100} placeholder="ชื่อร้านของคุณ"/></label><label>ช่องทาง<select name="channel"><option value="tiktok">TikTok</option><option value="shopee">Shopee</option><option value="lazada">Lazada</option><option value="direct">ช่องทางตรง</option></select></label>{error&&<p role="alert" className="notice error">{error}</p>}<button disabled={busy} className="button secondary">{busy?'กำลังบันทึก…':'เพิ่มร้าน'}</button></form></details>;
}
const roleLabels:Record<Role,string>={owner:'เจ้าของ',finance:'การเงิน',operator:'ปฏิบัติการ',marketing:'การตลาด',auditor:'ผู้ตรวจสอบ'};
function MemberRow({member,currentUser,tenantId}:{member:Member;currentUser:string;tenantId:string}){
 const [role,setRole]=useState(member.role),[active,setActive]=useState(member.active),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');const router=useRouter();const self=member.user_id===currentUser;
 return <tr><td><strong>{member.name}{self?' (คุณ)':''}</strong><small>{member.email}</small></td><td><select aria-label={`บทบาท ${member.email}`} value={role} onChange={e=>setRole(e.target.value as Role)} disabled={self||busy}>{Object.entries(roleLabels).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></td><td><label className="checkbox-label"><input type="checkbox" checked={active} disabled={self||busy} onChange={e=>setActive(e.target.checked)}/> เปิดใช้งาน</label></td><td>{member.all_shops?'ทุกร้าน':'เฉพาะร้านที่ได้รับสิทธิ์'}</td><td>{!self&&<button disabled={busy} className="button small secondary" onClick={async()=>{setBusy(true);setNotice('');try{await request(`/api/tenants/${tenantId}/members`,{userId:member.user_id,role,active},'PATCH');setNotice('บันทึกแล้ว');router.refresh();}catch(e){setNotice(e instanceof Error?e.message:'ผิดพลาด');}finally{setBusy(false);}}}><Check size={14}/>บันทึก</button>}<small role="status">{notice}</small></td></tr>;
}
export function TeamView({members,tenantId,currentUser}:{members:Member[];tenantId:string;currentUser:string}){return <section className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>สมาชิก</th><th>บทบาท</th><th>สถานะ</th><th>ขอบเขตร้าน</th><th>การจัดการ</th></tr></thead><tbody>{members.map(m=><MemberRow key={m.user_id} member={m} tenantId={tenantId} currentUser={currentUser}/>)}</tbody></table></div></section>;}
