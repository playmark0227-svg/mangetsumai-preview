/* Local "live mode" in one command:  node server/dev/serve.mjs
 *   API          http://127.0.0.1:8787   (src/app.js on node:http, SQLite file in server/.dev/)
 *   fake Stripe  http://127.0.0.1:12111  (unless a real STRIPE_SECRET_KEY is given)
 *   shop / admin http://127.0.0.1:8790   (the repo root as is, except /js/config.js → apiBase = the API)
 * Settings: environment variables or server/.dev.vars (KEY=value lines, same as wrangler).
 * Ports: API_PORT, SITE_PORT, STRIPE_PORT. */
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdirSync, statSync, createReadStream } from 'node:fs';
import { join, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, scheduled } from '../src/app.js';
import { MIN_TOKEN } from '../src/admin.js';
import { createD1 } from './d1-sqlite.mjs';
import { folderBucket } from './r2-local.mjs';
import { serve } from './node-adapter.mjs';
import { startFakeStripe } from './fake-stripe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(HERE, '..');
const REPO = resolve(SERVER_DIR, '..');
const DEV_DIR = join(SERVER_DIR, '.dev');

// server/.dev.vars (KEY=value, # comments) — the real environment wins
function loadDevVars() {
  const file = join(SERVER_DIR, '.dev.vars');
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}
const vars = { ...loadDevVars(), ...process.env };
const HOST = '127.0.0.1';
const API_PORT = Number(vars.API_PORT || 8787);
const SITE_PORT = Number(vars.SITE_PORT || 8790);
const STRIPE_PORT = Number(vars.STRIPE_PORT || 12111);
const API = `http://${HOST}:${API_PORT}`;
const SITE = `http://${HOST}:${SITE_PORT}`;

mkdirSync(DEV_DIR, { recursive: true });

const DB_FILE = vars.DEV_DB || join(DEV_DIR, 'dev.sqlite');
const env = {
  DB: createD1(DB_FILE),
  IMAGES: folderBucket(join(DEV_DIR, 'images')),
  SITE_URL: vars.SITE_URL || SITE,
  ALLOWED_ORIGINS: vars.ALLOWED_ORIGINS || SITE,
  ADMIN_TOKEN: vars.ADMIN_TOKEN || 'dev-admin-token-please-change-this',
  STRIPE_SECRET_KEY: vars.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: vars.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_API_VERSION: vars.STRIPE_API_VERSION || '',
  // optional settings (unset: the defaults in src/): per-address request limits, how long a
  // Stripe payment page lasts, the stock one address may hold, the secret for the client key kept on orders
  ...Object.fromEntries(['LIMIT_CHECKOUT', 'LIMIT_STATUS', 'LIMIT_CANCEL', 'SESSION_MINUTES', 'HOLD_PER_CLIENT', 'HOLD_SALT']
    .filter((k) => vars[k]).map((k) => [k, vars[k]])),
};

if (env.ADMIN_TOKEN.length < MIN_TOKEN) {
  console.warn(`ADMIN_TOKEN が ${MIN_TOKEN} 文字より短いため、管理画面は使えません。server/.dev.vars の ADMIN_TOKEN を ${MIN_TOKEN} 文字以上にしてください。`);
}

let fake = null;
if (!env.STRIPE_SECRET_KEY) {
  fake = await startFakeStripe({ port: STRIPE_PORT, host: HOST, webhookUrl: `${API}/api/stripe/webhook`, webhooks: vars.FAKE_STRIPE_WEBHOOKS !== '0' });
  Object.assign(env, { STRIPE_SECRET_KEY: fake.secretKey, STRIPE_WEBHOOK_SECRET: fake.webhookSecret, STRIPE_API_BASE: fake.url });
} else if (/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY)) {
  console.error('本番用（live）のキーではローカル起動しません。テスト用のキー（sk_test_...）を使ってください。');
  process.exit(1);
}

const api = await serve(handle, env, { port: API_PORT, host: HOST });

/* ---------- static site ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};
const CONFIG_JS = `/* dev/serve.mjs: local live mode */\nwindow.MANGETSU_CONFIG = {\n  apiBase: '${API}',\n};\n`;

const site = createServer((req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, SITE).pathname); } catch { res.writeHead(400).end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  const head = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (path === '/js/config.js') {
    res.writeHead(200, { ...head, 'Content-Type': TYPES['.js'] });
    res.end(req.method === 'HEAD' ? undefined : CONFIG_JS);
    return;
  }
  // no dotfiles (.git, server/.dev with the local database, .dev.vars)
  if (path.split('/').some((seg) => seg.startsWith('.'))) { res.writeHead(404).end(); return; }
  let file = resolve(REPO, '.' + path);
  if (file !== REPO && !file.startsWith(REPO + sep)) { res.writeHead(404).end(); return; }
  try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); } catch { /* 404 below */ }
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); return; }
  res.writeHead(200, { ...head, 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' });
  if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
});
await new Promise((r) => site.listen(SITE_PORT, HOST, r));

// settle pending orders every 5 minutes, like the Worker's cron trigger
const timer = setInterval(() => scheduled(env), 5 * 60 * 1000);

console.log(`
満月米 ローカル本番モード
  ショップ     ${SITE}/shop.html
  管理画面     ${SITE}/admin/   （管理用パスワード: ${vars.ADMIN_TOKEN ? '（.dev.vars / 環境変数の ADMIN_TOKEN）' : env.ADMIN_TOKEN}）
  API          ${API}/api/catalog
  決済         ${fake ? `ローカルの擬似 Stripe ${fake.url}（本物の決済はしません）` : `Stripe テストモード（別のターミナルで stripe listen --forward-to localhost:${API_PORT}/api/stripe/webhook）`}
  データ       ${DB_FILE}
終了するには Ctrl+C
`);

const stop = async () => {
  clearInterval(timer);
  site.close();
  site.closeAllConnections();
  await api.close();
  if (fake) await fake.close();
  env.DB.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
