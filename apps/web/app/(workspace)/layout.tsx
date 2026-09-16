import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { workspace } from '../../lib/server';
import { signOut } from '../actions';
import { Navigation,WorkspacePicker } from '../../components/navigation';
export const dynamic='force-dynamic';
const roles={owner:'เจ้าของ',finance:'การเงิน',operator:'ปฏิบัติการ',marketing:'การตลาด',auditor:'ผู้ตรวจสอบ'};
export default async function WorkspaceLayout({children}:{children:React.ReactNode}){
 const w=await workspace();
 return <div className="app-shell"><a className="skip-link" href="#main">ข้ามไปเนื้อหา</a><aside className="sidebar"><div className="sidebar-heading"><Link href="/" className="brand"><span className="brand-mark">c.</span>commerce</Link><form action={signOut} className="mobile-signout"><button className="icon-button" aria-label="ออกจากระบบบนมือถือ"><LogOut size={18}/></button></form></div><p className="nav-label">การจัดการร้าน</p><Navigation role={w.ctx.role}/><div className="sidebar-bottom"><p className="organization-label">{w.org.name}</p><div className="user-row"><div className="avatar">{w.user.name.slice(0,1)}</div><div><strong>{w.user.name}</strong><small>{roles[w.ctx.role]}</small></div><form action={signOut}><button className="icon-button" title="ออกจากระบบ" aria-label="ออกจากระบบ"><LogOut size={18}/></button></form></div></div></aside><div className="main-shell"><header className="topbar"><WorkspacePicker orgs={w.orgs} current={w.org.id} shops={w.shops} shopId={w.shop?.id}/><span className="environment-label">สภาพแวดล้อมทดสอบ</span></header><main id="main" className="main-content">{children}</main></div></div>;
}
