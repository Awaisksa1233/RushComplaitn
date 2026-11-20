/**
 * Admin / Supervisor auth: named users in MongoDB (`rushwash_admin_users`),
 * scrypt password hashes, stateless HMAC-signed session tokens.
 *
 * Env:
 *  - ADMIN_SESSION_SECRET   required in production (random per-process in dev)
 *  - ADMIN_BOOTSTRAP_USER / ADMIN_BOOTSTRAP_PASSWORD   creates the first admin when no users exist
 */
import crypto from 'node:crypto';
import { getLocalDb } from '../complaintsBridge.js';

export const ROLES = ['admin', 'supervisor'];
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const USERS = 'rushwash_admin_users';

const SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.ADMIN_SESSION_SECRET) {
  console.warn('[Admin] ADMIN_SESSION_SECRET not set: sessions use a random key and reset on restart');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function validatePasswordStrength(pw) {
  return typeof pw === 'string' && pw.length >= 10 && pw.length <= 200;
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(user) {
  const payload = b64(JSON.stringify({ sub: String(user._id), role: user.role, exp: Date.now() + SESSION_TTL_MS }));
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function readToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

export async function usersCollection() {
  return (await getLocalDb()).collection(USERS);
}

/** Create the first admin from env when the collection is empty. */
export async function ensureBootstrapAdmin() {
  const username = process.env.ADMIN_BOOTSTRAP_USER;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!username || !password) return;
  const col = await usersCollection();
  await col.createIndex({ username: 1 }, { unique: true });
  if (await col.countDocuments() > 0) return;
  if (!validatePasswordStrength(password)) {
    console.warn('[Admin] ADMIN_BOOTSTRAP_PASSWORD must be at least 10 characters; no admin created');
    return;
  }
  await col.insertOne({
    username: username.toLowerCase(), displayName: username, role: 'admin',
    passwordHash: hashPassword(password), active: true, createdAt: Date.now()
  });
  console.log(`[Admin] Bootstrap admin "${username}" created`);
}

/** Express middleware: requires a valid session; optional role whitelist. */
export function requireAuth(...allowed) {
  return async (req, res, next) => {
    try {
      const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
      const session = m && readToken(m[1]);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });
      const { ObjectId } = await import('mongodb');
      const user = await (await usersCollection()).findOne({ _id: new ObjectId(session.sub) });
      if (!user || !user.active) return res.status(401).json({ error: 'Unauthorized' });
      if (allowed.length && !allowed.includes(user.role)) return res.status(403).json({ error: 'Forbidden' });
      req.user = { id: String(user._id), username: user.username, displayName: user.displayName, role: user.role };
      next();
    } catch (err) {
      console.error('[Admin] auth error:', err);
      res.status(500).json({ error: 'Auth failure' });
    }
  };
}
