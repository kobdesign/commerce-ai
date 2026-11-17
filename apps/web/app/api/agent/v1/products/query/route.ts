import { handleAgentQueryRequest } from '@commerce/agent-api';

export const runtime='nodejs';

export function POST(request:Request){return handleAgentQueryRequest(request,'products.query');}
