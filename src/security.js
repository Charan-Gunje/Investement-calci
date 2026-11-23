import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';
const scrypt = promisify(scryptCallback);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export const hashToken = token => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltText, hashText] = String(encoded).split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const derived = Buffer.from(await scrypt(password, Buffer.from(saltText, 'base64url'), 64, { N: Number(n), r: Number(r), p: Number(p) }));
    const expected = Buffer.from(hashText, 'base64url');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch { return false; }
}

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_MS).toISOString();
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token), userId, expires);
  return { token, expires };
}

export function userForToken(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id,u.name,u.email,u.role,u.preferred_currency,u.created_at
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`).get(hashToken(token), new Date().toISOString());
  return row ?? null;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
}

export function cookie(token, secure) {
  return `investly_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
}
export const clearCookie = secure => `investly_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

export function parseCookies(header = '') {
  const cookies = Object.create(null);
  for (const part of header.split(';')) {
    const split = part.trim().indexOf('=');
    if (split > 0) cookies[part.slice(0, split)] = decodeURIComponent(part.slice(split + 1));
  }
  return cookies;
}
