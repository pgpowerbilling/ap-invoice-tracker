// Shared crypto helpers (WebCrypto) — used by Node tools; index.html carries an inline copy.
const subtle = globalThis.crypto.subtle;
const te = new TextEncoder(), td = new TextDecoder();

export const b64 = (buf) => Buffer.from(new Uint8Array(buf)).toString('base64');
export const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
export const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export async function sha256hex(str) {
  const h = await subtle.digest('SHA-256', te.encode(str));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const userKey = (u) => sha256hex('pg-ap:user:' + u.trim().toLowerCase());
export const invKey = (vendor, no) => sha256hex('pg-ap:inv:' + vendor.trim().toLowerCase() + '|' + String(no).trim().toLowerCase());

export async function pwKey(password, salt, iter) {
  const base = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
export async function newDek() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
export async function wrapDek(dek, password, iter = 310000) {
  const salt = rand(16), iv = rand(12);
  const k = await pwKey(password, salt, iter);
  const wrapped = await subtle.wrapKey('raw', dek, k, { name: 'AES-GCM', iv });
  return { salt: b64(salt), iter, iv: b64(iv), wrapped: b64(wrapped) };
}
export async function encJson(key, obj) {
  const iv = rand(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function decJson(key, box) {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
  return JSON.parse(td.decode(pt));
}
export async function newEcdh() {
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  return { pub: await subtle.exportKey('jwk', kp.publicKey), priv: await subtle.exportKey('jwk', kp.privateKey) };
}
// Seal to the tracker's public key: anyone can add, only logged-in users can read.
export async function sealToPub(pubJwk, obj) {
  const pub = await subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const k = await subtle.deriveKey({ name: 'ECDH', public: pub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const box = await encJson(k, obj);
  return { epk: await subtle.exportKey('jwk', eph.publicKey), ...box };
}
