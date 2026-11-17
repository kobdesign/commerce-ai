const continuationPath = /^\/eve\/v1\/session\/[^/]+(?:\/(?:cancel|compact|clear|end))?$/;
const streamPath = /^\/eve\/v1\/session\/[^/]+\/stream$/;

export async function isLiveAiRequest(request: Request): Promise<boolean> {
  const pathname = new URL(request.url).pathname;

  if ((request.method==='POST'&&continuationPath.test(pathname))||(request.method==='GET'&&streamPath.test(pathname))) {
    return true;
  }

  if (request.method!=='POST'||pathname !== '/eve/v1/session') {
    return false;
  }

  return (await request.clone().text()).trim().length > 0;
}
