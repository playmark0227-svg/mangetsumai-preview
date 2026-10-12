/* Cloudflare Workers entry point. */
import { handle, scheduled } from './app.js';

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
  scheduled: (controller, env, ctx) => { ctx.waitUntil(scheduled(env)); },
};
