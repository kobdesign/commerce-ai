export function isLocalDemo(){return process.env.APP_MODE==='local-demo';}

export function applicationOrigin(){
  if(process.env.APP_ORIGIN)return new URL(process.env.APP_ORIGIN).origin;
  if(process.env.RENDER_EXTERNAL_HOSTNAME)return `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  return null;
}

export function secureCookies(){return !isLocalDemo()||applicationOrigin()?.startsWith('https://')===true;}

export function environmentLabel(){
  if(isLocalDemo())return 'ทดสอบในเครื่อง';
  if(process.env.APP_MODE==='staging-demo')return 'Staging · ข้อมูลสมมติ';
  return 'Production';
}
