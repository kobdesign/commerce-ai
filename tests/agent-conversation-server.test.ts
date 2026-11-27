import {afterEach,describe,expect,it,vi} from 'vitest';
import {agentConversationServerFetch} from '../apps/web/lib/agent-conversation-server';

describe('agent conversation server transport',()=>{
  afterEach(()=>vi.unstubAllGlobals());

  it('forwards the login cookie only to same-origin Commerce Core calls',async()=>{
    const upstream=vi.fn<typeof fetch>().mockResolvedValue(new Response('{}',{status:200}));
    vi.stubGlobal('fetch',upstream);
    const req=new Request('https://core.example.test/api/agent',{headers:{cookie:'commerce_session=server-only-secret'}});
    const scopedFetch=agentConversationServerFetch(req,'https://core.example.test');

    await scopedFetch('https://core.example.test/api/tenants/tenant/agent-session',{method:'POST'});
    await scopedFetch('https://eve.example.test/eve/v1/session',{method:'POST',headers:{authorization:'Bearer one-time-grant'}});

    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get('cookie')).toBe('commerce_session=server-only-secret');
    expect(new Headers(upstream.mock.calls[1]?.[1]?.headers).get('cookie')).toBeNull();
    expect(new Headers(upstream.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer one-time-grant');
  });
});
