import { signIn } from '../actions';
import { user } from '../../lib/server';
import { environmentLabel,isLocalDemo } from '../../lib/environment';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export const metadata={title:'เข้าสู่ระบบ · Commerce'};
export default async function Login({searchParams}:{searchParams:Promise<{error?:string}>}){
 if(await user())redirect('/');const {error}=await searchParams;const local=isLocalDemo();
 return <main className="login-page"><section className="login-box"><div className="brand"><span className="brand-mark">c.</span>commerce</div><h1>เข้าสู่ระบบ</h1><p className="muted">จัดการสินค้าและข้อมูลร้านค้า</p><form action={signIn} className="stack"><label>อีเมล<input name="email" type="email" autoComplete="username" defaultValue={local?'owner@chino.demo':undefined} required/></label><label>รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required/></label>{error&&<p role="alert" className="notice error">{error}</p>}<button className="button primary" type="submit">เข้าสู่พื้นที่ทำงาน</button></form>{local&&<details className="demo-credentials"><summary>บัญชีสำหรับทดสอบ</summary><p><code>owner@chino.demo</code> — เจ้าของร้าน<br/><code>owner@goods.demo</code> — ร้านของใช้<br/><code>advisor@commerce.demo</code> — ดูได้สองบริษัท<br/><code>marketing@chino.demo</code> — ไม่เห็นต้นทุน</p><p>รหัสผ่าน: <code>StudioDemo!2026</code></p></details>}{process.env.APP_MODE!=='production'&&<p className="login-footnote">{environmentLabel()} · ข้อมูลเริ่มต้นเป็นข้อมูลสมมติ</p>}</section></main>;
}
