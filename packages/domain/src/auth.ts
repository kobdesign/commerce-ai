import { createHash,randomBytes,scryptSync,timingSafeEqual } from 'node:crypto';
import { identityPool,withActor } from '@commerce/db';
import { AppError } from '@commerce/contracts';
export type User={id:string;name:string;email:string};
export function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
function matches(password:string,stored:string){const [salt,hash]=stored.split(':');if(!salt||!hash)return false;const actual=scryptSync(password,salt,64);const expected=Buffer.from(hash,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function login(email:string,password:string){
  if(email.length>254||password.length>200)throw new AppError(400,'INVALID_INPUT','ข้อมูลเข้าสู่ระบบไม่ถูกต้อง');
  const db=identityPool();const normalized=email.trim().toLowerCase();
  const [{blocked=false}={}]= (await db.query('SELECT blocked_until>now() AS blocked FROM private.login_attempts WHERE email=$1',[normalized])).rows;
  if(blocked)throw new AppError(429,'RATE_LIMIT','ลองใหม่อีกครั้งใน 15 นาที');
  const user=(await db.query('SELECT id,name,email,password_hash FROM private.users WHERE email=$1 AND active',[normalized])).rows[0];
  if(!user||!matches(password,user.password_hash)){
    if(!user)scryptSync(password,'fixed-timing-salt',64);
    await db.query(`INSERT INTO private.login_attempts(email,failures) VALUES($1,1) ON CONFLICT(email) DO UPDATE SET failures=CASE WHEN private.login_attempts.blocked_until<now() THEN 1 ELSE private.login_attempts.failures+1 END, blocked_until=CASE WHEN private.login_attempts.blocked_until<now() THEN NULL WHEN private.login_attempts.failures>=4 THEN now()+interval '15 minutes' ELSE private.login_attempts.blocked_until END`,[normalized]);
    throw new AppError(401,'INVALID_LOGIN','อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
  await db.query('DELETE FROM private.login_attempts WHERE email=$1',[normalized]);
  const token=randomBytes(32).toString('hex');
  await db.query("INSERT INTO private.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[digest(token),user.id]);
  return token;
}
export async function sessionUser(token?:string):Promise<User|null>{
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  return (await identityPool().query(`SELECT u.id,u.name,u.email FROM private.sessions s JOIN private.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active`,[digest(token)])).rows[0]??null;
}
export async function logout(token?:string){if(token)await identityPool().query('DELETE FROM private.sessions WHERE token_hash=$1',[digest(token)]);}
export async function organizations(userId:string){return withActor(userId,null,tx=>tx.query<{id:string;name:string;role:string}>('SELECT id,name,app.member_role(id) AS role FROM app.tenants ORDER BY name'));}
