export function isLocalDemo(){return process.env.APP_MODE==='local-demo';}

export function applicationOrigin(){
  if(process.env.APP_ORIGIN)return new URL(process.env.APP_ORIGIN).origin;
  if(process.env.RENDER_EXTERNAL_HOSTNAME)return `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  return null;
}

function isLoopbackOrigin(value:string){
  try{
    const url=new URL(value),host=url.hostname.toLowerCase();
    return url.origin===value&&['http:','https:'].includes(url.protocol)&&['localhost','127.0.0.1','[::1]'].includes(host);
  }catch{return false;}
}

export function mutationOriginAllowed(requestOrigin:string|null){
  const configured=applicationOrigin();
  if(!configured||!requestOrigin)return false;
  if(requestOrigin===configured)return true;
  return isLocalDemo()&&isLoopbackOrigin(configured)&&isLoopbackOrigin(requestOrigin);
}

export function secureCookies(){return !isLocalDemo()||applicationOrigin()?.startsWith('https://')===true;}

export function environmentLabel(){
  if(isLocalDemo())return 'ทดสอบในเครื่อง';
  if(process.env.APP_MODE==='staging-demo')return 'Staging · ข้อมูลสมมติ';
  return 'Production';
}
