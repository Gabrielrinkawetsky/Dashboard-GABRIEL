import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { db, tx } from './db.js';
const current = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
if (!process.env.WEBHOOK_SECRET) {
  const saved = current.match(/^WEBHOOK_SECRET=(.*)$/m)?.[1].trim();
  process.env.WEBHOOK_SECRET = saved || crypto.randomBytes(32).toString('hex');
  if (!saved) appendFileSync('.env', `\nWEBHOOK_SECRET=${process.env.WEBHOOK_SECRET}\n`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS auth_users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES auth_users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
`);
const scryptRaw = promisify(crypto.scrypt);
// Cada scrypt usa ~128 MB: limita a 2 simultâneos para que várias tentativas de login em paralelo não esgotem a memória.
let running = 0;
const waiting = [];
const scrypt = async (...args) => {
  if (running >= 2) await new Promise((resolve) => waiting.push(resolve));
  running++;
  try { return await scryptRaw(...args); } finally { running--; waiting.shift()?.(); }
};
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const digest = s => crypto.createHash('sha256').update(String(s)).digest('hex');
export const safeEqual = (a, b) => crypto.timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export const hashPassword = async password => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, options);
  return `${salt}:${hash.toString('hex')}`;
};
export const verifyPassword = async (password, encoded) => {
  const [salt, hash] = encoded.split(':');
  const result = await scrypt(password, salt, 64, options);
  return crypto.timingSafeEqual(result, Buffer.from(hash, 'hex'));
};
const dummyHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
export const authenticate = async (username, password) => {
  const user = db.prepare('SELECT * FROM auth_users WHERE username=?').get(username);
  const valid = await verifyPassword(password, user?.password_hash ?? dummyHash);
  return valid && user ? user : null;
};
export const createSession = userId => {
  db.prepare('DELETE FROM auth_sessions WHERE expires <= ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').run(digest(token), userId, Date.now() + 8 * 3600000);
  return token;
};
export const readCookie = (req, name) => (req.headers.cookie ?? '').split(';').map(c => c.trim().split('=')).find(([k]) => k === name)?.[1];
export const getSession = req => {
  const token = readCookie(req, 'session');
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return db.prepare('SELECT u.id, u.username FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').get(digest(token), Date.now()) ?? null;
};
export const revokeSession = req => db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(readCookie(req, 'session') ?? ''));
export const cookie = (token = '') => `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 8 * 3600 : 0}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
export const changePassword = async (userId, password) => {
  const hash = await hashPassword(password);
  tx(() => {
    db.prepare('UPDATE auth_users SET password_hash=? WHERE id=?').run(hash, userId);
    db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(userId);
  });
};
export const loginAllowed = (ip, username) => {
  const now = Date.now();
  db.prepare('DELETE FROM auth_attempts WHERE expires<=?').run(now);
  const keys = [`ip:${ip}`, `user:${username}`];
  if (keys.some(k => (db.prepare('SELECT count FROM auth_attempts WHERE key=?').get(k)?.count ?? 0) >= 10)) return false;
  for (const key of keys) db.prepare('INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + 15 * 60000);
  return true;
};
