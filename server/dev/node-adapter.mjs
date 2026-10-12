/* node:http ↔ Fetch API adapter: serve handle(request, env, ctx) from a plain Node HTTP server. */
import { createServer } from 'node:http';

const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer', 'cf-connecting-ip']);

export async function toRequest(req, origin) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const k = req.rawHeaders[i];
    if (!HOP.has(k.toLowerCase())) headers.append(k, req.rawHeaders[i + 1]);
  }
  // like Cloudflare: the client address comes from the connection, never from the client
  headers.set('CF-Connecting-IP', req.socket.remoteAddress || '');
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  // the raw bytes pass through untouched (the Stripe webhook signature covers them)
  return new Request(new URL(req.url, origin), { method: req.method, headers, body: hasBody ? body : undefined });
}

export async function sendResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  if (!response.body) { res.end(); return; }
  res.end(Buffer.from(await response.arrayBuffer()));
}

// → { server, url, close() }
export function serve(handle, env, { port = 0, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    let origin = '';
    const server = createServer(async (req, res) => {
      try {
        const request = await toRequest(req, origin);
        const response = await handle(request, env, { waitUntil() {}, passThroughOnException() {} });
        await sendResponse(res, response);
      } catch (e) {
        console.error('[adapter]', e && e.message);
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      }
    });
    server.once('error', reject);
    server.listen(port, host, () => {
      origin = `http://${host}:${server.address().port}`;
      resolve({ server, url: origin, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }) });
    });
  });
}
