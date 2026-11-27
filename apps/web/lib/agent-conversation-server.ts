import {AppError} from '@commerce/contracts';
import {CommerceEveLifecycleError,createCommerceEveSessionClient,type CommerceEveSessionClient} from '@commerce/agent-session/client';
import {applicationOrigin} from './environment';
import {agentWorkspaceState} from './agent-workspace';

function requestUrl(input:RequestInfo|URL){
  if(typeof input==='string')return input;
  if(input instanceof URL)return input.toString();
  return input.url;
}

/** Keeps the Commerce session cookie on same-origin Core calls and never forwards it to Eve. */
export function agentConversationServerFetch(req:Request,coreOrigin:string):typeof fetch{
  const cookie=req.headers.get('cookie');
  return (input,init)=>{
    const headers=new Headers(init?.headers),target=new URL(requestUrl(input));
    if(cookie&&target.origin===coreOrigin)headers.set('cookie',cookie);
    return fetch(input,{...init,headers,cache:'no-store'});
  };
}

export function agentConversationClient(req:Request,tenantId:string):CommerceEveSessionClient{
  const state=agentWorkspaceState(tenantId);
  if(!state.canStart)throw new AppError(503,'AGENT_CONVERSATION_DISABLED',state.message);
  const coreOrigin=applicationOrigin(),eveBaseUrl=process.env.COMMERCE_AGENT_EVE_URL?.trim();
  if(!coreOrigin||!eveBaseUrl)throw new AppError(503,'AGENT_CONVERSATION_DISABLED','การเชื่อมต่อทีม AI ยังไม่สมบูรณ์');
  return createCommerceEveSessionClient({
    coreBaseUrl:coreOrigin,eveBaseUrl,tenantId,origin:coreOrigin,fetch:agentConversationServerFetch(req,coreOrigin),
  });
}

export function agentConversationError(error:unknown):never{
  if(!(error instanceof CommerceEveLifecycleError))throw error;
  if(error.code==='CORE_GRANT_FAILED')throw new AppError(error.status===403?403:409,'AGENT_SESSION_UNAVAILABLE','ไม่สามารถยืนยันสิทธิ์ใช้งานทีม AI สำหรับร้านนี้ได้');
  if(error.code==='EVE_STREAM_FAILED')throw new AppError(504,'AGENT_RESPONSE_TIMEOUT','ทีม AI ใช้เวลานานกว่าที่กำหนด กรุณาลองส่งคำถามอีกครั้ง');
  if(error.code==='EVE_RESPONSE_INVALID')throw new AppError(502,'AGENT_RESPONSE_INVALID','ทีม AI ตอบกลับไม่สมบูรณ์ ระบบจึงไม่นำคำตอบมาแสดง');
  throw new AppError(502,'AGENT_RUNTIME_UNAVAILABLE','ยังติดต่อทีม AI ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
}
