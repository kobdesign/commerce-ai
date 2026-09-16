import { requireUser } from '../../lib/server';
import { newOrganization } from '../actions';
export default async function Onboarding(){await requireUser();return <main className="onboarding"><h1>สร้างองค์กรแรกของคุณ</h1><form action={newOrganization} className="stack"><label>ชื่อองค์กร<input name="name" required maxLength={100}/></label><button className="button primary">สร้างพื้นที่ทำงาน</button></form></main>;}
