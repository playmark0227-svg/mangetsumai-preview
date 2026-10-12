/* A tiny stand-in for an R2 bucket binding (put / get / head / delete), in memory or in a folder. */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const toBytes = async (body) => {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === 'string') return new TextEncoder().encode(body);
  return new Uint8Array(await new Response(body).arrayBuffer());
};

function objectFor(key, bytes, httpMetadata, withBody) {
  const etag = createHash('md5').update(bytes).digest('hex');
  const obj = { key, size: bytes.byteLength, etag, httpEtag: `"${etag}"`, httpMetadata: { ...httpMetadata }, uploaded: new Date() };
  if (withBody) {
    obj.body = new Response(bytes).body;
    obj.arrayBuffer = async () => bytes.slice().buffer;
  }
  return obj;
}

export function memoryBucket() {
  const items = new Map();
  return {
    items,
    async put(key, body, { httpMetadata = {} } = {}) {
      const bytes = await toBytes(body);
      items.set(key, { bytes, httpMetadata });
      return objectFor(key, bytes, httpMetadata, false);
    },
    async get(key) { const it = items.get(key); return it ? objectFor(key, it.bytes, it.httpMetadata, true) : null; },
    async head(key) { const it = items.get(key); return it ? objectFor(key, it.bytes, it.httpMetadata, false) : null; },
    async delete(key) { items.delete(key); },
  };
}

// keys are the API's own random names ([0-9a-f]{32}.ext), so they are safe file names
export function folderBucket(dir) {
  mkdirSync(dir, { recursive: true });
  const safe = (key) => { if (!/^[0-9a-f]{32}\.(webp|jpg|png)$/.test(key)) throw new Error('bad key'); return join(dir, key); };
  const read = (key) => {
    const p = safe(key);
    if (!existsSync(p)) return null;
    const meta = existsSync(p + '.json') ? JSON.parse(readFileSync(p + '.json', 'utf8')) : {};
    return { bytes: new Uint8Array(readFileSync(p)), httpMetadata: meta };
  };
  return {
    async put(key, body, { httpMetadata = {} } = {}) {
      const bytes = await toBytes(body);
      writeFileSync(safe(key), bytes);
      writeFileSync(safe(key) + '.json', JSON.stringify(httpMetadata));
      return objectFor(key, bytes, httpMetadata, false);
    },
    async get(key) { const it = read(key); return it ? objectFor(key, it.bytes, it.httpMetadata, true) : null; },
    async head(key) { const it = read(key); return it ? objectFor(key, it.bytes, it.httpMetadata, false) : null; },
    async delete(key) { rmSync(safe(key), { force: true }); rmSync(safe(key) + '.json', { force: true }); },
  };
}
