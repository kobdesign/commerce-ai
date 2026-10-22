'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState,useSyncExternalStore } from 'react';
import { LayoutDashboard,Package,ShoppingBag,Sparkles,Users,History,ChevronDown,FileInput,ChartNoAxesCombined,ClipboardCheck,ReceiptText,WalletCards,Landmark,Headset,Inbox,KeyRound,Warehouse,Plug } from 'lucide-react';
import { switchOrganization,switchShop } from '../app/actions';
import type { Role } from '@commerce/contracts';
const financialRoles:Role[]=['owner','finance','auditor'];
const orderRoles:Role[]=['owner','finance','operator','auditor'];
type NavLink={href:string;label:string;icon:typeof Package;roles?:Role[]};
const dailyLinks:NavLink[]=[
 {href:'/',label:'ภาพรวม',icon:LayoutDashboard},
 {href:'/catalog',label:'สินค้า',icon:Package},
 {href:'/inventory',label:'สต็อกกลาง',icon:Warehouse,roles:orderRoles},
 {href:'/orders',label:'คำสั่งซื้อ',icon:ShoppingBag,roles:orderRoles},
 {href:'/imports',label:'นำเข้ารายงาน',icon:FileInput,roles:financialRoles},
 {href:'/performance',label:'เงินรับและต้นทุน',icon:ChartNoAxesCombined,roles:financialRoles},
 {href:'/ai',label:'วิเคราะห์ข้อมูล',icon:Sparkles}
];
const groups:{label:string;links:NavLink[]}[]=[
 {label:'เงินและรายการที่ต้องตรวจ',links:[
  {href:'/settlements',label:'กระทบยอดเงินโอน',icon:Landmark,roles:financialRoles},
  {href:'/financial-events',label:'คืนเงินและปรับยอด',icon:ReceiptText,roles:financialRoles},
  {href:'/expenses',label:'ค่าใช้จ่ายร้าน',icon:WalletCards,roles:financialRoles},
  {href:'/reviews',label:'รายการที่ต้องตรวจ',icon:ClipboardCheck,roles:financialRoles}
 ]},
 {label:'ตั้งค่าและเครื่องมือเพิ่มเติม',links:[
 {href:'/team',label:'ทีมและสิทธิ์',icon:Users,roles:['owner']},
  {href:'/integrations/marketplaces',label:'เชื่อมช่องทางขาย',icon:Plug,roles:['owner','operator','auditor']},
  {href:'/activity',label:'ประวัติการทำงาน',icon:History,roles:['owner','auditor']},
  {href:'/integrations/inbox',label:'รายการรับจากระบบเชื่อมต่อ',icon:Inbox,roles:['owner','operator','auditor']},
  {href:'/team/service-access',label:'สิทธิ์ระบบเชื่อมต่อ',icon:KeyRound,roles:['owner','auditor']},
  {href:'/support/poc',label:'ทดลองหน้าจอช่วยเหลือ',icon:Headset,roles:['owner']}
 ]}
];
const matches=(path:string,href:string)=>path===href||(href!=='/'&&path.startsWith(href+'/'));
export function Navigation({role}:{role:Role}){
 const path=usePathname();
 return <NavigationMenu key={`${role}:${path}`} role={role} path={path}/>;
}
function NavigationMenu({role,path}:{role:Role;path:string}){
 const allowed=(link:NavLink)=>!link.roles||link.roles.includes(role);
 const daily=dailyLinks.filter(allowed);
 const visibleGroups=groups.map(group=>({...group,links:group.links.filter(allowed)})).filter(group=>group.links.length>0);
 const active=[...daily,...visibleGroups.flatMap(group=>group.links)].filter(link=>matches(path,link.href)).sort((a,b)=>b.href.length-a.href.length)[0]?.href;
 const core=daily.filter(link=>['/','/catalog','/inventory','/orders'].includes(link.href));
 const [expanded,setExpanded]=useState(false);
 const currentMoreLabel=core.some(link=>link.href===active)?null:[...daily,...visibleGroups.flatMap(group=>group.links)].find(link=>link.href===active)?.label;
 const renderLink=(link:NavLink)=><Link key={link.href} href={link.href} aria-current={active===link.href?'page':undefined} className={active===link.href?'active':''}><link.icon size={19} aria-hidden="true"/>{link.label}</Link>;
 return <nav className="nav-links merchant-navigation" aria-label="เมนูร้านค้า">
  <div className="nav-core">{core.map(renderLink)}</div>
  <button type="button" className="nav-mobile-toggle" aria-label={expanded?'ย่อเมนู':'เมนูทั้งหมด'} aria-expanded={expanded} aria-controls="merchant-nav-more" onClick={()=>setExpanded(value=>!value)}><span>{expanded?'ย่อเมนู':'เมนูทั้งหมด'}</span>{!expanded&&currentMoreLabel&&<span className="nav-mobile-current">{currentMoreLabel}</span>}<ChevronDown size={17} aria-hidden="true"/></button>
  <div id="merchant-nav-more" className={`nav-more${expanded?' is-expanded':''}`}>
   {daily.filter(link=>!core.includes(link)).map(renderLink)}
   {visibleGroups.map(group=><details className="nav-group" key={group.label} open={group.links.some(link=>link.href===active)}>
    <summary>{group.label}<ChevronDown size={15} aria-hidden="true"/></summary>
    {group.links.map(renderLink)}
   </details>)}
   <Link href="/#start-guide" className="nav-help">เริ่มใช้งานอย่างไร?</Link>
  </div>
 </nav>;
}
const subscribeHydration=()=>()=>{};
const clientHydrated=()=>true;
const serverHydrated=()=>false;
export function WorkspacePicker({orgs,current,shops,shopId}:{orgs:{id:string;name:string}[];current:string;shops:{id:string;name:string}[];shopId?:string}){const hydrated=useSyncExternalStore(subscribeHydration,clientHydrated,serverHydrated);return <div className="workspace-pickers"><form action={switchOrganization}><label className="select-wrap"><span className="sr-only">เลือกบริษัท</span><select disabled={!hydrated} name="tenantId" aria-label="เลือกบริษัท" value={current} onChange={e=>e.currentTarget.form?.requestSubmit()}>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select><ChevronDown size={14}/></label></form><span className="picker-slash">/</span>{shops.length?<form action={switchShop}><input type="hidden" name="tenantId" value={current}/><label className="select-wrap secondary"><span className="sr-only">เลือกร้านค้า</span><select disabled={!hydrated} name="shopId" aria-label="เลือกร้านค้า" value={shopId} onChange={e=>e.currentTarget.form?.requestSubmit()}>{shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><ChevronDown size={14}/></label></form>:<span className="muted">ยังไม่มีร้านค้า</span>}</div>;}
