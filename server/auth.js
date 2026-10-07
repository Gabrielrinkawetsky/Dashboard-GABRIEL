import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { db, tx } from './db.js';
const current = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
// Na Vercel o disco é só leitura: o segredo do webhook vem das variáveis de ambiente (sem ele, o webhook fica desligado).
if (!process.env.WEBHOOK_SECRET && !process.env.VERCEL) {
  const saved = current.match(/^WEBHOOK_SECRET=(.*)$/m)?.[1].trim();
  process.env.WEBHOOK_SECRET = saved || crypto.randomBytes(32).toString('hex');
  if (!saved) appendFileSync('.env', `\nWEBHOOK_SECRET=${process.env.WEBHOOK_SECRET}\n`);
}
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
export const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && b.length > 0 && crypto.timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
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
  const user = await db.prepare('SELECT * FROM auth_users WHERE username=?').get(username);
  const valid = await verifyPassword(password, user?.password_hash ?? dummyHash);
  return valid && user ? user : null;
};
export const createSession = async userId => {
  await db.prepare('DELETE FROM auth_sessions WHERE expires <= ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('base64url');
  await db.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').run(digest(token), userId, Date.now() + 8 * 3600000);
  return token;
};
export const readCookie = (req, name) => (req.headers.cookie ?? '').split(';').map(c => c.trim().split('=')).find(([k]) => k === name)?.[1];
export const getSession = async req => {
  const token = readCookie(req, 'session');
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return await db.prepare('SELECT u.id, u.username FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').get(digest(token), Date.now()) ?? null;
};
export const revokeSession = req => db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(readCookie(req, 'session') ?? ''));
export const cookie = (token = '') => `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 8 * 3600 : 0}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
export const changePassword = async (userId, password) => {
  const hash = await hashPassword(password);
  await tx(async () => {
    await db.prepare('UPDATE auth_users SET password_hash=? WHERE id=?').run(hash, userId);
    await db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(userId);
  });
};
export const loginAllowed = (ip, username) => tx(async () => {
  const now = Date.now();
  await db.prepare('DELETE FROM auth_attempts WHERE expires<=?').run(now);
  const keys = [`ip:${ip}`, `user:${username}`];
  for (const k of keys) if ((await db.prepare('SELECT count FROM auth_attempts WHERE key=?').get(k))?.count >= 10) return false;
  for (const key of keys) await db.prepare('INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + 15 * 60000);
  return true;
});

// Primeira conta sem terminal (ex.: Vercel): com ADMIN_PASSWORD definida e nenhuma conta no banco, cria o usuário "gabriel".
// Depois de entrar, apague ADMIN_PASSWORD: ela nunca altera uma conta que já existe.
const bootstrap = process.env.ADMIN_PASSWORD;
if (bootstrap && bootstrap.length >= 15 && bootstrap.length <= 128 && !await db.prepare('SELECT 1 FROM auth_users LIMIT 1').get()) {
  await db.prepare('INSERT OR IGNORE INTO auth_users (username,password_hash) VALUES (?,?)').run('gabriel', await hashPassword(bootstrap));
} else if (bootstrap && (bootstrap.length < 15 || bootstrap.length > 128)) {
  console.error('[auth] ADMIN_PASSWORD ignorada: precisa ter entre 15 e 128 caracteres.');
}
