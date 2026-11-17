import {
  commerceAgentSessionVerifierConfiguration,
  consumeCommerceAgentSessionGrant,
} from '@commerce/agent-session';
import {AppError} from '@commerce/contracts';
import {respond} from '../../../../../../lib/server';

export const runtime='nodejs';

export function POST(request:Request){
  return respond(async()=>{
    const authorization=request.headers.get('authorization')??'';
    const match=/^Bearer ([^\s]{1,4096})$/.exec(authorization);
    if(!match)throw new AppError(401,'AGENT_SESSION_GRANT_REQUIRED','ต้องใช้ Commerce session grant');
    return consumeCommerceAgentSessionGrant(match[1],commerceAgentSessionVerifierConfiguration(process.env));
  });
}
