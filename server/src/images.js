/* Product images in R2 (optional binding IMAGES): upload from the admin, serve to the shop. */
import { HttpError, json, readBody, mediaType, randomHex } from './http.js';

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const EXT_TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };
const KEY_RE = /^[0-9a-f]{32}\.(webp|jpg|png)$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';

// the bytes must really be the declared format
function looksLike(bytes, type) {
  const at = (i, ...v) => v.every((b, j) => bytes[i + j] === b);
  if (type === 'image/png') return bytes.length > 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (type === 'image/jpeg') return bytes.length > 3 && at(0, 0xff, 0xd8, 0xff);
  if (type === 'image/webp') return bytes.length > 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
  return false;
}

/* ---------- POST /api/admin/images ---------- */
export async function postImage({ request, env, url }) {
  if (!env.IMAGES) throw new HttpError(501, 'images_unavailable', '画像の保存先が設定されていないため、画像をアップロードできません。');
  const type = mediaType(request);
  const ext = TYPES[type];
  if (!ext) throw new HttpError(415, 'unsupported_type', 'WebP・JPEG・PNG の画像を選んでください。');
  let bytes;
  try {
    bytes = await readBody(request, IMAGE_MAX_BYTES);
  } catch (e) {
    if (e instanceof HttpError && e.code === 'too_large') throw new HttpError(413, 'too_large', '画像が大きすぎます。2MBまでの画像を選んでください。');
    throw e;
  }
  if (!looksLike(bytes, type)) throw new HttpError(415, 'unsupported_type', '画像を読み取れませんでした。WebP・JPEG・PNG の画像を選んでください。');
  const key = `${randomHex(16)}.${ext}`;
  await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: IMMUTABLE } });
  return json(200, { url: `${url.origin}/api/images/${key}` });
}

/* ---------- GET /api/images/<key> ---------- */
export async function getImage({ request, env, params }) {
  const key = params[0];
  if (!env.IMAGES || !KEY_RE.test(key)) throw new HttpError(404, 'not_found');
  const head = request.method === 'HEAD';
  const obj = head ? await env.IMAGES.head(key) : await env.IMAGES.get(key);
  if (!obj) throw new HttpError(404, 'not_found');
  const headers = {
    'Content-Type': EXT_TYPES[key.split('.').pop()],
    'Cache-Control': IMMUTABLE,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
  if (obj.httpEtag) headers.ETag = obj.httpEtag;
  if (obj.httpEtag && request.headers.get('If-None-Match') === obj.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(head ? null : obj.body, { status: 200, headers });
}
